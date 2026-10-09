import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { quality } from './quality';
import { mulberry32 } from '../core/rng';

const SIZE = 50;
const HEIGHT = 26;

/** Light rain: bounded streak field around the camera (density by quality; physics unaffected by preset). */
export function Rain() {
  const max = 1600;
  const { lines, pos, seeds } = useMemo(() => {
    const rng = mulberry32(17);
    const pos = new Float32Array(max * 6);
    const seeds = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) {
      seeds[i * 3] = rng() * SIZE - SIZE / 2;
      seeds[i * 3 + 1] = rng() * HEIGHT;
      seeds[i * 3 + 2] = rng() * SIZE - SIZE / 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#cfe3f2', transparent: true, opacity: 0.55, depthWrite: false }));
    lines.frustumCulled = false;
    return { lines, pos, seeds };
  }, []);
  useFrame(({ camera }, dt) => {
    const n = Math.min(max, quality.current.rainDrops);
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    for (let i = 0; i < n; i++) {
      seeds[i * 3 + 1] -= dt * 18;
      if (seeds[i * 3 + 1] < 0) seeds[i * 3 + 1] += HEIGHT;
      const x = cx + seeds[i * 3];
      const y = cy - 6 + seeds[i * 3 + 1];
      const z = cz + seeds[i * 3 + 2];
      pos.set([x, y, z, x + 0.05, y + 0.7, z + 0.03], i * 6);
    }
    lines.geometry.setDrawRange(0, n * 2);
    (lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  });
  return <primitive object={lines} />;
}
