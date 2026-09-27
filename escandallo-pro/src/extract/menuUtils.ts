/**
 * Utilidades para leer cartas de restaurante (lógica pura, sin DOM): normalización de líneas de OCR, precios al final
 * de línea (con erratas típicas del OCR), ruido (teléfonos, horarios, direcciones, avisos de IVA y alérgenos),
 * secciones, descripciones, mayúsculas y reconstrucción de filas visuales a partir de las cajas del OCR (con
 * corrección de la inclinación de la foto y detección de cartas a dos columnas).
 *
 * La comparten el navegador y el banco de pruebas en Node (scripts/bench-menu.mjs).
 */
import { parseNumberEs } from '../core/numbers';
import { CUTS, DISPLAY_FORMS, FOOD_NOUNS, TRANSFORMS, VARIETIES } from '../core/lexicon';
import { KB_INGREDIENTS } from '../kb/ingredients';
import { KB_RECIPES } from '../kb/recipes';
import { editDistance, fixOcrNumber, fold, median } from './textUtils';

// ───────────────────────────── Tipos ─────────────────────────────

/** Caja de texto del OCR (palabra o línea) en coordenadas de la imagen (y hacia abajo). */
export interface MenuBox {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Confianza del OCR (0–100), si se conoce. */
  confidence?: number;
  /** Línea base de la línea OCR a la que pertenece la caja (tesseract la da por línea): mide la inclinación de la foto. */
  baseline?: { x0: number; y0: number; x1: number; y1: number };
  /** Página / foto (1, 2…) si se juntan cajas de varias imágenes: cada una se reconstruye por separado. */
  page?: number;
}

/** Fila visual de la carta: texto unido de izquierda a derecha (huecos grandes → 3 espacios). */
export interface MenuRow {
  text: string;
  /**
   * Tamaño de letra aproximado (px): media geométrica ponderada de la altura mediana de las palabras y del ancho medio
   * por carácter, más estable que la altura sola (que depende de si hay letras con rasgos ascendentes o descendentes).
   * 0 si no se conoce (texto plano).
   */
  size: number;
  /** Confianza media del OCR (0–100), si se conoce. */
  confidence?: number;
  /** Hueco vertical con la fila anterior, en alturas de texto (undefined si no se conoce). */
  gap?: number;
  /** Extremos horizontales del texto de la fila (px de la imagen), si se conocen. */
  x0?: number;
  x1?: number;
  /** Extremos horizontales de la columna de lectura a la que pertenece la fila. */
  colX0?: number;
  colX1?: number;
  /** Fin del texto del nombre (sin los precios del final) y comienzo de esos precios, si los hay. */
  nameX1?: number;
  priceX0?: number;
  /** Ancho de la primera palabra con letras (para saber si habría cabido en el renglón anterior). */
  firstWordW?: number;
  /** Altura típica del texto de la fila (px). */
  textH?: number;
}

// ───────────────────────────── Normalización ─────────────────────────────

const SUPERSCRIPTS = /[¹²³⁴⁵⁶⁷⁸⁹⁰⁽⁾]+/g;
/** Códigos de dieta o alérgenos entre paréntesis: (V), (VG), (SG), (GF), (*). */
const DIET_CODES = /\(\s*(?:v|vg|ve|veg|sg|gf|sl|sin\s+gluten|\*+)\s*\)/gi;
/** Listas de alérgenos numerados entre paréntesis o corchetes: (1,3,7), [1-7], (1 3 7). */
const ALLERGEN_NUM_LIST = /[([]\s*\d{1,2}(?:\s*[,.\-–·/y ]\s*\d{1,2})*\s*[)\]]/g;
/** Listas de alérgenos por letras: (G, L, H). */
const ALLERGEN_LETTER_LIST = /\(\s*[A-Z]{1,2}(?:\s*[,\-·/ ]\s*[A-Z]{1,2})+\s*\)/g;
/** "Alérgenos: 1, 3, 7" o "Contiene: 1-7" al final. */
const ALLERGEN_TAIL = /\s*\b(?:al[ée]rgenos?|contiene)\s*:?\s*\d{1,2}(?:\s*[,.\-–·/y ]\s*\d{1,2})*\s*$/i;
/** Avisos de IVA pegados a un precio ("14,50 € IVA incluido"). */
const VAT_NOTE = /\(?\s*(?:i\.?v\.?a\.?|impuestos?)\s+(?:incl(?:uido|uidos|\.)?|inc\.?)\s*\)?/gi;
/** Símbolos sueltos que el OCR saca de iconos (picante, vegano…). */
const ICON_JUNK = /(^|\s)[©®@¥§¤¢™•●■□◆◇○◦▪▫★☆♦♣♥♠✓✔✗✘→←↑↓»«]+(?=\s|$)/g;

/**
 * Limpia una línea de carta: espacios raros, comillas, relleno de puntos ("......", "· · ·", "____"), marcas de
 * alérgenos y dieta, decimales con apóstrofo ("12'50") o con el símbolo del euro ("12€50"), "12,-" y avisos de IVA.
 * El relleno se sustituye por un hueco de columna (3 espacios).
 */
export function normalizeMenuLine(raw: string): string {
  let s = raw
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\t/g, '    ')
    .replace(/[      ]/g, ' ')
    .replace(/…/g, '...')
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[‒–—―]/g, '–');
  s = s
    .replace(SUPERSCRIPTS, ' ')
    .replace(DIET_CODES, ' ')
    .replace(ALLERGEN_LETTER_LIST, ' ')
    .replace(ALLERGEN_NUM_LIST, (m) => {
      // Raciones fraccionadas ("Pollo asado (1/2)", "Cochinillo (1/4)") no son alérgenos
      if (/^\(\s*\d\s*\/\s*\d\s*\)$/.test(m)) return m;
      return (m.match(/\d+/g) ?? []).every((d) => Number(d) >= 1 && Number(d) <= 14) ? ' ' : m;
    })
    .replace(ALLERGEN_TAIL, '')
    .replace(VAT_NOTE, ' ')
    .replace(/\(\s*\*+\s*\)|(?<=\p{L})\*+|\*+(?=\s|$)/gu, ' ')
    .replace(ICON_JUNK, '$1');
  // Decimales raros: "12'50", "12€50", "12,-"
  s = s
    .replace(/(\d)'(\d{1,2})(?!\d)/g, '$1,$2')
    .replace(/(\d)€(\d{2})(?![\d.,])/g, '$1,$2 €')
    .replace(/(\d)[.,]\s?[-–]{1,2}(?=\s|€|$)/g, '$1');
  // Relleno entre nombre y precio → hueco de columna
  s = s.replace(/(?:\s*[.·•_~=*]){3,}\s*/g, '   ').replace(/\s*[-–]{3,}\s*/g, '   ').replace(/(?:\s*[.,·]){4,}\s*/g, '   ');
  return s.replace(/\s+$/, '').replace(/^\s+/, '');
}

// ───────────────────────────── Precios ─────────────────────────────

export interface PriceToken {
  value: number;
  raw: string;
  hasDecimals: boolean;
  currency: boolean;
  /** El OCR confundió letras y cifras ("l4,50" → 14,50) y se ha corregido. */
  corrected: boolean;
  /** Separación con lo anterior: hueco de columna (2+ espacios) o signo de separación. */
  gapBefore: boolean;
  /** Palabra inmediatamente anterior (plegada), para descartar "nº 2", "para 2"… */
  wordBefore: string;
  /** Posición en la línea donde empieza el precio (con su símbolo de moneda). */
  start: number;
  /** Posición donde empiezan las etiquetas de precio que lo preceden ("botella 16"); = start si no hay. */
  labelStart: number;
}

export interface TailPrices {
  /** Texto a la izquierda de los precios (nombre y quizá descripción). */
  head: string;
  /** Precios de izquierda a derecha. */
  tokens: PriceToken[];
  /** Etiquetas de precio vistas entre los precios (media, ración, copa, botella…). */
  labels: string[];
  /** Precio por kg / por persona / por unidad ("65 €/kg"). */
  perUnit?: string;
}

/** Etiquetas de columna de precio (media ración / ración, copa / botella…). */
const PRICE_LABEL_RE =
  /(?:^|\s)(1\/2\s*raci[oó]n|1\/2|½|media\s+raci[oó]n|media|medias|raci[oó]n|raciones|rac\.?|tapa|tapas|pincho|copa|copas|botella|botellas|bot\.?|ca[ñn]a|jarra|pinta|entera|entero|mitad|individual|grande|peque[ñn]a|peq\.?|gde\.?)\s*[:.]?\s*$/i;
const UNIT_SUFFIX_RE = /\s*(?:€\s*)?\/\s*(kg|kilo|100\s?g(?:r)?|l|litro|ud|u|unidad|uds|pieza|persona|pers\.?|pax)\.?\s*$/i;
const CURRENCY_SUFFIX_RE = /\s*(?:€|eur(?:os?)?\b|©|£)\s*\.?\s*$/i;
/** Cifra de precio candidata al final (letras que el OCR confunde con cifras incluidas). */
const TAIL_NUMBER_RE = /(^|[^\p{L}\p{N}.,'])([\p{L}\p{N}|!$]{1,4}(?:[.,][\p{L}\p{N}]{1,2})?)$/u;
/** Palabras tras las que un número no es un precio ("nº 2", "para 2", "x 6"). */
const QUALIFIER_WORDS = new Set(['n', 'no', 'nº', 'n.º', 'num', 'num.', 'numero', 'nro', 'para', 'x', 'de', 'del', 'cada', 'mesa', 'menu', '#']);

function tokenValue(raw: string): { value: number; corrected: boolean; hasDecimals: boolean } | undefined {
  let body = raw;
  let corrected = false;
  if (!/^\d+(?:[.,]\d+)?$/.test(body)) {
    const fixed = fixOcrNumber(body);
    if (!fixed) return undefined;
    body = fixed;
    corrected = true;
  }
  const m = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(body);
  if (!m) return undefined;
  const value = parseNumberEs(body);
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return { value, corrected, hasDecimals: m[2] !== undefined };
}

/**
 * Separa los precios del final de una línea ya normalizada: "Croquetas   6,50   11,00" → head "Croquetas",
 * tokens [6,5, 11]; "Verdejo copa 3,20 botella 16" → labels [copa, botella]; "Pulpo 18 €" → [18].
 * No decide cuál es el PVP (ver `pickPrice`).
 */
export function extractTailPrices(line: string): TailPrices {
  // `rest` es siempre un prefijo de `line` (o de igual longitud), para conservar las posiciones.
  let rest = line.replace(/[\s;:|]+$/, '');
  const tokens: PriceToken[] = [];
  const labels: string[] = [];
  let perUnit: string | undefined;
  const unit = UNIT_SUFFIX_RE.exec(rest);
  if (unit && /\d\s*(?:€|eur\w*)?\s*\/\s*\S+$/i.test(rest)) {
    perUnit = fold(unit[1]).replace(/\s/g, '');
    rest = rest.slice(0, unit.index);
  }
  for (let guard = 0; guard < 4; guard++) {
    let currency = false;
    let s = rest.replace(/[\s.;:|]+$/, '');
    const cur = CURRENCY_SUFFIX_RE.exec(s);
    if (cur && cur.index > 0) {
      currency = true;
      s = s.slice(0, cur.index);
    } else if (/\d\s?[eE]$/.test(s)) {
      // "6,50 e": el OCR lee el € como una "e"
      currency = true;
      s = s.replace(/\s?[eE]$/, '');
    }
    const m = TAIL_NUMBER_RE.exec(s);
    if (!m) break;
    const raw = m[2];
    const parsed = tokenValue(raw);
    if (!parsed) break;
    let head = s.slice(0, s.length - raw.length);
    // Fracciones ("Cerveza 1/3", "Pollo (1/2)"): no son precios
    if (!parsed.hasDecimals && /\d\s?\/\s?$/.test(head)) break;
    // Moneda delante: "€ 12,50", "€12" (no si el símbolo es el del precio anterior: "8,00€ 40,00€")
    const pre = /(?<![\d.,])(?:€|eur)\s?$/i.exec(head);
    if (pre) {
      currency = true;
      head = head.slice(0, pre.index);
    }
    const start = head.length;
    const gapBefore = /(?:\s{2,}|[/|·–]\s*)$/.test(head) || head.trim() === '';
    const wordBefore = fold((/(\S+)\s*$/.exec(head)?.[1] ?? '').replace(/[()[\]]/g, ''));
    rest = head.replace(/\s*[/|·–-]\s*$/, (x) => (x.trim() ? ' '.repeat(x.length) : x));
    // Etiquetas de precio delante del número ("media 6,50", "botella 16")
    let lab = PRICE_LABEL_RE.exec(rest);
    while (lab) {
      labels.unshift(fold(lab[1]));
      rest = rest.slice(0, lab.index + (/^\s/.test(lab[0]) ? 1 : 0));
      lab = PRICE_LABEL_RE.exec(rest);
    }
    tokens.unshift({ value: parsed.value, raw, hasDecimals: parsed.hasDecimals, currency, corrected: parsed.corrected, gapBefore, wordBefore, start, labelStart: rest.length });
    // Sólo se sigue buscando si lo anterior también puede ser un precio (separado por espacio o signo)
    if (!/(?:\s|[/|·–-])$/.test(rest) && rest !== '') break;
  }
  return { head: rest.replace(/\s+$/, ''), tokens, labels, ...(perUnit ? { perUnit } : {}) };
}

export interface PickedPrice {
  price: number;
  /** Tokens usados (el resto vuelve al nombre). */
  used: number;
  /** Había dos o tres precios (media / ración, copa / botella): se usa el de la ración completa. */
  multi: boolean;
  corrected: boolean;
  /** "6 50" leído como dos números y unido en 6,50. */
  merged: boolean;
}

function plausible(t: PriceToken): boolean {
  if (t.value <= 0) return false;
  if (t.hasDecimals) return t.value >= 0.2 && t.value <= 5000;
  // Enteros: 1–999 (hasta 9999 con €: coma perdida por el OCR, se corrige después), sin añadas ni "nº 2", "para 2"
  if (t.value < 1 || t.value > (t.currency ? 9999 : 999)) return false;
  if (QUALIFIER_WORDS.has(t.wordBefore)) return false;
  return true;
}

/**
 * Decide el PVP a partir de los precios del final de línea.
 *  - Uno: ese (si es verosímil).
 *  - "6 50" (el OCR se comió la coma): 6,50.
 *  - Varios con el mismo formato, con etiquetas o en contexto de dos precios: el mayor (ración completa / botella).
 *  - Enteros pequeños delante de un precio con decimales ("1 3 7   9,50"): alérgenos, se descartan.
 */
export function pickPrice(tail: TailPrices, multiContext = false): (PickedPrice & { dropped: number }) | undefined {
  const toks = tail.tokens;
  if (!toks.length) return undefined;
  const last = toks[toks.length - 1];
  const n = toks.length;
  if (n >= 2) {
    const prev = toks[n - 2];
    // "6 50" / "16 50" → 6,50 / 16,50 (el OCR perdió la coma): dos enteros juntos con proporción imposible para media/ración
    if (!prev.hasDecimals && !last.hasDecimals && !last.gapBefore && !prev.currency && plausible(prev) && /^\d{1,2}$/.test(prev.raw) && /^\d{2}$/.test(last.raw) && !tail.labels.length && !multiContext) {
      const merged = Number(`${prev.raw}.${last.raw}`);
      if (prev.value / last.value < 0.5 && merged >= 0.5) return { price: merged, used: 2, multi: false, corrected: true, merged: true, dropped: 0 };
    }
    // Precios verosímiles contiguos al final (una añada "2016" o un "nº 2" delante vuelven al nombre)
    let used = 0;
    while (used < n && plausible(toks[n - 1 - used])) used++;
    const cands = toks.slice(n - used);
    if (cands.length >= 2) {
      const values = cands.map((t) => t.value);
      const max = Math.max(...values);
      const ratio = Math.min(...values) / max;
      const decimals = cands.every((t) => t.hasDecimals || t.currency);
      const context = tail.labels.length > 0 || multiContext;
      // Media / ración, tapa / ración, copa / botella: se queda el de la ración completa (el mayor)
      if ((context && ratio >= 0.1 && ratio <= 1) || (decimals && ratio >= 0.2 && ratio <= 1) || (!decimals && ratio >= 0.5 && ratio <= 0.95)) {
        return { price: max, used, multi: true, corrected: cands.some((t) => t.corrected), merged: false, dropped: 0 };
      }
    }
    // Alérgenos numerados delante del precio ("1 3 7   9,50")
    if (last.hasDecimals || last.currency) {
      const before = toks.slice(0, -1);
      if (before.every((t) => !t.hasDecimals && t.value >= 1 && t.value <= 14 && !t.currency)) {
        return plausible(last) ? { price: last.value, used: n, multi: false, corrected: last.corrected, merged: false, dropped: before.length } : undefined;
      }
    }
  }
  if (!plausible(last)) return undefined;
  return { price: last.value, used: 1, multi: false, corrected: last.corrected, merged: false, dropped: 0 };
}

// ───────────────────────────── Ruido ─────────────────────────────

const RE_WEB = /(www\.|https?:\/\/|\.(?:com|es|net|org|eu|cat|info)\b|@[a-z0-9_.]{3,}|\b[\w.-]+@[\w.-]+\.\w+|instagram|facebook|tiktok|twitter|tripadvisor|s[ií]guenos|google\s+maps)/i;
const RE_TEL_WORD = /\b(?:tel[eé]fonos?|tel[fs]?\.?|tlfno?\.?|m[oó]vil|whatsapp|fax)\b/i;
const RE_ADDRESS = /(?:^|[\s,])(?:c\/\s?\S|calle\s|avda\.?\s|av\.\s|avenida\s|plaza\s|pza\.?\s|paseo\s|p[º°o]\.?\s|ctra\.?\s|carretera\s|pol[ií]gono\s|urb\.\s|local\s+\d)/i;
const RE_POSTCODE = /\b(?:0[1-9]|[1-4]\d|5[0-2])\d{3}\b\s+(?:[A-Z]\s)?[A-ZÁÉÍÓÚ][a-záéíóúñ]+/;
const RE_TIME = /\b\d{1,2}[:h]\d{2}\s*h?\b|\b\d{1,2}[.:]\d{2}\s*(?:-|–|a|y)\s*\d{1,2}[.:]\d{2}\b|\bde\s+\d{1,2}\s*(?:a|-|–)\s*\d{1,2}\s*h\b/i;
const RE_HOURS_WORD = /\b(?:horarios?|abierto|abrimos|cerrado|cerramos|descanso\s+semanal|cocina\s+(?:abierta|ininterrumpida|non\s+stop))\b/i;
const RE_WEEKDAYS = /\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?|festivos|l\s?-\s?[vd]|de\s+l\s+a\s+[vd])\b/i;
const RE_INFO =
  /\b(?:precios?\s+(?:en\s+euros|con\s+iva|iva|incluyen)|i\.?v\.?a\.?\s+incl\w*|impuestos\s+incluidos|consulte|consultar\s+(?:al|la\s+carta\s+de)\s+al[eé]rgenos|informaci[oó]n\s+(?:sobre|de)\s+al[eé]rgenos|al[eé]rgenos|intoleranci|gracias\s+por|buen\s+provecho|bienvenid[oa]s?|wi-?fi|p[aá]gina\s+\d|p[aá]g\.\s?\d|servicio\s+(?:de\s+mesa|no\s+incluido)|no\s+se\s+(?:admiten|sirven)|reservas\s*:|reserv[ae]\s+(?:su|tu)\s+mesa|haga\s+su\s+reserva|hoja\s+de\s+reclamaciones|disponemos\s+de|a\s+su\s+disposici[oó]n|pan\s+y\s+servicio|todos\s+nuestros\s+precios)\b/i;
const ALLERGEN_WORDS = /\b(?:gluten|crust[aá]ceos?|huevos?|pescados?|cacahuetes?|soja|l[aá]cteos|leche|frutos\s+(?:secos|de\s+c[aá]scara)|apio|mostaza|s[eé]samo|sulfitos|altramuces|moluscos)\b/gi;
/** Cargos que no son platos: servicio de pan, cubierto, suplementos. */
export const RE_CHARGE = /^(?:servicio\s+de\s+(?:pan|mesa)|pan\s+y\s+(?:aperitivo|servicio)|cubierto|suplementos?\b|supl\.|extra\s+de\b)/i;
/** Precio de mercado / sin precio fijo. */
export const RE_MARKET_PRICE = /\b(?:s\s?\/\s?m|s\.m\.|seg[uú]n\s+mercado|precio\s+(?:de|seg[uú]n)\s+mercado|p\.?\s?m\.?\s+mercado|consultar(?:\s+precio)?|seg[uú]n\s+(?:peso|pieza|tama[ñn]o)|a\s+peso|p\.?v\.?p\.?\s+seg[uú]n\s+\w+)\b\.?/i;

/** ¿Hay un teléfono español (9 cifras que empiezan por 6, 7, 8 o 9, con o sin +34)? */
export function hasPhone(s: string): boolean {
  const re = /(?<![\d,.])(?:\+?\s?34[\s.-]?)?([6-9]\d{1,2}(?:[\s.-]?\d{2,3}){2,3})(?![\d,])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1].replace(/\D/g, '').length === 9) return true;
  }
  return false;
}

/**
 * ¿La línea es ruido de carta (teléfono, web, dirección, horario, aviso de IVA/alérgenos, leyenda de alérgenos)?
 * `price` (¿hay precio al final?, ¿con decimales?) evita descartar platos con horario, dirección o avisos en el nombre
 * ("Menú del día (13:00 a 16:00) 14,50").
 */
export function isNoiseLine(s: string, price: { decimal: boolean; any: boolean } = { decimal: false, any: false }): boolean {
  if (hasPhone(s) || (RE_TEL_WORD.test(s) && /\d/.test(s))) return true;
  if (RE_WEB.test(s)) return true;
  const allergenWords = (s.match(ALLERGEN_WORDS) ?? []).length;
  if (allergenWords >= 3 && (!price.decimal || /\b\d{1,2}\s*[.:)\-–=]\s*\p{L}/u.test(s))) return true;
  if (price.decimal) return false;
  if (RE_ADDRESS.test(s) && /\d/.test(s)) return true;
  if (RE_POSTCODE.test(s)) return true;
  if (RE_TIME.test(s) || RE_HOURS_WORD.test(s)) return true;
  if (RE_WEEKDAYS.test(s) && (/\d/.test(s) || /\b(?:a|y|excepto|cerrado|abierto)\b/i.test(s))) return true;
  if (price.any) return false;
  if (RE_INFO.test(s)) return true;
  return false;
}

// ───────────────────────────── Secciones ─────────────────────────────

/** Vocabulario de secciones (plegado). */
const SECTION_WORDS = [
  'entrantes', 'entrante', 'primeros', 'primeros platos', 'segundos', 'segundos platos', 'principales', 'platos principales', 'principal',
  'carnes', 'pescados', 'mariscos', 'pescados y mariscos', 'del mar', 'de la tierra', 'de la huerta', 'de nuestra huerta', 'huerta', 'verduras',
  'ensaladas', 'sopas', 'cremas', 'sopas y cremas', 'arroces', 'arroces y fideuas', 'pastas', 'pasta', 'pizzas', 'hamburguesas', 'bocadillos',
  'montaditos', 'sandwiches', 'sandwichs', 'tostas', 'tapas', 'raciones', 'medias raciones', 'para picar', 'para compartir', 'para empezar',
  'para los peques', 'picoteo', 'aperitivos', 'embutidos', 'ibericos', 'quesos', 'huevos', 'guisos', 'cuchara', 'platos de cuchara', 'legumbres',
  'brasa', 'a la brasa', 'brasas', 'parrilla', 'asados', 'fritos', 'frituras', 'postres', 'postres caseros', 'dulces', 'helados', 'cafes',
  'cafes e infusiones', 'infusiones', 'bebidas', 'refrescos', 'cervezas', 'vinos', 'vinos tintos', 'tintos', 'vinos blancos', 'blancos',
  'rosados', 'vinos rosados', 'cavas', 'cava', 'cavas y champagnes', 'espumosos', 'champagne', 'champagnes', 'champan', 'generosos',
  'vinos dulces', 'vinos por copas', 'licores', 'destilados', 'combinados', 'cocteles', 'copas', 'aguas', 'zumos', 'menu del dia', 'menu infantil',
  'infantil', 'menu degustacion', 'menus', 'sugerencias', 'sugerencias del chef', 'fuera de carta', 'especialidades', 'especialidades de la casa',
  'platos combinados', 'combinados', 'desayunos', 'meriendas', 'brunch', 'sin gluten', 'veganos', 'vegetarianos', 'guarniciones',
  'acompanamientos', 'salsas', 'extras', 'clasicos', 'de temporada', 'temporada', 'carta de vinos', 'vermuts', 'vermut', 'sidras',
  'croquetas', 'tablas', 'mariscos y pescados', 'frescos', 'crudos', 'sushi', 'makis', 'nigiris', 'wok', 'tacos', 'entrantes frios',
  'entrantes calientes', 'fritura', 'bodega',
].sort((a, b) => b.length - a.length);
const SECTION_LEAD = /^(?:nuestr[oa]s?|l[oa]s|el|la|de\s+nuestr[oa]s?)\s+/;
const SECTION_TAIL = /^(?:a\s+la|al|a\s+las|del|de\s+la|de\s+los|de\s+las|de|y|e|con|d\.?\s?o\.?|do\b|igp|(?:\(|–|-))/;
const WINE_WORDS = /\b(?:vinos?|tintos?|blancos?|rosados?|cavas?|espumosos?|champagnes?|champan|generosos?|bodega|d\.?\s?o\.?|rioja|ribera|rueda|albari[nñ]o|verdejo|crianza|reserva)\b/;

export interface SectionInfo {
  /** Texto de la sección limpio (sin adornos ni notas entre paréntesis). */
  label: string;
  /** vocab = nombre de sección conocido; deco = adornada ("— POSTRES —", "Carnes:"); spaced = letras espaciadas. */
  strength: 'vocab' | 'deco' | 'spaced' | 'caps' | 'weak';
  wine: boolean;
}

/** "P A R A   P I C A R" → "PARA PICAR". */
export function collapseSpacedLetters(s: string): string {
  const t = s.trim();
  const tokens = t.split(/\s+/);
  const singles = tokens.filter((x) => /^\p{L}$/u.test(x)).length;
  if (tokens.length < 4 || singles / tokens.length < 0.7) return t;
  return t
    .split(/\s{2,}/)
    .map((w) => w.replace(/\s+/g, ''))
    .join(' ');
}

/** Forma de presentación de las secciones con tilde. */
const SECTION_DISPLAY: Record<string, string> = {
  'menu del dia': 'Menú del día', 'menu infantil': 'Menú infantil', 'menu degustacion': 'Menú degustación', menus: 'Menús',
  cafes: 'Cafés', 'cafes e infusiones': 'Cafés e infusiones', ibericos: 'Ibéricos', cocteles: 'Cócteles', champan: 'Champán',
  acompanamientos: 'Acompañamientos', clasicos: 'Clásicos', 'arroces y fideuas': 'Arroces y fideuás', sandwiches: 'Sándwiches',
  'entrantes frios': 'Entrantes fríos', vermuts: 'Vermuts',
};

/** Coincidencia con el vocabulario de secciones: exacta, con cola ("carnes a la brasa") o con erratas del OCR. */
function vocabMatch(folded: string): { exact: boolean; canonical?: string } | undefined {
  const f = folded.replace(SECTION_LEAD, '');
  for (const w of SECTION_WORDS) {
    if (f === w) return { exact: true };
    if (f.startsWith(`${w} `)) {
      const rest = f.slice(w.length + 1);
      if (rest.split(' ').length <= 4 && SECTION_TAIL.test(rest)) return { exact: true };
    }
  }
  // Erratas del OCR en cabeceras espaciadas ("PRINCIPALE Ss", "POSTR ES")
  const compact = f.replace(/\s+/g, '');
  if (compact.length < 6) return undefined;
  for (const w of SECTION_WORDS) {
    const cw = w.replace(/\s+/g, '');
    const max = cw.length >= 10 ? 2 : 1;
    if (Math.abs(cw.length - compact.length) <= max && editDistance(compact, cw, max) <= max) {
      return { exact: false, canonical: SECTION_DISPLAY[w] ?? w.charAt(0).toUpperCase() + w.slice(1) };
    }
  }
  return undefined;
}

/** Analiza una línea sin precio como posible cabecera de sección. undefined si no puede serlo. */
export function sectionInfo(line: string): SectionInfo | undefined {
  let s = line.trim();
  const decorated = /^[\s\-–—―~*=·•#_|:.«»"]{1,}\S/.test(s) && /\S[\s\-–—―~*=·•#_|:.«»"]{1,}$/.test(s) && /^[-–—―~*=·•#_|]/.test(s);
  const colon = /:\s*$/.test(s);
  const spaced = collapseSpacedLetters(s) !== s;
  s = collapseSpacedLetters(s)
    .replace(/^[\s\-–—―~*=·•#_|:.«»"]+/, '')
    .replace(/[\s\-–—―~*=·•#_|:.«»"]+$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3 || s.length > 48) return undefined;
  if (/\d/.test(s.replace(/\b1\/2\b/g, ''))) return undefined;
  const words = s.split(' ');
  if (words.length > 6) return undefined;
  const folded = fold(s).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const caps = letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const wine = WINE_WORDS.test(folded);
  const vocab = vocabMatch(folded);
  if (vocab) return { label: vocab.canonical ?? s, strength: 'vocab', wine: vocab.canonical ? WINE_WORDS.test(fold(vocab.canonical)) : wine };
  if (/^(?:d\.?\s?o\.?(?:\s?ca\.?)?|igp|v\.?t\.?|vino\s+de\s+la\s+tierra)\s/i.test(s)) return { label: s, strength: 'vocab', wine: true };
  if (decorated || colon) return { label: s, strength: 'deco', wine };
  if (spaced) return { label: s, strength: 'spaced', wine };
  if (caps) return { label: s, strength: 'caps', wine };
  return { label: s, strength: 'weak', wine };
}

// ───────────────────────────── Descripciones ─────────────────────────────

const CONNECTORS = new Set([
  'con', 'sin', 'sobre', 'y', 'e', 'o', 'u', 'acompanado', 'acompanada', 'acompanados', 'acompanadas', 'servido', 'servida', 'servidos',
  'servidas', 'relleno', 'rellena', 'rellenos', 'rellenas', 'hecho', 'hecha', 'hechos', 'hechas', 'elaborado', 'elaborada', 'elaborados',
  'elaboradas', 'marinado', 'marinada', 'cocinado', 'cocinada', 'confitado', 'confitada', 'horneado', 'horneada', 'preparado', 'preparada',
  'banado', 'banada', 'cubierto', 'cubierta', 'aderezado', 'aderezada', 'alinado', 'alinada', 'gratinado', 'gratinada', 'receta', 'tipico',
  'tipica', 'nuestro', 'nuestra', 'segun', 'minimo', 'min', 'aprox', 'aproximadamente', 'unos', 'unas', 'ideal', 'perfecto', 'perfecta',
  'estilo', 'al', 'en', 'para', 'de', 'del', 'a', 'pieza', 'piezas', 'terminado', 'terminada', 'salteado', 'salteada', 'emplatado',
]);

/** ¿Parece la descripción de un plato (continuación en la línea siguiente) y no un plato nuevo? */
export function isDescriptionLike(s: string): boolean {
  const t = s.replace(/^[\s"'(¡¿–-]+/, '');
  if (!t) return false;
  if (/^\(/.test(s.trim())) return true;
  const first = t.charAt(0);
  if (first !== first.toUpperCase() && first === first.toLowerCase() && /\p{L}/u.test(first)) return true;
  const w = fold(t.split(/\s+/)[0] ?? '').replace(/[^a-z]/g, '');
  if (CONNECTORS.has(w)) {
    // "A la brasa", "Al ajillo", "De la casa" también pueden ser nombres de sección muy cortos; como descripción valen.
    return true;
  }
  if (/^\d+\s*(?:uds?|unidades|piezas|g|gr|grs|gramos|ml|cl|personas|pax)\b/i.test(t)) return true;
  return false;
}

// ───────────────────────────── Mayúsculas ─────────────────────────────

const KEEP_UPPER = new Set(['DO', 'D.O.', 'DOP', 'DOCA', 'D.O.CA.', 'IGP', 'I.G.P.', 'BBQ', 'XL', 'XXL', 'IPA', 'AOVE', 'KM0', 'VIP', 'PX', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XO', 'VSOP', 'S/M', 'V.T.', 'VT', 'DJ']);
/** Nombres propios habituales en cartas (clave plegada → forma correcta). */
const PROPER: Record<string, string> = {
  padron: 'Padrón', guijuelo: 'Guijuelo', jabugo: 'Jabugo', joselito: 'Joselito', idiazabal: 'Idiazábal', cabrales: 'Cabrales',
  rioja: 'Rioja', duero: 'Duero', bierzo: 'Bierzo', penedes: 'Penedès', priorat: 'Priorat', jerez: 'Jerez', cantabrico: 'Cantábrico',
  santona: 'Santoña', burgos: 'Burgos', galicia: 'Galicia', asturias: 'Asturias', navarra: 'Navarra', malaga: 'Málaga', huelva: 'Huelva',
  cadiz: 'Cádiz', bilbao: 'Bilbao', segovia: 'Segovia', madrid: 'Madrid', valencia: 'Valencia', sevilla: 'Sevilla', mallorca: 'Mallorca',
  modena: 'Módena', roquefort: 'Roquefort', cesar: 'César', rossini: 'Rossini', wellington: 'Wellington', stroganoff: 'Stroganoff',
  santiago: 'Santiago', sacher: 'Sacher', tatin: 'Tatin', kobe: 'Kobe', orly: 'Orly', parma: 'Parma', rueda: 'Rueda', rias: 'Rías',
  baixas: 'Baixas', ribera: 'Ribera', txakoli: 'Txakoli', getaria: 'Getaria', montilla: 'Montilla', moriles: 'Moriles', toro: 'Toro',
  somontano: 'Somontano', jumilla: 'Jumilla', cava: 'Cava', mancha: 'Mancha', caserio: 'Caserío', vera: 'Vera', casar: 'Casar',
};
/** Nombres propios que sólo lo son en un contexto ("pimentón de la Vera", "rabo de toro" no). */
const PROPER_AFTER: Record<string, RegExp> = {
  vera: /\bde la $/,
  casar: /\bdel $/,
  toro: /\b(?:d\.?o\.?|tinto|vino)\b/,
  ribera: /\b(?:d\.?o\.?|ca\.?)\s*$|^$/,
  rueda: /\b(?:d\.?o\.?|ca\.?)\s*$|^$/,
  cava: /\b(?:d\.?o\.?)\s*$/,
  mancha: /\bla $/,
  santiago: /\bde $/,
  cesar: /\bensalada $/,
  parma: /\bde $/,
};
const LOWER_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'con', 'sin', 'por', 'para']);

function properForm(word: string, before: string): string | undefined {
  const key = fold(word).replace(/[^a-z]/g, '');
  const form = PROPER[key];
  if (!form) return undefined;
  const ctx = PROPER_AFTER[key];
  if (ctx && !ctx.test(fold(before))) return undefined;
  const lead = /^[^\p{L}]*/u.exec(word)?.[0] ?? '';
  const trail = /[^\p{L}]*$/u.exec(word)?.[0] ?? '';
  return `${lead}${form}${trail}`;
}

function capFirst(s: string): string {
  const i = s.search(/\p{L}/u);
  if (i < 0) return s;
  return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
}

/** "CROQUETAS DE JAMÓN" → "Croquetas de jamón"; "PIMIENTOS DE PADRÓN" → "Pimientos de Padrón"; conserva siglas (DO, IGP…). */
export function toSentenceCase(s: string): string {
  let out = '';
  for (const w of s.split(/(\s+)/)) {
    if (/^\s+$/.test(w) || !w) {
      out += w;
      continue;
    }
    const bare = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '').toUpperCase();
    if (KEEP_UPPER.has(bare)) {
      out += w;
      continue;
    }
    out += properForm(w, out) ?? w.toLowerCase();
  }
  return capFirst(out);
}

/** Para vinos en mayúsculas: "MARQUÉS DE RISCAL RESERVA" → "Marqués de Riscal Reserva". */
export function toTitleCase(s: string): string {
  let out = '';
  let first = true;
  for (const w of s.split(/(\s+)/)) {
    if (/^\s+$/.test(w) || !w) {
      out += w;
      continue;
    }
    const bare = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '').toUpperCase();
    if (KEEP_UPPER.has(bare)) out += w;
    else {
      const lower = w.toLowerCase();
      out += !first && LOWER_PARTICLES.has(lower) ? lower : capFirst(lower);
    }
    first = false;
  }
  return out;
}

/** ¿Está todo en mayúsculas? (≥ 3 letras). */
export function isShouting(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** Clave para comparar nombres de platos (minúsculas, sin tildes ni signos). */
export function menuKey(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

// ───────────────────────────── Palabras mal leídas por el OCR ─────────────────────────────

/** Palabras de cartas que no están en el léxico de ingredientes (formas plegadas). */
const MENU_WORDS = words(`
  horno brasa plancha parrilla ajillo casera casero caseras caseros gallega verde negro negra blanco blanca rojo roja crujiente
  caramelizada caramelizado frita frito fritas fritos asada asado asadas guisado guisada estofado estofada rebozada rebozado
  rellena relleno cremoso cremosa meloso melosa confitada ahumada marinada templada templado tibio caliente frio fria mixta mixto
  casa dia mercado temporada huerta abuela receta racion media tapa pincho bravas brava pimienta alioli helado tarta torrija
  croqueta croquetas pulpo gamba gambas merluza secreto solomillo arroz ensalada sopa crema guiso puchero cocido tortilla
  patatas panaderas panadera almejas almeja espinacas garbanzos lentejas alubias mejillones calamares calamar chipirones sepia
  chuleton entrecot pluma presa carrillera rabo cordero cochinillo lechazo cabrito cachelos cachelo vera aceite oliva virgen
  extra salsa queso jamon iberico iberica ibericos idiazabal manchego cabrales tostada tosta tostas montadito pan tomate
  acompanado acompanada acompanados servido servida guarnicion sobre reduccion emulsion mousse coulis sorbete natillas flan
  arroz leche chocolate vainilla fresa frutos rojos limon naranja manzana pera canela nata miel nueces almendras avellanas
`);
function words(src: string): Set<string> {
  return new Set(src.trim().split(/\s+/));
}
const FUNCTION_WORDS = words('de del la las el los y e o u a al con sin en su sus por para un una uno lo le se que tu mi');

function singularKey(k: string): string[] {
  const out = [k];
  if (k.endsWith('es') && k.length > 4) out.push(k.slice(0, -2));
  if (k.endsWith('s') && k.length > 3) out.push(k.slice(0, -1));
  return out;
}

/** ¿Palabra culinaria conocida? (plegada, en singular o plural). */
export function isKnownFoodWord(word: string): boolean {
  const k = fold(word).replace(/[^a-zñ]/g, '');
  if (k.length < 3) return false;
  return singularKey(k).some((x) => FOOD_NOUNS.has(x) || TRANSFORMS.has(x) || CUTS.has(x) || VARIETIES.has(x) || MENU_WORDS.has(x) || x in DISPLAY_FORMS);
}

function isKnownOrFunction(word: string): boolean {
  const k = fold(word).replace(/[^a-zñ]/g, '');
  return FUNCTION_WORDS.has(k) || isKnownFoodWord(word);
}

// ── Vocabulario de la base de conocimiento local (recetas e ingredientes) para corregir erratas del OCR ──

/** Palabra plegada (minúsculas, sin tildes) → forma escrita más habitual (con tildes). Se construye al primer uso. */
let KB_VOCAB: Map<string, string> | undefined;

function kbVocabulary(): Map<string, string> {
  if (KB_VOCAB) return KB_VOCAB;
  const counts = new Map<string, Map<string, number>>();
  const add = (text: string) => {
    for (const raw of text.split(/[^\p{L}]+/u)) {
      if (raw.length < 3) continue;
      const form = raw.toLowerCase();
      const key = fold(form);
      const forms = counts.get(key) ?? new Map<string, number>();
      forms.set(form, (forms.get(form) ?? 0) + 1);
      counts.set(key, forms);
    }
  };
  for (const r of KB_RECIPES) {
    add(r.name);
    for (const a of r.aliases ?? []) add(a);
    for (const it of r.items) add(it.name);
  }
  for (const i of KB_INGREDIENTS) {
    add(i.name);
    for (const a of i.aliases) add(a);
  }
  const vocab = new Map<string, string>();
  for (const [key, forms] of counts) {
    // Forma con tilde si la hay (los alias suelen ir sin tildes)
    const best = [...forms.entries()].sort((a, b) => Number(/[áéíóúüñ]/.test(b[0])) - Number(/[áéíóúüñ]/.test(a[0])) || b[1] - a[1])[0][0];
    vocab.set(key, best);
  }
  for (const set of [FOOD_NOUNS, TRANSFORMS, CUTS, VARIETIES, MENU_WORDS]) for (const w of set) if (!vocab.has(w)) vocab.set(w, DISPLAY_FORMS[w] ?? MENU_ACCENTS[w] ?? w);
  KB_VOCAB = vocab;
  return vocab;
}

function inVocabulary(key: string): boolean {
  const v = kbVocabulary();
  return singularKey(key).some((k) => v.has(k));
}

/**
 * Grupos de glifos que el OCR confunde entre sí por su forma (trazos verticales, arcos abiertos). No se incluyen
 * vocales intercambiables (a/o, e/o) porque darían otra palabra válida ("glaseada" → "glaseado").
 */
const CONFUSABLE = ['iltfj1', 'un'];
const MULTI_CONFUSIONS: [string, string][] = [['rn', 'm'], ['m', 'rn'], ['cl', 'd'], ['d', 'cl'], ['li', 'h'], ['h', 'li'], ['ii', 'u'], ['nn', 'm'], ['vv', 'w'], ['ri', 'n']];
const ALPHABET = 'abcdefghijklmnñopqrstuvwxyz';

/** Palabras a una errata típica del OCR (confusión de letras, primera letra perdida o sobrante). */
function ocrNeighbours(w: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i < w.length; i++) {
    const group = CONFUSABLE.find((g) => g.includes(w[i]));
    if (group) for (const c of group) if (c !== w[i]) out.add(w.slice(0, i) + c + w.slice(i + 1));
  }
  for (const [from, to] of MULTI_CONFUSIONS) {
    let at = w.indexOf(from);
    while (at >= 0) {
      out.add(w.slice(0, at) + to + w.slice(at + from.length));
      at = w.indexOf(from, at + 1);
    }
  }
  // Primera letra perdida en el borde de la columna ("arta" → "tarta")
  for (const c of ALPHABET) out.add(c + w);
  return [...out];
}

/**
 * Corrección conservadora de una palabra mal leída con el vocabulario de la base de conocimiento local: sólo si la
 * palabra no existe y hay UNA única palabra conocida a una errata típica del OCR (glifos confundibles, «rn» ↔ «m»,
 * primera letra perdida). Devuelve la forma corregida en minúsculas (con tildes) o undefined.
 */
function vocabularyFix(core: string): string | undefined {
  const w = fold(core.toLowerCase()).replace(/[^a-zñ0-9]/g, '');
  if (w.length < 4 || inVocabulary(w) || FUNCTION_WORDS.has(w)) return undefined;
  const v = kbVocabulary();
  const pick = (cands: string[]): string | undefined => {
    const hits = [...new Set(cands.filter((c) => c.length >= 4 && v.has(c)))];
    return hits.length === 1 ? hits[0] : undefined;
  };
  const hit = pick(ocrNeighbours(w));
  return hit ? v.get(hit) : undefined;
}

/** Aplica mayúsculas y signos del original a una forma corregida. */
function withShape(original: string, fixed: string): string {
  const lead = /^[^\p{L}\p{N}]*/u.exec(original)?.[0] ?? '';
  const trail = /[^\p{L}\p{N}]*$/u.exec(original)?.[0] ?? '';
  const core = original.slice(lead.length, original.length - trail.length);
  let out = fixed;
  if (core && core === core.toUpperCase() && core !== core.toLowerCase()) out = fixed.toUpperCase();
  else if (core && core.charAt(0) === core.charAt(0).toUpperCase() && core.charAt(0) !== core.charAt(0).toLowerCase()) out = fixed.charAt(0).toUpperCase() + fixed.slice(1);
  return `${lead}${out}${trail}`;
}

/** Recupera la tilde de palabras culinarias conocidas si el OCR la perdió ("jamon" → "jamón", "esparragos" → "espárragos"). */
function restoreAccent(word: string): string {
  const lead = /^[^\p{L}]*/u.exec(word)?.[0] ?? '';
  const trail = /[^\p{L}]*$/u.exec(word)?.[0] ?? '';
  const core = word.slice(lead.length, word.length - trail.length);
  if (core.length < 3 || /[áéíóúüñÁÉÍÓÚÜÑ]/.test(core) || !/^[A-Za-z]+$/.test(core)) return word;
  const k = core.toLowerCase();
  let form = DISPLAY_FORMS[k] ?? MENU_ACCENTS[k];
  if (!form && k.endsWith('s')) {
    const sing = DISPLAY_FORMS[k.slice(0, -1)] ?? MENU_ACCENTS[k.slice(0, -1)];
    // Sólo plurales en vocal ("espárragos"); "jamones" no lleva tilde
    if (sing && /[aeiouáéíóú]$/.test(sing)) form = `${sing}s`;
  }
  if (!form || form.includes(' ')) return word;
  return `${lead}${withShape(core, form)}${trail}`;
}
const MENU_ACCENTS: Record<string, string> = {
  iberico: 'ibérico', iberica: 'ibérica', menu: 'menú', dia: 'día', pimenton: 'pimentón', mediterranea: 'mediterránea',
  tartaro: 'tártaro', tartar: 'tártar', frances: 'francés', japones: 'japonés', cesar: 'césar', racion: 'ración',
  guarnicion: 'guarnición', reduccion: 'reducción', emulsion: 'emulsión', citricos: 'cítricos', pure: 'puré', rustico: 'rústico',
  rustica: 'rústica', clasico: 'clásico', clasica: 'clásica', tipico: 'típico', tipica: 'típica', nectar: 'néctar',
  lamina: 'lámina', medallon: 'medallón', maiz: 'maíz', cafe: 'café', te: 'té', limon: 'limón', jamon: 'jamón', salmon: 'salmón',
  atun: 'atún', champinon: 'champiñón', calabacin: 'calabacín', pina: 'piña', lechon: 'lechón', melon: 'melón',
};

/** "jamán" → "jamón": el OCR puso la tilde en otra vocal; sólo si la forma corregida es una palabra conocida. */
function accentSwap(word: string): string {
  const bare = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!/[áéíóú]/i.test(bare) || isKnownFoodWord(bare)) return word;
  const plain = fold(bare);
  for (let i = 0; i < bare.length; i++) {
    if (!/[áéíóúÁÉÍÓÚ]/.test(bare[i])) continue;
    for (const v of 'aeiou') {
      const cand = plain.slice(0, i) + v + plain.slice(i + 1);
      const form = DISPLAY_FORMS[cand] ?? MENU_ACCENTS[cand];
      if (cand !== plain && form) return word.replace(bare, withShape(bare, form));
    }
  }
  return word;
}

/** Sustituciones típicas del OCR dentro de una palabra: "homo" → "horno" (rn ↔ m), "cl" ↔ "d", "li" ↔ "h". */
const LETTER_CONFUSIONS: [string, string][] = [['m', 'rn'], ['rn', 'm'], ['cl', 'd'], ['d', 'cl'], ['h', 'li'], ['li', 'h'], ['vv', 'w']];

/**
 * Repara una palabra de nombre o descripción mal leída por el OCR, sólo si el resultado es una palabra culinaria
 * conocida: cifras dentro de palabras ("jam0n", "a1ioli", "jam6n"), confusiones de letras ("homo" → "horno") y tildes
 * perdidas ("jamon" → "jamón"). Las palabras conocidas no se tocan.
 */
export function fixOcrWord(w: string, opts: { vocabulary?: boolean } = {}): string {
  let word = w;
  // "¡amón" → "jamón": la jota cursiva se lee como "¡" dentro de un nombre
  if (/^¡\p{Ll}{2,}/u.test(word)) {
    const j = `j${word.slice(1)}`;
    if (isKnownFoodWord(j) || accentSwap(j) !== j) word = j;
  }
  // Tilde en la vocal equivocada ("jamán" → "jamón")
  const swapped = accentSwap(word);
  if (swapped !== word) return swapped;
  if (/^[\p{L}]+[0-9][\p{L}]+$/u.test(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))) {
    const tries = [word.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's').replace(/6/g, 'o').replace(/3/g, 'e').replace(/8/g, 'b'), word.replace(/1/g, 'i').replace(/0/g, 'o').replace(/6/g, 'o')];
    word = tries.find((t) => isKnownFoodWord(t)) ?? word.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's');
  }
  const core = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (core.length >= 4 && !isKnownOrFunction(core)) {
    const lower = core.toLowerCase();
    for (const [from, to] of LETTER_CONFUSIONS) {
      let at = lower.indexOf(from);
      while (at >= 0) {
        const cand = lower.slice(0, at) + to + lower.slice(at + from.length);
        if (isKnownFoodWord(cand)) return restoreAccent(word.replace(core, withShape(core, cand)));
        at = lower.indexOf(from, at + 1);
      }
    }
    // Errata respecto al vocabulario de recetas e ingredientes ("Irucha" → "Trucha", "vermtt" → "vermut")
    const fixed = opts.vocabulary ? vocabularyFix(core) : undefined;
    if (fixed) return word.replace(core, withShape(core, fixed));
  }
  return restoreAccent(word);
}

/**
 * Repara un texto de carta leído por OCR: palabra a palabra (`fixOcrWord`), une trozos de una palabra partida
 * ("ac eite" → "aceite", "e sparragos" → "espárragos") y separa "ala" pegado ("Pulpo ala gallega" → "a la").
 */
export function repairOcrText(text: string): string {
  const toks = text.split(/(\s+)/);
  // Unión de trozos: palabra + espacio + palabra
  for (let i = 0; i + 2 < toks.length; i += 2) {
    const a = toks[i];
    const b = toks[i + 2];
    if (!a || !b || /\s{2,}/.test(toks[i + 1]) || !/^\p{L}+$/u.test(a) || !/^\p{L}+[,.;:)]?$/u.test(b)) continue;
    const joined = a + b;
    if (isKnownFoodWord(joined.replace(/[,.;:)]$/, '')) && (!isKnownOrFunction(a) || !isKnownOrFunction(b.replace(/[,.;:)]$/, '')))) {
      toks.splice(i, 3, joined);
      i -= 2;
    }
  }
  // Corrección con el vocabulario de recetas: no en palabras con mayúscula en medio de un nombre en minúsculas
  // (nombres propios: "estilo Getaria", "de la abuela Carmen")
  const content = toks.filter((t) => letterCountOf(t) >= 4);
  const titled = content.length > 0 && content.filter((t) => /^\P{L}*\p{Lu}/u.test(t)).length >= 0.7 * content.length;
  let first = true;
  let out = toks
    .map((t) => {
      if (/^\s+$/.test(t) || !t) return t;
      const vocabulary = first || titled || !/^\P{L}*\p{Lu}/u.test(t);
      first = false;
      return fixOcrWord(t, { vocabulary });
    })
    .join('');
  out = out.replace(/(\p{L})\s+ala\s+(?=\p{Ll})/gu, '$1 a la ');
  return out;
}

// ───────────────────────────── Cajas del OCR → filas ─────────────────────────────

interface Item {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cx: number;
  cy: number;
  h: number;
  conf?: number;
  price: boolean;
  baseline?: MenuBox['baseline'];
}

const PRICE_BOX = /^(?:€\s?)?[\dOoIlSs|]{1,4}[.,'][\dOo]{1,2}\s?€?$|^(?:€\s?)?\d{1,3}\s?€$/;
/** Cifra que puede ser un precio ("12", "9.5", "12,50", "12€50", "€ 12", "12,-"). */
const NUMERIC_BOX = /^(?:€\s?)?\d{1,4}(?:[.,'’]\d{1,2}|€\d{2}|[.,]-)?\s?(?:€|eur)?[.,]?$/i;
/** Relleno de puntos dentro de una caja ("Croquetas......", "....9,50", "......w......"). */
const LEADER_RUN = /(?:[.·•…_]\s?){3,}/g;
/** Símbolos que no aparecen en nombres de platos: el OCR los saca de iconos, adornos y rellenos. */
const SYMBOL_JUNK = /[©®@¥§¤¢™•●■□◆◇○◦▪▫★☆♦♣♥♠✓✔✗✘→←↑↓=<>+*#^~|{}[\]\\%»«¿?!¡$"“”„]/;
/** Glifos redondos: así lee el OCR los iconos circulares de alérgenos ("OO", "080", "9O", "@®"). */
const ROUND_GLYPHS = /^[O0o8D9QGCcSe@©®]{1,6}$/;
/** Palabras cortas reales de cartas (no se toman por restos de iconos aunque el OCR dude). */
const SHORT_WORDS = words(`
  de del la las el los y e o u a al con sin en su sus por para un una uno mi tu te té ron kir pan mar ave oca pez ajo col uva gin bao pho
  sal sol ud uds kg gr ml cl pax xl xxl bbq ipa ii iii iv vi vii viii ix xo px do dop igp mix bio eco fit top sushi mini maxi
  wok ceps cava vino ale zumo mus rape lima kale udon ramen miso poke taco nata leche miel`);

/** Unidades de medida que acompañan a una cifra en el nombre ("300 g", "6 uds", "2 pax"). */
const UNIT_WORD = /^(?:g|gr|grs|kg|ml|cl|l|uds?|unid|unidades|piezas?|pax|personas?)\.?\)?$/i;

function letterCountOf(s: string): number {
  return s.replace(/[^\p{L}]/gu, '').length;
}

/** ¿Palabra real (gramatical, culinaria o sigla de carta)? */
function isRealWord(w: string): boolean {
  const k = fold(w).replace(/[^a-z0-9ñ]/g, '');
  if (!k) return false;
  if (SHORT_WORDS.has(k) || FUNCTION_WORDS.has(k)) return true;
  if (KEEP_UPPER.has(w.replace(/[^\p{L}\p{N}./]/gu, '').toUpperCase())) return true;
  return isKnownFoodWord(w);
}

function toItems(boxes: readonly MenuBox[]): Item[] {
  const out: Item[] = [];
  for (const b of boxes) {
    const text = (b.text ?? '').replace(/\s+$/, '').replace(/^\s+/, '');
    const { x0, x1, y0, y1 } = b.bbox ?? { x0: NaN, x1: NaN, y0: NaN, y1: NaN };
    if (!text || ![x0, x1, y0, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) continue;
    out.push({ text, x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: y1 - y0, conf: b.confidence, price: PRICE_BOX.test(text), baseline: b.baseline });
  }
  return out;
}

/** Altura típica del texto: mediana de las palabras legibles (≥ 3 letras y confianza razonable). */
function typicalHeight(items: Item[]): number {
  const good = items.filter((i) => letterCountOf(i.text) >= 3 && (i.conf ?? 100) >= 60);
  return median((good.length >= 5 ? good : items).map((i) => i.h)) || 1;
}

/** ¿Resto de un relleno de puntos leído como letras ("e00000000", "we..ss0000", "eeme0erco0e0")? */
function leaderGarbage(s: string): boolean {
  const t = s.replace(/\s+/g, '');
  if (t.length < 6) return false;
  const filler = t.replace(/[^0oOeécsw.,·:;'`´\-_~]/g, '').length;
  return filler / t.length >= 0.8;
}

/**
 * ¿Texto de relleno? Así lee el OCR un borde punteado o una fila de puntos bajo el texto: una letra repetida ("OOOO",
 * "AAA") o una tira larga con muy pocas letras distintas ("eeceeeraeereeerecer…").
 */
function fillerText(s: string): boolean {
  const t = s.replace(/[^\p{L}]/gu, '').toLowerCase();
  if (t.length < 3) return false;
  const distinct = new Set(t).size;
  if (distinct === 1) return true;
  return (t.length >= 8 && distinct / t.length <= 0.35) || (t.length >= 12 && distinct <= 6);
}

/**
 * Limpieza previa de cajas: quita los rellenos de puntos (también los mal leídos como letras), las cajas sin letras ni
 * cifras (filetes, viñetas, adornos) y las rayas finas; recorta el relleno pegado a una palabra ("Croquetas.......").
 */
function prefilter(items: Item[]): Item[] {
  const H = typicalHeight(items);
  // Ancho típico por carácter respecto a la altura (para detectar cajas que el OCR estiró sobre un icono vecino)
  const ratios = items.filter((i) => letterCountOf(i.text) >= 4 && (i.conf ?? 100) >= 80).map((i) => (i.x1 - i.x0) / i.text.length / i.h);
  const charRatio = ratios.length >= 10 ? median(ratios) : 0;
  const out: Item[] = [];
  for (const it of items) {
    let { text, x0, x1 } = it;
    if (/(?:[.·•…_]\s?){3,}/.test(text) || leaderGarbage(text)) {
      const rest = text.replace(LEADER_RUN, ' ').replace(/\s+/g, ' ').trim();
      const alnum = rest.replace(/[^\p{L}\p{N}]/gu, '').length;
      if ((alnum <= 2 && !NUMERIC_BOX.test(rest)) || leaderGarbage(rest)) continue;
      const lead = /^(?:[.·•…_]\s?){3,}/.exec(text)?.[0].length ?? 0;
      const trail = /(?:\s?[.·•…_]){3,}$/.exec(text)?.[0].length ?? 0;
      const w = x1 - x0;
      const n = text.length;
      x0 += (w * lead) / n;
      x1 -= (w * trail) / n;
      text = rest;
    }
    // Sin letras ni cifras (salvo el símbolo del euro): filetes, viñetas, adornos. Un guion corto y fino se conserva:
    // separa el nombre de su descripción en la misma línea ("Pulpo – con cachelos")
    const dash = /^[-–—]{1,2}$/.test(text) && x1 - x0 <= 1.6 * H && it.h <= 1.2 * H;
    if (!/[\p{L}\p{N}€½]/u.test(text) && !dash) continue;
    // Rayas y puntos finos (bordes punteados leídos como texto, también como tiras de letras)
    if (it.h < 0.4 * H && x1 - x0 > 2.5 * H && letterCountOf(text) < 2) continue;
    if (fillerText(text) && (it.h < 0.6 * H || letterCountOf(text) >= 12)) continue;
    // Palabra con una caja mucho más ancha que su texto (el OCR la unió con un icono o un adorno): se ajusta al texto
    if (charRatio > 0 && letterCountOf(text) >= 3 && (x1 - x0) / text.length > 2.2 * charRatio * it.h) x1 = x0 + 1.15 * charRatio * it.h * text.length;
    out.push({ ...it, text: dash ? '–' : text, x0, x1, cx: (x0 + x1) / 2, price: PRICE_BOX.test(text) });
  }
  return out;
}

const MAX_SLOPE = Math.tan((10 * Math.PI) / 180);

function regressionSlope(pts: { x: number; y: number }[]): number {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Inclinación de la foto (pendiente dy/dx): por las líneas base del OCR si las hay; si no, por cadenas de palabras
 * vecinas de la misma línea (regresión de sus centros). Acotada a ±10°.
 */
export function estimateSkew(boxes: readonly MenuBox[]): number {
  return skewOf(toItems(boxes));
}

function skewOf(items: Item[]): number {
  const fromBaselines: number[] = [];
  for (const it of items) {
    const b = it.baseline;
    if (b && b.x1 - b.x0 > Math.max(5 * it.h, 60)) fromBaselines.push((b.y1 - b.y0) / (b.x1 - b.x0));
  }
  if (fromBaselines.length >= 3) return Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, median(fromBaselines)));

  // Cadenas de palabras: cada palabra se une a su vecina inmediata por la derecha
  const sorted = [...items].sort((a, b) => a.x0 - b.x0);
  const next = new Map<Item, Item>();
  const hasPrev = new Set<Item>();
  for (const a of sorted) {
    let best: Item | undefined;
    let bestGap = Infinity;
    for (const b of sorted) {
      if (b === a || b.x0 < a.x1 - 0.3 * a.h) continue;
      const gap = b.x0 - a.x1;
      const hMin = Math.min(a.h, b.h);
      const hMax = Math.max(a.h, b.h);
      if (gap > 4.5 * a.h) break;
      if (gap > 2.5 * hMax) continue;
      if (hMax > 1.8 * hMin || Math.abs(b.cy - a.cy) > 0.6 * hMin) continue;
      if (gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
    if (best && !hasPrev.has(best)) {
      next.set(a, best);
      hasPrev.add(best);
    }
  }
  const slopes: { slope: number; span: number }[] = [];
  for (const start of sorted) {
    if (hasPrev.has(start)) continue;
    const chain: Item[] = [start];
    let cur = next.get(start);
    while (cur && chain.length < 200) {
      chain.push(cur);
      cur = next.get(cur);
    }
    const span = chain[chain.length - 1].cx - chain[0].cx;
    const hMed = median(chain.map((c) => c.h));
    if (chain.length < 3 || span < 6 * hMed) continue;
    slopes.push({ slope: regressionSlope(chain.map((c) => ({ x: c.cx, y: c.y1 - c.h / 2 }))), span });
  }
  if (!slopes.length) return 0;
  // Mediana ponderada por longitud de la cadena
  slopes.sort((a, b) => a.slope - b.slope);
  const total = slopes.reduce((s, x) => s + x.span, 0);
  let acc = 0;
  for (const s of slopes) {
    acc += s.span;
    if (acc >= total / 2) return Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, s.slope));
  }
  return 0;
}

// ── Columnas: calles verticales de la carta ──

/** ¿Caja con aspecto de precio de la carta (no un número volado de alérgenos)? */
function isPriceItem(it: Item, H: number): boolean {
  if (!(it.price || NUMERIC_BOX.test(it.text)) || it.h < 0.7 * H) return false;
  // Una añada ("2019"), un número de cuatro cifras sin decimales ni moneda o una numeración ("7.", "3)") no son precios
  if (/^\d{1,2}[.)]$/.test(it.text)) return false;
  return !/^(?:19|20)\d{2}$|^\d{4}$/.test(it.text.replace(/[.,]$/, ''));
}

/** ¿Palabra con letras de verdad (no moneda, ni etiqueta de columna de precios)? */
function isLetterWord(it: Item): boolean {
  if (letterCountOf(it.text) < 3) return false;
  return !/^(?:€|eur(?:os)?|ración|racion|rac\.?|media|copa|botella|bot\.?|tapa|entera|mitad)$/i.test(it.text.replace(/[.,:;]+$/, ''));
}

/** Renglones aproximados de un conjunto de cajas (agrupadas por altura), para contar filas con letras o con precios. */
function roughRows(items: Item[], H: number): Item[][] {
  const sorted = [...items].sort((a, b) => a.cy - b.cy);
  const rows: Item[][] = [];
  let last = -Infinity;
  for (const it of sorted) {
    if (it.cy - last > 0.55 * H || !rows.length) rows.push([]);
    rows[rows.length - 1].push(it);
    last = it.cy;
  }
  return rows;
}

function regionStats(items: Item[], H: number): { rows: number; letterRows: number; priceRows: number } {
  const rows = roughRows(items, H);
  return { rows: rows.length, letterRows: rows.filter((r) => r.some(isLetterWord)).length, priceRows: rows.filter((r) => r.some((i) => isPriceItem(i, H))).length };
}

interface Gutter {
  gs: number;
  ge: number;
  left: Item[];
  right: Item[];
  spanning: Item[];
  score: number;
}

/**
 * Busca la mejor calle vertical (hueco sin texto de arriba abajo) que separe dos columnas de platos. Una calle sólo vale
 * si a cada lado hay una columna de verdad: filas con letras (no sólo precios ni etiquetas) y, si la carta tiene
 * precios, también precios; así no se confunde el hueco entre el nombre y su precio alineado a la derecha (o a la
 * izquierda, con el precio delante), ni el que separa las columnas de media ración y ración. Las líneas que cruzan la
 * calle (título, pie, cabeceras de ancho completo) se devuelven aparte.
 */
function findGutter(items: Item[], H: number): Gutter | undefined {
  if (items.length < 10) return undefined;
  const minX = Math.min(...items.map((i) => i.x0));
  const maxX = Math.max(...items.map((i) => i.x1));
  const bin = Math.max(1, H / 6);
  const nb = Math.ceil((maxX - minX) / bin) + 1;
  const cov = new Float64Array(nb);
  for (const it of items) {
    if (it.h < 0.3 * H) continue;
    const a = Math.max(0, Math.floor((it.x0 - minX) / bin));
    const b = Math.min(nb, Math.ceil((it.x1 - minX) / bin));
    for (let k = a; k < b; k++) cov[k]++;
  }
  const nonzero = [...cov].filter((v) => v > 0).sort((a, b) => a - b);
  if (!nonzero.length) return undefined;
  const p90 = nonzero[Math.floor(0.9 * (nonzero.length - 1))];
  const tau = Math.max(2, Math.floor(0.4 * p90));
  const minW = Math.max(1.2 * H, 10);
  const pagePrices = items.filter((i) => isPriceItem(i, H)).length;
  // ¿Carta con el precio delante del nombre? (los precios van seguidos de un nombre y no detrás de uno)
  let leadingPrices = 0;
  for (const row of roughRows(items, H)) {
    const sorted = [...row].sort((a, b) => a.x0 - b.x0);
    sorted.forEach((p, k) => {
      if (!isPriceItem(p, H)) return;
      const next = sorted[k + 1];
      const prev = sorted[k - 1];
      if (next && isLetterWord(next) && next.x0 - p.x1 < 6 * H && !(prev && isLetterWord(prev) && p.x0 - prev.x1 < 1.5 * H)) leadingPrices++;
    });
  }
  const leadingLayout = pagePrices >= 4 && leadingPrices >= 0.6 * pagePrices;
  if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MENU_DEBUG) {
    const prof: string[] = [];
    for (let k = 0; k < nb; k += 4) prof.push(String(Math.round(cov[k])));
    console.log('cov', Math.round(minX), Math.round(maxX), 'bin', bin.toFixed(1), 'p90', p90, 'tau', tau, prof.join(' '));
  }
  let best: Gutter | undefined;
  let start = -1;
  for (let k = 0; k <= nb; k++) {
    const low = k < nb && cov[k] <= tau;
    if (low && start < 0) start = k;
    if (low || start < 0) continue;
    const gs = minX + start * bin;
    const ge = minX + k * bin;
    const inner = start > 0 && k < nb;
    start = -1;
    if (!inner || ge - gs < minW) continue;
    const DBG = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MENU_DEBUG;
    // Eje de la calle: centro del tramo más largo de cobertura mínima (el borde irregular de los nombres largos no cuenta)
    let minCov = Infinity;
    for (let q = Math.round((gs - minX) / bin); q < Math.round((ge - minX) / bin); q++) minCov = Math.min(minCov, cov[q]);
    let bestRun = [0, 0];
    for (let q = Math.round((gs - minX) / bin), r0 = -1; q <= Math.round((ge - minX) / bin); q++) {
      const at = q < Math.round((ge - minX) / bin) && cov[q] <= minCov;
      if (at && r0 < 0) r0 = q;
      if (!at && r0 >= 0) {
        if (q - r0 > bestRun[1] - bestRun[0]) bestRun = [r0, q];
        r0 = -1;
      }
    }
    const axis = minX + ((bestRun[0] + bestRun[1]) / 2) * bin;
    // Palabras que cruzan el eje: si su renglón tiene texto a ambos lados es una línea de ancho completo (título, pie);
    // si sólo a un lado, es un nombre largo que invade la calle y se queda en su columna
    const crossing = items.filter((i) => i.x0 < axis && i.x1 > axis);
    const spanning = new Set<Item>();
    const side = new Map<Item, 'L' | 'R'>();
    for (const c of crossing) {
      const line = items.filter((i) => Math.min(i.y1, c.y1) - Math.max(i.y0, c.y0) >= 0.5 * Math.min(i.h, c.h));
      const onLeft = line.some((i) => i.x1 <= axis);
      const onRight = line.some((i) => i.x0 >= axis);
      if (onLeft === onRight) for (const i of line) spanning.add(i);
      else side.set(c, onLeft ? 'L' : 'R');
    }
    // Renglones centrados sin palabra sobre el eje ("La Cocina | de Salitre"): el hueco que salta el eje es un espacio
    // entre palabras, no una calle
    for (const row of roughRows(items.filter((i) => !spanning.has(i)), H)) {
      const l = row.filter((i) => i.x1 <= axis).sort((a, b) => b.x1 - a.x1)[0];
      const r = row.filter((i) => i.x0 >= axis).sort((a, b) => a.x0 - b.x0)[0];
      if (l && r && r.x0 - l.x1 < Math.min(1.1 * Math.max(l.h, r.h), 0.6 * (ge - gs))) for (const i of row) spanning.add(i);
    }
    if (spanning.size > 0.3 * items.length) continue;
    const left = items.filter((i) => !spanning.has(i) && (side.get(i) ?? (i.cx < axis ? 'L' : 'R')) === 'L');
    const right = items.filter((i) => !spanning.has(i) && (side.get(i) ?? (i.cx < axis ? 'L' : 'R')) === 'R');
    // Hueco entre el nombre y su precio (no una calle): en los renglones que lo cruzan, a la izquierda acaba un nombre y a la
    // derecha empieza un precio con el que termina el plato (nada pegado detrás; con el precio delante vendría su nombre)
    let both = 0;
    let pairing = 0;
    for (const row of roughRows(items.filter((i) => !spanning.has(i)), H)) {
      const l = row.filter((i) => i.x1 <= axis).sort((a, b) => b.x1 - a.x1)[0];
      const rs = row.filter((i) => i.x0 >= axis).sort((a, b) => a.x0 - b.x0);
      if (!l || !rs.length) continue;
      both++;
      const r = rs[0];
      const after = rs.find((i) => i !== r && !/^(?:€|eur)$/i.test(i.text));
      if (!isPriceItem(l, H) && isPriceItem(r, H) && (!after || after.x0 - r.x1 > 2.5 * H)) pairing++;
    }
    if (!leadingLayout && both >= 3 && pairing >= 0.5 * both) continue;
    const L = regionStats(left, H);
    const R = regionStats(right, H);
    if (DBG) console.log('gutter', Math.round(gs), Math.round(ge), 'span', spanning.size, JSON.stringify(L), JSON.stringify(R), 'H', H.toFixed(1), 'tau', tau);
    if (L.letterRows < 3 || R.letterRows < 3 || L.letterRows < 0.4 * L.rows || R.letterRows < 0.4 * R.rows) continue;
    if (pagePrices >= 6 && (L.priceRows < Math.max(2, 0.2 * L.letterRows) || R.priceRows < Math.max(2, 0.2 * R.letterRows))) continue;
    const score = (ge - gs) * Math.sqrt(Math.min(L.letterRows, R.letterRows));
    if (!best || score > best.score) best = { gs, ge, left, right, spanning: [...spanning], score };
  }
  return best;
}

/**
 * Separa la carta en columnas de lectura (de izquierda a derecha, recursivo para 3 columnas). Las líneas de ancho
 * completo que cruzan la calle parten la carta en bandas: el título va delante de la primera columna, una cabecera
 * intermedia delante de la banda siguiente y el pie detrás de la última columna.
 */
function splitColumns(items: Item[], H: number, depth = 0): Item[][] {
  if (depth > 2) return [items];
  const g = findGutter(items, H);
  if (!g) return [items];
  const spanRows = roughRows(g.spanning, H)
    .map((r) => ({ items: r, y: median(r.map((i) => i.cy)) }))
    .sort((a, b) => a.y - b.y);
  const block = [...g.left, ...g.right];
  const top = Math.min(...block.map((i) => i.y0));
  const bottom = Math.max(...block.map((i) => i.y1));
  const cuts = spanRows.filter((r) => r.y > top && r.y < bottom);
  const out: Item[][] = [];
  let pending: Item[] = spanRows.filter((r) => r.y <= top).flatMap((r) => r.items);
  const bounds = [-Infinity, ...cuts.map((c) => c.y), Infinity];
  for (let b = 0; b + 1 < bounds.length; b++) {
    const inBand = (i: Item) => i.cy > bounds[b] && i.cy <= bounds[b + 1];
    const cols = [...splitColumns(g.left.filter(inBand), H, depth + 1), ...splitColumns(g.right.filter(inBand), H, depth + 1)].filter((c) => c.length);
    // Título centrado sobre una columna interior (cartas a 3 columnas): lo que queda por encima del arranque de las
    // demás columnas, sin precios, es cabecera de la carta y va delante de todo
    if (depth === 0 && cols.length >= 2) {
      for (let c = 1; c < cols.length; c++) {
        const topOthers = Math.min(...cols.filter((_, j) => j !== c).map((col) => Math.min(...col.map((i) => i.y0))));
        const head = cols[c].filter((i) => i.cy < topOthers - 0.8 * H);
        if (head.length && !head.some((i) => isPriceItem(i, H)) && head.length < cols[c].length) {
          pending.push(...head);
          cols[c] = cols[c].filter((i) => !head.includes(i));
        }
      }
    }
    if (cols.length) {
      if (pending.length) cols[0] = [...pending, ...cols[0]];
      pending = [];
      out.push(...cols);
    }
    if (b < cuts.length) pending.push(...cuts[b].items);
  }
  const footer = [...pending, ...spanRows.filter((r) => r.y >= bottom).flatMap((r) => r.items)];
  if (footer.length) {
    if (out.length) out[out.length - 1] = [...out[out.length - 1], ...footer];
    else out.push(footer);
  }
  return out.length ? out : [items];
}

// ── Filas ──

/** Segmento de texto: cadena de palabras vecinas de una misma línea, con su propia recta (sigue la inclinación local). */
interface Segment {
  items: Item[];
  x0: number;
  x1: number;
  h: number;
  cx: number;
  cy: number;
  slope: number;
}

/** Pendiente robusta (Theil–Sen: mediana de las pendientes entre pares), insensible a palabras con rasgos descendentes. */
function theilSen(pts: { x: number; y: number }[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - pts[i].x;
      if (Math.abs(dx) > 1e-6) slopes.push((pts[j].y - pts[i].y) / dx);
    }
  return slopes.length ? median(slopes) : 0;
}

function makeSegment(items: Item[]): Segment & { reliable: boolean } {
  const x0 = Math.min(...items.map((i) => i.x0));
  const x1 = Math.max(...items.map((i) => i.x1));
  const h = median(items.map((i) => i.h));
  const cx = items.reduce((s, i) => s + i.cx, 0) / items.length;
  const cy = items.reduce((s, i) => s + i.cy, 0) / items.length;
  // Sólo los segmentos largos tienen una pendiente propia fiable (base de las palabras, Theil–Sen)
  const reliable = items.length >= 5 && x1 - x0 >= 8 * h;
  const slope = reliable ? Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, theilSen(items.map((i) => ({ x: i.cx, y: i.y1 }))))) : 0;
  return { items, x0, x1, h, cx, cy, slope, reliable };
}

/**
 * Los segmentos cortos heredan la pendiente de los segmentos largos más cercanos en vertical: en una foto con
 * perspectiva la inclinación cambia poco a poco de arriba a abajo.
 */
function propagateSlopes(segs: (Segment & { reliable: boolean })[]): void {
  const anchors = segs.filter((s) => s.reliable);
  if (!anchors.length) return;
  for (const s of segs) {
    if (s.reliable) continue;
    const near = [...anchors].sort((a, b) => Math.abs(a.cy - s.cy) - Math.abs(b.cy - s.cy)).slice(0, 3);
    s.slope = median(near.map((a) => a.slope));
  }
}

/** Une cada palabra con su vecina inmediata por la derecha (mismo renglón, hueco de palabra) → segmentos. */
function chainSegments(items: Item[]): (Segment & { reliable: boolean })[] {
  const pairs: { a: Item; b: Item; cost: number }[] = [];
  const sorted = [...items].sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const hMin = Math.min(a.h, b.h);
      const hMax = Math.max(a.h, b.h);
      const gap = b.x0 - a.x1;
      if (gap > 1.3 * Math.max(a.h, 12) * 1.8) break;
      if (b.x0 < a.x1 - 0.3 * hMin || gap > 1.3 * hMax) continue;
      const small = hMin < 0.6 * hMax;
      const dy = Math.abs(b.cy - a.cy);
      if (dy > (small ? 0.5 * hMax : 0.45 * hMin)) continue;
      if (!small && hMax > 1.9 * hMin) continue;
      pairs.push({ a, b, cost: Math.max(0, gap) / hMax + (2 * dy) / hMax });
    }
  }
  pairs.sort((p, q) => p.cost - q.cost);
  const next = new Map<Item, Item>();
  const prev = new Map<Item, Item>();
  for (const p of pairs) {
    if (next.has(p.a) || prev.has(p.b)) continue;
    next.set(p.a, p.b);
    prev.set(p.b, p.a);
  }
  const segs: (Segment & { reliable: boolean })[] = [];
  for (const it of sorted) {
    if (prev.has(it)) continue;
    const chain = [it];
    let cur = next.get(it);
    while (cur && chain.length < 500) {
      chain.push(cur);
      cur = next.get(cur);
    }
    segs.push(makeSegment(chain));
  }
  propagateSlopes(segs);
  return segs;
}

interface RowBuild {
  segs: Segment[];
  /** Segmento de referencia (el más largo) para extrapolar la altura de la fila a otra x. */
  ref: Segment;
}

const yAt = (seg: Segment, x: number) => seg.cy + seg.slope * (x - seg.cx);

/**
 * Limpia las palabras de una fila visual: números volados de alérgenos (más pequeños y por encima de la línea base) y,
 * en los bordes del nombre (sobre todo entre el nombre y el precio), los restos que el OCR saca de iconos de alérgenos,
 * emoji y adornos: símbolos, glifos redondos del tamaño de un icono ("OO", "080", "@®") o palabras cortas que no existen
 * leídas con poca confianza. Nunca toca palabras reales ni el interior del nombre.
 */
function cleanRowItems(members: Item[]): Item[] {
  const sorted = [...members].sort((a, b) => a.x0 - b.x0);
  const words = sorted.filter((m) => letterCountOf(m.text) >= 2 && (m.conf ?? 100) >= 40);
  const ref = words.length ? words : sorted;
  const hr = median(ref.map((m) => m.h));
  // Centro vertical de las palabras de la fila (los trazos bajos de "gallega" no mueven el centro tanto como la base)
  const midY = median(ref.map((m) => m.cy));
  // Números volados (alérgenos "¹ ³ ⁷", "1,3,7" en pequeño): más bajos que el texto y enteros por encima de su centro
  const kept = sorted
    .filter((m) => !(m.h < 0.72 * hr && m.y1 < midY && !/\p{L}/u.test(m.text) && /\d/.test(m.text)))
    .map((m) => {
      // Icono pegado al final de una palabra ("romescoO", "brasa®"): se quita si lo que queda es una palabra real
      const glued = /^(\p{Ll}{3,})[OQG0@©®]$/u.exec(m.text);
      return glued && isRealWord(glued[1]) ? { ...m, text: glued[1], x1: m.x1 - (m.x1 - m.x0) / m.text.length } : m;
    });
  const isNum = (m: Item) => NUMERIC_BOX.test(m.text) || m.price;
  // ¿El nombre va en mayúsculas? (entonces una sigla en mayúsculas no delata nada)
  const nameWords = kept.filter((m) => letterCountOf(m.text) >= 4 && !fillerText(m.text) && (m.conf ?? 100) >= 70);
  const namesUpper = nameWords.length > 0 && nameWords.filter((m) => isShouting(m.text)).length >= nameWords.length / 2;
  // ¿Nombre Con Cada Palabra En Mayúscula? (entonces "De", "La", "A" pueden ser del nombre)
  const lowerWords = kept.filter((m) => /^\p{Ll}/u.test(m.text) && letterCountOf(m.text) >= 1).length;
  const namesTitle = !namesUpper && nameWords.length >= 2 && lowerWords === 0;
  const junk = (m: Item, trailingPrice: boolean, trailing = true): boolean => {
    const t = m.text;
    const letters = letterCountOf(t);
    const alnum = t.replace(/[^\p{L}\p{N}]/gu, '').length;
    if (!alnum) return true;
    if (SYMBOL_JUNK.test(t) && letters < 3 && !isNum(m)) return true;
    const core = t.replace(/^[([]+|[)\].,;:]+$/g, '');
    const perChar = (m.x1 - m.x0) / Math.max(1, core.length || t.length);
    // Icono redondo: cada glifo tan ancho como alto (una cifra o una letra son más estrechas); entre paréntesis, "(G)"
    const real = core.length >= 2 && core !== core.toUpperCase() ? isRealWord(core) : core.length >= 2 && isRealWord(core) && !ROUND_GLYPHS.test(core);
    if (ROUND_GLYPHS.test(core) && !real && (perChar >= (trailingPrice ? 0.75 : 0.9) * m.h || /^[([].*[)\]]$/.test(t))) return true;
    if (isNum(m)) return false;
    if (letters <= 3 && !isRealWord(t) && (m.conf ?? 100) < 75) return true;
    // Sigla corta en mayúsculas que no existe, detrás de un nombre que no va en mayúsculas ("… al carbón OJO")
    if (letters <= 3 && letters === alnum && core === core.toUpperCase() && !isRealWord(core) && !namesUpper) return true;
    // Letra o par de letras con mayúscula inicial al final de un nombre ("… al pil pil Su", "Mo", "G"): códigos de
    // alérgenos (iconos con letra, muy habituales como texto en los PDF de carta), no palabras del nombre
    if (trailing && /^\p{Lu}\p{Ll}?$/u.test(core) && !KEEP_UPPER.has(core.toUpperCase()) && !namesTitle) return true;
    // Relleno ("LALA", "AAA") o palabra en mayúsculas colgando de un nombre en minúsculas (salvo siglas: DO, BBQ, XL…)
    if (fillerText(t)) return true;
    if (!namesUpper && letters >= 2 && letters === alnum && core === core.toUpperCase() && !KEEP_UPPER.has(core)) return true;
    // Palabra desconocida mucho más baja que el texto de la fila: restos de un borde punteado bajo el nombre
    if (m.h < 0.6 * hr && letters >= 2 && !isRealWord(t)) return true;
    // Sólo letras sin trazos altos ni bajos ("nece", "acer", "reee"), más bajas que el texto y que no existen: así
    // lee el OCR una fila de puntos
    if (/^[aceimnorsuvwxz]+$/i.test(core) && m.h < 0.75 * hr && (m.conf ?? 100) < 75 && !isRealWord(core)) return true;
    // Letra suelta que no es una palabra ("O", "G", "Y" de un icono)
    if (alnum === 1 && letters === 1 && !isRealWord(t)) return true;
    // Mezcla de cifras y letras que no es una medida ("0LS", "5A", "8A"): resto de icono
    if (/\d/.test(core) && /\p{L}/u.test(core) && !/^\d+(?:[.,]\d+)?(?:g|gr|kg|ml|cl|l|uds?|pax|cm|º|ª)\.?$/i.test(core) && core.length <= 4) return true;
    return false;
  };
  const isCur = (m: Item) => /^(?:€|eur)$/i.test(m.text);
  const hasDec = (m: Item) => /\d[.,'’€]\d/.test(m.text) || /€|eur/i.test(m.text);
  // Cifras que son iconos: una sola cifra en una caja cuadrada, o una tira de glifos redondos ("00", "0000", "080") tan
  // anchos como altos (una cifra de verdad es mucho más estrecha que alta)
  const iconShape = (m: Item) => {
    const core = m.text.replace(/[^\p{L}\p{N}]/gu, '');
    if (core.length === 1) return m.text.trim().length === 1 && (m.x1 - m.x0) / m.h >= 0.85;
    return /^[0O8Q9D6]{2,6}$/.test(core) && !/[.,'’€]/.test(m.text) && (m.x1 - m.x0) / core.length >= 0.8 * m.h;
  };
  // Grupo de precios del final: el último precio y, delante, los del mismo formato y tamaño (media / ración, copa / botella)
  let end = kept.length;
  while (end > 0 && isCur(kept[end - 1])) end--;
  let priceStart = end;
  if (end > 0 && isNum(kept[end - 1]) && !iconShape(kept[end - 1])) {
    const lastP = kept[end - 1];
    priceStart = end - 1;
    while (priceStart > 0) {
      const t = kept[priceStart - 1];
      if (isCur(t)) {
        priceStart--;
        continue;
      }
      if (!isNum(t) || hasDec(t) !== hasDec(lastP) || iconShape(t) || t.h < 0.8 * lastP.h || t.h > 1.25 * lastP.h) break;
      priceStart--;
    }
  }
  // Precio delante del nombre (con decimales o €): lo que quede detrás del nombre no es otro precio salvo que tenga su formato
  const leadingPrice = kept.length > 2 && isNum(kept[0]) && hasDec(kept[0]) && letterCountOf(kept[1].text) >= 2;
  if (leadingPrice && priceStart < end && !kept.slice(priceStart, end).some(hasDec)) priceStart = end;
  const trailingPrice = priceStart < kept.length && priceStart < end;
  // Restos por la derecha del nombre (antes del precio): iconos, adornos y números sueltos de alérgenos. Las palabras
  // gramaticales cortas intercaladas ("… 2 Y acer") no detienen la limpieza, pero sólo se quitan si hay basura a su
  // izquierda (un nombre partido en dos renglones puede acabar en "… en su")
  const isJunkAt = (t: Item, k: number): boolean => {
    // Medidas del nombre ("300 g", "(6 uds)") se conservan
    if (UNIT_WORD.test(t.text) && k >= 2 && /^\(?\d+(?:[.,]\d+)?$/.test(kept[k - 2].text)) return false;
    const bareNumber = /^\d{1,3}[.,]?$/.test(t.text);
    return junk(t, trailingPrice) || (bareNumber && (trailingPrice || leadingPrice || iconShape(t)));
  };
  let k = priceStart;
  let scan = priceStart;
  while (scan > 0) {
    const t = kept[scan - 1];
    if (isJunkAt(t, scan - 1)) {
      scan--;
      k = scan;
      continue;
    }
    if (FUNCTION_WORDS.has(fold(t.text).replace(/[^a-z]/g, '')) && letterCountOf(t.text) <= 3) {
      scan--;
      continue;
    }
    break;
  }
  const end2 = priceStart;
  // Si todo era basura y no hay precio, la fila entera sobra
  const cleaned = [...kept.slice(0, k), ...kept.slice(end2)];
  // Restos por la izquierda (viñetas, iconos delante del nombre), sin tocar un precio delantero
  let s = 0;
  while (s < cleaned.length - 1 && !isNum(cleaned[s]) && junk(cleaned[s], false, false)) s++;
  const out = cleaned.slice(s).filter((m) => !(isNum(m) && m.text.replace(/\D/g, '').length >= 2 && iconShape(m) && !cleaned.some((o) => o !== m && letterCountOf(o.text) >= 3)));
  if (!out.some((m) => letterCountOf(m.text) >= 2 || isNum(m))) return [];
  return out;
}

/** Marca de «aquí empieza la descripción» dentro de una fila (cambio de tamaño de letra entre nombre y descripción). */
export const DESC_MARK = '⁞';

/** Tamaño de letra de una palabra: altura y, sobre todo, ancho por carácter (la cursiva pequeña es más estrecha). */
function wordSize(m: Item): number {
  const chars = m.text.replace(/\s+/g, '').length;
  return m.h ** 0.35 * ((m.x1 - m.x0) / Math.max(1, chars)) ** 0.65;
}

/**
 * Nombre y descripción en la misma línea con distinta letra ("Natillas  con galleta María y canela" con la descripción
 * en cursiva pequeña): devuelve la primera palabra de la descripción si la letra baja de forma clara (≥ 25 %) y se
 * mantiene hasta el final (sin contar el precio). undefined si la fila es de un solo tamaño.
 */
function descriptionSplit(members: Item[]): Item | undefined {
  const words = members.filter((m) => !NUMERIC_BOX.test(m.text) && !m.price && m.text !== '–');
  const measurable = (m: Item) => letterCountOf(m.text) >= 3;
  if (words.filter(measurable).length < 3) return undefined;
  let best: { at: Item; ratio: number } | undefined;
  for (let k = 1; k < words.length; k++) {
    const left = words.slice(0, k).filter(measurable).map(wordSize);
    const right = words.slice(k).filter(measurable).map(wordSize);
    if (left.length < 1 || right.length < 2 || words.length - k < 2) continue;
    // Toda la parte derecha más pequeña que la más pequeña de la izquierda, con margen amplio: el tamaño medido de una
    // palabra varía con sus letras (mayúsculas, trazos altos, letras anchas); con una sola palabra delante, más aún
    const ratio = Math.min(...left) / Math.max(...right);
    const need = left.length >= 2 ? 1.2 : 1.35;
    if (ratio >= need && median(left) / median(right) >= need + 0.1 && (!best || ratio > best.ratio)) best = { at: words[k], ratio };
  }
  return best?.at;
}

function groupRows(items: Item[]): MenuRow[] {
  const segs = chainSegments(items).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
  const rows: RowBuild[] = [];
  for (const seg of segs) {
    let best: RowBuild | undefined;
    let bestDist = Infinity;
    for (const row of rows) {
      const ref = row.ref;
      const x = (seg.x0 + seg.x1) / 2;
      const dist = Math.abs(yAt(seg, x) - yAt(ref, x));
      const small = seg.h < 0.6 * ref.h;
      // Un precio alineado a la derecha está lejos del nombre: la inclinación residual pesa más → más tolerancia
      const priceSeg = seg.items.every((i) => i.price || /^[€$]$/.test(i.text));
      const tol = priceSeg && !ref.items.every((i) => i.price) ? 0.75 * ref.h : 0.5 * (small ? ref.h : Math.min(seg.h, ref.h));
      if (dist > tol || dist >= bestDist) continue;
      const collides = row.segs.some((o) => {
        const ov = Math.min(o.x1, seg.x1) - Math.max(o.x0, seg.x0);
        return ov > 0.3 * Math.min(o.x1 - o.x0, seg.x1 - seg.x0);
      });
      if (collides) continue;
      best = row;
      bestDist = dist;
    }
    if (best) best.segs.push(seg);
    else rows.push({ segs: [seg], ref: seg });
  }

  const colX0 = Math.min(...items.map((i) => i.x0));
  const colX1 = Math.max(...items.map((i) => i.x1));
  // Orden de arriba a abajo por la altura de cada fila (en su propio centro, sin extrapolar lejos)
  const built = rows
    .map((row) => {
      const keep = new Set(cleanRowItems(row.segs.flatMap((sg) => sg.items)));
      if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MENU_DEBUG_ROWS) console.log('fila', row.segs.flatMap((sg) => sg.items).map((i) => i.text).join(' | '), '→', [...keep].map((i) => i.text).join(' '));
      const members = [...keep].sort((a, b) => a.x0 - b.x0);
      if (!members.length) return undefined;
      const descAt = descriptionSplit(members);
      const segsByX = row.segs
        .map((sg) => sg.items.filter((i) => keep.has(i)).sort((a, b) => a.x0 - b.x0))
        .filter((list) => list.length)
        .map((list) => ({ items: list, x0: list[0].x0, x1: Math.max(...list.map((i) => i.x1)), h: median(list.map((i) => i.h)) }))
        .sort((a, b) => a.x0 - b.x0);
      let text = '';
      let prevX1 = -Infinity;
      let prevH = 0;
      for (const sg of segsByX) {
        if (text) text += sg.x0 - prevX1 > 0.9 * Math.max(sg.h, prevH) ? (descAt === sg.items[0] ? ` ${DESC_MARK} ` : '   ') : descAt === sg.items[0] ? ` ${DESC_MARK} ` : ' ';
        text += sg.items.map((i, n) => (n > 0 && i === descAt ? `${DESC_MARK} ${i.text}` : i.text)).join(' ');
        prevX1 = Math.max(prevX1, sg.x1);
        prevH = sg.h;
      }
      // Tamaño de letra: sólo con cajas de texto «simples» (una línea OCR con huecos de columna dentro, p. ej.
      // "Bravas      6,50 €", no permite medir el ancho por carácter).
      const ref = members.filter((m) => !m.price && !NUMERIC_BOX.test(m.text) && /\p{L}/u.test(m.text) && !/\s{3,}/.test(m.text));
      let size = 0;
      if (ref.length) {
        const h = median(ref.map((m) => m.h));
        const chars = ref.reduce((n, m) => n + m.text.replace(/\s+/g, '').length, 0);
        const charW = ref.reduce((n, m) => n + (m.x1 - m.x0), 0) / Math.max(1, chars);
        // El ancho por carácter pesa más: separa mejor la cursiva pequeña de las descripciones que la altura de la caja
        size = h ** 0.35 * charW ** 0.65;
      }
      const confs = members.map((m) => m.conf).filter((c): c is number => c !== undefined && Number.isFinite(c));
      const textH = median((ref.length ? ref : members).map((m) => m.h));
      const rowRef = row.ref;
      // Geometría del nombre: dónde acaba y dónde empiezan los precios del final
      const isPriceTok = (m: Item) => m.price || NUMERIC_BOX.test(m.text) || /^(?:€|eur)$/i.test(m.text);
      let p = members.length;
      while (p > 0 && isPriceTok(members[p - 1])) p--;
      const nameMembers = members.slice(0, p).filter((m) => m.text !== '–');
      const firstWord = members.find((m) => letterCountOf(m.text) >= 1);
      const geometry = {
        ...(nameMembers.length ? { nameX1: Math.max(...nameMembers.map((m) => m.x1)) } : {}),
        ...(p < members.length ? { priceX0: members[p].x0 } : {}),
        ...(firstWord ? { firstWordW: firstWord.x1 - firstWord.x0 } : {}),
        textH,
      };
      return {
        ref: rowRef,
        y: rowRef.cy,
        h: textH,
        row: {
          text,
          size,
          ...(confs.length ? { confidence: confs.reduce((a, c) => a + c, 0) / confs.length } : {}),
          x0: members[0].x0,
          x1: Math.max(...members.map((m) => m.x1)),
          colX0,
          colX1,
          ...geometry,
        } as MenuRow,
      };
    })
    .filter((b): b is NonNullable<typeof b> => !!b)
    .sort((a, b) => a.y - b.y);
  // Borde derecho útil de la columna: percentil alto de los finales de fila (el título o una línea suelta más ancha no
  // cuentan), para saber si un nombre largo tuvo que partirse
  const ends = built.map((b) => b.row.x1 ?? 0).filter((x) => x > 0).sort((p, q) => p - q);
  if (ends.length >= 4) {
    const edge = ends[Math.floor(0.85 * (ends.length - 1))];
    for (const b of built) b.row.colX1 = edge;
  }
  for (let i = 1; i < built.length; i++) {
    const a = built[i - 1];
    const b = built[i];
    const x = (a.ref.cx + b.ref.cx) / 2;
    const gap = yAt(b.ref, x) - yAt(a.ref, x) - (a.h + b.h) / 2;
    b.row.gap = Math.max(0, gap) / Math.max(1, b.h);
  }
  return built.map((b) => b.row);
}

/** Línea de la capa de texto de un PDF con sus fragmentos posicionados (forma de `PdfTextLine` de pdf.ts). */
export interface PositionedLine {
  page: number;
  /** Línea base (de arriba a abajo). */
  y: number;
  items: readonly { x: number; width: number; str: string }[];
}

/** Ancho aproximado de un carácter en «em» (tipografía proporcional media), para repartir el ancho de un fragmento. */
function charEm(c: string): number {
  if (/[.,:;'!|·´`]/.test(c)) return 0.28;
  if (c === ' ') return 0.28;
  if (/[iljtfrIíï1]/.test(c)) return 0.32;
  if (/[mwMWæœ]/.test(c)) return 0.85;
  if (/\d/.test(c)) return 0.55;
  if (/\p{Lu}/u.test(c)) return 0.66;
  if (/[_—–-]/.test(c)) return 0.5;
  return 0.52;
}

/**
 * Cajas de palabra a partir de la capa de texto de un PDF de carta (para reconstruir columnas, filas y tamaños de letra
 * con el mismo motor que las fotos). El ancho de cada fragmento se reparte entre sus caracteres según su anchura típica
 * (un relleno de puntos ocupa poco por carácter, una «m» mucho), y la altura de la caja es el cuerpo de letra estimado,
 * así una descripción en letra más pequeña sigue siéndolo.
 */
export function pdfLinesToMenuBoxes(lines: readonly PositionedLine[]): MenuBox[] {
  const out: MenuBox[] = [];
  for (const l of lines) {
    for (const it of l.items) {
      const str = it.str.replace(/\s+/g, ' ').trim();
      if (!str || !(it.width > 0)) continue;
      const ems = [...str].map(charEm);
      const em = it.width / Math.max(0.5, ems.reduce((a, b) => a + b, 0));
      const h = Math.max(1, em);
      let x = it.x;
      let k = 0;
      for (const word of str.split(' ')) {
        const w = [...word].reduce((acc, _c, n) => acc + ems[k + n], 0) * em;
        out.push({ text: word, bbox: { x0: x, y0: l.y - 0.78 * h, x1: x + w, y1: l.y + 0.22 * h }, page: l.page });
        k += [...word].length + 1;
        x += w + 0.28 * em;
      }
    }
  }
  return out;
}

/**
 * Reconstruye las filas visuales de la carta a partir de las cajas del OCR (palabras o líneas): limpia rellenos de
 * puntos y adornos, corrige la inclinación, separa las columnas de platos por sus calles verticales (con el título, las
 * cabeceras de ancho completo y el pie en su sitio) y agrupa por altura, de modo que el precio alineado a la derecha
 * (aunque quede un poco más alto o más bajo que el nombre) cae en la fila del plato. En cada fila se descartan los
 * restos de iconos de alérgenos y los números volados. Devuelve una lista de filas por columna, en orden de lectura.
 */
export function boxesToStreams(boxes: readonly MenuBox[]): MenuRow[][] {
  // Cada página / foto tiene sus propias coordenadas: se reconstruye por separado y en orden
  const pages = new Map<number, MenuBox[]>();
  for (const b of boxes) {
    const p = Number.isFinite(b.page) ? (b.page as number) : 1;
    const list = pages.get(p) ?? [];
    list.push(b);
    pages.set(p, list);
  }
  const out: MenuRow[][] = [];
  for (const p of [...pages.keys()].sort((a, b) => a - b)) {
    const items = prefilter(toItems(pages.get(p) ?? []));
    if (!items.length) continue;
    const slope = skewOf(items);
    if (slope) {
      // Enderezado completo (cizalla en y para las filas y en x para que las calles entre columnas queden verticales)
      const xRef = Math.min(...items.map((i) => i.x0));
      const yRef = Math.min(...items.map((i) => i.y0));
      for (const it of items) {
        const dy = slope * (it.cx - xRef);
        const dx = slope * (it.cy - yRef);
        it.y0 -= dy;
        it.y1 -= dy;
        it.cy -= dy;
        it.x0 += dx;
        it.x1 += dx;
        it.cx += dx;
      }
    }
    const H = typicalHeight(items);
    out.push(...splitColumns(items, H).map(groupRows).filter((rows) => rows.length));
  }
  return out;
}
