import { useMemo } from 'react';
import { useGame } from '../app/store';
import { BAY_BY_ID, LANDMARK_BY_ID } from '../game/data/cityMap';
import { VEHICLES, type VehicleId } from '../game/data/vehicles';
import { BUS_ROUTES, busService, previewRoute, routeEligible } from '../game/missions/bus';
import { fmt, meters, money } from '../i18n/strings';
import { ControlIcon } from './ControlIcon';

/** Route cards: eligibility checked before showing Start; quote and occupancy plan fixed per card. */
export function BusDispatchPanel() {
  const t = useGame((s) => s.t);
  const save = useGame((s) => s.save);
  const lang = save.settings.language;
  const close = useGame((s) => s.openOverlay);
  const vehicle = save.equippedVehicleId as VehicleId;
  const isBus = VEHICLES[vehicle].kind === 'bus';
  const seed = useMemo(() => Math.floor(Math.random() * 1e9), []);
  const cards = useMemo(
    () =>
      BUS_ROUTES.map((r) => {
        const ok = isBus && routeEligible(r, vehicle);
        const pv = ok ? previewRoute(r, vehicle, seed) : null;
        return { r, ok, pv };
      }),
    [vehicle, isBus, seed],
  );
  if (!isBus) return <p className="muted">{t.busRequiresBus}</p>;
  return (
    <div className="bus-cards">
      {cards.map(({ r, ok, pv }) => (
        <div key={r.id} className={`bus-card ${ok ? '' : 'locked'}`} data-testid={`route-${r.id}`}>
          <h3>{lang === 'ru' ? r.nameRu : r.name}</h3>
          <ol className="stoplist">
            {r.stops.map((s) => (
              <li key={s}>{LANDMARK_BY_ID.get(BAY_BY_ID.get(s)!.landmark)!.name}</li>
            ))}
          </ol>
          {pv ? (
            <>
              <div className="chips">
                <span><ControlIcon name="bus" /> {r.stops.length} {t.stops}</span>
                <span><ControlIcon name="passengers" /> {pv.planned} {t.plannedRiders}</span>
                <span><ControlIcon name="pin" /> {meters(pv.meters)}</span>
                <span><ControlIcon name="clock" /> ≈{pv.estMinutes} min</span>
              </div>
              <div className="fare-row">
                <span>{t.fare}</span>
                <b>{money(pv.quote)}</b>
              </div>
              <button
                className="btn primary"
                data-testid={`start-${r.id}`}
                disabled={!!save.mission}
                onClick={() => {
                  if (busService.start(r.id)) close(null);
                }}
              >
                {t.startRoute}
              </button>
            </>
          ) : (
            <button className="btn disabled" disabled>
              <ControlIcon name="lock" /> {fmt(t.needsTier, { vehicle: VEHICLES[r.minVehicle].name })}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
