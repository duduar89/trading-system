import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ProgressInfo } from '../types';
import type { AISystemBlock, StructuredCall, StructuredResult } from './client';
import { AIError } from './client';
import { aiProposeRecipes, aiProposeRecipesDetailed, buildCatalogBlock, CATALOG_CAP, type CatalogProduct, type RecipeRequestDish, tokens } from './recipes';
import { RECIPES_SYSTEM } from './prompts';

// Se sustituye sólo la llamada a Claude: el resto (lotes, catálogo, validación y mapeo) es el código real.
const h = vi.hoisted(() => ({
  calls: [] as StructuredCall<unknown>[],
  behavior: undefined as undefined | ((call: StructuredCall<unknown>, index: number) => unknown),
}));

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return {
    ...actual,
    callStructuredDetailed: vi.fn(async <T>(call: StructuredCall<T>): Promise<StructuredResult<T>> => {
      const index = h.calls.push(call as StructuredCall<unknown>) - 1;
      const text = (call.content[0] as { text: string }).text;
      const refs = [...text.matchAll(/^(D\d+) · (.+?)(?: · |$)/gm)].map((m) => ({ ref: m[1], name: m[2] }));
      const custom = h.behavior?.(call as StructuredCall<unknown>, index);
      if (custom instanceof Error) throw custom;
      const raw = custom ?? {
        dishes: refs.map((r) => ({
          ref: r.ref,
          dishName: r.name,
          ingredients: [
            { name: 'Aceite de oliva virgen extra', quantity: 15, unit: 'ml', basis: 'neta', category: 'aceite', productRef: 'P1', note: '' },
            { name: 'Ingrediente inventado', quantity: 100, unit: 'g', basis: 'neta', category: 'otros', productRef: 'P999', note: '' },
          ],
          steps: ['Preparar', 'Servir'],
          allergens: [],
          confidence: 0.8,
        })),
      };
      call.onProgress?.({ stage: call.stage ?? '', progress: call.progressRange?.[1] });
      return { data: call.schema.parse(raw), truncated: false, rawText: JSON.stringify(raw), model: 'claude-opus-5', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    }),
  };
});

const settings: AppSettings = { id: 'app', apiKey: 'sk-ant-test', aiModel: 'claude-opus-5', aiEffort: 'medium', aiEnabled: true, theme: 'system', onboardingDone: true };

const catalog: CatalogProduct[] = [
  { id: 'prod-sal', name: 'Sal fina', baseUnit: 'kg', category: 'condimento', pricePerBase: 0.45 },
  { id: 'prod-aove', name: 'Aceite de oliva virgen extra', baseUnit: 'l', category: 'aceite', pricePerBase: 4.85 },
  { id: 'prod-pulpo', name: 'Pulpo cocido', baseUnit: 'kg', category: 'marisco', pricePerBase: 24.9 },
  { id: 'prod-patata', name: 'Patata', baseUnit: 'kg', category: 'verdura' },
  { id: 'prod-huevo', name: 'Huevo campero', baseUnit: 'ud', category: 'huevo', pricePerBase: 0.2167 },
];

const dishes = (n: number): RecipeRequestDish[] =>
  Array.from({ length: n }, (_, i) => ({ key: `dish-${i + 1}`, name: `Plato ${i + 1}`, section: 'Principales', price: 12 + i, description: i === 0 ? 'Con patatas' : undefined }));

beforeEach(() => {
  h.calls = [];
  h.behavior = undefined;
});

describe('buildCatalogBlock', () => {
  it('líneas compactas con referencias cortas, orden estable y precios en formato español', () => {
    const block = buildCatalogBlock(catalog, []);
    const lines = block.text.split('\n').slice(1);
    expect(lines).toEqual([
      'P1|Pulpo cocido|kg|marisco|24,9',
      'P2|Patata|kg|verdura|-',
      'P3|Huevo campero|ud|huevo|0,2167',
      'P4|Aceite de oliva virgen extra|l|aceite|4,85',
      'P5|Sal fina|kg|condimento|0,45',
    ]);
    expect(block.refs.get('P1')).toBe('prod-pulpo');
    expect(block.omitted).toBe(0);
    // Mismo texto con el catálogo en otro orden → la caché de prompts se reutiliza entre lotes.
    expect(buildCatalogBlock([...catalog].reverse(), dishes(3)).text).toBe(block.text);
  });

  it('catálogo vacío → instrucción de dejar productRef vacío', () => {
    const block = buildCatalogBlock([], []);
    expect(block.text).toMatch(/aún no tiene productos/);
    expect(block.refs.size).toBe(0);
  });

  it('si supera el límite prioriza productos relacionados con los platos y básicos', () => {
    const big: CatalogProduct[] = [
      ...catalog,
      { id: 'x1', name: 'Detergente lavavajillas', baseUnit: 'l', category: 'otros' },
      { id: 'x2', name: 'Servilletas', baseUnit: 'ud', category: 'otros' },
      { id: 'x3', name: 'Chocolate negro', baseUnit: 'kg', category: 'dulce' },
    ];
    const block = buildCatalogBlock(big, [{ key: 'a', name: 'Pulpo a la gallega', description: 'Con patatas cachelo' }], 4);
    expect(block.omitted).toBe(4);
    expect([...block.ids].sort()).toEqual(['prod-aove', 'prod-patata', 'prod-pulpo', 'prod-sal']);
  });

  it('tokens: sin tildes, stopwords ni plurales', () => {
    expect(tokens('Croquetas caseras de jamón ibérico')).toEqual(['croqueta', 'jamon', 'iberico']);
  });
});

describe('aiProposeRecipes', () => {
  it('procesa en lotes de 6, secuenciales, con progreso creciente hasta 1', async () => {
    const events: ProgressInfo[] = [];
    const out = await aiProposeRecipes(dishes(14), catalog, settings, (p) => events.push(p));
    expect(h.calls.map((c) => (c.content[0] as { text: string }).text.match(/^D\d+ · /gm)?.length)).toEqual([6, 6, 2]);
    expect(out.size).toBe(14);
    const progress = events.map((e) => e.progress ?? 0);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    expect(progress[progress.length - 1]).toBe(1);
    expect(h.calls[1].stage).toBe('Claude está escandallando los platos 7–12 de 14…');
    expect(h.calls[1].progressRange?.[0]).toBeCloseTo(6 / 14);
    expect(h.calls[0].maxTokens).toBe(32000);
  });

  it('catálogo en un bloque de sistema cacheado tras las instrucciones estables', async () => {
    await aiProposeRecipes(dishes(8), catalog, settings);
    const [a, b] = h.calls.map((c) => c.system as AISystemBlock[]);
    expect(a[0]).toEqual({ text: RECIPES_SYSTEM });
    expect(a[1].cache).toBe(true);
    expect(a[1].text).toContain('P4|Aceite de oliva virgen extra|l|aceite|4,85');
    expect(b[1].text).toBe(a[1].text);
  });

  it('mensaje con PVP, sección, descripción y referencias de plato', async () => {
    await aiProposeRecipes(dishes(2), catalog, settings);
    const text = (h.calls[0].content[0] as { text: string }).text;
    expect(text).toMatch(/^D1 · Plato 1 · Sección: Principales · PVP 12,00\s€ \(IVA incluido\) · Descripción: Con patatas$/m);
    expect(text).toContain('Devuelve exactamente 2 platos, cada uno con su referencia (D1, D2).');
  });

  it('traduce la referencia del catálogo al id real y descarta las inventadas', async () => {
    const out = await aiProposeRecipes(dishes(1), catalog, settings);
    const p = out.get('dish-1');
    expect(p?.source).toBe('ia');
    // P1 en el catálogo ordenado es «Pulpo cocido»: el id devuelto es el real, nunca la referencia corta.
    expect(p?.ingredients[0]).toMatchObject({ name: 'Aceite de oliva virgen extra', productId: 'prod-pulpo' });
    expect(p?.ingredients[1]).not.toHaveProperty('productId');
  });

  it('un lote con formato inválido se salta y se informa; el resto sigue', async () => {
    h.behavior = (_c, i) => (i === 1 ? new AIError('invalid', 'formato inesperado') : undefined);
    const r = await aiProposeRecipesDetailed(dishes(13), catalog, settings);
    expect(r.proposals.size).toBe(7);
    expect(r.failed).toEqual(['dish-7', 'dish-8', 'dish-9', 'dish-10', 'dish-11', 'dish-12']);
    expect(r.warnings[0]).toMatch(/^No se han podido proponer con IA: Plato 7, Plato 8.*\(formato inesperado\)$/);
  });

  it('error de clave en el primer lote → se lanza (el llamador usa la base local)', async () => {
    h.behavior = () => new AIError('auth', 'La clave de API no es válida o ha sido revocada. Revísala en Ajustes.');
    await expect(aiProposeRecipes(dishes(8), catalog, settings)).rejects.toMatchObject({ kind: 'auth' });
    expect(h.calls).toHaveLength(1);
  });

  it('límite de uso a mitad → devuelve lo conseguido, se detiene y avisa', async () => {
    h.behavior = (_c, i) => (i === 1 ? new AIError('rate', 'Has alcanzado el límite de uso.') : undefined);
    const r = await aiProposeRecipesDetailed(dishes(18), catalog, settings);
    expect(h.calls).toHaveLength(2);
    expect(r.proposals.size).toBe(6);
    expect(r.failed).toHaveLength(12);
    expect(r.warnings[0]).toMatch(/Se han propuesto 6 de 18 platos con IA/);
  });

  it('lote demasiado grande → se divide en dos', async () => {
    h.behavior = (c, i) => (i === 0 && (c.content[0] as { text: string }).text.includes('D6 ·') ? new AIError('too_large', 'grande') : undefined);
    const out = await aiProposeRecipes(dishes(6), catalog, settings);
    expect(h.calls.map((c) => (c.content[0] as { text: string }).text.match(/^D\d+ · /gm)?.length)).toEqual([6, 3, 3]);
    expect(out.size).toBe(6);
  });

  it('cancelación → AbortError sin seguir con más lotes', async () => {
    h.behavior = () => new DOMException('Operación cancelada', 'AbortError');
    await expect(aiProposeRecipes(dishes(12), catalog, settings)).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.calls).toHaveLength(1);
  });

  it('avisa si el catálogo supera el límite', async () => {
    const big = Array.from({ length: CATALOG_CAP + 20 }, (_, i): CatalogProduct => ({ id: `p${i}`, name: `Producto ${i}`, baseUnit: 'kg', category: 'otros' }));
    const r = await aiProposeRecipesDetailed(dishes(1), big, settings);
    expect(r.warnings[0]).toMatch(/más de 1500 productos/);
    expect((h.calls[0].system as AISystemBlock[])[1].text.split('\n')).toHaveLength(CATALOG_CAP + 1);
  });

  it('sin platos válidos no llama; claves duplicadas se ignoran', async () => {
    expect((await aiProposeRecipes([], catalog, settings)).size).toBe(0);
    expect((await aiProposeRecipes([{ key: 'a', name: '  ' }], catalog, settings)).size).toBe(0);
    expect(h.calls).toHaveLength(0);
    await aiProposeRecipes([{ key: 'a', name: 'Uno' }, { key: 'a', name: 'Uno bis' }], catalog, settings);
    expect((h.calls[0].content[0] as { text: string }).text.match(/^D\d+ · /gm)).toHaveLength(1);
  });
});
