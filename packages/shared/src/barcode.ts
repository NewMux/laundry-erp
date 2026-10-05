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

/** Barcode payload for an order (receipt) and for a single piece (tag). */
export function orderBarcode(orderNo: number | string): string {
  return `O${orderNo}`;
}
export function pieceBarcode(orderNo: number | string, pieceNo: number): string {
  return `${orderNo}-${pieceNo}`;
}

/** Parse a scanned code: "1042-3" → piece, "O1042" or "1042" → order. */
export function parseScan(code: string): { orderNo: number; pieceNo: number | null } | null {
  const c = code.trim().toUpperCase();
  let m = /^(\d+)-(\d+)$/.exec(c);
  if (m) return { orderNo: Number(m[1]), pieceNo: Number(m[2]) };
  m = /^O?(\d+)$/.exec(c);
  if (m) return { orderNo: Number(m[1]), pieceNo: null };
  return null;
}
