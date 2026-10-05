import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Trash2 } from 'lucide-react';
import { DEFAULT_WORKING_HOURS, type WorkingHours } from '@laundry/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Card, ErrorBox, Field, Input, Loading, Textarea } from '../../components/ui';
import { WorkingHoursEditor } from '../../components/WorkingHoursEditor';
import { useToast } from '../../components/toast';

export default function ShopSettings() {
  const { t } = useTranslation();
  const { can, readOnly, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/api/settings') });
  const [v, setV] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data?.shop) {
      const wh = q.data.shop.workingHours as WorkingHours;
      setV({ ...q.data.shop, workingHours: wh && 'sun' in wh ? wh : DEFAULT_WORKING_HOURS });
    }
  }, [q.data]);
  const canEdit = can('settings', 'edit') && !readOnly;
  const save = useMutation({
    mutationFn: () =>
      api.put('/api/settings/shop', {
        name: v.name,
        crNumber: v.crNumber ?? null,
        vatNumber: v.vatNumber ?? null,
        address: v.address ?? null,
        phone: v.phone ?? null,
        email: v.email || null,
        workingHours: v.workingHours,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void refresh();
    },
  });
  const logo = useMutation({
    mutationFn: (f: File | null) => (f ? api.upload('/api/settings/logo', f) : api.del('/api/settings/logo')),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void refresh();
    },
    onError: (e) => toast.error(e),
  });
  if (!v) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title={t('settings.logo')}>
        <div className="flex items-center gap-4">
          <div className="grid size-24 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
            {v.logoFileId ? <img src={`/api/files/${v.logoFileId}`} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-8 text-slate-300" />}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) logo.mutate(f); e.target.value = ''; }} />
              <Button variant="secondary" loading={logo.isPending} onClick={() => fileRef.current?.click()}>
                {t('settings.uploadLogo')}
              </Button>
              {v.logoFileId && (
                <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => logo.mutate(null)}>
                  {t('common.remove')}
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>
      <Card title={t('settings.shop')}>
        <fieldset disabled={!canEdit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings.shopName')}>
              <Input value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </Field>
            <Field label={t('signup.shopCode')}>
              <Input value={v.slug} disabled />
            </Field>
            <Field label={t('settings.crNumber')}>
              <Input value={v.crNumber ?? ''} onChange={(e) => setV({ ...v, crNumber: e.target.value })} />
            </Field>
            <Field label={t('settings.vatNumber')}>
              <Input value={v.vatNumber ?? ''} onChange={(e) => setV({ ...v, vatNumber: e.target.value })} />
            </Field>
            <Field label={t('settings.phone')}>
              <Input value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.target.value })} />
            </Field>
            <Field label={t('settings.email')}>
              <Input type="email" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.target.value })} />
            </Field>
          </div>
          <Field label={t('settings.address')}>
            <Textarea value={v.address ?? ''} onChange={(e) => setV({ ...v, address: e.target.value })} />
          </Field>
          <div>
            <div className="label">{t('settings.workingHours')}</div>
            <WorkingHoursEditor value={v.workingHours} onChange={(wh) => setV({ ...v, workingHours: wh })} />
          </div>
          <ErrorBox error={save.error} />
          {canEdit && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          )}
        </fieldset>
      </Card>
    </div>
  );
}
