import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../app/store';
import { startTestDrive } from '../game/progression/testDrive';
import { events } from '../game/core/events';
import { VEHICLES, VEHICLE_ORDER, inGarage, isVehicleId, type VehicleId } from '../game/data/vehicles';
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
import { useImportedModel } from '../game/render/useImportedModel';
import { loadImportedModel } from '../game/render/importedVehicles';
import { requestGameFullscreen } from '../app/display';
import { ControlIcon } from './ControlIcon';
import './garageTheme.css';

/** Real in-game photos for the selector cards (scripts/splash-shots.mjs with THUMB=1). */
const THUMBS = Object.fromEntries(Object.entries(import.meta.glob<string>('../assets/thumbs/*.webp', { eager: true, import: 'default' }))
  .map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]));
const CATS: UpgradeCategory[] = ['engine', 'brakes', 'tires', 'comfort'];

function VehicleGlyph({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 64 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'bike' ? <>
        <circle cx="14" cy="23" r="7" /><circle cx="50" cy="23" r="7" />
        <path d="m14 23 12-14 10 14H14Zm12-14h13l11 14M39 9l-2-6h-6M23 7h8" />
      </> : <>
        <path d={kind === 'bus' ? 'M6 23V5h50v18H6Zm3-10h44M18 5v8M30 5v8M42 5v8' : kind === 'auto' ? 'M9 23v-9l7-8h23l9 13h8v4H9Zm7-17v9h27M29 6v9' : 'M5 23V15l11-3 9-8h19l9 11 6 3v5H5Zm12-11h34M28 4l-4 8M42 4l4 8'} />
        <circle cx="17" cy="24" r="5" /><circle cx="47" cy="24" r="5" />
      </>}
    </svg>
  );
}

function Preview({ id, paint }: { id: VehicleId; paint: string }) {
  const t = useGame((s) => s.t);
  const model = useImportedModel(VEHICLES[id], 200);
  const reducedMotion = useGame(s => s.save.settings.reducedMotion);
  const ref = useRef<HTMLCanvasElement>(null);
  const yaw = useRef(-0.6);
  const drag = useRef<number | null>(null);
  const [ok, setOk] = useState(true);
  const draw = () => {
    const c = ref.current;
    if (c) setOk(renderVehiclePreview(c, id, paint, yaw.current, '#181a1d'));
  };
  useEffect(() => {
    if (model && model.status !== 'ready') return;
    draw();
    let raf = 0;
    let last = performance.now();
    let visible = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const spin = (now: number) => {
      if (drag.current === null) {
        yaw.current += (now - last) * 0.00035;
        draw();
      }
      last = now;
    };
    const schedule = () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      if (!visible || document.hidden || reducedMotion) return;
      last = performance.now();
      timer = setInterval(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(spin); }, 80);
    };
    // Rendering/readback stops when the preview is scrolled away or the tab is hidden.
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); });
    if (ref.current) observer.observe(ref.current);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, paint, model?.status, reducedMotion]);
  return (
    <div className="preview-wrap" data-testid="vehicle-preview" data-model-state={model?.status ?? 'ready'}>
      <canvas
        ref={ref}
        width={640}
        height={300}
        className="preview"
        style={{ visibility: model && model.status !== 'ready' ? 'hidden' : 'visible' }}
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
      {model && model.status !== 'ready' ? (
        <div className="preview-status" role="status">
          {model.status === 'loading' ? t.carLoading : <>
            <span>{t.carLoadFailed}</span>
            <button className="btn outline" onClick={() => void loadImportedModel(VEHICLES[id], true).catch(() => {})}>{t.retryCar}</button>
          </>}
        </div>
      ) : !ok && <div className="preview-fallback"><VehicleGlyph kind={VEHICLES[id].kind} /></div>}
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
  const [sel, setSel] = useState<VehicleId>(() => isVehicleId(save.equippedVehicleId) && inGarage(save.equippedVehicleId, save.ownedVehicleIds) ? save.equippedVehicleId : 'bike_basic');
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
  const testDrive = useGame((s) => s.testDrive);
  const showroom = VEHICLE_ORDER.filter((v) => inGarage(v, save.ownedVehicleIds));
  const hasBuses = showroom.some((v) => VEHICLES[v].kind === 'bus');
  const list = showroom.filter((v) => (filter === 'all' || !hasBuses ? true : filter === 'buses' ? VEHICLES[v].kind === 'bus' : VEHICLES[v].kind !== 'bus'));

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

  const doTestDrive = () => act(() => {
    if (matchMedia('(pointer: coarse)').matches) void requestGameFullscreen();
    if (!startTestDrive(sel)) return;
    useGame.getState().openOverlay(null);
  });

  const doTryCar = () => act(() => {
    const current = useGame.getState().save;
    if (current.mission) { toast(t.garageOnlyIdle, 'warn'); return; }
    const purchase = current.ownedVehicleIds.includes(sel) ? { save: current } : purchaseVehicle(current, sel, Date.now());
    if (purchase.error) return;
    const equipped = equipVehicle(purchase.save, sel, Date.now());
    if (equipped.error) return;
    commit(equipped.save, true);
    if (!current.ownedVehicleIds.includes(sel)) events.emit({ type: 'VEHICLE_PURCHASED', id: sel });
    close();
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
          <ControlIcon name="wallet" /> <span>{money(save.wallet)}</span>
        </div>
        <button className="icon-btn danger" onClick={close} aria-label={t.close} data-testid="garage-close">
          ✕
        </button>
      </div>
      <div className="tabs garage-tabs" aria-label={t.garage}>
        <button className={tab === 'vehicles' ? 'on' : ''} onClick={() => setTab('vehicles')} aria-pressed={tab === 'vehicles'}>
          {t.vehicles}
        </button>
        <button className={tab === 'upgrades' ? 'on' : ''} onClick={() => setTab('upgrades')} disabled={!owned} data-testid="tab-upgrades" aria-pressed={tab === 'upgrades'}>
          {t.upgrades}
        </button>
        <button className={tab === 'paint' ? 'on' : ''} onClick={() => setTab('paint')} disabled={!owned || !!spec.importedModel} data-testid="tab-paint" aria-pressed={tab === 'paint'}>
          {t.paint}
        </button>
      </div>
      <div className="garage-body">
        <div className="garage-left">
          <div className="garage-vehicle-heading">
            <div className="garage-kicker"><span>{t.vehicles}</span><span>{String(showroom.indexOf(sel) + 1).padStart(2, '0')} / {String(showroom.length).padStart(2, '0')}</span></div>
            <h2 className="vname">{save.settings.language === 'ru' ? spec.nameRu : spec.name}</h2>
          </div>
          <Preview id={sel} paint={paint} />
          <div className="garage-vehicle-meta">
            <div><small>{t.speed}</small><b>{spec.topSpeedKmh}<span> km/h</span></b></div>
            <div className="garage-capacity"><span>{fmt(t.seats, { seats: spec.totalSeats, pass: spec.passengerSeats })}</span>{spec.importedModel && <small>{t.originalFinish}</small>}</div>
          </div>
        </div>
        <div className="garage-panel">
          <div className="garage-panel-heading"><ControlIcon name={tab === 'vehicles' ? 'stats' : tab === 'upgrades' ? 'settings' : 'garage'} /><h3>{tab === 'vehicles' ? t.vehicles : tab === 'upgrades' ? t.upgrades : t.paint}</h3></div>
          {tab === 'vehicles' && (
            <>
              <div className="garage-stats">
                <StatBar label={t.speed} value={spec.display.speed} />
                <StatBar label={t.handling} value={spec.display.handling} />
                <StatBar label={t.brakes} value={spec.display.brakes} />
                <StatBar label={t.comfort} value={spec.display.comfort} />
              </div>
              <div className="jobs">
                {t.jobsFor}: {spec.jobs.map((j) => t.rideTypes[j] ?? j).join(' · ')}
              </div>
              <div className="price">
                <small>{t.priceLabel}</small>
                <b>{spec.price === 0 ? t.free : money(spec.price)}</b>
              </div>
              <div className="garage-actions">
                {state === 'equipped' && <button className="btn disabled" disabled>✓ {t.equipped}</button>}
                {spec.importedModel && state === 'owned' && (
                  <button className="btn primary" onClick={doTryCar} disabled={busyJob} data-testid="try-car">
                    {spec.kind === 'bike' ? t.tryBike : spec.kind === 'car' ? t.tryCar : t.tryVehicle}
                  </button>
                )}
                {state === 'owned' && !spec.importedModel && (
                  <button className="btn primary" onClick={() => doEquip(sel)} disabled={busyJob} data-testid="equip">
                    {t.equip}
                  </button>
                )}
                {state !== 'equipped' && !owned && !spec.npcOnly && (
                  <button className="btn outline" onClick={doTestDrive} disabled={busyJob || !!testDrive} data-testid="test-drive">
                    {t.testDrive}
                  </button>
                )}
                {state === 'locked' && (
                  <button className="btn disabled" disabled data-testid="locked">
                    {fmt(t.reachLevel, { level: spec.unlockLevel })}
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
                    {t.busDispatch}
                  </button>
                )}
              </div>
            </>
          )}
          {tab === 'upgrades' && owned && (
            <>
              <div className="upg-list">
                {CATS.map((category, index) => {
                  const lvl = ups[category];
                  const cost = lvl < 3 ? upgradeCost(sel, lvl + 1) : 0;
                  return (
                    <button key={category} className={`upg ${cat === category ? 'on' : ''}`} onClick={() => setCat(category)} data-testid={`upg-${category}`} aria-pressed={cat === category}>
                      <span className="upg-label">
                        <small aria-hidden="true">0{index + 1}</small> {t[category]}
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
          {tab === 'paint' && owned && !spec.importedModel && (
            <div className="paints">
              {PAINTS.map((p) => (
                <button
                  key={p.color}
                  className={`paint ${paint === p.color ? 'on' : ''}`}
                  style={{ background: p.color }}
                  onClick={() => doPaint(p.color)}
                  aria-label={`${p.color} ${money(p.price)}`}
                  aria-pressed={paint === p.color}
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
        <div className="garage-strip-head">
          <div className="seg small">
            {(hasBuses ? (['all', 'cars', 'buses'] as const) : (['all', 'cars'] as const)).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} aria-pressed={filter === f}>
                {f === 'all' ? t.filterAll : f === 'cars' ? t.filterCars : t.filterBuses}
              </button>
            ))}
          </div>
          <span className="muted lvl-note">{t.level} <b>{level}</b></span>
        </div>
        <div className="cards">
          {list.map((id) => {
            const st = vehicleState(save, id);
            const v = VEHICLES[id];
            return (
              <button
                key={id}
                className={`vcard ${sel === id ? 'sel' : ''}`}
                onClick={(e) => {
                  setSel(id);
                  if (!save.ownedVehicleIds.includes(id) || (VEHICLES[id].importedModel && tab === 'paint')) setTab('vehicles');
                  // On short/narrow screens the selector is below the preview. Bring the car into view.
                  e.currentTarget.closest('.garage')?.scrollTo({ top: 0 });
                }}
                data-testid={`vcard-${id}`}
                aria-pressed={sel === id}
              >
                {THUMBS[id] ? (
                  <img className="vthumb" src={THUMBS[id]} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="vico" style={{ color: paintFor(save, id) }}>
                    <VehicleGlyph kind={v.kind} />
                  </span>
                )}
                <span className="vn">{save.settings.language === 'ru' ? v.nameRu : v.name}</span>
                <span className={`chip ${st}`}>
                  {st === 'equipped' ? t.equipped : st === 'owned' ? t.owned : st === 'locked' ? `${t.level} ${v.unlockLevel}` : v.price === 0 ? t.free : money(v.price)}
                </span>
              </button>
            );
          })}
        </div>
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
        <h2><ControlIcon name="bus" /> {t.busDispatch}</h2>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      {Mod ? <Mod.BusDispatchPanel /> : null}
    </Modal>
  );
}
