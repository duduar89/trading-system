import { describe, expect, it } from 'vitest';
import type { ExtractedMenu, ProgressInfo } from '../types';
import { createGray, type OcrPrepInfo } from './imageOps';
import type { TessPage } from './ocrLayout';
import { INVOICE_PASSES, invoiceLooksComplete, menuQuality, ocrInvoice, ocrMenu, preparePages, type OcrBackend, type PreparedPage, type Psm } from './ocrPipeline';

const CW = 12;

/** Página de Tesseract a partir de texto con columnas (cada palabra en su posición de carácter). */
function pageFromText(text: string): TessPage {
  const lines = text.split('\n').map((line, i) => {
    const y = 60 + i * 50;
    const ws: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) ws.push({ text: m[0], confidence: 91, bbox: { x0: m.index * CW, y0: y - 24, x1: (m.index + m[0].length) * CW, y1: y } });
    const x1 = ws.length ? ws[ws.length - 1].bbox.x1 : 0;
    return { text: line, confidence: 91, bbox: { x0: 0, y0: y - 24, x1, y1: y }, baseline: { x0: 0, y0: y, x1: Math.max(x1, 1), y1: y }, words: ws };
  });
  return { text, confidence: 91, blocks: [{ paragraphs: [{ lines: lines.filter((l) => l.words.length) }] }] };
}

const INFO: OcrPrepInfo = { skewDeg: 0, scale: 1, cropped: false, denoised: false, binarized: false, lineHeight: 36, noise: 1, width: 200, height: 200 };
const pages = (): PreparedPage[] => [{ image: createGray(200, 200), info: { ...INFO } }];

function fakeBackend(responses: string[]): OcrBackend & { calls: Psm[] } {
  const calls: Psm[] = [];
  return {
    calls,
    async recognize(_image, psm, onProgress) {
      calls.push(psm);
      onProgress?.(0.5);
      const text = responses[Math.min(calls.length - 1, responses.length - 1)];
      return pageFromText(text);
    },
  };
}

const HEAD = ['Frutas García S.L.            CIF: B28123456', 'Nº Factura: FV-9         Fecha: 18/09/2026', 'Código   Descripción              Cantidad   Ud.   Precio   Importe'];
const FOOT = ['Base imponible   45,19', 'IVA 4%   1,81', 'TOTAL FACTURA   47,00'];
const good = [...HEAD, '1102   TOMATE PERA CAT.I         12,400   KG     1,85     22,94', '1201   AJO MORADO                 2,000   KG     5,90     11,80', '1307   LIMONES MALLA 1KG          3,000   UD     1,95      5,85', '1410   PEREJIL MANOJO             8,000   UD     0,575     4,60', ...FOOT].join('\n');
// Primera lectura: precio e importe mal leídos en una línea, importe ilegible en otra y una O por un cero
const bad = good.replace('5,90     11,80', '5,40     11,30').replace('0,575     4,60', '0,575     4,6O').replace('1,85     22,94', '1,85     2Z,9A');

describe('ocrInvoice', () => {
  it('se queda en la primera pasada si la factura cuadra', async () => {
    const backend = fakeBackend([good]);
    const out = await ocrInvoice(pages(), backend);
    expect(backend.calls).toEqual(['6']);
    expect(out.invoice.method).toBe('ocr');
    expect(out.invoice.lines).toHaveLength(4);
    expect(invoiceLooksComplete(out.invoice)).toBe(true);
    expect(out.passes[0]).toMatchObject({ id: 'tabla', psm: '6', validated: 4 });
    expect(out.invoice.rawText).toContain('TOMATE PERA');
  });

  it('repite con otra segmentación si no cuadra y combina las lecturas', async () => {
    const backend = fakeBackend([bad, good]);
    const out = await ocrInvoice(pages(), backend);
    expect(backend.calls).toEqual(['6', '6']);
    expect(out.passes).toHaveLength(2);
    expect(out.invoice.lines.map((l) => l.total)).toEqual([22.94, 11.8, 5.85, 4.6]);
    expect(invoiceLooksComplete(out.invoice)).toBe(true);
  });

  it('agota las pasadas si ninguna cuadra y devuelve la mejor combinación', async () => {
    const backend = fakeBackend([bad]);
    const out = await ocrInvoice(pages(), backend);
    expect(backend.calls).toEqual(INVOICE_PASSES.map((p) => p.psm));
    expect(out.invoice.lines.length).toBeGreaterThan(0);
  });

  it('informa del progreso de forma creciente', async () => {
    const events: ProgressInfo[] = [];
    await ocrInvoice(pages(), fakeBackend([bad, good]), { onProgress: (p) => events.push(p) });
    const values = events.map((e) => e.progress ?? 0);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(events[0].stage).toBe('Leyendo texto (OCR)…');
    expect(events.some((e) => e.stage.startsWith('Segunda lectura'))).toBe(true);
  });

  it('preparePages prepara cada imagen', () => {
    const [p] = preparePages([createGray(300, 200, 250)]);
    expect(p.image.width).toBeGreaterThan(0);
    expect(p.info.binarized).toBe(false);
  });
});

describe('ocrMenu', () => {
  const parse = (text: string): ExtractedMenu => ({
    entries: text
      .split('\n')
      .map((l) => /^(.+?)\s{2,}(\d+,\d{2})$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ name: m[1], price: Number(m[2].replace(',', '.')), confidence: 0.9 })),
    method: 'ocr',
    warnings: [],
  });

  it('repite si se leen pocos platos y se queda con la mejor lectura', async () => {
    const poor = 'CARTA\nCroquetas   9,50';
    const rich = 'CARTA\nCroquetas   9,50\nPulpo   18,00\nBravas   6,50\nTarta   6,00';
    const backend = fakeBackend([poor, rich]);
    const out = await ocrMenu(pages(), backend, parse);
    expect(backend.calls).toEqual(['3', '4']);
    expect(out.menu.entries).toHaveLength(4);
    expect(out.menu.method).toBe('ocr');
    expect(menuQuality(out.menu)).toBeGreaterThan(3);
  });
});
