import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { VehicleSpec } from '../data/vehicles';
import { runtime } from '../core/runtime';
import { input } from '../input/input';
import { vehicleEntry } from './entry';
import type { DriveInput } from './vehicleController';

/** Throttle must be held this long (s) above FLAME_SPEED before the exhaust starts to burn. */
const FLAME_HOLD = .8;
const FLAME_SPEED = 25 / 3.6;

/** Soft radial sprite shared by brake glows and flames (additive, so it tolerates small position mismatches on imported bodies). */
function glowTexture() {
  const size = 64, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!, g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Red brake lamps while braking, and exhaust flames during sustained full-throttle runs (cars only). */
export function CarEffects({ spec }: { spec: VehicleSpec }) {
  const heavy = spec.height > 2.4;
  const layout = useMemo(() => ({
    rearZ: -spec.length / 2 + .02,
    lampY: heavy ? 1.1 : Math.min(1.05, spec.height * .62),
    lampX: spec.width * .36,
    pipeY: heavy ? .55 : .3,
    pipeX: spec.width * .26,
  }), [spec, heavy]);
  const texture = useMemo(glowTexture, []);
  const lampMat = useMemo(() => new THREE.SpriteMaterial({ map: texture, color: '#ff1a1a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }), [texture]);
  const flameMat = useMemo(() => new THREE.SpriteMaterial({ map: texture, color: '#ff8a1f', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }), [texture]);
  const coreMat = useMemo(() => new THREE.SpriteMaterial({ map: texture, color: '#6fb7ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }), [texture]);
  useEffect(() => () => { texture.dispose(); lampMat.dispose(); flameMat.dispose(); coreMat.dispose(); }, [texture, lampMat, flameMat, coreMat]);
  const flames = useRef<(THREE.Sprite | null)[]>([]);
  const cores = useRef<(THREE.Sprite | null)[]>([]);
  const state = useMemo(() => ({ brake: 0, hold: 0, flame: 0, pop: 0, drive: { steer: 0, throttle: 0, brake: 0, handbrake: false } as DriveInput }), []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, .1), tel = runtime.telemetry, seated = vehicleEntry.mode === 'seated';
    input.getDrive(state.drive);
    const d = state.drive;
    // Brake lamps: any braking request, plus the automatic hold when stopped with the brake pedal down.
    const braking = seated && (d.brake > .05 || !!d.powerBrake || d.handbrake);
    state.brake += ((braking ? 1 : 0) - state.brake) * Math.min(1, dt * 18);
    lampMat.opacity = state.brake * .95;
    // Exhaust fire: sustained throttle at speed; brief pops when lifting off.
    const pushing = seated && d.throttle > .6 && d.brake < .05 && tel.speed > FLAME_SPEED;
    state.hold = pushing ? state.hold + dt : 0;
    const prev = state.flame;
    state.flame += ((state.hold > FLAME_HOLD ? 1 : 0) - state.flame) * Math.min(1, dt * (pushing ? 6 : 10));
    if (prev > .6 && !pushing) state.pop = .35;
    state.pop = Math.max(0, state.pop - dt);
    const t = runtime.simTime, intensity = Math.max(state.flame, state.pop > 0 ? 1 : 0);
    flameMat.opacity = intensity * (.75 + Math.random() * .25);
    coreMat.opacity = intensity * .9;
    // Each pipe: a blue-white core, an orange body and a fading tongue trailing behind.
    flames.current.forEach((s, i) => {
      if (!s) return;
      s.visible = intensity > .02;
      const tongue = i % 2, flicker = .75 + Math.sin(t * 47 + i * 2.1) * .15 + Math.random() * .3, len = (state.pop > 0 ? 1.6 : 1) * flicker;
      const size = (tongue ? .55 : .75) * flicker * (state.pop > 0 ? 1.3 : 1);
      s.scale.set(size, size * (tongue ? .8 : .9), 1);
      s.position.z = layout.rearZ - (tongue ? .55 + len * .45 : .2 + len * .15);
    });
    cores.current.forEach((s) => { if (s) { s.visible = intensity > .02; s.scale.setScalar(.26 + Math.random() * .08); } });
  });
  return (
    <group name="car-effects">
      {[1, -1].map((side) => (
        <sprite key={`lamp${side}`} name="brake-light" material={lampMat} position={[side * layout.lampX, layout.lampY, layout.rearZ - .03]} scale={[.85, .45, 1]} renderOrder={5} />
      ))}
      {[1, -1].map((side, i) => (
        <group key={`pipe${side}`} position={[side * layout.pipeX, layout.pipeY, 0]}>
          <sprite ref={(s) => void (flames.current[i * 2] = s)} name="exhaust-flame" material={flameMat} position={[0, 0, layout.rearZ - .2]} visible={false} renderOrder={5} />
          <sprite ref={(s) => void (flames.current[i * 2 + 1] = s)} name="exhaust-flame-tongue" material={flameMat} position={[0, 0, layout.rearZ - .6]} visible={false} renderOrder={5} />
          <sprite ref={(s) => void (cores.current[i] = s)} name="exhaust-core" material={coreMat} position={[0, 0, layout.rearZ - .08]} visible={false} renderOrder={6} />
        </group>
      ))}
    </group>
  );
}
