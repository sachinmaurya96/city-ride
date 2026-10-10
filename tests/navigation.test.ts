import { expect, it } from 'vitest';
import { BAYS, FUEL_STATIONS, DIR_VEC, SEGMENTS } from '../src/game/data/cityMap';
import { routeFrom } from '../src/game/navigation/routing';
import { lanePoint, progressAlong, routeInstruction } from '../src/game/navigation/roadGraph';

it('routes from every road direction to the exact center of every ride and fuel stopping area', () => {
  for (const direction of ['N', 'S', 'E', 'W'] as const) {
    const seg = SEGMENTS.find(s => s.dir === direction)!;
    const [x, z] = lanePoint(seg, 20), [fx, fz] = DIR_VEC[direction];
    for (const bay of [...BAYS, ...FUEL_STATIONS]) {
      const route = routeFrom(x, z, fx, fz, { segmentId: bay.segmentId, s: bay.s, bay: true, position: [bay.x, bay.z] }, 'car')!;
      expect(route, bay.id).toBeTruthy();
      const last = route.points.at(-1)!;
      expect(last[0], bay.id).toBeCloseTo(bay.x, 6);
      expect(last[1], bay.id).toBeCloseTo(bay.z, 6);
      const progress = progressAlong(route, bay.x, bay.z);
      expect(progress.offRoute).toBeLessThan(.001);
      expect(progress.along).toBeCloseTo(route.length, 5);
    }
  }
});

it('uses measured curve lengths for instructions and recovers progress after a large position jump', () => {
  const seg = SEGMENTS[0], [x, z] = lanePoint(seg, 10), [fx, fz] = DIR_VEC[seg.dir];
  const bay = BAYS.find(b => Math.hypot(b.x - x, b.z - z) > 750)!;
  const route = routeFrom(x, z, fx, fz, { segmentId: bay.segmentId, s: bay.s, bay: true, position: [bay.x, bay.z] }, 'car')!;
  expect(route.turns.length).toBeGreaterThan(0);
  for (const turn of route.turns) {
    const distance = route.cumulative[turn.start];
    if (route.length - distance <= 50) continue;
    expect(routeInstruction(route, distance - 10)).toEqual({ instruction: turn.type, instructionDist: 10 });
    const point = route.points[turn.start];
    expect(progressAlong(route, point[0], point[1], 0).along).toBeCloseTo(distance, 5);
  }
  expect(routeInstruction(route, route.length)).toEqual({ instruction: 'stop', instructionDist: 0 });
});

it('reports stable arrival when the vehicle already occupies the destination', () => {
  const bay = BAYS[0], [fx, fz] = DIR_VEC[SEGMENTS.find(s => s.id === bay.segmentId)!.dir];
  const route = routeFrom(bay.x, bay.z, fx, fz, { segmentId: bay.segmentId, s: bay.s, bay: true, position: [bay.x, bay.z] }, 'car')!;
  expect(progressAlong(route, bay.x, bay.z)).toEqual({ along: 0, index: 0, offRoute: 0 });
});
