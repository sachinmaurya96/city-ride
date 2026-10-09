import { DIR_VEC, INTERSECTIONS, OUTGOING, SEGMENTS, leftOf, type Segment } from '../data/cityMap';
import type { VehicleKind } from '../data/vehicles';
import { findRoute, projectToRoad, type Route, type RouteOptions, type RouteTarget } from './roadGraph';

/** Best legal starting point on the directed graph for a vehicle at (x, z) heading (fx, fz). */
export function startFor(x: number, z: number, fx: number, fz: number): { seg: Segment; s: number } {
  const p = projectToRoad(x, z, fx, fz);
  if (p.kind === 'segment' && p.segment) return { seg: p.segment, s: p.s };
  if (p.kind === 'junction' && p.junction) {
    const outs = OUTGOING.get(p.junction.id) ?? [];
    let best = outs[0];
    let bestDot = -Infinity;
    for (const o of outs) {
      const [dx, dz] = DIR_VEC[o.dir];
      const d = dx * fx + dz * fz;
      if (d > bestDot) {
        bestDot = d;
        best = o;
      }
    }
    return { seg: best, s: 0 };
  }
  // Off-road: nearest segment whose direction is not opposite to the heading.
  let best: { seg: Segment; s: number; d: number } | null = null;
  for (const seg of SEGMENTS) {
    const [dx, dz] = DIR_VEC[seg.dir];
    const [lx, lz] = leftOf(seg.dir);
    const px = x - seg.sx;
    const pz = z - seg.sz;
    const s = Math.max(0, Math.min(seg.length, px * dx + pz * dz));
    const lat = px * lx + pz * lz;
    const along = px * dx + pz * dz;
    const d = Math.hypot(lat, along - s) + (dx * fx + dz * fz < -0.2 ? 30 : 0);
    if (!best || d < best.d) best = { seg, s, d };
  }
  return best ? { seg: best.seg, s: best.s } : { seg: SEGMENTS[0], s: 0 };
}

export function routeFrom(x: number, z: number, fx: number, fz: number, target: RouteTarget, kind: VehicleKind, opts: RouteOptions = {}): Route | null {
  const st = startFor(x, z, fx, fz);
  // If already past the target on its segment, the route loops around the block legally.
  return findRoute(st.seg, st.s, target, kind, opts) ?? (opts.minTurnRadius ? findRoute(st.seg, st.s, target, kind) : null);
}

export { INTERSECTIONS };
