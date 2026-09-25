import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, ArrowRight, Calculator, ChefHat, TrendingDown, TrendingUp } from 'lucide-react';
import { simulatePriceChange } from '../../../core/analytics';
import type { ID, IngredientCategory } from '../../../types';
import { CATEGORY_LABELS } from '../../../lib/labels';
import { fmtEur, perUnitLabel } from '../../../lib/format';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Field, FoodCostBadge, NumberInput, Select, Table, Td, Th, cx } from '../../ui';
import { productsInUse, simulationRows, simulationSummary } from '../insights';
import { fmtPp, fmtSignedEur, fmtSignedPct, safeCompute, fmtUnitPrice } from '../shared';
import type { ReportsData } from './useReportsData';

const MIN = -30;
const MAX = 50;
const QUICK = [-10, -5, 5, 10, 20];

export function SimulatorTab({ data }: { data: ReportsData }) {
  const navigate = useNavigate();
  const candidates = useMemo(() => productsInUse(data.products, data.dishes).filter((c) => c.product.pricePerBase > 0), [data.products, data.dishes]);
  const [productId, setProductId] = useState<ID | undefined>(undefined);
  const [pct, setPct] = useState(10);
  const selected = candidates.find((c) => c.product.id === productId) ?? candidates[0];
  const product = selected?.product;
  const newPrice = product ? product.pricePerBase * (1 + pct / 100) : 0;

  const grouped = useMemo(() => {
    const m = new Map<IngredientCategory, typeof candidates>();
    for (const c of [...candidates].sort((a, b) => a.product.name.localeCompare(b.product.name, 'es'))) {
      const list = m.get(c.product.category);
      if (list) list.push(c);
      else m.set(c.product.category, [c]);
    }
    return [...m.entries()].sort((a, b) => (CATEGORY_LABELS[a[0]]?.label ?? a[0]).localeCompare(CATEGORY_LABELS[b[0]]?.label ?? b[0], 'es'));
  }, [candidates]);

  const sim = useMemo(() => {
    if (!product) return undefined;
    return safeCompute(() => simulationRows(simulatePriceChange(data.ctx, product.id, newPrice), data.dishes, data.business));
  }, [product, newPrice, data.ctx, data.dishes, data.business]);
  const summary = sim?.value ? simulationSummary(sim.value) : undefined;

  if (!candidates.length) {
    return (
      <EmptyState
        icon={<Calculator className="size-7" />}
        title="Nada que simular todavía"
        description="El simulador calcula qué pasa en tus platos si un ingrediente sube o baja de precio. Necesitas escandallos con ingredientes vinculados y con precio."
        action={<Button onClick={() => navigate('/platos')}>Ir a escandallos</Button>}
      />
    );
  }

  const rows = sim?.value ?? [];
  const up = pct > 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card className="relative overflow-hidden">
        <div className="hero-mesh pointer-events-none absolute inset-0 opacity-25" aria-hidden />
        <div className="relative">
          <CardHeader
            icon={<Calculator className="size-5" />}
            title="¿Y si sube el precio?"
            subtitle="Elige un ingrediente y cambia su precio: verás al momento cómo afecta al food cost y al PVP recomendado de cada plato. No se guarda nada."
          />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="space-y-4">
              <Field
                label="Ingrediente"
                hint={
                  selected
                    ? `Se usa en ${selected.uses} plato${selected.uses === 1 ? '' : 's'} o elaboraci${selected.uses === 1 ? 'ón' : 'ones'}`
                    : undefined
                }
              >
                <Select value={product?.id ?? ''} onChange={(e) => setProductId(e.target.value)} className="h-12 text-base sm:text-sm">
                  {grouped.map(([cat, list]) => (
                    <optgroup key={cat} label={`${CATEGORY_LABELS[cat]?.emoji ?? ''} ${CATEGORY_LABELS[cat]?.label ?? cat}`}>
                      {list.map((c) => (
                        <option key={c.product.id} value={c.product.id}>
                          {c.product.name} · {fmtUnitPrice(c.product.pricePerBase)}/{c.product.baseUnit}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Variación">
                  <NumberInput value={pct} onValue={(v) => setPct(Math.max(-90, Math.min(300, v ?? 0)))} suffix="%" decimals={1} />
                </Field>
                <Field label={`Nuevo precio (${product ? perUnitLabel(product.baseUnit) : '€'})`}>
                  <NumberInput
                    value={product ? Math.round(newPrice * 10000) / 10000 : undefined}
                    onValue={(v) => {
                      if (!product || v == null || !(product.pricePerBase > 0)) return;
                      setPct(Math.max(-90, Math.min(300, ((v - product.pricePerBase) / product.pricePerBase) * 100)));
                    }}
                    suffix="€"
                    decimals={4}
                    min={0}
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">Precio simulado</div>
                  <div className="tabular font-display text-3xl font-extrabold text-ink">
                    {fmtUnitPrice(newPrice)}
                    <span className="text-base font-bold text-muted">/{product?.baseUnit}</span>
                  </div>
                  <div className="tabular text-xs text-muted">ahora {fmtUnitPrice(product?.pricePerBase)}</div>
                </div>
                <span
                  className={cx(
                    'inline-flex items-center gap-1 rounded-xl px-3 py-1.5 font-display text-xl font-extrabold',
                    up ? 'bg-bad-soft text-bad' : pct < 0 ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-muted',
                  )}
                >
                  {up ? <TrendingUp className="size-5" /> : pct < 0 ? <TrendingDown className="size-5" /> : null}
                  {fmtSignedPct(pct, pct % 1 === 0 ? 0 : 1)}
                </span>
              </div>
              <label className="mt-4 block">
                <span className="sr-only">Variación del precio en porcentaje</span>
                <input
                  type="range"
                  min={MIN}
                  max={MAX}
                  step={1}
                  value={Math.max(MIN, Math.min(MAX, Math.round(pct)))}
                  onChange={(e) => setPct(Number(e.target.value))}
                  className="h-10 w-full cursor-pointer accent-brand-500"
                  aria-valuetext={fmtSignedPct(pct, 0)}
                />
              </label>
              <div className="flex justify-between text-[10px] font-semibold text-muted">
                <span>{MIN} %</span>
                <span>0</span>
                <span>+{MAX} %</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setPct(q)}
                    className={cx(
                      'h-9 rounded-full border px-3 text-xs font-bold transition',
                      Math.abs(pct - q) < 0.01
                        ? 'border-brand-500 bg-brand-500 text-white'
                        : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong',
                    )}
                  >
                    {q > 0 ? `+${q}` : q} %
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {sim?.error ? (
        <Callout tone="bad" icon={<AlertTriangle className="size-4" />} title="No se pudo simular">
          {sim.error}
        </Callout>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: 'Platos afectados',
                  value: String(summary.affected),
                  tone: 'text-ink',
                  hint: summary.affectedElaborations
                    ? `y ${summary.affectedElaborations} elaboraci${summary.affectedElaborations === 1 ? 'ón' : 'ones'}`
                    : undefined,
                },
                {
                  label: 'Food cost medio',
                  value: fmtPp(summary.avgDeltaFc),
                  tone: (summary.avgDeltaFc ?? 0) > 0.05 ? 'text-bad' : (summary.avgDeltaFc ?? 0) < -0.05 ? 'text-ok' : 'text-ink',
                },
                { label: 'Empeoran de color', value: String(summary.worsened), tone: summary.worsened ? 'text-bad' : 'text-ink' },
                { label: 'Mejoran de color', value: String(summary.improved), tone: summary.improved ? 'text-ok' : 'text-ink' },
              ].map((k) => (
                <div key={k.label} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">{k.label}</div>
                  <div className={cx('tabular mt-1 font-display text-2xl font-extrabold', k.tone)}>{k.value}</div>
                  {'hint' in k && k.hint && <div className="text-xs text-muted">{k.hint}</div>}
                </div>
              ))}
            </div>
          )}

          <Card padded={false}>
            <div className="p-4 pb-3 sm:p-5 sm:pb-3">
              <CardHeader icon={<ChefHat className="size-5" />} title="Impacto por plato" subtitle="Primero los platos de carta, ordenados por el cambio de coste por ración; después, las elaboraciones." />
            </div>
            {rows.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">Este ingrediente no afecta a ningún plato con coste calculable.</p>
            ) : (
              <>
                <ul className="divide-y divide-line border-t border-line sm:hidden">
                  {rows.map((r) => (
                    <li key={r.dishId}>
                      <button
                        type="button"
                        onClick={() => navigate(`/platos/${r.dishId}`)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{r.name}</span>
                          <span className="tabular block text-xs text-muted">
                            coste {fmtEur(r.costBefore)} → {fmtEur(r.costAfter)}
                            {r.kind === 'plato' && r.suggestedAfter != null
                              ? ` · sugerido ${fmtEur(r.suggestedAfter)}`
                              : r.kind === 'elaboracion'
                                ? ' · elaboración'
                                : ''}
                          </span>
                          {r.fcBefore != null && (
                            <span className="mt-1 flex items-center gap-1.5">
                              <FoodCostBadge pct={r.fcBefore} status={r.statusBefore} />
                              <ArrowRight className="size-3 text-muted" aria-label="pasa a" />
                              <FoodCostBadge pct={r.fcAfter} status={r.statusAfter} />
                            </span>
                          )}
                        </span>
                        <span
                          className={cx(
                            'tabular shrink-0 text-sm font-bold',
                            r.deltaCost > 0.0005 ? 'text-bad' : r.deltaCost < -0.0005 ? 'text-ok' : 'text-ink',
                          )}
                        >
                          {fmtSignedEur(r.deltaCost)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Table className="hidden rounded-none border-x-0 border-b-0 sm:block">
                  <thead>
                    <tr>
                      <Th>Plato</Th>
                      <Th>Food cost antes → después</Th>
                      <Th align="right">Δ coste ración</Th>
                      <Th align="right">PVP carta</Th>
                      <Th align="right">PVP sugerido</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.dishId} className="cursor-pointer transition hover:bg-surface-2" onClick={() => navigate(`/platos/${r.dishId}`)}>
                        <Td className="max-w-[240px]">
                          <span className="block truncate font-semibold text-ink">{r.name}</span>
                          <span className="tabular block text-xs text-muted">
                            {fmtEur(r.costBefore)} → {fmtEur(r.costAfter)}
                            {r.kind === 'elaboracion' && ' · elaboración'}
                          </span>
                        </Td>
                        <Td>
                          {r.fcBefore != null ? (
                            <span className="inline-flex items-center gap-1.5">
                              <FoodCostBadge pct={r.fcBefore} status={r.statusBefore} />
                              <ArrowRight className="size-3.5 text-muted" aria-label="pasa a" />
                              <FoodCostBadge pct={r.fcAfter} status={r.statusAfter} />
                            </span>
                          ) : (
                            <span className="text-xs text-muted">{r.kind === 'elaboracion' ? 'elaboración (sin PVP)' : 'sin PVP'}</span>
                          )}
                        </Td>
                        <Td
                          align="right"
                          className={cx(
                            'whitespace-nowrap font-semibold',
                            r.deltaCost > 0.0005 ? 'text-bad' : r.deltaCost < -0.0005 ? 'text-ok' : 'text-ink',
                          )}
                        >
                          {fmtSignedEur(r.deltaCost)}
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          {fmtEur(r.menuPrice)}
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          {r.kind === 'plato' ? (
                            <>
                              <span className="font-semibold text-ink">{fmtEur(r.suggestedAfter)}</span>
                              {r.suggestedBefore != null && r.suggestedAfter != null && Math.abs(r.suggestedAfter - r.suggestedBefore) > 0.004 && (
                                <Badge tone={r.suggestedAfter > r.suggestedBefore ? 'bad' : 'ok'} className="ml-1.5">
                                  {fmtSignedEur(r.suggestedAfter - r.suggestedBefore)}
                                </Badge>
                              )}
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
