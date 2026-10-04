import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:3017',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:3017',
    browserName: 'chromium',
    channel: 'msedge',
    trace: 'retain-on-failure',
  },
  reporter: 'line',
});
