import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/** An owner sets up an item package covering two garments: 10 thobes + 5 shirts. */

const { slug } = JSON.parse(fs.readFileSync(path.join(__dirname, '.state.json'), 'utf8')) as { slug: string };

test('an owner sets up a package covering several garments', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Shop code').fill(slug);
  await page.getByLabel('Username or email').fill('owner');
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  await page.goto('/settings/packages');
  await page.getByRole('button', { name: 'New package' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Name').fill('Family 10 + 5');
  await modal.getByLabel('Type').selectOption('ITEMS');
  await modal.getByLabel('Customer pays').fill('6');
  await modal.getByLabel('Number of items').fill('10');
  await modal.getByLabel('Items', { exact: true }).selectOption({ label: 'Thobe' });
  await modal.getByLabel('Services').selectOption({ label: 'Wash & Iron' });
  await modal.getByRole('button', { name: 'Add another item' }).click();
  await modal.getByLabel('Number of items').nth(1).fill('5');
  await modal.getByLabel('Items', { exact: true }).nth(1).selectOption({ label: 'Shirt' });
  await modal.getByLabel('Services').nth(1).selectOption({ label: 'Wash & Iron' });
  await page.screenshot({ path: 'test-results/package-mixed-editor.png' });
  await modal.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('10 × Thobe · Wash & Iron + 5 × Shirt · Wash & Iron')).toBeVisible();
  await page.screenshot({ path: 'test-results/package-mixed-list.png' });
});
