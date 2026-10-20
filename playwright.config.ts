import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke suite (issue #390): the built dist/ served statically, a
 * local mock MCP server, Chromium only. `npm run build` first, then
 * `npm run test:e2e`. Set CHROME_PATH to use a system Chromium instead of the
 * Playwright-managed one.
 */

export const APP_PORT = Number(process.env.E2E_APP_PORT) || 4173;
export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT) || 4180;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Each worker runs its own Chromium; two keep within small runners and containers.
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // The whole suite must stay well under five minutes.
  globalTimeout: 5 * 60_000,
  reporter: isCI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    screenshot: 'off',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CHROME_PATH
          ? { launchOptions: { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: `node tests/e2e/static-server.mjs --dist dist --port ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/`,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      command: `node tests/e2e/mock-mcp-server.mjs --port ${MOCK_PORT}`,
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
  ],
});
