import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ChefHat, Link2, PackageSearch } from 'lucide-react';
import type { BusinessSettings, Dish, DishCost, ID, Product, YieldTest } from '../../types';
import { Badge, Button, Callout, Card, CardHeader, FoodCostBadge, Switch, cx } from '../ui';
import { buildCostingContext, costAllDishes, foodCostStatus, type CostingContext } from '../../core/costing';
import { fmtDate, fmtEur } from '../../lib/format';

interface DishImpact {
  dish: Dish;
  now: DishCost;
  alt: DishCost;
  direct: boolean;
}

function withLink(p: Product, testId: ID | undefined): Product {
  if (testId) return { ...p, yieldTestId: testId };
  const { yieldTestId: _drop, ...rest } = p;
  return rest;
}

/**
 * Tarjeta de vínculo prueba ⇄ producto: interruptor para aplicarla a todos los escandallos y lista de platos
 * afectados con su coste por ración ahora y en el escenario contrario (con / sin la prueba).
 */
export function YieldLinkCard({
  test,
  product,
  linked,
  otherLinkedTest,
  costing,
  business,
  canLink,
  busy,
  onToggle,
  onPickProduct,
}: {
  test: YieldTest;
  product: Product | undefined;
  linked: boolean;
  otherLinkedTest?: YieldTest;
  costing: CostingContext | undefined;
  business: BusinessSettings;
  canLink: boolean;
  busy?: boolean;
  onToggle: (on: boolean) => void;
  onPickProduct: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const impacts = useMemo<DishImpact[] | undefined>(() => {
    if (!costing || !product) return undefined;
    const products = [...costing.products.values()];
    const dishes = [...costing.dishes.values()];
    // La prueba en edición sustituye a la guardada: el impacto se ve al teclear.
    const tests = [...costing.yieldTests.values()].filter((t) => t.id !== test.id).concat(test);
    const altProducts = products.map((p) => (p.id === product.id ? withLink(p, linked ? undefined : test.id) : p));
    const nowCosts = costAllDishes(buildCostingContext(products, dishes, tests, costing.business));
    const altCosts = costAllDishes(buildCostingContext(altProducts, dishes, tests, costing.business));
    const direct = new Set(dishes.filter((d) => d.items.some((it) => it.ref?.type === 'product' && it.ref.id === product.id)).map((d) => d.id));
    const out: DishImpact[] = [];
    for (const d of dishes) {
      const now = nowCosts.get(d.id);
      const alt = altCosts.get(d.id);
      if (!now || !alt) continue;
      if (direct.has(d.id) || Math.abs(alt.costPerPortion - now.costPerPortion) > 0.0005) out.push({ dish: d, now, alt, direct: direct.has(d.id) });
    }
    return out.sort(
      (a, b) =>
        (a.dish.kind === 'plato' ? 0 : 1) - (b.dish.kind === 'plato' ? 0 : 1) ||
        Math.abs(b.alt.costPerPortion - b.now.costPerPortion) - Math.abs(a.alt.costPerPortion - a.now.costPerPortion) ||
        a.dish.name.localeCompare(b.dish.name, 'es'),
    );
  }, [costing, product, test, linked]);

  if (!product) {
    return (
      <Card>
        <CardHeader icon={<Link2 className="size-4" />} title="Aplicar a tus escandallos" />
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
          <PackageSearch className="size-7 text-muted" />
          <p className="mt-2 max-w-xs text-sm text-ink-2">Elige el producto de la pieza para usar esta prueba en todos los platos que lo lleven.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={onPickProduct}>
            Elegir producto
          </Button>
        </div>
      </Card>
    );
  }

  const platos = impacts?.filter((i) => i.dish.kind === 'plato') ?? [];
  const changed = impacts?.filter((i) => Math.abs(i.alt.costPerPortion - i.now.costPerPortion) > 0.0005) ?? [];
  const avgDelta = changed.length ? changed.reduce((s, i) => s + (i.alt.costPerPortion - i.now.costPerPortion), 0) / changed.length : 0;
  const visible = showAll ? (impacts ?? []) : (impacts ?? []).slice(0, 6);
  const altLabel = linked ? 'Sin la prueba' : 'Con la prueba';

  return (
    <Card className={cx(linked && 'border-ok/40')}>
      <CardHeader
        icon={<Link2 className="size-4" />}
        title="Aplicar a tus escandallos"
        subtitle={linked ? 'Activa: los escandallos usan el rendimiento real' : 'Ahora los escandallos usan la merma genérica del producto'}
        action={linked ? <Badge tone="ok">En uso</Badge> : undefined}
      />
      <div className={cx('rounded-xl border p-3.5', linked ? 'border-ok/30 bg-ok-soft' : 'border-line bg-surface-2')}>
        <Switch
          checked={linked}
          onChange={(v) => !busy && (v ? canLink && onToggle(true) : onToggle(false))}
          label={`Usar esta prueba en todos los escandallos de ${product.name}`}
          description="Su rendimiento y su coste real por kilo sustituyen a la merma genérica del producto. Si el precio sube en una factura, todo se recalcula solo."
        />
      </div>
      {!canLink && !linked && (
        <p className="mt-2 text-xs text-muted">Registra la parte aprovechable (lo que va al plato) para poder aplicarla.</p>
      )}
      {otherLinkedTest && !linked && (
        <Callout tone="info" className="mt-3">
          {product.name} usa ahora la prueba{' '}
          <Link to={`/mermas/${otherLinkedTest.id}`} className="font-semibold text-ink underline decoration-line-strong underline-offset-2 hover:decoration-brand-500">
            «{otherLinkedTest.name}»
          </Link>{' '}
          del {fmtDate(otherLinkedTest.date)}. Si activas esta, la sustituye.
        </Callout>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-bold text-ink">Platos con {product.name.toLowerCase()}</h4>
          {impacts && impacts.length > 0 && (
            <span className="text-xs text-muted">
              {platos.length} {platos.length === 1 ? 'plato' : 'platos'}
              {impacts.length > platos.length && ` · ${impacts.length - platos.length} elab.`}
            </span>
          )}
        </div>
        {!impacts ? (
          <div className="h-20 animate-pulse-soft rounded-xl bg-surface-2" />
        ) : impacts.length === 0 ? (
          <div className="rounded-xl bg-surface-2 px-3.5 py-4 text-sm text-muted">
            Todavía ningún escandallo lleva este producto. Cuando lo añadas a un plato, su coste saldrá con el rendimiento real.
            <div className="mt-2">
              <Link to="/platos" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Ir a escandallos <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        ) : (
          <>
            {changed.length > 0 && (
              <p className="mb-2.5 text-xs text-ink-2">
                {linked ? 'Sin esta prueba' : 'Con esta prueba'}, {changed.length === 1 ? 'el coste por ración cambiaría' : 'el coste medio por ración cambiaría'}{' '}
                <strong className={cx('font-bold', avgDelta > 0 ? 'text-bad' : 'text-ok')}>
                  {avgDelta > 0 ? '+' : '−'}
                  {fmtEur(Math.abs(avgDelta))}
                </strong>
                .
              </p>
            )}
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {visible.map((i) => {
                const delta = i.alt.costPerPortion - i.now.costPerPortion;
                const target = i.dish.targetFoodCostPct ?? business.targetFoodCostPct;
                const status = foodCostStatus(i.now.foodCostPct, target, business.warningFoodCostPct);
                return (
                  <li key={i.dish.id}>
                    <Link to={`/platos/${i.dish.id}`} className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-surface-2">
                      <ChefHat className="size-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink">{i.dish.name}</div>
                        <div className="text-[11px] text-muted">
                          {i.dish.kind === 'elaboracion' ? 'Elaboración' : i.dish.section || 'Plato'}
                          {!i.direct && ' · a través de una elaboración'}
                        </div>
                      </div>
                      <div className="tabular shrink-0 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-sm font-bold text-ink">{fmtEur(i.now.costPerPortion)}</span>
                          {i.dish.kind === 'plato' && i.now.foodCostPct != null && <FoodCostBadge pct={i.now.foodCostPct} status={status} />}
                        </div>
                        {Math.abs(delta) > 0.0005 ? (
                          <div className="text-[11px] text-muted">
                            {altLabel}: {fmtEur(i.alt.costPerPortion)}{' '}
                            <span className={cx('font-semibold', delta > 0 ? 'text-bad' : 'text-ok')}>
                              ({delta > 0 ? '+' : '−'}
                              {fmtEur(Math.abs(delta))})
                            </span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted">{i.direct ? 'La línea usa su propia merma' : 'Sin cambios'}</div>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {(impacts?.length ?? 0) > 6 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                {showAll ? 'Ver menos' : `Ver los ${impacts?.length} platos`}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
