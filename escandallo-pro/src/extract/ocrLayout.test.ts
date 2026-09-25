import { describe, expect, it } from 'vitest';
import type { PdfTextLine } from './pdf';
import { columnsReadingOrder, isNoiseWord, ocrPagesToResult, pageWords, residualSlope, wordsToRows, type TessBlock, type TessLine, type TessPage } from './ocrLayout';

const CW = 10;
const H = 20;

/** Línea de Tesseract: palabras [texto, x] sobre la línea base `y` (con pendiente opcional). */
function tline(y: number, words: [string, number, number?][], slope = 0): TessLine {
  const ws = words.map(([text, x, conf]) => {
    const w = text.length * CW;
    const by = y + slope * (x + w / 2);
    return { text, confidence: conf ?? 90, bbox: { x0: x, y0: Math.round(by - H), x1: x + w, y1: Math.round(by) } };
  });
  const x0 = Math.min(...ws.map((w) => w.bbox.x0));
  const x1 = Math.max(...ws.map((w) => w.bbox.x1));
  return {
    text: words.map((w) => w[0]).join(' '),
    confidence: 90,
    bbox: { x0, y0: Math.min(...ws.map((w) => w.bbox.y0)), x1, y1: Math.max(...ws.map((w) => w.bbox.y1)) },
    baseline: { x0, y0: y + slope * x0, x1, y1: y + slope * x1 },
    rowAttributes: { rowHeight: H },
    words: ws,
  };
}

function tpage(blocks: TessLine[][]): TessPage {
  const bs: TessBlock[] = blocks.map((lines) => ({ paragraphs: [{ lines }] }));
  return { text: blocks.flat().map((l) => l.text).join('\n'), confidence: 88, blocks: bs };
}

describe('filas a partir de las palabras del OCR', () => {
  it('une en una fila los bloques de descripción y de números con separadores de columna', () => {
    // Tesseract (PSM 3) devuelve la columna de descripciones y la de números como bloques distintos
    const page = tpage([
      [tline(100, [['1021', 0], ['PATATA', 80], ['AGRIA', 150]]), tline(150, [['1044', 0], ['CEBOLLA', 80]])],
      [tline(101, [['25,000', 500], ['KG', 580], ['0,89', 680], ['22,25', 800]]), tline(151, [['10,000', 500], ['KG', 580], ['1,15', 680], ['11,50', 800]])],
    ]);
    const res = ocrPagesToResult([{ page }]);
    expect(res.rows).toHaveLength(2);
    expect(res.lines[0].text).toMatch(/^1021 {2,}PATATA AGRIA {2,}25,000 {2,}KG {2,}0,89 {2,}22,25$/);
    expect(res.rows?.[1].items.map((i) => i.str)).toEqual(['1044', 'CEBOLLA', '10,000', 'KG', '1,15', '11,50']);
    expect(res.text.split('\n')).toHaveLength(2);
    expect(res.confidence).toBeCloseTo(90, 0);
    expect(res.words).toHaveLength(13);
  });

  it('corrige la inclinación residual con las líneas base', () => {
    const slope = 0.02; // 1,15° que quedan tras enderezar
    const page = tpage([
      [tline(100, [['SOLOMILLO', 0], ['TERNERA', 95], ['4,620', 700], ['33,50', 800], ['154,77', 900]], slope)],
      [tline(145, [['LOMO', 0], ['ALTO', 60], ['6,100', 700], ['29,90', 800], ['182,39', 900]], slope)],
    ]);
    expect(residualSlope(page)).toBeCloseTo(slope, 3);
    const res = ocrPagesToResult([{ page }]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows?.[0].items.map((i) => i.str)).toEqual(['SOLOMILLO TERNERA', '4,620', '33,50', '154,77']);
  });

  it('descarta el ruido de filetes y motas y quita los rellenos de puntos', () => {
    expect(isNoiseWord({ text: '|', confidence: 40, bbox: { x0: 0, y0: 0, x1: 3, y1: 60 } }, 20)).toBe(true);
    expect(isNoiseWord({ text: '—', confidence: 95, bbox: { x0: 0, y0: 0, x1: 30, y1: 3 } }, 20)).toBe(true);
    expect(isNoiseWord({ text: 'MG', confidence: 10, bbox: { x0: 0, y0: 0, x1: 20, y1: 20 } }, 20)).toBe(false);
    expect(isNoiseWord({ text: 'l', confidence: 12, bbox: { x0: 0, y0: 0, x1: 3, y1: 22 } }, 20)).toBe(true);
    const page = tpage([[tline(100, [['Croquetas', 0], ['.............', 100], ['9,50', 400], ['|', 460, 30]])]]);
    const res = ocrPagesToResult([{ page }], 'columns');
    expect(res.lines[0].text).toMatch(/^Croquetas {2,}9,50$/);
  });

  it('pageWords conserva línea, bloque y altura de línea', () => {
    const words = pageWords(tpage([[tline(100, [['A', 0], ['B', 50]])], [tline(100, [['C', 300]])]]), 2);
    expect(words.map((w) => [w.text, w.page, w.block, w.line, w.lineHeight])).toEqual([
      ['A', 2, 0, 1, 20],
      ['B', 2, 0, 1, 20],
      ['C', 2, 1, 2, 20],
    ]);
  });

  it('sin cajas (sólo texto) devuelve una línea por línea de texto', () => {
    const res = ocrPagesToResult([{ page: { text: 'Hola\n\nAdiós', confidence: 70, blocks: null } }]);
    expect(res.lines.map((l) => l.text)).toEqual(['Hola', 'Adiós']);
    expect(res.rows).toBeUndefined();
  });
});

describe('cartas a varias columnas', () => {
  const left: [string, number][][] = [
    [['ENTRANTES', 0]],
    [['Croquetas', 0], ['de', 100], ['jamón', 130], ['9,50', 420]],
    [['Pulpo', 0], ['a', 60], ['la', 80], ['gallega', 110], ['18,00', 410]],
    [['Ensaladilla', 0], ['rusa', 120], ['7,50', 420]],
    [['Gambas', 0], ['al', 70], ['ajillo', 100], ['14,00', 410]],
  ];
  const right: [string, number][][] = [
    [['POSTRES', 700]],
    [['Tarta', 700], ['de', 760], ['queso', 790], ['6,50', 1120]],
    [['Torrija', 700], ['casera', 780], ['7,00', 1120]],
    [['Flan', 700], ['de', 750], ['huevo', 780], ['5,00', 1120]],
    [['Helado', 700], ['artesano', 770], ['5,50', 1120]],
  ];
  const page = tpage(left.map((l, i) => [tline(100 + i * 50, l), tline(100 + i * 50, right[i])]));

  it('lee primero la columna izquierda y luego la derecha, sin separar platos y precios', () => {
    const res = ocrPagesToResult([{ page }], 'columns');
    const lines = res.lines.map((l) => l.text.replace(/\s{2,}/g, ' | '));
    expect(lines).toEqual([
      'ENTRANTES',
      'Croquetas de jamón | 9,50',
      'Pulpo a la gallega | 18,00',
      'Ensaladilla rusa | 7,50',
      'Gambas al ajillo | 14,00',
      'POSTRES',
      'Tarta de queso | 6,50',
      'Torrija casera | 7,00',
      'Flan de huevo | 5,00',
      'Helado artesano | 5,50',
    ]);
  });

  it('en modo tabla (facturas) no separa columnas', () => {
    const res = ocrPagesToResult([{ page }], 'table');
    expect(res.lines).toHaveLength(5);
  });

  it('una sola columna con precios alineados a la derecha no se parte', () => {
    const single = tpage([left.map((l, i) => tline(100 + i * 50, l))]);
    const res = ocrPagesToResult([{ page: single }], 'columns');
    expect(res.lines.map((l) => l.text.replace(/\s{2,}/g, ' | '))[1]).toBe('Croquetas de jamón | 9,50');
  });

  it('también ordena por columnas la capa de texto de un PDF de carta', () => {
    const pdfLines: PdfTextLine[] = left.map((l, i) => {
      const items = [...l, ...right[i]].map(([str, x]) => ({ str, x, width: str.length * CW }));
      return { page: 1, y: 100 + i * 50, text: items.map((it) => it.str).join('  '), items };
    });
    const ordered = columnsReadingOrder(pdfLines).map((l) => l.text.replace(/\s{2,}/g, ' | '));
    expect(ordered[0]).toBe('ENTRANTES');
    expect(ordered[5]).toBe('POSTRES');
    expect(ordered).toHaveLength(10);
  });

  it('wordsToRows devuelve confianza y caja por fila', () => {
    const rows = wordsToRows(pageWords(page), 1, { mode: 'columns' });
    expect(rows[1].confidence).toBeCloseTo(90, 0);
    expect(rows[1].bbox.x0).toBe(0);
    expect(rows[1].bbox.x1).toBe(460);
  });
});
