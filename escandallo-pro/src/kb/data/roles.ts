import type { QtyBasis, QtyUnit } from '../../types';
import type { KbIngredient } from '../ingredients';
import type { ItemTuple } from './build';

/**
 * Reglas de rol y gramaje para la propuesta heurística (sin receta tipo):
 * qué papel juega cada ingrediente en el plato y cuánto se pone por ración.
 */

export type RoleGroup =
  | 'protein'
  | 'cheese'
  | 'veg'
  | 'legume'
  | 'herb'
  | 'spice'
  | 'sauce'
  | 'fat'
  | 'dairy'
  | 'coating'
  | 'starch'
  | 'bread'
  | 'nut'
  | 'sweet'
  | 'drink'
  | 'stock'
  | 'other';

const HERBS = new Set(['Perejil', 'Cilantro', 'Albahaca', 'Hierbabuena', 'Eneldo', 'Cebollino', 'Estragón', 'Romero', 'Tomillo', 'Salvia', 'Microbrotes']);
const CHEESES = new Set([
  'Burrata', 'Mozzarella', 'Mozzarella de búfala', 'Stracciatella', 'Mascarpone', 'Ricotta', 'Parmesano', 'Grana padano', 'Pecorino', 'Provolone', 'Halloumi',
  'Torta del Casar', 'Queso crema',
]);
const NUTS = new Set([
  'Almendra marcona', 'Almendra laminada', 'Almendra molida', 'Avellana', 'Nuez', 'Pistacho', 'Anacardo', 'Nuez de macadamia', 'Piñón', 'Cacahuete',
  'Pipas de calabaza', 'Castaña',
]);
const COATINGS = new Set(['Harina de trigo', 'Harina de fuerza', 'Harina para freír', 'Harina de garbanzo', 'Harina de maíz', 'Maicena', 'Pan rallado', 'Panko', 'Harina de tempura', 'Sémola de trigo']);
const SAUCE_CONDIMENTS = new Set([
  'Mayonesa', 'Alioli', 'Ketchup', 'Mostaza de Dijon', 'Mostaza antigua', 'Salsa de soja', 'Salsa Perrins', 'Tabasco', 'Sriracha', 'Salsa de chile dulce', 'Miso',
  'Tahini', 'Salsa barbacoa', 'Salsa de ostras', 'Salsa teriyaki', 'Salsa hoisin', 'Salsa de pescado', 'Salsa César', 'Pesto', 'Guacamole', 'Vinagre de vino',
  'Vinagre de Jerez', 'Vinagre de Módena', 'Reducción de Módena', 'Vinagre de manzana', 'Vinagre de arroz', 'Cebolla frita crujiente', 'Pastilla de caldo',
  'Tomate frito', 'Tomate triturado', 'Tomate concentrado', 'Tomate rallado',
]);
const VEG_FROZEN_OR_CANNED = new Set([
  'Guisante', 'Habitas baby', 'Edamame', 'Menestra de verduras congelada', 'Boletus congelado', 'Patata prefrita congelada', 'Frutos rojos congelados', 'Garbanzo cocido',
  'Altramuces', 'Pimiento del piquillo', 'Pimiento asado en conserva', 'Pimiento choricero', 'Piparras', 'Jalapeño', 'Pepinillo', 'Alcaparras', 'Aceituna verde',
  'Aceituna negra', 'Aceituna Kalamata', 'Corazones de alcachofa', 'Espárrago blanco', 'Maíz dulce', 'Pisto', 'Tomate seco', 'Algas wakame', 'Alga nori', 'Kimchi',
]);
const STARCHES = new Set([
  'Arroz redondo', 'Arroz bomba', 'Arroz basmati', 'Arroz carnaroli', 'Arroz para sushi', 'Espaguetis', 'Macarrones', 'Pasta seca', 'Tallarines', 'Pasta fresca al huevo',
  'Fideos', 'Placas de lasaña', 'Placas de canelones', 'Raviolis rellenos', 'Gnocchi', 'Fideos de arroz', 'Noodles de trigo', 'Cuscús', 'Quinoa', 'Copos de avena',
]);
/** Pastas (el tipo de pasta del nombre sustituye a la pasta genérica del marco "pasta"). */
export const PASTAS = new Set([
  'Espaguetis', 'Macarrones', 'Pasta seca', 'Tallarines', 'Pasta fresca al huevo', 'Fideos', 'Placas de lasaña', 'Placas de canelones', 'Raviolis rellenos', 'Gnocchi',
  'Fideos de arroz', 'Noodles de trigo',
]);
const STOCKS = new Set(['Fumet de pescado', 'Caldo de pollo', 'Fondo oscuro', 'Caldo de verduras']);
const COOKING_DRINKS = new Set(['Vino tinto joven', 'Vino blanco', 'Vino de Oporto', 'Vino fino', 'Pedro Ximénez', 'Brandy', 'Sidra natural', 'Cava', 'Cerveza de barril']);

/** Papel culinario de un ingrediente de la base. */
export function roleGroup(ing: KbIngredient): RoleGroup {
  const n = ing.name;
  if (HERBS.has(n)) return 'herb';
  if (CHEESES.has(n) || (ing.category === 'lacteo' && n.startsWith('Queso'))) return 'cheese';
  if (NUTS.has(n)) return 'nut';
  if (COATINGS.has(n)) return 'coating';
  if (STARCHES.has(n)) return 'starch';
  if (STOCKS.has(n)) return 'stock';
  if (SAUCE_CONDIMENTS.has(n)) return 'sauce';
  if (VEG_FROZEN_OR_CANNED.has(n)) return n === 'Garbanzo cocido' || n === 'Altramuces' ? 'legume' : 'veg';
  switch (ing.category) {
    case 'carne':
    case 'pescado':
    case 'marisco':
    case 'charcuteria':
    case 'huevo':
      return 'protein';
    case 'verdura':
    case 'fruta':
      return 'veg';
    case 'legumbre':
      return n === 'Tofu' ? 'protein' : 'legume';
    case 'lacteo':
      return 'dairy';
    case 'aceite':
      return 'fat';
    case 'condimento':
      return 'spice';
    case 'panaderia':
      return 'bread';
    case 'dulce':
      return 'sweet';
    case 'bebida':
      return 'drink';
    case 'congelado':
      if (ing.allergens.some((a) => a === 'crustaceos' || a === 'moluscos' || a === 'pescado')) return 'protein';
      if (n === 'Helado de vainilla' || n === 'Sorbete de limón') return 'sweet';
      if (n === 'Masa de croissant congelada') return 'bread';
      return 'protein';
    case 'conserva':
      if (ing.allergens.some((a) => a === 'crustaceos' || a === 'moluscos' || a === 'pescado')) return 'protein';
      return 'veg';
    case 'cereal':
      return 'starch';
    case 'otros':
      return n === 'Hielo' ? 'other' : 'stock';
    default:
      return 'other';
  }
}

/** Ingredientes de proteína "noble" que pueden ser el principal del plato. */
export function isMainCandidate(group: RoleGroup): boolean {
  return group === 'protein' || group === 'cheese';
}

export type QtySpec = [quantity: number, unit: QtyUnit, basis?: QtyBasis];

/** Gramaje del ingrediente principal por ración (neto crudo salvo indicación). */
export function mainQty(ing: KbIngredient, group: RoleGroup): QtySpec {
  const o = MAIN_OVERRIDES[ing.name];
  if (o) return o;
  // Huevos: 2 por ración; los pasteurizados (a granel) en gramos
  if (ing.category === 'huevo') return ing.baseUnit === 'ud' ? [2, 'ud', 'bruta'] : [100, 'g'];
  if (ing.baseUnit === 'ud') return [1, 'ud', 'bruta'];
  switch (group) {
    case 'protein':
      if (ing.category === 'charcuteria') return [80, 'g'];
      if (ing.category === 'pescado' || (ing.category === 'conserva' && ing.allergens.includes('pescado'))) return [170, 'g'];
      if (ing.category === 'marisco' || ing.allergens.some((a) => a === 'crustaceos' || a === 'moluscos')) return [150, 'g'];
      return [180, 'g'];
    case 'cheese':
      return [80, 'g'];
    case 'legume':
      return [80, 'g'];
    case 'starch':
      return [100, 'g'];
    case 'veg':
      return [200, 'g'];
    case 'drink':
      return drinkQty(ing);
    default:
      return [150, 'g'];
  }
}

/** Gramaje como ingrediente secundario (acompañamiento, salsa, aderezo…). */
export function secondaryQty(ing: KbIngredient, group: RoleGroup): QtySpec {
  const o = SECONDARY_OVERRIDES[ing.name];
  if (o) return o;
  const liquid = ing.baseUnit === 'l';
  if (ing.category === 'huevo') return ing.baseUnit === 'ud' ? [1, 'ud', 'bruta'] : [20, 'g'];
  if (ing.baseUnit === 'ud') return [1, 'ud', 'bruta'];
  switch (group) {
    case 'protein':
      if (ing.category === 'charcuteria') return [30, 'g'];
      return [60, 'g'];
    case 'cheese':
      return [30, 'g'];
    case 'veg':
      return [100, 'g'];
    case 'legume':
      return [60, 'g'];
    case 'herb':
      return [3, 'g'];
    case 'spice':
      return [1, 'g'];
    case 'sauce':
      return [30, liquid ? 'ml' : 'g'];
    case 'fat':
      return [10, liquid ? 'ml' : 'g'];
    case 'dairy':
      return liquid ? [50, 'ml'] : [15, 'g'];
    case 'coating':
      return [20, 'g'];
    case 'starch':
      return [70, 'g'];
    case 'bread':
      return [40, 'g'];
    case 'nut':
      return [15, 'g'];
    case 'sweet':
      return [15, liquid ? 'ml' : 'g'];
    case 'drink':
      return COOKING_DRINKS.has(ing.name) ? [50, 'ml'] : drinkQty(ing);
    case 'stock':
      return [150, 'ml'];
    default:
      return [liquid ? 50 : 30, liquid ? 'ml' : 'g'];
  }
}

/** Cantidad servida de una bebida (copa, caña, combinado…). */
export function drinkQty(ing: KbIngredient): QtySpec {
  const n = ing.name;
  if (n === 'Café en grano') return [7, 'g'];
  if (n === 'Café soluble') return [2, 'g'];
  if (n === 'Té') return [1, 'ud', 'bruta'];
  if (n.startsWith('Cerveza')) return n === 'Cerveza de barril' ? [200, 'ml'] : [330, 'ml'];
  if (n === 'Agua mineral' || n === 'Agua con gas') return [500, 'ml'];
  if (['Ginebra', 'Ron', 'Whisky', 'Vodka', 'Tequila', 'Brandy', 'Licor de hierbas', 'Pacharán', 'Anís', 'Licor de naranja', 'Amaretto', 'Licor de café', 'Crema de whisky', 'Licor 43'].includes(n)) {
    return [50, 'ml'];
  }
  if (n === 'Vermut rojo') return [90, 'ml'];
  if (n === 'Cava' || n === 'Champán') return [120, 'ml'];
  if (n === 'Vino fino' || n === 'Pedro Ximénez' || n === 'Vino de Oporto') return [100, 'ml'];
  if (n.startsWith('Vino') || n === 'Albariño') return [150, 'ml'];
  return [200, 'ml'];
}

/** ¿Es un destilado que se sirve combinado (añade hielo y refresco)? */
export function isSpirit(ing: KbIngredient): boolean {
  return ['Ginebra', 'Ron', 'Whisky', 'Vodka', 'Tequila'].includes(ing.name);
}

/** ¿Es un refresco o mezclador? */
export function isMixer(ing: KbIngredient): boolean {
  return ['Tónica', 'Refresco de cola', 'Refresco de limón', 'Refresco de naranja', 'Gaseosa', 'Ginger ale', 'Agua con gas', 'Zumo de naranja', 'Zumo de piña', 'Zumo de tomate'].includes(ing.name);
}

const MAIN_OVERRIDES: Record<string, QtySpec> = {
  // Pescado y marisco entero o con cáscara (en bruto, como se compra)
  Lubina: [500, 'g', 'bruta'],
  'Lubina salvaje': [500, 'g', 'bruta'],
  Dorada: [500, 'g', 'bruta'],
  Rodaballo: [450, 'g', 'bruta'],
  Lenguado: [400, 'g', 'bruta'],
  Besugo: [450, 'g', 'bruta'],
  Pargo: [450, 'g', 'bruta'],
  Corvina: [450, 'g', 'bruta'],
  Salmonete: [350, 'g', 'bruta'],
  Trucha: [350, 'g', 'bruta'],
  'Merluza entera': [350, 'g', 'bruta'],
  'Rape entero': [450, 'g', 'bruta'],
  'Salmón entero': [300, 'g', 'bruta'],
  Sardina: [300, 'g', 'bruta'],
  Boquerón: [200, 'g'],
  Caballa: [300, 'g', 'bruta'],
  Jurel: [300, 'g', 'bruta'],
  'Gamba roja': [200, 'g', 'bruta'],
  'Gamba blanca': [200, 'g', 'bruta'],
  Carabinero: [250, 'g', 'bruta'],
  Cigala: [250, 'g', 'bruta'],
  'Langostino crudo': [250, 'g', 'bruta'],
  'Langostino cocido': [250, 'g', 'bruta'],
  'Langostino tigre': [250, 'g', 'bruta'],
  Bogavante: [600, 'g', 'bruta'],
  Langosta: [500, 'g', 'bruta'],
  'Buey de mar': [600, 'g', 'bruta'],
  Centolla: [600, 'g', 'bruta'],
  Nécora: [400, 'g', 'bruta'],
  Percebe: [200, 'g', 'bruta'],
  Mejillón: [500, 'g', 'bruta'],
  'Almeja japónica': [300, 'g', 'bruta'],
  'Almeja fina': [250, 'g', 'bruta'],
  Chirla: [300, 'g', 'bruta'],
  Berberecho: [300, 'g', 'bruta'],
  Navaja: [250, 'g', 'bruta'],
  Vieira: [3, 'ud', 'bruta'],
  Zamburiña: [12, 'ud', 'bruta'],
  Ostra: [6, 'ud', 'bruta'],
  'Pulpo crudo congelado': [400, 'g', 'bruta'],
  'Pulpo cocido': [200, 'g'],
  Caracoles: [200, 'g'],
  'Gulas': [100, 'g'],
  'Surimi': [80, 'g'],
  // Conservas y ahumados
  'Anchoa en salazón': [40, 'g'],
  'Atún en aceite': [80, 'g'],
  'Bonito del norte en aceite': [80, 'g'],
  'Ventresca de bonito': [60, 'g'],
  'Salmón ahumado': [80, 'g'],
  Mojama: [60, 'g'],
  'Huevas de salmón': [20, 'g'],
  'Boquerón en vinagre': [100, 'g'],
  'Mejillón en escabeche': [100, 'g'],
  'Berberechos en conserva': [80, 'g'],
  'Sardinillas en aceite': [80, 'g'],
  Melva: [80, 'g'],
  // Carnes con hueso o piezas
  'Chuletón de vaca': [500, 'g', 'bruta'],
  'Chuletón de buey': [500, 'g', 'bruta'],
  'Entrecot de ternera': [300, 'g'],
  'Lomo alto de vaca': [300, 'g'],
  'Lomo bajo de vaca': [300, 'g'],
  'Cochinillo': [700, 'g', 'bruta'],
  'Paletilla de cordero lechal': [650, 'g', 'bruta'],
  'Pierna de cordero': [350, 'g', 'bruta'],
  'Chuletillas de cordero': [300, 'g'],
  'Carré de cordero': [300, 'g', 'bruta'],
  Cabrito: [400, 'g', 'bruta'],
  'Codillo de cerdo': [900, 'g', 'bruta'],
  'Rabo de toro': [400, 'g', 'bruta'],
  'Costillas de cerdo': [500, 'g'],
  'Costilla ibérica': [450, 'g'],
  'Costilla de vaca': [350, 'g'],
  'Alitas de pollo': [350, 'g'],
  'Muslo de pollo': [300, 'g'],
  'Pollo entero': [350, 'g', 'bruta'],
  'Pollo de corral': [350, 'g', 'bruta'],
  'Pollo troceado': [350, 'g'],
  Conejo: [350, 'g'],
  'Carrillera ibérica': [250, 'g'],
  'Carrillera de ternera': [250, 'g'],
  'Carne de ternera para guisar': [220, 'g'],
  'Morcillo de ternera': [250, 'g'],
  'Callos de ternera': [250, 'g'],
  'Oreja de cerdo': [250, 'g'],
  'Manitas de cerdo': [350, 'g', 'bruta'],
  'Magret de pato': [250, 'g'],
  'Confit de pato': [1, 'ud', 'bruta'],
  'Foie gras de pato fresco': [80, 'g'],
  'Micuit de foie': [60, 'g'],
  'Hueso de tuétano': [300, 'g', 'bruta'],
  'Carne de buey picada': [180, 'g'],
  'Hamburguesa vegetal': [120, 'g'],
  'Sardina ahumada': [60, 'g'],
  'Carne picada de ternera': [160, 'g'],
  'Panceta de cerdo': [200, 'g'],
  // Charcutería de ración
  'Jamón ibérico de bellota loncheado': [80, 'g'],
  'Jamón ibérico de cebo loncheado': [80, 'g'],
  'Jamón serrano loncheado': [100, 'g'],
  'Jamón ibérico de bellota pieza': [155, 'g', 'bruta'],
  'Taquitos de jamón': [60, 'g'],
  'Morcilla de Burgos': [150, 'g'],
  Chistorra: [150, 'g'],
  'Chorizo para guisar': [150, 'g'],
  'Chorizo fresco': [180, 'g'],
  'Salchicha fresca': [180, 'g'],
  Butifarra: [200, 'g'],
  'Salchicha Frankfurt': [120, 'g'],
  // Quesos protagonistas
  Burrata: [125, 'g'],
  Mozzarella: [125, 'g'],
  'Mozzarella de búfala': [125, 'g'],
  Provolone: [150, 'g'],
  Halloumi: [120, 'g'],
  'Queso de cabra': [80, 'g'],
  'Torta del Casar': [100, 'g'],
  'Queso feta': [60, 'g'],
  Parmesano: [20, 'g'],
  // Otros
  Tofu: [150, 'g'],
  Gyozas: [6, 'ud', 'bruta'],
  'Croqueta congelada': [150, 'g'],
  'Huevo de codorniz': [6, 'ud', 'bruta'],
  Codorniz: [2, 'ud', 'bruta'],
  Alcachofa: [200, 'g'],
  'Espárrago verde': [200, 'g'],
  'Pimiento de Padrón': [150, 'g'],
  'Setas variadas': [200, 'g'],
  Boletus: [150, 'g'],
  'Boletus congelado': [150, 'g'],
  'Trufa negra': [5, 'g'],
  Aguacate: [150, 'g'],
  Patata: [250, 'g'],
};

const SECONDARY_OVERRIDES: Record<string, QtySpec> = {
  Patata: [150, 'g'],
  'Patata nueva': [150, 'g'],
  Boniato: [120, 'g'],
  'Pimiento de Padrón': [60, 'g'],
  'Espárrago verde': [80, 'g'],
  'Espárrago blanco': [40, 'g'],
  'Tomate cherry': [40, 'g'],
  Tomate: [60, 'g'],
  'Tomate raf': [80, 'g'],
  'Tomate pera': [60, 'g'],
  'Tomate corazón de buey': [80, 'g'],
  'Tomate kumato': [60, 'g'],
  Rúcula: [20, 'g'],
  Canónigos: [20, 'g'],
  'Mezclum de lechugas': [40, 'g'],
  'Espinaca baby': [30, 'g'],
  'Lechuga romana': [60, 'g'],
  'Lechuga iceberg': [40, 'g'],
  Cogollo: [100, 'g'],
  Cebolleta: [15, 'g'],
  Cebolla: [40, 'g'],
  'Cebolla morada': [20, 'g'],
  Chalota: [15, 'g'],
  Ajo: [4, 'g'],
  'Ajo negro': [5, 'g'],
  Ajete: [30, 'g'],
  Jengibre: [3, 'g'],
  'Guindilla fresca': [2, 'g'],
  Aguacate: [60, 'g'],
  'Aceituna verde': [20, 'g'],
  'Aceituna negra': [15, 'g'],
  'Aceituna Kalamata': [15, 'g'],
  Alcaparras: [5, 'g'],
  Pepinillo: [15, 'g'],
  Piparras: [10, 'g'],
  Jalapeño: [10, 'g'],
  'Pimiento del piquillo': [50, 'g'],
  'Pimiento choricero': [15, 'g'],
  'Tomate seco': [15, 'g'],
  'Maíz dulce': [20, 'g'],
  'Algas wakame': [30, 'g'],
  'Alga nori': [3, 'g'],
  Kimchi: [30, 'g'],
  Uva: [40, 'g'],
  Granada: [20, 'g'],
  Manzana: [60, 'g'],
  Pera: [60, 'g'],
  Higo: [40, 'g'],
  Mango: [50, 'g'],
  Fresa: [50, 'g'],
  Frambuesa: [30, 'g'],
  Arándano: [30, 'g'],
  'Frutos rojos congelados': [40, 'g'],
  Limón: [15, 'g'],
  Lima: [10, 'g'],
  Naranja: [40, 'g'],
  'Trufa negra': [2, 'g'],
  Microbrotes: [3, 'g'],
  'Brotes de soja': [30, 'g'],
  Guisante: [40, 'g'],
  'Habitas baby': [40, 'g'],
  Edamame: [40, 'g'],
  Champiñón: [60, 'g'],
  'Setas variadas': [60, 'g'],
  Boletus: [40, 'g'],
  'Boletus congelado': [40, 'g'],
  Shiitake: [40, 'g'],
  Níscalo: [50, 'g'],
  // Proteínas como complemento
  'Anchoa en salazón': [15, 'g'],
  'Foie gras de pato fresco': [40, 'g'],
  'Micuit de foie': [30, 'g'],
  'Jamón ibérico de bellota loncheado': [25, 'g'],
  'Jamón ibérico de cebo loncheado': [25, 'g'],
  'Jamón serrano loncheado': [25, 'g'],
  'Taquitos de jamón': [20, 'g'],
  Bacon: [30, 'g'],
  Guanciale: [30, 'g'],
  'Salmón ahumado': [30, 'g'],
  'Huevas de salmón': [10, 'g'],
  'Ventresca de bonito': [30, 'g'],
  'Atún en aceite': [40, 'g'],
  Gulas: [60, 'g'],
  Parmesano: [15, 'g'],
  Burrata: [60, 'g'],
  'Queso de cabra': [40, 'g'],
  'Queso cheddar': [40, 'g'],
  'Queso azul': [30, 'g'],
  'Queso crema': [30, 'g'],
  'Huevo de codorniz': [3, 'ud', 'bruta'],
  // Salsas, especias y líquidos
  'Salsa de soja': [15, 'ml'],
  'Vinagre de vino': [10, 'ml'],
  'Vinagre de Jerez': [10, 'ml'],
  'Vinagre de Módena': [10, 'ml'],
  'Reducción de Módena': [10, 'ml'],
  'Vinagre de manzana': [10, 'ml'],
  'Vinagre de arroz': [10, 'ml'],
  Tabasco: [1, 'ml'],
  'Salsa Perrins': [3, 'ml'],
  Sriracha: [5, 'ml'],
  'Mostaza de Dijon': [10, 'g'],
  'Mostaza antigua': [10, 'g'],
  Miso: [15, 'g'],
  Tahini: [20, 'g'],
  'Salsa de ostras': [15, 'g'],
  'Salsa de pescado': [10, 'ml'],
  'Pastilla de caldo': [3, 'g'],
  'Cebolla frita crujiente': [10, 'g'],
  Guacamole: [60, 'g'],
  'Tomate frito': [60, 'g'],
  'Tomate triturado': [60, 'g'],
  'Tomate concentrado': [10, 'g'],
  'Tomate rallado': [40, 'g'],
  Azafrán: [0.05, 'g'],
  Cayena: [0.3, 'g'],
  'Pimienta negra molida': [0.3, 'g'],
  'Pimienta negra en grano': [0.5, 'g'],
  'Pimienta verde en grano': [4, 'g'],
  'Sal en escamas': [1, 'g'],
  'Sal gruesa': [3, 'g'],
  Laurel: [0.2, 'g'],
  'Nuez moscada': [0.1, 'g'],
  Sésamo: [3, 'g'],
  Ñora: [3, 'g'],
  'Vaina de vainilla': [0.25, 'ud', 'bruta'],
  'Extracto de vainilla': [2, 'ml'],
  'Aceite de trufa': [3, 'ml'],
  'Aceite de sésamo': [3, 'ml'],
  'Manteca de cerdo': [10, 'g'],
  Mantequilla: [15, 'g'],
  'Nata para montar 35 %': [50, 'ml'],
  'Nata para cocinar': [50, 'ml'],
  'Nata agria': [30, 'g'],
  'Leche entera': [100, 'ml'],
  'Yogur natural': [50, 'g'],
  'Yogur griego': [50, 'g'],
  'Pan rallado': [30, 'g'],
  Panko: [30, 'g'],
  'Harina de tempura': [30, 'g'],
  'Harina para freír': [30, 'g'],
  Piñón: [5, 'g'],
  Miel: [15, 'g'],
  'Chocolate negro 70 %': [20, 'g'],
  'Cobertura de chocolate negro': [20, 'g'],
  'Chocolate blanco': [20, 'g'],
  'Chocolate con leche': [20, 'g'],
  Azúcar: [5, 'g'],
  'Azúcar glas': [5, 'g'],
  Mermelada: [20, 'g'],
  'Dulce de membrillo': [40, 'g'],
  'Helado de vainilla': [100, 'ml'],
  'Sorbete de limón': [100, 'ml'],
  'Dulce de leche': [30, 'g'],
  'Crema de cacao y avellanas': [25, 'g'],
  Brandy: [15, 'ml'],
  Hielo: [150, 'g', 'bruta'],
  'Barra de pan': [0.25, 'ud', 'bruta'],
  'Arroz basmati': [70, 'g'],
  'Arroz redondo': [70, 'g'],
  Gnocchi: [150, 'g'],
  'Raviolis rellenos': [150, 'g'],
};

/**
 * Grupos de productos intercambiables: si la carta menciona uno distinto al de la receta tipo,
 * se sustituye manteniendo el gramaje (p. ej. guanciale en lugar de bacon, tallarines en lugar de espaguetis).
 */
export const SUBSTITUTE_GROUPS: string[][] = [
  ['Bacon', 'Guanciale', 'Panceta curada', 'Panceta de cerdo'],
  ['Parmesano', 'Grana padano', 'Pecorino'],
  ['Espaguetis', 'Macarrones', 'Pasta seca', 'Tallarines', 'Pasta fresca al huevo', 'Gnocchi', 'Raviolis rellenos', 'Noodles de trigo', 'Fideos de arroz'],
  ['Setas variadas', 'Boletus', 'Boletus congelado', 'Níscalo', 'Shiitake', 'Champiñón', 'Portobello', 'Seta de cardo', 'Seta de ostra', 'Trompeta de la muerte', 'Rebozuelo'],
  ['Lomo de merluza', 'Lomo de lubina', 'Lomo de dorada', 'Lomo de corvina', 'Lomo de rape', 'Lomo de salmón', 'Bacalao desalado', 'Lomo de merluza congelado'],
  ['Lubina', 'Lubina salvaje', 'Dorada', 'Corvina', 'Besugo', 'Pargo', 'Rodaballo', 'Lenguado'],
  ['Atún rojo lomo', 'Lomo de atún', 'Bonito del norte', 'Ventresca de atún rojo'],
  ['Gamba blanca', 'Gamba roja', 'Langostino crudo', 'Langostino tigre', 'Carabinero', 'Cigala'],
  ['Gamba pelada congelada', 'Cola de langostino pelada'],
  ['Almeja japónica', 'Almeja fina', 'Chirla', 'Berberecho'],
  ['Calamar', 'Anillas de calamar', 'Chipirón', 'Sepia'],
  ['Lechuga romana', 'Lechuga iceberg', 'Mezclum de lechugas', 'Cogollo', 'Rúcula', 'Canónigos', 'Espinaca baby', 'Escarola', 'Endivia', 'Kale'],
  ['Tomate', 'Tomate pera', 'Tomate raf', 'Tomate cherry', 'Tomate corazón de buey', 'Tomate kumato'],
  ['Mozzarella', 'Mozzarella de búfala', 'Burrata', 'Stracciatella'],
  ['Queso cheddar', 'Queso en lonchas', 'Queso emmental', 'Queso gruyère', 'Provolone', 'Queso de cabra', 'Queso azul', 'Queso de Cabrales', 'Queso Idiazábal', 'Queso tetilla', 'Queso brie'],
  ['Pan de hamburguesa', 'Pan brioche de hamburguesa'],
  ['Pan de bocadillo', 'Barra de pan', 'Pan de chapata', 'Mollete'],
  ['Pan de cristal', 'Pan de hogaza'],
  ['Arroz redondo', 'Arroz bomba'],
  ['Aceite de girasol', 'Aceite de girasol alto oleico', 'Aceite de oliva', 'Aceite de orujo de oliva'],
  ['Aceite de oliva virgen extra', 'Aceite de oliva virgen'],
  ['Carne de buey picada', 'Carne picada de ternera', 'Carne picada mixta', 'Carne picada de cerdo'],
  ['Solomillo de ternera', 'Solomillo de buey', 'Solomillo ibérico', 'Solomillo de cerdo'],
  ['Secreto ibérico', 'Presa ibérica', 'Pluma ibérica', 'Lagarto ibérico', 'Abanico ibérico'],
  ['Entrecot de ternera', 'Lomo alto de vaca', 'Lomo bajo de vaca', 'Vacío de ternera', 'Picaña'],
  ['Chuletón de vaca', 'Chuletón de buey'],
  ['Carrillera ibérica', 'Carrillera de ternera'],
  ['Pechuga de pollo', 'Contramuslo de pollo', 'Pechuga de pavo'],
  ['Pollo entero', 'Pollo de corral', 'Pollo troceado'],
  ['Jamón ibérico de bellota loncheado', 'Jamón ibérico de cebo loncheado', 'Jamón serrano loncheado', 'Paleta ibérica de bellota loncheada'],
  ['Chorizo curado', 'Chorizo ibérico', 'Chistorra', 'Chorizo para guisar', 'Sobrasada'],
  ['Vino tinto joven', 'Vino tinto crianza'],
  ['Ginebra', 'Ron', 'Whisky', 'Vodka', 'Tequila'],
  ['Refresco de cola', 'Refresco de limón', 'Refresco de naranja', 'Tónica', 'Gaseosa', 'Ginger ale'],
  ['Helado de vainilla', 'Sorbete de limón'],
  ['Chocolate negro 70 %', 'Cobertura de chocolate negro', 'Chocolate con leche', 'Chocolate blanco'],
  ['Alioli', 'Mayonesa'],
];

/** Tipo de plato detectado en el nombre: marca la estructura base y la escala de la proteína. */
export interface DishFrame {
  id: string;
  /** Frases (clave de tokens) que lo identifican en el nombre del plato. */
  triggers: string[];
  kind: 'salado' | 'postre' | 'bebida';
  /** Ingredientes de base por ración. */
  base: ItemTuple[];
  /** Factor sobre el gramaje del principal (1 = ración completa). */
  mainScale: number;
  /** Factor sobre los acompañamientos. */
  sideScale?: number;
  /** Principal por defecto si la carta no lo menciona. */
  defaultMain?: string;
  /** Descripción corta para la elaboración propuesta. */
  label: string;
}

export const DISH_FRAMES: DishFrame[] = [
  {
    id: 'hamburguesa',
    triggers: ['hamburguesa', 'burger', 'cheeseburger'],
    kind: 'salado',
    base: [
      ['Pan de hamburguesa', 1, 'ud', 'bruta'],
      ['Lechuga iceberg', 20, 'g'],
      ['Tomate', 30, 'g'],
      ['Cebolla morada', 15, 'g'],
      ['Mayonesa', 10, 'g'],
      ['Ketchup', 10, 'g'],
      ['Patata prefrita congelada', 150, 'g', 'neta', { garnish: true }],
      ['Aceite de girasol', 20, 'ml', 'neta', { garnish: true }],
    ],
    mainScale: 1,
    defaultMain: 'Carne picada de ternera',
    label: 'hamburguesa',
  },
  {
    id: 'bocadillo',
    triggers: ['bocadillo', 'bocata', 'montado', 'pepito', 'serranito', 'mollete', 'baguette', 'chapata', 'brascada', 'pulguita'],
    kind: 'salado',
    base: [['Pan de bocadillo', 1, 'ud', 'bruta']],
    mainScale: 0.6,
    label: 'bocadillo',
  },
  {
    id: 'sandwich',
    triggers: ['sandwich', 'sandwiches', 'bikini', 'mixto', 'club sandwich', 'croque'],
    kind: 'salado',
    base: [['Pan de molde', 60, 'g'], ['Mantequilla', 5, 'g']],
    mainScale: 0.35,
    label: 'sándwich',
  },
  {
    id: 'tosta',
    triggers: ['tosta', 'tostada', 'montadito', 'pintxo', 'pincho', 'canape', 'bruschetta'],
    kind: 'salado',
    base: [['Pan de cristal', 40, 'g']],
    mainScale: 0.3,
    sideScale: 0.4,
    label: 'tosta',
  },
  {
    id: 'taco',
    triggers: ['taco', 'tacos', 'enchilada', 'enchiladas'],
    kind: 'salado',
    base: [['Tortilla de maíz', 3, 'ud', 'bruta'], ['Cebolla morada', 15, 'g'], ['Cilantro', 2, 'g'], ['Lima', 10, 'g']],
    mainScale: 0.6,
    label: 'tacos',
  },
  {
    id: 'bao',
    triggers: ['bao', 'baos', 'bao bun'],
    kind: 'salado',
    base: [
      ['Pan bao', 2, 'ud', 'bruta'],
      ['Pepino', 15, 'g'],
      ['Cebolleta', 5, 'g'],
      ['Cilantro', 1, 'g'],
      ['Mayonesa', 10, 'g'],
      ['Sriracha', 3, 'ml'],
    ],
    mainScale: 0.45,
    label: 'bao',
  },
  {
    id: 'wrap',
    triggers: ['wrap', 'burrito', 'fajita', 'quesadilla'],
    kind: 'salado',
    base: [['Tortilla de trigo', 2, 'ud', 'bruta'], ['Lechuga iceberg', 20, 'g'], ['Tomate', 20, 'g']],
    mainScale: 0.7,
    label: 'wrap',
  },
  {
    id: 'pizza',
    triggers: ['pizza', 'focaccia', 'calzone'],
    kind: 'salado',
    base: [
      ['Masa de pizza', 1, 'ud', 'bruta'],
      ['Tomate triturado', 80, 'g'],
      ['Mozzarella', 110, 'g'],
      ['Orégano', 0.3, 'g'],
    ],
    mainScale: 0.3,
    sideScale: 0.4,
    label: 'pizza',
  },
  {
    id: 'ensalada',
    triggers: ['ensalada', 'ensaladas', 'insalata', 'salad', 'bowl', 'poke'],
    kind: 'salado',
    base: [['Mezclum de lechugas', 60, 'g'], ['Vinagre de Jerez', 5, 'ml']],
    mainScale: 0.5,
    sideScale: 0.6,
    label: 'ensalada',
  },
  {
    id: 'risotto',
    triggers: ['risotto', 'risoto'],
    kind: 'salado',
    base: [
      ['Arroz carnaroli', 90, 'g'],
      ['Caldo de verduras', 350, 'ml'],
      ['Chalota', 20, 'g'],
      ['Vino blanco', 30, 'ml'],
      ['Mantequilla', 20, 'g'],
      ['Parmesano', 25, 'g'],
    ],
    mainScale: 0.5,
    sideScale: 0.8,
    label: 'risotto',
  },
  {
    id: 'arroz',
    triggers: ['arroz', 'paella', 'arros', 'arroces', 'arroz caldoso', 'arroz seco'],
    kind: 'salado',
    base: [
      ['Arroz bomba', 90, 'g'],
      ['Tomate triturado', 25, 'g'],
      ['Ajo', 3, 'g'],
      ['Pimentón dulce', 0.8, 'g'],
      ['Azafrán', 0.08, 'g'],
      ['Aceite de oliva virgen extra', 10, 'ml'],
    ],
    mainScale: 0.6,
    sideScale: 0.8,
    label: 'arroz',
  },
  {
    id: 'fideua',
    triggers: ['fideua', 'fideos a banda', 'rossejat'],
    kind: 'salado',
    base: [
      ['Fideos', 90, 'g'],
      ['Fumet de pescado', 300, 'ml'],
      ['Tomate triturado', 25, 'g'],
      ['Ajo', 3, 'g'],
      ['Pimentón dulce', 0.8, 'g'],
      ['Alioli', 25, 'g'],
    ],
    mainScale: 0.6,
    label: 'fideuá',
  },
  {
    id: 'pasta',
    triggers: [
      'pasta', 'espagueti', 'espaguetis', 'spaghetti', 'macarron', 'macarrones', 'tallarin', 'tallarines', 'tagliatelle', 'penne', 'linguine', 'fettuccine',
      'pappardelle', 'ravioli', 'raviolis', 'gnocchi', 'noquis', 'lasana', 'canelon', 'canelones', 'tortellini', 'fusilli', 'rigatoni', 'noodles', 'ramen', 'udon',
    ],
    kind: 'salado',
    base: [['Pasta seca', 110, 'g'], ['Parmesano', 10, 'g']],
    mainScale: 0.45,
    sideScale: 0.5,
    label: 'pasta',
  },
  {
    id: 'crema',
    triggers: ['crema', 'sopa', 'pure', 'vichyssoise', 'consome', 'caldo', 'veloute', 'potage'],
    kind: 'salado',
    base: [
      ['Caldo de verduras', 200, 'ml'],
      ['Cebolla', 30, 'g'],
      ['Puerro', 25, 'g'],
      ['Patata', 50, 'g', 'neta', { cook: 0 }],
      ['Nata para cocinar', 25, 'ml'],
    ],
    mainScale: 0.3,
    sideScale: 2,
    label: 'crema',
  },
  {
    id: 'crudo',
    triggers: ['tartar', 'tartare', 'tataki', 'carpaccio', 'ceviche', 'sashimi', 'tiradito', 'crudo', 'nigiri', 'usuzukuri'],
    kind: 'salado',
    base: [['Salsa de soja', 10, 'ml'], ['Lima', 10, 'g']],
    mainScale: 0.7,
    label: 'crudo',
  },
  {
    id: 'croquetas',
    triggers: ['croqueta', 'croquetas', 'croquetitas'],
    kind: 'salado',
    base: [
      ['Leche entera', 170, 'ml'],
      ['Harina de trigo', 18, 'g'],
      ['Mantequilla', 10, 'g'],
      ['Cebolla', 13, 'g'],
      ['Huevo', 0.35, 'ud', 'bruta'],
      ['Pan rallado', 25, 'g'],
      ['Aceite de girasol', 30, 'ml', 'neta', { note: 'Fritura' }],
    ],
    mainScale: 0.25,
    label: 'croquetas',
  },
  {
    id: 'revuelto',
    triggers: ['revuelto', 'revueltos', 'huevos revueltos', 'tortilla', 'huevos rotos', 'huevos estrellados', 'huevo roto', 'omelette', 'shakshuka', 'huevos'],
    kind: 'salado',
    base: [['Huevo', 2, 'ud', 'bruta']],
    mainScale: 0.5,
    sideScale: 0.8,
    label: 'huevos',
  },
  {
    id: 'guiso',
    triggers: ['guiso', 'guisado', 'guisada', 'estofado', 'estofada', 'caldereta', 'ragout', 'ragu', 'potaje', 'fricando', 'cazuela', 'olla', 'puchero', 'suquet', 'chilindron'],
    kind: 'salado',
    base: [
      ['Cebolla', 60, 'g'],
      ['Zanahoria', 30, 'g'],
      ['Ajo', 3, 'g'],
      ['Tomate triturado', 30, 'g'],
      ['Harina de trigo', 5, 'g'],
      ['Laurel', 0.2, 'g'],
    ],
    mainScale: 1.2,
    label: 'guiso',
  },
  {
    id: 'brocheta',
    triggers: ['brocheta', 'brochetas', 'pincho moruno', 'kebab', 'espeto', 'skewer'],
    kind: 'salado',
    base: [],
    mainScale: 0.85,
    label: 'brocheta',
  },
  {
    id: 'tarta',
    triggers: ['tarta', 'pastel', 'bizcocho', 'cake', 'cheesecake', 'plum cake', 'muffin', 'magdalena'],
    kind: 'postre',
    base: [['Harina de trigo', 20, 'g'], ['Azúcar', 25, 'g'], ['Huevo', 0.5, 'ud', 'bruta'], ['Mantequilla', 15, 'g'], ['Leche entera', 20, 'ml']],
    mainScale: 0.3,
    sideScale: 0.4,
    label: 'tarta',
  },
  {
    id: 'mousse',
    triggers: ['mousse', 'crema de chocolate', 'semifrio', 'parfait', 'bavarois'],
    kind: 'postre',
    base: [['Nata para montar 35 %', 50, 'ml'], ['Azúcar', 10, 'g'], ['Huevo', 0.5, 'ud', 'bruta']],
    mainScale: 0.25,
    sideScale: 0.3,
    label: 'mousse',
  },
  {
    id: 'helado',
    triggers: ['helado', 'helados', 'sorbete', 'granizado', 'copa de helado', 'affogato'],
    kind: 'postre',
    base: [['Helado de vainilla', 120, 'ml']],
    mainScale: 0.2,
    sideScale: 0.25,
    label: 'helado',
  },
  {
    id: 'crepe',
    triggers: ['crepe', 'crepes', 'filloa', 'filloas', 'frixuelo', 'frixuelos', 'tortita', 'tortitas', 'gofre', 'gofres', 'waffle', 'pancake', 'pancakes'],
    kind: 'postre',
    base: [['Harina de trigo', 30, 'g'], ['Leche entera', 60, 'ml'], ['Huevo', 0.5, 'ud', 'bruta'], ['Mantequilla', 5, 'g'], ['Azúcar', 5, 'g']],
    mainScale: 0.2,
    sideScale: 0.3,
    label: 'crepe',
  },
  {
    id: 'postre',
    triggers: ['postre', 'flan', 'natillas', 'natilla', 'pudin', 'pudding', 'panna cotta', 'coulant', 'brownie', 'cookie', 'trufa de chocolate', 'bombon', 'tiramisu', 'profiteroles'],
    kind: 'postre',
    base: [['Azúcar', 20, 'g'], ['Leche entera', 80, 'ml'], ['Huevo', 0.5, 'ud', 'bruta']],
    mainScale: 0.2,
    sideScale: 0.3,
    label: 'postre',
  },
  {
    id: 'bebida',
    triggers: ['copa', 'vaso', 'chupito', 'combinado', 'coctel', 'cocktail', 'botella', 'jarra', 'cana', 'tercio', 'botellin', 'refresco', 'zumo', 'batido', 'smoothie', 'infusion'],
    kind: 'bebida',
    base: [],
    mainScale: 1,
    label: 'bebida',
  },
];

/** Métodos de cocción detectables en el nombre/descr. y lo que añaden por ración. */
export interface CookingMethod {
  id: string;
  triggers: string[];
  add: ItemTuple[];
  /** Verbo para la elaboración propuesta. */
  step: string;
  /** Merma de cocción orientativa del principal (%), si el método la cambia. */
  mainCookLoss?: number;
}

export const COOKING_METHODS: CookingMethod[] = [
  {
    id: 'romana',
    triggers: ['romana', 'rebozado', 'rebozada', 'rebozados', 'rebozadas', 'gabardina'],
    add: [['Harina de trigo', 20, 'g'], ['Huevo', 1, 'ud', 'bruta'], ['Aceite de girasol', 40, 'ml', 'neta', { note: 'Fritura' }]],
    step: 'Pasar por harina y huevo batido y freír a 175–180 °C; escurrir sobre papel.',
  },
  {
    id: 'tempura',
    triggers: ['tempura'],
    add: [['Harina de tempura', 30, 'g'], ['Aceite de girasol', 40, 'ml', 'neta', { note: 'Fritura' }]],
    step: 'Rebozar en tempura muy fría y freír a 180 °C.',
  },
  {
    id: 'empanado',
    triggers: ['empanado', 'empanados', 'milanesa', 'crispy', 'rebozado en panko'],
    add: [['Harina de trigo', 15, 'g'], ['Huevo', 1, 'ud', 'bruta'], ['Pan rallado', 40, 'g'], ['Aceite de girasol', 40, 'ml', 'neta', { note: 'Fritura' }]],
    step: 'Empanar en harina, huevo y pan rallado y freír a 175 °C.',
  },
  {
    id: 'frito',
    triggers: ['frito', 'frita', 'fritos', 'fritas', 'fritura', 'andaluza', 'enharinado', 'enharinada', 'adobo', 'adobado'],
    add: [['Harina para freír', 30, 'g'], ['Aceite de girasol', 40, 'ml', 'neta', { note: 'Fritura' }]],
    step: 'Enharinar y freír a 185–190 °C en tandas pequeñas.',
  },
  {
    id: 'ajillo',
    triggers: ['ajillo', 'al ajillo', 'pil pil', 'pilpil'],
    add: [['Ajo', 10, 'g'], ['Aceite de oliva virgen extra', 30, 'ml'], ['Cayena', 0.3, 'g'], ['Perejil', 2, 'g']],
    step: 'Cocinar en cazuela con AOVE, ajo laminado y cayena; terminar con perejil.',
  },
  {
    id: 'gallega',
    triggers: ['gallega', 'feira'],
    add: [['Pimentón dulce', 1.5, 'g'], ['Sal gruesa', 2, 'g'], ['Aceite de oliva virgen extra', 10, 'ml']],
    step: 'Aliñar a la gallega con sal gruesa, pimentón y AOVE.',
  },
  {
    id: 'escabeche',
    triggers: ['escabeche', 'escabechado', 'escabechada', 'escabechados'],
    add: [
      ['Aceite de oliva virgen extra', 30, 'ml'],
      ['Vinagre de vino', 20, 'ml'],
      ['Cebolla', 30, 'g'],
      ['Zanahoria', 20, 'g'],
      ['Ajo', 3, 'g'],
      ['Laurel', 0.2, 'g'],
      ['Pimienta negra en grano', 0.5, 'g'],
    ],
    step: 'Marcar y cubrir con el escabeche templado de AOVE, vinagre, verduras y especias; reposar 24 h.',
  },
  {
    id: 'encebollado',
    triggers: ['encebollado', 'encebollada', 'encebollados'],
    add: [['Cebolla', 150, 'g'], ['Aceite de oliva virgen extra', 20, 'ml']],
    step: 'Pochar abundante cebolla en juliana y terminar el principal en ella.',
  },
  {
    id: 'confitado',
    triggers: ['confitado', 'confitada', 'confit', 'confitados', 'confitadas'],
    add: [['Aceite de oliva virgen extra', 50, 'ml', 'neta', { note: 'Confitado (absorción y merma del aceite)' }]],
    step: 'Confitar en AOVE a baja temperatura (60–90 °C según el producto).',
  },
  {
    id: 'wok',
    triggers: ['wok', 'salteado', 'salteada', 'salteados', 'teriyaki'],
    add: [['Salsa de soja', 10, 'ml']],
    step: 'Saltear a fuego muy vivo en wok o sartén.',
  },
  {
    id: 'brasa',
    triggers: ['brasa', 'parrilla', 'grill', 'braseado', 'braseada', 'carbon', 'josper', 'a la leña'],
    add: [],
    step: 'Asar a la brasa a fuego vivo hasta el punto deseado y dejar reposar.',
  },
  {
    id: 'plancha',
    triggers: ['plancha', 'a la plancha', 'marcado', 'marcada', 'sellado', 'sellada'],
    add: [],
    step: 'Marcar a la plancha muy caliente hasta el punto deseado.',
  },
  {
    id: 'horno',
    triggers: ['horno', 'al horno', 'asado', 'asada', 'asados', 'asadas', 'gratinado', 'gratinada', 'gratinados', 'baja temperatura', 'rustido', 'hornear'],
    add: [],
    step: 'Asar en horno (160–200 °C según la pieza) hasta el punto deseado.',
  },
  {
    id: 'guiso',
    triggers: ['guisado', 'guisada', 'estofado', 'estofada', 'guiso', 'caldereta'],
    add: [],
    step: 'Guisar a fuego suave con el sofrito y el caldo hasta que esté tierno.',
  },
  {
    id: 'vapor',
    triggers: ['vapor', 'al vapor', 'papillote', 'cocido', 'cocida', 'hervido', 'hervida'],
    add: [],
    step: 'Cocinar al vapor o en su punto de cocción justo.',
  },
];
