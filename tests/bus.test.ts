import { describe, expect, it } from 'vitest';
import { BUS_ROUTES, maxOccupancy, planGroups, previewRoute, routeEligible, routeMeters } from '../src/game/missions/bus';
import { VEHICLES, type VehicleId } from '../src/game/data/vehicles';
import { quoteBus, settleBus, ensureDailyBoard, utcDayKey } from '../src/game/progression/progression';
import { createDefaultSave, defaultSettings } from '../src/storage/schema';

const BUSES: VehicleId[] = ['bus_small', 'bus_medium', 'bus_long'];

describe('bus services', () => {
  it('each tier has a route; longer buses keep access to smaller routes', () => {
    expect(BUS_ROUTES.filter((r) => routeEligible(r, 'bus_small')).map((r) => r.id)).toEqual(['neighborhood']);
    expect(BUS_ROUTES.filter((r) => routeEligible(r, 'bus_medium')).map((r) => r.id)).toEqual(['neighborhood', 'commuter']);
    expect(BUS_ROUTES.filter((r) => routeEligible(r, 'bus_long'))).toHaveLength(3);
    expect(routeEligible(BUS_ROUTES[0], 'car_compact')).toBe(false);
  });

  it('every eligible route is drivable within the bus turning radius and has a sensible length', () => {
    for (const v of BUSES) {
      for (const r of BUS_ROUTES.filter((x) => routeEligible(x, v))) {
        const m = routeMeters(r, v);
        expect(m, `${v} ${r.id}`).not.toBeNull();
        expect(m!).toBeGreaterThan(300);
        expect(m!).toBeLessThan(4500);
      }
    }
  });

  it('planned occupancy never exceeds capacity; riders board before they alight', () => {
    for (const v of BUSES) {
      const cap = VEHICLES[v].passengerSeats;
      for (const r of BUS_ROUTES) {
        for (let seed = 1; seed < 200; seed++) {
          const g = planGroups(r.stops.length, cap, seed);
          expect(maxOccupancy(g, r.stops.length)).toBeLessThanOrEqual(cap);
          for (const x of g) {
            expect(x.to).toBeGreaterThan(x.from);
            expect(x.size).toBeGreaterThan(0);
          }
          expect(g.reduce((a, x) => a + x.size, 0)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('quote is fixed by the plan formula and a route pays exactly once', () => {
    const pv = previewRoute(BUS_ROUTES[0], 'bus_small', 42);
    expect(pv.quote).toBe(quoteBus(pv.meters, pv.planned));
    expect(pv.quote).toBe(Math.round(200 + 0.6 * pv.meters + 35 * pv.planned));
    const now = Date.UTC(2026, 9, 8);
    const s0 = ensureDailyBoard(createDefaultSave(now, utcDayKey(now), defaultSettings('medium', 'en')), now).save;
    const sum = { missionId: 'bus1', routeName: 'x', fromName: 'a', toName: 'b', quote: pv.quote, stops: 3, delivered: pv.planned, avgSatisfaction: 100, clean: true, finesPaid: 0 };
    const a = settleBus(s0, sum, now);
    expect(a.save.wallet).toBe(pv.quote + Math.round(pv.quote * 0.1) * 2);
    expect(a.save.lifetime.jobs).toBe(1);
    expect(a.save.lifetime.busRoutes).toBe(1);
    expect(a.save.lifetime.passengers).toBe(pv.planned);
    expect(a.save.totalXP).toBe(120 + 40 * 3 + 25);
    const b = settleBus(a.save, sum, now);
    expect(b.duplicate).toBe(true);
    expect(b.save.wallet).toBe(a.save.wallet);
  });
});
