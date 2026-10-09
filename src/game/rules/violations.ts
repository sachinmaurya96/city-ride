import { CROSSWALK_WIDTH, DIR_VEC, SEGMENT_BY_ID, leftOf, laneOffset, type Segment } from '../data/cityMap';
import { FINES, HEAT, SATISFACTION } from '../data/economy';
import { VEHICLES } from '../data/vehicles';
import { runtime } from '../core/runtime';
import { events } from '../core/events';
import { INTERSECTION_BY_ID } from '../navigation/roadGraph';
import { lightFor, phaseAt } from '../traffic/signals';
import { CROSSINGS, pedestrians } from '../pedestrians/pedestrians';
import { traffic } from '../traffic/traffic';
import { playerRoad } from './recovery';
import { enforcement } from './enforcementState';
import { rides } from '../missions/rides';
import { applyFine } from '../progression/progression';
import { useGame } from '../../app/store';

// Violation detection (plan §10.4). Every offense uses episodes + cooldowns so one continuous
// mistake is fined at most once; traffic-caused contacts never fine the player.

export type Offense = 'speeding' | 'redLight' | 'wrongWay' | 'blockingCrossing' | 'crash' | 'pedestrian';

interface Episode {
  active: boolean;
  time: number; // seconds the condition has held
  compliant: number; // seconds of compliance since the episode began
  lastFineAt: number;
}

const ep = (): Episode => ({ active: false, time: 0, compliant: 0, lastFineAt: -Infinity });

class ViolationSystem {
  private speeding = ep();
  private wrongWay = ep();
  private blocking = ep();
  private blockingHinted = false;
  private warned = new Set<Offense>();
  private redLatch = new Set<string>();
  private trackSeg: Segment | null = null;
  private prevFront = 0;
  private lastViolationAt = -Infinity;
  private impactCooldown = 0;
  private speedHistory: number[] = [];
  private fineCounter = 0;
  /** Set by the player collider's collision callback; consumed next step. */
  pendingContact: { traffic: boolean } | null = null;

  reset() {
    this.speeding = ep();
    this.wrongWay = ep();
    this.blocking = ep();
    this.redLatch.clear();
    this.trackSeg = null;
    this.speedHistory = [];
    enforcement.heat = 0;
  }

  /** Record a violation: satisfaction, warning-or-fine, heat, events and UI notice. */
  record(offense: Offense, opts: { heat: number; fine: number; satisfaction: number; forceFine?: boolean; minHeat?: number }) {
    const st = useGame.getState();
    const tutorialProtected = st.save.lifetime.jobs < enforcement.protectedRides;
    enforcement.jobIncidents += 1;
    this.lastViolationAt = runtime.simTime;
    if (opts.satisfaction) rides.penalize(opts.satisfaction);
    const firstTime = !this.warned.has(offense);
    this.warned.add(offense);
    // Tutorial protection: ordinary mistakes are warnings; serious safety contacts explain without debt.
    const warning = !opts.forceFine && (firstTime || tutorialProtected);
    const noDebt = tutorialProtected;
    let paid = 0;
    if (!warning && !noDebt && opts.fine > 0) {
      const r = applyFine(st.save, `${offense}:${Date.now().toString(36)}:${this.fineCounter++}`, opts.fine, Date.now());
      if (r.paid > 0 || r.save !== st.save) st.commit(r.save, true);
      paid = r.paid;
    }
    if (!warning) {
      enforcement.heat = Math.min(100, enforcement.heat + opts.heat);
      if (opts.minHeat !== undefined && !noDebt) enforcement.heat = Math.max(enforcement.heat, opts.minHeat);
    } else {
      enforcement.heat = Math.min(100, enforcement.heat + opts.heat * 0.25);
    }
    events.emit({ type: 'VIOLATION_RECORDED', offense, fine: paid, warning: warning || paid === 0 });
    st.setNotice({ id: `${offense}:${runtime.simTime.toFixed(2)}`, offense, fine: paid, warning: warning || (noDebt && paid === 0), heat: enforcement.heat, capture: false, impound: 0 });
    if (warning || noDebt) {
      const id = useGame.getState().notice?.id;
      setTimeout(() => {
        if (useGame.getState().notice?.id === id) useGame.getState().setNotice(null);
      }, 4500);
    }
  }

  step(dt: number) {
    if (!runtime.vehicle || runtime.vehicle.spawnProtected) {
      this.speedHistory.length = 0;
      return;
    }
    const p = runtime.pose;
    const spec = VEHICLES[runtime.vehicleId];
    const speed = runtime.telemetry.speed;
    const kmh = Math.abs(speed) * 3.6;
    const proj = playerRoad.proj;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    this.speedHistory.push(speed);
    if (this.speedHistory.length > 15) this.speedHistory.shift();

    // ---- speeding: limit + 8 km/h for 3 s; new fine needs a new episode and 15 s ----
    const limit = proj.segment?.limitKmh ?? this.trackSeg?.limitKmh ?? 50;
    this.episode(this.speeding, kmh > limit + 8, dt, 3, 'speeding', { heat: HEAT.speeding, fine: FINES.speeding, satisfaction: 0 });

    // ---- wrong way: on the opposite side of a segment, moving with that segment's direction ----
    const wrong = proj.kind === 'segment' && !proj.correctSide && proj.aligned > 0.6 && Math.abs(speed) > 2 && proj.lateral < -1.2;
    this.episode(this.wrongWay, wrong, dt, 3, 'wrongWay', { heat: HEAT.wrongWay, fine: FINES.wrongWay, satisfaction: SATISFACTION.wrongWay });

    // ---- red light: front bumper crosses the approach stop line while red ----
    if (proj.kind === 'segment' && proj.segment && proj.correctSide && proj.aligned > 0.7) {
      if (this.trackSeg !== proj.segment) {
        this.trackSeg = proj.segment;
        this.prevFront = -Infinity;
      }
    }
    const seg = this.trackSeg;
    if (seg) {
      const [dx, dz] = DIR_VEC[seg.dir];
      const [lx, lz] = leftOf(seg.dir);
      const fx = p.x + p.fx * (spec.length / 2);
      const fz = p.z + p.fz * (spec.length / 2);
      const front = (fx - seg.sx) * dx + (fz - seg.sz) * dz;
      const lat = (p.x - seg.sx) * lx + (p.z - seg.sz) * lz;
      const inLanes = lat > 0 && lat < laneOffset(seg, seg.lanes - 1) + 2.4;
      const heading = p.fx * dx + p.fz * dz;
      if (this.prevFront < seg.length && front >= seg.length && heading > 0.7 && inLanes && speed > 0.5) {
        const j = INTERSECTION_BY_ID.get(seg.to)!;
        const key = `${j.id}:${seg.dir}`;
        if (lightFor(j, seg.dir, runtime.simTime) === 'R' && !this.redLatch.has(key)) {
          this.redLatch.add(key);
          this.record('redLight', { heat: HEAT.redLight, fine: FINES.redLight, satisfaction: SATISFACTION.redLight });
        }
      }
      if (front < seg.length - 30) this.redLatch.delete(`${seg.to}:${seg.dir}`);
      this.prevFront = front;
      if (front > seg.length + 40) this.trackSeg = null;
    }

    // ---- blocking an active crossing: stationary on it > 4 s; hint first ----
    let onCrossing = false;
    if (Math.abs(speed) < 0.5) {
      for (const c of CROSSINGS) {
        const mx = (c.ax + c.bx) / 2;
        const mz = (c.az + c.bz) / 2;
        const ux = (c.bx - c.ax) / Math.hypot(c.bx - c.ax, c.bz - c.az);
        const uz = (c.bz - c.az) / Math.hypot(c.bx - c.ax, c.bz - c.az);
        const along = (p.x - mx) * ux + (p.z - mz) * uz;
        const across = Math.abs((p.x - mx) * -uz + (p.z - mz) * ux);
        const halfLen = Math.hypot(c.bx - c.ax, c.bz - c.az) / 2;
        if (Math.abs(along) < halfLen && across < CROSSWALK_WIDTH / 2 + spec.length / 2 - 0.5) {
          const ph = phaseAt(c.junction, runtime.simTime);
          onCrossing = ph.ped || ph.pedClear || pedestrians.anyCrossingNear(mx, mz, halfLen + 3);
          break;
        }
      }
    }
    if (onCrossing) {
      this.blocking.time += dt;
      if (this.blocking.time > 4 && !this.blocking.active) {
        this.blocking.active = true;
        if (!this.blockingHinted) {
          this.blockingHinted = true;
          const st = useGame.getState();
          st.toast(`${st.t.violations.blockingCrossing}: ${st.t.violationTips.blockingCrossing}`, 'warn');
        } else if (runtime.simTime - this.blocking.lastFineAt > 15) {
          this.blocking.lastFineAt = runtime.simTime;
          this.record('blockingCrossing', { heat: 5, fine: FINES.blockingCrossing, satisfaction: 0, forceFine: true });
        }
      }
    } else {
      this.blocking.time = 0;
      this.blocking.active = false;
    }

    // ---- collisions: classify by actual speed change; repeated contact frames = one incident ----
    if (this.pendingContact && this.impactCooldown <= 0 && this.speedHistory.length > 4) {
      const before = Math.max(...this.speedHistory.slice(0, -1).map((v) => Math.abs(v)));
      const dv = before - Math.abs(speed);
      const playerCaused = before > 2;
      if (playerCaused && dv > 1.2) {
        this.impactCooldown = 1.5;
        const major = dv > 4 || before > 7;
        events.emit({ type: 'COLLISION', impulse: dv, withTraffic: this.pendingContact.traffic });
        if (major && this.pendingContact.traffic) {
          this.record('crash', { heat: HEAT.crash, fine: FINES.crash, satisfaction: SATISFACTION.crash });
        } else {
          // scrape or hitting scenery: satisfaction only, no monetary fine
          rides.penalize(major ? SATISFACTION.crash : SATISFACTION.scrape, !major);
          enforcement.jobIncidents += major ? 1 : 0;
        }
      } else if (this.pendingContact.traffic && !playerCaused) {
        events.emit({ type: 'COLLISION', impulse: 0, withTraffic: true });
      }
    }
    this.pendingContact = null;

    // ---- pedestrian safety volume ----
    if (Math.abs(speed) > 1) {
      for (const ped of pedestrians.peds) {
        if (!ped.active || ped.shaken > 0) continue;
        const dx = ped.x - p.x;
        const dz = ped.z - p.z;
        const along = dx * p.fx + dz * p.fz;
        const lat = Math.abs(dx * p.fz - dz * p.fx);
        if (Math.abs(along) < spec.length / 2 + 0.4 && lat < spec.width / 2 + 0.45) {
          ped.shaken = 20;
          // move the pedestrian safely out of the path (non-graphic)
          ped.state = 'walk';
          ped.crossing = null;
          if (runtime.vehicle) {
            runtime.vehicle.holdBrake = true;
            setTimeout(() => runtime.vehicle && (runtime.vehicle.holdBrake = false), 1500);
          }
          this.record('pedestrian', { heat: 0, fine: FINES.pedestrian, satisfaction: SATISFACTION.crash, forceFine: true, minHeat: HEAT.pedestrianMin });
          break;
        }
      }
    }

    // ---- heat decay after a calm grace period ----
    if (!enforcement.pursuit && runtime.simTime - this.lastViolationAt > HEAT.decayGrace) {
      enforcement.heat = Math.max(0, enforcement.heat - HEAT.decayPerSecond * dt);
    }
  }

  private episode(e: Episode, cond: boolean, dt: number, need: number, offense: Offense, cfg: { heat: number; fine: number; satisfaction: number }) {
    if (cond) {
      e.time += dt;
      e.compliant = 0;
      if (!e.active && e.time >= need) {
        e.active = true;
        if (runtime.simTime - e.lastFineAt >= 15) {
          e.lastFineAt = runtime.simTime;
          this.record(offense, cfg);
        }
      }
    } else {
      e.time = 0;
      if (e.active) {
        e.compliant += dt;
        if (e.compliant >= 5) {
          e.active = false;
          e.compliant = 0;
        }
      }
    }
  }

  get lastViolationTime() {
    return this.lastViolationAt;
  }
}

export const violations = new ViolationSystem();
export { SEGMENT_BY_ID, traffic };
