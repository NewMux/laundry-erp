/** Thin fetch wrapper for the JSON API (cookie session, same origin). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Listener = (e: ApiError) => void;
const listeners = new Set<Listener>();
/** Subscribe to API errors globally (e.g. 401 → back to login, 402 → read-only banner). */
export function onApiError(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let code = 'ERROR';
    let message = res.statusText || 'Request failed';
    let details: unknown;
    if (type.includes('application/json')) {
      const j = await res.json().catch(() => null);
      if (j?.error) {
        code = j.error.code;
        message = j.error.message;
        details = j.error.details;
      }
    }
    const err = new ApiError(res.status, code, message, details);
    listeners.forEach((l) => l(err));
    throw err;
  }
  if (type.includes('application/json')) return (await res.json()) as T;
  return (await res.blob()) as unknown as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T = any>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T = any>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  upload: <T = any>(url: string, file: File, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', file);
    return request<T>('POST', url, fd);
  },
};

/** Build a query string from defined values. */
export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Open a server-generated file (PDF) in a new tab, or download it (Excel). */
export async function openFile(url: string, opts: { download?: string } = {}) {
  if (!opts.download) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const blob = await request<Blob>('GET', url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = opts.download;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
