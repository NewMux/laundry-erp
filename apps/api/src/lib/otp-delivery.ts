import type { FastifyBaseLogger } from 'fastify';

/**
 * Delivery of customer-app sign-in codes, by WhatsApp only. It is on only when
 * its credentials are set; without them issueOtp just logs the code (local dev).
 */

export interface WhatsAppConfig {
  /** Permanent access token of a Meta system user. */
  token: string;
  /** WhatsApp Business phone number ID (not the number itself). */
  phoneNumberId: string;
  /** Approved template of category AUTHENTICATION (body {{1}} = code, with a copy-code button). */
  template: string;
  /** Language the template was approved in, e.g. "en" or "ar". */
  language: string;
  apiVersion: string;
}

export interface OtpDeliveryConfig {
  whatsapp: WhatsAppConfig | undefined;
}

export type OtpChannelName = 'whatsapp';

export interface OtpChannel {
  name: OtpChannelName;
  /** `phone` is digits with the country code and no "+" (the app's stored format). */
  send(phone: string, code: string): Promise<void>;
}

type FetchFn = typeof fetch;

const TIMEOUT_MS = 8_000;

/** Trim a provider's error body so a failure is diagnosable in the log without dumping a page of JSON. */
async function failure(channel: string, res: Response): Promise<Error> {
  const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  return new Error(`${channel} responded ${res.status}: ${text}`);
}

export function whatsappChannel(cfg: WhatsAppConfig, fetchFn: FetchFn = fetch): OtpChannel {
  return {
    name: 'whatsapp',
    async send(phone, code) {
      const res = await fetchFn(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'template',
          template: {
            name: cfg.template,
            language: { code: cfg.language },
            // Authentication templates take the code twice: in the body and in the copy-code button.
            components: [
              { type: 'body', parameters: [{ type: 'text', text: code }] },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
            ],
          },
        }),
      });
      if (!res.ok) throw await failure('WhatsApp', res);
    },
  };
}

/** The channels that are set up, in the order they are tried. */
export function otpChannels(cfg: OtpDeliveryConfig, fetchFn: FetchFn = fetch): OtpChannel[] {
  return cfg.whatsapp ? [whatsappChannel(cfg.whatsapp, fetchFn)] : [];
}

/**
 * Send the code on the first channel that accepts it.
 * Returns the channel used, or null when every channel failed (the reasons are logged, never the code).
 */
export async function deliverOtp(
  channels: OtpChannel[],
  phone: string,
  code: string,
  log: Pick<FastifyBaseLogger, 'warn'>,
): Promise<OtpChannelName | null> {
  for (const channel of channels) {
    try {
      await channel.send(phone, code);
      return channel.name;
    } catch (err) {
      log.warn({ channel: channel.name, phone, err: err instanceof Error ? err.message : String(err) }, 'Sign-in code delivery failed');
    }
  }
  return null;
}
