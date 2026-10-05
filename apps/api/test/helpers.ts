import type { FastifyInstance, InjectOptions } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/crypto';
import { tenantDb } from '../src/lib/tenant-db';
import { createTenant, ensurePlans, ensureSuperAdmin } from '../src/seed/tenant-setup';

export interface TestEnv {
  app: FastifyInstance;
  prisma: PrismaClient;
}

export async function setupApp(): Promise<TestEnv> {
  const prisma = createPrisma();
  await ensurePlans(prisma);
  await ensureSuperAdmin(prisma, 'admin@newmux.test', 'AdminPass123!');
  const app = await buildApp(prisma, loadConfig({ isTest: true }));
  await app.ready();
  return { app, prisma };
}

let counter = 0;
export const uniq = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Create a shop with one user per role. Passwords "password123", PINs 1111..4444. */
export async function createShop(prisma: PrismaClient, opts: { slug?: string; planCode?: string } = {}) {
  const slug = opts.slug ?? uniq('shop');
  const { tenant, roles } = await createTenant(prisma, {
    slug,
    name: `Shop ${slug}`,
    vatNumber: '220000000000001',
    planCode: opts.planCode ?? 'business',
    owner: { name: 'Owner', username: 'owner', email: `owner@${slug}.test`, password: 'password123', pin: '1111' },
  });
  const db = tenantDb(prisma, tenant.id);
  const make = async (key: string, username: string, pin: string) => {
    const emp = await db.employee.create({ data: { tenantId: tenant.id, name: username, basicSalary: 300, allowances: [{ name: 'Housing', amount: 50 }] } });
    return db.user.create({
      data: { tenantId: tenant.id, name: username, username, passwordHash: await hashPassword('password123'), pinHash: await hashPassword(pin), roleId: roles[key], employeeId: emp.id },
    });
  };
  await make('MANAGER', 'manager', '2222');
  await make('CASHIER', 'cashier', '3333');
  await make('WORKER', 'worker', '4444');
  return { tenant, slug, db };
}

export class Client {
  cookies: Record<string, string> = {};
  constructor(private app: FastifyInstance) {}

  async req(method: InjectOptions['method'], url: string, body?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of res.cookies) {
      if (c.value === '' || (c.expires && new Date(c.expires) < new Date())) delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    let json: any = null;
    if (String(res.headers['content-type'] ?? '').includes('application/json')) json = res.json();
    return { status: res.statusCode, json, raw: res };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  put = (url: string, body: unknown) => this.req('PUT', url, body);
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  del = (url: string) => this.req('DELETE', url);

  async login(shopCode: string | null, identifier: string, password = 'password123') {
    const r = await this.post('/api/auth/login', { shopCode, identifier, password });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.json)}`);
    return this;
  }
}

export async function loginAs(app: FastifyInstance, slug: string, username: string) {
  return new Client(app).login(slug, username);
}

/** Catalog ids by item image key and service name. */
export async function catalog(c: Client) {
  const r = await c.get('/api/catalog/pos');
  const items: any[] = r.json.items;
  const services: any[] = r.json.services;
  return {
    item: (key: string) => items.find((i) => i.imageKey === key)!.id as string,
    service: (name: string) => services.find((s) => s.name === name)!.id as string,
    packages: r.json.packages as any[],
  };
}
