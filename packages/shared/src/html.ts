/** Minimal HTML escaping for server/client rendered print templates. */
export function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function nl2br(v: unknown): string {
  return esc(v).replace(/\r?\n/g, '<br>');
}

export type TFn = (key: string, vars?: Record<string, unknown>) => string;

/** Build a translator from a nested dictionary using i18next-style {{var}} interpolation. */
export function createTranslator(dict: Record<string, unknown>): TFn {
  return (key, vars) => {
    let cur: unknown = dict;
    for (const part of key.split('.')) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
      else {
        cur = undefined;
        break;
      }
    }
    let s = typeof cur === 'string' ? cur : key;
    if (vars) s = s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(vars[k] ?? ''));
    return s;
  };
}
