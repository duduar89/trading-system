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
const RE_MULTIPACK = new RegExp(`\\d+(?:[.,]\\d+)?\\s*[x*×]\\s*\\d+(?:[.,]\\d+)?(?:\\s*(?:${UNIT_ALT})(?![a-z]))?`, 'g');
const RE_QTY_UNIT = new RegExp(`\\d+(?:[.,]\\d+)?\\s*(?:${UNIT_ALT})(?![a-z])`, 'g');

function basicNormalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
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
  if (hasDigit) s = s.replace(/[a-z0-9]*[015][a-z0-9]*/g, (t) => (/[a-z]/.test(t) ? fixOcrToken(t) : t));
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
  if (hasDigit) {
    s = s.replace(/\d+(?:[.,]\d+)?\s*[%º°ª]/g, ' ');
    s = s.replace(/\d+\s*[/-]\s*\d+/g, ' ');
    s = s.replace(RE_MULTIPACK, ' ');
    s = s.replace(RE_QTY_UNIT, ' ');
    s = s.replace(/[a-z]*\d[a-z\d]*/g, ' ');
  }
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
function expandAbbreviations(ws: string[]): { words: string[]; expanded: boolean[] } {
  const words: string[] = [];
  const expanded: boolean[] = [];
  const push = (list: string[], exp: boolean) => {
    for (const w of list) {
      words.push(w);
      expanded.push(exp);
    }
  };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const next = ws[i + 1];
    const prev = words[words.length - 1];
    if (w === 've' || (w === 'v' && next === 'e')) {
      push(['virgen', 'extra'], true);
      if (w === 'v') i++;
      continue;
    }
    if (w === 'ac' && next && /^(?:oliv|oliva|ol|gir|giras|girasol|orujo)$/.test(next)) {
      push(['aceite'], true);
      continue;
    }
    if (w === 'ol' && prev === 'aceite') {
      push(['oliva'], true);
      continue;
    }
    if ((w === 'ext' || w === 'ex' || w === 'extr') && prev === 'virgen') {
      push(['extra'], true);
      continue;
    }
    const ab = ABBREVIATIONS[w];
    if (ab && !(KNOWN.has(w) && ab.length === 1 && ab[0] !== w)) {
      push(ab, ab.length !== 1 || ab[0] !== w);
      continue;
    }
    push([w], false);
  }
  return { words, expanded };
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
}

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
  if (WEAK_QUALIFIERS.has(t) || /^sin[a-z]{3,}$/.test(t)) return 'weak';
  if (TRANSFORMS.has(t)) return 'transform';
  return 'noun';
}

function analyze(name: string): Analyzed {
  const cached = analysisCache.get(name);
  if (cached) return cached;

  const { words } = expandAbbreviations(preprocess(name).split(' ').filter(Boolean));
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
    if (!tokens.includes(v)) tokens.push(v);
  });

  const kinds = tokens.map((t, i) => tokenKind(t, i));
  // Hiperónimos: "queso" pierde peso si va el tipo ("Queso parmesano" ≈ "PARMESANO")
  const hyperWeak = tokens.map((t) => {
    const hypo = HYPERNYMS[t];
    return !!hypo && tokens.some((u) => u !== t && hypo.has(u));
  });
  // Sustantivo principal: primer término culinario conocido; si no, primera palabra que no sea variedad.
  let head = tokens.findIndex((t, i) => kinds[i] === 'noun' && !hyperWeak[i] && (FOOD_NOUNS.has(t) || CUTS.has(t) || HYPONYMS.has(t)));
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
  };
  cacheSet(analysisCache, ANALYSIS_CACHE_MAX, name, result);
  return result;
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

function similarityAnalyzed(A: Analyzed, B: Analyzed): number {
  const na = A.tokens.length;
  const nb = B.tokens.length;
  if (!na || !nb) return 0;
  if (A.key === B.key && A.weakExpansion === B.weakExpansion) return 1;
  // Descarte rápido: sin tokens comunes y sin posibilidad de erratas/sinónimos → 0
  if (A.exactOnly && B.exactOnly) {
    let shared = false;
    const [small, big] = na <= nb ? [A.tokens, B.tokenSet] : [B.tokens, A.tokenSet];
    for (const t of small) {
      if (big.has(t)) {
        shared = true;
        break;
      }
    }
    if (!shared) return 0;
  }

  // Emparejamiento voraz de tokens por similitud descendente
  const cand: { i: number; j: number; s: number }[] = [];
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const s = tokenSim(A.tokens[i], B.tokens[j]);
      if (s >= MIN_TOKEN_SIM) cand.push({ i, j, s });
    }
  }
  if (!cand.length) return 0;
  if (cand.length > 1) {
    const prio = (c: { i: number; j: number }) => (c.i === A.head ? 1 : 0) + (c.j === B.head ? 1 : 0);
    cand.sort((x, y) => y.s - x.s || prio(y) - prio(x));
  }
  const matchA = new Array<number>(na).fill(-1);
  const simA = new Array<number>(na).fill(0);
  const matchB = new Array<number>(nb).fill(-1);
  let usedWeakSynonym = false;
  for (const c of cand) {
    if (matchA[c.i] >= 0 || matchB[c.j] >= 0) continue;
    matchA[c.i] = c.j;
    matchB[c.j] = c.i;
    simA[c.i] = c.s;
    if (c.s < STRONG_SIM) usedWeakSynonym = true;
  }

  let matchedA = 0;
  let matchedB = 0;
  let minStrongSim = 1;
  let strongAllA = true;
  let strongAllB = true;
  for (let i = 0; i < na; i++) {
    const j = matchA[i];
    const strong = A.strong[i];
    if (j >= 0) {
      matchedA += A.weights[i] * simA[i];
      matchedB += B.weights[j] * simA[i];
      if (strong) minStrongSim = Math.min(minStrongSim, simA[i]);
      if (strong && simA[i] < STRONG_SIM) strongAllA = false;
    } else if (strong) strongAllA = false;
  }
  for (let j = 0; j < nb; j++) {
    if (!B.strong[j]) continue;
    const i = matchB[j];
    if (i < 0 || simA[i] < STRONG_SIM) strongAllB = false;
    else minStrongSim = Math.min(minStrongSim, simA[i]);
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
  const headAMatched = A.head >= 0 && matchA[A.head] >= 0;
  const headBMatched = B.head >= 0 && matchB[B.head] >= 0;
  if (!headAMatched || !headBMatched) {
    let cap = HEAD_MISMATCH_CAP;
    if (strongAllA !== strongAllB) {
      const [S, L, sHeadMatched] = strongAllA ? [A, B, headAMatched] : [B, A, headBMatched];
      if (sHeadMatched && CUTS.has(L.tokens[L.head]) && isSourceLike(S.tokens[S.head])) cap = CUT_OF_SOURCE_CAP;
    }
    score = Math.min(score, cap);
  }

  // Una pieza/corte del animal frente al animal ("Pollo" ⇄ "POLLO PECHUGA", "Merluza" ⇄ "LOMO MERLUZA"): sugerencia.
  if (score > CUT_OF_SOURCE_CAP) {
    const cutOnlyIn = (X: Analyzed, matchX: number[], Y: Analyzed) =>
      X.tokens.some((t, i) => matchX[i] < 0 && CUTS.has(t)) && !Y.tokens.some((t) => CUTS.has(t)) && Y.head >= 0 && isSourceLike(Y.tokens[Y.head]);
    if (cutOnlyIn(A, matchA, B) || cutOnlyIn(B, matchB, A)) score = CUT_OF_SOURCE_CAP;
  }

  // Contradicciones y valores no habituales
  let penalty = 0;
  const seen = new Set<ConflictGroup>();
  const check = (g: ConflictGroup) => {
    if (seen.has(g)) return;
    seen.add(g);
    const va = A.groups.get(g);
    const vb = B.groups.get(g);
    if (va && vb) {
      let common = false;
      for (const v of va) if (vb.has(v)) common = true;
      if (!common) {
        const sev = GROUP_SEVERITY[g];
        if (sev.cap !== undefined) score = Math.min(score, sev.cap);
        if (sev.penalty) penalty += sev.penalty;
      }
      return;
    }
    const present = va ?? vb;
    const other = va ? B : A;
    if (!present || other.head < 0) return;
    const def = GROUP_DEFAULTS[other.tokens[other.head]]?.[g];
    if (def && !present.has(def) && (g === 'base' || g === 'grasa' || g === 'color')) penalty += NON_DEFAULT_PENALTY;
  };
  for (const g of A.groups.keys()) check(g);
  for (const g of B.groups.keys()) check(g);

  // Transformaciones presentes sólo en un lado (tomate ≠ tomate frito)
  let transforms = 0;
  for (let i = 0; i < na; i++) if (A.kinds[i] === 'transform' && matchA[i] < 0 && i !== A.head) transforms++;
  for (let j = 0; j < nb; j++) if (B.kinds[j] === 'transform' && matchB[j] < 0 && j !== B.head) transforms++;
  if (transforms) penalty += TRANSFORM_PENALTY + TRANSFORM_PENALTY_EXTRA * (transforms - 1);

  score -= penalty;
  if (usedWeakSynonym) score = Math.min(score, WEAK_SYNONYM_CAP);
  if (A.weakExpansion !== B.weakExpansion) score = Math.min(score, WEAK_EXPANSION_CAP);
  return Math.max(0, Math.min(1, score));
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
    let best = scoreOf(item.name);
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
  const { words } = expandAbbreviations(preprocess(String(description)).split(' ').filter(Boolean));

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
  while (content.length > 1 && !content[0].stop && isAdjective(content[0].w) && content.some((x) => !x.stop && !isAdjective(x.w))) {
    lead.push(content.shift() as Item);
    while (content.length && content[0].stop) content.shift();
  }
  content.push(...lead);

  // 3) Concordancia con el sustantivo principal
  const headWord = content.find((x) => !x.stop && !isAdjective(x.w))?.w ?? content[0].w;
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
