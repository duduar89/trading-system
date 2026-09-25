import { z } from 'zod';
import type { Allergen, IngredientCategory, PackSize, QtyBasis, QtyUnit } from '../types';
import { parseUnit } from '../core/units';

/**
 * Esquemas de la integración con Claude.
 *
 * Para cada tarea hay dos esquemas:
 *  - «wire»: esquema estricto (tipos simples, todo `required` salvo unos pocos opcionales) que se convierte a JSON Schema
 *    y se envía en `output_config.format` para que Claude devuelva exactamente esa forma.
 *  - «parse»: esquema zod tolerante con el que se valida y limpia la respuesta (números como texto con comas, enums con
 *    tildes o en plural, elementos mal formados…). Sólo falla si la forma general no es la esperada (y entonces se
 *    reintenta una vez pidiendo a Claude que corrija su respuesta).
 */

// ───────────────────────────── Enumeraciones del dominio ─────────────────────────────

export const CATEGORY_VALUES = [
  'carne',
  'pescado',
  'marisco',
  'verdura',
  'fruta',
  'lacteo',
  'huevo',
  'cereal',
  'legumbre',
  'aceite',
  'condimento',
  'panaderia',
  'bebida',
  'congelado',
  'conserva',
  'charcuteria',
  'dulce',
  'otros',
] as const satisfies readonly IngredientCategory[];

export const ALLERGEN_VALUES = [
  'gluten',
  'crustaceos',
  'huevo',
  'pescado',
  'cacahuete',
  'soja',
  'lacteos',
  'frutos_cascara',
  'apio',
  'mostaza',
  'sesamo',
  'sulfitos',
  'altramuces',
  'moluscos',
] as const satisfies readonly Allergen[];

export const QTY_UNIT_VALUES = [
  'g',
  'kg',
  'mg',
  'ml',
  'cl',
  'dl',
  'l',
  'ud',
  'docena',
  'cucharada',
  'cucharadita',
  'pizca',
  'taza',
] as const satisfies readonly QtyUnit[];

export const BASIS_VALUES = ['neta', 'bruta', 'cocinada'] as const satisfies readonly QtyBasis[];

export const PACK_UNIT_VALUES = ['kg', 'g', 'l', 'cl', 'ml', 'ud'] as const satisfies readonly PackSize['unit'][];

// Comprobaciones de exhaustividad en tiempo de compilación: si alguien añade un valor al dominio, esto deja de compilar.
type Missing<All extends string, Listed extends string> = Exclude<All, Listed>;
const exhaustive = <T extends never>(): T | undefined => undefined;
void exhaustive<Missing<IngredientCategory, (typeof CATEGORY_VALUES)[number]>>;
void exhaustive<Missing<Allergen, (typeof ALLERGEN_VALUES)[number]>>;
void exhaustive<Missing<QtyUnit, (typeof QTY_UNIT_VALUES)[number]>>;
void exhaustive<Missing<QtyBasis, (typeof BASIS_VALUES)[number]>>;
void exhaustive<Missing<PackSize['unit'], (typeof PACK_UNIT_VALUES)[number]>>;

// ───────────────────────────── Coerción tolerante ─────────────────────────────

/** Minúsculas, sin tildes, espacios/guiones → "_" (para comparar valores de enum). */
export function enumKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-/]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Número a partir de lo que devuelva el modelo: number, "1.234,56", "12,5 €", "21%", "(3,20)", "3,20-" (negativo
 * contable), "1,234.56". Devuelve undefined si no es un número finito.
 */
export function coerceNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  let s = v.trim().replace(/[\s  ]/g, '');
  if (!s) return undefined;
  s = s.replace(/(€|eur(os)?|%)/gi, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/'/g, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return undefined;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal; el otro, de miles.
    normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    if (parts.length > 2) {
      if (!parts.slice(1).every((p) => p.length === 3)) return undefined;
      normalized = parts.join('');
    } else {
      normalized = parts.join('.');
    }
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (parts.length > 2) {
      if (!parts.slice(1).every((p) => p.length === 3)) return undefined;
      normalized = parts.join('');
    } else {
      const [intPart, decPart] = parts;
      // "1.500" en contexto español = mil quinientos; "0.125" o "12.50" = decimales.
      const thousands = decPart.length === 3 && intPart.length >= 1 && intPart.length <= 3 && !/^0+$/.test(intPart);
      normalized = thousands ? intPart + decPart : `${intPart || '0'}.${decPart}`;
    }
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/** Texto limpio (espacios colapsados). Números → texto. Cualquier otra cosa → ''. */
export function coerceString(v: unknown): string {
  if (typeof v === 'string') return v.replace(/[\s ]+/g, ' ').trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** Valor de un enum a partir de texto libre: exacto, sin tildes, alias o singular. */
export function coerceEnum<T extends string>(v: unknown, values: readonly T[], aliases: Record<string, T> = {}): T | undefined {
  if (typeof v !== 'string') return undefined;
  const key = enumKey(v);
  if (!key) return undefined;
  const direct = values.find((x) => x === key);
  if (direct) return direct;
  if (aliases[key]) return aliases[key];
  const singular = key.replace(/(es|s)$/, '');
  const bySingular = values.find((x) => x === singular) ?? aliases[singular];
  if (bySingular) return bySingular;
  // Coincidencia por prefijo de la primera palabra ("verduras_y_hortalizas" → verdura)
  const first = key.split('_')[0];
  return values.find((x) => x === first || x === first.replace(/(es|s)$/, '')) ?? aliases[first];
}

export const CATEGORY_ALIASES: Record<string, IngredientCategory> = {
  vacuno: 'carne',
  ternera: 'carne',
  cerdo: 'carne',
  pollo: 'carne',
  ave: 'carne',
  aves: 'carne',
  cordero: 'carne',
  caza: 'carne',
  pescado_fresco: 'pescado',
  crustaceo: 'marisco',
  crustaceos: 'marisco',
  molusco: 'marisco',
  moluscos: 'marisco',
  hortaliza: 'verdura',
  hortalizas: 'verdura',
  vegetal: 'verdura',
  vegetales: 'verdura',
  seta: 'verdura',
  setas: 'verdura',
  lacteos: 'lacteo',
  queso: 'lacteo',
  quesos: 'lacteo',
  leche: 'lacteo',
  huevos: 'huevo',
  ovoproducto: 'huevo',
  ovoproductos: 'huevo',
  cereales: 'cereal',
  harina: 'cereal',
  harinas: 'cereal',
  arroz: 'cereal',
  pasta: 'cereal',
  pastas: 'cereal',
  grasa: 'aceite',
  grasas: 'aceite',
  aceites: 'aceite',
  especia: 'condimento',
  especias: 'condimento',
  salsa: 'condimento',
  salsas: 'condimento',
  sal: 'condimento',
  vinagre: 'condimento',
  pan: 'panaderia',
  panes: 'panaderia',
  bolleria: 'panaderia',
  bebidas: 'bebida',
  vino: 'bebida',
  vinos: 'bebida',
  cerveza: 'bebida',
  cervezas: 'bebida',
  refresco: 'bebida',
  refrescos: 'bebida',
  licor: 'bebida',
  licores: 'bebida',
  agua: 'bebida',
  cafe: 'bebida',
  congelados: 'congelado',
  ultracongelado: 'congelado',
  conservas: 'conserva',
  embutido: 'charcuteria',
  embutidos: 'charcuteria',
  fiambre: 'charcuteria',
  fiambres: 'charcuteria',
  jamon: 'charcuteria',
  dulces: 'dulce',
  reposteria: 'dulce',
  pasteleria: 'dulce',
  postre: 'dulce',
  postres: 'dulce',
  chocolate: 'dulce',
  azucar: 'dulce',
  otro: 'otros',
  limpieza: 'otros',
  menaje: 'otros',
  desechable: 'otros',
  desechables: 'otros',
  varios: 'otros',
  no_alimentario: 'otros',
};

export const ALLERGEN_ALIASES: Record<string, Allergen> = {
  trigo: 'gluten',
  cereales_con_gluten: 'gluten',
  crustaceo: 'crustaceos',
  huevos: 'huevo',
  ovoproductos: 'huevo',
  pescados: 'pescado',
  cacahuetes: 'cacahuete',
  mani: 'cacahuete',
  soya: 'soja',
  lacteo: 'lacteos',
  leche: 'lacteos',
  lactosa: 'lacteos',
  frutos_de_cascara: 'frutos_cascara',
  fruto_de_cascara: 'frutos_cascara',
  frutos_secos: 'frutos_cascara',
  fruto_seco: 'frutos_cascara',
  nueces: 'frutos_cascara',
  almendras: 'frutos_cascara',
  avellanas: 'frutos_cascara',
  pistachos: 'frutos_cascara',
  ajonjoli: 'sesamo',
  granos_de_sesamo: 'sesamo',
  sulfito: 'sulfitos',
  dioxido_de_azufre: 'sulfitos',
  dioxido_de_azufre_y_sulfitos: 'sulfitos',
  so2: 'sulfitos',
  altramuz: 'altramuces',
  molusco: 'moluscos',
};

// ───────────────────────────── Piezas zod tolerantes ─────────────────────────────

/**
 * Base de las piezas tolerantes: acepta cualquier valor, también la clave ausente (en zod 4 una transformación sin
 * `.optional()` previo exige que la clave exista).
 */
const anyValue = z.unknown().optional();

/** Número opcional: acepta texto con formato español; cualquier cosa no numérica → undefined. */
export const looseNumber = anyValue.transform((v) => coerceNumber(v));

/** Texto: acepta números; cualquier otra cosa → ''. */
export const looseString = anyValue.transform((v) => coerceString(v));

/** Lista de textos no vacíos. */
export const looseStringArray = anyValue.transform((v) => (Array.isArray(v) ? v.map(coerceString).filter(Boolean) : []));

/** Enum con valor por defecto si no se reconoce. */
export function looseEnum<T extends string>(values: readonly T[], fallback: T, aliases?: Record<string, T>) {
  return anyValue.transform((v): T => coerceEnum(v, values, aliases) ?? fallback);
}

/** Enum opcional: undefined si no se reconoce. */
export function looseOptionalEnum<T extends string>(values: readonly T[], aliases?: Record<string, T>) {
  return anyValue.transform((v): T | undefined => coerceEnum(v, values, aliases));
}

/** Array en el que los elementos que no validan se descartan (en lugar de invalidar toda la respuesta). */
export function looseArray<S extends z.ZodType>(item: S) {
  return anyValue.transform((v): z.output<S>[] => {
    if (!Array.isArray(v)) return [];
    const out: z.output<S>[] = [];
    for (const x of v) {
      const r = item.safeParse(x);
      if (r.success) out.push(r.data);
    }
    return out;
  });
}

/** Array obligatorio (si falta, la respuesta no tiene la forma esperada) con elementos tolerantes. */
export function requiredArray<S extends z.ZodType>(item: S) {
  return z.array(z.unknown()).transform((v): z.output<S>[] => {
    const out: z.output<S>[] = [];
    for (const x of v) {
      const r = item.safeParse(x);
      if (r.success) out.push(r.data);
    }
    return out;
  });
}

/** Unidad de receta (QtyUnit) desde texto libre ("gr", "c/s", "litros"…). */
export const looseQtyUnit = anyValue.transform((v): QtyUnit | undefined => {
  if (typeof v !== 'string') return undefined;
  return coerceEnum(v, QTY_UNIT_VALUES) ?? parseUnit(v);
});

/** Formato de envase validado: count y size > 0, unidad reconocible (dl y docena se convierten). */
export const loosePackSize = anyValue.transform((v): PackSize | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  let count = coerceNumber(o.count) ?? 1;
  let size = coerceNumber(o.size);
  const rawUnit = typeof o.unit === 'string' ? o.unit : '';
  if (size === undefined || !(size > 0) || !(count > 0)) return undefined;
  let unit: PackSize['unit'] | undefined = coerceEnum(rawUnit, PACK_UNIT_VALUES);
  if (!unit) {
    const parsed = parseUnit(rawUnit);
    if (parsed === 'mg') {
      unit = 'g';
      size /= 1000;
    } else if (parsed === 'dl') {
      unit = 'cl';
      size *= 10;
    } else if (parsed === 'docena') {
      unit = 'ud';
      count *= size;
      size = 1;
    } else if (parsed && (PACK_UNIT_VALUES as readonly string[]).includes(parsed)) {
      unit = parsed as PackSize['unit'];
    }
  }
  if (!unit) return undefined;
  return { count, size, unit };
});

// ───────────────────────────── JSON Schema para output_config.format ─────────────────────────────

const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'maxItems',
  'uniqueItems',
  'default',
  'examples',
  'minProperties',
  'maxProperties',
]);
const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

/**
 * Deja un JSON Schema dentro de lo que admiten las salidas estructuradas: sin restricciones numéricas ni de longitud,
 * `additionalProperties: false` en todos los objetos, `minItems` sólo 0/1 y formatos de texto soportados.
 */
export function sanitizeJsonSchema(schema: unknown): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED_KEYWORDS.has(k)) continue;
      if (k === 'format' && (typeof v !== 'string' || !SUPPORTED_FORMATS.has(v))) continue;
      if (k === 'minItems' && v !== 0 && v !== 1) continue;
      if (k === 'properties' && v && typeof v === 'object') {
        out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, walk(pv)]));
        continue;
      }
      out[k] = walk(v);
    }
    if (out.type === 'object' || (Array.isArray(out.type) && out.type.includes('object'))) {
      out.additionalProperties = false;
      if (!out.properties) out.properties = {};
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

/** JSON Schema (saneado) de un esquema zod estricto. */
export function toWireJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return sanitizeJsonSchema(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output', unrepresentable: 'any' }));
}

function memo<T>(fn: () => T): () => T {
  let cached: T | undefined;
  let done = false;
  return () => {
    if (!done) {
      cached = fn();
      done = true;
    }
    return cached as T;
  };
}

// ───────────────────────────── Facturas ─────────────────────────────

const wireInvoiceLine = z.object({
  description: z.string().describe('Descripción literal de la línea tal y como aparece (con formato/envase)'),
  code: z.string().describe('Código o referencia del artículo del proveedor; "" si no hay'),
  quantity: z.number().describe('Cantidad facturada en la unidad de facturación (peso si se factura por kg)'),
  unit: z.string().describe('Unidad de facturación tal cual: kg, g, l, ud, caja, bot, paq, bandeja, saco, lata…'),
  unitPrice: z.number().describe('Precio por unidad de facturación SIN IVA y ANTES de descuento'),
  discountPct: z.number().describe('Descuento de la línea en % (0 si no hay)'),
  total: z.number().describe('Importe neto de la línea SIN IVA tras el descuento'),
  vatPct: z.number().optional().describe('IVA de la línea en % (4, 10, 21…) si se puede determinar'),
  packSize: z
    .object({
      count: z.number().describe('Número de envases dentro de UNA unidad facturada'),
      size: z.number().describe('Contenido de cada envase'),
      unit: z.enum(PACK_UNIT_VALUES),
    })
    .optional()
    .describe('Contenido de UNA unidad facturada si la descripción lo indica ("6X1L" → 6 × 1 l)'),
  suggestedName: z.string().describe('Nombre genérico del producto en español, singular, sin marca ni formato'),
  suggestedCategory: z.enum(CATEGORY_VALUES),
  confidence: z.number().describe('Confianza 0–1 en la lectura de esta línea'),
});

const wireInvoice = z.object({
  supplierName: z.string().describe('Nombre del EMISOR de la factura (proveedor), nunca el cliente; "" si no aparece'),
  supplierTaxId: z.string().describe('CIF/NIF del emisor; "" si no aparece'),
  number: z.string().describe('Número de factura, albarán o ticket; "" si no aparece'),
  date: z.string().describe('Fecha de expedición en formato AAAA-MM-DD; "" si no aparece'),
  subtotal: z.number().optional().describe('Base imponible total (sin IVA, tras descuentos)'),
  vatTotal: z.number().optional().describe('Cuota total de IVA (sin recargo de equivalencia)'),
  total: z.number().optional().describe('Total de la factura a pagar'),
  lines: z.array(wireInvoiceLine).describe('Una entrada por cada línea de producto, en el orden del documento'),
  nonProductLines: z
    .array(
      z.object({
        description: z.string(),
        amount: z.number().optional().describe('Importe sin IVA con signo (negativo si es un descuento)'),
      }),
    )
    .describe('Líneas que NO son producto: portes, recargos, envases retornables, redondeos, descuentos globales…'),
  warnings: z.array(z.string()).describe('Avisos breves en español para el usuario'),
});

export const invoiceWireJsonSchema = memo(() => toWireJsonSchema(wireInvoice));

const parseInvoiceLine = z.object({
  description: looseString,
  code: looseString,
  quantity: looseNumber,
  unit: looseString,
  unitPrice: looseNumber,
  discountPct: looseNumber,
  total: looseNumber,
  vatPct: looseNumber,
  packSize: loosePackSize,
  suggestedName: looseString,
  suggestedCategory: looseOptionalEnum(CATEGORY_VALUES, CATEGORY_ALIASES),
  confidence: looseNumber,
});

export const invoiceParseSchema = z.object({
  supplierName: looseString,
  supplierTaxId: looseString,
  number: looseString,
  date: looseString,
  subtotal: looseNumber,
  vatTotal: looseNumber,
  total: looseNumber,
  lines: requiredArray(parseInvoiceLine),
  nonProductLines: looseArray(z.object({ description: looseString, amount: looseNumber })),
  warnings: looseStringArray,
});

export type ParsedInvoice = z.output<typeof invoiceParseSchema>;
export type ParsedInvoiceLine = ParsedInvoice['lines'][number];

// ───────────────────────────── Cartas ─────────────────────────────

const wireMenu = z.object({
  items: z
    .array(
      z.object({
        section: z.string().describe('Sección de la carta tal y como aparece (p. ej. "Entrantes"); "" si no hay'),
        name: z.string().describe('Nombre del plato o producto tal y como está impreso'),
        description: z.string().describe('Descripción, ingredientes y notas de precio; "" si no hay'),
        price: z.number().optional().describe('PVP en euros CON IVA de la ración/unidad completa'),
        confidence: z.number().describe('Confianza 0–1 en la lectura'),
      }),
    )
    .describe('Todos los platos y productos con precio, en el orden de la carta, sin duplicados'),
  warnings: z.array(z.string()).describe('Avisos breves en español (fotos borrosas, texto cortado…)'),
});

export const menuWireJsonSchema = memo(() => toWireJsonSchema(wireMenu));

export const menuParseSchema = z.object({
  items: requiredArray(
    z.object({
      section: looseString,
      name: looseString,
      description: looseString,
      price: looseNumber,
      confidence: looseNumber,
    }),
  ),
  warnings: looseStringArray,
});

export type ParsedMenu = z.output<typeof menuParseSchema>;

// ───────────────────────────── Recetas ─────────────────────────────

const wireRecipes = z.object({
  dishes: z.array(
    z.object({
      ref: z.string().describe('Referencia del plato tal y como se indicó (D1, D2…)'),
      dishName: z.string(),
      ingredients: z.array(
        z.object({
          name: z.string().describe('Nombre genérico del ingrediente en español, singular'),
          quantity: z.number().describe('Cantidad para UNA ración'),
          unit: z.enum(QTY_UNIT_VALUES),
          basis: z.enum(BASIS_VALUES),
          wastePct: z.number().optional().describe('Merma de limpieza % sólo si difiere de lo habitual'),
          cookingLossPct: z.number().optional().describe('Merma de cocción % sólo si difiere de lo habitual'),
          category: z.enum(CATEGORY_VALUES),
          productRef: z.string().describe('Referencia del catálogo (P1, P2…) del MISMO producto; "" si no hay o hay duda'),
          note: z.string().describe('Nota breve opcional; "" si no hay'),
        }),
      ),
      steps: z.array(z.string()).describe('Elaboración en 2–4 pasos breves'),
      allergens: z.array(z.enum(ALLERGEN_VALUES)),
      confidence: z.number().describe('Confianza 0–1 en el escandallo propuesto'),
    }),
  ),
});

export const recipesWireJsonSchema = memo(() => toWireJsonSchema(wireRecipes));

const parseRecipeIngredient = z.object({
  name: looseString,
  quantity: looseNumber,
  unit: looseQtyUnit,
  basis: looseEnum(BASIS_VALUES, 'neta', { limpia: 'neta', neto: 'neta', bruto: 'bruta', cocinado: 'cocinada', cocida: 'cocinada' }),
  wastePct: looseNumber,
  cookingLossPct: looseNumber,
  category: looseOptionalEnum(CATEGORY_VALUES, CATEGORY_ALIASES),
  productRef: looseString,
  note: looseString,
});

export const recipesParseSchema = z.object({
  dishes: requiredArray(
    z.object({
      ref: looseString,
      dishName: looseString,
      ingredients: looseArray(parseRecipeIngredient),
      steps: looseStringArray,
      allergens: z
        .unknown()
        .optional()
        .transform((v): Allergen[] =>
          Array.isArray(v) ? [...new Set(v.map((a) => coerceEnum(a, ALLERGEN_VALUES, ALLERGEN_ALIASES)).filter((a): a is Allergen => !!a))] : [],
        ),
      confidence: looseNumber,
    }),
  ),
});

export type ParsedRecipes = z.output<typeof recipesParseSchema>;
export type ParsedRecipeDish = ParsedRecipes['dishes'][number];
export type ParsedRecipeIngredient = ParsedRecipeDish['ingredients'][number];
