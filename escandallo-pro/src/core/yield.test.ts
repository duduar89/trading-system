import { describe, expect, it } from 'vitest';
import type { YieldTest } from '../types';
import { computeYield } from './yield';

type YieldInput = Parameters<typeof computeYield>[0];

/** Salmón entero de 5 kg a 12 €/kg (caso de referencia calculado a mano). */
const salmon: YieldInput = {
  grossWeightKg: 5,
  purchasePricePerKg: 12,
  outputs: [
    { id: 'o1', name: 'Lomos', weightKg: 3.1, kind: 'principal' },
    { id: 'o2', name: 'Recortes para tartar', weightKg: 0.4, kind: 'subproducto', valuePerKg: 4 },
    { id: 'o3', name: 'Espinas y piel', weightKg: 1.3, kind: 'desperdicio' },
  ],
  cookingLossPct: 18,
  portionKg: 0.15,
};

describe('computeYield: salmón de referencia', () => {
  const r = computeYield(salmon);

  it('pesos y reparto', () => {
    expect(r.grossWeightKg).toBe(5);
    expect(r.grossCost).toBeCloseTo(60, 10);
    expect(r.principalKg).toBeCloseTo(3.1, 10);
    expect(r.byproductKg).toBeCloseTo(0.4, 10);
    expect(r.wasteKg).toBeCloseTo(1.3, 10);
    expect(r.unaccountedKg).toBeCloseTo(0.2, 10);
  });

  it('rendimientos y mermas', () => {
    expect(r.yieldPct).toBeCloseTo(62, 10);
    expect(r.totalWastePct).toBeCloseTo(38, 10);
    // Lo que de verdad se tira: (5 − 3,1 − 0,4) / 5
    expect(r.realWastePct).toBeCloseTo(30, 10);
  });

  it('costes reales', () => {
    expect(r.byproductValue).toBeCloseTo(1.6, 10);
    // (60 − 1,6) / 3,1
    expect(r.costPerUsableKg).toBeCloseTo(18.8387, 4);
    expect(r.cookedKg).toBeCloseTo(2.542, 10);
    expect(r.finalYieldPct).toBeCloseTo(50.84, 10);
    // 58,4 / 2,542
    expect(r.costPerCookedKg).toBeCloseTo(22.9740, 4);
    expect(r.costFactor).toBeCloseTo(22.97403 / 12, 4);
  });

  it('por ración de 150 g servidos', () => {
    expect(r.portions).toBe(16); // floor(2,542 / 0,15) = floor(16,95)
    expect(r.grossPerPortionKg).toBeCloseTo(0.295043, 6); // 0,15 / (2,542 / 5)
    expect(r.wastePerPortionKg).toBeCloseTo(0.145043, 6);
    expect(r.costPerPortion).toBeCloseTo(3.446105, 6); // 0,15 × 22,97403
    expect(r.wasteCostPerPortion).toBeCloseTo(1.646105, 6); // 3,446105 − 0,15 × 12
    expect(r.warnings).toEqual([]);
  });
});

describe('computeYield: otros casos', () => {
  it('pérdida por descongelación sobre el bruto', () => {
    const r = computeYield({
      grossWeightKg: 10,
      purchasePricePerKg: 9,
      thawLossPct: 20,
      outputs: [
        { id: 'a', name: 'Pulpo limpio', weightKg: 7.2, kind: 'principal' },
        { id: 'b', name: 'Vísceras', weightKg: 0.5, kind: 'desperdicio' },
      ],
      cookingLossPct: 35,
    });
    expect(r.unaccountedKg).toBeCloseTo(0.3, 10); // 10 × 0,8 − 7,7
    expect(r.yieldPct).toBeCloseTo(72, 10);
    expect(r.costPerUsableKg).toBeCloseTo(12.5, 10); // 90 / 7,2
    expect(r.cookedKg).toBeCloseTo(4.68, 10);
    expect(r.costPerCookedKg).toBeCloseTo(90 / 4.68, 10);
    expect(r.portions).toBeUndefined();
  });

  it('sin cocción: coste cocinado = coste útil y ración exacta', () => {
    const r = computeYield({
      grossWeightKg: 2,
      purchasePricePerKg: 30,
      outputs: [{ id: 'p', name: 'Solomillo limpio', weightKg: 1.6, kind: 'principal' }],
      cookingLossPct: 0,
      portionKg: 0.2,
    });
    expect(r.costPerUsableKg).toBeCloseTo(37.5, 10);
    expect(r.costPerCookedKg).toBeCloseTo(37.5, 10);
    expect(r.portions).toBe(8); // 1,6 / 0,2 exactos (sin error de coma flotante)
    expect(r.grossPerPortionKg).toBeCloseTo(0.25, 10);
    expect(r.costPerPortion).toBeCloseTo(7.5, 10);
    expect(r.wasteCostPerPortion).toBeCloseTo(1.5, 10);
    expect(r.unaccountedKg).toBeCloseTo(0.4, 10);
  });

  it('avisa si las salidas pesan más que la pieza y no deja "no registrado" negativo', () => {
    const r = computeYield({
      grossWeightKg: 1,
      purchasePricePerKg: 10,
      outputs: [
        { id: 'p', name: 'Pieza', weightKg: 0.9, kind: 'principal' },
        { id: 'w', name: 'Grasa', weightKg: 0.3, kind: 'desperdicio' },
      ],
      cookingLossPct: 0,
    });
    expect(r.unaccountedKg).toBe(0);
    expect(r.warnings).toContain('Las salidas pesan más que la pieza: revisa los pesos.');
  });

  it('sin peso, sin precio o sin parte principal: avisos y ceros seguros', () => {
    const r = computeYield({ grossWeightKg: 0, purchasePricePerKg: 0, outputs: [], cookingLossPct: 0 });
    expect(r.warnings).toEqual([
      'Indica el peso bruto de la pieza.',
      'La pieza no tiene precio de compra.',
      'Registra al menos una salida principal (la parte que va al plato).',
    ]);
    expect(r.yieldPct).toBe(0);
    expect(r.costPerUsableKg).toBe(0);
    expect(r.costFactor).toBe(0);
    expect(Number.isFinite(r.costPerCookedKg)).toBe(true);
  });

  it('el valor de subproductos no puede superar el coste de la pieza', () => {
    const r = computeYield({
      grossWeightKg: 1,
      purchasePricePerKg: 2,
      outputs: [
        { id: 'p', name: 'Principal', weightKg: 0.5, kind: 'principal' },
        { id: 's', name: 'Subproducto caro', weightKg: 0.5, kind: 'subproducto', valuePerKg: 10 },
      ],
      cookingLossPct: 0,
    });
    expect(r.byproductValue).toBe(2);
    expect(r.costPerUsableKg).toBe(0);
    expect(r.warnings).toContain('El valor de los subproductos supera el coste de la pieza.');
  });

  it('porcentajes fuera de rango se acotan', () => {
    const r = computeYield({
      grossWeightKg: 1,
      purchasePricePerKg: 10,
      outputs: [{ id: 'p', name: 'Principal', weightKg: 1, kind: 'principal' }],
      cookingLossPct: 150,
      thawLossPct: -5,
    });
    expect(r.cookedKg).toBeCloseTo(0.001, 10); // cocción acotada a 99,9 %
    expect(r.unaccountedKg).toBe(0);
  });

  it('acepta un YieldTest completo', () => {
    const test: YieldTest = { ...salmon, id: 'y1', name: 'Salmón', date: '2025-03-01', createdAt: '', updatedAt: '' } as YieldTest;
    expect(computeYield(test).yieldPct).toBeCloseTo(62, 10);
  });
});
