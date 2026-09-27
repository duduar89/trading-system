/**
 * Contenido procedural de una carta de restaurante española (platos, descripciones, precios, secciones, vinos, cabecera
 * y pie) a partir de una semilla. Mezcla nombres de la base de recetas local (src/kb, con sus alias) con nombres
 * compuestos al azar (formas, ingredientes de la base, estilos, lugares y términos de cocina que NO están en el
 * diccionario de la app), para no medir sólo lo que el diccionario ya conoce.
 *
 * Reglas de la verdad de referencia (las de la app): con media ración / ración el PVP es el de la ración completa; con
 * copa / botella, el de la botella; iconos, códigos y números de alérgenos no forman parte del nombre.
 */

/** Secciones posibles: rótulos habituales y creativos, secciones de la base de recetas y horquilla de precios. */
export const SECTIONS = {
  entrantes: {
    labels: ['Entrantes', 'Para empezar', 'Para compartir', 'Para abrir boca', 'Entrantes fríos', 'Entrantes calientes', 'Picoteo', 'Para picar', 'Aperitivos', 'Primeros', 'Al centro de la mesa'],
    kb: ['Entrantes', 'Tapas', 'Raciones', 'Ensaladas'],
    price: [5.5, 17],
  },
  tapas: {
    labels: ['Tapas', 'Tapas frías', 'Tapas calientes', 'Raciones', 'De barra', 'Para picotear', 'Nuestras tapas', 'Pinchos', 'Tapas y raciones'],
    kb: ['Tapas', 'Raciones'],
    price: [3, 14],
    multi: true,
  },
  ensaladas: { labels: ['Ensaladas', 'Del huerto', 'Verdes', 'De la huerta', 'Ensaladas y verduras', 'Frescos'], kb: ['Ensaladas'], price: [8, 15] },
  sopas: { labels: ['Sopas y cremas', 'Cuchara', 'Platos de cuchara', 'Cremas', 'Del puchero'], kb: ['Sopas y cremas'], price: [6, 13] },
  arroces: { labels: ['Arroces', 'Arroces y fideuás', 'Nuestros arroces', 'Arroces (mín. 2 personas)', 'Del paellero'], kb: ['Arroces'], price: [13, 24] },
  pastas: { labels: ['Pastas', 'Pasta fresca', 'Pastas y risottos', 'Pasta'], kb: ['Pastas'], price: [10, 18] },
  pizzas: { labels: ['Pizzas', 'Nuestras pizzas', 'Pizzas artesanas', 'Del horno de leña'], kb: ['Pizzas'], price: [9, 16] },
  carnes: { labels: ['Carnes', 'De la tierra', 'Carnes a la brasa', 'Al carbón', 'Brasa', 'Nuestras carnes', 'Principales', 'Segundos'], kb: ['Carnes'], price: [14, 34] },
  pescados: { labels: ['Pescados', 'Del mar', 'De la lonja', 'Pescados y mariscos', 'Nuestros pescados', 'Del Cantábrico'], kb: ['Pescados'], price: [15, 32] },
  mariscos: { labels: ['Mariscos', 'Marisco', 'De la cetárea', 'Mariscos y moluscos'], kb: ['Mariscos'], price: [12, 45] },
  huevos: { labels: ['Huevos', 'Huevos y revueltos', 'Revueltos', 'Huevos camperos'], kb: ['Huevos'], price: [8, 15] },
  bocadillos: { labels: ['Bocadillos', 'Hamburguesas', 'Bocadillos y hamburguesas', 'Montaditos', 'Entre panes'], kb: ['Bocadillos y hamburguesas'], price: [4.5, 15] },
  postres: { labels: ['Postres', 'Postres caseros', 'Dulces', 'Lo más dulce', 'Para terminar', 'El final feliz', 'Nuestros postres'], kb: ['Postres'], price: [4, 9] },
  cafes: { labels: ['Cafés', 'Cafés e infusiones', 'Cafetería'], kb: ['Cafés'], price: [1.2, 4] },
  bebidas: { labels: ['Bebidas', 'Refrescos', 'Cervezas', 'Bebidas y refrescos'], kb: ['Bebidas'], price: [1.5, 6] },
  cocteles: { labels: ['Cócteles', 'Combinados', 'Copas', 'Coctelería'], kb: ['Cócteles'], price: [7, 12] },
  tintos: { labels: ['Vinos tintos', 'Tintos', 'Nuestros tintos'], wine: 'tinto', price: [14, 58] },
  blancos: { labels: ['Vinos blancos', 'Blancos', 'Nuestros blancos'], wine: 'blanco', price: [13, 45] },
  rosados: { labels: ['Rosados', 'Vinos rosados'], wine: 'rosado', price: [13, 30] },
  espumosos: { labels: ['Cavas y espumosos', 'Espumosos', 'Cavas', 'Burbujas'], wine: 'espumoso', price: [16, 70] },
};

/** Conceptos de restaurante: secuencias de secciones (una alternativa por posición; null = opcional ausente). */
const CONCEPTS = {
  bistro: [['entrantes'], ['ensaladas', null], ['carnes'], ['pescados'], ['postres'], ['tintos', null]],
  taberna: [['tapas'], ['entrantes', 'huevos'], ['bocadillos', null], ['postres']],
  asador: [['entrantes'], ['carnes'], ['pescados', null], ['postres'], ['tintos'], ['blancos', null]],
  marisqueria: [['entrantes'], ['mariscos'], ['pescados'], ['arroces', null], ['postres', null], ['blancos', null]],
  pizzeria: [['entrantes'], ['ensaladas'], ['pizzas'], ['pastas'], ['postres'], ['bebidas', null]],
  cafeteria: [['bocadillos'], ['huevos', null], ['postres'], ['cafes'], ['bebidas']],
  vinoteca: [['tapas'], ['entrantes', null], ['tintos'], ['blancos'], ['espumosos', 'rosados', null]],
  fusion: [['entrantes'], ['pescados', 'carnes'], ['carnes', null], ['postres'], ['cocteles', null]],
  tradicional: [['entrantes'], ['sopas', null], ['arroces', null], ['carnes'], ['pescados'], ['postres'], ['cafes', null]],
};

// ───────────────────────────── Nombres compuestos ─────────────────────────────

/** Formas de plato (género para concordar adjetivos). */
const FORMS = [
  ['Tosta', 'f'], ['Montadito', 'm'], ['Bao', 'm'], ['Tacos', 'mp'], ['Tartar', 'm'], ['Carpaccio', 'm'], ['Tataki', 'm'], ['Tiradito', 'm'],
  ['Poke', 'm'], ['Gyozas', 'fp'], ['Croquetas', 'fp'], ['Canelón', 'm'], ['Brioche', 'm'], ['Bikini', 'm'], ['Coca', 'f'], ['Brocheta', 'f'],
  ['Raviolis', 'mp'], ['Nigiris', 'mp'], ['Buñuelos', 'mp'], ['Timbal', 'm'], ['Milhojas', 'm'], ['Lingote', 'm'], ['Pastel', 'm'],
  ['Terrina', 'f'], ['Crema', 'f'], ['Tartaleta', 'f'], ['Sándwich', 'm'], ['Hamburguesa', 'f'], ['Lomo', 'm'], ['Guiso', 'm'],
  ['Carrillada', 'f'], ['Ensalada', 'f'], ['Parrillada', 'f'], ['Salteado', 'm'], ['Empanadillas', 'fp'], ['Cazuelita', 'f'], ['Flauta', 'f'],
  ['Rulo', 'm'], ['Tempura', 'f'], ['Cannoli', 'mp'], ['Taquitos', 'mp'], ['Arroz meloso', 'm'], ['Fideuá', 'f'], ['Risotto', 'm'],
];
const ADJ = {
  m: ['casero', 'crujiente', 'glaseado', 'ahumado', 'templado', 'marinado', 'confitado', 'asado', 'meloso', 'trufado', 'especiado', 'tostado'],
  f: ['casera', 'crujiente', 'glaseada', 'ahumada', 'templada', 'marinada', 'confitada', 'asada', 'melosa', 'trufada', 'especiada', 'tostada'],
};
const STYLES = [
  'a baja temperatura', 'a la brasa', 'con su jugo', 'en tempura', 'al carbón', 'al pil pil', 'con reducción de Pedro Ximénez', 'en escabeche',
  'a la mostaza antigua', 'con toque de wasabi', 'a la sal', 'al horno de leña', 'con salsa de yuzu', 'con kimchi', 'con chimichurri',
  'con salsa ponzu', 'al curry rojo', 'con mayonesa de sriracha', 'con harissa', 'con salsa teriyaki', 'con tzatziki', 'con alioli de ajo negro',
  'al estilo tailandés', 'a la parmesana', 'con salsa romesco', 'con mojo picón', 'con salsa brava', 'en su tinta', 'a la bilbaína',
  'con emulsión de ajo', 'y crujiente de ibérico', 'con migas del pastor', 'de la casa', 'de temporada', 'al vermut', 'con praliné de avellana',
];
const PLACES = ['Kyoto', 'Oaxaca', 'Lima', 'Bangkok', 'Nápoles', 'Sarrià', 'Getaria', 'Lekeitio', 'Sóller', 'Tolosa', 'Mazarrón', 'Chiclana', 'Tudela', 'Laredo', 'Busan', 'Hanói', 'Bari'];
const PEOPLE = ['Rosa', 'Pepa', 'Carmen', 'Manolo', 'Juanita', 'Tomás', 'Maruja', 'Nieves', 'Lola', 'Paco', 'Amparo', 'Ginés'];
/** Términos de cocina y productos fuera del diccionario de la app (la extracción no debe tirarlos por desconocidos). */
const EXOTIC = [
  'wagyu', 'txuleta', 'shiitake', 'yuzu', 'katsuobushi', 'mochi', 'kataifi', 'ssamjang', 'nduja', 'stracciatella', 'kombu', 'furikake', 'panko',
  'gochujang', 'miso', 'tahini', 'labneh', 'guanciale', 'pastrami', 'chipotle', 'jalapeño', 'kale', 'pak choi', 'edamame', 'wakame', 'nori',
  'mole poblano', 'dashi', 'ras el hanout', 'zaatar', 'sumac', 'shichimi', 'cecina', 'sobrasada', 'torta del Casar', 'Idiazábal', 'Cabrales',
];
const SHORT_WORD_TAILS = ['al té matcha', 'de oca', 'al ron', 'con ajo', 'de mar', 'de pato', 'con pan', 'de ave', 'con miel', 'al oporto', 'de kiwi'];

/** Descripciones libres (con cifras a veces: la extracción no debe tomarlas por precios). */
const FREE_DESCS = [
  'Receta tradicional de la casa', 'Elaborado al momento', 'Pieza de 400 g aprox.', 'Seis unidades', '6 unidades', 'Para compartir (2 personas)',
  'Nuestra receta de siempre', 'Según temporada', 'Cocinado durante 12 horas', 'Madurada 45 días', 'Con pan de masa madre',
  'Mínimo 2 personas', 'Servido con patatas fritas caseras', 'Elaboración artesana', 'Producto de proximidad', 'Pregunta por la pieza del día',
];

const CONNECT = ['Con ', '', 'Acompañado de ', 'Sobre ', 'Servido con ', 'Con ', ''];
const SKIP_ITEM = /^(?:sal|agua|aceite|pimienta|harina|az[uú]car|levadura|vinagre|caldo|fumet|hielo|mantequilla|margarina)\b/i;

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
function upperFirst(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function listEs(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${/^[iI]/.test(items[items.length - 1]) ? 'e' : 'y'} ${items[items.length - 1]}`;
}
export function foldKey(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

// ───────────────────────────── Precios ─────────────────────────────

/** Céntimos habituales en cartas españolas. */
const CENTS = { 0: 0.34, 0.5: 0.3, 0.9: 0.1, 0.95: 0.05, 0.2: 0.05, 0.8: 0.05, 0.25: 0.03, 0.75: 0.03, 0.6: 0.03, 0.4: 0.02 };

function roundTo(v, granularity, rng) {
  if (granularity === 'int') return Math.max(1, Math.round(v));
  if (granularity === 'half') return Math.max(0.5, Math.round(v * 2) / 2);
  const base = Math.floor(v);
  const c = Number(rng.weighted(CENTS));
  return Math.max(0.5, Math.round((base + c) * 100) / 100);
}

function priceIn(range, granularity, rng) {
  const [a, b] = range;
  // Sesgo hacia la parte baja de la horquilla (más platos baratos que caros)
  const v = a + (b - a) * rng.next() ** 1.4;
  return roundTo(v, granularity, rng);
}

// ───────────────────────────── Platos ─────────────────────────────

function ingredientPool(kb, cats) {
  return kb.ingredients.filter((i) => cats.includes(i.category) && i.name.split(' ').length <= 3 && !/\d/.test(i.name)).map((i) => lowerFirst(i.name));
}

function describeRecipe(recipe, rng) {
  const items = recipe.items.map((it) => it.name).filter((n) => !SKIP_ITEM.test(n) && n.split(' ').length <= 4);
  const chosen = rng.sample(items, rng.int(2, Math.min(4, Math.max(2, items.length))));
  if (!chosen.length) return rng.pick(FREE_DESCS);
  return upperFirst(`${rng.pick(CONNECT)}${listEs(chosen.map(lowerFirst))}`.trim());
}

function describeFree(pools, rng) {
  const r = rng.next();
  if (r < 0.25) return rng.pick(FREE_DESCS);
  const n = rng.int(2, 3);
  const items = rng.sample([...pools.veg, ...pools.other, ...rng.sample(EXOTIC, 2)], n);
  const lead = rng.pick(CONNECT);
  let d = `${lead}${listEs(items)}`.trim();
  if (rng.chance(0.25)) d += rng.pick([', al gusto', ' y un toque de lima', ' sobre pan tostado', ' con aceite de oliva virgen extra']);
  return upperFirst(d);
}

function creativeName(pools, rng) {
  const [form, g] = rng.pick(FORMS);
  const gender = g.startsWith('f') ? 'f' : 'm';
  const plural = g.endsWith('p');
  const main = rng.chance(0.25) ? rng.pick(EXOTIC) : rng.pick(rng.chance(0.5) ? pools.protein : pools.other);
  let name = `${form} de ${main}`;
  const r = rng.next();
  if (r < 0.3) {
    let adj = rng.pick(ADJ[gender]);
    if (plural) adj += 's';
    name = rng.chance(0.5) ? `${form} ${adj} de ${main}` : `${name} ${adj}`;
  } else if (r < 0.65) name += ` ${rng.pick(STYLES)}`;
  else if (r < 0.75) name += ` estilo ${rng.pick(PLACES)}`;
  else if (r < 0.83) name += ` de la abuela ${rng.pick(PEOPLE)}`;
  else if (r < 0.9) name += ` ${rng.pick(SHORT_WORD_TAILS)}`;
  return name;
}

function kbName(recipe, rng, plain = false) {
  const aliases = (recipe.aliases ?? []).filter((a) => a.split(' ').length >= 1 && a.length >= 4 && !/\d/.test(a));
  let name = aliases.length && rng.chance(0.3) ? rng.pick(aliases) : recipe.name;
  name = upperFirst(name);
  if (plain) return name;
  const r = rng.next();
  if (r < 0.1) name += ` ${rng.pick(['caseras', 'de la casa', 'de temporada', 'tradicional', 'a nuestro estilo', 'al momento'])}`;
  else if (r < 0.16) name += ` ${rng.pick(['(6 uds)', '(8 uds.)', '(4 piezas)', '(300 g)', '(1 kg)', '(2 pax)', '(½ kg)'])}`;
  else if (r < 0.22) name += ` ${rng.pick(STYLES)}`;
  return name;
}

// ───────────────────────────── Vinos ─────────────────────────────

const WINE_PREFIX = ['Viña', 'Pago de', 'Finca', 'Castillo de', 'Marqués de', 'Señorío de', 'Casa', 'Clos', 'Mas', 'Dominio de', 'Hacienda', 'Torre de', 'Valle de'];
const SYL_A = ['Val', 'Ar', 'Mon', 'Ri', 'Can', 'Bel', 'Tor', 'San', 'Mira', 'Al', 'Or', 'Villa', 'Ca', 'Pe', 'Sol', 'Lu'];
const SYL_B = ['dor', 'bera', 'tesa', 'lanza', 'medo', 'rena', 'cebo', 'luna', 'vera', 'moral', 'tarro', 'bán', 'riel', 'mar', 'lago', 'tino'];
const WINE_TYPE = { tinto: ['Crianza', 'Reserva', 'Roble', 'Joven', 'Gran Reserva', 'Selección', 'Barrica', ''], blanco: ['Blanco', 'Fermentado en barrica', 'Joven', 'Lías', ''], rosado: ['Rosado', 'Lágrima', ''], espumoso: ['Brut Nature', 'Brut', 'Reserva Brut', 'Extra Brut', 'Gran Reserva'] };
const DOS = {
  tinto: ['Rioja', 'Ribera del Duero', 'Toro', 'Priorat', 'Bierzo', 'Somontano', 'Jumilla', 'Montsant', 'Navarra', 'Méntrida', 'La Mancha'],
  blanco: ['Rueda', 'Rías Baixas', 'Valdeorras', 'Txakoli de Getaria', 'Penedès', 'Rioja', 'Ribeiro'],
  rosado: ['Navarra', 'Cigales', 'Rioja', 'Somontano'],
  espumoso: ['Cava', 'Corpinnat', 'Penedès'],
};
const GRAPES = {
  tinto: ['Tempranillo', 'Garnacha', 'Mencía', 'Monastrell', 'Cabernet Sauvignon', 'Syrah', 'Graciano', 'Bobal'],
  blanco: ['Verdejo', 'Albariño', 'Godello', 'Hondarrabi Zuri', 'Xarel·lo', 'Chardonnay', 'Treixadura'],
  rosado: ['Garnacha', 'Tempranillo', 'Prieto Picudo'],
  espumoso: ['Macabeo', 'Xarel·lo', 'Parellada', 'Chardonnay'],
};

function wineEntry(kind, rng) {
  const coined = `${rng.pick(SYL_A)}${rng.pick(SYL_B)}`;
  let name = `${rng.pick(WINE_PREFIX)} ${coined}`.replace(/ de ([AEIOU])/, ' de $1');
  const type = rng.pick(WINE_TYPE[kind]);
  if (type) name += ` ${type}`;
  if (rng.chance(0.3) && kind !== 'espumoso') name += ` ${rng.int(2014, 2023)}`;
  const doName = rng.pick(DOS[kind]);
  const grape = rng.pick(GRAPES[kind]);
  const desc = rng.pick([`D.O. ${doName} · ${grape}`, grape, `${grape} · ${rng.int(6, 18)} meses en barrica`, `${doName}. ${grape}`, `${grape} y ${rng.pick(GRAPES[kind])}`]);
  return { name, desc, doName };
}

// ───────────────────────────── Carta completa ─────────────────────────────

const REST_A = ['Casa', 'Taberna', 'El Rincón de', 'Bistró', 'Mesón', 'La Cocina de', 'Bar', 'Restaurante', 'Tasca', 'La Bodeguilla de', 'Asador', 'Trattoria'];
const REST_B = ['Martina', 'El Olivo', 'Los Arcos', 'Candela', 'Aurelio', 'La Lonja', 'Azafrán', 'El Puerto', 'Remedios', 'Salitre', 'Nogal', 'Brasas', 'Alcaraván', 'Ultramar'];
const TAGLINES = ['Cocina de mercado', 'Desde 1978', 'Tapas y vinos', 'Cocina tradicional', 'Producto y brasa', 'Cocina de autor', 'Fundado en 1995', 'Sabores de siempre', 'Carta de temporada', 'Cocina mediterránea'];
const STREETS = ['Mayor', 'del Carmen', 'San Juan', 'de la Paz', 'Real', 'Libertad', 'Cervantes', 'del Mar', 'Alfonso XII', 'Santa Ana'];
const CITIES = ['Madrid', 'Valencia', 'Sevilla', 'Bilbao', 'Zaragoza', 'Málaga', 'Murcia', 'Burgos', 'Gijón', 'Cádiz', 'Logroño', 'Segovia'];

function footerNotes(rng, restaurant) {
  const notes = [];
  const cp = `${rng.pick(['28', '46', '41', '48', '50', '29', '30', '09', '33', '11', '26', '40'])}0${rng.int(10, 99)}`;
  const phone = `9${rng.int(1, 8)}${rng.int(1, 9)} ${rng.int(100, 999)} ${rng.int(100, 999)}`;
  const pool = [
    () => `C/ ${rng.pick(STREETS)}, ${rng.int(1, 120)} · ${cp} ${rng.pick(CITIES)}`,
    () => `Reservas: ${phone}`,
    () => `Tel. ${phone}`,
    () => rng.pick(['IVA incluido', 'Precios con IVA incluido', 'Precios en euros. IVA incluido', 'Todos nuestros precios incluyen IVA']),
    () => rng.pick(['Si tienes alguna alergia o intolerancia, consulta a nuestro personal', 'Disponemos de información sobre alérgenos. Consulte a nuestro personal', 'Consulta la carta de alérgenos']),
    () => `Pan y aperitivo ${rng.pick(['1,50', '1,80', '2,00', '1,20'])} € por persona`,
    () => `@${foldKey(restaurant).replace(/\s+/g, '')}`,
    () => `Abierto de martes a domingo de 13:00 a 16:30 y de 20:00 a 23:30`,
    () => `www.${foldKey(restaurant).replace(/\s+/g, '')}.es`,
  ];
  for (const f of rng.sample(pool, rng.int(1, 4))) notes.push(f());
  return notes;
}

/**
 * Genera el contenido de una carta. `kb` = { recipes, ingredients } de la base de conocimiento local.
 * Devuelve { restaurant, tagline, concept, granularity, sections: [{ key, label, wine, multi, dishes: [{ name, price,
 * prices?, desc? }] }], footer }.
 */
export function generateContent(rng, kb) {
  const concept = rng.pick(Object.keys(CONCEPTS));
  const restaurant = `${rng.pick(REST_A)} ${rng.pick(REST_B)}`;
  const granularity = rng.weighted({ int: 0.25, half: 0.25, cents: 0.5 });
  const pools = {
    protein: ingredientPool(kb, ['carne', 'pescado', 'marisco']),
    veg: ingredientPool(kb, ['verdura', 'fruta']),
    other: ingredientPool(kb, ['lacteo', 'verdura', 'fruta', 'charcuteria', 'legumbre', 'conserva']),
  };
  if (pools.other.length < 20) pools.other = ingredientPool(kb, [...new Set(kb.ingredients.map((i) => i.category))]);
  if (!pools.veg.length) pools.veg = pools.other;
  if (!pools.protein.length) pools.protein = pools.other;

  const keys = CONCEPTS[concept].map((alts) => rng.pick(alts)).filter(Boolean);
  const creativeRate = concept === 'fusion' ? 0.7 : rng.pick([0.1, 0.25, 0.4]);
  const descRate = rng.pick([0, 0.15, 0.4, 0.7, 0.9]);
  const used = new Set();
  const sections = [];
  const labelsUsed = new Set();
  for (const key of [...new Set(keys)]) {
    const def = SECTIONS[key];
    let label = rng.pick(def.labels);
    if (labelsUsed.has(label)) label = def.labels.find((l) => !labelsUsed.has(l)) ?? `${label} ·`;
    labelsUsed.add(label);
    const n = def.wine ? rng.int(3, 7) : rng.int(3, 8);
    const dishes = [];
    const recipes = def.kb ? kb.recipes.filter((r) => def.kb.includes(r.section)) : [];
    const drinks = ['bebidas', 'cafes', 'cocteles'].includes(key);
    for (let k = 0, guard = 0; k < n && guard < 60; guard++) {
      let name;
      let desc;
      let extra = {};
      if (def.wine) {
        const w = wineEntry(def.wine, rng);
        name = w.name;
        desc = rng.chance(0.75) ? w.desc : undefined;
        extra = { doName: w.doName };
      } else if (recipes.length && (drinks || !rng.chance(creativeRate))) {
        const recipe = rng.pick(recipes);
        name = kbName(recipe, rng, drinks);
        if (rng.chance(descRate)) desc = rng.chance(0.8) ? describeRecipe(recipe, rng) : rng.pick(FREE_DESCS);
      } else {
        name = upperFirst(creativeName(pools, rng));
        if (rng.chance(descRate)) desc = describeFree(pools, rng);
      }
      const key2 = foldKey(name);
      if (used.has(key2) || name.length > 64) continue;
      used.add(key2);
      const price = priceIn(def.price, def.wine && granularity === 'cents' ? 'half' : granularity, rng);
      dishes.push({ name, price, ...(desc ? { desc } : {}), ...extra });
      k++;
    }
    sections.push({ key, label, wine: !!def.wine, multiCandidate: !!def.multi || !!def.wine, dishes });
  }
  return { restaurant, tagline: rng.pick(TAGLINES), concept, granularity, sections, footer: footerNotes(rng, restaurant) };
}

/**
 * Precios de columnas (media ración / ración, copa / botella) para una sección: devuelve los precios impresos por plato
 * de izquierda a derecha; el último es el de la ración completa / botella (la verdad de referencia).
 */
export function columnPrices(dish, kind, granularity, rng) {
  if (kind === 'wine') {
    const copa = roundTo(Math.max(2.2, dish.price / rng.float(4.5, 6)), granularity === 'int' ? 'int' : 'half', rng);
    return copa < dish.price ? [copa, dish.price] : [dish.price];
  }
  const half = roundTo(dish.price * rng.float(0.52, 0.68), granularity, rng);
  return half < dish.price ? [half, dish.price] : [dish.price];
}
