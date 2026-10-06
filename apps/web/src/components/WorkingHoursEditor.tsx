import { useTranslation } from 'react-i18next';
import { WEEKDAYS, type WorkingHours } from '@laundry/shared';
import { Checkbox } from './ui';

export function WorkingHoursEditor({ value, onChange }: { value: WorkingHours; onChange: (v: WorkingHours) => void }) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {WEEKDAYS.map((d) => {
        const day = value[d];
        const set = (patch: Partial<typeof day>) => onChange({ ...value, [d]: { ...day, ...patch } });
        return (
          <div key={d} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="w-10 font-medium">{t(`weekdays.${d}`)}</span>
            <input type="time" className="input w-28" value={day.open} disabled={day.closed} onChange={(e) => set({ open: e.target.value })} aria-label={t('settings.open')} />
            <span className="text-slate-400">–</span>
            <input type="time" className="input w-28" value={day.close} disabled={day.closed} onChange={(e) => set({ close: e.target.value })} aria-label={t('settings.close')} />
            <Checkbox checked={day.closed} onChange={(v) => set({ closed: v })} label={t('settings.closed')} />
          </div>
        );
      })}
    </div>
  );
}
