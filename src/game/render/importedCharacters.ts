import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { loadGlb } from './glbAssets';
import type { SeatDynamics, SeatPose } from './charAnim';
import { WALK, footAt, smooth } from './gait';

export type CharacterId = 'male' | 'female' | 'lynae' | 'cartethyia';
export const CHARACTER_NAMES: Record<CharacterId, string> = { male: 'Male Rover', female: 'Female Rover', lynae: 'Lynae', cartethyia: 'Cartethyia' };
const urls = {
  male: new URL('../../../assets/optimized/characters/male-rover.glb', import.meta.url).href,
  female: new URL('../../../assets/optimized/characters/female-rover.glb', import.meta.url).href,
  lynae: new URL('../../../assets/optimized/characters/lynae_from_wuthering_waves.glb', import.meta.url).href,
  cartethyia: new URL('../../../assets/optimized/characters/cartethyia_wuthering_waves.glb', import.meta.url).href,
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
  /** Walking: smoothed ground speed (m/s), current step length (m) and a clock for breathing. */
  speed: number; step: number; time: number;
  /** Rest pose in avatar space: pelvis, hip joints (L, R) and hip → ankle length. */
  legs: { pelvis: THREE.Vector3; hip: [THREE.Vector3, THREE.Vector3]; length: number };
  female: boolean;
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
  const at = (bone: THREE.Object3D) => root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  const hip = [at(bones.thighL!), at(bones.thighR!)] as [THREE.Vector3, THREE.Vector3];
  const length = Math.min(...(['L', 'R'] as const).map((side, i) => hip[i].distanceTo(at(bones[`calf${side}`]!)) + at(bones[`calf${side}`]!).distanceTo(at(bones[`foot${side}`]!))));
  return { root, bones, rest, hipHeight, phase: 0, gait: 0, footDown: 0, hipRest: bones.hips!.position.clone(), footHeight, orientations, sleeves,
    speed: 0, step: .1, time: 0, legs: { pelvis: at(bones.hips!), hip, length }, female: id !== 'male' };
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
}
/** Feet onto footpegs (or the road when stopped), knees toward pole; the foot then sits flat, toes forward. */
export function reachAvatarLeg(avatar: Avatar, side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3, toeRoll = 0) {
  const s = side === 1 ? 'L' : 'R';
  reachAvatarLimb(avatar, `thigh${s}`, `calf${s}`, `foot${s}`, target, pole);
  orientFoot(avatar, `foot${s}`, toeRoll);
}
/** Shoulder position (world) and full arm length, for posture controllers. */
export function avatarArm(avatar: Avatar, side: 1 | -1, out: THREE.Vector3) {
  const s = side === 1 ? 'L' : 'R', upper = avatar.bones[`upper${s}`], fore = avatar.bones[`fore${s}`], wrist = avatar.bones[`hand${s}`];
  if (!upper || !fore || !wrist) return 0;
  upper.getWorldPosition(out); fore.getWorldPosition(elbow); wrist.getWorldPosition(hand);
  return out.distanceTo(elbow) + elbow.distanceTo(hand);
}
