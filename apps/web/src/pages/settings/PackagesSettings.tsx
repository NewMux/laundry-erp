import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { useCatalog } from '../../lib/catalog';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, MoneyInput, Select, Switch, Textarea } from '../../components/ui';

export default function PackagesSettings() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const [editing, setEditing] = useState<any | null>(null);
  const q = useQuery({ queryKey: ['packages'], queryFn: () => api.get('/api/catalog/packages') });
  const catalog = useCatalog();
  const canEdit = can('catalog', 'edit') && !readOnly;
  const itemName = (id: string | null) => catalog.data?.items.find((i) => i.id === id)?.name ?? t('settings.anyItem');
  const serviceName = (id: string | null) => catalog.data?.services.find((s) => s.id === id)?.name ?? t('settings.anyService');
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canEdit && (
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ kind: 'CREDIT' })}>
            {t('settings.newPackage')}
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.packages?.length ? (
        <div className="card">
          <Empty title={t('wallet.noPackages')} />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.packages.map((p: any) => (
            <Card key={p.id} className={p.isActive ? '' : 'opacity-60'}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="mt-0.5 text-sm text-slate-600">
                    BHD {money(p.price)} → {p.kind === 'CREDIT' ? `BHD ${money(p.creditValue)}` : `${p.itemCount} × ${itemName(p.itemTypeId)} · ${serviceName(p.serviceTypeId)}`}
                  </div>
                  {p.validityDays && <div className="text-xs text-slate-500">{t('common.daysShort', { count: p.validityDays })}</div>}
                </div>
                <Badge color={p.kind === 'CREDIT' ? 'green' : 'brand'}>{p.kind === 'CREDIT' ? t('wallet.types.PACKAGE') : t('common.items')}</Badge>
              </div>
              {canEdit && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditing(p)}>
                  {t('common.edit')}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
      <PackageModal pkg={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function PackageModal({ pkg, onClose }: { pkg: any | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const catalog = useCatalog();
  const [v, setV] = useState<any>(null);
  const [init, setInit] = useState<any>(undefined);
  if (pkg !== init) {
    setInit(pkg);
    setV(
      pkg
        ? {
            name: pkg.name ?? '',
            kind: pkg.kind ?? 'CREDIT',
            price: pkg.price !== undefined ? String(pkg.price) : '',
            creditValue: pkg.creditValue !== undefined && pkg.creditValue !== null ? String(pkg.creditValue) : '',
            itemCount: pkg.itemCount ? String(pkg.itemCount) : '',
            itemTypeId: pkg.itemTypeId ?? '',
            serviceTypeId: pkg.serviceTypeId ?? '',
            validityDays: pkg.validityDays ? String(pkg.validityDays) : '',
            description: pkg.description ?? '',
            isActive: pkg.isActive ?? true,
            sortOrder: pkg.sortOrder ?? 0,
          }
        : null,
    );
  }
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: v.name,
        kind: v.kind,
        price: Number(v.price),
        creditValue: v.kind === 'CREDIT' ? Number(v.creditValue) : null,
        itemCount: v.kind === 'ITEMS' ? Number(v.itemCount) : null,
        itemTypeId: v.kind === 'ITEMS' ? v.itemTypeId || null : null,
        serviceTypeId: v.kind === 'ITEMS' ? v.serviceTypeId || null : null,
        validityDays: v.validityDays ? Number(v.validityDays) : null,
        description: v.description || null,
        isActive: v.isActive,
        sortOrder: v.sortOrder,
      };
      return pkg?.id ? api.patch(`/api/catalog/packages/${pkg.id}`, body) : api.post('/api/catalog/packages', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['packages'] });
      void qc.invalidateQueries({ queryKey: ['catalog-pos'] });
      onClose();
    },
  });
  if (!v) return null;
  return (
    <Modal open={!!pkg} onClose={onClose} title={pkg?.id ? t('common.edit') : t('settings.newPackage')} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="space-y-3">
        <Field label={t('common.name')}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label={t('common.type')}>
          <Select value={v.kind} disabled={!!pkg?.id} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            <option value="CREDIT">{t('settings.packageKinds.CREDIT')}</option>
            <option value="ITEMS">{t('settings.packageKinds.ITEMS')}</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.packagePrice')}>
            <MoneyInput value={v.price} onChange={(x) => setV({ ...v, price: x })} />
          </Field>
          {v.kind === 'CREDIT' ? (
            <Field label={t('settings.creditValue')}>
              <MoneyInput value={v.creditValue} onChange={(x) => setV({ ...v, creditValue: x })} />
            </Field>
          ) : (
            <Field label={t('settings.itemCount')}>
              <Input inputMode="numeric" value={v.itemCount} onChange={(e) => setV({ ...v, itemCount: e.target.value.replace(/\D/g, '') })} />
            </Field>
          )}
          {v.kind === 'ITEMS' && (
            <>
              <Field label={t('settings.items')}>
                <Select value={v.itemTypeId} onChange={(e) => setV({ ...v, itemTypeId: e.target.value })}>
                  <option value="">{t('settings.anyItem')}</option>
                  {catalog.data?.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('settings.services')}>
                <Select value={v.serviceTypeId} onChange={(e) => setV({ ...v, serviceTypeId: e.target.value })}>
                  <option value="">{t('settings.anyService')}</option>
                  {catalog.data?.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label={`${t('settings.validityDays')} (${t('common.optional')})`}>
            <Input inputMode="numeric" value={v.validityDays} onChange={(e) => setV({ ...v, validityDays: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <div className="flex items-end pb-2">
            <Switch checked={v.isActive} onChange={(x) => setV({ ...v, isActive: x })} label={t('common.active')} />
          </div>
        </div>
        <Field label={t('common.notes')}>
          <Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
