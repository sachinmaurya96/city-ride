import { CAR_BOARD_SECONDS, CAR_ALIGHT_SECONDS, vehicleEntry } from '../vehicles/entry';
import { BAYS, BAY_BY_ID, DIR_VEC, FUEL_STATIONS, LANDMARK_BY_ID, SEGMENT_BY_ID, garageSpawn, landmarkName, type Bay } from '../data/cityMap';
import { VEHICLES, type VehicleId, type VehicleSpec } from '../data/vehicles';
import { RIDE_TIMING, SATISFACTION } from '../data/economy';
import { runtime } from '../core/runtime';
import { events } from '../core/events';
import { mulberry32, pick, type Rng } from '../core/rng';
import { input } from '../input/input';
import { findRoute, progressAlong, turnType, type Route } from '../navigation/roadGraph';
import { routeFrom } from '../navigation/routing';
import { enforcement } from '../rules/enforcementState';
import { levelForXP, quoteRide, settleRide, dismissReceipt } from '../progression/progression';
import { useGame, type OfferView } from '../../app/store';
import type { MissionCheckpoint, Quote } from '../../storage/schema';
import { deriveHandling } from '../vehicles/handling';

export const PASSENGER_NAMES = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Anaya', 'Ishaan', 'Priya', 'Arjun', 'Sara', 'Vikram', 'Nisha', 'Leo', 'Maya', 'Zoya', 'Dev', 'Tara', 'Neel', 'Asha', 'Omar', 'Ira', 'Kiran', 'Elena', 'Sam'];
export const AVATARS = ['🧑', '👩', '👨', '👧', '🧔', '👩‍🦱', '👨‍🦱', '👵', '👴', '🧑‍💼', '👩‍💼', '🧕'];

export type Stage = 'IDLE' | 'OFFERED' | 'TO_PICKUP' | 'BOARDING' | 'TO_DROPOFF' | 'ALIGHTING' | 'COMPLETED';

interface Offer {
  id: string;
  seed: number;
  pickup: Bay;
  drop: Bay;
  passengerName: string;
  avatar: number;
  partySize: number;
  rideType: string;
  quote: Quote;
  pickupMeters: number;
  expiresAt: number;
}

export interface StopCheck {
  inBay: boolean;
  slow: boolean;
  aligned: boolean;
  noThrottle: boolean;
  capacity: boolean;
  noPursuit: boolean;
  ok: boolean;
  distance: number;
}

/** Navigation readout for the HUD (refreshed ~5 Hz; polled, not pushed into React each frame). */
export const nav = {
  active: false,
  target: 'pickup' as 'pickup' | 'dropoff' | 'bus',
  instruction: 'continue' as 'continue' | 'left' | 'right' | 'stop' | 'arriving',
  instructionDist: 0,
  remaining: 0,
  route: null as Route | null,
  routeVersion: 0,
  progressIndex: 0,
  along: 0,
  stopProgress: 0,
  stopHint: '' as '' | 'hintTooFast' | 'hintNotInBay' | 'hintAngle' | 'hintThrottle' | 'hintPursuit',
  targetBay: null as Bay | null,
  satisfaction: 100,
  elapsed: 0,
};

/** Satisfaction penalties during a bus route are routed to the bus service. */
export const satisfactionHook: { bus: ((points: number) => void) | null } = { bus: null };

/** Visual state for passengers (read each frame by the renderer). */
export const rideVisual = {
  waitingBay: null as Bay | null,
  partySize: 1,
  seed: 0,
  passengerName: '',
  boardProgress: -1, // 0..1 while boarding, -1 otherwise
  onboard: false,
  alightBay: null as Bay | null,
  alightProgress: -1,
  stopPose: null as { x: number; z: number; heading: number } | null,
  departureAt: -1,
};

function bayDir(b: Bay) {
  const seg = SEGMENT_BY_ID.get(b.segmentId)!;
  return DIR_VEC[seg.dir];
}

export function checkStop(bay: Bay, spec: VehicleSpec, capacityOk: boolean): StopCheck {
  const p = runtime.pose;
  const [dx, dz] = bayDir(bay);
  const lx = dz;
  const lz = -dx;
  const rx = p.x - bay.x;
  const rz = p.z - bay.z;
  const ds = rx * dx + rz * dz;
  const dl = rx * lx + rz * lz;
  const allowS = Math.max(2.5, bay.length / 2 - spec.length / 2 + 1.6);
  const inBay = Math.abs(ds) <= allowS && Math.abs(dl) <= bay.width / 2 + 0.9;
  const aligned = p.fx * dx + p.fz * dz >= Math.cos((RIDE_TIMING.maxHeadingDeg * Math.PI) / 180);
  const slow = Math.abs(runtime.telemetry.speed) <= RIDE_TIMING.maxStopSpeed;
  const drive = input.getDrive({ steer: 0, throttle: 0, brake: 0, handbrake: false });
  const noThrottle = drive.throttle < 0.05;
  const noPursuit = !enforcement.pursuit;
  return { inBay, slow, aligned, noThrottle, capacity: capacityOk, noPursuit, ok: inBay && slow && aligned && noThrottle && capacityOk && noPursuit, distance: Math.hypot(rx, rz) };
}

function routeMetersBetween(a: Bay, b: Bay, kind: VehicleSpec['kind']) {
  const r = findRoute(SEGMENT_BY_ID.get(a.segmentId)!, a.s, { segmentId: b.segmentId, s: b.s }, kind);
  return r ? r.length : null;
}

/**
 * Point-to-point ride state machine (plan §9.2). Owns offers, the active ride, routing,
 * stop detection and the single settlement call. React only displays its snapshots.
 */
export class RideSystem {
  stage: Stage = 'IDLE';
  offer: Offer | null = null;
  mission: MissionCheckpoint | null = null;
  private offerTimer = 4;
  private stopTimer = 0;
  private phaseTimer = 0;
  private navAcc = 0;
  private checkpointAcc = 0;
  private offRouteTime = 0;
  private lastReroute = 0;
  private harshCooldown = 0;
  private recent: string[] = [];
  private rng: Rng = mulberry32((Date.now() & 0xffff) ^ 0x5eed);
  private counter = 0;

  get spec() {
    return VEHICLES[runtime.vehicleId];
  }

  /** Restore an in-progress ride from a saved checkpoint (safe checkpoint, not exact physics). */
  restore(m: MissionCheckpoint | null) {
    this.reset();
    if (!m || m.kind !== 'ride') return;
    const pickup = BAY_BY_ID.get(m.pickupBayId);
    const drop = BAY_BY_ID.get(m.dropBayId);
    if (!pickup || !drop) return;
    this.mission = structuredClone(m);
    nav.satisfaction = m.satisfaction;
    nav.elapsed = m.elapsed;
    if (m.state === 'TO_PICKUP') this.enterToPickup(false);
    else if (m.state === 'TO_DROPOFF') this.enterToDropoff(false, true);
  }

  reset(keepDeparture = false) {
    this.stage = 'IDLE';
    this.offer = null;
    this.mission = null;
    this.offerTimer = 3;
    this.stopTimer = 0;
    nav.active = false;
    nav.route = null;
    nav.targetBay = null;
    nav.routeVersion++;
    rideVisual.waitingBay = null;
    rideVisual.onboard = false;
    rideVisual.boardProgress = -1;
    if (!keepDeparture) {
      rideVisual.alightBay = null;
      rideVisual.alightProgress = -1;
      rideVisual.stopPose = null;
      rideVisual.departureAt = -1;
    }
    if (runtime.vehicle) runtime.vehicle.holdBrake = false;
    useGame.getState().resetRide();
  }

  // ---------- offers ----------

  private makeOffer(): Offer | null {
    const st = useGame.getState();
    const save = st.save;
    const spec = this.spec;
    if (spec.kind === 'bus') return null;
    const level = levelForXP(save.totalXP);
    const rain = st.weather === 'rain';
    const seed = Math.floor(this.rng() * 1e9);
    const rng = mulberry32(seed);
    const id = `r${Date.now().toString(36)}${(this.counter++).toString(36)}`;
    if (!save.tutorial.firstRideDone && !save.tutorial.skipped && spec.id === 'bike_basic') {
      const pickup = BAY_BY_ID.get('homes_west_bay2')!;
      const drop = BAY_BY_ID.get('central_park_bay1')!;
      const len = routeMetersBetween(pickup, drop, spec.kind) ?? 220;
      const toPick = this.routeFromPlayer(pickup)?.length ?? 300;
      return {
        id,
        seed,
        pickup,
        drop,
        passengerName: 'Aarav',
        avatar: 0,
        partySize: 1,
        rideType: 'standard',
        quote: quoteRide({ routeMeters: len, vehicleId: spec.id, rideType: 'standard', rain: false, estSeconds: len / 7 + 10, tutorial: true }),
        pickupMeters: toPick,
        expiresAt: Infinity,
      };
    }
    const candidates = BAYS.filter((b) => !b.bus && !FUEL_STATIONS.includes(b) && b.allowed.includes(spec.kind));
    const maxPick = 650 + level * 60;
    const [minLen, maxLen] = level <= 2 ? [220, 650] : level <= 5 ? [300, 1000] : [350, 1500];
    for (let attempt = 0; attempt < 14; attempt++) {
      const pickup = pick(rng, candidates);
      const toPickRoute = this.routeFromPlayer(pickup);
      if (!toPickRoute || toPickRoute.length < 60 || toPickRoute.length > maxPick) continue;
      const drops = candidates.filter((b) => b.landmark !== pickup.landmark);
      const drop = pick(rng, drops);
      const pairKey = `${pickup.landmark}>${drop.landmark}`;
      if (this.recent.includes(pairKey)) continue;
      const len = routeMetersBetween(pickup, drop, spec.kind);
      if (len === null || len < minLen || len > maxLen) continue;
      // Ride type eligibility (capacity verified before the offer).
      const types: string[] = ['standard', 'standard'];
      const jobs = save.lifetime.jobs;
      if (spec.jobs.includes('office') && jobs >= 3 && (drop.landmark === 'office_plaza' || pickup.landmark === 'office_plaza')) types.push('office', 'office');
      if (spec.jobs.includes('family') && spec.passengerSeats >= 2) types.push('family');
      if (spec.jobs.includes('airport') && (drop.landmark === 'airport' || pickup.landmark === 'airport')) types.push('airport', 'airport');
      if (spec.jobs.includes('vip') && (drop.landmark === 'hotel' || pickup.landmark === 'hotel' || spec.id === 'supercar')) types.push('vip', 'vip');
      if (rain && spec.jobs.includes('rain') && jobs >= 5) types.push('rain');
      const rideType = pick(rng, types);
      let party = 1;
      if (rideType === 'family') party = 2 + Math.floor(rng() * (Math.min(6, spec.passengerSeats) - 1));
      else if (spec.passengerSeats >= 2 && rng() < 0.3) party = 2;
      if (party > spec.passengerSeats) continue;
      const est = len / 7.5 + 12;
      const quote = quoteRide({ routeMeters: len, vehicleId: spec.id, rideType, rain, estSeconds: est });
      return {
        id,
        seed,
        pickup,
        drop,
        passengerName: pick(rng, PASSENGER_NAMES),
        avatar: Math.floor(rng() * AVATARS.length),
        partySize: party,
        rideType,
        quote,
        pickupMeters: toPickRoute.length,
        expiresAt: runtime.simTime + RIDE_TIMING.offerExpiry,
      };
    }
    return null;
  }

  private publishOffer(o: Offer) {
    const view: OfferView = {
      id: o.id,
      passengerName: o.passengerName,
      avatar: o.avatar,
      partySize: o.partySize,
      rideType: o.rideType,
      pickupName: landmarkName(o.pickup.landmark, useGame.getState().save.settings.language),
      dropName: landmarkName(o.drop.landmark, useGame.getState().save.settings.language),
      routeMeters: o.quote.routeMeters,
      pickupMeters: Math.round(o.pickupMeters),
      estSeconds: o.quote.estSeconds,
      baseFare: o.quote.baseFare,
      tutorial: o.quote.tutorial,
      rain: o.quote.rain,
      deadlineSeconds: o.quote.deadlineSeconds,
      expiresAt: o.expiresAt,
    };
    useGame.getState().setRide({ stage: 'OFFERED', offer: view });
  }

  accept(offerId?: string) {
    if (this.stage !== 'OFFERED' || !this.offer) return false;
    if (offerId && offerId !== this.offer.id) return false;
    const o = this.offer;
    this.offer = null;
    const spec = this.spec;
    if (o.partySize > spec.passengerSeats) return false;
    this.recent = [...this.recent, `${o.pickup.landmark}>${o.drop.landmark}`].slice(-4);
    this.mission = {
      id: o.id,
      kind: 'ride',
      seed: o.seed,
      state: 'TO_PICKUP',
      vehicleId: spec.id,
      passengerName: o.passengerName,
      avatar: o.avatar,
      partySize: o.partySize,
      rideType: o.rideType,
      pickupBayId: o.pickup.id,
      dropBayId: o.drop.id,
      quote: o.quote,
      elapsed: 0,
      satisfaction: 100,
      finesPaid: 0,
      incidents: 0,
      recovered: false,
      harshEvents: 0,
      safePose: runtime.lastSafePose,
      bus: null,
    };
    enforcement.jobIncidents = 0;
    nav.satisfaction = 100;
    nav.elapsed = 0;
    this.enterToPickup(true);
    events.emit({ type: 'RIDE_ACCEPTED', id: o.id });
    return true;
  }

  decline() {
    if (this.stage !== 'OFFERED') return;
    this.offer = null;
    this.stage = 'IDLE';
    this.offerTimer = RIDE_TIMING.declineCooldown;
    useGame.getState().setRide({ stage: 'IDLE', offer: null });
  }

  /** Cancel the active job: no fare, no fee, reservations released (plan §9.7). */
  cancel() {
    if (!this.mission || this.stage === 'COMPLETED') return;
    const id = this.mission.id;
    const st = useGame.getState();
    const s = structuredClone(st.save);
    s.mission = null;
    s.revision++;
    s.updatedAt = Date.now();
    st.commit(s);
    events.emit({ type: 'RIDE_CANCELLED', id });
    this.reset();
    this.offerTimer = RIDE_TIMING.cancelCooldown;
    st.toast(st.t.cancelled, 'info');
  }

  /** Police capture: fail the job with no completion reward (fine handled by police system). */
  fail(reason: string) {
    if (!this.mission) return;
    const id = this.mission.id;
    const st = useGame.getState();
    if (st.save.mission?.id === id) {
      const s = structuredClone(st.save);
      s.mission = null;
      s.revision++;
      st.commit(s);
    }
    events.emit({ type: 'RIDE_FAILED', id, reason });
    this.reset();
    this.offerTimer = 8;
  }

  /** Weather changes only between jobs, never during a ride; rain unlocks after basic mastery. */
  chooseWeather() {
    const st = useGame.getState();
    const mastered = st.save.lifetime.jobs >= 5 && levelForXP(st.save.totalXP) >= 3;
    const next = mastered && this.rng() < 0.25 ? 'rain' : 'sunny';
    if (next !== st.weather) {
      st.setWeather(next);
      if (next === 'rain') st.toast(st.t.rainStarted, 'info');
    }
  }

  /** "Next ride" on the receipt: dismiss the already-settled receipt (never pays again). */
  nextRide() {
    this.chooseWeather();
    const st = useGame.getState();
    const r = st.save.pendingReceipts[0];
    if (r) st.commit(dismissReceipt(st.save, r.id, Date.now()));
    if (this.stage === 'COMPLETED') {
      this.reset(true);
      this.offerTimer = 2;
    } else if (useGame.getState().ride.stage === 'COMPLETED') {
      useGame.getState().resetRide(); // after a bus route
    }
  }

  // ---------- transitions ----------

  private routeFromPlayer(bay: Bay) {
    const p = runtime.pose;
    return routeFrom(p.x, p.z, p.fx, p.fz, { segmentId: bay.segmentId, s: bay.s, bay: true }, this.spec.kind);
  }

  private setRoute(bay: Bay, target: 'pickup' | 'dropoff') {
    nav.route = this.routeFromPlayer(bay);
    nav.routeVersion++;
    nav.progressIndex = 0;
    nav.target = target;
    nav.targetBay = bay;
    nav.active = true;
    this.offRouteTime = 0;
    this.lastReroute = runtime.simTime;
    this.updateNav();
  }

  private enterToPickup(save: boolean) {
    const m = this.mission!;
    this.stage = 'TO_PICKUP';
    m.state = 'TO_PICKUP';
    const pickup = BAY_BY_ID.get(m.pickupBayId)!;
    rideVisual.waitingBay = pickup;
    rideVisual.partySize = m.partySize;
    rideVisual.seed = m.seed;
    rideVisual.passengerName = m.passengerName;
    rideVisual.onboard = false;
    rideVisual.boardProgress = -1;
    rideVisual.alightBay = null;
    rideVisual.alightProgress = -1;
    rideVisual.departureAt = -1;
    rideVisual.stopPose = null;
    this.setRoute(pickup, 'pickup');
    this.publishActive();
    if (save) this.checkpoint(true);
  }

  private enterToDropoff(save: boolean, restored = false) {
    const m = this.mission!;
    this.stage = 'TO_DROPOFF';
    m.state = 'TO_DROPOFF';
    rideVisual.waitingBay = null;
    rideVisual.onboard = true;
    rideVisual.partySize = m.partySize;
    rideVisual.seed = m.seed;
    rideVisual.passengerName = m.passengerName;
    rideVisual.boardProgress = -1;
    this.setRoute(BAY_BY_ID.get(m.dropBayId)!, 'dropoff');
    this.publishActive();
    if (save) this.checkpoint(true);
    if (!restored) events.emit({ type: 'PASSENGER_BOARDED', id: m.id });
  }

  private publishActive() {
    const m = this.mission!;
    useGame.getState().setRide({
      stage: this.stage,
      offer: null,
      passengerName: m.passengerName,
      avatar: m.avatar,
      partySize: m.partySize,
      rideType: m.rideType,
      pickupName: landmarkName(BAY_BY_ID.get(m.pickupBayId)!.landmark, useGame.getState().save.settings.language),
      dropName: landmarkName(BAY_BY_ID.get(m.dropBayId)!.landmark, useGame.getState().save.settings.language),
      baseFare: m.quote.baseFare,
      tutorial: m.quote.tutorial,
      deadline: m.quote.deadlineSeconds,
      bus: null,
    });
  }

  /** Persist a safe mission checkpoint. */
  checkpoint(immediate: boolean) {
    const m = this.mission;
    if (!m) return;
    m.safePose = runtime.lastSafePose ?? m.safePose;
    m.satisfaction = nav.satisfaction;
    m.elapsed = nav.elapsed;
    m.incidents = enforcement.jobIncidents;
    const st = useGame.getState();
    const s = structuredClone(st.save);
    // keep fines already debited during this job (owned by the save)
    const finesPaid = s.mission?.id === m.id ? s.mission.finesPaid : m.finesPaid;
    s.mission = { ...structuredClone(m), finesPaid };
    s.lifetime.distanceM = Math.floor(runtime.distanceDriven);
    s.revision++;
    s.updatedAt = Date.now();
    st.commit(s, immediate);
  }

  private complete() {
    const m = this.mission!;
    const st = useGame.getState();
    const finesPaid = st.save.mission?.id === m.id ? st.save.mission.finesPaid : m.finesPaid;
    const clean = enforcement.jobIncidents === 0 && !m.recovered;
    const drop = BAY_BY_ID.get(m.dropBayId)!;
    const pickupLm = LANDMARK_BY_ID.get(BAY_BY_ID.get(m.pickupBayId)!.landmark)!;
    const dropLm = LANDMARK_BY_ID.get(drop.landmark)!;
    const before = levelForXP(st.save.totalXP);
    const base = structuredClone(st.save);
    base.lifetime.distanceM = Math.floor(runtime.distanceDriven);
    const res = settleRide(
      base,
      {
        missionId: m.id,
        quote: m.quote,
        satisfaction: nav.satisfaction,
        finesPaid,
        clean,
        elapsed: nav.elapsed,
        partySize: m.partySize,
        rideType: m.rideType,
        fromName: landmarkName(pickupLm.id, st.save.settings.language),
        toName: landmarkName(dropLm.id, st.save.settings.language),
        toLandmark: dropLm.id,
      },
      Date.now(),
    );
    if (!res.duplicate) {
      st.commit(res.save, true);
      enforcement.protectedRides = Math.max(0, enforcement.protectedRides - 1);
      events.emit({ type: 'RIDE_COMPLETED', id: m.id, net: res.receipt.net });
      const after = levelForXP(res.save.totalXP);
      if (after > before) events.emit({ type: 'LEVEL_UP', level: after });
    }
    this.stage = 'COMPLETED';
    this.mission = null;
    nav.active = false;
    nav.route = null;
    nav.targetBay = null;
    nav.routeVersion++;
    rideVisual.onboard = false;
    rideVisual.departureAt = runtime.simTime;
    if (runtime.vehicle) runtime.vehicle.holdBrake = false;
    useGame.getState().setRide({ stage: 'COMPLETED' });
  }

  // ---------- per-step update ----------

  tick(dt: number) {
    const st = useGame.getState();
    if (st.appState !== 'PLAYING') return;
    switch (this.stage) {
      case 'IDLE': {
        if (st.save.pendingReceipts.length) return;
        if (this.spec.kind === 'bus') return;
        this.offerTimer -= dt;
        if (this.offerTimer <= 0) {
          const o = this.makeOffer();
          if (o) {
            this.offer = o;
            this.stage = 'OFFERED';
            this.publishOffer(o);
            events.emit({ type: 'RIDE_OFFERED' });
          } else {
            this.offerTimer = 3;
          }
        }
        return;
      }
      case 'OFFERED': {
        if (this.offer && runtime.simTime > this.offer.expiresAt) {
          this.offer = null;
          this.stage = 'IDLE';
          this.offerTimer = RIDE_TIMING.offerDelayMin;
          st.setRide({ stage: 'IDLE', offer: null });
          st.toast(st.t.offerExpired, 'info');
        }
        return;
      }
      case 'TO_PICKUP':
      case 'TO_DROPOFF': {
        const m = this.mission!;
        if (this.stage === 'TO_DROPOFF') nav.elapsed += dt;
        this.comfort(dt);
        const bay = BAY_BY_ID.get(this.stage === 'TO_PICKUP' ? m.pickupBayId : m.dropBayId)!;
        if (vehicleEntry.mode !== 'seated') return;
        const chk = checkStop(bay, this.spec, m.partySize <= this.spec.passengerSeats);
        if (chk.ok) this.stopTimer += dt;
        else this.stopTimer = 0;
        nav.stopProgress = chk.inBay ? Math.min(1, this.stopTimer / RIDE_TIMING.stopHold) : 0;
        nav.stopHint = chk.distance > 25 ? '' : !chk.noPursuit ? 'hintPursuit' : !chk.inBay ? 'hintNotInBay' : !chk.aligned ? 'hintAngle' : !chk.noThrottle ? 'hintThrottle' : !chk.slow ? 'hintTooFast' : '';
        if (this.stopTimer >= RIDE_TIMING.stopHold) {
          this.stopTimer = 0;
          this.phaseTimer = 0;
          if (runtime.vehicle) runtime.vehicle.holdBrake = true;
          rideVisual.stopPose = { x: runtime.pose.x, z: runtime.pose.z, heading: runtime.pose.heading };
          if (this.stage === 'TO_PICKUP') {
            this.stage = 'BOARDING';
            rideVisual.boardProgress = 0;
          } else {
            this.stage = 'ALIGHTING';
            rideVisual.alightBay = bay;
            rideVisual.alightProgress = 0;
          }
          st.setRide({ stage: this.stage });
          return;
        }
        this.navAcc += dt;
        if (this.navAcc >= 0.2) {
          this.navAcc = 0;
          this.updateNav();
        }
        this.checkpointAcc += dt;
        if (this.checkpointAcc >= 15) {
          this.checkpointAcc = 0;
          this.checkpoint(false);
        }
        return;
      }
      case 'BOARDING': {
        this.phaseTimer += dt;
        rideVisual.boardProgress = Math.min(1, this.phaseTimer / (VEHICLES[runtime.vehicleId].kind === 'car' ? CAR_BOARD_SECONDS : RIDE_TIMING.boardTime));
        if (this.phaseTimer >= (VEHICLES[runtime.vehicleId].kind === 'car' ? CAR_BOARD_SECONDS : RIDE_TIMING.boardTime)) {
          if (runtime.vehicle) runtime.vehicle.holdBrake = false;
          this.enterToDropoff(true);
        }
        return;
      }
      case 'ALIGHTING': {
        this.phaseTimer += dt;
        rideVisual.alightProgress = Math.min(1, this.phaseTimer / (VEHICLES[runtime.vehicleId].kind === 'car' ? CAR_ALIGHT_SECONDS : RIDE_TIMING.alightTime));
        rideVisual.onboard = rideVisual.alightProgress < (VEHICLES[runtime.vehicleId].kind === 'car' ? .46 : .15);
        if (this.phaseTimer >= (VEHICLES[runtime.vehicleId].kind === 'car' ? CAR_ALIGHT_SECONDS : RIDE_TIMING.alightTime)) this.complete();
        return;
      }
      case 'COMPLETED':
        return;
    }
  }

  private comfort(dt: number) {
    if (this.stage !== 'TO_DROPOFF') return;
    this.harshCooldown = Math.max(0, this.harshCooldown - dt);
    const a = runtime.telemetry.longAccel;
    if (a < -SATISFACTION.harshBrakeThreshold && this.harshCooldown <= 0 && !runtime.vehicle?.spawnProtected) {
      this.harshCooldown = 2;
      const m = this.mission!;
      m.harshEvents++;
      if (m.harshEvents >= SATISFACTION.harshBrakeEventsBeforePenalty) this.penalize(SATISFACTION.harshBraking, true);
    }
  }

  /** Reduce passenger satisfaction (comfort-only penalties scale with the comfort upgrade). */
  penalize(points: number, comfortOnly = false) {
    if (!this.mission || this.stage !== 'TO_DROPOFF') {
      satisfactionHook.bus?.(points);
      return;
    }
    let p = points;
    if (comfortOnly) {
      const save = useGame.getState().save;
      const up = save.upgradesByVehicle[runtime.vehicleId] ?? { engine: 0, brakes: 0, tires: 0, comfort: 0 };
      p *= deriveHandling(this.spec, up).comfortPenaltyScale;
    }
    nav.satisfaction = Math.max(0, Math.min(100, nav.satisfaction - p));
  }

  markRecovered() {
    if (this.mission) this.mission.recovered = true;
    if (this.mission && nav.targetBay) this.setRoute(nav.targetBay, nav.target === 'dropoff' ? 'dropoff' : 'pickup');
  }

  private updateNav() {
    const r = nav.route;
    const bay = nav.targetBay;
    if (!bay) return;
    const p = runtime.pose;
    if (!r) {
      // try again (e.g. after recovery)
      if (runtime.simTime - this.lastReroute > 1) this.setRoute(bay, nav.target === 'dropoff' ? 'dropoff' : 'pickup');
      return;
    }
    const prog = progressAlong(r, p.x, p.z, nav.progressIndex);
    nav.progressIndex = prog.index;
    nav.along = prog.along;
    nav.remaining = Math.max(0, r.length - prog.along);
    // Off-route detection: >15 m for 1.5 s → reroute (debounced to once per second).
    if (prog.offRoute > 15) this.offRouteTime += 0.2;
    else this.offRouteTime = 0;
    if (this.offRouteTime >= 1.5 && runtime.simTime - this.lastReroute >= 1) {
      this.setRoute(bay, nav.target === 'dropoff' ? 'dropoff' : 'pickup');
      return;
    }
    // Next instruction from the planned segment chain.
    let acc = 0;
    let seen = 0;
    const segs = r.segments;
    let found: 'left' | 'right' | null = null;
    for (let i = 0; i < segs.length; i++) {
      const segLen = (i === segs.length - 1 ? r.goalS : segs[i].length) - (i === 0 ? r.startS : 0);
      acc += segLen + (i < segs.length - 1 ? 22 : 0);
      if (acc < prog.along) continue;
      if (i < segs.length - 1) {
        const tt = turnType(segs[i], segs[i + 1]);
        if (tt === 'left' || tt === 'right') {
          found = tt;
          seen = acc - 22 - prog.along;
          break;
        }
      }
    }
    if (nav.remaining < 45) {
      nav.instruction = nav.remaining < 15 ? 'stop' : 'arriving';
      nav.instructionDist = nav.remaining;
    } else if (found) {
      nav.instruction = found;
      nav.instructionDist = Math.max(0, seen);
    } else {
      nav.instruction = 'continue';
      nav.instructionDist = nav.remaining;
    }
  }

  /** Spawn pose for a restored mission (collision-checked by the recovery system on spawn). */
  spawnPose() {
    return this.mission?.safePose ?? garageSpawn();
  }

  vehicleFor(): VehicleId {
    return (this.mission?.vehicleId as VehicleId) ?? runtime.vehicleId;
  }
}

export const rides = new RideSystem();
