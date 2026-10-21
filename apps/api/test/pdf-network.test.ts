/** The PDF renderer gets no network: customer-entered text in a receipt must not be able to make the server fetch URLs. */
import http from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { closePdf, renderPdf } from '../src/pdf/render';

// Needs a Chromium (CHROMIUM_PATH, a system one, or Playwright's); skipped where there is none.
const hasChromium = !!process.env.CHROMIUM_PATH;

afterAll(() => closePdf());

describe.skipIf(!hasChromium)('PDF rendering', () => {
  it('renders, but never fetches anything over the network', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.end('x');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const html = `<html><body><h1>Receipt</h1><img src="http://127.0.0.1:${port}/a.png"><iframe src="http://127.0.0.1:${port}/b"></iframe><link rel="stylesheet" href="http://127.0.0.1:${port}/c.css"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></body></html>`;
    try {
      for (const format of ['80mm', 'A4'] as const) {
        const pdf = await renderPdf(html, { format });
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      }
    } finally {
      server.close();
    }
    expect(hits).toBe(0);
  });
});
