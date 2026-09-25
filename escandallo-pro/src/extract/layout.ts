/**
 * Reconstrucción de filas de texto a partir de fragmentos posicionados (ítems de pdf.js o palabras de OCR).
 *
 * Lógica pura (sin DOM, sin pdf.js, sin tesseract): la comparten el navegador y el banco de pruebas en Node.
 * Agrupa los fragmentos por línea base (con tolerancia proporcional a la altura del texto), los ordena por X y
 * los une: huecos pequeños → espacio simple (o nada), huecos grandes → separador de columna (2+ espacios,
 * proporcional al hueco, para que el texto conserve aproximadamente la alineación de las columnas).
 */

export interface PositionedText {
  str: string;
  /** Borde izquierdo. */
  x: number;
  width: number;
  /** Línea base o borde inferior, en coordenadas de arriba a abajo. */
  y: number;
  /** Altura del texto (tamaño de fuente aproximado). */
  height: number;
}

export interface LayoutCell {
  x: number;
  width: number;
  str: string;
}

export interface LayoutLine {
  page: number;
  y: number;
  /** Altura mediana del texto de la línea. */
  height: number;
  text: string;
  /** Celdas: fragmentos unidos entre separadores de columna. */
  items: LayoutCell[];
}

export interface BuildLinesOptions {
  /** Tolerancia vertical relativa a la altura del texto (0,5 = media altura). */
  yTolerance?: number;
  /** Hueco (en anchos medios de carácter) a partir del cual se considera separación de columnas. */
  columnGap?: number;
  /** Máximo de espacios con que se representa un hueco de columna en el texto. */
  maxGapSpaces?: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Ancho medio de carácter de un fragmento (con un mínimo razonable relativo a su altura). */
function charWidth(t: PositionedText): number {
  const visible = t.str.replace(/\s+/g, '').length || 1;
  const w = t.width / Math.max(visible, t.str.length * 0.85);
  const h = t.height > 0 ? t.height : w * 2;
  return Math.max(w, h * 0.3);
}

/**
 * Agrupa fragmentos posicionados de UNA página en líneas ordenadas de arriba a abajo.
 * Los fragmentos que sólo contienen espacios se descartan (los huecos se calculan con la geometría).
 */
export function buildLines(fragments: PositionedText[], page = 1, opts: BuildLinesOptions = {}): LayoutLine[] {
  const yTol = opts.yTolerance ?? 0.5;
  const colGap = opts.columnGap ?? 1.2;
  const maxSpaces = opts.maxGapSpaces ?? 60;
  const items = fragments.filter((f) => f.str && f.str.trim() && Number.isFinite(f.x) && Number.isFinite(f.y) && f.width >= 0);
  if (!items.length) return [];

  // 1) Agrupación por línea base: orden por Y y, dentro de una banda, se añade a la línea más cercana.
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  type Group = { y: number; h: number; members: PositionedText[] };
  const groups: Group[] = [];
  for (const it of sorted) {
    const h = it.height > 0 ? it.height : charWidth(it) * 2;
    let best: Group | undefined;
    let bestDist = Infinity;
    // Sólo hace falta mirar los grupos recientes (orden por Y).
    for (let g = groups.length - 1; g >= 0 && g >= groups.length - 6; g--) {
      const grp = groups[g];
      const tol = yTol * Math.min(h, grp.h);
      const dist = Math.abs(it.y - grp.y);
      if (dist <= Math.max(tol, 0.5) && dist < bestDist) {
        // No mezclar fragmentos que se solapan en X con otro del mismo grupo (serían dos líneas muy juntas).
        const overlaps = grp.members.some((m) => it.x < m.x + m.width - charWidth(m) * 0.5 && m.x < it.x + it.width - charWidth(it) * 0.5);
        if (!overlaps) {
          best = grp;
          bestDist = dist;
        }
      }
    }
    if (best) {
      best.members.push(it);
      // Y de referencia: la del fragmento más alto (texto principal), estable frente a superíndices.
      if (h > best.h) {
        best.h = h;
        best.y = it.y;
      }
    } else {
      groups.push({ y: it.y, h, members: [it] });
    }
  }

  // 2) Dentro de cada línea: orden por X y unión en celdas.
  const lines: LayoutLine[] = groups.map((grp) => {
    const members = grp.members.sort((a, b) => a.x - b.x);
    const cws = members.map(charWidth);
    const lineCw = median(cws);
    const cells: LayoutCell[] = [];
    let text = '';
    let cur: LayoutCell | undefined;
    let prevEnd = -Infinity;
    let prevCw = lineCw;
    members.forEach((m, i) => {
      const cw = Math.max(lineCw * 0.6, Math.min(cws[i], lineCw * 1.6));
      const refCw = (cw + prevCw) / 2;
      const gap = m.x - prevEnd;
      const str = m.str.replace(/\s+/g, ' ');
      if (!cur) {
        cur = { x: m.x, width: m.width, str: str.trim() };
        text = str.trim();
      } else if (gap > colGap * refCw) {
        cells.push(cur);
        const spaces = Math.max(2, Math.min(maxSpaces, Math.round(gap / refCw)));
        text = text.replace(/\s+$/, '') + ' '.repeat(spaces) + str.trim();
        cur = { x: m.x, width: m.width, str: str.trim() };
      } else {
        const glue = gap > 0.12 * refCw && !/\s$/.test(cur.str) && !/^\s/.test(str) ? ' ' : '';
        cur.str = (cur.str + glue + str).replace(/\s+/g, ' ');
        cur.width = m.x + m.width - cur.x;
        text = text + glue + str;
      }
      prevEnd = Math.max(prevEnd, m.x + m.width);
      prevCw = cw;
    });
    if (cur) cells.push(cur);
    return { page, y: grp.y, height: median(members.map((m) => (m.height > 0 ? m.height : charWidth(m) * 2))), text: text.replace(/\s+$/, ''), items: cells };
  });
  return lines.sort((a, b) => a.y - b.y);
}

/** Texto completo: líneas unidas por \n y páginas separadas por una línea en blanco. */
export function linesToText(lines: readonly { page: number; text: string }[]): string {
  let out = '';
  let page = lines[0]?.page;
  for (const l of lines) {
    if (l.page !== page) {
      out += '\n';
      page = l.page;
    }
    out += `${l.text}\n`;
  }
  return out.replace(/\n+$/, '');
}

/** ¿Tiene el PDF capa de texto útil? Media ≥ 40 caracteres visibles por página. */
export function looksLikeText(lines: readonly { text: string }[], pageCount: number): boolean {
  if (!pageCount) return false;
  const visible = lines.reduce((n, l) => n + l.text.replace(/\s+/g, '').length, 0);
  return visible / pageCount >= 40;
}
