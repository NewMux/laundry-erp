import { expect, test } from '@playwright/test';

/**
 * Password reset through the real UI. The e2e server sends no email, so the link comes from the
 * platform admin's "Reset link" (the path used for owners without an email).
 */
test('an owner locked out of a new shop gets back in with a reset link', async ({ page, playwright, baseURL }) => {
  const slug = `reset${Date.now().toString(36)}`;
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL! } });

  const signup = await api.post('/api/onboarding/signup', {
    data: { shop: { name: 'Reset Shop', slug }, owner: { name: 'Reset Owner', username: 'owner', password: 'old-password-1' }, template: 'empty' },
  });
  expect(signup.ok()).toBeTruthy();

  // Ghasla support issues the link.
  const admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL! } });
  expect((await admin.post('/api/auth/login', { data: { identifier: 'admin@e2e.test', password: 'AdminPass123!' } })).ok()).toBeTruthy();
  const list = await (await admin.get(`/api/platform/tenants?q=${slug}`)).json();
  const tenant = list.tenants.find((t: { slug: string }) => t.slug === slug);
  const detail = await (await admin.get(`/api/platform/tenants/${tenant.id}`)).json();
  const link = await (await admin.post(`/api/platform/tenants/${tenant.id}/reset-owner-link`, { data: { userId: detail.tenant.owners[0].id } })).json();

  // The sign-in page offers the way in, and the forgot page always gives the same answer.
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Shop code').fill(slug);
  await page.getByLabel('Username or email').fill('owner');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('a reset link is on its way')).toBeVisible();

  // The link sets the new password, once.
  await page.goto(new URL(link.url).pathname + new URL(link.url).search);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('New password').fill('new-password-22');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();

  await page.goto(new URL(link.url).pathname + new URL(link.url).search);
  await page.getByLabel('New password').fill('another-pass-33');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('invalid or has expired')).toBeVisible();

  // Old password is dead, new one works.
  await page.goto('/login');
  await page.getByLabel('Shop code').fill(slug);
  await page.getByLabel('Username or email').fill('owner');
  await page.getByLabel('Password').fill('old-password-1');
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await expect(page.getByText('Incorrect sign-in details')).toBeVisible();
  await page.getByLabel('Password').fill('new-password-22');
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await expect(page.getByRole('button', { name: 'Alerts' })).toBeVisible();
});

test('the signup page works with the bot check off', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByRole('button', { name: 'Create my laundry' })).toBeEnabled();
});
