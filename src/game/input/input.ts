import type { DriveInput } from '../vehicles/vehicleController';

export type InputAction = 'camera' | 'horn' | 'recover' | 'context' | 'pause' | 'map';

const KEY_ACTIONS: Record<string, InputAction> = {
  KeyC: 'camera',
  KeyH: 'horn',
  KeyR: 'recover',
  KeyE: 'context',
  Enter: 'context',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'map',
};

const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Central input buffer. Keyboard, joystick, pedals and UI buttons all feed one DriveInput.
 * Camera drag deltas are kept separately so camera gestures can never change throttle/steering.
 */
class InputManager {
  private keys = new Set<string>();
  /** Joystick vector after dead zone and circle-to-square mapping; y>0 = up. */
  joystick = { x: 0, y: 0, active: false };
  /** Alternative preset: separate steering slider and pedals. */
  pedals = { steer: 0, gas: 0, brake: 0 };
  brakeButton = false;
  steerSensitivity = 1;
  /** When false (e.g. menus open) drive input is zero. */
  enabled = true;
  camera = { dx: 0, dy: 0, lastInteraction: -Infinity, dragging: false };
  private listeners = new Set<(a: InputAction) => void>();
  private attached = false;

  attach() {
    if (this.attached) return () => {};
    this.attached = true;
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (DRIVE_KEYS.has(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
      const action = KEY_ACTIONS[e.code];
      if (action && !e.repeat) this.emit(action);
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    const blur = () => this.reset();
    const vis = () => {
      if (document.visibilityState !== 'visible') this.reset();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('orientationchange', blur);
    return () => {
      this.attached = false;
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('orientationchange', blur);
    };
  }

  onAction(fn: (a: InputAction) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  emit(a: InputAction) {
    for (const fn of this.listeners) fn(a);
  }

  /** Zero every held input (blur, pause, orientation change, lost pointer capture). */
  reset() {
    this.keys.clear();
    this.joystick.x = 0;
    this.joystick.y = 0;
    this.joystick.active = false;
    this.pedals.steer = 0;
    this.pedals.gas = 0;
    this.pedals.brake = 0;
    this.brakeButton = false;
    this.camera.dragging = false;
  }

  /** Raw joystick offset (-1..1 each, y up) → dead zone + circle-to-square mapping. */
  setJoystick(rawX: number, rawY: number) {
    const mag = Math.min(1, Math.hypot(rawX, rawY));
    const DEAD = 0.12;
    if (mag < DEAD) {
      this.joystick.x = 0;
      this.joystick.y = 0;
      return;
    }
    const scaled = (mag - DEAD) / (1 - DEAD);
    const nx = rawX / mag;
    const ny = rawY / mag;
    // Circle → square so a diagonal push still gives full throttle and full steer.
    const m = Math.max(Math.abs(nx), Math.abs(ny));
    this.joystick.x = Math.max(-1, Math.min(1, (nx / m) * scaled));
    this.joystick.y = Math.max(-1, Math.min(1, (ny / m) * scaled));
  }

  addCameraDrag(dx: number, dy: number, now: number) {
    this.camera.dx += dx;
    this.camera.dy += dy;
    this.camera.lastInteraction = now;
  }

  consumeCamera() {
    const d = { dx: this.camera.dx, dy: this.camera.dy };
    this.camera.dx = 0;
    this.camera.dy = 0;
    return d;
  }

  getDrive(out: DriveInput): DriveInput {
    if (!this.enabled) {
      out.steer = 0;
      out.throttle = 0;
      out.brake = 0;
      out.handbrake = false;
      return out;
    }
    const k = this.keys;
    const kbSteer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const kbThrottle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const kbBrake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const touchSteer = this.joystick.x + this.pedals.steer;
    const steer = kbSteer + touchSteer * this.steerSensitivity;
    out.steer = Math.max(-1, Math.min(1, steer));
    out.throttle = Math.max(kbThrottle, Math.max(0, this.joystick.y), this.pedals.gas);
    out.brake = Math.max(kbBrake, Math.max(0, -this.joystick.y), this.pedals.brake);
    out.handbrake = this.brakeButton || k.has('Space');
    if (out.handbrake) out.throttle = 0;
    return out;
  }

  get hasDriveInput() {
    return this.keys.size > 0 || this.joystick.active || this.pedals.gas > 0 || this.pedals.brake > 0;
  }
}

export const input = new InputManager();
