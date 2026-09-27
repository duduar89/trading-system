import { describe, expect, it } from 'vitest';
import type { ExtractedMenu, ProgressInfo } from '../types';
import { createGray, type OcrPrepInfo } from './imageOps';
import type { TessPage } from './ocrLayout';
import { MENU_PASSES, MENU_PASSES_PADDLE, ocrMenu, type OcrBackend, type PreparedPage } from './ocrPipeline';

const CW = 12;

/** Página al estilo Tesseract a partir de texto con columnas (cada palabra en su posición de carácter). */
function pageFromText(text: string): TessPage {
  const lines = text.split('\n').map((line, i) => {
    const y = 60 + i * 50;
    const ws: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) ws.push({ text: m[0], confidence: 95, bbox: { x0: m.index * CW, y0: y - 24, x1: (m.index + m[0].length) * CW, y1: y } });
    const x1 = ws.length ? ws[ws.length - 1].bbox.x1 : 0;
    return { text: line, confidence: 95, bbox: { x0: 0, y0: y - 24, x1, y1: y }, baseline: { x0: 0, y0: y, x1: Math.max(x1, 1), y1: y }, words: ws };
  });
  return { text, confidence: 95, blocks: [{ paragraphs: [{ lines: lines.filter((l) => l.words.length) }] }] };
}

const INFO: OcrPrepInfo = { skewDeg: 0, scale: 1, cropped: false, denoised: false, binarized: false, lineHeight: 36, noise: 1, width: 200, height: 200 };
const pages = (): PreparedPage[] => [{ image: createGray(200, 200), info: { ...INFO } }];

const parse = (text: string): ExtractedMenu => ({
  entries: text
    .split('\n')
    .map((l) => /^(.+?)\s{2,}(\d+,\d{2})$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ name: m[1], price: Number(m[2].replace(',', '.')), confidence: 0.9 })),
  method: 'ocr',
  warnings: [],
});

const RICH = 'CARTA\nCroquetas   9,50\nPulpo   18,00\nBravas   6,50\nTarta   6,00';
const POOR = 'CARTA\nCroquetas   9,50';

function backend(opts: { paddle?: string | Error; tess?: string }): OcrBackend & { calls: string[] } {
  const calls: string[] = [];
  const b: OcrBackend & { calls: string[] } = {
    calls,
    async recognize(_image, psm, onProgress) {
      calls.push(`tesseract:${psm}`);
      onProgress?.(0.5);
      return pageFromText(opts.tess ?? RICH);
    },
  };
  if (opts.paddle !== undefined) {
    const paddle = opts.paddle;
    b.recognizePaddle = async (_image, onProgress) => {
      calls.push('paddle');
      onProgress?.(0.5);
      if (paddle instanceof Error) throw paddle;
      return pageFromText(paddle);
    };
  }
  return b;
}

describe('ocrMenu con el lector PaddleOCR', () => {
  it('lee primero con Paddle y se queda ahí si la carta sale completa', async () => {
    const b = backend({ paddle: RICH });
    const out = await ocrMenu(pages(), b, parse, { passes: MENU_PASSES_PADDLE });
    expect(b.calls).toEqual(['paddle']);
    expect(out.menu.entries).toHaveLength(4);
    expect(out.passes[0]).toMatchObject({ id: 'paddle', engine: 'paddle', validated: 4 });
  });

  it('con minPasses pide la segunda opinión de Tesseract aunque Paddle ya parezca completo', async () => {
    const b = backend({ paddle: RICH });
    await ocrMenu(pages(), b, parse, { passes: MENU_PASSES_PADDLE, minPasses: 2 });
    expect(b.calls).toEqual(['paddle', 'tesseract:3']);
  });

  it('si Paddle no carga, sigue con Tesseract (que ocupa el tramo principal de la barra) y anota el motivo', async () => {
    const b = backend({ paddle: new Error('Este navegador no admite el lector avanzado (WebAssembly SIMD)') });
    const progress: ProgressInfo[] = [];
    const out = await ocrMenu(pages(), b, parse, { passes: MENU_PASSES_PADDLE, onProgress: (p) => progress.push(p) });
    expect(b.calls).toEqual(['paddle', 'tesseract:3']);
    expect(out.menu.entries).toHaveLength(4);
    expect(out.passes[0]).toMatchObject({ id: 'paddle', failed: expect.stringMatching(/SIMD/) });
    expect(out.passes[1]).toMatchObject({ id: 'automatica', engine: 'tesseract' });
    // La lectura de Tesseract se anuncia como la primera (no como «segunda lectura»)
    expect(progress.some((p) => p.stage === 'Leyendo texto (OCR)…' && (p.progress ?? 0) > 0.3)).toBe(true);
    const values = progress.map((p) => p.progress ?? 0);
    expect(values.every((v, i) => i === 0 || v >= values[i - 1] - 1e-9)).toBe(true);
  });

  it('sin lector Paddle en el motor, las pasadas de Paddle se omiten', async () => {
    const b = backend({});
    const out = await ocrMenu(pages(), b, parse, { passes: MENU_PASSES_PADDLE });
    expect(b.calls).toEqual(['tesseract:3']);
    expect(out.passes.map((p) => p.id)).toEqual(['automatica']);
  });

  it('combina Paddle y Tesseract si Paddle se deja platos', async () => {
    const b = backend({ paddle: POOR, tess: RICH });
    const merge = (menus: ExtractedMenu[]): ExtractedMenu => {
      const seen = new Map<string, ExtractedMenu['entries'][number]>();
      for (const m of menus) for (const e of m.entries) if (!seen.has(e.name)) seen.set(e.name, e);
      return { entries: [...seen.values()], method: 'ocr', warnings: [] };
    };
    const out = await ocrMenu(pages(), b, parse, { passes: MENU_PASSES_PADDLE, merge });
    expect(b.calls).toEqual(['paddle', 'tesseract:3']);
    expect(out.menu.entries.map((e) => e.name)).toEqual(['Croquetas', 'Pulpo', 'Bravas', 'Tarta']);
  });

  it('un fallo de Tesseract se sigue propagando', async () => {
    const b: OcrBackend = {
      async recognize() {
        throw new Error('sin memoria');
      },
    };
    await expect(ocrMenu(pages(), b, parse, { passes: MENU_PASSES })).rejects.toThrow('sin memoria');
  });
});
