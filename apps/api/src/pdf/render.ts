import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright-core';

/**
 * Server-side PDF generation with headless Chromium. HTML templates give us
 * proper Arabic shaping (customer names/notes) and identical output everywhere.
 *
 * Which Chromium:
 * - CHROMIUM_PATH, or a system Chromium (Docker image, dev containers);
 * - on Vercel / AWS Lambda: @sparticuz/chromium, a Chromium build made for
 *   serverless (unpacked to /tmp on the first PDF of each function instance);
 * - otherwise Playwright's own downloaded browser (`npx playwright install chromium`).
 */
let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;
let active = 0;
const MAX_CONCURRENT = 3;
const queue: (() => void)[] = [];
/** True when the browser is @sparticuz/chromium, which has no Noto fonts of its own. */
let serverlessChromium = false;

const isServerless = () => !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function chromiumPath(): string | undefined {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'];

async function launchOptions(): Promise<LaunchOptions> {
  const local = chromiumPath();
  if (local || !isServerless()) return { executablePath: local, args: BASE_ARGS };
  const { default: serverless } = await import('@sparticuz/chromium');
  serverless.setGraphicsMode = false; // PDFs need no WebGL; skips unpacking SwiftShader
  serverlessChromium = true;
  return { executablePath: await serverless.executablePath(), args: [...serverless.args, '--disable-dev-shm-usage'], headless: true };
}

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchOptions()
      .then((opts) => chromium.launch(opts))
      .then((b) => {
        b.on('disconnected', () => {
          browserPromise = null;
          contextPromise = null;
        });
        return b;
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
}

/**
 * A fresh page for one PDF. The serverless Chromium runs with --single-process,
 * where closing a browser context takes the whole browser down, so there all
 * pages share one long-lived context and only the pages are closed.
 */
async function newPage(): Promise<Page> {
  const b = await browser();
  if (!serverlessChromium) return b.newPage();
  contextPromise ??= b.newContext().catch((e) => {
    contextPromise = null;
    throw e;
  });
  return (await contextPromise).newPage();
}

/**
 * The templates ask for "Noto Sans" / "Noto Sans Arabic". The Docker image
 * installs them as system fonts; the serverless Chromium has none, so there
 * we embed the same fonts from @fontsource
 * (Latin, Devanagari, Arabic; 400/700). Other scripts, e.g. Malayalam or Tamil,
 * fall back to the few fonts bundled with the serverless Chromium.
 */
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const DEVANAGARI = 'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+25CC,U+A830-A839,U+A8E0-A8FF';
const ARABIC = 'U+0600-06FF,U+0750-077F,U+0870-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFC';
type FontFile = { family: string; file: string; weight: number; range: string };
const FONT_FILES: FontFile[] = [400, 700].flatMap((weight) => [
  { family: 'Noto Sans', file: `@fontsource/noto-sans/files/noto-sans-latin-${weight}-normal.woff2`, weight, range: LATIN },
  { family: 'Noto Sans', file: `@fontsource/noto-sans/files/noto-sans-latin-ext-${weight}-normal.woff2`, weight, range: LATIN_EXT },
  { family: 'Noto Sans', file: `@fontsource/noto-sans/files/noto-sans-devanagari-${weight}-normal.woff2`, weight, range: DEVANAGARI },
  { family: 'Noto Sans Arabic', file: `@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-${weight}-normal.woff2`, weight, range: ARABIC },
]);
let fontCss: string | null = null;

function embeddedFontCss(): string {
  if (fontCss === null) {
    const require = createRequire(import.meta.url);
    fontCss = FONT_FILES.map(({ family, file, weight, range }) => {
      const data = fs.readFileSync(require.resolve(file)).toString('base64');
      return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range}}`;
    }).join('');
  }
  return fontCss;
}

/** Add the embedded fonts to a document (only needed with the serverless Chromium). */
export function withEmbeddedFonts(html: string): string {
  const style = `<style>${embeddedFontCss()}</style>`;
  return html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : `${style}${html}`;
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

export interface PdfOptions {
  /** 'A4' (default) or a receipt width such as '80mm' (height is measured). */
  format?: 'A4' | '80mm';
  landscape?: boolean;
}

export async function renderPdf(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  return slot(async () => {
    const page = await newPage();
    try {
      await page.setContent(serverlessChromium ? withEmbeddedFonts(html) : html, { waitUntil: 'load', timeout: 20000 });
      if (serverlessChromium) await page.evaluate(() => document.fonts.ready);
      if (opts.format === '80mm') {
        await page.setViewportSize({ width: 302, height: 50 });
        const height = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
        // 1 CSS px = 1/96 in; add a little bottom margin for the cutter.
        const mm = Math.ceil((height / 96) * 25.4) + 6;
        return await page.pdf({ width: '80mm', height: `${mm}mm`, printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
      }
      return await page.pdf({
        format: 'A4',
        landscape: !!opts.landscape,
        printBackground: true,
        margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-size:8px;color:#888;width:100%;text-align:center;font-family:sans-serif">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}

export async function closePdf(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  contextPromise = null;
  await b?.close().catch(() => undefined);
}
