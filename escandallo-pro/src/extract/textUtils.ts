/**
 * Utilidades de texto compartidas por los parsers de facturas y cartas (lógica pura, sin DOM).
 */

const DIACRITICS = /[̀-ͯ]/g;

/** minúsculas y sin tildes (la ñ pasa a n). */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(DIACRITICS, '');
}

/**
 * Igual que `fold` pero conservando la longitud carácter a carácter, para poder usar las posiciones de las
 * coincidencias de expresiones regulares sobre el texto original.
 */
export function foldKeepLength(s: string): string {
  let out = '';
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
    // Caracteres que se expanden al pasar a minúsculas (p. ej. "İ") se recortan a uno.
    out += f.length === ch.length ? f : ch.length === 1 ? (f[0] ?? ch) : ch;
  }
  return out;
}

/** Distancia de Levenshtein acotada (devuelve max + 1 si se supera). */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** ¿La palabra (ya plegada) coincide con alguna del vocabulario, tolerando erratas de OCR en palabras largas? */
export function fuzzyIn(word: string, vocab: readonly string[]): string | undefined {
  if (!word) return undefined;
  for (const v of vocab) if (v === word) return v;
  if (word.length < 5) return undefined;
  const max = word.length >= 8 ? 2 : 1;
  for (const v of vocab) if (Math.abs(v.length - word.length) <= max && editDistance(word, v, max) <= max) return v;
  return undefined;
}

/** Confusiones típicas del OCR entre letras y cifras dentro de un número. */
const OCR_DIGIT: Record<string, string> = {
  O: '0', o: '0', D: '0', Q: '0',
  l: '1', I: '1', i: '1', '|': '1', '!': '1', ']': '1', '[': '1',
  S: '5', s: '5', $: '5',
  B: '8',
  Z: '2', z: '2',
  G: '6', b: '6',
  g: '9', q: '9',
};

/**
 * Corrige confusiones letra/cifra del OCR en un token que "casi" es un número ("1O,5O" → "10,50", "l2,5" → "12,5").
 * Sólo si el token tiene al menos una cifra real y la mayoría de caracteres son cifras. Devuelve undefined si no aplica.
 */
export function fixOcrNumber(token: string): string | undefined {
  const m = /^([-+(]?)(€?)(.*?)(€|%)?([)-]?)$/.exec(token);
  if (!m) return undefined;
  const body = m[3];
  if (!body || !/\d/.test(body) || /^[\d.,]+$/.test(body)) return undefined;
  if (!/^[\dOoDQlIi|!\][Ss$BZzGbgq.,]+$/.test(body)) return undefined;
  // "1l", "5g": cifra + unidad pegada (litro, gramo), no una errata
  if (/^\d+[lgG]$/.test(body)) return undefined;
  const digits = (body.match(/\d/g) ?? []).length;
  const letters = body.replace(/[\d.,]/g, '').length;
  // "18,OOO", "1O,OOO": ceros leídos como letra O (muy habitual en cantidades con 3 decimales)
  const zeros = /^[\dOo]{1,4}[.,][\dOo]{1,3}$/.test(body) && /\d/.test(body) && !/[^\dOo.,]/.test(body);
  if (!zeros && (letters > digits || letters > 2)) return undefined;
  // Un separador en el borde no es un decimal ("S." no es "5.")
  if (/^[.,]|[.,]$/.test(body)) return undefined;
  let fixed = '';
  for (const ch of body) fixed += OCR_DIGIT[ch] ?? ch;
  if (!/^\d+(?:[.,]\d+)*$/.test(fixed)) return undefined;
  return `${m[1]}${m[2]}${fixed}${m[4] ?? ''}${m[5]}`;
}

/** ¿Está en mayúsculas (ignorando cifras y signos)? Requiere al menos 3 letras. */
export function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Mediana de una lista de números (0 si está vacía). */
export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
