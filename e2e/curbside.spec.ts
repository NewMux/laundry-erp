import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createPrisma } from '../apps/api/src/lib/prisma';

/** "I'm outside": a customer waiting in their car shows on every page, under App orders → Outside and on the order. */

const { slug } = JSON.parse(fs.readFileSync(path.join(__dirname, '.state.json'), 'utf8')) as { slug: string };
const PASSWORD = 'demo1234';

test('a customer waiting outside shows in a banner, the Outside tab and on the order', async ({ page }) => {
  // What the app's "I'm outside" leaves on a ready order.
  const prisma = createPrisma(process.env.E2E_DATABASE_URL ?? 'postgresql://laundry:laundry@localhost:5432/laundry_e2e');
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug } });
  const customer = await prisma.customer.findFirstOrThrow({ where: { tenantId: tenant.id } });
  const order = await prisma.order.create({
    data: { tenantId: tenant.id, orderNo: 9901, customerId: customer.id, status: 'READY', readyAt: new Date(), outbound: 'COLLECT', curbsidePlate: '45 123', curbsideAt: new Date() },
  });
  await prisma.$disconnect();

  await page.goto('/login');
  await page.getByLabel('Shop code').fill(slug);
  await page.getByLabel('Username or email').fill('owner');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  const banner = page.getByRole('link', { name: /Customer outside: #9901 · car 45 123/ });
  await expect(banner).toBeVisible();
  await page.screenshot({ path: 'test-results/curbside-banner.png' });

  await banner.click();
  await expect(page).toHaveURL(/\/orders\/app\?view=outside/);
  await expect(page.getByRole('tab', { name: /Outside/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('45 123', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/curbside-outside-tab.png' });

  await page.getByRole('link', { name: 'Hand over' }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}`));
  await expect(page.getByText(/The customer is waiting outside in car 45 123/)).toBeVisible();
  await page.screenshot({ path: 'test-results/curbside-order.png' });
});
