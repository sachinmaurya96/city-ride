import * as THREE from 'three';
import type { VehicleSpec } from '../data/vehicles';
import { carDoor, driverCabin, type DoorStyle } from '../data/importedCatalog';

/** One shared cabin layout for doors, seats, collisions and the entry animation. */
export function cabinLayout(spec: VehicleSpec) {
  const height = spec.cabinHeight ?? spec.height;
  const truck = height > 2.4;
  const frontCab = spec.id.startsWith('pack_') && spec.height > 2.1;
  // Measured door panels give the real seams; others use proportional estimates.
  const door = carDoor(spec.id), zs = door?.outline.map(([z]) => z), ys = door?.outline.map(([, y]) => y);
  const front = zs ? Math.max(...zs) : frontCab ? spec.length * .43 : truck ? spec.length * .27 : spec.length * .14;
  const back = zs ? Math.min(...zs) : frontCab ? spec.length * .25 : truck ? spec.length * .12 : -spec.length * .20;
  const sill = ys ? Math.min(...ys) : truck ? height * .30 : height * .28;
  const doorTop = ys ? Math.max(...ys) : height * .86;
  const hipY = truck ? height * .51 : height * .37;
  const doorStyle: DoorStyle | 'butterfly' = door?.style ?? (spec.id === 'bmw_i8' ? 'butterfly' : 'swing');
  // Imported cars with interiors use their measured seat, roof and footwell (driver on the right, -X; the
  // passenger mirrors it). Others keep proportional estimates, with seats no wider apart than real ones.
  const measured = driverCabin(spec.id);
  return { front, back, sill, doorTop, doorStyle, hingeY: spec.id === 'bmw_i8' ? height * .86 : sill,
    hipY: measured ? measured.hip[1] : hipY, seatZ: measured ? measured.hip[2] : (front + back) * .5,
    seatX: measured ? -measured.hip[0] : spec.importedModel ? Math.min(spec.width * .24, .4) : spec.width * .24,
    roofY: measured ? measured.roof ?? height * 1.4 : height * .88,
    floorY: measured ? measured.floor : height * .08, doorX: door?.skin ?? spec.width * .46,
    doorHeight: ys ? doorTop - sill : height * .58, doorLength: front - back, measured: !!measured };
}

/** Fit hair, head, sleeves and legs inside this cabin using the posed mesh, for every character. */
export function seatedCharacterFit(spec: VehicleSpec, bounds: THREE.Box3, hipHeight: number) {
  const c = cabinLayout(spec);
  const aboveHip = Math.max(.1, bounds.max.y - hipHeight);
  const belowHip = Math.max(.1, hipHeight - bounds.min.y);
  const halfWidth = Math.max(.1, Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  if (c.measured) {
    // Measured seat: the hip stays on the cushion; only the headroom limits the size (feet are placed by IK).
    const scale = Math.min(1, (c.roofY - .04 - c.hipY) / aboveHip);
    return { scale, widthScale: Math.min(1, (spec.width * .48 - c.seatX) / (halfWidth * scale)), hipY: c.hipY };
  }
  const scale = Math.min(1, (c.roofY - c.floorY - .06) / (aboveHip + belowHip));
  const widthScale = Math.min(1, (spec.width * .48 - c.seatX) / (halfWidth * scale));
  const minHip = c.floorY + .02 + belowHip * scale, maxHip = c.roofY - .04 - aboveHip * scale;
  return { scale, widthScale, hipY: THREE.MathUtils.clamp(c.hipY, minHip, Math.max(minHip, maxHip)) };
}
export function seatedCharacterScale(spec: VehicleSpec, bounds: THREE.Box3, hipHeight: number) { return seatedCharacterFit(spec, bounds, hipHeight).scale; }
/** Hinge of the door on `side` (+1 left / -1 right), where its group pivots. */
export function doorPivot(spec: VehicleSpec, side: number) {
  const c = cabinLayout(spec);
  switch (c.doorStyle) {
    case 'coach': return new THREE.Vector3(side * c.doorX, c.sill, c.back);
    case 'scissor': return new THREE.Vector3(side * c.doorX, c.sill + c.doorHeight * .45, c.front);
    case 'dihedral': return new THREE.Vector3(side * (c.doorX - .08), c.doorTop - .06, c.front - .08);
    case 'gullwing': return new THREE.Vector3(side * (c.doorX - .3), c.doorTop, (c.front + c.back) / 2);
    default: return new THREE.Vector3(side * c.doorX, c.hingeY, c.front);
  }
}
/**
 * Opening motion per door style (open 0…1): front-hinged doors swing out ~63°, coach doors swing out backwards,
 * scissor doors lift about their front edge, dihedral doors lift and swing out, gullwings and the i8's butterfly
 * doors rise about their upper hinge.
 */
export function setDoorPose(door: THREE.Object3D, spec: VehicleSpec, side: number, open: number) {
  const style = cabinLayout(spec).doorStyle;
  door.rotation.set(0, 0, 0);
  if (style === 'swing') door.rotation.y = -side * open * 1.1;
  else if (style === 'coach') door.rotation.y = side * open * 1.05;
  else if (style === 'scissor') door.rotation.set(open * 1.2, -side * open * .12, 0);
  else if (style === 'dihedral') door.rotation.set(open * .85, -side * open * .5, 0);
  else if (style === 'gullwing') door.rotation.z = side * open * 1.25;
  else { door.rotation.y = -side * open * .3; door.rotation.z = side * open * 1.05; }
  door.userData.open = open;
}
const poseProbe = new THREE.Object3D();
/** Collider pose (relative to the car body) for a door panel at `open`, matching setDoorPose. */
export function doorColliderPose(spec: VehicleSpec, side: number, open: number, position: THREE.Vector3, rotation: THREE.Quaternion) {
  const c = cabinLayout(spec), pivot = doorPivot(spec, side);
  setDoorPose(poseProbe, spec, side, open); rotation.setFromEuler(poseProbe.rotation);
  // Panel centre: just inside the skin, halfway along and up the door.
  position.set(side * (c.doorX - .05), c.sill + c.doorHeight / 2, (c.front + c.back) / 2).sub(pivot).applyQuaternion(rotation).add(pivot);
  return { position, rotation };
}
