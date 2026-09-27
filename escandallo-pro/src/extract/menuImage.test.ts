import { describe, expect, it } from 'vitest';
import type { GrayImage } from './imageOps';
import { normalizeMenuPolarity } from './menuImage';

/** Imagen sintética: fondo `bg` con renglones de «texto» (trazos) de color `ink`; `rect` pinta una zona de otro fondo. */
function page(w: number, h: number, bg: number, ink: number, rect?: { x0: number; y0: number; x1: number; y1: number; bg: number; ink: number }): GrayImage {
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inRect = rect && x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1;
      const b = inRect ? rect.bg : bg;
      const k = inRect ? rect.ink : ink;
      // Trazos: renglones de 6 px cada 20 px, con palabras de 30 px separadas por 10 px
      const stroke = y % 20 < 6 && x % 40 < 30 && x > 10 && x < w - 10;
      data[y * w + x] = stroke ? k : b;
    }
  return { width: w, height: h, data };
}

const at = (img: GrayImage, x: number, y: number) => img.data[y * img.width + x];

describe('normalizeMenuPolarity', () => {
  it('una carta de papel claro no se toca', () => {
    const img = page(400, 600, 240, 30);
    const r = normalizeMenuPolarity(img);
    expect(r.inverted).toBe('none');
    expect(r.image).toBe(img);
  });

  it('una pizarra (texto claro sobre fondo oscuro) se invierte entera', () => {
    const img = page(400, 600, 40, 230);
    const r = normalizeMenuPolarity(img);
    expect(r.inverted).toBe('global');
    expect(at(r.image, 5, 10)).toBe(255 - 40);
    expect(at(r.image, 20, 2)).toBe(255 - 230);
  });

  it('papel claro fotografiado sobre una mesa oscura: el centro manda y no se invierte', () => {
    // Mesa oscura en un marco de 60 px alrededor del papel
    const w = 500;
    const h = 700;
    const img = page(w, h, 40, 40, { x0: 60, y0: 60, x1: w - 60, y1: h - 60, bg: 235, ink: 25 });
    expect(normalizeMenuPolarity(img).inverted).toBe('none');
  });

  it('carta clara con un gran recuadro oscuro: sólo se invierte el recuadro', () => {
    const img = page(480, 640, 235, 25, { x0: 0, y0: 200, x1: 480, y1: 520, bg: 35, ink: 225 });
    const r = normalizeMenuPolarity(img);
    expect(r.inverted).toBe('local');
    // Fuera del recuadro, igual; dentro, texto oscuro sobre claro
    expect(at(r.image, 5, 50)).toBe(235);
    expect(at(r.image, 240, 350)).toBeGreaterThan(200);
    expect(at(r.image, 20, 402)).toBeLessThan(60);
  });
});
