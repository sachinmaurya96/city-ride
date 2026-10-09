import * as THREE from 'three';
import type { BatchSet } from '../render/batches';
import { pick, range, type Rng } from '../core/rng';

// Building module families (plan §5.4). Each builder draws in a local frame:
// origin at the footprint center on the ground (y = 0 = top of the block platform),
// front façade facing +Z, width along X, depth along Z.

export const FACADES = ['#f4b183', '#f6d77a', '#9ad8c6', '#ef8a6f', '#9cc8ec', '#f3ead2', '#f7c6a3', '#c7e3a5', '#e9b8d0', '#ffd9a0', '#f2a7a0'];
export const ACCENTS = ['#ef7b4f', '#2fb5a3', '#e8a33d', '#d86a5c', '#4f8fd6', '#f2c14e', '#7fb069'];
const GLASS = '#4d6f93';
const GLASS_DARK = '#3b5878';
const TRIM = '#fbf6ea';
const ROOF = '#d9cbb5';

export type Family = 'apartment' | 'shop' | 'office' | 'townhouse' | 'rounded' | 'stepped' | 'kiosk' | 'tower' | 'glasslow';

export interface BuildingSpec {
  family: Family;
  width: number;
  depth: number;
  floors: number;
  color: string;
  accent: string;
  /** Façades that need windows. Back is hidden behind other buildings. */
  sides?: boolean;
}

export interface Footprint {
  hx: number;
  hz: number;
  height: number;
}

const FLOOR = 3.1;

function windowsOnFace(b: BatchSet, w: number, h0: number, floors: number, z: number, cols: number, winW: number, winH: number, color = GLASS, x0 = 0, faceRy = 0) {
  const step = w / cols;
  for (let f = 0; f < floors; f++) {
    const y = h0 + f * FLOOR + FLOOR * 0.55;
    for (let c = 0; c < cols; c++) {
      const x = x0 - w / 2 + step * (c + 0.5);
      if (faceRy === 0) {
        b.add('quad', x, y, z + 0.03, winW + 0.24, winH + 0.24, 1, TRIM);
        b.add('quad', x, y, z + 0.05, winW, winH, 1, color);
      } else {
        // side faces: rotate quad to face ±X
        const sx = Math.sign(Math.sin(faceRy));
        b.add('quad', z + sx * 0.03, y, x, winW + 0.24, winH + 0.24, 1, TRIM, faceRy);
        b.add('quad', z + sx * 0.05, y, x, winW, winH, 1, color, faceRy);
      }
    }
  }
}

function sideWindows(b: BatchSet, s: BuildingSpec, h0: number, floors: number) {
  const cols = Math.max(1, Math.floor(s.depth / 4.2));
  for (const sx of [1, -1]) windowsOnFace(b, s.depth * 0.8, h0, floors, sx * (s.width / 2), cols, 1.3, 1.5, GLASS, 0, (sx * Math.PI) / 2);
}

function parapet(b: BatchSet, w: number, d: number, h: number, color: string) {
  b.add('box', 0, h + 0.25, d / 2 - 0.15, w + 0.3, 0.5, 0.3, color);
  b.add('box', 0, h + 0.25, -d / 2 + 0.15, w + 0.3, 0.5, 0.3, color);
  b.add('box', w / 2 - 0.15, h + 0.25, 0, 0.3, 0.5, d, color);
  b.add('box', -w / 2 + 0.15, h + 0.25, 0, 0.3, 0.5, d, color);
}

function rooftop(b: BatchSet, w: number, d: number, h: number, rng: Rng) {
  if (rng() < 0.6) b.add('box', range(rng, -w / 4, w / 4), h + 0.6, range(rng, -d / 4, d / 4), 2.2, 1.2, 1.6, '#d8d4cc');
  if (rng() < 0.4) {
    const x = range(rng, -w / 3, w / 3);
    const z = range(rng, -d / 4, d / 4);
    b.add('cyl', x, h + 1.4, z, 0.9, 1.6, 0.9, '#5aa7e0');
    b.add('box', x, h + 0.35, z, 1.4, 0.7, 1.4, '#9aa0a8');
  }
  if (rng() < 0.35) b.add('sphere', range(rng, -w / 3, w / 3), h + 0.5, range(rng, -d / 3, d / 3), 1.1, 0.8, 1.1, '#7cc35a');
}

function awning(b: BatchSet, w: number, z: number, y: number, c1: string, c2: string) {
  const stripes = Math.max(4, Math.round(w / 1.2));
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    b.add('box', -w / 2 + sw * (i + 0.5), y, z + 0.9, sw, 0.12, 1.9, i % 2 ? c1 : c2, 0, 0.32);
  }
  for (let i = 0; i < stripes; i++) {
    b.add('box', -w / 2 + sw * (i + 0.5), y - 0.42, z + 1.75, sw * 0.98, 0.42, 0.14, i % 2 ? c1 : c2);
  }
}

export function buildBuilding(b: BatchSet, s: BuildingSpec, rng: Rng): Footprint {
  const { width: w, depth: d, color } = s;
  switch (s.family) {
    case 'apartment': {
      const h = s.floors * FLOOR + 0.6;
      b.add('box', 0, h / 2, 0, w, h, d, color);
      b.add('box', 0, 0.4, d / 2 + 0.02, w + 0.1, 0.8, 0.1, TRIM);
      const cols = Math.max(2, Math.floor(w / 3.6));
      windowsOnFace(b, w, 0.4, s.floors, d / 2, cols, 1.4, 1.6);
      // chunky balconies on upper floors, alternating columns
      for (let f = 1; f < s.floors; f++) {
        for (let c = 0; c < cols; c++) {
          if ((c + f) % 2) continue;
          const x = -w / 2 + (w / cols) * (c + 0.5);
          const y = 0.4 + f * FLOOR + 0.25;
          b.add('box', x, y, d / 2 + 0.65, 2.3, 0.3, 1.3, TRIM);
          b.add('box', x, y + 0.5, d / 2 + 1.25, 2.3, 0.75, 0.16, s.accent);
          if (rng() < 0.35) b.add('sphere', x + 0.7, y + 0.5, d / 2 + 0.9, 0.35, 0.3, 0.3, '#6cb84d');
        }
      }
      if (s.sides) sideWindows(b, s, 0.4, s.floors);
      parapet(b, w, d, h, TRIM);
      rooftop(b, w, d, h, rng);
      // entrance
      b.add('box', 0, 1.2, d / 2 + 0.04, 1.8, 2.4, 0.1, '#7a5233');
      b.add('rbox', 0, 2.65, d / 2 + 0.7, 3, 0.2, 1.4, s.accent);
      return { hx: w / 2, hz: d / 2, height: h };
    }
    case 'shop': {
      const h = s.floors * FLOOR + 0.8;
      b.add('box', 0, h / 2, 0, w, h, d, color);
      // ground-floor storefront glass
      b.add('quad', 0, 1.5, d / 2 + 0.03, w * 0.86, 2.4, 1, GLASS);
      b.add('box', 0, 2.95, d / 2 + 0.05, w, 0.35, 0.12, TRIM);
      for (let i = 0; i <= 3; i++) b.add('box', -w * 0.43 + (w * 0.86 * i) / 3, 1.5, d / 2 + 0.06, 0.18, 2.4, 0.1, TRIM);
      awning(b, w * 0.9, d / 2, 3.2, s.accent, '#fbf6ea');
      windowsOnFace(b, w, FLOOR + 0.3, s.floors - 1, d / 2, Math.max(2, Math.floor(w / 3.6)), 1.4, 1.5);
      if (s.sides) sideWindows(b, s, FLOOR + 0.3, s.floors - 1);
      parapet(b, w, d, h, s.accent);
      rooftop(b, w, d, h, rng);
      return { hx: w / 2, hz: d / 2, height: h };
    }
    case 'office':
    case 'tower': {
      const h = s.floors * FLOOR + 1;
      const glass = s.family === 'office';
      b.add('box', 0, h / 2, 0, w, h, d, glass ? '#e9eef2' : color);
      for (let f = 0; f < s.floors; f++) {
        const y = 0.6 + f * FLOOR + FLOOR * 0.55;
        if (glass) {
          b.add('quad', 0, y, d / 2 + 0.03, w * 0.92, FLOOR * 0.62, 1, f % 2 ? GLASS : GLASS_DARK);
          for (const sx of [1, -1]) b.add('quad', sx * (w / 2 + 0.03), y, 0, d * 0.9, FLOOR * 0.62, 1, GLASS, (sx * Math.PI) / 2);
        }
      }
      if (!glass) {
        windowsOnFace(b, w, 0.6, s.floors, d / 2, Math.max(2, Math.floor(w / 3.2)), 1.3, 1.7);
        b.add('box', 0, h / 2, d / 2 + 0.1, 1.4, h, 0.25, s.accent);
        sideWindows(b, s, 0.6, s.floors);
      }
      parapet(b, w, d, h, glass ? '#cfd8e0' : TRIM);
      b.add('box', 0, h + 1.1, 0, w * 0.5, 2.2, d * 0.5, glass ? '#dfe6ec' : TRIM);
      b.add('rbox', 0, 1.6, d / 2 + 1.2, w * 0.5, 0.25, 2.4, s.accent);
      b.add('quad', 0, 1.4, d / 2 + 0.04, 3.6, 2.6, 1, GLASS_DARK);
      return { hx: w / 2, hz: d / 2, height: h + 2.2 };
    }
    case 'townhouse': {
      const h = 2 * FLOOR + 0.4;
      b.add('box', 0, h / 2, 0, w, h, d, color);
      windowsOnFace(b, w, 0.3, 2, d / 2, Math.max(2, Math.floor(w / 3.4)), 1.3, 1.5);
      if (s.sides) sideWindows(b, s, 0.3, 2);
      // gable roof from two tilted slabs
      const pitch = 0.55;
      const half = d / 2 / Math.cos(pitch);
      const rise = (d / 2) * Math.tan(pitch);
      b.add('box', 0, h + rise / 2, d / 4, w + 0.6, 0.3, half + 0.3, s.accent, 0, pitch);
      b.add('box', 0, h + rise / 2, -d / 4, w + 0.6, 0.3, half + 0.3, s.accent, 0, -pitch);
      b.add('box', 0, h + rise / 2 - 0.2, 0, w - 0.1, rise, d * 0.5, color);
      b.add('box', 0, 1.1, d / 2 + 0.05, 1.2, 2.2, 0.1, '#7a5233');
      return { hx: w / 2, hz: d / 2, height: h + rise };
    }
    case 'rounded': {
      const h = s.floors * FLOOR + 0.6;
      b.add('box', 0, h / 2, 0, w - 4, h, d, color);
      for (const sx of [1, -1]) b.add('cyl', sx * (w / 2 - 2.5), h / 2 + 0.3, d / 2 - 2.5, 2.6, h + 0.6, 2.6, s.accent);
      b.add('box', 0, h / 2, -2.5, w, h, d - 5, color);
      windowsOnFace(b, w - 9, 0.4, s.floors, d / 2, Math.max(2, Math.floor((w - 9) / 3.4)), 1.4, 1.6);
      for (let f = 0; f < s.floors; f++) {
        for (const sx of [1, -1]) b.add('quad', sx * (w / 2 - 2.5), 0.4 + f * FLOOR + FLOOR * 0.55, d / 2 + 0.12, 1.6, 1.4, 1, GLASS);
      }
      parapet(b, w - 4, d, h, TRIM);
      rooftop(b, w - 4, d, h, rng);
      return { hx: w / 2, hz: d / 2, height: h + 0.6 };
    }
    case 'stepped': {
      const lower = Math.max(2, s.floors - 2);
      const h1 = lower * FLOOR + 0.5;
      const h2 = s.floors * FLOOR + 0.5;
      b.add('box', 0, h1 / 2, 0, w, h1, d, color);
      b.add('box', 0, (h1 + h2) / 2, -d * 0.15, w * 0.7, h2 - h1, d * 0.7, color);
      windowsOnFace(b, w, 0.3, lower, d / 2, Math.max(2, Math.floor(w / 3.6)), 1.4, 1.6);
      windowsOnFace(b, w * 0.7, h1, s.floors - lower, d * 0.2, Math.max(2, Math.floor((w * 0.7) / 3.6)), 1.4, 1.6);
      for (let i = 0; i < 4; i++) b.add('sphere', -w * 0.4 + i * w * 0.27, h1 + 0.5, d * 0.35, 0.8, 0.6, 0.7, '#6cb84d');
      b.add('box', 0, h1 + 0.35, d / 2 - 0.1, w, 0.7, 0.2, TRIM);
      if (s.sides) sideWindows(b, s, 0.3, lower);
      rooftop(b, w * 0.6, d * 0.6, h2, rng);
      return { hx: w / 2, hz: d / 2, height: h2 };
    }
    case 'kiosk': {
      const h = 3.6;
      b.add('box', 0, h / 2, 0, w, h, d, color);
      b.add('quad', 0, 1.4, d / 2 + 0.03, w * 0.8, 2.1, 1, GLASS);
      awning(b, w * 0.95, d / 2, 2.9, s.accent, '#fbf6ea');
      b.add('rbox', 0, h + 0.25, 0, w + 0.4, 0.5, d + 0.4, s.accent);
      return { hx: w / 2, hz: d / 2, height: h + 0.5 };
    }
    case 'glasslow': {
      const h = s.floors * FLOOR + 0.6;
      b.add('box', 0, h / 2, 0, w, h, d, '#eef2f4');
      for (let f = 0; f < s.floors; f++) b.add('quad', 0, 0.6 + f * FLOOR + FLOOR * 0.5, d / 2 + 0.03, w * 0.94, FLOOR * 0.7, 1, f % 2 ? GLASS : '#6d93b8');
      parapet(b, w, d, h, s.accent);
      b.add('rbox', 0, 2.9, d / 2 + 1.0, w * 0.6, 0.25, 2, s.accent);
      return { hx: w / 2, hz: d / 2, height: h };
    }
  }
}

export function randomBuilding(rng: Rng, opts: { maxWidth: number; maxDepth: number; district: 'residential' | 'commercial' | 'office' | 'mixed' }): BuildingSpec {
  const families: Record<typeof opts.district, Family[]> = {
    residential: ['apartment', 'apartment', 'townhouse', 'rounded', 'stepped', 'townhouse'],
    commercial: ['shop', 'shop', 'kiosk', 'apartment', 'stepped', 'glasslow'],
    office: ['office', 'tower', 'glasslow', 'office', 'shop'],
    mixed: ['apartment', 'shop', 'stepped', 'rounded', 'townhouse', 'glasslow', 'tower'],
  };
  const family = pick(rng, families[opts.district]);
  const floorsBy: Record<Family, [number, number]> = {
    apartment: [3, 6],
    shop: [2, 3],
    office: [6, 11],
    tower: [6, 9],
    townhouse: [2, 2],
    rounded: [3, 5],
    stepped: [4, 6],
    kiosk: [1, 1],
    glasslow: [2, 3],
  };
  const [f0, f1] = floorsBy[family];
  const width = Math.min(opts.maxWidth, family === 'kiosk' ? range(rng, 7, 10) : family === 'townhouse' ? range(rng, 9, 13) : range(rng, 14, 24));
  const depth = Math.min(opts.maxDepth, family === 'kiosk' ? 7 : range(rng, 11, 17));
  return {
    family,
    width,
    depth,
    floors: Math.round(range(rng, f0, f1)),
    color: pick(rng, FACADES),
    accent: pick(rng, ACCENTS),
  };
}

export const ROOF_COLOR = ROOF;

/** Transform for a building frame: translate to (x, y, z) and rotate so local +Z faces `ry`. */
export function frameMatrix(x: number, y: number, z: number, ry: number) {
  return new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
}
