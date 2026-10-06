import bwipjs from 'bwip-js';

/** Code 128 barcode as an SVG string (used on tags and receipts). */
export function code128Svg(text: string, opts: { height?: number; includeText?: boolean } = {}): string {
  return bwipjs.toSVG({
    bcid: 'code128',
    text,
    height: opts.height ?? 8,
    scale: 2,
    includetext: opts.includeText ?? false,
    textxalign: 'center',
    paddingwidth: 0,
    paddingheight: 0,
  });
}

/** QR code as an SVG string. */
export function qrSvg(text: string): string {
  // eclevel is a valid BWIPP option that bwip-js' typings don't list.
  return bwipjs.toSVG({ bcid: 'qrcode', text, scale: 2, eclevel: 'M' } as Parameters<typeof bwipjs.toSVG>[0]);
}
