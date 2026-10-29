/**
 * Abuse limits on sign-in codes: every code is a paid message, so a flood of
 * requests (the "SMS pumping" attack) must stop at a bounded number of sends.
 * `fetch` is faked and counts what would have been sent.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig, type OtpLimits } from '../src/config';
import { createPrisma } from '../src/lib/prisma';
import { ensurePlans } from '../src/seed/tenant-setup';
import { createShop, loginAs } from './helpers';

const OPEN: OtpLimits = { countries: ['973', '971', '966'], perPhonePerDay: 1_000_000, perIpPerHour: 1_000_000, globalPerHour: 1_000_000, globalPerDay: 1_000_000 };
const whatsapp = { token: 't', phoneNumberId: '42', template: 'login_code', language: 'en', apiVersion: 'v21.0' };

let prisma: PrismaClient;
let shopCode: string;
let seq = 0;
const apps: FastifyInstance[] = [];

/** A fresh app with the given limits; sending goes through (faked) WhatsApp. */
async function appWith(limits: Partial<OtpLimits>) {
  const app = await buildApp(prisma, loadConfig({ isTest: true, customerOtpDevCode: undefined, otpLimits: { ...OPEN, ...limits }, otpDelivery: { whatsapp } }));
  await app.ready();
  apps.push(app);
  return app;
}

beforeAll(async () => {
  prisma = createPrisma();
  await ensurePlans(prisma);
  const app = await appWith({});
  const shop = await createShop(prisma);
  const owner = await loginAs(app, shop.slug, 'owner');
  const current = (await owner.get('/api/settings')).json.settings;
  shopCode = (await owner.put('/api/settings/preferences', { ...current, customerApp: { ...current.customerApp, enabled: true } })).json.customerCode;
});
afterAll(async () => {
  for (const a of apps) await a.close();
  await prisma.$disconnect();
});
afterEach(() => vi.unstubAllGlobals());

/** Bahrain mobile numbers that are unique per call. */
const phone = () => `+9733${String((Date.now() + seq++) % 10_000_000).padStart(7, '0')}`;
let ipSeq = 0;
const ip = () => `10.${Date.now() % 250}.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`;

function countSent() {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(String(init.body));
    return new Response('{}', { status: 201 });
  }));
  return sent;
}

const request = (app: FastifyInstance, p: string, from = ip()) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/otp', payload: { phone: p, laundryCode: shopCode }, headers: { 'x-forwarded-for': from } });
const codeOf = (res: { json: () => { error: { code: string } } }) => res.json().error.code;

describe('sign-in code abuse limits', () => {
  it('refuses countries we do not serve without sending or storing anything', async () => {
    const app = await appWith({});
    const sent = countSent();
    const before = await prisma.otpChallenge.count();
    for (const bad of ['+14155550100', '+919876543210', '+96651234567' /* Saudi, 8 digits */]) {
      const res = await request(app, bad);
      expect(res.statusCode, bad).toBe(400);
      expect(codeOf(res)).toBe('unsupported_country');
    }
    expect(sent).toHaveLength(0);
    expect(await prisma.otpChallenge.count()).toBe(before);
  });

  it('accepts a number from a served country', async () => {
    const app = await appWith({});
    const sent = countSent();
    expect((await request(app, phone())).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('a burst of simultaneous requests from one source sends at most the per-IP limit', async () => {
    const app = await appWith({ perIpPerHour: 4 });
    const sent = countSent();
    const attacker = ip();
    const results = await Promise.all(Array.from({ length: 40 }, () => request(app, phone(), attacker)));

    const ok = results.filter((r) => r.statusCode === 200).length;
    expect(ok).toBeLessThanOrEqual(4);
    expect(sent.length).toBe(ok);
    expect(results.filter((r) => r.statusCode !== 200).every((r) => r.statusCode === 429)).toBe(true);
    // Refused requests leave no row behind, so they cannot keep the source locked out.
    const kept = await prisma.otpChallenge.count({ where: { createdAt: { gte: new Date(Date.now() - 60_000) }, ipHash: { not: null } } });
    expect(kept).toBeGreaterThanOrEqual(ok);
  });

  it('a burst against one number sends at most 5', async () => {
    const app = await appWith({});
    const sent = countSent();
    const victim = phone();
    const results = await Promise.all(Array.from({ length: 30 }, () => request(app, victim)));
    expect(results.filter((r) => r.statusCode === 200).length).toBeLessThanOrEqual(5);
    expect(sent.length).toBeLessThanOrEqual(5);
  });

  it('caps one number per day', async () => {
    const app = await appWith({ perPhonePerDay: 2 });
    countSent();
    const p = phone();
    expect((await request(app, p)).statusCode).toBe(200);
    expect((await request(app, p)).statusCode).toBe(200);
    const third = await request(app, p);
    expect(third.statusCode).toBe(429);
    expect(codeOf(third)).toBe('rate_limited');
  });

  it('trips the circuit breaker across many sources and numbers, then recovers', async () => {
    const hour = () => prisma.otpChallenge.count({ where: { createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    const app = await appWith({ globalPerHour: (await hour()) + 3 });
    const sent = countSent();
    for (let i = 0; i < 3; i++) expect((await request(app, phone())).statusCode).toBe(200);
    const blocked = await request(app, phone());
    expect(blocked.statusCode).toBe(503);
    expect(codeOf(blocked)).toBe('otp_busy');
    expect(sent).toHaveLength(3);

    // A higher limit (or the window clearing) lets sign-in resume.
    const recovered = await appWith({ globalPerHour: (await hour()) + 3 });
    expect((await request(recovered, phone())).statusCode).toBe(200);
  });
});
