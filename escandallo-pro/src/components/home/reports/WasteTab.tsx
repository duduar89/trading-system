import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, ChefHat, Coins, FlaskConical, Scale, Trash2 } from 'lucide-react';
import { CATEGORY_LABELS } from '../../../lib/labels';
import { fmtEur, fmtKg, fmtPct } from '../../../lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, Stat, Table, Td, Th } from '../../ui';
import { HBarList } from '../../charts';
import { dishWasteRows, productWasteRows } from '../insights';
import { fmtUnitPrice } from '../shared';
import type { ReportsData } from './useReportsData';

export function WasteTab({ data }: { data: ReportsData }) {
  const navigate = useNavigate();
  const dishRows = useMemo(() => dishWasteRows(data.dishes, data.costs), [data.dishes, data.costs]);
  const productRows = useMemo(() => productWasteRows(data.products, data.yieldTests, data.dishes), [data.products, data.yieldTests, data.dishes]);

  if (!dishRows.length && !productRows.length) {
    return (
      <EmptyState
        icon={<Scale className="size-7" />}
        title="Aún no hay mermas que analizar"
        description="Cuando tus escandallos tengan ingredientes con merma de limpieza o de cocción (o hagas pruebas de rendimiento) verás aquí dónde pierdes dinero."
        action={<Button onClick={() => navigate('/mermas?nuevo=1')}>Hacer una prueba de rendimiento</Button>}
      />
    );
  }

  const avgWaste = data.stats.value?.avgWastePct ?? (dishRows.length ? dishRows.reduce((s, r) => s + r.wastePct, 0) / dishRows.length : undefined);
  const avgWasteCost = dishRows.length ? dishRows.reduce((s, r) => s + r.wasteCostPerPortion, 0) / dishRows.length : undefined;
  const withSales = dishRows.filter((r) => r.periodWasteCost != null);
  const periodWaste = withSales.reduce((s, r) => s + (r.periodWasteCost ?? 0), 0);
  const byWeight = [...dishRows].sort((a, b) => b.wastePct - a.wastePct).slice(0, 10);
  const byCost = dishRows.slice(0, 10);
  const noTest = productRows.filter((p) => p.source === 'producto' && p.usedInDishes > 0 && p.baseUnit === 'kg').slice(0, 3);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Merma media" value={fmtPct(avgWaste)} icon={<Scale className="size-4" />} tone="warn" hint="en peso, de la compra al plato" />
        <Stat label="Merma por ración" value={fmtEur(avgWasteCost)} icon={<Coins className="size-4" />} tone="bad" hint="coste medio que se pierde" />
        <Stat
          label="Merma en el periodo"
          value={withSales.length ? fmtEur(periodWaste) : '—'}
          icon={<Trash2 className="size-4" />}
          hint={
            withSales.length ? `según las ventas de ${withSales.length} plato${withSales.length === 1 ? '' : 's'}` : 'añade las unidades vendidas'
          }
        />
        <Link to="/mermas" className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
          <Stat
            label="Pruebas de rendimiento"
            value={data.yieldTests.length}
            icon={<FlaskConical className="size-4" />}
            tone="ai"
            hint={
              <span className="inline-flex items-center gap-1 font-semibold text-brand-600 dark:text-brand-400">
                Ver mermas <ArrowRight className="size-3" />
              </span>
            }
            className="h-full transition group-hover:-translate-y-0.5 group-hover:shadow-pop"
          />
        </Link>
      </div>

      {dishRows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              icon={<Coins className="size-5" />}
              title="Platos que más pierden en euros"
              subtitle="Coste de la merma por ración: lo que pagas y no llega al plato."
            />
            <HBarList
              ariaLabel="Platos con mayor coste de merma por ración"
              items={byCost.map((r) => ({
                id: r.id,
                label: r.name,
                sublabel: `${fmtPct(r.wasteShareOfCost, 0)} del coste de la ración · ${fmtKg(r.wasteKgPerPortion)} de merma`,
                value: r.wasteCostPerPortion,
                display: fmtEur(r.wasteCostPerPortion),
                tone: 'bad',
                to: `/platos/${r.id}`,
                title: `${r.name}: ${fmtEur(r.wasteCostPerPortion)} de merma por ración`,
              }))}
            />
          </Card>
          <Card>
            <CardHeader
              icon={<Scale className="size-5" />}
              title="Platos con más merma en peso"
              subtitle="% del peso comprado que no se sirve (limpieza + cocción)."
            />
            <HBarList
              ariaLabel="Platos con mayor porcentaje de merma"
              max={100}
              items={byWeight.map((r) => ({
                id: r.id,
                label: r.name,
                sublabel: `${fmtKg(r.wasteKgPerPortion)} por ración`,
                value: r.wastePct,
                display: fmtPct(r.wastePct, 0),
                tone: 'warn',
                to: `/platos/${r.id}`,
                title: `${r.name}: ${fmtPct(r.wastePct)} de merma`,
              }))}
            />
          </Card>
        </div>
      )}

      {productRows.length > 0 && (
        <Card padded={false}>
          <div className="p-4 pb-3 sm:p-5 sm:pb-3">
            <CardHeader
              icon={<Trash2 className="size-5" />}
              title="Ingredientes que más merman"
              subtitle="Ordenados por el dinero que se pierde en limpieza por cada unidad comprada. El «precio real» es lo que te cuesta cada kilo limpio."
            />
          </div>
          <Table className="rounded-none border-x-0 border-b-0">
            <thead>
              <tr>
                <Th>Ingrediente</Th>
                <Th align="right">Limpieza</Th>
                <Th align="right">Cocción</Th>
                <Th align="right">Pérdida total</Th>
                <Th align="right">Precio compra</Th>
                <Th align="right">Precio real</Th>
                <Th align="right">Pierdes</Th>
                <Th>Dato</Th>
              </tr>
            </thead>
            <tbody>
              {productRows.slice(0, 25).map((p) => (
                <tr key={p.id} className="cursor-pointer transition hover:bg-surface-2" onClick={() => navigate(`/ingredientes/${p.id}`)}>
                  <Td className="max-w-[220px]">
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{CATEGORY_LABELS[p.category]?.emoji ?? '📦'}</span>
                      <span className="truncate font-semibold text-ink">{p.name}</span>
                    </span>
                    {p.usedInDishes > 0 && (
                      <span className="block text-xs text-muted">
                        en {p.usedInDishes} plato{p.usedInDishes === 1 ? '' : 's'}
                      </span>
                    )}
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    {fmtPct(p.cleaningPct, 0)}
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    {fmtPct(p.cookingPct, 0)}
                  </Td>
                  <Td align="right" className="whitespace-nowrap font-semibold text-ink">
                    {fmtPct(p.totalLossPct, 0)}
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    {p.pricePerBase > 0 ? `${fmtUnitPrice(p.pricePerBase)}/${p.baseUnit}` : '—'}
                  </Td>
                  <Td align="right" className="whitespace-nowrap font-semibold text-ink">
                    {p.pricePerBase > 0 ? `${fmtUnitPrice(p.realPricePerUsable)}/${p.baseUnit}` : '—'}
                  </Td>
                  <Td align="right" className="whitespace-nowrap font-semibold text-bad">
                    {p.lossPerBase > 0 ? `${fmtUnitPrice(p.lossPerBase)}/${p.baseUnit}` : '—'}
                  </Td>
                  <Td>{p.source === 'prueba' ? <Badge tone="ok">Prueba real</Badge> : <Badge tone="neutral">Estimada</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {noTest.length > 0 && (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ai-soft text-ai">
            <FlaskConical className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-bold text-ink">Afina tus mermas con una prueba de rendimiento</div>
            <p className="text-sm text-muted">
              Las mermas de {noTest.map((p) => p.name).join(', ')} son estimadas. Pesa una pieza antes y después de limpiarla y tendrás el coste real
              por kilo aprovechable.
            </p>
          </div>
          <Button onClick={() => navigate('/mermas?nuevo=1')} icon={<ChefHat className="size-4" />}>
            Nueva prueba
          </Button>
        </Card>
      )}
    </div>
  );
}
