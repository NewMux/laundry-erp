import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { money } from '../lib/format';

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/**
 * Line chart with one shared y-axis, 2px lines, end-dot + end-label per
 * series, a legend, and a crosshair tooltip listing every series at the
 * hovered x. A table view is available for accessibility.
 */
export function TrendChart({
  labels,
  series,
  height = 240,
  extraRow,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  /** Additional derived value shown in the tooltip / table (e.g. profit). */
  extraRow?: { label: string; values: number[] };
}) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [table]);

  const pad = { top: 12, right: 76, bottom: 26, left: 52 };
  const w = Math.max(240, width);
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = useMemo(() => {
    const m = Math.max(1, ...series.flatMap((s) => s.values));
    const pow = 10 ** Math.floor(Math.log10(m));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => m / s <= 5) ?? pow * 10;
    return Math.ceil(m / step) * step;
  }, [series]);
  const ticks = useMemo(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
  }, [max]);
  const n = labels.length;
  const x = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => pad.top + innerH - (innerH * v) / max;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const fmtTick = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : v.toLocaleString('en-US'));
  const lastIdx = n - 1;

  // End labels: keep them from colliding by nudging only when too close.
  const ends = series.map((s) => ({ s, yy: y(s.values[lastIdx] ?? 0) }));
  ends.sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <button className="ml-auto text-xs font-medium text-brand-700 hover:underline" onClick={() => setTable((v) => !v)}>
          {table ? t('dashboard.showChart') : t('dashboard.showTable')}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                {series.map((s) => (
                  <th key={s.key} className="num">
                    {s.label}
                  </th>
                ))}
                {extraRow && <th className="num">{extraRow.label}</th>}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={l}>
                  <td>{l}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num">
                      {money(s.values[i])}
                    </td>
                  ))}
                  {extraRow && <td className="num">{money(extraRow.values[i])}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative w-full min-w-0 overflow-hidden">
          <svg width={w} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')} className="block">
            {ticks.map((tv) => (
              <g key={tv}>
                <line x1={pad.left} x2={pad.left + innerW} y1={y(tv)} y2={y(tv)} stroke="#e7e5e4" strokeWidth={1} />
                <text x={pad.left - 8} y={y(tv)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#78716c" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtTick(tv)}
                </text>
              </g>
            ))}
            {labels.map((l, i) =>
              i === 0 || i === lastIdx || (n > 10 && i % Math.ceil(n / 6) === 0 && lastIdx - i > n / 8) || (n <= 10) ? (
                <text key={l} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="#78716c">
                  {l.slice(8, 10)}
                </text>
              ) : null,
            )}
            {series.map((s) => (
              <g key={s.key}>
                <path
                  d={s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle cx={x(lastIdx)} cy={y(s.values[lastIdx] ?? 0)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
              </g>
            ))}
            {ends.map(({ s, yy }) => (
              <text key={s.key} x={x(lastIdx) + 8} y={yy} dominantBaseline="middle" fontSize={11} fontWeight={600} fill="#1c1917" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {money(s.values[lastIdx] ?? 0)}
              </text>
            ))}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="#a8a29e" strokeWidth={1} />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
                ))}
              </g>
            )}
            <rect
              x={pad.left}
              y={pad.top}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={x(hover) > w / 2 ? { right: w - x(hover) + 10 } : { left: x(hover) + 10 }}
            >
              <div className="mb-1 text-slate-500">{labels[hover]}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">{money(s.values[hover])}</span>
                </div>
              ))}
              {extraRow && (
                <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-100 pt-1">
                  <span className="text-slate-500">{extraRow.label}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{money(extraRow.values[hover])}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a ranked list (single series, value at the tip). */
export function BarList({ rows, color = '#2a78d6', format = (v: number) => v.toLocaleString('en-US') }: { rows: { label: string; value: number; sub?: string }[]; color?: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate text-slate-700">{r.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">
              {format(r.value)}
              {r.sub && <span className="ml-1 font-normal text-slate-500">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2.5 rounded-r bg-slate-100">
            <div className="h-full rounded-r" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
