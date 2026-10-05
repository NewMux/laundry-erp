import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { Button, ErrorBox, Field, Input, Modal, MoneyInput, Switch, Textarea } from '../../components/ui';

const FIELDS = ['name', 'position', 'phone', 'nationality', 'cpr', 'passportNo'] as const;
const DATES = ['cprExpiry', 'passportExpiry', 'visaExpiry', 'joinDate'] as const;

export function EmployeeFormModal({ open, initial, onClose, onSubmit, loading, error, title }: { open: boolean; initial?: any; onClose: () => void; onSubmit: (v: any) => void; loading?: boolean; error?: unknown; title: string }) {
  const { t } = useTranslation();
  const { hasCap } = useAuth();
  const canSalary = hasCap('editSalary');
  const [v, setV] = useState<any>({});
  useEffect(() => {
    if (!open) return;
    setV({
      name: initial?.name ?? '',
      position: initial?.position ?? '',
      phone: initial?.phone ?? '',
      nationality: initial?.nationality ?? '',
      cpr: initial?.cpr ?? '',
      passportNo: initial?.passportNo ?? '',
      cprExpiry: initial?.cprExpiry ?? '',
      passportExpiry: initial?.passportExpiry ?? '',
      visaExpiry: initial?.visaExpiry ?? '',
      joinDate: initial?.joinDate ?? '',
      basicSalary: initial?.basicSalary !== undefined ? String(initial.basicSalary) : '',
      allowances: (initial?.allowances ?? []).map((a: any) => ({ name: a.name, amount: String(a.amount) })),
      annualLeaveDays: initial?.annualLeaveDays ?? '',
      isActive: initial?.isActive ?? true,
      notes: initial?.notes ?? '',
    });
  }, [open, initial]);

  const submit = () => {
    const body: any = {
      ...v,
      annualLeaveDays: v.annualLeaveDays === '' || v.annualLeaveDays === null ? null : Number(v.annualLeaveDays),
    };
    for (const d of DATES) body[d] = v[d] || null;
    if (canSalary) {
      body.basicSalary = Number(v.basicSalary) || 0;
      body.allowances = v.allowances.filter((a: any) => a.name.trim()).map((a: any) => ({ name: a.name.trim(), amount: Number(a.amount) || 0 }));
    } else {
      delete body.basicSalary;
      delete body.allowances;
    }
    onSubmit(body);
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={<Button loading={loading} disabled={!v.name?.trim()} onClick={submit}>{t('common.save')}</Button>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <Field key={f} label={t(`staff.${f}`)}>
              <Input className="bidi" value={v[f] ?? ''} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
            </Field>
          ))}
          {DATES.map((f) => (
            <Field key={f} label={t(`staff.${f}`)}>
              <Input type="date" value={v[f] ?? ''} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
            </Field>
          ))}
          <Field label={t('staff.annualLeaveDays')}>
            <Input inputMode="decimal" value={v.annualLeaveDays ?? ''} onChange={(e) => setV({ ...v, annualLeaveDays: e.target.value })} />
          </Field>
          <div className="flex items-end pb-2">
            <Switch checked={!!v.isActive} onChange={(x) => setV({ ...v, isActive: x })} label={t('common.active')} />
          </div>
        </div>
        {canSalary && (
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">{t('staff.basicSalary')}</legend>
            <MoneyInput value={v.basicSalary ?? ''} onChange={(x) => setV({ ...v, basicSalary: x })} />
            <div className="label mt-3">{t('staff.allowances')}</div>
            <div className="space-y-2">
              {(v.allowances ?? []).map((a: any, i: number) => (
                <div key={i} className="flex gap-2">
                  <Input placeholder={t('staff.allowanceName')} value={a.name} onChange={(e) => setV({ ...v, allowances: v.allowances.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <div className="w-40">
                    <MoneyInput value={a.amount} onChange={(x) => setV({ ...v, allowances: v.allowances.map((y: any, j: number) => (j === i ? { ...y, amount: x } : y)) })} />
                  </div>
                  <button className="p-2 text-slate-500" onClick={() => setV({ ...v, allowances: v.allowances.filter((_: any, j: number) => j !== i) })} aria-label={t('common.remove')}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setV({ ...v, allowances: [...(v.allowances ?? []), { name: '', amount: '' }] })}>
                {t('staff.addAllowance')}
              </Button>
            </div>
          </fieldset>
        )}
        <Field label={t('common.notes')}>
          <Textarea value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
