import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGlb, releaseGlb } from '../render/glbAssets';

export type WorldPack = 'buildings' | 'skyline' | 'forest' | 'palms' | 'bananas' | 'roads';
export const WORLD_URLS: Record<WorldPack, string> = {
  buildings: new URL('../../../assets/glb-files/city-building-pack.glb', import.meta.url).href,
  skyline: new URL('../../../assets/glb-files/night-city-building-pack.glb', import.meta.url).href,
  forest: new URL('../../../assets/glb-files/forest-tree-pack.glb', import.meta.url).href,
  palms: new URL('../../../assets/glb-files/palm-tree-pack.glb', import.meta.url).href,
  bananas: new URL('../../../assets/glb-files/banana-tree-pack.glb', import.meta.url).href,
  roads: new URL('../../../assets/glb-files/road-pack.glb', import.meta.url).href,
};
export interface WorldModel { name: string; size: THREE.Vector3; parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] }
export const worldAssets = new Map<WorldPack, WorldModel[]>();
let task: Promise<void> | null = null;

/** Bake export transforms, remove display-layout offsets, and normalize each usable module to a unit box. */
export function prepareWorldPack(scene: THREE.Group, pack: WorldPack): WorldModel[] {
  scene.updateMatrixWorld(true);
  const container = scene.getObjectByName(pack === 'palms' ? 'Palm_2' : 'RootNode');
  const nodes = container?.children ?? [scene];
  return nodes.filter(node => {
    if (pack === 'buildings') return node.name.startsWith('BACKGROUND_BUILDING');
    if (pack === 'forest') return node.name.startsWith('Background_Tree_Atlas') && new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3()).y > 10;
    if (pack === 'palms') return /^M_Palm_P2_(1|2|3|4)$/.test(node.name);
    if (pack === 'roads') return /Straight|Intersection/.test(node.name);
    return true;
  }).map(node => {
    const bounds = new THREE.Box3().setFromObject(node, true), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const normalize = new THREE.Matrix4().makeScale(1 / size.x, 1 / size.y, 1 / size.z)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
    const batches = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
    node.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = object.geometry;
      // Keep material groups, UVs and all original texture maps, even in multi-material exports.
      const groups = Array.isArray(object.material) ? source.groups : [{ start: 0, count: source.index?.count ?? source.attributes.position.count, materialIndex: 0 }];
      for (const group of groups) {
        const material = Array.isArray(object.material) ? object.material[group.materialIndex ?? 0] : object.material;
        let geometry: THREE.BufferGeometry;
        if (groups.length === 1) geometry = source.clone();
        else {
          geometry = source.toNonIndexed();
          for (const [key, attribute] of Object.entries(geometry.attributes)) {
            const array = attribute.array.slice(group.start * attribute.itemSize, (group.start + group.count) * attribute.itemSize);
            geometry.setAttribute(key, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
          }
        }
        geometry.clearGroups(); geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, object.matrixWorld));
        const key = `${material.uuid}:${Object.keys(geometry.attributes).sort().join(',')}`;
        const batch: { material: THREE.Material; geometries: THREE.BufferGeometry[] } = batches.get(key) ?? { material, geometries: [] };
        batch.geometries.push(geometry); batches.set(key, batch);
      }
    });
    const parts = [...batches.values()].map(({ material, geometries }) => {
      const geometry = mergeGeometries(geometries)!; geometries.forEach(g => g.dispose());
      geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return { geometry, material };
    });
    return { name: node.name, size, parts };
  });
}

function capTexture(texture: THREE.Texture) {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const width = image?.width ?? 0, height = image?.height ?? 0;
  if (Math.max(width, height) <= 2048 || typeof document === 'undefined') return;
  const factor = 2048 / Math.max(width, height), canvas = document.createElement('canvas');
  canvas.width = Math.round(width * factor); canvas.height = Math.round(height * factor);
  canvas.getContext('2d')!.drawImage(texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  texture.image = canvas; texture.needsUpdate = true;
}
export function loadWorldAssets() {
  task ??= Promise.all((Object.keys(WORLD_URLS) as WorldPack[]).map(async pack => {
    const { scene } = await loadGlb(WORLD_URLS[pack]);
    const seen = new Set<THREE.Texture>();
    scene.traverse(o => { if (o instanceof THREE.Mesh) for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture && !seen.has(value)) { seen.add(value); capTexture(value); }
    } });
    worldAssets.set(pack, prepareWorldPack(scene, pack));
    scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    releaseGlb(WORLD_URLS[pack]);
  })).then(() => undefined);
  return task;
}
