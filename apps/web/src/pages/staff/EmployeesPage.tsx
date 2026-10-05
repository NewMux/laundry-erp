import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { FileWarning, Plus, UserCog } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, money } from '../../lib/format';
import { Badge, Button, Card, Empty, Loading, PageHeader, Switch } from '../../components/ui';
import { useToast } from '../../components/toast';
import { EmployeeFormModal } from './EmployeeForm';

export default function EmployeesPage() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['employees', all], queryFn: () => api.get(`/api/staff/employees${all ? '?all=1' : ''}`) });
  const alerts = useQuery({ queryKey: ['staff-alerts'], queryFn: () => api.get('/api/staff/alerts') });
  const create = useMutation({
    mutationFn: (v: any) => api.post('/api/staff/employees', v),
    onSuccess: (r) => {
      toast.success(t('common.saved'));
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ['employees'] });
      navigate(`/staff/employees/${r.employee.id}`);
    },
  });
  const employees: any[] = list.data?.employees ?? [];

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <PageHeader
        title={t('staff.employees')}
        actions={
          <>
            <Switch checked={all} onChange={setAll} label={t('common.inactive')} />
            {can('staff', 'create') && !readOnly && (
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('staff.newEmployee')}
              </Button>
            )}
          </>
        }
      />
      {alerts.data?.alerts?.length > 0 && (
        <Card className="mb-4" title={<span className="flex items-center gap-2"><FileWarning className="size-4 text-amber-600" /> {t('staff.alerts')}</span>} bodyClassName="p-0">
          <ul className="divide-y divide-slate-100">
            {alerts.data.alerts.map((a: any, i: number) => (
              <li key={i} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <button className="font-medium hover:underline bidi" onClick={() => navigate(`/staff/employees/${a.employeeId}`)}>
                  {a.employeeName}
                </button>
                <span className="flex-1 text-slate-600">{a.document}</span>
                <span className="text-slate-500">{date(a.expiryDate)}</span>
                <Badge color={a.level === 'expired' ? 'red' : a.level === 'week' ? 'orange' : 'amber'}>
                  {a.daysLeft < 0 ? t('dashboard.expired', { days: -a.daysLeft }) : t('dashboard.expiresIn', { days: a.daysLeft })}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {list.isLoading ? (
        <Loading />
      ) : !employees.length ? (
        <div className="card">
          <Empty icon={<UserCog className="size-10" />} title={t('staff.noEmployees')} />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('staff.name')}</th>
                <th>{t('staff.position')}</th>
                <th>{t('staff.nationality')}</th>
                <th>{t('staff.joinDate')}</th>
                <th className="num">{t('staff.basicSalary')}</th>
                <th>{t('staff.login')}</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className={clsx('cursor-pointer', !e.isActive && 'opacity-50')} onClick={() => navigate(`/staff/employees/${e.id}`)}>
                  <td className="font-medium bidi">{e.name}</td>
                  <td>{e.position}</td>
                  <td>{e.nationality}</td>
                  <td>{date(e.joinDate)}</td>
                  <td className="num">{e.basicSalary !== undefined ? money(e.basicSalary) : t('staff.salaryHidden')}</td>
                  <td>{e.user ? <Badge color="brand">{e.user.username}</Badge> : <span className="text-xs text-slate-400">{t('staff.noLogin')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EmployeeFormModal open={creating} title={t('staff.newEmployee')} onClose={() => setCreating(false)} onSubmit={(v) => create.mutate(v)} loading={create.isPending} error={create.error} />
    </div>
  );
}
