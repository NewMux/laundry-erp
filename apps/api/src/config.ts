import path from 'node:path';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
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

/** Twilio account used to text customer-app sign-in codes. */
export interface SmsConfig {
  accountSid: string;
  authToken: string;
  /** Sender: a Twilio number (+973…), or an alphanumeric sender id where the destination allows it. */
  from: string;
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
   * Leave unset in production (codes are then logged until an SMS provider is connected).
   */
  customerOtpDevCode: string | undefined;
  /** SMS provider for customer-app sign-in codes. Required in production. */
  sms: SmsConfig | undefined;
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
  const twilio = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM;
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
    sms: twilio
      ? { accountSid: process.env.TWILIO_ACCOUNT_SID!, authToken: process.env.TWILIO_AUTH_TOKEN!, from: process.env.TWILIO_FROM! }
      : undefined,
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
