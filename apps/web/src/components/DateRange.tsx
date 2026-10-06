import { useTranslation } from 'react-i18next';
import { addDays, addMonths, bhDate, monthRange, weekday } from '@laundry/shared';
import clsx from 'clsx';
import { Input } from './ui';

export type Preset = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

export function presetRange(p: Preset): { from: string; to: string } | null {
  const today = bhDate();
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'thisWeek':
      return { from: addDays(today, -weekday(today)), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth':
      return monthRange(addMonths(today.slice(0, 7), -1));
    default:
      return null;
  }
}

export function DateRange({
  from,
  to,
  preset,
  onChange,
}: {
  from: string;
  to: string;
  preset: Preset;
  onChange: (v: { from: string; to: string; preset: Preset }) => void;
}) {
  const { t } = useTranslation();
  const presets: Preset[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'custom'];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-200/60 p-1">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => {
              const r = presetRange(p);
              onChange({ from: r?.from ?? from, to: r?.to ?? to, preset: p });
            }}
            className={clsx('rounded-lg px-2.5 py-1 text-xs font-semibold', preset === p ? 'bg-white shadow-sm' : 'text-slate-600 hover:text-slate-900')}
          >
            {t(`common.${p}`)}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-1">
          <Input type="date" className="h-8 w-36 text-xs" value={from} onChange={(e) => onChange({ from: e.target.value, to, preset })} aria-label={t('common.from')} />
          <span className="text-slate-400">–</span>
          <Input type="date" className="h-8 w-36 text-xs" value={to} onChange={(e) => onChange({ from, to: e.target.value, preset })} aria-label={t('common.to')} />
        </div>
      )}
    </div>
  );
}
