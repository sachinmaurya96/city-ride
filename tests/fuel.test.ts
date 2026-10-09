import { describe, expect, it } from 'vitest';
import { FuelTank, FUEL } from '../src/game/vehicles/fuel';
import { createDefaultSave, defaultSettings, validateSave } from '../src/storage/schema';

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

  it('requires a continuous stop at a pump and interrupts refilling when driving away', () => {
    const tank = new FuelTank();
    tank.percent = 25;
    tank.step(FUEL.stopHold * 0.5, 0, 'bike', true);
    expect(tank.percent).toBe(25);
    tank.step(0.1, 0, 'bike', false);
    tank.step(FUEL.stopHold * 0.5, 0, 'bike', true);
    expect(tank.percent).toBe(25);
    tank.step(FUEL.stopHold, 0, 'bike', true);
    expect(tank.refilling).toBe(true);
    expect(tank.percent).toBeGreaterThan(25);
    tank.step(10, 0, 'bike', true);
    expect(tank.percent).toBe(100);
    tank.step(1, 60, 'bike', false);
    expect(tank.refilling).toBe(false);
    expect(tank.percent).toBeLessThan(100);
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
