import { esc, fmtDate, fmtDateTime, formatBhd, formatMobile, nl2br, type TFn } from '@laundry/shared';
import type { Table } from '../lib/excel';
import { t as tr } from '../lib/t';

export interface PdfShop {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  vatNumber?: string | null;
  crNumber?: string | null;
  logoDataUri?: string | null;
}

const CSS = `
*{box-sizing:border-box}
body{font-family:"Noto Sans","Noto Sans Arabic","DejaVu Sans",Arial,sans-serif;font-size:11px;color:#1b1f24;margin:0}
h1{font-size:20px;margin:0 0 2px;letter-spacing:.5px}
h2{font-size:13px;margin:14px 0 6px}
.muted{color:#5b6573}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1d4ed8;padding-bottom:10px;margin-bottom:12px}
.shop .name{font-size:16px;font-weight:700}
.shop img{max-height:56px;max-width:160px;display:block;margin-bottom:4px}
.title{text-align:right}
.title .doc{font-size:20px;font-weight:800;color:#1d4ed8;text-transform:uppercase}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.box{border:1px solid #d7dde5;border-radius:6px;padding:8px 10px}
.box .lbl{font-size:9px;text-transform:uppercase;color:#5b6573;letter-spacing:.4px}
table{width:100%;border-collapse:collapse}
th{background:#eef2f8;text-align:left;font-size:10px;padding:6px;border-bottom:1px solid #c9d2de}
td{padding:5px 6px;border-bottom:1px solid #edf0f4;vertical-align:top}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
tr.total td{font-weight:700;border-top:1px solid #9aa6b5;background:#f7f9fc}
.totals{width:300px;margin-left:auto;margin-top:10px}
.totals td{border:none;padding:3px 6px}
.totals tr.grand td{font-size:14px;font-weight:800;border-top:2px solid #1b1f24}
.dir{unicode-bidi:plaintext}
.foot{margin-top:18px;font-size:10px;color:#5b6573}
.badge{display:inline-block;padding:1px 6px;border-radius:8px;background:#fde68a;font-size:9px;font-weight:700}
`;

function page(title: string, body: string, landscape = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}${landscape ? '@page{size:A4 landscape}' : ''}</style></head><body>${body}</body></html>`;
}

function header(shop: PdfShop, docTitle: string, sub: string[]): string {
  return `<div class="head">
    <div class="shop">
      ${shop.logoDataUri ? `<img src="${shop.logoDataUri}">` : ''}
      <div class="name dir">${esc(shop.name)}</div>
      ${shop.address ? `<div class="muted dir">${nl2br(shop.address)}</div>` : ''}
      ${shop.phone ? `<div class="muted">${esc(tr('pdf.tel'))}: ${esc(shop.phone)}${shop.email ? ` · ${esc(shop.email)}` : ''}</div>` : ''}
      ${shop.crNumber ? `<div class="muted">${esc(tr('pdf.crNo'))}: ${esc(shop.crNumber)}</div>` : ''}
      ${shop.vatNumber ? `<div class="muted">${esc(tr('pdf.vatAccountNo'))}: <b>${esc(shop.vatNumber)}</b></div>` : ''}
    </div>
    <div class="title"><div class="doc">${esc(docTitle)}</div>${sub.map((s) => `<div class="muted">${s}</div>`).join('')}</div>
  </div>`;
}

const m = (v: number) => formatBhd(v, false);

// ───────────────────────────── Tax invoice ─────────────────────────────

export interface InvoiceData {
  orderNo: number;
  createdAt: Date;
  deliveredAt?: Date | null;
  status: string;
  customer: { name: string; mobile?: string | null; email?: string | null; address?: string | null; type?: string } | null;
  items: {
    lineNo: number;
    description: string;
    quantity: number;
    unitLabel: string;
    unitPrice: number;
    discount: number;
    net: number;
  }[];
  subtotal: number;
  expressSurcharge: number;
  discountTotal: number;
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paidAmount: number;
  balanceDue: number;
  pricesIncludeVat: boolean;
  payments: { date: Date; method: string; amount: number }[];
  footer?: string;
  terms?: string;
  bankDetails?: string;
}

/** A4 tax invoice meeting Bahrain VAT invoice requirements. */
export function taxInvoiceHtml(shop: PdfShop, d: InvoiceData, t: TFn): string {
  const rows = d.items
    .map(
      (it) => `<tr>
      <td>${it.lineNo}</td>
      <td class="dir">${esc(it.description)}</td>
      <td class="num">${esc(it.unitLabel)}</td>
      <td class="num">${m(it.unitPrice)}</td>
      <td class="num">${it.discount ? `-${m(it.discount)}` : ''}</td>
      <td class="num">${m(it.net)}</td>
    </tr>`,
    )
    .join('');
  const pays = d.payments.length
    ? `<h2>${esc(t('pdf.payments'))}</h2><table><thead><tr><th>${esc(t('pdf.date'))}</th><th>${esc(t('pdf.method'))}</th><th class="num">${esc(t('pdf.amountBhd'))}</th></tr></thead><tbody>${d.payments
        .map((p) => `<tr><td>${esc(fmtDateTime(p.date))}</td><td>${esc(t(`paymentMethod.${p.method}`))}</td><td class="num">${m(p.amount)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
  const body = `
  ${header(shop, shop.vatNumber ? t('pdf.taxInvoice') : t('pdf.invoice'), [`${esc(t('pdf.invoiceNo'))}: <b>${d.orderNo}</b>`, `${esc(t('pdf.dateOfIssue'))}: ${esc(fmtDate(d.createdAt))}`, d.deliveredAt ? `${esc(t('pdf.dateOfSupply'))}: ${esc(fmtDate(d.deliveredAt))}` : ''])}
  <div class="meta">
    <div class="box"><div class="lbl">${esc(t('pdf.billTo'))}</div>
      <div class="dir"><b>${esc(d.customer?.name ?? t('pdf.walkIn'))}</b></div>
      ${d.customer?.mobile ? `<div>${esc(formatMobile(d.customer.mobile))}</div>` : ''}
      ${d.customer?.email ? `<div>${esc(d.customer.email)}</div>` : ''}
      ${d.customer?.address ? `<div class="dir">${esc(d.customer.address)}</div>` : ''}
    </div>
    <div class="box"><div class="lbl">${esc(t('pdf.summary'))}</div>
      <div>${esc(t('pdf.currency'))}</div>
      <div>${esc(t('pdf.vatRate', { rate: d.vatRate }))} ${d.pricesIncludeVat ? esc(t('pdf.pricesIncludeVat')) : ''}</div>
      <div>${esc(t('pdf.status'))}: ${esc(t(`orderStatus.${d.status}`))}${d.status === 'CANCELLED' ? ` <span class="badge">${esc(t('pdf.cancelled'))}</span>` : ''}</div>
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>${esc(t('pdf.description'))}</th><th class="num">${esc(t('pdf.qty'))}</th><th class="num">${esc(t('pdf.unitPrice'))}</th><th class="num">${esc(t('pdf.discount'))}</th><th class="num">${esc(t('pdf.amount'))}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><td>${esc(t('pdf.subtotal'))}</td><td class="num">${m(d.subtotal)}</td></tr>
    ${d.expressSurcharge ? `<tr><td>${esc(t('pdf.expressSurcharge'))}</td><td class="num">${m(d.expressSurcharge)}</td></tr>` : ''}
    ${d.discountTotal ? `<tr><td>${esc(t('pdf.discount'))}</td><td class="num">-${m(d.discountTotal)}</td></tr>` : ''}
    <tr><td>${esc(t('pdf.taxable'))}</td><td class="num">${m(d.netAmount)}</td></tr>
    <tr><td>${esc(t('pdf.vat', { rate: d.vatRate }))}</td><td class="num">${m(d.vatAmount)}</td></tr>
    <tr class="grand"><td>${esc(t('pdf.totalBhd'))}</td><td class="num">${m(d.total)}</td></tr>
    <tr><td>${esc(t('pdf.paid'))}</td><td class="num">${m(d.paidAmount)}</td></tr>
    <tr><td><b>${esc(t('pdf.balanceDue'))}</b></td><td class="num"><b>${m(d.balanceDue)}</b></td></tr>
  </table>
  ${pays}
  ${d.bankDetails ? `<h2>${esc(t('pdf.bankDetails'))}</h2><div class="dir">${nl2br(d.bankDetails)}</div>` : ''}
  ${d.terms ? `<div class="foot dir">${nl2br(d.terms)}</div>` : ''}
  ${d.footer ? `<div class="foot dir" style="text-align:center">${nl2br(d.footer)}</div>` : ''}`;
  return page(`Invoice ${d.orderNo}`, body);
}

// ───────────────────────────── Statements ─────────────────────────────

export interface StatementRow {
  date: Date;
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementData {
  title: string;
  customer: { name: string; mobile?: string | null; email?: string | null; type?: string; creditLimit?: number | null };
  from: string;
  to: string;
  opening: number;
  closing: number;
  rows: StatementRow[];
  debitLabel: string;
  creditLabel: string;
  balanceLabel: string;
  summary?: { label: string; value: string }[];
  note?: string;
}

export function statementHtml(shop: PdfShop, d: StatementData): string {
  const rows = d.rows
    .map(
      (r) => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.ref)}</td><td class="dir">${esc(r.description)}</td>
      <td class="num">${r.debit ? m(r.debit) : ''}</td><td class="num">${r.credit ? m(r.credit) : ''}</td><td class="num">${m(r.balance)}</td></tr>`,
    )
    .join('');
  const body = `
  ${header(shop, d.title, [esc(tr('pdf.period', { from: fmtDate(d.from), to: fmtDate(d.to) })), esc(tr('pdf.issued', { date: fmtDate(new Date()) }))])}
  <div class="meta">
    <div class="box"><div class="lbl">${esc(tr('pdf.customer'))}</div><div class="dir"><b>${esc(d.customer.name)}</b></div>
      ${d.customer.mobile ? `<div>${esc(formatMobile(d.customer.mobile))}</div>` : ''}
      ${d.customer.email ? `<div>${esc(d.customer.email)}</div>` : ''}
      ${d.customer.creditLimit ? `<div>${esc(tr('pdf.creditLimit', { amount: m(d.customer.creditLimit) }))}</div>` : ''}
    </div>
    <div class="box"><div class="lbl">${esc(tr('pdf.summary'))}</div>
      <div>${esc(tr('pdf.opening', { label: d.balanceLabel.toLowerCase() }))}: <b>BHD ${m(d.opening)}</b></div>
      ${(d.summary ?? []).map((s) => `<div>${esc(s.label)}: <b>${esc(s.value)}</b></div>`).join('')}
      <div>${esc(tr('pdf.closing', { label: d.balanceLabel.toLowerCase() }))}: <b>BHD ${m(d.closing)}</b></div>
    </div>
  </div>
  <table>
    <thead><tr><th>${esc(tr('pdf.date'))}</th><th>${esc(tr('pdf.ref'))}</th><th>${esc(tr('pdf.description'))}</th><th class="num">${esc(d.debitLabel)}</th><th class="num">${esc(d.creditLabel)}</th><th class="num">${esc(d.balanceLabel)}</th></tr></thead>
    <tbody>
      <tr><td>${esc(fmtDate(d.from))}</td><td></td><td>${esc(tr('pdf.openingBalance'))}</td><td></td><td></td><td class="num">${m(d.opening)}</td></tr>
      ${rows}
      <tr class="total"><td colspan="5">${esc(tr('pdf.closingBalance'))}</td><td class="num">${m(d.closing)}</td></tr>
    </tbody>
  </table>
  ${d.note ? `<div class="foot">${esc(d.note)}</div>` : ''}`;
  return page(d.title, body);
}

// ───────────────────────────── Payslip ─────────────────────────────

export interface PayslipData {
  month: string;
  employee: { name: string; position?: string | null; cpr?: string | null; nationality?: string | null; joinDate?: string | null };
  basic: number;
  allowances: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  advances: { name: string; amount: number }[];
  net: number;
  daysWorked?: number | null;
  unpaidLeaveDays?: number;
  status: string;
  paidDate?: string | null;
  paymentMethod?: string | null;
}

export function payslipHtml(shop: PdfShop, d: PayslipData, t: TFn): string {
  const monthName = new Date(`${d.month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const earnings = [{ name: t('pdf.basicSalary'), amount: d.basic }, ...d.allowances];
  const minus = [...d.deductions, ...d.advances.map((a) => ({ name: `${t('pdf.advance')}: ${a.name}`, amount: a.amount }))];
  const gross = earnings.reduce((s, e) => s + e.amount, 0);
  const totalMinus = minus.reduce((s, e) => s + e.amount, 0);
  const lines = (list: { name: string; amount: number }[]) =>
    list.length ? list.map((e) => `<tr><td class="dir">${esc(e.name)}</td><td class="num">${m(e.amount)}</td></tr>`).join('') : '<tr><td class="muted">—</td><td></td></tr>';
  const body = `
  ${header(shop, t('pdf.payslip'), [esc(monthName), d.status === 'PAID' ? `${esc(t('pdf.paidOn', { date: fmtDate(d.paidDate ?? '') }))}${d.paymentMethod ? ` · ${esc(t(`paymentMethod.${d.paymentMethod}`))}` : ''}` : esc(t('pdf.draft'))])}
  <div class="meta">
    <div class="box"><div class="lbl">${esc(t('pdf.employee'))}</div><div class="dir"><b>${esc(d.employee.name)}</b></div>
      ${d.employee.position ? `<div>${esc(d.employee.position)}</div>` : ''}
      ${d.employee.cpr ? `<div>${esc(t('pdf.cpr'))}: ${esc(d.employee.cpr)}</div>` : ''}
      ${d.employee.nationality ? `<div>${esc(t('pdf.nationality'))}: ${esc(d.employee.nationality)}</div>` : ''}
      ${d.employee.joinDate ? `<div>${esc(t('pdf.joined'))}: ${esc(fmtDate(d.employee.joinDate))}</div>` : ''}
    </div>
    <div class="box"><div class="lbl">${esc(t('pdf.attendance'))}</div>
      ${d.daysWorked !== null && d.daysWorked !== undefined ? `<div>${esc(t('pdf.daysWorked'))}: ${d.daysWorked}</div>` : ''}
      <div>${esc(t('pdf.unpaidLeaveDays'))}: ${d.unpaidLeaveDays ?? 0}</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div><h2>${esc(t('pdf.earnings'))}</h2><table><tbody>${lines(earnings)}<tr class="total"><td>${esc(t('pdf.totalEarnings'))}</td><td class="num">${m(gross)}</td></tr></tbody></table></div>
    <div><h2>${esc(t('pdf.deductions'))}</h2><table><tbody>${lines(minus)}<tr class="total"><td>${esc(t('pdf.totalDeductions'))}</td><td class="num">${m(totalMinus)}</td></tr></tbody></table></div>
  </div>
  <table class="totals"><tr class="grand"><td>${esc(t('pdf.netPay'))}</td><td class="num">${m(d.net)}</td></tr></table>
  <div style="display:flex;justify-content:space-between;margin-top:50px">
    <div>______________________<br><span class="muted">${esc(t('pdf.employer'))}</span></div>
    <div>______________________<br><span class="muted">${esc(t('pdf.employeeSignature'))}</span></div>
  </div>`;
  return page(`Payslip ${d.employee.name} ${d.month}`, body);
}

// ───────────────────────────── Reports ─────────────────────────────

export function reportHtml(shop: PdfShop, tables: Table[], meta: { title: string; subtitle?: string }): string {
  const wide = tables.some((t) => t.columns.length > 7);
  const fmt = (v: unknown, type?: string) => {
    if (v === null || v === undefined || v === '') return '';
    if (type === 'money') return m(Number(v));
    if (type === 'percent') return `${Number(v).toFixed(2)}%`;
    if (type === 'number') return Number(v).toLocaleString('en-US');
    return esc(v);
  };
  const tableHtml = (t: Table) => `
    ${tables.length > 1 || t.title ? `<h2>${esc(t.title ?? t.name)}</h2>` : ''}
    ${t.subtitle ? `<div class="muted">${esc(t.subtitle)}</div>` : ''}
    <table><thead><tr>${t.columns.map((c) => `<th class="${c.type && c.type !== 'text' ? 'num' : ''}">${esc(c.header)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows
      .map((r) => `<tr>${t.columns.map((c) => `<td class="${c.type && c.type !== 'text' ? 'num' : 'dir'}">${fmt(r[c.key], c.type)}</td>`).join('')}</tr>`)
      .join('')}
    ${t.totals ? `<tr class="total">${t.columns.map((c) => `<td class="${c.type && c.type !== 'text' ? 'num' : ''}">${fmt(t.totals![c.key], c.type)}</td>`).join('')}</tr>` : ''}
    ${t.rows.length === 0 ? `<tr><td colspan="${t.columns.length}" class="muted">${esc(tr('pdf.noData'))}</td></tr>` : ''}
    </tbody></table>`;
  const body = `${header(shop, meta.title, [meta.subtitle ? esc(meta.subtitle) : '', esc(tr('pdf.generated', { date: fmtDateTime(new Date()) }))])}${tables.map(tableHtml).join('')}`;
  return page(meta.title, body, wide);
}
