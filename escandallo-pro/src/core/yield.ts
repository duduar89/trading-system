import type { YieldResult, YieldTest } from '../types';

/**
 * Pruebas de rendimiento (despiece / escandallo de pieza).
 *
 * Partimos de una pieza con peso bruto G a precio p €/kg:
 *   coste pieza            = G · p
 *   parte principal (P)    = Σ salidas "principal"      (lo que va al plato)
 *   subproductos (S)       = Σ salidas "subproducto"    (aprovechables: recortes para fondos, etc.)
 *   desperdicio (W)        = Σ salidas "desperdicio"
 *   no registrado          = G·(1 − descongelación) − (P + S + W)
 *   rendimiento %          = P / G
 *   merma total %          = 1 − P / G
 *   merma real %           = (G − P − S) / G   (lo que de verdad se tira)
 *   valor subproductos     = Σ S_i · valor_i
 *   coste €/kg útil        = (G·p − valor subproductos) / P
 *   cocinado               = P · (1 − cocción)
 *   coste €/kg cocinado    = (G·p − valor subproductos) / cocinado
 *   por ración (r kg servidos):
 *     bruto por ración     = r / (cocinado / G)
 *     merma por ración     = bruto por ración − r
 *     coste por ración     = r · coste €/kg cocinado
 *     coste de la merma    = coste por ración − r · p   (sobrecoste que genera la merma)
 */
export function computeYield(test: Pick<YieldTest, 'grossWeightKg' | 'purchasePricePerKg' | 'thawLossPct' | 'outputs' | 'cookingLossPct' | 'portionKg'>): YieldResult {
  const warnings: string[] = [];
  const G = Math.max(0, test.grossWeightKg || 0);
  const p = Math.max(0, test.purchasePricePerKg || 0);
  const thaw = clampPct(test.thawLossPct ?? 0);
  const cook = clampPct(test.cookingLossPct ?? 0);
  const grossCost = G * p;

  let P = 0;
  let S = 0;
  let W = 0;
  let byproductValue = 0;
  for (const o of test.outputs ?? []) {
    const w = Math.max(0, o.weightKg || 0);
    if (o.kind === 'principal') P += w;
    else if (o.kind === 'subproducto') {
      S += w;
      byproductValue += w * Math.max(0, o.valuePerKg ?? 0);
    } else W += w;
  }

  const afterThaw = G * (1 - thaw / 100);
  let unaccounted = afterThaw - (P + S + W);
  if (G <= 0) warnings.push('Indica el peso bruto de la pieza.');
  if (p <= 0) warnings.push('La pieza no tiene precio de compra.');
  if (P <= 0) warnings.push('Registra al menos una salida principal (la parte que va al plato).');
  if (unaccounted < -1e-6) {
    warnings.push('Las salidas pesan más que la pieza: revisa los pesos.');
  }
  if (unaccounted < 0) unaccounted = 0;
  if (byproductValue > grossCost && grossCost > 0) {
    warnings.push('El valor de los subproductos supera el coste de la pieza.');
    byproductValue = grossCost;
  }

  const yieldPct = G > 0 ? (P / G) * 100 : 0;
  const totalWastePct = G > 0 ? 100 - yieldPct : 0;
  const realWastePct = G > 0 ? Math.max(0, ((G - P - S) / G) * 100) : 0;
  const netCost = grossCost - byproductValue;
  const costPerUsableKg = P > 0 ? netCost / P : 0;
  const cookedKg = P * (1 - cook / 100);
  const finalYieldPct = G > 0 ? (cookedKg / G) * 100 : 0;
  const costPerCookedKg = cookedKg > 0 ? netCost / cookedKg : 0;
  const costFactor = p > 0 ? costPerCookedKg / p : 0;

  const result: YieldResult = {
    grossWeightKg: G,
    grossCost,
    principalKg: P,
    byproductKg: S,
    wasteKg: W,
    unaccountedKg: unaccounted,
    yieldPct,
    totalWastePct,
    realWastePct,
    byproductValue,
    costPerUsableKg,
    cookedKg,
    finalYieldPct,
    costPerCookedKg,
    costFactor,
    warnings,
  };

  const r = test.portionKg;
  if (r && r > 0 && cookedKg > 0 && G > 0) {
    result.portions = Math.floor(cookedKg / r + 1e-9);
    const servedRatio = cookedKg / G;
    result.grossPerPortionKg = r / servedRatio;
    result.wastePerPortionKg = result.grossPerPortionKg - r;
    result.costPerPortion = r * costPerCookedKg;
    result.wasteCostPerPortion = result.costPerPortion - r * p;
  }
  return result;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(99.9, Math.max(0, v));
}
