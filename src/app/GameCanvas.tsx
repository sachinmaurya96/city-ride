import { Canvas, useThree } from '@react-three/fiber';
import { lazy, Suspense, useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import { Environment } from '../game/render/Environment';
import { runtime } from '../game/core/runtime';
import { pauseManager } from '../game/core/pause';
import { useGame } from './store';
import { debug, TEST_HOOKS } from './devHooks';
import { preloadWorld } from './preloadWorld';
import type { SafeRoadPose } from '../game/vehicles/vehicleController';
import type { VehicleId } from '../game/data/vehicles';
import type { resolveQuality } from '../game/render/quality';
import type { upgradeLevels } from '../game/progression/progression';

// Fetch the world and physics chunk together, only after Play. Garage needs just the renderer.
const WorldScene = lazy(async () => {
  const scene = await preloadWorld();
  return { default: scene.WorldScene };
});

function RendererLifecycle() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    runtime.renderer = gl;
    if (TEST_HOOKS) Object.assign(debug.extra, { gl, scene, camera, THREE });
    const lost = (e: Event) => { e.preventDefault(); pauseManager.add('CONTEXT_LOST'); };
    const restored = () => pauseManager.remove('CONTEXT_LOST');
    gl.domElement.addEventListener('webglcontextlost', lost);
    gl.domElement.addEventListener('webglcontextrestored', restored);
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', lost);
      gl.domElement.removeEventListener('webglcontextrestored', restored);
      if (runtime.renderer === gl) runtime.renderer = null;
    };
  }, [gl, scene, camera]);
  return null;
}

export interface GameCanvasProps {
  world: boolean;
  playing: boolean;
  paused: boolean;
  sceneReady: boolean;
  onReady: () => void;
  graphics: ReturnType<typeof resolveQuality>;
  dpr: number;
  rain: boolean;
  vehicleId: VehicleId;
  spawnNonce: number;
  spawn: SafeRoadPose;
  paint: string;
  upgrades: ReturnType<typeof upgradeLevels>;
  anchor: RefObject<THREE.Group | null>;
  seat: RefObject<THREE.Group | null>;
  autoRecenter: boolean;
}

export function GameCanvas(props: GameCanvasProps) {
  const appState = useGame(s => s.appState);
  return (
    <Canvas frameloop={appState === 'LOADING' || (props.playing && !props.paused) ? 'always' : 'demand'}
      shadows dpr={props.dpr}
      camera={{ fov: 60, near: .3, far: 1800, position: [props.spawn.x, 8, props.spawn.z - 12] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; gl.toneMappingExposure = 1; }}>
      <RendererLifecycle />
      <Environment rain={props.rain} preset={props.graphics} />
      <Suspense fallback={null}>{props.world && <WorldScene {...props} />}</Suspense>
    </Canvas>
  );
}
