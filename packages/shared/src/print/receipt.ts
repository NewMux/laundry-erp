import { code128Svg, orderBarcode, pieceBarcode, qrSvg } from '../barcode';
import { esc, nl2br, type TFn } from '../html';
import { formatBhd } from '../money';
import { formatMobile } from '../phone';
import type { ReceiptSettings, TagSettings } from '../settings';
import { fmtDate, fmtDateTime } from '../time';
import type { PrintOrder, PrintShop, PrintTopup } from './types';

const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:"Noto Sans","Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif;font-size:12px;line-height:1.3}
.r{width:72mm;padding:2mm 2mm 4mm;margin:0 auto}
.c{text-align:center}
.b{font-weight:700}
.big{font-size:16px}
.xl{font-size:20px}
.sm{font-size:10px}
.hr{border-top:1px dashed #000;margin:4px 0}
.row{display:flex;justify-content:space-between;gap:6px}
.row>span:last-child{text-align:right;white-space:nowrap}
table{width:100%;border-collapse:collapse}
td,th{vertical-align:top;padding:1px 0}
th{font-size:10px;text-align:left;border-bottom:1px solid #000}
.num{text-align:right;white-space:nowrap}
.logo{max-width:40mm;max-height:20mm;display:block;margin:0 auto 2px}
.badge{display:inline-block;border:2px solid #000;padding:0 4px;font-weight:700}
.dmg{font-size:10px;font-style:italic}
.bc svg{width:100%;height:12mm}
.qr svg{width:24mm;height:24mm}
.dir{unicode-bidi:plaintext}
@page{margin:0}
@media print{.noprint{display:none}}
`;

function doc(title: string, css: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

function shopHeader(shop: PrintShop, s: { showLogo: boolean; showVatNumber: boolean; header?: string }, t: TFn): string {
  return `
  ${s.showLogo && shop.logoUrl ? `<img class="logo" src="${esc(shop.logoUrl)}" alt="">` : ''}
  <div class="c b big dir">${esc(shop.name)}</div>
  ${shop.address ? `<div class="c sm dir">${nl2br(shop.address)}</div>` : ''}
  ${shop.phone ? `<div class="c sm">${esc(t('print.tel'))}: ${esc(shop.phone)}</div>` : ''}
  ${s.showVatNumber && shop.vatNumber ? `<div class="c sm">${esc(t('print.vatNo'))}: ${esc(shop.vatNumber)}</div>` : ''}
  ${shop.crNumber ? `<div class="c sm">${esc(t('print.crNo'))}: ${esc(shop.crNumber)}</div>` : ''}
  ${s.header ? `<div class="c sm dir">${nl2br(s.header)}</div>` : ''}`;
}

function methodLabel(t: TFn, m: string): string {
  return t(`paymentMethod.${m}`);
}

/** 80mm customer receipt (also a simplified tax invoice). */
export function renderReceiptHtml(
  shop: PrintShop,
  o: PrintOrder,
  s: ReceiptSettings,
  t: TFn,
  opts: { copyLabel?: string } = {},
): string {
  const money = (v: number) => formatBhd(v, false);
  const itemsRows = o.items
    .map((it) => {
      const qty = it.unit === 'SQM' ? `${it.area ?? 0} m²` : String(it.quantity);
      const extra = [it.color, it.brand].filter(Boolean).join(', ');
      const dmg = s.showDamageNotes && (it.damage.length || it.damageNotes)
        ? `<div class="dmg dir">⚠ ${esc(it.damage.map((d) => t(`damage.${d}`)).join(', '))}${it.damageNotes ? ` — ${esc(it.damageNotes)}` : ''}</div>`
        : '';
      const price = it.coveredByPackage ? t('print.package') : money(it.lineTotal);
      return `<tr>
        <td><div class="b dir">${esc(it.itemName)}</div><div class="sm">${esc(it.serviceName)}${extra ? ` · <span class="dir">${esc(extra)}</span>` : ''}</div>
        ${it.notes ? `<div class="sm dir">${esc(it.notes)}</div>` : ''}${dmg}</td>
        <td class="num">${esc(qty)}</td>
        ${s.showItemPrices ? `<td class="num">${esc(price)}</td>` : ''}
      </tr>`;
    })
    .join('');

  const payments = o.payments
    .filter((p) => p.amount !== 0)
    .map((p) => `<div class="row sm"><span>&nbsp;&nbsp;${esc(methodLabel(t, p.method))}</span><span>${money(p.amount)}</span></div>`)
    .join('');

  const pieces = o.pieces.length;
  const body = `<div class="r">
  ${shopHeader(shop, { showLogo: s.showLogo, showVatNumber: s.showVatNumber, header: s.header }, t)}
  <div class="hr"></div>
  <div class="c b">${esc(shop.vatNumber ? t('print.taxInvoice') : t('print.receipt'))}${opts.copyLabel ? ` <span class="sm">(${esc(opts.copyLabel)})</span>` : ''}</div>
  <div class="row"><span class="b xl">#${o.orderNo}</span><span>${o.express ? `<span class="badge">${esc(t('print.express'))}</span>` : ''}</span></div>
  <div class="row sm"><span>${esc(t('print.date'))}</span><span>${esc(fmtDateTime(o.createdAt))}</span></div>
  ${s.showCashier && o.cashierName ? `<div class="row sm"><span>${esc(t('print.cashier'))}</span><span class="dir">${esc(o.cashierName)}</span></div>` : ''}
  ${o.customer ? `<div class="row"><span>${esc(t('print.customer'))}</span><span class="b dir">${esc(o.customer.name)}</span></div>` : ''}
  ${o.customer?.mobile && s.showCustomerPhone ? `<div class="row sm"><span>${esc(t('print.phone'))}</span><span>${esc(formatMobile(o.customer.mobile))}</span></div>` : ''}
  <div class="hr"></div>
  <table><thead><tr><th>${esc(t('print.item'))}</th><th class="num">${esc(t('print.qty'))}</th>${s.showItemPrices ? `<th class="num">${esc(t('print.amount'))}</th>` : ''}</tr></thead>
  <tbody>${itemsRows}</tbody></table>
  <div class="hr"></div>
  <div class="row"><span>${esc(t('print.subtotal'))}</span><span>${money(o.subtotal)}</span></div>
  ${o.expressSurcharge ? `<div class="row"><span>${esc(t('print.expressSurcharge'))}</span><span>${money(o.expressSurcharge)}</span></div>` : ''}
  ${o.discountTotal ? `<div class="row"><span>${esc(t('print.discount'))}</span><span>-${money(o.discountTotal)}</span></div>` : ''}
  <div class="row"><span>${esc(t('print.vat', { rate: o.vatRate }))}</span><span>${money(o.vatAmount)}</span></div>
  <div class="row b big"><span>${esc(t('print.total'))}</span><span>${esc(formatBhd(o.total))}</span></div>
  <div class="row"><span>${esc(t('print.paid'))}</span><span>${money(o.paidAmount)}</span></div>
  ${payments}
  <div class="row b"><span>${esc(t('print.balanceDue'))}</span><span>${money(o.balanceDue)}</span></div>
  ${o.onAccount ? `<div class="sm">${esc(t('print.onAccount'))}</div>` : ''}
  ${s.showWalletBalance && o.walletBalance !== null && o.walletBalance !== undefined ? `<div class="row"><span>${esc(t('print.walletBalance'))}</span><span class="b">${money(o.walletBalance)}</span></div>` : ''}
  <div class="hr"></div>
  ${s.showExpectedDate && o.expectedAt ? `<div class="row b"><span>${esc(t('print.expected'))}</span><span>${esc(fmtDateTime(o.expectedAt))}</span></div>` : ''}
  <div class="row"><span>${esc(t('print.pieces'))}</span><span class="b">${pieces}</span></div>
  ${o.notes ? `<div class="sm dir">${esc(t('print.notes'))}: ${esc(o.notes)}</div>` : ''}
  <div class="c bc" style="margin-top:4px">${code128Svg(orderBarcode(o.orderNo))}</div>
  ${s.showQr && o.qrLink ? `<div class="c qr">${qrSvg(o.qrLink)}</div>` : ''}
  ${s.terms ? `<div class="sm dir" style="margin-top:4px">${nl2br(s.terms)}</div>` : ''}
  ${s.footer ? `<div class="c b dir" style="margin-top:4px">${nl2br(s.footer)}</div>` : ''}
  </div>`;
  return doc(`#${o.orderNo}`, BASE_CSS, body);
}

/** One label per piece: order number, piece x/y, barcode, customer, service, express flag. */
export function renderTagsHtml(shop: PrintShop, o: PrintOrder, s: TagSettings, t: TFn, onlyPieces?: number[]): string {
  const total = o.pieces.length;
  const pieces = onlyPieces?.length ? o.pieces.filter((p) => onlyPieces.includes(p.pieceNo)) : o.pieces;
  const w = s.format === 'LABEL' ? s.labelWidthMm : 80;
  const h = s.format === 'LABEL' ? s.labelHeightMm : 40;
  const pad = s.format === 'LABEL' ? 1.5 : 4;
  const css = `${BASE_CSS}
  @page{size:${w}mm ${h}mm;margin:0}
  .tag{width:${w}mm;height:${h}mm;padding:${pad}mm ${pad + 1}mm;overflow:hidden;page-break-after:always;break-after:page;display:flex;flex-direction:column;justify-content:space-between}
  .tag:last-child{page-break-after:auto;break-after:auto}
  .tag .top{display:flex;justify-content:space-between;align-items:baseline}
  .tag .no{font-size:${s.format === 'LABEL' ? 14 : 20}px;font-weight:800}
  .tag .bc svg{width:100%;height:${s.format === 'LABEL' ? 7 : 10}mm}
  .tag .ln{font-size:${s.format === 'LABEL' ? 9 : 12}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tag .xp{background:#000;color:#fff;padding:0 3px;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
  const short = (o.customer?.name ?? '').split(/\s+/).slice(0, 2).join(' ');
  const tags = pieces
    .map(
      (p) => `<div class="tag">
      <div class="top"><span class="no">#${o.orderNo}</span><span class="b">${p.pieceNo}/${total}</span>${o.express ? `<span class="xp">${esc(t('print.expressShort'))}</span>` : ''}</div>
      <div class="bc">${code128Svg(pieceBarcode(o.orderNo, p.pieceNo))}</div>
      ${s.showCustomerName && short ? `<div class="ln b dir">${esc(short)}</div>` : ''}
      <div class="ln dir">${esc(p.itemName)}${s.showService ? ` · ${esc(p.serviceName)}` : ''}${s.showColor && p.color ? ` · ${esc(p.color)}` : ''}</div>
      ${s.showExpectedDate && o.expectedAt ? `<div class="ln">${esc(fmtDate(o.expectedAt))}</div>` : ''}
    </div>`,
    )
    .join('');
  return doc(`Tags #${o.orderNo}`, css, tags || `<div class="tag">${esc(shop.name)}</div>`);
}

/** 80mm receipt for a balance top-up or package purchase. */
export function renderTopupReceiptHtml(shop: PrintShop, r: PrintTopup, s: ReceiptSettings, t: TFn): string {
  const money = (v: number) => formatBhd(v, false);
  const body = `<div class="r">
  ${shopHeader(shop, { showLogo: s.showLogo, showVatNumber: s.showVatNumber, header: s.header }, t)}
  <div class="hr"></div>
  <div class="c b">${esc(t('print.topupReceipt'))}</div>
  <div class="row sm"><span>${esc(t('print.receiptNo'))}</span><span>${esc(r.receiptNo)}</span></div>
  <div class="row sm"><span>${esc(t('print.date'))}</span><span>${esc(fmtDateTime(r.createdAt))}</span></div>
  ${r.cashierName ? `<div class="row sm"><span>${esc(t('print.cashier'))}</span><span class="dir">${esc(r.cashierName)}</span></div>` : ''}
  <div class="row"><span>${esc(t('print.customer'))}</span><span class="b dir">${esc(r.customer.name)}</span></div>
  ${r.customer.mobile ? `<div class="row sm"><span>${esc(t('print.phone'))}</span><span>${esc(formatMobile(r.customer.mobile))}</span></div>` : ''}
  <div class="hr"></div>
  <div class="b dir">${esc(r.description)}</div>
  <div class="row"><span>${esc(t('print.amountPaid'))} (${esc(methodLabel(t, r.method))})</span><span>${money(r.amountPaid)}</span></div>
  ${r.creditAdded ? `<div class="row"><span>${esc(t('print.creditAdded'))}</span><span>${money(r.creditAdded)}</span></div>` : ''}
  ${r.bonusAdded ? `<div class="row"><span>${esc(t('print.bonusAdded'))}</span><span>${money(r.bonusAdded)}</span></div>` : ''}
  ${r.itemsLine ? `<div class="row"><span>${esc(r.itemsLine)}</span></div>` : ''}
  <div class="hr"></div>
  <div class="row b big"><span>${esc(t('print.newBalance'))}</span><span>${esc(formatBhd(r.balanceAfter))}</span></div>
  ${s.footer ? `<div class="c b dir" style="margin-top:6px">${nl2br(s.footer)}</div>` : ''}
  </div>`;
  return doc(r.receiptNo, BASE_CSS, body);
}
