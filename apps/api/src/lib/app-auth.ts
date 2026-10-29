import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppUser, PrismaClient } from '@prisma/client';
import { AppError } from './errors';
import { randomToken, sha256 } from './crypto';
import { deliverOtp, otpChannels } from './otp-delivery';
import { otpCountryAllowed } from './otp-guard';

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

/**
 * Issue a sign-in code for a phone number and send it on WhatsApp.
 *
 * Every code is a paid message, so it is refused before anything is created or sent
 * unless the number is in a country we serve and the phone, the source IP and the
 * service as a whole are all under their limits. The limits are counted in the
 * database (not in memory), so they hold across serverless instances.
 *
 * With no channel configured (dev, staging) the code is written to the server
 * log instead, or — for test and staging only — every code is the fixed value
 * in CUSTOMER_OTP_DEV_CODE and nothing is sent. Never set that variable in production.
 * For a pilot with a few known people, CUSTOMER_OTP_PILOT_NUMBERS / _PILOT_CODE give
 * just those numbers a fixed code (no message is sent); other numbers are unaffected. A listed
 * number uses the pilot code even when CUSTOMER_OTP_DEV_CODE is also set.
 */
export async function issueOtp(app: FastifyInstance, phone: string, ip: string): Promise<{ expiresInSec: number }> {
  const limits = app.config.otpLimits;
  if (!otpCountryAllowed(phone, limits.countries)) {
    throw new AppError(400, 'unsupported_country', 'Sign-in codes cannot be sent to this number yet.');
  }

  const now = Date.now();
  const ipHash = sha256(`${app.config.appSecret}:ip:${ip}`);
  // A pilot number signs in with the fixed pilot code and is never sent a message. The pilot code
  // wins over CUSTOMER_OTP_DEV_CODE: a dev code left in the environment must not make the pilot
  // code (the one the testers were given) fail with "That code is not right".
  const pilotCode = app.config.otpPilot?.numbers.has(phone) ? app.config.otpPilot.code : undefined;
  const code = pilotCode ?? app.config.customerOtpDevCode ?? newCode();

  // Record the request first, then count (this one included) and back out if over a limit.
  // Counting first would let a burst of simultaneous requests all see an empty table and all
  // pass; this way, however many arrive at once, at most `limit` of them find themselves within it.
  const challenge = await app.prisma.otpChallenge.create({
    data: { phone, ipHash, codeHash: otpHash(app.config.appSecret, phone, code), expiresAt: new Date(now + OTP_TTL_SECONDS * 1000) },
  });
  const ago = (ms: number) => new Date(now - ms);
  const count = (where: object) => app.prisma.otpChallenge.count({ where });
  const [phone10m, phoneDay, ipHour, allHour, allDay] = await Promise.all([
    count({ phone, createdAt: { gte: ago(10 * 60_000) } }),
    count({ phone, createdAt: { gte: ago(24 * 3_600_000) } }),
    count({ ipHash, createdAt: { gte: ago(3_600_000) } }),
    count({ createdAt: { gte: ago(3_600_000) } }),
    count({ createdAt: { gte: ago(24 * 3_600_000) } }),
  ]);
  const refuse = async (error: AppError): Promise<never> => {
    // A refused request leaves no trace, so hammering cannot keep a number or a shop locked out.
    await app.prisma.otpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    throw error;
  };
  if (phone10m > OTP_PER_PHONE_PER_10_MIN || phoneDay > limits.perPhonePerDay || ipHour > limits.perIpPerHour) {
    return refuse(new AppError(429, 'rate_limited', 'Too many codes requested. Please wait a few minutes.'));
  }
  if (allHour > limits.globalPerHour || allDay > limits.globalPerDay) {
    // Someone may be farming codes; stop spending until the window clears and make it visible.
    app.log.error({ allHour, allDay, limits }, 'Sign-in code circuit breaker tripped: possible SMS-pumping attack or unusually high demand');
    return refuse(new AppError(503, 'otp_busy', 'Sign-in is busy right now. Please try again in a few minutes.'));
  }

  if (app.config.customerOtpDevCode || pilotCode) return { expiresInSec: OTP_TTL_SECONDS };

  const channels = otpChannels(app.config.otpDelivery);
  if (channels.length === 0) {
    if (app.config.isProduction) {
      // Anyone who can read the logs could take over a customer's account, so a production
      // deployment never writes a code there: with no channel, only pilot numbers can sign in.
      await app.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      app.log.error('Customer sign-in is unavailable: WhatsApp is not configured (WHATSAPP_*).');
      throw new AppError(503, 'otp_unavailable', 'Sign-in is temporarily unavailable. Please try again later.');
    }
    app.log.warn({ phone }, `Customer app sign-in code for +${phone}: ${code} (WhatsApp not configured; development only)`);
    return { expiresInSec: OTP_TTL_SECONDS };
  }
  if (!(await deliverOtp(channels, phone, code, app.log))) {
    // Nothing reached the customer, so the code must not stay usable.
    await app.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    throw new AppError(503, 'otp_unavailable', 'We could not send your code. Please try again in a moment.');
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
