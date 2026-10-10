import { useEffect, useRef, useState } from 'react';
import { input } from '../game/input/input';
import { ControlIcon } from './ControlIcon';
import { useGame } from '../app/store';
import { VEHICLES } from '../game/data/vehicles';
import { runtime } from '../game/core/runtime';
import { vehicleEntry } from '../game/vehicles/entry';
import { audio } from '../game/audio/audio';
import { KeyHint } from './KeyHint';
import { SHORTCUTS } from '../game/input/input';

export type ControlPreset = 'joystick' | 'pedals';

interface Props {
  preset: ControlPreset;
  showTouch: boolean;
  canRecover: boolean;
  reversing: boolean;
  onCamera: () => void;
  onHorn: () => void;
  onRecover: () => void;
  labels: { horn: string; brake: string; camera: string; recover: string; dragToLook: string; reverse: string };
}

/**
 * Full-screen gesture layer. The region where a pointer goes down owns it until release:
 * left zone → horizontal steering, right zone → camera orbit. Mouse drag anywhere → camera.
 * Acceleration/reverse use separate pedals so steering never changes the car's speed.
 * Buttons stop propagation, so pressing them never rotates the camera.
 */
export function TouchControls({ preset, showTouch, canRecover, reversing, onCamera, onHorn, onRecover, labels }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const joyHome = useRef<HTMLDivElement>(null);
  const lastTouchTap = useRef(-Infinity);
  const owners = useRef(new Map<number, { role: 'joy' | 'cam' | 'steer' | 'door'; ox: number; oy: number; lx: number; ly: number; radius: number; started: number }>());
  const [joy, setJoy] = useState<{ bx: number; by: number; kx: number; ky: number } | null>(null);
  const [hint, setHint] = useState(true);
  const t = useGame((s) => s.t);
  const muted = useGame((s) => s.save.settings.muted);
  const vehicleId = useGame((s) => s.save.equippedVehicleId);
  const [driverMode, setDriverMode] = useState(vehicleEntry.mode);
  const [doorBusy, setDoorBusy] = useState(vehicleEntry.active);
  const [drifting, setDrifting] = useState(false);
  useEffect(() => {
    const id = setInterval(() => { setDriverMode(vehicleEntry.mode); setDoorBusy(vehicleEntry.active); setDrifting(!!runtime.telemetry.drifting); }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const map = owners.current;
    const release = (id: number) => {
      const o = map.get(id);
      if (!o) return;
      map.delete(id);
      if (o.role === 'joy') {
        input.setSteering(0);
        input.joystick.active = false;
        setJoy(null);
      } else if (o.role === 'steer') {
        input.pedals.steer = 0;
      } else if (o.role === 'cam') {
        if (![...map.values()].some((v) => v.role === 'cam')) input.camera.dragging = false;
      }
    };
    const down = (e: PointerEvent) => {
      if (e.target !== el) return;
      const w = window.innerWidth;
      const isMouse = e.pointerType === 'mouse';
      let role: 'joy' | 'cam' | 'steer' | 'door' = 'cam';
      if (!isMouse) {
        if (preset === 'joystick' && e.clientX < w * 0.42 && e.clientY > window.innerHeight * 0.3) role = 'joy';
        if (preset === 'pedals' && e.clientX < w * 0.4 && e.clientY > window.innerHeight * 0.45) role = 'steer';
      } else if (e.button !== 0) return;
      if (input.sceneTap?.(e.clientX, e.clientY, false)) role = 'door';
      if ((role === 'joy' || role === 'steer') && [...map.values()].some(o => o.role === role)) return;
      el.setPointerCapture(e.pointerId);
      const home = joyHome.current?.getBoundingClientRect();
      // Leave room for the knob (42% diameter) inside the circle at full deflection.
      const radius = Math.max(16, (home?.width ?? 88) * 0.29 - 2);
      map.set(e.pointerId, { role, ox: e.clientX, oy: e.clientY, lx: e.clientX, ly: e.clientY, radius, started: performance.now() });
      if (role === 'joy') {
        input.joystick.active = true;
        setJoy({ bx: home ? home.x + home.width / 2 : e.clientX, by: home ? home.y + home.height / 2 : e.clientY, kx: 0, ky: 0 });
      } else if (role === 'cam') {
        input.camera.dragging = true;
        input.camera.lastInteraction = performance.now();
      }
      setHint(false);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const o = map.get(e.pointerId);
      if (!o) return;
      if (o.role === 'joy') {
        let dx = e.clientX - o.ox, dy = e.clientY - o.oy;
        const len = Math.hypot(dx, dy);
        if (len > o.radius) { dx *= o.radius / len; dy *= o.radius / len; }
        input.setSteering(dx / o.radius, -dy / o.radius);
        setJoy((old) => old ? { ...old, kx: dx, ky: dy } : null);
      } else if (o.role === 'steer') {
        input.pedals.steer = Math.max(-1, Math.min(1, (e.clientX - o.ox) / 70));
      } else if (o.role === 'cam') {
        input.addCameraDrag(e.clientX - o.lx, e.clientY - o.ly, performance.now());
      }
      o.lx = e.clientX;
      o.ly = e.clientY;
    };
    const up = (e: PointerEvent) => {
      const o = map.get(e.pointerId);
      if (o?.role === 'door' && e.type === 'pointerup' && Math.hypot(e.clientX - o.ox, e.clientY - o.oy) < 8 && performance.now() - o.started < 700) input.sceneTap?.(e.clientX, e.clientY, true);
      release(e.pointerId);
    };
    const lost = (e: PointerEvent) => release(e.pointerId);
    const releaseAll = () => {
      for (const id of [...map.keys()]) release(id);
      input.reset();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', lost);
    window.addEventListener('blur', releaseAll);
    window.addEventListener('orientationchange', releaseAll);
    document.addEventListener('visibilitychange', releaseAll);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', lost);
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('orientationchange', releaseAll);
      document.removeEventListener('visibilitychange', releaseAll);
      releaseAll();
    };
  }, [preset]);

  const hold = (on: (v: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      on(true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      on(false);
    },
    onPointerCancel: () => on(false),
    onLostPointerCapture: () => on(false),
  });
  // Browsers synthesize no click while another finger is down (e.g. holding the joystick),
  // so touch fires on pointerdown; the click that may follow is ignored. Mouse/keyboard keep onClick.
  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      e.preventDefault();
      lastTouchTap.current = performance.now();
      fn();
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      if (performance.now() - lastTouchTap.current < 600) return;
      fn();
    },
  });

  return (
    <>
      <div ref={layer} className="gesture-layer" data-testid="gesture-layer" />
      {preset === 'joystick' && (
        <div ref={joyHome} className="joy-home" aria-hidden style={{ visibility: showTouch ? undefined : 'hidden', opacity: joy ? 0 : undefined }}>
          <div className="joy-knob" />
          <span className="joy-label left">◀</span>
          <span className="joy-label right">▶</span>
          <span className="joy-label up">▲</span>
          <span className="joy-label down">▼</span>
        </div>
      )}
      {showTouch && joy && (
        <div className="joy-live" style={{ left: joy.bx, top: joy.by }} aria-hidden>
          <div className="joy-knob" style={{ transform: `translate(calc(-50% + ${joy.kx}px), calc(-50% + ${joy.ky}px))` }} />
        </div>
      )}
      {showTouch && preset === 'pedals' && (
        <>
          <div className="steer-pad" aria-hidden>
            ◀ ▶
          </div>
        </>
      )}
      {showTouch && (
        <div className="pedals" data-testid="drive-pedals">
          <button className="pedal gas" data-testid="accelerate" aria-label={t.accelerate} {...hold((v) => (input.pedals.gas = v ? 1 : 0))}>
            <ControlIcon name="accelerate" /><span>{t.speedUp}</span>
          </button>
          <button className="pedal reverse" data-testid="reverse" aria-label={labels.reverse} {...hold((v) => (input.pedals.brake = v ? 1 : 0))}>
            <ControlIcon name="reverse" /><span>{labels.reverse}</span>
          </button>
        </div>
      )}
      <div className={`util-buttons ${showTouch ? '' : 'desktop'}`}>
        <button className="util" aria-label={labels.horn} title={`${labels.horn} (H)`} {...tap(onHorn)}>
          <ControlIcon name="horn" /><span>{labels.horn}</span><KeyHint k={SHORTCUTS.horn} />
        </button>
        <button className="util" aria-label={labels.camera} title={`${labels.camera} (C)`} {...tap(onCamera)}>
          <ControlIcon name="camera" /><span>{labels.camera}</span><KeyHint k={SHORTCUTS.camera} />
        </button>
        <button className="util" data-testid="sound-toggle" aria-label={muted ? t.unmute : t.mute} aria-pressed={muted} {...tap(() => { useGame.getState().updateSettings({ muted: !muted }); audio.unlock(); })}>
          <ControlIcon name={muted ? 'muted' : 'sound'} /><span>{t.audio}</span><KeyHint k={SHORTCUTS.mute} />
        </button>
        {VEHICLES[vehicleId as keyof typeof VEHICLES]?.kind === 'car' && (
          <button className="util door-control" data-testid="car-door" aria-label={driverMode === 'outside' ? t.getIn : t.getOut} title={`${t.doorHint} (F)`} disabled={doorBusy} {...tap(() => input.emit('door'))}>
            <ControlIcon name="door" /><span>{driverMode === 'outside' ? t.getIn : t.getOut}</span><KeyHint k={SHORTCUTS.door} />
          </button>
        )}
        {canRecover && (
          <button className="util recover" aria-label={labels.recover} title={`${labels.recover} (R)`} {...tap(onRecover)}>
            <ControlIcon name="recover" /><span>{labels.recover}</span><KeyHint k={SHORTCUTS.recover} />
          </button>
        )}
      </div>
      {driverMode !== 'outside' && (
        <button className="power-brake" data-testid="power-brake" aria-label={t.powerBrake} title={`${t.powerBrakeHint} (Space / Shift)`} {...hold((v) => (input.brakeButton = v))}>
          <ControlIcon name="brake" /><span>{t.powerBrake}</span>
          <KeyHint k={SHORTCUTS.brake} />
        </button>
      )}
      {drifting && <div className="drift-badge" aria-live="polite">DRIFT</div>}
      {reversing && <div className="reverse-badge" title={labels.reverse} aria-label={labels.reverse}>R</div>}
      {showTouch && hint && (
        <div className="look-hint" aria-hidden>
          <div>👆 ↔</div>
          {labels.dragToLook}
        </div>
      )}
    </>
  );
}
