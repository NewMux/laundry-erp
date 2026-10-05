import {
  renderReceiptHtml,
  renderTagsHtml,
  renderTopupReceiptHtml,
  type PrintOrder,
  type PrintShop,
  type PrintTopup,
  type ReceiptSettings,
  type TagSettings,
  type TFn,
} from '@laundry/shared';
import i18n from '../i18n';
import { api } from './api';

const t: TFn = (key, vars) => i18n.t(key, vars as Record<string, unknown>) as string;

const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

/**
 * Print an HTML document through the browser print pipeline.
 * For silent printing at the counter, run Chrome/Edge with --kiosk-printing
 * and set the 80mm thermal printer (e.g. E-POS ECO250) as default.
 */
export function printHtml(html: string): Promise<void> {
  if (isIOS) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    w?.addEventListener('load', () => w.print());
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:400px;height:600px;border:0;';
    iframe.srcdoc = html;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      setTimeout(() => iframe.remove(), 1000);
      resolve();
    };
    iframe.onload = async () => {
      const doc = iframe.contentDocument;
      const w = iframe.contentWindow;
      if (!doc || !w) return done();
      await Promise.all(
        Array.from(doc.images).map((img) =>
          img.complete ? null : new Promise((r) => {
            img.onload = img.onerror = r;
          }),
        ),
      );
      w.addEventListener('afterprint', done, { once: true });
      w.focus();
      w.print();
      setTimeout(done, 120000);
    };
    document.body.appendChild(iframe);
  });
}

export interface OrderPrintData {
  shop: PrintShop;
  receipt: ReceiptSettings;
  tag: TagSettings;
  order: PrintOrder;
  canPrintReceipt: boolean;
}

export function fetchPrintData(orderId: string) {
  return api.get<OrderPrintData>(`/api/orders/${orderId}/print`);
}

export function receiptHtml(d: OrderPrintData, copyLabel?: string) {
  return renderReceiptHtml(d.shop, d.order, d.receipt, t, { copyLabel });
}

export function tagsHtml(d: OrderPrintData, pieces?: number[]) {
  return renderTagsHtml(d.shop, d.order, d.tag, t, pieces);
}

/** Print the receipt (with configured copies) and/or the item tags of an order. */
export async function printOrder(orderId: string, what: { receipt?: boolean; tags?: boolean; pieces?: number[] } = { receipt: true, tags: true }) {
  const d = await fetchPrintData(orderId);
  if (what.receipt && d.canPrintReceipt) {
    const copies = Math.max(1, d.receipt.copies ?? 1);
    for (let i = 0; i < copies; i++) {
      await printHtml(receiptHtml(d, copies > 1 ? (i === 0 ? t('print.customerCopy') : t('print.shopCopy')) : undefined));
    }
  }
  if (what.tags) await printHtml(tagsHtml(d, what.pieces));
}

export function printTopup(shop: PrintShop, receipt: PrintTopup, settings: ReceiptSettings) {
  return printHtml(renderTopupReceiptHtml(shop, receipt, settings, t));
}

export async function reprintTopup(paymentId: string) {
  const d = await api.get<{ receipt: PrintTopup; shop: PrintShop; settings: ReceiptSettings }>(`/api/wallet/receipt/${paymentId}`);
  return printTopup(d.shop, d.receipt, d.settings);
}
