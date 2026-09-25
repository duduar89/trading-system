import {
  ABBREVIATIONS,
  CUTS,
  DE_HEADS,
  DE_SOURCES,
  DISPLAY_FORMS,
  DISPLAY_PREFIX,
  FEMININE_ADJECTIVES,
  FEMININE_NOUNS,
  FOOD_NOUNS,
  GROUP_DEFAULTS,
  GROUP_MEMBERS,
  GROUP_SEVERITY,
  HERB_FORMS,
  HERBS_SPICES,
  HYPERNYMS,
  MASCULINE_A_NOUNS,
  NOISE_WORDS,
  NOUN_WHEN_FIRST,
  PACK_WORDS,
  PHRASES,
  PLURAL_OVERRIDES,
  PROPER_NOUNS,
  SINGULAR_EXCEPTIONS,
  STOPWORDS,
  SYNONYMS,
  TRANSFORMS,
  VARIETIES,
  WEAK_EXPANSIONS,
  WEAK_QUALIFIERS,
  WEAK_SYNONYMS,
  type ConflictGroup,
} from './lexicon';

/**
 * Emparejamiento difuso de nombres de ingredientes (receta ⇄ producto de factura).
 * Debe tolerar: mayúsculas, tildes, plurales, abreviaturas de proveedor ("TOM. PERA", "ACEIT. OLIVA V.E."),
 * formatos y marcas ("CAJA 6KG", "HACENDADO"), calibres ("CAT I", "T-3"), orden de palabras
 * y sinónimos culinarios ES (patata/papa, gamba/langostino NO son sinónimos, nata/crema de leche, AOVE = aceite de oliva virgen extra…).
 *
 * Cómo puntúa `similarity`:
 *  1. Cada nombre se analiza (y se cachea): tokens canónicos con peso (sustantivo principal ×2, calificativos débiles 0,35),
 *     grupos semánticos (especie, base del aceite/harina, color, curación…) y transformaciones (frito, rallado…).
 *  2. Se emparejan tokens con igualdad exacta, sinónimos débiles, abreviaturas no registradas (prefijo) o erratas
 *     (Jaro-Winkler ≥ 0,92 sólo si alguna de las dos palabras no es un término culinario conocido).
 *  3. Base = Dice ponderado. Si todos los tokens fuertes del nombre más genérico están en el otro → bonus de inclusión
 *     ("Tomate" ⇄ "TOMATE PERA CAJA 6KG").
 *  4. Topes y penalizaciones: sustantivos principales distintos, contradicciones (ternera/cerdo, oliva/girasol),
 *     transformaciones sólo en un lado, valor no habitual ("Harina" ⇄ "HARINA MAIZ"), fresco/congelado, dulce/picante.
 */

/** A partir de este score se vincula automáticamente. */
export const AUTO_LINK_THRESHOLD = 0.82;
/** Entre SUGGEST y AUTO se sugiere al usuario. */
export const SUGGEST_THRESHOLD = 0.55;

// ───────────────────────────── Normalización ─────────────────────────────

const KNOWN = new Set<string>([
  ...FOOD_NOUNS,
  ...VARIETIES,
  ...WEAK_QUALIFIERS,
  ...TRANSFORMS,
  ...CUTS,
  ...Object.keys(HYPERNYMS),
  ...Object.values(SYNONYMS),
  ...Object.keys(GROUP_MEMBERS),
  'te',
]);

const HYPONYMS = new Set<string>(Object.values(HYPERNYMS).flatMap((set) => [...set]));

/** Índice de sustantivos conocidos por inicial, para corregir erratas de OCR ("TOMATF" → tomate). */
const NOUN_INDEX = new Map<string, string[]>();
for (const w of new Set([...FOOD_NOUNS, ...CUTS, ...HYPONYMS])) {
  const list = NOUN_INDEX.get(w[0]) ?? [];
  list.push(w);
  NOUN_INDEX.set(w[0], list);
}

const WEAK_SYN = new Map<string, Set<string>>();
for (const [a, b] of WEAK_SYNONYMS) {
  if (!WEAK_SYN.has(a)) WEAK_SYN.set(a, new Set());
  if (!WEAK_SYN.has(b)) WEAK_SYN.set(b, new Set());
  WEAK_SYN.get(a)?.add(b);
  WEAK_SYN.get(b)?.add(a);
}

const CON_JOIN = new Set(['hueso', 'piel', 'cascara', 'espina']);
const SLASH_SIN: Record<string, string> = { h: 'hueso', p: 'piel', e: 'espinas', g: 'gluten', l: 'lactosa', s: 'sal', c: 'cascara', a: 'azucar' };
const SLASH_CON: Record<string, string> = { h: 'hueso', p: 'piel', c: 'cascara' };
const UNIT_ALT =
  'kgs?|kilos?|kilogramos?|k|grs?|grm|gramos?|g|mg|l|lts?|ltr|litros?|cl|ml|cc|uds?|u|un|unds?|unid(?:ades)?|pzs?|piezas?|dz|docenas?';
/** En una sola pasada: porcentajes, grados, multipacks ("6x1l"), cantidad + unidad ("500 gr") y fracciones/calibres ("1/2", "8/10"). */
const RE_NUMERIC_NOISE = new RegExp(
  `\\d+(?:[.,]\\d+)?\\s*(?:[%º°ª]|[x*×]\\s*\\d+(?:[.,]\\d+)?(?:\\s*(?:${UNIT_ALT})(?![a-z]))?|(?:${UNIT_ALT})(?![a-z]))|\\d+\\s*[/-]\\s*\\d+`,
  'g',
);

function basicNormalize(s: string): string {
  const lower = s.toLowerCase();
  // Vía rápida: el texto de facturas suele ser ASCII puro y no necesita descomposición Unicode
  if (/^[\x20-\x7e]*$/.test(lower)) return lower;
  return lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** minúsculas, sin tildes ni signos, espacios colapsados. */
export function normalizeText(s: string): string {
  if (!s) return '';
  return basicNormalize(String(s))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** OCR: "P0LLO" → "pollo", "LECHE 5EMI"… sólo si el resultado es una palabra culinaria conocida. */
function fixOcrToken(tok: string): string {
  const letters = tok.replace(/[^a-z]/g, '').length;
  if (letters < 3 || /[2-46-9]/.test(tok) || tok.replace(/[a-z]/g, '').length > 2) return tok;
  for (const one of ['l', 'i']) {
    const fixed = tok.replace(/0/g, 'o').replace(/5/g, 's').replace(/1/g, one);
    if (KNOWN.has(fixed) || KNOWN.has(singularize(fixed))) return fixed;
  }
  return tok;
}

/**
 * Corrige una palabra desconocida si es casi idéntica a un único sustantivo culinario
 * (misma inicial, ±1 letra, Jaro-Winkler ≥ 0,93). Las palabras conocidas no se tocan.
 */
function correctTypo(t: string): string {
  if (t.length < 5 || KNOWN.has(t)) return t;
  let best = '';
  let bestScore = 0;
  let tie = false;
  for (const w of NOUN_INDEX.get(t[0]) ?? []) {
    if (Math.abs(w.length - t.length) > 1) continue;
    const s = jaroWinkler(t, w);
    if (s > bestScore) {
      best = w;
      bestScore = s;
      tie = false;
    } else if (s === bestScore) tie = true;
  }
  return bestScore >= 0.93 && !tie ? best : t;
}

/** Limpia una descripción: tildes, siglas con puntos, formatos, cantidades, códigos y signos. Conserva palabras vacías. */
function preprocess(raw: string): string {
  let s = ` ${basicNormalize(raw)} `;
  const hasDigit = /\d/.test(s);
  if (hasDigit) s = s.replace(/\b[a-z]*[015][a-z]*(?:[015][a-z]*)?\b/g, (t) => (/[a-z]{2}/.test(t) ? fixOcrToken(t) : t));
  if (s.includes('/')) {
    s = s.replace(/\bs\s*\/\s*([hpeglsca])\b/g, (_m, c: string) => ` sin ${SLASH_SIN[c]} `);
    s = s.replace(/\bc\s*\/\s*([hpc])\b/g, (_m, c: string) => ` con ${SLASH_CON[c]} `);
  }
  if (s.includes('v')) {
    s = s.replace(/\bvir(?:g(?:en)?)?\.?\s*ext(?:ra)?\b\.?/g, ' virgen extra ');
    s = s.replace(/\bv\.?\s*extra\b/g, ' virgen extra ');
  }
  // Siglas con puntos: "V.E." → "ve", "A.O.V.E." → "aove", "D.O.P." → "dop"
  if (s.includes('.')) s = s.replace(/\b(?:[a-z]\.\s?){2,}(?![a-z])/g, (m) => ` ${m.replace(/[.\s]/g, '')} `);
  if (hasDigit) s = s.replace(RE_NUMERIC_NOISE, ' ').replace(/[a-z]*\d[a-z\d]*/g, ' ');
  return s.replace(/[^a-z]+/g, ' ').trim();
}

function singularize(w: string): string {
  if (w.length <= 3) return w;
  const o = PLURAL_OVERRIDES[w];
  if (o) return o;
  if (!w.endsWith('s') || SINGULAR_EXCEPTIONS.has(w) || KNOWN.has(w)) return w;
  if (/[aeiou]ces$/.test(w)) return `${w.slice(0, -3)}z`;
  if (/[aeiou][lnrdjy]es$/.test(w)) return w.slice(0, -2);
  return w.slice(0, -1);
}

/** Expande abreviaturas de proveedor con contexto ("AC. OLIVA", "V.E.", "VIRG. EXT."). */
function expandAbbreviations(ws: string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const next = ws[i + 1];
    const prev = words[words.length - 1];
    if (w === 've' || (w === 'v' && next === 'e')) {
      words.push('virgen', 'extra');
      if (w === 'v') i++;
    } else if (w === 'ac' && next && /^(?:oliv|oliva|ol|gir|giras|girasol|orujo)$/.test(next)) {
      words.push('aceite');
    } else if (w === 'ol' && prev === 'aceite') {
      words.push('oliva');
    } else if ((w === 'ext' || w === 'ex' || w === 'extr') && prev === 'virgen') {
      words.push('extra');
    } else {
      // Una palabra culinaria real nunca se reinterpreta como abreviatura de otra
      const ab = ABBREVIATIONS[w];
      if (ab && !(KNOWN.has(w) && ab.length === 1 && ab[0] !== w)) words.push(...ab);
      else words.push(w);
    }
  }
  return words;
}

function isDropped(w: string, prev: string | undefined): boolean {
  if (PACK_WORDS.has(w) || NOISE_WORDS.has(w)) return !(w === 'extra' && prev === 'virgen');
  if (w.length > 3 && w.endsWith('s')) {
    const sg = singularize(w);
    if (sg !== w && !KNOWN.has(sg) && (PACK_WORDS.has(sg) || NOISE_WORDS.has(sg))) return true;
  }
  if (w === 'extra') return prev !== 'virgen';
  if (w.length === 1) return true;
  if (w.length === 2 && !KNOWN.has(w) && !STOPWORDS.has(w)) return true;
  return false;
}

// ───────────────────────────── Análisis (cacheado) ─────────────────────────────

type TokenKind = 'noun' | 'weak' | 'transform';

interface Analyzed {
  tokens: string[];
  weights: number[];
  kinds: TokenKind[];
  /** Tokens que deben estar en el otro nombre para considerar que lo contiene (principal + no débiles). */
  strong: boolean[];
  head: number;
  total: number;
  key: string;
  groups: Map<ConflictGroup, Set<string>>;
  weakExpansion: boolean;
  tokenSet: Set<string>;
  /** Todos los tokens son términos conocidos sin sinónimos débiles: sólo pueden coincidir por igualdad exacta. */
  exactOnly: boolean;
  /** Tokens que dicen "de qué" es el producto (caldo *de pescado*): sustantivos culinarios que no son el principal ni cortes. */
  specifier: boolean[];
  hasCut: boolean;
  headSourceLike: boolean;
  /** El principal es una hierba o especia (se compran secas/molidas). */
  herb: boolean;
}

/** Máximo de tokens significativos por nombre (las descripciones reales tienen menos de 10). */
const MAX_TOKENS = 24;
const ANALYSIS_CACHE_MAX = 20000;
const analysisCache = new Map<string, Analyzed>();
const SIM_CACHE_MAX = 50000;
const simCache = new Map<string, number>();

function cacheSet<V>(cache: Map<string, V>, max: number, key: string, value: V): void {
  if (cache.size >= max) {
    // Descarta el 10 % más antiguo (orden de inserción)
    let n = Math.ceil(max / 10);
    for (const k of cache.keys()) {
      cache.delete(k);
      if (--n <= 0) break;
    }
  }
  cache.set(key, value);
}

function tokenKind(t: string, index: number): TokenKind {
  if (index === 0 && (NOUN_WHEN_FIRST.has(t) || FOOD_NOUNS.has(t))) return 'noun';
  if (WEAK_QUALIFIERS.has(t)) return 'weak';
  // Variantes dietéticas ("sin lactosa", "sin gluten", "sin alcohol") cambian el producto como una transformación
  if (TRANSFORMS.has(t) || /^sin[a-z]{3,}$/.test(t)) return 'transform';
  return 'noun';
}

type Family = 'carne' | 'ave' | 'pescado' | 'marisco' | 'vegetal';

/** Familia de un sustantivo genérico de clase. */
const GENERIC_FAMILY: Record<string, Family> = {
  pescado: 'pescado',
  marisco: 'marisco',
  carne: 'carne',
  embutido: 'carne',
  charcuteria: 'carne',
  ave: 'ave',
  verdura: 'vegetal',
  hortaliza: 'vegetal',
  fruta: 'vegetal',
  fruto: 'vegetal',
  especia: 'vegetal',
  hierba: 'vegetal',
};
const SHELLFISH = new Set(['pulpo', 'calamar', 'sepia', 'gamba', 'langostino', 'cigala', 'bogavante', 'langosta', 'mejillon', 'almeja', 'vieira']);
const POULTRY = new Set(['pollo', 'pavo', 'pato', 'codorniz', 'perdiz']);
const MEAT = new Set(['bovino', 'porcino', 'ovino', 'caprino', 'conejo', 'caza', 'caballo', 'bufalo']);

/** Familia animal de un token concreto (por su especie), o undefined si no es animal. */
function animalFamily(t: string): Family | undefined {
  const cls = (GROUP_MEMBERS[t] ?? []).find(([g]) => g === 'especie')?.[1];
  if (!cls) return undefined;
  if (MEAT.has(cls)) return 'carne';
  if (POULTRY.has(cls)) return 'ave';
  return SHELLFISH.has(cls) ? 'marisco' : 'pescado';
}

/** ¿Pueden referirse a lo mismo un genérico y un concreto? ("pescado" ~ "merluza", "carne" ~ "pollo", "verdura" ~ "calabaza") */
function familyCompatible(x: string, y: string): boolean {
  const check = (generic: string, other: string) => {
    const f = GENERIC_FAMILY[generic];
    if (!f) return false;
    const af = animalFamily(other);
    if (f === 'vegetal') return !af && !GENERIC_FAMILY[other];
    return af === f || (f === 'carne' && af === 'ave');
  };
  return check(x, y) || check(y, x);
}

function analyze(name: string): Analyzed {
  const cached = analysisCache.get(name);
  if (cached) return cached;

  const words = expandAbbreviations(preprocess(name).split(' ').filter(Boolean));
  words.push(...percentQualifiers(name, words));
  // 1) Palabras vacías, ruido y "sin/con + X"
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'sin' || w === 'con') {
      const nxt = words[i + 1];
      if (nxt && !STOPWORDS.has(nxt) && !isDropped(nxt, w)) {
        const sg = singularize(nxt);
        if (w === 'sin' || CON_JOIN.has(sg)) {
          kept.push(`${w}${sg}`);
          i++;
        }
      }
      continue;
    }
    if (STOPWORDS.has(w) || isDropped(w, kept[kept.length - 1])) continue;
    kept.push(w);
  }
  // 2) Singular + sinónimos
  const sing = kept.map((w) => {
    const s = singularize(w);
    return correctTypo(SYNONYMS[s] ?? SYNONYMS[w] ?? s);
  });
  // 3) Frases de dos palabras y expansiones débiles
  const phrased: string[] = [];
  let weakExpansion = false;
  for (let i = 0; i < sing.length; i++) {
    const bigram = i + 1 < sing.length ? PHRASES[`${sing[i]} ${sing[i + 1]}`] : undefined;
    if (bigram) {
      phrased.push(...bigram);
      i++;
      continue;
    }
    const weak = WEAK_EXPANSIONS[sing[i]];
    if (weak) {
      phrased.push(...weak);
      weakExpansion = true;
      continue;
    }
    phrased.push(sing[i]);
  }
  // 4) Género de adjetivos y duplicados
  const tokens: string[] = [];
  phrased.forEach((t, i) => {
    let v = t;
    if (!(i === 0 && (NOUN_WHEN_FIRST.has(t) || FOOD_NOUNS.has(t)))) v = FEMININE_ADJECTIVES[t] ?? t;
    if (tokens.length < MAX_TOKENS && !tokens.includes(v)) tokens.push(v);
  });

  const kinds = tokens.map((t, i) => tokenKind(t, i));
  // Hiperónimos: "queso" pierde peso si va el tipo ("Queso parmesano" ≈ "PARMESANO")
  const hyperWeak = tokens.map((t) => {
    const hypo = HYPERNYMS[t];
    return !!hypo && tokens.some((u) => u !== t && hypo.has(u));
  });
  // Sustantivo principal: primer término culinario conocido; si no, primera palabra que no sea variedad.
  // (un tipo concreto —parmesano, piquillo— sólo manda si va primero o acompaña a su genérico: "pisto manchego" ≠ queso)
  const hypernymPresent = hyperWeak.some(Boolean);
  const knownNoun = (t: string, i: number) => FOOD_NOUNS.has(t) || CUTS.has(t) || (HYPONYMS.has(t) && (i === 0 || hypernymPresent));
  let head = tokens.length && NOUN_WHEN_FIRST.has(tokens[0]) ? 0 : -1;
  if (head < 0) head = tokens.findIndex((t, i) => kinds[i] === 'noun' && !hyperWeak[i] && knownNoun(t, i));
  if (head < 0) head = tokens.findIndex((t, i) => kinds[i] === 'noun' && !hyperWeak[i] && !VARIETIES.has(t));
  if (head < 0) head = tokens.findIndex((_t, i) => kinds[i] === 'noun' && !hyperWeak[i]);
  if (head < 0) head = kinds.findIndex((k) => k === 'transform');
  if (head < 0 && tokens.length) head = 0;

  const weights = tokens.map((_t, i) => {
    if (i === head) return 2;
    if (hyperWeak[i]) return 0.3;
    return kinds[i] === 'weak' ? 0.35 : 1;
  });
  const strong = tokens.map((_t, i) => i === head || (kinds[i] !== 'weak' && !hyperWeak[i]));
  const groups = new Map<ConflictGroup, Set<string>>();
  for (const t of tokens) {
    for (const [g, cls] of GROUP_MEMBERS[t] ?? []) {
      let set = groups.get(g);
      if (!set) groups.set(g, (set = new Set()));
      set.add(cls);
    }
  }
  const result: Analyzed = {
    tokens,
    weights,
    kinds,
    strong,
    head,
    total: weights.reduce((a, b) => a + b, 0),
    key: tokens.join(' '),
    groups,
    weakExpansion,
    tokenSet: new Set(tokens),
    exactOnly: tokens.every((t) => KNOWN.has(t) && !WEAK_SYN.has(t)),
    specifier: tokens.map((t, i) => i !== head && strong[i] && FOOD_NOUNS.has(t) && !CUTS.has(t)),
    hasCut: tokens.some((t) => CUTS.has(t)),
    headSourceLike: head >= 0 && isSourceLike(tokens[head]),
    herb: head >= 0 && HERBS_SPICES.has(tokens[head]),
  };
  cacheSet(analysisCache, ANALYSIS_CACHE_MAX, name, result);
  return result;
}

/**
 * Porcentajes que definen el producto y que el preprocesado descarta:
 * "NATA 35%" es nata para montar (≥ 30 % MG) y "NATA 18%" para cocinar; "CHOCOLATE 70%" es chocolate negro.
 */
function percentQualifiers(raw: string, words: string[]): string[] {
  if (!raw.includes('%')) return [];
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(raw);
  if (!m) return [];
  const pct = Number(m[1].replace(',', '.'));
  if (words.includes('nata') && !words.some((w) => w === 'montar' || w === 'cocinar' || w === 'cocina')) {
    if (pct >= 30) return ['montar'];
    if (pct <= 22) return ['cocinar'];
  }
  if (words.includes('chocolate') && pct >= 50 && !words.some((w) => /^(?:negro|negra|blanco|blanca|leche)$/.test(w))) return ['negro'];
  return [];
}

/** Tokens significativos: sin stopwords, formatos, cantidades ni marcas; singularizados y con sinónimos canónicos. */
export function tokenize(name: string): string[] {
  if (!name) return [];
  return [...analyze(String(name)).tokens];
}

/** Clave de búsqueda estable para guardar en Product.searchKey. */
export function toSearchKey(name: string): string {
  if (!name) return '';
  const key = analyze(String(name)).key;
  return key || normalizeText(name);
}

// ───────────────────────────── Similitud ─────────────────────────────

/** Jaro-Winkler clásico (prefijo común hasta 4, escala 0,1). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Uint8Array(la);
  const mb = new Uint8Array(lb);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(lb - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (mb[j] || a.charCodeAt(i) !== b.charCodeAt(j)) continue;
      ma[i] = 1;
      mb[j] = 1;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a.charCodeAt(i) !== b.charCodeAt(k)) t++;
    k++;
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < la && prefix < lb && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Similitud entre dos tokens canónicos (0 si no son equiparables). */
function tokenSim(t: string, u: string): number {
  if (t === u) return 1;
  if (WEAK_SYN.get(t)?.has(u)) return 0.8;
  const kt = KNOWN.has(t);
  const ku = KNOWN.has(u);
  // Dos términos culinarios conocidos y distintos nunca son "erratas" el uno del otro (cebolla ≠ cebolleta).
  if (kt && ku) return 0;
  const key = t < u ? `${t}\u0001${u}` : `${u}\u0001${t}`;
  const cached = simCache.get(key);
  if (cached !== undefined) return cached;
  let v = 0;
  const [s, l, sKnown] = t.length <= u.length ? [t, u, kt] : [u, t, ku];
  if (s.length >= 4 && !sKnown && l.startsWith(s) && s.length / l.length >= 0.45) v = 0.86;
  else if (s.length >= 5 && l.length - s.length <= 2 && s.charCodeAt(0) === l.charCodeAt(0)) {
    const jw = jaroWinkler(s, l);
    if (jw >= 0.92) v = jw;
  }
  cacheSet(simCache, SIM_CACHE_MAX, key, v);
  return v;
}

const MIN_TOKEN_SIM = 0.8;
const STRONG_SIM = 0.85;
const HEAD_MISMATCH_CAP = 0.5;
const CUT_OF_SOURCE_CAP = 0.72;
const WEAK_SYNONYM_CAP = 0.8;
const WEAK_EXPANSION_CAP = 0.78;
const TRANSFORM_PENALTY = 0.12;
const TRANSFORM_PENALTY_EXTRA = 0.06;
const NON_DEFAULT_PENALTY = 0.16;

function isSourceLike(t: string): boolean {
  return DE_SOURCES.has(t) || (GROUP_MEMBERS[t] ?? []).some(([g]) => g === 'especie');
}

/** Tope por contradicciones duras (especie, base, color…) entre dos nombres analizados; 1 si no las hay. */
function conflictCap(A: Analyzed, B: Analyzed): number {
  let cap = 1;
  for (const [g, va] of A.groups) {
    const vb = B.groups.get(g);
    const sev = GROUP_SEVERITY[g];
    if (!vb || sev.cap === undefined) continue;
    let common = false;
    for (const v of va) if (vb.has(v)) common = true;
    if (!common) cap = Math.min(cap, sev.cap);
  }
  return cap;
}

// Búferes reutilizables (la función no es reentrante): evitan reservar memoria en cada comparación.
const PAIR_I = new Int16Array(MAX_TOKENS * MAX_TOKENS);
const PAIR_J = new Int16Array(MAX_TOKENS * MAX_TOKENS);
const PAIR_S = new Float64Array(MAX_TOKENS * MAX_TOKENS);
const MATCH_A = new Int16Array(MAX_TOKENS);
const MATCH_B = new Int16Array(MAX_TOKENS);
const SIM_A = new Float64Array(MAX_TOKENS);

function similarityAnalyzed(A: Analyzed, B: Analyzed): number {
  const na = A.tokens.length;
  const nb = B.tokens.length;
  if (!na || !nb) return 0;
  if (A.key === B.key && A.weakExpansion === B.weakExpansion) return 1;
  // Descarte rápido: sin tokens comunes y sin posibilidad de erratas/sinónimos → 0
  if (A.exactOnly && B.exactOnly) {
    let shared = false;
    const small = na <= nb ? A.tokens : B.tokens;
    const big = na <= nb ? B.tokenSet : A.tokenSet;
    for (let k = 0; k < small.length && !shared; k++) shared = big.has(small[k]);
    if (!shared) return 0;
  }

  // Emparejamiento voraz de tokens por similitud descendente (a igualdad, primero los sustantivos principales)
  let np = 0;
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const sim = tokenSim(A.tokens[i], B.tokens[j]);
      if (sim < MIN_TOKEN_SIM) continue;
      // Inserción ordenada (listas muy cortas)
      const prio = (i === A.head ? 1 : 0) + (j === B.head ? 1 : 0);
      let k = np++;
      while (k > 0) {
        const ps = PAIR_S[k - 1];
        const pprio = (PAIR_I[k - 1] === A.head ? 1 : 0) + (PAIR_J[k - 1] === B.head ? 1 : 0);
        if (ps > sim || (ps === sim && pprio >= prio)) break;
        PAIR_S[k] = ps;
        PAIR_I[k] = PAIR_I[k - 1];
        PAIR_J[k] = PAIR_J[k - 1];
        k--;
      }
      PAIR_S[k] = sim;
      PAIR_I[k] = i;
      PAIR_J[k] = j;
    }
  }
  if (!np) return 0;
  MATCH_A.fill(-1, 0, na);
  MATCH_B.fill(-1, 0, nb);
  let usedWeakSynonym = false;
  for (let k = 0; k < np; k++) {
    const i = PAIR_I[k];
    const j = PAIR_J[k];
    if (MATCH_A[i] >= 0 || MATCH_B[j] >= 0) continue;
    MATCH_A[i] = j;
    MATCH_B[j] = i;
    SIM_A[i] = PAIR_S[k];
    if (PAIR_S[k] < STRONG_SIM) usedWeakSynonym = true;
  }

  let matchedA = 0;
  let matchedB = 0;
  let minStrongSim = 1;
  let strongAllA = true;
  let strongAllB = true;
  for (let i = 0; i < na; i++) {
    const j = MATCH_A[i];
    const strong = A.strong[i];
    if (j >= 0) {
      matchedA += A.weights[i] * SIM_A[i];
      matchedB += B.weights[j] * SIM_A[i];
      if (strong) {
        if (SIM_A[i] < minStrongSim) minStrongSim = SIM_A[i];
        if (SIM_A[i] < STRONG_SIM) strongAllA = false;
      }
    } else if (strong) strongAllA = false;
  }
  for (let j = 0; j < nb; j++) {
    if (!B.strong[j]) continue;
    const i = MATCH_B[j];
    if (i < 0 || SIM_A[i] < STRONG_SIM) strongAllB = false;
    else if (SIM_A[i] < minStrongSim) minStrongSim = SIM_A[i];
  }

  const covA = matchedA / A.total;
  const covB = matchedB / B.total;
  let score = (matchedA + matchedB) / (A.total + B.total);
  if (strongAllA || strongAllB) {
    // Si ambos se contienen, sólo difieren en calificativos débiles: manda la menor cobertura.
    const otherCov = strongAllA && strongAllB ? Math.min(covA, covB) : strongAllA ? covB : covA;
    score = Math.max(score, (0.8 + 0.2 * otherCov) * Math.sqrt(minStrongSim));
  }

  // Sustantivo principal
  const headAMatched = A.head >= 0 && MATCH_A[A.head] >= 0;
  const headBMatched = B.head >= 0 && MATCH_B[B.head] >= 0;
  if (!headAMatched || !headBMatched) {
    let cap = HEAD_MISMATCH_CAP;
    if (strongAllA !== strongAllB) {
      const S = strongAllA ? A : B;
      const L = strongAllA ? B : A;
      const sHeadMatched = strongAllA ? headAMatched : headBMatched;
      if (sHeadMatched && L.head >= 0 && CUTS.has(L.tokens[L.head]) && S.headSourceLike) cap = CUT_OF_SOURCE_CAP;
    }
    score = Math.min(score, cap);
  }

  // Mismo sustantivo principal pero distinto "de qué" ("caldo de pescado" ⇄ "caldo de pollo", "zumo de naranja" ⇄ "zumo de limón")
  if (headAMatched && headBMatched && score > HEAD_MISMATCH_CAP && specifierConflict(A, MATCH_A, B, MATCH_B)) score = HEAD_MISMATCH_CAP;

  // Una pieza/corte del animal frente al animal ("Pollo" ⇄ "POLLO PECHUGA", "Merluza" ⇄ "LOMO MERLUZA"): sugerencia.
  if (score > CUT_OF_SOURCE_CAP && (cutOnlyIn(A, MATCH_A, B) || cutOnlyIn(B, MATCH_B, A))) score = CUT_OF_SOURCE_CAP;

  // Contradicciones y valores no habituales
  let penalty = 0;
  for (const [g, va] of A.groups) {
    const vb = B.groups.get(g);
    if (vb) {
      let common = false;
      for (const v of va) if (vb.has(v)) common = true;
      if (!common) {
        const sev = GROUP_SEVERITY[g];
        if (sev.cap !== undefined && score > sev.cap) score = sev.cap;
        if (sev.penalty) penalty += sev.penalty;
      }
    } else penalty += nonDefaultPenalty(g, va, B);
  }
  for (const [g, vb] of B.groups) if (!A.groups.has(g)) penalty += nonDefaultPenalty(g, vb, A);

  // Transformaciones presentes sólo en un lado (tomate ≠ tomate frito)
  const transforms = unmatchedTransforms(A, MATCH_A) + unmatchedTransforms(B, MATCH_B);
  if (transforms) penalty += TRANSFORM_PENALTY + TRANSFORM_PENALTY_EXTRA * (transforms - 1);

  score -= penalty;
  if (usedWeakSynonym && score > WEAK_SYNONYM_CAP) score = WEAK_SYNONYM_CAP;
  if (A.weakExpansion !== B.weakExpansion && score > WEAK_EXPANSION_CAP) score = WEAK_EXPANSION_CAP;
  return score < 0 ? 0 : score > 1 ? 1 : score;
}

/** Penalización si un lado indica un valor no habitual y el otro es el genérico ("Harina" ⇄ "HARINA MAIZ"). */
function nonDefaultPenalty(g: ConflictGroup, present: Set<string>, other: Analyzed): number {
  if (other.head < 0 || (g !== 'base' && g !== 'grasa' && g !== 'color')) return 0;
  const def = GROUP_DEFAULTS[other.tokens[other.head]]?.[g];
  return def && !present.has(def) ? NON_DEFAULT_PENALTY : 0;
}

function specifierConflict(A: Analyzed, matchA: Int16Array, B: Analyzed, matchB: Int16Array): boolean {
  let anyA = false;
  let anyB = false;
  for (let i = 0; i < A.tokens.length; i++) if (A.specifier[i] && matchA[i] < 0) anyA = true;
  for (let j = 0; j < B.tokens.length; j++) if (B.specifier[j] && matchB[j] < 0) anyB = true;
  if (!anyA || !anyB) return false;
  for (let i = 0; i < A.tokens.length; i++) {
    if (!A.specifier[i] || matchA[i] >= 0) continue;
    for (let j = 0; j < B.tokens.length; j++) {
      if (B.specifier[j] && matchB[j] < 0 && familyCompatible(A.tokens[i], B.tokens[j])) return false;
    }
  }
  return true;
}

function cutOnlyIn(X: Analyzed, matchX: Int16Array, Y: Analyzed): boolean {
  if (Y.hasCut || !Y.headSourceLike) return false;
  for (let i = 0; i < X.tokens.length; i++) if (matchX[i] < 0 && CUTS.has(X.tokens[i])) return true;
  return false;
}

function unmatchedTransforms(X: Analyzed, matchX: Int16Array): number {
  let n = 0;
  for (let i = 0; i < X.tokens.length; i++) {
    if (X.kinds[i] !== 'transform' || matchX[i] >= 0 || i === X.head) continue;
    if (X.herb && HERB_FORMS.has(X.tokens[i])) continue;
    n++;
  }
  return n;
}

/**
 * Similitud 0–1 entre dos nombres de ingrediente. Combina coincidencia de tokens con tolerancia a erratas
 * (Jaro-Winkler / Damerau), peso extra al sustantivo principal (primer token significativo)
 * y penalización cuando el sustantivo principal difiere ("aceite de oliva" vs "aceitunas" ≠).
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = analyze(String(a));
  const B = analyze(String(b));
  if (!A.tokens.length || !B.tokens.length) {
    const na = normalizeText(a);
    return na && na === normalizeText(b) ? 1 : 0;
  }
  return similarityAnalyzed(A, B);
}

export interface MatchCandidate<T> {
  item: T;
  score: number;
  /** Nombre (principal o alias) que dio la mejor coincidencia. */
  matchedOn: string;
}

/** Ordena `items` por similitud con `query` (usa name y aliases). Sólo devuelve score ≥ minScore. */
export function rankMatches<T extends { name: string; aliases?: string[] }>(query: string, items: T[], limit = 5, minScore = 0.35): MatchCandidate<T>[] {
  if (!query || !items?.length || limit <= 0) return [];
  const Q = analyze(String(query));
  const qNorm = Q.tokens.length ? '' : normalizeText(query);
  const scoreOf = (name: string): number => {
    if (!name) return 0;
    if (!Q.tokens.length) return qNorm && qNorm === normalizeText(name) ? 1 : 0;
    const B = analyze(name);
    return B.tokens.length ? similarityAnalyzed(Q, B) : 0;
  };
  const out: MatchCandidate<T>[] = [];
  for (const item of items) {
    const nameScore = scoreOf(item.name);
    let best = nameScore;
    let on = item.name;
    if (best < 1 && item.aliases) {
      for (const alias of item.aliases) {
        const s = scoreOf(alias);
        if (s > best) {
          best = s;
          on = alias;
          if (s >= 1) break;
        }
      }
      // Un alias genérico ("lomo fino", "vino") no puede saltarse una contradicción del nombre ("Solomillo de ternera" ≠ cerdo)
      if (on !== item.name && best > nameScore && Q.tokens.length && item.name) best = Math.min(best, conflictCap(Q, analyze(item.name)));
    }
    if (best >= minScore) out.push({ item, score: best, matchedOn: on });
  }
  out.sort((x, y) => y.score - x.score);
  return out.length > limit ? out.slice(0, limit) : out;
}

// ───────────────────────────── Nombre limpio ─────────────────────────────

const ADJECTIVES_MASC = new Set(Object.values(FEMININE_ADJECTIVES));

function isAdjective(w: string): boolean {
  if (FOOD_NOUNS.has(w) && !WEAK_QUALIFIERS.has(w) && !TRANSFORMS.has(w)) return false;
  const m = FEMININE_ADJECTIVES[w] ?? w;
  return ADJECTIVES_MASC.has(m) || WEAK_QUALIFIERS.has(m) || TRANSFORMS.has(m) || /^(?:virgen|extra|dulce|picante|verde|suave|natural|integral)$/.test(w);
}

/** "cordero" y "lechal", "cerdo" e "ibérico": misma especie (el segundo precisa al primero). */
function sameSpecies(a: string, b: string): boolean {
  const sp = (t: string) => (GROUP_MEMBERS[t] ?? []).find(([g]) => g === 'especie')?.[1];
  const x = sp(a);
  return !!x && x === sp(b);
}

function isFeminineNoun(w: string): boolean {
  if (FEMININE_NOUNS.has(w)) return true;
  if (MASCULINE_A_NOUNS.has(w)) return false;
  return w.endsWith('a');
}

function agree(adj: string, feminine: boolean): string {
  const masc = FEMININE_ADJECTIVES[adj] ?? adj;
  if (!ADJECTIVES_MASC.has(masc) || !masc.endsWith('o')) return adj;
  return feminine ? `${masc.slice(0, -1)}a` : masc;
}

function display(w: string): string {
  const direct = PROPER_NOUNS[w] ?? DISPLAY_FORMS[w];
  if (direct) return direct;
  // Femenino de un adjetivo con tilde: "iberica" → "ibérica"
  if (w.endsWith('a')) {
    const masc = DISPLAY_FORMS[`${w.slice(0, -1)}o`];
    if (masc) return `${masc.slice(0, -1)}a`;
  }
  return w;
}

/**
 * Nombre genérico limpio a partir de una descripción de factura:
 *  "TOMATE PERA CAT.I CAJA 6KG" → "Tomate pera"; "ACEITE OLIVA V.E. GARRAFA 5L" → "Aceite de oliva virgen extra";
 *  "SOLOMILLO TERNERA NAC. KG" → "Solomillo de ternera". Capitaliza sólo la primera letra.
 * Quita formatos, marcas, calibres, códigos y lotes; expande abreviaturas; pasa a singular; recupera tildes;
 * añade "de" donde es natural y concuerda los adjetivos con el sustantivo.
 */
export function cleanProductName(description: string): string {
  if (!description) return '';
  const words = expandAbbreviations(preprocess(String(description)).split(' ').filter(Boolean));

  // 1) Contenido + palabras vacías (se decide después cuáles conservar)
  type Item = { w: string; stop: boolean };
  const seq: Item[] = [];
  for (const raw of words) {
    const prev = seq.length ? seq[seq.length - 1].w : undefined;
    if (STOPWORDS.has(raw)) {
      seq.push({ w: raw, stop: true });
      continue;
    }
    if (isDropped(raw, prev)) continue;
    const s = singularize(raw);
    const w = SYNONYMS[s] ?? s;
    if (prev === w) continue;
    seq.push({ w, stop: false });
  }
  // Palabras vacías sólo entre dos palabras de contenido
  const content: Item[] = [];
  for (let i = 0; i < seq.length; i++) {
    const it = seq[i];
    if (!it.stop) {
      content.push(it);
      continue;
    }
    const hasPrev = content.length > 0 && !content[content.length - 1].stop;
    const hasPrevStop = content.length > 0 && content[content.length - 1].stop;
    const nextContent = seq.slice(i + 1).find((x) => !x.stop);
    if ((hasPrev || hasPrevStop) && nextContent && !(it.w === 'y' && hasPrevStop)) content.push(it);
  }
  while (content.length && content[content.length - 1].stop) content.pop();
  if (!content.length) return '';

  // 2) Adjetivos iniciales al final ("CONG. GAMBA ROJA" → "gamba roja congelada")
  const lead: Item[] = [];
  // ("dulce de leche", "asado de tira": ahí la primera palabra es el sustantivo)
  const nounFirst = NOUN_WHEN_FIRST.has(content[0].w) && content.length > 1 && content[1].stop;
  while (!nounFirst && content.length > 1 && !content[0].stop && isAdjective(content[0].w) && content.some((x) => !x.stop && !isAdjective(x.w))) {
    lead.push(content.shift() as Item);
    while (content.length && content[0].stop) content.shift();
  }
  content.push(...lead);

  // 2b) Orden de proveedor "especie + corte" → "corte de especie" ("MERLUZA FILETE" → "filete de merluza")
  if (!content[0].stop && DE_SOURCES.has(content[0].w)) {
    for (let k = 1; k < Math.min(content.length, 4); k++) {
      const it = content[k];
      if (it.stop) break;
      if (CUTS.has(it.w) && DE_HEADS.has(it.w)) {
        content.splice(k, 1);
        content.unshift(it);
        break;
      }
      if (!isAdjective(it.w) && !sameSpecies(content[0].w, it.w)) break;
    }
  }

  // 3) Concordancia con el sustantivo principal
  const headWord = nounFirst ? content[0].w : (content.find((x) => !x.stop && !isAdjective(x.w))?.w ?? content[0].w);
  const feminine = isFeminineNoun(headWord);
  const out: string[] = [];
  let lastNoun: string | undefined;
  let adjSinceNoun = 0;
  content.forEach((it, idx) => {
    if (it.stop) {
      out.push(it.w);
      return;
    }
    const prevOut = out[out.length - 1];
    const prevIsStop = prevOut !== undefined && STOPWORDS.has(prevOut);
    let w = it.w;
    const adjective = idx > 0 && isAdjective(w) && w !== headWord;
    if (adjective) {
      w = agree(w, feminine);
      adjSinceNoun++;
    }
    if (!adjective && idx > 0 && !prevIsStop) {
      const prefix = DISPLAY_PREFIX[w];
      if (prefix) out.push(...prefix.split(' '));
      else if (DE_SOURCES.has(w) && lastNoun && DE_HEADS.has(lastNoun) && adjSinceNoun <= 2) out.push('de');
    }
    if (!adjective) {
      lastNoun = w;
      adjSinceNoun = 0;
    }
    out.push(w);
  });

  const text = out.map(display).join(' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
