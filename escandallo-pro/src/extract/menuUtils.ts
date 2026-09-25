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
    .replace(ALLERGEN_NUM_LIST, (m) => (m.match(/\d+/g) ?? []).every((d) => Number(d) >= 1 && Number(d) <= 14) ? ' ' : m)
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
    // Moneda delante: "€ 12,50", "€12"
    const pre = /(?:€|eur)\s?$/i.exec(head);
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
  // Enteros: 1–999, sin años (1990–2035 son añadas de vino) y sin "nº 2", "para 2"
  if (t.value < 1 || t.value > 999) return false;
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
    // "6 50" → 6,50 (coma perdida)
    if (!prev.hasDecimals && !last.hasDecimals && !last.gapBefore && !prev.currency && /^\d{1,2}$/.test(prev.raw) && /^\d{2}$/.test(last.raw) && !tail.labels.length) {
      const merged = Number(`${prev.raw}.${last.raw}`);
      const ratio = prev.value / last.value;
      if (ratio < 0.2 && merged >= 0.5) return { price: merged, used: 2, multi: false, corrected: true, merged: true, dropped: 0 };
    }
    const candidates = toks.filter(plausible);
    const sameStyle = candidates.every((t) => t.hasDecimals === candidates[0].hasDecimals);
    if (candidates.length >= 2 && candidates.includes(last)) {
      const values = candidates.map((t) => t.value);
      const max = Math.max(...values);
      const min = Math.min(...values);
      const ratio = min / max;
      if ((tail.labels.length > 0 || multiContext || sameStyle) && ratio >= 0.2 && ratio < 1) {
        return { price: max, used: n, multi: true, corrected: candidates.some((t) => t.corrected), merged: false, dropped: 0 };
      }
      if (ratio === 1 && sameStyle) return { price: max, used: n, multi: true, corrected: candidates.some((t) => t.corrected), merged: false, dropped: 0 };
    }
    // Alérgenos numerados delante del precio
    if (last.hasDecimals || last.currency) {
      const before = toks.slice(0, -1);
      if (before.every((t) => !t.hasDecimals && t.value >= 1 && t.value <= 14 && !t.currency)) {
        return plausible(last) ? { price: last.value, used: n, multi: false, corrected: last.corrected, merged: false, dropped: before.length } : undefined;
      }
    }
  }
  if (!plausible(last)) return undefined;
  // Un entero pegado al nombre sin moneda ni hueco sólo vale si hay algo de nombre delante
  return { price: last.value, used: 1, multi: false, corrected: last.corrected, merged: false, dropped: 0 };
}

// ───────────────────────────── Ruido ─────────────────────────────

const RE_WEB = /(www\.|https?:\/\/|\.(?:com|es|net|org|eu|cat|info)\b|@[a-z0-9_.]{3,}|\b[\w.-]+@[\w.-]+\.\w+|instagram|facebook|tiktok|twitter|tripadvisor|s[ií]guenos|google\s+maps)/i;
const RE_TEL_WORD = /\b(?:tel[eé]fonos?|tel[fs]?\.?|tlfno?\.?|m[oó]vil|whatsapp|fax)\b/i;
const RE_ADDRESS = /(?:^|[\s,])(?:c\/\s?\S|calle\s|avda\.?\s|av\.\s|avenida\s|plaza\s|pza\.?\s|paseo\s|p[º°o]\.?\s|ctra\.?\s|carretera\s|pol[ií]gono\s|urb\.\s|local\s+\d)/i;
const RE_POSTCODE = /\b(?:0[1-9]|[1-4]\d|5[0-2])\d{3}\b\s+[A-ZÁÉÍÓÚ][a-záéíóúñ]+/;
const RE_TIME = /\b\d{1,2}[:h]\d{2}\s*h?\b|\b\d{1,2}[.:]\d{2}\s*(?:-|–|a|y)\s*\d{1,2}[.:]\d{2}\b|\bde\s+\d{1,2}\s*(?:a|-|–)\s*\d{1,2}\s*h\b/i;
const RE_HOURS_WORD = /\b(?:horarios?|abierto|abrimos|cerrado|cerramos|descanso\s+semanal|cocina\s+(?:abierta|ininterrumpida|non\s+stop))\b/i;
const RE_WEEKDAYS = /\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?|festivos|l\s?-\s?[vd]|de\s+l\s+a\s+[vd])\b/i;
const RE_INFO =
  /\b(?:precios?\s+(?:en\s+euros|con\s+iva|iva|incluyen)|consulte|consultar\s+(?:al|la\s+carta\s+de)\s+al[eé]rgenos|informaci[oó]n\s+(?:sobre|de)\s+al[eé]rgenos|al[eé]rgenos|intoleranci|gracias\s+por|buen\s+provecho|bienvenid[oa]s?|wi-?fi|p[aá]gina\s+\d|p[aá]g\.\s?\d|servicio\s+(?:de\s+mesa|no\s+incluido)|no\s+se\s+(?:admiten|sirven)|reservas\s*:|reserv[ae]\s+(?:su|tu)\s+mesa|haga\s+su\s+reserva|hoja\s+de\s+reclamaciones|disponemos\s+de|a\s+su\s+disposici[oó]n|pan\s+y\s+servicio|todos\s+nuestros\s+precios)\b/i;
const ALLERGEN_WORDS = /\b(?:gluten|crust[aá]ceos?|huevos?|pescados?|cacahuetes?|soja|l[aá]cteos|leche|frutos\s+(?:secos|de\s+c[aá]scara)|apio|mostaza|s[eé]samo|sulfitos|altramuces|moluscos)\b/gi;
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
  const decorated = /^[\s\-–~*=·•#_|:.«»"]{1,}\S/.test(s) && /\S[\s\-–~*=·•#_|:.«»"]{1,}$/.test(s) && /^[-–~*=·•#_|]/.test(s);
  const colon = /:\s*$/.test(s);
  const spaced = collapseSpacedLetters(s) !== s;
  s = collapseSpacedLetters(s)
    .replace(/^[\s\-–~*=·•#_|:.«»"]+/, '')
    .replace(/[\s\-–~*=·•#_|:.«»"]+$/, '')
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

/** Sustituciones típicas del OCR dentro de una palabra: "homo" → "horno" (rn ↔ m), "cl" ↔ "d", "li" ↔ "h". */
const LETTER_CONFUSIONS: [string, string][] = [['m', 'rn'], ['rn', 'm'], ['cl', 'd'], ['d', 'cl'], ['h', 'li'], ['li', 'h'], ['vv', 'w']];

/**
 * Repara una palabra de nombre o descripción mal leída por el OCR, sólo si el resultado es una palabra culinaria
 * conocida: cifras dentro de palabras ("jam0n", "a1ioli", "jam6n"), confusiones de letras ("homo" → "horno") y tildes
 * perdidas ("jamon" → "jamón"). Las palabras conocidas no se tocan.
 */
export function fixOcrWord(w: string): string {
  let word = w;
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
  let out = toks.map((t) => (/^\s+$/.test(t) ? t : fixOcrWord(t))).join('');
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

/** Separa cartas a dos (o tres) columnas usando las columnas de precios y el texto que empieza a su derecha. */
function splitColumns(items: Item[], depth = 0): Item[][] {
  const prices = items.filter((i) => i.price);
  if (prices.length < 6 || depth > 1) return [items];
  const minX = Math.min(...items.map((i) => i.x0));
  const maxX = Math.max(...items.map((i) => i.x1));
  const width = maxX - minX;
  const xs = prices.map((p) => p.x1).sort((a, b) => a - b);
  const clusters: number[][] = [[xs[0]]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > 0.08 * width) clusters.push([]);
    clusters[clusters.length - 1].push(xs[i]);
  }
  const big = clusters.filter((c) => c.length >= 3);
  if (big.length < 2) return [items];
  const bound = Math.max(...big[0]);
  const hMed = median(items.map((i) => i.h));
  // Texto (no precios) que empieza a la derecha de la primera columna de precios
  const rightText = items.filter((i) => !i.price && i.x0 > bound + 0.5 * hMed && /\p{L}{2,}/u.test(i.text));
  if (rightText.length < 3) return [items];
  const startRight = Math.min(...rightText.map((i) => i.x0));
  const boundary = (bound + startRight) / 2;
  const left = items.filter((i) => i.x0 < boundary);
  const right = items.filter((i) => i.x0 >= boundary);
  if (left.length < 3 || right.length < 3) return [items];
  return [left, ...splitColumns(right, depth + 1)];
}

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
      const tol = 0.5 * (small ? ref.h : Math.min(seg.h, ref.h));
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

  // Orden de arriba a abajo por la altura de cada fila (en su propio centro, sin extrapolar lejos)
  const built = rows
    .map((row) => {
      const members = row.segs.flatMap((sg) => sg.items).sort((a, b) => a.x0 - b.x0);
      const segsByX = [...row.segs].sort((a, b) => a.x0 - b.x0);
      let text = '';
      let prevX1 = -Infinity;
      let prevH = 0;
      for (const sg of segsByX) {
        const segText = sg.items
          .sort((a, b) => a.x0 - b.x0)
          .map((i) => i.text)
          .join(' ');
        if (text) text += sg.x0 - prevX1 > 0.9 * Math.max(sg.h, prevH) ? '   ' : ' ';
        text += segText;
        prevX1 = Math.max(prevX1, sg.x1);
        prevH = sg.h;
      }
      // Tamaño de letra: sólo con cajas de texto «simples» (una línea OCR con huecos de columna dentro, p. ej.
      // "Bravas      6,50 €", no permite medir el ancho por carácter).
      const ref = members.filter((m) => !m.price && /\p{L}/u.test(m.text) && !/\s{3,}/.test(m.text));
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
      return {
        ref: row.ref,
        y: row.ref.cy,
        h: textH,
        row: { text, size, ...(confs.length ? { confidence: confs.reduce((a, c) => a + c, 0) / confs.length } : {}) } as MenuRow,
      };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < built.length; i++) {
    const a = built[i - 1];
    const b = built[i];
    const x = (a.ref.cx + b.ref.cx) / 2;
    const gap = yAt(b.ref, x) - yAt(a.ref, x) - (a.h + b.h) / 2;
    b.row.gap = Math.max(0, gap) / Math.max(1, b.h);
  }
  return built.map((b) => b.row);
}

/**
 * Reconstruye las filas visuales de la carta a partir de las cajas del OCR (palabras o líneas): corrige la inclinación,
 * separa columnas de platos si la carta va a dos columnas y agrupa por altura, de modo que el precio alineado a la
 * derecha (aunque quede un poco más alto o más bajo que el nombre) cae en la fila del plato.
 * Devuelve una lista de filas por columna, en orden de lectura.
 */
export function boxesToStreams(boxes: readonly MenuBox[]): MenuRow[][] {
  const items = toItems(boxes);
  if (!items.length) return [];
  const slope = skewOf(items);
  if (slope) {
    const xRef = Math.min(...items.map((i) => i.x0));
    for (const it of items) {
      const d = slope * (it.cx - xRef);
      it.y0 -= d;
      it.y1 -= d;
      it.cy -= d;
    }
  }
  return splitColumns(items).map(groupRows);
}
