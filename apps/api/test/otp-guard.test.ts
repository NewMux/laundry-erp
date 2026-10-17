import { describe, expect, it } from 'vitest';
import { DEFAULT_OTP_COUNTRIES, otpCountryAllowed, parseOtpCountries } from '../src/lib/otp-guard';

describe('parseOtpCountries', () => {
  it('defaults to the six Gulf states', () => {
    expect(parseOtpCountries(undefined)).toEqual(DEFAULT_OTP_COUNTRIES);
    expect([...DEFAULT_OTP_COUNTRIES].sort()).toEqual(['965', '966', '968', '971', '973', '974']);
    expect(parseOtpCountries('')).toEqual(DEFAULT_OTP_COUNTRIES);
  });
  it('reads a list of dial codes, tolerating + and spaces', () => {
    expect(parseOtpCountries('973, +971 ,966')).toEqual(['973', '971', '966']);
  });
  it('"*" allows any country', () => {
    expect(parseOtpCountries('*')).toBe('any');
  });
  it('falls back to the default when nothing usable is given', () => {
    expect(parseOtpCountries(' , ')).toEqual(DEFAULT_OTP_COUNTRIES);
  });
});

describe('otpCountryAllowed', () => {
  const gulf = DEFAULT_OTP_COUNTRIES;

  it('accepts valid Gulf mobile numbers of the right length', () => {
    for (const n of ['97333123456', '971501234567', '966512345678', '96550123456', '96895123456', '97455123456']) {
      expect(otpCountryAllowed(n, gulf), n).toBe(true);
    }
  });
  it('refuses countries that are not on the list', () => {
    expect(otpCountryAllowed('14155550100', gulf)).toBe(false); // US
    expect(otpCountryAllowed('919876543210', gulf)).toBe(false); // India
    expect(otpCountryAllowed('447911123456', gulf)).toBe(false); // UK
  });
  it('refuses Gulf numbers of the wrong length', () => {
    expect(otpCountryAllowed('9733312345', gulf)).toBe(false); // Bahrain, too short
    expect(otpCountryAllowed('973331234567', gulf)).toBe(false); // Bahrain, too long
    expect(otpCountryAllowed('96651234567', gulf)).toBe(false); // Saudi, 8 digits
  });
  it('refuses anything that is not 8-15 digits', () => {
    expect(otpCountryAllowed('', 'any')).toBe(false);
    expect(otpCountryAllowed('+97333123456', 'any')).toBe(false);
    expect(otpCountryAllowed('1234567', 'any')).toBe(false);
  });
  it('"any" lets other countries through, and a custom list works without length rules', () => {
    expect(otpCountryAllowed('14155550100', 'any')).toBe(true);
    expect(otpCountryAllowed('919876543210', ['91'])).toBe(true);
    expect(otpCountryAllowed('97333123456', ['91'])).toBe(false);
  });
});
