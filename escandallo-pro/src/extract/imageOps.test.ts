import { describe, expect, it } from 'vitest';
import {
  createGray,
  detectPaper,
  detectQuad,
  encodePgm,
  estimateLineHeight,
  estimateNoise,
  estimateSkew,
  grayToRgba,
  histogram,
  median3,
  otsuThreshold,
  prepareForOcr,
  quadSize,
  removeRules,
  resample,
  rgbaToGray,
  sauvola,
  warpPerspective,
  type GrayImage,
  type Quad,
} from './imageOps';

// ───────────────────────────── Imágenes sintéticas ─────────────────────────────

function fillRect(img: GrayImage, x0: number, y0: number, w: number, h: number, v: number): void {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) img.data[y * img.width + x] = v;
}

/** "Página" con renglones de "palabras" (rectángulos oscuros) de la altura indicada. */
function page(width: number, height: number, lineH: number, opts: { gap?: number; margin?: number; bg?: number } = {}): GrayImage {
  const img = createGray(width, height, opts.bg ?? 245);
  const gap = opts.gap ?? lineH;
  const margin = opts.margin ?? Math.round(width * 0.08);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = margin; y + lineH < height - margin; y += lineH + gap) {
    let x = margin;
    while (x < width - margin - 20) {
      const w = Math.round(lineH * (1.5 + rnd() * 4));
      fillRect(img, x, y, Math.min(w, width - margin - x), lineH, 20);
      x += w + Math.round(lineH * 0.6);
    }
  }
  return img;
}

function meanIn(img: GrayImage, x0: number, y0: number, w: number, h: number): number {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    s += img.data[y * img.width + x];
    n++;
  }
  return s / n;
}

describe('conversión y codificación', () => {
  it('RGBA ↔ gris y PGM para Tesseract', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 10, 20, 30, 255]);
    const g = rgbaToGray(rgba, 3, 1);
    expect(Array.from(g.data)).toEqual([76, 255, 18]);
    expect(Array.from(grayToRgba(g).slice(0, 4))).toEqual([76, 76, 76, 255]);
    const pgm = encodePgm(g);
    expect(new TextDecoder().decode(pgm.slice(0, 11))).toBe('P5\n3 1\n255\n');
    expect(Array.from(pgm.slice(11))).toEqual([76, 255, 18]);
  });

  it('Otsu separa tinta y papel', () => {
    const img = createGray(100, 100, 230);
    fillRect(img, 10, 10, 30, 30, 40);
    const t = otsuThreshold(histogram(img));
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(230);
  });
});

describe('geometría', () => {
  it('estima la inclinación del texto y el remuestreo la corrige', () => {
    const straight = page(800, 1000, 14);
    const tilted = resample(straight, { angleDeg: -3, background: 245 });
    const skew = estimateSkew(tilted);
    expect(Math.abs(skew - 3)).toBeLessThan(0.25);
    expect(Math.abs(estimateSkew(resample(tilted, { angleDeg: skew, background: 245 })))).toBeLessThan(0.25);
    expect(estimateSkew(straight)).toBe(0);
  });

  it('mide la altura de las líneas de texto', () => {
    const lh = estimateLineHeight(page(900, 1200, 18));
    expect(lh).toBeGreaterThan(15);
    expect(lh).toBeLessThan(21);
  });

  it('remuestrea con escala', () => {
    const img = page(200, 100, 10);
    const big = resample(img, { scale: 2 });
    expect(big.width).toBe(400);
    expect(big.height).toBe(200);
  });
});

describe('fotos de móvil', () => {
  /** Papel claro (con texto) girado sobre una mesa oscura. */
  function photo(): { img: GrayImage; quad: Quad } {
    const W = 900;
    const H = 1200;
    const img = createGray(W, H, 60);
    const quad: Quad = { tl: { x: 150, y: 110 }, tr: { x: 760, y: 150 }, br: { x: 730, y: 1080 }, bl: { x: 120, y: 1050 } };
    // Rellena el cuadrilátero de papel con renglones oscuros
    const inside = (x: number, y: number) => {
      const pts = [quad.tl, quad.tr, quad.br, quad.bl];
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
      }
      return true;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) img.data[y * W + x] = 235;
    for (let row = 0; row < 18; row++) {
      const y = 220 + row * 45;
      for (let x = 230; x < 640; x++) for (let k = 0; k < 14; k++) if (inside(x, y + k + ((x - 230) * 40) / 610) && (x % 40) < 30) img.data[(y + k + Math.round(((x - 230) * 40) / 610)) * W + x] = 30;
    }
    return { img, quad };
  }

  it('localiza las esquinas del papel', () => {
    const { img, quad } = photo();
    const q = detectQuad(img);
    expect(q).toBeDefined();
    for (const k of ['tl', 'tr', 'br', 'bl'] as const) {
      expect(Math.abs((q as Quad)[k].x - quad[k].x)).toBeLessThan(15);
      expect(Math.abs((q as Quad)[k].y - quad[k].y)).toBeLessThan(15);
    }
  });

  it('rectifica la perspectiva: el papel ocupa toda la imagen', () => {
    const { img } = photo();
    const q = detectQuad(img) as Quad;
    const { width, height } = quadSize(q);
    const flat = warpPerspective(img, q, width, height);
    expect(meanIn(flat, 0, 0, 20, 20)).toBeGreaterThan(200);
    expect(meanIn(flat, flat.width - 20, flat.height - 20, 20, 20)).toBeGreaterThan(200);
  });

  it('no hay papel que recortar en un escaneo', () => {
    const scan = page(600, 800, 12);
    expect(detectQuad(scan)).toBeUndefined();
    expect(detectPaper(scan)).toBeUndefined();
  });
});

describe('limpieza', () => {
  it('estima el ruido y la mediana lo elimina', () => {
    const clean = page(300, 300, 12);
    const noisy = { ...clean, data: clean.data.slice() };
    let s = 3;
    for (let i = 0; i < noisy.data.length; i += 7) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      noisy.data[i] = s % 2 ? 0 : 255;
    }
    expect(estimateNoise(noisy)).toBeGreaterThan(estimateNoise(clean) + 5);
    expect(estimateNoise(median3(noisy))).toBeLessThan(estimateNoise(noisy) / 2);
  });

  it('Sauvola binariza con fondo irregular (sombra)', () => {
    const img = createGray(400, 200, 0);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) img.data[y * 400 + x] = 120 + Math.round((x / 400) * 120);
    fillRect(img, 30, 80, 40, 12, 60);
    fillRect(img, 330, 80, 40, 12, 150);
    const bin = sauvola(img, { window: 40 });
    expect(meanIn(bin, 35, 83, 30, 6)).toBe(0);
    expect(meanIn(bin, 335, 83, 30, 6)).toBe(0);
    expect(meanIn(bin, 150, 20, 40, 20)).toBe(255);
  });

  it('borra filetes de tabla finos y largos sin tocar el texto', () => {
    const img = page(600, 400, 16, { gap: 30 });
    fillRect(img, 20, 70, 560, 2, 30);
    fillRect(img, 40, 20, 2, 360, 30);
    const removed = removeRules(img, 16);
    expect(removed).toBeGreaterThan(1000);
    expect(meanIn(img, 100, 70, 400, 2)).toBeGreaterThan(200);
    expect(meanIn(img, 60, 48, 20, 10)).toBeLessThan(60);
  });
});

describe('prepareForOcr', () => {
  it('endereza, amplía el texto pequeño y normaliza el contraste', () => {
    const small = resample(page(700, 900, 10, { bg: 190 }), { angleDeg: 2, background: 190 });
    const { image, info } = prepareForOcr(small);
    expect(Math.abs(info.skewDeg + 2)).toBeLessThan(0.3);
    expect(info.scale).toBeGreaterThan(1.5);
    expect(image.width).toBeGreaterThan(small.width * 1.5);
    // El papel gris pasa a blanco
    const hist = histogram(image);
    let bright = 0;
    for (let v = 230; v < 256; v++) bright += hist[v];
    expect(bright / (image.width * image.height)).toBeGreaterThan(0.5);
  });

  it('binarización opcional', () => {
    const { image, info } = prepareForOcr(page(500, 600, 20), { binarize: true });
    expect(info.binarized).toBe(true);
    expect(new Set(image.data).size).toBeLessThanOrEqual(2);
  });
});
