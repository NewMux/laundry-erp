import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { bhTime } from '@laundry/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { feedback } from '../lib/hooks';

/** A ready order whose customer said from the app that they are waiting outside in their car. */
export interface OutsideOrder {
  id: string;
  orderNo: number | null;
  curbsidePlate: string | null;
  curbsideAt: string | null;
  customer: { id: string; name: string; mobile?: string } | null;
}

// Someone is sitting in a car: check often.
const POLL_MS = 15_000;

export const outsideSince = (at: string | null | undefined) => (at ? bhTime(new Date(at)) : '');

/** Customers waiting outside right now, oldest first. Shared by the banner and the Outside tab. */
export function useOutside(enabled = true) {
  return useQuery({
    queryKey: ['app-orders', 'outside'],
    queryFn: () => api.get<{ orders: OutsideOrder[] }>('/api/orders/app?view=outside'),
    refetchInterval: POLL_MS,
    enabled,
  });
}

/**
 * On every page: who is waiting outside, so whoever is at the counter can take the order out.
 * Beeps once when someone new pulls up (or gives a different car).
 */
export function CurbsideBanner() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const q = useOutside(can('pos', 'view') || can('tracking', 'view') || can('delivery', 'view'));
  const data = q.data;
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const keys = data.orders.map((o) => `${o.id}:${o.curbsideAt}`);
    if (seen.current && keys.some((k) => !seen.current!.has(k))) feedback(true);
    seen.current = new Set(keys);
  }, [data]);

  const orders = data?.orders ?? [];
  if (!orders.length) return null;
  const first = orders[0];
  return (
    <Link to="/orders/app?view=outside" className="no-print flex items-center gap-2 bg-amber-300 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-200">
      <Car className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <bdi>{t('handover.outside.banner', { no: first.orderNo ?? '', plate: first.curbsidePlate ?? '', name: first.customer?.name ?? '—' })}</bdi>
        {orders.length > 1 && ` ${t('handover.outside.more', { count: orders.length - 1 })}`}
      </span>
      <span className="shrink-0 underline">{t('handover.outside.see')}</span>
    </Link>
  );
}

/** The car number, large enough to read across the shop. */
export function CarPlate({ plate, at }: { plate: string; at?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
      <Car className="size-6 shrink-0 text-amber-700" />
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-amber-800">{t('handover.outside.car')}</div>
        <div className="font-mono text-2xl font-bold tracking-wider text-slate-900">
          <bdi>{plate}</bdi>
        </div>
        {at && <div className="text-xs text-amber-800">{t('handover.outside.since', { time: outsideSince(at) })}</div>}
      </div>
    </div>
  );
}
