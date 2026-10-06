import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, bhDate, bhTime } from '@laundry/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date } from '../../lib/format';
import { Button, Field, Input, Loading, Modal, PageHeader, Select } from '../../components/ui';
import { useToast } from '../../components/toast';

const CELL: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-800',
  ABSENT: 'bg-rose-100 text-rose-800',
  LEAVE: 'bg-sky-100 text-sky-800',
  OFF: 'bg-slate-100 text-slate-500',
};

/** Monthly attendance sheet with manual entry by the manager. */
export default function AttendancePage() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [month, setMonth] = useState(bhDate().slice(0, 7));
  const [edit, setEdit] = useState<{ employeeId: string; name: string; date: string; checkIn: string; checkOut: string; status: string; note: string } | null>(null);
  const q = useQuery({ queryKey: ['attendance', month], queryFn: () => api.get(`/api/staff/attendance?month=${month}`) });
  const save = useMutation({
    mutationFn: () => api.put('/api/staff/attendance', { employeeId: edit!.employeeId, date: edit!.date, checkIn: edit!.checkIn || null, checkOut: edit!.checkOut || null, status: edit!.status, note: edit!.note || null }),
    onSuccess: () => {
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['attendance', month] });
    },
    onError: (e) => toast.error(e),
  });
  const canEdit = (can('attendance', 'create') || can('attendance', 'edit')) && !readOnly;
  const d = q.data;
  const rec = (empId: string, day: string) => d?.records.find((r: any) => r.employeeId === empId && r.date === day);
  const onLeave = (empId: string, day: string) => d?.leaves.find((l: any) => l.employeeId === empId && l.startDate <= day && l.endDate >= day);
  const letter: Record<string, string> = { PRESENT: 'P', ABSENT: 'A', LEAVE: 'L', OFF: '–' };
  const today = bhDate();

  return (
    <div className="mx-auto max-w-[1400px] p-3 md:p-6">
      <PageHeader
        title={t('staff.attendance')}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="prev">
              <ChevronLeft className="size-4" />
            </Button>
            <Input type="month" className="w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
            <Button variant="secondary" size="sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="next">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        {Object.entries(CELL).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={clsx('grid size-5 place-items-center rounded font-bold', c)}>{letter[k]}</span>
            {t(`staff.statuses.${k}`)}
          </span>
        ))}
      </div>
      {q.isLoading || !d ? (
        <Loading />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold">{t('staff.name')}</th>
                {d.days.map((day: any) => (
                  <th key={day.date} className={clsx('border-b border-slate-200 px-0.5 py-2 text-center font-medium', day.weekday === 5 ? 'bg-slate-100 text-slate-500' : 'bg-slate-50')}>
                    {day.date.slice(8)}
                  </th>
                ))}
                <th className="border-b border-slate-200 bg-slate-50 px-2 py-2 text-center">{t('staff.present')}</th>
              </tr>
            </thead>
            <tbody>
              {d.employees.map((emp: any) => {
                let present = 0;
                return (
                  <tr key={emp.id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-white px-3 py-1.5 font-medium bidi">{emp.name}</td>
                    {d.days.map((day: any) => {
                      const r = rec(emp.id, day.date);
                      const status = r?.status ?? (onLeave(emp.id, day.date) ? 'LEAVE' : null);
                      if (status === 'PRESENT') present++;
                      const title = r ? `${r.checkIn ? bhTime(new Date(r.checkIn)) : '--'} → ${r.checkOut ? bhTime(new Date(r.checkOut)) : '--'}${r.note ? ` · ${r.note}` : ''}` : '';
                      return (
                        <td key={day.date} className="border-b border-slate-100 p-0.5 text-center">
                          <button
                            disabled={!canEdit || day.date > today}
                            title={title}
                            onClick={() =>
                              setEdit({
                                employeeId: emp.id,
                                name: emp.name,
                                date: day.date,
                                checkIn: r?.checkIn ? bhTime(new Date(r.checkIn)) : '',
                                checkOut: r?.checkOut ? bhTime(new Date(r.checkOut)) : '',
                                status: r?.status ?? 'PRESENT',
                                note: r?.note ?? '',
                              })
                            }
                            className={clsx('grid size-7 place-items-center rounded font-bold', status ? CELL[status] : 'text-slate-300 hover:bg-slate-100', day.date === today && 'ring-1 ring-brand-400')}
                          >
                            {status ? letter[status] : '·'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="border-b border-slate-100 px-2 text-center font-semibold">{present}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} size="sm" title={edit ? `${edit.name} · ${date(edit.date)}` : ''} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
        {edit && (
          <div className="space-y-3">
            <Field label={t('common.status')}>
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                {['PRESENT', 'ABSENT', 'LEAVE', 'OFF'].map((s) => (
                  <option key={s} value={s}>
                    {t(`staff.statuses.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {edit.status === 'PRESENT' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('staff.checkIn')}>
                  <Input type="time" value={edit.checkIn} onChange={(e) => setEdit({ ...edit, checkIn: e.target.value })} />
                </Field>
                <Field label={t('staff.checkOut')}>
                  <Input type="time" value={edit.checkOut} onChange={(e) => setEdit({ ...edit, checkOut: e.target.value })} />
                </Field>
              </div>
            )}
            <Field label={t('common.notes')}>
              <Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
