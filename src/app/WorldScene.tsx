import { Physics } from '@react-three/rapier';
import { useEffect } from 'react';
import { City } from '../game/world/City';
import { PlayerVehicle } from '../game/vehicles/PlayerVehicle';
import { CameraRig } from '../game/camera/CameraRig';
import { RideVisuals } from '../game/missions/RideVisuals';
import { Rain } from '../game/render/Rain';
import { GameSystems } from '../game/GameSystems';
import type { GameCanvasProps } from './GameCanvas';

/** Wait for Physics and its colliders to mount before accepting driving input. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    const frame = requestAnimationFrame(onReady);
    return () => cancelAnimationFrame(frame);
  }, [onReady]);
  return null;
}

export function WorldScene(p: GameCanvasProps) {
  return <>
    {p.rain && <Rain />}
    <Physics timeStep={1 / 60} paused={p.paused}>
      <City />
      <PlayerVehicle key={`${p.vehicleId}-${p.spawnNonce}`} vehicleId={p.vehicleId} paint={p.paint}
        upgrades={p.upgrades} rain={p.rain} spawn={p.spawn} anchor={p.anchor} seatAnchor={p.seat} />
      <CameraRig anchor={p.anchor} autoRecenter={p.autoRecenter} />
      <RideVisuals seat={p.seat} />
      {p.sceneReady && <GameSystems />}
      <ReadySignal onReady={p.onReady} />
    </Physics>
  </>;
}
