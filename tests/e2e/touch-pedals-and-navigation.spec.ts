import { expect, test } from '@playwright/test';
import { boot, fixture, play, waitStage } from './helpers';

test.setTimeout(240000);

test.describe('independent touch pedals', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  test('phones and tablets steer without throttle, accelerate, drift, stop and reverse with separate fingers', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await boot(page, { clear: true });
    await fixture(page, { owned: ['car_compact'], equipped: 'car_compact' }); await play(page);
    await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
    const touch = await page.context().newCDPSession(page);
    for (const [width, height] of [[844, 390], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => {
        const c = window.__cr, seg = c.cityMap.SEGMENTS.find(s => s.dir === 'N' && s.length > 180)!;
        const [x, z] = c.cityMap.segmentPoint(seg, 30, c.cityMap.laneOffset(seg, 0));
        c.runtime.requestRecovery({ x, z, heading: Math.PI }); c.input.reset();
      });
      await expect.poll(() => page.evaluate(() => window.__cr.runtime.pendingRecovery)).toBeNull();
      const joystick = (await page.locator('.joy-home').boundingBox())!;
      const gas = (await page.getByTestId('accelerate').boundingBox())!;
      const brake = (await page.getByTestId('power-brake').boundingBox())!;
      const reverse = (await page.getByTestId('reverse').boundingBox())!;
      const center = { x: joystick.x + joystick.width / 2, y: joystick.y + joystick.height / 2, id: 1 };
      const gasPoint = { x: gas.x + gas.width / 2, y: gas.y + gas.height / 2, id: 2 };
      const brakePoint = { x: brake.x + brake.width / 2, y: brake.y + brake.height / 2, id: 3 };
      const reversePoint = { x: reverse.x + reverse.width / 2, y: reverse.y + reverse.height / 2, id: 4 };
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, y: center.y - 35 }] });
      expect(await page.evaluate(() => window.__cr.input.getDrive({ steer: 0, throttle: 0, brake: 0, handbrake: false }))).toMatchObject({ steer: 0, throttle: 0, brake: 0 });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center, gasPoint] });
      await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.speedKmh)).toBeGreaterThan(5);
      const steer = { ...center, x: center.x + 30, y: center.y - 35 };
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [steer, gasPoint] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [steer, gasPoint, brakePoint] });
      await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.drifting)).toBe(true);
      expect(await page.evaluate(() => window.__cr.input.pedals.gas)).toBe(1);
      await page.screenshot({ path: `test-results/touch-pedals-${width}x${height}.png` });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [brakePoint] });
      await expect.poll(() => page.evaluate(() => window.__cr.runtime.vehicle!.horizontalSpeed())).toBeLessThan(.05);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [reversePoint] });
      await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.reversing)).toBe(true);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      expect(await page.evaluate(() => window.__cr.input.getDrive({ steer: 0, throttle: 0, brake: 0, handbrake: false }))).toMatchObject({ steer: 0, throttle: 0, brake: 0, powerBrake: false });
    }
    await touch.detach(); expect(errors).toEqual([]);
  });
});

test('following GPS reaches the actual pickup and dropoff stopping areas', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, { clear: true });
  await fixture(page, { owned: ['car_compact'], equipped: 'car_compact' }); await play(page);
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
  await page.evaluate(() => {
    const c = window.__cr;
    c.rides.restore({ id: 'navigation-arrival-fixture', kind: 'ride', seed: 12, state: 'TO_PICKUP', vehicleId: 'car_compact',
      passengerName: 'Diya', avatar: 1, partySize: 1, rideType: 'standard', pickupBayId: 'homes_west_bay2', dropBayId: 'central_park_bay1',
      quote: c.quoteRide({ vehicleId: 'car_compact', routeMeters: 250, rideType: 'standard', rain: false, estSeconds: 45 }),
      elapsed: 0, satisfaction: 100, finesPaid: 0, incidents: 0, recovered: false, harshEvents: 0, safePose: null, bus: null });
    c.rides.checkpoint(true);
  });
  for (const [bayId, arrival] of [['homes_west_bay2', 'TO_DROPOFF'], ['central_park_bay1', 'COMPLETED']]) {
    await page.evaluate(id => {
      const c = window.__cr, bay = c.cityMap.BAY_BY_ID.get(id)!, seg = c.cityMap.SEGMENT_BY_ID.get(bay.segmentId)!;
      const [x, z] = c.cityMap.segmentPoint(seg, bay.s - 45, c.cityMap.laneOffset(seg, seg.lanes - 1));
      c.runtime.requestRecovery({ x, z, heading: bay.heading });
    }, bayId);
    await expect.poll(() => page.evaluate(() => window.__cr.runtime.pendingRecovery)).toBeNull();
    await expect.poll(() => page.evaluate(id => {
      const c = window.__cr, bay = c.cityMap.BAY_BY_ID.get(id)!, last = c.nav.route?.points.at(-1);
      return !!last && Math.hypot(last[0] - bay.x, last[1] - bay.z) < .001;
    }, bayId)).toBe(true);
    await page.evaluate(() => window.__cr.autopilot.start(6));
    await waitStage(page, [arrival], 90000);
    await page.evaluate(() => window.__cr.autopilot.stop());
    const offset = await page.evaluate(id => {
      const c = window.__cr, bay = c.cityMap.BAY_BY_ID.get(id)!;
      const dx = c.runtime.pose.x - bay.x, dz = c.runtime.pose.z - bay.z;
      return { along: Math.abs(dx * Math.sin(bay.heading) + dz * Math.cos(bay.heading)), across: Math.abs(dx * Math.cos(bay.heading) - dz * Math.sin(bay.heading)), length: bay.length, width: bay.width };
    }, bayId);
    expect(offset.along).toBeLessThan(offset.length / 2);
    expect(offset.across).toBeLessThan(offset.width / 2 + .35);
    await page.screenshot({ path: `test-results/navigation-${bayId}.png` });
  }
  expect(errors).toEqual([]);
});
