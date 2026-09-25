import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import clsx from 'clsx';
import { ArrowRight, Calculator, ChefHat, Link2, Plus, Scale, Unlink } from 'lucide-react';
import type { Dish, DishCost, ID, Product, YieldTest } from '../../types';
import { Badge, Button, Card, CardHeader, FoodCostBadge } from '../ui';
import { foodCostStatus, type CostingContext } from '../../core/costing';
import { computeYield } from '../../core/yield';
import { simulatePriceChange } from '../../core/analytics';
import { useBusiness } from '../../state/hooks';
import { updateProduct } from '../../services/products';
import { errorMessage, toast } from '../../state/store';
import { fmtDate, fmtEur, fmtEurPrecise, fmtKg, fmtNum, fmtPct } from '../../lib/format';
import { productUsage } from './logic';
import { AmountInput } from './AmountInput';

/** "Usado en": escandallos que dependen del ingrediente, con su peso en el coste y el food cost del plato. */
export function UsageCard({
  product,
  dishes,
  costs,
}: {
  product: Product;
  dishes: Dish[] | undefined;
  costs: Map<ID, DishCost> | undefined;
}) {
  const business = useBusiness();
  const navigate = useNavigate();
  const usage = useMemo(() => productUsage(product.id, dishes ?? [], costs), [product.id, dishes, costs]);
  const direct = usage.filter((u) => !u.via);
  return (
    <Card>
      <CardHeader
        icon={<ChefHat className="size-5" />}
        title="Usado en"
        subtitle={
          usage.length
            ? `${usage.length} ${usage.length === 1 ? 'escandallo depende' : 'escandallos dependen'} de su precio`
            : 'Todavía no aparece en ningún escandallo'
        }
      />
      {usage.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
          Cuando lo añadas a una receta verás aquí cuánto pesa en el coste de cada plato.
          <div className="mt-3">
            <Button size="sm" variant="outline" icon={<ChefHat className="size-3.5" />} onClick={() => navigate('/platos')}>
              Ir a escandallos
            </Button>
          </div>
        </div>
      ) : (
        <ul className="-mx-1 divide-y divide-line">
          {usage.map((u) => {
            const status = foodCostStatus(
              u.foodCostPct,
              u.dish.targetFoodCostPct ?? business.targetFoodCostPct,
              business.warningFoodCostPct,
            );
            return (
              <li key={u.dish.id}>
                <Link to={`/platos/${u.dish.id}`} className="flex items-center gap-3 rounded-xl px-1 py-2.5 transition hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{u.dish.name}</span>
                      {u.dish.kind === 'elaboracion' && <Badge>Elaboración</Badge>}
                    </div>
                    {u.via ? (
                      <div className="text-xs text-muted">a través de «{u.via}»</div>
                    ) : (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line" aria-hidden>
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, u.sharePct)}%` }} />
                        </div>
                        <span className="tabular text-xs text-muted">
                          {fmtPct(u.sharePct, 0)} del coste · {fmtEur(u.costPerPortion)}/ración
                        </span>
                      </div>
                    )}
                  </div>
                  {u.dish.kind === 'plato' && <FoodCostBadge pct={u.foodCostPct} status={status} />}
                  <ArrowRight className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {direct.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Cada vez que confirmes una factura con este ingrediente, estos escandallos se recalculan solos.
        </p>
      )}
    </Card>
  );
}

/** Resumen de la prueba de rendimiento vinculada (recalculada con el precio vigente) o invitación a crearla. */
export function YieldCard({ product, tests }: { product: Product; tests: YieldTest[] | undefined }) {
  const navigate = useNavigate();
  const linked = product.yieldTestId ? tests?.find((t) => t.id === product.yieldTestId) : undefined;
  const candidates = (tests ?? []).filter((t) => t.productId === product.id && t.id !== product.yieldTestId);
  const result = useMemo(() => {
    if (!linked) return undefined;
    const price = product.baseUnit === 'kg' && product.pricePerBase > 0 ? product.pricePerBase : linked.purchasePricePerKg;
    return computeYield({ ...linked, purchasePricePerKg: price });
  }, [linked, product.baseUnit, product.pricePerBase]);

  const link = async (id: ID | undefined) => {
    try {
      await updateProduct(product.id, { yieldTestId: id });
      toast.success(id ? 'Prueba vinculada' : 'Prueba desvinculada', id ? 'Sus mermas mandan ahora en todos los escandallos.' : undefined);
    } catch (e) {
      toast.error('No se pudo actualizar', errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader icon={<Scale className="size-5" />} title="Prueba de rendimiento" subtitle="Lo que de verdad aprovechas de cada pieza" />
      {linked && result ? (
        <>
          <Link
            to={`/mermas/${linked.id}`}
            className="mb-3 block truncate text-sm font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400"
          >
            {linked.name} · {fmtDate(linked.date)}
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-surface-2 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Rendimiento</div>
              <div className="font-display text-2xl font-extrabold text-ink">{fmtPct(result.yieldPct, 1)}</div>
              <div className="text-xs text-muted">merma {fmtPct(result.totalWastePct, 1)}</div>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Coste real</div>
              <div className="font-display text-2xl font-extrabold text-ink">
                {fmtEurPrecise(result.costPerUsableKg)}
                <span className="font-sans text-xs font-semibold text-muted">/kg útil</span>
              </div>
              <div className="text-xs text-muted">
                compras a {fmtEurPrecise(result.grossWeightKg > 0 ? result.grossCost / result.grossWeightKg : 0)}/kg
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span>Pieza de {fmtKg(result.grossWeightKg)}</span>
            {result.byproductValue > 0 && <span>· subproductos {fmtEur(result.byproductValue)}</span>}
            {result.costFactor > 0 && <span>· factor ×{fmtNum(result.costFactor, 2)} cocinado</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/mermas/${linked.id}`)}>
              Ver prueba
            </Button>
            <Button size="sm" variant="ghost" icon={<Unlink className="size-3.5" />} onClick={() => void link(undefined)}>
              Desvincular
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Pesa la pieza tal cual llega, límpiala y pesa lo que va al plato. Sabrás el coste real por kilo útil y la merma exacta, y tus
            escandallos la usarán en lugar de la merma estimada{product.wastePct > 0 ? ` (${fmtPct(product.wastePct, 0)})` : ''}.
          </p>
          {candidates.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {candidates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-ink">{t.name}</span>
                  <Button size="sm" variant="outline" icon={<Link2 className="size-3.5" />} onClick={() => void link(t.id)}>
                    Vincular
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button
            className="mt-3"
            variant="primary"
            size="md"
            icon={<Plus className="size-4" />}
            onClick={() => navigate(`/mermas?nuevo=1&producto=${product.id}`)}
          >
            Crear prueba de merma
          </Button>
        </>
      )}
    </Card>
  );
}

/** Simulador "¿y si sube?": impacto de un precio hipotético en cada escandallo. */
export function PriceSimulator({ product, ctx }: { product: Product; ctx: CostingContext | undefined }) {
  const business = useBusiness();
  const [price, setPrice] = useState<number | undefined>(product.pricePerBase > 0 ? product.pricePerBase : undefined);
  const deferred = useDeferredValue(price);
  const sim = useMemo(() => {
    if (!ctx || deferred == null || !(deferred >= 0)) return { rows: [], failed: false };
    try {
      return { rows: simulatePriceChange(ctx, product.id, deferred), failed: false };
    } catch {
      return { rows: [], failed: true };
    }
  }, [ctx, product.id, deferred]);
  const rows = sim.rows;
  const base = product.pricePerBase;
  const bump = (pct: number) => base > 0 && setPrice(Math.round(base * (1 + pct / 100) * 10000) / 10000);
  const overLimit = rows.filter(
    (r) =>
      r.after.foodCostPct != null && foodCostStatus(r.after.foodCostPct, r.after.targetFoodCostPct, business.warningFoodCostPct) === 'bad',
  ).length;
  const extraCost = rows.reduce((s, r) => s + (r.after.costPerPortion - r.before.costPerPortion), 0);

  return (
    <Card>
      <CardHeader
        icon={<Calculator className="size-5" />}
        title="Simulador de precio"
        subtitle="¿Qué pasa con tus platos si el proveedor cambia el precio?"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-ink-2">Precio hipotético</span>
          <AmountInput value={price} onValue={setPrice} decimals={4} minDecimals={2} suffix={`€/${product.baseUnit}`} min={0} />
        </label>
        {base > 0 && (
          <div className="flex gap-1.5">
            {[-10, 5, 10, 20].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => bump(p)}
                className={clsx(
                  'tabular h-10 min-w-12 rounded-xl border px-2.5 text-xs font-bold transition',
                  p < 0 ? 'border-ok/40 text-ok hover:bg-ok-soft' : 'border-bad/30 text-bad hover:bg-bad-soft',
                )}
              >
                {p > 0 ? '+' : ''}
                {p} %
              </button>
            ))}
          </div>
        )}
      </div>

      {!ctx ? null : sim.failed ? (
        <p className="mt-4 text-sm text-muted">El simulador no está disponible en este momento.</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No hay escandallos que dependan de este ingrediente.</p>
      ) : (
        <>
          <div className={clsx('mt-4 rounded-xl px-3 py-2.5 text-sm', overLimit ? 'bg-bad-soft' : 'bg-surface-2')}>
            {deferred != null && Math.abs(deferred - base) < 1e-9 ? (
              <span className="text-muted">
                Cambia el precio para ver el impacto en {rows.length === 1 ? 'el plato' : `los ${rows.length} platos`}.
              </span>
            ) : (
              <span className="text-ink-2">
                <span className="font-semibold text-ink">
                  {extraCost >= 0 ? '+' : '−'}
                  {fmtEur(Math.abs(extraCost))}
                </span>{' '}
                de coste sumando una ración de cada plato
                {overLimit > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold text-bad">
                      {overLimit} {overLimit === 1 ? 'superaría' : 'superarían'} tu límite de food cost
                    </span>
                  </>
                )}
                .
              </span>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="tabular w-full min-w-[460px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                  <th className="py-2 pr-2">Plato</th>
                  <th className="px-2 py-2 text-right">Coste ración</th>
                  <th className="px-2 py-2 text-right">Food cost</th>
                  <th className="py-2 pl-2 text-right">PVP sugerido</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dishTarget = r.after.targetFoodCostPct;
                  return (
                    <tr key={r.dishId} className="border-t border-line">
                      <td className="max-w-[200px] py-2 pr-2">
                        <Link
                          to={`/platos/${r.dishId}`}
                          className="block truncate font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <span className="text-muted">{fmtEur(r.before.costPerPortion)}</span> <span className="text-muted">→</span>{' '}
                        <span className="font-semibold text-ink">{fmtEur(r.after.costPerPortion)}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {r.after.foodCostPct != null ? (
                          <span className="inline-flex items-center gap-1">
                            <FoodCostBadge
                              pct={r.before.foodCostPct}
                              status={foodCostStatus(r.before.foodCostPct, dishTarget, business.warningFoodCostPct)}
                            />
                            <ArrowRight className="size-3 text-muted" />
                            <FoodCostBadge
                              pct={r.after.foodCostPct}
                              status={foodCostStatus(r.after.foodCostPct, dishTarget, business.warningFoodCostPct)}
                            />
                          </span>
                        ) : (
                          <span className="text-xs text-muted">sin PVP</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-2 text-right font-semibold text-ink">{fmtEur(r.after.suggestedPrice)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
