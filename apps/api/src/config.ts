import path from 'node:path';
import type { OtpDeliveryConfig } from './lib/otp-delivery';
import { expoPushSender, type PushSend } from './lib/push';
import { parseOtpCountries, parseOtpPilot, type OtpPilot } from './lib/otp-guard';
import { parseTurnstile, type TurnstileConfig } from './lib/captcha';
import { parseMail, type MailConfig } from './lib/mail';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

export interface OtpLimits {
  /** Dial codes codes may be sent to ("973", "971", …), or "any". Default: the six Gulf states. */
  countries: string[] | 'any';
  /** Codes per phone number per 24 hours (on top of 5 per 10 minutes). */
  perPhonePerDay: number;
  /** Codes per source IP per hour. */
  perIpPerHour: number;
  /** Circuit breakers across all customers: past these, no code is sent until the window clears. */
  globalPerHour: number;
  globalPerDay: number;
}

/** Positive integer from the environment, or `fallback` (effectively unlimited under test). */
function intEnv(name: string, fallback: number, unlimited: boolean): number {
  if (unlimited) return 1_000_000;
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export type StorageDriver = 'local' | 'supabase';

export interface StorageConfig {
  driver: StorageDriver;
  /** Supabase project URL, e.g. https://abcd.supabase.co (driver "supabase"). */
  supabaseUrl: string | undefined;
  /** Supabase service role (secret) key — server-side only. */
  supabaseKey: string | undefined;
  /** Private Storage bucket that holds uploads. */
  bucket: string;
}

export interface AppConfig {
  port: number;
  appSecret: string;
  publicUrl: string;
  uploadDir: string;
  chromiumPath: string | undefined;
  cookieSecure: boolean;
  webDist: string | undefined;
  superAdminEmail: string | undefined;
  superAdminPassword: string | undefined;
  /** Shared secret Vercel Cron sends as `Authorization: Bearer …`; cron endpoints are off without it. */
  cronSecret: string | undefined;
  /**
   * Test / staging only: every customer-app sign-in code is this value and nothing is logged.
   * Leave unset in production.
   */
  customerOtpDevCode: string | undefined;
  /** Pilot sign-in: a fixed code for a short list of known phone numbers, no message sent (see parseOtpPilot). */
  otpPilot: OtpPilot | undefined;
  /** Where sign-in codes are sent: WhatsApp. Without it, codes are only logged. */
  otpDelivery: OtpDeliveryConfig;
  /** Abuse limits for sign-in codes (each code is a paid message). */
  otpLimits: OtpLimits;
  /**
   * Anyone may create a laundry account at /signup and start a free trial. Off by default: Ghasla
   * creates the account after the laundry has paid (platform admin). Set PUBLIC_SIGNUP=true to open it.
   */
  publicSignup: boolean;
  /** Bot check on public signup (Cloudflare Turnstile). Off unless both keys are set. */
  turnstile: TurnstileConfig | undefined;
  /** Transactional email (password reset). Off unless RESEND_API_KEY and MAIL_FROM are set. */
  mail: MailConfig | undefined;
  /**
   * Push notifications to the customer app (order updates), sent through Expo. On by default; tests
   * pass their own sender, and PUSH_NOTIFICATIONS=false turns it off. EXPO_ACCESS_TOKEN is only
   * needed when push security is enabled for the Expo project.
   */
  pushSend: PushSend | undefined;
  storage: StorageConfig;
  /** Running as a Vercel Function (no persistent disk, no background process). */
  onVercel: boolean;
  isTest: boolean;
  /** Production deployment (NODE_ENV=production, e.g. the Docker image, or VERCEL_ENV=production). */
  isProduction: boolean;
}

/** The password the docs used to suggest. It is public, so it must never protect the platform admin. */
const KNOWN_DEFAULT_ADMIN_PASSWORDS = new Set(['changeme123!', 'admin1234', 'password', 'password123']);

/** Why this password can't protect the platform super admin, or null if it is acceptable. */
export function adminPasswordProblem(password: string): string | null {
  if (password.length < 12) return 'must be at least 12 characters';
  if (KNOWN_DEFAULT_ADMIN_PASSWORDS.has(password.toLowerCase())) return 'is a well-known default password';
  return null;
}

/**
 * Refuse to start a production deployment with settings that leave it open:
 * a guessable signing secret, the public default admin password, a fixed
 * customer sign-in code, insecure cookies or a plain-HTTP public address.
 * Every problem is reported at once so one deploy fixes them all.
 */
export function assertProductionConfig(c: AppConfig): void {
  const problems: string[] = [];
  if (c.appSecret.length < 32 || /change-?me|placeholder|example|secret-secret/i.test(c.appSecret)) {
    problems.push('APP_SECRET must be a random value of at least 32 characters (openssl rand -hex 32)');
  }
  if (c.superAdminPassword) {
    const why = adminPasswordProblem(c.superAdminPassword);
    if (why) problems.push(`SUPERADMIN_PASSWORD ${why}`);
  }
  if (c.customerOtpDevCode) {
    problems.push('CUSTOMER_OTP_DEV_CODE must not be set in production: it lets anyone sign in as any customer');
  }
  if (c.cronSecret && c.cronSecret.length < 16) problems.push('CRON_SECRET must be at least 16 characters');
  if (!c.cookieSecure) problems.push('COOKIE_SECURE must be true in production');
  if (!c.publicUrl.startsWith('https://')) problems.push('PUBLIC_URL must be an https:// address in production');
  if (problems.length) {
    throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
  }
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const onVercel = process.env.VERCEL === '1';
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const supabaseUrl = process.env.SUPABASE_URL || undefined;
  const isProduction = !isTest && (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production');
  const config: AppConfig = {
    port: Number(env('PORT', '3000')),
    appSecret: env('APP_SECRET', isTest ? 'test-secret-test-secret-test-secret' : undefined),
    publicUrl: env('PUBLIC_URL', vercelUrl ? `https://${vercelUrl}` : 'http://localhost:3000').replace(/\/$/, ''),
    uploadDir: path.resolve(env('UPLOAD_DIR', './uploads')),
    chromiumPath: process.env.CHROMIUM_PATH || undefined,
    // Vercel is always HTTPS, so cookies are Secure there unless explicitly turned off.
    cookieSecure: env('COOKIE_SECURE', onVercel ? 'true' : 'false') === 'true',
    webDist: process.env.WEB_DIST || undefined,
    superAdminEmail: process.env.SUPERADMIN_EMAIL || undefined,
    superAdminPassword: process.env.SUPERADMIN_PASSWORD || undefined,
    cronSecret: process.env.CRON_SECRET || undefined,
    customerOtpDevCode: process.env.CUSTOMER_OTP_DEV_CODE || undefined,
    otpPilot: parseOtpPilot(process.env.CUSTOMER_OTP_PILOT_NUMBERS, process.env.CUSTOMER_OTP_PILOT_CODE),
    publicSignup: env('PUBLIC_SIGNUP', isTest ? 'true' : 'false') === 'true',
    turnstile: parseTurnstile(process.env.TURNSTILE_SITE_KEY, process.env.TURNSTILE_SECRET_KEY),
    mail: parseMail(process.env.RESEND_API_KEY, process.env.MAIL_FROM),
    pushSend: isTest || process.env.PUSH_NOTIFICATIONS === 'false' ? undefined : expoPushSender(process.env.EXPO_ACCESS_TOKEN || undefined),
    otpLimits: {
      countries: parseOtpCountries(process.env.CUSTOMER_OTP_COUNTRIES),
      // The test database is shared by every test and persists between runs, so the defaults
      // are out of reach there; tests that exercise a limit set their own.
      perPhonePerDay: intEnv('CUSTOMER_OTP_MAX_PER_PHONE_DAY', 10, isTest),
      perIpPerHour: intEnv('CUSTOMER_OTP_MAX_PER_IP_HOUR', 10, isTest),
      globalPerHour: intEnv('CUSTOMER_OTP_MAX_PER_HOUR', 300, isTest),
      globalPerDay: intEnv('CUSTOMER_OTP_MAX_PER_DAY', 1000, isTest),
    },
    otpDelivery: {
      whatsapp:
        process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_OTP_TEMPLATE
          ? {
              token: process.env.WHATSAPP_TOKEN,
              phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
              template: process.env.WHATSAPP_OTP_TEMPLATE,
              language: env('WHATSAPP_OTP_LANGUAGE', 'en'),
              apiVersion: env('WHATSAPP_API_VERSION', 'v21.0'),
            }
          : undefined,
    },
    storage: {
      driver: (process.env.STORAGE_DRIVER as StorageDriver | undefined) || (supabaseUrl ? 'supabase' : 'local'),
      supabaseUrl: supabaseUrl?.replace(/\/$/, ''),
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
      bucket: env('SUPABASE_STORAGE_BUCKET', 'uploads'),
    },
    onVercel,
    isTest,
    isProduction,
    ...overrides,
  };
  if (config.isProduction) assertProductionConfig(config);
  return config;
}
