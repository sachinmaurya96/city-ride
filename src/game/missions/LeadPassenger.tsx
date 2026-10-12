import { useMemo } from 'react';
import * as THREE from 'three';
import { useGame } from '../../app/store';
import { CharacterActor } from '../render/CharacterActor';
import { runtime } from '../core/runtime';
import { VEHICLES, type VehicleKind } from '../data/vehicles';
import { CURB_HEIGHT } from '../data/cityMap';
import { cabinLayout, seatedCharacterFit } from '../vehicles/cabin';
import { entryPosition, lerpAngle, turnToward } from '../vehicles/entry';
import { plantFeet } from '../vehicles/driverPose';
import { driverCabin } from '../data/importedCatalog';
import { rideVisual } from './rides';
import { genderForName, type Look } from '../render/characters';
import { mulberry32 } from '../core/rng';
import type { CharacterId } from '../render/importedCharacters';

// 'Mixed' rotates through every model (matching the name's gender) and never repeats the previous rider.
const MIXED: Record<'male' | 'female', CharacterId[]> = { male: ['male'], female: ['female', 'lynae', 'cartethyia'] };
let lastMixed: { seed: number; id: CharacterId } | null = null;
function mixedCharacter(seed: number, name: string): CharacterId {
  if (lastMixed?.seed === seed) return lastMixed.id;
  const pool = MIXED[genderForName(name, mulberry32(seed || 1))];
  const options = pool.length > 1 ? pool.filter(id => id !== lastMixed?.id) : pool;
  lastMixed = { seed, id: options[seed % options.length] };
  return lastMixed.id;
}

export function LeadPassenger({ seat, look, vehicleKind }: { seat: React.RefObject<THREE.Group | null>; look: Look; vehicleKind: VehicleKind }) {
  const choice = useGame((s) => s.save.settings.passengerCharacter);
  const seed = useGame(() => rideVisual.seed);
  const name = useGame(() => rideVisual.passengerName);
  const active = useGame((s) => !!s.save.mission);
  const id = (active || !!rideVisual.alightBay) && choice !== 'original' ? choice === 'mixed' ? mixedCharacter(seed, name) : choice : null;
  const points = useMemo(() => ({ start: new THREE.Vector3(), door: new THREE.Vector3(), seat: new THREE.Vector3(), feet: new THREE.Vector3(), previous: new THREE.Vector3(), init: false, heading: 0, hip: new THREE.Vector3(), rotation: new THREE.Quaternion(), sim: 0 }), []);
  const pose = vehicleKind === 'bike' ? 'pillion' : 'car';
  return <CharacterActor id={id} look={look} name="ride-passenger-lead" pose={pose} frame={(actor, dt) => {
    const spec = runtime.vehicle?.spec ?? VEHICLES[runtime.vehicleId];
    const originalBike = choice === 'original' && spec.kind !== 'car';
    const v = rideVisual;
    const bay = v.waitingBay ?? v.alightBay;
    const onboard = v.onboard && v.boardProgress < 0 && v.alightProgress < 0;
    if (originalBike || (!bay && !onboard) || !seat.current) { actor.object.visible = false; points.init = false; return; }
    const p = v.stopPose ?? runtime.pose;
    const c = cabinLayout(spec);
    const doorX = spec.kind === 'car' ? c.doorX + .6 : spec.width / 2 + .6;
    const doorZ = spec.kind === 'car' ? c.seatZ : spec.kind === 'bike' ? -.2 : -.75;
    points.door.set(p.x + doorX * Math.cos(p.heading) + doorZ * Math.sin(p.heading), CURB_HEIGHT, p.z - doorX * Math.sin(p.heading) + doorZ * Math.cos(p.heading));
    seat.current.updateWorldMatrix(true, false); seat.current.getWorldPosition(points.seat);
    const departing = v.departureAt >= 0 ? Math.max(0, runtime.simTime - v.departureAt) : 0;
    const exit = v.alightProgress >= 0;
    if (bay) {
      const offset = exit ? 3 + departing * 1.2 : -(Math.min(3, v.partySize) - 1) * .45;
      points.start.set(bay.waitX + Math.sin(bay.heading) * offset, CURB_HEIGHT, bay.waitZ + Math.cos(bay.heading) * offset);
    } else points.start.copy(points.door);
    let t = onboard ? 1 : v.boardProgress >= 0 ? v.boardProgress : exit ? v.alightProgress : 0;
    if (departing > 0) t = 1;
    const fit = spec.kind === 'car' ? seatedCharacterFit(spec, actor.seatedBounds, actor.hipHeight) : null;
    const scale = fit?.scale ?? (spec.kind === 'bike' ? .82 : .88);
    if (fit) points.seat.y += fit.hipY - c.hipY;
    // Leaving, the passenger carries on walking along the curb instead of stopping at the end of the exit walk.
    const phase = entryPosition(points.feet, t, points.start, points.door, points.seat, actor.hipHeight * scale, exit, exit);
    const heightScale = THREE.MathUtils.lerp(1, scale, phase.inside);
    actor.object.scale.set(heightScale * THREE.MathUtils.lerp(1, fit?.widthScale ?? 1, phase.inside), heightScale, heightScale);
    if (v.waitingBay && v.boardProgress < 0) points.feet.copy(points.start);
    const dx = points.feet.x - points.previous.x, dz = points.feet.z - points.previous.z;
    const moved = points.init ? Math.hypot(dx, dz) : 0;
    points.previous.copy(points.feet);
    actor.object.position.copy(points.feet);
    // Face the way they walk; standing, look toward the car (or face its door to open it). Turns are eased.
    const walking = dt > 0 && moved / dt > .25 && phase.inside < .05;
    // Getting out, they turn away from the car (the curb is on its +X side) before walking off.
    const want = walking ? Math.atan2(dx, dz) : exit ? p.heading + Math.PI / 2
      : phase.walk > .5 ? p.heading - Math.PI / 2 : Math.atan2(points.door.x - points.feet.x, points.door.z - points.feet.z);
    // Turn on the game clock, like the walking itself (consistent on slow devices too).
    const turnDt = Math.min(.1, Math.max(0, runtime.simTime - points.sim)); points.sim = runtime.simTime;
    points.heading = phase.inside > .99 ? runtime.pose.heading : points.init ? turnToward(points.heading, want, turnDt) : want;
    points.init = true;
    actor.object.rotation.set(0, lerpAngle(points.heading, runtime.pose.heading, phase.inside), 0);
    // Mount onto the whole bike transform, including its pitch and cornering lean. Rotate the
    // feet-origin offset around the seat so the pelvis remains on the pillion, rather than drifting sideways.
    if (spec.kind === 'bike') {
      seat.current.getWorldQuaternion(points.rotation);
      actor.object.quaternion.slerp(points.rotation, THREE.MathUtils.smoothstep(phase.inside, .6, 1));
      const hipHeight = actor.hipHeight * scale * phase.inside;
      points.hip.set(0, hipHeight, 0).applyQuaternion(actor.object.quaternion);
      actor.object.position.y += hipHeight;
      actor.object.position.sub(points.hip);
    }
    actor.object.visible = departing < 10 && (runtime.cameraMode !== 'eye' || !onboard);
    actor.object.userData.phase = onboard ? 'seated' : exit ? 'exiting' : v.boardProgress >= 0 ? 'entering' : 'waiting';
    actor.object.userData.inside = phase.inside;
    actor.animate(dt, moved, phase.inside, phase.reach, phase.crouch, !!v.waitingBay && v.boardProgress < 0 && Math.hypot(runtime.pose.x - points.start.x, runtime.pose.z - points.start.z) < 40);
    // Seated in a measured car: feet on the footwell floor, like the driver's.
    const car = seat.current.parent, measured = spec.kind === 'car' ? driverCabin(spec.id) : null;
    if (measured && car && phase.inside > .6 && actor.object.visible) {
      actor.object.updateWorldMatrix(true, true);
      plantFeet(actor, car, points.hip.set(c.seatX, fit?.hipY ?? c.hipY, c.seatZ), measured.floor, scale, THREE.MathUtils.smoothstep(phase.inside, .6, 1));
    }
  }} />;
}
