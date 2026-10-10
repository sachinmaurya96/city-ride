import type { Dir, Intersection } from '../data/cityMap';

// Authoritative signal controller (plan §10.2). Signal meshes, AI permission, pedestrian crossing
// permission and red-light violation detection all read phaseAt(); nothing keeps its own copy.

export type Light = 'G' | 'A' | 'R';

export interface SignalPhase {
  ns: Light;
  ew: Light;
  /** Pedestrians may start crossing. */
  ped: boolean;
  /** Pedestrian clearance (no new crossings, vehicles still red). */
  pedClear: boolean;
  /** Seconds until this phase changes. */
  remaining: number;
}

/** Phase table: [duration, ns, ew, ped, pedClear]. Total 56 s. */
const TABLE: [number, Light, Light, boolean, boolean][] = [
  [18, 'G', 'R', false, false],
  [3, 'A', 'R', false, false],
  [2, 'R', 'R', false, false],
  [18, 'R', 'G', false, false],
  [3, 'R', 'A', false, false],
  [2, 'R', 'R', false, false],
  [8, 'R', 'R', true, false],
  [2, 'R', 'R', false, true],
];
export const CYCLE = TABLE.reduce((a, r) => a + r[0], 0);

const ALWAYS_GREEN: SignalPhase = { ns: 'G', ew: 'G', ped: false, pedClear: false, remaining: Infinity };

export function phaseAt(n: Intersection, simTime: number): SignalPhase {
  if (!n.signal) return ALWAYS_GREEN;
  let t = (((simTime + n.cycleOffset) % CYCLE) + CYCLE) % CYCLE;
  for (const [d, ns, ew, ped, pedClear] of TABLE) {
    if (t < d) return { ns, ew, ped, pedClear, remaining: d - t };
    t -= d;
  }
  return { ns: 'R', ew: 'R', ped: false, pedClear: false, remaining: 0 };
}

export function axisOf(d: Dir): 'ns' | 'ew' {
  return d === 'N' || d === 'S' ? 'ns' : 'ew';
}

/** Light shown to a vehicle arriving at junction `n` while travelling in direction `d`. */
export function lightFor(n: Intersection, d: Dir, simTime: number): Light {
  const p = phaseAt(n, simTime);
  return p[axisOf(d)];
}
