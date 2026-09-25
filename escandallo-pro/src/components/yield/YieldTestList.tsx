import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { ChevronRight, Link2, Scale } from 'lucide-react';
import type { Product, YieldResult, YieldTest } from '../../types';
import { Badge, SearchInput, Segmented, Table, Td, Th, cx } from '../ui';
import { fmtDate, fmtEur, fmtNum, fmtPct } from '../../lib/format';
import { CATEGORY_LABELS } from '../../lib/labels';
import { computeWithCurrentPrice, effectivePurchasePrice, pieceSegments } from './model';
import { PieceBar } from './PieceBar';
import { normalizeQuery } from './productSearch';

export interface YieldRow {
  test: YieldTest;
  product?: Product;
  linked: boolean;
  price: number;
  result: YieldResult;
  /** Coste real €/kg útil / precio de compra. */
  factor: number;
}

/** Filas calculadas con el precio vigente de cada producto (el mismo que usan los escandallos). */
export function buildYieldRows(tests: YieldTest[], products: Product[]): YieldRow[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return tests.map((test) => {
    const product = test.productId ? byId.get(test.productId) : undefined;
    const price = effectivePurchasePrice(test, product);
    const result = computeWithCurrentPrice(test, product);
    return {
      test,
      product,
      linked: !!product && product.yieldTestId === test.id,
      price,
      result,
      factor: price > 0 && result.principalKg > 0 ? result.costPerUsableKg / price : 0,
    };
  });
}

type Filter = 'todas' | 'vinculadas' | 'sin';

/** Listado de pruebas: tabla en escritorio y tarjetas en móvil. */
export function YieldTestList({ rows }: { rows: YieldRow[] }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('todas');

  const filtered = useMemo(() => {
    const nq = normalizeQuery(q);
    return rows.filter((r) => {
      if (filter === 'vinculadas' && !r.linked) return false;
      if (filter === 'sin' && r.linked) return false;
      if (!nq) return true;
      return normalizeQuery(`${r.test.name} ${r.product?.name ?? ''}`).includes(nq);
    });
  }, [rows, q, filter]);

  const linkedCount = rows.filter((r) => r.linked).length;
  const open = (id: string) => navigate(`/mermas/${id}`);

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar prueba o producto…" className="sm:max-w-xs sm:flex-1" />
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          size="sm"
          className="self-start sm:self-auto"
          options={[
            { value: 'todas', label: `Todas (${rows.length})` },
            { value: 'vinculadas', label: `En uso (${linkedCount})` },
            { value: 'sin', label: `Sin aplicar (${rows.length - linkedCount})` },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted">Ninguna prueba coincide con la búsqueda.</div>
      ) : (
        <>
          {/* Escritorio / tableta */}
          <Table className="hidden md:block">
            <thead>
              <tr>
                <Th>Prueba</Th>
                <Th>Fecha</Th>
                <Th className="w-[22%]">Rendimiento</Th>
                <Th align="right">Merma total</Th>
                <Th align="right">Coste real</Th>
                <Th align="center">Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.test.id}
                  onClick={() => open(r.test.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(r.test.id))}
                  tabIndex={0}
                  className="cursor-pointer transition hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                >
                  <Td>
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg" aria-hidden>
                        {r.product ? (CATEGORY_LABELS[r.product.category]?.emoji ?? '⚖️') : '⚖️'}
                      </span>
                      <div className="min-w-0">
                        <Link
                          to={`/mermas/${r.test.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400"
                        >
                          {r.test.name}
                        </Link>
                        <div className="truncate text-xs text-muted">{r.product?.name ?? 'Sin producto'}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(r.test.date)}</Td>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="w-12 shrink-0 font-display text-base font-extrabold text-ink">{fmtPct(r.result.yieldPct, 0)}</span>
                      <div className="min-w-[80px] flex-1">
                        <PieceBar segments={pieceSegments(r.test, r.result)} grossKg={r.result.grossWeightKg} compact />
                      </div>
                    </div>
                  </Td>
                  <Td align="right">
                    <span className="font-semibold text-ink">{fmtPct(r.result.totalWastePct)}</span>
                    {r.result.byproductKg > 0 && <div className="text-[11px] text-muted">real {fmtPct(r.result.realWastePct)}</div>}
                  </Td>
                  <Td align="right">
                    <CostCell row={r} />
                  </Td>
                  <Td align="center">
                    <LinkBadge row={r} />
                  </Td>
                  <Td align="right" className="w-8">
                    <ChevronRight className="ml-auto size-4 text-muted" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {/* Móvil */}
          <ul className="space-y-2.5 md:hidden">
            {filtered.map((r) => (
              <li key={r.test.id}>
                <Link
                  to={`/mermas/${r.test.id}`}
                  className="block w-full rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl" aria-hidden>
                      {r.product ? (CATEGORY_LABELS[r.product.category]?.emoji ?? '⚖️') : '⚖️'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 font-bold leading-snug text-ink">{r.test.name}</div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {r.product?.name ?? 'Sin producto'} · {fmtDate(r.test.date)}
                      </div>
                    </div>
                    {r.linked && (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok" title="Se usa en tus escandallos">
                        <Link2 className="size-4" />
                        <span className="sr-only">Se usa en tus escandallos</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-3">
                    <PieceBar segments={pieceSegments(r.test, r.result)} grossKg={r.result.grossWeightKg} compact />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <MiniNum label="Rinde" value={fmtPct(r.result.yieldPct, 0)} />
                    <MiniNum label="Merma" value={fmtPct(r.result.totalWastePct, 0)} />
                    <MiniNum
                      label={r.factor > 0 ? `€/kg útil · ×${fmtNum(r.factor, 2)}` : '€/kg útil'}
                      value={r.result.principalKg > 0 && r.price > 0 ? fmtEur(r.result.costPerUsableKg) : '—'}
                      strong
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CostCell({ row }: { row: YieldRow }) {
  if (!(row.result.principalKg > 0) || !(row.price > 0)) return <span className="text-muted">—</span>;
  return (
    <div className="whitespace-nowrap">
      <span className="font-display text-base font-extrabold text-ink">{fmtEur(row.result.costPerUsableKg)}</span>
      <span className="text-xs text-muted">/kg útil</span>
      <div className="text-[11px] text-muted">
        compra {fmtEur(row.price)} ·{' '}
        <span className={cx('font-semibold', row.factor >= 2 ? 'text-bad' : row.factor >= 1.4 ? 'text-warn' : 'text-ink-2')}>×{fmtNum(row.factor, 2)}</span>
      </div>
    </div>
  );
}

function LinkBadge({ row }: { row: YieldRow }) {
  if (row.linked)
    return (
      <Badge tone="ok" icon={<Link2 className="size-3" />}>
        En escandallos
      </Badge>
    );
  if (!row.product)
    return (
      <Badge tone="neutral" icon={<Scale className="size-3" />}>
        Sin producto
      </Badge>
    );
  return <Badge tone="neutral">Sin aplicar</Badge>;
}

function MiniNum({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-2.5 py-2">
      <div className={cx('truncate font-display font-extrabold', strong ? 'text-base text-brand-600 dark:text-brand-400' : 'text-base text-ink')}>{value}</div>
      <div className="truncate text-[10px] font-medium text-muted">{label}</div>
    </div>
  );
}
