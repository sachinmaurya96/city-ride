import { afterEach, expect, it, vi } from 'vitest';
import { input, JOYSTICK_CREEP } from '../src/game/input/input';
import type { DriveInput } from '../src/game/vehicles/vehicleController';

const drive = () => input.getDrive({ steer: 0, throttle: 0, brake: 0, handbrake: false } as DriveInput);
let detachKeyboard: (() => void) | undefined;
afterEach(() => { detachKeyboard?.(); detachKeyboard = undefined; input.reset(); input.enabled = true; input.steerSensitivity = 1; vi.unstubAllGlobals(); });

function keyboard() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('HTMLElement', class {});
  detachKeyboard = input.attach();
  return (code: string, pressed = true) => window.dispatchEvent(Object.assign(new Event(pressed ? 'keydown' : 'keyup', { cancelable: true }), { code, repeat: false }));
}

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

it.each([['ArrowLeft', -1], ['KeyA', -1], ['ArrowRight', 1], ['KeyD', 1]] as const)('applies gentler steering to %s without reducing keyboard acceleration or power brake', (key, direction) => {
  const press = keyboard();
  input.steerSensitivity = .25;
  press(key); press('ArrowUp'); press('Space');
  expect(drive()).toMatchObject({ steer: direction * .25, throttle: 1, brake: 0, powerBrake: true });
  press(key, false);
  expect(drive()).toMatchObject({ steer: 0, throttle: 1, powerBrake: true });
});

it.each([.25, .5, 1])('uses the same %s turning range for joystick and steering-pad input', (sensitivity) => {
  input.steerSensitivity = sensitivity;
  input.setSteering(1);
  input.pedals.gas = 1;
  expect(drive()).toMatchObject({ steer: sensitivity, throttle: 1 });
  input.setSteering(0);
  input.pedals.steer = -1;
  expect(drive()).toMatchObject({ steer: -sensitivity, throttle: 1 });
});

it('updates held-key steering immediately and keeps mixed input within the chosen turning range', () => {
  const press = keyboard();
  press('ArrowRight');
  expect(drive().steer).toBe(1);
  input.steerSensitivity = .5;
  expect(drive().steer).toBe(.5);
  input.setSteering(1); input.pedals.steer = 1;
  expect(drive().steer).toBe(.5);
  input.setSteering(-1); input.pedals.steer = 0;
  expect(drive().steer).toBe(0);
});

it('keeps sharper analog sensitivity and the full-input steering cap', () => {
  input.steerSensitivity = 1.6;
  input.pedals.steer = .5;
  expect(drive().steer).toBeCloseTo(.8);
  input.pedals.steer = 1;
  expect(drive().steer).toBe(1);
  input.enabled = false;
  expect(drive()).toMatchObject({ steer: 0, throttle: 0, brake: 0 });
});
