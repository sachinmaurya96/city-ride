// npm run release — checks, platform build, validation, root + nested smoke tests, size gate,
// ZIP packaging and build report. It never uploads or publishes anything.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { sizeReport, walk, BUDGET_BYTES } from './size-report.mjs';

const DIST = 'dist';
const OUT = 'release';
const started = Date.now();
const checks = [];
const fail = (msg) => {
  console.error(`\n✖ RELEASE FAILED: ${msg}`);
  writeReport(false, msg);
  process.exit(1);
};
const run = (name, cmd) => {
  process.stdout.write(`▶ ${name} … `);
  try {
    execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('ok');
    checks.push({ name, ok: true });
  } catch (e) {
    console.log('FAILED');
    console.error(String(e.stdout ?? '') + String(e.stderr ?? ''));
    checks.push({ name, ok: false });
    fail(`${name} failed`);
  }
};
let report = null;
function writeReport(ok, error) {
  mkdirSync(OUT, { recursive: true });
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const data = { name: pkg.name, version: pkg.version, ok, error: error ?? null, createdAt: new Date().toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000), node: process.version, checks, size: report, note: 'A successful build is not platform approval. Nothing was uploaded.' };
  writeFileSync(join(OUT, 'build-report.json'), JSON.stringify(data, null, 2));
  return data;
}

// 1. static checks, tests, production platform build
run('typecheck', 'npx tsc -b --noEmit');
run('lint', 'npx eslint .');
run('unit tests', 'npx vitest run');
rmSync(DIST, { recursive: true, force: true });
run('build (playgama mode)', 'npx vite build --mode playgama');

// 2. validate output
const files = walk(DIST).map((f) => relative(DIST, f).split('\\').join('/'));
const need = ['index.html', 'playgama-bridge-config.json', 'playgama-bridge.js'];
for (const f of need) if (!files.includes(f)) fail(`missing ${f} at archive root`);
try {
  const cfg = JSON.parse(readFileSync(join(DIST, 'playgama-bridge-config.json'), 'utf8'));
  if (typeof cfg !== 'object' || Array.isArray(cfg) || cfg === null) throw new Error('not an object');
} catch (e) {
  fail(`playgama-bridge-config.json is not a valid JSON object (${e.message})`);
}
checks.push({ name: 'required files + bridge config shape', ok: true });
if (files.some((f) => f.endsWith('.map'))) fail('source maps present');
if (files.some((f) => /references|\.psd$|\.blend$/i.test(f))) fail('reference/source assets present in dist');
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(data:|https?:|#)/.test(u));
for (const r of refs) {
  if (r.startsWith('/')) fail(`absolute asset path in index.html: ${r}`);
  if (!existsSync(join(DIST, r.replace(/^\.\//, '')))) fail(`index.html references missing file ${r}`);
}
if (/https?:\/\/(?!www\.w3\.org)/.test(html)) fail('index.html loads an external URL');
const allJs = files.filter((f) => f.endsWith('.js') && f !== 'playgama-bridge.js').map((f) => readFileSync(join(DIST, f), 'utf8')).join('\n');
if (allJs.includes('__cr') || allJs.includes('zz-autopilot')) fail('test hooks found in release bundle');
checks.push({ name: 'paths, exclusions, no test hooks', ok: true });

// 3. smoke test at the root and at a nested path (WASM physics, assets, bridge init, main menu)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (p.startsWith('/nested/games/city-ride/')) p = p.slice('/nested/games/city-ride'.length);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(4199, r));
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const path of ['/', '/nested/games/city-ride/']) {
  const page = await browser.newPage({ viewport: { width: 667, height: 375 } });
  const errors = [];
  const missing = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`http://localhost:4199${path}`);
  try {
    await page.waitForSelector('[data-testid=play]', { timeout: 120000 });
    await page.click('[data-testid=play]');
    await page.waitForTimeout(4000);
  } catch {
    errors.push('main menu / gameplay did not become ready');
  }
  const bootError = await page.locator('.boot-error').count();
  await page.close();
  if (missing.length) fail(`smoke ${path}: failed requests ${missing.join(', ')}`);
  if (errors.length || bootError) fail(`smoke ${path}: ${errors.join(' | ') || 'boot error shown'}`);
  console.log(`▶ smoke test ${path} … ok`);
  checks.push({ name: `smoke test ${path}`, ok: true });
}
await browser.close();
server.close();

// 4. size gate
report = sizeReport(DIST);
console.log(`▶ size: unpacked ${report.unpackedBytes} B, ZIP ${report.zipBytes} B, budget ${BUDGET_BYTES} B`);
if (!report.withinBudget) fail('size budget exceeded');
checks.push({ name: 'size budget', ok: true });

// 5. package dist CONTENTS (index.html at the ZIP root)
mkdirSync(OUT, { recursive: true });
const zipInput = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIST, f))]));
const zip = zipSync(zipInput, { level: 9 });
writeFileSync(join(OUT, 'city-ride-playgama.zip'), zip);
const data = writeReport(true);
const summary = `# City Ride — release summary

- Version: ${data.version}  ·  Built: ${data.createdAt}  ·  Node ${data.node}
- Archive: \`release/city-ride-playgama.zip\` (${zip.length.toLocaleString()} bytes, ${files.length} files, index.html at root)
- Unpacked runtime: ${report.unpackedBytes.toLocaleString()} bytes (budget ${BUDGET_BYTES.toLocaleString()}); gzip estimate ${report.gzipBytes.toLocaleString()} bytes; external transfer: none
- Checks: ${checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}`).join(' · ')}

Not done by this script: uploading, publishing, or platform review. A successful build is not platform approval.
Before submission replace \`public/playgama-bridge-config.json\` with the output of the official Playgama config editor (real project IDs).
`;
writeFileSync(join(OUT, 'RELEASE_SUMMARY.md'), summary);
console.log(`\n✔ release/city-ride-playgama.zip (${zip.length} bytes) · release/build-report.json · release/RELEASE_SUMMARY.md`);
