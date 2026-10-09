import * as THREE from 'three';
import type { VehicleSpec } from '../data/vehicles';

/** One shared cabin layout for doors, seats, collisions and the entry animation. */
export function cabinLayout(spec: VehicleSpec) {
  const height = spec.cabinHeight ?? spec.height;
  const truck = height > 2.4;
  const frontCab = spec.id.startsWith('pack_') && spec.height > 2.1;
  const front = frontCab ? spec.length * .43 : truck ? spec.length * .27 : spec.length * .14;
  const back = frontCab ? spec.length * .25 : truck ? spec.length * .12 : -spec.length * .20;
  const sill = truck ? height * .30 : height * .28;
  const hipY = truck ? height * .51 : height * .37;
  return { front, back, sill, hingeY: spec.id === 'bmw_i8' ? height * .86 : sill, hipY, seatZ: (front + back) * .5, seatX: spec.width * .24,
    roofY: height * .88, floorY: height * .08, doorX: spec.width * .46, doorHeight: height * .58, doorLength: front - back };
}

/** Fit hair, head, sleeves and legs inside this cabin using the posed mesh, for every character. */
export function seatedCharacterFit(spec: VehicleSpec, bounds: THREE.Box3, hipHeight: number) {
  const c = cabinLayout(spec);
  const aboveHip = Math.max(.1, bounds.max.y - hipHeight);
  const belowHip = Math.max(.1, hipHeight - bounds.min.y);
  const halfWidth = Math.max(.1, Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  const scale = Math.min(1, (c.roofY - c.floorY - .06) / (aboveHip + belowHip));
  const widthScale = Math.min(1, (spec.width * .48 - c.seatX) / (halfWidth * scale));
  const minHip = c.floorY + .02 + belowHip * scale, maxHip = c.roofY - .04 - aboveHip * scale;
  return { scale, widthScale, hipY: THREE.MathUtils.clamp(c.hipY, minHip, Math.max(minHip, maxHip)) };
}
export function seatedCharacterScale(spec: VehicleSpec, bounds: THREE.Box3, hipHeight: number) { return seatedCharacterFit(spec, bounds, hipHeight).scale; }
export function doorPivot(spec: VehicleSpec, side: number) {
  const c = cabinLayout(spec);
  return new THREE.Vector3(side * c.doorX, c.hingeY, c.front);
}
export function setDoorPose(door: THREE.Object3D, spec: VehicleSpec, side: number, open: number) {
  door.rotation.y = -side * open * (spec.id === 'bmw_i8' ? .3 : 1.1);
  door.rotation.z = spec.id === 'bmw_i8' ? side * open * 1.05 : 0;
  door.userData.open = open;
}
