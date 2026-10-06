import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FileText, RefreshCw } from 'lucide-react';
import { addMonths, bhDate } from '@laundry/shared';
import { api, openFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, money } from '../../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select } from '../../components/ui';
import { useToast } from '../../components/toast';

/** Monthly payroll: basic + allowances − deductions − advances = net; paying posts Salaries expenses. */
export default function PayrollPage() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [month, setMonth] = useState(addMonths(bhDate().slice(0, 7), 0));
  const [runId, setRunId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payDate, setPayDate] = useState(bhDate());
  const [method, setMethod] = useState('BANK_TRANSFER');
  const runs = useQuery({ queryKey: ['payroll-runs'], queryFn: () => api.get('/api/payroll/runs') });
  const run = useQuery({ queryKey: ['payroll-run', runId], queryFn: () => api.get(`/api/payroll/runs/${runId}`), enabled: !!runId });

  const prepare = useMutation({
    mutationFn: (m: string) => api.post('/api/payroll/runs', { month: m }),
    onSuccess: (r) => {
      setRunId(r.run.id);
      void qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      qc.setQueryData(['payroll-run', r.run.id], { run: r.run });
    },
    onError: (e) => toast.error(e),
  });
  const pay = useMutation({
    mutationFn: () => api.post(`/api/payroll/runs/${runId}/pay`, { date: payDate, method }),
    onSuccess: (r) => {
      toast.success(t('payroll.paid'));
      setPaying(false);
      qc.setQueryData(['payroll-run', runId], { run: r.run });
      void qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      void qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e) => toast.error(e),
  });

  const current = run.data?.run;
  const sum = (k: string) => (current?.items ?? []).reduce((s: number, i: any) => s + Number(i[k]), 0);

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <PageHeader
        title={t('payroll.title')}
        actions={
          can('payroll', 'create') &&
          !readOnly && (
            <div className="flex items-end gap-2">
              <Field label={t('payroll.month')}>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </Field>
              <Button loading={prepare.isPending} onClick={() => prepare.mutate(month)}>
                {t('payroll.prepare')}
              </Button>
            </div>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card bodyClassName="p-0">
          {runs.isLoading ? (
            <Loading />
          ) : !runs.data?.runs?.length ? (
            <Empty title={t('payroll.noRuns')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {runs.data.runs.map((r: any) => (
                <li key={r.id}>
                  <button onClick={() => setRunId(r.id)} className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-slate-50 ${runId === r.id ? 'bg-brand-50' : ''}`}>
                    <span className="font-semibold">{r.month}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-600">{money(r.totalNet)}</span>
                      <Badge color={r.status === 'PAID' ? 'green' : 'amber'}>{t(`payroll.status.${r.status}`)}</Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          {!current ? (
            <div className="card">
              <Empty title={t('payroll.title')}>{t('payroll.payHint')}</Empty>
            </div>
          ) : (
            <Card
              title={
                <span className="flex items-center gap-2">
                  {current.month} <Badge color={current.status === 'PAID' ? 'green' : 'amber'}>{t(`payroll.status.${current.status}`)}</Badge>
                  {current.paidDate && <span className="text-xs font-normal text-slate-500">{date(current.paidDate)} · {t(`paymentMethod.${current.paymentMethod}`)}</span>}
                </span>
              }
              actions={
                current.status === 'DRAFT' &&
                !readOnly && (
                  <>
                    {can('payroll', 'create') && (
                      <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={prepare.isPending} onClick={() => prepare.mutate(current.month)}>
                        {t('payroll.recalculate')}
                      </Button>
                    )}
                    {can('payroll', 'edit') && (
                      <Button size="sm" variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => setPaying(true)}>
                        {t('payroll.markPaid')}
                      </Button>
                    )}
                  </>
                )
              }
              bodyClassName="p-0 overflow-x-auto"
            >
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('payroll.employee')}</th>
                    <th className="num">{t('payroll.daysWorked')}</th>
                    <th className="num">{t('payroll.basic')}</th>
                    <th className="num">{t('payroll.allowances')}</th>
                    <th className="num">{t('payroll.deductions')}</th>
                    <th className="num">{t('payroll.advances')}</th>
                    <th className="num">{t('payroll.net')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {current.items.map((i: any) => (
                    <tr key={i.id}>
                      <td>
                        <div className="font-medium bidi">{i.employeeName}</div>
                        {i.position && <div className="text-xs text-slate-500">{i.position}</div>}
                      </td>
                      <td className="num">
                        {i.daysWorked ?? '—'}
                        {Number(i.unpaidLeaveDays) > 0 && <div className="text-xs text-rose-600">−{t('common.daysShort', { count: Number(i.unpaidLeaveDays) })}</div>}
                      </td>
                      <td className="num">{money(i.basic)}</td>
                      <td className="num">{money(i.allowances)}</td>
                      <td className="num">{Number(i.deductions) ? `−${money(i.deductions)}` : '—'}</td>
                      <td className="num">{Number(i.advances) ? `−${money(i.advances)}` : '—'}</td>
                      <td className="num font-bold">{money(i.net)}</td>
                      <td className="text-right">
                        <button className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={() => openFile(`/api/documents/payslip/${i.id}`)}>
                          <FileText className="size-3.5" /> {t('payroll.payslip')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td className="px-3 py-2">{t('common.total')}</td>
                    <td />
                    <td className="num px-3 py-2">{money(sum('basic'))}</td>
                    <td className="num px-3 py-2">{money(sum('allowances'))}</td>
                    <td className="num px-3 py-2">{money(sum('deductions'))}</td>
                    <td className="num px-3 py-2">{money(sum('advances'))}</td>
                    <td className="num px-3 py-2">{money(current.totalNet)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}
        </div>
      </div>
      <Modal open={paying} onClose={() => setPaying(false)} size="sm" title={t('payroll.markPaid')} footer={<Button variant="success" loading={pay.isPending} onClick={() => pay.mutate()}>{t('payroll.markPaid')}</Button>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('payroll.payHint')}</p>
          <Field label={t('payroll.payDate')}>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </Field>
          <Field label={t('common.method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {['BANK_TRANSFER', 'CASH', 'BENEFIT_PAY', 'CARD'].map((x) => (
                <option key={x} value={x}>
                  {t(`paymentMethod.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            {t('payroll.totalNet')}: <b>BHD {money(current?.totalNet)}</b>
          </div>
        </div>
      </Modal>
    </div>
  );
}
