/**
 * Security headers of the staff web app. On Vercel the app is served by the web
 * service, whose headers come from vercel.json; in Docker the API serves it with
 * helmet. Both must send the same Content-Security-Policy (src/lib/csp.ts).
 */
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { CSP_DIRECTIVES, cspHeader } from '../src/lib/csp';
import { createPrisma } from '../src/lib/prisma';

type Rule = { source: string; headers: { key: string; value: string }[] };
const vercel = JSON.parse(fs.readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'));
const webRules: Rule[] = vercel.services.web.headers;
const allPaths = webRules.find((r) => r.source === '/(.*)')!;
const header = (name: string) => allPaths.headers.find((h) => h.key === name)?.value;
/** Compare policies ignoring spacing and order. */
const directives = (csp: string) => csp.split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean).sort();

let prisma: PrismaClient;
let app: FastifyInstance;
beforeAll(async () => {
  prisma = createPrisma();
  app = await buildApp(prisma, loadConfig({ isTest: true }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Content-Security-Policy', () => {
  it('is the same on Vercel (vercel.json) as in the API', async () => {
    expect(directives(header('Content-Security-Policy')!)).toEqual(directives(cspHeader()));
    const res = await app.inject({ url: '/api/health' });
    expect(directives(String(res.headers['content-security-policy']))).toEqual(directives(cspHeader()));
  });

  it('keeps the protections that matter', () => {
    const csp = directives(cspHeader());
    expect(csp).toContain("default-src 'self'");
    // No inline scripts, no eval, and no host but Cloudflare Turnstile (the signup bot check).
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(CSP_DIRECTIVES.scriptSrc).toEqual(["'self'", 'https://challenges.cloudflare.com']);
    expect(JSON.stringify(CSP_DIRECTIVES.scriptSrc)).not.toMatch(/unsafe|\*/);
    expect(cspHeader()).not.toMatch(/unsafe-eval|\*/);
  });
});

describe('web service headers in vercel.json', () => {
  it('sends the security headers on every path', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('allows the camera for the barcode scanner and nothing else sensitive', () => {
    const policy = header('Permissions-Policy')!;
    expect(policy).toContain('camera=(self)');
    for (const feature of ['microphone', 'geolocation', 'payment', 'usb']) expect(policy).toContain(`${feature}=()`);
  });

  it('keeps the cache rules', () => {
    const cache = (source: string) => webRules.find((r) => r.source === source)?.headers.find((h) => h.key === 'Cache-Control')?.value;
    expect(cache('/assets/(.*)')).toMatch(/immutable/);
    expect(cache('/(sw.js|index.html|manifest.webmanifest)')).toBe('no-cache');
  });
});

describe('API responses', () => {
  it('are not sniffed or framed', async () => {
    const res = await app.inject({ url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});
