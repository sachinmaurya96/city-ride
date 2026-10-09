import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { VEHICLES, type VehicleId } from '../data/vehicles';
import { buildVehicleParts, elbowPole, type VehicleModelParts } from '../render/models';
import { createCharacterMesh, PLAYER_LOOK, PLAYER_LOOK_FEMALE, type Look } from '../render/characters';
import { useGame } from '../../app/store';
import { newAnimState, poseSeated, reachArm, type SeatDynamics } from '../render/charAnim';
import { MATERIALS } from '../render/materials';
import { input } from '../input/input';
import { runtime } from '../core/runtime';
import { G_GROUND, G_TRAFFIC, PLAYER_GROUPS } from '../world/collisionGroups';
import { violations } from '../rules/violations';
import { busDoor } from '../missions/bus';
import type { VehicleSpec } from '../data/vehicles';
import { chassisCollider } from './chassis';
import { deriveHandling, type UpgradeLevels } from './handling';
import { NEUTRAL_INPUT, RaycastVehicle, type SafeRoadPose } from './vehicleController';
import { fuel } from './fuel';

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

/**
 * Live, animated driver: sits on the seat, leans with acceleration/braking/cornering, puts a foot down
 * when a two-wheeler stops, looks into turns, and keeps both hands on the steering grips via arm IK.
 */
function Driver({ parts, look, gripRefs, roll, steerAngle }: { parts: VehicleModelParts; look: Look; gripRefs: React.RefObject<(THREE.Object3D | null)[]>; roll: React.RefObject<{ roll: number }>; steerAngle: React.RefObject<number> }) {
  const seat = parts.seat!;
  const { mesh, rig } = useMemo(() => {
    const r = createCharacterMesh(look, 1, MATERIALS.world);
    r.mesh.scale.setScalar(seat.scale);
    r.mesh.position.set(seat.hip.x, seat.hip.y - r.rig.P.joints[0].y * seat.scale, seat.hip.z);
    return r;
  }, [look, seat]);
  const st = useMemo(() => newAnimState(3), []);
  const dyn = useMemo<SeatDynamics>(() => ({ steer: 0, longAccel: 0, lateralAccel: 0, speed: 0, roll: 0 }), []);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  const pole = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame((_, dt) => {
    mesh.visible = runtime.cameraMode !== 'eye';
    if (!mesh.visible) return;
    const tel = runtime.telemetry;
    const k = Math.min(1, dt * 5);
    dyn.steer += (tel.steerAngle - dyn.steer) * k;
    dyn.longAccel += (THREE.MathUtils.clamp(tel.longAccel, -8, 8) - dyn.longAccel) * k;
    dyn.lateralAccel += (THREE.MathUtils.clamp(tel.lateralAccel, -8, 8) - dyn.lateralAccel) * k;
    dyn.speed = tel.speed;
    dyn.roll = roll.current?.roll ?? 0;
    dyn.bar = parts.steer?.axis === 'y' ? (steerAngle.current ?? 0) : 0;
    poseSeated(rig, seat.pose, st, Math.min(dt, 0.1), dyn);
    mesh.updateWorldMatrix(true, true);
    const grips = gripRefs.current;
    if (!grips) return;
    mesh.parent?.getWorldQuaternion(q);
    for (const side of [1, -1] as const) {
      const g = grips[side > 0 ? 0 : 1];
      if (!g) continue;
      g.updateWorldMatrix(true, false);
      g.getWorldPosition(tgt);
      reachArm(rig, side, tgt, elbowPole(seat.pose, side, pole).applyQuaternion(q), seat.scale);
    }
  });
  useEffect(() => () => mesh.skeleton.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

export function PlayerVehicle({ vehicleId, paint, upgrades, rain, spawn, anchor, seatAnchor }: PlayerVehicleProps) {
  const spec = VEHICLES[vehicleId];
  const { world, rapier } = useRapier();
  const body = useRef<RapierRigidBody>(null);
  const vehicle = useRef<RaycastVehicle | null>(null);
  const lean = useRef<THREE.Group>(null);
  const steerRef = useRef<THREE.Group>(null);
  const gripRefs = useRef<(THREE.Object3D | null)[]>([]);
  const barAngle = useRef(0);
  const wheelRefs = useRef<(THREE.Group | null)[]>([]);
  const wheelSpinRefs = useRef<(THREE.Mesh | null)[]>([]);
  const parts = useMemo(() => buildVehicleParts(spec, paint, false, false, true), [spec, paint]);
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

  useEffect(() => () => {
    parts.body.dispose();
    parts.glass?.dispose();
    parts.steer?.geometry.dispose();
    parts.wheel.forEach((w) => w.dispose());
  }, [parts]);

  // The raycast controller is bound lazily inside the physics step so it always targets the live
  // chassis body (React StrictMode may destroy/recreate the RigidBody during mount).
  const spawnRef = useRef(spawn);
  const ensureVehicle = () => {
    const b = body.current;
    if (!b || !b.isValid()) return null;
    const cur = vehicle.current;
    if (cur && cur.body === b) return cur;
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
      runtime.pendingRecovery = null;
    }
    input.getDrive(drive);
    if (fuel.percent <= 0) {
      drive.throttle = 0;
      drive.brake = 0;
      drive.handbrake = true;
    }
    if (runtime.limiterKmh !== null && runtime.telemetry.speedKmh > runtime.limiterKmh) drive.throttle = 0;
    v.setInput(drive);
    v.beforePhysicsStep(w.timestep);
  });

  useAfterPhysicsStep((w) => {
    const v = vehicle.current;
    const b = body.current;
    if (!v || !b || v.body !== b || !b.isValid()) return;
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
    const c = v.controller;
    const steerVis = -tel.steerAngle * handling.maxSteer * (1 - (1 - handling.highSpeedSteer) * Math.min(1, Math.abs(tel.speed) / handling.topSpeed));
    let avgSusp = 0;
    for (let i = 0; i < spec.wheels.physics.length; i++) avgSusp += c.wheelSuspensionLength(i) ?? spec.suspension;
    avgSusp /= spec.wheels.physics.length;
    const connY = -spec.chassisHalfHeight * 0.6;
    spec.wheels.visual.forEach((w, i) => {
      const g = wheelRefs.current[i];
      const m = wheelSpinRefs.current[i];
      if (!g || !m) return;
      g.position.y = connY - avgSusp + restH;
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
        }}
      />
      <group ref={anchor}>
        <group position-y={-restH}>
          <group ref={lean}>
            <mesh geometry={parts.body} material={MATERIALS.world} castShadow receiveShadow />
            {parts.glass && <mesh geometry={parts.glass} material={GLASS_MAT} renderOrder={1} />}
            {parts.steer && (
              <group position={parts.steer.pivot} rotation-x={parts.steer.rake}>
                <group ref={steerRef}>
                  <mesh geometry={parts.steer.geometry} material={MATERIALS.world} castShadow />
                  {parts.steer.grips.map((g, i) => (
                    <object3D key={i} position={g} ref={(o) => void (gripRefs.current[i] = o)} />
                  ))}
                </group>
              </group>
            )}
            {parts.seat && <Driver parts={parts} look={look} gripRefs={gripRefs} roll={leanState} steerAngle={barAngle} />}
            {parts.passengerSeat && seatAnchor && <group ref={seatAnchor} position={parts.passengerSeat} />}
            {spec.kind === 'bus' && <BusDoors spec={spec} />}
          </group>
          {spec.wheels.visual.map((w, i) => (
            <group key={i} ref={(g) => void (wheelRefs.current[i] = g)} position={[w.x === 0 ? 0 : Math.sign(w.x) * (Math.abs(w.x) + 0.02), w.radius, w.z]}>
              <mesh ref={(m) => void (wheelSpinRefs.current[i] = m)} geometry={parts.wheel[i]} material={MATERIALS.world} castShadow />
            </group>
          ))}
        </group>
      </group>
    </RigidBody>
  );
}
