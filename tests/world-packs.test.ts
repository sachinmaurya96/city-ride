import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readAsset } from './assets';
import { prepareWorldPack, worldAssets, type WorldPack } from '../src/game/world/worldAssets';
import { roadPlacements } from '../src/game/world/ImportedCity';
import { buildCity } from '../src/game/world/cityBuilder';
import { INTERSECTIONS, SEGMENTS } from '../src/game/data/cityMap';

describe('supplied city resources', () => {
  const packs: [WorldPack, string, number][] = [['buildings', 'city-building-pack', 15], ['skyline', 'night-city-building-pack', 1],
    ['forest', 'forest-tree-pack', 8], ['palms', 'palm-tree-pack', 4], ['bananas', 'banana-tree-pack', 3], ['roads', 'road-pack', 6]];
  for (const [pack, file, minimum] of packs) it(`${pack}: preserves materials and normalizes real geometry without display offsets`, async () => {
    const { scene } = await readAsset(`${file}.glb`), materials = new Set<THREE.Material>();
    scene.traverse(o => { if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m)); });
    const models = prepareWorldPack(scene, pack); worldAssets.set(pack, models);
    expect(models.length).toBeGreaterThanOrEqual(minimum);
    for (const model of models) {
      const bounds = new THREE.Box3(); let triangles = 0;
      for (const part of model.parts) {
        expect(materials.has(part.material)).toBe(true); bounds.union(part.geometry.boundingBox!);
        triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
      }
      expect(triangles).toBeGreaterThan(5);
      expect(bounds.min.distanceTo(new THREE.Vector3(-.5, 0, -.5))).toBeLessThan(.0001);
      expect(bounds.max.distanceTo(new THREE.Vector3(.5, 1, .5))).toBeLessThan(.0001);
      expect(model.size.x).toBeGreaterThan(0); expect(model.size.y).toBeGreaterThan(0);
    }
  });
  it('replaces generic buildings and trees, with building colliders matching the model footprints', () => {
    const city = buildCity(), packsUsed = new Set(city.worldPlacements.map(p => p.pack));
    for (const pack of ['buildings', 'forest', 'palms', 'bananas']) expect(packsUsed.has(pack as WorldPack)).toBe(true);
    expect(city.worldPlacements.filter(p => p.pack === 'buildings').length).toBeGreaterThan(150);
    for (const p of city.worldPlacements.filter(p => p.pack === 'buildings')) {
      const collider = city.staticBoxes.find(b => b.x === p.x && b.z === p.z && b.ry === p.ry)!;
      expect(collider.hx * 2).toBeCloseTo(p.width); expect(collider.hz * 2).toBeCloseTo(p.depth); expect(collider.hy * 2).toBeCloseTo(p.height);
    }
  });
  it('covers every routed street and every junction with pack road modules', () => {
    const roads = roadPlacements();
    expect(roads.length).toBe(SEGMENTS.length / 2 + INTERSECTIONS.length + 20);
    for (const junction of INTERSECTIONS) {
      const road = roads.find(p => p.x === junction.x && p.z === junction.z)!;
      expect(road.width).toBe(junction.hx * 2); expect(road.depth).toBe(junction.hz * 2);
    }
  });
});
