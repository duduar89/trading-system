/**
 * Diseño procedural de cartas (HTML + CSS) a partir de una semilla: 1–3 columnas, relleno de puntos o no, precio detrás,
 * delante o debajo del nombre, con o sin «€», estilos de decimales (12,50 · 12.5 · 12 · 12€50 · 12,-), cabeceras de
 * sección variadas, descripciones en cursiva o del mismo tamaño, iconos de alérgenos (emoji, SVG con letra o
 * pictogramas, números volados, códigos), tipografías con serifa, de palo, condensadas, manuscritas y de máquina de
 * escribir, fondos de papel, crema, kraft, pizarra, oscuros y «foto», columnas de media ración / ración y copa / botella.
 *
 * La verdad de referencia sale del mismo contenido con que se dibuja (content.mjs), nunca de la extracción.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { columnPrices } from './content.mjs';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/menus/fonts');

/** Tipografías incluidas (OFL) y del sistema. */
const EMBEDDED = {
  Crimson: [['CrimsonPro-Regular.ttf', 400, 'normal'], ['CrimsonPro-Italic.ttf', 400, 'italic'], ['CrimsonPro-Bold.ttf', 700, 'normal']],
  'Libre Baskerville': [['LibreBaskerville-Regular.ttf', 400, 'normal']],
  'Young Serif': [['YoungSerif-Regular.ttf', 400, 'normal']],
  Gloock: [['Gloock-Regular.ttf', 400, 'normal']],
  Italiana: [['Italiana-Regular.ttf', 400, 'normal']],
  'Poiret One': [['PoiretOne-Regular.ttf', 400, 'normal']],
  'Big Shoulders': [['BigShoulders-Bold.ttf', 700, 'normal']],
  'Nothing You Could Do': [['NothingYouCouldDo-Regular.ttf', 400, 'normal']],
  'Work Sans': [['WorkSans-Regular.ttf', 400, 'normal']],
  Outfit: [['Outfit-Regular.ttf', 400, 'normal']],
};
const FONT_POOLS = {
  serif: ['Crimson', 'Libre Baskerville', 'Young Serif', 'Liberation Serif', 'DejaVu Serif', 'FreeSerif', 'Bitstream Charter'],
  sans: ['Work Sans', 'Outfit', 'Liberation Sans', 'DejaVu Sans', 'FreeSans'],
  display: ['Gloock', 'Italiana', 'Poiret One', 'Big Shoulders', 'Young Serif'],
  condensed: ['Big Shoulders'],
  script: ['Nothing You Could Do'],
  mono: ['Courier 10 Pitch', 'Liberation Mono', 'FreeMono'],
};

const fontCache = new Map();
function fontFace(family) {
  if (!EMBEDDED[family]) return '';
  if (fontCache.has(family)) return fontCache.get(family);
  const css = EMBEDDED[family]
    .map(([file, weight, style]) => `@font-face { font-family: '${family}'; src: url(data:font/ttf;base64,${readFileSync(join(FONT_DIR, file)).toString('base64')}) format('truetype'); font-weight: ${weight}; font-style: ${style}; }`)
    .join('\n');
  fontCache.set(family, css);
  return css;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ───────────────────────────── Temas ─────────────────────────────

const noise = (opacity, freq = 0.9) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='${opacity}'/></svg>`)}")`;

const THEMES = {
  white: { bg: '#ffffff', image: 'none', ink: '#1d1d1d', muted: '#5f5f5f', accent: ['#1d1d1d', '#8a1c1c', '#1f4e5f', '#6b4f1d'] },
  paper: { bg: '#fbf8f1', image: noise(0.08), ink: '#262322', muted: '#6a625a', accent: ['#2f5d50', '#7a2e1d', '#3b3b6d', '#262322'] },
  cream: { bg: '#f4ead5', image: noise(0.1), ink: '#3a2a1a', muted: '#6e5a45', accent: ['#a61c00', '#5b3a1a', '#2e4a2e', '#3a2a1a'] },
  kraft: { bg: '#d9c2a0', image: noise(0.16, 0.7), ink: '#2d2014', muted: '#4f3b27', accent: ['#2d2014', '#6b1e12', '#1e3a2d'] },
  chalk: { bg: '#2b302d', image: noise(0.18, 0.6), ink: '#f1efe6', muted: '#c9c6ba', accent: ['#f3d36b', '#f1efe6', '#9fd8cf', '#f5a3a3'], dark: true },
  dark: { bg: '#15202b', image: 'none', ink: '#f2ede1', muted: '#b9b3a4', accent: ['#d9b36c', '#f2ede1', '#e39b7b'], dark: true },
  sage: { bg: '#e3eadf', image: noise(0.06), ink: '#1f2d24', muted: '#51604f', accent: ['#1f2d24', '#6b3a2a', '#2a4d69'] },
  photo: { bg: '#f7f3ea', image: noise(0.12, 0.5), ink: '#232120', muted: '#5d5750', accent: ['#232120', '#6d2020', '#1d3d5c'], photo: true },
};

// ───────────────────────────── Alérgenos ─────────────────────────────

const ALLERGENS = ['gluten', 'crustaceos', 'huevo', 'pescado', 'cacahuete', 'soja', 'lacteos', 'frutos', 'apio', 'mostaza', 'sesamo', 'sulfitos', 'altramuz', 'moluscos'];
const EMOJI = { gluten: '🌾', crustaceos: '🦐', huevo: '🥚', pescado: '🐟', cacahuete: '🥜', soja: '🫘', lacteos: '🥛', frutos: '🌰', apio: '🥬', mostaza: '🟡', sesamo: '⚪', sulfitos: '🍷', altramuz: '🟤', moluscos: '🦪' };
const LETTER = { gluten: 'G', crustaceos: 'C', huevo: 'H', pescado: 'P', cacahuete: 'Ca', soja: 'S', lacteos: 'L', frutos: 'F', apio: 'A', mostaza: 'M', sesamo: 'Se', sulfitos: 'Su', altramuz: 'Al', moluscos: 'Mo' };
const COLORS = { gluten: '#c8962c', crustaceos: '#d0573a', huevo: '#e0b33a', pescado: '#2f6fa8', cacahuete: '#9a6b3c', soja: '#6b8e23', lacteos: '#5a8fd0', frutos: '#8b5a2b', apio: '#5aa05a', mostaza: '#c9a800', sesamo: '#b39b6b', sulfitos: '#7b2d5e', altramuz: '#c77d2e', moluscos: '#3a8f9a' };

function pictogram(a, size, color) {
  const shapes = {
    gluten: `<path d="M10 18V5" stroke="${color}" stroke-width="1.6"/><ellipse cx="7.5" cy="8" rx="2" ry="3" fill="${color}"/><ellipse cx="12.5" cy="8" rx="2" ry="3" fill="${color}"/><ellipse cx="7.5" cy="13" rx="2" ry="3" fill="${color}"/><ellipse cx="12.5" cy="13" rx="2" ry="3" fill="${color}"/>`,
    pescado: `<ellipse cx="9" cy="10" rx="6" ry="3.6" fill="${color}"/><path d="M14 10l5-4v8z" fill="${color}"/>`,
    lacteos: `<path d="M10 2C10 2 4 10 4 13a6 6 0 0012 0c0-3-6-11-6-11z" fill="${color}"/>`,
    huevo: `<ellipse cx="10" cy="11" rx="5.5" ry="7" fill="${color}"/>`,
    crustaceos: `<path d="M4 12a6 6 0 0112-4" stroke="${color}" stroke-width="3" fill="none"/><circle cx="15" cy="7" r="2" fill="${color}"/>`,
    frutos: `<circle cx="10" cy="11" r="6" fill="${color}"/><path d="M10 5V2" stroke="${color}" stroke-width="1.6"/>`,
  };
  const inner = shapes[a] ?? `<rect x="3" y="3" width="14" height="14" rx="4" fill="${color}"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">${inner}</svg>`;
}
function letterIcon(a, size, color, outline) {
  const t = LETTER[a];
  const fs = t.length > 1 ? 8.5 : 11;
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" ${outline ? `fill="none" stroke="${color}" stroke-width="1.6"` : `fill="${color}"`}/><text x="10" y="${t.length > 1 ? 13 : 14}" font-size="${fs}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="700" fill="${outline ? color : '#fff'}">${t}</text></svg>`;
}

function allergenMarkup(design, rng, list) {
  const a = design.allergens;
  const size = Math.round(design.dishSize * a.scale);
  const color = (x) => (a.mono ? design.colors.accent : COLORS[x]);
  switch (a.mode) {
    case 'emoji':
      return `<span class="alg">${list.map((x) => `<span class="emo">${EMOJI[x]}</span>`).join('')}</span>`;
    case 'svg-letter':
      return `<span class="alg">${list.map((x) => letterIcon(x, size, color(x), a.outline)).join('')}</span>`;
    case 'svg-picto':
      return `<span class="alg">${list.map((x) => pictogram(x, size, color(x))).join('')}</span>`;
    case 'sup-numbers':
      return `<sup class="algn">${list.map((x) => ALLERGENS.indexOf(x) + 1).sort((p, q) => p - q).join(a.sep)}</sup>`;
    case 'codes':
      return `<span class="algc">${rng.pick(['(V)', '(SG)', '(VG)', '(GF)', '*', '(V) (SG)'])}</span>`;
    default:
      return '';
  }
}

// ───────────────────────────── Precios ─────────────────────────────

/** Formatea un precio según el estilo de la carta. */
export function formatPrice(v, style) {
  const int = Math.abs(v - Math.round(v)) < 1e-9;
  let body;
  const sep = style.sep;
  switch (style.dec) {
    case 'int':
      body = String(Math.round(v));
      break;
    case 'short':
      body = int ? String(Math.round(v)) : v.toFixed(2).replace(/0$/, '').replace('.', sep);
      break;
    case 'eurcents':
      return int && style.intPlain ? `${Math.round(v)}€` : `${Math.floor(v)}€${v.toFixed(2).slice(-2)}`;
    case 'dash':
      body = int ? `${Math.round(v)}${sep}-` : v.toFixed(2).replace('.', sep);
      break;
    default:
      body = v.toFixed(2).replace('.', sep);
  }
  switch (style.cur) {
    case ' €':
      return `${body} €`;
    case '€':
      return `${body}€`;
    case 'pre':
      return `€${style.preSpace ? ' ' : ''}${body}`;
    case ' eur':
      return `${body} EUR`;
    default:
      return body;
  }
}

// ───────────────────────────── Diseño ─────────────────────────────

function pickFont(rng, kind) {
  return rng.pick(FONT_POOLS[kind]);
}

/** Decide el diseño de la carta (independiente del contenido salvo el número de secciones y la granularidad de precios). */
export function generateDesign(rng, content) {
  const themeKey = rng.weighted({ white: 1, paper: 2, cream: 1.6, kraft: 0.8, chalk: 1.1, dark: 0.7, sage: 0.6, photo: 1 });
  const theme = THEMES[themeKey];
  const nSections = content.sections.length;
  let columns = Number(rng.weighted({ 1: 0.5, 2: 0.38, 3: 0.12 }));
  if (columns > nSections) columns = Math.max(1, nSections);
  const bodyKind = theme.dark && themeKey === 'chalk' ? rng.weighted({ script: 0.45, sans: 0.3, condensed: 0.25 }) : rng.weighted({ serif: 0.4, sans: 0.34, condensed: 0.07, script: 0.06, mono: 0.06, display: 0.07 });
  const body = pickFont(rng, bodyKind);
  const heading = rng.chance(0.4) ? body : pickFont(rng, rng.weighted({ display: 0.35, serif: 0.25, sans: 0.2, script: 0.12, condensed: 0.08 }));
  const priceFont = rng.chance(0.75) ? body : pickFont(rng, rng.weighted({ sans: 0.4, serif: 0.3, condensed: 0.3 }));
  const descFont = rng.chance(0.7) ? body : rng.chance(0.5) ? 'Crimson' : pickFont(rng, 'sans');
  const dishSize = rng.int(columns === 3 ? 16 : 18, columns === 1 ? 30 : 26);
  const width = columns === 1 ? rng.int(780, 1150) : columns === 2 ? rng.int(1050, 1400) : rng.int(1500, 1850);
  const granularity = content.granularity;
  // Formato del precio compatible con la granularidad (una carta con céntimos no puede imprimirse sin decimales)
  const dec =
    granularity === 'int'
      ? rng.weighted({ int: 0.6, always2: 0.25, dash: 0.1, short: 0.05 })
      : granularity === 'half'
        ? rng.weighted({ always2: 0.55, short: 0.3, eurcents: 0.1, dash: 0.05 })
        : rng.weighted({ always2: 0.78, short: 0.12, eurcents: 0.1 });
  const price = {
    dec,
    sep: rng.weighted({ ',': 0.75, '.': 0.22, "'": 0.03 }),
    cur: dec === 'eurcents' ? '' : rng.weighted({ '': 0.42, ' €': 0.36, '€': 0.1, pre: 0.08, ' eur': 0.04 }),
    preSpace: rng.chance(0.4),
    intPlain: rng.chance(0.5),
  };
  if (price.dec === 'short' && price.sep === "'") price.sep = ',';
  const rowStyle = rng.weighted({ 'leaders-dots': 0.2, 'leaders-border': 0.12, right: 0.3, inline: 0.17, before: 0.13, below: 0.08 });
  const accent = rng.pick(theme.accent);
  const descStyle = rng.weighted({ 'italic-small': 0.4, small: 0.2, same: 0.12, 'gray-small': 0.18, 'caps-small': 0.05, 'italic-same': 0.05 });
  const hasDesc = content.sections.some((s) => s.dishes.some((d) => d.desc));
  const allergenMode = rng.weighted({ none: 0.55, 'svg-letter': 0.1, 'svg-picto': 0.09, emoji: 0.1, 'sup-numbers': 0.09, codes: 0.07 });
  return {
    theme: themeKey,
    colors: { bg: theme.bg, image: theme.image, ink: theme.ink, muted: theme.muted, accent, dark: !!theme.dark, photo: !!theme.photo },
    columns,
    width,
    padding: rng.int(36, 90),
    columnGap: rng.int(50, 110),
    fonts: { body, heading, price: priceFont, desc: descFont, bodyKind },
    dishSize,
    nameWeight: rng.weighted({ 400: 0.5, 600: 0.2, 700: 0.3 }),
    nameCase: rng.weighted({ none: 0.66, upper: 0.24, capitalize: 0.1 }),
    rowStyle,
    leaderChar: rng.pick(['.', '. ', '·', '· ', '_', '…']),
    inlineSep: rng.pick(['  ', ' — ', ' · ', ' / ', ' | ', ' ', ' ... ', ' – ']),
    beforeAlign: rng.pick(['right', 'left']),
    belowAlign: rng.pick(['left', 'right']),
    priceWeight: rng.weighted({ 400: 0.4, 700: 0.6 }),
    priceColor: rng.chance(0.35) ? accent : theme.ink,
    price,
    multiPrice: rng.chance(0.35),
    multiLabels: rng.pick([['½', 'Ración'], ['Tapa', 'Ración'], ['Media', 'Entera'], ['1/2 Ración', 'Ración'], ['Media ración', 'Ración'], ['1/2', 'Rac.']]),
    wineLabels: rng.pick([['Copa', 'Botella'], ['Copa', 'Bot.'], ['Copa', 'Botella']]),
    colHeadPlace: rng.pick(['inline', 'below']),
    desc: {
      style: descStyle,
      scale: descStyle.includes('same') ? 1 : rng.float(0.66, 0.88),
      inline: hasDesc && rng.chance(0.08),
      inlineSep: rng.pick([' – ', ': ', '. ']),
      indent: rng.chance(0.3),
    },
    allergens: { mode: allergenMode, rate: rng.float(0.3, 0.9), place: rng.weighted({ afterName: 0.6, beforePrice: 0.2, below: 0.2 }), scale: rng.float(0.65, 1), mono: rng.chance(0.3), outline: rng.chance(0.3), sep: rng.pick([',', ', ', ' ', '·']) },
    section: {
      style: rng.weighted({ 'caps-bold': 0.22, spaced: 0.14, smallcaps: 0.12, 'deco-dash': 0.1, 'deco-orn': 0.08, band: 0.1, underline: 0.12, script: 0.06, boxed: 0.06 }),
      scale: rng.float(1.15, 1.9),
      align: rng.weighted({ left: 0.6, center: 0.4 }),
    },
    headerAlign: rng.pick(['center', 'center', 'left']),
    numbering: rng.chance(0.05),
    dishGap: rng.float(0.35, 1.1),
    lineHeight: rng.float(1.15, 1.5),
    frame: rng.chance(0.25),
    ornaments: rng.chance(0.3),
    footer: rng.chance(0.8),
    footerLegend: allergenMode !== 'none' && allergenMode !== 'codes' && rng.chance(0.6),
  };
}

// ───────────────────────────── HTML ─────────────────────────────

function sectionHead(label, design, colHead) {
  const s = design.section;
  let inner = esc(label);
  let cls = `sec ${s.style}`;
  if (s.style === 'deco-dash') inner = `— ${inner} —`;
  if (s.style === 'deco-orn') inner = `${['❦', '✦', '~', '•', '◆'][label.length % 5]} ${inner} ${['❦', '✦', '~', '•', '◆'][label.length % 5]}`;
  if (s.style === 'caps-bold' || s.style === 'spaced' || s.style === 'band' || s.style === 'boxed') inner = inner.toUpperCase();
  if (s.style === 'spaced') inner = inner.split('').join(' ').replace(/ {3}/g, '   ');
  if (colHead && design.colHeadPlace === 'inline') {
    return `<div class="sechead"><h2 class="${cls}">${inner}</h2>${colHead}</div>`;
  }
  return `<h2 class="${cls}">${inner}</h2>${colHead ?? ''}`;
}

function nameHtml(dish, design, idx) {
  const num = design.numbering ? `<span class="num">${idx + 1}.</span> ` : '';
  return `${num}<span class="name">${esc(dish.name)}</span>`;
}

/**
 * Dibuja un plato. Devuelve el HTML; los precios impresos pueden ser varios (el último es el de la verdad).
 */
function dishHtml(dish, design, rng, ctx) {
  const prices = ctx.multi ? columnPrices(dish, ctx.kind, ctx.granularity, rng) : [dish.price];
  const priceTexts = prices.map((p) => formatPrice(p, design.price));
  const a = design.allergens;
  const algList = a.mode !== 'none' && rng.chance(a.rate) ? rng.sample(ALLERGENS, rng.int(1, 4)) : [];
  const alg = algList.length ? allergenMarkup(design, rng, algList) : '';
  const algInline = alg && (a.place === 'afterName' || a.mode === 'sup-numbers' || a.mode === 'codes') ? alg : '';
  const algBeforePrice = alg && !algInline && a.place === 'beforePrice' ? alg : '';
  const algBelow = alg && !algInline && !algBeforePrice ? alg : '';
  const descInline = dish.desc && design.desc.inline;
  const name = nameHtml(dish, design, ctx.idx) + (descInline ? `<span class="desc-inline">${esc(design.desc.inlineSep)}${esc(dish.desc)}</span>` : '') + (algInline ? ` ${algInline}` : '');
  const descBlock = dish.desc && !descInline ? `<div class="desc">${esc(dish.desc)}</div>` : '';
  const below = algBelow ? `<div class="algrow">${algBelow}</div>` : '';
  const pricesHtml = ctx.multi ? priceTexts.map((t) => `<span class="price pcol">${esc(t)}</span>`).join('') : `<span class="price">${esc(priceTexts[0])}</span>`;
  // Con columnas de precio y un solo precio (media no disponible) se deja la columna de media vacía
  const colsHtml = ctx.multi && prices.length < ctx.nCols ? `<span class="price pcol"></span>${pricesHtml}` : pricesHtml;
  const style = design.rowStyle;
  if (ctx.multi) {
    const lead = style.startsWith('leaders') ? `<span class="lead">${style === 'leaders-dots' ? esc(design.leaderChar.repeat(200)) : ''}</span>` : '<span class="fill"></span>';
    return `<div class="dish"><div class="row">${name}${algBeforePrice ? ` ${algBeforePrice}` : ''}${lead}${colsHtml}</div>${descBlock}${below}</div>`;
  }
  switch (style) {
    case 'leaders-dots':
    case 'leaders-border':
      return `<div class="dish"><div class="row">${name}${algBeforePrice ? ` ${algBeforePrice}` : ''}<span class="lead">${style === 'leaders-dots' ? esc(design.leaderChar.repeat(200)) : ''}</span>${pricesHtml}</div>${descBlock}${below}</div>`;
    case 'right':
      return `<div class="dish"><div class="row">${name}${algBeforePrice ? ` ${algBeforePrice}` : ''}<span class="fill"></span>${pricesHtml}</div>${descBlock}${below}</div>`;
    case 'inline':
      return `<div class="dish"><div class="row inline">${name}${algBeforePrice ? ` ${algBeforePrice}` : ''}<span class="sep">${esc(design.inlineSep).replace(/ /g, '&nbsp;')}</span>${pricesHtml}</div>${descBlock}${below}</div>`;
    case 'before':
      return `<div class="dish before"><div class="row"><span class="price pre">${esc(priceTexts[0])}</span><span class="nm">${name}${algBeforePrice ? ` ${algBeforePrice}` : ''}</span></div>${descBlock ? `<div class="indent">${descBlock}</div>` : ''}${below ? `<div class="indent">${below}</div>` : ''}</div>`;
    case 'below':
    default:
      return `<div class="dish"><div class="row">${name}${algBeforePrice ? ` ${algBeforePrice}` : ''}</div>${descBlock}${below}<div class="price-below">${esc(priceTexts[0])}</div></div>`;
  }
}

function sectionCss(design) {
  const s = design.section;
  const size = Math.round(design.dishSize * s.scale);
  const base = `.sec { font-family: '${design.fonts.heading}', serif; font-size: ${size}px; color: ${design.colors.accent}; margin: ${Math.round(size * 0.9)}px 0 ${Math.round(size * 0.45)}px; text-align: ${s.align}; font-weight: 700; line-height: 1.2; }`;
  const extra = {
    'caps-bold': '',
    spaced: '.sec { letter-spacing: 0.12em; font-weight: 400; }',
    smallcaps: '.sec { font-variant: small-caps; letter-spacing: 0.08em; font-weight: 400; }',
    'deco-dash': '.sec { font-weight: 400; }',
    'deco-orn': '.sec { font-weight: 400; }',
    band: `.sec { background: ${design.colors.accent}; color: ${design.colors.bg}; padding: 4px 14px; display: ${s.align === 'center' ? 'block' : 'inline-block'}; font-weight: 600; }`,
    underline: `.sec { border-bottom: 2px solid ${design.colors.accent}; padding-bottom: 4px; font-weight: 400; }`,
    script: `.sec { font-family: 'Nothing You Could Do', cursive; font-weight: 400; }`,
    boxed: `.sec { border: 2px solid ${design.colors.accent}; padding: 4px 12px; display: ${s.align === 'center' ? 'block' : 'inline-block'}; font-weight: 600; letter-spacing: 0.05em; }`,
  }[s.style];
  return `${base} ${extra}`;
}

function descCss(design) {
  const d = design.desc;
  const size = Math.round(design.dishSize * d.scale);
  const italic = d.style.startsWith('italic');
  const color = d.style === 'gray-small' || italic ? design.colors.muted : design.colors.ink;
  const caps = d.style === 'caps-small' ? 'text-transform: uppercase; letter-spacing: 0.04em;' : '';
  return `.desc, .desc-inline { font-family: '${design.fonts.desc}', serif; font-size: ${size}px; ${italic ? 'font-style: italic;' : ''} color: ${color}; ${caps} line-height: 1.3; }
    .desc { margin-top: 2px; ${d.indent ? 'padding-left: 1.2em;' : ''} }`;
}

/** Reparte las secciones en columnas equilibrando el número de líneas (en orden de lectura). */
function distribute(sections, columns) {
  if (columns <= 1) return [sections];
  const weight = (s) => 2 + s.dishes.reduce((n, d) => n + 1 + (d.desc ? 0.8 : 0), 0);
  const total = sections.reduce((n, s) => n + weight(s), 0);
  const out = Array.from({ length: columns }, () => []);
  let col = 0;
  let acc = 0;
  sections.forEach((s, i) => {
    const remainingCols = columns - col - 1;
    const remainingSecs = sections.length - i;
    if (col < columns - 1 && out[col].length && (acc + weight(s) / 2 > (total * (col + 1)) / columns || remainingSecs <= remainingCols)) {
      col++;
    }
    out[col].push(s);
    acc += weight(s);
  });
  return out.filter((c) => c.length);
}

/**
 * HTML de la carta y verdad de referencia. `rng` es el flujo de diseño (iconos y precios de columna).
 * Devuelve { html, width, expected: [{ section, name, price, description? }] }.
 */
export function renderMenu(content, design, rng) {
  const c = design.colors;
  const fonts = [...new Set([design.fonts.body, design.fonts.heading, design.fonts.price, design.fonts.desc, design.section.style === 'script' ? 'Nothing You Could Do' : null].filter(Boolean))];
  const priceW = Math.round(design.dishSize * (design.price.cur ? 4.6 : 3.6));
  const expected = [];
  const colsHtml = distribute(content.sections, design.columns).map((secs) =>
    secs
      .map((sec) => {
        const kind = sec.wine ? 'wine' : 'dish';
        const multi = design.multiPrice && sec.multiCandidate && ['leaders-dots', 'leaders-border', 'right'].includes(design.rowStyle);
        const labels = sec.wine ? design.wineLabels : design.multiLabels;
        const colHead = multi ? `<div class="colhead">${labels.map((l) => `<span class="pcol">${esc(l)}</span>`).join('')}</div>` : undefined;
        const dishes = sec.dishes
          .map((d, idx) => {
            expected.push({ section: sec.label, name: d.name, price: d.price, ...(d.desc ? { description: d.desc } : {}) });
            return dishHtml(d, design, rng, { multi, kind, granularity: content.granularity, idx, nCols: labels.length });
          })
          .join('');
        return `<section>${sectionHead(sec.label, design, colHead)}${dishes}</section>`;
      })
      .join(''),
  );
  const orn = design.ornaments ? `<div class="orn">${rng.pick(['❦', '✦ ✦ ✦', '— ◆ —', '~ • ~', '✻'])}</div>` : '';
  const legend = design.footerLegend
    ? `<div class="legend">${['gluten', 'huevo', 'lacteos', 'pescado', 'crustaceos', 'frutos']
        .map((a) => `${design.allergens.mode === 'emoji' ? EMOJI[a] : design.allergens.mode === 'svg-letter' ? letterIcon(a, 16, COLORS[a], false) : design.allergens.mode === 'svg-picto' ? pictogram(a, 16, COLORS[a]) : `${ALLERGENS.indexOf(a) + 1}.`} ${{ gluten: 'Gluten', huevo: 'Huevo', lacteos: 'Lácteos', pescado: 'Pescado', crustaceos: 'Crustáceos', frutos: 'Frutos secos' }[a]}`)
        .join(' &nbsp; ')}</div>`
    : '';
  const footer = design.footer ? `<footer>${legend}${content.footer.map((n) => `<div>${esc(n)}</div>`).join('')}</footer>` : legend ? `<footer>${legend}</footer>` : '';
  const ds = design.dishSize;
  const css = `${fonts.map(fontFace).join('\n')}
    * { box-sizing: border-box; } html, body { margin: 0; }
    body { width: ${design.width}px; overflow: hidden; background-color: ${c.bg}; background-image: ${c.image}; color: ${c.ink}; font-family: '${design.fonts.body}', serif; }
    .page { padding: ${design.padding}px; position: relative; ${design.frame ? `outline: 3px double ${c.accent}; outline-offset: -${Math.round(design.padding * 0.45)}px;` : ''} }
    ${c.photo ? `.page::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 20% 10%, rgba(255,255,255,.25), rgba(0,0,0,0) 45%), radial-gradient(ellipse at 85% 90%, rgba(80,60,30,.12), rgba(0,0,0,0) 50%); }` : ''}
    header { text-align: ${design.headerAlign}; margin-bottom: ${Math.round(ds * 1.4)}px; }
    h1 { font-family: '${design.fonts.heading}', serif; font-size: ${Math.round(ds * 2.4)}px; margin: 0; color: ${c.accent}; font-weight: 400; letter-spacing: 0.04em; }
    .tag { font-size: ${Math.round(ds * 0.85)}px; color: ${c.muted}; margin-top: 4px; font-style: italic; }
    .orn { font-size: ${Math.round(ds * 1.1)}px; color: ${c.accent}; margin: 6px 0; }
    main { display: grid; grid-template-columns: repeat(${design.columns}, minmax(0, 1fr)); column-gap: ${design.columnGap}px; align-items: start; }
    ${sectionCss(design)}
    .sechead { display: flex; align-items: baseline; gap: 12px; } .sechead .sec { flex: 1; }
    .colhead { display: flex; justify-content: flex-end; font-size: ${Math.round(ds * 0.8)}px; color: ${c.muted}; margin-bottom: 4px; }
    .pcol { display: inline-block; width: ${priceW}px; text-align: right; }
    .dish { margin-bottom: ${Math.round(ds * design.dishGap)}px; break-inside: avoid; }
    .row { display: flex; min-width: 0; align-items: baseline; font-size: ${ds}px; line-height: ${design.lineHeight}; gap: 0; }
    .name { font-weight: ${design.nameWeight}; text-transform: ${design.nameCase}; }
    .num { font-weight: 700; color: ${c.accent}; margin-right: 6px; }
    .lead { flex: 1 1 0; width: 0; overflow: hidden; white-space: nowrap; margin: 0 8px; color: ${c.muted}; ${design.rowStyle === 'leaders-border' ? `border-bottom: 2px dotted ${c.muted}; transform: translateY(-0.3em);` : ''} min-width: 20px; }
    .fill { flex: 1; min-width: 24px; }
    .price { font-family: '${design.fonts.price}', serif; font-weight: ${design.priceWeight}; color: ${design.priceColor}; white-space: nowrap; }
    .row.inline { display: block; }
    .before .pre { display: inline-block; min-width: ${Math.round(ds * 3.4)}px; text-align: ${design.beforeAlign}; margin-right: ${Math.round(ds * 0.9)}px; flex: none; }
    .before .indent { padding-left: ${Math.round(ds * 4.3)}px; }
    .price-below { font-family: '${design.fonts.price}', serif; font-weight: ${design.priceWeight}; color: ${design.priceColor}; font-size: ${ds}px; text-align: ${design.belowAlign}; margin-top: 2px; }
    ${descCss(design)}
    .alg { display: inline-flex; gap: 3px; vertical-align: middle; margin: 0 6px; } .alg svg { display: block; }
    .emo { font-family: 'Noto Color Emoji'; font-size: ${Math.round(ds * design.allergens.scale * 0.85)}px; }
    .algn { font-size: 0.6em; color: ${c.muted}; margin-left: 3px; } .algc { font-size: 0.75em; color: ${c.muted}; margin-left: 6px; }
    .algrow { margin-top: 3px; } .algrow .alg { margin: 0; }
    footer { margin-top: ${Math.round(ds * 1.6)}px; text-align: center; font-size: ${Math.round(ds * 0.62)}px; color: ${c.muted}; line-height: 1.5; }
    .legend { margin-bottom: 6px; } .legend svg { vertical-align: middle; }`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(content.restaurant)}</title><style>${css}</style></head><body><div class="page">
    <header><h1>${esc(content.restaurant)}</h1><div class="tag">${esc(content.tagline)}</div>${orn}</header>
    <main>${colsHtml.map((h) => `<div class="col">${h}</div>`).join('')}</main>${footer}</div></body></html>`;
  return { html, width: design.width, expected };
}
