import { describe, expect, it } from 'vitest';
import { SkidMarkPool } from '../src/game/render/skidMarkPool';

describe('temporary tire marks', () => {
  it('builds two tire-width ribbons, fades after 10 seconds and never joins across teleports', () => {
    const marks = new SkidMarkPool(4);
    for (const wheel of [2, 3]) {
      const x = wheel === 2 ? -.8 : .8;
      marks.sample(wheel, { x, y: .01, z: 0 }, 5, .28);
      marks.sample(wheel, { x, y: .01, z: .6 }, 5.2, .28);
    }
    expect(marks.activeCount(5.2)).toBe(2);
    expect(Math.abs(marks.positions[0] - marks.positions[3])).toBeCloseTo(.28, 5);
    expect(marks.activeCount(15.199)).toBe(2); expect(marks.activeCount(15.2)).toBe(0);
    const version = marks.version;
    marks.sample(2, { x: 200, y: .01, z: 200 }, 16, .28); expect(marks.version).toBe(version);
    marks.breakTrack(); marks.sample(2, { x: 0, y: .01, z: 0 }, 16.1, .28); expect(marks.version).toBe(version);
  });
  it('bounds memory during long drifting sessions', () => {
    const marks = new SkidMarkPool(4);
    for (let i = 0; i < 200; i++) marks.sample(2, { x: 0, y: 0, z: i * .3 }, i * .02, .28);
    expect(marks.positions.length).toBe(72); expect(marks.activeCount(4)).toBe(4);
    expect(marks.activeCount(15)).toBe(0);
  });
});
