import { expect, type Page } from '@playwright/test';

export type CR = {
  rides: { stage: string; mission: { id: string } | null };
  nav: { remaining: number };
  store: { getState(): { save: { wallet: number; lifetime: { jobs: number }; pendingReceipts: { id: string; net: number }[]; mission: { id: string; state: string } | null }; appState: string } };
  autopilot: { start(v?: number): void; stop(): void };
};

export async function state(page: Page) {
  return page.evaluate(() => {
    const c = (window as unknown as { __cr: CR }).__cr;
    const s = c.store.getState().save;
    return {
      stage: c.rides.stage,
      missionId: c.rides.mission?.id ?? null,
      savedMission: s.mission ? `${s.mission.id}:${s.mission.state}` : null,
      wallet: s.wallet,
      jobs: s.lifetime.jobs,
      receipts: s.pendingReceipts.map((r) => r.id),
      app: c.store.getState().appState,
      rem: Math.round(c.nav.remaining),
    };
  });
}

export async function boot(page: Page, opts: { clear?: boolean; quality?: 'low' | 'medium' } = {}) {
  // The touch landscape lock enters fullscreen on tap, which would block viewport resizing in tests.
  await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('disabled in tests')); });
  if (opts.clear) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  }
  await page.goto('/');
  await page.waitForSelector('[data-testid=play]', { timeout: 90000 });
  await page.waitForFunction(() => !!window.__cr?.store);
  await page.evaluate((q) => (window as unknown as { __cr: { store: { getState(): { updateSettings(p: object): void } } } }).__cr.store.getState().updateSettings({ quality: q }), opts.quality ?? 'low');
}

export async function play(page: Page) {
  await page.click('[data-testid=play]');
  await expect.poll(async () => (await state(page)).app, { timeout: 90000 }).toBe('PLAYING');
  const ok = page.locator('[data-testid=controls-ok]');
  if (await ok.isVisible({ timeout: 2500 }).catch(() => false)) await ok.click();
}

export async function waitStage(page: Page, stages: string[], timeout = 300000) {
  await expect.poll(async () => (await state(page)).stage, { timeout, intervals: [1000] }).toMatch(new RegExp(`^(${stages.join('|')})$`));
}

export async function autopilot(page: Page, on: boolean) {
  await page.evaluate((v) => {
    const c = (window as unknown as { __cr: CR }).__cr;
    if (v) c.autopilot.start(9);
    else c.autopilot.stop();
  }, on);
}

/** Accept the current offer and drive it to completion; returns the settled receipt net. */
export async function completeRide(page: Page) {
  await waitStage(page, ['OFFERED'], 60000);
  await page.click('[data-testid=accept]');
  await autopilot(page, true);
  await waitStage(page, ['TO_DROPOFF'], 900000);
  await waitStage(page, ['COMPLETED'], 900000);
  await autopilot(page, false);
  await expect(page.locator('[data-testid=receipt]')).toBeVisible();
}

/** Test-only fixture (dev/e2e builds): adjust the save before playing. Never present in release builds. */
export async function fixture(page: Page, patch: { wallet?: number; xp?: number; owned?: string[]; equipped?: string; jobs?: number }) {
  await page.evaluate((p) => {
    const st = (window as unknown as { __cr: { store: { getState(): { save: Record<string, unknown> & { lifetime: { jobs: number }; tutorial: Record<string, boolean> }; commit(s: unknown): void } } } }).__cr.store.getState();
    const s = structuredClone(st.save);
    if (p.wallet !== undefined) s.wallet = p.wallet;
    if (p.xp !== undefined) s.totalXP = p.xp;
    if (p.owned) s.ownedVehicleIds = p.owned;
    if (p.equipped) s.equippedVehicleId = p.equipped;
    if (p.jobs !== undefined) s.lifetime.jobs = p.jobs;
    s.tutorial = { controlsSeen: true, firstRideDone: true, skipped: false };
    s.revision = (s.revision as number) + 1;
    st.commit(s);
  }, patch);
}
