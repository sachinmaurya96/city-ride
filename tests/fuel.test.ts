import { afterEach, describe, expect, it } from 'vitest';
import { FuelTank, FuelSystem, FUEL, fuelQuote } from '../src/game/vehicles/fuel';
import { createDefaultSave, defaultSettings, validateSave } from '../src/storage/schema';
import { FUEL_STATIONS } from '../src/game/data/cityMap';
import { runtime } from '../src/game/core/runtime';
import { useGame } from '../src/app/store';

describe('fuel consumption and refilling', () => {
  it('uses fuel by distance, including reversing, and does not drain while parked', () => {
    const tank = new FuelTank();
    tank.step(1, 600, 'bike', false);
    expect(tank.percent).toBeCloseTo(90);
    tank.step(600, 0, 'bike', false);
    expect(tank.percent).toBeCloseTo(90);
    tank.step(1, 600, 'bike', false);
    expect(tank.percent).toBeCloseTo(80);
    tank.step(1, 9000, 'bike', false);
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

describe('fuel purchases', () => {
  afterEach(() => { runtime.vehicle = null; useGame.setState({ appState: 'MAIN_MENU', overlay: null }); });
  function pump(wallet = 5000) {
    const save = createDefaultSave(Date.now(), '2026-10-09', defaultSettings('low', 'en'));
    save.wallet = wallet; save.fuelByVehicle.car_compact = 20;
    useGame.setState({ save, appState: 'PLAYING', overlay: null });
    runtime.vehicleId = 'car_compact';
    runtime.vehicle = { horizontalSpeed: () => 0, stopImmediately: () => {} } as unknown as NonNullable<typeof runtime.vehicle>;
    const bay = FUEL_STATIONS[0]; runtime.pose.x = bay.x; runtime.pose.z = bay.z;
    const system = new FuelSystem(); system.step(.6); return system;
  }
  it('opens once per visit and dismissing spends nothing', () => {
    const system = pump(); expect(useGame.getState().overlay).toBe('fuel'); expect(system.percent).toBe(20);
    system.dismiss(); system.step(10);
    expect(useGame.getState().overlay).toBeNull(); expect(useGame.getState().save.wallet).toBe(5000); expect(system.percent).toBe(20);
  });
  it('calculates the requested tank target and charges only for added liters', () => {
    expect(fuelQuote(20, 50, 'car')).toEqual({ target: 50, liters: 15, cost: 1500 });
    expect(fuelQuote(60, 50, 'car').liters).toBe(0);
  });
  it('confirmation atomically saves fuel and money and blocks duplicate clicks', () => {
    const system = pump(); expect(system.purchase(50)).toBe(true);
    expect(system.percent).toBe(50); expect(useGame.getState().save.fuelByVehicle.car_compact).toBe(50);
    expect(useGame.getState().save.wallet).toBe(3500); expect(system.purchase(100)).toBe(false);
    expect(useGame.getState().save.wallet).toBe(3500);
  });
  it('insufficient cash changes neither fuel nor wallet, and a smaller fill remains available', () => {
    const system = pump(300); expect(system.purchase(100)).toBe(false); expect(system.percent).toBe(20);
    expect(useGame.getState().save.wallet).toBe(300); expect(system.purchase(25)).toBe(true);
    expect(system.percent).toBe(25); expect(useGame.getState().save.wallet).toBe(50);
  });
  it('rejects purchases away from the pump, for another vehicle, or with an invalid amount', () => {
    const system = pump(); expect(system.purchase(NaN)).toBe(false);
    runtime.pose.x += 30; expect(system.purchase(50)).toBe(false);
    runtime.pose.x -= 30; runtime.vehicleId = 'bike_basic'; expect(system.purchase(50)).toBe(false);
    expect(useGame.getState().save.wallet).toBe(5000);
  });
});
