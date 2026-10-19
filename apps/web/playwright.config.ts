import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Carrega o .env da raiz (credenciais do seed) sem dependências extras.
const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '../../.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm --filter @azhoot/api dev',
          url: 'http://localhost:3333/health/ready',
          reuseExistingServer: true,
          timeout: 60_000,
          cwd: resolve(here, '../..'),
        },
        {
          command: 'pnpm --filter @azhoot/web dev',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 60_000,
          cwd: resolve(here, '../..'),
        },
      ],
});
