import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowRight, LineChart, TrendingDown, TrendingUp } from 'lucide-react';
import { priceAlerts } from '../../../core/analytics';
import type { ID, PricePoint } from '../../../types';
import { CATEGORY_LABELS } from '../../../lib/labels';
import { fmtDate, perUnitLabel } from '../../../lib/format';
import { Badge, Callout, Card, CardHeader, EmptyState, SearchInput, Table, Td, Th, cx } from '../../ui';
import { ChartEmpty, TrendLine, fmtEurAxis } from '../../charts';
import { shortDay } from '../dates';
import { priceSeries, priceSummary } from '../insights';
import { fmtSignedPct, safeCompute, fmtUnitPrice } from '../shared';
import type { ReportsData } from './useReportsData';

/** Texto para búsqueda: sin tildes ni mayúsculas. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const SOURCE_LABEL: Record<PricePoint['source'], string> = { factura: 'Factura', manual: 'Manual', demo: 'Ejemplo', hoja: 'Tarifa' };

export function PriceEvolutionTab({ data }: { data: ReportsData }) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const pointsByProduct = useMemo(() => {
    const m = new Map<ID, PricePoint[]>();
    for (const p of data.pricePoints) {
      const list = m.get(p.productId);
      if (list) list.push(p);
      else m.set(p.productId, [p]);
    }
    return m;
  }, [data.pricePoints]);

  const alerts = useMemo(() => safeCompute(() => priceAlerts(data.products, data.pricePoints, 0, data.dishes)), [data.products, data.pricePoints, data.dishes]);
  const supplierName = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s.name])), [data.suppliers]);

  const list = useMemo(() => {
    const q = norm(query.trim());
    return data.products
      .map((p) => {
        const series = priceSeries(pointsByProduct.get(p.id) ?? []);
        return { product: p, series, summary: priceSummary(series) };
      })
      .filter((x) => x.series.length > 0 && (!q || norm(x.product.name).includes(q) || x.product.aliases.some((a) => norm(a).includes(q))))
      .sort((a, b) => Math.abs(b.summary?.changePct ?? 0) - Math.abs(a.summary?.changePct ?? 0) || a.product.name.localeCompare(b.product.name, 'es'));
  }, [data.products, pointsByProduct, query]);

  const requested = params.get('producto');
  const selectedId =
    (requested && data.products.some((p) => p.id === requested) ? requested : undefined) ??
    alerts.value?.[0]?.productId ??
    list.find((x) => x.series.length > 1)?.product.id ??
    list[0]?.product.id;
  const selected = data.products.find((p) => p.id === selectedId);
  const series = useMemo(() => priceSeries(selectedId ? (pointsByProduct.get(selectedId) ?? []) : []), [pointsByProduct, selectedId]);
  const summary = priceSummary(series);

  const select = (id: ID) => {
    const next = new URLSearchParams(params);
    next.set('producto', id);
    setParams(next, { replace: true });
  };

  if (!data.pricePoints.length) {
    return (
      <EmptyState
        icon={<LineChart className="size-7" />}
        title="Todavía no hay histórico de precios"
        description="Cada factura confirmada guarda el precio de cada ingrediente. Con dos o más compras verás aquí cómo evoluciona."
        action={
          <Link to="/facturas?nuevo=1" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
            Subir facturas <ArrowRight className="size-4" />
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card padded={false} className="flex flex-col overflow-hidden lg:max-h-[640px]">
          <div className="border-b border-line p-3">
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar ingrediente…" />
          </div>
          <ul className="max-h-64 min-h-0 flex-1 overflow-y-auto p-1.5 lg:max-h-none" aria-label="Ingredientes con histórico de precios">
            {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Ningún ingrediente coincide con «{query}».</li>}
            {list.map(({ product, series: s, summary: sum }) => {
              const active = product.id === selectedId;
              const ch = sum?.changePct ?? 0;
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => select(product.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cx(
                      'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition',
                      active ? 'bg-brand-500/10 ring-1 ring-brand-500/40' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="text-base" aria-hidden>
                      {CATEGORY_LABELS[product.category]?.emoji ?? '📦'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{product.name}</span>
                      <span className="tabular block text-[11px] text-muted">
                        {fmtUnitPrice(sum?.last.price)}/{product.baseUnit} · {s.length} precio{s.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    {s.length > 1 && Math.abs(ch) >= 0.05 && (
                      <Badge tone={ch > 0 ? 'bad' : 'ok'} className="tabular">
                        {fmtSignedPct(ch)}
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          {selected && summary ? (
            <>
              <CardHeader
                icon={<LineChart className="size-5" />}
                title={selected.name}
                subtitle={`${CATEGORY_LABELS[selected.category]?.label ?? ''} · precio sin IVA en ${perUnitLabel(selected.baseUnit)}`}
                action={
                  <Link to={`/ingredientes/${selected.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                    Ficha <ArrowRight className="size-4" />
                  </Link>
                }
              />
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Precio actual', value: fmtUnitPrice(summary.last.price), strong: true },
                  { label: 'Variación', value: series.length > 1 ? fmtSignedPct(summary.changePct) : '—', tone: summary.changePct > 0.05 ? 'text-bad' : summary.changePct < -0.05 ? 'text-ok' : 'text-ink' },
                  { label: 'Mínimo', value: fmtUnitPrice(summary.min) },
                  { label: 'Máximo', value: fmtUnitPrice(summary.max) },
                ].map((k) => (
                  <div key={k.label} className="rounded-xl bg-surface-2 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{k.label}</div>
                    <div className={cx('tabular font-display text-lg font-extrabold', k.tone ?? 'text-ink')}>{k.value}</div>
                  </div>
                ))}
              </div>
              {series.length > 1 ? (
                <TrendLine
                  ariaLabel={`Evolución del precio de ${selected.name}`}
                  data={series.map((p) => ({
                    key: p.date,
                    label: shortDay(p.date),
                    value: p.price,
                    tooltipTitle: fmtDate(p.date),
                    tooltipNote: [p.supplierId ? supplierName.get(p.supplierId) : undefined, SOURCE_LABEL[p.source]].filter(Boolean).join(' · '),
                  }))}
                  formatValue={(v) => `${fmtUnitPrice(v)}/${selected.baseUnit}`}
                  formatAxis={(v) => fmtEurAxis(v)}
                  valueLabel={`precio ${perUnitLabel(selected.baseUnit)}`}
                  reference={{ value: summary.avg, label: `Media ${fmtUnitPrice(summary.avg)}` }}
                />
              ) : (
                <ChartEmpty title="Solo hay un precio registrado" description="Con la próxima factura de este ingrediente verás su evolución." />
              )}
              <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-line">
                <table className="tabular w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
                      <th className="px-3 py-2 text-left font-bold">Fecha</th>
                      <th className="px-3 py-2 text-right font-bold">Precio</th>
                      <th className="hidden px-3 py-2 text-left font-bold sm:table-cell">Proveedor</th>
                      <th className="px-3 py-2 text-left font-bold">Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().map((p, i, arr) => {
                      const prev = arr[i + 1];
                      const ch = prev && prev.price > 0 ? ((p.price - prev.price) / prev.price) * 100 : undefined;
                      return (
                        <tr key={p.date} className="border-t border-line">
                          <td className="px-3 py-2 text-ink-2">{fmtDate(p.date)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-ink">
                            {fmtUnitPrice(p.price)}
                            {ch != null && Math.abs(ch) >= 0.05 && (
                              <span className={cx('ml-1.5 text-[11px] font-bold', ch > 0 ? 'text-bad' : 'text-ok')}>{fmtSignedPct(ch)}</span>
                            )}
                          </td>
                          <td className="hidden max-w-[180px] truncate px-3 py-2 text-ink-2 sm:table-cell">{(p.supplierId && supplierName.get(p.supplierId)) || '—'}</td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-muted" title={p.rawDescription}>
                            {SOURCE_LABEL[p.source]}
                            {p.rawDescription ? ` · ${p.rawDescription}` : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <ChartEmpty title="Elige un ingrediente" description="Selecciona un ingrediente de la lista para ver la evolución de su precio." />
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardHeader
            icon={<TrendingUp className="size-5" />}
            title="Mayores cambios de precio"
            subtitle="Último precio frente al anterior de cada ingrediente. Las subidas primero."
          />
        </div>
        {alerts.error ? (
          <div className="px-4 pb-4 sm:px-5">
            <Callout tone="bad" icon={<AlertTriangle className="size-4" />}>
              No se pudieron calcular los cambios: {alerts.error}
            </Callout>
          </div>
        ) : !alerts.value?.length ? (
          <p className="px-5 pb-5 text-sm text-muted">Aún no hay ingredientes con dos precios distintos.</p>
        ) : (
          <Table className="rounded-none border-x-0 border-b-0">
            <thead>
              <tr>
                <Th>Ingrediente</Th>
                <Th align="right">Antes</Th>
                <Th align="right">Ahora</Th>
                <Th align="right">Variación</Th>
                <Th>Fecha</Th>
                <Th align="right">Platos</Th>
              </tr>
            </thead>
            <tbody>
              {alerts.value.slice(0, 20).map((a) => {
                const up = a.changePct > 0;
                return (
                  <tr key={a.productId} className="cursor-pointer transition hover:bg-surface-2" onClick={() => select(a.productId)}>
                    <Td className="max-w-[240px]">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        {up ? <TrendingUp className="size-4 shrink-0 text-bad" aria-hidden /> : <TrendingDown className="size-4 shrink-0 text-ok" aria-hidden />}
                        <span className="truncate">{a.productName}</span>
                      </span>
                    </Td>
                    <Td align="right">
                      {fmtUnitPrice(a.previousPrice)}/{a.baseUnit}
                    </Td>
                    <Td align="right" className="font-semibold text-ink">
                      {fmtUnitPrice(a.currentPrice)}/{a.baseUnit}
                    </Td>
                    <Td align="right">
                      <Badge tone={up ? 'bad' : 'ok'} className="tabular">
                        {fmtSignedPct(a.changePct)}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(a.currentDate)}</Td>
                    <Td align="right">{a.affectedDishIds.length}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
