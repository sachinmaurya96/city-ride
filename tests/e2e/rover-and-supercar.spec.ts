import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import { boot, fixture, play } from './helpers';

test.setTimeout(180000);
test.use({ viewport: { width: 844, height: 500 }, hasTouch: true });

test('default Rover drivers retain textures, walk outside, fit cars and save the selected gender', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await boot(page, { clear: true });
  expect(await page.evaluate(() => window.__cr.store.getState().save.settings.driver)).toBe('male');
  await fixture(page, { owned: ['bmw_i8', 'bike_basic'], equipped: 'bmw_i8' });
  await play(page);
  await expect.poll(() => page.evaluate(() => (window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('player-driver')?.userData.character), { timeout: 60000 }).toBe('male');
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('outside');
  for (const id of ['male', 'female'] as const) {
    if (id === 'female') {
      await page.evaluate(() => window.__cr.store.getState().openOverlay('settings'));
      await expect(page.getByTestId('driver-female')).toContainText('Female Rover');
      await page.getByTestId('driver-female').click();
      await page.getByTestId('settings').getByRole('button', { name: 'Close', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('player-driver')?.userData.character), { timeout: 60000 }).toBe('female');
    }
    const before = await page.evaluate(() => window.__cr.vehicleEntry.outside.z);
    await page.keyboard.down('KeyW');
    await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.outside.z)).toBeGreaterThan(before + .3);
    await page.keyboard.up('KeyW');
    const appearance = await page.evaluate(() => {
      const c = window.__cr, T = c.debug.extra.THREE as typeof THREE;
      const driver = (c.debug.extra.scene as THREE.Scene).getObjectByName('player-driver')!;
      let meshes = 0, textures = 0; driver.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) { meshes++; if ((m.material as THREE.MeshStandardMaterial).map) textures++; m.skeleton.update(); } });
      const bounds = new T.Box3().setFromObject(driver, true);
      const center = bounds.getCenter(new T.Vector3());
      const front = new T.Vector3(.9, .2, 3).applyQuaternion(driver.getWorldQuaternion(new T.Quaternion())).add(center);
      c.debug.cam = { x: front.x, y: front.y, z: front.z, tx: center.x, ty: center.y, tz: center.z };
      return { meshes, textures, height: bounds.max.y - bounds.min.y };
    });
    expect(appearance.meshes).toBeGreaterThan(20); expect(appearance.textures).toBeGreaterThan(10);
    expect(appearance.height).toBeGreaterThan(1.4); expect(appearance.height).toBeLessThan(1.9);
    await page.screenshot({ path: `test-results/${id}-rover-outside.png` });
    await page.evaluate(() => { window.__cr.debug.cam = null; });
  }
  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
  await page.screenshot({ path: 'test-results/female-rover-seated.png' });
  await page.reload(); await page.getByTestId('play').waitFor({ timeout: 90000 });
  expect(await page.evaluate(() => window.__cr.store.getState().save.settings.driver)).toBe('female');
  await fixture(page, { owned: ['bmw_i8', 'bike_basic', 'auto_city', 'bus_small'], equipped: 'bike_basic', xp: 100000 });
  await play(page);
  for (const id of ['bike_basic', 'auto_city', 'bus_small'] as const) {
    if (id !== 'bike_basic') await fixture(page, { equipped: id });
    await expect.poll(() => page.evaluate(() => window.__cr.runtime.vehicleId)).toBe(id);
    await expect.poll(() => page.evaluate(() => (window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('player-driver')?.userData.character), { timeout: 60000 }).toBe('female');
    // A loaded character is named before its first animation/IK frame runs.
    await expect.poll(() => page.evaluate(() => {
      const c = window.__cr, T = c.debug.extra.THREE as typeof THREE, scene = c.debug.extra.scene as THREE.Scene;
      const driver = scene.getObjectByName('player-driver')!;
      return Math.max(...['L', 'R'].map((side, i) => driver.getObjectByName(`avatar-hand${side}`)!.getWorldPosition(new T.Vector3()).distanceTo(scene.getObjectByName(`player-steering-grip-${i}`)!.getWorldPosition(new T.Vector3()))));
    }), { message: `${id} steering reach`, timeout: 30000 }).toBeLessThan(.12);
    await page.screenshot({ path: `test-results/female-rover-${id}.png` });
  }
  expect(errors).toEqual([]);
});

test('uploaded Supercar recording starts once and follows pickup, acceleration, peak speed and braking', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => performance.setResourceTimingBufferSize(4000));
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bmw_i8'], equipped: 'bmw_i8' }); await play(page);
  await expect.poll(() => page.evaluate(() => window.__cr.audio.recorded?.profile)).toBe('hybrid');
  await expect.poll(() => page.evaluate(() => window.__cr.audio.recorded?.status), { timeout: 60000 }).toBe('ready');
  await expect.poll(() => page.evaluate(() => window.__cr.audio.recorded?.stage), { timeout: 60000, intervals: [100] }).toBe('start');
  await expect.poll(() => page.evaluate(() => window.__cr.audio.recorded?.stage)).toBe('idle');
  const recording = await page.evaluate(async () => {
    const engine = window.__cr.audio.recorded! as unknown as { buffers: Map<string, Promise<AudioBuffer>>; sources: AudioBufferSourceNode[] };
    const buffer = await engine.buffers.get('supercar')!;
    return { duration: buffer.duration, clips: engine.sources.map(source => {
      const b = source.buffer!, data = b.getChannelData(0);
      return { duration: b.duration, rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length), seam: Math.abs(data[0] - data[data.length - 1]) };
    }) };
  });
  expect(recording.duration).toBeCloseTo(37.872, 2); expect(recording.clips).toHaveLength(4);
  for (const clip of recording.clips) { expect(clip.duration).toBeLessThan(1.5); expect(clip.rms).toBeGreaterThan(.12); expect(clip.seam).toBeLessThan(.04); }
  const starts = await page.evaluate(() => window.__cr.audio.recorded!.startCount);
  for (const [fraction, stage] of [[.2, 'pickup'], [.55, 'acceleration'], [.94, 'peak']] as const) {
    await page.evaluate(fraction => {
      const c = window.__cr, p = c.runtime.pose, speed = c.runtime.vehicle!.spec.topSpeedKmh / 3.6 * fraction;
      c.runtime.vehicle!.body.setLinvel({ x: p.fx * speed, y: 0, z: p.fz * speed }, true);
    }, fraction);
    await expect.poll(() => page.evaluate(() => window.__cr.audio.recorded?.stage), { intervals: [50] }).toBe(stage);
  }
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__cr.audio.recorded?.stage)).toBe('idle');
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.__cr.audio.recorded!.startCount)).toBe(starts);
  await page.getByTestId('sound-toggle').tap();
  await expect.poll(() => page.evaluate(() => window.__cr.audio.status)).toMatchObject({ muted: true, master: 0 });
  await page.getByTestId('sound-toggle').tap();
  await expect.poll(() => page.evaluate(() => window.__cr.audio.status)).toMatchObject({ muted: false, state: 'running' });
  expect(await page.evaluate(() => window.__cr.audio.recorded!.startCount)).toBe(starts);
  expect(errors).toEqual([]);
  await test.info().attach('supercar-samples.json', { body: JSON.stringify(recording, null, 2), contentType: 'application/json' });
});
