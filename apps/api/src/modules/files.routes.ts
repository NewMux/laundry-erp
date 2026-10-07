import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireTenant } from '../lib/context';
import { notFound } from '../lib/errors';
import { DOC_TYPES, IMAGE_TYPES, readFile, saveUpload, type FileKind } from '../lib/files';
import { parse } from '../lib/validate';

const KINDS: Record<string, { kind: FileKind; types: string[] }> = {
  damage: { kind: 'DAMAGE_PHOTO', types: IMAGE_TYPES },
  item: { kind: 'ITEM_IMAGE', types: IMAGE_TYPES },
  expense: { kind: 'EXPENSE_RECEIPT', types: DOC_TYPES },
  employee: { kind: 'EMPLOYEE_DOC', types: DOC_TYPES },
};

export default async function filesRoutes(app: FastifyInstance) {
  /** Upload a file; returns its id to attach to a record. */
  app.post('/upload/:kind', async (req) => {
    requireTenant(req);
    const { kind } = parse(z.object({ kind: z.enum(['damage', 'item', 'expense', 'employee']) }), req.params);
    const k = KINDS[kind];
    const { file } = await saveUpload(app, req, k.kind, k.types);
    return { id: file.id, mimeType: file.mimeType, name: file.originalName };
  });

  /** Stream a stored file. Only files of the signed-in user's shop are reachable. */
  app.get('/:id', async (req, reply) => {
    requireTenant(req);
    const { id } = parse(z.object({ id: z.string().min(1).max(64) }), req.params);
    const f = await app.tdb(req).fileObject.findFirst({ where: { id } });
    if (!f) throw notFound('File');
    const data = await readFile(app, f);
    if (!data) throw notFound('File');
    reply.header('Content-Type', f.mimeType);
    reply.header('Cache-Control', 'private, max-age=86400');
    if (f.originalName && f.mimeType === 'application/pdf') {
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(f.originalName)}"`);
    }
    return reply.send(data);
  });
}
