import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { DEFAULT_APP_SLOTS, type CustomerAppSettings as AppSettings, type TenantSettings } from '@laundry/shared';
import { Badge, Button, Card, Field, IconButton, Input, Loading, MoneyInput, Switch } from '../../components/ui';
import { useSettingsForm } from './useSettings';

/**
 * The customer app, as this shop offers it: on or off, counter service,
 * driver pickup and delivery with their fees, the driver time windows and
 * how customers may pay. Customers join with the shop's customer code.
 */
export default function CustomerAppSettings() {
  const { t } = useTranslation();
  const { q, settings: s, setSettings, save, canEdit } = useSettingsForm();
  if (!s) return <Loading />;
  const a = s.customerApp;
  const set = (patch: Partial<AppSettings>) => setSettings({ ...s, customerApp: { ...a, ...patch } } as TenantSettings);
  const money = (v: string) => (v === '' ? 0 : Number(v));
  const optMoney = (v: string) => (v === '' ? null : Number(v));
  const code: string | null = save.data?.customerCode ?? q.data?.shop?.customerCode ?? null;
  const drivers = a.pickup.enabled || a.delivery.enabled;

  const setSlot = (i: number, patch: Partial<AppSettings['slots'][number]>) => set({ slots: a.slots.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addSlot = () => {
    const last = a.slots[a.slots.length - 1];
    const start = Math.min(22, last ? last.endHour : 9);
    set({ slots: [...a.slots, { id: `w${Date.now().toString(36).slice(-4)}`, label: '', labelAr: '', startHour: start, endHour: Math.min(24, start + 3) }] });
  };

  return (
    <div className="space-y-4">
      <Card title={t('customerApp.title')} actions={a.enabled ? <Badge color="green">{t('customerApp.on')}</Badge> : <Badge>{t('customerApp.off')}</Badge>}>
        <fieldset disabled={!canEdit} className="space-y-4">
          <p className="text-sm text-slate-600">{t('customerApp.intro')}</p>
          <Switch checked={a.enabled} onChange={(v) => set({ enabled: v })} label={t('customerApp.enabled')} />
          {code ? (
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('customerApp.code')}</div>
              <div className="font-mono text-2xl font-bold tracking-[0.2em] text-brand-700">{code}</div>
              <div className="mt-1 text-xs text-slate-500">{t('customerApp.codeHint', { link: `newmux://join/${code}` })}</div>
            </div>
          ) : a.enabled ? (
            <p className="text-xs text-slate-500">{t('customerApp.codeOnSave')}</p>
          ) : null}
        </fieldset>
      </Card>

      <Card title={t('customerApp.handover')}>
        <fieldset disabled={!canEdit || !a.enabled} className="space-y-4">
          <Switch checked={a.counter} onChange={(v) => set({ counter: v })} label={t('customerApp.counter')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-lg p-3 ring-1 ring-slate-200">
              <Switch checked={a.pickup.enabled} onChange={(v) => set({ pickup: { ...a.pickup, enabled: v } })} label={t('customerApp.pickup')} />
              <Field label={t('customerApp.pickupFee')}>
                <MoneyInput value={a.pickup.fee} onChange={(v) => set({ pickup: { ...a.pickup, fee: money(v) } })} disabled={!a.pickup.enabled} />
              </Field>
            </div>
            <div className="space-y-2 rounded-lg p-3 ring-1 ring-slate-200">
              <Switch checked={a.delivery.enabled} onChange={(v) => set({ delivery: { ...a.delivery, enabled: v } })} label={t('customerApp.delivery')} />
              <Field label={t('customerApp.deliveryFee')}>
                <MoneyInput value={a.delivery.fee} onChange={(v) => set({ delivery: { ...a.delivery, fee: money(v) } })} disabled={!a.delivery.enabled} />
              </Field>
            </div>
            <Field label={t('customerApp.roundTrip')} hint={t('customerApp.roundTripHint')}>
              <Input inputMode="decimal" placeholder="—" value={a.roundTripFee ?? ''} disabled={!(a.pickup.enabled && a.delivery.enabled)} onChange={(e) => set({ roundTripFee: optMoney(e.target.value) })} />
            </Field>
            <Field label={t('customerApp.freeAbove')} hint={t('customerApp.freeAboveHint')}>
              <Input inputMode="decimal" placeholder="—" value={a.freeAbove ?? ''} disabled={!drivers} onChange={(e) => set({ freeAbove: optMoney(e.target.value) })} />
            </Field>
          </div>
          {!a.counter && !(a.pickup.enabled && a.delivery.enabled) && <p className="text-sm text-red-600">{t('customerApp.needBoth')}</p>}
        </fieldset>
      </Card>

      <Card title={t('customerApp.windows')} actions={canEdit && a.enabled && drivers ? <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={addSlot} disabled={a.slots.length >= 8}>{t('customerApp.addWindow')}</Button> : undefined}>
        <fieldset disabled={!canEdit || !a.enabled || !drivers} className="space-y-3">
          <p className="text-sm text-slate-600">{t('customerApp.windowsHint')}</p>
          {a.slots.map((slot, i) => (
            <div key={slot.id} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_90px_90px_auto]">
              <Field label={t('customerApp.windowName')}>
                <Input value={slot.label} onChange={(e) => setSlot(i, { label: e.target.value })} placeholder="Morning" />
              </Field>
              <Field label={t('customerApp.windowNameAr')}>
                <Input dir="rtl" value={slot.labelAr} onChange={(e) => setSlot(i, { labelAr: e.target.value })} placeholder="صباحًا" />
              </Field>
              <Field label={t('customerApp.from')}>
                <Input inputMode="numeric" value={slot.startHour} onChange={(e) => setSlot(i, { startHour: Number(e.target.value) || 0 })} />
              </Field>
              <Field label={t('customerApp.to')}>
                <Input inputMode="numeric" value={slot.endHour} onChange={(e) => setSlot(i, { endHour: Number(e.target.value) || 0 })} />
              </Field>
              <IconButton label={t('common.delete')} onClick={() => set({ slots: a.slots.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
          {a.slots.length === 0 && (
            <Button size="sm" variant="secondary" onClick={() => set({ slots: DEFAULT_APP_SLOTS })}>
              {t('customerApp.defaultWindows')}
            </Button>
          )}
        </fieldset>
      </Card>

      <Card title={t('customerApp.payments')}>
        <fieldset disabled={!canEdit || !a.enabled} className="space-y-3">
          <div className="flex flex-col gap-3">
            <Switch checked={a.payWallet} onChange={(v) => set({ payWallet: v })} label={t('customerApp.payWallet')} />
            <Switch checked={a.payCard} onChange={(v) => set({ payCard: v })} label={t('customerApp.payCard')} />
            <Switch checked={a.payCash} onChange={(v) => set({ payCash: v })} label={t('customerApp.payCash')} />
          </div>
          <p className="text-xs text-slate-500">{t('customerApp.paymentsHint')}</p>
        </fieldset>
      </Card>

      {canEdit && (
        <Button loading={save.isPending} onClick={() => save.mutate(s)}>
          {t('common.save')}
        </Button>
      )}
    </div>
  );
}
