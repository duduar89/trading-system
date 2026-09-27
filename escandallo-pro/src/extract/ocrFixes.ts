import { CUTS, FOOD_NOUNS, HERBS_SPICES, PACK_WORDS, STOPWORDS, TRANSFORMS, VARIETIES, WEAK_QUALIFIERS } from '../core/lexicon';
import { fold } from './textUtils';

/**
 * Correcciones de errores típicos del OCR en descripciones de producto (lógica pura).
 *
 * Son conservadoras: sólo actúan cuando el resultado es claramente mejor que lo leído.
 *  - Formatos con letras en lugar de cifras: "SL" → "5L", "S00G" → "500G", "1O0G" → "100G", "1kKG" → "1KG".
 *  - Cifras dentro de palabras: "CEB0LLA" → "CEBOLLA" (sólo si sale una palabra conocida).
 *  - Palabra y formato pegados: "MG1L" → "MG 1L", "GARRAFASL" → "GARRAFA 5L".
 *  - Palabras pegadas: "CARRILLERAIBERICA" → "CARRILLERA IBERICA", sólo si todas las piezas son palabras conocidas del
 *    léxico culinario (core/lexicon), para no romper nombres propios o marcas.
 * El formato del envase es lo que permite calcular el €/kg o €/l: recuperarlo bien importa.
 */

let vocab: Set<string> | undefined;

/** Vocabulario de palabras de producto (plegadas, en singular). */
function vocabulary(): Set<string> {
  if (!vocab) {
    vocab = new Set<string>();
    for (const set of [FOOD_NOUNS, VARIETIES, WEAK_QUALIFIERS, TRANSFORMS, CUTS, PACK_WORDS, HERBS_SPICES]) for (const w of set) if (w.length >= 3) vocab.add(w);
  }
  return vocab;
}

/** ¿Es una palabra conocida (con plural o femenino)? */
export function knownWord(word: string): boolean {
  const f = fold(word);
  if (f.length < 3) return false;
  const v = vocabulary();
  if (v.has(f)) return true;
  if (f.endsWith('es') && v.has(f.slice(0, -2))) return true;
  if (f.endsWith('s') && v.has(f.slice(0, -1))) return true;
  const base = f.replace(/s$/, '');
  if (base.endsWith('a') && v.has(`${base.slice(0, -1)}o`)) return true;
  return false;
}

/**
 * Separa palabras pegadas por el OCR si todas las piezas son conocidas (entre 2 y 4 piezas; "de", "la", "con"… sólo
 * entre dos palabras). Devuelve undefined si la palabra ya es conocida o no hay una segmentación fiable.
 */
export function splitGluedWords(token: string): string | undefined {
  if (!/^\p{L}{9,}$/u.test(token) || knownWord(token)) return undefined;
  const f = fold(token);
  if (f.length !== token.length) return undefined;
  const n = f.length;
  // best[i] = mínimo de piezas para segmentar f[0, i)
  const best = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 16); j < i; j++) {
      if (best[j] === Infinity) continue;
      const piece = f.slice(j, i);
      const ok = (piece.length >= 3 && knownWord(piece)) || (j > 0 && i < n && STOPWORDS.has(piece) && piece.length >= 2);
      if (ok && best[j] + 1 < best[i]) {
        best[i] = best[j] + 1;
        prev[i] = j;
      }
    }
  }
  if (best[n] < 2 || best[n] > 4) return undefined;
  const cuts: number[] = [];
  for (let i = n; i > 0; i = prev[i]) cuts.unshift(i);
  let start = 0;
  const parts: string[] = [];
  for (const c of cuts) {
    parts.push(token.slice(start, c));
    start = c;
  }
  return parts.join(' ');
}

const UNIT = '(?:kgs?|grs?|g|l|lt|ml|cl|uds?)';
const PACK_TOKEN = new RegExp(`^([0-9OoSsIlB]+(?:[.,][0-9OoSs]+)?)(${UNIT})$`, 'i');
const LETTER_DIGIT: Record<string, string> = { O: '0', o: '0', S: '5', s: '5', I: '1', l: '1', B: '8' };

/** "SL" → "5L", "S00G" → "500G", "1O0G" → "100G", "1kKG" → "1KG". undefined si no aplica. */
export function fixPackToken(token: string): string | undefined {
  const dup = /^(\d+(?:[.,]\d+)?)k(kg)$/i.exec(token);
  if (dup) return `${dup[1]}${dup[2]}`;
  const m = PACK_TOKEN.exec(token);
  if (!m) return undefined;
  const num = m[1];
  if (/^[\d.,]+$/.test(num)) return undefined;
  const hasDigit = /\d/.test(num);
  // Sin ninguna cifra sólo se aceptan "S"/"I" sueltas delante de la unidad ("SL", "IKG")
  if (!hasDigit && !/^[SI]$/.test(num)) return undefined;
  const fixed = num.replace(/[OoSsIlB]/g, (c) => LETTER_DIGIT[c] ?? c);
  const v = Number(fixed.replace(',', '.'));
  if (!(v > 0)) return undefined;
  return `${fixed}${m[2]}`;
}

const GLUED_PACK = new RegExp(`^(\\p{L}{2,})(\\d+(?:[.,]\\d+)?${UNIT})$`, 'iu');
const GLUED_SL = /^(\p{L}{3,})([SI])(l|kg|g)$/iu;

const DIGIT_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '4': 'A', '6': 'G' };

/**
 * "CEB0LLA" → "CEBOLLA", "P1MIENTO" → "PIMIENTO": cifras dentro de una palabra de letras. Sólo si el resultado es una
 * palabra conocida (con "1" se prueban I y L).
 */
export function fixDigitsInWord(token: string): string | undefined {
  if (!/^\p{L}+[0-9]\p{L}*$|^\p{L}*[0-9]\p{L}+$/u.test(token) || token.replace(/\P{L}/gu, '').length < 3) return undefined;
  const upper = token === token.toUpperCase();
  const options = (ch: string) => (ch === '1' ? ['I', 'L'] : DIGIT_LETTER[ch] ? [DIGIT_LETTER[ch]] : []);
  const at = token.search(/[0-9]/);
  for (const letter of options(token[at])) {
    const cand = token.slice(0, at) + (upper ? letter : letter.toLowerCase()) + token.slice(at + 1);
    if (knownWord(cand)) return cand;
  }
  return undefined;
}

/** "BARRADE" → "BARRA DE": preposición pegada al final de una palabra conocida (en mayúsculas o minúsculas). */
function splitGluedPreposition(token: string): string[] | undefined {
  if (!/^\p{L}{6,}$/u.test(token) || knownWord(token)) return undefined;
  const m = /^(\p{L}{4,}?)(del|de|con|en)$/iu.exec(token);
  if (!m || !knownWord(m[1])) return undefined;
  return [m[1], m[2]];
}

function fixWord(token: string): string[] {
  const inWord = fixDigitsInWord(token) ?? fixShapeConfusions(token);
  if (inWord) return [inWord];
  const prep = splitGluedPreposition(token);
  if (prep) return prep;
  const glued = GLUED_PACK.exec(token);
  if (glued) return [...fixWord(glued[1]), glued[2]];
  const sl = GLUED_SL.exec(token);
  if (sl && knownWord(sl[1]) && !knownWord(token)) return [sl[1], `${sl[2] === 'S' || sl[2] === 's' ? '5' : '1'}${sl[3]}`];
  const pack = fixPackToken(token);
  if (pack) return [pack];
  const split = splitGluedWords(token);
  if (split) return split.split(' ');
  return [token];
}

/** Gramajes habituales de envase: si el OCR lee la «G» final como «6» ("756"), el resto es uno de estos. */
const COMMON_GRAMS = new Set([10, 15, 20, 25, 30, 40, 45, 50, 60, 70, 75, 80, 90, 100, 110, 120, 125, 130, 140, 150, 160, 170, 180, 200, 220, 225, 230, 240, 250, 280, 300, 320, 330, 350, 370, 380, 390, 400, 420, 425, 450, 480, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000]);

/**
 * "756" → "75G", "2506" → "250G", "1K6" → "1KG": la «G» de la unidad leída como «6» en el ÚLTIMO token de la
 * descripción (donde van los formatos). Sólo si el número sin el «6» es un gramaje habitual y el token anterior
 * no es una referencia/código.
 */
export function fixTrailingUnitSix(tokens: string[]): string[] {
  if (!tokens.length) return tokens;
  const last = tokens[tokens.length - 1];
  const prev = (tokens[tokens.length - 2] ?? '').toLowerCase().replace(/[.:º°#]/g, '');
  if (/^(ref|cod|codigo|código|art|lote|n|nº|no)$/.test(prev)) return tokens;
  const k6 = /^(\d+(?:[.,]\d+)?)K6$/i.exec(last);
  if (k6) return [...tokens.slice(0, -1), `${k6[1]}${last[last.length - 2]}G`.replace(/kG$/, 'kg')];
  const g6 = /^(\d{2,4})6$/.exec(last);
  if (g6 && COMMON_GRAMS.has(Number(g6[1]))) return [...tokens.slice(0, -1), `${g6[1]}G`];
  return tokens;
}

/** Productos líquidos y envases de líquidos: su formato va en litros ("1l" que el OCR lee "11"). */
const LIQUIDS = new Set(
  (
    'aceite leche agua vino cerveza nata zumo refresco vinagre caldo fumet licor bebida horchata batido sidra cava mosto ' +
    'vermut ginebra whisky ron tonica gaseosa soja lejia detergente fregasuelos limpiador lavavajillas abrillantador ' +
    'garrafa botella bidon brik brick tetrabrik barril'
  ).split(' '),
);
/** Volúmenes habituales en litros. */
const COMMON_LITERS = new Set([0.2, 0.25, 0.33, 0.5, 0.7, 0.75, 1, 1.5, 2, 2.5, 3, 5, 10, 20, 25, 30, 50]);

/** ¿La descripción usa minúsculas? Entonces las unidades pegadas a la cifra también suelen ir en minúscula ("250g", "1l"). */
function mixedCase(tokens: string[]): boolean {
  return tokens.some((t) => /\p{Ll}{2,}/u.test(t) && !/\d/.test(t));
}

function hasWordIn(tokens: string[], set: Set<string>): boolean {
  return tokens.some((t) => {
    const f = fold(t).replace(/[^a-z]/g, '');
    return set.has(f) || (f.endsWith('s') && set.has(f.slice(0, -1))) || (f.endsWith('es') && set.has(f.slice(0, -2)));
  });
}

const numValue = (s: string) => Number(s.replace(',', '.'));

/**
 * Unidades en minúscula leídas como cifras: la «l» como «1» ("11" → "1l", "101" → "10l", "6x11" → "6x1l") y la «g»
 * como «9» ("2509" → "250g"), además de "70c1" → "70cl", "1k9" → "1kg" y "lkg" → "1kg". Las de «l» y «g» sólo con
 * contexto: descripción en minúsculas y un volumen o gramaje habitual (y, para litros, un producto líquido).
 */
export function fixLowercaseUnits(tokens: string[]): string[] {
  const lower = mixedCase(tokens);
  const liquid = hasWordIn(tokens, LIQUIDS);
  const spice = hasWordIn(tokens, HERBS_SPICES);
  return tokens.map((t, i) => {
    const prev = fold(tokens[i - 1] ?? '').replace(/[.:º°#]/g, '');
    if (/^(ref|cod|codigo|art|lote|n|no)$/.test(prev)) return t;
    // "5I" / "5|": la «l» de litros leída como «I» o «|» (nunca es otra cosa pegada a una cifra)
    const bigI = /^(\d+(?:[.,]\d+)?)[I|]$/.exec(t);
    if (bigI && COMMON_LITERS.has(numValue(bigI[1]))) return `${bigI[1]}${lower ? 'l' : 'L'}`;
    const cl = /^(\d+(?:[.,]\d+)?)([cm])[1I|]$/i.exec(t);
    if (cl) return `${cl[1]}${cl[2]}${cl[2] === cl[2].toUpperCase() ? 'L' : 'l'}`;
    const k9 = /^(\d+(?:[.,]\d+)?)([kK])9$/.exec(t);
    if (k9) return `${k9[1]}${k9[2]}g`;
    const lkg = /^[lIi](kgs?|KGS?|Kg)$/.exec(t);
    if (lkg) return `1${lkg[1]}`;
    if (!lower) return t;
    const m = /^(\d+x)?(\d+(?:[.,]\d{1,2})?)([19])$/i.exec(t);
    if (!m) return t;
    const v = numValue(m[2]);
    if (m[3] === '1' && liquid && COMMON_LITERS.has(v)) return `${m[1] ?? ''}${m[2]}l`;
    if (m[3] === '9' && !m[1] && Number.isInteger(v) && (COMMON_GRAMS.has(v) || (spice && v >= 1 && v <= 5))) return `${m[2]}g`;
    return t;
  });
}

/** Confusiones de formas del OCR dentro de palabras: "rn" ↔ "m", "m" ↔ "n", "i" ↔ "l" ("Carme" → "Carne", "Musio" → "Muslo"), sólo hacia una palabra conocida. */
export function fixShapeConfusions(token: string): string | undefined {
  if (!/^\p{L}{3,}$/u.test(token) || knownWord(token)) return undefined;
  const swaps: [RegExp, string][] = [
    [/m/g, 'rn'],
    [/rn/g, 'm'],
    [/M/g, 'RN'],
    [/RN/g, 'M'],
    [/m/g, 'n'],
    [/n/g, 'm'],
    [/M/g, 'N'],
    [/N/g, 'M'],
    [/i/g, 'l'],
    [/l/g, 'i'],
    [/I/g, 'L'],
    [/L/g, 'I'],
  ];
  for (const [re, rep] of swaps) {
    for (const m of token.matchAll(re)) {
      const at = m.index ?? 0;
      const cand = token.slice(0, at) + rep + token.slice(at + m[0].length);
      if (knownWord(cand)) return cand;
    }
  }
  return undefined;
}

/**
 * Basura pegada al principio de la descripción (restos de una raya de la tabla o de una viñeta): "tGARBANZO" →
 * "GARBANZO", "¡Nata" → "Nata", "|Tomate" → "Tomate". Una minúscula suelta sólo se quita delante de una mayúscula
 * cuando el resto es una palabra conocida o va entero en mayúsculas.
 */
export function stripLeadingJunk(token: string): string {
  const punct = /^[¡!|_~'"`´^*•·.,:;¦\[\]]+(?=\p{L})/u.exec(token);
  if (punct) return token.slice(punct[0].length);
  const m = /^\p{Ll}(\p{Lu}\p{L}{2,})$/u.exec(token);
  if (m && (knownWord(m[1]) || m[1] === m[1].toUpperCase())) return m[1];
  // Mayúscula de más pegada a una palabra conocida ("NMORTADELA", "RMANTEQUILLA")
  if (/^\p{Lu}{5,}$/u.test(token) && !knownWord(token) && knownWord(token.slice(1))) return token.slice(1);
  return token;
}

/**
 * Restos del OCR al final de una descripción en mayúsculas: palabras cortas en minúsculas o mezcladas ("Te Tes",
 * "mes") y ristras de signos y letras ("..-.enceunEe"). Sólo se quitan del final y nunca la primera palabra.
 */
export function stripTrailingJunk(tokens: string[]): string[] {
  const junk = (t: string) => {
    const l = t.replace(/[^\p{L}]/gu, '');
    if (/[.\-_~]{2,}/.test(t) && /\p{Ll}/u.test(t)) return true;
    return l.length > 0 && l.length <= 4 && l !== l.toUpperCase() && !/\d/.test(t) && !knownWord(l) && !PACK_WORDS.has(fold(l));
  };
  let end = tokens.length;
  while (end > 1 && junk(tokens[end - 1])) end--;
  if (end === tokens.length) return tokens;
  const letters = tokens.slice(0, end).join('').replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  if (letters.length < 6 || upper < letters.length * 0.8) return tokens;
  return tokens.slice(0, end);
}

/** "FRESOÓN" → "FRESÓN": la misma vocal leída dos veces, con y sin tilde. */
export function dedupeAccentedVowel(token: string): string {
  return token.replace(/([aeiou])([áéíóú])|([áéíóú])([aeiou])/gi, (m: string, a?: string, b?: string, c?: string, d?: string) => {
    const plain = a ?? d ?? '';
    const accented = b ?? c ?? '';
    return fold(accented) === plain.toLowerCase() ? accented : m;
  });
}

/** Categorías comerciales de frutas y hortalizas en números romanos ("CATEGORÍA I", "Cat. II") leídos como cifras o «l». */
function fixRomanCategory(tokens: string[]): string[] {
  return tokens.map((t, i) => {
    if (i === 0 || !/^(?:categoria|cat|clase)$/.test(fold(tokens[i - 1]).replace(/[.:]/g, ''))) return t;
    if (/^[1lI|]$/.test(t)) return 'I';
    if (/^[1lI|]{2}$/.test(t)) return 'II';
    return t;
  });
}

/** Limpia errores típicos del OCR en una descripción de producto (ver cabecera del módulo). */
export function fixOcrDescription(desc: string): string {
  const raw = desc.split(/\s+/).filter(Boolean).map(dedupeAccentedVowel);
  if (raw.length) raw[0] = stripLeadingJunk(raw[0]);
  const tokens = raw.flatMap(fixWord).map((t) => (/^\d+(?:[.,]\d+)?nm$/i.test(t) ? t.replace(/n(m)$/i, (_, x: string) => `${x}${x}`) : t));
  return fixRomanCategory(fixTrailingUnitSix(fixLowercaseUnits(stripTrailingJunk(tokens)))).join(' ');
}

const GLUE_TAIL = ['a', 'al', 'de', 'del', 'con', 'y', 'en'];

/**
 * "Pulpoa la gallega" → "Pulpo a la gallega": el OCR pega a veces una preposición corta al final de la palabra
 * anterior. Sólo si la palabra no es conocida, sin la cola sí lo es (≥ 4 letras) y la siguiente palabra sigue la frase.
 */
export function splitGluedTail(word: string, next: string | undefined): string | undefined {
  if (!next || !/^\p{Ll}/u.test(next) || !/^\p{L}{5,}$/u.test(word) || knownWord(word)) return undefined;
  for (const tail of GLUE_TAIL) {
    const f = fold(word);
    if (!f.endsWith(tail)) continue;
    const head = word.slice(0, word.length - tail.length);
    if (head.length >= 4 && knownWord(head)) return `${head} ${word.slice(word.length - tail.length)}`;
  }
  return undefined;
}

