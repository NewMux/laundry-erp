import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Printer } from 'lucide-react';
import type { PrintOrder, ReceiptSettings, TagSettings } from '@laundry/shared';
import { renderReceiptHtml, renderTagsHtml } from '@laundry/shared/print';
import i18n from '../../i18n';
import { useAuth } from '../../lib/auth';
import { printHtml } from '../../lib/print';
import { Button, Card, Checkbox, Field, Input, Loading, Select, Tabs, Textarea } from '../../components/ui';
import { useSettingsForm } from './useSettings';

const tr = (k: string, v?: Record<string, unknown>) => i18n.t(k, v as Record<string, unknown>) as string;

const SAMPLE: PrintOrder = {
  orderNo: 1042,
  createdAt: new Date().toISOString(),
  expectedAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  express: false,
  cashierName: 'Ravi',
  customer: { name: 'Ahmed Al-Khalifa', mobile: '97333112233' },
  items: [
    { lineNo: 1, itemName: 'Thobe', serviceName: 'Wash & Iron', unit: 'PIECE', quantity: 3, unitPrice: 0.4, discountAmount: 0, lineTotal: 1.2, color: 'White', damage: [] },
    { lineNo: 2, itemName: 'Ghutra', serviceName: 'Wash & Iron', unit: 'PIECE', quantity: 2, unitPrice: 0.3, discountAmount: 0, lineTotal: 0.6, damage: ['STAIN'], damageNotes: 'Collar' },
  ],
  pieces: [
    { pieceNo: 1, itemName: 'Thobe', serviceName: 'Wash & Iron', color: 'White' },
    { pieceNo: 2, itemName: 'Thobe', serviceName: 'Wash & Iron', color: 'White' },
    { pieceNo: 3, itemName: 'Thobe', serviceName: 'Wash & Iron', color: 'White' },
    { pieceNo: 4, itemName: 'Ghutra', serviceName: 'Wash & Iron' },
    { pieceNo: 5, itemName: 'Ghutra', serviceName: 'Wash & Iron' },
  ],
  subtotal: 1.8,
  discountTotal: 0,
  expressSurcharge: 0,
  vatRate: 10,
  vatAmount: 0.18,
  netAmount: 1.8,
  total: 1.98,
  paidAmount: 1.98,
  balanceDue: 0,
  onAccount: false,
  payments: [{ method: 'CASH', amount: 1.98 }],
  walletBalance: 12.5,
  qrLink: 'https://example.com/r/demo',
};

export default function PrintingSettings() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const { settings: s, setSettings, save, canEdit } = useSettingsForm();
  const [tab, setTab] = useState<'receipt' | 'tags' | 'invoice'>('receipt');
  const shop = useMemo(
    () => ({
      name: me?.tenant?.name ?? '',
      address: me?.tenant?.address,
      phone: me?.tenant?.phone,
      vatNumber: me?.tenant?.vatNumber,
      crNumber: me?.tenant?.crNumber,
      logoUrl: me?.tenant?.logoFileId ? `/api/files/${me.tenant.logoFileId}` : null,
    }),
    [me],
  );
  if (!s) return <Loading />;
  const r = s.receipt;
  const tg = s.tag;
  const setR = (patch: Partial<ReceiptSettings>) => setSettings({ ...s, receipt: { ...r, ...patch } });
  const setT = (patch: Partial<TagSettings>) => setSettings({ ...s, tag: { ...tg, ...patch } });
  const preview = tab === 'tags' ? renderTagsHtml(shop, SAMPLE, tg, tr, [1, 4]) : renderReceiptHtml(shop, SAMPLE, r, tr);
  const receiptFlags: (keyof ReceiptSettings)[] = ['showLogo', 'showVatNumber', 'showCustomerPhone', 'showDamageNotes', 'showQr', 'showItemPrices', 'showExpectedDate', 'showWalletBalance', 'showCashier'];
  const tagFlags: (keyof TagSettings)[] = ['showCustomerName', 'showService', 'showColor', 'showExpectedDate'];

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>{t('settings.silentPrinting')}</span>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'receipt', label: t('settings.receipt') }, { value: 'tags', label: t('settings.tags') }, { value: 'invoice', label: t('settings.invoice') }]} />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <fieldset disabled={!canEdit} className="space-y-4">
            {tab === 'receipt' && (
              <>
                <Field label={t('settings.header')}>
                  <Textarea value={r.header} onChange={(e) => setR({ header: e.target.value })} />
                </Field>
                <Field label={t('settings.terms')}>
                  <Textarea rows={3} value={r.terms} onChange={(e) => setR({ terms: e.target.value })} />
                </Field>
                <Field label={t('settings.footer')}>
                  <Input value={r.footer} onChange={(e) => setR({ footer: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {receiptFlags.map((k) => (
                    <Checkbox key={k} checked={!!r[k]} onChange={(v) => setR({ [k]: v } as Partial<ReceiptSettings>)} label={t(`settings.show.${k}`)} />
                  ))}
                </div>
                <Field label={t('settings.copies')}>
                  <Select className="w-32" value={r.copies} onChange={(e) => setR({ copies: Number(e.target.value) })}>
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            {tab === 'tags' && (
              <>
                <Field label={t('settings.tagFormat')}>
                  <Select value={tg.format} onChange={(e) => setT({ format: e.target.value as 'PAPER' | 'LABEL' })}>
                    <option value="PAPER">{t('settings.tagFormats.PAPER')}</option>
                    <option value="LABEL">{t('settings.tagFormats.LABEL')}</option>
                  </Select>
                </Field>
                {tg.format === 'LABEL' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('settings.labelWidth')}>
                      <Input inputMode="numeric" value={tg.labelWidthMm} onChange={(e) => setT({ labelWidthMm: Number(e.target.value) || 50 })} />
                    </Field>
                    <Field label={t('settings.labelHeight')}>
                      <Input inputMode="numeric" value={tg.labelHeightMm} onChange={(e) => setT({ labelHeightMm: Number(e.target.value) || 30 })} />
                    </Field>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {tagFlags.map((k) => (
                    <Checkbox key={k} checked={!!tg[k]} onChange={(v) => setT({ [k]: v } as Partial<TagSettings>)} label={t(`settings.show.${k}`)} />
                  ))}
                </div>
              </>
            )}
            {tab === 'invoice' && (
              <>
                <Field label={t('settings.terms')}>
                  <Textarea rows={3} value={s.invoice.terms} onChange={(e) => setSettings({ ...s, invoice: { ...s.invoice, terms: e.target.value } })} />
                </Field>
                <Field label={t('settings.bankDetails')}>
                  <Textarea rows={3} value={s.invoice.bankDetails} onChange={(e) => setSettings({ ...s, invoice: { ...s.invoice, bankDetails: e.target.value } })} />
                </Field>
                <Field label={t('settings.footer')}>
                  <Input value={s.invoice.footer} onChange={(e) => setSettings({ ...s, invoice: { ...s.invoice, footer: e.target.value } })} />
                </Field>
              </>
            )}
            {canEdit && (
              <Button loading={save.isPending} onClick={() => save.mutate(s)}>
                {t('common.save')}
              </Button>
            )}
          </fieldset>
        </Card>
        {tab !== 'invoice' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600">{t('settings.preview')}</span>
              <Button size="sm" variant="secondary" icon={<Printer className="size-4" />} onClick={() => void printHtml(preview)}>
                {t('settings.testPrint')}
              </Button>
            </div>
            <iframe title="preview" srcDoc={preview} className="h-[640px] w-full rounded-xl border border-slate-200 bg-white shadow-inner" sandbox="allow-same-origin" />
          </div>
        )}
      </div>
    </div>
  );
}
