import { describe, expect, it } from 'vitest';
import type { DishProposal, ProposedIngredient, QtyBasis } from '../types';
import { QTY_UNITS } from '../core/units';
import { kbIngredientIndex } from './ingredients';
import { KB_TEMPLATE_THRESHOLD, findKbRecipe, proposeDishLocal } from './propose';

function item(p: DishProposal, name: string): ProposedIngredient | undefined {
  return p.ingredients.find((i) => i.name === name);
}

function names(p: DishProposal): string[] {
  return p.ingredients.map((i) => i.name);
}

/** Gramos (o ml) por ración de una línea expresada en g/ml/kg/l. */
function perPortion(p: DishProposal, name: string): number {
  const it = item(p, name);
  if (!it) throw new Error(`${p.dishName} no lleva ${name}: ${names(p).join(', ')}`);
  const factor = it.unit === 'kg' || it.unit === 'l' ? 1000 : it.unit === 'cl' ? 10 : it.unit === 'dl' ? 100 : 1;
  return (it.quantity * factor) / p.portions;
}

function expectWellFormed(p: DishProposal): void {
  const bases: QtyBasis[] = ['bruta', 'neta', 'cocinada'];
  expect(p.ingredients.length, p.dishName).toBeGreaterThan(0);
  expect(p.portions, p.dishName).toBeGreaterThanOrEqual(1);
  expect(p.confidence, p.dishName).toBeGreaterThanOrEqual(0);
  expect(p.confidence, p.dishName).toBeLessThanOrEqual(1);
  expect(['plantilla', 'heuristica'], p.dishName).toContain(p.source);
  for (const it of p.ingredients) {
    const label = `${p.dishName}: ${it.name}`;
    expect(kbIngredientIndex().byName.has(it.name), `${label} no está en la base de ingredientes`).toBe(true);
    expect(Number.isFinite(it.quantity) && it.quantity > 0, label).toBe(true);
    expect(QTY_UNITS, label).toContain(it.unit);
    expect(bases, label).toContain(it.basis);
    expect(it.category, label).toBeDefined();
  }
  expect(new Set(names(p)).size, `${p.dishName}: ingredientes repetidos`).toBe(p.ingredients.length);
  // Alérgenos: exactamente la unión de los de sus ingredientes, ordenados
  const expected = [...new Set(p.ingredients.flatMap((i) => kbIngredientIndex().byName.get(i.name)?.allergens ?? []))].sort();
  expect(p.allergens, p.dishName).toEqual(expected);
}

describe('findKbRecipe', () => {
  it('reconoce variantes y denominaciones regionales', () => {
    const cases: [string, string][] = [
      ['Pulpo a feira', 'Pulpo a la gallega'],
      ['Polbo á feira', 'Pulpo a la gallega'],
      ['Bravas', 'Patatas bravas'],
      ['Croquetas caseras de jamón ibérico', 'Croquetas de jamón'],
      ['Tortilla española', 'Tortilla de patatas'],
      ['Chopitos', 'Chipirones a la andaluza'],
      ['Rabas', 'Calamares a la romana'],
      ['Spaghetti carbonara', 'Espaguetis a la carbonara'],
      ['Arroz negre', 'Arroz negro'],
      ['Tarta de la abuela', 'Tarta de galletas y chocolate'],
      ['Caipirinha', 'Caipiriña'],
    ];
    for (const [q, expected] of cases) {
      const m = findKbRecipe(q);
      expect(m?.recipe.name, q).toBe(expected);
      expect(m?.score ?? 0, q).toBeGreaterThanOrEqual(KB_TEMPLATE_THRESHOLD);
    }
  });

  it('usa la descripción y tolera erratas de OCR', () => {
    expect(findKbRecipe('Pulpo', 'a la gallega con cachelos y pimentón de la Vera')?.recipe.name).toBe('Pulpo a la gallega');
    expect(findKbRecipe('Pulpo a la gallga')?.recipe.name).toBe('Pulpo a la gallega');
    expect(findKbRecipe('Croqetas de jamon')?.recipe.name).toBe('Croquetas de jamón');
  });

  it('no fuerza parecidos: sin receta razonable no devuelve nada o puntúa por debajo del umbral', () => {
    expect(findKbRecipe('')).toBeUndefined();
    expect(findKbRecipe('Especialidad de la casa')).toBeUndefined();
    const m = findKbRecipe('Merluza a la plancha con verduras de temporada y salsa de azafrán');
    if (m && m.recipe.name !== 'Merluza a la plancha') expect(m.score).toBeLessThan(KB_TEMPLATE_THRESHOLD);
    const tacos = findKbRecipe('Pizza de burrata y mortadela');
    if (tacos) expect(tacos.score).toBeLessThan(KB_TEMPLATE_THRESHOLD);
  });

  it('puntuación entre 0 y 1', () => {
    for (const q of ['Paella', 'Lubina a la brasa con verduras', 'Hamburguesa', 'Café', 'Vino']) {
      const m = findKbRecipe(q);
      if (m) {
        expect(m.score).toBeGreaterThan(0);
        expect(m.score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('proposeDishLocal: recetas tipo ajustadas a la carta', () => {
  it('Pulpo a la gallega con cachelos', () => {
    const p = proposeDishLocal('Pulpo a la gallega con cachelos');
    expectWellFormed(p);
    expect(p).toMatchObject({ source: 'plantilla', templateName: 'Pulpo a la gallega', portions: 1 });
    expect(p.confidence).toBeGreaterThanOrEqual(0.9);
    expect(item(p, 'Pulpo crudo congelado')?.basis).toBe('bruta');
    expect(perPortion(p, 'Pulpo crudo congelado')).toBeGreaterThanOrEqual(300);
    expect(names(p)).toEqual(expect.arrayContaining(['Patata', 'Pimentón dulce', 'Aceite de oliva virgen extra']));
    expect(item(p, 'Patata')?.cookingLossPct).toBe(0);
    expect(p.allergens).toEqual(['moluscos']);
    expect(p.procedure).toMatch(/^1\. /);
  });

  it('Tataki de atún rojo con ajoblanco: la receta tipo más la elaboración mencionada', () => {
    const p = proposeDishLocal('Tataki de atún rojo con ajoblanco');
    expectWellFormed(p);
    expect(p.templateName).toBe('Tataki de atún');
    expect(perPortion(p, 'Atún rojo lomo')).toBeGreaterThanOrEqual(120);
    expect(names(p)).toEqual(expect.arrayContaining(['Sésamo', 'Salsa de soja', 'Almendra marcona', 'Ajo']));
    expect(p.allergens).toEqual(expect.arrayContaining(['pescado', 'sesamo', 'soja', 'frutos_cascara']));
  });

  it('Hamburguesa de buey con cheddar y bacon', () => {
    const p = proposeDishLocal('Hamburguesa de buey con cheddar y bacon');
    expectWellFormed(p);
    expect(p.templateName).toBe('Hamburguesa de buey');
    expect(perPortion(p, 'Carne de buey picada')).toBeGreaterThanOrEqual(150);
    expect(item(p, 'Pan brioche de hamburguesa')).toMatchObject({ quantity: 1, unit: 'ud' });
    expect(names(p)).toEqual(expect.arrayContaining(['Queso cheddar', 'Bacon']));
  });

  it('Risotto de boletus', () => {
    const p = proposeDishLocal('Risotto de boletus');
    expectWellFormed(p);
    expect(p.templateName).toBe('Risotto de boletus');
    expect(perPortion(p, 'Arroz carnaroli')).toBeGreaterThanOrEqual(70);
    expect(perPortion(p, 'Arroz carnaroli')).toBeLessThanOrEqual(110);
    expect(names(p).some((n) => n.startsWith('Boletus'))).toBe(true);
    expect(names(p)).toEqual(expect.arrayContaining(['Parmesano', 'Mantequilla']));
  });

  it('Tarta de queso al horno: receta por lotes (12 raciones)', () => {
    const p = proposeDishLocal('Tarta de queso al horno');
    expectWellFormed(p);
    expect(p).toMatchObject({ templateName: 'Tarta de queso al horno', portions: 12 });
    expect(names(p)).toEqual(expect.arrayContaining(['Queso crema', 'Huevo', 'Azúcar', 'Nata para montar 35 %']));
    expect(p.allergens).toEqual(expect.arrayContaining(['lacteos', 'huevo']));
  });

  it('Solomillo de ternera con salsa de Oporto y patatas panaderas', () => {
    const p = proposeDishLocal('Solomillo de ternera con salsa de Oporto y patatas panaderas');
    expectWellFormed(p);
    expect(p.source).toBe('plantilla');
    expect(perPortion(p, 'Solomillo de ternera')).toBeGreaterThanOrEqual(160);
    expect(names(p)).toEqual(expect.arrayContaining(['Vino de Oporto', 'Patata', 'Cebolla']));
    // Las panaderas sustituyen a la guarnición de brasa de la receta tipo
    expect(names(p)).not.toContain('Pimiento de Padrón');
    expect(item(p, 'Patata')?.cookingLossPct).toBe(30);
  });

  it('Ensalada de burrata con tomate raf y pesto: variantes de la carta', () => {
    const p = proposeDishLocal('Ensalada de burrata con tomate raf y pesto');
    expectWellFormed(p);
    expect(p.templateName).toBe('Burrata con tomate');
    expect(names(p)).toEqual(expect.arrayContaining(['Burrata', 'Tomate raf', 'Pesto']));
    expect(names(p)).not.toContain('Tomate');
  });

  it('Bacalao confitado sobre pisto manchego', () => {
    const p = proposeDishLocal('Bacalao confitado sobre pisto manchego');
    expectWellFormed(p);
    expect(p.source).toBe('plantilla');
    expect(perPortion(p, 'Bacalao desalado')).toBeGreaterThanOrEqual(150);
    expect(names(p)).toEqual(expect.arrayContaining(['Calabacín', 'Pimiento rojo', 'Cebolla']));
  });

  it('Croquetas caseras de jamón ibérico: sustituye la variante del producto', () => {
    const p = proposeDishLocal('Croquetas caseras de jamón ibérico');
    expectWellFormed(p);
    expect(p.templateName).toBe('Croquetas de jamón');
    expect(names(p)).toContain('Taquitos de jamón ibérico');
    expect(names(p)).not.toContain('Taquitos de jamón');
    expect(p.portions).toBeGreaterThanOrEqual(6);
  });

  it('Pulpo a feira y Bravas', () => {
    expect(proposeDishLocal('Pulpo a feira').templateName).toBe('Pulpo a la gallega');
    const bravas = proposeDishLocal('Bravas');
    expect(bravas.templateName).toBe('Patatas bravas');
    expect(perPortion(bravas, 'Patata')).toBeGreaterThanOrEqual(200);
  });

  it('Lubina a la brasa con verduras', () => {
    const p = proposeDishLocal('Lubina a la brasa con verduras');
    expectWellFormed(p);
    expect(item(p, 'Lubina')?.basis).toBe('bruta');
    expect(perPortion(p, 'Lubina')).toBeGreaterThanOrEqual(400);
    expect(names(p)).toEqual(expect.arrayContaining(['Calabacín', 'Zanahoria']));
  });

  it('Secreto ibérico con patatas fritas y pimientos de Padrón: conserva la guarnición que nombra la carta', () => {
    const p = proposeDishLocal('Secreto ibérico con patatas fritas y pimientos de Padrón');
    expectWellFormed(p);
    expect(names(p)).toEqual(expect.arrayContaining(['Secreto ibérico', 'Patata', 'Aceite de girasol', 'Pimiento de Padrón']));
    expect(p.allergens).toEqual([]);
  });

  it('Entrecot con patatas fritas: la guarnición de la carta sustituye a la de la receta', () => {
    const p = proposeDishLocal('Entrecot de vaca madurada con patatas fritas');
    expectWellFormed(p);
    expect(p.templateName).toBe('Entrecot');
    expect(names(p)).toEqual(expect.arrayContaining(['Entrecot de ternera', 'Patata', 'Aceite de girasol']));
    expect(names(p)).not.toContain('Pimiento de Padrón');
  });

  it('Carrilleras de ternera al vino tinto con puré de patata', () => {
    const p = proposeDishLocal('Carrilleras de ternera al vino tinto con puré de patata');
    expectWellFormed(p);
    expect(p.templateName).toBe('Carrilleras al vino tinto');
    expect(names(p)).toEqual(expect.arrayContaining(['Carrillera de ternera', 'Vino tinto joven', 'Patata', 'Mantequilla']));
    expect(perPortion(p, 'Carrillera de ternera')).toBeGreaterThanOrEqual(200);
  });

  it('Espaguetis con almejas y arroz caldoso de marisco', () => {
    const pasta = proposeDishLocal('Linguine con almejas');
    expectWellFormed(pasta);
    expect(names(pasta)).toEqual(expect.arrayContaining(['Almeja japónica', 'Ajo', 'Vino blanco', 'Perejil']));
    expect(names(pasta)).not.toContain('Parmesano');
    const arroz = proposeDishLocal('Arroz caldoso de marisco');
    expectWellFormed(arroz);
    expect(names(arroz)).toEqual(expect.arrayContaining(['Fumet de pescado', 'Gamba blanca', 'Mejillón']));
    expect(perPortion(arroz, 'Arroz bomba')).toBeCloseTo(80, 0);
  });

  it('Gin tonic de Tanqueray y copa de Ribera del Duero crianza', () => {
    const gt = proposeDishLocal('Gin tonic de Tanqueray');
    expectWellFormed(gt);
    expect(perPortion(gt, 'Ginebra')).toBe(50);
    expect(perPortion(gt, 'Tónica')).toBe(200);
    expect(names(gt)).toContain('Lima');
    const vino = proposeDishLocal('Copa de Ribera del Duero crianza');
    expect(perPortion(vino, 'Vino tinto crianza')).toBe(150);
    expect(vino.allergens).toEqual(['sulfitos']);
  });

  it('botellas, medias raciones, tapas y copas de jarra', () => {
    expect(perPortion(proposeDishLocal('Botella de Albariño'), 'Albariño')).toBe(750);
    expect(perPortion(proposeDishLocal('Media botella de vino tinto'), 'Vino tinto crianza')).toBe(375);
    expect(perPortion(proposeDishLocal('Botella de Ribera del Duero'), 'Vino tinto crianza')).toBe(750);
    const croquetas = proposeDishLocal('Media ración de croquetas');
    expect(croquetas.templateName).toBe('Croquetas de jamón');
    expect(croquetas.portions).toBe(12);
    expect(proposeDishLocal('Tapa de ensaladilla').portions).toBe(18);
    expect(proposeDishLocal('Copa de sangría').portions).toBe(6);
  });

  it('retira lo que la carta excluye con «sin»', () => {
    const sinPan = proposeDishLocal('Hamburguesa de buey sin pan');
    expect(names(sinPan).some((n) => n.startsWith('Pan'))).toBe(false);
    expect(names(sinPan)).toContain('Carne de buey picada');
    expect(names(proposeDishLocal('Hamburguesa sin pan')).some((n) => n.startsWith('Pan'))).toBe(false);
    const sinCebolla = proposeDishLocal('Hamburguesa de buey sin cebolla');
    expect(names(sinCebolla).some((n) => n.startsWith('Cebolla'))).toBe(false);
    expect(names(sinCebolla)).toContain('Pan brioche de hamburguesa');
    const vegana = proposeDishLocal('Hamburguesa vegana sin pan');
    expect(names(vegana)).toContain('Hamburguesa vegetal');
    expect(names(vegana).some((n) => n.startsWith('Pan'))).toBe(false);
  });

  it('encadena exclusiones («sin cebolla ni pepinillo») sin confundirlas con añadidos («… y con queso de cabra»)', () => {
    const ni = proposeDishLocal('Hamburguesa de buey sin cebolla ni pepinillo');
    expect(names(ni).some((n) => n.startsWith('Cebolla') || n === 'Pepinillo')).toBe(false);
    const y = proposeDishLocal('Hamburguesa de buey sin cebolla y pepinillo');
    expect(names(y).some((n) => n.startsWith('Cebolla') || n === 'Pepinillo')).toBe(false);
    const con = proposeDishLocal('Hamburguesa de buey sin cebolla y con queso de cabra');
    expect(names(con).some((n) => n.startsWith('Cebolla'))).toBe(false);
    expect(names(con)).toEqual(expect.arrayContaining(['Queso de cabra', 'Pepinillo']));
    expect(names(con)).not.toContain('Queso cheddar');
  });

  it('«a la naranja» es una salsa; «de naranja» es la fruta', () => {
    const pato = proposeDishLocal('Pato a la naranja');
    expect(pato.templateName).toBe('Pato a la naranja');
    expect(names(pato)).toEqual(expect.arrayContaining(['Magret de pato', 'Zumo de naranja', 'Licor de naranja']));
    expect(names(pato)).not.toContain('Frutos rojos congelados');
    const ensalada = proposeDishLocal('Ensalada de naranja y bacalao');
    expect(names(ensalada)).toEqual(expect.arrayContaining(['Naranja', 'Bacalao desalado']));
    expect(names(ensalada)).not.toContain('Licor de naranja');
    const curry = proposeDishLocal('Garbanzos al curry');
    expect(names(curry)).toEqual(expect.arrayContaining(['Curry', 'Leche de coco']));
  });

  it('el método de cocción descarta recetas incompatibles y la fruta de un cóctel es un sabor', () => {
    const vieiras = proposeDishLocal('Vieiras a la plancha con crema de coliflor');
    expect(vieiras.templateName).not.toBe('Vieiras gratinadas');
    expect(names(vieiras)).not.toContain('Pan rallado');
    // «crema de coliflor» como guarnición: coliflor ligada con mantequilla y nata
    expect(names(vieiras)).toEqual(expect.arrayContaining(['Vieira', 'Coliflor', 'Mantequilla', 'Nata para cocinar']));
    const mojito = proposeDishLocal('Mojito de fresa');
    expect(mojito.templateName).toBe('Mojito');
    expect(names(mojito)).toEqual(expect.arrayContaining(['Ron', 'Hierbabuena', 'Fresa']));
  });

  it('un puré de otra hortaliza sustituye a la guarnición de la receta', () => {
    const p = proposeDishLocal('Presa ibérica con puré de apionabo');
    expect(names(p)).toEqual(expect.arrayContaining(['Presa ibérica', 'Apionabo', 'Mantequilla']));
    expect(names(p)).not.toContain('Pimiento de Padrón');
    expect(names(p)).not.toContain('Patata');
    const magret = proposeDishLocal('Magret de pato con puré de boniato');
    expect(names(magret)).toContain('Boniato');
    expect(names(magret)).not.toContain('Patata');
  });

  it('«sin gluten» / «sin lactosa» marca los productos que deben ser de esa versión', () => {
    const pizza = proposeDishLocal('Pizza sin gluten');
    expect(item(pizza, 'Masa de pizza')?.note).toMatch(/sin gluten/);
    expect(item(pizza, 'Mozzarella')?.note ?? '').not.toMatch(/sin gluten/);
    const tarta = proposeDishLocal('Tarta de queso sin lactosa');
    expect(item(tarta, 'Queso crema')?.note).toMatch(/sin lactosa/);
  });
});

describe('proposeDishLocal: heurística (sin receta tipo)', () => {
  function expectHeuristic(p: DishProposal): void {
    expectWellFormed(p);
    expect(p.source).toBe('heuristica');
    expect(p.templateName).toBeUndefined();
    expect(p.confidence).toBeGreaterThanOrEqual(0.35);
    expect(p.confidence).toBeLessThanOrEqual(0.6);
  }

  it('detecta el principal y le da el gramaje profesional de su categoría', () => {
    const corvina = proposeDishLocal('Lomo de corvina con salsa de azafrán');
    expectHeuristic(corvina);
    expect(perPortion(corvina, 'Lomo de corvina')).toBe(170);
    // La salsa mencionada se desglosa en sus ingredientes reales
    expect(names(corvina)).toEqual(expect.arrayContaining(['Azafrán', 'Nata para cocinar', 'Fumet de pescado']));

    const chipirones = proposeDishLocal('Chipirones encebollados');
    expectHeuristic(chipirones);
    expect(perPortion(chipirones, 'Chipirón')).toBe(150);
    expect(perPortion(chipirones, 'Cebolla')).toBeGreaterThanOrEqual(100);

    const salmon = proposeDishLocal('Salmón con salsa de yogur y eneldo');
    expectHeuristic(salmon);
    expect(perPortion(salmon, 'Lomo de salmón')).toBe(170);
    expect(names(salmon)).toEqual(expect.arrayContaining(['Yogur griego', 'Eneldo']));

    const revuelto = proposeDishLocal('Revuelto de morcilla con piñones');
    expectHeuristic(revuelto);
    expect(item(revuelto, 'Huevo')).toMatchObject({ quantity: 2, unit: 'ud', basis: 'bruta' });
    expect(names(revuelto)).toEqual(expect.arrayContaining(['Morcilla de Burgos', 'Piñón']));
  });

  it('añade AOVE (10 ml) y sal (1 g) a los platos salados', () => {
    const p = proposeDishLocal('Chipirones encebollados');
    expect(names(p).some((n) => n.startsWith('Aceite de oliva'))).toBe(true);
    expect(item(p, 'Sal')).toMatchObject({ quantity: 1, unit: 'g' });
    const corvina = proposeDishLocal('Lomo de corvina con salsa de azafrán');
    expect(item(corvina, 'Aceite de oliva virgen extra')).toMatchObject({ quantity: 10, unit: 'ml' });
  });

  it('tostas y bocadillos llevan su pan; las hamburguesas veganas no llevan carne', () => {
    const tosta = proposeDishLocal('Tosta de sardina ahumada con tomate');
    expectHeuristic(tosta);
    expect(names(tosta)).toEqual(expect.arrayContaining(['Sardina ahumada', 'Pan de cristal']));
    const vegana = proposeDishLocal('Hamburguesa vegana');
    expectHeuristic(vegana);
    expect(names(vegana)).toEqual(expect.arrayContaining(['Hamburguesa vegetal', 'Pan de hamburguesa']));
    expect(vegana.ingredients.some((i) => i.category === 'carne')).toBe(false);
  });

  it('platos de pasta y arroz con el gramaje de la base', () => {
    const pasta = proposeDishLocal('Tallarines con gambas y ajo');
    expectHeuristic(pasta);
    expect(perPortion(pasta, 'Tallarines')).toBe(110);
    expect(names(pasta)).not.toContain('Parmesano');
    expect(names(pasta)).toEqual(expect.arrayContaining(['Gamba pelada congelada', 'Ajo', 'Vino blanco']));
    const arroz = proposeDishLocal('Arroz con pollo');
    expectHeuristic(arroz);
    expect(perPortion(arroz, 'Arroz bomba')).toBe(90);
    expect(names(arroz)).not.toContain('Arroz redondo');
    expect(names(arroz)).toContain('Caldo de pollo');
  });

  it('«pollo» a secas: el corte según el plato; baos con su pan y gramaje de bao', () => {
    const bao = proposeDishLocal('Bao de pollo crujiente con kimchi');
    expectHeuristic(bao);
    expect(item(bao, 'Pan bao')).toMatchObject({ quantity: 2, unit: 'ud' });
    expect(names(bao)).toEqual(expect.arrayContaining(['Pechuga de pollo', 'Kimchi']));
    expect(names(bao)).not.toContain('Pollo entero');
    expect(perPortion(bao, 'Pechuga de pollo')).toBeLessThanOrEqual(100);
    expect(names(proposeDishLocal('Arroz con pollo'))).toContain('Pollo troceado');
  });

  it('una elaboración con nombre de método no se duplica («pil pil»)', () => {
    const p = proposeDishLocal('Lomo de corvina con pil pil de hongos');
    expect(perPortion(p, 'Aceite de oliva virgen extra')).toBeLessThanOrEqual(70);
    expect(perPortion(p, 'Ajo')).toBeLessThanOrEqual(8);
  });

  it('bebidas sin receta: batidos, zumos naturales y botellas', () => {
    const batido = proposeDishLocal('Batido de fresa');
    expectWellFormed(batido);
    expect(names(batido)).toEqual(expect.arrayContaining(['Fresa', 'Leche entera']));
    const zumo = proposeDishLocal('Zumo de manzana');
    expect(item(zumo, 'Manzana')).toMatchObject({ quantity: 400, unit: 'g', basis: 'bruta' });
  });

  it('describe la elaboración en pasos numerados', () => {
    const p = proposeDishLocal('Lomo de corvina con salsa de azafrán');
    expect(p.procedure).toMatch(/^1\. Limpiar y porcionar lomo de corvina \(170 g netos por ración\)\.\n2\. /);
  });

  it('sin nada reconocible devuelve una propuesta mínima (aceite y sal) con confianza 0,1 y sin elaboración', () => {
    for (const name of ['Especialidad de la casa', 'Sugerencia del chef', '', '   ']) {
      const p = proposeDishLocal(name);
      expect(p.source, name).toBe('heuristica');
      expect(p.confidence, name).toBe(0.1);
      expect(names(p), name).toEqual(['Aceite de oliva virgen extra', 'Sal']);
      expect(p.procedure, name).toBeUndefined();
      expect(p.templateName, name).toBeUndefined();
    }
  });
});

describe('proposeDishLocal: calidad global y rendimiento', () => {
  const MENU: [string, string?][] = [
    ['Pulpo a la gallega con cachelos'], ['Tataki de atún rojo con ajoblanco'], ['Hamburguesa de buey con cheddar y bacon'], ['Risotto de boletus'],
    ['Tarta de queso al horno'], ['Solomillo de ternera con salsa de Oporto y patatas panaderas'], ['Ensalada de burrata con tomate raf y pesto'],
    ['Bacalao confitado sobre pisto manchego'], ['Croquetas de gambas'], ['Huevos rotos con gulas'], ['Risotto de calabaza'], ['Poke de atún'],
    ['Secreto ibérico con patatas y pimientos de Padrón'], ['Melón con jamón'], ['Ensalada de gambas'], ['Crema de calabaza'], ['Tacos de cochinita pibil'],
    ['Pizza de burrata y mortadela'], ['Merluza a la plancha con verduras'], ['Alcachofas a la plancha con jamón'], ['Tarta de chocolate'], ['Brownie con helado'],
    ['Bocadillo de lomo con queso'], ['Guiso de ternera con setas'], ['Langostinos en tempura con salsa agridulce'], ['Salmón', 'con salsa de yogur y eneldo'],
    ['Cordero lechal asado con patatas panaderas'], ['Ensalada de quinoa con aguacate y langostinos'], ['Papas arrugadas con mojo'], ['Solomillo al whisky'],
    ['Lacón a la gallega'], ['Migas extremeñas'], ['Esqueixada'], ['Caipiriña'], ['Café cortado'], ['Tinto de verano con limón'], ['Chuletón de vaca (1 kg)'],
    ['Paella valenciana', 'Arroz con pollo, conejo, judía verde y garrofón'], ['Crema catalana'], ['Gazpacho andaluz'],
  ];

  it('todas las propuestas están bien formadas y casi todas vienen de una receta tipo', () => {
    let templates = 0;
    for (const [name, desc] of MENU) {
      const p = proposeDishLocal(name, desc);
      expectWellFormed(p);
      if (p.source === 'plantilla') {
        templates++;
        expect(p.confidence, name).toBeGreaterThanOrEqual(KB_TEMPLATE_THRESHOLD);
        expect(p.templateName, name).toBeTruthy();
      }
    }
    expect(templates / MENU.length).toBeGreaterThan(0.8);
  });

  it('el principal de cada plato tiene un gramaje profesional', () => {
    const mains: [string, string, number, number][] = [
      ['Huevos rotos con gulas', 'Gulas', 30, 80],
      ['Poke de atún', 'Lomo de atún', 80, 150],
      ['Melón con jamón', 'Jamón serrano loncheado', 40, 70],
      ['Croquetas de gambas', 'Gamba pelada congelada', 25, 60],
      ['Cordero lechal asado con patatas panaderas', 'Paletilla de cordero lechal', 500, 800],
      ['Chuletón de vaca (1 kg)', 'Chuletón de vaca', 450, 550],
      ['Langostinos en tempura con salsa agridulce', 'Cola de langostino pelada', 120, 200],
    ];
    for (const [dish, main, min, max] of mains) {
      const g = perPortion(proposeDishLocal(dish), main);
      expect(g, `${dish}: ${main}`).toBeGreaterThanOrEqual(min);
      expect(g, `${dish}: ${main}`).toBeLessThanOrEqual(max);
    }
  });

  it('devuelve copias: modificar una propuesta no altera las siguientes', () => {
    const a = proposeDishLocal('Pulpo a la gallega con cachelos');
    a.ingredients[0].quantity = 999;
    a.ingredients.push({ name: 'Sal', quantity: 1, unit: 'g', basis: 'neta' });
    a.allergens?.push('gluten');
    const b = proposeDishLocal('Pulpo a la gallega con cachelos');
    expect(b.ingredients[0].quantity).not.toBe(999);
    expect(b.allergens).toEqual(['moluscos']);
  });

  it('responde en menos de 30 ms por plato', () => {
    // Calentamiento: índices perezosos (ingredientes, recetas, elaboraciones)
    proposeDishLocal('Calentamiento de índices con pulpo');
    const dishes = [
      'Lomo de corvina con pil pil de hongos', 'Rodaballo salvaje a la brasa con refrito', 'Carrillera ibérica glaseada con parmentier trufado',
      'Tartar de vaca rubia gallega con yema curada', 'Ensalada templada de langostinos y aguacate', 'Arroz meloso de pato y boletus',
      'Canelones de rustido con bechamel de trufa', 'Presa ibérica con chimichurri y patatas', 'Vieiras a la plancha con crema de coliflor',
      'Coulant de chocolate con helado de vainilla', 'Pizza de trufa y champiñones', 'Bao de pollo crujiente con kimchi', 'Tosta de anchoas con tomate',
      'Crema de nécoras', 'Rape a la marinera con almejas', 'Pechuga de pollo al curry con arroz basmati', 'Tiramisú de la casa', 'Mojito de fresa',
      'Solomillo de cerdo al Pedro Ximénez', 'Brocheta de langostinos con salsa romesco',
    ];
    const times: number[] = [];
    for (const d of dishes) {
      const t0 = performance.now();
      const p = proposeDishLocal(d, 'Elaborado al momento con producto de temporada');
      times.push(performance.now() - t0);
      expectWellFormed(p);
    }
    times.sort((x, y) => x - y);
    const avg = times.reduce((s, t) => s + t, 0) / times.length;
    const p90 = times[Math.floor(times.length * 0.9)];
    expect(avg).toBeLessThan(10);
    expect(p90).toBeLessThan(30);
  });
});
