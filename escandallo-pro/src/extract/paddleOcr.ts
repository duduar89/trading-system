import type { GrayImage } from './imageOps';
import type { OcrBox, TessLine, TessPage, TessWord } from './ocrLayout';

/**
 * Lector PaddleOCR (PP-OCRv5: detección DB + reconocimiento CRNN/SVTR con decodificación CTC), lógica pura.
 *
 * Aquí no hay ONNX Runtime ni DOM: las redes se inyectan (`PaddleRunner`), así que lo usan igual el navegador
 * (onnxruntime-web en un worker, ver `paddleEngine.ts`) y los bancos de pruebas en Node (el mismo onnxruntime-web, ver
 * scripts/paddle-node.mjs). Todo lo demás (preparar los tensores, sacar las cajas del mapa de probabilidad, recortar
 * cada renglón, decodificar el texto, situar cada palabra y ajustar su caja a la tinta) está aquí y tiene tests.
 *
 * La salida imita la de Tesseract (`TessPage`: bloques → renglones → palabras con su caja), de modo que el resto del
 * canal (filas por posición, columnas de la carta, parser) no distingue qué motor ha leído la foto.
 */

/** Tensor de salida de una red: datos planos y dimensiones. */
export interface PaddleTensor {
  data: Float32Array;
  dims: readonly number[];
}

/** Ejecuta las dos redes (se inyecta: onnxruntime-web en un worker del navegador o en los bancos de pruebas). */
export interface PaddleRunner {
  /** Detección: entrada [1, 3, H, W] → mapa de probabilidad de texto [1, 1, H, W]. */
  detect(input: Float32Array, height: number, width: number): Promise<PaddleTensor>;
  /** Reconocimiento: entrada [N, 3, 48, W] → probabilidades por instante y carácter [N, T, C]. */
  recognize(input: Float32Array, batch: number, height: number, width: number): Promise<PaddleTensor>;
}

export interface PaddleOptions {
  /** Lado mayor máximo de la imagen que ve la red de detección (px). */
  detMaxSide?: number;
  /** Umbral de probabilidad del mapa de texto (DB). */
  detThresh?: number;
  /** Probabilidad media mínima de una caja. */
  boxThresh?: number;
  /** Cuánto se expande cada caja encogida por la red (DB «unclip»). */
  unclipRatio?: number;
  /** Renglones por lote de reconocimiento. */
  recBatch?: number;
  /** Relación ancho/alto máxima de un renglón (los más largos se leen reducidos). */
  maxRecRatio?: number;
  /** Máximo de cajas por página. */
  maxBoxes?: number;
  /** Probabilidad de espacio a partir de la cual se separan dos caracteres aunque la red no lo haya elegido. */
  spaceProb?: number;
  /** Buscar precios cortos que la detección se haya dejado (ver `isolatedInkBoxes`). */
  rescuePrices?: boolean;
}

/**
 * Parámetros por defecto (los de PaddleOCR 3 para PP-OCRv5, salvo el tamaño de detección: la imagen preparada ya trae el
 * texto a ~36 px de alto, y detectar sobre una versión reducida a 1280 px es igual de preciso en las cartas, separa mejor
 * los renglones de las fotos borrosas y cuesta la mitad de cálculo y memoria).
 */
export const PADDLE_DEFAULTS: Required<PaddleOptions> = {
  detMaxSide: 1280,
  detThresh: 0.3,
  boxThresh: 0.6,
  unclipRatio: 1.5,
  recBatch: 8,
  maxRecRatio: 40,
  maxBoxes: 3000,
  spaceProb: 0.3,
  rescuePrices: true,
};

export const REC_HEIGHT = 48;
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

export interface Point {
  x: number;
  y: number;
}

/** Caja de texto orientada: esquinas en sentido horario desde la superior izquierda (la de lectura). */
export interface TextQuad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
  /** Probabilidad media del mapa de texto dentro de la caja (0–1). */
  score: number;
}

// ───────────────────────────── Diccionario ─────────────────────────────

/**
 * Diccionario de caracteres del reconocedor a partir de su `inference.yml` (lista `character_dict`) o de un archivo de
 * texto con un carácter por línea. En YAML los caracteres especiales van entre comillas simples ('' = comilla).
 */
export function parseCharDict(source: string): string[] {
  const text = source.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*character_dict:\s*$/.test(l));
  if (start < 0) return lines.filter((l, i) => l.length > 0 || i < lines.length - 1);
  const out: string[] = [];
  const indent = /^(\s*)/.exec(lines[start])?.[1].length ?? 0;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(\s*)- (.*)$/.exec(lines[i]);
    if (!m || m[1].length < indent) break;
    let v = m[2];
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
    else if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v) as string;
    out.push(v);
  }
  return out;
}

// ───────────────────────────── Detección ─────────────────────────────

export interface DetInput {
  data: Float32Array;
  width: number;
  height: number;
  /** Factores para volver a las coordenadas de la imagen original. */
  scaleX: number;
  scaleY: number;
}

/** Múltiplo de 32 más cercano (mínimo 32): lo exige la red de detección. */
function to32(v: number): number {
  return Math.max(32, Math.round(v / 32) * 32);
}

/**
 * Tensor de detección [1, 3, H, W] (canales BGR normalizados como en el entrenamiento) a partir de la imagen en gris,
 * reducida para que el lado mayor no pase de `maxSide` y con lados múltiplos de 32.
 */
export function detInput(img: GrayImage, maxSide = PADDLE_DEFAULTS.detMaxSide): DetInput {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const W = to32(img.width * s);
  const H = to32(img.height * s);
  const plane = W * H;
  const data = new Float32Array(plane * 3);
  const fx = img.width / W;
  const fy = img.height / H;
  // Tabla de normalización por nivel de gris (los tres canales valen lo mismo antes de normalizar)
  const lut = [0, 1, 2].map((c) => Float32Array.from({ length: 256 }, (_, g) => (g / 255 - DET_MEAN[c]) / DET_STD[c]));
  const src = img.data;
  const sw = img.width;
  const reduce = fx > 1.5 || fy > 1.5;
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) * fy - 0.5;
    const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(sy)));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < W; x++) {
      let g: number;
      if (reduce) {
        // Reducción fuerte: media del área (sin dientes de sierra en el texto pequeño)
        const ax0 = Math.floor(x * fx);
        const ax1 = Math.max(ax0 + 1, Math.min(sw, Math.floor((x + 1) * fx)));
        const ay0 = Math.floor(y * fy);
        const ay1 = Math.max(ay0 + 1, Math.min(img.height, Math.floor((y + 1) * fy)));
        let sum = 0;
        for (let yy = ay0; yy < ay1; yy++) for (let xx = ax0; xx < ax1; xx++) sum += src[yy * sw + xx];
        g = sum / ((ax1 - ax0) * (ay1 - ay0));
      } else {
        const sx = (x + 0.5) * fx - 0.5;
        const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
        const x1 = Math.min(sw - 1, x0 + 1);
        const tx = Math.max(0, Math.min(1, sx - x0));
        const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
        const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
        g = a * (1 - ty) + b * ty;
      }
      const gi = Math.max(0, Math.min(255, Math.round(g)));
      const o = y * W + x;
      data[o] = lut[0][gi];
      data[plane + o] = lut[1][gi];
      data[2 * plane + o] = lut[2][gi];
    }
  }
  return { data, width: W, height: H, scaleX: img.width / W, scaleY: img.height / H };
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Envolvente convexa (cadena monótona de Andrew), en sentido antihorario. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Rectángulo orientado: centro, eje de lectura `u` (|ángulo| ≤ 45°, hacia la derecha), ancho a lo largo de u y alto. */
export interface OrientedRect {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  width: number;
  height: number;
}

/** Rectángulo de área mínima que contiene los puntos (calibres giratorios sobre la envolvente convexa). */
export function minAreaRect(points: Point[]): OrientedRect | undefined {
  const hull = convexHull(points);
  if (!hull.length) return undefined;
  if (hull.length === 1) return { cx: hull[0].x, cy: hull[0].y, ux: 1, uy: 0, width: 0, height: 0 };
  let best: { area: number; ex: number; ey: number; e0: number; e1: number; n0: number; n1: number } | undefined;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const ex = (b.x - a.x) / len;
    const ey = (b.y - a.y) / len;
    let e0 = Infinity;
    let e1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    for (const p of hull) {
      const pe = p.x * ex + p.y * ey;
      const pn = -p.x * ey + p.y * ex;
      if (pe < e0) e0 = pe;
      if (pe > e1) e1 = pe;
      if (pn < n0) n0 = pn;
      if (pn > n1) n1 = pn;
    }
    const area = (e1 - e0) * (n1 - n0);
    if (!best || area < best.area - 1e-9) best = { area, ex, ey, e0, e1, n0, n1 };
  }
  if (!best) return undefined;
  const { ex, ey, e0, e1, n0, n1 } = best;
  const ce = (e0 + e1) / 2;
  const cn = (n0 + n1) / 2;
  // Centro: ce·e + cn·n, con n = (−ey, ex)
  const cx = ce * ex - cn * ey;
  const cy = ce * ey + cn * ex;
  let ux = ex;
  let uy = ey;
  let width = e1 - e0;
  let height = n1 - n0;
  // Eje de lectura: el más horizontal de los dos (la foto ya viene enderezada; nunca se lee en vertical)
  if (Math.abs(ux) < Math.abs(uy)) {
    [ux, uy] = [-ey, ex];
    [width, height] = [height, width];
  }
  if (ux < 0 || (ux === 0 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  return { cx, cy, ux, uy, width, height };
}

/** Esquinas de un rectángulo orientado (superior izquierda, superior derecha, inferior derecha, inferior izquierda). */
export function rectCorners(r: OrientedRect): [Point, Point, Point, Point] {
  // v = eje vertical de la caja, hacia abajo en la imagen
  const vx = -r.uy;
  const vy = r.ux;
  const hw = r.width / 2;
  const hh = r.height / 2;
  const at = (a: number, b: number): Point => ({ x: r.cx + r.ux * a + vx * b, y: r.cy + r.uy * a + vy * b });
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
}

/**
 * «Unclip» de DB sobre un rectángulo: la red predice el texto encogido; se expande cada lado la distancia
 * área · ratio / perímetro (lo mismo que el desplazamiento de polígono de PaddleOCR, cuyo rectángulo mínimo es este).
 */
export function unclipRect(r: OrientedRect, ratio: number): OrientedRect {
  const perimeter = 2 * (r.width + r.height);
  const d = perimeter > 0 ? (r.width * r.height * ratio) / perimeter : 0;
  return { ...r, width: r.width + 2 * d, height: r.height + 2 * d };
}

/** Probabilidad media del mapa dentro de un cuadrilátero convexo (como `box_score_fast` de PaddleOCR). */
function quadScore(prob: Float32Array, w: number, h: number, q: [Point, Point, Point, Point]): number {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  let sum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = { x, y };
      let inside = true;
      for (let k = 0; k < 4 && inside; k++) if (cross(q[k], q[(k + 1) % 4], p) < -0.5) inside = false;
      if (!inside) continue;
      sum += prob[y * w + x];
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Tramos de columnas de una componente del mapa de DB, separados por los rellenos de puntos (o filetes) que la red une
 * al texto: «Croquetas ·········· 9,50» sale como una sola mancha, con el relleno como una banda fina. Donde la ocupación
 * de las columnas cae por debajo del 40 % de la altura durante más de 1,5 alturas, se corta (y el relleno se descarta):
 * el nombre y el precio quedan en cajas aparte, sin los puntos, que confunden al reconocedor.
 */
export function splitLeaderRuns(pix: Int32Array, count: number, width: number, minX: number, maxX: number, minY: number, maxY: number): [number, number][] {
  const h = maxY - minY + 1;
  const w = maxX - minX + 1;
  if (w < 4 * h || w < 12) return [[minX, maxX]];
  const occ = new Uint16Array(w);
  for (let k = 0; k < count; k++) {
    const idx = pix[k];
    const y = (idx / width) | 0;
    occ[idx - y * width - minX]++;
  }
  const dense = (x: number) => occ[x] >= 0.4 * h;
  const minRun = Math.max(3, Math.round(1.5 * h));
  const out: [number, number][] = [];
  let segStart = -1;
  let sparse = 0;
  let lastDense = -1;
  for (let x = 0; x < w; x++) {
    if (dense(x)) {
      if (segStart < 0) segStart = x;
      else if (sparse >= minRun) {
        out.push([minX + segStart, minX + lastDense]);
        segStart = x;
      }
      sparse = 0;
      lastDense = x;
    } else if (segStart >= 0) sparse++;
  }
  if (segStart >= 0) out.push([minX + segStart, minX + lastDense]);
  return out.length ? out : [[minX, maxX]];
}

/**
 * Cajas de texto a partir del mapa de probabilidad de DB (lo que hace `DBPostProcess` de PaddleOCR): umbral,
 * componentes conexas, rectángulo mínimo, puntuación media, expansión («unclip») y vuelta a la escala original.
 */
export function dbBoxes(
  prob: Float32Array,
  width: number,
  height: number,
  opts: { thresh?: number; boxThresh?: number; unclipRatio?: number; scaleX?: number; scaleY?: number; maxBoxes?: number; minSize?: number } = {},
): TextQuad[] {
  const thresh = opts.thresh ?? PADDLE_DEFAULTS.detThresh;
  const boxThresh = opts.boxThresh ?? PADDLE_DEFAULTS.boxThresh;
  const ratio = opts.unclipRatio ?? PADDLE_DEFAULTS.unclipRatio;
  const sx = opts.scaleX ?? 1;
  const sy = opts.scaleY ?? 1;
  const maxBoxes = opts.maxBoxes ?? PADDLE_DEFAULTS.maxBoxes;
  const minSize = opts.minSize ?? 3;
  const n = width * height;
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const pix = new Int32Array(n);
  const out: TextQuad[] = [];
  /** Caja de un conjunto de píxeles de la componente (rectángulo mínimo, puntuación, expansión, escala). */
  const boxFrom = (list: Int32Array, from: number, to: number, x0: number, x1: number) => {
    const rowMin = new Map<number, number>();
    const rowMax = new Map<number, number>();
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = from; k < to; k++) {
      const idx = list[k];
      const y = (idx / width) | 0;
      const x = idx - y * width;
      if (x < x0 || x > x1) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const lo = rowMin.get(y);
      if (lo === undefined || x < lo) rowMin.set(y, x);
      const hi = rowMax.get(y);
      if (hi === undefined || x > hi) rowMax.set(y, x);
    }
    if (!Number.isFinite(minY) || maxY - minY < minSize - 1) return;
    const pts: Point[] = [];
    for (let y = minY; y <= maxY; y++) {
      const lo = rowMin.get(y);
      const hi = rowMax.get(y);
      if (lo === undefined || hi === undefined) continue;
      pts.push({ x: lo, y }, { x: hi, y });
    }
    const rect = minAreaRect(pts);
    if (!rect || Math.min(rect.width, rect.height) < minSize) return;
    const score = quadScore(prob, width, height, rectCorners(rect));
    if (score < boxThresh) return;
    const big = unclipRect(rect, ratio);
    if (Math.min(big.width, big.height) < minSize + 2) return;
    const [tl, tr, br, bl] = rectCorners(big).map((p) => ({ x: Math.max(0, Math.min(width, p.x)) * sx, y: Math.max(0, Math.min(height, p.y)) * sy }));
    out.push({ tl, tr, br, bl, score });
  };
  let label = 0;
  for (let start = 0; start < n && out.length < maxBoxes; start++) {
    if (labels[start] || prob[start] <= thresh) continue;
    label++;
    // Relleno por inundación (8-vecindad) guardando los píxeles de la componente
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    let count = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    while (top > 0) {
      const idx = stack[--top];
      pix[count++] = idx;
      const y = (idx / width) | 0;
      const x = idx - y * width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (labels[j] || prob[j] <= thresh) continue;
          labels[j] = label;
          stack[top++] = j;
        }
      }
    }
    if (count < 4 || maxY - minY < minSize - 1) continue;
    for (const [a, b] of splitLeaderRuns(pix, count, width, minX, maxX, minY, maxY)) boxFrom(pix, 0, count, a, b);
  }
  // Orden de lectura aproximado: de arriba abajo y, en la misma franja, de izquierda a derecha
  out.sort((a, b) => {
    const ay = (a.tl.y + a.bl.y) / 2;
    const by = (b.tl.y + b.bl.y) / 2;
    const h = Math.min(a.bl.y - a.tl.y, b.bl.y - b.tl.y) / 2;
    return Math.abs(ay - by) < h ? a.tl.x - b.tl.x : ay - by;
  });
  return out;
}

// ───────────────────────────── Reconocimiento ─────────────────────────────

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Tamaño natural del recorte de una caja (ancho a lo largo del renglón, alto). */
export function quadSize(q: TextQuad): { width: number; height: number } {
  return { width: Math.max(1, Math.max(dist(q.tl, q.tr), dist(q.bl, q.br))), height: Math.max(1, Math.max(dist(q.tl, q.bl), dist(q.tr, q.br))) };
}

/**
 * Muestrea el renglón de una caja directamente a su tamaño de entrada (alto 48, ancho `outW`) con interpolación
 * bilineal y, si hay que reducir mucho, promediando varias muestras por píxel. Devuelve niveles de gris 0–255.
 */
export function sampleQuad(img: GrayImage, q: TextQuad, outW: number, outH = REC_HEIGHT): Float32Array {
  const out = new Float32Array(outW * outH);
  const { width: qw, height: qh } = quadSize(q);
  const ss = Math.max(1, Math.min(4, Math.ceil(Math.max(qw / outW, qh / outH))));
  const W = img.width;
  const H = img.height;
  const src = img.data;
  const at = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const cx0 = Math.max(0, Math.min(W - 1, x0));
    const cx1 = Math.max(0, Math.min(W - 1, x0 + 1));
    const cy0 = Math.max(0, Math.min(H - 1, y0));
    const cy1 = Math.max(0, Math.min(H - 1, y0 + 1));
    const a = src[cy0 * W + cx0] * (1 - fx) + src[cy0 * W + cx1] * fx;
    const b = src[cy1 * W + cx0] * (1 - fx) + src[cy1 * W + cx1] * fx;
    return a * (1 - fy) + b * fy;
  };
  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      let sum = 0;
      for (let j = 0; j < ss; j++) {
        const t = (v + (j + 0.5) / ss) / outH;
        for (let i = 0; i < ss; i++) {
          const s = (u + (i + 0.5) / ss) / outW;
          // Interpolación bilineal de las cuatro esquinas (exacta para rectángulos y paralelogramos)
          const x = (q.tl.x * (1 - s) + q.tr.x * s) * (1 - t) + (q.bl.x * (1 - s) + q.br.x * s) * t;
          const y = (q.tl.y * (1 - s) + q.tr.y * s) * (1 - t) + (q.bl.y * (1 - s) + q.br.y * s) * t;
          sum += at(x - 0.5, y - 0.5);
        }
      }
      out[v * outW + u] = sum / (ss * ss);
    }
  }
  return out;
}

export interface RecBatch {
  data: Float32Array;
  batch: number;
  width: number;
  /** Ancho útil (sin relleno) de cada renglón dentro del tensor. */
  widths: number[];
  /** Renglón muestreado en gris (alto 48, ancho `widths[i]`): sirve para ajustar las cajas de las palabras a la tinta. */
  crops: Float32Array[];
}

/**
 * Tensor de reconocimiento [N, 3, 48, W] para un lote de cajas (como `resize_norm_img` de PaddleOCR): cada renglón a
 * alto 48 conservando la proporción, normalizado a [−1, 1] y rellenado con 0 hasta el ancho del más largo.
 */
export function recBatchInput(img: GrayImage, quads: TextQuad[], maxRatio = PADDLE_DEFAULTS.maxRecRatio): RecBatch {
  const ratios = quads.map((q) => {
    const s = quadSize(q);
    return Math.min(maxRatio, s.width / s.height);
  });
  const maxWh = Math.max(320 / REC_HEIGHT, ...ratios);
  const W = Math.ceil(REC_HEIGHT * maxWh);
  const plane = REC_HEIGHT * W;
  const data = new Float32Array(quads.length * 3 * plane);
  const widths: number[] = [];
  const crops: Float32Array[] = [];
  quads.forEach((q, i) => {
    const rw = Math.max(1, Math.min(W, Math.ceil(REC_HEIGHT * ratios[i])));
    widths.push(rw);
    const gray = sampleQuad(img, q, rw);
    crops.push(gray);
    const base = i * 3 * plane;
    for (let y = 0; y < REC_HEIGHT; y++) {
      for (let x = 0; x < rw; x++) {
        const v = gray[y * rw + x] / 127.5 - 1;
        const o = y * W + x;
        data[base + o] = v;
        data[base + plane + o] = v;
        data[base + 2 * plane + o] = v;
      }
    }
  });
  return { data, batch: quads.length, width: W, widths, crops };
}

export interface CtcChar {
  char: string;
  /** Primer y último instante (columna de salida) en que la red emite el carácter. */
  start: number;
  end: number;
  prob: number;
}

/** Índice de la clase «espacio» de la red (−1 si no tiene). */
export function spaceClass(classes: number, dict: readonly string[]): number {
  if (classes === dict.length + 2) return classes - 1;
  const at = dict.indexOf(' ');
  return at >= 0 ? at + 1 : -1;
}

/**
 * Decodificación CTC voraz de un renglón: el carácter más probable en cada instante, sin repeticiones consecutivas ni
 * el símbolo en blanco (índice 0). `dict` sin el blanco; si la red tiene una clase más que el diccionario, es el espacio.
 *
 * `spaceProb`: la red a veces se «come» el espacio entre dos palabras (letra fina y espaciada, «Ensaladade») aunque lo
 * ha visto: si entre dos caracteres algún instante da al espacio al menos esa probabilidad, se inserta.
 */
export function ctcDecode(probs: Float32Array, offset: number, steps: number, classes: number, dict: readonly string[], spaceProb = 1): CtcChar[] {
  const out: CtcChar[] = [];
  const space = spaceClass(classes, dict);
  let prev = 0;
  /** Mayor probabilidad de espacio (y su instante) desde el último carácter emitido. */
  let gapSpace = 0;
  let gapAt = -1;
  for (let t = 0; t < steps; t++) {
    const row = offset + t * classes;
    let best = 0;
    let bp = probs[row];
    for (let c = 1; c < classes; c++) {
      const p = probs[row + c];
      if (p > bp) {
        bp = p;
        best = c;
      }
    }
    if (best !== 0 && best === prev) {
      const last = out[out.length - 1];
      if (last) {
        last.end = t;
        last.prob = Math.max(last.prob, bp);
      }
    } else if (best !== 0) {
      const ch = best - 1 < dict.length ? dict[best - 1] : ' ';
      const last = out[out.length - 1];
      if (ch !== ' ' && last && last.char !== ' ' && gapSpace >= spaceProb) out.push({ char: ' ', start: gapAt, end: gapAt, prob: gapSpace });
      out.push({ char: ch, start: t, end: t, prob: bp });
      gapSpace = 0;
      gapAt = -1;
    }
    if (best === 0 && space >= 0 && out.length && probs[row + space] > gapSpace) {
      gapSpace = probs[row + space];
      gapAt = t;
    }
    prev = best;
  }
  return out;
}

/** Umbral de Otsu de un renglón en gris (undefined si apenas hay contraste: no hay tinta que medir). */
export function inkThreshold(gray: Float32Array): number | undefined {
  const hist = new Float64Array(256);
  let lo = 255;
  let hi = 0;
  for (const g of gray) {
    const v = Math.max(0, Math.min(255, Math.round(g)));
    hist[v]++;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 40) return undefined;
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let thr = (lo + hi) / 2;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t + 0.5;
    }
  }
  return thr;
}

/** Tramo de columnas [u0, u1) y filas [v0, v1) de un renglón muestreado. */
export interface CropSpan {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Ajusta la caja de una palabra a su tinta (como las cajas de Tesseract): filas con tinta alrededor del núcleo de la
 * palabra (se toleran huecos de 2 filas: tildes, puntos de la i) y columnas con tinta, dentro de [lo, hi) para no
 * invadir las palabras vecinas. Así la altura de cada palabra refleja su tamaño de letra (nombre del plato frente a su
 * descripción en cursiva en el mismo renglón), que el parser de cartas usa para separarlos.
 */
export function inkSpan(gray: Float32Array, width: number, height: number, thr: number, a: number, b: number, lo: number, hi: number): CropSpan | undefined {
  const L = Math.max(0, Math.floor(lo));
  const R = Math.min(width, Math.ceil(hi));
  let u0 = Math.max(L, Math.floor(a));
  let u1 = Math.min(R, Math.ceil(b));
  if (u1 - u0 < 1) return undefined;
  // 1) A lo ancho, primero: la CTC sitúa cada carácter por un instante (a menudo su centro), así que la ventana inicial
  // puede quedarse en medio de la primera y la última letra. Se amplía mientras siga la tinta en la franja central.
  const band0 = Math.floor(height * 0.15);
  const band1 = Math.ceil(height * 0.85);
  const inkIn = (u: number, v0: number, v1: number) => {
    for (let v = v0; v < v1; v++) if (gray[v * width + u] < thr) return true;
    return false;
  };
  while (u0 > L && inkIn(u0 - 1, band0, band1)) u0--;
  while (u1 < R && inkIn(u1, band0, band1)) u1++;
  // 2) Filas con tinta alrededor del núcleo (la fila con más tinta de la franja central; los bordes pueden traer
  // rasgos de los renglones vecinos)
  const rowInk = new Uint16Array(height);
  for (let v = 0; v < height; v++) {
    let n = 0;
    const row = v * width;
    for (let u = u0; u < u1; u++) if (gray[row + u] < thr) n++;
    rowInk[v] = n;
  }
  let core = -1;
  let coreInk = 0;
  for (let v = Math.floor(height * 0.2); v < Math.ceil(height * 0.8); v++) {
    if (rowInk[v] > coreInk) {
      coreInk = rowInk[v];
      core = v;
    }
  }
  if (core < 0) return undefined;
  let v0 = core;
  let v1 = core + 1;
  for (let gap = 0, v = core - 1; v >= 0 && gap <= 2; v--) {
    if (rowInk[v]) {
      v0 = v;
      gap = 0;
    } else gap++;
  }
  for (let gap = 0, v = core + 1; v < height && gap <= 2; v++) {
    if (rowInk[v]) {
      v1 = v + 1;
      gap = 0;
    } else gap++;
  }
  // 3) Se completa a lo ancho con las filas ya medidas (tildes, rasgos) y se recortan los márgenes vacíos
  while (u0 > L && inkIn(u0 - 1, v0, v1)) u0--;
  while (u1 < R && inkIn(u1, v0, v1)) u1++;
  while (u0 < u1 && !inkIn(u0, v0, v1)) u0++;
  while (u1 > u0 && !inkIn(u1 - 1, v0, v1)) u1--;
  if (u1 <= u0) return undefined;
  return { u0, u1, v0, v1 };
}

/** Punto (s, t) ∈ [0, 1]² de una caja: s a lo ancho del renglón, t de arriba abajo. */
function quadPoint(q: TextQuad, s: number, t: number): Point {
  return {
    x: (q.tl.x * (1 - s) + q.tr.x * s) * (1 - t) + (q.bl.x * (1 - s) + q.br.x * s) * t,
    y: (q.tl.y * (1 - s) + q.tr.y * s) * (1 - t) + (q.bl.y * (1 - s) + q.br.y * s) * t,
  };
}

function boxOf(points: Point[]): OcrBox {
  return {
    x0: Math.round(Math.min(...points.map((p) => p.x))),
    y0: Math.round(Math.min(...points.map((p) => p.y))),
    x1: Math.round(Math.max(...points.map((p) => p.x))),
    y1: Math.round(Math.max(...points.map((p) => p.y))),
  };
}

const LEADER_RE = /^[.·…_]+$/;
const LEADER_CHAR = /[.·…_]/;

/**
 * Limpia los rellenos de puntos de las cartas («Croquetas ........ 9,50»): la red los lee como puntos sueltos o pegados
 * a la palabra de al lado («bacon..», «.4,5»). Devuelve los grupos de caracteres sin esos puntos (los grupos que sólo
 * eran relleno desaparecen).
 */
export function stripLeaders(groups: CtcChar[][]): CtcChar[][] {
  const out: CtcChar[][] = [];
  let prevLeader = false;
  for (const g of groups) {
    const text = g.map((c) => c.char).join('');
    if (LEADER_RE.test(text)) {
      prevLeader = true;
      continue;
    }
    let a = 0;
    let b = g.length;
    // Puntos delante de una cifra: relleno si vienen detrás de más relleno o son dos o más
    let lead = 0;
    while (lead < b && LEADER_CHAR.test(g[lead].char)) lead++;
    const rest = g
      .slice(lead)
      .map((c) => c.char)
      .join('');
    // Un precio nunca empieza por punto: «.5,00» es el último punto del relleno pegado al precio
    if (lead > 0 && lead < b && /\d/.test(g[lead].char) && (prevLeader || lead >= 2 || /^\d{1,3}[.,]\d{2}\b/.test(rest))) a = lead;
    // Puntos delante de una letra: relleno o el número de un plato numerado que la red no ha leído (".Tortilla")
    else if (lead >= 1 && lead < b && /\p{L}/u.test(g[lead].char)) a = lead;
    // Puntos detrás de una letra o cifra (dos o más): relleno
    let trail = 0;
    while (trail < b - a && LEADER_CHAR.test(g[b - 1 - trail].char)) trail++;
    if (trail >= 2) b -= trail;
    prevLeader = false;
    if (b > a) out.push(g.slice(a, b));
  }
  return out;
}

/**
 * Espacio que falta detrás de un signo («2.Mejillones», «adobo.Producto de proximidad», «tomate,cebolla»): se parte la
 * palabra detrás de «.», «,», «;», «:» o «)» cuando antes hay una letra o cifra y después una letra. Las cifras
 * decimales («12,50») y las siglas con iniciales («D.O.Ca.Rioja» → «D.O.Ca.» «Rioja») se respetan.
 */
export function splitAfterPunctuation(groups: CtcChar[][]): CtcChar[][] {
  const out: CtcChar[][] = [];
  for (const g of groups) {
    let from = 0;
    /** Inicio del trozo actual (desde el último signo): una inicial suelta («D.O.Ca.») no se separa. */
    let token = 0;
    for (let i = 1; i + 1 < g.length; i++) {
      if (!/[.,;:)]/.test(g[i].char)) continue;
      const piece = g
        .slice(token, i)
        .map((c) => c.char)
        .join('');
      token = i + 1;
      const initial = /^\p{L}$/u.test(piece);
      if (!initial && /[\p{L}\d]/u.test(g[i - 1].char) && /\p{L}/u.test(g[i + 1].char)) {
        out.push(g.slice(from, i + 1));
        from = i + 1;
      }
    }
    out.push(g.slice(from));
  }
  return out;
}

/**
 * Números volados detrás de una palabra («wasabi³⁴⁸», alérgenos en superíndice que la red pega a la palabra): si la
 * tinta de las cifras finales acaba claramente por encima de la línea base de las letras, van en una palabra aparte.
 */
export function splitSuperscript(g: CtcChar[], gray: Float32Array, width: number, thr: number, colsPerStep: number, lo: number, hi: number): CtcChar[][] {
  let k = g.length;
  while (k > 0 && /[\d,]/.test(g[k - 1].char)) k--;
  if (k === g.length || k < 2 || !/\p{L}/u.test(g[k - 1].char)) return [g];
  const letters = g.slice(0, k);
  const digits = g.slice(k);
  const mid = ((letters[letters.length - 1].end + 1) * colsPerStep + digits[0].start * colsPerStep) / 2;
  const a = inkSpan(gray, width, REC_HEIGHT, thr, letters[0].start * colsPerStep, (letters[letters.length - 1].end + 1) * colsPerStep, lo, mid);
  const b = inkSpan(gray, width, REC_HEIGHT, thr, digits[0].start * colsPerStep, (digits[digits.length - 1].end + 1) * colsPerStep, mid, hi);
  if (!a || !b) return [g];
  const h = a.v1 - a.v0;
  // Cifras más bajas que las letras y con la base por encima de dos tercios de su altura
  return b.v1 - b.v0 < 0.8 * h && b.v1 <= a.v0 + 0.7 * h ? [letters, digits] : [g];
}

/**
 * Espacio que la red no ha emitido («Cafésolo»): dentro de una palabra de 4 o más letras, un hueco en blanco entre dos
 * caracteres claramente mayor que los demás huecos de la palabra (y de al menos un tercio de la altura del texto) la
 * parte en dos, siempre que cada parte tenga dos letras o más. El texto con letras espaciadas («C A R N E S», que la red
 * lee junto) no se parte porque todos sus huecos son parecidos.
 */
export function splitByGaps(g: CtcChar[], gray: Float32Array, width: number, thr: number, v0: number, v1: number, colsPerStep: number): CtcChar[][] {
  if (g.length < 2 || v1 - v0 < 4) return [g];
  const white = (u: number) => {
    for (let v = v0; v < v1; v++) if (gray[v * width + u] < thr) return false;
    return true;
  };
  const gaps: number[] = [];
  for (let i = 0; i + 1 < g.length; i++) {
    const from = Math.max(0, Math.floor((g[i].end + 0.5) * colsPerStep));
    const to = Math.min(width, Math.ceil((g[i + 1].start + 0.5) * colsPerStep));
    let best = 0;
    let run = 0;
    for (let u = from; u < to; u++) {
      if (white(u)) best = Math.max(best, ++run);
      else run = 0;
    }
    gaps.push(best);
  }
  const textH = v1 - v0;
  const letters = (list: CtcChar[]) => list.filter((c) => /\p{L}/u.test(c.char)).length;
  const digits = (list: CtcChar[]) => list.filter((c) => /\d/.test(c.char)).length;
  let at = -1;
  for (let i = 0; i < gaps.length; i++) {
    const others = gaps.filter((_, j) => j !== i);
    const maxOther = others.length ? Math.max(...others) : 0;
    const left = g.slice(0, i + 1);
    const right = g.slice(i + 1);
    // Palabra y precio pegados («pibil12,00», «2018 57,50»): basta un hueco claro entre letras y cifras
    const priceGlued = (/\p{L}/u.test(g[i].char) && /\d/.test(g[i + 1].char) && letters(left) >= 2 && digits(right) >= 1 && letters(right) === 0) || (/\d/.test(g[i].char) && /\d/.test(g[i + 1].char) && digits(left) === 4 && letters(left) === 0 && /[.,]/.test(right.map((c) => c.char).join('')));
    // Icono de alérgeno o adorno pegado al final («2020•», «brasa®»): símbolos sueltos tras un hueco
    const symbolTail = !/[\p{L}\d]/u.test(right.map((c) => c.char).join('')) && /[\p{L}\d]/u.test(g[i].char) && !/^[.,;:)%]+$/.test(right.map((c) => c.char).join(''));
    const ok = priceGlued || symbolTail
      ? gaps[i] >= textH / 4 && gaps[i] >= 1.5 * Math.max(1, maxOther)
      : gaps[i] >= textH / 3 && gaps[i] >= 2 * Math.max(1, maxOther) && letters(left) >= 2 && letters(right) >= 2;
    if (ok && (at < 0 || gaps[i] > gaps[at])) at = i;
  }
  return at < 0 ? [g] : [g.slice(0, at + 1), g.slice(at + 1)];
}

/**
 * Raya o guion suelto en el hueco entre dos palabras (columnas [u0, u1) del renglón): una mancha de tinta ancha
 * (≥ 30 % de la altura del texto), fina (≤ 20 %) y a media altura. Devuelve su tramo o undefined.
 */
export function findDash(gray: Float32Array, width: number, thr: number, u0: number, u1: number, v0: number, v1: number): CropSpan | undefined {
  const H = v1 - v0;
  const from = Math.max(0, Math.ceil(u0));
  const to = Math.min(width, Math.floor(u1));
  if (H < 6 || to - from < 2) return undefined;
  let best: CropSpan | undefined;
  let runStart = -1;
  let r0 = Infinity;
  let r1 = -Infinity;
  for (let u = from; u <= to; u++) {
    let top = Infinity;
    let bottom = -Infinity;
    if (u < to) {
      for (let v = v0; v < v1; v++) {
        if (gray[v * width + u] < thr) {
          if (v < top) top = v;
          bottom = v;
        }
      }
    }
    if (bottom >= top) {
      if (runStart < 0) runStart = u;
      r0 = Math.min(r0, top);
      r1 = Math.max(r1, bottom);
      continue;
    }
    if (runStart >= 0) {
      const w = u - runStart;
      const h = r1 - r0 + 1;
      const mid = (r0 + r1) / 2 - v0;
      if (w >= 0.3 * H && w <= 1.6 * H && h <= Math.max(2, 0.2 * H) && mid >= 0.3 * H && mid <= 0.75 * H && (!best || w > best.u1 - best.u0)) {
        best = { u0: runStart, u1: u, v0: r0, v1: r1 + 1 };
      }
    }
    runStart = -1;
    r0 = Infinity;
    r1 = -Infinity;
  }
  return best;
}

/**
 * Caracteres situados fuera del renglón: con un renglón corto y mucho relleno en el lote, la red a veces emite el texto
 * en instantes que caen en el relleno. Entonces se reparten, conservando sus proporciones, sobre la tinta del renglón
 * (así ninguna palabra se queda con una caja vacía en el borde).
 */
export function remapOutside(chars: CtcChar[], crop: Float32Array | undefined, thr: number | undefined, usedWidth: number, colsPerStep: number): CtcChar[] {
  if (!chars.length || !crop || thr === undefined) return chars;
  const c0 = chars[0].start * colsPerStep;
  const c1 = (chars[chars.length - 1].end + 1) * colsPerStep;
  if (c1 <= usedWidth + colsPerStep) return chars;
  const v0 = Math.floor(REC_HEIGHT * 0.15);
  const v1 = Math.ceil(REC_HEIGHT * 0.85);
  const inkAt = (u: number) => {
    for (let v = v0; v < v1; v++) if (crop[v * usedWidth + u] < thr) return true;
    return false;
  };
  let L = 0;
  while (L < usedWidth && !inkAt(L)) L++;
  let R = usedWidth - 1;
  while (R > L && !inkAt(R)) R--;
  if (R <= L) return chars;
  const k = (R + 1 - L) / Math.max(1, c1 - c0);
  const at = (step: number) => (L + (step * colsPerStep - c0) * k) / colsPerStep;
  return chars.map((c) => ({ ...c, start: at(c.start), end: at(c.end + 1) - 1 / colsPerStep }));
}

/**
 * Renglón leído → renglón al estilo Tesseract: palabras separadas por los espacios que emite la red, cada una con su
 * caja y su confianza (0–100). La caja sale de los instantes de la CTC y, si se pasa el renglón muestreado (`crop`), se
 * ajusta a la tinta. `usedWidth`/`tensorWidth`: ancho útil del renglón y ancho del tensor; `steps`: instantes de salida.
 */
export function lineFromCtc(q: TextQuad, chars: CtcChar[], usedWidth: number, tensorWidth: number, steps: number, crop?: Float32Array): TessLine | undefined {
  // Columnas del renglón muestreado por instante de salida
  const colsPerStep = tensorWidth / steps;
  // Avance típico por carácter (en instantes): cuánto puede extenderse la tinta de una letra más allá de su instante
  const span = chars.length > 1 ? (chars[chars.length - 1].start - chars[0].start) / (chars.length - 1) : 2;
  const reach = Math.max(1, Math.min(4, span)) * colsPerStep;
  const thr = crop ? inkThreshold(crop) : undefined;
  const raw: CtcChar[][] = [];
  let cur: CtcChar[] = [];
  for (const c of remapOutside(chars, crop, thr, usedWidth, colsPerStep)) {
    if (c.char === ' ') {
      if (cur.length) raw.push(cur);
      cur = [];
    } else cur.push(c);
  }
  if (cur.length) raw.push(cur);
  let groups = splitAfterPunctuation(stripLeaders(raw));
  // Límites de cada grupo: no invadir el instante del carácter vecino
  const bounds = (list: CtcChar[][], k: number) => ({
    lo: k > 0 ? (list[k - 1][list[k - 1].length - 1].end + 1) * colsPerStep : 0,
    hi: k < list.length - 1 ? list[k + 1][0].start * colsPerStep : usedWidth,
  });
  const spanOf = (list: CtcChar[][], k: number): CropSpan | undefined => {
    if (!crop || thr === undefined) return undefined;
    const g = list[k];
    const { lo, hi } = bounds(list, k);
    const a = g[0].start * colsPerStep;
    const b = (g[g.length - 1].end + 1) * colsPerStep;
    return inkSpan(crop, usedWidth, REC_HEIGHT, thr, a, b, Math.max(lo, a - reach), Math.min(hi, b + reach));
  };
  if (crop && thr !== undefined) {
    const split: CtcChar[][] = [];
    groups.forEach((g, k) => {
      const sp = spanOf(groups, k);
      const { lo, hi } = bounds(groups, k);
      for (const part of sp ? splitByGaps(g, crop, usedWidth, thr, sp.v0, sp.v1, colsPerStep) : [g]) {
        split.push(...splitSuperscript(part, crop, usedWidth, thr, colsPerStep, lo, hi));
      }
    });
    groups = split;
  }
  const words: TessWord[] = [];
  const spans: (CropSpan | undefined)[] = [];
  let lineV0 = REC_HEIGHT;
  let lineV1 = 0;
  const toBox = (sp: CropSpan) => {
    const s0 = Math.max(0, Math.min(1, sp.u0 / usedWidth));
    const s1 = Math.max(0, Math.min(1, sp.u1 / usedWidth));
    const t0 = sp.v0 / REC_HEIGHT;
    const t1 = sp.v1 / REC_HEIGHT;
    return boxOf([quadPoint(q, s0, t0), quadPoint(q, s1, t0), quadPoint(q, s0, t1), quadPoint(q, s1, t1)]);
  };
  groups.forEach((g, k) => {
    const text = g.map((c) => c.char).join('');
    if (!text.trim()) return;
    const measured = spanOf(groups, k);
    const pad = reach / 2;
    const sp: CropSpan = measured ?? {
      u0: Math.max(0, g[0].start * colsPerStep - pad),
      u1: Math.min(usedWidth, (g[g.length - 1].end + 1) * colsPerStep + pad),
      v0: 0,
      v1: REC_HEIGHT,
    };
    if (measured) {
      lineV0 = Math.min(lineV0, sp.v0);
      lineV1 = Math.max(lineV1, sp.v1);
    }
    const conf = (g.reduce((s, c) => s + c.prob, 0) / g.length) * 100;
    words.push({ text, confidence: Math.round(conf * 10) / 10, bbox: toBox(sp) });
    spans.push(measured);
  });
  if (!words.length) return undefined;
  // Rayas entre palabras que la red no transcribe (el reconocedor latino no tiene «–»): «Pulpo – con cachelos»
  if (crop && thr !== undefined && lineV1 > lineV0) {
    for (let k = words.length - 2; k >= 0; k--) {
      const a = spans[k];
      const b = spans[k + 1];
      if (!a || !b) continue;
      const dash = findDash(crop, usedWidth, thr, a.u1, b.u0, lineV0, lineV1);
      if (dash) words.splice(k + 1, 0, { text: '–', confidence: 80, bbox: toBox(dash) });
    }
  }
  const text = words.map((w) => w.text).join(' ');
  const confidence = Math.round((words.reduce((s, w) => s + w.confidence * w.text.length, 0) / Math.max(1, text.replace(/ /g, '').length)) * 10) / 10;
  // Altura del renglón: la de la tinta (si se ha medido); la línea base, el borde inferior de esa tinta
  const tv0 = lineV1 > lineV0 ? lineV0 / REC_HEIGHT : 0;
  const tv1 = lineV1 > lineV0 ? lineV1 / REC_HEIGHT : 1;
  const bl = quadPoint(q, 0, tv1);
  const br = quadPoint(q, 1, tv1);
  return {
    text,
    confidence,
    bbox: boxOf([quadPoint(q, 0, tv0), quadPoint(q, 1, tv0), bl, br]),
    baseline: { x0: Math.round(bl.x), y0: Math.round(bl.y), x1: Math.round(br.x), y1: Math.round(br.y) },
    rowAttributes: { rowHeight: Math.max(1, Math.round(quadSize(q).height * (tv1 - tv0))) },
    words,
  };
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const NUMERIC_WORD = /^[\d,.·\-]+$/;

/** «14712» → «¹⁴⁷¹²» (los separadores, fuera). */
export function toSuperscript(text: string): string {
  return text.replace(/\d/g, (d) => SUPERSCRIPT_DIGITS[Number(d)]).replace(/[,.·\-]+/g, ' ').trim();
}

/**
 * Números volados (alérgenos «Gambas¹ ⁴ ⁷», muy habituales en las cartas): cifras claramente más bajas que el texto de
 * al lado y con la base por encima de su línea base. Se devuelven como superíndices Unicode, que el parser de cartas
 * aparta del nombre y del precio (un «14712» normal parecería un precio o parte del nombre). Tanto si van dentro del
 * mismo renglón como si la red los ha detectado como un renglón aparte, pegado al final del nombre.
 */
export function markSuperscripts(lines: TessLine[]): TessLine[] {
  // Referencia: las palabras sin trazos bajos (g, j, p, q, y…), cuya base es la línea base y cuya altura no se infla
  const textWords = (l: TessLine) => {
    const ws = l.words.filter((w) => /\p{L}{2,}/u.test(w.text));
    const flat = ws.filter((w) => !/[gjpqyçµ,;]/.test(w.text));
    return flat.length ? flat : ws;
  };
  const medianOf = (values: number[]) => {
    const v = [...values].sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : 0;
  };
  const heightOf = (l: TessLine) => medianOf(textWords(l).map((w) => w.bbox.y1 - w.bbox.y0));
  const baseOf = (l: TessLine) => {
    const ws = textWords(l);
    if (ws.length) return medianOf(ws.map((w) => w.bbox.y1));
    return l.baseline ? (l.baseline.y0 + l.baseline.y1) / 2 : l.bbox.y1;
  };
  const raised = (w: TessWord, host: { h: number; base: number }) =>
    NUMERIC_WORD.test(w.text) && /\d/.test(w.text) && host.h > 0 && w.bbox.y1 - w.bbox.y0 < 0.8 * host.h && w.bbox.y1 <= host.base - 0.25 * host.h;
  return lines.map((l) => {
    const own = { h: heightOf(l), base: baseOf(l) };
    let host = own;
    if (!own.h && l.words.every((w) => NUMERIC_WORD.test(w.text))) {
      // Renglón sólo de cifras: el renglón con texto que acaba justo a su izquierda, a su altura
      const h0 = l.bbox.y1 - l.bbox.y0;
      const left = lines.find((o) => {
        if (o === l || !heightOf(o)) return false;
        const gap = l.bbox.x0 - o.bbox.x1;
        return gap > -h0 && gap < 2.5 * heightOf(o) && l.bbox.y1 > o.bbox.y0 && l.bbox.y0 < baseOf(o);
      });
      if (left) host = { h: heightOf(left), base: baseOf(left) };
    }
    if (!host.h || !l.words.some((w) => raised(w, host))) return l;
    const words = l.words.map((w) => (raised(w, host) ? { ...w, text: toSuperscript(w.text) } : w));
    return { ...l, words, text: words.map((w) => w.text).join(' ') };
  });
}

/** Umbral de Otsu de una imagen (histograma muestreado). */
function otsuOf(img: GrayImage): number {
  const hist = new Float64Array(256);
  const step = Math.max(1, Math.floor((img.width * img.height) / 400_000));
  for (let i = 0; i < img.data.length; i += step) hist[img.data[i]]++;
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const d = sumB / wB - (sum - sumB) / wF;
    const between = wB * wF * d * d;
    if (between > best) {
      best = between;
      thr = t + 0.5;
    }
  }
  return thr;
}

/**
 * Tinta aislada que la red de detección no ha recogido: sobre todo precios cortos alineados a la derecha («7», «10 €»)
 * detrás de una línea de puntos, que DB pierde con facilidad. Se buscan manchas compactas del tamaño del texto, fuera de
 * las cajas ya detectadas, que sean lo último de su renglón (a la derecha de una caja de texto a su altura). Son sólo
 * candidatas: `paddleRecognize` las lee y se queda únicamente con las que resultan ser un precio.
 * `grid`: lado en píxeles de la celda de la rejilla reducida sobre la que se buscan.
 */
export function isolatedInkBoxes(img: GrayImage, quads: readonly TextQuad[], grid: number): TextQuad[] {
  if (!quads.length) return [];
  const g = Math.max(1, Math.round(grid));
  const W = Math.ceil(img.width / g);
  const H = Math.ceil(img.height / g);
  const thr = otsuOf(img);
  // Rejilla: tinta si el píxel más oscuro de la celda pasa el umbral
  const ink = new Uint8Array(W * H);
  for (let cy = 0; cy < H; cy++) {
    const y1 = Math.min(img.height, (cy + 1) * g);
    for (let cx = 0; cx < W; cx++) {
      const x1 = Math.min(img.width, (cx + 1) * g);
      let min = 255;
      for (let y = cy * g; y < y1 && min >= thr; y++) {
        const row = y * img.width;
        for (let x = cx * g; x < x1; x++) if (img.data[row + x] < min) min = img.data[row + x];
      }
      if (min < thr) ink[cy * W + cx] = 1;
    }
  }
  // Fuera lo ya detectado (caja envolvente de cada detección, con un pequeño margen)
  const boxes = quads.map((q) => ({
    x0: Math.min(q.tl.x, q.bl.x),
    x1: Math.max(q.tr.x, q.br.x),
    y0: Math.min(q.tl.y, q.tr.y),
    y1: Math.max(q.bl.y, q.br.y),
  }));
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x0 / g) - 1);
    const x1 = Math.min(W, Math.ceil(b.x1 / g) + 1);
    const y0 = Math.max(0, Math.floor(b.y0 / g) - 1);
    const y1 = Math.min(H, Math.ceil(b.y1 / g) + 1);
    for (let y = y0; y < y1; y++) ink.fill(0, y * W + x0, y * W + x1);
  }
  // Altura típica del texto: la de las cajas detectadas sin la expansión de DB (≈ 65 %)
  const hs = boxes.map((b) => b.y1 - b.y0).sort((a, b) => a - b);
  const textH = hs[hs.length >> 1] * 0.65;
  // Manchas (8-vecindad)
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const blobs: { x0: number; x1: number; y0: number; y1: number; n: number }[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!ink[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let bx0 = Infinity;
    let bx1 = -Infinity;
    let by0 = Infinity;
    let by1 = -Infinity;
    let n = 0;
    while (top > 0) {
      const idx = stack[--top];
      const y = (idx / W) | 0;
      const x = idx - y * W;
      n++;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (ink[j] && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    const b = { x0: bx0 * g, x1: (bx1 + 1) * g, y0: by0 * g, y1: (by1 + 1) * g, n };
    const h = b.y1 - b.y0;
    const w = b.x1 - b.x0;
    // Del tamaño de una cifra o un «€», compacta, no pegada al borde de la foto
    if (h < 0.45 * textH || h > 1.5 * textH || w > 1.5 * textH || bx0 <= 0 || bx1 >= W - 1 || by0 <= 0 || by1 >= H - 1) continue;
    if (n * g * g < 0.12 * w * h) continue;
    blobs.push(b);
  }
  // Cifras sueltas de un mismo precio («1» «0» «€»): se unen las manchas vecinas del mismo renglón
  blobs.sort((a, b) => a.x0 - b.x0);
  const merged: typeof blobs = [];
  for (const b of blobs) {
    const cy = (b.y0 + b.y1) / 2;
    const prev = merged.find((m) => b.x0 - m.x1 < 0.6 * textH && b.x0 >= m.x0 && Math.abs((m.y0 + m.y1) / 2 - cy) < 0.4 * textH);
    if (prev) {
      prev.x1 = Math.max(prev.x1, b.x1);
      prev.y0 = Math.min(prev.y0, b.y0);
      prev.y1 = Math.max(prev.y1, b.y1);
      prev.n += b.n;
    } else merged.push({ ...b });
  }
  const out: TextQuad[] = [];
  for (const m of merged) {
    if (m.x1 - m.x0 > 5 * textH) continue;
    const cy = (m.y0 + m.y1) / 2;
    // Lo último de su renglón: hay texto detectado a su izquierda, a su altura, y nada detectado a su derecha
    const row = boxes.filter((b) => cy > b.y0 && cy < b.y1);
    if (!row.some((b) => b.x1 <= m.x0 + 0.2 * textH) || row.some((b) => b.x0 >= m.x1 - 0.2 * textH && b.x0 - m.x1 < 3 * textH)) continue;
    const padX = 0.35 * textH;
    const padY = 0.3 * textH;
    const x0 = Math.max(0, m.x0 - padX);
    const x1 = Math.min(img.width, m.x1 + padX);
    const y0 = Math.max(0, m.y0 - padY);
    const y1 = Math.min(img.height, m.y1 + padY);
    out.push({ tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 }, br: { x: x1, y: y1 }, bl: { x: x0, y: y1 }, score: 0 });
  }
  return out;
}

/** Lectura de una mancha rescatada que se acepta: un precio claro. */
const RESCUED_PRICE = /^[€$]?\s?\d{1,3}(?:[.,]\d{1,2})?\s?[€$]?$/;

// ───────────────────────────── Canal completo ─────────────────────────────

export interface PaddleTimings {
  detMs: number;
  recMs: number;
  boxes: number;
}

/**
 * Lee una imagen en gris: detección → cajas → reconocimiento por lotes → `TessPage` (un bloque con un renglón por
 * caja). `onProgress` recibe la fracción hecha (0–1).
 */
export async function paddleRecognize(
  img: GrayImage,
  runner: PaddleRunner,
  dict: readonly string[],
  opts: PaddleOptions = {},
  onProgress?: (fraction: number) => void,
  timings?: PaddleTimings,
): Promise<TessPage> {
  const o = { ...PADDLE_DEFAULTS, ...opts };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const det = detInput(img, o.detMaxSide);
  const map = await runner.detect(det.data, det.height, det.width);
  const mh = map.dims[map.dims.length - 2] ?? det.height;
  const mw = map.dims[map.dims.length - 1] ?? det.width;
  const quads = dbBoxes(map.data, mw, mh, {
    thresh: o.detThresh,
    boxThresh: o.boxThresh,
    unclipRatio: o.unclipRatio,
    scaleX: img.width / mw,
    scaleY: img.height / mh,
    maxBoxes: o.maxBoxes,
  });
  // Precios cortos que la detección se ha dejado (se leen y sólo se conservan si son un precio)
  const rescued = o.rescuePrices ? isolatedInkBoxes(img, quads, img.width / mw) : [];
  const firstRescued = quads.length;
  quads.push(...rescued);
  const t1 = now();
  onProgress?.(0.3);
  // Lotes de renglones de proporción parecida (menos relleno = menos cálculo)
  const order = quads.map((q, i) => ({ i, r: quadSize(q).width / quadSize(q).height })).sort((a, b) => a.r - b.r);
  const lines: (TessLine | undefined)[] = new Array(quads.length);
  for (let k = 0; k < order.length; k += o.recBatch) {
    const group = order.slice(k, k + o.recBatch);
    const batch = recBatchInput(
      img,
      group.map((g) => quads[g.i]),
      o.maxRecRatio,
    );
    const res = await runner.recognize(batch.data, batch.batch, REC_HEIGHT, batch.width);
    const steps = res.dims[1];
    const classes = res.dims[2];
    group.forEach((g, j) => {
      const chars = ctcDecode(res.data, j * steps * classes, steps, classes, dict, o.spaceProb);
      const line = lineFromCtc(quads[g.i], chars, batch.widths[j], batch.width, steps, batch.crops[j]);
      // Mancha rescatada: sólo si se lee con claridad como un precio
      lines[g.i] = g.i < firstRescued || (line && RESCUED_PRICE.test(line.text ?? '') && (line.confidence ?? 0) >= 80) ? line : undefined;
    });
    onProgress?.(0.3 + (0.7 * Math.min(order.length, k + o.recBatch)) / Math.max(1, order.length));
  }
  const t2 = now();
  if (timings) {
    timings.detMs += t1 - t0;
    timings.recMs += t2 - t1;
    timings.boxes += quads.length;
  }
  const kept = markSuperscripts(lines.filter((l): l is TessLine => !!l));
  const words = kept.flatMap((l) => l.words);
  const confidence = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
  onProgress?.(1);
  return {
    text: kept.map((l) => l.text).join('\n'),
    confidence: Math.round(confidence * 10) / 10,
    blocks: kept.length ? [{ bbox: boxOf(kept.flatMap((l) => [{ x: l.bbox.x0, y: l.bbox.y0 }, { x: l.bbox.x1, y: l.bbox.y1 }])), paragraphs: [{ lines: kept }] }] : [],
  };
}
