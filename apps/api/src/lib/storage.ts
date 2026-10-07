import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config';
import { AppError, badRequest } from './errors';

/**
 * Where uploaded files (logos, item photos, damage photos, receipts, staff
 * documents) are kept. Keys look like `<tenantId>/<yyyy-mm>/<id>.<ext>` and are
 * stored in FileObject.path; access control stays in the API (files are only
 * served through /api/files/:id after the tenant check).
 *
 * - local:    a directory (UPLOAD_DIR), a persistent volume in Docker.
 * - supabase: a private Supabase Storage bucket, for Vercel (no persistent disk).
 */
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** The file's bytes, or null when it does not exist. */
  get(key: string): Promise<Buffer | null>;
}

/** A store that refuses every call, for deployments with no usable storage. */
function unavailable(message: string): FileStorage {
  const fail = async (): Promise<never> => {
    throw new AppError(503, 'STORAGE_NOT_CONFIGURED', message);
  };
  return { put: fail, get: fail };
}

export function localStorage(root: string): FileStorage {
  const base = path.resolve(root);
  const abs = (key: string) => {
    const p = path.resolve(base, key);
    if (!p.startsWith(base + path.sep)) throw badRequest('Invalid path');
    return p;
  };
  return {
    async put(key, data) {
      const p = abs(key);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, data);
    },
    async get(key) {
      const p = abs(key);
      return fs.existsSync(p) ? fsp.readFile(p) : null;
    },
  };
}

/** Supabase Storage over its REST API, authenticated with the service role (secret) key. */
export function supabaseStorage(url: string, key: string, bucket: string): FileStorage {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const objectUrl = (k: string) => `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${k.split('/').map(encodeURIComponent).join('/')}`;
  return {
    async put(k, data, contentType) {
      const res = await fetch(objectUrl(k), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false', 'Cache-Control': 'max-age=31536000' },
        body: new Uint8Array(data),
      });
      if (!res.ok) throw new Error(`Supabase Storage upload failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
    },
    async get(k) {
      const res = await fetch(objectUrl(k), { headers });
      // A missing object is a 404, or a 400 with {"statusCode":"404"} on older Storage versions.
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Supabase Storage download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Create the private bucket if it does not exist yet (run at deploy time). */
export async function ensureSupabaseBucket(url: string, key: string, bucket: string): Promise<'created' | 'exists'> {
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: false }),
  });
  if (res.ok) return 'created';
  const text = await res.text().catch(() => '');
  if (res.status === 409 || /already exists|Duplicate/i.test(text)) return 'exists';
  throw new Error(`Could not create Supabase Storage bucket "${bucket}": ${res.status} ${text}`.trim());
}

export function createStorage(config: AppConfig): FileStorage {
  const s = config.storage;
  if (s.driver === 'supabase') {
    if (!s.supabaseUrl || !s.supabaseKey) return unavailable('File storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return supabaseStorage(s.supabaseUrl, s.supabaseKey, s.bucket);
  }
  if (config.onVercel) {
    // /tmp on Vercel is per instance and wiped: accepting an upload there would lose it.
    return unavailable('File storage is not configured on this deployment: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return localStorage(config.uploadDir);
}
