import type { BatchSet } from '../render/batches';
import type { LandmarkId } from '../data/cityMap';
import { range, type Rng } from '../core/rng';

/** Sign request in landmark-local coordinates (front of landmark faces +Z, ground y = 0). */
export interface LocalSign {
  text: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  bg: string;
  fg: string;
  /** Rotation around Y relative to the landmark front. */
  ry?: number;
}

export interface LocalBox {
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
}

export interface LandmarkBuild {
  signs: LocalSign[];
  colliders: LocalBox[];
  /** Static parked vehicles (local), e.g. buses at the depot. */
  props: { kind: 'bus' | 'car' | 'luggage'; x: number; z: number; ry: number; color?: string }[];
}

const GLASS = '#4d6f93';
const TRIM = '#fbf6ea';

function hall(b: BatchSet, out: LandmarkBuild, x: number, z: number, w: number, d: number, h: number, color: string) {
  b.add('box', x, h / 2, z, w, h, d, color);
  b.add('box', x, h + 0.3, z, w + 0.4, 0.6, d + 0.4, TRIM);
  out.colliders.push({ x, z, hx: w / 2, hz: d / 2, h });
}

function windowGrid(b: BatchSet, x: number, z: number, w: number, floors: number, y0: number, cols: number, color = GLASS) {
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const wx = x - w / 2 + (w / cols) * (c + 0.5);
      const wy = y0 + f * 3.1 + 1.7;
      b.add('quad', wx, wy, z + 0.03, 1.8, 1.9, 1, TRIM);
      b.add('quad', wx, wy, z + 0.05, 1.5, 1.6, 1, color);
    }
  }
}

function tree(b: BatchSet, x: number, z: number, s = 1) {
  b.add('cyl', x, 0.9 * s, z, 0.2 * s, 1.8 * s, 0.2 * s, '#8a5a3a');
  b.add('sphere', x, 2.9 * s, z, 1.8 * s, 1.5 * s, 1.8 * s, '#7cc35a');
  b.add('sphere', x + 0.8 * s, 3.5 * s, z - 0.3 * s, 1.1 * s, 1.0 * s, 1.1 * s, '#6cb84d');
}

function planterRow(b: BatchSet, x: number, z: number, w: number) {
  b.add('rbox', x, 0.3, z, w, 0.6, 1.2, '#efe3cf');
  const n = Math.max(1, Math.round(w / 1.4));
  for (let i = 0; i < n; i++) b.add('sphere', x - w / 2 + (w / n) * (i + 0.5), 0.85, z, 0.65, 0.5, 0.55, i % 2 ? '#6cb84d' : '#7cc35a');
}

function umbrellaTable(b: BatchSet, x: number, z: number, color: string) {
  b.add('cyl', x, 0.38, z, 0.45, 0.06, 0.45, '#a8774a');
  b.add('cyl', x, 0.2, z, 0.05, 0.4, 0.05, '#3a4048');
  b.add('cyl', x, 1.2, z, 0.04, 1.6, 0.04, '#3a4048');
  b.add('cyl', x, 2.05, z, 1.3, 0.12, 1.3, color);
  b.add('sphere', x, 2.1, z, 1.3, 0.35, 1.3, color);
  for (const [dx, dz] of [[0.75, 0], [-0.75, 0]]) b.add('rbox', x + dx, 0.25, z + dz, 0.4, 0.5, 0.4, '#c98a4b');
}

export function buildLandmark(id: LandmarkId, b: BatchSet, width: number, _rng: Rng): LandmarkBuild {
  const out: LandmarkBuild = { signs: [], colliders: [], props: [] };
  const w = width;
  switch (id) {
    case 'garage': {
      hall(b, out, 0, -12, 34, 20, 7.5, '#f3ead2');
      // teal workshop canopy over two open bays
      b.add('rbox', 0, 7.6, -1, 36, 0.6, 6, '#18a99c');
      for (const x of [-15, 15]) b.add('box', x, 3.7, 1.4, 0.5, 7.4, 0.5, '#18a99c');
      for (const x of [-8.5, 0, 8.5]) b.add('quad', x, 2.8, -1.95, 7, 5.4, 1, '#3e4a57');
      b.add('rbox', 0, 6.1, -1.85, 34, 0.5, 0.3, '#ef7b4f');
      out.signs.push({ text: '🔧 GARAGE', x: 0, y: 9.4, z: 1.2, w: 14, h: 2.6, bg: '#18a99c', fg: '#ffffff' });
      // tire stacks and tool cabinets
      for (const [x, z] of [[-17, 2], [-16, 3.3], [17.2, 2.4]]) {
        for (let i = 0; i < 3; i++) b.add('cyl', x, 0.18 + i * 0.36, z, 0.55, 0.34, 0.55, '#2b2f36');
      }
      b.add('rbox', 11, 0.7, -2.5, 2.2, 1.4, 0.9, '#e5484d');
      // forecourt
      b.add('box', 0, 0.02, 4, 40, 0.04, 8, '#d8cdb8');
      for (let i = -3; i <= 3; i++) b.add('box', i * 5, 0.05, 4, 0.18, 0.02, 7, '#f4b544');
      // side office
      hall(b, out, w / 2 - 8, -10, 12, 14, 5.5, '#9ad8c6');
      windowGrid(b, w / 2 - 8, -3, 10, 1, 0.3, 3);
      planterRow(b, -w / 2 + 6, 3, 8);
      break;
    }
    case 'cafe_corner': {
      hall(b, out, 0, -9, 22, 16, 6.8, '#f7c6a3');
      b.add('box', 0, 7.6, -9, 22.4, 1.6, 16.4, '#ef7b4f');
      b.add('quad', 0, 1.6, -0.97, 18, 2.6, 1, GLASS);
      const stripes = 14;
      for (let i = 0; i < stripes; i++) b.add('box', -10 + (20 / stripes) * (i + 0.5), 3.5, 0.1, 20 / stripes, 0.12, 2.2, i % 2 ? '#ef7b4f' : '#fbf6ea', 0, 0.3);
      out.signs.push({ text: 'CAFÉ', x: 0, y: 6.4, z: -0.9, w: 9, h: 2.2, bg: '#ef7b4f', fg: '#fff6e8' });
      for (const [x, c] of [[-7, '#fbf6ea'], [-2.5, '#ef7b4f'], [2.5, '#fbf6ea'], [7, '#ef7b4f']] as const) umbrellaTable(b, x, 3.2, c);
      planterRow(b, -w / 2 + 5, 2.5, 6);
      planterRow(b, w / 2 - 5, 2.5, 6);
      b.add('box', 9.5, 0.6, 1.4, 0.1, 1.2, 0.8, '#3a4048', 0.3);
      break;
    }
    case 'central_park': {
      // handled by park builder in cityBuilder; add gazebo + fountain near the front
      const gz = -40;
      b.add('cyl', 0, 0.25, gz, 7, 0.5, 7, '#efe3cf');
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        b.add('cyl', Math.cos(a) * 5.5, 2.2, gz + Math.sin(a) * 5.5, 0.22, 4, 0.22, '#fbf6ea');
      }
      b.add('cyl', 0, 4.4, gz, 7, 0.4, 7, '#e2685c');
      b.add('sphere', 0, 4.6, gz, 6.6, 2.6, 6.6, '#e2685c');
      b.add('sphere', 0, 7.4, gz, 0.5, 0.5, 0.5, '#f4b544');
      out.colliders.push({ x: 0, z: gz, hx: 6, hz: 6, h: 6 });
      out.signs.push({ text: '🌳 CENTRAL PARK', x: 0, y: 2.4, z: -1, w: 12, h: 1.8, bg: '#5fae48', fg: '#ffffff' });
      b.add('box', -6.6, 1.2, -1, 0.3, 2.4, 0.3, '#7a5233');
      b.add('box', 6.6, 1.2, -1, 0.3, 2.4, 0.3, '#7a5233');
      // fountain
      b.add('cyl', 0, 0.4, -18, 5, 0.8, 5, '#efe3cf');
      b.add('cyl', 0, 0.75, -18, 4.3, 0.2, 4.3, '#7fc8e8');
      b.add('cyl', 0, 1.6, -18, 0.5, 1.8, 0.5, '#efe3cf');
      b.add('sphere', 0, 2.8, -18, 1.1, 0.6, 1.1, '#9ad8f0');
      out.colliders.push({ x: 0, z: -18, hx: 5, hz: 5, h: 1 });
      break;
    }
    case 'office_plaza': {
      const towers: [number, number, number, number][] = [[-22, -14, 16, 40], [4, -18, 18, 52], [27, -12, 14, 30]];
      for (const [x, z, s, h] of towers) {
        b.add('box', x, h / 2, z, s, h, s, '#e9eef2');
        for (let f = 0; f < Math.floor(h / 3.1); f++) {
          const y = 1.6 + f * 3.1;
          b.add('quad', x, y, z + s / 2 + 0.03, s * 0.9, 2, 1, f % 2 ? '#4d6f93' : '#5b82ab');
          b.add('quad', x - s / 2 - 0.03, y, z, s * 0.9, 2, 1, '#4d6f93', -Math.PI / 2);
          b.add('quad', x + s / 2 + 0.03, y, z, s * 0.9, 2, 1, '#4d6f93', Math.PI / 2);
        }
        b.add('box', x, h + 1, z, s * 0.6, 2, s * 0.6, '#cfd8e0');
        out.colliders.push({ x, z, hx: s / 2, hz: s / 2, h });
      }
      out.signs.push({ text: 'OFFICE', x: 4, y: 49, z: -8.8, w: 10, h: 2.4, bg: '#2b6cb0', fg: '#ffffff' });
      out.signs.push({ text: 'OFFICE PLAZA', x: 0, y: 1.7, z: 2.4, w: 10, h: 1.6, bg: '#2b6cb0', fg: '#ffffff' });
      b.add('box', -4.6, 0.8, 2.3, 0.3, 1.6, 0.3, '#1d2b36');
      b.add('box', 4.6, 0.8, 2.3, 0.3, 1.6, 0.3, '#1d2b36');
      b.add('cyl', -12, 0.4, 0, 3, 0.8, 3, '#efe3cf');
      b.add('sphere', -12, 1.1, 0, 2.6, 0.7, 2.6, '#6cb84d');
      planterRow(b, 14, 1, 10);
      break;
    }
    case 'city_mall': {
      hall(b, out, 0, -18, w - 10, 34, 12, '#f6d77a');
      b.add('box', 0, 6, -0.6, 30, 12, 2, '#f3ead2');
      b.add('rbox', 0, 5.2, 2.4, 34, 0.6, 6, '#18a99c');
      b.add('quad', 0, 2.5, 0.43, 22, 4.6, 1, GLASS);
      for (let i = 0; i <= 5; i++) b.add('box', -11 + i * 4.4, 2.5, 0.5, 0.25, 4.6, 0.12, TRIM);
      out.signs.push({ text: 'MALL', x: 0, y: 9, z: 0.45, w: 14, h: 3.4, bg: '#f3ead2', fg: '#1d3557' });
      out.signs.push({ text: '🛍️', x: -(w - 10) / 2 + 6, y: 7, z: -0.95, w: 5, h: 5, bg: '#ef8fb0', fg: '#ffffff' });
      out.signs.push({ text: '🛍️', x: (w - 10) / 2 - 6, y: 7, z: -0.95, w: 5, h: 5, bg: '#9ad8c6', fg: '#ffffff' });
      windowGrid(b, -32, -0.95, 22, 2, 1, 5);
      windowGrid(b, 32, -0.95, 22, 2, 1, 5);
      for (let i = 0; i < 6; i++) {
        const x = -25 + i * 10;
        b.add('cyl', x, 0.5, 3.5, 0.25, 1, 0.25, '#2f3a4a');
        b.add('sphere', x, 1.05, 3.5, 0.28, 0.12, 0.28, '#ececec');
      }
      planterRow(b, -18, 3, 8);
      planterRow(b, 18, 3, 8);
      break;
    }
    case 'restaurant_row': {
      const names = ['NOODLES', 'PIZZA', 'TIFFIN', 'SWEETS', 'GRILL'];
      const colors = ['#e2685c', '#f2c14e', '#7fb069', '#d98fb4', '#ef7b4f'];
      const n = names.length;
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + sw * (i + 0.5);
        const h = 7 + (i % 2) * 3;
        b.add('box', x, h / 2, -8, sw - 1, h, 16, ['#f7c6a3', '#f3ead2', '#ffd9a0', '#f4b183', '#e9b8d0'][i]);
        b.add('quad', x, 1.6, -0.0 + 0.03 - 0.0, sw - 3, 2.6, 1, GLASS);
        const stripes = 8;
        for (let s = 0; s < stripes; s++) b.add('box', x - (sw - 2) / 2 + ((sw - 2) / stripes) * (s + 0.5), 3.5, 0.9, (sw - 2) / stripes, 0.12, 1.9, s % 2 ? colors[i] : '#fbf6ea', 0, 0.3);
        out.signs.push({ text: names[i], x, y: 5.2, z: 0.05, w: sw - 4, h: 1.5, bg: colors[i], fg: '#ffffff' });
        out.colliders.push({ x, z: -8, hx: (sw - 1) / 2, hz: 8, h });
        if (i % 2 === 0) umbrellaTable(b, x, 3.2, colors[i]);
      }
      break;
    }
    case 'hospital': {
      hall(b, out, 0, -16, 46, 28, 16, '#f6f7fb');
      b.add('box', 0, 8, -1.9, 46.2, 1.2, 0.3, '#5aa7e0');
      windowGrid(b, -13, -1.95, 18, 4, 0.6, 5, '#7fb6e6');
      windowGrid(b, 13, -1.95, 18, 4, 0.6, 5, '#7fb6e6');
      b.add('rbox', 0, 4, 2.2, 14, 0.5, 6, '#5aa7e0');
      for (const x of [-6.5, 6.5]) b.add('box', x, 2, 4.8, 0.4, 4, 0.4, '#f6f7fb');
      out.signs.push({ text: '✚ HOSPITAL', x: 0, y: 13.6, z: -1.8, w: 16, h: 2.8, bg: '#ffffff', fg: '#d94b4b' });
      b.add('box', 0, 18.5, -16, 6, 5, 1, '#d94b4b');
      b.add('box', 0, 18.5, -16, 2, 5, 1.1, '#ffffff');
      b.add('box', 0, 18.5, -16, 6, 1.6, 1.1, '#ffffff');
      planterRow(b, -16, 2, 10);
      planterRow(b, 16, 2, 10);
      break;
    }
    case 'school': {
      hall(b, out, -16, -16, 26, 18, 8.5, '#f2c14e');
      hall(b, out, 18, -16, 22, 18, 8.5, '#f2c14e');
      windowGrid(b, -16, -6.95, 22, 2, 0.4, 6);
      windowGrid(b, 18, -6.95, 18, 2, 0.4, 5);
      b.add('box', 1, 4, -22, 12, 8, 6, '#ef8a6f');
      out.colliders.push({ x: 1, z: -22, hx: 6, hz: 3, h: 8 });
      out.signs.push({ text: '🏫 SUNRISE SCHOOL', x: -16, y: 7, z: -6.9, w: 14, h: 1.8, bg: '#1d2b36', fg: '#f2c14e' });
      // courtyard + low fence
      b.add('box', 1, 0.03, -2, 30, 0.05, 10, '#d8e9c4');
      for (let i = -12; i <= 12; i++) {
        if (Math.abs(i) < 3) continue;
        b.add('box', i * 1.6, 0.5, 2.2, 0.1, 1, 0.1, '#fbf6ea');
      }
      b.add('box', 0, 0.9, 2.2, 40, 0.1, 0.08, '#fbf6ea');
      tree(b, -8, -2, 0.9);
      tree(b, 10, -1, 0.9);
      break;
    }
    case 'station': {
      hall(b, out, 0, -16, 52, 24, 10, '#c9c6f0');
      b.add('rbox', 0, 6, 1.5, 56, 0.8, 9, '#7a7fd6');
      for (let i = -3; i <= 3; i++) b.add('box', i * 8.6, 3, 5, 0.4, 6, 0.4, '#fbf6ea');
      b.add('quad', 0, 3, -3.95, 40, 4.6, 1, GLASS);
      out.signs.push({ text: '🚉 TRANSIT STATION', x: 0, y: 8.4, z: -3.9, w: 20, h: 2.4, bg: '#3c4396', fg: '#ffffff' });
      b.add('box', 0, 13, -16, 10, 6, 10, '#7a7fd6');
      b.add('cyl', 0, 13.5, -10.9, 2.2, 0.3, 2.2, '#fbf6ea', 0, Math.PI / 2);
      for (let i = 0; i < 3; i++) b.add('rbox', -15 + i * 15, 0.45, 2.5, 3, 0.25, 0.7, '#c98a4b');
      break;
    }
    case 'airport': {
      hall(b, out, 0, -20, w - 10, 30, 13, '#eef4f8');
      b.add('quad', 0, 6.5, -4.95, w - 16, 11, 1, '#5b82ab');
      for (let i = 0; i < 12; i++) b.add('box', -(w - 16) / 2 + i * ((w - 16) / 11), 6.5, -4.9, 0.3, 11, 0.12, TRIM);
      b.add('rbox', 0, 13.5, 0, w - 4, 0.8, 12, '#3fb6c8');
      for (let i = -4; i <= 4; i++) b.add('cyl', i * 12, 6.6, 4.5, 0.35, 13, 0.35, '#fbf6ea');
      out.signs.push({ text: '✈ AIRPORT', x: 0, y: 15.4, z: 6.1, w: 18, h: 3, bg: '#1d3557', fg: '#ffffff' });
      // control tower
      b.add('cyl', w / 2 - 14, 14, -26, 2.4, 28, 2.4, '#eef4f8');
      b.add('cyl', w / 2 - 14, 29, -26, 4.2, 3.2, 4.2, '#4d6f93');
      b.add('cyl', w / 2 - 14, 31, -26, 4.6, 0.8, 4.6, '#fbf6ea');
      out.colliders.push({ x: w / 2 - 14, z: -26, hx: 2.6, hz: 2.6, h: 30 });
      for (let i = 0; i < 5; i++) out.props.push({ kind: 'luggage', x: -20 + i * 3.2, z: 2.5, ry: 0 });
      break;
    }
    case 'petrol_west':
    case 'petrol_south': {
      hall(b, out, 0, -27, 30, 10, 5, '#f6efe2');
      b.add('quad', 0, 2, -21.95, 20, 3, 1, GLASS);
      b.add('box', 0, 5.8, -7, w - 4, 0.8, 24, '#ef7b4f');
      b.add('box', 0, 5.2, -7, w - 5, 0.3, 23, '#fbf6ea');
      for (const x of [-w / 2 + 5, w / 2 - 5]) for (const z of [-16, 2]) {
        b.add('box', x, 2.6, z, 0.5, 5.2, 0.5, '#fbf6ea');
        out.colliders.push({ x, z, hx: 0.3, hz: 0.3, h: 5.2 });
      }
      for (const x of [-12, 0, 12]) {
        b.add('box', x, 0.12, -6, 3, 0.24, 5, '#c7c5bd');
        b.add('rbox', x, 1.1, -6, 1, 2, 0.8, '#ef7b4f');
        b.add('quad', x, 1.6, -5.58, 0.65, 0.4, 1, '#14212b');
        b.add('box', x + 0.6, 0.95, -6, 0.12, 1.4, 0.15, '#14212b');
        out.colliders.push({ x, z: -6, hx: 0.65, hz: 0.55, h: 2 });
      }
      out.signs.push({ text: '⛽ PETROL · FREE REFILL', x: 0, y: 6, z: 5.1, w: w - 8, h: 1.5, bg: '#ef7b4f', fg: '#ffffff' });
      out.signs.push({ text: 'STOP AT THE CURB PUMP', x: 0, y: 3, z: -21.9, w: 21, h: 1.2, bg: '#14212b', fg: '#ffffff' });
      break;
    }
    case 'hotel': {
      hall(b, out, 0, -18, 34, 22, 34, '#d9c7ec');
      for (let f = 0; f < 10; f++) windowGrid(b, 0, -6.95, 30, 1, 0.6 + f * 3.1, 8);
      b.add('rbox', 0, 5, 3, 16, 0.8, 9, '#b48ad6');
      for (const x of [-7, 7]) for (const z of [0, 6.5]) b.add('cyl', x, 2.5, z, 0.4, 5, 0.4, '#fbf6ea');
      b.add('box', 0, 0.04, 3, 18, 0.06, 10, '#c9302c');
      out.signs.push({ text: 'GRAND HOTEL', x: 0, y: 31, z: -6.8, w: 16, h: 2.6, bg: '#5b3a82', fg: '#f4d58d' });
      out.signs.push({ text: '★★★★', x: 0, y: 6.1, z: 7.6, w: 8, h: 1.2, bg: '#b48ad6', fg: '#fff6c9' });
      tree(b, -12, 2, 0.8);
      tree(b, 12, 2, 0.8);
      break;
    }
    case 'bus_depot': {
      hall(b, out, -w / 2 + 14, -16, 24, 20, 7, '#f3ead2');
      b.add('rbox', 12, 6.5, -14, 64, 0.6, 26, '#16a597');
      for (let i = 0; i < 5; i++) for (const z of [-26, -2]) b.add('box', -16 + i * 14, 3.3, z, 0.5, 6.6, 0.5, '#fbf6ea');
      b.add('box', 12, 0.03, -14, 64, 0.04, 26, '#c9c2b2');
      for (let i = 0; i < 4; i++) out.props.push({ kind: 'bus', x: -8 + i * 13, z: -14, ry: 0, color: ['#16a597', '#2b8fd6', '#e0863a', '#16a597'][i] });
      out.signs.push({ text: '🚌 BUS DEPOT', x: -w / 2 + 14, y: 8.6, z: -5.9, w: 14, h: 2.4, bg: '#16a597', fg: '#ffffff' });
      break;
    }
    case 'homes_west':
    case 'homes_east': {
      const palette = id === 'homes_west' ? ['#f4b183', '#f6d77a', '#f7c6a3', '#ffd9a0'] : ['#e9b8d0', '#c7e3a5', '#9ad8c6', '#f6d77a'];
      const n = 4;
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + sw * (i + 0.5);
        const floors = 3 + ((i * 7) % 3);
        const h = floors * 3.1 + 0.6;
        const bw = sw - 3;
        b.add('box', x, h / 2, -9, bw, h, 14, palette[i]);
        for (let f = 0; f < floors; f++) {
          for (let c = 0; c < 3; c++) {
            const wx = x - bw / 2 + (bw / 3) * (c + 0.5);
            const wy = 0.4 + f * 3.1 + 1.7;
            b.add('quad', wx, wy, -1.97, 1.8, 1.9, 1, TRIM);
            b.add('quad', wx, wy, -1.95, 1.5, 1.6, 1, GLASS);
            if (f > 0 && c !== 1) {
              b.add('box', wx, wy - 1.3, -1.35, 2.4, 0.28, 1.3, TRIM);
              b.add('box', wx, wy - 0.85, -0.75, 2.4, 0.7, 0.14, ['#ef7b4f', '#2fb5a3', '#e8a33d', '#d86a5c'][i]);
              if ((f + c + i) % 3 === 0) b.add('sphere', wx + 0.7, wy - 0.85, -1.1, 0.4, 0.32, 0.32, '#6cb84d');
            }
          }
        }
        b.add('box', x, h + 0.25, -9, bw + 0.3, 0.5, 14.3, TRIM);
        b.add('rbox', x, 2.7, -1.2, 3, 0.2, 1.6, ['#ef7b4f', '#2fb5a3', '#e8a33d', '#d86a5c'][i]);
        out.colliders.push({ x, z: -9, hx: bw / 2, hz: 7, h });
        if (i < n - 1) tree(b, x + sw / 2, -0.5, 0.75);
      }
      out.signs.push({ text: id === 'homes_west' ? 'HOMES WEST' : 'HOMES EAST', x: -w / 2 + 6, y: 1.1, z: 1.2, w: 7, h: 1.2, bg: '#1d2b36', fg: '#ffffff' });
      b.add('box', -w / 2 + 6, 0.5, 1.2, 7.2, 1, 0.3, '#1d2b36');
      break;
    }
  }
  void range;
  return out;
}

/** Landmark frontage widths (meters along the main side). */
export const LANDMARK_WIDTH: Record<LandmarkId, number> = {
  garage: 52,
  homes_west: 72,
  cafe_corner: 30,
  central_park: 40,
  office_plaza: 76,
  city_mall: 104,
  restaurant_row: 90,
  hospital: 60,
  school: 64,
  station: 64,
  airport: 110,
  homes_east: 72,
  hotel: 46,
  bus_depot: 100,
  petrol_west: 48,
  petrol_south: 48,
};
