import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FileObject } from '@prisma/client';
import { requireTenant } from './context';
import { badRequest } from './errors';
import { cryptoId } from './ids';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const DOC_TYPES = [...IMAGE_TYPES, 'application/pdf'];

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

export type FileKind = 'ITEM_IMAGE' | 'DAMAGE_PHOTO' | 'EXPENSE_RECEIPT' | 'EMPLOYEE_DOC' | 'LOGO';

/** Read one multipart file from the request and store it under the tenant's folder. */
export async function saveUpload(
  app: FastifyInstance,
  req: FastifyRequest,
  kind: FileKind,
  allowed: string[] = IMAGE_TYPES,
): Promise<{ file: FileObject; fields: Record<string, string> }> {
  const a = requireTenant(req);
  const part = await req.file();
  if (!part) throw badRequest('No file uploaded');
  if (!allowed.includes(part.mimetype)) throw badRequest(`File type ${part.mimetype} is not allowed`);
  const buf = await part.toBuffer();
  if (part.file.truncated) throw badRequest('File is too large (max 10 MB)');
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(part.fields)) {
    const f = v as { type?: string; value?: unknown };
    if (f && f.type === 'field') fields[k] = String(f.value ?? '');
  }
  const id = cryptoId();
  const month = new Date().toISOString().slice(0, 7);
  const rel = path.join(a.tenant.id, month, `${id}.${EXT[part.mimetype] ?? 'bin'}`);
  const abs = path.join(app.config.uploadDir, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  const file = await app.tdb(req).fileObject.create({
    data: {
      id,
      tenantId: a.tenant.id,
      kind,
      path: rel,
      mimeType: part.mimetype,
      size: buf.length,
      originalName: part.filename?.slice(0, 200) ?? null,
      createdById: a.user.id,
    },
  });
  return { file, fields };
}

export function filePath(app: FastifyInstance, f: Pick<FileObject, 'path'>): string {
  const abs = path.resolve(app.config.uploadDir, f.path);
  if (!abs.startsWith(path.resolve(app.config.uploadDir))) throw badRequest('Invalid path');
  return abs;
}

/** Inline a stored image as a data: URI (for server-rendered PDFs). */
export async function fileDataUri(app: FastifyInstance, f: Pick<FileObject, 'path' | 'mimeType'> | null): Promise<string | null> {
  if (!f) return null;
  const abs = filePath(app, f);
  if (!fs.existsSync(abs)) return null;
  const buf = await fsp.readFile(abs);
  return `data:${f.mimeType};base64,${buf.toString('base64')}`;
}
