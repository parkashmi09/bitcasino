import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the whole seam, in a real browser, against the real platform.
 *
 * `npm test` (vitest) covers the adapters, the token store's single-flight
 * refresh, the socket wrapper, the rate-limit rules and the error boundary —
 * everything, that is, with the transport mocked out. What none of it can
 * catch is the class of failure that only exists when all five processes are
 * running: a CORS header that refuses the browser, a proxy that drops the
 * websocket upgrade, a cookie that never lands, a token that refreshes into a
 * 401, a socket that stays anonymous after sign-in so every `player` event is
 * silently refused.
 *
 * Those are exactly the bugs this project has actually hit — see the
 * `ONLINE_LOGGED` rebinding note in `lib/socket.js` and the two StrictMode
 * defects in Phase 3. Each one presents as a screen that renders perfectly
 * and does nothing.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * IT NEEDS THE PLATFORM UP, AND IT REFUSES TO RUN RATHER THAN PRETEND.
 *
 *     cd backend && npm run db:migrate && npm run db:seed:demo
 *     cd backend && npm run dev:test user admin casino gateway
 *     cd apps/web && npm run test:e2e
 *
 * `dev:test`, not `dev` — it sets `RATE_LIMIT_ENABLED=false`. The
 * registration limiter is 20 an hour per IP, and every run of this suite
 * creates an account, so against `dev` the suite passes locally and then
 * fails on the twenty-first run of the day with a 429 that looks like a
 * product bug.
 *
 * `globalSetup` below probes the gateway first and fails with that command
 * block rather than letting twelve specs time out one at a time against a
 * closed port. A suite that is red for an infrastructure reason should say so
 * in one line, at the top.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Where the app under test is served. Vite's own default. */
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.js',

  /**
   * Serial, and one worker.
   *
   * These specs register accounts, move a real balance and play real rounds
   * against ONE shared platform with one database. Parallel workers would
   * interleave those writes, and a balance assertion is not reproducible when
   * another worker is spending from a different account on the same house
   * float. The suite is small; correctness is worth more than the minute.
   */
  fullyParallel: false,
  workers: 1,

  /* No retries. A flaky e2e that passes on the second attempt hides exactly
     the intermittent transport failure this suite exists to find. */
  retries: 0,

  /** Generous: a cold Vite dev server compiles on the first navigation. */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    /* On failure only — a trace per passing test is hundreds of megabytes and
       nobody opens them. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Vite is started for us, but the PLATFORM is not.
   *
   * Starting the front end is one command with no state; starting the backend
   * is five processes, a migrated database and a seeded catalogue, and doing
   * that from here would mean this config silently owning the platform's
   * lifecycle — including tearing down a database somebody was using. The
   * probe in `global-setup.js` is the honest division: we start what is ours
   * and we check for what is not.
   */
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
