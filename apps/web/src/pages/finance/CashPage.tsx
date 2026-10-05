import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Lock, LockOpen } from 'lucide-react';
import { fromFils, toFils } from '@laundry/shared';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, dateTime, money, parseMoney } from '../../lib/format';
import { Badge, Button, Card, ConfirmModal, Field, Input, Loading, Modal, MoneyInput, PageHeader, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';

/** Daily cash closing: expected vs counted cash; closing locks the day. */
export default function CashPage() {
  const { t } = useTranslation();
  const { can, readOnly, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [day, setDay] = useState<string>('');
  const [float, setFloat] = useState<string>('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const q = useQuery({ queryKey: ['cash', day, float], queryFn: () => api.get(`/api/finance/cash${qs({ date: day, openingFloat: float === '' ? undefined : parseMoney(float) })}`) });
  const history = useQuery({ queryKey: ['cash-history'], queryFn: () => api.get('/api/finance/cash/history') });
  const s = q.data?.summary;
  useEffect(() => {
    if (s && float === '' && !s.closed) setFloat(String(s.openingFloat));
    if (s && !day) setDay(s.businessDate);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const difference = s && counted !== '' ? fromFils(toFils(parseMoney(counted)) - toFils(s.expectedCash)) : null;

  const close = useMutation({
    mutationFn: () => api.post('/api/finance/cash/close', { date: s.businessDate, openingFloat: parseMoney(float), countedCash: parseMoney(counted), reason: reason || null }),
    onSuccess: () => {
      toast.success(t('finance.dayClosed'));
      setConfirm(false);
      setCounted('');
      setReason('');
      void qc.invalidateQueries({ queryKey: ['cash'] });
      void qc.invalidateQueries({ queryKey: ['cash-history'] });
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(e);
    },
  });
  const doReopen = useMutation({
    mutationFn: () => api.post('/api/finance/cash/reopen', { date: s.businessDate, reason: reopenReason }),
    onSuccess: () => {
      setReopen(false);
      void qc.invalidateQueries({ queryKey: ['cash'] });
      void qc.invalidateQueries({ queryKey: ['cash-history'] });
    },
    onError: (e) => toast.error(e),
  });

  if (q.isLoading || !s) return <Loading />;
  const line = (label: string, value: number, sign = '') => (
    <div className="flex justify-between py-1.5">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium tabular-nums">
        {sign}
        {money(value)}
      </span>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl p-3 md:p-6">
      <PageHeader
        title={t('finance.cash')}
        actions={
          <Field label={t('finance.businessDate')}>
            <Input type="date" value={day} onChange={(e) => { setDay(e.target.value); setFloat(''); }} />
          </Field>
        }
      />
      {s.closed && q.data.currentBusinessDate > s.businessDate && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">{t('finance.nextDayNote', { date: date(q.data.currentBusinessDate) })}</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              {date(s.businessDate)} {s.closed ? <Badge color="dark"><Lock className="size-3" /> {t('finance.locked')}</Badge> : <Badge color="green">{t('common.active')}</Badge>}
            </span>
          }
        >
          <div className="divide-y divide-slate-100 text-sm">
            {s.closed ? line(t('finance.openingFloat'), s.openingFloat) : (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-slate-600">{t('finance.openingFloat')}</span>
                <div className="w-40">
                  <MoneyInput value={float} onChange={setFloat} />
                </div>
              </div>
            )}
            {line(t('finance.cashSales'), s.cashSales, '+ ')}
            {line(t('finance.cashTopups'), s.cashTopups, '+ ')}
            {line(t('finance.cashRefunds'), s.cashRefunds, '− ')}
            {line(t('finance.cashExpenses'), s.cashExpenses, '− ')}
            <div className="flex justify-between py-2 text-lg font-bold">
              <span>{t('finance.expectedCash')}</span>
              <span className="tabular-nums">BHD {money(s.expectedCash)}</span>
            </div>
          </div>
          {s.otherMethods.length > 0 && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="mb-1 text-xs font-semibold text-slate-500">{t('finance.otherMethods')}</div>
              {s.otherMethods.map((m: any) => (
                <div key={m.method} className="flex justify-between">
                  <span>{t(`paymentMethod.${m.method}`)}</span>
                  <span className="tabular-nums">{money(m.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={s.closed ? t('finance.dayClosed') : t('finance.closeDay')}>
          {s.closed ? (
            <div className="space-y-2 text-sm">
              {line(t('finance.countedCash'), s.countedCash)}
              <div className={clsx('flex justify-between py-1.5 font-semibold', s.difference !== 0 ? 'text-rose-700' : 'text-emerald-700')}>
                <span>{t('finance.difference')}</span>
                <span className="tabular-nums">{money(s.difference)}</span>
              </div>
              {s.reason && <p className="rounded-lg bg-slate-50 p-2 bidi">{s.reason}</p>}
              <p className="text-xs text-slate-500">{t('finance.closedBy', { name: s.closedByName, time: dateTime(s.closedAt) })}</p>
              {me?.isOwner && !readOnly && (
                <Button variant="ghost" icon={<LockOpen className="size-4" />} onClick={() => setReopen(true)}>
                  {t('finance.reopen')}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Field label={t('finance.countedCash')}>
                <MoneyInput className="h-12 text-lg" value={counted} onChange={setCounted} />
              </Field>
              {difference !== null && (
                <div className={clsx('flex justify-between rounded-lg px-3 py-2 font-semibold', difference === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
                  <span>{t('finance.difference')}</span>
                  <span className="tabular-nums">{money(difference)}</span>
                </div>
              )}
              {difference !== null && difference !== 0 && (
                <Field label={t('finance.differenceReason')}>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              )}
              <Button
                size="lg"
                block
                icon={<Lock className="size-4" />}
                disabled={counted === '' || (difference !== 0 && !reason.trim()) || !can('cash_closing', 'create') || readOnly}
                onClick={() => setConfirm(true)}
              >
                {t('finance.closeDay')}
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card title={t('finance.history')} className="mt-4" bodyClassName="p-0 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              <th className="num">{t('finance.expectedCash')}</th>
              <th className="num">{t('finance.countedCash')}</th>
              <th className="num">{t('finance.difference')}</th>
              <th>{t('common.reason')}</th>
              <th>{t('common.by')}</th>
            </tr>
          </thead>
          <tbody>
            {(history.data?.closings ?? []).map((c: any) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => { setDay(c.businessDate); setFloat(''); }}>
                <td>{date(c.businessDate)}</td>
                <td className="num">{money(c.expectedCash)}</td>
                <td className="num">{money(c.countedCash)}</td>
                <td className={clsx('num font-semibold', Number(c.difference) !== 0 && 'text-rose-600')}>{money(c.difference)}</td>
                <td className="max-w-xs truncate text-slate-600 bidi">{c.reason}</td>
                <td className="text-slate-600">{c.closedByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} onConfirm={() => close.mutate()} loading={close.isPending} title={t('finance.closeDay')} confirmLabel={t('finance.closeDay')}>
        <p className="text-sm text-slate-600">{t('finance.closeConfirm')}</p>
      </ConfirmModal>
      <Modal
        open={reopen}
        onClose={() => setReopen(false)}
        size="sm"
        title={t('finance.reopen')}
        footer={<Button variant="danger" disabled={reopenReason.trim().length < 3} loading={doReopen.isPending} onClick={() => doReopen.mutate()}>{t('finance.reopen')}</Button>}
      >
        <Field label={t('finance.reopenReason')}>
          <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
