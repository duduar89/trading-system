import { fold } from './textUtils';

/**
 * Modelo de TABLA de una factura (lógica pura, sin DOM): columnas con sus límites X y su tipo.
 *
 * 1) Columnas de datos: se deducen de las propias filas de líneas (no de la cabecera). Cada fila aporta sus celdas
 *    (fragmentos separados por huecos de columna: ítems de pdf.js, celdas del OCR o bloques separados por dos o más
 *    espacios en texto monoespaciado) y la unión de todas marca por dónde pasan las «calles» (huecos verticales sin
 *    texto en ninguna fila). Así da igual que los números vayan alineados a la derecha, los textos a la izquierda y las
 *    etiquetas centradas.
 * 2) Etiquetas: la fila (o filas) de cabecera se segmenta en frases («P. Unit.», «Cantidad servida», «Nº bultos»,
 *    «Dto. 1», «% IVA»…) con un vocabulario de sinónimos en español; las etiquetas partidas en dos filas se apilan y las
 *    que agrupan varias columnas («Cantidad» sobre «Uds | Kg») pasan su significado a las de debajo.
 * 3) Alineación: las frases y las columnas se emparejan de izquierda a derecha con programación dinámica (monótona),
 *    lo que tolera columnas sin datos (un «Dto.» vacío) y columnas sin etiqueta (la unidad pegada a la cantidad).
 * 4) Comprobación con los datos: una columna rotulada como numérica que sólo contiene texto (o al revés) se corrige;
 *    las columnas sin etiqueta se tipan por su contenido (palabras de unidad, texto contiguo a la descripción…).
 *
 * El parser de facturas asigna después cada palabra a su columna: la descripción sale SÓLO de la columna de
 * descripción y la cantidad, el precio, los descuentos y el importe de sus columnas, validados con la aritmética.
 */

export type ColumnKind =
  | 'line'
  | 'code'
  | 'ean'
  | 'desc'
  | 'lot'
  | 'cad'
  | 'origin'
  | 'qty'
  | 'uds'
  | 'bultos'
  | 'mult'
  | 'unit'
  | 'price'
  | 'disc'
  | 'total'
  | 'vat'
  | 'other';

/** Columnas cuyo contenido son números que intervienen en la aritmética de la línea. */
export const NUMERIC_KINDS: ReadonlySet<ColumnKind> = new Set<ColumnKind>(['qty', 'uds', 'bultos', 'mult', 'price', 'disc', 'total', 'vat']);
/** Columnas de cantidad, por orden de preferencia (la «Cantidad»/«Kilos» manda sobre las piezas y los bultos). */
export const QTY_KINDS: readonly ColumnKind[] = ['qty', 'uds', 'bultos'];
/** Columnas de texto que NO forman parte de la descripción. */
export const NON_DESC_TEXT: ReadonlySet<ColumnKind> = new Set<ColumnKind>(['line', 'code', 'ean', 'lot', 'cad', 'origin', 'other', 'unit']);

export interface LabelInfo {
  kind?: ColumnKind;
  /** Unidad que implica la etiqueta de una columna de cantidad ("Kilos" → kg, "Botellas" → bot, "Cajas" → caja). */
  unit?: string;
  /** Unidad a la que se refiere el precio ("€/kg" → kg). */
  perUnit?: string;
  /** Descuento expresado en euros ("Dto. €", "Imp. dto.") en lugar de porcentaje. */
  amount?: boolean;
}

export interface Box {
  x0: number;
  x1: number;
}

export interface TWord extends Box {
  text: string;
  /** Es un número (cantidad, precio, importe…), no texto. */
  num?: boolean;
  /** Decimales escritos del número (0 en "12", 3 en "4,235"). */
  dec?: number;
  /** Índice de celda dentro de la fila: palabras con el mismo índice están en la misma celda. */
  seg: number;
}

export interface TRow {
  words: TWord[];
  /** Ancho medio de carácter de la fila. */
  cw: number;
}

export interface HeaderPhrase extends Box {
  text: string;
  info: LabelInfo;
}

export interface TableColumn extends Box {
  /** Límites ampliados hasta la mitad de las calles vecinas (para asignar palabras). */
  left: number;
  right: number;
  kind?: ColumnKind;
  label?: string;
  unit?: string;
  perUnit?: string;
  /** Descuento en euros (ver LabelInfo). */
  amount?: boolean;
  /** Filas con contenido en la columna, cuántas con números y cuántas con texto. */
  rows: number;
  numeric: number;
  texty: number;
}

export interface TableModel {
  columns: TableColumn[];
  cw: number;
  /** Tiene cabecera con etiquetas (si no, los tipos se han deducido de los datos). */
  labeled: boolean;
}

// ───────────────────────────── Etiquetas ─────────────────────────────

/** Texto de etiqueta normalizado: minúsculas, sin tildes, signos como separadores, rodeado de espacios. */
function labelKey(text: string): string {
  const f = fold(text)
    .replace(/[º°ª]/g, 'o')
    .replace(/%/g, ' % ')
    .replace(/[.()[\]{}:;,"'`´_\-–—·|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${f} `;
}

const RE_PRICE_WORD = / precio| prec | pr unit| p unit| p u | pu | unitario| unit | tarifa| pvp | p v p |€\s?\/|eur ?\/|\/ ?(?:ud|kg|u) /;
const RE_TOTAL_WORD = / importe| total| neto | base | subtotal| valor | imp | amount/;

/** Tipo de columna de una etiqueta de cabecera ("P. Unit." → precio, "Neto kg" → cantidad en kg…). */
export function classifyLabel(text: string): LabelInfo {
  const t = labelKey(text);
  if (t.trim() === '') return {};
  if (/^ (?:lin|linea|l|pos|no|n|#|item|orden) $/.test(t)) return { kind: 'line' };
  if (/ ean| barras /.test(t)) return { kind: 'ean' };
  if (/ u ?x ?c | uds? ?\/ ?(?:caja|cj|bulto)| u \/ c | uds? por (?:caja|bulto)| unid(?:ades)? por caja| uc /.test(t)) return { kind: 'mult' };
  if (/ (?:no )?lote? | partida /.test(t)) return { kind: 'lot' };
  if (/ cad | caducidad| caduc| cons pref| consumo pref| consumir /.test(t)) return { kind: 'cad' };
  if (/ origen | pais | proc | procedencia /.test(t)) return { kind: 'origin' };
  if (/ i ?v ?a | iva| tiva |^ tipo $| impuesto| vat /.test(t)) return { kind: 'vat' };
  if (/ d(?:c)?tos? ?\d? | dto\d | dcto | desc \d? ?$|^ desc | % desc| descuento| bonif| rappel/.test(t) && !/ descrip/.test(t)) {
    return /€|eur| imp | importe/.test(t) && !/%/.test(t) ? { kind: 'disc', amount: true } : { kind: 'disc' };
  }
  const priceWord = RE_PRICE_WORD.test(t) || (/€/.test(t) && /\//.test(t));
  const totalWord = RE_TOTAL_WORD.test(t);
  const perUnit = /(?:\/ ?| por | )(?:kg|kilo|kgs)\b/.test(t) ? 'kg' : /\/ ?(?:ud|u|und|unid)\b/.test(t) ? 'ud' : /\/ ?(?:l|lt|litro)\b/.test(t) ? 'l' : undefined;
  // "Precio neto", "Importe unitario" → precio; "Precio total" → importe
  if (priceWord && (!totalWord || !/ total /.test(t))) return perUnit ? { kind: 'price', perUnit } : { kind: 'price' };
  if (/ kilos? | kgs? | peso | litros? | lts? /.test(t) && !priceWord) return { kind: 'qty', unit: / litros? | lts? /.test(t) ? 'l' : 'kg' };
  if (totalWord) return { kind: 'total' };
  if (/^ €|eur $/.test(t)) return { kind: 'total' };
  if (/ bultos?| bult | cajas? | cj | cjs | envases? /.test(t)) return / cajas? | cj | cjs /.test(t) ? { kind: 'bultos', unit: 'caja' } : { kind: 'bultos' };
  if (/ uds | unid | unids | unidades | piezas | pzs? | pza /.test(t)) return { kind: 'uds', unit: 'ud' };
  if (/ cantidad| cant | cantid| cdad | ctd | servid| qty | botellas | bot /.test(t)) return / botellas | bot /.test(t) ? { kind: 'qty', unit: 'bot' } : { kind: 'qty' };
  if (/^ (?:ud|u|um|u m|unidad|medida|formato|und|med|fmt|u med) $/.test(t)) return { kind: 'unit' };
  if (/ codigo| cod | ref | referencia| art | sku | plu | codi /.test(t)) return { kind: 'code' };
  if (/ descripcion| descrip| articulo| concepto| producto| denominacion| detalle| designacion| mercancia| description| material /.test(t)) return { kind: 'desc' };
  return {};
}

/** Palabras que abren una etiqueta de varias palabras y se unen a la siguiente ("Nº bultos", "P. Unit.", "% IVA"). */
const PREFIX = new Set(['n', 'no', 'num', '%', 'p', 'pr', 'prec', 't', 'f', 'fecha', 'cons', 'nº']);

/** ¿La palabra completa la etiqueta anterior en lugar de empezar otra? */
function isModifier(k: string, prev: string): boolean {
  if (/^(?:unit|unitario|unitaria|servida|servido|bruto|imponible|€|eur|euros|1|2|3|caduc|pref|del|de|la|el|los)$/.test(k)) return true;
  // "Dto. %", "IVA %"; pero "Importe % IVA" son dos columnas
  if (k === '%') return /^(?:dto|dtos|dcto|desc|descuento|iva|bonif|tipo)$/.test(prev);
  // "Precio €/kg", "Precio /ud"
  if (/^(?:€|eur)?\/(?:kg|kgs|ud|u|und|l|lt)$/.test(k)) return /^(?:precio|p|pr|prec|importe|tarifa|pvp)$/.test(prev);
  if (/^(?:ud|u|kg|kgs|kilo|l|lt)$/.test(k) && /^(?:precio|p|pr|prec|neto|peso|€|eur|cantidad|cant|importe)$/.test(prev)) return true;
  if (k === 'neto' && /^(?:importe|precio|peso|total|p|imp|valor)$/.test(prev)) return true;
  if (/^(?:linea|lin)$/.test(k) && /^(?:total|importe)$/.test(prev)) return true;
  if (/^(?:art|articulo|barras)$/.test(k) && /^(?:cod|codigo|de)$/.test(prev)) return true;
  if (k === 'lote' && /^(?:n|no|nº)$/.test(prev)) return true;
  if (k === 'cad' && /^(?:f|fecha)$/.test(prev)) return true;
  if (k === 'iva' && /^(?:%|t|tipo|cuota)$/.test(prev)) return true;
  if (/^(?:articulo|producto)$/.test(k) && /^(?:descripcion|del|de)$/.test(prev)) return true;
  return false;
}

function wordKey(text: string): string {
  return labelKey(text).trim().replace(/\s+/g, '');
}

/**
 * Segmenta UNA fila de cabecera en frases (una por columna). Dos palabras de celdas distintas nunca se unen; dentro de
 * una misma celda (cabeceras monoespaciadas con un solo espacio entre columnas) decide el vocabulario.
 */
export function headerPhrases(words: readonly TWord[]): HeaderPhrase[] {
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  const out: (HeaderPhrase & { keys: string[]; seg: number })[] = [];
  for (const w of sorted) {
    const k = wordKey(w.text);
    if (!k) continue;
    const prev = out[out.length - 1];
    let attach = false;
    if (prev && prev.seg === w.seg) {
      const pl = prev.keys[prev.keys.length - 1];
      const own = classifyLabel(w.text).kind;
      if (prev.keys.length === 1 && PREFIX.has(pl)) attach = true;
      else if (isModifier(k, pl)) attach = true;
      else if (!own && !PREFIX.has(k)) attach = true;
      else if (own && own === prev.info.kind && (own === 'desc' || own === 'code')) attach = true;
    }
    if (attach && prev) {
      prev.text = `${prev.text} ${w.text}`;
      prev.x1 = Math.max(prev.x1, w.x1);
      prev.keys.push(k);
      prev.info = classifyLabel(prev.text);
    } else {
      out.push({ text: w.text, x0: w.x0, x1: w.x1, info: classifyLabel(w.text), keys: [k], seg: w.seg });
    }
  }
  return out.map(({ text, x0, x1, info }) => ({ text, x0, x1, info }));
}

function overlap(a: Box, b: Box): number {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
}

function overlaps(a: Box, b: Box): boolean {
  const ov = overlap(a, b);
  if (ov <= 0) return false;
  const minW = Math.max(1e-6, Math.min(a.x1 - a.x0, b.x1 - b.x0));
  const ca = (a.x0 + a.x1) / 2;
  const cb = (b.x0 + b.x1) / 2;
  return ov >= minW * 0.3 || (ca >= b.x0 && ca <= b.x1) || (cb >= a.x0 && cb <= a.x1);
}

/**
 * Apila las frases de una cabecera de varias filas (de arriba a abajo): una etiqueta partida en dos filas se une
 * ("Precio" + "unitario"); una etiqueta que abarca varias columnas ("Cantidad" sobre "Uds | Kg") da su significado a
 * las de debajo que no lo tienen y desaparece.
 */
export function stackHeaderRows(rows: readonly HeaderPhrase[][]): HeaderPhrase[] {
  let acc: HeaderPhrase[] = rows[0] ? [...rows[0]] : [];
  for (let r = 1; r < rows.length; r++) {
    const lower = rows[r];
    const next: HeaderPhrase[] = [];
    const usedUpper = new Set<HeaderPhrase>();
    for (const b of lower) {
      const ups = acc.filter((a) => overlaps(a, b));
      if (ups.length === 1) {
        const a = ups[0];
        const lowersOfA = lower.filter((x) => overlaps(a, x));
        if (lowersOfA.length === 1) {
          usedUpper.add(a);
          const text = `${a.text} ${b.text}`;
          next.push({ text, x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), info: classifyLabel(text) });
          continue;
        }
        // Etiqueta de grupo: se hereda el significado
        usedUpper.add(a);
        const own = b.info.kind ? b.info : classifyLabel(`${a.text} ${b.text}`);
        next.push({ ...b, info: own.kind ? own : a.info });
        continue;
      }
      if (ups.length > 1) {
        // La de abajo agrupa varias de arriba: se quedan las de arriba
        for (const a of ups) usedUpper.add(a);
        next.push(...ups.map((a) => ({ ...a, info: a.info.kind ? a.info : b.info })));
        continue;
      }
      next.push(b);
    }
    for (const a of acc) if (!usedUpper.has(a)) next.push(a);
    acc = next.sort((a, b) => a.x0 - b.x0);
  }
  // Frases duplicadas (una etiqueta de arriba añadida a varias de abajo)
  const out: HeaderPhrase[] = [];
  for (const p of acc) if (!out.some((o) => o.x0 === p.x0 && o.x1 === p.x1 && o.text === p.text)) out.push(p);
  return out;
}

// ───────────────────────────── Columnas de datos ─────────────────────────────

/** Ruido de filetes y bordes de tabla del OCR ("|", "l", "[") que no debe tapar las calles. */
function isJunk(w: TWord): boolean {
  return /^[|¦!\[\]{}()_\-–—~=+'"`´.,:;·•°*^/\\]+$/.test(w.text) || (w.text.length === 1 && /[lI|]/.test(w.text));
}

interface Segment extends Box {
  words: TWord[];
}

function segmentsOf(row: TRow): Segment[] {
  const out: Segment[] = [];
  const words = row.words.filter((w) => !isJunk(w)).sort((a, b) => a.x0 - b.x0);
  let cur: Segment | undefined;
  for (const w of words) {
    if (cur && cur.words[cur.words.length - 1].seg === w.seg) {
      cur.x1 = Math.max(cur.x1, w.x1);
      cur.words.push(w);
    } else {
      if (cur) out.push(cur);
      cur = { x0: w.x0, x1: w.x1, words: [w] };
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Unión de intervalos (ordenada). */
function unionBoxes(boxes: Box[]): Box[] {
  const s = [...boxes].sort((a, b) => a.x0 - b.x0);
  const out: Box[] = [];
  for (const b of s) {
    const last = out[out.length - 1];
    if (last && b.x0 <= last.x1) last.x1 = Math.max(last.x1, b.x1);
    else out.push({ x0: b.x0, x1: b.x1 });
  }
  return out;
}

/** Columnas de datos: tramos de X cubiertos por alguna celda de alguna fila; las calles son los huecos entre ellos. */
export function findDataColumns(rows: readonly TRow[]): Box[] {
  const boxes: Box[] = [];
  for (const r of rows) for (const s of segmentsOf(r)) boxes.push({ x0: s.x0, x1: s.x1 });
  return unionBoxes(boxes);
}

/** Parte una columna en `k` trozos por los huecos entre PALABRAS (para columnas unidas por celdas pegadas). */
function splitByWords(col: Box, rows: readonly TRow[], cuts: Box[]): Box[] {
  // Intervalos de palabras dentro de la columna
  const words: Box[] = [];
  for (const r of rows) for (const w of r.words) if (!isJunk(w) && w.x0 >= col.x0 - 0.01 && w.x1 <= col.x1 + 0.01) words.push({ x0: w.x0, x1: w.x1 });
  const covered = unionBoxes(words);
  const out: Box[] = [];
  let start = col.x0;
  for (const cut of cuts) {
    // Hueco entre palabras dentro del tramo [cut.x0, cut.x1]; si no hay, el punto medio
    let at = (cut.x0 + cut.x1) / 2;
    let bestW = -1;
    for (let i = 0; i + 1 < covered.length; i++) {
      const g0 = covered[i].x1;
      const g1 = covered[i + 1].x0;
      const lo = Math.max(g0, cut.x0);
      const hi = Math.min(g1, cut.x1);
      if (hi >= lo && g1 - g0 > bestW) {
        bestW = g1 - g0;
        at = (g0 + g1) / 2;
      }
    }
    if (at > start && at < col.x1) {
      out.push({ x0: start, x1: at });
      start = at;
    }
  }
  out.push({ x0: start, x1: col.x1 });
  // Ajuste de cada trozo a las palabras que contiene
  return out.map((b) => {
    const inside = covered.filter((c) => c.x0 >= b.x0 - 0.01 && c.x1 <= b.x1 + 0.01);
    return inside.length ? { x0: Math.min(...inside.map((c) => c.x0)), x1: Math.max(...inside.map((c) => c.x1)) } : b;
  });
}

/** Emparejamiento monótono frases ↔ columnas (programación dinámica). Devuelve para cada columna el índice de frase o -1. */
function alignPhrases(phrases: readonly HeaderPhrase[], cols: readonly Box[], cw: number): number[] {
  const K = phrases.length;
  const M = cols.length;
  const SKIP_PHRASE = -1;
  const SKIP_COL = -2;
  const match = (i: number, j: number): number => {
    const p = phrases[i];
    const c = cols[j];
    const ov = overlap(p, c);
    if (ov > 0) return 10 + Math.min(1, ov / Math.max(cw, c.x1 - c.x0));
    const dist = -ov;
    return 10 - dist / Math.max(cw, 1e-6);
  };
  const dp: number[][] = Array.from({ length: K + 1 }, () => new Array<number>(M + 1).fill(-Infinity));
  const from: number[][] = Array.from({ length: K + 1 }, () => new Array<number>(M + 1).fill(0));
  dp[0][0] = 0;
  for (let i = 0; i <= K; i++) {
    for (let j = 0; j <= M; j++) {
      const cur = dp[i][j];
      if (cur === -Infinity) continue;
      if (i < K && cur + SKIP_PHRASE > dp[i + 1][j]) {
        dp[i + 1][j] = cur + SKIP_PHRASE;
        from[i + 1][j] = 1;
      }
      if (j < M && cur + SKIP_COL > dp[i][j + 1]) {
        dp[i][j + 1] = cur + SKIP_COL;
        from[i][j + 1] = 2;
      }
      if (i < K && j < M) {
        const s = match(i, j);
        if (s > 0 && cur + s > dp[i + 1][j + 1]) {
          dp[i + 1][j + 1] = cur + s;
          from[i + 1][j + 1] = 3;
        }
      }
    }
  }
  const assign = new Array<number>(M).fill(-1);
  let i = K;
  let j = M;
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (f === 3) {
      assign[j - 1] = i - 1;
      i--;
      j--;
    } else if (f === 2) j--;
    else i--;
  }
  return assign;
}

export interface BuildModelOptions {
  /** ¿Es un texto de unidad de medida ("KG", "UD", "CAJA")? */
  isUnitWord: (text: string) => boolean;
}

/**
 * Construye el modelo de tabla a partir de las frases de la cabecera (si las hay) y de las filas de líneas.
 * Devuelve undefined si no hay datos suficientes para deducir columnas fiables.
 */
export function buildTableModel(phrases: readonly HeaderPhrase[] | undefined, rows: readonly TRow[], opts: BuildModelOptions): TableModel | undefined {
  if (!rows.length) return undefined;
  const cw = median(rows.map((r) => r.cw).filter((x) => x > 0)) || 1;
  let cols = findDataColumns(rows);
  if (!cols.length) return undefined;
  const labeled = !!phrases && phrases.some((p) => p.info.kind);
  // Columnas unidas (celdas pegadas en alguna fila): si una columna contiene dos o más etiquetas se parte entre ellas
  if (phrases && phrases.length) {
    const next: Box[] = [];
    for (const c of cols) {
      const inside = phrases.filter((p) => {
        const center = (p.x0 + p.x1) / 2;
        return p.info.kind && overlap(p, c) > 0 && center >= c.x0 - cw * 1.5 && center <= c.x1 + cw * 1.5;
      });
      if (inside.length >= 2) {
        const sorted = [...inside].sort((a, b) => a.x0 - b.x0);
        const cuts: Box[] = [];
        for (let k = 0; k + 1 < sorted.length; k++) cuts.push({ x0: Math.min(sorted[k].x1, sorted[k + 1].x0), x1: Math.max(sorted[k].x1, sorted[k + 1].x0) });
        next.push(...splitByWords(c, rows, cuts));
      } else next.push(c);
    }
    cols = next;
  }
  const columns = makeColumns(cols);
  const unitRows = fillStats(columns, rows, opts);
  // Etiquetas
  if (phrases && phrases.length) {
    const assign = alignPhrases(phrases, columns, cw);
    assign.forEach((pi, j) => {
      if (pi < 0) return;
      const p = phrases[pi];
      const c = columns[j];
      c.label = p.text;
      c.kind = p.info.kind;
      c.unit = p.info.unit;
      c.perUnit = p.info.perUnit;
      c.amount = p.info.amount;
    });
  }
  typeByData(columns, unitRows);
  return { columns, cw, labeled };
}

function makeColumns(cols: readonly Box[]): TableColumn[] {
  return cols.map((c, j) => {
    const prev = cols[j - 1];
    const nxt = cols[j + 1];
    return { x0: c.x0, x1: c.x1, left: prev ? (prev.x1 + c.x0) / 2 : -Infinity, right: nxt ? (c.x1 + nxt.x0) / 2 : Infinity, rows: 0, numeric: 0, texty: 0 };
  });
}

/** Filas con contenido, con números y con texto de cada columna; devuelve las filas con palabras de unidad. */
function fillStats(columns: TableColumn[], rows: readonly TRow[], opts: BuildModelOptions): number[] {
  const unitRows = new Array<number>(columns.length).fill(0);
  for (const r of rows) {
    const seen = new Set<number>();
    const num = new Set<number>();
    const txt = new Set<number>();
    const unitW = new Set<number>();
    for (const w of r.words) {
      if (isJunk(w)) continue;
      const j = columnIndex(columns, w);
      if (j < 0) continue;
      seen.add(j);
      if (w.num) num.add(j);
      else if (opts.isUnitWord(w.text)) unitW.add(j);
      else if (/\p{L}{2,}/u.test(w.text)) txt.add(j);
    }
    for (const j of seen) columns[j].rows++;
    for (const j of num) columns[j].numeric++;
    for (const j of txt) columns[j].texty++;
    for (const j of unitW) unitRows[j]++;
  }
  return unitRows;
}

/** Comprobación de las etiquetas con los datos y tipado de las columnas sin etiqueta. */
function typeByData(columns: TableColumn[], unitRows: number[]): void {
  const hasDesc = () => columns.some((c) => c.kind === 'desc');
  for (const c of columns) {
    const j = columns.indexOf(c);
    const mostlyText = c.texty >= Math.max(1, c.rows * 0.6) && c.numeric <= c.rows * 0.25;
    const mostlyNum = c.numeric >= Math.max(1, c.rows * 0.6) && c.texty <= c.rows * 0.2;
    if (c.kind && NUMERIC_KINDS.has(c.kind) && mostlyText) c.kind = hasDesc() ? 'other' : 'desc';
    else if (c.kind === 'unit' && mostlyNum) c.kind = 'uds';
    else if (c.kind === 'uds' && unitRows[j] >= Math.max(1, c.rows * 0.6) && c.numeric <= c.rows * 0.2) c.kind = 'unit';
    else if (c.kind === 'desc' && mostlyNum && columns.some((o) => o !== c && o.texty > c.texty)) c.kind = 'code';
  }
  for (let j = 0; j < columns.length; j++) {
    const c = columns[j];
    if (c.kind) continue;
    if (unitRows[j] >= Math.max(1, c.rows * 0.6) && c.numeric <= c.rows * 0.2) c.kind = 'unit';
    else if (c.texty >= Math.max(1, c.rows * 0.5) && c.numeric <= c.rows * 0.3) {
      const leftDesc = columns[j - 1]?.kind === 'desc';
      c.kind = leftDesc || !hasDesc() ? 'desc' : 'other';
    }
  }
  if (!hasDesc()) {
    // Sin etiqueta de descripción: la columna con más texto
    const best = [...columns].sort((a, b) => b.texty - a.texty)[0];
    if (best && best.texty > 0 && (!best.kind || !NUMERIC_KINDS.has(best.kind))) best.kind = 'desc';
  }
}

/** Voto de un dato a una columna: la aritmética ha usado esa palabra como cantidad, precio, importe… */
export interface RoleVote extends Box {
  kind: ColumnKind;
}

/**
 * Modelo de una tabla SIN cabecera: las columnas salen de las calles de los datos y su tipo de los votos de las filas
 * que la aritmética ha validado (cada número usado como cantidad, precio, descuento o importe vota por su columna; las
 * palabras de la descripción, por la de descripción). Gana el tipo con mayoría clara; así la orientación cantidad ↔
 * precio de toda la columna la deciden las filas sin ambigüedad (enteros, 3 decimales de peso…) y se aplica a las
 * dudosas.
 */
export function buildVotedModel(rows: readonly TRow[], votes: readonly RoleVote[], opts: BuildModelOptions): TableModel | undefined {
  if (rows.length < 3) return undefined;
  const cw = median(rows.map((r) => r.cw).filter((x) => x > 0)) || 1;
  const cols = findDataColumns(rows);
  if (cols.length < 3) return undefined;
  const columns = makeColumns(cols);
  const unitRows = fillStats(columns, rows, opts);
  const tally = columns.map(() => new Map<ColumnKind, number>());
  for (const v of votes) {
    const j = columnIndex(columns, v);
    if (j >= 0) tally[j].set(v.kind, (tally[j].get(v.kind) ?? 0) + 1);
  }
  tally.forEach((t, j) => {
    const total = [...t.values()].reduce((a, b) => a + b, 0);
    const best = [...t.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2 && best[1] >= total * 0.6) columns[j].kind = best[0];
  });
  // Dos columnas con el mismo tipo numérico: se queda la de más votos
  for (const kind of ['qty', 'price', 'total'] as ColumnKind[]) {
    const same = columns.map((c, j) => ({ c, j })).filter((x) => x.c.kind === kind);
    if (same.length < 2) continue;
    same.sort((a, b) => (tally[b.j].get(kind) ?? 0) - (tally[a.j].get(kind) ?? 0));
    for (const x of same.slice(1)) x.c.kind = undefined;
  }
  for (let j = 0; j < columns.length; j++) {
    const c = columns[j];
    if (c.kind) continue;
    if (unitRows[j] >= Math.max(1, c.rows * 0.6) && c.numeric <= c.rows * 0.2) c.kind = 'unit';
    else if (c.texty > 0 && c.numeric <= c.rows * 0.5) c.kind = 'other';
  }
  // Cantidad ↔ precio: q × p = importe es simétrico y las filas votan con el orden habitual (cantidad antes que
  // precio). Los decimales lo desempatan: los precios se escriben con decimales fijos y nunca enteros sueltos; las
  // cantidades mezclan enteros (unidades) con pesos (3 decimales). Se cuentan proporciones, no casos sueltos: un
  // decimal perdido por el OCR ("2,74" leído "274") no debe dar la vuelta a toda la tabla
  const qc = columns.find((c) => c.kind === 'qty');
  const pc = columns.find((c) => c.kind === 'price');
  if (qc && pc) {
    const decs = (col: TableColumn) => {
      const count = new Map<number, number>();
      let n = 0;
      for (const r of rows) {
        for (const w of r.words) {
          if (!w.num || w.dec === undefined || columns[columnIndex(columns, w)] !== col) continue;
          count.set(w.dec, (count.get(w.dec) ?? 0) + 1);
          n++;
        }
      }
      const ints = (count.get(0) ?? 0) / Math.max(1, n);
      const mode = Math.max(0, ...count.values()) / Math.max(1, n);
      return { ints, mode, kinds: count.size };
    };
    const dq = decs(qc);
    const dp = decs(pc);
    // Enteros en la columna del precio y ninguno en la de la cantidad: basta con unos pocos si la de la cantidad tiene
    // decimales fijos (como un precio); si los mezcla (como una cantidad), hacen falta muchos
    const swap = (dp.ints > 0 && dq.ints === 0 && dq.kinds > 0 && (dp.ints >= 0.3 || dq.kinds === 1)) || (dp.kinds > 1 && dp.mode < 0.7 && dq.kinds === 1 && dq.ints === 0);
    if (swap) {
      qc.kind = 'price';
      pc.kind = 'qty';
    }
  }
  if (!columns.some((c) => c.kind === 'desc') || !columns.some((c) => c.kind === 'total') || !columns.some((c) => c.kind === 'price')) return undefined;
  return { columns, cw, labeled: false };
}

/** Índice de la columna que contiene el centro de la caja (−1 si ninguna). */
export function columnIndex(columns: readonly TableColumn[], box: Box): number {
  const c = (box.x0 + box.x1) / 2;
  for (let j = 0; j < columns.length; j++) if (c >= columns[j].left && c < columns[j].right) return j;
  return -1;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
