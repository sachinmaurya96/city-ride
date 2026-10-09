import * as THREE from 'three';

// Named storefront banners and street-name boards. All artwork is drawn procedurally into ONE canvas
// atlas (no image files, no emoji fonts) and rendered as a single merged mesh.

export type ShopIcon = 'cup' | 'fork' | 'pizza' | 'bread' | 'cross' | 'book' | 'flower' | 'cone' | 'cart' | 'scissors' | 'dumbbell' | 'bank' | 'burger' | 'bowl' | 'wrench' | 'gift' | 'shirt' | 'juice' | 'phone' | 'cake';

export interface ShopDef {
  name: string;
  tag: string;
  icon: ShopIcon;
  bg: string;
  fg: string;
  /** Café/restaurant style: gets outdoor tables with guests. */
  seating: boolean;
  /** Awning stripe colour. */
  awning: string;
}

export const SHOPS: ShopDef[] = [
  { name: 'Sunny Café', tag: 'COFFEE & CAKE', icon: 'cup', bg: '#ef7b4f', fg: '#fff6e8', seating: true, awning: '#ef7b4f' },
  { name: 'Chai Point', tag: 'TEA HOUSE', icon: 'cup', bg: '#2fb5a3', fg: '#ffffff', seating: true, awning: '#2fb5a3' },
  { name: 'Spice Route', tag: 'RESTAURANT', icon: 'fork', bg: '#d0503f', fg: '#fff3d6', seating: true, awning: '#d86a5c' },
  { name: 'Pizza Corner', tag: 'WOOD FIRED', icon: 'pizza', bg: '#e8a33d', fg: '#ffffff', seating: true, awning: '#e8a33d' },
  { name: 'Golden Bakery', tag: 'FRESH BREAD', icon: 'bread', bg: '#f2c14e', fg: '#6b3f1f', seating: false, awning: '#f2c14e' },
  { name: 'City Pharmacy', tag: 'OPEN 24/7', icon: 'cross', bg: '#2f9e6b', fg: '#ffffff', seating: false, awning: '#3cb371' },
  { name: 'Book Nook', tag: 'BOOKS & GIFTS', icon: 'book', bg: '#4f7fd0', fg: '#ffffff', seating: false, awning: '#4f8fd6' },
  { name: 'Bloom Florist', tag: 'FLOWERS', icon: 'flower', bg: '#e98fb4', fg: '#ffffff', seating: false, awning: '#e98fb4' },
  { name: 'Scoops', tag: 'ICE CREAM', icon: 'cone', bg: '#8fd3c3', fg: '#1d3557', seating: true, awning: '#9ad8c6' },
  { name: 'Fresh Mart', tag: 'GROCERY', icon: 'cart', bg: '#6ea85a', fg: '#ffffff', seating: false, awning: '#7fb069' },
  { name: 'Style Barber', tag: 'HAIR & BEARD', icon: 'scissors', bg: '#1d2b36', fg: '#f2c14e', seating: false, awning: '#3a4048' },
  { name: 'Fit Gym', tag: 'FITNESS', icon: 'dumbbell', bg: '#5b6fd5', fg: '#ffffff', seating: false, awning: '#5b7bd5' },
  { name: 'City Bank', tag: 'ATM INSIDE', icon: 'bank', bg: '#2b5fa0', fg: '#ffffff', seating: false, awning: '#2b6cb0' },
  { name: 'Burger Barn', tag: 'BURGERS & FRIES', icon: 'burger', bg: '#d9534f', fg: '#ffe9a8', seating: true, awning: '#e2685c' },
  { name: 'Noodle House', tag: 'ASIAN KITCHEN', icon: 'bowl', bg: '#b8392e', fg: '#ffffff', seating: true, awning: '#c0392b' },
  { name: 'Bike Repair', tag: 'SERVICE', icon: 'wrench', bg: '#3a4048', fg: '#f4b544', seating: false, awning: '#f4b544' },
  { name: 'Toy Town', tag: 'TOYS & GAMES', icon: 'gift', bg: '#9b7fd6', fg: '#ffffff', seating: false, awning: '#9b7fd6' },
  { name: 'Fashion Hub', tag: 'CLOTHING', icon: 'shirt', bg: '#d98fb4', fg: '#ffffff', seating: false, awning: '#d98fb4' },
  { name: 'Juice Bar', tag: 'FRESH JUICE', icon: 'juice', bg: '#f39c5a', fg: '#ffffff', seating: true, awning: '#f39c5a' },
  { name: 'Mobile Zone', tag: 'PHONES', icon: 'phone', bg: '#16a597', fg: '#ffffff', seating: false, awning: '#16a597' },
  { name: 'Sweet Treats', tag: 'DESSERTS', icon: 'cake', bg: '#f7a1c4', fg: '#7a2e4a', seating: true, awning: '#f7a1c4' },
  { name: 'Dosa Diner', tag: 'SOUTH INDIAN', icon: 'fork', bg: '#f4b544', fg: '#7a3b12', seating: true, awning: '#f4b544' },
];

const FOOD = SHOPS.map((s, i) => (s.seating ? i : -1)).filter((i) => i >= 0);
const RETAIL = SHOPS.map((s, i) => (s.seating ? -1 : i)).filter((i) => i >= 0);

/** Pick a shop for a district (food-heavy near the café corner and restaurant row). */
export function pickShop(rng: () => number, district: string, foodBias = 0.45) {
  const food = rng() < (district === 'commercial' ? foodBias + 0.15 : foodBias);
  const list = food ? FOOD : RETAIL;
  return list[Math.floor(rng() * list.length) % list.length];
}

// ---------------- atlas ----------------

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 8;
const SLOT_W = 512;
const SLOT_H = 128;

/** Atlas slot index for street-name boards: after the shops. */
export function streetSlot(nameIndex: number) {
  return SHOPS.length + nameIndex;
}

export function slotUV(slot: number): [number, number, number, number] {
  const c = slot % ATLAS_COLS;
  const r = Math.floor(slot / ATLAS_COLS);
  const pad = 2 / (SLOT_W * ATLAS_COLS);
  const padV = 2 / (SLOT_H * ATLAS_ROWS);
  const u0 = c / ATLAS_COLS + pad;
  const u1 = (c + 1) / ATLAS_COLS - pad;
  const v1 = 1 - r / ATLAS_ROWS - padV;
  const v0 = 1 - (r + 1) / ATLAS_ROWS + padV;
  return [u0, v0, u1, v1];
}

function drawIcon(c: CanvasRenderingContext2D, icon: ShopIcon, x: number, y: number, s: number, col: string) {
  c.save();
  c.translate(x, y);
  c.scale(s / 100, s / 100);
  c.fillStyle = col;
  c.strokeStyle = col;
  c.lineWidth = 9;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const rr = (x0: number, y0: number, w: number, h: number, r: number) => {
    c.beginPath();
    c.roundRect(x0, y0, w, h, r);
    c.fill();
  };
  const circle = (cx: number, cy: number, r: number, fill = true) => {
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) c.fill();
    else c.stroke();
  };
  switch (icon) {
    case 'cup':
      rr(-30, -10, 48, 42, 10);
      c.beginPath();
      c.arc(22, 10, 12, -Math.PI / 2, Math.PI / 2);
      c.stroke();
      rr(-38, 34, 66, 7, 3);
      for (const dx of [-16, 0]) {
        c.beginPath();
        c.moveTo(dx - 3, -22);
        c.quadraticCurveTo(dx + 6, -30, dx - 2, -40);
        c.stroke();
      }
      break;
    case 'fork':
      c.beginPath();
      c.moveTo(-18, -40);
      c.lineTo(-18, 40);
      c.stroke();
      for (const dx of [-28, -18, -8]) {
        c.beginPath();
        c.moveTo(dx, -40);
        c.lineTo(dx, -14);
        c.stroke();
      }
      c.beginPath();
      c.moveTo(-28, -14);
      c.lineTo(-8, -14);
      c.stroke();
      c.beginPath();
      c.moveTo(20, 40);
      c.lineTo(20, -40);
      c.quadraticCurveTo(38, -20, 30, 0);
      c.lineTo(20, 0);
      c.fill();
      c.stroke();
      break;
    case 'pizza':
      c.beginPath();
      c.moveTo(0, 40);
      c.lineTo(-36, -30);
      c.quadraticCurveTo(0, -46, 36, -30);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.25)';
      circle(-8, -14, 7);
      circle(10, -20, 6);
      circle(2, 8, 6);
      break;
    case 'bread':
      c.beginPath();
      c.ellipse(0, 4, 42, 26, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.lineWidth = 6;
      for (const dx of [-18, 0, 18]) {
        c.beginPath();
        c.moveTo(dx - 6, -10);
        c.lineTo(dx + 6, 16);
        c.stroke();
      }
      break;
    case 'cross':
      rr(-12, -38, 24, 76, 6);
      rr(-38, -12, 76, 24, 6);
      break;
    case 'book':
      rr(-40, -30, 38, 62, 6);
      rr(2, -30, 38, 62, 6);
      break;
    case 'flower':
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        circle(Math.cos(a) * 18, -10 + Math.sin(a) * 18, 13);
      }
      c.beginPath();
      c.moveTo(0, 8);
      c.lineTo(0, 42);
      c.stroke();
      break;
    case 'cone':
      circle(-10, -22, 18);
      circle(12, -22, 18);
      c.beginPath();
      c.moveTo(-24, -8);
      c.lineTo(24, -8);
      c.lineTo(0, 42);
      c.closePath();
      c.fill();
      break;
    case 'cart':
      c.beginPath();
      c.moveTo(-44, -30);
      c.lineTo(-30, -30);
      c.lineTo(-20, 16);
      c.lineTo(32, 16);
      c.lineTo(40, -18);
      c.lineTo(-26, -18);
      c.stroke();
      circle(-14, 32, 8);
      circle(26, 32, 8);
      break;
    case 'scissors':
      circle(-22, 24, 13, false);
      circle(22, 24, 13, false);
      c.beginPath();
      c.moveTo(-14, 14);
      c.lineTo(22, -40);
      c.moveTo(14, 14);
      c.lineTo(-22, -40);
      c.stroke();
      break;
    case 'dumbbell':
      rr(-44, -22, 14, 44, 4);
      rr(30, -22, 14, 44, 4);
      rr(-32, -14, 10, 28, 3);
      rr(22, -14, 10, 28, 3);
      rr(-24, -5, 48, 10, 3);
      break;
    case 'bank':
      c.beginPath();
      c.moveTo(-44, -16);
      c.lineTo(0, -42);
      c.lineTo(44, -16);
      c.closePath();
      c.fill();
      for (const dx of [-30, -10, 10, 30]) rr(dx - 5, -12, 10, 42, 2);
      rr(-46, 32, 92, 9, 3);
      break;
    case 'burger':
      c.beginPath();
      c.ellipse(0, -14, 40, 22, 0, Math.PI, 0);
      c.fill();
      rr(-42, -8, 84, 8, 4);
      rr(-40, 6, 80, 10, 5);
      rr(-38, 22, 76, 12, 6);
      break;
    case 'bowl':
      c.beginPath();
      c.arc(0, 0, 40, 0, Math.PI);
      c.closePath();
      c.fill();
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(10, -6);
      c.lineTo(36, -44);
      c.moveTo(22, -6);
      c.lineTo(44, -38);
      c.stroke();
      break;
    case 'wrench':
      c.lineWidth = 14;
      c.beginPath();
      c.moveTo(-30, 32);
      c.lineTo(14, -12);
      c.stroke();
      circle(22, -22, 18);
      c.globalCompositeOperation = 'destination-out';
      rr(18, -44, 12, 24, 3);
      c.globalCompositeOperation = 'source-over';
      break;
    case 'gift':
      rr(-36, -10, 72, 48, 6);
      rr(-40, -24, 80, 16, 5);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      rr(-5, -24, 10, 62, 2);
      c.strokeStyle = col;
      c.beginPath();
      c.ellipse(-12, -32, 12, 8, 0, 0, Math.PI * 2);
      c.ellipse(12, -32, 12, 8, 0, 0, Math.PI * 2);
      c.stroke();
      break;
    case 'shirt':
      c.beginPath();
      c.moveTo(-16, -38);
      c.lineTo(-44, -20);
      c.lineTo(-32, 0);
      c.lineTo(-24, -6);
      c.lineTo(-24, 40);
      c.lineTo(24, 40);
      c.lineTo(24, -6);
      c.lineTo(32, 0);
      c.lineTo(44, -20);
      c.lineTo(16, -38);
      c.quadraticCurveTo(0, -24, -16, -38);
      c.fill();
      break;
    case 'juice':
      c.beginPath();
      c.moveTo(-26, -24);
      c.lineTo(26, -24);
      c.lineTo(18, 40);
      c.lineTo(-18, 40);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(6, -24);
      c.lineTo(20, -46);
      c.stroke();
      circle(-22, -26, 9);
      break;
    case 'phone':
      rr(-24, -42, 48, 84, 10);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      rr(-17, -32, 34, 56, 4);
      break;
    case 'cake':
      rr(-36, -6, 72, 44, 6);
      rr(-28, -26, 56, 22, 6);
      c.beginPath();
      c.moveTo(0, -28);
      c.lineTo(0, -42);
      c.stroke();
      circle(0, -46, 5);
      break;
  }
  c.restore();
}

function fitText(c: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 800) {
  let s = size;
  c.font = `${weight} ${s}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  while (c.measureText(text).width > maxW && s > 16) {
    s -= 2;
    c.font = `${weight} ${s}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  }
  return s;
}

/** Draw all shop banners and street boards into one atlas texture. */
export function buildSignAtlas(streetNames: string[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SLOT_W * ATLAS_COLS;
  canvas.height = SLOT_H * ATLAS_ROWS;
  const c = canvas.getContext('2d')!;
  c.textBaseline = 'middle';
  SHOPS.forEach((s, i) => {
    const x = (i % ATLAS_COLS) * SLOT_W;
    const y = Math.floor(i / ATLAS_COLS) * SLOT_H;
    c.fillStyle = s.bg;
    c.beginPath();
    c.roundRect(x + 2, y + 2, SLOT_W - 4, SLOT_H - 4, 26);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(x + 9, y + 9, SLOT_W - 18, SLOT_H - 18, 20);
    c.stroke();
    // icon medallion
    c.fillStyle = s.fg;
    c.beginPath();
    c.arc(x + 66, y + SLOT_H / 2, 44, 0, Math.PI * 2);
    c.fill();
    drawIcon(c, s.icon, x + 66, y + SLOT_H / 2, 62, s.bg);
    // name + tag
    c.fillStyle = s.fg;
    c.textAlign = 'left';
    fitText(c, s.name, SLOT_W - 140, 52);
    c.fillText(s.name, x + 124, y + 52);
    fitText(c, s.tag, SLOT_W - 140, 22, 700);
    c.globalAlpha = 0.85;
    c.fillText(s.tag, x + 126, y + 94);
    c.globalAlpha = 1;
  });
  streetNames.forEach((n, k) => {
    const i = streetSlot(k);
    const x = (i % ATLAS_COLS) * SLOT_W;
    const y = Math.floor(i / ATLAS_COLS) * SLOT_H;
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.roundRect(x + 2, y + 2, SLOT_W - 4, SLOT_H - 4, 16);
    c.fill();
    c.fillStyle = '#2f7d5b';
    c.beginPath();
    c.roundRect(x + 10, y + 10, SLOT_W - 20, SLOT_H - 20, 10);
    c.fill();
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    fitText(c, n, SLOT_W - 60, 62);
    c.fillText(n, x + SLOT_W / 2, y + SLOT_H / 2 + 3);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export interface BoardDef {
  slot: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  w: number;
  h: number;
  /** Street boards are readable from both sides. */
  double: boolean;
}

/** One merged textured geometry for every board (position, normal, uv). */
export function buildBoardGeometry(boards: BoardDef[]) {
  const quads = boards.reduce((a, b) => a + (b.double ? 2 : 1), 0);
  const pos = new Float32Array(quads * 6 * 3);
  const nor = new Float32Array(quads * 6 * 3);
  const uv = new Float32Array(quads * 6 * 2);
  let o = 0;
  const push = (b: BoardDef, back: boolean) => {
    const c = Math.cos(b.ry);
    const s = Math.sin(b.ry);
    // local +X = right when looking at the board's face (+Z normal)
    const sign = back ? -1 : 1;
    const rx = c * sign;
    const rz = -s * sign;
    const nx = s * sign;
    const nz = c * sign;
    const off = back ? -0.012 : 0.012;
    const [u0, v0, u1, v1] = slotUV(b.slot);
    const corners: [number, number, number, number][] = [
      [-1, -1, u0, v0],
      [1, -1, u1, v0],
      [1, 1, u1, v1],
      [-1, -1, u0, v0],
      [1, 1, u1, v1],
      [-1, 1, u0, v1],
    ];
    for (const [ax, ay, u, v] of corners) {
      pos[o * 3] = b.x + rx * ax * (b.w / 2) + nx * off;
      pos[o * 3 + 1] = b.y + ay * (b.h / 2);
      pos[o * 3 + 2] = b.z + rz * ax * (b.w / 2) + nz * off;
      nor[o * 3] = nx;
      nor[o * 3 + 1] = 0;
      nor[o * 3 + 2] = nz;
      uv[o * 2] = u;
      uv[o * 2 + 1] = v;
      o++;
    }
  };
  for (const b of boards) {
    push(b, false);
    if (b.double) push(b, true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
