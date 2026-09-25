import { Link } from 'react-router';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Check, FlaskConical, Sparkles } from 'lucide-react';
import type { BusinessSettings, Dish, DishCost, ID } from '../../types';
import { fmtEur } from '../../lib/format';
import { FoodCostBadge, ProgressBar } from '../ui';
import { SelectBox } from './DishCard';
import { dishFoodCostStatus, fmtPctNb, shownFoodCost, shownMargin, type DishSort } from './logic';

interface Col {
  key: string;
  label: string;
  sort?: DishSort;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

const COLS: Col[] = [
  { key: 'name', label: 'Plato', sort: 'nombre' },
  { key: 'section', label: 'Sección', sort: 'seccion', className: 'hidden md:table-cell' },
  { key: 'pvp', label: 'PVP', sort: 'pvp', align: 'right' },
  { key: 'cost', label: 'Coste ración', sort: 'coste', align: 'right' },
  { key: 'fc', label: 'Food cost', sort: 'foodcost', align: 'right' },
  { key: 'margin', label: 'Margen', sort: 'margen', align: 'right' },
  { key: 'waste', label: 'Merma', sort: 'merma', align: 'right', className: 'hidden lg:table-cell' },
  { key: 'complete', label: 'Precios', align: 'left', className: 'hidden xl:table-cell' },
];

/** Vista de tabla del listado de escandallos, con columnas ordenables y selección. */
export function DishListTable({
  dishes,
  costs,
  business,
  sort,
  dir,
  onSort,
  selected,
  onToggle,
  onToggleAll,
}: {
  dishes: Dish[];
  costs: Map<ID, DishCost>;
  business: BusinessSettings;
  sort: DishSort;
  dir: 'asc' | 'desc';
  onSort: (s: DishSort) => void;
  selected: Set<ID>;
  onToggle: (id: ID) => void;
  onToggleAll: () => void;
}) {
  const allSelected = dishes.length > 0 && dishes.every((d) => selected.has(d.id));
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="tabular w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2 text-[11px] font-bold uppercase tracking-wide text-muted">
            <th className="w-12 border-b border-line py-1 pl-2">
              <SelectBox checked={allSelected} onChange={onToggleAll} label={allSelected ? 'Quitar selección' : 'Seleccionar todos los visibles'} />
            </th>
            {COLS.map((c) => {
              const active = c.sort === sort;
              return (
                <th
                  key={c.key}
                  aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={clsx('whitespace-nowrap border-b border-line px-3 py-2.5', c.align === 'right' ? 'text-right' : 'text-left', c.className)}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.sort as DishSort)}
                      className={clsx('inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-ink', active && 'text-ink')}
                    >
                      {c.label}
                      {active && (dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {dishes.map((d) => {
            const c = costs.get(d.id);
            const fc = shownFoodCost(c);
            const margin = shownMargin(c);
            const st = dishFoodCostStatus(fc, d, business);
            const isPlato = d.kind === 'plato';
            const missing = c ? c.items.filter((i) => !i.resolved).length : 0;
            const sug = d.items.filter((i) => i.suggested).length;
            return (
              <tr key={d.id} className={clsx('group transition-colors hover:bg-surface-2/70', selected.has(d.id) && 'bg-brand-500/5')}>
                <td className="border-b border-line py-1 pl-2">
                  <SelectBox checked={selected.has(d.id)} onChange={() => onToggle(d.id)} label={`Seleccionar ${d.name}`} />
                </td>
                <td className="max-w-[320px] border-b border-line px-3 py-2.5">
                  <Link to={`/platos/${d.id}`} className="flex items-center gap-2 font-semibold text-ink hover:text-brand-600">
                    {!isPlato && <FlaskConical className="size-3.5 shrink-0 text-info" aria-label="Elaboración" />}
                    <span className="truncate">{d.name}</span>
                    {d.status === 'revisado' && <Check className="size-3.5 shrink-0 text-ok" aria-label="Revisado" />}
                    {sug > 0 && <Sparkles className="size-3.5 shrink-0 text-ai" aria-label={`${sug} líneas por revisar`} />}
                  </Link>
                </td>
                <td className="hidden border-b border-line px-3 py-2.5 text-ink-2 md:table-cell">{d.section ?? <span className="text-muted">—</span>}</td>
                <td className="border-b border-line px-3 py-2.5 text-right text-ink-2">
                  {isPlato ? d.menuPrice ? fmtEur(d.menuPrice) : <span className="text-xs font-semibold text-warn">Sin PVP</span> : <span className="text-muted">—</span>}
                </td>
                <td className="border-b border-line px-3 py-2.5 text-right font-semibold text-ink">{c && c.costPerPortion > 0 ? fmtEur(c.costPerPortion) : '—'}</td>
                <td className="border-b border-line px-3 py-2.5 text-right">{isPlato ? <FoodCostBadge pct={fc} status={st} /> : <span className="text-muted">—</span>}</td>
                <td className={clsx('border-b border-line px-3 py-2.5 text-right', margin != null && margin < 0 ? 'text-bad' : 'text-ink-2')}>
                  {margin != null ? fmtEur(margin) : '—'}
                </td>
                <td className="hidden border-b border-line px-3 py-2.5 text-right text-ink-2 lg:table-cell">{c && c.grossKgPerPortion > 0 ? fmtPctNb(c.wastePct, 0) : '—'}</td>
                <td className="hidden w-40 border-b border-line px-3 py-2.5 xl:table-cell">
                  {d.items.length ? (
                    <div className="flex items-center gap-2">
                      <ProgressBar value={c?.completeness ?? 0} tone={missing ? 'warn' : 'ok'} className="h-1.5" />
                      <span className={clsx('w-16 shrink-0 text-xs', missing ? 'font-semibold text-warn' : 'text-muted')}>{missing ? `${missing} sin precio` : 'Completo'}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Sin ingredientes</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
