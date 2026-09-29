import type { ExtractedInvoice, InvoiceLine } from '../types';
import { approxEqual, findDate, parseDateEs, parseNumberEs, round } from '../core/numbers';
import { normalizeInvoiceLine } from '../core/pack';
import { cleanProductName } from '../core/matching';
import type { PdfTextLine } from './pdf';
import { collapseSpaces, despaceLetters, fixOcrNumber, fold, foldKeepLength, fuzzyIn, median } from './textUtils';
import { fixOcrDescription, knownWord } from './ocrFixes';
import {
  buildTableModel,
  buildVotedModel,
  classifyLabel,
  columnIndex,
  headerPhrases,
  NUMERIC_KINDS,
  QTY_KINDS,
  stackHeaderRows,
  type ColumnKind,
  type HeaderPhrase,
  type RoleVote,
  type TableModel,
  type TRow,
  type TWord,
} from './tableModel';

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
  /** Corrección que cambia el valor (decimales perdidos, cifra mal leída): se avisa al usuario. Las letras por cifras ("1O,5O") no. */
  repaired?: boolean;
  /** Escrito como multiplicador ("x6"): es una cantidad. */
  mult?: boolean;
}

interface Word {
  raw: string;
  x0: number;
  x1: number;
  /** Plegado sin signos de borde. */
  f: string;
  num?: NumInfo;
  /** Celda de la fila (ítem de pdf.js, celda del OCR o bloque separado por 2+ espacios): misma celda ⇒ mismo índice. */
  seg: number;
}

interface Row {
  i: number;
  text: string;
  f: string;
  words: Word[];
  page: number;
  /** Posición vertical (de arriba a abajo; en texto plano, el número de fila). */
  y: number;
  /** true si las X son posiciones reales (pdf.js / OCR); false si son desplazamientos de carácter. */
  positional: boolean;
  /** Ancho medio de carácter en unidades de X. */
  cw: number;
  /** Texto de OCR (se permiten correcciones de cifras mal leídas validadas por la aritmética). */
  ocr?: boolean;
  /** Filas unidas a esta (artículos de cash & carry en dos filas, restos de una fila partida por el OCR). */
  absorbed?: number[];
}

type ColKind = ColumnKind;

interface HeaderCol {
  kind: ColKind;
  x0: number;
  x1: number;
  /** Etiqueta plegada ("cajas", "kilos"…), para deducir la unidad. */
  label: string;
}

interface TableHeader {
  row: number;
  /** Filas que forman la cabecera (etiquetas partidas en dos filas, cabeceras agrupadas). */
  rows: number[];
  /** Modelo de columnas deducido de los datos de su tabla (ver tableModel.ts). */
  model?: TableModel;
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
  /** La palabra anterior es texto (p. ej. "SACO 25KG"). */
  afterText?: boolean;
}

interface Solution {
  q: NumTok;
  p: NumTok;
  t: NumTok;
  d: NumTok[];
  /** Descuento en euros (columna "Dto. €"): importe = cantidad × precio − descuento. */
  dAmount?: NumTok;
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
  /** Palabras que ha usado la aritmética (para deducir las columnas de una tabla sin cabecera). */
  roles?: RoleVote[];
  /** OCR: cuadra sólo gracias a la tolerancia de redondeo (no al céntimo). */
  inexact?: boolean;
  /** OCR: lectura alternativa exacta al céntimo con una cifra corregida (ver `exactRefine`). */
  exactAlt?: { quantity: number; unitPrice: number };
  /** OCR: importe exacto (cantidad × precio) a una cifra de distancia del leído. */
  totalAlt?: number;
  /** Línea de cash & carry (código de unidad y columnas Prec. Ud. / Cont. / Precio / Cant. / Importe). */
  cc?: boolean;
  /** Unidades por envase de la columna de contenido ("Cont P." = 24 en una caja de 24 latas). */
  packCount?: number;
}

/** Porcentaje a 2 decimales, mitad hacia arriba sin el error de coma flotante (12,125 → 12,13, no 12,12). */
function pctRound(v: number): number {
  return (Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-7)) / 100;
}

function box(w: Word): { x0: number; x1: number } {
  return { x0: w.x0, x1: w.x1 };
}

/** Votos de columna de una solución: cantidad, precio, importe, descuentos, IVA y descripción. */
function solutionRoles(sol: Solution, words: Word[], descWords: Word[], vat?: Word): RoleVote[] {
  const out: RoleVote[] = [];
  const add = (t: NumTok, kind: ColumnKind) => {
    if (t.wi < words.length && words[t.wi] === t.w) out.push({ ...box(t.w), kind });
  };
  add(sol.q, 'qty');
  add(sol.p, 'price');
  add(sol.t, 'total');
  for (const d of sol.d) add(d, 'disc');
  if (vat) out.push({ ...box(vat), kind: 'vat' });
  // Sólo las palabras de verdad votan por la descripción (no lotes "L2506D", fechas ni códigos pegados a ella)
  for (const w of descWords) if (/\p{L}{2,}/u.test(w.raw) && !w.num) out.push({ ...box(w), kind: 'desc' });
  return out;
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
  ['qty', ['cantidad', 'cant', 'cantid', 'uds', 'unidades', 'unids', 'kilos', 'kgs', 'kg', 'litros', 'lts', 'peso', 'piezas', 'nuds', 'quantitat', 'qty', 'quantity', 'cantidades']],
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
  /(?:^|\s)(?:base\s*imp(?:onible)?|b\.\s*imponible|total\s*base|bases?\s*imponibles?|subtotal|sub-total|suma\s*y\s*sigue|total\s*(?:factura|fra|a\s*pagar|documento|general|eur(?:os)?|neto|bruto|importe|albaran|lineas|productos|articulos|mercancia)|importe\s*total|importe\s*bruto|suma\s*(?:de\s*)?(?:productos|articulos|neto|lineas)|neto\s*mercancia|suma\s*(?:de\s*)?importes?|total\s*bases?|forma\s*de\s*pago|formas\s*de\s*pago|vencimientos?|observaciones|desglose\s*(?:de\s*)?(?:l?\s*)?iva|cuadro\s*(?:de\s*)?iva|resumen\s*(?:de\s*)?iva|recargo\s*(?:de\s*)?equivalencia|cuota\s*i\.?v\.?a|total\s*i\.?v\.?a|i\.?v\.?a\.?\s*\d{1,2}(?:[.,]\d{1,2})?\s*%\s*(?:s\/|sobre)|dto\.?\s*pronto\s*pago|total\s*$|^total\b)/;
const PAUSE_RE = /suma\s*y\s*sigue|sigue\s*en\s*(?:la\s*)?(?:pagina|hoja)|continua\s*en/;
const RESUME_RE = /suma\s*anterior|viene\s*de\s*(?:la\s*)?(?:pagina|hoja)|anterior\s*:/;
/** Metadatos de trazabilidad (lote, caducidad, zona FAO, especie…) que no son líneas. */
const META_RE =
  /^(?:\(?\s*)?(?:lote|lot|l\.?\s*:|n[ºo°]?\s*lote|cad\b|cad\.|caducidad|fecha\s*(?:de\s*)?cad|f\.?\s*cad|consumir|consumo\s*pref|origen\s*[:.]|pais\s*(?:de\s*origen)?\s*[:.]|fao|zona\s*(?:de\s*)?captura|zona\s*fao|arte\s*(?:de\s*)?pesca|metodo\s*(?:de\s*)?produccion|capturado|criado|especie|nombre\s*cient|n\.?\s*cient|denominacion\s*comercial|presentacion|peso\s*neto|temperatura|conservar|registro\s*sanitario|rgseaa|albaran|alb\.|pedido|s\/ref|su\s*ref|nuestra\s*ref|n\/ref|entrega|matadero|sala\s*de\s*despiece|nacido|sacrificado|despiece|n[ºo°]\s*(?:de\s*)?referencia|codigo\s*de\s*barras|ean\b|cat\.\s*(?:extra|i{1,3}|primera|segunda|[12])\b|categoria\s*:|calibre\s*:)/;
const META_ANY_RE = /\b(?:lote|cad(?:ucidad)?|fao\s*\d{1,2}|f\.\s*cad|consumir\s*pref)\s*[:.]?\s*[a-z0-9]/;
/**
 * Trazabilidad y marcas de pedido de los cash & carry y mayoristas: "GTIN: 08436…  Lote: 0", "Qty: 1  LOT: 0",
 * "*** Número de pedido 9-2365…", "Entregado a: …", "*** Fin de número de pedido". Nunca son líneas.
 */
const TRACE_RE = /^(?:[g6]?tin\s*[:.]|gtin\b|ean\s*[:.]|qty\s*[:.]|(?:n[uú]mero|num\.?|n[ºo°]\.?)\s*(?:de\s*)?pedido\b|fin\s*(?:de\s*)?(?:n[uú]mero\s*(?:de\s*)?)?pedido\b|entregad[oa]\s*(?:a|en)\b)/;
/** Nombre científico de la especie en una sublínea de trazabilidad ("Merluccius merluccius · Zona FAO 27 · Arrastre"). */
const SCIENTIFIC_RE = /^(?:\([A-Z][a-z]+ [a-z]{3,}(?: [a-z]{3,})?\)|[A-Z][a-z]+ [a-z]{3,}(?: [a-z]{3,})?\s*[·•,;|–]\s*\S)/;
const EXTRA_RE =
  /^(?:portes?|transporte|gastos\s*(?:de\s*)?(?:envio|transporte)|envio|envases?(?:\s*retornables?)?|retornables?|fianza|(?:devolucion|abono|retorno)\s*(?:de\s*)?(?:envases?|cascos?|palets?|fianzas?|barril(?:es)?)|deposito|cascos?|palets?|ecotasa|punto\s*verde|recargo\s*(?:de\s*)?combustible|gastos?\s*financieros?|tasa\s*(?:de\s*)?residuos|sirga)\b/;
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
  // OCR: restos de un filete vertical pegados a la cifra ("|24,64", "4,85/", "298!")
  if (allowOcr) s = s.replace(/^[|!¦]+(?=\d)/, '').replace(/(\d)[|!¦/]+$/, '$1');
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
    // OCR: "124,1l" es 124,11 (una "l" minúscula tras un solo decimal es un 1, no litros)
    const ocrOne = allowOcr && gl && gl[2] === 'l' && /[.,]\d$/.test(gl[1]);
    if (gl && !pct && !ocrOne) {
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

function makeWord(raw: string, x0: number, x1: number, allowOcr: boolean, seg: number): Word {
  const f = fold(raw).replace(/^[^a-z0-9%€]+|[^a-z0-9%€]+$/g, '');
  const word: Word = { raw, x0, x1, f, seg };
  // Fechas, horas, códigos con "/" o "x" no son números
  if (!/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(raw) && !/^\d{1,2}:\d{2}/.test(raw)) {
    const mult = /^[x×*](\d{1,4}(?:[.,]\d{1,3})?)$/i.exec(raw);
    // "x6" de los tickets: multiplicador de unidades (cantidad)
    const n = mult ? parseWordNumber(mult[1], false) : parseWordNumber(raw, allowOcr);
    if (n) word.num = mult ? { ...n, mult: true } : n;
  }
  return word;
}

const RE_PER_UNIT_WORD = /^(?:€|eur|euros)?\s?\/\s?(kg|kgs|kilo|l|lt|litro|ud|uds|u|und|unid|unidad)\.?$/i;

/** Une "12,50" + "€" (o "€/kg", "/kg": precio por unidad) al número anterior; marca la moneda y la unidad. */
function attachCurrency(words: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev?.num && /^(?:€|eur|euros)$/i.test(w.raw)) {
      prev.num.cur = true;
      prev.x1 = w.x1;
      continue;
    }
    const per = RE_PER_UNIT_WORD.exec(w.raw);
    if (prev?.num && per && !prev.num.unit) {
      prev.num.perUnit = UNIT_WORDS[per[1].toLowerCase()] ?? per[1].toLowerCase();
      prev.num.cur ||= /€|eur/i.test(w.raw);
      prev.x1 = w.x1;
      continue;
    }
    out.push(w);
  }
  return out;
}

function rowFromText(text: string, i: number, allowOcr: boolean): Row {
  const words: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let seg = 0;
  let lastEnd = -10;
  while ((m = re.exec(text))) {
    // Dos o más espacios separan celdas (texto alineado por columnas)
    if (m.index - lastEnd >= 2) seg++;
    words.push(makeWord(m[0], m.index, m.index + m[0].length, allowOcr, seg));
    lastEnd = m.index + m[0].length;
  }
  return { i, text, f: fold(text), words: attachCurrency(words), page: 1, y: i, positional: false, cw: 1, ocr: allowOcr };
}

function rowFromPdf(line: PdfTextLine, i: number, allowOcr: boolean): Row {
  const words: Word[] = [];
  const cws: number[] = [];
  let seg = 0;
  for (const item of line.items) {
    const str = item.str;
    if (!str.trim()) continue;
    const cw = item.width > 0 ? item.width / Math.max(1, str.length) : 1;
    cws.push(cw);
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    let lastEnd = -10;
    seg++;
    while ((m = re.exec(str))) {
      // Dentro de un mismo ítem (texto monoespaciado), dos o más espacios también separan celdas
      if (lastEnd >= 0 && m.index - lastEnd >= 2) seg++;
      words.push(makeWord(m[0], item.x + m.index * cw, item.x + (m.index + m[0].length) * cw, allowOcr, seg));
      lastEnd = m.index + m[0].length;
    }
  }
  return { i, text: line.text, f: fold(line.text), words: attachCurrency(words), page: line.page, y: line.y, positional: true, cw: median(cws) || 1, ocr: allowOcr };
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
  const r = w.raw.replace(/[.:"'”’`]+$/, '');
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
  if (isCodeWord(w0, words[1])) return { end: 1, code: w0.raw.replace(/[.:"'”’`]+$/, '') };
  return { end: 0 };
}

// ───────────────────────────── Cabecera de tabla ─────────────────────────────

function detectTableHeader(row: Row): TableHeader | undefined {
  const nums = row.words.filter((w, k) => w.num && !w.num.pct && !(/^[123]$/.test(w.raw) && k > 0 && !row.words[k - 1].num && row.words[k - 1].seg === w.seg)).length;
  if (nums > 1 || row.words.length < 2 || row.words.length > 24) return undefined;
  // Frases de etiqueta ("P. Unit.", "Nº bultos", "Cantidad servida", "IVA %"), también en cabeceras monoespaciadas
  // con un solo espacio entre columnas; las erratas del OCR se reconocen con el vocabulario difuso
  const phrases = headerPhrases(toTRow(row).words);
  const hasDesc = phrases.some((p) => p.info.kind === 'desc');
  const cols: HeaderCol[] = [];
  for (const p of phrases) {
    const label = fold(p.text).replace(/[^a-z0-9]/g, '');
    const kind = p.info.kind ?? headerKind(label, hasDesc);
    if (!kind) continue;
    cols.push({ kind, x0: p.x0, x1: p.x1, label });
  }
  const kinds = new Set(cols.map((c) => c.kind));
  const qtyLike = kinds.has('qty') || kinds.has('uds');
  const main = [kinds.has('desc'), qtyLike, kinds.has('price'), kinds.has('total')].filter(Boolean).length;
  const ok = main >= 3 || (kinds.has('desc') && kinds.has('total') && (qtyLike || kinds.has('price') || kinds.has('disc') || kinds.has('bultos')));
  if (!ok) return undefined;
  // Evitar confundir una fila de totales ("Base imponible  IVA  Total") con la cabecera
  if (!kinds.has('desc') && !qtyLike) return undefined;
  const numericOrder = cols.filter((c) => NUMERIC_KINDS.has(c.kind)).map((c) => c.kind);
  return { row: row.i, rows: [row.i], cols, numericOrder, positional: row.positional };
}

function columnOf(w: Word, header: TableHeader, cw: number): ColKind | undefined {
  if (header.model) {
    const j = columnIndex(header.model.columns, w);
    return j >= 0 ? header.model.columns[j].kind : undefined;
  }
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

// ───────────────────────────── Modelo de tabla (columnas por los datos + etiquetas) ─────────────────────────────

/** Palabras que acompañan a las etiquetas en cabeceras de varias filas ("Precio" / "unitario", "Dto." / "1"). */
const HEADER_AUX = new Set(['unit', 'unitario', 'unitaria', 'neto', 'bruto', 'servida', 'servido', 'kg', 'kgs', 'eur', 'euros', '€', '%', 'ud', 'linea', 'art', 'barras', 'pref', 'del', 'de', 'n', 'no', 'nº', 'p', 'pr', 't', 'f', 'imponible', 'articulo', 'kilos', 'uds']);

function isUnitText(s: string): boolean {
  const k = fold(s).replace(/[^a-z0-9]/g, '');
  return !!k && !/^\d/.test(k) && UNIT_WORDS[k] !== undefined;
}

/**
 * ¿Fila vecina que completa la cabecera (etiquetas partidas en dos filas o agrupadas)? Sin números, casi todo
 * etiquetas, cada celda de una o dos palabras (una nota como "PRECIOS SIN IVA" no) y alineada con la cabecera.
 */
function isHeaderishRow(row: Row, main: Row): boolean {
  if (!row.words.length || row.words.length > 16) return false;
  // Notas sobre los precios ("PRECIOS SIN IVA", "IVA incluido") no son etiquetas de columna
  if (/precios?\s*(?:sin|con)\s*i\.?v\.?a|i\.?v\.?a\.?\s*(?:incluido|no\s*incluido)|impuestos\s*incluidos/.test(row.f)) return false;
  if (row.words.some((w) => w.num && !w.num.pct && !/^[123]$/.test(w.raw))) return false;
  const perSeg = new Map<number, Word[]>();
  for (const w of row.words) perSeg.set(w.seg, [...(perSeg.get(w.seg) ?? []), w]);
  for (const ws of perSeg.values()) if (ws.filter((w) => !/^(?:de|del|la|el)$/.test(w.f)).length > 2) return false;
  if (!row.words.some((w) => main.words.some((m) => Math.min(w.x1, m.x1) - Math.max(w.x0, m.x0) > 0))) return false;
  let hits = 0;
  for (const w of row.words) {
    const k = w.f.replace(/[^a-z0-9%€º]/g, '');
    if (HEADER_WORDS.includes(k) || HEADER_AUX.has(k) || classifyLabel(w.raw).kind) hits++;
  }
  return hits >= Math.max(1, row.words.length * 0.6);
}

function toTRow(row: Row): TRow {
  return { cw: row.cw, words: row.words.map<TWord>((w) => ({ text: w.raw, x0: w.x0, x1: w.x1, seg: w.seg, num: !!w.num, dec: w.num?.dec, value: w.num?.value })) };
}

/** Cabeceras de tabla con sus filas vecinas de etiquetas (partidas en dos filas o agrupadas). */
function detectHeaders(rows: Row[]): Map<number, TableHeader> {
  const headers = new Map<number, TableHeader>();
  for (const row of rows) {
    const h = detectTableHeader(row);
    if (!h) continue;
    const near = (a: Row, b: Row) => a.page === b.page && Math.abs(a.y - b.y) <= (a.positional ? Math.max(a.cw, b.cw) * 3.4 : 2.01);
    const band = [row.i];
    for (let k = row.i - 1; k >= Math.max(0, row.i - 2); k--) {
      const r = rows[k];
      if (!r.f.trim() || headers.has(k) || !near(r, rows[band[0]]) || !isHeaderishRow(r, row)) break;
      band.unshift(k);
    }
    for (let k = row.i + 1; k <= Math.min(rows.length - 1, row.i + 2); k++) {
      const r = rows[k];
      if (!r.f.trim() || !near(r, rows[band[band.length - 1]]) || !isHeaderishRow(r, row) || detectTableHeader(r)) break;
      band.push(k);
    }
    h.rows = band;
    h.row = band[0];
    headers.set(band[0], h);
  }
  return headers;
}

function sameGeometry(a: TableHeader, b: TableHeader, rows: Row[]): boolean {
  if (a.cols.length !== b.cols.length) return false;
  const cw = Math.max(rows[a.row].cw, rows[b.row].cw);
  return a.cols.every((c, k) => c.kind === b.cols[k].kind && Math.abs(c.x0 - b.cols[k].x0) <= cw * 3);
}

/** Construye el modelo de columnas de cada tabla (las cabeceras repetidas en varias páginas comparten modelo). */
function buildModels(rows: Row[], headers: Map<number, TableHeader>): void {
  const list = [...headers.values()].sort((a, b) => a.row - b.row);
  const bandRows = new Set(list.flatMap((h) => h.rows));
  const bodies = new Map<TableHeader, Row[]>();
  for (const h of list) {
    const body: Row[] = [];
    let paused = false;
    for (let i = Math.max(...h.rows) + 1; i < rows.length; i++) {
      const row = rows[i];
      const f = row.f.trim();
      if (!f) continue;
      if (bandRows.has(i)) break;
      if (PAUSE_RE.test(f)) {
        paused = true;
        continue;
      }
      if (paused) {
        if (RESUME_RE.test(f)) paused = false;
        continue;
      }
      if (RESUME_RE.test(f)) continue;
      if (isStopRow(row)) break;
      if (isMetaRow(row)) continue;
      const nums = row.words.filter((w) => w.num && !w.num.pct).length;
      if (nums >= 2 && row.words.some((w) => isTexty(w))) body.push(row);
    }
    bodies.set(h, body);
  }
  const groups: TableHeader[][] = [];
  for (const h of list) {
    const g = groups.find((x) => x[0].positional === h.positional && sameGeometry(x[0], h, rows));
    if (g) g.push(h);
    else groups.push([h]);
  }
  for (const g of groups) {
    const body = g.flatMap((h) => bodies.get(h) ?? []);
    if (!body.length) continue;
    const key = g[0];
    const phrases: HeaderPhrase[] = stackHeaderRows(key.rows.map((ri) => headerPhrases(toTRow(rows[ri]).words)));
    const model = buildTableModel(phrases, body.map(toTRow), { isUnitWord: isUnitText });
    const lastNumeric = [...(model?.columns ?? [])].reverse().find((c) => c.numeric > 0);
    const hasTotal = !!model && (model.columns.some((c) => c.kind === 'total') || (!!lastNumeric && lastNumeric.kind === undefined));
    if (!model || !hasTotal || !model.columns.some((c) => c.kind === 'desc')) continue;
    for (const h of g) {
      h.model = model;
      h.cols = model.columns.filter((c) => c.kind).map((c) => ({ kind: c.kind as ColKind, x0: c.x0, x1: c.x1, label: fold(c.label ?? '').replace(/[^a-z0-9]/g, '') }));
      h.numericOrder = h.cols.filter((c) => NUMERIC_KINDS.has(c.kind)).map((c) => c.kind);
    }
  }
}

/**
 * Solución guiada por el modelo de tabla: cantidad, precio, descuentos e importe salen de SUS columnas y se validan
 * con la aritmética (cantidad × precio × (1 − d1) × (1 − d2) = importe). Con varias columnas de cantidad (uds y kilos,
 * cajas y botellas) gana la que cuadra, por orden de preferencia. Devuelve undefined si nada cuadra.
 */
function modelSolve(toks: NumTok[], header: TableHeader): Solution | undefined {
  const model = header.model;
  if (!model) return undefined;
  const has = (k: ColKind) => model.columns.some((c) => c.kind === k);
  const of = (k: ColKind) => toks.filter((t) => t.col === k && !t.n.perUnit);
  const unknown = toks.filter((t) => t.col === undefined && !t.n.pct);
  const tCands = has('total') ? of('total') : unknown.slice(-1);
  const pCands = has('price') ? toks.filter((t) => t.col === 'price') : unknown;
  const qRank = new Map<NumTok, number>();
  QTY_KINDS.forEach((k, r) => of(k).forEach((t) => qRank.set(t, r)));
  if (!QTY_KINDS.some((k) => has(k))) unknown.forEach((t) => qRank.set(t, 3));
  for (const t of toks) if (t.n.mult && !qRank.has(t)) qRank.set(t, 0);
  const qCands = [...qRank.keys()];
  const discs = of('disc').filter((d) => d.value > 0 && d.value < 100);
  const discSets: NumTok[][] = [discs];
  if (discs.length) {
    discSets.push([]);
    if (discs.length === 2) discSets.push([discs[0]], [discs[1]]);
  }
  const mults = of('mult').filter((f) => f.value > 1);
  // Descuentos en euros: por la etiqueta de su columna o, si el porcentaje no cuadra, probando el importe
  const amountCol = (d: NumTok) => {
    const j = columnIndex(model.columns, d.w);
    return j >= 0 && !!model.columns[j].amount;
  };
  const amountDiscs = of('disc').filter((d) => d.value > 0 && (amountCol(d) || d.n.dec === 2));
  let best: Solution | undefined;
  for (const t of tCands) {
    if (t.n.pct) continue;
    for (const p of pCands) {
      if (p === t || p.n.pct || p.value <= 0) continue;
      for (const q of qCands) {
        if (q === t || q === p || q.n.pct || q.value === 0) continue;
        if (Math.sign(q.value * p.value) !== Math.sign(t.value)) continue;
        for (const f of [undefined, ...mults]) {
          if (f === q || f === p) continue;
          for (const [di, d] of discSets.entries()) {
            if (d.some(amountCol)) continue;
            let calc = q.value * p.value * (f ? f.value : 1);
            for (const dd of d) calc *= 1 - dd.value / 100;
            const err = Math.abs(calc - t.value);
            if (err > tolerance(q.value * (f ? f.value : 1), p.value)) continue;
            const score = 30 - (qRank.get(q) ?? 3) * 2 - di * 3 - (f ? 4 : 0) - (err > 0.0051 ? 1 : 0) - (q.n.fixed || p.n.fixed || t.n.fixed ? 2 : 0);
            if (!best || score > best.score) best = { q, p, t, d, f, err, validated: true, loose: false, score };
          }
          for (const da of amountDiscs) {
            const calc = round(q.value * p.value * (f ? f.value : 1), 2) - da.value * Math.sign(t.value);
            const err = Math.abs(calc - t.value);
            if (err > 0.0101) continue;
            const score = 28 - (qRank.get(q) ?? 3) * 2 - (amountCol(da) ? 0 : 3) - (f ? 4 : 0);
            if (!best || score > best.score) best = { q, p, t, d: [], dAmount: da, f, err, validated: true, loose: false, score };
          }
        }
      }
    }
  }
  return best;
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
  if (row.ocr && lastText > firstText && firstText >= 0) {
    // Palabras finales ilegibles tras los números ("0,89  PEO"): suelen ser un importe mal leído, no descripción
    let lastNum = -1;
    for (let k = words.length - 1; k > firstText; k--) {
      if (words[k].num) {
        lastNum = k;
        break;
      }
    }
    const trailing = words.slice(lastNum + 1);
    const numsBetween = words.slice(firstText, lastNum + 1).filter((w) => w.num).length;
    if (lastNum > firstText && trailing.length <= 2 && trailing.every((w) => w.raw.length <= 6) && numsBetween >= 2) {
      lastText = -1;
      for (let k = startWord; k < lastNum; k++) if (isTexty(words[k])) lastText = k;
    }
  }
  for (let wi = startWord; wi < words.length; wi++) {
    const w = words[wi];
    if (!w.num && row.ocr && wi > lastText && lastText >= 0 && /^[SOlIB]$/.test(w.raw)) {
      // OCR: cifra suelta leída como letra en la zona numérica ("S  MALLA  1,35  6,75")
      const digit = ({ S: '5', O: '0', l: '1', I: '1', B: '8' } as Record<string, string>)[w.raw];
      w.num = { value: Number(digit), dec: 0, pct: false, cur: false, fixed: digit };
    }
    if (!w.num) continue;
    const prev = words[wi - 1];
    if (prev && !prev.num && prev.seg === w.seg && NOISE_PREFIX.has(prev.f.replace(/[^a-z]/g, ''))) continue;
    // "6 X 1L", "24 x 33cl": parte de un formato (pero "6 x 0,82" de un ticket es cantidad × precio)
    const next = words[wi + 1];
    const packAfter = (k: number) => {
      const a = words[k];
      if (!a || a.seg !== w.seg) return false;
      return (!!a.num?.unit && a.num.unit !== 'kg') || (!!a.num && unitOf(words[k + 1]) !== undefined && unitOf(words[k + 1]) !== 'kg') || (!a.num && /^\d+(?:[.,]\d+)?(?:cl|ml|l|g|gr|kg)$/i.test(a.raw));
    };
    if (next && next.seg === w.seg && /^[x*×]$/i.test(next.raw) && packAfter(wi + 2)) continue;
    if (prev && prev.seg === w.seg && /^[x*×]$/i.test(prev.raw) && words[wi - 2]?.num && (!!w.num.unit || unitOf(words[wi + 1]) !== undefined) && w.num.unit !== 'kg') continue;
    const inDesc = lastText > wi;
    const lead = firstText === -1 || wi < firstText;
    const col = header ? columnOf(w, header, row.cw) : undefined;
    out.push({ wi, w, n: w.num, value: w.num.value, inDesc: inDesc && !lead, lead: lead && firstText !== -1, col, afterText: !!prev && !prev.num && /\p{L}{2,}/u.test(prev.raw) });
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
    // "SACO 25KG  25,000 KG" / "1  BIZCOCHO 1KG": un formato pegado a la descripción que repite el valor de otro número
    // es parte de la descripción; la cantidad es el otro
    if (q.n.unit && q.afterText && cands.some((o) => o !== q && o !== p && o !== t && Math.abs(o.value - q.value) < 1e-9)) score -= 4;
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
    if (t.n.dec === 0 && (row.ocr ? /^\d{2,6}$/ : /^\d{3,6}$/).test(digits) && Number.isInteger(t.value)) {
      // "446" → 4,46 / 0,446 / 44,6; en OCR también "37" → 3,7
      for (const div of digits.length === 2 ? [10] : [100, 1000, 10]) {
        const v = round(t.value / div, 4);
        const dec = div === 100 ? 2 : div === 1000 ? 3 : 1;
        const fixed = `${Math.trunc(v)},${String(Math.round((v % 1) * div)).padStart(dec, '0')}`;
        variants.push(toks.map((x, i) => (i === k ? { ...x, value: v, n: { ...x.n, value: v, dec, fixed, repaired: true } } : x)));
      }
    }
    // OCR: un «1» de más delante (resto de un filete o de la raya del «€»): "124,64" por 24,64
    if (row.ocr && /^1\d+[.,]?\d*$/.test(raw) && digits.length >= 3 && !t.n.fixed) {
      const s = raw.slice(1);
      const v = parseNumberEs(s);
      if (v !== undefined && v > 0) variants.push(toks.map((x, i) => (i === k ? { ...x, value: v, n: { ...x.n, value: v, fixed: s, repaired: true } } : x)));
    }
    // "1.250" leído como miles cuando era 1,250 kg
    if (t.n.dec === 0 && /^\d{1,3}[.]\d{3}$/.test(raw)) {
      const v = t.value / 1000;
      variants.push(toks.map((x, i) => (i === k ? { ...x, value: v, n: { ...x.n, value: v, dec: 3, fixed: raw.replace('.', ','), repaired: true } } : x)));
    }
    // Dos tokens contiguos "12" "50" → 12,50
    const nx = toks[k + 1];
    if (nx && nx.wi === t.wi + 1 && t.n.dec === 0 && nx.n.dec === 0 && !nx.n.pct) {
      const a = t.w.raw.replace(/[^\d]/g, '');
      const b = nx.w.raw.replace(/[^\d]/g, '');
      if (/^\d{1,4}$/.test(a) && /^\d{2,3}$/.test(b) && row.words[t.wi].x1 <= row.words[nx.wi].x0) {
        const v = Number(`${a}.${b}`);
        const merged: NumTok = { ...t, value: v, n: { ...t.n, value: v, dec: b.length, fixed: `${a},${b}`, cur: t.n.cur || nx.n.cur, repaired: true } };
        variants.push([...toks.slice(0, k), merged, ...toks.slice(k + 2)]);
      }
    }
  });
  return variants;
}

/** Distancia de edición entre dos cadenas de cifras (inserciones, borrados y cambios). */
function editDist(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * OCR: precio con cifras de más o de menos ("33,50" leído "733,550") entre una cantidad y un importe bien leídos. El
 * precio que da el importe exacto (al céntimo) se acepta si está a dos ediciones como mucho de lo leído y es único.
 */
function priceByEdit(toks: NumTok[]): Solution | undefined {
  const cands = toks.filter((t) => !t.inDesc && !t.n.pct && !t.n.perUnit && t.value > 0);
  const t = [...cands].reverse().find((x) => x.n.dec === 2 || x.n.cur);
  if (!t) return undefined;
  const found: Solution[] = [];
  for (const p of cands) {
    if (p.wi >= t.wi) continue;
    for (const q of cands) {
      if (q.wi >= p.wi || q.value >= 10000) continue;
      for (const dec of [2, 3, 4]) {
        const cand = round(t.value / q.value, dec);
        if (!(cand > 0) || Math.abs(round(q.value * cand, 2) - t.value) > 0.001 || cand === p.value) continue;
        const read = rawDigits(p);
        const want = digitsOf(cand, dec).replace(/^0+(?=\d)/, '');
        const dist = editDist(read.replace(/^0+(?=\d)/, ''), want);
        if (dist < 1 || dist > 2 || Math.abs(read.length - want.length) > 2) continue;
        const fixed = cand.toFixed(dec).replace('.', ',');
        const repl: NumTok = { ...p, value: cand, n: { ...p.n, value: cand, dec, fixed, repaired: true } };
        if (!found.some((f) => f.p.value === cand && f.q === q)) found.push({ q, p: repl, t, d: [], err: 0, validated: true, loose: false, score: 0 });
        break;
      }
    }
  }
  return found.length === 1 ? found[0] : undefined;
}

/** Cifras de un valor escrito con `dec` decimales (1.15, 2 → "115"). */
function digitsOf(v: number, dec: number): string {
  return Math.abs(v).toFixed(dec).replace('.', '');
}

function rawDigits(t: NumTok): string {
  return (t.n.fixed ?? t.w.raw).replace(/[^\d]/g, '');
}

/** Distancia entre dos cadenas de cifras de igual longitud (sustituciones); Infinity si difieren en longitud. */
function digitDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** ¿Encaja el token en la columna? Sólo con posiciones reales (en texto plano las columnas del OCR no cuadran). */
function colOk(tok: NumTok, want: ColKind, positional: boolean): boolean {
  if (!tok.col || !positional) return true;
  if (want === 'qty') return tok.col === 'qty' || tok.col === 'bultos';
  return tok.col === want;
}

/**
 * Corrige cifras mal leídas por el OCR (1↔4, 3↔8, 5↔6…): si dos de los tres campos (cantidad, precio, importe) son
 * coherentes, el tercero queda determinado por la aritmética; se acepta si sólo difiere de lo leído en `maxDist`
 * cifras (misma longitud). Sólo devuelve una solución si es ÚNICA; si hay varias posibles no adivina.
 * Con `targetTotal` (importe deducido de la base imponible) el importe es conocido y puede faltar en la fila.
 */
function digitRepair(toks: NumTok[], opts: RepairOpts): Solution | undefined {
  const list = digitRepairAll(toks, opts);
  if (!list.length) return undefined;
  if (list.length > 1 && list[1].dist === list[0].dist) return undefined;
  return list[0].sol;
}

interface RepairOpts {
  header?: TableHeader;
  targetTotal?: number;
  maxDist: number;
  row?: Row;
  /** Proponer también importes calculados cuando la fila no tiene importe legible (cantidad × precio al final). */
  missingTotal?: boolean;
}

/** Todas las correcciones posibles de cifras (ordenadas por distancia). Ver `digitRepair`. */
function digitRepairAll(toks: NumTok[], opts: RepairOpts): { sol: Solution; dist: number }[] {
  const positional = !!opts.header?.positional;
  const cands = toks.filter((t) => !t.inDesc && !t.n.pct && !t.n.perUnit && t.value > 0);
  const pcts = toks.filter((t) => !t.inDesc && t.value > 0 && t.value < 100 && t.n.dec <= 2 && (t.n.pct || t.col === 'disc'));
  const target = opts.targetTotal;
  let totals: NumTok[];
  if (target !== undefined) {
    const match = cands.filter((t) => approxEqual(t.value, target, 0.011, 0.001));
    if (match.length) totals = match;
    else {
      // Importe ilegible: se usa el deducido de la base imponible, al final de la fila
      const words = opts.row?.words ?? [];
      const last = words[words.length - 1];
      const raw = target.toFixed(2).replace('.', ',');
      const w: Word = { raw, x0: last ? last.x1 : 0, x1: last ? last.x1 : 0, f: raw, seg: -1, num: { value: target, dec: 2, pct: false, cur: false, fixed: raw } };
      totals = [{ wi: words.length, w, n: w.num as NumInfo, value: target, inDesc: false, lead: false, col: 'total' }];
    }
  } else {
    const last = cands[cands.length - 1];
    if (!last) return [];
    totals = [last];
    if (cands.length >= 4 && isVatRateValue(last.n) && !last.n.cur) totals = [cands[cands.length - 2]];
  }
  const found = new Map<string, { sol: Solution; dist: number }>();
  const push = (q: NumTok, p: NumTok, t: NumTok, d: NumTok[], fixedTok: NumTok, value: number, dist: number) => {
    const dec = fixedTok === t ? 2 : fixedTok.n.dec;
    const fixedStr = value.toFixed(dec).replace('.', ',');
    const repl: NumTok = { ...fixedTok, value, n: { ...fixedTok.n, value, fixed: fixedStr, repaired: true } };
    const sol: Solution = {
      q: fixedTok === q ? repl : q,
      p: fixedTok === p ? repl : p,
      t: fixedTok === t ? repl : t,
      d,
      err: 0,
      validated: true,
      loose: false,
      score: 0,
    };
    const key = `${sol.q.value}|${sol.p.value}|${sol.t.value}|${d.map((x) => x.value).join(',')}`;
    const prev = found.get(key);
    if (!prev || dist < prev.dist) found.set(key, { sol, dist });
  };
  for (const t of totals) {
    const tv = target ?? t.value;
    // Importe ilegible sustituido por el deducido de la base: la cantidad y el precio leídos pueden estar bien tal cual
    const minDist = t.w.seg === -1 ? 0 : 1;
    for (const p of cands) {
      if (p === t || p.wi >= t.wi || !colOk(p, 'price', positional)) continue;
      // La cantidad más próxima al precio primero (no un formato "25KG" de la descripción con el mismo valor)
      for (const q of [...cands].reverse()) {
        if (q === t || q === p || q.wi >= p.wi || !colOk(q, 'qty', positional) || q.value >= 10000) continue;
        const discOpts: NumTok[][] = [[]];
        for (const d of pcts) if (d.wi > p.wi && d.wi < t.wi) discOpts.push([d]);
        for (const d of discOpts) {
          const f = d.reduce((acc, x) => acc * (1 - x.value / 100), 1);
          // Precio
          {
            const dec = Math.max(p.n.dec, 2);
            const cand = round(tv / (q.value * f), dec);
            if (cand > 0 && Math.abs(q.value * cand * f - tv) <= tolerance(q.value, cand)) {
              const dist = digitDistance(rawDigits(p), digitsOf(cand, p.n.dec || 2));
              if (dist >= minDist && dist <= opts.maxDist) push(q, p, t, d, p, cand, dist);
            }
          }
          // Importe (sólo si se ha leído de verdad)
          if (target === undefined && t.w.num === t.n) {
            const cand = round(q.value * p.value * f, 2);
            const dist = digitDistance(rawDigits(t), digitsOf(cand, 2));
            if (dist >= 1 && dist <= opts.maxDist) push(q, p, t, d, t, cand, dist);
          }
          // Cantidad
          if (q.n.dec > 0 || Number.isInteger(tv / (p.value * f))) {
            const cand = round(tv / (p.value * f), q.n.dec);
            if (cand > 0 && Math.abs(cand * p.value * f - tv) <= tolerance(cand, p.value)) {
              const dist = digitDistance(rawDigits(q), digitsOf(cand, q.n.dec));
              if (dist >= 1 && dist <= opts.maxDist) push(q, p, t, d, q, cand, dist);
            }
          }
        }
      }
    }
  }
  // Importe ilegible: cantidad × precio al final de la fila sin ningún número detrás
  if (opts.missingTotal && target === undefined) {
    const words = opts.row?.words ?? [];
    const lastWord = words[words.length - 1];
    for (const p of cands) {
      if (cands.some((o) => o.wi > p.wi && !isVatRateValue(o.n)) || !colOk(p, 'price', positional)) continue;
      for (const q of [...cands].reverse()) {
        if (q === p || q.wi >= p.wi || !colOk(q, 'qty', positional) || q.value >= 10000) continue;
        const value = round(q.value * p.value, 2);
        if (!(value > 0)) continue;
        const raw = value.toFixed(2).replace('.', ',');
        const w: Word = { raw, x0: lastWord ? lastWord.x1 : 0, x1: lastWord ? lastWord.x1 : 0, f: raw, seg: -1, num: { value, dec: 2, pct: false, cur: false, fixed: raw } };
        const t: NumTok = { wi: words.length, w, n: w.num as NumInfo, value, inDesc: false, lead: false, col: 'total' };
        const sol: Solution = { q, p, t, d: [], err: 0, validated: true, loose: false, score: 0 };
        const key = `${q.value}|${p.value}|${value}|`;
        if (!found.has(key)) found.set(key, { sol, dist: 2 });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.dist - b.dist);
}

/**
 * OCR: una fila que cuadra sólo gracias a la tolerancia de redondeo, con una cantidad o un precio a UNA cifra de dar
 * el importe exacto, suele ser una cifra mal leída ("6,290" leído "6,299") o una cifra de más al final ("3,22 €" leído
 * "3,222"). Se corrige si la alternativa exacta es única. El importe nunca se toca aquí (es lo que suma la base).
 */
function exactRefine(sol: Solution): Solution {
  if (sol.err <= 0.0051 || sol.f || sol.dAmount) return sol;
  const factor = sol.d.reduce((a, d) => a * (1 - d.value / 100), 1);
  const t = sol.t.value;
  const exact = (q: number, p: number) => Math.abs(round(q * p * factor, 2) - t) <= 0.001;
  const found = new Map<string, { sol: Solution; cut: boolean }>();
  for (const which of ['q', 'p'] as const) {
    const tok = sol[which];
    const other = which === 'q' ? sol.p.value : sol.q.value;
    const dec = tok.n.dec;
    if (dec === 0 || tok.value <= 0 || other === 0) continue;
    const options: { value: number; dec: number; cut: boolean }[] = [];
    // Una cifra cambiada (mismos decimales)
    const sub = round(t / (other * factor), dec);
    if (sub > 0 && digitDistance(digitsOf(tok.value, dec), digitsOf(sub, dec)) === 1) options.push({ value: sub, dec, cut: false });
    // Una cifra de más al final
    const cut = Math.trunc(Math.abs(tok.value) * 10 ** (dec - 1) + 1e-9) / 10 ** (dec - 1);
    if (cut > 0) options.push({ value: cut, dec: dec - 1, cut: true });
    for (const o of options) {
      if (!exact(which === 'q' ? o.value : other, which === 'p' ? o.value : other)) continue;
      const key = `${which}|${o.value}`;
      const prev = found.get(key);
      if (prev) {
        prev.cut ||= o.cut;
        continue;
      }
      const fixed = o.value.toFixed(o.dec).replace('.', ',');
      const repl: NumTok = { ...tok, value: o.value, n: { ...tok.n, value: o.value, dec: o.dec, fixed, repaired: true } };
      found.set(key, { sol: { ...sol, [which]: repl, err: 0 }, cut: o.cut });
    }
  }
  const list = [...found.values()];
  if (list.length === 1) return list[0].sol;
  // Varias alternativas: una cifra de más al final (el OCR añade un «1» o repite una cifra) es lo más probable
  const cuts = list.filter((x) => x.cut);
  return cuts.length === 1 ? cuts[0].sol : sol;
}

/** Anota en una línea de OCR si cuadra al céntimo y, si no, sus alternativas exactas (se decide con todo el documento). */
function markExactness(line: ParsedLine, sol: Solution, row: Row): ParsedLine {
  if (!row.ocr || !sol.validated) return line;
  // Un importe con tres decimales ("45,066") lleva una cifra de más al final (resto de un filete o del «€»): se quita si
  // así cuadra al céntimo con cantidad × precio
  if (sol.t.n.dec === 3 && !sol.f && !sol.dAmount) {
    const cut = (Math.sign(sol.t.value) * Math.trunc(Math.abs(sol.t.value) * 100 + 1e-7)) / 100;
    const calc = round(sol.q.value * sol.p.value * sol.d.reduce((a, d) => a * (1 - d.value / 100), 1), 2);
    if (Math.abs(calc - cut) <= 0.001) {
      line.total = cut;
      return line;
    }
  }
  if (sol.err <= 0.0051) return line;
  line.inexact = true;
  const alt = exactRefine(sol);
  if (alt !== sol) line.exactAlt = { quantity: round(alt.q.value, 4), unitPrice: round(alt.p.value, 4) };
  if (!sol.f && !sol.dAmount) {
    // O bien el importe tiene una cifra mal leída ("33,67" por 33,66)
    const calc = round(sol.q.value * sol.p.value * sol.d.reduce((a, d) => a * (1 - d.value / 100), 1), 2);
    if (calc !== 0 && Math.sign(calc) === Math.sign(sol.t.value) && digitDistance(digitsOf(sol.t.value, 2), digitsOf(calc, 2)) === 1) line.totalAlt = calc;
  }
  return line;
}

/**
 * OCR: si el documento calcula sus importes al céntimo (casi todas sus líneas cuadran exactas), las que sólo cuadran
 * por redondeo tienen una cifra mal leída, no un precio con más decimales de los impresos. Si corregir sus importes
 * hace cuadrar la suma con la base imponible se corrigen los importes; si no, la cantidad o el precio (el importe es
 * lo que suma la base).
 */
function applyExactConvention(parsed: ParsedLine[], target: number | undefined): void {
  const validated = parsed.filter((l) => l.validated);
  if (validated.length < 4) return;
  const exactShare = validated.filter((l) => !l.inexact).length / validated.length;
  if (exactShare < 0.6) return;
  const sum = (withTotals: boolean) => round(parsed.reduce((s, l) => s + (withTotals && l.totalAlt !== undefined ? l.totalAlt : l.total), 0), 2);
  // Al céntimo: la tolerancia de redondeo de la suma dejaría pasar justo la cifra mal leída
  const fixTotals = target !== undefined && parsed.some((l) => l.totalAlt !== undefined) && Math.abs(sum(false) - target) > 0.001 && Math.abs(sum(true) - target) <= 0.001;
  for (const l of parsed) {
    if (fixTotals && l.totalAlt !== undefined) {
      l.total = l.totalAlt;
      l.confidence = Math.min(l.confidence, 0.85);
    } else if (l.exactAlt) {
      l.quantity = l.exactAlt.quantity;
      l.unitPrice = l.exactAlt.unitPrice;
      l.confidence = Math.min(l.confidence, 0.85);
    } else continue;
    l.inexact = false;
  }
  for (const l of parsed) {
    l.exactAlt = undefined;
    l.totalAlt = undefined;
  }
}

// ───────────────────────────── Construcción de la línea ─────────────────────────────

function normUnit(u: string): string {
  const k = fold(u).replace(/[^a-z0-9]/g, '');
  const mapped = UNIT_WORDS[k];
  return mapped || k || 'ud';
}

/** Unidad indicada en la cabecera de la columna ("Kilos", "Kg", "Uds.", "Cajas", "Precio/kg"). */
function headerUnit(header: TableHeader | undefined, sol: Solution): string | undefined {
  if (!header) return undefined;
  for (const tok of [sol.q, sol.p]) {
    if (!tok.col) continue;
    const col = header.cols.find((c) => c.kind === tok.col);
    if (!col) continue;
    const m = /(kg|kgs|kilos?|litros?|lts?|uds|unidades|piezas|cajas)$/.exec(col.label);
    if (!m) continue;
    const u = UNIT_WORDS[m[1]] ?? (m[1].startsWith('kilo') ? 'kg' : m[1].startsWith('litro') ? 'l' : undefined);
    if (u) return u;
  }
  return undefined;
}

/**
 * Línea con el modelo de tabla: la descripción sale SÓLO de la columna de descripción (nunca de lotes, caducidades,
 * EAN, códigos ni bultos), el código de su columna, la unidad de la columna de unidad (o pegada a la cantidad, o de la
 * etiqueta de la columna: "Kilos" → kg) y el IVA de su columna, esté antes o después del importe.
 */
function buildLineModel(row: Row, sol: Solution, toks: NumTok[], confidence: number, warnings: string[], model: TableModel): ParsedLine {
  const words = row.words;
  const used = new Set<number>([sol.q.wi, sol.p.wi, sol.t.wi, ...sol.d.map((d) => d.wi)]);
  if (sol.dAmount) used.add(sol.dAmount.wi);
  if (sol.f) used.add(sol.f.wi);
  for (const t of [sol.q, sol.p, sol.t]) if (t.n.fixed && /^\d{1,4},\d{2,3}$/.test(t.n.fixed) && !/[.,]/.test(t.w.raw)) used.add(t.wi + 1);
  const colAt = (w: Word) => {
    const j = columnIndex(model.columns, w);
    return j >= 0 ? model.columns[j] : undefined;
  };
  let vatPct: number | undefined;
  let vatCode: string | undefined;
  // IVA de su columna (antes o después del importe) o, sin columna rotulada, el tipo que sigue al importe
  const vatTok =
    toks.find((t) => t.col === 'vat' && !used.has(t.wi) && (isVatRateValue(t.n) || t.n.value === 0)) ??
    toks.find((t) => t.wi > sol.t.wi && t.col === undefined && !used.has(t.wi) && isVatRateValue(t.n));
  if (vatTok) {
    vatPct = vatTok.value;
    used.add(vatTok.wi);
  }
  const descWords: Word[] = [];
  let code: string | undefined;
  let unitCell: string | undefined;
  words.forEach((w, k) => {
    if (used.has(k)) return;
    const c = colAt(w);
    const kind = c?.kind;
    if (kind === 'desc') descWords.push(w);
    else if (kind === 'code' && !code && /\d/.test(w.raw)) code = w.raw.replace(/[.:"'”’`]+$/, '');
    else if (kind === 'unit' && !unitCell && /\p{L}/u.test(w.raw)) unitCell = unitOf(w) || fold(w.raw).replace(/[^a-z0-9]/g, '');
    else if (kind === 'vat' && vatPct === undefined && !vatCode && /^[A-E]$/.test(w.raw.replace(/[()]/g, ''))) vatCode = w.raw.replace(/[()]/g, '');
  });
  if (!code && !model.columns.some((c) => c.kind === 'code')) {
    const lc = leadingCode(descWords);
    if (lc.end && descWords.length > lc.end) {
      code = lc.code;
      descWords.splice(0, lc.end);
    }
  }
  // Unidad: pegada a la cantidad o en su celda, columna de unidad, etiqueta de la columna, precio por unidad
  const qCol = colAt(sol.q.w);
  const pCol = colAt(sol.p.w);
  const nextW = words[sol.q.wi + 1];
  const inQtyCell = nextW && nextW.seg === sol.q.w.seg && !nextW.num && unitOf(nextW) !== undefined ? unitOf(nextW) || fold(nextW.raw) : undefined;
  let unit: string | undefined = sol.q.n.unit ?? inQtyCell ?? unitCell ?? qCol?.unit ?? sol.p.n.perUnit ?? pCol?.perUnit;
  if (!unit && descWords.length > 1) {
    const u = unitOf(descWords[descWords.length - 1]);
    if (u) unit = u;
  }
  if (!unit) unit = sol.q.n.dec === 3 && !Number.isInteger(sol.q.value) ? 'kg' : 'ud';
  const description = collapseSpaces(descWords.map((w) => w.raw).join(' ')).replace(/[\s.·:|_-]+$/, '').replace(/^[\s.·:|_-]+/, '');
  let unitPrice = sol.p.value;
  let description2 = description;
  if (sol.f) {
    unitPrice = round(sol.p.value * sol.f.value, 4);
    if (unit === 'ud') unit = 'caja';
    if (!/\d+\s*[x*]\s*\d/i.test(description2)) description2 = `${description2} ${sol.f.value} UD`.trim();
  }
  let discountPct: number | undefined;
  if (sol.d.length) discountPct = pctRound((1 - sol.d.reduce((acc, d) => acc * (1 - d.value / 100), 1)) * 100);
  // Descuento en euros: el porcentaje equivalente sale del importe
  if (sol.dAmount) discountPct = round((1 - sol.t.value / (sol.q.value * unitPrice)) * 100, 2);
  const fixes = [sol.q, sol.p, sol.t, ...sol.d].filter((t) => t.n.repaired && t.wi < words.length).map((t) => `"${t.w.raw}" → ${t.n.fixed}`);
  if (fixes.length) warnings.push(`Lectura corregida por la validación aritmética: ${fixes.join(', ')}`);
  if (sol.t.wi >= words.length) warnings.push('Importe ilegible: calculado a partir de la base imponible');
  return {
    row: row.i,
    rows: [row.i],
    code,
    description: description2,
    quantity: round(sol.q.value, 4),
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
    roles: solutionRoles(sol, words, descWords, vatTok?.w),
  };
}

function buildLine(row: Row, codeEnd: number, code: string | undefined, sol: Solution, toks: NumTok[], confidence: number, warnings: string[], header?: TableHeader): ParsedLine {
  if (header?.model && [sol.q, sol.p, sol.t].every((t) => t.col === undefined || NUMERIC_KINDS.has(t.col))) return buildLineModel(row, sol, toks, confidence, warnings, header.model);
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
    // Sólo si no forma parte de un formato ("SACO 25 KG", "PIEZA 2-3 KG")
    if (!/\d/.test(words[qi - 2]?.raw ?? '')) {
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
  if (!unit) unit = headerUnit(header, sol);
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
  if (sol.d.length) discountPct = pctRound((1 - sol.d.reduce((acc, d) => acc * (1 - d.value / 100), 1)) * 100);
  const fixes = [sol.q, sol.p, sol.t, ...sol.d].filter((t) => t.n.repaired && t.wi < words.length).map((t) => `"${t.w.raw}" → ${t.n.fixed}`);
  if (fixes.length) warnings.push(`Lectura corregida por la validación aritmética: ${fixes.join(', ')}`);
  if (sol.t.wi >= words.length) warnings.push('Importe ilegible: calculado a partir de la base imponible');
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
    roles: solutionRoles(sol, words, descWords, vatTok?.w),
  };
}

interface RowParse {
  line?: ParsedLine;
  /** Fila con texto pero sin números útiles (posible continuación). */
  textOnly?: boolean;
}

/** Texto de la columna de descripción de una fila (con modelo de tabla). */
function descColumnText(row: Row, model: TableModel): string {
  return collapseSpaces(
    row.words
      .filter((w) => {
        const j = columnIndex(model.columns, w);
        return j >= 0 && model.columns[j].kind === 'desc';
      })
      .map((w) => w.raw)
      .join(' '),
  );
}

/**
 * OCR: mota o resto de otra fila leído como una palabra corta fuera de la descripción ("o", "de", "é", un "5" suelto
 * sin decimales). No basta para que una fila de texto deje de ser la continuación de una descripción.
 */
function isOcrJunk(w: Word, row: Row): boolean {
  return !!row.ocr && w.raw.replace(/[^\p{L}\d]/gu, '').length <= 2 && !(w.num && w.num.dec > 0) && !w.num?.cur;
}

/** Fila con el modelo de tabla. undefined = la aritmética no cuadra con las columnas (se prueba sin modelo). */
function parseRowWithModel(row: Row, header: TableHeader): RowParse | undefined {
  const toks = numTokens(row, 0, header);
  const inNumericCols = toks.filter((t) => (t.col === undefined ? !t.inDesc : NUMERIC_KINDS.has(t.col)));
  // Continuación posible: algo en la columna de descripción (también "1L", "500G", "40/60")
  const hasLetters = row.words.some((w) => /[\p{L}\d]/u.test(w.raw) && columnOf(w, header, row.cw) === 'desc');
  if (!inNumericCols.some((t) => t.col !== 'vat' && t.col !== 'disc' && !isOcrJunk(t.w, row))) return { textOnly: hasLetters };
  const strict = toks.filter((t) => t.col === undefined || NUMERIC_KINDS.has(t.col));
  const sol = modelSolve(strict, header);
  if (!sol) return undefined;
  const conf = [sol.q, sol.p, sol.t].some((t) => t.n.fixed) ? 0.85 : 1;
  return { line: markExactness(buildLine(row, 0, undefined, sol, strict, conf, [], header), sol, row) };
}

function parseRow(row: Row, header: TableHeader | undefined, inTable: boolean, cc?: CcContext): RowParse {
  const words = row.words;
  if (!words.length) return {};
  // Cash & carry: las columnas de la fila de importes van por orden tras el código de unidad (la inclinación de una
  // foto desplaza las columnas y el modelo por posiciones no sirve)
  const ccInfo = cc?.rows.get(row.i);
  if (ccInfo && cc) {
    // Sin la aritmética de sus columnas no se adivina con la de una fila normal (daría cantidades y precios cruzados)
    const line = parseCcRow(row, ccInfo, cc);
    return line ? { line } : {};
  }
  if (header?.model) {
    const res = parseRowWithModel(row, header);
    if (res) return res;
  }
  const { end: codeEnd, code } = leadingCode(words);
  const toks = numTokens(row, codeEnd, header);
  const hasText = words.some((w, k) => k >= codeEnd && isTexty(w));
  // Para continuaciones cuentan también las palabras de envase ("GARRAFA 5 LITROS")
  const hasLetters = hasText || words.some((w, k) => k >= codeEnd && !w.num && /\p{L}{3,}/u.test(w.raw));
  if (!toks.length || toks.every((t) => t.inDesc)) return { textOnly: hasLetters };

  let sol = solveTokens(toks, { header });
  let conf = 1;
  const warnings: string[] = [];
  let ocrLoose = false;
  if (sol && !sol.validated) {
    conf = 0.8;
    if (row.ocr) {
      // En OCR, "casi cuadra" suele ser una cifra mal leída (33,55 por 33,50): se busca la lectura exacta
      const dr = digitRepair(toks, { header, maxDist: 1, row });
      if (dr) sol = dr;
      else {
        conf = 0.7;
        ocrLoose = true;
      }
    }
  }
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
  if (!sol && row.ocr) {
    // Una cifra mal leída (1↔4, 3↔8…) que la aritmética determina sin ambigüedad
    const dr = digitRepair(toks, { header, maxDist: 1, row }) ?? priceByEdit(toks);
    if (dr) {
      sol = dr;
      conf = 0.8;
    }
  }
  if (sol) {
    if ([sol.q, sol.p, sol.t, ...sol.d].some((t) => t.n.fixed)) conf = Math.min(conf, 0.85);
    const line = markExactness(buildLine(row, codeEnd, code, sol, toks, conf, warnings, header), sol, row);
    // Sin validar del todo: puede corregirse después con la base imponible o con otra lectura
    if (ocrLoose) line.validated = false;
    return { line };
  }
  if (!inTable || !hasText) {
    const loneInt = toks.length === 1 && toks[0].n.dec === 0 && !toks[0].n.cur && Math.abs(toks[0].value) < 1000;
    // Un formato pegado al final del texto ("KETCHUP 1,8KG", "AGUA 50CL") es parte de la descripción
    return { textOnly: hasLetters && (toks.every((t) => t.inDesc || (!!t.n.unit && !!t.afterText && !t.n.cur)) || loneInt) };
  }

  // Sin validación: asignación plausible por columnas o por orden
  const tail = toks.filter((t) => !t.inDesc && !t.n.pct);
  const pctToks = toks.filter((t) => !t.inDesc && t.n.pct);
  let q: NumTok | undefined;
  let p: NumTok | undefined;
  let t: NumTok | undefined;
  let d: NumTok | undefined;
  if (header?.positional) {
    q = tail.find((x) => x.col === 'qty') ?? tail.find((x) => x.col === 'uds') ?? tail.find((x) => x.col === 'bultos');
    p = tail.find((x) => x.col === 'price');
    // Con dos columnas de importe ("Subtotal | IVA | Total"), la base es la de la izquierda
    const totalCols = header.model ? header.model.columns.filter((c) => c.kind === 'total').length : 1;
    t = totalCols > 1 ? tail.find((x) => x.col === 'total') : [...tail].reverse().find((x) => x.col === 'total');
    d = toks.find((x) => x.col === 'disc');
  }
  let rest = tail.filter((x) => x !== q && x !== p && x !== t);
  if (rest.length >= 3 && isVatRateValue(rest[rest.length - 1].n) && !t) rest = rest.slice(0, -1);
  if (!t) t = rest.pop();
  if (!p) p = rest.filter((x) => !t || x.wi < t.wi).pop();
  if (!q) q = rest.filter((x) => x !== p && (!p || x.wi < p.wi)).pop();
  if (!d) d = pctToks.find((x) => (!p || x.wi > p.wi) && (!t || x.wi < t.wi));
  if (!t) return { textOnly: true };
  // Con modelo de tabla, una fila sin nada en la columna de descripción y que no cuadra no es una línea (pies, totales)
  if (header?.model && !descColumnText(row, header.model).replace(/[^\p{L}]/gu, '')) return {};
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
  const line = buildLine(row, codeEnd, code, solution, toks, confidence, warnings, header);
  line.validated = false;
  return { line };
}

// ───────────────────────────── Cash & carry y mayoristas (artículos en dos filas) ─────────────────────────────

/**
 * Facturas de cash & carry y mayoristas de alimentación: cada artículo ocupa una fila de descripción (código de
 * artículo o GTIN + texto, sin importes) y, debajo, una fila de importes que empieza por el CÓDIGO DE UNIDAD de venta
 * («KG», «CJ», «BO», «MA»…) seguido de las columnas Prec. Ud. | Cont. | Precio | Cant. | Importe | IVA (código):
 *   Precio = Prec. Ud. × Cont.   e   Importe = Precio × Cant.
 * También la variante en una sola fila (descripción + código de unidad + números). Las dos relaciones juntas son una
 * firma muy fuerte, así que el modo sólo se activa si varias filas del documento las cumplen. En las fotos, el papel
 * curvado o inclinado parte una fila en dos (las últimas columnas caen en la fila de debajo): esos restos se unen a la
 * fila de importes si no se solapan con ella.
 */

/** Código de unidad de venta (dos letras en mayúsculas delante de los precios) → unidad facturada. */
const CC_UNIT_CODES: Record<string, string> = {
  KG: 'kg', LT: 'l', UN: 'ud', UD: 'ud', PZ: 'ud', CJ: 'caja', CB: 'cubo', BO: 'bote', FR: 'frasco', TR: 'tarro', TA: 'tarrina', BD: 'bidon',
  BT: 'bot', MA: 'malla', MJ: 'manojo', PQ: 'paquete', PK: 'paquete', SC: 'saco', BL: 'bolsa', BJ: 'bandeja', LA: 'lata', BR: 'brik',
  GF: 'garrafa', ES: 'estuche', RL: 'rollo', SB: 'sobre', DC: 'docena', FD: 'fardo',
};

interface CcRowInfo {
  /** Índice de la primera palabra de la zona de importes (el código de unidad o, si no se ha leído, el primer número). */
  start: number;
  /** Código de unidad leído ("KG", "CJ"…); undefined si el OCR no lo ha leído. */
  code?: string;
  /** La primera palabra de la zona de importes es el código de unidad mal leído ("sc", "cl"): no es un número. */
  slot?: boolean;
}

/** Contexto del modo cash & carry de un documento (lo que tienen en común sus filas de importes). */
interface CcContext {
  /** Decimales habituales del precio por unidad (3 en «14,420»). */
  puDec?: number;
  /** Los precios por unidad de tres decimales acaban en 0 («14,420»): una tercera cifra distinta es un error del OCR. */
  puZero?: boolean;
  /** Las filas llevan un código de IVA tras el importe. */
  vat: boolean;
  /** Filas de importes (ya unidas a su descripción y a sus restos) por índice de fila. */
  rows: Map<number, CcRowInfo>;
}

/** Palabra que el OCR lee en lugar de un «1» en la zona de importes ("I", "l", "|", "X"). */
function ccOne(w: Word): boolean {
  return !w.num && /^[IilL|!¡X]$/.test(w.raw);
}

/** Resto sin valor en la zona de importes (letras sueltas, marcas de otras columnas: "HD", "a"). */
function ccJunk(w: Word): boolean {
  return !w.num && !/\d/.test(w.raw) && w.raw.replace(/[^\p{L}]/gu, '').length <= 2;
}

/** Número de la zona de importes (sin unidad pegada ni %). */
function ccNum(w: Word): boolean {
  return !!w.num && !w.num.pct && !w.num.unit && !w.num.perUnit;
}

function ccCode(w: Word): string | undefined {
  if (w.num) return undefined;
  // El OCR lee a veces el código en minúsculas o mezcladas ("sc", "Bo")
  const code = w.raw.replace(/[.:,;]+$/, '').toUpperCase();
  return CC_UNIT_CODES[code] !== undefined ? code : undefined;
}

/** Celda de la zona de importes que el OCR ha estropeado ("2/43" por 2,13, "6,"): se ignora al asignar columnas. */
function ccLost(w: Word): boolean {
  return !w.num && /\d/.test(w.raw) && w.raw.length <= 8 && !/\p{L}{2,}/u.test(w.raw);
}

/** ¿Números de una descripción (código de artículo, formatos "5 L", "800g", "4/5"), sin importes? */
function ccDescNumbersOk(words: Word[]): boolean {
  return words.every((w, k) => !w.num || !!w.num.unit || w.num.dec === 0 || (!w.num.cur && unitOf(words[k + 1]) !== undefined));
}

/**
 * Índice del código de unidad de una fila de importes: el último código seguido sólo de números (y restos cortos del
 * OCR), al menos dos y alguno con decimales, y sin importes delante. −1 si no lo es.
 */
function ccUnitIndex(row: Row): number {
  const words = row.words;
  for (let k = words.length - 1; k >= 0; k--) {
    if (!ccCode(words[k])) continue;
    const after = words.slice(k + 1);
    if (!after.every((w) => ccNum(w) || ccJunk(w) || ccLost(w))) continue;
    const nums = after.filter(ccNum);
    if (nums.length < 2 || !nums.some((w) => (w.num?.dec ?? 0) >= 2)) continue;
    return ccDescNumbersOk(words.slice(0, k)) ? k : -1;
  }
  return -1;
}

interface CcTok {
  wi: number;
  value: number;
  dec: number;
  raw: string;
  /** Leído de otra forma (letra por cifra, punto decimal por coma). */
  fixed?: string;
  /** Celda ilegible ("2/43"): ocupa su columna, sin valor. */
  lost?: boolean;
}

/** Números de la zona de importes (desde `from`), con los «1» leídos como letra. */
function ccTokens(words: Word[], from: number): CcTok[] {
  const out: CcTok[] = [];
  for (let wi = from; wi < words.length; wi++) {
    const w = words[wi];
    if (ccOne(w)) out.push({ wi, value: 1, dec: 0, raw: w.raw, fixed: '1' });
    else if (ccLost(w)) out.push({ wi, value: NaN, dec: -1, raw: w.raw, lost: true });
    else if (w.num && ccNum(w)) {
      // "4.200": precio de tres decimales con punto (en estas columnas no hay miles sin céntimos)
      if (w.num.dec === 0 && /^\d{1,3}\.\d{3}$/.test(w.raw)) out.push({ wi, value: w.num.value / 1000, dec: 3, raw: w.raw, fixed: w.raw.replace('.', ',') });
      else out.push({ wi, value: w.num.value, dec: w.num.dec, raw: w.raw, fixed: w.num.fixed });
    }
  }
  return out;
}

interface CcSol {
  pu?: CcTok;
  cp?: CcTok;
  pr: CcTok;
  ca: CcTok;
  /** Importe leído (undefined si no se ha leído y sale de Precio × Cant.). */
  im?: CcTok;
  total: number;
  vat?: CcTok;
  /** Campos corregidos por la aritmética ('"8,020" → 8,820'). */
  fixes: string[];
  /** 1 = las cinco columnas; 2 = una corregida; 3 = importe ilegible; 4 = sin Prec. Ud. ni Cont. */
  kind: 1 | 2 | 3 | 4;
  /** Sólo cuadra con un céntimo de diferencia (alguna cifra puede estar mal leída). */
  approx?: boolean;
  score: number;
}

/**
 * Prec. Ud. × Cont. = Precio, redondeado a céntimos: medio céntimo de margen (con uno entero, un peso o un precio mal
 * leído en la tercera cifra decimal también "cuadraría"). `loose`: un céntimo, sólo como último recurso.
 */
function ccR1(pu: number, cp: number, pr: number, loose = false): boolean {
  return Math.abs(pu * cp - pr) <= (loose ? 0.0101 : 0.0051);
}

/** Precio × Cant. = Importe (o Prec. Ud. × Cont. × Cant. redondeado de una vez, `puCp` = Prec. Ud. × Cont.). */
function ccR2(pr: number, ca: number, im: number, puCp?: number, loose = false): boolean {
  const tol = loose ? 0.0101 + 0.0005 * Math.abs(ca) : 0.0051;
  return Math.abs(pr * ca - im) <= tol || (puCp !== undefined && Math.abs(puCp * ca - im) <= tol);
}

function ccTokDigits(t: CcTok): string {
  return (t.fixed ?? t.raw).replace(/[^\d]/g, '');
}

/**
 * Valor de `dec` decimales que cumple `ok` más parecido a lo leído (como mucho dos cifras cambiadas, misma longitud);
 * undefined si no hay ninguno o si hay dos igual de cerca.
 */
function ccClosest(t: CcTok, lo: number, hi: number, dec: number, ok: (v: number) => boolean): { value: number; dist: number } | undefined {
  const f = 10 ** dec;
  const from = Math.ceil(lo * f - 1e-6);
  const to = Math.floor(hi * f + 1e-6);
  if (to < from || to - from > 50) return undefined;
  const read = ccTokDigits(t);
  let best: { value: number; dist: number } | undefined;
  let tie = false;
  for (let n = from; n <= to; n++) {
    const v = n / f;
    if (!(v > 0) || !ok(v)) continue;
    const dist = digitDistance(read, digitsOf(v, dec));
    if (dist > 2) continue;
    if (!best || dist < best.dist) {
      best = { value: v, dist };
      tie = false;
    } else if (dist === best.dist) tie = true;
  }
  return best && !tie ? best : undefined;
}

const ccFix = (t: CcTok, value: number, dec: number): { tok: CcTok; fix: string } => {
  const fixed = value.toFixed(dec).replace('.', ',');
  return { tok: { ...t, value, dec, fixed }, fix: `"${t.raw}" → ${fixed}` };
};

/**
 * Asigna las columnas de una fila de importes con la aritmética: primero las cinco (dos relaciones), luego con una
 * cifra mal leída que la otra relación determina, con el importe ilegible (Precio × Cant.) y, por último, sin
 * Prec. Ud. ni Cont. (fuera de la foto). `ctx` aporta los decimales habituales del precio por unidad y si hay
 * columna de IVA, para no confundir el código de IVA con una cantidad.
 */
function ccSolve(toks: CcTok[], ctx: Pick<CcContext, 'puDec' | 'vat' | 'puZero'>): CcSol | undefined {
  const n = toks.length;
  const money = (t: CcTok) => t.dec === 2;
  const vatAfter = (k: number) => {
    const v = toks[k + 1];
    return v && v.dec === 0 && Number.isInteger(v.value) && v.value >= 0 && v.value <= 9 && !v.fixed ? v : undefined;
  };
  const puPenalty = (pu: CcTok) => (ctx.puDec !== undefined && pu.dec !== ctx.puDec && !(pu.fixed && pu.dec === 0) ? 15 : 0);
  let best: CcSol | undefined;
  const consider = (s: CcSol) => {
    if (!best || s.score > best.score) best = s;
  };
  // Precio por unidad de tres decimales que no acaba en 0 en un documento donde todos acaban en 0 ("1,596" por 1,590):
  // el valor a céntimos que sigue cuadrando, si sólo hay uno (o el más parecido a lo leído)
  const zeroFix = (pu: CcTok, cp: CcTok, pr: CcTok): { tok: CcTok; fix: string } | undefined => {
    if (!ctx.puZero || pu.dec !== 3 || ccTokDigits(pu).endsWith('0')) return undefined;
    const opts = [Math.floor(pu.value * 100 + 1e-6) / 100, Math.ceil(pu.value * 100 - 1e-6) / 100].filter((v, i, a) => v > 0 && a.indexOf(v) === i && ccR1(v, cp.value, pr.value));
    const read = ccTokDigits(pu);
    const pick = opts.sort((x, y) => digitDistance(read, digitsOf(x, 3)) - digitDistance(read, digitsOf(y, 3)))[0];
    return pick === undefined ? undefined : ccFix(pu, pick, 3);
  };
  // 1) Las cinco columnas (con `loose`, un céntimo de margen: último recurso)
  const five = (loose: boolean) => {
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++) {
          if (!money(toks[c]) || !ccR1(toks[a].value, toks[b].value, toks[c].value, loose)) continue;
          for (let d = c + 1; d < n; d++)
            for (let e = d + 1; e < n; e++) {
              const [pu0, cp, pr, ca, im] = [toks[a], toks[b], toks[c], toks[d], toks[e]];
              if (!money(im) || ca.value <= 0 || !ccR2(pr.value, ca.value, im.value, pu0.value * cp.value, loose)) continue;
              const gaps = a + (b - a - 1) + (c - b - 1) + (d - c - 1) + (e - d - 1);
              const fixes = [pu0, cp, ca].filter((t) => t.fixed).length;
              const vat = vatAfter(e);
              const zf = loose ? undefined : zeroFix(pu0, cp, pr);
              const pu = zf?.tok ?? pu0;
              consider({ pu, cp, pr, ca, im, total: im.value, vat, fixes: zf ? [zf.fix] : [], kind: 1, approx: loose, score: (loose ? 40 : 100) - gaps * 4 - fixes - puPenalty(pu0) + (vat ? 2 : 0) - (zf ? 1 : 0) });
            }
        }
  };
  five(false);
  if (best) return best;
  // 2) Una cifra mal leída: la relación que se cumple determina el campo de la otra
  for (let a = 0; a + 4 < n; a++) {
    const [pu, cp, pr, ca, im] = toks.slice(a, a + 5);
    if (!money(pr) || !money(im) || ca.value <= 0 || cp.value <= 0) continue;
    const r1 = ccR1(pu.value, cp.value, pr.value);
    const r2 = ccR2(pr.value, ca.value, im.value, pu.value * cp.value);
    const vat = vatAfter(a + 4);
    const base = { pr, ca, vat, kind: 2 as const };
    // Precio mal leído: Prec. Ud. × Cont. (a céntimos) × Cant. da el importe y el precio leído no ("7,42" por 7,12)
    if (!r1 && !ccR2(pr.value, ca.value, im.value) && Number.isInteger(ca.value) && ca.value >= 1) {
      const target = round(pu.value * cp.value, 2);
      if (target > 0 && Math.abs(target * ca.value - im.value) <= 0.0051 && digitDistance(ccTokDigits(pr), digitsOf(target, 2)) <= 2) {
        const { tok, fix } = ccFix(pr, target, 2);
        consider({ ...base, pr: tok, pu, cp, im, total: im.value, fixes: [fix], score: 78 - a * 4 });
        continue;
      }
    }
    if (r2 && !r1) {
      const decPu = Math.max(pu.dec, 2);
      const fp = ccClosest(pu, (pr.value - 0.0101) / cp.value, (pr.value + 0.0101) / cp.value, decPu, (v) => ccR1(v, cp.value, pr.value));
      const fc = cp.fixed ? undefined : ccClosest(cp, (pr.value - 0.0101) / pu.value, (pr.value + 0.0101) / pu.value, cp.dec, (v) => ccR1(pu.value, v, pr.value));
      const pick = fp && (!fc || fp.dist < fc.dist) ? { which: 'pu' as const, ...fp, dec: decPu } : fc && (!fp || fc.dist < fp.dist) ? { which: 'cp' as const, ...fc, dec: cp.dec } : undefined;
      if (pick) {
        const { tok, fix } = ccFix(pick.which === 'pu' ? pu : cp, pick.value, pick.dec);
        consider({ ...base, pu: pick.which === 'pu' ? tok : pu, cp: pick.which === 'cp' ? tok : cp, im, total: im.value, fixes: [fix], score: 80 - pick.dist * 5 - a * 4 });
      }
    } else if (r1 && !r2) {
      const fi = ccClosest(im, round(pr.value * ca.value, 2), round(pr.value * ca.value, 2), 2, () => true);
      if (fi) {
        const { tok, fix } = ccFix(im, fi.value, 2);
        consider({ ...base, pu, cp, im: tok, total: fi.value, fixes: [fix], score: 80 - fi.dist * 5 - a * 4 });
      } else if (ca.dec === 0 && Number.isInteger(round(im.value / pr.value, 6)) && digitDistance(ccTokDigits(ca), String(round(im.value / pr.value, 6))) === 1) {
        const { tok, fix } = ccFix(ca, round(im.value / pr.value, 6), 0);
        consider({ ...base, pu, cp, ca: tok, im, total: im.value, fixes: [fix], score: 75 - a * 4 });
      }
    }
  }
  // Precio ilegible ("2/43"): Prec. Ud. × Cont. a céntimos × Cant. = Importe, con la celda del precio en su sitio
  for (let a = 0; a + 4 < n; a++) {
    const [pu, cp, lost, ca, im] = toks.slice(a, a + 5);
    if (!lost.lost || !money(im) || !(cp.value > 0) || !(pu.value > 0) || !Number.isInteger(ca.value) || ca.value < 1) continue;
    const price = round(pu.value * cp.value, 2);
    if (Math.abs(price * ca.value - im.value) > 0.0051) continue;
    const pr: CcTok = { wi: lost.wi, value: price, dec: 2, raw: lost.raw, fixed: price.toFixed(2).replace('.', ',') };
    consider({ pu, cp, pr, ca, im, total: im.value, vat: vatAfter(a + 4), fixes: [`"${lost.raw}" → ${pr.fixed}`], kind: 2, score: 70 - a * 4 });
  }
  if (best) return best;
  five(true);
  if (best) return best;
  // 3) Importe ilegible: Prec. Ud. × Cont. = Precio y la cantidad entera detrás (sin otro importe después)
  for (let a = 0; a + 3 < n; a++)
    for (let b = a + 1; b + 2 < n; b++) {
      const [pu, cp] = [toks[a], toks[b]];
      const pr = toks[b + 1];
      const ca = toks[b + 2];
      if (!money(pr) || !ccR1(pu.value, cp.value, pr.value) || ca.dec !== 0 || !(ca.value >= 1 && ca.value < 1000)) continue;
      if (toks.slice(b + 3).some(money)) continue;
      const vat = vatAfter(b + 2);
      // Si el documento lleva código de IVA, la cantidad va seguida de él: un número final sin nada detrás puede ser el
      // propio código o un importe cortado ("14" por 14,73)
      if (ctx.vat && !vat && ca.value === Math.trunc(pr.value)) continue;
      consider({ pu, cp, pr, ca, total: round(pr.value * ca.value, 2), vat, fixes: [], kind: 3, score: 60 - (b - a - 1) * 4 - a * 4 - puPenalty(pu) - (ctx.vat && !vat ? 10 : 0) });
    }
  // 4) Sin Prec. Ud. ni Cont. (perdidos por el OCR): Precio × Cant. = Importe
  for (let c = 0; c + 2 < n && c <= 1; c++) {
    const [pr, ca, im] = toks.slice(c, c + 3);
    if (!money(pr) || !money(im) || ca.value <= 0 || !ccR2(pr.value, ca.value, im.value)) continue;
    consider({ pr, ca, im, total: im.value, vat: vatAfter(c + 2), fixes: [], kind: 4, score: 50 - c * 4 });
  }
  return best;
}

/** Palabras de una fila unida: descripción (filas de arriba y la propia) y zona de importes (con los restos de debajo). */
function ccMergeWords(target: Row, start: number, desc: Row[], spills: Row[]): { words: Word[]; start: number } {
  const startX = target.words[start]?.x0 ?? Infinity;
  const tag = (ws: Word[], src: number) => ws.map((w) => ({ ...w, seg: w.seg + src * 1000 }));
  const byX = (a: Word, b: Word) => a.x0 - b.x0;
  const head = desc.flatMap((r, k) => tag(r.words, k + 1));
  const own = tag(target.words.slice(0, start), 0);
  const amounts = tag(target.words.slice(start), 0);
  spills.forEach((r, k) => {
    for (const w of tag(r.words, desc.length + k + 1)) ((w.x0 + w.x1) / 2 < startX ? own : amounts).push(w);
  });
  own.sort(byX);
  amounts.sort(byX);
  return { words: [...head, ...own, ...amounts], start: head.length + own.length };
}

/** ¿Fila de descripción de un artículo (texto con su código y sus formatos, sin importes)? */
function ccDescRow(row: Row): boolean {
  if (!row.words.length || isMetaRow(row) || isStopRow(row) || ccUnitIndex(row) >= 0) return false;
  const codeOnly = row.words.length === 1 && /^\d{5,14}$/.test(row.words[0].raw);
  if (!codeOnly && !row.words.some((w) => !w.num && /\p{L}{3,}/u.test(w.raw))) return false;
  return ccDescNumbersOk(row.words);
}

/** Resto suelto del OCR entre filas ("360", "001,", "a"): ni descripción ni importes. */
function ccJunkRow(row: Row): boolean {
  return row.words.length <= 2 && row.words.every((w) => w.raw.length <= 4 && !/\p{L}{3,}/u.test(w.raw));
}

/**
 * ¿Resto de una fila de importes partida por el OCR? Sólo números en la zona de importes (a la derecha del código de
 * unidad), como mucho un trozo de la descripción o el código de artículo a la izquierda, y nada que se solape con
 * lo que ya tiene la fila.
 */
function ccSpill(row: Row, words: Word[], startX: number): boolean {
  if (!row.words.length || ccUnitIndex(row) >= 0 || isMetaRow(row) || isStopRow(row)) return false;
  const mid = (w: Word) => (w.x0 + w.x1) / 2;
  const right = row.words.filter((w) => mid(w) >= startX);
  if (!right.some(ccNum) || !right.every((w) => ccNum(w) || ccJunk(w))) return false;
  if (row.words.some((w) => mid(w) < startX && !!w.num && !/^\d{4,14}$/.test(w.raw))) return false;
  return !row.words.some((w) => words.some((t) => Math.min(w.x1, t.x1) - Math.max(w.x0, t.x0) > 0.3 * Math.max(1e-6, Math.min(w.x1 - w.x0, t.x1 - t.x0))));
}

/** Filas de debajo que son restos de la fila de importes `i` (hasta dos, pegadas en vertical). */
function ccSpillRows(rows: Row[], i: number, start: number): Row[] {
  const target = rows[i];
  const startX = target.words[start]?.x0 ?? Infinity;
  const out: Row[] = [];
  let words = target.words;
  for (let j = i + 1; j < rows.length && out.length < 2; j++) {
    const r = rows[j];
    if (r.page !== target.page) break;
    if (!r.words.length) continue;
    if (target.positional ? r.y - target.y > target.cw * 1.9 : j > i + 1) break;
    if (!ccSpill(r, words, startX)) break;
    out.push(r);
    words = [...words, ...r.words];
  }
  return out;
}

/**
 * Activa el modo cash & carry si varias filas cumplen las dos relaciones y une cada fila de importes con su fila de
 * descripción (la de encima, si la propia no trae descripción) y con los restos partidos por el OCR (debajo). Las
 * filas unidas quedan vacías y se anotan en `absorbed` de la fila de importes. Devuelve el contexto o undefined.
 */
function cashCarryPrepass(rows: Row[], headers: Map<number, TableHeader>): CcContext | undefined {
  const headerRows = new Set([...headers.values()].flatMap((h) => h.rows));
  const cands: { i: number; k: number }[] = [];
  for (const row of rows) {
    if (headerRows.has(row.i)) continue;
    const k = ccUnitIndex(row);
    if (k >= 0) cands.push({ i: row.i, k });
  }
  if (cands.length < 2) return undefined;
  // Firma: filas con las cinco columnas (con sus restos de debajo, si los hay)
  const pus: number[] = [];
  let full = 0;
  let vats = 0;
  let pu3 = 0;
  let pu3Zero = 0;
  for (const c of cands) {
    const merged = ccMergeWords(rows[c.i], c.k, [], ccSpillRows(rows, c.i, c.k));
    const sol = ccSolve(ccTokens(merged.words, merged.start + 1), { vat: false });
    if (sol?.kind !== 1 || !sol.pu) continue;
    full++;
    pus.push(sol.pu.dec);
    if (sol.vat) vats++;
    if (sol.pu.dec === 3) {
      pu3++;
      if (ccTokDigits(sol.pu).endsWith('0')) pu3Zero++;
    }
  }
  if (full < 2 && !(full >= 1 && cands.length >= 3)) return undefined;
  const counts = new Map<number, number>();
  for (const d of pus) counts.set(d, (counts.get(d) ?? 0) + 1);
  const puDec = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ctx: CcContext = { puDec, vat: vats >= full * 0.5, puZero: pu3 >= 3 && pu3Zero >= pu3 * 0.8, rows: new Map() };
  const codeXs = cands.map((c) => rows[c.i].words[c.k].x0);
  const codeX = median(codeXs);
  const cw = median(cands.map((c) => rows[c.i].cw)) || 1;
  const amountRow = new Map(cands.map((c) => [c.i, c.k]));
  // Filas de importes cuyo código de unidad no se ha leído bien: una marca corta en la columna del código ("ER" por
  // «FR», "sc" por «SC», "cl" por «CJ», "a:)") o directamente los números; delante, como mucho la descripción de la
  // propia fila (variante en una fila). Con las dos relaciones o la primera y la cantidad.
  const slotRows = new Set<number>();
  const codeSlot = (w: Word) => !w.num && w.raw.length <= 4 && Math.abs(w.x0 - codeX) <= cw * 2.5;
  for (const row of rows) {
    if (amountRow.has(row.i) || headerRows.has(row.i) || !row.words.length || isMetaRow(row) || isStopRow(row)) continue;
    let start = -1;
    let slot = false;
    for (let k = 0; k < row.words.length && start < 0; k++) {
      const w = row.words[k];
      if (codeSlot(w) && row.words.slice(k + 1).some(ccNum)) {
        start = k;
        slot = true;
      } else if (ccNum(w) && w.x0 > codeX - cw) start = k;
    }
    if (start < 0) continue;
    const before = row.words.slice(0, start);
    if (before.length && (!before.some((w) => /\p{L}{2,}/u.test(w.raw)) || !ccDescNumbersOk(before))) continue;
    if (row.words.slice(slot ? start + 1 : start).some((w) => !ccNum(w) && !ccJunk(w) && !ccOne(w) && !ccLost(w))) continue;
    const sol = ccSolve(ccTokens(row.words, slot ? start + 1 : start), ctx);
    if (!sol || (sol.kind !== 1 && sol.kind !== 3)) continue;
    amountRow.set(row.i, start);
    if (slot) slotRows.add(row.i);
  }
  for (const i of [...amountRow.keys()].sort((a, b) => a - b)) {
    const target = rows[i];
    const k = amountRow.get(i) as number;
    // Sin código leído (fila que empieza por los números): la zona de importes empieza en la primera palabra
    const start = Math.max(0, k);
    const spills = ccSpillRows(rows, i, start);
    const own = target.words.slice(0, start);
    // Con sólo el código de artículo delante de los importes, la descripción está en la fila de encima
    const ownDesc = own.some((w) => /\p{L}{2,}/u.test(w.raw));
    const desc: Row[] = [];
    if (!ownDesc) {
      for (let j = i - 1; j >= 0; j--) {
        const r = rows[j];
        if (headerRows.has(j) || r.page !== target.page || amountRow.has(j)) break;
        if (!r.words.length || ccJunkRow(r)) continue;
        if (!ccDescRow(r)) break;
        desc.unshift(r);
        // Una fila con su código de artículo; si la más cercana no lo trae, puede ser la segunda de una descripción larga
        if (leadingCode(r.words).end || desc.length === 2) break;
      }
      // Dos filas sin código: sólo la de justo encima
      if (desc.length === 2 && !leadingCode(desc[0].words).end) desc.shift();
    }
    const merged = ccMergeWords(target, start, desc, spills);
    const absorbed = [...desc, ...spills];
    // Restos sueltos entre la descripción y los importes ("360"): se consumen con el artículo
    if (desc.length) for (let j = desc[desc.length - 1].i + 1; j < i; j++) if (rows[j].words.length && ccJunkRow(rows[j])) absorbed.push(rows[j]);
    target.words = merged.words;
    target.text = merged.words.map((w) => w.raw).join(' ');
    target.f = fold(target.text);
    target.absorbed = [...(target.absorbed ?? []), ...absorbed.flatMap((r) => [r.i, ...(r.absorbed ?? [])])];
    for (const r of absorbed) {
      r.words = [];
      r.text = '';
      r.f = '';
    }
    const code = k >= 0 ? ccCode(target.words[merged.start]) : undefined;
    ctx.rows.set(i, { start: merged.start, code, slot: slotRows.has(i) });
  }
  return ctx;
}

/**
 * Erratas seguras del OCR en la descripción de un artículo: la «O» leída como cero dentro de una palabra en mayúsculas
 * ("AR0" → "ARO") y el «1» leído como l/i/I delante de una unidad ("lkg" → "1kg", "ll" → "1l", "1lkg" → "1kg").
 */
export function ccFixDescription(text: string): string {
  return text
    .replace(/\b([A-ZÁÉÍÓÚÑ]{2,})0(?=[A-ZÁÉÍÓÚÑ]*\b)/g, '$1O')
    .replace(/\b0(?=[A-ZÁÉÍÓÚÑ]{2,}\b)/g, 'O')
    .replace(/(^|\s)[lIi|](kg|kgs|g|gr|l|cl|ml|lt)\b/g, '$11$2')
    .replace(/(\d)[lIi|](kg|kgs|g|gr|cl|ml)\b/g, '$1$2');
}

/** Línea de una fila de importes de cash & carry; undefined si la aritmética no cuadra (se prueba como fila normal). */
function parseCcRow(row: Row, info: CcRowInfo, ctx: CcContext): ParsedLine | undefined {
  const words = row.words;
  const toks = ccTokens(words, info.code || info.slot ? info.start + 1 : info.start);
  const sol = ccSolve(toks, ctx);
  if (!sol) return undefined;
  const billed = info.code ? CC_UNIT_CODES[info.code] : undefined;
  const warnings: string[] = [];
  let confidence = sol.kind === 1 ? 1 : sol.kind === 4 ? 0.9 : 0.85;
  if (sol.fixes.length) warnings.push(`Lectura corregida por la validación aritmética: ${sol.fixes.join(', ')}`);
  if (sol.kind === 3) warnings.push('Importe ilegible: calculado como precio × cantidad');
  if (sol.approx) {
    confidence = 0.7;
    warnings.push('Los importes cuadran con un céntimo de diferencia: revisa el peso o el precio');
  }
  // Al peso (o al volumen): la cantidad son los kilos (Cont. × Cant.) al precio por kilo; sin código leído, un
  // contenido con decimales delata un artículo al peso
  // (un contenido de tres decimales no entero es un peso aunque el código se haya leído como otro: "ES" por «KG»)
  const weighed = billed === 'kg' || billed === 'l' || (!!sol.cp && sol.cp.dec === 3 && !Number.isInteger(sol.cp.value));
  let quantity: number;
  let unitPrice: number;
  let unit: string;
  let packCount: number | undefined;
  if (weighed && sol.pu && sol.cp) {
    quantity = round(sol.cp.value * sol.ca.value, 3);
    unitPrice = sol.pu.value;
    unit = billed === 'l' ? 'l' : 'kg';
  } else {
    quantity = sol.ca.value;
    unitPrice = sol.pr.value;
    unit = weighed ? 'ud' : (billed ?? 'ud');
    if (weighed) {
      confidence = 0.7;
      warnings.push('Falta el peso del artículo (columna de contenido ilegible): revisa la cantidad en kg');
    } else if (sol.cp && sol.cp.dec === 0 && sol.cp.value > 1) packCount = sol.cp.value;
  }
  const descWords = words.slice(0, info.start);
  // Resto suelto del OCR delante del código de artículo ("i 712285 Ron añejo")
  while (descWords.length > 2 && descWords[0].raw.length === 1 && !/\d/.test(descWords[0].raw) && /^\d{5,14}$/.test(descWords[1].raw)) descWords.shift();
  const lc = leadingCode(descWords);
  let code = lc.code;
  let dw = descWords.slice(lc.end);
  // Sólo el código de artículo (la descripción no se ha leído)
  if (!code && dw.length === 1 && /^\d{5,14}$/.test(dw[0].raw)) {
    code = dw[0].raw;
    dw = [];
  }
  // Código de artículo de la fila de importes detrás de la descripción de la fila de encima
  if (dw.length > 1 && /^\d{5,14}$/.test(dw[dw.length - 1].raw)) {
    code ??= dw[dw.length - 1].raw;
    dw = dw.slice(0, -1);
  }
  const rawDesc = collapseSpaces(dw.map((w) => w.raw).join(' ')).replace(/[\s.·:|_-]+$/, '').replace(/^[\s.·:|_-]+/, '');
  const description = row.ocr ? ccFixDescription(rawDesc) : rawDesc;
  const vatValue = sol.vat?.value;
  return {
    row: row.i,
    rows: [row.i, ...(row.absorbed ?? [])],
    code,
    description,
    quantity: round(quantity, 4),
    unit: normUnit(unit),
    unitPrice: round(unitPrice, 4),
    total: round(sol.total, 2),
    vatCode: vatValue !== undefined ? String(vatValue) : undefined,
    confidence,
    warnings,
    validated: true,
    descX: dw[0]?.x0,
    cc: true,
    packCount,
  };
}

// ───────────────────────────── Cabecera del documento ─────────────────────────────

const CIF_RE = /\b(?:ES[\s-]?)?([ABCDEFGHJKLMNPQRSUVW])[\s-]?(\d{7})[\s-]?([0-9A-J])\b/g;
/** CIF impreso con separadores entre la provincia y el número ("A-28/647451", "A28 647451", "B-12.345.678"). */
const CIF_SEP_RE = /\b(?:ES[\s-]?)?([ABCDEFGHJKLMNPQRSUVW])[\s./-]?(\d{2})[\s./-]?(\d{3})[\s./-]?(\d{2})[\s./-]?([0-9A-J])\b/g;
/** Mismo formato con la letra mal leída por el OCR ("n-28/647451", "4-28/647451"): sólo sirve con un CIF conocido. */
const CIF_SEP_OCR_RE = /(?:^|[\s:(])([A-Z0-9])[-./]\s?(\d{2})[-./\s]\s?(\d{5}[0-9A-J])\b/g;

/**
 * Mayoristas muy habituales en hostelería: CIF (verificado en sus facturas) → razón social canónica. El OCR estropea
 * el rótulo ("Makre Distribucion…") y la letra del CIF; si el CIF o un nombre inequívoco los identifican y la marca no
 * se ha leído bien, se pone la razón social canónica (si la marca se lee bien, manda la razón social impresa).
 * Lista corta y sólo con datos comprobados.
 */
export const KNOWN_SUPPLIERS: readonly { taxId: string; name: string; brand: RegExp; match: RegExp }[] = [
  { taxId: 'A28647451', name: 'Makro Distribución Mayorista, S.A.', brand: /\bmakro\b/, match: /\bmak\w{1,2}\s+distribuci\w*\s+mayorista\b/ },
];

/**
 * Datos registrales del emisor ("Inscrita en el Registro Mercantil de Madrid, Tomo 3.669, Folio 86, Hoja M-61.688",
 * "Merc. de Madrid, T. 3.669 L. 0 F. 86, Secc. 8.ª H. M-61.688"): ni número de factura ni fecha salen de ahí.
 */
const REGISTRY_RE =
  /registro\s*mercantil|\breg\.?\s*merc|\br\.\s*m\.|\bmerc\.\s*(?:de\s*)?[a-z]|\binscrita\b|\binscripcion\s*\d|\btomo\s*\d|\bfolio\s*\d|\blibro\s*\d|\bhoja\s*(?:n[ºo°]\.?\s*)?[a-z]{1,2}-\s?\d|\bsecc(?:ion)?\.?\s*\d|\bt\.\s*\d[\d.]*\s*,?\s*(?:l\.|f\.)|\bf\.\s*\d+\s*,?\s*(?:secc|h\.)|\bh\.\s*[a-z]{1,2}-\s?\d/;
/** Etiqueta del número de cliente ("N.cliente:", "Nº cliente", "Cód. cliente", "Cliente nº"). */
const CUSTOMER_NO_RE = /\b(?:n[ºo°]?\.?\s*(?:de\s*)?cliente|cod(?:igo)?\.?\s*(?:de\s*)?cliente|cliente\s*n[ºo°]|num\.?\s*(?:de\s*)?cliente)\b/;
const NIF_RE = /\b(?:ES[\s-]?)?(\d{8})[\s-]?([A-Z])\b/g;
const NIE_RE = /\b([XYZ])[\s-]?(\d{7})[\s-]?([A-Z])\b/g;

/** ¿Contiene un CIF, NIF o NIE? */
function hasTaxId(text: string): boolean {
  const t = text.toUpperCase();
  return [CIF_RE, NIF_RE, NIE_RE].some((re) => new RegExp(re.source).test(t));
}

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

/** OCR: letras leídas en lugar de cifras dentro de un CIF ("B394S6781" → "B39456781"). */
function fixTaxIdDigits(text: string): string {
  return text.replace(/\b([ABCDEFGHJKLMNPQRSUVWXYZ])([0-9OSIlB]{7})([0-9A-J])\b/g, (m, a: string, mid: string, c: string) => {
    if ((mid.match(/\d/g) ?? []).length < 5) return m;
    return `${a}${mid.replace(/[OSIlB]/g, (ch) => ({ O: '0', S: '5', I: '1', l: '1', B: '8' })[ch] ?? ch)}${c}`;
  });
}

function findTaxIds(rows: Row[]): TaxIdHit[] {
  const out: TaxIdHit[] = [];
  for (const row of rows) {
    const text = row.ocr ? fixTaxIdDigits(row.text).toUpperCase() : row.text.toUpperCase();
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
    CIF_SEP_RE.lastIndex = 0;
    while ((m = CIF_SEP_RE.exec(text))) {
      const id = `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`;
      if (validCif(id)) push(id, m.index, true);
    }
    if (row.ocr) {
      CIF_SEP_OCR_RE.lastIndex = 0;
      while ((m = CIF_SEP_OCR_RE.exec(text))) {
        const digits = `${m[2]}${m[3]}`;
        const known = KNOWN_SUPPLIERS.find((k) => k.taxId.slice(1) === digits);
        if (known) push(known.taxId, m.index + m[0].indexOf(m[1]), true);
      }
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
    if (row.ocr) {
      // "CIF: 886345678": la letra inicial leída como cifra (B→8, G→6, S→5, D→0, A→4). Tras la etiqueta CIF/NIF un
      // número de 9 cifras no puede ser un identificador válido, así que se recupera la letra (preferiblemente la que
      // cumple el dígito de control).
      const LABELED = /\b(?:C\.?\s?I\.?\s?F|N\.?\s?I\.?\s?F)\.?\s*[:.]?\s*(?:ES)?[\s-]?(\d)(\d{7})[\s-]?([0-9A-J])\b/g;
      const FIRST: Record<string, string[]> = { '8': ['B'], '6': ['G'], '5': ['S'], '0': ['D', 'Q'], '4': ['A'], '3': ['B'], '1': ['J'] };
      LABELED.lastIndex = 0;
      while ((m = LABELED.exec(text))) {
        const letters = FIRST[m[1]];
        if (!letters) continue;
        const cands = letters.map((l) => `${l}${m?.[2]}${m?.[3]}`);
        const valid = cands.find((c) => validCif(c));
        const id = valid ?? cands[0];
        push(id, m.index + m[0].length - 9, !!valid);
      }
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

const SUPPLIER_LABEL_RE = /\b(?:proveedor|emisor|vendedor|razon\s*social|expedidor)\b\s*[:.]?/;
/** Etiqueta que abre el bloque del proveedor ("Emisor", "Proveedor:", "Datos del emisor"). */
const SUPPLIER_LABEL_START_RE = /^(?:datos\s*(?:del\s*)?)?(?:proveedor|emisor|vendedor|expedidor)\s*[:.]?(?:\s|$)/;

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
    let prevCw = row.cw;
    for (const w of row.words) {
      // El hueco se mide con la letra de las propias palabras (un rótulo grande tiene espacios más anchos)
      const cw = Math.max(row.cw, Math.min(prevCw, (w.x1 - w.x0) / Math.max(1, w.raw.length)));
      prevCw = (w.x1 - w.x0) / Math.max(1, w.raw.length);
      if (cur && w.x0 - cur.x1 <= cw * 1.6) {
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
  /^(?:factura|fra\b|albaran|ticket|original|copia|duplicado|pagina|pag\b|hoja|fecha|n[ºo°]|numero|num\b|cliente|n\.\s*cliente|datos|pedido|dto\b|dcto\b|descuento|pronto\s*pago|peso\b|bultos|envases|entregad[oa]|merc\.|forma\s*de\s*pago|vencimiento|c\.?i\.?f|n\.?i\.?f|dni|tel|tlf|telf|telefono|movil|fax|email|e-mail|correo|web|www|http|iban|swift|bic|cuenta|entidad|domicilio|direccion|codigo|cod\b|serie|documento|simplificada|rectificativa|proforma|presupuesto|agente|ruta|vendedor|repartidor|hora|caja\b|terminal|operador|atendido|descripcion|concepto|cantidad|precio|importe|total|base|iva|inscrita|registro|r\.?m\.?|tomo|folio|seccion|pagare|transferencia|recibo|contado|giro|confirming|efectivo|tarjeta)\b/;
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
      // OCR: la «S» de la forma social leída como «$» o «5» ("Obrador Campos $.L.", "Cash Sáez 5. Coop.")
      .replace(/(^|[\s,])[$5]\.\s?(L|A|COOP)\b/gi, '$1S.$2')
      .replace(/\b(?:C\.?I\.?F|N\.?I\.?F|DNI|NIF\/CIF|CIF\/NIF)\.?\s*[:.]?\s*(?:ES)?[A-Z0-9-]{8,11}\b.*$/i, '')
      .replace(SUPPLIER_LABEL_RE, '')
      .replace(/^[\s·•|:,.-]+|[\s·•|:,-]+$/g, ''),
  );
}

// "Nº" también cuando el OCR lee el ordinal como comillas, asterisco o acento
// (y como "?", "%" o "2": "FACTURA N?: 046165", "N*%: 2026/4161", "N2  FV-38419")
const NS = '(?:n\\.?\\s?(?:[ºo°"\'*´`?%]{1,2}|2(?=\\s+\\S*\\d))|num(?:ero)?|nro|n)\\.?';
const INVOICE_NUMBER_LABEL = new RegExp(
  '(?:' +
  [
    `\\b${NS}\\s*(?:de\\s*)?(?:factura|fra\\.?|documento|doc\\.?|ticket)\\b`,
    `\\b(?:factura|fra\\.?)\\s*(?:simplificada\\s*|rectificativa\\s*)?(?:${NS})?(?=[\\s:#.]|$)`,
    `\\b(?:documento|doc\\.|ticket|invoice)\\s*(?:${NS}|no\\.?|number|#)?`,
    `\\bnumero\\b`,
    `\\bn\\.?\\s?[ºo°"'*´\`?%]{1,2}\\.?(?=\\s*[:.]?\\s*[a-z]{0,4}[-/]?\\d)`,
  ]
    .map((p) => `(?:${p})`)
    .join('|') +
    ')\\s*[:#.]*\\s*',
  'g',
);
const NUMBER_NEG = /(?:cliente|pedido|albaran|cuenta|proveedor|lote|telefono|registro|pagina|hoja|agente|ruta|vendedor|caja|terminal|operacion|tarjeta|autorizacion|s\/ref|serie)\W*$/;

/** Valor de una rejilla en la fila siguiente, bajo la etiqueta (sin fechas, horas, códigos postales ni años sueltos). */
function valueBelow(rows: Row[], ri: number, labelX: number): string | undefined {
  const row = rows[ri];
  const next = rows[ri + 1];
  if (!next) return undefined;
  const cand = next.words
    .filter((w, k) => {
      if (!/\d/.test(w.raw) || parseDateEs(w.raw) || /^\d{1,2}:\d{2}/.test(w.raw) || w.raw.replace(/[^\dA-Za-z]/g, '').length < 3) return false;
      // Ni códigos postales ("46811 Valencia") ni años de una fecha en letra ("9 de junio de 2025")
      if (/^\d{5}$/.test(w.raw) && /^\p{L}{3,}/u.test(next.words[k + 1]?.raw ?? '')) return false;
      if (/^(?:19|20)\d{2}$/.test(w.raw) && next.words[k - 1]?.f === 'de') return false;
      return true;
    })
    .map((w) => ({ w, d: Math.abs(w.x0 - labelX) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!cand || cand.d > (row.positional ? 60 : 12)) return undefined;
  return cand.w.raw;
}

/**
 * OCR: paréntesis de cierre leído como «1», «l» o «|» tras un grupo de 3–4 cifras de un número de documento
 * ("0/0(04710263/(2026)058214" → "0/0(047)0263/(2026)058214"). Sólo si hay paréntesis sin cerrar.
 */
export function repairDocNumberParens(value: string): string {
  let out = value.replace(/[[{]/g, '(').replace(/[\]}]/g, ')');
  for (let k = 0; k < 3; k++) {
    if ((out.match(/\(/g) ?? []).length <= (out.match(/\)/g) ?? []).length) break;
    const next = out.replace(/\((\d{3,4})[1lI|](?=[\d/(-])/, '($1)');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Número de documento en la fila de debajo de un título suelto ("Factura" / "0/0 (047)0263/ (2026) 058214"): una tira
 * de cifras con separadores (al menos 8 cifras), sin fechas ni identificadores fiscales. Se quitan los espacios que
 * mete el OCR y se reparan los paréntesis.
 */
function numberRunBelow(rows: Row[], ri: number): string | undefined {
  const next = rows[ri + 1];
  if (!next || next.page !== rows[ri].page || REGISTRY_RE.test(next.f)) return undefined;
  for (const seg of segmentsOf(next)) {
    const run = docNumberRun(seg.text);
    if (run) return run;
  }
  return undefined;
}

/** Tira de cifras con separadores de un número de documento (ver `numberRunBelow`), sin espacios y reparada. */
function docNumberRun(text: string): string | undefined {
  const run = repairDocNumberParens(text.replace(/\s+/g, ''));
  if (!/^[A-Z]{0,4}[-/]?[\d/()\-.]+$/i.test(run) || !/[/()-]/.test(run) || run.replace(/\D/g, '').length < 8) return undefined;
  if (parseDateEs(run) || hasTaxId(run) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(run)) return undefined;
  return run;
}

function extractInvoiceNumber(rows: Row[]): string | undefined {
  let best: { value: string; score: number; row: Row } | undefined;
  const consider = (raw: string, score: number, ri: number) => {
    // OCR: las letras de un número de factura van en mayúsculas ("Fv-38419" es "FV-38419")
    const value = rows[ri].ocr ? raw.replace(/[.,:;]+$/, '').toUpperCase() : raw.replace(/[.,:;]+$/, '');
    if (parseDateEs(value) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(value) || /^\d{1,2}:\d{2}/.test(value)) return;
    if (/^(?:ES)?[A-Z]\d{7}[0-9A-J]$/i.test(value) || /^\d{8}[A-Z]$/i.test(value)) return;
    if (value.replace(/[^\d]/g, '').length < 1 || value.length > 30) return;
    const s = score + (ri < 15 ? 1 : 0);
    if (!best || s > best.score) best = { value, score: s, row: rows[ri] };
  };
  rows.forEach((row, ri) => {
    // Datos registrales ("T. 3.669 L. 0 F. 86, Secc. 8.ª H. M-61.688"): nunca el número de factura
    if (REGISTRY_RE.test(row.f)) return;
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
      // "Fecha factura", "F. factura", "Vto. factura": etiquetas de fecha, no de número; "Total factura": un importe
      if (/(?:fecha|f\.|fec\.?|vto\.?|vencimiento|total|importe|base|suma|neto)\s*(?:de\s*)?(?:la\s*)?$/.test(before)) continue;
      if (!strong && NUMBER_NEG.test(before)) continue;
      if (/(?:cliente|pedido|albaran|proveedor)\s*$/.test(before) && !/factura/.test(label)) continue;
      const withNo = new RegExp(NS).test(label.replace(/factura|fra/, ''));
      let score = /factura|fra/.test(label) ? (withNo ? 10 : 7) : /documento|doc|invoice|ticket/.test(label) ? 6 : 4;
      const rest = text.slice(m.index + label.length);
      const tok = /^([A-Za-z]{0,6}[-/.]?\d[A-Za-z0-9\-/._]*|\d[A-Za-z0-9\-/._]*)/.exec(rest);
      let value = tok?.[1];
      // Un día seguido del mes ("26 de enero") es una fecha; "397,43" es un importe
      if (value && /^\d{1,2}$/.test(value) && /^\d{1,2}\s+de\s+[a-z]/i.test(fold(rest))) continue;
      if (value && /^\d+$/.test(value) && new RegExp(`^${value}[.,]\\d{2}(?!\\d)`).test(rest)) continue;
      // Título suelto seguido, tras un hueco, del número con paréntesis (y los espacios que mete el OCR):
      // "Factura    0/0 (047)0263/ (2026) 058214" — el primer trozo ("0/0") no es el número
      const labelEnd = m.index + label.length;
      const nextSeg = /factura|fra/.test(label) && !withNo && !f.slice(0, m.index).trim() ? segmentsOf(row).find((sg) => sg.x0 >= (row.positional ? xAtChar(row, labelEnd) : labelEnd)) : undefined;
      const sameRow = nextSeg ? docNumberRun(nextSeg.text) : undefined;
      if (sameRow && (!value || (sameRow.startsWith(value.replace(/[.,:;]+$/, '')) && sameRow.length > value.length))) {
        consider(sameRow, 7, ri);
        continue;
      }
      if (!value || !/\d/.test(value)) {
        // Título suelto en su fila ("Factura") con el número entero en la fila de debajo, aunque no esté alineado
        const lone = /factura|fra/.test(label) && !withNo && !f.slice(0, m.index).trim() && !rest.replace(/[\s:.#]+/g, '');
        const run = lone ? numberRunBelow(rows, ri) : undefined;
        if (run) {
          consider(run, 7, ri);
          continue;
        }
        // El título suelto ("FACTURA") no es una etiqueta de número fiable para el valor de debajo
        if (/factura|fra/.test(label) && !withNo) score = 3;
        value = valueBelow(rows, ri, row.positional ? xAtChar(row, m.index) : m.index);
        if (!value) continue;
        score -= 3;
      }
      consider(value, score, ri);
    }
    // Rejilla de datos con la celda «Nº» / «Número» sola ("Nº | Fecha | Cliente") y el valor debajo
    const segs = segmentsOf(row);
    if (segs.length >= 2 && segs.every((s) => !/\d/.test(s.text))) {
      for (const seg of segs) {
        if (!/^(?:n\.?\s?[ºo°]\.?|num(?:ero)?\.?|nro\.?)$/.test(fold(seg.text))) continue;
        const value = valueBelow(rows, ri, seg.x0);
        if (value) consider(value, 2, ri);
      }
    }
  });
  if (!best) return albaranNumber(rows);
  // Serie aparte: "Serie F  Número 2026/1452" → "F-2026/1452"
  const serie = /\bserie\s*[:.]?\s*([A-Z0-9]{1,4})\b/i.exec(best.row.text);
  if (serie && !best.value.toUpperCase().startsWith(serie[1].toUpperCase()) && serie[1] !== best.value) return `${serie[1]}-${best.value}`;
  return best.value;
}

const ALBARAN_LABEL = new RegExp(`(?:\\b(?:albaran|nota\\s*de\\s*entrega|alb\\.)\\s*(?:valorado\\s*)?(?:${NS})?|\\b${NS}\\s*(?:de\\s*)?(?:albaran|alb\\b\\.?))\\s*[:#.]?\\s*`, 'g');

/** Número de un albarán valorado (sólo si el documento no trae número de factura). */
function albaranNumber(rows: Row[]): string | undefined {
  const valid = (v: string | undefined) => {
    if (!v) return undefined;
    const value = v.replace(/[.,:;]+$/, '');
    if (parseDateEs(value) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(value) || value.replace(/[^\d]/g, '').length < 2) return undefined;
    return value;
  };
  // Primero el valor en la misma celda que la etiqueta ("Albarán nº 332683"); sólo si no hay ninguno, debajo de ella
  for (const below of [false, true]) {
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const f = foldKeepLength(row.text);
      ALBARAN_LABEL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ALBARAN_LABEL.exec(f))) {
        if (!m[0].length) {
          ALBARAN_LABEL.lastIndex++;
          continue;
        }
        let value: string | undefined;
        if (!below) value = valid(/^([A-Za-z]{0,6}[-/.]?\d[A-Za-z0-9\-/._]*)/.exec(row.text.slice(m.index + m[0].length))?.[1]);
        else if (rows[ri + 1]) {
          // Valor debajo de la etiqueta (rejilla), que no sea el de otra etiqueta de su fila ("Cód. cliente 05994")
          const next = rows[ri + 1];
          const labelX = row.positional ? xAtChar(row, m.index) : m.index;
          const cand = next.words
            .filter((w, k) => /\d/.test(w.raw) && !parseDateEs(w.raw) && w.raw.replace(/[^\dA-Za-z]/g, '').length >= 3 && !NUMBER_NEG.test(next.words.slice(Math.max(0, k - 3), k).map((x) => x.f).join(' ')))
            .map((w) => ({ w, d: Math.abs(w.x0 - labelX) }))
            .sort((a, b) => a.d - b.d)[0];
          if (cand && cand.d <= (row.positional ? 60 : 12)) value = valid(cand.w.raw);
        }
        if (value) return value;
      }
    }
  }
  return undefined;
}

interface HeaderInfo {
  supplierName?: string;
  supplierTaxId?: string;
  number?: string;
  date?: string;
}

// ───────────────────────────── Bloques de la cabecera del documento ─────────────────────────────

/** Etiqueta que abre el bloque del cliente ("Cliente", "Facturar a", "Datos del cliente", "Sr./Sres.", "Destinatario"). */
const CUSTOMER_LABEL_RE =
  /^(?:clientes?|datos\s*(?:fiscales\s*)?(?:del\s*)?cliente|facturar\s*a|facturado\s*a|destinatario|enviar\s*a|entregar\s*a|direccion\s*(?:de\s*)?(?:entrega|envio)|lugar\s*de\s*entrega|comprador|receptor|sr\.?\s*[/il|1]?\s*sres\.?|sres\.?|senor(?:es)?|a\/a|attn)\s*[:.]?(?:\s|$)/;
/** Celda con el código y el nombre del cliente dentro de la caja de datos ("Cód. cliente 0094 · Bar X S.L."). */
const CUSTOMER_CODE_SEG_RE = /^(?:cod\.?\s*(?:de\s*)?cliente|n[ºo°]\.?\s*(?:de\s*)?cliente|cliente\s*n[ºo°]\.?|num\.?\s*cliente|clientes?)\s*[:.]?\s*\S/;
/** Fila con el identificador fiscal del cliente ("NIF cliente", "CIF del cliente"). */
const CUSTOMER_ID_RE = /\b(?:n\.?\s?i\.?\s?f|c\.?\s?i\.?\s?f|dni)\.?\s*(?:del\s*)?cliente\b|\bcliente\s*(?:n\.?i\.?f|c\.?i\.?f)\b/;

interface Block {
  segs: Segment[];
  x0: number;
  x1: number;
  page: number;
  firstRow: number;
  lastY: number;
  closed: boolean;
  customer: boolean;
  /** Celdas del cliente dentro de un bloque que no es suyo (caja de datos con "Cliente: 0094 · Bar X", "NIF: …"). */
  customerSegs: Set<Segment>;
  /** Abierto por una etiqueta del proveedor ("Emisor", "Proveedor", "Datos del emisor"). */
  supplierLabel?: boolean;
}

/**
 * Bloques de texto de la cabecera (proveedor, cliente, datos del documento…): cada celda de cada fila se une al bloque
 * de encima con el que se solapa o se alinea (izquierda o derecha) si está cerca en vertical. Así se separan el
 * proveedor y el cliente aunque compartan filas (uno a cada lado), y el bloque del cliente queda entero bajo su etiqueta.
 */
function headerBlocks(zone: Row[]): Block[] {
  const blocks: Block[] = [];
  const ys: number[] = [];
  for (let k = 1; k < zone.length; k++) if (zone[k].page === zone[k - 1].page && zone[k].y > zone[k - 1].y) ys.push(zone[k].y - zone[k - 1].y);
  const pitch = ys.length ? median(ys) : 1;
  for (const row of zone) {
    if (!row.f.trim()) continue;
    const segs = segmentsOf(row).filter((sg) => /[\p{L}\d]/u.test(sg.text));
    if (!segs.length) {
      // Separador ("-----"): cierra los bloques abiertos
      for (const b of blocks) b.closed = true;
      continue;
    }
    const cw = row.positional ? row.cw : 1;
    let labelBlock: Block | undefined;
    let prevSeg: Segment | undefined;
    for (const sg of segs) {
      const ft = fold(collapseSpaces(sg.text));
      const company = COMPANY_SUFFIX_RE.test(ft);
      // La etiqueta del cliente (o del proveedor) abre siempre un bloque nuevo y se lleva lo que la sigue en su fila
      const supplierLabel = SUPPLIER_LABEL_START_RE.test(ft);
      if (CUSTOMER_LABEL_RE.test(ft) || supplierLabel) {
        labelBlock = { segs: [sg], x0: sg.x0, x1: sg.x1, page: row.page, firstRow: row.i, lastY: row.y, closed: false, customer: !supplierLabel, supplierLabel, customerSegs: new Set() };
        blocks.push(labelBlock);
        prevSeg = sg;
        continue;
      }
      if (labelBlock && prevSeg && sg.x0 - prevSeg.x1 <= cw * 8) {
        labelBlock.segs.push(sg);
        labelBlock.x1 = Math.max(labelBlock.x1, sg.x1);
        prevSeg = sg;
        continue;
      }
      labelBlock = undefined;
      prevSeg = sg;
      let best: Block | undefined;
      let bestScore = 0;
      for (const b of blocks) {
        if (b.closed || b.page !== row.page || row.y - b.lastY > Math.max(pitch * 2.3, row.positional ? cw * 5 : 2.01)) continue;
        // Una segunda razón social empieza otro bloque (el proveedor debajo del cliente o al revés)
        if (company && b.segs.some((o) => o.row !== sg.row && COMPANY_SUFFIX_RE.test(fold(collapseSpaces(o.text))))) continue;
        const ov = Math.min(sg.x1, b.x1) - Math.max(sg.x0, b.x0);
        const aligned = Math.abs(sg.x0 - b.x0) <= cw * 3 || Math.abs(sg.x1 - b.x1) <= cw * 3;
        if (ov <= 0 && !aligned) continue;
        const score = Math.max(0, ov) + (aligned ? cw * 20 : 0) - (row.y - b.lastY);
        if (!best || score > bestScore) {
          best = b;
          bestScore = score;
        }
      }
      if (best) {
        best.segs.push(sg);
        best.x0 = Math.min(best.x0, sg.x0);
        best.x1 = Math.max(best.x1, sg.x1);
        best.lastY = row.y;
      } else blocks.push({ segs: [sg], x0: sg.x0, x1: sg.x1, page: row.page, firstRow: row.i, lastY: row.y, closed: false, customer: false, customerSegs: new Set() });
    }
  }
  for (const b of blocks) {
    const texts = b.segs.map((sg) => fold(collapseSpaces(sg.text)));
    b.customer ||= texts.slice(0, 3).some((t) => CUSTOMER_LABEL_RE.test(t)) || texts.some((t) => CUSTOMER_ID_RE.test(t));
    if (b.customer) continue;
    // Caja de datos con el cliente dentro: su celda y la del identificador fiscal que la sigue son del cliente
    const isTaxLabel = (sg: Segment | undefined) => !!sg && /^(?:n\.?\s?i\.?\s?f|c\.?\s?i\.?\s?f|dni|nif\/cif|cif\/nif)\b/.test(fold(collapseSpaces(sg.text)));
    // Celda a la derecha en la misma fila (en una caja etiqueta | valor, el valor puede caer en otro bloque)
    const rightOf = (sg: Segment): { seg: Segment; block: Block } | undefined => {
      let best: { seg: Segment; block: Block } | undefined;
      for (const o of blocks) for (const x of o.segs) if (x.row === sg.row && x.x0 > sg.x1 && (!best || x.x0 < best.seg.x0)) best = { seg: x, block: o };
      return best;
    };
    texts.forEach((t, k) => {
      const sg = b.segs[k];
      let value: { seg: Segment; block: Block } | undefined;
      if (CUSTOMER_CODE_SEG_RE.test(t) && /\p{L}{3}/u.test(t.replace(CUSTOMER_CODE_SEG_RE, ''))) value = { seg: sg, block: b };
      else if (/^(?:cod\.?\s*(?:de\s*)?cliente|n[ºo°]\.?\s*(?:de\s*)?cliente|cliente\s*n[ºo°]\.?|clientes?)\s*[:.]?$/.test(t)) {
        // Etiqueta sola en su celda ("Cód. cliente" | "0094 · Bar X S.L.")
        const r = rightOf(sg);
        if (r && /\p{L}{3}/u.test(r.seg.text)) {
          b.customerSegs.add(sg);
          value = r;
        }
      }
      if (!value) return;
      value.block.customerSegs.add(value.seg);
      // El NIF que sigue (celda siguiente del bloque de la etiqueta, con su valor a la derecha) también es del cliente
      for (const o of b.segs.slice(k + 1, k + 3)) {
        if (o === value.seg) continue;
        if (hasTaxId(o.text)) {
          b.customerSegs.add(o);
          break;
        }
        if (isTaxLabel(o)) {
          b.customerSegs.add(o);
          const r = rightOf(o);
          if (r && hasTaxId(r.seg.text)) r.block.customerSegs.add(r.seg);
          break;
        }
      }
      if (value.block !== b) {
        const vi = value.block.segs.indexOf(value.seg);
        const nv = value.block.segs[vi + 1];
        if (nv && hasTaxId(nv.text) && isTaxLabel(b.segs.find((x) => x.row === nv.row))) value.block.customerSegs.add(nv);
      }
    });
  }
  return blocks;
}

/** ¿Es un EAN-13 válido (13 cifras con su dígito de control)? */
export function isEan13(token: string): boolean {
  if (!/^\d{13}$/.test(token)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(token[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(token[12]);
}

/**
 * ¿Identificador fiscal en la columna de la etiqueta del número de cliente ("N.cliente: 427…" y, una o dos filas
 * debajo, "N.I.F.: B…")? En las facturas de cash & carry la caja del cliente va aparte de su razón social.
 */
function underCustomerNumber(rows: Row[], hit: TaxIdHit): boolean {
  const row = rows[hit.row];
  const cw = Math.max(row.cw, 1);
  const own = segmentsOf(row)
    .filter((sg) => sg.x0 <= hit.x + cw)
    .pop();
  if (!own) return false;
  // La celda del identificador: su valor y la etiqueta de su izquierda ("N.I.F.:" | "B…"), si van separados
  const ownSegs = segmentsOf(row);
  const ownAt = ownSegs.indexOf(own);
  const mine = [own, ownSegs[ownAt - 1]].filter((x): x is Segment => !!x && own.x0 - x.x1 <= cw * 14);
  for (let k = hit.row; k >= Math.max(0, hit.row - 3); k--) {
    const r = rows[k];
    if (r.page !== row.page) break;
    const segs = segmentsOf(r);
    for (let j = 0; j < segs.length; j++) {
      const sg = segs[j];
      if (!CUSTOMER_NO_RE.test(fold(sg.text))) continue;
      if (k === hit.row) {
        if (sg.x0 <= hit.x) return true;
        continue;
      }
      // Etiquetas (o valores) alineados a la izquierda o a la derecha ("N.cliente: 427…" / "   N.I.F.: B…")
      const tol = Math.max(cw, r.cw) * 4;
      const cell = [sg, segs[j + 1]].filter((x): x is Segment => !!x && x.x0 - sg.x1 <= r.cw * 14);
      if (cell.some((c) => mine.some((m) => Math.abs(c.x0 - m.x0) <= tol || Math.abs(c.x1 - m.x1) <= tol))) return true;
    }
  }
  return false;
}

/** ¿La etiqueta del CIF/NIF de esta fila está justo debajo de una etiqueta de cliente (misma X) de la fila anterior? */
function idUnderCustomerLabel(prev: Row, row: Row, idX: number): boolean {
  const label = segmentsOf(row)
    .filter((sg) => sg.x1 <= idX + row.cw && /^(?:n\.?\s?i\.?\s?f|c\.?\s?i\.?\s?f|dni|nif\/cif|cif\/nif)\b/.test(fold(sg.text)))
    .pop();
  if (!label) return false;
  const tol = Math.max(row.cw, prev.cw) * 2;
  return segmentsOf(prev).some((sg) => Math.abs(sg.x0 - label.x0) <= tol && /^(?:cliente|cod\.?\s*cliente|destinatario|comprador)\b/.test(fold(sg.text)));
}

/** Etiquetas de una caja de datos del documento (a la izquierda de su valor). */
const META_LABEL_SEG_RE =
  /^(?:factura|fra\b|n[ºo°*?"]|numero|num\b|fecha|f\.|fec\b|cliente|cod\b|cod\.|codigo|n\.?\s?i\.?\s?f|c\.?\s?i\.?\s?f|dni|nif|cif|f\.?\s*pago|forma\s*de\s*pago|pago|vencimiento|vto|pedido|albaran|pagina|hoja|serie|ruta|agente|comercial|su\s*ref|s\/ref)\b.{0,20}$/;

const LOGO_RE = /^[A-ZÑÁÉÍÓÚ&.]{1,5}$/;

/** ¿Parece una razón social o nombre comercial (no una dirección, un teléfono, una etiqueta…)? */
function nameCandidate(text: string): boolean {
  const t = collapseSpaces(text);
  const f = fold(t);
  if (f.replace(/[^a-z]/g, '').length < 3) return false;
  // Más cifras que letras: un código o un NIF mal leído ("EE240031-P"), no un nombre
  if (f.replace(/[^0-9]/g, '').length > f.replace(/[^a-z]/g, '').length) return false;
  // Sólo la forma jurídica ("S.L.U." de una razón social partida en dos filas)
  if (f.replace(COMPANY_SUFFIX_RE, '').replace(/[^a-z]/g, '').length < 3) return false;
  if (NOT_NAME_RE.test(f) || ADDRESS_RE.test(f) || CUSTOMER_LABEL_RE.test(f)) return false;
  if (/@|www\.|https?:|\.com\b|\.es\b/.test(f)) return false;
  if (/\b\d{5}\b/.test(f) && !COMPANY_SUFFIX_RE.test(f)) return false;
  if (/\b[69]\d{2}[\s.]?\d{2,3}[\s.]?\d{2,3}[\s.]?\d{0,3}\b/.test(f)) return false;
  if (/:$/.test(t)) return false;
  return true;
}

function parseDocHeader(rows: Row[], headerEnd: number, allRows: Row[], excludeRows: Set<number>): HeaderInfo {
  const zone = rows.slice(0, Math.max(1, headerEnd));
  const blocks = headerBlocks(zone);
  const blockOfSeg = (rowIdx: number, x: number) => blocks.find((b) => b.segs.some((sg) => sg.row === rowIdx && x >= sg.x0 - 1 && x <= sg.x1 + 1));
  const customerSeg = (rowIdx: number, x: number) => {
    const b = blockOfSeg(rowIdx, x);
    if (b?.customer || CUSTOMER_ID_RE.test(allRows[rowIdx]?.f ?? '')) return true;
    return !!b && [...b.customerSegs].some((sg) => sg.row === rowIdx && x >= sg.x0 - 1 && x <= sg.x1 + 1);
  };

  // Pie legal ("Distribuciones X S.L. · CIF B12345678 · Inscrita en el Registro Mercantil…"): razón social y CIF juntos
  const footer: { name: string; id: string }[] = [];
  const footerIds: { id: string; row: Row; valid: boolean }[] = [];
  for (const row of allRows) {
    if (row.i < headerEnd || excludeRows.has(row.i) || CUSTOMER_ID_RE.test(row.f)) continue;
    const ids = findTaxIds([row]);
    if (!ids.length) continue;
    for (const h of ids) footerIds.push({ id: h.id, row, valid: h.valid });
    for (const sg of segmentsOf(row)) {
      const parts = sg.text.split(/\s[·•|]\s|\s-\s/);
      for (let k = 0; k < parts.length; k++) {
        const name = cleanName(parts[k]);
        if (!COMPANY_SUFFIX_RE.test(fold(name)) || !nameCandidate(name)) continue;
        footer.push({ name, id: ids[0].id });
      }
    }
  }

  // Bloque del proveedor: el que no es del cliente y tiene razón social, CIF, dirección o teléfono
  const zoneIds = findTaxIds(zone);
  let supplierBlock: Block | undefined;
  {
    let bestScore = 0;
    const top = Math.min(...blocks.map((b) => b.firstRow));
    for (const b of blocks) {
      if (b.customer) continue;
      const texts = b.segs.filter((sg) => !b.customerSegs.has(sg)).map((sg) => fold(collapseSpaces(sg.text)));
      let score = b.supplierLabel ? 8 : 0;
      if (zoneIds.some((h) => blockOfSeg(h.row, h.x) === b && !customerSeg(h.row, h.x))) score += 5;
      if (texts.some((t) => COMPANY_SUFFIX_RE.test(t))) score += 4;
      if (texts.some((t) => BUSINESS_RE.test(t))) score += 1;
      if (texts.some((t) => ADDRESS_RE.test(t) || /\b\d{5}\b/.test(t))) score += 2;
      if (texts.some((t) => /\btel|telf|telefono|@|www\./.test(t))) score += 1;
      // Datos registrales (Registro Mercantil): siempre del emisor, aunque su CIF se haya leído mal
      if (texts.some((t) => REGISTRY_RE.test(t))) score += 4;
      if (texts.some((t) => /\b(?:factura|fecha|albaran|ticket)\b/.test(t))) score -= 3;
      if (b.firstRow === top) score += 1;
      if (b.segs.length >= 2) score += 1;
      // Columna de valores de una caja de datos ("Nº factura | 2026/0720", "Cliente | Mesón X S.L.", "N.I.F. | B…"):
      // cada valor tiene su etiqueta a la izquierda; no es el bloque del proveedor
      const values = b.segs.filter((sg) => {
        const row = allRows[sg.row];
        return !!row && segmentsOf(row).some((o) => o.x1 <= sg.x0 && sg.x0 - o.x1 <= row.cw * 14 && META_LABEL_SEG_RE.test(fold(collapseSpaces(o.text))));
      }).length;
      if (values >= Math.max(2, b.segs.length * 0.5)) score -= 12;
      if (score > bestScore) {
        bestScore = score;
        supplierBlock = b;
      }
    }
    if (bestScore < 4) supplierBlock = undefined;
  }

  // Razón social: tras una etiqueta de proveedor en la misma celda ("Proveedor: X S.L.")
  let supplierName: string | undefined;
  for (const row of zone) {
    for (const sg of segmentsOf(row)) {
      const f = foldKeepLength(sg.text);
      const m = SUPPLIER_LABEL_RE.exec(f);
      if (!m) continue;
      const after = cleanName(sg.text.slice(m.index + m[0].length));
      if (after && nameCandidate(after)) {
        supplierName = after;
        break;
      }
    }
    if (supplierName) break;
  }
  // Razón social partida en dos filas que corta en una palabra de enlace: "Frutas y Verduras del" / "Cantábrico C.B."
  const CONNECTOR_END = /(?:^|\s)(?:de|del|la|las|los|el|y|e|&|-)$/i;
  // Dos filas seguidas del mismo rótulo: alineadas a la izquierda y con la misma letra
  const segCw = (x: Segment) => (x.x1 - x.x0) / Math.max(1, collapseSpaces(x.text).length);
  const sameName = (a: Segment, c: Segment): boolean => {
    const ra = allRows[a.row];
    const rc = allRows[c.row];
    if (!ra || !rc || ra.page !== rc.page || c.row <= a.row || !ra.positional) return false;
    const cwa = segCw(a);
    const cwc = segCw(c);
    const cw = Math.max(cwa, cwc);
    // Siguiente línea del mismo rótulo: justo debajo (una línea de su letra), alineada (izquierda, derecha o centro) y
    // con la misma letra
    const aligned = Math.min(Math.abs(a.x0 - c.x0), Math.abs(a.x1 - c.x1), Math.abs(a.x0 + a.x1 - c.x0 - c.x1) / 2) <= cw * 2;
    return rc.y - ra.y <= cw * 3.4 && aligned && Math.abs(cwa - cwc) <= cw * 0.15;
  };
  const plainName = (x: Segment) => {
    const t = cleanName(x.text);
    // Un nombre de verdad (no las siglas del logotipo, "U D L", ni un rótulo espaciado, "P R OVEE D O R")
    if (!/\p{L}{3,}/u.test(t) || LOGO_RE.test(t.replace(/\s+/g, ''))) return false;
    if (/^(?:datos(?:del)?)?(?:proveedor|emisor|vendedor|expedidor|cliente|destinatario|facturara)/.test(fold(t).replace(/[^a-z]/g, ''))) return false;
    return nameCandidate(t) && !/\d/.test(t) && !COMPANY_SUFFIX_RE.test(fold(t)) && !SUPPLIER_LABEL_RE.test(fold(t)) && !CUSTOMER_LABEL_RE.test(fold(t));
  };
  // (con la forma jurídica suelta de su misma fila aunque haya caído en otro bloque: "Cash Costa Brava," | "S.A.")
  const withSuffix = (sg: Segment, b: Block): string => {
    const suffix = blocks.flatMap((o) => (o === b ? [] : o.segs)).filter((x) => x.row === sg.row && x.x0 > sg.x1 && /^(?:s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?coop\.?|c\.?\s?b\.?)$/i.test(collapseSpaces(x.text)));
    return extendName(sg, [...b.segs, ...suffix].sort((p, q) => p.row - q.row || p.x0 - q.x0));
  };
  // Tramo de una fila a partir de un segmento: los segmentos siguientes muy próximos ("Aragón" + "S.L.")
  const runFrom = (o: Segment, segs: Segment[]): Segment => {
    const same = segs.filter((x) => x.row === o.row && x.x0 >= o.x0).sort((a, c) => a.x0 - c.x0);
    const out = { ...o };
    for (const x of same.slice(1)) {
      if (x.x0 - out.x1 > segCw(o) * 3) break;
      out.text = `${out.text} ${x.text}`;
      out.x1 = x.x1;
    }
    return out;
  };
  const extendName = (sgIn: Segment, segsIn: Segment[]): string => {
    const segs = segsIn.map((o) => runFrom(o, segsIn)).filter((o, _k, all) => !all.some((p) => p !== o && p.row === o.row && p.x0 < o.x0 && p.x1 >= o.x1));
    const sg = segs.find((o) => o.row === sgIn.row && o.x0 === sgIn.x0) ?? sgIn;
    let text = cleanName(sg.text);
    const at = segs.indexOf(sg);
    const prev = segs[at - 1];
    const hasSuffix = COMPANY_SUFFIX_RE.test(fold(text));
    // "Importaciones Bodegas Sierra" / "Norte S.L.U.": la fila de encima, con la misma letra, es el principio del nombre
    const prevSeg = hasSuffix ? segs.filter((o) => o !== sg && o.row < sg.row && plainName(o) && sameName(o, sg)).pop() : undefined;
    if (prevSeg) text = `${cleanName(prevSeg.text)} ${text}`;
    else if (prev && prev.row < sg.row && nameCandidate(cleanName(prev.text)) && CONNECTOR_END.test(collapseSpaces(prev.text))) {
      text = `${cleanName(prev.text)} ${text}`;
    }
    // Filas siguientes del rótulo (hasta dos): el primer segmento de debajo que se solapa en X (no el de otra columna)
    let cur = sg;
    for (let step = 0; step < 2 && !COMPANY_SUFFIX_RE.test(fold(text)); step++) {
      const c = cur;
      const next = segs.filter((o) => o.row > c.row && o.x0 < c.x1 && o.x1 > c.x0).sort((a, d) => a.row - d.row)[0];
      if (!next) break;
      const nt = collapseSpaces(next.text);
      // "Frutas y Verduras del" / "Cantábrico …": corta en una palabra de enlace
      if (CONNECTOR_END.test(text) && !/\d/.test(nt)) {
        text = `${text} ${cleanName(nt)}`;
        cur = next;
        continue;
      }
      // "… Levante" / "S.A.", "… Meseta S." / "Coop."
      if (/^(?:s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?coop\.?|c\.?\s?b\.?|slu|sau)$/i.test(nt) || (/\bs\.$/i.test(text) && /^coop\.?(?:\s*and\.?)?$/i.test(nt))) {
        text = `${text} ${nt}`;
        break;
      }
      // "Comercial" / "Hostelera Carmona S.L.U.": la fila de debajo, con la misma letra, acaba en la forma jurídica
      if (sameName(c, next) && !/\d/.test(nt) && COMPANY_SUFFIX_RE.test(fold(cleanName(nt))) && nameCandidate(cleanName(nt))) text = `${text} ${cleanName(nt)}`;
      break;
    }
    return text;
  };
  if (!supplierName && supplierBlock) {
    const nameSegs = (b: Block) => b.segs.filter((sg) => !b.customerSegs.has(sg) && nameCandidate(cleanName(sg.text)) && !LOGO_RE.test(collapseSpaces(sg.text)));
    let b = supplierBlock;
    if (!nameSegs(b).length) {
      // Señas sin razón social: el nombre está en el bloque de encima (banda o rótulo con la razón social)
      const sb = supplierBlock;
      const above = blocks
        .filter((o) => o !== sb && !o.customer && o.firstRow < sb.firstRow && Math.min(o.x1, sb.x1) - Math.max(o.x0, sb.x0) > 0 && nameSegs(o).length)
        .sort((p, q) => q.firstRow - p.firstRow)[0];
      if (above) b = above;
    }
    // Lo que va tras el título del documento ("Factura", "Factura de entrega") ya es otra caja (la del cliente)
    const title = b.segs.find((sg) => /^(?:factura|albaran|ticket|nota\s*de\s*entrega)\b/.test(fold(collapseSpaces(sg.text))));
    const cands = nameSegs(b).filter((sg) => !title || sg.row < title.row || sg === b.segs[0]);
    const withCompany = cands.find((sg) => COMPANY_SUFFIX_RE.test(fold(cleanName(sg.text))));
    const pick = withCompany ?? cands[0];
    if (pick) supplierName = withSuffix(pick, b);
  }
  const number = extractInvoiceNumber(zone.length > 2 ? zone : allRows.slice(0, 20));
  // CIF / NIF del proveedor (nunca el propio número de factura, que a veces tiene la forma de un CIF: "B-20267505")
  const numberKey = number?.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const allIds = (zoneIds.length ? zoneIds : findTaxIds(allRows.filter((r) => !excludeRows.has(r.i)))).filter((h) => h.id !== numberKey);
  let supplierTaxId: string | undefined;
  let supplierIdRow: number | undefined;
  {
    let best: { hit: TaxIdHit; score: number } | undefined;
    const cands = [...allIds];
    for (const f of footerIds) if (!cands.some((h) => h.id === f.id)) cands.push({ id: f.id, row: f.row.i, x: 0, valid: f.valid });
    const nameKey = supplierName ? fold(supplierName).replace(/[^a-z0-9]+/g, ' ').trim() : '';
    for (const hit of cands) {
      let score = 0;
      const row = allRows[hit.row];
      const inZone = hit.row < headerEnd;
      if (inZone && customerSeg(hit.row, hit.x)) score -= 10;
      // Caja de datos "Cliente | Bar X" / "NIF | B…": el NIF que va justo debajo de la etiqueta del cliente es suyo
      if (inZone && row && hit.row > 0 && idUnderCustomerLabel(allRows[hit.row - 1], row, hit.x)) score -= 12;
      if (inZone && supplierBlock && blockOfSeg(hit.row, hit.x) === supplierBlock) score += 6;
      // En la columna de la etiqueta del número de cliente ("N.cliente: 427…" / "N.I.F.: B…"): es el del cliente
      if (row && underCustomerNumber(allRows, hit)) continue;
      // Junto a los datos registrales (Registro Mercantil): siempre son del emisor
      if (row && allRows.slice(Math.max(0, hit.row - 2), hit.row + 3).some((r) => r.page === row.page && REGISTRY_RE.test(r.f))) score += 4;
      if (footer.some((f) => f.id === hit.id)) score += 4;
      // En el pie, junto al nombre del proveedor ("José Pérez Gil · NIF 12345678Z")
      if (!inZone && nameKey && row && fold(row.text).replace(/[^a-z0-9]+/g, ' ').includes(nameKey)) score += 5;
      if (row && /\b(?:c\.?i\.?f|n\.?i\.?f|nif\/cif|vat)\b/.test(row.f)) score += 1;
      if (row && SUPPLIER_LABEL_RE.test(row.f)) score += 4;
      if (hit.row < 8) score += 1;
      if (hit.valid) score += 2;
      score -= hit.row * 0.02;
      if (!best || score > best.score) best = { hit, score };
    }
    if (best && best.score > -5) {
      supplierTaxId = best.hit.id;
      supplierIdRow = best.hit.row;
    }
  }

  if (!supplierName && footer.length) {
    const f = footer.find((x) => x.id === supplierTaxId) ?? footer[0];
    supplierName = f.name;
  }
  if (!supplierName) {
    // Sin bloque claro: la mejor razón social fuera de los bloques del cliente
    let best: { seg: Segment; score: number } | undefined;
    zone.slice(0, 16).forEach((row, idx) => {
      for (const seg of segmentsOf(row)) {
        const cleaned: Segment = { ...seg, text: cleanName(seg.text) };
        if (!cleaned.text || customerSeg(seg.row, seg.x0)) continue;
        const sc = supplierNameScore(cleaned, idx, supplierIdRow, new Set<number>());
        if (sc > (best?.score ?? 1)) best = { seg, score: sc };
      }
    });
    if (best) {
      const pool = zone.slice(0, 16).flatMap((r) => segmentsOf(r)).filter((sg) => !customerSeg(sg.row, sg.x0));
      const pick = pool.find((sg) => sg.row === best?.seg.row && sg.x0 === best.seg.x0) ?? best.seg;
      supplierName = extendName(pick, pool);
    }
  }

  // Fecha: nunca de los datos registrales ni de la trazabilidad
  const dateRow = (r: Row) => !META_ANY_RE.test(r.f) && !REGISTRY_RE.test(r.f);
  const headerText = zone.filter(dateRow).map((r) => r.text).join('\n');
  const date = findDate(headerText) ?? findDate(allRows.filter((r) => !excludeRows.has(r.i) && dateRow(r)).map((r) => r.text).join('\n'));
  // Rótulo pegado a la razón social que lo repite ("makro Makro Distribución Mayorista, S.A."): una sola vez
  if (supplierName) supplierName = supplierName.replace(/^(\p{L}{3,})\s+(?=\1\b)/iu, '');
  // Mayoristas conocidos: el CIF (o un nombre inequívoco) fija la razón social que el OCR estropea
  const nameKey = fold(supplierName ?? '');
  const known = KNOWN_SUPPLIERS.find((k) => k.taxId === supplierTaxId || k.match.test(nameKey));
  if (known && !known.brand.test(nameKey)) supplierName = known.name;
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
  /(?<skip>peso\s*total|total\s*(?:de\s*)?(?:bultos|kilos|kgs?|peso|unidades|uds|cajas|envases|piezas)|(?:n[ºo°]\.?|numero)\s*(?:de\s*)?bultos)|(?<page>total\s*(?:de\s*)?(?:la\s*)?pag(?:ina)?\b\.?|suma\s*(?:de\s*)?(?:la\s*)?pagina|total\s*hoja|importe\s*(?:de\s*)?(?:la\s*)?pagina)|(?<base>base\s*imp(?:onible)?\.?|b\.\s*imp(?:onible)?|total\s*base|bases?\s*imponibles?|base\s*i\.?v\.?a\.?|imponible)|(?<disc>dto\.?\s*(?:pronto\s*pago|p\.?\s*p\.?|comercial|global|factura)|descuento\s*(?:pronto\s*pago|comercial|global|factura|general)|pronto\s*pago)|(?<sub>subtotal|sub-total|suma\s*importes|total\s*bruto|importe\s*bruto|total\s*neto|importe\s*neto|neto\s*factura|total\s*lineas|total\s*productos|total\s*articulos)|(?<re>recargo\s*(?:de\s*)?equivalencia|cuota\s*r\.?\s*e\.?|r\.\s*e\.|rec\.\s*eq\.?)|(?<vat>cuota\s*(?:de\s*)?i\.?v\.?a\.?|total\s*i\.?v\.?a\.?|importe\s*i\.?v\.?a\.?|i\.?v\.?a\.?|impuestos?)|(?<total>total\s*(?:factura|fra\.?|a\s*pagar|documento|general|eur(?:os)?|€|importe|con\s*i\.?v\.?a|iva\s*incluido)|importe\s*total|liquido(?:\s*a\s*pagar)?|a\s*pagar|total)/g;

function numbersIn(row: Row): NumTok[] {
  return row.words
    .map((w, wi) => (w.num ? { wi, w, n: w.num, value: w.num.value, inDesc: false, lead: false } : undefined))
    .filter((t): t is NumTok => !!t);
}

function parseTotals(rowsIn: Row[]): Totals {
  // Los números con unidad ("500G", "2,5KG") son formatos de envase, nunca importes
  const rows = rowsIn.map((r) => ({ ...r, words: r.words.map((w) => (w.num && (w.num.unit || w.num.perUnit) ? { ...w, num: undefined } : w)) }));
  const rates: number[] = [];
  const vatCodes: Record<string, number> = {};
  const triples: { base: number; rate: number; vat: number }[] = [];
  const reTriples: { base: number; rate: number; vat: number }[] = [];
  const labeled: Record<'base' | 'sub' | 'vat' | 're' | 'total' | 'disc' | 'page' | 'skip', number[]> = { base: [], sub: [], vat: [], re: [], total: [], disc: [], page: [], skip: [] };

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
      if (!isRate && !isRe) {
        // OCR: tipo con una cifra mal leída ("24" por 21): lo decide la aritmética de la base y la cuota que lo siguen
        if (!row.ocr || !Number.isInteger(r.value) || r.value <= 0 || r.value >= 100) continue;
        for (const b of nums) {
          if (b.wi >= r.wi || b.n.pct || !b.value) continue;
          for (const c of nums) {
            if (c.wi <= r.wi || c.n.pct || !c.value || Math.abs(c.value) >= Math.abs(b.value)) continue;
            const implied = VAT_RATES.find((v) => v > 0 && Math.abs((b.value * v) / 100 - c.value) <= 0.0151);
            if (implied === undefined || digitDistance(String(r.value), String(implied)) !== 1) continue;
            if (!triples.some((x) => x.rate === implied && approxEqual(x.base, b.value, 0.001, 0))) triples.push({ base: b.value, rate: implied, vat: c.value });
          }
        }
        continue;
      }
      for (const b of nums) {
        if (b === r || b.value === 0 || b.n.pct) continue;
        for (const c of nums) {
          if (c === r || c === b || c.n.pct) continue;
          // Facturas rectificativas: base y cuota negativas
          if (c.value === 0 || Math.sign(c.value) !== Math.sign(b.value) || Math.abs(c.value) >= Math.abs(b.value)) continue;
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
      // "Peso total", "Total bultos": no son importes (sólo limitan el tramo de la etiqueta anterior)
      if (lab.kind === 'skip') return;
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
      // El signo se conserva (rectificativas en negativo) salvo en los descuentos, que siempre restan
      labeled[lab.kind].push(lab.kind === 'disc' ? Math.abs(value) : value);
      if (lab.kind === 'vat' && lab.rate !== undefined && VAT_RATES.includes(lab.rate) && !rates.includes(lab.rate)) rates.push(lab.rate);
    });
  }

  for (const t of triples) if (!rates.includes(t.rate)) rates.push(t.rate);
  const sum = (a: number[]) => round(a.reduce((s, v) => s + v, 0), 2);
  const triBase = triples.length ? sum(triples.map((t) => t.base)) : undefined;
  const triVat = triples.length ? sum(triples.map((t) => t.vat)) : undefined;
  const triRe = reTriples.length ? sum(reTriples.map((t) => t.vat)) : undefined;

  // (y el bruto menos el pronto pago: la base cuando el desglose de IVA no se ha podido leer entero)
  const netOfDisc = [...labeled.sub, ...labeled.base].flatMap((s) => labeled.disc.map((d) => round(s - d, 2)));
  const baseCands = [...new Set([...(triBase !== undefined ? [triBase] : []), ...labeled.base, ...(labeled.base.length > 1 ? [sum(labeled.base)] : []), ...labeled.sub, ...netOfDisc])];
  const vatCands = [...new Set([...(triVat !== undefined ? [triVat] : []), ...(labeled.vat.length > 1 ? [sum(labeled.vat)] : []), ...labeled.vat, 0])];
  const reCands = [...new Set([...(triRe !== undefined ? [triRe] : []), ...labeled.re, 0])];
  const totalCands = [...new Set(labeled.total)].sort((a, b) => Math.abs(b) - Math.abs(a));

  let subtotal: number | undefined;
  let vatTotal: number | undefined;
  let reTotal: number | undefined;
  let total: number | undefined;
  search: for (const T of totalCands) {
    for (const S of baseCands) {
      for (const V of vatCands) {
        for (const R of reCands) {
          if (V === 0 && R === 0 && S !== T) continue;
          if (Math.abs(S + V + R - T) <= 0.021) {
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
      const S = subtotal;
      total = totalCands.find((T) => Math.abs(T - computed) <= 0.021);
      if (total === undefined) {
        // Cuota mal leída (59,06 por 59,66): si base × tipo cuadra con total − base, manda la aritmética
        const T = totalCands.find((c) => c > S && rates.length === 1 && approxEqual((S * rates[0]) / 100, c - S - (reTotal ?? 0), 0.02, 0.001));
        if (T !== undefined) {
          total = T;
          vatTotal = round(T - S - (reTotal ?? 0), 2);
        } else total = computed;
      }
    } else if (totalCands.length) {
      total = totalCands[0];
      if (subtotal === undefined && vatTotal !== undefined) subtotal = round(total - vatTotal - (reTotal ?? 0), 2);
      if (vatTotal === undefined && subtotal !== undefined && Math.abs(subtotal) <= Math.abs(total)) vatTotal = round(total - subtotal - (reTotal ?? 0), 2);
    }
  }
  return { subtotal, vatTotal, reTotal, total, globalDiscount: labeled.disc[0], rates, vatCodes };
}

/** "Total página 299,60", "Suma página", "Total hoja": subtotal (sin IVA) de las líneas de UNA página. */
const PAGE_TOTAL_RE = /total\s*(?:de\s*)?(?:la\s*)?pag(?:ina)?\b|suma\s*(?:de\s*)?(?:la\s*)?pagina|total\s*hoja|importe\s*(?:de\s*)?(?:la\s*)?pagina/;

/**
 * Subtotales de página de las facturas de varias páginas (cash & carry): "Total página 299,60" o el importe del pie
 * ("Número de bultos: 23 … Importe 299,60"). Uno por página (manda «Total página»). No son el total con IVA.
 */
function pageSubtotals(rows: Row[]): Map<number, number> {
  const out = new Map<number, { value: number; strong: boolean }>();
  for (const row of rows) {
    const f = row.f.trim();
    const strong = PAGE_TOTAL_RE.test(f);
    if (!strong && !(PAGE_FOOTER_RE.test(f) && /\bimporte\b/.test(f))) continue;
    const money = row.words.filter((w) => w.num && !w.num.pct && !w.num.unit && !w.num.perUnit && (w.num.dec === 2 || w.num.cur));
    const value = money[money.length - 1]?.num?.value;
    if (value === undefined) continue;
    const prev = out.get(row.page);
    if (!prev || strong || !prev.strong) out.set(row.page, { value, strong });
  }
  return new Map([...out.entries()].map(([p, v]) => [p, v.value]));
}

/** Etiqueta del descuento por pronto pago ("Dto. P.P.", "Descuento pronto pago"). */
const PROMPT_PAY_RE = /\b(?:dto\.?|dcto\.?|descuento)\s*(?:de\s*)?(?:pronto\s*pago|p\.\s*p\.?|pp\b)|\bpronto\s*pago\b/;

/**
 * Descuento de pronto pago del resumen que no se ha podido asociar a su etiqueta (va en una columna del cuadro de IVA,
 * repartido por tipos): si el documento lo menciona y la suma de líneas menos la base es un importe impreso junto a la
 * etiqueta o un porcentaje redondo de la suma, es el descuento (no una línea que falte).
 */
function promptPayDiscount(rows: Row[], sum: number, subtotal: number): number | undefined {
  const gap = round(sum - subtotal, 2);
  if (gap < 0.03 || gap > sum * 0.12) return undefined;
  const labelRows = rows.filter((r) => PROMPT_PAY_RE.test(r.f));
  if (!labelRows.length) return undefined;
  const near = labelRows.flatMap((r) => [r, rows[r.i + 1]].filter((x): x is Row => !!x && x.page === r.page));
  if (near.some((r) => numbersIn(r).some((t) => !t.n.pct && Math.abs(Math.abs(t.value) - gap) <= 0.011))) return gap;
  const pcts = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 7.5, 8, 10];
  return pcts.some((p) => Math.abs(round((sum * p) / 100, 2) - gap) <= 0.031) ? gap : undefined;
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

// ───────────────────────────── Reparación con la base imponible ─────────────────────────────

interface RepairCand {
  sol: Solution;
  toks: NumTok[];
  total: number;
  cost: number;
}

/** Lecturas alternativas de una fila sin validar: decimales perdidos, números partidos, cifras mal leídas, importe ilegible. */
function repairCandidates(row: Row, header: TableHeader | undefined, target?: number): RepairCand[] {
  const { end: codeEnd } = leadingCode(row.words);
  const toks = numTokens(row, codeEnd, header);
  const out: RepairCand[] = [];
  const seen = new Set<string>();
  const add = (sol: Solution, v: NumTok[], cost: number) => {
    const key = `${sol.q.value}|${sol.p.value}|${sol.t.value}|${sol.d.map((d) => d.value).join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ sol, toks: v, total: sol.t.value, cost });
  };
  for (const v of [toks, ...repairVariants(toks, row)]) {
    const s1 = solveTokens(v, { header, targetTotal: target });
    if (s1 && (s1.validated || s1.loose)) add(s1, v, v === toks ? 0.5 : 1);
  }
  if (row.ocr) {
    for (const { sol, dist } of digitRepairAll(toks, { header, maxDist: 2, row, targetTotal: target, missingTotal: target === undefined })) add(sol, toks, dist);
  }
  return out.slice(0, 30);
}

/**
 * Corrige las líneas sin validar para que la suma cuadre con la base imponible. Con una sola línea débil el importe
 * que falta es conocido; con dos o tres se buscan las combinaciones de lecturas alternativas que cuadran y sólo se
 * aplica si la mejor es única.
 */
function repairWithSubtotal(parsed: ParsedLine[], rows: Row[], header: TableHeader | undefined, target: number): void {
  const sumNow = () => round(parsed.reduce((s, l) => s + l.total, 0), 2);
  if (!sumMatches(sumNow(), target)) combineRepairs(parsed, rows, header, target);
  if (!sumMatches(sumNow(), target)) return;
  // La suma ya cuadra: el importe de cada línea débil queda confirmado; se corrige la cantidad o el precio mal leídos
  for (const l of parsed) {
    if (l.validated) continue;
    const row = rows[l.row];
    if (!row.ocr) continue;
    const { end: codeEnd, code } = leadingCode(row.words);
    const toks = numTokens(row, codeEnd, header);
    const sol = digitRepair(toks, { header, targetTotal: l.total, maxDist: 2, row });
    if (!sol || !approxEqual(sol.t.value, l.total, 0.005, 0)) continue;
    const fixedLine = buildLine(row, codeEnd, code, sol, toks, 0.8, ['Corregida para cuadrar con la base imponible'], header);
    if (l.rows.length > 1) fixedLine.description = l.description;
    fixedLine.rows = l.rows;
    fixedLine.validated = true;
    fixedLine.vatPct ??= l.vatPct;
    fixedLine.vatCode ??= l.vatCode;
    Object.assign(l, fixedLine);
  }
}

function combineRepairs(parsed: ParsedLine[], rows: Row[], header: TableHeader | undefined, target: number): void {
  const weak = parsed.filter((l) => !l.validated);
  if (!weak.length || weak.length > 3) return;
  const fixedSum = round(parsed.filter((l) => l.validated).reduce((s, l) => s + l.total, 0), 2);
  const needed = round(target - fixedSum, 2);
  const options: (RepairCand | undefined)[][] = weak.map((l) => {
    const cands = repairCandidates(rows[l.row], header, weak.length === 1 ? needed : undefined);
    return [undefined, ...cands];
  });
  let best: { combo: (RepairCand | undefined)[]; cost: number } | undefined;
  let tie = false;
  const walk = (i: number, combo: (RepairCand | undefined)[], sum: number, cost: number) => {
    if (i === weak.length) {
      if (combo.every((c) => !c)) return;
      if (Math.abs(sum - needed) > 0.011) return;
      if (!best || cost < best.cost - 1e-9) {
        best = { combo: [...combo], cost };
        tie = false;
      } else if (Math.abs(cost - best.cost) < 1e-9) {
        const same = combo.every((c, k) => (c?.total ?? weak[k].total) === (best?.combo[k]?.total ?? weak[k].total));
        if (!same) tie = true;
      }
      return;
    }
    for (const opt of options[i]) {
      combo.push(opt);
      walk(i + 1, combo, sum + (opt ? opt.total : weak[i].total), cost + (opt ? opt.cost : 0));
      combo.pop();
    }
  };
  walk(0, [], 0, 0);
  const chosen = best as { combo: (RepairCand | undefined)[]; cost: number } | undefined;
  if (!chosen || tie) return;
  chosen.combo.forEach((cand, k) => {
    if (!cand) return;
    const l = weak[k];
    const row = rows[l.row];
    const { end: codeEnd, code } = leadingCode(row.words);
    const fixedLine = buildLine(row, codeEnd, code, cand.sol, cand.toks, 0.8, ['Corregida para cuadrar con la base imponible'], header);
    // Si la descripción venía de varias filas (continuaciones), se conserva la completa
    if (l.rows.length > 1) fixedLine.description = l.description;
    fixedLine.rows = l.rows;
    fixedLine.validated = true;
    fixedLine.vatPct ??= l.vatPct;
    fixedLine.vatCode ??= l.vatCode;
    Object.assign(l, fixedLine);
  });
}

// ───────────────────────────── Descripciones en varias filas ─────────────────────────────

interface TextRow {
  row: Row;
  header?: TableHeader;
}

/** Texto de descripción de una fila sin importes; undefined si no es una continuación (sublínea, título, pie). */
function continuationText(t: TextRow): { text: string; code?: string } | undefined {
  const model = t.header?.model;
  const words = t.row.words.filter((w) => !/^[.\-_·:|=*]+$/.test(w.raw));
  if (!words.length) return undefined;
  if (model) {
    const desc: Word[] = [];
    const inDesc = (w: Word) => {
      const j = columnIndex(model.columns, w);
      return j >= 0 && model.columns[j].kind === 'desc';
    };
    // Una palabra de la misma celda que la descripción que asoma a la columna de al lado ("…Cantábrico 00") es suya
    const descSegs = new Set(words.filter(inDesc).map((w) => w.seg));
    for (const w of words) {
      if (inDesc(w) || descSegs.has(w.seg)) desc.push(w);
      else if (!isOcrJunk(w, t.row)) return undefined;
    }
    if (!desc.length) return undefined;
    return { text: collapseSpaces(desc.map((w) => w.raw).join(' ')) };
  }
  const lc = leadingCode(words);
  return { text: collapseSpaces(words.slice(lc.end).map((w) => w.raw).join(' ')), code: lc.code };
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/**
 * Une las filas de sólo texto a la línea a la que pertenecen, por geometría:
 *  - alineación arriba (lo habitual en ERP): la fila de debajo continúa la descripción de la línea anterior;
 *  - alineación centrada (tablas HTML): los números quedan entre dos filas de texto y la línea no tiene descripción
 *    propia, así que se lleva la fila de arriba y la de abajo;
 *  - tickets: la descripción va en la fila anterior a «x6  0,82  4,92».
 * Una fila de texto más separada que el paso normal entre líneas (título de sección, pie) no se une a nada.
 */
function attachContinuations(parsed: ParsedLine[], texts: TextRow[], rows: Row[], zoneOf: Map<number, number>): void {
  if (!texts.length || !parsed.length) return;
  const lines = [...parsed].sort((a, b) => a.row - b.row);
  const yOf = (i: number) => rows[i].y;
  const pitches: number[] = [];
  for (let k = 1; k < lines.length; k++) {
    const a = lines[k - 1];
    const b = lines[k];
    if (b.row === a.row + 1 && rows[a.row].page === rows[b.row].page) pitches.push(yOf(b.row) - yOf(a.row));
  }
  const tableRows = [...zoneOf.keys()].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let k = 1; k < tableRows.length; k++) {
    const a = rows[tableRows[k - 1]];
    const b = rows[tableRows[k]];
    if (a.page === b.page && b.i === a.i + 1 && b.y > a.y) gaps.push(b.y - a.y);
  }
  const minGap = gaps.length ? quantile(gaps, 0.1) : 1;
  const pitch = pitches.length >= 2 ? median(pitches) : undefined;
  // Sin líneas consecutivas de una fila para medir el paso: altura de una línea de texto (~2,6 anchos de carácter)
  const cw = median(tableRows.map((i) => rows[i].cw)) || 1;
  const limit = pitch !== undefined ? Math.max(pitch * 1.08, minGap * 1.05) : Math.max(minGap * 1.6, rows[tableRows[0] ?? 0]?.positional ? cw * 2.6 : 0);
  const ownDesc = new Map(lines.map((l) => [l, l.description.replace(/[^\p{L}]/gu, '').length >= 2]));
  const lastY = new Map(lines.map((l) => [l, yOf(l.row)]));
  const sameZone = (l: ParsedLine, t: Row) => rows[l.row].page === t.page && zoneOf.get(l.row) === zoneOf.get(t.i);
  const middleNoDesc = lines.some((l) => {
    if (ownDesc.get(l)) return false;
    const y = yOf(l.row);
    const above = texts.some((t) => sameZone(l, t.row) && t.row.y < y && y - t.row.y < limit);
    const below = texts.some((t) => sameZone(l, t.row) && t.row.y > y && t.row.y - y < limit);
    return above && below;
  });
  // Celdas de tres filas centradas en vertical ("JAMÓN IBÉRICO DE" / "J100 100% RAZA IBÉRICA  10  12,80" /
  // "LONCHEADO…"): la línea tiene descripción propia y una fila de texto justo encima y otra justo debajo, a la misma
  // distancia, y la de encima está más cerca de ella que de la línea anterior
  const sandwichedLines = lines.filter((l, k) => {
    const y = yOf(l.row);
    const prevY = k > 0 && sameZone(lines[k - 1], rows[l.row]) ? yOf(lines[k - 1].row) : -Infinity;
    const above = texts.filter((t) => sameZone(l, t.row) && t.row.y < y && y - t.row.y < limit && t.row.y > prevY).map((t) => y - t.row.y);
    const below = texts.filter((t) => sameZone(l, t.row) && t.row.y > y && t.row.y - y < limit).map((t) => t.row.y - y);
    if (!above.length || !below.length) return false;
    const a = Math.min(...above);
    const b = Math.min(...below);
    return Math.abs(a - b) <= 0.3 * Math.max(a, b) && a < y - a - prevY;
  });
  const sandwiched = new Set(sandwichedLines);
  const middle = middleNoDesc || (sandwiched.size >= 2 && sandwiched.size >= lines.length * 0.4);
  /** Distancia de una línea a la siguiente del mismo tramo (Infinity si es la última). */
  const nextGap = (l: ParsedLine): number => {
    const k = lines.indexOf(l);
    const n = lines[k + 1];
    return n && sameZone(n, rows[l.row]) ? yOf(n.row) - yOf(l.row) : Infinity;
  };
  const pre = new Map<ParsedLine, TextRow[]>();
  const post = new Map<ParsedLine, TextRow[]>();
  const texts2 = new Map<TextRow, string>();
  for (const t of [...texts].sort((a, b) => a.row.i - b.row.i)) {
    const ct = continuationText(t);
    if (!ct || (t.header?.model ? !ct.text.replace(/[\s.·:|_-]/g, '') : ct.text.replace(/[^\p{L}]/gu, '').length < 2)) continue;
    let prev: ParsedLine | undefined;
    let next: ParsedLine | undefined;
    for (const l of lines) {
      if (!sameZone(l, t.row)) continue;
      if (l.row < t.row.i) prev = l;
      else if (l.row > t.row.i && !next) next = l;
    }
    const dPrev = prev ? t.row.y - (lastY.get(prev) ?? 0) : Infinity;
    const dNext = next ? yOf(next.row) - t.row.y : Infinity;
    let target: 'pre' | 'post' | undefined;
    // La línea siguiente no tiene descripción propia y la anterior ya tiene la suya: la fila es de la siguiente aunque
    // quede algo más lejos (en el OCR la altura de las filas baila unos píxeles)
    // (y es la única fila de texto entre las dos: con celdas centradas en vertical habría dos, la mitad de cada una)
    const prevHasDesc = !!prev && (ownDesc.get(prev) || !!pre.get(prev)?.length);
    const alone = !!prev && !!next && texts.filter((o) => o.row.i > prev.row && o.row.i < next.row).length === 1;
    if (next && !ownDesc.get(next) && dNext <= limit && (dNext <= dPrev * 1.1 || (alone && prevHasDesc && dNext <= dPrev * 1.6))) target = 'pre';
    else if (next && middle && dNext <= limit && dNext < dPrev * 0.87) target = 'pre';
    // La línea siguiente tiene texto justo encima y justo debajo a la misma distancia (celda de tres filas centrada)
    else if (next && sandwiched.has(next) && dNext <= limit && dNext < dPrev * 0.87) target = 'pre';
    // Primera línea de la tabla con texto pegado encima (a menos de la mitad del paso hasta la línea siguiente): es el
    // principio de su descripción, no un título de sección (que va separado como una línea más)
    else if (next && !prev && dNext <= limit && dNext <= nextGap(next) * 0.6) target = 'pre';
    // Mucho más cerca de la línea siguiente que de la anterior: la otra mitad de su descripción va en la fila de los
    // números (celdas centradas en vertical cuya segunda fila de texto cae a la altura de los importes)
    else if (next && dNext <= limit && dNext < dPrev * 0.45 && (pitch === undefined ? Number.isFinite(dPrev) : dNext < pitch * 0.75)) target = 'pre';
    else if (prev && dPrev <= limit) target = 'post';
    if (target === 'pre' && next) {
      const list = pre.get(next) ?? [];
      list.push(t);
      pre.set(next, list);
      if (ct.code && !next.code) next.code = ct.code;
    } else if (target === 'post' && prev) {
      const list = post.get(prev) ?? [];
      list.push(t);
      post.set(prev, list);
      lastY.set(prev, t.row.y);
    } else continue;
    texts2.set(t, ct.text);
  }
  // Descripciones de más de dos filas por encima de la línea ("Nata para" / "Cocinar 1l" / números): la fila de texto
  // pegada encima de la primera fila ya unida, a distancia de interlineado y sin otra línea en medio, es de la misma celda
  // Interlineado dentro de una celda: distancia entre filas de texto seguidas de una misma línea
  const intra: number[] = [];
  for (const l of lines) {
    for (const list of [pre.get(l) ?? [], post.get(l) ?? []]) {
      const ys = list.map((t) => t.row.y).sort((a, b) => a - b);
      for (let k = 1; k < ys.length; k++) intra.push(ys[k] - ys[k - 1]);
    }
  }
  const lineGap = intra.length ? median(intra) * 1.2 : 0;
  if (lineGap > 0) lines.forEach((l, k) => {
    const list = pre.get(l);
    if (!list?.length) return;
    const floor = k > 0 && sameZone(lines[k - 1], rows[l.row]) ? (lastY.get(lines[k - 1]) ?? -Infinity) : -Infinity;
    for (;;) {
      const top = Math.min(...list.map((t) => t.row.y));
      const cand = texts
        .filter((t) => !texts2.has(t) && sameZone(l, t.row) && t.row.y < top && top - t.row.y <= lineGap && t.row.y > floor)
        .sort((a, b) => b.row.y - a.row.y)[0];
      const ct = cand && continuationText(cand);
      if (!cand || !ct || !ct.text.replace(/[^\p{L}\d]/gu, '')) break;
      list.unshift(cand);
      texts2.set(cand, ct.text);
    }
  });
  for (const l of lines) {
    const a = [...(pre.get(l) ?? [])].sort((x, y) => x.row.y - y.row.y);
    const b = post.get(l) ?? [];
    if (!a.length && !b.length) continue;
    // Sin letras propias ("2" sobrante de una columna de piezas) la fila de números no aporta descripción
    const own = /\p{L}/u.test(l.description) ? l.description : '';
    l.description = collapseSpaces([...a.map((t) => texts2.get(t) ?? ''), own, ...b.map((t) => texts2.get(t) ?? '')].join(' '));
    l.rows.push(...a.map((t) => t.row.i), ...b.map((t) => t.row.i));
  }
}

/** ¿Fila con descripción y un único importe al final (más, quizá, un código de IVA)? */
function isAmountOnlyRow(row: Row): boolean {
  const nums = row.words.filter((w) => w.num && !w.num.pct && !w.num.unit);
  const money = nums.filter((w) => w.num && (w.num.dec === 2 || w.num.cur));
  if (money.length !== 1 || nums.length > 2) return false;
  const last = row.words.findIndex((w) => w === money[0]);
  const tail = row.words.slice(last + 1);
  if (tail.length > 1 || (tail.length === 1 && !/^(?:[A-E]|\d{1,2}(?:[.,]\d{1,2})?\s?%)$/.test(tail[0].raw))) return false;
  const letters = row.words.slice(0, last).filter((w) => !w.num && /\p{L}{3,}/u.test(w.raw));
  return letters.length >= 1 && !META_ANY_RE.test(row.f) && !STOP_RE.test(row.f.trim());
}

/**
 * Añade como líneas (cantidad 1) las filas de importe suelto cuyo importe hace cuadrar la suma de líneas con la base
 * imponible (o con el total, si los precios incluyen IVA). Prueba todos los subconjuntos (hasta 16 filas) y sólo aplica
 * uno si es el único que cuadra. Devuelve cuántas se han añadido.
 */
function addAmountOnlyLines(parsed: ParsedLine[], rows: Row[], goals: number[], vatCodes: Record<string, number>): number {
  const cands = rows.slice(0, 16).map((row) => {
    const money = row.words.filter((w) => w.num && !w.num.pct && !w.num.unit && (w.num.dec === 2 || w.num.cur));
    return { row, amount: money[0]?.num?.value ?? 0, wi: row.words.indexOf(money[0]) };
  });
  const base = round(parsed.reduce((s, l) => s + l.total, 0), 2);
  for (const goal of goals) {
    const need = round(goal - base, 2);
    if (Math.abs(need) < 0.005) return 0;
    const hits: number[] = [];
    const n = cands.length;
    for (let mask = 1; mask < 1 << n && hits.length < 2; mask++) {
      let sum = 0;
      for (let k = 0; k < n; k++) if (mask & (1 << k)) sum += cands[k].amount;
      if (Math.abs(sum - need) <= 0.011) hits.push(mask);
    }
    if (hits.length !== 1) continue;
    let added = 0;
    cands.forEach((c, k) => {
      if (!(hits[0] & (1 << k))) return;
      const words = c.row.words;
      const lc = leadingCode(words);
      const desc = collapseSpaces(words.slice(lc.end, c.wi).map((w) => w.raw).join(' '));
      const vatWord = words[c.wi + 1]?.raw;
      const vatPct = vatWord && /%$/.test(vatWord) ? parseNumberEs(vatWord) : vatWord && vatCodes[vatWord] !== undefined ? vatCodes[vatWord] : undefined;
      parsed.push({
        row: c.row.i,
        rows: [c.row.i],
        code: lc.code,
        description: desc,
        quantity: 1,
        unit: 'ud',
        unitPrice: c.amount,
        total: c.amount,
        vatPct,
        vatCode: vatWord && /^[A-E]$/.test(vatWord) ? vatWord : undefined,
        confidence: 0.9,
        warnings: ['Artículo suelto: cantidad 1 validada con la base imponible'],
        validated: true,
      });
      added++;
    });
    parsed.sort((a, b) => a.row - b.row);
    return added;
  }
  return 0;
}

interface WalkResult {
  parsed: ParsedLine[];
  extras: { description: string; amount: number }[];
  excluded: Set<number>;
  tableEnd: number;
  /** Última cabecera de tabla activa (para las reparaciones con la base imponible). */
  header?: TableHeader;
  /** Filas con descripción y un único importe (artículos sueltos de un ticket), por si completan la base imponible. */
  amountOnly: Row[];
}

/** Recorre las filas: líneas, portes y envases, descuentos en fila aparte y continuaciones de descripción. */
function walkRows(rows: Row[], headers: Map<number, TableHeader>, forced?: TableHeader, cc?: CcContext): WalkResult {
  const headerRows = new Set([...headers.values()].flatMap((h) => h.rows));
  const firstHeader = headers.size ? Math.min(...headers.keys()) : -1;
  const parsed: ParsedLine[] = [];
  const extras: { description: string; amount: number }[] = [];
  const excluded = new Set<number>();
  const textRows: TextRow[] = [];
  const amountOnly: Row[] = [];
  /** Tramo de tabla de cada fila: las continuaciones no cruzan cabeceras, cierres ni «suma y sigue». */
  const zoneOf = new Map<number, number>();
  let zone = 0;
  let header: TableHeader | undefined = forced;
  let state: 'pre' | 'table' | 'post' | 'paused' = firstHeader >= 0 ? 'pre' : 'table';
  let pausedPage = 0;
  let lastLineRow = -1;
  let tableEnd = -1;

  for (const row of rows) {
    const f = row.f.trim();
    if (!f) continue;
    if (headerRows.has(row.i)) {
      const h = headers.get(row.i);
      if (h) {
        header = h;
        state = 'table';
        zone++;
      }
      excluded.add(row.i);
      continue;
    }
    if (state === 'pre') continue;
    if (PAUSE_RE.test(f)) {
      state = 'paused';
      pausedPage = row.page;
      excluded.add(row.i);
      zone++;
      continue;
    }
    // "Continúa en la página siguiente" sin «suma anterior» en la otra: la tabla sigue en la página siguiente
    if (state === 'paused' && row.page !== pausedPage && !RESUME_RE.test(f)) {
      state = 'table';
      zone++;
    }
    if (state === 'paused') {
      if (RESUME_RE.test(f)) state = 'table';
      excluded.add(row.i);
      continue;
    }
    if (RESUME_RE.test(f)) {
      excluded.add(row.i);
      zone++;
      continue;
    }
    if (isStopRow(row)) {
      if (state === 'table') tableEnd = row.i;
      state = 'post';
      zone++;
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
    const descCol = header?.model ? fold(descColumnText(row, header.model)) : '';
    // (una fila que cuadra como línea se decide después con la descripción completa: "TÓNICA PREMIUM 20CL" /
    // "7407  ENVASE RETORNABLE  14  0,543  7,60" es un producto, no un cargo por envases)
    const extraLike = EXTRA_RE.test(codeless) || EXTRA_RE.test(descPart) || (descCol && EXTRA_RE.test(descCol));
    if (extraLike && !parseRow(row, header, inTable, cc).line?.validated) {
      // Importe: el último número con céntimos (nunca un formato "75cl" ni un entero suelto)
      const nums = numbersIn(row).filter((t) => !t.n.pct && !t.n.unit && !t.n.perUnit);
      const money = nums.filter((t) => t.n.dec === 2 || t.n.cur);
      const amount = money.length ? money[money.length - 1].value : 0;
      // Sin importe no es un cargo: puede ser la continuación de una descripción ("… ENVASE RETORNABLE")
      if (amount) {
        extras.push({ description: collapseSpaces(row.text), amount });
        excluded.add(row.i);
        continue;
      }
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
    const res = parseRow(row, header, inTable, cc);
    zoneOf.set(row.i, zone);
    // Cash & carry: cada artículo trae su código de unidad y sus descripciones ya van unidas a su fila de importes;
    // una fila sin validar sin código de unidad es un resto (trazabilidad, pie, filas partidas por el OCR)
    if (cc && res.line && !res.line.cc && !res.line.validated) continue;
    if (res.line) {
      if (row.absorbed && !res.line.cc) res.line.rows.push(...row.absorbed);
      parsed.push(res.line);
      lastLineRow = row.i;
      continue;
    }
    if (cc) continue;
    if (res.textOnly && (state === 'table' || firstHeader < 0)) textRows.push({ row, header });
    else if (!res.line && firstHeader < 0 && isAmountOnlyRow(row)) amountOnly.push(row);
  }
  attachContinuations(parsed, textRows, rows, zoneOf);
  // Portes, envases y fianzas con la descripción partida en dos filas ("ENVASE RETORNABLE" / "CAJA 1/3  8  4,20"): se
  // reconocen con la descripción completa
  for (let k = parsed.length - 1; k >= 0; k--) {
    const l = parsed[k];
    if (l.validated && EXTRA_RE.test(fold(l.description))) {
      extras.push({ description: l.description, amount: l.total });
      parsed.splice(k, 1);
    }
  }
  // Sin cabecera de tabla, sólo filas validadas y con descripción
  if (firstHeader < 0) {
    for (let k = parsed.length - 1; k >= 0; k--) {
      const l = parsed[k];
      if (!l.validated || (!l.cc && l.description.replace(/[^\p{L}]/gu, '').length < 3)) parsed.splice(k, 1);
    }
  }

  return { parsed, extras, excluded, tableEnd, header, amountOnly: amountOnly.filter((r) => !parsed.some((l) => l.rows.includes(r.i))) };
}

/**
 * Tabla sin cabecera: modelo de columnas votado por las filas que cuadran (ver buildVotedModel). Devuelve una
 * cabecera sintética con ese modelo, o undefined si no hay filas suficientes o columnas claras.
 */
function votedHeader(parsed: ParsedLine[], rows: Row[]): TableHeader | undefined {
  const good = parsed.filter((l) => l.validated && l.confidence >= 0.8 && l.roles?.length && rows[l.row].positional);
  if (good.length < 3) return undefined;
  // Las filas de continuación (descripciones partidas) también votan: sus palabras son de la columna de descripción
  const extra = good.flatMap((l) => l.rows.filter((ri) => ri !== l.row).map((ri) => rows[ri]));
  const extraVotes: RoleVote[] = extra.flatMap((r) => r.words.filter((w) => !w.num && /\p{L}{2,}/u.test(w.raw)).map((w) => ({ x0: w.x0, x1: w.x1, kind: 'desc' as const })));
  const model = buildVotedModel(
    [...good.map((l) => toTRow(rows[l.row])), ...extra.map(toTRow)],
    [...good.flatMap((l) => l.roles ?? []), ...extraVotes],
    { isUnitWord: isUnitText },
  );
  if (!model) return undefined;
  const cols = model.columns.filter((c) => c.kind).map((c) => ({ kind: c.kind as ColKind, x0: c.x0, x1: c.x1, label: '' }));
  return { row: -1, rows: [], model, cols, numericOrder: cols.filter((c) => NUMERIC_KINDS.has(c.kind)).map((c) => c.kind), positional: true };
}

// ───────────────────────────── Parser principal ─────────────────────────────

function buildRows(input: { text: string; lines?: string[] }, method: 'pdf-texto' | 'ocr', pdfLines?: PdfTextLine[]): Row[] {
  const allowOcr = method === 'ocr';
  // Texto espaciado letra a letra ("F A C T U R A") recompuesto en palabras
  const clean = (t: string) => despaceLetters(allowOcr ? cleanOcrText(t) : t);
  if (pdfLines && pdfLines.length) {
    return pdfLines.map((l, i) => rowFromPdf({ ...l, text: clean(l.text), items: l.items.map((it) => ({ ...it, str: clean(it.str) })) }, i, allowOcr));
  }
  const lines = input.lines ?? input.text.split(/\r?\n/);
  return lines.map((l, i) => rowFromText(clean(l.replace(/\t/g, '    ')), i, allowOcr));
}

/** Fila de desglose de IVA: base × tipo / 100 ≈ cuota, o leyenda "A = IVA 21 %". */
function isVatSummaryRow(row: Row): boolean {
  if (/(?:^|\s)[A-E]\s*[=:]\s*(?:iva\s*)?\d{1,2}(?:[.,]\d{1,2})?\s*%/i.test(row.text)) return true;
  const nums = numbersIn(row);
  if (nums.length < 3 || nums.length > 6) return false;
  const texty = row.words.filter((w) => isTexty(w));
  // Una palabra que no es del cuadro de IVA ("REQUESON 500G 2,26 2,00 …") delata una línea de producto
  if (texty.some((w) => !/^(?:iva|tipo|base|cuota|total|bases|re|r\.e\.|imponible|importe|b|i)$/.test(w.f) && w.f.length >= 3)) return false;
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

/** Pie de página de los cash & carry: "Número de bultos: 23  Peso Total: 8,778 KG  Envases: 0  Importe 299,60". */
const PAGE_FOOTER_RE = /^(?:(?:n[ºo°]\.?\s*|numero\s*(?:de\s*)?|total\s*(?:de\s*)?)bultos|peso\s*total)\s*[:.]?\s*\d/;

function isStopRow(row: Row): boolean {
  const f = row.f.trim();
  if (!f) return false;
  if (PAGE_FOOTER_RE.test(f)) return true;
  if (DISCOUNT_ROW_RE.test(f.replace(/^[\d\s.-]+/, '')) && !/pronto\s*pago/.test(f)) return false;
  if (STOP_RE.test(f)) return true;
  // Cabecera del cuadro de IVA: "Tipo  Base  %IVA  Cuota"
  if (/\b(?:base|bases)\b/.test(f) && /\b(?:cuota|iva)\b/.test(f) && !row.words.some((w) => w.num && !w.num.pct)) return true;
  return isVatSummaryRow(row);
}

function isMetaRow(row: Row): boolean {
  // Marcas iniciales ("*** Número de pedido …", "· Lote: …")
  const f = row.f.trim().replace(/^[*=#·•>\s-]+(?=\p{L})/u, '');
  if (META_RE.test(f) || TRACE_RE.test(f)) return true;
  if (SCIENTIFIC_RE.test(row.text.trim()) && !row.words.some((w) => w.num && !w.num.pct && w.num.dec === 2)) return true;
  // "Lote: 23/456  Cad: 12/05/2025" en medio de la fila, sin importe
  if (META_ANY_RE.test(f) && !row.words.some((w) => w.num && w.num.dec === 2)) return true;
  if (/^(?:pagina|pag\.?|hoja)\s*[:.]?\s*\d+/.test(f) || /\bpagina\s*\d+\s*(?:de|\/)\s*\d+/.test(f)) return true;
  return false;
}

/** ¿La suma de líneas cuadra con la base imponible? (3 céntimos de margen para redondeos por línea). */
export function sumMatches(sum: number, subtotal: number): boolean {
  return Math.abs(sum - subtotal) <= 0.03 + 1e-9;
}

/** Puntuación de calidad de una extracción (para elegir entre pasadas de OCR). */
export function invoiceQuality(inv: ExtractedInvoice): number {
  const validated = inv.lines.filter((l) => (l.confidence ?? 0) >= 0.8).length;
  const weak = inv.lines.length - validated;
  const sum = inv.lines.reduce((s, l) => s + (l.total || 0), 0);
  const sumOk = inv.subtotal !== undefined && sumMatches(sum, inv.subtotal);
  return validated * 10 - weak * 3 + (sumOk ? 25 : 0) + (inv.supplierName ? 2 : 0) + (inv.date ? 2 : 0) + (inv.total !== undefined ? 2 : 0);
}

/** Lectura de una factura con los datos internos necesarios para recalcular avisos al combinar lecturas. */
export interface InvoiceReading {
  invoice: ExtractedInvoice;
  /** Importe de portes, envases, fianzas… que no son productos pero cuentan en la base imponible. */
  extrasSum: number;
  /** Descuento global (pronto pago, comercial) que resta de la suma de líneas. */
  globalDiscount: number;
  /** Los precios venían con IVA y se han convertido. */
  vatIncluded: boolean;
  /** Avisos propios del documento (no dependen de las líneas). */
  documentWarnings: string[];
}

function eurEs(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} €`;
}

/** Avisos que dependen de las líneas y de los totales (se recalculan al combinar lecturas). */
function summaryWarnings(inv: ExtractedInvoice, r: Pick<InvoiceReading, 'extrasSum' | 'globalDiscount' | 'vatIncluded'>): string[] {
  const out: string[] = [];
  const lines = inv.lines;
  if (!lines.length) out.push('No se han encontrado líneas de producto: revisa el documento o añádelas a mano');
  const weakCount = lines.filter((l) => (l.confidence ?? 1) < 0.8).length;
  if (weakCount) out.push(weakCount === 1 ? '1 línea no se ha podido validar (cantidad × precio ≠ importe): revísala' : `${weakCount} líneas no se han podido validar (cantidad × precio ≠ importe): revísalas`);
  const sum = round(lines.reduce((s, l) => s + l.total, 0) + r.extrasSum - r.globalDiscount, 2);
  if (lines.length && inv.subtotal !== undefined && !sumMatches(sum, inv.subtotal) && !r.vatIncluded) {
    out.push(
      approxEqual(sum, inv.subtotal, 0.02, 0.01)
        ? `La suma de las líneas (${eurEs(sum)}) difiere de la base imponible (${eurEs(inv.subtotal)}) en ${eurEs(Math.abs(sum - inv.subtotal))}: revisa los importes`
        : `La suma de las líneas (${eurEs(sum)}) no cuadra con la base imponible (${eurEs(inv.subtotal)}): puede faltar alguna línea`,
    );
  }
  if (!inv.date) out.push('No se ha encontrado la fecha de la factura');
  if (!inv.supplierName) out.push('No se ha encontrado el nombre del proveedor');
  return out;
}

/** Similitud de descripciones (Dice de bigramas sobre el texto plegado), 0–1. */
/** Calidad de una descripción leída por OCR: palabras conocidas del léxico menos restos (palabras raras cortas, signos sueltos). */
function descQuality(desc: string): number {
  let score = 0;
  for (const t of desc.split(/\s+/).filter(Boolean)) {
    const letters = t.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 3 && knownWord(letters)) score += 1;
    else if (/^[^\p{L}\d]+$/u.test(t) || (letters.length > 0 && letters.length <= 2 && !/\d/.test(t) && letters !== letters.toUpperCase())) score -= 1;
  }
  return score;
}

function descSimilarity(a: string, b: string): number {
  const na = fold(a).replace(/[^a-z0-9]+/g, ' ').trim();
  const nb = fold(b).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(na);
  const gb = grams(nb);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / Math.max(1, na.length - 1 + nb.length - 1);
}

const isValidatedLine = (l: Line) => (l.confidence ?? 0) >= 0.8;

/** Cambia hasta 3 líneas por lecturas alternativas (validadas, misma descripción) para que la suma cuadre con `target`. */
function swapToMatchSum(lines: Line[], alternatives: Line[][], target: number): void {
  const sumOf = () => round(lines.reduce((s, l) => s + l.total, 0), 2);
  if (sumMatches(sumOf(), target)) return;
  const alts: Line[][] = lines.map((l) => {
    const out: Line[] = [];
    for (const list of alternatives) {
      for (const c of list) {
        if (!isValidatedLine(c) || descSimilarity(l.description, c.description) < 0.6) continue;
        if (approxEqual(c.total, l.total, 0.005, 0) && approxEqual(c.quantity, l.quantity, 0.0005, 0) && approxEqual(c.unitPrice, l.unitPrice, 0.00005, 0)) continue;
        if (out.some((o) => o.total === c.total && o.quantity === c.quantity && o.unitPrice === c.unitPrice)) continue;
        out.push(c);
      }
    }
    return out.slice(0, 4);
  });
  const base = sumOf();
  const idx = lines.map((_, i) => i).filter((i) => alts[i].length);
  if (!idx.length) return;
  const found: { swaps: [number, Line][] }[] = [];
  const maxSwaps = idx.length <= 15 ? 3 : 2;
  const walk = (start: number, swaps: [number, Line][], delta: number) => {
    if (swaps.length && Math.abs(base + delta - target) <= 0.011) {
      found.push({ swaps: [...swaps] });
      return;
    }
    if (swaps.length >= maxSwaps) return;
    for (let k = start; k < idx.length; k++) {
      const i = idx[k];
      for (const c of alts[i]) {
        swaps.push([i, c]);
        walk(k + 1, swaps, delta + c.total - lines[i].total);
        swaps.pop();
      }
    }
  };
  walk(0, [], 0);
  if (!found.length) return;
  const minSwaps = Math.min(...found.map((f) => f.swaps.length));
  const best = found.filter((f) => f.swaps.length === minSwaps);
  if (best.length > 1) return;
  for (const [i, c] of best[0].swaps) lines[i] = { ...c, warnings: [...(c.warnings ?? [])] };
}

/**
 * Combina varias lecturas del MISMO documento (p. ej. pasadas de OCR con distinta segmentación o binarización).
 * Parte de la primera (la mejor) y:
 *  - sustituye cada línea sin validar por la línea validada equivalente de otra lectura (misma descripción aproximada
 *    y posición parecida);
 *  - añade líneas validadas que sólo aparecen en otras lecturas si con ellas la suma se acerca a la base imponible;
 *  - completa la cabecera y los totales que falten.
 * Los avisos se recalculan.
 */
export function mergeInvoiceReadings(readings: InvoiceReading[]): InvoiceReading {
  if (!readings.length) throw new Error('No hay lecturas que combinar');
  const [first, ...others] = readings;
  if (!others.length) return first;
  const base = first.invoice;
  const lines: Line[] = base.lines.map((l) => ({ ...l }));
  const used = new Set<Line>();
  const relPos = (idx: number, n: number) => (n <= 1 ? 0.5 : idx / (n - 1));

  // 1) Sustitución de líneas débiles
  lines.forEach((l, idx) => {
    if (isValidatedLine(l)) return;
    let best: { line: Line; score: number } | undefined;
    for (const r of others) {
      const cands = r.invoice.lines;
      cands.forEach((c, ci) => {
        if (!isValidatedLine(c) || used.has(c)) return;
        const sim = descSimilarity(l.description, c.description);
        const posPenalty = Math.abs(relPos(idx, lines.length) - relPos(ci, cands.length));
        const score = sim - posPenalty * 0.5 + (approxEqual(c.total, l.total, 0.02, 0.001) ? 0.3 : 0);
        if (sim >= 0.45 && (!best || score > best.score)) best = { line: c, score };
      });
    }
    if (best) {
      used.add(best.line);
      lines[idx] = { ...best.line, warnings: [...(best.line.warnings ?? [])] };
    }
  });

  // 1b) Descripción: entre las lecturas de la misma línea (mismas cifras) gana la que tiene más palabras conocidas y
  //     menos restos del OCR (las pasadas fallan en letras distintas)
  lines.forEach((l, idx) => {
    if (!isValidatedLine(l)) return;
    let best = { text: l.description, score: descQuality(l.description) };
    for (const r of others) {
      for (const c of r.invoice.lines) {
        if (!isValidatedLine(c) || c.total !== l.total || c.quantity !== l.quantity || c.unitPrice !== l.unitPrice) continue;
        if (descSimilarity(l.description, c.description) < 0.6) continue;
        const score = descQuality(c.description);
        if (score > best.score) best = { text: c.description, score };
      }
    }
    if (best.text !== l.description) lines[idx] = { ...l, description: best.text, suggestedName: cleanProductName(best.text) || undefined };
  });

  // 2) Líneas validadas que faltan en la base
  const subtotal = base.subtotal ?? others.map((r) => r.invoice.subtotal).find((v) => v !== undefined);
  if (subtotal !== undefined) {
    const target = round(subtotal - first.extrasSum + first.globalDiscount, 2);
    const sumOf = (ls: Line[]) => round(ls.reduce((s, l) => s + l.total, 0), 2);
    for (const r of others) {
      const cands = r.invoice.lines;
      cands.forEach((c, ci) => {
        if (!isValidatedLine(c) || used.has(c)) return;
        const present = lines.some((l) => descSimilarity(l.description, c.description) >= 0.6 && approxEqual(l.total, c.total, 0.02, 0.001));
        if (present) return;
        const gap = Math.abs(target - sumOf(lines));
        const after = Math.abs(target - sumOf(lines) - c.total);
        if (after + 0.005 < gap && c.total <= gap + 0.02) {
          // Posición: tras la línea equivalente a su predecesora en la otra lectura
          const prev = ci > 0 ? cands[ci - 1] : undefined;
          const at = prev ? lines.findIndex((l) => descSimilarity(l.description, prev.description) >= 0.6) : -1;
          lines.splice(at >= 0 ? at + 1 : Math.min(lines.length, Math.round(relPos(ci, cands.length) * lines.length)), 0, { ...c });
          used.add(c);
        }
      });
    }
  }

  // 2b) La suma no cuadra con la base imponible aunque cada línea cuadre (el OCR puede leer mal dos campos de forma
  //     coherente): se prueban las lecturas alternativas validadas de otras pasadas que hacen cuadrar la suma
  if (subtotal !== undefined) {
    const target = round(subtotal - first.extrasSum + first.globalDiscount, 2);
    swapToMatchSum(lines, others.map((r) => r.invoice.lines), target);
  }

  // 3) Cabecera y totales
  const pick = <K extends keyof ExtractedInvoice>(k: K): ExtractedInvoice[K] => base[k] ?? others.map((r) => r.invoice[k]).find((v) => v !== undefined) ?? base[k];
  const invoice: ExtractedInvoice = {
    ...base,
    supplierName: pick('supplierName'),
    supplierTaxId: pick('supplierTaxId'),
    number: pick('number'),
    date: pick('date'),
    subtotal: pick('subtotal'),
    vatTotal: pick('vatTotal'),
    total: pick('total'),
    lines,
  };
  const docWarnings = [...new Set(readings.flatMap((r) => (r === first ? r.documentWarnings : [])))];
  invoice.warnings = [...docWarnings, ...summaryWarnings(invoice, first)];
  return { ...first, invoice, documentWarnings: docWarnings };
}

/** Tablas detectadas (filas de cabecera y columnas con su tipo), para diagnóstico y pruebas. */
export function describeInvoiceTables(input: { text: string; lines?: string[] }, method: 'pdf-texto' | 'ocr', pdfLines?: PdfTextLine[]): { headerRows: number[]; columns: { x0: number; x1: number; kind?: string; label?: string }[] }[] {
  const rows = buildRows(input, method, pdfLines);
  const headers = detectHeaders(rows);
  buildModels(rows, headers);
  return [...headers.values()].map((h) => ({
    headerRows: h.rows,
    columns: (h.model?.columns ?? []).map((c) => ({ x0: round(c.x0, 1), x1: round(c.x1, 1), kind: c.kind, label: c.label })),
  }));
}

export function parseInvoiceText(input: { text: string; lines?: string[] }, method: 'pdf-texto' | 'ocr', pdfLines?: PdfTextLine[]): ExtractedInvoice {
  return parseInvoiceReading(input, method, pdfLines).invoice;
}

/** Igual que `parseInvoiceText` pero devuelve también los datos para combinar lecturas (`mergeInvoiceReadings`). */
export function parseInvoiceReading(input: { text: string; lines?: string[] }, method: 'pdf-texto' | 'ocr', pdfLines?: PdfTextLine[]): InvoiceReading {
  const rows = buildRows(input, method, pdfLines);
  const rawText = input.text || rows.map((r) => r.text).join('\n');
  const warnings: string[] = [];

  // 1) Zonas: cabeceras de tabla (con sus filas de etiquetas y su modelo de columnas) y filas de cierre
  const headers = detectHeaders(rows);
  buildModels(rows, headers);
  const firstHeader = headers.size ? Math.min(...headers.keys()) : -1;

  // Cash & carry: artículos en dos filas con código de unidad (se unen antes de recorrer las filas)
  const cc = cashCarryPrepass(rows, headers);

  // 2) Recorrido de filas (sin cabecera de tabla: segunda pasada con las columnas votadas por las filas que cuadran)
  let walk = walkRows(rows, headers, undefined, cc);
  if (!headers.size && !cc) {
    const forced = votedHeader(walk.parsed, rows);
    if (forced) {
      const alt = walkRows(rows, headers, forced);
      // Con las columnas votadas las descripciones salen limpias (sin lotes ni fechas de caducidad): vale la pena
      // aunque se pierda alguna fila dudosa (un cargo que pasa a portes, una fila partida)
      const dirty = (w: WalkResult) => w.parsed.filter((l) => /(?:^|\s)(?:\d{1,2}[/.-]\d{2,4}|\d{5,}-\d{1,3}|[A-Z]{1,2}\d{3,}[A-Z]?)(?=\s|$)/.test(l.description)).length;
      if (alt.parsed.length >= walk.parsed.length || (alt.parsed.length >= walk.parsed.length - 1 && dirty(alt) + 2 <= dirty(walk))) walk = alt;
    }
  }
  const { parsed, extras, tableEnd, header, amountOnly } = walk;

  // 3) Cabecera del documento y totales
  const firstLineRow = parsed.length ? Math.min(...parsed.flatMap((l) => l.rows)) : rows.length;
  const headerEnd = firstHeader >= 0 ? firstHeader : firstLineRow;
  const lineRows = new Set(parsed.flatMap((l) => l.rows));
  const lastRow = parsed.length ? Math.max(...parsed.flatMap((l) => l.rows)) : -1;
  const totalsFrom = tableEnd >= 0 ? tableEnd : lastRow + 1;
  const totalsRows = rows.filter((r) => r.i >= totalsFrom && !lineRows.has(r.i));
  const totals = parseTotals(totalsRows.length ? totalsRows : rows.filter((r) => !lineRows.has(r.i) && r.i >= headerEnd));
  // Una página suelta de una factura de varias (cash & carry): sin base ni total, el subtotal de sus páginas
  // ("Total página") es la base de lo que muestra; nunca el total con IVA
  const pageSubs = pageSubtotals(rows.filter((r) => !lineRows.has(r.i)));
  if (totals.subtotal === undefined && totals.total === undefined && pageSubs.size) totals.subtotal = round([...pageSubs.values()].reduce((a, b) => a + b, 0), 2);
  const head = parseDocHeader(rows, headerEnd, rows, lineRows);

  // 4) IVA por código de línea
  for (const l of parsed) {
    if (l.vatPct === undefined && l.vatCode && totals.vatCodes[l.vatCode] !== undefined) l.vatPct = totals.vatCodes[l.vatCode];
  }
  if (totals.rates.length === 1) for (const l of parsed) if (l.vatPct === undefined) l.vatPct = totals.rates[0];

  // 5) Reparación con la base imponible: las líneas sin validar (hasta 3) se corrigen de forma que la suma cuadre
  const extrasSum = round(extras.reduce((s, e) => s + e.amount, 0), 2);
  const lineSum = () => round(parsed.reduce((s, l) => s + l.total, 0), 2);
  if (totals.subtotal !== undefined && !totals.globalDiscount && parsed.length) {
    const d = promptPayDiscount(rows, round(lineSum() + extrasSum, 2), totals.subtotal);
    if (d !== undefined) totals.globalDiscount = d;
  }
  const target = totals.subtotal !== undefined ? round(totals.subtotal - extrasSum + (totals.globalDiscount ?? 0), 2) : undefined;
  if (method === 'ocr') applyExactConvention(parsed, target);
  if (target !== undefined && parsed.some((l) => !l.validated)) repairWithSubtotal(parsed, rows, header, target);
  // Tickets: artículos sueltos ("QUESO CREMA 2KG   8,78 A") que sólo se pueden validar con la base imponible o el total
  if (amountOnly.length && !sumMatches(lineSum(), target ?? NaN)) {
    const goals = [target, totals.total !== undefined ? round(totals.total - extrasSum, 2) : undefined].filter((g): g is number => g !== undefined);
    const added = addAmountOnlyLines(parsed, amountOnly, goals, totals.vatCodes);
    if (added) warnings.push(added === 1 ? '1 artículo suelto (sin cantidad × precio) se ha validado con la base imponible' : `${added} artículos sueltos (sin cantidad × precio) se han validado con la base imponible`);
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
    // Un EAN-13 (código de barras con su dígito de control) nunca forma parte de la descripción
    l.description = collapseSpaces(l.description.split(' ').filter((t) => !isEan13(t)).join(' '));
    if (method === 'ocr') l.description = fixOcrDescription(l.description);
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

  if (extras.length) {
    warnings.push(`No se han importado como productos: ${extras.map((e) => `${collapseSpaces(e.description.replace(/[\d.,]+\s*€?/g, '')).slice(0, 40)} (${eurEs(e.amount)})`).join('; ')}`);
  }
  const invoice: ExtractedInvoice = {
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
    warnings: [],
  };
  const reading: InvoiceReading = { invoice, extrasSum, globalDiscount: totals.globalDiscount ?? 0, vatIncluded, documentWarnings: warnings };
  invoice.warnings = [...warnings, ...summaryWarnings(invoice, reading)];
  return reading;
}
