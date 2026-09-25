import type { PdfTextLine } from './pdf';
import type { OcrLine, OcrResult, OcrWord } from './ocr';
import { buildLines, linesToText, type LayoutLine, type PositionedText } from './layout';
import { median } from './textUtils';

/**
 * Reconstrucción de filas a partir de las PALABRAS del OCR (lógica pura, compartida con el banco de pruebas).
 *
 * No nos fiamos del texto por líneas de Tesseract: en una factura suele partir una fila de la tabla en varios
 * bloques (descripción por un lado, columnas numéricas por otro) y une las palabras con un solo espacio, con lo que
 * se pierden las columnas. Aquí se recolocan las palabras por su caja: se corrige la inclinación residual con las
 * líneas base, se agrupan por fila y se unen con separadores de columna proporcionales al hueco (igual que la capa
 * de texto de un PDF), de modo que el parser de facturas puede asignar columnas por posición.
 *
 * Para cartas (modo 'columns') además se detectan las calles entre columnas de texto (cartas a dos columnas) para no
 * mezclar platos de columnas distintas en la misma fila, sin separar el nombre del plato de su precio alineado a la
 * derecha.
 */

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Subconjunto de la salida `blocks` de tesseract.js que usamos (también sirve para datos de prueba). */
export interface TessWord {
  text: string;
  confidence: number;
  bbox: OcrBox;
}

export interface TessLine {
  text?: string;
  confidence?: number;
  bbox: OcrBox;
  baseline?: OcrBox;
  rowAttributes?: { rowHeight?: number };
  words: TessWord[];
}

export interface TessBlock {
  bbox?: OcrBox;
  paragraphs: { lines: TessLine[] }[];
}

export interface TessPage {
  text: string;
  /** 0–100 */
  confidence: number;
  blocks?: TessBlock[] | null;
}

/** 'table' = filas de ancho completo (facturas); 'columns' = detecta columnas de texto (cartas). */
export type LayoutMode = 'table' | 'columns';

interface Frag extends PositionedText {
  conf: number;
  box: OcrBox;
}

const JUNK_RE = /^[|¦!_\-–—~=+'"`´.,:;·•°*^/\\()[\]{}<>«»‘’“”]+$/;

/** ¿Es ruido (filetes de tabla, motas, bordes) en lugar de texto? */
export function isNoiseWord(w: TessWord, typicalHeight: number): boolean {
  const t = w.text.trim();
  if (!t) return true;
  const h = w.bbox.y1 - w.bbox.y0;
  const wd = w.bbox.x1 - w.bbox.x0;
  if (JUNK_RE.test(t)) {
    // Un punto o una coma sueltos con buena confianza pueden ser parte de un número partido: se conservan
    if (/^[.,]$/.test(t) && w.confidence >= 80) return false;
    // Líneas de puntos de relleno ("........") de las cartas: se sustituyen por hueco
    return true;
  }
  // Motas y restos de filetes leídos como una letra suelta (las palabras cortas con baja confianza pero legibles,
  // como "MG" o "1L" en un texto borroso, se conservan: el parser decide)
  if (t.length === 1 && w.confidence < 30 && /[lI|i!j'`,.:;]/.test(t)) return true;
  // Rayas verticales muy altas y estrechas (bordes de tabla) leídas como letras
  if (typicalHeight > 0 && h > typicalHeight * 2.6 && wd < typicalHeight * 0.6) return true;
  if (typicalHeight > 0 && h < typicalHeight * 0.25 && t.length <= 2 && w.confidence < 70) return true;
  return false;
}

/** Quita los rellenos de puntos pegados a una palabra ("Croquetas.......", "....9,50"). */
function stripLeaders(text: string): string {
  return text.replace(/(?:[.·…_]{3,}|(?:\.\s?){3,})/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Palabras de una página con su fila, línea y bloque de Tesseract, y la línea base a su altura. */
export function pageWords(page: TessPage, pageNo = 1): OcrWord[] {
  const out: OcrWord[] = [];
  let lineId = 0;
  (page.blocks ?? []).forEach((block, bi) => {
    for (const par of block.paragraphs ?? []) {
      for (const line of par.lines ?? []) {
        lineId++;
        const words = (line.words ?? []).filter((w) => w && w.bbox && typeof w.text === 'string');
        if (!words.length) continue;
        const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).filter((h) => h > 0);
        const rowHeight = line.rowAttributes?.rowHeight && line.rowAttributes.rowHeight > 0 ? line.rowAttributes.rowHeight : median(heights);
        const b = line.baseline;
        const slope = b && b.x1 - b.x0 > 20 ? (b.y1 - b.y0) / (b.x1 - b.x0) : 0;
        for (const w of words) {
          const xc = (w.bbox.x0 + w.bbox.x1) / 2;
          const baseY = b && b.x1 - b.x0 > 20 ? b.y0 + (xc - b.x0) * slope : w.bbox.y1;
          out.push({
            text: w.text,
            confidence: w.confidence,
            bbox: { ...w.bbox },
            page: pageNo,
            line: lineId,
            block: bi,
            baselineY: baseY,
            lineHeight: rowHeight || w.bbox.y1 - w.bbox.y0,
          });
        }
      }
    }
  });
  return out;
}

/**
 * Pendiente residual de las líneas base (tras enderezar puede quedar algo de giro o de perspectiva).
 * Mediana de las pendientes de las líneas largas, acotada a ±3 %.
 */
export function residualSlope(page: TessPage): number {
  const slopes: number[] = [];
  let maxX = 0;
  for (const block of page.blocks ?? []) for (const par of block.paragraphs ?? []) for (const l of par.lines ?? []) maxX = Math.max(maxX, l.bbox.x1);
  for (const block of page.blocks ?? []) {
    for (const par of block.paragraphs ?? []) {
      for (const l of par.lines ?? []) {
        const b = l.baseline;
        if (!b || (l.words?.length ?? 0) < 2) continue;
        const dx = b.x1 - b.x0;
        if (dx < Math.max(60, maxX * 0.2)) continue;
        slopes.push((b.y1 - b.y0) / dx);
      }
    }
  }
  if (slopes.length < 2) return 0;
  const s = median(slopes);
  return Math.max(-0.03, Math.min(0.03, s));
}

function toFragments(words: OcrWord[], slope: number): Frag[] {
  const heights = words.map((w) => w.lineHeight ?? w.bbox.y1 - w.bbox.y0).filter((h) => h > 0);
  const typical = median(heights);
  const out: Frag[] = [];
  for (const w of words) {
    if (isNoiseWord(w, typical)) continue;
    const str = stripLeaders(w.text);
    if (!str) continue;
    const xc = (w.bbox.x0 + w.bbox.x1) / 2;
    let x = w.bbox.x0;
    let width = w.bbox.x1 - w.bbox.x0;
    // Si se han quitado puntos de relleno por un lado, se ajusta la caja proporcionalmente
    if (str.length < w.text.trim().length) {
      const lead = /^[.·…_\s]*/.exec(w.text)?.[0].length ?? 0;
      const trail = /[.·…_\s]*$/.exec(w.text)?.[0].length ?? 0;
      const cw = width / Math.max(1, w.text.length);
      x += lead * cw;
      width = Math.max(cw, width - (lead + trail) * cw);
    }
    const y = (w.baselineY ?? w.bbox.y1) - slope * xc;
    out.push({ str, x, width, y, height: w.lineHeight || w.bbox.y1 - w.bbox.y0, conf: w.confidence, box: w.bbox });
  }
  return out;
}

function median0(values: number[]): number {
  return values.length ? median(values) : 0;
}

interface Gutter {
  start: number;
  end: number;
}

const PRICE_LIKE = /^(?:€\s?)?\d{1,4}(?:[.,]\d{1,2})?(?:\s?€)?$/;

/**
 * Busca una calle vertical (hueco sin texto en casi todas las filas) que separe dos columnas de TEXTO.
 * No cuenta como calle el hueco entre los nombres de los platos y su columna de precios.
 */
function findGutter(frags: Frag[], rows: LayoutLine[]): Gutter | undefined {
  if (rows.length < 4 || frags.length < 8) return undefined;
  const minX = Math.min(...frags.map((f) => f.x));
  const maxX = Math.max(...frags.map((f) => f.x + f.width));
  const span = maxX - minX;
  if (span <= 0) return undefined;
  const cw = median0(frags.map((f) => f.width / Math.max(1, f.str.length)));
  const bin = Math.max(2, cw / 2);
  const nb = Math.ceil(span / bin) + 1;
  const occ = new Uint16Array(nb);
  for (const r of rows) {
    const seen = new Uint8Array(nb);
    for (const it of r.items) {
      const a = Math.max(0, Math.floor((it.x - minX) / bin));
      const b = Math.min(nb - 1, Math.ceil((it.x + it.width - minX) / bin));
      for (let k = a; k <= b; k++) seen[k] = 1;
    }
    for (let k = 0; k < nb; k++) occ[k] += seen[k];
  }
  const allowed = Math.max(1, Math.floor(rows.length * 0.06));
  let best: Gutter | undefined;
  let bestScore = 0;
  let start = -1;
  for (let k = 0; k <= nb; k++) {
    const free = k < nb && occ[k] <= allowed;
    if (free && start < 0) start = k;
    if (!free && start >= 0) {
      const g = { start: minX + start * bin, end: minX + k * bin };
      const width = g.end - g.start;
      const center = (g.start + g.end) / 2;
      const rel = (center - minX) / span;
      if (width >= cw * 3 && rel > 0.2 && rel < 0.8) {
        const score = width * (1 - Math.abs(rel - 0.5));
        if (score > bestScore) {
          bestScore = score;
          best = g;
        }
      }
      start = -1;
    }
  }
  if (!best) return undefined;
  const g = best;
  const left = frags.filter((f) => f.x + f.width <= g.start + cw);
  const right = frags.filter((f) => f.x >= g.end - cw);
  const texty = (fs: Frag[]) => fs.filter((f) => /\p{L}{3,}/u.test(f.str)).length;
  const priceLike = (fs: Frag[]) => fs.filter((f) => PRICE_LIKE.test(f.str)).length;
  // A la derecha tiene que haber texto de verdad (platos), no sólo una columna de precios
  if (texty(right) < Math.max(3, right.length * 0.35) || priceLike(right) > right.length * 0.5) return undefined;
  if (texty(left) < Math.max(3, left.length * 0.35)) return undefined;
  const rowsWith = (fs: Frag[]) => {
    const set = new Set<number>();
    for (const f of fs) {
      const idx = rows.findIndex((r) => Math.abs(r.y - f.y) <= Math.max(1, Math.min(r.height, f.height) * 0.5));
      if (idx >= 0) set.add(idx);
    }
    return set.size;
  };
  if (rowsWith(left) < 3 || rowsWith(right) < 3) return undefined;
  return g;
}

function linesFrom(frags: Frag[], page: number): LayoutLine[] {
  return buildLines(frags, page, { yTolerance: 0.5 });
}

/** Ordena en lectura por columnas: bandas separadas por filas de ancho completo; en cada banda, columna izquierda y luego derecha. */
function columnLayout(frags: Frag[], page: number, depth: number): LayoutLine[] {
  const rows = linesFrom(frags, page);
  if (depth <= 0) return rows;
  const g = findGutter(frags, rows);
  if (!g) return rows;
  const out: LayoutLine[] = [];
  const crosses = (f: Frag) => f.x < g.start && f.x + f.width > g.end;
  // Filas con algún fragmento que cruza la calle = ancho completo (títulos, pies)
  const fullYs: number[] = [];
  for (const r of rows) if (r.items.some((it) => it.x < g.start && it.x + it.width > g.end)) fullYs.push(r.y);
  const bandOf = (y: number) => {
    let b = 0;
    for (const fy of fullYs) if (y > fy) b++;
    return b;
  };
  const fullFrags = new Set<Frag>();
  for (const f of frags) {
    if (crosses(f)) {
      fullFrags.add(f);
      continue;
    }
  }
  // Fragmentos en filas de ancho completo (aunque no crucen ellos mismos)
  const tol = (f: Frag) => Math.max(1, f.height * 0.5);
  for (const f of frags) if (fullYs.some((y) => Math.abs(f.y - y) <= tol(f))) fullFrags.add(f);
  const bands = new Map<number, { left: Frag[]; right: Frag[] }>();
  for (const f of frags) {
    if (fullFrags.has(f)) continue;
    const b = bandOf(f.y);
    const entry = bands.get(b) ?? { left: [], right: [] };
    if ((f.x + f.x + f.width) / 2 < (g.start + g.end) / 2) entry.left.push(f);
    else entry.right.push(f);
    bands.set(b, entry);
  }
  const fullRows = linesFrom([...fullFrags], page);
  const nBands = fullYs.length + 1;
  for (let b = 0; b < nBands; b++) {
    const entry = bands.get(b);
    if (entry) {
      out.push(...columnLayout(entry.left, page, depth - 1));
      out.push(...columnLayout(entry.right, page, depth - 1));
    }
    if (b < fullYs.length) {
      const fy = fullYs[b];
      out.push(...fullRows.filter((r) => Math.abs(r.y - fy) <= Math.max(1, r.height * 0.5)));
    }
  }
  // Filas de ancho completo que no se hayan colocado (tolerancias): al final de su banda por Y
  const placed = new Set(out);
  for (const r of fullRows) if (!placed.has(r)) out.push(r);
  return out;
}

export interface RowsOptions {
  mode?: LayoutMode;
  /** Pendiente residual a corregir (ver residualSlope). */
  slope?: number;
}

/** Filas (con posiciones X por celda) de las palabras de UNA página. */
export function wordsToRows(words: OcrWord[], page = 1, opts: RowsOptions = {}): (PdfTextLine & { confidence: number; bbox: OcrBox })[] {
  const frags = toFragments(words, opts.slope ?? 0);
  if (!frags.length) return [];
  const lines = opts.mode === 'columns' ? columnLayout(frags, page, 2) : linesFrom(frags, page);
  return lines.map((l) => {
    const members = frags.filter((f) => l.items.some((it) => f.x >= it.x - 0.01 && f.x + f.width <= it.x + it.width + 0.01) && Math.abs(f.y - l.y) <= Math.max(1, l.height));
    const conf = members.length ? members.reduce((s, f) => s + f.conf, 0) / members.length : 0;
    const bbox = members.length
      ? {
          x0: Math.min(...members.map((f) => f.box.x0)),
          y0: Math.min(...members.map((f) => f.box.y0)),
          x1: Math.max(...members.map((f) => f.box.x1)),
          y1: Math.max(...members.map((f) => f.box.y1)),
        }
      : { x0: l.items[0]?.x ?? 0, y0: l.y - l.height, x1: (l.items[l.items.length - 1]?.x ?? 0) + (l.items[l.items.length - 1]?.width ?? 0), y1: l.y };
    return { page, y: l.y, text: l.text, items: l.items, confidence: Math.round(conf * 10) / 10, bbox };
  });
}

/** Une el resultado de varias páginas en un OcrResult (texto con columnas, filas posicionales y palabras). */
export function ocrPagesToResult(pages: { page: TessPage; pageNo?: number }[], mode: LayoutMode = 'table'): OcrResult {
  const rows: PdfTextLine[] = [];
  const lines: OcrLine[] = [];
  const allWords: OcrWord[] = [];
  let confSum = 0;
  let confN = 0;
  pages.forEach(({ page, pageNo }, idx) => {
    const p = pageNo ?? idx + 1;
    const words = pageWords(page, p);
    allWords.push(...words);
    const hasBoxes = words.length > 0;
    if (hasBoxes) {
      const r = wordsToRows(words, p, { mode, slope: residualSlope(page) });
      for (const row of r) {
        rows.push({ page: row.page, y: row.y, text: row.text, items: row.items });
        lines.push({ text: row.text, confidence: row.confidence, bbox: row.bbox });
      }
      for (const w of words) {
        confSum += w.confidence;
        confN++;
      }
    } else {
      // Sin cajas (salida sólo texto): una línea por línea de texto, sin posiciones
      const textLines = (page.text ?? '').split(/\r?\n/).filter((t) => t.trim());
      textLines.forEach((t, i) => {
        rows.push({ page: p, y: i, text: t, items: [] });
        lines.push({ text: t, confidence: page.confidence, bbox: { x0: 0, y0: i, x1: 0, y1: i } });
      });
      if (textLines.length) {
        confSum += page.confidence * textLines.length;
        confN += textLines.length;
      }
    }
  });
  const positional = rows.some((r) => r.items.length);
  return {
    text: linesToText(rows),
    confidence: confN ? Math.round((confSum / confN) * 10) / 10 : 0,
    lines,
    words: allWords,
    rows: positional ? rows : undefined,
  };
}

/**
 * Orden de lectura por columnas para filas que ya vienen con posiciones (capa de texto de un PDF de carta):
 * si la página tiene dos columnas de platos, devuelve primero las filas de la izquierda y luego las de la derecha
 * (por bandas entre títulos de ancho completo). Si no hay columnas, devuelve las filas tal cual.
 */
export function columnsReadingOrder(lines: PdfTextLine[]): PdfTextLine[] {
  const pages = [...new Set(lines.map((l) => l.page))];
  const out: PdfTextLine[] = [];
  for (const page of pages) {
    const pageLines = lines.filter((l) => l.page === page);
    const cws = pageLines.flatMap((l) => l.items.filter((it) => it.str.trim()).map((it) => it.width / Math.max(1, it.str.length)));
    const cw = median0(cws) || 5;
    const h = cw * 2;
    const frags: Frag[] = pageLines.flatMap((l) =>
      l.items
        .filter((it) => it.str.trim())
        .map((it) => ({ str: it.str, x: it.x, width: it.width, y: l.y, height: h, conf: 100, box: { x0: it.x, y0: l.y - h, x1: it.x + it.width, y1: l.y } })),
    );
    if (!frags.length || pageLines.some((l) => !l.items.length)) {
      out.push(...pageLines);
      continue;
    }
    for (const l of columnLayout(frags, page, 2)) out.push({ page, y: l.y, text: l.text, items: l.items });
  }
  return out;
}
