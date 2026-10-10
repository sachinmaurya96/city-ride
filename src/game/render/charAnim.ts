import * as THREE from 'three';
import { BONE, type Rig } from './characters';
import { WALK, footAt, smooth } from './gait';

// Procedural character animation.
// - Locomotion: the shared gait (see gait.ts) places each ankle — planted through stance, rolling heel to toe,
//   lifting through the swing — and planar two-bone IK bends hip and knee to reach it; the hips ride as high as
//   both legs allow. Pelvis yaw/roll, lateral weight shift, counter-rotating shoulders, arm swing and a
//   stabilised head follow walking biomechanics, scaled by speed and blended into a breathing idle.
// - Seated: per-vehicle sitting poses with inertia (lean back on throttle, forward on braking, sway in
//   corners) and two-bone arm IK that keeps both hands on the steering wheel / handlebar grips.

const TAU = Math.PI * 2;

export interface AnimState {
  phase: number;
  /** Gait cycle 0…1 (0 = left heel strike) and current step length (m). */
  cycle: number;
  step: number;
  speed: number;
  t: number;
  seed: number;
  wave: number;
  look: number;
  lookTarget: number;
  lookTimer: number;
  footDown: number;
}

export function newAnimState(seed = Math.random() * 1000): AnimState {
  return { phase: seed % TAU, cycle: (seed * .37) % 1, step: .1, speed: 0, t: seed, seed, wave: 0, look: 0, lookTarget: 0, lookTimer: 2, footDown: 0 };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const legTarget = [new THREE.Vector3(), new THREE.Vector3()], legPitch = [0, 0];

/**
 * Walk / idle. `moved` = metres travelled since last frame along the facing direction.
 * `wave` raises the right arm to hail a vehicle.
 */
export function animateLocomotion(rig: Rig, st: AnimState, dt: number, moved: number, opts: { wave?: boolean; reduced?: boolean; hurry?: number } = {}) {
  const b = rig.bones;
  const P = rig.P;
  const fem = rig.gender === 'female';
  st.t += dt;
  const travel = Math.min(.25, moved);
  const inst = dt > 0 ? travel / dt : 0;
  st.speed += (inst - st.speed) * Math.min(1, dt * 6);
  const v = Math.max(0, st.speed);
  const L = P.thighLen + P.shinLen;
  // Steps lengthen with speed (short when shuffling, ~0.65 m at a brisk walk); the cycle advances with distance.
  st.step += (clamp(.08 + .45 * v, .08, .9) * L / .8 - st.step) * (1 - Math.exp(-dt * 5));
  st.cycle = (st.cycle + travel / (2 * st.step)) % 1;
  const w = smooth(v / .8);
  st.phase = st.cycle * TAU;
  const ph = st.phase;

  // look-around while idle
  st.lookTimer -= dt;
  if (st.lookTimer <= 0) {
    st.lookTimer = 2 + ((st.seed * 7.13 + st.t) % 4);
    st.lookTarget = w > 0.3 ? 0 : Math.sin(st.t * 1.7 + st.seed) * 0.6;
  }
  st.look += (st.lookTarget - st.look) * Math.min(1, dt * 2.5);

  // Pelvis: sways over the stance foot, rotates with the swing leg, drops on the swing side.
  const toStance = Math.cos(TAU * (st.cycle - WALK.duty / 2));
  const sway = (fem ? 0.028 : 0.018) * w * toStance;
  const roll = (fem ? 0.075 : 0.045) * w * toStance;
  const yaw = -0.075 * w * Math.cos(ph);
  const idleW = 1 - w;
  const breathe = Math.sin(st.t * 1.7);
  // Legs: ankle targets relative to each hip joint (sagittal plane), then planar two-bone IK.
  const hipJoint = P.joints[BONE.thighL].y, a = P.thighLen, bl = P.shinLen;
  let drop = 0;
  for (let i = 0; i < 2; i++) {
    legPitch[i] = footAt((st.cycle + i * .5) % 1, st.step, w, P.ankleH, legTarget[i]);
    const reach = L * .985;
    drop = Math.min(drop, legTarget[i].y + Math.sqrt(Math.max(0, reach * reach - legTarget[i].z * legTarget[i].z)) - hipJoint);
  }
  drop = Math.min(drop, -0.01 - 0.025 * w) + idleW * 0.004 * breathe;
  for (const side of [1, -1] as const) {
    const i = side > 0 ? 0 : 1, target = legTarget[i];
    const dz = target.z, dy = target.y - (hipJoint + drop);
    const d = clamp(Math.hypot(dz, dy), Math.abs(a - bl) + 1e-3, a + bl - 1e-3);
    const knee = Math.PI - Math.acos(clamp((a * a + bl * bl - d * d) / (2 * a * bl), -1, 1));
    const thigh = Math.atan2(dz, -dy) + Math.acos(clamp((a * a + d * d - bl * bl) / (2 * a * d), -1, 1));
    const T = side > 0 ? BONE.thighL : BONE.thighR;
    const S = side > 0 ? BONE.shinL : BONE.shinR;
    const F = side > 0 ? BONE.footL : BONE.footR;
    // Thigh forward is negative X; the knee folds back (positive); the foot stays level plus its heel/toe roll.
    // The thigh also undoes the pelvis yaw, roll and sideways sway, so a planted foot keeps its line on the ground.
    const hang = Math.max(.2, hipJoint + drop - target.y);
    b[T].rotation.set(-thigh, -yaw, side * (0.02 + (fem ? -0.012 : 0)) - roll - sway / hang);
    b[S].rotation.set(knee, 0, 0);
    b[F].rotation.set(thigh - knee + legPitch[i], 0, 0);
  }
  const hips = b[BONE.hips];
  hips.position.set(
    sway + idleW * 0.012 * Math.sin(st.t * 0.45 + st.seed),
    P.joints[0].y + drop,
    P.joints[0].z,
  );
  hips.rotation.set(0, yaw, roll + idleW * 0.025 * Math.sin(st.t * 0.45 + st.seed));

  const spine = b[BONE.spine];
  const lean = 0.035 + 0.05 * w + (opts.hurry ?? 0) * 0.08;
  spine.rotation.set(lean + idleW * 0.012 * breathe, -yaw * 1.6, -roll * 0.7);

  const head = b[BONE.head];
  head.rotation.set(-lean * 0.6 + 0.025 * w * Math.sin(2 * ph), -(yaw - yaw * 1.6) * 0.8 + st.look, -(roll * 0.3));

  // arms: counter-swing to the legs (left arm forward with the right leg), elbows bend more on the forward swing
  const armAmp = (fem ? 0.3 : 0.4) * w;
  for (const side of [1, -1] as const) {
    const U = side > 0 ? BONE.uArmL : BONE.uArmR;
    const Fa = side > 0 ? BONE.fArmL : BONE.fArmR;
    const forward = side * Math.cos(TAU * (st.cycle - .5));
    b[U].rotation.set(-armAmp * forward - 0.03, 0, side * (0.08 + idleW * 0.02 * breathe + (fem ? 0.02 : 0)));
    b[Fa].rotation.set(-(0.14 + 0.4 * Math.max(0, forward) * w + 0.15 * w), 0, 0);
  }

  // hail wave (right arm)
  st.wave += ((opts.wave ? 1 : 0) - st.wave) * Math.min(1, dt * 5);
  if (st.wave > 0.01) {
    const k = st.wave;
    const U = b[BONE.uArmR];
    const Fa = b[BONE.fArmR];
    const osc = opts.reduced ? 0 : Math.sin(st.t * 9) * 0.35;
    U.rotation.set(U.rotation.x * (1 - k) - 0.25 * k, 0, U.rotation.z * (1 - k) - 2.5 * k);
    Fa.rotation.set(Fa.rotation.x * (1 - k), 0, (-0.35 + osc) * k);
    head.rotation.y = head.rotation.y * (1 - k) - 0.15 * k;
  }
}

export type SeatPose = 'bike' | 'auto' | 'car' | 'bus' | 'pillion' | 'chair';

export interface SeatDynamics {
  steer: number;
  longAccel: number;
  lateralAccel: number;
  speed: number;
  /** Visual body roll of the vehicle (bikes), so the head stays level. */
  roll: number;
  /** Visual handlebar / steering-wheel angle (radians); the torso twists to follow handlebars. */
  bar?: number;
  /** Smoothed player controls (steer -1…1, drive = throttle − brake), so the body answers the joystick even at a standstill. */
  control?: { steer: number; drive: number };
  /** Extra forward torso lean (bike riders fold down until the bars are within reach). */
  extraLean?: number;
}

const LEGS: Record<SeatPose, { thigh: number; spread: number; knee: number; lean: number }> = {
  bike: { thigh: -1.1, spread: 0.26, knee: 1.6, lean: 0.42 },
  pillion: { thigh: -0.95, spread: 0.3, knee: 1.6, lean: 0.28 },
  auto: { thigh: -1.35, spread: 0.12, knee: 1.2, lean: 0.12 },
  car: { thigh: -1.42, spread: 0.08, knee: 1.15, lean: 0.02 },
  bus: { thigh: -1.5, spread: 0.1, knee: 1.45, lean: 0.06 },
  chair: { thigh: -1.5, spread: 0.06, knee: 1.5, lean: 0.04 },
};

/** Base sitting pose + inertia. Arms are left at a neutral reach; call `reachArm` afterwards. */
export function poseSeated(rig: Rig, pose: SeatPose, st: AnimState, dt: number, dyn?: SeatDynamics) {
  const b = rig.bones;
  const P = rig.P;
  const cfg = LEGS[pose];
  st.t += dt;
  const breathe = Math.sin(st.t * 1.6) * 0.01;
  // putting a foot down when a two-wheeler stops
  const stopped = pose === 'bike' && dyn ? Math.abs(dyn.speed) < 0.6 : false;
  st.footDown += ((stopped ? 1 : 0) - st.footDown) * Math.min(1, dt * 4);
  b[BONE.hips].position.copy(P.joints[0]);
  b[BONE.hips].rotation.set(0, 0, 0);
  for (const side of [1, -1] as const) {
    const T = side > 0 ? BONE.thighL : BONE.thighR;
    const S = side > 0 ? BONE.shinL : BONE.shinR;
    const F = side > 0 ? BONE.footL : BONE.footR;
    let thigh = cfg.thigh;
    let spread = cfg.spread;
    let knee = cfg.knee;
    if (side > 0 && st.footDown > 0.01) {
      const k = st.footDown;
      thigh = thigh * (1 - k) - 0.4 * k;
      spread = spread * (1 - k) + 0.42 * k;
      knee = knee * (1 - k) + 0.2 * k;
    }
    b[T].rotation.set(thigh, 0, side * spread);
    b[S].rotation.set(knee, 0, 0);
    b[F].rotation.set(-(thigh + knee) * 0.85, 0, 0);
  }
  let lean = cfg.lean + breathe;
  let sideLean = 0;
  let look = 0;
  if (dyn) {
    lean += clamp(-dyn.longAccel * 0.022, -0.12, 0.14) + (dyn.extraLean ?? 0) * .5;
    sideLean = pose === 'bike' || pose === 'pillion' ? 0 : clamp(dyn.lateralAccel * 0.014, -0.11, 0.11);
    look = -dyn.steer * 0.32;
    if (dyn.control) {
      const two = pose === 'bike' || pose === 'pillion';
      lean += dyn.control.drive * (two ? 0.07 : 0.04);
      sideLean += -dyn.control.steer * (two ? 0.12 : 0.08);
      look += -dyn.control.steer * 0.18;
    }
  }
  const twist = (pose === 'bike' || pose === 'auto') && dyn?.bar ? dyn.bar * 0.75 : 0;
  b[BONE.spine].rotation.set(lean, twist, sideLean);
  const roll = dyn?.roll ?? 0;
  b[BONE.head].rotation.set(-lean * 0.7 + 0.04, look - twist * 0.6, -sideLean * 0.6 - roll * 0.55);
  // neutral arms (forward, resting) — overwritten by IK when hands hold something
  for (const side of [1, -1] as const) {
    const U = side > 0 ? BONE.uArmL : BONE.uArmR;
    const Fa = side > 0 ? BONE.fArmL : BONE.fArmR;
    b[U].rotation.set(pose === 'chair' ? -0.45 : -0.55, 0, side * 0.12);
    b[Fa].rotation.set(pose === 'chair' ? -0.9 : -0.75, 0, 0);
  }
}

const vS = new THREE.Vector3();
const vT = new THREE.Vector3();
const vE = new THREE.Vector3();
const vD = new THREE.Vector3();
const vP = new THREE.Vector3();
const vTmp = new THREE.Vector3();
const qP = new THREE.Quaternion();
const restUA = new Map<string, THREE.Vector3>();
const restFA = new Map<string, THREE.Vector3>();

function restDirs(rig: Rig, side: 1 | -1) {
  const key = `${rig.gender}${side}`;
  let u = restUA.get(key);
  let f = restFA.get(key);
  if (!u || !f) {
    const J = rig.P.joints;
    const ua = side > 0 ? BONE.uArmL : BONE.uArmR;
    const fa = side > 0 ? BONE.fArmL : BONE.fArmR;
    const wr = side > 0 ? rig.P.wristL : rig.P.wristR;
    const hand = wr.clone().add(new THREE.Vector3(0, -0.045, 0.01));
    u = new THREE.Vector3().subVectors(J[fa], J[ua]).normalize();
    f = new THREE.Vector3().subVectors(hand, J[fa]).normalize();
    restUA.set(key, u);
    restFA.set(key, f);
  }
  return { u, f };
}

function lengths(rig: Rig, side: 1 | -1) {
  const J = rig.P.joints;
  const ua = side > 0 ? BONE.uArmL : BONE.uArmR;
  const fa = side > 0 ? BONE.fArmL : BONE.fArmR;
  const wr = side > 0 ? rig.P.wristL : rig.P.wristR;
  const a = J[ua].distanceTo(J[fa]);
  const bLen = vTmp.copy(wr).add(new THREE.Vector3(0, -0.045, 0.01)).distanceTo(J[fa]);
  return { a, b: bLen };
}

/**
 * Two-bone arm IK in world space: places the hand centre at `target` with the elbow bending toward
 * `pole` (world direction). The rig's ancestors must have current world matrices.
 */
export function reachArm(rig: Rig, side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3, scale = 1) {
  const ua = rig.bones[side > 0 ? BONE.uArmL : BONE.uArmR];
  const fa = rig.bones[side > 0 ? BONE.fArmL : BONE.fArmR];
  const spine = rig.bones[BONE.spine];
  spine.updateWorldMatrix(true, false);
  ua.updateWorldMatrix(false, false);
  ua.getWorldPosition(vS);
  const { a: a0, b: b0 } = lengths(rig, side);
  const a = a0 * scale;
  const bl = b0 * scale;
  vT.copy(target);
  vD.subVectors(vT, vS);
  let d = vD.length();
  if (d < 1e-5) return;
  vD.divideScalar(d);
  d = clamp(d, Math.abs(a - bl) + 1e-3, a + bl - 1e-3);
  const cosA = clamp((a * a + d * d - bl * bl) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  vP.copy(pole).addScaledVector(vD, -pole.dot(vD));
  if (vP.lengthSq() < 1e-8) vP.set(0, -1, 0);
  vP.normalize();
  vE.copy(vS).addScaledVector(vD, a * cosA).addScaledVector(vP, a * sinA);
  const { u, f } = restDirs(rig, side);
  // upper arm
  spine.getWorldQuaternion(qP).invert();
  vTmp.subVectors(vE, vS).normalize().applyQuaternion(qP);
  ua.quaternion.setFromUnitVectors(u, vTmp);
  ua.updateWorldMatrix(false, false);
  // forearm aims from the (actual) elbow at the target
  fa.updateWorldMatrix(false, false);
  fa.getWorldPosition(vE);
  ua.getWorldQuaternion(qP).invert();
  vTmp.subVectors(vT, vE).normalize().applyQuaternion(qP);
  fa.quaternion.setFromUnitVectors(f, vTmp);
  fa.updateWorldMatrix(false, false);
}

/** Vertical offset that puts the hip joint `aboveSeat` metres over a seat surface at y = 0. */
export function seatedHipLift(rig: Rig, aboveSeat = 0.1) {
  return aboveSeat - rig.P.joints[0].y;
}
