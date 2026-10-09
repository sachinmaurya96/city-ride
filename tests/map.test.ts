import { describe, expect, it } from 'vitest';
import {
  BAYS,
  FUEL_STATIONS,
  LANDMARK_BY_ID,
  DIR_VEC,
  INCOMING,
  INTERSECTIONS,
  SEGMENTS,
  SEGMENT_BY_ID,
  STRIP_WIDTH,
  laneOffset,
  leftOf,
  stripOffset,
} from '../src/game/data/cityMap';
import { VEHICLES, VEHICLE_ORDER } from '../src/game/data/vehicles';
import { findRoute, successors, turnRadius, turnType, vehicleMinRadius } from '../src/game/navigation/roadGraph';
import { buildCity } from '../src/game/world/cityBuilder';
import { phaseAt, CYCLE } from '../src/game/traffic/signals';
import { CROSSINGS } from '../src/game/pedestrians/pedestrians';

// Plan §5.5 map validation and §20 Phase 3 exit checks.

describe('map data integrity', () => {
  it('ids are unique and references resolve', () => {
    const ids = (a: { id: string }[]) => new Set(a.map((x) => x.id)).size === a.length;
    expect(ids(SEGMENTS)).toBe(true);
    expect(ids(BAYS)).toBe(true);
    expect(ids(INTERSECTIONS)).toBe(true);
    for (const b of BAYS) expect(SEGMENT_BY_ID.has(b.segmentId)).toBe(true);
    for (const s of SEGMENTS) expect(successors(s).length).toBeGreaterThan(0);
  });

  it('every signalized junction has ≥3 approaches; no unsignalized 4-way junction', () => {
    for (const n of INTERSECTIONS) {
      const approaches = INCOMING.get(n.id)?.length ?? 0;
      if (n.signal) expect(approaches).toBeGreaterThanOrEqual(3);
      else expect(approaches).toBeLessThanOrEqual(2);
    }
  });

  it('bays are in the curb strip on the driver’s left, inside their segment', () => {
    for (const b of BAYS) {
      const seg = SEGMENT_BY_ID.get(b.segmentId)!;
      const [dx, dz] = DIR_VEC[seg.dir];
      const [lx, lz] = leftOf(seg.dir);
      const rx = b.x - seg.sx;
      const rz = b.z - seg.sz;
      expect(rx * dx + rz * dz).toBeCloseTo(b.s, 3);
      expect(rx * lx + rz * lz).toBeCloseTo(stripOffset(seg), 3);
      expect(stripOffset(seg)).toBeGreaterThan(laneOffset(seg, seg.lanes - 1));
      expect(b.s - b.length / 2).toBeGreaterThan(5);
      expect(b.s + b.length / 2).toBeLessThan(seg.length - 5);
      expect(b.width).toBeGreaterThanOrEqual(STRIP_WIDTH);
    }
  });

  it('no bay is blocked by a building, tree, lamp or parked car', () => {
    const city = buildCity();
    for (const b of BAYS) {
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      for (const c of city.staticBoxes) {
        // separating-axis test between two oriented rectangles (bay inflated by 0.4 m)
        const A = { x: b.x, z: b.z, hx: b.width / 2 + 0.4, hz: b.length / 2 + 0.4, ax: [fz, -fx], az: [fx, fz] };
        const cs = Math.cos(c.ry);
        const sn = Math.sin(c.ry);
        const B = { x: c.x, z: c.z, hx: c.hx, hz: c.hz, ax: [cs, -sn], az: [sn, cs] };
        const axes = [A.ax, A.az, B.ax, B.az];
        const d = [B.x - A.x, B.z - A.z];
        const separated = axes.some((ax) => {
          const proj = (R: typeof A) => R.hx * Math.abs(R.ax[0] * ax[0] + R.ax[1] * ax[1]) + R.hz * Math.abs(R.az[0] * ax[0] + R.az[1] * ax[1]);
          return Math.abs(d[0] * ax[0] + d[1] * ax[1]) > proj(A) + proj(B);
        });
        if (!separated) throw new Error(`bay ${b.id} overlaps static collider at ${c.x.toFixed(1)},${c.z.toFixed(1)}`);
      }
    }
  });

  it('all named stops have a matching sign at their own curb, including both airport gates and petrol stations', () => {
    const city = buildCity();
    for (const bay of BAYS) {
      const name = LANDMARK_BY_ID.get(bay.landmark)!.name.toUpperCase();
      expect(city.signs.some((s) => s.text === name && Math.hypot(s.x - bay.waitX, s.z - bay.waitZ) < 9), bay.id).toBe(true);
    }
    expect(FUEL_STATIONS).toHaveLength(2);
    for (const bay of FUEL_STATIONS) {
      expect(city.signs.some((s) => s.text === '⛽ STOP HERE' && Math.hypot(s.x - bay.x, s.z - bay.z) < 9)).toBe(true);
    }
  });

  it('every point-to-point landmark pair routes legally (car and bus bays)', () => {
    const cars = BAYS.filter((b) => !b.bus);
    let pairs = 0;
    for (const a of cars) {
      for (const b of cars) {
        if (a.landmark === b.landmark) continue;
        const r = findRoute(SEGMENT_BY_ID.get(a.segmentId)!, a.s, { segmentId: b.segmentId, s: b.s, bay: true }, 'car');
        expect(r, `${a.id}→${b.id}`).not.toBeNull();
        expect(r!.length).toBeGreaterThan(20);
        expect(r!.length).toBeLessThan(3500);
        // consecutive segments are legal successors (no U-turns)
        for (let i = 0; i < r!.segments.length - 1; i++) expect(turnType(r!.segments[i], r!.segments[i + 1])).not.toBe('uturn');
        pairs++;
      }
    }
    const buses = BAYS.filter((b) => b.bus);
    for (const a of buses) for (const b of buses) if (a !== b) expect(findRoute(SEGMENT_BY_ID.get(a.segmentId)!, a.s, { segmentId: b.segmentId, s: b.s }, 'bus')).not.toBeNull();
    expect(pairs).toBeGreaterThan(400);
  });

  it('turn radii are validated per vehicle: tight turns are excluded from routes for vehicles that cannot make them', () => {
    const radii = SEGMENTS.flatMap((a) => successors(a).map((b) => turnRadius(a, b))).filter((r) => r < Infinity);
    const tightest = Math.min(...radii);
    for (const id of VEHICLE_ORDER) {
      const minR = vehicleMinRadius(id);
      const kind = VEHICLES[id].kind;
      const bays = BAYS.filter((b) => (kind === 'bus' ? b.bus : !b.bus));
      // every pair of usable bays still routes when tight turns are excluded
      for (const a of bays) {
        for (const b of bays) {
          if (a.landmark === b.landmark) continue;
          const r = findRoute(SEGMENT_BY_ID.get(a.segmentId)!, a.s, { segmentId: b.segmentId, s: b.s }, kind, { minTurnRadius: minR });
          expect(r, `${id}: ${a.id}→${b.id}`).not.toBeNull();
          for (let i = 0; i < r!.segments.length - 1; i++) expect(turnRadius(r!.segments[i], r!.segments[i + 1])).toBeGreaterThanOrEqual(minR);
        }
      }
      if (minR > tightest) console.log(`${id}: min radius ${minR.toFixed(1)} m > tightest turn ${tightest.toFixed(1)} m → restricted routing`);
    }
  });
});

describe('signals', () => {
  it('never shows conflicting greens; pedestrians only cross with all vehicles red', () => {
    for (const n of INTERSECTIONS.filter((k) => k.signal)) {
      for (let t = 0; t < CYCLE * 2; t += 0.5) {
        const p = phaseAt(n, t);
        expect(p.ns !== 'R' && p.ew !== 'R').toBe(false);
        if (p.ped || p.pedClear) expect([p.ns, p.ew]).toEqual(['R', 'R']);
      }
    }
  });
  it('zebra crossings connect two different blocks', () => {
    expect(CROSSINGS.length).toBeGreaterThan(40);
    for (const c of CROSSINGS) expect(c.blockA).not.toBe(c.blockB);
  });
});
