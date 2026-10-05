import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WEEKDAYS } from '@laundry/shared';
import { AppError } from '../lib/errors';
import { createSession, trustDevice } from '../lib/session';
import { parse, zOptStr } from '../lib/validate';
import { PRICE_TEMPLATES } from '../seed/templates';
import { createTenant } from '../seed/tenant-setup';

const RESERVED = new Set(['admin', 'api', 'www', 'app', 'newmux', 'support', 'login', 'signup']);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,39}$/, 'Shop code: 3–40 letters, numbers or dashes');

const hoursSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
  closed: z.boolean(),
});
export const workingHoursSchema = z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, hoursSchema])) as Record<(typeof WEEKDAYS)[number], typeof hoursSchema>);

export const signupSchema = z.object({
  shop: z.object({
    name: z.string().trim().min(2).max(120),
    slug: slugSchema,
    crNumber: zOptStr(40),
    vatNumber: zOptStr(40),
    address: zOptStr(400),
    phone: zOptStr(40),
    email: z.string().trim().toLowerCase().email().nullish(),
    workingHours: workingHoursSchema.optional(),
  }),
  owner: z.object({
    name: z.string().trim().min(2).max(120),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3–40 letters, numbers, dots or dashes'),
    email: z.string().trim().toLowerCase().email().nullish(),
    password: z.string().min(8).max(200),
  }),
  template: z.enum(['standard', 'dry_cleaner', 'empty']).default('standard'),
  vatRate: z.number().min(0).max(100).optional(),
});

export default async function onboardingRoutes(app: FastifyInstance) {
  app.get('/templates', async () => ({
    templates: Object.entries(PRICE_TEMPLATES).map(([key, t]) => ({ key, name: t.name, items: t.items.length })),
  }));

  app.get('/check-slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string() }), req.query);
    const r = slugSchema.safeParse(slug);
    if (!r.success || RESERVED.has(r.data)) return { available: false };
    const t = await app.prisma.tenant.findUnique({ where: { slug: r.data }, select: { id: true } });
    return { available: !t };
  });

  /** Self-onboarding: create a laundry account on a free trial and sign the owner in. */
  app.post('/signup', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const body = parse(signupSchema, req.body);
    if (RESERVED.has(body.shop.slug)) throw new AppError(409, 'SLUG_TAKEN', 'This shop code is not available');
    if (await app.prisma.tenant.findUnique({ where: { slug: body.shop.slug } })) {
      throw new AppError(409, 'SLUG_TAKEN', 'This shop code is already taken');
    }
    if (body.owner.email && (await app.prisma.user.findUnique({ where: { email: body.owner.email } }))) {
      throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered');
    }
    const { tenant, owner } = await createTenant(app.prisma, {
      slug: body.shop.slug,
      name: body.shop.name,
      crNumber: body.shop.crNumber,
      vatNumber: body.shop.vatNumber,
      address: body.shop.address,
      phone: body.shop.phone,
      email: body.shop.email ?? null,
      workingHours: body.shop.workingHours,
      template: body.template,
      owner: { name: body.owner.name, username: body.owner.username, email: body.owner.email ?? null, password: body.owner.password },
      settings: body.vatRate !== undefined ? { vatRate: body.vatRate } : undefined,
    });
    await createSession(app.prisma, app.config, req, reply, owner.id, tenant.id);
    await trustDevice(app.prisma, app.config, req, reply, tenant.id);
    return { ok: true, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
  });
}
