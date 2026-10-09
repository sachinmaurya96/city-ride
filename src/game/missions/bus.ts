import { BAY_BY_ID, SEGMENT_BY_ID, landmarkName, type Bay } from '../data/cityMap';
import { VEHICLES, type VehicleId } from '../data/vehicles';
import { RIDE_TIMING } from '../data/economy';
import { runtime } from '../core/runtime';
import { events } from '../core/events';
import { mulberry32 } from '../core/rng';
import { findRoute, progressAlong, turnType, vehicleMinRadius } from '../navigation/roadGraph';
import { routeFrom } from '../navigation/routing';
import { enforcement } from '../rules/enforcementState';
import { levelForXP, quoteBus, settleBus } from '../progression/progression';
import { useGame } from '../../app/store';
import type { MissionCheckpoint } from '../../storage/schema';
import { checkStop, nav, rideVisual, satisfactionHook } from './rides';

// Bus services (plan §12): fixed multi-stop routes, pre-generated passenger schedule that never
// exceeds capacity, stops served once and in order, whole route credited once at the terminal.

export interface BusRouteDef {
  id: string;
  name: string;
  nameRu: string;
  /** Smallest bus allowed (larger buses may also run it). */
  minVehicle: VehicleId;
  stops: string[]; // bay ids
}

export const BUS_ROUTES: BusRouteDef[] = [
  { id: 'neighborhood', name: 'Neighborhood Link', nameRu: 'Соседская линия', minVehicle: 'bus_small', stops: ['homes_west_bus3', 'cafe_corner_bus3', 'city_mall_bus3'] },
  { id: 'commuter', name: 'Commuter Link', nameRu: 'Линия для работы', minVehicle: 'bus_medium', stops: ['homes_east_bus2', 'city_mall_bus3', 'office_plaza_bus3', 'station_bus3'] },
  { id: 'connector', name: 'City Connector', nameRu: 'Городской экспресс', minVehicle: 'bus_long', stops: ['bus_depot_bus2', 'hotel_bus3', 'city_mall_bus3', 'station_bus3', 'airport_bus3'] },
];

const BUS_ORDER: VehicleId[] = ['bus_small', 'bus_medium', 'bus_long'];

export function routeEligible(route: BusRouteDef, vehicle: VehicleId) {
  return VEHICLES[vehicle].kind === 'bus' && BUS_ORDER.indexOf(vehicle) >= BUS_ORDER.indexOf(route.minVehicle);
}

export interface Group {
  from: number;
  to: number;
  size: number;
}

/** Seeded passenger schedule; occupancy after boarding at every stop stays ≤ capacity. */
export function planGroups(stops: number, capacity: number, seed: number): Group[] {
  const rng = mulberry32(seed);
  const groups: Group[] = [];
  let onboard = 0;
  for (let i = 0; i < stops - 1; i++) {
    onboard -= groups.filter((g) => g.to === i).reduce((a, g) => a + g.size, 0);
    const target = Math.max(1, Math.round(capacity * (0.35 + rng() * 0.35)));
    let room = capacity - onboard;
    let want = Math.min(room, Math.max(1, target - Math.floor(onboard / 2)));
    while (want > 0 && room > 0) {
      const size = Math.min(want, room, 1 + Math.floor(rng() * 4));
      const to = i + 1 + Math.floor(rng() * (stops - 1 - i));
      groups.push({ from: i, to, size });
      onboard += size;
      room -= size;
      want -= size;
    }
  }
  return groups;
}

export function maxOccupancy(groups: Group[], stops: number) {
  let on = 0;
  let max = 0;
  for (let i = 0; i < stops; i++) {
    on -= groups.filter((g) => g.to === i).reduce((a, g) => a + g.size, 0);
    on += groups.filter((g) => g.from === i).reduce((a, g) => a + g.size, 0);
    max = Math.max(max, on);
  }
  return max;
}

export function routeMeters(route: BusRouteDef, vehicle: VehicleId) {
  let total = 0;
  const minR = vehicleMinRadius(vehicle);
  for (let i = 0; i < route.stops.length - 1; i++) {
    const a = BAY_BY_ID.get(route.stops[i])!;
    const b = BAY_BY_ID.get(route.stops[i + 1])!;
    const r = findRoute(SEGMENT_BY_ID.get(a.segmentId)!, a.s, { segmentId: b.segmentId, s: b.s, bay: true }, 'bus', { minTurnRadius: minR });
    if (!r) return null;
    total += r.length;
  }
  return total;
}

export function previewRoute(route: BusRouteDef, vehicle: VehicleId, seed: number) {
  const cap = VEHICLES[vehicle].passengerSeats;
  const groups = planGroups(route.stops.length, cap, seed);
  const meters = routeMeters(route, vehicle) ?? 0;
  const planned = groups.reduce((a, g) => a + g.size, 0);
  return { groups, meters, planned, quote: quoteBus(meters, planned), estMinutes: Math.max(2, Math.round((meters / 7 + route.stops.length * 12) / 60)) };
}

type BusPhase = 'DRIVING' | 'STOPPED';

class BusService {
  active = false;
  mission: MissionCheckpoint | null = null;
  route: BusRouteDef | null = null;
  private phase: BusPhase = 'DRIVING';
  private stopTimer = 0;
  private phaseTimer = 0;
  private navAcc = 0;
  private cpAcc = 0;
  private offRoute = 0;
  private lastReroute = 0;
  private boarding = 0;
  private alighting = 0;

  start(routeId: string) {
    const st = useGame.getState();
    const vehicle = st.save.equippedVehicleId as VehicleId;
    const route = BUS_ROUTES.find((r) => r.id === routeId);
    if (!route || !routeEligible(route, vehicle) || st.save.mission || this.active) return false;
    const seed = Math.floor(Math.random() * 1e9);
    const pv = previewRoute(route, vehicle, seed);
    if (maxOccupancy(pv.groups, route.stops.length) > VEHICLES[vehicle].passengerSeats) return false;
    const id = `b${Date.now().toString(36)}`;
    this.mission = {
      id,
      kind: 'bus',
      seed,
      state: 'BUS_ROUTE',
      vehicleId: vehicle,
      passengerName: route.name,
      avatar: 0,
      partySize: 0,
      rideType: 'bus',
      pickupBayId: route.stops[0],
      dropBayId: route.stops[route.stops.length - 1],
      quote: { baseFare: pv.quote, routeMeters: Math.round(pv.meters), typeMultiplier: 1, serviceMultiplier: 1, rain: false, estSeconds: pv.estMinutes * 60, deadlineSeconds: null, timeBonus: 0, tutorial: false },
      elapsed: 0,
      satisfaction: 100,
      finesPaid: 0,
      incidents: 0,
      recovered: false,
      harshEvents: 0,
      safePose: runtime.lastSafePose,
      bus: { routeId: route.id, stops: route.stops.map((b) => ({ bayId: b, landmark: BAY_BY_ID.get(b)!.landmark })), groups: pv.groups, nextStop: 0, onboard: 0, delivered: 0, satisfactionSum: 0, satisfactionSamples: 0 },
    };
    this.route = route;
    this.active = true;
    enforcement.jobIncidents = 0;
    nav.satisfaction = 100;
    this.enterDriving();
    this.checkpoint(true);
    events.emit({ type: 'RIDE_ACCEPTED', id });
    return true;
  }

  restore(m: MissionCheckpoint) {
    if (!m.bus) return;
    const route = BUS_ROUTES.find((r) => r.id === m.bus!.routeId);
    if (!route) return;
    this.mission = structuredClone(m);
    this.route = route;
    this.active = true;
    nav.satisfaction = m.satisfaction;
    this.enterDriving();
  }

  private bay(i: number): Bay {
    return BAY_BY_ID.get(this.route!.stops[i])!;
  }

  private setRoute() {
    const b = this.mission!.bus!;
    const bay = this.bay(b.nextStop);
    const p = runtime.pose;
    nav.route = routeFrom(p.x, p.z, p.fx, p.fz, { segmentId: bay.segmentId, s: bay.s, bay: true }, 'bus', { minTurnRadius: vehicleMinRadius(runtime.vehicleId) });
    nav.routeVersion++;
    nav.progressIndex = 0;
    nav.target = 'bus';
    nav.targetBay = bay;
    nav.active = true;
    this.offRoute = 0;
    this.lastReroute = runtime.simTime;
  }

  private enterDriving() {
    this.phase = 'DRIVING';
    this.stopTimer = 0;
    const b = this.mission!.bus!;
    const bay = this.bay(b.nextStop);
    const boardingHere = b.groups.filter((g) => g.from === b.nextStop).reduce((a, g) => a + g.size, 0);
    rideVisual.waitingBay = boardingHere > 0 ? bay : null;
    rideVisual.partySize = Math.max(1, boardingHere);
    rideVisual.seed = this.mission!.seed + b.nextStop;
    rideVisual.boardProgress = -1;
    rideVisual.alightBay = null;
    rideVisual.alightProgress = -1;
    rideVisual.onboard = false;
    this.setRoute();
    this.publish();
  }

  private publish() {
    const b = this.mission!.bus!;
    useGame.getState().setRide({
      stage: 'BUS',
      offer: null,
      passengerName: this.route!.name,
      partySize: b.onboard,
      rideType: 'bus',
      pickupName: landmarkName(this.bay(0).landmark, useGame.getState().save.settings.language),
      dropName: landmarkName(this.bay(this.route!.stops.length - 1).landmark, useGame.getState().save.settings.language),
      baseFare: this.mission!.quote.baseFare,
      tutorial: false,
      deadline: null,
      bus: {
        routeName: this.route!.name,
        stopNames: this.route!.stops.map((s) => landmarkName(BAY_BY_ID.get(s)!.landmark, useGame.getState().save.settings.language)),
        nextStop: b.nextStop,
        onboard: b.onboard,
        capacity: VEHICLES[runtime.vehicleId].passengerSeats,
        delivered: b.delivered,
      },
    });
  }

  checkpoint(immediate: boolean) {
    const m = this.mission;
    if (!m) return;
    m.safePose = runtime.lastSafePose ?? m.safePose;
    m.satisfaction = nav.satisfaction;
    m.incidents = enforcement.jobIncidents;
    const st = useGame.getState();
    const s = structuredClone(st.save);
    const finesPaid = s.mission?.id === m.id ? s.mission.finesPaid : m.finesPaid;
    s.mission = { ...structuredClone(m), finesPaid };
    s.revision++;
    s.updatedAt = Date.now();
    st.commit(s, immediate);
  }

  /** Abandon/capture: no completion fare (plan §12.3). */
  cancel() {
    if (!this.active || !this.mission) return;
    const st = useGame.getState();
    if (st.save.mission?.id === this.mission.id) {
      const s = structuredClone(st.save);
      s.mission = null;
      s.revision++;
      st.commit(s, true);
    }
    events.emit({ type: 'RIDE_CANCELLED', id: this.mission.id });
    this.clear();
  }

  private clear() {
    this.active = false;
    this.mission = null;
    this.route = null;
    nav.active = false;
    nav.route = null;
    nav.targetBay = null;
    nav.routeVersion++;
    rideVisual.waitingBay = null;
    rideVisual.alightBay = null;
    rideVisual.boardProgress = -1;
    rideVisual.alightProgress = -1;
    if (runtime.vehicle) runtime.vehicle.holdBrake = false;
    useGame.getState().resetRide();
  }

  penalize(p: number) {
    if (this.active) nav.satisfaction = Math.max(0, nav.satisfaction - p);
  }

  tick(dt: number) {
    if (!this.active || !this.mission || useGame.getState().appState !== 'PLAYING') return;
    const m = this.mission;
    const b = m.bus!;
    m.elapsed += dt;
    if (b.onboard > 0) {
      b.satisfactionSum += nav.satisfaction * dt;
      b.satisfactionSamples += dt;
    }
    if (this.phase === 'DRIVING') {
      const bay = this.bay(b.nextStop);
      const chk = checkStop(bay, VEHICLES[runtime.vehicleId], true);
      this.stopTimer = chk.ok ? this.stopTimer + dt : 0;
      nav.stopProgress = chk.inBay ? Math.min(1, this.stopTimer / RIDE_TIMING.stopHold) : 0;
      nav.stopHint = chk.distance > 30 ? '' : !chk.noPursuit ? 'hintPursuit' : !chk.inBay ? 'hintNotInBay' : !chk.aligned ? 'hintAngle' : !chk.noThrottle ? 'hintThrottle' : !chk.slow ? 'hintTooFast' : '';
      if (this.stopTimer >= RIDE_TIMING.stopHold) {
        this.phase = 'STOPPED';
        this.phaseTimer = 0;
        if (runtime.vehicle) runtime.vehicle.holdBrake = true;
        this.alighting = b.groups.filter((g) => g.to === b.nextStop).reduce((a, g) => a + g.size, 0);
        this.boarding = b.groups.filter((g) => g.from === b.nextStop).reduce((a, g) => a + g.size, 0);
        rideVisual.boardProgress = this.boarding > 0 ? 0 : -1;
        if (this.alighting > 0) {
          rideVisual.alightBay = bay;
          rideVisual.alightProgress = 0;
          rideVisual.partySize = Math.max(1, this.alighting);
        }
        busDoor.open = true;
        return;
      }
      this.navAcc += dt;
      if (this.navAcc > 0.2) {
        this.navAcc = 0;
        this.updateNav();
      }
      this.cpAcc += dt;
      if (this.cpAcc > 15) {
        this.cpAcc = 0;
        this.checkpoint(false);
      }
      return;
    }
    // STOPPED: doors open, alight then board, close after ~2.5 s
    this.phaseTimer += dt;
    const dur = 2.6;
    const t = Math.min(1, this.phaseTimer / dur);
    if (this.boarding > 0) rideVisual.boardProgress = t;
    if (this.alighting > 0) rideVisual.alightProgress = t;
    if (this.phaseTimer >= dur) {
      busDoor.open = false;
      // the stop counts exactly once, in order
      b.onboard = b.onboard - this.alighting + this.boarding;
      b.delivered += this.alighting;
      events.emit({ type: 'BUS_STOP_SERVED', stop: b.nextStop });
      if (runtime.vehicle) runtime.vehicle.holdBrake = false;
      if (b.nextStop >= this.route!.stops.length - 1) {
        this.complete();
        return;
      }
      b.nextStop += 1;
      this.enterDriving();
      this.checkpoint(true);
    }
  }

  private complete() {
    const m = this.mission!;
    const b = m.bus!;
    const st = useGame.getState();
    const finesPaid = st.save.mission?.id === m.id ? st.save.mission.finesPaid : m.finesPaid;
    const before = levelForXP(st.save.totalXP);
    const avg = b.satisfactionSamples > 0 ? b.satisfactionSum / b.satisfactionSamples : nav.satisfaction;
    const planned = b.groups.reduce((a, g) => a + g.size, 0);
    const res = settleBus(
      st.save,
      {
        missionId: m.id,
        routeName: this.route!.name,
        fromName: landmarkName(this.bay(0).landmark, useGame.getState().save.settings.language),
        toName: landmarkName(this.bay(this.route!.stops.length - 1).landmark, useGame.getState().save.settings.language),
        quote: m.quote.baseFare,
        stops: this.route!.stops.length,
        delivered: Math.min(b.delivered, planned),
        avgSatisfaction: avg,
        clean: enforcement.jobIncidents === 0 && !m.recovered,
        finesPaid,
      },
      Date.now(),
    );
    if (!res.duplicate) {
      st.commit(res.save, true);
      events.emit({ type: 'RIDE_COMPLETED', id: m.id, net: res.receipt.net });
      const after = levelForXP(res.save.totalXP);
      if (after > before) events.emit({ type: 'LEVEL_UP', level: after });
    }
    this.clear();
    useGame.getState().setRide({ stage: 'COMPLETED' });
  }

  markRecovered() {
    if (this.mission) this.mission.recovered = true;
    if (this.active) this.setRoute();
  }

  private updateNav() {
    const r = nav.route;
    const p = runtime.pose;
    if (!r) {
      if (runtime.simTime - this.lastReroute > 1) this.setRoute();
      return;
    }
    const prog = progressAlong(r, p.x, p.z, nav.progressIndex);
    nav.progressIndex = prog.index;
    nav.along = prog.along;
    nav.remaining = Math.max(0, r.length - prog.along);
    if (prog.offRoute > 15) this.offRoute += 0.2;
    else this.offRoute = 0;
    // driving past a stop → legal return route, never an instant fail
    if (this.offRoute >= 1.5 && runtime.simTime - this.lastReroute >= 1) {
      this.setRoute();
      const st = useGame.getState();
      st.toast(st.t.missedStop, 'info');
      return;
    }
    let acc = 0;
    let found: 'left' | 'right' | null = null;
    let dist = 0;
    for (let i = 0; i < r.segments.length; i++) {
      const segLen = (i === r.segments.length - 1 ? r.goalS : r.segments[i].length) - (i === 0 ? r.startS : 0);
      acc += segLen + (i < r.segments.length - 1 ? 22 : 0);
      if (acc < prog.along || i >= r.segments.length - 1) continue;
      const tt = turnType(r.segments[i], r.segments[i + 1]);
      if (tt === 'left' || tt === 'right') {
        found = tt;
        dist = acc - 22 - prog.along;
        break;
      }
    }
    if (nav.remaining < 45) {
      nav.instruction = nav.remaining < 20 ? 'stop' : 'arriving';
      nav.instructionDist = nav.remaining;
    } else if (found) {
      nav.instruction = found;
      nav.instructionDist = Math.max(0, dist);
    } else {
      nav.instruction = 'continue';
      nav.instructionDist = nav.remaining;
    }
  }
}

/** Visual door state for the player bus model. */
export const busDoor = { open: false };

export const busService = new BusService();
satisfactionHook.bus = (p) => busService.penalize(p);
