/**
 * Transactional email through Resend's HTTP API (no SMTP, so it works on Vercel). Off unless
 * RESEND_API_KEY and MAIL_FROM are both set; callers must cope with it being off.
 */
export interface MailConfig {
  apiKey: string;
  /** Verified sender, e.g. "Ghassla <no-reply@ghassla.com>". */
  from: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

type FetchFn = typeof fetch;

export function parseMail(apiKey: string | undefined, from: string | undefined): MailConfig | undefined {
  const k = (apiKey ?? '').trim();
  const f = (from ?? '').trim();
  return k && f ? { apiKey: k, from: f } : undefined;
}

/** Throws when the provider refuses or cannot be reached. */
export async function sendMail(cfg: MailConfig, mail: Mail, fetchFn: FetchFn = fetch): Promise<void> {
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({ from: cfg.from, to: [mail.to], subject: mail.subject, text: mail.text }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`Email provider responded ${res.status}: ${detail}`);
  }
}
