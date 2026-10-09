import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { runtime } from '../core/runtime';
import type { QualityPreset } from './quality';
import { mulberry32, range } from '../core/rng';

const SKY_TOP = new THREE.Color('#7cc4ee');
const SKY_HORIZON = new THREE.Color('#e3f4fb');

function SkyDome({ rain }: { rain: boolean }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: SKY_TOP.clone() }, horizon: { value: SKY_HORIZON.clone() } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h,0.8)),1.0); }',
      }),
    [],
  );
  useEffect(() => {
    mat.uniforms.top.value.set(rain ? '#8ea5b5' : SKY_TOP);
    mat.uniforms.horizon.value.set(rain ? '#c9d4db' : SKY_HORIZON);
  }, [rain, mat]);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => ref.current?.position.copy(camera.position));
  return (
    <mesh ref={ref} material={mat} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[1500, 24, 12]} />
    </mesh>
  );
}

function Clouds({ rain }: { rain: boolean }) {
  const mesh = useMemo(() => {
    const rng = mulberry32(5);
    const g = new THREE.SphereGeometry(1, 8, 6);
    const n = 26 * 5;
    const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.35 }), n);
    const mat = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r = range(rng, 300, 900);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const cy = range(rng, 110, 180);
      const s = range(rng, 14, 26);
      for (let j = 0; j < 5; j++) {
        const ox = (j - 2) * s * 0.75 + range(rng, -3, 3);
        const sc = s * (j === 2 ? 1 : 0.7) * range(rng, 0.8, 1.1);
        mat.compose(new THREE.Vector3(cx + ox, cy + (j === 2 ? s * 0.3 : 0), cz), new THREE.Quaternion(), new THREE.Vector3(sc, sc * 0.7, sc));
        m.setMatrixAt(k++, mat);
      }
    }
    m.frustumCulled = false;
    return m;
  }, []);
  useEffect(() => {
    (mesh.material as THREE.MeshStandardMaterial).color.set(rain ? '#b9c4cc' : '#ffffff');
    (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = rain ? 0.05 : 0.35;
  }, [rain, mesh]);
  return <primitive object={mesh} />;
}

/** Daylight lighting with a shadow camera that follows the player (plan §19.2 shadows). */
export function Environment({ rain, preset }: { rain: boolean; preset: QualityPreset }) {
  const { scene, gl } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const targetObj = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    scene.fog = new THREE.Fog(rain ? '#c3ced6' : '#d6eef7', 140, preset.drawDistance + 60);
    return () => {
      scene.fog = null;
    };
  }, [scene, rain, preset.drawDistance]);
  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    gl.shadowMap.enabled = preset.shadows;
    light.castShadow = preset.shadows;
    const shadow = light.shadow;
    // Three does not resize an existing shadow render target when mapSize changes.
    if (shadow.map && (!preset.shadows || shadow.map.width !== preset.shadowMapSize)) {
      shadow.map.dispose();
      shadow.map = null;
      shadow.mapPass?.dispose();
      shadow.mapPass = null;
    }
    shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    shadow.needsUpdate = true;
    gl.shadowMap.needsUpdate = true;
  }, [gl, preset.shadows, preset.shadowMapSize]);
  useEffect(() => {
    scene.add(targetObj);
    if (sun.current) sun.current.target = targetObj;
    return () => void scene.remove(targetObj);
  }, [scene, targetObj]);
  useFrame(() => {
    const p = runtime.pose;
    const s = sun.current;
    if (!s) return;
    if (gl.shadowMap.enabled !== preset.shadows) {
      gl.shadowMap.enabled = preset.shadows;
      s.castShadow = preset.shadows;
    }
    // Snap to a coarse grid to avoid shadow shimmering.
    const gx = Math.round(p.x / 2) * 2;
    const gz = Math.round(p.z / 2) * 2;
    s.position.set(gx + 40, 70, gz + 25);
    targetObj.position.set(gx, 0, gz);
  });
  return (
    <>
      <SkyDome rain={rain} />
      <Clouds rain={rain} />
      <hemisphereLight args={['#f2f9ff', '#efe2c8', rain ? 1.5 : 2.2]} />
      <ambientLight intensity={0.45} color="#fff4e2" />
      <directionalLight
        ref={sun}
        intensity={rain ? 0.9 : 1.7}
        color="#fff3dc"
        name="daylight-sun"
        castShadow={preset.shadows}
        shadow-mapSize-width={preset.shadowMapSize}
        shadow-mapSize-height={preset.shadowMapSize}
        shadow-camera-left={-55}
        shadow-camera-right={55}
        shadow-camera-top={55}
        shadow-camera-bottom={-55}
        shadow-camera-near={10}
        shadow-camera-far={180}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
    </>
  );
}
