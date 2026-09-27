import type { ExtractedMenu } from '../types';
import { round } from '../core/numbers';
import {
  boxesToStreams,
  DESC_MARK,
  extractTailPrices,
  isDescriptionLike,
  isKnownFoodWord,
  isNoiseLine,
  isShouting,
  menuKey,
  normalizeMenuLine,
  pickPrice,
  RE_CHARGE,
  RE_MARKET_PRICE,
  repairOcrText,
  sectionInfo,
  toSentenceCase,
  toTitleCase,
  type MenuBox,
  type MenuRow,
  type SectionInfo,
  type TailPrices,
} from './menuUtils';
import { editDistance, fold, median } from './textUtils';

export type { MenuBox } from './menuUtils';

type Entry = ExtractedMenu['entries'][number];

/** Línea analizada de la carta. */
interface Line {
  text: string;
  kind: 'noise' | 'price' | 'priced' | 'plain' | 'colheader';
  /** Texto sin precios (nombre, descripción o cabecera). */
  name: string;
  tail?: TailPrices;
  price?: number;
  corrected: boolean;
  merged: boolean;
  multi: boolean;
  /** Precio entero sin símbolo de moneda ni hueco de columna delante ("Pulpo 18"): más dudoso. */
  weakPrice?: boolean;
  /** Cifras decimales con que está impreso el precio (0 = entero): delata comas perdidas por el OCR. */
  decimals?: number;
  perUnit?: string;
  /** Precio de mercado ("S/M", "según mercado", "consultar"). */
  market: boolean;
  /** Texto de sección que acompaña a una cabecera de columnas de precio ("RACIONES   MEDIA   RACIÓN"). */
  headerSection?: string;
  /** Descripción en la misma fila, separada del nombre por un hueco de columna ("Pulpo   Con cachelos   19,50"). */
  desc?: string;
  /** Tamaño de letra aproximado (0 = desconocido). */
  size: number;
  /** Hueco vertical con la fila anterior, en alturas de texto (undefined = desconocido). */
  gap?: number;
  confidence?: number;
  /** Geometría de la fila (sólo con cajas del OCR). */
  row?: MenuRow;
}

/** Plato en construcción. */
interface Draft {
  name: string;
  description?: string;
  price?: number;
  section?: string;
  wine: boolean;
  /** Confianza del precio (0–1) según cómo se ha emparejado. */
  priceConf: number;
  decimals?: number;
  ocrConf?: number;
  corrected: boolean;
  perUnit?: string;
  market: boolean;
  /** Número de cambio de sección en que se creó (para descartar el pie de la carta). */
  serial: number;
  order: number;
}

const PRICE_HEADER_LABEL = /(?:^|\s)(1\/2\s?raci[oó]n|media\sraci[oó]n|1\/2|½|media|raci[oó]n|rac\.?|tapa|pincho|copa|botella|bot\.?|ca[ñn]a|jarra|pinta|entera|mitad|individual|grande|peque[ñn]a)\s*[:.]?\s*$/i;
/** Platos grandes o para compartir, en los que un precio alto es normal. */
const SHARED_DISH = /\b(?:para\s+\d|personas|pax|compartir|mariscada|parrillada|bandeja|kilo|kg|botella|magnum|men[uú]|degustaci[oó]n|enter[oa]|pieza)\b/i;
/** Palabras de sección que también son platos ("Croquetas 9,50" en la línea siguiente). */
const DUAL_SECTION = new Set(['croquetas', 'huevos', 'quesos', 'tostas', 'tacos', 'sushi', 'wok', 'fritura', 'tablas', 'montaditos', 'combinados']);

/** "RACIONES   MEDIA   RACIÓN" → { labels: 2, rest: "RACIONES" }. */
function priceHeader(text: string): { labels: number; rest: string } {
  let rest = text.replace(/[\s:|/·–-]+$/, '');
  let labels = 0;
  let m = PRICE_HEADER_LABEL.exec(rest);
  while (m) {
    labels++;
    rest = rest.slice(0, m.index).replace(/[\s:|/·–-]+$/, '');
    m = PRICE_HEADER_LABEL.exec(rest);
  }
  return { labels, rest: rest.trim() };
}

/** Limpia el texto de nombre: viñetas, numeración, separadores sueltos y basura típica del OCR en los bordes. */
function cleanName(s: string): string {
  let t = s
    .replace(/^\s*(?:[-–•·*>»|!¡\][_~=]+\s*|\d{1,2}\s*[.)]\s+(?=\p{L}))/u, '')
    // Numeración con el punto leído como coma ("4, Tequeños") y moneda suelta del precio de al lado ("EUR Rape…")
    .replace(/^\s*(?:\d{1,2},\s+(?=\p{Lu})|(?:€|eur(?:os)?)\s+(?=\p{L}))/iu, '')
    .replace(/^[li]\s+(?=\p{Lu})/u, '')
    .replace(/[\s.·•…_\-–:|,;/€]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Paréntesis sin cerrar al final ("Croquetas (6 uds" → se cierra)
  if ((t.match(/\(/g) ?? []).length > (t.match(/\)/g) ?? []).length && /\([^)]*$/.test(t)) t += ')';
  return t;
}

function letterCount(s: string): number {
  return s.replace(/[^\p{L}]/gu, '').length;
}

/** ¿El texto parece un nombre de plato (y no basura del OCR)? */
function looksLikeName(s: string): boolean {
  const letters = letterCount(s);
  if (letters < 3) return false;
  const compact = s.replace(/\s+/g, '');
  if (letters / compact.length < 0.6) return false;
  const words = s.split(/\s+/).filter((w) => letterCount(w) >= 1);
  if (!words.some((w) => letterCount(w) >= 3)) return false;
  // Palabras con vocal (el OCR de iconos produce "lll", "rrr", "Wv")
  const vowelWords = words.filter((w) => /[aeiouáéíóúü]/i.test(w)).length;
  return vowelWords / words.length >= 0.5;
}

/** Nombre y descripción en columnas distintas de la misma fila ("Pulpo   Con cachelos") o con distinta letra (marca). */
function splitNameColumns(raw: string): { name: string; desc?: string } {
  const mark = raw.indexOf(DESC_MARK);
  if (mark >= 0) {
    const name = cleanName(raw.slice(0, mark));
    const desc = cleanName(raw.slice(mark + 1).replace(/^[\s–-]+/, ''));
    if (letterCount(name) >= 3) return { name, ...(letterCount(desc) >= 3 ? { desc } : {}) };
    return { name: cleanName(raw.replace(DESC_MARK, ' ')) };
  }
  const gap = /^(.*?\S)\s{3,}(\S.*?)\s*$/.exec(raw);
  if (gap && letterCount(gap[1]) >= 3 && isDescriptionLike(gap[2]) && letterCount(gap[2]) >= 4) return { name: cleanName(gap[1]), desc: cleanName(gap[2]) };
  return { name: cleanName(raw) };
}

/** Texto a la izquierda de los `used` últimos precios (sin sus etiquetas si hay varios precios). */
function nameBeforePrices(text: string, tail: TailPrices, used: number): { name: string; desc?: string } {
  const first = tail.tokens[tail.tokens.length - used];
  // Otro precio con decimales o moneda delante del elegido (copa / botella sin cabecera de columnas): no es del nombre
  const head = text.slice(0, used >= 2 ? first.labelStart : first.start).replace(/(?:\s+(?:€\s?)?\d{1,3}[.,]\d{2}\s?(?:€|eur\b)?)+\s*$/i, '');
  return splitNameColumns(head);
}

/** Precio delante del nombre ("12,50   Croquetas", "€9 Bravas", "14 Pulpo"): grupo 1 = precio, resto = nombre. */
const LEADING_PRICE = /^\s*((?:€\s?)?(\d{1,3})(?:([.,'’])(\d{1,2})|€(\d{2})|[.,]-)?(\s?(?:€|eur\b))?)\s+(?=[\p{L}¡¿"(])/iu;

interface LeadingPrice {
  price: number;
  decimals: number;
  /** Con decimales o símbolo de moneda: no puede ser una cantidad ni una numeración. */
  strong: boolean;
  rest: string;
}

/** Precio al principio de la línea (con su nombre detrás) o undefined. Las numeraciones ("1. ", "2) ") no cuentan. */
function leadingPrice(text: string): LeadingPrice | undefined {
  const m = LEADING_PRICE.exec(text);
  if (!m) return undefined;
  const rest = text.slice(m[0].length);
  if (letterCount(rest) < 3) return undefined;
  const cents = m[4] ?? m[5];
  const strong = cents !== undefined || /€|eur/i.test(m[1]);
  // "1. Croquetas", "2) Bravas": numeración de la carta
  if (!strong && /^\s*\d{1,2}\s*[.)]\s/.test(text)) return undefined;
  const price = Number(`${m[2]}${cents !== undefined ? `.${cents.length === 1 ? `${cents}0` : cents}` : ''}`);
  if (!(price >= 0.5 && price <= 999)) return undefined;
  return { price, strong, rest, decimals: cents?.length ?? 0 };
}

/** Añada de un vino escrita sola. */
const VINTAGE = /^(?:19[5-9]\d|20[0-3]\d)$/;

function analyze(row: MenuRow, ctx: { leading: boolean } = { leading: false }): Line | undefined {
  const text = normalizeMenuLine(row.text);
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return undefined;
  const base: Line = { text, kind: 'plain', name: text, corrected: false, merged: false, multi: false, market: false, size: row.size, gap: row.gap, confidence: row.confidence, row };

  // Precio delante del nombre (cartas con la columna de precios a la izquierda)
  const lead = leadingPrice(text);
  const restTail = lead ? extractTailPrices(lead.rest) : undefined;
  const restPick = restTail ? pickPrice(restTail) : undefined;
  // Un entero suelto detrás del nombre no compite con un precio delantero con decimales ("12,50 Croquetas 6")
  const weakTail = !!restPick && !!restTail && restTail.tokens.slice(restTail.tokens.length - restPick.used).every((t) => !t.hasDecimals && !t.currency);
  if (lead && restTail && (lead.strong || ctx.leading) && (!restPick || (lead.strong && weakTail)) && !isNoiseLine(lead.rest)) {
    const body = restPick ? restTail.head : lead.rest;
    const { name, desc } = splitNameColumns(body);
    if (RE_CHARGE.test(name)) return { ...base, kind: 'noise' };
    return { ...base, kind: 'priced', name, price: lead.price, weakPrice: !lead.strong, decimals: lead.decimals, ...(desc ? { desc } : {}) };
  }

  // Precio de mercado
  const market = RE_MARKET_PRICE.exec(text);
  if (market && letterCount(text.slice(0, market.index)) >= 3 && !isNoiseLine(text.slice(0, market.index))) {
    return { ...base, name: cleanName(text.slice(0, market.index).replace(/[\s(–-]+$/, '')), market: true };
  }

  // Cabecera de columnas de precio ("MEDIA   RACIÓN", "Copa   Botella"; las etiquetas suelen ir en letra más pequeña)
  const header = priceHeader(text.split(DESC_MARK).join(' '));
  if (header.labels >= 2 && !/\d/.test(text.replace(/\b1\/2\b/g, ''))) {
    return { ...base, kind: 'colheader', name: header.rest, ...(header.rest ? { headerSection: header.rest } : {}) };
  }

  const tail = extractTailPrices(text);
  const picked = pickPrice(tail);
  if (picked) {
    const n = tail.tokens.length;
    const { name, desc } = nameBeforePrices(text, tail, picked.used);
    const decimal = tail.tokens.slice(n - picked.used).some((t) => t.hasDecimals || t.currency);
    if (isNoiseLine(text, { decimal, any: true }) || RE_CHARGE.test(name)) return { ...base, kind: 'noise' };
    const used = tail.tokens.slice(n - picked.used);
    const priceOnly = letterCount(text.slice(0, used[0].start)) < 2;
    const weakPrice = used.every((t) => !t.hasDecimals && !t.currency && (priceOnly || !t.gapBefore));
    const chosen = used.find((t) => Math.abs(t.value - picked.price) < 1e-9);
    const decimals = picked.merged ? 2 : chosen ? (/[.,'](\d{1,2})$/.exec(chosen.raw)?.[1].length ?? 0) : 0;
    const priced = {
      tail,
      price: picked.price,
      weakPrice,
      decimals,
      ...(desc ? { desc } : {}),
      corrected: picked.corrected,
      merged: picked.merged,
      multi: picked.multi,
      ...(tail.perUnit ? { perUnit: tail.perUnit } : {}),
    };
    if (letterCount(name) < 2) return { ...base, ...priced, kind: 'price', name: '' };
    return { ...base, ...priced, kind: 'priced', name };
  }
  if (isNoiseLine(text) || isNoiseLine(row.text)) return { ...base, kind: 'noise' };
  const { name, desc } = text.includes(DESC_MARK) ? splitNameColumns(text) : { name: cleanName(text), desc: undefined };
  if (RE_CHARGE.test(name)) return { ...base, kind: 'noise' };
  // Una añada suelta ("2019") puede ser el final del nombre de un vino partido en dos renglones; otra cifra sola, ruido
  if (letterCount(name) < 2 && !VINTAGE.test(name)) return { ...base, kind: 'noise' };
  return { ...base, name, ...(desc ? { desc } : {}) };
}

/** Separa "Pulpo a la gallega – con cachelos y pimentón" en nombre y descripción. */
function splitInlineDescription(name: string): { name: string; description?: string } {
  const m = /^(.{6,}?)\s*(?::|\s[–-]\s|,\s)\s*(\S.*)$/.exec(name);
  if (m && m[1].trim().split(/\s+/).length >= 2 && isDescriptionLike(m[2]) && !/^\d/.test(m[2])) {
    return { name: m[1].trim(), description: m[2].trim() };
  }
  // Guion o punto entre nombre y descripción ("Natillas – Con galleta María", "Café solo. Café en grano")
  const d = /^(.{3,}?\p{L})(?:\s[–-]\s|\.\s|:\s)(\p{L}.*)$/u.exec(name);
  if (d && d[2].trim().split(/\s+/).length >= 2 && !/\b[A-Z]\.?$|\b(?:d\.o|sta|avda|ctra)$/i.test(d[1])) {
    return { name: d[1].trim(), description: d[2].trim() };
  }
  const p = /^(.{6,}?)\s*\(([^()]{6,})\)$/.exec(name);
  if (p && p[2].trim().split(/\s+/).length >= 2 && isDescriptionLike(p[2]) && !/^\d/.test(p[2].trim())) {
    return { name: p[1].trim(), description: p[2].trim() };
  }
  return { name };
}

/** Carta en texto a dos columnas ("Bravas  6,50      Entrecot  22,00"): separa en dos flujos de lectura. */
function splitTextColumns(rows: MenuRow[]): MenuRow[][] {
  type Seg = { start: number; text: string };
  const segsOf = (s: string): Seg[] => {
    const out: Seg[] = [];
    const re = /\S+(?:\s{1,2}\S+)*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) out.push({ start: m.index, text: m[0] });
    return out;
  };
  const endsWithPrice = (t: string) => !!pickPrice(extractTailPrices(normalizeMenuLine(t)));
  const splits: (number | undefined)[] = rows.map((r) => {
    const segs = segsOf(r.text);
    for (let k = 0; k < segs.length - 1; k++) {
      if (!endsWithPrice(segs[k].text) || letterCount(segs.slice(0, k + 1).map((x) => x.text).join(' ')) < 3) continue;
      const right = segs.slice(k + 1).map((x) => x.text).join('   ');
      if (letterCount(right) >= 3 && endsWithPrice(right)) return segs[k + 1].start;
    }
    return undefined;
  });
  const found = splits.filter((x): x is number => x !== undefined);
  if (found.length < 3) return [rows];
  const mid = median(found);
  if (found.filter((x) => Math.abs(x - mid) <= 8).length < 3) return [rows];
  const left: MenuRow[] = [];
  const right: MenuRow[] = [];
  rows.forEach((r, i) => {
    const sp = splits[i];
    if (sp !== undefined && Math.abs(sp - mid) <= 8) {
      left.push({ ...r, text: r.text.slice(0, sp) });
      right.push({ ...r, text: r.text.slice(sp) });
      return;
    }
    const lead = r.text.search(/\S/);
    if (lead >= mid - 6) {
      right.push({ ...r, text: r.text.trim() });
      return;
    }
    // Hueco de columna cerca del corte (cabeceras "ENTRANTES        CARNES")
    const gap = /\s{3,}/g;
    let m: RegExpExecArray | null;
    while ((m = gap.exec(r.text))) {
      const at = m.index + m[0].length;
      if (Math.abs(at - mid) <= 8) {
        left.push({ ...r, text: r.text.slice(0, m.index) });
        right.push({ ...r, text: r.text.slice(at) });
        return;
      }
    }
    left.push(r);
  });
  return [left, right];
}

interface ParseState {
  drafts: Draft[];
  serial: number;
  order: number;
  corrections: number;
  /** Sección con la que acabó el flujo anterior (la columna derecha o la página siguiente pueden continuarla). */
  carry?: { section?: string; mainSection?: string; wine: boolean; multi: boolean };
  /** Cabeceras de sección leídas hasta ahora: cuántas en mayúsculas y cuántas no (estilo de las secciones de la carta). */
  sectionCase?: { upper: number; other: number };
}

function formatSection(sec: SectionInfo): string {
  const label = sec.label.replace(/\s+/g, ' ').trim();
  return isShouting(label) ? toSentenceCase(label) : label.charAt(0).toUpperCase() + label.slice(1);
}

interface StreamStats {
  capsDominant: boolean;
  dishSize: number;
  integerStyle: boolean;
  /** Carta con el precio delante del nombre: los enteros al principio de la línea también son precios. */
  leading: boolean;
  /** Separación vertical típica entre platos (en alturas de texto; 0 = desconocida). */
  dishGap: number;
  /** Separación típica entre el precio en su propio renglón y el nombre del plato siguiente (0 = no es ese estilo). */
  belowGap: number;
}

/** ¿Estilo «Cada Palabra En Mayúscula» (incluidas las partículas: "Pulpo A La Gallega")? */
function titleCased(s: string): boolean {
  const ws = s.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (!ws.length || isShouting(s)) return false;
  const caps = ws.filter((w) => /^\p{Lu}/u.test(w)).length;
  const particles = ws.filter((w) => w.length <= 3);
  return caps === ws.length && (ws.length === 1 ? ws[0].length >= 3 : particles.length > 0 || ws.length >= 2);
}

/** Palabras con las que no acaba nunca el nombre de un plato: si la línea acaba así, el nombre sigue en la siguiente. */
const DANGLING = new Set(['de', 'del', 'a', 'al', 'con', 'sin', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'sobre', 'para', 'por']);

function parseStream(rows: MenuRow[], state: ParseState, stats: StreamStats): void {
  const lines = rows.map((r) => analyze(r, { leading: stats.leading })).filter((l): l is Line => !!l);
  let section: string | undefined = state.carry?.section;
  let mainSection: string | undefined = state.carry?.mainSection;
  let wine = state.carry?.wine ?? false;
  let multi = state.carry?.multi ?? false;
  let seenContent = !!state.carry?.section;
  let last: Draft | undefined;
  /** Último renglón del nombre del plato en curso (para saber si el siguiente habría cabido en él). */
  let lastNameLine: Line | undefined;
  /** Qué fue la última línea con contenido: el plato, su descripción, una sección u otra cosa. */
  let lastKind = 'other' as 'dish' | 'desc' | 'section' | 'other';
  let pending: Draft[] = [];
  const orphans: { price: number; corrected: boolean; decimals?: number }[] = [];
  /** La línea anterior con contenido era un precio suelto (en cartas con el precio debajo, el plato ya ha terminado). */
  let afterPriceLine = false;
  let prevWasPrice = false;

  const nextContent = (i: number): Line | undefined => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].kind !== 'noise') return lines[j];
    return undefined;
  };
  const setSection = (sec: SectionInfo, withMulti = false) => {
    const label = formatSection(sec);
    const isDo = /^(?:d\.?\s?o|igp|v\.?t|vino de la tierra)/i.test(sec.label);
    // Estilo de las cabeceras (las denominaciones de origen, subsecciones de los vinos, no cuentan)
    const cases = (state.sectionCase ??= { upper: 0, other: 0 });
    if (!isDo && isShouting(lineText)) cases.upper++;
    else if (!isDo) cases.other++;
    if (isDo && mainSection && wine) section = `${mainSection} · ${label}`;
    else {
      section = label;
      mainSection = label;
      wine = sec.wine;
    }
    if (isDo) wine = true;
    // La cabecera de columnas de precio (media / ración, copa / botella) suele valer para el resto de la carta
    multi = multi || withMulti;
    seenContent = true;
    state.serial++;
    lastKind = 'section';
  };
  const create = (name: string, price: number | undefined, priceConf: number, line: Line): Draft => {
    const split = splitInlineDescription(name);
    const description = [split.description, line.desc].filter(Boolean).join('. ');
    const d: Draft = {
      name: split.name,
      ...(description ? { description } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(section ? { section } : {}),
      wine,
      priceConf,
      ...(price !== undefined && line.decimals !== undefined ? { decimals: line.decimals } : {}),
      ...(line.confidence !== undefined ? { ocrConf: line.confidence } : {}),
      corrected: line.corrected,
      ...(line.perUnit ? { perUnit: line.perUnit } : {}),
      market: line.market,
      serial: state.serial,
      order: state.order++,
    };
    state.drafts.push(d);
    last = d;
    lastNameLine = line;
    lastKind = 'dish';
    seenContent = true;
    return d;
  };
  const assign = (d: Draft, price: number, conf: number, corrected = false, decimals?: number) => {
    d.price = price;
    d.priceConf = conf;
    if (decimals !== undefined) d.decimals = decimals;
    else delete d.decimals;
    if (corrected) d.corrected = true;
  };
  const isDesc = (l: Line): boolean => {
    // "Con…", "Acompañado de…", minúscula inicial: descripción salvo que esté muy lejos del plato
    if (isDescriptionLike(l.name)) return !(l.gap !== undefined && l.gap > 3);
    // Carta con el precio debajo de cada plato: tras un precio empieza otro plato (el anterior ya se cerró)
    if (stats.belowGap > 0 && prevWasPrice) return false;
    // Letra más pequeña que la de los platos y no muy lejos (entre medias puede haber quedado una fila de iconos)
    if (smaller(l) && !(l.gap !== undefined && l.gap > 3)) return true;
    // Muy separada del plato (pie de la carta, aviso): no es su descripción
    if (farBelow(l)) return false;
    // Enumeraciones ("Primero, segundo, postre, pan y bebida"): descripción
    const words = l.name.split(/\s+/).length;
    const commas = (l.name.match(/,/g) ?? []).length;
    if (commas >= 2 || (commas >= 1 && words >= 5)) return true;
    // Continuación de una descripción partida en dos líneas
    if (lastKind === 'desc' && last?.description && !/[.!?]$/.test(last.description) && /^\p{Ll}/u.test(l.name)) return true;
    // Carta con el precio en su propio renglón debajo del plato: el renglón pegado al nombre recién empezado (más que
    // la separación entre un precio y el plato siguiente) es su descripción, aunque la letra no sea más pequeña
    if (stats.belowGap > 0 && lastKind === 'dish' && last && last.price === undefined && !last.description && !prevWasPrice) {
      if (l.gap !== undefined && l.gap < 0.8 * stats.belowGap && !(stats.dishSize > 0 && l.size > 1.3 * stats.dishSize)) return true;
    }
    return false;
  };
  /** Separada de la fila anterior por más de una línea en blanco (sólo si se conoce la geometría). */
  const farBelow = (l: Line) => l.gap !== undefined && l.gap > 1.6;
  /** Letra claramente más pequeña que la de los platos (descripciones en cursiva, notas). */
  const smaller = (l: Line) => stats.dishSize > 0 && l.size > 0 && l.size < 0.85 * stats.dishSize;
  const recent = () => !!last && (lastKind === 'dish' || lastKind === 'desc');
  /**
   * ¿La línea continúa el nombre del plato anterior (nombre largo partido en dos renglones)? Misma letra que los platos,
   * pegada al renglón anterior y sin descripción de por medio; además el nombre anterior queda colgando ("… a la"),
   * la línea sigue en minúscula o ambas van en mayúsculas.
   */
  const continuesName = (l: Line): boolean => {
    if (!last || lastKind !== 'dish' || prevWasPrice || last.description || l.market) return false;
    if (l.gap === undefined) return false;
    // Más pegada que la separación habitual entre platos
    const limit = stats.dishGap > 0 ? Math.min(1.4, Math.max(0.55, 0.85 * stats.dishGap)) : 0.9;
    if (l.gap > limit) return false;
    // Añada suelta en el renglón siguiente ("… Fermentado en barrica" / "2015"), con la altura de letra del nombre (sin
    // letras no hay tamaño de palabra que medir)
    if (VINTAGE.test(l.name.trim())) {
      const hPrev = lastNameLine?.row?.textH;
      const hCur = l.row?.textH;
      return last.wine && (!hPrev || !hCur || (hCur >= 0.75 * hPrev && hCur <= 1.3 * hPrev));
    }
    if (!(stats.dishSize > 0 && l.size >= 0.88 * stats.dishSize && l.size <= 1.3 * stats.dishSize)) return false;
    const words = l.name.split(/\s+/);
    if (words.length > 6 || letterCount(l.name) < 2) return false;
    const endWord = fold(last.name.split(/\s+/).pop() ?? '');
    // El nombre quedó colgando ("… a la", "… con salsa de") o con un paréntesis abierto: sigue seguro
    if (DANGLING.has(endWord) || (last.name.match(/\(/g) ?? []).length > (last.name.match(/\)/g) ?? []).length) return true;
    // Si la primera palabra cabía de sobra en el renglón anterior, el nombre no se partió ahí (es otra cosa)
    const prev = lastNameLine?.row;
    const cur = l.row;
    if (prev?.nameX1 !== undefined && cur?.firstWordW !== undefined && prev.colX1 !== undefined) {
      const h = prev.textH ?? cur.textH ?? 0;
      // Precio pegado al nombre (carta sin columna de precios): lo que queda libre es lo que hay tras el precio
      const inlinePrice = prev.priceX0 !== undefined && prev.priceX0 - prev.nameX1 < 1.8 * h;
      const room = inlinePrice ? prev.colX1 - (prev.x1 ?? prev.nameX1) : (prev.priceX0 ?? prev.colX1) - prev.nameX1;
      if (h > 0 && cur.firstWordW + 0.4 * h < room - 2.2 * h) return false;
    }
    const lastWord = fold(last.name.split(/\s+/).pop() ?? '');
    if (DANGLING.has(lastWord)) return true;
    if ((last.name.match(/\(/g) ?? []).length > (last.name.match(/\)/g) ?? []).length) return true;
    if (/^\p{Ll}/u.test(l.name)) return true;
    const sec = sectionInfo(l.name);
    if (isShouting(last.name) && isShouting(l.name) && sec?.strength !== 'vocab') return true;
    // Nombres con Cada Palabra En Mayúscula: el renglón siguiente con el mismo estilo sigue el nombre
    if (titleCased(last.name) && titleCased(l.name) && words.length <= 4 && !(sec && /vocab|deco|spaced/.test(sec.strength))) return true;
    // Renglón corto con la letra de los platos justo debajo de un nombre (sin ser una descripción ni una sección):
    // si el plato ya tenía precio, o si el precio viene en este renglón, es el final del nombre
    const short = words.length <= 4 && !/[,;:]/.test(l.name) && !isDescriptionLike(l.name) && !(sec && /vocab|deco|spaced/.test(sec.strength));
    return short && (last.price !== undefined) !== (l.kind === 'priced');
  };
  const addDescription = (d: Draft, text: string) => {
    const t = text.replace(/^[\s(–-]+|[\s)–-]+$/g, '').trim();
    if (!t) return;
    if (!d.description) d.description = t;
    else {
      // Continuación de la frase (minúscula) o frase nueva (mayúscula tras un texto sin punto final)
      const glue = /^\p{Lu}/u.test(t) && !/[.,;:!?]$/.test(d.description) ? '. ' : ' ';
      d.description = `${d.description}${glue}${t}`;
    }
    lastKind = 'desc';
  };

  /** Texto de la línea en curso (para el estilo de las cabeceras de sección). */
  let lineText = '';
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.kind === 'noise') continue;
    lineText = L.text;
    prevWasPrice = afterPriceLine;
    afterPriceLine = L.kind === 'price';

    if (L.kind === 'colheader') {
      const sec = L.headerSection ? sectionInfo(L.headerSection) : undefined;
      if (sec) setSection(sec, true);
      else multi = true;
      continue;
    }

    if (L.kind === 'price') {
      // Una cifra suelta sin decimales ni € ("1", "3") suele ser ruido del OCR, salvo en cartas con precios enteros; y
      // leída con muy poca confianza, ruido siempre (iconos, trazos)
      if (L.weakPrice && (!stats.integerStyle || (L.confidence ?? 100) < 60)) continue;
      const run: Line[] = [L];
      let j = i + 1;
      while (j < lines.length && (lines[j].kind === 'price' || lines[j].kind === 'noise')) {
        if (lines[j].kind === 'price' && (!lines[j].weakPrice || stats.integerStyle)) run.push(lines[j]);
        j++;
      }
      i = j - 1;
      const unpriced = pending.filter((d) => d.price === undefined);
      if (run.length === 1) {
        if (recent() && last && last.price === undefined) assign(last, run[0].price as number, 0.85, run[0].corrected, run[0].decimals);
        else orphans.push({ price: run[0].price as number, corrected: run[0].corrected, decimals: run[0].decimals });
        continue;
      }
      const values = run.map((r) => r.price as number);
      const ratio = Math.min(...values) / Math.max(...values);
      const after = nextContent(j - 1);
      // ¿Viene detrás un plato sin precio? Entonces el segundo precio es suyo, no una media ración.
      const dishFollows = !!after && after.kind === 'plain' && !after.market && !isDescriptionLike(after.name) && !sectionInfo(after.name)?.strength.match(/vocab|deco|spaced/);
      if (run.length <= 3 && recent() && last && last.price === undefined && unpriced.length === 1 && (multi || (ratio >= 0.2 && ratio < 1 && run.length === 2 && !dishFollows))) {
        assign(last, Math.max(...values), 0.8, run.some((r) => r.corrected));
        continue;
      }
      // Bloque de precios separado de los nombres (el OCR leyó la columna de precios aparte)
      const inSection = unpriced.filter((d) => d.section === section);
      const target = inSection.length === run.length ? inSection : unpriced.length === run.length ? unpriced : unpriced.slice(0, run.length);
      const exact = target.length === run.length && (inSection.length === run.length || unpriced.length === run.length);
      target.forEach((d, n) => assign(d, run[n].price as number, exact ? 0.8 : 0.65, run[n].corrected, run[n].decimals));
      for (const r of run.slice(target.length)) orphans.push({ price: r.price as number, corrected: r.corrected, decimals: r.decimals });
      continue;
    }

    if (L.kind === 'priced' && !seenContent && L.weakPrice && !L.multi) {
      // Cabecera de la carta con una cifra suelta al final ("Desde 1987"): no es un plato
      continue;
    }

    if (L.kind === 'priced') {
      let price = L.price as number;
      if (multi && L.tail && L.tail.tokens.length >= 2) {
        // Con cabecera de columnas (media / ración, copa / botella) se relee la línea: el precio menor no es parte del nombre
        const again = pickPrice(L.tail, true);
        if (again) {
          price = again.price;
          const again2 = nameBeforePrices(L.text, L.tail, again.used);
          if (letterCount(again2.name) >= 2) {
            L.name = again2.name;
            if (again2.desc) L.desc = again2.desc;
          }
        }
      }
      // Segundo renglón del nombre con una cifra suelta al final (icono o alérgeno) en una carta con decimales o €
      if (L.weakPrice && !stats.integerStyle && last && last.price !== undefined && continuesName({ ...L, kind: 'plain' })) {
        last.name = `${last.name} ${L.name}`;
        lastNameLine = L;
        continue;
      }
      // Segundo renglón del nombre del plato anterior, con el precio a su altura
      if (last && last.price === undefined && continuesName(L)) {
        last.name = `${last.name} ${L.name}`;
        lastNameLine = L;
        assign(last, price, 0.9, L.corrected, L.decimals);
        pending = [];
        orphans.length = 0;
        continue;
      }
      // Descripción con el precio del plato anterior (el precio quedó a la altura de la descripción)
      if (recent() && last && last.price === undefined && !farBelow(L) && (isDescriptionLike(L.name) || smaller(L))) {
        addDescription(last, L.name);
        assign(last, price, 0.85, L.corrected, L.decimals);
        pending = [];
        orphans.length = 0;
        continue;
      }
      const conf = L.merged ? 0.72 : L.corrected ? 0.8 : L.weakPrice ? 0.85 : 0.95;
      create(L.name, price, conf, L);
      if (L.corrected || L.merged) state.corrections++;
      pending = [];
      orphans.length = 0;
      continue;
    }

    // ── Línea sin precio ──
    const next = nextContent(i);
    if (L.market) {
      create(L.name, undefined, 0.7, L);
      continue;
    }
    if (last && continuesName(L)) {
      last.name = `${last.name} ${L.name}`;
      lastNameLine = L;
      continue;
    }
    // La añada suelta que no sigue a un vino no es nada más
    if (VINTAGE.test(L.name)) continue;
    const sec = sectionInfo(L.name);
    // Denominación de origen ("D.O. Rueda"): subsección de los vinos o, en letra pequeña bajo un vino, su descripción
    const origin = !!sec && /^(?:d\.?\s?o|igp|v\.?t|vino de la tierra)/i.test(sec.label);
    // Letra claramente más pequeña que la de los platos justo debajo de un plato: descripción (también en mayúsculas),
    // no una cabecera de sección
    const closed = stats.belowGap > 0 && prevWasPrice && !isDescriptionLike(L.name);
    if (recent() && last && smaller(L) && !farBelow(L) && !closed && !(sec && /vocab|spaced|deco/.test(sec.strength) && !origin)) {
      addDescription(last, L.name);
      continue;
    }
    // Subtítulo de la sección en letra pequeña justo debajo de su cabecera ("TINTOS" / "Crianza en barrica")
    if (lastKind === 'section' && smaller(L) && !farBelow(L) && !(sec && /vocab|spaced|deco/.test(sec.strength))) continue;
    if (sec) {
      const nextIsPrice = next?.kind === 'price';
      // Con el precio en su propio renglón, entre el nombre del plato y su precio puede ir la descripción
      const nextAt = next ? lines.indexOf(next) : -1;
      const priceAfterDesc =
        stats.belowGap > 0 && !!next && next.kind === 'plain' && (smaller(next) || isDescriptionLike(next.name)) && nextContent(nextAt)?.kind === 'price';
      const folded = fold(sec.label);
      // Las secciones de la carta van todas en mayúsculas y esta no, con la letra de los platos: es un plato que empieza
      // como una sección ("Huevos a la flamenca" bajo "HUEVOS"). Las denominaciones de origen ("D.O. Rueda") son
      // subsecciones de los vinos y suelen ir con otra letra.
      const cases = state.sectionCase ?? { upper: 0, other: 0 };
      const offStyle =
        !origin && cases.upper >= 1 && cases.other === 0 && !isShouting(L.name) && stats.dishSize > 0 && L.size > 0 && L.size < 1.12 * stats.dishSize;
      if (sec.strength === 'vocab' && !offStyle && !((nextIsPrice || priceAfterDesc) && (DUAL_SECTION.has(folded) || !isShouting(sec.label)))) {
        setSection(sec);
        continue;
      }
      if ((sec.strength === 'deco' || sec.strength === 'spaced') && !nextIsPrice) {
        setSection(sec);
        continue;
      }
      if (sec.strength === 'caps' && !nextIsPrice) {
        const words = sec.label.split(/\s+/).length;
        const nextLooksDish = next?.kind === 'priced' || (next?.kind === 'plain' && !isShouting(next.name));
        if (!seenContent) {
          // Primera cabecera de la columna: sección si le sigue un plato (con precio en su línea o en la siguiente)
          const after = next ? lines[lines.indexOf(next) + 1] : undefined;
          // (el título de la carta es mucho mayor que las secciones, y el lema que le sigue, más pequeño que los platos)
          const big = stats.dishSize > 0 && L.size >= 1.1 * stats.dishSize && L.size < 2.2 * stats.dishSize;
          const dishLike = !!next && stats.dishSize > 0 && next.size >= 0.9 * stats.dishSize;
          const dishFollows = after?.kind === 'priced' || after?.kind === 'price' || (!!after && stats.belowGap > 0 && after.kind === 'plain' && nextContent(lines.indexOf(after))?.kind === 'price');
          if (next?.kind === 'priced' || (big && dishLike && next?.kind === 'plain' && dishFollows)) setSection(sec);
          continue;
        }
        if (!stats.capsDominant || (words <= 4 && nextLooksDish) || (words <= 4 && lastKind !== 'dish' && lastKind !== 'desc')) {
          setSection(sec);
          continue;
        }
      }
      if (sec.strength === 'weak' && stats.dishSize > 0 && L.size >= 1.2 * stats.dishSize && (seenContent || L.size < 2.2 * stats.dishSize) && !nextIsPrice) {
        setSection(sec);
        continue;
      }
    }

    if (!seenContent) {
      // Cabecera de la carta (nombre del restaurante, lema…): sólo cuenta si el precio viene en la línea siguiente
      if (next?.kind === 'price' && !next.weakPrice && looksLikeName(L.name)) create(L.name, undefined, 0.45, L);
      continue;
    }

    if (recent() && last && isDesc(L)) {
      addDescription(last, L.name);
      continue;
    }
    if (!looksLikeName(L.name)) continue;
    const d = create(L.name, undefined, 0.45, L);
    const orphan = orphans.shift();
    if (orphan) assign(d, orphan.price, 0.72, orphan.corrected, orphan.decimals);
    else pending.push(d);
  }
  if (section) state.carry = { section, mainSection, wine, multi };
}

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'con', 'sin', 'sobre']);

/** "Solomillo de ternera a La pimienta" → "a la" (el OCR sube la caja de algunas partículas); respeta el estilo Título. */
function fixParticles(name: string): string {
  const ws = name.split(' ');
  if (ws.length < 3) return name;
  const content = ws.slice(1).filter((w) => !PARTICLES.has(w.toLowerCase()) && /^\p{L}/u.test(w));
  if (!content.length || content.filter((w) => /^\p{Ll}/u.test(w)).length / content.length < 0.6) return name;
  return ws.map((w, i) => (i > 0 && PARTICLES.has(w.toLowerCase()) && /^\p{Lu}\p{Ll}*$/u.test(w) ? w.toLowerCase() : w)).join(' ');
}

function formatName(d: Draft, ocr: boolean): string {
  let name = d.name.split(DESC_MARK).join(' ').replace(/\s+/g, ' ').trim();
  // Conector colgando al final ("Torrija de brioche y"): resto de un icono leído como letra o de un renglón perdido
  for (let guard = 0; guard < 3; guard++) {
    const m = /^(.*\S)\s+(\S+)$/.exec(name);
    if (!m || !DANGLING.has(fold(m[2])) || m[1].split(' ').length < 1 || letterCount(m[1]) < 3) break;
    name = m[1].replace(/[\s,;:–-]+$/, '');
  }
  if (ocr) name = repairOcrText(name);
  if (isShouting(name)) name = d.wine ? toTitleCase(name) : toSentenceCase(name);
  else name = fixParticles(name.charAt(0).toUpperCase() + name.slice(1));
  return name;
}

function formatDescription(s: string | undefined, ocr: boolean): string | undefined {
  if (!s) return undefined;
  let t = s.split(DESC_MARK).join(' ').replace(/\s+/g, ' ').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '').trim();
  if (ocr) t = repairOcrText(t);
  if (!t || letterCount(t) < 4) return undefined;
  // Restos ilegibles del OCR ("N cart", "T \" Xmayos"): mejor sin descripción que con basura
  if (ocr && wordQuality(t) < 0.75) return undefined;
  if (ocr && implausibleShortText(t)) return undefined;
  if (isShouting(t)) t = toSentenceCase(t);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Grupos de consonantes con que puede empezar una palabra (español y préstamos habituales en cartas). */
const ONSETS = new Set(['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'ch', 'll', 'rr', 'sh', 'tx', 'ts', 'ps', 'sr', 'sch', 'th', 'wh', 'kr', 'kl', 'ph', 'sp', 'st', 'sc', 'sk', 'sm', 'sn', 'sl', 'sw']);

/**
 * Texto corto (1–2 palabras) sin ninguna palabra conocida y con un arranque imposible en español ("Xmayos", "Tbc"):
 * restos del OCR, no una descripción.
 */
function implausibleShortText(t: string): boolean {
  const ws = t.split(/\s+/).map((w) => fold(w).replace(/[^a-zñ]/g, '')).filter((w) => w.length >= 2);
  if (!ws.length || ws.length > 2 || ws.some((w) => isKnownFoodWord(w) || PARTICLES.has(w))) return false;
  return ws.some((w) => {
    const m = /^[^aeiouy]+/.exec(w)?.[0] ?? '';
    return m.length >= 2 && !ONSETS.has(m) && !ONSETS.has(m.slice(0, 2));
  });
}

function fmtPrice(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} €`;
}

/** Percentil p (0–1) de una lista ya ordenada. */
function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/**
 * Coma decimal perdida por el OCR. Si la carta imprime sus precios con decimales ("12,50", "9,5") y un precio entero se
 * sale de escala respecto a los de su sección (o de la carta), se entiende que el OCR se comió la coma: "1550" → 15,50
 * y, en cartas con un decimal, "145" → 14,5. Sólo se corrige si el valor corregido cae dentro de la horquilla de
 * precios de la carta; si no (o si es un plato para compartir, por kilo o una botella), sólo se avisa.
 */
function restoreLostDecimals(drafts: Draft[], nameOf: (d: Draft) => string, warnings: string[]): number {
  const priced = drafts.filter((d) => d.price !== undefined);
  const withDec = priced.filter((d) => (d.decimals ?? 0) > 0);
  const two = withDec.filter((d) => d.decimals === 2).length;
  const one = withDec.filter((d) => d.decimals === 1).length;
  if (withDec.length < 2) {
    // Carta sin decimales visibles: sólo los desorbitados (≥ 30 veces la mediana) se corrigen como antes
    const med = median(priced.map((d) => d.price as number));
    const small = priced.map((d) => d.price as number).filter((p) => p < 100);
    let fixes = 0;
    for (const d of priced) {
      const v = d.price as number;
      if (!Number.isInteger(v) || v < 100 || v > 9999 || d.wine || !(med > 0 && med < 60) || v / med <= 30 || !small.length) continue;
      const fixed = round(v / 100, 2);
      if (fixed >= Math.min(...small) * 0.5 && fixed <= Math.max(...small) * 1.5 && !SHARED_DISH.test(d.name)) {
        d.price = fixed;
        d.priceConf = Math.min(d.priceConf, 0.6);
        d.corrected = true;
        fixes++;
      } else {
        d.priceConf = Math.min(d.priceConf, 0.6);
        warnings.push(`«${nameOf(d)}»: precio muy alto (${fmtPrice(v)}) comparado con el resto de la carta: revísalo`);
      }
    }
    return fixes;
  }
  const refs = withDec.map((d) => d.price as number).sort((a, b) => a - b);
  const lo = quantile(refs, 0.05);
  const hi = quantile(refs, 0.95);
  const bySection = new Map<string, number[]>();
  for (const d of priced) {
    const key = d.section ?? '';
    bySection.set(key, [...(bySection.get(key) ?? []), d.price as number]);
  }
  const globalMed = median(priced.map((d) => d.price as number));
  let fixes = 0;
  for (const d of priced) {
    const v = d.price as number;
    if ((d.decimals ?? 0) > 0 || !Number.isInteger(v) || v < 10 || (v < 100 && !one)) continue;
    const sec = bySection.get(d.section ?? '') ?? [];
    const others = sec.filter((p) => p !== v);
    const med = others.length >= 3 ? median(others) : globalMed;
    const divisor = v >= 100 && two >= one ? 100 : one > 0 || v < 100 ? 10 : 100;
    const fixed = round(v / divisor, 2);
    const outlier = v >= (divisor === 100 ? 6 : 4) * med;
    if (!outlier) continue;
    if (fixed >= lo * 0.5 && fixed <= hi * 1.6 && !SHARED_DISH.test(d.name) && !d.perUnit) {
      d.price = fixed;
      d.priceConf = Math.min(d.priceConf, 0.6);
      d.corrected = true;
      d.decimals = divisor === 100 ? 2 : 1;
      fixes++;
    } else if (v >= 100) {
      d.priceConf = Math.min(d.priceConf, 0.6);
      warnings.push(`«${nameOf(d)}»: precio muy alto (${fmtPrice(v)}) comparado con el resto de la carta: revísalo`);
    }
  }
  return fixes;
}

/**
 * Parser heurístico de cartas de restaurante (texto OCR o de PDF) — funciona sin IA.
 * Detecta secciones (ENTRANTES, PRINCIPALES, CARNES, PESCADOS, POSTRES, PARA COMPARTIR…, líneas en mayúsculas sin precio),
 * platos con su precio ("Croquetas de jamón ........ 9,50 €", "Pulpo a la gallega 18", "Tataki de atún  16,90"),
 * descripciones en la línea siguiente sin precio, precios de media ración / ración (usa el de ración completa),
 * y descarta ruido (teléfonos, horarios, "IVA incluido", alérgenos, direcciones).
 *
 * `boxes` (opcional): cajas del OCR (palabras o líneas con su bbox). Si se pasan, las filas se reconstruyen por
 * posición (corrigiendo la inclinación de la foto y separando cartas a dos columnas), de modo que el precio alineado a
 * la derecha se empareja con el plato de su misma fila aunque el OCR lo haya leído aparte.
 */
export function parseMenuText(text: string, method: 'ocr' | 'pdf-texto', boxes?: readonly MenuBox[]): ExtractedMenu {
  const rawText = text ?? '';
  let streams: MenuRow[][] = [];
  if (boxes && boxes.length) streams = boxesToStreams(boxes).filter((s) => s.length);
  if (!streams.length) {
    const rows: MenuRow[] = rawText.split(/\r?\n/).map((t) => ({ text: t, size: 0 }));
    streams = splitTextColumns(rows);
  }

  // Estadísticas globales: ¿carta toda en mayúsculas?, altura típica de los platos (para distinguir descripciones)
  // ¿Precio delante del nombre? (varias líneas con precio inequívoco al principio y no al final)
  let leadStrong = 0;
  let leadAny = 0;
  let tailStrong = 0;
  let tailAny = 0;
  for (const r of streams.flat()) {
    const t = normalizeMenuLine(r.text);
    const tail = pickPrice(extractTailPrices(t));
    const lead = tail ? undefined : leadingPrice(t);
    if (lead) {
      leadAny++;
      if (lead.strong) leadStrong++;
    }
    if (tail) {
      tailAny++;
      if (/\d[.,]\d{1,2}\s*€?$|€\s*$/.test(t)) tailStrong++;
    }
  }
  const leading = (leadStrong >= 3 && leadStrong >= tailStrong) || (leadAny >= 4 && leadAny >= 2 * tailAny);
  const perStream = streams.map((rows) => rows.map((r) => analyze(r, { leading })).filter((l): l is Line => !!l));
  const analyzed = perStream.flat();
  const priced = analyzed.filter((l) => l.kind === 'priced');
  const capsDominant = priced.length > 0 && priced.filter((l) => isShouting(l.name)).length / priced.length >= 0.6;
  // Carta de precios enteros ("Pulpo 18"): sólo cuentan los enteros de 1–2 cifras (un "1450" es una coma perdida)
  // Precios de un decimal ("12,5") → los redondos se imprimen sin decimales ("13"): también son enteros legítimos
  const oneDecimal = analyzed.filter((l) => (l.kind === 'priced' || l.kind === 'price') && l.decimals === 1).length;
  const integerStyle = (priced.length > 0 && priced.filter((l) => l.weakPrice && (l.price ?? 0) < 100).length / priced.length >= 0.3) || oneDecimal >= 2;
  const sizes = priced.map((l) => l.size).filter((h) => h > 0);
  const dishGap = median(priced.map((l) => l.gap).filter((g): g is number => g !== undefined && g > 0.3));
  // Precio en su propio renglón debajo de cada plato: el renglón que sigue a cada precio empieza el plato siguiente
  // (de ahí el tamaño de letra de los nombres, si casi ninguna fila lleva el precio dentro, y la separación entre platos)
  const afterPrice: Line[] = [];
  let priceOnly = 0;
  for (const list of perStream) {
    const ls = list.filter((l) => l.kind !== 'noise');
    ls.forEach((l, k) => {
      if (l.kind !== 'price' || (l.weakPrice && !integerStyle)) return;
      priceOnly++;
      const nx = ls[k + 1];
      if (nx && nx.kind === 'plain' && nx.gap !== undefined && !nx.market) afterPrice.push(nx);
    });
  }
  const priceBelow = priceOnly >= 3 && priceOnly >= 1.5 * priced.length && afterPrice.length >= 3;
  const belowSizes = afterPrice.map((l) => l.size).filter((h) => h > 0);
  const dishSize = sizes.length >= 2 ? median(sizes) : priceBelow && belowSizes.length >= 3 ? median(belowSizes) : 0;
  const belowGap = priceBelow ? median(afterPrice.map((l) => l.gap as number)) : 0;

  const state: ParseState = { drafts: [], serial: 0, order: 0, corrections: 0 };
  const streamOf: number[] = [];
  streams.forEach((rows, si) => {
    const before = state.drafts.length;
    parseStream(rows, state, { capsDominant, dishSize, integerStyle, leading, dishGap, belowGap });
    for (let k = before; k < state.drafts.length; k++) streamOf[k] = si;
  });

  // Pie de la carta: platos sin precio detrás del último con precio y sin sección nueva → ruido
  const drafts = state.drafts.filter((d, k) => {
    if (d.price !== undefined || d.market) return true;
    const sameStream = state.drafts.filter((_, j) => streamOf[j] === streamOf[k]);
    const pricedInStream = sameStream.filter((x) => x.price !== undefined);
    if (!pricedInStream.length) return d.serial > 0;
    const lastPriced = pricedInStream[pricedInStream.length - 1];
    return d.order < lastPriced.order || d.serial > lastPriced.serial;
  });

  // Coma decimal perdida por el OCR ("1550 €" o "145€" en una carta impresa con decimales). No se toca si el plato es
  // para compartir o se vende por kilo / botella (una mariscada de 180 € es real): entonces sólo se avisa.
  const warnings: string[] = [];
  const decimalFixes = method === 'ocr' ? restoreLostDecimals(drafts, (d) => formatName(d, true), warnings) : 0;
  // Formato final + duplicados (misma clave y mismo precio)
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry[]>();
  for (const d of drafts) {
    const name = formatName(d, method === 'ocr');
    if (!looksLikeName(name)) continue;
    const description = formatDescription(d.description, method === 'ocr');
    const nameConf = d.ocrConf !== undefined && d.ocrConf < 60 ? Math.max(0.5, d.ocrConf / 100 + 0.2) : 1;
    let confidence = Math.min(d.priceConf, nameConf);
    if (d.corrected) confidence = Math.min(confidence, 0.8);
    if (method === 'pdf-texto') confidence = Math.min(0.99, confidence + 0.03);
    confidence = round(confidence, 2);
    const key = menuKey(name);
    const dup = (byKey.get(key) ?? []).find((e) => e.price === d.price || e.price === undefined || d.price === undefined);
    if (dup) {
      dup.price ??= d.price;
      dup.section ??= d.section;
      if (description && (!dup.description || description.length > dup.description.length)) dup.description = description;
      dup.confidence = Math.max(dup.confidence ?? 0, confidence);
      continue;
    }
    const entry: Entry = { name, confidence };
    if (d.section) entry.section = d.section;
    if (description) entry.description = description;
    if (d.price !== undefined) entry.price = round(d.price, 2);
    entries.push(entry);
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
    if (d.perUnit && d.price !== undefined) {
      const unit = d.perUnit.startsWith('kg') || d.perUnit.startsWith('kilo') ? 'kg' : d.perUnit.startsWith('100') ? '100 g' : d.perUnit.startsWith('l') ? 'litro' : 'persona';
      warnings.push(`«${name}»: el precio de la carta es por ${unit} (${fmtPrice(d.price)}): ajusta el PVP por ración al revisar`);
    }
  }

  if (!entries.length) warnings.unshift('No se han encontrado platos en el texto: prueba con una foto más nítida, recta y con buena luz');
  const noPrice = entries.filter((e) => e.price === undefined).length;
  // Lectura OCR con huecos (platos sin precio): el OCR se ha saltado renglones, así que también el emparejamiento de los
  // demás precios es menos seguro. Se refleja en la confianza (y así el OCR hace otra pasada para completar la carta).
  if (method === 'ocr' && entries.length >= 5 && noPrice / entries.length >= 0.1) {
    for (const e of entries) if (e.price !== undefined) e.confidence = Math.min(e.confidence ?? 0.55, 0.55);
  }
  if (noPrice) warnings.push(noPrice === 1 ? '1 plato no tiene precio legible: complétalo al revisar' : `${noPrice} platos no tienen precio legible: complétalos al revisar`);
  const fixed = state.corrections + decimalFixes;
  if (fixed) warnings.push(fixed === 1 ? 'Se ha corregido 1 precio mal leído por el OCR: revísalo' : `Se han corregido ${fixed} precios mal leídos por el OCR: revísalos`);

  return { entries, method, ...(rawText ? { rawText } : {}), warnings };
}

/**
 * Calidad estimada de una lectura de carta (sin conocer la verdad), para elegir entre varias pasadas de OCR
 * (distintos modos de segmentación o preprocesados): suma la confianza de los platos con precio, penaliza los platos
 * sin precio y premia un poco las descripciones.
 */
export function menuQuality(menu: ExtractedMenu): number {
  let q = 0;
  for (const e of menu.entries) {
    const nameQ = Math.min(1, wordQuality(e.name) / 1.25);
    if (e.price !== undefined) q += (e.confidence ?? 0.7) * (0.4 + 0.6 * nameQ);
    else q -= 0.25;
    if (e.description) q += 0.05 * Math.min(1, wordQuality(e.description) / 1.25);
  }
  return round(q, 3);
}

/** Proporción de palabras reconocibles (culinarias o gramaticales) de un texto: mide lo «limpio» que salió del OCR. */
/**
 * Lo «limpio» que salió del OCR un texto: proporción de palabras bien formadas (letras con vocal) más un extra por
 * palabras culinarias reconocidas entre las de contenido (≥ 3 letras). ~1,5 = perfecto; < 1 = hay basura.
 */
function wordQuality(s: string): number {
  const ws = s.split(/\s+/).filter(Boolean);
  if (!ws.length) return 0;
  const clean = ws.filter(
    (w) =>
      (/^\(?(?:\p{L}{2,}|[aeouy])[,.;:)]?$/iu.test(w) && /[aeiouyáéíóúü]/i.test(w)) ||
      /^\(?\d+(?:[.,]\d+)?(?:%|º|g|gr|kg|ml|cl|l|uds?)?[,.;:)]?$/i.test(w),
  ).length;
  const content = ws.filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 3);
  const known = content.filter((w) => isKnownFoodWord(w)).length;
  return clean / ws.length + (content.length ? 0.5 * (known / content.length) : 0);
}

function tokenSet(s: string): Set<string> {
  return new Set(menuKey(s).split(' ').filter((w) => w.length >= 3));
}

/** ¿Son el mismo plato leído en dos pasadas? Misma clave, pocas erratas, o mismo precio y palabras en común. */
function sameDish(a: Entry, b: Entry): boolean {
  const ka = menuKey(a.name);
  const kb = menuKey(b.name);
  if (ka === kb) return true;
  const max = Math.min(3, Math.floor(Math.min(ka.length, kb.length) / 6));
  if (max > 0 && editDistance(ka, kb, max) <= max) return true;
  if (a.price === undefined || b.price === undefined || Math.abs(a.price - b.price) > 0.001) return false;
  const ta = tokenSet(a.name);
  const tb = tokenSet(b.name);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter > 0 && inter / Math.min(ta.size, tb.size) >= 0.4;
}

/**
 * Combina varias pasadas de OCR de la MISMA carta: parte de la de mayor calidad (`menuQuality`) y completa con las
 * demás los precios y descripciones que falten y los platos que sólo aparezcan en otra pasada (con precio y confianza alta).
 */
export function mergeMenuPasses(passes: readonly ExtractedMenu[]): ExtractedMenu {
  const valid = passes.filter((p) => p && p.entries);
  if (!valid.length) return { entries: [], method: 'ocr', warnings: ['No se han encontrado platos en el texto'] };
  const ranked = [...valid].sort((a, b) => menuQuality(b) - menuQuality(a));

  const base = ranked[0];
  const entries: Entry[] = base.entries.map((e) => ({ ...e }));
  /** Precios leídos para cada plato en todas las pasadas (para votar si no coinciden). */
  const seen = new Map<Entry, number[]>(entries.map((e) => [e, e.price !== undefined ? [e.price] : []]));
  for (const other of ranked.slice(1)) {
    let anchor = -1;
    for (const e of other.entries) {
      const at = entries.findIndex((x) => sameDish(x, e));
      if (at >= 0) {
        const cur = entries[at];
        if (e.price !== undefined) seen.get(cur)?.push(e.price);
        if (cur.price === undefined && e.price !== undefined) {
          cur.price = e.price;
          cur.confidence = Math.min(e.confidence ?? 0.7, 0.85);
        }
        // Nombre o descripción más limpios en la otra pasada (mismo plato y mismo precio)
        if (e.price === cur.price && wordQuality(e.name) > wordQuality(cur.name) + 0.2) cur.name = e.name;
        // Descripción de la otra pasada sólo si está limpia y no arrastra el nombre de otro plato (filas mezcladas)
        const foreign = !!e.description && entries.some((x) => x !== cur && menuKey(e.description ?? '').includes(menuKey(x.name)));
        if (e.description && !foreign && wordQuality(e.description) >= 0.85 && (!cur.description || wordQuality(e.description) > wordQuality(cur.description) + 0.2)) {
          cur.description = e.description;
        }
        if (!cur.section && e.section) cur.section = e.section;
        anchor = at;
        continue;
      }
      // Plato que sólo aparece en esta pasada: con precio, confianza alta y un precio que no esté ya en su sección
      const priceTaken = entries.some((x) => x.section === e.section && x.price !== undefined && e.price !== undefined && Math.abs(x.price - e.price) < 0.001);
      if (e.price !== undefined && !priceTaken && (e.confidence ?? 0) >= 0.9 && wordQuality(e.name) >= 0.9 && (!e.section || entries.some((x) => x.section === e.section))) {
        const added = { ...e, confidence: Math.min(e.confidence ?? 0.9, 0.85) };
        entries.splice(anchor + 1, 0, added);
        seen.set(added, [e.price]);
        anchor++;
      }
    }
  }
  // Precio en disputa: si las otras pasadas coinciden en otro precio (al menos dos lecturas iguales y más que las del
  // precio elegido), se toma ese. Una pasada puede leer mal una cifra o emparejar el precio de la fila de al lado.
  for (const [cur, prices] of seen) {
    if (cur.price === undefined || prices.length < 3) continue;
    const tally = new Map<number, number>();
    for (const p of prices) tally.set(round(p, 2), (tally.get(round(p, 2)) ?? 0) + 1);
    const [top, votes] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (votes >= 2 && votes > (tally.get(round(cur.price, 2)) ?? 0)) {
      cur.price = top;
      cur.confidence = Math.min(cur.confidence ?? 0.8, 0.8);
    }
  }
  const warnings = base.warnings.filter((w) => !/no tiene(n)? precio legible/.test(w));
  const noPrice = entries.filter((e) => e.price === undefined).length;
  if (noPrice) warnings.push(noPrice === 1 ? '1 plato no tiene precio legible: complétalo al revisar' : `${noPrice} platos no tienen precio legible: complétalos al revisar`);
  return { entries, method: base.method, ...(base.rawText ? { rawText: base.rawText } : {}), warnings };
}
