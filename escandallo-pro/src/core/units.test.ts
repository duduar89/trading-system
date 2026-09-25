import { describe, expect, it } from 'vitest';
import type { QtyUnit } from '../types';
import { QTY_UNITS, UNIT_DEFS, UNIT_LABELS, baseToKg, baseUnitOfDimension, convertToBase, defaultRecipeUnit, dimensionOf, parseUnit } from './units';

describe('convertToBase: misma dimensión', () => {
  it.each<[number, QtyUnit, 'kg' | 'l' | 'ud', number]>([
    [200, 'g', 'kg', 0.2],
    [1.5, 'kg', 'kg', 1.5],
    [500, 'mg', 'kg', 0.0005],
    [250, 'ml', 'l', 0.25],
    [33, 'cl', 'l', 0.33],
    [5, 'dl', 'l', 0.5],
    [2, 'cucharada', 'l', 0.03],
    [3, 'cucharadita', 'l', 0.015],
    [1, 'taza', 'l', 0.25],
    [2, 'pizca', 'kg', 0.001],
    [1, 'docena', 'ud', 12],
    [3, 'ud', 'ud', 3],
  ])('%d %s → %s = %d', (qty, unit, target, expected) => {
    const r = convertToBase(qty, unit, target);
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(expected, 10);
    expect(r.assumption).toBeUndefined();
  });
});

describe('convertToBase: entre dimensiones', () => {
  it('ud → kg con peso por unidad', () => {
    const r = convertToBase(3, 'ud', 'kg', { unitWeightKg: 0.06 });
    expect(r).toMatchObject({ ok: true });
    expect(r.value).toBeCloseTo(0.18, 10);
  });

  it('docena → kg', () => {
    expect(convertToBase(1, 'docena', 'kg', { unitWeightKg: 0.065 }).value).toBeCloseTo(0.78, 10);
  });

  it('kg → ud con peso por unidad', () => {
    expect(convertToBase(120, 'g', 'ud', { unitWeightKg: 0.06 }).value).toBeCloseTo(2, 10);
  });

  it('ud sin peso por unidad → no resoluble', () => {
    const r = convertToBase(2, 'ud', 'kg');
    expect(r.ok).toBe(false);
    expect(r.value).toBe(0);
    expect(r.error).toBe('Falta el peso por unidad del producto');
    expect(convertToBase(100, 'g', 'ud').ok).toBe(false);
    expect(convertToBase(1, 'l', 'ud').ok).toBe(false);
    expect(convertToBase(1, 'ud', 'l').ok).toBe(false);
  });

  it('volumen → masa con densidad y sin ella (asume agua y lo dice)', () => {
    const oil = convertToBase(100, 'ml', 'kg', { densityKgPerL: 0.92 });
    expect(oil.value).toBeCloseTo(0.092, 10);
    expect(oil.assumption).toBeUndefined();
    const water = convertToBase(1, 'l', 'kg');
    expect(water.value).toBe(1);
    expect(water.assumption).toBe('Se asume densidad 1 kg/l');
    expect(convertToBase(1, 'cucharadita', 'kg', { densityKgPerL: 1.2 }).value).toBeCloseTo(0.006, 10);
  });

  it('masa → volumen', () => {
    expect(convertToBase(0.46, 'kg', 'l', { densityKgPerL: 0.92 }).value).toBeCloseTo(0.5, 10);
    expect(convertToBase(0.5, 'kg', 'l').assumption).toBe('Se asume densidad 1 kg/l');
  });

  it('ud ⇄ volumen usando peso por unidad y densidad', () => {
    expect(convertToBase(2, 'ud', 'l', { unitWeightKg: 0.5, densityKgPerL: 1.25 }).value).toBeCloseTo(0.8, 10);
    const r = convertToBase(1, 'l', 'ud', { unitWeightKg: 0.25 });
    expect(r.value).toBeCloseTo(4, 10);
    expect(r.assumption).toBe('Se asume densidad 1 kg/l');
  });

  it('pesos o densidades no positivos se ignoran', () => {
    expect(convertToBase(2, 'ud', 'kg', { unitWeightKg: 0 }).ok).toBe(false);
    expect(convertToBase(1, 'l', 'kg', { densityKgPerL: -1 }).assumption).toBe('Se asume densidad 1 kg/l');
  });

  it('unidad desconocida o cantidad no finita → error', () => {
    expect(convertToBase(1, 'saco' as QtyUnit, 'kg')).toMatchObject({ ok: false, error: 'Unidad desconocida: saco' });
    expect(convertToBase(Number.NaN, 'g', 'kg')).toMatchObject({ ok: false, error: 'Cantidad no válida' });
    expect(convertToBase(Number.POSITIVE_INFINITY, 'g', 'kg').ok).toBe(false);
  });
});

describe('baseToKg', () => {
  it('convierte a kg cuando es posible', () => {
    expect(baseToKg(2, 'kg')).toBe(2);
    expect(baseToKg(1, 'l', { densityKgPerL: 0.92 })).toBeCloseTo(0.92, 10);
    expect(baseToKg(1, 'l')).toBe(1);
    expect(baseToKg(3, 'ud', { unitWeightKg: 0.06 })).toBeCloseTo(0.18, 10);
    expect(baseToKg(3, 'ud')).toBeUndefined();
  });
});

describe('parseUnit', () => {
  it.each<[string | null | undefined, QtyUnit | undefined]>([
    ['gr', 'g'],
    ['Grs.', 'g'],
    ['gramos', 'g'],
    ['Kg.', 'kg'],
    ['KILOS', 'kg'],
    ['litros', 'l'],
    ['Lt', 'l'],
    ['ML', 'ml'],
    ['cc', 'ml'],
    ['cl', 'cl'],
    ['uds', 'ud'],
    ['Unidades', 'ud'],
    ['dientes', 'ud'],
    ['lonchas', 'ud'],
    ['dz', 'docena'],
    ['docenas', 'docena'],
    ['c/s', 'cucharada'],
    ['cda', 'cucharada'],
    ['cucharadas', 'cucharada'],
    ['cdta', 'cucharadita'],
    ['c/p', 'cucharadita'],
    ['pizca', 'pizca'],
    ['tazas', 'taza'],
    ['saco', undefined],
    ['', undefined],
    [null, undefined],
    [undefined, undefined],
  ])('%j → %j', (raw, expected) => {
    expect(parseUnit(raw)).toBe(expected);
  });
});

describe('metadatos de unidades', () => {
  it('todas las unidades tienen definición y etiqueta', () => {
    expect(QTY_UNITS).toHaveLength(13);
    for (const u of QTY_UNITS) {
      expect(UNIT_DEFS[u].factor).toBeGreaterThan(0);
      expect(UNIT_LABELS[u]).toBeTruthy();
    }
  });
  it('dimensiones y unidad base', () => {
    expect(dimensionOf('g')).toBe('mass');
    expect(dimensionOf('l')).toBe('volume');
    expect(dimensionOf('docena')).toBe('count');
    expect(dimensionOf('cucharada')).toBe('volume');
    expect(dimensionOf('pizca')).toBe('mass');
    expect(baseUnitOfDimension('mass')).toBe('kg');
    expect(baseUnitOfDimension('volume')).toBe('l');
    expect(baseUnitOfDimension('count')).toBe('ud');
  });
  it('unidad por defecto en recetas', () => {
    expect(defaultRecipeUnit('kg')).toBe('g');
    expect(defaultRecipeUnit('l')).toBe('ml');
    expect(defaultRecipeUnit('ud')).toBe('ud');
  });
});
