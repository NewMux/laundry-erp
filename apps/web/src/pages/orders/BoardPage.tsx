import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Search } from 'lucide-react';
import clsx from 'clsx';
import { BOARD_STATUSES } from '@laundry/shared';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDebounced } from '../../lib/hooks';
import { Badge, Input, Loading, PageHeader, Switch } from '../../components/ui';
import { OrderCard, type OrderSummary } from '../../components/orders';
import { useToast } from '../../components/toast';

const COLUMN_STYLE: Record<string, string> = {
  RECEIVED: 'bg-slate-200/70',
  IN_PROCESS: 'bg-sky-100',
  IRONING: 'bg-amber-100',
  READY: 'bg-emerald-100',
};

/** Kanban board by status. Drag a card to another column, or tap → to move it on. */
export default function BoardPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [express, setExpress] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dq = useDebounced(q, 300);
  const board = useQuery({ queryKey: ['board', dq, express], queryFn: () => api.get(`/api/tracking/board${qs({ q: dq, express: express ? 1 : '' })}`), refetchInterval: 30_000 });
  const canEdit = can('tracking', 'edit');

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status?: string }) =>
      status ? api.post(`/api/orders/${id}/status`, { status }) : api.post(`/api/orders/${id}/advance`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['board'] }),
    onError: (e) => toast.error(e),
  });

  return (
    <div className="flex h-full flex-col p-3 md:p-6">
      <PageHeader
        title={t('tracking.board')}
        subtitle={t('tracking.boardHint')}
        actions={
          <>
            <Switch checked={express} onChange={setExpress} label={t('orders.express')} />
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input className="w-56 pl-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </>
        }
      />
      {board.isLoading ? (
        <Loading />
      ) : (
        <div className="grid min-h-0 flex-1 auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
          {BOARD_STATUSES.map((status) => {
            const list: OrderSummary[] = board.data?.columns?.[status] ?? [];
            return (
              <section
                key={status}
                className={clsx('flex min-h-0 flex-col rounded-2xl p-2 transition', COLUMN_STYLE[status], dragOver === status && 'ring-2 ring-brand-400')}
                onDragOver={(e) => {
                  if (!canEdit) return;
                  e.preventDefault();
                  setDragOver(status);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData('text/order');
                  const from = e.dataTransfer.getData('text/status');
                  if (id && from !== status) move.mutate({ id, status });
                }}
              >
                <header className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{t(`orderStatus.${status}`)}</h2>
                  <Badge color="dark">{list.length}</Badge>
                </header>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {list.map((o) => (
                    <div
                      key={o.id}
                      draggable={canEdit && !o.onHold}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/order', o.id);
                        e.dataTransfer.setData('text/status', status);
                      }}
                      className={clsx(canEdit && !o.onHold && 'cursor-grab active:cursor-grabbing')}
                    >
                      <OrderCard
                        o={o}
                        action={
                          canEdit && status !== 'READY' && !o.onHold ? (
                            <button
                              className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-700 hover:bg-brand-600 hover:text-white"
                              onClick={() => move.mutate({ id: o.id })}
                              aria-label={t('orders.advance')}
                              title={t('orders.advance')}
                            >
                              <ArrowRight className="size-4" />
                            </button>
                          ) : null
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
