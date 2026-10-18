/**
 * Public signup with the Turnstile bot check on. `fetch` is faked; nothing
 * reaches Cloudflare.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { parseTurnstile, verifyTurnstile } from '../src/lib/captcha';
import { createPrisma } from '../src/lib/prisma';
import { ensurePlans } from '../src/seed/tenant-setup';

let app: FastifyInstance;
let plain: FastifyInstance;
let prisma: PrismaClient;
let seq = 0;

beforeAll(async () => {
  prisma = createPrisma();
  await ensurePlans(prisma);
  app = await buildApp(prisma, loadConfig({ isTest: true, turnstile: { siteKey: 'site-key', secret: 'secret-key' } }));
  await app.ready();
  plain = await buildApp(prisma, loadConfig({ isTest: true, turnstile: undefined }));
  await plain.ready();
});
afterAll(async () => {
  await app.close();
  await plain.close();
  await prisma.$disconnect();
});
afterEach(() => vi.unstubAllGlobals());

const body = (extra: object = {}) => {
  const n = `${Date.now().toString(36)}${seq++}`;
  return {
    shop: { name: 'Captcha Shop', slug: `captcha-${n}` },
    owner: { name: 'Owner', username: 'owner', email: `o-${n}@captcha.test`, password: 'password123' },
    template: 'empty',
    ...extra,
  };
}

function fakeTurnstile(respond: () => Response | Promise<Response>) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)) });
      return respond();
    }),
  );
  return calls;
}
const verdict = (success: boolean) => new Response(JSON.stringify({ success }), { status: 200 });
const signup = async (a: FastifyInstance, payload: object) => {
  const res = await a.inject({ method: 'POST', url: '/api/onboarding/signup', payload });
  return { status: res.statusCode, json: res.json() };
};

describe('parseTurnstile', () => {
  it('needs both keys', () => {
    expect(parseTurnstile('a', 'b')).toEqual({ siteKey: 'a', secret: 'b' });
    expect(parseTurnstile('a', undefined)).toBeUndefined();
    expect(parseTurnstile(undefined, 'b')).toBeUndefined();
    expect(parseTurnstile(' ', 'b')).toBeUndefined();
  });
});

describe('verifyTurnstile', () => {
  it('sends the secret, token and caller IP to Cloudflare', async () => {
    const fetchFn = vi.fn(async () => verdict(true));
    await verifyTurnstile({ siteKey: 'k', secret: 's' }, 'tok', '203.0.113.9', fetchFn as never);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({ secret: 's', response: 'tok', remoteip: '203.0.113.9' });
  });

  it('rejects a missing token without calling Cloudflare', async () => {
    const fetchFn = vi.fn();
    await expect(verifyTurnstile({ siteKey: 'k', secret: 's' }, undefined, '1.1.1.1', fetchFn as never)).rejects.toMatchObject({ code: 'captcha_failed' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('signup with the bot check on', () => {
  it('publishes the site key, and nothing secret', async () => {
    const res = await app.inject({ url: '/api/onboarding/captcha-config' });
    expect(res.json()).toEqual({ siteKey: 'site-key' });
    const off = await plain.inject({ url: '/api/onboarding/captcha-config' });
    expect(off.json()).toEqual({ siteKey: null });
  });

  it('refuses a signup with no token, and creates nothing', async () => {
    const calls = fakeTurnstile(() => verdict(true));
    const payload = body();
    const r = await signup(app, payload);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('captcha_failed');
    expect(calls).toHaveLength(0);
    expect(await prisma.tenant.findUnique({ where: { slug: payload.shop.slug } })).toBeNull();
  });

  it('refuses a token Cloudflare rejects, and creates nothing', async () => {
    fakeTurnstile(() => verdict(false));
    const payload = body({ captchaToken: 'bad' });
    const r = await signup(app, payload);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('captcha_failed');
    expect(await prisma.tenant.findUnique({ where: { slug: payload.shop.slug } })).toBeNull();
  });

  it('creates the shop when the token passes', async () => {
    const calls = fakeTurnstile(() => verdict(true));
    const payload = body({ captchaToken: 'good' });
    const r = await signup(app, payload);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(calls[0].body.get('response')).toBe('good');
    expect(await prisma.tenant.findUnique({ where: { slug: payload.shop.slug } })).not.toBeNull();
  });

  it('fails closed when Cloudflare cannot be reached', async () => {
    fakeTurnstile(() => {
      throw new Error('network down');
    });
    const payload = body({ captchaToken: 'good' });
    const r = await signup(app, payload);
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('captcha_unavailable');
    expect(await prisma.tenant.findUnique({ where: { slug: payload.shop.slug } })).toBeNull();
  });

  it('does not ask for a token when the check is off', async () => {
    const r = await signup(plain, body());
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  });
});
