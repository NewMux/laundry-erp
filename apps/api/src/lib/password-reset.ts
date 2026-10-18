import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config';
import { hashPassword, randomToken, sha256 } from './crypto';
import { AppError } from './errors';

/** Emailed links last an hour; a link an admin hands over by hand lasts a day. */
export const RESET_TTL_EMAILED_MIN = 60;
export const RESET_TTL_ADMIN_MIN = 24 * 60;
/** Per account, so a stranger who knows an email cannot make us send it a stream of messages. */
const MAX_EMAILED_PER_HOUR = 3;

export function resetUrl(config: Pick<AppConfig, 'publicUrl'>, token: string): string {
  return `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

/** A new one-time link for the account. Earlier unused links stay valid until they expire. */
export async function createResetToken(prisma: PrismaClient, userId: string, ttlMinutes: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
  return { token, expiresAt };
}

/** True when the account has already been emailed as many links as an hour allows. */
export async function emailLimitReached(prisma: PrismaClient, userId: string): Promise<boolean> {
  const recent = await prisma.passwordResetToken.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  return recent >= MAX_EMAILED_PER_HOUR;
}

const INVALID = () => new AppError(400, 'INVALID_RESET', 'This reset link is invalid or has expired. Request a new one.');

/**
 * Set a new password from a reset link. The link works once; the account's other links, its
 * sessions and any lockout are cleared, so whoever held the old password is signed out.
 */
export async function consumeReset(prisma: PrismaClient, token: string, password: string): Promise<{ userId: string; tenantId: string | null; name: string }> {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) throw INVALID();
  const passwordHash = await hashPassword(password);
  // The conditional update makes "once" true even when two requests race with the same link.
  const claimed = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw INVALID();
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
    prisma.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: row.userId } }),
  ]);
  return { userId: row.userId, tenantId: row.user.tenantId, name: row.user.name };
}
