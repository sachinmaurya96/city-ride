import { expect, test, type Page } from '@playwright/test';
import { boot, play, waitStage } from './helpers';
import type { runtime } from '../../src/game/core/runtime';
import type { rides, rideVisual } from '../../src/game/missions/rides';
import type { fuel } from '../../src/game/vehicles/fuel';
import type { useGame } from '../../src/app/store';
import type { debug } from '../../src/app/devHooks';
import type * as cityMap from '../../src/game/data/cityMap';
import type { input } from '../../src/game/input/input';
import type { audio } from '../../src/game/audio/audio';
import type * as THREE from 'three';

type GameDebug = { nav: typeof import('../../src/game/missions/rides').nav; autopilot: { start(speed?: number): void; stop(): void }; vehicles: typeof import('../../src/game/data/vehicles').VEHICLES; loadImportedModel: typeof import('../../src/game/render/importedVehicles').loadImportedModel; quoteRide: typeof import('../../src/game/progression/progression').quoteRide; vehicleEntry: typeof import('../../src/game/vehicles/entry').vehicleEntry; traffic: typeof import('../../src/game/traffic/traffic').traffic; runtime: typeof runtime; rides: typeof rides; rideVisual: typeof rideVisual; fuel: typeof fuel; store: typeof useGame; cityMap: typeof cityMap; debug: typeof debug; input: typeof input; audio: typeof audio; pauseManager: typeof import('../../src/game/core/pause').pauseManager; events: typeof import('../../src/game/core/events').events; audioLab: { renderEngine(id: string, seconds: number, keys: { t: number; throttle: number; brake: number }[]): Promise<{ wav: string; log: { t: number; rpm: number; gear: number; stage: string; speed: number }[]; effects: { engage: number; pops: number; shifts: number } }> } };
declare global { interface Window { __cr: GameDebug } }
test.setTimeout(120000);

async function stopAt(page: Page, bayId: string) {
  await page.evaluate((id) => {
    const c = window.__cr;
    const bay = c.cityMap.BAY_BY_ID.get(id)!;
    c.input.reset();
    c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading });
  }, bayId);
}

async function visiblePassengers(page: Page, name: string) {
  return page.evaluate((n) => {
    const scene = window.__cr.debug.extra.scene as THREE.Scene;
    const people: { x: number; z: number; geometry: string }[] = [];
    scene.traverse((o) => { if (o.name === n && o.visible) people.push({ x: o.position.x, z: o.position.z, geometry: (o as THREE.Mesh).geometry.uuid }); });
    return people;
  }, name);
}

test('passenger visibly boards, rides and walks away from the original dropoff', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, { clear: true });
  await page.evaluate(() => window.__cr.store.getState().updateSettings({ passengerCharacter: 'original' }));
  await play(page);
  await waitStage(page, ['OFFERED'], 60000);
  await page.getByTestId('accept').click();
  await expect.poll(async () => (await visiblePassengers(page, 'ride-passenger-walker')).length).toBe(1);
  const pickup = await page.evaluate(() => window.__cr.rides.mission!.pickupBayId);
  const waitingPassenger = (await visiblePassengers(page, 'ride-passenger-walker'))[0];
  await stopAt(page, pickup);
  await waitStage(page, ['BOARDING']);
  const before = await visiblePassengers(page, 'ride-passenger-walker');
  await expect.poll(async () => {
    const p = await visiblePassengers(page, 'ride-passenger-walker');
    return p.length && Math.hypot(p[0].x - before[0].x, p[0].z - before[0].z);
  }, { intervals: [100] }).toBeGreaterThan(0.2);
  await page.screenshot({ path: 'test-results/passenger-boarding.png' });
  await waitStage(page, ['TO_DROPOFF']);
  await expect.poll(async () => (await visiblePassengers(page, 'ride-passenger-seated')).length).toBe(1);
  const drop = await page.evaluate(() => {
    const mission = { ...window.__cr.rides.mission!, dropBayId: 'airport_bay2', state: 'TO_DROPOFF' as const };
    window.__cr.rides.restore(mission);
    return mission.dropBayId;
  });
  await stopAt(page, drop);
  await waitStage(page, ['ALIGHTING']);
  await expect.poll(async () => (await visiblePassengers(page, 'ride-passenger-walker')).length, { intervals: [100] }).toBe(1);
  expect((await visiblePassengers(page, 'ride-passenger-walker'))[0].geometry).toBe(waitingPassenger.geometry);
  await page.screenshot({ path: 'test-results/passenger-alighting.png' });
  await page.evaluate(() => {
    const bay = window.__cr.cityMap.BAY_BY_ID.get('airport_bay2')!;
    window.__cr.debug.cam = { x: bay.x - 25, y: 16, z: bay.z + 32, tx: 335, ty: 5, tz: -360 };
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: 'test-results/airport.png' });
  await page.evaluate(() => { window.__cr.debug.cam = null; });
  await waitStage(page, ['COMPLETED']);
  await page.getByTestId('next-ride').click();
  const oldPosition = await visiblePassengers(page, 'ride-passenger-walker');
  await stopAt(page, 'garage_bay1');
  await expect.poll(async () => {
    const p = await visiblePassengers(page, 'ride-passenger-walker');
    return p.length && Math.hypot(p[0].x - oldPosition[0].x, p[0].z - oldPosition[0].z);
  }, { intervals: [100] }).toBeGreaterThan(0.2);
  const after = await visiblePassengers(page, 'ride-passenger-walker');
  expect(Math.hypot(after[0].x - oldPosition[0].x, after[0].z - oldPosition[0].z)).toBeLessThan(15);
  expect(errors).toEqual([]);
});

test('fuel drains while driving, fills for ₹60 only at a pump, survives reload and offers help when empty', async ({ page }) => {
  await boot(page, { clear: true });
  await play(page);
  await expect(page.getByRole('progressbar', { name: 'Fuel' })).toBeVisible();
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => window.__cr.fuel.percent), { timeout: 30000, intervals: [250] }).toBeLessThan(99.9);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    const st = window.__cr.store.getState();
    st.commit({ ...st.save, wallet: 5000, revision: st.save.revision + 1, updatedAt: Date.now() }, true);
    window.__cr.fuel.tank.percent = 30;
  });
  await stopAt(page, 'petrol_south_bay1');
  const dialog = page.getByTestId('fuel-station');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__cr.fuel.percent)).toBeLessThan(31);
  await expect(dialog).toContainText('Full tank: ₹60');
  await expect(dialog.getByTestId('fuel-quote')).toContainText('Full tank · 100%');
  await page.screenshot({ path: 'test-results/fuel-station.png' });
  await dialog.getByTestId('fuel-cancel').click();
  expect(await page.evaluate(() => window.__cr.fuel.percent)).toBeLessThan(31);
  await page.getByTestId('open-fuel').click();
  await dialog.getByTestId('fuel-confirm').click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__cr.fuel.percent)).toBe(100);
  expect(await page.evaluate(() => window.__cr.store.getState().save.wallet)).toBe(4940);
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.evaluate(() => { window.__cr.fuel.tank.percent = 31; window.__cr.fuel.persist(); });
  await boot(page);
  await play(page);
  await expect.poll(() => page.evaluate(() => window.__cr.fuel.percent)).toBe(31);
  await page.evaluate(() => { window.__cr.fuel.tank.percent = 0; });
  await expect(page.getByTestId('fuel-gauge')).toContainText('Tank empty');
  const heldAt = await page.evaluate(() => window.__cr.runtime.simTime);
  await page.keyboard.down('KeyS');
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.simTime)).toBeGreaterThan(heldAt + 0.65);
  await page.keyboard.up('KeyS');
  expect(await page.evaluate(() => Math.abs(window.__cr.runtime.telemetry.speed))).toBeLessThan(0.3);
  await page.getByTestId('navigate-fuel').click();
  await expect(page.getByTestId('instruction')).toContainText(/Petrol/);
  await page.getByTestId('tow-fuel').click();
  // The tow arrives refueled (an empty tank would lock the throttle) and is charged like a normal fill.
  await expect.poll(() => page.evaluate(() => window.__cr.fuel.percent)).toBe(100);
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__cr.store.getState().save.wallet)).toBe(4880);
});

test('horn sounds from both keyboard and button, including after audio is suspended', async ({ page }) => {
  await boot(page, { clear: true });
  await play(page);
  await page.keyboard.press('KeyH');
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.hornUntil - window.__cr.runtime.simTime), { intervals: [50] }).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const engine = window.__cr.audio as unknown as { ctx: AudioContext };
    await engine.ctx.suspend();
  });
  await page.getByRole('button', { name: 'Horn', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.hornUntil - window.__cr.runtime.simTime), { intervals: [50] }).toBeGreaterThan(0);
  await page.evaluate(() => window.__cr.store.getState().updateSettings({ muted: true }));
  const lastHorn = await page.evaluate(() => window.__cr.runtime.hornUntil);
  await page.keyboard.press('KeyH');
  expect(await page.evaluate(() => window.__cr.runtime.hornUntil)).toBe(lastHorn);
});

test.describe('touch controls', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('the fuel bar and speed readout leave the joystick and utility buttons clear', async ({ page }) => {
    await boot(page, { clear: true });
    await play(page);
    await page.getByTestId('gesture-layer').tap({ position: { x: 400, y: 190 } });
    await expect(page.locator('.app')).toHaveClass(/touch-mode/);
    await page.evaluate(() => { window.__cr.fuel.tank.percent = 10; });
    await expect(page.getByTestId('fuel-gauge')).toContainText('Low fuel');
    const fuelBox = (await page.getByTestId('fuel-gauge').boundingBox())!;
    const speedBox = (await page.getByTestId('speed').boundingBox())!;
    await page.screenshot({ path: 'test-results/mobile-fuel.png' });
    const controls = await page.locator('.joy-home, .util-buttons .util').all();
    for (const control of controls) {
      const b = (await control.boundingBox())!;
      for (const a of [fuelBox, speedBox]) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, JSON.stringify({ readout: a, control: b })).toBe(true);
    }
  });
});
