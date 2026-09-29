#!/usr/bin/env node
/**
 * Generador PROCEDIMENTAL de facturas de proveedor españolas (semilla → documento) para medir la GENERALIZACIÓN de la
 * extracción local sin sobreajustar a un puñado de documentos.
 *
 * Cada semilla produce una factura distinta y realista a partir de un generador pseudoaleatorio determinista:
 *  - ~170 productos reales de hostelería con precios, unidades, envases y tipos de IVA verosímiles;
 *  - proveedor, cliente, direcciones, CIF/NIF con dígito de control, números de factura y fechas en formatos variados;
 *  - plantillas: tabla HTML clásica, informe de ERP monoespaciado, ticket térmico de cash & carry y albarán valorado;
 *  - columnas aleatorias (código, EAN, nº de línea, lote, caducidad, origen, bultos/cajas, uds + kilos, unidad,
 *    precio, uno o dos descuentos, importe, IVA) en órdenes distintos (precio antes de la cantidad, IVA antes del
 *    importe, unidad antes de la cantidad…), con sinónimos de las etiquetas de cabecera y a veces sin cabecera;
 *  - letra de 7 a 12 px en varias familias, vertical/apaisado, formatos numéricos (2–4 decimales, miles, €, signo
 *    menos final), descripciones partidas en dos filas, sublíneas de trazabilidad, filas de sección, portes y envases,
 *    abonos, varias páginas con «Suma y sigue» y desgloses de IVA 4/10/21.
 *
 * La verdad de referencia sale de los MISMOS datos con que se imprime el HTML (nunca de la salida del parser).
 * Semillas: 1–150 para ajustar; 1001–1100 reservadas (held-out) para el resultado honesto final.
 *
 * Uso: node scripts/gen-random-invoices.mjs --seeds=1-20 [--out=<dir>] [--html]
 *   Genera <dir>/<semilla>.pdf, <semilla>.json (verdad de referencia) y, con --html, <semilla>.html.
 *   Por defecto <dir> = node_modules/.cache/escandallo-random/v<versión>.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GENERATOR_VERSION = 1;
export const TUNING_SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);
export const HELDOUT_SEEDS = Array.from({ length: 100 }, (_, i) => i + 1001);
/**
 * Facturas de cash & carry / mayorista (artículos en dos filas con código de unidad, columnas Prec. Ud. | Cont P. |
 * Precio | Cant. | Importe | Imp, trazabilidad GTIN/Lote, bloque del cliente con su N.I.F. y total de página). Semillas
 * aparte para no cambiar las facturas de las semillas de siempre: ajuste 2001–2060, reservadas 3001–3040.
 */
export const CASH_TUNING_SEEDS = Array.from({ length: 60 }, (_, i) => i + 2001);
export const CASH_HELDOUT_SEEDS = Array.from({ length: 40 }, (_, i) => i + 3001);
export const isCashSeed = (seed) => (seed >= 2001 && seed <= 2999) || (seed >= 3001 && seed <= 3999);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = join(ROOT, `node_modules/.cache/escandallo-random/v${GENERATOR_VERSION}`);

// ───────────────────────────── Generador pseudoaleatorio ─────────────────────────────

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32((seed * 7919 + 104729) | 0);
  for (let i = 0; i < 8; i++) next();
  const R = {
    next,
    float: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (pairs) => {
      const tot = pairs.reduce((s, [w]) => s + w, 0);
      let x = next() * tot;
      for (const [w, v] of pairs) {
        x -= w;
        if (x <= 0) return v;
      }
      return pairs[pairs.length - 1][1];
    },
    shuffle: (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
  R.sample = (arr, n) => R.shuffle(arr).slice(0, n);
  return R;
}

// ───────────────────────────── Utilidades numéricas y de texto ─────────────────────────────

/** Redondeo comercial (mitad hacia arriba en valor absoluto). */
export function rnd(x, dec = 2) {
  const f = 10 ** dec;
  return (Math.sign(x) * Math.round((Math.abs(x) + 1e-9) * f)) / f;
}

function fmtNum(v, dec, { thousands = true, trailingMinus = false } = {}) {
  const neg = v < 0;
  const s = Math.abs(v).toFixed(dec);
  let [i, d] = s.split('.');
  if (thousands) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = d !== undefined ? `${i},${d}` : i;
  if (!neg) return body;
  return trailingMinus ? `${body}-` : `-${body}`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
const pad2 = (n) => String(n).padStart(2, '0');

const SMALL_WORDS = new Set(['de', 'del', 'la', 'el', 'en', 'con', 'sin', 'al', 'a', 'y', 'para', 'los', 'las', 'o']);

/** Aplica el estilo de mayúsculas del documento a una descripción del catálogo (escrita en mayúsculas). */
function applyCase(desc, style) {
  if (style === 'upper') return desc;
  if (style === 'noaccents') return stripAccents(desc);
  const words = desc.split(' ');
  if (style === 'title') {
    return words
      .map((w, i) => {
        if (/^[A-Z]\.(?:[A-Z]\.)+$/.test(w)) return w;
        if (/\d/.test(w)) return w.toLowerCase();
        const lw = w.toLowerCase();
        if (i > 0 && SMALL_WORDS.has(lw)) return lw;
        return lw.charAt(0).toUpperCase() + lw.slice(1);
      })
      .join(' ');
  }
  // 'sentence'
  const lower = desc.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ───────────────────────────── CIF / NIF ─────────────────────────────

function cifControl(letter, seven) {
  let sum = 0;
  for (let k = 0; k < 7; k++) {
    const d = Number(seven[k]);
    if (k % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else sum += d;
  }
  const control = (10 - (sum % 10)) % 10;
  return 'PQRSNW'.includes(letter) ? 'JABCDEFGHI'[control] : String(control);
}

function makeCif(R, letter) {
  const seven = Array.from({ length: 7 }, (_, i) => (i === 0 ? R.int(0, 9) : R.int(0, 9))).join('');
  return `${letter}${seven}${cifControl(letter, seven)}`;
}

function makeNif(R) {
  const eight = String(R.int(10000000, 79999999));
  return `${eight}${'TRWAGMYFPDXBNJZSQVHLCKE'[Number(eight) % 23]}`;
}

function printTaxId(R, id) {
  const style = R.weighted([
    [6, 'plain'],
    [1.5, 'dash'],
    [1, 'space'],
    [0.8, 'es'],
    [0.4, 'esdash'],
  ]);
  if (/^\d/.test(id)) return style === 'dash' ? `${id.slice(0, 8)}-${id.slice(8)}` : style === 'es' ? `ES${id}` : id;
  if (style === 'dash') return `${id[0]}-${id.slice(1)}`;
  if (style === 'space') return `${id[0]} ${id.slice(1)}`;
  if (style === 'es') return `ES${id}`;
  if (style === 'esdash') return `ES-${id}`;
  return id;
}

// ───────────────────────────── Catálogo de productos ─────────────────────────────

const P = (d, fam, unit, pmin, pmax, vat, qmin, qmax, x = {}) => ({ d, fam, unit, pmin, pmax, vat, qmin, qmax, ...x });

export const CATALOG = [
  // Frutería (IVA 4 %)
  P('TOMATE PERA', 'fru', 'kg', 0.9, 2.2, 4, 3, 25),
  P('TOMATE RAMA', 'fru', 'kg', 1.2, 2.6, 4, 3, 20),
  P('TOMATE CHERRY BANDEJA 250G', 'fru', 'bandeja', 0.9, 1.8, 4, 4, 20),
  P('LECHUGA ICEBERG', 'fru', 'ud', 0.5, 1.1, 4, 6, 30),
  P('LECHUGA ROMANA', 'fru', 'ud', 0.6, 1.2, 4, 6, 24),
  P('CEBOLLA AMARILLA', 'fru', 'kg', 0.6, 1.2, 4, 10, 60),
  P('CEBOLLA MORADA', 'fru', 'kg', 1.0, 1.9, 4, 3, 15),
  P('PATATA AGRIA', 'fru', 'kg', 0.6, 1.2, 4, 15, 150),
  P('PATATA NUEVA', 'fru', 'kg', 0.7, 1.4, 4, 10, 60),
  P('ZANAHORIA', 'fru', 'kg', 0.6, 1.2, 4, 5, 30),
  P('PIMIENTO ROJO', 'fru', 'kg', 1.6, 3.2, 4, 3, 15),
  P('PIMIENTO VERDE ITALIANO', 'fru', 'kg', 1.4, 2.8, 4, 3, 15),
  P('PIMIENTO DE PADRÓN', 'fru', 'kg', 3.5, 7, 4, 1, 6),
  P('CALABACÍN', 'fru', 'kg', 0.9, 2, 4, 3, 15),
  P('BERENJENA', 'fru', 'kg', 1, 2.2, 4, 3, 12),
  P('PUERRO', 'fru', 'kg', 1.2, 2.4, 4, 2, 10),
  P('AJO SECO MALLA 1KG', 'fru', 'malla', 3.5, 6, 4, 1, 6),
  P('PEREJIL MANOJO', 'fru', 'manojo', 0.35, 0.8, 4, 5, 30),
  P('CILANTRO MANOJO', 'fru', 'manojo', 0.5, 1, 4, 2, 10),
  P('LIMÓN', 'fru', 'kg', 1, 2.2, 4, 3, 20),
  P('NARANJA DE ZUMO', 'fru', 'kg', 0.6, 1.2, 4, 10, 50),
  P('MANZANA GOLDEN', 'fru', 'kg', 1.2, 2.2, 4, 3, 20),
  P('PLÁTANO DE CANARIAS', 'fru', 'kg', 1.5, 2.5, 4, 3, 20),
  P('FRESÓN', 'fru', 'kg', 2.5, 5, 4, 2, 10),
  P('AGUACATE HASS', 'fru', 'kg', 3, 6, 4, 2, 10),
  P('CHAMPIÑÓN LAMINADO 1KG', 'fru', 'ud', 2.5, 4, 4, 2, 12),
  P('SETA SHIITAKE BANDEJA 250G', 'fru', 'bandeja', 2.2, 3.8, 4, 1, 8),
  P('ESPÁRRAGO VERDE MANOJO', 'fru', 'manojo', 1.8, 3.2, 4, 3, 15),
  P('JUDÍA VERDE PLANA', 'fru', 'kg', 2.5, 4.5, 4, 2, 10),
  P('BRÓCOLI', 'fru', 'kg', 1.5, 2.8, 4, 2, 10),
  P('ALCACHOFA', 'fru', 'kg', 2, 4.5, 4, 2, 10),
  P('PEPINO', 'fru', 'kg', 0.8, 1.6, 4, 2, 10),
  P('MELÓN PIEL DE SAPO', 'fru', 'kg', 0.9, 1.8, 4, 5, 25),
  P('SANDÍA', 'fru', 'kg', 0.5, 1.2, 4, 8, 40),
  P('HIERBABUENA MANOJO', 'fru', 'manojo', 0.6, 1.2, 4, 2, 10),
  P('JENGIBRE', 'fru', 'kg', 3.5, 6, 4, 0.5, 3),
  // Carnicería (IVA 10 %)
  P('SOLOMILLO DE TERNERA', 'car', 'kg', 26, 42, 10, 2, 8, { piece: 1.8 }),
  P('ENTRECOT DE VACA MADURADA', 'car', 'kg', 22, 38, 10, 3, 10, { piece: 0.4 }),
  P('LOMO BAJO DE VACA', 'car', 'kg', 18, 30, 10, 3, 12, { piece: 4 }),
  P('CARRILLERA DE CERDO IBÉRICO', 'car', 'kg', 9, 14, 10, 2, 8, { piece: 0.3 }),
  P('SECRETO IBÉRICO', 'car', 'kg', 14, 22, 10, 2, 6, { piece: 0.5 }),
  P('PRESA IBÉRICA', 'car', 'kg', 16, 26, 10, 2, 6, { piece: 0.7 }),
  P('PECHUGA DE POLLO FILETEADA', 'car', 'kg', 6, 9, 10, 3, 15, { piece: 1 }),
  P('MUSLO DE POLLO DESHUESADO', 'car', 'kg', 5, 7.5, 10, 3, 12, { piece: 1 }),
  P('PIERNA DE CORDERO LECHAL', 'car', 'kg', 16, 26, 10, 2, 8, { piece: 1.3 }),
  P('CHULETILLA DE CORDERO', 'car', 'kg', 18, 28, 10, 2, 6, { piece: 1 }),
  P('COSTILLA DE CERDO', 'car', 'kg', 6, 9, 10, 3, 12, { piece: 1.5 }),
  P('CARNE PICADA MIXTA', 'car', 'kg', 6.5, 9.5, 10, 2, 10, { piece: 1 }),
  P('CHORIZO FRESCO PARRILLA', 'car', 'kg', 7, 10, 10, 1, 5, { piece: 1 }),
  P('MORCILLA DE BURGOS', 'car', 'kg', 6, 9, 10, 1, 4, { piece: 0.35 }),
  P('HAMBURGUESA DE VACUNO 180G', 'car', 'ud', 0.9, 1.6, 10, 12, 60),
  P('ALBÓNDIGA DE TERNERA', 'car', 'kg', 8, 12, 10, 2, 6, { piece: 1 }),
  P('RABO DE TORO', 'car', 'kg', 12, 18, 10, 2, 8, { piece: 1.2 }),
  P('CONEJO TROCEADO', 'car', 'kg', 7, 10, 10, 2, 6, { piece: 1.2 }),
  P('PECHUGA DE PAVO', 'car', 'kg', 7, 11, 10, 2, 8, { piece: 1.5 }),
  P('PANCETA FRESCA', 'car', 'kg', 6, 9, 10, 2, 6, { piece: 2 }),
  // Pescadería (IVA 10 %)
  P('MERLUZA DEL PINCHO', 'pes', 'kg', 12, 20, 10, 2, 8, { piece: 1.4, sci: 'Merluccius merluccius' }),
  P('RAPE NEGRO COLA', 'pes', 'kg', 18, 28, 10, 2, 6, { piece: 1, sci: 'Lophius budegassa' }),
  P('LUBINA DE ESTERO 600/800', 'pes', 'kg', 11, 16, 10, 2, 8, { piece: 0.7, sci: 'Dicentrarchus labrax' }),
  P('DORADA 400/600', 'pes', 'kg', 8, 12, 10, 2, 8, { piece: 0.5, sci: 'Sparus aurata' }),
  P('PULPO COCIDO PATA', 'pes', 'kg', 24, 34, 10, 1, 4, { piece: 0.25, sci: 'Octopus vulgaris' }),
  P('GAMBA ROJA CAL. 2', 'pes', 'kg', 45, 80, 10, 0.5, 3, { sci: 'Aristeus antennatus' }),
  P('LANGOSTINO COCIDO 40/60', 'pes', 'kg', 14, 22, 10, 1, 5, { sci: 'Penaeus vannamei' }),
  P('MEJILLÓN GALLEGO MALLA 2KG', 'pes', 'malla', 3.5, 6, 10, 1, 6, { sci: 'Mytilus galloprovincialis' }),
  P('CALAMAR DE POTERA', 'pes', 'kg', 14, 22, 10, 1, 5, { piece: 0.4, sci: 'Loligo vulgaris' }),
  P('BACALAO DESALADO LOMO', 'pes', 'kg', 13, 19, 10, 2, 6, { piece: 0.8, sci: 'Gadus morhua' }),
  P('ALMEJA FINA', 'pes', 'kg', 24, 38, 10, 0.5, 3, { sci: 'Ruditapes decussatus' }),
  P('SALMÓN NORUEGO FILETE C/P', 'pes', 'kg', 10, 15, 10, 2, 8, { piece: 1.4, sci: 'Salmo salar' }),
  P('BONITO DEL NORTE LOMO', 'pes', 'kg', 14, 22, 10, 1, 5, { piece: 1.2, sci: 'Thunnus alalunga' }),
  P('SEPIA LIMPIA', 'pes', 'kg', 10, 15, 10, 1, 5, { piece: 0.5, sci: 'Sepia officinalis' }),
  P('BOQUERÓN', 'pes', 'kg', 5, 9, 10, 1, 6, { sci: 'Engraulis encrasicolus' }),
  P('SARDINA', 'pes', 'kg', 3.5, 6, 10, 1, 6, { sci: 'Sardina pilchardus' }),
  P('RODABALLO', 'pes', 'kg', 16, 26, 10, 1, 5, { piece: 1.5, sci: 'Scophthalmus maximus' }),
  P('ATÚN ROJO LOMO', 'pes', 'kg', 28, 45, 10, 1, 4, { piece: 1.3, sci: 'Thunnus thynnus' }),
  // Lácteos y huevos
  P('LECHE ENTERA UHT 1L', 'lac', 'ud', 0.7, 1.05, 4, 12, 72, { caseOf: 6 }),
  P('LECHE SEMIDESNATADA 1L', 'lac', 'ud', 0.65, 1, 4, 12, 72, { caseOf: 6 }),
  P('NATA PARA MONTAR 35% 1L', 'lac', 'ud', 2.8, 4.2, 10, 3, 24, { caseOf: 6 }),
  P('NATA PARA COCINAR 1L', 'lac', 'ud', 2.2, 3.4, 10, 3, 24, { caseOf: 6 }),
  P('MANTEQUILLA SIN SAL 1KG', 'lac', 'ud', 7, 10.5, 10, 1, 8),
  P('HUEVOS CAMPEROS L DOCENA', 'lac', 'docena', 2.2, 3.4, 4, 5, 30),
  P('HUEVOS FRESCOS M ESTUCHE 30', 'lac', 'ud', 4.5, 7, 4, 2, 10),
  P('YOGUR NATURAL 125G PACK 4', 'lac', 'ud', 1, 1.8, 10, 4, 24),
  P('QUESO MANCHEGO SEMICURADO', 'lac', 'kg', 10, 16, 4, 1, 7, { piece: 3 }),
  P('QUESO DE BURGOS 1KG', 'lac', 'ud', 4.5, 7, 4, 1, 8),
  P('QUESO MOZZARELLA RALLADO 2KG', 'lac', 'ud', 9, 14, 4, 1, 6),
  P('QUESO CREMA 2KG', 'lac', 'ud', 8, 12, 4, 1, 4),
  P('LECHE DE AVENA BARISTA 1L', 'lac', 'ud', 1.8, 2.8, 10, 6, 24, { caseOf: 6 }),
  P('REQUESÓN 500G', 'lac', 'ud', 2.2, 3.2, 4, 2, 10),
  // Ultramarinos, secos y conservas
  P('ACEITE OLIVA VIRGEN EXTRA GARRAFA 5L', 'ult', 'ud', 28, 45, 4, 1, 10, { caseOf: 3 }),
  P('ACEITE DE GIRASOL 10L', 'ult', 'ud', 18, 30, 4, 1, 4),
  P('ACEITE DE OLIVA SUAVE 1L', 'ult', 'ud', 5, 8, 4, 2, 12, { caseOf: 12 }),
  P('ARROZ BOMBA 1KG', 'ult', 'ud', 3.2, 5, 4, 2, 12, { caseOf: 10 }),
  P('ARROZ REDONDO SACO 5KG', 'ult', 'ud', 5.5, 8.5, 4, 1, 6),
  P('HARINA DE TRIGO T-45 SACO 25KG', 'ult', 'ud', 14, 22, 4, 1, 3),
  P('PAN RALLADO 1KG', 'ult', 'ud', 1.5, 2.5, 4, 2, 6),
  P('AZÚCAR BLANCO 1KG', 'ult', 'ud', 0.95, 1.5, 10, 5, 20, { caseOf: 10 }),
  P('SAL MARINA GRUESA 1KG', 'ult', 'ud', 0.45, 0.8, 10, 3, 12),
  P('GARBANZO PEDROSILLANO 1KG', 'ult', 'ud', 2.6, 4, 4, 2, 10),
  P('LENTEJA PARDINA 1KG', 'ult', 'ud', 2.2, 3.4, 4, 2, 10),
  P('ALUBIA BLANCA 1KG', 'ult', 'ud', 2.4, 3.6, 4, 2, 10),
  P('TOMATE TRITURADO LATA 5KG', 'ult', 'lata', 5, 7.5, 10, 2, 8),
  P('TOMATE FRITO BRIK 2KG', 'ult', 'ud', 3.8, 5.5, 10, 2, 8),
  P('PIMIENTO DEL PIQUILLO LATA 3KG', 'ult', 'lata', 13, 19, 10, 1, 4),
  P('ATÚN CLARO EN ACEITE LATA 1KG', 'ult', 'lata', 10, 15, 10, 1, 6),
  P('ANCHOA DEL CANTÁBRICO 00 LATA 500G', 'ult', 'lata', 22, 34, 10, 1, 3),
  P('VINAGRE DE JEREZ 1L', 'ult', 'ud', 3.2, 5.5, 10, 1, 6),
  P('PIMENTÓN DE LA VERA 750G', 'ult', 'ud', 9, 13, 10, 1, 2),
  P('PIMIENTA NEGRA GRANO 1KG', 'ult', 'ud', 14, 22, 10, 1, 2),
  P('AZAFRÁN EN HEBRA 5G', 'ult', 'ud', 11, 17, 10, 1, 4),
  P('CALDO DE POLLO BRIK 1L', 'ult', 'ud', 1.2, 1.9, 10, 6, 24, { caseOf: 12 }),
  P('MAYONESA CUBO 3,6KG', 'ult', 'ud', 8, 12, 10, 1, 4),
  P('KETCHUP 1,8KG', 'ult', 'ud', 5, 7.5, 10, 1, 4),
  P('MOSTAZA DIJON 1KG', 'ult', 'ud', 4.8, 7, 10, 1, 3),
  P('CHOCOLATE COBERTURA 70% 1KG', 'ult', 'ud', 10, 15, 10, 1, 4),
  P('NUECES PELADAS 1KG', 'ult', 'ud', 11, 16, 10, 1, 3),
  P('CAFÉ EN GRANO NATURAL 1KG', 'ult', 'ud', 13, 19, 10, 2, 10),
  P('PASTA SPAGHETTI 5KG', 'ult', 'ud', 7, 11, 4, 1, 4),
  P('LEVADURA FRESCA 500G', 'ult', 'ud', 1.8, 2.8, 4, 1, 4),
  // Bebidas
  P('CERVEZA 1/3 RETORNABLE C/24', 'beb', 'caja', 14, 20, 21, 2, 10, { perBottle: [0.55, 0.85], caseOf: 24 }),
  P('CERVEZA SIN ALCOHOL 1/3 C/24', 'beb', 'caja', 13, 18, 21, 1, 5, { perBottle: [0.5, 0.78], caseOf: 24 }),
  P('BARRIL DE CERVEZA 30L', 'beb', 'ud', 65, 95, 21, 1, 4),
  P('AGUA MINERAL 50CL C/35', 'beb', 'caja', 6, 9, 10, 1, 6, { perBottle: [0.17, 0.26], caseOf: 35 }),
  P('AGUA CON GAS 1L', 'beb', 'bot', 0.5, 0.9, 10, 6, 24, { caseOf: 12 }),
  P('REFRESCO DE COLA 35CL C/24', 'beb', 'caja', 11, 15, 21, 1, 5, { perBottle: [0.46, 0.62], caseOf: 24 }),
  P('TÓNICA PREMIUM 20CL', 'beb', 'bot', 0.5, 0.8, 21, 12, 48, { caseOf: 24 }),
  P('ZUMO DE NARANJA 1L', 'beb', 'bot', 1.3, 2.2, 10, 6, 24, { caseOf: 6 }),
  P('VINO TINTO RIOJA CRIANZA 75CL', 'beb', 'bot', 4.5, 8, 21, 6, 24, { caseOf: 6 }),
  P('VINO BLANCO RUEDA VERDEJO 75CL', 'beb', 'bot', 3.5, 6.5, 21, 6, 24, { caseOf: 6 }),
  P('CAVA BRUT NATURE 75CL', 'beb', 'bot', 5.5, 9, 21, 6, 12, { caseOf: 6 }),
  P('GINEBRA LONDON DRY 70CL', 'beb', 'bot', 10, 16, 21, 1, 6),
  P('RON AÑEJO 70CL', 'beb', 'bot', 11, 18, 21, 1, 4),
  P('VERMUT ROJO 1L', 'beb', 'bot', 6, 10, 21, 1, 6, { caseOf: 6 }),
  P('LICOR DE HIERBAS 70CL', 'beb', 'bot', 8, 12, 21, 1, 3),
  P('SIDRA NATURAL 70CL', 'beb', 'bot', 2, 3.2, 21, 6, 24, { caseOf: 6 }),
  // Congelados
  P('PATATA PREFRITA 9MM CONGELADA 2,5KG', 'con', 'ud', 3.5, 6, 10, 4, 16, { caseOf: 4 }),
  P('CROQUETA DE JAMÓN 1KG', 'con', 'ud', 5.5, 8.5, 10, 2, 10),
  P('GUISANTE FINO CONGELADO 2,5KG', 'con', 'ud', 4.5, 7, 4, 1, 6),
  P('GAMBA PELADA CONGELADA 1KG', 'con', 'ud', 10, 16, 10, 1, 8),
  P('CALAMAR A LA ROMANA CONGELADO 1KG', 'con', 'ud', 6, 9, 10, 1, 6),
  P('HELADO DE VAINILLA CUBETA 5L', 'con', 'ud', 12, 18, 10, 1, 4),
  P('MASA DE HOJALDRE 1KG', 'con', 'ud', 4, 6, 10, 1, 6),
  P('VERDURA PARA MENESTRA 2,5KG', 'con', 'ud', 5, 8, 4, 1, 4),
  P('PULPO CONGELADO', 'con', 'kg', 12, 18, 10, 2, 8),
  P('TARTA DE QUESO CONGELADA 12 RAC', 'con', 'ud', 18, 28, 10, 1, 3),
  // Panadería
  P('BARRA DE PAN 250G', 'pan', 'ud', 0.3, 0.55, 4, 20, 80),
  P('PAN DE HAMBURGUESA BRIOCHE', 'pan', 'ud', 0.4, 0.7, 4, 12, 60),
  P('HOGAZA DE CENTENO 1KG', 'pan', 'ud', 2.5, 4, 4, 1, 6),
  P('PANECILLO INDIVIDUAL 40G', 'pan', 'ud', 0.12, 0.25, 4, 30, 120),
  P('CROISSANT DE MANTEQUILLA', 'pan', 'ud', 0.6, 1.1, 10, 10, 40),
  P('PICOS DE PAN 250G', 'pan', 'ud', 0.9, 1.5, 4, 5, 30),
  P('PAN DE MOLDE 1KG', 'pan', 'ud', 2.2, 3.5, 4, 1, 6),
  P('MAGDALENA', 'pan', 'ud', 0.2, 0.4, 10, 12, 48),
  // Limpieza y desechables (IVA 21 %)
  P('SERVILLETA PAPEL 40X40 PACK 100', 'lim', 'paquete', 3, 5.5, 21, 2, 12),
  P('BOLSA BASURA 85X105 ROLLO 10', 'lim', 'rollo', 1.5, 2.5, 21, 3, 20),
  P('FILM TRANSPARENTE 300M', 'lim', 'rollo', 7, 10, 21, 1, 4),
  P('PAPEL DE ALUMINIO 200M', 'lim', 'rollo', 9, 13, 21, 1, 3),
  P('GUANTES DE NITRILO CAJA 100', 'lim', 'caja', 4.5, 7, 21, 2, 10),
  P('LAVAVAJILLAS MÁQUINA 20L', 'lim', 'garrafa', 28, 40, 21, 1, 3),
  P('ABRILLANTADOR 10L', 'lim', 'garrafa', 18, 26, 21, 1, 2),
  P('DESENGRASANTE 5L', 'lim', 'garrafa', 8, 13, 21, 1, 4),
  P('BAYETA MICROFIBRA PACK 10', 'lim', 'paquete', 5, 9, 21, 1, 4),
  P('SERVILLETA CÓCTEL 20X20', 'lim', 'ud', 0.015, 0.03, 21, 500, 3000),
  // Charcutería
  P('JAMÓN IBÉRICO DE CEBO LONCHEADO 100G', 'cha', 'ud', 5, 9, 10, 5, 20),
  P('PALETA IBÉRICA DE CEBO', 'cha', 'kg', 24, 36, 10, 2, 6, { piece: 4.5 }),
  P('LOMO EMBUCHADO IBÉRICO', 'cha', 'kg', 30, 45, 10, 1, 3, { piece: 1.2 }),
  P('CHORIZO IBÉRICO CULAR', 'cha', 'kg', 13, 20, 10, 1, 4, { piece: 1.1 }),
  P('SALCHICHÓN IBÉRICO', 'cha', 'kg', 14, 22, 10, 1, 4, { piece: 1 }),
  P('JAMÓN COCIDO EXTRA', 'cha', 'kg', 8, 12, 10, 1, 6, { piece: 3 }),
  P('QUESO CURADO DE OVEJA', 'cha', 'kg', 14, 22, 4, 1, 6, { piece: 3 }),
  P('SOBRASADA DE MALLORCA IGP', 'cha', 'ud', 7, 12, 10, 1, 6),
  P('MORTADELA', 'cha', 'kg', 5, 8, 10, 1, 4, { piece: 2 }),
  P('BACON AHUMADO LONCHAS 1KG', 'cha', 'ud', 6, 9, 10, 1, 6),
];

const LONG_SUFFIX = {
  fru: ['ORIGEN ESPAÑA', 'CATEGORÍA I', 'CALIBRE EXTRA', 'PRODUCTO FRESCO DE TEMPORADA', 'CAJA 5 KG', 'ECOLÓGICO CERTIFICADO', 'SELECCIÓN HOSTELERÍA'],
  car: ['ENVASADO AL VACÍO', 'MADURADO 30 DÍAS', 'LIMPIO Y PORCIONADO', 'PIEZA ENTERA APROX.', 'ORIGEN ESPAÑA', 'RAZA AUTÓCTONA'],
  pes: ['FRESCO DE LONJA', 'LIMPIO SIN PIEL', 'PESCA EXTRACTIVA', 'ACUICULTURA NACIONAL', 'CAJA POLIESPÁN'],
  lac: ['FORMATO HOSTELERÍA', 'CAJA 6 UNIDADES', 'PRODUCTO REFRIGERADO', 'LECHE DE VACA'],
  ult: ['FORMATO HOSTELERÍA', 'PRIMERA CALIDAD', 'D.O.P.', 'CAJA 12 UNIDADES', 'ENVASE PROFESIONAL'],
  beb: ['FORMATO HOSTELERÍA', 'ENVASE RETORNABLE', 'CAJA DE 6', 'EDICIÓN LIMITADA'],
  con: ['ULTRACONGELADO', 'BOLSA PROFESIONAL', 'CAJA 4 BOLSAS', 'SIN GLUTEN'],
  pan: ['MASA MADRE', 'HORNEADO DEL DÍA', 'CAJA 20 UNIDADES'],
  lim: ['FORMATO PROFESIONAL', 'CAJA 6 UNIDADES', 'USO ALIMENTARIO'],
  cha: ['LONCHEADO A CUCHILLO', 'CURACIÓN NATURAL', 'ENVASADO AL VACÍO', 'MEDIA PIEZA', 'D.O.P.'],
};

const FAMILY_SECTION = {
  fru: ['FRUTAS Y VERDURAS', 'FRUTA Y VERDURA', 'HORTALIZAS'],
  car: ['CARNES', 'CARNICERÍA'],
  pes: ['PESCADOS Y MARISCOS', 'PESCADERÍA'],
  lac: ['LÁCTEOS Y HUEVOS', 'LÁCTEOS'],
  ult: ['ALIMENTACIÓN SECA', 'ULTRAMARINOS', 'CONSERVAS Y SECOS'],
  beb: ['BEBIDAS', 'BODEGA'],
  con: ['CONGELADOS'],
  pan: ['PANADERÍA Y BOLLERÍA'],
  lim: ['LIMPIEZA Y DESECHABLES', 'DROGUERÍA'],
  cha: ['CHARCUTERÍA Y QUESOS', 'CHARCUTERÍA'],
};

// ───────────────────────────── Proveedores, clientes, direcciones ─────────────────────────────

const SUPPLIER_KINDS = [
  { id: 'fruteria', fams: ['fru'], prefixes: ['Frutas', 'Frutas y Verduras', 'Hortofrutícola', 'Hortalizas', 'Frutería'], w: 3 },
  { id: 'carniceria', fams: ['car', 'cha'], prefixes: ['Cárnicas', 'Carnes', 'Carnicería Industrial', 'Embutidos y Carnes'], w: 2.5 },
  { id: 'pescaderia', fams: ['pes'], prefixes: ['Pescados', 'Pescados y Mariscos', 'Mariscos', 'Productos del Mar'], w: 2 },
  { id: 'lacteos', fams: ['lac', 'cha'], prefixes: ['Lácteos', 'Quesos y Lácteos', 'Central Lechera', 'Distribuciones Lácteas'], w: 1.5 },
  { id: 'ultramarinos', fams: ['ult', 'lac', 'lim'], prefixes: ['Ultramarinos', 'Comercial', 'Alimentación', 'Almacenes', 'Distribuciones'], w: 2.5 },
  { id: 'bebidas', fams: ['beb'], prefixes: ['Bebidas', 'Distribuciones de Bebidas', 'Vinos y Licores', 'Bodegas'], w: 2 },
  { id: 'congelados', fams: ['con', 'pes'], prefixes: ['Congelados', 'Frigoríficos', 'Ultracongelados'], w: 1.2 },
  { id: 'panaderia', fams: ['pan'], prefixes: ['Panadería', 'Obrador', 'Horno', 'Panificadora'], w: 1.2 },
  { id: 'horeca', fams: ['ult', 'lac', 'con', 'lim', 'beb', 'cha'], prefixes: ['Distribuciones Horeca', 'Suministros Hosteleros', 'Comercial Hostelera', 'Grupo Horeca'], w: 2 },
  { id: 'cash', fams: ['fru', 'car', 'lac', 'ult', 'beb', 'lim', 'con'], prefixes: ['Cash', 'Autoservicio Mayorista', 'Mayorista'], w: 1.5 },
];

const SURNAMES =
  'García Martínez López Sánchez Pérez Gómez Martín Jiménez Ruiz Hernández Díaz Moreno Álvarez Muñoz Romero Alonso Gutiérrez Navarro Torres Domínguez Vázquez Ramos Gil Ramírez Serrano Blanco Molina Morales Suárez Ortega Delgado Castro Ortiz Rubio Marín Sanz Iglesias Medina Garrido Cortés Castillo Santos Lozano Guerrero Cano Prieto Méndez Cruz Calvo Gallego Vidal León Herrera Márquez Peña Flores Cabrera Campos Vega Fuentes Carrasco Caballero Reyes Nieto Aguilar Pascual Santana Herrero Lorenzo Montero Hidalgo Giménez Ibáñez Ferrer Durán Benítez Mora Vicente Vargas Arias Carmona Crespo Román Pastor Soto Sáez Velasco Moya Soler Parra Esteban Bravo Gallardo Rojas'.split(
    ' ',
  );
const FIRST_NAMES = 'Antonio José Manuel Francisco Juan David Javier Carlos Miguel Rafael Pedro Ángel Luis Pablo Sergio Fernando Jorge Alberto Carmen María Ana Isabel Laura Cristina Marta Lucía Pilar Rosa Elena Teresa'.split(' ');
const PLACES = [
  'Levante', 'Meseta', 'del Cantábrico', 'del Sur', 'del Norte', 'Atlántico', 'Mediterráneo', 'La Mancha', 'Castilla', 'Aragón', 'Galicia', 'Andalucía', 'del Ebro',
  'del Duero', 'Sierra Norte', 'del Valle', 'Costa Brava', 'Guadarrama', 'Montes de Toledo', 'del Tajo', 'del Miño', 'del Segura', 'del Júcar', 'El Bierzo', 'La Rioja', 'La Vera', 'Alpujarra',
];
const GENERIC = ['Distribuciones', 'Comercial', 'Suministros', 'Almacenes', 'Exclusivas', 'Grupo', 'Importaciones'];
const SUFFIXES = [
  [5, 'S.L.'],
  [2, 'S.A.'],
  [1.2, 'S.L.U.'],
  [0.5, 'S.A.U.'],
  [0.6, 'S. Coop.'],
  [0.7, 'SL'],
  [0.4, 'SA'],
  [0.4, 'C.B.'],
];
const CUSTOMER_TYPES = ['Restaurante', 'Bar', 'Asador', 'Taberna', 'Mesón', 'Marisquería', 'Cafetería', 'Hotel', 'Arrocería', 'Gastrobar', 'Casa de Comidas', 'Cervecería'];
const CUSTOMER_NAMES = [
  'El Olivo', 'La Tahona', 'Los Robles', 'El Faro', 'La Parra', 'El Mirador', 'La Brasa', 'Casa Lola', 'La Chimenea', 'Los Almendros', 'El Patio', 'La Fuente', 'El Horno Viejo',
  'La Marina', 'El Albero', 'La Vid', 'El Trébol', 'Las Tinajas', 'El Lagar', 'La Alquería', 'Los Pinos', 'El Molino', 'La Terraza', 'San Román', 'La Lonja', 'El Cenador',
];
const STREETS = ['C/', 'Calle', 'Avda.', 'Avenida', 'Pza.', 'Paseo', 'Ctra.', 'Camino', 'Ronda', 'Pol. Ind.'];
const STREET_NAMES = [
  'Mayor', 'Real', 'del Carmen', 'San Juan', 'de la Constitución', 'Gran Vía', 'del Mar', 'de la Industria', 'de los Olivos', 'del Sol', 'de Castilla', 'de Andalucía',
  'Cervantes', 'Goya', 'Velázquez', 'Colón', 'de la Estación', 'del Puerto', 'Nueva', 'de la Paz', 'Santa Ana', 'de los Artesanos', 'del Comercio', 'La Estrella',
];
const CITIES = [
  ['Madrid', '28', 'Madrid'], ['Valencia', '46', 'Valencia'], ['Sevilla', '41', 'Sevilla'], ['Málaga', '29', 'Málaga'], ['Zaragoza', '50', 'Zaragoza'], ['Bilbao', '48', 'Bizkaia'],
  ['Valladolid', '47', 'Valladolid'], ['Murcia', '30', 'Murcia'], ['Alicante', '03', 'Alicante'], ['Córdoba', '14', 'Córdoba'], ['Granada', '18', 'Granada'], ['Salamanca', '37', 'Salamanca'],
  ['Burgos', '09', 'Burgos'], ['León', '24', 'León'], ['Santander', '39', 'Cantabria'], ['Oviedo', '33', 'Asturias'], ['Vigo', '36', 'Pontevedra'], ['A Coruña', '15', 'A Coruña'],
  ['Pamplona', '31', 'Navarra'], ['Logroño', '26', 'La Rioja'], ['Toledo', '45', 'Toledo'], ['Cáceres', '10', 'Cáceres'], ['Almería', '04', 'Almería'], ['Huelva', '21', 'Huelva'],
  ['Cádiz', '11', 'Cádiz'], ['Jaén', '23', 'Jaén'], ['Palma', '07', 'Illes Balears'], ['Girona', '17', 'Girona'], ['Tarragona', '43', 'Tarragona'], ['Castellón', '12', 'Castellón'],
];

function slug(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'empresa';
}

function makeAddress(R) {
  const [city, prov, province] = R.pick(CITIES);
  const street = `${R.pick(STREETS)} ${R.pick(STREET_NAMES)}, ${R.int(1, 140)}`;
  const cp = `${prov}${String(R.int(1, 999)).padStart(3, '0')}`;
  return { street, cp, city, province, line2: `${cp} ${city}${city !== province && R.chance(0.5) ? ` (${province})` : ''}` };
}

function makePhone(R) {
  return `9${R.int(1, 8)}${R.int(0, 9)} ${R.int(100, 999)} ${R.int(100, 999)}`;
}

function makeSupplier(R, kind) {
  const suffix = R.weighted(SUFFIXES);
  const tpl = R.weighted([
    [3, 'prefixSurname'],
    [2.5, 'prefixPlace'],
    [1.5, 'family'],
    [1.5, 'genericPlace'],
    [1, 'twoSurnames'],
    [0.5, 'person'],
  ]);
  const s1 = R.pick(SURNAMES);
  let s2 = R.pick(SURNAMES);
  if (s2 === s1) s2 = SURNAMES[(SURNAMES.indexOf(s1) + 7) % SURNAMES.length];
  let name;
  let person = false;
  if (tpl === 'prefixSurname') name = `${R.pick(kind.prefixes)} ${s1} ${suffix}`;
  else if (tpl === 'prefixPlace') name = `${R.pick(kind.prefixes)} ${R.pick(PLACES)} ${suffix}`;
  else if (tpl === 'family') name = R.pick([`Hermanos ${s1} ${suffix}`, `${s1} e Hijos ${suffix}`, `Hnos. ${s1} ${suffix}`, `${R.pick(kind.prefixes)} Hermanos ${s1} ${suffix}`]);
  else if (tpl === 'genericPlace') name = `${R.pick(GENERIC)} ${R.pick(kind.prefixes.filter((p) => !GENERIC.includes(p)).concat(['']))} ${R.pick(PLACES)} ${suffix}`.replace(/\s+/g, ' ');
  else if (tpl === 'twoSurnames') name = `${s1} ${s2} ${suffix}`;
  else {
    name = `${R.pick(FIRST_NAMES)} ${s1} ${s2}`;
    person = true;
  }
  const letter = person ? null : suffix.includes('Coop') ? 'F' : suffix === 'C.B.' ? 'E' : suffix.startsWith('S.A') || suffix === 'SA' ? 'A' : 'B';
  const taxId = person ? makeNif(R) : makeCif(R, letter);
  const addr = makeAddress(R);
  const domain = `${slug(name.replace(/\b(?:S\.?L\.?U?|S\.?A\.?U?|S\. Coop\.|C\.B\.|SL|SA)\b\.?/g, ''))}.es`;
  return { name, taxId, person, addr, phone: makePhone(R), email: `${R.pick(['pedidos', 'administracion', 'facturacion', 'info', 'ventas'])}@${domain}`, web: `www.${domain}` };
}

function makeCustomer(R) {
  const suffix = R.chance(0.7) ? ` ${R.weighted(SUFFIXES.slice(0, 3))}` : '';
  const name = R.chance(0.15) ? `Grupo ${R.pick(CUSTOMER_NAMES)}${suffix || ' S.L.'}` : `${R.pick(CUSTOMER_TYPES)} ${R.pick(CUSTOMER_NAMES)}${suffix}`;
  const person = !suffix && R.chance(0.5);
  return { name, taxId: person ? makeNif(R) : makeCif(R, 'B'), addr: makeAddress(R), code: String(R.int(100, 99999)).padStart(R.pick([4, 5, 6]), '0') };
}

// ───────────────────────────── Fechas y números de documento ─────────────────────────────

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function makeDate(R) {
  const y = R.pick([2025, 2026, 2026]);
  const m = R.int(1, 12);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = R.int(1, days);
  return { y, m, d, iso: `${y}-${pad2(m)}-${pad2(d)}` };
}

function addDays(date, n) {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), iso: t.toISOString().slice(0, 10) };
}

function fmtDate(date, style) {
  const { y, m, d } = date;
  switch (style) {
    case 'dmy-':
      return `${pad2(d)}-${pad2(m)}-${y}`;
    case 'dmy.':
      return `${pad2(d)}.${pad2(m)}.${y}`;
    case 'd/m/y':
      return `${d}/${m}/${y}`;
    case 'dmyy':
      return `${pad2(d)}/${pad2(m)}/${String(y).slice(2)}`;
    case 'long':
      return `${d} de ${MONTHS[m - 1]} de ${y}`;
    case 'mon':
      return `${pad2(d)}-${MONTHS_SHORT[m - 1]}-${y}`;
    default:
      return `${pad2(d)}/${pad2(m)}/${y}`;
  }
}

function makeNumber(R, date, kind) {
  const yy = String(date.y).slice(2);
  const L = R.pick(['F', 'FV', 'FA', 'A', 'FC', 'V', 'FL', 'VT', 'FR', 'B']);
  const n = (k) => String(R.int(1, 10 ** k - 1)).padStart(k, '0');
  if (kind === 'ticket') return R.pick([`T${n(3)}-${date.y}-${n(6)}`, `${n(3)}/${n(4)}/${n(6)}`, `${n(4)}-${n(8)}`, `FS${yy}/${n(6)}`]);
  if (kind === 'albaran') return R.pick([`AV-${yy}-${n(5)}`, `${n(6)}`, `A${yy}/${n(5)}`, `ALB-${n(6)}`]);
  return R.weighted([
    [2, `${L}${yy}-${n(6)}`],
    [2, `${L}-${date.y}/${n(6)}`],
    [2, `${date.y}/${n(4)}`],
    [1.5, `${yy}/${L}/${n(6)}`],
    [1, `${L}${L}/${yy}/${n(5)}`],
    [1.5, n(6)],
    [1, `${L}${n(7)}`],
    [1, `${L}${yy}-${n(5)}`],
    [1, `${date.y}-${n(5)}`],
    [1, `${L}-${n(5)}`],
  ]);
}

// ───────────────────────────── Estilo del documento ─────────────────────────────

const SANS = ["'Liberation Sans', Arial, sans-serif", "'DejaVu Sans', Verdana, sans-serif", "'FreeSans', Helvetica, sans-serif"];
const SERIF = ["'Liberation Serif', 'Times New Roman', serif", "'DejaVu Serif', Georgia, serif", "'FreeSerif', serif", "'Bitstream Charter', serif"];
const MONO = ["'Liberation Mono', monospace", "'DejaVu Sans Mono', monospace", "'FreeMono', monospace", "'Courier 10 Pitch', monospace"];
const ACCENTS = ['#0b5394', '#7a1f1f', '#274e13', '#134f5c', '#8e1b3a', '#6b3e1f', '#333333', '#1c4587', '#5b0f00', '#38761d', '#351c75', '#000000'];

function makeNumberFormat(R) {
  return {
    thousands: R.chance(0.75),
    priceDec: R.weighted([
      [6, 2],
      [2.5, 3],
      [1.5, 4],
    ]),
    qtyDecKg: R.weighted([
      [5.5, 3],
      [4, 2],
      [0.5, 1],
    ]),
    qtyDecUd: R.weighted([
      [7.5, 0],
      [2, 2],
      [0.5, 3],
    ]),
    totalCur: R.weighted([
      [7, ''],
      [2, ' €'],
      [1, '€'],
    ]),
    priceCur: R.chance(0.1),
    trailingMinus: R.chance(0.15),
  };
}

// ───────────────────────────── Líneas ─────────────────────────────

/** Etiqueta impresa de una unidad de facturación. */
const UNIT_PRINT = {
  kg: ['KG', 'Kg', 'kg', 'KGS', 'K'],
  ud: ['UD', 'UDS', 'Ud.', 'U', 'UN', 'UND'],
  caja: ['CJ', 'CAJA', 'Caja', 'CAJ'],
  bot: ['BOT', 'Bot.', 'BOT.'],
  l: ['L', 'LT', 'Lts'],
  malla: ['MALLA', 'Malla', 'MLL'],
  manojo: ['MANOJO', 'MNJ', 'Manojo'],
  bandeja: ['BANDEJA', 'BDJA', 'Band.'],
  docena: ['DOC', 'DOCENA', 'Doc.'],
  paquete: ['PAQ', 'PAQUETE', 'Paq.'],
  lata: ['LATA', 'Lata', 'LAT'],
  rollo: ['ROLLO', 'Rollo', 'RLL'],
  garrafa: ['GARRAFA', 'Garrafa', 'GAR'],
};

/** Unidad canónica que devuelve el parser para cada unidad de facturación. */
const UNIT_CANON = { kg: 'kg', ud: 'ud', caja: 'caja', bot: 'bot', l: 'l', malla: 'malla', manojo: 'manojo', bandeja: 'bandeja', docena: 'docena', paquete: 'paquete', lata: 'lata', rollo: 'rollo', garrafa: 'garrafa' };

function pickProducts(R, kind, n) {
  const pool = CATALOG.filter((p) => kind.fams.includes(p.fam));
  return R.sample(pool, Math.min(n, pool.length));
}

function makeLot(R, date) {
  return R.weighted([
    [2, `L${String(date.y).slice(2)}${pad2(date.m)}${R.pick(['A', 'B', 'C', 'D'])}`],
    [2, `${String(date.y).slice(2)}${pad2(date.m)}${pad2(R.int(1, 28))}-${pad2(R.int(1, 20))}`],
    [1.5, `${R.pick(['G', 'N', 'M', 'P', 'Y', 'H'])}${R.int(1000, 99999)}`],
    [1, String(R.int(100000, 9999999))],
  ]);
}

function makeExpiry(R, date) {
  const t = addDays(date, R.int(8, 700));
  return R.weighted([
    [2, fmtDate(t, 'dmy')],
    [1.5, `${pad2(t.m)}/${t.y}`],
    [0.5, `${pad2(t.m)}-${t.y}`],
  ]);
}

function makeEan(R) {
  const base = `84${String(R.int(10000, 99999))}${String(R.int(10000, 99999))}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 ? 3 : 1);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

/**
 * Crea las líneas de producto con sus cantidades, precios, descuentos e importes (lo que se imprime es la verdad).
 * opts: { priceDec, qtyDecKg, qtyDecUd, discounts: 0|1|2, discountRate, bottles: 'perBottle'|'perCase', negativeAll, returnLine }
 */
function makeLines(R, products, opts, style) {
  const lines = [];
  for (const prod of products) {
    let unit = prod.unit;
    let qty;
    let price;
    let cases;
    let pieces;
    let qtyDec;
    const perBottle = prod.perBottle && opts.bottles === 'perBottle';
    if (unit === 'kg') {
      qtyDec = opts.qtyDecKg;
      qty = R.chance(0.2) && prod.qmax >= 3 ? R.int(Math.max(1, Math.ceil(prod.qmin)), Math.floor(prod.qmax)) : rnd(R.float(prod.qmin, prod.qmax), qtyDec);
      if (qty <= 0) qty = rnd(prod.qmin || 1, qtyDec) || 1;
      pieces = prod.piece ? Math.max(1, Math.round(qty / prod.piece)) : R.int(1, 4);
    } else if (perBottle) {
      unit = 'bot';
      qtyDec = opts.qtyDecUd;
      cases = R.int(Math.max(1, prod.qmin), prod.qmax);
      qty = cases * prod.caseOf;
    } else {
      qtyDec = opts.qtyDecUd;
      qty = R.int(Math.ceil(prod.qmin), Math.floor(prod.qmax));
      cases = Math.max(1, Math.ceil(qty / (prod.caseOf ?? R.pick([6, 10, 12, 20]))));
    }
    if (cases === undefined) cases = R.int(1, 4);
    const [pmin, pmax] = perBottle ? prod.perBottle : [prod.pmin, prod.pmax];
    const dec = prod.pmax < 0.1 ? Math.max(4, opts.priceDec) : opts.priceDec;
    price = rnd(R.float(pmin, pmax), dec);
    if (price <= 0) price = rnd(pmin, dec);
    let dto;
    let dto2;
    if (opts.discounts && R.chance(opts.discountRate ?? 0.3)) {
      dto = R.pick([2, 3, 5, 5, 7.5, 8, 10, 10, 12, 15, 20, 25]);
      if (opts.discounts === 2 && R.chance(0.35)) dto2 = R.pick([2, 3, 5]);
    }
    let desc = applyCase(prod.d, style.caseStyle);
    if (style.longDesc && R.chance(style.longDesc)) desc = `${desc} ${applyCase(R.pick(LONG_SUFFIX[prod.fam]), style.caseStyle)}`;
    lines.push({ prod, desc, unit, qty, qtyDec, price, priceDec: dec, dto, dto2, cases, pieces, vat: prod.vat });
  }
  if (opts.negativeAll) for (const l of lines) l.qty = -Math.abs(l.qty);
  else if (opts.returnLine && lines.length > 2) {
    const l = lines[R.int(1, lines.length - 1)];
    l.qty = -Math.abs(l.unit === 'kg' ? rnd(Math.min(Math.abs(l.qty), R.float(0.3, 2)), l.qtyDec) || 1 : Math.min(Math.abs(l.qty), R.int(1, 3)));
    if (l.cases) l.cases = -Math.max(1, Math.ceil(Math.abs(l.qty) / (l.prod.caseOf || 1)));
    if (l.pieces) l.pieces = -Math.max(1, Math.min(Math.abs(l.pieces), 2));
  }
  if (opts.uc) {
    for (const l of lines) {
      if (l.unit === 'kg') continue;
      l.uc = l.prod.caseOf ?? R.pick([6, 10, 12, 24]);
      l.cases = Math.max(1, Math.round(Math.abs(l.qty) / l.uc)) * Math.sign(l.qty || 1);
      l.qty = l.cases * l.uc;
    }
  }
  for (const l of lines) {
    if (opts.discStyle === 'eur') {
      // Descuento en euros: importe = bruto − descuento; el % resultante se deduce del importe
      const gross = rnd(l.qty * l.price, 2);
      l.dtoEur = l.dto ? rnd((gross * l.dto) / 100, 2) : 0;
      l.total = rnd(gross - l.dtoEur, 2);
      l.dtoPctFromTotal = l.dtoEur ? rnd((1 - l.total / (l.qty * l.price)) * 100, 2) : undefined;
      l.dto = undefined;
    } else l.total = rnd(l.qty * l.price * (1 - (l.dto ?? 0) / 100) * (1 - (l.dto2 ?? 0) / 100), 2);
  }
  return lines;
}

function combinedDiscount(l) {
  if (l.dtoPctFromTotal !== undefined) return l.dtoPctFromTotal;
  if (!l.dto && !l.dto2) return undefined;
  return rnd((1 - (1 - (l.dto ?? 0) / 100) * (1 - (l.dto2 ?? 0) / 100)) * 100, 2);
}

/** Totales con desglose de IVA; `extras` (portes, envases) cuentan en la base; descuento global sobre cada tipo. */
function computeTotals(lines, extras, globalDiscountPct = 0) {
  const all = [...lines, ...extras];
  const rates = [...new Set(all.map((l) => l.vat))].sort((a, b) => a - b);
  const gross = rnd(all.reduce((s, l) => s + l.total, 0), 2);
  const breakdown = rates.map((rate) => {
    const sumRate = rnd(all.filter((l) => l.vat === rate).reduce((s, l) => s + l.total, 0), 2);
    const base = rnd(sumRate * (1 - globalDiscountPct / 100), 2);
    return { rate, gross: sumRate, base, vat: rnd((base * rate) / 100, 2) };
  });
  const subtotal = rnd(breakdown.reduce((s, b) => s + b.base, 0), 2);
  const vatTotal = rnd(breakdown.reduce((s, b) => s + b.vat, 0), 2);
  return { gross, discount: rnd(gross - subtotal, 2), breakdown, subtotal, vatTotal, total: rnd(subtotal + vatTotal, 2), globalDiscountPct };
}

function makeExtras(R, kind, style) {
  const out = [];
  if (R.chance(0.14)) out.push({ desc: applyCase(R.pick(['PORTES', 'TRANSPORTE', 'GASTOS DE ENVÍO', 'PORTES Y ENTREGA']), style.caseStyle), qty: 1, price: rnd(R.float(5, 25), 2), vat: 21 });
  if (kind.id === 'bebidas' && R.chance(0.5)) {
    const n = R.int(2, 8);
    const price = R.pick([3, 3.6, 4.2, 5]);
    out.push({ desc: applyCase('ENVASE RETORNABLE CAJA 1/3', style.caseStyle), qty: n, price, vat: 21 });
    if (R.chance(0.6)) out.push({ desc: applyCase('DEVOLUCIÓN ENVASE CAJA 1/3', style.caseStyle), qty: -R.int(1, n), price, vat: 21 });
  }
  if (kind.id === 'bebidas' && R.chance(0.2)) out.push({ desc: applyCase('FIANZA BARRIL 30L', style.caseStyle), qty: R.int(1, 3), price: 25, vat: 21 });
  for (const e of out) {
    e.total = rnd(e.qty * e.price, 2);
    e.extra = true;
    e.unit = 'ud';
    e.qtyDec = 0;
    e.priceDec = 2;
  }
  return out;
}

// ───────────────────────────── Piezas HTML comunes ─────────────────────────────

const BASE_CSS = `* { box-sizing: border-box; } html, body { margin: 0; padding: 0; color: #1d1d1f; } table { border-collapse: collapse; }
  .r { text-align: right; } .c { text-align: center; } .b { font-weight: 700; } .muted { color: #555; }`;

function htmlDoc(title, css, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;
}

const TAX_LABELS = ['CIF', 'C.I.F.', 'CIF:', 'NIF', 'N.I.F.', 'NIF/CIF', 'CIF/NIF'];

function taxLine(R, id, person) {
  const label = person ? R.pick(['NIF', 'N.I.F.', 'DNI/NIF']) : R.pick(TAX_LABELS);
  return `${label}${label.endsWith(':') ? '' : R.pick([':', '', ':'])} ${printTaxId(R, id)}`;
}

const NUMBER_LABELS = ['Factura nº', 'Nº factura', 'FACTURA Nº', 'Número de factura', 'Nº Factura:', 'Factura:', 'Fra. nº', 'Nº documento', 'Número:', 'Nº Fra.'];
const DATE_LABELS = ['Fecha', 'Fecha factura', 'Fecha de factura', 'Fecha emisión', 'F. factura', 'Fecha:', 'Fecha de expedición'];

function labelValue(label, value) {
  return /:$/.test(label) ? `${label} ${value}` : `${label}: ${value}`;
}

// ───────────────────────────── Plantilla 1: tabla HTML clásica ─────────────────────────────

const COL_LABELS = {
  line: ['Lín.', 'Nº', '#', 'L.', 'Pos.'],
  code: ['Código', 'Cód.', 'Cod.', 'Ref.', 'Referencia', 'Art.', 'Cód. Art.', 'Codigo'],
  ean: ['EAN', 'EAN13', 'Cód. barras', 'EAN-13'],
  desc: ['Descripción', 'Artículo', 'Concepto', 'Producto', 'Denominación', 'Detalle', 'Descripción del artículo', 'Designación', 'Mercancía'],
  lot: ['Lote', 'Nº Lote', 'Lot.', 'Partida'],
  cad: ['Cad.', 'Caducidad', 'F. Cad.', 'Fecha cad.', 'Cons. pref.', 'F.Caduc.'],
  origin: ['Origen', 'País', 'Proc.'],
  bultos: ['Bultos', 'Cajas', 'Bult.', 'Cj.', 'Nº bultos'],
  uds: ['Uds', 'Uds.', 'Piezas', 'Pzs.', 'Unid.', 'Nº uds'],
  qty: ['Cantidad', 'Cant.', 'Cant', 'Unidades', 'Uds.', 'Cantidad servida', 'Servido'],
  qtyKg: ['Kilos', 'Kg', 'Peso', 'Neto kg', 'Peso neto', 'Kgs.', 'Peso (kg)'],
  qtyBot: ['Botellas', 'Unidades', 'Bot.', 'Uds.'],
  unit: ['Ud.', 'UM', 'U.M.', 'Unidad', 'Formato', 'Medida', 'U.', 'Und.'],
  price: ['Precio', 'P. Unit.', 'Precio unit.', 'Precio unitario', 'Pr. Unit.', 'Tarifa', 'P.U.', '€/Ud.', 'Precio €', 'P. unitario', 'Precio/ud', 'Precio neto'],
  priceKg: ['€/kg', 'Precio/kg', 'Precio kg', 'Precio €/kg'],
  dto1: ['Dto.', 'Dto', '% Dto', 'Desc.', 'Dcto.', '%Dto.', 'Dto. %', 'Bonif.'],
  dto1b: ['Dto.1', 'Dto 1', 'Dto1', 'Desc. 1', '% Dto.1'],
  dto2: ['Dto.2', 'Dto 2', 'Dto2', 'Desc. 2', '% Dto.2'],
  total: ['Importe', 'Total', 'Neto', 'Importe neto', 'Total línea', 'Importe €', 'Base', 'Subtotal', 'Valor', 'Total €'],
  vat: ['IVA', '% IVA', 'IVA %', 'T. IVA', 'Tipo', '%IVA', 'I.V.A.'],
  dtoEur: ['Dto. €', 'Imp. dto.', 'Descuento €', 'Dto. (€)'],
  totalBase: ['Subtotal', 'Base', 'Importe neto', 'Neto', 'Base imp.'],
  totalVat: ['Total', 'Total €', 'Importe total', 'Total c/IVA'],
  uc: ['U/C', 'Uds/caja', 'UxC', 'Ud./caja'],
};

const ALIGN = { line: 'c', code: '', ean: '', desc: '', lot: '', cad: '', origin: '', bultos: 'r', uds: 'r', uc: 'r', qty: 'r', unit: 'c', price: 'r', dto1: 'r', dto2: 'r', total: 'r', vat: 'c', totalVat: 'r' };

function chooseColumns(R, kind, products, template) {
  const hasKg = products.some((p) => p.unit === 'kg');
  const allKg = products.every((p) => p.unit === 'kg');
  const cols = [];
  const lead = [];
  if (R.chance(0.1)) lead.push('line');
  const codeKind = R.weighted([
    [5.5, 'code'],
    [1, 'ean'],
    [3.5, null],
  ]);
  const codeAfterDesc = codeKind && R.chance(0.1);
  if (codeKind && !codeAfterDesc) lead.push(codeKind);
  const trace = [];
  if (R.chance(0.12)) {
    trace.push('lot');
    if (R.chance(0.7)) trace.push('cad');
  }
  if (['fru', 'pes', 'car'].some((f) => kind.fams[0] === f) && R.chance(0.08)) trace.push('origin');
  let qtyBlock;
  let qtyLabelKind = 'qty';
  let bottles = 'perCase';
  const kgSupplier = ['carniceria', 'pescaderia'].includes(kind.id) || (kind.id === 'lacteos' && hasKg);
  if (kgSupplier && hasKg && R.chance(0.4)) {
    qtyBlock = R.chance(0.8) ? ['uds', 'qty'] : ['qty', 'uds'];
    qtyLabelKind = 'qtyKg';
  } else if (kind.id === 'bebidas' && R.chance(0.55)) {
    bottles = 'perBottle';
    qtyBlock = R.chance(0.7) ? ['bultos', 'qty'] : ['qty'];
    qtyLabelKind = 'qtyBot';
  } else if (R.chance(0.14)) {
    qtyBlock = ['bultos', 'qty'];
  } else qtyBlock = ['qty'];
  if (allKg && qtyLabelKind === 'qty' && R.chance(0.3)) qtyLabelKind = 'qtyKg';
  const unitCol = R.chance(0.42) ? (R.chance(0.85) ? 'after' : 'before') : null;
  const discounts = R.chance(0.3) ? (R.chance(0.28) ? 2 : 1) : 0;
  // Descuento en euros en lugar de porcentaje (algunos ERP)
  const discStyle = discounts === 1 && R.chance(0.25) ? 'eur' : 'pct';
  const vatCol = R.chance(0.5) ? (R.chance(0.8) ? 'after' : 'before') : null;
  // Importe con IVA por línea además de la base
  const totalVat = vatCol === 'after' && R.chance(0.15);
  // Unidades por caja entre los bultos y la cantidad
  const uc = qtyBlock[0] === 'bultos' && qtyBlock.length === 2 && qtyLabelKind === 'qty' && R.chance(0.3);
  if (uc) qtyBlock.splice(1, 0, 'uc');
  const priceFirst = template !== 'albaran' && R.chance(0.08);
  const qtyFirst = template === 'albaran' ? R.chance(0.75) : R.chance(0.03);

  const qtyPart = [];
  if (unitCol === 'before') qtyPart.push('unit');
  qtyPart.push(...qtyBlock);
  if (unitCol === 'after') qtyPart.push('unit');
  const money = [];
  if (!priceFirst) money.push('price');
  if (discounts) money.push('dto1');
  if (discounts === 2) money.push('dto2');
  if (vatCol === 'before') money.push('vat');
  money.push('total');
  if (vatCol === 'after') money.push('vat');
  if (totalVat) money.push('totalVat');

  if (qtyFirst) cols.push(...lead.filter((c) => c === 'line'), ...qtyPart, ...lead.filter((c) => c !== 'line'), 'desc');
  else cols.push(...lead, 'desc');
  if (codeAfterDesc) cols.push(codeKind);
  cols.push(...trace);
  if (priceFirst) cols.push('price');
  if (!qtyFirst) cols.push(...qtyPart);
  cols.push(...money);

  const labels = {};
  const used = new Set();
  for (const c of cols) {
    let list = COL_LABELS[c];
    if (c === 'qty') list = COL_LABELS[qtyLabelKind];
    if (c === 'price' && (qtyLabelKind === 'qtyKg' && allKg ? R.chance(0.5) : allKg && R.chance(0.2))) list = COL_LABELS.priceKg;
    if (c === 'dto1' && discounts === 2) list = COL_LABELS.dto1b;
    if (c === 'dto1' && discStyle === 'eur') list = COL_LABELS.dtoEur;
    if (c === 'total' && totalVat) list = COL_LABELS.totalBase;
    let label = R.pick(list.filter((l) => !used.has(l.toLowerCase())));
    if (!label) label = list[0];
    used.add(label.toLowerCase());
    labels[c] = label;
  }
  if (labels.desc === 'Artículo' && labels.code === 'Art.') labels.code = 'Código';
  return { cols, labels, discounts, discStyle, bottles, qtyLabelKind };
}

function fmtQty(l, nf) {
  if (l.qty === undefined || l.qty === null) return '';
  return fmtNum(l.qty, l.qtyDec, { thousands: nf.thousands, trailingMinus: nf.trailingMinus });
}

function cellText(col, l, ctx) {
  const { nf, fmtOpt } = ctx;
  switch (col) {
    case 'line':
      return String(l.index + 1);
    case 'code':
      return l.code ?? '';
    case 'ean':
      return l.ean ?? '';
    case 'desc':
      return l.desc;
    case 'lot':
      return l.lot ?? '';
    case 'cad':
      return l.cad ?? '';
    case 'origin':
      return l.origin ?? '';
    case 'bultos':
      return l.cases !== undefined && l.cases !== null ? fmtNum(l.cases, 0, { trailingMinus: nf.trailingMinus }) : '';
    case 'uds':
      if (l.extra) return '';
      if (l.unit === 'kg') return l.pieces !== undefined ? fmtNum(l.pieces, 0, { trailingMinus: nf.trailingMinus }) : '';
      return fmtQty(l, nf);
    case 'qty':
      if (ctx.qtyLabelKind === 'qtyKg' && ctx.cols.includes('uds') && l.unit !== 'kg' && !l.extra) return l.weight ? fmtNum(l.weight, nf.qtyDecKg) : '';
      if (ctx.bottlesOnlyCases && l.cases !== undefined) return fmtNum(l.cases, 0);
      return `${fmtQty(l, nf)}${l.glueUnit ? ` ${l.glueUnit}` : ''}`;
    case 'unit':
      return l.unitLabel ?? '';
    case 'price': {
      const s = fmtNum(l.price, l.priceDec, { thousands: nf.thousands });
      return nf.priceCur ? `${s} €` : s;
    }
    case 'uc':
      return l.uc ? String(l.uc) : '';
    case 'totalVat':
      return l.extra && !l.vat ? '' : `${fmtNum(rnd(l.total * (1 + l.vat / 100), 2), 2, { thousands: nf.thousands, trailingMinus: nf.trailingMinus })}${nf.totalCur}`;
    case 'dto1':
    case 'dto2': {
      if (col === 'dto1' && l.dtoEur !== undefined) return l.dtoEur ? fmtNum(l.dtoEur, 2) : fmtOpt.zeroDisc && !l.extra ? fmtNum(0, 2) : '';
      const v = col === 'dto1' ? l.dto : l.dto2;
      if (!v) return fmtOpt.zeroDisc && !l.extra ? fmtNum(0, fmtOpt.discDec) : '';
      return `${fmtNum(v, Number.isInteger(v) ? fmtOpt.discDec : Math.max(1, fmtOpt.discDec))}${fmtOpt.discPct ? '%' : ''}`;
    }
    case 'total':
      return `${fmtNum(l.total, 2, { thousands: nf.thousands, trailingMinus: nf.trailingMinus })}${nf.totalCur}`;
    case 'vat':
      return ctx.vatText(l.vat);
    default:
      return '';
  }
}

function sectionOf(l) {
  return l.prod?.fam;
}

function supplierBlockHtml(R, ctx, align = 'left') {
  const { supplier, style } = ctx;
  const s = supplier;
  const showTax = !ctx.taxInFooter;
  const parts = [
    `<div class="sname">${esc(s.name)}</div>`,
    `<div>${esc(s.addr.street)}</div>`,
    `<div>${esc(s.addr.line2)}</div>`,
    showTax ? `<div>${esc(taxLine(R, s.taxId, s.person))}${R.chance(0.5) ? ` · Tel. ${s.phone}` : ''}</div>` : `<div>Tel. ${s.phone}</div>`,
  ];
  if (R.chance(0.5)) parts.push(`<div class="muted">${esc(s.email)}${R.chance(0.5) ? ` · ${s.web}` : ''}</div>`);
  if (style.logo) parts.unshift(`<div class="logo">${esc(s.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</div>`);
  return `<div class="supplier" style="text-align:${align}">${parts.join('')}</div>`;
}

function customerBlockHtml(R, ctx) {
  const c = ctx.customer;
  const label = R.pick(['Cliente', 'CLIENTE', 'Datos del cliente', 'Facturar a', 'Destinatario', 'Sr./Sres.', 'Cliente:']);
  const lines = [`<div class="clbl">${esc(label)}</div>`, `<div class="b">${esc(c.name)}</div>`, `<div>${esc(c.addr.street)}</div>`, `<div>${esc(c.addr.line2)}</div>`];
  const tax = `<div>${esc(R.pick(['NIF', 'CIF', 'N.I.F.', 'CIF/NIF']))}: ${esc(printTaxId(R, c.taxId))}</div>`;
  if (R.chance(0.85)) lines.push(tax);
  if (R.chance(0.3)) lines.splice(1, 0, `<div>${esc(R.pick(['Cód. cliente', 'Nº cliente', 'Cliente nº']))}: ${c.code}</div>`);
  return `<div class="customer">${lines.join('')}</div>`;
}

function metaFields(R, ctx) {
  const { number, date, style } = ctx;
  const fields = [];
  const numberLabel = ctx.template === 'albaran' ? R.pick(['Albarán nº', 'Nº albarán', 'Nº:', 'Albarán:']) : R.pick(NUMBER_LABELS);
  const dateLabel = ctx.template === 'albaran' ? R.pick(['Fecha', 'Fecha:', 'Fecha entrega']) : R.pick(DATE_LABELS);
  fields.push([numberLabel, number]);
  fields.push([dateLabel, fmtDate(date, style.dateStyle)]);
  if (R.chance(0.35)) fields.push([R.pick(['Cód. cliente', 'Nº cliente', 'Cliente']), ctx.customer.code]);
  if (R.chance(0.3)) fields.push([R.pick(['Forma de pago', 'F. pago']), R.pick(['Transferencia 30 días', 'Recibo domiciliado', 'Contado', 'Pagaré 60 días', 'Confirming 90 días'])]);
  if (R.chance(0.3)) fields.push([R.pick(['Vencimiento', 'Fecha vencimiento', 'Vto.']), fmtDate(addDays(date, R.pick([15, 30, 45, 60])), style.dateStyle)]);
  if (ctx.template !== 'albaran' && R.chance(0.25)) fields.push([R.pick(['Albarán', 'Nº albarán', 'Alb.']), `${String(date.y).slice(2)}-${R.int(1000, 9999)}`]);
  if (R.chance(0.15)) fields.push([R.pick(['Pedido', 'Su pedido', 'S/Ref.']), String(R.int(1000, 99999))]);
  if (R.chance(0.2)) fields.push(['Página', ctx.pageCount > 1 ? `1 de ${ctx.pageCount}` : '1 de 1']);
  // El número y la fecha no siempre van primero
  if (R.chance(0.25)) {
    const [a, b, ...rest] = fields;
    return [...rest.slice(0, 1), a, b, ...rest.slice(1)];
  }
  return fields;
}

function metaHtml(R, ctx, fields, mode) {
  if (mode === 'grid') {
    return `<table class="grid"><tr>${fields.map(([k]) => `<th>${esc(k.replace(/:$/, ''))}</th>`).join('')}</tr><tr>${fields.map(([, v]) => `<td>${esc(v)}</td>`).join('')}</tr></table>`;
  }
  if (mode === 'kv') return `<table class="kv">${fields.map(([k, v]) => `<tr><td>${esc(k.replace(/:$/, ''))}</td><td class="b">${esc(v)}</td></tr>`).join('')}</table>`;
  return fields.map(([k, v]) => `<div>${esc(labelValue(k, v))}</div>`).join('');
}

function totalsHtml(R, ctx) {
  const { totals, nf, extrasSum } = ctx;
  const f = (v) => fmtNum(v, 2, { thousands: nf.thousands });
  const cur = R.pick(['', ' €', ' €', ' EUR']);
  const style = R.weighted([
    [3, 'list'],
    [3, 'vatTable'],
    [1.5, 'row'],
    [1.2, 'sobre'],
  ]);
  const baseLabel = R.pick(['Base imponible', 'BASE IMPONIBLE', 'Base Imponible', 'Total base imponible', 'B. Imponible']);
  const totalLabel = R.pick(['TOTAL FACTURA', 'Total factura', 'TOTAL', 'Total a pagar', 'TOTAL €', 'IMPORTE TOTAL', 'Líquido a pagar']);
  const vatTotalLabel = R.pick(['Total IVA', 'Cuota IVA', 'IVA', 'Importe IVA', 'TOTAL IVA']);
  const pre = [];
  if (totals.globalDiscountPct) {
    pre.push([R.pick(['Importe bruto', 'Suma importes', 'Total bruto']), f(totals.gross)]);
    pre.push([`${R.pick(['Dto. pronto pago', 'Descuento pronto pago', 'Dto. P.P.'])} ${fmtNum(totals.globalDiscountPct, 0)}%`, `-${f(totals.discount)}`]);
  } else if (extrasSum && R.chance(0.5)) {
    pre.push([R.pick(['Suma productos', 'Total productos', 'Subtotal']), f(rnd(totals.gross - extrasSum, 2))]);
  }
  const rows = [...pre];
  if (style === 'list') {
    rows.push([baseLabel, f(totals.subtotal)]);
    for (const b of totals.breakdown) rows.push([`IVA ${b.rate}%`, f(b.vat)]);
    if (totals.breakdown.length > 1 && R.chance(0.5)) rows.push([vatTotalLabel, f(totals.vatTotal)]);
    rows.push([totalLabel, `${f(totals.total)}${cur}`]);
    return `<table class="tot">${rows.map(([k, v], i) => `<tr${i === rows.length - 1 ? ' class="grand"' : ''}><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</table>`;
  }
  if (style === 'sobre') {
    rows.push([R.pick(['Suma neto', 'Base imponible', 'Total neto']), f(totals.subtotal)]);
    for (const b of totals.breakdown) rows.push([`IVA ${b.rate}% s/ ${f(b.base)}`, f(b.vat)]);
    rows.push([totalLabel, `${f(totals.total)}${cur}`]);
    return `<table class="tot">${rows.map(([k, v], i) => `<tr${i === rows.length - 1 ? ' class="grand"' : ''}><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</table>`;
  }
  if (style === 'row' && totals.breakdown.length === 1) {
    const b = totals.breakdown[0];
    const heads = [...pre.map(([k]) => k), baseLabel, '% IVA', vatTotalLabel, totalLabel];
    const vals = [...pre.map(([, v]) => v), f(totals.subtotal), fmtNum(b.rate, R.pick([0, 2])), f(totals.vatTotal), `${f(totals.total)}${cur}`];
    return `<table class="totrow"><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr><tr>${vals.map((v) => `<td>${esc(v)}</td>`).join('')}</tr></table>`;
  }
  // Cuadro de IVA + resumen
  const rateCol = R.pick(['% IVA', 'Tipo', 'IVA %', 'Tipo IVA']);
  const vt = `<table class="vat"><tr><th>${esc(rateCol)}</th><th class="r">${esc(R.pick(['Base imponible', 'Base', 'Bases']))}</th><th class="r">${esc(R.pick(['Cuota', 'Cuota IVA', 'Importe IVA']))}</th></tr>${totals.breakdown
    .map((b) => `<tr><td>${esc(R.pick([`${b.rate} %`, `${b.rate}%`, `${fmtNum(b.rate, 2)}`]))}</td><td class="r">${f(b.base)}</td><td class="r">${f(b.vat)}</td></tr>`)
    .join('')}</table>`;
  const sum = [...pre, [baseLabel, f(totals.subtotal)], [vatTotalLabel, f(totals.vatTotal)], [totalLabel, `${f(totals.total)}${cur}`]];
  const st = `<table class="tot">${sum.map(([k, v], i) => `<tr${i === sum.length - 1 ? ' class="grand"' : ''}><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</table>`;
  return `<div class="totwrap">${vt}${st}</div>`;
}

function footerHtml(R, ctx) {
  const s = ctx.supplier;
  const parts = [];
  if (ctx.taxInFooter || R.chance(0.35)) parts.push(`${esc(s.name)} · ${esc(taxLine(R, s.taxId, s.person))}`);
  if (R.chance(0.5)) parts.push(`Inscrita en el Registro Mercantil de ${esc(s.addr.province)}, Tomo ${R.int(1000, 30000)}, Folio ${R.int(1, 220)}, Hoja ${R.pick(['M', 'V', 'SE', 'B', 'Z'])}-${R.int(10000, 400000)}`);
  if (R.chance(0.5)) parts.push(`IBAN ES${R.int(10, 99)} ${R.int(1000, 9999)} ${R.int(1000, 9999)} ${R.int(10, 99)}${R.int(10, 99)} ${R.int(100000, 999999)}${R.int(1000, 9999)}`);
  return parts.length ? `<div class="foot">${parts.join(' · ')}</div>` : '';
}

function tableTemplate(R, ctx) {
  const { lines, extras, nf, style, cfg } = ctx;
  const cols = cfg.cols;
  const fs = style.fontSize;
  const accent = style.accent;
  const vatStyle = R.pick(['n', 'pct', 'dec', 'spct']);
  const ctxCell = {
    nf,
    cols,
    qtyLabelKind: cfg.qtyLabelKind,
    bottlesOnlyCases: false,
    fmtOpt: { zeroDisc: R.chance(0.25), discDec: R.pick([0, 1, 2, 2]), discPct: R.chance(0.25) },
    vatText: (v) => (vatStyle === 'pct' ? `${v}%` : vatStyle === 'dec' ? fmtNum(v, 2) : vatStyle === 'spct' ? `${v} %` : String(v)),
  };
  const all = [...lines];
  // Extras (portes, envases) dentro de la tabla, al final o intercalados
  for (const e of extras) all.splice(R.chance(0.7) ? all.length : R.int(1, all.length), 0, e);
  all.forEach((l, i) => (l.index = i));
  const noHeader = style.noHeader;
  const sections = style.sections;
  const subRows = style.subRows;
  const descIdx = cols.indexOf('desc');
  const wrapHeader = R.chance(0.2);
  const widths = {
    line: 26, code: R.int(44, 70), ean: 92, lot: 58, cad: 58, origin: 50, bultos: 44, uds: 40, uc: 36, qty: R.int(46, 64), unit: 36, price: R.int(52, 72), dto1: 40, dto2: 40, total: R.int(62, 84), vat: 36, totalVat: R.int(62, 84),
  };
  const colgroup = `<colgroup>${cols
    .map((c) => (c === 'desc' ? '<col>' : `<col style="width:${Math.round(widths[c] * (fs / 10))}px">`))
    .join('')}</colgroup>`;
  const thead = noHeader
    ? ''
    : `<thead><tr>${cols.map((c) => `<th class="${ALIGN[c]}">${esc(cfg.labels[c])}</th>`).join('')}</tr></thead>`;
  // Descripciones en dos filas: la celda tiene un ancho máximo menor que las descripciones largas
  const maxDesc = Math.max(...all.map((l) => l.desc.length));
  const wrapPx = Math.round(maxDesc * 0.56 * fs * R.float(0.45, 0.72));
  const rowHtml = (l) => {
    const tds = cols
      .map((c) => {
        const t = esc(cellText(c, l, ctxCell));
        return `<td class="${ALIGN[c]}${c === 'desc' ? ' d' : ''}">${c === 'desc' && style.wrapDesc ? `<div style="max-width:${wrapPx}px">${t}</div>` : t}</td>`;
      })
      .join('');
    let out = `<tr class="ln${l.extra ? ' x' : ''}">${tds}</tr>`;
    if (subRows && !l.extra && l.sub) out += `<tr class="sub"><td colspan="${Math.max(1, descIdx)}"></td><td colspan="${cols.length - Math.max(1, descIdx)}">${esc(l.sub)}</td></tr>`;
    return out;
  };
  const sectionRow = (name) => `<tr class="sec"><td colspan="${cols.length}">${esc(name)}</td></tr>`;

  // Paginación explícita (con «Suma y sigue») o flujo natural
  const capacity = Math.max(8, Math.floor(((style.landscape ? 150 : 235) / (fs * (style.wrapDesc ? 2.3 : 1.5) + (subRows ? fs * 1.3 : 0))) * 3.7 * ctx.capacityScale));
  const pages = [];
  if (style.explicitPages && all.length > capacity * 0.8) {
    const first = Math.max(5, Math.floor(capacity * 0.62));
    let i = 0;
    while (i < all.length) {
      const cap = pages.length === 0 ? first : Math.floor(capacity * 0.85);
      pages.push(all.slice(i, i + cap));
      i += cap;
    }
    // La última página necesita sitio para los totales
    const last = pages[pages.length - 1];
    if (pages.length > 1 && last.length > capacity * 0.6) pages.push(last.splice(Math.floor(last.length / 2)));
  } else pages.push(all);
  ctx.pageCount = pages.length;

  const meta = metaFields(R, ctx);
  const headerMode = style.headerMode;
  const metaMode = headerMode === 'grid' ? 'grid' : R.pick(['kv', 'lines', 'kv']);
  const docTitle = ctx.template === 'albaran' ? R.pick(['ALBARÁN VALORADO', 'ALBARÁN', 'Albarán de entrega', 'NOTA DE ENTREGA VALORADA']) : ctx.rectificativa ? R.pick(['FACTURA RECTIFICATIVA', 'ABONO', 'FACTURA DE ABONO']) : R.pick(['FACTURA', 'Factura', 'FACTURA', 'FACTURA DE VENTA']);
  const title = `<div class="dtitle">${esc(docTitle)}</div>`;
  let head;
  if (headerMode === 'supplierLeft') {
    head = `<div class="top">${supplierBlockHtml(R, ctx)}<div class="box">${title}${metaHtml(R, ctx, meta, metaMode)}</div></div><div class="custrow">${customerBlockHtml(R, ctx)}</div>`;
  } else if (headerMode === 'customerLeft') {
    head = `<div class="top">${customerBlockHtml(R, ctx)}${supplierBlockHtml(R, ctx, 'right')}</div><div class="metarow">${title}${metaHtml(R, ctx, meta, metaMode)}</div>`;
  } else if (headerMode === 'centered') {
    head = `<div class="center">${supplierBlockHtml(R, ctx, 'center')}</div><div class="top"><div class="box">${title}${metaHtml(R, ctx, meta, metaMode)}</div>${customerBlockHtml(R, ctx)}</div>`;
  } else if (headerMode === 'band') {
    // Banda de color con la razón social y el título; debajo, señas del proveedor y una caja de datos que incluye
    // al cliente (código, nombre y NIF) en lugar de un bloque propio
    const c = ctx.customer;
    const custFields = [
      [R.pick(['Cliente', 'Cliente:', 'Cód. cliente']), R.chance(0.6) ? `${c.code} · ${c.name}` : c.name],
      [R.pick(['NIF', 'CIF', 'NIF cliente', 'N.I.F.']), printTaxId(R, c.taxId)],
    ];
    const box = [...meta.slice(0, 2), ...custFields, ...meta.slice(2)];
    const s = ctx.supplier;
    const tagline = R.pick(['Distribución para hostelería', 'Productos frescos de calidad', 'Mayorista de alimentación', 'Servicio a domicilio para restauración', '']);
    const addr = `<div>${esc(s.addr.street)} · ${esc(s.addr.line2)}</div><div>${esc(taxLine(R, s.taxId, s.person))} · Tel. ${s.phone}</div>${R.chance(0.5) ? `<div class="muted">${esc(s.email)}</div>` : ''}`;
    head = `<div class="band"><div><div class="bname">${esc(s.name)}</div>${tagline ? `<div>${esc(tagline)}</div>` : ''}</div><div class="btitle">${esc(docTitle)}</div></div>
      <div class="top"><div class="supplier">${addr}</div><div>${metaHtml(R, ctx, box, R.pick(['lines', 'kv']))}</div></div>`;
  } else if (headerMode === 'labeled') {
    // Título y datos del documento arriba; debajo dos cajas rotuladas: emisor (proveedor) y cliente
    const s = ctx.supplier;
    const lbl = R.pick(['Emisor', 'EMISOR', 'Proveedor', 'Datos del emisor', 'PROVEEDOR']);
    const spaced = R.chance(0.4) ? `letter-spacing:${R.int(2, 4)}px;text-transform:uppercase;` : '';
    const sup = `<div class="customer"><div class="clbl" style="${spaced}">${esc(lbl)}</div><div class="b">${esc(s.name)}</div><div>${esc(s.addr.street)} · ${esc(s.addr.line2)}</div><div>${esc(taxLine(R, s.taxId, s.person))}</div>${R.chance(0.5) ? `<div>${esc(s.email)}</div>` : ''}</div>`;
    const cust = customerBlockHtml(R, ctx);
    head = `<div class="top"><div>${title}${metaHtml(R, ctx, meta, 'lines')}</div></div><div class="top" style="margin-top:12px">${R.chance(0.8) ? sup + cust : cust + sup}</div>`;
  } else if (headerMode === 'inline') {
    // Cliente en un párrafo con la etiqueta en línea ("Cliente: Nombre · NIF X") y la dirección debajo
    const c = ctx.customer;
    const cl = `<p class="inl"><b>${esc(R.pick(['Cliente:', 'Cliente', 'Facturar a:', 'Destinatario:']))}</b> ${esc(c.name)} · ${esc(R.pick(['NIF', 'CIF', 'N.I.F.']))} ${esc(printTaxId(R, c.taxId))}<br>${esc(c.addr.street)} · ${esc(c.addr.line2)}</p>`;
    const sup = supplierBlockHtml(R, ctx);
    head = R.chance(0.5)
      ? `<div class="top">${sup}<div class="box">${title}${metaHtml(R, ctx, meta, metaMode)}</div></div>${cl}`
      : `<div class="top">${sup}<div>${title}${metaHtml(R, ctx, meta, 'lines')}</div></div>${cl}`;
  } else {
    // grid: proveedor y cliente arriba; datos del documento en rejilla (etiqueta arriba, valor debajo)
    head = `<div class="top">${supplierBlockHtml(R, ctx)}${customerBlockHtml(R, ctx)}</div>${title}${metaHtml(R, ctx, meta, 'grid')}`;
  }
  const footer = footerHtml(R, ctx);
  const f2 = (v) => fmtNum(v, 2, { thousands: nf.thousands });
  const sumLabel = R.pick(['SUMA Y SIGUE', 'Suma y sigue', 'SUMA Y SIGUE ...', 'Suma y sigue:']);
  const prevLabel = R.pick(['SUMA ANTERIOR', 'Suma anterior', 'Viene de la página anterior', 'SUMA ANTERIOR:']);
  const explicitCarry = pages.length > 1 && R.chance(0.75);
  let carried = 0;
  const pageHtml = pages.map((pl, pi) => {
    let body = '';
    if (pi > 0 && explicitCarry) body += `<tr class="carry"><td colspan="${cols.length - 1}" class="r">${esc(prevLabel)}</td><td class="r">${f2(carried)}</td></tr>`;
    let lastSec;
    for (const l of pl) {
      if (sections && !l.extra && sectionOf(l) !== lastSec) {
        lastSec = sectionOf(l);
        body += sectionRow(applyCase(R.pick(FAMILY_SECTION[lastSec]), style.caseStyle === 'noaccents' ? 'noaccents' : 'upper'));
      }
      body += rowHtml(l);
      carried = rnd(carried + l.total, 2);
    }
    const lastPage = pi === pages.length - 1;
    if (!lastPage && explicitCarry) body += `<tr class="carry"><td colspan="${cols.length - 1}" class="r">${esc(sumLabel)}</td><td class="r">${f2(carried)}</td></tr>`;
    const tbl = `<table class="lines">${colgroup}${thead}<tbody>${body}</tbody></table>`;
    const pageHead = pi === 0 ? head : `<div class="mini"><span class="b">${esc(ctx.supplier.name)}</span><span>${esc(`${docTitle} ${ctx.number} · ${fmtDate(ctx.date, style.dateStyle)}`)}</span></div>`;
    const pageNo = pages.length > 1 ? `<div class="pgno">Página ${pi + 1} de ${pages.length}</div>` : '';
    const cont = !lastPage && !explicitCarry ? `<div class="cont">${esc(R.pick(['Continúa en la página siguiente', 'Sigue en la hoja siguiente']))}</div>` : '';
    const tail = lastPage ? `${totalsHtml(R, ctx)}${R.chance(0.4) ? `<p class="pay">${esc(R.pick(['Forma de pago: transferencia bancaria', 'Pago al contado', 'Recibo domiciliado a 30 días', 'Gracias por su confianza']))}</p>` : ''}` : cont;
    return `<div class="page${style.explicitPages ? ' fixed' : ''}">${pageHead}${tbl}${tail}${footer}${pageNo}</div>`;
  });
  const pageH = style.landscape ? 210 - 2 * style.marginMm : 297 - 2 * style.marginMm;
  const css = `body { font-family: ${style.font}; font-size: ${fs}px; }
    .page { position: relative; }
    .page.fixed { height: ${pageH - 3}mm; break-after: page; }
    .page.fixed:last-child { break-after: auto; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
    .center { text-align: center; margin-bottom: 8px; }
    .band { display: flex; justify-content: space-between; align-items: center; background: ${accent}; color: #fff; padding: 8px 12px; margin-bottom: 8px; }
    .bname { font-size: ${Math.round(fs * R.float(1.4, 1.8))}px; font-weight: 700; }
    .btitle { font-size: ${Math.round(fs * 2)}px; letter-spacing: 2px; }
    .inl { margin: 10px 0; }
    .sname { font-size: ${Math.round(fs * R.float(1.4, 1.9))}px; font-weight: 700; color: ${accent}; margin-bottom: 2px; }
    .logo { display: inline-block; background: ${accent}; color: #fff; font-weight: 700; padding: 3px 8px; margin-bottom: 4px; }
    .box { border: 1px solid ${accent}; padding: 6px 10px; min-width: 38%; }
    .dtitle { font-size: ${Math.round(fs * 1.6)}px; font-weight: 700; color: ${accent}; margin: 4px 0; ${R.chance(0.3) ? `letter-spacing: ${R.int(2, 5)}px;` : ''} }
    .kv td { padding: 1px 10px 1px 0; }
    .custrow { display: flex; justify-content: ${R.pick(['flex-end', 'flex-start'])}; margin: 10px 0; }
    .customer { border: 1px solid #999; padding: 6px 10px; min-width: 40%; }
    .clbl { font-size: ${Math.max(7, fs - 1.5)}px; color: ${accent}; font-weight: 700; ${R.chance(0.3) ? `text-transform: uppercase; letter-spacing: ${R.float(1, 2.5).toFixed(1)}px;` : ''} }
    .metarow { margin: 10px 0; }
    table.grid { width: 100%; margin: 8px 0; border: 1px solid ${accent}; }
    table.grid th { background: ${accent}; color: #fff; padding: 2px 6px; text-align: left; font-size: ${Math.max(7, fs - 1)}px; }
    table.grid td { padding: 3px 6px; }
    table.lines { width: 100%; margin-top: 10px; }
    table.lines th { padding: ${R.int(2, 5)}px 4px; text-align: left; ${style.headStyle === 'fill' ? `background: ${accent}; color: #fff;` : `border-top: 1.5px solid ${accent}; border-bottom: 1.5px solid ${accent};`} ${wrapHeader ? 'white-space: normal;' : 'white-space: nowrap;'} }
    table.lines th.r { text-align: right; } table.lines th.c { text-align: center; }
    table.lines td { padding: ${R.pick([1, 2, 3, 4])}px 4px; vertical-align: ${style.vAlign}; ${style.grid ? 'border: 1px solid #bbb;' : 'border-bottom: 1px solid #e3e3e3;'} }
    ${style.zebra ? 'table.lines tr.ln:nth-child(even) td { background: #f3f3f3; }' : ''}
    table.lines td:not(.d) { white-space: nowrap; }
    tr.x td { font-style: italic; }
    tr.sub td { font-size: ${Math.max(6.5, fs - 1.5)}px; color: #555; border-bottom: 1px dotted #bbb; padding-top: 0; }
    tr.sec td { font-weight: 700; padding-top: 6px; ${R.chance(0.5) ? 'background: #eee;' : ''} }
    tr.carry td { font-weight: 700; border-top: 1.5px solid #333; }
    .mini { display: flex; justify-content: space-between; border-bottom: 1.5px solid ${accent}; padding-bottom: 4px; }
    .totwrap { display: flex; justify-content: space-between; margin-top: 14px; }
    table.vat th { padding: 2px 8px; border-bottom: 1px solid #999; text-align: left; } table.vat td { padding: 2px 8px; }
    table.tot { margin: 14px 0 0 auto; } table.tot td { padding: 2px 10px; } table.tot .grand td { font-weight: 700; font-size: ${Math.round(fs * 1.25)}px; border-top: 2px solid ${accent}; }
    .totwrap table.tot { margin-top: 0; }
    table.totrow { width: 100%; margin-top: 14px; border: 1px solid ${accent}; } table.totrow th { padding: 3px; background: #eee; } table.totrow td { padding: 4px; text-align: center; }
    .foot { margin-top: 18px; font-size: ${Math.max(6.5, fs - 2)}px; color: #666; border-top: 1px solid #ccc; padding-top: 3px; }
    .page.fixed .foot { position: absolute; bottom: 4mm; left: 0; right: 0; }
    .pgno { font-size: ${Math.max(6.5, fs - 2)}px; text-align: right; }
    .page.fixed .pgno { position: absolute; bottom: 0; right: 0; }
    .cont { margin-top: 6px; font-style: italic; }
    .pay { margin-top: 10px; }`;
  return htmlDoc(`${docTitle} ${ctx.number}`, css, pageHtml.join(''));
}

// ───────────────────────────── Plantilla 2: informe de ERP monoespaciado ─────────────────────────────

function erpTemplate(R, ctx) {
  const { lines, extras, nf, style, cfg, supplier, customer } = ctx;
  const cols = cfg.cols.filter((c) => !['lot', 'cad', 'origin', 'ean'].includes(c) || R.chance(0.6));
  const all = [...lines, ...extras];
  all.forEach((l, i) => (l.index = i));
  const descW = Math.min(Math.max(...all.map((l) => l.desc.length)), R.int(22, 40));
  const cellCtx = {
    nf,
    cols,
    qtyLabelKind: cfg.qtyLabelKind,
    fmtOpt: { zeroDisc: R.chance(0.4), discDec: R.pick([0, 1, 2]), discPct: false },
    vatText: R.chance(0.5) ? (v) => String(v) : (v) => fmtNum(v, 2),
  };
  for (const l of all) l.printedDesc = l.desc.slice(0, descW).trimEnd();
  const texts = all.map((l) => cols.map((c) => (c === 'desc' ? l.printedDesc : cellText(c, l, cellCtx))));
  // Ancho de cada columna: máximo entre la etiqueta y los datos
  const labels = cols.map((c) => stripAccents(cfg.labels[c]).toUpperCase());
  const widths = cols.map((c, k) => (c === 'desc' ? descW : Math.max(labels[k].length, ...texts.map((t) => t[k].length))));
  const gap = R.pick([1, 2, 2, 3]);
  const alignRight = (c) => ['bultos', 'uds', 'qty', 'price', 'dto1', 'dto2', 'total', 'vat', 'line'].includes(c);
  const cell = (s, k) => (alignRight(cols[k]) ? s.padStart(widths[k]) : s.padEnd(widths[k]));
  const join = (arr) => arr.map((s, k) => cell(s, k)).join(' '.repeat(gap)).trimEnd();
  const width = widths.reduce((a, b) => a + b, 0) + gap * (cols.length - 1);
  const lineChar = R.pick(['-', '=', '_']);
  const out = [];
  const right = (a, b) => `${a}${' '.repeat(Math.max(2, width - a.length - b.length))}${b}`;
  const numLabel = R.pick(['FACTURA Nº:', 'Nº FACTURA:', 'FACTURA:', 'NUM. FACTURA:']);
  const dateLabel = R.pick(['FECHA:', 'FECHA FACTURA:', 'F. FACTURA:']);
  const s = supplier;
  const up = (x) => (R.chance(0.5) ? x.toUpperCase() : x);
  out.push(right(up(s.name), `${numLabel} ${ctx.number}`));
  out.push(right(up(s.addr.street), `${dateLabel} ${fmtDate(ctx.date, style.dateStyle)}`));
  out.push(right(up(s.addr.line2), R.chance(0.5) ? `PÁGINA: 1` : ''));
  out.push(`${taxLine(R, s.taxId, s.person).toUpperCase()}   TEL. ${s.phone}`);
  out.push('');
  const cl = R.pick(['CLIENTE:', 'CLIENTE', 'DESTINATARIO:']);
  out.push(`${cl} ${customer.code}  ${customer.name.toUpperCase()}`);
  out.push(`${' '.repeat(cl.length + 1)}${customer.addr.street.toUpperCase()}, ${customer.addr.line2.toUpperCase()}   NIF: ${printTaxId(R, customer.taxId)}`);
  out.push('');
  out.push(lineChar.repeat(width));
  if (!style.noHeader) {
    out.push(join(labels));
    out.push(lineChar.repeat(width));
  }
  texts.forEach((t) => out.push(join(t)));
  out.push(lineChar.repeat(width));
  const f = (v) => fmtNum(v, 2, { thousands: nf.thousands });
  const t = ctx.totals;
  out.push('');
  if (t.globalDiscountPct) {
    out.push(right('', `IMPORTE BRUTO: ${f(t.gross).padStart(12)}`));
    out.push(right('', `DTO. PRONTO PAGO ${t.globalDiscountPct}%: ${`-${f(t.discount)}`.padStart(12)}`));
  }
  out.push(right('', `${'BASE IMPONIBLE'.padEnd(10)}  ${'% IVA'.padStart(6)}  ${'CUOTA'.padStart(10)}`));
  for (const b of t.breakdown) out.push(right('', `${f(b.base).padStart(14)}  ${fmtNum(b.rate, 2).padStart(6)}  ${f(b.vat).padStart(10)}`));
  out.push('');
  out.push(right('', `${R.pick(['TOTAL FACTURA', 'TOTAL A PAGAR', 'TOTAL EUROS'])}: ${f(t.total).padStart(12)}`));
  out.push('');
  out.push(R.pick(['FORMA DE PAGO: TRANSFERENCIA A 30 DIAS', 'FORMA DE PAGO: RECIBO DOMICILIADO', 'FORMA DE PAGO: CONTADO']));
  // El informe tiene que caber a lo ancho: se reduce la letra si hace falta (como al imprimir desde el ERP)
  const availPx = (((style.landscape ? 297 : 210) - 2 * style.marginMm) * 96) / 25.4;
  const longest = Math.max(...out.map((x) => x.length));
  style.fontSize = Number(Math.min(style.fontSize, availPx / (longest * 0.615)).toFixed(2));
  const css = `body { font-family: ${style.monoFont}; font-size: ${style.fontSize}px; } pre { margin: 0; font: inherit; line-height: ${R.pick([1.2, 1.3, 1.4])}; white-space: pre; }`;
  return htmlDoc(`Factura ${ctx.number}`, css, `<pre>${esc(out.join('\n'))}</pre>`);
}

// ───────────────────────────── Plantilla 3: ticket térmico ─────────────────────────────

function ticketTemplate(R, ctx) {
  const { lines, style, supplier, customer, totals } = ctx;
  const W = R.int(38, 46);
  const codes = R.chance(0.6) ? { 4: 'A', 10: 'B', 21: 'C' } : R.chance(0.5) ? { 21: 'A', 10: 'B', 4: 'C' } : null;
  const showCode = R.chance(0.7);
  const showRate = R.chance(0.6);
  const vatMark = (v) => (codes ? codes[v] : showRate ? `${v}%` : '');
  const f = (v, d = 2) => fmtNum(v, d, { thousands: false });
  const padLine = (a, b) => `${a}${' '.repeat(Math.max(1, W - a.length - b.length))}${b}`;
  const center = (x) => `${' '.repeat(Math.max(0, Math.floor((W - x.length) / 2)))}${x}`;
  const out = [];
  const up = (x) => stripAccents(x).toUpperCase();
  out.push(center(up(supplier.name)));
  out.push(center(`${R.pick(['CIF', 'C.I.F.', 'NIF'])} ${printTaxId(R, supplier.taxId)}`));
  out.push(center(up(supplier.addr.street).slice(0, W)));
  out.push(center(up(supplier.addr.line2).slice(0, W)));
  if (R.chance(0.6)) out.push(center(`TEL. ${supplier.phone}`));
  out.push('-'.repeat(W));
  out.push(`${R.pick(['FACTURA SIMPLIFICADA:', 'FRA. SIMPLIFICADA Nº', 'TICKET Nº', 'FACTURA Nº'])} ${ctx.number}`);
  out.push(`FECHA ${fmtDate(ctx.date, R.pick(['dmy', 'dmyy', 'dmy-']))}  HORA ${pad2(R.int(7, 20))}:${pad2(R.int(0, 59))}${R.chance(0.5) ? `  CAJA ${R.int(1, 30)}` : ''}`);
  if (R.chance(0.7)) {
    out.push(`CLIENTE ${customer.code} ${up(customer.name).slice(0, W - 14)}`);
    out.push(`NIF CLIENTE ${printTaxId(R, customer.taxId)}`);
  }
  out.push('-'.repeat(W));
  if (R.chance(0.6)) out.push('PRECIOS SIN IVA');
  const layout = R.weighted([
    [3, 'codeDesc'],
    [2, 'qtyDesc'],
  ]);
  if (layout === 'codeDesc') out.push(padLine(showCode ? 'ART.    DESCRIPCION' : 'DESCRIPCION', 'IMPORTE  '));
  else out.push(padLine('CANT DESCRIPCION', 'PRECIO  IMPORTE'));
  out.push('-'.repeat(W));
  for (const l of lines) {
    const mark = vatMark(l.vat);
    const amount = `${f(l.total)}${mark ? ` ${mark}` : ''}`;
    const full = up(l.desc);
    const codeTxt = showCode ? `${l.code} ` : '';
    l.codePrinted = showCode;
    if (layout === 'qtyDesc') {
      const q = l.unit === 'kg' ? f(l.qty, 3) : String(l.qty);
      const right = `${f(l.price, l.priceDec).padStart(7)} ${amount.padStart(9)}`;
      l.printedDesc = full.slice(0, Math.max(8, W - right.length - 8)).trimEnd();
      out.push(padLine(`${q.padStart(5)} ${l.printedDesc}`, right));
      continue;
    }
    const single = l.unit !== 'kg' && Math.abs(l.qty) === 1 && R.chance(0.8);
    l.printedDesc = full.slice(0, single ? Math.max(8, W - amount.length - 2 - codeTxt.length) : W - codeTxt.length).trimEnd();
    const desc = l.printedDesc;
    if (l.unit === 'kg') {
      out.push(`${codeTxt}${desc}`);
      out.push(padLine(`     ${f(l.qty, 3)} kg x ${f(l.price, l.priceDec)} ${R.pick(['EUR/kg', '€/kg', '/kg'])}`, amount));
    } else if (single) {
      out.push(padLine(`${codeTxt}${desc}`, amount));
    } else {
      out.push(`${codeTxt}${desc}`);
      out.push(padLine(R.pick([`        x${l.qty}    ${f(l.price, l.priceDec)}`, `     ${l.qty} x ${f(l.price, l.priceDec)}`, `        ${l.qty} UD X ${f(l.price, l.priceDec)}`]), amount));
    }
  }
  out.push('-'.repeat(W));
  out.push(`TOTAL ARTICULOS: ${lines.length}`);
  out.push('');
  out.push(padLine('IVA     BASE      CUOTA', ''));
  for (const b of totals.breakdown) out.push(`${codes ? `${codes[b.rate]} ` : ''}${String(b.rate).padStart(2)}%  ${f(b.base).padStart(8)}  ${f(b.vat).padStart(8)}`);
  out.push('');
  out.push(padLine('BASE IMPONIBLE', f(totals.subtotal)));
  out.push(padLine('TOTAL IVA', f(totals.vatTotal)));
  out.push(padLine('TOTAL', `${f(totals.total)} ${R.pick(['EUR', '€', ''])}`.trim()));
  out.push(padLine(R.pick(['ENTREGADO TARJETA', 'PAGO CON TARJETA', 'EFECTIVO']), f(totals.total)));
  out.push('');
  if (codes) out.push(Object.entries(codes).map(([rate, c]) => `${c}: IVA ${rate}%`).join('  '));
  out.push(center('GRACIAS POR SU VISITA'));
  // El rollo mide 80 mm: la letra se ajusta para que quepa la línea más larga
  const longest = Math.max(...out.map((x) => x.length));
  const fs = Math.min(R.float(9.5, 11.5), (((80 - 7) * 96) / 25.4) / (longest * 0.615));
  const css = `body { font-family: ${style.monoFont}; font-size: ${fs.toFixed(2)}px; width: 80mm; } pre { margin: 0; padding: 4mm 3mm; font: inherit; line-height: 1.32; white-space: pre; }`;
  return htmlDoc(`Ticket ${ctx.number}`, css, `<pre>${esc(out.join('\n'))}</pre>`);
}

// ───────────────────────────── Plantilla 4: cash & carry / mayorista ─────────────────────────────

/** Código de unidad de venta → unidad que debe salir (la de `normUnit` del parser). */
const CASH_UNIT_CODES = { KG: 'kg', CJ: 'caja', BT: 'bot', MA: 'malla', MJ: 'manojo', BJ: 'bandeja', PQ: 'paquete', LA: 'lata', GF: 'garrafa', DC: 'docena', BD: 'bidon', UN: 'ud', BO: 'bote', FR: 'bote', TR: 'bote', CB: 'cubo', SC: 'saco', BL: 'bolsa', BR: 'brik' };
const CASH_CODE_FOR = { caja: ['CJ'], bot: ['BT'], malla: ['MA'], manojo: ['MJ'], bandeja: ['BJ'], paquete: ['PQ'], lata: ['LA'], garrafa: ['GF'], docena: ['DC'], l: ['BD', 'BR', 'GF'], ud: ['UN', 'BO', 'FR', 'TR', 'CB', 'SC', 'BL'] };
const CASH_BRANDS = ['', '', 'Chef Select', 'Horeca Plus', 'Gastro Line', 'ARO', 'Maestro Cocina'];

function cashCarryInvoice(seed, opts = {}) {
  const R = makeRng(seed);
  const kind = SUPPLIER_KINDS.find((k) => k.id === 'cash');
  // Un cash & carry es siempre una sociedad (nunca una persona física)
  let supplier = makeSupplier(R, kind);
  for (let k = 0; k < 5 && supplier.person; k++) supplier = makeSupplier(R, kind);
  // Razón social de mayorista (S.A. con CIF de letra A la mayoría de las veces)
  if (!supplier.person && R.chance(0.7)) {
    supplier.name = supplier.name.replace(/\s+(?:S\.?L\.?U?\.?|S\.?A\.?U?\.?|S\. Coop\.|C\.B\.|SL|SA|SLU)$/i, '') + ', S.A.';
    const seven = supplier.taxId.slice(1, 8);
    supplier.taxId = `A${seven}${cifControl('A', seven)}`;
  }
  const customer = makeCustomer(R);
  const date = makeDate(R);
  const pad = (n, k) => String(n).padStart(k, '0');
  const number = `0/0(${pad(R.int(1, 99), 3)})${pad(R.int(1, 9999), 4)}/(${date.y})${pad(R.int(1, 999999), 6)}`;
  const brand = R.pick(CASH_BRANDS);
  const vatCodes = R.pick([{ 4: '5', 10: '1', 21: '2' }, { 4: '1', 10: '2', 21: '3' }, { 4: '4', 10: '6', 21: '7' }]);
  const summary = R.chance(0.45);
  const fontSize = Number(R.float(7.4, 9.2).toFixed(2));
  const f = (v, d) => fmtNum(v, d, { thousands: false });
  const products = pickProducts(R, kind, R.weighted([
    [1, R.int(3, 6)],
    [3, R.int(7, 14)],
    [1.5, R.int(15, 22)],
  ]));
  const lines = products.map((prod) => {
    const kg = prod.unit === 'kg';
    const code = kg ? 'KG' : R.pick(CASH_CODE_FOR[prod.unit] ?? CASH_CODE_FOR.ud);
    let desc = applyCase(prod.d, R.pick(['upper', 'title', 'sentence', 'sentence']));
    if (brand && R.chance(0.6)) desc = `${brand} ${desc}`;
    const artCode = R.chance(0.1) ? `0${makeEan(R)}` : pad(R.int(1000, 999999), 6);
    const price = rnd(R.float(prod.pmin, Math.max(prod.pmin + 0.05, prod.pmax)), 2);
    let pu;
    let cp;
    let cpDec;
    if (kg) {
      pu = price;
      cp = rnd(R.float(0.35, Math.max(0.8, Math.min(8, prod.qmax))), 3);
      cpDec = 3;
    } else if (R.chance(0.18)) {
      // Caja de N unidades a precio por unidad: Precio = Prec. Ud. × N
      cp = R.pick([6, 12, 24]);
      pu = rnd(price / cp, 3) || 0.01;
      cpDec = 0;
    } else {
      pu = price;
      cp = 1;
      cpDec = 0;
    }
    const pr = rnd(pu * cp, 2);
    const cant = kg ? (R.chance(0.88) ? 1 : R.int(2, 3)) : R.weighted([
      [6, 1],
      [3, R.int(2, 6)],
      [0.6, R.int(8, 24)],
    ]);
    const total = rnd(pr * cant, 2);
    const trace = R.chance(0.15);
    const oneRow = desc.length <= 36 && R.chance(0.35);
    return { prod, kg, code, desc, artCode, pu, cp, cpDec, pr, cant, total, vat: prod.vat, trace, oneRow, lot: pad(R.int(0, 99999), R.pick([1, 5])) };
  });
  const subtotal = rnd(lines.reduce((a, l) => a + l.total, 0), 2);
  const rates = [...new Set(lines.map((l) => l.vat))].sort((a, b) => a - b);
  const breakdown = rates.map((rate) => {
    const base = rnd(lines.filter((l) => l.vat === rate).reduce((a, l) => a + l.total, 0), 2);
    return { rate, base, vat: rnd((base * rate) / 100, 2) };
  });
  const vatTotal = rnd(breakdown.reduce((a, b) => a + b.vat, 0), 2);
  const total = rnd(subtotal + vatTotal, 2);

  // Maquetación en columnas fijas (impresora de agujas / ERP)
  const DESC_X = 15;
  const NUM_X = 64;
  const amounts = (l) =>
    [l.code.padEnd(4), f(l.pu, 3).padStart(9), f(l.cp, l.cpDec).padStart(9), f(l.pr, 2).padStart(9), String(l.cant).padStart(6), f(l.total, 2).padStart(10), `     ${vatCodes[l.vat]}`].join(' ');
  const W = NUM_X + amounts(lines[0]).length;
  const right = (a, b) => `${a}${' '.repeat(Math.max(2, W - a.length - b.length))}${b}`;
  const col = (a, b, c) => {
    const left = a.padEnd(Math.max(46, a.length + 4));
    return `${left}${b.padEnd(Math.max(b.length + 2, W - left.length - c.length - 2))}  ${c}`;
  };
  const hhmm = `${pad2(R.int(7, 20))}:${pad2(R.int(0, 59))}`;
  const cif = supplier.taxId;
  const cifPrinted = supplier.person ? supplier.taxId : R.pick([`${cif[0]}-${cif.slice(1, 3)}/${cif.slice(3)}`, `${cif[0]}-${cif.slice(1)}`, `${cif[0]}${cif.slice(1, 3)} ${cif.slice(3)}`]);
  const out = [];
  const branch = makeAddress(R);
  out.push(col(supplier.name, stripAccents(branch.line2.replace(/^\d+\s*/, '')).toUpperCase(), 'Pagina:   1'));
  out.push(col(supplier.addr.street, stripAccents(branch.street).toUpperCase(), `Fecha de venta:    ${fmtDate(date, 'dmy')} ${hhmm}`));
  out.push(col(supplier.addr.line2, stripAccents(branch.line2).toUpperCase(), `Fecha impresion:   ${fmtDate(date, 'dmy')} ${hhmm}`));
  out.push(`Telf.: ${supplier.phone}   Fax: ${makePhone(R)}`);
  out.push(cifPrinted);
  out.push(`${R.pick(['Inscrita en el Reg. Merc. de', 'Merc. de', 'R. Merc. de'])} ${R.pick(['Madrid', 'Sevilla', 'Barcelona', 'Valencia', 'Málaga', 'Bizkaia', 'Zaragoza', 'Murcia'])}, T. ${R.int(1, 9)}.${pad(R.int(0, 999), 3)} L. 0 F. ${R.int(1, 220)}, Secc. 8.ª H. ${R.pick(['M', 'SE', 'B', 'V', 'MA'])}-${R.int(1, 99)}.${pad(R.int(0, 999), 3)}`);
  out.push(`Factura                ${number}      (${pad(R.int(1, 999), 3)}-${pad(R.int(1, 999999), 6)})`);
  out.push('Factura de entrega');
  out.push(col(customer.name, '', `N.cliente:  ${R.int(10, 99)} ${pad(R.int(1, 9999999), 7)} ${R.int(0, 9)}`));
  out.push(col(customer.addr.street, '', `N.I.F.:  ${customer.taxId}`));
  out.push(customer.addr.line2);
  out.push('-'.repeat(W));
  out.push(`${'MM Num. articulo'.padEnd(DESC_X + 2)}${'Descrip. articulo'.padEnd(NUM_X - DESC_X - 2)}${['Cont', ' Prec. Ud.', '  Cont P.', '   Precio', ' Cant.', '   Importe', ' Imp'].join(' ')}`);
  out.push('-'.repeat(W));
  const pedido = `${R.int(1, 9)}-${pad(R.int(1, 999999999), 9)}`;
  out.push(`*** Numero de pedido ${pedido}`);
  out.push(`Entregado a:  ${stripAccents(customer.name).toUpperCase()},  ${stripAccents(customer.addr.street).toUpperCase()},  ES *** Fecha: ${fmtDate(date, 'dmy')}`);
  for (const l of lines) {
    const descRow = `${l.artCode.padEnd(DESC_X)}${l.desc}`;
    if (l.oneRow) out.push(`${descRow.padEnd(NUM_X)}${amounts(l)}`);
    else {
      out.push(descRow);
      out.push(`${' '.repeat(NUM_X)}${amounts(l)}`);
    }
    if (l.trace) {
      const gtin = l.artCode.length === 14 ? l.artCode : `0${makeEan(R)}`;
      out.push(`${' '.repeat(DESC_X)}Lote: ${l.lot}`);
      out.push(`${' '.repeat(DESC_X)}GTIN:  ${gtin}  Lote: ${l.lot}`);
      if (R.chance(0.5)) out.push(`${' '.repeat(DESC_X)}Origen: ${R.pick(['España', 'Portugal', 'Francia', 'Marruecos', 'Perú'])}`);
      out.push(`${' '.repeat(DESC_X)}GTIN: ${gtin.slice(1)} Qty: 1 LOT: ${l.lot}`);
    }
  }
  out.push(`*** Fin de numero de pedido ${pedido}`);
  out.push('-'.repeat(W));
  const weight = rnd(lines.reduce((a, l) => a + (l.kg ? l.cp * l.cant : R.float(0.2, 6)), 0), 3);
  out.push(right(`Numero de bultos: ${lines.reduce((a, l) => a + l.cant, 0)}     Peso Total: ${f(weight, 3)} KG     Envases: 0`, `Importe   ${f(subtotal, 2).padStart(10)}`));
  out.push('');
  if (summary) {
    out.push(right('', `${'Tipo'.padStart(6)}  ${'Base imponible'.padStart(14)}  ${'% IVA'.padStart(6)}  ${'Cuota IVA'.padStart(10)}`));
    for (const b of breakdown) out.push(right('', `${vatCodes[b.rate].padStart(6)}  ${f(b.base, 2).padStart(14)}  ${f(b.rate, 2).padStart(6)}  ${f(b.vat, 2).padStart(10)}`));
    out.push('');
    out.push(right('', `Base imponible  ${f(subtotal, 2).padStart(10)}`));
    out.push(right('', `Total IVA  ${f(vatTotal, 2).padStart(10)}`));
    out.push(right('', `Total factura  ${f(total, 2).padStart(10)}`));
  } else out.push(right('', `Total pagina   ${f(subtotal, 2).padStart(10)}`));
  const css = `body { font-family: ${R.pick(MONO)}; font-size: ${(opts.fontScale ? fontSize * opts.fontScale : fontSize).toFixed(2)}px; } pre { margin: 0; font: inherit; line-height: ${R.pick([1.25, 1.35, 1.45])}; white-space: pre; } .logo { font: 800 26px Arial, sans-serif; margin: 0 0 6px 40%; }`;
  const logo = R.chance(0.6) ? `<div class="logo">${esc(supplier.name.split(' ')[0].toLowerCase())}</div>` : '';
  const html = htmlDoc(`Factura ${number}`, css, `${logo}<pre>${esc(out.join('\n'))}</pre>`);
  const page = { format: 'A4', landscape: false, margin: `${R.int(8, 12)}mm` };
  const expected = {
    id: `rnd-${seed}`,
    seed,
    generator: GENERATOR_VERSION,
    template: 'cashcarry',
    supplierKind: 'cash',
    features: ['cashcarry', summary ? 'resumen-iva' : 'total-pagina', ...(lines.some((l) => l.trace) ? ['trazabilidad'] : []), ...(lines.some((l) => l.oneRow) ? ['una-fila'] : []), ...(lines.some((l) => l.cpDec === 0 && l.cp > 1) ? ['caja-n-unidades'] : [])],
    page,
    header: { supplierName: supplier.name, supplierTaxId: supplier.taxId, number, date: date.iso, subtotal, vatTotal: summary ? vatTotal : undefined, total: summary ? total : undefined },
    lines: lines.map((l) => ({
      description: l.desc,
      code: l.artCode,
      quantity: l.kg ? rnd(l.cp * l.cant, 3) : l.cant,
      unit: CASH_UNIT_CODES[l.code],
      unitShown: true,
      unitPrice: l.kg ? l.pu : l.pr,
      total: l.total,
      vatPct: l.vat,
    })),
    extras: [],
  };
  return { id: expected.id, seed, template: 'cashcarry', html, page, expected };
}

// ───────────────────────────── Documento completo ─────────────────────────────

/**
 * Genera la factura de una semilla. `opts.capacityScale` (< 1) reduce las filas por página si al renderizar alguna
 * página se desborda (lo decide el renderizador).
 */
export function generateInvoice(seed, opts = {}) {
  if (isCashSeed(seed)) return cashCarryInvoice(seed, opts);
  const R = makeRng(seed);
  const kind = R.weighted(SUPPLIER_KINDS.map((k) => [k.w, k]));
  const template = R.weighted([
    [kind.id === 'cash' ? 3 : 0.6, 'ticket'],
    [1.3, 'erp'],
    [kind.id === 'panaderia' ? 3 : 1, 'albaran'],
    [6.4, 'table'],
  ]);
  const supplier = makeSupplier(R, kind);
  const customer = makeCustomer(R);
  const date = makeDate(R);
  const number = makeNumber(R, date, template === 'ticket' ? 'ticket' : template === 'albaran' ? 'albaran' : 'invoice');
  const caseStyle = template === 'ticket' ? 'upper' : R.weighted([
    [6, 'upper'],
    [1.5, 'noaccents'],
    [1.5, 'title'],
    [1, 'sentence'],
  ]);
  const nf = makeNumberFormat(R);
  const style = {
    caseStyle,
    font: R.chance(0.72) ? R.pick(SANS) : R.pick(SERIF),
    monoFont: R.pick(MONO),
    fontSize: Number(
      R.weighted([
        [1, R.float(7, 8)],
        [4, R.float(8, 10)],
        [3, R.float(10, 11)],
        [1.2, R.float(11, 12)],
      ]).toFixed(1),
    ),
    accent: R.pick(ACCENTS),
    landscape: false,
    marginMm: R.int(8, 15),
    dateStyle: R.weighted([
      [6, 'dmy'],
      [1.5, 'dmy-'],
      [1, 'dmy.'],
      [0.8, 'd/m/y'],
      [0.6, 'dmyy'],
      [0.7, 'long'],
      [0.4, 'mon'],
    ]),
    headerMode: R.weighted([
      [3, 'supplierLeft'],
      [1.5, 'customerLeft'],
      [1.2, 'centered'],
      [1.3, 'grid'],
      [1.2, 'band'],
      [1, 'inline'],
      [0.9, 'labeled'],
    ]),
    vAlign: R.chance(0.6) ? 'top' : 'middle',
    wrapDesc: R.chance(0.18),
    longDesc: 0,
    subRows: R.chance(0.14),
    sections: R.chance(0.07),
    noHeader: R.chance(0.07),
    explicitPages: R.chance(0.6),
    zebra: R.chance(0.3),
    grid: R.chance(0.25),
    headStyle: R.chance(0.5) ? 'fill' : 'line',
    logo: R.chance(0.25),
  };
  if (opts.fontScale) style.fontSize = Number((style.fontSize * opts.fontScale).toFixed(2));
  if (style.wrapDesc) style.longDesc = 0.7;
  else if (R.chance(0.2)) style.longDesc = 0.25;
  if (template === 'erp') style.fontSize = Number(R.float(7.5, 10.5).toFixed(1));

  const n = template === 'ticket' ? R.int(4, 16) : R.weighted([
    [1, R.int(2, 5)],
    [5, R.int(6, 14)],
    [2.5, R.int(15, 24)],
    [1.5, R.int(25, 42)],
  ]);
  const products = pickProducts(R, kind, n);
  const cfg = template === 'ticket' ? { cols: [], labels: {}, discounts: 0, bottles: 'perCase', qtyLabelKind: 'qty' } : chooseColumns(R, kind, products, template);
  if (cfg.cols.length >= 11 || (cfg.cols.length >= 9 && style.fontSize > 10.5) || R.chance(0.08)) style.landscape = template !== 'erp' || cfg.cols.length >= 10;
  const rectificativa = template === 'table' && R.chance(0.04);
  const lines = makeLines(
    R,
    products,
    {
      priceDec: template === 'ticket' ? 2 : nf.priceDec,
      qtyDecKg: template === 'ticket' ? 3 : nf.qtyDecKg,
      qtyDecUd: template === 'ticket' ? 0 : nf.qtyDecUd,
      discounts: cfg.discounts,
      discStyle: cfg.discStyle,
      uc: cfg.cols.includes('uc'),
      discountRate: R.float(0.15, 0.6),
      bottles: cfg.bottles,
      negativeAll: rectificativa,
      returnLine: !rectificativa && template !== 'ticket' && R.chance(0.07),
    },
    style,
  );
  // Datos auxiliares de cada línea (códigos, lotes, unidades impresas, sublíneas)
  const codeStyle = R.weighted([
    [3, 'num'],
    [1.5, 'alpha'],
    [1, 'dash'],
  ]);
  const codeLen = R.int(4, 7);
  const unitPrint = {};
  for (const [u, list] of Object.entries(UNIT_PRINT)) unitPrint[u] = R.pick(list);
  const glue = !cfg.cols.includes('unit') && R.chance(0.12);
  for (const l of lines) {
    l.code =
      codeStyle === 'num'
        ? String(R.int(10 ** (codeLen - 1), 10 ** codeLen - 1))
        : codeStyle === 'alpha'
          ? `${R.pick(['A', 'B', 'CG', 'RF', 'P', 'V', 'FR', 'CA'])}${R.int(100, 9999)}`
          : `${R.int(10, 99)}-${R.int(100, 9999)}`;
    l.ean = makeEan(R);
    l.lot = makeLot(R, date);
    l.cad = makeExpiry(R, date);
    l.origin = R.pick(['España', 'ES', 'Francia', 'Portugal', 'Marruecos', 'Holanda']);
    l.unitLabel = unitPrint[l.unit] ?? l.unit.toUpperCase();
    if (glue && (l.unit === 'kg' || R.chance(0.3))) l.glueUnit = unitPrint[l.unit];
    if (l.unit === 'kg' && cfg.cols.includes('uds') && R.chance(0.1)) l.weight = undefined;
    if (style.subRows) {
      if (l.prod.sci) l.sub = `${l.prod.sci} · ${R.pick(['Zona FAO 27', 'FAO 27.VIII.c', 'Zona FAO 34.1.1', 'Acuicultura · España', 'FAO 37.1.1'])} · ${R.pick(['Arrastre', 'Anzuelo', 'Enmalle', 'Nasas', 'Criado en estero'])}`;
      else if (l.prod.fam === 'car') l.sub = `Nacido en: España · Sacrificado en: ES ${R.int(10, 50)}.${R.int(1000, 9999)}/${R.pick(['M', 'V', 'SE', 'B'])} · Lote: ${l.lot}`;
      else l.sub = `Lote: ${l.lot}   Cad.: ${l.cad}${R.chance(0.3) ? '   Origen: España' : ''}`;
    }
  }
  const extras = template === 'ticket' ? [] : makeExtras(R, kind, style);
  for (const e of extras) {
    e.code = String(R.int(90000, 99999));
    e.unitLabel = unitPrint.ud;
  }
  if (style.sections) lines.sort((a, b) => a.prod.fam.localeCompare(b.prod.fam));
  const globalDiscountPct = template !== 'ticket' && R.chance(0.08) ? R.pick([1, 2, 3, 5]) : 0;
  const totals = computeTotals(lines, extras, globalDiscountPct);
  const extrasSum = rnd(extras.reduce((s, e) => s + e.total, 0), 2);
  const taxInFooter = template === 'table' && R.chance(0.12);
  const ctx = { R, kind, template, supplier, customer, date, number, lines, extras, nf, style, cfg, totals, extrasSum, taxInFooter, rectificativa, capacityScale: opts.capacityScale ?? 1, pageCount: 1 };
  let html;
  if (template === 'ticket') html = ticketTemplate(R, ctx);
  else if (template === 'erp') html = erpTemplate(R, ctx);
  else html = tableTemplate(R, ctx);

  const unitShown = template === 'ticket' ? (l) => l.unit === 'kg' : (l) => cfg.cols.includes('unit') || !!l.glueUnit || (l.unit === 'kg' && cfg.qtyLabelKind === 'qtyKg');
  const expected = {
    id: `rnd-${seed}`,
    seed,
    generator: GENERATOR_VERSION,
    template,
    supplierKind: kind.id,
    features: [
      template,
      `cabecera:${style.headerMode}`,
      ...(template === 'ticket' ? [] : [`columnas:${cfg.cols.join('|')}`]),
      ...(style.noHeader && template !== 'ticket' ? ['sin-cabecera-tabla'] : []),
      ...(style.wrapDesc && template === 'table' ? ['descripcion-2-filas'] : []),
      ...(style.subRows && template === 'table' ? ['sublineas'] : []),
      ...(style.sections && template === 'table' ? ['secciones'] : []),
      ...(ctx.pageCount > 1 ? ['varias-paginas'] : []),
      ...(extras.length ? ['portes-envases'] : []),
      ...(rectificativa ? ['rectificativa'] : lines.some((l) => l.qty < 0) ? ['abono-linea'] : []),
      ...(globalDiscountPct ? ['pronto-pago'] : []),
      ...(style.landscape ? ['apaisada'] : []),
      `letra:${style.fontSize < 8.5 ? 'pequena' : style.fontSize > 10.5 ? 'grande' : 'media'}`,
      `precio:${nf.priceDec}dec`,
    ],
    page: template === 'ticket' ? { width: '80mm', autoHeight: true } : { format: 'A4', landscape: style.landscape, margin: `${style.marginMm}mm` },
    header: {
      supplierName: supplier.name,
      supplierTaxId: supplier.taxId,
      number,
      date: date.iso,
      subtotal: totals.subtotal,
      vatTotal: totals.vatTotal,
      total: totals.total,
    },
    lines: lines.map((l) => {
      const out = { description: l.printedDesc ?? l.desc };
      if (l.code && (template === 'ticket' ? l.codePrinted : cfg.cols.includes('code'))) out.code = l.code;
      out.quantity = l.qty;
      out.unit = UNIT_CANON[l.unit] ?? l.unit;
      out.unitShown = unitShown(l);
      out.unitPrice = l.price;
      const d = combinedDiscount(l);
      if (d !== undefined) out.discountPct = d;
      out.total = l.total;
      out.vatPct = l.vat;
      return out;
    }),
    extras: extras.map((e) => ({ description: e.desc, amount: e.total })),
  };
  return { id: expected.id, seed, template, html, page: expected.page, expected };
}

// ───────────────────────────── Renderizado a PDF ─────────────────────────────

/** Renderiza la factura a PDF con Chromium (page.pdf). Si una página fija se desborda, regenera con menos filas. */
export async function renderInvoicePdf(browser, seed, variant = {}) {
  let scale = variant.capacityScale ?? 1;
  let fontScale = variant.fontScale ?? 1;
  for (let attempt = 0; attempt < 10; attempt++) {
    const doc = generateInvoice(seed, { capacityScale: scale, fontScale });
    // Se mide con el ancho imprimible real (el alto de las páginas fijas depende de cómo se partan las filas)
    const pg = doc.page;
    const mm = pg.autoHeight ? 80 : (pg.landscape ? 297 : 210) - 2 * parseFloat(pg.margin);
    const page = await browser.newPage({ viewport: { width: Math.floor((mm * 96) / 25.4), height: 1000 } });
    try {
      await page.setContent(doc.html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: 'print' });
      const m = await page.evaluate(() => ({
        pages: [...document.querySelectorAll('.page.fixed')].some((el) => el.scrollHeight > el.clientHeight + 1),
        wide: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      if (m.wide) {
        fontScale *= 0.9;
        continue;
      }
      if (m.pages) {
        scale *= 0.82;
        continue;
      }
      const opts = { printBackground: true };
      if (doc.page.autoHeight) {
        const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
        Object.assign(opts, { width: doc.page.width, height: `${h + 4}px`, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      } else {
        const m = doc.page.margin;
        Object.assign(opts, { format: doc.page.format, landscape: !!doc.page.landscape, margin: { top: m, right: m, bottom: m, left: m } });
      }
      const pdf = await page.pdf(opts);
      return { doc, pdf };
    } finally {
      await page.close();
    }
  }
  throw new Error(`La semilla ${seed} no cabe en sus páginas`);
}

export function parseSeeds(spec) {
  const out = [];
  for (const part of String(spec).split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let s = a; s <= b; s++) out.push(s);
  }
  return out;
}

// ───────────────────────────── CLI ─────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
      return m ? [m[1], m[2] ?? true] : [a, true];
    }),
  );
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
  const seeds = parseSeeds(args.seeds ?? '1-10');
  const out = resolve(String(args.out ?? DEFAULT_OUT));
  mkdirSync(out, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const seed of seeds) {
      const { doc, pdf } = await renderInvoicePdf(browser, seed);
      writeFileSync(join(out, `${seed}.pdf`), pdf);
      writeFileSync(join(out, `${seed}.json`), `${JSON.stringify(doc.expected, null, 2)}\n`);
      if (args.html) writeFileSync(join(out, `${seed}.html`), doc.html);
      console.log(`semilla ${seed}: ${doc.template}, ${doc.expected.lines.length} líneas, ${(pdf.length / 1024).toFixed(0)} KB`);
    }
  } finally {
    await browser.close();
  }
}
