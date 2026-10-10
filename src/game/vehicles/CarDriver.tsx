import { useMemo } from 'react';
import * as THREE from 'three';
import { useGame } from '../../app/store';
import { CharacterActor } from '../render/CharacterActor';
import type { Look } from '../render/characters';
import type { VehicleSpec } from '../data/vehicles';
import { runtime } from '../core/runtime';
import { cabinLayout, seatedCharacterFit } from './cabin';
import { driverCabin } from '../data/importedCatalog';
import { fallbackWheelFrame, holdSteeringWheel, type DriverSeat } from './driverPose';
import { entryPosition, lerpAngle, turnToward, vehicleEntry } from './entry';
import { elbowPole, type VehicleModelParts } from '../render/models';
import type { SeatDynamics } from '../render/charAnim';
import { input } from '../input/input';
import type { DriveInput } from './vehicleController';

/** Seat dynamics from telemetry plus the live controls, smoothed per frame (shared by bike riders and car drivers). */
const controls: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false };
export function updateSeatDynamics(dyn: SeatDynamics, dt: number, roll = 0) {
  const tel = runtime.telemetry, k = Math.min(1, dt * 5), ck = Math.min(1, dt * 8);
  dyn.steer += (tel.steerAngle - dyn.steer) * k;
  dyn.longAccel += (THREE.MathUtils.clamp(tel.longAccel, -8, 8) - dyn.longAccel) * k;
  dyn.lateralAccel += (THREE.MathUtils.clamp(tel.lateralAccel, -8, 8) - dyn.lateralAccel) * k;
  dyn.speed = tel.speed; dyn.roll = roll;
  input.getDrive(controls);
  const c = dyn.control ??= { steer: 0, drive: 0 };
  c.steer += (controls.steer - c.steer) * ck;
  c.drive += (controls.throttle - controls.brake - c.drive) * ck;
}

export function CarDriver({ spec, look, steeringWheel = null }: { spec: VehicleSpec; look: Look; steeringWheel?: THREE.Object3D | null }) {
  const driver = useGame((s) => s.save.settings.driver);
  const seat = useMemo<DriverSeat>(() => {
    const c = cabinLayout(spec), hip = new THREE.Vector3(-c.seatX, c.hipY, c.seatZ);
    return { wheel: steeringWheel, radius: steeringWheel?.userData.radius ?? .17, fallback: fallbackWheelFrame(hip), hip, floor: driverCabin(spec.id)?.floor ?? c.floorY };
  }, [spec, steeringWheel]);
  const posture = useMemo(() => ({ lean: 0 }), []);
  const points = useMemo(() => {
    const c = cabinLayout(spec);
    return { start: new THREE.Vector3(-c.doorX - .95, 0, c.seatZ - 1.2), door: new THREE.Vector3(-c.doorX - .55, 0, c.seatZ), seat: new THREE.Vector3(-c.seatX, c.hipY, c.seatZ), feet: new THREE.Vector3(), previous: new THREE.Vector3(), init: false, heading: 0, sim: 0 };
  }, [spec]);
  const dyn = useMemo<SeatDynamics>(() => ({ steer: 0, longAccel: 0, lateralAccel: 0, speed: 0, roll: 0 }), []);
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
    const dx = points.feet.x - points.previous.x, dz = points.feet.z - points.previous.z;
    const moved = points.init ? Math.hypot(dx, dz) : 0; points.previous.copy(points.feet);
    actor.object.position.copy(points.feet);
    // Face the way the feet are going; standing, face the door to open it (entering) or turn out of the seat
    // (exiting); outside, follow the joystick. Turns are eased, never snapped. Seated, face forward.
    const walking = dt > 0 && moved / dt > .25;
    const want = vehicleEntry.mode === 'seated' ? 0 : outside ? vehicleEntry.outsideHeading : walking && phase.inside < .05 ? Math.atan2(dx, dz)
      : vehicleEntry.mode === 'entering' ? (phase.walk < .5 ? Math.atan2(points.door.x - vehicleEntry.approach.x, points.door.z - vehicleEntry.approach.z) : Math.PI / 2)
      : phase.inside > 0 ? -Math.PI / 2 : points.heading;
    // Turn on the game clock, like the walking itself (consistent on slow devices too).
    const turnDt = Math.min(.1, Math.max(0, runtime.simTime - points.sim)); points.sim = runtime.simTime;
    points.heading = points.init && vehicleEntry.mode !== 'seated' ? turnToward(points.heading, want, turnDt) : want;
    points.init = true;
    actor.object.rotation.y = lerpAngle(points.heading, 0, phase.inside);
    actor.object.visible = runtime.cameraMode !== 'eye' || vehicleEntry.active || outside;
    actor.object.userData.entryProgress = t;
    actor.object.userData.mode = vehicleEntry.mode;
    actor.object.userData.seatScale = scale;
    // Only a seated driver follows the controls; walking/entering keeps the plain pose.
    const seated = vehicleEntry.mode === 'seated';
    if (seated) updateSeatDynamics(dyn, dt);
    dyn.extraLean = posture.lean;
    actor.animate(dt, moved, phase.inside, phase.reach, phase.crouch, false, seated || phase.inside > .5 ? dyn : undefined);
    // Settled in the seat: hands on the steering wheel (turning with it), feet in the footwell.
    const parent = actor.object.parent;
    if (phase.inside > .6 && parent && actor.object.visible) {
      seat.hip.y = fit.hipY;
      actor.object.updateWorldMatrix(true, true);
      const reach = holdSteeringWheel(actor, parent, seat, seated ? dyn.steer : 0, scale, THREE.MathUtils.smoothstep(phase.inside, .6, 1));
      // Lean in from the seat back only as far as a relaxed reach (elbows slightly bent) needs.
      if (dt > 0) posture.lean = THREE.MathUtils.clamp(posture.lean + THREE.MathUtils.clamp((reach - .9) * 4, -1, 1) * dt * 2.5, 0, .9);
      actor.object.userData.reach = reach; actor.object.userData.lean = posture.lean;
    }
  }} />;
}

/** Model-space footpegs [left (+x), right]; when present the rider's feet ride on them (imported bikes). */
export type RiderParts = VehicleModelParts & { pegs?: [THREE.Vector3, THREE.Vector3] };

export function ImportedRider({ parts, look, gripRefs, roll, steerAngle }: { parts: RiderParts; look: Look; gripRefs: React.RefObject<(THREE.Object3D | null)[]>; roll: React.RefObject<{ roll: number }>; steerAngle: React.RefObject<number> }) {
  const driver = useGame((s) => s.save.settings.driver);
  const { hip, scale, pose } = parts.seat!;
  const dyn = useMemo<SeatDynamics>(() => ({ steer: 0, longAccel: 0, lateralAccel: 0, speed: 0, roll: 0, control: { steer: 0, drive: 0 } }), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const pole = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Quaternion(), []);
  const posture = useMemo(() => ({ lean: 0, slide: 0, footDown: 1, shoulder: new THREE.Vector3(), foot: new THREE.Vector3(), knee: new THREE.Vector3() }), []);
  return <CharacterActor id={driver} look={look} name="player-driver" driver pose={pose} frame={(actor, dt) => {
    // posture.slide: short-armed riders scoot forward against the tank once fully tucked (bikes only).
    actor.object.scale.setScalar(scale); actor.object.position.set(hip.x, hip.y - actor.hipHeight * scale, hip.z + posture.slide);
    actor.object.visible = runtime.cameraMode !== 'eye';
    if (!actor.object.visible) return;
    updateSeatDynamics(dyn, dt, roll.current.roll);
    dyn.bar = parts.steer?.axis === 'y' ? steerAngle.current : 0;
    dyn.extraLean = posture.lean;
    actor.animate(dt, 0, 1, 0, 0, false, dyn);
    actor.object.updateWorldMatrix(true, true);
    const parent = actor.object.parent;
    parent?.getWorldQuaternion(rotation);
    for (const side of [1, -1] as const) {
      const grip = gripRefs.current[side > 0 ? 0 : 1]; if (!grip) continue;
      grip.updateWorldMatrix(true, false); grip.getWorldPosition(target);
      // Fold the torso until the bars are comfortably within reach (elbows slightly bent), then hold.
      const arm = side > 0 ? actor.arm(side, posture.shoulder) : 0;
      if (arm > 0 && dt > 0) {
        const reach = posture.shoulder.distanceTo(target) / arm;
        posture.lean = THREE.MathUtils.clamp(posture.lean + THREE.MathUtils.clamp((reach - .86) * 3, -1, 1) * dt * 4, -.2, 1.6);
        if (parts.pegs) posture.slide = THREE.MathUtils.clamp(posture.slide + (posture.lean > 1.45 && reach > .93 ? 1 : reach < .8 ? -1 : 0) * dt * .2, 0, .14);
        actor.object.userData.reach = reach; actor.object.userData.lean = posture.lean;
      }
      actor.reachArm(side, target, elbowPole(pose, side, pole).applyQuaternion(rotation), scale);
    }
    if (!parts.pegs || !parent) return;
    // Feet ride on the pegs; stopped, the left foot goes down to the road beside the bike.
    posture.footDown += ((Math.abs(dyn.speed) < .6 ? 1 : 0) - posture.footDown) * Math.min(1, dt * 5);
    for (const side of [1, -1] as const) {
      // IK drives the ankle: it sits above and behind the ball of the foot, which is what rests on the peg/road.
      const peg = parts.pegs[side > 0 ? 0 : 1], ankle = actor.footHeight * scale;
      posture.foot.set(peg.x, peg.y + ankle * .8, peg.z - .06);
      if (side > 0 && posture.footDown > .01) posture.foot.lerp(posture.knee.set(peg.x + .16, ankle, hip.z + .02), posture.footDown);
      parent.localToWorld(posture.foot);
      // Knees forward and slightly out, hugging the tank.
      actor.reachLeg(side, posture.foot, pole.set(side * .25, .1, 1).normalize().applyQuaternion(rotation), side > 0 ? -.25 * posture.footDown : 0);
    }
  }} />;
}
