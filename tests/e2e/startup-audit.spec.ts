import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('records cold startup transfer and menu readiness', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('play')).toBeVisible({ timeout: 90000 });
  const report = await page.evaluate(() => ({
    menuMs: performance.now(),
    resources: performance.getEntriesByType('resource').map(e => {
      const r = e as PerformanceResourceTiming;
      return { name: new URL(r.name).pathname.split('/').pop(), bytes: r.encodedBodySize, ms: Math.round(r.duration) };
    }),
  }));
  await writeFile(`test-results/startup-${process.env.AUDIT_LABEL ?? 'current'}.json`, JSON.stringify(report, null, 2));
  expect(report.resources.filter(r => r.name?.endsWith('.glb'))).toEqual([]);
  expect(report.resources.filter(r => r.name?.startsWith('WorldScene-'))).toEqual([]);
  expect(errors).toEqual([]);
});
