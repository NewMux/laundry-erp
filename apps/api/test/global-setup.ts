import { execSync } from 'node:child_process';

/**
 * Bring the test database up to the current migrations (non-destructive).
 * Tests never rely on an empty database: each one creates its own shop.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://laundry:laundry@localhost:5432/laundry_test';
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
