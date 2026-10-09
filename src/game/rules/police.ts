import { FINES, HEAT } from '../data/economy';
import { garageSpawn } from '../data/cityMap';
import { runtime } from '../core/runtime';
import { VEHICLES } from '../data/vehicles';
import { events } from '../core/events';
import { input } from '../input/input';
import { traffic, type Car } from '../traffic/traffic';
import { enforcement } from './enforcementState';
import { violations } from './violations';
import { rides } from '../missions/rides';
import { busService } from '../missions/bus';
import { applyFine } from '../progression/progression';
import { useGame } from '../../app/store';

// Police escalation (plan §10.5): heat ≥ 60 starts a pursuit by a lane-following police car that
// switches to direct interception at close range. Escape needs 20 s out of detection range without
// new violations; capture ends the current job, never the game, and wallet never goes negative.

const DETECT_RANGE = 90;

class PoliceSystem {
  car: Car | null = null;
  pursuitTime = 0;
  outOfRange = 0;
  closeTime = 0;
  spawnRetry = 0;
  lastOffenseAt = -Infinity;
  /** Police have had the player in detection range at least once this pursuit. */
  acquired = false;

  reset() {
    if (this.car) this.car.chase = null;
    this.car = null;
    enforcement.pursuit = false;
    this.pursuitTime = 0;
    this.outOfRange = 0;
    this.closeTime = 0;
  }

  step(dt: number) {
    const p = runtime.pose;
    if (!enforcement.pursuit) {
      if (enforcement.heat >= HEAT.pursuitThreshold) {
        enforcement.pursuit = true;
        this.pursuitTime = 0;
        this.outOfRange = 0;
        this.closeTime = 0;
        this.spawnRetry = 0;
        this.acquired = false;
        this.lastOffenseAt = violations.lastViolationTime;
        events.emit({ type: 'POLICE_PURSUIT' });
        const st = useGame.getState();
        st.toast(`🚓 ${st.t.pursuit}`, 'bad');
      }
      return;
    }
    this.pursuitTime += dt;
    if (!this.car || !this.car.active || !this.car.police) {
      this.spawnRetry -= dt;
      if (this.spawnRetry <= 0) {
        this.spawnRetry = 1;
        this.car = traffic.spawnPolice();
      }
    }
    const c = this.car;
    const dist = c && c.active ? Math.hypot(c.x - p.x, c.z - p.z) : Infinity;
    if (c && c.active) {
      // aim slightly behind the player to box them in rather than ram
      c.chase = { x: p.x - p.fx * 3, z: p.z - p.fz * 3 };
    }
    // escape rule
    if (violations.lastViolationTime > this.lastOffenseAt) {
      this.lastOffenseAt = violations.lastViolationTime;
      this.outOfRange = 0;
    }
    if (dist <= DETECT_RANGE) {
      this.acquired = true;
      this.outOfRange = 0;
    } else if (this.acquired) this.outOfRange += dt;
    if (this.outOfRange >= HEAT.escapeSeconds) {
      enforcement.pursuit = false;
      enforcement.heat = 40;
      if (c) c.chase = null;
      this.car = null;
      events.emit({ type: 'POLICE_ESCAPED' });
      const st = useGame.getState();
      st.toast(st.t.escaped, 'good');
      return;
    }
    // capture rules
    const slow = Math.abs(runtime.telemetry.speed) * 3.6 < 5;
    // "within about 6 m" measured between vehicle ends, not centers
    const gap = c && c.active ? dist - c.length / 2 - VEHICLES[runtime.vehicleId].length / 2 : Infinity;
    if (gap < 6 && slow) this.closeTime += dt;
    else this.closeTime = Math.max(0, this.closeTime - dt * 0.5);
    const blocked = runtime.stuckTime > 3 && dist < 15;
    if (this.closeTime >= 2 || blocked || this.pursuitTime >= HEAT.pursuitTimeout) this.capture();
  }

  capture() {
    const st = useGame.getState();
    // separate impound fine, capped by the wallet (zero cash never soft-locks)
    let paid = 0;
    if (st.save.lifetime.jobs >= enforcement.protectedRides) {
      const r = applyFine(st.save, `impound:${Date.now().toString(36)}`, FINES.impound, Date.now());
      paid = r.paid;
      if (r.save !== st.save) useGame.getState().commit(r.save, true);
    }
    const cur = useGame.getState();
    const s = structuredClone(cur.save);
    s.lifetime.captures += 1;
    s.revision++;
    cur.commit(s, true);
    rides.fail('police');
    busService.cancel();
    if (this.car) {
      this.car.chase = null;
      this.car.active = false;
      this.car.z = -5000;
    }
    this.reset();
    enforcement.heat = 0;
    input.reset();
    runtime.requestRecovery(garageSpawn());
    events.emit({ type: 'POLICE_CAPTURED' });
    useGame.getState().setNotice({ id: `capture:${Date.now()}`, offense: lastOffenseName() ?? 'pursuit', fine: 0, warning: false, heat: 0, capture: true, impound: paid });
  }
}

let lastOffense: string | null = null;
events.on((e) => {
  if (e.type === 'VIOLATION_RECORDED') lastOffense = e.offense;
});
function lastOffenseName() {
  return lastOffense;
}

export const police = new PoliceSystem();
