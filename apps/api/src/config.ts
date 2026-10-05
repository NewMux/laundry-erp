import path from 'node:path';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
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
  isTest: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  return {
    port: Number(env('PORT', '3000')),
    appSecret: env('APP_SECRET', isTest ? 'test-secret-test-secret-test-secret' : undefined),
    publicUrl: env('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),
    uploadDir: path.resolve(env('UPLOAD_DIR', './uploads')),
    chromiumPath: process.env.CHROMIUM_PATH || undefined,
    cookieSecure: env('COOKIE_SECURE', 'false') === 'true',
    webDist: process.env.WEB_DIST || undefined,
    superAdminEmail: process.env.SUPERADMIN_EMAIL || undefined,
    superAdminPassword: process.env.SUPERADMIN_PASSWORD || undefined,
    isTest,
    ...overrides,
  };
}
