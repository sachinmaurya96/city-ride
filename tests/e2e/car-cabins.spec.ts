import { expect, test, type Page } from '@playwright/test';
import { boot, fixture, play } from './helpers';

test.use({ viewport: { width: 1000, height: 600 } });

const CARS = ['bmw_i8', 'bmw_m4_gt3', 'lambo_lp670', 'black_huracan', 'mclaren_p1', 'mustang_rtr', 'rolls_spectre', 'porsche_718', 'supra_a80', 'western_star', 'fast_72', 'mercedes_maybach', 'classic_sport'] as const;
const DRIVERS = ['male', 'lynae', 'female', 'cartethyia'] as const;

/** Hands relative to the steering-wheel rim (wheel frame: radial error, axial offset) and the wheel's turn. */
async function cabin(page: Page, id: string) {
  return page.evaluate((id) => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof import('three'), scene = c.debug.extra.scene as import('three').Scene;
    const driver = scene.getObjectByName('player-driver'), car = scene.getObjectByName(`imported-vehicle-${id}`);
    if (!driver || !car) return { mode: c.vehicleEntry.mode, doors: [0, 0], rim: null, turn: 0, reach: 0, lean: 0, wheelX: null, loaded: false };
    const wheel = car.getObjectByName('steering-wheel');
    const find = (re: RegExp) => { let p: import('three').Vector3 | null = null; driver.traverse(o => { if (!p && re.test(o.name)) p = o.getWorldPosition(new T.Vector3()); }); return p as unknown as import('three').Vector3; };
    const hands = [find(/Bip001LHand_|avatar-handL$/), find(/Bip001RHand_|avatar-handR$/)];
    const r = wheel?.userData.radius as number | undefined;
    const rim = wheel && r ? hands.map(h => { const p = wheel.worldToLocal(h.clone()); return { radial: Math.abs(Math.hypot(p.x, p.y) - r), axial: p.z }; }) : null;
    const rest = wheel?.userData.rest as number[] | undefined;
    const turn = wheel && rest ? 2 * Math.acos(Math.min(1, Math.abs(new T.Quaternion().fromArray(rest).dot(wheel.quaternion)))) : 0;
    return { mode: c.vehicleEntry.mode, doors: [1, -1].map(s => car.getObjectByName(`vehicle-door-${s}`)?.userData.open ?? 0), rim, turn, reach: driver.userData.reach, lean: driver.userData.lean, wheelX: wheel ? car.worldToLocal(wheel.getWorldPosition(new T.Vector3())).x : null, loaded: true };
  }, id);
}

async function shot(page: Page, name: string, view: 'door' | 'side' | 'chase') {
  await page.evaluate((view) => {
    const c = window.__cr, p = c.runtime.pose, rx = Math.cos(p.heading), rz = -Math.sin(p.heading), fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    c.pauseManager.set('TEST_PHOTO' as never, true);
    // The driver's side is the car's right (-X): camera offsets along -right.
    c.debug.cam = view === 'door' ? { x: p.x - rx * 3.4 + fx * 2.2, y: 1.7, z: p.z - rz * 3.4 + fz * 2.2, tx: p.x - rx * .4, ty: .8, tz: p.z - rz * .4 }
      : view === 'side' ? { x: p.x - rx * 2.6 + fx * .4, y: 1.25, z: p.z - rz * 2.6 + fz * .4, tx: p.x - rx * .3 + fx * .2, ty: .85, tz: p.z - rz * .3 + fz * .2 }
      : { x: p.x - fx * 5.5 - rx * 1.2, y: 2.6, z: p.z - fz * 5.5 - rz * 1.2, tx: p.x + fx, ty: .9, tz: p.z + fz };
  }, view);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/cabin-${name}.png` });
  await page.evaluate(() => { window.__cr.debug.cam = null; window.__cr.pauseManager.set('TEST_PHOTO' as never, false); });
}

CARS.forEach((id, i) => {
  test(`${id}: the driver opens the door, sits behind the steering wheel (right-hand drive) and steers with both hands`, async ({ page }) => {
    test.setTimeout(240000);
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await boot(page, { clear: true });
    await fixture(page, { owned: ['bike_basic', id], equipped: id });
    await page.evaluate((d) => window.__cr.store.getState().updateSettings({ driver: d }), DRIVERS[i % DRIVERS.length]);
    await play(page);
    // Walk up and open the driver's door.
    await expect.poll(async () => (await cabin(page, id)).doors[1], { timeout: 90000, intervals: [100] }).toBeGreaterThan(.9);
    await shot(page, `${id}-door`, 'door');
    await expect.poll(async () => (await cabin(page, id)).mode, { timeout: 30000 }).toBe('seated');
    await page.waitForTimeout(1500);
    let s = await cabin(page, id);
    console.log(id, JSON.stringify(s));
    expect(s.doors).toEqual([0, 0]);
    if (s.rim) {
      // A measured interior: the wheel is on the right-hand side and both palms are on its rim.
      expect(s.wheelX!).toBeLessThan(-.15);
      for (const hand of s.rim) { expect(hand.radial).toBeLessThan(.04); expect(Math.abs(hand.axial - .03)).toBeLessThan(.05); }
    }
    expect(s.reach).toBeLessThan(.97);
    await shot(page, `${id}-side`, 'side');
    // Steer right: the wheel turns and the hands go with it.
    await page.keyboard.down('KeyD'); await page.waitForTimeout(900);
    s = await cabin(page, id);
    if (s.rim) { expect(s.turn).toBeGreaterThan(.5); for (const hand of s.rim) expect(hand.radial).toBeLessThan(.04); }
    await shot(page, `${id}-steer`, 'side');
    await page.keyboard.up('KeyD');
    await shot(page, `${id}-chase`, 'chase');
    expect(errors).toEqual([]);
  });
});
