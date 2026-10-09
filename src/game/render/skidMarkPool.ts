export const SKID_SECONDS = 10;
type Point = { x: number; y: number; z: number };

/** Fixed-size pool: two rear tire tracks, bounded memory, no marks across a recovery teleport. */
export class SkidMarkPool {
  readonly positions: Float32Array;
  readonly births: Float32Array;
  private times: Float64Array;
  private previous = new Map<number, Point>();
  private next = 0;
  version = 0;
  constructor(readonly capacity = 2048) {
    this.positions = new Float32Array(capacity * 18);
    this.births = new Float32Array(capacity * 6).fill(-1000);
    this.times = new Float64Array(capacity).fill(-Infinity);
  }
  breakTrack(wheel?: number) { if (wheel === undefined) this.previous.clear(); else this.previous.delete(wheel); }
  sample(wheel: number, point: Point, time: number, width: number) {
    const last = this.previous.get(wheel);
    if (!last) { this.previous.set(wheel, { ...point }); return; }
    const dx = point.x - last.x, dz = point.z - last.z, length = Math.hypot(dx, dz);
    if (length < .18) return;
    this.previous.set(wheel, { ...point });
    if (length > 4 || Math.abs(point.y - last.y) > .3) return;
    const nx = -dz / length * width / 2, nz = dx / length * width / 2;
    const a = [last.x + nx, last.y + .018, last.z + nz], b = [last.x - nx, last.y + .018, last.z - nz];
    const c = [point.x + nx, point.y + .018, point.z + nz], d = [point.x - nx, point.y + .018, point.z - nz];
    this.positions.set([...a, ...b, ...c, ...c, ...b, ...d], this.next * 18);
    this.births.fill(time, this.next * 6, this.next * 6 + 6); this.times[this.next] = time;
    this.next = (this.next + 1) % this.capacity; this.version++;
  }
  activeCount(now: number) { let count = 0; for (const time of this.times) if (now >= time && now - time < SKID_SECONDS) count++; return count; }
}
