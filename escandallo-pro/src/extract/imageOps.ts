/**
 * Procesado de imagen para OCR sobre escala de grises (lógica pura, sin DOM ni canvas).
 *
 * Lo comparten el navegador (ocr.ts decodifica la foto con canvas y llama a estas funciones) y el banco de pruebas
 * en Node, para que ambos preparen las imágenes exactamente igual. Todo trabaja sobre `GrayImage` (1 byte por píxel)
 * y está pensado para fotos de móvil de hasta ~12 MP: memoria acotada (nada de imágenes integrales de 64 bits a
 * resolución completa) y bucles simples.
 *
 * Canal completo (`prepareForOcr`):
 *  1. Recorte de los bordes oscuros de la foto (la mesa alrededor del papel).
 *  2. Eliminación de ruido (mediana 3×3) sólo si el ruido estimado es alto.
 *  3. Aplanado del fondo (sombras, iluminación desigual) y normalización del contraste.
 *  4. Estimación de la inclinación por varianza del perfil de proyección en ±8° y enderezado.
 *  5. Escalado para que las líneas de texto midan ~40 px (a Tesseract le cuesta el texto pequeño).
 *  6. Opcional: binarización adaptativa de Sauvola (para una segunda lectura cuando la primera no cuadra).
 */

export interface GrayImage {
  width: number;
  height: number;
  /** Luminancia 0 (negro) – 255 (blanco), fila a fila. */
  data: Uint8ClampedArray;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function createGray(width: number, height: number, fill = 255): GrayImage {
  const data = new Uint8ClampedArray(Math.max(0, width * height));
  if (fill) data.fill(fill);
  return { width, height, data };
}

/** RGBA (ImageData) → luminancia (Rec. 601). Los píxeles transparentes se consideran papel blanco. */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const out = createGray(width, height, 0);
  const d = out.data;
  for (let i = 0, j = 0; i < d.length; i++, j += 4) {
    const a = rgba[j + 3];
    const l = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
    d[i] = a === 255 ? l : 255 - ((255 - l) * a) / 255;
  }
  return out;
}

/** Escala de grises → RGBA opaco (para `putImageData`). */
export function grayToRgba(img: GrayImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  const d = img.data;
  for (let i = 0, j = 0; i < d.length; i++, j += 4) {
    out[j] = out[j + 1] = out[j + 2] = d[i];
    out[j + 3] = 255;
  }
  return out;
}

/** Codifica como PGM binario (P5): formato sin compresión que Tesseract (Leptonica) lee directamente. */
export function encodePgm(img: GrayImage): Uint8Array<ArrayBuffer> {
  const header = `P5\n${img.width} ${img.height}\n255\n`;
  const out = new Uint8Array(header.length + img.data.length);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  out.set(img.data, header.length);
  return out;
}

// ───────────────────────────── Histograma y umbrales ─────────────────────────────

export function histogram(img: GrayImage, step = 1): Uint32Array {
  const h = new Uint32Array(256);
  const d = img.data;
  const s = Math.max(1, Math.floor(step));
  for (let i = 0; i < d.length; i += s) h[d[i]]++;
  return h;
}

/** Umbral de Otsu (maximiza la varianza entre clases). */
export function otsuThreshold(hist: ArrayLike<number>): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  if (!total) return 128;
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Valor por debajo del cual queda la fracción `p` (0–1) de los píxeles del rango [lo, hi]. */
function percentileIn(hist: ArrayLike<number>, p: number, lo = 0, hi = 255): number {
  let total = 0;
  for (let i = lo; i <= hi; i++) total += hist[i];
  if (!total) return lo;
  const target = total * Math.min(1, Math.max(0, p));
  let acc = 0;
  for (let i = lo; i <= hi; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return hi;
}

// ───────────────────────────── Geometría ─────────────────────────────

export function crop(img: GrayImage, r: Rect): GrayImage {
  const x0 = Math.max(0, Math.floor(r.x0));
  const y0 = Math.max(0, Math.floor(r.y0));
  const x1 = Math.min(img.width, Math.ceil(r.x1));
  const y1 = Math.min(img.height, Math.ceil(r.y1));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = createGray(w, h, 0);
  for (let y = 0; y < h; y++) out.data.set(img.data.subarray((y0 + y) * img.width + x0, (y0 + y) * img.width + x0 + w), y * w);
  return out;
}

/** Reducción por promedio de área (antialias correcto). `factor` ≥ 1. */
export function downscale(img: GrayImage, factor: number): GrayImage {
  const f = Math.max(1, factor);
  if (f === 1) return img;
  const w = Math.max(1, Math.floor(img.width / f));
  const h = Math.max(1, Math.floor(img.height / f));
  const out = createGray(w, h, 0);
  const src = img.data;
  const W = img.width;
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * f);
    const sy1 = Math.max(sy0 + 1, Math.min(img.height, Math.floor((y + 1) * f)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * f);
      const sx1 = Math.max(sx0 + 1, Math.min(W, Math.floor((x + 1) * f)));
      let s = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        const row = yy * W;
        for (let xx = sx0; xx < sx1; xx++) s += src[row + xx];
      }
      out.data[y * w + x] = s / ((sy1 - sy0) * (sx1 - sx0));
    }
  }
  return out;
}

/** Reduce la imagen para que su lado mayor no pase de `maxSide`. Devuelve también el factor aplicado. */
export function shrinkTo(img: GrayImage, maxSide: number): { image: GrayImage; factor: number } {
  const factor = Math.max(1, Math.max(img.width, img.height) / maxSide);
  return { image: factor > 1 ? downscale(img, factor) : img, factor };
}

/**
 * Remuestreo bilineal con giro y escala en una sola pasada.
 * `angleDeg` es la inclinación del texto en la imagen original (positiva = las líneas bajan hacia la derecha);
 * el resultado queda con las líneas horizontales. El lienzo se agranda lo justo para no cortar esquinas.
 */
export function resample(img: GrayImage, opts: { angleDeg?: number; scale?: number; background?: number } = {}): GrayImage {
  const angle = ((opts.angleDeg ?? 0) * Math.PI) / 180;
  const scale = opts.scale ?? 1;
  const bg = opts.background ?? 255;
  if (Math.abs(angle) < 1e-6 && Math.abs(scale - 1) < 1e-6) return { width: img.width, height: img.height, data: img.data.slice() };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const W = img.width;
  const H = img.height;
  const outW = Math.max(1, Math.round((Math.abs(W * cos) + Math.abs(H * sin)) * scale));
  const outH = Math.max(1, Math.round((Math.abs(W * sin) + Math.abs(H * cos)) * scale));
  const out = createGray(outW, outH, 0);
  const src = img.data;
  const d = out.data;
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const ocx = (outW - 1) / 2;
  const ocy = (outH - 1) / 2;
  const inv = 1 / scale;
  for (let v = 0; v < outH; v++) {
    const dv = (v - ocy) * inv;
    // Origen = R(angle) · destino
    let sx = cx + (-ocx * inv) * cos - dv * sin;
    let sy = cy + (-ocx * inv) * sin + dv * cos;
    const stepX = inv * cos;
    const stepY = inv * sin;
    let o = v * outW;
    for (let u = 0; u < outW; u++, o++, sx += stepX, sy += stepY) {
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < -1 || y0 < -1 || x0 >= W || y0 >= H) {
        d[o] = bg;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const p00 = x0 >= 0 && y0 >= 0 ? src[y0 * W + x0] : bg;
      const p10 = x1 < W && y0 >= 0 ? src[y0 * W + x1] : bg;
      const p01 = x0 >= 0 && y1 < H ? src[y1 * W + x0] : bg;
      const p11 = x1 < W && y1 < H ? src[y1 * W + x1] : bg;
      d[o] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
    }
  }
  return out;
}

// ───────────────────────────── Bordes oscuros (fotos de móvil) ─────────────────────────────

/**
 * Detecta el papel dentro de una foto con fondo oscuro (mesa, mostrador): recorta desde cada borde las filas/columnas
 * donde el papel claro es minoría. Devuelve el rectángulo en coordenadas de `img`, o undefined si no hay bordes
 * oscuros claros (escaneos, capturas de pantalla, PDF renderizados).
 */
export function detectPaper(img: GrayImage): Rect | undefined {
  const { image: small, factor } = shrinkTo(img, 500);
  const w = small.width;
  const h = small.height;
  if (w < 20 || h < 20) return undefined;
  const hist = histogram(small);
  const t = otsuThreshold(hist);
  // Brillo típico del papel y del fondo
  const paper = percentileIn(hist, 0.5, t + 1, 255);
  const dark = percentileIn(hist, 0.5, 0, t);
  if (paper - dark < 40) return undefined;
  const bright = (v: number) => v > t;
  const rowFrac = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (bright(small.data[y * w + x])) n++;
    return n / w;
  };
  const colFrac = (x: number) => {
    let n = 0;
    for (let y = 0; y < h; y++) if (bright(small.data[y * w + x])) n++;
    return n / h;
  };
  const limitY = Math.floor(h * 0.3);
  const limitX = Math.floor(w * 0.3);
  let y0 = 0;
  while (y0 < limitY && rowFrac(y0) < 0.5) y0++;
  let y1 = h - 1;
  while (y1 > h - 1 - limitY && rowFrac(y1) < 0.5) y1--;
  let x0 = 0;
  while (x0 < limitX && colFrac(x0) < 0.5) x0++;
  let x1 = w - 1;
  while (x1 > w - 1 - limitX && colFrac(x1) < 0.5) x1--;
  const cropped = y0 + (h - 1 - y1) + x0 + (w - 1 - x1);
  if (cropped < 4) return undefined;
  // El margen recortado debe ser realmente oscuro (no una cabecera de color)
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y >= y0 && y <= y1 && x >= x0 && x <= x1) continue;
      sum += small.data[y * w + x];
      n++;
    }
  }
  if (!n || sum / n > t) return undefined;
  // Un pequeño margen hacia dentro elimina la sombra del borde del papel
  const pad = 0.006 * Math.max(w, h);
  return {
    x0: Math.max(0, (x0 + (x0 ? pad : 0)) * factor),
    y0: Math.max(0, (y0 + (y0 ? pad : 0)) * factor),
    x1: Math.min(img.width, (x1 + 1 - (x1 < w - 1 ? pad : 0)) * factor),
    y1: Math.min(img.height, (y1 + 1 - (y1 < h - 1 ? pad : 0)) * factor),
  };
}

/**
 * Blanquea las zonas oscuras conectadas con el borde de la imagen (restos de mesa en las esquinas tras enderezar),
 * recorriendo desde cada borde hasta el primer píxel claro.
 */
export function whitenDarkMargins(img: GrayImage, threshold: number): void {
  const { width: w, height: h, data: d } = img;
  const maxRun = (n: number) => Math.floor(n * 0.2);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0, lim = maxRun(w); x < lim && d[row + x] < threshold; x++) d[row + x] = 255;
    for (let x = w - 1, lim = w - 1 - maxRun(w); x > lim && d[row + x] < threshold; x--) d[row + x] = 255;
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0, lim = maxRun(h); y < lim && d[y * w + x] < threshold; y++) d[y * w + x] = 255;
    for (let y = h - 1, lim = h - 1 - maxRun(h); y > lim && d[y * w + x] < threshold; y--) d[y * w + x] = 255;
  }
}

// ───────────────────────────── Perspectiva (foto del papel sobre una mesa) ─────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** Cuadrilátero del papel en la foto: esquinas superior izquierda, superior derecha, inferior derecha e inferior izquierda. */
export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function quadArea(q: Quad): number {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function angleAt(prev: Point, p: Point, next: Point): number {
  const a = Math.atan2(prev.y - p.y, prev.x - p.x);
  const b = Math.atan2(next.y - p.y, next.x - p.x);
  let d = Math.abs(a - b) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

/** ¿El punto está dentro del cuadrilátero (convexo)? */
function insideQuad(q: Quad, x: number, y: number): boolean {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c === 0) continue;
    const sg = c > 0 ? 1 : -1;
    if (!sign) sign = sg;
    else if (sg !== sign) return false;
  }
  return true;
}

/**
 * Localiza el papel en una foto con fondo más oscuro (mesa, mostrador) y devuelve sus cuatro esquinas, para
 * rectificar la perspectiva. El fondo es lo oscuro conectado con el borde de la foto; el papel, la mayor zona
 * restante. Devuelve undefined si no hay un papel claro con forma de cuadrilátero (escaneos, capturas, PDF).
 */
export function detectQuad(img: GrayImage): Quad | undefined {
  const { image: small, factor } = shrinkTo(img, 600);
  const { width: w, height: h, data: d } = small;
  if (w < 40 || h < 40) return undefined;
  const hist = histogram(small);
  const t = otsuThreshold(hist);
  const paper = percentileIn(hist, 0.5, t + 1, 255);
  const dark = percentileIn(hist, 0.5, 0, t);
  if (paper - dark < 40) return undefined;
  // 1) Fondo: píxeles oscuros conectados con el borde
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const pushIf = (i: number) => {
    if (!bg[i] && d[i] <= t) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    pushIf(x);
    pushIf((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    pushIf(y * w);
    pushIf(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % w;
    if (x > 0) pushIf(i - 1);
    if (x < w - 1) pushIf(i + 1);
    if (i >= w) pushIf(i - w);
    if (i < w * (h - 1)) pushIf(i + w);
  }
  let bgCount = 0;
  for (let i = 0; i < bg.length; i++) bgCount += bg[i];
  if (bgCount < w * h * 0.03) return undefined;
  // 2) Mayor componente de "no fondo" (el papel, con su texto dentro)
  const comp = new Int32Array(w * h).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  let id = 0;
  for (let start = 0; start < w * h; start++) {
    if (bg[start] || comp[start] >= 0) continue;
    let size = 0;
    stack.push(start);
    comp[start] = id;
    while (stack.length) {
      const i = stack.pop() as number;
      size++;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && !bg[j] && comp[j] < 0) {
          comp[j] = id;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
    id++;
  }
  if (bestId < 0 || bestSize < w * h * 0.2) return undefined;
  // 3) Esquinas por puntos extremos (válido con giros de hasta ~40°)
  let tl = { x: 0, y: 0, v: Infinity };
  let br = { x: 0, y: 0, v: -Infinity };
  let tr = { x: 0, y: 0, v: -Infinity };
  let bl = { x: 0, y: 0, v: -Infinity };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (comp[y * w + x] !== bestId) continue;
      const s1 = x + y;
      const s2 = x - y;
      if (s1 < tl.v) tl = { x, y, v: s1 };
      if (s1 > br.v) br = { x, y, v: s1 };
      if (s2 > tr.v) tr = { x, y, v: s2 };
      if (-s2 > bl.v) bl = { x, y, v: -s2 };
    }
  }
  const q: Quad = { tl: { x: tl.x, y: tl.y }, tr: { x: tr.x + 1, y: tr.y }, br: { x: br.x + 1, y: br.y + 1 }, bl: { x: bl.x, y: bl.y + 1 } };
  // 4) Validación: forma razonable, el papel llena su cuadrilátero y hay fondo fuera
  const area = quadArea(q);
  if (area < w * h * 0.2) return undefined;
  const pts = [q.tl, q.tr, q.br, q.bl];
  for (let i = 0; i < 4; i++) {
    const ang = angleAt(pts[(i + 3) % 4], pts[i], pts[(i + 1) % 4]);
    if (ang < 55 || ang > 125) return undefined;
  }
  let inside = 0;
  let insidePaper = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (!insideQuad(q, x + 0.5, y + 0.5)) continue;
      inside++;
      if (comp[y * w + x] === bestId) insidePaper++;
    }
  }
  if (!inside || insidePaper / inside < 0.9) return undefined;
  // Sin fondo apreciable fuera del papel: no hay nada que rectificar
  if (area > w * h * 0.97) return undefined;
  // Un poco hacia dentro para quitar la sombra del borde del papel
  const cx = (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4;
  const cy = (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4;
  const inset = (p: Point): Point => {
    const k = 0.006;
    return { x: (p.x + (cx - p.x) * k) * factor, y: (p.y + (cy - p.y) * k) * factor };
  };
  return { tl: inset(q.tl), tr: inset(q.tr), br: inset(q.br), bl: inset(q.bl) };
}

/** Tamaño natural del papel rectificado (media de los lados opuestos). */
export function quadSize(q: Quad): { width: number; height: number } {
  return { width: (dist(q.tl, q.tr) + dist(q.bl, q.br)) / 2, height: (dist(q.tl, q.bl) + dist(q.tr, q.br)) / 2 };
}

/** Homografía que lleva el rectángulo [0,W]×[0,H] al cuadrilátero (coeficientes h0..h7, h8 = 1). */
function homography(q: Quad, W: number, H: number): number[] | undefined {
  const src: [number, number][] = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ];
  const dst = [q.tl, q.tr, q.br, q.bl];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const { x, y } = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  // Eliminación gaussiana con pivote parcial
  const n = 8;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return undefined;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

/** Rectifica la perspectiva: el cuadrilátero `q` de `img` pasa a ser una imagen de `outW`×`outH` (bilineal). */
export function warpPerspective(img: GrayImage, q: Quad, outW: number, outH: number, background = 255): GrayImage {
  const W = Math.max(1, Math.round(outW));
  const H = Math.max(1, Math.round(outH));
  const hm = homography(q, W, H);
  if (!hm) return img;
  const [a, b, c, d0, e, f, g, h] = hm;
  const out = createGray(W, H, 0);
  const src = img.data;
  const sw = img.width;
  const sh = img.height;
  const o = out.data;
  for (let v = 0; v < H; v++) {
    const vv = v + 0.5;
    for (let u = 0; u < W; u++) {
      const uu = u + 0.5;
      const den = g * uu + h * vv + 1;
      const sx = (a * uu + b * vv + c) / den - 0.5;
      const sy = (d0 * uu + e * vv + f) / den - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) {
        o[v * W + u] = background;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * sw + x0;
      o[v * W + u] = (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + sw] * (1 - fx) + src[i + sw + 1] * fx) * fy;
    }
  }
  return out;
}

// ───────────────────────────── Ruido ─────────────────────────────

/**
 * Desviación típica del ruido (método de Immerkær: convolución con un laplaciano y media del valor absoluto).
 * Rápida y bastante insensible al contenido de la imagen. Muestrea una de cada `step` filas.
 */
export function estimateNoise(img: GrayImage, step = 2): number {
  const { width: w, height: h, data: d } = img;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += step) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      const v =
        d[r0 + x - 1] - 2 * d[r0 + x] + d[r0 + x + 1] - 2 * d[r1 + x - 1] + 4 * d[r1 + x] - 2 * d[r1 + x + 1] + d[r2 + x - 1] - 2 * d[r2 + x] + d[r2 + x + 1];
      sum += v < 0 ? -v : v;
      n++;
    }
  }
  return n ? (Math.sqrt(Math.PI / 2) * sum) / (6 * n) : 0;
}

/** Mediana 3×3 (red de ordenación de 19 comparaciones). */
export function median3(img: GrayImage): GrayImage {
  const { width: w, height: h, data: s } = img;
  const out = createGray(w, h, 0);
  const d = out.data;
  const v = new Int32Array(9);
  const sw = (a: number, b: number) => {
    if (v[a] > v[b]) {
      const t = v[a];
      v[a] = v[b];
      v[b] = t;
    }
  };
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      v[0] = s[ym * w + xm];
      v[1] = s[ym * w + x];
      v[2] = s[ym * w + xp];
      v[3] = s[y * w + xm];
      v[4] = s[y * w + x];
      v[5] = s[y * w + xp];
      v[6] = s[yp * w + xm];
      v[7] = s[yp * w + x];
      v[8] = s[yp * w + xp];
      sw(1, 2); sw(4, 5); sw(7, 8); sw(0, 1); sw(3, 4); sw(6, 7); sw(1, 2); sw(4, 5); sw(7, 8);
      sw(0, 3); sw(5, 8); sw(4, 7); sw(3, 6); sw(1, 4); sw(2, 5); sw(4, 7); sw(4, 2); sw(6, 4); sw(4, 2);
      d[y * w + x] = v[4];
    }
  }
  return out;
}

// ───────────────────────────── Fondo y contraste ─────────────────────────────

/**
 * Aplana el fondo: estima el brillo del papel por bloques (percentil alto), lo suaviza y divide cada píxel por él.
 * Elimina sombras de la mano o del móvil y degradados de iluminación, que confunden al umbral global de Tesseract.
 * Modifica la imagen en su sitio.
 */
export function flattenBackground(img: GrayImage, blockSize?: number): void {
  const { width: w, height: h, data: d } = img;
  const bs = Math.max(8, Math.round(blockSize ?? Math.max(w, h) / 48));
  const gw = Math.ceil(w / bs);
  const gh = Math.ceil(h / bs);
  const bg = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      hist.fill(0);
      const x0 = bx * bs;
      const y0 = by * bs;
      const x1 = Math.min(w, x0 + bs);
      const y1 = Math.min(h, y0 + bs);
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) hist[d[y * w + x]]++;
      bg[by * gw + bx] = percentileIn(hist, 0.9);
    }
  }
  // Bloques muy tintados (texto grande, logotipos): el máximo de sus vecinos representa mejor al papel
  const dilated = new Float32Array(bg.length);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = by + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = bx + dx;
          if (xx < 0 || xx >= gw) continue;
          m = Math.max(m, bg[yy * gw + xx]);
        }
      }
      dilated[by * gw + bx] = m;
    }
  }
  const smooth = new Float32Array(bg.length);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = by + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = bx + dx;
          if (xx < 0 || xx >= gw) continue;
          s += dilated[yy * gw + xx];
          n++;
        }
      }
      smooth[by * gw + bx] = s / n;
    }
  }
  // Interpolación bilineal entre centros de bloque
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5));
    const gy0 = Math.floor(gy);
    const gy1 = Math.min(gh - 1, gy0 + 1);
    const fy = gy - gy0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5));
      const gx0 = Math.floor(gx);
      const gx1 = Math.min(gw - 1, gx0 + 1);
      const fx = gx - gx0;
      const b =
        (smooth[gy0 * gw + gx0] * (1 - fx) + smooth[gy0 * gw + gx1] * fx) * (1 - fy) + (smooth[gy1 * gw + gx0] * (1 - fx) + smooth[gy1 * gw + gx1] * fx) * fy;
      if (b < 48) continue; // zona oscura de verdad (fuera del papel): no se toca
      const i = y * w + x;
      d[i] = (d[i] * 255) / b;
    }
  }
}

/**
 * Estira el contraste: la tinta típica pasa a negro y el papel a blanco. Usa Otsu para separar tinta y papel y
 * percentiles de cada clase (robusto con poca tinta o fondos de color). Modifica la imagen en su sitio.
 */
export function stretchContrast(img: GrayImage): void {
  const hist = histogram(img, img.data.length > 4e6 ? 3 : 1);
  const t = otsuThreshold(hist);
  const ink = percentileIn(hist, 0.1, 0, t);
  const paper = percentileIn(hist, 0.6, t + 1, 255);
  if (paper - ink < 24) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - ink) * 255) / (paper - ink);
  const d = img.data;
  for (let i = 0; i < d.length; i++) d[i] = lut[d[i]];
}

// ───────────────────────────── Inclinación y tamaño del texto ─────────────────────────────

interface InkPoints {
  xs: Int32Array;
  ys: Int32Array;
  n: number;
  width: number;
  height: number;
}

function inkPoints(img: GrayImage, maxPoints = 250_000): InkPoints {
  const t = otsuThreshold(histogram(img));
  const { width: w, height: h, data: d } = img;
  let count = 0;
  for (let i = 0; i < d.length; i++) if (d[i] <= t) count++;
  const step = Math.max(1, Math.ceil(count / maxPoints));
  const n = Math.ceil(count / step);
  const xs = new Int32Array(n);
  const ys = new Int32Array(n);
  let k = 0;
  let seen = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[y * w + x] > t) continue;
      if (seen++ % step === 0 && k < n) {
        xs[k] = x;
        ys[k] = y;
        k++;
      }
    }
  }
  return { xs, ys, n: k, width: w, height: h };
}

/** Nitidez del perfil de proyección tras cizallar las filas con la pendiente `tan`. */
function profileScore(p: InkPoints, tan: number, bins: Float64Array): number {
  bins.fill(0);
  const offset = Math.abs(tan) * p.width + 1;
  const len = bins.length;
  for (let i = 0; i < p.n; i++) {
    const r = Math.round(p.ys[i] - p.xs[i] * tan + offset);
    if (r >= 0 && r < len) bins[r]++;
  }
  // Suma de cuadrados de las diferencias entre filas contiguas (método de Postl): máxima con líneas horizontales
  let s = 0;
  for (let r = 1; r < len; r++) {
    const dlt = bins[r] - bins[r - 1];
    s += dlt * dlt;
  }
  return s;
}

/**
 * Estima la inclinación del texto (grados, positiva = las líneas bajan hacia la derecha) buscando el ángulo que
 * hace más nítido el perfil de proyección horizontal. Búsqueda gruesa cada 0,5° en ±maxDeg y fina cada 0,05°.
 * Devuelve 0 si no hay texto suficiente o la mejora es insignificante.
 */
export function estimateSkew(img: GrayImage, maxDeg = 8): number {
  const { image: small } = shrinkTo(img, 1000);
  const p = inkPoints(small);
  if (p.n < 200) return 0;
  const bins = new Float64Array(Math.ceil(small.height + Math.tan((maxDeg * Math.PI) / 180) * small.width * 2 + 4));
  const scoreAt = (deg: number) => profileScore(p, Math.tan((deg * Math.PI) / 180), bins);
  let best = 0;
  let bestScore = scoreAt(0);
  const zeroScore = bestScore;
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += 0.5) {
    const s = scoreAt(a);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  const coarse = best;
  for (let a = coarse - 0.5; a <= coarse + 0.5 + 1e-9; a += 0.05) {
    const s = scoreAt(a);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  if (Math.abs(best) < 0.08) return 0;
  if (bestScore < zeroScore * 1.02) return 0;
  return Math.round(best * 100) / 100;
}

/**
 * Altura típica de las líneas de texto (px, en la escala de `img`): mediana de las bandas con tinta del perfil de
 * proyección horizontal. Supone el texto ya enderezado. undefined si no se detectan líneas.
 */
export function estimateLineHeight(img: GrayImage): number | undefined {
  const { image: small, factor } = shrinkTo(img, 1600);
  const { width: w, height: h, data: d } = small;
  const t = otsuThreshold(histogram(small));
  const prof = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) if (d[row + x] <= t) n++;
    prof[y] = n;
  }
  const minInk = Math.max(2, w * 0.004);
  const runs: number[] = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && prof[y] >= minInk;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      const len = y - start;
      // Descarta filetes de tabla (1–2 px muy densos) y bloques enormes (fotos, logotipos)
      let sum = 0;
      for (let k = start; k < y; k++) sum += prof[k];
      const density = sum / (len * w);
      if (len >= 3 && len < h * 0.25 && !(len <= 3 && density > 0.5)) runs.push(len);
      start = -1;
    }
  }
  if (runs.length < 2) return undefined;
  runs.sort((a, b) => a - b);
  return runs[runs.length >> 1] * factor;
}

// ───────────────────────────── Filetes de tabla ─────────────────────────────

/**
 * Borra los filetes horizontales y verticales de las tablas (líneas finas y largas). Tesseract confunde los
 * números pegados a un filete ("22,25" subrayado) y lee los bordes verticales como "|" o "1". Las barras gruesas
 * (cabeceras en negativo) se respetan. Modifica la imagen en su sitio. Devuelve el número de píxeles borrados.
 */
export function removeRules(img: GrayImage, lineHeight: number): number {
  const { width: w, height: h, data: d } = img;
  const t = otsuThreshold(histogram(img, d.length > 4e6 ? 3 : 1));
  const maxThick = Math.max(2, Math.round(lineHeight * 0.18));
  const mask = new Uint8Array(w * h);
  let removed = 0;
  // Horizontales
  const minH = Math.max(lineHeight * 4, w * 0.12);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const dark = x < w && d[row + x] <= t;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        if (x - start >= minH) for (let k = start; k < x; k++) mask[row + k] = 1;
        start = -1;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && mask[y * w + x] === 1;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start <= maxThick) {
          for (let k = start; k < y; k++) {
            d[k * w + x] = 255;
            removed++;
          }
        }
        start = -1;
      }
    }
  }
  // Verticales
  mask.fill(0);
  const minV = Math.max(lineHeight * 3, h * 0.05);
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const dark = y < h && d[y * w + x] <= t;
      if (dark && start < 0) start = y;
      if (!dark && start >= 0) {
        if (y - start >= minV) for (let k = start; k < y; k++) mask[k * w + x] = 1;
        start = -1;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[row + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start <= maxThick) {
          for (let k = start; k < x; k++) {
            d[row + k] = 255;
            removed++;
          }
        }
        start = -1;
      }
    }
  }
  return removed;
}

// ───────────────────────────── Binarización adaptativa ─────────────────────────────

/**
 * Binarización de Sauvola: T = m · (1 + k · (s / R − 1)) con media y desviación locales en una ventana de
 * `window` px. Las estadísticas se agregan por bloques de 4×4 px (exactas a esa granularidad) para no necesitar
 * imágenes integrales de 64 bits a resolución completa.
 */
export function sauvola(img: GrayImage, opts: { window?: number; k?: number; r?: number } = {}): GrayImage {
  const { width: w, height: h, data: d } = img;
  const k = opts.k ?? 0.3;
  const R = opts.r ?? 128;
  const bs = 4;
  const gw = Math.ceil(w / bs);
  const gh = Math.ceil(h / bs);
  const iw = gw + 1;
  const sum = new Float64Array(iw * (gh + 1));
  const sq = new Float64Array(iw * (gh + 1));
  const cnt = new Float64Array(iw * (gh + 1));
  // Sumas por bloque directamente en la posición (bx+1, by+1) de las integrales
  for (let y = 0; y < h; y++) {
    const by = (y >> 2) + 1;
    for (let x = 0; x < w; x++) {
      const v = d[y * w + x];
      const idx = by * iw + (x >> 2) + 1;
      sum[idx] += v;
      sq[idx] += v * v;
      cnt[idx]++;
    }
  }
  for (let by = 1; by <= gh; by++) {
    for (let bx = 1; bx <= gw; bx++) {
      const i = by * iw + bx;
      sum[i] += sum[i - 1] + sum[i - iw] - sum[i - iw - 1];
      sq[i] += sq[i - 1] + sq[i - iw] - sq[i - iw - 1];
      cnt[i] += cnt[i - 1] + cnt[i - iw] - cnt[i - iw - 1];
    }
  }
  const rb = Math.max(1, Math.round((opts.window ?? 64) / (2 * bs)));
  const thr = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) {
    const y0 = Math.max(0, by - rb);
    const y1 = Math.min(gh, by + rb + 1);
    for (let bx = 0; bx < gw; bx++) {
      const x0 = Math.max(0, bx - rb);
      const x1 = Math.min(gw, bx + rb + 1);
      const a = y0 * iw + x0;
      const b = y0 * iw + x1;
      const c = y1 * iw + x0;
      const e = y1 * iw + x1;
      const n = cnt[e] - cnt[b] - cnt[c] + cnt[a];
      const s = sum[e] - sum[b] - sum[c] + sum[a];
      const s2 = sq[e] - sq[b] - sq[c] + sq[a];
      const m = s / n;
      const sd = Math.sqrt(Math.max(0, s2 / n - m * m));
      thr[by * gw + bx] = m * (1 + k * (sd / R - 1));
    }
  }
  const out = createGray(w, h, 0);
  const o = out.data;
  for (let y = 0; y < h; y++) {
    const rowT = (y >> 2) * gw;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      o[i] = d[i] <= thr[rowT + (x >> 2)] ? 0 : 255;
    }
  }
  return out;
}

// ───────────────────────────── Canal completo ─────────────────────────────

export interface OcrPrepOptions {
  /** Altura objetivo de las líneas de texto en px (por defecto 36: lo que mejor lee el modelo LSTM de Tesseract). */
  targetLineHeight?: number;
  /** Ampliación máxima (por defecto 2,5). */
  maxUpscale?: number;
  /** Límite de píxeles del resultado (por defecto 24 MP). */
  maxPixels?: number;
  /** Límite del lado mayor del resultado (por defecto 6000 px). */
  maxSide?: number;
  deskew?: boolean;
  /** Recortar los bordes oscuros de las fotos (por defecto sí). */
  crop?: boolean;
  /** 'auto' = sólo si el ruido estimado es alto. */
  denoise?: 'auto' | boolean;
  /** Binarizar con Sauvola (por defecto no: Tesseract umbraliza bien una imagen ya normalizada). */
  binarize?: boolean;
}

export interface OcrPrepInfo {
  /** Inclinación corregida (grados). */
  skewDeg: number;
  /** Escala aplicada. */
  scale: number;
  cropped: boolean;
  denoised: boolean;
  binarized: boolean;
  /** Altura de línea estimada (px) antes de escalar. */
  lineHeight?: number;
  noise: number;
  width: number;
  height: number;
}

/** Prepara una imagen en escala de grises para OCR (ver el canal completo en la cabecera del módulo). */
export function prepareForOcr(input: GrayImage, opts: OcrPrepOptions = {}): { image: GrayImage; info: OcrPrepInfo } {
  let img = input;
  const target = opts.targetLineHeight ?? 36;
  const maxUp = opts.maxUpscale ?? 2.5;
  const maxPixels = opts.maxPixels ?? 24e6;
  const maxSide = opts.maxSide ?? 6000;
  const scaleFor = (lineHeight: number | undefined, w: number, h: number) => {
    let scale = 1;
    if (lineHeight !== undefined) {
      if (lineHeight < target * 0.8) scale = Math.min(maxUp, target / lineHeight);
      else if (lineHeight > target * 2.5) scale = (target * 1.5) / lineHeight;
    }
    scale = Math.min(scale, Math.sqrt(maxPixels / (w * h)), maxSide / Math.max(w, h));
    return Math.abs(scale - 1) < 0.08 ? 1 : scale;
  };

  // 1) Ruido (antes de cualquier remuestreo, a la resolución original)
  const noise = estimateNoise(img);
  let denoised = false;
  if (opts.denoise === true || (opts.denoise !== false && noise > 7)) {
    img = median3(img);
    denoised = true;
  }

  // 2) Foto del papel sobre una mesa: rectificación de perspectiva (recorta y endereza a la vez)
  const quad = opts.crop === false ? undefined : detectQuad(img);
  if (quad) {
    const size = quadSize(quad);
    // Tamaño del texto medido sobre una rectificación reducida
    const { image: small, factor } = shrinkTo(img, 1200);
    const sq: Quad = {
      tl: { x: quad.tl.x / factor, y: quad.tl.y / factor },
      tr: { x: quad.tr.x / factor, y: quad.tr.y / factor },
      br: { x: quad.br.x / factor, y: quad.br.y / factor },
      bl: { x: quad.bl.x / factor, y: quad.bl.y / factor },
    };
    const preview = warpPerspective(small, sq, size.width / factor, size.height / factor);
    flattenBackground(preview);
    stretchContrast(preview);
    const skewSmall = opts.deskew === false ? 0 : estimateSkew(preview);
    const lhSmall = estimateLineHeight(skewSmall ? resample(preview, { angleDeg: skewSmall }) : preview);
    const lineHeight = lhSmall !== undefined ? lhSmall * factor : undefined;
    const scale = scaleFor(lineHeight, size.width, size.height);
    img = warpPerspective(img, quad, size.width * scale, size.height * scale);
    flattenBackground(img);
    stretchContrast(img);
    // Giro residual (papel curvado o esquinas mal detectadas)
    const skew = opts.deskew === false ? 0 : estimateSkew(img);
    if (skew) img = resample(img, { angleDeg: skew, background: 255 });
    return finish(img, { skewDeg: skew, scale, cropped: true, denoised, lineHeight, noise }, opts, target);
  }

  // 3) Sin perspectiva: recorte de bordes oscuros, fondo, contraste, inclinación y escala
  let cropped = false;
  if (opts.crop !== false) {
    const paper = detectPaper(img);
    if (paper) {
      img = crop(img, paper);
      cropped = true;
    }
  }
  if (img === input) img = { width: img.width, height: img.height, data: img.data.slice() };
  flattenBackground(img);
  stretchContrast(img);
  const skew = opts.deskew === false ? 0 : estimateSkew(img);
  const { image: small, factor } = shrinkTo(img, 1600);
  const straight = skew ? resample(small, { angleDeg: skew }) : small;
  const lh = estimateLineHeight(straight);
  const lineHeight = lh !== undefined ? lh * factor : undefined;
  const scale = scaleFor(lineHeight, img.width, img.height);
  if (skew || scale !== 1) img = resample(img, { angleDeg: skew, scale, background: 255 });
  if (cropped) whitenDarkMargins(img, 70);
  return finish(img, { skewDeg: skew, scale, cropped, denoised, lineHeight, noise }, opts, target);
}

function finish(
  img: GrayImage,
  info: Omit<OcrPrepInfo, 'binarized' | 'width' | 'height'>,
  opts: OcrPrepOptions,
  target: number,
): { image: GrayImage; info: OcrPrepInfo } {
  let out = img;
  let binarized = false;
  if (opts.binarize) {
    const window = Math.max(24, Math.round((info.lineHeight ?? target) * info.scale * 2.5));
    out = sauvola(img, { window, k: 0.25 });
    binarized = true;
  }
  return { image: out, info: { ...info, noise: Math.round(info.noise * 10) / 10, binarized, width: out.width, height: out.height } };
}
