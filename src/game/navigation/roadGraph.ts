import {
  DIR_VEC,
  INTERSECTIONS,
  OUTGOING,
  SEGMENTS,
  SEGMENT_BY_ID,
  curbLaneIndex,
  laneOffset,
  leftOf,
  roadHalfWidth,
  segmentPoint,
  stripOffset,
  type Intersection,
  type Segment,
} from '../data/cityMap';
import { VEHICLES, type VehicleId, type VehicleKind } from '../data/vehicles';

export const INTERSECTION_BY_ID = new Map(INTERSECTIONS.map((n) => [n.id, n]));

export type TurnType = 'straight' | 'left' | 'right' | 'uturn';

export function turnType(a: Segment, b: Segment): TurnType {
  const [ax, az] = DIR_VEC[a.dir];
  const [bx, bz] = DIR_VEC[b.dir];
  const dot = ax * bx + az * bz;
  if (dot > 0.5) return 'straight';
  if (dot < -0.5) return 'uturn';
  return az * bx - ax * bz > 0 ? 'left' : 'right';
}

/** Legal successor segments (no U-turns at junctions). */
export function successors(seg: Segment): Segment[] {
  return (OUTGOING.get(seg.to) ?? []).filter((n) => n.to !== seg.from);
}

// ---------- projection ----------

export interface RoadProjection {
  kind: 'segment' | 'junction' | 'off';
  segment?: Segment;
  s: number;
  lateral: number; // + = driver's left of the segment direction
  /** On the correct (left-hand) side for this segment and travelling with it. */
  correctSide: boolean;
  aligned: number; // cos angle between heading and segment direction
  junction?: Intersection;
}

const OFF: RoadProjection = { kind: 'off', s: 0, lateral: 0, correctSide: false, aligned: 0 };

/**
 * Project a world position (and heading) onto the road network. For two-way roads both directed
 * segments overlap; we choose the one whose direction matches the heading, and report whether the
 * vehicle is on that direction's side (left) — otherwise it is driving the wrong way.
 */
export function projectToRoad(x: number, z: number, fx: number, fz: number): RoadProjection {
  for (const n of INTERSECTIONS) {
    if (Math.abs(x - n.x) <= n.hx && Math.abs(z - n.z) <= n.hz) {
      return { kind: 'junction', s: 0, lateral: 0, correctSide: true, aligned: 1, junction: n };
    }
  }
  let best: RoadProjection | null = null;
  for (const seg of SEGMENTS) {
    const [dx, dz] = DIR_VEC[seg.dir];
    const [lx, lz] = leftOf(seg.dir);
    const px = x - seg.sx;
    const pz = z - seg.sz;
    const s = px * dx + pz * dz;
    if (s < -8 || s > seg.length + 8) continue;
    const lat = px * lx + pz * lz;
    const half = roadHalfWidth(seg.cls);
    if (Math.abs(lat) > half) continue;
    const aligned = fx * dx + fz * dz;
    if (aligned < 0) continue; // the opposite directed segment covers this heading
    const cand: RoadProjection = { kind: 'segment', segment: seg, s: Math.max(0, Math.min(seg.length, s)), lateral: lat, correctSide: lat >= -0.3, aligned };
    if (!best || aligned > best.aligned) best = cand;
  }
  return best ?? OFF;
}

/** World point on a segment's lane k (0 = inner) at distance s. */
export function lanePoint(seg: Segment, s: number, k = curbLaneIndex(seg)) {
  return segmentPoint(seg, s, laneOffset(seg, k));
}

// ---------- routing (A*) ----------

export interface RouteTarget {
  segmentId: string;
  s: number;
  /** Ease the final approach from the curb lane into the bay strip. */
  bay?: boolean;
}

export interface Route {
  segments: Segment[];
  startS: number;
  goalS: number;
  /** Planned legal length in meters (used for fares; detours never change it). */
  length: number;
  /** Polyline (x, z) along the curb lane including junction turn curves. */
  points: [number, number][];
  /** Cumulative distance along `points`. */
  cumulative: number[];
}

const TURN_PENALTY: Record<TurnType, number> = { straight: 0, left: 6, right: 18, uturn: 1e6 };

/** Minimum radius of the lane-to-lane turn path a→b (curb lanes for left turns, inner lanes for right). */
function computeTurnRadius(a: Segment, b: Segment) {
  const kind = turnType(a, b);
  if (kind === 'straight') return Infinity;
  const ka = kind === 'left' ? a.lanes - 1 : 0;
  const kb = kind === 'left' ? b.lanes - 1 : 0;
  const pts = turnCurve(a, b, ka, kb, 24);
  let r = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i - 1];
    const [x2, z2] = pts[i];
    const [x3, z3] = pts[i + 1];
    const A = Math.hypot(x2 - x1, z2 - z1);
    const B = Math.hypot(x3 - x2, z3 - z2);
    const C = Math.hypot(x3 - x1, z3 - z1);
    const area = Math.abs((x2 - x1) * (z3 - z1) - (x3 - x1) * (z2 - z1)) / 2;
    if (area > 1e-6) r = Math.min(r, (A * B * C) / (4 * area));
  }
  return r;
}
const TURN_RADIUS = new Map<string, number>();
export function turnRadius(a: Segment, b: Segment) {
  const key = `${a.id}>${b.id}`;
  let r = TURN_RADIUS.get(key);
  if (r === undefined) {
    r = computeTurnRadius(a, b);
    TURN_RADIUS.set(key, r);
  }
  return r;
}

/** Vehicle's tightest drivable radius from wheelbase and steering lock (plus a small margin). */
export function vehicleMinRadius(id: VehicleId) {
  const v = VEHICLES[id];
  const wheelbase = Math.abs(v.wheels.physics[0].z - v.wheels.physics[2].z);
  return (wheelbase / Math.tan((v.maxSteerDeg * Math.PI) / 180)) * 1.05;
}

export function segmentAllowed(_seg: Segment, _kind: VehicleKind) {
  return true;
}

export interface RouteOptions {
  /** Skip junction turns tighter than this radius (long buses use approved larger turns only). */
  minTurnRadius?: number;
}

export function findRoute(fromSeg: Segment, fromS: number, target: RouteTarget, kind: VehicleKind = 'car', opts: RouteOptions = {}): Route | null {
  const minR = opts.minTurnRadius ?? 0;
  const turnOk = (a: Segment, b: Segment) => minR <= 0 || turnRadius(a, b) >= minR;
  const goal = SEGMENT_BY_ID.get(target.segmentId);
  if (!goal) return null;
  if (fromSeg.id === goal.id && target.s >= fromS - 0.5) {
    return buildRoute([fromSeg], fromS, target.s, target.bay);
  }
  const [gx, gz] = segmentPoint(goal, target.s, 0);
  // Dijkstra/A* over directed segments; cost to reach the START of a segment.
  const open: { seg: Segment; g: number; f: number }[] = [];
  const gScore = new Map<string, number>();
  const prev = new Map<string, string>();
  const startCost = fromSeg.length - fromS;
  for (const n of successors(fromSeg)) {
    if (!segmentAllowed(n, kind) || !turnOk(fromSeg, n)) continue;
    const g = startCost + TURN_PENALTY[turnType(fromSeg, n)] + 12;
    if (g < (gScore.get(n.id) ?? Infinity)) {
      gScore.set(n.id, g);
      prev.set(n.id, fromSeg.id + '#start');
      open.push({ seg: n, g, f: g + Math.hypot(n.sx - gx, n.sz - gz) });
    }
  }
  const closed = new Set<string>();
  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;
    if (closed.has(cur.seg.id)) continue;
    closed.add(cur.seg.id);
    if (cur.seg.id === goal.id) {
      const chain: Segment[] = [];
      let id: string | undefined = goal.id;
      while (id && !id.endsWith('#start')) {
        chain.unshift(SEGMENT_BY_ID.get(id)!);
        id = prev.get(id);
      }
      chain.unshift(fromSeg);
      return buildRoute(chain, fromS, target.s, target.bay);
    }
    for (const n of successors(cur.seg)) {
      if (!segmentAllowed(n, kind) || closed.has(n.id) || !turnOk(cur.seg, n)) continue;
      const g = cur.g + cur.seg.length + TURN_PENALTY[turnType(cur.seg, n)] + 12;
      if (g < (gScore.get(n.id) ?? Infinity)) {
        gScore.set(n.id, g);
        prev.set(n.id, cur.seg.id);
        open.push({ seg: n, g, f: g + Math.hypot(n.sx - gx, n.sz - gz) });
      }
    }
  }
  return null;
}

/**
 * Junction path between lane end of `a` and lane start of `b`: straight lead-in, the largest circular
 * arc tangent to both lane lines that fits the junction, then a straight lead-out (interior points only).
 */
export function turnCurve(a: Segment, b: Segment, ka = curbLaneIndex(a), kb = curbLaneIndex(b), steps = 8): [number, number][] {
  const [ex, ez] = lanePoint(a, a.length, ka);
  const [sx, sz] = lanePoint(b, 0, kb);
  const [adx, adz] = DIR_VEC[a.dir];
  const [bdx, bdz] = DIR_VEC[b.dir];
  const pts: [number, number][] = [];
  if (Math.abs(adx * bdx + adz * bdz) > 0.5) {
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      pts.push([ex + (sx - ex) * t, ez + (sz - ez) * t]);
    }
    return pts;
  }
  // corner C = intersection of the two lane lines
  const cx = adx !== 0 ? sx : ex;
  const cz = adx !== 0 ? ez : sz;
  const dE = Math.hypot(ex - cx, ez - cz);
  const dS = Math.hypot(sx - cx, sz - cz);
  const r = Math.max(0.5, Math.min(dE, dS));
  const uex = (ex - cx) / (dE || 1);
  const uez = (ez - cz) / (dE || 1);
  const usx = (sx - cx) / (dS || 1);
  const usz = (sz - cz) / (dS || 1);
  const t1x = cx + uex * r;
  const t1z = cz + uez * r;
  const t2x = cx + usx * r;
  const t2z = cz + usz * r;
  const ox = cx + (uex + usx) * r;
  const oz = cz + (uez + usz) * r;
  if (dE - r > 0.5) for (let d = 2; d < dE - r; d += 2) pts.push([ex + (t1x - ex) * (d / (dE - r)), ez + (t1z - ez) * (d / (dE - r))]);
  const a0 = Math.atan2(t1z - oz, t1x - ox);
  let a1 = Math.atan2(t2z - oz, t2x - ox);
  while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
  while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
  const n = Math.max(steps, Math.ceil(Math.abs(a1 - a0) * r / 1.5));
  for (let i = 0; i <= n; i++) {
    const ang = a0 + ((a1 - a0) * i) / n;
    pts.push([ox + Math.cos(ang) * r, oz + Math.sin(ang) * r]);
  }
  if (dS - r > 0.5) for (let d = 2; d < dS - r; d += 2) pts.push([t2x + (sx - t2x) * (d / (dS - r)), t2z + (sz - t2z) * (d / (dS - r))]);
  return pts;
}

export function buildRoute(segments: Segment[], startS: number, goalS: number, intoBay = false): Route {
  const points: [number, number][] = [];
  segments.forEach((seg, i) => {
    const s0 = i === 0 ? startS : 0;
    const s1 = i === segments.length - 1 ? goalS : seg.length;
    const last = i === segments.length - 1;
    const laneLat = laneOffset(seg, curbLaneIndex(seg));
    const bayLat = stripOffset(seg);
    const at = (s: number): [number, number] => {
      if (!last || !intoBay) return lanePoint(seg, s);
      const k = Math.max(0, Math.min(1, 1 - (s1 - s) / 22));
      const e = k * k * (3 - 2 * k);
      return segmentPoint(seg, s, laneLat + (bayLat - laneLat) * e);
    };
    const step = 4;
    for (let s = s0; s < s1; s += step) points.push(at(s));
    points.push(at(s1));
    if (i < segments.length - 1) points.push(...turnCurve(seg, segments[i + 1]));
  });
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { segments, startS, goalS, length: cumulative[cumulative.length - 1], points, cumulative };
}

/** Nearest distance-along-route of a world point, searching near a hint index. */
export function progressAlong(route: Route, x: number, z: number, hint = 0): { along: number; index: number; offRoute: number } {
  let best = Infinity;
  let bestIdx = hint;
  let bestAlong = 0;
  const from = Math.max(0, hint - 20);
  const to = Math.min(route.points.length - 1, hint + 60);
  for (let i = from; i < to; i++) {
    const [ax, az] = route.points[i];
    const [bx, bz] = route.points[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
    const px = ax + vx * t;
    const pz = az + vz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bestIdx = i;
      bestAlong = route.cumulative[i] + Math.sqrt(len2) * t;
    }
  }
  return { along: bestAlong, index: bestIdx, offRoute: best };
}
