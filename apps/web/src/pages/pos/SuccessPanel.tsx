import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, MessageCircle, Plus, Printer, Tags } from 'lucide-react';
import { api } from '../../lib/api';
import { printOrder } from '../../lib/print';
import { Button } from '../../components/ui';
import { useToast } from '../../components/toast';

export function SuccessPanel({
  order,
  onClose,
  canWhatsapp,
  canView,
}: {
  order: { id: string; orderNo: number };
  onClose: () => void;
  canWhatsapp: boolean;
  canView: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  useEffect(() => newRef.current?.focus(), []);

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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
        <CheckCircle2 className="mx-auto size-16 text-emerald-500" />
        <div className="mt-2 text-sm font-medium uppercase tracking-wide text-slate-500">{t('pos.success')}</div>
        <div className="text-5xl font-black tabular-nums text-slate-900">#{order.orderNo}</div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" icon={<Printer className="size-5" />} loading={busy === 'r'} onClick={() => run('r', () => printOrder(order.id, { receipt: true }))}>
            {t('pos.printReceipt')}
          </Button>
          <Button variant="secondary" size="lg" icon={<Tags className="size-5" />} loading={busy === 't'} onClick={() => run('t', () => printOrder(order.id, { tags: true }))}>
            {t('pos.printTags')}
          </Button>
          {canWhatsapp && (
            <Button
              variant="secondary"
              size="lg"
              className="col-span-2"
              icon={<MessageCircle className="size-5 text-emerald-600" />}
              loading={busy === 'w'}
              onClick={() =>
                run('w', async () => {
                  const r = await api.get(`/api/orders/${order.id}/whatsapp?type=receipt`);
                  window.open(r.url, '_blank', 'noopener');
                })
              }
            >
              {t('pos.shareWhatsapp')}
            </Button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {canView && (
            <Button variant="ghost" size="lg" onClick={() => navigate(`/orders/${order.id}`)}>
              {t('pos.viewOrder')}
            </Button>
          )}
          <Button ref={newRef} size="lg" icon={<Plus className="size-5" />} className={canView ? '' : 'col-span-2'} onClick={onClose}>
            {t('pos.newOrder')}
          </Button>
        </div>
      </div>
    </div>
  );
}
