import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Unit primitives used for instanced city batches. */
export type BatchKind = 'box' | 'rbox' | 'sphere' | 'cyl' | 'quad' | 'lampHead';

export const BATCH_GEOMETRY: Record<BatchKind, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  rbox: new RoundedBoxGeometry(1, 1, 1, 1, 0.18),
  sphere: new THREE.SphereGeometry(1, 8, 6),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  quad: new THREE.PlaneGeometry(1, 1),
  lampHead: new THREE.SphereGeometry(1, 8, 5),
};

/** Kinds hidden on chunks beyond the detail distance (small props). */
export const DETAIL_KINDS = new Set<BatchKind>(['rbox', 'cyl', 'lampHead']);

export const BATCH_SHADOWS: Record<BatchKind, boolean> = {
  box: true,
  rbox: true,
  sphere: true,
  cyl: true,
  quad: false,
  lampHead: false,
};

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

/** Collects instance transforms+colors per primitive kind, with an optional parent frame. */
export class BatchSet {
  readonly data: Record<BatchKind, { m: number[]; c: number[] }> = {
    box: { m: [], c: [] },
    rbox: { m: [], c: [] },
    sphere: { m: [], c: [] },
    cyl: { m: [], c: [] },
    quad: { m: [], c: [] },
    lampHead: { m: [], c: [] },
  };
  private frame: THREE.Matrix4 | null = null;

  setFrame(m: THREE.Matrix4 | null) {
    this.frame = m;
  }

  add(kind: BatchKind, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, ry = 0, rx = 0, rz = 0) {
    tmpE.set(rx, ry, rz);
    tmpQ.setFromEuler(tmpE);
    tmpP.set(x, y, z);
    tmpS.set(sx, sy, sz);
    tmpM.compose(tmpP, tmpQ, tmpS);
    if (this.frame) tmpM.premultiply(this.frame);
    const d = this.data[kind];
    for (let i = 0; i < 16; i++) d.m.push(tmpM.elements[i]);
    tmpC.set(color);
    d.c.push(tmpC.r, tmpC.g, tmpC.b);
  }

  count(kind: BatchKind) {
    return this.data[kind].c.length / 3;
  }

  /** Build InstancedMeshes (one per non-empty kind). */
  build(material: THREE.Material): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const kind of Object.keys(this.data) as BatchKind[]) {
      const d = this.data[kind];
      const n = d.c.length / 3;
      if (n === 0) continue;
      const mesh = new THREE.InstancedMesh(BATCH_GEOMETRY[kind], material, n);
      mesh.instanceMatrix.array.set(d.m);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(d.c), 3);
      mesh.castShadow = BATCH_SHADOWS[kind];
      mesh.receiveShadow = kind !== 'lampHead';
      mesh.computeBoundingSphere();
      mesh.name = kind;
      out.push(mesh);
    }
    return out;
  }
}
