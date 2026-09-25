import { describe, expect, it } from 'vitest';
import {
  AUTO_LINK_THRESHOLD,
  SUGGEST_THRESHOLD,
  cleanProductName,
  jaroWinkler,
  normalizeText,
  rankMatches,
  similarity,
  toSearchKey,
  tokenize,
} from './matching';

describe('normalizeText', () => {
  it('quita tildes, signos y mayúsculas y colapsa espacios', () => {
    expect(normalizeText('  Pimentón   de la VERA (dulce)!! ')).toBe('pimenton de la vera dulce');
    expect(normalizeText('Champiñón')).toBe('champinon');
    expect(normalizeText('ACEITE OLIVA V.E. 5L')).toBe('aceite oliva v e 5l');
    expect(normalizeText('')).toBe('');
  });
});

describe('tokenize', () => {
  it.each([
    ['ACEITE OLIVA V.E. GARRAFA 5L', ['aceite', 'oliva', 'virgen', 'extra']],
    ['Aceite de oliva virgen extra', ['aceite', 'oliva', 'virgen', 'extra']],
    ['AOVE 5L', ['aceite', 'oliva', 'virgen', 'extra']],
    ['ACEIT. OLIVA VIRG. EXT. 1L', ['aceite', 'oliva', 'virgen', 'extra']],
    ['AC. OLIVA 0,4º 5L', ['aceite', 'oliva']],
    ['TOMATE PERA CAT.I CAJA 6KG', ['tomate', 'pera']],
    ['HUEVOS M DOCENA', ['huevo']],
    ['NATA 35% MG 1L', ['nata', 'montar']],
    ['NATA 18% 1L', ['nata', 'cocinar']],
    ['NATA PARA COCINAR 35%', ['nata', 'cocinar']],
    ['CHOCOLATE 70% 1KG', ['chocolate', 'negro']],
    ['CACAO 70%', ['cacao']],
    ['FUMET PESCADO 1L', ['caldo', 'pescado']],
    ['NARANJA ZUMO 15KG', ['naranja', 'dezumo']],
    ['LECHE SIN LACTOSA', ['leche', 'sinlactosa']],
    ['LECHE ENTERA 6X1L', ['leche', 'entero']],
    ['12 UDS X 200G YOGUR NATURAL', ['yogur', 'natural']],
    ['GAMBA 8/10 CONG. T-3', ['gamba', 'congelado']],
    ['CALABACINES', ['calabacin']],
    ['NUECES', ['nuez']],
    ['LIMONES MALLA 1KG', ['limon']],
    ['CHAMPIÑONES LAMINADOS', ['champinon', 'laminado']],
    ['PRESA IBÉRICA', ['presa', 'iberico']],
    ['MANT. S/S 250G', ['mantequilla', 'sinsal']],
    ['ACEITUNA MANZANILLA S/H', ['aceituna', 'manzanilla', 'sinhueso']],
    ['Crema de leche', ['nata']],
    ['NUEZ MOSCADA MOLIDA', ['nuezmoscada', 'molido']],
    ['CEBOLLA TIERNA', ['cebolleta']],
    ['PAPAS AGRIAS', ['patata', 'agria']],
    ['HACENDADO TOMATE FRITO 400G', ['tomate', 'frito']],
    ['REF 12345 LOTE 2025A SOLOMILLO TERNERA NAC.', ['solomillo', 'ternera']],
    ['P0LLO ENTERO', ['pollo', 'entero']],
  ])('%s → %j', (input, expected) => {
    expect(tokenize(input)).toEqual(expected);
  });

  it('no destroza palabras que ya son singulares', () => {
    expect(tokenize('arroz ajo maíz atún jamón salmón anís')).toEqual(['arroz', 'ajo', 'maiz', 'atun', 'jamon', 'salmon', 'anis']);
    expect(tokenize('Tomates')).toEqual(['tomate']);
    expect(tokenize('Pimientos rojos')).toEqual(['pimiento', 'rojo']);
    expect(tokenize('Gambas')).toEqual(['gamba']);
    expect(tokenize('Dulces')).toEqual(['dulce']);
    expect(tokenize('Chiles')).toEqual(['guindilla']);
    expect(tokenize('Vinagres')).toEqual(['vinagre']);
    expect(tokenize('Calamares')).toEqual(['calamar']);
  });

  it('devuelve vacío si sólo hay formato o ruido', () => {
    expect(tokenize('CAJA 5KG')).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });
});

describe('toSearchKey', () => {
  it('es estable entre la receta y la factura', () => {
    expect(toSearchKey('Aceite de oliva virgen extra')).toBe(toSearchKey('ACEITE OLIVA V.E. GARRAFA 5L'));
    expect(toSearchKey('Limones')).toBe('limon');
  });
  it('recurre a la normalización básica si no quedan tokens', () => {
    expect(toSearchKey('Caja 5 kg')).toBe('caja 5 kg');
  });
});

describe('jaroWinkler', () => {
  it('valores de referencia', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.8133, 3);
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });
});

/** [receta, producto de factura] */
type Pair = [string, string];

const SHOULD_AUTO_LINK: Pair[] = [
  ['Aceite de oliva virgen extra', 'AOVE 5L'],
  ['Aceite de oliva virgen extra', 'ACEIT. OLIVA VIRG. EXT. 1L'],
  ['Patata', 'PATATA AGRIA SACO 25KG'],
  ['Nata', 'NATA 35% MG 1L'],
  ['Solomillo de ternera', 'SOLOMILLO TERNERA NAC.'],
  ['Huevo', 'HUEVOS M DOCENA'],
  ['Pimentón de la Vera', 'PIMENTON DULCE VERA 75G'],
  ['Queso manchego', 'QUESO MANCHEGO CURADO D.O.'],
  ['Harina', 'HARINA TRIGO 1KG'],
  ['Azúcar', 'AZUCAR BLANCO 1KG'],
  ['Mantequilla', 'MANT. SIN SAL 250G'],
  ['Limón', 'LIMONES MALLA 1KG'],
  ['Tomates cherry', 'TOMATE CHERRY BDJA 250G'],
  ['Pechuga de pollo', 'PECHUGA POLLO FILETEADA CONG.'],
  ['Pechuga de pollo', 'POLLO PECHUGA'],
  ['Langostino', 'LANGOSTINO CONG. 1KG'],
  ['Crema de leche', 'NATA 35% 1L'],
  ['Patata', 'PAPAS 25KG'],
  ['Cebolla', 'CEBOLLA DULCE MALLA 10KG'],
  ['Ajo', 'AJOS MORADOS MALLA 1KG'],
  ['Zanahoria', 'ZANAH. 10KG'],
  ['Champiñón', 'CHAMP. LAMINADO 500G'],
  ['Mozzarella', 'QUESO MOZZARELLA 125G'],
  ['Leche entera', 'LECHE ENTERA 6X1L'],
  ['Leche', 'LECHE ENTERA 6X1L'],
  ['Aceite de oliva', 'ACEITE OLIVA V.E. 5L'],
  ['Aceite', 'ACEITE OLIVA V.E. 5L'],
  ['Arroz bomba', 'ARROZ BOMBA 1KG'],
  ['Pimiento rojo', 'PIMIENTOS ROJOS KG'],
  ['Calabacín', 'CALABACINES KG'],
  ['Nuez', 'NUECES PELADAS 1KG'],
  ['Gamba', 'GAMBA BLANCA CONG. 1KG'],
  ['Cilantro', 'CULANTRO MANOJO'],
  ['Guindilla', 'CAYENA 50G'],
  ['Calabacín', 'ZUCCHINI'],
  ['Pimentón', 'PAPRIKA 1KG'],
  ['Jamón ibérico', 'JAMON IBERICO BELLOTA LONCHAS'],
  ['Presa ibérica', 'PRESA IBER. KG'],
  ['Salmón', 'SALMON NORUEGO FRESCO ENTERO'],
  ['Pollo', 'P0LLO ENTERO'],
  ['Merluza', 'MERL. CONG. 1KG'],
  ['Huevo campero', 'HUEVOS CAMPEROS L 30 UDS'],
  ['Perejil', 'PEREJIL MANOJO'],
  ['Queso parmesano', 'PARMESANO REGGIANO'],
  ['Vino blanco', 'VINO BLANCO VERDEJO 75CL'],
  ['Carne picada de ternera', 'CARNE PICADA TERNERA 1KG'],
  ['Azúcar moreno', 'AZUCAR MORENO 1KG'],
  ['Tomate', 'TOMATF PERA CAJA 6KG'],
  ['Pimientos del piquillo', 'PIQUILLO LATA 250G'],
  ['Hierbabuena', 'HIERBA BUENA MANOJO'],
];

const SHOULD_SUGGEST: Pair[] = [
  ['Pulpo', 'PULPO COCIDO PATA'],
  ['Pollo', 'PECHUGA POLLO'],
  ['Tomate', 'TOMATE FRITO 400G'],
  ['Pan', 'PAN RALLADO 1KG'],
  ['Harina', 'HARINA MAIZ 1KG'],
  ['Leche', 'LECHE DESNATADA 6X1L'],
  ['Aceite', 'ACEITE GIRASOL 5L'],
  ['Bacon', 'PANCETA AHUMADA'],
  ['Queso parmesano', 'PARMESANO RALLADO'],
  ['Pimiento rojo', 'PIMIENTO VERDE'],
  ['Tomate pera', 'TOMATE CHERRY'],
  ['Solomillo de vacuno', 'SOLOMILLO TERNERA'],
  ['Azúcar', 'AZUCAR MORENO 1KG'],
  ['Vino tinto', 'VINO BLANCO'],
  ['Merluza', 'FILETE MERLUZA CONG.'],
  ['Pimentón dulce', 'PIMENTON PICANTE'],
  ['Queso curado', 'QUESO SEMICURADO'],
  ['Langostino', 'LANGOSTINO COCIDO'],
  ['Salmón', 'SALMON AHUMADO'],
  ['Jamón ibérico', 'JAMON SERRANO'],
];

const MUST_NOT_AUTO_LINK: Pair[] = [
  ['Aceite de girasol', 'Aceite de oliva'],
  ['Cebolla', 'Cebolleta'],
  ['Gamba', 'Langostino'],
  ['Solomillo de cerdo', 'Solomillo de ternera'],
  ['Pulpo', 'Calamar'],
  ['Harina de trigo', 'Harina de maíz'],
  ['Nata', 'Leche'],
  ['Pimiento', 'Pimienta'],
  ['Salmón', 'Salmonete'],
  ['Langostino', 'Langosta'],
  ['Calabacín', 'Calabaza'],
  ['Cereza', 'Cerveza'],
  ['Nuez', 'NUEZ MOSCADA'],
  ['Pechuga de pollo', 'Muslo de pollo'],
  ['Zumo de naranja', 'Naranja'],
  ['Tomate pera', 'Pera'],
  ['Cebolla', 'CEBOLLA TIERNA'],
  ['Aceite de oliva', 'Aceitunas'],
  ['Mantequilla', 'Manteca'],
  ['Leche de vaca', 'Leche de cabra'],
  ['Queso de cabra', 'Queso de oveja'],
  ['Lomo de salmón', 'Lomo de bacalao'],
  ['Vino blanco', 'Vinagre de vino blanco'],
  ['Sal', 'Salsa'],
  ['Pollo', 'Pavo'],
  ['Cordero', 'Cabrito'],
  ['Chocolate negro', 'Chocolate blanco'],
  ['Judía verde', 'Judía blanca'],
  ['Arroz', 'Harina de arroz'],
  ['Carne picada de ternera', 'Carne picada de cerdo'],
  ['Solomillo de ternera', 'Lomo de ternera'],
  ['Pimiento', 'PIMENTON DULCE'],
];

/** Pares claramente distintos: ni siquiera deben sugerirse. */
const MUST_NOT_SUGGEST: Pair[] = [
  ['Aceite de girasol', 'Aceite de oliva'],
  ['Cebolla', 'Cebolleta'],
  ['Gamba', 'Langostino'],
  ['Solomillo de cerdo', 'Solomillo de ternera'],
  ['Pulpo', 'Calamar'],
  ['Harina de trigo', 'Harina de maíz'],
  ['Nata', 'Leche'],
  ['Pimiento', 'Pimienta'],
  ['Cereza', 'Cerveza'],
  ['Zumo de naranja', 'Naranja'],
  ['Tomate pera', 'Pera'],
  ['Sal', 'Salsa'],
  ['Pollo', 'Pavo'],
  ['Lomo de salmón', 'Lomo de bacalao'],
];

describe('similarity: matriz de emparejamientos reales', () => {
  it('tiene al menos 60 pares en la matriz', () => {
    expect(SHOULD_AUTO_LINK.length + SHOULD_SUGGEST.length + MUST_NOT_AUTO_LINK.length).toBeGreaterThanOrEqual(60);
  });

  it.each(SHOULD_AUTO_LINK)('vincula automáticamente: %s ⇄ %s', (a, b) => {
    expect(similarity(a, b)).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
  });

  it.each(SHOULD_SUGGEST)('sugiere (sin vincular solo): %s ⇄ %s', (a, b) => {
    const s = similarity(a, b);
    expect(s).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
    if (a !== 'Pulpo') expect(s).toBeLessThan(AUTO_LINK_THRESHOLD);
  });

  it.each(MUST_NOT_AUTO_LINK)('NO vincula: %s ⇄ %s', (a, b) => {
    expect(similarity(a, b)).toBeLessThan(AUTO_LINK_THRESHOLD);
  });

  it.each(MUST_NOT_SUGGEST)('ni siquiera sugiere: %s ⇄ %s', (a, b) => {
    expect(similarity(a, b)).toBeLessThan(SUGGEST_THRESHOLD);
  });

  it('casos exigidos con margen', () => {
    expect(similarity('Aceite de oliva virgen extra', 'ACEITE OLIVA V.E. GARRAFA 5L')).toBeGreaterThanOrEqual(0.9);
    expect(similarity('Tomate', 'TOMATE PERA CAJA 6KG')).toBeGreaterThanOrEqual(0.82);
  });

  it('es simétrica, acotada y 1 para nombres equivalentes', () => {
    for (const [a, b] of [...SHOULD_AUTO_LINK, ...SHOULD_SUGGEST, ...MUST_NOT_AUTO_LINK]) {
      const ab = similarity(a, b);
      expect(ab).toBeCloseTo(similarity(b, a), 10);
      expect(ab).toBeGreaterThanOrEqual(0);
      expect(ab).toBeLessThanOrEqual(1);
    }
    expect(similarity('Tomate', 'tomates')).toBe(1);
    expect(similarity('Bacon', 'BACON LONCHAS 1KG')).toBe(1);
  });

  it('entradas vacías o sin tokens', () => {
    expect(similarity('', 'Tomate')).toBe(0);
    expect(similarity('Tomate', '')).toBe(0);
    expect(similarity('Caja 5kg', 'CAJA 5KG')).toBe(1);
    expect(similarity('Caja 5kg', 'Tomate')).toBe(0);
  });

  it('prefiere el valor habitual cuando la receta es genérica', () => {
    expect(similarity('Harina', 'HARINA TRIGO 1KG')).toBeGreaterThan(similarity('Harina', 'HARINA MAIZ 1KG'));
    expect(similarity('Aceite', 'ACEITE OLIVA 5L')).toBeGreaterThan(similarity('Aceite', 'ACEITE GIRASOL 5L'));
    expect(similarity('Leche', 'LECHE ENTERA')).toBeGreaterThan(similarity('Leche', 'LECHE SEMIDESNATADA'));
  });

  it('fresco frente a congelado es sólo una penalización leve', () => {
    const s = similarity('Merluza fresca', 'MERLUZA CONGELADA');
    expect(s).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
    expect(s).toBeLessThan(similarity('Merluza fresca', 'MERLUZA FRESCA'));
  });
});

describe('similarity: reglas de dominio', () => {
  it('el genérico no se contradice con el "de qué"', () => {
    expect(similarity('Caldo de pescado', 'CALDO POLLO BRIK 1L')).toBeLessThan(SUGGEST_THRESHOLD);
    expect(similarity('Caldo de pescado', 'FUMET PESCADO 1L')).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
    expect(similarity('Zumo de naranja', 'Zumo de limón')).toBeLessThan(SUGGEST_THRESHOLD);
    expect(similarity('Crema de calabaza', 'Crema de calabacín')).toBeLessThan(SUGGEST_THRESHOLD);
    // Las clases genéricas no contradicen: "caldo de pescado" puede ser de merluza
    expect(similarity('Caldo de pescado', 'CALDO MERLUZA')).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
  });

  it('"NARANJA ZUMO" es naranja para exprimir, no zumo', () => {
    expect(similarity('Naranja', 'NARANJA ZUMO 15KG')).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
    expect(similarity('Zumo de naranja', 'NARANJA ZUMO 15KG')).toBeLessThan(SUGGEST_THRESHOLD);
  });

  it('queso genérico prefiere leche de vaca; cabra u oveja se sugieren', () => {
    expect(similarity('Queso curado', 'QUESO CABRA RULO')).toBeLessThan(AUTO_LINK_THRESHOLD);
    expect(similarity('Queso', 'QUESO CABRA RULO')).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
  });

  it('el porcentaje define la nata y el chocolate', () => {
    expect(similarity('Nata para montar', 'NATA 35% MG 1L')).toBe(1);
    expect(similarity('Nata para cocinar', 'NATA 18% 1L')).toBe(1);
    expect(similarity('Chocolate negro', 'CHOCOLATE 70% 1KG')).toBe(1);
  });

  it('hierbas y especias secas o molidas no son "otro producto"', () => {
    expect(similarity('Tomillo', 'TOMILLO SECO')).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
    expect(similarity('Comino', 'COMINO MOLIDO')).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
    expect(similarity('Tomate', 'TOMATE SECO')).toBeLessThan(AUTO_LINK_THRESHOLD);
  });

  it('platos y elaboraciones con nombre propio mandan sobre el adjetivo', () => {
    expect(similarity('Queso manchego', 'Pisto manchego')).toBeLessThan(SUGGEST_THRESHOLD);
    expect(similarity('Leche', 'Dulce de leche')).toBeLessThan(SUGGEST_THRESHOLD);
    expect(similarity('Calamar', 'Tinta de calamar')).toBeLessThan(SUGGEST_THRESHOLD);
  });

  it('"sin lactosa" o "sin gluten" cambian el producto; "sin sal" o "sin hueso" no tanto', () => {
    expect(similarity('Leche', 'LECHE SIN LACTOSA')).toBeLessThan(0.95);
    expect(similarity('Leche entera', 'LECHE SIN LACTOSA')).toBeLessThan(AUTO_LINK_THRESHOLD);
    expect(similarity('Aceitunas', 'ACEITUNA MANZANILLA S/H')).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
  });
});

describe('rankMatches', () => {
  const products = [
    { id: 'p1', name: 'PECHUGA POLLO', aliases: [] as string[] },
    { id: 'p2', name: 'POLLO ENTERO' },
    { id: 'p3', name: 'MUSLO POLLO' },
    { id: 'p4', name: 'PAVO ENTERO' },
    { id: 'p5', name: 'HARINA MAIZ 1KG' },
    { id: 'p6', name: 'HARINA TRIGO 1KG' },
    { id: 'p7', name: 'HARINA TRIGO FUERZA 25KG' },
    { id: 'p8', name: 'ACEITE GIRASOL 5L' },
    { id: 'p9', name: 'ACEITE OLIVA V.E. 5L' },
    { id: 'p10', name: 'Producto 4471', aliases: ['TOMATE PERA CAJA 6KG', 'Tomate pera'] },
  ];

  it('ordena por similitud y respeta límite y mínimo', () => {
    const r = rankMatches('Pollo', products, 3);
    expect(r[0].item.id).toBe('p2');
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.every((m) => m.score >= 0.35)).toBe(true);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    expect(r.some((m) => m.item.id === 'p4')).toBe(false);
  });

  it('elige el producto habitual para una receta genérica', () => {
    expect(rankMatches('Harina', products)[0].item.id).toBe('p6');
    expect(rankMatches('Aceite', products)[0].item.id).toBe('p9');
    expect(rankMatches('Aceite de oliva virgen extra', products)[0].item.id).toBe('p9');
  });

  it('busca también en los alias e informa de cuál coincidió', () => {
    const r = rankMatches('Tomate pera', products);
    expect(r[0].item.id).toBe('p10');
    expect(['TOMATE PERA CAJA 6KG', 'Tomate pera']).toContain(r[0].matchedOn);
    expect(r[0].score).toBe(1);
  });

  it('un alias genérico no se salta la contradicción del nombre del producto', () => {
    const kb = [
      { id: 'st', name: 'Solomillo de ternera', aliases: ['solomillo', 'lomo fino'] },
      { id: 'lc', name: 'Lomo de cerdo', aliases: ['cinta de lomo'] },
      { id: 'vt', name: 'Vino tinto crianza', aliases: ['vino'] },
      { id: 'vb', name: 'Vino blanco', aliases: [] },
    ];
    const lomo = rankMatches('LOMO CERDO CINTA', kb);
    expect(lomo[0].item.id).toBe('lc');
    expect(lomo.find((m) => m.item.id === 'st')?.score ?? 0).toBeLessThanOrEqual(0.5);
    const vino = rankMatches('VINO BLANCO COCINA 5L', kb);
    expect(vino[0].item.id).toBe('vb');
    expect(vino.find((m) => m.item.id === 'vt')?.score ?? 0).toBeLessThanOrEqual(0.6);
    // Sin contradicción, el alias sí cuenta
    expect(rankMatches('SOLOMILLO', kb)[0]).toMatchObject({ matchedOn: 'solomillo', score: 1 });
  });

  it('casos límite', () => {
    expect(rankMatches('', products)).toEqual([]);
    expect(rankMatches('Pollo', [])).toEqual([]);
    expect(rankMatches('Pollo', products, 0)).toEqual([]);
    expect(rankMatches('Pollo', products, 5, 0.99).map((m) => m.item.id)).toEqual([]);
    expect(rankMatches('Pollo', products, 5, 0.9).map((m) => m.item.id)).toEqual(['p2']);
  });

  it('rendimiento: 1500 productos × 60 consultas en < 250 ms (cachés en frío)', () => {
    const bases = [
      'TOMATE', 'CEBOLLA', 'PATATA', 'PIMIENTO', 'ZANAHORIA', 'CALABACIN', 'BERENJENA', 'LECHUGA', 'AJO', 'PUERRO',
      'POLLO', 'PECHUGA POLLO', 'SOLOMILLO TERNERA', 'LOMO CERDO', 'PRESA IBERICA', 'CORDERO', 'MERLUZA', 'BACALAO',
      'SALMON', 'GAMBA', 'LANGOSTINO', 'PULPO', 'CALAMAR', 'MEJILLON', 'NATA', 'LECHE', 'MANTEQUILLA', 'QUESO',
      'HARINA', 'AZUCAR', 'ARROZ', 'ACEITE OLIVA', 'ACEITE GIRASOL', 'VINAGRE', 'SAL', 'PIMIENTA', 'HUEVO', 'LIMON',
      'NARANJA', 'MANZANA', 'FRESA', 'CHOCOLATE', 'CAFE', 'VINO', 'CERVEZA', 'AGUA', 'PAN', 'PASTA', 'JAMON', 'CHORIZO',
    ];
    const quals = ['', 'PERA', 'ROJO', 'FRESCO', 'CONG.', 'ENTERO', 'EXTRA', 'NAC.', 'CURADO', 'BLANCO', 'DULCE', 'IBERICO', 'ECOLOGICO', 'TROCEADO', 'LAMINADO'];
    const packs = ['CAJA 6KG', '1KG', 'GARRAFA 5L', '6X1L', 'MALLA 2KG', 'BDJA 500G', 'SACO 25KG', '12 UDS', 'LATA 2,5 KG', 'KG'];
    // Cada ronda usa textos nunca vistos (referencias distintas) para medir con las cachés de análisis vacías.
    const catalog = (round: number) => {
      const items: { name: string; aliases: string[] }[] = [];
      for (let i = 0; items.length < 1500; i++) {
        const b = bases[i % bases.length];
        const q = quals[Math.floor(i / bases.length) % quals.length];
        const p = packs[i % packs.length];
        items.push({ name: `${b} ${q} ${p} REF${round}${10000 + i}`.replace(/\s+/g, ' '), aliases: [`${b} ${q} LOTE ${round}${i}`.trim()] });
      }
      return items;
    };
    const queries = [
      'Tomate', 'Cebolla', 'Patata', 'Pimiento rojo', 'Zanahoria', 'Calabacín', 'Berenjena', 'Lechuga', 'Ajo', 'Puerro',
      'Pollo', 'Pechuga de pollo', 'Solomillo de ternera', 'Lomo de cerdo', 'Presa ibérica', 'Cordero', 'Merluza', 'Bacalao',
      'Salmón', 'Gamba', 'Langostino', 'Pulpo', 'Calamar', 'Mejillón', 'Nata', 'Leche entera', 'Mantequilla', 'Queso curado',
      'Harina', 'Azúcar', 'Arroz', 'Aceite de oliva virgen extra', 'Aceite de girasol', 'Vinagre', 'Sal', 'Pimienta negra',
      'Huevo', 'Limón', 'Naranja', 'Manzana', 'Fresa', 'Chocolate negro', 'Café', 'Vino tinto', 'Cerveza', 'Agua', 'Pan',
      'Pasta', 'Jamón ibérico', 'Chorizo', 'Tomates cherry', 'Cebolla morada', 'Patatas agrias', 'Pimiento verde',
      'Gambas peladas', 'Nata para montar', 'Queso manchego', 'Harina de trigo', 'Azúcar moreno', 'Salmón ahumado',
    ];
    expect(queries.length).toBe(60);
    // Mejor de 3 rondas en frío: la máquina de CI puede estar compartida y un pico de carga no debe dar un falso fallo.
    let best = Number.POSITIVE_INFINITY;
    for (let round = 1; round <= 3; round++) {
      const items = catalog(round);
      const t0 = performance.now();
      let found = 0;
      for (const q of queries) found += rankMatches(`${q}`, items, 5).length;
      best = Math.min(best, performance.now() - t0);
      expect(found).toBeGreaterThan(60);
    }
    expect(best).toBeLessThan(250);
  });
});

describe('cleanProductName', () => {
  it.each([
    ['TOMATE PERA CAT.I CAJA 6KG', 'Tomate pera'],
    ['ACEITE OLIVA V.E. GARRAFA 5L', 'Aceite de oliva virgen extra'],
    ['SOLOMILLO TERNERA NAC. KG', 'Solomillo de ternera'],
    ['PECHUGA POLLO', 'Pechuga de pollo'],
    ['NATA 35% MG 1L', 'Nata'],
    ['MANT. SIN SAL 250G', 'Mantequilla sin sal'],
    ['PIMENTON DULCE VERA 75G', 'Pimentón dulce de la Vera'],
    ['CONG. GAMBA ROJA 1KG', 'Gamba roja congelada'],
    ['JAMON IBERICO BELLOTA 50%', 'Jamón ibérico de bellota'],
    ['LIMONES MALLA 1KG', 'Limón'],
    ['HUEVOS M DOCENA', 'Huevo'],
    ['AOVE 5L', 'Aceite de oliva virgen extra'],
    ['QUESO MANCHEGO CURADO D.O.', 'Queso manchego curado'],
    ['ACEITUNA MANZANILLA S/H 350G', 'Aceituna manzanilla sin hueso'],
    ['PIMIENTOS DEL PIQUILLO 250G', 'Pimiento del piquillo'],
    ['LECHE ENT. 6X1L', 'Leche entera'],
    ['PRESA IBER. KG', 'Presa ibérica'],
    ['HARINA TRIGO 1KG HACENDADO', 'Harina de trigo'],
    ['VINAGRE JEREZ 1L', 'Vinagre de Jerez'],
    ['CARNE PICADA TERNERA 1KG', 'Carne picada de ternera'],
    ['SALMON NORUEGO FRESCO ENTERO', 'Salmón fresco entero'],
    ['Tomates cherry', 'Tomate cherry'],
    ['ATUN EN ACEITE DE OLIVA LATA', 'Atún en aceite de oliva'],
    ['PAPAS 25KG', 'Patata'],
    ['CHAMPIÑONES LAMINADOS BDJA 500G', 'Champiñón laminado'],
    ['PECHUGA POLLO CONGELADO', 'Pechuga de pollo congelada'],
    ['IBERICO JAMON LONCHAS', 'Jamón ibérico'],
    ['REF 12345 AZUCAR BLANCO 1KG', 'Azúcar blanco'],
    ['ZUMO NARANJA 1L', 'Zumo de naranja'],
    ['QUESO CABRA RULO 1KG', 'Queso de cabra rulo'],
    ['MERLUZA FILETE CONG. S/P', 'Filete de merluza congelado sin piel'],
    ['ATUN ROJO LOMO', 'Lomo de atún rojo'],
    ['POLLO PECHUGA FILETEADA', 'Pechuga de pollo fileteada'],
    ['CORDERO LECHAL PALETILLA', 'Paletilla de cordero lechal'],
    ['ENTRECOT AÑOJO KG', 'Entrecot de añojo'],
    ['ALMEJA JAPONICA', 'Almeja japónica'],
    ['PIMIENTO PADRON BOLSA 500G', 'Pimiento de Padrón'],
    ['VINO TINTO RIOJA CRIANZA 75CL', 'Vino tinto Rioja crianza'],
    ['NATA PARA MONTAR 35% 1L', 'Nata para montar'],
    ['SAL Y PIMIENTA', 'Sal y pimienta'],
    ['DULCE DE LECHE 1KG', 'Dulce de leche'],
  ])('%s → %s', (input, expected) => {
    expect(cleanProductName(input)).toBe(expected);
  });

  it('devuelve cadena vacía si sólo hay formato', () => {
    expect(cleanProductName('CAJA 6KG')).toBe('');
    expect(cleanProductName('')).toBe('');
  });

  it('el nombre limpio empareja con la descripción original', () => {
    for (const d of ['TOMATE PERA CAT.I CAJA 6KG', 'ACEITE OLIVA V.E. GARRAFA 5L', 'SOLOMILLO TERNERA NAC. KG', 'MANT. SIN SAL 250G']) {
      expect(similarity(cleanProductName(d), d)).toBe(1);
    }
  });
});
