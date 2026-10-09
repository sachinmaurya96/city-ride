import * as THREE from 'three';
import { runtime } from '../core/runtime';
import { cabinLayout } from './cabin';
import type { VehicleSpec } from '../data/vehicles';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const span = (t: number, a: number, b: number) => ease((t - a) / (b - a));
export const DRIVER_ENTRY_SECONDS = 5.2;
export const CAR_BOARD_SECONDS = 5.2;
export const CAR_ALIGHT_SECONDS = 4.8;
export type DriverMode = 'entering' | 'seated' | 'exiting' | 'outside';
export const vehicleEntry = { active: false, progress: 1, doorOpen: 0, mode: 'seated' as DriverMode,
  outside: new THREE.Vector3(), approach: new THREE.Vector3(), outsideHeading: 0 };

export function resetVehicleEntry(enter: boolean, spec: VehicleSpec | undefined = runtime.vehicle?.spec) {
  const c = spec ? cabinLayout(spec) : null;
  vehicleEntry.approach.set(c ? -c.doorX - .95 : -2, 0, c ? c.seatZ - 1.2 : -1);
  vehicleEntry.outside.copy(vehicleEntry.approach);
  vehicleEntry.mode = enter ? 'entering' : 'seated';
  vehicleEntry.active = enter;
  vehicleEntry.progress = enter ? 0 : 1;
  vehicleEntry.doorOpen = 0;
  vehicleEntry.outsideHeading = 0;
}

export function requestDriverDoor(): 'ok' | 'moving' | 'busy' | 'far' {
  const v = runtime.vehicle;
  if (!v || v.spec.kind !== 'car' || vehicleEntry.active || v.holdBrake) return 'busy';
  if (v.horizontalSpeed() > .8) return 'moving';
  const c = cabinLayout(v.spec);
  if (vehicleEntry.mode === 'outside') {
    if (Math.hypot(vehicleEntry.outside.x + c.doorX, vehicleEntry.outside.z - c.seatZ) > 3) return 'far';
    vehicleEntry.approach.copy(vehicleEntry.outside);
    vehicleEntry.mode = 'entering';
  } else {
    vehicleEntry.mode = 'exiting';
    vehicleEntry.approach.set(-c.doorX - .95, 0, c.seatZ - .4);
  }
  v.stopImmediately();
  vehicleEntry.progress = 0;
  vehicleEntry.active = true;
  return 'ok';
}

export function advanceVehicleEntry(dt: number) {
  if (!vehicleEntry.active) return;
  const exit = vehicleEntry.mode === 'exiting';
  vehicleEntry.progress = Math.min(1, vehicleEntry.progress + dt / (exit ? CAR_ALIGHT_SECONDS : DRIVER_ENTRY_SECONDS));
  vehicleEntry.doorOpen = entryPhase(vehicleEntry.progress, exit).door;
  if (vehicleEntry.progress >= 1) {
    vehicleEntry.active = false;
    vehicleEntry.mode = exit ? 'outside' : 'seated';
    if (exit) {
      vehicleEntry.outside.copy(vehicleEntry.approach);
      vehicleEntry.outsideHeading = -Math.PI / 2;
    }
  }
}

/** Opening precedes crossing the sill. Closing follows sitting/stepping clear. */
export function entryPhase(progress: number, exit = false) {
  const t = clamp(progress);
  if (exit) return { walk: span(t, .46, .95), inside: 1 - span(t, .20, .46), door: span(t, .04, .19) * (1 - span(t, .61, .86)), reach: 1 - span(t, .20, .38), crouch: Math.sin(Math.PI * span(t, .20, .46)) };
  return { walk: span(t, 0, .30), inside: span(t, .52, .80), door: span(t, .35, .50) * (1 - span(t, .84, 1)), reach: span(t, .27, .35) * (1 - span(t, .54, .68)), crouch: Math.sin(Math.PI * span(t, .52, .80)) };
}
export function entryPosition(out: THREE.Vector3, t: number, start: THREE.Vector3, door: THREE.Vector3, seat: THREE.Vector3, hipHeight: number, exit = false) {
  const phase = entryPhase(t, exit);
  if (exit) out.copy(door).lerp(start, phase.walk);
  else out.copy(start).lerp(door, phase.walk);
  out.lerp(new THREE.Vector3(seat.x, seat.y - hipHeight, seat.z), phase.inside);
  return phase;
}
