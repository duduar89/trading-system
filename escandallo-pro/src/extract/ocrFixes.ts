import { CUTS, FOOD_NOUNS, HERBS_SPICES, PACK_WORDS, STOPWORDS, TRANSFORMS, VARIETIES, WEAK_QUALIFIERS } from '../core/lexicon';
import { fold } from './textUtils';

/**
 * Correcciones de errores típicos del OCR en descripciones de producto (lógica pura).
 *
 * Son conservadoras: sólo actúan cuando el resultado es claramente mejor que lo leído.
 *  - Formatos con letras en lugar de cifras: "SL" → "5L", "S00G" → "500G", "1O0G" → "100G", "1kKG" → "1KG".
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

function fixWord(token: string): string[] {
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

/** Limpia errores típicos del OCR en una descripción de producto (ver cabecera del módulo). */
export function fixOcrDescription(desc: string): string {
  return desc
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(fixWord)
    .join(' ');
}
