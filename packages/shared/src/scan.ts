/** Barcode payloads: receipt barcode "O1042", piece tag "1042-3". */
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

/** Customer-app pre-order reference shown on the customer's pass, e.g. "A-7K2Q9F". */
export function parseAppRef(code: string): string | null {
  const m = /^A-?([A-Z0-9]{6})$/.exec(code.trim().toUpperCase());
  return m ? `A-${m[1]}` : null;
}
