import { useGame } from '../../app/store';
import { FUEL_STATIONS, landmarkName, type Bay } from '../data/cityMap';
import { VEHICLES, type VehicleId, type VehicleKind } from '../data/vehicles';
import { runtime } from '../core/runtime';
import { input } from '../input/input';

export const FUEL = {
  rangeMeters: { bike: 6000, auto: 5000, car: 4500, bus: 4000 } as Record<VehicleKind, number>,
  capacityLiters: { bike: 8, auto: 18, car: 50, bus: 120 } as Record<VehicleKind, number>,
  pricePerLiter: 100, lowPercent: 20, stopHold: .5,
};
export function insideFuelBay(bay: Bay, x: number, z: number) {
  const dx = x - bay.x, dz = z - bay.z;
  return Math.abs(dx * Math.sin(bay.heading) + dz * Math.cos(bay.heading)) <= bay.length / 2
    && Math.abs(dx * Math.cos(bay.heading) - dz * Math.sin(bay.heading)) <= bay.width / 2 + .8;
}
export function fuelQuote(percent: number, target: number, kind: VehicleKind) {
  const level = Math.min(100, Math.max(0, target)), added = Math.max(0, level - percent);
  const liters = Math.round(added * FUEL.capacityLiters[kind]) / 100;
  return { target: level, liters, cost: Math.ceil(liters * FUEL.pricePerLiter) };
}
export class FuelTank {
  percent = 100;
  stopTime = 0;
  refilling = false;
  step(dt: number, meters: number, kind: VehicleKind, stoppedAtPump: boolean) {
    this.percent = Math.max(0, this.percent - Math.max(0, meters) * 100 / FUEL.rangeMeters[kind]);
    this.stopTime = stoppedAtPump ? this.stopTime + dt : 0;
    // Entering the bay only offers a purchase; it never adds fuel or spends money.
    this.refilling = false;
  }
}
export class FuelSystem {
  tank = new FuelTank();
  private vehicleId: VehicleId | null = null;
  private distance = 0;
  private saveTime = 0;
  private visitedBay: string | null = null;
  station: Bay | null = null;
  stationDistance = Infinity;
  inBay = false;
  prompt: { station: Bay; vehicleId: VehicleId } | null = null;
  get percent() { return this.tank.percent; }
  get refilling() { return this.tank.refilling; }
  private loadVehicle() {
    if (this.vehicleId === runtime.vehicleId) return;
    this.persist(); this.vehicleId = runtime.vehicleId; this.tank = new FuelTank();
    this.tank.percent = useGame.getState().save.fuelByVehicle[this.vehicleId] ?? 100;
    this.distance = runtime.distanceDriven; this.visitedBay = null; this.prompt = null;
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
    const drive = input.getDrive({ steer: 0, throttle: 0, brake: 0, handbrake: false });
    const stopped = this.inBay && runtime.vehicle.horizontalSpeed() < .3 && drive.throttle < .05;
    const meters = Math.max(0, runtime.distanceDriven - this.distance); this.distance = runtime.distanceDriven;
    this.tank.step(dt, meters, VEHICLES[runtime.vehicleId].kind, stopped);
    this.saveTime += dt;
    if (this.saveTime >= 5) { this.saveTime = 0; this.persist(); }
    if (this.tank.stopTime >= FUEL.stopHold && this.station?.id !== this.visitedBay) this.openPump();
  }
  openPump() {
    const st = useGame.getState();
    if (!this.inBay || !this.station || !this.vehicleId || !runtime.vehicle || runtime.vehicle.horizontalSpeed() > .3 || st.overlay || st.save.pendingReceipts.length) return false;
    this.visitedBay = this.station.id; this.prompt = { station: this.station, vehicleId: this.vehicleId };
    runtime.vehicle.stopImmediately(); input.reset(); this.persist(); st.openOverlay('fuel'); return true;
  }
  dismiss() { this.prompt = null; useGame.getState().openOverlay(null); }
  purchase(target: number) {
    const st = useGame.getState(), prompt = this.prompt;
    if (!Number.isFinite(target) || st.overlay !== 'fuel' || !prompt || prompt.vehicleId !== runtime.vehicleId || !runtime.vehicle
      || runtime.vehicle.horizontalSpeed() > .3 || !insideFuelBay(prompt.station, runtime.pose.x, runtime.pose.z)) return false;
    const quote = fuelQuote(this.percent, target, VEHICLES[prompt.vehicleId].kind);
    if (quote.liters <= 0 || quote.cost > st.save.wallet) return false;
    // Fuel and wallet are one saved transaction; double taps cannot charge again after dismissal.
    st.commit({ ...st.save, wallet: st.save.wallet - quote.cost,
      fuelByVehicle: { ...st.save.fuelByVehicle, [prompt.vehicleId]: quote.target }, revision: st.save.revision + 1, updatedAt: Date.now() }, true);
    this.tank.percent = quote.target; this.dismiss(); return true;
  }
  persist() {
    if (!this.vehicleId) return;
    const st = useGame.getState(), percent = Math.round(this.percent * 100) / 100;
    if (st.save.fuelByVehicle[this.vehicleId] === percent) return;
    st.commit({ ...st.save, fuelByVehicle: { ...st.save.fuelByVehicle, [this.vehicleId]: percent }, revision: st.save.revision + 1, updatedAt: Date.now() }, false);
  }
  emergencyRefill() {
    if (this.percent > 0 || Math.abs(runtime.telemetry.speed) > .3) return;
    this.tank.percent = 15; this.persist(); const st = useGame.getState(); st.toast(st.t.emergencyFuelAdded, 'good');
  }
  stationName() { return this.station ? landmarkName(this.station.landmark, useGame.getState().save.settings.language) : ''; }
}
export const fuel = new FuelSystem();
