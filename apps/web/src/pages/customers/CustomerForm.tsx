import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth';
import { Button, ErrorBox, Field, Input, Modal, MoneyInput, Select, Switch, Textarea } from '../../components/ui';

export interface CustomerFormValue {
  name: string;
  mobile: string;
  altPhone: string;
  email: string;
  cpr: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  notes: string;
  addrFlat: string;
  addrHouse: string;
  addrBuilding: string;
  addrRoad: string;
  addrBlock: string;
  addrArea: string;
  mapUrl: string;
  creditEnabled: boolean;
  creditLimit: string;
}

const EMPTY: CustomerFormValue = {
  name: '',
  mobile: '',
  altPhone: '',
  email: '',
  cpr: '',
  type: 'INDIVIDUAL',
  notes: '',
  addrFlat: '',
  addrHouse: '',
  addrBuilding: '',
  addrRoad: '',
  addrBlock: '',
  addrArea: '',
  mapUrl: '',
  creditEnabled: false,
  creditLimit: '0',
};

export function CustomerFormModal({
  open,
  initial,
  title,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  open: boolean;
  initial?: Partial<Record<keyof CustomerFormValue, unknown>> | null;
  title: string;
  onClose: () => void;
  onSubmit: (v: Record<string, unknown>) => void;
  loading?: boolean;
  error?: unknown;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [v, setV] = useState<CustomerFormValue>(EMPTY);
  useEffect(() => {
    if (!open) return;
    const init: CustomerFormValue = { ...EMPTY };
    for (const k of Object.keys(EMPTY) as (keyof CustomerFormValue)[]) {
      const val = initial?.[k];
      if (val !== undefined && val !== null) (init as unknown as Record<string, unknown>)[k] = k === 'creditLimit' ? String(val) : val;
    }
    setV(init);
  }, [open, initial]);
  const set = (patch: Partial<CustomerFormValue>) => setV((x) => ({ ...x, ...patch }));
  const canCredit = can('customers', 'edit');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={loading} onClick={() => onSubmit({ ...v, creditLimit: Number(v.creditLimit) || 0 })}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('customers.name')}>
            <Input className="bidi" value={v.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
          </Field>
          <Field label={t('customers.mobile')}>
            <Input type="tel" value={v.mobile} onChange={(e) => set({ mobile: e.target.value })} />
          </Field>
          <Field label={t('customers.altPhone')}>
            <Input type="tel" value={v.altPhone} onChange={(e) => set({ altPhone: e.target.value })} />
          </Field>
          <Field label={t('customers.email')}>
            <Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label={t('customers.cpr')}>
            <Input value={v.cpr} onChange={(e) => set({ cpr: e.target.value })} />
          </Field>
          <Field label={t('customers.type')}>
            <Select value={v.type} onChange={(e) => set({ type: e.target.value as CustomerFormValue['type'] })}>
              <option value="INDIVIDUAL">{t('customers.INDIVIDUAL')}</option>
              <option value="COMPANY">{t('customers.COMPANY')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('customers.notes')}>
          <Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">{t('customers.address')}</legend>
          <p className="mb-2 text-xs text-slate-500">{t('customers.addressHint')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(['addrFlat', 'addrHouse', 'addrBuilding', 'addrRoad', 'addrBlock', 'addrArea'] as const).map((k) => (
              <Field key={k} label={t(`customers.${k}`)}>
                <Input value={v[k]} onChange={(e) => set({ [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Field label={t('customers.mapUrl')} className="mt-2">
            <Input value={v.mapUrl} onChange={(e) => set({ mapUrl: e.target.value })} placeholder="https://maps.google.com/…" />
          </Field>
        </fieldset>
        {canCredit && (
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">{t('customers.credit')}</legend>
            <div className="flex flex-wrap items-end gap-4">
              <Switch checked={v.creditEnabled} onChange={(x) => set({ creditEnabled: x })} label={t('customers.creditEnabled')} />
              {v.creditEnabled && (
                <Field label={t('customers.creditLimit')} hint={t('customers.creditLimitHint')}>
                  <MoneyInput value={v.creditLimit} onChange={(x) => set({ creditLimit: x })} />
                </Field>
              )}
            </div>
          </fieldset>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
