import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const unitSphere = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
const unitSphereSmooth = new THREE.SphereGeometry(1, 12, 8).toNonIndexed();
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1).toNonIndexed();
const unitCyl6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1).toNonIndexed();
const unitCone = new THREE.ConeGeometry(1, 1, 8, 1).toNonIndexed();
const unitSphereLow = new THREE.SphereGeometry(1, 7, 5).toNonIndexed();
const unitCylLow = new THREE.CylinderGeometry(1, 1, 1, 7, 1).toNonIndexed();
const unitFlat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).toNonIndexed();
for (const g of [unitBox, unitSphere, unitSphereSmooth, unitCyl, unitCyl6, unitCone, unitFlat, unitSphereLow, unitCylLow]) g.deleteAttribute('uv');

/** When true, curved primitives use low-poly variants (instanced LOD models). */
let LOW = false;
export function setLowDetail(v: boolean) {
  const prev = LOW;
  LOW = v;
  return prev;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const col = new THREE.Color();

/**
 * Accumulates many transformed primitives into ONE vertex-colored geometry (one draw call).
 * `tint` (0/1) marks vertices that take the per-instance color when used with an instanced tint material.
 */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4, tint = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.hasAttribute('uv')) g.deleteAttribute('uv');
    if (g.hasAttribute('uv1')) g.deleteAttribute('uv1');
    if (matrix) g.applyMatrix4(matrix);
    if (!g.hasAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    col.set(color);
    const c = new Float32Array(n * 3);
    const t = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
      t[i] = tint;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('tintMask', new THREE.BufferAttribute(t, 1));
    // keep only shared attributes
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'color', 'tintMask'].includes(name)) g.deleteAttribute(name);
    }
    g = g.index ? g.toNonIndexed() : g;
    this.parts.push(g);
    return this;
  }

  /** Merge an already vertex-colored geometry (from another GeoBuilder) keeping its colors/tint mask. */
  merge(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4) {
    let g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'color', 'tintMask'].includes(name)) g.deleteAttribute(name);
    }
    if (g.index) g = g.toNonIndexed();
    this.parts.push(g);
    return this;
  }

  private xf(x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
    e.set(rx, ry, rz);
    q.setFromEuler(e);
    v.set(x, y, z);
    s.set(sx, sy, sz);
    return m4.compose(v, q, s);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0, tint = 0, rx = 0, rz = 0) {
    return this.add(unitBox, color, this.xf(x, y, z, w, h, d, rx, ry, rz), tint);
  }

  sphere(rx: number, ry: number, rz: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, smooth = false, tint = 0) {
    return this.add(LOW ? unitSphereLow : smooth ? unitSphereSmooth : unitSphere, color, this.xf(x, y, z, rx, ry, rz), tint);
  }

  cylinder(r: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, opts: { rx?: number; ry?: number; rz?: number; tint?: number; low?: boolean; r2?: number } = {}) {
    const base = opts.low ? unitCyl6 : LOW ? unitCylLow : unitCyl;
    return this.add(base, color, this.xf(x, y, z, r, h, opts.r2 ?? r, opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0), opts.tint ?? 0);
  }

  /** Horizontal quad (road markings), w along local X, d along local Z, rotated by ry. */
  flat(w: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0) {
    return this.add(unitFlat, color, this.xf(x, y, z, w, 1, d, 0, ry, 0));
  }

  cone(r: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0) {
    return this.add(unitCone, color, this.xf(x, y, z, r, h, r, 0, ry, 0));
  }

  geometry(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4, tint = 0) {
    return this.add(g, color, matrix, tint);
  }

  get empty() {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) return new THREE.BufferGeometry();
    const merged = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}
