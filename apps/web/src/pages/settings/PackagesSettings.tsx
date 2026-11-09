import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { packageLines, useCatalog } from '../../lib/catalog';
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
                    BHD {money(p.price)} →{' '}
                    {p.kind === 'CREDIT'
                      ? `BHD ${money(p.creditValue)}`
                      : packageLines(p)
                          .map((l) => `${l.count} × ${itemName(l.itemTypeId)} · ${serviceName(l.serviceTypeId)}`)
                          .join(' + ')}
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

type Line = { itemTypeId: string; serviceTypeId: string; count: string };

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
            lines: (pkg.kind === 'ITEMS' ? packageLines(pkg) : [{ itemTypeId: null, serviceTypeId: null, count: 0 }]).map((l) => ({
              itemTypeId: l.itemTypeId ?? '',
              serviceTypeId: l.serviceTypeId ?? '',
              count: l.count ? String(l.count) : '',
            })),
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
        lines:
          v.kind === 'ITEMS'
            ? v.lines.map((l: Line) => ({ itemTypeId: l.itemTypeId || null, serviceTypeId: l.serviceTypeId || null, count: Number(l.count) }))
            : null,
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
          ) : null}
          <Field label={`${t('settings.validityDays')} (${t('common.optional')})`}>
            <Input inputMode="numeric" value={v.validityDays} onChange={(e) => setV({ ...v, validityDays: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <div className="flex items-end pb-2">
            <Switch checked={v.isActive} onChange={(x) => setV({ ...v, isActive: x })} label={t('common.active')} />
          </div>
        </div>
        {v.kind === 'ITEMS' && (
          <div>
            <span className="label">{t('settings.packageGarments')}</span>
            <div className="space-y-2">
              {v.lines.map((l: Line, i: number) => {
                const set = (patch: Partial<Line>) => setV({ ...v, lines: v.lines.map((x: Line, j: number) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="w-20"
                      inputMode="numeric"
                      aria-label={t('settings.itemCount')}
                      placeholder={t('settings.itemCount')}
                      value={l.count}
                      onChange={(e) => set({ count: e.target.value.replace(/\D/g, '') })}
                    />
                    <Select aria-label={t('settings.items')} value={l.itemTypeId} onChange={(e) => set({ itemTypeId: e.target.value })}>
                      <option value="">{t('settings.anyItem')}</option>
                      {catalog.data?.items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name}
                        </option>
                      ))}
                    </Select>
                    <Select aria-label={t('settings.services')} value={l.serviceTypeId} onChange={(e) => set({ serviceTypeId: e.target.value })}>
                      <option value="">{t('settings.anyService')}</option>
                      {catalog.data?.services.map((sv) => (
                        <option key={sv.id} value={sv.id}>
                          {sv.name}
                        </option>
                      ))}
                    </Select>
                    {v.lines.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('settings.removeGarment')}
                        icon={<X className="size-4" />}
                        onClick={() => setV({ ...v, lines: v.lines.filter((_: Line, j: number) => j !== i) })}
                      />
                    )}
                  </div>
                );
              })}
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="size-4" />}
                onClick={() => setV({ ...v, lines: [...v.lines, { itemTypeId: '', serviceTypeId: '', count: '' }] })}
              >
                {t('settings.addGarment')}
              </Button>
            </div>
            <span className="mt-1 block text-xs text-slate-500">{t('settings.packageGarmentsHint')}</span>
          </div>
        )}
        <Field label={t('common.notes')}>
          <Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
