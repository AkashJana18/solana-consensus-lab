import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    // GA4 is baked in at build time, so the e2e run needs an id to exercise. This is a
    // placeholder, never the real property: the tag requests are stubbed in the specs and no
    // page view from CI can reach GA. `reuseExistingServer` means a dev server already running
    // without it would win, which is why the specs assert "not installed" rather than
    // assuming either way.
    env: { VITE_GA_ID: process.env.VITE_GA_ID ?? 'G-TESTID0000' },
  },
});
