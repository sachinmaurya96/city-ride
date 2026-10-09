import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MAP_HALF } from '../data/cityMap';
import { VEHICLES } from '../data/vehicles';
import { MATERIALS } from '../render/materials';
import { DETAIL_KINDS, type BatchKind } from '../render/batches';
import { buildStaticVehicleGeometry } from '../render/models';
import { buildCity, type CityBuild, type ParkedVehicle, type Patron, type SignDef } from './cityBuilder';
import { buildBoardGeometry, buildSignAtlas, type BoardDef } from './shopSigns';
import { bakeCharacter, randomLook } from '../render/characters';
import { newAnimState, poseSeated } from '../render/charAnim';
import { mulberry32 } from '../core/rng';
import { CAMERA_ONLY_GROUPS, GROUND_GROUPS, STATIC_GROUPS } from './collisionGroups';
import { quality } from '../render/quality';
import { ImportedCity } from './ImportedCity';
import { FuelMarkers } from './FuelMarkers';

const SPHERE_LOW = new THREE.IcosahedronGeometry(1, 0);

let cached: CityBuild | null = null;
/** City generation is deterministic; build once per page load. */
export function getCity() {
  if (!cached) cached = buildCity();
  return cached;
}

function makeSignTexture(s: SignDef) {
  const ph = 128;
  const pw = Math.max(64, Math.round((s.w / s.h) * ph));
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(1024, pw);
  canvas.height = ph;
  const c = canvas.getContext('2d')!;
  const r = 24;
  c.fillStyle = s.bg;
  c.beginPath();
  c.roundRect(0, 0, canvas.width, canvas.height, r);
  c.fill();
  c.fillStyle = s.fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  let size = 84;
  c.font = `800 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  while (c.measureText(s.text).width > canvas.width - 24 && size > 20) {
    size -= 4;
    c.font = `800 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  }
  c.fillText(s.text, canvas.width / 2, canvas.height / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function Signs({ signs }: { signs: SignDef[] }) {
  const items = useMemo(
    () =>
      signs.map((s) => ({
        s,
        mat: new THREE.MeshStandardMaterial({ map: makeSignTexture(s), roughness: 0.6 }),
      })),
    [signs],
  );
  useEffect(
    () => () => {
      for (const i of items) {
        i.mat.map?.dispose();
        i.mat.dispose();
      }
    },
    [items],
  );
  return (
    <group>
      {items.map(({ s, mat }, i) => (
        <group key={i} position={[s.x, s.y, s.z]} rotation-y={s.ry}>
          <mesh material={mat} position-z={0.12}>
            <planeGeometry args={[s.w, s.h]} />
          </mesh>
          <mesh position-z={0.02}>
            <boxGeometry args={[s.w + 0.25, s.h + 0.25, 0.18]} />
            <meshStandardMaterial color="#fbf6ea" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Shop banners and street-name boards: one atlas texture, one draw call. */
function Boards({ boards, names }: { boards: BoardDef[]; names: string[] }) {
  const data = useMemo(() => {
    const tex = buildSignAtlas(names);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.12 });
    return { geo: buildBoardGeometry(boards), mat, tex };
  }, [boards, names]);
  useEffect(
    () => () => {
      data.geo.dispose();
      data.mat.dispose();
      data.tex.dispose();
    },
    [data],
  );
  return <mesh geometry={data.geo} material={data.mat} />;
}

/** Café guests: six baked seated characters (male and female), instanced near the camera only. */
function Patrons({ patrons }: { patrons: Patron[] }) {
  const { camera } = useThree();
  const meshes = useMemo(() => {
    const rng = mulberry32(77);
    return [0, 1, 2, 3, 4, 5].map((v) => {
      const look = randomLook(rng, v % 2 ? 'female' : 'male');
      const geo = bakeCharacter({ ...look, acc: look.acc === 'backpack' ? 'none' : look.acc }, 0, (rig, root) => {
        root.position.set(0, CURB_SEAT - rig.P.joints[0].y, 0);
        poseSeated(rig, 'chair', newAnimState(v), 0);
        // one hand on the table (holding a cup), the other resting
        rig.bones[5].rotation.set(-1.15, 0, -0.15);
        rig.bones[6].rotation.set(-0.5, 0, 0);
        rig.bones[2].rotation.set(0.05, v % 3 === 0 ? 0.5 : -0.25, 0);
      });
      const mesh = new THREE.InstancedMesh(geo, MATERIALS.world, Math.max(1, patrons.length));
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      return mesh;
    });
  }, [patrons]);
  const acc = useRef(1);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1) }), []);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const counts = [0, 0, 0, 0, 0, 0];
    const r = quality.current.drawDistance * 0.25;
    for (const p of patrons) {
      if (Math.abs(p.x - camera.position.x) > r || Math.abs(p.z - camera.position.z) > r) continue;
      const mesh = meshes[p.variant];
      tmp.q.setFromAxisAngle(tmp.up, p.ry);
      tmp.m.compose(tmp.p.set(p.x, p.y, p.z), tmp.q, tmp.one);
      mesh.setMatrixAt(counts[p.variant]++, tmp.m);
    }
    meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
  });
  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes]);
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
/** Hip-joint height of a seated café guest above the sidewalk. */
const CURB_SEAT = 0.52;

/** Parked cars: one InstancedMesh per model, refilled with only the cars near the camera. */
function ParkedVehicles({ parked }: { parked: ParkedVehicle[] }) {
  const { camera } = useThree();
  const groups = useMemo(() => {
    const byModel = new Map<ParkedVehicle['model'], ParkedVehicle[]>();
    for (const p of parked) {
      if (!byModel.has(p.model)) byModel.set(p.model, []);
      byModel.get(p.model)!.push(p);
    }
    return [...byModel].map(([model, list]) => {
      const geo = buildStaticVehicleGeometry(VEHICLES[model], '#ffffff', false, true);
      const mesh = new THREE.InstancedMesh(geo, MATERIALS.tint, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      return { list, mesh };
    });
  }, [parked]);
  const acc = useRef(1);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color(), p: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1) }), []);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const r = Math.min(200, quality.current.drawDistance * 0.6);
    for (const g of groups) {
      let n = 0;
      for (const p of g.list) {
        if (Math.abs(p.x - camera.position.x) > r || Math.abs(p.z - camera.position.z) > r) continue;
        tmp.q.setFromAxisAngle(tmp.up, p.heading);
        tmp.m.compose(tmp.p.set(p.x, 0, p.z), tmp.q, tmp.one);
        g.mesh.setMatrixAt(n, tmp.m);
        g.mesh.setColorAt(n, tmp.c.set(p.color));
        n++;
      }
      g.mesh.count = n;
      g.mesh.instanceMatrix.needsUpdate = true;
      if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
    }
  });
  return (
    <group>
      {groups.map((g, i) => (
        <primitive key={i} object={g.mesh} />
      ))}
    </group>
  );
}

/** Creates all static colliders once, directly through the Rapier world (fast for thousands of boxes). */
function CityColliders({ city }: { city: CityBuild }) {
  const { world, rapier } = useRapier();
  useEffect(() => {
    // Remember which world instance owns these colliders: React StrictMode / remounts may replace the
    // world behind the proxy, and removing a stale handle from a different world panics in WASM.
    const ownerBodies = world.bodies;
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
    const ground = rapier.ColliderDesc.cuboid(MAP_HALF + 60, 0.5, MAP_HALF + 60).setTranslation(0, -0.5, 0).setCollisionGroups(GROUND_GROUPS).setFriction(0.9);
    world.createCollider(ground, body);
    for (const hull of city.platformHulls) {
      const d = rapier.ColliderDesc.convexHull(hull);
      if (d) world.createCollider(d.setCollisionGroups(GROUND_GROUPS).setFriction(0.9), body);
    }
    for (const p of city.platformBoxes) {
      world.createCollider(rapier.ColliderDesc.cuboid(p.hx, p.hy, p.hz).setTranslation(p.x, p.y, p.z).setCollisionGroups(GROUND_GROUPS), body);
    }
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const s of city.staticBoxes) {
      q.setFromAxisAngle(up, s.ry);
      world.createCollider(
        rapier.ColliderDesc.cuboid(s.hx, s.hy, s.hz)
          .setTranslation(s.x, s.y, s.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(STATIC_GROUPS)
          .setFriction(0.4)
          .setRestitution(0.1),
        body,
      );
    }
    for (const c of city.cameraBalls) {
      world.createCollider(rapier.ColliderDesc.ball(c.r).setTranslation(c.x, c.y, c.z).setCollisionGroups(CAMERA_ONLY_GROUPS), body);
    }
    // Sign backings can cover curbside entry views even when the building behind them is clear.
    for (const sign of [...city.signs, ...city.boards]) {
      q.setFromAxisAngle(up, sign.ry ?? 0);
      world.createCollider(
        rapier.ColliderDesc.cuboid(sign.w / 2 + .15, sign.h / 2 + .15, .15)
          .setTranslation(sign.x, sign.y, sign.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(CAMERA_ONLY_GROUPS),
        body,
      );
    }
    return () => {
      if (world.bodies === ownerBodies && world.getRigidBody(body.handle)) world.removeRigidBody(body);
    };
  }, [world, rapier, city]);
  return null;
}

export function City() {
  const city = getCity();
  const { camera } = useThree();
  const groups = useRef<(THREE.Group | null)[]>([]);
  const chunkObjects = useMemo(
    () =>
      city.chunks.map((ch) => {
        const objs: THREE.Object3D[] = [];
        if (ch.merged) {
          const m = new THREE.Mesh(ch.merged, MATERIALS.world);
          m.receiveShadow = true;
          m.castShadow = ch.id !== 'outer';
          objs.push(m);
        }
        for (const m of ch.batches.build(MATERIALS.inst)) {
          m.userData.kind = m.name;
          objs.push(m);
          if (m.name === 'sphere') {
            // Far LOD twin: same instance buffers, 20-triangle geometry.
            const low = new THREE.InstancedMesh(SPHERE_LOW, MATERIALS.inst, m.count);
            low.instanceMatrix = m.instanceMatrix;
            low.instanceColor = m.instanceColor;
            low.boundingSphere = m.boundingSphere;
            low.castShadow = false;
            low.receiveShadow = true;
            low.userData.kind = 'sphereLow';
            low.visible = ch.id === 'outer';
            if (ch.id === 'outer') m.visible = false; // scenery trees beyond the fence: always low LOD
            objs.push(low);
          }
        }
        return objs;
      }),
    [city],
  );
  const markings = useMemo(() => {
    const m = new THREE.Mesh(city.markings, MATERIALS.markings);
    m.receiveShadow = true;
    return m;
  }, [city]);
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.25) return;
    acc.current = 0;
    const far = quality.current.drawDistance;
    city.chunks.forEach((ch, i) => {
      const g = groups.current[i];
      if (!g) return;
      if (ch.id === 'outer') return;
      const d = Math.hypot(camera.position.x - ch.center.x, camera.position.z - ch.center.z) - ch.radius;
      g.visible = d < far;
      // Small props only on near chunks.
      const near = d < Math.min(quality.current.detailDistance, far * 0.65);
      const lodNear = d < quality.current.treeLodDistance;
      for (const o of g.children) {
        const kind = (o as THREE.Object3D & { userData: { kind?: BatchKind | 'sphereLow' } }).userData.kind;
        if (kind === 'sphere' && ch.id !== 'outer') o.visible = lodNear;
        else if (kind === 'sphereLow') o.visible = !lodNear;
        else if (kind && DETAIL_KINDS.has(kind as BatchKind)) o.visible = near;
      }
    });
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow position-y={-.02}>
        <planeGeometry args={[(MAP_HALF + 40) * 2, (MAP_HALF + 40) * 2]} />
        <meshStandardMaterial color="#739669" roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.3}>
        <planeGeometry args={[4000, 4000]} />
        <meshStandardMaterial color="#9fd07f" roughness={1} />
      </mesh>
      <primitive object={markings} />
      <ImportedCity city={city} />
      <FuelMarkers />
      {chunkObjects.map((objs, i) => (
        <group key={city.chunks[i].id} ref={(g) => void (groups.current[i] = g)}>
          {objs.map((o, j) => (
            <primitive key={j} object={o} />
          ))}
        </group>
      ))}
      <Signs signs={city.signs} />
      <Boards boards={city.boards} names={city.streetNames} />
      <Patrons patrons={city.patrons} />
      <ParkedVehicles parked={city.parked} />
      <CityColliders city={city} />
    </group>
  );
}
