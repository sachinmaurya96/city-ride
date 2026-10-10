import { afterEach, describe, expect, it } from 'vitest';
import { FuelTank, FuelSystem, FUEL, chargeFullTank, fuelBill } from '../src/game/vehicles/fuel';
import { createDefaultSave, defaultSettings, validateSave } from '../src/storage/schema';
import { FUEL_STATIONS, SEGMENT_BY_ID, segmentPoint, laneOffset } from '../src/game/data/cityMap';
import { runtime } from '../src/game/core/runtime';
import { useGame } from '../src/app/store';

describe('fuel consumption and refilling', () => {
  it('uses fuel by distance, including reversing, and does not drain while parked', () => {
    const tank = new FuelTank();
    tank.step(1, 600, 'bike', false);
    expect(tank.percent).toBeCloseTo(97.5);
    tank.step(600, 0, 'bike', false);
    expect(tank.percent).toBeCloseTo(97.5);
    tank.step(1, 600, 'bike', false);
    expect(tank.percent).toBeCloseTo(95);
    tank.step(1, 30000, 'bike', false);
    expect(tank.percent).toBe(0);
  });

  it('allows four previous car-tank ranges per full tank', () => {
    const tank = new FuelTank();
    tank.step(60, 4500, 'car', false);
    expect(tank.percent).toBe(75);
    tank.step(180, 13500, 'car', false);
    expect(tank.percent).toBe(0);
  });

  it('stopping in a pump bay waits for confirmation and never refills automatically', () => {
    const tank = new FuelTank();
    tank.percent = 25;
    tank.step(FUEL.stopHold * 0.5, 0, 'bike', true);
    expect(tank.percent).toBe(25);
    tank.step(0.1, 0, 'bike', false);
    tank.step(FUEL.stopHold * 0.5, 0, 'bike', true);
    expect(tank.percent).toBe(25);
    tank.step(FUEL.stopHold, 0, 'bike', true);
    expect(tank.refilling).toBe(false);
    expect(tank.percent).toBe(25);
    tank.step(10, 0, 'bike', true);
    expect(tank.percent).toBe(25);
    tank.step(1, 60, 'bike', false);
    expect(tank.refilling).toBe(false);
    expect(tank.percent).toBeLessThan(25);
  });

  it('preserves older saves and independent tank levels per vehicle', () => {
    const save = createDefaultSave(Date.now(), '2026-10-09', defaultSettings('low', 'en'));
    const oldSave: Record<string, unknown> = { ...save };
    delete oldSave.fuelByVehicle;
    const migrated = validateSave(oldSave);
    expect(migrated.ok).toBe(true);
    if (migrated.ok) expect(migrated.data.fuelByVehicle).toEqual({});
    save.fuelByVehicle = { bike_basic: 27.5, car_compact: 81 };
    const restored = validateSave(JSON.parse(JSON.stringify(save)));
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.data.fuelByVehicle).toEqual(save.fuelByVehicle);
  });
});

describe('free pump refueling and empty-tank navigation', () => {
  afterEach(() => { runtime.vehicle = null; runtime.pendingRecovery = null; useGame.setState({ appState: 'MAIN_MENU', overlay: null }); });
  function pump(wallet = 0) {
    const save = createDefaultSave(Date.now(), '2026-10-09', defaultSettings('low', 'en'));
    save.wallet = wallet; save.fuelByVehicle.car_compact = 20;
    useGame.setState({ save, appState: 'PLAYING', overlay: null });
    runtime.vehicleId = 'car_compact';
    runtime.vehicle = { horizontalSpeed: () => 0, stopImmediately: () => {} } as unknown as NonNullable<typeof runtime.vehicle>;
    const bay = FUEL_STATIONS[0]; runtime.pose = { x: bay.x, y: .5, z: bay.z, heading: bay.heading, fx: Math.sin(bay.heading), fz: Math.cos(bay.heading) };
    const system = new FuelSystem(); system.step(.6); return system;
  }
  it('opens once per visit, and canceling does not add fuel or change cash', () => {
    const system = pump(); expect(useGame.getState().overlay).toBe('fuel'); expect(system.percent).toBe(20);
    system.dismiss(); system.step(10);
    expect(useGame.getState().overlay).toBeNull(); expect(useGame.getState().save.wallet).toBe(0); expect(system.percent).toBe(20);
  });
  it.each([0, 300, 5000])('fills to 100%% with cash %i, charging ₹60 or recording it as due, with no duplicate confirmation', wallet => {
    const system = pump(wallet); expect(system.fillTank()).toBe(true);
    expect(system.percent).toBe(100); expect(useGame.getState().save.fuelByVehicle.car_compact).toBe(100);
    expect(useGame.getState().save.wallet).toBe(Math.max(0, wallet - 60));
    expect(useGame.getState().save.fuelDebt).toBe(wallet >= 60 ? 0 : 60);
    expect(system.fillTank()).toBe(false);
    system.step(5); expect(useGame.getState().overlay).toBeNull();
  });
  it('charges earlier unpaid fuel on the next refuel, carrying over whatever cash cannot cover', () => {
    const base = useGame.getState().save;
    let s = chargeFullTank({ ...base, wallet: 0, fuelDebt: 0, transactionHistory: [] }, 'car_compact', 1);
    expect(s).toMatchObject({ wallet: 0, fuelDebt: 60 });
    expect(fuelBill({ ...s, wallet: 100 })).toMatchObject({ total: 120, paid: 100, owed: 20 });
    s = chargeFullTank({ ...s, wallet: 100 }, 'car_compact', 2);
    expect(s).toMatchObject({ wallet: 0, fuelDebt: 20 });
    s = chargeFullTank({ ...s, wallet: 500 }, 'car_compact', 3);
    expect(s).toMatchObject({ wallet: 420, fuelDebt: 0 });
    expect(s.transactionHistory.filter(t => t.kind === 'fuel').map(t => t.cash)).toEqual([-100, -80]);
  });
  it('does not offer filling on the travel lane or curb parking strip', () => {
    const system = pump(), station = FUEL_STATIONS[0], seg = SEGMENT_BY_ID.get(station.segmentId)!;
    system.dismiss();
    for (const offset of [laneOffset(seg, 0), laneOffset(seg, seg.lanes - 1), 0]) {
      const [x, z] = segmentPoint(seg, station.s, offset); runtime.pose.x = x; runtime.pose.z = z;
      system.step(10); expect(system.inBay).toBe(false); expect(system.openPump()).toBe(false);
      expect(useGame.getState().overlay).toBeNull(); expect(system.percent).toBe(20);
    }
  });
  it('rejects filling after moving away or switching the vehicle', () => {
    const system = pump(); runtime.pose.x += 40; expect(system.fillTank()).toBe(false);
    runtime.pose.x -= 40; runtime.vehicleId = 'bike_basic'; expect(system.fillTank()).toBe(false);
    expect(useGame.getState().save.wallet).toBe(0); expect(system.percent).toBe(20);
  });
  it('routes to a real pump, offers towing when empty, and the tow arrives refueled', () => {
    const system = pump(); system.dismiss(); system.tank.percent = 0;
    runtime.pose.x += 65; system.step(.6);
    expect(system.navigateToPump()).toBe(true);
    const station = system.navigation!.targetBay, last = system.navigation!.route.points.at(-1)!;
    expect(last).toEqual([station.x, station.z]); expect(system.towToPump()).toBe(true);
    expect(runtime.pendingRecovery).toEqual({ x: station.x, z: station.z, heading: station.heading });
    expect(system.percent).toBe(100); expect(useGame.getState().save.fuelByVehicle[runtime.vehicleId]).toBe(100);
    expect(useGame.getState().overlay).toBeNull(); expect(system.navigation).toBeNull();
    runtime.pose.x = station.x; runtime.pose.z = station.z; runtime.pendingRecovery = null; system.step(.6);
    expect(useGame.getState().overlay).toBeNull();
  });
  it('keeps the selected petrol station when rerouting after a detour', () => {
    const system = pump(); system.dismiss();
    expect(system.navigateToPump()).toBe(true);
    const station = system.navigation!.targetBay;
    runtime.pose.x = 400; runtime.pose.z = 400; system.step(.3);
    expect(system.navigation!.targetBay.id).toBe(station.id);
    expect(system.navigation!.route.points.at(-1)).toEqual([station.x, station.z]);
  });
});
