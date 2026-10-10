import { beforeEach, expect, it } from 'vitest';
import { useGame } from '../src/app/store';
import { canTestDrive, endTestDrive, startTestDrive, stepTestDrive, TEST_DRIVE_SECONDS } from '../src/game/progression/testDrive';

beforeEach(() => {
  const st = useGame.getState();
  st.setTestDrive(null); st.setApp('PLAYING');
  st.commit({ ...st.save, ownedVehicleIds: ['bike_basic'], equippedVehicleId: 'bike_basic', mission: null, wallet: 0 }, false);
});

it('drives an unowned car free for one minute of play time, then hands the own vehicle back', () => {
  expect(startTestDrive('bmw_i8')).toBe(true);
  expect(useGame.getState().testDrive).toEqual({ vehicleId: 'bmw_i8', secondsLeft: TEST_DRIVE_SECONDS });
  expect(startTestDrive('mclaren_p1')).toBe(false);
  useGame.getState().setApp('MAIN_MENU'); stepTestDrive(30);
  expect(useGame.getState().testDrive!.secondsLeft).toBe(60);
  useGame.getState().setApp('PLAYING');
  for (let i = 0; i < 59 * 4; i++) stepTestDrive(.25);
  expect(useGame.getState().testDrive!.secondsLeft).toBe(1);
  stepTestDrive(1.1);
  const st = useGame.getState();
  expect(st.testDrive).toBeNull();
  expect(st.save).toMatchObject({ wallet: 0, ownedVehicleIds: ['bike_basic'], equippedVehicleId: 'bike_basic' });
});

it('is not offered for owned cars, NPC-only cars or during a ride, and can be ended early', () => {
  const st = useGame.getState();
  st.commit({ ...st.save, ownedVehicleIds: ['bike_basic', 'bmw_i8'] }, false);
  expect(canTestDrive('bmw_i8')).toBe(false);
  expect(canTestDrive('police_car')).toBe(false);
  expect(startTestDrive('supra_a80')).toBe(true);
  endTestDrive();
  expect(useGame.getState().testDrive).toBeNull();
});
