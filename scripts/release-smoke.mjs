// Exercise the real production UI without test hooks or bypassing onboarding.
// Also runnable independently: node scripts/release-smoke.mjs
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp' };
const NESTED = '/nested/games/city-ride/';

export async function smokeRelease({ dist = 'dist', artifacts = 'release', onPass = () => {} } = {}) {
  const root = resolve(dist);
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (p.startsWith(NESTED)) p = p.slice(NESTED.length - 1);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(root, `.${p}`);
    if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    for (const path of ['/', NESTED]) {
      // Each hosting path exercises a genuinely fresh player profile.
      const page = await browser.newPage({ viewport: { width: 667, height: 375 } });
      const errors = [], missing = [];
      let stage = 'navigation';
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
      page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') missing.push(`${r.failure()?.errorText} ${r.url()}`); });
      const waitForUI = async (id) => {
        await page.getByTestId(id).or(page.locator('.boot-error')).first().waitFor({ state: 'visible', timeout: 120000 });
        if (await page.locator('.boot-error').isVisible()) throw new Error(await page.locator('.boot-error').innerText());
      };
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}${path}`, { waitUntil: 'domcontentloaded' });
        stage = 'main menu';
        await waitForUI('play');
        stage = 'welcome bonus';
        await page.getByTestId('claim-welcome').click();
        await page.getByTestId('welcome-bonus').waitFor({ state: 'hidden' });
        stage = 'start game';
        await page.getByTestId('play').click();
        stage = 'world loading';
        await waitForUI('speed');
        await page.locator('.canvas-wrap canvas').waitFor({ state: 'visible' });
        await page.getByTestId('boot').waitFor({ state: 'hidden' });
        stage = 'controls tutorial';
        await page.getByTestId('controls-ok').click();
        await page.getByTestId('controls-ok').waitFor({ state: 'hidden' });
        stage = 'gameplay interaction';
        await page.getByTestId('pause').click();
        await page.getByTestId('pause-menu').waitFor({ state: 'visible' });
        await page.getByTestId('resume').click();
        await page.getByTestId('pause-menu').waitFor({ state: 'hidden' });
        if (missing.length || errors.length) throw new Error([...missing, ...errors].join(' | '));
        console.log(`▶ smoke test ${path} … ok`);
        onPass(path);
      } catch (error) {
        mkdirSync(artifacts, { recursive: true });
        const name = path === '/' ? 'smoke-root' : 'smoke-nested';
        const screenshot = join(artifacts, `${name}.png`);
        const message = error instanceof Error ? error.message : String(error);
        const bootError = await page.locator('.boot-error').allTextContents().catch(() => []);
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
        writeFileSync(join(artifacts, `${name}.json`), JSON.stringify({ path, stage, message, errors, missing, bootError }, null, 2));
        throw new Error(`smoke ${path} at ${stage}: ${message}\nDiagnostics: ${artifacts}/${name}.json and ${screenshot}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await smokeRelease(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
