/**
 * Lógica pura del panel e informes: derivaciones sobre los datos del espacio de trabajo.
 * Sin React ni BD, para poder probarla a fondo.
 */
import type {
  BaseUnit,
  BusinessSettings,
  Dish,
  DishCost,
  ID,
  IngredientCategory,
  Invoice,
  MenuScan,
  PricePoint,
  Product,
  YieldTest,
} from '../../types';
import { foodCostStatus, type FoodCostStatus } from '../../core/costing';
import { computeYield } from '../../core/yield';
import { prevMonth } from './dates';

// ───────────────────────────── Semáforo ─────────────────────────────

/**
 * Semáforo de un plato respetando su objetivo propio: si el plato tiene un objetivo distinto al del negocio,
 * el umbral de atención se desplaza lo mismo para mantener el margen ámbar configurado.
 */
export function dishStatus(cost: Pick<DishCost, 'foodCostPct' | 'targetFoodCostPct'>, business: BusinessSettings): FoodCostStatus {
  const target = cost.targetFoodCostPct ?? business.targetFoodCostPct;
  const gap = Math.max(0, business.warningFoodCostPct - business.targetFoodCostPct);
  return foodCostStatus(cost.foodCostPct, target, target + gap);
}

export function businessStatus(pct: number | undefined, business: BusinessSettings): FoodCostStatus {
  return foodCostStatus(pct, business.targetFoodCostPct, Math.max(business.targetFoodCostPct, business.warningFoodCostPct));
}

// ───────────────────────────── Food cost por plato ─────────────────────────────

export interface DishFcRow {
  id: ID;
  name: string;
  section?: string;
  foodCostPct: number;
  status: FoodCostStatus;
  target: number;
  costPerPortion: number;
  menuPrice?: number;
  netPrice?: number;
  suggestedPrice?: number;
  grossMargin?: number;
  completeness: number;
  unitsSold?: number;
  /** Sobrecoste por ración respecto al objetivo (€, > 0 si está por encima). */
  excessCost: number;
}

/** Platos de carta con food cost calculable, ordenados de mayor a menor food cost. */
export function dishFoodCostRows(dishes: Dish[], costs: Map<ID, DishCost>, business: BusinessSettings): DishFcRow[] {
  const rows: DishFcRow[] = [];
  for (const d of dishes) {
    if (d.kind !== 'plato') continue;
    const c = costs.get(d.id);
    if (!c || c.foodCostPct == null || !Number.isFinite(c.foodCostPct) || !(c.costPerPortion > 0)) continue;
    const target = c.targetFoodCostPct ?? business.targetFoodCostPct;
    const allowed = c.netPrice != null ? (c.netPrice * target) / 100 : undefined;
    rows.push({
      id: d.id,
      name: d.name,
      section: d.section,
      foodCostPct: c.foodCostPct,
      status: dishStatus(c, business),
      target,
      costPerPortion: c.costPerPortion,
      menuPrice: d.menuPrice,
      netPrice: c.netPrice,
      suggestedPrice: c.suggestedPrice,
      grossMargin: c.grossMargin,
      completeness: c.completeness,
      unitsSold: d.unitsSold,
      excessCost: allowed != null ? Math.max(0, c.costPerPortion - allowed) : 0,
    });
  }
  return rows.sort((a, b) => b.foodCostPct - a.foodCostPct || a.name.localeCompare(b.name, 'es'));
}

export interface StatusCounts {
  ok: number;
  warn: number;
  bad: number;
  total: number;
}

export function countByStatus(rows: Pick<DishFcRow, 'status'>[]): StatusCounts {
  const out: StatusCounts = { ok: 0, warn: 0, bad: 0, total: 0 };
  for (const r of rows) {
    if (r.status === 'ok' || r.status === 'warn' || r.status === 'bad') {
      out[r.status]++;
      out.total++;
    }
  }
  return out;
}

/** Platos en ámbar o rojo: primero los rojos, y dentro de cada grupo los de mayor food cost. */
export function dishesNeedingAttention(rows: DishFcRow[]): DishFcRow[] {
  const rank: Record<FoodCostStatus, number> = { bad: 0, warn: 1, ok: 2, none: 3 };
  return rows
    .filter((r) => r.status === 'bad' || r.status === 'warn')
    .sort((a, b) => rank[a.status] - rank[b.status] || b.foodCostPct - a.foodCostPct);
}

/**
 * Posición (0–1) de un food cost en la escala visual del semáforo del panel.
 * La escala va de 0 a max(objetivo × 2, umbral + 15, valor + 5) para que siempre haya aire a ambos lados.
 */
export function foodCostScale(pct: number | undefined, business: BusinessSettings): { max: number; pos: number; targetPos: number; warnPos: number } {
  const target = business.targetFoodCostPct;
  const warn = Math.max(target, business.warningFoodCostPct);
  const max = Math.ceil(Math.max(target * 2, warn + 15, (pct ?? 0) + 5) / 5) * 5;
  const clamp = (v: number) => Math.min(1, Math.max(0, v / max));
  return { max, pos: clamp(pct ?? 0), targetPos: clamp(target), warnPos: clamp(warn) };
}

// ───────────────────────────── Tramos ─────────────────────────────

/** Interpreta etiquetas de tramo tipo '<25', '25-30', '30–35 %', '>40' → [min, max]. */
export function parseBucketLabel(label: string): { min: number; max: number } | undefined {
  const nums = (label.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
  if (!nums.length) return undefined;
  const t = label.trim();
  if (t.startsWith('<') || t.startsWith('≤') || /^menos/i.test(t)) return { min: 0, max: nums[0]! };
  if (t.startsWith('>') || t.startsWith('≥') || /^m[aá]s/i.test(t)) return { min: nums[0]!, max: nums[0]! + 10 };
  if (nums.length >= 2) return { min: Math.min(nums[0]!, nums[1]!), max: Math.max(nums[0]!, nums[1]!) };
  return undefined;
}

/** Etiqueta legible de un tramo: '<25' → '< 25 %', '25-30' → '25–30 %'. */
export function prettyBucketLabel(label: string): string {
  const t = label.trim();
  const r = parseBucketLabel(t);
  if (!r) return t;
  if (t.startsWith('<') || t.startsWith('≤')) return `< ${r.min === 0 ? r.max : r.min} %`;
  if (t.startsWith('>') || t.startsWith('≥')) return `> ${r.min} %`;
  return `${r.min}–${r.max} %`;
}

/** Color del semáforo de un tramo según su punto medio. */
export function bucketStatus(label: string, business: BusinessSettings): FoodCostStatus {
  const r = parseBucketLabel(label);
  if (!r) return 'none';
  return businessStatus((r.min + r.max) / 2, business);
}

// ───────────────────────────── Gasto ─────────────────────────────

export interface SpendTrend {
  month: string;
  total: number;
  previousMonth: string;
  previousTotal?: number;
  /** Variación % respecto al mes anterior (undefined si no hay mes anterior con gasto). */
  changePct?: number;
  /** true si `month` es el mes natural en curso (dato parcial). */
  inProgress: boolean;
}

/** Gasto del último mes con datos y su variación respecto al mes natural anterior. */
export function lastMonthSpend(monthly: { month: string; total: number }[], currentMonth?: string): SpendTrend | undefined {
  const withData = monthly.filter((m) => m.total > 0).sort((a, b) => a.month.localeCompare(b.month));
  const last = withData[withData.length - 1];
  if (!last) return undefined;
  const pm = prevMonth(last.month);
  const prev = monthly.find((m) => m.month === pm);
  const previousTotal = prev && prev.total > 0 ? prev.total : undefined;
  return {
    month: last.month,
    total: last.total,
    previousMonth: pm,
    previousTotal,
    changePct: previousTotal ? ((last.total - previousTotal) / previousTotal) * 100 : undefined,
    inProgress: currentMonth === last.month,
  };
}

/** Rellena los meses sin compras entre el primero y el último para que el eje temporal sea continuo. */
export function fillMonths(monthly: { month: string; total: number }[]): { month: string; total: number }[] {
  const sorted = [...monthly].filter((m) => /^\d{4}-\d{2}$/.test(m.month)).sort((a, b) => a.month.localeCompare(b.month));
  if (sorted.length < 2) return sorted;
  const byMonth = new Map(sorted.map((m) => [m.month, m.total]));
  const out: { month: string; total: number }[] = [];
  const last = sorted[sorted.length - 1]!.month;
  let cur = last;
  // Recorremos hacia atrás desde el último hasta el primero (máx. 36 meses por seguridad).
  for (let i = 0; i < 36; i++) {
    out.unshift({ month: cur, total: byMonth.get(cur) ?? 0 });
    if (cur === sorted[0]!.month) break;
    cur = prevMonth(cur);
  }
  return out;
}

/** Top N y el resto agrupado en "Otros". */
export function topWithOther<T extends { total: number }>(items: T[], n: number, makeOther: (total: number, count: number) => T): T[] {
  const sorted = [...items].filter((i) => i.total > 0).sort((a, b) => b.total - a.total);
  if (sorted.length <= n) return sorted;
  const head = sorted.slice(0, n - 1);
  const tail = sorted.slice(n - 1);
  return [
    ...head,
    makeOther(
      tail.reduce((s, i) => s + i.total, 0),
      tail.length,
    ),
  ];
}

// ───────────────────────────── Puesta en marcha ─────────────────────────────

export interface OnboardingStep {
  key: 'facturas' | 'carta' | 'escandallos';
  title: string;
  description: string;
  cta: string;
  to: string;
  done: boolean;
}

export function onboardingSteps(args: {
  invoiceCount: number;
  productCount: number;
  menuScanCount: number;
  dishCount: number;
  reviewedDishCount: number;
}): { steps: OnboardingStep[]; doneCount: number; progress: number; next?: OnboardingStep } {
  const steps: OnboardingStep[] = [
    {
      key: 'facturas',
      title: 'Sube tus facturas de proveedor',
      description: 'PDF, foto o Excel. Se leen gratis en tu dispositivo y crean tu base de precios de ingredientes.',
      cta: 'Subir facturas',
      to: '/facturas?nuevo=1',
      done: args.invoiceCount > 0 || args.productCount > 0,
    },
    {
      key: 'carta',
      title: 'Haz una foto a tu carta',
      description: 'Detectamos cada plato con su precio y te proponemos los ingredientes y gramajes de cada receta.',
      cta: 'Fotografiar carta',
      to: '/carta?nuevo=1',
      done: args.menuScanCount > 0 || args.dishCount > 0,
    },
    {
      key: 'escandallos',
      title: 'Revisa tus escandallos',
      description: 'Ajusta cantidades y mermas: verás el food cost, el margen y el precio recomendado de cada plato.',
      cta: 'Revisar escandallos',
      to: '/platos',
      done: args.reviewedDishCount > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, progress: doneCount / steps.length, next: steps.find((s) => !s.done) };
}

// ───────────────────────────── Por revisar ─────────────────────────────

export interface ReviewItem {
  kind: 'factura' | 'plato' | 'carta';
  id: ID;
  title: string;
  subtitle: string;
  to: string;
  tone: 'warn' | 'bad' | 'ai';
  date?: string;
}

/** Tareas pendientes: facturas por revisar o con error, cartas por importar y platos con propuestas sin revisar. */
export function reviewQueue(invoices: Invoice[], dishes: Dish[], menuScans: MenuScan[]): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const inv of invoices) {
    if (inv.status === 'revision') {
      const n = inv.lines.length;
      const doubtful = inv.lines.filter((l) => (l.warnings?.length ?? 0) > 0 || l.matchStatus === 'nuevo' || l.matchStatus === 'sugerido').length;
      out.push({
        kind: 'factura',
        id: inv.id,
        title: inv.supplierName || inv.fileName || 'Factura sin proveedor',
        subtitle: `${n} línea${n === 1 ? '' : 's'}${doubtful ? ` · ${doubtful} por confirmar` : ''}`,
        to: `/facturas/${inv.id}`,
        tone: 'warn',
        date: inv.date || inv.createdAt,
      });
    } else if (inv.status === 'error') {
      out.push({
        kind: 'factura',
        id: inv.id,
        title: inv.supplierName || inv.fileName || 'Factura',
        subtitle: inv.error ? `No se pudo leer: ${inv.error}` : 'No se pudo leer: revísala a mano',
        to: `/facturas/${inv.id}`,
        tone: 'bad',
        date: inv.createdAt,
      });
    }
  }
  for (const scan of menuScans) {
    if (scan.status !== 'revision') continue;
    const n = scan.entries.length;
    out.push({
      kind: 'carta',
      id: scan.id,
      title: scan.name || 'Carta',
      subtitle: `${n} plato${n === 1 ? '' : 's'} detectado${n === 1 ? '' : 's'} por importar`,
      to: `/carta/${scan.id}`,
      tone: 'warn',
      date: scan.createdAt,
    });
  }
  for (const d of dishes) {
    if (d.status !== 'borrador') continue;
    const suggested = d.items.filter((i) => i.suggested).length;
    if (!suggested) continue;
    out.push({
      kind: 'plato',
      id: d.id,
      title: d.name,
      subtitle: `${suggested} ingrediente${suggested === 1 ? '' : 's'} propuesto${suggested === 1 ? '' : 's'} sin revisar`,
      to: `/platos/${d.id}`,
      tone: 'ai',
      date: d.updatedAt,
    });
  }
  const rank = { bad: 0, warn: 1, ai: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || (b.date ?? '').localeCompare(a.date ?? ''));
}

// ───────────────────────────── Mermas ─────────────────────────────

export interface DishWasteRow {
  id: ID;
  name: string;
  section?: string;
  wastePct: number;
  wasteKgPerPortion: number;
  wasteCostPerPortion: number;
  costPerPortion: number;
  /** % del coste de la ración que se va en merma. */
  wasteShareOfCost: number;
  unitsSold?: number;
  /** Coste de merma en el periodo de ventas registrado (€). */
  periodWasteCost?: number;
}

/** Platos y elaboraciones con merma calculable (con peso), ordenados por coste de merma por ración. */
export function dishWasteRows(dishes: Dish[], costs: Map<ID, DishCost>, kinds: Dish['kind'][] = ['plato']): DishWasteRow[] {
  const rows: DishWasteRow[] = [];
  for (const d of dishes) {
    if (!kinds.includes(d.kind)) continue;
    const c = costs.get(d.id);
    if (!c || !(c.grossKgPerPortion > 0) || !(c.costPerPortion > 0)) continue;
    rows.push({
      id: d.id,
      name: d.name,
      section: d.section,
      wastePct: c.wastePct,
      wasteKgPerPortion: c.wasteKgPerPortion,
      wasteCostPerPortion: c.wasteCostPerPortion,
      costPerPortion: c.costPerPortion,
      wasteShareOfCost: (c.wasteCostPerPortion / c.costPerPortion) * 100,
      unitsSold: d.unitsSold,
      periodWasteCost: d.unitsSold && d.unitsSold > 0 ? d.unitsSold * c.wasteCostPerPortion : undefined,
    });
  }
  return rows.sort((a, b) => b.wasteCostPerPortion - a.wasteCostPerPortion || b.wastePct - a.wastePct);
}

export interface ProductWasteRow {
  id: ID;
  name: string;
  category: IngredientCategory;
  baseUnit: BaseUnit;
  pricePerBase: number;
  /** Merma de limpieza/despiece aplicada (%). */
  cleaningPct: number;
  cookingPct: number;
  /** Pérdida total de compra a plato (%) = 1 − (1 − limpieza)(1 − cocción). */
  totalLossPct: number;
  source: 'prueba' | 'producto';
  /** € que se pierden en limpieza por cada unidad base comprada. */
  lossPerBase: number;
  /** Precio real por unidad limpia (€/kg útil). Con prueba, descuenta el valor de los subproductos. */
  realPricePerUsable: number;
  usedInDishes: number;
}

/** Productos con merma > 0, ordenados por el dinero que se pierde por unidad comprada. */
export function productWasteRows(products: Product[], yieldTests: YieldTest[], dishes: Dish[] = []): ProductWasteRow[] {
  const tests = new Map(yieldTests.map((t) => [t.id, t]));
  const usage = new Map<ID, number>();
  for (const d of dishes) {
    const seen = new Set<ID>();
    for (const it of d.items) if (it.ref?.type === 'product' && !seen.has(it.ref.id)) seen.add(it.ref.id);
    for (const id of seen) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  const rows: ProductWasteRow[] = [];
  for (const p of products) {
    let cleaning = p.wastePct ?? 0;
    let cooking = p.cookingLossPct ?? 0;
    let source: ProductWasteRow['source'] = 'producto';
    let realPrice: number | undefined;
    const test = p.yieldTestId ? tests.get(p.yieldTestId) : undefined;
    if (test) {
      const price = p.baseUnit === 'kg' && p.pricePerBase > 0 ? p.pricePerBase : test.purchasePricePerKg;
      const r = computeYield({ ...test, purchasePricePerKg: price });
      if (r.principalKg > 0) {
        cleaning = r.totalWastePct;
        cooking = test.cookingLossPct ?? cooking;
        source = 'prueba';
        realPrice = r.costPerUsableKg;
      }
    }
    cleaning = Math.min(99, Math.max(0, cleaning));
    cooking = Math.min(99, Math.max(0, cooking));
    if (!(cleaning > 0) && !(cooking > 0)) continue;
    const price = p.pricePerBase > 0 ? p.pricePerBase : 0;
    const totalLossPct = (1 - (1 - cleaning / 100) * (1 - cooking / 100)) * 100;
    rows.push({
      id: p.id,
      name: p.name,
      category: p.category,
      baseUnit: p.baseUnit,
      pricePerBase: price,
      cleaningPct: cleaning,
      cookingPct: cooking,
      totalLossPct,
      source,
      lossPerBase: (price * cleaning) / 100,
      realPricePerUsable: realPrice ?? (cleaning < 100 ? price / (1 - cleaning / 100) : price),
      usedInDishes: usage.get(p.id) ?? 0,
    });
  }
  return rows.sort((a, b) => b.lossPerBase - a.lossPerBase || b.totalLossPct - a.totalLossPct);
}

// ───────────────────────────── Precios ─────────────────────────────

export interface PriceSeriesPoint {
  date: string;
  price: number;
  source: PricePoint['source'];
  supplierId?: ID;
  invoiceId?: ID;
  rawDescription?: string;
}

/** Serie temporal de precios ordenada por fecha; si hay varios en el mismo día se queda el último registrado. */
export function priceSeries(points: PricePoint[]): PriceSeriesPoint[] {
  const byDay = new Map<string, PriceSeriesPoint>();
  const sorted = [...points]
    .filter((p) => p.pricePerBase > 0 && Number.isFinite(p.pricePerBase) && p.date)
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => a.p.date.localeCompare(b.p.date) || a.p.id.localeCompare(b.p.id) || a.idx - b.idx);
  for (const { p } of sorted) {
    const day = p.date.slice(0, 10);
    byDay.set(day, {
      date: day,
      price: p.pricePerBase,
      source: p.source,
      supplierId: p.supplierId,
      invoiceId: p.invoiceId,
      rawDescription: p.rawDescription,
    });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface PriceSummary {
  first: PriceSeriesPoint;
  last: PriceSeriesPoint;
  min: number;
  max: number;
  avg: number;
  changePct: number;
  changeAbs: number;
}

export function priceSummary(series: PriceSeriesPoint[]): PriceSummary | undefined {
  if (!series.length) return undefined;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const prices = series.map((s) => s.price);
  return {
    first,
    last,
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: prices.reduce((s, v) => s + v, 0) / prices.length,
    changeAbs: last.price - first.price,
    changePct: first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0,
  };
}

// ───────────────────────────── Simulador ─────────────────────────────

export interface SimulationRow {
  dishId: ID;
  name: string;
  kind: Dish['kind'];
  menuPrice?: number;
  costBefore: number;
  costAfter: number;
  deltaCost: number;
  fcBefore?: number;
  fcAfter?: number;
  statusBefore: FoodCostStatus;
  statusAfter: FoodCostStatus;
  suggestedBefore?: number;
  suggestedAfter?: number;
}

/** Convierte el resultado de `simulatePriceChange` en filas para la tabla, ordenadas por mayor impacto por ración. */
export function simulationRows(
  sim: { dishId: ID; name: string; before: DishCost; after: DishCost }[],
  dishes: Map<ID, Dish> | Dish[],
  business: BusinessSettings,
): SimulationRow[] {
  const map = dishes instanceof Map ? dishes : new Map(dishes.map((d) => [d.id, d]));
  return sim
    .map((s) => {
      const d = map.get(s.dishId);
      return {
        dishId: s.dishId,
        name: s.name,
        kind: d?.kind ?? 'plato',
        menuPrice: d?.menuPrice,
        costBefore: s.before.costPerPortion,
        costAfter: s.after.costPerPortion,
        deltaCost: s.after.costPerPortion - s.before.costPerPortion,
        fcBefore: s.before.foodCostPct,
        fcAfter: s.after.foodCostPct,
        statusBefore: dishStatus(s.before, business),
        statusAfter: dishStatus(s.after, business),
        suggestedBefore: s.before.suggestedPrice,
        suggestedAfter: s.after.suggestedPrice,
      };
    })
    .sort(
      (a, b) =>
        (a.kind === 'plato' ? 0 : 1) - (b.kind === 'plato' ? 0 : 1) ||
        Math.abs(b.deltaCost) - Math.abs(a.deltaCost) ||
        a.name.localeCompare(b.name, 'es'),
    );
}

/** Resumen del simulador: cuántos platos cambian de semáforo y el impacto medio. */
export function simulationSummary(rows: SimulationRow[]): {
  affected: number;
  affectedElaborations: number;
  worsened: number;
  improved: number;
  avgDeltaFc?: number;
} {
  const rank: Record<FoodCostStatus, number> = { ok: 0, warn: 1, bad: 2, none: -1 };
  let worsened = 0;
  let improved = 0;
  const deltas: number[] = [];
  for (const r of rows) {
    if (r.kind !== 'plato') continue;
    if (r.statusBefore !== 'none' && r.statusAfter !== 'none') {
      if (rank[r.statusAfter] > rank[r.statusBefore]) worsened++;
      else if (rank[r.statusAfter] < rank[r.statusBefore]) improved++;
    }
    if (r.fcBefore != null && r.fcAfter != null) deltas.push(r.fcAfter - r.fcBefore);
  }
  return {
    affected: rows.filter((r) => r.kind === 'plato').length,
    affectedElaborations: rows.filter((r) => r.kind !== 'plato').length,
    worsened,
    improved,
    avgDeltaFc: deltas.length ? deltas.reduce((s, v) => s + v, 0) / deltas.length : undefined,
  };
}

/** Productos que se usan en al menos un plato o elaboración (candidatos del simulador), con su nº de usos. */
export function productsInUse(products: Product[], dishes: Dish[]): { product: Product; uses: number }[] {
  const uses = new Map<ID, number>();
  for (const d of dishes) {
    const seen = new Set<ID>();
    for (const it of d.items) {
      if (it.ref?.type !== 'product' || seen.has(it.ref.id)) continue;
      seen.add(it.ref.id);
      uses.set(it.ref.id, (uses.get(it.ref.id) ?? 0) + 1);
    }
  }
  return products
    .filter((p) => uses.has(p.id))
    .map((product) => ({ product, uses: uses.get(product.id) ?? 0 }))
    .sort((a, b) => b.uses - a.uses || a.product.name.localeCompare(b.product.name, 'es'));
}
