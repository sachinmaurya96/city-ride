import { expect, test } from '@playwright/test';

// First-visit timing on a throttled mobile-class connection (fresh cache): page open → menu → Play → driving.
test('first play load time', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
  await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('test')); });
  const sizes: string[] = [];
  page.on('requestfinished', async r => { const b = (await r.sizes()).responseBodySize; if (b > 50000) sizes.push(`${Math.round(b / 1024)}KB ${r.url().split('/').pop()}`); });
  const t0 = Date.now();
  await page.goto('/');
  await page.waitForSelector('[data-testid=play]', { timeout: 120000 });
  const menu = Date.now() - t0;
  const idle = Number(process.env.MENU_WAIT ?? 0);
  if (idle) await page.waitForTimeout(idle);
  const t1 = Date.now();
  await page.click('[data-testid=play]');
  await expect.poll(() => page.evaluate(() => window.__cr?.store.getState().appState), { timeout: 300000, intervals: [100] }).toBe('PLAYING');
  if (process.env.LIST) console.log(sizes.join('\n'));
  console.log(`LOAD menu=${menu}ms play=${Date.now() - t1}ms (menu wait ${idle}ms)`);
});
