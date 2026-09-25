import type {
  Allergen,
  BaseUnit,
  BusinessSettings,
  Dish,
  DishCost,
  ID,
  ItemCost,
  Product,
  RecipeItem,
  YieldResult,
  YieldTest,
} from '../types';
import { baseToKg, convertToBase, dimensionOf } from './units';
import { computeYield } from './yield';

/**
 * Motor de escandallos.
 *
 * Para cada línea de receta:
 *   yc = 1 − merma limpieza,  yk = 1 − merma cocción
 *   basis 'bruta'    → bruto = q,             neto = q·yc,        servido = neto·yk
 *   basis 'neta'     → neto  = q,             bruto = q / yc,     servido = q·yk
 *   basis 'cocinada' → servido = q,           neto = q / yk,      bruto = neto / yc
 *   coste            = bruto · precio €/ud base
 *                      (o neto · coste €/kg útil si la merma viene de una prueba de rendimiento,
 *                       que además descuenta el valor de los subproductos)
 *   coste de merma   = coste − servido · precio
 *
 * Prioridad de la merma aplicada: prueba de la línea > % de la línea > prueba del producto > % del producto.
 * Las pruebas de rendimiento se recalculan siempre con el PRECIO VIGENTE del producto, de modo que
 * una subida en factura se propaga automáticamente a todos los escandallos.
 */

export interface CostingContext {
  products: Map<ID, Product>;
  dishes: Map<ID, Dish>;
  yieldTests: Map<ID, YieldTest>;
  business: BusinessSettings;
  /** Caché interna de costes por plato (se rellena al calcular). */
  cache: Map<ID, DishCost>;
}

export function buildCostingContext(
  products: Product[],
  dishes: Dish[],
  yieldTests: YieldTest[],
  business: BusinessSettings,
): CostingContext {
  return {
    products: new Map(products.map((p) => [p.id, p])),
    dishes: new Map(dishes.map((d) => [d.id, d])),
    yieldTests: new Map(yieldTests.map((y) => [y.id, y])),
    business,
    cache: new Map(),
  };
}

export interface WasteInfo {
  wastePct: number;
  cookingLossPct: number;
  source: ItemCost['wasteSource'];
  yieldResult?: YieldResult;
  yieldTest?: YieldTest;
}

/** Determina la merma de limpieza y cocción que aplica a una línea de producto. */
export function effectiveWaste(item: RecipeItem, product: Product | undefined, ctx: CostingContext): WasteInfo {
  const testFor = (id: ID | undefined): { test: YieldTest; result: YieldResult } | undefined => {
    if (!id) return undefined;
    const test = ctx.yieldTests.get(id);
    if (!test) return undefined;
    const price = product && product.baseUnit === 'kg' && product.pricePerBase > 0 ? product.pricePerBase : test.purchasePricePerKg;
    return { test, result: computeYield({ ...test, purchasePricePerKg: price }) };
  };

  const lineTest = testFor(item.yieldTestId);
  if (lineTest && lineTest.result.principalKg > 0) {
    return {
      wastePct: lineTest.result.totalWastePct,
      cookingLossPct: item.cookingLossPct ?? lineTest.test.cookingLossPct ?? 0,
      source: 'prueba',
      yieldResult: lineTest.result,
      yieldTest: lineTest.test,
    };
  }
  if (item.wastePct != null) {
    return {
      wastePct: item.wastePct,
      cookingLossPct: item.cookingLossPct ?? product?.cookingLossPct ?? 0,
      source: 'linea',
    };
  }
  const prodTest = testFor(product?.yieldTestId);
  if (prodTest && prodTest.result.principalKg > 0) {
    return {
      wastePct: prodTest.result.totalWastePct,
      cookingLossPct: item.cookingLossPct ?? prodTest.test.cookingLossPct ?? 0,
      source: 'prueba',
      yieldResult: prodTest.result,
      yieldTest: prodTest.test,
    };
  }
  const w = product?.wastePct ?? 0;
  return {
    wastePct: w,
    cookingLossPct: item.cookingLossPct ?? product?.cookingLossPct ?? 0,
    source: w > 0 ? 'producto' : 'ninguna',
  };
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(99, Math.max(0, v));
}

function emptyItem(item: RecipeItem, warnings: string[]): ItemCost {
  return {
    itemId: item.id,
    name: item.name,
    resolved: false,
    grossQty: 0,
    netQty: 0,
    servedQty: 0,
    cleaningWasteQty: 0,
    cookingWasteQty: 0,
    totalWasteQty: 0,
    totalWastePct: 0,
    cost: 0,
    wasteCost: 0,
    costSharePct: 0,
    appliedWastePct: 0,
    appliedCookingLossPct: 0,
    wasteSource: 'ninguna',
    warnings,
  };
}

/** Aplica la fórmula de mermas a una cantidad ya expresada en unidad base. */
export function applyWaste(
  qtyBase: number,
  basis: RecipeItem['basis'],
  wastePct: number,
  cookingLossPct: number,
): { gross: number; net: number; served: number } {
  const yc = 1 - clampPct(wastePct) / 100;
  const yk = 1 - clampPct(cookingLossPct) / 100;
  if (basis === 'bruta') {
    const net = qtyBase * yc;
    return { gross: qtyBase, net, served: net * yk };
  }
  if (basis === 'cocinada') {
    const net = qtyBase / yk;
    return { gross: net / yc, net, served: qtyBase };
  }
  return { gross: qtyBase / yc, net: qtyBase, served: qtyBase * yk };
}

/** Calcula el coste de una línea. `stack` contiene los platos en curso (detección de ciclos). */
export function costItem(item: RecipeItem, ctx: CostingContext, stack: Set<ID> = new Set()): ItemCost {
  const warnings: string[] = [];
  if (!item.ref) return emptyItem(item, ['Sin producto vinculado']);
  if (!(item.quantity > 0)) return emptyItem(item, ['Cantidad no indicada']);

  // ── Elaboración (sub-receta) ──
  if (item.ref.type === 'dish') {
    const sub = ctx.dishes.get(item.ref.id);
    if (!sub) return emptyItem(item, ['La elaboración vinculada ya no existe']);
    if (stack.has(sub.id)) return emptyItem(item, ['Referencia circular entre elaboraciones']);
    const subCost = costDish(sub, ctx, stack);
    let baseUnit: BaseUnit;
    let pricePerBase: number;
    let yieldQty = sub.yieldQty && sub.yieldQty > 0 ? sub.yieldQty : undefined;
    let yieldUnit: BaseUnit | undefined = sub.yieldUnit;
    if (!yieldQty) {
      // Sin rendimiento declarado: si piden en peso/volumen, estimamos por la suma de lo servido.
      if (dimensionOf(item.unit) !== 'count') {
        const servedKg = subCost.servedKgPerPortion * (sub.portions > 0 ? sub.portions : 1);
        if (servedKg > 0) {
          yieldQty = servedKg;
          yieldUnit = 'kg';
          warnings.push('Rendimiento de la elaboración estimado por suma de ingredientes: indícalo para mayor precisión');
        }
      }
    }
    if (yieldQty && yieldUnit) {
      baseUnit = yieldUnit;
      pricePerBase = subCost.totalCost / yieldQty;
    } else {
      baseUnit = 'ud';
      pricePerBase = subCost.costPerPortion; // 1 ud = 1 ración de la elaboración
    }
    const conv = convertToBase(item.quantity, item.unit, baseUnit, {});
    if (!conv.ok) return emptyItem(item, [conv.error ?? 'Unidad incompatible con la elaboración']);
    if (conv.assumption) warnings.push(conv.assumption);
    // En elaboraciones la merma ya está dentro de su propio escandallo; sólo aplicamos la de la línea.
    const wastePct = item.wastePct ?? 0;
    const cookingLossPct = item.cookingLossPct ?? 0;
    const q = applyWaste(conv.value, item.basis, wastePct, cookingLossPct);
    const cost = q.gross * pricePerBase;
    const grossKg = baseToKg(q.gross, baseUnit);
    const servedKg = baseToKg(q.served, baseUnit);
    if (subCost.completeness < 1) warnings.push('La elaboración tiene ingredientes sin precio');
    if (!(pricePerBase > 0)) warnings.push('La elaboración no tiene coste');
    return {
      itemId: item.id,
      name: item.name,
      resolved: pricePerBase > 0,
      baseUnit,
      pricePerBase,
      grossQty: q.gross,
      netQty: q.net,
      servedQty: q.served,
      cleaningWasteQty: q.gross - q.net,
      cookingWasteQty: q.net - q.served,
      totalWasteQty: q.gross - q.served,
      totalWastePct: q.gross > 0 ? ((q.gross - q.served) / q.gross) * 100 : 0,
      cost,
      wasteCost: Math.max(0, cost - q.served * pricePerBase),
      grossKg,
      servedKg,
      costSharePct: 0,
      appliedWastePct: wastePct,
      appliedCookingLossPct: cookingLossPct,
      wasteSource: item.wastePct != null ? 'linea' : 'ninguna',
      warnings,
    };
  }

  // ── Producto de compra ──
  const product = ctx.products.get(item.ref.id);
  if (!product) return emptyItem(item, ['El producto vinculado ya no existe']);
  const props = { unitWeightKg: product.unitWeightKg, densityKgPerL: product.densityKgPerL };
  const conv = convertToBase(item.quantity, item.unit, product.baseUnit, props);
  if (!conv.ok) return emptyItem(item, [conv.error ?? 'Unidad incompatible con el producto']);
  if (conv.assumption) warnings.push(conv.assumption);

  const waste = effectiveWaste(item, product, ctx);
  const q = applyWaste(conv.value, item.basis, waste.wastePct, waste.cookingLossPct);
  const price = product.pricePerBase;
  let cost: number;
  if (waste.source === 'prueba' && waste.yieldResult && product.baseUnit === 'kg') {
    // Coste real por kg aprovechable (descuenta subproductos) aplicado al peso neto.
    cost = q.net * waste.yieldResult.costPerUsableKg;
  } else {
    cost = q.gross * price;
  }
  if (!(price > 0)) warnings.push('Producto sin precio: sube una factura o indícalo a mano');

  return {
    itemId: item.id,
    name: item.name,
    resolved: price > 0,
    baseUnit: product.baseUnit,
    pricePerBase: price,
    grossQty: q.gross,
    netQty: q.net,
    servedQty: q.served,
    cleaningWasteQty: q.gross - q.net,
    cookingWasteQty: q.net - q.served,
    totalWasteQty: q.gross - q.served,
    totalWastePct: q.gross > 0 ? ((q.gross - q.served) / q.gross) * 100 : 0,
    cost,
    wasteCost: Math.max(0, cost - q.served * price),
    grossKg: baseToKg(q.gross, product.baseUnit, props),
    servedKg: baseToKg(q.served, product.baseUnit, props),
    costSharePct: 0,
    appliedWastePct: waste.wastePct,
    appliedCookingLossPct: waste.cookingLossPct,
    wasteSource: waste.source,
    warnings,
  };
}

/** Redondea hacia arriba al múltiplo de `step` (p. ej. 0,5 €). */
export function roundUpTo(value: number, step: number): number {
  if (!(step > 0)) return Math.round(value * 100) / 100;
  return Math.round(Math.ceil(value / step - 1e-9) * step * 100) / 100;
}

/** PVP con IVA necesario para que el coste por ración represente `targetPct` del PVP sin IVA. */
export function suggestedMenuPrice(costPerPortion: number, targetPct: number, vatPct: number, rounding: number): number | undefined {
  if (!(costPerPortion > 0) || !(targetPct > 0)) return undefined;
  const net = costPerPortion / (targetPct / 100);
  return roundUpTo(net * (1 + vatPct / 100), rounding);
}

/** Calcula el escandallo completo de un plato o elaboración. */
export function costDish(dish: Dish, ctx: CostingContext, stack: Set<ID> = new Set()): DishCost {
  const cached = ctx.cache.get(dish.id);
  if (cached) return cached;
  const nextStack = new Set(stack);
  nextStack.add(dish.id);

  const items = dish.items.map((it) => costItem(it, ctx, nextStack));
  const portions = dish.portions > 0 ? dish.portions : 1;
  const totalCost = items.reduce((s, i) => s + i.cost, 0);
  for (const i of items) i.costSharePct = totalCost > 0 ? (i.cost / totalCost) * 100 : 0;
  const costPerPortion = totalCost / portions;

  let grossKg = 0;
  let servedKg = 0;
  let wasteCost = 0;
  for (const i of items) {
    if (i.grossKg != null && i.servedKg != null) {
      grossKg += i.grossKg;
      servedKg += i.servedKg;
    }
    wasteCost += i.wasteCost;
  }

  const target = dish.targetFoodCostPct ?? ctx.business.targetFoodCostPct;
  const vat = dish.saleVatPct ?? ctx.business.defaultSaleVatPct;
  const warnings: string[] = [];
  const result: DishCost = {
    dishId: dish.id,
    totalCost,
    costPerPortion,
    targetFoodCostPct: target,
    grossKgPerPortion: grossKg / portions,
    servedKgPerPortion: servedKg / portions,
    wasteKgPerPortion: (grossKg - servedKg) / portions,
    wastePct: grossKg > 0 ? ((grossKg - servedKg) / grossKg) * 100 : 0,
    wasteCostPerPortion: wasteCost / portions,
    totalWasteKg: grossKg - servedKg,
    items,
    completeness: items.length ? items.filter((i) => i.resolved).length / items.length : 0,
    allergens: [],
    warnings,
  };

  if (dish.menuPrice && dish.menuPrice > 0) {
    const netPrice = dish.menuPrice / (1 + vat / 100);
    result.netPrice = netPrice;
    result.foodCostPct = (costPerPortion / netPrice) * 100;
    result.grossMargin = netPrice - costPerPortion;
    result.grossMarginPct = (result.grossMargin / netPrice) * 100;
    result.multiplier = costPerPortion > 0 ? netPrice / costPerPortion : undefined;
  } else if (dish.kind === 'plato') {
    warnings.push('Falta el PVP de carta');
  }
  result.suggestedPrice = suggestedMenuPrice(costPerPortion, target, vat, ctx.business.priceRounding);

  if (dish.kind === 'elaboracion' && dish.yieldQty && dish.yieldQty > 0) {
    result.pricePerYieldUnit = totalCost / dish.yieldQty;
  }
  if (!items.length) warnings.push('La receta no tiene ingredientes');
  else if (result.completeness < 1) {
    const n = items.filter((i) => !i.resolved).length;
    warnings.push(`${n} ingrediente${n === 1 ? '' : 's'} sin precio o sin vincular`);
  }

  // Alérgenos: productos + elaboraciones anidadas
  const allergens = new Set<Allergen>();
  for (const it of dish.items) {
    if (!it.ref) continue;
    if (it.ref.type === 'product') ctx.products.get(it.ref.id)?.allergens?.forEach((a) => allergens.add(a));
    else if (!nextStack.has(it.ref.id)) {
      const sub = ctx.dishes.get(it.ref.id);
      if (sub) costDish(sub, ctx, nextStack).allergens.forEach((a) => allergens.add(a));
    }
  }
  result.allergens = [...allergens];

  ctx.cache.set(dish.id, result);
  return result;
}

/** Calcula todos los platos de un contexto. */
export function costAllDishes(ctx: CostingContext): Map<ID, DishCost> {
  const out = new Map<ID, DishCost>();
  for (const d of ctx.dishes.values()) out.set(d.id, costDish(d, ctx));
  return out;
}

export type FoodCostStatus = 'ok' | 'warn' | 'bad' | 'none';

/** Semáforo de food cost: verde ≤ objetivo, ámbar ≤ umbral de atención, rojo por encima. */
export function foodCostStatus(pct: number | undefined, target: number, warning: number): FoodCostStatus {
  if (pct == null || !Number.isFinite(pct)) return 'none';
  if (pct <= target) return 'ok';
  if (pct <= warning) return 'warn';
  return 'bad';
}

/**
 * Precio máximo de compra (€/ud base) de un ingrediente para que el plato cumpla el objetivo,
 * manteniendo el resto de costes. Útil para negociar con proveedores.
 */
export function maxAffordablePrice(dishCost: DishCost, itemId: ID, dish: Dish, business: BusinessSettings): number | undefined {
  const item = dishCost.items.find((i) => i.itemId === itemId);
  if (!item || !dishCost.netPrice || !(item.grossQty > 0)) return undefined;
  const target = dish.targetFoodCostPct ?? business.targetFoodCostPct;
  const portions = dish.portions > 0 ? dish.portions : 1;
  const allowedTotal = (dishCost.netPrice * target) / 100 * portions;
  const others = dishCost.totalCost - item.cost;
  const allowedItem = allowedTotal - others;
  // Con prueba de rendimiento el coste es bruto·precio − abono fijo de subproductos (no depende del precio).
  const byproductCredit = Math.max(0, item.grossQty * (item.pricePerBase ?? 0) - item.cost);
  if (allowedItem + byproductCredit <= 0) return 0;
  return (allowedItem + byproductCredit) / item.grossQty;
}
