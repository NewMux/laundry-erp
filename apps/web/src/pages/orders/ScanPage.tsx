import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ScanLine } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { STATUS_COLOR } from '../../lib/format';
import { feedback, useBarcodeScanner } from '../../lib/hooks';
import { Badge, Input, PageHeader, Tabs } from '../../components/ui';
import { BarcodeCamera, normalizeScanCode } from '../../components/BarcodeCamera';

type Mode = 'order' | 'piece' | 'lookup';

interface ScanResult {
  ok: boolean;
  code: string;
  at: Date;
  message?: string;
  orderId?: string;
  orderNo?: number;
  customer?: string;
  pieceNo?: number | null;
  pieceCount?: number;
  to?: string;
  moved?: number;
  status?: string;
}

const BIG_BG: Record<string, string> = {
  RECEIVED: 'bg-slate-600',
  IN_PROCESS: 'bg-sky-600',
  IRONING: 'bg-amber-500',
  READY: 'bg-emerald-600',
  DELIVERED: 'bg-slate-800',
};

/** Worker screen: scan tags with the phone camera or a USB scanner to move orders along. */
export default function ScanPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [mode, setMode] = useState<Mode>(can('tracking', 'edit') ? 'order' : 'lookup');
  const [manual, setManual] = useState('');
  const [history, setHistory] = useState<ScanResult[]>([]);
  const busy = useRef(false);

  const scan = async (raw: string) => {
    if (busy.current) return;
    busy.current = true;
    const code = await normalizeScanCode(raw, async (id) => (await api.get(`/api/orders/${id}`)).order.orderNo);
    try {
      const r = await api.post('/api/tracking/scan', { code, mode });
      feedback(true);
      setHistory((h) => [
        {
          ok: true,
          code,
          at: new Date(),
          orderId: r.order.id,
          orderNo: r.order.orderNo,
          customer: r.order.customer?.name,
          pieceNo: r.pieceNo,
          pieceCount: r.order.pieceCount,
          to: r.action === 'advanced' ? (mode === 'piece' && r.moved?.[0] ? r.moved[0].to : r.to) : undefined,
          moved: r.moved?.length,
          status: r.order.status,
        },
        ...h.slice(0, 19),
      ]);
    } catch (e) {
      feedback(false);
      setHistory((h) => [{ ok: false, code, at: new Date(), message: (e as Error).message }, ...h.slice(0, 19)]);
    } finally {
      busy.current = false;
    }
  };

  useBarcodeScanner((c) => void scan(c));
  const last = history[0];
  const shownStatus = last?.to ?? last?.status;

  return (
    <div className="mx-auto max-w-5xl p-3 md:p-6">
      <PageHeader title={t('tracking.scanTitle')} subtitle={t('tracking.scanHint')} />
      <Tabs
        className="mb-4"
        value={mode}
        onChange={setMode}
        tabs={[
          ...(can('tracking', 'edit')
            ? [
                { value: 'order' as Mode, label: t('tracking.modeOrder') },
                { value: 'piece' as Mode, label: t('tracking.modePiece') },
              ]
            : []),
          { value: 'lookup' as Mode, label: t('tracking.modeLookup') },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <BarcodeCamera onCode={(c) => void scan(c)} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) void scan(manual.trim());
              setManual('');
            }}
          >
            <div className="relative">
              <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
              <Input className="h-12 pl-10 text-lg" placeholder={t('tracking.manualCode')} value={manual} onChange={(e) => setManual(e.target.value)} />
            </div>
          </form>
        </div>

        <div className="space-y-3">
          {last && (
            <div className={clsx('rounded-2xl p-5 text-white shadow-lg', last.ok ? BIG_BG[shownStatus ?? ''] ?? 'bg-slate-700' : 'bg-rose-600')}>
              {last.ok ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <Link to={`/orders/${last.orderId}`} className="text-4xl font-black tabular-nums hover:underline">
                      #{last.orderNo}
                    </Link>
                    {last.pieceNo && (
                      <span className="text-2xl font-bold tabular-nums">
                        {last.pieceNo}/{last.pieceCount}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-lg font-medium opacity-90 bidi">{last.customer ?? ''}</div>
                  <div className="mt-4 text-sm uppercase tracking-wide opacity-80">{last.to ? t('tracking.movedTo') : t('orders.status')}</div>
                  <div className="text-3xl font-extrabold">{t(`orderStatus.${shownStatus}`)}</div>
                </>
              ) : (
                <>
                  <div className="text-xl font-bold">{last.code}</div>
                  <div className="mt-1 text-lg">{last.message}</div>
                </>
              )}
            </div>
          )}
          {history.length > 1 && (
            <div className="card p-3">
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{t('tracking.history')}</div>
              <ul className="space-y-1 text-sm">
                {history.slice(1).map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums">{h.ok ? `#${h.orderNo}${h.pieceNo ? `-${h.pieceNo}` : ''}` : h.code}</span>
                    {h.ok ? <Badge color={STATUS_COLOR[h.to ?? h.status ?? '']}>{t(`orderStatus.${h.to ?? h.status}`)}</Badge> : <span className="truncate text-rose-600">{h.message}</span>}
                    <span className="text-xs text-slate-400">{h.at.toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
