import type { ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, AlertTriangle, Wand2 } from 'lucide-react';
import type { BaseUnit, BusinessSettings, Dish, DishCost } from '../../types';
import { fmtEur, fmtKg, fmtNum } from '../../lib/format';
import { Button, FoodCostBadge, NumberInput, Select } from '../ui';
import { AmountInput } from '../purchases/AmountInput';
import { dishFoodCostStatus, fmtPctNb, fmtPrice, shownFoodCost, shownMargin, targetOf, yieldUnitLabel } from './logic';

/** Tarjeta de KPI con el lenguaje visual de Stat, pero admitiendo controles dentro. */
function Tile({ label, children, hint, className, tone }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string; tone?: 'brand' }) {
  return (
    <div
      className={clsx(
        'relative min-w-0 overflow-hidden rounded-2xl border p-3.5 shadow-card sm:p-4',
        tone === 'brand' ? 'border-brand-500/30 bg-gradient-to-br from-brand-500/12 via-surface to-surface' : 'border-line bg-surface',
        className,
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1.5">{children}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Completeness({ cost }: { cost: DishCost }) {
  if (!cost.items.length) return <span>Sin ingredientes todavía</span>;
  const missing = cost.items.filter((i) => !i.resolved).length;
  if (!missing)
    return (
      <span className="inline-flex items-center gap-1 text-ok">
        <CheckCircle2 className="size-3.5" /> Todos los ingredientes con precio
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-warn">
      <AlertTriangle className="size-3.5" /> {missing} sin precio o sin vincular
    </span>
  );
}

/** Medidor de food cost con la marca del objetivo. */
function FoodCostMeter({ pct, target, status }: { pct?: number; target: number; status: 'ok' | 'warn' | 'bad' | 'none' }) {
  const scale = Math.max(60, Math.ceil(((pct ?? 0) + 5) / 10) * 10);
  const fill = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', none: 'bg-line-strong' }[status];
  return (
    <div className="relative mt-2.5 h-2 rounded-full bg-line" aria-hidden>
      <div className={clsx('h-full rounded-full transition-all duration-500', fill)} style={{ width: `${Math.min(100, ((pct ?? 0) / scale) * 100)}%` }} />
      <div className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink" style={{ left: `${(target / scale) * 100}%` }} title={`Objetivo ${fmtPctNb(target, 0)}`} />
    </div>
  );
}

export function KpiStrip({
  dish,
  cost,
  business,
  onChange,
  usedInCount = 0,
}: {
  dish: Dish;
  cost: DishCost;
  business: BusinessSettings;
  onChange: (patch: Partial<Dish>) => void;
  usedInCount?: number;
}) {
  const target = targetOf(dish, business);
  const vat = dish.saleVatPct ?? business.defaultSaleVatPct;
  const fc = shownFoodCost(cost);
  const margin = shownMargin(cost);
  const status = dishFoodCostStatus(fc, dish, business);
  const portions = dish.portions > 0 ? dish.portions : 1;

  if (dish.kind === 'elaboracion') {
    const yu = dish.yieldUnit ?? 'kg';
    return (
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Coste total receta" tone="brand" className="col-span-2 md:col-span-1" hint={<Completeness cost={cost} />}>
          <div className="font-display text-3xl font-extrabold text-ink sm:text-4xl">{fmtEur(cost.totalCost)}</div>
        </Tile>
        <Tile label="Rendimiento" hint="Cantidad final que sale de la receta">
          <div className="flex gap-1.5">
            <NumberInput
              value={dish.yieldQty}
              onValue={(v) => onChange({ yieldQty: v != null && v > 0 ? v : undefined, yieldUnit: dish.yieldUnit ?? 'kg' })}
              decimals={3}
              placeholder="0"
              aria-label="Cantidad producida"
              className="min-w-0 flex-1 text-right font-semibold"
            />
            <Select value={yu} onChange={(e) => onChange({ yieldUnit: e.target.value as BaseUnit })} aria-label="Unidad del rendimiento" className="w-[76px]! shrink-0 px-2!">
              <option value="kg">kg</option>
              <option value="l">l</option>
              <option value="ud">ud</option>
            </Select>
          </div>
        </Tile>
        <Tile label={`€ por ${yieldUnitLabel(yu)} producido`} hint={cost.pricePerYieldUnit == null ? 'Indica el rendimiento para calcularlo' : 'Es el precio al que la usarás como ingrediente'}>
          <div className="font-display text-2xl font-extrabold text-ink">{cost.pricePerYieldUnit != null ? fmtPrice(cost.pricePerYieldUnit) : '—'}</div>
        </Tile>
        <Tile label="Coste por ración" hint={`${portions} ${portions === 1 ? 'ración' : 'raciones'}`}>
          <div className="font-display text-2xl font-extrabold text-ink">{fmtEur(cost.costPerPortion)}</div>
        </Tile>
        <Tile label="Merma receta" hint={cost.grossKgPerPortion > 0 ? `${fmtPctNb(cost.wastePct)} del bruto · ${fmtEur(cost.wasteCostPerPortion * portions)}` : undefined}>
          <div className="font-display text-2xl font-extrabold text-ink">{fmtKg(cost.totalWasteKg)}</div>
        </Tile>
        <Tile
          label="Se usa en"
          className="col-span-2 md:col-span-1"
          hint={usedInCount ? 'Si cambias su coste, se actualizan todos' : 'Vincúlala desde el escandallo de un plato'}
        >
          <div className="font-display text-2xl font-extrabold text-ink">
            {usedInCount} <span className="text-base font-bold text-muted">{usedInCount === 1 ? 'plato' : 'platos'}</span>
          </div>
        </Tile>
      </div>
    );
  }

  const canApply = cost.suggestedPrice != null && Math.abs((dish.menuPrice ?? 0) - cost.suggestedPrice) > 0.004;

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        label="Coste por ración"
        tone="brand"
        className="col-span-2 md:col-span-1"
        hint={
          <span className="flex flex-col gap-0.5">
            <Completeness cost={cost} />
            {portions > 1 && (
              <span>
                Receta {fmtEur(cost.totalCost)} · {portions} raciones
              </span>
            )}
          </span>
        }
      >
        <div className="font-display text-3xl font-extrabold text-ink sm:text-4xl">{fmtEur(cost.costPerPortion)}</div>
      </Tile>
      <Tile label="PVP carta (IVA incl.)" hint={cost.netPrice != null ? `Sin IVA ${fmtEur(cost.netPrice)} · IVA ${fmtNum(vat, 1)} %` : 'El precio tal y como sale en tu carta'}>
        <AmountInput
          value={dish.menuPrice}
          onValue={(v) => onChange({ menuPrice: v != null && v > 0 ? v : undefined })}
          decimals={2}
          minDecimals={2}
          min={0}
          placeholder="0,00"
          suffix="€"
          aria-label="PVP de carta con IVA"
          className="[&_input]:h-11 [&_input]:font-display [&_input]:text-xl [&_input]:font-extrabold"
        />
      </Tile>
      <Tile label="Food cost" hint={`Objetivo ${fmtPctNb(target, 0)}${dish.targetFoodCostPct ? ' (de este plato)' : ''}`}>
        <FoodCostBadge pct={fc} status={status} size="lg" />
        <FoodCostMeter pct={fc} target={target} status={status} />
      </Tile>
      <Tile
        label="Margen bruto"
        hint={cost.multiplier != null ? `Multiplicador ×${fmtNum(cost.multiplier, 2)}` : margin == null && cost.netPrice ? 'Añade ingredientes con precio' : 'Por ración, sin IVA'}
      >
        <div className={clsx('font-display text-2xl font-extrabold', margin != null && margin < 0 ? 'text-bad' : 'text-ink')}>{fmtEur(margin)}</div>
        {margin != null && cost.grossMarginPct != null && <div className="text-xs font-semibold text-ink-2">{fmtPctNb(cost.grossMarginPct)} del PVP sin IVA</div>}
      </Tile>
      <Tile label="PVP sugerido" hint={`Para un food cost del ${fmtPctNb(target, 0)}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-2xl font-extrabold text-ink">{fmtEur(cost.suggestedPrice)}</span>
          {canApply && (
            <Button size="sm" variant="outline" icon={<Wand2 className="size-3.5" />} onClick={() => onChange({ menuPrice: cost.suggestedPrice })}>
              Aplicar
            </Button>
          )}
        </div>
      </Tile>
      <Tile
        label="Merma por ración"
        className="col-span-2 md:col-span-1"
        hint={cost.grossKgPerPortion > 0 ? `${fmtPctNb(cost.wastePct)} de lo comprado` : 'Sin datos de peso'}
      >
        <div className="font-display text-2xl font-extrabold text-ink">{fmtKg(cost.wasteKgPerPortion)}</div>
        <div className="text-xs font-semibold text-ink-2">{fmtEur(cost.wasteCostPerPortion)} que no llegan al plato</div>
      </Tile>
    </div>
  );
}

/** Resumen compacto y fijo para móvil mientras se edita el escandallo. */
export function KpiMini({ dish, cost, business }: { dish: Dish; cost: DishCost; business: BusinessSettings }) {
  const fc = shownFoodCost(cost);
  const status = dishFoodCostStatus(fc, dish, business);
  const dot = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', none: 'bg-line-strong' }[status];
  return (
    <div className="tabular flex items-center justify-between gap-3 text-xs">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{dish.kind === 'elaboracion' ? 'Coste total' : 'Coste ración'}</div>
        <div className="font-display text-base font-extrabold text-ink">{fmtEur(dish.kind === 'elaboracion' ? cost.totalCost : cost.costPerPortion)}</div>
      </div>
      {dish.kind === 'elaboracion' ? (
        <div className="min-w-0 text-right">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">€ / {dish.yieldUnit ?? 'kg'}</div>
          <div className="font-display text-base font-extrabold text-ink">{cost.pricePerYieldUnit != null ? fmtPrice(cost.pricePerYieldUnit) : '—'}</div>
        </div>
      ) : (
        <>
          <div className="min-w-0 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Food cost</div>
            <div className="inline-flex items-center gap-1.5 font-display text-base font-extrabold text-ink">
              <span className={clsx('size-2 rounded-full', dot)} aria-hidden />
              {fmtPctNb(fc)}
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">PVP</div>
            <div className="font-display text-base font-extrabold text-ink">{fmtEur(dish.menuPrice)}</div>
          </div>
        </>
      )}
    </div>
  );
}
