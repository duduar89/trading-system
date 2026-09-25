import { describe, expect, it } from 'vitest';
import type { ExtractedMenu } from '../types';
import { menuQuality, mergeMenuPasses, parseMenuText, type MenuBox } from './menuParser';
import {
  boxesToStreams,
  collapseSpacedLetters,
  estimateSkew,
  extractTailPrices,
  hasPhone,
  isDescriptionLike,
  isNoiseLine,
  normalizeMenuLine,
  pickPrice,
  repairOcrText,
  sectionInfo,
  toSentenceCase,
  toTitleCase,
} from './menuUtils';

// ───────────────────────────── Fixtures ─────────────────────────────

interface ExpectedEntry {
  section?: string;
  name: string;
  price?: number;
  description?: string;
}
interface Expected {
  method: 'ocr' | 'pdf-texto';
  entries: ExpectedEntry[];
  warningsInclude?: string[];
}
interface OcrCapture {
  source: string;
  text: string;
  words?: MenuBox[];
  lines?: MenuBox[];
}

const texts = import.meta.glob('../../tests/fixtures/menus/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const expectations = import.meta.glob('../../tests/fixtures/menus/*.expected.json', { import: 'default', eager: true }) as Record<string, Expected>;
const captures = import.meta.glob('../../tests/fixtures/menus/ocr-*.json', { import: 'default', eager: true }) as Record<string, OcrCapture>;
const bench = expectations['../../tests/fixtures/menus/bench-el-fogon.expected.json'];

function simplify(menu: ExtractedMenu): ExpectedEntry[] {
  return menu.entries.map((e) => {
    const o: ExpectedEntry = { name: e.name };
    if (e.section !== undefined) o.section = e.section;
    if (e.price !== undefined) o.price = e.price;
    if (e.description !== undefined) o.description = e.description;
    return o;
  });
}

function normalizeExpected(list: ExpectedEntry[]): ExpectedEntry[] {
  return list.map((e) => {
    const o: ExpectedEntry = { name: e.name };
    if (e.section !== undefined) o.section = e.section;
    if (e.price !== undefined) o.price = e.price;
    if (e.description !== undefined) o.description = e.description;
    return o;
  });
}

const fixtureNames = Object.keys(texts)
  .map((p) => p.replace(/^.*\/(.+)\.txt$/, '$1'))
  .sort();

describe('parseMenuText — cartas de ejemplo (texto de OCR y de PDF)', () => {
  it('hay al menos 6 cartas de ejemplo con su resultado esperado', () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(6);
    for (const name of fixtureNames) expect(expectations[`../../tests/fixtures/menus/${name}.expected.json`], name).toBeDefined();
  });

  it.each(fixtureNames)('%s: todos los platos, precios, secciones y descripciones exactos', (name) => {
    const exp = expectations[`../../tests/fixtures/menus/${name}.expected.json`];
    const menu = parseMenuText(texts[`../../tests/fixtures/menus/${name}.txt`], exp.method);
    const got = simplify(menu);
    const want = normalizeExpected(exp.entries);
    const exact = want.filter((w, i) => JSON.stringify(got[i]) === JSON.stringify(w)).length;
    expect(exact / want.length).toBeGreaterThanOrEqual(0.95);
    expect(got).toEqual(want);
    expect(menu.method).toBe(exp.method);
    expect(menu.rawText).toBe(texts[`../../tests/fixtures/menus/${name}.txt`]);
    for (const w of exp.warningsInclude ?? []) expect(menu.warnings.join(' | ')).toContain(w);
    for (const e of menu.entries) {
      expect(e.confidence).toBeGreaterThan(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('parseMenuText — capturas reales de tesseract.js (carta «El Fogón»)', () => {
  const cap = (name: string) => captures[`../../tests/fixtures/menus/${name}.json`];

  it('PSM 3 con cajas de palabras: la columna de precios leída aparte se empareja por posición', () => {
    const c = cap('ocr-fogon-psm3');
    const menu = parseMenuText(c.text, 'ocr', c.words);
    expect(menu.entries.map((e) => e.name)).toEqual(bench.entries.map((e) => e.name));
    expect(menu.entries.map((e) => e.section)).toEqual(bench.entries.map((e) => e.section));
    // tesseract en modo 3 sólo leyó los 4 primeros precios: esos, exactos; el resto queda sin precio (y se avisa)
    expect(menu.entries.slice(0, 4).map((e) => e.price)).toEqual([6.5, 9, 19.5, 14]);
    expect(menu.entries.slice(4).every((e) => e.price === undefined)).toBe(true);
    expect(menu.warnings.join(' ')).toContain('6 platos no tienen precio legible');
    expect(menu.entries[2].description).toBe('Con cachelos, pimentón de la Vera y aceite de oliva virgen extra');
  });

  it('PSM 3 sólo con texto: bloque de precios separado de los nombres → emparejado en orden', () => {
    const c = cap('ocr-fogon-psm3');
    const menu = parseMenuText(c.text, 'ocr');
    expect(menu.entries.slice(0, 4).map((e) => [e.name, e.price])).toEqual([
      ['Patatas bravas', 6.5],
      ['Croquetas caseras de jamón (6 uds)', 9],
      ['Pulpo a la gallega', 19.5],
      ['Gambas al ajillo', 14],
    ]);
  });

  it('PSM 4 con cajas de línea (una línea OCR con el precio dentro)', () => {
    const c = cap('ocr-fogon-psm4-lineas');
    const menu = parseMenuText(c.text, 'ocr', c.lines);
    expect(menu.entries.map((e) => e.name)).toEqual(bench.entries.map((e) => e.name));
    expect(menu.entries.find((e) => e.name === 'Merluza en salsa verde')?.description).toBe('Con almejas y espárragos');
  });

  it('perspectiva fuerte: los precios alineados a la derecha caen en la fila de su plato', () => {
    const c = cap('ocr-perspectiva-psm11');
    const menu = parseMenuText(c.text, 'ocr', c.words);
    const byPrice = menu.entries.map((e) => [e.section, e.price]);
    expect(byPrice).toEqual(bench.entries.map((e) => [e.section, e.price]));
    const names = new Set(menu.entries.map((e) => e.name));
    const ok = bench.entries.filter((e) => names.has(e.name)).length;
    expect(ok).toBeGreaterThanOrEqual(9);
  });

  it('foto de móvil degradada: 10 precios y secciones correctos, descripciones ilegibles descartadas', () => {
    const c = cap('ocr-foto-movil-psm11');
    const menu = parseMenuText(c.text, 'ocr', c.words);
    expect(menu.entries.map((e) => [e.section, e.price])).toEqual(bench.entries.map((e) => [e.section, e.price]));
    const names = new Set(menu.entries.map((e) => e.name));
    expect(bench.entries.filter((e) => names.has(e.name)).length).toBeGreaterThanOrEqual(9);
    for (const e of menu.entries) if (e.description) expect(e.description).not.toMatch(/Xmayos|N cart/);
  });
});

// ───────────────────────────── Cajas sintéticas (geometría) ─────────────────────────────

interface Row {
  words?: string;
  price?: string;
  size?: number;
  gap?: number;
  x?: number;
}

/** Genera cajas de palabras de una carta: precios alineados a la derecha, algo más altos que el nombre, y giro opcional. */
function layout(rows: Row[], opts: { angle?: number; priceX1?: number; priceDy?: number; x0?: number; y0?: number } = {}): MenuBox[] {
  const boxes: MenuBox[] = [];
  let y = opts.y0 ?? 100;
  const priceX1 = opts.priceX1 ?? 820;
  for (const r of rows) {
    const size = r.size ?? 16;
    y += (r.gap ?? 0.9) * size + size;
    let x = r.x ?? opts.x0 ?? 80;
    for (const w of (r.words ?? '').split(' ').filter(Boolean)) {
      const width = w.length * size * 0.5;
      boxes.push({ text: w, bbox: { x0: x, y0: y - size, x1: x + width, y1: y }, confidence: 95 });
      x += width + size * 0.3;
    }
    if (r.price) {
      const [num, cur] = r.price.split(' ');
      const dy = opts.priceDy ?? -3;
      const cw = 16 * 0.5;
      const curW = cur ? cw : 0;
      const numX1 = priceX1 - (cur ? curW + 4 : 0);
      boxes.push({ text: num, bbox: { x0: numX1 - num.length * cw, y0: y - 16 + dy, x1: numX1, y1: y + dy }, confidence: 93 });
      if (cur) boxes.push({ text: cur, bbox: { x0: priceX1 - curW, y0: y - 16 + dy, x1: priceX1, y1: y + dy }, confidence: 90 });
    }
  }
  const a = ((opts.angle ?? 0) * Math.PI) / 180;
  if (!a) return boxes;
  // Giro alrededor del origen: se gira el centro de cada caja (tesseract devuelve cajas alineadas a los ejes)
  return boxes.map((b) => {
    const cx = (b.bbox.x0 + b.bbox.x1) / 2;
    const cy = (b.bbox.y0 + b.bbox.y1) / 2;
    const w = b.bbox.x1 - b.bbox.x0;
    const h = b.bbox.y1 - b.bbox.y0;
    const nx = cx * Math.cos(a) - cy * Math.sin(a);
    const ny = cx * Math.sin(a) + cy * Math.cos(a);
    return { ...b, bbox: { x0: nx - w / 2, y0: ny - h / 2, x1: nx + w / 2, y1: ny + h / 2 } };
  });
}

const SAMPLE: Row[] = [
  { words: 'CASA PEPE', size: 30 },
  { words: 'ENTRANTES', size: 20, gap: 2 },
  { words: 'Ensaladilla rusa con ventresca', price: '7,50 €' },
  { words: 'Croquetas de cocido', price: '8,00 €' },
  { words: 'Con su caldo y hierbabuena', size: 12, gap: 0.3 },
  { words: 'Calamares a la romana', price: '12,50 €' },
  { words: 'CARNES', size: 20, gap: 2 },
  { words: 'Cochinillo asado', price: '24,00 €' },
  { words: 'Con patatas panaderas y ensalada', size: 12, gap: 0.3 },
  { words: 'Carrilleras al vino tinto', price: '18,50 €' },
  { words: 'Precios con IVA incluido', size: 10, gap: 4 },
];
const SAMPLE_EXPECTED: ExpectedEntry[] = [
  { section: 'Entrantes', name: 'Ensaladilla rusa con ventresca', price: 7.5 },
  { section: 'Entrantes', name: 'Croquetas de cocido', price: 8, description: 'Con su caldo y hierbabuena' },
  { section: 'Entrantes', name: 'Calamares a la romana', price: 12.5 },
  { section: 'Carnes', name: 'Cochinillo asado', price: 24, description: 'Con patatas panaderas y ensalada' },
  { section: 'Carnes', name: 'Carrilleras al vino tinto', price: 18.5 },
];

describe('parseMenuText con cajas del OCR (3.er parámetro)', () => {
  it('carta recta: empareja el precio alineado a la derecha aunque esté algo más alto', () => {
    expect(simplify(parseMenuText('', 'ocr', layout(SAMPLE)))).toEqual(SAMPLE_EXPECTED);
  });

  it.each([2.5, -3, 1.2])('foto girada %s°: corrige la inclinación y empareja bien', (angle) => {
    const boxes = layout(SAMPLE, { angle });
    expect(Math.abs(estimateSkew(boxes) - Math.tan((angle * Math.PI) / 180))).toBeLessThan(0.01);
    expect(simplify(parseMenuText('', 'ocr', boxes))).toEqual(SAMPLE_EXPECTED);
  });

  it('precio más bajo que el nombre (a media altura con la descripción) sigue yendo con su plato', () => {
    expect(simplify(parseMenuText('', 'ocr', layout(SAMPLE, { priceDy: 5 })))).toEqual(SAMPLE_EXPECTED);
  });

  it('el pie de la carta (letra pequeña y lejos) no se convierte en descripción del último plato', () => {
    const menu = parseMenuText('', 'ocr', layout([...SAMPLE, { words: 'Cocina de mercado desde siempre', size: 10, gap: 4 }]));
    expect(menu.entries.at(-1)).toEqual({ section: 'Carnes', name: 'Carrilleras al vino tinto', price: 18.5, confidence: 0.95 });
  });

  it('carta a dos columnas: lee la columna izquierda entera y después la derecha', () => {
    const left = layout(
      [
        { words: 'ENTRANTES', size: 20 },
        { words: 'Gazpacho andaluz', price: '6,00 €' },
        { words: 'Salmorejo cordobés', price: '6,50 €' },
        { words: 'Berenjenas con miel', price: '8,50 €' },
      ],
      { priceX1: 420, x0: 60 },
    );
    const right = layout(
      [
        { words: 'POSTRES', size: 20 },
        { words: 'Tocino de cielo', price: '5,00 €' },
        { words: 'Pestiños caseros', price: '4,50 €' },
        { words: 'Helado de turrón', price: '5,50 €' },
      ],
      { priceX1: 860, x0: 500 },
    );
    const menu = parseMenuText('', 'ocr', [...right, ...left]);
    expect(menu.entries.map((e) => [e.section, e.name, e.price])).toEqual([
      ['Entrantes', 'Gazpacho andaluz', 6],
      ['Entrantes', 'Salmorejo cordobés', 6.5],
      ['Entrantes', 'Berenjenas con miel', 8.5],
      ['Postres', 'Tocino de cielo', 5],
      ['Postres', 'Pestiños caseros', 4.5],
      ['Postres', 'Helado de turrón', 5.5],
    ]);
    expect(boxesToStreams([...left, ...right])).toHaveLength(2);
  });

  it('cajas de varias fotos (page): cada una se reconstruye por separado y en orden', () => {
    const p1 = layout([{ words: 'ENTRANTES', size: 20 }, { words: 'Gazpacho andaluz', price: '6,00 €' }]).map((b) => ({ ...b, page: 1 }));
    const p2 = layout([{ words: 'POSTRES', size: 20 }, { words: 'Tocino de cielo', price: '5,00 €' }]).map((b) => ({ ...b, page: 2 }));
    const menu = parseMenuText('', 'ocr', [...p2, ...p1]);
    expect(menu.entries.map((e) => [e.section, e.name, e.price])).toEqual([
      ['Entrantes', 'Gazpacho andaluz', 6],
      ['Postres', 'Tocino de cielo', 5],
    ]);
  });

  it('la segunda foto que empieza sin cabecera continúa la sección de la primera', () => {
    const p1 = layout([{ words: 'PESCADOS', size: 20 }, { words: 'Merluza a la romana', price: '16,00 €' }]).map((b) => ({ ...b, page: 1 }));
    const p2 = layout([{ words: 'Lubina a la sal', price: '19,00 €' }, { words: 'POSTRES', size: 20, gap: 2 }, { words: 'Flan casero', price: '4,50 €' }]).map((b) => ({ ...b, page: 2 }));
    expect(parseMenuText('', 'ocr', [...p1, ...p2]).entries.map((e) => [e.section, e.name])).toEqual([
      ['Pescados', 'Merluza a la romana'],
      ['Pescados', 'Lubina a la sal'],
      ['Postres', 'Flan casero'],
    ]);
  });

  it('sin cajas útiles cae al texto plano', () => {
    const menu = parseMenuText('POSTRES\nFlan casero 4,50 €', 'ocr', []);
    expect(simplify(menu)).toEqual([{ section: 'Postres', name: 'Flan casero', price: 4.5 }]);
  });
});

// ───────────────────────────── Casos puntuales ─────────────────────────────

describe('parseMenuText — casos puntuales', () => {
  it('precio en la línea anterior al nombre (el precio queda visualmente más alto)', () => {
    const menu = parseMenuText('TAPAS\n3,50 €\nBoquerones en vinagre\n4,00 €\nEnsaladilla rusa\n2,80 €\nGilda', 'ocr');
    expect(menu.entries.map((e) => [e.name, e.price])).toEqual([
      ['Boquerones en vinagre', 3.5],
      ['Ensaladilla rusa', 4],
      ['Gilda', 2.8],
    ]);
  });

  it('precio en la línea siguiente, con la descripción en medio', () => {
    const menu = parseMenuText('CARNES\nChuletón de vaca\nMadurado 45 días, con pimientos\n48,00 €', 'ocr');
    expect(simplify(menu)).toEqual([{ section: 'Carnes', name: 'Chuletón de vaca', price: 48, description: 'Madurado 45 días, con pimientos' }]);
  });

  it('media ración / ración en líneas separadas del nombre → ración completa', () => {
    const menu = parseMenuText('RACIONES   MEDIA   RACIÓN\nZarajos\n6,00 €\n10,00 €\nMollejas al ajillo 7,00 12,00', 'ocr');
    expect(menu.entries.map((e) => [e.name, e.price])).toEqual([
      ['Zarajos', 10],
      ['Mollejas al ajillo', 12],
    ]);
  });

  it('carta toda en mayúsculas: platos en tipo oración, secciones detectadas', () => {
    const menu = parseMenuText('ENTRANTES\nPIMIENTOS DE PADRÓN 6,50\nHUEVOS ROTOS CON JAMÓN 9,50\nPOSTRES\nTARTA DE SANTIAGO 5,00', 'ocr');
    expect(simplify(menu)).toEqual([
      { section: 'Entrantes', name: 'Pimientos de Padrón', price: 6.5 },
      { section: 'Entrantes', name: 'Huevos rotos con jamón', price: 9.5 },
      { section: 'Postres', name: 'Tarta de Santiago', price: 5 },
    ]);
  });

  it('descripción en su propia columna de la misma fila (texto de PDF)', () => {
    const menu = parseMenuText('Pulpo a la gallega        con cachelos y pimentón        19,50 €\nGambas al ajillo                                         14,00 €', 'pdf-texto');
    expect(simplify(menu)).toEqual([
      { name: 'Pulpo a la gallega', price: 19.5, description: 'Con cachelos y pimentón' },
      { name: 'Gambas al ajillo', price: 14 },
    ]);
  });

  it('número de alérgenos sueltos delante del precio no se confunde con otro precio', () => {
    const menu = parseMenuText('Croquetas de pollo 1 3 7   9,50 €', 'ocr');
    expect(menu.entries).toEqual([{ name: 'Croquetas de pollo', price: 9.5, confidence: 0.95 }]);
  });

  it('coma perdida por el OCR en una carta de precios normales ("1450 €" → 14,50)', () => {
    const menu = parseMenuText('Pulpo 18,00 €\nCalamares 12,50 €\nSepia 1450 €\nBravas 6,00 €', 'ocr');
    expect(menu.entries.map((e) => e.price)).toEqual([18, 12.5, 14.5, 6]);
    expect(menu.entries[2].confidence).toBeLessThanOrEqual(0.6);
    expect(menu.warnings.join(' ')).toContain('mal leído');
  });

  it('un precio alto de verdad no se «corrige» (mariscada para 4 en una carta de tapas)', () => {
    const menu = parseMenuText('Gilda 2,50\nBoquerones 4,00\nCroquetas 1,80\nMariscada para 4 personas 180 €\nAgua mineral 1,5 l 2,00', 'ocr');
    expect(menu.entries.map((e) => [e.name, e.price])).toEqual([
      ['Gilda', 2.5],
      ['Boquerones', 4],
      ['Croquetas', 1.8],
      ['Mariscada para 4 personas', 180],
      ['Agua mineral 1,5 l', 2],
    ]);
    expect(menu.warnings).toContain('«Mariscada para 4 personas»: precio muy alto (180,00 €) comparado con el resto de la carta: revísalo');
  });

  it('duplicados (misma carta fotografiada dos veces en el texto) se fusionan', () => {
    const menu = parseMenuText('POSTRES\nFlan de huevo 4,50\nPOSTRES\nFlan de huevo 4,50\nCon nata', 'ocr');
    expect(simplify(menu)).toEqual([{ section: 'Postres', name: 'Flan de huevo', price: 4.5, description: 'Con nata' }]);
  });

  it('platos sin precio legible se conservan con confianza baja y aviso', () => {
    const menu = parseMenuText('ENTRANTES\nSalpicón de marisco\nGambas al ajillo 14,00 €', 'ocr');
    expect(menu.entries[0]).toMatchObject({ name: 'Salpicón de marisco', section: 'Entrantes' });
    expect(menu.entries[0].price).toBeUndefined();
    expect(menu.entries[0].confidence).toBeLessThan(0.5);
    expect(menu.warnings).toContain('1 plato no tiene precio legible: complétalo al revisar');
  });

  it('texto vacío o sin platos: sin entradas y con un aviso útil', () => {
    for (const t of ['', '   \n  ', 'Tel. 91 123 45 67\nwww.restaurante.es\nHorario: 13:00 a 16:00']) {
      const menu = parseMenuText(t, 'ocr');
      expect(menu.entries).toEqual([]);
      expect(menu.warnings[0]).toMatch(/No se han encontrado platos/);
    }
  });

  it('las cartas de PDF no reciben correcciones de OCR', () => {
    const menu = parseMenuText('Tosta de jamon 5,00', 'pdf-texto');
    expect(menu.entries[0].name).toBe('Tosta de jamon');
    expect(parseMenuText('Tosta de jamon 5,00', 'ocr').entries[0].name).toBe('Tosta de jamón');
  });
});

// ───────────────────────────── Utilidades ─────────────────────────────

describe('precios al final de línea', () => {
  const price = (line: string, ctx = false) => pickPrice(extractTailPrices(normalizeMenuLine(line)), ctx)?.price;

  it.each<[string, number | undefined]>([
    ['Croquetas ........ 9,50 €', 9.5],
    ['Croquetas …… 9,50', 9.5],
    ['Croquetas · · · · 9,50', 9.5],
    ['Croquetas ____ 9,50', 9.5],
    ['Pulpo a la gallega 18', 18],
    ['Tataki de atún  16,90', 16.9],
    ['Tataki de atún 14.90', 14.9],
    ['Merluza 12,5', 12.5],
    ['Serranito € 6,90', 6.9],
    ['Serranito €6,90', 6.9],
    ['Serranito 6,90€', 6.9],
    ["Serranito 12'50", 12.5],
    ['Serranito 12€50', 12.5],
    ['Serranito 12,-', 12],
    ['Serranito 6,50 e', 6.5],
    ['Serranito 6,50 ©', 6.5],
    ['Zamburiñas l4,50 €', 14.5],
    ['Nécoras S,50 €', 5.5],
    ['Lubina 2O,00', 20],
    ['Navajas 6 50', 6.5],
    ['Navajas 16 50', 16.5],
    ['Croquetas 6,50 11,00', 11],
    ['Tabla 12 20', 20],
    ['Verdejo copa 3,20 botella 16', 16],
    ['Menú para 2 25', 25],
    ['Viña Ardanza Reserva 2016 34,00', 34],
    ['Croquetas (6 uds)', undefined],
    ['Menú nº 2', undefined],
    ['Cerveza 1/3', undefined],
    ['Rioja Crianza 2019', undefined],
  ])('«%s» → %s', (line, expected) => {
    expect(price(line)).toBe(expected);
  });

  it('con cabecera de columnas acepta copa / botella con proporción baja', () => {
    expect(price('Viña Ardanza 6,50 34,00')).toBe(34);
    expect(price('Protos Roble 4,20 21,50')).toBe(21.5);
    expect(price('Protos Roble 4,20 21,50', true)).toBe(21.5);
  });

  it('precio por kilo', () => {
    const tail = extractTailPrices(normalizeMenuLine('Chuletón 65 €/kg'));
    expect(tail.perUnit).toBe('kg');
    expect(pickPrice(tail)?.price).toBe(65);
  });
});

describe('ruido, secciones y descripciones', () => {
  it.each([
    'Tel. 91 547 23 10',
    'Reservas: 981 22 33 44',
    '+34 612 345 678',
    'C/ Mayor, 12 · Madrid',
    'Avda. de la Constitución 4',
    'Horario: de 13:00 a 16:00',
    'Abierto de martes a domingo',
    'Cocina ininterrumpida de 13 a 23 h',
    'IVA incluido',
    'Consulte a nuestro personal sobre alérgenos',
    'www.restaurante.es',
    '@restaurante',
    'Alérgenos: 1 Gluten 2 Crustáceos 3 Huevo 4 Pescado',
  ])('«%s» es ruido', (line) => {
    expect(isNoiseLine(normalizeMenuLine(line)) || isNoiseLine(line)).toBe(true);
  });

  it('los platos no son ruido', () => {
    expect(isNoiseLine('Menú del día (13:00 a 16:00) 14,50', { decimal: true, any: true })).toBe(false);
    expect(isNoiseLine('Viña Ardanza Reserva 2016 32', { decimal: false, any: true })).toBe(false);
    expect(isNoiseLine('Huevos rotos con jamón')).toBe(false);
    expect(hasPhone('Croquetas 9.50 7.00 8.50')).toBe(false);
    expect(hasPhone('Llámanos al 912 345 678')).toBe(true);
  });

  it('secciones: vocabulario, adornos, letras espaciadas y erratas del OCR', () => {
    expect(sectionInfo('ENTRANTES')).toMatchObject({ label: 'ENTRANTES', strength: 'vocab' });
    expect(sectionInfo('Carnes a la brasa')).toMatchObject({ strength: 'vocab' });
    expect(sectionInfo('Nuestros arroces (mín. 2 personas)')).toMatchObject({ label: 'Nuestros arroces', strength: 'vocab' });
    expect(sectionInfo('— Sugerencias del chef —')).toMatchObject({ label: 'Sugerencias del chef', strength: 'vocab' });
    expect(sectionInfo('~ Lo nuestro ~')).toMatchObject({ label: 'Lo nuestro', strength: 'deco' });
    expect(sectionInfo('P A R A   P I C A R')).toMatchObject({ label: 'PARA PICAR', strength: 'vocab' });
    expect(sectionInfo('PRINCIPALE Ss')).toMatchObject({ label: 'Principales', strength: 'vocab' });
    expect(sectionInfo('D.O. Ribera del Duero')).toMatchObject({ strength: 'vocab', wine: true });
    expect(sectionInfo('Pulpo a la gallega con cachelos y pimentón de la Vera')).toBeUndefined();
    expect(collapseSpacedLetters('P O S T R E S')).toBe('POSTRES');
  });

  it('descripciones', () => {
    expect(isDescriptionLike('Con patatas panaderas')).toBe(true);
    expect(isDescriptionLike('acompañado de ensalada')).toBe(true);
    expect(isDescriptionLike('(mínimo 2 personas)')).toBe(true);
    expect(isDescriptionLike('Arroz negro con alioli')).toBe(false);
  });
});

describe('mayúsculas y reparación de OCR', () => {
  it('tipo oración conservando siglas y nombres propios', () => {
    expect(toSentenceCase('CROQUETAS DE JAMÓN')).toBe('Croquetas de jamón');
    expect(toSentenceCase('PIMIENTOS DE PADRÓN')).toBe('Pimientos de Padrón');
    expect(toSentenceCase('PULPO CON PIMENTÓN DE LA VERA')).toBe('Pulpo con pimentón de la Vera');
    expect(toSentenceCase('RABO DE TORO')).toBe('Rabo de toro');
    expect(toSentenceCase('TINTO D.O. RIBERA DEL DUERO')).toBe('Tinto D.O. Ribera del Duero');
    expect(toTitleCase('MARQUÉS DE RISCAL RESERVA')).toBe('Marqués de Riscal Reserva');
  });

  it.each<[string, string]>([
    ['Tarta de queso al homo', 'Tarta de queso al horno'],
    ['Croquetas de jam0n', 'Croquetas de jamón'],
    ['Croquetas de jam6n', 'Croquetas de jamón'],
    ['Croquetas de jamán', 'Croquetas de jamón'],
    ['Croquetas de ¡amón', 'Croquetas de jamón'],
    ['Arroz negro con a1ioli', 'Arroz negro con alioli'],
    ['aceite de oliva y ac eite', 'aceite de oliva y aceite'],
    ['Con almejas y e sparragos', 'Con almejas y espárragos'],
    ['Pulpo ala gallega', 'Pulpo a la gallega'],
    ['Salmon ahumado', 'Salmón ahumado'],
    ['Secreto ibérico a la brasa', 'Secreto ibérico a la brasa'],
  ])('«%s» → «%s»', (input, expected) => {
    expect(repairOcrText(input)).toBe(expected);
  });
});

describe('varias pasadas de OCR', () => {
  const pass = (entries: ExtractedMenu['entries']): ExtractedMenu => ({ entries, method: 'ocr', warnings: [] });

  it('menuQuality premia platos con precio y nombres limpios', () => {
    const good = pass([
      { name: 'Pulpo a la gallega', price: 19.5, confidence: 0.95 },
      { name: 'Gambas al ajillo', price: 14, confidence: 0.95 },
    ]);
    const bad = pass([
      { name: 'Pulpo a e la Wero', price: 19.5, confidence: 0.72 },
      { name: 'Gambas al ajillo', confidence: 0.45 },
    ]);
    expect(menuQuality(good)).toBeGreaterThan(menuQuality(bad));
  });

  it('mergeMenuPasses completa precios, descripciones y nombres mal leídos sin duplicar', () => {
    const best = pass([
      { section: 'Para picar', name: 'Patatas bravas', price: 6.5, confidence: 0.95 },
      { section: 'Para picar', name: 'Pulpo a e la Wero', price: 19.5, confidence: 0.95 },
      { section: 'Principales', name: 'Merluza en salsa verde', price: 21, confidence: 0.95 },
      { section: 'Principales', name: 'Secreto ibérico a la brasa', price: 18.5, confidence: 0.95 },
      { section: 'Principales', name: 'Arroz negro con alioli', price: 17, confidence: 0.95 },
      { section: 'Postres', name: 'Tarta de queso al horno', confidence: 0.45 },
      { section: 'Postres', name: 'Torrija caramelizada con helado', price: 7, confidence: 0.95 },
    ]);
    const other = pass([
      { section: 'Para picar', name: 'Patatas bravas', price: 6.5, confidence: 0.95 },
      { section: 'Para picar', name: 'Pulpo a la gallega', price: 19.5, confidence: 0.95, description: 'Con cachelos y pimentón' },
      { section: 'Principales', name: 'Merluza en salsa verde', price: 21, confidence: 0.95, description: 'Con almejas y espárragos' },
      { section: 'Principales', name: 'Gambas al llo', price: 21, confidence: 0.95 },
      { section: 'Principales', name: 'Arroz negro con alioli', confidence: 0.45 },
      { section: 'Postres', name: 'Tarta de queso al horno', price: 6.5, confidence: 0.95 },
    ]);
    expect(menuQuality(best)).toBeGreaterThan(menuQuality(other));
    const merged = mergeMenuPasses([other, best]);
    expect(merged.entries.map((e) => [e.name, e.price, e.description])).toEqual([
      ['Patatas bravas', 6.5, undefined],
      ['Pulpo a la gallega', 19.5, 'Con cachelos y pimentón'],
      ['Merluza en salsa verde', 21, 'Con almejas y espárragos'],
      ['Secreto ibérico a la brasa', 18.5, undefined],
      ['Arroz negro con alioli', 17, undefined],
      ['Tarta de queso al horno', 6.5, undefined],
      ['Torrija caramelizada con helado', 7, undefined],
    ]);
    expect(merged.warnings.some((w) => /precio legible/.test(w))).toBe(false);
  });

  it('mergeMenuPasses sin pasadas devuelve una carta vacía con aviso', () => {
    expect(mergeMenuPasses([]).entries).toEqual([]);
  });
});
