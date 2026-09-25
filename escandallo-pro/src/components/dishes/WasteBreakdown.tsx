import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Scale, ChevronDown } from 'lucide-react';
import type { DishCost } from '../../types';
import { fmtEur, fmtKg } from '../../lib/format';
import { Card, CardHeader } from '../ui';
import { wasteBreakdown, type WasteRow, fmtPctNb } from './logic';

/*
 * Paleta validada (dataviz: CVD ΔE ≥ 24, contraste ≥ 3:1 en claro y oscuro) para las dos series:
 * limpieza/despiece = azul, cocción = naranja. Los textos nunca llevan el color de la serie.
 */
const SERIES = {
  cleaning: { label: 'Limpieza / despiece', bar: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  cooking: { label: 'Cocción', bar: 'bg-[#eb6834] dark:bg-[#d95926]' },
} as const;

const TOP = 8;

/** Panel "Merma del plato": resumen por ración y desglose por ingrediente (limpieza vs. cocción). */
export function WasteBreakdown({ cost, portions }: { cost: DishCost; portions: number }) {
  const summary = useMemo(() => wasteBreakdown(cost, portions), [cost, portions]);
  const [showAll, setShowAll] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const p = summary.portions;
  const rowsWithWaste = summary.rows.filter((r) => r.totalKg > 1e-6);
  const max = Math.max(0, ...rowsWithWaste.map((r) => r.totalKg));
  const visible = showAll ? rowsWithWaste : rowsWithWaste.slice(0, TOP);
  const wasteShareOfCost = cost.costPerPortion > 0 ? (cost.wasteCostPerPortion / cost.costPerPortion) * 100 : undefined;

  return (
    <Card>
      <CardHeader
        icon={<Scale className="size-5" />}
        title="Merma del plato"
        subtitle="La merma es lo que compras y no llega al plato: limpieza, despiece y cocción."
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label="Peso bruto" value={fmtKg(cost.grossKgPerPortion)} hint="lo que compras por ración" />
        <Tile label="Peso servido" value={fmtKg(cost.servedKgPerPortion)} hint="lo que llega al plato" />
        <Tile
          label="Merma total"
          value={fmtKg(cost.wasteKgPerPortion)}
          hint={cost.grossKgPerPortion > 0 ? `${fmtPctNb(cost.wastePct)} del bruto` : undefined}
          tone={cost.wastePct >= 35 ? 'warn' : undefined}
        />
        <Tile
          label="Coste de la merma"
          value={fmtEur(cost.wasteCostPerPortion)}
          hint={wasteShareOfCost != null ? `${fmtPctNb(wasteShareOfCost, 0)} del coste` : undefined}
          tone={wasteShareOfCost != null && wasteShareOfCost >= 25 ? 'warn' : undefined}
        />
      </div>

      {p > 1 && (
        <p className="tabular mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">
          <span className="font-semibold text-ink">Receta completa ({p} raciones):</span> bruto {fmtKg(cost.grossKgPerPortion * p)} · servido{' '}
          {fmtKg(cost.servedKgPerPortion * p)} · merma {fmtKg(cost.totalWasteKg)} · coste de merma {fmtEur(cost.wasteCostPerPortion * p)}
        </p>
      )}

      <div className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-ink">Por ingrediente (por ración)</h4>
          <div className="flex items-center gap-3 text-xs text-ink-2" aria-label="Leyenda">
            {(['cleaning', 'cooking'] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={clsx('size-2.5 rounded-[3px]', SERIES[k].bar)} aria-hidden />
                {SERIES[k].label}
              </span>
            ))}
          </div>
        </div>

        {rowsWithWaste.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
            {cost.items.length
              ? 'Sin merma registrada: todo lo que compras llega al plato. Si limpias o cocinas algún ingrediente, indica su merma en la tabla.'
              : 'Añade ingredientes para ver dónde se va el producto.'}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {visible.map((r) => (
              <WasteBar key={r.itemId} row={r} max={max} active={hover === r.itemId} onActive={(on) => setHover(on ? r.itemId : null)} />
            ))}
          </ul>
        )}

        {rowsWithWaste.length > TOP && (
          <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-3 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
            {showAll ? 'Ver menos' : `Ver los ${rowsWithWaste.length} ingredientes con merma`}
          </button>
        )}

        {summary.notWeighable > 0 && (
          <p className="mt-3 text-xs text-muted">
            {summary.notWeighable === 1 ? '1 ingrediente en unidades' : `${summary.notWeighable} ingredientes en unidades`} sin peso por unidad no entra en los gramos (sí en el
            coste). Indica su peso por unidad en la ficha del ingrediente.
          </p>
        )}

        {rowsWithWaste.length > 0 && (
          <details className="group mt-4 rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-ink-2">
              Ver como tabla
              <ChevronDown className="size-4 transition group-open:rotate-180" />
            </summary>
            <div className="overflow-x-auto border-t border-line">
              <table className="tabular w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-bold">Ingrediente</th>
                    <th className="px-2 py-2 text-right font-bold">Bruto</th>
                    <th className="px-2 py-2 text-right font-bold">Limpieza</th>
                    <th className="px-2 py-2 text-right font-bold">Cocción</th>
                    <th className="px-2 py-2 text-right font-bold">Servido</th>
                    <th className="px-2 py-2 text-right font-bold">Merma</th>
                    <th className="px-3 py-2 text-right font-bold">Coste merma</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithWaste.map((r) => (
                    <tr key={r.itemId} className="border-t border-line text-ink-2">
                      <td className="px-3 py-1.5 font-medium text-ink">{r.name || 'Sin nombre'}</td>
                      <td className="px-2 py-1.5 text-right">{fmtKg(r.grossKg)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtKg(r.cleaningKg)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtKg(r.cookingKg)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtKg(r.servedKg)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtPctNb(r.wastePct)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtEur(r.wasteCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' }) {
  return (
    <div className={clsx('rounded-xl border px-3 py-2.5', tone === 'warn' ? 'border-warn/30 bg-warn-soft' : 'border-line bg-surface-2')}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-display text-xl font-extrabold text-ink">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function WasteBar({ row, max, active, onActive }: { row: WasteRow; max: number; active: boolean; onActive: (on: boolean) => void }) {
  const width = max > 0 ? (row.totalKg / max) * 100 : 0;
  const cleanShare = row.totalKg > 0 ? (row.cleaningKg / row.totalKg) * 100 : 0;
  const hasClean = row.cleaningKg > 1e-7;
  const hasCook = row.cookingKg > 1e-7;
  const label = `${row.name || 'Sin nombre'}: merma ${fmtKg(row.totalKg)} por ración (${fmtPctNb(row.wastePct)} del bruto); limpieza ${fmtKg(row.cleaningKg)}, cocción ${fmtKg(row.cookingKg)}; coste ${fmtEur(row.wasteCost)}`;
  return (
    <li
      tabIndex={0}
      aria-label={label}
      onPointerEnter={() => onActive(true)}
      onPointerLeave={() => onActive(false)}
      onFocus={() => onActive(true)}
      onBlur={() => onActive(false)}
      className="relative grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]"
    >
      <span className={clsx('truncate text-sm', active ? 'font-semibold text-ink' : 'text-ink-2')}>{row.name || 'Sin nombre'}</span>
      <span className="flex h-3 items-center" aria-hidden>
        <span className={clsx('flex h-3 gap-[2px] transition-[filter]', active && 'brightness-110')} style={{ width: `${Math.max(width, 1.5)}%` }}>
          {hasClean && <span className={clsx('h-full', SERIES.cleaning.bar, !hasCook && 'rounded-r-[4px]')} style={{ width: hasCook ? `${cleanShare}%` : '100%' }} />}
          {hasCook && <span className={clsx('h-full flex-1 rounded-r-[4px]', SERIES.cooking.bar)} />}
        </span>
      </span>
      <span className="tabular whitespace-nowrap text-right text-xs">
        <span className="font-semibold text-ink">{fmtKg(row.totalKg)}</span>
        <span className="text-muted"> · {fmtPctNb(row.wastePct, 0)}</span>
      </span>
      {active && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-[9rem] z-10 mb-1 w-56 animate-fade-in rounded-xl border border-line bg-elevated p-2.5 text-xs shadow-pop sm:left-[12rem]"
        >
          <span className="block font-semibold text-ink">{row.name || 'Sin nombre'}</span>
          <TipRow swatch={SERIES.cleaning.bar} label="Limpieza" value={fmtKg(row.cleaningKg)} />
          <TipRow swatch={SERIES.cooking.bar} label="Cocción" value={fmtKg(row.cookingKg)} />
          <span className="mt-1 flex justify-between border-t border-line pt-1 text-ink-2">
            <span>Bruto → servido</span>
            <span className="tabular font-semibold text-ink">
              {fmtKg(row.grossKg)} → {fmtKg(row.servedKg)}
            </span>
          </span>
          <span className="flex justify-between text-ink-2">
            <span>Coste de la merma</span>
            <span className="tabular font-semibold text-ink">{fmtEur(row.wasteCost)}</span>
          </span>
        </span>
      )}
    </li>
  );
}

function TipRow({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <span className="mt-1 flex items-center justify-between gap-2 text-ink-2">
      <span className="inline-flex items-center gap-1.5">
        <span className={clsx('h-0.5 w-3 rounded-full', swatch)} aria-hidden />
        {label}
      </span>
      <span className="tabular font-semibold text-ink">{value}</span>
    </span>
  );
}
