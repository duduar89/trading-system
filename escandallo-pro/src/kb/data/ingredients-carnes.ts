import type { KbIngredient } from '../ingredients';
import { ing } from './build';

/**
 * Carnes (vacuno, cerdo e ibérico, cordero, aves, caza, casquería) y charcutería.
 * Mermas: limpieza/despiece típica de cocina profesional. Cocción: plancha 20–28 %, asado 30–35 %, guiso 35–45 %.
 * Precios: mayorista España 2025-2026, € por unidad base sin IVA.
 */
export const KB_CARNES: KbIngredient[] = [
  // ── Vacuno ──
  ing('Solomillo de ternera', 'carne', 'kg', 18, 22, 32, {
    aka: ['solomillo', 'solomillo de vaca', 'solomillo de añojo', 'solomillo ternera nacional', 'solomillo entero', 'filet mignon', 'lomo fino'],
  }),
  ing('Solomillo de buey', 'carne', 'kg', 18, 22, 55, { aka: ['solomillo buey'] }),
  ing('Lomo alto de vaca', 'carne', 'kg', 15, 22, 26, {
    aka: ['lomo alto', 'lomo alto de ternera', 'lomo alto madurado', 'ribeye', 'rib eye', 'bife ancho', 'ojo de bife'],
  }),
  ing('Lomo bajo de vaca', 'carne', 'kg', 12, 22, 24, { aka: ['lomo bajo', 'lomo bajo de ternera', 'striploin', 'bife de chorizo', 'new york'] }),
  ing('Chuletón de vaca', 'carne', 'kg', 8, 18, 34, {
    aka: ['chuleton', 'chuleta de vaca', 'chuleton de vaca madurada', 'chuleta de vaca madurada', 'txuleta', 'chuleton de ternera', 'tomahawk', 't bone'],
  }),
  ing('Chuletón de buey', 'carne', 'kg', 8, 18, 58, { aka: ['chuleta de buey', 'txuleta de buey'] }),
  ing('Entrecot de ternera', 'carne', 'kg', 5, 22, 24, { aka: ['entrecot', 'entrecote', 'entrecot de vaca', 'entrecot de añojo'] }),
  ing('Filete de ternera', 'carne', 'kg', 3, 25, 14, {
    aka: ['ternera', 'filetes de ternera', 'babilla', 'babilla de ternera', 'tapa de ternera', 'contra de ternera', 'cadera de ternera',
      'escalope de ternera', 'filete de añojo', 'bistec', 'bife'],
  }),
  ing('Carne de ternera para guisar', 'carne', 'kg', 8, 38, 11, {
    aka: ['ternera para guisar', 'carne para guisar', 'carne de guiso', 'aguja de ternera', 'espaldilla de ternera', 'ternera guisar',
      'carne de ternera troceada', 'carne en tacos', 'jarrete de ternera'],
  }),
  ing('Morcillo de ternera', 'carne', 'kg', 10, 40, 12, { aka: ['morcillo', 'osobuco', 'ossobuco', 'morcillo de vaca'] }),
  ing('Carrillera de ternera', 'carne', 'kg', 12, 40, 13, { aka: ['carrillera', 'carrillada de ternera', 'carrillera de vaca', 'carrilleras de ternera'] }),
  ing('Rabo de toro', 'carne', 'kg', 12, 40, 14, { aka: ['rabo de vaca', 'rabo de ternera', 'cola de toro', 'rabo'] }),
  ing('Carne picada de ternera', 'carne', 'kg', 0, 25, 10, {
    aka: ['carne picada', 'picada de ternera', 'carne molida', 'carne de hamburguesa', 'hamburguesa de ternera', 'carne picada de vacuno'],
  }),
  ing('Carne de buey picada', 'carne', 'kg', 0, 22, 16, {
    aka: ['hamburguesa de buey', 'burger de buey', 'carne picada de buey', 'hamburguesa de vaca madurada', 'carne picada de vaca madurada', 'smash burger'],
  }),
  ing('Carne picada mixta', 'carne', 'kg', 0, 25, 7.5, { aka: ['picada mixta', 'carne picada cerdo y ternera', 'carne picada mixta cerdo ternera'] }),
  ing('Falda de ternera', 'carne', 'kg', 10, 35, 9, { aka: ['falda', 'falda de vaca'] }),
  ing('Vacío de ternera', 'carne', 'kg', 8, 22, 16, { aka: ['vacio', 'bavette', 'flank steak', 'vacio de vaca'] }),
  ing('Picaña', 'carne', 'kg', 12, 25, 18, { aka: ['picanha', 'tapilla', 'picaña de vaca'] }),
  ing('Costilla de vaca', 'carne', 'kg', 10, 35, 12, { aka: ['costilla de ternera', 'short rib', 'costilla de vacuno'] }),
  ing('Callos de ternera', 'carne', 'kg', 5, 30, 5, { aka: ['callos', 'tripa de ternera', 'callos limpios', 'mondongo'] }),
  ing('Morro de ternera', 'carne', 'kg', 5, 30, 6, { aka: ['morro', 'morro de vaca'] }),
  ing('Pata de ternera', 'carne', 'kg', 40, 30, 3, { aka: ['pata de vaca', 'manitas de ternera', 'mano de ternera'] }),
  ing('Hígado de ternera', 'carne', 'kg', 5, 20, 7, { aka: ['higado', 'higado de vaca'] }),
  ing('Lengua de ternera', 'carne', 'kg', 20, 35, 9, { aka: ['lengua', 'lengua de vaca'] }),
  ing('Huesos de ternera', 'carne', 'kg', 0, 0, 1.5, {
    aka: ['hueso de caña', 'hueso de rodilla', 'huesos para caldo', 'hueso de ternera', 'hueso de vaca', 'hueso de jamon', 'huesos de jamon', 'espinazo'],
  }),
  ing('Hueso de tuétano', 'carne', 'kg', 0, 15, 6, { aka: ['tuetano', 'canoa de tuetano', 'hueso de tuetano en canoa'] }),

  // ── Cerdo e ibérico ──
  ing('Lomo de cerdo', 'carne', 'kg', 5, 25, 6.5, { aka: ['cerdo', 'cinta de lomo', 'lomo cinta', 'lomo de cerdo fresco', 'carne de cerdo', 'lomo fresco'] }),
  ing('Chuleta de cerdo', 'carne', 'kg', 5, 25, 6, { aka: ['chuletas de cerdo', 'chuleta de aguja', 'chuleta de lomo de cerdo'] }),
  ing('Solomillo de cerdo', 'carne', 'kg', 5, 25, 8.5, { aka: ['solomillo cerdo', 'solomillo de cerdo blanco'] }),
  ing('Solomillo ibérico', 'carne', 'kg', 5, 25, 17, { aka: ['solomillo de cerdo iberico', 'solomillito iberico', 'solomillo de iberico'] }),
  ing('Secreto ibérico', 'carne', 'kg', 8, 25, 17, { aka: ['secreto', 'secreto de cerdo iberico', 'secreto de iberico'] }),
  ing('Presa ibérica', 'carne', 'kg', 5, 25, 20, { aka: ['presa', 'presa de iberico', 'presa de cerdo iberico'] }),
  ing('Pluma ibérica', 'carne', 'kg', 5, 25, 19, { aka: ['pluma', 'pluma de iberico', 'pluma de cerdo iberico'] }),
  ing('Lagarto ibérico', 'carne', 'kg', 5, 28, 13, { aka: ['lagarto', 'lagarto de iberico'] }),
  ing('Abanico ibérico', 'carne', 'kg', 8, 25, 14, { aka: ['abanico', 'abanico de iberico'] }),
  ing('Carrillera ibérica', 'carne', 'kg', 10, 40, 11, { aka: ['carrillera de cerdo', 'carrillada iberica', 'carrilleras de cerdo iberico', 'carrillada de cerdo'] }),
  ing('Costillas de cerdo', 'carne', 'kg', 5, 30, 6, { aka: ['costilla de cerdo', 'costillar de cerdo', 'costillas', 'ribs', 'costilla adobada', 'costillas bbq'] }),
  ing('Costilla ibérica', 'carne', 'kg', 5, 30, 11, { aka: ['costilla de cerdo iberico', 'costillar iberico', 'costillas ibericas'] }),
  ing('Panceta de cerdo', 'carne', 'kg', 3, 30, 6.5, { aka: ['panceta', 'panceta fresca', 'tocino entreverado', 'pork belly', 'torrezno', 'torreznos', 'panceta iberica'] }),
  ing('Codillo de cerdo', 'carne', 'kg', 5, 35, 5.5, { aka: ['codillo', 'jarrete de cerdo', 'codillo asado', 'codillo cocido'] }),
  ing('Oreja de cerdo', 'carne', 'kg', 5, 30, 4.5, { aka: ['oreja', 'oreja cocida', 'oreja de cerdo cocida', 'orejas'] }),
  ing('Manitas de cerdo', 'carne', 'kg', 40, 30, 3.5, { aka: ['manos de cerdo', 'patas de cerdo', 'manitas', 'mano de cerdo'] }),
  ing('Carne picada de cerdo', 'carne', 'kg', 0, 25, 6, { aka: ['picada de cerdo', 'magro picado', 'carne picada cerdo'] }),
  ing('Magro de cerdo', 'carne', 'kg', 3, 32, 6.8, { aka: ['magro', 'carne de cerdo para guisar', 'cerdo para guisar', 'magro de cerdo troceado', 'pincho moruno'] }),
  ing('Tocino', 'carne', 'kg', 0, 40, 4, { aka: ['tocino fresco', 'tocino de cerdo', 'tocino blanco', 'tocino iberico'] }),
  ing('Cochinillo', 'carne', 'kg', 5, 35, 14, { aka: ['cochinillo segoviano', 'toston', 'lechon', 'cochinillo entero', 'cuarto de cochinillo'] }),

  // ── Cordero y cabrito ──
  ing('Paletilla de cordero lechal', 'carne', 'kg', 5, 30, 17, {
    aka: ['paletilla de cordero', 'paletilla de lechazo', 'cordero lechal', 'lechazo', 'cordero', 'cuarto de lechazo', 'paletilla lechal'],
  }),
  ing('Pierna de cordero', 'carne', 'kg', 5, 30, 13, { aka: ['pierna de cordero recental', 'pierna de lechazo', 'pierna de cordero lechal'] }),
  ing('Chuletillas de cordero', 'carne', 'kg', 5, 25, 22, { aka: ['chuletillas', 'chuletas de cordero', 'chuletillas de lechazo', 'chuletillas de cordero lechal'] }),
  ing('Carré de cordero', 'carne', 'kg', 20, 25, 30, { aka: ['carre de cordero', 'costillar de cordero', 'rack de cordero', 'carre'] }),
  ing('Cabrito', 'carne', 'kg', 5, 30, 16, { aka: ['choto', 'cabrito lechal', 'paletilla de cabrito'] }),

  // ── Aves ──
  ing('Pollo entero', 'carne', 'kg', 30, 30, 3.2, { aka: ['pollo', 'pollo limpio', 'pollo fresco', 'pollo asado', 'pollos'] }),
  ing('Pollo de corral', 'carne', 'kg', 30, 30, 6, { aka: ['pollo campero', 'pollo de caserio', 'pollo corral', 'pollo ecologico'] }),
  ing('Pollo troceado', 'carne', 'kg', 5, 30, 3.8, { aka: ['pollo en trozos', 'pollo troceado para guisar', 'pollo cortado'] }),
  ing('Pechuga de pollo', 'carne', 'kg', 5, 22, 7.5, { aka: ['pechuga', 'filete de pechuga', 'pechugas de pollo', 'pechuga de pollo fileteada', 'filete de pollo', 'pollo fileteado'] }),
  ing('Contramuslo de pollo', 'carne', 'kg', 5, 25, 6.5, { aka: ['contramuslo', 'contramuslo deshuesado', 'contramuslos de pollo deshuesados'] }),
  ing('Muslo de pollo', 'carne', 'kg', 5, 28, 3.8, { aka: ['muslo', 'jamoncitos de pollo', 'pierna de pollo', 'cuarto trasero de pollo', 'muslitos de pollo'] }),
  ing('Alitas de pollo', 'carne', 'kg', 5, 30, 3.9, { aka: ['alas de pollo', 'alitas', 'chicken wings', 'alas'] }),
  ing('Pechuga de pavo', 'carne', 'kg', 5, 22, 8, { aka: ['pavo', 'filete de pavo', 'pechuga de pavo fresca'] }),
  ing('Magret de pato', 'carne', 'kg', 10, 30, 18, { aka: ['magret', 'pechuga de pato', 'pato'] }),
  ing('Confit de pato', 'carne', 'kg', 0, 10, 18, { aka: ['muslo de pato confitado', 'pato confitado', 'muslo de pato'], uw: 0.28 }),
  ing('Foie gras de pato fresco', 'carne', 'kg', 5, 35, 60, { aka: ['foie', 'foie fresco', 'escalope de foie', 'foie gras', 'foie de pato'] }),
  ing('Micuit de foie', 'carne', 'kg', 0, 0, 55, { aka: ['mi cuit', 'foie micuit', 'micuit', 'bloc de foie', 'terrina de foie', 'mi cuit de foie'] }),
  ing('Conejo', 'carne', 'kg', 20, 30, 7.5, { aka: ['conejo entero', 'conejo troceado', 'conejo de granja'] }),
  ing('Codorniz', 'carne', 'ud', 10, 25, 1.9, { aka: ['codornices', 'codorniz limpia'], uw: 0.18 }),
  ing('Perdiz', 'carne', 'ud', 20, 30, 7, { aka: ['perdiz roja', 'perdices'], uw: 0.35 }),
  ing('Pichón', 'carne', 'ud', 20, 25, 12, { aka: ['pichon', 'pichones'], uw: 0.45 }),

  // ── Caza ──
  ing('Lomo de ciervo', 'carne', 'kg', 5, 22, 28, { aka: ['ciervo', 'venado', 'solomillo de ciervo', 'lomo de venado'] }),
  ing('Carne de jabalí', 'carne', 'kg', 10, 40, 12, { aka: ['jabali', 'jabali para guisar'] }),

  // ── Embutidos frescos ──
  ing('Chorizo fresco', 'charcuteria', 'kg', 0, 20, 7.5, { aka: ['chorizo criollo', 'choricitos frescos', 'chorizo parrillero', 'choricitos'] }),
  ing('Chistorra', 'charcuteria', 'kg', 0, 20, 9, { aka: ['txistorra', 'chistorra de navarra'] }),
  ing('Chorizo para guisar', 'charcuteria', 'kg', 0, 10, 8, { aka: ['chorizo de guisar', 'chorizo asturiano', 'chorizo de cocido', 'chorizo de sarta', 'chorizo de fabada'] }),
  ing('Salchicha fresca', 'charcuteria', 'kg', 0, 15, 6.5, { aka: ['salchichas', 'longaniza fresca', 'longaniza', 'salchicha de cerdo'] }),
  ing('Butifarra', 'charcuteria', 'kg', 0, 15, 7.5, { aka: ['butifarra fresca', 'botifarra', 'butifarra blanca'] }),
  ing('Morcilla de Burgos', 'charcuteria', 'kg', 0, 10, 7, { aka: ['morcilla', 'morcilla de arroz'] }),
  ing('Morcilla asturiana', 'charcuteria', 'kg', 0, 10, 10, { aka: ['morcilla de cebolla', 'morcilla de fabada', 'morcilla ahumada'] }),
  ing('Salchicha Frankfurt', 'charcuteria', 'kg', 0, 5, 6, { aka: ['frankfurt', 'salchicha de perrito', 'salchichas frankfurt', 'salchicha cocida'] }),

  // ── Curados y cocidos ──
  ing('Jamón ibérico de bellota loncheado', 'charcuteria', 'kg', 0, 0, 110, {
    aka: ['jamon de bellota', 'jamon iberico de bellota', 'jamon bellota', 'jamon 100 iberico', 'pata negra', 'jamon de bellota loncheado',
      'jamon iberico de bellota 100', 'jamon iberico puro de bellota'],
  }),
  ing('Jamón ibérico de bellota pieza', 'charcuteria', 'kg', 48, 0, 55, {
    aka: ['pata de jamon de bellota', 'jamon de bellota entero', 'jamon de bellota con hueso', 'jamon iberico de bellota con hueso'],
  }),
  ing('Jamón ibérico de cebo loncheado', 'charcuteria', 'kg', 0, 0, 55, {
    aka: ['jamon iberico', 'jamon iberico de cebo', 'jamon de cebo', 'jamon iberico cebo de campo', 'jamon de cebo de campo', 'jamon iberico loncheado'],
  }),
  ing('Jamón serrano loncheado', 'charcuteria', 'kg', 0, 0, 18, {
    aka: ['jamon', 'jamon serrano', 'jamon curado', 'jamon reserva', 'jamon gran reserva', 'jamon de teruel', 'jamon serrano en lonchas', 'jamon bodega'],
  }),
  ing('Jamón serrano pieza', 'charcuteria', 'kg', 45, 0, 9, { aka: ['jamon serrano con hueso', 'pata de jamon serrano', 'jamon serrano entero'] }),
  ing('Paleta ibérica de bellota loncheada', 'charcuteria', 'kg', 0, 0, 70, { aka: ['paleta iberica', 'paleta de bellota', 'paleta iberica de bellota'] }),
  ing('Taquitos de jamón', 'charcuteria', 'kg', 0, 0, 12, {
    aka: ['tacos de jamon', 'taquitos de jamon serrano', 'recortes de jamon', 'virutas de jamon', 'jamon en taquitos', 'dados de jamon', 'picadillo de jamon'],
  }),
  ing('Lomo ibérico de bellota', 'charcuteria', 'kg', 0, 0, 60, { aka: ['lomo embuchado', 'caña de lomo iberico', 'lomo iberico', 'lomo iberico embuchado', 'caña de lomo'] }),
  ing('Chorizo ibérico', 'charcuteria', 'kg', 0, 0, 22, { aka: ['chorizo de bellota', 'chorizo iberico de bellota', 'chorizo iberico loncheado'] }),
  ing('Chorizo curado', 'charcuteria', 'kg', 0, 0, 11, { aka: ['chorizo', 'chorizo extra', 'chorizo picante', 'chorizo dulce', 'chorizo de pamplona', 'chorizo loncheado'] }),
  ing('Salchichón ibérico', 'charcuteria', 'kg', 0, 0, 20, { aka: ['salchichon', 'salchichon de bellota', 'salchichon iberico de bellota'] }),
  ing('Fuet', 'charcuteria', 'kg', 0, 0, 14, { aka: ['espetec', 'fuet extra'] }),
  ing('Sobrasada', 'charcuteria', 'kg', 0, 0, 12, { aka: ['sobrasada de mallorca', 'sobrasada iberica'] }),
  ing('Cecina de León', 'charcuteria', 'kg', 0, 0, 40, { aka: ['cecina', 'cecina de vaca', 'cecina de leon loncheada'] }),
  ing('Bacon', 'charcuteria', 'kg', 0, 30, 8.5, { aka: ['beicon', 'bacon ahumado', 'panceta ahumada', 'bacon en lonchas', 'bacon lonchas', 'tiras de bacon', 'bacon ahumado lonchas'] }),
  ing('Jamón cocido', 'charcuteria', 'kg', 0, 0, 9, { aka: ['jamon york', 'jamon cocido extra', 'york', 'jamon dulce', 'paleta cocida'] }),
  ing('Fiambre de pavo', 'charcuteria', 'kg', 0, 0, 9, { aka: ['pavo cocido', 'pechuga de pavo cocida', 'pavo en lonchas', 'pechuga de pavo en lonchas'] }),
  ing('Mortadela', 'charcuteria', 'kg', 0, 0, 7, { aka: ['mortadela de bolonia', 'mortadela italiana'] }),
  ing('Salami', 'charcuteria', 'kg', 0, 0, 14, { aka: ['salami milano', 'salami italiano'] }),
  ing('Pepperoni', 'charcuteria', 'kg', 0, 0, 13, { aka: ['peperoni', 'pepperoni en lonchas'] }),
  ing('Guanciale', 'charcuteria', 'kg', 3, 30, 22, { aka: ['papada curada', 'guanchale', 'papada de cerdo curada'] }),
  ing('Panceta curada', 'charcuteria', 'kg', 0, 30, 11, { aka: ['pancetta', 'panceta italiana', 'panceta curada en lonchas'] }),
  ing('Lacón cocido', 'charcuteria', 'kg', 0, 0, 12, { aka: ['lacon', 'lacon gallego', 'lacon cocido gallego'] }),
  ing('Paté de campaña', 'charcuteria', 'kg', 0, 0, 9, { aka: ['pate', 'pate de cerdo', 'pate iberico', 'pate de higado'], alg: ['lacteos'] }),
];
