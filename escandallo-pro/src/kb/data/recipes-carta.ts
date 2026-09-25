import type { KbRecipe } from '../recipes';
import { G, rec } from './build';

/**
 * Platos de carta muy habituales que completan el recetario: cocina regional (Canarias, Extremadura, Galicia, Andalucía,
 * Cataluña), arroces caldosos, pastas con marisco, platos de bistró y cócteles. Gramajes netos por ración de restaurante.
 */
const AOVE = 'Aceite de oliva virgen extra';
const FRITURA = 'Aceite de girasol';
const COCIDA = { cook: 0 };

export const KB_RECIPES_CARTA: KbRecipe[] = [
  // ───────────── Tapas y entrantes ─────────────
  rec('Papas arrugadas con mojo', 'Tapas', 1, [
    ['Patata nueva', 250, 'g', 'neta', COCIDA],
    ['Sal gruesa', 15, 'g', 'neta', { note: 'Cocción en agua muy salada' }],
    ['Ajo', 4, 'g'],
    ['Ñora', 2, 'g'],
    ['Pimentón picante', 1, 'g'],
    ['Comino molido', 0.3, 'g'],
    ['Cilantro', 3, 'g'],
    [AOVE, 25, 'ml'],
    ['Vinagre de vino', 6, 'ml'],
  ], {
    aka: ['papas arrugas', 'papas arrugadas', 'papas con mojo', 'papas arrugadas con mojo picon', 'papas arrugadas con mojo rojo y verde', 'patatas arrugadas', 'papas canarias'],
    proc: [
      'Cocer las papas con piel en poca agua muy salada hasta que se evapore y la piel se arrugue.',
      'Majar ajo, ñora, pimentón y comino con AOVE y vinagre (mojo rojo); ajo, cilantro y AOVE (mojo verde).',
      'Servir las papas calientes con los dos mojos.',
    ],
  }),
  rec('Patatas revolconas', 'Tapas', 4, [
    ['Patata', 1000, 'g', 'neta', COCIDA],
    ['Panceta de cerdo', 200, 'g', 'neta', { note: 'Torreznos' }],
    ['Ajo', 10, 'g'],
    ['Pimentón dulce', 8, 'g'],
    ['Pimentón picante', 2, 'g'],
    [AOVE, 80, 'ml'],
    ['Laurel', 0.5, 'g'],
    ['Sal', 8, 'g'],
  ], {
    aka: ['revolconas', 'patatas meneas', 'patatas machaconas', 'revolconas con torreznos', 'patatas revolconas con torreznos'],
    proc: [
      'Cocer las patatas con laurel y sal; freír la panceta en tiras hasta que esté crujiente.',
      'Dorar el ajo en la grasa, apartar, añadir el pimentón y mezclar con las patatas chafadas y un poco de agua de cocción.',
      'Servir con los torreznos por encima.',
    ],
  }),
  rec('Tequeños', 'Entrantes', 1, [
    ['Masa de empanada', 70, 'g'],
    ['Halloumi', 60, 'g', 'neta', { note: 'Queso blanco duro de freír' }],
    [FRITURA, 30, 'ml', 'neta', { note: 'Fritura' }],
    ['Salsa de chile dulce', 20, 'ml'],
  ], {
    aka: ['tequenos de queso', 'palitos de queso', 'tequeños venezolanos', 'tequeños con salsa'],
    proc: ['Cortar el queso en bastones y envolverlos en espiral con tiras finas de masa.', 'Freír a 180 °C hasta dorar (6 unidades por ración) y servir con la salsa.'],
  }),
  rec('Pan de ajo', 'Entrantes', 1, [
    ['Barra de pan', 0.5, 'ud', 'bruta'],
    ['Mantequilla', 25, 'g'],
    ['Ajo', 5, 'g'],
    ['Perejil', 2, 'g'],
    ['Sal', 0.3, 'g'],
  ], {
    aka: ['pan de ajo gratinado', 'pan con ajo', 'garlic bread', 'pan de ajo casero', 'pan de ajo y perejil'],
    proc: ['Mezclar la mantequilla pomada con ajo rallado, perejil picado y sal.', 'Untar la barra abierta y hornear a 200 °C hasta que esté dorada y crujiente.'],
  }),
  rec('Melón con jamón', 'Entrantes', 1, [
    ['Melón', 250, 'g'],
    ['Jamón serrano loncheado', 50, 'g'],
  ], {
    aka: ['melon con jamon serrano', 'jamon con melon', 'melon con jamon iberico', 'melon de temporada con jamon'],
    proc: ['Pelar el melón, retirar las pepitas y cortar en tajadas.', 'Servir muy frío con el jamón loncheado por encima.'],
  }),
  rec('Carpaccio de pulpo', 'Entrantes', 1, [
    ['Pulpo cocido', 100, 'g'],
    [AOVE, 15, 'ml'],
    ['Pimentón dulce', 0.5, 'g'],
    ['Sal en escamas', 0.5, 'g'],
    ['Cebollino', 1, 'g'],
    ['Limón', 5, 'g'],
  ], {
    aka: ['carpaccio de pulpo con pimenton', 'pulpo en carpaccio', 'carpaccio de pulpo a la gallega'],
    proc: ['Prensar las patas de pulpo cocido en film, congelar ligeramente y laminar muy fino.', 'Aliñar con AOVE, pimentón, escamas de sal, cebollino y unas gotas de limón.'],
  }),
  rec('Tacos de cochinita pibil', 'Entrantes', 6, [
    ['Magro de cerdo', 1000, 'g'],
    ['Achiote', 50, 'g'],
    ['Zumo de naranja', 200, 'ml'],
    ['Lima', 100, 'g'],
    ['Ajo', 10, 'g'],
    ['Comino molido', 2, 'g'],
    ['Orégano', 1, 'g'],
    ['Sal', 10, 'g'],
    ['Tortilla de maíz', 18, 'ud', 'bruta'],
    ['Cebolla morada', 150, 'g'],
    ['Cilantro', 10, 'g'],
    ['Guindilla fresca', 5, 'g', 'neta', { note: 'Habanero' }],
  ], {
    aka: ['cochinita pibil', 'tacos de cochinita', 'taco de cochinita pibil', 'cochinita', 'tacos de cochinita pibil con cebolla encurtida'],
    proc: [
      'Marinar la carne con achiote, zumo de naranja y de lima, ajo y especias 12 h.',
      'Asar tapada a 150 °C unas 4 h y deshilachar con su jugo.',
      'Servir en tortillas de maíz calientes (3 por ración) con cebolla morada encurtida en lima, cilantro y habanero.',
    ],
  }),
  rec('Croquetas de gambas', 'Tapas', 6, [
    ['Leche entera', 800, 'ml'],
    ['Fumet de pescado', 200, 'ml'],
    ['Harina de trigo', 110, 'g'],
    ['Mantequilla', 60, 'g'],
    [AOVE, 40, 'ml'],
    ['Gamba pelada congelada', 250, 'g'],
    ['Cebolla', 80, 'g'],
    ['Brandy', 15, 'ml'],
    ['Nuez moscada', 0.5, 'g'],
    ['Sal', 3, 'g'],
    ['Huevo', 2, 'ud', 'bruta', { note: 'Rebozado' }],
    ['Pan rallado', 150, 'g'],
    [FRITURA, 180, 'ml', 'neta', { note: 'Fritura' }],
  ], {
    aka: ['croquetas de marisco', 'croquetas de langostinos', 'croquetas de gamba', 'croquetas caseras de gambas', 'croquetas de gambas al ajillo'],
    proc: [
      'Pochar la cebolla, saltear las gambas troceadas y flambear con el brandy.',
      'Tostar la harina en la mantequilla y el AOVE, mojar con la leche y el fumet y cocer 10 min; enfriar la masa.',
      'Formar unas 40 croquetas, empanar y freír a 180 °C.',
    ],
  }),
  rec('Esqueixada', 'Ensaladas', 1, [
    ['Bacalao desmigado', 100, 'g'],
    ['Tomate', 120, 'g'],
    ['Cebolleta', 30, 'g'],
    ['Pimiento verde italiano', 30, 'g'],
    ['Pimiento rojo', 30, 'g'],
    ['Aceituna negra', 20, 'g'],
    [AOVE, 20, 'ml'],
    ['Vinagre de Jerez', 5, 'ml'],
  ], {
    aka: ['esqueixada de bacalao', 'ensalada de bacalao', 'esqueixada catalana', 'ensalada de bacalao desmigado'],
    proc: ['Desalar y desmigar el bacalao en crudo; escurrir bien.', 'Mezclar con el tomate, la cebolleta y los pimientos picados y las aceitunas; aliñar al servir.'],
  }),
  rec('Ensalada de quinoa', 'Ensaladas', 1, [
    ['Quinoa', 60, 'g'],
    ['Aguacate', 60, 'g'],
    ['Tomate cherry', 50, 'g'],
    ['Pepino', 40, 'g'],
    ['Cebolla morada', 15, 'g'],
    ['Maíz dulce', 20, 'g'],
    ['Mezclum de lechugas', 30, 'g'],
    ['Lima', 10, 'g'],
    [AOVE, 15, 'ml'],
    ['Sal', 1, 'g'],
  ], {
    aka: ['ensalada de quinoa con aguacate', 'bowl de quinoa', 'quinoa con verduras', 'ensalada de quinoa y aguacate', 'ensalada templada de quinoa'],
    proc: ['Cocer la quinoa lavada 12 min, escurrir y enfriar.', 'Mezclar con las verduras troceadas y el aguacate y aliñar con lima y AOVE.'],
  }),

  // ───────────── Sopas y cremas ─────────────
  rec('Crema de marisco', 'Sopas y cremas', 4, [
    ['Gamba blanca', 300, 'g', 'bruta'],
    ['Langostino crudo', 200, 'g', 'bruta'],
    ['Cebolla', 150, 'g'],
    ['Puerro', 100, 'g'],
    ['Zanahoria', 100, 'g'],
    ['Tomate triturado', 150, 'g'],
    ['Brandy', 50, 'ml'],
    ['Fumet de pescado', 1200, 'ml'],
    ['Arroz redondo', 40, 'g', 'neta', { note: 'Para espesar' }],
    ['Nata para cocinar', 150, 'ml'],
    [AOVE, 40, 'ml'],
    ['Pimentón dulce', 2, 'g'],
    ['Sal', 6, 'g'],
  ], {
    aka: ['crema de mariscos', 'bisque de marisco', 'crema de gambas', 'sopa de marisco cremosa', 'bisque', 'crema de langostinos'],
    proc: [
      'Pelar el marisco y reservar las colas; tostar cabezas y cáscaras en AOVE y flambear con brandy.',
      'Añadir las verduras y el tomate, mojar con el fumet, incorporar el arroz y cocer 25 min.',
      'Triturar, colar fino, añadir la nata y servir con las colas salteadas.',
    ],
  }),

  // ───────────── Arroces y pastas ─────────────
  rec('Arroz caldoso de marisco', 'Arroces', 4, [
    ['Arroz bomba', 320, 'g'],
    ['Gamba blanca', 300, 'g', 'bruta'],
    ['Mejillón', 300, 'g', 'bruta'],
    ['Almeja japónica', 200, 'g', 'bruta'],
    ['Calamar', 250, 'g'],
    ['Cebolla', 100, 'g'],
    ['Pimiento rojo', 60, 'g'],
    ['Tomate triturado', 120, 'g'],
    ['Ajo', 10, 'g'],
    ['Pimentón dulce', 3, 'g'],
    ['Azafrán', 0.3, 'g'],
    ['Brandy', 30, 'ml'],
    ['Fumet de pescado', 2000, 'ml'],
    [AOVE, 60, 'ml'],
    ['Sal', 6, 'g'],
  ], {
    aka: ['arroz caldoso', 'arroz caldoso de mariscos', 'arroz caldoso marinero', 'arroz caldoso con marisco', 'arroz caldoso de pescado y marisco', 'arroz meloso de marisco'],
    proc: [
      'Sofreír el calamar con la cebolla, el pimiento y el ajo; añadir el tomate y el pimentón y flambear con brandy.',
      'Nacarar el arroz, mojar con el fumet caliente con azafrán (unos 500 ml por ración) y cocer 17 min.',
      'Añadir gambas, mejillones y almejas los últimos 4 min; reposar 2 min y servir caldoso.',
    ],
  }),
  rec('Espaguetis con almejas', 'Pastas', 1, [
    ['Espaguetis', 110, 'g'],
    ['Almeja japónica', 200, 'g', 'bruta'],
    ['Ajo', 6, 'g'],
    ['Vino blanco', 40, 'ml'],
    [AOVE, 25, 'ml'],
    ['Perejil', 3, 'g'],
    ['Cayena', 0.2, 'g'],
    ['Sal', 1, 'g'],
  ], {
    aka: ['spaghetti alle vongole', 'espaguetis alle vongole', 'linguine con almejas', 'linguine alle vongole', 'pasta con almejas', 'tallarines con almejas', 'espaguetis a la vongole'],
    proc: [
      'Cocer la pasta al dente en agua con sal.',
      'Dorar el ajo laminado con la cayena en AOVE y abrir las almejas con el vino blanco, tapadas.',
      'Saltear la pasta en la salsa con un poco de agua de cocción y terminar con perejil picado.',
    ],
  }),

  // ───────────── Carnes ─────────────
  rec('Solomillo al whisky', 'Carnes', 1, [
    ['Solomillo de cerdo', 200, 'g'],
    ['Ajo', 15, 'g'],
    ['Whisky', 40, 'ml'],
    ['Caldo de pollo', 60, 'ml'],
    ['Zumo de limón', 5, 'ml'],
    [AOVE, 25, 'ml'],
    ['Sal', 1.5, 'g'],
    ['Patata', 150, 'g', 'neta', G],
    [FRITURA, 25, 'ml', 'neta', G],
  ], {
    aka: ['solomillo de cerdo al whisky', 'solomillo al whisky con patatas', 'solomillo al wiski', 'solomillo al guisqui', 'solomillo al whisky sevillano'],
    proc: [
      'Dorar los ajos laminados en AOVE y reservar; marcar el solomillo en medallones.',
      'Añadir el whisky, el caldo, el limón y los ajos; reducir 5 min hasta ligar la salsa.',
      'Servir con patatas fritas para mojar en la salsa.',
    ],
  }),
  rec('Solomillo Wellington', 'Carnes', 4, [
    ['Solomillo de ternera', 800, 'g'],
    ['Masa de hojaldre', 400, 'g'],
    ['Champiñón', 400, 'g'],
    ['Chalota', 60, 'g'],
    ['Jamón serrano loncheado', 80, 'g'],
    ['Mostaza de Dijon', 30, 'g'],
    ['Huevo', 1, 'ud', 'bruta', { note: 'Para pintar' }],
    ['Mantequilla', 30, 'g'],
    [AOVE, 20, 'ml'],
    ['Tomillo', 1, 'g'],
    ['Vino de Oporto', 100, 'ml'],
    ['Fondo oscuro', 200, 'ml'],
    ['Sal', 6, 'g'],
    ['Pimienta negra molida', 1, 'g'],
  ], {
    aka: ['wellington', 'solomillo en hojaldre', 'beef wellington', 'solomillo de ternera wellington'],
    proc: [
      'Marcar el solomillo entero, pintarlo con mostaza y enfriar; preparar una duxelles seca de champiñón y chalota.',
      'Envolver en jamón y duxelles, después en hojaldre; pintar con huevo y hornear a 200 °C unos 25 min (punto rosado).',
      'Reposar 10 min, cortar en 4 raciones y servir con la salsa de Oporto reducida con el fondo.',
    ],
  }),
  rec('Pato a la naranja', 'Carnes', 1, [
    ['Magret de pato', 250, 'g'],
    ['Zumo de naranja', 80, 'ml'],
    ['Naranja', 60, 'g', 'neta', { note: 'Gajos y piel confitada' }],
    ['Azúcar', 10, 'g'],
    ['Vinagre de Jerez', 5, 'ml'],
    ['Fondo oscuro', 40, 'ml'],
    ['Licor de naranja', 10, 'ml'],
    ['Mantequilla', 10, 'g'],
    ['Sal en escamas', 1, 'g'],
    ['Patata', 150, 'g', 'neta', { garnish: true, cook: 30 }],
  ], {
    aka: ['magret de pato a la naranja', 'canard a l orange', 'pato con salsa de naranja', 'magret a la naranja'],
    proc: [
      'Hacer un caramelo con el azúcar, desglasar con el vinagre y añadir el zumo, el fondo y el licor; reducir y montar con mantequilla.',
      'Marcar el magret piel abajo 8 min y 3 min por el otro lado; reposar y lonchear.',
      'Servir con la salsa, los gajos de naranja y patatas panaderas.',
    ],
  }),
  rec('Pollo en pepitoria', 'Carnes', 4, [
    ['Pollo troceado', 1400, 'g'],
    ['Almendra marcona', 60, 'g'],
    ['Huevo', 2, 'ud', 'bruta', { note: 'Yemas cocidas para la picada' }],
    ['Pan de hogaza', 30, 'g'],
    ['Cebolla', 200, 'g'],
    ['Ajo', 10, 'g'],
    ['Vino fino', 150, 'ml'],
    ['Caldo de pollo', 400, 'ml'],
    ['Azafrán', 0.2, 'g'],
    ['Harina de trigo', 20, 'g'],
    [AOVE, 60, 'ml'],
    ['Laurel', 0.5, 'g'],
    ['Sal', 8, 'g'],
  ], {
    aka: ['pollo a la pepitoria', 'gallina en pepitoria', 'pepitoria de pollo'],
    proc: [
      'Enharinar y dorar el pollo; reservar y pochar la cebolla y el ajo.',
      'Mojar con el vino fino y el caldo, añadir el pollo y el laurel y guisar 35 min.',
      'Espesar con una picada de almendra, pan frito, yemas cocidas y azafrán.',
    ],
  }),
  rec('Pollo al chilindrón', 'Carnes', 4, [
    ['Pollo troceado', 1400, 'g'],
    ['Pimiento rojo', 400, 'g'],
    ['Cebolla', 250, 'g'],
    ['Tomate triturado', 300, 'g'],
    ['Taquitos de jamón', 80, 'g'],
    ['Ajo', 15, 'g'],
    ['Pimiento choricero', 20, 'g'],
    ['Vino blanco', 150, 'ml'],
    [AOVE, 60, 'ml'],
    ['Laurel', 0.5, 'g'],
    ['Sal', 10, 'g'],
  ], {
    aka: ['chilindron de pollo', 'pollo chilindron', 'pollo al chilindron con pimientos'],
    proc: [
      'Dorar el pollo salpimentado y reservar; sofreír el jamón, la cebolla, el ajo y el pimiento en tiras.',
      'Añadir la carne del choricero y el tomate, mojar con el vino blanco y guisar el pollo 40 min a fuego suave.',
    ],
  }),
  rec('Lacón a la gallega', 'Raciones', 1, [
    ['Lacón cocido', 180, 'g'],
    ['Patata', 150, 'g', 'neta', COCIDA],
    ['Pimentón dulce', 1.5, 'g'],
    ['Sal gruesa', 2, 'g'],
    [AOVE, 15, 'ml'],
  ], {
    aka: ['lacon con cachelos', 'lacon a feira', 'lacon gallego', 'lacon', 'lacon con pimenton'],
    proc: ['Calentar el lacón cocido en su caldo y cortarlo en lonchas finas.', 'Servir sobre cachelos con sal gruesa, pimentón y AOVE.'],
  }),
  rec('Migas extremeñas', 'Raciones', 4, [
    ['Pan de hogaza', 600, 'g', 'neta', { note: 'Pan del día anterior' }],
    ['Panceta de cerdo', 200, 'g'],
    ['Chorizo para guisar', 200, 'g'],
    ['Pimiento verde italiano', 150, 'g'],
    ['Ajo', 20, 'g'],
    [AOVE, 100, 'ml'],
    ['Pimentón dulce', 3, 'g'],
    ['Sal', 4, 'g'],
    ['Uva', 150, 'g', 'neta', G],
  ], {
    aka: ['migas', 'migas de pastor', 'migas manchegas', 'migas con chorizo', 'migas con uvas', 'migas del pastor'],
    proc: [
      'Picar el pan en dados pequeños, humedecer con agua con sal y tapar con un paño 12 h.',
      'Freír la panceta, el chorizo y el pimiento; dorar el ajo y rehogar el pan a fuego medio removiendo 20 min.',
      'Añadir el pimentón al final y servir con uvas.',
    ],
  }),
  rec('Lomo mechado', 'Carnes', 6, [
    ['Lomo de cerdo', 1200, 'g'],
    ['Tocino', 80, 'g'],
    ['Ajo', 20, 'g'],
    ['Cebolla', 300, 'g'],
    ['Zanahoria', 200, 'g'],
    ['Vino fino', 200, 'ml'],
    ['Caldo de pollo', 300, 'ml'],
    [AOVE, 60, 'ml'],
    ['Laurel', 1, 'g'],
    ['Pimienta negra en grano', 2, 'g'],
    ['Sal', 12, 'g'],
  ], {
    aka: ['carne mechada', 'lomo de cerdo mechado', 'carne mechada andaluza', 'lomo mechado al vino fino'],
    proc: [
      'Mechar la cinta de lomo con tiras de tocino y ajo; atar y dorar entera.',
      'Añadir la verdura, el vino fino, el caldo y las especias y cocer tapado 1 h 15 min.',
      'Enfriar, cortar fino y servir con su salsa triturada.',
    ],
  }),

  // ───────────── Pescados ─────────────
  rec('Merluza a la plancha', 'Pescados', 1, [
    ['Lomo de merluza', 180, 'g'],
    [AOVE, 10, 'ml'],
    ['Ajo', 2, 'g'],
    ['Perejil', 1, 'g'],
    ['Sal', 1, 'g'],
    ['Calabacín', 50, 'g', 'neta', G],
    ['Zanahoria', 40, 'g', 'neta', G],
    ['Judía verde', 40, 'g', 'neta', G],
  ], {
    aka: ['lomo de merluza a la plancha', 'merluza plancha', 'merluza a la plancha con verduras', 'merluza con verduras', 'lomo de merluza con verduras', 'merluza a la parrilla'],
    proc: ['Marcar el lomo de merluza por el lado de la piel y terminar 1 min por el otro.', 'Napar con un ajillo de AOVE, ajo y perejil y servir con las verduras salteadas.'],
  }),
  rec('Salmón al horno', 'Pescados', 1, [
    ['Lomo de salmón', 180, 'g'],
    [AOVE, 15, 'ml'],
    ['Limón', 15, 'g'],
    ['Eneldo', 1, 'g'],
    ['Sal', 1, 'g'],
    ['Patata', 150, 'g', 'neta', { garnish: true, cook: 20 }],
  ], {
    aka: ['lomo de salmon al horno', 'salmon asado', 'salmon al horno con patatas', 'salmon horneado'],
    proc: ['Asar las patatas en rodajas 20 min a 200 °C.', 'Colocar el salmón encima con limón y eneldo y hornear 8–10 min.'],
  }),
  rec('Bacalao a la llauna', 'Pescados', 1, [
    ['Bacalao desalado', 200, 'g'],
    ['Harina de trigo', 15, 'g'],
    ['Ajo', 8, 'g'],
    ['Pimentón dulce', 1.5, 'g'],
    ['Vino blanco', 40, 'ml'],
    [AOVE, 40, 'ml'],
    ['Perejil', 2, 'g'],
  ], {
    aka: ['bacalla a la llauna', 'bacalao a la llauna con judias', 'bacalao a la llauna con mongetes'],
    proc: ['Enharinar y freír el bacalao en AOVE; pasarlo a una bandeja metálica (llauna).', 'Dorar el ajo, añadir pimentón y vino blanco, napar el bacalao y hornear 5 min con perejil.'],
  }),

  // ───────────── Bocadillos ─────────────
  rec('Bocadillo de lomo', 'Bocadillos y hamburguesas', 1, [
    ['Pan de bocadillo', 1, 'ud', 'bruta'],
    ['Lomo de cerdo', 100, 'g'],
    [AOVE, 5, 'ml'],
    ['Sal', 0.5, 'g'],
  ], {
    aka: ['bocata de lomo', 'bocadillo de lomo adobado', 'bocadillo de lomo a la plancha', 'montado de lomo'],
    proc: ['Marcar los filetes de lomo a la plancha con unas gotas de AOVE y sal.', 'Servir en el pan abierto y caliente.'],
  }),

  // ───────────── Postres ─────────────
  rec('Profiteroles con chocolate', 'Postres', 8, [
    ['Harina de trigo', 150, 'g'],
    ['Mantequilla', 100, 'g'],
    ['Huevo', 4, 'ud', 'bruta'],
    ['Nata para montar 35 %', 400, 'ml'],
    ['Azúcar', 80, 'g'],
    ['Cobertura de chocolate negro', 200, 'g'],
    ['Leche entera', 250, 'ml'],
    ['Sal', 1, 'g'],
  ], {
    aka: ['profiteroles', 'profiteroles rellenos de nata', 'lionesas', 'profiteroles de nata con chocolate caliente'],
    proc: [
      'Hacer la pasta choux: hervir agua, mantequilla y sal, añadir la harina y después los huevos uno a uno.',
      'Formar bolitas y hornear a 190 °C 20 min; rellenar con nata montada con azúcar.',
      'Servir con salsa de chocolate caliente (cobertura fundida con leche).',
    ],
  }),
  rec('Tarta de limón', 'Postres', 10, [
    ['Galleta María', 250, 'g'],
    ['Mantequilla', 100, 'g'],
    ['Leche condensada', 370, 'g'],
    ['Limón', 350, 'g', 'bruta', { note: 'Zumo y ralladura' }],
    ['Huevo', 4, 'ud', 'bruta'],
    ['Azúcar', 150, 'g'],
    ['Sal', 1, 'g'],
  ], {
    aka: ['lemon pie', 'tarta de limon y merengue', 'pastel de limon', 'tarta de limon con merengue', 'lemon pie con merengue'],
    proc: [
      'Forrar el molde con galleta triturada y mantequilla fundida.',
      'Mezclar la leche condensada con las yemas, el zumo y la ralladura; hornear 15 min a 170 °C.',
      'Cubrir con merengue de claras y azúcar y gratinar; enfriar 4 h.',
    ],
  }),

  // ───────────── Cócteles ─────────────
  rec('Caipiriña', 'Cócteles', 1, [
    ['Cachaza', 60, 'ml'],
    ['Lima', 60, 'g'],
    ['Azúcar moreno', 15, 'g'],
    ['Hielo', 200, 'g', 'bruta'],
  ], {
    aka: ['caipirinha', 'caipirina', 'caipiriña de lima'],
    proc: ['Majar la lima en cuartos con el azúcar en el vaso.', 'Llenar de hielo picado, añadir la cachaza y remover.'],
  }),
];
