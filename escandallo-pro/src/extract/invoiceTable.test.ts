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

  it('celdas de tres filas centradas: fila de texto encima y debajo de la línea con descripción propia', () => {
    const rows = [
      { text: 'Código     Descripción                    Cantidad     Precio     Importe', y: 100 },
      { text: '           QUESO MANCHEGO CURADO', y: 114 },
      { text: 'Q100       DE OVEJA GRAN RESERVA               2,500      18,40       46,00', y: 122 },
      { text: '           PIEZA 3 KG APROX.', y: 130 },
      { text: '           ACEITE DE OLIVA VIRGEN', y: 145 },
      { text: 'A200       EXTRA COSECHA TEMPRANA                  6       9,50       57,00', y: 153 },
      { text: '           GARRAFA 5 L', y: 161 },
      { text: '           CECINA DE LEÓN IGP', y: 176 },
      { text: 'C300       LONCHEADA A CUCHILLO                    4       7,25       29,00', y: 184 },
      { text: '           SOBRE 100 G', y: 192 },
      { text: 'Base imponible   132,00', y: 215 },
    ];
    const inv = parse(pdfRows([...HEAD.map((t, i) => ({ text: t, y: i * 8 })), ...rows]));
    expect(inv.lines.map((l) => l.description)).toEqual([
      'QUESO MANCHEGO CURADO DE OVEJA GRAN RESERVA PIEZA 3 KG APROX.',
      'ACEITE DE OLIVA VIRGEN EXTRA COSECHA TEMPRANA GARRAFA 5 L',
      'CECINA DE LEÓN IGP LONCHEADA A CUCHILLO SOBRE 100 G',
    ]);
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

  it('la descripción va con la fila de números siguiente aunque la altura de las filas baile (OCR)', () => {
    // Paso normal de 28 pt; la última descripción queda a 26 pt de la fila anterior y a 31 de la suya
    const rows = [
      { text: 'ART.    DESCRIPCION                IMPORTE', y: 112 },
      { text: '5934    QUESO CURADO DE OVEJA', y: 140 },
      { text: '   4,258 kg x 20,29 /kg          86,39 A', y: 168 },
      { text: '1509    LECHE SEMIDESNATADA 1L', y: 194 },
      { text: '        x26   0,85               22,10 A', y: 225 },
      { text: 'BASE IMPONIBLE                  108,49', y: 262 },
    ];
    const inv = parse(pdfRows([...HEAD.map((t, i) => ({ text: t, y: i * 28 })), ...rows], 6));
    expect(inv.lines.map((l) => [l.description, l.quantity, l.total])).toEqual([
      ['QUESO CURADO DE OVEJA', 4.258, 86.39],
      ['LECHE SEMIDESNATADA 1L', 26, 22.1],
    ]);
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

  it('el NIF que va bajo la etiqueta «Cliente» de la caja de datos nunca es el del proveedor', () => {
    const inv = parse(
      pdfRows([
        'Hortofrutícola Herrero S.L.                                FACTURA',
        'Pol. Ind. Colón, 107 · 24219 León              F. pago         Pagaré 60 días',
        'Tel. 981 954 887                               Número          B-2026/409515',
        '                                               Cliente         12170 · Restaurante La Tahona',
        '                                               NIF             65740931-P',
        '                                               Fecha emisión   24.02.2026',
        'Descripción                      Cant.     Precio    Importe',
        'TOMATE PERA                        12      1,25      15,00',
        'Base imponible   15,00',
      ]),
    );
    expect(inv.supplierName).toBe('Hortofrutícola Herrero S.L.');
    expect(inv.supplierTaxId).toBeUndefined();
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

describe('robustez ante otras maquetaciones (letra más grande, tablas partidas)', () => {
  it('razón social en dos filas con la misma letra, alineada a la derecha; las siglas del logotipo no cuentan', () => {
    const rows = [
      { text: 'Facturar a                          IBS', y: 40 },
      { text: '                                    Importaciones Bodegas Sierra', y: 53 },
      { text: 'Grupo El Faro S.L.                          Norte S.L.U.', y: 71 },
      { text: 'CIF: B-12489167                        CIF/NIF: B26219220', y: 104 },
      { text: 'Factura nº F-2026/0001   Fecha: 03/09/2026', y: 120 },
      { text: 'Descripción                      Cant.     Precio    Importe', y: 140 },
      { text: 'VINO TINTO CRIANZA                  6      4,50      27,00', y: 152 },
      { text: 'Base imponible   27,00', y: 170 },
    ];
    // Letra del nombre más grande (8 pt por carácter) que la del resto (5 pt)
    const lines = pdfRows(rows).map((l) => {
      if (l.y !== 53 && l.y !== 71) return l;
      const items = l.items.map((it) => (/Importaciones|Norte/.test(it.str) ? { ...it, width: it.str.length * 8, x: it.str.startsWith('Norte') ? 180 + 16 * 8 : 180 } : it));
      return { ...l, items };
    });
    const inv = parse(lines);
    expect(inv.supplierName).toBe('Importaciones Bodegas Sierra Norte S.L.U.');
  });

  it('«Continúa en la página siguiente» sin «suma anterior»: la tabla sigue en la otra página', () => {
    const lines = pdfRows([
      ...HEAD,
      'Unidades  Descripción              Precio    Importe',
      '12        TOMATE PERA                1,25      15,00',
      'Continúa en la página siguiente',
      'Página 1 de 2',
    ]).concat(
      pdfRows(['FRUTAS DEL VALLE S.L.            FACTURA F-2026/0001', 'Unidades  Descripción              Precio    Importe', '4         AJO MORADO                 2,50      10,00', 'Base imponible   25,00  Total factura   26,00']).map((l) => ({ ...l, page: 2 })),
    );
    const inv = parse(lines);
    expect(inv.lines.map((l) => l.description)).toEqual(['TOMATE PERA', 'AJO MORADO']);
    expect(inv.subtotal).toBe(25);
  });

  it('"Total factura 397,43" no es el número de factura; un EAN-13 no es descripción', () => {
    const inv = parse(
      pdfRows([
        'FRUTAS DEL VALLE S.L.        CIF: B12345674',
        'ALBARÁN ALB-042802 · 21/04/2025',
        'Descripción                                 Cant.     Precio    Importe',
        'RAPE NEGRO COLA 8476869720984                3,73    24,2233      90,35',
        'Base imponible   90,35     Total factura   99,39',
      ]),
    );
    expect(inv.number).toBe('ALB-042802');
    expect(inv.lines[0].description).toBe('RAPE NEGRO COLA');
  });

  it('una línea que cuadra y cuya descripción sigue en «ENVASE RETORNABLE» es un producto, no un cargo', () => {
    const inv = parse(
      pdfRows([
        ...HEAD,
        'Código    Descripción                     Cantidad    Precio    Importe',
        { text: '          TÓNICA PREMIUM 20CL', y: 100 },
        { text: '7407      ENVASE RETORNABLE                 14,000     0,543       7,60', y: 106 },
        { text: '1191      PORTES                             1,000    12,00       12,00', y: 124 },
        { text: 'Base imponible   19,60', y: 140 },
      ]),
    );
    expect(inv.lines.map((l) => l.description)).toEqual(['TÓNICA PREMIUM 20CL ENVASE RETORNABLE']);
  });

  it('descripción en cuatro filas con los números centrados: se unen todas las de encima', () => {
    const rows = [
      { text: 'Mercancía      Art.        Cantidad   Pr. Unit.   Importe', y: 100 },
      { text: 'Nata para', y: 114 },
      { text: 'Cocinar 1l', y: 126 },
      { text: '               3767939         6       2,898      17,39', y: 132 },
      { text: 'Caja 6', y: 138 },
      { text: 'Unidades', y: 150 },
      { text: 'Queso de', y: 166 },
      { text: 'Burgos 1kg', y: 178 },
      { text: '               7772948        10       5,478      54,78', y: 184 },
      { text: 'Producto', y: 190 },
      { text: 'Refrigerado', y: 202 },
      { text: 'Base imponible   72,17', y: 225 },
    ];
    const inv = parse(pdfRows([...HEAD.map((t, i) => ({ text: t, y: i * 12 })), ...rows]));
    expect(inv.lines.map((l) => l.description)).toEqual(['Nata para Cocinar 1l Caja 6 Unidades', 'Queso de Burgos 1kg Producto Refrigerado']);
  });
});

describe('OCR: cifras mal leídas que la aritmética del documento corrige', () => {
  const parseOcr = (lines: PdfTextLine[]) => parseInvoiceText({ text: lines.map((l) => l.text).join('\n') }, 'ocr', lines);
  const doc = (rows: string[], base: string) =>
    pdfRows([...HEAD, 'Descripción                      Cant.     Precio    Importe', ...rows, `Base imponible   ${base}`]);

  it('si las demás líneas cuadran al céntimo, una cifra de más o cambiada en la cantidad se corrige', () => {
    const inv = parseOcr(
      doc(
        [
          'TOMATE PERA                     12,500      1,20      15,00',
          'CEBOLLA AMARILLA                 8,000      0,95       7,60',
          'PLATANO DE CANARIAS              6,299      1,69      10,63',
          'LIMON                            4,000      1,50       6,00',
          'SOLOMILLO DE TERNERA             3,171     32,87     104,20',
          'ZANAHORIA                        5,000      0,80       4,00',
        ],
        '147,43',
      ),
    );
    expect(inv.lines.map((l) => l.quantity)).toEqual([12.5, 8, 6.29, 4, 3.17, 5]);
    expect(inv.lines.map((l) => l.unitPrice)).toEqual([1.2, 0.95, 1.69, 1.5, 32.87, 0.8]);
  });

  it('un importe con una cifra mal leída se corrige si así cuadra la base imponible', () => {
    const inv = parseOcr(
      doc(
        [
          'TOMATE PERA                        12      1,25      15,00',
          'CEBOLLA AMARILLA                    8      0,95       7,60',
          'QUESO CURADO                        2     16,83      33,67',
          'LIMON                               4      1,50       6,00',
          'ZANAHORIA                           5      0,80       4,00',
        ],
        '66,26',
      ),
    );
    expect(inv.lines.map((l) => l.total)).toEqual([15, 7.6, 33.66, 6, 4]);
  });

  it('un «1» de más delante del importe ("124,64" por 24,64) se quita si así cuadra la fila', () => {
    const inv = parseOcr(doc(['CHAMPIÑON LAMINADO 1KG               7      3,52     124,64', 'TOMATE PERA                        12      1,25      15,00'], '39,64'));
    expect(inv.lines.map((l) => [l.quantity, l.unitPrice, l.total])).toEqual([
      [7, 3.52, 24.64],
      [12, 1.25, 15],
    ]);
  });

  it('tipo de IVA con una cifra mal leída en el desglose ("24" por 21): lo decide la aritmética', () => {
    const inv = parseOcr(
      pdfRows([
        ...HEAD,
        'Descripción                      Cant.     Precio    Importe',
        'TOMATE PERA                        12      1,25      15,00',
        'GASTOS DE TRANSPORTE                1     14,13      14,13',
        'BASE IMPONIBLE   % IVA   CUOTA',
        '15,00     4,00     0,60',
        '14,13    24,00     2,97',
        'TOTAL A PAGAR    32,70',
      ]),
    );
    expect([inv.subtotal, inv.vatTotal, inv.total]).toEqual([29.13, 3.57, 32.7]);
  });

  it('base = bruto − pronto pago cuando el desglose de IVA no se lee entero', () => {
    const inv = parseOcr(
      pdfRows([
        ...HEAD,
        'Descripción                      Cant.     Precio    Importe',
        'TOMATE PERA                        12      1,25      15,00',
        'AGUA MINERAL 1,5L                  10      0,50       5,00',
        'Total bruto      20,00',
        'Dto. P.P. 2%     -0,40',
        'Importe IVA       1,51',
        '21%      4,90      1,03',
        'Total a pagar    21,11',
      ]),
    );
    expect([inv.subtotal, inv.total]).toEqual([19.6, 21.11]);
  });

  it('precio con cifras de más ("33,50" leído "733,550") entre cantidad e importe bien leídos', () => {
    const inv = parseOcr(doc(['SOLOMILLO TERNERA NAC. ENTERO        4,620    733,550     154,77', 'TOMATE PERA                        12      1,25      15,00'], '169,77'));
    expect(inv.lines.map((l) => [l.quantity, l.unitPrice, l.total])).toEqual([
      [4.62, 33.5, 154.77],
      [12, 1.25, 15],
    ]);
  });

  it('restos de un filete vertical pegados a las cifras ("4,25|", "|15,00")', () => {
    const inv = parseOcr(doc(['ENTRECOT DE VACA                  4,25|    30,24     128,52', 'TOMATE PERA                        12      1,25     |15,00'], '143,52'));
    expect(inv.lines.map((l) => [l.quantity, l.unitPrice, l.total])).toEqual([
      [4.25, 30.24, 128.52],
      [12, 1.25, 15],
    ]);
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
