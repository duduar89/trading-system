import { describe, expect, it } from 'vitest';
import type { PdfTextLine } from './pdf';
import { ccFixDescription, parseInvoiceReading, parseInvoiceText, repairDocNumberParens } from './invoiceParser';

/**
 * Facturas de cash & carry / mayorista (artículos en dos filas con código de unidad, columnas Prec. Ud. | Cont P. |
 * Precio | Cant. | Importe | Imp, trazabilidad, bloque del cliente y total de página). Textos inventados con la forma de
 * la salida del OCR de una foto real (sin datos de ningún cliente).
 */

/** Filas posicionales como las del OCR: cada tramo separado por 2+ espacios es una celda con su X. */
function toRows(text: string, charWidth = 6): PdfTextLine[] {
  return text.split('\n').map((line, i) => {
    const items: PdfTextLine['items'] = [];
    const re = /\S+(?: \S+)*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) items.push({ x: m.index * charWidth, width: m[0].length * charWidth, str: m[0] });
    return { page: 1, y: i * 14, text: line, items };
  });
}

const HEADER = [
  'makro',
  'Makro Distribucion Mayorista, S.A.          SEVILLA                          Pagina:   1',
  'PASEO IMPERIAL 40                            AVDA. DEL EJEMPLO, 7             Fecha de venta:    03/10/2026 10:15',
  '28005 MADRID                                 41900 CAMAS                      Fecha impresion:   03/10/2026 10:16',
  'A-28/647451',
  'Merc. de Madrid, T. 3.669 L. 0 F. 86, Secc. 8.* H. M-61.688',
  'Factura                0/0 (021)0107/ (2026) 004512      (052-118830)',
  'Factura de entrega',
  'Bar La Esquina, S.L.                          N.cliente:  12 3456789 0',
  'CALLE MAYOR 12                                N.I.F.:  B12345674',
  '29001 MALAGA',
  'MM Num. articulo  Descrip. articulo                 Cont   Prec. Ud.   Cont P.   Precio   Cant.   Importe   Imp',
  '*** Numero de pedido 7-112233445',
  'Entregado a:  BAR LA ESQUINA,  MAYOR 12,  MALAGA 29001,  ES *** Fecha: 03/10/2026',
];

const ITEMS = [
  '201133        METRO Chef nata para cocinar 35% brik 1 L',
  '                                                BR     2,150       1         2,15      6      12,90     5',
  '301244        Jamon cebo iberico loncheado 100 g',
  '                                                SB     3,480       1         3,48     10      34,80     1',
  '402355        Salmon noruego filete fresco',
  '                                                KG    15,900       1,250    19,88      1      19,88     5',
  '08412345678905 Aceitunas manzanilla rellenas lata 1,5 kg',
  '                                                LA     6,420       1         6,42      2      12,84     1',
  'GTIN:  08412345678905  Lote:  7781',
  'GTIN:  8412345678905 Qty:  1  LOT:  7781',
  'Origen:  Espana',
  '503466        METRO Chef harina de trigo saco 25 kg  SC     14,950      1        14,95      1      14,95     5',
  '*** Fin de numero de pedido 7-112233445',
  'Numero de bultos:  21       Peso Total:  41,250 KG         Envases:   0            Importe        95,37',
  'Total pagina        95,37',
];

const DOC = [...HEADER, ...ITEMS].join('\n');

describe('cash & carry: artículos en dos filas', () => {
  const inv = parseInvoiceReading({ text: DOC }, 'ocr', toRows(DOC)).invoice;

  it('une la descripción con su fila de importes y no inventa líneas con la trazabilidad ni el pie', () => {
    expect(inv.lines.map((l) => l.total)).toEqual([12.9, 34.8, 19.88, 12.84, 14.95]);
    expect(inv.lines.every((l) => !/\bGTIN|Lote|bultos|Producto sin/i.test(l.description))).toBe(true);
  });

  it('código de artículo aparte, sin códigos de unidad ni precios en la descripción', () => {
    const [nata, jamon, , aceitunas, harina] = inv.lines;
    expect(nata.code).toBe('201133');
    expect(nata.description).toBe('METRO Chef nata para cocinar 35% brik 1 L');
    expect(jamon.description).toBe('Jamon cebo iberico loncheado 100 g');
    expect(aceitunas.code).toBe('08412345678905');
    expect(aceitunas.description).toBe('Aceitunas manzanilla rellenas lata 1,5 kg');
    // Variante en una sola fila: descripción + código de unidad + números
    expect(harina.code).toBe('503466');
    expect(harina.description).toBe('METRO Chef harina de trigo saco 25 kg');
  });

  it('Precio = Prec. Ud. × Cont P. e Importe = Precio × Cant.; el código de IVA no es la cantidad', () => {
    const [nata, jamon, salmon] = inv.lines;
    expect([nata.quantity, nata.unitPrice]).toEqual([6, 2.15]);
    expect([jamon.quantity, jamon.unitPrice]).toEqual([10, 3.48]);
    // Al peso: los kilos (Cont P. × Cant.) al precio por kilo
    expect(salmon.unit).toBe('kg');
    expect(salmon.quantity).toBeCloseTo(1.25, 6);
    expect(salmon.unitPrice).toBe(15.9);
  });

  it('el total de página es la base de lo que se ve (sin IVA) y las líneas cuadran con él', () => {
    expect(inv.subtotal).toBe(95.37);
    expect(inv.total).toBeUndefined();
    expect(inv.warnings.join(' ')).not.toMatch(/no cuadra/i);
  });

  it('cabecera: CIF con separadores del emisor, nunca el N.I.F. del cliente; nº de factura y fecha de venta', () => {
    expect(inv.supplierTaxId).toBe('A28647451');
    expect(inv.supplierName).toMatch(/^Makro Distribuci[oó]n Mayorista, S\.A\.$/);
    expect(inv.number).toBe('0/0(021)0107/(2026)004512');
    expect(inv.date).toBe('2026-10-03');
  });
});

describe('cash & carry: lecturas de OCR de una foto', () => {
  it('«1» leído como letra, precio de 3 decimales con punto y fila de importes partida por la inclinación', () => {
    const items = [
      '610001        Tomate pera caja 6 kg',
      '                                                CJ     9,870       I         9,87      1       9,87     5',
      '610002        Pepinillos agridulces tarro 450 g',
      '                                                TR     2.300       1         2,30      4',
      '                                                                                              9,20     1',
      '610003        Aceite girasol alto oleico garrafa 5 L',
      '                                                GF     8,450       1         8,45      2      16,90     1',
    ];
    const text = [...HEADER, ...items, 'Total pagina        35,97'].join('\n');
    const inv = parseInvoiceReading({ text }, 'ocr', toRows(text)).invoice;
    expect(inv.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.total])).toEqual([
      ['Tomate pera caja 6 kg', 1, 9.87, 9.87],
      ['Pepinillos agridulces tarro 450 g', 4, 2.3, 9.2],
      ['Aceite girasol alto oleico garrafa 5 L', 2, 8.45, 16.9],
    ]);
  });

  it('código de unidad mal leído ("sc", "cl", "EKG"), celda estropeada ("2/43") y precio de 3 decimales mal leído', () => {
    const items = [
      '620001        Harina de trigo saco 25 kg',
      '                                                sc    15,670       1        15,67      1      15,67     5',
      '620002        Guantes de nitrilo caja 100',
      '                                                cl     6,720       1         6,72      1       6,72     2',
      '620003        Pepino',
      '                                                KG     1,290       1,653     2/43      1       2,13     5',
      '620004        Patata agria',
      '                                                EKG    1,120       2,662     2,98      1       2,98     5',
      '620005        Calabacin',
      '                                                KG     1,596       0,608     0,97      1       0,97     5',
      '620006        Berenjena',
      '                                                ES     1,220       5,832     7,42      1       7,12     5',
    ];
    const text = [...HEADER, ...ITEMS.slice(0, 11), ...items, 'Total pagina        116,01'].join('\n');
    const inv = parseInvoiceReading({ text }, 'ocr', toRows(text)).invoice;
    const got = inv.lines.slice(4).map((l) => [l.description, l.quantity, l.unit, l.unitPrice, l.total]);
    expect(inv.lines).toHaveLength(10);
    expect(got).toEqual([
      ['Harina de trigo saco 25 kg', 1, 'saco', 15.67, 15.67],
      ['Guantes de nitrilo caja 100', 1, 'ud', 6.72, 6.72],
      ['Pepino', 1.653, 'kg', 1.29, 2.13],
      ['Patata agria', 2.662, 'kg', 1.12, 2.98],
      // «1,596» en un documento donde todos los precios por kilo acaban en 0: 1,590
      ['Calabacin', 0.608, 'kg', 1.59, 0.97],
      // «ES» por «KG» (el contenido de tres decimales delata el peso) y el precio «7,42» por 7,12
      ['Berenjena', 5.832, 'kg', 1.22, 7.12],
    ]);
  });

  it('erratas seguras del OCR en la descripción', () => {
    expect(ccFixDescription('AR0 Vinagre de jerez 1l')).toBe('ARO Vinagre de jerez 1l');
    expect(ccFixDescription('Zumo de naranja ll')).toBe('Zumo de naranja 1l');
    expect(ccFixDescription('Queso de Burgos lkg')).toBe('Queso de Burgos 1kg');
    expect(ccFixDescription('Garbanzo pedrosillano 1lkg')).toBe('Garbanzo pedrosillano 1kg');
    expect(ccFixDescription('Agua mineral 1,5 L pack 6')).toBe('Agua mineral 1,5 L pack 6');
  });

  it('un documento corriente con importes en columnas no entra en el modo cash & carry', () => {
    const text = [
      'FRUTAS GARCIA S.L.',
      'CIF B12345674',
      'Factura nº 2026-88   Fecha: 04/10/2026',
      'Descripción                  Cantidad   Precio   Importe',
      'TOMATE PERA                      12,000     1,20     14,40',
      'CEBOLLA DULCE                     5,000     0,95      4,75',
      'Base imponible  19,15   IVA 4%  0,77   Total  19,92',
    ].join('\n');
    const inv = parseInvoiceText({ text }, 'pdf-texto');
    expect(inv.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.total])).toEqual([
      ['TOMATE PERA', 12, 1.2, 14.4],
      ['CEBOLLA DULCE', 5, 0.95, 4.75],
    ]);
    expect(inv.total).toBe(19.92);
  });
});

describe('cabecera de mayorista', () => {
  it('los datos registrales no dan el número de factura ni la fecha', () => {
    const text = ['DISTRIBUCIONES DEL SUR S.A.', 'CIF A28647451', 'Inscrita en el Reg. Merc. de Sevilla, T. 1.234 L. 0 F. 86, Secc. 8.ª H. SE-12.345', 'Fecha factura: 07/10/2026'].join('\n');
    const inv = parseInvoiceText({ text }, 'ocr');
    expect(inv.number).not.toBe('86');
    expect(inv.date).toBe('2026-10-07');
  });

  it('«Dto. P.P.» es un descuento, nunca el proveedor', () => {
    const text = ['Dto. P.P.                1,00', 'Makro Distribucion Mayorista, S.A.', 'A-28/647451', 'Factura   0/0(021)0107/(2026)004512'].join('\n');
    const inv = parseInvoiceText({ text }, 'ocr');
    expect(inv.supplierName).not.toMatch(/dto/i);
    expect(inv.supplierTaxId).toBe('A28647451');
  });

  it('escaneo: el N.I.F. del cliente (etiqueta y valor en celdas separadas) nunca es el del proveedor; el nombre, antes del título', () => {
    const text = [
      'Cash Costa Brava,   S.A.                          TARRAGONA                           Pagina:   1',
      'Pza.  de  los  Olivos,  136                        C/  SAN  JUAN,  127                  Fecha de venta:   08/12/2025 18:57',
      '14483 Cordoba                                      43291 TARRAGONA',
      'AB2 666843',
      'Inscrita en el  Reg.  Merc.  de Barcelona,  T.  2.496  L.  0  F.  153,  Secc.  8.*  H.  B-62.245',
      'Factura                0/0(081)4235/(2025)088220      (919-123784)',
      'Factura de  entrega',
      'Hotel  El  Faro  S.L.                                             N.cliente:      52  3718672  2',
      'Pol.  Ind.  de  la  Paz,  104                                          N.I.F.:      B25271016',
      '30958  Murcia',
      ...HEADER.slice(11),
      ...ITEMS,
    ].join('\n');
    const inv = parseInvoiceReading({ text }, 'ocr', toRows(text)).invoice;
    expect(inv.supplierTaxId).not.toBe('B25271016');
    expect(inv.supplierName).toBe('Cash Costa Brava, S.A.');
    expect(inv.lines).toHaveLength(5);
  });

  it('repara el paréntesis de cierre que el OCR lee como «1»', () => {
    expect(repairDocNumberParens('0/0(04710263/(2026)058214')).toBe('0/0(047)0263/(2026)058214');
    expect(repairDocNumberParens('0/0(047)0263/(2026)058214')).toBe('0/0(047)0263/(2026)058214');
    expect(repairDocNumberParens('2026/1452')).toBe('2026/1452');
  });
});
