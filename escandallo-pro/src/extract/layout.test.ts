import { describe, expect, it } from 'vitest';
import { buildLines, linesToText, looksLikeText, type PositionedText } from './layout';
import { pdfItemsToFragments } from './pdf';

/** Fragmento con ancho proporcional al texto (5 unidades por carácter, altura 10). */
function frag(str: string, x: number, y: number, opts: { cw?: number; h?: number } = {}): PositionedText {
  const cw = opts.cw ?? 5;
  return { str, x, width: str.length * cw, y, height: opts.h ?? 10 };
}

describe('buildLines', () => {
  it('agrupa por línea base, ordena por X y separa columnas con 2+ espacios', () => {
    const lines = buildLines([
      frag('22,25', 400, 100.4),
      frag('PATATA AGRIA', 50, 100),
      frag('1021', 0, 99.8),
      frag('25,000', 250, 100.2),
      frag('CEBOLLA', 50, 115),
      frag('11,50', 400, 115),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].items.map((i) => i.str)).toEqual(['1021', 'PATATA AGRIA', '25,000', '22,25']);
    expect(lines[0].text).toMatch(/^1021 {2,}PATATA AGRIA {2,}25,000 {2,}22,25$/);
    expect(lines[1].text).toMatch(/^CEBOLLA {2,}11,50$/);
  });

  it('une con un espacio las palabras cercanas y sin espacio los trozos pegados (kerning)', () => {
    const lines = buildLines([frag('TOMATE', 0, 50), frag('PERA', 33, 50), frag('CA', 56, 50), frag('T.I', 66, 50)]);
    expect(lines[0].text).toBe('TOMATE PERA CAT.I');
    expect(lines[0].items).toHaveLength(1);
  });

  it('respeta los huecos grandes de forma proporcional (columnas alineadas)', () => {
    const [line] = buildLines([frag('A', 0, 10), frag('B', 100, 10)]);
    const gap = line.text.length - 2;
    expect(gap).toBeGreaterThanOrEqual(15);
  });

  it('no mezcla dos líneas muy juntas cuyos textos se solapan en X', () => {
    const lines = buildLines([frag('Lote: 23/456', 50, 100), frag('SOLOMILLO', 50, 104, { h: 10 })]);
    expect(lines).toHaveLength(2);
  });

  it('mantiene en su línea un superíndice o un texto algo desplazado', () => {
    const lines = buildLines([frag('IVA 10', 0, 100, { h: 12 }), frag('%', 31, 97, { h: 7 }), frag('59,66', 200, 100, { h: 12 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/^IVA 10 ?% {2,}59,66$/);
  });

  it('descarta fragmentos vacíos o no finitos', () => {
    expect(buildLines([frag('   ', 0, 0), { str: 'x', x: Number.NaN, width: 5, y: 0, height: 10 }])).toEqual([]);
  });
});

describe('linesToText y looksLikeText', () => {
  it('separa las páginas con una línea en blanco', () => {
    expect(
      linesToText([
        { page: 1, text: 'a' },
        { page: 1, text: 'b' },
        { page: 2, text: 'c' },
      ]),
    ).toBe('a\nb\n\nc');
  });

  it('un PDF escaneado (casi sin texto) no tiene capa de texto útil', () => {
    expect(looksLikeText([{ text: 'Página 1' }], 1)).toBe(false);
    expect(looksLikeText([{ text: 'x'.repeat(45) }], 1)).toBe(true);
    expect(looksLikeText([{ text: 'x'.repeat(45) }], 2)).toBe(false);
    expect(looksLikeText([], 0)).toBe(false);
  });
});

describe('pdfItemsToFragments', () => {
  // Viewport de pdf.js a escala 1 para una página de 842 pt de alto: invierte el eje Y
  const viewport = [1, 0, 0, -1, 0, 842];

  it('pasa a coordenadas de arriba a abajo con ancho y altura de fuente', () => {
    const [f] = pdfItemsToFragments([{ str: 'FACTURA', transform: [12, 0, 0, 12, 100, 800], width: 60, height: 12 }], viewport);
    expect(f).toMatchObject({ str: 'FACTURA', x: 100, y: 42, width: 60, height: 12 });
  });

  it('descarta textos girados (sellos, márgenes verticales) y los vacíos', () => {
    const out = pdfItemsToFragments(
      [
        { str: 'Registro Mercantil', transform: [0, 8, -8, 0, 20, 400], width: 90, height: 8 },
        { str: '   ', transform: [10, 0, 0, 10, 0, 0], width: 5, height: 10 },
        { str: 'ok', transform: [10, 0, 0, 10, 50, 500], width: 10, height: 10 },
        { foo: 'no es un ítem de texto' },
      ],
      viewport,
    );
    expect(out.map((f) => f.str)).toEqual(['ok']);
  });

  it('reconstruye una fila de factura a partir de ítems de pdf.js', () => {
    const items = [
      { str: 'PECHUGA POLLO CAMPERO', transform: [9, 0, 0, 9, 90, 600], width: 110, height: 9 },
      { str: '4,250', transform: [9, 0, 0, 9, 400, 600.3], width: 24, height: 9 },
      { str: 'KG', transform: [9, 0, 0, 9, 440, 600], width: 12, height: 9 },
      { str: '7,60', transform: [9, 0, 0, 9, 480, 600], width: 20, height: 9 },
      { str: '32,30', transform: [9, 0, 0, 9, 530, 600], width: 25, height: 9 },
    ];
    const [line] = buildLines(pdfItemsToFragments(items, viewport));
    expect(line.items.map((i) => i.str)).toEqual(['PECHUGA POLLO CAMPERO', '4,250', 'KG', '7,60', '32,30']);
  });
});
