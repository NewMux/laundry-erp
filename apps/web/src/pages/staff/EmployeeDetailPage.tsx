import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { bhDate } from '@laundry/shared';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, money } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';
import { EmployeeFormModal } from './EmployeeForm';

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<null | 'edit' | 'doc' | 'adj' | 'leave'>(null);
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => api.get(`/api/staff/employees/${id}`) });
  const adjustments = useQuery({ queryKey: ['adjustments', id], queryFn: () => api.get(`/api/staff/adjustments${qs({ employeeId: id })}`), enabled: can('payroll') });
  const year = Number(bhDate().slice(0, 4));
  const leave = useQuery({ queryKey: ['leave', id, year], queryFn: () => api.get(`/api/staff/leave${qs({ employeeId: id, year })}`) });
  const e = q.data?.employee;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['employee', id] });
    void qc.invalidateQueries({ queryKey: ['adjustments', id] });
    void qc.invalidateQueries({ queryKey: ['leave', id] });
    void qc.invalidateQueries({ queryKey: ['staff-alerts'] });
  };
  const update = useMutation({
    mutationFn: (v: any) => api.patch(`/api/staff/employees/${id}`, v),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setDialog(null);
      refresh();
    },
  });
  const delDoc = useMutation({ mutationFn: (docId: string) => api.del(`/api/staff/documents/${docId}`), onSuccess: refresh, onError: (x) => toast.error(x) });
  const delAdj = useMutation({ mutationFn: (adjId: string) => api.del(`/api/staff/adjustments/${adjId}`), onSuccess: refresh, onError: (x) => toast.error(x) });
  const delLeave = useMutation({ mutationFn: (lid: string) => api.del(`/api/staff/leave/${lid}`), onSuccess: refresh, onError: (x) => toast.error(x) });

  if (q.isLoading) return <Loading />;
  if (!e) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const bal = leave.data?.balances?.[0];
  const canEdit = can('staff', 'edit') && !readOnly;

  const info: [string, string | null | undefined][] = [
    [t('staff.position'), e.position],
    [t('staff.phone'), e.phone],
    [t('staff.nationality'), e.nationality],
    [t('staff.cpr'), e.cpr],
    [t('staff.cprExpiry'), date(e.cprExpiry)],
    [t('staff.passportNo'), e.passportNo],
    [t('staff.passportExpiry'), date(e.passportExpiry)],
    [t('staff.visaExpiry'), date(e.visaExpiry)],
    [t('staff.joinDate'), date(e.joinDate)],
  ];

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {t('common.back')}
          </button>
        }
        title={<span className="bidi">{e.name}</span>}
        subtitle={e.user ? `${t('staff.login')}: ${e.user.username}` : t('staff.noLogin')}
        actions={
          canEdit && (
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setDialog('edit')}>
              {t('common.edit')}
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('staff.employees')}>
          <dl className="space-y-1.5 text-sm">
            {info.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right font-medium bidi">{v || '—'}</dd>
              </div>
            ))}
            {e.basicSalary !== undefined && (
              <>
                <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
                  <dt className="text-slate-500">{t('staff.basicSalary')}</dt>
                  <dd className="font-semibold tabular-nums">{money(e.basicSalary)}</dd>
                </div>
                {(e.allowances ?? []).map((a: any) => (
                  <div key={a.name} className="flex justify-between gap-2">
                    <dt className="text-slate-500">{a.name}</dt>
                    <dd className="tabular-nums">{money(a.amount)}</dd>
                  </div>
                ))}
              </>
            )}
          </dl>
          {e.notes && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm bidi">{e.notes}</p>}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card
            title={t('staff.documents')}
            actions={canEdit && <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} onClick={() => setDialog('doc')}>{t('staff.addDocument')}</Button>}
            bodyClassName="p-0"
          >
            {!e.documents.length ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{t('common.noResults')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {e.documents.map((d: any) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <FileText className="size-4 text-slate-400" />
                    <a href={`/api/files/${d.fileId}`} target="_blank" rel="noreferrer" className="flex-1 font-medium text-brand-700 hover:underline">
                      {t(`staff.docTypes.${d.type}`)} {d.note && <span className="font-normal text-slate-500">· {d.note}</span>}
                    </a>
                    {d.expiryDate && <Badge color={d.expiryDate < bhDate() ? 'red' : 'gray'}>{date(d.expiryDate)}</Badge>}
                    {canEdit && (
                      <button className="text-slate-400 hover:text-rose-600" onClick={() => delDoc.mutate(d.id)} aria-label={t('common.delete')}>
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {can('payroll') && (
            <Card
              title={t('staff.adjustments')}
              actions={can('payroll', 'create') && !readOnly && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setDialog('adj')}>{t('staff.newAdjustment')}</Button>}
              bodyClassName="p-0"
            >
              {!adjustments.data?.adjustments?.length ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">{t('common.noResults')}</p>
              ) : (
                <table className="table">
                  <tbody>
                    {adjustments.data.adjustments.map((a: any) => (
                      <tr key={a.id}>
                        <td>{date(a.date)}</td>
                        <td>
                          <Badge color={a.type === 'ADVANCE' ? 'blue' : 'orange'}>{t(`staff.${a.type}`)}</Badge>
                        </td>
                        <td className="text-slate-600 bidi">{a.note}</td>
                        <td className="num font-semibold">{money(a.amount)}</td>
                        <td className="text-right">
                          {a.payrollItemId ? (
                            <Badge color="green">{t('staff.settled')}</Badge>
                          ) : (
                            can('payroll', 'delete') && !readOnly && (
                              <button className="text-slate-400 hover:text-rose-600" onClick={() => delAdj.mutate(a.id)} aria-label={t('common.delete')}>
                                <Trash2 className="size-4" />
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          <Card
            title={`${t('staff.leaveTitle')} ${year}`}
            actions={canEdit && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setDialog('leave')}>{t('staff.newLeave')}</Button>}
          >
            {bal && (
              <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">{t('staff.leaveTypes.ANNUAL')}</div>
                  <div className="text-lg font-bold">{bal.annual.balance}</div>
                  <div className="text-xs text-slate-500">
                    {t('staff.used')} {bal.annual.used} / {bal.annual.entitlement}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">{t('staff.leaveTypes.SICK')}</div>
                  <div className="text-lg font-bold">{bal.sick.balance}</div>
                  <div className="text-xs text-slate-500">
                    {t('staff.used')} {bal.sick.used} / {bal.sick.entitlement}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">{t('staff.leaveTypes.UNPAID')}</div>
                  <div className="text-lg font-bold">{bal.unpaid.used}</div>
                  <div className="text-xs text-slate-500">{t('staff.used')}</div>
                </div>
              </div>
            )}
            <ul className="divide-y divide-slate-100 text-sm">
              {(leave.data?.records ?? []).map((l: any) => (
                <li key={l.id} className="flex items-center gap-2 py-2">
                  <Badge>{t(`staff.leaveTypes.${l.type}`)}</Badge>
                  <span className="flex-1">
                    {date(l.startDate)} – {date(l.endDate)} · {Number(l.days)} {t('staff.days').toLowerCase()}
                    {l.note && <span className="text-slate-500"> · {l.note}</span>}
                  </span>
                  {canEdit && (
                    <button className="text-slate-400 hover:text-rose-600" onClick={() => delLeave.mutate(l.id)} aria-label={t('common.delete')}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <EmployeeFormModal open={dialog === 'edit'} initial={e} title={t('staff.editEmployee')} onClose={() => setDialog(null)} onSubmit={(v) => update.mutate(v)} loading={update.isPending} error={update.error} />
      <DocModal open={dialog === 'doc'} employeeId={e.id} onClose={() => setDialog(null)} onDone={refresh} />
      <AdjustmentModal open={dialog === 'adj'} employeeId={e.id} onClose={() => setDialog(null)} onDone={refresh} />
      <LeaveModal open={dialog === 'leave'} employeeId={e.id} onClose={() => setDialog(null)} onDone={refresh} />
    </div>
  );
}

function DocModal({ open, employeeId, onClose, onDone }: { open: boolean; employeeId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [type, setType] = useState('CPR');
  const [expiry, setExpiry] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    setBusy(true);
    try {
      const file = await api.upload('/api/files/upload/employee', f);
      await api.post(`/api/staff/employees/${employeeId}/documents`, { type, fileId: file.id, expiryDate: expiry || null, note: note || null });
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('staff.addDocument')} footer={<Button loading={busy} icon={<Upload className="size-4" />} onClick={() => ref.current?.click()}>{t('common.upload')}</Button>}>
      <div className="space-y-3">
        <Field label={t('staff.docType')}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {['CPR', 'PASSPORT', 'VISA', 'CONTRACT', 'OTHER'].map((x) => (
              <option key={x} value={x}>
                {t(`staff.docTypes.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('staff.expiryDate')}>
          <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        <Field label={t('common.notes')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      </div>
    </Modal>
  );
}

function AdjustmentModal({ open, employeeId, onClose, onDone }: { open: boolean; employeeId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState({ type: 'ADVANCE', amount: '', date: bhDate(), method: 'CASH', note: '' });
  const m = useMutation({
    mutationFn: () => api.post('/api/staff/adjustments', { employeeId, type: v.type, amount: Number(v.amount), date: v.date, method: v.type === 'ADVANCE' ? v.method : null, note: v.note || null }),
    onSuccess: () => {
      onDone();
      onClose();
      setV({ ...v, amount: '', note: '' });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('staff.newAdjustment')} footer={<Button loading={m.isPending} disabled={!(Number(v.amount) > 0)} onClick={() => m.mutate()}>{t('common.save')}</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.type')}>
            <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
              <option value="ADVANCE">{t('staff.ADVANCE')}</option>
              <option value="DEDUCTION">{t('staff.DEDUCTION')}</option>
            </Select>
          </Field>
          <Field label={t('common.amount')}>
            <MoneyInput value={v.amount} onChange={(x) => setV({ ...v, amount: x })} />
          </Field>
          <Field label={t('common.date')}>
            <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          {v.type === 'ADVANCE' && (
            <Field label={t('common.method')}>
              <Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
                {['CASH', 'BANK_TRANSFER', 'BENEFIT_PAY', 'CARD'].map((x) => (
                  <option key={x} value={x}>
                    {t(`paymentMethod.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {v.type === 'ADVANCE' && <p className="text-xs text-slate-500">{t('staff.advanceHint')}</p>}
        <Field label={t('common.notes')}>
          <Textarea value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function LeaveModal({ open, employeeId, onClose, onDone }: { open: boolean; employeeId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState({ type: 'ANNUAL', startDate: bhDate(), endDate: bhDate(), days: '', note: '' });
  const m = useMutation({
    mutationFn: () => api.post('/api/staff/leave', { employeeId, type: v.type, startDate: v.startDate, endDate: v.endDate, days: v.days ? Number(v.days) : null, note: v.note || null }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('staff.newLeave')} footer={<Button loading={m.isPending} onClick={() => m.mutate()}>{t('common.save')}</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('common.type')}>
          <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            {['ANNUAL', 'SICK', 'UNPAID'].map((x) => (
              <option key={x} value={x}>
                {t(`staff.leaveTypes.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('staff.days')} (${t('common.optional')})`}>
          <Input inputMode="decimal" value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} />
        </Field>
        <Field label={t('common.from')}>
          <Input type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
        </Field>
        <Field label={t('common.to')}>
          <Input type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
        </Field>
        <Field label={t('common.notes')} className="col-span-2">
          <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
