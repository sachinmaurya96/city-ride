// Dev helper: open the game in headless Chromium (SwiftShader WebGL), optionally drive, and screenshot.
// Usage: node scripts/shot.mjs <url> <out.png> [steps-json]
// steps: [{"key":"KeyW","hold":2000},{"click":"text=Play"},{"wait":1000},{"shot":"name.png"},{"eval":"js"}]
import { chromium } from '@playwright/test';

const [url = 'http://localhost:5173/', out = 'shot.png', stepsJson = '[]', size = '1280x720'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}${process.env.STACK ? '\n' + e.stack : ''}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);
for (const s of JSON.parse(stepsJson)) {
  if (s.key) {
    await page.keyboard.down(s.key);
    await page.waitForTimeout(s.hold ?? 100);
    await page.keyboard.up(s.key);
  }
  if (s.keys) {
    for (const k of s.keys) await page.keyboard.down(k);
    await page.waitForTimeout(s.hold ?? 100);
    for (const k of s.keys) await page.keyboard.up(k);
  }
  if (s.click) await page.click(s.click, { timeout: 5000 }).catch((e) => logs.push(`[click-fail] ${s.click}: ${e.message.split('\n')[0]}`));
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.eval) logs.push(`[eval] ${JSON.stringify(await page.evaluate(s.eval))}`);
  if (s.shot) await page.screenshot({ path: s.shot });
}
await page.screenshot({ path: out });
console.log(logs.slice(-40).join('\n'));
await browser.close();
