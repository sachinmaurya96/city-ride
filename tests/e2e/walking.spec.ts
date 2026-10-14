import { expect, test, type Page } from '@playwright/test';
import { boot, fixture, play, waitStage } from './helpers';

test.use({ viewport: { width: 900, height: 560 } });

type Sample = { t: number; x: number; z: number; heading: number; visible: boolean; footL: number[]; footR: number[]; id: string; inside: number };
/**
 * Track a character every rendered frame until `seconds` of game time pass. t = simulation time (software
 * rendering is slow, so wall-clock windows would cover little of the game). The driver rides in the car's
 * frame, so its facing is read relative to the car (`local`).
 */
async function track(page: Page, name: string, seconds: number, local = false) {
  return page.evaluate(({ name, seconds, local }) => new Promise<Sample[]>((resolve) => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof import('three'), scene = c.debug.extra.scene as import('three').Scene;
    const out: Sample[] = [], start = c.runtime.simTime, q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3();
    const tick = () => {
      const o = scene.getObjectByName(name);
      if (o) {
        o.getWorldPosition(p); o.getWorldQuaternion(q); e.setFromQuaternion(q, 'YXZ');
        const foot = (joint: string) => { let v: number[] = []; o.traverse(b => { if (!v.length && b.userData.joint === joint) v = b.getWorldPosition(new T.Vector3()).toArray(); }); return v; };
        out.push({ t: c.runtime.simTime - start, x: p.x, z: p.z, heading: local ? o.rotation.y : e.y, visible: o.visible, footL: foot('footL'), footR: foot('footR'), id: o.uuid, inside: (o.userData.inside ?? o.userData.entryProgress ?? -1) as number });
      }
      if (c.runtime.simTime - start < seconds) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }), { name, seconds, local });
}
/** Peak ground speed (m/s of game time, over ≥0.15 s) and peak turn rate (rad per game second) while visible. */
function motion(samples: Sample[]) {
  let speed = 0, turn = 0, at = -1;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i]; if (!a.visible || !b.visible) continue;
    // Turn rate per second of game time (frames stalled by screenshots advance several physics steps at once).
    const dt = b.t - a.t; if (dt <= 0) continue;
    const d = Math.abs(Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading))) / dt;
    if (d > turn) { turn = d; at = i; }
    const j = samples.findIndex((s) => s.t >= a.t + .15); if (j > i) { const c = samples[j]; speed = Math.max(speed, Math.hypot(c.x - a.x, c.z - a.z) / (c.t - a.t)); }
  }
  const around = at < 0 ? [] : samples.slice(Math.max(0, at - 3), at + 3).map(s => `${s.t.toFixed(3)} h${s.heading.toFixed(3)} in${s.inside.toFixed(2)} ${s.id.slice(0, 4)} ${s.x.toFixed(2)},${s.z.toFixed(2)}`);
  return { speed, turn, around };
}
async function filmstrip(page: Page, prefix: string, frames: number, every: number, camera: () => void) {
  for (let k = 0; k < frames; k++) {
    await page.evaluate(camera);
    await page.waitForTimeout(every);
    await page.screenshot({ path: `test-results/walk-${prefix}-${k}.png` });
  }
  await page.evaluate(() => { window.__cr.debug.cam = null; });
}

test('the driver walks up naturally, turns smoothly to the door, gets out and walks around on foot', async ({ page }) => {
  test.setTimeout(300000);
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic', 'mustang_rtr'], equipped: 'mustang_rtr' });
  await page.evaluate(() => window.__cr.store.getState().updateSettings({ driver: 'lynae' }));
  await play(page);
  await expect.poll(() => page.evaluate(() => !!(window.__cr.debug.extra.scene as import('three').Scene).getObjectByName('imported-vehicle-mustang_rtr')), { timeout: 90000 }).toBe(true);
  // Entering: side-on camera fixed beside the walk.
  const side = () => { const c = window.__cr, p = c.runtime.pose, rx = Math.cos(p.heading), rz = -Math.sin(p.heading), fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    c.debug.cam = { x: p.x - rx * 6 - fx * .5, y: 1.3, z: p.z - rz * 6 - fz * .5, tx: p.x - rx * 1.5 - fx * .5, ty: .9, tz: p.z - rz * 1.5 - fz * .5 }; };
  const enter = track(page, 'player-driver', 2.5, true);
  await filmstrip(page, 'enter', 6, 220, side);
  const entering = motion(await enter);
  console.log('enter', JSON.stringify(entering));
  expect(entering.speed).toBeLessThan(1.6);
  expect(entering.turn).toBeLessThan(6);
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 30000 }).toBe('seated');
  // Get out and walk away from the door.
  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode)).toBe('exiting');
  const exit = track(page, 'player-driver', 4.5, true);
  await filmstrip(page, 'exit', 6, 600, side);
  const exiting = motion(await exit);
  console.log('exit', JSON.stringify(exiting));
  expect(exiting.turn).toBeLessThan(6);
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 30000 }).toBe('outside');
  // On foot: walk back along the car, then turn and walk out; turns are eased and the pace is a brisk walk.
  const walk = track(page, 'player-driver', 3, true);
  await page.keyboard.down('KeyS'); await page.waitForTimeout(1500);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(1200); await page.keyboard.up('KeyS');
  await page.waitForTimeout(1000); await page.keyboard.up('KeyD');
  const onFoot = await walk, m = motion(onFoot);
  console.log('outside', JSON.stringify(m));
  expect(m.speed).toBeGreaterThan(1.1);
  expect(m.speed).toBeLessThan(1.8);
  expect(m.turn).toBeLessThan(6);
  // (Foot planting is measured exactly, per physics frame, in gait.test.ts; software rendering here is too slow.)
  await page.evaluate(() => { const c = window.__cr, o = (c.debug.extra.scene as import('three').Scene).getObjectByName('player-driver')!, p = o.getWorldPosition(new (c.debug.extra.THREE as typeof import('three')).Vector3());
    c.debug.cam = { x: p.x + 3.5, y: 1.4, z: p.z + 1, tx: p.x, ty: .9, tz: p.z }; });
  await page.keyboard.down('KeyW');
  await filmstrip(page, 'outside', 6, 160, () => { const c = window.__cr, o = (c.debug.extra.scene as import('three').Scene).getObjectByName('player-driver')!, p = o.getWorldPosition(new (c.debug.extra.THREE as typeof import('three')).Vector3());
    c.debug.cam = { x: p.x + 3.5, y: 1.4, z: p.z + 1, tx: p.x, ty: .9, tz: p.z }; });
  await page.keyboard.up('KeyW');
});

test('a passenger walks to the car at a natural pace, faces the door, boards, and walks away along the curb', async ({ page }) => {
  test.setTimeout(300000);
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic', 'supra_a80'], equipped: 'supra_a80' });
  await page.evaluate(() => window.__cr.store.getState().updateSettings({ passengerCharacter: 'cartethyia' }));
  await play(page);
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 90000 }).toBe('seated');
  await page.evaluate(() => {
    const c = window.__cr;
    c.rides.restore({ id: 'walk-fixture', kind: 'ride', seed: 12, state: 'TO_PICKUP', vehicleId: 'supra_a80',
      passengerName: 'Diya', avatar: 1, partySize: 1, rideType: 'standard', pickupBayId: 'homes_west_bay2', dropBayId: 'central_park_bay1',
      quote: c.quoteRide({ vehicleId: 'supra_a80', routeMeters: 250, rideType: 'standard', rain: false, estSeconds: 45 }),
      elapsed: 0, satisfaction: 100, finesPaid: 0, incidents: 0, recovered: false, harshEvents: 0, safePose: c.runtime.lastSafePose, bus: null });
    c.rides.checkpoint(true);
    const bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.pickupBayId)!;
    // Stop a few metres along the bay, so the passenger has a real walk to the door.
    c.runtime.requestRecovery({ x: bay.x + Math.sin(bay.heading) * 2.5, z: bay.z + Math.cos(bay.heading) * 2.5, heading: bay.heading });
  });
  await waitStage(page, ['BOARDING']);
  const board = track(page, 'ride-passenger-lead', 3);
  await filmstrip(page, 'board', 6, 300, () => { const c = window.__cr, o = (c.debug.extra.scene as import('three').Scene).getObjectByName('ride-passenger-lead')!, p = o.getWorldPosition(new (c.debug.extra.THREE as typeof import('three')).Vector3()), h = c.runtime.pose.heading;
    c.debug.cam = { x: p.x + Math.cos(h) * 4 - Math.sin(h) * 2, y: 1.5, z: p.z - Math.sin(h) * 4 - Math.cos(h) * 2, tx: p.x, ty: .9, tz: p.z }; });
  const boarding = motion(await board);
  console.log('board', JSON.stringify(boarding));
  expect(boarding.speed).toBeLessThan(1.6);
  expect(boarding.turn).toBeLessThan(6);
  await waitStage(page, ['TO_DROPOFF']);
  await page.evaluate(() => { const c = window.__cr, bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.dropBayId)!; c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading }); });
  await waitStage(page, ['ALIGHTING']);
  const leave = track(page, 'ride-passenger-lead', 5);
  await waitStage(page, ['COMPLETED']);
  const leaving = await leave, l = motion(leaving);
  // The receipt pauses the game; carry on to watch the passenger walk off.
  await page.click('[data-testid=next-ride]');
  console.log('leave', JSON.stringify(l));
  console.log(leaving.filter((_, i) => i % 15 === 0).map(s => `${s.t.toFixed(2)}:${s.x.toFixed(2)},${s.z.toFixed(2)} h${s.heading.toFixed(2)} ${s.visible ? 'v' : '-'}`).join(' | '));
  console.log(JSON.stringify(await page.evaluate(() => ({ stage: window.__cr.rides.stage, alight: window.__cr.rideVisual.alightProgress, dep: window.__cr.rideVisual.departureAt, t: window.__cr.runtime.simTime }))));
  expect(l.speed).toBeLessThan(1.6);
  expect(l.turn).toBeLessThan(6);
  // Walking away, the passenger faces the way they walk (not a fixed compass direction).
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.simTime - window.__cr.rideVisual.departureAt), { timeout: 60000 }).toBeGreaterThan(1.5);
  const away = await track(page, 'ride-passenger-lead', 1);
  const first = away[0], last = away[away.length - 1];
  const travel = Math.atan2(last.x - first.x, last.z - first.z);
  expect(Math.abs(Math.atan2(Math.sin(travel - last.heading), Math.cos(travel - last.heading)))).toBeLessThan(.35);
});
