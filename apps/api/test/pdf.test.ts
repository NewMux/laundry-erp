/** Fonts embedded into PDFs rendered by the serverless Chromium (Vercel). */
import { describe, expect, it } from 'vitest';
import { withEmbeddedFonts } from '../src/pdf/render';

describe('embedded PDF fonts', () => {
  it('adds Noto Sans (Latin, Devanagari) and Noto Sans Arabic, regular and bold, inside <head>', () => {
    const html = withEmbeddedFonts('<!doctype html><html><head><title>x</title></head><body>محمد</body></html>');
    const faces = html.match(/@font-face\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(8);
    expect(faces.filter((f) => f.includes('"Noto Sans Arabic"'))).toHaveLength(2);
    expect(faces.every((f) => f.includes('base64,d09GMg'))).toBe(true); // "wOF2" magic: real woff2 data
    expect(html.indexOf('@font-face')).toBeLessThan(html.indexOf('</head>'));
  });
});
