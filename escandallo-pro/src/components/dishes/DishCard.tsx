import { Link } from 'react-router';
import clsx from 'clsx';
import { Check, FlaskConical, Sparkles, AlertTriangle } from 'lucide-react';
import type { BusinessSettings, Dish, DishCost } from '../../types';
import { fmtEur } from '../../lib/format';
import { AllergenChips } from '../Allergens';
import { Badge, FoodCostBadge, ProgressBar } from '../ui';
import { dishFoodCostStatus, fmtPctNb, fmtPrice, shownFoodCost, shownMargin } from './logic';

const STRIPE = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', none: 'bg-line-strong' } as const;

/** Casilla de selección accesible (sin navegar al pulsarla). */
export function SelectBox({ checked, onChange, label, className }: { checked: boolean; onChange: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange();
      }}
      className={clsx('relative z-[2] flex size-10 shrink-0 items-center justify-center rounded-xl transition', className)}
    >
      <span
        className={clsx(
          'flex size-5 items-center justify-center rounded-md border-2 transition',
          checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong bg-surface hover:border-brand-400',
        )}
      >
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

/** Tarjeta de plato/elaboración en el listado de escandallos. */
export function DishCard({
  dish,
  cost,
  business,
  selected,
  selecting,
  onToggle,
}: {
  dish: Dish;
  cost?: DishCost;
  business: BusinessSettings;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
}) {
  const fc = shownFoodCost(cost);
  const margin = shownMargin(cost);
  const status = dishFoodCostStatus(fc, dish, business);
  const suggested = dish.items.filter((i) => i.suggested).length;
  const missing = cost ? cost.items.filter((i) => !i.resolved).length : 0;
  const isPlato = dish.kind === 'plato';
  const hasWaste = cost != null && cost.grossKgPerPortion > 0;

  return (
    <article
      className={clsx(
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-pop',
        selected ? 'border-brand-500 ring-4 ring-brand-500/15' : 'border-line hover:border-line-strong',
      )}
    >
      <span className={clsx('absolute inset-y-0 left-0 w-1', isPlato ? STRIPE[status] : 'bg-info')} aria-hidden />
      <div className="flex items-start gap-1 p-4 pb-3 pl-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-5 flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
            {!isPlato && (
              <Badge tone="info" icon={<FlaskConical className="size-3" />}>
                Elaboración
              </Badge>
            )}
            {dish.section && <span className="truncate">{dish.section}</span>}
            {dish.status === 'revisado' && (
              <span className="inline-flex items-center gap-0.5 text-ok normal-case tracking-normal">
                <Check className="size-3" /> Revisado
              </span>
            )}
          </div>
          <h3 className="mt-1 line-clamp-2 font-display text-[17px] font-bold leading-snug text-ink">
            <Link to={`/platos/${dish.id}`} className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-brand-500">
              {dish.name}
            </Link>
          </h3>
        </div>
        <div className="flex items-start gap-1">
          {isPlato && <FoodCostBadge pct={fc} status={status} />}
          <SelectBox
            checked={selected}
            onChange={onToggle}
            label={`Seleccionar ${dish.name}`}
            className={clsx('-mr-2 -mt-2', !selecting && !selected && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100')}
          />
        </div>
      </div>

      <dl className="tabular grid grid-cols-3 gap-2 border-y border-line bg-surface-2/60 px-5 py-3 text-sm">
        {isPlato ? (
          <>
            <Metric label="PVP" value={dish.menuPrice ? fmtEur(dish.menuPrice) : undefined} missing="Sin PVP" />
            <Metric label="Coste" value={cost && cost.costPerPortion > 0 ? fmtEur(cost.costPerPortion) : undefined} />
            <Metric
              label="Margen"
              value={margin != null ? fmtEur(margin) : undefined}
              tone={margin != null && margin < 0 ? 'bad' : undefined}
            />
          </>
        ) : (
          <>
            <Metric label="Coste total" value={cost && cost.totalCost > 0 ? fmtEur(cost.totalCost) : undefined} />
            <Metric
              label={`€ / ${dish.yieldUnit ?? 'kg'}`}
              value={cost?.pricePerYieldUnit != null ? fmtPrice(cost.pricePerYieldUnit) : undefined}
              missing="Sin rendimiento"
            />
            <Metric label="Raciones" value={String(dish.portions)} />
          </>
        )}
      </dl>

      <div className="flex flex-1 flex-col gap-2.5 px-5 py-3">
        {dish.items.length ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className={clsx('font-semibold', missing ? 'text-warn' : 'text-ink-2')}>
                {missing ? (
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="size-3.5" /> {missing} sin precio
                  </span>
                ) : (
                  `${dish.items.length} ingredientes con precio`
                )}
              </span>
              {hasWaste && <span className="text-muted">Merma {fmtPctNb(cost.wastePct, 0)}</span>}
            </div>
            <ProgressBar value={cost?.completeness ?? 0} tone={missing ? 'warn' : 'ok'} className="h-1.5" />
          </div>
        ) : (
          <p className="text-xs font-medium text-muted">Sin ingredientes: ábrelo y pulsa «Proponer ingredientes».</p>
        )}
        {((cost?.allergens.length ?? 0) > 0 || suggested > 0) && (
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
            <AllergenChips allergens={(cost?.allergens ?? []).slice(0, 6)} size="sm" empty={null} />
            {suggested > 0 && (
              <Badge tone="ai" icon={<Sparkles className="size-3" />}>
                {suggested} por revisar
              </Badge>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Metric({ label, value, missing = '—', tone }: { label: string; value?: string; missing?: string; tone?: 'bad' }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className={clsx('truncate font-semibold', value ? (tone === 'bad' ? 'text-bad' : 'text-ink') : 'text-xs text-warn')}>{value ?? missing}</dd>
    </div>
  );
}

export function DishCardSkeleton() {
  return (
    <div className="animate-pulse-soft overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="space-y-2 p-5">
        <div className="h-3 w-20 rounded bg-line" />
        <div className="h-5 w-3/4 rounded bg-line" />
      </div>
      <div className="h-14 border-y border-line bg-surface-2" />
      <div className="space-y-2 p-5">
        <div className="h-2 w-full rounded bg-line" />
        <div className="h-3 w-1/3 rounded bg-line" />
      </div>
    </div>
  );
}
