import { Fragment, useMemo } from 'react';
import { ChevronRight, Fish, Flame, Scissors, UtensilsCrossed } from 'lucide-react';
import { computeYield } from '../../core/yield';
import { YIELD_TEMPLATES, outputsFromTemplate } from '../../services/yieldTests';
import { fmtEur, fmtKg, fmtNum, fmtPct } from '../../lib/format';
import { cx } from '../ui';

const EXAMPLE_GROSS = 5;
const EXAMPLE_PRICE = 12;

/**
 * Mini-diagrama explicativo: pieza bruta → limpieza → cocción → ración, con un ejemplo real calculado con el mismo
 * motor que las pruebas (plantilla de salmón entero de 5 kg a 12 €/kg).
 */
export function YieldFlowDiagram({ className }: { className?: string }) {
  const ex = useMemo(() => {
    const tpl = YIELD_TEMPLATES.find((t) => t.name.startsWith('Salmón')) ?? YIELD_TEMPLATES[0];
    const test = {
      grossWeightKg: EXAMPLE_GROSS,
      purchasePricePerKg: EXAMPLE_PRICE,
      thawLossPct: tpl.thawLossPct,
      cookingLossPct: tpl.cookingLossPct,
      portionKg: tpl.portionKg,
      outputs: outputsFromTemplate(tpl, EXAMPLE_GROSS),
    };
    return { r: computeYield(test), portionKg: tpl.portionKg, name: tpl.name.toLowerCase() };
  }, []);
  const { r } = ex;

  const steps = [
    { icon: Fish, title: 'Pieza bruta', value: fmtKg(r.grossWeightKg), sub: `a ${fmtEur(EXAMPLE_PRICE)}/kg`, share: 1 },
    { icon: Scissors, title: 'Limpieza', value: fmtKg(r.principalKg), sub: `Rinde ${fmtPct(r.yieldPct, 0)}`, share: r.principalKg / r.grossWeightKg },
    { icon: Flame, title: 'Cocción', value: fmtKg(r.cookedKg), sub: `Rinde ${fmtPct(r.finalYieldPct, 0)}`, share: r.cookedKg / r.grossWeightKg },
    {
      icon: UtensilsCrossed,
      title: 'Ración',
      value: `${r.portions ?? 0} × ${fmtKg(ex.portionKg)}`,
      sub: `${fmtEur(r.costPerPortion)} cada una`,
      share: ((r.portions ?? 0) * ex.portionKg) / r.grossWeightKg,
    },
  ];

  return (
    <figure className={cx('w-full', className)} aria-label="Cómo funciona una prueba de rendimiento">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch sm:gap-1.5">
        {steps.map((s, i) => (
          <Fragment key={s.title}>
            <div className="relative flex min-w-0 flex-1 flex-col rounded-2xl border border-line bg-surface/80 p-3 shadow-card backdrop-blur-sm">
              <span
                className={cx(
                  'flex size-8 shrink-0 items-center justify-center rounded-xl',
                  i === 0 ? 'bg-surface-2 text-ink-2' : i === 3 ? 'bg-ok-soft text-ok' : 'bg-brand-500/12 text-brand-500',
                )}
              >
                <s.icon className="size-4" />
              </span>
              <span className="mt-2 truncate text-[11px] font-bold uppercase tracking-wide text-muted">{s.title}</span>
              <div className="mt-0.5 whitespace-nowrap font-display text-lg font-extrabold leading-tight text-ink xl:text-xl">{s.value}</div>
              <div className="truncate text-xs text-muted">{s.sub}</div>
              <div className="mt-2.5 h-1.5 w-full rounded-full bg-line" aria-hidden>
                <div
                  className={cx('h-full rounded-full', i === 0 ? 'bg-ink-2' : i === 3 ? 'bg-ok' : 'bg-brand-500')}
                  style={{ width: `${Math.max(0.03, Math.min(1, s.share)) * 100}%` }}
                />
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="hidden items-center text-muted sm:flex" aria-hidden>
                <ChevronRight className="size-4" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <figcaption className="mt-3 text-xs leading-relaxed text-muted">
        Ejemplo con un {ex.name} de {fmtNum(EXAMPLE_GROSS, 0)} kg: el kilo limpio no cuesta {fmtEur(EXAMPLE_PRICE)} sino{' '}
        <strong className="font-semibold text-ink">{fmtEur(r.costPerUsableKg)}</strong>, y cada ración arrastra{' '}
        <strong className="font-semibold text-ink">{fmtEur(r.wasteCostPerPortion)}</strong> de merma.
      </figcaption>
    </figure>
  );
}
