import type { ReactNode } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronRight, XCircle } from 'lucide-react';
import type { FoodCostStatus } from '../../core/costing';

/**
 * Ranking de barras horizontales en HTML (se adapta a nombres largos y a móvil mejor que un SVG).
 * Barras finas con extremo redondeado de 4 px, cuadradas en la base; línea de referencia opcional
 * (p. ej. el food cost objetivo) y etiqueta de valor al final de cada barra.
 */

export type HBarTone = FoodCostStatus | 'brand' | 'info' | 'ai' | 'neutral';

export interface HBarItem {
  id: string;
  label: ReactNode;
  sublabel?: ReactNode;
  value: number;
  /** Texto del valor al final de la barra. */
  display: ReactNode;
  tone?: HBarTone;
  /** Enlace al detalle. */
  to?: string;
  /** Texto accesible completo de la fila. */
  title?: string;
}

const barTones: Record<HBarTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  none: 'bg-line-strong',
  brand: 'bg-brand-500',
  info: 'bg-info',
  ai: 'bg-ai',
  neutral: 'bg-line-strong',
};

const statusIcons: Partial<Record<HBarTone, ReactNode>> = {
  ok: <CheckCircle2 className="size-3.5 text-ok" aria-hidden />,
  warn: <AlertTriangle className="size-3.5 text-warn" aria-hidden />,
  bad: <XCircle className="size-3.5 text-bad" aria-hidden />,
};

export function HBarList({
  items,
  max,
  reference,
  statusIcons: showIcons,
  ariaLabel,
  className,
  dense,
}: {
  items: HBarItem[];
  /** Máximo de la escala (por defecto, el mayor valor + 5 %). */
  max?: number;
  reference?: { value: number; label: string };
  /** Muestra un icono de estado junto al valor (codificación secundaria al color). */
  statusIcons?: boolean;
  ariaLabel: string;
  className?: string;
  dense?: boolean;
}) {
  const top = Math.max(max ?? 0, ...items.map((i) => i.value), reference ? reference.value * 1.15 : 0) || 1;
  const scale = max ?? top * 1.05;
  const refPos = reference ? Math.min(100, (reference.value / scale) * 100) : undefined;

  return (
    <div className={clsx('relative', className)}>
      {reference && refPos != null && (
        <div className="mb-0.5 flex px-2 sm:gap-3" aria-hidden>
          <div className="hidden sm:block sm:w-[38%] sm:shrink-0" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative h-4 min-w-0 flex-1">
              <span
                className="absolute top-0 whitespace-nowrap rounded-full border border-line bg-surface px-1.5 text-[10px] font-semibold leading-[14px] text-ink-2"
                style={{ left: `${refPos}%`, transform: `translateX(-${refPos > 80 ? 100 : refPos < 12 ? 0 : 50}%)` }}
              >
                {reference.label}
              </span>
            </div>
            <span className="hidden w-[4.5rem] shrink-0 sm:block" />
            {items.some((i) => i.to) && <span className="hidden w-4 shrink-0 sm:block" />}
          </div>
        </div>
      )}
      <ul aria-label={ariaLabel} className={clsx(dense ? 'space-y-0.5' : 'space-y-1')}>
        {items.map((it) => {
          const width = Math.max(0.8, Math.min(100, (it.value / scale) * 100));
          const tone = it.tone ?? 'brand';
          const body = (
            <>
              <div className="min-w-0 sm:w-[38%] sm:shrink-0">
                <div className="flex items-baseline justify-between gap-2 sm:block">
                  <span className="block truncate text-[13px] font-semibold text-ink">{it.label}</span>
                  <span className="tabular flex shrink-0 items-center gap-1 text-[13px] font-bold text-ink sm:hidden">
                    {showIcons && statusIcons[tone]}
                    {it.display}
                  </span>
                </div>
                {it.sublabel && <span className="block truncate text-[11px] text-muted">{it.sublabel}</span>}
              </div>
              <div className="relative flex min-w-0 flex-1 items-center gap-2">
                <div className="relative h-3 min-w-0 flex-1">
                  <div
                    className={clsx('absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-700 ease-out', barTones[tone])}
                    style={{ width: `${width}%` }}
                  />
                  {refPos != null && <div aria-hidden className="absolute -inset-y-1.5 w-px bg-ink/35" style={{ left: `${refPos}%` }} />}
                </div>
                <span className="tabular hidden w-[4.5rem] shrink-0 items-center justify-end gap-1 text-right text-[13px] font-bold text-ink sm:flex">
                  {showIcons && statusIcons[tone]}
                  {it.display}
                </span>
                {items.some((i) => i.to) && (
                  <ChevronRight
                    className={clsx(
                      'hidden size-4 shrink-0 text-muted opacity-0 transition sm:block',
                      it.to && 'group-hover:opacity-100 group-focus-visible:opacity-100',
                    )}
                    aria-hidden
                  />
                )}
              </div>
            </>
          );
          const rowCls = clsx(
            'group flex flex-col gap-1 rounded-xl px-2 sm:flex-row sm:items-center sm:gap-3',
            dense ? 'py-1.5' : 'py-2',
            it.to && 'transition hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-500',
          );
          return (
            <li key={it.id}>
              {it.to ? (
                <Link to={it.to} className={rowCls} title={it.title} aria-label={it.title}>
                  {body}
                </Link>
              ) : (
                <div className={rowCls} title={it.title}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
