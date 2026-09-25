/**
 * Lógica pura del área de compras (facturas y base de precios de ingredientes).
 * Sin DOM ni base de datos: todo lo que aquí se calcula está cubierto por tests (logic.test.ts).
 */
import type { BaseUnit, Dish, DishCost, ID, IngredientCategory, Invoice, InvoiceLine, PackSize, PricePoint, Product } from '../../types';
import type { Cell, ColumnMapping } from '../../extract/spreadsheet';
import { approxEqual, round } from '../../core/numbers';
import { fmtNum } from '../../lib/format';

// ───────────────────────────── Texto ─────────────────────────────

/** Minúsculas, sin tildes ni signos y espacios colapsados (para búsquedas instantáneas en listas). */
export function foldText(s: string | undefined | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

/** true si todos los términos de la búsqueda aparecen en alguno de los textos. */
export function matchesQuery(query: string, ...texts: (string | undefined | null)[]): boolean {
  const terms = foldText(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const hay = texts.map(foldText).join(' ');
  return terms.every((t) => hay.includes(t));
}

/**
 * Interpreta un importe tecleado: "12,5" → 12,5 · "1.234,56" → 1234,56 · "1.234" → 1234 (miles) ·
 * "0.125" o "1.5" → decimal. undefined si está vacío; NaN si no es un número.
 */
export function parseAmount(raw: string): number | undefined {
  let s = raw.replace(/[\s€]/g, '');
  if (s === '' || s === '-') return undefined;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

// ───────────────────────────── Formatos de envase ─────────────────────────────

const PACK_UNIT_LABEL: Record<PackSize['unit'], string> = { kg: 'kg', g: 'g', l: 'l', cl: 'cl', ml: 'ml', ud: 'ud' };

/** Formato legible: { 6, 1, 'l' } → "6 × 1 l"; { 1, 5, 'kg' } → "5 kg"; { 30, 1, 'ud' } → "30 ud". */
export function formatPack(pack: PackSize | undefined | null): string {
  if (!pack || !(pack.size > 0)) return '';
  const count = pack.count > 0 ? pack.count : 1;
  const size = fmtNum(pack.size, 3);
  const unit = PACK_UNIT_LABEL[pack.unit] ?? pack.unit;
  if (pack.unit === 'ud') {
    const total = count * pack.size;
    return count > 1 && pack.size !== 1 ? `${fmtNum(count, 0)} × ${size} ud` : `${fmtNum(total, 3)} ud`;
  }
  return count > 1 ? `${fmtNum(count, 0)} × ${size} ${unit}` : `${size} ${unit}`;
}

// ───────────────────────────── Facturas ─────────────────────────────

/** Importe de una línea a partir de cantidad × precio × (1 − dto), redondeado a céntimos. */
export function lineAmount(l: Pick<InvoiceLine, 'quantity' | 'unitPrice' | 'discountPct'>): number {
  const q = Number.isFinite(l.quantity) ? l.quantity : 0;
  const p = Number.isFinite(l.unitPrice) ? l.unitPrice : 0;
  const d = l.discountPct && Number.isFinite(l.discountPct) ? l.discountPct : 0;
  return round(q * p * (1 - d / 100), 2);
}

/**
 * Aplica un cambio de la revisión a una línea manteniendo la coherencia cantidad × precio = importe:
 *  - si cambian cantidad, precio o descuento (y no el importe) y hay precio, se recalcula el importe;
 *  - si sólo hay importe (sin precio) y cambia la cantidad, se deduce el precio unitario.
 * La normalización a €/ud base la hace después core/pack.normalizeInvoiceLine.
 */
export function applyLinePatch(line: InvoiceLine, patch: Partial<InvoiceLine>): InvoiceLine {
  const next: InvoiceLine = { ...line, ...patch };
  const touchesMath = 'quantity' in patch || 'unitPrice' in patch || 'discountPct' in patch;
  if (touchesMath && !('total' in patch)) {
    if (next.unitPrice > 0) {
      next.total = lineAmount(next);
    } else if (next.total > 0 && next.quantity > 0 && 'quantity' in patch) {
      const d = next.discountPct ?? 0;
      next.unitPrice = round(next.total / next.quantity / (1 - Math.min(99.9, d) / 100), 4);
    }
  }
  return next;
}

/** Base imponible de una factura: la declarada o, si falta, la suma de sus líneas. */
export function invoiceNetAmount(inv: Pick<Invoice, 'subtotal' | 'lines'>): number {
  if (inv.subtotal != null && inv.subtotal > 0) return inv.subtotal;
  return round(
    inv.lines.reduce((s, l) => s + (Number.isFinite(l.total) ? l.total : 0), 0),
    2,
  );
}

export interface TotalsCheck {
  /** Suma de importes de todas las líneas (incluidas las ignoradas: portes, envases… también están en la factura). */
  linesSum: number;
  subtotal?: number;
  /** linesSum − base imponible. */
  diff?: number;
  status: 'ok' | 'warn' | 'none';
  /** Coherencia base + IVA = total (si hay datos). */
  vat?: { expected: number; total: number; diff: number; ok: boolean };
}

/** Compara la suma de líneas con la base imponible (tolerancia 5 cts o 0,5 %) y base + IVA con el total. */
export function totalsCheck(lines: Pick<InvoiceLine, 'total'>[], subtotal?: number, vatTotal?: number, total?: number): TotalsCheck {
  const linesSum = round(
    lines.reduce((s, l) => s + (Number.isFinite(l.total) ? l.total : 0), 0),
    2,
  );
  const out: TotalsCheck = { linesSum, status: 'none' };
  if (subtotal != null && subtotal > 0) {
    out.subtotal = subtotal;
    out.diff = round(linesSum - subtotal, 2);
    out.status = approxEqual(linesSum, subtotal, 0.05, 0.005) ? 'ok' : 'warn';
  }
  if (subtotal != null && subtotal > 0 && vatTotal != null && total != null && total > 0) {
    const expected = round(subtotal + vatTotal, 2);
    out.vat = { expected, total, diff: round(total - expected, 2), ok: approxEqual(expected, total, 0.05, 0.005) };
  }
  return out;
}

export interface LineSummary {
  total: number;
  linked: number;
  suggested: number;
  created: number;
  ignored: number;
  withWarnings: number;
  /** Líneas que se convertirán en precio al confirmar (no ignoradas y con €/ud base > 0). */
  priced: number;
}

export function summarizeLines(lines: InvoiceLine[]): LineSummary {
  const s: LineSummary = { total: lines.length, linked: 0, suggested: 0, created: 0, ignored: 0, withWarnings: 0, priced: 0 };
  for (const l of lines) {
    if (l.matchStatus === 'vinculado') s.linked++;
    else if (l.matchStatus === 'sugerido') s.suggested++;
    else if (l.matchStatus === 'nuevo') s.created++;
    else s.ignored++;
    if (l.warnings?.length) s.withWarnings++;
    if (l.matchStatus !== 'ignorado' && (l.pricePerBase ?? 0) > 0) s.priced++;
  }
  return s;
}

export type InvoiceFilter = 'todas' | 'revisar' | 'confirmadas' | 'error';

/** Filtro de la lista de facturas: estado + búsqueda por proveedor, nº, archivo o CIF. */
export function filterInvoices(invoices: Invoice[], filter: InvoiceFilter, query: string): Invoice[] {
  return invoices.filter((inv) => {
    if (filter === 'revisar' && !(inv.status === 'revision' || inv.status === 'pendiente' || inv.status === 'procesando')) return false;
    if (filter === 'confirmadas' && inv.status !== 'confirmada') return false;
    if (filter === 'error' && inv.status !== 'error') return false;
    return matchesQuery(query, inv.supplierName, inv.number, inv.fileName, inv.supplierTaxId);
  });
}

export interface InvoiceStats {
  /** Facturas con fecha en el mes en curso. */
  monthCount: number;
  /** Gasto sin IVA del mes (facturas confirmadas y por revisar). */
  monthSpend: number;
  /** Parte del gasto del mes que aún está por revisar. */
  monthPendingSpend: number;
  /** Gasto sin IVA del mes anterior (mismas reglas) para comparar. */
  prevMonthSpend: number;
  toReview: number;
  inProgress: number;
  errors: number;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** KPIs de la cabecera de facturas. `today` en formato YYYY-MM-DD. */
export function invoiceStats(invoices: Invoice[], today: string): InvoiceStats {
  const month = today.slice(0, 7);
  const prev = shiftMonth(month, -1);
  const s: InvoiceStats = { monthCount: 0, monthSpend: 0, monthPendingSpend: 0, prevMonthSpend: 0, toReview: 0, inProgress: 0, errors: 0 };
  for (const inv of invoices) {
    if (inv.status === 'revision') s.toReview++;
    else if (inv.status === 'pendiente' || inv.status === 'procesando') s.inProgress++;
    else if (inv.status === 'error') s.errors++;
    const ym = (inv.date ?? '').slice(0, 7);
    const counts = inv.status === 'confirmada' || inv.status === 'revision';
    if (ym === month) {
      s.monthCount++;
      if (counts) {
        const amount = invoiceNetAmount(inv);
        s.monthSpend += amount;
        if (inv.status === 'revision') s.monthPendingSpend += amount;
      }
    } else if (ym === prev && counts) {
      s.prevMonthSpend += invoiceNetAmount(inv);
    }
  }
  s.monthSpend = round(s.monthSpend, 2);
  s.monthPendingSpend = round(s.monthPendingSpend, 2);
  s.prevMonthSpend = round(s.prevMonthSpend, 2);
  return s;
}

// ───────────────────────────── Precios ─────────────────────────────

/** Variación porcentual (positivo = subida). undefined si no hay precio de partida. */
export function pctChange(before: number | undefined, after: number | undefined): number | undefined {
  if (before == null || after == null || !(before > 0) || !Number.isFinite(after)) return undefined;
  return ((after - before) / before) * 100;
}

export interface PriceTrend {
  current: number;
  currentDate: string;
  /** Último precio anterior DISTINTO del actual. */
  previous?: number;
  previousDate?: string;
  changePct?: number;
  points: number;
}

/** Ordena puntos de precio por fecha y, a igualdad, por id (los ids son ordenables por tiempo). */
export function sortPricePoints(points: PricePoint[]): PricePoint[] {
  return [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Tendencia de precio por producto: último precio frente al anterior distinto (igual criterio que las alertas). */
export function priceTrends(points: PricePoint[]): Map<ID, PriceTrend> {
  const byProduct = new Map<ID, PricePoint[]>();
  for (const p of points) {
    if (!(p.pricePerBase > 0)) continue;
    const arr = byProduct.get(p.productId);
    if (arr) arr.push(p);
    else byProduct.set(p.productId, [p]);
  }
  const out = new Map<ID, PriceTrend>();
  for (const [id, arr] of byProduct) {
    const sorted = sortPricePoints(arr);
    const last = sorted[sorted.length - 1];
    const trend: PriceTrend = { current: last.pricePerBase, currentDate: last.date, points: sorted.length };
    for (let i = sorted.length - 2; i >= 0; i--) {
      const p = sorted[i];
      if (Math.abs(p.pricePerBase - last.pricePerBase) > Math.max(0.00005, last.pricePerBase * 0.001)) {
        trend.previous = p.pricePerBase;
        trend.previousDate = p.date;
        trend.changePct = pctChange(p.pricePerBase, last.pricePerBase);
        break;
      }
    }
    out.set(id, trend);
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a.slice(0, 10)}T12:00:00`).getTime();
  const dbt = new Date(`${b.slice(0, 10)}T12:00:00`).getTime();
  return Math.round((dbt - da) / 86_400_000);
}

export interface PriceSnapshot {
  id: ID;
  name: string;
  price: number;
  baseUnit: BaseUnit;
}

export interface PriceChangeRow {
  productId: ID;
  name: string;
  baseUnit: BaseUnit;
  before?: number;
  after: number;
  changePct?: number;
  isNew: boolean;
}

/**
 * Cambios de precio tras confirmar una factura: compara la foto previa con los productos actuales.
 * Primero las mayores subidas; los productos nuevos al final.
 */
export function diffPrices(before: Map<ID, PriceSnapshot>, after: Product[]): PriceChangeRow[] {
  const rows: PriceChangeRow[] = after.map((p) => {
    const prev = before.get(p.id);
    return {
      productId: p.id,
      name: p.name,
      baseUnit: p.baseUnit,
      before: prev?.price,
      after: p.pricePerBase,
      changePct: prev ? pctChange(prev.price, p.pricePerBase) : undefined,
      isNew: !prev,
    };
  });
  return rows.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
    const ca = a.changePct ?? 0;
    const cb = b.changePct ?? 0;
    if (Math.abs(cb) !== Math.abs(ca)) return Math.abs(cb) - Math.abs(ca);
    return a.name.localeCompare(b.name, 'es');
  });
}

/** Un cambio de precio es significativo si supera 0,1 % (evita ruido de redondeo). */
export function isMeaningfulChange(pct: number | undefined): boolean {
  return pct != null && Math.abs(pct) >= 0.1;
}

// ───────────────────────────── Productos ─────────────────────────────

export type ProductSort = 'nombre' | 'precio' | 'compra' | 'variacion';

export interface ProductFilters {
  query: string;
  category: IngredientCategory | 'todas';
  noPrice: boolean;
  withYield: boolean;
  rising: boolean;
  sort: ProductSort;
}

export const DEFAULT_PRODUCT_FILTERS: ProductFilters = {
  query: '',
  category: 'todas',
  noPrice: false,
  withYield: false,
  rising: false,
  sort: 'nombre',
};

export function filterProducts(products: Product[], f: ProductFilters, trends: Map<ID, PriceTrend>): Product[] {
  const list = products.filter((p) => {
    if (f.category !== 'todas' && p.category !== f.category) return false;
    if (f.noPrice && p.pricePerBase > 0) return false;
    if (f.withYield && !p.yieldTestId) return false;
    if (f.rising && !((trends.get(p.id)?.changePct ?? 0) > 0)) return false;
    return matchesQuery(f.query, p.name, ...(p.aliases ?? []));
  });
  const byName = (a: Product, b: Product) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  const cmp: Record<ProductSort, (a: Product, b: Product) => number> = {
    nombre: byName,
    precio: (a, b) => {
      const pa = a.pricePerBase > 0 ? a.pricePerBase : -1;
      const pb = b.pricePerBase > 0 ? b.pricePerBase : -1;
      return pb - pa || byName(a, b);
    },
    compra: (a, b) => (b.lastPurchaseDate ?? '').localeCompare(a.lastPurchaseDate ?? '') || byName(a, b),
    variacion: (a, b) => {
      const ca = trends.get(a.id)?.changePct;
      const cb = trends.get(b.id)?.changePct;
      if (ca == null && cb == null) return byName(a, b);
      if (ca == null) return 1;
      if (cb == null) return -1;
      return cb - ca || byName(a, b);
    },
  };
  return list.sort(cmp[f.sort]);
}

export interface ProductStats {
  total: number;
  withPrice: number;
  withoutPrice: number;
  /** Productos cuya última compra (≤ 90 días) subió al menos el umbral de alerta. */
  recentRises: number;
}

export function productStats(products: Product[], trends: Map<ID, PriceTrend>, alertPct: number, today: string): ProductStats {
  let withPrice = 0;
  let recentRises = 0;
  for (const p of products) {
    if (p.pricePerBase > 0) withPrice++;
    const t = trends.get(p.id);
    if (t?.changePct != null && t.changePct >= alertPct && daysBetween(t.currentDate, today) <= 90) recentRises++;
  }
  return { total: products.length, withPrice, withoutPrice: products.length - withPrice, recentRises };
}

export interface ProductUsage {
  dish: Dish;
  /** Coste del producto por ración del plato (€). */
  costPerPortion: number;
  /** % del coste del plato que supone el producto. */
  sharePct: number;
  foodCostPct?: number;
  /** Si se usa a través de una elaboración, su nombre. */
  via?: string;
}

/**
 * Platos y elaboraciones que usan un producto: directamente (con su peso en el coste) o a través
 * de elaboraciones (sub-recetas), recorridas en profundidad sin ciclos.
 */
export function productUsage(productId: ID, dishes: Dish[], costs: Map<ID, DishCost> | undefined): ProductUsage[] {
  const out: ProductUsage[] = [];
  const direct = new Set<ID>();
  for (const dish of dishes) {
    const items = dish.items.filter((i) => i.ref?.type === 'product' && i.ref.id === productId);
    if (!items.length) continue;
    direct.add(dish.id);
    const dc = costs?.get(dish.id);
    let cost = 0;
    let share = 0;
    for (const it of items) {
      const ic = dc?.items.find((c) => c.itemId === it.id);
      if (ic) {
        cost += ic.cost;
        share += ic.costSharePct;
      }
    }
    const portions = dish.portions > 0 ? dish.portions : 1;
    out.push({ dish, costPerPortion: cost / portions, sharePct: share, foodCostPct: dc?.foodCostPct });
  }
  // Uso indirecto: platos que llevan una elaboración que contiene el producto.
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const containing = new Map<ID, string>();
  for (const id of direct) {
    const d = byId.get(id);
    if (d?.kind === 'elaboracion') containing.set(id, d.name);
  }
  const queue = [...containing.keys()];
  const seen = new Set<ID>(queue);
  while (queue.length) {
    const subId = queue.shift() as ID;
    const viaName = containing.get(subId) ?? '';
    for (const dish of dishes) {
      if (direct.has(dish.id) || seen.has(dish.id)) continue;
      if (!dish.items.some((i) => i.ref?.type === 'dish' && i.ref.id === subId)) continue;
      seen.add(dish.id);
      out.push({ dish, costPerPortion: 0, sharePct: 0, foodCostPct: costs?.get(dish.id)?.foodCostPct, via: viaName });
      if (dish.kind === 'elaboracion') {
        containing.set(dish.id, viaName);
        queue.push(dish.id);
      }
    }
  }
  return out.sort((a, b) => {
    if (!!a.via !== !!b.via) return a.via ? 1 : -1;
    return b.sharePct - a.sharePct || a.dish.name.localeCompare(b.dish.name, 'es');
  });
}

// ───────────────────────────── Gráficos ─────────────────────────────

/**
 * Marcas "redondas" para un eje (pasos 1 / 2 / 2,5 / 5 × 10ⁿ) que cubren [min, max].
 * Devuelve las marcas y los decimales necesarios para mostrarlas.
 */
export function niceTicks(min: number, max: number, count = 4): { ticks: number[]; decimals: number } {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ticks: [0, 1], decimals: 0 };
  if (hi - lo < 1e-9) {
    const d = Math.abs(hi) * 0.1 || 1;
    lo -= d;
    hi += d;
  }
  const raw = (hi - lo) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  let start = Math.floor(lo / step + 1e-9) * step;
  if (start < 0 && min >= 0) start = 0;
  const end = Math.ceil(hi / step - 1e-9) * step;
  let decimals = 0;
  while (decimals < 6 && Math.abs(Math.round(step * 10 ** decimals) - step * 10 ** decimals) > 1e-6) decimals++;
  const ticks: number[] = [];
  for (let v = start, i = 0; v <= end + step * 1e-6 && i < 50; v += step, i++) ticks.push(round(v, decimals + 2));
  return { ticks, decimals };
}

// ───────────────────────────── Importar tarifas (Excel / CSV) ─────────────────────────────

export interface PriceRow {
  /** Índice de la fila en la hoja (0-based). */
  rowIndex: number;
  description: string;
  code?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  discountPct?: number;
  supplier?: string;
}

function cellText(c: Cell | undefined): string {
  if (c == null) return '';
  return typeof c === 'number' ? String(c) : String(c).trim();
}

/** Convierte las filas de una tarifa en filas de precio (descarta vacías, totales y filas sin importe). */
export function parsePriceRows(
  rows: Cell[][],
  mapping: ColumnMapping,
  headerRow: number,
  parseNum: (raw: string | number | null | undefined) => number | undefined,
): PriceRow[] {
  const num = (c: Cell | undefined): number | undefined => (c == null || c === '' ? undefined : typeof c === 'number' ? c : parseNum(c));
  const out: PriceRow[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const description = cellText(r[mapping.description]).replace(/\s+/g, ' ');
    if (!description || !/[a-záéíóúñ]/i.test(description)) continue;
    if (/^(total|subtotal|suma|base imponible|iva)\b/i.test(description)) continue;
    const quantityRaw = mapping.quantity != null ? num(r[mapping.quantity]) : undefined;
    const unitPriceRaw = mapping.unitPrice != null ? num(r[mapping.unitPrice]) : undefined;
    const totalRaw = mapping.total != null ? num(r[mapping.total]) : undefined;
    const discount = mapping.discount != null ? num(r[mapping.discount]) : undefined;
    const quantity = quantityRaw != null && quantityRaw > 0 ? quantityRaw : 1;
    let unitPrice = unitPriceRaw != null && unitPriceRaw > 0 ? unitPriceRaw : 0;
    const total = totalRaw != null && totalRaw > 0 ? totalRaw : 0;
    if (!unitPrice && total) unitPrice = round(total / quantity, 4);
    if (!(unitPrice > 0) && !(total > 0)) continue;
    out.push({
      rowIndex: i,
      description,
      code: mapping.code != null ? cellText(r[mapping.code]) || undefined : undefined,
      unit: mapping.unit != null ? cellText(r[mapping.unit]) || 'ud' : 'ud',
      quantity,
      unitPrice,
      total,
      discountPct: discount != null && discount > 0 && discount < 100 ? discount : undefined,
      supplier: mapping.supplier != null ? cellText(r[mapping.supplier]) || undefined : undefined,
    });
  }
  return out;
}

/** Etiquetas de los campos mapeables de una hoja (orden de presentación en la UI). */
export const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean; hint?: string }[] = [
  { key: 'description', label: 'Producto / descripción', required: true },
  { key: 'unitPrice', label: 'Precio unitario', hint: 'Precio por unidad de venta, sin IVA' },
  { key: 'unit', label: 'Unidad', hint: 'kg, l, ud, caja…' },
  { key: 'quantity', label: 'Cantidad', hint: 'Si falta, se asume 1' },
  { key: 'total', label: 'Importe', hint: 'Se usa si no hay precio unitario' },
  { key: 'discount', label: 'Descuento %' },
  { key: 'code', label: 'Código' },
  { key: 'supplier', label: 'Proveedor' },
];

/** Etiqueta de columna tipo Excel: 0 → A, 26 → AA. */
export function columnLetter(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
