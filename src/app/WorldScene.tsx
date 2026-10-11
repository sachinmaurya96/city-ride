import { Physics } from '@react-three/rapier';
import { memo, useEffect } from 'react';
import { City } from '../game/world/City';
import { PlayerVehicle } from '../game/vehicles/PlayerVehicle';
import { CameraRig } from '../game/camera/CameraRig';
import { RideVisuals } from '../game/missions/RideVisuals';
import { Rain } from '../game/render/Rain';
import { GameSystems } from '../game/GameSystems';
import type { GameCanvasProps } from './GameCanvas';
import { VEHICLES } from '../game/data/vehicles';
import { useImportedModel } from '../game/render/useImportedModel';
import { useGame } from './store';
import { streamWorldAssets } from '../game/world/worldAssets';

/** Wait for Physics and its colliders to mount before accepting driving input. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    // Allow a complete frame with the actual vehicle and essential city before revealing play.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(onReady); });
    return () => cancelAnimationFrame(frame);
  }, [onReady]);
  return null;
}

export const WorldScene = memo(function WorldScene(p: GameCanvasProps) {
  const spec = VEHICLES[p.vehicleId];
  const model = useImportedModel(spec);
  const appState = useGame(s => s.appState);
  useEffect(() => {
    if (appState !== 'PLAYING' || p.paused) return;
    const controller = new AbortController();
    void streamWorldAssets(controller.signal);
    return () => controller.abort();
  }, [appState, p.paused]);
  const vehicleReady = !spec.importedModel || model?.status === 'ready';
  if (model?.status === 'error') throw new Error(useGame.getState().t.carLoadFailed);
  return <>
    {p.rain && <Rain />}
    <Physics timeStep={1 / 60} paused={p.paused}>
      <City />
      {vehicleReady && <PlayerVehicle key={`${p.vehicleId}-${p.spawnNonce}`} vehicleId={p.vehicleId} paint={p.paint}
        upgrades={p.upgrades} rain={p.rain} spawn={p.spawn} anchor={p.anchor} seatAnchor={p.seat} />}
      <CameraRig anchor={p.anchor} autoRecenter={p.autoRecenter} />
      <RideVisuals seat={p.seat} />
      {p.sceneReady && <GameSystems />}
      {vehicleReady && appState === 'LOADING' && <ReadySignal key={`${p.vehicleId}-${p.spawnNonce}`} onReady={p.onReady} />}
    </Physics>
  </>;
});
