import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config — Phase 14.
 *
 * Tests live under `tests/e2e/` and target a Next.js dev server on
 * `http://localhost:3000`. Locally they assume a `.env.local` with real
 * Supabase creds; the seed must already be applied (cf. DEPLOY.md).
 *
 * Run:
 *   pnpm test:e2e               # headless
 *   pnpm test:e2e:ui            # interactive UI mode
 *   npx playwright test --debug # step-through
 *
 * First-time setup (per dev machine):
 *   npx playwright install chromium
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // No retries locally so we see real flakiness; CI retries once to ride out
  // network blips.
  retries: process.env.CI ? 1 : 0,
  // CI runs single worker so the dev server isn't slammed; locally Playwright
  // picks workers based on CPU count.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
  },

  // Chromium only for V1 — covers ~70% of real Quebec users and keeps CI fast.
  // Firefox / WebKit can be added when we hit a Safari-only bug.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Boot the Next.js dev server before tests if one isn't already running.
  // `reuseExistingServer` is true locally so iteration is fast (you keep
  // `pnpm dev` open in a side terminal).
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
