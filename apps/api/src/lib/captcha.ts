import { AppError } from './errors';

/**
 * Cloudflare Turnstile, the bot check on public signup. Turned on by setting both
 * TURNSTILE_SITE_KEY (public, given to the browser) and TURNSTILE_SECRET_KEY.
 */
export interface TurnstileConfig {
  siteKey: string;
  secret: string;
}

type FetchFn = typeof fetch;

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Both keys are needed; one without the other leaves the check off rather than locking everyone out. */
export function parseTurnstile(siteKey: string | undefined, secret: string | undefined): TurnstileConfig | undefined {
  const k = (siteKey ?? '').trim();
  const s = (secret ?? '').trim();
  return k && s ? { siteKey: k, secret: s } : undefined;
}

/**
 * Throws 400 `captcha_failed` when the token is missing or Cloudflare rejects it, and 503
 * `captcha_unavailable` when Cloudflare cannot be reached (fail closed: a bot check that
 * passes when it cannot check is no check).
 */
export async function verifyTurnstile(cfg: TurnstileConfig, token: string | undefined, ip: string, fetchFn: FetchFn = fetch): Promise<void> {
  if (!token) throw new AppError(400, 'captcha_failed', 'Please complete the check to continue.');
  let ok = false;
  try {
    const res = await fetchFn(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: cfg.secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Turnstile responded ${res.status}`);
    ok = ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    throw new AppError(503, 'captcha_unavailable', 'We could not verify the check right now. Please try again in a moment.');
  }
  if (!ok) throw new AppError(400, 'captcha_failed', 'The check did not pass. Please try again.');
}
