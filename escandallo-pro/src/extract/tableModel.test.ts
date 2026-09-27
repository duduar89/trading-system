import { describe, expect, it } from 'vitest';
import { buildTableModel, classifyLabel, columnIndex, headerPhrases, stackHeaderRows, type TRow, type TWord } from './tableModel';

const isUnitWord = (s: string) => /^(?:kg|kgs|ud|uds|u|caja|cj|bot|l|lt|malla|manojo)\.?$/i.test(s);

/** Palabras de una fila de texto monoespaciado (x = columna del carácter); dos o más espacios separan celdas. */
function textRow(text: string): TRow {
  const words: TWord[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let seg = 0;
  let lastEnd = -10;
  while ((m = re.exec(text))) {
    if (m.index - lastEnd >= 2) seg++;
    words.push({ text: m[0], x0: m.index, x1: m.index + m[0].length, seg, num: /^-?\d[\d.,]*$/.test(m[0]) });
    lastEnd = m.index + m[0].length;
  }
  return { words, cw: 1 };
}

describe('classifyLabel: sinónimos de las cabeceras', () => {
  const cases: [string, string | undefined, string?][] = [
    ['Código', 'code'],
    ['Cód. Art.', 'code'],
    ['Ref.', 'code'],
    ['EAN13', 'ean'],
    ['Cód. barras', 'ean'],
    ['Descripción', 'desc'],
    ['Descripción del artículo', 'desc'],
    ['Artículo', 'desc'],
    ['Concepto', 'desc'],
    ['Denominación', 'desc'],
    ['Cant.', 'qty'],
    ['Cantidad servida', 'qty'],
    ['Kilos', 'qty', 'kg'],
    ['Neto kg', 'qty', 'kg'],
    ['Peso (kg)', 'qty', 'kg'],
    ['Botellas', 'qty', 'bot'],
    ['Uds.', 'uds'],
    ['Piezas', 'uds'],
    ['Nº bultos', 'bultos'],
    ['Cajas', 'bultos', 'caja'],
    ['U.M.', 'unit'],
    ['Ud.', 'unit'],
    ['Formato', 'unit'],
    ['P. Unit.', 'price'],
    ['Precio unitario', 'price'],
    ['Precio neto', 'price'],
    ['€/kg', 'price'],
    ['Tarifa', 'price'],
    ['P.U.', 'price'],
    ['Dto.', 'disc'],
    ['% Dto', 'disc'],
    ['Dto.2', 'disc'],
    ['Desc. 1', 'disc'],
    ['Importe', 'total'],
    ['Importe neto', 'total'],
    ['Total línea', 'total'],
    ['Importe €', 'total'],
    ['Base', 'total'],
    ['% IVA', 'vat'],
    ['I.V.A.', 'vat'],
    ['T. IVA', 'vat'],
    ['Tipo', 'vat'],
    ['Nº Lote', 'lot'],
    ['F. Cad.', 'cad'],
    ['Cons. pref.', 'cad'],
    ['Origen', 'origin'],
    ['Lín.', 'line'],
    ['Observaciones', undefined],
  ];
  it.each(cases)('%s → %s', (label, kind, unit) => {
    const info = classifyLabel(label);
    expect(info.kind).toBe(kind);
    if (unit) expect(info.unit ?? info.perUnit).toBe(unit);
  });
  it('precio por kilo', () => {
    expect(classifyLabel('Precio/kg')).toEqual({ kind: 'price', perUnit: 'kg' });
  });
});

describe('headerPhrases: etiquetas de varias palabras', () => {
  it('cabecera monoespaciada con un solo espacio entre columnas', () => {
    const row = textRow('Nº BULTOS CANTIDAD SERVIDA P. UNITARIO BASE IVA %');
    const phrases = headerPhrases(row.words);
    expect(phrases.map((p) => [p.text, p.info.kind])).toEqual([
      ['Nº BULTOS', 'bultos'],
      ['CANTIDAD SERVIDA', 'qty'],
      ['P. UNITARIO', 'price'],
      ['BASE', 'total'],
      ['IVA %', 'vat'],
    ]);
  });
  it('dos descuentos seguidos no se unen', () => {
    const phrases = headerPhrases(textRow('DTO 1 DTO 2 IMPORTE').words);
    expect(phrases.map((p) => p.text)).toEqual(['DTO 1', 'DTO 2', 'IMPORTE']);
  });
  it('etiquetas en celdas distintas nunca se unen', () => {
    const phrases = headerPhrases(textRow('Precio    unitario').words);
    expect(phrases).toHaveLength(2);
  });
  it('apila etiquetas partidas y hereda las de grupo', () => {
    const top = headerPhrases(textRow('               Precio       Cantidad    ').words);
    const bottom = headerPhrases(textRow('Descripción    unitario     Uds    Kg   Importe').words);
    const stacked = stackHeaderRows([top, bottom]);
    expect(stacked.map((p) => [p.text, p.info.kind])).toEqual([
      ['Descripción', 'desc'],
      ['Precio unitario', 'price'],
      ['Uds', 'uds'],
      ['Kg', 'qty'],
      ['Importe', 'total'],
    ]);
  });
});

describe('buildTableModel: columnas por las calles de los datos', () => {
  it('etiquetas a la izquierda sobre números alineados a la derecha', () => {
    const header = textRow('Código  Descripción                 Uds   Kilos     Precio   Importe');
    const rows = [
      textRow('3001    SOLOMILLO DE TERNERA          2     4,380     32,50     142,35'),
      textRow('3005    ENTRECOT DE VACA MADURADA     3     6,215     27,90     173,40'),
      textRow('3060    HAMBURGUESA VACUNO 180G      24                0,95      22,80'),
    ];
    const model = buildTableModel(headerPhrases(header.words), rows, { isUnitWord });
    expect(model?.columns.map((c) => c.kind)).toEqual(['code', 'desc', 'uds', 'qty', 'price', 'total']);
    const kilos = model?.columns[3];
    expect(kilos?.unit).toBe('kg');
    // El "180G" de la descripción cae en la columna de descripción
    const w = rows[2].words.find((x) => x.text === '180G');
    expect(w && model ? model.columns[columnIndex(model.columns, w)].kind : undefined).toBe('desc');
  });
  it('columna sin etiqueta con unidades de medida', () => {
    const header = textRow('Descripción           Cantidad       Precio   Importe');
    const rows = [textRow('TOMATE PERA              12,500  KG      1,25     15,63'), textRow('LECHUGA ICEBERG              24  UD      0,68     16,32')];
    const model = buildTableModel(headerPhrases(header.words), rows, { isUnitWord });
    expect(model?.columns.map((c) => c.kind)).toEqual(['desc', 'qty', 'unit', 'price', 'total']);
  });
  it('columnas pegadas por un solo espacio se separan con las etiquetas', () => {
    const header = textRow('DESCRIPCION         CANT PRECIO IMPORTE');
    const rows = [textRow('TOMATE PERA           12 1,25    15,00'), textRow('PATATA AGRIA          40 0,80    32,00')];
    const model = buildTableModel(headerPhrases(header.words), rows, { isUnitWord });
    expect(model?.columns.map((c) => c.kind)).toEqual(['desc', 'qty', 'price', 'total']);
  });
});
