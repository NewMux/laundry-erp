/**
 * Pilot sign-in as it is configured in real deployments: values come from environment
 * variables, so they carry spaces, "+", other number formats and, by accident, a leftover
 * CUSTOMER_OTP_DEV_CODE. A listed number must sign in with the pilot code in every one of
 * those cases, and /auth/otp and /auth/verify must agree on the number whatever the format.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { parseOtpPilot } from '../src/lib/otp-guard';
import { createPrisma } from '../src/lib/prisma';
import { ensurePlans } from '../src/seed/tenant-setup';
import { createShop, loginAs } from './helpers';

let prisma: PrismaClient;
const apps: FastifyInstance[] = [];
let shopCode: string;

// Distinct numbers per case so cases do not share challenges or limits.
const base = Date.now() % 1_000_000;
const national = (n: number) => `3${String((base + n) % 10_000_000).padStart(7, '0')}`; // 8 digits, Bahrain mobile

beforeAll(async () => {
  prisma = createPrisma();
  await ensurePlans(prisma);
  const shop = await createShop(prisma);
  const boot = await build({});
  const owner = await loginAs(boot, shop.slug, 'owner');
  const current = (await owner.get('/api/settings')).json.settings;
  shopCode = (await owner.put('/api/settings/preferences', { ...current, customerApp: { ...current.customerApp, enabled: true } })).json.customerCode;
});
afterAll(async () => {
  for (const a of apps) await a.close();
  await prisma.$disconnect();
});

async function build(over: Parameters<typeof loadConfig>[0]) {
  const app = await buildApp(prisma, loadConfig({ isTest: true, customerOtpDevCode: undefined, otpPilot: undefined, ...over }));
  await app.ready();
  apps.push(app);
  return app;
}

let ipSeq = 0;
const post = (app: FastifyInstance, url: string, payload: object) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, payload, headers: { 'x-forwarded-for': `10.7.${(ipSeq / 250) | 0}.${ipSeq++ % 250}` } });

/** Request a code for `asked`, then verify with `typed` (same person, possibly another format). */
async function signIn(app: FastifyInstance, asked: string, typed: string, otp: string) {
  expect((await post(app, '/auth/otp', { phone: asked, laundryCode: shopCode })).statusCode).toBe(200);
  return post(app, '/auth/verify', { phone: typed, laundryCode: shopCode, otp });
}

describe('pilot values as they arrive from environment variables', () => {
  it('matches the list however the number is written in it or typed in the app', async () => {
    const n = national(1);
    // The list holds the number with a "+", spaces and a trailing newline (a pasted Vercel value).
    const app = await build({ otpPilot: parseOtpPilot(` +973 ${n.slice(0, 4)} ${n.slice(4)} \n`, '135790') });
    for (const [asked, typed] of [
      [n, n],
      [n, `+973${n}`],
      [`+973${n}`, n],
      [`00973${n}`, `+973 ${n.slice(0, 4)} ${n.slice(4)}`],
    ]) {
      const r = await signIn(app, asked, typed, '135790');
      expect(r.statusCode, `${asked} -> ${typed}: ${r.body}`).toBe(200);
    }
  });

  it('trims the code, so a value pasted with spaces or a newline still works', async () => {
    const n = national(2);
    const app = await build({ otpPilot: parseOtpPilot(n, '  135790\n') });
    expect((await signIn(app, n, n, '135790')).statusCode).toBe(200);
    // and a code typed with stray spaces in the app
    expect((await signIn(app, n, n, ' 135790 ')).statusCode).toBe(200);
  });

  it('keeps the pilot code for a listed number even when a leftover CUSTOMER_OTP_DEV_CODE is set', async () => {
    const n = national(3);
    const app = await build({ customerOtpDevCode: '123456', otpPilot: parseOtpPilot(n, '135790') });
    const ok = await signIn(app, n, n, '135790');
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('still lets every other number use the dev code when one is set', async () => {
    const listed = national(4);
    const other = national(5);
    const app = await build({ customerOtpDevCode: '123456', otpPilot: parseOtpPilot(listed, '135790') });
    expect((await signIn(app, other, other, '123456')).statusCode).toBe(200);
  });

  it('refuses the old dev code for a listed number, so only one code works per number', async () => {
    const n = national(6);
    const app = await build({ customerOtpDevCode: '123456', otpPilot: parseOtpPilot(n, '135790') });
    const r = await signIn(app, n, n, '123456');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_otp');
  });
});
