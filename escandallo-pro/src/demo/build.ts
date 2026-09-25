import type {
  BaseUnit,
  BusinessSettings,
  Dish,
  ID,
  Invoice,
  InvoiceLine,
  PackSize,
  PricePoint,
  Product,
  RecipeItem,
  Supplier,
  YieldTest,
} from '../types';
import { DEMO_PRODUCTS, DEMO_SUPPLIERS } from './catalog';
import { DEMO_INVOICES } from './invoices';
import { DEMO_DISHES, DEMO_ELABORATIONS, DEMO_YIELD_TESTS } from './recipes';
import type { DemoDish, DemoProduct, DemoRef, SupplierKey } from './spec';

/**
 * Construye (sin tocar la base de datos) todos los registros de la demo a partir de las fichas:
 * fechas relativas a `now`, importes de factura calculados con redondeo a céntimos, €/unidad base,
 * histórico de precios, precio vigente de cada producto y pruebas de rendimiento con el precio de su fecha.
 * Es una función pura y determinista (salvo los ids), por lo que se puede verificar en tests.
 */

export interface DemoData {
  suppliers: Supplier[];
  products: Product[];
  pricePoints: PricePoint[];
  invoices: Invoice[];
  dishes: Dish[];
  yieldTests: YieldTest[];
  business: BusinessSettings;
}

export interface BuildDemoOptions {
  /** Fecha de referencia ("hoy"). */
  now: Date;
  /** Generador de ids únicos. */
  makeId: () => ID;
  /** Clave de búsqueda de un nombre de producto. */
  searchKey: (name: string) => string;
}

export const DEMO_BUSINESS: BusinessSettings = {
  id: 'business',
  targetFoodCostPct: 30,
  warningFoodCostPct: 35,
  defaultSaleVatPct: 10,
  priceAlertPct: 5,
  currency: 'EUR',
  priceRounding: 0.5,
};

/** IVA de venta en restauración (España). */
const SALE_VAT_PCT = 10;

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const round4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;

/** Fecha local YYYY-MM-DD de hace `daysAgo` días. */
export function localDate(now: Date, daysAgo: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Marca de tiempo ISO de hace `daysAgo` días a una hora local concreta. */
function localTimestamp(now: Date, daysAgo: number, hour: number, minute = 0): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute).toISOString();
}

/** Hash entero estable de un texto (para variaciones deterministas de confianza y puntuación). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PACK_FACTORS: Record<PackSize['unit'], { unit: BaseUnit; factor: number }> = {
  kg: { unit: 'kg', factor: 1 },
  g: { unit: 'kg', factor: 0.001 },
  l: { unit: 'l', factor: 1 },
  cl: { unit: 'l', factor: 0.01 },
  ml: { unit: 'l', factor: 0.001 },
  ud: { unit: 'ud', factor: 1 },
};

const BILLING_UNITS: Record<string, { unit: BaseUnit; factor: number }> = {
  kg: { unit: 'kg', factor: 1 },
  g: { unit: 'kg', factor: 0.001 },
  l: { unit: 'l', factor: 1 },
  ml: { unit: 'l', factor: 0.001 },
};

/** Unidad base y cantidad base por unidad de facturación. */
function basePerBillingUnit(unit: string, pack: PackSize | undefined): { unit: BaseUnit; qty: number } {
  const billing = BILLING_UNITS[unit];
  if (billing) return { unit: billing.unit, qty: billing.factor };
  if (pack) {
    const f = PACK_FACTORS[pack.unit];
    return { unit: f.unit, qty: pack.count * pack.size * f.factor };
  }
  return { unit: 'ud', qty: 1 };
}

export function buildDemoData({ now, makeId, searchKey }: BuildDemoOptions): DemoData {
  // ── Proveedores ──
  const supplierIds = new Map<SupplierKey, ID>();
  const suppliers: Supplier[] = DEMO_SUPPLIERS.map((s) => {
    const id = makeId();
    supplierIds.set(s.key, id);
    return { id, name: s.name, taxId: s.taxId, notes: s.notes, createdAt: localTimestamp(now, 100, 9) };
  });
  const supplierOf = (key: SupplierKey) => {
    const id = supplierIds.get(key);
    const s = DEMO_SUPPLIERS.find((x) => x.key === key);
    if (!id || !s) throw new Error(`Demo: proveedor desconocido ${key}`);
    return { id, spec: s };
  };

  // ── Productos (el precio se completa con las facturas) ──
  const productSpecs = new Map<string, DemoProduct>(DEMO_PRODUCTS.map((p) => [p.key, p]));
  const productIds = new Map<string, ID>(DEMO_PRODUCTS.map((p) => [p.key, makeId()]));
  const productId = (key: string): ID => {
    const id = productIds.get(key);
    if (!id) throw new Error(`Demo: producto desconocido ${key}`);
    return id;
  };

  // ── Facturas (ordenadas de la más antigua a la más reciente) ──
  const invoiceSpecs = [...DEMO_INVOICES].sort((a, b) => b.daysAgo - a.daysAgo);
  const invoices: Invoice[] = [];
  const pricePoints: PricePoint[] = [];
  const seenDescriptions = new Set<string>();
  const descriptionsByProduct = new Map<string, string[]>();
  const history = new Map<string, { date: string; daysAgo: number; price: number }[]>();

  for (const inv of invoiceSpecs) {
    const { id: supplierId, spec: supplier } = supplierOf(inv.supplier);
    const invoiceId = makeId();
    const date = localDate(now, inv.daysAgo);
    const lines: InvoiceLine[] = inv.lines.map(([pKey, description, code, quantity, unit, unitPrice, pack, discountPct]) => {
      const product = productSpecs.get(pKey);
      if (!product) throw new Error(`Demo: producto desconocido ${pKey}`);
      if (product.supplier !== inv.supplier) throw new Error(`Demo: ${pKey} no es de ${inv.supplier}`);
      const base = basePerBillingUnit(unit, pack);
      if (base.unit !== product.baseUnit) throw new Error(`Demo: unidad base incoherente en ${description}`);
      const total = round2(quantity * unitPrice * (1 - (discountPct ?? 0) / 100));
      const baseQuantity = round4(quantity * base.qty);
      const pricePerBase = round4(total / baseQuantity);
      const h = hash(`${inv.supplier}|${inv.daysAgo}|${description}`);
      // La primera vez que aparece una descripción se vinculó por similitud; después ya es un alias aprendido.
      const firstTime = !seenDescriptions.has(description);
      seenDescriptions.add(description);
      const matchScore = firstTime ? round2(0.84 + (h % 14) / 100) : 1;
      const spread = inv.method === 'ocr' ? 0.06 : 0.01;
      const confidence = round2(Math.min(1, Math.max(0.8, inv.confidence - spread / 2 + ((h >>> 8) % 100) / 100 * spread)));
      const lineId = makeId();

      const descs = descriptionsByProduct.get(pKey) ?? [];
      if (!descs.includes(description)) descs.push(description);
      descriptionsByProduct.set(pKey, descs);
      const hist = history.get(pKey) ?? [];
      hist.push({ date, daysAgo: inv.daysAgo, price: pricePerBase });
      history.set(pKey, hist);

      pricePoints.push({
        id: makeId(),
        productId: productId(pKey),
        date,
        pricePerBase,
        supplierId,
        invoiceId,
        source: 'factura',
        rawDescription: description,
      });

      const line: InvoiceLine = {
        id: lineId,
        description,
        code,
        quantity,
        unit,
        unitPrice,
        total,
        vatPct: product.vatPct,
        baseUnit: base.unit,
        baseQuantity,
        pricePerBase,
        suggestedName: product.name,
        suggestedCategory: product.category,
        productId: productId(pKey),
        matchScore,
        matchStatus: 'vinculado',
        confidence,
        warnings: [],
      };
      if (pack) line.packSize = { ...pack };
      if (discountPct) line.discountPct = discountPct;
      return line;
    });

    const subtotal = round2(lines.reduce((s, ln) => s + ln.total, 0));
    const byVat = new Map<number, number>();
    for (const ln of lines) byVat.set(ln.vatPct ?? 0, (byVat.get(ln.vatPct ?? 0) ?? 0) + ln.total);
    const vatTotal = round2([...byVat].reduce((s, [pct, base]) => s + round2((base * pct) / 100), 0));
    const hour = 8 + (hash(supplier.key + inv.daysAgo) % 5);
    invoices.push({
      id: invoiceId,
      supplierId,
      supplierName: supplier.name,
      supplierTaxId: supplier.taxId,
      number: inv.number(Number(date.slice(0, 4))),
      date,
      status: 'confirmada',
      method: inv.method,
      subtotal,
      vatTotal,
      total: round2(subtotal + vatTotal),
      lines,
      warnings: [],
      createdAt: localTimestamp(now, inv.daysAgo, hour, 12),
      confirmedAt: localTimestamp(now, inv.daysAgo, hour, 19),
    });
  }

  // ── Pruebas de rendimiento ──
  const yieldIds = new Map<string, ID>();
  const priceAt = (pKey: string, daysAgo: number): number => {
    const hist = history.get(pKey) ?? [];
    const before = hist.filter((h) => h.daysAgo >= daysAgo);
    const pick = before.length ? before[before.length - 1] : hist[0];
    if (!pick) throw new Error(`Demo: ${pKey} no tiene precio`);
    return pick.price;
  };
  const yieldTests: YieldTest[] = DEMO_YIELD_TESTS.map((t) => {
    const id = makeId();
    yieldIds.set(t.product, id);
    const ts = localTimestamp(now, t.daysAgo, 11, 30);
    return {
      id,
      name: t.name,
      productId: productId(t.product),
      date: localDate(now, t.daysAgo),
      grossWeightKg: t.grossWeightKg,
      purchasePricePerKg: priceAt(t.product, t.daysAgo),
      ...(t.thawLossPct != null ? { thawLossPct: t.thawLossPct } : {}),
      outputs: t.outputs.map((o) => ({ id: makeId(), ...o })),
      cookingLossPct: t.cookingLossPct,
      portionKg: t.portionKg,
      notes: t.notes,
      createdAt: ts,
      updatedAt: ts,
    };
  });

  // ── Productos con precio vigente = última factura ──
  const products: Product[] = DEMO_PRODUCTS.map((p) => {
    const hist = history.get(p.key);
    if (!hist?.length) throw new Error(`Demo: ${p.key} no aparece en ninguna factura`);
    const first = hist[0]!;
    const last = hist[hist.length - 1]!;
    const aliases = [...new Set([...(p.aliases ?? []), ...(descriptionsByProduct.get(p.key) ?? [])])];
    const product: Product = {
      id: productId(p.key),
      name: p.name,
      searchKey: searchKey(p.name),
      aliases,
      category: p.category,
      baseUnit: p.baseUnit,
      pricePerBase: last.price,
      priceSource: 'factura',
      lastPurchaseDate: last.date,
      supplierId: supplierOf(p.supplier).id,
      purchaseVatPct: p.vatPct,
      wastePct: p.wastePct,
      cookingLossPct: p.cookingLossPct,
      allergens: [...p.allergens],
      createdAt: localTimestamp(now, first.daysAgo, 10),
      updatedAt: localTimestamp(now, last.daysAgo, 10),
    };
    if (p.unitWeightKg != null) product.unitWeightKg = p.unitWeightKg;
    if (p.densityKgPerL != null) product.densityKgPerL = p.densityKgPerL;
    if (p.notes) product.notes = p.notes;
    const yt = yieldIds.get(p.key);
    if (yt) product.yieldTestId = yt;
    return product;
  });

  // ── Elaboraciones y platos ──
  const allDishes = [...DEMO_ELABORATIONS, ...DEMO_DISHES];
  const dishIds = new Map<string, ID>(allDishes.map((d) => [d.key, makeId()]));
  const resolveRef = (ref: DemoRef): RecipeItem['ref'] => {
    const key = ref.slice(2);
    if (ref.startsWith('p:')) return { type: 'product', id: productId(key) };
    const id = dishIds.get(key);
    if (!id) throw new Error(`Demo: elaboración desconocida ${key}`);
    return { type: 'dish', id };
  };
  const toDish = (d: DemoDish): Dish => {
    const draft = d.status === 'borrador';
    const items: RecipeItem[] = d.items.map((it) => {
      const item: RecipeItem = { id: makeId(), name: it.name, ref: resolveRef(it.ref), quantity: it.quantity, unit: it.unit, basis: it.basis };
      if (it.wastePct != null) item.wastePct = it.wastePct;
      if (it.cookingLossPct != null) item.cookingLossPct = it.cookingLossPct;
      if (it.note) item.note = it.note;
      if (draft) {
        item.suggested = true;
        item.matchScore = it.matchScore ?? 0.9;
      }
      return item;
    });
    const dish: Dish = {
      id: dishIds.get(d.key)!,
      name: d.name,
      kind: d.kind,
      section: d.section,
      saleVatPct: SALE_VAT_PCT,
      portions: d.portions,
      items,
      status: d.status,
      source: d.kind === 'elaboracion' ? 'manual' : 'carta-ocr',
      createdAt: localTimestamp(now, d.createdDaysAgo, 17),
      updatedAt: localTimestamp(now, draft ? d.createdDaysAgo : Math.min(d.createdDaysAgo, 4 + (hash(d.key) % 20)), 18),
    };
    if (d.description) dish.description = d.description;
    if (d.menuPrice != null) dish.menuPrice = d.menuPrice;
    if (d.yieldQty != null) dish.yieldQty = d.yieldQty;
    if (d.yieldUnit) dish.yieldUnit = d.yieldUnit;
    if (d.unitsSold != null) dish.unitsSold = d.unitsSold;
    if (d.tags?.length) dish.tags = [...d.tags];
    if (d.notes) dish.notes = d.notes;
    if (d.procedure) dish.procedure = d.procedure;
    return dish;
  };
  const dishes = allDishes.map(toDish);

  return { suppliers, products, pricePoints, invoices, dishes, yieldTests, business: { ...DEMO_BUSINESS } };
}
