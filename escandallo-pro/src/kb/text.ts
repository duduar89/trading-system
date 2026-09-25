import { normalizeText } from '../core/matching';

/**
 * Utilidades de texto de la base de conocimiento local.
 *
 * Todo el índice (ingredientes, recetas, elaboraciones) y las consultas pasan por la misma tokenización,
 * así el emparejamiento exacto por frases es determinista y muy rápido (búsqueda en Map):
 *   normalizeText (core/matching) → abreviaturas de proveedor → palabras → sin palabras vacías → singular.
 */

/** Palabras vacías: artículos, preposiciones y conectores que no distinguen ingredientes ni platos. */
export const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'a', 'al', 'en', 'con', 'y', 'e', 'o', 'u', 'sobre', 'su', 'sus',
  'para', 'por', 'un', 'una', 'unos', 'unas', 'mi', 'tu', 'que', 'se', 'como', 'muy', 'mas', 'entre',
  'nuestro', 'nuestra', 'nuestros', 'nuestras', 'casero', 'casera', 'caseros', 'caseras', 'estilo', 'receta', 'tradicional',
  'tradicionales', 'artesano', 'artesana', 'artesanos', 'artesanas', 'clasico', 'clasica', 'clasicos', 'clasicas', 'especial',
  'autentico', 'autentica', 'delicioso', 'deliciosa', 'exquisito', 'exquisita', 'selecto', 'selecta', 'seleccion', 'premium',
  'gourmet', 'chef', 'casa', 'abuela', 'mama', 'dia', 'temporada', 'mercado', 'lonja', 'rico', 'rica',
  'acompanado', 'acompanada', 'acompanados', 'acompanadas', 'servido', 'servida', 'servidos', 'servidas', 'elaborado',
  'elaborada', 'hecho', 'hecha', 'hechos', 'hechas', 'cama', 'lecho', 'toque', 'toques', 'aroma', 'aromas', 'perfumado',
  'perfumada', 'plato', 'platos', 'racion', 'raciones', 'media', 'medio', 'porcion', 'unidad', 'unidades',
  'ud', 'uds', 'und', 'aprox', 'aproximadamente', 'persona', 'personas', 'pax', 'min', 'minimo', 'x',
]);

/** Palabras de formato/envase/calibre típicas de facturas que no forman parte del nombre del ingrediente. */
export const FORMAT_WORDS = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'g', 'gr', 'grs', 'gramo', 'gramos', 'l', 'lt', 'lts', 'litro', 'litros', 'ml', 'cl', 'dl',
  'caja', 'cajas', 'bandeja', 'bandejas', 'bolsa', 'bolsas', 'saco', 'garrafa', 'garrafas', 'bote', 'botes', 'lata', 'latas',
  'botella', 'botellas', 'bot', 'tarro', 'tarros', 'paquete', 'paquetes', 'pack', 'malla', 'mallas', 'manojo', 'manojos',
  'docena', 'docenas', 'cat', 'calibre', 'granel', 'envase', 'brik', 'bidon', 'iqf', 'nacional', 'importacion', 'origen',
  'fresco', 'fresca', 'frescos', 'frescas', 'aprox', 'formato', 'blister', 'cubo', 'cubeta', 'estuche', 'rollo', 'sobre',
]);

/**
 * Vocabulario culinario habitual en cartas que NO son ingredientes: evita que la tolerancia a erratas
 * convierta, por ejemplo, "pulpa" en "pulpo" o "brasa" en "grasa".
 */
export const CULINARY_WORDS = new Set([
  'pulpa', 'crema', 'cremoso', 'cremosa', 'salsa', 'frito', 'frita', 'fritos', 'fritas', 'asado', 'asada', 'asados', 'asadas',
  'brasa', 'plancha', 'parrilla', 'horno', 'guiso', 'guisado', 'guisada', 'estofado', 'estofada', 'cocido', 'cocida', 'confitado',
  'confitada', 'tartar', 'tataki', 'carpaccio', 'ensalada', 'sopa', 'pure', 'tosta', 'tabla', 'tapa', 'bocadillo', 'bocata',
  'hamburguesa', 'pizza', 'punto', 'mix', 'fina', 'fino', 'gratinado', 'gratinada', 'relleno', 'rellena', 'rellenos', 'rellenas',
  'rebozado', 'rebozada', 'crujiente', 'crujientes', 'meloso', 'melosa', 'tierno', 'tierna', 'dulce', 'salado', 'salada',
  'picante', 'agridulce', 'ahumado', 'ahumada', 'marinado', 'marinada', 'escabeche', 'escabechado', 'emulsion', 'espuma',
  'reduccion', 'glaseado', 'glaseada', 'laminado', 'laminada', 'lascas', 'virutas', 'dados', 'taco', 'tacos', 'juliana',
  'brunoise', 'lagrima', 'lagrimas', 'bravas', 'brava', 'alioli', 'romana', 'andaluza', 'gallega', 'vizcaina', 'marinera',
  'ajillo', 'pilpil', 'riojana', 'bilbaina', 'madrilena', 'asturiana', 'catalana', 'valenciana', 'provenzal', 'napolitana',
  'boloñesa', 'bolonesa', 'carbonara', 'pesto', 'mediterraneo', 'mediterranea', 'huerta', 'jardinera', 'guarnicion', 'sal',
  'vapor', 'papillote', 'wok', 'salteado', 'salteada', 'salteados', 'pochado', 'pochada', 'caramelizado', 'caramelizada',
  'tostado', 'tostada', 'tostadas', 'frio', 'fria', 'caliente', 'templado', 'templada', 'natural', 'entero', 'pelado', 'pelada',
  'limpio', 'limpia', 'deshuesado', 'deshuesada', 'lomo', 'lomos', 'filete', 'filetes', 'medallon', 'medallones', 'taco',
  'costra', 'crocante', 'pasta', 'masa', 'bola', 'bolas', 'barra', 'copa', 'vaso', 'jarra', 'cana', 'tercio', 'botellin',
  'chupito', 'pinta', 'doble', 'triple', 'grande', 'pequeno', 'pequena', 'mini', 'maxi', 'suave', 'intenso', 'intensa',
]);

/**
 * Abreviaturas de proveedor y expresiones fijas de carta (se aplican sobre el texto ya normalizado).
 * Las expresiones fijas llevan palabras que en otro contexto son relleno ("de la abuela") y aquí identifican el plato.
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\btarta de la abuela\b/g, 'tarta de galletas y chocolate'],
  [/\ba o v e\b/g, 'aove'],
  [/\bac(?:eit)?\s+(?:de\s+)?ol(?:iva)?\s+v\s*e\b/g, 'aceite de oliva virgen extra'],
  [/\boliva\s+v\s+e\b/g, 'oliva virgen extra'],
  [/\boliva\s+ve\b/g, 'oliva virgen extra'],
  [/\bvirg\b/g, 'virgen'],
  [/\bv\s+extra\b/g, 'virgen extra'],
];

/** Singular aproximado en español (aplicado igual al índice y a las consultas, así basta con que sea consistente). */
export function singular(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (word.endsWith('ces') && word.length > 4) {
    const prev = word[word.length - 4];
    if ('aeiou'.includes(prev)) return word.slice(0, -3) + 'z';
    return word.slice(0, -1);
  }
  if (word.endsWith('es') && word.length > 4) {
    const prev = word[word.length - 3];
    if ('rnldjy'.includes(prev)) return word.slice(0, -2);
    return word.slice(0, -1);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Texto normalizado (minúsculas, sin tildes ni signos) con abreviaturas de proveedor expandidas. */
export function normalizeKb(text: string): string {
  let s = normalizeText(text);
  for (const [re, rep] of ABBREVIATIONS) s = s.replace(re, rep);
  return s;
}

export interface Token {
  /** Forma singular normalizada. */
  t: string;
  /** Palabra normalizada original (antes de singularizar). */
  raw: string;
  /** Índice de la palabra en el texto normalizado (incluidas palabras vacías). */
  pos: number;
}

/** Palabras normalizadas (incluidas las vacías), para detectar conectores ("con", "sobre", "sin"…). */
export function rawWords(text: string): string[] {
  const s = normalizeKb(text);
  return s ? s.split(' ').filter(Boolean) : [];
}

/** Tokens de contenido: sin palabras vacías ni formatos/números, singularizados. */
export function contentTokens(text: string, opts: { dropFormats?: boolean } = {}): Token[] {
  const words = rawWords(text);
  const out: Token[] = [];
  words.forEach((w, pos) => {
    if (STOPWORDS.has(w)) return;
    if (/^\d+([.,]\d+)?[a-z]*$/.test(w)) return; // cantidades y formatos pegados: 500g, 6x1, 70
    if (w.length === 1) return;
    if (opts.dropFormats && FORMAT_WORDS.has(w)) return;
    out.push({ t: singular(w), raw: w, pos });
  });
  return out;
}

/** Clave canónica de una frase (tokens de contenido unidos por espacio). */
export function phraseKey(text: string): string {
  return contentTokens(text)
    .map((x) => x.t)
    .join(' ');
}

/** Distancia de Damerau-Levenshtein (transposiciones adyacentes) con corte temprano. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = new Array<number>(m + 1).fill(0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = new Array<number>(m + 1).fill(0);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

/** Errores tolerados según la longitud de la palabra (OCR y erratas de carta). */
export function allowedTypos(len: number): number {
  if (len >= 9) return 2;
  if (len >= 5) return 1;
  return 0;
}

/** ¿Son dos tokens "la misma palabra" admitiendo erratas (misma inicial)? */
export function fuzzyTokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (a[0] !== b[0]) return false;
  const max = allowedTypos(Math.min(a.length, b.length));
  if (max === 0) return false;
  return editDistance(a, b, max) <= max;
}

/** Primera letra en mayúscula (nombres en "sentence case"). */
export function sentenceCase(s: string): string {
  const t = s.trim();
  return t ? t[0].toLocaleUpperCase('es-ES') + t.slice(1) : t;
}
