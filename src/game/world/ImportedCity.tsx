import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GRID, INTERSECTIONS, MAP_HALF, ROAD_SPEC, SEGMENTS, STOP_LINE_GAP, roadHalfWidth } from '../data/cityMap';
import { quality } from '../render/quality';
import { worldAssets, type WorldPack } from './worldAssets';
import type { CityBuild } from './cityBuilder';

export interface WorldPlacement {
  pack: WorldPack; variant: number; x: number; y: number; z: number; ry: number; width: number; height: number; depth: number;
}
export function roadPlacements(): WorldPlacement[] {
  const roads = worldAssets.get('roads') ?? [];
  const index = (name: string) => Math.max(0, roads.findIndex(model => model.name === name));
  const out: WorldPlacement[] = SEGMENTS.filter(seg => seg.dir === 'E' || seg.dir === 'S').map(seg => ({
    pack: 'roads', variant: index('Road_1X_Straight'), x: (seg.sx + seg.ex) / 2, y: .004, z: (seg.sz + seg.ez) / 2,
    ry: seg.dir === 'S' ? Math.PI / 2 : 0, width: seg.length + STOP_LINE_GAP * 2, height: .008, depth: roadHalfWidth(seg.cls) * 2,
  }));
  for (const junction of INTERSECTIONS) {
    const edgeX = junction.i === 0 || junction.i === GRID.length - 1, edgeZ = junction.j === 0 || junction.j === GRID.length - 1;
    out.push({ pack: 'roads', variant: index(edgeX && edgeZ ? 'Road_L_Intersection' : edgeX || edgeZ ? 'Road_T_Intersection' : 'Road_X_Intersection'),
      x: junction.x, y: .004, z: junction.z, ry: edgeX ? junction.i === 0 ? 0 : Math.PI : edgeZ ? junction.j === 0 ? Math.PI / 2 : -Math.PI / 2 : 0,
      width: junction.hx * 2, depth: junction.hz * 2, height: .008 });
  }
  // Connect the outer junctions to the drivable perimeter rather than ending the artwork abruptly.
  for (const coord of GRID) for (const side of [-1, 1]) for (const axis of ['x', 'z']) {
    const cls = coord === 0 ? 'avenue' : Math.abs(coord) === 480 ? 'bypass' : 'local';
    const half = roadHalfWidth(cls), length = MAP_HALF - 480 - half;
    out.push({ pack: 'roads', variant: index('Road_1X_Straight'), x: axis === 'x' ? side * (480 + half + length / 2) : coord,
      z: axis === 'z' ? side * (480 + half + length / 2) : coord, y: .004, ry: axis === 'z' ? Math.PI / 2 : 0,
      width: length, height: .008, depth: (ROAD_SPEC[cls].lanes * ROAD_SPEC[cls].laneWidth + ROAD_SPEC[cls].median / 2 + 2.8) * 2 });
  }
  return out;
}

/** Original pack geometry/materials are shared by instances, with nearby trees and distant buildings culled. */
export function ImportedCity({ city }: { city: CityBuild }) {
  const { camera } = useThree();
  const batches = useMemo(() => {
    const placements = [...city.worldPlacements, ...roadPlacements()];
    for (const side of [-1, 1]) for (const axis of ['x', 'z']) placements.push({ pack: 'skyline', variant: 0,
      x: axis === 'x' ? side * 660 : 0, y: 0, z: axis === 'z' ? side * 660 : 0, ry: axis === 'z' ? 0 : Math.PI / 2, width: 480, depth: 115, height: 85 });
    const grouped = new Map<string, WorldPlacement[]>();
    for (const p of placements) {
      const models = worldAssets.get(p.pack); if (!models?.length) continue;
      const key = `${p.pack}:${p.variant % models.length}`;
      const list = grouped.get(key) ?? []; list.push(p); grouped.set(key, list);
    }
    return [...grouped].flatMap(([key, list]) => {
      const [pack, index] = key.split(':'); const model = worldAssets.get(pack as WorldPack)![Number(index)];
      return model.parts.map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, list.length);
        mesh.name = `city-pack-${key}`; mesh.castShadow = pack !== 'roads'; mesh.receiveShadow = true; mesh.frustumCulled = false;
        mesh.userData.source = model.name; mesh.userData.pack = pack; mesh.count = 0;
        return { mesh, list, pack };
      });
    });
  }, [city]);
  const acc = useRef(1);
  const previousView = useRef({ x: Infinity, z: Infinity, preset: quality.current });
  const scratch = useMemo(() => ({ matrix: new THREE.Matrix4(), position: new THREE.Vector3(), scale: new THREE.Vector3(), rotation: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) }), []);
  useFrame((_, dt) => {
    acc.current += dt;
    const previous = previousView.current;
    if (acc.current < .2 && Math.hypot(camera.position.x - previous.x, camera.position.z - previous.z) < 15 && previous.preset === quality.current) return;
    acc.current = 0; previous.x = camera.position.x; previous.z = camera.position.z; previous.preset = quality.current;
    for (const { mesh, list, pack } of batches) {
      let count = 0;
      const range = pack === 'bananas' ? Math.min(65, quality.current.detailDistance) : pack === 'forest' || pack === 'palms' ? quality.current.treeLodDistance * 1.5 : quality.current.drawDistance + 50;
      for (const p of list) {
        if (Math.hypot(p.x - camera.position.x, p.z - camera.position.z) - Math.max(p.width, p.depth) / 2 > range) continue;
        scratch.matrix.compose(scratch.position.set(p.x, p.y, p.z), scratch.rotation.setFromAxisAngle(scratch.up, p.ry), scratch.scale.set(p.width, p.height, p.depth));
        mesh.setMatrixAt(count++, scratch.matrix);
      }
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
    }
  });
  useEffect(() => () => batches.forEach(({ mesh }) => mesh.dispose()), [batches]);
  return <group name="resource-city">{batches.map(({ mesh }) => <primitive key={mesh.uuid} object={mesh} dispose={null} />)}</group>;
}
