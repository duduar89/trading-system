import { describe, expect, it } from 'vitest';
import type { ExtractedMenu, ProgressInfo } from '../types';
import { createGray, type OcrPrepInfo } from './imageOps';
import type { TessPage } from './ocrLayout';
import { INVOICE_PASSES_PADDLE, MENU_PADDLE_OPTIONS, MENU_PASSES, MENU_PASSES_PADDLE, ocrInvoice, ocrMenu, type OcrBackend, type PreparedPage } from './ocrPipeline';

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

  it('con las opciones de la app, Tesseract sólo entra de reserva: no por confianza baja, sí si Paddle se queda corto', async () => {
    const unsure = (text: string): ExtractedMenu => ({ ...parse(text), entries: parse(text).entries.map((e) => ({ ...e, confidence: 0.5 })) });
    const ok = backend({ paddle: RICH });
    await ocrMenu(pages(), ok, unsure, { ...MENU_PADDLE_OPTIONS });
    expect(ok.calls).toEqual(['paddle']);
    const short = backend({ paddle: POOR });
    await ocrMenu(pages(), short, unsure, { ...MENU_PADDLE_OPTIONS });
    expect(short.calls).toEqual(['paddle', 'tesseract:3']);
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

describe('ocrInvoice con el lector PaddleOCR (fotos de facturas)', () => {
  const HEAD = ['Frutas García S.L.            CIF: B28123456', 'Nº Factura: FV-9         Fecha: 18/09/2026', 'Código   Descripción              Cantidad   Ud.   Precio   Importe'];
  const FOOT = ['Base imponible   45,19', 'IVA 4%   1,81', 'TOTAL FACTURA   47,00'];
  const good = [
    ...HEAD,
    '1102   TOMATE PERA CAT.I         12,400   KG     1,85     22,94',
    '1201   AJO MORADO                 2,000   KG     5,90     11,80',
    '1307   LIMONES MALLA 1KG          3,000   UD     1,95      5,85',
    '1410   PEREJIL MANOJO             8,000   UD     0,575     4,60',
    ...FOOT,
  ].join('\n');
  const bad = good.replace('5,90     11,80', '5,40     11,30');

  it('si la lectura de Paddle cuadra, no hace falta Tesseract', async () => {
    const b = backend({ paddle: good, tess: bad });
    const out = await ocrInvoice(pages(), b, { passes: INVOICE_PASSES_PADDLE });
    expect(b.calls).toEqual(['paddle']);
    expect(out.invoice.lines).toHaveLength(4);
    expect(out.passes[0]).toMatchObject({ id: 'paddle', engine: 'paddle' });
  });

  it('si Paddle no cuadra, Tesseract rescata y se combinan las lecturas', async () => {
    const b = backend({ paddle: bad, tess: good });
    const out = await ocrInvoice(pages(), b, { passes: INVOICE_PASSES_PADDLE });
    expect(b.calls).toEqual(['paddle', 'tesseract:6']);
    expect(out.invoice.lines.find((l) => /AJO/.test(l.description))?.total).toBe(11.8);
  });

  it('si Paddle falla o no está, se lee con Tesseract como siempre', async () => {
    const failing = backend({ paddle: new Error('Lector no disponible'), tess: good });
    const out = await ocrInvoice(pages(), failing, { passes: INVOICE_PASSES_PADDLE });
    expect(failing.calls).toEqual(['paddle', 'tesseract:6']);
    expect(out.invoice.lines).toHaveLength(4);
    expect(out.passes[0].failed).toMatch(/no disponible/);
    const none = backend({ tess: good });
    await ocrInvoice(pages(), none, { passes: INVOICE_PASSES_PADDLE });
    expect(none.calls).toEqual(['tesseract:6']);
  });
});
