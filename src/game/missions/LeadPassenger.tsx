import { useMemo } from 'react';
import * as THREE from 'three';
import { useGame } from '../../app/store';
import { CharacterActor } from '../render/CharacterActor';
import { runtime } from '../core/runtime';
import { VEHICLES } from '../data/vehicles';
import { CURB_HEIGHT } from '../data/cityMap';
import { cabinLayout, seatedCharacterFit } from '../vehicles/cabin';
import { entryPosition } from '../vehicles/entry';
import { rideVisual } from './rides';
import type { Look } from '../render/characters';

export function LeadPassenger({ seat, look }: { seat: React.RefObject<THREE.Group | null>; look: Look }) {
  const choice = useGame((s) => s.save.settings.passengerCharacter);
  const seed = useGame(() => rideVisual.seed);
  const active = useGame((s) => !!s.save.mission);
  const id = (active || !!rideVisual.alightBay) && choice !== 'original' ? choice === 'mixed' ? seed % 2 ? 'lynae' : 'cartethyia' : choice : null;
  const points = useMemo(() => ({ start: new THREE.Vector3(), door: new THREE.Vector3(), seat: new THREE.Vector3(), feet: new THREE.Vector3(), previous: new THREE.Vector3(), init: false }), []);
  return <CharacterActor id={id} look={look} name="ride-passenger-lead" frame={(actor, dt) => {
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
    const phase = entryPosition(points.feet, t, points.start, points.door, points.seat, actor.hipHeight * scale, exit);
    const heightScale = THREE.MathUtils.lerp(1, scale, phase.inside);
    actor.object.scale.set(heightScale * THREE.MathUtils.lerp(1, fit?.widthScale ?? 1, phase.inside), heightScale, heightScale);
    if (v.waitingBay && v.boardProgress < 0) points.feet.copy(points.start);
    const moved = points.init ? Math.hypot(points.feet.x - points.previous.x, points.feet.z - points.previous.z) : 0;
    points.previous.copy(points.feet); points.init = true;
    actor.object.position.copy(points.feet);
    const walking = exit ? points.start : points.door;
    const heading = !exit && phase.walk >= .99 ? p.heading - Math.PI / 2 : Math.atan2(walking.x - points.feet.x, walking.z - points.feet.z);
    let angle = heading - runtime.pose.heading; while (angle > Math.PI) angle -= Math.PI * 2; while (angle < -Math.PI) angle += Math.PI * 2;
    actor.object.rotation.y = runtime.pose.heading + angle * (1 - phase.inside);
    actor.object.visible = departing < 10 && (runtime.cameraMode !== 'eye' || !onboard);
    actor.object.userData.phase = onboard ? 'seated' : exit ? 'exiting' : v.boardProgress >= 0 ? 'entering' : 'waiting';
    actor.object.userData.inside = phase.inside;
    actor.animate(dt, moved, phase.inside, phase.reach, phase.crouch, !!v.waitingBay && v.boardProgress < 0 && Math.hypot(runtime.pose.x - points.start.x, runtime.pose.z - points.start.z) < 40);
  }} />;
}
