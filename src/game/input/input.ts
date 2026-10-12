import type { DriveInput } from '../vehicles/vehicleController';

export type InputAction = 'camera' | 'horn' | 'recover' | 'context' | 'pause' | 'map' | 'door' | 'decline' | 'mute' | 'fuel' | 'endTestDrive';

const KEY_ACTIONS: Record<string, InputAction> = {
  KeyC: 'camera',
  KeyH: 'horn',
  KeyR: 'recover',
  KeyE: 'context',
  Enter: 'context',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'map',
  KeyF: 'door',
  KeyX: 'decline',
  KeyV: 'mute',
  KeyG: 'fuel',
  KeyT: 'endTestDrive',
};

/** Shortcut labels shown as corner badges on desktop buttons (single source with KEY_ACTIONS). */
export const SHORTCUTS = { accept: 'E', decline: 'X', pause: 'Esc', map: 'M', horn: 'H', camera: 'C', mute: 'V', door: 'F', recover: 'R', brake: 'Space', fuel: 'G', endTestDrive: 'T' } as const;

/** Joystick creep top speed: 8 km/h. */
export const JOYSTICK_CREEP = 8 / 3.6;

const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);

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
  /** Steering, plus a vertical slow-speed creep (forward/reverse) for parking and getting unstuck. */
  joystick = { x: 0, y: 0, active: false };
  /** Alternative preset: separate steering slider and pedals. */
  pedals = { steer: 0, gas: 0, brake: 0 };
  brakeButton = false;
  /** Steering amount for every control source; 1 preserves the full default turning range. */
  steerSensitivity = 1;
  /** When false (e.g. menus open) drive input is zero. */
  enabled = true;
  camera = { dx: 0, dy: 0, lastInteraction: -Infinity, dragging: false };
  private listeners = new Set<(a: InputAction) => void>();
  private resetListeners = new Set<() => void>();
  private attached = false;
  /** The scene owns door hit testing; the gesture layer forwards taps through its overlay. */
  sceneTap: ((x: number, y: number, commit: boolean) => boolean) | null = null;

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

  /** Gesture owners and visuals must release together with the central input buffer. */
  onReset(fn: () => void) {
    this.resetListeners.add(fn);
    return () => void this.resetListeners.delete(fn);
  }

  /** Zero every held input (blur, pause, orientation change, lost pointer capture). */
  reset() {
    this.keys.clear();
    this.resetTouch();
  }

  /** Releasing the last finger must not cancel held keyboard acceleration. */
  resetTouch() {
    this.joystick.x = 0;
    this.joystick.y = 0;
    this.joystick.active = false;
    this.pedals.steer = 0;
    this.pedals.gas = 0;
    this.pedals.brake = 0;
    this.brakeButton = false;
    this.camera.dragging = false;
    for (const fn of this.resetListeners) fn();
  }

  /** Thumb offset with dead zones. Up (+y) creeps forward, down creeps in reverse; the wider vertical dead zone keeps pure steering from creeping. */
  setSteering(rawX: number, rawY = 0) {
    const zone = (raw: number, dead: number) => { const v = Math.max(-1, Math.min(1, raw)); return Math.abs(v) < dead ? 0 : Math.sign(v) * (Math.abs(v) - dead) / (1 - dead); };
    this.joystick.x = zone(rawX, .12);
    this.joystick.y = zone(rawY, .3);
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
      out.powerBrake = false;
      return out;
    }
    const k = this.keys;
    const kbSteer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const kbThrottle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const kbBrake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const touchSteer = this.joystick.x + this.pedals.steer;
    // Apply the same turning range to keys and touch. Clamp the combined intent first
    // so holding a key and the joystick together cannot bypass a gentler setting.
    const steer = Math.max(-1, Math.min(1, kbSteer + touchSteer));
    out.steer = Math.max(-1, Math.min(1, steer * this.steerSensitivity));
    out.throttle = Math.max(kbThrottle, this.pedals.gas);
    out.brake = Math.max(kbBrake, this.pedals.brake);
    out.speedLimit = undefined;
    // Joystick creep only applies while the full-speed pedals/keys are idle.
    if (out.throttle === 0 && out.brake === 0 && this.joystick.y !== 0) {
      if (this.joystick.y > 0) out.throttle = .35 + .4 * this.joystick.y; else out.brake = .35 - .4 * this.joystick.y;
      out.speedLimit = JOYSTICK_CREEP;
    }
    out.handbrake = false;
    out.powerBrake = this.brakeButton || k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight');
    return out;
  }

  get hasDriveInput() {
    return this.keys.size > 0 || this.joystick.active || this.pedals.gas > 0 || this.pedals.brake > 0;
  }
}

export const input = new InputManager();
