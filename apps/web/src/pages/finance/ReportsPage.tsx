import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BarChart3, FileSpreadsheet, FileText } from 'lucide-react';
import { api, openFile, qs } from '../../lib/api';
import { money } from '../../lib/format';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Stat } from '../../components/ui';
import { DateRange, presetRange, type Preset } from '../../components/DateRange';
import { useToast } from '../../components/toast';

interface Col {
  key: string;
  header: string;
  type?: 'text' | 'money' | 'number' | 'date' | 'percent';
}
interface Table {
  name: string;
  title?: string;
  subtitle?: string;
  columns: Col[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown> | null;
}

function cell(v: unknown, type?: Col['type']) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money') return money(Number(v));
  if (type === 'percent') return `${Number(v).toFixed(2)}%`;
  if (type === 'number') return Number(v).toLocaleString('en-US');
  return String(v);
}

export default function ReportsPage() {
  const { key } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [range, setRange] = useState<{ from: string; to: string; preset: Preset }>({ ...presetRange('thisMonth')!, preset: 'thisMonth' });
  const list = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/api/reports') });
  const reports: { key: string; title: string; group: string; canExport: boolean }[] = list.data?.reports ?? [];
  const current = reports.find((r) => r.key === key) ?? null;
  const data = useQuery({
    queryKey: ['report', key, range.from, range.to],
    queryFn: () => api.get(`/api/reports/${key}${qs({ from: range.from, to: range.to })}`),
    enabled: !!current,
  });

  if (list.isLoading) return <Loading />;
  if (!reports.length) {
    return (
      <div className="p-6">
        <Empty title={t('reports.noAccess')} />
      </div>
    );
  }

  const groups = ['sales', 'finance', 'staff'];
  const exportAs = (format: 'xlsx' | 'pdf') => {
    const url = `/api/reports/${key}${qs({ from: range.from, to: range.to, format })}`;
    if (format === 'pdf') openFile(url);
    else openFile(url, { download: `${key}_${range.from}_${range.to}.xlsx` }).catch(toast.error);
  };

  return (
    <div className="mx-auto max-w-7xl p-3 md:p-6">
      <PageHeader title={t('reports.title')} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav className={clsx('space-y-4', current && 'hidden lg:block')}>
          {groups.map((g) => {
            const items = reports.filter((r) => r.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{t(`reports.groups.${g}`)}</div>
                <div className="card divide-y divide-slate-100 overflow-hidden">
                  {items.map((r) => (
                    <Link key={r.key} to={`/reports/${r.key}`} className={clsx('flex items-center gap-2 px-3 py-2.5 text-sm font-medium', r.key === key ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50')}>
                      <BarChart3 className="size-4 shrink-0 opacity-60" />
                      {r.title}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="min-w-0">
          {!current ? (
            <div className="card hidden lg:block">
              <Empty icon={<BarChart3 className="size-10" />} title={t('reports.title')} />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <button className="text-sm text-brand-700 lg:hidden" onClick={() => navigate('/reports')}>
                    ← {t('reports.title')}
                  </button>
                  <h2 className="text-lg font-bold">{data.data?.title ?? current.title}</h2>
                  {data.data?.subtitle && <p className="text-sm text-slate-500">{data.data.subtitle}</p>}
                </div>
                {current.canExport && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="size-4 text-emerald-600" />} onClick={() => exportAs('xlsx')}>
                      {t('common.exportExcel')}
                    </Button>
                    <Button size="sm" variant="secondary" icon={<FileText className="size-4 text-rose-600" />} onClick={() => exportAs('pdf')}>
                      {t('common.exportPdf')}
                    </Button>
                  </div>
                )}
              </div>
              <DateRange {...range} onChange={setRange} />
              <ErrorBox error={data.error} />
              {data.isLoading ? (
                <Loading />
              ) : data.data ? (
                <>
                  {data.data.kpis?.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                      {data.data.kpis.map((k: { label: string; value: number; type: string }) => (
                        <Stat key={k.label} label={k.label} value={k.type === 'money' ? money(k.value) : k.value.toLocaleString('en-US')} tone={k.type === 'money' && k.value < 0 ? 'bad' : 'default'} />
                      ))}
                    </div>
                  )}
                  {(data.data.tables as Table[]).map((tb) => (
                    <Card key={tb.name} title={tb.title ?? (data.data.tables.length > 1 ? tb.name : undefined)} bodyClassName="p-0">
                      {tb.subtitle && <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{tb.subtitle}</p>}
                      <div className="overflow-x-auto">
                        <table className="table">
                          <thead>
                            <tr>
                              {tb.columns.map((c) => (
                                <th key={c.key} className={clsx(c.type && c.type !== 'text' && 'num')}>
                                  {c.header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tb.rows.length === 0 ? (
                              <tr>
                                <td colSpan={tb.columns.length} className="py-6 text-center text-slate-500">
                                  {t('reports.noData')}
                                </td>
                              </tr>
                            ) : (
                              tb.rows.map((r, i) => (
                                <tr key={i}>
                                  {tb.columns.map((c) => (
                                    <td key={c.key} className={clsx(c.type && c.type !== 'text' ? 'num' : 'bidi', c.type === 'money' && Number(r[c.key]) < 0 && 'text-rose-600')}>
                                      {cell(r[c.key], c.type)}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                          {tb.totals && tb.rows.length > 0 && (
                            <tfoot>
                              <tr className="bg-slate-50 font-bold">
                                {tb.columns.map((c) => (
                                  <td key={c.key} className={clsx('border-t border-slate-200 px-3 py-2', c.type && c.type !== 'text' && 'num')}>
                                    {cell(tb.totals![c.key], c.type)}
                                  </td>
                                ))}
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </Card>
                  ))}
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
