import { expect, test } from '@playwright/test';
import { boot, fixture, play, waitStage } from './helpers';

test.use({ viewport: { width: 900, height: 560 } });

test('a bike passenger climbs on and off without any car-door sounds, and the bike waits for them', async ({ page }) => {
  test.setTimeout(300000);
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic'], equipped: 'bike_basic' });
  await page.evaluate(() => window.__cr.store.getState().updateSettings({ passengerCharacter: 'lynae' }));
  await play(page);
  await page.evaluate(() => {
    const c = window.__cr as typeof window.__cr & { doorEvents?: number };
    c.doorEvents = 0;
    c.events.on((e) => { if (e.type === 'CAR_DOOR') c.doorEvents! += 1; });
    c.rides.restore({ id: 'bike-pillion-fixture', kind: 'ride', seed: 7, state: 'TO_PICKUP', vehicleId: 'bike_basic',
      passengerName: 'Diya', avatar: 1, partySize: 1, rideType: 'standard', pickupBayId: 'homes_west_bay2', dropBayId: 'central_park_bay1',
      quote: c.quoteRide({ vehicleId: 'bike_basic', routeMeters: 250, rideType: 'standard', rain: false, estSeconds: 45 }),
      elapsed: 0, satisfaction: 100, finesPaid: 0, incidents: 0, recovered: false, harshEvents: 0, safePose: c.runtime.lastSafePose, bus: null });
    c.rides.checkpoint(true);
    const bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.pickupBayId)!;
    c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading });
  });
  await waitStage(page, ['BOARDING']);
  // Climbing on: the bike is held still (no throttle gets through) while the passenger mounts.
  await page.keyboard.down('KeyW'); await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__cr.runtime.telemetry.speedKmh)).toBeLessThan(1);
  await page.keyboard.up('KeyW');
  await waitStage(page, ['TO_DROPOFF']);
  await page.evaluate(() => { const c = window.__cr, bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.dropBayId)!; c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading }); });
  await waitStage(page, ['ALIGHTING']);
  await waitStage(page, ['COMPLETED']);
  expect(await page.evaluate(() => (window.__cr as typeof window.__cr & { doorEvents?: number }).doorEvents)).toBe(0);
});
