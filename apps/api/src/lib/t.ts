import { createTranslator } from '@laundry/shared';
import en from '@laundry/shared/locales/en.json';

/** Server-side translator (PDFs, receipts) using the shared translation file. */
export const t = createTranslator(en as Record<string, unknown>);
