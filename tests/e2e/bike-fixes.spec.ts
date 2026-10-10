import { expect, test, type Page } from '@playwright/test';
import { boot, fixture, play } from './helpers';
import { BIKE_MODELS } from '../../src/game/data/importedCatalog';

test.use({ viewport: { width: 1100, height: 560 }, hasTouch: true });

/** Rider contact points relative to the bike (model space): hand/foot bone vs grip/peg. */
async function contacts(page: Page) {
  return page.evaluate(() => {
    const T = window.__cr.debug.extra.THREE as typeof import('three'), scene = window.__cr.debug.extra.scene as import('three').Scene;
    const driver = scene.getObjectByName('player-driver')!, bike = driver.parent!;
    const local = (name: RegExp) => { let p: import('three').Vector3 | null = null; driver.traverse(o => { if (!p && name.test(o.name)) p = bike.worldToLocal(o.getWorldPosition(new T.Vector3())); }); return p as unknown as import('three').Vector3; };
    const grip = (i: number) => bike.worldToLocal(scene.getObjectByName(`player-steering-grip-${i}`)!.getWorldPosition(new T.Vector3()));
    const handL = local(/Bip001LHand_|avatar-handL$/), handR = local(/Bip001RHand_|avatar-handR$/), footL = local(/Bip001LFoot_|avatar-footL$/), footR = local(/Bip001RFoot_|avatar-footR$/);
    return { hands: Math.max(handL.distanceTo(grip(0)), handR.distanceTo(grip(1))), footL: footL.toArray(), footR: footR.toArray() };
  });
}

for (const [id, driver] of [['ducati_v4r', 'lynae'], ['bike_basic', 'male']] as const) {
  test(`${id}: ${driver} sits on the seat, hands on the grips, feet on the pegs (left foot down when stopped), and the engine follows the revs`, async ({ page }) => {
    test.setTimeout(300000);
    const rig = BIKE_MODELS[id].rig;
    await boot(page, { clear: true });
    await fixture(page, { owned: ['bike_basic', id], equipped: id });
    await page.evaluate((d) => window.__cr.store.getState().updateSettings({ driver: d }), driver);
    await play(page);
    await page.getByTestId('gesture-layer').tap({ position: { x: 600, y: 200 } }); // unlocks audio like a real tap
    await expect.poll(() => page.evaluate(() => window.__cr.audio.recorded?.status), { timeout: 60000 }).toBe('ready');
    expect(await page.evaluate(() => window.__cr.audio.recorded!.recording)).toBe('bikeSound2');
    expect(await page.evaluate(() => window.__cr.audio.recorded!.startCount)).toBeGreaterThan(0);
    const shot = async (name: string, view: 'side' | 'chase' | 'front3q') => {
      // Freeze the simulation for the photo so a fast bike stays exactly framed (rendering continues).
      await page.evaluate((view) => { const c = window.__cr, p = c.runtime.pose, rx = Math.cos(p.heading), rz = -Math.sin(p.heading), fx = Math.sin(p.heading), fz = Math.cos(p.heading);
        c.pauseManager.set('TEST_PHOTO' as never, true);
        const cx = p.x, cz = p.z;
        c.debug.cam = view === 'side' ? { x: cx + rx * 2.6, y: .95, z: cz + rz * 2.6, tx: cx, ty: .7, tz: cz }
          : view === 'front3q' ? { x: cx + fx * 2.4 + rx * 1.6, y: 1.2, z: cz + fz * 2.4 + rz * 1.6, tx: cx, ty: .75, tz: cz }
          : { x: cx - fx * 3.4 - rx * .8, y: 1.6, z: cz - fz * 3.4 - rz * .8, tx: cx + fx, ty: .8, tz: cz + fz }; }, view);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/bike-${id}-${name}.png` });
      await page.evaluate(() => { window.__cr.debug.cam = null; window.__cr.pauseManager.set('TEST_PHOTO' as never, false); });
    };
    const rec = () => page.evaluate(() => ({ rpm: window.__cr.audio.recorded!.rpm, stage: window.__cr.audio.recorded!.stage }));
    await page.waitForTimeout(1800);
    const idle = await rec();
    // Stopped: hands on the grips, right foot on its peg, left foot down on the road outside the bike.
    await shot('stopped-side', 'side');
    await shot('stopped-3q', 'front3q');
    let c = await contacts(page);
    console.log(id, 'stopped', JSON.stringify(c), await page.evaluate(() => { const d = (window.__cr.debug.extra.scene as import('three').Scene).getObjectByName('player-driver')!; return JSON.stringify({ reach: d.userData.reach, lean: d.userData.lean, scale: d.scale.x }); }));
    expect(c.hands).toBeLessThan(.12);
    // Left ankle down at road level (heeled shoes put it ~20 cm up), outside the peg.
    expect(c.footL[1]).toBeLessThan(.26); expect(c.footL[0]).toBeGreaterThan(rig.peg[0]);
    expect(Math.hypot(c.footR[0] + rig.peg[0], c.footR[2] - rig.peg[2])).toBeLessThan(.12);
    // Revving at a standstill raises the revs above idle.
    await page.keyboard.down('KeyW'); await page.waitForTimeout(250);
    const blip = await rec();
    expect(blip.rpm).toBeGreaterThan(idle.rpm + 1500);
    await page.waitForTimeout(3500);
    const riding = await rec();
    // Riding: both feet up on the pegs.
    c = await contacts(page);
    expect(c.hands).toBeLessThan(.12);
    expect(Math.hypot(c.footL[0] - rig.peg[0], c.footL[2] - rig.peg[2])).toBeLessThan(.12);
    expect(c.footL[1]).toBeGreaterThan(rig.peg[1] - .05);
    await shot('moving-side', 'side');
    await shot('moving-chase', 'chase');
    // Pausing for the photos released the held keys; press on again and lean into a turn.
    await page.keyboard.up('KeyW'); await page.keyboard.down('KeyW'); await page.waitForTimeout(600);
    await page.keyboard.down('KeyA'); await page.waitForTimeout(900);
    await shot('turn-chase', 'chase');
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW'); await page.waitForTimeout(1200);
    const coast = await rec();
    expect(coast.rpm).toBeLessThan(riding.rpm);
    console.log(id, driver, JSON.stringify({ idle, blip, riding, coast, contacts: c }));
  });
}
