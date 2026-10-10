import { afterEach, expect, it } from 'vitest';
import { input, JOYSTICK_CREEP } from '../src/game/input/input';
import type { DriveInput } from '../src/game/vehicles/vehicleController';

const drive = () => input.getDrive({ steer: 0, throttle: 0, brake: 0, handbrake: false } as DriveInput);
afterEach(() => { input.reset(); input.enabled = true; input.steerSensitivity = 1; });

it('steers independently of the accelerator and reverse pedals, including power brake', () => {
  input.enabled = true; input.setSteering(-1);
  expect(drive()).toMatchObject({ steer: -1, throttle: 0, brake: 0 });
  input.pedals.gas = 1; input.brakeButton = true;
  expect(drive()).toMatchObject({ steer: -1, throttle: 1, powerBrake: true });
  input.setSteering(1);
  expect(drive()).toMatchObject({ steer: 1, throttle: 1, powerBrake: true });
  input.pedals.gas = 0;
  expect(drive()).toMatchObject({ throttle: 0, brake: 0, powerBrake: true });
  input.brakeButton = false; input.pedals.brake = 1;
  expect(drive()).toMatchObject({ steer: 1, throttle: 0, brake: 1 });
  input.reset(); expect(drive()).toMatchObject({ steer: 0, throttle: 0, brake: 0, powerBrake: false });
});

it('joystick up/down creeps forward/reverse at a capped speed, and pedals override it', () => {
  input.enabled = true;
  input.setSteering(0, .2);
  expect(drive()).toMatchObject({ throttle: 0, brake: 0, speedLimit: undefined });
  input.setSteering(.5, 1);
  expect(drive()).toMatchObject({ throttle: .75, brake: 0, speedLimit: JOYSTICK_CREEP });
  expect(drive().steer).toBeGreaterThan(0);
  input.setSteering(0, -1);
  expect(drive()).toMatchObject({ throttle: 0, brake: .75, speedLimit: JOYSTICK_CREEP });
  input.pedals.gas = 1;
  expect(drive()).toMatchObject({ throttle: 1, brake: 0, speedLimit: undefined });
});
