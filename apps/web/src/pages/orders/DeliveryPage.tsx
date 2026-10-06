import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CheckCircle2, PackageCheck, ScanLine, Search } from 'lucide-react';
import { parseScan } from '@laundry/shared';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, money, phone } from '../../lib/format';
import { feedback, useBarcodeScanner, useDebounced } from '../../lib/hooks';
import { printOrder } from '../../lib/print';
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader } from '../../components/ui';
import { OrderFlags, StatusBadge, type OrderSummary } from '../../components/orders';
import { PaymentModal } from '../../components/PaymentModal';
import { BarcodeCamera, normalizeScanCode } from '../../components/BarcodeCamera';
import { useToast } from '../../components/toast';

/** Counter hand-over: find the order, check balance, collect payment, mark delivered. */
export default function DeliveryPage() {
  const { t } = useTranslation();
  const { hasCap, can, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [paying, setPaying] = useState(false);
  const [camera, setCamera] = useState(false);
  const dq = useDebounced(q, 300);

  const ready = useQuery({
    queryKey: ['orders', 'ready', dq],
    queryFn: () => api.get(`/api/orders${qs({ status: 'READY', q: dq, pageSize: 100 })}`),
  });
  const detail = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get(`/api/orders/${orderId}`), enabled: !!orderId });
  const o = detail.data?.order;

  const open = async (id: string) => {
    setOrderId(id);
    const r = await qc.fetchQuery({ queryKey: ['order', id], queryFn: () => api.get(`/api/orders/${id}`) });
    const readyNos = r.order.items.flatMap((it: any) => it.pieces.filter((p: any) => p.status === 'READY').map((p: any) => p.pieceNo));
    setSelected(readyNos);
  };

  const onScan = async (raw: string) => {
    const code = await normalizeScanCode(raw, async (id) => (await api.get(`/api/orders/${id}`)).order.orderNo);
    const p = parseScan(code);
    if (!p) return;
    try {
      const r = await api.get(`/api/orders/no/${p.orderNo}`);
      feedback(true);
      await open(r.order.id);
    } catch (e) {
      feedback(false);
      toast.error(e);
    }
  };
  useBarcodeScanner((c) => void onScan(c));

  const deliver = useMutation({
    mutationFn: (payments: { method: string; amount: number }[]) => api.post(`/api/orders/${orderId}/deliver`, { pieceNos: selected, payments }),
    onSuccess: (r, payments) => {
      setPaying(false);
      toast.success(t('delivery.done', { no: r.order.orderNo }) + (r.remaining ? ` · ${t('delivery.remaining', { count: r.remaining })}` : ''));
      qc.setQueryData(['order', orderId], { order: r.order });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      // Money collected at pickup → print an updated receipt showing it paid.
      if (payments.length > 0 && hasCap('viewPrices')) void printOrder(r.order.id, { receipt: true }).catch(() => undefined);
      setOrderId(null);
    },
    onError: (e) => toast.error(e),
  });

  const list: OrderSummary[] = ready.data?.orders ?? [];
  const due = Number(o?.balanceDue ?? 0);
  const pieces = (o?.items ?? []).flatMap((it: any) => it.pieces.map((p: any) => ({ ...p, itemName: it.itemName, serviceName: it.serviceName })));
  const showPrices = hasCap('viewPrices');
  const needsPayment = due > 0 && !o?.onAccount;

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <PageHeader title={t('delivery.title')} subtitle={t('delivery.hint')} />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input className="h-11 pl-9" placeholder={t('orders.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button variant="secondary" size="lg" icon={<ScanLine className="size-5" />} onClick={() => setCamera((c) => !c)} aria-label={t('nav.scan')} />
          </div>
          {camera && <BarcodeCamera autoStart onCode={(c) => void onScan(c)} />}
          <Card title={`${t('delivery.readyOrders')} (${list.length})`} bodyClassName="p-0">
            {ready.isLoading ? (
              <Loading />
            ) : !list.length ? (
              <Empty title={t('orders.noOrders')} />
            ) : (
              <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
                {list.map((x) => (
                  <li key={x.id}>
                    <button onClick={() => void open(x.id)} className={clsx('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50', orderId === x.id && 'bg-brand-50')}>
                      <span className="text-lg font-bold tabular-nums">#{x.orderNo}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium bidi">{x.customer?.name ?? t('common.walkIn')}</span>
                        <span className="text-xs text-slate-500">
                          {x.pieceCount} {t('common.pieces')} · {dateTime(x.readyAt)}
                        </span>
                      </span>
                      {showPrices && x.balanceDue! > 0 && <span className="text-sm font-semibold text-rose-600 tabular-nums">{money(x.balanceDue)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="lg:col-span-3">
          {!orderId ? (
            <div className="card">
              <Empty icon={<PackageCheck className="size-12" />} title={t('orders.lookupTitle')}>
                {t('orders.lookupHint')}
              </Empty>
            </div>
          ) : detail.isLoading || !o ? (
            <Loading />
          ) : (
            <div className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-3xl font-black tabular-nums">#{o.orderNo}</div>
                  <div className="font-medium bidi">{o.customer?.name ?? t('common.walkIn')}</div>
                  {o.customer?.mobile && <div className="text-sm text-slate-500">{phone(o.customer.mobile)}</div>}
                </div>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge status={o.status} />
                  <OrderFlags o={o} />
                </div>
              </div>
              <ErrorBox error={detail.error} />
              <div className="mt-4">
                <div className="label">{t('orders.selectPieces')}</div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {pieces.map((p: any) => {
                    const isReady = p.status === 'READY';
                    const on = selected.includes(p.pieceNo);
                    return (
                      <button
                        key={p.id}
                        disabled={!isReady}
                        onClick={() => setSelected((s) => (on ? s.filter((x) => x !== p.pieceNo) : [...s, p.pieceNo]))}
                        className={clsx(
                          'flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm',
                          on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200',
                          !isReady && 'opacity-50',
                        )}
                      >
                        <CheckCircle2 className={clsx('size-5', on ? 'text-emerald-600' : 'text-slate-300')} />
                        <span className="font-semibold tabular-nums">
                          {p.pieceNo}/{o.pieceCount}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {p.itemName} · {p.serviceName}
                        </span>
                        {!isReady && <span className="text-xs text-slate-500">{t(`orderStatus.${p.status}`)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              {showPrices && (
                <div className={clsx('mt-4 flex items-center justify-between rounded-xl px-4 py-3', needsPayment ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800')}>
                  <span className="font-semibold">{needsPayment ? t('delivery.balanceDue') : o.onAccount && due > 0 ? t('orders.onAccount') : t('delivery.paidInFull')}</span>
                  <span className="text-2xl font-bold tabular-nums">BHD {money(due)}</span>
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <Button
                  size="xl"
                  variant="success"
                  block
                  disabled={!selected.length || readOnly || !can('delivery', 'create') || o.onHold}
                  loading={deliver.isPending}
                  icon={<PackageCheck className="size-6" />}
                  onClick={() => (needsPayment ? setPaying(true) : deliver.mutate([]))}
                >
                  {needsPayment ? t('delivery.collectAndDeliver') : t('delivery.deliverNow')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      <PaymentModal
        open={paying}
        onClose={() => setPaying(false)}
        due={due}
        walletBalance={o?.customer ? Number(o.customer.walletPaid) + Number(o.customer.walletBonus) : null}
        allowLater={false}
        loading={deliver.isPending}
        title={t('delivery.collectAndDeliver')}
        onConfirm={(r) => deliver.mutate(r.payments)}
      />
    </div>
  );
}
