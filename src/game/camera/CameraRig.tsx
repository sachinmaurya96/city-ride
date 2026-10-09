import { vehicleEntry } from '../vehicles/entry';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useRef } from 'react';
import * as THREE from 'three';
import { VEHICLES } from '../data/vehicles';
import { runtime } from '../core/runtime';
import { input } from '../input/input';
import { CAMERA_QUERY_GROUPS } from '../world/collisionGroups';
import { debug } from '../../app/devHooks';
import { rideVisual } from '../missions/rides';
import { fuel } from '../vehicles/fuel';

const target = new THREE.Vector3();
const desired = new THREE.Vector3();
const look = new THREE.Vector3();
const quat = new THREE.Quaternion();
const fwd = new THREE.Vector3();

function dampAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/**
 * Chase / high chase / handlebar cameras with right-side orbit drag, auto re-center,
 * building obstruction handling and frame-rate-independent damping (plan §8.5).
 */
export function CameraRig({ anchor, autoRecenter }: { anchor: React.RefObject<THREE.Group | null>; autoRecenter: boolean }) {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const state = useRef({ yaw: 0, orbitYaw: 0, orbitPitch: 0, dist: 7, init: false, lastTarget: new THREE.Vector3() });
  const ray = useRef<InstanceType<typeof rapier.Ray> | null>(null);

  const camDir = useRef(new THREE.Vector3());
  useFrame(() => {
    camera.getWorldDirection(camDir.current);
    const len = Math.hypot(camDir.current.x, camDir.current.z) || 1;
    runtime.cameraPose.x = camera.position.x;
    runtime.cameraPose.z = camera.position.z;
    runtime.cameraPose.fx = camDir.current.x / len;
    runtime.cameraPose.fz = camDir.current.z / len;
  });
  useFrame((_, rawDt) => {
    const a = anchor.current;
    if (!a) return;
    if (debug.cam) {
      camera.position.set(debug.cam.x, debug.cam.y, debug.cam.z);
      camera.lookAt(debug.cam.tx, debug.cam.ty, debug.cam.tz);
      return;
    }
    const dt = Math.min(rawDt, 0.1);
    const spec = VEHICLES[runtime.vehicleId];
    const outside = vehicleEntry.mode === 'outside';
    const s = state.current;
    a.getWorldPosition(target);
    if (outside) {
      a.localToWorld(target.copy(vehicleEntry.outside));
      target.y -= runtime.vehicle ? runtime.vehicle.spec.wheelRadius + runtime.vehicle.spec.suspension * .75 + runtime.vehicle.spec.chassisHalfHeight * .6 - .45 : 0;
    }
    const teleported = s.init && target.distanceTo(s.lastTarget) > 30;
    s.lastTarget.copy(target);
    a.getWorldQuaternion(quat);
    fwd.set(0, 0, 1).applyQuaternion(quat);
    const heading = Math.atan2(fwd.x, fwd.z);
    if (!s.init || teleported) {
      s.yaw = heading;
      s.dist = spec.camera.distance;
      s.init = true;
    }

    // Camera drag (right side / mouse). Never touches drive input.
    const drag = input.consumeCamera();
    s.orbitYaw -= drag.dx * 0.006;
    s.orbitPitch = THREE.MathUtils.clamp(s.orbitPitch + drag.dy * 0.004, -0.25, 0.7);
    const now = performance.now();
    const idle = now - input.camera.lastInteraction > 1500 && !input.camera.dragging;
    if (autoRecenter && idle && Math.abs(runtime.telemetry.speed) > 1) {
      const k = 1 - Math.exp(-dt * 1.6);
      s.orbitYaw += (0 - s.orbitYaw) * k;
      s.orbitPitch += (0 - s.orbitPitch) * k;
    }
    while (s.orbitYaw > Math.PI) s.orbitYaw -= Math.PI * 2;
    while (s.orbitYaw < -Math.PI) s.orbitYaw += Math.PI * 2;

    // Follow the vehicle heading smoothly (no 180° snap in reverse: always behind the chassis).
    s.yaw = dampAngle(s.yaw, heading, 1 - Math.exp(-dt * 5));
    const passengerMoving = rideVisual.boardProgress >= 0 || (rideVisual.alightProgress >= 0 && rideVisual.departureAt < 0);
    const showingStop = vehicleEntry.active || passengerMoving || fuel.refilling;
    const yaw = s.yaw + (showingStop && idle ? (vehicleEntry.active ? 1 : -1) : s.orbitYaw);
    const mode = showingStop || outside ? 'chase' : runtime.cameraMode;
    const persp = camera as THREE.PerspectiveCamera;

    if (mode === 'eye') {
      const ey = target.y - (spec.wheelRadius + spec.suspension * 0.75 + spec.chassisHalfHeight * 0.6) + spec.camera.eyeHeight;
      desired.set(target.x + Math.sin(heading) * spec.camera.eyeForward, ey, target.z + Math.cos(heading) * spec.camera.eyeForward);
      camera.position.copy(desired);
      const lyaw = heading + s.orbitYaw;
      look.set(desired.x + Math.sin(lyaw) * 10, ey - 0.6 - s.orbitPitch * 6, desired.z + Math.cos(lyaw) * 10);
      camera.lookAt(look);
      persp.fov = 70;
      persp.updateProjectionMatrix();
      return;
    }

    const high = mode === 'high';
    const baseDist = outside ? 4.8 : high ? spec.camera.highDistance : spec.camera.distance;
    const baseH = outside ? 2.3 : high ? spec.camera.highHeight : spec.camera.height;
    const pitchAdd = s.orbitPitch * baseDist * 0.8;
    const lookY = target.y + (high ? 0.2 : 0.9);
    look.set(target.x, lookY, target.z);
    desired.set(target.x - Math.sin(yaw) * baseDist, target.y + baseH + pitchAdd, target.z - Math.cos(yaw) * baseDist);

    // Obstruction: shorten the boom before buildings.
    let dist = baseDist;
    const dir = desired.clone().sub(look);
    const full = dir.length();
    dir.normalize();
    if (!ray.current) ray.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const r = ray.current;
    r.origin = { x: look.x, y: look.y, z: look.z };
    r.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = world.castRay(r, full, true, undefined, CAMERA_QUERY_GROUPS);
    if (hit) dist = Math.max(1.5, hit.timeOfImpact - 0.4) * (baseDist / full);
    const k = dist < s.dist ? 1 - Math.exp(-dt * 20) : 1 - Math.exp(-dt * 3);
    s.dist += (dist - s.dist) * k;
    const scale = s.dist / baseDist;
    desired.set(look.x + (desired.x - look.x) * scale, look.y + (desired.y - look.y) * scale, look.z + (desired.z - look.z) * scale);
    desired.y = Math.max(desired.y, 0.8);

    const pk = 1 - Math.exp(-dt * 10);
    if (teleported) camera.position.copy(desired);
    else camera.position.lerp(desired, pk);
    camera.lookAt(look);
    const speedFrac = Math.min(1, Math.abs(runtime.telemetry.speed) / 30);
    const fov = 60 + (runtime.reducedMotion ? 0 : speedFrac * 5);
    if (Math.abs(persp.fov - fov) > 0.05) {
      persp.fov += (fov - persp.fov) * (1 - Math.exp(-dt * 3));
      persp.updateProjectionMatrix();
    }
  });
  return null;
}
