import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config';
import { DEVICE_COOKIE, SESSION_COOKIE } from './context';
import { randomToken, sha256 } from './crypto';
import { cryptoId } from './ids';

const SESSION_MAX_HOURS = 24 * 7;

export async function createSession(
  prisma: PrismaClient,
  config: AppConfig,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  tenantId: string | null,
  opts: { supportMode?: boolean; expiresAt?: Date } = {},
): Promise<string> {
  const token = randomToken();
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + SESSION_MAX_HOURS * 3600_000);
  await prisma.session.create({
    data: {
      id: cryptoId(),
      tokenHash: sha256(token),
      userId,
      tenantId,
      supportMode: opts.supportMode ?? false,
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      expiresAt,
    },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires: expiresAt,
  });
  return token;
}

/** Remember this browser as a counter device of the tenant (enables quick PIN switching). */
export async function trustDevice(
  prisma: PrismaClient,
  config: AppConfig,
  req: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
): Promise<void> {
  const existing = req.cookies[DEVICE_COOKIE];
  if (existing) {
    const d = await prisma.device.findUnique({ where: { tokenHash: sha256(existing) } });
    if (d && d.tenantId === tenantId) return;
  }
  const token = randomToken();
  await prisma.device.create({ data: { tenantId, tokenHash: sha256(token), name: String(req.headers['user-agent'] ?? '').slice(0, 120) } });
  reply.setCookie(DEVICE_COOKIE, token, {
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 60 * 60 * 24 * 365,
  });
}
