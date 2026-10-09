import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { FUEL_STATIONS } from '../data/cityMap';
import { runtime } from '../core/runtime';
import { insideFuelBay } from '../vehicles/fuel';

export function FuelMarkers() {
  const groups = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    FUEL_STATIONS.forEach((bay, i) => {
      const group = groups.current[i]; if (!group) return;
      group.visible = Math.hypot(runtime.pose.x - bay.x, runtime.pose.z - bay.z) < 100;
      const inside = insideFuelBay(bay, runtime.pose.x, runtime.pose.z);
      group.userData.inside = inside;
      const surface = group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      surface.material.opacity = inside ? .32 : .14 + Math.sin(runtime.simTime * 3) * .04;
    });
  });
  return <group name="fuel-station-markers">{FUEL_STATIONS.map((bay, i) => (
    <group name={`fuel-bay-${bay.id}`} key={bay.id} ref={o => { groups.current[i] = o; }} position={[bay.x, .026, bay.z]} rotation-y={bay.heading}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={3}>
        <planeGeometry args={[bay.width + 1.6, bay.length]} />
        <meshBasicMaterial color="#35ebaa" transparent opacity={.18} depthWrite={false} />
      </mesh>
      {[-1, 1].map(side => <mesh key={`side${side}`} position={[side * (bay.width / 2 + .8), .005, 0]} rotation-x={-Math.PI / 2} renderOrder={4}>
        <planeGeometry args={[.12, bay.length]} /><meshBasicMaterial color="#67ffd0" depthWrite={false} />
      </mesh>)}
      {[-1, 1].map(side => <mesh key={`end${side}`} position={[0, .005, side * bay.length / 2]} rotation-x={-Math.PI / 2} renderOrder={4}>
        <planeGeometry args={[bay.width + 1.6, .12]} /><meshBasicMaterial color="#67ffd0" depthWrite={false} />
      </mesh>)}
    </group>
  ))}</group>;
}
