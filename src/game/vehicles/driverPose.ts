import * as THREE from 'three';
import type { Actor } from '../render/CharacterActor';

/** What a seated car driver holds and rests on, in the car's own space. */
export interface DriverSeat {
  /** The car's steering wheel (rim centre, +Z toward the driver, +Y = 12 o'clock); null: an unmodelled interior. */
  wheel: THREE.Object3D | null;
  /** Rim radius, and a stand-in wheel frame used when the interior has no wheel. */
  radius: number;
  fallback: THREE.Matrix4;
  /** Driver hip (car space), footwell floor height. */
  hip: THREE.Vector3;
  floor: number;
}

/** Visual steering-wheel turn at full lock (rad): about a fifth of a turn each way. */
export const WHEEL_LOCK = 1.25;
/** Hand positions on the rim: about 9:30 (left hand) and 2:30 (right hand), radians from 3 o'clock. */
const GRIP = [Math.PI - .26, .26];
const target = new THREE.Vector3(), current = new THREE.Vector3(), pole = new THREE.Vector3(), carQ = new THREE.Quaternion(), turn = new THREE.Quaternion(), shoulder = new THREE.Vector3();
const frame = new THREE.Matrix4(), spin = new THREE.Matrix4(), Z_AXIS = new THREE.Vector3(0, 0, 1);

/** A stand-in wheel ahead of the hip for interiors without one (rim radius .17). */
export function fallbackWheelFrame(hip: THREE.Vector3) {
  const z = new THREE.Vector3(0, .3, -.95).normalize(), y = new THREE.Vector3(0, 1, 0).addScaledVector(z, -z.y).normalize();
  return new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z).setPosition(hip.x, hip.y + .33, hip.z + .5);
}

/**
 * After the seated pose: turn the steering wheel with the steering, keep both hands on its rim (so they turn with
 * it), plant the feet on the footwell floor with the knees bent, and return the reach to the wheel (arm lengths),
 * which the caller feeds back as forward lean so the driver sits back but never over-stretches.
 */
export function holdSteeringWheel(actor: Actor, car: THREE.Object3D, seat: DriverSeat, steer: number, scale: number, weight = 1) {
  const angle = -THREE.MathUtils.clamp(steer, -1, 1) * WHEEL_LOCK;
  car.getWorldQuaternion(carQ);
  turn.setFromAxisAngle(Z_AXIS, angle);
  if (seat.wheel) {
    const rest = seat.wheel.userData.rest as number[] | undefined;
    if (rest) seat.wheel.quaternion.fromArray(rest).multiply(turn);
    seat.wheel.updateWorldMatrix(true, false);
    frame.copy(seat.wheel.matrixWorld);
  } else frame.multiplyMatrices(car.matrixWorld, seat.fallback).multiply(spin.makeRotationFromQuaternion(turn));
  let reach = 0;
  for (const side of [1, -1] as const) {
    const a = GRIP[side > 0 ? 0 : 1];
    // Palms on the rim, a hand's thickness toward the driver; blended in while settling into the seat.
    target.set(Math.cos(a) * seat.radius, Math.sin(a) * seat.radius, .03).applyMatrix4(frame);
    if (weight < 1 && actor.limb(side > 0 ? 'handL' : 'handR', current)) target.lerpVectors(current, target, weight);
    const arm = actor.arm(side, shoulder);
    if (arm > 0) reach = Math.max(reach, shoulder.distanceTo(target) / arm);
    // Elbows relaxed: down and a little out.
    actor.reachArm(side, target, pole.set(side * .5, -1, -.25).normalize().applyQuaternion(carQ), scale);
  }
  plantFeet(actor, car, seat.hip, seat.floor, scale, weight);
  return reach;
}

/** Feet on the footwell floor ahead of the seat, knees up: hip → ankle at ~88 % of the leg (drivers and passengers). */
export function plantFeet(actor: Actor, car: THREE.Object3D, hip: THREE.Vector3, floor: number, scale: number, weight = 1) {
  car.getWorldQuaternion(carQ);
  const ankleY = floor + actor.footHeight * scale, drop = Math.max(0, hip.y - ankleY), leg = actor.legLength * scale * .88;
  const forward = Math.sqrt(Math.max(.04, leg * leg - drop * drop));
  for (const side of [1, -1] as const) {
    target.set(hip.x + side * .1 * scale, ankleY, hip.z + forward);
    car.localToWorld(target);
    if (weight < 1 && actor.limb(side > 0 ? 'footL' : 'footR', current)) target.lerpVectors(current, target, weight);
    actor.reachLeg(side, target, pole.set(side * .25, 1, .5).normalize().applyQuaternion(carQ), -.12 * weight);
  }
}
