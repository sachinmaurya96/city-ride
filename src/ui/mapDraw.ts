import { BLOCKS, CORNER_RADIUS, FUEL_STATIONS, LANDMARKS, ROAD_LINES, roadHalfWidth } from '../game/data/cityMap';
import type { Route } from '../game/navigation/roadGraph';

export interface MapView {
  /** world point at canvas center */
  cx: number;
  cz: number;
  /** pixels per meter */
  scale: number;
  /** rotation so that `rotation` heading points up (heading-up minimap); 0 = north-up */
  rotation: number;
  width: number;
  height: number;
}

export interface MapDrawOpts {
  route: Route | null;
  routeFrom: number;
  routeColor: string;
  target: { x: number; z: number; color: string; icon: string } | null;
  player: { x: number; z: number; heading: number };
  labels: boolean;
  extraMarkers?: { x: number; z: number; color: string; icon?: string }[];
}

/** Draw the city road graph (same data as the 3D world) onto a 2D canvas. */
export function drawMap(ctx: CanvasRenderingContext2D, v: MapView, o: MapDrawOpts) {
  const { width: w, height: h } = v;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#cfe9c0';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  // heading-up: rotate so the player's forward points up (-y canvas)
  ctx.rotate(v.rotation);
  ctx.scale(v.scale, v.scale);
  ctx.translate(-v.cx, -v.cz);
  // road surface
  ctx.fillStyle = '#7f8b9b';
  ctx.fillRect(-520, -520, 1040, 1040);
  // blocks
  for (const b of BLOCKS) {
    ctx.fillStyle = '#f3ead8';
    roundRect(ctx, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ, CORNER_RADIUS);
    ctx.fill();
    ctx.fillStyle = '#d8ecc4';
    roundRect(ctx, b.minX + 5, b.minZ + 5, b.maxX - b.minX - 10, b.maxZ - b.minZ - 10, CORNER_RADIUS - 4);
    ctx.fill();
  }
  // centre lines
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 8]);
  for (const r of ROAD_LINES) {
    ctx.beginPath();
    if (r.axis === 'x') {
      ctx.moveTo(-480, r.coord);
      ctx.lineTo(480, r.coord);
    } else {
      ctx.moveTo(r.coord, -480);
      ctx.lineTo(r.coord, 480);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  void roadHalfWidth;
  // landmarks
  for (const l of LANDMARKS) {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(l.x, l.z, 9 / Math.max(0.35, v.scale) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // route
  if (o.route && o.route.points.length > 1) {
    const r = o.route;
    ctx.strokeStyle = o.routeColor;
    ctx.lineWidth = Math.max(5, 4 / v.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < r.points.length; i++) {
      if (r.cumulative[i] < o.routeFrom - 6 && i < r.points.length - 1) continue;
      const [x, z] = r.points[i];
      if (!started) {
        ctx.moveTo(x, z);
        started = true;
      } else ctx.lineTo(x, z);
    }
    ctx.stroke();
  }
  ctx.restore();

  // markers drawn upright in screen space
  const toScreen = (x: number, z: number) => {
    const dx = (x - v.cx) * v.scale;
    const dz = (z - v.cz) * v.scale;
    const c = Math.cos(v.rotation);
    const s = Math.sin(v.rotation);
    return [w / 2 + dx * c - dz * s, h / 2 + dx * s + dz * c] as const;
  };
  if (o.labels) {
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const l of LANDMARKS) {
      const [sx, sy] = toScreen(l.x, l.z);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      const tw = ctx.measureText(l.name).width + 22;
      roundRect(ctx, sx - tw / 2, sy - 22, tw, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#14212b';
      ctx.fillText(`${l.icon} ${l.name}`, sx, sy - 9);
    }
  }
  ctx.font = '13px system-ui';
  ctx.textAlign = 'center';
  for (const station of FUEL_STATIONS) {
    const [sx, sy] = toScreen(station.x, station.z);
    ctx.fillText('⛽', sx, sy + 4);
  }
  for (const m of o.extraMarkers ?? []) {
    const [sx, sy] = toScreen(m.x, m.z);
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (o.target) {
    let [sx, sy] = toScreen(o.target.x, o.target.z);
    // clamp to the visible circle for the minimap
    const rx = sx - w / 2;
    const ry = sy - h / 2;
    const lim = Math.min(w, h) / 2 - 12;
    const d = Math.hypot(rx, ry);
    if (d > lim) {
      sx = w / 2 + (rx / d) * lim;
      sy = h / 2 + (ry / d) * lim;
    }
    ctx.fillStyle = o.target.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy - 6, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(o.target.icon, sx, sy - 2);
  }
  // player arrow
  const [px, py] = toScreen(o.player.x, o.player.z);
  ctx.save();
  ctx.translate(px, py);
  // world heading 0 = +Z (south = down on a north-up map)
  ctx.rotate(v.rotation - o.player.heading + Math.PI);
  ctx.fillStyle = '#13a89e';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(7, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(-7, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}
