import type { GrayImage } from './imageOps';

/**
 * Polaridad de las fotos de carta (lógica pura, sin DOM). Las pizarras y las cartas de fondo oscuro llevan el texto
 * claro sobre fondo oscuro: el preprocesado para OCR (pensado para papel claro) toma ese fondo por la mesa alrededor
 * del papel, recorta y blanquea la carta, y Tesseract no lee nada. Aquí se detecta el fondo oscuro de la propia carta
 * (no el de la mesa: se mira el centro de la foto) y se invierte, entero o sólo en las zonas oscuras (cartas con
 * bandas o recuadros oscuros sobre papel claro), para que el resto del canal reciba siempre texto oscuro sobre claro.
 */

export interface PolarityResult {
  image: GrayImage;
  /** none = ya era texto oscuro sobre claro; global = se ha invertido entera; local = sólo las zonas de fondo oscuro. */
  inverted: 'none' | 'global' | 'local';
  /** Proporción del centro de la foto con fondo oscuro (0–1). */
  darkShare: number;
}

/** Luminancia por debajo de la cual un fondo se considera oscuro. */
const DARK = 110;

/** Mediana aproximada (histograma de 64 cubos) de un bloque de la imagen. */
function blockMedian(img: GrayImage, x0: number, y0: number, x1: number, y1: number, hist: Uint32Array): number {
  hist.fill(0);
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 16));
  for (let y = y0; y < y1; y += step) {
    const row = y * img.width;
    for (let x = x0; x < x1; x += step) {
      hist[img.data[row + x] >> 2]++;
      n++;
    }
  }
  let acc = 0;
  for (let b = 0; b < 64; b++) {
    acc += hist[b];
    if (acc * 2 >= n) return b * 4 + 2;
  }
  return 255;
}

/**
 * Mapa de fondo: mediana por bloques (el texto ocupa bastante menos de la mitad de cada bloque, así que la mediana es el
 * fondo) suavizada con la mediana de sus vecinos para no dejarse engañar por un titular grueso.
 */
function backgroundMap(img: GrayImage): { bg: Float64Array; cols: number; rows: number; bw: number; bh: number } {
  const target = 48;
  const bw = Math.max(8, Math.round(img.width / target));
  const bh = Math.max(8, Math.round(img.height / Math.max(1, Math.round((img.height / img.width) * target))));
  const cols = Math.max(1, Math.ceil(img.width / bw));
  const rows = Math.max(1, Math.ceil(img.height / bh));
  const raw = new Float64Array(cols * rows);
  const hist = new Uint32Array(64);
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < cols; bx++) {
      raw[by * cols + bx] = blockMedian(img, bx * bw, by * bh, Math.min(img.width, (bx + 1) * bw), Math.min(img.height, (by + 1) * bh), hist);
    }
  const bg = new Float64Array(cols * rows);
  const win: number[] = [];
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < cols; bx++) {
      win.length = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (x >= 0 && y >= 0 && x < cols && y < rows) win.push(raw[y * cols + x]);
        }
      win.sort((a, b) => a - b);
      bg[by * cols + bx] = win[win.length >> 1];
    }
  return { bg, cols, rows, bw, bh };
}

/**
 * Deja la foto de la carta con texto oscuro sobre fondo claro. Si el centro de la foto es mayoritariamente oscuro
 * (pizarra, carta negra) se invierte entera; si sólo lo son algunas zonas amplias del centro (bandas, recuadros), se
 * invierten sólo esas zonas. Una foto de papel claro sobre una mesa oscura no se toca (su centro es claro).
 */
export function normalizeMenuPolarity(img: GrayImage): PolarityResult {
  if (img.width < 16 || img.height < 16) return { image: img, inverted: 'none', darkShare: 0 };
  const { bg, cols, rows, bw, bh } = backgroundMap(img);
  // Centro de la foto (70 % × 70 %): ahí está la carta aunque alrededor se vea la mesa
  const cx0 = Math.floor(cols * 0.15);
  const cx1 = Math.max(cx0 + 1, Math.ceil(cols * 0.85));
  const cy0 = Math.floor(rows * 0.15);
  const cy1 = Math.max(cy0 + 1, Math.ceil(rows * 0.85));
  let dark = 0;
  let total = 0;
  for (let y = cy0; y < cy1; y++)
    for (let x = cx0; x < cx1; x++) {
      total++;
      if (bg[y * cols + x] < DARK) dark++;
    }
  const darkShare = total ? dark / total : 0;
  if (darkShare < 0.25) return { image: img, inverted: 'none', darkShare };
  const out = new Uint8ClampedArray(img.data.length);
  if (darkShare >= 0.85) {
    for (let i = 0; i < img.data.length; i++) out[i] = 255 - img.data[i];
    return { image: { width: img.width, height: img.height, data: out }, inverted: 'global', darkShare };
  }
  // Inversión local: cada píxel según el fondo interpolado de los bloques vecinos
  for (let y = 0; y < img.height; y++) {
    const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / bh - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(rows - 1, y0 + 1);
    const ty = fy - y0;
    const row = y * img.width;
    for (let x = 0; x < img.width; x++) {
      const fx = Math.min(cols - 1, Math.max(0, (x + 0.5) / bw - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(cols - 1, x0 + 1);
      const tx = fx - x0;
      const b = (bg[y0 * cols + x0] * (1 - tx) + bg[y0 * cols + x1] * tx) * (1 - ty) + (bg[y1 * cols + x0] * (1 - tx) + bg[y1 * cols + x1] * tx) * ty;
      const v = img.data[row + x];
      out[row + x] = b < 128 ? 255 - v : v;
    }
  }
  return { image: { width: img.width, height: img.height, data: out }, inverted: 'local', darkShare };
}
