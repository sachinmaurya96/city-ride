import { LeadPassenger } from './LeadPassenger';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CURB_HEIGHT } from '../data/cityMap';
import { VEHICLES, type VehicleKind } from '../data/vehicles';
import { mulberry32 } from '../core/rng';
import { runtime } from '../core/runtime';
import { buildVehicleParts } from '../render/models';
import { buildCharacterGeometry, createCharacterMesh, genderForName, randomLook, setLook, type Gender, type Rig } from '../render/characters';
import { animateLocomotion, newAnimState, poseSeated, type AnimState } from '../render/charAnim';
import { useGame } from '../../app/store';
import { MATERIALS } from '../render/materials';
import { fuel } from '../vehicles/fuel';
import { nav, rideVisual } from './rides';
import { newWalkPath, passengerWalkPath, pointAlongPath } from '../vehicles/entry';

const AMBER = new THREE.Color('#f4b544');
const TEAL = new THREE.Color('#2fd1c0');
const MAX_ARROWS = 70;

function chevronGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.9, -0.5);
  s.lineTo(0, 0.35);
  s.lineTo(0.9, -0.5);
  s.lineTo(0.9, 0.05);
  s.lineTo(0, 0.9);
  s.lineTo(-0.9, 0.05);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2); // shape +Y → world -Z
  g.rotateY(Math.PI); // point along +Z
  return g;
}

/** Spaced glowing chevrons along the next ~260 m of route (plan §6.3), scrolling forward. */
function RouteArrows() {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(
      chevronGeometry(),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      MAX_ARROWS,
    );
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = 2;
    return m;
  }, []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0) }), []);
  const phase = useRef(0);
  useFrame((_, dt) => {
    const navigation = fuel.navigation ?? nav;
    const r = navigation.route;
    if (!navigation.active || !r || r.points.length < 2) {
      mesh.count = 0;
      return;
    }
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.copy(navigation.target === 'pickup' ? AMBER : TEAL);
    phase.current = (phase.current + dt * 6) % 5;
    const start = navigation.along + 4 + phase.current;
    const end = Math.min(r.length - 1, navigation.along + 260);
    let n = 0;
    let idx = Math.max(0, navigation.progressIndex - 2);
    for (let d = start; d < end && n < MAX_ARROWS; d += 5) {
      while (idx < r.cumulative.length - 2 && r.cumulative[idx + 1] < d) idx++;
      const a = r.points[idx];
      const b = r.points[idx + 1];
      const seg = r.cumulative[idx + 1] - r.cumulative[idx] || 1;
      const t = (d - r.cumulative[idx]) / seg;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      tmp.q.setFromAxisAngle(tmp.up, Math.atan2(b[0] - a[0], b[1] - a[1]));
      tmp.p.set(x, 0.06, z);
      const fade = Math.min(1, (d - navigation.along) / 12);
      tmp.s.setScalar(0.9 * fade + 0.1);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.setMatrixAt(n++, tmp.m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

/** Glowing stop rectangle + floating pin above the target bay. */
function BayMarker() {
  const group = useRef<THREE.Group>(null);
  const pin = useRef<THREE.Group>(null);
  const frameMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f4b544', transparent: true, opacity: 0.9, depthWrite: false }), []);
  const fillMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f4b544', transparent: true, opacity: 0.22, depthWrite: false }), []);
  const iconMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);
  const sizeRef = useRef({ l: 0, w: 0 });
  const frameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const fillRef = useRef<THREE.Mesh>(null);
  const progRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    const bay = nav.targetBay;
    if (!g) return;
    if (!nav.active || !bay) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(bay.x, 0.04, bay.z);
    g.rotation.y = bay.heading;
    const col = nav.target === 'pickup' ? '#f4b544' : '#2fd1c0';
    frameMat.color.set(col);
    fillMat.color.set(col);
    const L = bay.length;
    const W = bay.width;
    if (sizeRef.current.l !== L || sizeRef.current.w !== W) {
      sizeRef.current = { l: L, w: W };
      const f = frameRefs.current;
      f[0]?.scale.set(W, 1, 0.3);
      f[0]?.position.set(0, 0, L / 2);
      f[1]?.scale.set(W, 1, 0.3);
      f[1]?.position.set(0, 0, -L / 2);
      f[2]?.scale.set(0.3, 1, L);
      f[2]?.position.set(W / 2, 0, 0);
      f[3]?.scale.set(0.3, 1, L);
      f[3]?.position.set(-W / 2, 0, 0);
      fillRef.current?.scale.set(W, 1, L);
    }
    const pulse = runtime.reducedMotion ? 0.25 : 0.18 + 0.12 * Math.sin(clock.elapsedTime * 4);
    fillMat.opacity = pulse;
    if (progRef.current) {
      progRef.current.scale.set(W * 0.98, 1, Math.max(0.001, L * nav.stopProgress));
      progRef.current.visible = nav.stopProgress > 0;
    }
    if (pin.current) {
      pin.current.position.y = 4.2 + (runtime.reducedMotion ? 0 : Math.sin(clock.elapsedTime * 2.5) * 0.3);
      pin.current.rotation.y = clock.elapsedTime * 1.2;
    }
  });
  return (
    <group ref={group} visible={false}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(m) => void (frameRefs.current[i] = m)} material={frameMat} renderOrder={3}>
          <boxGeometry args={[1, 0.05, 1]} />
        </mesh>
      ))}
      <mesh ref={fillRef} material={fillMat} rotation-x={0} renderOrder={2}>
        <boxGeometry args={[1, 0.02, 1]} />
      </mesh>
      <mesh ref={progRef} material={frameMat} position-y={0.03} renderOrder={3}>
        <boxGeometry args={[1, 0.02, 1]} />
      </mesh>
      <group ref={pin} position={[2.6, 4.2, 0]}>
        <mesh material={frameMat}>
          <sphereGeometry args={[0.75, 16, 12]} />
        </mesh>
        <mesh material={frameMat} position-y={-0.85} rotation-x={Math.PI}>
          <coneGeometry args={[0.5, 0.9, 12]} />
        </mesh>
        <mesh material={iconMat} position={[0, 0.05, 0]}>
          <sphereGeometry args={[0.35, 12, 10]} />
        </mesh>
      </group>
    </group>
  );
}

/** Waiting passengers on the sidewalk (hailing the driver), boarding walk, seated rider, alighting walk. */
function Passengers({ seat, vehicleKind }: { seat: React.RefObject<THREE.Group | null>; vehicleKind: VehicleKind }) {
  const passengerName = useGame(() => rideVisual.passengerName);
  const seed = useGame(() => rideVisual.seed);
  const characterChoice = useGame((s) => s.save.settings.passengerCharacter);
  // three walkers per gender so the party can mix; the lead passenger's gender follows the name
  const walkers = useMemo(() => {
    const out: { gender: Gender; mesh: THREE.SkinnedMesh; rig: Rig; st: AnimState; x: number; z: number; h: number; init: boolean }[] = [];
    for (const g of ['male', 'female'] as const) {
      for (let i = 0; i < 3; i++) {
        const { mesh, rig } = createCharacterMesh(randomLook(mulberry32(i + 1), g), 1, MATERIALS.world);
        mesh.visible = false;
        mesh.name = 'ride-passenger-walker';
        out.push({ gender: g, mesh, rig, st: newAnimState(i * 13 + (g === 'male' ? 0 : 7)), x: 0, z: 0, h: 0, init: false });
      }
    }
    return out;
  }, []);
  const seated = useMemo(() => {
    const m = createCharacterMesh(randomLook(mulberry32(9), 'male'), 1, MATERIALS.world);
    const f = createCharacterMesh(randomLook(mulberry32(9), 'female'), 1, MATERIALS.world);
    m.mesh.name = 'ride-passenger-seated';
    f.mesh.name = 'ride-passenger-seated';
    return { male: { ...m, st: newAnimState(5) }, female: { ...f, st: newAnimState(6) } };
  }, []);
  // per-ride looks: lead gender from the name, companions random
  const party = useMemo(() => {
    const rng = mulberry32(seed || 1);
    const lead = genderForName(passengerName, rng);
    const genders: Gender[] = [lead, rng() < 0.5 ? 'male' : 'female', rng() < 0.5 ? 'male' : 'female'];
    const looks = genders.map((g) => randomLook(rng, g));
    return { genders, looks };
  }, [seed, passengerName]);
  // assign walkers + looks to party slots
  const slots = useMemo(() => {
    const used = new Set<number>();
    return party.genders.map((g, i) => {
      const k = walkers.findIndex((w, j) => w.gender === g && !used.has(j));
      used.add(k);
      setLook(walkers[k].mesh, party.looks[i], 1);
      walkers[k].init = false;
      return k;
    });
  }, [party, walkers]);
  const seatedLooks = useMemo(() => {
    const l = { ...party.looks[0], acc: party.looks[0].acc === 'backpack' || party.looks[0].acc === 'cap' ? ('none' as const) : party.looks[0].acc };
    return { plain: l, helmet: { ...l, helmet: '#f4b544' } };
  }, [party]);
  const doorWorld = useMemo(() => new THREE.Vector3(), []);
  const walk = useMemo(() => ({ path: newWalkPath(), curb: new THREE.Vector3(), at: new THREE.Vector3() }), []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const spec = VEHICLES[runtime.vehicleId];
    const newLead = spec.kind === 'car' || characterChoice !== 'original';
    const p = runtime.pose;
    const stop = rideVisual.stopPose ?? p;
    const shown = Math.min(3, rideVisual.partySize);
    const door = doorOffset(runtime.vehicleId);
    const cos = Math.cos(stop.heading);
    const sin = Math.sin(stop.heading);
    doorWorld.set(stop.x + door.x * cos + door.z * sin, CURB_HEIGHT, stop.z - door.x * sin + door.z * cos);
    const active = new Set(slots.slice(0, shown));
    walkers.forEach((w, j) => {
      if (!active.has(j)) w.mesh.visible = false;
    });
    for (let i = 0; i < shown; i++) {
      const w = walkers[slots[i]];
      if (i === 0 && newLead) { w.mesh.visible = false; continue; }
      const bay = rideVisual.waitingBay ?? rideVisual.alightBay;
      if (!bay) {
        w.mesh.visible = false;
        w.init = false;
        continue;
      }
      const side = (i - (shown - 1) / 2) * 0.9;
      const fx = Math.sin(bay.heading);
      const fz = Math.cos(bay.heading);
      const wx = bay.waitX + fx * side;
      const wz = bay.waitZ + fz * side;
      let x = wx;
      let z = wz;
      let visible = true;
      let target: [number, number] = [bay.x, bay.z];
      if (rideVisual.waitingBay && rideVisual.boardProgress >= 0) {
        const t = Math.min(1, (rideVisual.boardProgress - i * 0.06) / 0.8);
        pointAlongPath(passengerWalkPath(spec, stop, walk.curb.set(wx, CURB_HEIGHT, wz), doorWorld, walk.path), t, walk.at);
        x = walk.at.x;
        z = walk.at.z;
        visible = rideVisual.boardProgress < 0.94 - i * 0.02;
        target = [doorWorld.x, doorWorld.z];
      } else if (rideVisual.alightBay && rideVisual.alightProgress >= 0) {
        const t = Math.max(0, Math.min(1, (rideVisual.alightProgress - 0.15 - i * 0.05) / 0.8));
        const departing = rideVisual.departureAt >= 0 ? Math.max(0, runtime.simTime - rideVisual.departureAt) : 0;
        pointAlongPath(passengerWalkPath(spec, stop, walk.curb.set(wx + fx * 3, CURB_HEIGHT, wz + fz * 3), doorWorld, walk.path), 1 - t, walk.at);
        x = walk.at.x + fx * departing * 1.2;
        z = walk.at.z + fz * departing * 1.2;
        visible = rideVisual.alightProgress >= 0.15 + i * 0.05 && departing < 10;
        target = t >= 1 ? [x + fx, z + fz] : [wx + fx * 3, wz + fz * 3];
      } else if (!rideVisual.waitingBay) visible = false;
      if (!w.init) {
        w.x = x;
        w.z = z;
        w.h = Math.atan2(target[0] - x, target[1] - z);
        w.init = true;
      }
      const moved = Math.hypot(x - w.x, z - w.z);
      const want = moved > 0.002 ? Math.atan2(x - w.x, z - w.z) : Math.atan2(target[0] - x, target[1] - z);
      let dh = want - w.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      w.h += dh * Math.min(1, dt * 8);
      w.x = x;
      w.z = z;
      w.mesh.visible = visible;
      if (!visible) continue;
      w.mesh.position.set(x, CURB_HEIGHT, z);
      w.mesh.rotation.y = w.h;
      const waiting = !!rideVisual.waitingBay && rideVisual.boardProgress < 0;
      const near = Math.hypot(p.x - wx, p.z - wz) < 40;
      animateLocomotion(w.rig, w.st, dt, moved, { wave: waiting && near && i === 0, reduced: runtime.reducedMotion });
    }
    // seated rider (two-wheelers, auto, cars): hips on the passenger seat anchor
    const lead = party.genders[0];
    for (const g of ['male', 'female'] as const) {
      const c = seated[g];
      const s = seat.current;
      const mounted = rideVisual.onboard || (rideVisual.waitingBay && rideVisual.boardProgress >= 0.94);
      const moving = rideVisual.boardProgress >= 0 || (rideVisual.alightProgress >= 0 && rideVisual.departureAt < 0);
      const show = !newLead && g === lead && !!mounted && !!s && !!spec && (spec.kind === 'bike' || spec.kind === 'auto' || spec.kind === 'car') && (runtime.cameraMode !== 'eye' || moving);
      c.mesh.visible = show;
      if (!show || !s) continue;
      if (c.mesh.parent !== s) s.add(c.mesh);
      const want = buildCharacterGeometry(spec.kind === 'bike' ? seatedLooks.helmet : seatedLooks.plain, 1);
      if (c.mesh.geometry !== want) c.mesh.geometry = want;
      const scale = spec.kind === 'car' ? 0.9 : 1;
      c.mesh.scale.setScalar(scale);
      c.mesh.position.set(0, -c.rig.P.joints[0].y * scale, 0);
      const tel = runtime.telemetry;
      poseSeated(c.rig, spec.kind === 'bike' ? 'pillion' : spec.kind === 'auto' ? 'auto' : 'car', c.st, dt, { steer: tel.steerAngle * 0.5, longAccel: tel.longAccel, lateralAccel: tel.lateralAccel, speed: 5, roll: 0 });
    }
  });
  useEffect(
    () => () => {
      // React Three Fiber owns the walker primitives. Removing them in an effect cleanup
      // detaches them permanently during StrictMode's development cleanup/re-setup cycle.
      seated.male.mesh.removeFromParent();
      seated.female.mesh.removeFromParent();
    },
    [seated],
  );
  return (
    <>
      <LeadPassenger seat={seat} look={party.looks[0]} vehicleKind={vehicleKind} />
      {walkers.map((w, i) => (
        <primitive key={i} object={w.mesh} />
      ))}
    </>
  );
}

const doorCache = new Map<string, THREE.Vector3>();
function doorOffset(id: keyof typeof VEHICLES) {
  let d = doorCache.get(id);
  if (!d) {
    const parts = buildVehicleParts(VEHICLES[id], '#ffffff', false);
    d = parts.door.clone();
    parts.body.dispose();
    parts.glass?.dispose();
    parts.steer?.geometry.dispose();
    parts.wheel.forEach((w) => w.dispose());
    doorCache.set(id, d);
  }
  return d;
}

export function RideVisuals({ seat, vehicleKind }: { seat: React.RefObject<THREE.Group | null>; vehicleKind: VehicleKind }) {
  return (
    <>
      <RouteArrows />
      <BayMarker />
      <Passengers seat={seat} vehicleKind={vehicleKind} />
    </>
  );
}
