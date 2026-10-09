import { DIR_VEC, SEGMENTS, laneOffset, leftOf, segmentPoint, type Intersection, type Segment } from '../data/cityMap';
import { EXTRA_CARS, type ExtraVehicleId } from '../data/importedCatalog';
import { VEHICLES } from '../data/vehicles';
import { mulberry32, pick } from '../core/rng';
import { runtime } from '../core/runtime';
import { successors, turnCurve, turnType, INTERSECTION_BY_ID, type TurnType } from '../navigation/roadGraph';
import { lightFor } from './signals';
import { nav } from '../missions/rides';

// Ambient traffic (plan §10.1): bounded pool, legal lane paths, headway control, signals,
// junction reservations with protected crossing turns, player avoidance, off-screen spawn/recycle.

type PackVehicleId = Extract<ExtraVehicleId, `pack_${string}`>;
export const PACK_TRAFFIC_MODELS = EXTRA_CARS.filter((c) => c.id.startsWith('pack_')).map((c) => c.id as PackVehicleId);
export type TrafficModel = PackVehicleId | 'police_car' | 'car_compact' | 'car_coupe' | 'mpv_seven' | 'auto_city' | 'bus_small';
export const TRAFFIC_MODELS: TrafficModel[] = ['car_compact', 'car_coupe', 'mpv_seven', 'auto_city', 'bus_small', 'police_car', ...PACK_TRAFFIC_MODELS];
const MODEL_WEIGHTS: TrafficModel[] = ['car_compact', 'car_compact', 'car_compact', 'car_coupe', 'mpv_seven', 'mpv_seven', 'auto_city', 'auto_city', 'bus_small', 'police_car', ...PACK_TRAFFIC_MODELS, ...PACK_TRAFFIC_MODELS.filter((id) => VEHICLES[id].height < 2.4)];
export const TRAFFIC_COLORS = ['#ee5a52', '#f4c430', '#3f7fd8', '#f6efe2', '#3cc9b0', '#9b7fd6', '#f39c5a', '#7fb069', '#e9b8d0', '#f6efe2'];

export interface Car {
  id: number;
  active: boolean;
  model: TrafficModel;
  color: string;
  police: boolean;
  length: number;
  halfWidth: number;
  seg: Segment;
  lane: number;
  s: number;
  next: Segment | null;
  nextLane: number;
  turnKind: TurnType;
  turn: { pts: [number, number][]; cum: number[]; len: number; junction: Intersection } | null;
  t: number;
  speed: number;
  cruise: number;
  x: number;
  z: number;
  heading: number;
  stopped: number;
  /** Entry permission evaluated on the approach this step. */
  allow: boolean;
  /** Held by a red/amber signal (legitimate wait, not 'stuck'). */
  atSignal: boolean;
  /** Override target for police pursuit (set by police system). */
  chase: { x: number; z: number } | null;
  /** Close-range pursuit: drive directly at the chase target instead of following lanes. */
  homing: boolean;
  /** AI yields to collision momentum until the car settles. */
  impactTime: number;
}

const MAX_POOL = 26;
const SPAWN_MIN = 75;
const SPAWN_MAX = 210;
const DESPAWN = 250;

function polyAt(pts: [number, number][], cum: number[], d: number): [number, number, number] {
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  const a = pts[i];
  const b = pts[i + 1] ?? a;
  const L = cum[i + 1] - cum[i] || 1;
  const t = Math.max(0, Math.min(1, (d - cum[i]) / L));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[0] - a[0], b[1] - a[1])];
}

export class TrafficSystem {
  cars: Car[] = [];
  target = 14;
  private rng = mulberry32(4242);
  private spawnAcc = 0;
  private decideAcc = 0;
  /** junction id → cars currently inside the junction box */
  private inJunction = new Map<string, Set<Car>>();

  constructor() {
    for (let i = 0; i < MAX_POOL; i++) {
      this.cars.push({
        id: i,
        active: false,
        model: 'car_compact',
        color: '#ffffff',
        police: false,
        length: 4,
        halfWidth: 0.9,
        seg: SEGMENTS[0],
        lane: 0,
        s: 0,
        next: null,
        nextLane: 0,
        turnKind: 'straight',
        turn: null,
        t: 0,
        speed: 0,
        cruise: 10,
        x: 0,
        z: -5000,
        heading: 0,
        stopped: 0,
        allow: false,
        atSignal: false,
        chase: null,
        homing: false,
        impactTime: 0,
      });
    }
  }

  reset() {
    for (const c of this.cars) this.deactivate(c);
    this.inJunction.clear();
  }

  private deactivate(c: Car) {
    if (c.turn) this.inJunction.get(c.turn.junction.id)?.delete(c);
    c.active = false;
    c.turn = null;
    c.police = false;
    c.chase = null;
    c.homing = false;
    c.impactTime = 0;
    c.z = -5000;
  }

  /** Is a world point visible-ish from the camera (used to avoid popping cars in view). */
  private visible(x: number, z: number) {
    const cam = runtime.cameraPose;
    const dx = x - cam.x;
    const dz = z - cam.z;
    const d = Math.hypot(dx, dz);
    if (d < 25) return true;
    return (dx * cam.fx + dz * cam.fz) / d > 0.35 && d < 320;
  }

  private spawnOne(police = false): Car | null {
    const c = this.cars.find((k) => !k.active);
    if (!c) return null;
    const p = runtime.pose;
    for (let attempt = 0; attempt < (police ? 60 : 20); attempt++) {
      const seg = SEGMENTS[Math.floor(this.rng() * SEGMENTS.length)];
      const lane = Math.floor(this.rng() * seg.lanes);
      const s = 10 + this.rng() * Math.max(1, seg.length - 30);
      const [x, z] = segmentPoint(seg, s, laneOffset(seg, lane));
      const d = Math.hypot(x - p.x, z - p.z);
      if (police) {
        // pursuit car: reasonably near, preferably behind the player, never on top of them
        if (d < 60 || d > 130 + attempt * 5) continue;
        if (attempt < 12 && (x - p.x) * p.fx + (z - p.z) * p.fz > 0) continue;
      } else {
        if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
        if (this.visible(x, z) && d < 160) continue;
      }
      const bay = nav.targetBay;
      if (bay && Math.hypot(bay.x - x, bay.z - z) < 30) continue;
      if (this.cars.some((o) => o.active && o.seg === seg && o.lane === lane && Math.abs(o.s - s) < 14)) continue;
      const model = police ? 'police_car' : pick(this.rng, MODEL_WEIGHTS);
      const spec = VEHICLES[model];
      c.active = true;
      c.police = police;
      c.model = model;
      c.color = police ? '#f6f7fb' : pick(this.rng, TRAFFIC_COLORS);
      c.length = spec.length;
      c.halfWidth = spec.width / 2;
      c.seg = seg;
      c.lane = lane;
      c.s = s;
      c.next = null;
      c.turn = null;
      c.t = 0;
      c.cruise = (seg.limitKmh / 3.6) * (0.78 + this.rng() * 0.17) * (model === 'bus_small' ? 0.85 : 1);
      c.speed = c.cruise * 0.6;
      c.stopped = 0;
      c.chase = null;
      c.homing = false;
      c.impactTime = 0;
      c.x = x;
      c.z = z;
      const [dx, dz] = DIR_VEC[seg.dir];
      c.heading = Math.atan2(dx, dz);
      return c;
    }
    return null;
  }

  spawnPolice() {
    return this.spawnOne(true);
  }

  impact(id: number) {
    const c = this.cars[id]; if (!c?.active || c.impactTime > 0) return;
    c.impactTime = 2.4; c.speed = 0; c.allow = false; c.atSignal = false;
    if (c.turn) this.inJunction.get(c.turn.junction.id)?.delete(c);
    c.turn = null; c.next = null;
  }

  /** Choose the next segment and lane (curb lane for left turns, inner lane for right turns). */
  private choose(c: Car) {
    const opts = successors(c.seg);
    if (!opts.length) return;
    let next: Segment;
    if (c.chase) {
      // pursuit: pick the successor that heads toward the target
      next = opts.reduce((best, o) => {
        const d = Math.hypot(o.ex - c.chase!.x, o.ez - c.chase!.z);
        const bd = Math.hypot(best.ex - c.chase!.x, best.ez - c.chase!.z);
        return d < bd ? o : best;
      }, opts[0]);
    } else {
      const weights = opts.map((o) => (turnType(c.seg, o) === 'straight' ? 2.2 : 1));
      let r = this.rng() * weights.reduce((a, b) => a + b, 0);
      next = opts[opts.length - 1];
      for (let i = 0; i < opts.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          next = opts[i];
          break;
        }
      }
    }
    c.next = next;
    c.turnKind = turnType(c.seg, next);
    if (c.turnKind === 'left') c.nextLane = next.lanes - 1;
    else if (c.turnKind === 'right') c.nextLane = 0;
    else c.nextLane = Math.min(c.lane, next.lanes - 1);
  }

  /** May car `c` enter its next junction now? (signals + reservations + protected crossing turns) */
  private mayEnter(c: Car, distToLine: number): boolean {
    const j = INTERSECTION_BY_ID.get(c.seg.to)!;
    if (c.police && c.chase) return this.boxClearOfCrossTraffic(c, j);
    const light = lightFor(j, c.seg.dir, runtime.simTime);
    c.atSignal = light !== 'G';
    if (light === 'R') return false;
    if (light === 'A' && distToLine > Math.max(3, c.speed * 0.9)) return false;
    if (!this.boxClearOfCrossTraffic(c, j)) return false;
    // space on the exit lane (no gridlock)
    if (c.next && this.cars.some((o) => o.active && o !== c && !o.turn && o.seg === c.next && o.lane === c.nextLane && o.s < o.length + 3)) return false;
    if (c.turnKind === 'right') {
      // crossing turn (left-hand traffic): yield to oncoming traffic in or near the junction
      for (const o of this.cars) {
        if (!o.active || o === c) continue;
        const opposite = o.seg.dir !== c.seg.dir && DIR_VEC[o.seg.dir][0] === -DIR_VEC[c.seg.dir][0] && DIR_VEC[o.seg.dir][1] === -DIR_VEC[c.seg.dir][1];
        if (o.turn && o.turn.junction === j && o.turnKind !== 'right' && opposite) return false;
        if (!o.turn && o.seg.to === j.id && opposite && o.seg.length - o.s < 35 && o.speed > 1) return false;
      }
    }
    return true;
  }

  private boxClearOfCrossTraffic(c: Car, j: Intersection) {
    const inside = this.inJunction.get(j.id);
    if (!inside) return true;
    const axis = c.seg.dir === 'N' || c.seg.dir === 'S' ? 'ns' : 'ew';
    for (const o of inside) {
      const oa = o.seg.dir === 'N' || o.seg.dir === 'S' ? 'ns' : 'ew';
      if (oa !== axis) return false;
    }
    return true;
  }

  /** Distance to the nearest obstacle ahead along the car's path (cars, player, pedestrians). */
  private gapAhead(c: Car): number {
    let gap = Infinity;
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    const look = 8 + c.speed * 3;
    const consider = (x: number, z: number, halfLen: number, halfW: number) => {
      const dx = x - c.x;
      const dz = z - c.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > look) return;
      const lat = Math.abs(dx * fz - dz * fx);
      if (lat > halfW + c.halfWidth + 0.35) return;
      gap = Math.min(gap, along - halfLen - c.length / 2);
    };
    for (const o of this.cars) {
      if (!o.active || o === c) continue;
      // only consider cars broadly travelling the same way or inside a junction we share
      const hd = Math.cos(o.heading - c.heading);
      if (hd < -0.3 && !o.turn) continue;
      consider(o.x, o.z, o.length / 2, o.halfWidth);
    }
    const p = runtime.pose;
    const pspec = VEHICLES[runtime.vehicleId];
    consider(p.x, p.z, pspec.length / 2, pspec.width / 2 + 0.3);
    for (const ped of pedestrianObstacles) consider(ped.x, ped.z, 0.3, 0.5);
    return gap;
  }

  step(dt: number) {
    const p = runtime.pose;
    // spawn / recycle at a limited rate
    this.spawnAcc += dt;
    if (this.spawnAcc > 0.4) {
      this.spawnAcc = 0;
      const active = this.cars.filter((c) => c.active && !c.police).length;
      if (active < this.target) this.spawnOne();
      for (const c of this.cars) {
        if (!c.active || c.police) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        const stuckHidden = c.stopped > 12 && !this.visible(c.x, c.z);
        if ((d > DESPAWN && !this.visible(c.x, c.z)) || d > DESPAWN + 120 || stuckHidden || active > this.target + 2) this.deactivate(c);
      }
    }
    this.decideAcc += dt;
    const decide = this.decideAcc >= 0.1;
    if (decide) this.decideAcc = 0;

    for (const c of this.cars) {
      if (!c.active) continue;
      if (c.impactTime > 0) { c.impactTime = Math.max(0, c.impactTime - dt); c.speed = 0; c.stopped += dt; continue; }
      if (c.chase && (c.homing || Math.hypot(c.chase.x - c.x, c.chase.z - c.z) < 40)) {
        this.home(c, dt);
        continue;
      }
      let vTarget = c.chase ? c.cruise * 1.35 : c.cruise;
      if (c.turn) {
        vTarget = Math.min(vTarget, c.turnKind === 'straight' ? c.cruise : 5.2);
      } else {
        if (!c.next && c.seg.length - c.s < 45) this.choose(c);
        const dist = c.seg.length - c.s;
        c.allow = true;
        c.atSignal = false;
        if (c.next && dist < 40) {
          // slow for the turn
          if (c.turnKind !== 'straight') vTarget = Math.min(vTarget, 5.2 + dist * 0.25);
          c.allow = this.mayEnter(c, dist);
          if (!c.allow) {
            const stopGap = Math.max(0, dist - 0.6);
            vTarget = Math.min(vTarget, Math.sqrt(2 * 3.2 * stopGap));
            if (stopGap < 0.3) vTarget = 0;
          }
        }
      }
      const gap = this.gapAhead(c);
      if (gap < Infinity) {
        const safe = Math.max(0, gap - 2.5 - c.speed * 0.8);
        vTarget = Math.min(vTarget, Math.sqrt(2 * 3.5 * safe));
        if (gap < 1.5) vTarget = 0;
      }
      const dv = vTarget - c.speed;
      c.speed += Math.max(-7 * dt, Math.min(2.2 * dt, dv));
      if (c.speed < 0.05 && vTarget < 0.05) c.speed = 0;
      // queued behind a red light (or behind such a queue) is a legitimate wait, not stuck
      const queued = c.atSignal || (gap < 12 && this.cars.some((o) => o.active && o !== c && o.atSignal && o.seg === c.seg && o.lane === c.lane && o.s > c.s));
      c.stopped = c.speed < 0.2 && !queued ? c.stopped + dt : 0;

      const move = c.speed * dt;
      if (c.turn) {
        c.t += move;
        if (c.t >= c.turn.len) {
          this.inJunction.get(c.turn.junction.id)?.delete(c);
          const over = c.t - c.turn.len;
          c.seg = c.next!;
          c.lane = c.nextLane;
          c.s = over;
          c.turn = null;
          c.next = null;
          c.cruise = (c.seg.limitKmh / 3.6) * (0.78 + this.rng() * 0.17) * (c.model === 'bus_small' ? 0.85 : 1);
        }
      } else {
        c.s += move;
        if (c.s >= c.seg.length && !c.allow) {
          // never creep over the stop line without permission
          c.s = c.seg.length - 0.05;
          c.speed = 0;
        }
        if (c.s >= c.seg.length) {
          if (!c.next) this.choose(c);
          if (c.next) {
            const j = INTERSECTION_BY_ID.get(c.seg.to)!;
            const [ex, ez] = segmentPoint(c.seg, c.seg.length, laneOffset(c.seg, c.lane));
            const [sx, sz] = segmentPoint(c.next, 0, laneOffset(c.next, c.nextLane));
            const pts: [number, number][] = [[ex, ez], ...turnCurve(c.seg, c.next, c.lane, c.nextLane, 10), [sx, sz]];
            const cum = [0];
            for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
            c.turn = { pts, cum, len: cum[cum.length - 1], junction: j };
            c.t = c.s - c.seg.length;
            if (!this.inJunction.has(j.id)) this.inJunction.set(j.id, new Set());
            this.inJunction.get(j.id)!.add(c);
          } else c.s = c.seg.length;
        }
      }
      // pose
      if (c.turn) {
        const [x, z, h] = polyAt(c.turn.pts, c.turn.cum, c.t);
        c.x = x;
        c.z = z;
        c.heading = h;
      } else {
        const [x, z] = segmentPoint(c.seg, c.s, laneOffset(c.seg, c.lane));
        c.x = x;
        c.z = z;
        const [dx, dz] = DIR_VEC[c.seg.dir];
        c.heading = Math.atan2(dx, dz);
      }
    }
    void decide;
  }

  /** Close-range police pursuit: steer straight at the target with limited turn rate and speed. */
  private home(c: Car, dt: number) {
    if (!c.homing) {
      c.homing = true;
      if (c.turn) this.inJunction.get(c.turn.junction.id)?.delete(c);
      c.turn = null;
    }
    const t = c.chase!;
    const dx = t.x - c.x;
    const dz = t.z - c.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    let diff = want - c.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.heading += Math.max(-1.8 * dt, Math.min(1.8 * dt, diff));
    const vTarget = dist < 1.5 ? 0 : Math.min(17, dist * 0.7) * (Math.abs(diff) > 1 ? 0.4 : 1);
    c.speed += Math.max(-7 * dt, Math.min(3 * dt, vTarget - c.speed));
    c.x += Math.sin(c.heading) * c.speed * dt;
    c.z += Math.cos(c.heading) * c.speed * dt;
  }

  /** Gap from a vehicle pose to the nearest traffic car / pedestrian in its path (used by the test autopilot). */
  gapFrom(x: number, z: number, heading: number, halfW: number, halfLen: number, look: number, ignoreOncoming = false) {
    let gap = Infinity;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const consider = (ox: number, oz: number, oHalfLen: number, oHalfW: number, oHeading?: number) => {
      if (ignoreOncoming && oHeading !== undefined && Math.cos(oHeading - heading) < -0.5 && Math.hypot(ox - x, oz - z) > halfLen + oHalfLen + 3) return;
      const dx = ox - x;
      const dz = oz - z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > look) return;
      if (Math.abs(dx * fz - dz * fx) > oHalfW + halfW + 0.4) return;
      gap = Math.min(gap, along - oHalfLen - halfLen);
    };
    for (const c of this.cars) if (c.active) consider(c.x, c.z, c.length / 2, c.halfWidth, c.heading);
    for (const p of pedestrianObstacles) consider(p.x, p.z, 0.3, 0.5);
    return gap;
  }

  /** Any active traffic car within r meters of a point (recovery/spawn safety). */
  occupied(x: number, z: number, r = 6) {
    return this.cars.some((c) => c.active && Math.hypot(c.x - x, c.z - z) < r);
  }
}

/** Pedestrians currently on the road surface (set by the pedestrian system each step). */
export const pedestrianObstacles: { x: number; z: number }[] = [];

export const traffic = new TrafficSystem();
export { leftOf };
