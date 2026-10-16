import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
// No container de desenvolvimento há um Chromium pré-instalado; no CI, o Playwright instala o seu.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export const E2E_ENV = {
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/lastfinance_e2e',
  APP_URL: BASE,
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  SETUP_TOKEN: 'e2e-setup-token-123456',
  PLUGGY_FAKE: 'true',
  PLUGGY_WEBHOOK_SECRET: 'e2e-webhook-secret-0123456789abcdef',
  JOBS_MODE: 'inline',
  CRON_SECRET: 'e2e-cron-secret-123456',
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'android',
      use: { ...devices['Pixel 7'], launchOptions: executablePath ? { executablePath } : {} },
      testMatch: /mobile\.spec\.ts/,
      dependencies: ['desktop'],
    },
  ],
  webServer: {
    command: `pnpm tsx tests/e2e/reset-db.ts && pnpm tsx scripts/migrate.ts && pnpm next start -p ${PORT}`,
    url: `${BASE}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: E2E_ENV,
  },
});
