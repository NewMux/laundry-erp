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
