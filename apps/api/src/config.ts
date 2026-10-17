import path from 'node:path';
import type { OtpDeliveryConfig } from './lib/otp-delivery';

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
  /**
   * Test / staging only: every customer-app sign-in code is this value and nothing is logged.
   * Leave unset in production.
   */
  customerOtpDevCode: string | undefined;
  /** Where sign-in codes are sent: WhatsApp first, SMS as the fallback. With neither set, codes are only logged. */
  otpDelivery: OtpDeliveryConfig;
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
    customerOtpDevCode: process.env.CUSTOMER_OTP_DEV_CODE || undefined,
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
      twilio:
        process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
          ? {
              accountSid: process.env.TWILIO_ACCOUNT_SID,
              authToken: process.env.TWILIO_AUTH_TOKEN,
              from: process.env.TWILIO_FROM || undefined,
              messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
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
    ...overrides,
  };
}
