import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { loadGlb } from './glbAssets';
import type { SeatDynamics, SeatPose } from './charAnim';
import { WALK, footAt, smooth } from './gait';
import { CHARACTER_GENDER, type CharacterId } from '../data/characters';

export { CHARACTER_IDS, CHARACTER_NAMES, type CharacterId } from '../data/characters';

type CharacterState = { status: 'loading' | 'ready' | 'error'; model?: THREE.Group };
const loading: CharacterState = { status: 'loading' };
const states = new Map<CharacterId, CharacterState>();
const pending = new Map<CharacterId, Promise<THREE.Group>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

const JOINTS = ['hips', 'spine', 'head', 'upperL', 'foreL', 'handL', 'upperR', 'foreR', 'handR', 'thighL', 'calfL', 'footL', 'thighR', 'calfR', 'footR'] as const;
type Joint = typeof JOINTS[number];
/** Limb bones of the supplied skeletons: Kuro's Bip001 (Lynae, Chisa), NTE's dashed Bip001 (Mint) and MMD conversions (Carlotta, Zani). */
const NATIVE_RIGS = {
  bip001: { hips: 'Bip001Pelvis', spine: 'Bip001Spine', head: 'Bip001Head', upperL: 'Bip001LUpperArm', foreL: 'Bip001LForearm', handL: 'Bip001LHand',
    upperR: 'Bip001RUpperArm', foreR: 'Bip001RForearm', handR: 'Bip001RHand', thighL: 'Bip001LThigh', calfL: 'Bip001LCalf', footL: 'Bip001LFoot',
    thighR: 'Bip001RThigh', calfR: 'Bip001RCalf', footR: 'Bip001RFoot' },
  dashed: { hips: 'Bip001-Pelvis', spine: 'Bip001-Spine', head: 'Bip001-Head', upperL: 'Bip001-L-UpperArm', foreL: 'Bip001-L-Forearm', handL: 'Bip001-L-Hand',
    upperR: 'Bip001-R-UpperArm', foreR: 'Bip001-R-Forearm', handR: 'Bip001-R-Hand', thighL: 'Bip001-L-Thigh', calfL: 'Bip001-L-Calf', footL: 'Bip001-L-Foot',
    thighR: 'Bip001-R-Thigh', calfR: 'Bip001-R-Calf', footR: 'Bip001-R-Foot' },
  mmd: { hips: 'Hips', spine: 'Spine', head: 'Head', upperL: 'Left_arm', foreL: 'Left_elbow', handL: 'Left_wrist',
    upperR: 'Right_arm', foreR: 'Right_elbow', handR: 'Right_wrist', thighL: 'Left_leg', calfL: 'Left_knee', footL: 'Left_ankle',
    thighR: 'Right_leg', calfR: 'Right_knee', footR: 'Right_ankle' },
} satisfies Record<string, Record<Joint, string>>;
type NativeRig = keyof typeof NATIVE_RIGS;

type Point = readonly [number, number, number];
/**
 * An unrigged character's measured joint centres — midline and left side, as fractions of the full height in the
 * source frame (x left, y up from the soles, z forward) — plus which meshes are head-mounted (face, hair, hats) or loose
 * cloth that hangs from the waist (skirts, dress tails, sashes), by traversal index.
 */
interface MeasuredRig {
  joints: Record<'hips' | 'spine' | 'head' | 'upper' | 'fore' | 'hand' | 'thigh' | 'calf' | 'foot' | 'toe', Point>;
  /** Where the arm meets the torso: the armpit and the top of the shoulder (x, y). Arm weights start outside this line. */
  armpit: readonly [number, number]; shoulderTop: readonly [number, number];
  meshes: number; head: readonly number[]; skirt: readonly number[];
  /** Long accessories hung from the waist (sashes, tassels, a half cape): pelvis plus part of the thigh, no knee bend. */
  hang?: readonly number[];
}
/**
 * Shorekeeper and Phoebe (A pose, ~34° arms), traced from orthographic renders and slice centrelines of the original
 * meshes. Wrists sit where the hand starts, as on Carlotta's native skeleton in the same pose; arms then measure
 * 0.44–0.45 m like Kuro's own (Chisa, Lynae: 0.449 m). The spine pivot is low, just above the pelvis, as Kuro's
 * Bip001Spine (0.607 of height): the torso bends from the lower back.
 */
const SHOREKEEPER: MeasuredRig = {
  joints: { hips: [0, .54, -.012], spine: [0, .6, -.008], head: [0, .848, -.02], upper: [.06, .795, -.039], fore: [.168, .7195, -.04], hand: [.276, .644, -.033],
    thigh: [.047, .54, -.012], calf: [.047, .305, -.025], foot: [.054, .07, -.037], toe: [.06, .008, .06] },
  armpit: [.078, .722], shoulderTop: [.062, .815],
  meshes: 41, head: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23, 29, 30, 32, 33], skirt: [10, 19, 20, 25, 26, 27, 38, 40],
};
const PHOEBE: MeasuredRig = {
  joints: { hips: [0, .535, -.018], spine: [0, .6, -.012], head: [0, .857, -.02], upper: [.055, .788, -.032], fore: [.1645, .716, -.028], hand: [.274, .644, -.024],
    thigh: [.045, .535, -.018], calf: [.046, .305, -.03], foot: [.039, .075, -.05], toe: [.04, .005, .047] },
  armpit: [.085, .722], shoulderTop: [.065, .81],
  meshes: 43, head: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 20, 21, 25, 26, 30, 31, 32], skirt: [39, 40], hang: [19, 24, 27, 28, 29],
};

type Rig = { kind: 'generated'; profile: 'cartethyia' | 'male' | 'female' } | { kind: 'native'; bones: NativeRig } | { kind: 'measured'; layout: MeasuredRig };
/**
 * Tail pose on top of its rest shape, standing → seated (blended by how far the character sits): [root pitch, root yaw,
 * per-joint pitch, per-joint yaw] in radians, about the level left-right axis (+ lifts the tip) and the vertical.
 */
interface TailPose { stand: readonly [number, number, number, number]; seated: readonly [number, number, number, number] }
/**
 * Model, rig and overall height (m). Newer characters are scaled so their eyes sit at 1.525 m like the original female
 * characters', whatever horns, hats or bows add above the head.
 */
const CHARACTERS: Record<CharacterId, { url: string; height: number; rig: Rig; tail?: TailPose }> = {
  male: { url: new URL('../../../assets/optimized/characters/male-rover.glb', import.meta.url).href, height: 1.68, rig: { kind: 'generated', profile: 'male' } },
  female: { url: new URL('../../../assets/optimized/characters/female-rover.glb', import.meta.url).href, height: 1.68, rig: { kind: 'generated', profile: 'female' } },
  lynae: { url: new URL('../../../assets/optimized/characters/lynae_from_wuthering_waves.glb', import.meta.url).href, height: 1.68, rig: { kind: 'native', bones: 'bip001' } },
  cartethyia: { url: new URL('../../../assets/optimized/characters/cartethyia_wuthering_waves.glb', import.meta.url).href, height: 1.68, rig: { kind: 'generated', profile: 'cartethyia' } },
  carlotta: { url: new URL('../../../assets/optimized/characters/Carlotta.glb', import.meta.url).href, height: 1.706, rig: { kind: 'native', bones: 'mmd' } },
  chisa: { url: new URL('../../../assets/optimized/characters/chisa.glb', import.meta.url).href, height: 1.669, rig: { kind: 'native', bones: 'bip001' } },
  zani: { url: new URL('../../../assets/optimized/characters/zani.glb', import.meta.url).href, height: 1.72, rig: { kind: 'native', bones: 'mmd' },
    tail: { stand: [-1.25, 0, .09, 0], seated: [.3, 0, .48, 0] } },
  shorekeeper: { url: new URL('../../../assets/optimized/characters/shoerkeeper.glb', import.meta.url).href, height: 1.714, rig: { kind: 'measured', layout: SHOREKEEPER } },
  mint: { url: new URL('../../../assets/optimized/characters/mint.glb', import.meta.url).href, height: 1.699, rig: { kind: 'native', bones: 'dashed' },
    tail: { stand: [0, 0, 0, 0], seated: [1.5, 0, .5, 0] } },
  phoebe: { url: new URL('../../../assets/optimized/characters/phoebe.glb', import.meta.url).href, height: 1.692, rig: { kind: 'measured', layout: PHOEBE } },
};

/** Bind unrigged GLBs to an articulated skeleton while keeping their original geometry, UVs and materials. */
export function rigStaticCharacter(source: THREE.Group, height = 1.68, profile: 'cartethyia' | 'male' | 'female' = 'cartethyia') {
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source, true);
  const scale = height / bounds.getSize(new THREE.Vector3()).y;
  const center = bounds.getCenter(new THREE.Vector3());
  const transform = new THREE.Matrix4().makeScale(scale, scale, scale).setPosition(-center.x * scale, -bounds.min.y * scale, 0);
  const root = new THREE.Group();
  const positions: Record<Joint, THREE.Vector3> = {
    hips: new THREE.Vector3(0, height * .53, 0), spine: new THREE.Vector3(0, height * .63, 0), head: new THREE.Vector3(0, height * .84, 0),
    upperL: new THREE.Vector3(height * .125, height * .78, 0), foreL: new THREE.Vector3(height * .29, height * .78, 0), handL: new THREE.Vector3(height * .45, height * .78, 0),
    upperR: new THREE.Vector3(-height * .125, height * .78, 0), foreR: new THREE.Vector3(-height * .29, height * .78, 0), handR: new THREE.Vector3(-height * .45, height * .78, 0),
    thighL: new THREE.Vector3(height * .05, height * .53, 0), calfL: new THREE.Vector3(height * .05, height * .29, 0), footL: new THREE.Vector3(height * .05, height * .065, 0),
    thighR: new THREE.Vector3(-height * .05, height * .53, 0), calfR: new THREE.Vector3(-height * .05, height * .29, 0), footR: new THREE.Vector3(-height * .05, height * .065, 0),
  };
  if (profile !== 'cartethyia') {
    // Rover exports have lowered arms (A pose), rather than Cartethyia's horizontal T pose.
    // Match those bind directions so shoulders, elbows and wrists bend at the actual limbs.
    positions.hips.y = height * .55; positions.spine.y = height * .68; positions.head.y = height * .85;
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? 1 : -1;
      positions[`upper${side}`].set(sign * height * .09, height * .81, 0);
      positions[`fore${side}`].set(sign * height * .22, height * .73, 0);
      positions[`hand${side}`].set(sign * height * (profile === 'male' ? .32 : .30), height * .65, 0);
      positions[`thigh${side}`].y = positions.hips.y;
    }
  }
  const parents: Record<Joint, Joint | null> = { hips: null, spine: 'hips', head: 'spine', upperL: 'spine', foreL: 'upperL', handL: 'foreL', upperR: 'spine', foreR: 'upperR', handR: 'foreR', thighL: 'hips', calfL: 'thighL', footL: 'calfL', thighR: 'hips', calfR: 'thighR', footR: 'calfR' };
  const bones = JOINTS.map((key) => { const bone = new THREE.Bone(); bone.name = `avatar-${key}`; return bone; });
  JOINTS.forEach((key, i) => {
    const parent = parents[key]; bones[i].position.copy(positions[key]);
    if (parent) { bones[i].position.sub(positions[parent]); bones[JOINTS.indexOf(parent)].add(bones[i]); }
    else root.add(bones[i]);
  });
  const sleeves: THREE.Bone[] = [];
  if (profile === 'cartethyia') for (const side of ['L', 'R'] as const) {
    const bone = new THREE.Bone(); bone.name = `avatar-fore${side}-sleeve`;
    bones[JOINTS.indexOf(`fore${side}`)].add(bone); sleeves.push(bone);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([...bones, ...sleeves]);
  const vertex = new THREE.Vector3(); const nearest = new THREE.Vector3();
  source.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform, o.matrixWorld));
    geometry.computeBoundingBox();
    const meshBounds = geometry.boundingBox!;
    const rover = profile !== 'cartethyia';
    // Long ponytails reach below the waist. Keep them attached to the head, including exports
    // with unreadable mesh names, instead of letting their lowest vertices follow the legs.
    const headMesh = /Face|Eye|Hair|Ear|Hairpin/i.test(o.name) || (rover && (
      /^(bai2|heart|hi_|jie_|mei_|nose|cheek|she_|kou|toushi|hudiejie|bianzi)/i.test(o.name) ||
      (meshBounds.max.y > height * .8 && meshBounds.max.z < -height * .055 && meshBounds.max.x - meshBounds.min.x < height * .2)
    ));
    const lowerClothes = /^Down/i.test(o.name) || (rover && /^(MI_Down|body_2|ce_jie|hou_|qian_)/i.test(o.name));
    const p = geometry.getAttribute('position'); const indices = new Uint16Array(p.count * 4); const weights = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      vertex.fromBufferAttribute(p, i);
      const side = vertex.x >= 0 ? 'L' : 'R';
      let candidates: Joint[];
      if (headMesh) candidates = ['head'];
      else if (vertex.y > height * .82) candidates = ['head'];
      // The translucent sleeves extend well below the elbows. Binding those vertices to
      // the pelvis tears the sleeve whenever an arm moves. Blend at the shoulder instead.
      else if (Math.abs(vertex.x) > height * .14 && vertex.y > height * .38 && !lowerClothes) candidates = ['spine', `upper${side}`, `fore${side}`, `hand${side}`];
      else if (vertex.y < positions.hips.y + height * .01) candidates = [`thigh${side}`, `calf${side}`, `foot${side}`];
      else candidates = ['hips', 'spine'];
      const scores = candidates.map((key) => {
        const endpoint = key.startsWith('upper') ? positions[`fore${side}`] : key.startsWith('fore') ? positions[`hand${side}`] : key.startsWith('thigh') ? positions[`calf${side}`] : key.startsWith('calf') ? positions[`foot${side}`] : positions[key].clone().add(new THREE.Vector3(0, height * .1, 0));
        new THREE.Line3(positions[key], endpoint).closestPointToPoint(vertex, true, nearest);
        return { key, distance: Math.max(.015, nearest.distanceTo(vertex)) };
      }).sort((a, b) => a.distance - b.distance).slice(0, 2);
      const total = scores.reduce((sum, item) => sum + 1 / item.distance ** 4, 0);
      scores.forEach((item, j) => { indices[i * 4 + j] = JOINTS.indexOf(item.key); weights[i * 4 + j] = (1 / item.distance ** 4) / total; });
      if (sleeves.length && /^Alpha/i.test(o.name) && Math.abs(vertex.x) > height * .14) {
        const tuck = THREE.MathUtils.clamp((positions[`fore${side}`].y - vertex.y) / (height * .24), 0, 1);
        weights[i * 4] *= 1 - tuck; weights[i * 4 + 1] *= 1 - tuck;
        indices[i * 4 + 2] = bones.length + (side === 'L' ? 0 : 1); weights[i * 4 + 2] = tuck;
      }
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const mesh = new THREE.SkinnedMesh(geometry, o.material); mesh.name = o.name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    root.add(mesh); mesh.bind(skeleton); mesh.normalizeSkinWeights();
  });
  return root;
}

const smoothstep01 = (t: number) => { const c = THREE.MathUtils.clamp(t, 0, 1); return c * c * (3 - 2 * c); };
/**
 * Skin an unrigged character to the measured joints. Weights blend continuously: across the armpit–shoulder line
 * (torso ↔ arm), across the hip line (pelvis ↔ thigh) and across the midline (left ↔ right leg), so no seam tears when
 * a limb moves. Within a region the two nearest bone segments share the vertex. Head meshes follow the head; skirts and
 * other loose cloth never take arm weights and blend legs over a wider midline, panels behind the legs taking less of the
 * thigh than those in front (as the native skirt rigs do); waist-hung accessories take the pelvis and 60% of the thigh.
 */
export function rigMeasuredCharacter(source: THREE.Group, height: number, rig: MeasuredRig) {
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source, true);
  const unit = bounds.getSize(new THREE.Vector3()).y, scale = height / unit, centre = bounds.getCenter(new THREE.Vector3());
  // The frame the joints were measured in: x centred, soles on the ground, z as supplied.
  const transform = new THREE.Matrix4().makeScale(scale, scale, scale).setPosition(-centre.x * scale, -bounds.min.y * scale, 0);
  const j = rig.joints, at = ([x, y, z]: Point, side = 1) => new THREE.Vector3(side * x * height, y * height, z * height);
  const positions: Record<Joint, THREE.Vector3> = {
    hips: at(j.hips), spine: at(j.spine), head: at(j.head),
    upperL: at(j.upper), foreL: at(j.fore), handL: at(j.hand), upperR: at(j.upper, -1), foreR: at(j.fore, -1), handR: at(j.hand, -1),
    thighL: at(j.thigh), calfL: at(j.calf), footL: at(j.foot), thighR: at(j.thigh, -1), calfR: at(j.calf, -1), footR: at(j.foot, -1),
  };
  // Each bone's segment, joint → child joint (the hand runs on into the fingers, the foot to the toe tip).
  const ends: Record<Joint, THREE.Vector3> = {
    hips: positions.spine, spine: positions.head, head: positions.head.clone().setY(positions.head.y + height * .12),
    upperL: positions.foreL, foreL: positions.handL, handL: positions.handL.clone().lerp(positions.foreL, -.45),
    upperR: positions.foreR, foreR: positions.handR, handR: positions.handR.clone().lerp(positions.foreR, -.45),
    thighL: positions.calfL, calfL: positions.footL, footL: at(j.toe), thighR: positions.calfR, calfR: positions.footR, footR: at(j.toe, -1),
  };
  const parents: Record<Joint, Joint | null> = { hips: null, spine: 'hips', head: 'spine', upperL: 'spine', foreL: 'upperL', handL: 'foreL', upperR: 'spine', foreR: 'upperR', handR: 'foreR', thighL: 'hips', calfL: 'thighL', footL: 'calfL', thighR: 'hips', calfR: 'thighR', footR: 'calfR' };
  const root = new THREE.Group();
  const bones = JOINTS.map((key) => { const bone = new THREE.Bone(); bone.name = `avatar-${key}`; return bone; });
  JOINTS.forEach((key, i) => {
    const parent = parents[key]; bones[i].position.copy(positions[key]);
    if (parent) { bones[i].position.sub(positions[parent]); bones[JOINTS.indexOf(parent)].add(bones[i]); }
    else root.add(bones[i]);
  });
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const segments = JOINTS.map((key) => new THREE.Line3(positions[key], ends[key]));
  const [pitX, pitY] = rig.armpit, [topX, topY] = rig.shoulderTop, hipY = j.thigh[1];
  // Arm/torso boundary (fraction of height) at height y: up the side of the chest to the shoulder; below the armpit it
  // follows the widening waist and hips out to .16, well inside the hanging hands (A pose: x > .26).
  const armLine = (y: number) => y >= topY ? topX : y >= pitY ? THREE.MathUtils.lerp(pitX, topX, (y - pitY) / (topY - pitY)) : Math.min(.16, pitX + (pitY - y));
  const vertex = new THREE.Vector3(), nearest = new THREE.Vector3(), score = new Float64Array(JOINTS.length);
  const share = (keys: readonly Joint[], weight: number) => {
    if (weight <= 0) return;
    const near = keys.map((key) => { segments[JOINTS.indexOf(key)].closestPointToPoint(vertex, true, nearest); return { i: JOINTS.indexOf(key), d: Math.max(height * .009, nearest.distanceTo(vertex)) }; })
      .sort((a, b) => a.d - b.d).slice(0, 2);
    const total = near.reduce((sum, n) => sum + n.d ** -4, 0);
    for (const n of near) score[n.i] += weight * n.d ** -4 / total;
  };
  let index = -1, meshes = 0;
  source.traverse((o) => { if (o instanceof THREE.Mesh) meshes++; });
  // A different export would shift the mesh indices: then every mesh is treated as body (still seam-free).
  const roles = meshes === rig.meshes ? { head: new Set(rig.head), skirt: new Set(rig.skirt), hang: new Set(rig.hang) } : { head: new Set<number>(), skirt: new Set<number>(), hang: new Set<number>() };
  source.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    index++;
    const role = roles.head.has(index) ? 'head' : roles.skirt.has(index) ? 'skirt' : roles.hang.has(index) ? 'hang' : 'body';
    const geometry = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform, o.matrixWorld));
    const p = geometry.getAttribute('position'), indices = new Uint16Array(p.count * 4), weights = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      vertex.fromBufferAttribute(p, i); score.fill(0);
      const x = vertex.x / height, y = vertex.y / height, z = vertex.z / height;
      if (role === 'head') share(['head'], 1);
      else {
        const loose = role !== 'body', below = smoothstep01((hipY + .03 - y) / .06);
        const leg = role === 'hang' ? below * .6 : role === 'skirt' ? below * THREE.MathUtils.lerp(.35, 1, smoothstep01((z - j.thigh[2]) / .06 + .5)) : below;
        const arm = loose ? 0 : smoothstep01((Math.abs(x) - armLine(y)) / .02 + .5) * (1 - leg);
        const left = smoothstep01(x / (loose ? .12 : .03) + .5), side = x >= 0 ? 'L' : 'R';
        share(['hips', 'spine', 'head'], 1 - arm - leg);
        share([`upper${side}`, `fore${side}`, `hand${side}`], arm);
        share(role === 'hang' ? ['thighL'] : ['thighL', 'calfL', 'footL'], leg * left);
        share(role === 'hang' ? ['thighR'] : ['thighR', 'calfR', 'footR'], leg * (1 - left));
      }
      const top = [...score.keys()].sort((a, b) => score[b] - score[a]).slice(0, 4);
      const total = top.reduce((sum, k) => sum + score[k], 0);
      top.forEach((k, slot) => { indices[i * 4 + slot] = k; weights[i * 4 + slot] = score[k] / total; });
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const mesh = new THREE.SkinnedMesh(geometry, o.material); mesh.name = o.name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.userData.role = role;
    root.add(mesh); mesh.bind(skeleton); mesh.normalizeSkinWeights();
  });
  return root;
}

/** Find a supplied bone by its exported name, with or without Sketchfab's numeric suffix ("Bip001Pelvis_06", "Left_knee_0217"). */
function findBone(root: THREE.Object3D, base: string) {
  const pattern = new RegExp(`^${base}(_\\d+)?$`);
  let found: THREE.Bone | undefined;
  root.traverse((o) => { if (!found && o instanceof THREE.Bone && pattern.test(o.name)) found = o; });
  return found;
}
/**
 * Natively rigged characters keep their skeleton and skin. Kuro rigs also carry auxiliary deform bones on the hip and
 * shoulder joints (Leg_*_M/F/B, Shoulder_*_M/F/B): siblings of the thigh/upper arm that the game drives from that limb.
 * They are recorded here and follow the limb at runtime, otherwise the hips and shoulders tear when the limb moves.
 */
function prepareNative(source: THREE.Group, height: number, rig: NativeRig) {
  const model = new THREE.Group(); model.add(source);
  source.updateMatrixWorld(true);
  const names = {} as Record<Joint, string>;
  for (const key of JOINTS) {
    const bone = findBone(source, NATIVE_RIGS[rig][key]);
    if (!bone) throw new Error(`Character skeleton has no ${NATIVE_RIGS[rig][key]}`);
    names[key] = bone.name;
  }
  const bounds = new THREE.Box3().setFromObject(source, true); const scale = height / bounds.getSize(new THREE.Vector3()).y;
  const hip = source.getObjectByName(names.hips)!.getWorldPosition(new THREE.Vector3());
  source.scale.multiplyScalar(scale); source.position.set(-hip.x * scale, -bounds.min.y * scale, -hip.z * scale);
  source.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  source.updateMatrixWorld(true);
  const helpers: { name: string; limb: Joint }[] = [], joint = new THREE.Vector3(), other = new THREE.Vector3();
  for (const limb of ['thighL', 'thighR', 'upperL', 'upperR'] as const) {
    const bone = source.getObjectByName(names[limb])!; bone.getWorldPosition(joint);
    for (const sibling of bone.parent!.children) {
      if (sibling !== bone && sibling instanceof THREE.Bone && sibling.getWorldPosition(other).distanceTo(joint) < height * .01) helpers.push({ name: sibling.name, limb });
    }
  }
  model.userData.joints = names; model.userData.helpers = helpers; model.userData.chains = looseChains(source, names, helpers, height);
  return model;
}
/** A loose bone chain hung off the body, as found in the bind pose (names, so it survives cloning). */
interface ChainDef {
  root: string; end: string; kind: 'skirt' | 'dangle' | 'tail'; gravity: number;
  /** Rest direction root → end, avatar space. */
  dir: [number, number, number];
  /**
   * Bones near hip level that drape over the thighs: share of the thigh's turn, left/right mix (1 = left thigh) and how
   * far the cloth hangs below the hinge (m).
   */
  hinges: { name: string; weight: number; left: number; drop: number }[];
  /** Tail: the main path from root to tip. */
  joints: string[];
}
/**
 * Find the loose secondary chains on the torso and upper arms — skirt panels, coats, capes, sashes, ribbons, sleeves and
 * tails — that the game would otherwise animate with cloth physics. Hair stays on the head, fingers and toes on theirs.
 * - skirt: hangs from the waist to about the hips; drapes over the thighs (front panels most, back panels barely).
 * - dangle: long (> 17% of height) and hanging; keeps hanging when the body leans, and drapes over the thighs below the hips.
 * - tail: named so, on the pelvis/spine; posed per character.
 */
function looseChains(source: THREE.Object3D, names: Record<Joint, string>, helpers: { name: string }[], height: number): ChainDef[] {
  const owner = new Map<THREE.Object3D, Joint>(JOINTS.map((key) => [source.getObjectByName(names[key])!, key]));
  const path = new Set<THREE.Object3D>(), helperNames = new Set(helpers.map((h) => h.name));
  for (const bone of owner.keys()) for (let o: THREE.Object3D | null = bone; o instanceof THREE.Bone; o = o.parent) path.add(o);
  const ownerOf = (o: THREE.Object3D | null) => { for (; o; o = o.parent) { const key = owner.get(o); if (key) return key; } return null; };
  const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const pelvis = at(source.getObjectByName(names.hips)!), hipY = (at(source.getObjectByName(names.thighL)!).y + at(source.getObjectByName(names.thighR)!).y) / 2;
  const hinge = (bone: THREE.Object3D) => {
    const p = at(bone), dx = p.x - pelvis.x, dz = p.z - pelvis.z;
    let low = p.y; bone.traverse((c) => { if (c instanceof THREE.Bone) low = Math.min(low, at(c).y); });
    return { name: bone.name, weight: .1 + .65 * (1 + Math.cos(Math.atan2(dx, dz))) / 2, left: smoothstep01(dx / (height * .08) + .5), drop: p.y - low };
  };
  const chains: ChainDef[] = [];
  source.traverse((o) => {
    if (!(o instanceof THREE.Bone) || path.has(o) || helperNames.has(o.name) || !o.parent || !path.has(o.parent)) return;
    const key = ownerOf(o.parent), torso = key === 'hips' || key === 'spine';
    if (!torso && key !== 'upperL' && key !== 'upperR') return;
    const start = at(o); let lowest: THREE.Bone = o, low = start.y, reach = 0, count = 0;
    o.traverse((c) => {
      if (!(c instanceof THREE.Bone)) return;
      const p = at(c); count++; reach = Math.max(reach, p.distanceTo(start));
      if (p.y < low) { low = p.y; lowest = c; }
    });
    if (count < 2) return;
    const tail = torso && /tail/i.test(o.name);
    const skirt = !tail && torso && start.y < hipY + height * .15 && start.y > hipY - height * .04 && low < hipY + height * .03 && reach < height * .25;
    const dangle = !tail && !skirt && reach > height * .17 && start.y - low > reach * .45;
    if (!tail && !skirt && !dangle) return;
    const joints: string[] = [];
    if (tail) for (let b: THREE.Object3D | undefined = o; b instanceof THREE.Bone; b = b.children.find((c) => c instanceof THREE.Bone)) joints.push(b.name);
    const end = tail ? source.getObjectByName(joints[joints.length - 1])! : lowest;
    const hinges = skirt ? [hinge(o)] : [];
    // Coat panels and sashes reaching below the hips bend where they cross hip level: the first bone below it on each strand.
    const line = hipY + height * .05;
    if (dangle && torso && low < hipY + height * .02) {
      if (start.y < line) hinges.push(hinge(o));
      else o.traverse((c) => { if (c instanceof THREE.Bone && c !== o && at(c).y < line && at(c.parent!).y >= line) hinges.push(hinge(c)); });
    }
    const dir = at(end).sub(start).normalize();
    chains.push({ root: o.name, end: end.name, kind: tail ? 'tail' : skirt ? 'skirt' : 'dangle', gravity: skirt ? 0 : torso ? .8 : .6, dir: [dir.x, dir.y, dir.z], hinges, joints });
  });
  return chains;
}
/** NTE exports unlit toon materials: light them like the other characters so shading, shadows and night apply. */
function litMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const lit = (m: THREE.Material) => m instanceof THREE.MeshBasicMaterial ? new THREE.MeshStandardMaterial({ name: m.name, map: m.map, color: m.color, transparent: m.transparent,
      opacity: m.opacity, alphaTest: m.alphaTest, side: m.side, depthWrite: m.depthWrite, roughness: .85, metalness: 0 }) : m;
    o.material = Array.isArray(o.material) ? o.material.map(lit) : lit(o.material);
  });
}

export function loadCharacter(id: CharacterId, retry = false) {
  if (retry) pending.delete(id);
  const cached = pending.get(id); if (cached) return cached;
  states.set(id, loading); emit();
  const task = loadGlb(CHARACTERS[id].url, retry).then(({ scene }) => {
    const model = prepareCharacter(scene, id);
    states.set(id, { status: 'ready', model }); emit(); return model;
  }).catch((error: unknown) => { states.set(id, { status: 'error' }); emit(); throw error; });
  pending.set(id, task); return task;
}

export function prepareCharacter(source: THREE.Group, id: CharacterId) {
  const { rig, height } = CHARACTERS[id];
  litMaterials(source);
  const model = rig.kind === 'generated' ? rigStaticCharacter(source, height, rig.profile)
    : rig.kind === 'measured' ? rigMeasuredCharacter(source, height, rig.layout) : prepareNative(source, height, rig.bones);
  model.name = `avatar-${id}`; model.updateMatrixWorld(true); return model;
}

export interface Avatar {
  root: THREE.Group; bones: Partial<Record<Joint, THREE.Bone>>; rest: Map<THREE.Bone, THREE.Quaternion>; hipHeight: number; phase: number; gait: number; footDown: number;
  hipRest: THREE.Vector3; footHeight: number; orientations: Partial<Record<Joint, THREE.Quaternion>>;
  sleeves: THREE.Bone[];
  /** Walking: smoothed ground speed (m/s), current step length (m) and a clock for breathing. */
  speed: number; step: number; time: number;
  /** Rest pose in avatar space: pelvis, hip joints (L, R) and hip → ankle length. */
  legs: { pelvis: THREE.Vector3; hip: [THREE.Vector3, THREE.Vector3]; length: number };
  female: boolean;
  /** Auxiliary hip/shoulder deform bones and the share of their limb's rotation they take. */
  helpers: { bone: THREE.Bone; limb: THREE.Bone; rest: THREE.Quaternion; limbRest: THREE.Quaternion; weight: number }[];
  /** Loose cloth/tail chains (see looseChains), with hinge and thigh rest orientations in avatar space. */
  chains: { kind: ChainDef['kind']; bone: THREE.Bone; end: THREE.Object3D; rest: THREE.Quaternion; gravity: number; dir: THREE.Vector3;
    hinges: { bone: THREE.Bone; rest: THREE.Quaternion; restTurn: THREE.Quaternion; weight: number; left: number; long: number }[]; joints: { bone: THREE.Bone; rest: THREE.Quaternion }[] }[];
  thighRest: [THREE.Quaternion, THREE.Quaternion];
  tail?: TailPose;
  /** How far the character sits (0 standing … 1 seated), from the last animation frame. */
  sit: number;
}
export function createAvatar(template: THREE.Group, id: CharacterId): Avatar {
  const root = clone(template) as THREE.Group; root.updateMatrixWorld(true);
  const bones: Avatar['bones'] = {}, names = root.userData.joints as Record<Joint, string> | undefined;
  JOINTS.forEach((key) => {
    const bone = root.getObjectByName(names ? names[key] : `avatar-${key}`) as THREE.Bone | undefined;
    // Tagged so tools and tests find the hands, feet and pelvis on any skeleton naming.
    if (bone) bone.userData.joint = key;
    bones[key] = bone;
  });
  const helpers: Avatar['helpers'] = ((root.userData.helpers ?? []) as { name: string; limb: Joint }[]).flatMap(({ name, limb }) => {
    const bone = root.getObjectByName(name), limbBone = bones[limb];
    // Half the limb's rotation: the volume-keeping share a corrective joint takes between pelvis/clavicle and limb.
    return bone instanceof THREE.Bone && limbBone ? [{ bone, limb: limbBone, rest: bone.quaternion.clone(), limbRest: limbBone.quaternion.clone(), weight: .5 }] : [];
  });
  const rootInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const inAvatar = (bone: THREE.Object3D) => bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInverse);
  const named = (name: string) => { const bone = root.getObjectByName(name); return bone instanceof THREE.Bone ? bone : null; };
  const chains: Avatar['chains'] = ((root.userData.chains ?? []) as ChainDef[]).flatMap((c) => {
    const bone = named(c.root), end = root.getObjectByName(c.end);
    if (!bone || !end) return [];
    return [{ kind: c.kind, bone, end, rest: bone.quaternion.clone(), gravity: c.gravity, dir: new THREE.Vector3(...c.dir),
      hinges: c.hinges.flatMap((h) => { const b = named(h.name); return b ? [{ bone: b, rest: b.quaternion.clone(), restTurn: inAvatar(b), weight: h.weight, left: h.left, long: smoothstep01((h.drop - .15) / .2) }] : []; }),
      joints: c.joints.flatMap((name) => { const b = named(name); return b ? [{ bone: b, rest: b.quaternion.clone() }] : []; }) }];
  });
  const rest = new Map<THREE.Bone, THREE.Quaternion>(); Object.values(bones).forEach((b) => { if (b) rest.set(b, b.quaternion.clone()); });
  const sleeves = ['L', 'R'].map(side => root.getObjectByName(`avatar-fore${side}-sleeve`)).filter((o): o is THREE.Bone => o instanceof THREE.Bone);
  sleeves.forEach(bone => rest.set(bone, bone.quaternion.clone()));
  const hipHeight = bones.hips!.getWorldPosition(new THREE.Vector3()).y;
  const orientations: Avatar['orientations'] = {}, inverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const key of ['footL', 'footR', 'head'] as const) if (bones[key]) orientations[key] = bones[key]!.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverse);
  const footHeight = Math.min(...(['footL', 'footR'] as const).map(key => root.worldToLocal(bones[key]!.getWorldPosition(new THREE.Vector3())).y));
  const at = (bone: THREE.Object3D) => root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  const hip = [at(bones.thighL!), at(bones.thighR!)] as [THREE.Vector3, THREE.Vector3];
  const length = Math.min(...(['L', 'R'] as const).map((side, i) => hip[i].distanceTo(at(bones[`calf${side}`]!)) + at(bones[`calf${side}`]!).distanceTo(at(bones[`foot${side}`]!))));
  return { root, bones, rest, hipHeight, phase: 0, gait: 0, footDown: 0, hipRest: bones.hips!.position.clone(), footHeight, orientations, sleeves,
    speed: 0, step: .1, time: 0, legs: { pelvis: at(bones.hips!), hip, length }, female: CHARACTER_GENDER[id] === 'female', helpers,
    chains, thighRest: [inAvatar(bones.thighL!), inAvatar(bones.thighR!)], tail: CHARACTERS[id].tail, sit: 0 };
}
const limbTurn = new THREE.Quaternion(), restInverse = new THREE.Quaternion(), IDENTITY = new THREE.Quaternion();
/** Auxiliary deform bones take their share of the limb's turn since rest (same parent, so the delta applies as is). */
function followLimbs(avatar: Avatar) {
  for (const h of avatar.helpers) {
    limbTurn.copy(h.limb.quaternion).multiply(restInverse.copy(h.limbRest).invert());
    h.bone.quaternion.copy(IDENTITY).slerp(limbTurn, h.weight).multiply(h.rest);
    h.bone.updateWorldMatrix(false, true);
  }
}
const rootTurn = new THREE.Quaternion(), uprightQ = new THREE.Quaternion(), turn = new THREE.Quaternion(), chainQ = new THREE.Quaternion(), targetQ = new THREE.Quaternion();
const chainFrom = new THREE.Vector3(), chainTo = new THREE.Vector3(), chainAt = new THREE.Vector3(), level = new THREE.Vector3();
const thighTurnL = new THREE.Quaternion(), thighTurnR = new THREE.Quaternion();
/** Give a bone a new world orientation, keeping its parent. */
function setWorldQuaternion(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(parentQ).invert(); bone.quaternion.copy(parentQ.multiply(q)); bone.updateWorldMatrix(false, true);
}
/**
 * After the body pose (and again after limb IK): auxiliary joints follow their limbs, then the loose chains settle.
 * Every chain restarts from its rest pose, so repeated calls in one frame agree.
 * - Dangling chains turn back toward their rest direction in an upright frame (level, facing the character's way), so
 *   coats, sashes and sleeves keep hanging when the rider leans or the arms reach forward.
 * - Hinge bones (skirt panels, coat strands at the hips) take a share of their thigh's turn, so cloth drapes over the lap
 *   instead of cutting through the legs when sitting and swings with the stride when walking.
 * - Tails take the character's tail pose, blended standing → seated, with a sway in step with the walk.
 */
function updateSecondary(avatar: Avatar) {
  followLimbs(avatar);
  if (!avatar.chains.length) return;
  avatar.root.getWorldQuaternion(rootTurn);
  chainTo.set(0, 0, 1).applyQuaternion(rootTurn); uprightQ.setFromAxisAngle(Y_AXIS, Math.atan2(chainTo.x, chainTo.z));
  // Each thigh's turn since rest, in world terms (what a panel resting on it should take).
  avatar.bones.thighL!.getWorldQuaternion(thighTurnL).multiply(turn.copy(rootTurn).multiply(avatar.thighRest[0]).invert());
  avatar.bones.thighR!.getWorldQuaternion(thighTurnR).multiply(turn.copy(rootTurn).multiply(avatar.thighRest[1]).invert());
  const sit = avatar.sit;
  for (const chain of avatar.chains) {
    // Back to the rest shape first: the hanging direction is measured on it, never on last frame's draped/curled pose.
    chain.bone.quaternion.copy(chain.rest);
    for (const h of chain.hinges) h.bone.quaternion.copy(h.rest);
    for (const j of chain.joints) j.bone.quaternion.copy(j.rest);
    chain.bone.updateWorldMatrix(false, true);
    if (chain.gravity > 0) {
      chain.bone.getWorldPosition(chainFrom); chain.end.getWorldPosition(chainTo);
      chainAt.subVectors(chainTo, chainFrom).normalize(); direction.copy(chain.dir).applyQuaternion(uprightQ);
      targetQ.setFromUnitVectors(chainAt, direction); turn.slerpQuaternions(IDENTITY, targetQ, chain.gravity);
      setWorldQuaternion(chain.bone, chain.bone.getWorldQuaternion(chainQ).premultiply(turn));
    }
    // Seated, long cloth (coat tails, sashes: more than ~25 cm below the hips) rides the thigh fully and lies along the
    // seat instead of hanging through the cushion and floor; short skirt panels keep their standing share, so the back of
    // a skirt is not swung forward through the buttocks it is skinned to.
    for (const h of chain.hinges) {
      targetQ.slerpQuaternions(thighTurnR, thighTurnL, h.left).multiply(rootTurn).multiply(h.restTurn);
      setWorldQuaternion(h.bone, h.bone.getWorldQuaternion(chainQ).slerp(targetQ, THREE.MathUtils.lerp(h.weight, 1, sit * h.long)));
    }
    const tail = avatar.tail;
    if (chain.kind !== 'tail' || !tail) continue;
    level.set(1, 0, 0).applyQuaternion(uprightQ);
    const pose = (k: number) => THREE.MathUtils.lerp(tail.stand[k], tail.seated[k], sit);
    chain.joints.forEach((j, k) => {
      const pitch = k ? pose(2) : pose(0), yaw = (k ? pose(3) : pose(1)) + (k ? 0 : .14 * avatar.gait * Math.sin(2 * Math.PI * avatar.phase));
      turn.setFromAxisAngle(level, pitch).premultiply(targetQ.setFromAxisAngle(Y_AXIS, yaw));
      if (pitch || yaw) setWorldQuaternion(j.bone, j.bone.getWorldQuaternion(chainQ).premultiply(turn));
    });
  }
}
export function useCharacter(id: CharacterId | null) {
  const state = useSyncExternalStore(subscribe, () => id ? states.get(id) ?? loading : null);
  useEffect(() => { if (id) void loadCharacter(id).catch(() => {}); }, [id]);
  const avatar = useMemo(() => state?.model && id ? createAvatar(state.model, id) : null, [state, id]);
  useEffect(() => () => { avatar?.root.traverse((o) => { if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose(); }); }, [avatar]);
  return { state, avatar };
}

const from = new THREE.Vector3(), to = new THREE.Vector3(), direction = new THREE.Vector3();
const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), deltaQ = new THREE.Quaternion();
const rotationX = new THREE.Quaternion(), rotationY = new THREE.Quaternion(), X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);
function orientFoot(avatar: Avatar, key: 'footL' | 'footR' | 'head', roll: number, weight = 1) {
  const bone = avatar.bones[key], bind = avatar.orientations[key]; if (!bone || !bind || weight <= 0) return;
  rotationX.setFromAxisAngle(X_AXIS, roll);
  avatar.root.getWorldQuaternion(worldQ).multiply(rotationX).multiply(bind);
  bone.parent!.getWorldQuaternion(parentQ).invert(); parentQ.multiply(worldQ);
  if (weight < 1) bone.quaternion.slerp(parentQ, weight); else bone.quaternion.copy(parentQ);
  bone.updateWorldMatrix(false, true);
}
/** Rotate a bone about an axis of the avatar's own frame (world-space delta), e.g. pelvis yaw or thorax twist. */
function turnInAvatar(avatar: Avatar, key: Joint, axis: THREE.Vector3, angle: number) {
  const bone = avatar.bones[key]; if (!bone || !angle) return;
  avatar.root.getWorldQuaternion(worldQ); rotationY.setFromAxisAngle(axis, angle);
  deltaQ.copy(worldQ).multiply(rotationY).multiply(parentQ.copy(worldQ).invert());
  bone.getWorldQuaternion(worldQ).premultiply(deltaQ);
  bone.parent!.getWorldQuaternion(parentQ).invert(); bone.quaternion.copy(parentQ.multiply(worldQ)); bone.updateWorldMatrix(false, true);
}

/** Aim in avatar space, allowing native and generated rigs to share poses. */
function aim(avatar: Avatar, key: Joint, end: Joint, x: number, y: number, z: number) {
  direction.set(x, y, z).normalize().applyQuaternion(avatar.root.getWorldQuaternion(worldQ));
  aimWorld(avatar, key, end, direction);
}
function aimWorld(avatar: Avatar, key: Joint, end: Joint, desired: THREE.Vector3) {
  const bone = avatar.bones[key], child = avatar.bones[end]; if (!bone || !child) return;
  bone.updateWorldMatrix(true, true); bone.getWorldPosition(from); child.getWorldPosition(to);
  deltaQ.setFromUnitVectors(to.sub(from).normalize(), desired);
  bone.getWorldQuaternion(worldQ).premultiply(deltaQ);
  bone.parent!.getWorldQuaternion(parentQ).invert(); bone.quaternion.copy(parentQ.multiply(worldQ)); bone.updateWorldMatrix(false, true);
}
const ankles = [new THREE.Vector3(), new THREE.Vector3()], footPitch = [0, 0], legTarget = new THREE.Vector3(), legPole = new THREE.Vector3(), pelvisPoint = new THREE.Vector3();
const LEG_KEYS = ['thighL', 'calfL', 'footL', 'thighR', 'calfR', 'footR'] as const;
const seatedLegs = LEG_KEYS.map(() => new THREE.Quaternion()), legRootQ = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
export function animateAvatar(avatar: Avatar, dt: number, moved: number, sit: number, reach = 0, crouch = 0, wave = false, driver = false, pose: SeatPose = 'car', dynamics?: SeatDynamics) {
  avatar.rest.forEach((q, bone) => bone.quaternion.copy(q));
  avatar.bones.hips!.position.copy(avatar.hipRest);
  avatar.time += dt;
  // Locomotion: speed from the distance actually covered (in avatar units); steps lengthen with speed
  // (short steps when shuffling, ~0.7 m at a brisk 1.3 m/s) and the phase advances with distance.
  const units = Math.min(.25, moved) / (avatar.root.scale.y || 1), legs = avatar.legs, female = avatar.female;
  avatar.speed += ((dt > 0 ? Math.min(4, units / dt) : 0) - avatar.speed) * (1 - Math.exp(-dt * 6));
  avatar.step += (THREE.MathUtils.clamp(.08 + .45 * avatar.speed, .08, .9) * legs.length / .8 - avatar.step) * (1 - Math.exp(-dt * 5));
  avatar.phase = (avatar.phase + units / (2 * avatar.step)) % 1;
  const stand = 1 - smooth(sit / .3), w = smooth(avatar.speed / .8) * stand;
  avatar.gait = w;
  const bend = Math.min(1, sit + crouch * .6);
  const bike = pose === 'bike' || pose === 'pillion';
  avatar.footDown += ((pose === 'bike' && dynamics && Math.abs(dynamics.speed) < .6 ? 1 : 0) - avatar.footDown) * Math.min(1, dt * 4);
  const control = dynamics?.control;
  // Gait targets: each foot's ankle and pitch; the pelvis sways over the stance foot, rotates with the swing
  // leg, drops on the swing side, and rides as high as both legs allow (the bob of an inverted pendulum).
  const toStance = Math.cos(2 * Math.PI * (avatar.phase - WALK.duty / 2));
  const yaw = -.075 * w * Math.cos(2 * Math.PI * avatar.phase), roll = (female ? .07 : .045) * w * toStance, pelvisX = (female ? .03 : .022) * w * toStance;
  let drop = 0;
  if (stand > 0) {
    for (const i of [0, 1]) {
      footPitch[i] = footAt((avatar.phase + i * .5) % 1, avatar.step, w, avatar.footHeight, ankles[i]);
      ankles[i].x = legs.hip[i].x * (female ? .74 : .9);
      const hip = legs.hip[i], limb = legs.length * .985, dx = ankles[i].x - hip.x - pelvisX, dz = ankles[i].z - hip.z;
      drop = Math.min(drop, ankles[i].y + Math.sqrt(Math.max(0, limb * limb - dx * dx - dz * dz)) - hip.y);
    }
    // Knees stay soft through mid-stance (flattening the bob); ducking into a car bends them; standing, a slow breath.
    drop = Math.min(drop, -.01 - .025 * w) - crouch * .2 + Math.sin(avatar.time * 1.7) * .004 * (1 - w);
    const hips = avatar.bones.hips!;
    pelvisPoint.copy(legs.pelvis).add(legTarget.set(pelvisX, drop, 0).multiplyScalar(stand));
    avatar.root.localToWorld(pelvisPoint); hips.position.copy(hips.parent!.worldToLocal(pelvisPoint));
    hips.updateWorldMatrix(false, true);
    turnInAvatar(avatar, 'hips', Y_AXIS, yaw * stand); turnInAvatar(avatar, 'hips', Z_AXIS, roll * stand);
  }
  // Car occupants recline with the seat back (the driver leans in only as far as the wheel needs: extraLean).
  const lean = crouch * .65 + (pose === 'pillion' ? .28 : bike ? .42 : pose === 'car' ? -.3 : .1) * sit + (dynamics ? THREE.MathUtils.clamp(-dynamics.longAccel * .022, -.12, .14) : 0)
    + (control ? control.drive * (bike ? .07 : .04) * sit : 0) + (dynamics?.extraLean ?? 0) * sit + (.05 * w + Math.sin(avatar.time * 1.7) * .012 * (1 - w)) * stand;
  // Riders fold from the hips: pitch the pelvis forward too, otherwise only the chest leans and the
  // shoulders stay too high for low clip-on bars (leg IK re-plants the feet afterwards).
  const fold = bike ? THREE.MathUtils.clamp((dynamics?.extraLean ?? 0) * .4, -.1, .6) * sit : 0;
  if (fold) turnInAvatar(avatar, 'hips', X_AXIS, fold);
  // +X is the character's left: lean the upper body into the steering direction (walking: over the stance foot).
  aim(avatar, 'spine', 'head', .02 * w * toStance + (dynamics && !bike ? THREE.MathUtils.clamp(-dynamics.lateralAccel * .014, -.11, .11) : 0)
    - (control ? control.steer * (bike ? .12 : .08) * sit : 0), 1, lean);
  // The thorax counter-rotates against the pelvis so the shoulders stay square.
  turnInAvatar(avatar, 'spine', Y_AXIS, -yaw * 1.6 * stand);
  // A tucked rider still looks ahead: keep the head level instead of following the folded spine; walkers too.
  if (bike && sit > .5 && lean > .5) orientFoot(avatar, 'head', Math.min(.35, (lean - .5) * .3));
  else if (pose === 'car' && sit > 0) {
    // Eyes on the road: head level, glancing into the turn.
    orientFoot(avatar, 'head', .06, sit * .9);
    turnInAvatar(avatar, 'head', Y_AXIS, -(control?.steer ?? 0) * .3 * sit);
  }
  else if (!wave) orientFoot(avatar, 'head', .05 * w, stand * .85);
  if (stand < 1) for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? 1 : -1;
    const footDown = side === 'L' && bike ? avatar.footDown * sit : 0;
    aim(avatar, `thigh${side}`, `calf${side}`, bike ? sign * sit * (.26 + footDown * .16) : 0, -(1 - bend) - .04 - (bike ? .45 * sit + footDown * .6 : 0), bend * (1 - footDown * .6));
    // In a car the feet extend into the footwell, rather than hanging vertically below the seat.
    aim(avatar, `calf${side}`, `foot${side}`, 0, -(1 - (pose === 'car' ? .58 : 0) * sit), pose === 'car' ? 1.05 * sit : -(bike ? .35 * sit * (1 - footDown) : 0));
    orientFoot(avatar, `foot${side}`, 0);
  }
  if (stand > 0) {
    if (stand < 1) LEG_KEYS.forEach((key, i) => seatedLegs[i].copy(avatar.bones[key]!.quaternion));
    avatar.root.getWorldQuaternion(legRootQ);
    for (const i of [0, 1]) {
      const side = i ? -1 : 1;
      legTarget.copy(ankles[i]); avatar.root.localToWorld(legTarget);
      reachAvatarLeg(avatar, side, legTarget, legPole.set(side * .12, 0, 1).normalize().applyQuaternion(legRootQ), footPitch[i]);
    }
    if (stand < 1) {
      LEG_KEYS.forEach((key, i) => avatar.bones[key]!.quaternion.copy(seatedLegs[i].slerp(avatar.bones[key]!.quaternion, stand)));
      avatar.bones.hips!.updateWorldMatrix(false, true);
    }
  }
  // Arms counter-swing to the legs (left arm forward with the right leg), elbows bending more on the way forward.
  const armSwing = (female ? .26 : .34) * w;
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? 1 : -1, forward = sign * Math.cos(2 * Math.PI * (avatar.phase - .5));
    const a = armSwing * forward, elbow = stand * (.16 + .1 * w + .3 * Math.max(0, forward) * w);
    const handReach = side === 'L' ? reach : 0;
    aim(avatar, `upper${side}`, `fore${side}`, sign * (.12 + handReach * .25), -Math.cos(a) + sit * .65 + handReach * .9, Math.sin(a) + sit * (driver ? .8 : .45) + handReach);
    aim(avatar, `fore${side}`, `hand${side}`, 0, -Math.cos(a + elbow) + sit * .75 + handReach, Math.sin(a + elbow) + sit * .75 + handReach + .12);
  }
  if (wave) { aim(avatar, 'upperL', 'foreL', .5, .8, .1); aim(avatar, 'foreL', 'handL', .2, 1, .1); }
  // Long hanging sleeves fold into the lap when seated, so they do not dictate the body's height.
  for (const bone of avatar.sleeves) if (sit > 0) {
    bone.getWorldQuaternion(deltaQ);
    rotationX.setFromAxisAngle(X_AXIS, -1.25);
    rotationY.setFromAxisAngle(Y_AXIS, bone.name.includes('foreL') ? -Math.PI / 2 : Math.PI / 2);
    avatar.root.getWorldQuaternion(worldQ).multiply(rotationY).multiply(rotationX);
    deltaQ.slerp(worldQ, sit);
    bone.parent!.getWorldQuaternion(parentQ).invert(); bone.quaternion.copy(parentQ.multiply(deltaQ)); bone.updateWorldMatrix(false, true);
  }
  avatar.sit = sit;
  updateSecondary(avatar);
  avatar.root.updateWorldMatrix(true, true);
}

const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), hand = new THREE.Vector3(), axis = new THREE.Vector3(), poleDirection = new THREE.Vector3(), elbowTarget = new THREE.Vector3();
/** Two-bone IK: upper → mid → end reaches target, bending toward pole (elbows, knees). */
function reachAvatarLimb(avatar: Avatar, upperKey: Joint, midKey: Joint, endKey: Joint, target: THREE.Vector3, pole: THREE.Vector3) {
  const upper = avatar.bones[upperKey], mid = avatar.bones[midKey], end = avatar.bones[endKey];
  if (!upper || !mid || !end) return;
  avatar.root.updateWorldMatrix(true, true);
  upper.getWorldPosition(shoulder); mid.getWorldPosition(elbow); end.getWorldPosition(hand);
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(hand);
  axis.subVectors(target, shoulder); const distance = axis.length(); if (distance < 1e-5) return;
  axis.divideScalar(distance);
  const d = THREE.MathUtils.clamp(distance, Math.abs(a - b) + .001, a + b - .001);
  const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  poleDirection.copy(pole).addScaledVector(axis, -pole.dot(axis));
  if (poleDirection.lengthSq() < 1e-8) poleDirection.set(1, 0, 0).addScaledVector(axis, -axis.x);
  poleDirection.normalize();
  elbowTarget.copy(shoulder).addScaledVector(axis, a * cos).addScaledVector(poleDirection, a * Math.sqrt(1 - cos * cos));
  direction.subVectors(elbowTarget, shoulder).normalize(); aimWorld(avatar, upperKey, midKey, direction);
  mid.getWorldPosition(elbow);
  direction.subVectors(target, elbow).normalize(); aimWorld(avatar, midKey, endKey, direction);
}
/** Two-bone IK keeps imported riders' hands on moving handlebars and steering grips. */
export function reachAvatarArm(avatar: Avatar, side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3) {
  const s = side === 1 ? 'L' : 'R';
  reachAvatarLimb(avatar, `upper${s}`, `fore${s}`, `hand${s}`, target, pole);
  updateSecondary(avatar);
}
/** Feet onto footpegs (or the road when stopped), knees toward pole; the foot then sits flat, toes forward. */
export function reachAvatarLeg(avatar: Avatar, side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3, toeRoll = 0) {
  const s = side === 1 ? 'L' : 'R';
  reachAvatarLimb(avatar, `thigh${s}`, `calf${s}`, `foot${s}`, target, pole);
  orientFoot(avatar, `foot${s}`, toeRoll);
  updateSecondary(avatar);
}
/** Shoulder position (world) and full arm length, for posture controllers. */
export function avatarArm(avatar: Avatar, side: 1 | -1, out: THREE.Vector3) {
  const s = side === 1 ? 'L' : 'R', upper = avatar.bones[`upper${s}`], fore = avatar.bones[`fore${s}`], wrist = avatar.bones[`hand${s}`];
  if (!upper || !fore || !wrist) return 0;
  upper.getWorldPosition(out); fore.getWorldPosition(elbow); wrist.getWorldPosition(hand);
  return out.distanceTo(elbow) + elbow.distanceTo(hand);
}
