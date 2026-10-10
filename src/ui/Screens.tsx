import { ASSET_CREDITS } from '../game/data/assetCredits';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useGame } from '../app/store';
import { fuel } from '../game/vehicles/fuel';
import { rides, nav } from '../game/missions/rides';
import { busService } from '../game/missions/bus';
import { runtime } from '../game/core/runtime';
import { claimWelcomeBonus, levelProgress, nextVehicleGoal, WELCOME_BONUS } from '../game/progression/progression';
import { VEHICLES } from '../game/data/vehicles';
import { fmt, money } from '../i18n/strings';
import { drawMap } from './mapDraw';
import { pendingConflict } from '../storage/persistence';
import type { SaveData } from '../storage/schema';
import { CashLevel } from './Hud';
import { ControlIcon } from './ControlIcon';
import { SPLASH_CARS } from './Splash';

/** Accessible modal: traps focus, Escape closes (when closable), restores focus on close. */
export function Modal({ children, onClose, label, className = '', testId }: { children: ReactNode; onClose?: () => void; label: string; className?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    // Focusing a bottom button must not scroll tall dialogs past their title on short screens.
    first?.focus({ preventScroll: true });
    if (el) el.scrollTop = 0;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const a = f[0];
        const b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.stopPropagation()}>
      <div ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

export function Receipt() {
  const t = useGame((s) => s.t);
  const receipt = useGame((s) => s.save.pendingReceipts[0] ?? null);
  const save = useGame((s) => s.save);
  const [adBusy, setAdBusy] = useState(false);
  if (!receipt) return null;
  const goal = nextVehicleGoal(save);
  const lp = levelProgress(save.totalXP);
  const title = t[receipt.title as 'rideCompleted'] ?? receipt.title;
  const mood = receipt.stars >= 5 ? t.smoothRide : receipt.stars >= 3 ? t.goodRide : t.bumpyRide;
  const adAmount = Math.round(receipt.baseFare * 0.5);
  const showAd = (receipt.kind === 'ride' || receipt.kind === 'bus') && !receipt.rewardedClaimed && adAmount > 0;
  const onAd = async () => {
    setAdBusy(true);
    const { requestRewardedBonus } = await import('../platform/ads');
    await requestRewardedBonus(receipt.id);
    setAdBusy(false);
  };
  return (
    <Modal label={title} className="receipt" testId="receipt">
      <div className="check">✓</div>
      <h2>{title}</h2>
      {receipt.kind !== 'daily_carryover' && (
        <div className="route-line">
          {receipt.from} → {receipt.to}
        </div>
      )}
      {receipt.stars > 0 && (
        <>
          <div className="stars big" aria-label={`${receipt.stars} / 5`}>
            {'★'.repeat(receipt.stars)}
            <span className="dim">{'★'.repeat(5 - receipt.stars)}</span>
          </div>
          <div className="mood">{mood}</div>
        </>
      )}
      <div className="lines">
        {receipt.lines.map((l, i) => (
          <div key={i} className={`line ${l.amount < 0 ? 'neg' : i > 0 ? 'pos' : ''}`}>
            <span>{t.lines[l.label] ?? l.label}</span>
            <b>{i > 0 && l.amount > 0 ? '+' : ''}{money(l.amount)}</b>
          </div>
        ))}
        <div className="line total">
          <span>{t.youEarned}</span>
          <b data-testid="receipt-net">{money(receipt.net)}</b>
        </div>
      </div>
      <div className="xp-chip">
        ⭐ +{receipt.xp} XP · {t.level} {lp.level}
        {receipt.passengers > 0 && (
          <span className="muted">
            {' '}· {save.lifetime.jobs} {t.successfulRides}
          </span>
        )}
      </div>
      {goal && (
        <div className="goal">
          <div className="goal-row">
            <span>
              {t.nextVehicle}: <b>{VEHICLES[goal.id].name}</b>
            </span>
            <span>
              {money(Math.min(save.wallet, goal.price))} / {money(goal.price)}
            </span>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, (save.wallet / goal.price) * 100)}%` }} />
          </div>
          {lp.level < goal.level && <small className="muted">{fmt(t.reachLevel, { level: goal.level })}</small>}
        </div>
      )}
      <button
        className="btn primary"
        onClick={() => {
          rides.nextRide();
          // natural break: interstitial policy (≥3 jobs, ≥180 s apart) decides; never blocks the next ride
          void import('../platform/ads').then((m) => m.maybeInterstitial());
        }}
        data-testid="next-ride"
      >
        {t.nextRide} →
      </button>
      {showAd && (
        <>
          <button className="btn outline" disabled={adBusy} onClick={onAd} data-testid="ad-bonus">
            ▶ {fmt(t.watchAdBonus, { amount: money(adAmount) })}
          </button>
          <small className="muted center">{t.optionalBonus}</small>
        </>
      )}
    </Modal>
  );
}

export function MainMenu({ onPlay }: { onPlay: () => void }) {
  const t = useGame((s) => s.t);
  const save = useGame((s) => s.save);
  const open = useGame((s) => s.openOverlay);
  const started = save.lifetime.jobs > 0 || !!save.mission || save.tutorial.firstRideDone;
  const vehicle = VEHICLES[save.equippedVehicleId as keyof typeof VEHICLES];
  return (
    <div className="main-menu" data-testid="main-menu" style={{ '--menu-cover': `url(${SPLASH_CARS[0].src})` } as React.CSSProperties}>
      <div className="menu-card">
        <div className="wordmark">
          <span className="w1">CITY</span> <span className="w2">RIDE</span>
          <div className="w3">{t.subtitle}</div>
        </div>
        <CashLevel />
        <div className="menu-vehicle">{vehicle?.name}</div>
        <button className="btn primary big" onClick={onPlay} data-testid="play">
          {started ? t.continue : t.play}
        </button>
        <div className="menu-grid">
          <button className="btn tile" onClick={() => open('garage')} data-testid="menu-garage">
            <ControlIcon name="garage" /> {t.garage}
          </button>
          <button className="btn tile" onClick={() => open('daily')} data-testid="menu-daily">
            <ControlIcon name="tasks" /> {t.dailyTasks}
          </button>
          <button className="btn tile" onClick={() => open('stats')} data-testid="menu-stats">
            <ControlIcon name="stats" /> {t.statistics}
          </button>
          <button className="btn tile" onClick={() => open('settings')} data-testid="menu-settings">
            <ControlIcon name="settings" /> {t.settings}
          </button>
        </div>
        <button className="link" onClick={() => open('credits')}>
          {t.credits}
        </button>
      </div>
    </div>
  );
}

export function PauseMenu({ onResume, onMainMenu }: { onResume: () => void; onMainMenu: () => void }) {
  const t = useGame((s) => s.t);
  const open = useGame((s) => s.openOverlay);
  const stage = useGame((s) => s.ride.stage);
  const hasJob = stage === 'TO_PICKUP' || stage === 'TO_DROPOFF' || stage === 'BUS' || stage === 'BOARDING' || stage === 'ALIGHTING';
  return (
    <Modal label={t.paused} onClose={onResume} className="pause" testId="pause-menu">
      <h2>{t.paused}</h2>
      <button className="btn primary" onClick={onResume} data-testid="resume">
        ▶ {t.resume}
      </button>
      <button className="btn" onClick={() => open('map', 'pause')}>
        <ControlIcon name="map" /> {t.cityMap}
      </button>
      <button className="btn" onClick={() => open('daily', 'pause')}>
        <ControlIcon name="tasks" /> {t.dailyTasks}
      </button>
      <button className="btn" onClick={() => open('garage', 'pause')}>
        <ControlIcon name="garage" /> {t.garage}
      </button>
      <button className="btn" onClick={() => open('settings', 'pause')}>
        <ControlIcon name="settings" /> {t.settings}
      </button>
      <button className="btn" onClick={() => open('controls', 'pause')}>
        🎮 {t.controls}
      </button>
      {hasJob && (
        <button className="btn danger-outline" onClick={() => open('cancel', 'pause')} data-testid="cancel-job">
          ✖ {t.cancelJob}
        </button>
      )}
      <button className="btn ghost" onClick={onMainMenu} data-testid="to-menu">
        {t.mainMenu}
      </button>
    </Modal>
  );
}

export function CancelConfirm({ onDone }: { onDone: () => void }) {
  const t = useGame((s) => s.t);
  const close = useGame((s) => s.closeOverlay);
  const stage = useGame((s) => s.ride.stage);
  return (
    <Modal label={t.cancelJob} onClose={close} className="small" testId="cancel-confirm">
      <h3>{t.cancelJob}</h3>
      <p>{stage === 'BUS' ? t.cancelBusConfirm : t.cancelConfirm}</p>
      <div className="row">
        <button className="btn ghost" onClick={close}>
          {t.no}
        </button>
        <button
          className="btn danger"
          data-testid="cancel-yes"
          onClick={() => {
            rides.cancel();
            busService.cancel();
            onDone();
          }}
        >
          {t.yes}
        </button>
      </div>
    </Modal>
  );
}

export function CityMapOverlay() {
  const t = useGame((s) => s.t);
  const close = useGame((s) => s.closeOverlay);
  const ref = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = ref.current;
    const area = viewport.current;
    if (!c || !area) return;
    const draw = () => {
      const size = Math.max(1, Math.min(area.clientWidth, area.clientHeight, 640));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
      c.style.width = `${size}px`;
      c.style.height = `${size}px`;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const route = fuel.navigation ?? nav;
      drawMap(
        ctx,
        { cx: 0, cz: 0, scale: size / 1060, rotation: 0, width: size, height: size },
        {
          route: route.active ? route.route : null,
          routeFrom: route.along,
          routeColor: route.target === 'pickup' ? '#d5eaff' : '#36ceff',
          target: route.active && route.targetBay ? { x: route.targetBay.x, z: route.targetBay.z, color: route.target === 'pickup' ? '#d5eaff' : '#36ceff', icon: route.target === 'fuel' ? '⛽' : route.target === 'pickup' ? '👤' : '⚑' } : null,
          player: runtime.pose,
          labels: true,
        },
      );
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  return (
    <Modal label={t.cityMap} onClose={close} className="map-modal" testId="city-map">
      <div className="modal-head">
        <h2>🗺️ {t.cityMap}</h2>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className="map-viewport" ref={viewport}><canvas ref={ref} /></div>
      <div className="legend">
        <span>
          <i style={{ background: '#36ceff' }} /> You
        </span>
        <span>
          <i style={{ background: '#d5eaff' }} /> {t.pickup}
        </span>
        <span>
          <i style={{ background: '#36ceff' }} /> {t.dropoff}
        </span>
      </div>
    </Modal>
  );
}

export function ControlsOverlay({ onClose }: { onClose: () => void }) {
  const t = useGame((s) => s.t);
  return (
    <Modal label={t.controls} onClose={onClose} className="controls-modal" testId="controls">
      <h2>{t.controls}</h2>
      <div className="controls-grid">
        <div className="ctl-left">
          <h3>{t.leftDrive}</h3>
          <div className="ctl-joy">
            <span>◀ · ▶</span>
            <div className="joy-demo">
              <div />
            </div>
            <span>{t.sensitivity}</span>
          </div>
          <small>{t.releaseToSlow}</small>
        </div>
        <div className="ctl-right">
          <h3>{t.rightLook}</h3>
          <div className="ctl-drag">👆 ⟲</div>
          <small>{t.accelerate} · {t.brakeReverse}<br />{t.dragToLook}</small>
        </div>
      </div>
      <p className="kbd-hint">⌨️ {t.keyboardHint}</p>
      <p className="kbd-hint">{t.powerBrake}: {t.powerBrakeHint}. {t.doorHint}.</p>
      <button className="btn primary" onClick={onClose} data-testid="controls-ok">
        {t.gotIt}
      </button>
    </Modal>
  );
}

export function RotateOverlay() {
  const t = useGame((s) => s.t);
  return (
    <div className="rotate" role="alertdialog" aria-label={t.rotateTitle}>
      <div className="phone">📱</div>
      <h2>{t.rotateTitle}</h2>
      <p>{t.rotateBody}</p>
    </div>
  );
}

export function CreditsOverlay() {
  const t = useGame((s) => s.t);
  const close = useGame((s) => s.closeOverlay);
  return (
    <Modal label={t.credits} onClose={close} className="small" testId="credits">
      <h2>{t.credits}</h2>
      <p>{t.creditsBody}</p>
      {ASSET_CREDITS.map((credit) => <p className="muted" key={credit.source}>
        <a href={credit.source} target="_blank" rel="noreferrer">{credit.title} — {credit.author}</a>
        {' · '}<a href={credit.licenseUrl} target="_blank" rel="noreferrer">{credit.license}</a>
      </p>)}
      <p className="muted">Fast 72, Police Cruiser, Classic Sport — supplied GLB files; no author/license metadata embedded.</p>
      <p className="muted">
        {t.version} {import.meta.env.VITE_APP_VERSION ?? '0.1.0'}
      </p>
      <button className="btn primary" onClick={close}>
        {t.close}
      </button>
    </Modal>
  );
}

/** Non-blocking notice when saving is unavailable or failing (never claims "Saved" falsely). */
/** One-time starter cash, shown over the main menu until claimed. */
export function WelcomeBonus() {
  const t = useGame((s) => s.t);
  const claimed = useGame((s) => s.save.welcomeBonusClaimed);
  // Browser-test builds start from a known wallet unless a test opts in with ?welcome=1.
  const hiddenInTests = import.meta.env.VITE_E2E === '1' && !new URLSearchParams(location.search).has('welcome');
  if (claimed || hiddenInTests) return null;
  const claim = () => {
    const st = useGame.getState();
    st.commit(claimWelcomeBonus(st.save, Date.now()), true);
    st.toast(fmt(t.welcomeClaimed, { amount: money(WELCOME_BONUS) }), 'good');
  };
  return (
    <Modal label={t.welcomeTitle} onClose={claim} className="small welcome-bonus" testId="welcome-bonus">
      <div className="welcome-coin" aria-hidden>🎁</div>
      <h2>{t.welcomeTitle}</h2>
      <p className="welcome-amount">{money(WELCOME_BONUS)}</p>
      <p>{t.welcomeBody}</p>
      <button className="btn primary" onClick={claim} data-testid="claim-welcome">{fmt(t.welcomeClaim, { amount: money(WELCOME_BONUS) })}</button>
    </Modal>
  );
}

export function SaveBanner() {
  const t = useGame((s) => s.t);
  const status = useGame((s) => s.saveStatus);
  if (status !== 'error' && status !== 'unavailable') return null;
  return (
    <div className="save-banner" role="status" data-testid="save-banner">
      ⚠️ {status === 'unavailable' ? t.saveUnavailable : t.saveError}
    </div>
  );
}

/** Two unrelated progress chains (device vs platform): the player chooses; wallets are never merged. */
export function ConflictOverlay() {
  const t = useGame((s) => s.t);
  const c = pendingConflict.value;
  const choose = (s: SaveData) => {
    pendingConflict.value = null;
    const st = useGame.getState();
    st.commit({ ...s, revision: Math.max(c?.local.revision ?? 0, c?.remote.revision ?? 0) + 1, updatedAt: Date.now() }, true);
    st.openOverlay(null);
  };
  if (!c) return null;
  const card = (label: string, s: SaveData, id: string) => (
    <button className="btn tile conflict-card" onClick={() => choose(s)} data-testid={id}>
      <b>{label}</b>
      <span>
        {money(s.wallet)} · {t.level} {levelProgress(s.totalXP).level} · {s.lifetime.jobs} {t.jobs}
      </span>
    </button>
  );
  return (
    <Modal label={t.conflictTitle} className="small" testId="conflict">
      <h2>{t.conflictTitle}</h2>
      <p>{t.conflictBody}</p>
      {card(t.thisDevice, c.local, 'conflict-local')}
      {card(t.cloud, c.remote, 'conflict-remote')}
    </Modal>
  );
}
