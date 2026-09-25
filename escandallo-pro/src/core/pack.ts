import type { BaseUnit, InvoiceLine, PackSize } from '../types';
import { approxEqual } from './numbers';

/**
 * Formatos de envase y normalización de líneas de factura a precio por unidad base.
 */

type PackUnit = PackSize['unit'];

const SIZE_UNITS: Record<string, PackUnit> = {
  kg: 'kg', kgs: 'kg', kgr: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg', k: 'kg',
  g: 'g', gr: 'g', grs: 'g', grm: 'g', gramo: 'g', gramos: 'g',
  l: 'l', lt: 'l', lts: 'l', ltr: 'l', litro: 'l', litros: 'l',
  cl: 'cl', centilitro: 'cl', centilitros: 'cl',
  ml: 'ml', cc: 'ml', mililitro: 'ml', mililitros: 'ml',
};
const SIZE_ALT = Object.keys(SIZE_UNITS)
  .sort((a, b) => b.length - a.length)
  .join('|');
/** Palabras que cuentan unidades o envases individuales: "12 UDS", "24 LATAS", "6 BRIK". */
const COUNT_ALT =
  'uds?|u|un|unds?|und|unid|unidades|unidad|piezas?|pzs?|pzas?|botellas?|bot|botellines?|latas?|briks?|bricks?|bolsas?|tarrinas?|sobres?|bandejas?|estuches?|tarros?|botes?|frascos?|rollos?';
/** Envases que agrupan varias unidades: "PACK 24", "CAJA 12", "C/12". */
const GROUP_ALT = 'pack|pk|caja|cj|cja|paquete|paq|estuche|fardo|bandeja|bolsa|malla|blister|c\\s*/';

const NUM = '(\\d+(?:[.,]\\d+)?)';
const RE_MULTI = new RegExp(`(?<![\\d.,])(\\d+)\\s*(?:(?:${COUNT_ALT})\\s*)?[x*]\\s*${NUM}\\s*(${SIZE_ALT})(?![a-z])`);
const RE_MULTI_REV = new RegExp(`(?<![\\d.,])${NUM}\\s*(${SIZE_ALT})\\s*[x*]\\s*(\\d+)(?![\\d.,])(?!\\s*(?:${SIZE_ALT})(?![a-z]))`);
const RE_SIZE = new RegExp(`(?<![\\d.,/])${NUM}\\s*(${SIZE_ALT})(?![a-z])`, 'g');
const RE_FRACTION = new RegExp(`(?<![\\d/.,])([1-9])\\s*/\\s*([2-5])(?![\\d/])(?:\\s*(kg|kgs|kilos?|k|l|lt|ltr|litros?)(?![a-z]))?`);
const RE_COUNT = new RegExp(`(?<![\\d.,/])(\\d+)\\s*(?:${COUNT_ALT})(?![a-z])`);
const RE_GROUP_COUNT = new RegExp(`(?:^|[^a-z])(?:${GROUP_ALT})\\s*(?:de\\s*)?(\\d+)(?![\\d.,])(?!\\s*(?:[x*]|${SIZE_ALT})(?![a-z]))`);
const RE_TRAILING_X = /(?:^|\s)[x*]\s*(\d+)(?![\d.,])(?!\s*[a-z])/;
const RE_DOZEN = /(?:^|[^a-z])(?:(\d+)\s*|(media|medio)\s+)?(?:docenas?|dz|doc)(?![a-z])/;
const BEVERAGE =
  /(?:^|[^a-z])(?:cerveza|cerv|refresco|agua|vino|cava|tercio|quinto|botellin|cola|zumo|tonica|gaseosa|sidra|bebida|lager|pilsen|radler|mahou|damm|cruzcampo|alhambra|estrella|heineken|ambar|amstel|coronita)(?![a-z])/;

function normalizeDesc(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[×]/g, 'x')
    .replace(/\s+/g, ' ')} `;
}

/** Número de un formato: "1,5" → 1.5; "2.5" → 2.5; "1.500 g" → 1500; "2.500 kg" (implausible) → 2.5. */
function packNumber(raw: string, unit: PackUnit): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  const sep = raw.includes(',') ? ',' : '.';
  const [a, b] = raw.split(sep);
  const dec = Number(`${a}.${b}`);
  if (sep === '.' && b.length === 3) {
    const thousands = Number(a + b);
    // Miles sólo si es verosímil para la unidad (1.500 g sí; 2.500 kg no)
    return (unit === 'g' || unit === 'ml' || unit === 'cl') && thousands <= 50000 ? thousands : dec;
  }
  return dec;
}

/** Enmascara lo que no es formato: porcentajes, grados, precios, fechas, rangos y calibres ("8/10"). */
function maskNoise(s: string): string {
  return s
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' # ')
    .replace(/\d+(?:[.,]\d+)?\s*[º°ª]/g, ' # ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:€|eur\b|euros?\b)(?:\s*\/\s*[a-z]+)?/g, ' # ')
    .replace(/\d+(?:[.,]\d+)?\s*\/\s*(?:kg|kilo|l|lt|litro|ud|u|und|unid)(?![a-z])/g, ' # ')
    .replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, ' # ')
    .replace(new RegExp(`\\d+(?:[.,]\\d+)?\\s*-\\s*\\d+(?:[.,]\\d+)?\\s*(?:${SIZE_ALT})(?![a-z])`, 'g'), ' # ')
    .replace(/(\d+)\s*\/\s*(\d+)/g, (m, n: string, d: string) => (Number(n) < Number(d) && Number(d) <= 5 && n.length === 1 ? m : ' # '))
    .replace(/(?<![a-z])(?:cat|categoria|calibre|cal|t)\s*[.-]?\s*\d+(?![.,]?\d*\s*(?:kg|g|gr|l|cl|ml)(?![a-z]))/g, ' # ');
}

function countFrom(s: string): number | undefined {
  const c = RE_COUNT.exec(s);
  if (c) return Number(c[1]);
  const g = RE_GROUP_COUNT.exec(s);
  if (g) return Number(g[1]);
  return undefined;
}

function validCount(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n) && n >= 1 && n <= 10000;
}

/**
 * Detecta el formato de envase en una descripción de factura. Ejemplos:
 *  "ACEITE OLIVA V.E. GARRAFA 5L"      → { count: 1, size: 5, unit: 'l' }
 *  "LECHE ENTERA 6X1L" / "6 x 1 l"     → { count: 6, size: 1, unit: 'l' }
 *  "TOMATE PERA CAJA 6KG"              → { count: 1, size: 6, unit: 'kg' }
 *  "NATA 35% 1L BRIK 12UD" (12 x 1 l)  → { count: 12, size: 1, unit: 'l' }
 *  "BANDEJA 500GR" / "500 g"           → { count: 1, size: 500, unit: 'g' }
 *  "CERVEZA 1/3 PACK 24"               → { count: 24, size: 33.3, unit: 'cl' }
 *  "VINO TINTO 75CL"                   → { count: 1, size: 75, unit: 'cl' }
 *  "HUEVOS M 30 UDS" / "DOCENA HUEVOS" → { count: 30, size: 1, unit: 'ud' } / { count: 12, size: 1, unit: 'ud' }
 *  "LATA 2,5 KG"                       → { count: 1, size: 2.5, unit: 'kg' }
 * Devuelve undefined si no hay formato reconocible. No confundir porcentajes ("35%") ni calibres ("CAT.I", "T-3").
 */
export function parsePackSize(description: string): PackSize | undefined {
  if (!description) return undefined;
  const s = maskNoise(normalizeDesc(String(description)));

  // 1) Multipack explícito: "6X1L", "12 UDS X 200G", "PACK 6 X 1,5L", "1L X 6"
  const multi = RE_MULTI.exec(s);
  if (multi) {
    const unit = SIZE_UNITS[multi[3]];
    const count = Number(multi[1]);
    const size = packNumber(multi[2], unit);
    if (validCount(count) && size > 0) return { count, size, unit };
  }
  const rev = RE_MULTI_REV.exec(s);
  if (rev) {
    const unit = SIZE_UNITS[rev[2]];
    const size = packNumber(rev[1], unit);
    const count = Number(rev[3]);
    if (validCount(count) && size > 0) return { count, size, unit };
  }

  // 2) Tamaño suelto ("5L", "500 GR", "1/2 KG") + recuento aparte ("12UD", "PACK 24", "X 6")
  let size: { size: number; unit: PackUnit; index: number } | undefined;
  RE_SIZE.lastIndex = 0;
  const sm = RE_SIZE.exec(s);
  if (sm) {
    const unit = SIZE_UNITS[sm[2]];
    const v = packNumber(sm[1], unit);
    if (v > 0) size = { size: v, unit, index: sm.index };
  }
  const frac = RE_FRACTION.exec(s);
  if (frac && (!size || frac.index < size.index)) {
    const value = Number(frac[1]) / Number(frac[2]);
    const fu = frac[3];
    if (fu) {
      size = { size: Math.round(value * 1000) / 1000, unit: SIZE_UNITS[fu], index: frac.index };
    } else if (!size && (BEVERAGE.test(s) || frac[2] === '3' || frac[2] === '5')) {
      // Botellín/tercio de cerveza o refresco: 1/3 → 33,3 cl
      size = { size: Math.round(value * 1000) / 10, unit: 'cl', index: frac.index };
    }
  }
  if (!size) {
    // Formatos de cerveza por nombre: tercio (1/3 l) y quinto (1/5 l)
    const named = /(?:^|[^a-z])(tercio|quinto)s?(?![a-z])/.exec(s);
    if (named) size = { size: named[1] === 'tercio' ? 33.3 : 20, unit: 'cl', index: s.length };
  }
  if (size) {
    // El recuento no puede ser el propio número del tamaño
    const rest = s.slice(0, size.index) + ' ' + s.slice(size.index).replace(RE_SIZE, ' ').replace(RE_FRACTION, ' ');
    let count = countFrom(rest);
    if (!validCount(count)) {
      const tx = RE_TRAILING_X.exec(rest);
      count = tx ? Number(tx[1]) : undefined;
    }
    return { count: validCount(count) ? count : 1, size: size.size, unit: size.unit };
  }

  // 3) Sólo unidades: "30 UDS", "DOCENA", "2 DOCENAS", "MEDIA DOCENA", "PACK 6"
  const dz = RE_DOZEN.exec(s);
  if (dz) {
    const n = dz[1] ? Number(dz[1]) : dz[2] ? 0.5 : 1;
    const count = Math.round(12 * n);
    if (validCount(count)) return { count, size: 1, unit: 'ud' };
  }
  const count = countFrom(s);
  if (validCount(count)) return { count, size: 1, unit: 'ud' };
  return undefined;
}

/** Cantidad total en unidad base de un formato: 6x1L → { unit: 'l', qty: 6 }. */
export function packToBase(pack: PackSize): { unit: 'kg' | 'l' | 'ud'; qty: number } {
  const count = Number.isFinite(pack.count) && pack.count > 0 ? pack.count : 1;
  const size = Number.isFinite(pack.size) && pack.size > 0 ? pack.size : 0;
  const total = count * size;
  const clean = (v: number) => Math.round(v * 1e9) / 1e9;
  switch (pack.unit) {
    case 'kg':
      return { unit: 'kg', qty: clean(total) };
    case 'g':
      return { unit: 'kg', qty: clean(total / 1000) };
    case 'l':
      return { unit: 'l', qty: clean(total) };
    case 'cl':
      return { unit: 'l', qty: clean(total / 100) };
    case 'ml':
      return { unit: 'l', qty: clean(total / 1000) };
    default:
      return { unit: 'ud', qty: clean(total) };
  }
}

type LineInput = Pick<InvoiceLine, 'description' | 'quantity' | 'unit' | 'unitPrice' | 'total'> & Partial<Pick<InvoiceLine, 'discountPct' | 'packSize'>>;

type BilledKind = 'mass' | 'volume' | 'count' | 'dozen' | 'container' | 'group' | 'unknown';

const BILLED: Record<string, { kind: BilledKind; factor: number }> = (() => {
  const map: Record<string, { kind: BilledKind; factor: number }> = {};
  const add = (keys: string, kind: BilledKind, factor = 1) => {
    for (const k of keys.split(/\s+/)) map[k] = { kind, factor };
  };
  add('kg kgs kgr kilo kilos kilogramo kilogramos k', 'mass');
  add('g gr grs grm gramo gramos', 'mass', 0.001);
  add('l lt lts ltr litro litros', 'volume');
  add('dl', 'volume', 0.1);
  add('cl', 'volume', 0.01);
  add('ml cc', 'volume', 0.001);
  add('docena docenas dz doc', 'dozen', 12);
  add('ud uds u un und unds unid unidad unidades pieza piezas pz pza pzas', 'count');
  add('bot botella botellas botellin botellines lata latas brik briks brick bricks tarro tarros bote botes frasco frascos tarrina tarrinas sobre sobres barra barras', 'container');
  add('caja cajas cj cja cjs pack packs pk paquete paquetes paq pqt fardo fardos estuche estuches bandeja bandejas bdja band bolsa bolsas saco sacos malla mallas garrafa garrafas blister bidon bidones cubo cubos barqueta barquetas', 'group');
  return map;
})();

function billedUnit(raw: string | undefined): { kind: BilledKind; factor: number } {
  if (!raw) return { kind: 'unknown', factor: 1 };
  const k = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\s]/g, '');
  return BILLED[k] ?? { kind: 'unknown', factor: 1 };
}

/** Prefijos de los avisos que genera esta función (se sustituyen al volver a normalizar la línea). */
export const PACK_WARNING_PREFIXES = ['Cantidad × precio', 'Cantidad no válida', 'Cantidad negativa', 'No se puede calcular', 'Precio por '] as const;

export function isPackWarning(w: string): boolean {
  return PACK_WARNING_PREFIXES.some((p) => w.startsWith(p));
}

function eur(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} €`;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

const UNUSUAL_MAX: Record<BaseUnit, number> = { kg: 1500, l: 1500, ud: 1500 };
const UNUSUAL_MIN = 0.01;

/**
 * Calcula baseUnit, baseQuantity y pricePerBase (€/kg, €/l o €/ud, sin IVA, con descuento) de una línea.
 * Reglas:
 *  1. Importe efectivo = total si > 0; si no, quantity × unitPrice × (1 − descuento).
 *  2. Si la unidad facturada es de masa/volumen (kg, g, l, ml…) → base = kg/l, baseQuantity = cantidad convertida.
 *  3. Si es por unidad/caja/bot/paquete o desconocida y hay formato → baseQuantity = quantity × formato en base.
 *     (Si se factura por envase individual —bot, lata, brik…— y el formato es "24 x 33 cl", cuenta un solo envase.)
 *  4. Si no hay formato → base 'ud' (docena = 12 ud).
 *  pricePerBase = importe efectivo / baseQuantity.
 * Añade warnings en español si quantity × unitPrice × (1 − dto) no cuadra con total (tolerancia 2 cts o 1 %),
 * si la cantidad es ≤ 0, o si no se puede calcular el precio.
 */
export function normalizeInvoiceLine<T extends LineInput>(line: T): T & Pick<InvoiceLine, 'baseUnit' | 'baseQuantity' | 'pricePerBase' | 'warnings' | 'packSize'> {
  const previous = (line as { warnings?: string[] }).warnings ?? [];
  const warnings = previous.filter((w) => !isPackWarning(w));
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  const unitPrice = Number.isFinite(line.unitPrice) ? line.unitPrice : 0;
  const total = Number.isFinite(line.total) ? line.total : 0;
  const dto = Number.isFinite(line.discountPct) ? Math.min(100, Math.max(0, line.discountPct ?? 0)) : 0;
  const pack = line.packSize && line.packSize.size > 0 ? line.packSize : parsePackSize(line.description ?? '');
  const isReturn = qty < 0 && total < 0;

  if (qty === 0 || (qty < 0 && !isReturn)) warnings.push(`Cantidad no válida (${String(qty).replace('.', ',')}): revísala`);
  else if (isReturn) warnings.push('Cantidad negativa: línea de abono o devolución');

  // 1) Importe efectivo
  const computed = qty * unitPrice * (1 - dto / 100);
  const amount = total > 0 || isReturn ? total : computed;

  // 2–4) Unidad base y cantidad
  const billed = billedUnit(line.unit);
  let baseUnit: BaseUnit | undefined;
  let baseQuantity: number | undefined;
  if (billed.kind === 'mass' || billed.kind === 'volume') {
    baseUnit = billed.kind === 'mass' ? 'kg' : 'l';
    baseQuantity = qty * billed.factor;
  } else if (billed.kind === 'dozen') {
    baseUnit = 'ud';
    baseQuantity = qty * 12;
  } else if (pack) {
    const perPack = packToBase(pack);
    const single = billed.kind === 'container' && pack.count > 1 ? packToBase({ ...pack, count: 1 }) : perPack;
    baseUnit = single.unit;
    baseQuantity = qty * single.qty;
  } else {
    baseUnit = 'ud';
    baseQuantity = qty;
  }

  // Validación cruzada cantidad × precio = importe (acepta también precio por unidad base o dto ya aplicado)
  if (total !== 0 && unitPrice > 0 && qty !== 0) {
    const plain = qty * unitPrice;
    const perBase = baseQuantity ? baseQuantity * unitPrice * (1 - dto / 100) : NaN;
    const ok = approxEqual(computed, total) || approxEqual(plain, total) || (Number.isFinite(perBase) && approxEqual(perBase, total));
    if (!ok) warnings.push(`Cantidad × precio (${eur(computed)}) no cuadra con el importe (${eur(total)})`);
  }

  let pricePerBase: number | undefined;
  if (baseQuantity && Number.isFinite(baseQuantity) && baseQuantity !== 0 && amount !== 0 && Number.isFinite(amount)) {
    const p = amount / baseQuantity;
    if (p > 0) pricePerBase = round6(p);
  }
  if (pricePerBase === undefined) {
    warnings.push('No se puede calcular el precio por unidad base: revisa cantidad, precio e importe');
    return { ...line, packSize: pack, baseUnit, baseQuantity: baseQuantity ? round6(baseQuantity) : baseQuantity, pricePerBase, warnings };
  }
  if (baseUnit && (pricePerBase > UNUSUAL_MAX[baseUnit] || pricePerBase < UNUSUAL_MIN)) {
    warnings.push(`Precio por ${baseUnit} inusual (${pricePerBase.toFixed(4).replace('.', ',')} €/${baseUnit}): revisa la unidad o el formato`);
  }
  return { ...line, packSize: pack, baseUnit, baseQuantity: round6(baseQuantity), pricePerBase, warnings };
}
