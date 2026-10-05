import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lock, Paperclip, Plus, Repeat, Search, Trash2, Upload } from 'lucide-react';
import { bhDate } from '@laundry/shared';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, money } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Badge, Button, Card, ConfirmModal, Empty, ErrorBox, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, Switch, Tabs, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';

type Tab = 'list' | 'recurring' | 'categories';

export default function ExpensesPage() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const today = bhDate();
  const [tab, setTab] = useState<Tab>('list');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [newCat, setNewCat] = useState('');

  const cats = useQuery({ queryKey: ['expense-categories'], queryFn: () => api.get('/api/finance/categories') });
  const list = useQuery({ queryKey: ['expenses', from, to, categoryId, dq], queryFn: () => api.get(`/api/finance/expenses${qs({ from, to, categoryId, q: dq })}`), enabled: tab === 'list' });
  const recurring = useQuery({ queryKey: ['recurring'], queryFn: () => api.get('/api/finance/recurring'), enabled: tab === 'recurring' });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/finance/expenses/${id}`),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e) => toast.error(e),
  });
  const addCat = useMutation({
    mutationFn: () => api.post('/api/finance/categories', { name: newCat }),
    onSuccess: () => {
      setNewCat('');
      void qc.invalidateQueries({ queryKey: ['expense-categories'] });
    },
    onError: (e) => toast.error(e),
  });
  const patchCat = useMutation({
    mutationFn: ({ id, ...body }: { id: string; isActive?: boolean; name?: string }) => api.patch(`/api/finance/categories/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['expense-categories'] }),
    onError: (e) => toast.error(e),
  });
  const patchRec = useMutation({
    mutationFn: ({ id, ...body }: { id: string; isActive: boolean }) => api.patch(`/api/finance/recurring/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['recurring'] }),
    onError: (e) => toast.error(e),
  });

  const categories: any[] = cats.data?.categories ?? [];

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <PageHeader
        title={t('finance.expenses')}
        actions={
          can('expenses', 'create') && !readOnly ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing({})}>
              {t('finance.newExpense')}
            </Button>
          ) : null
        }
      />
      <Tabs
        className="mb-3"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'list', label: t('finance.expenses') },
          { value: 'recurring', label: t('finance.recurringList') },
          { value: 'categories', label: t('finance.categories') },
        ]}
      />

      {tab === 'list' && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Field label={t('common.from')}>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('common.to')}>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label={t('finance.category')}>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('common.all')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <ErrorBox error={list.error} />
          {list.isLoading ? (
            <Loading />
          ) : !list.data?.expenses?.length ? (
            <div className="card">
              <Empty title={t('finance.noExpenses')} />
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('finance.category')}</th>
                    <th>{t('finance.vendor')}</th>
                    <th>{t('common.notes')}</th>
                    <th>{t('common.method')}</th>
                    <th className="num">{t('common.amount')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.expenses.map((e: any) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">{date(e.date)}</td>
                      <td>
                        {e.category.name} {e.recurringId && <Repeat className="inline size-3 text-slate-400" />}
                      </td>
                      <td className="bidi">{e.vendor}</td>
                      <td className="max-w-xs truncate text-slate-600 bidi">{e.notes}</td>
                      <td className="whitespace-nowrap">{t(`paymentMethod.${e.method}`)}</td>
                      <td className="num font-semibold">{money(e.amount)}</td>
                      <td className="whitespace-nowrap text-right">
                        {e.attachmentIds.map((id: string) => (
                          <a key={id} href={`/api/files/${id}`} target="_blank" rel="noreferrer" className="mr-2 inline-block text-slate-500 hover:text-slate-800" aria-label={t('finance.attachment')}>
                            <Paperclip className="size-4" />
                          </a>
                        ))}
                        {e.locked ? (
                          <span title={e.payrollRunId || e.employeeId ? t('finance.salaryLocked') : t('finance.locked')}>
                            <Lock className="inline size-4 text-slate-400" />
                          </span>
                        ) : (
                          !readOnly && (
                            <>
                              {can('expenses', 'edit') && (
                                <button className="mr-2 text-sm text-brand-700 hover:underline" onClick={() => setEditing(e)}>
                                  {t('common.edit')}
                                </button>
                              )}
                              {can('expenses', 'delete') && (
                                <button className="text-rose-600" onClick={() => setDeleting(e)} aria-label={t('common.delete')}>
                                  <Trash2 className="inline size-4" />
                                </button>
                              )}
                            </>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={5} className="px-3 py-2">
                      {t('finance.total')} ({list.data.total})
                    </td>
                    <td className="num px-3 py-2">{money(list.data.sum)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'recurring' && (
        <div className="card overflow-x-auto">
          {recurring.isLoading ? (
            <Loading />
          ) : !recurring.data?.recurring?.length ? (
            <Empty title={t('common.noResults')} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('finance.category')}</th>
                  <th>{t('finance.vendor')}</th>
                  <th>{t('finance.repeat')}</th>
                  <th>{t('finance.nextDate')}</th>
                  <th className="num">{t('common.amount')}</th>
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {recurring.data.recurring.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.categoryName}</td>
                    <td className="bidi">{r.vendor ?? r.notes}</td>
                    <td>{t(`finance.${r.frequency}`)}</td>
                    <td>{date(r.nextDate)}</td>
                    <td className="num">{money(r.amount)}</td>
                    <td>
                      <Switch checked={r.isActive} disabled={!can('expenses', 'edit') || readOnly} onChange={(v) => patchRec.mutate({ id: r.id, isActive: v })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'categories' && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span className="flex items-center gap-2">
                  {c.name} {c.isSystem && <Badge>{t('finance.system')}</Badge>}
                </span>
                {!c.isSystem && <Switch checked={c.isActive} disabled={!can('expenses', 'edit') || readOnly} onChange={(v) => patchCat.mutate({ id: c.id, isActive: v })} />}
              </li>
            ))}
          </ul>
          {can('expenses', 'edit') && !readOnly && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newCat.trim()) addCat.mutate();
              }}
            >
              <Input placeholder={t('finance.addCategory')} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
              <Button type="submit" loading={addCat.isPending}>
                {t('common.add')}
              </Button>
            </form>
          )}
        </Card>
      )}

      <ExpenseModal expense={editing} categories={categories.filter((c) => c.isActive)} onClose={() => setEditing(null)} />
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => del.mutate(deleting.id)} loading={del.isPending} danger title={t('common.delete')} confirmLabel={t('common.delete')}>
        {deleting && `${deleting.category?.name} · ${money(deleting.amount)} · ${date(deleting.date)}`}
      </ConfirmModal>
    </div>
  );
}

function ExpenseModal({ expense, categories, onClose }: { expense: any | null; categories: any[]; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = !expense?.id;
  const [v, setV] = useState<any>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [init, setInit] = useState<any>(null);
  if (expense !== init) {
    setInit(expense);
    setV(
      expense
        ? {
            categoryId: expense.categoryId ?? categories[0]?.id ?? '',
            amount: expense.amount ? String(expense.amount) : '',
            date: expense.date ?? bhDate(),
            method: expense.method ?? 'CASH',
            vendor: expense.vendor ?? '',
            notes: expense.notes ?? '',
            attachmentIds: expense.attachmentIds ?? [],
            repeat: '',
            endDate: '',
          }
        : {},
    );
  }
  const save = useMutation({
    mutationFn: () => {
      const body = {
        categoryId: v.categoryId,
        amount: Number(v.amount),
        date: v.date,
        method: v.method,
        vendor: v.vendor || null,
        notes: v.notes || null,
        attachmentIds: v.attachmentIds,
        ...(isNew && v.repeat ? { recurring: { frequency: v.repeat, endDate: v.endDate || null } } : {}),
      };
      return isNew ? api.post('/api/finance/expenses', body) : api.patch(`/api/finance/expenses/${expense.id}`, body);
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['recurring'] });
      onClose();
    },
  });
  const upload = async (f: File) => {
    setUploading(true);
    try {
      const r = await api.upload('/api/files/upload/expense', f);
      setV((x: any) => ({ ...x, attachmentIds: [...x.attachmentIds, r.id] }));
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };
  return (
    <Modal
      open={!!expense}
      onClose={onClose}
      title={isNew ? t('finance.newExpense') : t('finance.editExpense')}
      footer={
        <Button loading={save.isPending} disabled={!v.categoryId || !(Number(v.amount) > 0)} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('finance.category')}>
            <Select value={v.categoryId ?? ''} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.amount')}>
            <MoneyInput value={v.amount ?? ''} onChange={(x) => setV({ ...v, amount: x })} autoFocus />
          </Field>
          <Field label={t('common.date')}>
            <Input type="date" value={v.date ?? ''} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          <Field label={t('common.method')}>
            <Select value={v.method ?? 'CASH'} onChange={(e) => setV({ ...v, method: e.target.value })}>
              {['CASH', 'CARD', 'BENEFIT_PAY', 'BANK_TRANSFER'].map((x) => (
                <option key={x} value={x}>
                  {t(`paymentMethod.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('finance.vendor')}>
          <Input value={v.vendor ?? ''} onChange={(e) => setV({ ...v, vendor: e.target.value })} />
        </Field>
        <Field label={t('common.notes')}>
          <Textarea value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <div>
          <div className="label">{t('finance.attachment')}</div>
          <div className="flex flex-wrap items-center gap-2">
            {(v.attachmentIds ?? []).map((id: string) => (
              <a key={id} href={`/api/files/${id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs">
                <Paperclip className="size-3" /> {id.slice(0, 6)}
              </a>
            ))}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            <Button size="sm" variant="secondary" loading={uploading} icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
              {t('common.upload')}
            </Button>
          </div>
        </div>
        {isNew && (
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
            <Field label={t('finance.repeat')}>
              <Select value={v.repeat ?? ''} onChange={(e) => setV({ ...v, repeat: e.target.value })}>
                <option value="">{t('finance.noRepeat')}</option>
                <option value="WEEKLY">{t('finance.WEEKLY')}</option>
                <option value="MONTHLY">{t('finance.MONTHLY')}</option>
                <option value="YEARLY">{t('finance.YEARLY')}</option>
              </Select>
            </Field>
            {v.repeat && (
              <Field label={`${t('finance.endDate')} (${t('common.optional')})`}>
                <Input type="date" value={v.endDate ?? ''} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
              </Field>
            )}
          </div>
        )}
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
