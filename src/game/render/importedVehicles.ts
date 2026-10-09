import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { VehicleSpec } from '../data/vehicles';
import { EXTRA_CARS, EXTRA_BY_ID } from '../data/importedCatalog';
import { loadGlb, releaseGlb } from './glbAssets';
import { cabinLayout, doorPivot } from '../vehicles/cabin';

export type ImportedModelId = NonNullable<VehicleSpec['importedModel']>;
const urls: Record<string, string> = {
  ...Object.fromEntries(EXTRA_CARS.map((car) => [car.id, new URL(`../../../assets/glb-files/${car.file}`, import.meta.url).href])),
  bmw_i8: new URL('../../../assets/glb-files/bmw_i8.glb', import.meta.url).href,
  bmw_m4_gt3: new URL('../../../assets/glb-files/2025_bmw_m4_gt3_evo_g82.glb', import.meta.url).href,
};

type ModelState = { status: 'loading' | 'ready' | 'error'; model?: THREE.Group };
const loading: ModelState = { status: 'loading' };
const states = new Map<ImportedModelId, ModelState>();
const pending = new Map<ImportedModelId, Promise<THREE.Group>>();
const listeners = new Set<() => void>();
export const subscribeModels = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const modelState = (id: ImportedModelId) => states.get(id) ?? loading;
const emit = () => listeners.forEach((listener) => listener());

/** Lazy, shared assets: garage and driving instances reuse geometry, textures and materials. */
export function loadImportedModel(spec: VehicleSpec, retry = false): Promise<THREE.Group> {
  const id = spec.importedModel!;
  if (retry && states.get(id)?.status === 'error') pending.delete(id);
  const existing = pending.get(id);
  if (existing) return existing;
  states.set(id, loading);
  emit();
  const task = loadGlb(urls[id], retry)
    .then(({ scene }) => {
      const extra = EXTRA_BY_ID.get(id);
      const selected = extra && 'node' in extra ? scene.getObjectByName(extra.node) : scene;
      if (!selected) throw new Error('Missing vehicle in traffic pack');
      const model = prepareImportedModel(selected as THREE.Group, spec);
      states.set(id, { status: 'ready', model });
      const pack = extra && 'node' in extra;
      if (!pack || EXTRA_CARS.filter((car) => 'node' in car).every((car) => states.get(car.id)?.status === 'ready')) {
        const geometries = new Set<THREE.BufferGeometry>();
        scene.traverse((o) => { if (o instanceof THREE.Mesh) geometries.add(o.geometry); });
        geometries.forEach((geometry) => geometry.dispose()); releaseGlb(urls[id]);
      }
      emit();
      return model;
    })
    .catch((error: unknown) => {
      states.set(id, { status: 'error' });
      emit();
      throw error;
    });
  pending.set(id, task);
  return task;
}

/** Preserve proportions, center X/Z, ground Y, and keep the supplied +Z front orientation. */
export function modelNormalization(bounds: THREE.Box3, length: number) {
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.z <= 0 || !Number.isFinite(size.z)) throw new Error('Invalid car model bounds');
  const scale = length / size.z;
  const center = bounds.getCenter(new THREE.Vector3());
  return new THREE.Matrix4().makeScale(scale, scale, scale).setPosition(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
}

/** The i8 has both rear wheels in one mesh. Split whole triangles, retaining UVs and normals. */
export function wheelSideGeometry(geometry: THREE.BufferGeometry, side: 1 | -1) {
  const p = geometry.getAttribute('position');
  const triangles: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    if ((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) * side > 0) triangles.push(i, i + 1, i + 2);
  }
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = new Float32Array(triangles.length * attribute.itemSize);
    triangles.forEach((index, j) => {
      for (let c = 0; c < attribute.itemSize; c++) values[j * attribute.itemSize + c] = attribute.getComponent(index, c);
    });
    result.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  return result;
}

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material; wheel: number | null; brake: boolean; door: number };

/** Copy complete triangles so separating wheels and doors never changes the closed model. */
export function triangleSubset(geometry: THREE.BufferGeometry, triangles: number[]) {
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (name.startsWith('skin')) continue;
    const values = new Float32Array(triangles.length * 3 * attribute.itemSize);
    triangles.forEach((triangle, j) => {
      for (let vertex = 0; vertex < 3; vertex++) for (let c = 0; c < attribute.itemSize; c++) {
        values[(j * 3 + vertex) * attribute.itemSize + c] = attribute.getComponent(triangle * 3 + vertex, c);
      }
    });
    result.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  return result;
}

export function prepareImportedModel(source: THREE.Group, spec: VehicleSpec) {
  source.updateWorldMatrix(true, true);
  const extra = EXTRA_BY_ID.get(spec.id);
  const yaw = extra && 'yaw' in extra ? extra.yaw : 0;
  const orientation = new THREE.Matrix4().makeRotationY(spec.id === 'western_star' ? Math.PI : yaw);
  const raw: { geometry: THREE.BufferGeometry; material: THREE.Material; name: string; wheelName: string; brake: boolean }[] = [];
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  source.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // This truck contains a displaced static duplicate and a skinned copy. Bake only the latter.
    if (spec.id === 'western_star' && !(o instanceof THREE.SkinnedMesh)) return;
    const original = o.geometry.clone();
    if (o instanceof THREE.SkinnedMesh) {
      const positions = original.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        o.getVertexPosition(i, point).applyMatrix4(o.matrixWorld);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      original.computeBoundingBox();
      // Negative-scale right-side parts in the supplied truck were exported 199 times too large.
      if (spec.id === 'western_star' && original.boundingBox!.getSize(point).length() > 50) original.scale(1 / 199, 1 / 199, 1 / 199);
    } else original.applyMatrix4(o.matrixWorld);
    original.applyMatrix4(orientation);
    const geo = original.index ? original.toNonIndexed() : original;
    if (geo !== original) original.dispose();
    geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight');
    geo.computeBoundingBox(); bounds.union(geo.boundingBox!);
    let wheelRoot: THREE.Object3D | null = o;
    while (wheelRoot && !/^(wheel(?:_?00[12])?|Vert(?:_?00[12])?|3DWheel[_ ](?:Front|Rear)[_ ][LR])$|(?:Front|Rear)(?:Left|Right)Wheel|3DWheel_(?:Front|Rear)_[LR]|Combined3DWheel.*(?:Front|Rear)_[LR]/i.test(wheelRoot.name)) wheelRoot = wheelRoot.parent;
    let wheelName = wheelRoot?.name ?? '';
    let name = o.name;
    if (o instanceof THREE.SkinnedMesh && spec.id === 'western_star') {
      const weights = o.geometry.getAttribute('skinWeight'); const indices = o.geometry.getAttribute('skinIndex');
      const counts = new Map<number, number>();
      for (let i = 0; i < indices.count; i++) for (let j = 0; j < 4; j++) {
        const index = indices.getComponent(i, j); counts.set(index, (counts.get(index) ?? 0) + weights.getComponent(i, j));
      }
      const bone = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      name = o.skeleton.bones[bone]?.name ?? o.name;
      if (/Wheel/i.test(name)) wheelName = name;
    }
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    raw.push({ geometry: geo, material, name, wheelName, brake: /Brake|Calip|Cali_/i.test(o.name + material.name) || /^Vert/i.test(wheelName) });
  });
  const normalize = modelNormalization(bounds, spec.length);
  raw.forEach((p) => { p.geometry.applyMatrix4(normalize); p.geometry.computeBoundingBox(); });
  const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(spec.length / bounds.getSize(point).z);
  const wheelBounds = spec.wheels.visual.map(() => new THREE.Box3());
  const frontYaw: number[] = [];
  const parts: Part[] = [];
  const c = cabinLayout(spec);
  // A small histogram finds tire axles even in exports that merged the entire car into one mesh.
  const bins = new Float64Array(100);
  for (const p of raw) {
    if (!/tire|tyre|rubber|good.year|wheel/i.test(p.material.name + p.wheelName)) continue;
    const a = p.geometry.getAttribute('position');
    for (let i = 0; i < a.count; i++) if (a.getY(i) < spec.wheelRadius * .35 && Math.abs(a.getX(i)) > size.x * .27) {
      const bin = Math.max(0, Math.min(99, Math.floor((a.getZ(i) / spec.length + .5) * 100))); bins[bin]++;
    }
  }
  const peak = (start: number, end: number, fallback: number) => {
    let best = -1, amount = 0;
    for (let i = start; i < end; i++) {
      let sum = 0; for (let j = Math.max(start, i - 3); j <= Math.min(end - 1, i + 3); j++) sum += bins[j];
      if (sum > amount) { amount = sum; best = i; }
    }
    return best < 0 ? fallback : ((best + .5) / 100 - .5) * spec.length;
  };
  const axleZ = [peak(51, 95, spec.wheels.visual[0].z), peak(5, 49, spec.wheels.visual[2].z)];
  const oldBMW = spec.id === 'bmw_i8' || spec.id === 'bmw_m4_gt3';
  const tireBounds = spec.wheels.visual.map(() => new THREE.Box3());
  const assemblyBounds = spec.wheels.visual.map(() => new THREE.Box3());
  const wheelIndex = (name: string, x: number, z: number) => {
    const front = !oldBMW && spec.id !== 'western_star' ? z >= 0 : /Front|Wheel_F/i.test(name) || /^(wheel|wheel_?002|Vert|Vert_?002)$/i.test(name);
    return (front ? 0 : /Wheel_BB/i.test(name) ? 4 : 2) + (x >= 0 ? 0 : 1);
  };
  // Tire-only bounds supply the pivot. Trim, suspension and brake calipers must not move it.
  for (const p of raw) {
    const a = p.geometry.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      const axle = Math.abs(z - axleZ[0]) < Math.abs(z - axleZ[1]) ? 0 : 1;
      const index = p.wheelName ? wheelIndex(p.wheelName, x, z) : axle * 2 + (x >= 0 ? 0 : 1);
      if (p.wheelName && !p.brake) assemblyBounds[index]?.expandByPoint(point.set(x, y, z));
      if (/tire|tyre|rubber|good.year/i.test(p.material.name) && y < spec.wheelRadius * 2.3 && Math.abs(x) > size.x * .3 && Math.abs(z - axleZ[axle]) < spec.wheelRadius * 1.1) tireBounds[index]?.expandByPoint(point.set(x, y, z));
    }
  }
  const pivots = spec.wheels.visual.map((w, i) => {
    const b = oldBMW && !assemblyBounds[i].isEmpty() ? assemblyBounds[i] : !tireBounds[i].isEmpty() ? tireBounds[i] : assemblyBounds[i];
    const center = b.isEmpty() ? new THREE.Vector3(w.x, w.radius, axleZ[i < 2 ? 0 : 1]) : b.getCenter(new THREE.Vector3());
    const dimensions = b.getSize(new THREE.Vector3());
    const radius = b.isEmpty() ? w.radius : Math.min(dimensions.y, dimensions.z) / 2;
    return { center, radius: THREE.MathUtils.clamp(radius, w.radius * .8, w.radius * 1.4) };
  });
  for (const p of raw) {
    const a = p.geometry.getAttribute('position');
    const groups = new Map<string, { wheel: number | null; door: number; triangles: number[] }>();
    for (let i = 0; i < a.count; i += 3) {
      const x = (a.getX(i) + a.getX(i + 1) + a.getX(i + 2)) / 3;
      const y = (a.getY(i) + a.getY(i + 1) + a.getY(i + 2)) / 3;
      const z = (a.getZ(i) + a.getZ(i + 1) + a.getZ(i + 2)) / 3;
      const side = x >= 0 ? 0 : 1;
      let wheel: number | null = null;
      if (p.wheelName && !spec.npcOnly) {
        wheel = wheelIndex(p.wheelName, x, z);
      } else if (!oldBMW) {
        const axle = Math.abs(z - axleZ[0]) < Math.abs(z - axleZ[1]) ? 0 : 1;
        const pivot = pivots[axle * 2 + side];
        const nearWheel = !spec.npcOnly && Math.hypot(z - pivot.center.z, y - pivot.center.y) < pivot.radius * 1.04 && Math.abs(x) > size.x * .33;
        if (nearWheel && !/glass|light|interior|carpaint|body/i.test(p.material.name)) wheel = axle * 2 + side;
      }
      if (wheel !== null) {
        const pivot = pivots[wheel];
        if (!pivot || Math.hypot(z - pivot.center.z, y - pivot.center.y) > pivot.radius * 1.08) wheel = null;
      }
      const explicitDoor = /Door_[LR]|door(?:_|$)/i.test(p.name) && !/Indoor/i.test(p.name);
      const inDoor = z > c.back && z < c.front && y > c.sill && y < spec.height * .94 && Math.abs(x) > size.x * .32;
      const door = !spec.npcOnly && wheel === null && (explicitDoor || inDoor) ? (x > 0 ? 1 : -1) : 0;
      const key = `${wheel}:${door}`;
      const group = groups.get(key) ?? { wheel, door, triangles: [] }; group.triangles.push(i / 3); groups.set(key, group);
    }
    for (const group of groups.values()) {
      const geometry = triangleSubset(p.geometry, group.triangles);
      geometry.computeBoundingBox();
      parts.push({ geometry, material: p.material, wheel: group.wheel, brake: p.brake, door: group.door });
      if (group.wheel !== null && !p.brake) wheelBounds[group.wheel].union(geometry.boundingBox!);
    }
    // Retain the i8's factory front-wheel correction.
    if (spec.id === 'bmw_i8' && /^wheel(?:_?002)?$/i.test(p.wheelName)) {
      const o = source.getObjectByName(p.wheelName); if (o) frontYaw[p.geometry.boundingBox!.getCenter(point).x > 0 ? 0 : 1] = Math.atan2(-o.matrixWorld.elements[2], o.matrixWorld.elements[0]);
    }
    p.geometry.dispose();
  }
  const model = new THREE.Group(); model.name = `imported-vehicle-${spec.id}`;
  model.userData.dimensions = size.toArray();
  const body = new THREE.Group(); body.name = 'imported-body'; model.add(body);
  const doors = [1, -1].map((side) => { const door = new THREE.Group(); door.name = `vehicle-door-${side}`; door.position.copy(doorPivot(spec, side)); body.add(door); return door; });
  const wheels = wheelBounds.map((bounds, i) => {
    const steer = new THREE.Group(); steer.name = `imported-wheel-${i}`;
    if (!bounds.isEmpty()) steer.position.copy(pivots[i].center);
    else { const w = spec.wheels.visual[i]; steer.position.set(w.x, w.radius, w.z); }
    steer.userData.restY = steer.position.y;
    steer.userData.radius = pivots[i].radius;
    const spin = new THREE.Group(); spin.name = `imported-wheel-spin-${i}`; steer.add(spin); model.add(steer); return { steer, spin };
  });
  const batches = new Map<string, { parent: THREE.Group; material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  for (const part of parts) {
    let parent = body;
    if (part.wheel !== null) {
      const wheel = wheels[part.wheel]; part.geometry.translate(-wheel.steer.position.x, -wheel.steer.position.y, -wheel.steer.position.z);
      if (frontYaw[part.wheel]) part.geometry.rotateY(-frontYaw[part.wheel]); parent = part.brake ? wheel.steer : wheel.spin;
    } else if (part.door) { parent = doors[part.door > 0 ? 0 : 1]; part.geometry.translate(-parent.position.x, -parent.position.y, -parent.position.z); }
    const key = `${parent.uuid}|${part.material.uuid}|${Object.keys(part.geometry.attributes).sort().join(',')}`;
    const batch = batches.get(key) ?? { parent, material: part.material, geometries: [] }; batch.geometries.push(part.geometry); batches.set(key, batch);
  }
  for (const { parent, material, geometries } of batches.values()) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    if (!geometry) throw new Error('Unable to batch car meshes');
    if (geometries.length > 1) geometries.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = !material.transparent; mesh.receiveShadow = true;
    if (material.transparent) material.depthWrite = false; parent.add(mesh);
  }
  model.updateMatrixWorld(true); return model;
}

/** Match the support points/radii to the imported tires instead of approximating every car alike. */
export function calibratedVehicleSpec(spec: VehicleSpec, model?: THREE.Group): VehicleSpec {
  if (!model || spec.npcOnly) return spec;
  const visual = spec.wheels.visual.map((w, i) => {
    const wheel = model.getObjectByName(`imported-wheel-${i}`);
    return wheel ? { ...w, x: wheel.position.x, z: wheel.position.z, radius: wheel.userData.radius as number } : w;
  });
  return { ...spec, cabinHeight: Math.min(spec.height, model.userData.dimensions[1]),
    wheelRadius: visual.reduce((sum, w) => sum + w.radius, 0) / visual.length,
    wheels: { visual, physics: spec.wheels.physics.map((w, i) => ({ ...w, x: visual[i].x, z: visual[i].z })) } };
}

const environments = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
/** Reflections illuminate the original metallic paint/chrome in the garage and on the road. */
export function applyVehicleEnvironment(model: THREE.Group, renderer: THREE.WebGLRenderer) {
  let texture = environments.get(renderer);
  if (!texture) {
    const generator = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    texture = generator.fromScene(room, 0.04).texture;
    generator.dispose();
    room.dispose();
    environments.set(renderer, texture);
  }
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial) || o.material.envMap === texture) return;
    o.material.envMap = texture;
    o.material.envMapIntensity = 0.85;
    o.material.needsUpdate = true;
  });
}
