import { describe, expect, it } from 'vitest';
import type { PackSize } from '../types';
import { isPackWarning, normalizeInvoiceLine, packToBase, parsePackSize } from './pack';

describe('parsePackSize', () => {
  it.each<[string, PackSize | undefined]>([
    ['ACEITE OLIVA V.E. GARRAFA 5L', { count: 1, size: 5, unit: 'l' }],
    ['LECHE ENTERA 6X1L', { count: 6, size: 1, unit: 'l' }],
    ['LECHE ENTERA 6 x 1 l', { count: 6, size: 1, unit: 'l' }],
    ['YOGUR NATURAL 12 UDS X 200G', { count: 12, size: 200, unit: 'g' }],
    ['AGUA PACK 6 X 1,5L', { count: 6, size: 1.5, unit: 'l' }],
    ['HARINA CAJA 10X1KG', { count: 10, size: 1, unit: 'kg' }],
    ['VINO TINTO 6X75CL', { count: 6, size: 75, unit: 'cl' }],
    ['REFRESCO 24X33CL', { count: 24, size: 33, unit: 'cl' }],
    ['AGUA 1,5L X 6', { count: 6, size: 1.5, unit: 'l' }],
    ['ZUMO 200ML X 12 UDS', { count: 12, size: 200, unit: 'ml' }],
    ['PATATA AGRIA SACO 25 KG', { count: 1, size: 25, unit: 'kg' }],
    ['VINO BLANCO 0,75L', { count: 1, size: 0.75, unit: 'l' }],
    ['VINO TINTO 75CL', { count: 1, size: 75, unit: 'cl' }],
    ['MANTEQUILLA 1/2 KG', { count: 1, size: 0.5, unit: 'kg' }],
    ['CERVEZA 1/3 PACK 24', { count: 24, size: 33.3, unit: 'cl' }],
    ['CERVEZA 1/3', { count: 1, size: 33.3, unit: 'cl' }],
    ['CERVEZA 1/5 CAJA 30', { count: 30, size: 20, unit: 'cl' }],
    ['CERVEZA TERCIO PACK 24', { count: 24, size: 33.3, unit: 'cl' }],
    ['ARROZ BOLSA 2.5KG', { count: 1, size: 2.5, unit: 'kg' }],
    ['QUESO BARRA 1 KG APROX', { count: 1, size: 1, unit: 'kg' }],
    ['TOMATE TRITURADO LATA 2,5 KG', { count: 1, size: 2.5, unit: 'kg' }],
    ['CHAMPIÑON BANDEJA 500GR', { count: 1, size: 500, unit: 'g' }],
    ['DOCENA HUEVOS', { count: 12, size: 1, unit: 'ud' }],
    ['HUEVOS 2 DOCENAS', { count: 24, size: 1, unit: 'ud' }],
    ['HUEVOS MEDIA DOCENA', { count: 6, size: 1, unit: 'ud' }],
    ['HUEVOS M 30 UDS', { count: 30, size: 1, unit: 'ud' }],
    ['CEBOLLA MALLA 5KG', { count: 1, size: 5, unit: 'kg' }],
    ['TOMATE PERA CAJA 6KG', { count: 1, size: 6, unit: 'kg' }],
    ['NATA 35% 1L BRIK 12UD', { count: 12, size: 1, unit: 'l' }],
    ['VINO CAJA 12 BOT 75CL', { count: 12, size: 75, unit: 'cl' }],
    ['LECHE C/12 1L', { count: 12, size: 1, unit: 'l' }],
    ['QUESO RALLADO 1.500 G', { count: 1, size: 1500, unit: 'g' }],
    ['SERVILLETAS PACK 6', { count: 6, size: 1, unit: 'ud' }],
    ['GAMBA 8/10 CAJA 2KG', { count: 1, size: 2, unit: 'kg' }],
    ['PATATA T-3 SACO 10 KG', { count: 1, size: 10, unit: 'kg' }],
    ['NATA 35%', undefined],
    ['CACAO 70%', undefined],
    ['VINO TINTO 13,5º', undefined],
    ['TOMATE PERA CAT I', undefined],
    ['PATATA T-3', undefined],
    ['GAMBA 8/10', undefined],
    ['LANGOSTINO 20/30', undefined],
    ['PRECIO 3,50 €/KG', undefined],
    ['SALMON ENTERO 4-5 KG', undefined],
    ['CORDERO 1/2', undefined],
    ['FACTURA 12/03/2025', undefined],
    ['REF 12345 TOMATE', undefined],
    ['', undefined],
  ])('%j → %j', (input, expected) => {
    expect(parsePackSize(input)).toEqual(expected);
  });
});

describe('packToBase', () => {
  it.each<[PackSize, { unit: 'kg' | 'l' | 'ud'; qty: number }]>([
    [{ count: 6, size: 1, unit: 'l' }, { unit: 'l', qty: 6 }],
    [{ count: 12, size: 200, unit: 'g' }, { unit: 'kg', qty: 2.4 }],
    [{ count: 24, size: 33.3, unit: 'cl' }, { unit: 'l', qty: 7.992 }],
    [{ count: 1, size: 750, unit: 'ml' }, { unit: 'l', qty: 0.75 }],
    [{ count: 1, size: 25, unit: 'kg' }, { unit: 'kg', qty: 25 }],
    [{ count: 30, size: 1, unit: 'ud' }, { unit: 'ud', qty: 30 }],
    [{ count: 0, size: 5, unit: 'kg' }, { unit: 'kg', qty: 5 }],
  ])('%j → %j', (pack, expected) => {
    const r = packToBase(pack);
    expect(r.unit).toBe(expected.unit);
    expect(r.qty).toBeCloseTo(expected.qty, 9);
  });
});

const base = { total: 0, unitPrice: 0, quantity: 0, unit: 'UD', description: '' };

describe('normalizeInvoiceLine', () => {
  it('facturado por kg: manda el peso aunque la descripción diga "CAJA 6KG"', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'TOMATE PERA CAJA 6KG', quantity: 12.5, unit: 'KG', unitPrice: 1.2, total: 15 });
    expect(r.baseUnit).toBe('kg');
    expect(r.baseQuantity).toBe(12.5);
    expect(r.pricePerBase).toBeCloseTo(1.2, 6);
    expect(r.packSize).toEqual({ count: 1, size: 6, unit: 'kg' });
    expect(r.warnings).toEqual([]);
  });

  it('facturado en gramos o mililitros convierte a kg/l', () => {
    const g = normalizeInvoiceLine({ ...base, description: 'AZAFRAN', quantity: 50, unit: 'gr', unitPrice: 0.9, total: 45 });
    expect(g.baseUnit).toBe('kg');
    expect(g.baseQuantity).toBe(0.05);
    expect(g.pricePerBase).toBeCloseTo(900, 6);
    const ml = normalizeInvoiceLine({ ...base, description: 'ESENCIA VAINILLA', quantity: 500, unit: 'ml', unitPrice: 0.02, total: 10 });
    expect(ml.baseUnit).toBe('l');
    expect(ml.pricePerBase).toBeCloseTo(20, 6);
  });

  it('por unidad con formato: cantidad × formato', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'ACEITE OLIVA V.E. GARRAFA 5L', quantity: 2, unit: 'UD', unitPrice: 24.5, total: 49 });
    expect(r.baseUnit).toBe('l');
    expect(r.baseQuantity).toBe(10);
    expect(r.pricePerBase).toBeCloseTo(4.9, 6);
  });

  it('por caja de 6x1L con descuento', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'LECHE ENTERA 6X1L', quantity: 2, unit: 'CAJA', unitPrice: 5.4, discountPct: 10, total: 9.72 });
    expect(r.baseQuantity).toBe(12);
    expect(r.pricePerBase).toBeCloseTo(0.81, 6);
    expect(r.warnings).toEqual([]);
  });

  it('sin importe: usa cantidad × precio × (1 − dto)', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'LECHE ENTERA 6X1L', quantity: 2, unit: 'CJ', unitPrice: 5.4, discountPct: 10, total: 0 });
    expect(r.pricePerBase).toBeCloseTo(0.81, 6);
  });

  it('por botella individual aunque el formato sea una caja de 6', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'VINO TINTO RIOJA 6X75CL', quantity: 12, unit: 'BOT', unitPrice: 4.5, total: 54 });
    expect(r.baseUnit).toBe('l');
    expect(r.baseQuantity).toBe(9);
    expect(r.pricePerBase).toBeCloseTo(6, 6);
  });

  it('cerveza 1/3 por packs de 24', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'CERVEZA 1/3 PACK 24', quantity: 2, unit: 'PACK', unitPrice: 14.4, total: 28.8 });
    expect(r.baseUnit).toBe('l');
    expect(r.baseQuantity).toBeCloseTo(15.984, 6);
    expect(r.pricePerBase).toBeCloseTo(28.8 / 15.984, 5);
  });

  it('docena facturada = 12 ud', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'HUEVOS M', quantity: 5, unit: 'DOC', unitPrice: 2.4, total: 12 });
    expect(r.baseUnit).toBe('ud');
    expect(r.baseQuantity).toBe(60);
    expect(r.pricePerBase).toBeCloseTo(0.2, 6);
  });

  it('estuche de 30 huevos por unidad', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'HUEVOS CAMPEROS L 30 UDS', quantity: 2, unit: 'UD', unitPrice: 7.5, total: 15 });
    expect(r.baseUnit).toBe('ud');
    expect(r.baseQuantity).toBe(60);
    expect(r.pricePerBase).toBeCloseTo(0.25, 6);
  });

  it('sin formato ni unidad conocida → €/ud', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'LIMPIADOR MULTIUSOS', quantity: 3, unit: '', unitPrice: 2.1, total: 6.3 });
    expect(r.baseUnit).toBe('ud');
    expect(r.baseQuantity).toBe(3);
    expect(r.pricePerBase).toBeCloseTo(2.1, 6);
    expect(r.packSize).toBeUndefined();
  });

  it('usa el packSize indicado en la línea (p. ej. corregido a mano) antes que el detectado', () => {
    const r = normalizeInvoiceLine({
      ...base,
      description: 'ACEITE OLIVA 5L',
      quantity: 1,
      unit: 'UD',
      unitPrice: 30,
      total: 30,
      packSize: { count: 3, size: 5, unit: 'l' },
    });
    expect(r.baseQuantity).toBe(15);
    expect(r.pricePerBase).toBeCloseTo(2, 6);
  });

  it('precio por kg con cantidad en cajas: cuadra y no avisa', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'TOMATE PERA CAJA 6KG', quantity: 2, unit: 'CJ', unitPrice: 1.2, total: 14.4 });
    expect(r.baseQuantity).toBe(12);
    expect(r.pricePerBase).toBeCloseTo(1.2, 6);
    expect(r.warnings).toEqual([]);
  });

  it('avisa si cantidad × precio no cuadra con el importe (y manda el importe)', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'LECHE ENTERA 6X1L', quantity: 2, unit: 'CAJA', unitPrice: 5.4, total: 12 });
    expect(r.pricePerBase).toBeCloseTo(1, 6);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings?.[0]).toMatch(/no cuadra con el importe/);
    expect(r.warnings?.[0]).toContain('10,80 €');
    expect(r.warnings?.[0]).toContain('12,00 €');
  });

  it('tolera redondeos de 2 céntimos', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'PATATA', quantity: 3.333, unit: 'KG', unitPrice: 0.95, total: 3.18 });
    expect(r.warnings).toEqual([]);
  });

  it('cantidad cero o importes vacíos: avisa y no inventa precio', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'X', quantity: 0, unit: 'UD', unitPrice: 0, total: 0 });
    expect(r.pricePerBase).toBeUndefined();
    expect(r.warnings?.some((w) => w.startsWith('Cantidad no válida'))).toBe(true);
    expect(r.warnings?.some((w) => w.startsWith('No se puede calcular'))).toBe(true);
  });

  it('cantidad negativa sin importe negativo: aviso', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'NATA 1L', quantity: -1, unit: 'UD', unitPrice: 3, total: 3 });
    expect(r.warnings?.some((w) => w.startsWith('Cantidad no válida'))).toBe(true);
  });

  it('abono (cantidad e importe negativos): precio positivo y aviso informativo', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'ABONO NATA 1L', quantity: -2, unit: 'UD', unitPrice: 3, total: -6 });
    expect(r.pricePerBase).toBeCloseTo(3, 6);
    expect(r.baseQuantity).toBe(-2);
    expect(r.warnings).toEqual(['Cantidad negativa: línea de abono o devolución']);
  });

  it('precio inusual por unidad base (formato mal leído)', () => {
    const r = normalizeInvoiceLine({ ...base, description: 'AZUCAR 1000 KG', quantity: 1, unit: 'UD', unitPrice: 1.1, total: 1.1 });
    expect(r.pricePerBase).toBeCloseTo(0.0011, 6);
    expect(r.warnings?.some((w) => w.startsWith('Precio por kg inusual'))).toBe(true);
  });

  it('al volver a normalizar sustituye sus avisos y conserva los de extracción', () => {
    const first = normalizeInvoiceLine({
      ...base,
      description: 'LECHE ENTERA 6X1L',
      quantity: 2,
      unit: 'CAJA',
      unitPrice: 5.4,
      total: 12,
      warnings: ['Texto OCR de baja confianza'],
    });
    expect(first.warnings).toHaveLength(2);
    const fixed = normalizeInvoiceLine({ ...first, total: 10.8 });
    expect(fixed.warnings).toEqual(['Texto OCR de baja confianza']);
    expect(isPackWarning('Cantidad × precio (1,00 €) no cuadra con el importe (2,00 €)')).toBe(true);
    expect(isPackWarning('Texto OCR de baja confianza')).toBe(false);
  });

  it('conserva el resto de campos de la línea', () => {
    const r = normalizeInvoiceLine({ ...base, id: 'l1', code: 'A1', matchStatus: 'nuevo' as const, description: 'SAL 1KG', quantity: 1, unit: 'UD', unitPrice: 0.5, total: 0.5 });
    expect(r.id).toBe('l1');
    expect(r.code).toBe('A1');
    expect(r.matchStatus).toBe('nuevo');
    expect(r.baseUnit).toBe('kg');
    expect(r.pricePerBase).toBeCloseTo(0.5, 6);
  });
});
