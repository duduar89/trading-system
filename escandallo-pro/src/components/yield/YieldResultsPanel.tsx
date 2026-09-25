import { Info, TriangleAlert } from 'lucide-react';
import type { YieldResult, YieldTest } from '../../types';
import { Callout, cx } from '../ui';
import { fmtEur, fmtKg, fmtNum, fmtPct } from '../../lib/format';
import { pieceSegments } from './model';
import { PieceBar } from './PieceBar';

/** Tono del factor de sobrecoste (€/kg útil frente a compra). */
function factorTone(f: number): string {
  if (!(f > 0)) return 'text-muted';
  if (f >= 2) return 'text-bad';
  if (f >= 1.4) return 'text-warn';
  return 'text-ok';
}

/** Resultados en vivo de la prueba: rendimiento, mermas, coste real y merma por ración. */
export function YieldResultsPanel({ test, result, currentProductPrice }: { test: YieldTest; result: YieldResult; currentProductPrice?: number }) {
  const p = test.purchasePricePerKg;
  const hasCore = result.grossWeightKg > 0 && result.principalKg > 0;
  const hasPrice = p > 0;
  const usableFactor = hasPrice && result.principalKg > 0 ? result.costPerUsableKg / p : 0;
  const portion = test.portionKg;
  // Prueba recién creada: aún no hay ninguna salida pesada.
  const fresh = !test.outputs.some((o) => o.weightKg > 0);
  const warnings = fresh ? result.warnings.filter((w) => !/salida principal/i.test(w)) : result.warnings;
  const priceDiffers = currentProductPrice != null && currentProductPrice > 0 && Math.abs(currentProductPrice - p) > 0.004;

  return (
    <div className="space-y-5">
      {/* Cifras principales */}
      <div className="grid grid-cols-2 gap-3">
        <BigNumber
          label="Rendimiento"
          value={hasCore ? fmtPct(result.yieldPct) : '—'}
          caption={hasCore ? `${fmtKg(result.principalKg)} aprovechables` : 'Registra la parte que va al plato'}
          tone="ok"
          bar={hasCore ? result.yieldPct / 100 : 0}
        />
        <BigNumber
          label="Merma total"
          value={result.grossWeightKg > 0 && !fresh ? fmtPct(result.totalWastePct) : '—'}
          caption="Todo lo que no va al plato"
          tone="bad"
          bar={result.grossWeightKg > 0 && !fresh ? result.totalWastePct / 100 : 0}
        />
      </div>

      {/* Merma real */}
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Merma real</div>
          <div className="text-xs leading-snug text-muted">
            {result.byproductKg > 0 ? `Lo que de verdad se tira: descuenta ${fmtKg(result.byproductKg)} de subproductos` : 'Lo que de verdad se tira (sin subproductos, igual a la merma total)'}
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-line" aria-hidden>
            <div className="h-full rounded-full bg-bad/70 transition-all duration-500" style={{ width: `${hasCore ? Math.min(100, result.realWastePct) : 0}%` }} />
          </div>
        </div>
        <div className="shrink-0 font-display text-[28px] font-extrabold leading-none text-ink">{result.grossWeightKg > 0 && !fresh ? fmtPct(result.realWastePct) : '—'}</div>
      </div>

      {/* Coste real */}
      <div className="rounded-2xl border border-line bg-surface-2 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Coste real</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-4xl font-extrabold text-ink sm:text-[44px]">{hasCore && hasPrice ? fmtEur(result.costPerUsableKg) : '—'}</span>
          <span className="text-sm font-semibold text-muted">/ kg útil</span>
        </div>
        {hasCore && hasPrice ? (
          <p className="mt-1 text-sm text-ink-2">
            Pagas <strong className="font-semibold text-ink">{fmtEur(p)}/kg</strong>, pero cada kilo limpio te cuesta{' '}
            <strong className={cx('font-bold', factorTone(usableFactor))}>×{fmtNum(usableFactor, 2)}</strong>.
            {result.byproductValue > 0 && <> Ya descuenta {fmtEur(result.byproductValue)} que recuperas en subproductos.</>}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">{hasPrice ? 'Añade las salidas de la pieza para calcularlo.' : 'Indica el precio de compra por kg.'}</p>
        )}
        {hasCore && hasPrice && test.cookingLossPct > 0 && (
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
            <span className="text-sm text-ink-2">Cocinado (−{fmtPct(test.cookingLossPct, 0)} de cocción)</span>
            <span className="text-right">
              <span className="font-display text-xl font-extrabold text-ink">{fmtEur(result.costPerCookedKg)}</span>
              <span className="text-xs text-muted">/kg</span>
              <span className={cx('ml-2 text-sm font-bold', factorTone(result.costFactor))}>×{fmtNum(result.costFactor, 2)}</span>
            </span>
          </div>
        )}
        {priceDiffers && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Tus escandallos usan el precio vigente del producto ({fmtEur(currentProductPrice)}/kg), así que siempre están al día.
          </p>
        )}
      </div>

      {/* Composición */}
      {result.grossWeightKg > 0 && !fresh && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-bold text-ink">Qué sale de la pieza</h4>
            <span className="tabular text-xs text-muted">{fmtKg(result.grossWeightKg)} brutos</span>
          </div>
          <PieceBar segments={pieceSegments(test, result)} grossKg={result.grossWeightKg} />
        </div>
      )}

      {/* Por ración */}
      <div className="rounded-2xl border border-brand-500/25 bg-brand-500/5 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">Merma por ración</div>
        {portion && portion > 0 && result.portions != null && result.grossPerPortionKg != null ? (
          <>
            <p className="mt-1.5 text-[15px] leading-snug text-ink">
              Para servir <strong className="whitespace-nowrap">{fmtKg(portion)}</strong> necesitas comprar{' '}
              <strong className="whitespace-nowrap">{fmtKg(result.grossPerPortionKg)}</strong>:{' '}
              <strong className="whitespace-nowrap text-bad">{fmtKg(result.wastePerPortionKg)}</strong> se quedan por el camino
              {hasPrice && result.wasteCostPerPortion != null && (
                <>
                  {' '}
                  (<span className="whitespace-nowrap">{fmtEur(Math.max(0, result.wasteCostPerPortion))}</span> de merma en cada plato)
                </>
              )}
              .
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MiniStat label="Raciones" value={fmtNum(result.portions, 0)} />
              <MiniStat label="Bruto por ración" value={fmtKg(result.grossPerPortionKg)} />
              <MiniStat label="Merma por ración" value={fmtKg(result.wastePerPortionKg)} tone="bad" />
              <MiniStat label="Coste por ración" value={hasPrice ? fmtEur(result.costPerPortion) : '—'} strong />
              <MiniStat label="Coste de la merma" value={hasPrice ? fmtEur(Math.max(0, result.wasteCostPerPortion ?? 0)) : '—'} tone="bad" />
              <MiniStat label="Coste compra ración" value={hasPrice ? fmtEur(portion * p) : '—'} hint="si no hubiera merma" />
            </div>
          </>
        ) : (
          <p className="mt-1.5 text-sm text-ink-2">
            {hasCore ? 'Indica el gramaje por ración para ver cuántas raciones salen y cuánta merma lleva cada plato.' : 'Completa la prueba para ver la merma de cada ración.'}
          </p>
        )}
      </div>

      {/* Avisos */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w) => (
            <Callout key={w} tone="warn" icon={<TriangleAlert className="size-4" />}>
              {w}
            </Callout>
          ))}
        </div>
      )}
    </div>
  );
}

function BigNumber({ label, value, caption, tone, bar }: { label: string; value: string; caption: React.ReactNode; tone: 'ok' | 'bad'; bar: number }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-[34px] font-extrabold leading-none text-ink sm:text-[40px]">{value}</div>
      <div className="mt-2.5 h-1.5 w-full rounded-full bg-line" aria-hidden>
        <div
          className={cx('h-full rounded-full transition-all duration-500', tone === 'ok' ? 'bg-ok' : 'bg-bad')}
          style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }}
        />
      </div>
      <div className="mt-2 text-xs leading-snug text-muted">{caption}</div>
    </div>
  );
}

function MiniStat({ label, value, tone, strong, hint }: { label: string; value: string; tone?: 'bad'; strong?: boolean; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface px-3 py-2.5 shadow-card" title={hint}>
      <div className={cx('truncate font-display text-lg font-extrabold', tone === 'bad' ? 'text-bad' : strong ? 'text-brand-600 dark:text-brand-400' : 'text-ink')}>{value}</div>
      <div className="truncate text-[11px] font-medium text-muted">{label}</div>
    </div>
  );
}
