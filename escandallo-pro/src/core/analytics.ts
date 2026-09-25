import type { BusinessSettings, Dish, DishCost, ID, Invoice, InvoiceLine, MenuEngineeringClass, PricePoint, Product, IngredientCategory, BaseUnit } from '../types';
import { costDish, foodCostStatus, type CostingContext } from './costing';

/**
 * Analítica de negocio: ingeniería de menú, alertas de precio y KPIs del panel.
 */

export interface MenuEngineeringRow {
  dishId: ID;
  name: string;
  section?: string;
  unitsSold: number;
  /** % de ventas sobre el total de platos analizados. */
  mixPct: number;
  /** Margen de contribución unitario (€) = PVP sin IVA − coste ración. */
  contributionMargin: number;
  /** Margen total aportado (€) = margen unitario × unidades. */
  totalMargin: number;
  popularity: 'alta' | 'baja';
  profitability: 'alta' | 'baja';
  class: MenuEngineeringClass;
  foodCostPct?: number;
}

const CLASS_OF: Record<'alta' | 'baja', Record<'alta' | 'baja', MenuEngineeringClass>> = {
  alta: { alta: 'estrella', baja: 'caballo' },
  baja: { alta: 'enigma', baja: 'perro' },
};

function netPriceOf(dish: Dish, cost: DishCost): number | undefined {
  if (cost.netPrice && cost.netPrice > 0) return cost.netPrice;
  if (!(dish.menuPrice && dish.menuPrice > 0)) return undefined;
  return dish.menuPrice / (1 + (dish.saleVatPct ?? 0) / 100);
}

/**
 * Matriz de Kasavana & Smith. Sólo platos (kind='plato') con PVP y coste > 0.
 * Popularidad alta si mixPct ≥ 70 % × (100 / nº platos). Rentabilidad alta si margen ≥ margen medio ponderado por ventas.
 * estrella = alta/alta, caballo (caballo de batalla) = popular/poco rentable, enigma = poco popular/rentable, perro = baja/baja.
 * Si ningún plato tiene unitsSold, se asume 1 venta por plato (sólo se clasifica por margen) y hasVolumeData = false.
 * Las filas salen ordenadas por margen total aportado (mayor primero).
 */
export function menuEngineering(dishes: Dish[], costs: Map<ID, DishCost>): {
  rows: MenuEngineeringRow[];
  avgMargin: number;
  popularityThresholdPct: number;
  hasVolumeData: boolean;
} {
  const eligible: { dish: Dish; cost: DishCost; net: number }[] = [];
  for (const dish of dishes) {
    if (dish.kind !== 'plato') continue;
    const cost = costs.get(dish.id);
    if (!cost || !(cost.costPerPortion > 0)) continue;
    const net = netPriceOf(dish, cost);
    if (!net) continue;
    eligible.push({ dish, cost, net });
  }
  const n = eligible.length;
  const hasVolumeData = eligible.some((e) => (e.dish.unitsSold ?? 0) > 0);
  const popularityThresholdPct = n ? (0.7 * 100) / n : 0;
  if (!n) return { rows: [], avgMargin: 0, popularityThresholdPct, hasVolumeData };

  const units = eligible.map((e) => (hasVolumeData ? Math.max(0, e.dish.unitsSold ?? 0) : 1));
  const totalUnits = units.reduce((a, b) => a + b, 0);
  const margins = eligible.map((e) => e.net - e.cost.costPerPortion);
  const totalMarginSum = margins.reduce((s, m, i) => s + m * units[i], 0);
  const avgMargin = totalUnits > 0 ? totalMarginSum / totalUnits : margins.reduce((a, b) => a + b, 0) / n;
  const EPS = 1e-9;

  const rows: MenuEngineeringRow[] = eligible.map((e, i) => {
    const mixPct = totalUnits > 0 ? (units[i] / totalUnits) * 100 : 0;
    const popularity: 'alta' | 'baja' = mixPct + EPS >= popularityThresholdPct ? 'alta' : 'baja';
    const profitability: 'alta' | 'baja' = margins[i] + EPS >= avgMargin ? 'alta' : 'baja';
    return {
      dishId: e.dish.id,
      name: e.dish.name,
      section: e.dish.section,
      unitsSold: units[i],
      mixPct,
      contributionMargin: margins[i],
      totalMargin: margins[i] * units[i],
      popularity,
      profitability,
      class: CLASS_OF[popularity][profitability],
      foodCostPct: e.cost.foodCostPct ?? (e.cost.costPerPortion / e.net) * 100,
    };
  });
  rows.sort((a, b) => b.totalMargin - a.totalMargin || b.contributionMargin - a.contributionMargin);
  return { rows, avgMargin, popularityThresholdPct, hasVolumeData };
}

export interface PriceAlert {
  productId: ID;
  productName: string;
  baseUnit: BaseUnit;
  previousPrice: number;
  currentPrice: number;
  /** Variación (%) respecto al precio anterior (positivo = subida). */
  changePct: number;
  previousDate: string;
  currentDate: string;
  /** Platos/elaboraciones que usan el producto (directamente). */
  affectedDishIds: ID[];
}

/** Dos precios se consideran iguales si difieren menos de 0,01 céntimos. */
const PRICE_EPS = 1e-4;

/**
 * Compara, para cada producto, su último precio con el anterior (distinto) del histórico.
 * Devuelve las variaciones con |changePct| ≥ thresholdPct, ordenadas por mayor subida primero.
 * A igualdad de fecha manda el orden del array (el último registrado es el más reciente).
 */
export function priceAlerts(products: Product[], pricePoints: PricePoint[], thresholdPct: number, dishes: Dish[] = []): PriceAlert[] {
  const byProduct = new Map<ID, { p: PricePoint; order: number }[]>();
  pricePoints.forEach((p, order) => {
    if (!(p.pricePerBase > 0) || !p.date) return;
    let list = byProduct.get(p.productId);
    if (!list) byProduct.set(p.productId, (list = []));
    list.push({ p, order });
  });
  const usage = new Map<ID, ID[]>();
  for (const d of dishes) {
    for (const it of d.items) {
      if (it.ref?.type !== 'product') continue;
      const list = usage.get(it.ref.id) ?? [];
      if (!list.includes(d.id)) list.push(d.id);
      usage.set(it.ref.id, list);
    }
  }
  const threshold = Math.abs(thresholdPct);
  const alerts: PriceAlert[] = [];
  for (const product of products) {
    const list = byProduct.get(product.id);
    if (!list || list.length < 2) continue;
    list.sort((a, b) => (a.p.date < b.p.date ? -1 : a.p.date > b.p.date ? 1 : a.order - b.order));
    const current = list[list.length - 1].p;
    let previous: PricePoint | undefined;
    for (let i = list.length - 2; i >= 0; i--) {
      if (Math.abs(list[i].p.pricePerBase - current.pricePerBase) > PRICE_EPS) {
        previous = list[i].p;
        break;
      }
    }
    if (!previous) continue;
    const changePct = ((current.pricePerBase - previous.pricePerBase) / previous.pricePerBase) * 100;
    if (Math.abs(changePct) + 1e-9 < threshold) continue;
    alerts.push({
      productId: product.id,
      productName: product.name,
      baseUnit: product.baseUnit,
      previousPrice: previous.pricePerBase,
      currentPrice: current.pricePerBase,
      changePct,
      previousDate: previous.date,
      currentDate: current.date,
      affectedDishIds: usage.get(product.id) ?? [],
    });
  }
  alerts.sort((a, b) => b.changePct - a.changePct);
  return alerts;
}

export interface DashboardStats {
  dishCount: number;
  /** Media simple del food cost de los platos con PVP y coste. */
  avgFoodCostPct?: number;
  /** Food cost ponderado por unidades vendidas (o = media simple si no hay ventas). */
  weightedFoodCostPct?: number;
  avgMarginEur?: number;
  dishesOk: number;
  dishesWarn: number;
  dishesBad: number;
  /** Platos sin PVP o sin coste calculable. */
  dishesNoData: number;
  /** Platos con líneas sin precio / sin vincular. */
  incompleteDishes: number;
  productCount: number;
  productsWithoutPrice: number;
  invoiceCount: number;
  pendingInvoices: number;
  /** Gasto (sin IVA) de facturas confirmadas por mes, últimos 12 meses con datos: [{ month: 'YYYY-MM', total }]. */
  monthlySpend: { month: string; total: number }[];
  spendByCategory: { category: IngredientCategory; total: number }[];
  spendBySupplier: { supplier: string; total: number }[];
  /** Productos que más dinero suponen en compras. */
  topProductsBySpend: { productId: ID; name: string; total: number }[];
  /** Distribución de platos por tramos de food cost: <25, 25-30, 30-35, 35-40, >40. */
  foodCostBuckets: { label: string; count: number }[];
  /** Merma media de los platos (% en peso). */
  avgWastePct?: number;
}

/** Tramos de food cost (límite superior incluido: un 30 % exacto cae en "25–30 %", igual que el semáforo). */
export const FOOD_COST_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '≤ 25 %', min: -Infinity, max: 25 },
  { label: '25–30 %', min: 25, max: 30 },
  { label: '30–35 %', min: 30, max: 35 },
  { label: '35–40 %', min: 35, max: 40 },
  { label: '> 40 %', min: 40, max: Infinity },
];

const PENDING_STATUSES = new Set<Invoice['status']>(['pendiente', 'procesando', 'revision']);
const TOP_PRODUCTS = 10;

/** Importe efectivo de una línea (sin IVA, con descuento). */
function lineAmount(l: InvoiceLine): number {
  if (Number.isFinite(l.total) && l.total !== 0) return l.total;
  const q = Number.isFinite(l.quantity) ? l.quantity : 0;
  const p = Number.isFinite(l.unitPrice) ? l.unitPrice : 0;
  return q * p * (1 - (l.discountPct ?? 0) / 100);
}

/** Base imponible de una factura: la declarada o, si falta, la suma de sus líneas (sin las ignoradas). */
function invoiceSpend(inv: Invoice): number {
  if (inv.subtotal != null && Number.isFinite(inv.subtotal) && inv.subtotal !== 0) return inv.subtotal;
  return inv.lines.filter((l) => l.matchStatus !== 'ignorado').reduce((s, l) => s + lineAmount(l), 0);
}

function sortedTotals<K extends string>(map: Map<K, number>): { key: K; total: number }[] {
  return [...map.entries()].map(([key, total]) => ({ key, total })).sort((a, b) => b.total - a.total);
}

export function dashboardStats(args: {
  dishes: Dish[];
  costs: Map<ID, DishCost>;
  products: Product[];
  invoices: Invoice[];
  business: BusinessSettings;
}): DashboardStats {
  const { dishes, costs, products, invoices, business } = args;
  const plates = dishes.filter((d) => d.kind === 'plato');

  let fcSum = 0;
  let fcCount = 0;
  let marginSum = 0;
  let wCost = 0;
  let wRevenue = 0;
  let wasteSum = 0;
  let wasteCount = 0;
  let ok = 0;
  let warn = 0;
  let bad = 0;
  let noData = 0;
  let incomplete = 0;
  const buckets = FOOD_COST_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  const hasSales = plates.some((d) => (d.unitsSold ?? 0) > 0);

  for (const d of plates) {
    const c = costs.get(d.id);
    if (!c || c.completeness < 1 || !c.items.length) incomplete++;
    if (c && c.grossKgPerPortion > 0) {
      wasteSum += c.wastePct;
      wasteCount++;
    }
    const net = c ? netPriceOf(d, c) : undefined;
    if (!c || !(c.totalCost > 0) || !net) {
      noData++;
      continue;
    }
    const fc = c.foodCostPct ?? (c.costPerPortion / net) * 100;
    fcSum += fc;
    fcCount++;
    marginSum += c.grossMargin ?? net - c.costPerPortion;
    if (hasSales) {
      const u = Math.max(0, d.unitsSold ?? 0);
      wCost += c.costPerPortion * u;
      wRevenue += net * u;
    }
    const target = d.targetFoodCostPct ?? business.targetFoodCostPct;
    const status = foodCostStatus(fc, target, Math.max(target, business.warningFoodCostPct));
    if (status === 'ok') ok++;
    else if (status === 'warn') warn++;
    else if (status === 'bad') bad++;
    const bi = FOOD_COST_BUCKETS.findIndex((b) => fc > b.min && fc <= b.max);
    if (bi >= 0) buckets[bi].count++;
  }
  const avgFoodCostPct = fcCount ? fcSum / fcCount : undefined;
  const weightedFoodCostPct = hasSales && wRevenue > 0 ? (wCost / wRevenue) * 100 : avgFoodCostPct;

  // Compras (sólo facturas confirmadas)
  const confirmed = invoices.filter((i) => i.status === 'confirmada');
  const productById = new Map(products.map((p) => [p.id, p]));
  const byMonth = new Map<string, number>();
  const bySupplier = new Map<string, number>();
  const byCategory = new Map<IngredientCategory, number>();
  const byProduct = new Map<ID, number>();
  for (const inv of confirmed) {
    const spend = invoiceSpend(inv);
    const month = /^\d{4}-\d{2}/.test(inv.date ?? '') ? inv.date.slice(0, 7) : undefined;
    if (month) byMonth.set(month, (byMonth.get(month) ?? 0) + spend);
    const supplier = inv.supplierName?.trim() || 'Sin proveedor';
    bySupplier.set(supplier, (bySupplier.get(supplier) ?? 0) + spend);
    for (const l of inv.lines) {
      if (l.matchStatus === 'ignorado') continue;
      const amount = lineAmount(l);
      const product = l.productId ? productById.get(l.productId) : undefined;
      const category: IngredientCategory = product?.category ?? l.suggestedCategory ?? 'otros';
      byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
      if (product) byProduct.set(product.id, (byProduct.get(product.id) ?? 0) + amount);
    }
  }
  const monthlySpend = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-12)
    .map(([month, total]) => ({ month, total }));

  return {
    dishCount: plates.length,
    avgFoodCostPct,
    weightedFoodCostPct,
    avgMarginEur: fcCount ? marginSum / fcCount : undefined,
    dishesOk: ok,
    dishesWarn: warn,
    dishesBad: bad,
    dishesNoData: noData,
    incompleteDishes: incomplete,
    productCount: products.length,
    productsWithoutPrice: products.filter((p) => !(p.pricePerBase > 0)).length,
    invoiceCount: invoices.length,
    pendingInvoices: invoices.filter((i) => PENDING_STATUSES.has(i.status)).length,
    monthlySpend,
    spendByCategory: sortedTotals(byCategory).map(({ key, total }) => ({ category: key, total })),
    spendBySupplier: sortedTotals(bySupplier).map(({ key, total }) => ({ supplier: key, total })),
    topProductsBySpend: sortedTotals(byProduct)
      .slice(0, TOP_PRODUCTS)
      .map(({ key, total }) => ({ productId: key, name: productById.get(key)?.name ?? key, total })),
    foodCostBuckets: buckets,
    avgWastePct: wasteCount ? wasteSum / wasteCount : undefined,
  };
}

/** Platos que usan un producto, directa o indirectamente a través de elaboraciones. */
export function dishesUsingProduct(dishes: Iterable<Dish>, productId: ID): Set<ID> {
  const all = [...dishes];
  const affected = new Set<ID>();
  for (const d of all) if (d.items.some((it) => it.ref?.type === 'product' && it.ref.id === productId)) affected.add(d.id);
  // Propagación a quien usa esas elaboraciones (hasta punto fijo; tolera ciclos)
  let grew = affected.size > 0;
  while (grew) {
    grew = false;
    for (const d of all) {
      if (affected.has(d.id)) continue;
      if (d.items.some((it) => it.ref?.type === 'dish' && affected.has(it.ref.id))) {
        affected.add(d.id);
        grew = true;
      }
    }
  }
  return affected;
}

/**
 * Simulación "¿y si?": cambia el precio de un producto y devuelve el impacto en cada plato afectado.
 * No modifica el contexto original (clona y recalcula). Incluye los platos y elaboraciones que usan el
 * producto a través de sub-recetas. Orden: mayor subida de food cost primero (los que no tienen PVP,
 * detrás, por subida de coste por ración).
 */
export function simulatePriceChange(ctx: CostingContext, productId: ID, newPricePerBase: number): {
  dishId: ID;
  name: string;
  before: DishCost;
  after: DishCost;
}[] {
  const product = ctx.products.get(productId);
  if (!product || !Number.isFinite(newPricePerBase) || newPricePerBase < 0) return [];
  const affected = dishesUsingProduct(ctx.dishes.values(), productId);
  if (!affected.size) return [];

  const beforeCtx: CostingContext = { ...ctx, cache: new Map(ctx.cache) };
  const products = new Map(ctx.products);
  products.set(productId, { ...product, pricePerBase: newPricePerBase });
  const afterCtx: CostingContext = { ...ctx, products, cache: new Map() };

  const rows: { dishId: ID; name: string; before: DishCost; after: DishCost }[] = [];
  for (const id of affected) {
    const dish = ctx.dishes.get(id);
    if (!dish) continue;
    rows.push({ dishId: id, name: dish.name, before: costDish(dish, beforeCtx), after: costDish(dish, afterCtx) });
  }
  const fcDelta = (r: (typeof rows)[number]) =>
    r.before.foodCostPct != null && r.after.foodCostPct != null ? r.after.foodCostPct - r.before.foodCostPct : undefined;
  rows.sort((a, b) => {
    const da = fcDelta(a);
    const db = fcDelta(b);
    if (da !== undefined && db !== undefined) return db - da;
    if (da !== undefined) return -1;
    if (db !== undefined) return 1;
    return b.after.costPerPortion - b.before.costPerPortion - (a.after.costPerPortion - a.before.costPerPortion);
  });
  return rows;
}
