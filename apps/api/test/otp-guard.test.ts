import { describe, expect, it } from 'vitest';
import { DEFAULT_OTP_COUNTRIES, otpCountryAllowed, parseOtpCountries, parseOtpPilot } from '../src/lib/otp-guard';

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

describe('parseOtpPilot', () => {
  it('lists the numbers, whatever their format, with the fixed code', () => {
    const pilot = parseOtpPilot('+973 3312 3456, 33998877 ,00971501234567', '135790');
    expect([...pilot!.numbers].sort()).toEqual(['971501234567', '97333123456', '97333998877']);
    expect(pilot!.code).toBe('135790');
  });
  it('is off unless there are numbers and a 6-digit code', () => {
    expect(parseOtpPilot(undefined, undefined)).toBeUndefined();
    expect(parseOtpPilot('97333123456', undefined)).toBeUndefined();
    expect(parseOtpPilot('97333123456', '1234')).toBeUndefined();
    expect(parseOtpPilot('97333123456', 'abcdef')).toBeUndefined();
    expect(parseOtpPilot('', '135790')).toBeUndefined();
    expect(parseOtpPilot('abc, 12', '135790')).toBeUndefined();
  });
});
