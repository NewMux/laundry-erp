import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, FileSpreadsheet, Plus, Search, Upload, Users } from 'lucide-react';
import { api, openFile, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, money, phone } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Badge, Button, Empty, ErrorBox, Input, Loading, Modal, PageHeader, Tabs } from '../../components/ui';
import { useToast } from '../../components/toast';
import { Pager } from '../orders/OrdersPage';
import { CustomerFormModal } from './CustomerForm';

type Filter = 'all' | 'balance' | 'credit' | 'outstanding';

export default function CustomersPage() {
  const { t } = useTranslation();
  const { can, hasCap, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q, 300);
  const list = useQuery({ queryKey: ['customers', dq, filter, page], queryFn: () => api.get(`/api/customers${qs({ q: dq, filter, page, pageSize: 50 })}`) });

  const create = useMutation({
    mutationFn: (v: Record<string, unknown>) => api.post('/api/customers', v),
    onSuccess: (r) => {
      toast.success(t('customers.created'));
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ['customers'] });
      navigate(`/customers/${r.customer.id}`);
    },
  });

  const doImport = async (f: File) => {
    try {
      const r = await api.upload('/api/customers/import', f);
      setImportResult(r);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const rows: any[] = list.data?.customers ?? [];
  const showPhone = hasCap('viewCustomerPhone');

  return (
    <div className="mx-auto max-w-7xl p-3 md:p-6">
      <PageHeader
        title={t('customers.title')}
        actions={
          <>
            {can('customers', 'export') && (
              <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => openFile(`/api/customers/export${qs({ q: dq, filter, format: 'xlsx' })}`, { download: 'customers.xlsx' }).catch(toast.error)}>
                {t('common.export')}
              </Button>
            )}
            {can('customers', 'create') && !readOnly && (
              <>
                <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
                  {t('common.import')}
                </Button>
                <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  {t('customers.new')}
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder={t('customers.searchPlaceholder')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Tabs value={filter} onChange={(f) => { setFilter(f); setPage(1); }} tabs={(['all', 'balance', 'credit', 'outstanding'] as Filter[]).map((f) => ({ value: f, label: t(`customers.filters.${f}`) }))} />
      </div>
      <ErrorBox error={list.error} />
      {list.isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <div className="card">
          <Empty icon={<Users className="size-10" />} title={t('customers.noCustomers')} />
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('customers.name')}</th>
                  {showPhone && <th>{t('customers.mobile')}</th>}
                  <th className="num">{t('customers.orders')}</th>
                  <th className="num">{t('customers.totalSpent')}</th>
                  <th className="num">{t('customers.wallet')}</th>
                  <th className="num">{t('customers.outstanding')}</th>
                  <th>{t('customers.lastVisit')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>
                    <td>
                      <div className="font-medium bidi">{c.name}</div>
                      <div className="flex gap-1">
                        {c.type === 'COMPANY' && <Badge color="blue">{t('customers.COMPANY')}</Badge>}
                        {c.creditEnabled && <Badge color="purple">{t('customers.credit')}</Badge>}
                      </div>
                    </td>
                    {showPhone && <td className="whitespace-nowrap">{phone(c.mobile)}</td>}
                    <td className="num">{c.orders}</td>
                    <td className="num">{money(c.totalSpent)}</td>
                    <td className="num">{Number(c.walletPaid) + Number(c.walletBonus) > 0 ? money(Number(c.walletPaid) + Number(c.walletBonus)) : '—'}</td>
                    <td className="num">{c.outstanding > 0 ? <span className="font-semibold text-rose-600">{money(c.outstanding)}</span> : '—'}</td>
                    <td className="whitespace-nowrap text-slate-600">{date(c.lastVisit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={50} total={list.data?.total ?? 0} onPage={setPage} />
        </>
      )}

      <CustomerFormModal open={creating} title={t('customers.new')} onClose={() => setCreating(false)} onSubmit={(v) => create.mutate(v)} loading={create.isPending} error={create.error} />

      <Modal open={importing} onClose={() => { setImporting(false); setImportResult(null); }} title={t('customers.import')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('customers.importHint')}</p>
          <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => openFile('/api/customers/import-template', { download: 'customer-import-template.xlsx' }).catch(toast.error)}>
            {t('customers.downloadTemplate')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
          <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
            {t('common.upload')}
          </Button>
          {importResult && (
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="font-semibold">{t('customers.importResult', { created: importResult.created, skipped: importResult.skipped, errors: importResult.errors.length })}</div>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-rose-700">
                  {importResult.errors.map((e: any, i: number) => (
                    <li key={i}>{t('customers.importRow', { row: e.row, message: e.message })}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
