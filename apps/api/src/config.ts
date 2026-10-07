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
  storage: StorageConfig;
  /** Running as a Vercel Function (no persistent disk, no background process). */
  onVercel: boolean;
  isTest: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const onVercel = process.env.VERCEL === '1';
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const supabaseUrl = process.env.SUPABASE_URL || undefined;
  return {
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
    storage: {
      driver: (process.env.STORAGE_DRIVER as StorageDriver | undefined) || (supabaseUrl ? 'supabase' : 'local'),
      supabaseUrl: supabaseUrl?.replace(/\/$/, ''),
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
      bucket: env('SUPABASE_STORAGE_BUCKET', 'uploads'),
    },
    onVercel,
    isTest,
    ...overrides,
  };
}
