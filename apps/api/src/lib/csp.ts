/**
 * Content-Security-Policy for the staff web app.
 *
 * The app is a same-origin SPA: its own scripts and styles, images from the API
 * (and data:/blob: for previews and printing), no third-party hosts. The
 * barcode camera is plain JavaScript (no WebAssembly or eval), so scripts are
 * 'self' only.
 *
 * The API sends this on every response (helmet, see app.ts), which covers the
 * Docker deployment where the API serves the app. On Vercel the app is served
 * by the web service, so `vercel.json` carries the same policy as a header;
 * test/security-headers.test.ts fails if the two drift apart.
 */
/** Cloudflare Turnstile (the signup bot check) loads one script and one frame from here, nothing else. */
const TURNSTILE_HOST = 'https://challenges.cloudflare.com';

export const CSP_DIRECTIVES: Record<string, string[]> = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", TURNSTILE_HOST],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  frameSrc: ["'self'", 'blob:', 'data:', TURNSTILE_HOST],
  workerSrc: ["'self'", 'blob:'],
  manifestSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
};

/** The policy as a header value: `default-src 'self'; script-src 'self'; …` */
export function cspHeader(directives: Record<string, string[]> = CSP_DIRECTIVES): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${values.join(' ')}`)
    .join('; ');
}
