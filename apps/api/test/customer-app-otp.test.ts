/**
 * Customer app sign-in with real delivery configured: the code goes out on
 * WhatsApp, and is unusable if it could not be sent.
 * `fetch` is faked; no message leaves the machine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/lib/prisma';
import { ensurePlans } from '../src/seed/tenant-setup';
import { createShop, loginAs } from './helpers';

let app: FastifyInstance;
let prisma: PrismaClient;
let code: string;
let seq = 0;

beforeAll(async () => {
  prisma = createPrisma();
  await ensurePlans(prisma);
  app = await buildApp(
    prisma,
    loadConfig({
      isTest: true,
      customerOtpDevCode: undefined,
      otpDelivery: {
        whatsapp: { token: 't', phoneNumberId: '42', template: 'login_code', language: 'en', apiVersion: 'v21.0' },
      },
    }),
  );
  await app.ready();

  const shop = await createShop(prisma);
  const owner = await loginAs(app, shop.slug, 'owner');
  const current = (await owner.get('/api/settings')).json.settings;
  const saved = await owner.put('/api/settings/preferences', { ...current, customerApp: { ...current.customerApp, enabled: true } });
  code = saved.json.customerCode;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
afterEach(() => vi.unstubAllGlobals());

const newPhone = () => `+9733${String(Date.now() % 1000).padStart(3, '0')}${String(900 + seq++).padStart(4, '0')}`;

async function v1(url: string, body: unknown) {
  const res = await app.inject({ method: 'POST', url: `/api/v1${url}`, payload: body as object });
  return { status: res.statusCode, json: res.json() };
}

/** Fake fetch: every call is recorded; `respond` decides the answer per provider host. */
function fakeFetch(respond: (url: string) => number) {
  const sent: { url: string; body: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body) });
      return new Response('{}', { status: respond(url) });
    }),
  );
  return sent;
}

/** The code the customer would read, taken from the WhatsApp request. */
const codeIn = (m: { url: string; body: string }) => JSON.parse(m.body).template.components[0].parameters[0].text as string;

describe('customer app sign-in delivery', () => {
  it('sends the code on WhatsApp, and that code signs the customer in', async () => {
    const sent = fakeFetch(() => 200);
    const phone = newPhone();
    expect((await v1('/auth/otp', { phone, laundryCode: code })).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://graph.facebook.com/v21.0/42/messages');
    expect(JSON.parse(sent[0].body).to).toBe(phone.replace('+', ''));

    const verified = await v1('/auth/verify', { phone, laundryCode: code, otp: codeIn(sent[0]) });
    expect(verified.status, JSON.stringify(verified.json)).toBe(200);
    expect(verified.json.session.token).toBeTruthy();
  });

  it('reports a failure and leaves the code unusable when WhatsApp refuses it', async () => {
    const sent = fakeFetch(() => 500);
    const phone = newPhone();
    const r = await v1('/auth/otp', { phone, laundryCode: code });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('otp_unavailable');
    // Nothing else is tried: there is no SMS.
    expect(sent.map((m) => new URL(m.url).hostname)).toEqual(['graph.facebook.com']);

    // Even the code that was generated is rejected: the customer never received it.
    const verified = await v1('/auth/verify', { phone, laundryCode: code, otp: codeIn(sent[0]) });
    expect(verified.status).toBe(400);
    expect(verified.json.error.code).toBe('invalid_otp');
  });
});
