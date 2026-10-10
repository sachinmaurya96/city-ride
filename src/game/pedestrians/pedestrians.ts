import { BLOCKS, CROSSWALK_GAP, CROSSWALK_WIDTH, DIR_VEC, INTERSECTIONS, OUTGOING, lineClass, roadHalfWidth, type Block, type Intersection } from '../data/cityMap';
import { mulberry32 } from '../core/rng';
import { runtime } from '../core/runtime';
import { phaseAt } from '../traffic/signals';
import { pedestrianObstacles, traffic } from '../traffic/traffic';

// Cosmetic pedestrians (plan §10.3): walk sidewalk loops, cross only at marked zebra crossings
// during the pedestrian phase, and only after checking nearby vehicle time-to-contact.

const INSET = 2.0;
const WALK = 1.25;

interface Crossing {
  junction: Intersection;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  blockA: Block;
  blockB: Block;
}

export interface Ped {
  id: number;
  active: boolean;
  block: Block;
  u: number;
  dir: 1 | -1;
  state: 'walk' | 'wait' | 'cross';
  crossing: Crossing | null;
  ct: number; // 0..1 along crossing
  x: number;
  z: number;
  heading: number;
  variant: number;
  color: string;
  waitTime: number;
  cooldown: number;
  /** Hit by the player: steps aside safely and is ignored for a while (no repeated incidents). */
  shaken: number;
  /** Personal walking pace (m/s) and fixed body type of this pool slot. */
  speed: number;
  gender: 'male' | 'female';
}

function loopRect(b: Block) {
  return { x0: b.minX + INSET, x1: b.maxX - INSET, z0: b.minZ + INSET, z1: b.maxZ - INSET };
}
function perimeter(b: Block) {
  const r = loopRect(b);
  return 2 * (r.x1 - r.x0 + (r.z1 - r.z0));
}
function loopPoint(b: Block, u: number): [number, number, number] {
  const r = loopRect(b);
  const w = r.x1 - r.x0;
  const h = r.z1 - r.z0;
  const P = 2 * (w + h);
  let t = ((u % P) + P) % P;
  if (t < w) return [r.x0 + t, r.z0, Math.PI / 2];
  t -= w;
  if (t < h) return [r.x1, r.z0 + t, 0];
  t -= h;
  if (t < w) return [r.x1 - t, r.z1, -Math.PI / 2];
  t -= w;
  return [r.x0, r.z1 - t, Math.PI];
}
function loopParam(b: Block, x: number, z: number) {
  const r = loopRect(b);
  const w = r.x1 - r.x0;
  const h = r.z1 - r.z0;
  const cx = Math.max(r.x0, Math.min(r.x1, x));
  const cz = Math.max(r.z0, Math.min(r.z1, z));
  const dTop = Math.abs(cz - r.z0);
  const dRight = Math.abs(cx - r.x1);
  const dBottom = Math.abs(cz - r.z1);
  const dLeft = Math.abs(cx - r.x0);
  const m = Math.min(dTop, dRight, dBottom, dLeft);
  if (m === dTop) return cx - r.x0;
  if (m === dRight) return w + (cz - r.z0);
  if (m === dBottom) return w + h + (r.x1 - cx);
  return 2 * w + h + (r.z1 - cz);
}

function blockContaining(x: number, z: number) {
  return BLOCKS.find((b) => x >= b.minX - 1 && x <= b.maxX + 1 && z >= b.minZ - 1 && z <= b.maxZ + 1);
}

/** All zebra crossings with both ends on block sidewalks. */
export const CROSSINGS: Crossing[] = [];
for (const n of INTERSECTIONS) {
  if (!n.signal) continue;
  for (const seg of OUTGOING.get(n.id) ?? []) {
    const d = seg.dir;
    const [dx, dz] = DIR_VEC[d];
    const horizontal = d === 'E' || d === 'W';
    const ext = (horizontal ? n.hx : n.hz) + CROSSWALK_GAP + CROSSWALK_WIDTH / 2;
    const cx = n.x + dx * ext;
    const cz = n.z + dz * ext;
    const half = roadHalfWidth(horizontal ? lineClass(n.z) : lineClass(n.x)) + INSET;
    const [px, pz] = [dz, -dx];
    const ax = cx + px * half;
    const az = cz + pz * half;
    const bx = cx - px * half;
    const bz = cz - pz * half;
    const blockA = blockContaining(ax, az);
    const blockB = blockContaining(bx, bz);
    if (blockA && blockB && blockA !== blockB) CROSSINGS.push({ junction: n, ax, az, bx, bz, blockA, blockB });
  }
}

const PALETTE = ['#4fa3e0', '#ef8a6f', '#f2c14e', '#6cc28b', '#d98fb4', '#9b7fd6', '#f6efe2', '#3cc9b0', '#e86b6b'];

export class PedestrianSystem {
  peds: Ped[] = [];
  target = 12;
  private rng = mulberry32(9090);
  private acc = 0;

  constructor() {
    for (let i = 0; i < 24; i++) {
      this.peds.push({ id: i, active: false, block: BLOCKS[0], u: 0, dir: 1, state: 'walk', crossing: null, ct: 0, x: 0, z: -5000, heading: 0, variant: i % 4, color: PALETTE[i % PALETTE.length], waitTime: 0, cooldown: 0, shaken: 0, speed: WALK, gender: i % 2 ? 'female' : 'male' });
    }
  }

  reset() {
    for (const p of this.peds) {
      p.active = false;
      p.z = -5000;
    }
  }

  private spawn() {
    const p = this.peds.find((q) => !q.active);
    if (!p) return;
    const me = runtime.pose;
    const cands = BLOCKS.filter((b) => {
      const dx = Math.max(b.minX - me.x, 0, me.x - b.maxX);
      const dz = Math.max(b.minZ - me.z, 0, me.z - b.maxZ);
      return Math.hypot(dx, dz) < 110;
    });
    if (!cands.length) return;
    const b = cands[Math.floor(this.rng() * cands.length)];
    for (let k = 0; k < 8; k++) {
      const u = this.rng() * perimeter(b);
      const [x, z] = loopPoint(b, u);
      const d = Math.hypot(x - me.x, z - me.z);
      if (d < 35 || d > 150) continue;
      Object.assign(p, { active: true, block: b, u, dir: this.rng() < 0.5 ? 1 : -1, state: 'walk', crossing: null, ct: 0, x, z, waitTime: 0, cooldown: 5, shaken: 0, color: PALETTE[Math.floor(this.rng() * PALETTE.length)], variant: Math.floor(this.rng() * 8), speed: 1.05 + this.rng() * 0.4 });
      return;
    }
  }

  /** Vehicles approaching a crossing within a few seconds (time-to-contact check). */
  private unsafe(c: Crossing) {
    const mx = (c.ax + c.bx) / 2;
    const mz = (c.az + c.bz) / 2;
    const check = (x: number, z: number, speed: number) => Math.hypot(x - mx, z - mz) < 12 + Math.abs(speed) * 2.5;
    const me = runtime.pose;
    if (check(me.x, me.z, runtime.telemetry.speed) && Math.abs(runtime.telemetry.speed) > 0.5) return true;
    return traffic.cars.some((k) => k.active && k.speed > 0.5 && check(k.x, k.z, k.speed));
  }

  step(dt: number) {
    this.acc += dt;
    const me = runtime.pose;
    if (this.acc > 0.5) {
      this.acc = 0;
      const active = this.peds.filter((p) => p.active).length;
      if (active < this.target) this.spawn();
      for (const p of this.peds) {
        if (p.active && p.state !== 'cross' && (Math.hypot(p.x - me.x, p.z - me.z) > 220 || active > this.target + 2)) {
          p.active = false;
          p.z = -5000;
        }
      }
    }
    pedestrianObstacles.length = 0;
    for (const p of this.peds) {
      if (!p.active) continue;
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.shaken = Math.max(0, p.shaken - dt);
      if (p.state === 'walk') {
        p.u += p.dir * p.speed * (p.shaken > 0 ? 1.4 : 1) * dt;
        const [x, z, h] = loopPoint(p.block, p.u);
        p.x = x;
        p.z = z;
        p.heading = p.dir > 0 ? h : h + Math.PI;
        if (p.cooldown <= 0) {
          for (const c of CROSSINGS) {
            const onA = c.blockA === p.block && Math.hypot(c.ax - x, c.az - z) < 1.2;
            const onB = c.blockB === p.block && Math.hypot(c.bx - x, c.bz - z) < 1.2;
            if (!onA && !onB) continue;
            p.cooldown = 8;
            if (this.rng() < 0.4) {
              p.state = 'wait';
              p.waitTime = 0;
              p.crossing = onA ? c : { ...c, ax: c.bx, az: c.bz, bx: c.ax, bz: c.az, blockA: c.blockB, blockB: c.blockA };
              p.x = p.crossing.ax;
              p.z = p.crossing.az;
              p.heading = Math.atan2(p.crossing.bx - p.crossing.ax, p.crossing.bz - p.crossing.az);
            }
            break;
          }
        }
      } else if (p.state === 'wait') {
        const c = p.crossing!;
        p.waitTime += dt;
        const ph = phaseAt(c.junction, runtime.simTime);
        // start only early in the pedestrian phase, never during clearance
        if (ph.ped && ph.remaining > 4 && !this.unsafe(c)) {
          p.state = 'cross';
          p.ct = 0;
        } else if (p.waitTime > 75) {
          p.state = 'walk';
          p.crossing = null;
        }
      } else if (p.state === 'cross') {
        const c = p.crossing!;
        const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
        p.ct = Math.min(1, p.ct + (p.speed * 1.15 * dt) / len);
        p.x = c.ax + (c.bx - c.ax) * p.ct;
        p.z = c.az + (c.bz - c.az) * p.ct;
        if (p.ct > 0.08 && p.ct < 0.92) pedestrianObstacles.push({ x: p.x, z: p.z });
        if (p.ct >= 1) {
          p.block = c.blockB;
          p.u = loopParam(p.block, p.x, p.z);
          p.state = 'walk';
          p.crossing = null;
          p.cooldown = 10;
        }
      }
    }
  }

  /** A pedestrian on the crossing near (x, z), for the blocking-crossing rule. */
  anyCrossingNear(x: number, z: number, r: number) {
    return this.peds.some((p) => p.active && p.state === 'cross' && Math.hypot(p.x - x, p.z - z) < r);
  }
}

export const pedestrians = new PedestrianSystem();
