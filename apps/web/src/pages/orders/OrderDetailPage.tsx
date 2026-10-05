import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Banknote,
  FileText,
  MessageCircle,
  PackageCheck,
  PauseCircle,
  Pencil,
  PlayCircle,
  Printer,
  Tags,
  Wallet,
} from 'lucide-react';
import { PIECE_STATUSES } from '@laundry/shared';
import { api, openFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, money, phone, STATUS_COLOR } from '../../lib/format';
import { printOrder } from '../../lib/print';
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { OrderFlags, PaymentBadge, StatusBadge } from '../../components/orders';
import { PaymentModal } from '../../components/PaymentModal';
import { useToast } from '../../components/toast';

const PIECE_BG: Record<string, string> = {
  RECEIVED: 'bg-slate-100 text-slate-700 ring-slate-300',
  IN_PROCESS: 'bg-sky-100 text-sky-800 ring-sky-300',
  IRONING: 'bg-amber-100 text-amber-800 ring-amber-300',
  READY: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  DELIVERED: 'bg-slate-700 text-white ring-slate-700',
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can, hasCap, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get(`/api/orders/${id}`) });
  const o = q.data?.order;
  const [selected, setSelected] = useState<number[]>([]);
  const [dialog, setDialog] = useState<null | 'pay' | 'deliverPay' | 'cancel' | 'hold' | 'status'>(null);
  const [reason, setReason] = useState('');
  const [refundMode, setRefundMode] = useState<'ORIGINAL' | 'CASH' | 'WALLET'>('ORIGINAL');
  const [targetStatus, setTargetStatus] = useState('IN_PROCESS');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = (data?: { order: unknown }) => {
    if (data?.order) qc.setQueryData(['order', id], { order: data.order });
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['alerts'] });
    void qc.invalidateQueries({ queryKey: ['board'] });
  };

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(`/api/orders/${id}/${path}`, body ?? {}),
    onSuccess: (data, v) => {
      refresh(data);
      setDialog(null);
      setSelected([]);
      setReason('');
      if (v.path === 'advance') toast.success(t('orders.advanced', { status: t(`orderStatus.${data.to}`) }));
      else if (v.path === 'deliver') toast.success(t('delivery.done', { no: data.order.orderNo }));
      else if (v.path === 'cancel') toast.success(t('orders.cancelled'));
      else if (v.path === 'payments') toast.success(t('payment.collected'));
      else toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(e),
  });

  const allPieces = useMemo(() => (o?.items ?? []).flatMap((it: any) => it.pieces.map((p: any) => ({ ...p, item: it }))), [o]);
  if (q.isLoading) return <Loading />;
  if (!o) return <div className="p-6"><ErrorBox error={q.error} /></div>;

  const showPrices = hasCap('viewPrices');
  const active = ['RECEIVED', 'IN_PROCESS', 'IRONING', 'READY'].includes(o.status);
  const readyPieces = allPieces.filter((p: any) => p.status === 'READY').map((p: any) => p.pieceNo);
  const editable = o.status === 'RECEIVED' && allPieces.every((p: any) => p.status === 'RECEIVED') && can('pos', 'edit');
  const due = Number(o.balanceDue ?? 0);
  const walletBalance = o.customer && o.customer.walletPaid !== undefined ? Number(o.customer.walletPaid) + Number(o.customer.walletBonus) : null;
  const toggle = (n: number) => setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const whatsapp = (type: 'ready' | 'receipt') =>
    run(`wa-${type}`, async () => {
      const r = await api.get(`/api/orders/${id}/whatsapp?type=${type}`);
      window.open(r.url, '_blank', 'noopener');
    });

  const deliver = () => {
    const pieces = selected.length ? selected : readyPieces;
    if (due > 0 && !o.onAccount) setDialog('deliverPay');
    else action.mutate({ path: 'deliver', body: { pieceNos: pieces, payments: [] } });
  };

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {t('common.back')}
          </button>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.orderNo ? `#${o.orderNo}` : t('orders.parked')}
            <StatusBadge status={o.status} />
            {showPrices && o.status !== 'DRAFT' && <PaymentBadge state={o.paymentState} onAccount={o.onAccount} />}
            <OrderFlags o={o} />
          </span>
        }
        subtitle={`${dateTime(o.createdAt)} · ${t('orders.createdBy', { name: o.createdByName ?? '' })}`}
      />

      {/* Action bar */}
      <div className="no-print mb-4 flex flex-wrap gap-2">
        {o.status !== 'DRAFT' && (
          <>
            {showPrices && can('pos', 'view') && (
              <Button variant="secondary" icon={<Printer className="size-4" />} loading={busy === 'r'} onClick={() => run('r', () => printOrder(o.id, { receipt: true }))}>
                {t('orders.receipt')}
              </Button>
            )}
            <Button variant="secondary" icon={<Tags className="size-4" />} loading={busy === 't'} onClick={() => run('t', () => printOrder(o.id, { tags: true, pieces: selected }))}>
              {t('orders.tags')}
              {selected.length ? ` (${selected.length})` : ''}
            </Button>
            {showPrices && (
              <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => openFile(`/api/documents/invoice/${o.id}`)}>
                {t('orders.taxInvoice')}
              </Button>
            )}
          </>
        )}
        {o.status === 'DRAFT' && can('pos', 'create') && (
          <Button icon={<PlayCircle className="size-4" />} onClick={() => navigate(`/pos?draft=${o.id}`)}>
            {t('pos.resume')}
          </Button>
        )}
        {active && !readOnly && can('tracking', 'edit') && !o.onHold && o.status !== 'READY' && (
          <Button icon={<ArrowRight className="size-4" />} loading={action.isPending && action.variables?.path === 'advance'} onClick={() => action.mutate({ path: 'advance', body: { pieceNos: selected.length ? selected : null } })}>
            {t('orders.advance')}
          </Button>
        )}
        {active && !readOnly && can('delivery', 'create') && readyPieces.length > 0 && !o.onHold && (
          <Button variant="success" icon={<PackageCheck className="size-4" />} onClick={deliver}>
            {selected.length ? t('orders.deliverSelected') : t('orders.deliver')}
          </Button>
        )}
        {active && !readOnly && showPrices && due > 0 && (can('pos', 'create') || can('delivery', 'create')) && (
          <Button variant="secondary" icon={<Banknote className="size-4" />} onClick={() => setDialog('pay')}>
            {t('payment.collect')}
          </Button>
        )}
        {o.customer && hasCap('viewCustomerPhone') && o.status !== 'DRAFT' && (
          <>
            {o.status === 'READY' && (
              <Button variant="secondary" icon={<MessageCircle className="size-4 text-emerald-600" />} loading={busy === 'wa-ready'} onClick={() => whatsapp('ready')}>
                {t('orders.whatsappReady')}
              </Button>
            )}
            <Button variant="ghost" icon={<MessageCircle className="size-4 text-emerald-600" />} loading={busy === 'wa-receipt'} onClick={() => whatsapp('receipt')}>
              {t('orders.whatsappReceipt')}
            </Button>
          </>
        )}
        <div className="flex-1" />
        {active && !readOnly && can('tracking', 'edit') && (
          <>
            <Button variant="ghost" onClick={() => setDialog('status')}>
              {t('orders.setStatus')}
            </Button>
            <Button
              variant="ghost"
              icon={<PauseCircle className="size-4" />}
              onClick={() => (o.onHold ? action.mutate({ path: 'hold', body: { onHold: false } }) : setDialog('hold'))}
            >
              {o.onHold ? t('orders.release') : t('orders.hold')}
            </Button>
          </>
        )}
        {editable && !readOnly && (
          <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => navigate(`/pos?edit=${o.id}`)}>
            {t('orders.edit')}
          </Button>
        )}
        {(active || o.status === 'DRAFT') && !readOnly && can('pos', 'delete') && (
          <Button variant="ghost" className="text-rose-600" icon={<Ban className="size-4" />} onClick={() => setDialog('cancel')}>
            {t('orders.cancel')}
          </Button>
        )}
      </div>

      {o.onHold && o.holdReason && <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-800">{o.holdReason}</div>}
      {o.status === 'CANCELLED' && o.cancelReason && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{o.cancelReason}</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('orders.items')} bodyClassName="p-0">
            <ul className="divide-y divide-slate-100">
              {o.items.map((it: any) => (
                <li key={it.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">
                        {it.quantity}× {it.itemName}
                        {it.unit === 'SQM' && <span className="font-normal text-slate-500"> · {it.area} m²</span>}
                      </div>
                      <div className="text-sm text-slate-600">
                        {it.serviceName}
                        {it.color && ` · ${it.color}`}
                        {it.brand && ` · ${it.brand}`}
                      </div>
                      {it.notes && <div className="text-sm text-slate-500 bidi">{it.notes}</div>}
                      {it.customerPackageId && <Badge color="green" className="mt-1">{t('pos.packageApplied')}</Badge>}
                    </div>
                    {showPrices && (
                      <div className="text-right">
                        <div className="font-semibold tabular-nums">{money(it.lineTotal)}</div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          {money(it.unitPrice)} × {it.unit === 'SQM' ? it.area : it.quantity}
                          {Number(it.discountAmount) > 0 && ` −${money(it.discountAmount)}`}
                        </div>
                      </div>
                    )}
                  </div>
                  {(it.damage.length > 0 || it.damageNotes || it.damagePhotoIds.length > 0) && (
                    <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                      <span className="font-semibold">{t('orders.damage')}: </span>
                      {it.damage.map((d: string) => t(`damage.${d}`)).join(', ')}
                      {it.damageNotes && <span className="bidi"> — {it.damageNotes}</span>}
                      {it.damagePhotoIds.length > 0 && (
                        <div className="mt-2 flex gap-2">
                          {it.damagePhotoIds.map((pid: string) => (
                            <a key={pid} href={`/api/files/${pid}`} target="_blank" rel="noreferrer">
                              <img src={`/api/files/${pid}`} alt="" className="size-16 rounded-lg object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {it.pieces.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => toggle(p.pieceNo)}
                        className={clsx(
                          'rounded-lg px-2 py-1 text-xs font-semibold ring-1 transition',
                          PIECE_BG[p.status],
                          selected.includes(p.pieceNo) && 'outline-2 outline-offset-1 outline-brand-600',
                        )}
                        title={t(`orderStatus.${p.status}`)}
                      >
                        {p.pieceNo}/{o.pieceCount} · {t(`orderStatus.${p.status}`)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t('orders.history')}>
            <ol className="space-y-2">
              {o.events.map((e: any) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="w-32 shrink-0 text-xs text-slate-500">{dateTime(e.createdAt)}</span>
                  <span className="flex-1">
                    <span className="font-medium">
                      {e.type === 'STATUS'
                        ? t('orders.event.STATUS', { from: t(`orderStatus.${e.fromStatus}`), to: t(`orderStatus.${e.toStatus}`) })
                        : t(`orders.event.${e.type}`, { defaultValue: e.type })}
                    </span>
                    {e.pieceNos?.length > 0 && e.pieceNos.length < o.pieceCount && <span className="text-slate-500"> · {e.pieceNos.join(', ')}</span>}
                    {e.note && <span className="text-slate-500 bidi"> · {e.note}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{e.userName}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={t('orders.customer')}>
            {o.customer ? (
              <div className="space-y-1">
                {can('customers') ? (
                  <Link to={`/customers/${o.customer.id}`} className="font-semibold text-brand-700 hover:underline bidi">
                    {o.customer.name}
                  </Link>
                ) : (
                  <div className="font-semibold bidi">{o.customer.name}</div>
                )}
                {o.customer.mobile && <div className="text-sm text-slate-600">{phone(o.customer.mobile)}</div>}
                {walletBalance !== null && walletBalance > 0 && (
                  <div className="flex items-center gap-1 text-sm text-emerald-700">
                    <Wallet className="size-4" /> {t('customers.wallet')}: {money(walletBalance)}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-sm text-slate-500">{t('common.walkIn')}</span>
            )}
          </Card>

          <Card title={t('orders.order')}>
            <dl className="space-y-1 text-sm">
              <Row label={t('orders.expected')} value={dateTime(o.expectedAt)} />
              {o.readyAt && <Row label={t('orderStatus.READY')} value={dateTime(o.readyAt)} />}
              {o.deliveredAt && <Row label={t('orders.delivered')} value={`${dateTime(o.deliveredAt)}${o.deliveredByName ? ` · ${o.deliveredByName}` : ''}`} />}
              <Row label={t('orders.pieces')} value={String(o.pieceCount)} />
              {o.notes && <div className="rounded-lg bg-slate-50 p-2 text-slate-700 bidi">{o.notes}</div>}
            </dl>
            {showPrices && o.status !== 'DRAFT' && (
              <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
                <Row label={t('pos.subtotal')} value={money(o.subtotal)} />
                {Number(o.expressSurcharge) > 0 && <Row label={t('pos.expressSurcharge')} value={money(o.expressSurcharge)} />}
                {Number(o.discountTotal) > 0 && <Row label={t('pos.discount')} value={`−${money(o.discountTotal)}`} />}
                <Row label={t('pos.vat', { rate: Number(o.vatRate) })} value={money(o.vatAmount)} />
                <div className="flex justify-between pt-1 text-lg font-bold">
                  <span>{t('pos.total')}</span>
                  <span className="tabular-nums">{money(o.total)}</span>
                </div>
                <Row label={t('orders.paid')} value={money(o.paidAmount)} />
                <div className={clsx('flex justify-between font-semibold', due > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                  <span>{t('orders.due')}</span>
                  <span className="tabular-nums">{money(due)}</span>
                </div>
              </dl>
            )}
          </Card>

          {showPrices && o.payments?.length > 0 && (
            <Card title={t('orders.payments')} bodyClassName="p-0">
              <ul className="divide-y divide-slate-100 text-sm">
                {o.payments.map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <div>
                      <div className="font-medium">
                        {t(`paymentMethod.${p.method}`)}
                        {p.kind === 'REFUND' && <Badge color="red" className="ml-1">{t('orders.refundBadge')}</Badge>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {dateTime(p.createdAt)} · {p.createdByName}
                        {p.note && p.kind === 'PACKAGE_REDEMPTION' ? ` · ${p.note}` : ''}
                      </div>
                    </div>
                    <span className="font-semibold tabular-nums">{p.kind === 'PACKAGE_REDEMPTION' ? t('print.package') : money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <PaymentModal
        open={dialog === 'pay' || dialog === 'deliverPay'}
        onClose={() => setDialog(null)}
        due={due}
        walletBalance={walletBalance}
        allowLater={false}
        loading={action.isPending}
        title={dialog === 'deliverPay' ? t('delivery.collectAndDeliver') : t('payment.collect')}
        onConfirm={(r) => {
          if (dialog === 'deliverPay') action.mutate({ path: 'deliver', body: { pieceNos: selected.length ? selected : readyPieces, payments: r.payments } });
          else action.mutate({ path: 'payments', body: { payments: r.payments } });
        }}
      />

      <Modal
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={t('orders.cancel')}
        footer={
          <Button variant="danger" loading={action.isPending} disabled={reason.trim().length < 3} onClick={() => action.mutate({ path: 'cancel', body: { reason, refundMode } })}>
            {t('orders.cancel')}
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label={t('orders.cancelReason')}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          {Number(o.paidAmount) > 0 && (
            <Field label={t('orders.refundMode')}>
              <Select value={refundMode} onChange={(e) => setRefundMode(e.target.value as typeof refundMode)}>
                <option value="ORIGINAL">{t('orders.refundOriginal')}</option>
                <option value="CASH">{t('orders.refundCash')}</option>
                {o.customer && <option value="WALLET">{t('orders.refundWallet')}</option>}
              </Select>
            </Field>
          )}
        </div>
      </Modal>

      <Modal
        open={dialog === 'hold'}
        onClose={() => setDialog(null)}
        title={t('orders.hold')}
        size="sm"
        footer={
          <Button loading={action.isPending} onClick={() => action.mutate({ path: 'hold', body: { onHold: true, reason } })}>
            {t('orders.hold')}
          </Button>
        }
      >
        <Field label={t('orders.holdReason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </Modal>

      <Modal
        open={dialog === 'status'}
        onClose={() => setDialog(null)}
        title={t('orders.setStatus')}
        size="sm"
        footer={
          <Button loading={action.isPending} onClick={() => action.mutate({ path: 'status', body: { status: targetStatus, pieceNos: selected.length ? selected : null } })}>
            {t('common.save')}
          </Button>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-slate-500">{selected.length ? `${t('orders.piecesTitle')}: ${selected.join(', ')}` : t('common.all')}</p>
          <div className="grid gap-2">
            {PIECE_STATUSES.filter((s) => s !== 'DELIVERED').map((s) => (
              <button
                key={s}
                onClick={() => setTargetStatus(s)}
                className={clsx('rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold', targetStatus === s ? 'border-brand-500 bg-brand-50' : 'border-slate-200')}
              >
                <Badge color={STATUS_COLOR[s]}>{t(`orderStatus.${s}`)}</Badge>
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}
