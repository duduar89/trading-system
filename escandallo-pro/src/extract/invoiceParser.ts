import type { ExtractedInvoice, InvoiceLine } from '../types';
import { approxEqual, findDate, parseDateEs, parseNumberEs, round } from '../core/numbers';
import { normalizeInvoiceLine } from '../core/pack';
import { cleanProductName } from '../core/matching';
import type { PdfTextLine } from './pdf';
import { collapseSpaces, fixOcrNumber, fold, foldKeepLength, fuzzyIn, isAllCaps, median } from './textUtils';

/**
 * Parser heurístico de facturas de proveedor (texto de PDF o de OCR) — funciona sin IA.
 *
 * Debe detectar: proveedor (primeras líneas / razón social / CIF-NIF "B12345678"), número de factura,
 * fecha, base imponible, IVA, total; y las LÍNEAS de producto. Para cada línea, prueba combinaciones de los
 * números encontrados para hallar (cantidad, precio, [dto %], importe) que cumplan
 * cantidad × precio × (1 − dto) ≈ importe; esa validación cruzada es la clave de la precisión.
 * Ignora cabeceras, subtotales, portes, líneas de IVA, "Suma y sigue", etc.
 * Cada línea sale normalizada con core/pack.normalizeInvoiceLine y con suggestedName = core/matching.cleanProductName.
 *
 * Si se pasan `pdfLines` (filas con posiciones X de pdf.js o de las palabras del OCR), las columnas se asignan
 * primero por posición bajo la cabecera de la tabla y después se validan con la aritmética.
 */

type Line = ExtractedInvoice['lines'][number];

// ───────────────────────────── Modelo interno ─────────────────────────────

interface NumInfo {
  value: number;
  /** Decimales escritos (3 en "2,500"; 0 en "1.000"). */
  dec: number;
  pct: boolean;
  cur: boolean;
  /** Unidad pegada: "2,5KG" → 'kg'. */
  unit?: string;
  /** Precio por unidad: "3,20€/kg" → 'kg'. */
  perUnit?: string;
  /** Corregido por confusión letra/cifra del OCR. */
  fixed?: string;
}

interface Word {
  raw: string;
  x0: number;
  x1: number;
  /** Plegado sin signos de borde. */
  f: string;
  num?: NumInfo;
}

interface Row {
  i: number;
  text: string;
  f: string;
  words: Word[];
  page: number;
  /** true si las X son posiciones reales (pdf.js / OCR); false si son desplazamientos de carácter. */
  positional: boolean;
  /** Ancho medio de carácter en unidades de X. */
  cw: number;
}

type ColKind = 'code' | 'desc' | 'qty' | 'bultos' | 'unit' | 'price' | 'disc' | 'total' | 'vat' | 'lot';

interface HeaderCol {
  kind: ColKind;
  x0: number;
  x1: number;
  /** Etiqueta plegada ("cajas", "kilos"…), para deducir la unidad. */
  label: string;
}

interface TableHeader {
  row: number;
  cols: HeaderCol[];
  /** Orden de las columnas numéricas (de izquierda a derecha). */
  numericOrder: ColKind[];
  positional: boolean;
}

interface NumTok {
  wi: number;
  w: Word;
  n: NumInfo;
  value: number;
  inDesc: boolean;
  lead: boolean;
  col?: ColKind;
}

interface Solution {
  q: NumTok;
  p: NumTok;
  t: NumTok;
  d: NumTok[];
  f?: NumTok;
  err: number;
  validated: boolean;
  loose: boolean;
  score: number;
}

interface ParsedLine {
  row: number;
  rows: number[];
  code?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPct?: number;
  total: number;
  vatPct?: number;
  vatCode?: string;
  confidence: number;
  warnings: string[];
  validated: boolean;
  /** Posición X del inicio de la descripción (para las continuaciones). */
  descX?: number;
}

// ───────────────────────────── Vocabulario ─────────────────────────────

export const VAT_RATES = [0, 2, 4, 5, 7.5, 10, 21];
const RE_RATES = [0.5, 0.62, 1.4, 1.75, 5.2, 0.26];

const UNIT_WORDS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const add = (keys: string, unit: string) => {
    for (const k of keys.split(/\s+/)) map[k] = unit;
  };
  add('kg kgs kgr k kilo kilos kilogramo kilogramos k6 kq k9', 'kg');
  add('g gr grs gramo gramos', 'g');
  add('l lt lts ltr litro litros', 'l');
  add('ml cl', '');
  add('ud uds u un und unds unid unidad unidades uni pz pza pzas pieza piezas', 'ud');
  add('caja cajas cj cja cjs caj', 'caja');
  add('bot botella botellas botellin botellines', 'bot');
  add('paq paquete paquetes pqt pack packs pk', 'paquete');
  add('bolsa bolsas', 'bolsa');
  add('malla mallas', 'malla');
  add('saco sacos', 'saco');
  add('bandeja bandejas bdja band barqueta barquetas', 'bandeja');
  add('manojo manojos mnj', 'manojo');
  add('docena docenas dz doc', 'docena');
  add('garrafa garrafas', 'garrafa');
  add('bidon bidones', 'bidon');
  add('lata latas', 'lata');
  add('brik briks brick bricks', 'brik');
  add('tarro tarros bote botes frasco frascos', 'bote');
  add('cubo cubos cubeta', 'cubo');
  add('fardo fardos', 'fardo');
  add('estuche estuches', 'estuche');
  add('rollo rollos', 'rollo');
  add('sobre sobres', 'sobre');
  add('barril barriles', 'barril');
  add('ristra ristras', 'ristra');
  add('racimo racimos', 'racimo');
  // ml/cl sólo como unidad de facturación explícita
  map.ml = 'ml';
  map.cl = 'cl';
  return map;
})();

function unitOf(word: Word | undefined): string | undefined {
  if (!word || word.num) return undefined;
  const k = word.f.replace(/[^a-z0-9]/g, '');
  return UNIT_WORDS[k];
}

/** Palabras tras las cuales un número no es cantidad/precio/importe. */
const NOISE_PREFIX = new Set(
  'fao lote lot l cal calibre cat categoria talla t zona ref art cod codigo n no num numero reg rgseaa pedido albaran alb cad caducidad tel telf tlf fax cp dto_ano ano anada cosecha uxc'.split(
    ' ',
  ),
);

const HEADER_VOCAB: [ColKind, string[]][] = [
  ['desc', ['descripcion', 'descripcio', 'descrip', 'concepto', 'producto', 'productos', 'denominacion', 'detalle', 'designacion', 'mercancia', 'material', 'description', 'item', 'articulos']],
  ['code', ['codigo', 'cod', 'ref', 'referencia', 'ean', 'codi', 'code', 'sku', 'plu']],
  ['qty', ['cantidad', 'cant', 'cantid', 'uds', 'unidades', 'unids', 'kilos', 'kgs', 'peso', 'piezas', 'nuds', 'quantitat', 'qty', 'quantity', 'cantidades']],
  ['bultos', ['bultos', 'bulto', 'cajas', 'bult', 'envases']],
  ['unit', ['ud', 'um', 'unidad', 'medida', 'formato', 'unit', 'u']],
  ['price', ['precio', 'preciounit', 'preciounitario', 'punit', 'pu', 'pvp', 'tarifa', 'unitario', 'prunit', 'precunit', 'pud', 'preu', 'price', 'prec', 'precioud', 'preciokg', 'eurud', 'eurkg']],
  ['disc', ['dto', 'dtos', 'dcto', 'descuento', 'desc', 'dte', 'descompte', 'bonif', 'disc', 'discount', 'dto1', 'dto2']],
  ['total', ['importe', 'total', 'neto', 'subtotal', 'valor', 'import', 'amount', 'imp', 'importeneto', 'totallinea']],
  ['vat', ['iva', 'tipo', 'tiva', 'vat', 'impuesto']],
  ['lot', ['lote', 'caducidad', 'cad', 'lot']],
];
const HEADER_WORDS = HEADER_VOCAB.flatMap(([, w]) => w);

function headerKind(key: string, hasDesc: boolean): ColKind | undefined {
  if (!key) return undefined;
  if (key === 'articulo' || key === 'art' || key === 'article') return hasDesc ? 'code' : 'desc';
  const exact = HEADER_VOCAB.find(([, words]) => words.includes(key));
  if (exact) return exact[0];
  if (key.length >= 5) {
    const fz = fuzzyIn(key, HEADER_WORDS);
    if (fz) return HEADER_VOCAB.find(([, words]) => words.includes(fz))?.[0];
  }
  return undefined;
}

// Filas que cierran la tabla de líneas (totales, pie)
const STOP_RE =
  /(?:^|\s)(?:base\s*imp(?:onible)?|b\.\s*imponible|total\s*base|bases?\s*imponibles?|subtotal|sub-total|suma\s*y\s*sigue|total\s*(?:factura|fra|a\s*pagar|documento|general|eur(?:os)?|neto|bruto|importe|albaran|lineas|productos)|importe\s*total|suma\s*(?:de\s*)?importes?|total\s*bases?|forma\s*de\s*pago|formas\s*de\s*pago|vencimientos?|observaciones|desglose\s*(?:de\s*)?(?:l?\s*)?iva|cuadro\s*(?:de\s*)?iva|resumen\s*(?:de\s*)?iva|recargo\s*(?:de\s*)?equivalencia|cuota\s*i\.?v\.?a|total\s*i\.?v\.?a|i\.?v\.?a\.?\s*\d{1,2}(?:[.,]\d{1,2})?\s*%\s*(?:s\/|sobre)|dto\.?\s*pronto\s*pago|total\s*$|^total\b)/;
const PAUSE_RE = /suma\s*y\s*sigue|sigue\s*en\s*(?:la\s*)?(?:pagina|hoja)|continua\s*en/;
const RESUME_RE = /suma\s*anterior|viene\s*de\s*(?:la\s*)?(?:pagina|hoja)|anterior\s*:/;
/** Metadatos de trazabilidad (lote, caducidad, zona FAO, especie…) que no son líneas. */
const META_RE =
  /^(?:\(?\s*)?(?:lote|lot|l\.?\s*:|n[ºo°]?\s*lote|cad\b|cad\.|caducidad|fecha\s*(?:de\s*)?cad|f\.?\s*cad|consumir|consumo\s*pref|origen|pais|fao|zona\s*(?:de\s*)?captura|zona\s*fao|arte\s*(?:de\s*)?pesca|metodo\s*(?:de\s*)?produccion|capturado|criado|especie|nombre\s*cient|n\.?\s*cient|denominacion\s*comercial|presentacion|peso\s*neto|temperatura|conservar|registro\s*sanitario|rgseaa|albaran|alb\.|pedido|s\/ref|su\s*ref|nuestra\s*ref|n\/ref|entrega|matadero|sala\s*de\s*despiece|nacido|sacrificado|despiece|n[ºo°]\s*(?:de\s*)?referencia|codigo\s*de\s*barras|ean\b)/;
const META_ANY_RE = /\b(?:lote|cad(?:ucidad)?|fao\s*\d{1,2}|f\.\s*cad|consumir\s*pref)\s*[:.]?\s*[a-z0-9]/;
const SCIENTIFIC_RE = /^\(?[A-Z][a-z]+ [a-z]{3,}\)?(?:\s|$)/;
const EXTRA_RE =
  /^(?:portes?|transporte|gastos\s*(?:de\s*)?(?:envio|transporte)|envio|envases?(?:\s*retornables?)?|retornables?|fianza|deposito|cascos?|palets?|ecotasa|punto\s*verde|recargo\s*(?:de\s*)?combustible|gastos?\s*financieros?|tasa\s*(?:de\s*)?residuos|sirga)\b/;
const DISCOUNT_ROW_RE = /^(?:dto|dcto|descuento|desc\.|promo(?:cion)?|oferta|bonif(?:icacion)?|rappel|abono|rebaja|ahorro)\b/;

// ───────────────────────────── Tokenización ─────────────────────────────

const RE_NUMERIC = /^[-+]?\d[\d.,]*-?$/;
const RE_GLUED_UNIT = /^(-?\d[\d.,]*)(kgs?|kgr|k|grs?|g|lts?|ltr|l|uds?|u|und|unds|unid|un|cl|ml|pzs?|pza|bot|cj|caj|cja|cjs|dz)\.?$/i;
const RE_PER_UNIT = /^(-?\d[\d.,]*)\s*(?:€|eur)?\/(kg|kilo|l|lt|ud|u|und|unid|uds)\.?$/i;

function decimalsOf(s: string, value: number): number {
  const m = /[.,](\d+)$/.exec(s);
  if (!m) return 0;
  // "1.000" → miles (entero)
  if (Number.isInteger(value) && m[1].length === 3 && Math.abs(value) === Number(s.replace(/[^\d]/g, ''))) return 0;
  return m[1].length;
}

function parseWordNumber(raw: string, allowOcr: boolean): NumInfo | undefined {
  let s = raw.replace(/^[([{"'“«]+/, '').replace(/[)\]}"'”»:;]+$/, '');
  if (!s || !/\d/.test(s) && !allowOcr) return undefined;
  let cur = false;
  let pct = false;
  if (/^(?:€|eur)/i.test(s) && /\d/.test(s)) {
    cur = true;
    s = s.replace(/^(?:€|eur)\s*/i, '');
  }
  if (/(?:€|eur|euros)$/i.test(s)) {
    cur = true;
    s = s.replace(/\s*(?:€|eur|euros)$/i, '');
  }
  if (/%$/.test(s)) {
    pct = true;
    s = s.slice(0, -1);
  }
  let unit: string | undefined;
  let perUnit: string | undefined;
  const per = RE_PER_UNIT.exec(s);
  if (per) {
    s = per[1];
    perUnit = UNIT_WORDS[per[2].toLowerCase()] ?? per[2].toLowerCase();
  } else {
    const gl = RE_GLUED_UNIT.exec(s);
    if (gl && !pct) {
      s = gl[1];
      unit = UNIT_WORDS[gl[2].toLowerCase()] ?? gl[2].toLowerCase();
    }
  }
  let fixed: string | undefined;
  if (!RE_NUMERIC.test(s)) {
    if (!allowOcr) return undefined;
    const f = fixOcrNumber(s);
    if (!f || !RE_NUMERIC.test(f)) return undefined;
    fixed = f;
    s = f;
  }
  if (/[.,]$/.test(s)) s = s.slice(0, -1);
  const value = parseNumberEs(s);
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return { value, dec: decimalsOf(s.replace(/-$/, ''), value), pct, cur, unit, perUnit, fixed };
}

function makeWord(raw: string, x0: number, x1: number, allowOcr: boolean): Word {
  const f = fold(raw).replace(/^[^a-z0-9%€]+|[^a-z0-9%€]+$/g, '');
  const word: Word = { raw, x0, x1, f };
  // Fechas, horas, códigos con "/" o "x" no son números
  if (!/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(raw) && !/^\d{1,2}:\d{2}/.test(raw)) {
    const n = parseWordNumber(raw, allowOcr);
    if (n) word.num = n;
  }
  return word;
}

/** Une "12,50" + "€" y separa "€12,50"; marca el símbolo de moneda en el número. */
function attachCurrency(words: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    if (/^(?:€|eur|euros)$/i.test(w.raw)) {
      const prev = out[out.length - 1];
      if (prev?.num) {
        prev.num.cur = true;
        prev.x1 = w.x1;
        continue;
      }
    }
    out.push(w);
  }
  return out;
}

function rowFromText(text: string, i: number, allowOcr: boolean): Row {
  const words: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) words.push(makeWord(m[0], m.index, m.index + m[0].length, allowOcr));
  return { i, text, f: fold(text), words: attachCurrency(words), page: 1, positional: false, cw: 1 };
}

function rowFromPdf(line: PdfTextLine, i: number, allowOcr: boolean): Row {
  const words: Word[] = [];
  const cws: number[] = [];
  for (const item of line.items) {
    const str = item.str;
    if (!str.trim()) continue;
    const cw = item.width > 0 ? item.width / Math.max(1, str.length) : 1;
    cws.push(cw);
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(str))) words.push(makeWord(m[0], item.x + m.index * cw, item.x + (m.index + m[0].length) * cw, allowOcr));
  }
  return { i, text: line.text, f: fold(line.text), words: attachCurrency(words), page: line.page, positional: true, cw: median(cws) || 1 };
}

/** Normaliza texto de OCR: "12, 50" → "12,50"; "12 ,50" → "12,50"; comillas y rayas raras. */
function cleanOcrText(line: string): string {
  return line
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/(\d)\s*([.,])\s+(\d{2,3})(?!\d)/g, '$1$2$3')
    .replace(/(\d)\s+([.,])(\d{2,3})(?!\d)/g, '$1$2$3');
}

// ───────────────────────────── Palabras con contenido ─────────────────────────────

function isTexty(w: Word): boolean {
  if (w.num) return false;
  if (unitOf(w) !== undefined) return false;
  const letters = w.f.replace(/[^a-z]/g, '');
  if (letters.length < 2) return false;
  if (/^(?:eur|euros)$/.test(w.f)) return false;
  return true;
}

function isCodeWord(w: Word, next: Word | undefined): boolean {
  if (!next || !/\p{L}/u.test(next.raw)) return false;
  const r = w.raw.replace(/[.:]+$/, '');
  if (/^\d{4,14}$/.test(r)) return true;
  if (/^[A-Z]{1,4}[-./]?\d{2,}[A-Z0-9\-./]*$/i.test(r) && /\d/.test(r)) return true;
  if (/^\d{2,}[-./][A-Z0-9\-./]+$/i.test(r) && !/^\d{1,2}[-./]\d{1,2}$/.test(r)) return true;
  return false;
}

/** Índices de las palabras de código al inicio de la fila ("000123", "REF 4455", "V-010"). */
function leadingCode(words: Word[]): { end: number; code?: string } {
  if (words.length < 2) return { end: 0 };
  const w0 = words[0];
  if (/^(?:ref|art|cod|codigo|referencia)$/.test(w0.f) && words[1] && /\d/.test(words[1].raw) && words[2]) {
    return { end: 2, code: words[1].raw.replace(/[.:]+$/, '') };
  }
  if (isCodeWord(w0, words[1])) return { end: 1, code: w0.raw.replace(/[.:]+$/, '') };
  return { end: 0 };
}

// ───────────────────────────── Cabecera de tabla ─────────────────────────────

function detectTableHeader(row: Row): TableHeader | undefined {
  const nums = row.words.filter((w) => w.num && !w.num.pct).length;
  if (nums > 1 || row.words.length < 2 || row.words.length > 24) return undefined;
  const keys = row.words.map((w) => w.f.replace(/[^a-z0-9]/g, ''));
  const hasDesc = keys.some((k) => headerKind(k, false) === 'desc');
  const cols: HeaderCol[] = [];
  for (let idx = 0; idx < keys.length; idx++) {
    const w = row.words[idx];
    const k = keys[idx];
    const nextKey = keys[idx + 1] ?? '';
    let kind: ColKind | undefined;
    let x1 = w.x1;
    // "P. Unit.", "Pr. unit", "Precio ud.", "Precio / kg", "€/kg": precio
    if (/^(?:p|pr|prec|precio)$/.test(k) && /^(?:unit|unitario|ud|u|uni|neto|kg|und|unid)$/.test(nextKey)) {
      kind = 'price';
      x1 = row.words[idx + 1].x1;
      idx++;
    } else if (/€|eur\s*\//i.test(w.raw) && /\/|€/.test(w.raw) && !/^%/.test(w.raw)) {
      kind = 'price';
    } else if (/^(?:n|no|num)$/.test(k) && /^(?:uds|unidades|bultos|cajas|piezas)$/.test(nextKey)) {
      kind = headerKind(nextKey, hasDesc);
      x1 = row.words[idx + 1].x1;
      idx++;
    } else {
      kind = headerKind(k, hasDesc);
    }
    if (!kind) continue;
    const prev = cols[cols.length - 1];
    // Etiquetas de varias palabras: "Precio unitario", "Cuota IVA", "Precio neto", "Importe neto"
    if (prev && w.x0 - prev.x1 < row.cw * 2.5 && cols.length && keys[idx - 1] !== undefined) {
      if (prev.kind === 'price' && (kind === 'total' || kind === 'unit' || kind === 'qty' || kind === 'price')) {
        prev.x1 = x1;
        continue;
      }
      if (prev.kind === kind) {
        prev.x1 = x1;
        continue;
      }
      if (prev.kind === 'total' && kind === 'vat') {
        prev.kind = 'vat';
        prev.x1 = x1;
        continue;
      }
    }
    cols.push({ kind, x0: w.x0, x1, label: k });
  }
  const kinds = new Set(cols.map((c) => c.kind));
  const main = ['desc', 'qty', 'price', 'total'].filter((k) => kinds.has(k as ColKind)).length;
  const ok = main >= 3 || (kinds.has('desc') && kinds.has('total') && (kinds.has('qty') || kinds.has('price') || kinds.has('disc') || kinds.has('bultos')));
  if (!ok) return undefined;
  // Evitar confundir una fila de totales ("Base imponible  IVA  Total") con la cabecera
  if (!kinds.has('desc') && !kinds.has('qty')) return undefined;
  const numericKinds: ColKind[] = ['qty', 'bultos', 'price', 'disc', 'total', 'vat'];
  const numericOrder = cols.filter((c) => numericKinds.includes(c.kind)).map((c) => c.kind);
  return { row: row.i, cols, numericOrder, positional: row.positional };
}

function columnOf(w: Word, header: TableHeader, cw: number): ColKind | undefined {
  const cols = header.cols;
  const pad = cw * 0.6;
  let best: HeaderCol | undefined;
  let bestOv = 0;
  for (const c of cols) {
    const ov = Math.min(w.x1, c.x1 + pad) - Math.max(w.x0, c.x0 - pad);
    if (ov > bestOv) {
      bestOv = ov;
      best = c;
    }
  }
  if (best) return best.kind;
  // Sin solape: columna cuyo tramo (hasta el punto medio con sus vecinas) contiene el centro del token
  const center = (w.x0 + w.x1) / 2;
  const sorted = [...cols].sort((a, b) => a.x0 - b.x0);
  for (let k = 0; k < sorted.length; k++) {
    const left = k === 0 ? -Infinity : (sorted[k - 1].x1 + sorted[k].x0) / 2;
    const right = k === sorted.length - 1 ? Infinity : (sorted[k].x1 + sorted[k + 1].x0) / 2;
    if (center >= left && center < right) {
      const c = sorted[k];
      const dist = center < c.x0 ? c.x0 - center : center > c.x1 ? center - c.x1 : 0;
      if (dist <= Math.max(cw * 8, (c.x1 - c.x0) * 1.5)) return c.kind;
    }
  }
  return undefined;
}

// ───────────────────────────── Resolución aritmética de una fila ─────────────────────────────

function tolerance(q: number, p: number): number {
  return 0.0051 + 0.0051 * Math.abs(q) + 0.00051 * Math.abs(p);
}

function isVatRateValue(n: NumInfo): boolean {
  return n.dec <= 2 && VAT_RATES.includes(n.value) && n.value > 0;
}

function numTokens(row: Row, startWord: number, header?: TableHeader): NumTok[] {
  const words = row.words;
  const out: NumTok[] = [];
  const firstText = words.findIndex((w, idx) => idx >= startWord && isTexty(w));
  let lastText = -1;
  words.forEach((w, idx) => {
    if (idx >= startWord && isTexty(w)) lastText = idx;
  });
  for (let wi = startWord; wi < words.length; wi++) {
    const w = words[wi];
    if (!w.num) continue;
    const prev = words[wi - 1];
    if (prev && !prev.num && NOISE_PREFIX.has(prev.f.replace(/[^a-z]/g, ''))) continue;
    // "6 X 1L", "24 x 33cl": parte de un formato
    const next = words[wi + 1];
    if (next && /^[x*×]$/i.test(next.raw) && words[wi + 2] && /\d/.test(words[wi + 2].raw)) continue;
    if (prev && /^[x*×]$/i.test(prev.raw) && words[wi - 2]?.num) continue;
    const inDesc = lastText > wi;
    const lead = firstText === -1 || wi < firstText;
    const col = header ? columnOf(w, header, row.cw) : undefined;
    out.push({ wi, w, n: w.num, value: w.num.value, inDesc: inDesc && !lead, lead: lead && firstText !== -1, col });
  }
  return out;
}

interface SolveOpts {
  header?: TableHeader;
  /** Importe forzado (reparación con la base imponible). */
  targetTotal?: number;
}

function orderScore(sol: Pick<Solution, 'q' | 'p' | 't' | 'd'>, header?: TableHeader): number {
  if (!header || header.numericOrder.length < 2) return 0;
  const used: [number, ColKind][] = [
    [sol.q.wi, 'qty'],
    [sol.p.wi, 'price'],
    [sol.t.wi, 'total'],
    ...sol.d.map((d) => [d.wi, 'disc'] as [number, ColKind]),
  ];
  used.sort((a, b) => a[0] - b[0]);
  const order: ColKind[] = header.numericOrder.map((k) => (k === 'bultos' ? 'qty' : k));
  let pos = 0;
  for (const [, kind] of used) {
    const found = order.indexOf(kind, pos);
    if (found === -1) return -3;
    pos = found + 1;
  }
  return 3;
}

function colScore(tok: NumTok, want: ColKind, positional: boolean): number {
  if (!tok.col) return 0;
  const w = positional ? 5 : 1.5;
  if (tok.col === want) return w;
  if (want === 'qty' && tok.col === 'bultos') return w * 0.5;
  if (tok.col === 'desc' || tok.col === 'code') return -w * 1.5;
  return -w;
}

function solveTokens(toks: NumTok[], opts: SolveOpts): Solution | undefined {
  const header = opts.header;
  const positional = !!header?.positional;
  const cands = toks.filter((t) => t.value !== 0);
  if (cands.length < 2 && opts.targetTotal === undefined) return undefined;
  // Último token "importe" posible (ignorando un % de IVA final)
  const last = cands[cands.length - 1];
  const lastIsVat = !!last && cands.length >= 4 && isVatRateValue(last.n) && last.n.dec <= 2 && !last.n.cur;
  const lastIdx = lastIsVat ? cands.length - 2 : cands.length - 1;
  let best: Solution | undefined;

  const consider = (q: NumTok, p: NumTok, t: NumTok, d: NumTok[], f?: NumTok) => {
    let calc = q.value * p.value * (f ? f.value : 1);
    for (const dd of d) calc *= 1 - dd.value / 100;
    const target = opts.targetTotal ?? t.value;
    const err = Math.abs(calc - target);
    const tol = tolerance(q.value * (f ? f.value : 1), p.value);
    const validated = err <= tol;
    const loose = !validated && approxEqual(calc, target, 0.02, 0.01);
    if (!validated && !loose) return;
    let score = validated ? (err <= 0.0051 ? 12 : 10) : 5;
    const ti = cands.indexOf(t);
    if (ti === lastIdx) score += 4;
    else score -= 2 * (lastIdx - ti);
    if (lastIsVat && ti === cands.length - 2) score += 1;
    if (q.wi < p.wi) score += 2;
    if (q.inDesc) score -= 3;
    if (p.inDesc) score -= 4;
    if (t.inDesc) score -= 6;
    if (q.lead && q.wi < p.wi) score += 1;
    if (q.n.pct || p.n.pct || t.n.pct) score -= 20;
    if (q.n.cur) score -= 3;
    if (t.n.cur) score += 1;
    if (p.n.cur) score += 0.5;
    if (t.n.dec === 2) score += 1;
    else if (t.n.dec === 0 && Math.abs(t.value) < 1000) score -= 1;
    if (p.n.dec >= 2 && p.n.dec <= 4) score += 0.5;
    if (q.n.unit) score += 1.5;
    if (p.n.perUnit) score += 1.5;
    if (Math.abs(q.value) >= 10000) score -= 5;
    if (q.n.fixed) score -= 1.5;
    if (p.n.fixed) score -= 1.5;
    if (t.n.fixed) score -= 1.5;
    for (const dd of d) {
      score -= 0.5;
      if (dd.n.pct) score += 1;
      if (dd.wi > Math.max(q.wi, p.wi) && dd.wi < t.wi) score += 1;
      score += colScore(dd, 'disc', positional) * 0.6;
      if (dd.n.fixed) score -= 1.5;
    }
    if (f) score -= 3;
    score += colScore(q, 'qty', positional) + colScore(p, 'price', positional) + colScore(t, 'total', positional);
    score += orderScore({ q, p, t, d }, header);
    if (!best || score > best.score) best = { q, p, t, d, f, err, validated, loose, score };
  };

  for (let ti = cands.length - 1; ti >= 0; ti--) {
    const t = cands[ti];
    if (t.n.pct || t.n.perUnit) continue;
    if (opts.targetTotal !== undefined && !approxEqual(t.value, opts.targetTotal, 0.011, 0.001)) continue;
    const before = cands.slice(0, ti);
    for (const q of before) {
      if (q.n.pct || Math.abs(q.value) >= 100000) continue;
      for (const p of before) {
        if (p === q || p.n.pct || p.value <= 0) continue;
        if (Math.sign(q.value * p.value) !== Math.sign(t.value)) continue;
        consider(q, p, t, []);
        const discs = before.filter((d) => d !== q && d !== p && d.value > 0 && d.value < 100 && d.n.dec <= 2 && (d.n.pct || d.wi > Math.min(q.wi, p.wi)));
        for (let a = 0; a < discs.length; a++) {
          consider(q, p, t, [discs[a]]);
          for (let b = a + 1; b < discs.length; b++) consider(q, p, t, [discs[a], discs[b]]);
        }
      }
    }
  }
  if (best) return best;
  // Cantidad × unidades por caja × precio unitario (UxC de cash & carry)
  for (let ti = cands.length - 1; ti >= 0; ti--) {
    const t = cands[ti];
    if (t.n.pct || t.n.perUnit) continue;
    const before = cands.slice(0, ti);
    for (const q of before) {
      if (q.n.pct) continue;
      for (const f of before) {
        if (f === q || f.n.pct || f.n.dec > 0 || f.value < 2 || f.value > 1000 || f.inDesc) continue;
        for (const p of before) {
          if (p === q || p === f || p.n.pct || p.value <= 0) continue;
          if (!(q.wi < f.wi && f.wi < p.wi) && !(f.wi < q.wi && q.wi < p.wi)) continue;
          consider(q, p, t, [], f);
        }
      }
    }
  }
  return best;
}

/** Variantes de reparación del OCR: decimales perdidos ("1250" → 12,50 / 1,250) y números partidos ("12 50"). */
function repairVariants(toks: NumTok[], row: Row): NumTok[][] {
  const variants: NumTok[][] = [];
  toks.forEach((t, k) => {
    if (t.inDesc || t.n.pct) return;
    const raw = t.w.raw.replace(/[^\d.,-]/g, '');
    const digits = raw.replace(/[^\d]/g, '');
    if (t.n.dec === 0 && /^\d{3,6}$/.test(digits) && Number.isInteger(t.value)) {
      for (const div of [100, 1000, 10]) {
        const v = round(t.value / div, 4);
        const dec = div === 100 ? 2 : div === 1000 ? 3 : 1;
        const fixed = `${Math.trunc(v)},${String(Math.round((v % 1) * div)).padStart(dec, '0')}`;
        variants.push(toks.map((x, i) => (i === k ? { ...x, value: v, n: { ...x.n, value: v, dec, fixed } } : x)));
      }
    }
    // "1.250" leído como miles cuando era 1,250 kg
    if (t.n.dec === 0 && /^\d{1,3}[.]\d{3}$/.test(raw)) {
      const v = t.value / 1000;
      variants.push(toks.map((x, i) => (i === k ? { ...x, value: v, n: { ...x.n, value: v, dec: 3, fixed: raw.replace('.', ',') } } : x)));
    }
    // Dos tokens contiguos "12" "50" → 12,50
    const nx = toks[k + 1];
    if (nx && nx.wi === t.wi + 1 && t.n.dec === 0 && nx.n.dec === 0 && !nx.n.pct) {
      const a = t.w.raw.replace(/[^\d]/g, '');
      const b = nx.w.raw.replace(/[^\d]/g, '');
      if (/^\d{1,4}$/.test(a) && /^\d{2,3}$/.test(b) && row.words[t.wi].x1 <= row.words[nx.wi].x0) {
        const v = Number(`${a}.${b}`);
        const merged: NumTok = { ...t, value: v, n: { ...t.n, value: v, dec: b.length, fixed: `${a},${b}`, cur: t.n.cur || nx.n.cur } };
        variants.push([...toks.slice(0, k), merged, ...toks.slice(k + 2)]);
      }
    }
  });
  return variants;
}

// ───────────────────────────── Construcción de la línea ─────────────────────────────

function normUnit(u: string): string {
  const k = fold(u).replace(/[^a-z0-9]/g, '');
  const mapped = UNIT_WORDS[k];
  return mapped || k || 'ud';
}

function buildLine(row: Row, codeEnd: number, code: string | undefined, sol: Solution, toks: NumTok[], confidence: number, warnings: string[]): ParsedLine {
  const words = row.words;
  const used = new Set<number>([sol.q.wi, sol.p.wi, sol.t.wi, ...sol.d.map((d) => d.wi)]);
  if (sol.f) used.add(sol.f.wi);
  // Merges de la reparación: el token siguiente también queda consumido
  for (const t of [sol.q, sol.p, sol.t]) if (t.n.fixed && /^\d{1,4},\d{2,3}$/.test(t.n.fixed) && !/[.,]/.test(t.w.raw)) used.add(t.wi + 1);

  // IVA de la línea: token numérico tras el importe con un tipo válido, o letra de código
  let vatPct: number | undefined;
  let vatCode: string | undefined;
  const afterT = toks.filter((t) => t.wi > sol.t.wi);
  const vatTok = afterT.find((t) => isVatRateValue(t.n) || (t.n.value === 0 && t.col === 'vat'));
  if (vatTok) {
    vatPct = vatTok.value;
    used.add(vatTok.wi);
  } else {
    const lastWord = words[words.length - 1];
    if (lastWord && lastWord !== sol.t.w && /^[A-E]$/.test(lastWord.raw.replace(/[()]/g, '')) && words.indexOf(lastWord) > sol.t.wi) {
      vatCode = lastWord.raw.replace(/[()]/g, '');
      used.add(words.length - 1);
    }
  }

  // Unidad
  const qi = sol.q.wi;
  let unit: string | undefined = sol.q.n.unit;
  let unitWi = -1;
  if (!unit && unitOf(words[qi + 1]) !== undefined && !used.has(qi + 1)) {
    unit = unitOf(words[qi + 1]) || fold(words[qi + 1].raw);
    unitWi = qi + 1;
  }
  if (!unit) {
    const lo = Math.min(qi, sol.p.wi);
    const hi = Math.max(qi, sol.p.wi);
    for (let k = lo + 1; k < hi; k++) {
      const u = unitOf(words[k]);
      if (u !== undefined && !used.has(k)) {
        unit = u || fold(words[k].raw);
        unitWi = k;
        break;
      }
    }
  }
  if (!unit && sol.p.n.perUnit) unit = sol.p.n.perUnit;
  if (!unit && qi > 0 && unitOf(words[qi - 1]) !== undefined && !words[qi - 1].num && qi - 1 >= codeEnd) {
    const cand = words[qi - 1];
    // Sólo si no forma parte de un formato ("SACO 25 KG")
    if (!words[qi - 2]?.num) {
      unit = unitOf(cand) || fold(cand.raw);
      unitWi = qi - 1;
    }
  }
  if (!unit) {
    for (let k = sol.t.wi - 1; k > Math.max(qi, sol.p.wi); k--) {
      const u = unitOf(words[k]);
      if (u !== undefined) {
        unit = u || fold(words[k].raw);
        unitWi = k;
        break;
      }
    }
  }
  if (unitWi >= 0) used.add(unitWi);

  // Descripción: palabras no usadas fuera de la zona numérica final (y tras una cantidad inicial)
  const leadFields = [sol.q, sol.p, sol.t, ...sol.d].filter((t) => t.lead).map((t) => t.wi);
  const firstTail = Math.min(...[sol.q, sol.p, sol.t, ...sol.d, ...(sol.f ? [sol.f] : [])].filter((t) => !t.lead).map((t) => t.wi));
  const descStart = Math.max(codeEnd, leadFields.length ? Math.max(...leadFields) + 1 : codeEnd, unitWi >= 0 && unitWi < firstTail && leadFields.length ? unitWi + 1 : 0);
  const descWords: Word[] = [];
  for (let k = descStart; k < words.length && k < firstTail; k++) {
    if (used.has(k)) continue;
    const w = words[k];
    if (/^[.\-_·:|]+$/.test(w.raw)) continue;
    descWords.push(w);
  }
  // Una unidad suelta al final de la descripción ("PUERRO KG") sirve de unidad si no había otra
  if (!unit && descWords.length > 1) {
    const lastW = descWords[descWords.length - 1];
    const u = unitOf(lastW);
    if (u) unit = u;
  }
  if (!unit) unit = sol.q.n.dec === 3 && !Number.isInteger(sol.q.value) ? 'kg' : 'ud';
  let description = collapseSpaces(descWords.map((w) => w.raw).join(' ')).replace(/[\s.·:|_-]+$/, '').replace(/^[\s.·:|_-]+/, '');

  let quantity = sol.q.value;
  let unitPrice = sol.p.value;
  if (sol.f) {
    // Cajas × unidades por caja × precio unitario → precio por caja
    unitPrice = round(sol.p.value * sol.f.value, 4);
    if (unit === 'ud' || !unit) unit = 'caja';
    if (!/\d+\s*[x*]\s*\d/i.test(description)) description = `${description} ${sol.f.value} UD`.trim();
  }
  let discountPct: number | undefined;
  if (sol.d.length) discountPct = round((1 - sol.d.reduce((acc, d) => acc * (1 - d.value / 100), 1)) * 100, 2);
  const fixes = [sol.q, sol.p, sol.t, ...sol.d].filter((t) => t.n.fixed).map((t) => `"${t.w.raw}" → ${t.n.fixed}`);
  if (fixes.length) warnings.push(`Lectura corregida por la validación aritmética: ${fixes.join(', ')}`);
  quantity = round(quantity, 4);
  return {
    row: row.i,
    rows: [row.i],
    code,
    description,
    quantity,
    unit: normUnit(unit),
    unitPrice: round(unitPrice, 4),
    discountPct,
    total: round(sol.t.value, 2),
    vatPct,
    vatCode,
    confidence,
    warnings,
    validated: sol.validated || sol.loose,
    descX: descWords[0]?.x0,
  };
}

interface RowParse {
  line?: ParsedLine;
  /** Fila con texto pero sin números útiles (posible continuación). */
  textOnly?: boolean;
}

function parseRow(row: Row, header: TableHeader | undefined, inTable: boolean): RowParse {
  const words = row.words;
  if (!words.length) return {};
  const { end: codeEnd, code } = leadingCode(words);
  const toks = numTokens(row, codeEnd, header);
  const hasText = words.some((w, k) => k >= codeEnd && isTexty(w));
  if (!toks.length || toks.every((t) => t.inDesc)) return { textOnly: hasText };

  let sol = solveTokens(toks, { header });
  let conf = 1;
  const warnings: string[] = [];
  if (sol && !sol.validated) conf = 0.8;
  if (sol?.f) conf = Math.min(conf, 0.9);
  if (!sol) {
    // Reparaciones de OCR (decimales perdidos, números partidos) validadas por la aritmética
    let bestRep: Solution | undefined;
    for (const v of repairVariants(toks, row)) {
      const s = solveTokens(v, { header });
      if (s && s.validated && (!bestRep || s.score > bestRep.score)) bestRep = s;
    }
    if (bestRep) {
      sol = bestRep;
      conf = 0.85;
    }
  }
  if (sol) {
    if ([sol.q, sol.p, sol.t, ...sol.d].some((t) => t.n.fixed)) conf = Math.min(conf, 0.85);
    return { line: buildLine(row, codeEnd, code, sol, toks, conf, warnings) };
  }
  if (!inTable || !hasText) return { textOnly: hasText && toks.every((t) => t.inDesc) };

  // Sin validación: asignación plausible por columnas o por orden
  const tail = toks.filter((t) => !t.inDesc && !t.n.pct);
  const pctToks = toks.filter((t) => !t.inDesc && t.n.pct);
  let q: NumTok | undefined;
  let p: NumTok | undefined;
  let t: NumTok | undefined;
  let d: NumTok | undefined;
  if (header?.positional) {
    q = tail.find((x) => x.col === 'qty') ?? tail.find((x) => x.col === 'bultos');
    p = tail.find((x) => x.col === 'price');
    t = [...tail].reverse().find((x) => x.col === 'total');
    d = toks.find((x) => x.col === 'disc');
  }
  let rest = tail.filter((x) => x !== q && x !== p && x !== t);
  if (rest.length >= 3 && isVatRateValue(rest[rest.length - 1].n) && !t) rest = rest.slice(0, -1);
  if (!t) t = rest.pop();
  if (!p) p = rest.filter((x) => !t || x.wi < t.wi).pop();
  if (!q) q = rest.filter((x) => x !== p && (!p || x.wi < p.wi)).pop();
  if (!d) d = pctToks.find((x) => (!p || x.wi > p.wi) && (!t || x.wi < t.wi));
  if (!t) return { textOnly: true };
  const fake = (value: number, like: NumTok): NumTok => ({ ...like, value, n: { ...like.n, value, dec: 2, fixed: undefined } });
  let confidence = 0.6;
  if (!p && !q) {
    // Sólo el importe: cantidad 1
    if (!(t.n.dec === 2 || t.n.cur)) return { textOnly: true };
    q = fake(1, t);
    p = fake(t.value, t);
    confidence = 0.4;
    warnings.push('Sólo se ha leído el importe: revisa la cantidad y el precio');
  } else if (!p && q) {
    p = fake(round(t.value / q.value, 4), q);
    confidence = 0.5;
    warnings.push('Precio calculado a partir del importe y la cantidad');
  } else if (p && !q) {
    q = fake(round(t.value / p.value, 3), p);
    confidence = 0.5;
    warnings.push('Cantidad calculada a partir del importe y el precio');
  }
  const solution: Solution = { q: q as NumTok, p: p as NumTok, t, d: d ? [d] : [], err: Infinity, validated: false, loose: false, score: 0 };
  const line = buildLine(row, codeEnd, code, solution, toks, confidence, warnings);
  line.validated = false;
  return { line };
}

// ───────────────────────────── Cabecera del documento ─────────────────────────────

const CIF_RE = /\b(?:ES[\s-]?)?([ABCDEFGHJKLMNPQRSUVW])[\s-]?(\d{7})[\s-]?([0-9A-J])\b/g;
const NIF_RE = /\b(?:ES[\s-]?)?(\d{8})[\s-]?([A-Z])\b/g;
const NIE_RE = /\b([XYZ])[\s-]?(\d{7})[\s-]?([A-Z])\b/g;

export function validCif(cif: string): boolean {
  const m = /^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/.exec(cif);
  if (!m) return false;
  const digits = m[2];
  let sum = 0;
  for (let k = 0; k < 7; k++) {
    const d = Number(digits[k]);
    if (k % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else sum += d;
  }
  const control = (10 - (sum % 10)) % 10;
  const letter = 'JABCDEFGHI'[control];
  const c = m[3];
  if ('PQRSNW'.includes(m[1])) return c === letter;
  if ('ABEH'.includes(m[1])) return c === String(control);
  return c === letter || c === String(control);
}

export function validNif(nif: string): boolean {
  const m = /^(\d{8})([A-Z])$/.exec(nif) ?? /^([XYZ]\d{7})([A-Z])$/.exec(nif);
  if (!m) return false;
  const num = Number(m[1].replace('X', '0').replace('Y', '1').replace('Z', '2'));
  return 'TRWAGMYFPDXBNJZSQVHLCKE'[num % 23] === m[2];
}

interface TaxIdHit {
  id: string;
  row: number;
  x: number;
  valid: boolean;
}

function findTaxIds(rows: Row[]): TaxIdHit[] {
  const out: TaxIdHit[] = [];
  for (const row of rows) {
    const text = row.text.toUpperCase();
    const push = (id: string, index: number, valid: boolean) => {
      if (out.some((h) => h.id === id && h.row === row.i)) return;
      const w = row.words.find((wd) => row.positional ? false : wd.x0 <= index && index < wd.x1 + 1);
      const x = row.positional ? xAtChar(row, index) : (w?.x0 ?? index);
      out.push({ id, row: row.i, x, valid });
    };
    let m: RegExpExecArray | null;
    CIF_RE.lastIndex = 0;
    while ((m = CIF_RE.exec(text))) {
      const id = `${m[1]}${m[2]}${m[3]}`;
      push(id, m.index, validCif(id));
    }
    NIF_RE.lastIndex = 0;
    while ((m = NIF_RE.exec(text))) {
      const id = `${m[1]}${m[2]}`;
      push(id, m.index, validNif(id));
    }
    NIE_RE.lastIndex = 0;
    while ((m = NIE_RE.exec(text))) {
      const id = `${m[1]}${m[2]}${m[3]}`;
      push(id, m.index, validNif(id));
    }
  }
  return out;
}

/** X aproximada de un desplazamiento de carácter en una fila posicional (vía palabras). */
function xAtChar(row: Row, charIndex: number): number {
  let acc = 0;
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(row.text)) && k < row.words.length) {
    if (m.index + m[0].length > charIndex) return row.words[k]?.x0 ?? acc;
    acc = row.words[k]?.x1 ?? acc;
    k++;
  }
  return acc;
}

const CUSTOMER_RE =
  /\b(?:cliente|destinatario|facturar\s*a|facturado\s*a|datos\s*(?:del\s*)?cliente|enviar\s*a|entregar\s*a|direccion\s*(?:de\s*)?(?:entrega|envio)|lugar\s*de\s*entrega|comprador|receptor|sr\.|sres\.|senor(?:es)?|attn|a\/a)\b/;
const SUPPLIER_LABEL_RE = /\b(?:proveedor|emisor|vendedor|razon\s*social|expedidor)\b\s*[:.]?/;

interface Segment {
  text: string;
  row: number;
  x0: number;
  x1: number;
}

function segmentsOf(row: Row): Segment[] {
  const out: Segment[] = [];
  if (row.positional) {
    // Agrupar palabras separadas por huecos de columna
    let cur: Segment | undefined;
    for (const w of row.words) {
      if (cur && w.x0 - cur.x1 <= row.cw * 1.6) {
        cur.text += ` ${w.raw}`;
        cur.x1 = w.x1;
      } else {
        if (cur) out.push(cur);
        cur = { text: w.raw, row: row.i, x0: w.x0, x1: w.x1 };
      }
    }
    if (cur) out.push(cur);
    return out;
  }
  const re = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(row.text))) out.push({ text: m[0], row: row.i, x0: m.index, x1: m.index + m[0].length });
  return out;
}

const COMPANY_SUFFIX_RE = /(?:^|[\s,.])(?:s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?coop\.?(?:\s*and\.?)?|sociedad\s*(?:limitada|anonima|cooperativa)|c\.?\s?b\.?|s\.?\s?c\.?|s\.?\s?l\.?\s?l\.?|slu|sau)\s*$/;
const BUSINESS_RE =
  /\b(?:distribuciones|distribucion|distribuidora|comercial|mayorista|mayoristas|frutas|verduras|hortalizas|carnes|carniceria|pescados|mariscos|bebidas|hermanos|hnos|hijos|grupo|alimentacion|alimentos|alimentaria|suministros|cash|carry|lacteos|panaderia|obrador|bodegas?|vinos|congelados|hosteleria|horeca|cooperativa|makro|mercadona|conservas|embutidos|charcuteria|quesos|aceites|almazara|cafes|importaciones|exclusivas|productos)\b/;
const NOT_NAME_RE =
  /^(?:factura|fra\b|albaran|ticket|original|copia|duplicado|pagina|pag\b|hoja|fecha|n[ºo°]|numero|num\b|cliente|datos|pedido|forma\s*de\s*pago|vencimiento|c\.?i\.?f|n\.?i\.?f|dni|tel|tlf|telf|telefono|movil|fax|email|e-mail|correo|web|www|http|iban|swift|bic|cuenta|entidad|domicilio|direccion|codigo|cod\b|serie|documento|simplificada|rectificativa|proforma|presupuesto|agente|ruta|vendedor|repartidor|hora|caja\b|terminal|operador|atendido|descripcion|concepto|cantidad|precio|importe|total|base|iva|inscrita|registro|r\.?m\.?|tomo|folio|seccion)\b/;
const ADDRESS_RE =
  /^(?:c\/|c\.\s|calle|avda|avenida|av\.|pza|plaza|paseo|ps\.|pso|ctra|carretera|pol\.|poligono|pg\.|p\.i\.|nave|camino|cmno|ronda|urb\.|urbanizacion|apartado|apdo|cp\b|c\.p\.|travesia|trav\.|glorieta|parque|mercado|mercamadrid|mercabarna|merca\w+|parcela|parc\.|local|edificio|edif\.|km\b|bloque|portal|piso)\b/;

function supplierNameScore(seg: Segment, idx: number, supplierIdRow: number | undefined, customerRows: Set<number>, customerX?: number): number {
  const t = collapseSpaces(seg.text);
  const f = fold(t);
  const letters = f.replace(/[^a-z]/g, '').length;
  if (letters < 3) return -Infinity;
  if (NOT_NAME_RE.test(f) || ADDRESS_RE.test(f)) return -Infinity;
  if (/@|www\.|https?:|\.com\b|\.es\b/.test(f)) return -Infinity;
  if (/\b\d{5}\b/.test(f) && !COMPANY_SUFFIX_RE.test(f)) return -Infinity;
  if (/\b[69]\d{2}[\s.]?\d{2,3}[\s.]?\d{2,3}[\s.]?\d{0,3}\b/.test(f)) return -Infinity;
  if (customerRows.has(seg.row) && (customerX === undefined || seg.x0 >= customerX - 5)) return -Infinity;
  let score = 0;
  if (COMPANY_SUFFIX_RE.test(f)) score += 6;
  if (BUSINESS_RE.test(f)) score += 2;
  score += Math.max(0, 4 - idx);
  if (supplierIdRow !== undefined) {
    const d = supplierIdRow - seg.row;
    if (d >= 0 && d <= 2) score += 3 - d;
  }
  const words = t.split(' ').length;
  if (words >= 2 && words <= 8) score += 1;
  if (t.length > 60) score -= 3;
  if (/\d/.test(t)) score -= 2;
  if (/:$/.test(t)) score -= 4;
  return score;
}

function cleanName(s: string): string {
  return collapseSpaces(
    s
      .replace(/\b(?:C\.?I\.?F|N\.?I\.?F|DNI|NIF\/CIF|CIF\/NIF)\.?\s*[:.]?\s*(?:ES)?[A-Z0-9-]{8,11}\b.*$/i, '')
      .replace(SUPPLIER_LABEL_RE, '')
      .replace(/^[\s·•|:,.-]+|[\s·•|:,-]+$/g, ''),
  );
}

const NS = '(?:n\\.?\\s?[ºo°]|num(?:ero)?|nro|n)\\.?';
const INVOICE_NUMBER_LABEL = new RegExp(
  [
    `\\b${NS}\\s*(?:de\\s*)?(?:factura|fra\\.?|documento|doc\\.?|ticket)\\b`,
    `\\b(?:factura|fra\\.?)\\s*(?:simplificada\\s*|rectificativa\\s*)?(?:${NS})?(?=[\\s:#.]|$)`,
    `\\b(?:documento|doc\\.|ticket|invoice)\\s*(?:${NS}|no\\.?|number|#)?`,
    `\\bnumero\\b`,
    `\\bn\\.?\\s?[ºo°]\\.?(?=\\s*[:.]?\\s*[a-z]{0,4}[-/]?\\d)`,
  ]
    .map((p) => `(?:${p})`)
    .join('|') + '\\s*[:#.]?\\s*',
  'g',
);
const NUMBER_NEG = /(?:cliente|pedido|albaran|cuenta|proveedor|lote|telefono|registro|pagina|hoja|agente|ruta|vendedor|caja|terminal|operacion|tarjeta|autorizacion|s\/ref|serie)\W*$/;

function extractInvoiceNumber(rows: Row[]): string | undefined {
  let best: { value: string; score: number; row: Row } | undefined;
  rows.forEach((row, ri) => {
    const text = row.text;
    const f = foldKeepLength(text);
    INVOICE_NUMBER_LABEL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INVOICE_NUMBER_LABEL.exec(f))) {
      if (m[0].length === 0) {
        INVOICE_NUMBER_LABEL.lastIndex++;
        continue;
      }
      const label = m[0];
      const strong = /factura|fra|invoice|ticket|documento|doc/.test(label);
      const before = f.slice(Math.max(0, m.index - 12), m.index);
      if (!strong && NUMBER_NEG.test(before)) continue;
      if (/(?:cliente|pedido|albaran|proveedor)\s*$/.test(before) && !/factura/.test(label)) continue;
      let score = /factura|fra/.test(label) ? (new RegExp(NS).test(label.replace(/factura|fra/, '')) ? 10 : 7) : /documento|doc|invoice|ticket/.test(label) ? 6 : 4;
      const rest = text.slice(m.index + label.length);
      const tok = /^([A-Za-z]{0,6}[-/.]?\d[A-Za-z0-9\-/._]*|\d[A-Za-z0-9\-/._]*)/.exec(rest);
      let value = tok?.[1];
      if (!value || !/\d/.test(value)) {
        // Valor en la fila siguiente, bajo la etiqueta
        const next = rows[ri + 1];
        if (!next) continue;
        const labelX = row.positional ? xAtChar(row, m.index) : m.index;
        const cand = next.words
          .filter((w) => /\d/.test(w.raw) && !parseDateEs(w.raw) && !/^\d{1,2}:\d{2}/.test(w.raw) && w.raw.replace(/[^\dA-Za-z]/g, '').length >= 3)
          .map((w) => ({ w, d: Math.abs(w.x0 - labelX) }))
          .sort((a, b) => a.d - b.d)[0];
        if (!cand || cand.d > (row.positional ? 60 : 12)) continue;
        value = cand.w.raw;
        score -= 3;
      }
      value = value.replace(/[.,:;]+$/, '');
      if (parseDateEs(value) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(value) || /^\d{1,2}:\d{2}/.test(value)) continue;
      if (/^(?:ES)?[A-Z]\d{7}[0-9A-J]$/i.test(value) || /^\d{8}[A-Z]$/i.test(value)) continue;
      if (value.replace(/[^\d]/g, '').length < 1 || value.length > 30) continue;
      if (ri < 15) score += 1;
      if (!best || score > best.score) best = { value, score, row };
    }
  });
  if (!best) return undefined;
  // Serie aparte: "Serie F  Número 2026/1452" → "F-2026/1452"
  const serie = /\bserie\s*[:.]?\s*([A-Z0-9]{1,4})\b/i.exec(best.row.text);
  if (serie && !best.value.toUpperCase().startsWith(serie[1].toUpperCase()) && serie[1] !== best.value) return `${serie[1]}-${best.value}`;
  return best.value;
}

interface HeaderInfo {
  supplierName?: string;
  supplierTaxId?: string;
  number?: string;
  date?: string;
}

function parseDocHeader(rows: Row[], headerEnd: number, allRows: Row[], excludeRows: Set<number>): HeaderInfo {
  const zone = rows.slice(0, Math.max(1, headerEnd));
  // Bloque del cliente
  const customerRows = new Set<number>();
  let customerX: number | undefined;
  zone.forEach((row) => {
    const m = CUSTOMER_RE.exec(row.f);
    if (!m) return;
    const x = row.positional ? xAtChar(row, m.index) : m.index;
    customerX = customerX === undefined ? x : Math.min(customerX, x);
    for (let k = row.i; k <= row.i + 4 && k < allRows.length; k++) customerRows.add(k);
  });
  const isCustomerPos = (rowIdx: number, x: number) => {
    if (!customerRows.has(rowIdx)) return false;
    const row = allRows[rowIdx];
    const m = CUSTOMER_RE.exec(row.f);
    if (m) {
      const lx = row.positional ? xAtChar(row, m.index) : m.index;
      return x >= lx - 2;
    }
    return customerX === undefined || x >= customerX - (allRows[rowIdx].positional ? 40 : 6);
  };

  // CIF / NIF del proveedor
  const zoneIds = findTaxIds(zone);
  const allIds = zoneIds.length ? zoneIds : findTaxIds(allRows.filter((r) => !excludeRows.has(r.i)));
  let supplierTaxId: string | undefined;
  let supplierIdRow: number | undefined;
  {
    let best: { hit: TaxIdHit; score: number } | undefined;
    for (const hit of allIds) {
      let score = 0;
      const row = allRows[hit.row];
      if (isCustomerPos(hit.row, hit.x)) score -= 10;
      if (/\b(?:c\.?i\.?f|n\.?i\.?f|nif\/cif|vat)\b/.test(row.f)) score += 2;
      if (SUPPLIER_LABEL_RE.test(row.f)) score += 4;
      if (hit.row < 8) score += 2;
      if (hit.valid) score += 2;
      score -= hit.row * 0.05;
      if (!best || score > best.score) best = { hit, score };
    }
    if (best && best.score > -5) {
      supplierTaxId = best.hit.id;
      supplierIdRow = best.hit.row;
    }
  }

  // Razón social
  let supplierName: string | undefined;
  for (const row of zone) {
    const m = SUPPLIER_LABEL_RE.exec(row.f);
    if (m) {
      const after = cleanName(row.text.slice(m.index + m[0].length));
      if (after && /\p{L}{3}/u.test(after)) {
        supplierName = after;
        break;
      }
    }
  }
  if (!supplierName) {
    let best: { seg: Segment; score: number } | undefined;
    zone.slice(0, 16).forEach((row, idx) => {
      for (const seg of segmentsOf(row)) {
        const cleaned: Segment = { ...seg, text: cleanName(seg.text) };
        if (!cleaned.text) continue;
        const s = supplierNameScore(cleaned, idx, supplierIdRow, customerRows, customerX);
        if (s > (best?.score ?? 1)) best = { seg: cleaned, score: s };
      }
    });
    supplierName = best?.seg.text;
  }

  const number = extractInvoiceNumber(zone.length > 2 ? zone : allRows.slice(0, 20));
  const headerText = zone.filter((r) => !META_ANY_RE.test(r.f)).map((r) => r.text).join('\n');
  const date = findDate(headerText) ?? findDate(allRows.filter((r) => !excludeRows.has(r.i) && !META_ANY_RE.test(r.f)).map((r) => r.text).join('\n'));
  return { supplierName: supplierName || undefined, supplierTaxId, number, date };
}

// ───────────────────────────── Totales ─────────────────────────────

interface Totals {
  subtotal?: number;
  vatTotal?: number;
  reTotal?: number;
  total?: number;
  globalDiscount?: number;
  rates: number[];
  vatCodes: Record<string, number>;
}

const TOTAL_LABELS =
  /(?<base>base\s*imp(?:onible)?\.?|b\.\s*imp(?:onible)?|total\s*base|bases?\s*imponibles?|base\s*i\.?v\.?a\.?|imponible)|(?<disc>dto\.?\s*(?:pronto\s*pago|p\.?\s*p\.?|comercial|global|factura)|descuento\s*(?:pronto\s*pago|comercial|global|factura|general)|pronto\s*pago)|(?<sub>subtotal|sub-total|suma\s*importes|total\s*bruto|importe\s*bruto|total\s*neto|importe\s*neto|neto\s*factura|total\s*lineas|total\s*productos|total\s*articulos)|(?<re>recargo\s*(?:de\s*)?equivalencia|cuota\s*r\.?\s*e\.?|r\.\s*e\.|rec\.\s*eq\.?)|(?<vat>cuota\s*(?:de\s*)?i\.?v\.?a\.?|total\s*i\.?v\.?a\.?|importe\s*i\.?v\.?a\.?|i\.?v\.?a\.?|impuestos?)|(?<total>total\s*(?:factura|fra\.?|a\s*pagar|documento|general|eur(?:os)?|€|importe|con\s*i\.?v\.?a|iva\s*incluido)|importe\s*total|liquido(?:\s*a\s*pagar)?|a\s*pagar|total)/g;

function numbersIn(row: Row): NumTok[] {
  return row.words
    .map((w, wi) => (w.num ? { wi, w, n: w.num, value: w.num.value, inDesc: false, lead: false } : undefined))
    .filter((t): t is NumTok => !!t);
}

function parseTotals(rows: Row[]): Totals {
  const rates: number[] = [];
  const vatCodes: Record<string, number> = {};
  const triples: { base: number; rate: number; vat: number }[] = [];
  const reTriples: { base: number; rate: number; vat: number }[] = [];
  const labeled: Record<'base' | 'sub' | 'vat' | 're' | 'total' | 'disc', number[]> = { base: [], sub: [], vat: [], re: [], total: [], disc: [] };

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const nums = numbersIn(row);
    // Leyenda de códigos de IVA: "A 21%  B 10%  C 4%"
    const legendRe = /(?:^|\s)(?:IVA\s*)?([A-E])\s*[=:-]?\s*(?:IVA|iva)?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/g;
    let lm: RegExpExecArray | null;
    while ((lm = legendRe.exec(row.text))) {
      const r = parseNumberEs(lm[2]);
      if (r !== undefined && VAT_RATES.includes(r)) vatCodes[lm[1]] = r;
    }
    // Desglose por aritmética: base × tipo / 100 ≈ cuota
    for (const r of nums) {
      const isRate = VAT_RATES.includes(r.value) && r.value > 0 && r.n.dec <= 2;
      const isRe = RE_RATES.includes(r.value) && r.n.dec <= 2;
      if (!isRate && !isRe) continue;
      for (const b of nums) {
        if (b === r || b.value <= 0 || b.n.pct) continue;
        for (const c of nums) {
          if (c === r || c === b || c.n.pct) continue;
          if (c.value <= 0 || c.value >= b.value) continue;
          if (Math.abs((b.value * r.value) / 100 - c.value) <= 0.0151 && b.wi < c.wi) {
            const list = isRate && !(isRe && !r.n.pct && row.f.includes('r.e')) ? triples : reTriples;
            if (!list.some((x) => x.rate === r.value && approxEqual(x.base, b.value, 0.001, 0))) list.push({ base: b.value, rate: r.value, vat: c.value });
            const first = row.words[0]?.raw;
            if (first && /^[A-E]$/.test(first)) vatCodes[first] = r.value;
          }
        }
      }
    }
    // Etiquetas con valor
    const f = foldKeepLength(row.text);
    const labels: { kind: keyof typeof labeled; start: number; end: number; rate?: number }[] = [];
    TOTAL_LABELS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOTAL_LABELS.exec(f))) {
      const g = m.groups ?? {};
      const kind = (Object.keys(g) as (keyof typeof labeled)[]).find((k) => g[k] !== undefined);
      if (!kind) continue;
      // "Total" dentro de "Total base", ya capturado por su grupo
      labels.push({ kind, start: m.index, end: m.index + m[0].length });
    }
    labels.forEach((lab, li) => {
      const endLimit = labels[li + 1]?.start ?? Infinity;
      const inRange = row.positional
        ? nums.filter((t) => {
            const cs = charStartOf(row, t.wi);
            return cs >= lab.end && cs < endLimit;
          })
        : nums.filter((t) => t.w.x0 >= lab.end && t.w.x0 < endLimit);
      let vals = inRange;
      if ((lab.kind === 'vat' || lab.kind === 're') && vals.length) {
        // "IVA 10% 59,66" / "IVA (10%): 59,66" / "IVA 10,00 59,66"
        const rateTok = vals.find((t) => t.n.pct || (vals.length >= 2 && (VAT_RATES.includes(t.value) || RE_RATES.includes(t.value)) && t === vals[0]));
        if (rateTok) {
          lab.rate = rateTok.value;
          vals = vals.filter((t) => t !== rateTok);
          // "IVA 10% s/ 120,00  12,00": la cuota es el último
          if (vals.length >= 2) vals = [vals[vals.length - 1]];
        }
      }
      vals = vals.filter((t) => !t.n.pct);
      let value = vals[0]?.value;
      if (value === undefined && ri + 1 < rows.length) {
        // Valor debajo de la etiqueta (tabla de totales)
        const next = rows[ri + 1];
        const lx = row.positional ? xAtChar(row, lab.start) : lab.start;
        const lxEnd = row.positional ? xAtChar(row, Math.max(lab.start, lab.end - 1)) + row.cw : lab.end;
        const cand = numbersIn(next)
          .filter((t) => !t.n.pct)
          .map((t) => ({ t, d: Math.max(0, lx - t.w.x1, t.w.x0 - lxEnd) }))
          .sort((a, b) => a.d - b.d)[0];
        if (cand && cand.d <= (row.positional ? row.cw * 6 : 6)) value = cand.t.value;
      }
      if (value === undefined) return;
      labeled[lab.kind].push(Math.abs(value));
      if (lab.kind === 'vat' && lab.rate !== undefined && VAT_RATES.includes(lab.rate) && !rates.includes(lab.rate)) rates.push(lab.rate);
    });
  }

  for (const t of triples) if (!rates.includes(t.rate)) rates.push(t.rate);
  const sum = (a: number[]) => round(a.reduce((s, v) => s + v, 0), 2);
  const triBase = triples.length ? sum(triples.map((t) => t.base)) : undefined;
  const triVat = triples.length ? sum(triples.map((t) => t.vat)) : undefined;
  const triRe = reTriples.length ? sum(reTriples.map((t) => t.vat)) : undefined;

  const baseCands = [...new Set([...(triBase !== undefined ? [triBase] : []), ...labeled.base, ...(labeled.base.length > 1 ? [sum(labeled.base)] : []), ...labeled.sub])];
  const vatCands = [...new Set([...(triVat !== undefined ? [triVat] : []), ...(labeled.vat.length > 1 ? [sum(labeled.vat)] : []), ...labeled.vat, 0])];
  const reCands = [...new Set([...(triRe !== undefined ? [triRe] : []), ...labeled.re, 0])];
  const totalCands = [...new Set(labeled.total)].sort((a, b) => b - a);

  let subtotal: number | undefined;
  let vatTotal: number | undefined;
  let reTotal: number | undefined;
  let total: number | undefined;
  search: for (const T of totalCands) {
    for (const S of baseCands) {
      for (const V of vatCands) {
        for (const R of reCands) {
          if (V === 0 && R === 0 && S !== T) continue;
          if (approxEqual(S + V + R, T, 0.021, 0.0005)) {
            subtotal = S;
            vatTotal = V;
            reTotal = R || undefined;
            total = T;
            break search;
          }
        }
      }
    }
  }
  if (total === undefined) {
    subtotal = triBase ?? labeled.base[0] ?? labeled.sub[0];
    vatTotal = triVat ?? (labeled.vat.length ? sum(labeled.vat) : undefined);
    reTotal = triRe ?? labeled.re[0];
    if (subtotal !== undefined && vatTotal !== undefined) {
      const computed = round(subtotal + vatTotal + (reTotal ?? 0), 2);
      total = totalCands.find((T) => approxEqual(T, computed, 0.05, 0.001)) ?? computed;
    } else if (totalCands.length) {
      total = totalCands[0];
      if (subtotal === undefined && vatTotal !== undefined) subtotal = round(total - vatTotal - (reTotal ?? 0), 2);
      if (vatTotal === undefined && subtotal !== undefined && subtotal <= total) vatTotal = round(total - subtotal - (reTotal ?? 0), 2);
    }
  }
  return { subtotal, vatTotal, reTotal, total, globalDiscount: labeled.disc[0], rates, vatCodes };
}

/** Desplazamiento de carácter de una palabra en el texto de su fila. */
function charStartOf(row: Row, wi: number): number {
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(row.text))) {
    if (k === wi) return m.index;
    k++;
  }
  return row.text.length;
}

// ───────────────────────────── Parser principal ─────────────────────────────

function buildRows(input: { text: string; lines?: string[] }, method: 'pdf-texto' | 'ocr', pdfLines?: PdfTextLine[]): Row[] {
  const allowOcr = method === 'ocr';
  if (pdfLines && pdfLines.length) {
    return pdfLines.map((l, i) => {
      const line = allowOcr ? { ...l, text: cleanOcrText(l.text), items: l.items.map((it) => ({ ...it, str: cleanOcrText(it.str) })) } : l;
      return rowFromPdf(line, i, allowOcr);
    });
  }
  const lines = input.lines ?? input.text.split(/\r?\n/);
  return lines.map((l, i) => rowFromText(allowOcr ? cleanOcrText(l.replace(/\t/g, '    ')) : l.replace(/\t/g, '    '), i, allowOcr));
}

/** Fila de desglose de IVA: base × tipo / 100 ≈ cuota, o leyenda "A = IVA 21 %". */
function isVatSummaryRow(row: Row): boolean {
  if (/(?:^|\s)[A-E]\s*[=:]\s*(?:iva\s*)?\d{1,2}(?:[.,]\d{1,2})?\s*%/i.test(row.text)) return true;
  const nums = numbersIn(row);
  if (nums.length < 3 || nums.length > 6) return false;
  const texty = row.words.filter((w) => isTexty(w));
  if (texty.some((w) => !/^(?:iva|tipo|base|cuota|total|bases|re|r\.e\.)$/.test(w.f)) && texty.length > 1) return false;
  for (const r of nums) {
    if (!(VAT_RATES.includes(r.value) && r.value > 0 && r.n.dec <= 2)) continue;
    for (const b of nums) {
      if (b === r || b.value <= 0) continue;
      for (const c of nums) {
        if (c === r || c === b || c.value <= 0) continue;
        if (b.wi < c.wi && Math.abs((b.value * r.value) / 100 - c.value) <= 0.0151) return true;
      }
    }
  }
  return false;
}

function isStopRow(row: Row): boolean {
  const f = row.f.trim();
  if (!f) return false;
  if (DISCOUNT_ROW_RE.test(f.replace(/^[\d\s.-]+/, '')) && !/pronto\s*pago/.test(f)) return false;
  if (STOP_RE.test(f)) return true;
  // Cabecera del cuadro de IVA: "Tipo  Base  %IVA  Cuota"
  if (/\b(?:base|bases)\b/.test(f) && /\b(?:cuota|iva)\b/.test(f) && !row.words.some((w) => w.num && !w.num.pct)) return true;
  return isVatSummaryRow(row);
}

function isMetaRow(row: Row): boolean {
  const f = row.f.trim();
  if (META_RE.test(f)) return true;
  if (SCIENTIFIC_RE.test(row.text.trim()) && !row.words.some((w) => w.num && !w.num.pct && w.num.dec === 2)) return true;
  // "Lote: 23/456  Cad: 12/05/2025" en medio de la fila, sin importe
  if (META_ANY_RE.test(f) && !row.words.some((w) => w.num && w.num.dec === 2)) return true;
  if (/^(?:pagina|pag\.?|hoja)\s*\d+/.test(f) || /\bpagina\s*\d+\s*(?:de|\/)\s*\d+/.test(f)) return true;
  return false;
}

/** Puntuación de calidad de una extracción (para elegir entre pasadas de OCR). */
export function invoiceQuality(inv: ExtractedInvoice): number {
  const validated = inv.lines.filter((l) => (l.confidence ?? 0) >= 0.8).length;
  const weak = inv.lines.length - validated;
  const sum = inv.lines.reduce((s, l) => s + (l.total || 0), 0);
  const sumOk = inv.subtotal !== undefined && approxEqual(sum, inv.subtotal, 0.05, 0.005);
  return validated * 10 - weak * 3 + (sumOk ? 25 : 0) + (inv.supplierName ? 2 : 0) + (inv.date ? 2 : 0) + (inv.total !== undefined ? 2 : 0);
}

export function parseInvoiceText(input: { text: string; lines?: string[] }, method: 'pdf-texto' | 'ocr', pdfLines?: PdfTextLine[]): ExtractedInvoice {
  const rows = buildRows(input, method, pdfLines);
  const rawText = input.text || rows.map((r) => r.text).join('\n');
  const warnings: string[] = [];

  // 1) Zonas: cabeceras de tabla y filas de cierre
  const headers = new Map<number, TableHeader>();
  for (const row of rows) {
    const h = detectTableHeader(row);
    if (h) headers.set(row.i, h);
  }
  const firstHeader = headers.size ? Math.min(...headers.keys()) : -1;

  // 2) Recorrido de filas
  const parsed: ParsedLine[] = [];
  const extras: { description: string; amount: number }[] = [];
  const excluded = new Set<number>();
  let header: TableHeader | undefined;
  let state: 'pre' | 'table' | 'post' | 'paused' = firstHeader >= 0 ? 'pre' : 'table';
  let pending: Row[] = [];
  let lastLineRow = -1;
  let tableEnd = -1;

  const flushPendingInto = (target: ParsedLine | undefined) => {
    if (!pending.length) return;
    if (target) {
      const extra = pending.map((r) => collapseSpaces(r.text)).join(' ');
      target.description = collapseSpaces(`${target.description} ${extra}`);
      target.rows.push(...pending.map((r) => r.i));
    }
    pending = [];
  };

  for (const row of rows) {
    const f = row.f.trim();
    if (!f) continue;
    const h = headers.get(row.i);
    if (h) {
      flushPendingInto(parsed[parsed.length - 1]);
      header = h;
      state = 'table';
      excluded.add(row.i);
      continue;
    }
    if (state === 'pre') continue;
    if (PAUSE_RE.test(f)) {
      flushPendingInto(parsed[parsed.length - 1]);
      state = 'paused';
      excluded.add(row.i);
      continue;
    }
    if (state === 'paused') {
      if (RESUME_RE.test(f)) state = 'table';
      excluded.add(row.i);
      continue;
    }
    if (RESUME_RE.test(f)) {
      excluded.add(row.i);
      continue;
    }
    if (isStopRow(row)) {
      flushPendingInto(parsed[parsed.length - 1]);
      if (state === 'table') tableEnd = row.i;
      state = 'post';
      continue;
    }
    if (state === 'post' && firstHeader >= 0) continue;
    if (isMetaRow(row)) {
      excluded.add(row.i);
      continue;
    }
    const inTable = firstHeader >= 0;
    const descPart = fold(row.text.replace(/^\s*\S*\d\S*\s+/, '')).trim();
    // Portes, envases, fianzas: fuera de las líneas pero cuentan en el cuadre
    const codeless = leadingCode(row.words).end ? fold(row.words.slice(leadingCode(row.words).end).map((w) => w.raw).join(' ')) : fold(row.text.trim());
    if (EXTRA_RE.test(codeless) || EXTRA_RE.test(descPart)) {
      const nums = numbersIn(row).filter((t) => !t.n.pct);
      const money = nums.filter((t) => t.n.dec === 2 || t.n.cur);
      const amount = money.length ? money[money.length - 1].value : nums.length ? nums[nums.length - 1].value : 0;
      if (amount) extras.push({ description: collapseSpaces(row.text), amount });
      excluded.add(row.i);
      continue;
    }
    // Descuento en línea aparte ("DTO PROMO  -1,19")
    if (DISCOUNT_ROW_RE.test(codeless) && parsed.length && lastLineRow >= 0) {
      const nums = numbersIn(row).filter((t) => !t.n.pct);
      const pctTok = numbersIn(row).find((t) => t.n.pct);
      const amountTok = nums[nums.length - 1];
      const prev = parsed[parsed.length - 1];
      if (amountTok && Math.abs(amountTok.value) < Math.abs(prev.total)) {
        const gross = prev.total;
        prev.total = round(gross - Math.abs(amountTok.value), 2);
        const base = prev.quantity * prev.unitPrice;
        prev.discountPct = base > 0 ? round((1 - prev.total / base) * 100, 2) : pctTok?.value;
        prev.rows.push(row.i);
        excluded.add(row.i);
        continue;
      }
    }
    const res = parseRow(row, header, inTable);
    if (res.line) {
      const line = res.line;
      // Sin cabecera de tabla, sólo filas validadas y con descripción
      if (firstHeader < 0 && (!line.validated || line.description.replace(/[^\p{L}]/gu, '').length < 3)) {
        pending = [];
        continue;
      }
      if (pending.length) {
        const shortDesc = line.description.replace(/[^\p{L}]/gu, '').length < 3;
        if (shortDesc) {
          // La descripción estaba en la(s) fila(s) anterior(es)
          line.description = collapseSpaces(`${pending.map((r) => r.text).join(' ')} ${line.description}`);
          line.rows.unshift(...pending.map((r) => r.i));
          pending = [];
        } else {
          const prev = parsed[parsed.length - 1];
          const sectionLike = pending.length === 1 && isAllCaps(pending[0].text) && pending[0].words.length <= 3 && !pending[0].words.some((w) => w.num);
          if (prev && !sectionLike) flushPendingInto(prev);
          else pending = [];
        }
      }
      parsed.push(line);
      lastLineRow = row.i;
      continue;
    }
    if (res.textOnly && parsed.length + 1 > 0 && (state === 'table' || firstHeader < 0)) {
      // Posible continuación de la descripción anterior (o anticipo de la siguiente)
      if (firstHeader < 0 && !parsed.length) continue;
      const prev = parsed[parsed.length - 1];
      const tooFar = prev && row.i - prev.rows[prev.rows.length - 1] > 3 + pending.length;
      if (!tooFar && row.words.length <= 16) pending.push(row);
      continue;
    }
  }
  if (pending.length && parsed.length) {
    const prev = parsed[parsed.length - 1];
    const sectionLike = pending.every((r) => isAllCaps(r.text) && r.words.length <= 3);
    if (!sectionLike && pending[0].i - prev.rows[prev.rows.length - 1] <= 2) flushPendingInto(prev);
    pending = [];
  }

  // 3) Cabecera del documento y totales
  const firstLineRow = parsed.length ? Math.min(...parsed.flatMap((l) => l.rows)) : rows.length;
  const headerEnd = firstHeader >= 0 ? firstHeader : firstLineRow;
  const lineRows = new Set(parsed.flatMap((l) => l.rows));
  const lastRow = parsed.length ? Math.max(...parsed.flatMap((l) => l.rows)) : -1;
  const totalsFrom = tableEnd >= 0 ? tableEnd : lastRow + 1;
  const totalsRows = rows.filter((r) => r.i >= totalsFrom && !lineRows.has(r.i));
  const totals = parseTotals(totalsRows.length ? totalsRows : rows.filter((r) => !lineRows.has(r.i) && r.i >= headerEnd));
  const head = parseDocHeader(rows, headerEnd, rows, lineRows);

  // 4) IVA por código de línea
  for (const l of parsed) {
    if (l.vatPct === undefined && l.vatCode && totals.vatCodes[l.vatCode] !== undefined) l.vatPct = totals.vatCodes[l.vatCode];
  }
  if (totals.rates.length === 1) for (const l of parsed) if (l.vatPct === undefined) l.vatPct = totals.rates[0];

  // 5) Reparación con la base imponible: una línea sin validar que haga cuadrar la suma
  const extrasSum = round(extras.reduce((s, e) => s + e.amount, 0), 2);
  const lineSum = () => round(parsed.reduce((s, l) => s + l.total, 0), 2);
  const target = totals.subtotal !== undefined ? round(totals.subtotal - extrasSum + (totals.globalDiscount ?? 0), 2) : undefined;
  if (target !== undefined && !approxEqual(lineSum(), target, 0.02, 0.001)) {
    const weak = parsed.filter((l) => !l.validated);
    if (weak.length === 1) {
      const l = weak[0];
      const needed = round(target - (lineSum() - l.total), 2);
      const row = rows[l.row];
      const { end: codeEnd, code } = leadingCode(row.words);
      const toks = numTokens(row, codeEnd, header);
      const variants = [toks, ...repairVariants(toks, row)];
      for (const v of variants) {
        const extraTok: NumTok[] = v.some((t) => approxEqual(t.value, needed, 0.011, 0.001)) ? [] : [];
        const sol = solveTokens([...v, ...extraTok], { header, targetTotal: needed });
        if (sol && sol.validated) {
          const fixedLine = buildLine(row, codeEnd, code, sol, v, 0.8, ['Corregida para cuadrar con la base imponible']);
          fixedLine.description = l.description;
          fixedLine.rows = l.rows;
          Object.assign(l, fixedLine);
          break;
        }
      }
    }
  }

  // 6) Precios con IVA incluido (tickets / facturas simplificadas)
  let vatIncluded = false;
  if (parsed.length && totals.total !== undefined && totals.subtotal !== undefined && (totals.vatTotal ?? 0) > 0) {
    const s = lineSum() + extrasSum;
    if (!approxEqual(s, totals.subtotal, 0.02, 0.002) && approxEqual(s, totals.total, 0.03, 0.002)) {
      vatIncluded = true;
      const ratio = totals.subtotal / totals.total;
      for (const l of parsed) {
        const factor = l.vatPct !== undefined && totals.rates.length > 1 ? 1 / (1 + l.vatPct / 100) : ratio;
        l.unitPrice = round(l.unitPrice * factor, 4);
        l.total = round(l.total * factor, 2);
      }
      warnings.push('Los precios del documento incluían IVA: se han convertido a precios sin IVA');
    }
  }

  // 7) Salida
  const lines: Line[] = parsed.map((l) => {
    const base = {
      description: l.description || 'Producto sin descripción',
      code: l.code,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      total: l.total,
      vatPct: l.vatPct,
      confidence: l.confidence,
      warnings: l.warnings,
    } satisfies Partial<InvoiceLine>;
    const norm = normalizeInvoiceLine(base);
    const clean: Line = { ...norm, suggestedName: cleanProductName(l.description) || undefined };
    if (clean.discountPct === undefined) delete clean.discountPct;
    if (clean.code === undefined) delete clean.code;
    if (clean.vatPct === undefined) delete clean.vatPct;
    return clean;
  });

  if (!lines.length) warnings.push('No se han encontrado líneas de producto: revisa el documento o añádelas a mano');
  const weakCount = lines.filter((l) => (l.confidence ?? 1) < 0.8).length;
  if (weakCount) warnings.push(weakCount === 1 ? '1 línea no se ha podido validar (cantidad × precio ≠ importe): revísala' : `${weakCount} líneas no se han podido validar (cantidad × precio ≠ importe): revísalas`);
  if (extras.length) {
    warnings.push(`No se han importado como productos: ${extras.map((e) => `${collapseSpaces(e.description.replace(/[\d.,]+\s*€?/g, '')).slice(0, 40)} (${e.amount.toFixed(2).replace('.', ',')} €)`).join('; ')}`);
  }
  const sum = round(lines.reduce((s, l) => s + l.total, 0) + extrasSum - (totals.globalDiscount ?? 0), 2);
  if (lines.length && totals.subtotal !== undefined && !approxEqual(sum, totals.subtotal, 0.02, 0.01) && !vatIncluded) {
    warnings.push(`La suma de las líneas (${sum.toFixed(2).replace('.', ',')} €) no cuadra con la base imponible (${totals.subtotal.toFixed(2).replace('.', ',')} €): puede faltar alguna línea`);
  }
  if (!head.date) warnings.push('No se ha encontrado la fecha de la factura');
  if (!head.supplierName) warnings.push('No se ha encontrado el nombre del proveedor');

  return {
    supplierName: head.supplierName,
    supplierTaxId: head.supplierTaxId,
    number: head.number,
    date: head.date,
    subtotal: totals.subtotal !== undefined ? round(totals.subtotal, 2) : undefined,
    vatTotal: totals.vatTotal !== undefined ? round(totals.vatTotal + (totals.reTotal ?? 0), 2) : undefined,
    total: totals.total !== undefined ? round(totals.total, 2) : undefined,
    lines,
    method,
    rawText,
    warnings,
  };
}
