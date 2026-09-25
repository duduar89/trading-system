import { describe, expect, it } from 'vitest';
import type { Allergen, QtyBasis, QtyUnit } from '../types';
import { QTY_UNITS, convertToBase, baseToKg } from '../core/units';
import { findKbIngredient, kbIngredientIndex, type KbIngredient } from './ingredients';
import { KB_RECIPES, type KbRecipe } from './recipes';
import { KB_TEMPLATE_THRESHOLD, findKbRecipe } from './propose';
import { phraseKey } from './text';

const SECTIONS = [
  'Tapas', 'Raciones', 'Entrantes', 'Ensaladas', 'Sopas y cremas', 'Arroces', 'Pastas', 'Carnes', 'Pescados', 'Mariscos', 'Huevos', 'Bocadillos y hamburguesas',
  'Pizzas', 'Postres', 'Bebidas', 'Cócteles', 'Cafés',
];

function kb(name: string): KbIngredient {
  const ing = kbIngredientIndex().byName.get(name);
  if (!ing) throw new Error(`Ingrediente sin ficha: ${name}`);
  return ing;
}

function recipe(name: string): KbRecipe {
  const r = KB_RECIPES.find((x) => x.name === name);
  if (!r) throw new Error(`No existe la receta «${name}»`);
  return r;
}

/** Cantidad de una línea en la unidad base de su ingrediente. */
function baseQty(name: string, quantity: number, unit: QtyUnit): number {
  const ing = kb(name);
  const r = convertToBase(quantity, unit, ing.baseUnit, ing);
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.value;
}

/** Peso (kg) por ración de una línea de receta. */
function kgPerPortion(r: KbRecipe, name: string): number {
  const it = r.items.find((i) => i.name === name);
  if (!it) throw new Error(`${r.name} no lleva ${name}`);
  const ing = kb(name);
  return (baseToKg(baseQty(name, it.quantity, it.unit), ing.baseUnit, ing) ?? 0) / r.portions;
}

function allergensOf(r: KbRecipe): Allergen[] {
  return [...new Set(r.items.flatMap((it) => kb(it.name).allergens))].sort();
}

describe('KB_RECIPES: integridad', () => {
  it('tiene al menos 170 recetas tipo', () => {
    expect(KB_RECIPES.length).toBeGreaterThanOrEqual(170);
  });

  it('no repite recetas y sus nombres y alias no se pisan entre sí', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const r of KB_RECIPES) {
      for (const text of [r.name, ...(r.aliases ?? [])]) {
        const k = phraseKey(text).split(' ').sort().join(' ');
        const prev = owner.get(k);
        if (prev && prev !== r.name) clashes.push(`«${text}»: ${prev} ⇄ ${r.name}`);
        else owner.set(k, r.name);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('cada ingrediente de cada receta existe en KB_INGREDIENTS con ese nombre exacto y findKbIngredient lo resuelve', () => {
    const unresolved: string[] = [];
    for (const r of KB_RECIPES) {
      for (const it of r.items) {
        if (!kbIngredientIndex().byName.has(it.name)) unresolved.push(`${r.name}: ${it.name}`);
        else if (findKbIngredient(it.name)?.name !== it.name) unresolved.push(`${r.name}: ${it.name} → ${findKbIngredient(it.name)?.name}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('cantidades, unidades, bases, raciones y secciones válidas', () => {
    const bases: QtyBasis[] = ['bruta', 'neta', 'cocinada'];
    for (const r of KB_RECIPES) {
      expect(SECTIONS, r.name).toContain(r.section);
      expect(Number.isInteger(r.portions) && r.portions >= 1, `${r.name}: raciones ${r.portions}`).toBe(true);
      expect(r.items.length, r.name).toBeGreaterThan(0);
      // Un mismo producto sólo se repite si una de las líneas es la guarnición intercambiable (p. ej. aceite de fritura del principal y de las patatas)
      const core = r.items.filter((i) => !i.garnish).map((i) => i.name);
      expect(new Set(core).size, `${r.name}: ingrediente repetido`).toBe(core.length);
      for (const it of r.items) {
        const label = `${r.name}: ${it.name}`;
        expect(Number.isFinite(it.quantity) && it.quantity > 0, label).toBe(true);
        expect(QTY_UNITS, label).toContain(it.unit);
        expect(bases, label).toContain(it.basis);
        if (it.wastePct != null) expect(it.wastePct >= 0 && it.wastePct < 90, label).toBe(true);
        if (it.cookingLossPct != null) expect(it.cookingLossPct >= 0 && it.cookingLossPct < 70, label).toBe(true);
      }
    }
  });

  it('todas las líneas se pueden convertir a la unidad de compra sin suponer densidades ni pesos', () => {
    const problems: string[] = [];
    for (const r of KB_RECIPES) {
      for (const it of r.items) {
        const ing = kb(it.name);
        const res = convertToBase(it.quantity, it.unit, ing.baseUnit, ing);
        if (!res.ok || res.assumption) problems.push(`${r.name}: ${it.quantity} ${it.unit} de ${it.name} (${ing.baseUnit}) — ${res.error ?? res.assumption}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('cada receta explica su elaboración en 1–4 pasos numerados', () => {
    for (const r of KB_RECIPES) {
      expect(r.procedure, r.name).toBeTruthy();
      const steps = (r.procedure ?? '').split('\n');
      expect(steps.length, r.name).toBeGreaterThanOrEqual(1);
      expect(steps.length, r.name).toBeLessThanOrEqual(4);
      steps.forEach((s, i) => expect(s, r.name).toMatch(new RegExp(`^${i + 1}\\. \\S`)));
    }
    const multi = KB_RECIPES.filter((r) => (r.procedure ?? '').split('\n').length >= 2).length;
    expect(multi / KB_RECIPES.length).toBeGreaterThan(0.75);
  });

  it('gramajes por ración realistas (entre 5 g y 1,5 kg de producto por ración, bebidas aparte)', () => {
    const problems: string[] = [];
    for (const r of KB_RECIPES) {
      if (['Bebidas', 'Cócteles', 'Cafés'].includes(r.section)) continue;
      let kg = 0;
      for (const it of r.items) {
        const ing = kb(it.name);
        if (ing.name === 'Hielo' || ing.name === 'Sal gruesa') continue;
        kg += baseToKg(baseQty(it.name, it.quantity, it.unit), ing.baseUnit, ing) ?? 0;
      }
      const perPortion = kg / r.portions;
      if (perPortion < 0.005 || perPortion > 1.5) problems.push(`${r.name}: ${(perPortion * 1000).toFixed(0)} g por ración`);
    }
    expect(problems).toEqual([]);
  });
});

describe('KB_RECIPES: recetas imprescindibles de la carta española', () => {
  const required: [string, string][] = [
    ['Patatas bravas', 'Patatas bravas'], ['Croquetas de jamón', 'Croquetas de jamón'], ['Tortilla de patatas', 'Tortilla de patatas'],
    ['Pulpo a la gallega', 'Pulpo a la gallega'], ['Gambas al ajillo', 'Gambas al ajillo'], ['Calamares a la romana', 'Calamares a la romana'],
    ['Chipirones a la andaluza', 'Chipirones a la andaluza'], ['Pimientos de Padrón', 'Pimientos de Padrón'], ['Ensaladilla rusa', 'Ensaladilla rusa'],
    ['Salmorejo', 'Salmorejo'], ['Gazpacho', 'Gazpacho'], ['Ajoblanco', 'Ajoblanco'], ['Jamón ibérico de bellota', 'Jamón ibérico de bellota'],
    ['Tabla de quesos', 'Tabla de quesos'], ['Boquerones en vinagre', 'Boquerones en vinagre'], ['Huevos rotos con jamón', 'Huevos rotos con jamón'],
    ['Zamburiñas a la plancha', 'Zamburiñas a la plancha'], ['Mejillones al vapor', 'Mejillones al vapor'], ['Mejillones tigre', 'Mejillones tigre'],
    ['Alcachofas confitadas', 'Alcachofas confitadas'], ['Burrata con tomate', 'Burrata con tomate'], ['Ensalada césar', 'Ensalada césar'],
    ['Ensalada mixta', 'Ensalada mixta'], ['Carpaccio de ternera', 'Carpaccio de ternera'], ['Tartar de atún', 'Tartar de atún'], ['Tataki de atún', 'Tataki de atún'],
    ['Ceviche de corvina', 'Ceviche de corvina'], ['Steak tartar', 'Steak tartar'], ['Hummus', 'Hummus'], ['Provoleta', 'Provoleta'],
    ['Nachos con guacamole', 'Nachos con guacamole'], ['Alitas de pollo', 'Alitas de pollo'], ['Pan con tomate', 'Pan con tomate'], ['Gyozas', 'Gyozas'],
    ['Bao de panceta', 'Bao de panceta'], ['Hamburguesa de buey', 'Hamburguesa de buey'], ['Pizza margarita', 'Pizza margarita'],
    ['Spaghetti carbonara', 'Espaguetis a la carbonara'], ['Lasaña boloñesa', 'Lasaña boloñesa'], ['Risotto de setas', 'Risotto de setas'],
    ['Paella valenciana', 'Paella valenciana'], ['Paella de marisco', 'Paella de marisco'], ['Arroz negro', 'Arroz negro'], ['Arroz con bogavante', 'Arroz con bogavante'],
    ['Arroz del señoret', 'Arroz del señoret'], ['Fideuá', 'Fideuá'], ['Cochinillo asado', 'Cochinillo asado'], ['Cordero lechal asado', 'Cordero lechal asado'],
    ['Chuletón de vaca', 'Chuletón de vaca'], ['Solomillo de ternera a la pimienta', 'Solomillo de ternera a la pimienta'], ['Entrecot', 'Entrecot'],
    ['Secreto ibérico', 'Secreto ibérico'], ['Presa ibérica', 'Presa ibérica'], ['Carrilleras al vino tinto', 'Carrilleras al vino tinto'], ['Rabo de toro', 'Rabo de toro'],
    ['Cachopo', 'Cachopo'], ['Callos a la madrileña', 'Callos a la madrileña'], ['Cocido madrileño', 'Cocido madrileño'], ['Fabada asturiana', 'Fabada asturiana'],
    ['Lentejas', 'Lentejas con chorizo'], ['Pollo al ajillo', 'Pollo al ajillo'], ['Codillo asado', 'Codillo asado'], ['Magret de pato', 'Magret de pato'],
    ['Lubina a la espalda', 'Lubina a la espalda'], ['Dorada a la sal', 'Dorada a la sal'], ['Merluza a la romana', 'Merluza a la romana'],
    ['Merluza en salsa verde', 'Merluza en salsa verde'], ['Bacalao al pil pil', 'Bacalao al pil pil'], ['Bacalao a la vizcaína', 'Bacalao a la vizcaína'],
    ['Rape a la marinera', 'Rape a la marinera'], ['Salmón a la plancha', 'Salmón a la plancha'], ['Atún rojo a la plancha', 'Atún rojo a la plancha'],
    ['Pulpo a la brasa', 'Pulpo a la brasa'], ['Sepia a la plancha', 'Sepia a la plancha'], ['Tarta de queso al horno', 'Tarta de queso al horno'],
    ['Torrija', 'Torrija'], ['Flan de huevo', 'Flan de huevo'], ['Crema catalana', 'Crema catalana'], ['Arroz con leche', 'Arroz con leche'],
    ['Coulant de chocolate', 'Coulant de chocolate'], ['Tiramisú', 'Tiramisú'], ['Brownie con helado', 'Brownie con helado'], ['Natillas', 'Natillas'],
    ['Tarta de Santiago', 'Tarta de Santiago'], ['Sorbete de limón', 'Sorbete de limón al cava'], ['Macedonia', 'Macedonia de frutas'],
    ['Caña de cerveza', 'Caña de cerveza'], ['Copa de vino tinto', 'Copa de vino tinto'], ['Gin tonic', 'Gin tonic'], ['Vermut', 'Vermut'], ['Café solo', 'Café solo'],
    ['Café con leche', 'Café con leche'], ['Tinto de verano', 'Tinto de verano'], ['Sangría', 'Sangría'],
  ];

  it.each(required)('«%s» tiene receta tipo (%s)', (query, expected) => {
    const m = findKbRecipe(query);
    expect(m?.recipe.name).toBe(expected);
    expect(m?.score ?? 0).toBeGreaterThanOrEqual(KB_TEMPLATE_THRESHOLD);
  });

  it('recetas por lotes con sus raciones naturales', () => {
    expect(recipe('Tortilla de patatas').portions).toBe(6);
    expect(recipe('Paella valenciana').portions).toBe(4);
    expect(recipe('Paella de marisco').portions).toBe(4);
    expect(recipe('Tarta de queso al horno').portions).toBe(12);
    expect(recipe('Croquetas de jamón').portions).toBeGreaterThanOrEqual(6);
    expect(recipe('Croquetas de jamón').portions).toBeLessThanOrEqual(7);
    expect(recipe('Chuletón de vaca').portions).toBe(2);
  });

  it('gramajes profesionales de referencia', () => {
    const jamon = recipe('Jamón ibérico de bellota');
    expect(kgPerPortion(jamon, 'Jamón ibérico de bellota loncheado')).toBeCloseTo(0.08, 3);
    expect(kgPerPortion(recipe('Chuletón de vaca'), 'Chuletón de vaca')).toBeCloseTo(0.5, 2);
    expect(kgPerPortion(recipe('Paella valenciana'), 'Arroz bomba')).toBeCloseTo(0.09, 3);
    const caña = recipe('Caña de cerveza').items.find((i) => i.name === 'Cerveza de barril');
    expect(caña && baseQty(caña.name, caña.quantity, caña.unit)).toBeCloseTo(0.2, 3);
    const copa = recipe('Copa de vino tinto').items[0];
    expect(baseQty(copa.name, copa.quantity, copa.unit)).toBeCloseTo(0.15, 3);
    const gt = recipe('Gin tonic');
    const gin = gt.items.find((i) => i.name === 'Ginebra');
    const tonic = gt.items.find((i) => i.name === 'Tónica');
    expect(gin && baseQty(gin.name, gin.quantity, gin.unit)).toBeCloseTo(0.05, 3);
    expect(tonic && baseQty(tonic.name, tonic.quantity, tonic.unit)).toBeCloseTo(0.2, 3);
    expect(gt.items.some((i) => i.name === 'Lima')).toBe(true);
    const solomillo = kgPerPortion(recipe('Solomillo de ternera a la pimienta'), 'Solomillo de ternera');
    expect(solomillo).toBeGreaterThanOrEqual(0.16);
    expect(solomillo).toBeLessThanOrEqual(0.25);
    const merluza = kgPerPortion(recipe('Merluza en salsa verde'), 'Lomo de merluza');
    expect(merluza).toBeGreaterThanOrEqual(0.15);
    expect(merluza).toBeLessThanOrEqual(0.22);
  });

  it('incluye los básicos pequeños (aceite, sal…) en los platos salados', () => {
    const salty = KB_RECIPES.filter((r) => !['Postres', 'Bebidas', 'Cócteles', 'Cafés'].includes(r.section));
    const withBasics = salty.filter((r) => r.items.some((i) => /^(Aceite|Sal|Mantequilla|Manteca)/.test(i.name) || kb(i.name).category === 'condimento'));
    expect(withBasics.length / salty.length).toBeGreaterThan(0.9);
  });

  it('alérgenos coherentes con los ingredientes', () => {
    const expectations: [string, Allergen[]][] = [
      ['Gambas al ajillo', ['crustaceos']], ['Croquetas de jamón', ['gluten', 'lacteos', 'huevo']], ['Tarta de Santiago', ['frutos_cascara', 'huevo']],
      ['Pulpo a la gallega', ['moluscos']], ['Mejillones al vapor', ['moluscos']], ['Paella de marisco', ['crustaceos', 'moluscos']],
      ['Pizza margarita', ['gluten', 'lacteos']], ['Hamburguesa de buey', ['gluten']], ['Copa de vino tinto', ['sulfitos']], ['Caña de cerveza', ['gluten']],
      ['Hummus', ['sesamo']], ['Tataki de atún', ['pescado', 'sesamo', 'soja']], ['Ensaladilla rusa', ['huevo', 'pescado']],
    ];
    for (const [name, list] of expectations) for (const a of list) expect(allergensOf(recipe(name)), `${name}: ${a}`).toContain(a);
    expect(allergensOf(recipe('Pimientos de Padrón'))).toEqual([]);
    expect(allergensOf(recipe('Secreto ibérico'))).toEqual([]);
  });
});
