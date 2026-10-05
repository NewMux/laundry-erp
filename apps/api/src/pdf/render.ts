import fs from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

/**
 * Server-side PDF generation with headless Chromium. HTML templates give us
 * proper Arabic shaping (customer names/notes) and identical output everywhere.
 */
let browserPromise: Promise<Browser> | null = null;
let active = 0;
const MAX_CONCURRENT = 3;
const queue: (() => void)[] = [];

function chromiumPath(): string | undefined {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        executablePath: chromiumPath(),
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
      })
      .then((b) => {
        b.on('disconnected', () => {
          browserPromise = null;
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
    const b = await browser();
    const page = await b.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
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
  await b?.close().catch(() => undefined);
}
