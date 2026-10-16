/**
 * Launch hardening: production config guard, customer sign-in code delivery and
 * brute-force limits, and cross-shop references.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

  beforeAll(async () => {
    prisma = createPrisma();
    await ensurePlans(prisma);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    for (const a of apps) await a.close();
    await prisma.$disconnect();
  });

  async function appWith(over: Partial<AppConfig>) {
    const app = await buildApp(prisma, loadConfig({ isTest: true, ...over }));
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

  it('fails closed in production when no SMS provider is configured', async () => {
    const app = await appWith({ isProduction: true, sms: undefined, customerOtpDevCode: undefined, appSecret: STRONG.appSecret, publicUrl: STRONG.publicUrl, cookieSecure: true });
    const laundryCode = await shopCode(app);
    const res = await otp(app, { phone: phone(), laundryCode });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('not_available');
  });

  it('texts the code through the SMS provider and signs in with it, never logging it', async () => {
    const sent: { to: string; body: string; auth: string }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: URLSearchParams; headers: Record<string, string> }) => {
      sent.push({ to: init.body.get('To')!, body: init.body.get('Body')!, auth: init.headers.Authorization });
      return new Response('{}', { status: 201 });
    });
    const app = await appWith({ sms: { accountSid: 'ACtest', authToken: 'tok', from: '+15550001111' }, customerOtpDevCode: undefined });
    const warn = vi.spyOn(app.log, 'warn');
    const laundryCode = await shopCode(app);
    const p = phone();
    expect((await otp(app, { phone: p, laundryCode })).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(`+${p.replace('+', '')}`);
    expect(sent[0].auth).toBe(`Basic ${Buffer.from('ACtest:tok').toString('base64')}`);
    const code = sent[0].body.match(/\b(\d{6})\b/)![1];
    expect(warn.mock.calls.flat().join(' ')).not.toContain(code);

    expect((await verify(app, { phone: p, laundryCode, otp: code })).statusCode).toBe(200);
    // The code is single-use.
    const again = await verify(app, { phone: p, laundryCode, otp: code });
    expect(again.statusCode).toBe(400);
    // And it is stored keyed, not as a bare hash of phone:code.
    const row = await prisma.otpChallenge.findFirst({ where: { phone: p.replace('+', '') }, orderBy: { createdAt: 'desc' } });
    const { createHash } = await import('node:crypto');
    expect(row?.codeHash).not.toBe(createHash('sha256').update(`${p.replace('+', '')}:${code}`).digest('hex'));
  });

  it('does not keep a live code when the SMS could not be sent', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    const app = await appWith({ sms: { accountSid: 'ACtest', authToken: 'tok', from: '+15550001111' }, customerOtpDevCode: undefined });
    const laundryCode = await shopCode(app);
    const p = phone();
    const res = await otp(app, { phone: p, laundryCode });
    expect(res.statusCode).toBe(503);
    expect(await prisma.otpChallenge.count({ where: { phone: p.replace('+', '') } })).toBe(0);
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
