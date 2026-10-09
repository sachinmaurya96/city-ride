import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { runtime } from '../core/runtime';
import { SkidMarkPool, SKID_SECONDS } from './skidMarkPool';

export function SkidMarks() {
  const resources = useMemo(() => {
    const pool = new SkidMarkPool(), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pool.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('born', new THREE.BufferAttribute(pool.births, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { now: { value: 0 }, lifetime: { value: SKID_SECONDS } },
      vertexShader: 'attribute float born; uniform float now; varying float age; void main(){ age=now-born; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float lifetime; varying float age; void main(){ if(age<0.0||age>=lifetime) discard; float alpha=.58*(1.0-smoothstep(lifetime-2.0,lifetime,age)); gl_FragColor=vec4(.12,.12,.115,alpha); }',
    });
    return { pool, geometry, material, version: 0 };
  }, []);
  useFrame(() => {
    const { pool, geometry, material } = resources, v = runtime.vehicle;
    if (v && runtime.telemetry.drifting && runtime.telemetry.grounded) {
      v.spec.wheels.physics.forEach((wheel, i) => {
        if (wheel.steer) return;
        const point = v.controller.wheelContactPoint(i), normal = v.controller.wheelContactNormal(i);
        if (point && normal && normal.y > .7 && v.controller.wheelIsInContact(i)) pool.sample(i, point, runtime.simTime, v.spec.wheels.visual[i]?.width ?? .26);
        else pool.breakTrack(i);
      });
    } else pool.breakTrack();
    if (resources.version !== pool.version) { geometry.attributes.position.needsUpdate = true; geometry.attributes.born.needsUpdate = true; resources.version = pool.version; }
    material.uniforms.now.value = runtime.simTime;
    runtime.skidMarkCount = pool.activeCount(runtime.simTime);
  });
  useEffect(() => () => { resources.geometry.dispose(); resources.material.dispose(); runtime.skidMarkCount = 0; }, [resources]);
  return <mesh name="tire-skid-marks" geometry={resources.geometry} material={resources.material} frustumCulled={false} renderOrder={2} />;
}
