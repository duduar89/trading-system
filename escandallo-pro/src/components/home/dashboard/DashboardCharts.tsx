import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, Camera, ChevronDown, ChevronUp, FileText, PieChart, Receipt } from 'lucide-react';
import type { BusinessSettings, IngredientCategory } from '../../../types';
import { CATEGORY_LABELS } from '../../../lib/labels';
import { fmtEur, fmtPct } from '../../../lib/format';
import { Button, Card, CardHeader } from '../../ui';
import { ChartEmpty, ChartLegend, ColumnChart, HBarList, fmtEurAxis, statusColor, useChartTheme, STATUS_LEGEND } from '../../charts';
import { monthLabel } from '../dates';
import { bucketStatus, fillMonths, prettyBucketLabel, topWithOther, type DishFcRow } from '../insights';

/** Food cost de cada plato, de mayor a menor, con la línea del objetivo. */
export function FoodCostByDishCard({ rows, business, className }: { rows: DishFcRow[]; business: BusinessSettings; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const LIMIT = 10;
  const visible = expanded ? rows : rows.slice(0, LIMIT);
  const t = useChartTheme();
  return (
    <Card className={className}>
      <CardHeader
        icon={<BarChart3 className="size-5" />}
        title="Food cost por plato"
        subtitle="De mayor a menor. Toca un plato para abrir su escandallo."
      />
      {rows.length === 0 ? (
        <ChartEmpty
          icon={<Camera className="size-5" />}
          title="Aún no hay platos con PVP y coste"
          description="Fotografía tu carta o crea un escandallo: aquí verás qué platos te hacen ganar dinero y cuáles no."
          action={
            <Button size="sm" onClick={() => navigate('/carta?nuevo=1')} icon={<Camera className="size-4" />}>
              Fotografiar carta
            </Button>
          }
        />
      ) : (
        <>
          <HBarList
            ariaLabel="Food cost por plato"
            statusIcons
            reference={{ value: business.targetFoodCostPct, label: `Objetivo ${fmtPct(business.targetFoodCostPct, 0)}` }}
            items={visible.map((r) => ({
              id: r.id,
              label: r.name,
              sublabel: [r.section, `coste ${fmtEur(r.costPerPortion)} · PVP ${fmtEur(r.menuPrice)}`].filter(Boolean).join(' · '),
              value: r.foodCostPct,
              display: fmtPct(r.foodCostPct),
              tone: r.status,
              to: `/platos/${r.id}`,
              title: `${r.name}: food cost ${fmtPct(r.foodCostPct)} (${STATUS_LEGEND[r.status === 'none' ? 'ok' : r.status]})`,
            }))}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <ChartLegend
              items={[
                { key: 'ok', color: t.ok, label: `${STATUS_LEGEND.ok} (≤ ${fmtPct(business.targetFoodCostPct, 0)})` },
                { key: 'warn', color: t.warn, label: `${STATUS_LEGEND.warn} (≤ ${fmtPct(business.warningFoodCostPct, 0)})` },
                { key: 'bad', color: t.bad, label: STATUS_LEGEND.bad },
              ]}
            />
            {rows.length > LIMIT && (
              <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)} iconRight={expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}>
                {expanded ? 'Ver menos' : `Ver los ${rows.length} platos`}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/** Distribución de platos por tramos de food cost. */
export function BucketsCard({ buckets, business, className }: { buckets: { label: string; count: number }[]; business: BusinessSettings; className?: string }) {
  const t = useChartTheme();
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const data = buckets.map((b) => {
    const st = bucketStatus(b.label, business);
    return {
      key: b.label,
      label: prettyBucketLabel(b.label),
      value: b.count,
      color: statusColor(st, t),
      tooltipTitle: `Food cost ${prettyBucketLabel(b.label)}`,
      tooltipNote: total ? `${fmtPct((b.count / total) * 100, 0)} de los platos` : undefined,
    };
  });
  return (
    <Card className={className}>
      <CardHeader icon={<PieChart className="size-5" />} title="Distribución por tramos" subtitle="Cuántos platos hay en cada franja de food cost." />
      {total === 0 ? (
        <ChartEmpty title="Sin platos que repartir" description="Cuando tengas platos con PVP y coste verás aquí cómo se reparten." />
      ) : (
        <>
          <ColumnChart
            data={data}
            height={210}
            formatValue={(v) => `${v} plato${v === 1 ? '' : 's'}`}
            formatAxis={(v) => String(v)}
            formatLabel={(v) => String(v)}
            valueLabel="platos"
            labelKeys={data.filter((d) => d.value > 0).map((d) => d.key)}
            allowDecimals={false}
            allTicks
            yAxisWidth={32}
            ariaLabel="Número de platos por tramo de food cost"
          />
          <ChartLegend
            className="mt-2"
            items={[
              { key: 'ok', color: t.ok, label: STATUS_LEGEND.ok },
              { key: 'warn', color: t.warn, label: STATUS_LEGEND.warn },
              { key: 'bad', color: t.bad, label: STATUS_LEGEND.bad },
            ]}
          />
        </>
      )}
    </Card>
  );
}

/** Gasto mensual en compras (facturas confirmadas, sin IVA). */
export function MonthlySpendCard({ monthly, className }: { monthly: { month: string; total: number }[]; className?: string }) {
  const navigate = useNavigate();
  const data = useMemo(() => {
    const filled = fillMonths(monthly).slice(-12);
    return filled.map((m) => ({ key: m.month, label: monthLabel(m.month, filled.length > 6 ? 'month' : 'short'), value: m.total, tooltipTitle: monthLabel(m.month, 'long') }));
  }, [monthly]);
  const last = data[data.length - 1];
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  const maxKey = data.find((d) => d.value === max)?.key;
  const avg = data.length ? data.reduce((s, d) => s + d.value, 0) / data.length : 0;
  return (
    <Card className={className}>
      <CardHeader
        icon={<Receipt className="size-5" />}
        title="Gasto mensual en compras"
        subtitle={data.length ? `Facturas confirmadas, sin IVA · media ${fmtEur(avg)}/mes` : 'Facturas confirmadas, sin IVA'}
      />
      {data.length === 0 ? (
        <ChartEmpty
          icon={<FileText className="size-5" />}
          title="Aún no hay facturas confirmadas"
          description="Sube tus facturas de proveedor y confírmalas: verás cuánto gastas cada mes."
          action={
            <Button size="sm" onClick={() => navigate('/facturas?nuevo=1')} icon={<FileText className="size-4" />}>
              Subir facturas
            </Button>
          }
        />
      ) : (
        <ColumnChart
          data={data}
          height={230}
          formatValue={fmtEur}
          formatAxis={fmtEurAxis}
          valueLabel="Gasto sin IVA"
          highlightKey={last?.key}
          labelKeys={[last?.key, maxKey].filter((k): k is string => !!k)}
          ariaLabel="Gasto mensual en compras sin IVA"
          onSelect={() => navigate('/informes?tab=compras')}
        />
      )}
    </Card>
  );
}

/** Gasto por categoría de ingrediente (top 7 + otros). */
export function CategorySpendCard({ byCategory, className }: { byCategory: { category: IngredientCategory; total: number }[]; className?: string }) {
  const total = byCategory.reduce((s, c) => s + c.total, 0);
  const items = topWithOther(
    byCategory.map((c) => ({ key: c.category as string, name: `${CATEGORY_LABELS[c.category]?.emoji ?? '📦'} ${CATEGORY_LABELS[c.category]?.label ?? c.category}`, total: c.total })),
    7,
    (t, n) => ({ key: '__otros', name: `Otras ${n} categorías`, total: t }),
  );
  return (
    <Card className={className}>
      <CardHeader icon={<PieChart className="size-5" />} title="Gasto por categoría" subtitle={total ? `${fmtEur(total)} en el periodo analizado` : 'Dónde se va tu dinero'} />
      {items.length === 0 ? (
        <ChartEmpty title="Sin compras que analizar" description="Confirma tus facturas para ver en qué categorías gastas más." />
      ) : (
        <HBarList
          ariaLabel="Gasto por categoría de ingrediente"
          dense
          items={items.map((c) => ({
            id: c.key,
            label: c.name,
            value: c.total,
            display: fmtEur(c.total),
            sublabel: total ? `${fmtPct((c.total / total) * 100)} del total` : undefined,
            tone: 'brand',
            to: '/informes?tab=compras',
            title: `${c.name}: ${fmtEur(c.total)}`,
          }))}
        />
      )}
    </Card>
  );
}
