/**
 * All business dates are in Asia/Bahrain (UTC+3, no daylight saving).
 * Business dates are plain "YYYY-MM-DD" strings.
 */
export const TIME_ZONE = 'Asia/Bahrain';
export const TZ_OFFSET = '+03:00';
const OFFSET_MS = 3 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for the given instant in Bahrain time. */
export function bhDate(d: Date = new Date()): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM" for the given instant in Bahrain time. */
export function bhMonth(d: Date = new Date()): string {
  return bhDate(d).slice(0, 7);
}

/** "HH:mm" for the given instant in Bahrain time. */
export function bhTime(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

/** Start of a Bahrain business day as a UTC instant. */
export function startOfDay(date: string): Date {
  return new Date(`${date}T00:00:00.000${TZ_OFFSET}`);
}

/** Exclusive end of a Bahrain business day (start of next day). */
export function endOfDay(date: string): Date {
  return startOfDay(addDays(date, 1));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const to = addDays(`${addMonths(month, 1)}-01`, -1);
  return { from, to };
}

export function daysInMonth(month: string): number {
  return Number(monthRange(month).to.slice(8, 10));
}

/** Day of week (0 = Sunday) of a business date. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Combine a business date and "HH:mm" (Bahrain) into an instant. */
export function atTime(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00.000${TZ_OFFSET}`);
}

export function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DayHours {
  open: string; // "08:00"
  close: string; // "22:00"
  closed: boolean;
}
export type WorkingHours = Record<Weekday, DayHours>;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  sun: { open: '08:00', close: '22:00', closed: false },
  mon: { open: '08:00', close: '22:00', closed: false },
  tue: { open: '08:00', close: '22:00', closed: false },
  wed: { open: '08:00', close: '22:00', closed: false },
  thu: { open: '08:00', close: '22:00', closed: false },
  fri: { open: '16:00', close: '22:00', closed: false },
  sat: { open: '08:00', close: '22:00', closed: false },
};

/**
 * Expected ready time: now + turnaround hours, pushed into working hours.
 * If the result falls after closing or on a closed day, it moves to the
 * next opening time.
 */
export function expectedReadyAt(now: Date, hours: number, wh: WorkingHours = DEFAULT_WORKING_HOURS): Date {
  let t = new Date(now.getTime() + hours * 3600_000);
  for (let i = 0; i < 8; i++) {
    const date = bhDate(t);
    const day = wh[WEEKDAYS[weekday(date)]];
    if (!day || day.closed) {
      t = atTime(addDays(date, 1), '00:00');
      const next = wh[WEEKDAYS[weekday(bhDate(t))]];
      if (next && !next.closed) t = atTime(bhDate(t), next.open);
      continue;
    }
    const open = atTime(date, day.open);
    const close = atTime(date, day.close);
    if (t < open) return open;
    if (t <= close) return t;
    const nextDate = addDays(date, 1);
    const next = wh[WEEKDAYS[weekday(nextDate)]];
    t = atTime(nextDate, next && !next.closed ? next.open : '00:00');
    if (next && !next.closed) return t;
  }
  return t;
}

/** "05/10/2026" (Bahrain time) */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const s = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : bhDate(new Date(d));
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

/** "05/10/2026 14:32" (Bahrain time) */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  return `${fmtDate(date)} ${bhTime(date)}`;
}
