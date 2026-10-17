import { z } from 'zod';

/**
 * Imported before any schema is built (see settings.ts). In a browser, turns
 * zod's JIT off.
 *
 * Zod normally probes whether it may compile its parsers with `Function('')`.
 * Under the staff app's Content-Security-Policy (no 'unsafe-eval') the browser
 * blocks that probe and reports a violation, and zod falls back to the
 * interpreted path anyway. Skipping the probe keeps the console clean, so a
 * real violation stands out. The server has no `window` and keeps JIT.
 */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  z.config({ jitless: true });
}
