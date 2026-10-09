import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { loadGlb } from './glbAssets';
import type { SeatDynamics, SeatPose } from './charAnim';

export type CharacterId = 'male' | 'female' | 'lynae' | 'cartethyia';
export const CHARACTER_NAMES: Record<CharacterId, string> = { male: 'Male Rover', female: 'Female Rover', lynae: 'Lynae', cartethyia: 'Cartethyia' };
const urls = {
  male: new URL('../../../assets/glb-files/male-rover.glb', import.meta.url).href,
  female: new URL('../../../assets/glb-files/female-rover.glb', import.meta.url).href,
  lynae: new URL('../../../assets/glb-files/lynae_from_wuthering_waves.glb', import.meta.url).href,
  cartethyia: new URL('../../../assets/glb-files/cartethyia_wuthering_waves.glb', import.meta.url).href,
};
type CharacterState = { status: 'loading' | 'ready' | 'error'; model?: THREE.Group };
const loading: CharacterState = { status: 'loading' };
const states = new Map<CharacterId, CharacterState>();
const pending = new Map<CharacterId, Promise<THREE.Group>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

const JOINTS = ['hips', 'spine', 'head', 'upperL', 'foreL', 'handL', 'upperR', 'foreR', 'handR', 'thighL', 'calfL', 'footL', 'thighR', 'calfR', 'footR'] as const;
type Joint = typeof JOINTS[number];
const nativeNames: Record<Joint, string> = {
  hips: 'Bip001Pelvis_06', spine: 'Bip001Spine_07', head: 'Bip001Head_011',
  upperL: 'Bip001LUpperArm_0162', foreL: 'Bip001LForearm_0163', handL: 'Bip001LHand_0164',
  upperR: 'Bip001RUpperArm_0244', foreR: 'Bip001RForearm_0245', handR: 'Bip001RHand_0246',
  thighL: 'Bip001LThigh_0329', calfL: 'Bip001LCalf_0330', footL: 'Bip001LFoot_0331',
  thighR: 'Bip001RThigh_0361', calfR: 'Bip001RCalf_0362', footR: 'Bip001RFoot_0363',
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

export function loadCharacter(id: CharacterId, retry = false) {
  if (retry) pending.delete(id);
  const cached = pending.get(id); if (cached) return cached;
  states.set(id, loading); emit();
  const task = loadGlb(urls[id], retry).then(({ scene }) => {
    const model = prepareCharacter(scene, id);
    states.set(id, { status: 'ready', model }); emit(); return model;
  }).catch((error: unknown) => { states.set(id, { status: 'error' }); emit(); throw error; });
  pending.set(id, task); return task;
}

export function prepareCharacter(source: THREE.Group, id: CharacterId) {
  let model: THREE.Group;
  if (id !== 'lynae') model = rigStaticCharacter(source, 1.68, id);
  else {
    model = new THREE.Group(); model.add(source);
    const bounds = new THREE.Box3().setFromObject(source, true); const scale = 1.68 / bounds.getSize(new THREE.Vector3()).y;
    const hip = source.getObjectByName(nativeNames.hips)!.getWorldPosition(new THREE.Vector3());
    source.scale.multiplyScalar(scale); source.position.set(-hip.x * scale, -bounds.min.y * scale, -hip.z * scale);
    source.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }
  model.name = `avatar-${id}`; model.updateMatrixWorld(true); return model;
}

export interface Avatar {
  root: THREE.Group; bones: Partial<Record<Joint, THREE.Bone>>; rest: Map<THREE.Bone, THREE.Quaternion>; hipHeight: number; phase: number; gait: number; footDown: number;
  hipRest: THREE.Vector3; footHeight: number; orientations: Partial<Record<Joint, THREE.Quaternion>>;
  sleeves: THREE.Bone[];
}
export function createAvatar(template: THREE.Group, id: CharacterId): Avatar {
  const root = clone(template) as THREE.Group; root.updateMatrixWorld(true);
  const bones: Avatar['bones'] = {};
  JOINTS.forEach((key) => { bones[key] = root.getObjectByName(id === 'lynae' ? nativeNames[key] : `avatar-${key}`) as THREE.Bone | undefined; });
  const rest = new Map<THREE.Bone, THREE.Quaternion>(); Object.values(bones).forEach((b) => { if (b) rest.set(b, b.quaternion.clone()); });
  const sleeves = ['L', 'R'].map(side => root.getObjectByName(`avatar-fore${side}-sleeve`)).filter((o): o is THREE.Bone => o instanceof THREE.Bone);
  sleeves.forEach(bone => rest.set(bone, bone.quaternion.clone()));
  const hipHeight = bones.hips!.getWorldPosition(new THREE.Vector3()).y;
  const orientations: Avatar['orientations'] = {}, inverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const key of ['footL', 'footR', 'head'] as const) if (bones[key]) orientations[key] = bones[key]!.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverse);
  const footHeight = Math.min(...(['footL', 'footR'] as const).map(key => root.worldToLocal(bones[key]!.getWorldPosition(new THREE.Vector3())).y));
  return { root, bones, rest, hipHeight, phase: 0, gait: 0, footDown: 0, hipRest: bones.hips!.position.clone(), footHeight, orientations, sleeves };
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
const avatarPoint = new THREE.Vector3(), lift = new THREE.Vector3(), rotationX = new THREE.Quaternion(), rotationY = new THREE.Quaternion(), X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);
function orientFoot(avatar: Avatar, key: 'footL' | 'footR', roll: number) {
  const bone = avatar.bones[key], bind = avatar.orientations[key]; if (!bone || !bind) return;
  rotationX.setFromAxisAngle(X_AXIS, roll);
  avatar.root.getWorldQuaternion(worldQ).multiply(rotationX).multiply(bind);
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
export function animateAvatar(avatar: Avatar, dt: number, moved: number, sit: number, reach = 0, crouch = 0, wave = false, driver = false, pose: SeatPose = 'car', dynamics?: SeatDynamics) {
  avatar.rest.forEach((q, bone) => bone.quaternion.copy(q));
  avatar.bones.hips!.position.copy(avatar.hipRest);
  avatar.phase = (avatar.phase + Math.min(.25, moved) * 7) % (Math.PI * 2);
  const targetGait = Math.min(1, dt > 0 ? moved / dt / 1.4 : 0) * (1 - sit);
  avatar.gait += (targetGait - avatar.gait) * (1 - Math.exp(-dt * 12));
  const gait = avatar.gait;
  const bend = Math.min(1, sit + crouch * .6);
  const bike = pose === 'bike' || pose === 'pillion';
  avatar.footDown += ((pose === 'bike' && dynamics && Math.abs(dynamics.speed) < .6 ? 1 : 0) - avatar.footDown) * Math.min(1, dt * 4);
  const lean = crouch * .65 + (bike ? .42 : pose === 'car' ? .26 : .1) * sit + (dynamics ? THREE.MathUtils.clamp(-dynamics.longAccel * .022, -.12, .14) : 0);
  const sway = Math.sin(avatar.phase) * gait * .035;
  aim(avatar, 'spine', 'head', sway + (dynamics && !bike ? THREE.MathUtils.clamp(-dynamics.lateralAccel * .014, -.11, .11) : 0), 1, lean);
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? 1 : -1; const swing = Math.sin(avatar.phase + (sign > 0 ? 0 : Math.PI)) * gait;
    const footDown = side === 'L' && bike ? avatar.footDown * sit : 0;
    const stride = swing * .68, knee = Math.max(0, -swing) * .9;
    aim(avatar, `thigh${side}`, `calf${side}`, bike ? sign * sit * (.26 + footDown * .16) : sign * gait * .015, -Math.cos(stride) * (1 - bend) - .04 - (bike ? .45 * sit + footDown * .6 : 0), bend * (1 - footDown * .6) + Math.sin(stride) * (1 - bend));
    // In a car the feet extend into the footwell, rather than hanging vertically below the seat.
    aim(avatar, `calf${side}`, `foot${side}`, 0, -Math.cos(knee) * (1 - (pose === 'car' ? .58 : 0) * sit), (pose === 'car' ? 1.05 * sit : -(bike ? .35 * sit * (1 - footDown) : 0)) - Math.sin(knee) * (1 - sit));
    orientFoot(avatar, `foot${side}`, Math.max(0, -swing) * .16 * (1 - sit));
    const handReach = side === 'L' ? reach : 0;
    aim(avatar, `upper${side}`, `fore${side}`, sign * (.12 + handReach * .25), -1 + sit * .65 + handReach * .9, sit * (driver ? .8 : .45) + handReach - swing * .3);
    aim(avatar, `fore${side}`, `hand${side}`, 0, -1 + sit * .75 + handReach, sit * .75 + handReach + .12);
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
  if (gait > .001 && sit < 1) {
    const minFoot = Math.min(...(['footL', 'footR'] as const).map(key => avatar.root.worldToLocal(avatar.bones[key]!.getWorldPosition(avatarPoint)).y));
    lift.set(0, (avatar.footHeight - minFoot) * (1 - sit), 0).applyQuaternion(avatar.root.getWorldQuaternion(worldQ)).multiplyScalar(avatar.root.getWorldScale(avatarPoint).y);
    const hip = avatar.bones.hips!; hip.getWorldPosition(from).add(lift); hip.position.copy(hip.parent!.worldToLocal(from));
  }
  avatar.root.updateWorldMatrix(true, true);
}

const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), hand = new THREE.Vector3(), axis = new THREE.Vector3(), poleDirection = new THREE.Vector3(), elbowTarget = new THREE.Vector3();
/** Two-bone IK keeps imported riders' hands on moving handlebars and steering grips. */
export function reachAvatarArm(avatar: Avatar, side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3) {
  const suffix = side === 1 ? 'L' : 'R';
  const upper = avatar.bones[`upper${suffix}`], fore = avatar.bones[`fore${suffix}`], wrist = avatar.bones[`hand${suffix}`];
  if (!upper || !fore || !wrist) return;
  avatar.root.updateWorldMatrix(true, true);
  upper.getWorldPosition(shoulder); fore.getWorldPosition(elbow); wrist.getWorldPosition(hand);
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(hand);
  axis.subVectors(target, shoulder); const distance = axis.length(); if (distance < 1e-5) return;
  axis.divideScalar(distance);
  const d = THREE.MathUtils.clamp(distance, Math.abs(a - b) + .001, a + b - .001);
  const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  poleDirection.copy(pole).addScaledVector(axis, -pole.dot(axis));
  if (poleDirection.lengthSq() < 1e-8) poleDirection.set(1, 0, 0).addScaledVector(axis, -axis.x);
  poleDirection.normalize();
  elbowTarget.copy(shoulder).addScaledVector(axis, a * cos).addScaledVector(poleDirection, a * Math.sqrt(1 - cos * cos));
  direction.subVectors(elbowTarget, shoulder).normalize(); aimWorld(avatar, `upper${suffix}`, `fore${suffix}`, direction);
  fore.getWorldPosition(elbow);
  direction.subVectors(target, elbow).normalize(); aimWorld(avatar, `fore${suffix}`, `hand${suffix}`, direction);
}
