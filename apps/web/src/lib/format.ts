import { bhDate, fmtDate, fmtDateTime, formatBhd, formatMobile } from '@laundry/shared';

export const money = (v: number | string | null | undefined, withCurrency = false) => formatBhd(Number(v ?? 0), withCurrency);
export const bhd = (v: number | string | null | undefined) => formatBhd(Number(v ?? 0), true);
export const date = (d: string | Date | null | undefined) => fmtDate(d ?? null);
export const dateTime = (d: string | Date | null | undefined) => fmtDateTime(d ?? null);
export const phone = (m: string | null | undefined) => formatMobile(m ?? '');
export const today = () => bhDate();

/** "in 3h" / "2d ago" relative to now. */
export function relative(d: string | Date | null | undefined): string {
  if (!d) return '';
  const ms = new Date(d).getTime() - Date.now();
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const s = m < 60 ? `${m}m` : h < 48 ? `${h}h` : `${days}d`;
  return ms >= 0 ? `in ${s}` : `${s} ago`;
}

export const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'purple',
  RECEIVED: 'gray',
  IN_PROCESS: 'blue',
  IRONING: 'amber',
  READY: 'green',
  DELIVERED: 'dark',
  CANCELLED: 'red',
};

export const PAYMENT_COLOR: Record<string, string> = { UNPAID: 'red', PARTIAL: 'amber', PAID: 'green' };

export function parseMoney(v: string | number): number {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}
