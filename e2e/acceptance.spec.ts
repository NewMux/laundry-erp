import fs from 'node:fs';
import path from 'node:path';
import { devices, expect, test, type Page } from '@playwright/test';

/** PRD §6 acceptance criteria, driven through the real UI. */

const { slug } = JSON.parse(fs.readFileSync(path.join(__dirname, '.state.json'), 'utf8')) as { slug: string };
const PASSWORD = 'demo1234';

/** Record every document the app sends to the printer (receipt / tags). */
async function capturePrints(page: Page) {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    (window as unknown as { __printed: string[] }).__printed = [];
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes)
          if (n instanceof HTMLIFrameElement && n.dataset.print) (window as unknown as { __printed: string[] }).__printed.push(n.srcdoc);
    }).observe(document, { childList: true, subtree: true });
  });
}
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Shop code').fill(slug);
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await expect(page.getByRole('button', { name: 'Alerts' })).toBeVisible();
}

test('AC1 — 7-item order with the picture grid, receipt and 7 tags printed in under 60 seconds', async ({ page }) => {
  await capturePrints(page);
  await login(page, 'cashier');
  await page.goto('/pos');
  const started = Date.now();
  await page.getByLabel('Customer mobile').fill('33112233');
  await page.getByLabel('Customer mobile').press('Enter');
  await expect(page.getByRole('button', { name: 'Change' })).toBeVisible();
  await expect(page.getByText('Ahmed Al-Khalifa')).toBeVisible();
  // Pick by picture only: 3 thobes, 2 ghutras, 1 shirt, 1 trousers.
  for (const item of ['Thobe', 'Thobe', 'Thobe', 'Ghutra', 'Ghutra', 'Shirt', 'Trousers']) {
    await page.getByRole('button', { name: new RegExp(`^${item}`) }).first().click();
  }
  await expect(page.getByText('7 pieces').first()).toBeVisible();
  await page.getByRole('button', { name: /^Pay/ }).click();
  await page.getByRole('button', { name: /^Cash/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Order received')).toBeVisible();
  const orderNo = (await page.locator('text=/^#\\d+$/').first().textContent())!.slice(1);
  await expect.poll(async () => (await printed(page)).length).toBeGreaterThanOrEqual(2);
  const elapsed = (Date.now() - started) / 1000;
  expect(elapsed).toBeLessThan(60);

  const docs = await printed(page);
  const receipt = docs.find((d) => d.includes('TAX INVOICE'))!;
  expect(receipt).toContain(`#${orderNo}`);
  expect(receipt).toContain('Ahmed Al-Khalifa');
  const tags = docs.find((d) => d.includes('class="tag"'))!;
  expect(tags.match(/class="tag"/g)).toHaveLength(7);
  expect(tags).toContain('7/7');
});

test('AC2 — a worker scans a tag from a phone and the order moves to the next status', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await login(page, 'worker');
  await expect(page).toHaveURL(/\/scan$/);
  // Order #1001 of the demo shop is "Received"; its first tag is 1001-1.
  await page.getByPlaceholder('Type or scan a code').fill('1001-1');
  await page.getByPlaceholder('Type or scan a code').press('Enter');
  await expect(page.getByText('Moved to')).toBeVisible();
  await expect(page.getByText('In process', { exact: true })).toBeVisible();
  // No prices for workers.
  await page.getByRole('link', { name: '#1001' }).click();
  await expect(page.getByText('Move to next step')).toBeVisible();
  await expect(page.getByText('Total', { exact: true })).toHaveCount(0);
  await ctx.close();
});

test('AC3 — BHD 20 → 25 package top-up, order paid from balance, receipt shows remaining balance', async ({ page }) => {
  await capturePrints(page);
  await login(page, 'cashier');
  await page.goto('/pos');
  await page.getByLabel('Customer mobile').fill('33998877');
  await page.getByLabel('Customer mobile').press('Enter');
  await expect(page.getByRole('button', { name: 'Change' })).toBeVisible();
  await expect(page.getByText('John Smith')).toBeVisible();
  // Top up from the customer page.
  await page.goto('/customers');
  await page.getByText('John Smith').click();
  await page.getByRole('button', { name: 'Top up' }).click();
  await page.getByRole('button', { name: /Pay BHD 20, get BHD 25/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Top up' }).click();
  await expect(page.getByText('Balance topped up')).toBeVisible();
  await expect.poll(async () => (await printed(page)).some((d) => d.includes('BALANCE TOP-UP RECEIPT'))).toBe(true);
  await expect(page.getByText('25.000').first()).toBeVisible();

  await page.goto('/pos');
  await page.getByLabel('Customer mobile').fill('33998877');
  await page.getByLabel('Customer mobile').press('Enter');
  await expect(page.getByRole('button', { name: 'Change' })).toBeVisible();
  await page.getByRole('button', { name: /^Thobe/ }).first().click();
  await page.getByRole('button', { name: /^Thobe/ }).first().click();
  await page.getByRole('button', { name: /^Pay/ }).click();
  await page.getByRole('button', { name: /Customer balance/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Order received')).toBeVisible();
  await expect.poll(async () => (await printed(page)).some((d) => d.includes('Remaining prepaid balance'))).toBe(true);
  const receipt = (await printed(page)).find((d) => d.includes('Remaining prepaid balance'))!;
  // 2 thobes W&I = 0.800 + VAT 0.080 = 0.880 → 25.000 − 0.880 = 24.120
  expect(receipt).toContain('24.120');
});

test('AC8 — a cashier cannot open reports or cancel a paid invoice', async ({ page }) => {
  await login(page, 'cashier');
  await page.goto('/reports/profit-loss');
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await page.goto('/orders');
  await page.locator('table').getByRole('link', { name: '#1003' }).click();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
});

for (const device of ['iPhone 13', 'Pixel 7'] as const) {
  test(`AC9 — owner dashboard works fully on ${device}`, async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices[device] });
    const page = await ctx.newPage();
    await login(page, 'owner');
    await page.goto('/dashboard');
    await expect(page.getByText('Orders received')).toBeVisible();
    await expect(page.getByText('Profit this month')).toBeVisible();
    await expect(page.locator('svg[role=img]')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Navigation works from the phone menu.
    await page.locator('nav').getByRole('button', { name: 'More' }).click();
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page.getByText('Profit & Loss')).toBeVisible();
    await ctx.close();
  });
}
