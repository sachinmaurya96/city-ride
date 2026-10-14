import { it, expect } from 'vitest';
import * as THREE from 'three';
import { CHARACTER_FILES, readAsset } from './assets';
import { VEHICLES } from '../src/game/data/vehicles';
import { prepareImportedModel, calibratedVehicleSpec } from '../src/game/render/importedVehicles';
import { prepareCharacter, createAvatar, animateAvatar } from '../src/game/render/importedCharacters';
import { characterBounds } from '../src/game/render/characterBounds';
import { CHARACTER_IDS } from '../src/game/data/characters';
import { cabinLayout, seatedCharacterFit } from '../src/game/vehicles/cabin';

it('keeps every seated character head beneath the actual curved McLaren roof, not its rear wing', async () => {
  const { scene } = await readAsset('mclaren.glb'), model = prepareImportedModel(scene, VEHICLES.mclaren_p1);
  const spec = calibratedVehicleSpec(VEHICLES.mclaren_p1, model), cabin = cabinLayout(spec);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  expect(model.userData.dimensions[1]).toBeGreaterThan(1.4);
  expect(cabin.roofY).toBeLessThan(1.1);
  for (const id of CHARACTER_IDS) {
    const { scene } = await readAsset(CHARACTER_FILES[id]), actor = createAvatar(prepareCharacter(scene, id), id);
    animateAvatar(actor, 0, 0, 1, 0, 0, false, true);
    const fit = seatedCharacterFit(spec, characterBounds(actor.root), actor.hipHeight);
    expect(fit.scale, id).toBeGreaterThan(.75);
    actor.root.scale.set(fit.scale * fit.widthScale, fit.scale, fit.scale);
    for (const side of [-1, 1]) {
      actor.root.position.set(side * cabin.seatX, fit.hipY - actor.hipHeight * fit.scale, cabin.seatZ);
      actor.root.updateMatrixWorld(true);
      const samples = new Map<string, THREE.Vector3>(), vertex = new THREE.Vector3();
      actor.root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        if (o instanceof THREE.SkinnedMesh) o.skeleton.update();
        for (let i = 0; i < o.geometry.attributes.position.count; i++) {
          o.getVertexPosition(i, vertex).applyMatrix4(o.matrixWorld); if (vertex.y < .85) continue;
          const key = `${Math.round(vertex.x / .04)}:${Math.round(vertex.z / .04)}`, previous = samples.get(key);
          if (!previous || vertex.y > previous.y) samples.set(key, vertex.clone());
        }
      });
      expect(samples.size, id).toBeGreaterThan(10);
      for (const point of samples.values()) {
        ray.ray.origin.set(point.x, 3, point.z);
        const roof = ray.intersectObject(model, true)[0];
        expect(roof, `${id} seat ${side} roof at ${point.x},${point.z}`).toBeDefined();
        expect(point.y, `${id} seat ${side} head at ${point.x},${point.z}, roof ${roof.point.y}`).toBeLessThan(roof.point.y - .015);
      }
    }
  }
});
