import { describe, expect, it } from 'vitest';
import type { GrayImage } from './imageOps';
import { ocrPagesToResult } from './ocrLayout';
import {
  convexHull,
  ctcDecode,
  dbBoxes,
  detInput,
  findDash,
  inkSpan,
  inkThreshold,
  lineFromCtc,
  markSuperscripts,
  minAreaRect,
  paddleRecognize,
  parseCharDict,
  quadSize,
  recBatchInput,
  REC_HEIGHT,
  rectCorners,
  splitAfterPunctuation,
  splitByGaps,
  splitComponentLines,
  splitSuperscript,
  stripLeaders,
  toSuperscript,
  unclipRect,
  type CtcChar,
  type PaddleRunner,
  type TextQuad,
} from './paddleOcr';
import type { TessLine } from './ocrLayout';

// ───────────────────────────── Utilidades de prueba ─────────────────────────────

/** Renglón muestreado (alto 48) en blanco con manchas de tinta [u0, u1) × [v0, v1). */
function crop(width: number, blobs: [number, number, number, number][]): Float32Array {
  const g = new Float32Array(width * REC_HEIGHT).fill(235);
  for (const [u0, u1, v0, v1] of blobs) for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) g[v * width + u] = 30;
  return g;
}

/** Caja horizontal de x0..x1 × y0..y1. */
function quad(x0: number, y0: number, x1: number, y1: number): TextQuad {
  return { tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 }, br: { x: x1, y: y1 }, bl: { x: x0, y: y1 }, score: 0.9 };
}

/** Caracteres de la CTC: [carácter, instante inicial, instante final]. */
function chars(list: [string, number, number?][]): CtcChar[] {
  return list.map(([char, start, end]) => ({ char, start, end: end ?? start, prob: 0.95 }));
}

// ───────────────────────────── Diccionario ─────────────────────────────

describe('diccionario del reconocedor', () => {
  it('lee la lista character_dict del inference.yml (comillas simples, comilla escapada) y se detiene en la clave siguiente', () => {
    const yml = ["PostProcess:", "  name: CTCLabelDecode", "  character_dict:", "  - '0'", "  - ''''", '  - a', '  - ñ', '  - €', "  - ' '", 'Global:', '  model_name: x'].join('\n');
    expect(parseCharDict(yml)).toEqual(['0', "'", 'a', 'ñ', '€', ' ']);
  });

  it('admite también un diccionario de texto (un carácter por línea)', () => {
    expect(parseCharDict('a\nb\nñ\n€\n')).toEqual(['a', 'b', 'ñ', '€']);
  });
});

// ───────────────────────────── Detección ─────────────────────────────

describe('entrada de la red de detección', () => {
  it('lados múltiplos de 32, reducción al lado máximo y normalización BGR de ImageNet', () => {
    const img: GrayImage = { width: 100, height: 50, data: new Uint8ClampedArray(100 * 50).fill(255) };
    img.data[0] = 0;
    const d = detInput(img, 64);
    expect(d.width).toBe(64);
    expect(d.height).toBe(32);
    expect(d.data).toHaveLength(3 * 64 * 32);
    // Blanco → (1 − media) / desviación en cada canal
    expect(d.data[64 * 32 - 1]).toBeCloseTo((1 - 0.485) / 0.229, 3);
    expect(d.data[2 * 64 * 32 + 64 * 32 - 1]).toBeCloseTo((1 - 0.406) / 0.225, 3);
    expect(d.scaleX).toBeCloseTo(100 / 64, 6);
    expect(d.scaleY).toBeCloseTo(50 / 32, 6);
  });
});

describe('geometría de las cajas', () => {
  it('envolvente convexa sin puntos interiores', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(hull).toHaveLength(4);
  });

  it('rectángulo mínimo girado con el eje de lectura horizontal, también en cajas más altas que anchas', () => {
    const a = (10 * Math.PI) / 180;
    const pts = [];
    for (let i = 0; i <= 40; i++) for (const j of [0, 8]) pts.push({ x: 50 + i * Math.cos(a) - j * Math.sin(a), y: 20 + i * Math.sin(a) + j * Math.cos(a) });
    const r = minAreaRect(pts);
    expect(r?.width).toBeCloseTo(40, 1);
    expect(r?.height).toBeCloseTo(8, 1);
    expect(r?.ux).toBeCloseTo(Math.cos(a), 3);
    expect(r?.uy).toBeCloseTo(Math.sin(a), 3);
    // Un precio de una cifra («9») es más alto que ancho: se sigue leyendo en horizontal
    const tall = minAreaRect([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 20 },
      { x: 0, y: 20 },
    ]);
    expect(tall).toMatchObject({ ux: 1, uy: 0, width: 6, height: 20 });
    const [tl, tr, br, bl] = rectCorners(tall!);
    expect([tl, tr, br, bl]).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 20 },
      { x: 0, y: 20 },
    ]);
  });

  it('«unclip» de DB: cada lado crece área · ratio / perímetro', () => {
    const r = unclipRect({ cx: 0, cy: 0, ux: 1, uy: 0, width: 100, height: 10 }, 1.5);
    const d = (100 * 10 * 1.5) / 220;
    expect(r.width).toBeCloseTo(100 + 2 * d, 6);
    expect(r.height).toBeCloseTo(10 + 2 * d, 6);
  });

  it('cajas del mapa de probabilidad: umbral, puntuación mínima, escala y orden de lectura', () => {
    const W = 200;
    const H = 100;
    const prob = new Float32Array(W * H);
    const fill = (x0: number, y0: number, x1: number, y1: number, p: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) prob[y * W + x] = p;
    };
    fill(120, 10, 180, 20, 0.9); // precio a la derecha
    fill(10, 10, 100, 20, 0.9); // nombre del plato
    fill(10, 60, 100, 70, 0.9); // renglón de abajo
    fill(10, 85, 60, 95, 0.35); // mancha débil (supera el umbral, no la puntuación de caja)
    const boxes = dbBoxes(prob, W, H, { scaleX: 2, scaleY: 2 });
    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => Math.round(b.tl.x / 2))).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    // Primero el nombre (izquierda), luego el precio (misma franja) y luego el renglón de abajo
    expect(boxes[0].tl.x).toBeLessThan(boxes[1].tl.x);
    expect(boxes[2].tl.y).toBeGreaterThan(boxes[0].bl.y);
    // Escala ×2 y expansión: la caja del nombre cubre de sobra 10..100 × 10..20 en la imagen original
    const b = boxes[0];
    expect(b.tl.x).toBeLessThan(20);
    expect(b.tr.x).toBeGreaterThan(198);
    expect(b.tl.y).toBeLessThan(20);
    expect(b.bl.y).toBeGreaterThan(38);
    expect(b.score).toBeGreaterThan(0.85);
  });
});

describe('renglones pegados y curvados (foto de página completa)', () => {
  const W = 400;
  /** Píxeles (índices del mapa) de las franjas dadas por su centro en cada columna. */
  const band = (x0: number, x1: number, center: (x: number) => number, half = 2): number[] => {
    const out: number[] = [];
    for (let x = x0; x < x1; x++) {
      const c = Math.round(center(x));
      for (let y = c - half; y <= c + half; y++) out.push(y * W + x);
    }
    return out;
  };

  it('separa dos renglones que la detección une por un puente de tinta', () => {
    const top = band(10, 300, () => 20);
    const bottom = band(10, 300, () => 28);
    // Puentes entre los dos renglones (un trazo descendente y uno ascendente que se tocan)
    const bridge: number[] = [];
    for (const x of [80, 81, 200, 201]) for (let y = 22; y <= 26; y++) bridge.push(y * W + x);
    const pix = Int32Array.from(new Set([...top, ...bottom, ...bridge]));
    const pieces = splitComponentLines(pix, pix.length, W);
    expect(pieces).toBeDefined();
    expect(pieces?.length).toBe(2);
    const rowsOf = (p: { pix: Int32Array }) => [...p.pix].map((i) => Math.floor(i / W));
    const [a, b] = (pieces ?? []).map(rowsOf).sort((u, v) => Math.min(...u) - Math.min(...v));
    expect(Math.max(...a)).toBeLessThanOrEqual(24);
    expect(Math.min(...b)).toBeGreaterThanOrEqual(24);
  });

  it('corta en trozos rectos un renglón largo y combado; un renglón recto no se toca', () => {
    const arc = Int32Array.from(band(0, 390, (x) => 20 + 12 * Math.sin((Math.PI * x) / 390)));
    const pieces = splitComponentLines(arc, arc.length, W);
    expect(pieces?.length).toBeGreaterThanOrEqual(2);
    const straight = Int32Array.from(band(0, 390, () => 20));
    expect(splitComponentLines(straight, straight.length, W)).toBeUndefined();
  });

  it('dbBoxes: dos renglones pegados dan dos cajas (y una sola sin separar renglones)', () => {
    const H = 60;
    const prob = new Float32Array(W * H);
    for (const i of [...band(10, 300, () => 20), ...band(10, 300, () => 28)]) prob[i] = 0.9;
    for (const x of [80, 81, 200, 201]) for (let y = 22; y <= 26; y++) prob[y * W + x] = 0.9;
    expect(dbBoxes(prob, W, H, {}).length).toBe(2);
    expect(dbBoxes(prob, W, H, { splitLines: false }).length).toBe(1);
  });
});

// ───────────────────────────── Reconocimiento ─────────────────────────────

describe('entrada del reconocedor', () => {
  it('lote a alto 48 con la proporción de cada renglón, normalizado a [−1, 1] y relleno con 0', () => {
    const img: GrayImage = { width: 400, height: 100, data: new Uint8ClampedArray(400 * 100).fill(255) };
    const q1 = quad(0, 0, 96, 24); // proporción 4 → 192 columnas
    const q2 = quad(0, 50, 400, 74); // proporción 16,7 → 800 columnas
    const batch = recBatchInput(img, [q1, q2]);
    expect(batch.batch).toBe(2);
    expect(batch.width).toBe(Math.ceil(48 * (400 / 24)));
    expect(batch.widths).toEqual([192, batch.width]);
    const plane = 48 * batch.width;
    expect(batch.data[0]).toBeCloseTo(1, 5);
    expect(batch.data[191]).toBeCloseTo(1, 5);
    expect(batch.data[192]).toBe(0);
    expect(batch.data[3 * plane + 799]).toBeCloseTo(1, 5);
    expect(batch.crops[0]).toHaveLength(192 * 48);
  });
});

describe('decodificación CTC', () => {
  it('quita repeticiones consecutivas y el blanco; la clase de más es el espacio', () => {
    const dict = ['a', 'b'];
    const C = 4; // blanco, a, b, espacio
    const seq = [1, 1, 0, 1, 2, 3, 3, 2, 0];
    const probs = new Float32Array(seq.length * C);
    seq.forEach((c, t) => {
      probs[t * C + c] = 0.9;
    });
    const out = ctcDecode(probs, 0, seq.length, C, dict);
    expect(out.map((c) => c.char).join('')).toBe('aab b');
    expect(out[0]).toMatchObject({ start: 0, end: 1 });
    expect(out[3]).toMatchObject({ char: ' ', start: 5, end: 6 });
  });

  it('recupera el espacio que la red ha visto pero no ha elegido («Ensaladade» → «Ensalada de»)', () => {
    const dict = ['a', 'b'];
    const C = 4;
    // a · (blanco con 35 % de espacio) · b
    const rows = [
      [0, 0.9, 0, 0],
      [0.6, 0, 0, 0.35],
      [0, 0, 0.9, 0],
    ];
    const probs = Float32Array.from(rows.flat());
    expect(ctcDecode(probs, 0, 3, C, dict).map((c) => c.char).join('')).toBe('ab');
    expect(ctcDecode(probs, 0, 3, C, dict, 0.3).map((c) => c.char).join('')).toBe('a b');
    expect(ctcDecode(probs, 0, 3, C, dict, 0.5).map((c) => c.char).join('')).toBe('ab');
  });
});

describe('palabras con su caja', () => {
  it('limpia los rellenos de puntos pegados a las palabras y a los precios', () => {
    const groups = [chars([['b', 0], ['a', 1], ['c', 2], ['.', 3], ['.', 4]]), chars([['.', 6], ['.', 7]]), chars([['.', 9], ['4', 10], [',', 11], ['5', 12]])];
    expect(stripLeaders(groups).map((g) => g.map((c) => c.char).join(''))).toEqual(['bac', '4,5']);
    // Un punto suelto delante de una cifra sin relleno delante se conserva
    expect(stripLeaders([chars([['.', 0], ['5', 1]])]).map((g) => g.map((c) => c.char).join(''))).toEqual(['.5']);
  });

  it('ajusta la caja a la tinta: la cursiva pequeña de la descripción queda más baja que el nombre', () => {
    const g = crop(200, [
      [10, 60, 8, 40], // «Pulpo» (letra grande)
      [100, 150, 18, 36], // «con» (letra pequeña)
    ]);
    const thr = inkThreshold(g) as number;
    expect(thr).toBeGreaterThan(30);
    expect(thr).toBeLessThan(235);
    expect(inkSpan(g, 200, 48, thr, 20, 55, 0, 90)).toEqual({ u0: 10, u1: 60, v0: 8, v1: 40 });
    expect(inkSpan(g, 200, 48, thr, 105, 140, 70, 200)).toEqual({ u0: 100, u1: 150, v0: 18, v1: 36 });
    expect(inkThreshold(new Float32Array(100).fill(200))).toBeUndefined();
  });

  it('parte una palabra por un hueco claramente mayor que los demás («Cafésolo»), pero no el texto espaciado', () => {
    // 8 letras de 8 columnas separadas 2; entre la 4.ª y la 5.ª, hueco de 14
    const blobs: [number, number, number, number][] = [];
    let u = 4;
    const glyphs: CtcChar[] = [];
    for (let i = 0; i < 8; i++) {
      blobs.push([u, u + 8, 10, 38]);
      glyphs.push({ char: 'abcdefgh'[i], start: Math.round((u + 4) / 8), end: Math.round((u + 4) / 8), prob: 0.9 });
      u += i === 3 ? 22 : 10;
    }
    const g = crop(120, blobs);
    const thr = inkThreshold(g) as number;
    const parts = splitByGaps(glyphs, g, 120, thr, 10, 38, 8);
    expect(parts.map((p) => p.map((c) => c.char).join(''))).toEqual(['abcd', 'efgh']);
    // Letras espaciadas por igual («C A R N E S»): no se parte
    const even: [number, number, number, number][] = [];
    const evenChars: CtcChar[] = [];
    for (let i = 0; i < 6; i++) {
      even.push([4 + i * 18, 12 + i * 18, 10, 38]);
      evenChars.push({ char: 'CARNES'[i], start: Math.round((8 + i * 18) / 8), end: Math.round((8 + i * 18) / 8), prob: 0.9 });
    }
    const g2 = crop(120, even);
    expect(splitByGaps(evenChars, g2, 120, inkThreshold(g2) as number, 10, 38, 8)).toHaveLength(1);
  });

  it('encuentra la raya fina a media altura entre dos palabras (y no los puntos de relleno)', () => {
    const g = crop(120, [
      [40, 56, 24, 27], // raya
      [80, 83, 34, 37], // punto de relleno en la línea base
      [90, 93, 34, 37],
    ]);
    const thr = inkThreshold(g) as number;
    expect(findDash(g, 120, thr, 30, 70, 10, 38)).toEqual({ u0: 40, u1: 56, v0: 24, v1: 27 });
    expect(findDash(g, 120, thr, 70, 110, 10, 38)).toBeUndefined();
  });

  it('renglón al estilo Tesseract: palabras con caja ajustada, raya recuperada y línea base', () => {
    // Renglón de 400 × 48 muestreado de una caja de la imagen de 800 × 96 (factor 2)
    const W = 400;
    const g = crop(W, [
      [8, 40, 10, 38], // «Sopa»
      [60, 72, 22, 25], // raya «–»
      [92, 120, 18, 36], // «con»
      [300, 350, 12, 38], // «18,50»
    ]);
    const cs = chars([
      ['S', 1],
      ['o', 2],
      ['p', 3],
      ['a', 4],
      [' ', 6],
      ['c', 12],
      ['o', 13],
      ['n', 14],
      [' ', 20],
      ['1', 38],
      ['8', 39],
      [',', 40],
      ['5', 41],
      ['0', 42],
    ]);
    const q = quad(100, 200, 900, 296);
    const line = lineFromCtc(q, cs, W, W, 50, g);
    expect(line?.words.map((w) => w.text)).toEqual(['Sopa', '–', 'con', '18,50']);
    const [sopa, dash, con, price] = line!.words;
    // Coordenadas de la imagen: x = 100 + 2·u, y = 200 + 2·v
    expect(sopa.bbox).toEqual({ x0: 116, y0: 220, x1: 180, y1: 276 });
    expect(dash.bbox).toEqual({ x0: 220, y0: 244, x1: 244, y1: 250 });
    expect(con.bbox).toEqual({ x0: 284, y0: 236, x1: 340, y1: 272 });
    expect(price.bbox).toEqual({ x0: 700, y0: 224, x1: 800, y1: 276 });
    expect(line?.baseline?.y0).toBe(276);
    expect(line?.text).toBe('Sopa – con 18,50');
  });
});

describe('signos, volados y adornos', () => {
  const text = (groups: CtcChar[][]) => groups.map((g) => g.map((c) => c.char).join(''));

  it('separa lo que va pegado detrás de un signo, sin tocar los decimales', () => {
    const seq = (t: string) => chars([...t].map((c, i) => [c, i] as [string, number]));
    expect(text(splitAfterPunctuation([seq('2.Mejillones'), seq('adobo.Producto'), seq('12,50'), seq('(6'), seq('uds.)'), seq('D.O.Ca.Rioja'), seq('D.O.')]))).toEqual([
      '2.',
      'Mejillones',
      'adobo.',
      'Producto',
      '12,50',
      '(6',
      'uds.)',
      'D.O.Ca.',
      'Rioja',
      'D.O.',
    ]);
  });

  it('aparta las cifras voladas pegadas a una palabra («wasabi³⁴»)', () => {
    // «wasabi» de 10..70 × 12..38 y «34» volado en 76..90 × 8..22
    const g = crop(120, [
      [10, 70, 12, 38],
      [76, 90, 8, 22],
    ]);
    const cs = chars([
      ['w', 2],
      ['a', 3],
      ['s', 4],
      ['a', 5],
      ['b', 6],
      ['i', 8],
      ['3', 10],
      ['4', 11],
    ]);
    expect(text(splitSuperscript(cs, g, 120, inkThreshold(g) as number, 8, 0, 120))).toEqual(['wasabi', '34']);
    // Cifras a la altura del texto (un precio pegado): no son voladas
    const g2 = crop(120, [
      [10, 70, 12, 38],
      [76, 100, 12, 38],
    ]);
    expect(splitSuperscript(cs, g2, 120, inkThreshold(g2) as number, 8, 0, 120)).toHaveLength(1);
  });

  it('parte un precio o un icono pegados tras un hueco claro («pibil12,00», «2020•»)', () => {
    // 5 letras juntas (hueco 2) y, tras un hueco de 12, «12,00»
    const blobs: [number, number, number, number][] = [];
    const cs: CtcChar[] = [];
    let u = 4;
    for (const [i, ch] of [...'pibil12,00'].entries()) {
      blobs.push([u, u + 7, 10, 38]);
      cs.push({ char: ch, start: Math.round((u + 3) / 8), end: Math.round((u + 3) / 8), prob: 0.9 });
      u += i === 4 ? 21 : 9;
    }
    const g = crop(140, blobs);
    expect(text(splitByGaps(cs, g, 140, inkThreshold(g) as number, 10, 38, 8))).toEqual(['pibil', '12,00']);
    const g3 = crop(80, [
      [4, 40, 10, 38],
      [52, 60, 20, 28],
    ]);
    const cs3 = chars([
      ['2', 0],
      ['0', 1],
      ['2', 3],
      ['0', 4],
      ['•', 7],
    ]);
    expect(text(splitByGaps(cs3, g3, 80, inkThreshold(g3) as number, 10, 38, 8))).toEqual(['2020', '•']);
  });

  it('marca como superíndices los números volados de alérgenos, en su renglón o en uno aparte', () => {
    const line = (words: [string, number, number, number, number][], base: number): TessLine => ({
      text: words.map((w) => w[0]).join(' '),
      bbox: { x0: words[0][1], y0: Math.min(...words.map((w) => w[2])), x1: words[words.length - 1][3], y1: base },
      baseline: { x0: words[0][1], y0: base, x1: words[words.length - 1][3], y1: base },
      words: words.map(([t, x0, y0, x1, y1]) => ({ text: t, confidence: 95, bbox: { x0, y0, x1, y1 } })),
    });
    const lines = [
      line(
        [
          ['Tabla', 100, 70, 180, 100],
          ['ibérica', 190, 70, 300, 100],
          ['4,10', 310, 68, 350, 84],
        ],
        100,
      ),
      line(
        [
          ['Gambas', 100, 170, 200, 200],
          ['en', 210, 180, 240, 200],
        ],
        200,
      ),
      line([['1,4', 250, 166, 280, 182]], 182),
      line(
        [
          ['Pulpo', 100, 270, 180, 300],
          ['18', 600, 272, 630, 300],
        ],
        300,
      ),
    ];
    const out = markSuperscripts(lines);
    expect(out[0].words.map((w) => w.text)).toEqual(['Tabla', 'ibérica', '⁴ ¹⁰']);
    expect(out[2].words[0].text).toBe('¹ ⁴');
    // El precio a la altura del texto no se toca
    expect(out[3].words[1].text).toBe('18');
    expect(toSuperscript('14712')).toBe('¹⁴⁷¹²');
  });
});

// ───────────────────────────── Canal completo ─────────────────────────────

describe('lectura completa con redes simuladas', () => {
  it('detección → cajas → reconocimiento → TessPage que entiende la reconstrucción de filas', async () => {
    const img: GrayImage = { width: 320, height: 64, data: new Uint8ClampedArray(320 * 64).fill(240) };
    // «ab» en tinta en 20..60 × 20..40 y «9» en 250..262 × 20..40
    for (let y = 20; y < 40; y++) {
      for (let x = 20; x < 60; x++) img.data[y * 320 + x] = 20;
      for (let x = 250; x < 262; x++) img.data[y * 320 + x] = 20;
    }
    const dict = ['a', 'b', '9'];
    const runner: PaddleRunner = {
      async detect(_input, h, w) {
        const p = new Float32Array(h * w);
        for (let y = 23; y < 37; y++) {
          for (let x = 23; x < 57; x++) p[y * w + x] = 0.95;
          for (let x = 252; x < 260; x++) p[y * w + x] = 0.95;
        }
        return { data: p, dims: [1, 1, h, w] };
      },
      async recognize(input, n, h, w) {
        expect(h).toBe(48);
        expect(input).toHaveLength(n * 3 * 48 * w);
        const T = Math.floor(w / 8);
        const C = dict.length + 2;
        const out = new Float32Array(n * T * C);
        for (let i = 0; i < n; i++) {
          // Renglón ancho = «ab»; estrecho = «9» (el lote va ordenado por proporción)
          const wide = i === n - 1;
          for (let t = 0; t < T; t++) {
            const cls = wide ? (t === 2 ? 1 : t === 5 ? 2 : 0) : t === 1 ? 3 : 0;
            out[(i * T + t) * C + cls] = 0.9;
          }
        }
        return { data: out, dims: [n, T, C] };
      },
    };
    const fractions: number[] = [];
    const timings = { detMs: 0, recMs: 0, boxes: 0 };
    const page = await paddleRecognize(img, runner, dict, {}, (f) => fractions.push(f), timings);
    expect(timings.boxes).toBe(2);
    expect(fractions[fractions.length - 1]).toBe(1);
    const lines = page.blocks?.[0].paragraphs[0].lines ?? [];
    expect(lines.map((l) => l.text)).toEqual(['ab', '9']);
    expect(page.confidence).toBeCloseTo(90, 0);
    const ab = lines[0].words[0].bbox;
    expect(ab.x0).toBeGreaterThanOrEqual(16);
    expect(ab.x1).toBeLessThanOrEqual(64);
    expect(ab.y0).toBeGreaterThanOrEqual(16);
    expect(ab.y1).toBeLessThanOrEqual(44);
    const res = ocrPagesToResult([{ page }], 'columns');
    expect(res.text).toMatch(/^ab {2,}9$/);
    expect(quadSize(quad(0, 0, 30, 10))).toEqual({ width: 30, height: 10 });
  });
});
