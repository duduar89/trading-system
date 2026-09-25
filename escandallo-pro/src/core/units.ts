import type { BaseUnit, QtyUnit } from '../types';

/**
 * Conversión de unidades. Todo se lleva a unidades base (kg, l, ud) antes de calcular.
 */

export type Dimension = 'mass' | 'volume' | 'count';

interface UnitDef {
  dim: Dimension;
  /** Factor a la unidad base de su dimensión (kg, l o ud). */
  factor: number;
}

export const UNIT_DEFS: Record<QtyUnit, UnitDef> = {
  kg: { dim: 'mass', factor: 1 },
  g: { dim: 'mass', factor: 0.001 },
  mg: { dim: 'mass', factor: 0.000001 },
  l: { dim: 'volume', factor: 1 },
  dl: { dim: 'volume', factor: 0.1 },
  cl: { dim: 'volume', factor: 0.01 },
  ml: { dim: 'volume', factor: 0.001 },
  ud: { dim: 'count', factor: 1 },
  docena: { dim: 'count', factor: 12 },
  cucharada: { dim: 'volume', factor: 0.015 },
  cucharadita: { dim: 'volume', factor: 0.005 },
  pizca: { dim: 'mass', factor: 0.0005 },
  taza: { dim: 'volume', factor: 0.25 },
};

export const QTY_UNITS = Object.keys(UNIT_DEFS) as QtyUnit[];

/** Etiquetas cortas para la UI. */
export const UNIT_LABELS: Record<QtyUnit, string> = {
  kg: 'kg',
  g: 'g',
  mg: 'mg',
  l: 'l',
  dl: 'dl',
  cl: 'cl',
  ml: 'ml',
  ud: 'ud',
  docena: 'docena',
  cucharada: 'cda.',
  cucharadita: 'cdta.',
  pizca: 'pizca',
  taza: 'taza',
};

export function dimensionOf(unit: QtyUnit | BaseUnit): Dimension {
  return UNIT_DEFS[unit as QtyUnit].dim;
}

export function baseUnitOfDimension(dim: Dimension): BaseUnit {
  return dim === 'mass' ? 'kg' : dim === 'volume' ? 'l' : 'ud';
}

/** Propiedades físicas de un producto para convertir entre dimensiones. */
export interface ConversionProps {
  /** kg por unidad (ud → kg). */
  unitWeightKg?: number;
  /** kg por litro (l → kg). Si falta, se asume 1 (agua) sólo cuando `assumeWaterDensity` es true. */
  densityKgPerL?: number;
}

export interface ConversionResult {
  value: number;
  ok: boolean;
  /** Si hubo que asumir algo (densidad 1, etc.), se explica aquí. */
  assumption?: string;
  error?: string;
}

/**
 * Convierte `qty` expresado en `unit` a la unidad base `target` del producto.
 * Admite conversiones entre dimensiones usando peso por unidad y densidad.
 */
export function convertToBase(
  qty: number,
  unit: QtyUnit | BaseUnit,
  target: BaseUnit,
  props: ConversionProps = {},
): ConversionResult {
  const def = UNIT_DEFS[unit as QtyUnit];
  if (!def) return { value: 0, ok: false, error: `Unidad desconocida: ${unit}` };
  if (!Number.isFinite(qty)) return { value: 0, ok: false, error: 'Cantidad no válida' };
  const inBase = qty * def.factor; // en kg, l o ud según su dimensión
  const from = def.dim;
  const to = dimensionOf(target);
  if (from === to) return { value: inBase, ok: true };

  const density = props.densityKgPerL && props.densityKgPerL > 0 ? props.densityKgPerL : undefined;
  const unitW = props.unitWeightKg && props.unitWeightKg > 0 ? props.unitWeightKg : undefined;

  // masa ⇄ volumen
  if (from === 'volume' && to === 'mass') {
    const d = density ?? 1;
    return { value: inBase * d, ok: true, assumption: density ? undefined : 'Se asume densidad 1 kg/l' };
  }
  if (from === 'mass' && to === 'volume') {
    const d = density ?? 1;
    return { value: inBase / d, ok: true, assumption: density ? undefined : 'Se asume densidad 1 kg/l' };
  }
  // unidades ⇄ masa/volumen
  if (from === 'count' && to === 'mass') {
    if (!unitW) return { value: 0, ok: false, error: 'Falta el peso por unidad del producto' };
    return { value: inBase * unitW, ok: true };
  }
  if (from === 'mass' && to === 'count') {
    if (!unitW) return { value: 0, ok: false, error: 'Falta el peso por unidad del producto' };
    return { value: inBase / unitW, ok: true };
  }
  if (from === 'count' && to === 'volume') {
    if (!unitW) return { value: 0, ok: false, error: 'Falta el peso por unidad del producto' };
    const d = density ?? 1;
    return { value: (inBase * unitW) / d, ok: true, assumption: density ? undefined : 'Se asume densidad 1 kg/l' };
  }
  if (from === 'volume' && to === 'count') {
    if (!unitW) return { value: 0, ok: false, error: 'Falta el peso por unidad del producto' };
    const d = density ?? 1;
    return { value: (inBase * d) / unitW, ok: true, assumption: density ? undefined : 'Se asume densidad 1 kg/l' };
  }
  return { value: 0, ok: false, error: 'Conversión no soportada' };
}

/** Convierte una cantidad en unidad base a kg (para agregados de peso). Devuelve undefined si no es posible. */
export function baseToKg(qty: number, unit: BaseUnit, props: ConversionProps = {}): number | undefined {
  if (unit === 'kg') return qty;
  if (unit === 'l') return qty * (props.densityKgPerL && props.densityKgPerL > 0 ? props.densityKgPerL : 1);
  if (props.unitWeightKg && props.unitWeightKg > 0) return qty * props.unitWeightKg;
  return undefined;
}

/**
 * Interpreta un texto de unidad libre ("gr", "grs", "Kg.", "litros", "uds", "c/s", "cda") como QtyUnit.
 * Devuelve undefined si no se reconoce.
 */
export function parseUnit(raw: string | undefined | null): QtyUnit | undefined {
  if (!raw) return undefined;
  const s = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.\s]/g, '');
  const map: Record<string, QtyUnit> = {
    kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg', k: 'kg',
    g: 'g', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g', grm: 'g',
    mg: 'mg', miligramo: 'mg', miligramos: 'mg',
    l: 'l', lt: 'l', lts: 'l', ltr: 'l', litro: 'l', litros: 'l',
    dl: 'dl', decilitro: 'dl', decilitros: 'dl',
    cl: 'cl', centilitro: 'cl', centilitros: 'cl',
    ml: 'ml', mililitro: 'ml', mililitros: 'ml', cc: 'ml',
    ud: 'ud', uds: 'ud', u: 'ud', un: 'ud', und: 'ud', unds: 'ud', unid: 'ud', unidad: 'ud', unidades: 'ud', pieza: 'ud', piezas: 'ud', pz: 'ud', pza: 'ud',
    diente: 'ud', dientes: 'ud', hoja: 'ud', hojas: 'ud', rama: 'ud', ramas: 'ud', loncha: 'ud', lonchas: 'ud', rodaja: 'ud', rodajas: 'ud',
    docena: 'docena', docenas: 'docena', dz: 'docena', doc: 'docena',
    cucharada: 'cucharada', cucharadas: 'cucharada', cda: 'cucharada', cdas: 'cucharada', cs: 'cucharada', 'c/s': 'cucharada',
    cucharadita: 'cucharadita', cucharaditas: 'cucharadita', cdta: 'cucharadita', cdtas: 'cucharadita', cc2: 'cucharadita', 'c/p': 'cucharadita',
    pizca: 'pizca', pizcas: 'pizca',
    taza: 'taza', tazas: 'taza',
  };
  return map[s];
}

/** Unidad por defecto para mostrar una cantidad en recetas según la unidad base del producto. */
export function defaultRecipeUnit(base: BaseUnit): QtyUnit {
  return base === 'kg' ? 'g' : base === 'l' ? 'ml' : 'ud';
}
