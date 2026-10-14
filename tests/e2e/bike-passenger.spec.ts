import { expect, test } from '@playwright/test';
import { boot, fixture, play, waitStage } from './helpers';

test.use({ viewport: { width: 900, height: 560 } });

for (const [vehicleId, passengerCharacter] of [['bike_basic', 'lynae'], ['ducati_v4r', 'cartethyia'], ['bike_basic', 'zani'], ['ducati_v4r', 'phoebe'], ['bike_basic', 'mint'], ['ducati_v4r', 'shorekeeper']] as const) {
  test(`${vehicleId}: a passenger straddles the rear seat, follows the bike lean and climbs on and off without car-door sounds`, async ({ page }) => {
    test.setTimeout(300000);
    await boot(page, { clear: true });
    await fixture(page, { owned: ['bike_basic', vehicleId], equipped: vehicleId });
    await page.evaluate((passengerCharacter) => window.__cr.store.getState().updateSettings({ passengerCharacter }), passengerCharacter);
    await play(page);
    await page.evaluate((vehicleId) => {
      const c = window.__cr as typeof window.__cr & { doorEvents?: number };
      c.doorEvents = 0;
      c.events.on((e) => { if (e.type === 'CAR_DOOR') c.doorEvents! += 1; });
      c.rides.restore({ id: 'bike-pillion-fixture', kind: 'ride', seed: 7, state: 'TO_PICKUP', vehicleId,
        passengerName: 'Diya', avatar: 1, partySize: 1, rideType: 'standard', pickupBayId: 'homes_west_bay2', dropBayId: 'central_park_bay1',
        quote: c.quoteRide({ vehicleId, routeMeters: 250, rideType: 'standard', rain: false, estSeconds: 45 }),
        elapsed: 0, satisfaction: 100, finesPaid: 0, incidents: 0, recovered: false, harshEvents: 0, safePose: c.runtime.lastSafePose, bus: null });
      c.rides.checkpoint(true);
      const bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.pickupBayId)!;
      c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading });
    }, vehicleId);
    await waitStage(page, ['BOARDING']);
    // Climbing on: the bike is held still (no throttle gets through) while the passenger mounts.
    await page.keyboard.down('KeyW'); await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__cr.runtime.telemetry.speedKmh)).toBeLessThan(1);
    await page.keyboard.up('KeyW');
    await waitStage(page, ['TO_DROPOFF']);
    await expect.poll(() => page.evaluate(() => {
      const scene = window.__cr.debug.extra.scene as import('three').Scene;
      return scene.getObjectByName('ride-passenger-lead')?.userData.character;
    }), { timeout: 60000 }).toBe(passengerCharacter);
    const pose = () => page.evaluate(() => {
      const c = window.__cr, T = c.debug.extra.THREE as typeof import('three'), scene = c.debug.extra.scene as import('three').Scene;
      const passenger = scene.getObjectByName('ride-passenger-lead')!, bike = scene.getObjectByName('player-driver')!.parent!;
      const joint = (key: string) => {
        let bone: import('three').Object3D | undefined;
        passenger.traverse(o => { if (o.userData.joint === key) bone = o; });
        return bike.worldToLocal(bone!.getWorldPosition(new T.Vector3()));
      };
      const hip = joint('hips'), left = joint('footL'), right = joint('footR');
      const knees = [joint('calfL'), joint('calfR')];
      return { hip: hip.toArray(), left: left.sub(hip).toArray(), right: right.sub(hip).toArray(),
        knees: knees.map(knee => knee.sub(hip).toArray()),
        leanError: passenger.getWorldQuaternion(new T.Quaternion()).angleTo(bike.getWorldQuaternion(new T.Quaternion())) };
    });
    const checkPose = async () => {
      const p = await pose();
      // Both legs straddle the bike with ankles tucked back, rather than stretched into a car footwell.
      expect(p.left[0]).toBeGreaterThan(.1);
      expect(p.right[0]).toBeLessThan(-.1);
      for (const [i, foot] of [p.left, p.right].entries()) {
        expect(foot[1]).toBeLessThan(-.2);
        expect(foot[2]).toBeLessThan(p.knees[i][2] - .08);
      }
      expect(p.leanError).toBeLessThan(.02);
      return p;
    };
    const stopped = await checkPose();
    await page.keyboard.down('KeyW');
    await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.speedKmh), { timeout: 30000 }).toBeGreaterThan(10);
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(700);
    const riding = await checkPose();
    // The pelvis stays on the same rear seat even when the whole bike tips into a corner.
    expect(Math.hypot(...riding.hip.map((n, i) => n - stopped.hip[i]))).toBeLessThan(.03);
    await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
    await page.evaluate(() => {
      const c = window.__cr, p = c.runtime.pose, rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
      c.pauseManager.set('TEST_PHOTO' as never, true);
      c.debug.cam = { x: p.x + rx * 3.5, y: 1.5, z: p.z + rz * 3.5, tx: p.x, ty: 1, tz: p.z };
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/${vehicleId}-passenger-riding.png` });
    await page.evaluate(() => { window.__cr.debug.cam = null; window.__cr.pauseManager.set('TEST_PHOTO' as never, false); });
    await page.evaluate(() => { const c = window.__cr, bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.dropBayId)!; c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading }); });
    await waitStage(page, ['ALIGHTING']);
    await waitStage(page, ['COMPLETED']);
    expect(await page.evaluate(() => (window.__cr as typeof window.__cr & { doorEvents?: number }).doorEvents)).toBe(0);
  });
}
