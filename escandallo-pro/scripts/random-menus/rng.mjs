/**
 * Generador pseudoaleatorio con semilla (mulberry32) para el generador procedural de cartas.
 * Cada aspecto de una carta (contenido, diseño, degradación de la foto) usa su propio flujo derivado de la semilla, de
 * modo que cambiar la plantilla de diseño no altera los platos y viceversa.
 */

/** Hash FNV-1a de 32 bits de un texto. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  /** @param {string | number} seed */
  constructor(seed) {
    this.next = mulberry32(hashString(String(seed)));
  }

  /** Real uniforme en [a, b). */
  float(a = 0, b = 1) {
    return a + (b - a) * this.next();
  }

  /** Entero uniforme en [a, b]. */
  int(a, b) {
    return Math.floor(this.float(a, b + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }

  /** Elige una clave de un objeto { opción: peso }. */
  weighted(weights) {
    const entries = Object.entries(weights);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [k, w] of entries) {
      r -= w;
      if (r < 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  sample(list, n) {
    return this.shuffle(list).slice(0, Math.max(0, Math.min(n, list.length)));
  }

  /** Normal estándar (Box–Muller). */
  normal() {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
