import type { FastifyInstance } from 'fastify';
import { parseSettings } from '@laundry/shared';
import { isGoneToken, type PushMessage } from '../lib/push';
import type { Ctx } from '../lib/service-context';

/**
 * Push notifications to the customer app when staff move an order on. Services record a notice on
 * the request's context (`notifyOrder`); they are sent once the request has succeeded (app.ts), so
 * a rolled-back change never reaches a phone. Jobs and the customer's own actions carry no notices.
 */
export type OrderNoticeKind = 'received' | 'pickup_en_route' | 'ready' | 'out_for_delivery' | 'cancelled';

export interface OrderNotice {
  tenantId: string;
  orderId: string;
  kind: OrderNoticeKind;
}

export function notifyOrder(ctx: Ctx, orderId: string, kind: OrderNoticeKind) {
  ctx.notices?.push({ tenantId: ctx.tenantId, orderId, kind });
}

type Lang = 'en' | 'ar';
interface Vars {
  no: string;
  shop: string;
  curbside: boolean;
}

const TEXT: Record<OrderNoticeKind, Record<Lang, (v: Vars) => { title: string; body: string }>> = {
  received: {
    en: (v) => ({ title: 'We have your order', body: `${v.shop} has order ${v.no}. We’ll tell you when it’s ready.` }),
    ar: (v) => ({ title: 'استلمنا طلبك', body: `الطلب ${v.no} لدى ${v.shop}. سنخبرك عندما يكون جاهزًا.` }),
  },
  pickup_en_route: {
    en: (v) => ({ title: 'Driver on the way', body: `${v.shop}’s driver is on the way to collect order ${v.no}.` }),
    ar: (v) => ({ title: 'السائق في الطريق', body: `سائق ${v.shop} في الطريق لاستلام الطلب ${v.no}.` }),
  },
  ready: {
    en: (v) => ({ title: 'Ready to collect', body: `Order ${v.no} is ready at ${v.shop}.${v.curbside ? ' Coming by car? Tap I’m outside when you arrive.' : ''}` }),
    ar: (v) => ({ title: 'جاهز للاستلام', body: `الطلب ${v.no} جاهز لدى ${v.shop}.${v.curbside ? ' قادم بالسيارة؟ اضغط «أنا بالخارج» عند وصولك.' : ''}` }),
  },
  out_for_delivery: {
    en: (v) => ({ title: 'On its way', body: `Order ${v.no} from ${v.shop} is out for delivery.` }),
    ar: (v) => ({ title: 'في الطريق إليك', body: `الطلب ${v.no} من ${v.shop} في طريقه إليك.` }),
  },
  cancelled: {
    en: (v) => ({ title: 'Order cancelled', body: `${v.shop} cancelled order ${v.no}. Contact them if you didn’t expect this.` }),
    ar: (v) => ({ title: 'تم إلغاء الطلب', body: `ألغت ${v.shop} الطلب ${v.no}. تواصل معهم إن لم يكن هذا متوقعًا.` }),
  },
};

/** The notification's title and body in the device's language. */
export function noticeText(kind: OrderNoticeKind, lang: string, v: Vars) {
  return TEXT[kind][lang === 'ar' ? 'ar' : 'en'](v);
}

/** Send the request's notices. Never throws: a notification is a courtesy, the staff action already happened. */
export async function sendOrderNotices(app: FastifyInstance, notices: OrderNotice[]) {
  const send = app.config.pushSend;
  if (!send || !notices.length) return;
  try {
    const seen = new Set<string>();
    const messages: PushMessage[] = [];
    for (const n of notices) {
      const key = `${n.orderId}:${n.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const order = await app.prisma.order.findFirst({
        where: { id: n.orderId, tenantId: n.tenantId },
        select: {
          orderNo: true,
          appRef: true,
          outbound: true,
          customer: { select: { appUserId: true } },
          tenant: { select: { name: true, nameAr: true, settings: true } },
        },
      });
      const appUserId = order?.customer?.appUserId;
      if (!order || !appUserId) continue;
      // A delivery order is announced when it leaves the shop, not when it's ready.
      if (n.kind === 'ready' && order.outbound === 'DELIVERY') continue;
      const a = parseSettings(order.tenant.settings).customerApp;
      if (!a.enabled) continue;
      const tokens = await app.prisma.appPushToken.findMany({ where: { appUserId } });
      for (const t of tokens) {
        const shop = t.lang === 'ar' && order.tenant.nameAr ? order.tenant.nameAr : order.tenant.name;
        const no = order.orderNo !== null ? String(order.orderNo) : (order.appRef ?? '');
        const text = noticeText(n.kind, t.lang, { no, shop, curbside: a.counter && a.curbside && order.outbound === 'COLLECT' });
        messages.push({ to: t.token, ...text, data: { orderId: n.orderId, laundryId: n.tenantId }, sound: 'default', channelId: 'orders' });
      }
    }
    if (!messages.length) return;
    const tickets = await send(messages);
    const gone = messages.filter((_, i) => tickets[i] && isGoneToken(tickets[i])).map((m) => m.to);
    if (gone.length) await app.prisma.appPushToken.deleteMany({ where: { token: { in: gone } } });
    const failed = tickets.filter((t) => t.status === 'error' && !isGoneToken(t)).length;
    if (failed) app.log.warn({ failed, sent: messages.length }, 'some order notifications were not sent');
  } catch (err) {
    app.log.error({ err }, 'order notifications failed');
  }
}
