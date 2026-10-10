import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type * as THREE from 'three';
import { input } from '../game/input/input';
import { runtime } from '../game/core/runtime';
import { pauseManager } from '../game/core/pause';
import { events } from '../game/core/events';
import { garageSpawn } from '../game/data/cityMap';
import { isPlayableVehicleId, VEHICLES, type VehicleId } from '../game/data/vehicles';
import { recoverySystem, recoverVehicle } from '../game/rules/recovery';
import { rides } from '../game/missions/rides';
import { busService } from '../game/missions/bus';
import { violations } from '../game/rules/violations';
import { audio } from '../game/audio/audio';
import { fuel } from '../game/vehicles/fuel';
import { requestDriverDoor } from '../game/vehicles/entry';
import { police } from '../game/rules/police';
import { ensureDailyBoard, paintFor, upgradeLevels } from '../game/progression/progression';
import { quality, renderPixelRatio, resolveQuality } from '../game/render/quality';
import { persistence, pendingConflict } from '../storage/persistence';
import { platform } from '../platform';
import { TouchControls } from '../ui/TouchControls';
import { Hud } from '../ui/Hud';
import { BootScreen, CancelConfirm, CityMapOverlay, ConflictOverlay, ControlsOverlay, CreditsOverlay, MainMenu, PauseMenu, Receipt, RotateOverlay, SaveBanner } from '../ui/Screens';
import { useGame } from './store';
import type { SafeRoadPose } from '../game/vehicles/vehicleController';
import { fmt } from '../i18n/strings';
import { lazyOverlay } from '../ui/lazy';

const GarageOverlay = lazyOverlay(() => import('../ui/Garage').then((m) => m.GarageOverlay));
const DailyOverlay = lazyOverlay(() => import('../ui/Daily').then((m) => m.DailyOverlay));
const StatsOverlay = lazyOverlay(() => import('../ui/Daily').then((m) => m.StatsOverlay));
const SettingsOverlay = lazyOverlay(() => import('../ui/Settings').then((m) => m.SettingsOverlay));
const BusDispatch = lazyOverlay(() => import('../ui/Garage').then((m) => m.BusDispatch));
const NoticeCard = lazyOverlay(() => import('../ui/Notice').then((m) => m.NoticeCard));
const GameCanvas = lazyOverlay(() => import('./GameCanvas').then(m => m.GameCanvas));
const preloadGame = () => { void import('./preloadWorld').then(m => m.preloadWorld()).catch(() => {}); void import('./GameCanvas'); };
const FuelStation = lazyOverlay(() => import('../ui/FuelStation').then(m => m.FuelStation));

class ErrorBoundary extends Component<{ children: ReactNode; onError: (e: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: Error) {
    this.props.onError(e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function usePaused() {
  const [p, setP] = useState(pauseManager.paused);
  useEffect(() => pauseManager.subscribe((v) => setP(v)), []);
  return p;
}

function TutorialHint() {
  const t = useGame((s) => s.t);
  const tut = useGame((s) => s.save.tutorial);
  const stage = useGame((s) => s.ride.stage);
  const tutorialRide = useGame((s) => s.ride.tutorial || !!s.ride.offer?.tutorial);
  const commit = useGame((s) => s.commit);
  if (tut.firstRideDone || tut.skipped) return null;
  const text =
    stage === 'IDLE'
      ? t.tutorialWelcome
      : stage === 'OFFERED'
        ? t.tutorialAccept
        : stage === 'TO_PICKUP'
          ? t.tutorialFollow
          : stage === 'TO_DROPOFF'
            ? t.tutorialDrop
            : null;
  if (!text || !tutorialRide && stage !== 'IDLE') return null;
  return (
    <details className="tutorial-hint" data-testid="tutorial-hint">
      <summary>💡 {t.drivingTip}</summary>
      <span>{text}</span>
      <button
        className="link"
        onClick={() => {
          const s = structuredClone(useGame.getState().save);
          s.tutorial.skipped = true;
          s.revision++;
          commit(s);
        }}
      >
        {t.skipTutorial}
      </button>
    </details>
  );
}

export function App() {
  const appState = useGame((s) => s.appState);
  const bootStage = useGame((s) => s.bootStage);
  const bootError = useGame((s) => s.bootError);
  const overlay = useGame((s) => s.overlay);
  const save = useGame((s) => s.save);
  const t = useGame((s) => s.t);
  const receipt = useGame((s) => s.save.pendingReceipts[0] ?? null);
  const notice = useGame((s) => s.notice);
  const portrait = useGame((s) => s.portrait);
  const weather = useGame((s) => s.weather);
  const passengerMoving = useGame((s) => s.ride.stage === 'BOARDING' || s.ride.stage === 'ALIGHTING');
  const spawnNonce = useGame((s) => s.spawnNonce);
  const settings = save.settings;
  const graphics = useMemo(() => resolveQuality({ quality: settings.quality, renderResolution: settings.renderResolution, shadows: settings.shadows, viewDistance: settings.viewDistance }), [settings.quality, settings.renderResolution, settings.shadows, settings.viewDistance]);
  const [screenDpr, setScreenDpr] = useState(() => window.devicePixelRatio || 1);
  const renderDpr = renderPixelRatio(graphics, settings.renderResolution, screenDpr);
  const paused = usePaused();
  const anchor = useRef<THREE.Group>(null);
  const seat = useRef<THREE.Group>(null);
  const [touch, setTouch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  const [canRecover, setCanRecover] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [canvasRequested, setCanvasRequested] = useState(false);
  const [worldRequested, setWorldRequested] = useState(false);
  const spawnRef = useRef<SafeRoadPose>(garageSpawn());

  // ---------- boot ----------
  const boot = useCallback(async () => {
    const st = useGame.getState();
    try {
      st.setBoot(0);
      await platform().initialize();
      if (platform().supportsStorage()) {
        const p = platform();
        persistence.setRemote({ name: p.id, load: () => p.loadProgress(), save: (json) => p.saveProgress(json) });
      }
      st.setBoot(1);
      const res = await persistence.load();
      let s = res.save ?? useGame.getState().save;
      if (res.notice === 'corrupt_recovered') st.toast(useGame.getState().t.saveRecovered, 'warn');
      if (res.notice === 'corrupt_reset') st.toast(useGame.getState().t.saveReset, 'warn');
      const serverTime = await platform().getServerTimeIfSupported();
      const daily = ensureDailyBoard(s, serverTime ?? Date.now());
      s = daily.save;
      if (res.conflict) {
        pendingConflict.value = res.conflict;
        useGame.getState().openOverlay('conflict');
      }
      if (!res.save) {
        // fresh profile: prefer the platform language when available
        const lang = platform().getLanguage();
        if (lang) s = { ...s, settings: { ...s.settings, language: lang.toLowerCase().startsWith('ru') ? 'ru' : 'en' } };
      }
      useGame.getState().commit(s, false);
      st.setBoot(4);
      useGame.getState().setApp('MAIN_MENU');
      platform().gameReady();
      // Most players tap Play within seconds: fetch the world while the menu is idle (skipped on Data Saver).
      const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
      if (!saveData) {
        const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
        if (idle) idle(preloadGame, { timeout: 1500 }); else setTimeout(preloadGame, 500);
      }
    } catch (e) {
      st.setBoot(0, e instanceof Error ? e.message : String(e));
      st.setApp('RECOVERABLE_ERROR');
    }
  }, []);
  useEffect(() => {
    void boot();
  }, [boot]);

  const onReady = useCallback(() => {
    if (sceneReadyRef.current) return;
    sceneReadyRef.current = true;
    setSceneReady(true);
    useGame.getState().setBoot(4);
    useGame.getState().setApp('PLAYING');
    platform().gameplayStart();
  }, []);
  const sceneReadyRef = useRef(false);

  // ---------- settings → runtime ----------
  useEffect(() => {
    quality.current = graphics;
  }, [graphics]);
  useEffect(() => {
    const update = () => setScreenDpr(window.devicePixelRatio || 1);
    const density = matchMedia(`(resolution: ${screenDpr}dppx)`);
    density.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      density.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [screenDpr]);
  useEffect(() => {
    input.steerSensitivity = settings.steerSensitivity;
    runtime.reducedMotion = settings.reducedMotion;
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
    document.documentElement.lang = settings.language;
  }, [settings.steerSensitivity, settings.reducedMotion, settings.uiScale, settings.language]);
  useEffect(() => {
    runtime.cameraMode = settings.cameraMode;
  }, [settings.cameraMode]);

  // ---------- pause reasons ----------
  const blocking = overlay !== null || !!receipt || (!!notice && !notice.warning);
  useEffect(() => pauseManager.set('USER_MENU', blocking), [blocking]);
  useEffect(() => pauseManager.set('NOT_PLAYING', appState !== 'PLAYING'), [appState]);
  useEffect(() => pauseManager.set('ROTATION', portrait), [portrait]);
  useEffect(() => {
    if (paused) {
      input.reset();
      input.enabled = false;
    } else input.enabled = true;
  }, [paused]);

  // ---------- lifecycle ----------
  useEffect(() => input.attach(), []);
  useEffect(() => audio.attach(), []);
  useEffect(() => audio.applySettings(settings), [settings]);
  useEffect(() => {
    audio.rain = weather === 'rain';
  }, [weather]);
  useEffect(() => platform().onAudio((on) => audio.setPlatformAudio(on)), []);
  useEffect(() => {
    const vis = () => {
      const hidden = document.visibilityState !== 'visible';
      pauseManager.set('HIDDEN_TAB', hidden);
      if (hidden) fuel.persist();
      if (hidden && rides.mission) rides.checkpoint(true);
      if (hidden && busService.active) busService.checkpoint(true);
    };
    // Phones/tablets play landscape only: lock on the first tap (lock needs fullscreen + a user gesture).
    const lockLandscape = () => {
      if (!matchMedia('(pointer: coarse)').matches) return;
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (!orientation?.lock) return;
      const lock = () => orientation.lock!('landscape').catch(() => {});
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) { void lock(); return; }
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(lock, lock);
    };
    window.addEventListener('pointerup', lockLandscape);
    const orient = () => useGame.getState().setPortrait(window.innerHeight > window.innerWidth * 1.05 && matchMedia('(pointer: coarse)').matches);
    orient();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('resize', orient);
    window.addEventListener('orientationchange', orient);
    const offPlat = platform().onPause((p) => pauseManager.set('PLATFORM', p));
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('resize', orient);
      window.removeEventListener('orientationchange', orient);
      window.removeEventListener('pointerup', lockLandscape);
      offPlat();
    };
  }, []);

  // ---------- simulation systems ----------
  useEffect(() => runtime.register('recovery', recoverySystem), []);
  useEffect(() => runtime.register('rides', (dt) => rides.tick(dt)), []);
  useEffect(() => runtime.register('bus', (dt) => busService.tick(dt)), []);
  useEffect(() => runtime.register('violations', (dt) => violations.step(dt)), []);
  useEffect(() => runtime.register('police', (dt) => police.step(dt)), []);
  useEffect(() => runtime.register('fuel', (dt) => fuel.step(dt)), []);
  useEffect(() => {
    const saveFuel = () => fuel.persist();
    window.addEventListener('pagehide', saveFuel);
    if (paused) fuel.persist();
    return () => window.removeEventListener('pagehide', saveFuel);
  }, [paused]);
  useEffect(() => {
    const id = setInterval(() => {
      setCanRecover(runtime.canRecover);
      setReversing(runtime.telemetry.reversing && Math.abs(runtime.telemetry.speed) > 0.05);
    }, 200);
    const daily = setInterval(() => {
      const st = useGame.getState();
      const r = ensureDailyBoard(st.save, Date.now());
      if (r.save !== st.save) st.commit(r.save, r.rolled);
      if (r.rolled) {
        st.toast(st.t.newDay, 'good');
        events.emit({ type: 'DAY_ROLLED_OVER' });
      }
    }, 30000);
    const onTouch = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') setTouch(true);
      else if (!matchMedia('(pointer: coarse)').matches) setTouch(false);
    };
    window.addEventListener('pointerdown', onTouch, true);
    return () => {
      clearInterval(id);
      clearInterval(daily);
      window.removeEventListener('pointerdown', onTouch, true);
    };
  }, []);

  useEffect(
    () =>
      events.on((e) => {
        const st = useGame.getState();
        if (e.type === 'LEVEL_UP') st.toast(fmt(st.t.levelUp, { level: e.level }), 'good');
      }),
    [],
  );

  // ---------- actions ----------
  const startPlaying = useCallback(() => {
    const st = useGame.getState();
    const s = st.save;
    if (s.mission && s.mission.kind === 'ride') {
      rides.restore(s.mission);
      spawnRef.current = s.mission.safePose ?? garageSpawn();
    } else if (s.mission && s.mission.kind === 'bus') {
      if (!busService.active) busService.restore(s.mission);
      spawnRef.current = s.mission.safePose ?? garageSpawn();
    } else if (rides.stage === 'IDLE' || rides.stage === 'COMPLETED') {
      spawnRef.current = runtime.lastSafePose ?? garageSpawn();
    }
    st.respawn();
    // Start downloads now rather than after the renderer has finished initialising.
    preloadGame();
    setCanvasRequested(true);
    setWorldRequested(true);
    if (sceneReadyRef.current) { st.setApp('PLAYING'); platform().gameplayStart(); }
    else { st.setBoot(3); st.setApp('LOADING'); }
    if (!s.tutorial.controlsSeen) st.openOverlay('controls');
  }, []);

  const toMenu = useCallback(() => {
    const st = useGame.getState();
    if (rides.mission) rides.checkpoint(true);
    if (busService.active) busService.checkpoint(true);
    st.openOverlay(null);
    st.setApp('MAIN_MENU');
    platform().gameplayStop();
  }, []);

  const closeControls = useCallback(() => {
    const st = useGame.getState();
    if (!st.save.tutorial.controlsSeen) {
      const s = structuredClone(st.save);
      s.tutorial.controlsSeen = true;
      s.revision++;
      st.commit(s);
    }
    st.closeOverlay();
  }, []);

  useEffect(
    () =>
      input.onAction((a) => {
        const st = useGame.getState();
        if (st.appState !== 'PLAYING') return;
        if (a === 'pause') {
          if (!st.overlay && !st.save.pendingReceipts.length) st.openOverlay('pause');
          return;
        }
        if (a === 'map') {
          if (!st.overlay) st.openOverlay('map', 'pause');
          return;
        }
        if (st.overlay) return;
        if (a === 'context') {
          if (st.save.pendingReceipts.length) rides.nextRide();
          else if (rides.stage === 'OFFERED') rides.accept();
        }
        if (pauseManager.paused) return;
        if (a === 'camera') {
          const next = runtime.cameraMode === 'chase' ? 'high' : runtime.cameraMode === 'high' ? 'eye' : 'chase';
          runtime.cameraMode = next;
          st.updateSettings({ cameraMode: next });
        }
        if (a === 'horn') events.emit({ type: 'HORN' });
        if (a === 'door') {
          const stage = st.ride.stage;
          if (stage === 'BOARDING' || stage === 'ALIGHTING' || fuel.refilling) return;
          const result = requestDriverDoor();
          if (result === 'moving') st.toast(st.t.stopToExit, 'info');
          if (result === 'far') st.toast(st.t.nearDoorToEnter, 'info');
          if (result === 'ok') input.reset();
        }
        if (a === 'recover') {
          if (recoverVehicle()) {
            rides.markRecovered();
            busService.markRecovered();
          }
        }
      }),
    [],
  );

  // ---------- vehicle ----------
  const vehicleId: VehicleId = isPlayableVehicleId(save.equippedVehicleId) ? save.equippedVehicleId : 'bike_basic';
  const lastVehicle = useRef(vehicleId);
  if (lastVehicle.current !== vehicleId) {
    // Changing vehicles happens in the garage: leave from a clear garage spawn point.
    lastVehicle.current = vehicleId;
    spawnRef.current = garageSpawn();
  }
  const upgrades = useMemo(() => upgradeLevels(save, vehicleId), [save, vehicleId]);
  const paint = paintFor(save, vehicleId);
  const showGame = appState === 'PLAYING';
  const showScene = canvasRequested || overlay === 'garage';
  useEffect(() => { if (overlay === 'garage') setCanvasRequested(true); }, [overlay]);

  return (
    <div className={`app ${touch ? 'touch-mode' : 'desktop-mode'}`} data-controls={settings.controls}>
      {showScene && (
        <div className="canvas-wrap">
          <ErrorBoundary
            onError={(e) => {
              useGame.getState().setBoot(0, e.message);
              useGame.getState().setApp('RECOVERABLE_ERROR');
            }}
          >
            <GameCanvas world={worldRequested} playing={showGame} paused={paused} sceneReady={sceneReady}
              onReady={onReady} graphics={graphics} dpr={renderDpr} rain={weather === 'rain'}
              vehicleId={vehicleId} spawnNonce={spawnNonce} spawn={spawnRef.current} paint={paint}
              upgrades={upgrades} anchor={anchor} seat={seat} autoRecenter={settings.autoRecenter} />
          </ErrorBoundary>
        </div>
      )}
      <div className="overlay">
        {showGame && (
          <>
            <TouchControls
              preset={settings.controls}
              showTouch={touch}
              canRecover={canRecover}
              reversing={reversing}
              onCamera={() => input.emit('camera')}
              onHorn={() => input.emit('horn')}
              onRecover={() => input.emit('recover')}
              labels={{ horn: t.horn, brake: t.brake, camera: t.camera, recover: t.recover, dragToLook: t.dragToLook, reverse: t.reverse }}
            />
            <Hud onPause={() => useGame.getState().openOverlay('pause')} tutorial={<TutorialHint />} />
            {!touch && !save.tutorial.firstRideDone && !passengerMoving && <div className="kbd-strip">{t.keyboardHint}</div>}
            {notice && <NoticeCard />}
            {receipt && !overlay && <Receipt />}
            {overlay === 'pause' && <PauseMenu onResume={() => useGame.getState().openOverlay(null)} onMainMenu={toMenu} />}
            {overlay === 'cancel' && <CancelConfirm onDone={() => useGame.getState().openOverlay(null)} />}
            {overlay === 'map' && <CityMapOverlay />}
            {overlay === 'controls' && <ControlsOverlay onClose={closeControls} />}
            {overlay === 'bus' && <BusDispatch />}
            {overlay === 'fuel' && <FuelStation />}
          </>
        )}
        {appState === 'MAIN_MENU' && !overlay && <MainMenu onPlay={startPlaying} />}
        {overlay === 'garage' && <GarageOverlay />}
        {overlay === 'daily' && <DailyOverlay />}
        {overlay === 'stats' && <StatsOverlay />}
        {overlay === 'settings' && <SettingsOverlay />}
        {overlay === 'credits' && <CreditsOverlay />}
        {overlay === 'conflict' && <ConflictOverlay />}
        {(appState === 'PLAYING' || appState === 'MAIN_MENU') && <SaveBanner />}
        {(appState === 'BOOT' || appState === 'LOADING' || appState === 'RECOVERABLE_ERROR') && (
          <BootScreen stage={bootStage} error={bootError} onRetry={() => window.location.reload()} />
        )}
        {portrait && showGame && !overlay && !receipt && <RotateOverlay />}
      </div>
    </div>
  );
}

export { VEHICLES };
