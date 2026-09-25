import type { KbIngredient } from '../ingredients';
import { ing } from './build';

/**
 * Bebidas (vinos, cervezas, destilados, refrescos, café), congelados y varios de sala.
 * Líquidos en litros con su densidad para poder convertir a peso.
 */
export const KB_BEBIDAS: KbIngredient[] = [
  // ── Vinos ──
  ing('Vino tinto crianza', 'bebida', 'l', 0, 0, 6, { aka: ['crianza', 'vino crianza', 'rioja crianza', 'ribera del duero crianza', 'tinto crianza', 'vino tinto reserva'], alg: ['sulfitos'], dens: 0.99 }),
  ing('Vino tinto joven', 'bebida', 'l', 0, 0, 3.2, { aka: ['vino tinto', 'tinto', 'vino', 'vino tinto de cocina', 'vino tinto para cocinar', 'vino de mesa', 'tinto joven', 'vino tinto roble'], alg: ['sulfitos'], dens: 0.99 }),
  ing('Vino blanco', 'bebida', 'l', 0, 0, 4.5, { aka: ['vino blanco verdejo', 'vino blanco seco', 'vino blanco para cocinar', 'verdejo', 'vino blanco de cocina', 'blanco verdejo', 'rueda verdejo'], alg: ['sulfitos'], dens: 0.99 }),
  ing('Albariño', 'bebida', 'l', 0, 0, 9, { aka: ['albarino', 'rias baixas', 'vino albariño'], alg: ['sulfitos'], dens: 0.99 }),
  ing('Vino rosado', 'bebida', 'l', 0, 0, 4, { aka: ['rosado', 'vino rosado de navarra'], alg: ['sulfitos'], dens: 0.99 }),
  ing('Cava', 'bebida', 'l', 0, 0, 6, { aka: ['cava brut', 'cava brut nature', 'espumoso', 'prosecco', 'vino espumoso'], alg: ['sulfitos'], dens: 0.99 }),
  ing('Champán', 'bebida', 'l', 0, 0, 35, { aka: ['champagne', 'champan brut'], alg: ['sulfitos'], dens: 0.99 }),
  ing('Vino de Oporto', 'bebida', 'l', 0, 0, 10, { aka: ['oporto', 'porto', 'oporto ruby', 'oporto tawny'], alg: ['sulfitos'], dens: 1.02 }),
  ing('Vino fino', 'bebida', 'l', 0, 0, 8, { aka: ['manzanilla', 'fino de jerez', 'manzanilla de sanlucar', 'vino de jerez', 'jerez', 'amontillado', 'oloroso'], alg: ['sulfitos'], dens: 0.98 }),
  ing('Pedro Ximénez', 'bebida', 'l', 0, 0, 12, { aka: ['pedro ximenez', 'px', 'vino dulce', 'moscatel'], alg: ['sulfitos'], dens: 1.1 }),
  ing('Vermut rojo', 'bebida', 'l', 0, 0, 7, { aka: ['vermut', 'vermu', 'vermouth', 'vermut de grifo', 'vermut blanco', 'martini rosso'], alg: ['sulfitos'], dens: 1.05 }),
  ing('Sidra natural', 'bebida', 'l', 0, 0, 2.5, { aka: ['sidra', 'sidra asturiana', 'sidra vasca'], alg: ['sulfitos'], dens: 1 }),
  ing('Tinto de verano embotellado', 'bebida', 'l', 0, 0, 1.6, { aka: ['tinto de verano de botella', 'tinto de verano preparado'], alg: ['sulfitos'], dens: 1.02 }),

  // ── Cervezas ──
  ing('Cerveza de barril', 'bebida', 'l', 0, 0, 2.2, { aka: ['cerveza', 'cerveza de grifo', 'barril de cerveza', 'cerveza rubia', 'cerveza lager', 'cerveza tirada'], alg: ['gluten'], dens: 1.01 }),
  ing('Cerveza en botella', 'bebida', 'l', 0, 0, 2.6, { aka: ['tercio de cerveza', 'botellin de cerveza', 'cerveza tercio', 'cerveza botellin', 'cerveza lata', 'quinto'], alg: ['gluten'], dens: 1.01 }),
  ing('Cerveza sin alcohol', 'bebida', 'l', 0, 0, 2.4, { aka: ['cerveza sin', 'cerveza tostada sin alcohol'], alg: ['gluten'], dens: 1.01 }),
  ing('Cerveza artesanal', 'bebida', 'l', 0, 0, 6, { aka: ['ipa', 'cerveza ipa', 'cerveza craft'], alg: ['gluten'], dens: 1.01 }),

  // ── Destilados y licores ──
  ing('Ginebra', 'bebida', 'l', 0, 0, 16, { aka: ['gin', 'ginebra premium', 'london dry gin'], dens: 0.95 }),
  ing('Ron', 'bebida', 'l', 0, 0, 15, { aka: ['ron blanco', 'ron añejo', 'ron dorado', 'rum'], dens: 0.95 }),
  ing('Whisky', 'bebida', 'l', 0, 0, 17, { aka: ['whiskey', 'bourbon', 'whisky escoces', 'scotch'], dens: 0.94 }),
  ing('Vodka', 'bebida', 'l', 0, 0, 13, { aka: ['vodka premium'], dens: 0.95 }),
  ing('Tequila', 'bebida', 'l', 0, 0, 18, { aka: ['tequila blanco', 'tequila reposado', 'mezcal'], dens: 0.95 }),
  ing('Brandy', 'bebida', 'l', 0, 0, 12, { aka: ['coñac', 'conac', 'brandy de jerez', 'cognac', 'armañac'], dens: 0.95 }),
  ing('Licor de hierbas', 'bebida', 'l', 0, 0, 10, { aka: ['orujo', 'orujo de hierbas', 'licor de orujo', 'aguardiente', 'hierbas ibicencas', 'chupito'], dens: 1 }),
  ing('Pacharán', 'bebida', 'l', 0, 0, 11, { aka: ['pacharan', 'patxaran'], dens: 1.05 }),
  ing('Anís', 'bebida', 'l', 0, 0, 9, { aka: ['anis', 'anis seco', 'anis dulce', 'licor de anis'], dens: 0.98 }),
  ing('Licor de naranja', 'bebida', 'l', 0, 0, 20, { aka: ['triple seco', 'cointreau', 'triple sec', 'grand marnier'], dens: 1.05 }),
  ing('Amaretto', 'bebida', 'l', 0, 0, 14, { aka: ['licor de amaretto', 'disaronno', 'licor de almendras'], dens: 1.08 }),
  ing('Licor de café', 'bebida', 'l', 0, 0, 13, { aka: ['licor de cafe', 'kahlua', 'tia maria'], dens: 1.1 }),
  ing('Crema de whisky', 'bebida', 'l', 0, 0, 13, { aka: ['baileys', 'crema de orujo', 'licor de crema'], alg: ['lacteos'], dens: 1.05 }),
  ing('Licor 43', 'bebida', 'l', 0, 0, 15, { aka: ['cuarenta y tres', 'licor cuarenta y tres'], dens: 1.1 }),
  ing('Aperitivo bitter', 'bebida', 'l', 0, 0, 16, { aka: ['aperol', 'campari', 'bitter', 'bitter de naranja'], dens: 1.05 }),
  ing('Angostura', 'bebida', 'l', 0, 0, 60, { aka: ['angostura bitters', 'amargo de angostura'], dens: 1 }),
  ing('Sirope de granadina', 'bebida', 'l', 0, 0, 6, { aka: ['granadina', 'sirope de azucar', 'jarabe simple', 'sirope natural'], dens: 1.3 }),

  // ── Refrescos, aguas y zumos ──
  ing('Tónica', 'bebida', 'l', 0, 0, 3.5, { aka: ['tonica', 'agua tonica', 'tonica premium', 'fever tree', 'schweppes tonica'], dens: 1.03 }),
  ing('Refresco de cola', 'bebida', 'l', 0, 0, 2.2, { aka: ['cola', 'coca cola', 'pepsi', 'refresco cola', 'cola zero', 'coca cola zero'], dens: 1.04 }),
  ing('Refresco de limón', 'bebida', 'l', 0, 0, 2, { aka: ['fanta limon', 'limonada', 'refresco limon', 'kas limon', 'sprite', 'seven up'], dens: 1.04 }),
  ing('Refresco de naranja', 'bebida', 'l', 0, 0, 2, { aka: ['fanta naranja', 'refresco naranja', 'kas naranja'], dens: 1.04 }),
  ing('Gaseosa', 'bebida', 'l', 0, 0, 0.6, { aka: ['soda', 'agua de soda', 'gaseosa blanca'], dens: 1.01 }),
  ing('Ginger ale', 'bebida', 'l', 0, 0, 3.5, { aka: ['ginger beer', 'cerveza de jengibre'], dens: 1.03 }),
  ing('Agua mineral', 'bebida', 'l', 0, 0, 0.3, { aka: ['agua', 'agua sin gas', 'agua mineral natural', 'botella de agua'], dens: 1 }),
  ing('Agua con gas', 'bebida', 'l', 0, 0, 1, { aka: ['agua mineral con gas', 'agua carbonatada', 'agua gasificada'], dens: 1 }),
  ing('Zumo de naranja', 'bebida', 'l', 0, 0, 1.5, { aka: ['zumo de naranja envasado', 'jugo de naranja', 'zumo naranja'], dens: 1.04 }),
  ing('Zumo de limón', 'bebida', 'l', 0, 0, 2.5, { aka: ['zumo de limon', 'jugo de limon', 'zumo de limon natural', 'zumo de lima', 'jugo de lima'], dens: 1.03 }),
  ing('Zumo de piña', 'bebida', 'l', 0, 0, 1.6, { aka: ['zumo de pina', 'jugo de piña'], dens: 1.05 }),
  ing('Zumo de tomate', 'bebida', 'l', 0, 0, 1.8, { aka: ['jugo de tomate', 'zumo de tomate natural'], dens: 1.03 }),
  ing('Mosto', 'bebida', 'l', 0, 0, 1.6, { aka: ['mosto de uva', 'zumo de uva', 'mosto tinto', 'mosto blanco'], dens: 1.06 }),
  ing('Bebida de soja', 'bebida', 'l', 0, 0, 1.3, { aka: ['leche de soja', 'bebida vegetal de soja'], alg: ['soja'], dens: 1.02 }),
  ing('Bebida de avena', 'bebida', 'l', 0, 0, 1.5, { aka: ['leche de avena', 'bebida vegetal de avena'], alg: ['gluten'], dens: 1.02 }),

  // ── Café e infusiones ──
  ing('Café en grano', 'bebida', 'kg', 0, 0, 16, { aka: ['cafe', 'cafe en grano', 'cafe molido', 'cafe natural', 'cafe mezcla', 'cafe descafeinado', 'descafeinado', 'cafe espresso'] }),
  ing('Café soluble', 'bebida', 'kg', 0, 0, 25, { aka: ['cafe soluble', 'nescafe', 'cafe instantaneo'] }),
  ing('Té', 'bebida', 'ud', 0, 0, 0.07, { aka: ['bolsita de te', 'te negro', 'te verde', 'infusion', 'manzanilla infusion', 'poleo menta', 'rooibos', 'te en bolsita'], uw: 0.002 }),

  // ── Varios de sala y cocina ──
  ing('Hielo', 'otros', 'kg', 0, 0, 0.3, { aka: ['cubitos de hielo', 'hielo en cubitos', 'hielo picado', 'bolsa de hielo'] }),
  ing('Patata prefrita congelada', 'congelado', 'kg', 0, 30, 1.4, {
    aka: ['patata prefrita', 'patatas prefritas', 'patatas congeladas', 'patata congelada', 'patatas fritas congeladas', 'patatas baston', 'patata gajo', 'patatas gajo',
      'patatas deluxe', 'patata corte grueso'],
  }),
  ing('Menestra de verduras congelada', 'congelado', 'kg', 0, 10, 2.5, { aka: ['verduras congeladas', 'menestra congelada', 'verduras para paella', 'salteado de verduras congelado', 'wok de verduras'] }),
  ing('Lomo de merluza congelado', 'congelado', 'kg', 3, 15, 10, { aka: ['merluza congelada', 'merluza del cabo', 'merluza austral', 'lomo de merluza del cabo', 'merluza de pincho congelada'], alg: ['pescado'] }),
  ing('Gyozas', 'congelado', 'ud', 0, 5, 0.25, { aka: ['gyoza', 'empanadillas japonesas', 'dumplings', 'gyozas de cerdo', 'gyozas de pollo', 'gyozas de verduras', 'dim sum'], alg: ['gluten', 'soja', 'sesamo'], uw: 0.02 }),
  ing('Hamburguesa vegetal', 'congelado', 'kg', 0, 10, 14, {
    aka: ['hamburguesa vegana', 'burger vegana', 'burger vegetal', 'medallon vegetal', 'hamburguesa de soja', 'hamburguesa beyond', 'carne vegetal'],
    alg: ['soja', 'gluten'],
  }),
  ing('Croqueta congelada', 'congelado', 'kg', 0, 5, 6, { aka: ['croquetas congeladas', 'croqueta industrial', 'croquetas precocinadas'], alg: ['gluten', 'lacteos', 'huevo'] }),
  ing('Masa de croissant congelada', 'congelado', 'ud', 0, 0, 0.3, { aka: ['croissant congelado', 'bolleria congelada', 'napolitana congelada'], alg: ['gluten', 'lacteos', 'huevo'], uw: 0.07 }),
];
