import type { KbRecipeItem } from '../recipes';
import { type ItemTuple, rec } from './build';

/**
 * Elaboraciones básicas (guarniciones, salsas y bases) POR RACIÓN, para la propuesta heurística:
 * cuando una carta dice "con patatas panaderas" o "salsa de Oporto", se desglosan en sus ingredientes reales.
 */
export type PreparationRole = 'guarnicion' | 'salsa' | 'base';

export interface KbPreparation {
  name: string;
  aliases: string[];
  role: PreparationRole;
  items: KbRecipeItem[];
  /** Sólo cuenta si aparece como acompañamiento (tras "con", "y", "sobre"…), nunca como nombre del plato. */
  tailOnly?: boolean;
}

const AOVE = 'Aceite de oliva virgen extra';

function prep(name: string, role: PreparationRole, items: ItemTuple[], aliases: string[] = [], tailOnly = false): KbPreparation {
  const r = rec(name, 'Elaboraciones', 1, items);
  const p: KbPreparation = { name, aliases, role, items: r.items };
  if (tailOnly) p.tailOnly = true;
  return p;
}

export const KB_PREPARATIONS: KbPreparation[] = [
  // ── Guarniciones ──
  prep('Patatas fritas', 'guarnicion', [['Patata', 150, 'g'], ['Aceite de girasol', 20, 'ml', 'neta', { note: 'Fritura' }]], [
    'patata frita', 'patatas fritas caseras', 'patatas baston', 'patatas paja', 'patatas chips', 'papas fritas',
  ]),
  prep('Patatas panaderas', 'guarnicion', [
    ['Patata', 150, 'g', 'neta', { cook: 30 }],
    ['Cebolla', 40, 'g'],
    ['Pimiento verde italiano', 20, 'g'],
    [AOVE, 20, 'ml'],
  ], ['patata panadera', 'panaderas', 'patatas a lo pobre', 'patatas pobres', 'patatas confitadas']),
  prep('Patatas asadas', 'guarnicion', [['Patata', 180, 'g', 'neta', { cook: 20 }], [AOVE, 10, 'ml'], ['Romero', 0.5, 'g']], [
    'patata asada', 'patatas al horno', 'patata al horno', 'patatas asadas al romero', 'patata rota', 'patatas rotas',
  ]),
  prep('Patatas gajo', 'guarnicion', [['Patata prefrita congelada', 150, 'g'], ['Aceite de girasol', 20, 'ml']], ['patata gajo', 'patatas deluxe', 'gajos de patata']),
  prep('Puré de patata', 'guarnicion', [
    ['Patata', 150, 'g', 'neta', { cook: 0 }],
    ['Mantequilla', 15, 'g'],
    ['Leche entera', 40, 'ml'],
    ['Nuez moscada', 0.1, 'g'],
  ], ['pure de patata', 'pure de patatas', 'parmentier', 'parmentier de patata', 'pure de patata trufado', 'pure casero', 'pure de patata casero']),
  prep('Cachelos', 'guarnicion', [['Patata', 150, 'g', 'neta', { cook: 0 }], [AOVE, 5, 'ml'], ['Pimentón dulce', 0.5, 'g']], [
    'cachelo', 'patata cocida', 'patatas cocidas', 'patatas a la gallega',
  ]),
  prep('Arroz blanco', 'guarnicion', [['Arroz basmati', 70, 'g'], [AOVE, 3, 'ml']], ['arroz basmati', 'arroz jazmin', 'arroz pilaf', 'arroz hervido', 'arroz blanco hervido']),
  prep('Verduras salteadas', 'guarnicion', [
    ['Calabacín', 40, 'g'],
    ['Zanahoria', 30, 'g'],
    ['Judía verde', 30, 'g'],
    ['Pimiento rojo', 20, 'g'],
    [AOVE, 10, 'ml'],
  ], ['verdura', 'verduras', 'verduritas', 'verduras de temporada', 'salteado de verduras', 'wok de verduras', 'verduras al wok', 'verduras de la huerta', 'hortalizas']),
  prep('Verduras a la brasa', 'guarnicion', [
    ['Calabacín', 50, 'g'],
    ['Berenjena', 40, 'g'],
    ['Pimiento rojo', 40, 'g'],
    ['Cebolla', 30, 'g'],
    [AOVE, 10, 'ml'],
  ], ['verduras a la plancha', 'verduras asadas', 'verduras a la parrilla', 'parrillada de verduras', 'verduras braseadas', 'verduras al horno']),
  prep('Pisto', 'guarnicion', [
    ['Calabacín', 50, 'g'],
    ['Pimiento rojo', 30, 'g'],
    ['Pimiento verde italiano', 30, 'g'],
    ['Cebolla', 40, 'g'],
    ['Tomate triturado', 50, 'g'],
    [AOVE, 15, 'ml'],
  ], ['pisto manchego', 'samfaina', 'ratatouille', 'pisto de verduras']),
  prep('Escalivada', 'guarnicion', [['Pimiento rojo', 60, 'g'], ['Berenjena', 50, 'g'], ['Cebolla', 30, 'g'], [AOVE, 10, 'ml']], ['escalivada catalana']),
  prep('Ensalada de guarnición', 'guarnicion', [
    ['Mezclum de lechugas', 40, 'g'],
    ['Tomate', 30, 'g'],
    ['Cebolla', 10, 'g'],
    [AOVE, 5, 'ml'],
    ['Vinagre de vino', 2, 'ml'],
  ], ['ensalada', 'ensalada verde', 'guarnicion de ensalada', 'ensalada mixta', 'ensaladita'], true),
  prep('Espinacas a la crema', 'guarnicion', [['Espinaca', 150, 'g'], ['Nata para cocinar', 30, 'ml'], ['Mantequilla', 5, 'g']], ['crema de espinacas']),
  prep('Cebolla caramelizada', 'guarnicion', [['Cebolla', 80, 'g', 'neta', { cook: 50 }], ['Azúcar', 5, 'g'], ['Mantequilla', 5, 'g']], [
    'cebolla confitada', 'confitura de cebolla', 'cebolla pochada', 'mermelada de cebolla',
  ]),
  prep('Pimientos confitados', 'guarnicion', [['Pimiento rojo', 80, 'g'], [AOVE, 10, 'ml']], ['pimientos rojos confitados', 'pimientos asados caseros']),
  prep('Cuscús de guarnición', 'guarnicion', [['Cuscús', 60, 'g'], ['Caldo de verduras', 60, 'ml'], [AOVE, 5, 'ml']], ['cuscus', 'cous cous', 'couscous']),
  prep('Pico de gallo', 'guarnicion', [
    ['Tomate', 40, 'g'],
    ['Cebolla morada', 15, 'g'],
    ['Cilantro', 1, 'g'],
    ['Lima', 5, 'g'],
    ['Guindilla fresca', 1, 'g'],
  ], ['pico de gallo mexicano']),
  prep('Guacamole', 'salsa', [
    ['Aguacate', 60, 'g'],
    ['Tomate', 15, 'g'],
    ['Cebolla morada', 10, 'g'],
    ['Cilantro', 1, 'g'],
    ['Lima', 5, 'g'],
    ['Sal', 0.5, 'g'],
  ], ['guacamole casero']),

  // ── Salsas ──
  prep('Salsa de Oporto', 'salsa', [['Vino de Oporto', 40, 'ml'], ['Fondo oscuro', 40, 'ml'], ['Mantequilla', 10, 'g'], ['Chalota', 10, 'g']], [
    'reduccion de oporto', 'salsa al oporto', 'salsa oporto',
  ]),
  prep('Salsa de Pedro Ximénez', 'salsa', [['Pedro Ximénez', 40, 'ml'], ['Fondo oscuro', 40, 'ml'], ['Mantequilla', 10, 'g']], [
    'reduccion de pedro ximenez', 'salsa px', 'salsa al pedro ximenez', 'al pedro ximenez',
  ]),
  prep('Salsa de vino tinto', 'salsa', [['Vino tinto joven', 60, 'ml'], ['Fondo oscuro', 40, 'ml'], ['Chalota', 10, 'g'], ['Mantequilla', 10, 'g']], [
    'reduccion de vino tinto', 'al vino tinto', 'salsa al vino tinto',
  ]),
  prep('Salsa a la pimienta', 'salsa', [
    ['Nata para cocinar', 60, 'ml'],
    ['Pimienta verde en grano', 5, 'g'],
    ['Brandy', 10, 'ml'],
    ['Fondo oscuro', 30, 'ml'],
  ], ['salsa de pimienta', 'salsa pimienta', 'a la pimienta', 'salsa de pimienta verde', 'a la pimienta verde', 'salsa a la pimienta verde']),
  prep('Salsa de queso azul', 'salsa', [['Queso azul', 30, 'g'], ['Nata para cocinar', 60, 'ml']], [
    'salsa de cabrales', 'salsa de roquefort', 'al cabrales', 'salsa roquefort', 'salsa de queso', 'salsa de gorgonzola', 'salsa cuatro quesos', 'salsa de queso de cabrales',
  ]),
  prep('Salsa de setas', 'salsa', [['Setas variadas', 40, 'g'], ['Nata para cocinar', 50, 'ml'], ['Chalota', 10, 'g']], [
    'salsa de boletus', 'salsa de hongos', 'salsa de champiñones', 'crema de boletus',
  ]),
  prep('Salsa verde', 'salsa', [
    ['Perejil', 8, 'g'],
    ['Ajo', 4, 'g'],
    ['Harina de trigo', 3, 'g'],
    ['Vino blanco', 30, 'ml'],
    ['Fumet de pescado', 80, 'ml'],
    [AOVE, 20, 'ml'],
  ], ['en salsa verde']),
  prep('Salsa marinera', 'salsa', [
    ['Cebolla', 40, 'g'],
    ['Ajo', 3, 'g'],
    ['Tomate triturado', 40, 'g'],
    ['Vino blanco', 30, 'ml'],
    ['Fumet de pescado', 60, 'ml'],
    ['Pimentón dulce', 0.5, 'g'],
    [AOVE, 15, 'ml'],
  ], ['a la marinera', 'en salsa marinera']),
  prep('Salsa vizcaína', 'salsa', [['Pimiento choricero', 20, 'g'], ['Cebolla', 80, 'g'], ['Tomate triturado', 20, 'g'], [AOVE, 20, 'ml']], [
    'a la vizcaina', 'salsa vizcaina',
  ]),
  prep('Pil pil', 'salsa', [[AOVE, 60, 'ml'], ['Ajo', 6, 'g'], ['Cayena', 0.2, 'g']], ['pilpil', 'al pil pil', 'salsa pil pil']),
  prep('Salsa de tomate casera', 'salsa', [['Tomate triturado', 80, 'g'], ['Cebolla', 20, 'g'], [AOVE, 10, 'ml'], ['Azúcar', 2, 'g']], [
    'salsa de tomate', 'tomate casero', 'salsa pomodoro', 'salsa de tomate natural',
  ]),
  prep('Salsa brava', 'salsa', [
    ['Tomate triturado', 30, 'g'],
    ['Cebolla', 10, 'g'],
    ['Pimentón picante', 1, 'g'],
    ['Pimentón dulce', 0.5, 'g'],
    [AOVE, 8, 'ml'],
  ], ['salsa brava casera', 'brava']),
  prep('Romesco', 'salsa', [
    ['Tomate', 40, 'g'],
    ['Ñora', 3, 'g'],
    ['Almendra marcona', 10, 'g'],
    ['Avellana', 5, 'g'],
    ['Ajo', 3, 'g'],
    ['Pan de hogaza', 5, 'g'],
    [AOVE, 20, 'ml'],
    ['Vinagre de Jerez', 3, 'ml'],
  ], ['salsa romesco', 'salvitxada', 'salsa de calçots']),
  prep('Mojo picón', 'salsa', [
    ['Guindilla fresca', 2, 'g'],
    ['Ajo', 3, 'g'],
    ['Comino molido', 0.3, 'g'],
    ['Pimentón dulce', 1, 'g'],
    [AOVE, 20, 'ml'],
    ['Vinagre de vino', 5, 'ml'],
  ], ['mojo picon', 'mojo rojo', 'mojo']),
  prep('Mojo verde', 'salsa', [
    ['Cilantro', 3, 'g'],
    ['Pimiento verde italiano', 10, 'g'],
    ['Ajo', 2, 'g'],
    [AOVE, 20, 'ml'],
    ['Vinagre de vino', 5, 'ml'],
    ['Comino molido', 0.2, 'g'],
  ], ['mojo de cilantro']),
  prep('Chimichurri', 'salsa', [
    ['Perejil', 4, 'g'],
    ['Orégano', 0.5, 'g'],
    ['Ajo', 2, 'g'],
    ['Cayena', 0.2, 'g'],
    [AOVE, 20, 'ml'],
    ['Vinagre de vino', 5, 'ml'],
  ], ['salsa chimichurri']),
  prep('Vinagreta', 'salsa', [[AOVE, 15, 'ml'], ['Vinagre de Jerez', 5, 'ml'], ['Mostaza de Dijon', 2, 'g'], ['Cebolleta', 5, 'g']], [
    'vinagreta de mostaza', 'vinagreta de hierbas', 'alino', 'vinagreta de frutos secos',
  ]),
  prep('Salsa tártara', 'salsa', [['Mayonesa', 30, 'g'], ['Pepinillo', 5, 'g'], ['Alcaparras', 3, 'g'], ['Cebolleta', 5, 'g'], ['Perejil', 1, 'g']], [
    'salsa tartara', 'tartara',
  ]),
  prep('Salsa de yogur', 'salsa', [['Yogur griego', 40, 'g'], ['Pepino', 10, 'g'], ['Eneldo', 0.5, 'g'], ['Ajo', 1, 'g'], ['Limón', 3, 'g']], [
    'tzatziki', 'salsa tzatziki', 'salsa de yogur griego',
  ]),
  prep('Salsa holandesa', 'salsa', [['Yema pasteurizada', 15, 'g'], ['Mantequilla', 30, 'g'], ['Limón', 3, 'g']], ['holandesa', 'bearnesa', 'salsa bearnesa']),
  prep('Bechamel', 'salsa', [['Leche entera', 80, 'ml'], ['Harina de trigo', 6, 'g'], ['Mantequilla', 6, 'g'], ['Nuez moscada', 0.1, 'g']], [
    'besamel', 'salsa bechamel', 'bechamel gratinada',
  ]),
  prep('Salsa de curry', 'salsa', [['Leche de coco', 60, 'ml'], ['Curry', 2, 'g'], ['Cebolla', 20, 'g']], ['al curry', 'salsa curry']),
  prep('Salsa de mostaza', 'salsa', [['Nata para cocinar', 50, 'ml'], ['Mostaza antigua', 10, 'g']], ['a la mostaza', 'salsa mostaza', 'salsa de mostaza antigua']),
  prep('Salsa de trufa', 'salsa', [['Nata para cocinar', 50, 'ml'], ['Aceite de trufa', 2, 'ml'], ['Trufa negra', 1, 'g']], ['crema de trufa', 'salsa trufada']),
  prep('Salsa de naranja', 'salsa', [['Zumo de naranja', 60, 'ml'], ['Azúcar', 5, 'g'], ['Fondo oscuro', 30, 'ml'], ['Licor de naranja', 5, 'ml']], [
    'a la naranja', 'salsa a la naranja',
  ]),
  prep('Coulis de frutos rojos', 'salsa', [['Frutos rojos congelados', 40, 'g'], ['Azúcar', 8, 'g']], ['salsa de frutos rojos', 'coulis', 'coulis de frambuesa']),
  prep('Salsa de chocolate', 'salsa', [['Chocolate negro 70 %', 25, 'g'], ['Nata para montar 35 %', 30, 'ml']], ['chocolate caliente', 'ganache']),
  prep('Ajoblanco (salsa)', 'salsa', [
    ['Almendra marcona', 25, 'g'],
    ['Pan de hogaza', 12, 'g'],
    ['Ajo', 1, 'g'],
    [AOVE, 18, 'ml'],
    ['Vinagre de Jerez', 4, 'ml'],
  ], ['ajoblanco', 'ajo blanco']),
  prep('Salmorejo (salsa)', 'salsa', [['Tomate pera', 120, 'g'], ['Pan de hogaza', 25, 'g'], [AOVE, 18, 'ml'], ['Ajo', 1, 'g']], ['salmorejo']),
  prep('Mayonesa de sriracha', 'salsa', [['Mayonesa', 20, 'g'], ['Sriracha', 5, 'ml']], ['mayo sriracha', 'mayonesa picante', 'mayonesa de chipotle', 'mayonesa de kimchi']),
  prep('Leche de tigre', 'salsa', [
    ['Lima', 40, 'g', 'neta', { waste: 50 }],
    ['Ajo', 1, 'g'],
    ['Jengibre', 1, 'g'],
    ['Cilantro', 1, 'g'],
    ['Guindilla fresca', 1, 'g'],
  ], ['leche de tigre']),
  prep('Muselina de ajo', 'salsa', [['Alioli', 30, 'g']], ['muselina', 'alioli gratinado', 'muselina de alioli']),

  // ── Bases ──
  prep('Sofrito', 'base', [['Cebolla', 30, 'g'], ['Tomate triturado', 30, 'g'], ['Ajo', 2, 'g'], [AOVE, 10, 'ml']], ['sofrito de tomate']),
  prep('Picada', 'base', [['Almendra marcona', 5, 'g'], ['Ajo', 1, 'g'], ['Perejil', 1, 'g'], ['Pan de hogaza', 3, 'g']], ['picada catalana']),
];
