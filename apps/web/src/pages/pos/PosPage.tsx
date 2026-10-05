import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, Minus, PackageOpen, Pause, Pencil, Plus, Printer, ShoppingBasket, Trash2, Zap } from 'lucide-react';
import { calcOrder, expectedReadyAt, parseScan, type WorkingHours, DEFAULT_WORKING_HOURS } from '@laundry/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { priceIndex, useCatalog, type CatalogItem } from '../../lib/catalog';
import { dateTime, money, parseMoney } from '../../lib/format';
import { feedback, useBarcodeScanner } from '../../lib/hooks';
import { printOrder } from '../../lib/print';
import { Badge, Button, ConfirmModal, Input, Loading, Modal, Switch } from '../../components/ui';
import { ItemImage, ServiceIcon } from '../../components/images';
import { PaymentModal, type PaymentResult } from '../../components/PaymentModal';
import { useToast } from '../../components/toast';
import { CustomerBar, loadPosCustomer, type PosCustomer } from './CustomerBar';
import { LineDetailsModal, type CartLine } from './LineDetailsModal';
import { SuccessPanel } from './SuccessPanel';

let keySeq = 0;
const newKey = () => `l${++keySeq}`;

function readAutoPrint() {
  try {
    return localStorage.getItem('lms.autoPrint') !== '0';
  } catch {
    return true;
  }
}

export default function PosPage() {
  const { t } = useTranslation();
  const { me, settings, hasCap, can, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const catalog = useCatalog();
  const prices = useMemo(() => priceIndex(catalog.data), [catalog.data]);

  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [express, setExpress] = useState(false);
  const [notes, setNotes] = useState('');
  const [discountType, setDiscountType] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [discountValue, setDiscountValue] = useState('');
  const [expectedOverride, setExpectedOverride] = useState<string>('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [editing, setEditing] = useState<{ id: string; orderNo: number } | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [choose, setChoose] = useState<CatalogItem | null>(null);
  const [areaFor, setAreaFor] = useState<{ item: CatalogItem; serviceId: string } | null>(null);
  const [areaValue, setAreaValue] = useState('');
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState<{ id: string; orderNo: number; customerId: string | null } | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [mobileCart, setMobileCart] = useState(false);
  const [autoPrint, setAutoPrint] = useState(readAutoPrint);

  const services = catalog.data?.services ?? [];
  const items = catalog.data?.items ?? [];
  useEffect(() => {
    if (!serviceId && services.length) setServiceId(services[0].id);
  }, [services, serviceId]);

  const reset = () => {
    setCustomer(null);
    setWalkIn(false);
    setLines([]);
    setExpress(false);
    setNotes('');
    setDiscountValue('');
    setExpectedOverride('');
    setEditing(null);
    setDraftId(null);
    setMobileCart(false);
    if (services.length) setServiceId(services[0].id);
  };

  // Load an order for editing (?edit=id) or a parked order (?draft=id).
  const editId = params.get('edit') ?? params.get('draft');
  useEffect(() => {
    if (!editId || !catalog.data) return;
    let cancelled = false;
    (async () => {
      try {
        const { order } = await api.get(`/api/orders/${editId}`);
        if (cancelled) return;
        setLines(
          order.items.map((it: any) => ({
            key: newKey(),
            itemTypeId: it.itemTypeId,
            serviceTypeId: it.serviceTypeId,
            quantity: it.quantity,
            area: it.area,
            unitPrice: it.priceOverridden ? it.unitPrice : null,
            discountType: it.discountType,
            discountValue: it.discountValue || null,
            color: it.color,
            brand: it.brand,
            notes: it.notes,
            damage: it.damage,
            damageNotes: it.damageNotes,
            damagePhotoIds: it.damagePhotoIds,
            customerPackageId: it.customerPackageId,
          })),
        );
        setExpress(order.express);
        setNotes(order.notes ?? '');
        if (order.orderDiscountType) {
          setDiscountType(order.orderDiscountType);
          setDiscountValue(String(order.orderDiscountValue || ''));
        }
        if (order.customer) setCustomer(await loadPosCustomer(order.customer.id));
        else setWalkIn(true);
        if (order.status === 'DRAFT') setDraftId(order.id);
        else setEditing({ id: order.id, orderNo: order.orderNo });
        if (order.status === 'DRAFT') toast.info(t('pos.draftLoaded'));
      } catch (e) {
        toast.error(e);
      } finally {
        setParams({}, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, catalog.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useBarcodeScanner(async (code) => {
    const p = parseScan(code);
    if (!p) return;
    if (lines.length) {
      feedback(false);
      toast.info(t('pos.finishFirst'));
      return;
    }
    try {
      const r = await api.get(`/api/orders/no/${p.orderNo}`);
      feedback(true);
      navigate(`/orders/${r.order.id}`);
    } catch (e) {
      feedback(false);
      toast.error(e);
    }
  });

  // ───── Cart operations ─────
  const unitPrice = (l: CartLine) => l.unitPrice ?? prices.unitPrice(l.itemTypeId, l.serviceTypeId, express) ?? 0;

  const addItem = (item: CatalogItem, svcId: string, area?: number) => {
    if (prices.unitPrice(item.id, svcId, false) === null) return;
    if (item.unit === 'SQM' && !area) {
      setAreaFor({ item, serviceId: svcId });
      setAreaValue('');
      return;
    }
    setLines((ls) => {
      const plain = ls.find(
        (l) => l.itemTypeId === item.id && l.serviceTypeId === svcId && item.unit === 'PIECE' && !l.damage.length && !l.notes && !l.color && !l.brand && !l.damagePhotoIds.length && !l.unitPrice && !l.discountValue,
      );
      if (plain) return ls.map((l) => (l === plain ? { ...l, quantity: l.quantity + 1 } : l));
      // Suggest a matching item package automatically.
      const pkg = customer?.packages.find(
        (p) => p.kind === 'ITEMS' && p.status === 'ACTIVE' && p.remainingItems > 0 && (!p.itemTypeId || p.itemTypeId === item.id) && (!p.serviceTypeId || p.serviceTypeId === svcId),
      );
      return [
        ...ls,
        {
          key: newKey(),
          itemTypeId: item.id,
          serviceTypeId: svcId,
          quantity: 1,
          area: area ?? null,
          unitPrice: null,
          discountType: null,
          discountValue: null,
          color: null,
          brand: null,
          notes: null,
          damage: [],
          damageNotes: null,
          damagePhotoIds: [],
          customerPackageId: pkg ? pkg.id : null,
        },
      ];
    });
  };

  const tapItem = (item: CatalogItem) => {
    if (readOnly) return;
    const svc = serviceId && prices.unitPrice(item.id, serviceId, false) !== null ? serviceId : null;
    if (svc) return addItem(item, svc);
    const options = prices.servicesFor(item.id);
    if (options.length === 1) {
      toast.info(t('pos.addedAs', { service: options[0].name }));
      return addItem(item, options[0].id);
    }
    setChoose(item);
  };

  const setQty = (key: string, q: number) => setLines((ls) => (q <= 0 ? ls.filter((l) => l.key !== key) : ls.map((l) => (l.key === key ? { ...l, quantity: q } : l))));

  // ───── Totals (same maths as the server) ─────
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const totals = useMemo(
    () =>
      calcOrder({
        lines: lines.map((l) => ({
          unitPrice: unitPrice(l),
          unit: itemMap.get(l.itemTypeId)?.unit ?? 'PIECE',
          quantity: l.quantity,
          area: l.area,
          discountType: l.discountType,
          discountValue: l.discountValue,
          coveredByPackage: !!l.customerPackageId,
        })),
        express,
        expressSurchargeType: settings?.expressSurchargeType ?? 'PERCENT',
        expressSurchargeValue: settings?.expressSurchargeValue ?? 0,
        orderDiscountType: discountValue ? discountType : null,
        orderDiscountValue: parseMoney(discountValue) || null,
        vatRate: settings?.vatRate ?? 0,
        pricesIncludeVat: settings?.pricesIncludeVat ?? false,
      }),
    [lines, express, settings, discountType, discountValue, itemMap], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pieces = lines.reduce((n, l) => n + l.quantity, 0);
  const maxDiscount = me?.permissions?.maxDiscountPercent ?? 0;
  const discountTooHigh = totals.discountTotal > 0 && totals.discountPercent > maxDiscount + 0.001;

  const expectedAuto = useMemo(() => {
    if (!lines.length) return null;
    const hours = Math.max(...lines.map((l) => {
      const s = serviceMap.get(l.serviceTypeId);
      return s ? (express ? s.expressTurnaroundHours : s.turnaroundHours) : 0;
    }));
    const wh = (me?.tenant?.workingHours as WorkingHours) ?? DEFAULT_WORKING_HOURS;
    return expectedReadyAt(new Date(), hours, wh && 'sun' in wh ? wh : DEFAULT_WORKING_HOURS);
  }, [lines, express, serviceMap, me]);

  const orderBody = () => ({
    customerId: customer?.id ?? null,
    express,
    notes: notes || null,
    orderDiscountType: discountValue ? discountType : null,
    orderDiscountValue: parseMoney(discountValue) || null,
    expectedAt: expectedOverride ? new Date(expectedOverride).toISOString() : null,
    items: lines.map((l) => ({
      itemTypeId: l.itemTypeId,
      serviceTypeId: l.serviceTypeId,
      quantity: l.quantity,
      area: l.area,
      unitPrice: l.unitPrice,
      discountType: l.discountValue ? (l.discountType ?? 'PERCENT') : null,
      discountValue: l.discountValue,
      color: l.color,
      brand: l.brand,
      notes: l.notes,
      damage: l.damage,
      damageNotes: l.damageNotes,
      damagePhotoIds: l.damagePhotoIds,
      customerPackageId: l.customerPackageId,
    })),
  });

  const create = useMutation({
    mutationFn: (r: PaymentResult & { park?: boolean }) =>
      api.post('/api/orders', { ...orderBody(), payments: r.payments, onAccount: r.onAccount, park: !!r.park, draftId }),
    onSuccess: async (data, vars) => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      if (vars.park) {
        toast.success(t('pos.parkedSaved'));
        reset();
        return;
      }
      setPaying(false);
      const o = data.order;
      setSuccess({ id: o.id, orderNo: o.orderNo, customerId: o.customer?.id ?? null });
      reset();
      if (autoPrint) {
        try {
          await printOrder(o.id, { receipt: true, tags: true });
        } catch (e) {
          toast.error(e);
        }
      }
    },
    onError: (e) => toast.error(e),
  });

  const save = useMutation({
    mutationFn: () => api.put(`/api/orders/${editing!.id}`, orderBody()),
    onSuccess: async (data) => {
      toast.success(t('common.saved'));
      toast.info(t('pos.reprintTagsAfterEdit'));
      const id = data.order.id;
      reset();
      navigate(`/orders/${id}`);
    },
    onError: (e) => toast.error(e),
  });

  const drafts = useQuery({ queryKey: ['drafts'], queryFn: () => api.get('/api/orders/drafts'), enabled: showDrafts });

  if (catalog.isLoading) return <Loading />;

  const categories = ['all', ...Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[]))];
  const visible = items.filter((i) => category === 'all' || i.category === category);
  const qtyFor = (itemId: string) => lines.filter((l) => l.itemTypeId === itemId).reduce((n, l) => n + l.quantity, 0);
  const canProceed = lines.length > 0 && (customer || walkIn) && !discountTooHigh && !readOnly;
  const detailLine = lines.find((l) => l.key === detailKey) ?? null;
  const showPrices = hasCap('viewPrices');

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-1 hover:bg-slate-100 lg:hidden" onClick={() => setMobileCart(false)} aria-label={t('pos.hideCart')}>
            <ChevronLeft className="size-5" />
          </button>
          <h2 className="font-semibold">{editing ? t('pos.editing', { no: editing.orderNo }) : t('pos.cart')}</h2>
          {pieces > 0 && <Badge color="brand">{t('pos.cartCount', { count: pieces })}</Badge>}
        </div>
        {lines.length > 0 && (
          <button className="text-xs font-medium text-rose-600 hover:underline" onClick={() => setConfirmClear(true)}>
            {t('pos.clear')}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
            <ShoppingBasket className="size-10" />
            {t('pos.emptyCart')}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lines.map((l) => {
              const item = itemMap.get(l.itemTypeId);
              const svc = serviceMap.get(l.serviceTypeId);
              const i = lines.indexOf(l);
              const total = totals.lines[i];
              return (
                <li key={l.key} className="flex items-center gap-2 px-3 py-2">
                  <ItemImage imageKey={item?.imageKey} imageFileId={item?.imageFileId} alt={item?.name ?? ''} className="size-11 shrink-0" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setDetailKey(l.key)}>
                    <div className="flex items-center gap-1 truncate text-sm font-semibold">
                      {item?.name}
                      {item?.unit === 'SQM' && <span className="text-xs font-normal text-slate-500">· {l.area} m²</span>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <ServiceIcon iconKey={svc?.iconKey} alt="" className="size-4" />
                      <span className="truncate">{svc?.name}</span>
                      {l.color && <span className="truncate">· {l.color}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {l.damage.length > 0 && (
                        <Badge color="amber">
                          <AlertTriangle className="size-3" /> {l.damage.length}
                        </Badge>
                      )}
                      {l.customerPackageId && <Badge color="green">{t('pos.packageApplied')}</Badge>}
                      {l.discountValue ? <Badge color="purple">−{l.discountType === 'AMOUNT' ? money(l.discountValue) : `${l.discountValue}%`}</Badge> : null}
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <button className="grid size-8 place-items-center rounded-lg bg-slate-100 hover:bg-slate-200" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="-">
                      {l.quantity === 1 ? <Trash2 className="size-4 text-rose-600" /> : <Minus className="size-4" />}
                    </button>
                    <span className="w-7 text-center font-semibold tabular-nums">{l.quantity}</span>
                    <button className="grid size-8 place-items-center rounded-lg bg-slate-100 hover:bg-slate-200" onClick={() => setQty(l.key, l.quantity + 1)} aria-label="+">
                      <Plus className="size-4" />
                    </button>
                  </div>
                  {showPrices && <div className="w-16 text-right text-sm font-semibold tabular-nums">{l.customerPackageId ? '—' : money(total?.net)}</div>}
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setDetailKey(l.key)} aria-label={t('pos.itemDetails')}>
                    <Pencil className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Switch
            checked={express}
            onChange={setExpress}
            label={
              <span className="flex items-center gap-1 font-semibold">
                <Zap className={clsx('size-4', express ? 'text-amber-500' : 'text-slate-400')} />
                {t('pos.express')}
              </span>
            }
          />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            {t('pos.expected')}:
            <input
              type="datetime-local"
              className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
              value={expectedOverride || (expectedAuto ? toLocalInput(expectedAuto) : '')}
              onChange={(e) => setExpectedOverride(e.target.value)}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Input className="h-9 flex-1 text-xs bidi" placeholder={t('pos.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {showPrices && maxDiscount > 0 && (
            <div className="flex w-36 shrink-0">
              <select className="rounded-l-lg border border-r-0 border-slate-300 bg-white px-1 text-xs" value={discountType} onChange={(e) => setDiscountType(e.target.value as 'PERCENT' | 'AMOUNT')} aria-label={t('pos.discount')}>
                <option value="PERCENT">%</option>
                <option value="AMOUNT">{t('common.bhd')}</option>
              </select>
              <input
                className="w-full rounded-r-lg border border-slate-300 px-2 text-xs"
                inputMode="decimal"
                placeholder={t('pos.discountShort')}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
          )}
        </div>
        {discountTooHigh && <p className="text-xs text-rose-600">{t('pos.discountLimit', { pct: maxDiscount })}</p>}
        {showPrices && (
          <div className="space-y-0.5 text-sm">
            <Row label={t('pos.subtotal')} value={money(totals.subtotal)} />
            {totals.expressSurcharge > 0 && <Row label={t('pos.expressSurcharge')} value={money(totals.expressSurcharge)} />}
            {totals.discountTotal > 0 && <Row label={t('pos.discount')} value={`−${money(totals.discountTotal)}`} />}
            <Row label={t('pos.vat', { rate: settings?.vatRate ?? 0 })} value={money(totals.vatAmount)} />
            <div className="flex items-baseline justify-between pt-1 text-xl font-bold">
              <span>{t('pos.total')}</span>
              <span className="tabular-nums">BHD {money(totals.total)}</span>
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          {editing ? (
            <>
              <Button variant="secondary" onClick={() => { reset(); navigate(`/orders/${editing.id}`); }}>
                {t('common.cancel')}
              </Button>
              <Button size="lg" block disabled={!canProceed} loading={save.isPending} onClick={() => save.mutate()}>
                {t('pos.saveChanges')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="lg" icon={<Pause className="size-4" />} disabled={!canProceed} loading={create.isPending && create.variables?.park} onClick={() => create.mutate({ payments: [], onAccount: false, park: true })}>
                {t('pos.park')}
              </Button>
              <Button size="lg" variant="success" block disabled={!canProceed} onClick={() => setPaying(true)}>
                {t('pos.pay')} {showPrices && `· ${money(totals.total)}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Left: customer, services, picture grid */}
      <div className={clsx('flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3', mobileCart && 'hidden lg:flex')}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <CustomerBar
              customer={customer}
              walkIn={walkIn}
              onSelect={(c) => {
                setCustomer(c);
                setWalkIn(false);
              }}
              onWalkIn={() => setWalkIn(true)}
              onClear={() => {
                setCustomer(null);
                setWalkIn(false);
                setLines((ls) => ls.map((l) => ({ ...l, customerPackageId: null })));
              }}
            />
          </div>
          <button className="grid size-12 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 sm:hidden" onClick={() => setShowDrafts(true)} aria-label={t('pos.parked')}>
            <PackageOpen className="size-5" />
          </button>
          <div className="hidden shrink-0 flex-col gap-1 sm:flex">
            <Button size="sm" variant="secondary" icon={<PackageOpen className="size-4" />} onClick={() => setShowDrafts(true)}>
              {t('pos.parked')}
            </Button>
            <button className="flex items-center gap-1 text-xs text-slate-500" onClick={() => { const v = !autoPrint; setAutoPrint(v); try { localStorage.setItem('lms.autoPrint', v ? '1' : '0'); } catch { /* ignore */ } }}>
              <Printer className={clsx('size-3.5', autoPrint ? 'text-brand-600' : 'text-slate-400')} />
              {t('pos.autoPrint')}: {autoPrint ? t('common.yes') : t('common.no')}
            </button>
          </div>
        </div>

        <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => setServiceId(s.id)}
              className={clsx(
                'flex shrink-0 items-center gap-2 rounded-xl border-2 bg-white px-3 py-1.5 text-sm font-semibold transition',
                serviceId === s.id ? 'border-brand-600 bg-brand-50 text-brand-800 shadow-sm' : 'border-slate-200 text-slate-700 hover:border-slate-300',
              )}
            >
              <ServiceIcon iconKey={s.iconKey} alt="" className="size-8" />
              {s.name}
            </button>
          ))}
        </div>

        {categories.length > 2 && (
          <div className="scrollbar-thin flex gap-1.5 overflow-x-auto">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={clsx('shrink-0 rounded-full px-3 py-1 text-xs font-semibold', category === c ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}
              >
                {c === 'all' ? t('pos.allItems') : c}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-2">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
            {visible.map((item) => {
              const price = serviceId ? prices.unitPrice(item.id, serviceId, express) : null;
              const qty = qtyFor(item.id);
              const available = price !== null;
              return (
                <button
                  key={item.id}
                  onClick={() => tapItem(item)}
                  className={clsx(
                    'relative flex flex-col items-center gap-1 rounded-2xl border-2 bg-white px-1 pb-2 pt-2 shadow-sm transition active:scale-[0.97]',
                    qty > 0 ? 'border-brand-500' : 'border-transparent hover:border-slate-200',
                    !available && 'opacity-45',
                  )}
                >
                  <ItemImage imageKey={item.imageKey} imageFileId={item.imageFileId} alt={item.name} className="size-16 md:size-[72px]" />
                  <span className="line-clamp-2 text-center text-xs font-semibold leading-tight text-slate-800">{item.name}</span>
                  {showPrices && (
                    <span className="text-[11px] tabular-nums text-slate-500">
                      {available ? money(price) : '—'}
                      {item.unit === 'SQM' && available ? `/${t('pos.perSqm')}` : ''}
                    </span>
                  )}
                  {qty > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-6 place-items-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white shadow">{qty}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: cart */}
      <aside className={clsx('min-h-0 border-slate-200 bg-white lg:flex lg:w-[400px] lg:shrink-0 lg:border-l xl:w-[440px]', mobileCart ? 'flex flex-1 flex-col' : 'hidden')}>{cartPanel}</aside>

      {/* Mobile summary bar */}
      {!mobileCart && lines.length > 0 && (
        <div className="fixed inset-x-3 bottom-[76px] z-20 lg:hidden">
          <button onClick={() => setMobileCart(true)} className="flex w-full items-center justify-between rounded-2xl bg-brand-600 px-4 py-3 text-white shadow-xl">
            <span className="flex items-center gap-2 font-semibold">
              <ShoppingBasket className="size-5" /> {t('pos.cartCount', { count: pieces })}
            </span>
            <span className="font-bold tabular-nums">{showPrices ? `BHD ${money(totals.total)}` : t('pos.viewCart')}</span>
          </button>
        </div>
      )}

      <LineDetailsModal
        line={detailLine}
        item={detailLine ? itemMap.get(detailLine.itemTypeId) : undefined}
        services={detailLine ? prices.servicesFor(detailLine.itemTypeId) : []}
        listPrice={(sid) => (detailLine ? prices.unitPrice(detailLine.itemTypeId, sid, express) : null)}
        customer={customer}
        onChange={(l) => setLines((ls) => ls.map((x) => (x.key === l.key ? l : x)))}
        onRemove={() => {
          setLines((ls) => ls.filter((x) => x.key !== detailKey));
          setDetailKey(null);
        }}
        onClose={() => setDetailKey(null)}
      />

      <Modal open={!!choose} onClose={() => setChoose(null)} title={choose ? t('pos.chooseService', { item: choose.name }) : ''} size="md">
        <div className="grid grid-cols-2 gap-2">
          {choose &&
            prices.servicesFor(choose.id).map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  addItem(choose, s.id);
                  setChoose(null);
                }}
                className="flex items-center gap-3 rounded-xl border-2 border-slate-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50"
              >
                <ServiceIcon iconKey={s.iconKey} alt="" className="size-10" />
                <div>
                  <div className="font-semibold">{s.name}</div>
                  {showPrices && <div className="text-sm text-slate-500">{money(prices.unitPrice(choose.id, s.id, express))}</div>}
                </div>
              </button>
            ))}
        </div>
      </Modal>

      <Modal
        open={!!areaFor}
        onClose={() => setAreaFor(null)}
        size="sm"
        title={areaFor ? t('pos.enterArea', { item: areaFor.item.name }) : ''}
        footer={
          <Button
            disabled={!(parseMoney(areaValue) > 0)}
            onClick={() => {
              if (areaFor) addItem(areaFor.item, areaFor.serviceId, parseMoney(areaValue));
              setAreaFor(null);
            }}
          >
            {t('common.add')}
          </Button>
        }
      >
        <Input autoFocus className="h-14 text-center text-2xl" inputMode="decimal" value={areaValue} onChange={(e) => setAreaValue(e.target.value.replace(/[^\d.]/g, ''))} placeholder="m²" />
      </Modal>

      <PaymentModal
        open={paying}
        onClose={() => setPaying(false)}
        due={totals.total}
        walletBalance={customer?.walletBalance ?? null}
        creditAvailable={customer?.creditEnabled ? customer.creditAvailable : undefined}
        allowAccount={!!customer?.creditEnabled}
        loading={create.isPending}
        onConfirm={(r) => create.mutate(r)}
      />

      <Modal open={showDrafts} onClose={() => setShowDrafts(false)} title={t('pos.parked')}>
        {drafts.isLoading ? (
          <Loading />
        ) : !drafts.data?.drafts?.length ? (
          <p className="py-6 text-center text-sm text-slate-500">{t('pos.noParked')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {drafts.data.drafts.map((d: any) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium bidi">{d.customer?.name ?? t('common.walkIn')}</div>
                  <div className="text-xs text-slate-500">
                    {d.pieceCount} {t('common.pieces')} · {dateTime(d.updatedAt)} · {d.createdByName}
                  </div>
                </div>
                {showPrices && <span className="text-sm font-semibold tabular-nums">{money(d.total)}</span>}
                <Button
                  size="sm"
                  onClick={() => {
                    setShowDrafts(false);
                    reset();
                    setParams({ draft: d.id });
                  }}
                >
                  {t('pos.resume')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmModal open={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={() => { reset(); setConfirmClear(false); }} title={t('pos.clearConfirm')} danger confirmLabel={t('pos.clear')} />

      {success && <SuccessPanel order={success} onClose={() => setSuccess(null)} canWhatsapp={!!success.customerId && hasCap('viewCustomerPhone')} canView={can('pos', 'view')} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
