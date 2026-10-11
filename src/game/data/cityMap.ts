// Single authored city definition (plan §5). Road meshes, lane graph, signals, bays and the
// minimap are all generated from this module so they cannot disagree.
// Coordinates: meters, X east, Z south (north = -Z), Y up. Left-hand traffic.

import type { VehicleKind } from './vehicles';

export const GRID = [-480, -240, 0, 240, 480] as const;
export const MAP_HALF = 600;

export type RoadClass = 'bypass' | 'avenue' | 'local';

export interface RoadLine {
  axis: 'x' | 'z'; // 'x': road runs along X at constant z; 'z': runs along Z at constant x
  coord: number;
  cls: RoadClass;
}

export const ROAD_SPEC: Record<RoadClass, { lanes: number; laneWidth: number; median: number; limitKmh: number; name: string }> = {
  bypass: { lanes: 2, laneWidth: 3.4, median: 1.2, limitKmh: 60, name: 'Ring Road' },
  avenue: { lanes: 2, laneWidth: 3.4, median: 1.2, limitKmh: 50, name: 'Avenue' },
  local: { lanes: 1, laneWidth: 3.3, median: 0, limitKmh: 40, name: 'Street' },
};

/** Parking/bay strip between the outer travel lane and the curb (bays and parked cars live here). */
export const STRIP_WIDTH = 2.8;
export const SIDEWALK_WIDTH = 4;
export const CURB_HEIGHT = 0.15;
export const CORNER_RADIUS = 9;

export function lineClass(c: number): RoadClass {
  if (Math.abs(c) === 480) return 'bypass';
  if (c === 0) return 'avenue';
  return 'local';
}

export function roadHalfWidth(cls: RoadClass) {
  const s = ROAD_SPEC[cls];
  return s.median / 2 + s.lanes * s.laneWidth + STRIP_WIDTH;
}

export const ROAD_LINES: RoadLine[] = [
  ...GRID.map((z) => ({ axis: 'x' as const, coord: z, cls: lineClass(z) })),
  ...GRID.map((x) => ({ axis: 'z' as const, coord: x, cls: lineClass(x) })),
];

// ---------- Intersections ----------

export interface Intersection {
  id: string;
  i: number; // index into GRID along x
  j: number; // index into GRID along z
  x: number;
  z: number;
  /** Half extent of the junction box along X (= half width of the N-S road) and Z. */
  hx: number;
  hz: number;
  arms: number;
  signal: boolean;
  /** Seconds offset into the signal cycle (green wave). */
  cycleOffset: number;
  name: string;
}

export const STREET_NAMES_X = ['Hill Rd', 'Lotus St', 'Central Ave', 'Garden St', 'Lake Rd'];
export const STREET_NAMES_Z = ['West Ring', 'Mango St', 'Main Ave', 'Palm St', 'East Ring'];

export const INTERSECTIONS: Intersection[] = [];
for (let i = 0; i < GRID.length; i++) {
  for (let j = 0; j < GRID.length; j++) {
    const edgeX = i === 0 || i === GRID.length - 1;
    const edgeZ = j === 0 || j === GRID.length - 1;
    const arms = 4 - (edgeX ? 1 : 0) - (edgeZ ? 1 : 0);
    INTERSECTIONS.push({
      id: `n${i}${j}`,
      i,
      j,
      x: GRID[i],
      z: GRID[j],
      hx: roadHalfWidth(lineClass(GRID[i])),
      hz: roadHalfWidth(lineClass(GRID[j])),
      arms,
      signal: arms >= 3,
      cycleOffset: ((i * 7 + j * 13) % 9) * 6,
      name: `${STREET_NAMES_Z[i]} × ${STREET_NAMES_X[j]}`,
    });
  }
}

export function intersectionAt(i: number, j: number) {
  return INTERSECTIONS[i * GRID.length + j];
}

/** Distance from junction center to stop line / lane start along an approach. */
export const CROSSWALK_GAP = 1; // from junction box edge to crosswalk
export const CROSSWALK_WIDTH = 3.5;
export const STOP_LINE_GAP = CROSSWALK_GAP + CROSSWALK_WIDTH + 1; // from junction box edge

// ---------- Directed road segments ----------

export type Dir = 'E' | 'W' | 'N' | 'S';
export const DIR_VEC: Record<Dir, [number, number]> = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
/** Driver's left (left-hand traffic keeps to the left). left = (dz, -dx). */
export function leftOf(d: Dir): [number, number] {
  const [dx, dz] = DIR_VEC[d];
  return [dz, -dx];
}
export function headingOf(d: Dir) {
  const [dx, dz] = DIR_VEC[d];
  return Math.atan2(dx, dz); // yaw where 0 = +Z
}

export interface Segment {
  id: string;
  from: string; // intersection id
  to: string;
  dir: Dir;
  cls: RoadClass;
  /** Road centerline coordinate (z for E/W roads, x for N/S roads). */
  lineCoord: number;
  /** Start and end points on the road centerline where lanes begin/end (outside junction + crosswalk). */
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  length: number;
  lanes: number;
  limitKmh: number;
  name: string;
}

export const SEGMENTS: Segment[] = [];
export const SEGMENT_BY_ID = new Map<string, Segment>();
/** Outgoing segments by intersection id. */
export const OUTGOING = new Map<string, Segment[]>();
export const INCOMING = new Map<string, Segment[]>();

function addSegment(a: Intersection, b: Intersection, dir: Dir) {
  const [dx, dz] = DIR_VEC[dir];
  const horizontal = dir === 'E' || dir === 'W';
  const cls = horizontal ? lineClass(a.z) : lineClass(a.x);
  // Gap from junction center to lane start = junction half-extent (along travel) + stop gap.
  const aExt = (horizontal ? a.hx : a.hz) + STOP_LINE_GAP;
  const bExt = (horizontal ? b.hx : b.hz) + STOP_LINE_GAP;
  const sx = a.x + dx * aExt;
  const sz = a.z + dz * aExt;
  const ex = b.x - dx * bExt;
  const ez = b.z - dz * bExt;
  const spec = ROAD_SPEC[cls];
  const seg: Segment = {
    id: `${a.id}-${b.id}`,
    from: a.id,
    to: b.id,
    dir,
    cls,
    lineCoord: horizontal ? a.z : a.x,
    sx,
    sz,
    ex,
    ez,
    length: Math.hypot(ex - sx, ez - sz),
    lanes: spec.lanes,
    limitKmh: spec.limitKmh,
    name: horizontal ? STREET_NAMES_X[a.j] : STREET_NAMES_Z[a.i],
  };
  SEGMENTS.push(seg);
  SEGMENT_BY_ID.set(seg.id, seg);
  if (!OUTGOING.has(a.id)) OUTGOING.set(a.id, []);
  if (!INCOMING.has(b.id)) INCOMING.set(b.id, []);
  OUTGOING.get(a.id)!.push(seg);
  INCOMING.get(b.id)!.push(seg);
}

for (let i = 0; i < GRID.length; i++) {
  for (let j = 0; j < GRID.length; j++) {
    const n = intersectionAt(i, j);
    if (i + 1 < GRID.length) {
      const e = intersectionAt(i + 1, j);
      addSegment(n, e, 'E');
      addSegment(e, n, 'W');
    }
    if (j + 1 < GRID.length) {
      const s = intersectionAt(i, j + 1);
      addSegment(n, s, 'S');
      addSegment(s, n, 'N');
    }
  }
}

/** Lateral offset (toward the driver's left) of lane k (0 = inner/fast lane) from the road centerline. */
export function laneOffset(seg: Pick<Segment, 'cls'>, k: number) {
  const s = ROAD_SPEC[seg.cls];
  return s.median / 2 + (k + 0.5) * s.laneWidth;
}
export function curbLaneIndex(seg: Pick<Segment, 'lanes'>) {
  return seg.lanes - 1;
}
export function stripOffset(seg: Pick<Segment, 'cls'>) {
  const s = ROAD_SPEC[seg.cls];
  return s.median / 2 + s.lanes * s.laneWidth + STRIP_WIDTH / 2;
}

/** Point at distance s along a segment, laterally offset to the driver's left by `lat`. */
export function segmentPoint(seg: Segment, s: number, lat: number): [number, number] {
  const [dx, dz] = DIR_VEC[seg.dir];
  const [lx, lz] = leftOf(seg.dir);
  return [seg.sx + dx * s + lx * lat, seg.sz + dz * s + lz * lat];
}

// ---------- Blocks ----------

export interface Block {
  id: string;
  /** Block index in grid cells. */
  bi: number;
  bj: number;
  cx: number;
  cz: number;
  /** Platform bounds (curb line). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const BLOCKS: Block[] = [];
for (let i = 0; i < GRID.length - 1; i++) {
  for (let j = 0; j < GRID.length - 1; j++) {
    const x0 = GRID[i];
    const x1 = GRID[i + 1];
    const z0 = GRID[j];
    const z1 = GRID[j + 1];
    BLOCKS.push({
      id: `b${i}${j}`,
      bi: i,
      bj: j,
      cx: (x0 + x1) / 2,
      cz: (z0 + z1) / 2,
      minX: x0 + roadHalfWidth(lineClass(x0)),
      maxX: x1 - roadHalfWidth(lineClass(x1)),
      minZ: z0 + roadHalfWidth(lineClass(z0)),
      maxZ: z1 - roadHalfWidth(lineClass(z1)),
    });
  }
}

export function blockAt(x: number, z: number) {
  return BLOCKS.find((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
}

// ---------- Landmarks and curb bays ----------

export type LandmarkId =
  | 'garage'
  | 'homes_west'
  | 'cafe_corner'
  | 'central_park'
  | 'office_plaza'
  | 'city_mall'
  | 'restaurant_row'
  | 'hospital'
  | 'school'
  | 'station'
  | 'airport'
  | 'homes_east'
  | 'hotel'
  | 'bus_depot'
  | 'petrol_west'
  | 'petrol_south';

export interface Landmark {
  id: LandmarkId;
  name: string;
  nameRu: string;
  short: string;
  x: number;
  z: number;
  color: string;
  icon: string;
}

export const LANDMARKS: Landmark[] = [
  { id: 'garage', name: 'Driver Garage', nameRu: 'Гараж', short: 'Garage', x: -360, z: 360, color: '#18a99c', icon: '🔧' },
  { id: 'homes_west', name: 'Homes West', nameRu: 'Западные дома', short: 'Homes W', x: -360, z: 120, color: '#f0a868', icon: '🏠' },
  { id: 'cafe_corner', name: 'Corner Café', nameRu: 'Кафе на углу', short: 'Café', x: -120, z: 120, color: '#ef7b4f', icon: '☕' },
  { id: 'central_park', name: 'Central Park', nameRu: 'Центральный парк', short: 'Park', x: -120, z: -120, color: '#6cbf5a', icon: '🌳' },
  { id: 'office_plaza', name: 'Office Plaza', nameRu: 'Офисная площадь', short: 'Office', x: 120, z: -120, color: '#4a8fd8', icon: '🏢' },
  { id: 'city_mall', name: 'City Mall', nameRu: 'Городской ТЦ', short: 'Mall', x: 360, z: -120, color: '#e8b94a', icon: '🛍️' },
  { id: 'restaurant_row', name: 'Restaurant Row', nameRu: 'Ресторанный ряд', short: 'Food', x: 120, z: 120, color: '#e2685c', icon: '🍜' },
  { id: 'hospital', name: 'City Hospital', nameRu: 'Больница', short: 'Hospital', x: -360, z: -360, color: '#5aa7e0', icon: '🏥' },
  { id: 'school', name: 'Sunrise School', nameRu: 'Школа', short: 'School', x: -120, z: -360, color: '#f2c14e', icon: '🏫' },
  { id: 'station', name: 'Transit Station', nameRu: 'Вокзал', short: 'Station', x: 120, z: -360, color: '#7a7fd6', icon: '🚉' },
  { id: 'airport', name: 'Airport Gate', nameRu: 'Аэропорт', short: 'Airport', x: 360, z: -360, color: '#3fb6c8', icon: '✈️' },
  { id: 'homes_east', name: 'Homes East', nameRu: 'Восточные дома', short: 'Homes E', x: 360, z: 120, color: '#d98fb4', icon: '🏡' },
  { id: 'hotel', name: 'Grand Hotel', nameRu: 'Гранд-отель', short: 'Hotel', x: 120, z: 360, color: '#b48ad6', icon: '🏨' },
  { id: 'bus_depot', name: 'Bus Depot', nameRu: 'Автобусный парк', short: 'Depot', x: 360, z: 360, color: '#16a597', icon: '🚌' },
  { id: 'petrol_west', name: 'West Petrol Station', nameRu: 'Западная АЗС', short: 'Fuel W', x: -360, z: -120, color: '#ef7b4f', icon: '⛽' },
  { id: 'petrol_south', name: 'South Petrol Station', nameRu: 'Южная АЗС', short: 'Fuel S', x: -120, z: 360, color: '#ef7b4f', icon: '⛽' },
];

export const LANDMARK_BY_ID = new Map(LANDMARKS.map((l) => [l.id, l]));

export interface Bay {
  id: string;
  landmark: LandmarkId;
  segmentId: string;
  /** Distance along the segment of the bay center. */
  s: number;
  length: number;
  width: number;
  x: number;
  z: number;
  heading: number;
  /** Which side (always the driver's left in left-hand traffic). */
  roadSide: 'left';
  bus: boolean;
  allowed: VehicleKind[];
  /** Where the waiting passenger stands (on the sidewalk next to the bay). */
  waitX: number;
  waitZ: number;
}

/**
 * Bay definitions: landmark, which side of its block the bay is on, and position fraction along that side.
 * side: 'N' = road on the block's north edge, etc.
 */
const BAY_DEFS: { landmark: LandmarkId; side: Dir; t: number; bus?: boolean }[] = [
  { landmark: 'garage', side: 'E', t: 0.35 },
  { landmark: 'garage', side: 'N', t: 0.55 },
  { landmark: 'homes_west', side: 'S', t: 0.42 },
  { landmark: 'homes_west', side: 'E', t: 0.6 },
  { landmark: 'homes_west', side: 'N', t: 0.5, bus: true },
  { landmark: 'cafe_corner', side: 'S', t: 0.55 },
  { landmark: 'cafe_corner', side: 'W', t: 0.5 },
  { landmark: 'cafe_corner', side: 'E', t: 0.5, bus: true },
  { landmark: 'central_park', side: 'S', t: 0.5 },
  { landmark: 'central_park', side: 'E', t: 0.45 },
  { landmark: 'office_plaza', side: 'W', t: 0.5 },
  { landmark: 'office_plaza', side: 'S', t: 0.6 },
  { landmark: 'office_plaza', side: 'N', t: 0.5, bus: true },
  { landmark: 'city_mall', side: 'W', t: 0.55 },
  { landmark: 'city_mall', side: 'S', t: 0.45 },
  { landmark: 'city_mall', side: 'N', t: 0.5, bus: true },
  { landmark: 'restaurant_row', side: 'N', t: 0.5 },
  { landmark: 'restaurant_row', side: 'W', t: 0.6 },
  { landmark: 'hospital', side: 'E', t: 0.5 },
  { landmark: 'hospital', side: 'S', t: 0.5 },
  { landmark: 'school', side: 'S', t: 0.5 },
  { landmark: 'school', side: 'W', t: 0.55 },
  { landmark: 'station', side: 'S', t: 0.4 },
  { landmark: 'station', side: 'W', t: 0.5 },
  { landmark: 'station', side: 'E', t: 0.5, bus: true },
  { landmark: 'airport', side: 'S', t: 0.5 },
  { landmark: 'airport', side: 'W', t: 0.45 },
  { landmark: 'airport', side: 'N', t: 0.5, bus: true },
  { landmark: 'homes_east', side: 'W', t: 0.5 },
  { landmark: 'homes_east', side: 'N', t: 0.5, bus: true },
  { landmark: 'homes_east', side: 'S', t: 0.4 },
  { landmark: 'hotel', side: 'N', t: 0.5 },
  { landmark: 'hotel', side: 'E', t: 0.5 },
  { landmark: 'hotel', side: 'W', t: 0.5, bus: true },
  { landmark: 'bus_depot', side: 'N', t: 0.45 },
  { landmark: 'bus_depot', side: 'W', t: 0.5, bus: true },
  { landmark: 'petrol_west', side: 'E', t: 0.5 },
  { landmark: 'petrol_south', side: 'N', t: 0.5 },
];

/** The segment running along the given side of a block whose driver's-left faces the block. */
export function segmentAlongBlockSide(b: Block, side: Dir): Segment | undefined {
  const i = b.bi;
  const j = b.bj;
  let a: Intersection, c: Intersection;
  switch (side) {
    case 'N': // road z = GRID[j]; block is south of it (z larger) → need left = +Z → dir W
      a = intersectionAt(i + 1, j);
      c = intersectionAt(i, j);
      break;
    case 'S': // road z = GRID[j+1]; block north of it → left = -Z → dir E
      a = intersectionAt(i, j + 1);
      c = intersectionAt(i + 1, j + 1);
      break;
    case 'W': // road x = GRID[i]; block east of it → left = +X → dir N (left of N is W?) check below
      a = intersectionAt(i, j + 1);
      c = intersectionAt(i, j);
      break;
    case 'E':
      a = intersectionAt(i + 1, j);
      c = intersectionAt(i + 1, j + 1);
      break;
  }
  const seg = SEGMENT_BY_ID.get(`${a.id}-${c.id}`);
  if (!seg) return undefined;
  // Verify the driver's left actually faces the block center.
  const [lx, lz] = leftOf(seg.dir);
  const mx = (seg.sx + seg.ex) / 2;
  const mz = (seg.sz + seg.ez) / 2;
  const toBlock = (b.cx - mx) * lx + (b.cz - mz) * lz;
  if (toBlock > 0) return seg;
  // Otherwise the opposite direction is correct.
  return SEGMENT_BY_ID.get(`${c.id}-${a.id}`);
}

export const BAYS: Bay[] = [];
const bayCount = new Map<string, number>();
for (const def of BAY_DEFS) {
  const lm = LANDMARK_BY_ID.get(def.landmark)!;
  const block = blockAt(lm.x, lm.z)!;
  const seg = segmentAlongBlockSide(block, def.side)!;
  const fuel = def.landmark === 'petrol_west' || def.landmark === 'petrol_south';
  const length = def.bus || fuel ? 18 : 8;
  const margin = 30;
  const s = Math.max(margin, Math.min(seg.length - margin, seg.length * def.t));
  const off = stripOffset(seg);
  const [x, z] = segmentPoint(seg, s, off);
  const [wx, wz] = segmentPoint(seg, s, off + STRIP_WIDTH / 2 + 1.6);
  const n = (bayCount.get(def.landmark) ?? 0) + 1;
  bayCount.set(def.landmark, n);
  BAYS.push({
    id: `${def.landmark}_${def.bus ? 'bus' : 'bay'}${n}`,
    landmark: def.landmark,
    segmentId: seg.id,
    s,
    length,
    width: def.bus ? 3.3 : STRIP_WIDTH + 0.6,
    x,
    z,
    heading: headingOf(seg.dir),
    roadSide: 'left',
    bus: !!def.bus,
    allowed: fuel ? ['bike', 'auto', 'car', 'bus'] : def.bus ? ['bus'] : ['bike', 'auto', 'car'],
    waitX: wx,
    waitZ: wz,
  });
}

export const BAY_BY_ID = new Map(BAYS.map((b) => [b.id, b]));
export interface FuelStation extends Bay { name: string; pumpX: number; pumpZ: number; pumpHeading: number }
/** One off-road forecourt per street section. Existing named stations keep their saved IDs. */
export const FUEL_STATIONS: FuelStation[] = SEGMENTS.filter(s => s.dir === 'E' || s.dir === 'S').map(section => {
  const existing = BAYS.find(b => (b.landmark === 'petrol_west' || b.landmark === 'petrol_south')
    && (b.segmentId === section.id || b.segmentId === `${section.to}-${section.from}`));
  const innerSide = section.dir === 'E' && section.lineCoord === -480 || section.dir === 'S' && section.lineCoord === 480;
  const seg = existing ? SEGMENT_BY_ID.get(existing.segmentId)! : innerSide ? SEGMENT_BY_ID.get(`${section.to}-${section.from}`)! : section;
  const candidates = [.24, .76, .38, .62].map(t => t * seg.length);
  const pumpS = existing?.s ?? candidates.reduce((best, value) => {
    const clearance = (v: number) => Math.min(...BAYS.filter(b => b.segmentId === seg.id || b.segmentId === `${seg.to}-${seg.from}`).map(b => Math.abs(v - (b.segmentId === seg.id ? b.s : seg.length - b.s))), seg.length);
    return clearance(value) > clearance(best) ? value : best;
  });
  const offset = roadHalfWidth(seg.cls) + SIDEWALK_WIDTH;
  // The station model's HP pylon stands at its front corner; set the filling bay back so the pylon never covers it.
  const bayS = Math.max(10, pumpS - 5);
  const [x, z] = segmentPoint(seg, bayS, offset + 4.2), [pumpX, pumpZ] = segmentPoint(seg, pumpS, offset + 20);
  const bay: FuelStation = { id: existing?.id ?? `fuel_${section.id}`, landmark: existing?.landmark ?? 'petrol_west', segmentId: seg.id, s: bayS,
    x, z, length: 18, width: 6, heading: headingOf(seg.dir), roadSide: 'left', bus: false, allowed: ['bike', 'auto', 'car', 'bus'],
    waitX: x, waitZ: z, name: existing ? LANDMARK_BY_ID.get(existing.landmark)!.name : `${seg.name} Petrol Pump`,
    pumpX, pumpZ, pumpHeading: Math.atan2(-leftOf(seg.dir)[0], -leftOf(seg.dir)[1]) };
  BAY_BY_ID.set(bay.id, bay); return bay;
});

/** Garage spawn: in the curb travel lane outside the garage, facing along traffic. */
export function garageSpawn() {
  const bay = BAYS.find((b) => b.id === 'garage_bay1')!;
  const seg = SEGMENT_BY_ID.get(bay.segmentId)!;
  const [x, z] = segmentPoint(seg, bay.s - 12, laneOffset(seg, curbLaneIndex(seg)));
  return { x, z, heading: bay.heading };
}

/** Localized landmark name for UI text (3D signs are world art and stay as authored). */
export function landmarkName(id: LandmarkId, lang: 'en' | 'ru') {
  const l = LANDMARK_BY_ID.get(id)!;
  return lang === 'ru' ? l.nameRu : l.name;
}
