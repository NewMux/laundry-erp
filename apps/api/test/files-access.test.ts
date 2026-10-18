/**
 * Uploaded files: who can read them, who can upload them, and that the bytes
 * must match the declared type.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sniffMime } from '../src/lib/files';
import { Client, createShop, loginAs, setupApp, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => {
  await env.app.close();
  await env.prisma.$disconnect();
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

function multipart(filename: string, contentType: string, content: Buffer | string) {
  const boundary = '----lmsTestBoundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), Buffer.isBuffer(content) ? content : Buffer.from(content), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(c: Client, kind: string, filename: string, type: string, content: Buffer | string) {
  const mp = multipart(filename, type, content);
  const res = await env.app.inject({
    method: 'POST',
    url: `/api/files/upload/${kind}`,
    payload: mp.body,
    headers: { 'content-type': mp.contentType, cookie: Object.entries(c.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  return { status: res.statusCode, json: res.json() };
}

describe('sniffMime', () => {
  it('recognises the supported types from their first bytes', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(GIF)).toBe('image/gif');
    expect(sniffMime(WEBP)).toBe('image/webp');
    expect(sniffMime(PDF)).toBe('application/pdf');
  });
  it('rejects anything else, including scripts and short or empty input', () => {
    expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
    expect(sniffMime(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('upload content check', () => {
  it('accepts a real image and stores the detected type', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const up = await upload(owner, 'damage', 'stain.png', 'image/png', PNG);
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    expect(up.json.mimeType).toBe('image/png');
  });

  it('refuses a script renamed to an image, and a type that does not match the bytes', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const html = await upload(owner, 'damage', 'x.png', 'image/png', '<html><script>alert(1)</script></html>');
    expect(html.status).toBe(400);
    const lie = await upload(owner, 'damage', 'x.jpg', 'image/jpeg', PNG);
    expect(lie.status).toBe(400);
    const pdfAsImage = await upload(owner, 'damage', 'x.png', 'image/png', PDF);
    expect(pdfAsImage.status).toBe(400);
  });

  it('accepts a PDF receipt for expenses but not for photos', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    expect((await upload(owner, 'expense', 'r.pdf', 'application/pdf', PDF)).status).toBe(200);
    expect((await upload(owner, 'damage', 'r.pdf', 'application/pdf', PDF)).status).toBe(400);
  });
});

describe('file permissions', () => {
  it('lets only people with the staff permission read or upload HR documents', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const worker = await loginAs(env.app, shop.slug, 'worker');

    const doc = await upload(owner, 'employee', 'id.pdf', 'application/pdf', PDF);
    expect(doc.status, JSON.stringify(doc.json)).toBe(200);
    expect((await owner.get(`/api/files/${doc.json.id}`)).status).toBe(200);
    expect((await cashier.get(`/api/files/${doc.json.id}`)).status).toBe(403);
    expect((await worker.get(`/api/files/${doc.json.id}`)).status).toBe(403);
    expect((await upload(cashier, 'employee', 'id.pdf', 'application/pdf', PDF)).status).toBe(403);
  });

  it('lets only people with the expenses permission read or upload receipts', async () => {
    const shop = await createShop(env.prisma);
    const owner = await loginAs(env.app, shop.slug, 'owner');
    const manager = await loginAs(env.app, shop.slug, 'manager');
    const cashier = await loginAs(env.app, shop.slug, 'cashier');

    const receipt = await upload(manager, 'expense', 'r.pdf', 'application/pdf', PDF);
    expect(receipt.status, JSON.stringify(receipt.json)).toBe(200);
    expect((await owner.get(`/api/files/${receipt.json.id}`)).status).toBe(200);
    expect((await manager.get(`/api/files/${receipt.json.id}`)).status).toBe(200);
    expect((await cashier.get(`/api/files/${receipt.json.id}`)).status).toBe(403);
    expect((await upload(cashier, 'expense', 'r.pdf', 'application/pdf', PDF)).status).toBe(403);
  });

  it('keeps photos available to the counter and the workshop', async () => {
    const shop = await createShop(env.prisma);
    const cashier = await loginAs(env.app, shop.slug, 'cashier');
    const worker = await loginAs(env.app, shop.slug, 'worker');

    const photo = await upload(cashier, 'damage', 'stain.png', 'image/png', PNG);
    expect(photo.status, JSON.stringify(photo.json)).toBe(200);
    expect((await worker.get(`/api/files/${photo.json.id}`)).status).toBe(200);
    // A worker cannot add catalogue images or HR documents.
    expect((await upload(worker, 'item', 'i.png', 'image/png', PNG)).status).toBe(403);
    expect((await upload(worker, 'employee', 'id.pdf', 'application/pdf', PDF)).status).toBe(403);
  });

  it('never serves another shop\'s file, whatever the permission', async () => {
    const a = await createShop(env.prisma);
    const b = await createShop(env.prisma);
    const ownerA = await loginAs(env.app, a.slug, 'owner');
    const ownerB = await loginAs(env.app, b.slug, 'owner');
    const doc = await upload(ownerA, 'employee', 'id.pdf', 'application/pdf', PDF);
    expect((await ownerB.get(`/api/files/${doc.json.id}`)).status).toBe(404);
  });
});
