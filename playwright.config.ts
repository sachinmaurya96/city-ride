import { defineConfig } from '@playwright/test';

// Browser flow tests run against a dedicated e2e build (VITE_E2E=1 exposes test hooks);
// release builds never include them. SwiftShader is software WebGL: it proves flows, not device performance.
const PORT = 4180;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45 * 60 * 1000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? `http://localhost:${PORT}/`,
    viewport: { width: 667, height: 375 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: process.env.E2E_URL
    ? undefined
    : {
        command: `npm run build:e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
        port: PORT,
        reuseExistingServer: true,
        timeout: 180000,
      },
});
