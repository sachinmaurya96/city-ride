import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../app/store';
import { events } from '../game/core/events';
import { VEHICLES, VEHICLE_ORDER, type VehicleId } from '../game/data/vehicles';
import { deriveHandling } from '../game/vehicles/handling';
import {
  PAINTS,
  buyPaint,
  buyUpgrade,
  equipVehicle,
  levelForXP,
  paintFor,
  purchaseVehicle,
  upgradeCost,
  upgradeLevels,
  vehicleState,
  type UpgradeCategory,
} from '../game/progression/progression';
import { fmt, money } from '../i18n/strings';
import { Modal } from './Screens';
import { renderVehiclePreview } from './vehiclePreview';

const KIND_ICON: Record<string, string> = { bike: '🛵', auto: '🛺', car: '🚗', bus: '🚌' };
const CATS: { id: UpgradeCategory; icon: string }[] = [
  { id: 'engine', icon: '⚙️' },
  { id: 'brakes', icon: '🛑' },
  { id: 'tires', icon: '🛞' },
  { id: 'comfort', icon: '💺' },
];

function Preview({ id, paint }: { id: VehicleId; paint: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const yaw = useRef(-0.6);
  const drag = useRef<number | null>(null);
  const [ok, setOk] = useState(true);
  const draw = () => {
    const c = ref.current;
    if (c) setOk(renderVehiclePreview(c, id, paint, yaw.current));
  };
  useEffect(() => {
    draw();
    let raf = 0;
    let last = performance.now();
    const spin = (now: number) => {
      if (drag.current === null) {
        yaw.current += (now - last) * 0.00035;
        draw();
      }
      last = now;
      raf = requestAnimationFrame(spin);
    };
    // gentle idle rotation (~15 fps worth of work through rAF throttle)
    const id2 = setInterval(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(spin);
    }, 80);
    return () => {
      clearInterval(id2);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, paint]);
  return (
    <div className="preview-wrap">
      <canvas
        ref={ref}
        width={560}
        height={340}
        className="preview"
        aria-label={VEHICLES[id].name}
        onPointerDown={(e) => {
          drag.current = e.clientX;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          yaw.current += (e.clientX - drag.current) * 0.012;
          drag.current = e.clientX;
          draw();
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      {!ok && <div className="preview-fallback">{KIND_ICON[VEHICLES[id].kind]}</div>}
    </div>
  );
}

function StatBar({ label, value, next }: { label: string; value: number; next?: number }) {
  return (
    <div className="statbar">
      <span>{label}</span>
      <div className="bar">
        {next !== undefined && next > value && <i className="next" style={{ width: `${next}%` }} />}
        <i style={{ width: `${value}%` }} />
      </div>
      <b>{Math.round(next ?? value)}</b>
    </div>
  );
}

export function GarageOverlay() {
  const t = useGame((s) => s.t);
  const save = useGame((s) => s.save);
  const commit = useGame((s) => s.commit);
  const close = useGame((s) => s.closeOverlay);
  const toast = useGame((s) => s.toast);
  const open = useGame((s) => s.openOverlay);
  const appState = useGame((s) => s.appState);
  const [sel, setSel] = useState<VehicleId>(save.equippedVehicleId as VehicleId);
  const [tab, setTab] = useState<'vehicles' | 'upgrades' | 'paint'>('vehicles');
  const [filter, setFilter] = useState<'all' | 'cars' | 'buses'>('all');
  const [confirm, setConfirm] = useState<VehicleId | null>(null);
  const [cat, setCat] = useState<UpgradeCategory>('engine');
  const busy = useRef(false);
  const spec = VEHICLES[sel];
  const owned = save.ownedVehicleIds.includes(sel);
  const state = vehicleState(save, sel);
  const level = levelForXP(save.totalXP);
  const ups = upgradeLevels(save, sel);
  const paint = paintFor(save, sel);
  const busyJob = !!save.mission;
  const list = VEHICLE_ORDER.filter((v) => (filter === 'all' ? true : filter === 'buses' ? VEHICLES[v].kind === 'bus' : VEHICLES[v].kind !== 'bus'));

  /** Single-flight guard: a double click / repeated render can never buy twice (domain also checks ownership). */
  const act = (fn: () => void) => {
    if (busy.current) return;
    busy.current = true;
    try {
      fn();
    } finally {
      setTimeout(() => (busy.current = false), 250);
    }
  };

  const doBuy = (id: VehicleId) =>
    act(() => {
      const r = purchaseVehicle(useGame.getState().save, id, Date.now());
      setConfirm(null);
      if (r.error) {
        toast(r.error === 'funds' ? t.notEnough : r.error === 'level' ? fmt(t.reachLevel, { level: VEHICLES[id].unlockLevel }) : r.error, 'warn');
        return;
      }
      commit(r.save, true);
      events.emit({ type: 'VEHICLE_PURCHASED', id });
      toast(fmt(t.purchased, { name: VEHICLES[id].name }), 'good');
    });

  const doEquip = (id: VehicleId) =>
    act(() => {
      const r = equipVehicle(useGame.getState().save, id, Date.now());
      if (r.error === 'busy') {
        toast(t.garageOnlyIdle, 'warn');
        return;
      }
      if (!r.error) commit(r.save, true);
    });

  const doUpgrade = () =>
    act(() => {
      const r = buyUpgrade(useGame.getState().save, sel, cat, Date.now());
      if (r.error) {
        toast(r.error === 'funds' ? t.notEnough : r.error === 'maxed' ? t.maxTier : r.error, 'warn');
        return;
      }
      commit(r.save, true);
      events.emit({ type: 'UPGRADE_PURCHASED', id: sel });
    });

  const doPaint = (color: string) =>
    act(() => {
      const r = buyPaint(useGame.getState().save, sel, color, Date.now());
      if (r.error) {
        toast(r.error === 'funds' ? t.notEnough : r.error, 'warn');
        return;
      }
      commit(r.save, true);
    });

  // Before/after handling numbers for the selected upgrade category.
  const before = useMemo(() => deriveHandling(spec, ups), [spec, ups]);
  const nextUps = { ...ups, [cat]: Math.min(3, ups[cat] + 1) };
  const after = useMemo(() => deriveHandling(spec, nextUps), [spec, nextUps.engine, nextUps.brakes, nextUps.tires, nextUps.comfort]); // eslint-disable-line react-hooks/exhaustive-deps
  const catValue = (h: typeof before) =>
    cat === 'engine' ? h.accel0 * 20 : cat === 'brakes' ? h.brakeDecel * 11 : cat === 'tires' ? h.grip * 32 : (2 - h.comfortPenaltyScale) * 45;

  return (
    <Modal label={t.garage} onClose={close} className="garage" testId="garage">
      <div className="garage-head">
        <div className="wordmark small">
          <span className="w1">CITY</span> <span className="w2">RIDE</span> <span className="w4">| {t.garage.toUpperCase()}</span>
        </div>
        <div className="wallet-pill" data-testid="garage-wallet">
          🪙 {money(save.wallet)}
        </div>
        <button className="icon-btn danger" onClick={close} aria-label={t.close} data-testid="garage-close">
          ✕
        </button>
      </div>
      <div className="garage-body">
        <div className="garage-left">
          <Preview id={sel} paint={paint} />
        </div>
        <div className="garage-panel">
          <div className="tabs">
            <button className={tab === 'vehicles' ? 'on' : ''} onClick={() => setTab('vehicles')}>
              🚗 {t.vehicles}
            </button>
            <button className={tab === 'upgrades' ? 'on' : ''} onClick={() => setTab('upgrades')} disabled={!owned} data-testid="tab-upgrades">
              🔧 {t.upgrades}
            </button>
            <button className={tab === 'paint' ? 'on' : ''} onClick={() => setTab('paint')} disabled={!owned} data-testid="tab-paint">
              🖌️ {t.paint}
            </button>
          </div>
          <h2 className="vname">{save.settings.language === 'ru' ? spec.nameRu : spec.name}</h2>
          <div className="muted">{fmt(t.seats, { seats: spec.totalSeats, pass: spec.passengerSeats })}</div>
          {tab === 'vehicles' && (
            <>
              <StatBar label={t.speed} value={spec.display.speed} />
              <StatBar label={t.handling} value={spec.display.handling} />
              <StatBar label={t.brakes} value={spec.display.brakes} />
              <StatBar label={t.comfort} value={spec.display.comfort} />
              <div className="jobs">
                {t.jobsFor}: {spec.jobs.map((j) => t.rideTypes[j] ?? j).join(' · ')}
              </div>
              <div className="price">
                <small>{t.priceLabel}</small>
                <b>{spec.price === 0 ? t.free : money(spec.price)}</b>
              </div>
              {state === 'equipped' && <button className="btn disabled" disabled>✓ {t.equipped}</button>}
              {state === 'owned' && (
                <button className="btn primary" onClick={() => doEquip(sel)} disabled={busyJob} data-testid="equip">
                  {t.equip}
                </button>
              )}
              {state === 'locked' && (
                <button className="btn disabled" disabled data-testid="locked">
                  🔒 {fmt(t.reachLevel, { level: spec.unlockLevel })}
                </button>
              )}
              {state === 'affordable' && (
                <button className="btn primary" onClick={() => setConfirm(sel)} data-testid="buy">
                  {fmt(t.buy, { price: money(spec.price) })}
                </button>
              )}
              {state === 'unaffordable' && (
                <button className="btn disabled" disabled data-testid="unaffordable">
                  {fmt(t.buy, { price: money(spec.price) })} · {t.notEnough}
                </button>
              )}
              {busyJob && owned && state !== 'equipped' && <small className="muted">{t.garageOnlyIdle}</small>}
              {spec.kind === 'bus' && state === 'equipped' && appState === 'PLAYING' && (
                <button className="btn outline" onClick={() => open('bus')} data-testid="open-dispatch">
                  🚌 {t.busDispatch}
                </button>
              )}
            </>
          )}
          {tab === 'upgrades' && owned && (
            <>
              <div className="upg-list">
                {CATS.map((c) => {
                  const lvl = ups[c.id];
                  const cost = lvl < 3 ? upgradeCost(sel, lvl + 1) : 0;
                  return (
                    <button key={c.id} className={`upg ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)} data-testid={`upg-${c.id}`}>
                      <span>
                        {c.icon} {t[c.id]}
                      </span>
                      <span className="muted">{fmt(t.tier, { t: lvl })}</span>
                      <b className="cost">{lvl >= 3 ? t.maxTier : money(cost)}</b>
                    </button>
                  );
                })}
              </div>
              <div className="upg-compare">
                <StatBar label={t.current} value={Math.min(100, catValue(before))} />
                <StatBar label={t.upgraded} value={Math.min(100, catValue(before))} next={Math.min(100, catValue(after))} />
              </div>
              {ups[cat] < 3 ? (
                <button className="btn primary" onClick={doUpgrade} disabled={save.wallet < upgradeCost(sel, ups[cat] + 1)} data-testid="buy-upgrade">
                  {fmt(t.upgradeBtn, { cat: t[cat], price: money(upgradeCost(sel, ups[cat] + 1)) })}
                </button>
              ) : (
                <button className="btn disabled" disabled>
                  {t.maxTier}
                </button>
              )}
              <small className="muted center">{t.upgradesStay}</small>
            </>
          )}
          {tab === 'paint' && owned && (
            <div className="paints">
              {PAINTS.map((p) => (
                <button
                  key={p.color}
                  className={`paint ${paint === p.color ? 'on' : ''}`}
                  style={{ background: p.color }}
                  onClick={() => doPaint(p.color)}
                  aria-label={`${p.color} ${money(p.price)}`}
                  disabled={paint !== p.color && save.wallet < p.price}
                >
                  <span>{paint === p.color ? '✓' : money(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="garage-strip">
        <div className="seg small">
          {(['all', 'cars', 'buses'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? t.filterAll : f === 'cars' ? t.filterCars : t.filterBuses}
            </button>
          ))}
        </div>
        <div className="cards">
          {list.map((id) => {
            const st = vehicleState(save, id);
            const v = VEHICLES[id];
            return (
              <button key={id} className={`vcard ${sel === id ? 'sel' : ''}`} onClick={() => setSel(id)} data-testid={`vcard-${id}`}>
                <span className="vico" style={{ color: paintFor(save, id) }}>
                  {KIND_ICON[v.kind]}
                </span>
                <span className="vn">{save.settings.language === 'ru' ? v.nameRu : v.name}</span>
                <span className={`chip ${st}`}>
                  {st === 'equipped' ? t.equipped : st === 'owned' ? t.owned : st === 'locked' ? `🔒 ${t.level} ${v.unlockLevel}` : money(v.price)}
                </span>
              </button>
            );
          })}
        </div>
        <span className="muted lvl-note">
          {t.level} {level}
        </span>
      </div>
      {confirm && (
        <div className="confirm-pop" role="alertdialog" data-testid="confirm-buy">
          <p>{fmt(t.confirmPurchase, { name: VEHICLES[confirm].name, price: money(VEHICLES[confirm].price) })}</p>
          <div className="row">
            <button className="btn ghost" onClick={() => setConfirm(null)}>
              {t.no}
            </button>
            <button className="btn primary" onClick={() => doBuy(confirm)} data-testid="confirm-yes">
              {t.yes}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Bus dispatch (routes are implemented by the bus service). */
export function BusDispatch() {
  const t = useGame((s) => s.t);
  const close = useGame((s) => s.closeOverlay);
  const [Mod, setMod] = useState<null | typeof import('./BusDispatchPanel')>(null);
  useEffect(() => {
    void import('./BusDispatchPanel').then(setMod);
  }, []);
  return (
    <Modal label={t.busDispatch} onClose={close} className="bus-dispatch" testId="bus-dispatch">
      <div className="modal-head">
        <h2>🚌 {t.busDispatch}</h2>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      {Mod ? <Mod.BusDispatchPanel /> : null}
    </Modal>
  );
}
