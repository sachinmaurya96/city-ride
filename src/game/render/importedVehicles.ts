import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { VehicleSpec } from '../data/vehicles';
import { BIKE_MODELS, CAR_CABINS, EXTRA_CARS, EXTRA_BY_ID, carDoor, doorInner, driverCabin, type CarCabin, type CarDoor } from '../data/importedCatalog';
import { loadGlb, releaseGlb } from './glbAssets';
import { cabinLayout, doorPivot } from '../vehicles/cabin';

export type ImportedModelId = NonNullable<VehicleSpec['importedModel']>;
const urls: Record<string, string> = {
  lambo_lp670: new URL('../../../assets/optimized/vehicles/lambo.glb', import.meta.url).href,
  black_huracan: new URL('../../../assets/optimized/vehicles/black-lambo.glb', import.meta.url).href,
  mclaren_p1: new URL('../../../assets/optimized/vehicles/mclaren.glb', import.meta.url).href,
  mustang_rtr: new URL('../../../assets/optimized/vehicles/mustang.glb', import.meta.url).href,
  porsche_718: new URL('../../../assets/optimized/vehicles/2020_porsche_718_spyder.glb', import.meta.url).href,
  supra_a80: new URL('../../../assets/optimized/vehicles/toyota_supra_a80_1993.glb', import.meta.url).href,
  police_car: new URL('../../../assets/optimized/vehicles/arunangshubanerjee-police-car-2064.glb', import.meta.url).href,
  amg_gt_mansory: new URL('../../../assets/optimized/vehicles/2016_mansory_mercedes-amg_gt_s.glb', import.meta.url).href,
  naran_hyper: new URL('../../../assets/optimized/vehicles/2020_naran_hyper_coupe.glb', import.meta.url).href,
  aston_one77: new URL('../../../assets/optimized/vehicles/aston-martin.glb', import.meta.url).href,
  audi_r8_gt: new URL('../../../assets/optimized/vehicles/audi.glb', import.meta.url).href,
  bmw_m4_widebody: new URL('../../../assets/optimized/vehicles/bmw_m4_widebody__www.vecarz.com.glb', import.meta.url).href,
  bmw_m3_gtr: new URL('../../../assets/optimized/vehicles/m3gtr.glb', import.meta.url).href,
  rolls_ghost: new URL('../../../assets/optimized/vehicles/rolls-royce_ghost.glb', import.meta.url).href,
  ...Object.fromEntries(EXTRA_CARS.filter(car => car.id.startsWith('pack_')).map(car => [car.id, new URL('../../../assets/optimized/vehicles/traffic_racer_npc_vehicles_pack.glb', import.meta.url).href])),
  bmw_i8: new URL('../../../assets/optimized/vehicles/bmw_i8.glb', import.meta.url).href,
  bmw_m4_gt3: new URL('../../../assets/optimized/vehicles/2025_bmw_m4_gt3_evo_g82.glb', import.meta.url).href,
  mercedes_maybach: new URL('../../../assets/optimized/vehicles/maercedes.glb', import.meta.url).href,
  bike_basic: new URL('../../../assets/optimized/vehicles/ninjabike.glb', import.meta.url).href,
  ducati_v4r: new URL('../../../assets/optimized/vehicles/ducativ4r.glb', import.meta.url).href,
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
      const model = spec.kind === 'bike' ? prepareImportedBike(selected as THREE.Group, spec) : prepareImportedModel(selected as THREE.Group, spec);
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

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material; wheel: number | null; brake: boolean; door: number; steer?: boolean };

/** Mirror triangle t of a non-indexed geometry across x = 0, keeping its winding (front faces) and shading. */
function mirrorTriangle(geometry: THREE.BufferGeometry, t: number) {
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const i = t * 3, n = attribute.itemSize;
    if (name === 'position' || name === 'normal' || name === 'tangent') for (let v = 0; v < 3; v++) {
      attribute.setComponent(i + v, 0, -attribute.getComponent(i + v, 0));
      if (name === 'tangent' && n > 3) attribute.setComponent(i + v, 3, -attribute.getComponent(i + v, 3));
    }
    // Swap the 2nd and 3rd vertex so the mirrored triangle still faces outward.
    for (let c = 0; c < n; c++) { const tmp = attribute.getComponent(i + 1, c); attribute.setComponent(i + 1, c, attribute.getComponent(i + 2, c)); attribute.setComponent(i + 2, c, tmp); }
    attribute.needsUpdate = true;
  }
}

/**
 * Left-hand-drive models in a keep-left city: mirror the front of the cockpit (dashboard, instruments, steering
 * wheel, pedals) across the centre line in place, so the wheel sits ahead of the right-hand seat. Nothing is added
 * or lost and the bodywork outside the cabin (badges, text) keeps its orientation. A single race seat is copied.
 */
export function mirrorCockpit(raw: { geometry: THREE.BufferGeometry }[], cabin: CarCabin, halfWidth: number) {
  const [, wy, wz] = cabin.wheel.centre, inner = Math.min(halfWidth * .64 - .02, Math.abs(cabin.wheel.centre[0]) + .3);
  const z0 = cabin.swapFrom ?? wz - .32, z1 = wz + 1.1, y0 = cabin.floor - .15, y1 = wy + cabin.wheel.radius + .22;
  let mirrored = 0, copied = 0;
  for (const part of raw) {
    const p = part.geometry.getAttribute('position'), copies: number[] = [];
    for (let t = 0; t < p.count / 3; t++) {
      const i = t * 3, x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      if (Math.abs(x) < inner && y > y0 && y < y1 && z > z0 && z < z1) { mirrorTriangle(part.geometry, t); mirrored++; }
      else if (cabin.copySeat && x > .08 && x < inner && y > y0 && y < 1.05 && z > cabin.copySeat[0] && z < cabin.copySeat[1]) copies.push(t);
    }
    if (copies.length) {
      const copy = triangleSubset(part.geometry, copies);
      for (let t = 0; t < copies.length; t++) mirrorTriangle(copy, t);
      const merged = mergeGeometries([part.geometry, copy]);
      if (merged) { part.geometry.dispose(); part.geometry = merged; copied += copies.length; }
      copy.dispose();
    }
  }
  return { mirrored, copied };
}

/** Point-in-polygon (even-odd) for a side-view door outline of (z, y) points. */
export function insideOutline(z: number, y: number, outline: readonly (readonly [number, number])[]) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [zi, yi] = outline[i], [zj, yj] = outline[j];
    if ((yi > y) !== (yj > y) && z < (zj - zi) * (y - yi) / (yj - yi) + zi) inside = !inside;
  }
  return inside;
}

/**
 * Bodies are often one continuous mesh across a door seam, so whole triangles would leave teeth along the cut. Split
 * every triangle that straddles the traced outline (beyond the trim depth) on the line of the seam it crosses, with
 * interpolated UVs/normals, so the door and the body part exactly on the seam. Corners take up to three passes.
 */
export function splitAtDoorSeams(geometry: THREE.BufferGeometry, door: CarDoor) {
  const outline = door.outline, zs = outline.map(([z]) => z), ys = outline.map(([, y]) => y);
  const box = { z0: Math.min(...zs), z1: Math.max(...zs), y0: Math.min(...ys), y1: Math.max(...ys) };
  let current = geometry;
  for (let pass = 0; pass < 3; pass++) {
    const p = current.getAttribute('position'), count = p.count / 3, cuts = new Map<number, number>();
    for (let t = 0; t < count; t++) {
      const i = t * 3, z0 = p.getZ(i), z1 = p.getZ(i + 1), z2 = p.getZ(i + 2);
      if ((z0 < box.z0 && z1 < box.z0 && z2 < box.z0) || (z0 > box.z1 && z1 > box.z1 && z2 > box.z1)) continue;
      const y0 = p.getY(i), y1 = p.getY(i + 1), y2 = p.getY(i + 2);
      if ((y0 < box.y0 && y1 < box.y0 && y2 < box.y0) || (y0 > box.y1 && y1 > box.y1 && y2 > box.y1)) continue;
      if (Math.abs(p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 <= doorInner(door, (y0 + y1 + y2) / 3) - .05) continue;
      const y = [y0, y1, y2], z = [z0, z1, z2];
      const inside = [0, 1, 2].map((k) => insideOutline(z[k], y[k], outline));
      if (inside[0] === inside[1] && inside[1] === inside[2]) continue;
      // The seam it crosses: the outline edge that its own edges intersect, nearest its centre.
      let best = -1, bestDistance = Infinity;
      const cz = (z[0] + z[1] + z[2]) / 3, cy = (y[0] + y[1] + y[2]) / 3;
      for (let e = 0; e < outline.length; e++) {
        const [ez0, ey0] = outline[e], [ez1, ey1] = outline[(e + 1) % outline.length];
        const crosses = [0, 1, 2].some((k) => {
          const za = z[k], ya = y[k], zb = z[(k + 1) % 3], yb = y[(k + 1) % 3];
          const d = (ez1 - ez0) * (yb - ya) - (ey1 - ey0) * (zb - za); if (Math.abs(d) < 1e-12) return false;
          const u = ((za - ez0) * (yb - ya) - (ya - ey0) * (zb - za)) / d, w = ((za - ez0) * (ey1 - ey0) - (ya - ey0) * (ez1 - ez0)) / d;
          return u >= 0 && u <= 1 && w >= 0 && w <= 1;
        });
        const distance = ((ez0 + ez1) / 2 - cz) ** 2 + ((ey0 + ey1) / 2 - cy) ** 2;
        if (crosses && distance < bestDistance) { bestDistance = distance; best = e; }
      }
      if (best >= 0) cuts.set(t, best);
    }
    if (!cuts.size) break;
    // Each cut triangle becomes three: the lone vertex's triangle and the opposite quad as two triangles.
    const attributes = Object.entries(current.attributes), out = attributes.map(([, a]) => new Float32Array((count + cuts.size * 2) * 3 * a.itemSize));
    const written = attributes.map(() => 0), push = (a: number, values: ArrayLike<number>) => { out[a].set(values, written[a]); written[a] += values.length; };
    const read = (a: number, vertex: number) => { const attribute = attributes[a][1]; return Array.from({ length: attribute.itemSize }, (_, c) => attribute.getComponent(vertex, c)); };
    for (let t = 0; t < count; t++) {
      const edge = cuts.get(t);
      let lone = -1, side: number[] = [];
      if (edge !== undefined) {
        const [ez0, ey0] = outline[edge], [ez1, ey1] = outline[(edge + 1) % outline.length];
        side = [0, 1, 2].map((k) => (ez1 - ez0) * (p.getY(t * 3 + k) - ey0) - (ey1 - ey0) * (p.getZ(t * 3 + k) - ez0));
        if (side.every((d) => Math.abs(d) > 1e-9)) lone = [0, 1, 2].find((k) => Math.sign(side[k]) !== Math.sign(side[(k + 1) % 3]) && Math.sign(side[k]) !== Math.sign(side[(k + 2) % 3])) ?? -1;
      }
      for (let a = 0; a < attributes.length; a++) {
        if (lone < 0) {
          const attribute = attributes[a][1];
          for (let k = 0; k < 3; k++) for (let c = 0; c < attribute.itemSize; c++) out[a][written[a]++] = attribute.getComponent(t * 3 + k, c);
          continue;
        }
        const v = [0, 1, 2].map((k) => read(a, t * 3 + k));
        const lerp = (i: number, j: number) => { const f = side[i] / (side[i] - side[j]); return v[i].map((value, c) => value + (v[j][c] - value) * f); };
        const b = (lone + 1) % 3, c = (lone + 2) % 3, ab = lerp(lone, b), ac = lerp(lone, c);
        for (const values of [v[lone], ab, ac, ab, v[b], v[c], ab, v[c], ac]) push(a, values);
      }
    }
    const result = new THREE.BufferGeometry();
    attributes.forEach(([name, attribute], a) => {
      const values = out[a].subarray(0, written[a]);
      if (name === 'normal') for (let i = 0; i < values.length; i += 3) { const l = Math.hypot(values[i], values[i + 1], values[i + 2]) || 1; values[i] /= l; values[i + 1] /= l; values[i + 2] /= l; }
      result.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
    });
    if (current !== geometry) current.dispose();
    current = result;
  }
  return current;
}

/** The steering wheel's frame: origin at the rim centre, +Z toward the driver, +Y toward 12 o'clock. */
export function steeringFrame(wheel: { centre: readonly number[]; normal: readonly number[] }) {
  const z = new THREE.Vector3(...wheel.normal).normalize(), y = new THREE.Vector3(0, 1, 0).addScaledVector(z, -z.y).normalize();
  return new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z).setPosition(new THREE.Vector3(...wheel.centre));
}

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
  const orientation = new THREE.Matrix4().makeRotationY(yaw);
  const raw: { geometry: THREE.BufferGeometry; material: THREE.Material; name: string; wheelName: string; brake: boolean }[] = [];
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  source.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // The Maybach file ships inside a 10 m showroom box with light-streak planes; it is not part of the car.
    if (spec.id === 'mercedes_maybach' && /frame/i.test((Array.isArray(o.material) ? o.material[0] : o.material).name)) return;
    const original = o.geometry.clone();
    if (o instanceof THREE.SkinnedMesh) {
      const positions = original.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        o.getVertexPosition(i, point).applyMatrix4(o.matrixWorld);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
    } else original.applyMatrix4(o.matrixWorld);
    original.applyMatrix4(orientation);
    const geo = original.index ? original.toNonIndexed() : original;
    if (geo !== original) original.dispose();
    geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight');
    geo.computeBoundingBox(); bounds.union(geo.boundingBox!);
    let wheelRoot: THREE.Object3D | null = o;
    while (wheelRoot && !/^(wheel(?:_?00[12])?|Vert(?:_?00[12])?|3DWheel[_ ](?:Front|Rear)[_ ][LR])$|(?:Front|Rear)(?:Left|Right)Wheel|3DWheel_(?:Front|Rear)_[LR]|Combined3DWheel.*(?:Front|Rear)_[LR]/i.test(wheelRoot.name)) wheelRoot = wheelRoot.parent;
    const wheelName = wheelRoot?.name ?? '';
    const name = o.name;
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    raw.push({ geometry: geo, material, name, wheelName, brake: /Brake|Calip|Cali_/i.test(o.name + material.name) || /^Vert/i.test(wheelName) });
  });
  const normalize = modelNormalization(bounds, spec.length);
  raw.forEach((p) => { p.geometry.applyMatrix4(normalize); p.geometry.computeBoundingBox(); });
  const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(spec.length / bounds.getSize(point).z);
  const measured = CAR_CABINS[spec.id], cabin = driverCabin(spec.id), measuredDoor = carDoor(spec.id);
  if (measured?.lhd && !spec.npcOnly) mirrorCockpit(raw, measured, size.x / 2);
  // The driver's steering wheel turns with the steering: its rim, spokes and hub become their own part.
  const steerFrame = cabin && !spec.npcOnly ? steeringFrame(cabin.wheel) : null, steerInverse = steerFrame?.clone().invert();
  const wheelLocal = new THREE.Vector3();
  const onSteeringWheel = (x: number, y: number, z: number) => {
    if (!steerInverse || !cabin) return false;
    wheelLocal.set(x, y, z).applyMatrix4(steerInverse);
    return Math.hypot(wheelLocal.x, wheelLocal.y) < cabin.wheel.radius + .035 && wheelLocal.z > -.05 && wheelLocal.z < .1;
  };
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
    const front = !oldBMW ? z >= 0 : /Front|Wheel_F/i.test(name) || /^(wheel|wheel_?002|Vert|Vert_?002)$/i.test(name);
    return (front ? 0 : 2) + (x >= 0 ? 0 : 1);
  };
  // Tire-only bounds supply the pivot. Trim, suspension and brake calipers (even a 'Tire_Brake' material) must not move it.
  for (const p of raw) {
    const a = p.geometry.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      const axle = Math.abs(z - axleZ[0]) < Math.abs(z - axleZ[1]) ? 0 : 1;
      const index = p.wheelName ? wheelIndex(p.wheelName, x, z) : axle * 2 + (x >= 0 ? 0 : 1);
      if (p.wheelName && !p.brake) assemblyBounds[index]?.expandByPoint(point.set(x, y, z));
      if (!p.brake && /tire|tyre|rubber|good.year/i.test(p.material.name) && y < spec.wheelRadius * 2.3 && Math.abs(x) > size.x * .3 && Math.abs(z - axleZ[axle]) < spec.wheelRadius * 1.1) tireBounds[index]?.expandByPoint(point.set(x, y, z));
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
    if (measuredDoor && !spec.npcOnly) { const cut = splitAtDoorSeams(p.geometry, measuredDoor); if (cut !== p.geometry) { p.geometry.dispose(); p.geometry = cut; } }
    const a = p.geometry.getAttribute('position');
    const groups = new Map<string, { wheel: number | null; door: number; steer: boolean; triangles: number[] }>();
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
      const explicitDoor = !measuredDoor && /Door_[LR]|door(?:_|$)/i.test(p.name) && !/Indoor/i.test(p.name);
      // Measured cars cut the panel along its traced seams (skin through inner trim); others use a box.
      const inDoor = measuredDoor ? Math.abs(x) > doorInner(measuredDoor, y) && insideOutline(z, y, measuredDoor.outline)
        : z > c.back && z < c.front && y > c.sill && y < spec.height * .94 && Math.abs(x) > size.x * .32;
      const door = !spec.npcOnly && wheel === null && (explicitDoor || inDoor) ? (x > 0 ? 1 : -1) : 0;
      const steer = wheel === null && door === 0 && [0, 1, 2].every((v) => onSteeringWheel(a.getX(i + v), a.getY(i + v), a.getZ(i + v)));
      const key = `${wheel}:${door}:${steer}`;
      const group = groups.get(key) ?? { wheel, door, steer, triangles: [] }; group.triangles.push(i / 3); groups.set(key, group);
    }
    for (const group of groups.values()) {
      const geometry = triangleSubset(p.geometry, group.triangles);
      geometry.computeBoundingBox();
      parts.push({ geometry, material: p.material, wheel: group.wheel, brake: p.brake, door: group.door, steer: group.steer });
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
  const steering = new THREE.Group(); steering.name = 'steering-wheel';
  // userData survives clone() only as JSON: keep the rest orientation as a plain array.
  if (steerFrame) { steerFrame.decompose(steering.position, steering.quaternion, steering.scale); steering.userData.rest = steering.quaternion.toArray(); steering.userData.radius = cabin!.wheel.radius; body.add(steering); }
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
    else if (part.steer && steerInverse) { parent = steering; part.geometry.applyMatrix4(steerInverse); }
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

export interface BikeRig { hip: THREE.Vector3; grips: [THREE.Vector3, THREE.Vector3]; pegs: [THREE.Vector3, THREE.Vector3]; steerZ: number }
type RigPoint = readonly [number, number, number];
const pair = ([x, y, z]: RigPoint) => [new THREE.Vector3(x, y, z), new THREE.Vector3(-x, y, z)] as [THREE.Vector3, THREE.Vector3];
function catalogBikeRig(rig: { hip: RigPoint; grip: RigPoint; peg: RigPoint }, steerZ: number): BikeRig {
  return { hip: new THREE.Vector3(...rig.hip), grips: pair(rig.grip), pegs: pair(rig.peg), steerZ };
}

/**
 * Fallback for bikes without measured contact points, tuned on the supplied Ninja and Ducati:
 * - seat: the dip in the top surface (sampled across triangles: seats are big flat panels) between tail and tank;
 * - grips: the widest points 30–45 cm behind the front axle at about seat height (levers, fairing and mirrors sit further forward);
 * - pegs: the widest pair present on both sides just below and behind the hip (exhausts are one-sided).
 */
export function detectBikeRig(raw: { geometry: THREE.BufferGeometry }[], size: THREE.Vector3, axle: number[], radius: number[]): BikeRig {
  const L = size.z, top = new Float64Array(120).fill(-Infinity), z0 = axle[1] + radius[1] * .3, z1 = Math.min(.15, axle[0] - radius[0]);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
  for (const { geometry } of raw) {
    const a = geometry.getAttribute('position');
    for (let i = 0; i + 2 < a.count; i += 3) {
      A.fromBufferAttribute(a, i); B.fromBufferAttribute(a, i + 1); C.fromBufferAttribute(a, i + 2);
      if (Math.abs((A.x + B.x + C.x) / 3) > .1) continue;
      for (let u = 0; u <= 1; u += .125) for (let v = 0; u + v <= 1; v += .125) {
        P.copy(A).multiplyScalar(1 - u - v).addScaledVector(B, u).addScaledVector(C, v);
        if (P.z <= z0 || P.z >= z1 || Math.abs(P.x) > .1) continue;
        const bin = Math.min(119, Math.floor((P.z - z0) / (z1 - z0) * 120)); top[bin] = Math.max(top[bin], P.y);
      }
    }
  }
  let seat = -1; top.forEach((y, b) => { if (y > size.y * .45 && (seat < 0 || y < top[seat] - .004)) seat = b; });
  // Riders sit at the front of the flat seat area, just behind the tank.
  let front = seat; while (seat >= 0 && front + 1 < 120 && top[front + 1] > size.y * .45 && top[front + 1] < top[seat] + .015) front++;
  const seatY = seat < 0 ? size.y * .7 : top[seat], seatZ = seat < 0 ? -L * .12 : z0 + (front + .5) / 120 * (z1 - z0) - .04;
  const hip = new THREE.Vector3(0, seatY + .09, seatZ);
  // Grips: outermost points in the clip-on window.
  const grip = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  // Pegs: per-side widest point in 1 cm (y, z) cells; keep cells wide on both sides.
  const cells = [new Map<string, number>(), new Map<string, number>()];
  for (const { geometry } of raw) {
    const a = geometry.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i), s = x >= 0 ? 0 : 1, w = Math.abs(x);
      if (z > axle[0] - .45 && z < axle[0] - .3 && y > seatY - .1 && y < seatY + .12 && w > grip[s].x) grip[s] = { x: w, y, z };
      if (z > hip.z - .25 && z < hip.z + .05 && y > .25 && y < .5 && w > .15 && w < .34) {
        const key = `${Math.round(y * 100)},${Math.round(z * 100)}`; cells[s].set(key, Math.max(cells[s].get(key) ?? 0, w));
      }
    }
  }
  let peg = new THREE.Vector3(.22, .38, hip.z - .05), best = 0;
  cells[0].forEach((w, key) => {
    const other = cells[1].get(key); if (other === undefined || Math.abs(other - w) > .03) return;
    const [cy, cz] = key.split(',').map(Number), width = Math.min(w, other);
    if (width > best) { best = width; peg = new THREE.Vector3(width - .035, cy / 100, cz / 100); }
  });
  // The hand sits on the grip a few centimetres inboard of the bar end.
  const grips = grip.map((g, s) => g.x ? new THREE.Vector3((s ? -1 : 1) * (g.x - .035), g.y, g.z + .01) : new THREE.Vector3((s ? -1 : 1) * .32, seatY, axle[0] - .38)) as [THREE.Vector3, THREE.Vector3];
  return { hip, grips, pegs: [peg, new THREE.Vector3(-peg.x, peg.y, peg.z)], steerZ: axle[0] - radius[0] * .9 };
}

/**
 * Motorcycles arrive as unnamed meshes, so the wheels are found from the shape: the two ground-contact
 * clusters give the axles, the tyre's fore/aft extent at axle height gives each radius. Seat and handlebar
 * grips are measured too, so the rider sits on the real seat with hands on the real bars.
 */
export function prepareImportedBike(source: THREE.Group, spec: VehicleSpec, options: { useCatalogRig?: boolean } = {}) {
  source.updateWorldMatrix(true, true);
  const yaw = BIKE_MODELS[spec.id as keyof typeof BIKE_MODELS]?.yaw ?? 0;
  const orientation = new THREE.Matrix4().makeRotationY(yaw);
  const raw: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  const bounds = new THREE.Box3();
  source.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const original = o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(orientation);
    const geometry = original.index ? original.toNonIndexed() : original;
    if (geometry !== original) original.dispose();
    geometry.computeBoundingBox(); bounds.union(geometry.boundingBox!);
    raw.push({ geometry, material: Array.isArray(o.material) ? o.material[0] : o.material });
  });
  const normalize = modelNormalization(bounds, spec.length);
  raw.forEach((p) => { p.geometry.applyMatrix4(normalize); p.geometry.computeBoundingBox(); });
  const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(spec.length / bounds.getSize(new THREE.Vector3()).z);
  const guessR = spec.wheelRadius;
  const each = (fn: (x: number, y: number, z: number) => void) => raw.forEach(({ geometry }) => {
    const a = geometry.getAttribute('position'); for (let i = 0; i < a.count; i++) fn(a.getX(i), a.getY(i), a.getZ(i));
  });
  // Tyres are the front-most / rear-most low parts. The height of that tip above the tyre's bottom is the
  // radius (the tip is level with the axle) and the axle sits one radius inside it. Kickstands, which can
  // reach lower than the tyres, sit mid-bike and never form the tip.
  const lowBand = guessR * 1.3, slim = size.x * .2;
  const tips = [-Infinity, Infinity];
  each((x, y, z) => { if (y < lowBand && Math.abs(x) < slim) { tips[0] = Math.max(tips[0], z); tips[1] = Math.min(tips[1], z); } });
  const tipY = [{ y: 0, n: 0 }, { y: 0, n: 0 }], bottom = [Infinity, Infinity];
  each((x, y, z) => {
    if (Math.abs(x) >= slim) return;
    tips.forEach((tip, k) => {
      const inside = k ? z - tip : tip - z;
      if (y < lowBand && inside < .012) { tipY[k].y += y; tipY[k].n++; }
      if (inside >= 0 && inside < guessR * 2.4) bottom[k] = Math.min(bottom[k], y);
    });
  });
  const radius = tipY.map((t, k) => THREE.MathUtils.clamp(t.n ? t.y / t.n - bottom[k] : guessR, guessR * .7, guessR * 1.45));
  const axle = tips.map((tip, k) => tip + (k ? radius[k] : -radius[k]));
  const centerY = radius.map((r, k) => bottom[k] === Infinity ? r : bottom[k] + r);
  const centers = axle.map((z, i) => new THREE.Vector3(0, centerY[i], z));
  // Tyre half-width, measured at the contact patch. Fork legs and brake calipers sit outside it, so only
  // the tyre and rim spin (spinning the fork made it look bent).
  const halfWidth = [0, 0];
  each((x, y, z) => centers.forEach((c, k) => {
    if (Math.abs(z - c.z) < radius[k] * .35 && y < c.y - radius[k] * .7 && Math.abs(x) < slim) halfWidth[k] = Math.max(halfWidth[k], Math.abs(x));
  }));
  halfWidth.forEach((w, k) => { halfWidth[k] = THREE.MathUtils.clamp(w * 1.12, .045, slim); });
  const rig = options.useCatalogRig !== false && BIKE_MODELS[spec.id as keyof typeof BIKE_MODELS]?.rig;
  const measured = rig ? catalogBikeRig(rig, axle[0] - radius[0] * .9) : detectBikeRig(raw, size, axle, radius);
  // Split each mesh: triangles inside a tyre disc spin with that wheel, the rest is the body.
  const model = new THREE.Group(); model.name = `imported-vehicle-${spec.id}`;
  model.userData.dimensions = size.toArray();
  const body = new THREE.Group(); body.name = 'imported-body'; model.add(body);
  const wheels = centers.map((center, i) => {
    const steer = new THREE.Group(); steer.name = `imported-wheel-${i}`; steer.position.copy(center);
    steer.userData.restY = center.y; steer.userData.radius = radius[i];
    const spin = new THREE.Group(); spin.name = `imported-wheel-spin-${i}`; steer.add(spin); model.add(steer); return { steer, spin };
  });
  for (const p of raw) {
    const a = p.geometry.getAttribute('position'), groups: number[][] = [[], [], []];
    for (let i = 0; i < a.count; i += 3) {
      const x = (a.getX(i) + a.getX(i + 1) + a.getX(i + 2)) / 3, y = (a.getY(i) + a.getY(i + 1) + a.getY(i + 2)) / 3, z = (a.getZ(i) + a.getZ(i + 1) + a.getZ(i + 2)) / 3;
      const w = centers.findIndex((c, k) => Math.abs(x) < halfWidth[k] && Math.hypot(y - c.y, z - c.z) < radius[k] * 1.02);
      groups[w < 0 ? 2 : w].push(i / 3);
    }
    groups.forEach((triangles, g) => {
      if (!triangles.length) return;
      const geometry = triangleSubset(p.geometry, triangles);
      if (g < 2) geometry.translate(0, -centers[g].y, -centers[g].z);
      const mesh = new THREE.Mesh(geometry, p.material); mesh.castShadow = true; mesh.receiveShadow = true;
      (g < 2 ? wheels[g].spin : body).add(mesh);
    });
    p.geometry.dispose();
  }
  model.userData.bike = measured satisfies BikeRig;
  model.updateMatrixWorld(true); return model;
}

/** Match the support points/radii to the imported tires instead of approximating every car alike. */
export function calibratedVehicleSpec(spec: VehicleSpec, model?: THREE.Group): VehicleSpec {
  if (!model || spec.npcOnly) return spec;
  if (spec.kind === 'bike') {
    // Two visual wheels (front, rear); the four invisible support wheels follow their axles.
    const visual = spec.wheels.visual.map((w, i) => {
      const wheel = model.getObjectByName(`imported-wheel-${i}`);
      return wheel ? { ...w, z: wheel.position.z, radius: wheel.userData.radius as number } : w;
    });
    return { ...spec, wheelRadius: (visual[0].radius + visual[1].radius) / 2,
      wheels: { visual, physics: spec.wheels.physics.map((w) => ({ ...w, z: w.z > 0 ? visual[0].z : visual[1].z })) } };
  }
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
