/** The Expo push sender: batching, its answers, and failures that must not break the staff action. */
import { describe, expect, it } from 'vitest';
import { expoPushSender, isExpoPushToken, isGoneToken, type PushMessage } from '../src/lib/push';

const msg = (i: number): PushMessage => ({ to: `ExponentPushToken[abcdefghij${i}]`, title: 't', body: 'b', data: {}, sound: 'default', channelId: 'orders' });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('expo push sender', () => {
  it('sends in batches of 100 with the access token, and returns a ticket per message', async () => {
    const calls: { auth: string | null; count: number }[] = [];
    const send = expoPushSender('secret', async (_url, init) => {
      const batch = JSON.parse(String(init!.body)) as PushMessage[];
      calls.push({ auth: new Headers(init!.headers).get('authorization'), count: batch.length });
      return json(200, { data: batch.map(() => ({ status: 'ok' })) });
    });
    const tickets = await send(Array.from({ length: 150 }, (_, i) => msg(i)));
    expect(calls).toEqual([
      { auth: 'Bearer secret', count: 100 },
      { auth: 'Bearer secret', count: 50 },
    ]);
    expect(tickets).toHaveLength(150);
    expect(tickets.every((t) => t.status === 'ok')).toBe(true);
  });

  it('turns an HTTP error or a network failure into error tickets instead of throwing', async () => {
    const down = expoPushSender(undefined, async () => json(503, {}));
    expect(await down([msg(1)])).toEqual([{ status: 'error', message: 'Expo push HTTP 503' }]);
    const offline = expoPushSender(undefined, async () => {
      throw new Error('getaddrinfo ENOTFOUND exp.host');
    });
    expect((await offline([msg(1), msg(2)])).map((t) => t.status)).toEqual(['error', 'error']);
  });

  it('knows a push token and a device that is gone', () => {
    expect(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(isExpoPushToken('ExponentPushToken[]')).toBe(false);
    expect(isExpoPushToken('https://evil.example/ExponentPushToken[xxxxxxxxxxxx]')).toBe(false);
    expect(isGoneToken({ status: 'error', details: { error: 'DeviceNotRegistered' } })).toBe(true);
    expect(isGoneToken({ status: 'error', details: { error: 'MessageRateExceeded' } })).toBe(false);
    expect(isGoneToken({ status: 'ok' })).toBe(false);
  });
});
