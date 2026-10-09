import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, setLowDetail } from './geoBuilder';
import type { VehicleSpec } from '../data/vehicles';
import { bakeCharacter, PROPORTIONS, randomLook, type Look } from './characters';
import { newAnimState, poseSeated, reachArm, type SeatPose } from './charAnim';
import { mulberry32, hashString } from '../core/rng';

// Procedural cozy "toy" vehicles. Model space: ground at y = 0, forward = +Z, driver's left = +X (curb side).
// Bodies are extruded side profiles with soft bevels and real wheel arches; cabins are hollow (pillars,
// roof, glass panes, dashboard, seats) so the driver can be seen holding the wheel. Steering wheels and
// handlebars are separate parts that turn with the front wheels.

const GLASS = '#33507a';
const GLASS_LIGHT = '#5a7ea6';
const TIRE = '#2b2f36';
const HUB = '#ece6d8';
const DARK = '#3a4048';
const CHROME = '#c9ced6';
const LIGHT = '#fff3c4';
const TAIL = '#e5484d';
const AMBER = '#f4a83a';
const PLATE = '#f3ecd8';
const INTERIOR = '#4a5368';
const SEAT = '#3d4a6b';

interface Quality {
  curve: number;
  bevelSeg: number;
  wheelSeg: number;
  rbSeg: number;
  char: 0 | 1;
}
const QUALITY: Record<0 | 1 | 2, Quality> = {
  0: { curve: 2, bevelSeg: 1, wheelSeg: 7, rbSeg: 0, char: 0 },
  1: { curve: 4, bevelSeg: 2, wheelSeg: 10, rbSeg: 0, char: 0 },
  2: { curve: 8, bevelSeg: 3, wheelSeg: 14, rbSeg: 2, char: 1 },
};
/** Global model detail: 2 = player/preview, 1 = near traffic LOD, 0 = far LOD. */
let Q = QUALITY[2];
/** True when small decorative parts (interior, chrome, seams) are worth their triangles. */
const fine = () => Q !== QUALITY[0];

const rbCache = new Map<string, THREE.BufferGeometry>();
function rounded(w: number, h: number, d: number, r: number) {
  const big = Math.max(w, h, d);
  const seg = big < 0.12 ? 0 : big < 0.35 ? Math.min(Q.rbSeg, 1) : Q.rbSeg;
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}|${seg}`;
  let g = rbCache.get(key);
  if (!g) {
    g = seg <= 0 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, seg, Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
    rbCache.set(key, g);
  }
  return g;
}

const M = new THREE.Matrix4();
const boxCache = new Map<string, THREE.BufferGeometry>();
function UNIT_BOX_SCALED(w: number, h: number, d: number) {
  const k = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = boxCache.get(k);
  if (!g) boxCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}
const Qt = new THREE.Quaternion();
const E = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1);
function at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: THREE.Vector3 = ONE) {
  E.set(rx, ry, rz);
  Qt.setFromEuler(E);
  return M.compose(new THREE.Vector3(x, y, z), Qt, s);
}

function rbox(b: GeoBuilder, w: number, h: number, d: number, x: number, y: number, z: number, color: string, r = 0.08, tint = 0, rx = 0, ry = 0, rz = 0) {
  b.geometry(rounded(w, h, d, r), color, at(x, y, z, rx, ry, rz), tint);
}

/** Rod between two points. */
function rod(b: GeoBuilder, a: THREE.Vector3, c: THREE.Vector3, r: number, color: string, tint = 0) {
  const dir = new THREE.Vector3().subVectors(c, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, Math.max(5, Q.wheelSeg >> 1), 1);
  Qt.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  M.compose(new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5), Qt, ONE);
  b.geometry(g, color, M, tint);
  g.dispose();
}

function disc(b: GeoBuilder, r: number, depth: number, x: number, y: number, z: number, color: string, rx = Math.PI / 2, tint = 0) {
  const g = new THREE.CylinderGeometry(r, r, depth, Math.max(8, Q.wheelSeg), 1);
  b.geometry(g, color, at(x, y, z, rx), tint);
  g.dispose();
}

/** Curved mudguard: an arc of a cylinder around a wheel axle (axis X); theta 0 = front, π/2 = top. */
function fender(b: GeoBuilder, r: number, width: number, y: number, z: number, t0: number, len: number, color: string, tint = 0) {
  for (const [rr, flip] of [[r, false], [r - 0.012, true]] as const) {
    const g = new THREE.CylinderGeometry(rr, rr, width, Math.max(6, Q.wheelSeg), 1, true, t0, len);
    if (flip) {
      const idx = g.getIndex()!;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i);
        idx.setX(i, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    }
    b.geometry(g, color, at(0, y, z, 0, 0, Math.PI / 2), tint);
    g.dispose();
  }
}

function torus(b: GeoBuilder, r: number, tube: number, x: number, y: number, z: number, color: string, rx = 0, ry = 0, rz = 0, tubeSeg = 5) {
  const g = new THREE.TorusGeometry(r, tube, tubeSeg, Math.max(10, Q.wheelSeg));
  b.geometry(g, color, at(x, y, z, rx, ry, rz));
  g.dispose();
}

// ---------- extruded side profiles ----------

type Cmd = { z: number; y: number; r?: number } | { arch: true; z: number; axle: number; R: number; bottom: number };

/** Side-profile shape in (z, y): bottom edge rear→front (with wheel arches), then up and back over the top. */
function profileShape(cmds: Cmd[]): THREE.Shape {
  const s = new THREE.Shape();
  const n = cmds.length;
  const inPt = (c: Cmd): [number, number] => {
    if ('arch' in c) {
      const a = Math.asin(Math.min(0.99, (c.axle - c.bottom) / c.R));
      return [c.z - c.R * Math.cos(a), c.bottom];
    }
    return [c.z, c.y];
  };
  const outPt = (c: Cmd): [number, number] => {
    if ('arch' in c) {
      const a = Math.asin(Math.min(0.99, (c.axle - c.bottom) / c.R));
      return [c.z + c.R * Math.cos(a), c.bottom];
    }
    return [c.z, c.y];
  };
  let started = false;
  const go = (z: number, y: number) => {
    if (!started) {
      s.moveTo(z, y);
      started = true;
    } else s.lineTo(z, y);
  };
  for (let i = 0; i < n; i++) {
    const c = cmds[i];
    if ('arch' in c) {
      const a = Math.asin(Math.min(0.99, (c.axle - c.bottom) / c.R));
      const [iz, iy] = inPt(c);
      go(iz, iy);
      s.absarc(c.z, c.axle, c.R, Math.PI + a, -a, true);
      continue;
    }
    const r = c.r ?? 0;
    if (r <= 0) {
      go(c.z, c.y);
      continue;
    }
    const [pz, py] = outPt(cmds[(i - 1 + n) % n]);
    const [nz, ny] = inPt(cmds[(i + 1) % n]);
    const d1 = Math.hypot(pz - c.z, py - c.y);
    const d2 = Math.hypot(nz - c.z, ny - c.y);
    const rr = Math.min(r, d1 * 0.48, d2 * 0.48);
    go(c.z + ((pz - c.z) / d1) * rr, c.y + ((py - c.y) / d1) * rr);
    s.quadraticCurveTo(c.z, c.y, c.z + ((nz - c.z) / d2) * rr, c.y + ((ny - c.y) / d2) * rr);
  }
  s.closePath();
  return s;
}

/** Extrude a side profile across the vehicle width (centered on x = 0, total width incl. bevel). */
function extrudeProfile(cmds: Cmd[], width: number, bevel: number) {
  const shape = profileShape(cmds);
  const depth = Math.max(0.005, width - 2 * bevel);
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelOffset: -bevel * 0.8,
    bevelSegments: Q.bevelSeg,
    curveSegments: Q.curve,
    steps: 1,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  g.deleteAttribute('uv');
  g = toCreasedNormals(g, 0.7);
  return g;
}

/** Thin flat polygon (window pane) in the z/y plane at x, `thick` deep. */
function pane(b: GeoBuilder, pts: [number, number][], x: number, thick: number, color: string) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(x + thick / 2, 0, 0);
  g.deleteAttribute('uv');
  b.geometry(g, color);
  g.dispose();
}

/** Thin slab lying along a sloped edge from (z0,y0) to (z1,y1) — windshields, pillars. */
function slopeSlab(b: GeoBuilder, z0: number, y0: number, z1: number, y1: number, w: number, thick: number, x: number, color: string, shrink = 0, out = 0, tint = 0) {
  const dz = z1 - z0;
  const dy = y1 - y0;
  const len = Math.hypot(dz, dy);
  const ang = Math.atan2(dz, dy);
  const nz = dy / len;
  const ny = -dz / len;
  const flip = Math.sign(nz) || 1;
  const cz = (z0 + z1) / 2 + nz * out * flip;
  const cy = (y0 + y1) / 2 + ny * out * flip;
  b.geometry(rounded(w, Math.max(0.02, len - shrink), thick, Math.min(0.03, thick / 2)), color, at(x, cy, cz, ang), tint);
}

// ---------- wheels ----------

/** Wheel geometry centered at origin, axle along X: rounded tire, cream rim with spokes, hub cap. */
export function buildWheelGeometry(radius: number, width: number) {
  const b = new GeoBuilder();
  if (Q === QUALITY[0]) {
    const t = new THREE.CylinderGeometry(radius, radius, width, 8, 1);
    b.geometry(t, TIRE, at(0, 0, 0, 0, 0, Math.PI / 2));
    t.dispose();
    const h = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.03, 6, 1);
    b.geometry(h, HUB, at(0, 0, 0, 0, 0, Math.PI / 2));
    h.dispose();
    return b.build();
  }
  const ri = radius * 0.6;
  const w2 = width / 2;
  const prof = [
    new THREE.Vector2(ri, -w2 + 0.01),
    new THREE.Vector2(radius * 0.9, -w2),
    new THREE.Vector2(radius * 0.985, -w2 + width * 0.18),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius * 0.985, w2 - width * 0.18),
    new THREE.Vector2(radius * 0.9, w2),
    new THREE.Vector2(ri, w2 - 0.01),
  ];
  const tire = new THREE.LatheGeometry(prof, Q.wheelSeg);
  b.geometry(tire, TIRE, at(0, 0, 0, 0, 0, Math.PI / 2));
  tire.dispose();
  // rim dish
  const rim = new THREE.CylinderGeometry(ri, ri, width * 0.78, Q.wheelSeg, 1);
  b.geometry(rim, HUB, at(0, 0, 0, 0, 0, Math.PI / 2));
  rim.dispose();
  for (const sx of [1, -1]) {
    const face = sx * width * 0.4;
    if (Q === QUALITY[2]) {
      // recessed dark ring + spokes
      torus(b, ri * 0.72, ri * 0.13, face, 0, 0, '#c7bfae', 0, Math.PI / 2, 0, 4);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        b.geometry(UNIT_BOX_SCALED(0.02, ri * 0.75, ri * 0.22), '#d8d0c0', at(face + sx * 0.005, Math.cos(a) * ri * 0.42, Math.sin(a) * ri * 0.42, -a, 0, 0));
      }
    }
    b.sphere(ri * 0.3, ri * 0.3, ri * 0.3, face, 0, 0, '#b9b2a2', Q.wheelSeg >= 10);
  }
  return b.build();
}

// ---------- drivers ----------

export interface SteerRig {
  geometry: THREE.BufferGeometry;
  /** Pivot of the steering part in model space. */
  pivot: THREE.Vector3;
  /** Column tilt about X (radians). */
  rake: number;
  /** Local rotation axis: 'y' handlebar, 'z' steering wheel. */
  axis: 'y' | 'z';
  /** Visual rotation per radian of front-wheel steer. */
  ratio: number;
  /** Hand targets in steer-local space: [left hand (+X), right hand (−X)]. */
  grips: [THREE.Vector3, THREE.Vector3];
}

export interface DriverSeat {
  /** Model-space position of the hip joint. */
  hip: THREE.Vector3;
  pose: SeatPose;
  scale: number;
}

export interface VehicleModelParts {
  /** Body geometry in model space (ground y=0). Paint vertices have tintMask = 1. */
  body: THREE.BufferGeometry;
  /** Glass panes (rendered translucent on the player vehicle, opaque in static builds). */
  glass: THREE.BufferGeometry | null;
  /** Static (baked) driver — used by traffic/parked/static builds; null when `withRider` is false. */
  rider: THREE.BufferGeometry | null;
  steer: SteerRig | null;
  seat: DriverSeat | null;
  wheel: THREE.BufferGeometry[];
  /** Where a seated pillion passenger's hips go (model space), null if passengers ride hidden. */
  passengerSeat: THREE.Vector3 | null;
  /** Door position on the curb (+X) side for boarding walks. */
  door: THREE.Vector3;
}

const steerM = new THREE.Matrix4();
const steerQ = new THREE.Quaternion();
/** Grip position in model space for a steer rig rotated by `angle` (visual radians). */
export function gripWorld(s: SteerRig, side: 0 | 1, angle: number, out = new THREE.Vector3()) {
  E.set(s.rake, 0, 0);
  steerQ.setFromEuler(E);
  const inner = new THREE.Quaternion().setFromAxisAngle(s.axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1), angle);
  steerQ.multiply(inner);
  steerM.compose(s.pivot, steerQ, ONE);
  return out.copy(s.grips[side]).applyMatrix4(steerM);
}

/** Elbow pole direction (model space) per seat pose and side. */
export function elbowPole(pose: SeatPose, side: 1 | -1, out = new THREE.Vector3()) {
  if (pose === 'bike' || pose === 'auto') return out.set(side * 0.9, -0.6, -0.3);
  return out.set(side * 0.6, -1, -0.2);
}

const DRIVER_LOOK: Look = {
  gender: 'male',
  skin: '#e3ac82',
  hair: '#2a2320',
  hairStyle: 'short',
  top: '#f6efe2',
  topStyle: 'tee',
  inner: '#ffffff',
  bottom: '#34507a',
  bottomStyle: 'pants',
  shoes: '#3a4048',
  acc: 'none',
  accColor: '#3a4048',
};

/** Static driver geometry, posed on the seat with both hands on the grips (steer = 0). */
function bakeDriver(spec: VehicleSpec, seat: DriverSeat, steer: SteerRig | null, look: Look) {
  const P = PROPORTIONS[look.gender];
  const pole = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  return bakeCharacter(look, Q.char, (rig, root) => {
    root.position.set(seat.hip.x, seat.hip.y - P.joints[0].y * seat.scale, seat.hip.z);
    root.scale.setScalar(seat.scale);
    poseSeated(rig, seat.pose, newAnimState(1), 0, { steer: 0, longAccel: 0, lateralAccel: 0, speed: 5, roll: 0 });
    root.updateMatrixWorld(true);
    if (steer) {
      for (const side of [1, -1] as const) {
        gripWorld(steer, side > 0 ? 0 : 1, 0, tgt);
        reachArm(rig, side, tgt, elbowPole(seat.pose, side, pole), seat.scale);
      }
    }
    void spec;
  });
}

function driverLookFor(spec: VehicleSpec, traffic: boolean): Look {
  if (!traffic) return { ...DRIVER_LOOK, helmet: spec.kind === 'bike' ? '#2fc4a8' : undefined, acc: spec.kind === 'bike' ? 'backpack' : 'none' };
  const rng = mulberry32(hashString(spec.id));
  const l = randomLook(rng);
  if (spec.kind === 'bus') return { ...l, top: '#4fa3e0', topStyle: 'polo', inner: '#f6efe2', acc: 'none' };
  return { ...l, acc: l.acc === 'backpack' || l.acc === 'bag' ? 'none' : l.acc };
}

// ---------- vehicles ----------

interface CarDesign {
  bb: number;
  beltF: number;
  belt: number;
  beltR: number;
  hoodZ: number;
  roofF: number;
  roofR: number;
  rearZ: number;
  cabinW: number;
  pillars: number[];
  sport?: boolean;
  mpv?: boolean;
}

function carDesign(spec: VehicleSpec): CarDesign {
  const L = spec.length;
  switch (spec.id) {
    case 'car_coupe':
      return { bb: 0.27, beltF: 0.6, belt: 0.76, beltR: 0.78, hoodZ: 0.45, roofF: -0.15, roofR: -1.0, rearZ: -1.72, cabinW: 0.84, pillars: [-0.62] };
    case 'mpv_seven':
      return { bb: 0.3, beltF: 0.86, belt: 1.0, beltR: 1.02, hoodZ: 1.4, roofF: 0.85, roofR: -L / 2 + 0.22, rearZ: -L / 2 + 0.12, cabinW: 0.9, pillars: [0.2, -0.95], mpv: true };
    case 'supercar':
      return { bb: 0.22, beltF: 0.46, belt: 0.64, beltR: 0.7, hoodZ: 0.4, roofF: -0.25, roofR: -0.9, rearZ: -1.8, cabinW: 0.78, pillars: [], sport: true };
    default:
      return { bb: 0.28, beltF: 0.76, belt: 0.9, beltR: 0.9, hoodZ: 0.8, roofF: 0.28, roofR: -1.18, rearZ: -1.55, cabinW: 0.9, pillars: [-0.38] };
  }
}

function archCmds(spec: VehicleSpec, bottom: number, extra = 0.09): Cmd[] {
  const zs = [...new Set(spec.wheels.visual.map((w) => +w.z.toFixed(3)))].sort((a, b) => a - b);
  const out: Cmd[] = [];
  for (const z of zs) {
    const w = spec.wheels.visual.find((v) => Math.abs(v.z - z) < 1e-3)!;
    out.push({ arch: true, z, axle: w.radius, R: w.radius + extra, bottom });
  }
  return out;
}

function buildCar(spec: VehicleSpec, paint: string, b: GeoBuilder, glass: GeoBuilder, steerB: GeoBuilder) {
  const d = carDesign(spec);
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;
  const bevel = d.sport ? 0.08 : 0.1;
  const cw = W * d.cabinW;
  // lower body
  const lower: Cmd[] = [
    { z: -L / 2, y: d.bb, r: 0.14 },
    ...archCmds(spec, d.bb),
    { z: L / 2, y: d.bb, r: 0.14 },
    { z: L / 2 + (d.sport ? 0.02 : 0), y: d.beltF, r: d.sport ? 0.14 : 0.3 },
    { z: d.hoodZ, y: d.belt, r: 0.12 },
    { z: d.rearZ, y: d.belt, r: 0.06 },
    { z: -L / 2, y: d.beltR, r: d.sport ? 0.18 : 0.28 },
  ];
  const lg = extrudeProfile(lower, W, bevel);
  b.geometry(lg, paint, undefined, 1);
  lg.dispose();
  // fender flares (subtle) for sports car
  if (d.sport) {
    for (const z of [spec.wheels.visual[0].z, spec.wheels.visual[2].z]) for (const sx of [1, -1]) rbox(b, 0.1, 0.18, spec.wheelRadius * 2.4, sx * (W / 2 - 0.02), d.belt - 0.08, z, paint, 0.05, 1);
  }

  // hollow cabin: roof + pillars + panes
  const top = H;
  const t = 0.09;
  const front = (y: number) => d.hoodZ + ((d.roofF - d.hoodZ) * (y - d.belt)) / (top - d.belt);
  const rear = (y: number) => d.rearZ + ((d.roofR - d.rearZ) * (y - d.belt)) / (top - d.belt);
  const roof: Cmd[] = [
    { z: rear(top - t) + 0.02, y: top - t },
    { z: front(top - t) - 0.02, y: top - t },
    { z: d.roofF, y: top, r: 0.1 },
    { z: d.roofR, y: top, r: 0.1 },
  ];
  const rg = extrudeProfile(roof, cw + 0.04, 0.035);
  b.geometry(rg, paint, undefined, 1);
  rg.dispose();
  const pw = 0.075;
  for (const sx of [1, -1]) {
    const x = sx * (cw / 2 - pw / 2);
    slopeSlab(b, d.hoodZ, d.belt, d.roofF, top - 0.02, pw, 0.09, x, paint, 0, -0.02, 1); // A pillar
    slopeSlab(b, d.rearZ, d.belt, d.roofR, top - 0.02, d.mpv ? 0.12 : 0.1, 0.12, x, paint, 0, -0.03, 1); // C pillar
    for (const pz of d.pillars) rbox(b, pw, top - d.belt, 0.1, x, (top + d.belt) / 2, pz, paint, 0.03, 1);
  }
  // glass panes (each side), windshield, rear window
  const bounds = [-Infinity, ...d.pillars.slice().sort((a, c) => a - c), Infinity];
  const yb = d.belt + 0.03;
  const yt = top - t - 0.01;
  for (const sx of [1, -1]) {
    for (let i = 0; i < bounds.length - 1; i++) {
      const za = bounds[i] + 0.05;
      const zb = bounds[i + 1] - 0.05;
      const pts: [number, number][] = [
        [Math.max(za, rear(yb) + 0.07), yb],
        [Math.min(zb, front(yb) - 0.06), yb],
        [Math.min(zb, front(yt) - 0.05), yt],
        [Math.max(za, rear(yt) + 0.06), yt],
      ];
      if (pts[1][0] - pts[0][0] < 0.1) continue;
      pane(glass, pts, sx * (cw / 2 - 0.015), 0.02, GLASS);
    }
  }
  slopeSlab(glass, d.hoodZ, d.belt, d.roofF, top - t, cw - 0.1, 0.025, 0, GLASS, 0.04, -0.03);
  slopeSlab(glass, d.rearZ, d.belt, d.roofR, top - t, cw - 0.14, 0.025, 0, GLASS, 0.06, -0.04);
  // interior: tub, dashboard, seats
  const fz = front(d.belt);
  const rz = rear(d.belt);
  const driverX = -cw * 0.25;
  const seatZ = fz - (d.sport ? 0.95 : 0.85);
  if (fine()) {
  b.geometry(rounded(cw - 0.06, 0.04, fz - rz - 0.05, 0.02), INTERIOR, at(0, d.belt - 0.005, (fz + rz) / 2));
  rbox(b, cw - 0.08, 0.14, 0.32, 0, d.belt + 0.06, fz - 0.2, '#2f3442', 0.05);
  for (const sx of [1, -1]) rbox(b, cw * 0.36, 0.55, 0.13, sx * cw * 0.25, d.belt + 0.08, seatZ - 0.28, SEAT, 0.06, 0, -0.12);
  if (!d.sport && spec.passengerSeats > 1) rbox(b, cw * 0.86, 0.5, 0.13, 0, d.belt + 0.05, seatZ - (d.mpv ? 1.0 : 1.05), SEAT, 0.06, 0, -0.1);
  if (d.mpv) rbox(b, cw * 0.86, 0.5, 0.13, 0, d.belt + 0.05, seatZ - 1.95, SEAT, 0.06, 0, -0.1);
  }

  // front, rear details
  const by = (d.bb + d.beltF) / 2;
  const fzEnd = L / 2 + 0.01;
  for (const sx of [1, -1]) {
    // headlights: round lens in a chrome bezel
    const hx = sx * W * 0.33;
    const hy = d.sport ? d.beltF - 0.06 : by + 0.06;
    b.sphere(d.sport ? 0.14 : 0.12, d.sport ? 0.07 : 0.12, 0.06, hx, hy, fzEnd - 0.02, LIGHT, true);
    if (!d.sport && fine()) torus(b, 0.12, 0.022, hx, hy, fzEnd - 0.02, CHROME);
    b.geometry(rounded(0.08, 0.05, 0.04, 0.02), AMBER, at(sx * W * 0.43, d.bb + 0.16, fzEnd - 0.02));
    // tail lights
    b.geometry(rounded(0.26, d.sport ? 0.08 : 0.16, 0.06, 0.03), TAIL, at(sx * W * 0.34, d.beltR - 0.14, -L / 2 - 0.01));
    // mirrors on stalks
    const mz = d.hoodZ - 0.05;
    if (fine()) rod(b, new THREE.Vector3(sx * (cw / 2), d.belt + 0.04, mz), new THREE.Vector3(sx * (W / 2 + 0.08), d.belt + 0.08, mz), 0.02, DARK);
    rbox(b, 0.12, 0.1, 0.13, sx * (W / 2 + 0.11), d.belt + 0.1, mz - 0.02, paint, 0.04, 1);
    b.geometry(rounded(0.02, 0.07, 0.09, 0.01), GLASS_LIGHT, at(sx * (W / 2 + 0.11), d.belt + 0.1, mz - 0.09));
    if (!fine()) continue;
    // door seams + handles
    const doors = d.mpv ? [d.pillars[0], d.pillars[1]] : d.sport ? [] : [d.pillars[0] ?? -0.4];
    for (const z of [d.hoodZ - 0.1, ...doors]) b.box(0.012, d.belt - d.bb - 0.12, 0.02, sx * (W / 2 + 0.004), (d.belt + d.bb) / 2 + 0.02, z, mix(paint, '#000000', 0.25), 0, 1);
    for (const z of [d.hoodZ - 0.35, ...doors.map((z) => z - 0.3)]) b.geometry(rounded(0.03, 0.04, 0.14, 0.015), CHROME, at(sx * (W / 2 + 0.01), d.belt - 0.08, z));
    // side skirt
    b.geometry(rounded(0.04, 0.06, L * 0.45, 0.02), mix(paint, '#000000', 0.22), at(sx * (W / 2 - 0.01), d.bb + 0.04, 0), 1);
  }
  // grille, bumpers, plates
  b.geometry(rounded(W * (d.sport ? 0.5 : 0.34), d.sport ? 0.1 : 0.14, 0.05, 0.04), d.sport ? '#2b2f36' : DARK, at(0, d.sport ? d.bb + 0.12 : by - 0.02, fzEnd));
  rbox(b, W * 0.98, 0.16, 0.18, 0, d.bb + 0.06, L / 2 - 0.02, d.sport ? mix(paint, '#000000', 0.2) : '#e9e4d8', 0.07, d.sport ? 1 : 0);
  rbox(b, W * 0.98, 0.16, 0.18, 0, d.bb + 0.06, -L / 2 + 0.02, d.sport ? mix(paint, '#000000', 0.2) : '#e9e4d8', 0.07, d.sport ? 1 : 0);
  b.geometry(rounded(0.4, 0.12, 0.03, 0.02), PLATE, at(0, d.bb + 0.2, -L / 2 - 0.03));
  b.geometry(rounded(0.36, 0.1, 0.03, 0.02), PLATE, at(0, d.bb + 0.06, L / 2 + 0.07));
  if (d.sport) {
    rbox(b, W * 0.86, 0.05, 0.3, 0, d.beltR + 0.2, -L / 2 + 0.25, '#2b2f36', 0.02);
    for (const sx of [1, -1]) {
      b.box(0.05, 0.2, 0.05, sx * 0.55, d.beltR + 0.08, -L / 2 + 0.28, '#2b2f36');
      b.geometry(rounded(0.05, 0.14, 0.55, 0.03), '#2b2f36', at(sx * (W / 2 + 0.003), d.belt - 0.12, -0.35)); // side intake
    }
  }
  if (d.mpv) for (const sx of [1, -1]) rbox(b, 0.05, 0.05, (d.roofF - d.roofR) * 0.8, sx * cw * 0.38, top + 0.04, (d.roofF + d.roofR) / 2, '#5a6270', 0.02);

  // steering wheel (separate, turns) + column
  const scale = 0.9;
  const P = PROPORTIONS.male;
  const hipY = Math.min(d.belt - 0.2, top - 0.1 - (P.headY + 0.22 - P.joints[0].y) * scale);
  const hip = new THREE.Vector3(driverX, hipY, seatZ);
  const shoulderY = hipY + (P.joints[BONE_UARM].y - P.joints[0].y) * scale;
  const pivot = new THREE.Vector3(driverX, shoulderY - 0.1, seatZ + 0.38);
  const R = 0.15;
  torus(steerB, R, 0.022, 0, 0, 0, '#2b2f36');
  steerB.sphere(0.05, 0.05, 0.03, 0, 0, 0, '#3a4048', true);
  for (const a of [Math.PI / 2 + 0.2, -Math.PI / 2 - 0.2, Math.PI * 1.5 - Math.PI]) steerB.geometry(rounded(0.025, R, 0.02, 0.008), '#3a4048', at((Math.cos(a) * R) / 2, (Math.sin(a) * R) / 2, 0, 0, 0, a - Math.PI / 2));
  rod(b, new THREE.Vector3(driverX, pivot.y - 0.08, pivot.z + 0.2), pivot.clone().setZ(pivot.z + 0.02), 0.025, '#2b2f36');
  const steer: SteerRig = {
    geometry: steerB.build(),
    pivot,
    rake: -0.5,
    axis: 'z',
    ratio: 2.2,
    grips: [new THREE.Vector3(R * 0.94, R * 0.3, 0), new THREE.Vector3(-R * 0.94, R * 0.3, 0)],
  };
  const passengerSeat = spec.passengerSeats > 0 ? new THREE.Vector3(-driverX, hipY, seatZ) : null;
  return { steer, seat: { hip, pose: 'car' as SeatPose, scale }, passengerSeat, door: new THREE.Vector3(W / 2 + 0.6, 0, seatZ - 0.2) };
}

const BONE_UARM = 3;

function buildBus(spec: VehicleSpec, paint: string, b: GeoBuilder, glass: GeoBuilder, steerB: GeoBuilder, animatedDoors: boolean) {
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;
  const acc = spec.accentColor;
  const bottom = 0.32;
  const belt = bottom + (H - bottom) * 0.38;
  const lower: Cmd[] = [
    { z: -L / 2, y: bottom, r: 0.15 },
    ...archCmds(spec, bottom, 0.1),
    { z: L / 2, y: bottom, r: 0.15 },
    { z: L / 2, y: belt, r: 0.12 },
    { z: -L / 2, y: belt, r: 0.12 },
  ];
  const lg = extrudeProfile(lower, W, 0.14);
  b.geometry(lg, paint);
  lg.dispose();
  // accent skirt band (tinted)
  const band: Cmd[] = [
    { z: -L / 2 - 0.01, y: bottom - 0.01, r: 0.12 },
    ...archCmds(spec, bottom - 0.01, 0.11),
    { z: L / 2 + 0.01, y: bottom - 0.01, r: 0.12 },
    { z: L / 2 + 0.01, y: bottom + (belt - bottom) * 0.55 },
    { z: -L / 2 - 0.01, y: bottom + (belt - bottom) * 0.55 },
  ];
  const bg = extrudeProfile(band, W + 0.03, 0.1);
  b.geometry(bg, acc, undefined, 1);
  bg.dispose();
  // roof
  const roofT = 0.2;
  const roof: Cmd[] = [
    { z: -L / 2, y: H - roofT },
    { z: L / 2 - 0.06, y: H - roofT },
    { z: L / 2 - 0.18, y: H, r: 0.2 },
    { z: -L / 2 + 0.05, y: H, r: 0.2 },
  ];
  const rg = extrudeProfile(roof, W, 0.1);
  b.geometry(rg, paint);
  rg.dispose();
  rbox(b, W * 0.8, 0.1, L * 0.45, 0, H + 0.04, -L * 0.1, '#d9cfb5', 0.04);
  // window band: pillars + panes
  const doorZ = L / 2 - 1.5;
  const doors = spec.id === 'bus_small' ? [doorZ] : [doorZ, -L * 0.15];
  const n = Math.max(3, Math.round(L / 1.45));
  const span = L - 0.5;
  const winL = span / n;
  const yb = belt + 0.04;
  const yt = H - roofT - 0.03;
  for (const sx of [1, -1]) {
    const x = sx * (W / 2 - 0.05);
    for (let i = 0; i <= n; i++) {
      const z = -L / 2 + 0.25 + winL * i;
      rbox(b, 0.1, yt - yb + 0.08, 0.12, x, (yt + yb) / 2, Math.min(z, L / 2 - 0.12), paint, 0.03);
    }
    for (let i = 0; i < n; i++) {
      const z0 = -L / 2 + 0.25 + winL * i + 0.07;
      const z1 = z0 + winL - 0.14;
      if (sx > 0 && doors.some((dz) => Math.abs((z0 + z1) / 2 - dz) < 0.75)) continue;
      pane(glass, [[z0, yb], [z1, yb], [z1, yt], [z0, yt]], sx * (W / 2 - 0.035), 0.02, GLASS);
    }
  }
  // windshield + rear window + destination board
  b.geometry(rounded(W * 0.9, 0.08, 0.1, 0.03), paint, at(0, yb - 0.02, L / 2 - 0.08));
  glass.geometry(rounded(W * 0.88, yt - yb - 0.32, 0.03, 0.02), GLASS, at(0, (yt + yb) / 2 - 0.12, L / 2 - 0.07, -0.04));
  b.geometry(rounded(W * 0.72, 0.28, 0.05, 0.04), '#1d2b36', at(0, yt - 0.12, L / 2 - 0.06));
  b.geometry(rounded(W * 0.5, 0.12, 0.02, 0.02), '#f4b544', at(0, yt - 0.12, L / 2 - 0.03));
  glass.geometry(rounded(W * 0.7, yt - yb - 0.2, 0.03, 0.02), GLASS, at(0, (yt + yb) / 2, -L / 2 + 0.05));
  // doors on curb side (+X): frames (sliding leaves are animated on the player bus)
  for (const dz of doors) {
    b.geometry(rounded(0.05, H - roofT - bottom - 0.1, 1.2, 0.04), '#d9cfb5', at(W / 2 + 0.005, (H - roofT + bottom) / 2, dz));
    b.geometry(rounded(0.06, H - roofT - bottom - 0.25, 0.04, 0.02), DARK, at(W / 2 + 0.03, (H - roofT + bottom) / 2, dz));
    if (!animatedDoors) for (const s of [-1, 1]) glass.geometry(rounded(0.03, H - roofT - bottom - 0.3, 0.5, 0.03), GLASS_LIGHT, at(W / 2 + 0.035, (H - roofT + bottom) / 2, dz + s * 0.28));
  }
  // interior: floor, seat rows, dashboard
  b.geometry(rounded(W - 0.2, 0.04, L - 0.4, 0.02), INTERIOR, at(0, belt - 0.005, 0));
  for (let z = -L / 2 + 0.8; fine() && z < doorZ - 1.0; z += 0.95) {
    for (const sx of [1, -1]) {
      if (sx > 0 && doors.some((dz) => Math.abs(z - dz) < 0.8)) continue;
      rbox(b, W * 0.34, 0.45, 0.1, sx * W * 0.25, belt + 0.15, z, SEAT, 0.05);
    }
  }
  rbox(b, W - 0.3, 0.16, 0.36, 0, belt + 0.04, L / 2 - 0.35, '#2f3442', 0.05);
  // lights, bumpers, mirrors
  for (const sx of [1, -1]) {
    b.sphere(0.13, 0.13, 0.06, sx * W * 0.36, bottom + 0.42, L / 2 + 0.05, LIGHT, true);
    if (fine()) torus(b, 0.13, 0.022, sx * W * 0.36, bottom + 0.42, L / 2 + 0.05, CHROME);
    b.geometry(rounded(0.1, 0.06, 0.04, 0.02), AMBER, at(sx * W * 0.24, bottom + 0.42, L / 2 + 0.05));
    b.geometry(rounded(0.22, 0.16, 0.06, 0.03), TAIL, at(sx * W * 0.36, bottom + 0.45, -L / 2 - 0.04));
    rod(b, new THREE.Vector3(sx * W * 0.45, H - 0.45, L / 2 - 0.05), new THREE.Vector3(sx * (W / 2 + 0.16), H - 0.5, L / 2 + 0.15), 0.025, DARK);
    rbox(b, 0.1, 0.36, 0.1, sx * (W / 2 + 0.17), H - 0.75, L / 2 + 0.15, DARK, 0.04);
  }
  rbox(b, W * 0.98, 0.22, 0.22, 0, bottom + 0.08, L / 2 + 0.02, DARK, 0.08);
  rbox(b, W * 0.98, 0.22, 0.22, 0, bottom + 0.08, -L / 2 - 0.02, DARK, 0.08);
  b.geometry(rounded(0.42, 0.13, 0.03, 0.02), PLATE, at(0, bottom + 0.22, L / 2 + 0.14));
  b.geometry(rounded(0.42, 0.13, 0.03, 0.02), PLATE, at(0, bottom + 0.3, -L / 2 - 0.14));

  // driver (right-hand drive) + big, nearly flat steering wheel
  const P = PROPORTIONS.male;
  const driverX = -W * 0.27;
  const seatZ = L / 2 - 1.05;
  const hipY = belt - 0.05;
  const shoulderY = hipY + P.joints[BONE_UARM].y - P.joints[0].y;
  const pivot = new THREE.Vector3(driverX, shoulderY - 0.17, seatZ + 0.42);
  const R = 0.21;
  torus(steerB, R, 0.024, 0, 0, 0, '#2b2f36');
  steerB.sphere(0.06, 0.06, 0.035, 0, 0, 0, '#3a4048', true);
  for (const a of [0, Math.PI * (2 / 3), Math.PI * (4 / 3)]) steerB.geometry(rounded(0.025, R, 0.02, 0.008), '#3a4048', at((Math.cos(a) * R) / 2, (Math.sin(a) * R) / 2, 0, 0, 0, a - Math.PI / 2));
  rod(b, new THREE.Vector3(driverX, belt, pivot.z + 0.25), pivot.clone().setZ(pivot.z + 0.03), 0.035, '#2b2f36');
  rbox(b, 0.48, 0.12, 0.45, driverX, hipY - 0.13, seatZ - 0.02, SEAT, 0.05);
  rbox(b, 0.48, 0.6, 0.12, driverX, hipY + 0.2, seatZ - 0.3, SEAT, 0.05, 0, -0.12);
  const steer: SteerRig = {
    geometry: steerB.build(),
    pivot,
    rake: -1.05,
    axis: 'z',
    ratio: 2.4,
    grips: [new THREE.Vector3(R * 0.9, R * 0.42, 0), new THREE.Vector3(-R * 0.9, R * 0.42, 0)],
  };
  return { steer, seat: { hip: new THREE.Vector3(driverX, hipY, seatZ), pose: 'bus' as SeatPose, scale: 1 }, passengerSeat: null, door: new THREE.Vector3(W / 2 + 0.7, 0, doorZ) };
}

function buildBike(spec: VehicleSpec, paint: string, b: GeoBuilder, steerB: GeoBuilder) {
  const fw = spec.wheels.visual[0];
  const rw = spec.wheels.visual[1];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const acc = '#1d2b36';
  // frame
  rod(b, V(0, 0.98, 0.46), V(0, 0.48, -0.12), 0.045, '#3a4048');
  rod(b, V(0, 0.98, 0.46), V(0, 0.5, 0.3), 0.04, '#3a4048');
  // engine block with cooling fins + crankcase cover
  rbox(b, 0.3, 0.3, 0.38, 0, 0.47, 0.08, '#5b6170', 0.08);
  for (let i = 0; i < 4; i++) b.box(0.34, 0.018, 0.2, 0, 0.56 + i * 0.045, 0.2, '#7c8290', 0, 0, -0.35);
  b.sphere(0.13, 0.13, 0.05, 0.16, 0.42, 0.05, CHROME, true);
  // exhaust
  rod(b, V(0.1, 0.42, 0.24), V(0.17, 0.3, 0.05), 0.035, CHROME);
  rod(b, V(0.17, 0.3, 0.05), V(0.19, 0.4, -0.62), 0.04, CHROME);
  disc(b, 0.06, 0.32, 0.19, 0.42, -0.5, CHROME, Math.PI / 2 - 0.17);
  disc(b, 0.045, 0.02, 0.19, 0.44, -0.67, '#3a4048', Math.PI / 2 - 0.17);
  // swingarm + rear shock
  for (const sx of [1, -1]) {
    rod(b, V(sx * 0.09, 0.42, -0.1), V(sx * 0.09, rw.radius, rw.z), 0.03, '#3a4048');
    rod(b, V(sx * 0.1, rw.radius + 0.05, rw.z + 0.12), V(sx * 0.12, 0.88, -0.38), 0.025, '#e8a33d');
  }
  // fuel tank (paint) with stripe and cap
  b.sphere(0.2, 0.15, 0.3, 0, 0.98, 0.2, paint, true, 1);
  b.sphere(0.204, 0.035, 0.304, 0, 0.98, 0.2, mix(paint, '#ffffff', 0.45), true, 1);
  disc(b, 0.04, 0.03, 0, 1.12, 0.26, CHROME, 0);
  // side covers + seat + tail
  rbox(b, 0.34, 0.24, 0.36, 0, 0.82, -0.25, paint, 0.1, 1);
  rbox(b, 0.3, 0.1, 0.68, 0, 0.98, -0.28, '#2b2f36', 0.05, 0, 0.04);
  rbox(b, 0.26, 0.08, 0.3, 0, 1.04, -0.48, '#33363f', 0.04, 0, 0.1);
  rbox(b, 0.26, 0.16, 0.42, 0, 0.88, -0.68, paint, 0.08, 1, 0.2);
  b.geometry(rounded(0.18, 0.08, 0.05, 0.03), TAIL, at(0, 0.88, -0.9));
  b.geometry(rounded(0.2, 0.12, 0.02, 0.02), PLATE, at(0, 0.7, -0.9, -0.3));
  for (const sx of [1, -1]) b.geometry(rounded(0.06, 0.05, 0.05, 0.02), AMBER, at(sx * 0.14, 0.86, -0.86));
  rod(b, V(0.12, 0.82, -0.82), V(0.12, 0.62, -0.82), 0.015, '#3a4048'); // plate holder
  // rear fender
  fender(b, rw.radius + 0.06, 0.18, rw.radius, rw.z, 1.25, 1.75, paint, 1);
  // footpegs + kickstand
  for (const sx of [1, -1]) rod(b, V(sx * 0.12, 0.38, -0.05), V(sx * 0.24, 0.38, -0.05), 0.02, '#2b2f36');
  rod(b, V(0.12, 0.33, -0.02), V(0.22, 0.05, -0.12), 0.015, '#3a4048');

  // steering assembly (turns about a vertical axis through the steering head)
  const pz = 0.5;
  const S = (x: number, y: number, z: number) => V(x, y, z - pz);
  for (const sx of [1, -1]) rod(steerB, S(sx * 0.085, fw.radius, pz), S(sx * 0.08, 1.04, 0.48), 0.028, CHROME);
  steerB.geometry(rounded(0.24, 0.06, 0.1, 0.02), '#3a4048', at(0, 1.03, 0.48 - pz));
  fender(steerB, fw.radius + 0.06, 0.16, fw.radius, fw.z - pz, 0.35, 1.9, paint, 1);
  // headlight nacelle
  steerB.sphere(0.13, 0.13, 0.11, 0, 0.95, 0.6 - pz, paint, true, 1);
  steerB.sphere(0.1, 0.1, 0.05, 0, 0.95, 0.69 - pz, LIGHT, true);
  torus(steerB, 0.1, 0.018, 0, 0.95, 0.69 - pz, CHROME);
  for (const sx of [1, -1]) steerB.geometry(rounded(0.07, 0.05, 0.05, 0.02), AMBER, at(sx * 0.17, 0.95, 0.6 - pz));
  // handlebar, grips, levers, mirrors, speedo
  const hy = 1.2;
  const hz = 0.4 - pz;
  rod(steerB, S(0.0, 1.05, 0.46), S(0, hy, 0.42), 0.022, '#3a4048');
  rod(steerB, V(-0.3, hy, hz), V(0.3, hy, hz), 0.016, '#3a4048');
  for (const sx of [1, -1]) {
    rod(steerB, V(sx * 0.3, hy, hz), V(sx * 0.38, hy + 0.01, hz - 0.03), 0.024, '#2b2f36');
    rod(steerB, V(sx * 0.2, hy + 0.01, hz + 0.02), V(sx * 0.34, hy - 0.01, hz + 0.08), 0.008, CHROME);
    rod(steerB, V(sx * 0.22, hy, hz), V(sx * 0.27, hy + 0.2, hz + 0.02), 0.009, '#3a4048');
    steerB.sphere(0.055, 0.04, 0.02, sx * 0.28, hy + 0.23, hz + 0.02, '#c9d6e4', true);
  }
  steerB.sphere(0.06, 0.06, 0.025, 0, hy + 0.03, hz + 0.05, '#2b2f36', true);
  steerB.sphere(0.045, 0.045, 0.01, 0, hy + 0.035, hz + 0.065, '#f6efe2', true);
  void acc;
  const steer: SteerRig = {
    geometry: steerB.build(),
    pivot: V(0, 0, pz),
    rake: 0,
    axis: 'y',
    ratio: 1,
    grips: [V(0.34, hy, hz - 0.015), V(-0.34, hy, hz - 0.015)],
  };
  return { steer, seat: { hip: V(0, 1.14, -0.02), pose: 'bike' as SeatPose, scale: 1 }, passengerSeat: V(0, 1.15, -0.52), door: V(1.0, 0, -0.2) };
}

function buildAuto(spec: VehicleSpec, paint: string, b: GeoBuilder, glass: GeoBuilder, steerB: GeoBuilder) {
  const L = spec.length;
  const W = spec.width;
  const H = spec.height + 0.1;
  const acc = spec.accentColor;
  const fw = spec.wheels.visual[0];
  const rearZ = spec.wheels.visual[1].z;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const bottom = 0.3;
  // rear tub (green) with arches for the two rear wheels
  const tub: Cmd[] = [
    { z: -L / 2, y: bottom, r: 0.12 },
    { arch: true, z: rearZ, axle: 0.26, R: 0.36, bottom },
    { z: 0.45, y: bottom },
    { z: 0.45, y: 0.72, r: 0.05 },
    { z: -0.3, y: 0.78, r: 0.12 },
    { z: -L / 2, y: 0.98, r: 0.25 },
  ];
  const tg = extrudeProfile(tub, W, 0.09);
  b.geometry(tg, acc);
  tg.dispose();
  // front cowl (narrow, green) over the single front wheel
  const cowl: Cmd[] = [
    { z: 0.3, y: bottom },
    { arch: true, z: fw.z, axle: fw.radius, R: fw.radius + 0.08, bottom },
    { z: L / 2, y: bottom, r: 0.1 },
    { z: L / 2 + 0.02, y: 0.78, r: 0.22 },
    { z: 0.95, y: 1.08, r: 0.12 },
    { z: 0.55, y: 1.1, r: 0.06 },
    { z: 0.3, y: 0.9 },
  ];
  const cg = extrudeProfile(cowl, 0.86, 0.08);
  b.geometry(cg, acc);
  cg.dispose();
  // floor + passenger bench + back rest
  b.geometry(rounded(W - 0.08, 0.06, L * 0.8, 0.03), INTERIOR, at(0, bottom + 0.06, -0.15));
  rbox(b, W * 0.84, 0.16, 0.5, 0, 0.62, -0.88, SEAT, 0.06);
  rbox(b, W * 0.84, 0.5, 0.13, 0, 0.92, -1.12, SEAT, 0.06, 0, -0.08);
  // driver seat
  rbox(b, 0.46, 0.12, 0.36, 0, 0.74, 0.2, '#2b2f36', 0.05);
  // canopy (yellow, tinted) with rounded roof, back panel and posts
  const roof: Cmd[] = [
    { z: -L / 2 - 0.02, y: H - 0.12 },
    { z: 0.98, y: H - 0.12 },
    { z: 0.92, y: H + 0.02, r: 0.12 },
    { z: -L / 2 + 0.08, y: H + 0.05, r: 0.25 },
  ];
  const rg = extrudeProfile(roof, W * 1.05, 0.08);
  b.geometry(rg, paint, undefined, 1);
  rg.dispose();
  rbox(b, W * 0.98, H - 1.0, 0.1, 0, (H + 0.95) / 2 - 0.03, -L / 2 + 0.06, paint, 0.05, 1);
  b.geometry(rounded(W * 0.5, 0.22, 0.03, 0.04), GLASS, at(0, H - 0.42, -L / 2 + 0.0));
  for (const sx of [1, -1]) {
    rod(b, V(sx * W * 0.47, 0.75, 0.86), V(sx * W * 0.47, H - 0.1, 0.9), 0.035, paint, 1);
    rod(b, V(sx * W * 0.47, 0.95, -0.55), V(sx * W * 0.47, H - 0.1, -0.55), 0.035, paint, 1);
    rbox(b, 0.06, 0.08, L * 0.62, sx * W * 0.49, H - 0.18, -0.2, mix(paint, '#000000', 0.12), 0.03, 1); // rain gutter
    // grab rail on the open side
    rod(b, V(sx * W * 0.46, 0.95, -0.5), V(sx * W * 0.46, 0.95, 0.05), 0.018, CHROME);
  }
  // windscreen with frame and wiper
  slopeSlab(glass, 0.9, 1.08, 0.94, H - 0.14, W * 0.82, 0.03, 0, GLASS_LIGHT, 0.04);
  slopeSlab(b, 0.9, 1.08, 0.94, H - 0.14, W * 0.86, 0.02, 0, paint, -0.02, -0.02, 1);
  rod(b, V(-0.1, 1.12, 0.93), V(0.25, 1.4, 0.95), 0.01, '#2b2f36');
  // headlight + indicators + tail lamps + mudflaps + mirror
  b.sphere(0.12, 0.12, 0.07, 0, 0.82, L / 2 + 0.02, LIGHT, true);
  torus(b, 0.12, 0.02, 0, 0.82, L / 2 + 0.02, CHROME);
  for (const sx of [1, -1]) {
    b.geometry(rounded(0.08, 0.05, 0.04, 0.02), AMBER, at(sx * 0.3, 0.95, L / 2 - 0.12));
    b.geometry(rounded(0.18, 0.1, 0.05, 0.03), TAIL, at(sx * 0.45, 0.6, -L / 2 - 0.02));
    rbox(b, 0.18, 0.2, 0.02, sx * 0.58, 0.18, rearZ - 0.4, '#2b2f36', 0.01);
  }
  rod(b, V(0.4, 1.1, 0.9), V(0.62, 1.2, 0.92), 0.015, DARK);
  rbox(b, 0.1, 0.12, 0.03, 0.66, 1.22, 0.92, DARK, 0.03);
  b.geometry(rounded(0.24, 0.1, 0.02, 0.02), PLATE, at(0, 0.45, -L / 2 - 0.03));
  // handlebar steering (column just ahead of the driver)
  const pz = 0.66;
  const hy = 1.08;
  const hz = 0.62 - pz;
  rod(steerB, V(0, 0.98, 0.68 - pz), V(0, hy, hz), 0.025, '#3a4048');
  rod(steerB, V(-0.3, hy, hz), V(0.3, hy, hz), 0.017, '#3a4048');
  for (const sx of [1, -1]) rod(steerB, V(sx * 0.3, hy, hz), V(sx * 0.37, hy + 0.01, hz - 0.03), 0.025, '#2b2f36');
  steerB.sphere(0.05, 0.05, 0.02, 0, hy + 0.03, hz + 0.04, '#2b2f36', true);
  const steer: SteerRig = { geometry: steerB.build(), pivot: V(0, 0, pz), rake: 0, axis: 'y', ratio: 1, grips: [V(0.34, hy, hz - 0.015), V(-0.34, hy, hz - 0.015)] };
  return { steer, seat: { hip: V(0, 0.9, 0.2), pose: 'auto' as SeatPose, scale: 0.95 }, passengerSeat: V(0.25, 0.83, -0.85), door: V(W / 2 + 0.6, 0, -0.75) };
}

function mix(a: string, b: string, t: number) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

export function buildVehicleParts(spec: VehicleSpec, paint: string, withRider = true, trafficDriver = false, animatedDoors = false): VehicleModelParts {
  const b = new GeoBuilder();
  const glass = new GeoBuilder();
  const steerB = new GeoBuilder();
  let r: { steer: SteerRig; seat: DriverSeat; passengerSeat: THREE.Vector3 | null; door: THREE.Vector3 };
  switch (spec.kind) {
    case 'bike':
      r = buildBike(spec, paint, b, steerB);
      break;
    case 'auto':
      r = buildAuto(spec, paint, b, glass, steerB);
      break;
    case 'bus':
      r = buildBus(spec, paint, b, glass, steerB, animatedDoors);
      break;
    default:
      r = buildCar(spec, paint, b, glass, steerB);
  }
  const wheel = spec.wheels.visual.map((w) => buildWheelGeometry(w.radius, w.width));
  const rider = withRider ? bakeDriver(spec, r.seat, r.steer, driverLookFor(spec, trafficDriver)) : null;
  return { body: b.build(), glass: glass.empty ? null : glass.build(), rider, steer: r.steer, seat: r.seat, wheel, passengerSeat: r.passengerSeat, door: r.door };
}

/** Single merged geometry (body + glass + steering + driver + wheels) for instanced traffic/parked cars and thumbnails. */
/** lowDetail: true = far LOD; 'mid' = near LOD; false = full detail. */
export function buildStaticVehicleGeometry(spec: VehicleSpec, paint = '#ffffff', withDriver = true, lowDetail: boolean | 'mid' = false) {
  const prevQ = Q;
  const prevLow = setLowDetail(lowDetail !== false);
  Q = lowDetail === true ? QUALITY[0] : lowDetail === 'mid' ? QUALITY[1] : QUALITY[2];
  const parts = buildVehicleParts(spec, paint, withDriver && lowDetail !== true, true);
  const b = new GeoBuilder();
  b.merge(parts.body);
  if (parts.glass) b.merge(parts.glass);
  if (parts.steer && lowDetail !== true) {
    E.set(parts.steer.rake, 0, 0);
    Qt.setFromEuler(E);
    b.merge(parts.steer.geometry, new THREE.Matrix4().compose(parts.steer.pivot, Qt, ONE));
  }
  if (parts.rider) b.merge(parts.rider);
  spec.wheels.visual.forEach((w, i) => {
    b.merge(parts.wheel[i], at(w.x === 0 ? 0 : Math.sign(w.x) * (Math.abs(w.x) + 0.02), w.radius, w.z));
  });
  for (const g of [parts.body, parts.glass, parts.steer?.geometry, parts.rider, ...parts.wheel]) g?.dispose();
  Q = prevQ;
  setLowDetail(prevLow);
  return b.build();
}
