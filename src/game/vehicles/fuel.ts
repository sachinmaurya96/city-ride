import { useGame } from '../../app/store';
import { FUEL_STATIONS, landmarkName, type Bay } from '../data/cityMap';
import { VEHICLES, type VehicleId, type VehicleKind } from '../data/vehicles';
import { runtime } from '../core/runtime';
import { input } from '../input/input';

// A full tank lasts several rides. Refills are free, including roadside help when empty.
export const FUEL = { rangeMeters: { bike: 6000, auto: 5000, car: 4500, bus: 4000 } as Record<VehicleKind, number>, lowPercent: 20, refillPerSecond: 20, stopHold: 1 };

export class FuelTank {
  percent = 100;
  stopTime = 0;
  refilling = false;

  step(dt: number, meters: number, kind: VehicleKind, stoppedAtPump: boolean) {
    this.percent = Math.max(0, this.percent - Math.max(0, meters) * 100 / FUEL.rangeMeters[kind]);
    this.stopTime = stoppedAtPump ? this.stopTime + dt : 0;
    this.refilling = this.stopTime >= FUEL.stopHold && this.percent < 100;
    if (this.refilling) this.percent = Math.min(100, this.percent + dt * FUEL.refillPerSecond);
  }
}

export class FuelSystem {
  tank = new FuelTank();
  private vehicleId: VehicleId | null = null;
  private distance = 0;
  private saveTime = 0;
  station: Bay | null = null;
  stationDistance = Infinity;

  get percent() { return this.tank.percent; }
  get refilling() { return this.tank.refilling; }

  private loadVehicle() {
    if (this.vehicleId === runtime.vehicleId) return;
    this.persist();
    this.vehicleId = runtime.vehicleId;
    this.tank = new FuelTank();
    this.tank.percent = useGame.getState().save.fuelByVehicle[this.vehicleId] ?? 100;
    this.distance = runtime.distanceDriven;
  }

  step(dt: number) {
    if (useGame.getState().appState !== 'PLAYING' || !runtime.vehicle) return;
    this.loadVehicle();
    this.station = null;
    this.stationDistance = Infinity;
    for (const station of FUEL_STATIONS) {
      const distance = Math.hypot(station.x - runtime.pose.x, station.z - runtime.pose.z);
      if (distance < this.stationDistance) { this.station = station; this.stationDistance = distance; }
    }
    const drive = input.getDrive({ steer: 0, throttle: 0, brake: 0, handbrake: false });
    const bay = this.station;
    const dx = runtime.pose.x - (bay?.x ?? 0);
    const dz = runtime.pose.z - (bay?.z ?? 0);
    const inBay = !!bay && Math.abs(dx * Math.sin(bay.heading) + dz * Math.cos(bay.heading)) <= bay.length / 2
      && Math.abs(dx * Math.cos(bay.heading) - dz * Math.sin(bay.heading)) <= bay.width / 2 + 0.8;
    const stopped = inBay && Math.abs(runtime.telemetry.speed) < 0.3 && drive.throttle < 0.05;
    const meters = Math.max(0, runtime.distanceDriven - this.distance);
    this.distance = runtime.distanceDriven;
    const wasRefilling = this.refilling;
    this.tank.step(dt, meters, VEHICLES[runtime.vehicleId].kind, stopped);
    this.saveTime += dt;
    if (this.saveTime >= 5 || (wasRefilling && !this.refilling)) { this.saveTime = 0; this.persist(); }
  }

  persist() {
    if (!this.vehicleId) return;
    const st = useGame.getState();
    const percent = Math.round(this.percent * 100) / 100;
    if (st.save.fuelByVehicle[this.vehicleId] === percent) return;
    st.commit({ ...st.save, fuelByVehicle: { ...st.save.fuelByVehicle, [this.vehicleId]: percent }, revision: st.save.revision + 1, updatedAt: Date.now() }, false);
  }

  emergencyRefill() {
    if (this.percent > 0 || Math.abs(runtime.telemetry.speed) > 0.3) return;
    this.tank.percent = 15;
    this.persist();
    const st = useGame.getState();
    st.toast(st.t.emergencyFuelAdded, 'good');
  }

  stationName() {
    return this.station ? landmarkName(this.station.landmark, useGame.getState().save.settings.language) : '';
  }
}

export const fuel = new FuelSystem();
