/**
 * Phone numbers are stored as digits including the country code,
 * e.g. "97333123456". Bahrain local numbers are 8 digits.
 */
export const DEFAULT_COUNTRY_CODE = '973';

export function normalizeMobile(input: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string {
  if (!input) return '';
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 8) digits = countryCode + digits;
  return digits;
}

export function isValidMobile(input: string | null | undefined): boolean {
  const d = normalizeMobile(input);
  return d.length >= 8 && d.length <= 15;
}

export function formatMobile(stored: string | null | undefined): string {
  if (!stored) return '';
  if (stored.startsWith('973') && stored.length === 11) {
    return `+973 ${stored.slice(3, 7)} ${stored.slice(7)}`;
  }
  return `+${stored}`;
}

/** Digits to search on: strips formatting and a leading 973 if the query is long. */
export function phoneSearchDigits(q: string): string {
  return q.replace(/\D/g, '');
}

/** WhatsApp click-to-chat link (no API needed). */
export function whatsappLink(mobile: string, text: string): string {
  const digits = normalizeMobile(mobile);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
