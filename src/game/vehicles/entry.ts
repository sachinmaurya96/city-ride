import * as THREE from 'three';
import { runtime } from '../core/runtime';
import { cabinLayout } from './cabin';
import type { VehicleSpec } from '../data/vehicles';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const span = (t: number, a: number, b: number) => ease((t - a) / (b - a));
/**
 * Walking distance profile: speed builds over the first quarter, cruises, then eases to a stop over the
 * last quarter — or, for someone who keeps walking away, holds the cruising speed to the end.
 */
export function walkEase(x: number, stop = true) {
  const t = clamp(x), r = .25, end = stop ? r : 0, v = 1 / (1 - r / 2 - end / 2);
  if (t < r) return v * t * t / (2 * r);
  if (t <= 1 - end) return v * (t - r / 2);
  return 1 - v * (1 - t) ** 2 / (2 * end);
}
/** Turn smoothly toward `target` (radians): eased, at most `maxRate` rad/s, always the short way round. */
export function turnToward(current: number, target: number, dt: number, rate = 7, maxRate = 4.5) {
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const step = d * (1 - Math.exp(-dt * rate));
  return current + Math.max(-maxRate * dt, Math.min(maxRate * dt, step));
}
export function lerpAngle(a: number, b: number, t: number) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}
/** Average walking speed (m/s) that boarding/alighting timings are stretched to; peak ≈ 1.27 m/s. */
export const WALK_SPEED = .95;
/** Phase windows of a boarding / alighting progress: [from, to] of the walk. */
export const BOARD_WALK = [0, .3] as const, ALIGHT_WALK = [.46, .95] as const;
/** Curbside passenger door (world, y = 0) of a vehicle stopped at `pose`. */
export function passengerDoorPoint(spec: VehicleSpec, pose: { x: number; z: number; heading: number }, out: THREE.Vector3) {
  const c = cabinLayout(spec);
  const doorX = spec.kind === 'car' ? c.doorX + .6 : spec.width / 2 + .6;
  const doorZ = spec.kind === 'car' ? c.seatZ : spec.kind === 'bike' ? -.2 : -.75;
  return out.set(pose.x + doorX * Math.cos(pose.heading) + doorZ * Math.sin(pose.heading), 0, pose.z - doorX * Math.sin(pose.heading) + doorZ * Math.cos(pose.heading));
}
/** Walk from the curb to a passenger door: up to two corners round the vehicle, then the door. */
export type WalkPath = { points: THREE.Vector3[]; count: number; length: number };
export const newWalkPath = (): WalkPath => ({ points: [0, 1, 2, 3].map(() => new THREE.Vector3()), count: 0, length: 0 });
/**
 * Path from `from` to the `door` (+X side) of a vehicle stopped at `pose`. When the door faces away from them
 * (the car stopped facing the other way, or across the road) they walk round the nearer end instead of through it.
 */
export function passengerWalkPath(spec: VehicleSpec, pose: { x: number; z: number; heading: number }, from: THREE.Vector3, door: THREE.Vector3, path = newWalkPath()) {
  const cos = Math.cos(pose.heading), sin = Math.sin(pose.heading);
  const local = (v: THREE.Vector3) => [(v.x - pose.x) * cos - (v.z - pose.z) * sin, (v.x - pose.x) * sin + (v.z - pose.z) * cos];
  const [fx, fz] = local(from), [dx, dz] = local(door);
  const half = spec.width / 2, cx = half + .6, ez = spec.length / 2 + .7;
  path.points[0].copy(from);
  let n = 1;
  if (fx < half) {
    // Round the front or the back, whichever is the shorter walk; skip the near corner if already past the side.
    const corners = fx > -half ? [cx] : [-cx, cx];
    const walk = (z: number) => Math.hypot(corners[0] - fx, z - fz) + (corners.length > 1 ? 2 * cx : 0) + Math.hypot(dx - cx, dz - z);
    const z = walk(ez) <= walk(-ez) ? ez : -ez;
    for (const x of corners) path.points[n++].set(pose.x + x * cos + z * sin, door.y, pose.z - x * sin + z * cos);
  }
  path.points[n++].copy(door);
  path.count = n;
  path.length = 0;
  for (let i = 1; i < n; i++) path.length += path.points[i - 1].distanceTo(path.points[i]);
  return path;
}
/** Point `f` (0..1) of the way along a walk path, by distance. */
export function pointAlongPath(path: WalkPath, f: number, out: THREE.Vector3) {
  let d = clamp(f) * path.length;
  for (let i = 1; i < path.count; i++) {
    const seg = path.points[i - 1].distanceTo(path.points[i]);
    if (d <= seg || i === path.count - 1) return out.copy(path.points[i - 1]).lerp(path.points[i], seg > 0 ? Math.min(1, d / seg) : 1);
    d -= seg;
  }
  return out.copy(path.points[0]);
}
/** Where a passenger stands along the bay's curb: negative offsets queue a party, positive ones walk away. */
export function bayWaitPoint(bay: { waitX: number; waitZ: number; heading: number }, offset: number, out: THREE.Vector3) {
  return out.set(bay.waitX + Math.sin(bay.heading) * offset, 0, bay.waitZ + Math.cos(bay.heading) * offset);
}
/**
 * Seconds per progress window, with the walk window stretched to cover `walkMeters` at a natural pace
 * (never faster than the default timing). Returns the total time and a timer → progress mapping.
 */
export function walkTimedProgress(total: number, walk: readonly [number, number], walkMeters: number, keepWalking = false) {
  const base = (walk[1] - walk[0]) * total;
  // Arriving: average WALK_SPEED; leaving: cruise at the departure pace (1.2 m/s) after speeding up.
  // Capped so a walk across the road (to a car stopped on the far side) stays brisk rather than endless.
  const seconds = Math.min(15, Math.max(base, keepWalking ? walkMeters / 1.2 / (1 - .125) : walkMeters / WALK_SPEED));
  const before = walk[0] * total, after = (1 - walk[1]) * total;
  return {
    total: before + seconds + after,
    progress(timer: number) {
      if (timer < before) return timer / total;
      if (timer < before + seconds) return walk[0] + (walk[1] - walk[0]) * (timer - before) / seconds;
      return Math.min(1, walk[1] + (timer - before - seconds) / total);
    },
  };
}
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
    vehicleEntry.approach.set(-c.doorX - 1.25, 0, c.seatZ - .8);
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
      // Keep facing the way the driver stepped away from the door.
      const c = runtime.vehicle ? cabinLayout(runtime.vehicle.spec) : null;
      vehicleEntry.outsideHeading = c ? Math.atan2(vehicleEntry.approach.x + c.doorX + .55, vehicleEntry.approach.z - c.seatZ) : -Math.PI / 2;
    }
  }
}

/** Opening precedes crossing the sill. Closing follows sitting/stepping clear. `keepWalking`: the walker carries on afterwards. */
export function entryPhase(progress: number, exit = false, keepWalking = false) {
  const t = clamp(progress);
  if (exit) return { walk: walkEase((t - ALIGHT_WALK[0]) / (ALIGHT_WALK[1] - ALIGHT_WALK[0]), !keepWalking), inside: 1 - span(t, .20, .46), door: span(t, .04, .19) * (1 - span(t, .61, .86)), reach: 1 - span(t, .20, .38), crouch: Math.sin(Math.PI * span(t, .20, .46)) };
  return { walk: walkEase((t - BOARD_WALK[0]) / (BOARD_WALK[1] - BOARD_WALK[0])), inside: span(t, .52, .80), door: span(t, .35, .50) * (1 - span(t, .84, 1)), reach: span(t, .27, .35) * (1 - span(t, .54, .68)), crouch: Math.sin(Math.PI * span(t, .52, .80)) };
}
export function entryPosition(out: THREE.Vector3, t: number, start: THREE.Vector3, door: THREE.Vector3, seat: THREE.Vector3, hipHeight: number, exit = false, keepWalking = false, path?: WalkPath) {
  const phase = entryPhase(t, exit, keepWalking);
  // `path` runs start → door; walking out it is followed backwards.
  if (path) pointAlongPath(path, exit ? 1 - phase.walk : phase.walk, out);
  else if (exit) out.copy(door).lerp(start, phase.walk);
  else out.copy(start).lerp(door, phase.walk);
  out.lerp(new THREE.Vector3(seat.x, seat.y - hipHeight, seat.z), phase.inside);
  return phase;
}
