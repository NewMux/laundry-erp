/** Uploads in Supabase Storage (Vercel), against a local fake of the Storage REST API. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/lib/prisma';
import { ensureSupabaseBucket } from '../src/lib/storage';
import { Client, createShop, loginAs } from './helpers';

const KEY = 'sb_secret_test';
const objects = new Map<string, { type: string; data: Buffer }>();
const buckets = new Set<string>();
const seenKeys: string[] = [];
let fake: http.Server;
let url: string;

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seenKeys.push(String(req.headers.apikey));
      if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end();
      const u = decodeURIComponent(req.url ?? '');
      if (req.method === 'POST' && u === '/storage/v1/bucket') {
        const { id } = JSON.parse(Buffer.concat(chunks).toString());
        if (buckets.has(id)) return res.writeHead(400, { 'content-type': 'application/json' }).end('{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}');
        buckets.add(id);
        return res.writeHead(200).end('{}');
      }
      const m = u.match(/^\/storage\/v1\/object\/(.+)$/);
      if (!m) return res.writeHead(404).end();
      if (req.method === 'POST') {
        objects.set(m[1], { type: String(req.headers['content-type']), data: Buffer.concat(chunks) });
        return res.writeHead(200).end('{}');
      }
      const o = objects.get(m[1]);
      if (!o) return res.writeHead(400, { 'content-type': 'application/json' }).end('{"statusCode":"404","error":"not_found"}');
      res.writeHead(200, { 'content-type': o.type }).end(o.data);
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => fake.close(() => resolve())));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function upload(app: FastifyInstance, c: Client, path: string) {
  const boundary = '----lmsStorageTest';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="stain.png"\r\nContent-Type: image/png\r\n\r\n`),
    PNG,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const cookie = Object.entries(c.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return app.inject({ method: 'POST', url: path, payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie } });
}

describe('Supabase Storage driver', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  beforeAll(async () => {
    prisma = createPrisma();
    const base = loadConfig({ isTest: true });
    app = await buildApp(prisma, { ...base, storage: { driver: 'supabase', supabaseUrl: url, supabaseKey: KEY, bucket: 'uploads' } });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('stores uploads in the bucket under the tenant prefix and serves them back only to that tenant', async () => {
    const a = await createShop(prisma);
    const b = await createShop(prisma);
    const ca = await loginAs(app, a.slug, 'cashier');
    const cb = await loginAs(app, b.slug, 'cashier');
    const up = await upload(app, ca, '/api/files/upload/damage');
    expect(up.statusCode, up.body).toBe(200);
    const key = [...objects.keys()].find((k) => k.startsWith(`uploads/${a.tenant.id}/`));
    expect(key).toBeDefined();
    expect(objects.get(key!)!.type).toBe('image/png');

    const got = await ca.get(`/api/files/${up.json().id}`);
    expect(got.status).toBe(200);
    expect(got.raw.rawPayload.equals(PNG)).toBe(true);
    expect((await cb.get(`/api/files/${up.json().id}`)).status).toBe(404);
    expect(seenKeys.every((k) => k === KEY)).toBe(true);
  });

  it('answers 404 when the object is missing from the bucket', async () => {
    const shop = await createShop(prisma);
    const c = await loginAs(app, shop.slug, 'cashier');
    const up = await upload(app, c, '/api/files/upload/damage');
    objects.clear();
    expect((await c.get(`/api/files/${up.json().id}`)).status).toBe(404);
  });

  it('creates the bucket once', async () => {
    expect(await ensureSupabaseBucket(url, KEY, 'test-bucket')).toBe('created');
    expect(await ensureSupabaseBucket(url, KEY, 'test-bucket')).toBe('exists');
  });
});

describe('on Vercel without Supabase Storage', () => {
  it('refuses uploads instead of writing to the ephemeral disk', async () => {
    const prisma = createPrisma();
    const app = await buildApp(prisma, loadConfig({ isTest: true, onVercel: true }));
    await app.ready();
    const shop = await createShop(prisma);
    const c = await loginAs(app, shop.slug, 'cashier');
    const up = await upload(app, c, '/api/files/upload/damage');
    expect(up.statusCode).toBe(503);
    expect(up.json().error.code).toBe('STORAGE_NOT_CONFIGURED');
    await app.close();
    await prisma.$disconnect();
  });
});
