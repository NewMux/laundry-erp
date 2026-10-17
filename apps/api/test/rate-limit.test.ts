/**
 * Rate limits must hold across server instances. On Vercel every instance is a
 * separate process, so the counters live in Postgres (src/lib/rate-limit-store.ts).
 * Two app instances here stand in for two serverless instances.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { runSessionCleanup } from '../src/jobs';
import { pgRateLimitStore } from '../src/lib/rate-limit-store';
import { createPrisma } from '../src/lib/prisma';

let prisma: PrismaClient;
beforeAll(() => {
  prisma = createPrisma();
  process.env.LOG_LEVEL = 'silent';
});
afterAll(() => prisma.$disconnect());

let seq = 0;
/** A source IP nobody has used: counters persist in the database between runs. */
const freshIp = () => `10.${Date.now() % 250}.${(seq >> 8) % 250}.${seq++ % 250}`;
const call = <T>(fn: (cb: (err: Error | null, r?: { current: number; ttl: number }) => void) => void) =>
  new Promise<{ current: number; ttl: number }>((resolve, reject) => fn((err, r) => (err ? reject(err) : resolve(r!))));

describe('Postgres rate-limit store', () => {
  const Store = () => pgRateLimitStore(prisma);

  it('counts per key and reports the time left in the window', async () => {
    const s = new (Store())();
    const key = `t-${freshIp()}`;
    const a = await call((cb) => s.incr(key, cb, 60_000));
    const b = await call((cb) => s.incr(key, cb, 60_000));
    const other = await call((cb) => s.incr(`${key}-other`, cb, 60_000));
    expect([a.current, b.current, other.current]).toEqual([1, 2, 1]);
    expect(b.ttl).toBeGreaterThan(50_000);
    expect(b.ttl).toBeLessThanOrEqual(60_000);
  });

  it('starts a new window once the old one has ended', async () => {
    const s = new (Store())();
    const key = `t-${freshIp()}`;
    await call((cb) => s.incr(key, cb, 150));
    expect((await call((cb) => s.incr(key, cb, 150))).current).toBe(2);
    await new Promise((r) => setTimeout(r, 250));
    expect((await call((cb) => s.incr(key, cb, 150))).current).toBe(1);
  });

  it('counts a burst of simultaneous requests exactly', async () => {
    const s = new (Store())();
    const key = `t-${freshIp()}`;
    const counts = await Promise.all(Array.from({ length: 60 }, () => call((cb) => s.incr(key, cb, 60_000)).then((r) => r.current)));
    expect([...counts].sort((x, y) => x - y)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('read does not count, and each route has its own counters', async () => {
    const root = new (Store())();
    const login = root.child({ routeInfo: { method: 'POST', url: '/api/auth/login' } });
    const pin = root.child({ routeInfo: { method: 'POST', url: '/api/auth/pin' } });
    const key = `t-${freshIp()}`;
    expect(await call((cb) => login.read(key, cb))).toEqual({ current: 0, ttl: 0 });
    await call((cb) => login.incr(key, cb, 60_000));
    await call((cb) => login.incr(key, cb, 60_000));
    expect((await call((cb) => login.read(key, cb))).current).toBe(2);
    expect((await call((cb) => login.read(key, cb))).current).toBe(2);
    expect((await call((cb) => pin.incr(key, cb, 60_000))).current).toBe(1);
  });

  it('is cleaned up by the daily housekeeping job once a window has ended', async () => {
    const s = new (Store())();
    const key = `cleanup-${freshIp()}`;
    await call((cb) => s.incr(key, cb, 100));
    await new Promise((r) => setTimeout(r, 200));
    await runSessionCleanup(prisma);
    expect(await prisma.rateLimitBucket.count({ where: { key } })).toBe(0);
  });
});

describe('the plugin with the Postgres store, on two instances', () => {
  async function instance() {
    const f = Fastify({ trustProxy: true });
    await f.register(rateLimit, { global: false, store: pgRateLimitStore(prisma) });
    f.get('/limited', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async () => ({ ok: true }));
    await f.ready();
    return f;
  }

  it('shares one limit between instances', async () => {
    const [a, b] = [await instance(), await instance()];
    const ip = freshIp();
    const hit = async (f: FastifyInstance) => (await f.inject({ url: '/limited', headers: { 'x-forwarded-for': ip } })).statusCode;
    expect([await hit(a), await hit(b), await hit(a)]).toEqual([200, 200, 200]);
    expect([await hit(b), await hit(a)]).toEqual([429, 429]);
    await Promise.all([a.close(), b.close()]);
  });
});

describe('the real app’s limits', () => {
  const apps: FastifyInstance[] = [];
  /** The real app with its limits on (tests normally bypass them). */
  async function realApp() {
    const app = await buildApp(prisma, loadConfig({ isTest: false }));
    await app.ready();
    apps.push(app);
    return app;
  }
  afterAll(() => Promise.all(apps.map((a) => a.close())));

  const login = (app: FastifyInstance, ip: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { identifier: 'nobody@example.test', password: 'wrong-password' }, headers: { 'x-forwarded-for': ip } });

  it('staff login allows 20 attempts a minute in total, however many instances serve them', async () => {
    const [a, b] = [await realApp(), await realApp()];
    const ip = freshIp();
    for (let i = 0; i < 20; i++) expect((await login(i % 2 ? a : b, ip)).statusCode).toBe(401);
    for (const app of [a, b]) {
      const limited = await login(app, ip);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
    }
    // Another source is unaffected.
    expect((await login(a, freshIp())).statusCode).toBe(401);
  });

  it('a burst of 40 simultaneous logins lets exactly 20 through', async () => {
    const [a, b] = [await realApp(), await realApp()];
    const ip = freshIp();
    const codes = await Promise.all(Array.from({ length: 40 }, (_, i) => login(i % 2 ? a : b, ip).then((r) => r.statusCode)));
    expect(codes.filter((c) => c === 401)).toHaveLength(20);
    expect(codes.filter((c) => c === 429)).toHaveLength(20);
  });
});
