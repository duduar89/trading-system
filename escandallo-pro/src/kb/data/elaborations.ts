import type { BaseUnit } from '../../types';
import type { KbRecipe } from '../recipes';
import { rec } from './build';

/**
 * Elaboraciones de base de cocina profesional (fondos, fumets, emulsiones, masas, cremas) POR LOTE, con el rendimiento
 * que da cada lote. Sólo se usan al proponer una ELABORACIÓN con ese nombre ("Fondo oscuro", "Crema pastelera"…):
 * en un plato de carta estos nombres son un ingrediente que se compra hecho o una elaboración propia ya creada.
 * El rendimiento es imprescindible porque el agua no es un ingrediente con coste: 2 kg de huesos dan 2 l de fondo.
 */
export interface KbElaboration extends KbRecipe {
  yieldQty: number;
  yieldUnit: BaseUnit;
}

const AOVE = 'Aceite de oliva virgen extra';

function elab(name: string, yieldQty: number, yieldUnit: BaseUnit, items: Parameters<typeof rec>[3], aka: string[], proc: string[]): KbElaboration {
  return { ...rec(name, 'Elaboraciones', 1, items, { aka, proc }), yieldQty, yieldUnit };
}

export const KB_ELABORATIONS: KbElaboration[] = [
  elab(
    'Fondo oscuro',
    2,
    'l',
    [
      ['Huesos de ternera', 2, 'kg', 'bruta'],
      ['Zanahoria', 200, 'g'],
      ['Cebolla', 200, 'g'],
      ['Puerro', 150, 'g'],
      ['Apio', 100, 'g'],
      ['Tomate concentrado', 40, 'g'],
      ['Vino tinto joven', 250, 'ml'],
      ['Laurel', 1, 'g'],
      ['Pimienta negra en grano', 2, 'g'],
      ['Aceite de girasol', 30, 'ml'],
    ],
    ['fondo oscuro de ternera', 'fondo de ternera', 'fondo de carne', 'caldo oscuro', 'jugo de carne', 'fondo oscuro de vaca'],
    ['Tostar los huesos al horno a 220 °C hasta que estén dorados.', 'Rehogar las verduras con el concentrado de tomate y desglasar con el vino.', 'Cubrir con agua fría y cocer 6 horas a fuego suave, desespumando.', 'Colar y reducir hasta el rendimiento indicado.'],
  ),
  elab(
    'Fondo blanco de ave',
    3,
    'l',
    [
      ['Carcasa de pollo', 2, 'kg', 'bruta'],
      ['Zanahoria', 200, 'g'],
      ['Cebolla', 200, 'g'],
      ['Puerro', 200, 'g'],
      ['Apio', 100, 'g'],
      ['Laurel', 1, 'g'],
      ['Pimienta negra en grano', 2, 'g'],
      ['Sal', 10, 'g'],
    ],
    ['caldo de pollo', 'caldo de ave', 'fondo de ave', 'fondo blanco', 'fondo de pollo', 'caldo blanco de ave'],
    ['Blanquear las carcasas y escurrir.', 'Cubrir con 4 l de agua fría, añadir las verduras y cocer 3 horas sin que hierva a borbotones.', 'Desespumar, colar y desgrasar.'],
  ),
  elab(
    'Fumet de pescado',
    3,
    'l',
    [
      ['Espinas y cabezas de pescado', 1.5, 'kg', 'bruta'],
      ['Cebolla', 150, 'g'],
      ['Puerro', 150, 'g'],
      ['Zanahoria', 100, 'g'],
      ['Vino blanco', 200, 'ml'],
      ['Perejil', 10, 'g'],
      ['Laurel', 1, 'g'],
      [AOVE, 30, 'ml'],
    ],
    ['fumet', 'caldo de pescado', 'fondo de pescado', 'fumet blanco'],
    ['Limpiar las espinas y cabezas de sangre y agallas.', 'Rehogar las verduras sin que tomen color, añadir las espinas y el vino.', 'Cubrir con agua fría y cocer 25 minutos, desespumando. Colar sin apretar.'],
  ),
  elab(
    'Caldo de verduras',
    3,
    'l',
    [
      ['Zanahoria', 300, 'g'],
      ['Cebolla', 300, 'g'],
      ['Puerro', 300, 'g'],
      ['Apio', 150, 'g'],
      ['Tomate', 200, 'g'],
      ['Laurel', 1, 'g'],
      ['Pimienta negra en grano', 2, 'g'],
      [AOVE, 20, 'ml'],
      ['Sal', 10, 'g'],
    ],
    ['fondo de verduras', 'caldo vegetal', 'fondo vegetal', 'caldo de hortalizas'],
    ['Trocear las verduras y rehogarlas en el aceite.', 'Cubrir con 3,5 l de agua y cocer 45 minutos.', 'Colar y rectificar de sal.'],
  ),
  elab(
    'Alioli',
    0.5,
    'kg',
    [
      ['Ajo', 20, 'g'],
      ['Huevo', 1, 'ud', 'bruta'],
      ['Aceite de girasol', 350, 'ml'],
      [AOVE, 80, 'ml'],
      ['Zumo de limón', 10, 'ml'],
      ['Sal', 4, 'g'],
    ],
    ['allioli', 'all i oli', 'ali oli', 'salsa alioli', 'ajoaceite'],
    ['Triturar los ajos pelados con el huevo, el limón y la sal.', 'Emulsionar añadiendo los aceites en hilo.', 'Guardar en frío, tapado.'],
  ),
  elab(
    'Mayonesa',
    0.5,
    'kg',
    [
      ['Huevo', 1, 'ud', 'bruta'],
      ['Aceite de girasol', 450, 'ml'],
      ['Vinagre de vino', 10, 'ml'],
      ['Zumo de limón', 5, 'ml'],
      ['Mostaza de Dijon', 5, 'g'],
      ['Sal', 4, 'g'],
    ],
    ['mahonesa', 'salsa mayonesa', 'mayonesa casera'],
    ['Poner el huevo, la mostaza, el vinagre y la sal en el vaso.', 'Emulsionar con el aceite en hilo hasta que espese.', 'Ajustar con el limón y guardar en frío.'],
  ),
  elab(
    'Crema pastelera',
    1,
    'kg',
    [
      ['Leche entera', 750, 'ml'],
      ['Huevo', 6, 'ud', 'bruta', { note: 'Sólo las yemas' }],
      ['Azúcar', 150, 'g'],
      ['Maicena', 60, 'g'],
      ['Vaina de vainilla', 0.5, 'ud', 'bruta'],
    ],
    ['crema pastelera de vainilla', 'crema de pastelero', 'crema pastelera casera'],
    ['Infusionar la leche con la vainilla.', 'Blanquear las yemas con el azúcar y la maicena, añadir la leche caliente y cocer sin dejar de remover hasta que espese.', 'Enfriar rápido con film a piel.'],
  ),
  elab(
    'Masa de pizza',
    1,
    'kg',
    [
      ['Harina de fuerza', 600, 'g'],
      ['Levadura fresca', 12, 'g'],
      [AOVE, 25, 'ml'],
      ['Sal', 15, 'g'],
      ['Azúcar', 5, 'g'],
    ],
    ['masa para pizza', 'masa pizza', 'masa de pizza casera', 'bases de pizza', 'base de pizza'],
    ['Disolver la levadura en 360 ml de agua templada.', 'Amasar con la harina, el aceite, la sal y el azúcar 10 minutos.', 'Fermentar 24 h en frío y bolear en piezas de 250 g.'],
  ),
  elab(
    'Masa de croquetas',
    1.25,
    'kg',
    [
      ['Leche entera', 1000, 'ml'],
      ['Harina de trigo', 110, 'g'],
      ['Mantequilla', 60, 'g'],
      [AOVE, 40, 'ml'],
      ['Taquitos de jamón', 150, 'g'],
      ['Cebolla', 80, 'g'],
      ['Nuez moscada', 0.5, 'g'],
      ['Sal', 3, 'g'],
    ],
    ['masa de croquetas de jamon', 'bechamel de croquetas', 'masa para croquetas', 'masa de croqueta'],
    ['Pochar la cebolla y el jamón en la mantequilla y el aceite.', 'Tostar la harina, añadir la leche caliente poco a poco y cocer 20 minutos removiendo.', 'Extender en bandeja, filmar a piel y enfriar.'],
  ),
  elab(
    'Caramelo líquido',
    0.5,
    'kg',
    [
      ['Azúcar', 500, 'g'],
      ['Zumo de limón', 5, 'ml'],
    ],
    ['caramelo', 'caramelo para flan'],
    ['Fundir el azúcar con un poco de agua y el limón sin remover.', 'Cocer hasta color ámbar y cortar la cocción con 100 ml de agua caliente.'],
  ),
  elab(
    'Pesto',
    0.5,
    'kg',
    [
      ['Albahaca', 120, 'g'],
      ['Piñón', 60, 'g'],
      ['Parmesano', 100, 'g'],
      ['Ajo', 10, 'g'],
      [AOVE, 220, 'ml'],
      ['Sal', 3, 'g'],
    ],
    ['pesto genoves', 'pesto alla genovese', 'salsa pesto', 'pesto de albahaca'],
    ['Tostar ligeramente los piñones.', 'Triturar la albahaca con el ajo, los piñones y el parmesano añadiendo el aceite poco a poco.', 'Cubrir con aceite para que no se oxide.'],
  ),
  elab(
    'Masa quebrada',
    0.95,
    'kg',
    [
      ['Harina de trigo', 500, 'g'],
      ['Mantequilla', 250, 'g'],
      ['Huevo', 2, 'ud', 'bruta'],
      ['Azúcar', 50, 'g'],
      ['Sal', 5, 'g'],
    ],
    ['masa brisa', 'pasta brisa', 'masa quebrada casera', 'pasta quebrada'],
    ['Arenar la harina con la mantequilla fría, el azúcar y la sal.', 'Añadir los huevos y 50 ml de agua fría y unir sin amasar.', 'Reposar 1 hora en frío antes de estirar.'],
  ),
  elab(
    'Nata montada',
    1.08,
    'kg',
    [
      ['Nata para montar 35 %', 1000, 'ml'],
      ['Azúcar glas', 80, 'g'],
    ],
    ['chantilly', 'crema chantilly', 'nata montada casera'],
    ['Montar la nata muy fría con el azúcar glas hasta que forme picos.', 'Reservar en frío y usar en el día.'],
  ),
];
