import { useState } from 'react';
import { cx } from '../ui';
import { fmtKg, fmtPct } from '../../lib/format';
import type { CascadeStep } from './model';
import { YIELD_VIZ_VARS, fillStyle } from './palette';

/**
 * Cascada horizontal bruto → limpio → cocinado → raciones. Un único eje (kg sobre el peso bruto):
 * los totales parten de cero y cada pérdida flota entre el nivel anterior y el siguiente.
 * Todas las filas llevan su valor escrito, así que el gráfico se lee sin pasar el ratón.
 */
export function YieldCascade({ steps, grossKg }: { steps: CascadeStep[]; grossKg: number }) {
  const [active, setActive] = useState<string | null>(null);
  if (!steps.length || !(grossKg > 0)) return null;
  const max = Math.max(grossKg, ...steps.map((s) => s.to));
  return (
    <div className={cx(YIELD_VIZ_VARS, '@container space-y-1')} role="list" aria-label="Cascada de la pieza: de peso bruto a raciones">
      {steps.map((s) => {
        const isTotal = s.kind === 'total' || s.kind === 'final';
        const pctOfGross = (s.kg / grossKg) * 100;
        return (
          <div
            key={s.key}
            role="listitem"
            tabIndex={0}
            onPointerEnter={() => setActive(s.key)}
            onPointerLeave={() => setActive((a) => (a === s.key ? null : a))}
            onFocus={() => setActive(s.key)}
            onBlur={() => setActive((a) => (a === s.key ? null : a))}
            aria-label={`${s.label}: ${s.kind === 'loss' || s.kind === 'aside' ? 'menos ' : ''}${fmtKg(s.kg)}, ${fmtPct(pctOfGross)} del bruto`}
            className={cx(
              'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-xl px-2 py-1.5 outline-none transition @min-[32rem]:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto]',
              active === s.key ? 'bg-surface-2' : '',
              'focus-visible:ring-2 focus-visible:ring-brand-500/40',
            )}
          >
            <div className="min-w-0">
              <div className={cx('truncate text-[13px]', isTotal ? 'font-bold text-ink' : 'font-medium text-ink-2')}>
                {s.kind === 'loss' || s.kind === 'aside' ? '− ' : ''}
                {s.label}
              </div>
              {s.hint && <div className="truncate text-[11px] text-muted">{s.hint}</div>}
            </div>
            <div className="relative order-3 col-span-2 h-3.5 rounded-[4px] @min-[32rem]:order-none @min-[32rem]:col-span-1 @min-[32rem]:h-4">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" aria-hidden />
              <div
                className={cx('absolute inset-y-0 rounded-[4px] transition-all duration-500', !isTotal && 'opacity-90')}
                style={{ ...fillStyle(s.tone), left: `${(s.from / max) * 100}%`, width: `max(3px, ${((s.to - s.from) / max) * 100}%)` }}
              />
            </div>
            <div className="tabular min-w-[4.5rem] text-right">
              <div className={cx('text-[13px]', isTotal ? 'font-bold text-ink' : 'font-semibold text-ink-2')}>
                {s.kind === 'loss' || s.kind === 'aside' ? '−' : ''}
                {fmtKg(s.kg)}
              </div>
              <div className="text-[11px] text-muted">{fmtPct(pctOfGross)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
