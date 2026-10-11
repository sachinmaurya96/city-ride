import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readAsset } from './assets';
import { VEHICLES, VEHICLE_ORDER } from '../src/game/data/vehicles';
import { CAR_CABINS, EXTRA_BY_ID, carDoor, doorInner, driverCabin } from '../src/game/data/importedCatalog';
import { calibratedVehicleSpec, insideOutline, prepareImportedModel } from '../src/game/render/importedVehicles';
import { animateAvatar, avatarArm, createAvatar, prepareCharacter, reachAvatarArm, reachAvatarLeg, type CharacterId } from '../src/game/render/importedCharacters';
import { characterBounds } from '../src/game/render/characterBounds';
import { cabinLayout, doorPivot, seatedCharacterFit, setDoorPose } from '../src/game/vehicles/cabin';
import { fallbackWheelFrame, holdSteeringWheel, type DriverSeat } from '../src/game/vehicles/driverPose';
import type { Actor } from '../src/game/render/CharacterActor';

const CARS = VEHICLE_ORDER.filter((id) => VEHICLES[id].kind === 'car' && VEHICLES[id].importedModel);
const FILES: Record<CharacterId, string> = { male: 'male-rover.glb', female: 'female-rover.glb', lynae: 'lynae_from_wuthering_waves.glb', cartethyia: 'cartethyia_wuthering_waves.glb' };
const models = new Map<string, Promise<THREE.Group>>();
function model(id: string) {
  let task = models.get(id);
  if (!task) {
    const extra = EXTRA_BY_ID.get(id), file = extra?.file ?? (id === 'bmw_i8' ? 'bmw_i8.glb' : '2025_bmw_m4_gt3_evo_g82.glb');
    task = readAsset(file).then(({ scene }) => prepareImportedModel(scene, VEHICLES[id as keyof typeof VEHICLES]));
    models.set(id, task);
  }
  return task;
}
function centroid(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const sum = new THREE.Vector3(), v = new THREE.Vector3(); let n = 0;
  root.traverse((o) => { if (o instanceof THREE.Mesh) { const p = o.geometry.getAttribute('position'); for (let i = 0; i < p.count; i += 3) { sum.add(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld)); n++; } } });
  return sum.divideScalar(Math.max(1, n));
}

describe('measured cabins: right-hand drive, seats, steering wheels', () => {
  it('every left-hand-drive model gets its wheel in front of the right-hand seat; the exterior stays as supplied', async () => {
    for (const id of CARS) {
      const cabin = driverCabin(id), root = await model(id), wheel = root.getObjectByName('steering-wheel');
      if (!cabin) { expect(wheel, id).toBeUndefined(); continue; }
      expect(wheel?.children.length, id).toBeGreaterThan(0);
      // The split wheel geometry sits on the driver's (-X) side, centred on the measured rim.
      const c = centroid(wheel!);
      expect(c.x, id).toBeLessThan(-.15);
      // (The M4 GT3's rectangular race wheel carries its buttons off-centre.)
      expect(c.distanceTo(new THREE.Vector3(...cabin.wheel.centre)), id).toBeLessThan(id === 'bmw_m4_gt3' ? .12 : .08);
      // Its face points back at the driver and tilts up.
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(wheel!.quaternion);
      expect(normal.z, id).toBeLessThan(-.4); expect(normal.y, id).toBeGreaterThan(.1);
    }
  });

  for (const driver of ['male', 'female', 'lynae', 'cartethyia'] as const) {
    it(`${driver}: sits on each seat with hands on the rim, head under the roof and feet on the floor`, async () => {
      const template = prepareCharacter((await readAsset(FILES[driver])).scene, driver);
      for (const id of CARS) {
        const root = (await model(id)).clone(true), spec = calibratedVehicleSpec(VEHICLES[id], root), c = cabinLayout(spec);
        const avatar = createAvatar(template, driver);
        animateAvatar(avatar, 0, 0, 1, 0, 0, false, true, 'car');
        const fit = seatedCharacterFit(spec, characterBounds(avatar.root), avatar.hipHeight);
        avatar.root.scale.set(fit.scale * fit.widthScale, fit.scale, fit.scale);
        avatar.root.position.set(-c.seatX, fit.hipY - avatar.hipHeight * fit.scale, c.seatZ);
        root.add(avatar.root);
        const actor = { object: avatar.root, hipHeight: avatar.hipHeight, seatedBounds: new THREE.Box3(), animate: () => {}, footHeight: avatar.footHeight, legLength: avatar.legs.length,
          reachArm: (side, t, p) => reachAvatarArm(avatar, side, t, p), reachLeg: (side, t, p, roll) => reachAvatarLeg(avatar, side, t, p, roll),
          arm: (side, out) => avatarArm(avatar, side, out), limb: (k, out) => { avatar.bones[k]!.getWorldPosition(out); return true; } } as Actor;
        const wheel = root.getObjectByName('steering-wheel') ?? null, hip = new THREE.Vector3(-c.seatX, fit.hipY, c.seatZ);
        const seat: DriverSeat = { wheel, radius: wheel?.userData.radius ?? .17, fallback: fallbackWheelFrame(hip), hip, floor: driverCabin(id)?.floor ?? c.floorY };
        // Settle the lean controller as CarDriver does, steering a little to the right.
        let lean = 0, reach = 0;
        for (let k = 0; k < 150; k++) {
          animateAvatar(avatar, 1 / 60, 0, 1, 0, 0, false, true, 'car', { steer: .3, longAccel: 0, lateralAccel: 0, speed: 5, roll: 0, extraLean: lean, control: { steer: .3, drive: 0 } });
          reach = holdSteeringWheel(actor, root, seat, .3, fit.scale);
          lean = THREE.MathUtils.clamp(lean + THREE.MathUtils.clamp((reach - .9) * 4, -1, 1) / 60 * 2.5, 0, .9);
        }
        root.updateMatrixWorld(true);
        const label = `${id}/${driver}`;
        expect(reach, label).toBeLessThan(.96);
        // Hands on the rim (turned with the steering): radial and axial distance to the rim circle.
        const frame = new THREE.Matrix4().copy(wheel ? wheel.matrixWorld : new THREE.Matrix4().multiplyMatrices(root.matrixWorld, seat.fallback).multiply(new THREE.Matrix4().makeRotationZ(-.3 * 1.25)));
        const inverse = frame.clone().invert();
        for (const key of ['handL', 'handR'] as const) {
          const p = avatar.bones[key]!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
          expect(Math.abs(Math.hypot(p.x, p.y) - seat.radius), `${label} ${key} radial`).toBeLessThan(.03);
          expect(Math.abs(p.z - .03), `${label} ${key} axial`).toBeLessThan(.03);
        }
        // Head under the headliner; ankles above the footwell floor, below the hip.
        let top = -Infinity; const v = new THREE.Vector3();
        avatar.root.traverse((o) => { if (o instanceof THREE.SkinnedMesh) { o.skeleton.update(); const pa = o.geometry.getAttribute('position'); for (let i = 0; i < pa.count; i += 5) top = Math.max(top, o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).y); } });
        if (CAR_CABINS[id]?.roof) expect(top, `${label} head`).toBeLessThan(c.roofY - .01);
        for (const key of ['footL', 'footR'] as const) {
          const ankle = avatar.bones[key]!.getWorldPosition(new THREE.Vector3());
          expect(ankle.y, `${label} ${key}`).toBeGreaterThan(seat.floor + .02);
          expect(ankle.y, `${label} ${key}`).toBeLessThan(hip.y);
          expect(ankle.z, `${label} ${key}`).toBeGreaterThan(hip.z + .3);
        }
      }
    }, 120000);
  }
});

function outlineDistance(z: number, y: number, outline: readonly (readonly [number, number])[]) {
  let best = Infinity;
  outline.forEach(([z0, y0], i) => {
    const [z1, y1] = outline[(i + 1) % outline.length], dz = z1 - z0, dy = y1 - y0;
    const t = THREE.MathUtils.clamp(((z - z0) * dz + (y - y0) * dy) / (dz * dz + dy * dy), 0, 1);
    best = Math.min(best, Math.hypot(z - z0 - dz * t, y - y0 - dy * t));
  });
  return best;
}
describe('measured doors', () => {
  it('cut along the traced seams and open the way each car does', async () => {
    for (const id of CARS) {
      const door = carDoor(id); if (!door) continue;
      const root = await model(id), spec = VEHICLES[id], c = cabinLayout(spec);
      for (const side of [1, -1]) {
        const group = root.getObjectByName(`vehicle-door-${side}`)!;
        expect(group.children.length, `${id} ${side}`).toBeGreaterThan(0);
        expect(group.position.distanceTo(doorPivot(spec, side)), id).toBeLessThan(1e-6);
        // Every panel triangle (in car space) lies on that side of the skin/trim and inside the outline.
        group.updateMatrixWorld(true);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
        group.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const p = o.geometry.getAttribute('position');
          for (let i = 0; i < p.count; i += 3) {
            a.fromBufferAttribute(p, i).add(b.fromBufferAttribute(p, i + 1)).add(d.fromBufferAttribute(p, i + 2)).divideScalar(3).applyMatrix4(o.matrixWorld);
            expect(a.x * side, id).toBeGreaterThan(doorInner(door, a.y) - 1e-6);
            // (Seam-split slivers can lie on the outline itself.)
            expect(insideOutline(a.z, a.y, door.outline) || outlineDistance(a.z, a.y, door.outline) < .002, `${id} ${a.z},${a.y}`).toBe(true);
          }
        });
        // Opened, the panel's middle moves out (swinging doors) or up (scissor, dihedral, gullwing).
        const closed = centroid(group).applyMatrix4(group.parent!.matrixWorld.clone().invert());
        setDoorPose(group, spec, side, 1); group.updateMatrixWorld(true);
        const open = centroid(group).applyMatrix4(group.parent!.matrixWorld.clone().invert());
        setDoorPose(group, spec, side, 0); group.updateMatrixWorld(true);
        if (c.doorStyle === 'swing' || c.doorStyle === 'coach') expect((open.x - closed.x) * side, id).toBeGreaterThan(.3);
        else expect(open.y - closed.y, id).toBeGreaterThan(.25);
        if (c.doorStyle === 'coach') expect(open.z, id).toBeLessThan(closed.z);
      }
    }
  }, 120000);
});
