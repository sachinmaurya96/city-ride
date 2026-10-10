import { useMemo } from 'react';
import * as THREE from 'three';
import { useGame } from '../../app/store';
import { CharacterActor } from '../render/CharacterActor';
import type { Look } from '../render/characters';
import type { VehicleSpec } from '../data/vehicles';
import { runtime } from '../core/runtime';
import { cabinLayout, seatedCharacterFit } from './cabin';
import { entryPosition, vehicleEntry } from './entry';
import { elbowPole, type VehicleModelParts } from '../render/models';
import type { SeatDynamics } from '../render/charAnim';

export function CarDriver({ spec, look }: { spec: VehicleSpec; look: Look }) {
  const driver = useGame((s) => s.save.settings.driver);
  const points = useMemo(() => {
    const c = cabinLayout(spec);
    return { start: new THREE.Vector3(-c.doorX - .95, 0, c.seatZ - 1.2), door: new THREE.Vector3(-c.doorX - .55, 0, c.seatZ), seat: new THREE.Vector3(-c.seatX, c.hipY, c.seatZ), feet: new THREE.Vector3(), previous: new THREE.Vector3(), init: false };
  }, [spec]);
  return <CharacterActor id={driver} look={look} name="player-driver" driver frame={(actor, dt) => {
    const outside = vehicleEntry.mode === 'outside';
    const exit = vehicleEntry.mode === 'exiting' || outside;
    const t = vehicleEntry.active ? vehicleEntry.progress : 1;
    const fit = seatedCharacterFit(spec, actor.seatedBounds, actor.hipHeight), scale = fit.scale;
    points.seat.y = fit.hipY;
    const phase = entryPosition(points.feet, t, vehicleEntry.approach, points.door, points.seat, actor.hipHeight * scale, exit);
    if (outside) points.feet.copy(vehicleEntry.outside);
    const heightScale = THREE.MathUtils.lerp(1, scale, phase.inside);
    actor.object.scale.set(heightScale * THREE.MathUtils.lerp(1, fit.widthScale, phase.inside), heightScale, heightScale);
    const moved = points.init ? Math.hypot(points.feet.x - points.previous.x, points.feet.z - points.previous.z) : 0; points.previous.copy(points.feet); points.init = true;
    actor.object.position.copy(points.feet);
    const approach = Math.atan2(points.door.x - vehicleEntry.approach.x, points.door.z - vehicleEntry.approach.z);
    actor.object.rotation.y = outside ? vehicleEntry.outsideHeading : (exit ? -Math.PI / 2 : phase.walk >= .99 ? Math.PI / 2 : approach) * (1 - phase.inside);
    actor.object.visible = runtime.cameraMode !== 'eye' || vehicleEntry.active || outside;
    actor.object.userData.entryProgress = t;
    actor.object.userData.mode = vehicleEntry.mode;
    actor.object.userData.seatScale = scale;
    actor.animate(dt, moved, phase.inside, phase.reach, phase.crouch);
  }} />;
}

export function ImportedRider({ parts, look, gripRefs, roll, steerAngle }: { parts: VehicleModelParts; look: Look; gripRefs: React.RefObject<(THREE.Object3D | null)[]>; roll: React.RefObject<{ roll: number }>; steerAngle: React.RefObject<number> }) {
  const driver = useGame((s) => s.save.settings.driver);
  const { hip, scale, pose } = parts.seat!;
  const dyn = useMemo<SeatDynamics>(() => ({ steer: 0, longAccel: 0, lateralAccel: 0, speed: 0, roll: 0 }), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const pole = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Quaternion(), []);
  return <CharacterActor id={driver} look={look} name="player-driver" driver pose={pose} frame={(actor, dt) => {
    actor.object.scale.setScalar(scale); actor.object.position.set(hip.x, hip.y - actor.hipHeight * scale, hip.z);
    actor.object.visible = runtime.cameraMode !== 'eye';
    if (!actor.object.visible) return;
    const tel = runtime.telemetry, k = Math.min(1, dt * 5);
    dyn.steer += (tel.steerAngle - dyn.steer) * k;
    dyn.longAccel += (THREE.MathUtils.clamp(tel.longAccel, -8, 8) - dyn.longAccel) * k;
    dyn.lateralAccel += (THREE.MathUtils.clamp(tel.lateralAccel, -8, 8) - dyn.lateralAccel) * k;
    dyn.speed = tel.speed; dyn.roll = roll.current.roll;
    dyn.bar = parts.steer?.axis === 'y' ? steerAngle.current : 0;
    actor.animate(dt, 0, 1, 0, 0, false, dyn);
    actor.object.updateWorldMatrix(true, true);
    actor.object.parent?.getWorldQuaternion(rotation);
    for (const side of [1, -1] as const) {
      const grip = gripRefs.current[side > 0 ? 0 : 1]; if (!grip) continue;
      grip.updateWorldMatrix(true, false); grip.getWorldPosition(target);
      actor.reachArm(side, target, elbowPole(pose, side, pole).applyQuaternion(rotation), scale);
    }
  }} />;
}
