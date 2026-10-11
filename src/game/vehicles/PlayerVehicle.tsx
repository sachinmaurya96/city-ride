import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierCollider, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { VEHICLES, type VehicleId } from '../data/vehicles';
import { buildVehicleParts } from '../render/models';
import { PLAYER_LOOK, PLAYER_LOOK_FEMALE, type Look } from '../render/characters';
import { useGame } from '../../app/store';
import { MATERIALS } from '../render/materials';
import { input } from '../input/input';
import { runtime } from '../core/runtime';
import { G_GROUND, G_TRAFFIC, G_STATIC, groups, GROUND_QUERY_GROUPS, PLAYER_GROUPS } from '../world/collisionGroups';
import { violations } from '../rules/violations';
import { busDoor } from '../missions/bus';
import type { VehicleSpec } from '../data/vehicles';
import { chassisCollider } from './chassis';
import { deriveHandling, type UpgradeLevels } from './handling';
import { NEUTRAL_INPUT, RaycastVehicle, type SafeRoadPose } from './vehicleController';
import { fuel } from './fuel';
import { useImportedModel } from '../render/useImportedModel';
import { CarDriver, ImportedRider } from './CarDriver';
import { cabinLayout, doorColliderPose, setDoorPose } from './cabin';
import { CarEffects } from './CarEffects';
import type { BikeRig } from '../render/importedVehicles';
import { advanceVehicleEntry, resetVehicleEntry, entryPhase, vehicleEntry } from './entry';
import { rideVisual } from '../missions/rides';
import { events } from '../core/events';
import { addCutDoors } from '../render/doorGeometry';
import { applyVehicleEnvironment, calibratedVehicleSpec } from '../render/importedVehicles';
import { traffic } from '../traffic/traffic';

const drive = { ...NEUTRAL_INPUT };

export interface PlayerVehicleProps {
  vehicleId: VehicleId;
  paint: string;
  upgrades: UpgradeLevels;
  rain: boolean;
  spawn: SafeRoadPose;
  /** Group whose world transform the camera and passengers follow. */
  anchor: React.RefObject<THREE.Group | null>;
  seatAnchor?: React.RefObject<THREE.Group | null>;
}

/** Curb-side (+X) bus doors that slide open while serving a stop. */
function BusDoors({ spec }: { spec: VehicleSpec }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const open = useRef(0);
  const L = spec.length;
  const bodyH = spec.height - 0.2 - 0.32 - 0.12;
  const zs = spec.id === 'bus_small' ? [L / 2 - 1.5] : [L / 2 - 1.5, -L * 0.15];
  useFrame((_, dt) => {
    open.current += ((busDoor.open ? 1 : 0) - open.current) * Math.min(1, dt * 6);
    refs.current.forEach((m, i) => {
      if (m) m.position.z = zs[Math.floor(i / 2)] + (i % 2 ? 1 : -1) * (0.28 + open.current * 0.5);
    });
  });
  return (
    <>
      {zs.flatMap((z, k) =>
        [0, 1].map((j) => (
          <mesh key={`${k}${j}`} ref={(m) => void (refs.current[k * 2 + j] = m)} position={[spec.width / 2 + 0.05, 0.32 + 0.06 + bodyH / 2, z]}>
            <boxGeometry args={[0.04, bodyH * 0.8, 0.54]} />
            <meshStandardMaterial color="#7f9fc2" roughness={0.15} metalness={0.1} transparent opacity={0.55} />
          </mesh>
        )),
      )}
    </>
  );
}

const GLASS_MAT = new THREE.MeshStandardMaterial({ color: '#a9c8e4', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false });

export function PlayerVehicle({ vehicleId, paint, upgrades, rain, spawn, anchor, seatAnchor }: PlayerVehicleProps) {
  const catalogSpec = VEHICLES[vehicleId];
  const { gl, camera } = useThree();
  const model = useImportedModel(catalogSpec);
  const spec = useMemo(() => calibratedVehicleSpec(catalogSpec, model?.model), [catalogSpec, model?.model]);
  const imported = useMemo(() => {
    if (!model?.model) return null;
    const root = model.model.clone(true);
    return {
      body: root.getObjectByName('imported-body')!,
      wheels: spec.wheels.visual.map((_, i) => ({
        steer: root.getObjectByName(`imported-wheel-${i}`) as THREE.Group,
        spin: root.getObjectByName(`imported-wheel-spin-${i}`) as THREE.Group,
      })),
    };
  }, [model, spec]);
  useEffect(() => {
    // Mounted body/wheel primitives are reparented by R3F. Apply to the intact shared template
    // so a saved car also gets reflections when loaded directly, without opening the garage.
    if (model?.model) applyVehicleEnvironment(model.model, gl);
  }, [model, gl]);
  useEffect(() => {
    if (model?.status === 'error') useGame.getState().toast(useGame.getState().t.carLoadFailed, 'warn');
  }, [model]);
  const { world, rapier } = useRapier();
  const walkerShape = useMemo(() => new rapier.Capsule(.45, .25), [rapier]);
  const body = useRef<RapierRigidBody>(null);
  const doorColliders = useRef<(RapierCollider | null)[]>([]);
  const previousDoors = useRef([0, 0]);
  const cabin = useMemo(() => cabinLayout(spec), [spec]);
  useEffect(() => {
    if (spec.kind !== 'car') return;
    const raycaster = new THREE.Raycaster();
    const inverse = new THREE.Matrix4();
    const hitPoint = new THREE.Vector3();
    const doors = [1, -1].map((side) => new THREE.Box3(
      new THREE.Vector3(side * cabin.doorX - .22, cabin.sill - RaycastVehicle.restHeight(spec), cabin.back),
      new THREE.Vector3(side * cabin.doorX + .22, cabin.roofY - RaycastVehicle.restHeight(spec), cabin.front),
    ));
    const tap = (x: number, y: number, commit: boolean) => {
      if (!anchor.current || !input.enabled) return false;
      const rect = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera);
      anchor.current.updateWorldMatrix(true, false);
      const ray = raycaster.ray.clone().applyMatrix4(inverse.copy(anchor.current.matrixWorld).invert());
      if (!doors.some((box) => ray.intersectBox(box, hitPoint))) return false;
      if (commit) input.emit('door');
      return true;
    };
    input.sceneTap = tap;
    return () => { if (input.sceneTap === tap) input.sceneTap = null; };
  }, [anchor, gl, camera, cabin, spec]);
  const doorCenter = useMemo(() => new THREE.Vector3(), []);
  const doorRotation = useMemo(() => new THREE.Quaternion(), []);
  const vehicle = useRef<RaycastVehicle | null>(null);
  const walkVelocity = useRef(new THREE.Vector2());
  const lean = useRef<THREE.Group>(null);
  const steerRef = useRef<THREE.Group>(null);
  const gripRefs = useRef<(THREE.Object3D | null)[]>([]);
  const barAngle = useRef(0);
  const wheelRefs = useRef<(THREE.Group | null)[]>([]);
  const wheelSpinRefs = useRef<(THREE.Mesh | null)[]>([]);
  const builtParts = useMemo(() => buildVehicleParts(spec, paint, false, false, true), [spec, paint]);
  // Imported bikes keep the procedural rig API, but seat, grips and pillion come from the measured model.
  const bikeRig = model?.model?.userData.bike as BikeRig | undefined;
  const parts = useMemo(() => {
    if (spec.kind !== 'bike' || !spec.importedModel || !bikeRig || !builtParts.steer) return builtParts;
    const pivot = new THREE.Vector3(0, 0, bikeRig.steerZ);
    return { ...builtParts,
      seat: { hip: bikeRig.hip.clone(), pose: 'bike' as const, scale: .96 },
      steer: { ...builtParts.steer, pivot, rake: 0, ratio: 0, grips: bikeRig.grips.map((g) => g.clone().sub(pivot)) as [THREE.Vector3, THREE.Vector3] },
      pegs: bikeRig.pegs.map((p) => p.clone()) as [THREE.Vector3, THREE.Vector3],
      passengerSeat: bikeRig.hip.clone().add(new THREE.Vector3(0, .05, -.4)) };
  }, [builtParts, bikeRig, spec]);
  const proceduralBody = useMemo(() => {
    if (spec.importedModel || spec.kind !== 'car') return null;
    const group = new THREE.Group();
    const bodyMesh = new THREE.Mesh(parts.body.clone(), MATERIALS.world); bodyMesh.castShadow = true; bodyMesh.receiveShadow = true; group.add(bodyMesh);
    if (parts.glass) group.add(new THREE.Mesh(parts.glass.clone(), GLASS_MAT));
    addCutDoors(group, spec, spec.width); return group;
  }, [spec, parts]);
  useEffect(() => () => { proceduralBody?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }, [proceduralBody]);
  const driver = useGame((s) => s.save.settings.driver);
  const look = useMemo<Look>(() => {
    const base = driver === 'female' ? PLAYER_LOOK_FEMALE : PLAYER_LOOK;
    return { ...base, helmet: spec.kind === 'bike' ? '#2fc4a8' : undefined, acc: spec.kind === 'bus' ? 'none' : base.acc };
  }, [spec.kind, driver]);
  const col = chassisCollider(spec);
  const restH = RaycastVehicle.restHeight(spec);
  const handling = useMemo(() => deriveHandling(spec, upgrades, rain), [spec, upgrades, rain]);
  const handlingRef = useRef(handling);
  handlingRef.current = handling;
  // Publish the entry lock when the model mounts, including while physics is paused in
  // the garage. A new car must never briefly appear ready before its first physics step.
  useLayoutEffect(() => resetVehicleEntry(spec.kind === 'car' && !useGame.getState().save.mission, spec), [spec]);

  useEffect(() => () => {
    builtParts.body.dispose();
    builtParts.glass?.dispose();
    builtParts.steer?.geometry.dispose();
    builtParts.wheel.forEach((w) => w.dispose());
  }, [builtParts]);

  // The raycast controller is bound lazily inside the physics step so it always targets the live
  // chassis body (React StrictMode may destroy/recreate the RigidBody during mount).
  const spawnRef = useRef(spawn);
  const ensureVehicle = () => {
    const b = body.current;
    if (!b || !b.isValid()) return null;
    const cur = vehicle.current;
    if (cur && cur.body === b && cur.spec === spec) return cur;
    if (cur) {
      try {
        cur.dispose(world);
      } catch {
        /* controller of a removed body */
      }
    }
    const v = new RaycastVehicle(rapier, b, world, spec, handlingRef.current);
    v.recoverTo(spawnRef.current);
    vehicle.current = v;
    runtime.vehicle = v;
    runtime.vehicleId = spec.id;
    resetVehicleEntry(spec.kind === 'car' && !useGame.getState().save.mission);
    return v;
  };

  useEffect(() => {
    return () => {
      const v = vehicle.current;
      vehicle.current = null;
      if (runtime.vehicle === v) runtime.vehicle = null;
      if (v) {
        try {
          v.dispose(world);
        } catch {
          /* already removed with its body */
        }
      }
    };
  }, [world, spec]);

  useEffect(() => {
    vehicle.current?.setHandling(handling);
  }, [handling]);

  useBeforePhysicsStep((w) => {
    const v = ensureVehicle();
    if (!v) return;
    if (runtime.pendingRecovery) {
      v.recoverTo(runtime.pendingRecovery);
      resetVehicleEntry(false);
      runtime.pendingRecovery = null;
    }
    advanceVehicleEntry(w.timestep);
    const passengerDoor = rideVisual.boardProgress >= 0 ? entryPhase(rideVisual.boardProgress).door : rideVisual.alightProgress >= 0 && rideVisual.departureAt < 0 ? entryPhase(rideVisual.alightProgress, true).door : 0;
    const openings = [passengerDoor, vehicleEntry.doorOpen];
    // Only cars have doors to swing, collide and sound: a passenger simply climbs on or off a bike or auto,
    // and buses use their own sliding doors (the vehicle is still held while anyone gets on or off).
    if (spec.kind === 'car') openings.forEach((open, i) => {
      const side = i === 0 ? 1 : -1;
      const door = (imported?.body ?? proceduralBody)?.getObjectByName(`vehicle-door-${side}`);
      if (door) setDoorPose(door, spec, side, open);
      const collider = doorColliders.current[i];
      if (collider?.isValid()) {
        doorColliderPose(spec, side, open, doorCenter, doorRotation); doorCenter.y -= restH;
        collider.setTranslationWrtParent(doorCenter); collider.setRotationWrtParent(doorRotation); collider.setEnabled(open > .02);
      }
      const last = previousDoors.current[i];
      if (open > .05 && last <= .05) events.emit({ type: 'CAR_DOOR', side, open: true });
      if (open <= .05 && last > .05) events.emit({ type: 'CAR_DOOR', side, open: false });
      previousDoors.current[i] = open;
    });
    input.getDrive(drive);
    if (vehicleEntry.mode === 'outside') {
      // Walk in the parked car's coordinate system, with capsule sweeps against buildings/traffic.
      // A brisk walk (1.6 m/s at full stick) that speeds up and slows down over a step or two.
      const x = -drive.steer, z = drive.throttle - drive.brake;
      const length = Math.max(1, Math.hypot(x, z)), k = 1 - Math.exp(-w.timestep * 5);
      walkVelocity.current.x += (x / length * 1.6 - walkVelocity.current.x) * k;
      walkVelocity.current.y += (z / length * 1.6 - walkVelocity.current.y) * k;
      const dx = walkVelocity.current.x * w.timestep, dz = walkVelocity.current.y * w.timestep;
      const position = vehicleEntry.outside;
      const nextX = position.x + dx, nextZ = position.z + dz;
      const carClear = Math.abs(nextX) > spec.width / 2 + .3 || Math.abs(nextZ) > spec.length / 2 + .3;
      const p = v.body.translation(), q = v.body.rotation();
      const cos = 1 - 2 * q.y * q.y, sin = 2 * q.w * q.y;
      const movement = { x: cos * dx + sin * dz, y: 0, z: cos * dz - sin * dx };
      const foot = { x: p.x + cos * position.x + sin * position.z, y: position.y + p.y - restH, z: p.z + cos * position.z - sin * position.x };
      const hit = world.castShape({ ...foot, y: foot.y + .85 }, { x: 0, y: 0, z: 0, w: 1 }, movement, walkerShape, .02, 1, true, undefined, groups(0xffff, G_STATIC | G_TRAFFIC), undefined, v.body);
      const fraction = hit ? Math.max(0, hit.time_of_impact - .05) : 1;
      if (carClear) { position.x += dx * fraction; position.z += dz * fraction; }
      if (Math.hypot(x, z) > .05) vehicleEntry.outsideHeading = Math.atan2(x, z);
      const ground = world.castRay(new rapier.Ray({ x: foot.x, y: 4, z: foot.z }, { x: 0, y: -1, z: 0 }), 6, true, undefined, GROUND_QUERY_GROUPS, undefined, v.body);
      if (ground) position.y = 4 - ground.timeOfImpact - p.y + restH + .01;
    } else walkVelocity.current.set(0, 0);
    if (vehicleEntry.mode !== 'seated' || openings.some((open) => open > .01)) { drive.throttle = 0; drive.brake = 0; drive.steer = 0; drive.handbrake = true; drive.powerBrake = true; }
    if (fuel.percent <= 0) {
      drive.throttle = 0;
      drive.brake = 0;
      drive.handbrake = true;
    }
    v.setInput(drive);
    v.beforePhysicsStep(w.timestep);
  });

  useAfterPhysicsStep((w) => {
    const v = vehicle.current;
    const b = body.current;
    if (!v || !b || v.body !== b || !b.isValid()) return;
    v.afterPhysicsStep();
    const t = b.translation();
    const q = b.rotation();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const p = runtime.pose;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const moved = Math.hypot(dx, dz);
    if (moved < 5) runtime.distanceDriven += moved;
    p.x = t.x;
    p.y = t.y;
    p.z = t.z;
    p.fx = fx;
    p.fz = fz;
    p.heading = Math.atan2(fx, fz);
    v.getTelemetry(runtime.telemetry);
    runtime.step(w.timestep);
  });

  // Visual-only animation: wheel spin/steer/suspension, bike lean, body roll and pitch.
  const leanState = useRef({ roll: 0, pitch: 0 });
  useFrame((_, dt) => {
    const v = vehicle.current;
    if (!v) return;
    const tel = runtime.telemetry;
    const steerVis = -tel.steerAngle * handling.maxSteer * (1 - (1 - handling.highSpeedSteer) * Math.min(1, Math.abs(tel.speed) / Math.min(handling.topSpeed, 30)));
    const connY = -spec.chassisHalfHeight * 0.6;
    spec.wheels.visual.forEach((w, i) => {
      const suspension = v.visualWheelSuspension(i);
      if (imported) {
        const { steer, spin } = imported.wheels[i];
        if (!steer || !spin) return;
        steer.position.y = steer.userData.restY + connY - suspension + restH - spec.wheelRadius;
        // Imported bikes cannot turn their fork/bars, so the front wheel only hints at the steer angle.
        steer.rotation.y = w.steer ? steerVis * (spec.kind === 'bike' ? .3 : 1) : 0;
        spin.rotation.x = v.wheelSpinAngle(i);
        return;
      }
      const g = wheelRefs.current[i];
      const m = wheelSpinRefs.current[i];
      if (!g || !m) return;
      g.position.y = connY - suspension + restH;
      g.rotation.y = w.steer ? steerVis : 0;
      m.rotation.x = v.wheelSpinAngle(i);
    });
    const st = parts.steer;
    if (st && steerRef.current) {
      const ang = st.axis === 'y' ? steerVis * st.ratio : -steerVis * st.ratio;
      barAngle.current = ang;
      steerRef.current.rotation.set(0, st.axis === 'y' ? ang : 0, st.axis === 'z' ? ang : 0);
    }
    const ls = leanState.current;
    const k = 1 - Math.exp(-dt * 6);
    let targetRoll: number;
    if (spec.kind === 'bike') {
      const sp = Math.abs(tel.speed);
      const fade = Math.min(1, sp / 6);
      // lean into the turn (right turn → negative yaw rate → lean right = +z rotation)
      targetRoll = THREE.MathUtils.clamp(tel.steerAngle * 0.3 * fade - (tel.lateralAccel / 9.81) * 0.5 * fade, -0.31, 0.31);
      // Stopped, an imported bike rests on the rider's left foot (−roll leans toward +x, the left side).
      if (spec.importedModel && sp < .6) targetRoll = -.06;
    } else {
      // body rolls outward
      targetRoll = THREE.MathUtils.clamp((tel.lateralAccel / 9.81) * 0.06, -0.05, 0.05);
    }
    const targetPitch = THREE.MathUtils.clamp((-tel.longAccel / 9.81) * (spec.kind === 'bike' ? 0.05 : 0.04), -0.04, 0.04);
    ls.roll += (targetRoll - ls.roll) * k;
    ls.pitch += (targetPitch - ls.pitch) * k;
    if (lean.current) {
      lean.current.rotation.z = ls.roll;
      lean.current.rotation.x = ls.pitch;
    }
  });

  return (
    <RigidBody
      ref={body}
      colliders={false}
      canSleep={false}
      ccd
      enabledRotations={[false, true, false]}
      position={[spawn.x, restH + 0.2, spawn.z]}
      rotation={[0, spawn.heading, 0]}
      linearDamping={0.05}
      angularDamping={0.6}
    >
      <CuboidCollider
        args={col.halfExtents}
        position={[0, col.offsetY, 0]}
        mass={col.mass}
        friction={col.friction}
        restitution={col.restitution}
        collisionGroups={PLAYER_GROUPS}
        onCollisionEnter={(e) => {
          const membership = e.other.collider.collisionGroups() >>> 16;
          if (membership & G_GROUND) return; // curb edges are not crashes
          violations.pendingContact = { traffic: (membership & G_TRAFFIC) !== 0 };
          const data = e.other.collider.parent()?.userData as { trafficId?: number; parkedId?: number } | undefined;
          if (data?.trafficId !== undefined) traffic.impact(data.trafficId);
          if (data?.trafficId !== undefined || data?.parkedId !== undefined) vehicle.current?.onNpcImpact();
        }}
      />
      {spec.kind === 'car' && [1, -1].map((side, i) => <CuboidCollider key={side} ref={(c) => { doorColliders.current[i] = c; }} args={[.05, cabin.doorHeight / 2, cabin.doorLength / 2]} position={[side * cabin.doorX, cabin.sill + cabin.doorHeight / 2 - restH, cabin.seatZ]} mass={0} friction={.5} restitution={0} collisionGroups={PLAYER_GROUPS} />)}
      <group ref={anchor}>
        <group position-y={-restH} name={imported ? `imported-vehicle-${spec.id}` : undefined}>
          <group ref={lean}>
            {imported && <primitive object={imported.body} dispose={null} />}
            {/* Imported bikes lean as one piece, wheels included. */}
            {imported && spec.kind === 'bike' && imported.wheels.map((w, i) => <primitive key={i} object={w.steer} dispose={null} />)}
            {(!imported || spec.kind === 'bike') && (
              <>
                {imported ? null : proceduralBody ? <primitive object={proceduralBody} dispose={null} /> : <>
                  <mesh geometry={parts.body} material={MATERIALS.world} castShadow receiveShadow />
                  {parts.glass && <mesh geometry={parts.glass} material={GLASS_MAT} renderOrder={1} />}
                </>}
                {parts.steer && (
                  <group position={parts.steer.pivot} rotation-x={parts.steer.rake}>
                    <group ref={steerRef}>
                      {!imported && <mesh geometry={parts.steer.geometry} material={MATERIALS.world} castShadow />}
                      {parts.steer.grips.map((g, i) => (
                        <object3D key={i} name={`player-steering-grip-${i}`} position={g} ref={(o) => void (gripRefs.current[i] = o)} />
                      ))}
                    </group>
                  </group>
                )}
                {parts.seat && spec.kind !== 'car' && <ImportedRider parts={parts} look={look} gripRefs={gripRefs} roll={leanState} steerAngle={barAngle} />}
              </>
            )}
            {spec.kind === 'car' && <CarDriver spec={spec} look={look} steeringWheel={imported?.body.getObjectByName('steering-wheel') ?? null} />}
            {parts.passengerSeat && seatAnchor && <group ref={seatAnchor} position={spec.kind === 'car' ? [cabin.seatX, cabin.hipY, cabin.seatZ] : parts.passengerSeat} />}
            {spec.kind === 'bus' && <BusDoors spec={spec} />}
          </group>
          {spec.kind === 'car' && <CarEffects spec={spec} />}
          {imported ? spec.kind === 'bike' ? null : imported.wheels.map((w, i) => <primitive key={i} object={w.steer} dispose={null} />) : spec.wheels.visual.map((w, i) => (
            <group key={i} ref={(g) => void (wheelRefs.current[i] = g)} position={[w.x === 0 ? 0 : Math.sign(w.x) * (Math.abs(w.x) + 0.02), w.radius, w.z]}>
              <mesh ref={(m) => void (wheelSpinRefs.current[i] = m)} geometry={parts.wheel[i]} material={MATERIALS.world} castShadow />
            </group>
          ))}
        </group>
      </group>
    </RigidBody>
  );
}
