import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, qs } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { Card, Field, Input, Loading, Select } from '../../components/ui';
import { Pager } from '../orders/OrdersPage';

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k}: ${typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x)}`)
    .join(' · ');
}

/** Audit log of sensitive actions: cancellations, refunds, discounts, balance adjustments, price changes… */
export default function AuditLogPage() {
  const { t } = useTranslation();
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', action, from, to, page], queryFn: () => api.get(`/api/audit${qs({ action, from, to, page })}`) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('audit.action')}>
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">{t('audit.allActions')}</option>
            {(q.data?.actions ?? []).map((a: string) => (
              <option key={a} value={a}>
                {t(`auditActions.${a}`, { defaultValue: a })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.from')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('common.to')}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Card bodyClassName="p-0 overflow-x-auto">
        {q.isLoading ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('audit.time')}</th>
                <th>{t('audit.user')}</th>
                <th>{t('audit.action')}</th>
                <th>{t('audit.old')}</th>
                <th>{t('audit.new')}</th>
                <th>{t('audit.note')}</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.logs ?? []).map((l: any) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-xs">{dateTime(l.createdAt)}</td>
                  <td className="whitespace-nowrap">{l.userName}</td>
                  <td className="whitespace-nowrap text-xs font-medium">{t(`auditActions.${l.action}`, { defaultValue: l.action })}</td>
                  <td className="max-w-xs text-xs text-slate-600">{fmt(l.oldValue)}</td>
                  <td className="max-w-xs text-xs text-slate-800">{fmt(l.newValue)}</td>
                  <td className="text-xs bidi">{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Pager page={page} pageSize={100} total={q.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
