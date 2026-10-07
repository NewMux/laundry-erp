/** Vercel deployment: the function handler and the cron endpoints. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { addDays, bhDate } from '@laundry/shared';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/lib/prisma';
import { tenantDb } from '../src/lib/tenant-db';
import handler from '../src/vercel';
import { createShop } from './helpers';

const SECRET = 'cron-secret-for-tests';
let prisma: PrismaClient;
let app: FastifyInstance;
let noCron: FastifyInstance;

beforeAll(async () => {
  prisma = createPrisma();
  app = await buildApp(prisma, loadConfig({ isTest: true, cronSecret: SECRET }));
  noCron = await buildApp(prisma, loadConfig({ isTest: true, cronSecret: undefined }));
  await Promise.all([app.ready(), noCron.ready()]);
});
afterAll(async () => {
  await app.close();
  await noCron.close();
  await prisma.$disconnect();
});

const cron = (a: FastifyInstance, job: string, auth?: string) =>
  a.inject({ method: 'GET', url: `/api/cron/${job}`, headers: auth ? { authorization: auth } : {} });

describe('cron endpoints', () => {
  it('do not exist without CRON_SECRET', async () => {
    expect((await cron(noCron, 'session-cleanup', 'Bearer anything')).statusCode).toBe(404);
  });

  it('reject a missing or wrong secret', async () => {
    expect((await cron(app, 'session-cleanup')).statusCode).toBe(401);
    expect((await cron(app, 'session-cleanup', 'Bearer wrong')).statusCode).toBe(401);
    expect((await cron(app, 'session-cleanup', SECRET)).statusCode).toBe(401);
  });

  it('run the recurring expenses job', async () => {
    const shop = await createShop(prisma);
    const db = tenantDb(prisma, shop.tenant.id);
    const cat = await db.expenseCategory.findFirstOrThrow({ where: { name: 'Rent' } });
    const start = addDays(bhDate(), -40);
    await db.recurringExpense.create({ data: { tenantId: shop.tenant.id, categoryId: cat.id, amount: 300, frequency: 'MONTHLY', anchorDay: Number(start.slice(8)), nextDate: start } });
    const r = await cron(app, 'recurring-expenses', `Bearer ${SECRET}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, job: 'recurring-expenses' });
    expect(await db.expense.count({ where: { categoryId: cat.id } })).toBeGreaterThanOrEqual(1);
  });

  it('run package expiry and session cleanup', async () => {
    for (const job of ['package-expiry', 'session-cleanup']) {
      const r = await cron(app, job, `Bearer ${SECRET}`);
      expect(r.statusCode, job).toBe(200);
      expect(r.json().ok).toBe(true);
    }
  });
});

describe('Vercel function handler', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('serves the API from a plain Node request handler', async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
    const again = await fetch(`${base}/api/auth/me`);
    expect((await again.json()).user).toBeNull();
  });

  it('does not serve the web app (that is the web service on Vercel)', async () => {
    const r = await fetch(`${base}/orders`);
    expect(r.status).toBe(404);
  });
});
