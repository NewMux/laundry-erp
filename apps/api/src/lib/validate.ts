import { z } from 'zod';
import { isValidDate } from '@laundry/shared';
import { AppError } from './errors';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path?.length ? `${first.path.join('.')}: ` : '';
    throw new AppError(400, 'VALIDATION', `${where}${first?.message ?? 'Invalid input'}`, r.error.issues);
  }
  return r.data;
}

/** Common field schemas */
export const zMoney = z.coerce.number().min(0).max(1_000_000).transform((v) => Math.round(v * 1000) / 1000);
export const zSignedMoney = z.coerce.number().min(-1_000_000).max(1_000_000).transform((v) => Math.round(v * 1000) / 1000);
export const zDate = z.string().refine(isValidDate, 'Invalid date (YYYY-MM-DD)');
export const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Invalid month (YYYY-MM)');
export const zId = z.string().min(1).max(64);
export const zOptStr = (max = 500) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim()));

export const zPaging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
