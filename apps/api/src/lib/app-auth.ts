import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppUser, PrismaClient } from '@prisma/client';
import type { SmsConfig } from '../config';
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

/** Keyed hash, so a leaked database can't be used to work out which 6-digit codes are live. */
const otpHash = (secret: string, phone: string, code: string) =>
  crypto.createHmac('sha256', secret).update(`otp:${phone}:${code}`).digest('hex');

/** Wrong guesses allowed across every code issued to a phone in this window, however many are requested. */
const OTP_MAX_FAILURES_PER_WINDOW = 10;
const OTP_FAILURE_WINDOW_MS = 15 * 60_000;

/** Text the code to the customer through Twilio. Throws if it could not be sent. */
async function sendOtpSms(sms: SmsConfig, phone: string, code: string): Promise<void> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sms.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sms.accountSid}:${sms.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: `+${phone}`, From: sms.from, Body: `Your NewMux Laundry code is ${code}. It expires in 5 minutes. Never share it.` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`SMS provider answered ${res.status}`);
}

/**
 * Issue a sign-in code for a phone number and deliver it by SMS.
 *
 * - Production: the code goes out by SMS (TWILIO_*). With no provider
 *   configured this fails closed. The code is never written to the logs,
 *   because anyone who could read them could take over a customer's account.
 * - Test / staging: CUSTOMER_OTP_DEV_CODE makes every code that fixed value.
 *   The config refuses to load in production with it set.
 * - Local development without either: the code is logged so it can be typed in.
 */
export async function issueOtp(app: FastifyInstance, phone: string): Promise<{ expiresInSec: number }> {
  const { config } = app;
  if (config.isProduction && !config.sms) {
    app.log.error('Customer sign-in is unavailable: no SMS provider is configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM).');
    throw new AppError(503, 'not_available', 'Sign-in is temporarily unavailable. Please try again later.');
  }
  const since = new Date(Date.now() - 10 * 60_000);
  const recent = await app.prisma.otpChallenge.count({ where: { phone, createdAt: { gte: since } } });
  if (recent >= OTP_PER_PHONE_PER_10_MIN) throw new AppError(429, 'rate_limited', 'Too many codes requested. Please wait a few minutes.');
  const code = config.customerOtpDevCode ?? newCode();
  // Only the newest code can be used: asking for a new one retires the old.
  await app.prisma.otpChallenge.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: new Date() } });
  const challenge = await app.prisma.otpChallenge.create({
    data: { phone, codeHash: otpHash(config.appSecret, phone, code), expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000) },
  });
  if (!config.customerOtpDevCode) {
    if (config.sms) {
      try {
        await sendOtpSms(config.sms, phone, code);
      } catch (e) {
        // Don't leave a live code the customer never received, or count it against their quota.
        await app.prisma.otpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
        app.log.error({ err: (e as Error).message }, 'Could not send the sign-in code');
        throw new AppError(503, 'not_available', 'We could not send the code. Please try again in a moment.');
      }
    } else {
      app.log.warn(`Customer app sign-in code for +${phone}: ${code} (no SMS provider configured; development only)`);
    }
  }
  return { expiresInSec: OTP_TTL_SECONDS };
}

/** Check a code against the newest open challenge for the phone; consumes it on success. */
export async function verifyOtp(prisma: PrismaClient, secret: string, phone: string, code: string): Promise<void> {
  // Requesting a fresh code must not reset the guess counter, so count failures across all of them.
  const failures = await prisma.otpChallenge.aggregate({
    where: { phone, createdAt: { gte: new Date(Date.now() - OTP_FAILURE_WINDOW_MS) } },
    _sum: { attempts: true },
  });
  if ((failures._sum.attempts ?? 0) >= OTP_MAX_FAILURES_PER_WINDOW) {
    throw new AppError(429, 'rate_limited', 'Too many wrong codes. Please wait a few minutes and try again.');
  }
  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) throw new AppError(400, 'invalid_otp', 'That code has expired. Request a new one.');
  const given = Buffer.from(otpHash(secret, phone, code.trim()));
  const expected = Buffer.from(challenge.codeHash);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    throw new AppError(400, 'invalid_otp', 'That code is not right.');
  }
  // Consume atomically so one code can't sign in twice if two requests race.
  const used = await prisma.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (used.count !== 1) throw new AppError(400, 'invalid_otp', 'That code has expired. Request a new one.');
}
