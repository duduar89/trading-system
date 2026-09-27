import { describe, expect, it } from 'vitest';
import type { ExtractedMenu } from '../types';
import { mergeMenuPasses, parseMenuText, type MenuBox } from './menuParser';
import { boxesToStreams, extractTailPrices, fixOcrWord, pdfLinesToMenuBoxes, repairOcrText, type PositionedLine } from './menuUtils';

/**
 * Pruebas de regresión de la reconstrucción de cartas a partir de cajas de palabras (columnas, filas, iconos, precios
 * delanteros, nombres partidos, descripciones en la misma fila, añadas) y de las correcciones del OCR. Cada caso
 * reproduce, con cajas sintéticas, una causa raíz de fallo encontrada con el generador procedimental de cartas.
 */

// ───────────────────────────── Cajas sintéticas ─────────────────────────────

interface Word {
  text: string;
  /** Borde izquierdo (o derecho con `x1`); si faltan, la palabra va a continuación de la anterior. */
  x?: number;
  x1?: number;
  /** Altura de la caja (por defecto, la de la línea). */
  h?: number;
  /** Desplazamiento vertical del borde inferior respecto a la línea base (positivo = más abajo). */
  dy?: number;
  /** Ancho explícito (por defecto, 0,5 × altura por carácter). */
  w?: number;
  conf?: number;
}

/**
 * Cajas de una línea: las cadenas se parten en palabras y se colocan seguidas; los objetos, donde digan (y el resto de
 * sus palabras, detrás).
 */
function line(baseline: number, parts: (string | Word)[], opts: { x?: number; h?: number; page?: number } = {}): MenuBox[] {
  const H = opts.h ?? 16;
  const out: MenuBox[] = [];
  let x = opts.x ?? 60;
  const push = (wd: Word) => {
    const h = wd.h ?? H;
    const w = wd.w ?? wd.text.length * 0.5 * h;
    const x0 = wd.x1 !== undefined ? wd.x1 - w : (wd.x ?? x);
    const y1 = baseline + (wd.dy ?? 0);
    out.push({ text: wd.text, bbox: { x0, y0: y1 - h, x1: x0 + w, y1 }, confidence: wd.conf ?? 92, ...(opts.page ? { page: opts.page } : {}) });
    x = x0 + w + 0.3 * h;
  };
  for (const p of parts) {
    if (typeof p === 'string') for (const t of p.split(' ').filter(Boolean)) push({ text: t });
    else if (p.x1 === undefined && p.text.includes(' ')) {
      const [first, ...rest] = p.text.split(' ');
      push({ ...p, text: first });
      for (const t of rest) push({ ...p, text: t, x: undefined });
    } else push(p);
  }
  return out;
}

/** Carta de una columna: [nombre, precio] por fila, precios alineados a la derecha en `priceX1`. */
function column(rows: [string, string?][], opts: { x?: number; priceX1?: number; y0?: number; pitch?: number; h?: number } = {}): MenuBox[] {
  const pitch = opts.pitch ?? 34;
  return rows.flatMap(([name, price], i) =>
    line((opts.y0 ?? 120) + i * pitch, [name, ...(price ? [{ text: price, x1: opts.priceX1 ?? 900 }] : [])], { x: opts.x ?? 60, h: opts.h }),
  );
}

const simple = (m: ExtractedMenu) => m.entries.map((e) => [e.name, e.price]);
const lower = (m: ExtractedMenu) => m.entries.map((e) => [e.name.toLowerCase(), e.price]);

// ───────────────────────────── Columnas ─────────────────────────────

describe('boxesToStreams — columnas de la carta', () => {
  const DISHES: [string, string][] = [
    ['Ensaladilla rusa', '7,50'],
    ['Croquetas de jamón', '8,00'],
    ['Pulpo a la gallega', '16,50'],
    ['Calamares a la romana', '12,00'],
    ['Pimientos de Padrón', '6,50'],
    ['Tortilla de patatas', '9,00'],
    ['Patatas bravas', '5,50'],
    ['Boquerones en vinagre', '7,00'],
  ];

  it('una columna con los precios muy a la derecha no se parte en dos (el hueco nombre → precio no es una calle)', () => {
    const boxes = column(DISHES);
    expect(boxesToStreams(boxes)).toHaveLength(1);
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual(DISHES.map(([n, p]) => [n, Number(p.replace(',', '.'))]));
  });

  it('dos columnas con su columna de precios cada una: la calle es la de entre columnas, no la de nombre → precio', () => {
    const left = DISHES.slice(0, 4);
    const right: [string, string][] = [
      ['Tarta de queso al horno', '5,50'],
      ['Flan casero', '4,00'],
      ['Arroz con leche asturiano', '4,50'],
      ['Torrija caramelizada', '6,00'],
    ];
    const boxes = [...column(right, { x: 540, priceX1: 960 }), ...column(left, { x: 40, priceX1: 470 })];
    expect(boxesToStreams(boxes)).toHaveLength(2);
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([...left, ...right].map(([n, p]) => [n, Number(p.replace(',', '.'))]));
  });

  it('precio en su propio renglón bajo el nombre: el precio de una columna a la altura del nombre de la otra no las une', () => {
    // La cabecera de la izquierda lleva un subtítulo: sus platos empiezan medio plato más abajo y los precios de la
    // derecha (alineados con sus nombres) quedan a la altura de los nombres de la izquierda, como si fueran «su» precio
    const left: [string, string][] = [
      ['Hacienda Ortino Selección', '43.00'],
      ['Finca Lurena Selección', '22.50'],
      ['Valle de Tormedo Selección', '32.50'],
      ['Pago de Petesa Roble', '46.50'],
    ];
    const right: [string, string][] = [
      ['Finca Valbán Reserva Brut', '49.50'],
      ['Torre de Miralanza Brut', '47.50'],
      ['Castillo de Belmedo Extra Brut', '42.00'],
      ['Mas Montarro Brut Nature', '33.50'],
    ];
    const col = (rows: [string, string][], x: number, y0: number) =>
      rows.flatMap(([n, p], i) => [...line(y0 + i * 60, [n], { x }), ...line(y0 + i * 60 + 26, [p], { x })]);
    const boxes = [
      ...line(70, ['TINTOS'], { x: 60, h: 22 }),
      ...line(96, ['Crianza en barrica'], { x: 60, h: 13 }),
      ...line(70, ['CAVAS'], { x: 560, h: 22 }),
      ...col(left, 60, 146),
      ...col(right, 560, 120),
    ];
    expect(boxesToStreams(boxes)).toHaveLength(2);
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([...left, ...right].map(([n, p]) => [n, Number(p)]));
  });

  it('el título centrado que cruza la calle va antes de las dos columnas y no se parte ni se pega a un plato', () => {
    const left: [string, string][] = [
      ['Gazpacho andaluz', '6,00'],
      ['Salmorejo cordobés', '6,50'],
      ['Berenjenas con miel', '8,50'],
      ['Flamenquín casero', '9,50'],
    ];
    const right: [string, string][] = [
      ['Rabo de toro', '18,00'],
      ['Presa ibérica', '17,50'],
      ['Lomo de orza', '12,00'],
      ['Carrillada al Pedro Ximénez', '15,00'],
    ];
    const boxes = [
      ...line(60, ['TABERNA', 'EL', 'OLIVAR'], { x: 390, h: 30 }),
      ...column(left, { x: 40, priceX1: 470, y0: 130 }),
      ...column(right, { x: 540, priceX1: 960, y0: 130 }),
    ];
    const menu = parseMenuText('', 'ocr', boxes);
    expect(simple(menu)).toEqual([...left, ...right].map(([n, p]) => [n, Number(p.replace(',', '.'))]));
    expect(menu.entries.some((e) => /taberna|olivar/i.test(e.name))).toBe(false);
  });
});

// ───────────────────────────── Precios delante del nombre ─────────────────────────────

describe('parseMenuText — precio delante del nombre', () => {
  it('columna de precios a la izquierda: cada precio va con el nombre de su fila', () => {
    const rows: [string, string][] = [
      ['12,50', 'Calamares a la romana'],
      ['9,00', 'Tortilla de patatas'],
      ['16,50', 'Pulpo a la gallega'],
      ['7,50', 'Ensaladilla rusa'],
      ['5,50', 'Patatas bravas'],
    ];
    const boxes = [
      ...line(80, ['ENTRANTES'], { x: 60, h: 20 }),
      ...rows.flatMap(([p, n], i) => line(130 + i * 34, [{ text: p, x: 60 }, { text: n, x: 150 }])),
    ];
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual(rows.map(([p, n]) => [n, Number(p.replace(',', '.'))]));
  });

  it('dos columnas con el precio delante y el euro en su propia caja ("22 €"): cada columna por separado', () => {
    // El OCR separa "22" y "€": el precio sigue yendo delante de su nombre, y la calle entre columnas no es el hueco
    // entre un nombre y «su» precio
    const left: [string, string][] = [
      ['5,5', 'Tempura de verduras de temporada'],
      ['14,5', 'Poke de salmón con aguacate'],
      ['6,75', 'Croquetas de rabo de toro'],
      ['16,8', 'Chistorra de Navarra'],
      ['9,5', 'Jamón ibérico de cebo'],
    ];
    const right: [string, string][] = [
      ['19', 'Marmitako de bonito'],
      ['24', 'Fritura de pescado'],
      ['20', 'Bacalao confitado con pisto'],
      ['22', 'Merluza a la romana'],
      ['21', 'Atún encebollado'],
    ];
    const cell = (x: number, [p, n]: [string, string]): (string | Word)[] => [{ text: p, x }, { text: '€', x: x + p.length * 8 + 6 }, { text: n, x: x + 110 }];
    const boxes = left.flatMap((l, i) => line(120 + i * 40, [...cell(40, l), ...cell(600, right[i])]));
    expect(boxesToStreams(boxes)).toHaveLength(2);
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([...left, ...right].map(([p, n]) => [n, Number(p.replace(',', '.'))]));
  });

  it('la numeración de los platos ("1.", "2)") no se toma por un precio delantero', () => {
    const boxes = [
      ...line(120, [{ text: '1.', x: 60 }, 'Croquetas de jamón', { text: '8,00', x1: 900 }], { x: 60 }),
      ...line(154, [{ text: '2.', x: 60 }, 'Gambas al ajillo', { text: '13,50', x1: 900 }], { x: 60 }),
      ...line(188, [{ text: '3.', x: 60 }, 'Pulpo a la gallega', { text: '16,00', x1: 900 }], { x: 60 }),
    ];
    const prices = parseMenuText('', 'ocr', boxes).entries.map((e) => e.price);
    expect(prices).toEqual([8, 13.5, 16]);
  });

  it('un entero suelto detrás del nombre no compite con un precio delantero con decimales', () => {
    const menu = parseMenuText('12,50 Croquetas caseras 6\n9,00 Tortilla de patatas', 'ocr');
    expect(menu.entries.map((e) => e.price)).toEqual([12.5, 9]);
  });
});

// ───────────────────────────── Iconos y alérgenos ─────────────────────────────

describe('boxesToStreams — iconos, alérgenos y números volados', () => {
  it('iconos redondos y letras de alérgenos detrás del nombre se descartan; el precio se conserva', () => {
    const boxes = [
      ...line(120, ['Croquetas de jamón', { text: 'O', w: 16 }, { text: '@', w: 16 }, { text: '8,00', x1: 900 }]),
      ...line(154, ['Gambas al ajillo', { text: 'G', w: 15 }, { text: 'Mo', w: 30 }, { text: '13,50', x1: 900 }]),
      ...line(188, ['Pulpo a la gallega', { text: '16,00', x1: 900 }]),
    ];
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([
      ['Croquetas de jamón', 8],
      ['Gambas al ajillo', 13.5],
      ['Pulpo a la gallega', 16],
    ]);
  });

  it('números de alérgenos volados (pequeños y por encima del centro) se quitan sin tocar un precio pequeño en la base', () => {
    // "gallega" y "pulpo" bajan de la línea base (trazos bajos): el centro de la fila baja algo
    const boxes = [
      ...line(120, [{ text: 'Pulpo', h: 19, dy: 3 }, 'a la', { text: 'gallega', h: 19, dy: 3 }, { text: '1,4,14', h: 8, dy: -9 }, { text: '16,50', h: 11, x1: 900 }]),
      ...line(154, ['Calamares a la romana', { text: '3', h: 8, dy: -9, w: 4 }, { text: '12,00', h: 11, x1: 900 }]),
      ...line(188, ['Tortilla de patatas', { text: '9,00', h: 11, x1: 900 }]),
    ];
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([
      ['Pulpo a la gallega', 16.5],
      ['Calamares a la romana', 12],
      ['Tortilla de patatas', 9],
    ]);
  });

  it('tira de glifos redondos ("00", tan anchos como altos) delante del precio: icono, no cifras', () => {
    const boxes = [
      ...line(120, ['Croquetas caseras', { text: '00', w: 32 }, { text: '8,50', x1: 900 }]),
      ...line(154, ['Tortilla de patatas', { text: '9,00', x1: 900 }]),
      ...line(188, ['Patatas bravas', { text: '5,50', x1: 900 }]),
    ];
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([
      ['Croquetas caseras', 8.5],
      ['Tortilla de patatas', 9],
      ['Patatas bravas', 5.5],
    ]);
  });

  it('restos de iconos leídos casi a ciegas: glifos redondos, cifra suelta y cifra con paréntesis sin abrir', () => {
    const boxes = [
      ...line(120, ['Torrezno', { text: '6)', w: 16 }, { text: '7,00', x1: 900 }]),
      ...line(154, ['Entrecot de ternera', { text: '0OOOG', w: 50, conf: 10 }, { text: '19,00', x1: 900 }]),
      ...line(188, ['Brocheta de picaña', { text: '0', w: 5, conf: 18 }, { text: 'OG0', w: 45, conf: 18 }, { text: '28,20', x1: 900 }]),
      ...line(222, ['Croquetas (6 uds)', { text: '9,50', x1: 900 }]),
    ];
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([
      ['Torrezno', 7],
      ['Entrecot de ternera', 19],
      ['Brocheta de picaña', 28.2],
      ['Croquetas (6 uds)', 9.5],
    ]);
  });

  it('las medidas del nombre ("100 g") no se confunden con restos de iconos', () => {
    const boxes = [
      ...line(120, ['Jamón ibérico 100 g', { text: '22,00', x1: 900 }]),
      ...line(154, ['Queso manchego curado', { text: '14,00', x1: 900 }]),
    ];
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([
      ['Jamón ibérico 100 g', 22],
      ['Queso manchego curado', 14],
    ]);
  });
});

// ───────────────────────────── Nombres partidos y descripciones ─────────────────────────────

describe('parseMenuText — nombres en dos renglones y descripciones en la misma fila', () => {
  it('nombre que queda colgando ("… con") o sigue en minúscula continúa en el renglón siguiente', () => {
    const boxes = [
      ...line(120, ['Arroz meloso de carabineros con', { text: '24,00', x1: 900 }]),
      ...line(141, ['alcachofas y ajetes']),
      ...line(180, ['Lubina a la espalda', { text: '19,50', x1: 900 }]),
      ...line(219, ['Solomillo de ternera', { text: '23,00', x1: 900 }]),
    ];
    expect(simple(parseMenuText('', 'ocr', boxes))).toEqual([
      ['Arroz meloso de carabineros con alcachofas y ajetes', 24],
      ['Lubina a la espalda', 19.5],
      ['Solomillo de ternera', 23],
    ]);
  });

  it('nombres con Cada Palabra En Mayúscula: el renglón siguiente sólo sigue el nombre si su primera palabra no cabía', () => {
    // Columna estrecha (precios en x = 470): el primer nombre llega casi al precio y sigue abajo; el segundo es corto,
    // así que "Tarta" (sin precio leído) es otro plato, no el final de "Flan Casero"
    const boxes = [
      ...line(120, ['Solomillo De Ternera A La', { text: '23,00', x1: 470 }], { x: 60 }),
      ...line(141, ['Brasa Con Patatas'], { x: 60 }),
      ...line(180, ['Flan Casero', { text: '4,50', x1: 470 }], { x: 60 }),
      ...line(201, ['Tarta De Queso'], { x: 60 }),
      ...line(240, ['Natillas De La Abuela', { text: '4,00', x1: 470 }], { x: 60 }),
    ];
    const menu = parseMenuText('', 'ocr', boxes);
    expect(lower(menu)).toEqual([
      ['solomillo de ternera a la brasa con patatas', 23],
      ['flan casero', 4.5],
      ['tarta de queso', undefined],
      ['natillas de la abuela', 4],
    ]);
  });

  it('descripción en letra más pequeña en la misma fila que el nombre: se separa como descripción', () => {
    const boxes = [
      ...line(120, ['Natillas caseras', { text: 'con galleta y canela', h: 10, x: 230 }, { text: '4,50', x1: 900 }]),
      ...line(154, ['Tarta de queso', { text: 'Frutos rojos y nata montada', h: 10, x: 210 }, { text: '5,50', x1: 900 }]),
      ...line(188, ['Flan de huevo', { text: '4,00', x1: 900 }]),
    ];
    const menu = parseMenuText('', 'ocr', boxes);
    expect(menu.entries.map((e) => [e.name, e.description?.toLowerCase(), e.price])).toEqual([
      ['Natillas caseras', 'con galleta y canela', 4.5],
      ['Tarta de queso', 'frutos rojos y nata montada', 5.5],
      ['Flan de huevo', undefined, 4],
    ]);
    // El tamaño de letra de la fila es el del nombre, no el de su descripción (más larga y en letra pequeña)
    const [rows] = boxesToStreams(boxes);
    expect(rows[1].size).toBeCloseTo(rows[2].size, 5);
  });
});

// ───────────────────────────── Precio en su propio renglón ─────────────────────────────

describe('parseMenuText — precio debajo de cada plato', () => {
  /** Plato con descripción (misma letra, más pegada) y el precio en el renglón de debajo. */
  const dish = (y: number, name: string, desc: string | undefined, price: string | undefined): { boxes: MenuBox[]; y: number } => {
    const boxes = line(y, [name]);
    let at = y;
    if (desc) {
      at += 25;
      boxes.push(...line(at, [desc], { h: 15 }));
    }
    if (price) {
      at += 25;
      boxes.push(...line(at, [price]));
    }
    return { boxes, y: at };
  };

  it('el renglón pegado al nombre es su descripción aunque no vaya en letra más pequeña; tras el precio empieza otro plato', () => {
    const rows: [string, string | undefined, string | undefined][] = [
      ['Hamburguesa de pollo', 'Panko y huevo', '5,50'],
      ['Hamburguesa de ternera', 'Queso cheddar y bacon', '8,00'],
      ['Sándwich mixto', 'Jamón cocido y queso', '4,50'],
      ['Huevos rotos', 'Patatas y jamón', undefined],
      ['Huevos a la flamenca', 'Guisantes y chorizo', '9,50'],
      ['Tortilla de patatas', undefined, '7,00'],
    ];
    const boxes: MenuBox[] = [...line(80, ['HAMBURGUESAS'], { h: 22 })];
    let y = 140;
    for (const [n, d, p] of rows) {
      const r = dish(y, n, d, p);
      boxes.push(...r.boxes);
      // Separación entre platos: el precio cierra el plato; sin precio leído, el hueco es mayor
      y = r.y + (p ? 40 : 70);
    }
    const menu = parseMenuText('', 'ocr', boxes);
    expect(menu.entries.map((e) => [e.name, e.description, e.price])).toEqual([
      ['Hamburguesa de pollo', 'Panko y huevo', 5.5],
      ['Hamburguesa de ternera', 'Queso cheddar y bacon', 8],
      ['Sándwich mixto', 'Jamón cocido y queso', 4.5],
      ['Huevos rotos', 'Patatas y jamón', undefined],
      ['Huevos a la flamenca', 'Guisantes y chorizo', 9.5],
      ['Tortilla de patatas', undefined, 7],
    ]);
  });
});

describe('parseMenuText — precio debajo: secciones y platos que empiezan como una sección', () => {
  it('"Croquetas de pollo" con su descripción y su precio debajo es un plato, no la sección', () => {
    const boxes = [
      ...line(60, ['Taberna Salitre'], { h: 32 }),
      ...line(90, ['Sabores de siempre'], { h: 12 }),
      ...line(150, ['PARA PICOTEAR'], { h: 22 }),
      ...line(190, ['Croquetas de pollo']),
      ...line(210, ['Leche entera, nuez moscada y cebolla'], { h: 11 }),
      ...line(232, ['10.5']),
      ...line(272, ['Gambas al ajillo']),
      ...line(292, ['Sobre ajo, perejil y cayena'], { h: 11 }),
      ...line(314, ['9']),
      ...line(354, ['Lacón gallego']),
      ...line(376, ['5']),
      ...line(416, ['Queso manchego']),
      ...line(438, ['13.5']),
    ];
    const menu = parseMenuText('', 'ocr', boxes);
    expect(menu.entries.map((e) => [e.section, e.name, e.price])).toEqual([
      ['Para picotear', 'Croquetas de pollo', 10.5],
      ['Para picotear', 'Gambas al ajillo', 9],
      ['Para picotear', 'Lacón gallego', 5],
      ['Para picotear', 'Queso manchego', 13.5],
    ]);
  });
});

// ───────────────────────────── Varias pasadas ─────────────────────────────

describe('mergeMenuPasses — precio en disputa', () => {
  it('si dos pasadas coinciden en otro precio que la mejor pasada, gana la mayoría', () => {
    const base: ExtractedMenu = {
      method: 'ocr',
      warnings: [],
      entries: [
        { name: 'Casa Belbera 2022', price: 8, confidence: 0.95 },
        { name: 'Pago de Pelanza Reserva', price: 48, confidence: 0.95 },
        { name: 'Hacienda Orriel', price: 34, confidence: 0.95 },
        { name: 'Dominio de Sanmar 2020', price: 22, confidence: 0.95 },
      ],
    };
    const other = (): ExtractedMenu => ({
      method: 'ocr',
      warnings: [],
      entries: [
        { name: 'Casa Belbera 2022', price: 45, confidence: 0.9 },
        { name: 'Pago de Pelanza Reserva', price: 48, confidence: 0.9 },
      ],
    });
    const merged = mergeMenuPasses([base, other(), other()]);
    expect(merged.entries.map((e) => [e.name, e.price])).toEqual([
      ['Casa Belbera 2022', 45],
      ['Pago de Pelanza Reserva', 48],
      ['Hacienda Orriel', 34],
      ['Dominio de Sanmar 2020', 22],
    ]);
    // Con una sola lectura distinta no se cambia el precio de la mejor pasada
    expect(mergeMenuPasses([base, other()]).entries[0].price).toBe(8);
  });
});

// ───────────────────────────── Vinos y añadas ─────────────────────────────

describe('parseMenuText — vinos: añadas y dos precios', () => {
  it('la añada no es un precio ni una columna, y la añada suelta en el renglón siguiente es del nombre', () => {
    const boxes = [
      ...line(80, ['VINOS TINTOS'], { h: 20 }),
      ...line(130, ['Viña Tondonia Reserva', { text: '2010', x: 330 }, { text: '32,00', x1: 900 }]),
      ...line(164, ['Pago de Carraovejas Crianza', { text: '38,00', x1: 900 }]),
      ...line(185, ['2019']),
      ...line(224, ['Marqués de Riscal Reserva', { text: '26,00', x1: 900 }]),
    ];
    const menu = parseMenuText('', 'ocr', boxes);
    expect(menu.entries.map((e) => [e.name, e.price])).toEqual([
      ['Viña Tondonia Reserva 2010', 32],
      ['Pago de Carraovejas Crianza 2019', 38],
      ['Marqués de Riscal Reserva', 26],
    ]);
  });

  it('la denominación de origen ("D.O. Rueda") con su sigla en caja propia es una subsección, no un plato sin precio', () => {
    const boxes = [
      ...line(80, ['VINOS TINTOS'], { h: 20 }),
      ...line(124, ['D.O.', 'Ribera del Duero']),
      ...line(160, ['Protos Roble 2022', { text: '19,50', x1: 900 }]),
      ...line(194, ['Emilio Moro 2021', { text: '32,00', x1: 900 }]),
      ...line(240, ['D.O.', 'Rueda']),
      ...line(276, ['José Pariente Verdejo 2024', { text: '17,00', x1: 900 }]),
      ...line(310, ['Martín Códax 2024', { text: '18,50', x1: 900 }]),
    ];
    const menu = parseMenuText('', 'ocr', boxes);
    expect(menu.entries.map((e) => [e.name, e.price])).toEqual([
      ['Protos Roble 2022', 19.5],
      ['Emilio Moro 2021', 32],
      ['José Pariente Verdejo 2024', 17],
      ['Martín Códax 2024', 18.5],
    ]);
    expect(menu.entries.map((e) => e.section)).toEqual([
      'Vinos tintos · D.O. Ribera del Duero',
      'Vinos tintos · D.O. Ribera del Duero',
      'Vinos tintos · D.O. Rueda',
      'Vinos tintos · D.O. Rueda',
    ]);
  });

  it('precios de copa y botella con el euro pegado ("8,00€ 40,00€") se leen los dos', () => {
    const tail = extractTailPrices('Rioja crianza 8,00€ 40,00€');
    expect(tail.tokens.map((t) => t.value)).toEqual([8, 40]);
    expect(tail.head.trim()).toBe('Rioja crianza');
  });

  it('copa y botella sin cabecera de columnas: el precio de la copa no se queda pegado al nombre', () => {
    const menu = parseMenuText('VINOS\nCasa Altarro Gran Reserva €5,00 €26,00\nCastillo de Miralago Brut €3,00 €16,00', 'ocr');
    expect(simple(menu)).toEqual([
      ['Casa Altarro Gran Reserva', 26],
      ['Castillo de Miralago Brut', 16],
    ]);
  });

  it('euro delante del número ("€ 12,50") también cuenta como precio', () => {
    const menu = parseMenuText('Croquetas caseras € 8,50\nPulpo a la gallega € 16,00', 'ocr');
    expect(simple(menu)).toEqual([
      ['Croquetas caseras', 8.5],
      ['Pulpo a la gallega', 16],
    ]);
  });
});

// ───────────────────────────── Estilo de precios de la carta ─────────────────────────────

describe('parseMenuText — estilo de precios de la carta', () => {
  it('carta con un decimal ("8,5"): los enteros sueltos también son precios', () => {
    const menu = parseMenuText('Croquetas caseras 8,5\nPatatas bravas 6\nPulpo a la gallega 16,5\nCalamares a la romana 12\nTortilla de patatas 9,5', 'ocr');
    expect(simple(menu)).toEqual([
      ['Croquetas caseras', 8.5],
      ['Patatas bravas', 6],
      ['Pulpo a la gallega', 16.5],
      ['Calamares a la romana', 12],
      ['Tortilla de patatas', 9.5],
    ]);
  });

  it('carta con precios enteros alineados a la derecha (cajas del OCR)', () => {
    const rows: [string, string][] = [
      ['Ensalada de tomate', '9'],
      ['Croquetas de jamón', '8'],
      ['Pulpo a la gallega', '18'],
      ['Chuletón de vaca', '42'],
      ['Tarta de queso', '6'],
    ];
    expect(simple(parseMenuText('', 'ocr', column(rows)))).toEqual(rows.map(([n, p]) => [n, Number(p)]));
  });
});

// ───────────────────────────── PDF con capa de texto ─────────────────────────────

describe('pdfLinesToMenuBoxes — cartas en PDF con texto', () => {
  /** Fragmento de texto de PDF con el ancho que tendría en una letra de cuerpo `size`. */
  const frag = (str: string, x: number, size = 11) => ({ str, x, width: str.length * 0.52 * size });

  it('una carta a dos columnas en PDF se lee columna a columna con el mismo motor que las fotos', () => {
    const left: [string, string][] = [
      ['Gazpacho andaluz', '6,00 €'],
      ['Salmorejo cordobés', '6,50 €'],
      ['Berenjenas con miel', '8,50 €'],
      ['Flamenquín casero', '9,50 €'],
    ];
    const right: [string, string][] = [
      ['Tocino de cielo', '5,00 €'],
      ['Pestiños caseros', '4,50 €'],
      ['Helado de turrón', '5,50 €'],
      ['Tarta de almendra', '5,00 €'],
    ];
    const lines: PositionedLine[] = [
      { page: 1, y: 60, items: [frag('ENTRANTES', 40, 14), frag('POSTRES', 320, 14)] },
      ...left.map(([n, p], i) => ({
        page: 1,
        y: 90 + i * 18,
        items: [frag(n, 40), frag(p, 250 - p.length * 0.52 * 11), frag(right[i][0], 320), frag(right[i][1], 530 - right[i][1].length * 0.52 * 11)],
      })),
    ];
    const text = lines.map((l) => l.items.map((it) => it.str).join('   ')).join('\n');
    const boxes = pdfLinesToMenuBoxes(lines);
    expect(boxes.filter((b) => b.text === 'Gazpacho')).toHaveLength(1);
    const menu = parseMenuText(text, 'pdf-texto', boxes);
    expect(menu.entries.map((e) => [e.section, e.name, e.price])).toEqual([
      ...left.map(([n, p]) => ['Entrantes', n, Number(p.slice(0, -2).replace(',', '.'))]),
      ...right.map(([n, p]) => ['Postres', n, Number(p.slice(0, -2).replace(',', '.'))]),
    ]);
  });

  it('la letra más pequeña de una descripción del PDF sigue siendo más pequeña en las cajas', () => {
    const boxes = pdfLinesToMenuBoxes([{ page: 1, y: 100, items: [frag('Natillas caseras', 40, 12), frag('con galleta y canela', 160, 8)] }]);
    const h = (t: string) => {
      const b = boxes.find((x) => x.text === t);
      return b ? b.bbox.y1 - b.bbox.y0 : 0;
    };
    expect(h('galleta')).toBeLessThan(0.8 * h('Natillas'));
  });
});

// ───────────────────────────── Correcciones del OCR con el vocabulario ─────────────────────────────

describe('fixOcrWord / repairOcrText — vocabulario de recetas e ingredientes', () => {
  it('corrige confusiones de glifos y la primera letra perdida si sólo hay una palabra conocida posible', () => {
    expect(fixOcrWord('Irucha', { vocabulary: true })).toBe('Trucha');
    expect(fixOcrWord('rnerluza', { vocabulary: true })).toBe('merluza');
    expect(fixOcrWord('alamares', { vocabulary: true })).toBe('calamares');
  });

  it('con dos palabras conocidas posibles no se arriesga ("arta": ¿tarta o carta?)', () => {
    expect(fixOcrWord('arta', { vocabulary: true })).toBe('arta');
  });

  it('no cambia palabras que no son erratas de forma (otra palabra parecida no basta)', () => {
    expect(fixOcrWord('barrica', { vocabulary: true })).toBe('barrica');
    expect(fixOcrWord('Valle', { vocabulary: true })).toBe('Valle');
    expect(fixOcrWord('Irucha')).toBe('Irucha');
  });

  it('no toca nombres propios con mayúscula en medio de un nombre en minúsculas', () => {
    expect(repairOcrText('Bonito del norte estilo Getaria')).toBe('Bonito del norte estilo Getaria');
    expect(repairOcrText('Irucha a la navarra')).toBe('Trucha a la navarra');
  });
});
