import { useEffect, useRef, useState } from 'react';
import { input } from '../game/input/input';
import { ControlIcon } from './ControlIcon';

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
 * left zone → driving joystick (or steering pad), right zone → camera orbit. Mouse drag anywhere → camera.
 * Buttons stop propagation, so pressing them never rotates the camera.
 */
export function TouchControls({ preset, showTouch, canRecover, reversing, onCamera, onHorn, onRecover, labels }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const joyHome = useRef<HTMLDivElement>(null);
  const owners = useRef(new Map<number, { role: 'joy' | 'cam' | 'steer'; ox: number; oy: number; lx: number; ly: number; radius: number }>());
  const [joy, setJoy] = useState<{ bx: number; by: number; kx: number; ky: number } | null>(null);
  const [hint, setHint] = useState(true);

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
        input.setJoystick(0, 0);
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
      let role: 'joy' | 'cam' | 'steer' = 'cam';
      if (!isMouse) {
        if (preset === 'joystick' && e.clientX < w * 0.42 && e.clientY > window.innerHeight * 0.3) role = 'joy';
        if (preset === 'pedals' && e.clientX < w * 0.4 && e.clientY > window.innerHeight * 0.45) role = 'steer';
      } else if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      const home = joyHome.current?.getBoundingClientRect();
      // Leave room for the knob (42% diameter) inside the circle at full deflection.
      const radius = Math.max(16, (home?.width ?? 88) * 0.29 - 2);
      map.set(e.pointerId, { role, ox: e.clientX, oy: e.clientY, lx: e.clientX, ly: e.clientY, radius });
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
        let dx = e.clientX - o.ox;
        let dy = e.clientY - o.oy;
        const len = Math.hypot(dx, dy);
        if (len > o.radius) {
          dx = (dx / len) * o.radius;
          dy = (dy / len) * o.radius;
        }
        input.setJoystick(dx / o.radius, -dy / o.radius);
        setJoy((old) => old ? { ...old, kx: dx, ky: dy } : null);
      } else if (o.role === 'steer') {
        input.pedals.steer = Math.max(-1, Math.min(1, (e.clientX - o.ox) / 70));
      } else {
        input.addCameraDrag(e.clientX - o.lx, e.clientY - o.ly, performance.now());
      }
      o.lx = e.clientX;
      o.ly = e.clientY;
    };
    const up = (e: PointerEvent) => release(e.pointerId);
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
  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      fn();
    },
  });

  return (
    <>
      <div ref={layer} className="gesture-layer" data-testid="gesture-layer" />
      {preset === 'joystick' && (
        <div ref={joyHome} className="joy-home" aria-hidden style={{ visibility: showTouch ? undefined : 'hidden', opacity: joy ? 0 : undefined }}>
          <div className="joy-knob" />
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
          <div className="pedals">
            <button className="pedal brake" aria-label={labels.brake} {...hold((v) => (input.pedals.brake = v ? 1 : 0))}>
              {labels.brake}
            </button>
            <button className="pedal gas" aria-label="Gas" {...hold((v) => (input.pedals.gas = v ? 1 : 0))}>
              ▲
            </button>
          </div>
        </>
      )}
      <div className={`util-buttons ${showTouch ? '' : 'desktop'}`}>
        <button className="util" aria-label={labels.horn} title={`${labels.horn} (H)`} {...tap(onHorn)}>
          <ControlIcon name="horn" /><span>{labels.horn}</span>
        </button>
        {showTouch && preset === 'joystick' && (
          <button className="util brake" aria-label={labels.brake} {...hold((v) => (input.brakeButton = v))}>
            <ControlIcon name="brake" /><span>{labels.brake}</span>
          </button>
        )}
        <button className="util" aria-label={labels.camera} title={`${labels.camera} (C)`} {...tap(onCamera)}>
          <ControlIcon name="camera" /><span>{labels.camera}</span>
        </button>
        {canRecover && (
          <button className="util recover" aria-label={labels.recover} title={`${labels.recover} (R)`} {...tap(onRecover)}>
            <ControlIcon name="recover" /><span>{labels.recover}</span>
          </button>
        )}
      </div>
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
