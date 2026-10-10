import * as THREE from 'three';
import { pick, range, type Rng } from '../core/rng';

// Building family metadata and placement transforms for the imported city modules.

export const FACADES = ['#f4b183', '#f6d77a', '#9ad8c6', '#ef8a6f', '#9cc8ec', '#f3ead2', '#f7c6a3', '#c7e3a5', '#e9b8d0', '#ffd9a0', '#f2a7a0'];
export const ACCENTS = ['#ef7b4f', '#2fb5a3', '#e8a33d', '#d86a5c', '#4f8fd6', '#f2c14e', '#7fb069'];

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

/** Transform for a building frame: translate to (x, y, z) and rotate so local +Z faces `ry`. */
export function frameMatrix(x: number, y: number, z: number, ry: number) {
  return new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
}
