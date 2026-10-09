import * as THREE from 'three';
import {
  BAYS,
  BLOCKS,
  CORNER_RADIUS,
  CROSSWALK_GAP,
  CROSSWALK_WIDTH,
  CURB_HEIGHT,
  DIR_VEC,
  INTERSECTIONS,
  LANDMARKS,
  MAP_HALF,
  ROAD_SPEC,
  SEGMENTS,
  SIDEWALK_WIDTH,
  STOP_LINE_GAP,
  STREET_NAMES_X,
  STREET_NAMES_Z,
  STRIP_WIDTH,
  blockAt,
  leftOf,
  lineClass,
  roadHalfWidth,
  segmentAlongBlockSide,
  segmentPoint,
  stripOffset,
  type Block,
  type Dir,
  type LandmarkId,
  type Segment,
} from '../data/cityMap';
import { BatchSet } from '../render/batches';
import { GeoBuilder } from '../render/geoBuilder';
import { frameMatrix, randomBuilding, type BuildingSpec, type Footprint } from './buildings';
import type { WorldPlacement } from './ImportedCity';
import { SHOPS, pickShop, streetSlot, type BoardDef } from './shopSigns';
import { LANDMARK_WIDTH, buildLandmark } from './landmarks';
import { hashString, mulberry32, pick, range, type Rng } from '../core/rng';

export interface BoxCollider {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  ry: number;
}

export interface SignDef {
  text: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  w: number;
  h: number;
  bg: string;
  fg: string;
}

export interface ParkedVehicle {
  model: 'car_compact' | 'car_coupe' | 'mpv_seven' | 'auto_city' | 'bus_small' | 'bus_medium' | 'bus_long';
  x: number;
  z: number;
  heading: number;
  color: string;
}

/** A seated café guest (instanced, baked pose). */
export interface Patron {
  x: number;
  y: number;
  z: number;
  ry: number;
  variant: number;
}

export interface CityChunk {
  id: string;
  center: THREE.Vector3;
  radius: number;
  merged: THREE.BufferGeometry | null;
  batches: BatchSet;
}

export interface CityBuild {
  worldPlacements: WorldPlacement[];
  chunks: CityChunk[];
  markings: THREE.BufferGeometry;
  /** Convex hull point clouds for raised platforms (ground group). */
  platformHulls: Float32Array[];
  /** Simple cuboid platforms (outer frame) in the ground group. */
  platformBoxes: BoxCollider[];
  staticBoxes: BoxCollider[];
  /** Camera-only spheres (tree canopies) so the chase camera never enters foliage. */
  cameraBalls: { x: number; y: number; z: number; r: number }[];
  signs: SignDef[];
  parked: ParkedVehicle[];
  /** Shop banners + street-name boards (one atlas, one mesh). */
  boards: BoardDef[];
  streetNames: string[];
  patrons: Patron[];
  stats: { buildings: number; trees: number; colliders: number; shops: number };
}

const SIDEWALK = '#efe3cf';
const CURB = '#f6efe2';
const GRASS = '#a9d98a';
const PLAZA = '#e6dac4';
const CAR_COLORS = ['#ee5a52', '#f4c430', '#3f7fd8', '#f6efe2', '#3cc9b0', '#9b7fd6', '#f39c5a', '#7fb069', '#e9b8d0'];

// ---------- helpers ----------

interface Side {
  dir: Dir; // which side of the block ('N' = road along the block's north edge)
  ox: number;
  oz: number;
  ax: number;
  az: number; // along
  nx: number;
  nz: number; // inward
  length: number;
  segment: Segment | undefined;
}

export function blockSides(b: Block): Side[] {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  return [
    { dir: 'N', ox: b.minX, oz: b.minZ, ax: 1, az: 0, nx: 0, nz: 1, length: w, segment: segmentAlongBlockSide(b, 'N') },
    { dir: 'E', ox: b.maxX, oz: b.minZ, ax: 0, az: 1, nx: -1, nz: 0, length: d, segment: segmentAlongBlockSide(b, 'E') },
    { dir: 'S', ox: b.maxX, oz: b.maxZ, ax: -1, az: 0, nx: 0, nz: -1, length: w, segment: segmentAlongBlockSide(b, 'S') },
    { dir: 'W', ox: b.minX, oz: b.maxZ, ax: 0, az: -1, nx: 1, nz: 0, length: d, segment: segmentAlongBlockSide(b, 'W') },
  ];
}

function sidePoint(s: Side, u: number, w: number): [number, number] {
  return [s.ox + s.ax * u + s.nx * w, s.oz + s.az * u + s.nz * w];
}
/** Yaw so that local +Z faces outward (toward the road). */
function sideYaw(s: Side) {
  return Math.atan2(-s.nx, -s.nz);
}

function roundedRectShape(minX: number, maxX: number, minZ: number, maxZ: number, r: number) {
  // Shape space (x, y) = world (x, -z)
  const s = new THREE.Shape();
  const x0 = minX;
  const x1 = maxX;
  const y0 = -maxZ;
  const y1 = -minZ;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function platformGeometry(minX: number, maxX: number, minZ: number, maxZ: number, r: number, h: number) {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(minX, maxX, minZ, maxZ, r), { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function flatShape(minX: number, maxX: number, minZ: number, maxZ: number, r: number, y: number) {
  const g = new THREE.ShapeGeometry(roundedRectShape(minX, maxX, minZ, maxZ, r), 6);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function hullPoints(minX: number, maxX: number, minZ: number, maxZ: number, r: number, h: number) {
  const pts = roundedRectShape(minX, maxX, minZ, maxZ, r).getPoints(4);
  const out = new Float32Array(pts.length * 6);
  pts.forEach((p, i) => {
    out.set([p.x, 0, -p.y, p.x, h, -p.y], i * 6);
  });
  return out;
}

function nearBay(seg: Segment | undefined, s: number, margin: number) {
  if (!seg) return false;
  return BAYS.some((b) => b.segmentId === seg.id && Math.abs(b.s - s) < b.length / 2 + margin);
}

/** Convert a side's u (from its origin corner) to distance along its segment. */
function sideUToSegmentS(side: Side, u: number) {
  const seg = side.segment;
  if (!seg) return u;
  const [px, pz] = sidePoint(side, u, 0);
  const [dx, dz] = DIR_VEC[seg.dir];
  return (px - seg.sx) * dx + (pz - seg.sz) * dz;
}

// ---------- block construction ----------

interface BuildCtx {
  worldPlacements: WorldPlacement[];
  staticBoxes: BoxCollider[];
  cameraBalls: CityBuild['cameraBalls'];
  signs: SignDef[];
  parked: ParkedVehicle[];
  boards: BoardDef[];
  patrons: Patron[];
  stats: CityBuild['stats'];
}

function addBoxCollider(ctx: BuildCtx, x: number, z: number, hx: number, hz: number, h: number, ry: number) {
  ctx.staticBoxes.push({ x, y: CURB_HEIGHT + h / 2, z, hx, hy: h / 2, hz, ry });
}

function resourceBuilding(ctx: BuildCtx, spec: BuildingSpec, x: number, z: number, ry: number): Footprint {
  const height = spec.floors * 3.1 + 2.2;
  ctx.worldPlacements.push({ pack: 'buildings', variant: ctx.stats.buildings, x, y: CURB_HEIGHT, z, ry, width: spec.width, height, depth: spec.depth });
  return { hx: spec.width / 2, hz: spec.depth / 2, height };
}

function resourceTree(ctx: BuildCtx, x: number, z: number, height: number, width: number, park: boolean) {
  const index = ctx.worldPlacements.length;
  const pack = park && index % 11 === 0 ? 'bananas' : index % 3 === 0 ? 'palms' : 'forest';
  ctx.worldPlacements.push({ pack, variant: index, x, y: CURB_HEIGHT, z, ry: (index * 2.39996) % (Math.PI * 2), width, height, depth: width });
}

function streetTree(b: BatchSet, ctx: BuildCtx, x: number, z: number, rng: Rng, scale = 1) {
  const y = CURB_HEIGHT;
  b.add('cyl', x, y + 0.2, z, 0.9, 0.4, 0.9, CURB);
  b.add('cyl', x, y + 0.42, z, 0.75, 0.05, 0.75, '#7a5233');
  const th = 2.0 * scale;
  rng();
  resourceTree(ctx, x, z, 6.5 * scale, 3.6 * scale, false);
  ctx.staticBoxes.push({ x, y: y + 1, z, hx: 0.35, hy: 1, hz: 0.35, ry: 0 });
  ctx.cameraBalls.push({ x, y: y + th + 1.5 * scale, z, r: 2.2 * scale });
  ctx.stats.trees++;
}

function parkTree(_b: BatchSet, x: number, z: number, rng: Rng, scale = 1, ctx?: BuildCtx) {
  const y = CURB_HEIGHT;
  const th = range(rng, 1.6, 2.6) * scale;
  rng();
  const r = range(rng, 1.7, 2.5) * scale;
  if (ctx) resourceTree(ctx, x, z, (th + r * 1.5), r * 2, true);
  ctx?.cameraBalls.push({ x, y: y + th + r * 0.7, z, r });
  rng();
}

function lamp(b: BatchSet, ctx: BuildCtx, x: number, z: number) {
  const y = CURB_HEIGHT;
  b.add('cyl', x, y + 0.15, z, 0.22, 0.3, 0.22, '#2f3a4a');
  b.add('cyl', x, y + 2.0, z, 0.08, 3.8, 0.08, '#2f3a4a');
  b.add('lampHead', x, y + 4.15, z, 0.38, 0.38, 0.38, '#fff6dc');
  ctx.staticBoxes.push({ x, y: y + 1.5, z, hx: 0.18, hy: 1.5, hz: 0.18, ry: 0 });
}

function bench(b: BatchSet, x: number, z: number, ry: number) {
  const f = frameMatrix(x, CURB_HEIGHT, z, ry);
  b.setFrame(f);
  b.add('box', 0, 0.45, 0, 1.7, 0.1, 0.5, '#c98a4b');
  b.add('box', 0, 0.78, -0.22, 1.7, 0.42, 0.08, '#c98a4b');
  b.add('box', -0.7, 0.22, 0, 0.08, 0.45, 0.45, '#3a4048');
  b.add('box', 0.7, 0.22, 0, 0.08, 0.45, 0.45, '#3a4048');
  b.setFrame(null);
}

function busShelter(b: BatchSet, ctx: BuildCtx, x: number, z: number, ry: number) {
  const f = frameMatrix(x, CURB_HEIGHT, z, ry);
  b.setFrame(f);
  b.add('rbox', 0, 2.7, 0, 5, 0.25, 2, '#2fb5a3');
  b.add('box', -2.3, 1.35, -0.7, 0.12, 2.7, 0.12, '#2f3a4a');
  b.add('box', 2.3, 1.35, -0.7, 0.12, 2.7, 0.12, '#2f3a4a');
  b.add('quad', 0, 1.5, -0.85, 4.5, 2.2, 1, '#9fc4dd');
  b.add('box', 0, 0.5, -0.5, 3.4, 0.1, 0.5, '#c98a4b');
  b.add('box', 3.2, 1.6, 0.6, 0.1, 3.2, 0.1, '#2f3a4a');
  b.add('rbox', 3.2, 3.1, 0.6, 0.9, 0.9, 0.12, '#2b6cb0');
  b.setFrame(null);
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  ctx.staticBoxes.push({ x: x - 0.7 * s, y: CURB_HEIGHT + 1.4, z: z - 0.7 * c, hx: 2.4, hy: 1.4, hz: 0.25, ry });
}

const STOREFRONT_FAMILIES = new Set(['shop', 'kiosk', 'glasslow']);

/** Choose a named business for a storefront building (sets the awning colour before it is built). */
function chooseShop(spec: BuildingSpec, rng: Rng, district: string, lmId?: LandmarkId) {
  if (!STOREFRONT_FAMILIES.has(spec.family)) return -1;
  const bias = lmId === 'cafe_corner' || lmId === 'restaurant_row' ? 0.75 : 0.45;
  const shop = pickShop(rng, district, bias);
  spec.accent = SHOPS[shop].awning;
  return shop;
}

/** Banner, menu board, café tables and seated guests in front of a named storefront. */
function storefront(b: BatchSet, ctx: BuildCtx, spec: BuildingSpec, fp: Footprint, shop: number, cx: number, cz: number, yaw: number, rng: Rng) {
  const d = spec.depth;
  const w = spec.width;
  const def = SHOPS[shop];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const toWorld = (lx: number, lz: number): [number, number] => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos];
  const board = (lx: number, y: number, lz: number, bw: number, bh: number) => {
    const [x, z] = toWorld(lx, lz + 0.09);
    ctx.boards.push({ slot: shop, x, y: CURB_HEIGHT + y, z, ry: yaw, w: bw, h: bh, double: false });
    b.add('rbox', lx, y, lz, bw + 0.3, bh + 0.28, 0.14, '#fbf6ea');
  };
  b.setFrame(frameMatrix(cx, CURB_HEIGHT, cz, yaw));
  if (spec.family === 'shop') {
    const bw = Math.min(6.2, w * 0.72);
    board(0, 3.62 + bw / 8, d / 2 + 0.06, bw, bw / 4);
  } else if (spec.family === 'kiosk') {
    const y = fp.height + 0.75;
    for (const sx of [-1.3, 1.3]) b.add('box', sx, fp.height + 0.2, d / 2 - 0.4, 0.1, 0.5, 0.1, '#2f3a4a');
    board(0, y, d / 2 - 0.4, 3.6, 0.9);
  } else {
    // glass front: banner above the entrance canopy
    board(0, 3.75, d / 2 + 0.06, 4.8, 1.2);
  }
  // A-frame menu board by the door
  b.add('box', w * 0.36, 0.5, d / 2 + 0.7, 0.62, 0.95, 0.06, '#2b2f36', 0, -0.18);
  b.add('box', w * 0.36, 0.56, d / 2 + 0.75, 0.5, 0.7, 0.04, def.seating ? '#3e5b4a' : def.bg, 0, -0.18);
  b.add('box', w * 0.36, 0.7, d / 2 + 0.78, 0.34, 0.05, 0.02, '#f6efe2', 0, -0.18);
  b.add('box', w * 0.36, 0.56, d / 2 + 0.76, 0.28, 0.04, 0.02, '#f6efe2', 0, -0.18);
  // café furniture + guests
  if (def.seating && spec.family !== 'kiosk') {
    const xs = w > 11 ? [-w * 0.24, w * 0.12] : [-w * 0.15];
    for (const tx of xs) {
      const tz = d / 2 + 1.35;
      b.add('cyl', tx, 0.02, tz, 0.24, 0.04, 0.24, '#3a4048');
      b.add('cyl', tx, 0.38, tz, 0.05, 0.72, 0.05, '#3a4048');
      b.add('cyl', tx, 0.75, tz, 0.44, 0.05, 0.44, '#f6efe2');
      for (const side of [-1, 1]) {
        const chx = tx + side * 0.78;
        b.add('box', chx, 0.23, tz, 0.4, 0.46, 0.4, '#c98a4b');
        b.add('box', chx + side * 0.19, 0.72, tz, 0.06, 0.54, 0.42, '#b47a3e');
        if (rng() < 0.75) {
          const [px, pz] = toWorld(chx, tz);
          // guest faces the table: local −side·X direction
          ctx.patrons.push({ x: px, y: CURB_HEIGHT, z: pz, ry: yaw - (side * Math.PI) / 2, variant: Math.floor(rng() * 6) });
          b.add('cyl', tx + side * 0.24, 0.82, tz + 0.08, 0.05, 0.09, 0.05, '#ffffff');
        }
      }
      const [wx, wz] = toWorld(tx, tz);
      ctx.staticBoxes.push({ x: wx, y: CURB_HEIGHT + 0.45, z: wz, hx: 1.1, hy: 0.45, hz: 0.5, ry: yaw });
    }
    // planters framing the terrace
    for (const sx of [-1, 1]) b.add('box', sx * (w / 2 - 0.5), 0.3, d / 2 + 1.35, 0.6, 0.6, 0.6, '#efe3cf');
    for (const sx of [-1, 1]) b.add('sphere', sx * (w / 2 - 0.5), 0.8, d / 2 + 1.35, 0.42, 0.36, 0.42, '#6cb84d');
  }
  b.setFrame(null);
  ctx.stats.shops++;
}

/** Green street-name boards on a pole at one corner of every junction. */
function streetSigns(b: BatchSet, ctx: BuildCtx, block: Block) {
  for (const n of INTERSECTIONS) {
    let done = false;
    for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      if (done) break;
      const blk = BLOCKS.find((k) => Math.abs((sx > 0 ? k.minX : k.maxX) - (n.x + sx * n.hx)) < 3 && Math.abs((sz > 0 ? k.minZ : k.maxZ) - (n.z + sz * n.hz)) < 3);
      if (!blk) continue;
      done = true;
      if (blk !== block) continue;
      const x = (sx > 0 ? blk.minX : blk.maxX) + sx * 4.2;
      const z = (sz > 0 ? blk.minZ : blk.maxZ) + sz * 4.2;
      const y = CURB_HEIGHT;
      b.add('cyl', x, y + 1.85, z, 0.07, 3.7, 0.07, '#2f3a4a');
      b.add('sphere', x, y + 3.75, z, 0.1, 0.1, 0.1, '#2f3a4a');
      // board along X names the east-west road; board along Z names the north-south road
      // boards extend from the pole toward the junction
      const ax = x - sx * 1.36;
      const bz = z - sz * 1.36;
      ctx.boards.push({ slot: streetSlot(5 + n.j), x: ax, y: y + 3.4, z, ry: 0, w: 2.6, h: 0.65, double: true });
      ctx.boards.push({ slot: streetSlot(n.i), x, y: y + 2.7, z: bz, ry: Math.PI / 2, w: 2.6, h: 0.65, double: true });
      b.add('box', ax, y + 3.4, z, 2.66, 0.71, 0.02, '#ffffff');
      b.add('box', x, y + 2.7, bz, 0.02, 0.71, 2.66, '#ffffff');
      ctx.staticBoxes.push({ x, y: y + 1.5, z, hx: 0.12, hy: 1.5, hz: 0.12, ry: 0 });
    }
  }
}

const LANDMARK_DISTRICT: Partial<Record<LandmarkId, 'residential' | 'commercial' | 'office' | 'mixed'>> = {
  garage: 'residential',
  homes_west: 'residential',
  cafe_corner: 'commercial',
  office_plaza: 'office',
  city_mall: 'commercial',
  restaurant_row: 'commercial',
  hospital: 'mixed',
  school: 'residential',
  station: 'mixed',
  airport: 'office',
  homes_east: 'residential',
  hotel: 'commercial',
  bus_depot: 'mixed',
};

function buildBlock(block: Block, ctx: BuildCtx): CityChunk {
  const rng = mulberry32(hashString(block.id));
  const merged = new GeoBuilder();
  const b = new BatchSet();
  const lm = LANDMARKS.find((l) => blockAt(l.x, l.z) === block);
  const isPark = lm?.id === 'central_park';
  const isAirport = lm?.id === 'airport';
  const isFuel = lm?.id === 'petrol_west' || lm?.id === 'petrol_south';
  const campus = isAirport || isFuel || lm?.id === 'hospital' || lm?.id === 'school' || lm?.id === 'station' || lm?.id === 'bus_depot';
  const district = (lm && LANDMARK_DISTRICT[lm.id]) ?? 'mixed';

  merged.geometry(platformGeometry(block.minX, block.maxX, block.minZ, block.maxZ, CORNER_RADIUS, CURB_HEIGHT), SIDEWALK);
  merged.geometry(
    flatShape(block.minX + SIDEWALK_WIDTH, block.maxX - SIDEWALK_WIDTH, block.minZ + SIDEWALK_WIDTH, block.maxZ - SIDEWALK_WIDTH, Math.max(1, CORNER_RADIUS - SIDEWALK_WIDTH), CURB_HEIGHT + 0.005),
    isPark ? GRASS : district === 'office' || district === 'commercial' ? PLAZA : '#c3e3a5',
  );
  // curb highlight ring
  merged.geometry(
    flatShape(block.minX + 0.05, block.maxX - 0.05, block.minZ + 0.05, block.maxZ - 0.05, CORNER_RADIUS, CURB_HEIGHT + 0.002),
    CURB,
  );
  merged.geometry(
    flatShape(block.minX + 0.45, block.maxX - 0.45, block.minZ + 0.45, block.maxZ - 0.45, CORNER_RADIUS - 0.4, CURB_HEIGHT + 0.004),
    SIDEWALK,
  );

  streetSigns(b, ctx, block);
  const sides = blockSides(block);
  const setback = SIDEWALK_WIDTH + (isAirport || isFuel ? 10 : 1.4);
  const cornerReserve = 26;

  for (const side of sides) {
    const yaw = sideYaw(side);
    // Street furniture along the sidewalk
    for (let u = CORNER_RADIUS + 8; u < side.length - CORNER_RADIUS - 8; u += 9) {
      const segS = sideUToSegmentS(side, u);
      if (nearBay(side.segment, segS, 2.5)) continue;
      const k = Math.round(u / 9);
      const [x, z] = sidePoint(side, u, 1.1);
      if (k % 2 === 0) streetTree(b, ctx, x, z, rng);
      else if (k % 4 === 1) lamp(b, ctx, x, z);
      else if (rng() < 0.25) bench(b, ...sidePoint(side, u, 3.0), yaw + Math.PI);
    }
    // Bus shelters at bus bays
    for (const bay of BAYS) {
      if (!bay.bus || bay.segmentId !== side.segment?.id) continue;
      const [lx, lz] = leftOf(side.segment.dir);
      const sx = bay.x + lx * (STRIP_WIDTH / 2 + 2.2);
      const sz = bay.z + lz * (STRIP_WIDTH / 2 + 2.2);
      busShelter(b, ctx, sx, sz, Math.atan2(-lx, -lz));
    }

    // Every named stop has the same name in the world as it does in dispatch and on the map.
    for (const bay of BAYS) {
      if (bay.segmentId !== side.segment?.id || bay.landmark !== lm?.id) continue;
      const u = (bay.waitX - side.ox) * side.ax + (bay.waitZ - side.oz) * side.az;
      const [sx, sz] = sidePoint(side, u + 5, 2.8);
      ctx.signs.push({ text: lm.name.toUpperCase(), x: sx, y: 2.8, z: sz, ry: yaw, w: 8, h: 1.35, bg: lm.color, fg: '#ffffff' });
      b.add('box', sx, CURB_HEIGHT + 1.2, sz, 0.12, 2.4, 0.12, '#2f3a4a');
      const [px, pz] = sidePoint(side, u, SIDEWALK_WIDTH + 1);
      b.add('box', px, CURB_HEIGHT + 0.01, pz, 3, 0.02, 3, '#f6efe2', yaw);
      if (isFuel) {
        // The usable pump is directly beside the curb bay; the forecourt pumps are scenery.
        const [qx, qz] = sidePoint(side, u + 4, 2.4);
        b.add('rbox', qx, CURB_HEIGHT + 0.9, qz, 0.8, 1.8, 0.7, '#ef7b4f', yaw);
        ctx.signs.push({ text: '⛽ STOP HERE', x: qx, y: 3.8, z: qz, ry: yaw, w: 6, h: 1.2, bg: '#ef7b4f', fg: '#ffffff' });
      }
    }

    if (isPark) continue;

    // Match every pickup/dropoff frontage, including the secondary side of a landmark.
    let resA = -1;
    let resB = -1;
    if (lm && BAYS.some((bay) => bay.landmark === lm.id && bay.segmentId === side.segment?.id && !bay.bus)) {
      const width = LANDMARK_WIDTH[lm.id];
      const bay = BAYS.find((bb) => bb.landmark === lm.id && bb.segmentId === side.segment?.id && !bb.bus);
      let uc = side.length / 2;
      if (bay) uc = (bay.x - side.ox) * side.ax + (bay.z - side.oz) * side.az;
      uc = Math.max(cornerReserve + width / 2, Math.min(side.length - cornerReserve - width / 2, uc));
      resA = uc - width / 2;
      resB = uc + width / 2;
      const [cx, cz] = sidePoint(side, uc, setback);
      const f = frameMatrix(cx, CURB_HEIGHT, cz, yaw);
      b.setFrame(f);
      const out = buildLandmark(lm.id, b, width, rng);
      b.setFrame(null);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const toWorld = (lx: number, lz: number): [number, number] => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos];
      for (const c of out.colliders) {
        const [wx, wz] = toWorld(c.x, c.z);
        addBoxCollider(ctx, wx, wz, c.hx, c.hz, c.h, yaw);
      }
      for (const s of out.signs) {
        const [wx, wz] = toWorld(s.x, s.z);
        ctx.signs.push({ text: s.text, x: wx, y: CURB_HEIGHT + s.y, z: wz, ry: yaw + (s.ry ?? 0), w: s.w, h: s.h, bg: s.bg, fg: s.fg });
      }
      for (const p of out.props) {
        const [wx, wz] = toWorld(p.x, p.z);
        if (p.kind === 'bus') {
          ctx.parked.push({ model: pick(rng, ['bus_small', 'bus_medium', 'bus_long'] as const), x: wx, z: wz, heading: yaw + Math.PI / 2, color: p.color ?? '#16a597' });
          ctx.staticBoxes.push({ x: wx, y: 1.6, z: wz, hx: 1.3, hy: 1.6, hz: 6, ry: yaw + Math.PI / 2 });
        } else if (p.kind === 'luggage') {
          b.add('rbox', wx, CURB_HEIGHT + 0.4, wz, 0.6, 0.8, 0.35, pick(rng, ['#e2685c', '#4f8fd6', '#f2c14e', '#7fb069']), yaw);
        }
      }
      ctx.stats.buildings++;
    }

    if (campus) continue;

    // Frontage buildings
    let u = cornerReserve;
    while (u < side.length - cornerReserve - 6) {
      if (resA >= 0 && u + 6 > resA && u < resB) {
        u = resB + 3;
        continue;
      }
      const maxW = Math.min(26, (resA >= 0 && u < resA ? resA - 2 : side.length - cornerReserve) - u);
      if (maxW < 7) {
        u += 4;
        continue;
      }
      const spec = randomBuilding(rng, { maxWidth: maxW, maxDepth: 17, district });
      spec.sides = true;
      const shop = chooseShop(spec, rng, district, lm?.id);
      const uc = u + spec.width / 2;
      const [cx, cz] = sidePoint(side, uc, setback + spec.depth / 2);
      b.setFrame(frameMatrix(cx, CURB_HEIGHT, cz, yaw));
      const fp = resourceBuilding(ctx, spec, cx, cz, yaw);
      b.setFrame(null);
      addBoxCollider(ctx, cx, cz, fp.hx, fp.hz, fp.height, yaw);
      if (shop >= 0) storefront(b, ctx, spec, fp, shop, cx, cz, yaw, rng);
      ctx.stats.buildings++;
      u += spec.width + range(rng, 2, 6);
      // small greenery in gaps
      if (rng() < 0.5) {
        const [gx, gz] = sidePoint(side, u - 1.5, setback + 3);
        b.add('sphere', gx, CURB_HEIGHT + 0.6, gz, 1.1, 0.8, 1.1, '#6cb84d');
      }
    }

    // Corner building at the side's start corner (each corner handled once by the side that starts there)
    if (rng() < 0.75) {
      const spec = randomBuilding(rng, { maxWidth: 16, maxDepth: 15, district: district === 'office' ? 'commercial' : district });
      spec.sides = true;
      const shop = chooseShop(spec, rng, district, lm?.id);
      const [cx, cz] = sidePoint(side, 6 + spec.width / 2, setback + spec.depth / 2 + 2);
      b.setFrame(frameMatrix(cx, CURB_HEIGHT, cz, yaw));
      const fp = resourceBuilding(ctx, spec, cx, cz, yaw);
      b.setFrame(null);
      addBoxCollider(ctx, cx, cz, fp.hx, fp.hz, fp.height, yaw);
      if (shop >= 0) storefront(b, ctx, spec, fp, shop, cx, cz, yaw, rng);
      ctx.stats.buildings++;
    } else {
      const [cx, cz] = sidePoint(side, 14, setback + 6);
      parkTree(b, cx, cz, rng, 1.1, ctx);
      bench(b, ...sidePoint(side, 12, setback + 1), yaw);
    }
  }

  // Interior fill
  const inset = setback + 48;
  const ix0 = block.minX + inset;
  const ix1 = block.maxX - inset;
  const iz0 = block.minZ + inset;
  const iz1 = block.maxZ - inset;
  if (isPark) {
    buildPark(block, b, merged, ctx, rng);
  } else if (isAirport) {
    buildAirportGrounds(block, b, merged, ctx);
  } else if (!campus) {
    for (let x = ix0 + 12; x < ix1 - 8; x += 34) {
      for (let z = iz0 + 12; z < iz1 - 8; z += 34) {
        const r = rng();
        const jx = x + range(rng, -5, 5);
        const jz = z + range(rng, -5, 5);
        if (r < 0.42) {
          const spec = randomBuilding(rng, { maxWidth: 22, maxDepth: 20, district: district === 'commercial' ? 'mixed' : district });
          spec.floors = Math.max(spec.floors, district === 'office' ? 8 : 4) + Math.floor(rng() * 3);
          spec.sides = true;
          const ry = Math.round(rng() * 4) * (Math.PI / 2);
          b.setFrame(frameMatrix(jx, CURB_HEIGHT, jz, ry));
          const fp = resourceBuilding(ctx, spec, jx, jz, ry);
          b.setFrame(null);
          addBoxCollider(ctx, jx, jz, fp.hx, fp.hz, fp.height, ry);
          ctx.stats.buildings++;
        } else {
          for (let t = 0; t < 2; t++) parkTree(b, jx + range(rng, -9, 9), jz + range(rng, -9, 9), rng, range(rng, 0.9, 1.3), ctx);
          if (rng() < 0.3) bench(b, jx, jz + 3, rng() * Math.PI);
        }
      }
    }
  }

  const center = new THREE.Vector3(block.cx, 10, block.cz);
  const radius = Math.hypot(block.maxX - block.minX, block.maxZ - block.minZ) / 2 + 30;
  return { id: block.id, center, radius, merged: merged.build(), batches: b };
}

function buildAirportGrounds(block: Block, b: BatchSet, merged: GeoBuilder, ctx: BuildCtx) {
  const y = CURB_HEIGHT + 0.02;
  const runwayZ = block.minZ + 35;
  merged.flat(block.maxX - block.minX - 34, 32, block.cx, y, runwayZ, '#576776');
  for (let x = block.minX + 30; x < block.maxX - 24; x += 18) merged.flat(9, 0.7, x, y + 0.005, runwayZ, '#ffffff');
  merged.flat(110, 64, block.cx + 15, y, block.cz, '#c3ccd1');
  // A parked airliner makes the airport readable even from the second gate.
  const x = block.cx + 15;
  const z = block.cz - 4;
  b.add('rbox', x, 3.4, z, 4.2, 4.2, 38, '#f6f7fb');
  b.add('sphere', x, 3.4, z + 20, 2.1, 2.1, 3.4, '#f6f7fb');
  b.add('quad', x, 4.2, z + 22.6, 2.6, 1.1, 1, '#4d6f93');
  b.add('box', x, 2.8, z - 1, 36, 0.5, 6, '#eef4f8');
  b.add('box', x, 3.3, z - 16, 14, 0.4, 4, '#eef4f8');
  b.add('box', x, 6.2, z - 17, 0.6, 6, 5, '#3fb6c8');
  for (const wing of [-1, 1]) {
    b.add('cyl', x + wing * 9, 2, z + 1, 1.25, 4, 1.25, '#fbf6ea', 0, Math.PI / 2);
    b.add('sphere', x + wing * 1.1, 0.7, z - 10, 0.4, 0.7, 0.7, '#263440');
  }
  addBoxCollider(ctx, x, z, 2.2, 21, 5.5, 0);
  ctx.signs.push({ text: 'AIRPORT · ARRIVALS / DEPARTURES', x: block.cx, y: 6, z: block.minZ + 10, ry: Math.PI, w: 35, h: 2.8, bg: '#1d3557', fg: '#ffffff' });
}

function buildPark(block: Block, b: BatchSet, merged: GeoBuilder, ctx: BuildCtx, rng: Rng) {
  const cx = block.cx;
  const cz = block.cz;
  const y = CURB_HEIGHT + 0.012;
  // cross paths and a ring path
  merged.flat(6, block.maxZ - block.minZ - 8, cx, y, cz, '#efe3cf');
  merged.flat(block.maxX - block.minX - 8, 6, cx, y, cz, '#efe3cf');
  const ring = new THREE.RingGeometry(38, 44, 40);
  ring.rotateX(-Math.PI / 2);
  ring.translate(cx, y + 0.002, cz);
  merged.geometry(ring, '#efe3cf');
  // pond
  const pond = new THREE.CircleGeometry(20, 32);
  pond.rotateX(-Math.PI / 2);
  pond.translate(cx + 55, y + 0.004, cz + 50);
  merged.geometry(pond, '#7fc8e8');
  const pondRim = new THREE.RingGeometry(20, 21.5, 32);
  pondRim.rotateX(-Math.PI / 2);
  pondRim.translate(cx + 55, y + 0.006, cz + 50);
  merged.geometry(pondRim, '#efe3cf');
  ctx.staticBoxes.push({ x: cx + 55, y: 0.5, z: cz + 50, hx: 14, hy: 0.5, hz: 14, ry: Math.PI / 4 });
  // trees scattered, avoiding paths
  for (let i = 0; i < 90; i++) {
    const x = range(rng, block.minX + 14, block.maxX - 14);
    const z = range(rng, block.minZ + 14, block.maxZ - 14);
    if (Math.abs(x - cx) < 7 || Math.abs(z - cz) < 7) continue;
    const dr = Math.hypot(x - cx, z - cz);
    if (dr > 33 && dr < 49) continue;
    if (Math.hypot(x - cx - 55, z - cz - 50) < 25) continue;
    parkTree(b, x, z, rng, range(rng, 0.9, 1.4), ctx);
    ctx.staticBoxes.push({ x, y: 1.2, z, hx: 0.4, hy: 1.2, hz: 0.4, ry: 0 });
  }
  // flower beds
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = cx + Math.cos(a) * 30;
    const z = cz + Math.sin(a) * 30;
    b.add('rbox', x, CURB_HEIGHT + 0.25, z, 3, 0.5, 3, '#efe3cf', a);
    b.add('sphere', x, CURB_HEIGHT + 0.6, z, 1.3, 0.5, 1.3, pick(rng, ['#f28cb1', '#f4b544', '#e2685c', '#b48ad6']));
  }
  for (let i = 0; i < 10; i++) bench(b, cx + range(rng, -60, 60), cz + (rng() < 0.5 ? 4.2 : -4.2), rng() < 0.5 ? 0 : Math.PI);
}

// ---------- roads and markings ----------

function buildMarkings(ctx: BuildCtx): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const Y = 0.012;
  const WHITE = '#f7f4ec';
  const YELLOW = '#f2c14e';
  const done = new Set<string>();
  const dash = (seg: Segment, lat: number, len: number, gap: number, color: string, width = 0.15) => {
    const yaw = Math.atan2(DIR_VEC[seg.dir][0], DIR_VEC[seg.dir][1]);
    for (let s = 2; s < seg.length - 2; s += len + gap) {
      const l = Math.min(len, seg.length - 2 - s);
      const [x, z] = segmentPoint(seg, s + l / 2, lat);
      g.flat(width, l, x, Y, z, color, yaw);
    }
  };
  const line = (seg: Segment, lat: number, color: string, width = 0.15, s0 = 0, s1 = seg.length) => {
    const yaw = Math.atan2(DIR_VEC[seg.dir][0], DIR_VEC[seg.dir][1]);
    const [x, z] = segmentPoint(seg, (s0 + s1) / 2, lat);
    g.flat(width, s1 - s0, x, Y, z, color, yaw);
  };

  for (const seg of SEGMENTS) {
    const spec = ROAD_SPEC[seg.cls];
    const pairKey = [seg.from, seg.to].sort().join('|');
    const first = !done.has(pairKey);
    done.add(pairKey);
    // centre markings once per road piece
    if (first) {
      if (spec.median > 0) {
        line(seg, spec.median / 2 - 0.12, YELLOW, 0.14);
        line(seg, -(spec.median / 2 - 0.12), YELLOW, 0.14);
        // hatch
        const yaw = Math.atan2(DIR_VEC[seg.dir][0], DIR_VEC[seg.dir][1]);
        for (let s = 4; s < seg.length - 4; s += 5) {
          const [x, z] = segmentPoint(seg, s, 0);
          g.flat(0.14, spec.median * 1.1, x, Y, z, YELLOW, yaw + Math.PI / 4);
        }
      } else {
        dash(seg, 0, 3, 4, WHITE, 0.15);
      }
    }
    // per-direction: lane divider, strip edge, stop line
    for (let k = 1; k < spec.lanes; k++) dash(seg, spec.median / 2 + k * spec.laneWidth, 3, 5, WHITE);
    line(seg, spec.median / 2 + spec.lanes * spec.laneWidth, WHITE, 0.15);
    const to = INTERSECTIONS.find((n) => n.id === seg.to)!;
    if (to.signal) {
      const yaw = Math.atan2(DIR_VEC[seg.dir][0], DIR_VEC[seg.dir][1]);
      const wid = spec.lanes * spec.laneWidth;
      const [x, z] = segmentPoint(seg, seg.length - 0.3, spec.median / 2 + wid / 2);
      g.flat(wid, 0.5, x, Y + 0.001, z, WHITE, yaw);
    }
  }

  // Crosswalks at each signalized approach (both directions share one crossing)
  for (const n of INTERSECTIONS) {
    if (!n.signal) continue;
    for (const d of ['E', 'W', 'N', 'S'] as Dir[]) {
      const [dx, dz] = DIR_VEC[d];
      const horizontal = d === 'E' || d === 'W';
      // does the junction have an arm in direction d?
      const hasArm = SEGMENTS.some((s) => s.from === n.id && s.dir === d);
      if (!hasArm) continue;
      const ext = (horizontal ? n.hx : n.hz) + CROSSWALK_GAP + CROSSWALK_WIDTH / 2;
      const cx = n.x + dx * ext;
      const cz = n.z + dz * ext;
      const roadHalf = roadHalfWidth(horizontal ? lineClass(n.z) : lineClass(n.x));
      const yaw = Math.atan2(dx, dz);
      const [lx, lz] = [dz, -dx];
      for (let t = -roadHalf + 0.5; t <= roadHalf - 0.5; t += 1.3) {
        g.flat(0.65, CROSSWALK_WIDTH, cx + lx * t, Y, cz + lz * t, WHITE, yaw);
      }
    }
  }

  // Bays: outline in the curb strip, bus bays in yellow
  for (const bay of BAYS) {
    const seg = SEGMENTS.find((s) => s.id === bay.segmentId)!;
    const off = stripOffset(seg);
    const col = bay.bus ? YELLOW : WHITE;
    const yaw = bay.heading;
    for (const s of [bay.s - bay.length / 2, bay.s + bay.length / 2]) {
      const [x, z] = segmentPoint(seg, s, off);
      g.flat(STRIP_WIDTH - 0.2, 0.15, x, Y, z, col, yaw + Math.PI / 2);
    }
    line(seg, off + STRIP_WIDTH / 2 - 0.2, col, 0.15, bay.s - bay.length / 2, bay.s + bay.length / 2);
    if (bay.bus) {
      for (let s = bay.s - bay.length / 2 + 1.5; s < bay.s + bay.length / 2 - 1; s += 2) {
        const [x, z] = segmentPoint(seg, s, off);
        g.flat(0.14, 2.2, x, Y, z, YELLOW, yaw + 0.7);
      }
    }
  }

  // Parked cars in curb strips (deterministic), away from bays and junctions
  const rng = mulberry32(777);
  for (const seg of SEGMENTS) {
    const off = stripOffset(seg);
    for (let s = 16; s < seg.length - 16; s += 7.5) {
      if (rng() > 0.16) continue;
      if (nearBay(seg, s, 24)) continue;
      const [x, z] = segmentPoint(seg, s, off + 0.1);
      const model = pick(rng, ['car_compact', 'car_compact', 'car_coupe', 'mpv_seven', 'auto_city'] as const);
      ctx.parked.push({ model, x, z, heading: Math.atan2(DIR_VEC[seg.dir][0], DIR_VEC[seg.dir][1]), color: pick(rng, CAR_COLORS) });
      ctx.staticBoxes.push({ x, y: 0.8, z, hx: model === 'auto_city' ? 0.7 : 0.9, hy: 0.8, hz: model === 'mpv_seven' ? 2.35 : 2.0, ry: Math.atan2(DIR_VEC[seg.dir][0], DIR_VEC[seg.dir][1]) });
      s += 6;
    }
  }
  return g.build();
}

// ---------- outer frame and scenery ----------

function buildOuter(ctx: BuildCtx, platformBoxes: BoxCollider[]): CityChunk {
  const merged = new GeoBuilder();
  const b = new BatchSet();
  const rng = mulberry32(99);
  const inner = 480 + roadHalfWidth('bypass');
  const outer = MAP_HALF + 40;
  const h = CURB_HEIGHT;
  const pieces: [number, number, number, number][] = [
    [-outer, outer, -outer, -inner],
    [-outer, outer, inner, outer],
    [-outer, -inner, -inner, inner],
    [inner, outer, -inner, inner],
  ];
  for (const [x0, x1, z0, z1] of pieces) {
    merged.box(x1 - x0, h, z1 - z0, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, '#b9df98');
    platformBoxes.push({ x: (x0 + x1) / 2, y: h / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: h / 2, hz: (z1 - z0) / 2, ry: 0 });
  }
  // outer sidewalk band
  for (const [x0, x1, z0, z1] of [
    [-inner - 4, inner + 4, -inner - 4, -inner],
    [-inner - 4, inner + 4, inner, inner + 4],
    [-inner - 4, -inner, -inner, inner],
    [inner, inner + 4, -inner, inner],
  ] as [number, number, number, number][]) {
    merged.flat(x1 - x0, z1 - z0, (x0 + x1) / 2, h + 0.004, (z0 + z1) / 2, SIDEWALK);
  }
  // hedge + fence barrier, trees beyond, and physical perimeter walls
  const fence = inner + 9;
  for (const [x, z, sx, sz] of [
    [0, -fence, fence * 2, 2.2],
    [0, fence, fence * 2, 2.2],
    [-fence, 0, 2.2, fence * 2],
    [fence, 0, 2.2, fence * 2],
  ] as [number, number, number, number][]) {
    b.add('rbox', x, h + 0.75, z, sx, 1.5, sz, '#6cb84d');
    b.add('box', x, h + 1.0, z, sx === 2.2 ? 0.3 : sx, 0.12, sz === 2.2 ? 0.3 : sz, '#fbf6ea');
  }
  for (const [x, z, hx, hz] of [
    [0, -fence, fence + 2, 1.2],
    [0, fence, fence + 2, 1.2],
    [-fence, 0, 1.2, fence + 2],
    [fence, 0, 1.2, fence + 2],
  ] as [number, number, number, number][]) {
    ctx.staticBoxes.push({ x, y: 2, z, hx, hy: 2, hz, ry: 0 });
  }
  for (let i = 0; i < 260; i++) {
    const side = Math.floor(rng() * 4);
    const t = range(rng, -outer + 10, outer - 10);
    const d = range(rng, fence + 6, outer - 6);
    const [x, z] = side === 0 ? [t, -d] : side === 1 ? [t, d] : side === 2 ? [-d, t] : [d, t];
    parkTree(b, x, z, rng, range(rng, 1.1, 1.8), ctx);
  }
  // distant hills
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + range(rng, -0.05, 0.05);
    const r = range(rng, 760, 900);
    const s = range(rng, 90, 170);
    merged.sphere(s, s * range(rng, 0.45, 0.7), s, Math.cos(a) * r, -s * 0.35, Math.sin(a) * r, pick(rng, ['#8fc67a', '#7db86a', '#a3d08c', '#93c9a6']), true);
  }
  return { id: 'outer', center: new THREE.Vector3(0, 0, 0), radius: 2000, merged: merged.build(), batches: b };
}

// ---------- entry ----------

export function buildCity(): CityBuild {
  const ctx: BuildCtx = { worldPlacements: [], staticBoxes: [], cameraBalls: [], signs: [], parked: [], boards: [], patrons: [], stats: { buildings: 0, trees: 0, colliders: 0, shops: 0 } };
  const platformBoxes: BoxCollider[] = [];
  const platformHulls: Float32Array[] = [];
  const chunks: CityChunk[] = [];
  for (const block of BLOCKS) {
    chunks.push(buildBlock(block, ctx));
    platformHulls.push(hullPoints(block.minX, block.maxX, block.minZ, block.maxZ, CORNER_RADIUS, CURB_HEIGHT));
  }
  chunks.push(buildOuter(ctx, platformBoxes));
  const markings = buildMarkings(ctx);
  ctx.stats.colliders = ctx.staticBoxes.length + platformBoxes.length + platformHulls.length;
  return { worldPlacements: ctx.worldPlacements, chunks, markings, platformHulls, platformBoxes, staticBoxes: ctx.staticBoxes, cameraBalls: ctx.cameraBalls, signs: ctx.signs, parked: ctx.parked, boards: ctx.boards, streetNames: [...STREET_NAMES_Z, ...STREET_NAMES_X], patrons: ctx.patrons, stats: ctx.stats };
}

export { STOP_LINE_GAP };
