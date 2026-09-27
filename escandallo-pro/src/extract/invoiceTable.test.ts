import { describe, expect, it } from 'vitest';
import { describeInvoiceTables, parseInvoiceText } from './invoiceParser';
import type { PdfTextLine } from './pdf';
import { despaceLetters } from './textUtils';

/**
 * Regresiones de la generalización de la extracción de facturas (modelo de tabla). Cada caso reproduce una causa raíz
 * detectada con el generador procedimental de facturas (scripts/gen-random-invoices.mjs), no un documento concreto.
 */

/** Filas posicionales como las de pdf.js: cada tramo separado por 2+ espacios es una celda con su X (5 pt por carácter). */
function pdfRows(lines: (string | { text: string; y: number })[], charWidth = 5): PdfTextLine[] {
  return lines.map((entry, i) => {
    const text = typeof entry === 'string' ? entry : entry.text;
    const y = typeof entry === 'string' ? i * 12 : entry.y;
    const items: PdfTextLine['items'] = [];
    const re = /\S+(?: \S+)*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) items.push({ x: m.index * charWidth, width: m[0].length * charWidth, str: m[0] });
    return { page: 1, y, text, items };
  });
}

const parse = (lines: PdfTextLine[]) => parseInvoiceText({ text: lines.map((l) => l.text).join('\n') }, 'pdf-texto', lines);

const HEAD = ['FRUTAS DEL VALLE S.L.', 'CIF: B12345674', 'Factura nº F-2026/0001   Fecha: 03/09/2026', ''];

describe('modelo de tabla: columnas por los datos y etiquetas de la cabecera', () => {
  it('Uds + Kilos con precio por kilo: la cantidad son los kilos y las piezas no se pegan a la descripción', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        'Código  Descripción                     Uds    Kilos     Precio     Importe',
        '3001    SOLOMILLO DE TERNERA              2    4,380      32,50      142,35',
        '3060    HAMBURGUESA DE VACUNO 180G       24                0,95       22,80',
        'Base imponible   165,15',
      ]),
    );
    expect(inv.lines.map((l) => [l.description, l.quantity, l.unit, l.unitPrice, l.total])).toEqual([
      ['SOLOMILLO DE TERNERA', 4.38, 'kg', 32.5, 142.35],
      ['HAMBURGUESA DE VACUNO 180G', 24, 'ud', 0.95, 22.8],
    ]);
    expect(inv.lines[0].code).toBe('3001');
  });

  it('lote, caducidad y EAN quedan fuera de la descripción', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        'EAN              Descripción                   Lote       Cad.          Cant.    Precio    Importe',
        '8412345678905    PATATA PREFRITA 9MM           L2609A     03/2028          10     1,380      13,80',
        '8412345678912    CROQUETA DE JAMÓN 1KG         260914     12/2027           2     6,750      13,50',
      ]),
    );
    expect(inv.lines.map((l) => l.description)).toEqual(['PATATA PREFRITA 9MM', 'CROQUETA DE JAMÓN 1KG']);
    expect(inv.lines.map((l) => [l.quantity, l.unitPrice])).toEqual([
      [10, 1.38],
      [2, 6.75],
    ]);
  });

  it('precio antes de la cantidad y precios de 4 decimales: la cabecera decide (q × p es simétrico)', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        'Artículo                        Precio      Cant.      Importe',
        'SERVILLETA CÓCTEL 20X20         0,0215       1200        25,80',
        'PATATA AGRIA                    0,8950        150       134,25',
        'LECHUGA ICEBERG                 0,6800         24        16,32',
      ]),
    );
    expect(inv.lines.map((l) => [l.quantity, l.unitPrice])).toEqual([
      [1200, 0.0215],
      [150, 0.895],
      [24, 0.68],
    ]);
  });

  it('cabecera monoespaciada con un solo espacio entre columnas ("Nº BULTOS CANTIDAD SERVIDA P. UNITARIO")', () => {
    const tables = describeInvoiceTables(
      { text: '' },
      'pdf-texto',
      pdfRows([
        ...HEAD,
        'DENOMINACION              Nº BULTOS CANTIDAD SERVIDA P. UNITARIO   BASE IVA %',
        'TOMATE PERA                       2           12,500      1,250   15,63 4,00',
        'LECHUGA ROMANA                    1               12      0,650    7,80 4,00',
      ]),
    );
    expect(tables[0].columns.map((c) => c.kind)).toEqual(['desc', 'bultos', 'qty', 'price', 'total', 'vat']);
  });

  it('"Importe % IVA" en la misma celda son dos columnas y "Precio €/kg" una sola', () => {
    const tables = describeInvoiceTables(
      { text: '' },
      'pdf-texto',
      pdfRows([...HEAD, 'Denominación            Kilos   Precio €/kg   Importe % IVA', 'RODABALLO               1,40         23,61     33,05  10 %']),
    );
    expect(tables[0].columns.map((c) => c.kind)).toEqual(['desc', 'qty', 'price', 'total', 'vat']);
  });

  it('tabla sin cabecera: las columnas se votan con las filas que cuadran y el lote no entra en la descripción', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        'PATATA NUEVA                 250616-20    01-2026       32,3   KG     1,39      44,90',
        'AJO SECO MALLA 1KG           L2506D       09/08/2025       4   MALLA  3,61      14,44',
        'LECHUGA ROMANA               250601-16    07-2025         18   UND    1,19      21,42',
        'PATATA AGRIA                 L2506C       15/11/2026     130   KG     1,15     149,50',
        'Base imponible  230,26',
      ]),
    );
    expect(inv.lines.map((l) => l.description)).toEqual(['PATATA NUEVA', 'AJO SECO MALLA 1KG', 'LECHUGA ROMANA', 'PATATA AGRIA']);
    expect(inv.lines.map((l) => l.unit)).toEqual(['kg', 'malla', 'ud', 'kg']);
  });

  it('una línea de producto con un 2 % aparente no es un cuadro de IVA ("REQUESON 500G 2,26 2,00 10,0 4,07")', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        'DESCRIPCION                 PRECIO   SERVIDO   %DTO.    TOTAL',
        'BACON AHUMADO LONCHAS 1KG     8,82      4,00            35,28',
        'REQUESON 500G                 2,26      2,00    10,0     4,07',
        'MANTEQUILLA SIN SAL 1KG       8,13      7,00            56,91',
        'Base imponible  96,26   IVA 10%  9,63   Total  105,89',
      ]),
    );
    expect(inv.lines).toHaveLength(3);
    expect(inv.lines[1]).toMatchObject({ description: 'REQUESON 500G', quantity: 2, unitPrice: 2.26, discountPct: 10, total: 4.07 });
    expect(inv.subtotal).toBe(96.26);
  });
});

describe('descripciones en varias filas', () => {
  it('alineación arriba: la fila siguiente continúa la descripción; un título de sección separado no', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        // Paso entre líneas 16 pt (texto de 12 pt + relleno); el título de sección lleva 6 pt más de aire encima
        { text: 'Código  Descripción              Cant.   Precio   Importe', y: 60 },
        { text: 'J100    JAMÓN IBÉRICO DE BELLOTA    10    12,80    128,00', y: 76 },
        { text: '        LONCHEADO A CUCHILLO', y: 88 },
        { text: 'L305    LOMO EMBUCHADO IBÉRICO       1    38,90     38,90', y: 104 },
        { text: 'S420    SALCHICHÓN IBÉRICO           1    18,20     18,20', y: 120 },
        { text: 'Q501    QUESO DE OVEJA CURADO        1    17,80     17,80', y: 136 },
        { text: '        CHARCUTERÍA', y: 158 },
        { text: 'C410    CHORIZO IBÉRICO CULAR        2    16,40     32,80', y: 174 },
      ]),
    );
    expect(inv.lines.map((l) => l.description)).toEqual([
      'JAMÓN IBÉRICO DE BELLOTA LONCHEADO A CUCHILLO',
      'LOMO EMBUCHADO IBÉRICO',
      'SALCHICHÓN IBÉRICO',
      'QUESO DE OVEJA CURADO',
      'CHORIZO IBÉRICO CULAR',
    ]);
  });

  it('celdas centradas en vertical: los números quedan entre las dos filas de la descripción', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        { text: 'Descripción                     Código    Cant.    Precio    Importe', y: 60 },
        { text: 'NATA PARA COCINAR 1L', y: 76 },
        { text: '                                25-7892       6     2,928      17,57', y: 80.5 },
        { text: 'FORMATO HOSTELERÍA', y: 85 },
        { text: 'QUESO CREMA 2KG', y: 98 },
        { text: '                                68-9294       4    10,249      41,00', y: 102.5 },
        { text: 'PRODUCTO REFRIGERADO', y: 107 },
        { text: 'LAVAVAJILLAS MÁQUINA 20L        33-3892       2    35,076      70,15', y: 120 },
      ]),
    );
    expect(inv.lines.map((l) => l.description)).toEqual(['NATA PARA COCINAR 1L FORMATO HOSTELERÍA', 'QUESO CREMA 2KG PRODUCTO REFRIGERADO', 'LAVAVAJILLAS MÁQUINA 20L']);
    expect(inv.lines.map((l) => l.code)).toEqual(['25-7892', '68-9294', '33-3892']);
  });

  it('una fila de continuación sin letras ("40/60") también se une', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        { text: 'Descripción          Kilos    Precio    Importe', y: 60 },
        { text: 'LANGOSTINO COCIDO    4,721     20,99      99,09', y: 76 },
        { text: '40/60', y: 86 },
        { text: 'SEPIA LIMPIA         1,500     12,00      18,00', y: 100 },
      ]),
    );
    expect(inv.lines[0].description).toBe('LANGOSTINO COCIDO 40/60');
  });
});

describe('tickets de cash & carry', () => {
  const ticket = [
    '         CASH MAYORISTA DEL SUR S.A.',
    '            CIF A41234560',
    'FACTURA SIMPLIFICADA: T012-2026-058831',
    'FECHA 23/09/2026  HORA 08:14',
    'CLIENTE 004512 BAR LA ESQUINA S.L.',
    'NIF CLIENTE B41987651',
    '------------------------------------------',
    'ART.    DESCRIPCION                IMPORTE',
    '------------------------------------------',
    '2104578 LECHE ENTERA BRIK 1L',
    '        x6    0,82                 4,92 A',
    '3301456 HUEVOS CAMPEROS M 30U      7,45 A',
    '2201887 QUESO CURADO CUÑA',
    '     0,845 kg x 14,90 EUR/kg      12,59 A',
    '7012345 KETCHUP 1,8KG',
    '        3 x 3,10                  9,30 B',
    '------------------------------------------',
    'IVA     BASE      CUOTA',
    'A  4%   24,96      1,00',
    'B 10%    9,30      0,93',
    'BASE IMPONIBLE                      34,26',
    'TOTAL IVA                            1,93',
    'TOTAL                               36,19',
    'A: IVA 4%  B: IVA 10%',
  ];
  it('multiplicador "x6", peso "kg x €/kg", descripción en la fila anterior y artículo suelto validado con la base', () => {
    const inv = parse(pdfRows(ticket, 6));
    expect(inv.lines.map((l) => [l.description, l.code, l.quantity, l.unitPrice, l.total])).toEqual([
      ['LECHE ENTERA BRIK 1L', '2104578', 6, 0.82, 4.92],
      ['HUEVOS CAMPEROS M 30U', '3301456', 1, 7.45, 7.45],
      ['QUESO CURADO CUÑA', '2201887', 0.845, 14.9, 12.59],
      ['KETCHUP 1,8KG', '7012345', 3, 3.1, 9.3],
    ]);
    expect(inv.lines[2].unit).toBe('kg');
    expect(inv.supplierTaxId).toBe('A41234560');
    expect(inv.supplierName).toBe('CASH MAYORISTA DEL SUR S.A.');
  });
});

describe('cabecera del documento por bloques', () => {
  it('cliente a la izquierda y proveedor a la derecha en las mismas filas; CIF del proveedor en su bloque', () => {
    const inv = parse(
      pdfRows([
        'Datos del cliente                                   Embutidos y Carnes Aragón S.L.U.',
        'Grupo El Cenador S.A.                               Avenida Cervantes, 6',
        'Ronda de los Artesanos, 104                         26486 Logroño',
        'NIF: B-32677403                                     CIF: B-45636850',
        '',
        'FACTURA Nº  V-50411',
        'Fecha factura   05-09-2026',
        'Descripción              Cant.   Precio   Importe',
        'CHORIZO IBÉRICO CULAR        2    17,61     35,22',
      ]),
    );
    expect(inv.supplierName).toBe('Embutidos y Carnes Aragón S.L.U.');
    expect(inv.supplierTaxId).toBe('B45636850');
    expect(inv.number).toBe('V-50411');
  });

  it('rótulos espaciados letra a letra ("D AT O S D E L C L I E N T E") siguen marcando el bloque del cliente', () => {
    const inv = parse(
      pdfRows([
        'D AT O S D E L C L I E N T E                        Cárnicas Hermanos Ortega S.A.',
        'Asador El Encinar S.L.                              Mercado Central, naves 14-16',
        'Ctra. de El Escorial, km 3,2                        28053 Madrid',
        'NIF: B05442165                                      Tel. 917 850 320',
        '',
        'FACTURA Nº CHO/26/11873    FECHA 19/09/2026',
        'Descripción              Cant.   Precio   Importe',
        'SECRETO IBÉRICO              2    17,25     34,50',
        'Base imponible  34,50',
        'Cárnicas Hermanos Ortega S.A. · CIF A45182276 · Inscrita en el Registro Mercantil de Madrid',
      ]),
    );
    expect(inv.supplierName).toBe('Cárnicas Hermanos Ortega S.A.');
    expect(inv.supplierTaxId).toBe('A45182276');
  });

  it('cliente dentro de la caja de datos ("Cód. cliente | 0094 · Bar X S.L.", "N.I.F. | B…")', () => {
    const inv = parse(
      pdfRows([
        'Hortalizas Ibáñez S.A.                                  ALBARÁN',
        'Mayorista de alimentación',
        '',
        'Ronda del Sol, 135 · 29405 Málaga                       Albarán nº     608028',
        'CIF: A82797119 · Tel. 973 382 257                       Fecha          04/07/2025',
        '                                                        Cód. cliente   009491 · Restaurante Las Tinajas S.L.',
        '                                                        N.I.F.         ESB86084118',
        'Cant   Descripción              Precio    Importe',
        '6      CEBOLLA MORADA            1,33       7,98',
      ]),
    );
    expect(inv.supplierName).toBe('Hortalizas Ibáñez S.A.');
    expect(inv.supplierTaxId).toBe('A82797119');
    expect(inv.number).toBe('608028');
  });

  it('"Fecha factura 26 de enero de 2026" no es el número de factura', () => {
    const inv = parse(
      pdfRows([
        'Nieto Pascual S.L.                                ABONO',
        'CIF/NIF B19513740',
        'Número      26/VT/116744',
        'Fecha factura  26 de enero de 2026',
        'Descripción              Cant.   Precio   Importe',
        'SANDÍA                     -10     0,77     -7,70',
        'Base imponible  -7,70   IVA 4%  -0,31   Total  -8,01',
      ]),
    );
    expect(inv.number).toBe('26/VT/116744');
    expect(inv.date).toBe('2026-01-26');
    // Rectificativa: los totales conservan el signo
    expect([inv.subtotal, inv.vatTotal, inv.total]).toEqual([-7.7, -0.31, -8.01]);
  });

  it('razón social partida en dos filas por una palabra de enlace ("… Verduras del" / "Cantábrico C.B.")', () => {
    const inv = parse(
      pdfRows([
        'Importaciones Frutas y Verduras del        Albarán de entrega',
        'Cantábrico C.B.',
        'Albarán nº  AV-26-15522',
        'Pol. Ind. San Juan, 127                              Fecha     14/06/2026',
        'CIF: E-96740386',
        '',
        'Cliente:',
        'Casa de Comidas El Cenador S.A.',
        'N.I.F.: B97129498',
        '',
        'Producto                        Unidades    Precio/ud    Importe',
        'PIMIENTO VERDE ITALIANO            6,253         1,89      11,82',
        'Base imponible  11,82',
      ]),
    );
    expect(inv.supplierName).toBe('Importaciones Frutas y Verduras del Cantábrico C.B.');
    expect(inv.number).toBe('AV-26-15522');
  });

  it('rejilla de datos con la celda «Nº» sola y el valor debajo', () => {
    const inv = parse(
      pdfRows([
        'Hermanos Hernández S.L.                 Datos del cliente',
        '                                        Arrocería El Faro S.L.',
        'NIF/CIF: B99200164                      CIF: B-90072075',
        'NOTA DE ENTREGA VALORADA',
        'Nº                   Fecha                    Cliente',
        '627827               02/08/2026               33644',
        'Cant  Ref.      Artículo                  Precio €     Valor',
        '15,241  CA7520  TOMATE PERA                  1,763     26,87',
        '4  A982         AJO SECO MALLA 1KG           5,725     22,90',
        'Total base imponible   49,77',
      ]),
    );
    expect(inv.number).toBe('627827');
    expect(inv.date).toBe('2026-08-02');
  });
});

describe('despaceLetters: texto espaciado letra a letra', () => {
  it.each([
    ['D AT O S D E L C L I E N T E', 'DATOS DEL CLIENTE'],
    ['F A C T U R A', 'FACTURA'],
    ['CL IEN TE', 'CLIENTE'],
    ['S R . / S R E S .', 'SR./SRES.'],
    ['C L I E N T E / D I R E C C I Ó N D E E N T R E G A', 'CLIENTE / DIRECCIÓN DE ENTREGA'],
    ['PAN DE AJO 1KG', 'PAN DE AJO 1KG'],
    ['SAL DE MAR', 'SAL DE MAR'],
    ['A: IVA 4%  B: IVA 10%', 'A: IVA 4%  B: IVA 10%'],
  ])('%s → %s', (input, out) => {
    expect(despaceLetters(input)).toBe(out);
  });
});
