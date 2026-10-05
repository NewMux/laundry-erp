import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Select, Switch } from '../../components/ui';

export default function UsersSettings() {
  const { t } = useTranslation();
  const { can, readOnly } = useAuth();
  const [editing, setEditing] = useState<any | null>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get('/api/users') });
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => api.get('/api/settings/subscription') });
  const canCreate = can('users', 'create') && !readOnly;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {sub.data && <span className="text-sm text-slate-600">{t('settings.usersLimit', { used: sub.data.users.used, max: sub.data.users.max })}</span>}
        {canCreate && (
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing({})}>
            {t('settings.newUser')}
          </Button>
        )}
      </div>
      <Card bodyClassName="p-0 overflow-x-auto">
        {users.isLoading ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('settings.username')}</th>
                <th>{t('settings.role')}</th>
                <th>{t('settings.employee')}</th>
                <th>{t('settings.lastLogin')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(users.data?.users ?? []).map((u: any) => (
                <tr key={u.id} className={clsx(!u.isActive && 'opacity-50')}>
                  <td className="font-medium bidi">{u.name}</td>
                  <td>
                    {u.username}
                    {u.email && <div className="text-xs text-slate-500">{u.email}</div>}
                  </td>
                  <td>
                    <Badge color={u.role?.key === 'OWNER' ? 'purple' : 'gray'}>{u.role?.name}</Badge> {u.hasPin && <Badge color="brand">{t('settings.hasPin')}</Badge>}
                  </td>
                  <td className="text-slate-600">{u.employee?.name}</td>
                  <td className="whitespace-nowrap text-slate-600">{dateTime(u.lastLoginAt)}</td>
                  <td className="text-right">
                    {can('users', 'edit') && !readOnly && (
                      <button className="text-sm text-brand-700 hover:underline" onClick={() => setEditing(u)}>
                        {t('common.edit')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <UserModal user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function UserModal({ user, onClose }: { user: any | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/api/settings/roles') });
  const employees = useQuery({ queryKey: ['employees', false], queryFn: () => api.get('/api/staff/employees'), enabled: !!user });
  const isNew = !user?.id;
  const [v, setV] = useState<any>(null);
  const [init, setInit] = useState<any>(undefined);
  if (user !== init) {
    setInit(user);
    setV(user ? { name: user.name ?? '', username: user.username ?? '', email: user.email ?? '', password: '', pin: '', roleId: user.roleId ?? '', employeeId: user.employeeId ?? '', isActive: user.isActive ?? true } : null);
  }
  const save = useMutation({
    mutationFn: () => {
      const body: any = { name: v.name, email: v.email || null, roleId: v.roleId, employeeId: v.employeeId || null };
      if (isNew) return api.post('/api/users', { ...body, username: v.username, password: v.password, pin: v.pin || null });
      return api.patch(`/api/users/${user.id}`, { ...body, isActive: v.isActive, password: v.password || undefined, pin: v.pin === '' ? undefined : v.pin });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['subscription'] });
      onClose();
    },
  });
  if (!v) return null;
  const roleList: any[] = roles.data?.roles ?? [];
  return (
    <Modal open={!!user} onClose={onClose} title={isNew ? t('settings.newUser') : t('settings.editUser')} footer={<Button loading={save.isPending} disabled={!v.name || !v.roleId || (isNew && (!v.username || v.password.length < 8))} onClick={() => save.mutate()}>{t('common.save')}</Button>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.name')}>
            <Input className="bidi" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label={t('settings.username')}>
            <Input value={v.username} disabled={!isNew} autoCapitalize="none" onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase() })} />
          </Field>
          <Field label={`${t('common.email')} (${t('common.optional')})`}>
            <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </Field>
          <Field label={t('settings.role')}>
            <Select value={v.roleId} onChange={(e) => setV({ ...v, roleId: e.target.value })}>
              <option value="" />
              {roleList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('settings.password')} hint={isNew ? undefined : t('settings.passwordHint')}>
            <Input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
          </Field>
          <Field label={t('settings.pin')} hint={isNew ? t('auth.pinHint') : t('settings.pinHintEdit')}>
            <Input inputMode="numeric" maxLength={4} value={v.pin} onChange={(e) => setV({ ...v, pin: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label={t('settings.employee')} hint={t('settings.employeeHint')}>
            <Select value={v.employeeId} onChange={(e) => setV({ ...v, employeeId: e.target.value })}>
              <option value="">—</option>
              {(employees.data?.employees ?? []).map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
          {!isNew && (
            <div className="flex items-end pb-2">
              <Switch checked={v.isActive} onChange={(x) => setV({ ...v, isActive: x })} label={t('common.active')} />
            </div>
          )}
        </div>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
