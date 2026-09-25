import { describe, expect, it } from 'vitest';
import { approxEqual, findDate, findNumbers, parseDateEs, parseNumberEs, round } from './numbers';

describe('parseNumberEs', () => {
  it.each<[string | number | null | undefined, number | undefined]>([
    ['1.234,56', 1234.56],
    ['1234,56', 1234.56],
    ['12,5', 12.5],
    ['12.50', 12.5],
    ['1,234.56', 1234.56],
    ['-3,2', -3.2],
    ['3,20 €', 3.2],
    ['€ 3.20', 3.2],
    ['3,20€', 3.2],
    ['EUR 12,00', 12],
    ['12,00 EUR', 12],
    ['21%', 21],
    ['10 %', 10],
    ['0,0385', 0.0385],
    ['1.000', 1000],
    ['1.5', 1.5],
    ['1,000', 1],
    ['1.234.567', 1234567],
    ['1.234.567,89', 1234567.89],
    ['1,234,567.89', 1234567.89],
    ['0.500', 0.5],
    ['(3,20)', -3.2],
    ['3,20-', -3.2],
    ['−4,5', -4.5],
    ['- 7,25 €', -7.25],
    ['+2,5', 2.5],
    ['1 234,56', 1234.56],
    ['1 234,56 €', 1234.56],
    [',5', 0.5],
    ['12,', 12],
    ['3,20 €/kg', 3.2],
    ['0', 0],
    ['-0,00', 0],
    [42, 42],
    [Number.NaN, undefined],
    [null, undefined],
    [undefined, undefined],
    ['', undefined],
    ['abc', undefined],
    ['12.03.2025', undefined],
    ['1,2,3', undefined],
    ['1.23.4', undefined],
    ['12,5 kg', undefined],
    ['1.2,3', undefined],
  ])('%j → %j', (input, expected) => {
    expect(parseNumberEs(input)).toBe(expected);
  });

  it('con preferencia de decimal anglosajón resuelve los ambiguos', () => {
    expect(parseNumberEs('1.500', { decimal: '.' })).toBe(1.5);
    expect(parseNumberEs('1,500', { decimal: '.' })).toBe(1500);
    expect(parseNumberEs('1.234,56', { decimal: '.' })).toBe(1234.56);
    expect(parseNumberEs('0,500', { decimal: '.' })).toBe(0.5);
  });
});

describe('findNumbers', () => {
  it('encuentra cantidades, precios, porcentajes e importes con posición', () => {
    const line = 'TOMATE PERA 6,500 kg 1,20 € 7,80€ IVA 10%';
    const nums = findNumbers(line);
    expect(nums.map((n) => n.value)).toEqual([6.5, 1.2, 7.8, 10]);
    expect(nums.map((n) => n.isCurrency)).toEqual([false, true, true, false]);
    expect(nums[3].isPercent).toBe(true);
    for (const n of nums) expect(line.slice(n.start, n.end)).toBe(n.raw);
    expect(nums[1].raw).toBe('1,20 €');
    // El "€" de 1,20 no se asigna también al número siguiente
    expect(nums[2].raw).toBe('7,80€');
  });

  it('signos: menos pegado sí, guion entre letras o cifras no', () => {
    expect(findNumbers('Dto -2,00').map((n) => n.value)).toEqual([-2]);
    expect(findNumbers('PATATA T-3').map((n) => n.value)).toEqual([3]);
    expect(findNumbers('ART-12345').map((n) => n.value)).toEqual([12345]);
    expect(findNumbers('calibre 10-12').map((n) => n.value)).toEqual([10, 12]);
    expect(findNumbers('abono 3,20- ').map((n) => n.value)).toEqual([-3.2]);
    expect(findNumbers('€-3,50').map((n) => [n.value, n.isCurrency])).toEqual([[-3.5, true]]);
    expect(findNumbers('total: −12,40 €').map((n) => n.value)).toEqual([-12.4]);
  });

  it('miles y decimales en la misma línea', () => {
    expect(findNumbers('2 1.234,56 1.000 0,0385').map((n) => n.value)).toEqual([2, 1234.56, 1000, 0.0385]);
  });

  it('fechas y secuencias no numéricas se devuelven por partes', () => {
    expect(findNumbers('12.03.2025').map((n) => n.value)).toEqual([12, 3, 2025]);
    expect(findNumbers('12/03/2025').map((n) => n.value)).toEqual([12, 3, 2025]);
  });

  it('respeta la preferencia de decimal', () => {
    expect(findNumbers('2 x 1.500', { decimal: '.' }).map((n) => n.value)).toEqual([2, 1.5]);
    expect(findNumbers('')).toEqual([]);
  });
});

describe('parseDateEs', () => {
  it.each<[string, string | undefined]>([
    ['12/03/2025', '2025-03-12'],
    ['12-03-25', '2025-03-12'],
    ['12.03.2025', '2025-03-12'],
    ['1/3/2025', '2025-03-01'],
    ['2025-03-12', '2025-03-12'],
    ['2025/3/2', '2025-03-02'],
    ['12 de marzo de 2025', '2025-03-12'],
    ['12 de marzo del 2025', '2025-03-12'],
    ['12 mar 2025', '2025-03-12'],
    ['12-MAR-2025', '2025-03-12'],
    ['12/mar/25', '2025-03-12'],
    ['1 sept. 2024', '2024-09-01'],
    ['3 sep 2024', '2024-09-03'],
    ['5 ENE 2026', '2026-01-05'],
    ['28 feb. 2025', '2025-02-28'],
    ['7 abr 2025', '2025-04-07'],
    ['15 may 2025', '2025-05-15'],
    ['30 jun 2025', '2025-06-30'],
    ['4 jul 2025', '2025-07-04'],
    ['16 ago 2025', '2025-08-16'],
    ['10 oct 2025', '2025-10-10'],
    ['11 nov 2025', '2025-11-11'],
    ['24 dic 2025', '2025-12-24'],
    ['1º de enero de 2026', '2026-01-01'],
    ['lunes, 3 de febrero del 2025', '2025-02-03'],
    ['Fecha: 05/02/2025', '2025-02-05'],
    ['12/03/2025 14:30', '2025-03-12'],
    ['2025-03-12T10:00:00Z', '2025-03-12'],
    ['29/02/2024', '2024-02-29'],
    ['March 12, 2025', '2025-03-12'],
    ['03/25/2025', '2025-03-25'],
    ['29/02/2025', undefined],
    ['31/04/2025', undefined],
    ['31/02/2025', undefined],
    ['13/13/2025', undefined],
    ['00/01/2025', undefined],
    ['32 de enero de 2025', undefined],
    ['12/03', undefined],
    ['hola', undefined],
    ['', undefined],
    ['12/03/2025 y 13/03/2025', undefined],
    ['Factura 1234 del 12/03/2025', undefined],
  ])('%j → %j', (input, expected) => {
    expect(parseDateEs(input)).toBe(expected);
  });
});

describe('findDate', () => {
  it('prefiere la fecha de la factura frente a pedido o vencimiento', () => {
    const text = 'Pedido 01/02/2025\nFecha factura: 05/02/2025   Vencimiento: 05/03/2025';
    expect(findDate(text)).toBe('2025-02-05');
  });

  it('reconoce "F. Factura" y "Fecha emisión" aunque haya otras fechas antes', () => {
    expect(findDate('Albarán 28/01/2025\nF. Factura 03/02/2025')).toBe('2025-02-03');
    expect(findDate('Entrega: 1 de febrero de 2025\nFecha emisión: 2 de febrero de 2025')).toBe('2025-02-02');
    expect(findDate('Fecha de expedición 14-mar-2025, fecha de vencimiento 14-abr-2025')).toBe('2025-03-14');
  });

  it('usa la cabecera de la línea anterior en tablas', () => {
    const text = 'Nº Factura   Fecha\nA-123        07/03/2025\nVto 07/04/2025';
    expect(findDate(text)).toBe('2025-03-07');
  });

  it('sin etiquetas devuelve la primera fecha válida', () => {
    expect(findDate('Madrid, 12 de marzo de 2025. Pago a 30 días.')).toBe('2025-03-12');
    expect(findDate('lote 99/99/2025 entrega 10/03/2025')).toBe('2025-03-10');
  });

  it('penaliza años fuera de rango y fechas de caducidad', () => {
    expect(findDate('Consumo preferente 10/10/2026\nFecha 01/03/2025')).toBe('2025-03-01');
    expect(findDate('Cliente desde 01/01/1998 Fecha 02/02/2025')).toBe('2025-02-02');
  });

  it('sin fechas → undefined', () => {
    expect(findDate('Sin fechas aquí 12,50 €')).toBeUndefined();
    expect(findDate('')).toBeUndefined();
  });
});

describe('round y approxEqual', () => {
  it('redondea sin errores de coma flotante', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.675, 2)).toBe(2.68);
    expect(round(7.52941, 3)).toBe(7.529);
  });
  it('tolerancia de 2 céntimos o 1 %', () => {
    expect(approxEqual(1, 1.02)).toBe(true);
    expect(approxEqual(1, 1.05)).toBe(false);
    expect(approxEqual(10, 10.09)).toBe(true);
    expect(approxEqual(10, 10.15)).toBe(false);
    expect(approxEqual(1000, 1009)).toBe(true);
    expect(approxEqual(1000, 1011)).toBe(false);
  });
});
