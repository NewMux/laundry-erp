import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, perm, requireTenant } from '../lib/context';
import { hashPassword } from '../lib/crypto';
import { AppError, forbidden, notFound } from '../lib/errors';
import { maxUsersFor } from '../lib/subscription';
import { parse } from '../lib/validate';

const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3–40 letters, numbers, dots or dashes');
const pinSchema = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');

export default async function usersRoutes(app: FastifyInstance) {
  const select = {
    id: true,
    name: true,
    username: true,
    email: true,
    isActive: true,
    roleId: true,
    employeeId: true,
    lastLoginAt: true,
    pinHash: true,
    role: { select: { key: true, name: true } },
    employee: { select: { name: true } },
  } as const;

  const shape = (u: { pinHash: string | null } & Record<string, unknown>) => {
    const { pinHash, ...rest } = u;
    return { ...rest, hasPin: !!pinHash };
  };

  app.get('/', { preHandler: perm('users', 'view') }, async (req) => {
    const users = await app.tdb(req).user.findMany({ select, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    return { users: users.map(shape) };
  });

  async function assertSeat(req: Parameters<typeof requireTenant>[0]) {
    const a = requireTenant(req);
    const active = await app.tdb(req).user.count({ where: { isActive: true } });
    const max = maxUsersFor(a.tenant, a.tenant.plan);
    if (active >= max) {
      throw new AppError(402, 'USER_LIMIT', `Your plan allows ${max} active users. Upgrade the plan or deactivate a user.`);
    }
  }

  async function assertRoleAssignable(req: Parameters<typeof requireTenant>[0], roleId: string) {
    const a = requireTenant(req);
    const role = await app.tdb(req).role.findFirst({ where: { id: roleId } });
    if (!role) throw notFound('Role');
    if (role.key === 'OWNER' && a.roleKey !== 'OWNER' && !a.supportMode) throw forbidden('Only an owner can create another owner');
    return role;
  }

  const createSchema = z.object({
    name: z.string().trim().min(2).max(120),
    username: usernameSchema,
    email: z.string().trim().toLowerCase().email().nullish().or(z.literal('').transform(() => null)),
    password: z.string().min(8).max(200),
    pin: pinSchema.nullish().or(z.literal('').transform(() => null)),
    roleId: z.string().min(1),
    employeeId: z.string().nullish(),
  });

  app.post('/', { preHandler: perm('users', 'create') }, async (req) => {
    const a = requireTenant(req);
    const body = parse(createSchema, req.body);
    await assertSeat(req);
    const role = await assertRoleAssignable(req, body.roleId);
    const db = app.tdb(req);
    if (await db.user.findFirst({ where: { username: body.username } })) throw new AppError(409, 'USERNAME_TAKEN', 'This username is already used');
    if (body.email && (await app.prisma.user.findUnique({ where: { email: body.email } }))) {
      throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered');
    }
    const user = await db.user.create({
      data: {
        tenantId: a.tenant.id,
        name: body.name,
        username: body.username,
        email: body.email ?? null,
        passwordHash: await hashPassword(body.password),
        pinHash: body.pin ? await hashPassword(body.pin) : null,
        roleId: role.id,
        employeeId: body.employeeId || null,
      },
      select,
    });
    await audit(db, req, 'user.created', 'user', user.id, null, { name: user.name, username: user.username, role: role.key });
    return { user: shape(user) };
  });

  const updateSchema = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email().nullish().or(z.literal('').transform(() => null)),
    password: z.string().min(8).max(200).optional().or(z.literal('').transform(() => undefined)),
    pin: pinSchema.nullish().or(z.literal('').transform(() => undefined)),
    roleId: z.string().optional(),
    isActive: z.boolean().optional(),
    employeeId: z.string().nullish(),
  });

  app.patch('/:id', { preHandler: perm('users', 'edit') }, async (req) => {
    const a = requireTenant(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(updateSchema, req.body);
    const db = app.tdb(req);
    const user = await db.user.findFirst({ where: { id }, include: { role: true } });
    if (!user) throw notFound('User');
    if (user.role?.key === 'OWNER' && a.roleKey !== 'OWNER' && !a.supportMode) throw forbidden('Only an owner can change an owner account');

    let newRoleKey = user.role?.key;
    if (body.roleId && body.roleId !== user.roleId) {
      const role = await assertRoleAssignable(req, body.roleId);
      newRoleKey = role.key;
    }
    const deactivating = body.isActive === false && user.isActive;
    if (user.role?.key === 'OWNER' && (newRoleKey !== 'OWNER' || deactivating)) {
      const owners = await db.user.count({ where: { isActive: true, role: { key: 'OWNER' } } });
      if (owners <= 1) throw new AppError(400, 'LAST_OWNER', 'The shop must keep at least one active owner');
    }
    if (body.isActive === true && !user.isActive) await assertSeat(req);
    if (body.email && body.email !== user.email && (await app.prisma.user.findUnique({ where: { email: body.email } }))) {
      throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered');
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = body.email;
    if (body.roleId !== undefined) data.roleId = body.roleId;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.employeeId !== undefined) data.employeeId = body.employeeId || null;
    if (body.password) data.passwordHash = await hashPassword(body.password);
    if (body.pin === null) data.pinHash = null;
    else if (body.pin) data.pinHash = await hashPassword(body.pin);

    const updated = await db.user.update({ where: { id }, data, select });
    if (deactivating || body.password) await app.prisma.session.deleteMany({ where: { userId: id } });
    await audit(
      db,
      req,
      'user.updated',
      'user',
      id,
      { name: user.name, role: user.role?.key, isActive: user.isActive },
      { name: updated.name, role: newRoleKey, isActive: updated.isActive, passwordChanged: !!body.password, pinChanged: body.pin !== undefined },
    );
    return { user: shape(updated) };
  });
}
