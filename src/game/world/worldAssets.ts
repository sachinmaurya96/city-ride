import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGlb, releaseGlb } from '../render/glbAssets';

export type WorldPack = 'buildings' | 'skyline' | 'forest' | 'palms' | 'bananas' | 'roads' | 'petrol' | 'billboards';
export const WORLD_URLS: Record<WorldPack, string> = {
  buildings: new URL('../../../assets/optimized/world/city-building-pack.glb', import.meta.url).href,
  skyline: new URL('../../../assets/optimized/world/night-city-building-pack.glb', import.meta.url).href,
  forest: new URL('../../../assets/optimized/world/forest-tree-pack.glb', import.meta.url).href,
  palms: new URL('../../../assets/optimized/world/palm-tree-pack.glb', import.meta.url).href,
  bananas: new URL('../../../assets/optimized/world/banana-tree-pack.glb', import.meta.url).href,
  roads: new URL('../../../assets/optimized/world/road-pack.glb', import.meta.url).href,
  petrol: new URL('../../../assets/optimized/world/hp-petrol-pump.glb', import.meta.url).href,
  billboards: new URL('../../../assets/optimized/world/billboard.glb', import.meta.url).href,
};
export interface WorldModel { name: string; size: THREE.Vector3; parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] }
export const worldAssets = new Map<WorldPack, WorldModel[]>();
let task: Promise<void> | null = null;

/**
 * The billboard pack is three identical structures standing diagonally in one frame mesh, each with its own ad
 * panel. Give every frame triangle to the nearest panel (top view), then turn each structure so its ad faces +Z.
 */
function splitBillboards(scene: THREE.Group): THREE.Group[] {
  const world = (mesh: THREE.Mesh) => { const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld); return g; };
  const meshes: THREE.Mesh[] = []; scene.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
  const frame = meshes.reduce((a, b) => (a.geometry.index?.count ?? 0) > (b.geometry.index?.count ?? 0) ? a : b);
  const panels = meshes.filter(m => m !== frame).map(mesh => {
    const geometry = world(mesh), box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
    const p = geometry.getAttribute('position'), a = new THREE.Vector3().fromBufferAttribute(p, 0), b = new THREE.Vector3().fromBufferAttribute(p, 1), c = new THREE.Vector3().fromBufferAttribute(p, 2);
    const normal = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).setY(0).normalize();
    // Panel edge in the top view: perpendicular to its normal through the centre.
    const centre = box.getCenter(new THREE.Vector3()), along = new THREE.Vector3(-normal.z, 0, normal.x), half = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    return { mesh, geometry, box, normal, centre, along, half, frame: [] as number[] };
  });
  const frameGeometry = world(frame), fp = frameGeometry.getAttribute('position'), v = new THREE.Vector3();
  for (let t = 0; t < fp.count / 3; t++) {
    v.set((fp.getX(t * 3) + fp.getX(t * 3 + 1) + fp.getX(t * 3 + 2)) / 3, 0, (fp.getZ(t * 3) + fp.getZ(t * 3 + 1) + fp.getZ(t * 3 + 2)) / 3);
    let best = 0, distance = Infinity;
    panels.forEach((panel, i) => {
      const dx = v.x - panel.centre.x, dz = v.z - panel.centre.z, u = THREE.MathUtils.clamp(dx * panel.along.x + dz * panel.along.z, -panel.half, panel.half);
      const d = Math.hypot(dx - panel.along.x * u, dz - panel.along.z * u); if (d < distance) { distance = d; best = i; }
    });
    panels[best].frame.push(t);
  }
  return panels.map((panel, i) => {
    // The service walkway runs along the front, below the ad: that side is the one people should read.
    let side = 0; const below = panel.box.min.y;
    for (const t of panel.frame) {
      v.set(0, 0, 0); for (let k = 0; k < 3; k++) v.add(new THREE.Vector3().fromBufferAttribute(fp, t * 3 + k).divideScalar(3));
      if (v.y < below && v.y > below - (panel.box.max.y - below) * .4) side += v.sub(panel.centre).setY(0).dot(panel.normal);
    }
    if (side < 0) panel.normal.negate();
    const turn = new THREE.Matrix4().makeRotationY(-Math.atan2(panel.normal.x, panel.normal.z));
    const group = new THREE.Group(); group.name = `billboard-${i}`;
    const frameMesh = new THREE.Mesh(triangles(frameGeometry, panel.frame).applyMatrix4(turn), frame.material);
    group.add(frameMesh, new THREE.Mesh(panel.geometry.applyMatrix4(turn), panel.mesh.material));
    return group;
  });
}
function triangles(geometry: THREE.BufferGeometry, list: number[]) {
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = new Float32Array(list.length * 3 * attribute.itemSize);
    list.forEach((t, j) => { for (let k = 0; k < 3 * attribute.itemSize; k++) values[j * 3 * attribute.itemSize + k] = attribute.array[t * 3 * attribute.itemSize + k]; });
    result.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
  }
  return result;
}

/** Bake export transforms, remove display-layout offsets, and normalize each usable module to a unit box. */
export function prepareWorldPack(scene: THREE.Group, pack: WorldPack): WorldModel[] {
  scene.updateMatrixWorld(true);
  const container = scene.getObjectByName(pack === 'palms' ? 'Palm_2' : 'RootNode');
  const nodes = pack === 'petrol' ? [scene] : pack === 'billboards' ? splitBillboards(scene) : container?.children ?? [scene];
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
        // The background atlas contains transparent patches, but these city
        // meshes are solid building walls (their collision boxes are solid too).
        // Keep them in the opaque depth pass instead of blending whole batches.
        if (pack === 'buildings' && material.name === 'BACKGROUND_BUILDING_2'
          && material instanceof THREE.MeshStandardMaterial) {
          material.transparent = false;
          material.alphaTest = 0;
          material.depthWrite = true;
          material.needsUpdate = true;
        }
        let geometry: THREE.BufferGeometry;
        if (groups.length === 1) geometry = source.clone();
        else {
          geometry = source.index ? source.toNonIndexed() : source.clone();
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

/** Only these packs are needed before driving; decoration is streamed separately. */
const CORE_PACKS: WorldPack[] = ['buildings', 'roads', 'petrol'];
const DECOR_PACKS = (Object.keys(WORLD_URLS) as WorldPack[]).filter(pack => !CORE_PACKS.includes(pack));
const listeners = new Set<() => void>();
export function onWorldAssetsChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

const pendingPacks = new Map<WorldPack, Promise<void>>();
function loadPack(pack: WorldPack): Promise<void> {
  if (worldAssets.has(pack)) return Promise.resolve();
  const pending = pendingPacks.get(pack);
  if (pending) return pending;
  const loading = (async () => {
    const { scene } = await loadGlb(WORLD_URLS[pack]);
    worldAssets.set(pack, prepareWorldPack(scene, pack));
    scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    releaseGlb(WORLD_URLS[pack]);
    listeners.forEach(listener => listener());
  })().finally(() => pendingPacks.delete(pack));
  pendingPacks.set(pack, loading);
  return loading;
}

/** One city download alongside the chosen vehicle avoids competing with every scenery pack. */
export function loadWorldAssets() {
  task ??= (async () => {
    for (const pack of CORE_PACKS) {
      try { await loadPack(pack); }
      catch { throw new Error(`Unable to load city pack: ${pack}. Please retry.`); }
    }
  })().catch(error => { task = null; throw error; });
  return task;
}

function waitForIdle(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const done = (ready: boolean) => { signal.removeEventListener('abort', abort); resolve(ready); };
    const abort = () => { cancel(); done(false); };
    const cancel = 'requestIdleCallback' in window
      ? (() => { const id = window.requestIdleCallback(() => done(true), { timeout: 1000 }); return () => window.cancelIdleCallback(id); })()
      : (() => { const id = setTimeout(() => done(true), 100); return () => clearTimeout(id); })();
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Background scenery never holds up play. Stop scheduling when paused or switching vehicles. */
export async function streamWorldAssets(signal: AbortSignal) {
  for (const pack of DECOR_PACKS) {
    if (worldAssets.has(pack)) continue;
    if (!await waitForIdle(signal) || signal.aborted) return;
    try { await loadPack(pack); }
    catch { /* Keep driving; unloaded optional packs can retry on the next resume. */ }
  }
}
