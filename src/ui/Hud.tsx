import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useGame } from '../app/store';
import { runtime } from '../game/core/runtime';
import { nav, rides, AVATARS } from '../game/missions/rides';
import { levelProgress } from '../game/progression/progression';
import { fmt, meters, money } from '../i18n/strings';
import { drawMap } from './mapDraw';
import { busDoor } from '../game/missions/bus';
import { VEHICLES } from '../game/data/vehicles';
import { fuel, FUEL } from '../game/vehicles/fuel';
import { ControlIcon } from './ControlIcon';
import { KeyHint } from './KeyHint';
import { SHORTCUTS } from '../game/input/input';

/** Poll a value from the simulation at a limited rate (never per-frame React updates). */
export function usePoll<T>(fn: () => T, ms = 100, eq: (a: T, b: T) => boolean = Object.is): T {
  const [v, setV] = useState(fn);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const id = setInterval(() => {
      const nv = fnRef.current();
      setV((old) => (eq(old, nv) ? old : nv));
    }, ms);
    return () => clearInterval(id);
  }, [ms, eq]);
  return v;
}

const shallow = <T extends object>(a: T, b: T) => {
  for (const k in a) if (a[k] !== b[k]) return false;
  return true;
};

export function CashLevel() {
  const wallet = useGame((s) => s.save.wallet);
  const xp = useGame((s) => s.save.totalXP);
  const t = useGame((s) => s.t);
  const lp = levelProgress(xp);
  return (
    <div className="cash-level" data-testid="cash">
      <div className="cash">
        <span className="wallet-ico"><ControlIcon name="wallet" /></span>
        <b data-testid="wallet" title={money(wallet)}>{money(wallet)}</b>
      </div>
      <div className="lvl">
        <span className="level-label" title={`${t.level} ${lp.level}`}>
          <span>{t.level}</span><b>{lp.level}</b>
        </span>
        <div className="bar">
          <i style={{ width: `${Math.round(lp.frac * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function Instruction() {
  const t = useGame((s) => s.t);
  const ride = useGame((s) => s.ride);
  const n = usePoll(() => { const route = fuel.navigation ?? nav; return { active: route.active, ins: route.instruction, d: Math.round(route.instructionDist / 10) * 10, rem: Math.round(route.remaining / 10) * 10, target: route.target, station: fuel.navigation?.targetBay.name }; }, 200, shallow);
  if (!n.active) return null;
  const head =
    n.ins === 'left'
      ? fmt(t.turnLeftIn, { d: meters(n.d) })
      : n.ins === 'right'
        ? fmt(t.turnRightIn, { d: meters(n.d) })
        : n.ins === 'stop'
          ? t.stopInBay
          : n.ins === 'arriving'
            ? t.arriving
            : fmt(t.continueFor, { d: meters(n.d) });
  const arrow = n.ins === 'left' ? '↰' : n.ins === 'right' ? '↱' : n.ins === 'stop' || n.ins === 'arriving' ? '⛳' : '↑';
  const hasDistance = n.ins !== 'stop' && n.ins !== 'arriving';
  const action = hasDistance ? head.replace(meters(n.d), '').trim() : head;
  const sub =
    n.target === 'fuel'
      ? n.station ?? ''
      : n.target === 'pickup'
      ? fmt(t.pickUpName, { name: ride.passengerName })
      : n.target === 'dropoff'
        ? fmt(t.dropOffAt, { place: ride.dropName })
        : ride.bus
          ? fmt(t.stopOf, { n: ride.bus.nextStop + 1, total: ride.bus.stopNames.length, name: ride.bus.stopNames[ride.bus.nextStop] })
          : '';
  const destination = n.target === 'fuel' ? n.station ?? '' : n.target === 'pickup' ? ride.passengerName : n.target === 'dropoff' ? ride.dropName : ride.bus?.stopNames[ride.bus.nextStop] ?? '';
  return (
    <div className={`instruction ${n.target}`} data-testid="instruction">
      <div className="ins-arrow">{arrow}</div>
      <div className="ins-copy">
        <div className="ins-main" title={head}><span>{action}</span>{hasDistance && <b>{meters(n.d)}</b>}</div>
        <div className="ins-sub">
          <span className="ins-target" title={sub}>{n.target === 'fuel' ? '⛽' : n.target === 'pickup' ? '📍' : n.target === 'bus' ? '🚏' : '🏁'} {destination}</span>
          <b>{meters(n.rem)}</b>
        </div>
      </div>
    </div>
  );
}

export function Minimap() {
  const t = useGame((s) => s.t);
  const open = useGame((s) => s.openOverlay);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 132;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    const id = setInterval(() => {
      const p = runtime.pose, route = fuel.navigation ?? nav;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMap(
        ctx,
        { cx: p.x, cz: p.z, scale: 0.55, rotation: p.heading + Math.PI, width: size, height: size },
        {
          route: route.active ? route.route : null,
          routeFrom: route.along,
          routeColor: route.target === 'pickup' ? '#d5eaff' : route.target === 'bus' ? '#2b8fd6' : '#36ceff',
          target: route.active && route.targetBay ? { x: route.targetBay.x, z: route.targetBay.z, color: route.target === 'pickup' ? '#d5eaff' : route.target === 'bus' ? '#2b8fd6' : '#36ceff', icon: route.target === 'fuel' ? '⛽' : route.target === 'pickup' ? '👤' : route.target === 'bus' ? '🚏' : '⚑' } : null,
          player: p,
          labels: false,
        },
      );
    }, 100);
    return () => clearInterval(id);
  }, []);
  return (
    <button className="minimap" aria-label={t.cityMap} title={t.cityMap} data-testid="minimap" onClick={() => open('map')}>
      <canvas ref={ref} />
      <span className="north">N</span>
    </button>
  );
}

export function SpeedPill() {
  const t = useGame((s) => s.t);
  const kmh = usePoll(() => Math.round(runtime.telemetry.speedKmh), 100);
  return (
    <div className="speed-pill" data-testid="speed">
      <span className="num">{kmh}</span>
      <span className="unit">{t.speedUnit}</span>
    </div>
  );
}

function FuelGauge() {
  const t = useGame((s) => s.t);
  const f = usePoll(() => ({ percent: Math.ceil(fuel.percent), refilling: fuel.refilling, distance: Math.round(fuel.stationDistance), name: fuel.stationName(), navigating: !!fuel.navigation, inBay: fuel.inBay }), 150, shallow);
  const low = f.percent <= FUEL.lowPercent;
  return (
    <div className={`fuel-gauge ${low ? 'low' : ''} ${f.percent === 0 ? 'empty' : ''} ${f.refilling ? 'refilling' : ''}`} data-testid="fuel-gauge">
      <div className="fuel-label"><span>⛽ {f.percent === 0 ? t.fuelEmpty : low ? t.fuelLow : t.fuel}</span><b>{f.percent}%</b></div>
      <div className="fuel-track" role="progressbar" aria-label={t.fuel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.percent}><i style={{ width: `${f.percent}%` }} /></div>
      {f.refilling ? <small>{t.refueling}</small> : f.inBay ? <small>{t.stopToRefuel}</small> : low && f.name ? <small>{f.name} · {meters(f.distance)}</small> : null}
      {f.percent === 0 && !f.inBay && <button onClick={() => fuel.navigateToPump()} data-testid="navigate-fuel">{t.navigateToFuel}<KeyHint k={SHORTCUTS.fuel} /></button>}
      {f.percent === 0 && !f.inBay && f.navigating && <button onClick={() => fuel.towToPump()} data-testid="tow-fuel">{t.towToFuel}<KeyHint k={SHORTCUTS.fuel} /></button>}
      {f.percent < 100 && f.inBay && <button onClick={() => fuel.openPump()} data-testid="open-fuel">{t.refuel}<KeyHint k={SHORTCUTS.fuel} /></button>}
    </div>
  );
}

function StopProgress() {
  const t = useGame((s) => s.t);
  const stage = useGame((s) => s.ride.stage);
  const p = usePoll(() => ({ prog: Math.round(nav.stopProgress * 20) / 20, hint: nav.stopHint, near: nav.active && nav.remaining < 40 }), 100, shallow);
  const busStopped = usePoll(() => stage === 'BUS' && rideVisualBusy(), 150);
  const boarding = stage === 'BOARDING' || stage === 'ALIGHTING' || busStopped;
  if (!boarding && !(p.near && (p.prog > 0 || p.hint))) return null;
  const pct = boarding ? 1 : p.prog;
  return (
    <div className="stop-card" data-testid="stop-card">
      <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden>
        <circle cx="23" cy="23" r="19" stroke="#1b2b3e" strokeWidth="5" fill="none" />
        <circle cx="23" cy="23" r="19" stroke="#d5eaff" strokeWidth="5" fill="none" strokeDasharray={`${pct * 119.4} 119.4`} transform="rotate(-90 23 23)" strokeLinecap="round" />
        <text x="23" y="28" textAnchor="middle" fontSize="16">
          👤
        </text>
      </svg>
      <div>
        <div className="stop-main">{busStopped ? t.boardingPassengers : stage === 'BOARDING' ? t.boarding : stage === 'ALIGHTING' ? t.alighting : nav.target === 'pickup' ? t.pickingUp : t.droppingOff}</div>
        <div className="stop-sub">{boarding ? '' : p.hint ? t[p.hint] : t.holdStill}</div>
      </div>
    </div>
  );
}

function rideVisualBusy() {
  return busDoor.open;
}

/** Bus route panel: stop list (done / current / upcoming) and occupancy. */
function BusPanel() {
  const t = useGame((s) => s.t);
  const bus = useGame((s) => s.ride.bus);
  const stage = useGame((s) => s.ride.stage);
  if (stage !== 'BUS' || !bus) return null;
  return (
    <details className="bus-panel" data-testid="bus-panel">
      <summary><span>🚌 {bus.stopNames[Math.min(bus.nextStop, bus.stopNames.length - 1)]}</span><b>{bus.onboard}/{bus.capacity}</b></summary>
      {bus.stopNames.map((n, i) => (
        <div key={i} className={`bs ${i < bus.nextStop ? 'done' : i === bus.nextStop ? 'cur' : ''}`}>
          <i>{i < bus.nextStop ? '✓' : ''}</i>
          {n}
        </div>
      ))}
      <div className="occ" data-testid="occupancy">
        👥 {t.occupancy}: <b>{bus.onboard} / {bus.capacity}</b>
      </div>
    </details>
  );
}

function DispatchButton() {
  const t = useGame((s) => s.t);
  const vehicle = useGame((s) => s.save.equippedVehicleId);
  const stage = useGame((s) => s.ride.stage);
  const receipts = useGame((s) => s.save.pendingReceipts.length);
  const open = useGame((s) => s.openOverlay);
  if (VEHICLES[vehicle as keyof typeof VEHICLES]?.kind !== 'bus' || stage === 'BUS' || receipts) return null;
  return (
    <button className="offer-mini" onClick={() => open('bus')} data-testid="dispatch-btn">
      🚌 {t.busDispatch}
    </button>
  );
}

function RideChip() {
  const t = useGame((s) => s.t);
  const ride = useGame((s) => s.ride);
  const sat = usePoll(() => Math.round(nav.satisfaction), 300);
  const left = usePoll(() => (ride.deadline !== null && ride.stage === 'TO_DROPOFF' ? Math.max(0, Math.round(ride.deadline - nav.elapsed)) : -1), 500);
  if (ride.stage !== 'TO_DROPOFF' && ride.stage !== 'TO_PICKUP' && ride.stage !== 'BOARDING' && ride.stage !== 'ALIGHTING') return null;
  const stars = sat >= 90 ? 5 : sat >= 75 ? 4 : sat >= 55 ? 3 : sat >= 30 ? 2 : 1;
  return (
    <div className={`ride-chip ${left >= 0 ? 'timed' : ''}`}>
      <span className="avatar">{AVATARS[ride.avatar % AVATARS.length]}</span>
      <div>
        <div className="rc-title">{ride.stage === 'TO_PICKUP' ? `${ride.pickupName} → ${ride.dropName}` : t.passengerOnBoard}</div>
        {ride.stage === 'TO_PICKUP' ? (
          <div className="rc-sub">
            {t.fare} <b>{money(ride.baseFare)}</b> · {ride.partySize} {ride.partySize > 1 ? t.passengers : t.passenger}
          </div>
        ) : (
          <div className="rc-sub stars" title={`${t.satisfaction} ${sat}`}>
            {'★'.repeat(stars)}
            <span className="dim">{'★'.repeat(5 - stars)}</span>
            {left >= 0 && (
              <span className={`deadline ${left === 0 ? 'late' : ''}`} title={t.timeLeft} data-testid="deadline">
                {' '}⏱ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function OfferCard() {
  const t = useGame((s) => s.t);
  const offer = useGame((s) => s.ride.offer);
  const stage = useGame((s) => s.ride.stage);
  const fast = usePoll(() => runtime.telemetry.speedKmh > 25, 300);
  const [collapsed, setCollapsed] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => setCollapsed(fast), [fast]);
  if (stage !== 'OFFERED' || !offer) return null;
  if (collapsed) {
    return (
      <button className="offer-mini" onClick={() => setCollapsed(false)} data-testid="offer-mini">
        🔔 {t.newRide} · {money(offer.baseFare)}
      </button>
    );
  }
  return (
    <div className={`offer-card ${details ? 'expanded' : ''}`} role="dialog" aria-label={t.newRide} data-testid="offer-card">
      <div className="offer-scroll">
        <div className="offer-head">
          <button className="offer-info" onClick={() => setDetails((v) => !v)} aria-label={t.rideDetails} aria-expanded={details}>
            <span className="offer-type">{t.rideTypes[offer.rideType]}</span><span aria-hidden>{details ? '⌃' : '⌄'}</span>
          </button>
          <b data-testid="offer-fare">{money(offer.baseFare)}</b>
        </div>
        <div className="offer-person">
          <span className="avatar big">{AVATARS[offer.avatar % AVATARS.length]}</span>
          <b>{offer.passengerName}</b>
        </div>
        <div className="stops">
          <div className="stop pickup">
            <i />
            <b title={`${t.pickup}: ${offer.pickupName}`}>{offer.pickupName}</b> <span className="muted">{meters(offer.pickupMeters)}</span>
          </div>
          <div className="stop drop">
            <i />
            <b title={`${t.dropoff}: ${offer.dropName}`}>{offer.dropName}</b>
          </div>
        </div>
        <div className="chips">
          <span>👥 {offer.partySize} {offer.partySize > 1 ? t.passengers : t.passenger}</span>
          <span>📍 {meters(offer.routeMeters)}</span>
          <span>⏱ {t.estTime} {Math.max(1, Math.round(offer.estSeconds / 60))} min</span>
          {offer.rain && <span>🌧 +12%</span>}
          {offer.rideType === 'vip' && <span>⭐ {t.comfort} ★★★★+</span>}
          {offer.deadlineSeconds !== null && (
            <span>
              ⏱ {t.timeLeft} {Math.ceil(offer.deadlineSeconds / 60)} min
            </span>
          )}
        </div>
        <div className="fare-note">{offer.tutorial ? t.fixedFare : t.fareNote}</div>
      </div>
      <div className="offer-actions">
        <button className="btn primary" onClick={() => rides.accept(offer.id)} data-testid="accept">
          {t.accept}<KeyHint k={SHORTCUTS.accept} />
        </button>
        {!offer.tutorial && (
          <button className="btn ghost" onClick={() => rides.decline()} data-testid="decline">
            {t.decline}<KeyHint k={SHORTCUTS.decline} />
          </button>
        )}
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`}>
          {x.text}
        </div>
      ))}
    </div>
  );
}

export function Hud({ onPause, tutorial }: { onPause: () => void; tutorial?: ReactNode }) {
  const t = useGame((s) => s.t);
  return (
    <>
      <div className="hud-top-left">
        <CashLevel />
        <Instruction />
        <RideChip />
        <BusPanel />
        <DispatchButton />
        <OfferCard />
        <StopProgress />
        {tutorial}
        <Toasts />
      </div>
      <div className="hud-top-right">
        <Minimap />
        <kbd className="key-hint map-key" aria-hidden>{SHORTCUTS.map}</kbd>
        <button className="pause-btn" aria-label={t.paused} onClick={onPause} data-testid="pause">
          <ControlIcon name="pause" />
          <KeyHint k={SHORTCUTS.pause} />
        </button>
      </div>
      <div className="hud-instruments">
        <SpeedPill />
        <FuelGauge />
      </div>
    </>
  );
}
