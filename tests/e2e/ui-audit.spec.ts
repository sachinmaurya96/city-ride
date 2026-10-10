import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { boot, play } from './helpers';

// Audit sweep: opens every overlay on phone/tablet sizes and records layout + contrast problems.
test.setTimeout(30 * 60 * 1000);
test.use({ hasTouch: true, isMobile: true });

const SIZES = [[568, 320], [667, 375], [740, 360], [844, 390], [932, 430], [1024, 768], [1180, 820], [1366, 1024]];
const MENU = ['settings', 'garage', 'daily', 'stats', 'credits'] as const;
const GAME = ['pause', 'map', 'controls', 'bus', 'settings', 'fuel'] as const;

async function audit(page: Page, tag: string) {
  return page.evaluate((tag) => {
    const issues: string[] = [];
    const vw = innerWidth, vh = innerHeight;
    const parse = (c: string) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    const lum = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
    const bgOf = (el: Element | null): { r: number; g: number; b: number } | 'image' => {
      let r = 0, g = 0, b = 0, keep = 1;
      for (; el; el = el.parentElement) {
        const s = getComputedStyle(el);
        if (s.backgroundImage !== 'none') return 'image';
        const c = parse(s.backgroundColor);
        r += c.r * c.a * keep; g += c.g * c.a * keep; b += c.b * c.a * keep; keep *= 1 - c.a;
        if (keep < .02) break;
      }
      return { r: r + 20 * keep, g: g + 33 * keep, b: b + 43 * keep };
    };
    const modals = [...document.querySelectorAll('.modal')];
    for (const m of modals) {
      const r = m.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) issues.push(`modal off-screen ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (m.scrollWidth - m.clientWidth > 1) issues.push(`modal horizontal overflow ${m.scrollWidth - m.clientWidth}px`);
      const s = getComputedStyle(m);
      if (m.scrollHeight - m.clientHeight > 1 && !/(auto|scroll)/.test(s.overflowY)) issues.push('modal content cut, not scrollable');
    }
    const root = modals.at(-1) ?? document.body;
    for (const btn of root.querySelectorAll<HTMLElement>('button, .btn, [role=tab]')) {
      const r = btn.getBoundingClientRect(); const s = getComputedStyle(btn);
      if (!r.width || s.visibility === 'hidden' || s.display === 'none') continue;
      const name = (btn.textContent || btn.getAttribute('aria-label') || btn.className).trim().slice(0, 30);
      if (btn.scrollWidth - btn.clientWidth > 2) issues.push(`button text clipped: "${name}"`);
      if (r.right > vw + 1 || r.left < -1) issues.push(`button off-screen: "${name}"`);
      if (r.height < 32 && btn.closest('.modal')) issues.push(`small tap target ${Math.round(r.width)}x${Math.round(r.height)}: "${name}"`);
      if (!btn.textContent?.trim()) continue;
      const bg = bgOf(btn);
      if (bg === 'image') continue;
      const fg = parse(s.color);
      const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
      const op = Number(s.opacity);
      if (ratio < 3 && !(btn as HTMLButtonElement).disabled) issues.push(`low contrast ${ratio.toFixed(2)} fg=${s.color} bg=rgb(${bg.r|0},${bg.g|0},${bg.b|0}): "${name}"`);
      if (op < .6 && !(btn as HTMLButtonElement).disabled) issues.push(`faded opacity ${op}: "${name}"`);
    }
    return issues.map(i => `${tag}: ${i}`);
  }, tag);
}

test('ui audit across phones and tablets', async ({ page }) => {
  const all: string[] = [];
  fs.mkdirSync('test-results/audit', { recursive: true });
  await boot(page, { clear: true });
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    all.push(...await audit(page, `menu ${w}x${h}`));
    await page.screenshot({ path: `test-results/audit/menu-${w}x${h}.png` });
    for (const o of MENU) {
      await page.evaluate((o) => window.__cr.store.getState().openOverlay(o as never), o);
      await page.waitForTimeout(400);
      all.push(...await audit(page, `${o} ${w}x${h}`));
      await page.screenshot({ path: `test-results/audit/${o}-${w}x${h}.png` });
      await page.evaluate(() => window.__cr.store.getState().openOverlay(null));
    }
  }
  await play(page);
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    all.push(...await audit(page, `hud ${w}x${h}`));
    await page.screenshot({ path: `test-results/audit/hud-${w}x${h}.png` });
    for (const o of GAME) {
      await page.evaluate((o) => {
        const c = window.__cr as unknown as { fuel: { prompt: unknown; station: unknown }; runtime: { vehicleId: string } };
        if (o === 'fuel') c.fuel.prompt = { station: { name: 'Petrol West', x: 0, z: 0 }, vehicleId: c.runtime.vehicleId };
        window.__cr.store.getState().openOverlay(o as never);
      }, o);
      await page.waitForTimeout(500);
      all.push(...await audit(page, `${o} ${w}x${h}`));
      await page.screenshot({ path: `test-results/audit/game-${o}-${w}x${h}.png` });
      await page.evaluate(() => window.__cr.store.getState().openOverlay(null));
    }
  }
  fs.writeFileSync('test-results/audit/issues.txt', all.join('\n'));
});
