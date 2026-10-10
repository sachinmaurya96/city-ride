import { useGame } from '../../app/store';
import { FUEL_STATIONS, type FuelStation, type Bay } from '../data/cityMap';
import { VEHICLES, type VehicleId, type VehicleKind } from '../data/vehicles';
import { runtime } from '../core/runtime';
import { input } from '../input/input';
import { routeFrom } from '../navigation/routing';
import { progressAlong, routeInstruction, type Route } from '../navigation/roadGraph';
import { vehicleEntry } from './entry';
import { FUEL_TANK_PRICE } from '../data/economy';
import { pushTx } from '../progression/progression';
import { fmt, money } from '../../i18n/strings';
import type { SaveData } from '../../storage/schema';

export const FUEL = {
  rangeMeters: { bike: 24000, auto: 20000, car: 18000, bus: 16000 } as Record<VehicleKind, number>,
  capacityLiters: { bike: 12, auto: 24, car: 80, bus: 180 } as Record<VehicleKind, number>,
  lowPercent: 20, stopHold: .5,
  /** Flat price (₹) of a full tank for any vehicle. */
  fullTankPrice: FUEL_TANK_PRICE,
};
/** What a refuel costs now: this tank plus any earlier unpaid fuel. */
export function fuelBill(save: Pick<SaveData, 'wallet' | 'fuelDebt'>) {
  const total = FUEL.fullTankPrice + save.fuelDebt;
  const paid = Math.min(save.wallet, total);
  return { price: FUEL.fullTankPrice, debt: save.fuelDebt, total, paid, owed: total - paid };
}
/** Fill the tank and charge it; cash that is short becomes fuel debt for the next visit. */
export function chargeFullTank(save: SaveData, vehicleId: VehicleId, now: number): SaveData {
  const bill = fuelBill(save);
  const s: SaveData = { ...save, wallet: save.wallet - bill.paid, fuelDebt: bill.owed,
    fuelByVehicle: { ...save.fuelByVehicle, [vehicleId]: 100 }, transactionHistory: [...save.transactionHistory],
    revision: save.revision + 1, updatedAt: now };
  if (bill.paid > 0) pushTx(s, `fuel:${now}`, 'fuel', -bill.paid, 0, now);
  return s;
}
export function insideFuelBay(bay: Bay, x: number, z: number) {
  const dx = x - bay.x, dz = z - bay.z;
  return Math.abs(dx * Math.sin(bay.heading) + dz * Math.cos(bay.heading)) <= bay.length / 2
    && Math.abs(dx * Math.cos(bay.heading) - dz * Math.sin(bay.heading)) <= bay.width / 2 + .8;
}
export class FuelTank {
  percent = 100;
  stopTime = 0;
  refilling = false;
  step(dt: number, meters: number, kind: VehicleKind, stoppedAtPump: boolean) {
    this.percent = Math.max(0, this.percent - Math.max(0, meters) * 100 / FUEL.rangeMeters[kind]);
    this.stopTime = stoppedAtPump ? this.stopTime + dt : 0;
    // Entering the bay only offers free filling; confirmation is required at the pump.
    this.refilling = false;
  }
}
export class FuelSystem {
  tank = new FuelTank();
  private vehicleId: VehicleId | null = null;
  private distance = 0;
  private saveTime = 0;
  private visitedBay: string | null = null;
  station: FuelStation | null = null;
  stationDistance = Infinity;
  inBay = false;
  prompt: { station: FuelStation; vehicleId: VehicleId } | null = null;
  navigation: { active: true; target: 'fuel'; targetBay: FuelStation; route: Route; along: number; remaining: number; progressIndex: number; instruction: 'continue' | 'left' | 'right' | 'stop' | 'arriving'; instructionDist: number } | null = null;
  private navTime = 0;
  get percent() { return this.tank.percent; }
  get refilling() { return this.tank.refilling; }
  private loadVehicle() {
    if (this.vehicleId === runtime.vehicleId) return;
    this.persist(); this.vehicleId = runtime.vehicleId; this.tank = new FuelTank();
    this.tank.percent = useGame.getState().save.fuelByVehicle[this.vehicleId] ?? 100;
    this.distance = runtime.distanceDriven; this.visitedBay = null; this.prompt = null; this.navigation = null;
  }
  step(dt: number) {
    if (useGame.getState().appState !== 'PLAYING' || !runtime.vehicle) return;
    this.loadVehicle(); this.station = null; this.stationDistance = Infinity;
    for (const station of FUEL_STATIONS) {
      const distance = Math.hypot(station.x - runtime.pose.x, station.z - runtime.pose.z);
      if (distance < this.stationDistance) { this.station = station; this.stationDistance = distance; }
    }
    this.inBay = !!this.station && insideFuelBay(this.station, runtime.pose.x, runtime.pose.z);
    if (!this.inBay) this.visitedBay = null;
    this.updateNavigation(dt);
    const drive = input.getDrive({ steer: 0, throttle: 0, brake: 0, handbrake: false });
    const stopped = vehicleEntry.mode === 'seated' && this.inBay && runtime.vehicle.horizontalSpeed() < .3 && drive.throttle < .05;
    const meters = Math.max(0, runtime.distanceDriven - this.distance); this.distance = runtime.distanceDriven;
    this.tank.step(dt, meters, VEHICLES[runtime.vehicleId].kind, stopped);
    this.saveTime += dt;
    if (this.saveTime >= 5) { this.saveTime = 0; this.persist(); }
    if (this.percent < 99 && this.tank.stopTime >= FUEL.stopHold && this.station?.id !== this.visitedBay) this.openPump();
  }
  openPump() {
    const st = useGame.getState();
    if (vehicleEntry.mode !== 'seated' || this.percent >= 100 || !this.inBay || !this.station || !this.vehicleId || !runtime.vehicle || runtime.vehicle.horizontalSpeed() > .3 || st.overlay || st.save.pendingReceipts.length) return false;
    this.visitedBay = this.station.id; this.prompt = { station: this.station, vehicleId: this.vehicleId };
    runtime.vehicle.stopImmediately(); input.reset(); this.persist(); st.openOverlay('fuel'); return true;
  }
  dismiss() { this.prompt = null; useGame.getState().openOverlay(null); }
  fillTank() {
    const st = useGame.getState(), prompt = this.prompt;
    if (st.overlay !== 'fuel' || !prompt || prompt.vehicleId !== runtime.vehicleId || !runtime.vehicle
      || vehicleEntry.mode !== 'seated' || runtime.vehicle.horizontalSpeed() > .3 || !insideFuelBay(prompt.station, runtime.pose.x, runtime.pose.z)) return false;
    // A player with no cash still receives a full tank; the shortfall is charged next time.
    this.refill(prompt.vehicleId);
    this.navigation = null; this.dismiss(); return true;
  }
  private refill(vehicleId: VehicleId) {
    const st = useGame.getState(), bill = fuelBill(st.save);
    st.commit(chargeFullTank(st.save, vehicleId, Date.now()), true);
    this.tank.percent = 100;
    const t = useGame.getState().t;
    st.toast(bill.owed > 0 ? fmt(t.fuelCredit, { amount: money(bill.owed) }) : fmt(t.fuelPaid, { amount: money(bill.paid) }), bill.owed > 0 ? 'warn' : 'good');
  }
  navigateToPump() {
    if (!runtime.vehicle || useGame.getState().appState !== 'PLAYING') return false;
    const p = runtime.pose;
    const options = FUEL_STATIONS.map(station => ({ station, route: routeFrom(p.x, p.z, p.fx, p.fz,
      { segmentId: station.segmentId, s: station.s, bay: true, position: [station.x, station.z] }, VEHICLES[runtime.vehicleId].kind) })).filter(o => o.route);
    options.sort((a, b) => a.route!.length - b.route!.length);
    const best = options[0]; if (!best?.route) return false;
    this.setNavigation(best.station, best.route);
    return true;
  }
  private setNavigation(station: FuelStation, route: Route) {
    this.navigation = { active: true, target: 'fuel', targetBay: station, route, along: 0, remaining: route.length,
      progressIndex: 0, ...routeInstruction(route, 0) };
  }
  towToPump() {
    if (this.percent > 0 || !runtime.vehicle || runtime.vehicle.horizontalSpeed() > .3 || vehicleEntry.mode !== 'seated') return false;
    if (!this.navigation && !this.navigateToPump()) return false;
    const bay = this.navigation!.targetBay; input.reset(); runtime.vehicle.stopImmediately();
    runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading });
    // An empty tank locks the throttle, so the tow arrives refueled instead of waiting on the pump popup.
    if (this.vehicleId) this.refill(this.vehicleId);
    this.navigation = null; this.visitedBay = bay.id; this.tank.stopTime = 0; return true;
  }
  private updateNavigation(dt: number) {
    const n = this.navigation; if (!n) return;
    this.navTime += dt; if (this.navTime < .2) return; this.navTime = 0;
    const p = runtime.pose, progress = progressAlong(n.route, p.x, p.z, n.progressIndex);
    if (progress.offRoute > 18 && !runtime.pendingRecovery) {
      const station = n.targetBay;
      const route = routeFrom(p.x, p.z, p.fx, p.fz, { segmentId: station.segmentId, s: station.s, bay: true,
        position: [station.x, station.z] }, VEHICLES[runtime.vehicleId].kind);
      if (route) this.setNavigation(station, route);
      return;
    }
    n.progressIndex = progress.index; n.along = progress.along; n.remaining = Math.max(0, n.route.length - progress.along);
    Object.assign(n, routeInstruction(n.route, n.along));
  }
  persist() {
    if (!this.vehicleId) return;
    const st = useGame.getState(), percent = Math.round(this.percent * 100) / 100;
    if (st.save.fuelByVehicle[this.vehicleId] === percent) return;
    st.commit({ ...st.save, fuelByVehicle: { ...st.save.fuelByVehicle, [this.vehicleId]: percent }, revision: st.save.revision + 1, updatedAt: Date.now() }, false);
  }
  stationName() { return this.prompt?.station.name ?? this.station?.name ?? ''; }
}
export const fuel = new FuelSystem();
