import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { BONE, createCharacterMesh, type Look } from './characters';
import { animateLocomotion, newAnimState, poseSeated, reachArm, type SeatDynamics, type SeatPose } from './charAnim';
import { animateAvatar, avatarArm, reachAvatarArm, reachAvatarLeg, useCharacter, type CharacterId } from './importedCharacters';
import { MATERIALS } from './materials';
import { runtime } from '../core/runtime';
import { pauseManager } from '../core/pause';
import { characterBounds } from './characterBounds';

export interface Actor {
  object: THREE.Object3D;
  hipHeight: number;
  /** Bounds of the actual deformed seated mesh, relative to the actor's feet origin. */
  seatedBounds: THREE.Box3;
  animate: (dt: number, moved: number, sit: number, reach?: number, crouch?: number, wave?: boolean, dynamics?: SeatDynamics) => void;
  reachArm: (side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3, scale: number) => void;
  /** Leg IK (imported characters; the loading fallback keeps its seated pose). */
  reachLeg: (side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3, toeRoll?: number) => void;
  /** Shoulder world position into out; returns arm length (0 when unknown). */
  arm: (side: 1 | -1, out: THREE.Vector3) => number;
  /** Ankle height above the sole at scale 1 (rest pose). */
  footHeight: number;
  /** Hip joint → ankle at scale 1. */
  legLength: number;
  /** World position of a wrist/ankle after the current pose; false while the loading stand-in is shown. */
  limb: (key: 'handL' | 'handR' | 'footL' | 'footR', out: THREE.Vector3) => boolean;
}
/** One instance remains visible from the curb, through the doorway, onto the seat and back out. */
export function CharacterActor({ id, look, name, driver = false, pose = 'car', frame }: { id: CharacterId | null; look: Look; name: string; driver?: boolean; pose?: SeatPose; frame: (actor: Actor, dt: number) => void }) {
  const { avatar } = useCharacter(id);
  const fallback = useMemo(() => createCharacterMesh(look, 1, MATERIALS.world), [look]);
  const state = useMemo(() => newAnimState(7), []);
  const actor = useMemo<Actor>(() => {
    const object = avatar?.root ?? fallback.mesh;
    const animate: Actor['animate'] = avatar ? (dt, moved, sit, reach = 0, crouch = 0, wave = false, dynamics) => animateAvatar(avatar, dt, moved, sit, reach, crouch, wave, driver, pose, dynamics) : (dt, moved, sit, reach = 0, crouch = 0, wave = false, dynamics) => {
      if (sit > .45) poseSeated(fallback.rig, pose, state, dt, dynamics ?? { steer: runtime.telemetry.steerAngle, speed: 5, longAccel: runtime.telemetry.longAccel, lateralAccel: runtime.telemetry.lateralAccel, roll: 0 });
      else animateLocomotion(fallback.rig, state, dt, moved, { wave, reduced: runtime.reducedMotion });
      fallback.rig.bones[BONE.spine].rotation.x += crouch * .55;
      if (reach > 0) { fallback.rig.bones[BONE.uArmL].rotation.x = -reach * 1.25; fallback.rig.bones[BONE.fArmL].rotation.x = -reach * .65; }
    };
    const position = object.position.clone(), rotation = object.quaternion.clone(), scale = object.scale.clone();
    object.position.set(0, 0, 0); object.quaternion.identity(); object.scale.setScalar(1);
    animate(0, 0, 1);
    const seatedBounds = characterBounds(object);
    animate(0, 0, 0);
    object.position.copy(position); object.quaternion.copy(rotation); object.scale.copy(scale);
    return { object, hipHeight: avatar?.hipHeight ?? fallback.rig.P.joints[0].y, seatedBounds, animate,
      reachArm: (side, target, pole, scale) => { if (avatar) reachAvatarArm(avatar, side, target, pole); else reachArm(fallback.rig, side, target, pole, scale); },
      reachLeg: (side, target, pole, toeRoll) => { if (avatar) reachAvatarLeg(avatar, side, target, pole, toeRoll); },
      arm: (side, out) => avatar ? avatarArm(avatar, side, out) : 0,
      footHeight: avatar?.footHeight ?? .08,
      legLength: avatar?.legs.length ?? .8,
      limb: (key, out) => { const bone = avatar?.bones[key]; if (!bone) return false; bone.getWorldPosition(out); return true; },
    };
  }, [avatar, fallback, state, driver, pose]);
  actor.object.name = name; actor.object.userData.character = avatar ? id : 'original';
  useFrame((_, dt) => frame(actor, pauseManager.paused ? 0 : Math.min(dt, .1)));
  useEffect(() => () => fallback.mesh.skeleton.dispose(), [fallback]);
  return <primitive object={actor.object} dispose={null} />;
}
