import type { Allergen, DishProposal, ExtractedInvoice, ExtractedMenu, IngredientCategory, PackSize, ProposedIngredient, QtyBasis, QtyUnit } from '../types';
import { normalizeInvoiceLine } from '../core/pack';
import { approxEqual, round } from '../core/numbers';
import { fmtEur, fmtEurPrecise, fmtNum } from '../lib/format';
import type { ParsedInvoice, ParsedMenu, ParsedRecipeIngredient, ParsedRecipes } from './schemas';

/**
 * Normalización de las respuestas de Claude al modelo de dominio, con validación cruzada de importes.
 * Todo es puro (sin red ni BD) y está cubierto por tests.
 */

type ExtractedLine = ExtractedInvoice['lines'][number];

// ───────────────────────────── Texto ─────────────────────────────

/** Espacios colapsados y sin adornos al principio/final (guiones, asteriscos, puntos suspensivos de relleno). */
export function cleanText(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/[\s ]+/g, ' ')
    .replace(/^[\s\-–—·•*_.,;:|]+/, '')
    .replace(/[\s\-–—·•*_,;:|]+$/, '')
    .replace(/\.{3,}$/, '')
    .trim();
}

/** Clave para comparar nombres: minúsculas, sin tildes ni signos. */
export function compareKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

/** true si el texto está «gritado» (todo en mayúsculas). */
export function isShouting(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ÿñÑ]/g, '');
  return letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

const KEEP_UPPER = new Set(['DO', 'DOP', 'DOCa', 'IGP', 'BBQ', 'XL', 'XXL', 'IPA', 'AOVE', 'XO', 'KM0', 'VIP', 'II', 'III', 'IV']);

/** «PULPO A LA GALLEGA» → «Pulpo a la gallega» (conserva siglas como DO o IGP). */
export function toSentenceCase(s: string): string {
  const words = s.split(' ').map((w) => (KEEP_UPPER.has(w.replace(/[^A-Za-z0-9]/g, '')) ? w : w.toLowerCase()));
  const joined = words.join(' ');
  return capitalize(joined);
}

export function capitalize(s: string): string {
  const i = s.search(/[A-Za-zÀ-ÿñÑ]/);
  if (i < 0) return s;
  return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of list) {
    const t = cleanText(w);
    const k = compareKey(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Copia sin las propiedades undefined (objetos más limpios para guardar en la BD). */
function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function clampConfidence(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  const x = v > 1 && v <= 100 ? v / 100 : v;
  return round(Math.max(0, Math.min(1, x)), 2);
}

// ───────────────────────────── Cabecera de factura ─────────────────────────────

/** Fecha española o ISO → AAAA-MM-DD (valida el calendario). */
export function normalizeDate(raw: string): string | undefined {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (match) {
    y = +match[1];
    m = +match[2];
    d = +match[3];
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(s);
    if (!match) return undefined;
    d = +match[1];
    m = +match[2];
    y = +match[3];
    if (y < 100) y += 2000;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** CIF/NIF sin espacios ni guiones, en mayúsculas y sin prefijo «ES» de NIF-IVA. */
export function normalizeTaxId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.toUpperCase().replace(/^(CIF|NIF|N\.?I\.?F\.?|C\.?I\.?F\.?)[:.\s]*/, '').replace(/[\s.\-_/]/g, '');
  if (/^ES[A-Z0-9]\d{7}[A-Z0-9]$/.test(s)) s = s.slice(2);
  return s || undefined;
}

const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** ¿Tiene forma de identificador fiscal español (NIF, NIE o CIF)? */
export function looksSpanishTaxId(id: string): boolean {
  return /^(\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])$/.test(id);
}

/** Comprueba el dígito/letra de control de un NIF, NIE o CIF español. */
export function isValidSpanishTaxId(id: string): boolean {
  if (/^\d{8}[A-Z]$/.test(id)) return NIF_LETTERS[+id.slice(0, 8) % 23] === id[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const num = +(String('XYZ'.indexOf(id[0])) + id.slice(1, 8));
    return NIF_LETTERS[num % 23] === id[8];
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {
    const digits = id.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const n = +digits[i];
      if (i % 2 === 0) {
        const dbl = n * 2;
        sum += Math.floor(dbl / 10) + (dbl % 10);
      } else sum += n;
    }
    const control = (10 - (sum % 10)) % 10;
    const letter = 'JABCDEFGHI'[control];
    const last = id[8];
    if ('PQRSNW'.includes(id[0])) return last === letter;
    if ('ABEH'.includes(id[0])) return last === String(control);
    return last === String(control) || last === letter;
  }
  return false;
}

// ───────────────────────────── Líneas de factura ─────────────────────────────

const BILLED_UNIT_ALIASES: Record<string, string> = {
  kg: 'kg', kgs: 'kg', kgr: 'kg', kilo: 'kg', kilos: 'kg', k: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  g: 'g', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g',
  l: 'l', lt: 'l', lts: 'l', ltr: 'l', litro: 'l', litros: 'l',
  ml: 'ml', cl: 'cl',
  ud: 'ud', uds: 'ud', u: 'ud', un: 'ud', und: 'ud', unds: 'ud', unid: 'ud', unidad: 'ud', unidades: 'ud', pz: 'ud', pza: 'ud', pieza: 'ud', piezas: 'ud',
  caja: 'caja', cajas: 'caja', cj: 'caja', cja: 'caja', caj: 'caja', cx: 'caja',
  bot: 'bot', botella: 'bot', botellas: 'bot', bt: 'bot', btl: 'bot',
  paq: 'paq', paquete: 'paq', paquetes: 'paq', pq: 'paq', pack: 'pack', packs: 'pack',
  bandeja: 'bandeja', bandejas: 'bandeja', bdj: 'bandeja', band: 'bandeja',
  saco: 'saco', sacos: 'saco', garrafa: 'garrafa', garrafas: 'garrafa', lata: 'lata', latas: 'lata', bolsa: 'bolsa', bolsas: 'bolsa',
  docena: 'docena', docenas: 'docena', dz: 'docena', doc: 'docena', manojo: 'manojo', manojos: 'manojo',
  barril: 'barril', barriles: 'barril', brik: 'brik', briks: 'brik', bric: 'brik', tarro: 'tarro', tarros: 'tarro', bote: 'bote', botes: 'bote',
};

/** Unidad de facturación normalizada («KGS» → kg, «UDS» → ud, «CJ» → caja…); desconocida → minúsculas. */
export function normalizeBilledUnit(raw: string): string {
  const key = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.\s]/g, '');
  if (!key) return 'ud';
  return BILLED_UNIT_ALIASES[key] ?? key;
}

const MASS_OR_VOLUME = new Set(['kg', 'g', 'l', 'ml', 'cl']);

interface WorkLine {
  description: string;
  code?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPct: number;
  total: number;
  vatPct?: number;
  packSize?: PackSize;
  suggestedName?: string;
  suggestedCategory?: IngredientCategory;
  confidence: number;
  notes: string[];
}

const factor = (l: Pick<WorkLine, 'discountPct'>) => 1 - l.discountPct / 100;
const computed = (l: WorkLine) => round(l.quantity * l.unitPrice * factor(l), 2);
const lineMatches = (l: WorkLine) => approxEqual(l.quantity * l.unitPrice * factor(l), l.total, 0.02, 0.01);
const isNearInt = (v: number) => Math.abs(v - Math.round(v)) <= Math.max(0.005, Math.abs(v) * 0.002);

function toWorkLine(l: ParsedInvoice['lines'][number]): WorkLine | undefined {
  const description = cleanText(l.description) || cleanText(l.suggestedName);
  let q = l.quantity;
  let p = l.unitPrice;
  let t = l.total;
  if (!description || (q === undefined && p === undefined && t === undefined)) return undefined;
  const notes: string[] = [];
  let confidence = clampConfidence(l.confidence, 0.85);
  let d = l.discountPct !== undefined && Number.isFinite(l.discountPct) ? Math.max(0, Math.min(100, l.discountPct)) : 0;
  // Descuento dado como fracción (0,1 = 10 %)
  if (d > 0 && d < 1 && q !== undefined && p !== undefined && t !== undefined && approxEqual(q * p * (1 - d), t) && !approxEqual(q * p * (1 - d / 100), t)) {
    d = round(d * 100, 2);
  }
  const f = 1 - d / 100;
  if (q !== undefined && q !== 0 && p !== undefined && t === undefined) {
    t = round(q * p * f, 2);
    notes.push('Importe calculado como cantidad × precio');
    confidence = Math.min(confidence, 0.8);
  } else if (q !== undefined && q !== 0 && t !== undefined && (p === undefined || (p === 0 && t !== 0)) && f > 0) {
    p = round(t / (q * f), 4);
    notes.push('Precio unitario deducido del importe');
    confidence = Math.min(confidence, 0.8);
  } else if ((q === undefined || q === 0) && p !== undefined && p !== 0 && t !== undefined && t !== 0 && f > 0) {
    q = round(t / (p * f), 3);
    notes.push('Cantidad deducida del importe');
    confidence = Math.min(confidence, 0.75);
  } else if ((q === undefined || q === 0) && t !== undefined && (p === undefined || p === 0)) {
    q = 1;
    p = f > 0 ? round(t / f, 4) : t;
    notes.push('Sin cantidad ni precio legibles: se toma 1 unidad por el importe');
    confidence = Math.min(confidence, 0.5);
  } else if (t === undefined && p !== undefined && (q === undefined || q === 0)) {
    q = 1;
    t = round(p * f, 2);
    notes.push('Sin cantidad ni importe legibles: se toma 1 unidad');
    confidence = Math.min(confidence, 0.5);
  }
  if (q === undefined || p === undefined || t === undefined) return undefined;
  if (t === 0 && q > 0) {
    notes.push('Línea sin cargo (regalo o bonificación): no la uses para actualizar el precio');
    confidence = Math.min(confidence, 0.6);
  }
  let vat = l.vatPct;
  if (vat !== undefined) {
    if (vat > 0 && vat < 1) vat *= 100;
    vat = vat >= 0 && vat <= 30 ? round(vat, 1) : undefined;
  }
  const suggestedName = cleanText(l.suggestedName);
  return {
    description,
    code: cleanText(l.code) || undefined,
    quantity: round(q, 4),
    unit: normalizeBilledUnit(l.unit),
    unitPrice: round(p, 4),
    discountPct: round(d, 2),
    total: round(t, 2),
    vatPct: vat,
    packSize: l.packSize,
    suggestedName: suggestedName ? (isShouting(suggestedName) ? toSentenceCase(suggestedName) : capitalize(suggestedName)) : undefined,
    suggestedCategory: l.suggestedCategory,
    confidence,
    notes,
  };
}

/** El importe es correcto: corrige cantidad o precio (o descarta un descuento que no se aplicó). */
function fixQuantityOrPrice(l: WorkLine): void {
  if (l.discountPct > 0 && approxEqual(l.quantity * l.unitPrice, l.total, 0.02, 0.005)) {
    l.notes.push(`El importe no refleja el descuento del ${fmtNum(l.discountPct, 2)} %: se ignora el descuento de la línea`);
    l.discountPct = 0;
    return;
  }
  // Descuento mal leído (p. ej. 10 % en lugar de 5 %): si un descuento «redondo» explica el importe, se corrige.
  if (l.discountPct > 0 && l.quantity * l.unitPrice !== 0) {
    const dNeeded = 100 * (1 - l.total / (l.quantity * l.unitPrice));
    if (dNeeded > 0 && dNeeded < 100 && Math.abs(dNeeded * 2 - Math.round(dNeeded * 2)) < 0.02) {
      const d = Math.round(dNeeded * 2) / 2;
      l.notes.push(`Descuento corregido al ${fmtNum(d, 1)} % con el importe (se leyó ${fmtNum(l.discountPct, 2)} %)`);
      l.discountPct = d;
      return;
    }
  }
  const f = factor(l);
  if (!(f > 0) || l.unitPrice === 0 || l.quantity === 0) return;
  const qNeeded = l.total / (l.unitPrice * f);
  const countUnit = !MASS_OR_VOLUME.has(l.unit);
  if (countUnit && isNearInt(qNeeded) && !isNearInt(l.quantity) && Math.round(qNeeded) !== 0) {
    l.notes.push(`Cantidad corregida a ${fmtNum(Math.round(qNeeded), 0)} con el importe (se leyó ${fmtNum(l.quantity, 3)})`);
    l.quantity = Math.round(qNeeded);
  } else {
    const pNeeded = round(l.total / (l.quantity * f), 4);
    l.notes.push(`Precio unitario corregido a ${fmtEurPrecise(pNeeded)} con el importe (se leyó ${fmtEurPrecise(l.unitPrice)})`);
    l.unitPrice = pNeeded;
  }
}

/**
 * Validación cruzada: para las líneas en las que cantidad × precio × (1 − dto) ≠ importe, busca qué combinación de
 * hipótesis («el importe está bien» / «el importe está mal leído») hace que la suma cuadre con la base imponible.
 * Sólo corrige si hay una única combinación que cuadra; si no, baja la confianza y deja el aviso de la línea.
 */
function reconcileLines(lines: WorkLine[], target: number | undefined): void {
  const mismatched = lines.filter((l) => l.quantity !== 0 && l.unitPrice !== 0 && !lineMatches(l));
  if (!mismatched.length) return;
  if (target !== undefined && Number.isFinite(target) && mismatched.length <= 10) {
    const fixedSum = lines.filter((l) => !mismatched.includes(l)).reduce((s, l) => s + l.total, 0);
    const tol = Math.max(0.03, Math.abs(target) * 0.0005);
    const hits: { mask: number; diff: number }[] = [];
    for (let mask = 0; mask < 1 << mismatched.length; mask++) {
      let sum = fixedSum;
      mismatched.forEach((l, i) => {
        sum += mask & (1 << i) ? computed(l) : l.total;
      });
      const diff = Math.abs(sum - target);
      if (diff <= tol) hits.push({ mask, diff });
    }
    if (hits.length === 1) {
      const { mask } = hits[0];
      mismatched.forEach((l, i) => {
        if (mask & (1 << i)) {
          const old = l.total;
          l.total = computed(l);
          l.notes.push(`Importe corregido a ${fmtEur(l.total)} (se leyó ${fmtEur(old)}) para cuadrar con cantidad × precio y la base imponible`);
        } else {
          fixQuantityOrPrice(l);
        }
        l.confidence = Math.min(l.confidence, 0.7);
      });
      return;
    }
  }
  for (const l of mismatched) l.confidence = Math.min(l.confidence, 0.5);
}

export interface MapOptions {
  /** La respuesta se cortó por longitud. */
  truncated?: boolean;
  /** JSON bruto devuelto por el modelo (se guarda para depurar). */
  rawText?: string;
}

/** Respuesta de Claude → ExtractedInvoice (método 'ia'), con líneas normalizadas a unidad base y avisos de validación. */
export function mapInvoice(parsed: ParsedInvoice, opts: MapOptions = {}): ExtractedInvoice {
  const warnings: string[] = [];

  const supplierName = cleanText(parsed.supplierName) || undefined;
  const supplierTaxId = normalizeTaxId(parsed.supplierTaxId);
  if (supplierTaxId && looksSpanishTaxId(supplierTaxId) && !isValidSpanishTaxId(supplierTaxId)) {
    warnings.push(`El CIF/NIF del proveedor (${supplierTaxId}) no supera la comprobación de control: revísalo`);
  }
  const number = cleanText(parsed.number).replace(/^(?:n\.?\s?[º°]|no\.|n[úu]m\.|n[úu]mero)\s*[:.#]?\s*/i, '') || undefined;
  const rawDate = cleanText(parsed.date);
  const date = rawDate ? normalizeDate(rawDate) : undefined;
  if (rawDate && !date) warnings.push(`No se ha podido interpretar la fecha «${rawDate}»: revísala`);
  else if (!rawDate) warnings.push('No se ha encontrado la fecha de la factura: indícala al revisar');
  else if (date) {
    const ms = Date.parse(`${date}T12:00:00Z`);
    if (ms > Date.now() + 45 * 86_400_000) warnings.push(`La fecha de la factura (${date}) es posterior a hoy: revísala`);
  }

  const money = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? round(v, 2) : undefined);
  const subtotal = money(parsed.subtotal);
  const vatTotal = money(parsed.vatTotal);
  const total = money(parsed.total);

  const nonProduct = parsed.nonProductLines
    .map((n) => ({ description: cleanText(n.description), amount: money(n.amount) }))
    .filter((n) => n.description || n.amount);
  const nonProductSum = round(
    nonProduct.reduce((s, n) => s + (n.amount ?? 0), 0),
    2,
  );

  const work: WorkLine[] = [];
  let dropped = 0;
  for (const l of parsed.lines) {
    const w = toWorkLine(l);
    if (w) work.push(w);
    else dropped++;
  }

  // Objetivo de la suma de líneas: base imponible menos cargos no producto (o total − IVA si falta la base).
  const base = subtotal ?? (total !== undefined && vatTotal !== undefined ? round(total - vatTotal, 2) : undefined);
  reconcileLines(work, base !== undefined ? round(base - nonProductSum, 2) : undefined);

  const lines: ExtractedLine[] = work.map((w) => {
    const input = {
      description: w.description,
      code: w.code,
      quantity: w.quantity,
      unit: w.unit,
      unitPrice: w.unitPrice,
      discountPct: w.discountPct > 0 ? w.discountPct : undefined,
      total: w.total,
      vatPct: w.vatPct,
      packSize: w.packSize,
      suggestedName: w.suggestedName,
      suggestedCategory: w.suggestedCategory,
      confidence: w.confidence,
    };
    let normalized: ExtractedLine;
    let packWarnings: string[] = [];
    try {
      const n = normalizeInvoiceLine(input);
      packWarnings = n.warnings ?? [];
      normalized = { ...n };
    } catch {
      normalized = { ...input };
      packWarnings = ['No se ha podido calcular el precio por unidad base: revísalo'];
    }
    const lineWarnings = dedupe([...w.notes, ...packWarnings]);
    return stripUndefined<ExtractedLine>({ ...normalized, warnings: lineWarnings.length ? lineWarnings : undefined });
  });

  // Avisos globales
  if (nonProduct.length) {
    const list = nonProduct.map((n) => (n.amount !== undefined ? `${n.description || 'Cargo'} (${fmtEur(n.amount)})` : n.description)).join(', ');
    warnings.push(`Se han omitido líneas que no son producto: ${list}`);
  }
  const linesSum = round(
    lines.reduce((s, l) => s + l.total, 0),
    2,
  );
  if (subtotal !== undefined && lines.length) {
    const diff = round(linesSum - subtotal, 2);
    if (Math.abs(diff) > Math.max(0.05, Math.abs(subtotal) * 0.01)) {
      if (nonProductSum !== 0 && approxEqual(linesSum + nonProductSum, subtotal, 0.05, 0.005)) {
        warnings.push(
          `La suma de las líneas de producto (${fmtEur(linesSum)}) difiere de la base imponible (${fmtEur(subtotal)}) por los cargos o descuentos no incluidos como producto (${fmtEur(nonProductSum)})`,
        );
      } else {
        warnings.push(
          `La suma de las líneas (${fmtEur(linesSum)}) no cuadra con la base imponible (${fmtEur(subtotal)}): diferencia de ${fmtEur(Math.abs(diff))}. Revisa si falta alguna línea o hay descuentos globales`,
        );
      }
    }
  } else if (subtotal === undefined && total !== undefined && lines.length && !nonProduct.length && lines.every((l) => l.vatPct !== undefined)) {
    const gross = round(
      lines.reduce((s, l) => s + l.total * (1 + (l.vatPct ?? 0) / 100), 0),
      2,
    );
    if (!approxEqual(gross, total, 0.05, 0.01)) {
      warnings.push(`La suma de las líneas con IVA (${fmtEur(gross)}) no cuadra con el total de la factura (${fmtEur(total)}): revisa las líneas`);
    }
  }
  if (subtotal !== undefined && vatTotal !== undefined && total !== undefined && !approxEqual(subtotal + vatTotal, total, 0.05, 0.005)) {
    warnings.push(
      `La base imponible más el IVA (${fmtEur(round(subtotal + vatTotal, 2))}) no coincide con el total (${fmtEur(total)}): puede haber recargo de equivalencia, retenciones o un error de lectura`,
    );
  }
  if (!lines.length) warnings.push('No se han encontrado líneas de producto en el documento');
  if (dropped) warnings.push(dropped === 1 ? 'Se ha descartado 1 línea sin descripción ni importes' : `Se han descartado ${dropped} líneas sin descripción ni importes`);
  if (opts.truncated) warnings.push('La respuesta de la IA se cortó por ser muy larga: puede que falten las últimas líneas. Divide el documento si es necesario');
  warnings.push(...parsed.warnings);

  return stripUndefined<ExtractedInvoice>({
    supplierName,
    supplierTaxId,
    number,
    date,
    subtotal,
    vatTotal,
    total,
    lines,
    method: 'ia',
    rawText: opts.rawText,
    warnings: dedupe(warnings),
  });
}

// ───────────────────────────── Cartas ─────────────────────────────

/** Nombre de plato limpio: sin numeración, sin precio pegado al final, sin puntos de relleno y sin gritar. */
export function cleanDishName(raw: string): string {
  let s = cleanText(raw)
    .replace(/^\d{1,3}\s*[.)\-–]\s+/, '')
    .replace(/[\s.·_]*\d+(?:[.,]\d{1,2})?\s*(?:€|eur(?:os)?)\s*$/i, '')
    .replace(/\s*\.{2,}\s*$/, '');
  s = cleanText(s);
  return isShouting(s) ? toSentenceCase(s) : capitalize(s);
}

function cleanSection(raw: string): string {
  const s = cleanText(raw).replace(/:$/, '');
  return isShouting(s) ? toSentenceCase(s) : capitalize(s);
}

/** Respuesta de Claude → ExtractedMenu (método 'ia'), con duplicados entre fotos fusionados. */
export function mapMenu(parsed: ParsedMenu, opts: MapOptions = {}): ExtractedMenu {
  const warnings: string[] = [];
  const entries: ExtractedMenu['entries'] = [];
  const firstByKey = new Map<string, number[]>();
  let badPrices = 0;

  for (const item of parsed.items) {
    const name = cleanDishName(item.name);
    if (!name) continue;
    const section = cleanSection(item.section) || undefined;
    let description = cleanText(item.description) || undefined;
    if (description && isShouting(description)) description = toSentenceCase(description);
    let price = item.price !== undefined && Number.isFinite(item.price) ? round(item.price, 2) : undefined;
    if (price !== undefined && (price <= 0 || price > 5000)) {
      price = undefined;
      badPrices++;
    }
    const confidence = clampConfidence(item.confidence, 0.85);
    const key = compareKey(name);
    const candidates = firstByKey.get(key) ?? [];
    const dup = candidates
      .map((i) => entries[i])
      .find((prev) => {
        const samePrice = prev.price === undefined || price === undefined || Math.abs(prev.price - price) < 0.005;
        const sameSection = !prev.section || !section || compareKey(prev.section) === compareKey(section);
        return samePrice && sameSection;
      });
    if (dup) {
      dup.price ??= price;
      dup.section ??= section;
      if (description && (!dup.description || description.length > dup.description.length)) dup.description = description;
      dup.confidence = Math.max(dup.confidence ?? 0, confidence);
      continue;
    }
    candidates.push(entries.length);
    firstByKey.set(key, candidates);
    const entry: ExtractedMenu['entries'][number] = { name, confidence };
    if (section) entry.section = section;
    if (description) entry.description = description;
    if (price !== undefined) entry.price = price;
    entries.push(entry);
  }

  if (!entries.length) warnings.push('No se han encontrado platos en las fotos');
  const withoutPrice = entries.filter((e) => e.price === undefined).length;
  if (withoutPrice) warnings.push(withoutPrice === 1 ? '1 plato no tiene precio legible: complétalo al revisar' : `${withoutPrice} platos no tienen precio legible: complétalos al revisar`);
  if (badPrices) warnings.push(badPrices === 1 ? 'Se ha descartado 1 precio que no parecía válido' : `Se han descartado ${badPrices} precios que no parecían válidos`);
  if (opts.truncated) warnings.push('La respuesta de la IA se cortó por ser muy larga: puede que falten los últimos platos. Lee la carta en varias tandas');
  warnings.push(...parsed.warnings);

  return { entries, method: 'ia', ...(opts.rawText ? { rawText: opts.rawText } : {}), warnings: dedupe(warnings) };
}

// ───────────────────────────── Recetas ─────────────────────────────

export interface RecipeBatchContext {
  /** Platos del lote: referencia usada en el prompt (D1…), clave del llamador y nombre. */
  dishes: { ref: string; key: string; name: string }[];
  /** Referencia del catálogo en el prompt (P1…) → id real del producto. */
  productRefs: Map<string, string>;
  /** Ids reales del catálogo (por si el modelo devuelve el id en lugar de la referencia). */
  productIds: Set<string>;
}

/** Límites de cantidad por ración (en g, ml o ud) por encima de los cuales el dato se considera absurdo. */
const MAX_PER_PORTION = { mass: 5000, volume: 5000, count: 200 };

function normalizeQuantity(quantity: number, unit: QtyUnit): { quantity: number; unit: QtyUnit } | undefined {
  let q = quantity;
  let u = unit;
  // Unidades grandes con cantidades de ración → g/ml (180 «kg» por ración es un error de unidad).
  if (u === 'kg') {
    if (q < 1 || q >= 10) {
      q = q < 1 ? q * 1000 : q;
      u = 'g';
    }
  } else if (u === 'l') {
    if (q < 1 || q >= 10) {
      q = q < 1 ? q * 1000 : q;
      u = 'ml';
    }
  } else if (u === 'cl') {
    q *= 10;
    u = 'ml';
  } else if (u === 'dl') {
    q *= 100;
    u = 'ml';
  } else if (u === 'mg' && q >= 1000) {
    q /= 1000;
    u = 'g';
  } else if (u === 'docena') {
    q *= 12;
    u = 'ud';
  }
  const inBase = u === 'kg' || u === 'l' ? q * 1000 : q;
  const limit = u === 'g' || u === 'kg' || u === 'mg' || u === 'pizca' ? MAX_PER_PORTION.mass : u === 'ud' ? MAX_PER_PORTION.count : MAX_PER_PORTION.volume;
  if (!(q > 0) || inBase > limit) return undefined;
  const decimals = u === 'g' || u === 'ml' ? (q < 10 ? 1 : 0) : u === 'ud' ? 2 : 3;
  const rounded = round(q, decimals);
  return { quantity: rounded > 0 ? rounded : round(q, 3), unit: u };
}

function resolveProductId(ref: string, ctx: RecipeBatchContext): string | undefined {
  const r = ref.trim();
  if (!r) return undefined;
  return ctx.productRefs.get(r.toUpperCase()) ?? (ctx.productIds.has(r) ? r : undefined);
}

function mapIngredient(pi: ParsedRecipeIngredient, ctx: RecipeBatchContext): ProposedIngredient | undefined {
  const rawName = cleanText(pi.name);
  if (!rawName || pi.quantity === undefined || !Number.isFinite(pi.quantity)) return undefined;
  const q = normalizeQuantity(pi.quantity, pi.unit ?? 'g');
  if (!q) return undefined;
  const out: ProposedIngredient = {
    name: isShouting(rawName) ? toSentenceCase(rawName) : capitalize(rawName),
    quantity: q.quantity,
    unit: q.unit,
    basis: pi.basis as QtyBasis,
  };
  if (pi.wastePct !== undefined && Number.isFinite(pi.wastePct)) out.wastePct = round(Math.max(0, Math.min(95, pi.wastePct)), 1);
  if (pi.cookingLossPct !== undefined && Number.isFinite(pi.cookingLossPct)) out.cookingLossPct = round(Math.max(0, Math.min(90, pi.cookingLossPct)), 1);
  if (pi.category) out.category = pi.category;
  const productId = resolveProductId(pi.productRef, ctx);
  if (productId) out.productId = productId;
  const note = cleanText(pi.note);
  if (note) out.note = note;
  return out;
}

function toProcedure(steps: string[]): string | undefined {
  const clean = steps.map((s) => cleanText(s.replace(/^(paso\s*)?\d{1,2}\s*[.):\-–]\s*/i, ''))).filter(Boolean);
  if (!clean.length) return undefined;
  return clean.map((s, i) => `${i + 1}. ${capitalize(s)}${/[.!?]$/.test(s) ? '' : '.'}`).join('\n');
}

/** Respuesta de un lote → propuestas por clave. Descarta productId que no estén en el catálogo y datos absurdos. */
export function mapRecipeBatch(parsed: ParsedRecipes, ctx: RecipeBatchContext): Map<string, DishProposal> {
  const out = new Map<string, DishProposal>();
  const byRef = new Map(ctx.dishes.map((d) => [d.ref.toUpperCase(), d]));
  const byName = new Map(ctx.dishes.map((d) => [compareKey(d.name), d]));
  const sameShape = parsed.dishes.length === ctx.dishes.length;

  parsed.dishes.forEach((pd, i) => {
    const target = byRef.get(pd.ref.trim().toUpperCase()) ?? byName.get(compareKey(pd.dishName)) ?? (sameShape ? ctx.dishes[i] : undefined);
    if (!target || out.has(target.key)) return;
    const ingredients = pd.ingredients.map((pi) => mapIngredient(pi, ctx)).filter((x): x is ProposedIngredient => !!x);
    if (!ingredients.length) return;
    const proposal: DishProposal = {
      dishName: target.name,
      portions: 1,
      ingredients,
      allergens: [...new Set<Allergen>(pd.allergens)],
      source: 'ia',
      confidence: clampConfidence(pd.confidence, 0.75),
    };
    const procedure = toProcedure(pd.steps);
    if (procedure) proposal.procedure = procedure;
    out.set(target.key, proposal);
  });
  return out;
}
