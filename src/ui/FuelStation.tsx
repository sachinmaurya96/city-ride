import { useState } from 'react';
import { useGame } from '../app/store';
import { fuel, fuelBill, FUEL } from '../game/vehicles/fuel';
import { VEHICLES } from '../game/data/vehicles';
import { fmt, money } from '../i18n/strings';
import { Modal } from './Screens';

export function FuelStation() {
  const t = useGame(s => s.t), [error, setError] = useState(false);
  const wallet = useGame(s => s.save.wallet), fuelDebt = useGame(s => s.save.fuelDebt);
  const bill = fuelBill({ wallet, fuelDebt });
  const prompt = fuel.prompt; if (!prompt) return null;
  const kind = VEHICLES[prompt.vehicleId].kind;
  return <Modal label={t.fuelStation} onClose={() => fuel.dismiss()} className="fuel-station" testId="fuel-station">
    <h2>⛽ {fuel.stationName()}</h2>
    <p>{fmt(t.freeFuel, { price: money(bill.price) })}</p>
    <p>{fmt(t.currentTank, { percent: Math.round(fuel.percent), capacity: FUEL.capacityLiters[kind] })}</p>
    <p className="fuel-quote" data-testid="fuel-quote">{t.fullTank} · 100% · {money(bill.price)}</p>
    {bill.debt > 0 && <p className="bad" data-testid="fuel-debt">{fmt(t.fuelDue, { amount: money(bill.debt) })}</p>}
    {bill.debt > 0 && <p data-testid="fuel-total"><b>{fmt(t.fuelTotal, { amount: money(bill.total) })}</b></p>}
    {bill.owed > 0 && <p className="muted" data-testid="fuel-short">{fmt(t.fuelShort, { wallet: money(bill.paid), amount: money(bill.owed) })}</p>}
    {error && <p className="error" role="alert">{t.fuelPurchaseUnavailable}</p>}
    <div className="row">
      <button className="btn" data-testid="fuel-cancel" onClick={() => fuel.dismiss()}>{t.close}</button>
      <button className="btn primary" data-testid="fuel-confirm" disabled={fuel.percent >= 100}
        onClick={() => { if (!fuel.fillTank()) setError(true); }}>{fmt(t.fillTankFree, { price: money(bill.total) })}</button>
    </div>
  </Modal>;
}
