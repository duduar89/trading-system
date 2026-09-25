import { useState } from 'react';
import { cx } from '../ui';
import { fmtEur, fmtKg, fmtPct } from '../../lib/format';
import type { PieceSegment } from './model';
import { YIELD_VIZ_VARS, fillStyle, whiteTextFits } from './palette';

/**
 * Barra 100 % de la pieza: parte aprovechable / subproductos / desperdicio / no registrado / descongelación.
 * Cada tramo es enfocable y muestra su detalle al pasar el ratón o con el teclado; la leyenda repite los valores
 * (nunca dependemos sólo del color ni del tooltip).
 */
export function PieceBar({ segments, grossKg, compact }: { segments: PieceSegment[]; grossKg: number; compact?: boolean }) {
  const [active, setActive] = useState<string | null>(null);
  const visible = segments.filter((s) => s.kg > 1e-6);
  const activeSeg = visible.find((s) => s.key === active);
  // Posición horizontal del tooltip: centro del tramo activo.
  let left = 0;
  if (activeSeg) {
    for (const s of visible) {
      if (s.key === activeSeg.key) {
        left += s.share / 2;
        break;
      }
      left += s.share;
    }
  }

  return (
    <div className={cx(YIELD_VIZ_VARS, '@container')}>
      <div className="relative">
        {activeSeg && (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-[240px] -translate-x-1/2 animate-fade-in rounded-xl border border-line bg-elevated px-3 py-2 text-xs shadow-pop"
            style={{ left: `clamp(110px, ${left * 100}%, calc(100% - 110px))` }}
          >
            <div className="tabular font-display text-base font-extrabold text-ink">
              {fmtKg(activeSeg.kg)} <span className="text-sm font-bold text-muted">· {fmtPct(activeSeg.share * 100)}</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-ink-2">
              <span className="h-0.5 w-3 rounded-full" style={fillStyle(activeSeg.key)} aria-hidden />
              {activeSeg.label}
            </div>
            {activeSeg.outputs.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-muted">
                {activeSeg.outputs.slice(0, 5).map((o) => (
                  <li key={o.id} className="flex justify-between gap-3">
                    <span className="truncate">{o.name || 'Sin nombre'}</span>
                    <span className="tabular shrink-0">
                      {fmtKg(o.weightKg)}
                      {o.valuePerKg ? ` · ${fmtEur(o.weightKg * o.valuePerKg)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {activeSeg.outputs.length === 0 && <div className="mt-0.5 text-muted">{activeSeg.hint}</div>}
          </div>
        )}
        <div
          className={cx('flex w-full gap-[2px] overflow-hidden rounded-lg bg-surface-2', compact ? 'h-3' : 'h-11')}
          role="group"
          aria-label={`Composición de la pieza de ${fmtKg(grossKg)}: ${visible.map((s) => `${s.label} ${fmtPct(s.share * 100)}`).join(', ')}`}
        >
          {visible.map((s) => (
            <div
              key={s.key}
              tabIndex={compact ? -1 : 0}
              onPointerEnter={() => !compact && setActive(s.key)}
              onPointerLeave={() => setActive((a) => (a === s.key ? null : a))}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive((a) => (a === s.key ? null : a))}
              aria-label={`${s.label}: ${fmtKg(s.kg)} (${fmtPct(s.share * 100)})`}
              className={cx(
                'relative flex h-full min-w-[3px] items-center justify-center transition-[filter,flex-grow] duration-500 outline-none focus-visible:brightness-110',
                active && active !== s.key && 'brightness-[0.85] saturate-[0.8]',
              )}
              style={{ ...fillStyle(s.key), flexGrow: s.share, flexBasis: 0 }}
            >
              {!compact && whiteTextFits(s.key) && s.share >= 0.14 && (
                <span className="tabular pointer-events-none px-1 text-xs font-bold text-white">{fmtPct(s.share * 100, 0)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      {!compact && (
        <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm @min-[30rem]:grid-cols-2">
          {segments
            .filter((s) => s.kg > 1e-6 || s.key === 'principal' || s.key === 'desperdicio')
            .map((s) => (
              <li
                key={s.key}
                className={cx('flex items-center gap-2 rounded-lg px-1.5 py-1 transition', active === s.key && 'bg-surface-2')}
                onPointerEnter={() => setActive(s.key)}
                onPointerLeave={() => setActive((a) => (a === s.key ? null : a))}
              >
                <span className="size-3 shrink-0 rounded-[4px]" style={fillStyle(s.key)} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
                <span className="tabular shrink-0 font-semibold text-ink">{fmtKg(s.kg)}</span>
                <span className="tabular w-12 shrink-0 text-right text-xs text-muted">{fmtPct(s.share * 100)}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
