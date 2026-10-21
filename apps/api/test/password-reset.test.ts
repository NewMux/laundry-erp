/**
 * Password reset: an emailed link for accounts with an email, a hand-delivered
 * link for owners without one. `fetch` is faked, so no email leaves the machine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { parseMail, sendMail } from '../src/lib/mail';
import { createResetToken } from '../src/lib/password-reset';
import { createPrisma } from '../src/lib/prisma';
import { ensurePlans, ensureSuperAdmin } from '../src/seed/tenant-setup';
import { Client, createShop, loginAs } from './helpers';

let app: FastifyInstance;
let noMail: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrisma();
  await ensurePlans(prisma);
  await ensureSuperAdmin(prisma, 'admin@newmux.test', 'AdminPass123!');
  app = await buildApp(prisma, loadConfig({ isTest: true, mail: { apiKey: 're_test', from: 'Ghassla <no-reply@newmux.test>' } }));
  await app.ready();
  noMail = await buildApp(prisma, loadConfig({ isTest: true, mail: undefined }));
  await noMail.ready();
});
afterAll(async () => {
  await app.close();
  await noMail.close();
  await prisma.$disconnect();
});
afterEach(() => vi.unstubAllGlobals());

interface Sent { to: string[]; subject: string; text: string }
function fakeMail(status = 200) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response('{}', { status });
    }),
  );
  return sent;
}
const tokenIn = (m: Sent) => new URL(m.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
const post = async (a: FastifyInstance, url: string, payload: object) => {
  const res = await a.inject({ method: 'POST', url, payload });
  return { status: res.statusCode, json: res.json() };
};

describe('mail', () => {
  it('needs both settings', () => {
    expect(parseMail('k', 'f')).toEqual({ apiKey: 'k', from: 'f' });
    expect(parseMail('k', undefined)).toBeUndefined();
    expect(parseMail(undefined, 'f')).toBeUndefined();
  });
  it('posts to Resend with the key, and throws when it refuses', async () => {
    const sent = fakeMail();
    await sendMail({ apiKey: 're_x', from: 'a@b.test' }, { to: 'c@d.test', subject: 'S', text: 'T' });
    expect(sent[0]).toEqual({ from: 'a@b.test', to: ['c@d.test'], subject: 'S', text: 'T' });
    fakeMail(422);
    await expect(sendMail({ apiKey: 're_x', from: 'a@b.test' }, { to: 'c@d.test', subject: 'S', text: 'T' })).rejects.toThrow(/422/);
  });
});

describe('forgot and reset by email', () => {
  it('emails a link that sets a new password once, and signs the old one out', async () => {
    const shop = await createShop(prisma);
    const owner = await loginAs(app, shop.slug, 'owner'); // a live session that must die
    const sent = fakeMail();

    const asked = await post(app, '/api/auth/forgot-password', { shopCode: shop.slug, identifier: 'owner' });
    expect(asked).toEqual({ status: 200, json: { ok: true } });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([`owner@${shop.slug}.test`]);
    const token = tokenIn(sent[0]);

    expect((await post(app, '/api/auth/reset-password', { token, password: 'short' })).status).toBe(400);
    const done = await post(app, '/api/auth/reset-password', { token, password: 'brand-new-pass-1' });
    expect(done.status, JSON.stringify(done.json)).toBe(200);

    // The old password and the old session are gone; the new password works.
    expect((await owner.get('/api/auth/me')).json.user).toBeNull();
    await expect(new Client(app).login(shop.slug, 'owner', 'password123')).rejects.toThrow(/401/);
    await new Client(app).login(shop.slug, 'owner', 'brand-new-pass-1');

    // The link is spent.
    const again = await post(app, '/api/auth/reset-password', { token, password: 'another-pass-22' });
    expect(again.status).toBe(400);
    expect(again.json.error.code).toBe('INVALID_RESET');
  });

  it('also works from the email address alone', async () => {
    const shop = await createShop(prisma);
    const sent = fakeMail();
    await post(app, '/api/auth/forgot-password', { identifier: `owner@${shop.slug}.test` });
    expect(sent).toHaveLength(1);
  });

  it('clears a lockout', async () => {
    const shop = await createShop(prisma);
    for (let i = 0; i < 5; i++) await post(app, '/api/auth/login', { shopCode: shop.slug, identifier: 'owner', password: 'wrong-wrong' });
    expect((await post(app, '/api/auth/login', { shopCode: shop.slug, identifier: 'owner', password: 'password123' })).status).toBe(423);
    const sent = fakeMail();
    await post(app, '/api/auth/forgot-password', { shopCode: shop.slug, identifier: 'owner' });
    await post(app, '/api/auth/reset-password', { token: tokenIn(sent[0]), password: 'brand-new-pass-1' });
    await new Client(app).login(shop.slug, 'owner', 'brand-new-pass-1');
  });

  it('answers the same for unknown accounts and sends nothing', async () => {
    const shop = await createShop(prisma);
    const sent = fakeMail();
    const known = await post(app, '/api/auth/forgot-password', { shopCode: shop.slug, identifier: 'owner' });
    const unknownUser = await post(app, '/api/auth/forgot-password', { shopCode: shop.slug, identifier: 'nobody' });
    const unknownShop = await post(app, '/api/auth/forgot-password', { shopCode: 'no-such-shop-xyz', identifier: 'owner' });
    const unknownEmail = await post(app, '/api/auth/forgot-password', { identifier: 'nobody@nowhere.test' });
    for (const r of [unknownUser, unknownShop, unknownEmail]) expect(r).toEqual(known);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing to a user with no email, or when mail is off', async () => {
    const shop = await createShop(prisma);
    const sent = fakeMail();
    // The seeded manager has no email.
    expect((await post(app, '/api/auth/forgot-password', { shopCode: shop.slug, identifier: 'manager' })).status).toBe(200);
    expect((await post(noMail, '/api/auth/forgot-password', { shopCode: shop.slug, identifier: 'owner' })).status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('limits how many emails one account gets in an hour', async () => {
    const shop = await createShop(prisma);
    const sent = fakeMail();
    for (let i = 0; i < 6; i++) await post(app, '/api/auth/forgot-password', { shopCode: shop.slug, identifier: 'owner' });
    expect(sent).toHaveLength(3);
  });

  it('does not keep a link nobody received when the email fails', async () => {
    const shop = await createShop(prisma);
    fakeMail(500);
    const r = await post(app, '/api/auth/forgot-password', { shopCode: shop.slug, identifier: 'owner' });
    expect(r.status).toBe(200);
    const owner = await prisma.user.findFirst({ where: { tenantId: shop.tenant.id, username: 'owner' } });
    expect(await prisma.passwordResetToken.count({ where: { userId: owner!.id } })).toBe(0);
  });

  it('rejects an expired link and a made-up one', async () => {
    const shop = await createShop(prisma);
    const owner = await prisma.user.findFirst({ where: { tenantId: shop.tenant.id, username: 'owner' } });
    const { token } = await createResetToken(prisma, owner!.id, -1);
    expect((await post(app, '/api/auth/reset-password', { token, password: 'brand-new-pass-1' })).json.error.code).toBe('INVALID_RESET');
    expect((await post(app, '/api/auth/reset-password', { token: 'x'.repeat(43), password: 'brand-new-pass-1' })).json.error.code).toBe('INVALID_RESET');
  });

  it('lets only one of two simultaneous requests use a link', async () => {
    const shop = await createShop(prisma);
    const owner = await prisma.user.findFirst({ where: { tenantId: shop.tenant.id, username: 'owner' } });
    const { token } = await createResetToken(prisma, owner!.id, 30);
    const results = await Promise.all([1, 2, 3].map((n) => post(app, '/api/auth/reset-password', { token, password: `race-password-${n}` })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe('platform admin reset link', () => {
  async function admin() {
    return new Client(app).login(null, 'admin@newmux.test', 'AdminPass123!');
  }

  it('issues a one-time link for a shop owner who has no email path', async () => {
    const shop = await createShop(prisma);
    const a = await admin();
    const owner = await prisma.user.findFirst({ where: { tenantId: shop.tenant.id, username: 'owner' } });
    const r = await a.post(`/api/platform/tenants/${shop.tenant.id}/reset-owner-link`, { userId: owner!.id });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.owner.username).toBe('owner');
    const token = new URL(r.json.url).searchParams.get('token')!;
    expect((await post(app, '/api/auth/reset-password', { token, password: 'brand-new-pass-1' })).status).toBe(200);
    await new Client(app).login(shop.slug, 'owner', 'brand-new-pass-1');
    // The issue is recorded in the shop's audit log.
    expect(await prisma.auditLog.count({ where: { tenantId: shop.tenant.id, action: 'platform.owner_reset_link' } })).toBe(1);
  });

  it('refuses non-owners, other shops\' owners, and anyone but the platform admin', async () => {
    const a = await createShop(prisma);
    const b = await createShop(prisma);
    const admin_ = await admin();
    const manager = await prisma.user.findFirst({ where: { tenantId: a.tenant.id, username: 'manager' } });
    const ownerB = await prisma.user.findFirst({ where: { tenantId: b.tenant.id, username: 'owner' } });
    expect((await admin_.post(`/api/platform/tenants/${a.tenant.id}/reset-owner-link`, { userId: manager!.id })).status).toBe(404);
    expect((await admin_.post(`/api/platform/tenants/${a.tenant.id}/reset-owner-link`, { userId: ownerB!.id })).status).toBe(404);
    const shopOwner = await loginAs(app, a.slug, 'owner');
    const ownerA = await prisma.user.findFirst({ where: { tenantId: a.tenant.id, username: 'owner' } });
    expect((await shopOwner.post(`/api/platform/tenants/${a.tenant.id}/reset-owner-link`, { userId: ownerA!.id })).status).toBe(403);
    expect((await new Client(app).post(`/api/platform/tenants/${a.tenant.id}/reset-owner-link`, { userId: ownerA!.id })).status).toBe(401);
  });
});
