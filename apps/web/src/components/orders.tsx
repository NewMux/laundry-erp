import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, PauseCircle, Zap } from 'lucide-react';
import clsx from 'clsx';
import { dateTime, money, PAYMENT_COLOR, STATUS_COLOR } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Badge } from './ui';

export interface OrderSummary {
  id: string;
  orderNo: number;
  status: string;
  onHold: boolean;
  holdReason?: string | null;
  express: boolean;
  expectedAt: string | null;
  total?: number;
  paidAmount?: number;
  balanceDue?: number;
  paymentState: string;
  onAccount: boolean;
  pieceCount: number;
  partiallyDelivered: boolean;
  createdAt: string;
  readyAt?: string | null;
  deliveredAt?: string | null;
  createdByName?: string | null;
  customer: { id: string; name: string; mobile?: string } | null;
  items?: { itemName: string; quantity: number }[];
}

export function isOverdue(o: Pick<OrderSummary, 'status' | 'expectedAt'>) {
  return !!o.expectedAt && ['RECEIVED', 'IN_PROCESS', 'IRONING'].includes(o.status) && new Date(o.expectedAt) < new Date();
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge color={STATUS_COLOR[status] ?? 'gray'}>{t(`orderStatus.${status}`)}</Badge>;
}

export function PaymentBadge({ state, onAccount }: { state: string; onAccount?: boolean }) {
  const { t } = useTranslation();
  if (onAccount && state !== 'PAID') return <Badge color="purple">{t('orders.onAccount')}</Badge>;
  return <Badge color={PAYMENT_COLOR[state] ?? 'gray'}>{t(`payment.states.${state}`)}</Badge>;
}

export function OrderFlags({ o }: { o: OrderSummary }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {o.express && (
        <Badge color="purple">
          <Zap className="size-3" /> {t('orders.express')}
        </Badge>
      )}
      {isOverdue(o) && (
        <Badge color="red">
          <AlertTriangle className="size-3" /> {t('orders.overdue')}
        </Badge>
      )}
      {o.onHold && (
        <Badge color="orange">
          <PauseCircle className="size-3" /> {t('orders.onHold')}
        </Badge>
      )}
      {o.partiallyDelivered && <Badge color="blue">{t('orders.partiallyDelivered')}</Badge>}
    </span>
  );
}

/** Compact order card used on the board and on phones. */
export function OrderCard({ o, compact, action }: { o: OrderSummary; compact?: boolean; action?: React.ReactNode }) {
  const { hasCap } = useAuth();
  return (
    <div className={clsx('rounded-xl border bg-white p-3 shadow-sm', isOverdue(o) ? 'border-rose-300' : o.express ? 'border-violet-300' : 'border-slate-200')}>
      <div className="flex items-start justify-between gap-2">
        <Link to={`/orders/${o.id}`} className="text-lg font-bold tabular-nums hover:underline">
          #{o.orderNo}
        </Link>
        <div className="flex items-center gap-1">{action}</div>
      </div>
      <div className="truncate text-sm font-medium text-slate-700 bidi">{o.customer?.name ?? '—'}</div>
      {!compact && o.items && <div className="mt-1 line-clamp-2 text-xs text-slate-500">{o.items.map((i) => `${i.quantity}× ${i.itemName}`).join(', ')}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        <span>{o.pieceCount} pcs</span>
        <span>·</span>
        <span>{dateTime(o.expectedAt)}</span>
        {hasCap('viewPrices') && o.balanceDue !== undefined && o.balanceDue > 0 && <span className="font-semibold text-rose-600">· {money(o.balanceDue)}</span>}
      </div>
      <div className="mt-1.5">
        <OrderFlags o={o} />
      </div>
    </div>
  );
}
