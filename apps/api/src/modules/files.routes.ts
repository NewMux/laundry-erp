import type { FastifyInstance } from 'fastify';
import type { Action, Module } from '@laundry/shared';
import { z } from 'zod';
import { anyPerm, requireTenant, userCan } from '../lib/context';
import { forbidden, notFound } from '../lib/errors';
import { DOC_TYPES, IMAGE_TYPES, readFile, saveUpload, type FileKind } from '../lib/files';
import { parse } from '../lib/validate';

type Need = [Module, Action][];

/**
 * Who may upload and read each kind of file. Ids are unguessable but appear in API responses,
 * so holding an id must not be enough: HR documents follow the staff permission and receipts
 * follow expenses. Item images and the logo are shown on receipts and the counter, so any
 * signed-in user of the shop may read them.
 */
const KINDS: Record<string, { kind: FileKind; types: string[]; upload: Need }> = {
  damage: { kind: 'DAMAGE_PHOTO', types: IMAGE_TYPES, upload: [['pos', 'create'], ['pos', 'edit'], ['tracking', 'edit']] },
  item: { kind: 'ITEM_IMAGE', types: IMAGE_TYPES, upload: [['catalog', 'edit']] },
  expense: { kind: 'EXPENSE_RECEIPT', types: DOC_TYPES, upload: [['expenses', 'create'], ['expenses', 'edit']] },
  employee: { kind: 'EMPLOYEE_DOC', types: DOC_TYPES, upload: [['staff', 'create'], ['staff', 'edit']] },
};

const READ: Partial<Record<string, Need>> = {
  EMPLOYEE_DOC: [['staff', 'view']],
  EXPENSE_RECEIPT: [['expenses', 'view']],
  DAMAGE_PHOTO: [['pos', 'view'], ['tracking', 'view'], ['delivery', 'view']],
};

export default async function filesRoutes(app: FastifyInstance) {
  /** Upload a file; returns its id to attach to a record. */
  app.post('/upload/:kind', async (req) => {
    requireTenant(req);
    const { kind } = parse(z.object({ kind: z.enum(['damage', 'item', 'expense', 'employee']) }), req.params);
    const k = KINDS[kind];
    await anyPerm(...k.upload)(req);
    const { file } = await saveUpload(app, req, k.kind, k.types);
    return { id: file.id, mimeType: file.mimeType, name: file.originalName };
  });

  /** Stream a stored file. Only files of the signed-in user's shop are reachable. */
  app.get('/:id', async (req, reply) => {
    requireTenant(req);
    const { id } = parse(z.object({ id: z.string().min(1).max(64) }), req.params);
    const f = await app.tdb(req).fileObject.findFirst({ where: { id } });
    if (!f) throw notFound('File');
    const need = READ[f.kind];
    if (need && !need.some(([m, act]) => userCan(req, m, act))) throw forbidden();
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
