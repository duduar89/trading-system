import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Boxes, FileText, Receipt, ShoppingCart, Truck } from 'lucide-react';
import { CATEGORY_LABELS } from '../../../lib/labels';
import { fmtEur, fmtPct } from '../../../lib/format';
import { Button, Callout, Card, CardHeader, EmptyState, Stat } from '../../ui';
import { ColumnChart, HBarList, fmtEurAxis } from '../../charts';
import { monthLabel } from '../dates';
import { fillMonths, topWithOther } from '../insights';
import type { ReportsData } from './useReportsData';

export function PurchasesTab({ data }: { data: ReportsData }) {
  const navigate = useNavigate();
  const stats = data.stats.value;
  const confirmed = useMemo(() => data.invoices.filter((i) => i.status === 'confirmada'), [data.invoices]);
  const pending = data.invoices.filter((i) => i.status === 'revision' || i.status === 'pendiente' || i.status === 'procesando').length;

  if (data.stats.error) {
    return (
      <Callout tone="bad" icon={<AlertTriangle className="size-4" />} title="No se pudo calcular el informe de compras">
        {data.stats.error}
      </Callout>
    );
  }
  if (!stats || !confirmed.length) {
    return (
      <EmptyState
        icon={<Receipt className="size-7" />}
        title="Aún no hay compras confirmadas"
        description={
          pending
            ? `Tienes ${pending} factura${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'} de revisar. Confírmalas para ver aquí tus compras por mes, proveedor y categoría.`
            : 'Sube tus facturas de proveedor: verás cuánto gastas por mes, por proveedor y en qué ingredientes.'
        }
        action={<Button onClick={() => navigate(pending ? '/facturas' : '/facturas?nuevo=1')}>{pending ? 'Revisar facturas' : 'Subir facturas'}</Button>}
      />
    );
  }

  const monthly = fillMonths(stats.monthlySpend).slice(-12);
  const total = monthly.reduce((s, m) => s + m.total, 0);
  const activeMonths = monthly.filter((m) => m.total > 0).length || 1;
  const suppliers = topWithOther(
    stats.spendBySupplier.map((s) => ({ key: s.supplier, name: s.supplier || 'Sin proveedor', total: s.total })),
    8,
    (t, n) => ({ key: '__otros', name: `Otros ${n} proveedores`, total: t }),
  );
  const categories = topWithOther(
    stats.spendByCategory.map((c) => ({ key: c.category as string, name: `${CATEGORY_LABELS[c.category]?.emoji ?? '📦'} ${CATEGORY_LABELS[c.category]?.label ?? c.category}`, total: c.total })),
    8,
    (t, n) => ({ key: '__otros', name: `Otras ${n} categorías`, total: t }),
  );
  const catTotal = stats.spendByCategory.reduce((s, c) => s + c.total, 0);
  const supTotal = stats.spendBySupplier.reduce((s, c) => s + c.total, 0);
  const top = stats.topProductsBySpend.slice(0, 12);
  const topTotal = stats.topProductsBySpend.reduce((s, p) => s + p.total, 0);
  const last = monthly[monthly.length - 1];

  return (
    <div className="space-y-4 sm:space-y-5">
      {pending > 0 && (
        <Callout tone="warn" icon={<FileText className="size-4" />} title={`${pending} factura${pending === 1 ? '' : 's'} sin confirmar`}>
          No cuentan en este informe hasta que las revises y confirmes.{' '}
          <button type="button" className="font-semibold text-ink underline" onClick={() => navigate('/facturas')}>
            Revisarlas ahora
          </button>
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Gasto total" value={fmtEur(total)} icon={<ShoppingCart className="size-4" />} tone="brand" hint={`${monthly.length} mes${monthly.length === 1 ? '' : 'es'}, sin IVA`} />
        <Stat label="Media mensual" value={fmtEur(total / activeMonths)} icon={<Receipt className="size-4" />} hint="meses con compras" />
        <Stat label="Facturas" value={confirmed.length} icon={<FileText className="size-4" />} hint={`ticket medio ${fmtEur(total / Math.max(1, confirmed.length))}`} />
        <Stat label="Proveedores" value={stats.spendBySupplier.length} icon={<Truck className="size-4" />} hint={suppliers[0] ? `el principal: ${fmtPct(supTotal ? (suppliers[0].total / supTotal) * 100 : 0, 0)}` : undefined} />
      </div>

      <Card>
        <CardHeader icon={<Receipt className="size-5" />} title="Gasto por mes" subtitle="Facturas confirmadas, importes sin IVA" />
        <ColumnChart
          data={monthly.map((m) => ({ key: m.month, label: monthLabel(m.month, monthly.length > 6 ? 'month' : 'short'), value: m.total, tooltipTitle: monthLabel(m.month, 'long') }))}
          height={260}
          formatValue={fmtEur}
          formatAxis={fmtEurAxis}
          valueLabel="Gasto sin IVA"
          highlightKey={last?.month}
          labelKeys={last ? [last.month] : []}
          ariaLabel="Gasto mensual en compras"
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Truck className="size-5" />} title="Por proveedor" subtitle="A quién le compras más" />
          <HBarList
            ariaLabel="Gasto por proveedor"
            dense
            items={suppliers.map((s) => ({
              id: s.key || s.name,
              label: s.name,
              value: s.total,
              display: fmtEur(s.total),
              sublabel: supTotal ? `${fmtPct((s.total / supTotal) * 100)} del total` : undefined,
              tone: 'brand',
            }))}
          />
        </Card>
        <Card>
          <CardHeader icon={<Boxes className="size-5" />} title="Por categoría" subtitle="En qué tipo de producto se va el dinero" />
          <HBarList
            ariaLabel="Gasto por categoría"
            dense
            items={categories.map((c) => ({
              id: c.key,
              label: c.name,
              value: c.total,
              display: fmtEur(c.total),
              sublabel: catTotal ? `${fmtPct((c.total / catTotal) * 100)} del total` : undefined,
              tone: 'brand',
            }))}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          icon={<ShoppingCart className="size-5" />}
          title="Ingredientes en los que más gastas"
          subtitle="Negociar el precio de estos pocos productos es lo que más impacto tiene en tu food cost."
        />
        {top.length === 0 ? (
          <p className="text-sm text-muted">Sin datos de productos todavía.</p>
        ) : (
          <HBarList
            ariaLabel="Ingredientes con mayor gasto"
            items={top.map((p, i) => ({
              id: p.productId,
              label: `${i + 1}. ${p.name}`,
              value: p.total,
              display: fmtEur(p.total),
              sublabel: topTotal ? `${fmtPct((p.total / topTotal) * 100)} del gasto en ingredientes` : undefined,
              tone: i < 3 ? 'brand' : 'neutral',
              to: `/ingredientes/${p.productId}`,
              title: `${p.name}: ${fmtEur(p.total)}`,
            }))}
          />
        )}
      </Card>
    </div>
  );
}
