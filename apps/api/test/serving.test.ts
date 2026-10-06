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
