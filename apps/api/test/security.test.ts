/**
 * Launch hardening: production config guard, sign-in codes in production and
 * brute-force limits, and cross-shop references.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { adminPasswordProblem, assertProductionConfig, loadConfig, type AppConfig } from '../src/config';
import { createPrisma } from '../src/lib/prisma';
import { ensurePlans } from '../src/seed/tenant-setup';
import { Client, createShop, loginAs } from './helpers';

const STRONG: Partial<AppConfig> = {
  isTest: false,
  isProduction: true,
  appSecret: 'f3a1c9d2b7e84d0a9c5e6b1f2a3d4c5e6f708192a3b4c5d6e7f8091a2b3c4d5e',
  publicUrl: 'https://laundry.example.com',
  cookieSecure: true,
  superAdminPassword: 'Correct-Horse-Battery-9',
  cronSecret: 'a-long-random-cron-secret-value',
  customerOtpDevCode: undefined,
};
const prod = (over: Partial<AppConfig> = {}) => ({ ...loadConfig({ isTest: true }), ...STRONG, ...over }) as AppConfig;

describe('production configuration guard', () => {
  it('accepts a properly configured deployment', () => {
    expect(() => assertProductionConfig(prod())).not.toThrow();
  });

  it.each([
    ['a short or placeholder APP_SECRET', { appSecret: 'change-me-to-a-long-random-string-1234567890' }, /APP_SECRET/],
    ['a short APP_SECRET', { appSecret: 'short' }, /APP_SECRET/],
    ['the documented default admin password', { superAdminPassword: 'ChangeMe123!' }, /SUPERADMIN_PASSWORD/],
    ['a short admin password', { superAdminPassword: 'Abc123!' }, /SUPERADMIN_PASSWORD/],
    ['the fixed customer sign-in code', { customerOtpDevCode: '123456' }, /CUSTOMER_OTP_DEV_CODE/],
    ['a short CRON_SECRET', { cronSecret: 'abc' }, /CRON_SECRET/],
    ['insecure cookies', { cookieSecure: false }, /COOKIE_SECURE/],
    ['a plain-http public address', { publicUrl: 'http://laundry.example.com' }, /PUBLIC_URL/],
  ])('refuses %s', (_name, over, message) => {
    expect(() => assertProductionConfig(prod(over as Partial<AppConfig>))).toThrow(message);
  });

  it('reports every problem at once', () => {
    expect(() => assertProductionConfig(prod({ appSecret: 'x', cookieSecure: false }))).toThrow(/APP_SECRET[\s\S]*COOKIE_SECURE/);
  });

  it('judges admin passwords', () => {
    expect(adminPasswordProblem('ChangeMe123!')).toMatch(/default/);
    expect(adminPasswordProblem('short')).toMatch(/12/);
    expect(adminPasswordProblem('Correct-Horse-Battery-9')).toBeNull();
  });
});

describe('customer sign-in codes', () => {
  let prisma: PrismaClient;
  const apps: FastifyInstance[] = [];
  let seq = 0;
  const phone = () => `+9733${String(Date.now() % 1000).padStart(3, '0')}${String(900 + seq++).padStart(4, '0')}`;
  const digits = (p: string) => p.replace('+', '');

  beforeAll(async () => {
    prisma = createPrisma();
    await ensurePlans(prisma);
  });
  afterAll(async () => {
    for (const a of apps) await a.close();
    await prisma.$disconnect();
  });

  async function appWith(over: Partial<AppConfig>) {
    const app = await buildApp(prisma, loadConfig({ isTest: true, otpPilot: undefined, ...over }));
    await app.ready();
    apps.push(app);
    return app;
  }

  /** A shop with the customer app switched on; returns its customer code. */
  async function shopCode(app: FastifyInstance) {
    const shop = await createShop(prisma);
    const owner = await loginAs(app, shop.slug, 'owner');
    const current = (await owner.get('/api/settings')).json.settings;
    const saved = await owner.put('/api/settings/preferences', { ...current, customerApp: { ...current.customerApp, enabled: true } });
    return saved.json.customerCode as string;
  }

  const otp = (app: FastifyInstance, body: object) => app.inject({ method: 'POST', url: '/api/v1/auth/otp', payload: body });
  const verify = (app: FastifyInstance, body: object) => app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: body });
  const NO_CHANNEL = { whatsapp: undefined, twilio: undefined };
  const PRODUCTION: Partial<AppConfig> = { isProduction: true, appSecret: STRONG.appSecret, publicUrl: STRONG.publicUrl, cookieSecure: true, customerOtpDevCode: undefined };

  it('in production, with no WhatsApp or SMS channel, creates no usable code and never logs one', async () => {
    const app = await appWith({ ...PRODUCTION, otpDelivery: NO_CHANNEL });
    const warn = vi.spyOn(app.log, 'warn');
    const laundryCode = await shopCode(app);
    const p = phone();
    const res = await otp(app, { phone: p, laundryCode });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('otp_unavailable');
    expect(await prisma.otpChallenge.count({ where: { phone: digits(p), consumedAt: null } })).toBe(0);
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/sign-in code for/);
  });

  it('in production, a listed pilot number still signs in with the pilot code', async () => {
    const p = phone();
    const app = await appWith({ ...PRODUCTION, otpDelivery: NO_CHANNEL, otpPilot: { numbers: new Set([digits(p)]), code: '135790' } });
    const laundryCode = await shopCode(app);
    expect((await otp(app, { phone: p, laundryCode })).statusCode).toBe(200);
    expect((await verify(app, { phone: p, laundryCode, otp: '000000' })).statusCode).toBe(400);
    expect((await verify(app, { phone: p, laundryCode, otp: '135790' })).statusCode).toBe(200);
    // Another number is not a pilot number, so it gets nothing.
    expect((await otp(app, { phone: phone(), laundryCode })).statusCode).toBe(503);
  });

  it('stores each code keyed (not as a bare hash) and lets it be used once', async () => {
    const app = await appWith({ customerOtpDevCode: '424242' });
    const laundryCode = await shopCode(app);
    const p = phone();
    expect((await otp(app, { phone: p, laundryCode })).statusCode).toBe(200);
    const row = await prisma.otpChallenge.findFirst({ where: { phone: digits(p) }, orderBy: { createdAt: 'desc' } });
    const { createHash } = await import('node:crypto');
    expect(row?.codeHash).not.toBe(createHash('sha256').update(`${digits(p)}:424242`).digest('hex'));

    expect((await verify(app, { phone: p, laundryCode, otp: '424242' })).statusCode).toBe(200);
    const again = await verify(app, { phone: p, laundryCode, otp: '424242' });
    expect(again.statusCode).toBe(400);
  });

  it('caps wrong guesses across codes, so asking for a new code does not reset the limit', async () => {
    const app = await appWith({ customerOtpDevCode: '424242' });
    const laundryCode = await shopCode(app);
    const p = phone();
    const wrong = () => verify(app, { phone: p, laundryCode, otp: '000000' });
    await otp(app, { phone: p, laundryCode });
    for (let i = 0; i < 5; i++) expect((await wrong()).statusCode).toBe(400);
    await otp(app, { phone: p, laundryCode });
    for (let i = 0; i < 5; i++) expect((await wrong()).statusCode).toBe(400);
    // Ten wrong guesses in the window: even the right code is refused now.
    await otp(app, { phone: p, laundryCode });
    const locked = await verify(app, { phone: p, laundryCode, otp: '424242' });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('rate_limited');
  });
});

describe('cross-shop references', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  beforeAll(async () => {
    prisma = createPrisma();
    await ensurePlans(prisma);
    app = await buildApp(prisma, loadConfig({ isTest: true }));
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("won't link a user to another shop's employee profile", async () => {
    const a = await createShop(prisma);
    const b = await createShop(prisma);
    const foreign = await b.db.employee.findFirstOrThrow();
    const owner: Client = await loginAs(app, a.slug, 'owner');
    const cashier = await a.db.user.findFirstOrThrow({ where: { username: 'cashier' } });

    const patch = await owner.patch(`/api/users/${cashier.id}`, { employeeId: foreign.id });
    expect(patch.status).toBe(404);

    const roles = (await owner.get('/api/settings/roles')).json.roles as { id: string; key: string }[];
    const create = await owner.post('/api/users', {
      name: 'New Person',
      username: 'newperson',
      password: 'password123',
      roleId: roles.find((r) => r.key === 'CASHIER')!.id,
      employeeId: foreign.id,
    });
    expect(create.status).toBe(404);
  });
});
