import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readAsset } from './assets';
import { VEHICLES, VEHICLE_ORDER, isPlayableVehicleId } from '../src/game/data/vehicles';
import { EXTRA_BY_ID } from '../src/game/data/importedCatalog';
import { prepareImportedModel, calibratedVehicleSpec } from '../src/game/render/importedVehicles';
import { prepareCharacter, createAvatar, animateAvatar, reachAvatarArm } from '../src/game/render/importedCharacters';
import { cabinLayout, seatedCharacterFit } from '../src/game/vehicles/cabin';
import { createCharacterMesh, PLAYER_LOOK, PLAYER_LOOK_FEMALE } from '../src/game/render/characters';
import { poseSeated, newAnimState } from '../src/game/render/charAnim';
import { MATERIALS } from '../src/game/render/materials';
import { characterBounds } from '../src/game/render/characterBounds';

const cache = new Map<string, ReturnType<typeof readAsset>>();
const prepared = new Map<string, THREE.Group>();
function asset(file: string) {
  let task = cache.get(file);
  if (!task) { task = readAsset(file); cache.set(file, task); }
  return task;
}
function triangles(root: THREE.Object3D) {
  let count = 0;
  root.traverse(o => { if (o instanceof THREE.Mesh) count += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; });
  return count;
}
function posedBounds(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  root.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.update(); });
  return new THREE.Box3().setFromObject(root, true);
}

describe('actual supplied asset geometry', () => {
  for (const spec of Object.values(VEHICLES).filter(s => s.importedModel)) {
    it(`${spec.id}: preserves geometry and keeps rotating tires bounded around their hubs`, async () => {
      const extra = EXTRA_BY_ID.get(spec.id);
      const file = extra?.file ?? (spec.id === 'bmw_i8' ? 'bmw_i8.glb' : '2025_bmw_m4_gt3_evo_g82.glb');
      const { scene } = await asset(file);
      const source = extra && 'node' in extra ? scene.getObjectByName(extra.node)! : scene;
      const originalTriangles = triangles(source);
      const root = prepareImportedModel(source as THREE.Group, spec);
      prepared.set(spec.id, root);
      expect(triangles(root)).toBeGreaterThan(100);
      if (spec.id !== 'western_star') expect(triangles(root)).toBe(originalTriangles);
      if (spec.npcOnly) {
        expect(VEHICLE_ORDER).not.toContain(spec.id);
        expect(isPlayableVehicleId(spec.id)).toBe(false);
        // Static NPC geometry remains intact, including wheels and closed doors.
        expect(triangles(root.getObjectByName('imported-body')!)).toBe(originalTriangles);
        return;
      }
      const calibrated = calibratedVehicleSpec(spec, root);
      for (let i = 0; i < spec.wheels.visual.length; i++) {
        const wheel = root.getObjectByName(`imported-wheel-${i}`)!;
        const spin = wheel.getObjectByName(`imported-wheel-spin-${i}`)!;
        expect(spin.children.length, `${spec.id} wheel ${i}`).toBeGreaterThan(0);
        const size = new THREE.Box3().setFromObject(spin, true).getSize(new THREE.Vector3());
        expect(size.y / size.z, `${spec.id} wheel ${i} roundness`).toBeGreaterThan(.8);
        expect(size.y / size.z, `${spec.id} wheel ${i} roundness`).toBeLessThan(1.2);
        expect(size.y).toBeLessThan(spec.wheelRadius * 2.9);
        if (i < calibrated.wheels.physics.length) {
          expect(calibrated.wheels.physics[i].x).toBeCloseTo(wheel.position.x);
          expect(calibrated.wheels.physics[i].z).toBeCloseTo(wheel.position.z);
        }
      }
    });
  }

  it('fits male, female, Lynae and Cartethyia seated meshes inside every player car', async () => {
    const characters: { name: string; root: THREE.Object3D; hip: number }[] = [];
    for (const id of ['male', 'female', 'lynae', 'cartethyia'] as const) {
      const file = id === 'lynae' ? 'lynae_from_wuthering_waves.glb' : id === 'cartethyia' ? 'cartethyia_wuthering_waves.glb' : `${id}-rover.glb`;
      const { scene } = await asset(file);
      const avatar = createAvatar(prepareCharacter(scene, id), id);
      animateAvatar(avatar, 0, 0, 1, 0, 0, false, true);
      characters.push({ name: id, root: avatar.root, hip: avatar.hipHeight });
    }
    for (const [name, look] of [['male', PLAYER_LOOK], ['female', PLAYER_LOOK_FEMALE]] as const) {
      const {mesh, rig} = createCharacterMesh(look, 1, MATERIALS.world);
      poseSeated(rig, 'car', newAnimState(0), 0, { steer: 0, speed: 5, longAccel: 0, lateralAccel: 0, roll: 0 });
      characters.push({ name: `${name} loading fallback`, root: mesh, hip: rig.P.joints[0].y });
    }
    for (const character of characters) {
      const bounds = posedBounds(character.root);
      for (const id of VEHICLE_ORDER.filter(id => VEHICLES[id].kind === 'car')) {
        const spec = calibratedVehicleSpec(VEHICLES[id], prepared.get(id));
        const cabin = cabinLayout(spec);
        const { scale, widthScale, hipY } = seatedCharacterFit(spec, bounds, character.hip);
        const label = `${id}/${character.name}`;
        expect(scale, label).toBeGreaterThan(character.name.includes('fallback') ? .3 : .75);
        expect(hipY + (bounds.max.y - character.hip) * scale, label).toBeLessThanOrEqual(cabin.roofY - .039);
        expect(hipY + (bounds.min.y - character.hip) * scale, label).toBeGreaterThanOrEqual(cabin.floorY + .019);
        expect(cabin.seatX + Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) * scale * widthScale, label).toBeLessThanOrEqual(spec.width * .48 + .001);
      }
    }
  });

  for (const id of ['male', 'female'] as const) {
    it(`${id} Rover keeps its appearance, walks, seats and reaches steering grips with independent skeletons`, async () => {
      const { scene } = await asset(`${id}-rover.glb`);
      const template = prepareCharacter(scene, id);
      expect(triangles(template)).toBe(triangles(scene));
      expect(posedBounds(template).getSize(new THREE.Vector3()).y).toBeCloseTo(1.68, 5);
      const avatar = createAvatar(template, id), other = createAvatar(template, id);
      expect(Object.values(avatar.bones)).toHaveLength(15);
      expect(avatar.bones.hips).not.toBe(other.bones.hips);
      const meshes: THREE.SkinnedMesh[] = [];
      avatar.root.traverse(o => { if (o instanceof THREE.SkinnedMesh) meshes.push(o); });
      for (const mesh of meshes) {
        const source = scene.getObjectByName(mesh.name) as THREE.Mesh;
        expect(mesh.material).toBe(source.material);
        expect(mesh.geometry.getAttribute('uv').count).toBe(source.geometry.getAttribute('uv').count);
        const weights = mesh.geometry.getAttribute('skinWeight');
        for (let i = 0; i < weights.count; i++) expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1, 5);
      }
      const still = other.bones.footL!.getWorldPosition(new THREE.Vector3());
      let stride = 0;
      for (let i = 0; i < 36; i++) {
        animateAvatar(avatar, 1 / 60, .025, 0);
        stride = Math.max(stride, avatar.bones.footL!.getWorldPosition(new THREE.Vector3()).distanceTo(still));
      }
      expect(stride).toBeGreaterThan(.1);
      expect(other.bones.footL!.getWorldPosition(new THREE.Vector3()).distanceTo(still)).toBeLessThan(1e-6);
      animateAvatar(avatar, 0, 0, 1, 0, 0, false, true);
      const originalBounds = characterBounds(avatar.root), car = new THREE.Group();
      car.position.set(100, 2, -300); car.rotation.set(.04, 1.2, .05); car.add(avatar.root);
      avatar.root.position.set(-.45, -.4, -.15); avatar.root.scale.set(.8, .95, .95);
      const seatedAgain = characterBounds(avatar.root);
      // Skeleton matrices use float32; distant world coordinates lose a few micrometres.
      expect(seatedAgain.min.distanceTo(originalBounds.min)).toBeLessThan(1e-4);
      expect(seatedAgain.max.distanceTo(originalBounds.max)).toBeLessThan(1e-4);
      car.remove(avatar.root); avatar.root.position.set(0, 0, 0); avatar.root.scale.setScalar(1);
      for (const pose of ['car', 'bike', 'auto', 'bus'] as const) {
        animateAvatar(avatar, .016, 0, 1, 0, 0, false, true, pose);
        const bounds = posedBounds(avatar.root);
        expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
        expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(2.8);
      }
      // Validate world-space hand targets after vehicle translation, turning and avatar scaling.
      avatar.root.position.set(2, .4, -3); avatar.root.rotation.y = .8; avatar.root.scale.setScalar(.85);
      animateAvatar(avatar, .016, 0, 1, 0, 0, false, true, 'bike');
      for (const side of [1, -1] as const) {
        const suffix = side === 1 ? 'L' : 'R';
        const shoulder = avatar.bones[`upper${suffix}`]!.getWorldPosition(new THREE.Vector3());
        const target = shoulder.clone().add(new THREE.Vector3(side * .09, -.17, .28));
        reachAvatarArm(avatar, side, target, new THREE.Vector3(side, -1, -.3));
        const hand = avatar.bones[`hand${suffix}`]!.getWorldPosition(new THREE.Vector3());
        expect(hand.distanceTo(target)).toBeLessThan(.005);
      }
    });
  }

  it('Cartethyia sleeves follow the arm, feet move during walking, and every vertex remains finite', async () => {
    const { scene } = await asset('cartethyia_wuthering_waves.glb');
    const avatar = createAvatar(prepareCharacter(scene, 'cartethyia'), 'cartethyia');
    animateAvatar(avatar, .016, 0, 0);
    const before = avatar.bones.footL!.getWorldPosition(new THREE.Vector3());
    let stride = 0;
    for (let i = 0; i < 36; i++) {
      animateAvatar(avatar, 1 / 60, .025, 0);
      stride = Math.max(stride, avatar.bones.footL!.getWorldPosition(new THREE.Vector3()).distanceTo(before));
    }
    expect(stride).toBeGreaterThan(.1);
    for (const sit of [0, .5, 1]) {
      animateAvatar(avatar, .016, 0, sit, .7, .5);
      const bounds = posedBounds(avatar.root);
      expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
      expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(2.8);
    }
    const sleeves = avatar.root.getObjectByName('Alpha_New_Material_1_0') as THREE.SkinnedMesh;
    const skin = sleeves.geometry.getAttribute('skinIndex');
    const weights = sleeves.geometry.getAttribute('skinWeight');
    const p = sleeves.geometry.getAttribute('position');
    let sleeveVertices = 0, armVertices = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)) > .45) {
      sleeveVertices++;
      for (let j = 0; j < 4; j++) if (weights.getComponent(i, j) > .2 && /upper|fore|hand/.test(sleeves.skeleton.bones[skin.getComponent(i, j)].name)) { armVertices++; break; }
    }
    expect(armVertices / sleeveVertices).toBeGreaterThan(.9);
  });
});
