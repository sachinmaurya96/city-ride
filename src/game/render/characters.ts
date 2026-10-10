import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder';

// Procedural cozy-cartoon characters with a real (rigid-skinned) skeleton.
// Every body part is built in bind space (standing, facing +Z, feet at y = 0, character's left = +X)
// and bound to exactly one bone, so the same build gives either a live SkinnedMesh (player,
// passengers, pedestrians) or a static mesh baked in any pose (traffic drivers, café guests).

export type Gender = 'male' | 'female';
export type HairStyle = 'short' | 'quiff' | 'curly' | 'buzz' | 'bob' | 'ponytail' | 'long' | 'bun';
export type TopStyle = 'tee' | 'long' | 'jacket' | 'polo' | 'dress';
export type BottomStyle = 'pants' | 'shorts' | 'skirt';
export type Accessory = 'none' | 'backpack' | 'bag' | 'glasses' | 'cap';

export interface Look {
  gender: Gender;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  topStyle: TopStyle;
  /** Inner shirt for jackets / collar color for polos. */
  inner: string;
  bottom: string;
  bottomStyle: BottomStyle;
  shoes: string;
  acc: Accessory;
  accColor: string;
  /** Riding helmet shell color (replaces hair on top). */
  helmet?: string;
  mustache?: boolean;
}

export const BONE = { hips: 0, spine: 1, head: 2, uArmL: 3, fArmL: 4, uArmR: 5, fArmR: 6, thighL: 7, shinL: 8, footL: 9, thighR: 10, shinR: 11, footR: 12 } as const;
const PARENT = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 8, 0, 10, 11];
const BONE_COUNT = PARENT.length;

export interface Proportions {
  /** Joint (bone origin) positions in bind space, by bone index. */
  joints: THREE.Vector3[];
  wristL: THREE.Vector3;
  wristR: THREE.Vector3;
  headY: number;
  thighLen: number;
  shinLen: number;
  ankleH: number;
  shoulderW: number;
}

function makeProportions(g: Gender): Proportions {
  const f = g === 'female';
  const s = f ? 0.965 : 1;
  const hipY = 0.77 * s;
  const kneeY = 0.425 * s;
  const ankleY = 0.085;
  const hipX = f ? 0.098 : 0.094;
  const shY = f ? 1.165 : 1.205;
  const shX = f ? 0.178 : 0.208;
  const elY = shY - (f ? 0.235 : 0.245);
  const wrY = elY - (f ? 0.22 : 0.23);
  const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const joints = [
    V(0, hipY + 0.03), // hips
    V(0, hipY + 0.13), // spine
    V(0, shY + 0.065), // head (neck base)
    V(shX, shY), // uArmL
    V(shX + 0.02, elY), // fArmL
    V(-shX, shY),
    V(-shX - 0.02, elY),
    V(hipX, hipY), // thighL
    V(hipX, kneeY, 0.005), // shinL
    V(hipX, ankleY), // footL
    V(-hipX, hipY),
    V(-hipX, kneeY, 0.005),
    V(-hipX, ankleY),
  ];
  return {
    joints,
    wristL: V(shX + 0.03, wrY),
    wristR: V(-shX - 0.03, wrY),
    headY: shY + 0.065 + 0.045 + 0.2,
    thighLen: hipY - kneeY,
    shinLen: kneeY - ankleY,
    ankleH: ankleY,
    shoulderW: shX,
  };
}

export const PROPORTIONS: Record<Gender, Proportions> = { male: makeProportions('male'), female: makeProportions('female') };

// ---------------- geometry helpers ----------------

const Y_UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

interface Detail {
  sphere: THREE.BufferGeometry;
  small: THREE.BufferGeometry;
  tiny: THREE.BufferGeometry;
  seg: number;
}
const DETAILS: Detail[] = [
  { sphere: new THREE.SphereGeometry(1, 8, 5), small: new THREE.SphereGeometry(1, 6, 4), tiny: new THREE.SphereGeometry(1, 4, 3), seg: 6 },
  { sphere: new THREE.SphereGeometry(1, 14, 9), small: new THREE.SphereGeometry(1, 9, 6), tiny: new THREE.SphereGeometry(1, 6, 4), seg: 8 },
];

class PartBuilder {
  parts: GeoBuilder[] = Array.from({ length: BONE_COUNT }, () => new GeoBuilder());
  constructor(public d: Detail) {}

  ell(bone: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, color: string, rot?: [number, number, number]) {
    tmpE.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(rx, ry, rz));
    const m = Math.max(rx, ry, rz);
    this.parts[bone].geometry(m < 0.025 ? this.d.tiny : m < 0.075 ? this.d.small : this.d.sphere, color, tmpM);
  }

  /** Tapered limb from a to b with rounded ends. */
  limb(bone: number, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, color: string, caps: [boolean, boolean] = [true, true], depthScale = 1) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const geo = new THREE.CylinderGeometry(rb, ra, len, this.d.seg, 1, true);
    tmpQ.setFromUnitVectors(Y_UP, dir);
    tmpM.compose(tmpP.addVectors(a, b).multiplyScalar(0.5), tmpQ, tmpS.set(1, 1, depthScale));
    this.parts[bone].geometry(geo, color, tmpM);
    geo.dispose();
    if (caps[0]) this.ell(bone, a.x, a.y, a.z, ra, ra, ra * depthScale, color);
    if (caps[1]) this.ell(bone, b.x, b.y, b.z, rb, rb, rb * depthScale, color);
  }

  /** Lathe (revolved profile) around the Y axis, squashed in depth. Profile: [radius, y] pairs. */
  lathe(bone: number, profile: [number, number][], x: number, y: number, z: number, depth: number, color: string, width = 1) {
    const pts = profile.map(([r, py]) => new THREE.Vector2(Math.max(0.0001, r), py));
    const geo = new THREE.LatheGeometry(pts, this.d.seg + 2);
    tmpM.compose(tmpP.set(x, y, z), tmpQ.identity(), tmpS.set(width, 1, depth));
    this.parts[bone].geometry(geo, color, tmpM);
    geo.dispose();
  }

  box(bone: number, x: number, y: number, z: number, w: number, h: number, d: number, color: string, rot?: [number, number, number]) {
    tmpE.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(w, h, d));
    this.parts[bone].geometry(UNIT_BOX, color, tmpM);
  }

  torus(bone: number, x: number, y: number, z: number, r: number, tube: number, arc: number, color: string, rot: [number, number, number]) {
    const geo = new THREE.TorusGeometry(r, tube, 4, 10, arc);
    tmpE.set(rot[0], rot[1], rot[2]);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
    this.parts[bone].geometry(geo, color, tmpM);
    geo.dispose();
  }
}
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function mix(a: string, b: string, t: number) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

// ---------------- character construction ----------------

function buildParts(look: Look, detail: 0 | 1): PartBuilder {
  const pb = new PartBuilder(DETAILS[detail]);
  const P = PROPORTIONS[look.gender];
  const J = P.joints;
  const fem = look.gender === 'female';
  const B = BONE;
  const skin = look.skin;
  const dress = look.topStyle === 'dress';
  const topColor = look.top;
  const sleeveLong = look.topStyle === 'long' || look.topStyle === 'jacket';
  const lower = dress ? look.top : look.bottom;

  // ---- legs ----
  for (const side of [1, -1]) {
    const thigh = side > 0 ? B.thighL : B.thighR;
    const shin = side > 0 ? B.shinL : B.shinR;
    const foot = side > 0 ? B.footL : B.footR;
    const hip = J[thigh];
    const knee = J[shin];
    const ankle = J[foot];
    const legSkin = look.bottomStyle === 'skirt' || dress;
    const shorts = look.bottomStyle === 'shorts';
    const thighColor = legSkin ? skin : lower;
    const shinColor = legSkin || shorts ? skin : lower;
    const tr = fem ? 0.068 : 0.072;
    pb.limb(thigh, hip, knee, tr, fem ? 0.052 : 0.056, thighColor);
    if (shorts) pb.limb(thigh, new THREE.Vector3(hip.x, hip.y - 0.02, 0), new THREE.Vector3(knee.x, knee.y + 0.09, 0.003), tr + 0.012, 0.066, lower, [false, true]);
    pb.limb(shin, knee, new THREE.Vector3(ankle.x, ankle.y + 0.02, 0), fem ? 0.05 : 0.054, fem ? 0.04 : 0.044, shinColor);
    if (!legSkin && !shorts) pb.limb(shin, new THREE.Vector3(ankle.x, ankle.y + 0.07, 0), new THREE.Vector3(ankle.x, ankle.y + 0.025, 0), 0.05, 0.05, mix(lower, '#000000', 0.15), [false, false]);
    if (legSkin || shorts) pb.limb(shin, new THREE.Vector3(ankle.x, ankle.y + 0.05, 0), new THREE.Vector3(ankle.x, ankle.y + 0.0, 0), 0.046, 0.046, '#f6f2ea', [false, false]); // socks
    // shoe: rounded upper + white sole + toe cap
    const sx = ankle.x;
    pb.ell(foot, sx, 0.06, 0.035, fem ? 0.056 : 0.062, 0.052, fem ? 0.105 : 0.115, look.shoes);
    pb.ell(foot, sx, 0.05, 0.1, fem ? 0.05 : 0.056, 0.042, 0.06, mix(look.shoes, '#ffffff', 0.18));
    pb.box(foot, sx, 0.016, 0.04, fem ? 0.1 : 0.112, 0.032, fem ? 0.21 : 0.23, '#f4efe6');
  }

  // ---- pelvis / skirt ----
  const hy = J[B.hips].y;
  if (look.bottomStyle === 'skirt' || dress) {
    pb.lathe(B.hips, [[0.0, -0.3], [0.24, -0.3], [0.235, -0.27], [0.2, -0.14], [0.165, 0.0], [0.15, 0.08], [0.0, 0.08]], 0, hy, 0, 0.82, lower);
    pb.ell(B.hips, 0, hy - 0.04, 0, 0.15, 0.1, 0.12, lower);
  } else {
    pb.ell(B.hips, 0, hy - 0.035, 0, fem ? 0.165 : 0.16, 0.12, fem ? 0.125 : 0.12, lower);
    pb.lathe(B.hips, [[0, 0], [0.15, 0.0], [0.158, 0.035], [0.155, 0.075], [0, 0.075]], 0, hy, 0, 0.78, mix(lower, '#000000', 0.25), fem ? 1.03 : 1); // belt
    if (!fem) pb.box(B.hips, 0, hy + 0.055, 0.118, 0.05, 0.035, 0.02, '#e8c66a'); // buckle
  }

  // ---- torso ----
  const sy = J[B.spine].y;
  const torsoColor = look.topStyle === 'jacket' ? look.top : topColor;
  const torsoProfile: [number, number][] = fem
    ? [[0, -0.04], [0.135, -0.04], [0.128, 0.04], [0.142, 0.14], [0.155, 0.2], [0.148, 0.255], [0.11, 0.3], [0.05, 0.32], [0, 0.322]]
    : [[0, -0.04], [0.15, -0.04], [0.158, 0.06], [0.178, 0.18], [0.186, 0.25], [0.168, 0.3], [0.1, 0.335], [0.04, 0.345], [0, 0.346]];
  pb.lathe(B.spine, torsoProfile, 0, sy, 0, fem ? 0.74 : 0.7, torsoColor, fem ? 1 : 1.04);
  if (fem) {
    pb.ell(B.spine, 0.06, sy + 0.17, 0.065, 0.065, 0.06, 0.05, torsoColor);
    pb.ell(B.spine, -0.06, sy + 0.17, 0.065, 0.065, 0.06, 0.05, torsoColor);
  }
  const front = fem ? 0.112 : 0.13;
  if (look.topStyle === 'jacket') {
    // open jacket: inner shirt panel, lapels, zipper line
    pb.box(B.spine, 0, sy + 0.16, front + 0.005, 0.085, 0.3, 0.02, look.inner);
    pb.box(B.spine, 0.06, sy + 0.27, front - 0.005, 0.05, 0.1, 0.03, mix(look.top, '#000000', 0.12), [0, 0, -0.5]);
    pb.box(B.spine, -0.06, sy + 0.27, front - 0.005, 0.05, 0.1, 0.03, mix(look.top, '#000000', 0.12), [0, 0, 0.5]);
    pb.box(B.spine, 0.09, sy + 0.09, front + 0.002, 0.06, 0.05, 0.02, mix(look.top, '#000000', 0.1)); // pocket
  } else if (look.topStyle === 'polo') {
    pb.box(B.spine, 0.045, sy + 0.31, front - 0.045, 0.07, 0.035, 0.05, look.inner, [0.3, 0, -0.35]);
    pb.box(B.spine, -0.045, sy + 0.31, front - 0.045, 0.07, 0.035, 0.05, look.inner, [0.3, 0, 0.35]);
    for (let i = 0; i < 2; i++) pb.ell(B.spine, 0, sy + 0.27 - i * 0.04, front - 0.012 + i * 0.004, 0.009, 0.009, 0.006, '#fbf6ea');
  } else if (look.topStyle === 'tee') {
    pb.ell(B.spine, 0.075, sy + 0.17, front - 0.012, 0.035, 0.035, 0.01, mix(look.top, '#ffffff', 0.45)); // chest print
  } else if (dress) {
    pb.box(B.spine, 0, sy + 0.02, fem ? 0.1 : 0.12, 0.25, 0.03, 0.02, mix(look.top, '#ffffff', 0.4)); // waist ribbon
  }
  // neck
  const neckBase = J[B.head];
  pb.limb(B.head, new THREE.Vector3(0, neckBase.y - 0.04, 0), new THREE.Vector3(0, neckBase.y + 0.08, 0.005), fem ? 0.047 : 0.055, fem ? 0.045 : 0.052, skin, [false, true]);

  // ---- arms ----
  for (const side of [1, -1]) {
    const ua = side > 0 ? B.uArmL : B.uArmR;
    const fa = side > 0 ? B.fArmL : B.fArmR;
    const sh = J[ua];
    const el = J[fa];
    const wr = side > 0 ? P.wristL : P.wristR;
    const ur = fem ? 0.047 : 0.055;
    // shoulder ball in top color
    pb.ell(ua, sh.x - Math.sign(sh.x) * 0.012, sh.y - 0.005, sh.z, ur + 0.01, ur + 0.012, ur + 0.006, torsoColor);
    if (sleeveLong) {
      pb.limb(ua, sh, el, ur, ur - 0.006, torsoColor);
      pb.limb(fa, el, wr, ur - 0.006, ur - 0.012, torsoColor);
      pb.limb(fa, new THREE.Vector3().lerpVectors(el, wr, 0.85), wr, ur - 0.004, ur - 0.004, mix(torsoColor, '#000000', 0.15), [false, false]); // cuff
    } else if (dress && fem) {
      pb.limb(ua, sh, el, ur - 0.008, ur - 0.012, skin);
      pb.limb(fa, el, wr, ur - 0.012, ur - 0.017, skin);
    } else {
      const mid = new THREE.Vector3().lerpVectors(sh, el, 0.55);
      pb.limb(ua, sh, mid, ur + 0.01, ur + 0.006, torsoColor);
      pb.limb(ua, mid, el, ur - 0.008, ur - 0.012, skin, [false, true]);
      pb.limb(fa, el, wr, ur - 0.012, ur - 0.017, skin);
    }
    // hand (mitten + thumb)
    pb.ell(fa, wr.x, wr.y - 0.045, wr.z + 0.005, fem ? 0.04 : 0.046, fem ? 0.058 : 0.064, fem ? 0.034 : 0.038, skin);
    pb.ell(fa, wr.x - side * 0.006, wr.y - 0.03, wr.z + 0.04, 0.017, 0.03, 0.017, skin, [0.4, 0, 0]);
  }

  // ---- head ----
  const H = P.headY;
  const hb = B.head;
  const hr = fem ? 0.198 : 0.205;
  pb.ell(hb, 0, H, 0, hr, hr * 1.02, hr * 0.95, skin);
  pb.ell(hb, 0, H - 0.07, 0.03, hr * 0.84, hr * 0.72, hr * 0.8, skin); // jaw / cheeks
  for (const sx of [1, -1]) pb.ell(hb, sx * hr * 0.98, H - 0.01, -0.005, 0.032, 0.052, 0.03, mix(skin, '#c97b5a', 0.15));
  const fz = hr * 0.93;
  // eyes with highlights
  for (const sx of [1, -1]) {
    const ex = sx * 0.072;
    pb.ell(hb, ex, H - 0.005, fz - 0.012, 0.03, fem ? 0.044 : 0.04, 0.022, '#2a2320');
    pb.ell(hb, ex + 0.01, H + 0.01, fz + 0.006, 0.01, 0.011, 0.006, '#ffffff');
    // brows
    pb.box(hb, ex, H + 0.068, fz - 0.002, fem ? 0.058 : 0.066, fem ? 0.012 : 0.017, 0.02, mix(look.hair, '#000000', 0.2), [-0.25, 0, sx * (fem ? 0.12 : 0.06)]);
    if (fem) pb.box(hb, ex + sx * 0.03, H + 0.03, fz - 0.004, 0.026, 0.009, 0.012, '#2a2320', [0, 0, sx * 0.55]);
    // blush
    pb.ell(hb, sx * 0.118, H - 0.062, fz - 0.035, 0.034, 0.02, 0.012, mix(skin, '#ff7b7b', fem ? 0.38 : 0.22));
  }
  pb.ell(hb, 0, H - 0.04, fz + 0.012, 0.026, 0.022, 0.024, mix(skin, '#b8704b', 0.18)); // nose
  pb.torus(hb, 0, H - 0.078, fz - 0.018, fem ? 0.026 : 0.03, fem ? 0.009 : 0.008, Math.PI, fem ? '#c4535f' : '#8a3b3b', [0.25, 0, Math.PI]); // smile
  if (look.mustache && !fem) pb.ell(hb, 0, H - 0.062, fz - 0.002, 0.045, 0.013, 0.015, look.hair);

  // ---- hair / headwear ----
  const hair = look.hair;
  const hairDark = mix(hair, '#000000', 0.12);
  if (look.helmet) {
    pb.ell(hb, 0, H + 0.035, -0.012, hr * 1.17, hr * 1.12, hr * 1.16, look.helmet);
    pb.ell(hb, 0, H + 0.035, -0.012, hr * 1.19, hr * 0.12, hr * 1.18, mix(look.helmet, '#ffffff', 0.55)); // stripe
    pb.box(hb, 0, H + 0.09, hr * 1.02, hr * 1.3, 0.05, 0.05, mix(look.helmet, '#000000', 0.2), [-0.3, 0, 0]); // visor brim
    pb.box(hb, 0, H - 0.115, 0.08, 0.16, 0.02, 0.02, '#2b2f36'); // chin strap
    if (look.hairStyle === 'ponytail' || look.hairStyle === 'long' || look.hairStyle === 'bun') {
      pb.ell(hb, 0, H - 0.1, -hr * 1.12, 0.07, 0.11, 0.06, hair, [-0.2, 0, 0]);
      pb.ell(hb, 0, H - 0.22, -hr * 1.08, 0.055, 0.09, 0.05, hairDark, [-0.1, 0, 0]);
    }
  } else {
    const style = look.hairStyle;
    const cap = (yOff: number, scale: number) => pb.ell(hb, 0, H + 0.055 + yOff, -0.03, hr * 1.06 * scale, hr * 0.9 * scale, hr * 1.04 * scale, hair);
    if (style === 'buzz') pb.ell(hb, 0, H + 0.04, -0.018, hr * 1.025, hr * 0.92, hr * 1.0, hair);
    else cap(0, 1);
    if (style === 'short' || style === 'quiff') {
      pb.ell(hb, 0.06, H + 0.135, hr * 0.62, 0.1, 0.055, 0.07, hair, [0.35, 0, -0.25]);
      pb.ell(hb, -0.05, H + 0.14, hr * 0.6, 0.09, 0.05, 0.07, hairDark, [0.35, 0, 0.3]);
      for (const sx of [1, -1]) pb.ell(hb, sx * hr * 0.93, H + 0.02, -0.01, 0.04, 0.085, 0.07, hair);
      if (style === 'quiff') pb.ell(hb, 0.01, H + 0.2, hr * 0.42, 0.11, 0.08, 0.1, hair, [0.5, 0, 0]);
    } else if (style === 'curly') {
      const pts: [number, number, number][] = [[0.0, 0.2, 0.05], [0.1, 0.17, 0.1], [-0.1, 0.17, 0.1], [0.14, 0.12, -0.05], [-0.14, 0.12, -0.05], [0.0, 0.17, -0.12], [0.07, 0.18, -0.03], [-0.07, 0.2, -0.02], [0.05, 0.13, 0.15], [-0.06, 0.13, 0.15]];
      pts.forEach(([x, y, z], i) => pb.ell(hb, x, H + y, z, 0.07, 0.065, 0.07, i % 2 ? hair : hairDark));
    } else if (fem) {
      // bangs
      pb.ell(hb, 0.06, H + 0.115, hr * 0.7, 0.1, 0.06, 0.06, hair, [0.25, 0, -0.35]);
      pb.ell(hb, -0.07, H + 0.12, hr * 0.68, 0.1, 0.058, 0.06, hairDark, [0.25, 0, 0.3]);
      if (style === 'bob') {
        for (const sx of [1, -1]) pb.ell(hb, sx * hr * 0.92, H - 0.04, -0.01, 0.07, 0.15, 0.13, hair);
        pb.ell(hb, 0, H - 0.03, -0.09, hr * 1.02, 0.16, 0.13, hair);
      } else if (style === 'ponytail') {
        pb.ell(hb, 0, H + 0.04, -hr * 1.0, 0.045, 0.045, 0.03, look.accColor); // scrunchie
        pb.ell(hb, 0, H - 0.04, -hr * 1.1, 0.065, 0.11, 0.06, hair, [-0.25, 0, 0]);
        pb.ell(hb, 0, H - 0.17, -hr * 1.08, 0.05, 0.09, 0.05, hairDark, [-0.1, 0, 0]);
        for (const sx of [1, -1]) pb.ell(hb, sx * hr * 0.92, H + 0.0, 0.02, 0.035, 0.08, 0.05, hair);
      } else if (style === 'long') {
        pb.ell(hb, 0, H - 0.13, -0.1, hr * 0.98, 0.25, 0.11, hair);
        for (const sx of [1, -1]) pb.ell(hb, sx * hr * 0.88, H - 0.1, 0.0, 0.055, 0.19, 0.08, hair);
      } else if (style === 'bun') {
        pb.ell(hb, 0, H + 0.21, -0.07, 0.09, 0.08, 0.09, hair);
        pb.ell(hb, 0, H + 0.15, -0.07, 0.06, 0.02, 0.06, look.accColor);
        for (const sx of [1, -1]) pb.ell(hb, sx * hr * 0.93, H + 0.0, 0.02, 0.035, 0.07, 0.05, hair);
      }
    }
    if (look.acc === 'cap') {
      pb.ell(hb, 0, H + 0.085, -0.015, hr * 1.1, hr * 0.78, hr * 1.08, look.accColor);
      pb.ell(hb, 0, H + 0.075, hr * 0.98, hr * 0.62, 0.02, hr * 0.5, mix(look.accColor, '#000000', 0.15), [-0.12, 0, 0]);
    }
  }
  if (look.acc === 'glasses') {
    for (const sx of [1, -1]) pb.torus(hb, sx * 0.072, H - 0.005, fz + 0.016, 0.045, 0.008, Math.PI * 2, '#2b2f36', [0, 0, 0]);
    pb.box(hb, 0, H, fz + 0.02, 0.05, 0.01, 0.01, '#2b2f36');
  }

  // ---- bags ----
  if (look.acc === 'backpack') {
    const bz = fem ? -0.135 : -0.15;
    pb.ell(B.spine, 0, sy + 0.16, bz - 0.05, 0.15, 0.18, 0.09, look.accColor);
    pb.box(B.spine, 0, sy + 0.08, bz - 0.13, 0.17, 0.09, 0.03, mix(look.accColor, '#000000', 0.2)); // pocket
    for (const sx of [1, -1]) pb.box(B.spine, sx * 0.085, sy + 0.2, front - 0.01, 0.03, 0.26, 0.02, mix(look.accColor, '#000000', 0.3), [0.1, 0, 0]);
  } else if (look.acc === 'bag') {
    pb.box(B.spine, 0, sy + 0.17, front - 0.004, 0.035, 0.42, 0.02, mix(look.accColor, '#000000', 0.25), [0, 0, 0.8]);
    pb.box(B.spine, 0, sy + 0.17, -front + 0.004, 0.035, 0.42, 0.02, mix(look.accColor, '#000000', 0.25), [0, 0, 0.8]);
    pb.ell(B.hips, -(fem ? 0.2 : 0.21), hy - 0.04, 0.02, 0.05, 0.11, 0.13, look.accColor);
  }
  return pb;
}

function withSkin(geo: THREE.BufferGeometry, bone: number) {
  const n = geo.getAttribute('position').count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = bone;
    w[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return geo;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function lookKey(l: Look, detail: number) {
  return `${JSON.stringify(l)}|${detail}`;
}

/** Merged skinned geometry (skinIndex/skinWeight). Cached per look. */
export function buildCharacterGeometry(look: Look, detail: 0 | 1 = 1): THREE.BufferGeometry {
  const key = lookKey(look, detail);
  const hit = geoCache.get(key);
  if (hit) return hit;
  const pb = buildParts(look, detail);
  const geos = pb.parts.map((g, i) => (g.empty ? null : withSkin(g.build(), i))).filter((g): g is THREE.BufferGeometry => !!g);
  const merged = new GeoBuilderSkinned().merge(geos);
  geoCache.set(key, merged);
  return merged;
}

class GeoBuilderSkinned {
  merge(geos: THREE.BufferGeometry[]) {
    let count = 0;
    for (const g of geos) count += g.getAttribute('position').count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    let o = 0;
    for (const g of geos) {
      const n = g.getAttribute('position').count;
      pos.set(g.getAttribute('position').array as Float32Array, o * 3);
      nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
      col.set(g.getAttribute('color').array as Float32Array, o * 3);
      si.set(g.getAttribute('skinIndex').array as Uint16Array, o * 4);
      sw.set(g.getAttribute('skinWeight').array as Float32Array, o * 4);
      o += n;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }
}

// ---------------- rig ----------------

export interface Rig {
  gender: Gender;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  P: Proportions;
}

export function createRig(gender: Gender): Rig {
  const P = PROPORTIONS[gender];
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const b = new THREE.Bone();
    const p = PARENT[i];
    const j = P.joints[i];
    if (p < 0) b.position.copy(j);
    else b.position.subVectors(j, P.joints[p]);
    b.rotation.order = 'YXZ';
    bones.push(b);
    if (p >= 0) bones[p].add(b);
  }
  bones[0].updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { gender, bones, skeleton, P };
}

/** A live, animatable character. The mesh origin is between the feet on the ground. */
export function createCharacterMesh(look: Look, detail: 0 | 1 = 1, material?: THREE.Material) {
  const rig = createRig(look.gender);
  const geo = buildCharacterGeometry(look, detail);
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(rig.bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(rig.skeleton, mesh.matrixWorld);
  mesh.castShadow = true;
  // a generous static bound: skinned bounds are not recomputed per frame
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0.2), 1.3);
  return { mesh, rig };
}

/** Swap clothes/hair on a live mesh (same gender → same skeleton layout). */
export function setLook(mesh: THREE.SkinnedMesh, look: Look, detail: 0 | 1 = 1) {
  mesh.geometry = buildCharacterGeometry(look, detail);
}

/**
 * Static geometry in a pose: each rigid part is moved by its bone's (world × inverse-bind) matrix.
 * `pose` receives a rig in bind pose and sets bone rotations (and may call the arm IK helpers).
 */
export function bakeCharacter(look: Look, detail: 0 | 1, pose: (rig: Rig, root: THREE.Object3D) => void): THREE.BufferGeometry {
  const pb = buildParts(look, detail);
  const rig = createRig(look.gender);
  const root = new THREE.Group();
  root.add(rig.bones[0]);
  root.updateMatrixWorld(true);
  const inv = rig.bones.map((b) => b.matrixWorld.clone().invert());
  pose(rig, root);
  root.updateMatrixWorld(true);
  const out = new GeoBuilder();
  const m = new THREE.Matrix4();
  pb.parts.forEach((g, i) => {
    if (g.empty) return;
    const geo = g.build();
    m.multiplyMatrices(rig.bones[i].matrixWorld, inv[i]);
    out.merge(geo, m);
    geo.dispose();
  });
  return out.build();
}

// ---------------- looks ----------------

const SKINS = ['#f6d2b4', '#f2c9a0', '#e3ac82', '#c98d64', '#a8714d', '#8a5a3c'];
const HAIRS = ['#2a2320', '#3b2a20', '#5a3a26', '#8a5a3a', '#c9893b', '#1f1b18', '#6b4428'];
const TOPS = ['#4fa3e0', '#ef8a6f', '#f2c14e', '#6cc28b', '#d98fb4', '#9b7fd6', '#f6efe2', '#3cc9b0', '#e86b6b', '#f39c5a', '#5b7bd5'];
const BOTTOMS = ['#34507a', '#3a4048', '#6b5a49', '#2f3e58', '#8a7f72', '#c9b79c', '#4a5a3a'];
const SHOES = ['#3a4048', '#7a5233', '#e86b6b', '#f6efe2', '#4f8fd6', '#2b2f36'];
const ACC = ['#7a5233', '#d06b4f', '#2fb5a3', '#f2c14e', '#5b7bd5', '#e9b8d0'];

export function randomLook(rng: () => number, gender?: Gender): Look {
  const p = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length) % a.length];
  const g: Gender = gender ?? (rng() < 0.5 ? 'male' : 'female');
  if (g === 'male') {
    return {
      gender: g,
      skin: p(SKINS),
      hair: p(HAIRS),
      hairStyle: p(['short', 'short', 'quiff', 'curly', 'buzz'] as const),
      top: p(TOPS),
      topStyle: p(['tee', 'tee', 'polo', 'jacket', 'long'] as const),
      inner: p(['#f6efe2', '#ffffff', '#2b2f36', '#f2c14e']),
      bottom: p(BOTTOMS),
      bottomStyle: rng() < 0.25 ? 'shorts' : 'pants',
      shoes: p(SHOES),
      acc: p(['none', 'none', 'backpack', 'bag', 'glasses', 'cap'] as const),
      accColor: p(ACC),
      mustache: rng() < 0.15,
    };
  }
  const topStyle = p(['tee', 'dress', 'jacket', 'long', 'tee', 'dress'] as const);
  return {
    gender: g,
    skin: p(SKINS),
    hair: p(HAIRS),
    hairStyle: p(['bob', 'ponytail', 'long', 'bun', 'long'] as const),
    top: topStyle === 'dress' ? p(['#e86b6b', '#d98fb4', '#9b7fd6', '#f2c14e', '#3cc9b0', '#4fa3e0']) : p(TOPS),
    topStyle,
    inner: p(['#f6efe2', '#ffffff', '#f2c14e', '#e9b8d0']),
    bottom: p(BOTTOMS),
    bottomStyle: topStyle === 'dress' ? 'skirt' : p(['pants', 'skirt', 'pants', 'shorts'] as const),
    shoes: p(SHOES),
    acc: p(['none', 'bag', 'bag', 'backpack', 'glasses', 'none'] as const),
    accColor: p(ACC),
  };
}

/** The player's driver (matches the cozy reference: teal helmet, white tee, navy pants, backpack). */
export const PLAYER_LOOK: Look = {
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
  acc: 'backpack',
  accColor: '#3a4048',
};

export const PLAYER_LOOK_FEMALE: Look = {
  gender: 'female',
  skin: '#f2c9a0',
  hair: '#3b2a20',
  hairStyle: 'ponytail',
  top: '#f6efe2',
  topStyle: 'tee',
  inner: '#ffffff',
  bottom: '#34507a',
  bottomStyle: 'pants',
  shoes: '#3a4048',
  acc: 'backpack',
  accColor: '#3a4048',
};

const FEMALE_NAMES = new Set(['Diya', 'Meera', 'Anaya', 'Priya', 'Sara', 'Nisha', 'Maya', 'Zoya', 'Tara', 'Asha', 'Ira', 'Elena']);
const MALE_NAMES = new Set(['Aarav', 'Kabir', 'Rohan', 'Ishaan', 'Arjun', 'Vikram', 'Leo', 'Dev', 'Neel', 'Omar']);
export function genderForName(name: string, rng: () => number): Gender {
  if (FEMALE_NAMES.has(name)) return 'female';
  if (MALE_NAMES.has(name)) return 'male';
  return rng() < 0.5 ? 'male' : 'female';
}
