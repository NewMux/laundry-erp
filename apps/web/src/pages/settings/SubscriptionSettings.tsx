import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, LifeBuoy } from 'lucide-react';
import { api, openFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, dateTime, money } from '../../lib/format';
import { Badge, Button, Card, Loading } from '../../components/ui';
import { useToast } from '../../components/toast';

export default function SubscriptionSettings() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => api.get('/api/settings/subscription') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/api/settings') });
  const support = useMutation({
    mutationFn: (days: number) => api.post('/api/settings/support-access', { days }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => toast.error(e),
  });
  if (sub.isLoading || !sub.data) return <Loading />;
  const s = sub.data;
  const until = settings.data?.supportAccessUntil;
  const active = until && new Date(until) > new Date();
  const stateColor: Record<string, string> = { TRIAL: 'amber', ACTIVE: 'green', EXPIRED: 'red', SUSPENDED: 'red' };
  return (
    <div className="space-y-4">
      <Card title={t('settings.subscription')}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t('settings.plan')}</dt>
            <dd className="font-semibold">
              {s.plan?.name ?? '—'} {s.plan && <span className="font-normal text-slate-500">· {t('common.bhd')} {money(s.plan.priceMonthly)}{t('common.perMonth')}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('settings.status')}</dt>
            <dd>
              <Badge color={stateColor[s.subscription.state]}>{t(`admin.state.${s.subscription.state}`)}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('settings.renewal')}</dt>
            <dd className="font-semibold">{date(s.status === 'TRIAL' ? s.trialEndsAt : s.currentPeriodEnd) || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('settings.paymentStatus')}</dt>
            <dd className="font-semibold">{s.paymentStatus}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('settings.users')}</dt>
            <dd className="font-semibold">{t('settings.usersLimit', { used: s.users.used, max: s.users.max })}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('admin.customPermissions')}</dt>
            <dd className="font-semibold">{s.features.customPermissions ? t('common.yes') : t('common.no')}</dd>
          </div>
        </dl>
      </Card>

      {me?.isOwner && !me.supportMode && (
        <Card title={<span className="flex items-center gap-2"><LifeBuoy className="size-4" /> {t('settings.supportAccess')}</span>}>
          <p className="mb-3 text-sm text-slate-600">{t('settings.supportAccessHint')}</p>
          {active && <p className="mb-3 text-sm font-semibold text-violet-700">{t('settings.supportUntil', { date: dateTime(until) })}</p>}
          <div className="flex flex-wrap gap-2">
            {[1, 3, 7].map((d) => (
              <Button key={d} variant="secondary" loading={support.isPending && support.variables === d} onClick={() => support.mutate(d)}>
                {t('settings.grant', { days: d })}
              </Button>
            ))}
            {active && (
              <Button variant="danger" loading={support.isPending && support.variables === 0} onClick={() => support.mutate(0)}>
                {t('settings.revoke')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {(me?.isOwner || me?.supportMode) && (
        <Card title={t('settings.data')}>
          <p className="mb-3 text-sm text-slate-600">{t('settings.exportHint')}</p>
          <Button icon={<Download className="size-4" />} onClick={() => openFile('/api/export/all', { download: `${me?.tenant?.slug}-export.xlsx` }).catch(toast.error)}>
            {t('settings.exportAll')}
          </Button>
        </Card>
      )}
    </div>
  );
}
