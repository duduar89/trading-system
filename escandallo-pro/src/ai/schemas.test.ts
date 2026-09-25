import { describe, expect, it } from 'vitest';
import {
  coerceEnum,
  coerceNumber,
  CATEGORY_ALIASES,
  CATEGORY_VALUES,
  invoiceParseSchema,
  invoiceWireJsonSchema,
  menuParseSchema,
  menuWireJsonSchema,
  recipesParseSchema,
  recipesWireJsonSchema,
  sanitizeJsonSchema,
} from './schemas';

type Json = Record<string, unknown>;

/** Recorre un JSON Schema y devuelve todos los nodos de tipo objeto. */
function objects(node: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(node)) node.forEach((n) => objects(n, out));
  else if (node && typeof node === 'object') {
    const o = node as Json;
    if (o.type === 'object') out.push(o);
    Object.values(o).forEach((v) => objects(v, out));
  }
  return out;
}

function keysDeep(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => keysDeep(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Json)) {
      if (k !== 'properties') out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe('coerceNumber', () => {
  it.each([
    [12.5, 12.5],
    ['12,5', 12.5],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['3,20 €', 3.2],
    ['€ 3.20', 3.2],
    ['21%', 21],
    ['0,0385', 0.0385],
    ['1.000', 1000],
    ['1.5', 1.5],
    ['0.125', 0.125],
    ['12.50', 12.5],
    ['-3,2', -3.2],
    ['3,20-', -3.2],
    ['(4,50)', -4.5],
    ['1.234.567', 1234567],
    ['  7 ', 7],
  ])('%s → %s', (raw, expected) => {
    expect(coerceNumber(raw)).toBeCloseTo(expected, 6);
  });

  it.each([[''], ['abc'], ['S/M'], [null], [undefined], [NaN], [Infinity], [{}], ['1,2,3']])('%s → undefined', (raw) => {
    expect(coerceNumber(raw)).toBeUndefined();
  });
});

describe('coerceEnum', () => {
  it('tolera tildes, plurales y alias', () => {
    expect(coerceEnum('Lácteos', CATEGORY_VALUES, CATEGORY_ALIASES)).toBe('lacteo');
    expect(coerceEnum('VERDURAS', CATEGORY_VALUES, CATEGORY_ALIASES)).toBe('verdura');
    expect(coerceEnum('Panadería', CATEGORY_VALUES, CATEGORY_ALIASES)).toBe('panaderia');
    expect(coerceEnum('embutidos', CATEGORY_VALUES, CATEGORY_ALIASES)).toBe('charcuteria');
    expect(coerceEnum('Verduras y hortalizas', CATEGORY_VALUES, CATEGORY_ALIASES)).toBe('verdura');
    expect(coerceEnum('vino', CATEGORY_VALUES, CATEGORY_ALIASES)).toBe('bebida');
    expect(coerceEnum('xyz', CATEGORY_VALUES, CATEGORY_ALIASES)).toBeUndefined();
    expect(coerceEnum(3, CATEGORY_VALUES)).toBeUndefined();
  });
});

describe('JSON Schema para salidas estructuradas', () => {
  const schemas = { factura: invoiceWireJsonSchema(), carta: menuWireJsonSchema(), recetas: recipesWireJsonSchema() };

  it.each(Object.entries(schemas))('%s: objetos cerrados, sin palabras clave no admitidas', (_name, schema) => {
    expect(schema.type).toBe('object');
    const objs = objects(schema);
    expect(objs.length).toBeGreaterThan(1);
    for (const o of objs) {
      expect(o.additionalProperties).toBe(false);
      expect(Array.isArray(o.required)).toBe(true);
    }
    const keys = keysDeep(schema);
    for (const bad of ['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'default', 'uniqueItems'])
      expect(keys.has(bad), bad).toBe(false);
  });

  it('pocos campos opcionales (límites de complejidad del esquema)', () => {
    const optionalCount = (schema: Json) =>
      objects(schema).reduce((n, o) => n + Object.keys(o.properties as Json).filter((k) => !(o.required as string[]).includes(k)).length, 0);
    expect(optionalCount(schemas.factura)).toBeLessThanOrEqual(8);
    expect(optionalCount(schemas.carta)).toBeLessThanOrEqual(2);
    expect(optionalCount(schemas.recetas)).toBeLessThanOrEqual(3);
    // Sin uniones anyOf (cuentan aparte en los límites)
    expect(JSON.stringify(schemas)).not.toContain('anyOf');
  });

  it('las líneas de factura exigen los campos numéricos clave', () => {
    const line = ((schemas.factura.properties as Json).lines as Json).items as Json;
    expect(line.required).toEqual(expect.arrayContaining(['description', 'quantity', 'unit', 'unitPrice', 'discountPct', 'total', 'suggestedName', 'suggestedCategory', 'confidence']));
    expect(((line.properties as Json).suggestedCategory as Json).enum).toEqual([...CATEGORY_VALUES]);
  });

  it('sanitizeJsonSchema elimina restricciones y cierra objetos', () => {
    const out = sanitizeJsonSchema({
      $schema: 'x',
      type: 'object',
      properties: { n: { type: 'number', minimum: 0, maximum: 1 }, s: { type: 'string', minLength: 2, format: 'email' }, a: { type: 'array', minItems: 3, items: { type: 'object', properties: {} } } },
      required: ['n'],
    });
    expect(out).toEqual({
      type: 'object',
      properties: { n: { type: 'number' }, s: { type: 'string', format: 'email' }, a: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: false } } },
      required: ['n'],
      additionalProperties: false,
    });
  });
});

describe('esquemas tolerantes', () => {
  it('factura: números como texto, enums sueltos y elementos mal formados', () => {
    const r = invoiceParseSchema.parse({
      supplierName: 'Distribuciones García S.L.',
      supplierTaxId: 'B12345674',
      number: 2025001,
      date: '12/03/2025',
      subtotal: '1.234,56',
      vatTotal: '123,46',
      total: 1358.02,
      lines: [
        {
          description: 'TOMATE PERA',
          code: 123,
          quantity: '12,5',
          unit: 'KG',
          unitPrice: '1,80 €',
          discountPct: '',
          total: '22,50',
          vatPct: '4%',
          packSize: { count: '1', size: '6', unit: 'KGS' },
          suggestedName: 'Tomate pera',
          suggestedCategory: 'Verduras',
          confidence: '0,9',
        },
        'basura',
        null,
      ],
      warnings: ['uno', '', 3],
    });
    expect(r.number).toBe('2025001');
    expect(r.subtotal).toBe(1234.56);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ code: '123', quantity: 12.5, unitPrice: 1.8, total: 22.5, vatPct: 4, discountPct: undefined, suggestedCategory: 'verdura', confidence: 0.9 });
    expect(r.lines[0].packSize).toEqual({ count: 1, size: 6, unit: 'kg' });
    expect(r.nonProductLines).toEqual([]);
    expect(r.warnings).toEqual(['uno', '3']);
  });

  it('factura sin array de líneas → falla (se pedirá la corrección)', () => {
    expect(invoiceParseSchema.safeParse({ supplierName: 'x' }).success).toBe(false);
  });

  it('formato de envase: dl y docena se convierten; datos inválidos se descartan', () => {
    const parse = (packSize: unknown) => invoiceParseSchema.parse({ lines: [{ description: 'x', packSize }] }).lines[0].packSize;
    expect(parse({ count: 6, size: 2, unit: 'dl' })).toEqual({ count: 6, size: 20, unit: 'cl' });
    expect(parse({ count: 1, size: 2, unit: 'docena' })).toEqual({ count: 2, size: 1, unit: 'ud' });
    expect(parse({ count: 0, size: 2, unit: 'kg' })).toBeUndefined();
    expect(parse({ count: 1, size: 2, unit: 'caja' })).toBeUndefined();
    expect(parse('6x1L')).toBeUndefined();
  });

  it('carta: precios como texto', () => {
    const r = menuParseSchema.parse({ items: [{ section: 'Entrantes', name: 'Croquetas', description: '', price: '9,50 €', confidence: 1 }] });
    expect(r.items[0].price).toBe(9.5);
    expect(r.warnings).toEqual([]);
  });

  it('recetas: unidades libres, base por defecto y alérgenos con alias', () => {
    const r = recipesParseSchema.parse({
      dishes: [
        {
          ref: 'D1',
          dishName: 'Tortilla',
          ingredients: [
            { name: 'Huevo', quantity: '3', unit: 'uds', basis: 'bruto', category: 'huevos', productRef: 'P2', note: '' },
            { name: 'Aceite', quantity: 30, unit: 'c/s', basis: 'rara', category: 'aceites', productRef: '', note: '' },
          ],
          steps: ['Batir', ''],
          allergens: ['Huevos', 'frutos secos', 'inventado', 'huevo'],
          confidence: 0.8,
        },
      ],
    });
    const [huevo, aceite] = r.dishes[0].ingredients;
    expect(huevo).toMatchObject({ quantity: 3, unit: 'ud', basis: 'bruta', category: 'huevo' });
    expect(aceite).toMatchObject({ unit: 'cucharada', basis: 'neta', category: 'aceite' });
    expect(r.dishes[0].allergens).toEqual(['huevo', 'frutos_cascara']);
    expect(r.dishes[0].steps).toEqual(['Batir']);
  });
});
