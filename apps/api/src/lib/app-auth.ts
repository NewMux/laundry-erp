import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppUser, PrismaClient } from '@prisma/client';
import { AppError } from './errors';
import { randomToken, sha256 } from './crypto';

/**
 * Customer-app authentication. Separate from staff sessions: a customer signs
 * in with their mobile number and a one-time code, and gets a bearer token
 * (no cookies, so the cross-site rules for the staff app don't apply).
 */

const SESSION_DAYS = 90;
const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PER_PHONE_PER_10_MIN = 5;

declare module 'fastify' {
  interface FastifyRequest {
    appUser?: AppUser;
  }
}

/** Resolve `Authorization: Bearer <token>` into the signed-in customer, or 401. */
export async function requireAppUser(prisma: PrismaClient, req: FastifyRequest): Promise<AppUser> {
  if (req.appUser) return req.appUser;
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new AppError(401, 'unauthorized', 'Please sign in');
  const session = await prisma.appSession.findUnique({ where: { tokenHash: sha256(token) }, include: { appUser: true } });
  const now = new Date();
  if (!session || session.expiresAt < now) {
    if (session) await prisma.appSession.delete({ where: { id: session.id } }).catch(() => undefined);
    throw new AppError(401, 'unauthorized', 'Your session has expired. Please sign in again.');
  }
  // Sliding expiry, written at most once a day.
  if (now.getTime() - session.lastSeenAt.getTime() > 86_400_000) {
    await prisma.appSession
      .update({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000) } })
      .catch(() => undefined);
  }
  req.appUser = session.appUser;
  return session.appUser;
}

export async function createAppSession(prisma: PrismaClient, appUserId: string): Promise<string> {
  const token = randomToken();
  await prisma.appSession.create({
    data: { tokenHash: sha256(token), appUserId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) },
  });
  return token;
}

const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Issue a sign-in code for a phone number.
 *
 * No SMS provider is connected yet. Until one is, the code is written to the
 * server log, or — for test and staging only — every code is the fixed value in
 * CUSTOMER_OTP_DEV_CODE. Never set that variable in production.
 */
export async function issueOtp(app: FastifyInstance, phone: string): Promise<{ expiresInSec: number }> {
  const since = new Date(Date.now() - 10 * 60_000);
  const recent = await app.prisma.otpChallenge.count({ where: { phone, createdAt: { gte: since } } });
  if (recent >= OTP_PER_PHONE_PER_10_MIN) throw new AppError(429, 'rate_limited', 'Too many codes requested. Please wait a few minutes.');
  const code = app.config.customerOtpDevCode ?? newCode();
  await app.prisma.otpChallenge.create({
    data: { phone, codeHash: sha256(`${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000) },
  });
  if (!app.config.customerOtpDevCode) {
    // TODO(sms): send `code` to `phone` through the SMS provider once one is chosen.
    app.log.warn({ phone }, `Customer app sign-in code for +${phone}: ${code} (no SMS provider configured)`);
  }
  return { expiresInSec: OTP_TTL_SECONDS };
}

/** Check a code against the newest open challenge for the phone; consumes it on success. */
export async function verifyOtp(prisma: PrismaClient, phone: string, code: string): Promise<void> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) throw new AppError(400, 'invalid_otp', 'That code has expired. Request a new one.');
  const given = Buffer.from(sha256(`${phone}:${code.trim()}`));
  const expected = Buffer.from(challenge.codeHash);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw new AppError(400, 'invalid_otp', 'That code is not right.');
  }
  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
}
