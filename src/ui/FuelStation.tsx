import { useState } from 'react';
import { useGame } from '../app/store';
import { fuel, fuelQuote, FUEL } from '../game/vehicles/fuel';
import { VEHICLES } from '../game/data/vehicles';
import { fmt, money } from '../i18n/strings';
import { Modal } from './Screens';

export function FuelStation() {
  const t = useGame(s => s.t), wallet = useGame(s => s.save.wallet);
  const [target, setTarget] = useState(100), [error, setError] = useState(false);
  const prompt = fuel.prompt; if (!prompt) return null;
  const kind = VEHICLES[prompt.vehicleId].kind, quote = fuelQuote(fuel.percent, target, kind);
  const affordable = quote.cost <= wallet;
  return <Modal label={t.fuelStation} onClose={() => fuel.dismiss()} className="fuel-station" testId="fuel-station">
    <h2>⛽ {fuel.stationName()}</h2>
    <p>{fmt(t.fuelPrice, { price: money(FUEL.pricePerLiter) })}</p>
    <p>{fmt(t.currentTank, { percent: Math.round(fuel.percent), capacity: FUEL.capacityLiters[kind] })}</p>
    <div className="fuel-options" role="group" aria-label={t.fillTo}>
      {([25, 50, 100] as const).map((level, i) => {
        const option = fuelQuote(fuel.percent, level, kind);
        return <button key={level} data-testid={`fuel-option-${level}`} aria-pressed={target === level} disabled={option.liters <= 0}
          className={target === level ? 'selected' : ''} onClick={() => { setTarget(level); setError(false); }}>
          <b>{[t.quarterTank, t.halfTank, t.fullTank][i]}</b><span>{fmt(t.fillPercent, { percent: level })}</span><small>{money(option.cost)}</small>
        </button>;
      })}
    </div>
    <p className="fuel-quote" data-testid="fuel-quote">{quote.liters > 0 ? fmt(t.fuelPurchaseQuote, { liters: quote.liters.toFixed(2), total: money(quote.cost) }) : t.tankAlreadyFilled}</p>
    <p>{t.cash}: {money(wallet)}</p>
    {(!affordable || error) && <p className="error" role="alert">{!affordable ? t.notEnoughFuelCash : t.fuelPurchaseUnavailable}</p>}
    <div className="row">
      <button className="btn" data-testid="fuel-cancel" onClick={() => fuel.dismiss()}>{t.close}</button>
      <button className="btn primary" data-testid="fuel-confirm" disabled={!affordable || quote.liters <= 0}
        onClick={() => { if (!fuel.purchase(target)) setError(true); }}>{fmt(t.confirmFuel, { total: money(quote.cost) })}</button>
    </div>
  </Modal>;
}
