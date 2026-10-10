import { expect, it } from 'vitest';
import { ownLocalCars } from '../src/app/localCars';
import { VEHICLES, VEHICLE_ORDER } from '../src/game/data/vehicles';
import { createDefaultSave, defaultSettings, validateSave, type SaveData } from '../src/storage/schema';
import { equipVehicle } from '../src/game/progression/progression';

const fresh = () => createDefaultSave(1000, '2026-10-11', defaultSettings('medium', 'en'));

it.each(['localhost', '127.0.0.1', '[::1]', '::1'])('owns every playable car on %s without spending cash or changing the equipped vehicle', hostname => {
  const save = fresh();
  const unlocked = ownLocalCars(save, hostname);
  const cars = VEHICLE_ORDER.filter(id => VEHICLES[id].kind === 'car' && !VEHICLES[id].npcOnly);
  expect(save.ownedVehicleIds).toEqual(['bike_basic']);
  expect(unlocked.ownedVehicleIds).toEqual(['bike_basic', ...cars]);
  expect(unlocked).toMatchObject({ wallet: save.wallet, totalXP: save.totalXP, equippedVehicleId: save.equippedVehicleId, profileId: save.profileId });
  expect(unlocked.revision).toBe(save.revision + 1);
  expect(validateSave(unlocked).ok).toBe(true);
  for (const id of cars) expect(equipVehicle(unlocked, id, 2000).error, id).toBeUndefined();
});

it.each(['playgama.com', 'localhost.example.com', '192.168.1.10', ''])('preserves ordinary ownership on %s', hostname => {
  const save = fresh();
  expect(ownLocalCars(save, hostname)).toBe(save);
});

it('preserves an existing profile and does not duplicate ownership or change its revision again on reload', () => {
  const save: SaveData = { ...fresh(), wallet: 1234, totalXP: 500, equippedVehicleId: 'bmw_i8', ownedVehicleIds: ['bike_basic', 'bmw_i8'] };
  const unlocked = ownLocalCars(save, 'localhost');
  expect(unlocked).toMatchObject({ wallet: 1234, totalXP: 500, equippedVehicleId: 'bmw_i8' });
  expect(unlocked.ownedVehicleIds.filter(id => id === 'bmw_i8')).toHaveLength(1);
  expect(Object.values(VEHICLES).filter(spec => spec.npcOnly).some(spec => unlocked.ownedVehicleIds.includes(spec.id))).toBe(false);
  expect(ownLocalCars(unlocked, 'localhost')).toBe(unlocked);
});
