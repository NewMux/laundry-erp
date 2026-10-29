/**
 * Push notifications to the customer app, through Expo's push service
 * (https://docs.expo.dev/push-notifications/sending-notifications/). Expo
 * delivers to Apple and Google; the app registers an "ExponentPushToken[…]"
 * per device.
 */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Read by the app when the notification is tapped: `{ orderId, laundryId }`. */
  data: Record<string, string>;
  sound: 'default';
  /** The Android channel the app creates for order updates. */
  channelId: 'orders';
}

/** Expo's answer for one message, in the order sent. */
export type PushTicket = { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

export type PushSend = (messages: PushMessage[]) => Promise<PushTicket[]>;

type FetchFn = typeof fetch;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo takes up to 100 messages a request. */
const BATCH = 100;

export const isExpoPushToken = (token: string) => /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/.test(token);

/**
 * Sends through Expo. `accessToken` is only needed if push security is turned on for the Expo
 * project (EXPO_ACCESS_TOKEN). A failed request returns error tickets rather than throwing, so
 * one bad send never fails the staff action that caused it.
 */
export function expoPushSender(accessToken: string | undefined, fetchFn: FetchFn = fetch, timeoutMs = 5000): PushSend {
  return async (messages) => {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      try {
        const res = await fetchFn(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const json = (await res.json().catch(() => ({}))) as { data?: PushTicket[] };
        if (!res.ok || !Array.isArray(json.data)) {
          tickets.push(...batch.map(() => ({ status: 'error' as const, message: `Expo push HTTP ${res.status}` })));
        } else {
          tickets.push(...batch.map((_, j) => json.data![j] ?? { status: 'error' as const, message: 'No ticket' }));
        }
      } catch (e) {
        tickets.push(...batch.map(() => ({ status: 'error' as const, message: (e as Error).message })));
      }
    }
    return tickets;
  };
}

/** Apple or Google no longer knows this device (the app was removed): forget the token. */
export const isGoneToken = (t: PushTicket) => t.status === 'error' && t.details?.error === 'DeviceNotRegistered';
