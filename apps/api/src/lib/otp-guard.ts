/**
 * Cheap checks run before a sign-in code is created or sent. Every code is a
 * paid message, so numbers that cannot be ours are refused without touching
 * the database or the SMS provider.
 */

/** Digits after the country code for the Gulf states (all mobile numbers there are fixed length). */
const NATIONAL_LENGTH: Record<string, number> = {
  '973': 8, // Bahrain
  '971': 9, // United Arab Emirates
  '966': 9, // Saudi Arabia
  '965': 8, // Kuwait
  '968': 8, // Oman
  '974': 8, // Qatar
};

export const DEFAULT_OTP_COUNTRIES = Object.keys(NATIONAL_LENGTH);

/** "973, 971" → ["973","971"]; "*" → "any". Anything that is not a dial code is dropped. */
export function parseOtpCountries(raw: string | undefined): string[] | 'any' {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_OTP_COUNTRIES;
  if (value === '*') return 'any';
  const codes = value.split(',').map((c) => c.replace(/\D/g, '')).filter(Boolean);
  return codes.length ? codes : DEFAULT_OTP_COUNTRIES;
}

/**
 * True when `phone` (digits with country code, as stored) belongs to a country we serve
 * and, for the Gulf states, has the right length for that country.
 */
export function otpCountryAllowed(phone: string, allowed: string[] | 'any'): boolean {
  if (!/^\d{8,15}$/.test(phone)) return false;
  if (allowed === 'any') return true;
  const code = allowed.find((c) => phone.startsWith(c));
  if (!code) return false;
  const national = NATIONAL_LENGTH[code];
  return national === undefined || phone.length === code.length + national;
}
