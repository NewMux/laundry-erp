/**
 * Sign-in code delivery, by WhatsApp only. Uses a fake fetch, so nothing
 * leaves the machine.
 */
import { describe, expect, it, vi } from 'vitest';
import { deliverOtp, otpChannels, type OtpDeliveryConfig } from '../src/lib/otp-delivery';

const whatsapp = { token: 'wa-token', phoneNumberId: '1234567890', template: 'newmux_login_code', language: 'ar', apiVersion: 'v21.0' };
const configured: OtpDeliveryConfig = { whatsapp };
const log = { warn: vi.fn() };

const ok = () => new Response('{}', { status: 200 });
const fail = (status = 400) => new Response('{"error":"nope"}', { status });

describe('otpChannels', () => {
  it('is empty with nothing configured, so the code is only logged', () => {
    expect(otpChannels({ whatsapp: undefined })).toEqual([]);
  });

  it('is WhatsApp alone when it is configured', () => {
    expect(otpChannels(configured).map((c) => c.name)).toEqual(['whatsapp']);
  });
});

describe('deliverOtp', () => {
  it('sends the code as a WhatsApp authentication template', async () => {
    const fetchFn = vi.fn(async () => ok());
    const used = await deliverOtp(otpChannels(configured, fetchFn as never), '97333123456', '123456', log);

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

  it('returns null when WhatsApp refuses or fails, and never logs the code', async () => {
    const warn = vi.fn();
    const refused = vi.fn(async () => fail(400));
    expect(await deliverOtp(otpChannels(configured, refused as never), '971501234567', '654321', { warn })).toBeNull();
    expect(refused).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('654321');

    const offline = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    expect(await deliverOtp(otpChannels(configured, offline as never), '97333123456', '111111', log)).toBeNull();
  });
});
