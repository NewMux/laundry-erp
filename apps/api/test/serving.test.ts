/** Production serving: the API and the built single-page app on one port. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/lib/prisma';

let app: FastifyInstance;
let prisma: PrismaClient;
const webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'web-dist-'));

beforeAll(async () => {
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>App</title>');
  fs.writeFileSync(path.join(webDist, 'assets', 'app-123.js'), 'console.log(1)');
  for (const page of ['privacy', 'terms', 'support']) fs.writeFileSync(path.join(webDist, `${page}.html`), `<!doctype html><title>legal ${page}</title>`);
  prisma = createPrisma();
  app = await buildApp(prisma, loadConfig({ isTest: true, webDist }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  fs.rmSync(webDist, { recursive: true, force: true });
});

describe('static web app', () => {
  it('serves index.html for client-side routes without caching', async () => {
    const r = await app.inject({ method: 'GET', url: '/orders/board' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed assets with long-lived caching', async () => {
    const r = await app.inject({ method: 'GET', url: '/assets/app-123.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toContain('immutable');
  });

  it('answers unknown API routes with a JSON 404, not the app shell', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
  });

  it('does not serve files outside the web root', async () => {
    const r = await app.inject({ method: 'GET', url: '/..%2F..%2Fetc%2Fpasswd' });
    expect(r.body).not.toContain('root:');
  });
});

describe('public legal pages', () => {
  it.each(['privacy', 'terms', 'support'])('serves /%s as its own page, not the app shell', async (page) => {
    const r = await app.inject({ method: 'GET', url: `/${page}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain(`legal ${page}`);
    // Same page at its file name, and no script may run on it under the app's Content-Security-Policy.
    expect((await app.inject({ method: 'GET', url: `/${page}.html` })).body).toContain(`legal ${page}`);
    expect(String(r.headers['content-security-policy'])).toContain("script-src 'self'");
  });

  it('still serves the app shell for other client-side routes', async () => {
    const r = await app.inject({ method: 'GET', url: '/settings/privacy-mode' });
    expect(r.body).toContain('<title>App</title>');
  });

  it('ships real pages: English and Arabic, no scripts, no placeholder addresses, a working contact', () => {
    const publicDir = path.resolve(__dirname, '../../web/public');
    for (const page of ['privacy', 'terms', 'support']) {
      const html = fs.readFileSync(path.join(publicDir, `${page}.html`), 'utf8');
      expect(html, page).toContain('<section id="en" lang="en" dir="ltr">');
      expect(html, page).toContain('<section id="ar" lang="ar" dir="rtl">');
      expect(html, page).toContain('mailto:info@newmux.com');
      expect(html, page).not.toMatch(/<script|javascript:|onclick=/i);
      expect(html, page).not.toMatch(/newmux\.app|example\.com|lorem|TODO|\[.*?\]\(/i);
      // The product is called Ghasla (غسلة in Arabic); only the support mailbox keeps the company domain.
      expect(html, page).toContain('Ghasla');
      expect(html, page).toContain('غسلة');
      expect(html.replace(/info@newmux\.com/g, ''), page).not.toMatch(/newmux/i);
    }
    expect(fs.existsSync(path.join(publicDir, 'legal.css'))).toBe(true);
  });
});

describe('on Vercel', () => {
  it('never serves the web app from the API, even with a web build present', async () => {
    const vercelApp = await buildApp(prisma, loadConfig({ isTest: true, webDist, onVercel: true }));
    await vercelApp.ready();
    expect((await vercelApp.inject({ method: 'GET', url: '/orders/board' })).statusCode).toBe(404);
    expect((await vercelApp.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    await vercelApp.close();
  });
});
