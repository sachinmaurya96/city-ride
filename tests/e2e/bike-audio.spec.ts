import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { boot } from './helpers';

// Renders each superbike's real engine voice offline through a scripted ride and checks the sequence:
// starter → fires → idle → first gear clunks in → pulls through the gears → overrun crackle → downshifts → stop.
const RIDE = [
  { t: 0, throttle: 0, brake: 0 },
  { t: 4, throttle: 1, brake: 0 },
  { t: 16, throttle: 0, brake: 0 },
  { t: 18, throttle: 0, brake: 1 },
  { t: 26.5, throttle: 0, brake: 0 },
  { t: 28.5, throttle: .5, brake: 0 },
  { t: 34, throttle: 0, brake: 0 },
];

for (const id of ['bike_basic', 'ducati_v4r']) {
  test(`${id}: bike-sound-2 follows the ride from ignition to stop`, async ({ page }) => {
    test.setTimeout(240000);
    await boot(page, { clear: true });
    const result = await page.evaluate(([id, ride]) => window.__cr.audioLab.renderEngine(id, 35, ride), [id, RIDE] as const);
    fs.mkdirSync('test-results/audio', { recursive: true });
    fs.writeFileSync(`test-results/audio/${id}.wav`, Buffer.from(result.wav, 'base64'));
    fs.writeFileSync(`test-results/audio/${id}.json`, JSON.stringify(result, (key, value) => key === 'wav' ? undefined : value, 1));
    const log = result.log, at = (t: number) => log.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
    // Cranking, then the recorded flare, then idle.
    expect(at(.5)).toMatchObject({ stage: 'start', rpm: 280 });
    expect(at(2).stage).toBe('start');
    expect(at(2).rpm).toBeGreaterThan(at(3.9).rpm);
    expect(at(3.9).stage).toBe('idle');
    // Pull-away: first gear clunks in, revs climb and fall at each upshift.
    expect(result.effects.engage).toBeGreaterThanOrEqual(1);
    expect(result.effects.shifts).toBeGreaterThanOrEqual(4);
    expect(Math.max(...log.filter(e => e.t < 16).map(e => e.gear))).toBeGreaterThanOrEqual(5);
    expect(at(4.6).rpm).toBeGreaterThan(at(3.9).rpm + 2000);
    const pull = log.filter(e => e.t > 4.2 && e.t < 16);
    const drops = pull.filter((e, i) => i > 0 && e.rpm < pull[i - 1].rpm - 800).length;
    expect(drops).toBeGreaterThanOrEqual(3);
    expect(pull.some(e => e.stage === 'peak')).toBe(true);
    // Lifting off at high revs crackles; braking to a stop comes back down through the gears to idle.
    expect(result.effects.pops).toBeGreaterThan(2);
    const braking = log.filter(e => e.t > 18 && e.t < 26.5);
    expect(braking.filter((e, i) => i > 0 && e.gear < braking[i - 1].gear).length).toBeGreaterThanOrEqual(4);
    expect(braking.every((e, i) => i === 0 || e.gear <= braking[i - 1].gear)).toBe(true);
    expect(at(28)).toMatchObject({ gear: 1, stage: 'idle', speed: 0 });
    // Gentle riding short-shifts early instead of screaming to the redline.
    const gentle = log.filter(e => e.t > 29 && e.t < 34);
    expect(Math.max(...gentle.map(e => e.rpm))).toBeLessThan(.8 * Math.max(...pull.map(e => e.rpm)));
    expect(Math.max(...gentle.map(e => e.gear))).toBeGreaterThanOrEqual(2);
  });
}
