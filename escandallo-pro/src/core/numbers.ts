/**
 * Números y fechas en formato español (y tolerante a formato anglosajón).
 *
 * Pensado para texto "sucio" de facturas y cartas (PDF, OCR, Excel): símbolos de moneda pegados, porcentajes,
 * separadores de miles, signos menos Unicode, abonos entre paréntesis, fechas con nombre de mes, etc.
 */

export interface NumberParseOptions {
  /**
   * Separador decimal preferido para los casos ambiguos con un único separador y 3 dígitos detrás
   * ("1.500", "1,500"). Por defecto ',' (formato español): "1.500" → 1500 y "1,500" → 1,5.
   * Con '.' (documento anglosajón): "1.500" → 1,5 y "1,500" → 1500.
   */
  decimal?: ',' | '.';
}

const MINUS_CHARS = /[−‒–—﹣－]/g;
const SPACE_CHARS = /[    ]/g;

/**
 * Convierte un texto numérico a number. Soporta: "1.234,56", "1234,56", "12,5", "12.50", "1,234.56",
 * "-3,2", "3,20 €", "€ 3.20", "21%", "0,0385", "1.000" (→ 1000, miles), "1.5" (→ 1.5).
 * Regla de ambigüedad con un único separador: si hay exactamente 3 dígitos tras un "." y ninguna ",",
 * es separador de miles ("1.000" → 1000); tras "," siempre es decimal ("1,000" → 1).
 * Devuelve undefined si no es un número.
 */
export function parseNumberEs(raw: string | number | null | undefined, opts: NumberParseOptions = {}): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  let s = String(raw).replace(MINUS_CHARS, '-').replace(SPACE_CHARS, ' ').trim();
  if (!s) return undefined;

  let negative = false;
  // Abonos contables: "(3,20)"
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  // Moneda, porcentaje y sufijo de unidad de precio ("3,20 €/kg")
  s = s
    .replace(/\s*\/\s*(?:kg|kilo|g|gr|l|lt|litro|ml|cl|ud|uds|u|und|unid|unidad)\.?$/i, '')
    .replace(/€|\$|£|\b(?:eur|euros?|usd)\b/gi, ' ')
    .replace(/%/g, ' ')
    .trim();

  const lead = /^([+-])\s*(.*)$/.exec(s);
  if (lead) {
    if (lead[1] === '-') negative = !negative;
    s = lead[2];
  }
  // Signo menos final (algunos ERP: "3,20-")
  const trail = /^(.*\d)\s*-$/.exec(s);
  if (trail) {
    negative = !negative;
    s = trail[1];
  }
  s = s.trim();
  // Miles con espacio o apóstrofo: "1 234,56", "1'234.56"
  if (/^\d{1,3}(?:[ ']\d{3})+(?:[.,]\d+)?$/.test(s)) s = s.replace(/[ ']/g, '');
  if (!/^(?:\d[\d.,]*|[.,]\d+)$/.test(s)) return undefined;
  const v = parseDigits(s, opts.decimal ?? ',');
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return negative && v !== 0 ? -v : v;
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === c) n++;
  return n;
}

/** Interpreta dígitos con separadores "." y "," (sin signo ni símbolos). */
function parseDigits(input: string, pref: ',' | '.'): number | undefined {
  let s = input;
  // Separador final suelto ("12," / "12.") → entero
  if (/^\d+[.,]$/.test(s)) s = s.slice(0, -1);
  const dots = countChar(s, '.');
  const commas = countChar(s, ',');
  if (dots === 0 && commas === 0) return Number(s);
  // ".5" / ",5"
  if (/^[.,]\d+$/.test(s)) return Number(`0.${s.slice(1)}`);

  if (dots > 0 && commas > 0) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    if (countChar(s, dec) !== 1) return undefined;
    const at = s.lastIndexOf(dec);
    const intPart = s.slice(0, at);
    const frac = s.slice(at + 1);
    const groupRe = thou === '.' ? /^\d{1,3}(?:\.\d{3})+$/ : /^\d{1,3}(?:,\d{3})+$/;
    if (!groupRe.test(intPart) || !/^\d+$/.test(frac)) return undefined;
    return Number(`${intPart.split(thou).join('')}.${frac}`);
  }

  const sep = dots > 0 ? '.' : ',';
  const n = dots + commas;
  if (n > 1) {
    // Varios separadores iguales: sólo pueden ser de miles ("1.234.567")
    const groupRe = sep === '.' ? /^\d{1,3}(?:\.\d{3})+$/ : /^\d{1,3}(?:,\d{3})+$/;
    return groupRe.test(s) ? Number(s.split(sep).join('')) : undefined;
  }
  const [a, b] = s.split(sep);
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return undefined;
  const looksThousands = b.length === 3 && a.length <= 3 && !/^0+$/.test(a);
  if (sep === '.') {
    if (pref === ',' && looksThousands) return Number(a + b);
    return Number(`${a}.${b}`);
  }
  if (pref === '.' && looksThousands) return Number(a + b);
  return Number(`${a}.${b}`);
}

export interface NumberToken {
  value: number;
  raw: string;
  start: number;
  end: number;
  isPercent: boolean;
  isCurrency: boolean;
}

/**
 * Encuentra todos los números de una línea de texto, en orden, con su posición.
 * `start`/`end` (y `raw`) abarcan el token completo: signo, símbolo de moneda y "%" incluidos.
 * El signo menos sólo cuenta si no va pegado a una letra o dígito ("T-3" → 3, "ART-12" → 12).
 */
export function findNumbers(text: string, opts: NumberParseOptions = {}): NumberToken[] {
  const out: NumberToken[] = [];
  if (!text) return out;
  const src = text.replace(MINUS_CHARS, '-').replace(SPACE_CHARS, ' ');
  const re = /\d+(?:[.,]\d+)*/g;
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = re.exec(src))) {
    const body = m[0];
    const bodyStart = m.index;
    const bodyEnd = bodyStart + body.length;
    const value = parseNumberEs(body, opts);
    if (value === undefined) {
      // Secuencias no numéricas como "12.03.2025" o "1.23.4": se devuelven sus partes enteras.
      const partRe = /\d+/g;
      let p: RegExpExecArray | null;
      while ((p = partRe.exec(body))) {
        const s = bodyStart + p.index;
        out.push({ value: Number(p[0]), raw: p[0], start: s, end: s + p[0].length, isPercent: false, isCurrency: false });
      }
      lastEnd = bodyEnd;
      continue;
    }
    let start = bodyStart;
    let end = bodyEnd;
    let negative = false;
    let isCurrency = false;
    let isPercent = false;

    // Hacia atrás: signo pegado ("-3,20") y/o moneda ("€ 3,20", "€-3,20", "-€3,20", "EUR 12,00").
    for (let step = 0; step < 2; step++) {
      if (start - 1 < lastEnd) break;
      if (!negative && src[start - 1] === '-' && !/[\p{L}\d]/u.test(src[start - 2] ?? '')) {
        negative = true;
        start -= 1;
        continue;
      }
      if (!isCurrency) {
        const t = src[start - 1] === ' ' ? start - 1 : start;
        const cur = /(€|\$|£|eur)$/i.exec(src.slice(Math.max(0, t - 3), t));
        if (cur && t - cur[1].length >= lastEnd && (cur[1].length === 1 || !/\p{L}/u.test(src[t - 4] ?? ''))) {
          isCurrency = true;
          start = t - cur[1].length;
          continue;
        }
      }
      break;
    }
    // Hacia delante: "%", "€", "EUR", signo menos final ("3,20-")
    const after = src.slice(bodyEnd, bodyEnd + 6);
    const pct = /^\s?%/.exec(after);
    if (pct) {
      isPercent = true;
      end = bodyEnd + pct[0].length;
    } else {
      const cur = /^\s?(?:€|\$|£|eur(?:os?)?\b)/i.exec(after);
      if (cur) {
        isCurrency = true;
        end = bodyEnd + cur[0].length;
      }
    }
    if (!negative && /[.,]/.test(body) && /^-(?=\s|$)/.test(src.slice(end, end + 2)) && /\s/.test(src[start - 1] ?? ' ')) {
      negative = true;
      end += 1;
    }
    lastEnd = end;
    out.push({
      value: negative && value !== 0 ? -value : value,
      raw: text.slice(start, end),
      start,
      end,
      isPercent,
      isCurrency,
    });
  }
  return out;
}

// ───────────────────────────── Fechas ─────────────────────────────

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};
const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

// Todas sobre texto normalizado (minúsculas, sin tildes).
const RE_DMY = /(?<![\d/.,-])(\d{1,2})\s?([/.-])\s?(\d{1,2})\s?\2\s?(\d{4}|\d{2})(?![\d])(?![.,]\d)/g;
const RE_YMD = /(?<![\d/.,-])(\d{4})([/.-])(\d{1,2})\2(\d{1,2})(?!\d)/g;
const RE_TEXT = new RegExp(
  `(?<![a-z\\d])(\\d{1,2})(?:º|°|o)?\\s*(?:de\\s+|[-/.]\\s*)?(${MONTH_ALT})(?![a-z])\\.?\\s*(?:(?:de|del)\\s+|[-/.,]\\s*)?(\\d{4}|\\d{2})(?!\\d)`,
  'g',
);
const RE_TEXT_MDY = new RegExp(`(?<![a-z])(${MONTH_ALT})(?![a-z])\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)`, 'g');

function normalizeForDates(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function daysInMonth(y: number, m: number): number {
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function fullYear(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

function toIso(y: number, m: number, d: number): string | undefined {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return undefined;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface DateCandidate {
  iso: string;
  index: number;
  length: number;
  shortYear: boolean;
  year: number;
}

/** Todas las fechas válidas de un texto ya normalizado, con posición. */
function dateCandidates(norm: string): DateCandidate[] {
  const out: DateCandidate[] = [];
  const push = (iso: string | undefined, index: number, length: number, shortYear: boolean) => {
    if (!iso) return;
    if (out.some((c) => index < c.index + c.length && c.index < index + length)) return;
    out.push({ iso, index, length, shortYear, year: Number(iso.slice(0, 4)) });
  };
  let m: RegExpExecArray | null;
  RE_YMD.lastIndex = 0;
  while ((m = RE_YMD.exec(norm))) push(toIso(Number(m[1]), Number(m[3]), Number(m[4])), m.index, m[0].length, false);
  RE_TEXT.lastIndex = 0;
  while ((m = RE_TEXT.exec(norm))) push(toIso(fullYear(m[3]), MONTHS[m[2]], Number(m[1])), m.index, m[0].length, m[3].length <= 2);
  RE_TEXT_MDY.lastIndex = 0;
  while ((m = RE_TEXT_MDY.exec(norm))) push(toIso(Number(m[3]), MONTHS[m[1]], Number(m[2])), m.index, m[0].length, false);
  RE_DMY.lastIndex = 0;
  while ((m = RE_DMY.exec(norm))) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = fullYear(m[4]);
    // Formato español día/mes; si es imposible pero mes/día es válido (anglosajón inequívoco), se acepta.
    const iso = toIso(y, b, a) ?? (b > 12 && a <= 12 ? toIso(y, a, b) : undefined);
    push(iso, m.index, m[0].length, m[4].length <= 2);
  }
  return out.sort((x, y) => x.index - y.index);
}

/**
 * Interpreta una fecha española y la devuelve como YYYY-MM-DD. Soporta "12/03/2025", "12-03-25",
 * "12.03.2025", "2025-03-12", "12 de marzo de 2025", "12 mar 2025", "12-MAR-2025". Años de 2 dígitos → 20xx.
 * Tolera prefijos sin cifras ("Fecha:", "lunes,") y una hora final ("12/03/2025 14:30").
 * Devuelve undefined si no es una fecha válida (p. ej. "31/02/2025").
 */
export function parseDateEs(raw: string): string | undefined {
  if (!raw) return undefined;
  const norm = normalizeForDates(String(raw))
    .replace(/t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?$/, '')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:h|horas|am|pm)?\b/g, ' ')
    .trim();
  const cands = dateCandidates(norm);
  if (cands.length !== 1) return undefined;
  const c = cands[0];
  const rest = norm.slice(0, c.index) + ' ' + norm.slice(c.index + c.length);
  if (/\d/.test(rest)) return undefined;
  return c.iso;
}

const LABEL_RE = new RegExp(
  [
    // Fecha de la factura (máxima prioridad)
    '(?<strong>fecha\\s*(?:de\\s*)?(?:la\\s*)?(?:factura|fra\\b|emision|expedicion|documento|doc\\b)|f\\.?\\s*(?:factura|fra\\b|emision|expedicion)|invoice\\s*date|fecha\\s*fact\\b)',
    // Otras fechas que NO son la de la factura
    '(?<neg>(?:fecha\\s*(?:de\\s*(?:la\\s*|del\\s*)?)?)?(?:vencimiento|venc\\b|vto\\b|vence|entrega|pedido|albaran|caducidad|consumo|pago|cobro|valid[oa]|validez|hasta|desde|periodo|nacimiento|alta\\b|servicio|operacion|contable|cargo|impresion|due\\s*date))',
    '(?<pos>fecha|fec\\b|fch\\b|date\\b)',
  ].join('|'),
  'g',
);

interface Label {
  kind: 'strong' | 'neg' | 'pos';
  start: number;
  end: number;
}

function findLabels(line: string): Label[] {
  const out: Label[] = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(line))) {
    const g = m.groups ?? {};
    const kind: Label['kind'] = g.strong ? 'strong' : g.neg ? 'neg' : 'pos';
    out.push({ kind, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const LABEL_SCORE: Record<Label['kind'], number> = { strong: 9, pos: 5, neg: -7 };

/**
 * Busca la fecha de la factura dentro de un texto largo. Prefiere las fechas cercanas a etiquetas como
 * "Fecha", "Fecha factura", "F. Factura" o "Fecha emisión" (en la misma línea o en la cabecera de la línea
 * anterior) y penaliza las de vencimiento, entrega, pedido, caducidad… A igualdad, gana la primera.
 */
export function findDate(text: string): string | undefined {
  if (!text) return undefined;
  const lines = normalizeForDates(text).split(/\r?\n/);
  let best: { iso: string; score: number } | undefined;
  let prevLabels: Label[] = [];
  let prevLine = '';
  for (const line of lines) {
    const labels = findLabels(line);
    for (const c of dateCandidates(line)) {
      let score = 10;
      if (c.shortYear) score -= 1;
      if (c.year < 2000 || c.year > 2099) score -= 6;
      // Etiqueta más cercana antes de la fecha en la misma línea
      const before = labels.filter((l) => l.end <= c.index);
      if (before.length) {
        const l = before[before.length - 1];
        const dist = c.index - l.end;
        score += LABEL_SCORE[l.kind] * (dist <= 40 ? 1 : 0.5);
      } else if (prevLabels.length) {
        // Cabecera en la línea anterior (tablas "Fecha | Nº factura" con los valores debajo)
        const aligned = prevLabels.filter((l) => Math.abs(l.start - c.index) <= 18);
        const pick = aligned.length ? aligned[aligned.length - 1] : undefined;
        if (pick) score += LABEL_SCORE[pick.kind] * 0.8;
        else if (/fecha/.test(prevLine)) score += 1;
      }
      if (!best || score > best.score) best = { iso: c.iso, score };
    }
    prevLabels = labels;
    prevLine = line;
  }
  return best?.iso;
}

export function round(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((v + Number.EPSILON) * f) / f;
}

/** Igualdad aproximada para validar importes: |a−b| ≤ max(tolAbs, tolRel·max(|a|,|b|)) (con margen de coma flotante). */
export function approxEqual(a: number, b: number, tolAbs = 0.02, tolRel = 0.01): boolean {
  return Math.abs(a - b) <= Math.max(tolAbs, tolRel * Math.max(Math.abs(a), Math.abs(b))) + 1e-9;
}
