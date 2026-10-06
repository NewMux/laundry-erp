import { useTranslation } from 'react-i18next';
import type { TenantSettings } from '@laundry/shared';
import { Button, Card, Field, Input, Loading, Select, Switch, Textarea } from '../../components/ui';
import { useSettingsForm } from './useSettings';

/** VAT / express / operations preferences, or the WhatsApp message templates. */
export default function PreferencesSettings({ section }: { section: 'pricing' | 'messages' }) {
  const { t } = useTranslation();
  const { settings: s, setSettings, save, canEdit } = useSettingsForm();
  if (!s) return <Loading />;
  const set = (patch: Partial<TenantSettings>) => setSettings({ ...s, ...patch });
  const num = (v: string) => (v === '' ? 0 : Number(v));

  if (section === 'messages') {
    return (
      <Card title={t('settings.messages')}>
        <fieldset disabled={!canEdit} className="space-y-4">
          <p className="text-xs text-slate-500">{t('settings.placeholders')}</p>
          <Field label={t('settings.orderReadyMsg')}>
            <Textarea rows={3} value={s.whatsapp.orderReady} onChange={(e) => set({ whatsapp: { ...s.whatsapp, orderReady: e.target.value } })} />
          </Field>
          <Field label={t('settings.receiptMsg')}>
            <Textarea rows={3} value={s.whatsapp.receiptShare} onChange={(e) => set({ whatsapp: { ...s.whatsapp, receiptShare: e.target.value } })} />
          </Field>
          <Field label={t('settings.statementMsg')}>
            <Textarea rows={2} value={s.whatsapp.statementShare} onChange={(e) => set({ whatsapp: { ...s.whatsapp, statementShare: e.target.value } })} />
          </Field>
          {canEdit && (
            <Button loading={save.isPending} onClick={() => save.mutate(s)}>
              {t('common.save')}
            </Button>
          )}
        </fieldset>
      </Card>
    );
  }

  return (
    <Card title={t('settings.pricing')}>
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.vatRate')}>
            <Input inputMode="decimal" value={s.vatRate} onChange={(e) => set({ vatRate: num(e.target.value) })} />
          </Field>
          <div className="flex items-end pb-2">
            <Switch checked={s.pricesIncludeVat} onChange={(v) => set({ pricesIncludeVat: v })} label={t('settings.pricesIncludeVat')} />
          </div>
          <Field label={t('settings.expressSurcharge')} hint={t('settings.expressHint')}>
            <div className="flex gap-2">
              <Select className="w-40" value={s.expressSurchargeType} onChange={(e) => set({ expressSurchargeType: e.target.value as 'PERCENT' | 'AMOUNT' })}>
                <option value="PERCENT">{t('settings.expressType.PERCENT')}</option>
                <option value="AMOUNT">{t('settings.expressType.AMOUNT')}</option>
              </Select>
              <Input inputMode="decimal" value={s.expressSurchargeValue} onChange={(e) => set({ expressSurchargeValue: num(e.target.value) })} />
            </div>
          </Field>
          <Field label={t('settings.uncollectedDays')}>
            <Input inputMode="numeric" value={s.uncollectedDays} onChange={(e) => set({ uncollectedDays: num(e.target.value) })} />
          </Field>
          <Field label={t('settings.openingFloat')}>
            <Input inputMode="decimal" value={s.defaultOpeningFloat} onChange={(e) => set({ defaultOpeningFloat: num(e.target.value) })} />
          </Field>
          <Field label={t('settings.sessionTimeout')}>
            <Input inputMode="numeric" value={s.sessionTimeoutMinutes} onChange={(e) => set({ sessionTimeoutMinutes: num(e.target.value) })} />
          </Field>
          <Field label={t('settings.annualLeave')}>
            <Input inputMode="decimal" value={s.annualLeaveDays} onChange={(e) => set({ annualLeaveDays: num(e.target.value) })} />
          </Field>
          <Field label={t('settings.sickLeave')}>
            <Input inputMode="decimal" value={s.sickLeaveDays} onChange={(e) => set({ sickLeaveDays: num(e.target.value) })} />
          </Field>
        </div>
        <Switch checked={s.requirePaymentBeforeDelivery} onChange={(v) => set({ requirePaymentBeforeDelivery: v })} label={t('settings.requirePayment')} />
        {canEdit && (
          <div>
            <Button loading={save.isPending} onClick={() => save.mutate(s)}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </fieldset>
    </Card>
  );
}
