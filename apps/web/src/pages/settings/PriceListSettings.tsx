import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Plus, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ITEM_IMAGE_KEYS, SERVICE_ICON_KEYS } from '../../lib/illustrations';
import { Button, Card, Field, Input, Loading, Modal, Select, Switch, Tabs } from '../../components/ui';
import { ItemImage, ServiceIcon } from '../../components/images';
import { useToast } from '../../components/toast';

/** Price list: item types (with pictures) × service types, normal and express prices. */
export default function PriceListSettings() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'items' | 'services'>('items');
  const [picker, setPicker] = useState<any | null>(null);
  const [newItem, setNewItem] = useState(false);
  const [newService, setNewService] = useState(false);
  const q = useQuery({ queryKey: ['catalog-admin'], queryFn: () => api.get('/api/catalog') });
  const canEdit = can('catalog', 'edit') && !readOnly;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['catalog-admin'] });
    void qc.invalidateQueries({ queryKey: ['catalog-pos'] });
  };
  const patchItem = useMutation({ mutationFn: ({ id, ...b }: any) => api.patch(`/api/catalog/items/${id}`, b), onSuccess: invalidate, onError: (e) => toast.error(e) });
  const patchService = useMutation({ mutationFn: ({ id, ...b }: any) => api.patch(`/api/catalog/services/${id}`, b), onSuccess: invalidate, onError: (e) => toast.error(e) });
  const setPrice = useMutation({ mutationFn: (b: any) => api.put('/api/catalog/prices', b), onSuccess: invalidate, onError: (e) => toast.error(e) });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put('/api/catalog/items/order', { ids }), onSuccess: invalidate, onError: (e) => toast.error(e) });

  if (q.isLoading || !q.data) return <Loading />;
  const items: any[] = q.data.items;
  const services: any[] = q.data.services;
  const priceOf = (itemId: string, serviceId: string) => q.data.prices.find((p: any) => p.itemTypeId === itemId && p.serviceTypeId === serviceId);

  const move = (idx: number, dir: -1 | 1) => {
    const ids = items.map((i) => i.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'items', label: t('settings.items') }, { value: 'services', label: t('settings.services') }]} />
        {canEdit && (
          <Button icon={<Plus className="size-4" />} onClick={() => (tab === 'items' ? setNewItem(true) : setNewService(true))}>
            {tab === 'items' ? t('settings.newItem') : t('settings.newService')}
          </Button>
        )}
      </div>
      {tab === 'items' ? (
        <Card bodyClassName="p-0">
          <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{t('settings.priceMatrixHint')}</p>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>{t('settings.itemName')}</th>
                  {services.map((s) => (
                    <th key={s.id} className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <ServiceIcon iconKey={s.iconKey} alt="" className="size-6" />
                        <span className={clsx(!s.isActive && 'line-through opacity-50')}>{s.name}</span>
                      </div>
                    </th>
                  ))}
                  <th>{t('common.active')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.id} className={clsx(!it.isActive && 'opacity-50')}>
                    <td className="w-16 min-w-16">
                      <button disabled={!canEdit} onClick={() => setPicker(it)} title={t('settings.chooseImage')}>
                        <ItemImage imageKey={it.imageKey} imageFileId={it.imageFileId} alt={it.name} className="size-12 max-w-none" />
                      </button>
                    </td>
                    <td className="min-w-48">
                      <InlineText value={it.name} disabled={!canEdit} onSave={(name) => patchItem.mutate({ id: it.id, name })} />
                      <div className="mt-1 flex gap-1">
                        <InlineText className="h-7 text-xs" placeholder={t('settings.category')} value={it.category ?? ''} disabled={!canEdit} onSave={(category) => patchItem.mutate({ id: it.id, category: category || null })} />
                        <select
                          className="h-7 rounded border border-slate-300 bg-white px-1 text-xs"
                          disabled={!canEdit}
                          value={it.unit}
                          onChange={(e) => patchItem.mutate({ id: it.id, unit: e.target.value })}
                          aria-label={t('settings.unit')}
                        >
                          <option value="PIECE">{t('settings.units.PIECE')}</option>
                          <option value="SQM">{t('settings.units.SQM')}</option>
                        </select>
                      </div>
                    </td>
                    {services.map((s) => {
                      const p = priceOf(it.id, s.id);
                      return (
                        <td key={s.id} className="min-w-28">
                          <PriceCell
                            price={p ? Number(p.price) : null}
                            express={p?.expressPrice !== null && p?.expressPrice !== undefined ? Number(p.expressPrice) : null}
                            disabled={!canEdit}
                            onSave={(price, expressPrice) => setPrice.mutate({ itemTypeId: it.id, serviceTypeId: s.id, price, expressPrice })}
                          />
                        </td>
                      );
                    })}
                    <td>
                      <Switch checked={it.isActive} disabled={!canEdit} onChange={(v) => patchItem.mutate({ id: it.id, isActive: v })} />
                    </td>
                    <td className="whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button className="p-1 text-slate-400 hover:text-slate-800" onClick={() => move(idx, -1)} aria-label={t('settings.moveUp')}>
                            <ArrowUp className="size-4" />
                          </button>
                          <button className="p-1 text-slate-400 hover:text-slate-800" onClick={() => move(idx, 1)} aria-label={t('settings.moveDown')}>
                            <ArrowDown className="size-4" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card bodyClassName="p-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('settings.icon')}</th>
                <th>{t('settings.serviceName')}</th>
                <th>{t('settings.processing')}</th>
                <th>{t('settings.ironing')}</th>
                <th>{t('settings.turnaround')}</th>
                <th>{t('settings.expressTurnaround')}</th>
                <th>{t('common.active')}</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <select className="rounded border border-slate-300 px-1 py-1 text-xs" disabled={!canEdit} value={s.iconKey ?? ''} onChange={(e) => patchService.mutate({ id: s.id, iconKey: e.target.value })}>
                      {SERVICE_ICON_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {t(`serviceIcons.${k}`)}
                        </option>
                      ))}
                    </select>
                    <ServiceIcon iconKey={s.iconKey} alt="" className="mt-1 size-8" />
                  </td>
                  <td className="min-w-40">
                    <InlineText value={s.name} disabled={!canEdit} onSave={(name) => patchService.mutate({ id: s.id, name })} />
                  </td>
                  <td>
                    <Switch checked={s.requiresProcessing} disabled={!canEdit} onChange={(v) => patchService.mutate({ id: s.id, requiresProcessing: v })} />
                  </td>
                  <td>
                    <Switch checked={s.requiresIroning} disabled={!canEdit} onChange={(v) => patchService.mutate({ id: s.id, requiresIroning: v })} />
                  </td>
                  <td className="w-28">
                    <InlineText value={String(s.turnaroundHours)} disabled={!canEdit} onSave={(v) => patchService.mutate({ id: s.id, turnaroundHours: Number(v) || 0 })} />
                  </td>
                  <td className="w-28">
                    <InlineText value={String(s.expressTurnaroundHours)} disabled={!canEdit} onSave={(v) => patchService.mutate({ id: s.id, expressTurnaroundHours: Number(v) || 0 })} />
                  </td>
                  <td>
                    <Switch checked={s.isActive} disabled={!canEdit} onChange={(v) => patchService.mutate({ id: s.id, isActive: v })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ImagePicker item={picker} onClose={() => setPicker(null)} onPick={(imageKey) => { patchItem.mutate({ id: picker.id, imageKey, imageFileId: null }); setPicker(null); }} onUploaded={() => { invalidate(); setPicker(null); }} />
      <NewItemModal open={newItem} onClose={() => setNewItem(false)} onDone={invalidate} />
      <NewServiceModal open={newService} onClose={() => setNewService(false)} onDone={invalidate} />
    </div>
  );
}

function InlineText({ value, onSave, disabled, className, placeholder }: { value: string; onSave: (v: string) => void; disabled?: boolean; className?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Input
      className={clsx('h-9', className)}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function PriceCell({ price, express, onSave, disabled }: { price: number | null; express: number | null; onSave: (price: number | null, expressPrice: number | null) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const [p, setP] = useState(price === null ? '' : price.toFixed(3));
  const [x, setX] = useState(express === null ? '' : express.toFixed(3));
  useEffect(() => setP(price === null ? '' : price.toFixed(3)), [price]);
  useEffect(() => setX(express === null ? '' : express.toFixed(3)), [express]);
  const commit = () => {
    const np = p.trim() === '' ? null : Number(p);
    const nx = x.trim() === '' ? null : Number(x);
    if (np === price && nx === express) return;
    if (np === null && price === null) return;
    onSave(np, np === null ? null : nx);
  };
  return (
    <div className="space-y-1">
      <input className="h-8 w-24 rounded-md border border-slate-300 px-2 text-right text-sm tabular-nums disabled:bg-slate-50" inputMode="decimal" placeholder="—" disabled={disabled} value={p} onChange={(e) => setP(e.target.value.replace(/[^\d.]/g, ''))} onBlur={commit} aria-label={t('settings.price')} />
      <input className="h-7 w-24 rounded-md border border-dashed border-violet-300 px-2 text-right text-xs tabular-nums text-violet-700 placeholder:text-violet-300 disabled:bg-slate-50" inputMode="decimal" placeholder={t('settings.expressPrice')} disabled={disabled || p === ''} value={x} onChange={(e) => setX(e.target.value.replace(/[^\d.]/g, ''))} onBlur={commit} aria-label={t('settings.expressPrice')} />
    </div>
  );
}

function ImagePicker({ item, onClose, onPick, onUploaded }: { item: any | null; onClose: () => void; onPick: (key: string) => void; onUploaded: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File) => {
    setBusy(true);
    try {
      await api.upload(`/api/catalog/items/${item.id}/image`, f);
      onUploaded();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!item} onClose={onClose} size="xl" title={t('settings.chooseImage')}>
      <div className="mb-4">
        <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <Button variant="secondary" icon={<Upload className="size-4" />} loading={busy} onClick={() => ref.current?.click()}>
          {t('settings.uploadPhoto')}
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {ITEM_IMAGE_KEYS.map((k) => (
          <button key={k} onClick={() => onPick(k)} className={clsx('flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs', item?.imageKey === k && !item?.imageFileId ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
            <ItemImage imageKey={k} alt={t(`illustrations.${k}`)} className="size-14" />
            {t(`illustrations.${k}`)}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function NewItemModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState({ name: '', category: '', unit: 'PIECE', imageKey: 'other' });
  const m = useMutation({
    mutationFn: () => api.post('/api/catalog/items', { ...v, category: v.category || null }),
    onSuccess: () => {
      onDone();
      onClose();
      setV({ name: '', category: '', unit: 'PIECE', imageKey: 'other' });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={t('settings.newItem')} footer={<Button loading={m.isPending} disabled={!v.name.trim()} onClick={() => m.mutate()}>{t('common.create')}</Button>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('settings.itemName')}>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
          </Field>
          <Field label={t('settings.category')}>
            <Input value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
          </Field>
          <Field label={t('settings.unit')}>
            <Select value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })}>
              <option value="PIECE">{t('settings.units.PIECE')}</option>
              <option value="SQM">{t('settings.units.SQM')}</option>
            </Select>
          </Field>
        </div>
        <div className="label">{t('settings.image')}</div>
        <div className="grid max-h-64 grid-cols-5 gap-2 overflow-y-auto sm:grid-cols-7">
          {ITEM_IMAGE_KEYS.map((k) => (
            <button key={k} onClick={() => setV({ ...v, imageKey: k })} className={clsx('rounded-xl border-2 p-1', v.imageKey === k ? 'border-brand-500 bg-brand-50' : 'border-transparent hover:bg-slate-50')} title={t(`illustrations.${k}`)}>
              <ItemImage imageKey={k} alt={t(`illustrations.${k}`)} className="mx-auto size-12" />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NewServiceModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState({ name: '', iconKey: 'wash_iron', requiresProcessing: true, requiresIroning: true, turnaroundHours: '48', expressTurnaroundHours: '24' });
  const m = useMutation({
    mutationFn: () => api.post('/api/catalog/services', { ...v, turnaroundHours: Number(v.turnaroundHours) || 0, expressTurnaroundHours: Number(v.expressTurnaroundHours) || 0 }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('settings.newService')} footer={<Button loading={m.isPending} disabled={!v.name.trim()} onClick={() => m.mutate()}>{t('common.create')}</Button>}>
      <div className="space-y-3">
        <Field label={t('settings.serviceName')}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        </Field>
        <div className="flex flex-wrap gap-2">
          {SERVICE_ICON_KEYS.map((k) => (
            <button key={k} onClick={() => setV({ ...v, iconKey: k })} className={clsx('rounded-xl border-2 p-1', v.iconKey === k ? 'border-brand-500 bg-brand-50' : 'border-slate-200')} title={t(`serviceIcons.${k}`)}>
              <ServiceIcon iconKey={k} alt="" className="size-10" />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-4">
          <Switch checked={v.requiresProcessing} onChange={(x) => setV({ ...v, requiresProcessing: x })} label={t('settings.processing')} />
          <Switch checked={v.requiresIroning} onChange={(x) => setV({ ...v, requiresIroning: x })} label={t('settings.ironing')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.turnaround')}>
            <Input inputMode="numeric" value={v.turnaroundHours} onChange={(e) => setV({ ...v, turnaroundHours: e.target.value })} />
          </Field>
          <Field label={t('settings.expressTurnaround')}>
            <Input inputMode="numeric" value={v.expressTurnaroundHours} onChange={(e) => setV({ ...v, expressTurnaroundHours: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
