import { describe, expect, it } from 'vitest';
import type { Allergen, BaseUnit, IngredientCategory } from '../types';
import { KB_INGREDIENTS, KB_MIN_SCORE, findKbIngredient, kbIngredientIndex, matchKbIngredient, type KbIngredient } from './ingredients';
import { phraseKey } from './text';

const ALLERGENS: Allergen[] = [
  'gluten', 'crustaceos', 'huevo', 'pescado', 'cacahuete', 'soja', 'lacteos', 'frutos_cascara', 'apio', 'mostaza', 'sesamo', 'sulfitos', 'altramuces', 'moluscos',
];
const CATEGORIES: IngredientCategory[] = [
  'carne', 'pescado', 'marisco', 'verdura', 'fruta', 'lacteo', 'huevo', 'cereal', 'legumbre', 'aceite', 'condimento', 'panaderia', 'bebida', 'congelado',
  'conserva', 'charcuteria', 'dulce', 'otros',
];

function byName(name: string): KbIngredient {
  const ing = kbIngredientIndex().byName.get(name);
  if (!ing) throw new Error(`No existe la ficha «${name}»`);
  return ing;
}

describe('KB_INGREDIENTS: integridad', () => {
  it('tiene al menos 320 ingredientes', () => {
    expect(KB_INGREDIENTS.length).toBeGreaterThanOrEqual(320);
  });

  it('no repite nombres (tampoco por tildes, mayúsculas o plurales)', () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const ing of KB_INGREDIENTS) {
      const k = phraseKey(ing.name);
      const prev = seen.get(k);
      if (prev) dups.push(`${prev} ⇄ ${ing.name}`);
      seen.set(k, ing.name);
    }
    expect(dups).toEqual([]);
  });

  it('cada nombre y alias identifica una sola ficha (sin colisiones entre ingredientes)', () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const ing of KB_INGREDIENTS) {
      for (const text of [ing.name, ...ing.aliases]) {
        const k = phraseKey(text);
        expect(k, `${ing.name}: alias vacío «${text}»`).not.toBe('');
        const prev = owner.get(k);
        if (prev && prev !== ing.name) collisions.push(`«${text}»: ${prev} ⇄ ${ing.name}`);
        else owner.set(k, ing.name);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('nombres genéricos en español, en singular salvo plurales de uso y en «sentence case»', () => {
    for (const ing of KB_INGREDIENTS) {
      expect(ing.name, ing.name).toBe(ing.name.trim());
      expect(ing.name[0], ing.name).toBe(ing.name[0].toLocaleUpperCase('es-ES'));
      expect(ing.name, ing.name).not.toMatch(/\s{2,}/);
    }
  });

  it('campos numéricos y enumerados válidos', () => {
    for (const ing of KB_INGREDIENTS) {
      const label = ing.name;
      expect(CATEGORIES, label).toContain(ing.category);
      expect(['kg', 'l', 'ud'] as BaseUnit[], label).toContain(ing.baseUnit);
      expect(ing.wastePct, label).toBeGreaterThanOrEqual(0);
      expect(ing.wastePct, label).toBeLessThan(90);
      expect(ing.cookingLossPct, label).toBeGreaterThanOrEqual(0);
      expect(ing.cookingLossPct, label).toBeLessThan(70);
      expect(ing.refPricePerBase, label).toBeGreaterThan(0);
      expect(new Set(ing.allergens).size, label).toBe(ing.allergens.length);
      for (const a of ing.allergens) expect(ALLERGENS, `${label}: ${a}`).toContain(a);
      if (ing.unitWeightKg != null) expect(ing.unitWeightKg, label).toBeGreaterThan(0);
      if (ing.densityKgPerL != null) {
        expect(ing.densityKgPerL, label).toBeGreaterThan(0.5);
        expect(ing.densityKgPerL, label).toBeLessThan(1.5);
      }
    }
  });

  it('lo que se compra por unidades lleva su peso medio y los líquidos su densidad', () => {
    const missingWeight = KB_INGREDIENTS.filter((i) => i.baseUnit === 'ud' && !i.unitWeightKg).map((i) => i.name);
    const missingDensity = KB_INGREDIENTS.filter((i) => i.baseUnit === 'l' && !i.densityKgPerL).map((i) => i.name);
    expect(missingWeight).toEqual([]);
    expect(missingDensity).toEqual([]);
  });

  it('cubre todas las familias de producto de la hostelería española', () => {
    const count = new Map<IngredientCategory, number>();
    for (const i of KB_INGREDIENTS) count.set(i.category, (count.get(i.category) ?? 0) + 1);
    const min: Partial<Record<IngredientCategory, number>> = {
      carne: 50, pescado: 30, marisco: 25, verdura: 60, fruta: 30, lacteo: 30, cereal: 20, panaderia: 20, condimento: 40, bebida: 40, conserva: 25,
      charcuteria: 20, dulce: 20, congelado: 8, legumbre: 5, aceite: 6, huevo: 3,
    };
    for (const [cat, n] of Object.entries(min)) expect(count.get(cat as IngredientCategory) ?? 0, cat).toBeGreaterThanOrEqual(n);
  });

  it('incluye los productos clave que pide la carta tipo', () => {
    const required: [string, IngredientCategory][] = [
      ['Secreto ibérico', 'carne'], ['Presa ibérica', 'carne'], ['Pluma ibérica', 'carne'], ['Lagarto ibérico', 'carne'], ['Abanico ibérico', 'carne'],
      ['Paletilla de cordero lechal', 'carne'], ['Cochinillo', 'carne'], ['Pechuga de pollo', 'carne'], ['Contramuslo de pollo', 'carne'], ['Alitas de pollo', 'carne'],
      ['Magret de pato', 'carne'], ['Confit de pato', 'carne'], ['Conejo', 'carne'], ['Codorniz', 'carne'], ['Foie gras de pato fresco', 'carne'],
      ['Solomillo de ternera', 'carne'], ['Lomo alto de vaca', 'carne'], ['Chuletón de vaca', 'carne'], ['Carrillera ibérica', 'carne'], ['Rabo de toro', 'carne'],
      ['Merluza entera', 'pescado'], ['Lomo de merluza', 'pescado'], ['Lubina', 'pescado'], ['Dorada', 'pescado'], ['Rape entero', 'pescado'],
      ['Bacalao desalado', 'pescado'], ['Atún rojo lomo', 'pescado'], ['Salmón entero', 'pescado'],
      ['Gamba roja', 'marisco'], ['Langostino cocido', 'marisco'], ['Cigala', 'marisco'], ['Bogavante', 'marisco'], ['Carabinero', 'marisco'],
      ['Pulpo crudo congelado', 'marisco'], ['Pulpo cocido', 'marisco'], ['Calamar', 'marisco'], ['Sepia', 'marisco'], ['Chipirón', 'marisco'],
      ['Mejillón', 'marisco'], ['Almeja japónica', 'marisco'], ['Zamburiña', 'marisco'], ['Vieira', 'marisco'], ['Navaja', 'marisco'], ['Ostra', 'marisco'],
      ['Boletus', 'verdura'], ['Shiitake', 'verdura'], ['Níscalo', 'verdura'], ['Champiñón', 'verdura'], ['Portobello', 'verdura'], ['Setas variadas', 'verdura'],
      ['Alcachofa', 'verdura'], ['Espárrago verde', 'verdura'], ['Pimiento de Padrón', 'verdura'], ['Tomate raf', 'verdura'],
      ['Queso de cabra', 'lacteo'], ['Queso azul', 'lacteo'], ['Queso Idiazábal', 'lacteo'], ['Queso tetilla', 'lacteo'], ['Torta del Casar', 'lacteo'],
      ['Queso feta', 'lacteo'], ['Mascarpone', 'lacteo'], ['Ricotta', 'lacteo'], ['Queso crema', 'lacteo'], ['Burrata', 'lacteo'], ['Parmesano', 'lacteo'],
      ['Pasta fresca al huevo', 'cereal'], ['Placas de lasaña', 'cereal'], ['Masa de pizza', 'panaderia'], ['Masa de hojaldre', 'panaderia'], ['Pasta filo', 'panaderia'],
      ['Tortilla de trigo', 'panaderia'], ['Pan brioche de hamburguesa', 'panaderia'], ['Pan de cristal', 'panaderia'], ['Picos de pan', 'panaderia'],
      ['Mayonesa', 'condimento'], ['Ketchup', 'condimento'], ['Mostaza de Dijon', 'condimento'], ['Salsa de soja', 'condimento'], ['Salsa Perrins', 'condimento'],
      ['Tabasco', 'condimento'], ['Vinagre de Jerez', 'condimento'], ['Vinagre de Módena', 'condimento'], ['Reducción de Módena', 'condimento'], ['Miso', 'condimento'],
      ['Sriracha', 'condimento'], ['Tahini', 'condimento'], ['Azafrán', 'condimento'],
      ['Azúcar glas', 'dulce'], ['Chocolate negro 70 %', 'dulce'], ['Cobertura de chocolate negro', 'dulce'], ['Cacao en polvo', 'dulce'], ['Levadura química', 'dulce'],
      ['Levadura fresca', 'dulce'], ['Gelatina en hojas', 'dulce'], ['Agar-agar', 'dulce'], ['Vaina de vainilla', 'dulce'], ['Praliné de avellana', 'dulce'],
      ['Dulce de leche', 'dulce'], ['Leche condensada', 'dulce'],
      ['Vino tinto crianza', 'bebida'], ['Cava', 'bebida'], ['Cerveza de barril', 'bebida'], ['Tónica', 'bebida'], ['Ginebra', 'bebida'], ['Ron', 'bebida'],
      ['Whisky', 'bebida'], ['Vermut rojo', 'bebida'], ['Agua mineral', 'bebida'], ['Café en grano', 'bebida'], ['Té', 'bebida'],
      ['Patata prefrita congelada', 'congelado'], ['Guisante', 'congelado'], ['Gyozas', 'congelado'],
      ['Aceite de oliva virgen extra', 'aceite'], ['Aceite de girasol', 'aceite'], ['Huevo', 'huevo'], ['Garbanzo', 'legumbre'], ['Lenteja pardina', 'legumbre'],
      ['Jamón ibérico de bellota loncheado', 'charcuteria'], ['Jamón ibérico de bellota pieza', 'charcuteria'], ['Chorizo ibérico', 'charcuteria'],
    ];
    const problems = required.flatMap(([name, cat]) => {
      const ing = kbIngredientIndex().byName.get(name);
      if (!ing) return [`falta «${name}»`];
      return ing.category === cat ? [] : [`«${name}» es ${ing.category}, no ${cat}`];
    });
    expect(problems).toEqual([]);
  });
});

describe('KB_INGREDIENTS: datos culinarios', () => {
  it('mermas de limpieza de referencia (cocina profesional)', () => {
    const expected: Record<string, number> = {
      Alcachofa: 60, 'Espárrago verde': 30, Puerro: 45, Cebolla: 10, Ajo: 12, Patata: 20, Zanahoria: 15, Calabacín: 5, Berenjena: 8, 'Pimiento rojo': 20,
      Tomate: 5, 'Lechuga romana': 25, Champiñón: 5, Piña: 45, Melón: 40, 'Merluza entera': 50, Lubina: 55, Dorada: 55, 'Rape entero': 60,
      'Salmón entero': 38, 'Lomo de merluza': 3, 'Pulpo crudo congelado': 10, Calamar: 25, Sepia: 30, 'Gamba roja': 55, 'Langostino crudo': 50,
      Mejillón: 5, 'Solomillo de ternera': 18, 'Lomo alto de vaca': 15, 'Pollo entero': 30, 'Pechuga de pollo': 5, 'Jamón ibérico de bellota pieza': 48,
      'Jamón ibérico de bellota loncheado': 0, 'Queso manchego curado': 3,
    };
    for (const [name, pct] of Object.entries(expected)) expect(byName(name).wastePct, name).toBe(pct);
    expect(byName('Almeja japónica').wastePct).toBeLessThanOrEqual(5);
  });

  it('mermas de cocción típicas de su uso más habitual', () => {
    const inRange = (name: string, min: number, max: number) => {
      const v = byName(name).cookingLossPct;
      expect(v, name).toBeGreaterThanOrEqual(min);
      expect(v, name).toBeLessThanOrEqual(max);
    };
    inRange('Solomillo de ternera', 20, 28);
    inRange('Entrecot de ternera', 20, 28);
    inRange('Cochinillo', 30, 35);
    inRange('Carrillera de ternera', 35, 45);
    inRange('Rabo de toro', 35, 45);
    inRange('Pulpo crudo congelado', 40, 50);
    inRange('Lomo de merluza', 15, 20);
    inRange('Lomo de salmón', 15, 20);
    inRange('Calabacín', 10, 20);
    inRange('Patata', 45, 45);
    for (const n of ['Arroz bomba', 'Arroz redondo', 'Espaguetis', 'Macarrones', 'Garbanzo', 'Lenteja pardina', 'Alubia blanca']) inRange(n, 0, 0);
  });

  it('pesos por unidad y densidades de referencia', () => {
    expect(byName('Huevo').unitWeightKg).toBeCloseTo(0.06, 3);
    expect(byName('Limón').unitWeightKg).toBeCloseTo(0.12, 3);
    expect(byName('Pan de hamburguesa').unitWeightKg).toBeCloseTo(0.08, 3);
    expect(byName('Barra de pan').unitWeightKg).toBeCloseTo(0.25, 3);
    expect(byName('Aguacate').unitWeightKg).toBeCloseTo(0.2, 3);
    expect(byName('Huevo').baseUnit).toBe('ud');
    expect(byName('Pan de hamburguesa').baseUnit).toBe('ud');
    expect(byName('Barra de pan').baseUnit).toBe('ud');
    expect(byName('Aceite de oliva virgen extra').densityKgPerL).toBeCloseTo(0.916, 3);
    expect(byName('Aceite de girasol').densityKgPerL).toBeCloseTo(0.92, 3);
    expect(byName('Leche entera').densityKgPerL).toBeCloseTo(1.03, 3);
    expect(byName('Nata para montar 35 %').densityKgPerL).toBeCloseTo(1, 2);
    expect(byName('Vino tinto crianza').densityKgPerL).toBeCloseTo(0.99, 3);
    expect(byName('Vinagre de vino').densityKgPerL).toBeCloseTo(1.01, 3);
    expect(byName('Miel').baseUnit).toBe('kg');
  });

  it('precios mayoristas orientativos 2025-2026 (± 15 %)', () => {
    const expected: Record<string, number> = {
      'Aceite de oliva virgen extra': 8.5, Patata: 0.9, Cebolla: 1.1, Tomate: 1.9, 'Solomillo de ternera': 32, 'Pechuga de pollo': 7.5, 'Pulpo crudo congelado': 16,
      'Pulpo cocido': 32, 'Lomo de merluza': 16, 'Bacalao desalado': 17, 'Lomo de salmón': 16, 'Atún rojo lomo': 45, 'Gamba roja': 60, 'Langostino cocido': 18,
      'Jamón ibérico de bellota loncheado': 110, Huevo: 0.22, Azafrán: 3500, 'Harina de trigo': 0.8, 'Arroz bomba': 3.8, 'Nata para montar 35 %': 3.9,
      Mantequilla: 9, 'Queso manchego curado': 17, Parmesano: 22, Burrata: 18, 'Vino tinto crianza': 6, 'Cerveza de barril': 2.2,
    };
    for (const [name, price] of Object.entries(expected)) {
      const p = byName(name).refPricePerBase ?? 0;
      expect(p, name).toBeGreaterThanOrEqual(price * 0.85);
      expect(p, name).toBeLessThanOrEqual(price * 1.15);
    }
  });

  it('alérgenos obligatorios (Reglamento UE 1169/2011)', () => {
    const must: [string, Allergen[]][] = [
      ['Gamba roja', ['crustaceos']], ['Langostino cocido', ['crustaceos', 'sulfitos']], ['Cigala', ['crustaceos']], ['Bogavante', ['crustaceos']],
      ['Carabinero', ['crustaceos']], ['Carne de cangrejo', ['crustaceos']], ['Gamba pelada congelada', ['crustaceos', 'sulfitos']],
      ['Pulpo cocido', ['moluscos']], ['Calamar', ['moluscos']], ['Sepia', ['moluscos']], ['Chipirón', ['moluscos']], ['Mejillón', ['moluscos']],
      ['Almeja japónica', ['moluscos']], ['Berberecho', ['moluscos']], ['Navaja', ['moluscos']], ['Vieira', ['moluscos']], ['Zamburiña', ['moluscos']],
      ['Ostra', ['moluscos']], ['Caracoles', ['moluscos']],
      ['Anchoa en salazón', ['pescado']], ['Atún en aceite', ['pescado']], ['Salsa de pescado', ['pescado']], ['Lomo de merluza', ['pescado']],
      ['Barra de pan', ['gluten']], ['Harina de trigo', ['gluten']], ['Espaguetis', ['gluten']], ['Panko', ['gluten']], ['Pan rallado', ['gluten']],
      ['Cerveza de barril', ['gluten']], ['Salsa de soja', ['soja', 'gluten']], ['Tofu', ['soja']], ['Edamame', ['soja']],
      ['Nata para montar 35 %', ['lacteos']], ['Mantequilla', ['lacteos']], ['Queso manchego curado', ['lacteos']], ['Yogur natural', ['lacteos']],
      ['Leche entera', ['lacteos']], ['Huevo', ['huevo']], ['Mayonesa', ['huevo', 'mostaza']], ['Almendra marcona', ['frutos_cascara']],
      ['Avellana', ['frutos_cascara']], ['Nuez', ['frutos_cascara']], ['Pistacho', ['frutos_cascara']], ['Anacardo', ['frutos_cascara']],
      ['Cacahuete', ['cacahuete']], ['Crema de cacahuete', ['cacahuete']], ['Apio', ['apio']], ['Mostaza de Dijon', ['mostaza']], ['Tahini', ['sesamo']],
      ['Sésamo', ['sesamo']], ['Vino tinto crianza', ['sulfitos']], ['Vino blanco', ['sulfitos']], ['Vinagre de vino', ['sulfitos']],
      ['Vinagre de Jerez', ['sulfitos']], ['Altramuces', ['altramuces']], ['Bebida de almendra', ['frutos_cascara']],
    ];
    for (const [name, list] of must) for (const a of list) expect(byName(name).allergens, `${name} debe declarar ${a}`).toContain(a);
  });

  it('no declara alérgenos que el producto no tiene', () => {
    expect(byName('Piñón').allergens).not.toContain('frutos_cascara');
    for (const n of ['Patata', 'Aceite de oliva virgen extra', 'Tomate', 'Solomillo de ternera', 'Sal', 'Azúcar', 'Arroz bomba', 'Ginebra', 'Whisky', 'Ron']) {
      expect(byName(n).allergens, n).toEqual([]);
    }
    expect(byName('Vinagre de arroz').allergens).not.toContain('sulfitos');
    expect(byName('Harina de maíz').allergens).not.toContain('gluten');
    expect(byName('Harina de arroz').allergens).not.toContain('gluten');
  });
});

describe('findKbIngredient / matchKbIngredient', () => {
  it('nombres y alias exactos (tildes, mayúsculas, plurales y variantes)', () => {
    const cases: [string, string][] = [
      ['Solomillo de ternera', 'Solomillo de ternera'], ['SOLOMILLO', 'Solomillo de ternera'], ['aove', 'Aceite de oliva virgen extra'],
      ['Tomates cherry', 'Tomate cherry'], ['Champiñones', 'Champiñón'], ['Pimientos de Padrón', 'Pimiento de Padrón'], ['Gambas rojas', 'Gamba roja'],
      ['Diente de ajo', 'Ajo'], ['Dientes de ajo', 'Ajo'], ['Hojas de laurel', 'Laurel'], ['Yemas de huevo', 'Huevo'], ['Nata líquida', 'Nata para montar 35 %'],
      ['Caldo de carne', 'Fondo oscuro'], ['Pimiento morrón', 'Pimiento rojo'], ['Sal Maldon', 'Sal en escamas'], ['Nutella', 'Crema de cacao y avellanas'],
      ['Mantequilla de cacahuete', 'Crema de cacahuete'], ['Leche de almendra', 'Bebida de almendra'], ['Aceite de coco', 'Aceite de coco'],
      ['Harina de arroz', 'Harina de arroz'], ['Pasta de curry', 'Pasta de curry'], ['Coñac', 'Brandy'], ['Idiazábal', 'Queso Idiazábal'],
    ];
    for (const [q, name] of cases) expect(findKbIngredient(q)?.name, q).toBe(name);
  });

  it('variantes de Latinoamérica', () => {
    const cases: [string, string][] = [
      ['papa', 'Patata'], ['palta', 'Aguacate'], ['frutilla', 'Fresa'], ['choclo', 'Maíz en mazorca'], ['zapallo', 'Calabaza'], ['arvejas', 'Guisante'],
      ['durazno', 'Melocotón'], ['crema de leche', 'Nata para montar 35 %'], ['maní', 'Cacahuete'], ['ají', 'Guindilla fresca'],
    ];
    for (const [q, name] of cases) expect(findKbIngredient(q)?.name, q).toBe(name);
  });

  it('descripciones de factura con formatos, calibres, marcas y abreviaturas', () => {
    const cases: [string, string][] = [
      ['TOMATE PERA CAT I 5KG', 'Tomate pera'], ['ACEITE OLIVA V.E. 5L', 'Aceite de oliva virgen extra'], ['AOVE GARRAFA 5 L', 'Aceite de oliva virgen extra'],
      ['ACEIT. OLIVA V.E.', 'Aceite de oliva virgen extra'], ['TOM. PERA', 'Tomate pera'], ['POLLO ENTERO CAMPERO', 'Pollo entero'],
      ['PECHUGA POLLO FILETEADA', 'Pechuga de pollo'], ['SOLOMILLO TERNERA NACIONAL', 'Solomillo de ternera'], ['LOMO MERLUZA CONGELADO', 'Lomo de merluza congelado'],
      ['LANGOSTINO COCIDO 40/60', 'Langostino cocido'], ['PATATA AGRIA SACO 25KG', 'Patata'], ['HUEVOS CAMPEROS M 30UD', 'Huevo'],
      ['NATA 35% MG 1L', 'Nata para montar 35 %'], ['MANTEQUILLA SIN SAL 1KG', 'Mantequilla'], ['CERVEZA MAHOU BARRIL 30L', 'Cerveza de barril'],
      ['COCA COLA 33CL', 'Refresco de cola'], ['TONICA SCHWEPPES', 'Tónica'], ['GIN TANQUERAY', 'Ginebra'], ['BOLETUS EDULIS CONGELADO', 'Boletus congelado'],
      ['Salsa de soja Kikkoman 1L', 'Salsa de soja'], ['Hacendado tomate triturado', 'Tomate triturado'], ['Atún claro en aceite de oliva', 'Atún en aceite'],
      ['Chorizo de cerdo ibérico', 'Chorizo ibérico'], ['Pechuga de pollo campero', 'Pechuga de pollo'], ['VINO TINTO RIOJA CRIANZA', 'Vino tinto crianza'],
    ];
    for (const [q, name] of cases) expect(findKbIngredient(q)?.name, q).toBe(name);
  });

  it('no confunde un producto con el sabor o el origen que lo acompaña', () => {
    // El producto real es otro: mejor ninguna ficha que una equivocada (precio y alérgenos erróneos)
    for (const q of ['Aceite de maíz', 'Zumo de manzana', 'Pan de maíz', 'Hamburguesa de pollo']) {
      const hit = findKbIngredient(q);
      expect(hit?.name ?? '', q).not.toMatch(/^(Aceite de oliva|Manzana|Pan rallado|Barra de pan|Pollo entero|Hamburguesa vegetal)/);
    }
    expect(findKbIngredient('Leche de cabra')?.name).toBe('Leche entera');
    expect(findKbIngredient('Harina de espelta')?.allergens).toContain('gluten');
  });

  it('nunca propone una ficha a la que le falte un alérgeno nombrado en el texto', () => {
    const queries: [string, Allergen][] = [
      ['Helado de avellana', 'frutos_cascara'], ['Pan de semillas de sésamo', 'sesamo'], ['Mantequilla de cacahuete', 'cacahuete'],
      ['Ensalada de gambas', 'crustaceos'], ['Salsa de soja', 'soja'], ['Croquetas de gambas', 'crustaceos'], ['Galleta de almendra', 'frutos_cascara'],
    ];
    for (const [q, allergen] of queries) {
      const hit = findKbIngredient(q);
      if (hit) expect(hit.allergens, `${q} → ${hit.name}`).toContain(allergen);
    }
  });

  it('no inventa fichas para lo que no es un ingrediente', () => {
    for (const q of ['Detergente lavavajillas', 'Servilletas papel', 'Bolsa basura', 'Gas butano', 'Transporte', 'Portes', 'XXX desconocido', '', '   ']) {
      expect(findKbIngredient(q), q).toBeUndefined();
    }
  });

  it('informa de la puntuación, el tipo de coincidencia y las contradicciones', () => {
    const exact = matchKbIngredient('Solomillo de ternera');
    expect(exact).toMatchObject({ score: 1, kind: 'exacta' });
    const partial = matchKbIngredient('Harina de espelta');
    expect(partial?.kind).toBe('frase');
    expect(partial?.score).toBeGreaterThanOrEqual(KB_MIN_SCORE);
    expect(partial?.score).toBeLessThan(1);
    const fuzzy = matchKbIngredient('TOM. PERA');
    expect(fuzzy?.ingredient.name).toBe('Tomate pera');
    for (const q of ['Pechuga de pollo campero', 'Harina de espelta', 'TOMATE PERA CAT I 5KG', 'CHAMP. LAM.']) {
      const m = matchKbIngredient(q);
      expect(m, q).toBeDefined();
      expect(m?.score, q).toBeGreaterThanOrEqual(KB_MIN_SCORE);
      expect(m?.score, q).toBeLessThanOrEqual(1);
    }
    // Un producto en el que el ingrediente es sólo el sabor queda por debajo del umbral y se explica por qué
    expect(matchKbIngredient('Crema de pistacho')?.ingredient.name ?? '').not.toBe('Pistacho');
  });

  it('todas las fichas se encuentran por su nombre y por cada alias', () => {
    const wrong: string[] = [];
    for (const ing of KB_INGREDIENTS) {
      for (const text of [ing.name, ...ing.aliases]) {
        const hit = findKbIngredient(text);
        if (hit !== ing) wrong.push(`«${text}» → ${hit?.name ?? '—'} (esperado ${ing.name})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('es rápido: 300 descripciones distintas en menos de 1,5 s (índice en frío incluido) y la caché responde al instante', () => {
    const queries = KB_INGREDIENTS.slice(0, 300).map((i, n) => `${i.name.toUpperCase()} ${['CAJA 5KG', 'BOLSA 1 KG', 'CAT I', 'NACIONAL', 'GARRAFA 5L'][n % 5]}`);
    const t0 = performance.now();
    for (const q of queries) findKbIngredient(q);
    const cold = performance.now() - t0;
    const t1 = performance.now();
    for (const q of queries) findKbIngredient(q);
    const warm = performance.now() - t1;
    expect(cold).toBeLessThan(1500);
    expect(warm).toBeLessThan(50);
  });
});
