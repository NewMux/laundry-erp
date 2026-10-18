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

/**
 * The real type of an upload, from its first bytes. The browser-declared type is only a claim,
 * so it is checked against this and never stored.
 */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const head6 = buf.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  // PDF readers accept the header anywhere in the first 1024 bytes.
  if (buf.subarray(0, 1024).includes('%PDF-', 0, 'latin1')) return 'application/pdf';
  return null;
}

/** Read one multipart file from the request and store it under the tenant's prefix. */
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
  // Trust the bytes, not the declared type: a script renamed to .png must not be stored as an image.
  const mimeType = sniffMime(buf);
  if (!mimeType || mimeType !== part.mimetype) throw badRequest('The file content does not match its type');
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(part.fields)) {
    const f = v as { type?: string; value?: unknown };
    if (f && f.type === 'field') fields[k] = String(f.value ?? '');
  }
  const id = cryptoId();
  const month = new Date().toISOString().slice(0, 7);
  const rel = `${a.tenant.id}/${month}/${id}.${EXT[mimeType] ?? 'bin'}`;
  await app.storage.put(rel, buf, mimeType);
  const file = await app.tdb(req).fileObject.create({
    data: {
      id,
      tenantId: a.tenant.id,
      kind,
      path: rel,
      mimeType,
      size: buf.length,
      originalName: part.filename?.slice(0, 200) ?? null,
      createdById: a.user.id,
    },
  });
  return { file, fields };
}

/** A stored file's bytes, or null if it is missing from storage. */
export function readFile(app: FastifyInstance, f: Pick<FileObject, 'path'>): Promise<Buffer | null> {
  return app.storage.get(f.path);
}

/** Inline a stored image as a data: URI (for server-rendered PDFs). */
export async function fileDataUri(app: FastifyInstance, f: Pick<FileObject, 'path' | 'mimeType'> | null): Promise<string | null> {
  if (!f) return null;
  const buf = await readFile(app, f);
  return buf ? `data:${f.mimeType};base64,${buf.toString('base64')}` : null;
}
