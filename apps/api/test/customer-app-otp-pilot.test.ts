/**
 * Pilot sign-in: a few known phone numbers sign in with a fixed code and are never
 * sent a message; every other number is unaffected. `fetch` is faked and counts sends.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { parseOtpPilot } from '../src/lib/otp-guard';
import { createPrisma } from '../src/lib/prisma';
import { ensurePlans } from '../src/seed/tenant-setup';
import { createShop, loginAs } from './helpers';

const PILOT_CODE = '135790';
let app: FastifyInstance;
let prisma: PrismaClient;
let shopCode: string;
let seq = 0;
const phone = () => `+9733${String((Date.now() + seq++) % 10_000_000).padStart(7, '0')}`;
const digits = (p: string) => p.replace('+', '');
const pilotA = phone();
const pilotB = phone();

beforeAll(async () => {
  prisma = createPrisma();
  await ensurePlans(prisma);
  app = await buildApp(
    prisma,
    loadConfig({
      isTest: true,
      customerOtpDevCode: undefined,
      otpPilot: parseOtpPilot(`${pilotA}, ${digits(pilotB)}, +14155550100`, PILOT_CODE),
      otpDelivery: { whatsapp: { token: 't', phoneNumberId: '42', template: 'login_code', language: 'en', apiVersion: 'v21.0' } },
    }),
  );
  await app.ready();
  const shop = await createShop(prisma);
  const owner = await loginAs(app, shop.slug, 'owner');
  const current = (await owner.get('/api/settings')).json.settings;
  shopCode = (await owner.put('/api/settings/preferences', { ...current, customerApp: { ...current.customerApp, enabled: true } })).json.customerCode;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
afterEach(() => vi.unstubAllGlobals());

const post = (url: string, payload: object, ip = '10.9.9.9') =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, payload, headers: { 'x-forwarded-for': ip } });

function countSent() {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return new Response('{}', { status: 201 }); }));
  return sent;
}

describe('pilot sign-in', () => {
  it('lets a listed number in with the fixed code and sends nothing', async () => {
    const sent = countSent();
    expect((await post('/auth/otp', { phone: pilotA, laundryCode: shopCode })).statusCode).toBe(200);
    expect(sent).toHaveLength(0);
    const r = await post('/auth/verify', { phone: pilotA, laundryCode: shopCode, otp: PILOT_CODE });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().session.token).toBeTruthy();
    // the same list works with the number typed in another format
    expect((await post('/auth/otp', { phone: digits(pilotB), laundryCode: shopCode })).statusCode).toBe(200);
    expect((await post('/auth/verify', { phone: pilotB, laundryCode: shopCode, otp: PILOT_CODE })).statusCode).toBe(200);
  });

  it('still refuses a wrong code for a listed number', async () => {
    countSent();
    await post('/auth/otp', { phone: pilotA, laundryCode: shopCode });
    const r = await post('/auth/verify', { phone: pilotA, laundryCode: shopCode, otp: '000000' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_otp');
  });

  it('does not give the fixed code to any other number: it gets a real message and its own code', async () => {
    const sent = countSent();
    const other = phone();
    expect((await post('/auth/otp', { phone: other, laundryCode: shopCode })).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    const r = await post('/auth/verify', { phone: other, laundryCode: shopCode, otp: PILOT_CODE });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_otp');
    const real = JSON.parse(sent[0]).template.components[0].parameters[0].text as string;
    expect((await post('/auth/verify', { phone: other, laundryCode: shopCode, otp: real })).statusCode).toBe(200);
  });

  it('still applies the country rules to a listed number', async () => {
    const sent = countSent();
    const r = await post('/auth/otp', { phone: '+14155550100', laundryCode: shopCode });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('unsupported_country');
    expect(sent).toHaveLength(0);
  });
});
