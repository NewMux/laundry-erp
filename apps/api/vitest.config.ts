import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

function chromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const dirs = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-'));
    for (const d of dirs) {
      const p = `/opt/pw-browsers/${d}/chrome-linux/chrome`;
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* not in the dev container */
  }
  return undefined;
}

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://laundry:laundry@localhost:5432/laundry_test',
      APP_SECRET: 'test-secret-test-secret-test-secret',
      PUBLIC_URL: 'http://localhost:3000',
      UPLOAD_DIR: '/tmp/laundry-test-uploads',
      ...(chromium() ? { CHROMIUM_PATH: chromium()! } : {}),
    },
  },
});
