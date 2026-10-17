/**
 * Sign-in code delivery: WhatsApp first, SMS as the fallback. Uses a fake
 * fetch, so nothing leaves the machine.
 */
import { describe, expect, it, vi } from 'vitest';
import { deliverOtp, otpChannels, type OtpDeliveryConfig } from '../src/lib/otp-delivery';

const whatsapp = { token: 'wa-token', phoneNumberId: '1234567890', template: 'newmux_login_code', language: 'ar', apiVersion: 'v21.0' };
const twilio = { accountSid: 'ACxxx', authToken: 'secret', from: '+15005550006', messagingServiceSid: undefined };
const both: OtpDeliveryConfig = { whatsapp, twilio };
const log = { warn: vi.fn() };

const ok = () => new Response('{}', { status: 200 });
const fail = (status = 400) => new Response('{"error":"nope"}', { status });

describe('otpChannels', () => {
  it('is empty with nothing configured, so the code is only logged', () => {
    expect(otpChannels({ whatsapp: undefined, twilio: undefined })).toEqual([]);
  });

  it('puts WhatsApp before SMS', () => {
    expect(otpChannels(both).map((c) => c.name)).toEqual(['whatsapp', 'sms']);
  });

  it('ignores Twilio without a sender', () => {
    const cfg = { whatsapp: undefined, twilio: { ...twilio, from: undefined } };
    expect(otpChannels(cfg)).toEqual([]);
    expect(otpChannels({ whatsapp: undefined, twilio: { ...cfg.twilio, messagingServiceSid: 'MG1' } }).map((c) => c.name)).toEqual(['sms']);
  });
});

describe('deliverOtp', () => {
  it('sends the code as a WhatsApp authentication template', async () => {
    const fetchFn = vi.fn(async () => ok());
    const used = await deliverOtp(otpChannels(both, fetchFn as never), '97333123456', '123456', log);

    expect(used).toBe('whatsapp');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer wa-token');
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      to: '97333123456',
      type: 'template',
      template: {
        name: 'newmux_login_code',
        language: { code: 'ar' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
        ],
      },
    });
  });

  it('falls back to SMS when WhatsApp refuses, and never logs the code', async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn(async (url: string) => (url.includes('graph.facebook.com') ? fail(400) : ok()));
    const used = await deliverOtp(otpChannels(both, fetchFn as never), '971501234567', '654321', { warn });

    expect(used).toBe('sms');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages.json');
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('ACxxx:secret').toString('base64')}`);
    const form = new URLSearchParams(String(init.body));
    expect(form.get('To')).toBe('+971501234567');
    expect(form.get('From')).toBe('+15005550006');
    expect(form.get('Body')).toContain('654321');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('654321');
  });

  it('falls back to SMS when WhatsApp throws (network error or timeout)', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('graph.facebook.com')) throw new Error('socket hang up');
      return ok();
    });
    expect(await deliverOtp(otpChannels(both, fetchFn as never), '97333123456', '111111', log)).toBe('sms');
  });

  it('uses a Twilio messaging service instead of a From number when one is set', async () => {
    const fetchFn = vi.fn(async () => ok());
    const channels = otpChannels({ whatsapp: undefined, twilio: { ...twilio, from: undefined, messagingServiceSid: 'MG123' } }, fetchFn as never);
    await deliverOtp(channels, '96612345678', '222222', log);
    const form = new URLSearchParams(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(form.get('MessagingServiceSid')).toBe('MG123');
    expect(form.has('From')).toBe(false);
  });

  it('returns null when every channel fails', async () => {
    const fetchFn = vi.fn(async () => fail(500));
    expect(await deliverOtp(otpChannels(both, fetchFn as never), '97333123456', '333333', log)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
