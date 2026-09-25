import type { BusinessSettings, Dish, DishCost, Workspace } from '../../types';
import { LogoMark } from '../Logo';
import { ALLERGEN_LABELS, BASIS_LABELS } from '../../lib/labels';
import { UNIT_LABELS } from '../../core/units';
import { fmtBaseQty, fmtDate, fmtEur, fmtKg, fmtNum } from '../../lib/format';
import { todayIso } from '../../lib/id';
import { fmtPrice, targetOf, fmtPctNb } from './logic';

/**
 * Ficha técnica imprimible (sólo visible al imprimir). Usa negro sobre blanco explícito
 * para que salga bien aunque la app esté en tema oscuro.
 */
export function PrintSheet({ dish, cost, business, workspace }: { dish: Dish; cost: DishCost; business: BusinessSettings; workspace?: Workspace }) {
  const portions = dish.portions > 0 ? dish.portions : 1;
  const byId = new Map(cost.items.map((i) => [i.itemId, i]));
  const target = targetOf(dish, business);
  return (
    <div className="print-only bg-white text-[11px] leading-snug text-black">
      <style>{'@page { size: A4; margin: 14mm; }'}</style>
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-10" />
          <div>
            <div className="text-[15px] font-extrabold tracking-tight">
              Escandallo<span style={{ color: '#ff5a1f' }}>Pro</span>
            </div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-black/60">{workspace?.name ?? 'Ficha técnica'}</div>
          </div>
        </div>
        <div className="text-right text-[10px] text-black/70">
          <div className="text-[13px] font-bold uppercase tracking-wide text-black">Ficha técnica</div>
          <div>{fmtDate(todayIso())}</div>
        </div>
      </header>

      <section className="mt-4 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[24px] font-extrabold leading-tight">{dish.name}</h1>
          <div className="mt-1 text-black/70">
            {dish.kind === 'elaboracion' ? 'Elaboración' : 'Plato'}
            {dish.section ? ` · ${dish.section}` : ''} · {portions} {portions === 1 ? 'ración' : 'raciones'}
            {dish.kind === 'elaboracion' && dish.yieldQty ? ` · rinde ${fmtBaseQty(dish.yieldQty, dish.yieldUnit ?? 'kg')}` : ''}
          </div>
          {dish.description && <p className="mt-1 max-w-[120mm] italic text-black/70">{dish.description}</p>}
        </div>
        <table className="shrink-0 text-right">
          <tbody>
            <tr>
              <td className="pr-3 text-black/60">Coste por ración</td>
              <td className="text-[15px] font-extrabold">{fmtEur(cost.costPerPortion)}</td>
            </tr>
            {dish.kind === 'plato' && (
              <>
                <tr>
                  <td className="pr-3 text-black/60">PVP carta (IVA incl.)</td>
                  <td className="font-bold">{fmtEur(dish.menuPrice)}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-black/60">Food cost (objetivo {fmtPctNb(target, 0)})</td>
                  <td className="font-bold">{fmtPctNb(cost.foodCostPct)}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-black/60">Margen bruto</td>
                  <td className="font-bold">{fmtEur(cost.grossMargin)}</td>
                </tr>
              </>
            )}
            {dish.kind === 'elaboracion' && cost.pricePerYieldUnit != null && (
              <tr>
                <td className="pr-3 text-black/60">Coste por {dish.yieldUnit ?? 'kg'}</td>
                <td className="font-bold">{fmtPrice(cost.pricePerYieldUnit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left text-[9px] uppercase tracking-wide">
            <th className="py-1.5 pr-2">Ingrediente</th>
            <th className="px-2 py-1.5 text-right">Cantidad</th>
            <th className="px-2 py-1.5 text-right">Bruto</th>
            <th className="px-2 py-1.5 text-right">Neto</th>
            <th className="px-2 py-1.5 text-right">Merma</th>
            <th className="px-2 py-1.5 text-right">Precio</th>
            <th className="py-1.5 pl-2 text-right">Coste</th>
          </tr>
        </thead>
        <tbody>
          {dish.items.map((it) => {
            const ic = byId.get(it.id);
            return (
              <tr key={it.id} className="border-b border-black/15 align-top">
                <td className="py-1.5 pr-2 font-semibold">{it.name || '—'}</td>
                <td className="px-2 py-1.5 text-right">
                  {fmtNum(it.quantity, 3)} {UNIT_LABELS[it.unit]} <span className="text-black/50">{BASIS_LABELS[it.basis].label.toLowerCase()}</span>
                </td>
                <td className="px-2 py-1.5 text-right">{ic && ic.grossQty > 0 ? fmtBaseQty(ic.grossQty, ic.baseUnit) : '—'}</td>
                <td className="px-2 py-1.5 text-right">{ic && ic.netQty > 0 ? fmtBaseQty(ic.netQty, ic.baseUnit) : '—'}</td>
                <td className="px-2 py-1.5 text-right">{ic && ic.grossQty > 0 ? fmtPctNb(ic.totalWastePct, 0) : '—'}</td>
                <td className="px-2 py-1.5 text-right">{ic?.pricePerBase ? `${fmtPrice(ic.pricePerBase)}/${ic.baseUnit}` : 'sin precio'}</td>
                <td className="py-1.5 pl-2 text-right font-semibold">{ic ? fmtEur(ic.cost) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1.5 pr-2">Total receta</td>
            <td />
            <td className="px-2 py-1.5 text-right">{fmtKg(cost.grossKgPerPortion * portions)}</td>
            <td />
            <td className="px-2 py-1.5 text-right">{cost.grossKgPerPortion > 0 ? fmtPctNb(cost.wastePct, 0) : '—'}</td>
            <td />
            <td className="py-1.5 pl-2 text-right">{fmtEur(cost.totalCost)}</td>
          </tr>
          {portions > 1 && (
            <tr className="font-bold">
              <td className="py-1 pr-2" colSpan={6}>
                Por ración
              </td>
              <td className="py-1 pl-2 text-right">{fmtEur(cost.costPerPortion)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      <section className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-1 text-[10px] font-bold uppercase tracking-wide">Alérgenos (Reglamento UE 1169/2011)</h2>
          {cost.allergens.length ? (
            <p>{cost.allergens.map((a) => `${ALLERGEN_LABELS[a].emoji} ${ALLERGEN_LABELS[a].label}`).join(' · ')}</p>
          ) : (
            <p className="text-black/60">Sin alérgenos declarados en sus ingredientes.</p>
          )}
        </div>
        <div>
          <h2 className="mb-1 text-[10px] font-bold uppercase tracking-wide">Merma por ración</h2>
          <p>
            Bruto {fmtKg(cost.grossKgPerPortion)} · servido {fmtKg(cost.servedKgPerPortion)} · merma {fmtKg(cost.wasteKgPerPortion)} ({fmtPctNb(cost.wastePct)}) ·{' '}
            {fmtEur(cost.wasteCostPerPortion)}
          </p>
        </div>
      </section>

      {dish.procedure && (
        <section className="mt-4">
          <h2 className="mb-1 text-[10px] font-bold uppercase tracking-wide">Elaboración y emplatado</h2>
          <p className="whitespace-pre-wrap">{dish.procedure}</p>
        </section>
      )}
      {dish.notes && (
        <section className="mt-3">
          <h2 className="mb-1 text-[10px] font-bold uppercase tracking-wide">Notas</h2>
          <p className="whitespace-pre-wrap">{dish.notes}</p>
        </section>
      )}
      <footer className="mt-6 border-t border-black/20 pt-2 text-[9px] text-black/50">
        Precios sin IVA salvo el PVP de carta. Generado con Escandallo Pro el {fmtDate(todayIso())}.
      </footer>
    </div>
  );
}
