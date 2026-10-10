import { useState } from 'react';
import { useGame } from '../app/store';
import { fuel, FUEL } from '../game/vehicles/fuel';
import { VEHICLES } from '../game/data/vehicles';
import { fmt } from '../i18n/strings';
import { Modal } from './Screens';

export function FuelStation() {
  const t = useGame(s => s.t), [error, setError] = useState(false);
  const prompt = fuel.prompt; if (!prompt) return null;
  const kind = VEHICLES[prompt.vehicleId].kind;
  return <Modal label={t.fuelStation} onClose={() => fuel.dismiss()} className="fuel-station" testId="fuel-station">
    <h2>⛽ {fuel.stationName()}</h2>
    <p>{t.freeFuel}</p>
    <p>{fmt(t.currentTank, { percent: Math.round(fuel.percent), capacity: FUEL.capacityLiters[kind] })}</p>
    <p className="fuel-quote" data-testid="fuel-quote">{t.fullTank} · 100%</p>
    {error && <p className="error" role="alert">{t.fuelPurchaseUnavailable}</p>}
    <div className="row">
      <button className="btn" data-testid="fuel-cancel" onClick={() => fuel.dismiss()}>{t.close}</button>
      <button className="btn primary" data-testid="fuel-confirm" disabled={fuel.percent >= 100}
        onClick={() => { if (!fuel.fillTank()) setError(true); }}>{t.fillTankFree}</button>
    </div>
  </Modal>;
}
