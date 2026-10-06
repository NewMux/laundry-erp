import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end checks of the PRD acceptance criteria through the real UI.
 * Starts the API (own database) and the web app, seeds a fresh demo shop.
 *   npm run test:e2e
 */
const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://laundry:laundry@localhost:5432/laundry_e2e';
const API_PORT = 3100;
const WEB_PORT = 5180;

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: [
    {
      command: 'npx prisma migrate deploy && npx tsx src/index.ts',
      cwd: '../apps/api',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: DB,
        PORT: String(API_PORT),
        APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
        PUBLIC_URL: `http://localhost:${WEB_PORT}`,
        UPLOAD_DIR: '/tmp/laundry-e2e-uploads',
        SUPERADMIN_EMAIL: 'admin@e2e.test',
        SUPERADMIN_PASSWORD: 'AdminPass123!',
        ...(process.env.CHROMIUM_PATH ? { CHROMIUM_PATH: process.env.CHROMIUM_PATH } : {}),
      },
    },
    {
      command: 'npx vite',
      cwd: '../apps/web',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_URL: `http://localhost:${API_PORT}`, WEB_PORT: String(WEB_PORT) },
    },
  ],
});
