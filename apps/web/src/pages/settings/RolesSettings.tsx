import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Lock } from 'lucide-react';
import { ACTIONS, CAPS, MODULES, type Permissions } from '@laundry/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Card, Checkbox, Input, Loading, Tabs } from '../../components/ui';
import { useToast } from '../../components/toast';

/** Role permission matrix (modules × view/create/edit/delete/export) + capability flags. */
export default function RolesSettings() {
  const { t } = useTranslation();
  const { me, readOnly } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/api/settings/roles') });
  const [roleId, setRoleId] = useState<string | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const roles: any[] = q.data?.roles ?? [];
  const role = roles.find((r) => r.id === roleId) ?? roles[1] ?? roles[0];
  useEffect(() => {
    if (role) setPerms(structuredClone(role.permissions));
  }, [role?.id, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.put(`/api/settings/roles/${role.id}`, { permissions: perms }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast.error(e),
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/api/settings/roles/${role.id}/reset`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['roles'] }),
    onError: (e) => toast.error(e),
  });

  if (q.isLoading || !role || !perms) return <Loading />;
  const canEdit = role.editable && q.data.canCustomize && (me?.isOwner || me?.supportMode) && !readOnly;
  const toggle = (m: string, a: string, on: boolean) => {
    const cur = new Set(perms.modules[m as keyof Permissions['modules']] ?? []);
    if (on) cur.add(a as never);
    else cur.delete(a as never);
    if (on && a !== 'view') cur.add('view' as never);
    if (!on && a === 'view') cur.clear();
    setPerms({ ...perms, modules: { ...perms.modules, [m]: [...cur] } });
  };

  return (
    <div className="space-y-3">
      <Tabs value={role.id} onChange={setRoleId} tabs={roles.map((r) => ({ value: r.id, label: r.name, count: r.users }))} />
      {!q.data.canCustomize && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t('settings.customPermissionsAddon')}</div>}
      {!role.editable && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          <Lock className="size-4" /> {t('settings.ownerFull')}
        </div>
      )}
      <Card bodyClassName="p-0 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t('settings.module')}</th>
              {ACTIONS.map((a) => (
                <th key={a} className="text-center">
                  {t(`settings.actions.${a}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m}>
                <td className="font-medium">{t(`settings.modules.${m}`)}</td>
                {ACTIONS.map((a) => (
                  <td key={a} className="text-center">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-600"
                      disabled={!canEdit}
                      checked={perms.modules[m]?.includes(a) ?? false}
                      onChange={(e) => toggle(m, a, e.target.checked)}
                      aria-label={`${m} ${a}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAPS.map((c) => (
            <Checkbox key={c} disabled={!canEdit} checked={!!perms.caps[c]} onChange={(v) => setPerms({ ...perms, caps: { ...perms.caps, [c]: v } })} label={t(`settings.caps.${c}`)} />
          ))}
          <label className="flex items-center gap-2 text-sm">
            {t('settings.maxDiscount')}
            <Input className={clsx('h-8 w-20')} inputMode="numeric" disabled={!canEdit} value={perms.maxDiscountPercent} onChange={(e) => setPerms({ ...perms, maxDiscountPercent: Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
          </label>
        </div>
      </Card>
      {canEdit && (
        <div className="flex gap-2">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>
            {t('settings.resetDefaults')}
          </Button>
        </div>
      )}
    </div>
  );
}
