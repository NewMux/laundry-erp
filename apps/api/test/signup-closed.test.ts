/**
 * Public signup is off by default: a laundry gets its account from Ghasla after it has paid.
 * Nothing may be created, and nothing may be learned about existing shops, while it is closed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/lib/prisma';
import { ensurePlans } from '../src/seed/tenant-setup';

let closed: FastifyInstance;
let open: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrisma();
  await ensurePlans(prisma);
  closed = await buildApp(prisma, loadConfig({ isTest: true, publicSignup: false }));
  await closed.ready();
  open = await buildApp(prisma, loadConfig({ isTest: true, publicSignup: true }));
  await open.ready();
});
afterAll(async () => {
  await closed.close();
  await open.close();
  await prisma.$disconnect();
});

const payload = () => {
  const n = Date.now().toString(36);
  return {
    shop: { name: 'Closed Shop', slug: `closed-${n}` },
    owner: { name: 'Owner', username: 'owner', email: `o-${n}@closed.test`, password: 'password123' },
    template: 'empty',
  };
};

describe('signup while closed', () => {
  it('says so', async () => {
    expect((await closed.inject({ url: '/api/onboarding/signup-status' })).json()).toEqual({ open: false });
    expect((await open.inject({ url: '/api/onboarding/signup-status' })).json()).toEqual({ open: true });
  });

  it('refuses a signup and creates nothing', async () => {
    const body = payload();
    const res = await closed.inject({ method: 'POST', url: '/api/onboarding/signup', payload: body });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SIGNUP_CLOSED');
    expect(await prisma.tenant.findUnique({ where: { slug: body.shop.slug } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: body.owner.email } })).toBeNull();
  });

  it('refuses before reading the body, so a malformed one learns nothing either', async () => {
    const res = await closed.inject({ method: 'POST', url: '/api/onboarding/signup', payload: { nonsense: true } });
    expect(res.statusCode).toBe(403);
  });

  it('does not reveal which shop codes are taken', async () => {
    const res = await closed.inject({ url: '/api/onboarding/check-slug?slug=acme' });
    expect(res.statusCode).toBe(403);
  });

  it('still works when PUBLIC_SIGNUP is on', async () => {
    const res = await open.inject({ method: 'POST', url: '/api/onboarding/signup', payload: payload() });
    expect(res.statusCode).toBe(200);
  });
});
