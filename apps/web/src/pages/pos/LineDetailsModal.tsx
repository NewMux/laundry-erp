import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2, Minus, Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { DAMAGE_TYPES } from '@laundry/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, parseMoney } from '../../lib/format';
import type { CatalogItem, CatalogService } from '../../lib/catalog';
import { Button, Field, Input, Modal, MoneyInput, Textarea } from '../../components/ui';
import { ItemImage, ServiceIcon } from '../../components/images';
import { useToast } from '../../components/toast';
import type { PosCustomer } from './CustomerBar';

export interface CartLine {
  key: string;
  itemTypeId: string;
  serviceTypeId: string;
  quantity: number;
  area: number | null;
  unitPrice: number | null;
  discountType: 'AMOUNT' | 'PERCENT' | null;
  discountValue: number | null;
  color: string | null;
  brand: string | null;
  notes: string | null;
  damage: string[];
  damageNotes: string | null;
  damagePhotoIds: string[];
  customerPackageId: string | null;
}

const COLORS: { key: string; hex: string }[] = [
  { key: 'white', hex: '#ffffff' },
  { key: 'black', hex: '#111827' },
  { key: 'blue', hex: '#2563eb' },
  { key: 'navy', hex: '#1e3a8a' },
  { key: 'grey', hex: '#9ca3af' },
  { key: 'beige', hex: '#e7d7b8' },
  { key: 'brown', hex: '#7c4a1e' },
  { key: 'red', hex: '#dc2626' },
  { key: 'green', hex: '#16a34a' },
  { key: 'pink', hex: '#f472b6' },
  { key: 'yellow', hex: '#facc15' },
  { key: 'multi', hex: 'conic-gradient(#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7,#ef4444)' },
];

export function LineDetailsModal({
  line,
  item,
  services,
  listPrice,
  customer,
  onChange,
  onRemove,
  onClose,
}: {
  line: CartLine | null;
  item: CatalogItem | undefined;
  services: CatalogService[];
  listPrice: (serviceId: string) => number | null;
  customer: PosCustomer | null;
  onChange: (l: CartLine) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { hasCap } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<CartLine | null>(line);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(line), [line]);
  if (!draft || !item) return null;
  const set = (patch: Partial<CartLine>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const t2 = (k: string) => t(`pos.colors.${k}`);

  const packages = (customer?.packages ?? []).filter(
    (p) =>
      p.kind === 'ITEMS' &&
      p.status === 'ACTIVE' &&
      (!p.itemTypeId || p.itemTypeId === draft.itemTypeId) &&
      (!p.serviceTypeId || p.serviceTypeId === draft.serviceTypeId) &&
      (!p.expiresAt || new Date(p.expiresAt) > new Date()),
  );

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const r = await api.upload('/api/files/upload/damage', f);
      set({ damagePhotoIds: [...draft.damagePhotoIds, r.id] });
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  const price = listPrice(draft.serviceTypeId);

  return (
    <Modal
      open={!!line}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <ItemImage imageKey={item.imageKey} imageFileId={item.imageFileId} alt={item.name} className="size-8" />
          {item.name}
        </span>
      }
      footer={
        <>
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={onRemove} className="mr-auto">
            {t('pos.removeLine')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="label">{t('pos.service')}</div>
          <div className="flex flex-wrap gap-2">
            {services.map((s) => {
              const p = listPrice(s.id);
              return (
                <button
                  key={s.id}
                  disabled={p === null}
                  onClick={() => set({ serviceTypeId: s.id, customerPackageId: null })}
                  className={clsx(
                    'flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-medium disabled:opacity-30',
                    draft.serviceTypeId === s.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200',
                  )}
                >
                  <ServiceIcon iconKey={s.iconKey} alt="" className="size-7" />
                  <span>{s.name}</span>
                  {p !== null && hasCap('viewPrices') && <span className="text-xs text-slate-500">{money(p)}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="label">{t('pos.quantity')}</div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="lg" onClick={() => set({ quantity: Math.max(1, draft.quantity - 1) })} aria-label="-">
                <Minus className="size-5" />
              </Button>
              <Input className="h-12 w-20 text-center text-lg font-semibold" inputMode="numeric" value={draft.quantity} onChange={(e) => set({ quantity: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
              <Button variant="secondary" size="lg" onClick={() => set({ quantity: draft.quantity + 1 })} aria-label="+">
                <Plus className="size-5" />
              </Button>
            </div>
          </div>
          {item.unit === 'SQM' && (
            <Field label={t('pos.area')}>
              <Input className="h-12 text-lg" inputMode="decimal" value={draft.area ?? ''} onChange={(e) => set({ area: Number(e.target.value.replace(/[^\d.]/g, '')) || null })} />
            </Field>
          )}
        </div>

        <div>
          <div className="label">{t('pos.color')}</div>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c.key}
                title={t2(c.key)}
                onClick={() => set({ color: draft.color === t2(c.key) ? null : t2(c.key) })}
                className={clsx('flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs', draft.color === t2(c.key) ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200')}
              >
                <span className="size-4 rounded-full border border-slate-300" style={{ background: c.hex }} />
                {t2(c.key)}
              </button>
            ))}
          </div>
          <Input className="mt-2" placeholder={t('pos.color')} value={draft.color ?? ''} onChange={(e) => set({ color: e.target.value || null })} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('pos.brand')}>
            <Input value={draft.brand ?? ''} onChange={(e) => set({ brand: e.target.value || null })} />
          </Field>
          <Field label={t('pos.itemNotes')}>
            <Input className="bidi" value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value || null })} />
          </Field>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <div className="label text-amber-800">{t('pos.damage')}</div>
          <div className="flex flex-wrap gap-2">
            {DAMAGE_TYPES.map((d) => (
              <button
                key={d}
                onClick={() => set({ damage: draft.damage.includes(d) ? draft.damage.filter((x) => x !== d) : [...draft.damage, d] })}
                className={clsx('rounded-full border px-3 py-1 text-sm', draft.damage.includes(d) ? 'border-amber-500 bg-amber-500 text-white' : 'border-amber-300 bg-white text-amber-900')}
              >
                {t(`damage.${d}`)}
              </button>
            ))}
          </div>
          <Textarea className="mt-2 bg-white" placeholder={t('pos.damageNotes')} value={draft.damageNotes ?? ''} onChange={(e) => set({ damageNotes: e.target.value || null })} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {draft.damagePhotoIds.map((id) => (
              <div key={id} className="relative">
                <img src={`/api/files/${id}`} alt="" className="size-16 rounded-lg object-cover" />
                <button className="absolute -right-1 -top-1 rounded-full bg-slate-800 p-0.5 text-white" onClick={() => set({ damagePhotoIds: draft.damagePhotoIds.filter((x) => x !== id) })} aria-label={t('common.remove')}>
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" size="sm" icon={uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} onClick={() => fileRef.current?.click()}>
              {t('pos.takePhoto')}
            </Button>
          </div>
        </div>

        {packages.length > 0 && (
          <div>
            <div className="label">{t('pos.usePackage')}</div>
            <div className="flex flex-wrap gap-2">
              {packages.map((p) => (
                <button
                  key={p.id}
                  onClick={() => set({ customerPackageId: draft.customerPackageId === p.id ? null : p.id })}
                  className={clsx('rounded-xl border-2 px-3 py-2 text-sm', draft.customerPackageId === p.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200')}
                >
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-slate-500">{t('pos.packageItems', { left: p.remainingItems })}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {hasCap('viewPrices') && !draft.customerPackageId && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="label">{t('pos.lineDiscount')}</div>
              <div className="flex gap-2">
                <select className="input w-24" value={draft.discountType ?? 'PERCENT'} onChange={(e) => set({ discountType: e.target.value as 'AMOUNT' | 'PERCENT' })}>
                  <option value="PERCENT">%</option>
                  <option value="AMOUNT">{t('common.bhd')}</option>
                </select>
                <Input
                  inputMode="decimal"
                  value={draft.discountValue ?? ''}
                  onChange={(e) => {
                    const v = parseMoney(e.target.value);
                    set({ discountValue: v || null, discountType: draft.discountType ?? 'PERCENT' });
                  }}
                />
              </div>
            </div>
            {hasCap('overridePrice') && (
              <Field label={`${t('pos.changePrice')} (${money(price)})`}>
                <MoneyInput value={draft.unitPrice ?? ''} onChange={(v) => set({ unitPrice: v === '' ? null : parseMoney(v) })} placeholder={money(price)} />
              </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
