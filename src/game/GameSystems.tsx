import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DIR_VEC, INTERSECTIONS, SEGMENTS, CURB_HEIGHT, roadHalfWidth, segmentPoint } from './data/cityMap';
import { VEHICLES } from './data/vehicles';
import { runtime } from './core/runtime';
import { quality } from './render/quality';
import { MATERIALS } from './render/materials';
import { buildStaticVehicleGeometry } from './render/models';
import { createCharacterMesh, randomLook, setLook, type Look } from './render/characters';
import { animateLocomotion, newAnimState } from './render/charAnim';
import { mulberry32 } from './core/rng';
import { traffic, TRAFFIC_MODELS, type Car } from './traffic/traffic';
import { phaseAt, axisOf } from './traffic/signals';
import { pedestrians } from './pedestrians/pedestrians';
import { recoveryOccupancy } from './rules/recovery';
import { TRAFFIC_GROUPS } from './world/collisionGroups';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const tmpC = new THREE.Color();

/** Traffic cars: instanced meshes per model + one kinematic Rapier body per pooled car. */
function Traffic() {
  const { world, rapier } = useRapier();
  const meshes = useMemo(() => {
    const out = new Map<string, THREE.InstancedMesh>();
    for (const m of TRAFFIC_MODELS) {
      for (const lod of ['near', 'far'] as const) {
        const mesh = new THREE.InstancedMesh(buildStaticVehicleGeometry(VEHICLES[m], '#ffffff', true, lod === 'near' ? 'mid' : true), MATERIALS.tint, traffic.cars.length);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(traffic.cars.length * 3).fill(1), 3);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.count = 0;
        out.set(`${m}:${lod}`, mesh);
      }
    }
    const police = new THREE.InstancedMesh(buildPoliceGeometry(), MATERIALS.world, 4);
    police.castShadow = true;
    police.frustumCulled = false;
    police.count = 0;
    out.set('police', police);
    return out;
  }, []);
  const bodies = useRef<Map<number, InstanceType<typeof rapier.RigidBody>>>(new Map());

  useEffect(() => {
    const ownerBodies = world.bodies;
    const map = bodies.current;
    for (const c of traffic.cars) {
      const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, c.id * 10));
      world.createCollider(rapier.ColliderDesc.cuboid(0.95, 0.8, 2.1).setTranslation(0, 0.8, 0).setCollisionGroups(TRAFFIC_GROUPS).setFriction(0.3), body);
      map.set(c.id, body);
    }
    const sizeKey = new Map<number, string>();
    const syncBody = (b: InstanceType<typeof rapier.RigidBody>, c: Car) => {
      if (!c.active) {
        b.setNextKinematicTranslation({ x: c.id * 10, y: -50, z: 0 });
        return;
      }
      // resize collider when the pooled car changes model
      const key = c.police ? 'police' : c.model;
      if (sizeKey.get(c.id) !== key) {
        sizeKey.set(c.id, key);
        const col = b.collider(0);
        const spec = VEHICLES[c.model];
        col.setHalfExtents({ x: spec.width / 2, y: spec.height / 2, z: spec.length / 2 });
        col.setTranslationWrtParent({ x: 0, y: spec.height / 2, z: 0 });
      }
      b.setNextKinematicTranslation({ x: c.x, y: 0, z: c.z });
      tmpQ.setFromAxisAngle(UP, c.heading);
      b.setNextKinematicRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
    };
    recoveryOccupancy.test = (x, z) => traffic.occupied(x, z, 7);
    const off = runtime.register('traffic', (dt) => {
      traffic.target = quality.current.traffic;
      traffic.step(dt);
      for (const c of traffic.cars) {
        const b = map.get(c.id);
        if (!b) continue;
        syncBody(b, c);
      }
    });
    return () => {
      off();
      recoveryOccupancy.test = null;
      if (world.bodies === ownerBodies) for (const b of map.values()) if (world.getRigidBody(b.handle)) world.removeRigidBody(b);
      map.clear();
      traffic.reset();
    };
  }, [world, rapier]);

  useFrame(() => {
    const counts = new Map<string, number>();
    const cam = runtime.cameraPose;
    for (const c of traffic.cars) {
      if (!c.active) continue;
      const near = Math.hypot(c.x - cam.x, c.z - cam.z) < quality.current.trafficLodDistance;
      const key = c.police ? 'police' : `${c.model}:${near ? 'near' : 'far'}`;
      const mesh = meshes.get(key)!;
      const n = counts.get(key) ?? 0;
      if (n >= mesh.instanceMatrix.count) continue;
      tmpQ.setFromAxisAngle(UP, c.heading);
      tmpM.compose(tmpP.set(c.x, 0, c.z), tmpQ, tmpS);
      mesh.setMatrixAt(n, tmpM);
      if (key !== 'police') mesh.setColorAt(n, tmpC.set(c.color));
      counts.set(key, n + 1);
    }
    for (const [key, mesh] of meshes) {
      mesh.count = counts.get(key) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      {[...meshes.values()].map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

/** Police car: white/blue compact with a light bar. */
export function buildPoliceGeometry() {
  const base = buildStaticVehicleGeometry(VEHICLES.car_compact, '#f6f7fb', true, true);
  const g = base.clone();
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const mask = g.getAttribute('tintMask') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const white = new THREE.Color('#f6f7fb');
  const blue = new THREE.Color('#2b5fb8');
  for (let i = 0; i < col.count; i++) {
    if (mask.getX(i) > 0.5) {
      const c = pos.getY(i) < 0.62 ? blue : white;
      col.setXYZ(i, c.r, c.g, c.b);
    }
  }
  // light bar
  const bar = new THREE.BoxGeometry(1.0, 0.16, 0.3).toNonIndexed();
  bar.translate(0, VEHICLES.car_compact.height + 0.06, -0.2);
  const n = bar.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const left = bar.getAttribute('position').getX(i) > 0;
    const cc = new THREE.Color(left ? '#e5484d' : '#3f7fd8');
    c.set([cc.r, cc.g, cc.b], i * 3);
  }
  bar.setAttribute('color', new THREE.BufferAttribute(c, 3));
  bar.setAttribute('tintMask', new THREE.BufferAttribute(new Float32Array(n), 1));
  bar.deleteAttribute('uv');
  const merged = new THREE.BufferGeometry();
  const parts = [g, bar];
  for (const name of ['position', 'normal', 'color', 'tintMask']) {
    const size = (g.getAttribute(name) as THREE.BufferAttribute).itemSize;
    const arr = new Float32Array(parts.reduce((a, p) => a + p.getAttribute(name).count * size, 0));
    let o = 0;
    for (const p of parts) {
      arr.set((p.getAttribute(name) as THREE.BufferAttribute).array as Float32Array, o);
      o += p.getAttribute(name).count * size;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  merged.computeBoundingSphere();
  return merged;
}

/** Signal heads at every signalized approach; lamp colours follow the authoritative phase. */
function Signals() {
  const data = useMemo(() => {
    const heads: { junction: (typeof INTERSECTIONS)[number]; dir: (typeof SEGMENTS)[number]['dir']; x: number; z: number; ry: number }[] = [];
    for (const seg of SEGMENTS) {
      const n = INTERSECTIONS.find((k) => k.id === seg.to)!;
      if (!n.signal) continue;
      // pole on the driver's left (curb side) at the stop line
      const half = roadHalfWidth(seg.cls);
      const [x, z] = segmentPoint(seg, seg.length - 0.2, half + 1.0);
      const [dx, dz] = DIR_VEC[seg.dir];
      heads.push({ junction: n, dir: seg.dir, x, z, ry: Math.atan2(-dx, -dz) });
    }
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 3.6, 6), MATERIALS.inst, heads.length);
    const box = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 1.25, 0.34), MATERIALS.inst, heads.length);
    const lampGeo = new THREE.SphereGeometry(0.15, 10, 8);
    const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const lamps = [0, 1, 2].map(() => new THREE.InstancedMesh(lampGeo, lampMat, heads.length));
    heads.forEach((h, i) => {
      tmpQ.setFromAxisAngle(UP, h.ry);
      tmpM.compose(tmpP.set(h.x, CURB_HEIGHT + 1.8, h.z), tmpQ, tmpS);
      pole.setMatrixAt(i, tmpM);
      pole.setColorAt(i, tmpC.set('#2f3a4a'));
      tmpM.compose(tmpP.set(h.x, CURB_HEIGHT + 3.75, h.z), tmpQ, tmpS);
      box.setMatrixAt(i, tmpM);
      box.setColorAt(i, tmpC.set('#24303d'));
      const fx = Math.sin(h.ry);
      const fz = Math.cos(h.ry);
      lamps.forEach((l, k) => {
        tmpM.compose(tmpP.set(h.x + fx * 0.18, CURB_HEIGHT + 4.15 - k * 0.4, h.z + fz * 0.18), tmpQ, tmpS);
        l.setMatrixAt(i, tmpM);
        l.setColorAt(i, tmpC.set('#333'));
      });
    });
    for (const m of [pole, box, ...lamps]) {
      m.computeBoundingSphere();
      m.frustumCulled = false;
    }
    pole.castShadow = true;
    box.castShadow = true;
    return { heads, pole, box, lamps };
  }, []);
  const acc = useRef(1);
  const OFF = useMemo(() => new THREE.Color('#3a3f45'), []);
  const ON = useMemo(() => [new THREE.Color('#ff4a4a'), new THREE.Color('#ffc23a'), new THREE.Color('#4ce07a')], []);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.2) return;
    acc.current = 0;
    data.heads.forEach((h, i) => {
      const light = phaseAt(h.junction, runtime.simTime)[axisOf(h.dir)];
      data.lamps[0].setColorAt(i, light === 'R' ? ON[0] : OFF);
      data.lamps[1].setColorAt(i, light === 'A' ? ON[1] : OFF);
      data.lamps[2].setColorAt(i, light === 'G' ? ON[2] : OFF);
    });
    for (const l of data.lamps) if (l.instanceColor) l.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <primitive object={data.pole} />
      <primitive object={data.box} />
      {data.lamps.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </group>
  );
}

/**
 * Pedestrian crowd: one skinned character per pool slot (male/female slots alternate), with
 * distance-driven gait animation, smooth turning at corners and an idle stance while waiting.
 */
function Pedestrians() {
  const crowd = useMemo(() => {
    const looks = { male: [] as Look[], female: [] as Look[] };
    const rng = mulberry32(31);
    for (let i = 0; i < 8; i++) {
      looks.male.push(randomLook(rng, 'male'));
      looks.female.push(randomLook(rng, 'female'));
    }
    const people = pedestrians.peds.map((p, i) => {
      const { mesh, rig } = createCharacterMesh(looks[p.gender][i % 8], 0, MATERIALS.world);
      mesh.visible = false;
      return { mesh, rig, st: newAnimState(i * 17.3), x: 0, y: CURB_HEIGHT, z: 0, h: 0, look: -1, skip: 0, accDt: 0, accMoved: 0, wasActive: false };
    });
    return { looks, people };
  }, []);
  useEffect(() => {
    const off = runtime.register('pedestrians', (dt) => {
      pedestrians.target = quality.current.pedestrians;
      pedestrians.step(dt);
    });
    return () => {
      off();
      pedestrians.reset();
    };
  }, []);
  useEffect(() => () => crowd.people.forEach((c) => c.mesh.skeleton.dispose()), [crowd]);
  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    pedestrians.peds.forEach((p, i) => {
      const c = crowd.people[i];
      if (!p.active) {
        c.mesh.visible = false;
        c.wasActive = false;
        return;
      }
      if (c.look !== p.variant) {
        c.look = p.variant;
        setLook(c.mesh, crowd.looks[p.gender][p.variant % 8], 0);
      }
      const ty = p.state === 'cross' ? 0.02 : CURB_HEIGHT;
      if (!c.wasActive) {
        c.x = p.x;
        c.z = p.z;
        c.y = ty;
        c.h = p.heading;
        c.wasActive = true;
      }
      const moved = Math.hypot(p.x - c.x, p.z - c.z);
      let dh = p.heading - c.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.h += dh * Math.min(1, dt * 6);
      c.x = p.x;
      c.z = p.z;
      c.y += (ty - c.y) * Math.min(1, dt * 10);
      const m = c.mesh;
      m.visible = true;
      m.position.set(c.x, c.y, c.z);
      m.rotation.y = c.h;
      // animate far people at a lower rate (accumulating time and distance)
      const dist = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
      const every = dist > 90 ? 4 : dist > 45 ? 2 : 1;
      m.castShadow = dist < 60;
      c.accDt += dt;
      c.accMoved += moved;
      if (++c.skip >= every) {
        c.skip = 0;
        animateLocomotion(c.rig, c.st, c.accDt, p.state === 'wait' ? 0 : c.accMoved, { reduced: runtime.reducedMotion, hurry: p.shaken > 0 ? 1 : 0 });
        c.accDt = 0;
        c.accMoved = 0;
      }
    });
  });
  return (
    <group>
      {crowd.people.map((c, i) => (
        <primitive key={i} object={c.mesh} />
      ))}
    </group>
  );
}

/** Scene-level gameplay systems mounted once the scene is ready. */
export function GameSystems() {
  return (
    <>
      <Signals />
      <Traffic />
      <Pedestrians />
    </>
  );
}
