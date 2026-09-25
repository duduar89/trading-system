import { useEffect, useId, useState } from 'react';
import clsx from 'clsx';
import { Calculator, Check } from 'lucide-react';
import type { BusinessSettings, Dish, DishCost } from '../../types';
import { suggestedMenuPrice } from '../../core/costing';
import { fmtEur, fmtNum } from '../../lib/format';
import { Button, Card, CardHeader } from '../ui';
import { targetOf, fmtPctNb } from './logic';

const MIN = 20;
const MAX = 45;
const PRESETS = [25, 28, 30, 33, 35];

/** "¿Qué precio necesito?": elige el food cost deseado y obtén el PVP (redondeado) y el margen resultante. */
export function PriceTargetTool({
  dish,
  cost,
  business,
  onApply,
}: {
  dish: Dish;
  cost: DishCost;
  business: BusinessSettings;
  onApply: (menuPrice: number) => void;
}) {
  const initial = Math.min(MAX, Math.max(MIN, targetOf(dish, business)));
  const [pct, setPct] = useState(initial);
  const id = useId();
  // Si cambia el objetivo del plato o del negocio, el control lo sigue.
  useEffect(() => setPct(initial), [initial]);

  const vat = dish.saleVatPct ?? business.defaultSaleVatPct;
  const price = suggestedMenuPrice(cost.costPerPortion, pct, vat, business.priceRounding);
  const net = price != null ? price / (1 + vat / 100) : undefined;
  const margin = net != null ? net - cost.costPerPortion : undefined;
  const realFc = net ? (cost.costPerPortion / net) * 100 : undefined;
  const isCurrent = price != null && dish.menuPrice != null && Math.abs(dish.menuPrice - price) < 0.005;

  return (
    <Card>
      <CardHeader icon={<Calculator className="size-5" />} title="¿Qué precio necesito?" subtitle="Elige el food cost que quieres y te damos el PVP de carta." />
      {!(cost.costPerPortion > 0) ? (
        <p className="rounded-xl bg-surface-2 px-3 py-3 text-sm text-muted">Añade ingredientes con precio para calcular el PVP.</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">PVP necesario</div>
              <div className="font-display text-4xl font-extrabold text-ink">{fmtEur(price)}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Margen / ración</div>
              <div className="tabular font-display text-xl font-extrabold text-ok">{fmtEur(margin)}</div>
            </div>
          </div>

          <label htmlFor={id} className="mt-5 flex items-center justify-between text-xs font-semibold text-ink-2">
            <span>Food cost deseado</span>
            <span className="tabular rounded-lg bg-brand-500/12 px-2 py-0.5 font-display text-sm font-extrabold text-brand-600 dark:text-brand-400">{fmtPctNb(pct, 1)}</span>
          </label>
          <div className="mt-2">
            <input
              id={id}
              type="range"
              min={MIN}
              max={MAX}
              step={0.5}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="h-10 w-full cursor-pointer accent-brand-500"
              aria-valuetext={`${fmtNum(pct, 1)} % de food cost, PVP ${fmtEur(price)}`}
            />
            <div className="pointer-events-none flex justify-between text-[10px] font-semibold text-muted">
              <span>{MIN} %</span>
              <span>{MAX} %</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPct(p)}
                className={clsx(
                  'tabular h-10 min-w-12 rounded-xl border px-3 text-xs font-bold transition',
                  pct === p ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                )}
              >
                {p} %
              </button>
            ))}
          </div>
          <p className="tabular mt-3 text-xs text-muted">
            Food cost real con el redondeo a {fmtEur(business.priceRounding)}: <span className="font-semibold text-ink-2">{fmtPctNb(realFc)}</span>. IVA {fmtNum(vat, 1)} % incluido.
          </p>
          <Button className="mt-3" block variant={isCurrent ? 'outline' : 'primary'} disabled={isCurrent || price == null} icon={isCurrent ? <Check className="size-4" /> : undefined} onClick={() => price != null && onApply(price)}>
            {isCurrent ? 'Es tu PVP actual' : `Usar ${fmtEur(price)} como PVP`}
          </Button>
        </>
      )}
    </Card>
  );
}
