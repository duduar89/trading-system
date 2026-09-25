import type { ExtractedMenu } from '../types';
import { round } from '../core/numbers';
import {
  boxesToStreams,
  extractTailPrices,
  isDescriptionLike,
  isKnownFoodWord,
  isNoiseLine,
  isShouting,
  menuKey,
  normalizeMenuLine,
  pickPrice,
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
  perUnit?: string;
  /** Precio de mercado ("S/M", "según mercado", "consultar"). */
  market: boolean;
  /** Texto de sección que acompaña a una cabecera de columnas de precio ("RACIONES   MEDIA   RACIÓN"). */
  headerSection?: string;
  /** Tamaño de letra aproximado (0 = desconocido). */
  size: number;
  /** Hueco vertical con la fila anterior, en alturas de texto (undefined = desconocido). */
  gap?: number;
  confidence?: number;
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
  ocrConf?: number;
  corrected: boolean;
  perUnit?: string;
  market: boolean;
  /** Número de cambio de sección en que se creó (para descartar el pie de la carta). */
  serial: number;
  order: number;
}

const PRICE_HEADER_LABEL = /(?:^|\s)(1\/2\s*raci[oó]n|media\s+raci[oó]n|1\/2|½|media|raci[oó]n|rac\.?|tapa|pincho|copa|botella|bot\.?|ca[ñn]a|jarra|pinta|entera|mitad|individual|grande|peque[ñn]a)\s*[:.]?\s*$/i;
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
    .replace(/^[li]\s+(?=\p{Lu})/u, '')
    .replace(/[\s.·•…_\-–:|,;/€]+$/, '')
    .replace(/\s+\p{Ll}$/u, '')
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

function analyze(row: MenuRow): Line | undefined {
  const text = normalizeMenuLine(row.text);
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return undefined;
  const base: Line = { text, kind: 'plain', name: text, corrected: false, merged: false, multi: false, market: false, size: row.size, gap: row.gap, confidence: row.confidence };

  // Precio de mercado
  const market = RE_MARKET_PRICE.exec(text);
  if (market && letterCount(text.slice(0, market.index)) >= 3 && !isNoiseLine(text.slice(0, market.index))) {
    return { ...base, name: cleanName(text.slice(0, market.index).replace(/[\s(–-]+$/, '')), market: true };
  }

  // Cabecera de columnas de precio ("MEDIA   RACIÓN", "Copa   Botella")
  const header = priceHeader(text);
  if (header.labels >= 2 && !/\d/.test(text)) {
    return { ...base, kind: 'colheader', name: header.rest, ...(header.rest ? { headerSection: header.rest } : {}) };
  }

  const tail = extractTailPrices(text);
  const picked = pickPrice(tail);
  if (picked) {
    const n = tail.tokens.length;
    const first = tail.tokens[n - picked.used];
    const cut = picked.used >= 2 ? first.labelStart : first.start;
    const name = cleanName(text.slice(0, cut));
    const decimal = tail.tokens.slice(n - picked.used).some((t) => t.hasDecimals || t.currency);
    if (isNoiseLine(text, { decimal, any: true })) return { ...base, kind: 'noise' };
    const priced = {
      tail,
      price: picked.price,
      corrected: picked.corrected,
      merged: picked.merged,
      multi: picked.multi,
      ...(tail.perUnit ? { perUnit: tail.perUnit } : {}),
    };
    if (letterCount(name) < 2) return { ...base, ...priced, kind: 'price', name: '' };
    return { ...base, ...priced, kind: 'priced', name };
  }
  if (isNoiseLine(text)) return { ...base, kind: 'noise' };
  const name = cleanName(text);
  if (letterCount(name) < 2) return { ...base, kind: 'noise' };
  return { ...base, name };
}

/** Separa "Pulpo a la gallega – con cachelos y pimentón" en nombre y descripción. */
function splitInlineDescription(name: string): { name: string; description?: string } {
  const m = /^(.{6,}?)\s*(?::|\s[–-]\s|,\s)\s*(\S.*)$/.exec(name);
  if (m && m[1].trim().split(/\s+/).length >= 2 && isDescriptionLike(m[2]) && !/^\d/.test(m[2])) {
    return { name: m[1].trim(), description: m[2].trim() };
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
}

function formatSection(sec: SectionInfo): string {
  const label = sec.label.replace(/\s+/g, ' ').trim();
  return isShouting(label) ? toSentenceCase(label) : label.charAt(0).toUpperCase() + label.slice(1);
}

function parseStream(rows: MenuRow[], state: ParseState, stats: { capsDominant: boolean; dishSize: number }): void {
  const lines = rows.map(analyze).filter((l): l is Line => !!l);
  let section: string | undefined;
  let mainSection: string | undefined;
  let wine = false;
  let multi = false;
  let seenContent = false;
  let last: Draft | undefined;
  /** Qué fue la última línea con contenido: el plato, su descripción, una sección u otra cosa. */
  let lastKind = 'other' as 'dish' | 'desc' | 'section' | 'other';
  let pending: Draft[] = [];
  const orphans: { price: number; corrected: boolean }[] = [];

  const nextContent = (i: number): Line | undefined => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].kind !== 'noise') return lines[j];
    return undefined;
  };
  const setSection = (sec: SectionInfo, withMulti = false) => {
    const label = formatSection(sec);
    const isDo = /^(?:d\.?\s?o|igp|v\.?t|vino de la tierra)/i.test(sec.label);
    if (isDo && mainSection && wine) section = `${mainSection} · ${label}`;
    else {
      section = label;
      mainSection = label;
      wine = sec.wine;
    }
    if (isDo) wine = true;
    multi = withMulti;
    seenContent = true;
    state.serial++;
    lastKind = 'section';
  };
  const create = (name: string, price: number | undefined, priceConf: number, line: Line): Draft => {
    const split = splitInlineDescription(name);
    const d: Draft = {
      name: split.name,
      ...(split.description ? { description: split.description } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(section ? { section } : {}),
      wine,
      priceConf,
      ...(line.confidence !== undefined ? { ocrConf: line.confidence } : {}),
      corrected: line.corrected,
      ...(line.perUnit ? { perUnit: line.perUnit } : {}),
      market: line.market,
      serial: state.serial,
      order: state.order++,
    };
    state.drafts.push(d);
    last = d;
    lastKind = 'dish';
    seenContent = true;
    return d;
  };
  const assign = (d: Draft, price: number, conf: number, corrected = false) => {
    d.price = price;
    d.priceConf = conf;
    if (corrected) d.corrected = true;
  };
  const isDesc = (l: Line): boolean => {
    // "Con…", "Acompañado de…", minúscula inicial: descripción salvo que esté muy lejos del plato
    if (isDescriptionLike(l.name)) return !(l.gap !== undefined && l.gap > 3);
    // Muy separada del plato (pie de la carta, aviso): no es su descripción
    if (farBelow(l)) return false;
    if (smaller(l)) return true;
    const words = l.name.split(/\s+/).length;
    if (words >= 7 && /,/.test(l.name)) return true;
    // Continuación de una descripción partida en dos líneas
    if (lastKind === 'desc' && last?.description && !/[.!?]$/.test(last.description) && /^\p{Ll}/u.test(l.name)) return true;
    return false;
  };
  /** Separada de la fila anterior por más de una línea en blanco (sólo si se conoce la geometría). */
  const farBelow = (l: Line) => l.gap !== undefined && l.gap > 1.6;
  /** Letra claramente más pequeña que la de los platos (descripciones en cursiva, notas). */
  const smaller = (l: Line) => stats.dishSize > 0 && l.size > 0 && l.size < 0.85 * stats.dishSize;
  const recent = () => !!last && (lastKind === 'dish' || lastKind === 'desc');
  const addDescription = (d: Draft, text: string) => {
    const t = text.replace(/^[\s(–-]+|[\s)–-]+$/g, '').trim();
    if (!t) return;
    d.description = d.description ? `${d.description} ${t}` : t;
    lastKind = 'desc';
  };

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.kind === 'noise') continue;

    if (L.kind === 'colheader') {
      const sec = L.headerSection ? sectionInfo(L.headerSection) : undefined;
      if (sec) setSection(sec, true);
      else multi = true;
      continue;
    }

    if (L.kind === 'price') {
      const run: Line[] = [L];
      let j = i + 1;
      while (j < lines.length && (lines[j].kind === 'price' || lines[j].kind === 'noise')) {
        if (lines[j].kind === 'price') run.push(lines[j]);
        j++;
      }
      i = j - 1;
      const unpriced = pending.filter((d) => d.price === undefined);
      if (run.length === 1) {
        if (recent() && last && last.price === undefined) assign(last, run[0].price as number, 0.85, run[0].corrected);
        else orphans.push({ price: run[0].price as number, corrected: run[0].corrected });
        continue;
      }
      const values = run.map((r) => r.price as number);
      const ratio = Math.min(...values) / Math.max(...values);
      if (run.length <= 3 && recent() && last && last.price === undefined && unpriced.length === 1 && (multi || (ratio >= 0.2 && ratio < 1 && run.length === 2))) {
        assign(last, Math.max(...values), 0.8, run.some((r) => r.corrected));
        continue;
      }
      // Bloque de precios separado de los nombres (el OCR leyó la columna de precios aparte)
      const inSection = unpriced.filter((d) => d.section === section);
      const target = inSection.length === run.length ? inSection : unpriced.length === run.length ? unpriced : unpriced.slice(0, run.length);
      const exact = target.length === run.length && (inSection.length === run.length || unpriced.length === run.length);
      target.forEach((d, n) => assign(d, run[n].price as number, exact ? 0.8 : 0.65, run[n].corrected));
      for (const r of run.slice(target.length)) orphans.push({ price: r.price as number, corrected: r.corrected });
      continue;
    }

    if (L.kind === 'priced') {
      let price = L.price as number;
      if (multi && L.tail && L.tail.tokens.length >= 2) {
        const again = pickPrice(L.tail, true);
        if (again) price = again.price;
      }
      // Descripción con el precio del plato anterior (el precio quedó a la altura de la descripción)
      if (recent() && last && last.price === undefined && !farBelow(L) && (isDescriptionLike(L.name) || smaller(L))) {
        addDescription(last, L.name);
        assign(last, price, 0.85, L.corrected);
        pending = [];
        orphans.length = 0;
        continue;
      }
      const conf = L.merged ? 0.72 : L.corrected ? 0.8 : 0.95;
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
    const sec = sectionInfo(L.name);
    if (sec) {
      const nextIsPrice = next?.kind === 'price';
      const folded = fold(sec.label);
      if (sec.strength === 'vocab' && !(nextIsPrice && (DUAL_SECTION.has(folded) || !isShouting(sec.label)))) {
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
          if (next?.kind === 'priced') setSection(sec);
          continue;
        }
        if (!stats.capsDominant || (words <= 4 && nextLooksDish) || (words <= 4 && lastKind !== 'dish' && lastKind !== 'desc')) {
          setSection(sec);
          continue;
        }
      }
      if (sec.strength === 'weak' && stats.dishSize > 0 && L.size >= 1.2 * stats.dishSize && !nextIsPrice) {
        setSection(sec);
        continue;
      }
    }

    if (!seenContent) {
      // Cabecera de la carta (nombre del restaurante, lema…): sólo cuenta si el precio viene en la línea siguiente
      if (next?.kind === 'price' && looksLikeName(L.name)) create(L.name, undefined, 0.45, L);
      continue;
    }

    if (recent() && last && isDesc(L)) {
      addDescription(last, L.name);
      continue;
    }
    if (!looksLikeName(L.name)) continue;
    const d = create(L.name, undefined, 0.45, L);
    const orphan = orphans.shift();
    if (orphan) assign(d, orphan.price, 0.72, orphan.corrected);
    else pending.push(d);
  }
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
  let name = d.name.replace(/\s+/g, ' ').trim();
  if (ocr) name = repairOcrText(name);
  if (isShouting(name)) name = d.wine ? toTitleCase(name) : toSentenceCase(name);
  else name = fixParticles(name.charAt(0).toUpperCase() + name.slice(1));
  return name;
}

function formatDescription(s: string | undefined, ocr: boolean): string | undefined {
  if (!s) return undefined;
  let t = s.replace(/\s+/g, ' ').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '').trim();
  if (ocr) t = repairOcrText(t);
  if (!t || letterCount(t) < 6) return undefined;
  if (isShouting(t)) t = toSentenceCase(t);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fmtPrice(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} €`;
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
  const analyzed = streams.flat().map(analyze).filter((l): l is Line => !!l);
  const priced = analyzed.filter((l) => l.kind === 'priced');
  const capsDominant = priced.length > 0 && priced.filter((l) => isShouting(l.name)).length / priced.length >= 0.6;
  const sizes = priced.map((l) => l.size).filter((h) => h > 0);
  const dishSize = sizes.length >= 2 ? median(sizes) : 0;

  const state: ParseState = { drafts: [], serial: 0, order: 0, corrections: 0 };
  const streamOf: number[] = [];
  streams.forEach((rows, si) => {
    const before = state.drafts.length;
    parseStream(rows, state, { capsDominant, dishSize });
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

  // Coma decimal perdida por el OCR ("650 €" en una carta de precios de 6 a 25 €)
  const warnings: string[] = [];
  const prices = drafts.map((d) => d.price).filter((p): p is number => p !== undefined);
  const med = median(prices);
  let decimalFixes = 0;
  for (const d of drafts) {
    if (d.price === undefined || !Number.isInteger(d.price) || d.price < 100 || d.price > 9999) continue;
    if (med > 0 && med < 60 && d.price / med > 20 && !d.wine) {
      d.price = round(d.price / 100, 2);
      d.priceConf = Math.min(d.priceConf, 0.6);
      d.corrected = true;
      decimalFixes++;
    }
  }

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
    if (e.price !== undefined) q += e.confidence ?? 0.7;
    else q -= 0.25;
    if (e.description) q += 0.05;
  }
  return round(q, 3);
}

/** Proporción de palabras reconocibles (culinarias o gramaticales) de un texto: mide lo «limpio» que salió del OCR. */
function wordQuality(s: string): number {
  const ws = s.split(/\s+/).filter(Boolean);
  if (!ws.length) return 0;
  const clean = ws.filter((w) => /^\(?(?:\p{L}{2,}|[aeouy])[,.;:)]?$/iu.test(w) && /[aeiouyáéíóúü]/i.test(w)).length;
  const known = ws.filter((w) => isKnownFoodWord(w)).length;
  return clean / ws.length + 0.25 * (known / ws.length);
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
  for (const other of ranked.slice(1)) {
    let anchor = -1;
    for (const e of other.entries) {
      const at = entries.findIndex((x) => sameDish(x, e));
      if (at >= 0) {
        const cur = entries[at];
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
        entries.splice(anchor + 1, 0, { ...e, confidence: Math.min(e.confidence ?? 0.9, 0.85) });
        anchor++;
      }
    }
  }
  const warnings = base.warnings.filter((w) => !/no tiene(n)? precio legible/.test(w));
  const noPrice = entries.filter((e) => e.price === undefined).length;
  if (noPrice) warnings.push(noPrice === 1 ? '1 plato no tiene precio legible: complétalo al revisar' : `${noPrice} platos no tienen precio legible: complétalos al revisar`);
  return { entries, method: base.method, ...(base.rawText ? { rawText: base.rawText } : {}), warnings };
}
