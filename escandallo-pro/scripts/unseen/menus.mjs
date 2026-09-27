/**
 * Cartas «unseen»: 7 cartas de restaurante (HTML → captura JPEG) con diseños que el parser no ha visto: dos columnas con
 * puntos de relleno, precio delante del nombre, precios sin «€», pizarra con letra manuscrita sobre fondo oscuro,
 * tabla de media ración / ración, carta de vinos con copa / botella y añadas, y carta con iconos de alérgenos y
 * descripciones largas. La verdad de referencia sale de los mismos datos con que se dibuja el HTML.
 *
 * Reglas de la verdad de referencia (las de la app): el precio de un plato con media ración y ración es el de la
 * ración completa; el de un vino con copa y botella, el de la botella; los iconos de alérgenos no forman parte del nombre.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, fmt } from './helpers.mjs';

const FONTS = join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/unseen/fonts');
const font = (family, file, weight = 400, style = 'normal') =>
  `@font-face { font-family: '${family}'; src: url(data:font/woff2;base64,${readFileSync(join(FONTS, file)).toString('base64')}) format('woff2'); font-weight: ${weight}; font-style: ${style}; }`;

const eur = (v) => `${fmt(v, 2)} €`;

function page(title, css, body, fonts = '') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${fonts} * { box-sizing: border-box; } html, body { margin: 0; } ${css}</style></head><body>${body}</body></html>`;
}

function expected(id, features, sections) {
  const entries = [];
  for (const s of sections) for (const d of s.dishes) entries.push({ section: s.label ?? s.title, name: d.name, price: d.price, ...(d.desc ? { description: d.desc } : {}) });
  return { id, kind: 'menu', features, entries };
}

// ───────────────────────────── m01 · Bistró a dos columnas con puntos de relleno ─────────────────────────────

function m01() {
  const sections = [
    {
      title: 'Entrantes',
      col: 0,
      dishes: [
        { name: 'Crema de calabaza asada', price: 7.5 },
        { name: 'Burrata con tomate de temporada', price: 12.9, desc: 'Albahaca fresca y aceite de oliva virgen extra' },
        { name: 'Tartar de salmón', price: 14.5 },
        { name: 'Croquetas de boletus (6 uds)', price: 9 },
      ],
    },
    {
      title: 'Principales',
      col: 0,
      dishes: [
        { name: 'Risotto de setas y trufa', price: 16.8 },
        { name: 'Lubina a la bilbaína', price: 21.5, desc: 'Con patatas confitadas' },
        { name: 'Magret de pato con frutos rojos', price: 19.9 },
      ],
    },
    {
      title: 'Carnes',
      col: 1,
      dishes: [
        { name: 'Entrecot de vaca madurada (300 g)', price: 24.5 },
        { name: 'Carrilleras al Pedro Ximénez', price: 17.9 },
        { name: 'Hamburguesa Black Angus', price: 15.5, desc: 'Queso cheddar, cebolla caramelizada y patatas' },
      ],
    },
    {
      title: 'Postres',
      col: 1,
      dishes: [
        { name: 'Tarta de queso cremosa', price: 6.5 },
        { name: 'Coulant de chocolate', price: 7 },
        { name: 'Sorbete de limón al cava', price: 5.5 },
      ],
    },
  ];
  const col = (c) =>
    sections
      .filter((s) => s.col === c)
      .map(
        (s) =>
          `<h2>${s.title}</h2>${s.dishes
            .map((d) => `<div class="d"><div class="l"><span class="n">${esc(d.name)}</span><span class="dots"></span><span class="p">${eur(d.price)}</span></div>${d.desc ? `<div class="desc">${esc(d.desc)}</div>` : ''}</div>`)
            .join('')}`,
      )
      .join('');
  const html = page(
    'Bistró La Menta',
    `body { width: 1100px; height: 1420px; background: #fbf8f1; font-family: 'Liberation Serif', serif; color: #2b2b2b; padding: 60px 70px; }
     h1 { text-align: center; font-size: 58px; margin: 0; letter-spacing: 6px; color: #2f5d50; font-weight: 400; }
     .sub { text-align: center; font-style: italic; font-size: 22px; margin: 6px 0 40px; color: #666; }
     .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; }
     h2 { font-variant: small-caps; letter-spacing: 3px; font-size: 32px; color: #2f5d50; border-bottom: 1px solid #2f5d50; margin: 26px 0 16px; font-weight: 400; }
     .d { margin-bottom: 16px; } .l { display: flex; align-items: baseline; font-size: 24px; }
     .dots { flex: 1; border-bottom: 2px dotted #999; margin: 0 8px; transform: translateY(-5px); }
     .p { font-weight: 700; white-space: nowrap; }
     .desc { font-style: italic; font-size: 18px; color: #666; margin-top: 2px; }
     .foot { position: absolute; left: 0; right: 0; bottom: 50px; text-align: center; font-size: 17px; color: #777; }`,
    `<h1>BISTRÓ LA MENTA</h1><div class="sub">Cocina de mercado</div><div class="cols"><div>${col(0)}</div><div>${col(1)}</div></div>
     <div class="foot">IVA incluido · Pan y aperitivo 1,80 € por persona<br>C/ Mayor, 12 · 28013 Madrid · Reservas 915 123 456</div>`,
  );
  return { id: 'm01-bistro-dos-columnas', size: { width: 1100, height: 1420 }, html, expected: expected('m01', ['dos columnas', 'puntos de relleno', 'descripciones en cursiva', 'cargo de pan en el pie'], sections) };
}

// ───────────────────────────── m02 · Precio delante del nombre ─────────────────────────────

function m02() {
  const sections = [
    {
      title: 'Tapas frías',
      dishes: [
        { name: 'Gilda de anchoa y guindilla', price: 3.5 },
        { name: 'Boquerones en vinagre', price: 4.2 },
        { name: 'Ensaladilla rusa', price: 5.8 },
        { name: 'Salpicón de marisco', price: 6.5 },
      ],
    },
    {
      title: 'Tapas calientes',
      dishes: [
        { name: 'Tortilla de patatas', price: 4 },
        { name: 'Oreja a la plancha', price: 7.5 },
        { name: 'Calamares a la romana', price: 8.9 },
        { name: 'Patatas bravas', price: 6.2 },
      ],
    },
    {
      title: 'Bocadillos',
      dishes: [
        { name: 'Bocadillo de calamares', price: 5.5 },
        { name: 'Serranito de lomo', price: 6.8 },
        { name: 'Pepito de ternera', price: 4.9 },
      ],
    },
  ];
  const html = page(
    'Bar Casa Tomás',
    `body { width: 900px; height: 1300px; background: #fff7e6; font-family: 'Oswald', 'Liberation Sans', sans-serif; color: #3a2a1a; padding: 50px 80px; }
     h1 { font-size: 64px; margin: 0; text-align: center; color: #a61c00; letter-spacing: 2px; font-weight: 500; }
     .t { text-align: center; font-size: 22px; margin-bottom: 26px; font-family: 'Liberation Sans', sans-serif; }
     h2 { background: #a61c00; color: #fff; display: inline-block; padding: 4px 18px; font-size: 28px; font-weight: 500; margin: 26px 0 12px; letter-spacing: 1px; }
     .r { display: flex; gap: 26px; font-size: 27px; margin: 9px 0; align-items: baseline; font-family: 'Liberation Sans', sans-serif; }
     .r .p { width: 90px; text-align: right; font-weight: 700; color: #a61c00; font-family: 'Oswald', sans-serif; font-size: 29px; }`,
    `<h1>BAR CASA TOMÁS</h1><div class="t">Tapas y raciones · Desde 1962</div>${sections
      .map((s) => `<h2>${s.title.toUpperCase()}</h2>${s.dishes.map((d) => `<div class="r"><span class="p">${fmt(d.price, 2)}</span><span>${esc(d.name)}</span></div>`).join('')}`)
      .join('')}`,
    font('Oswald', 'oswald-latin-500.woff2', 500),
  );
  return { id: 'm02-precio-delante', size: { width: 900, height: 1300 }, html, expected: expected('m02', ['precio delante del nombre', 'secciones en bandas de color', 'tipografía condensada'], sections) };
}

// ───────────────────────────── m03 · Precios sin «€», enteros y con punto decimal ─────────────────────────────

function m03() {
  const sections = [
    {
      title: 'De la huerta',
      dishes: [
        { name: 'Ensalada de tomate de la huerta', price: 9.5, p: '9,50' },
        { name: 'Pimientos de Padrón', price: 7, p: '7' },
        { name: 'Alcachofas a la plancha', price: 11.5, p: '11,50' },
        { name: 'Pisto con huevo', price: 8.5, p: '8.50' },
      ],
    },
    {
      title: 'Del mar',
      dishes: [
        { name: 'Pulpo a la brasa', price: 19, p: '19' },
        { name: 'Chipirones encebollados', price: 14.5, p: '14,50' },
        { name: 'Bacalao al pil pil', price: 18.5, p: '18,50' },
      ],
    },
    {
      title: 'De la tierra',
      dishes: [
        { name: 'Chuletón de buey (1 kg)', price: 58, p: '58' },
        { name: 'Rabo de toro estofado', price: 16, p: '16' },
        { name: 'Presa ibérica', price: 17.5, p: '17,50' },
        { name: 'Callos a la madrileña', price: 12, p: '12' },
      ],
    },
  ];
  const html = page(
    'Taberna El Candil',
    `body { width: 1000px; height: 1400px; background: #f3efe6; font-family: 'DejaVu Sans', sans-serif; color: #222; padding: 60px 90px; }
     h1 { font-family: 'Playfair Display', serif; font-size: 60px; text-align: center; margin: 0; }
     .since { text-align: center; font-size: 20px; letter-spacing: 6px; margin-bottom: 34px; color: #8a6d3b; }
     h2 { font-family: 'Playfair Display', serif; font-size: 34px; text-align: center; margin: 34px 0 14px; color: #8a6d3b; }
     h2::before, h2::after { content: '~'; margin: 0 16px; color: #bba57a; }
     .r { display: flex; justify-content: space-between; font-size: 25px; margin: 11px 30px; }
     .p { font-weight: 700; }
     .foot { text-align: center; font-size: 18px; color: #666; margin-top: 44px; }`,
    `<h1>Taberna El Candil</h1><div class="since">DESDE 1987</div>${sections
      .map((s) => `<h2>${s.title}</h2>${s.dishes.map((d) => `<div class="r"><span>${esc(d.name)}</span><span class="p">${d.p}</span></div>`).join('')}`)
      .join('')}<div class="foot">Precios en euros, IVA incluido<br>Reservas 954 22 33 44 · Abierto de martes a domingo de 13:00 a 16:30</div>`,
    font('Playfair Display', 'playfair-display-latin-700.woff2', 700),
  );
  return { id: 'm03-sin-euro', size: { width: 1000, height: 1400 }, html, expected: expected('m03', ['precios sin €', 'precios enteros', 'punto decimal (8.50)', '«Desde 1987» y teléfono en el pie', 'horario'], sections) };
}

// ───────────────────────────── m04 · Pizarra con letra manuscrita sobre fondo oscuro ─────────────────────────────

function m04() {
  const sections = [
    {
      title: 'Para empezar',
      dishes: [
        { name: 'Alcachofas confitadas con jamón', price: 12, p: '12 €' },
        { name: 'Tataki de atún rojo', price: 19, p: '19 €' },
      ],
    },
    {
      title: 'Principales',
      dishes: [
        { name: 'Rabo de toro al vino tinto', price: 18.5, p: '18,50 €' },
        { name: 'Arroz meloso de bogavante', price: 24, p: '24 €' },
        { name: 'Cogote de merluza a la brasa', price: 22, p: '22 €' },
      ],
    },
    {
      title: 'Dulces',
      dishes: [
        { name: 'Torrija caramelizada', price: 6.5, p: '6,50 €' },
        { name: 'Milhojas de crema', price: 5.9, p: '5,90 €' },
      ],
    },
  ];
  const html = page(
    'Pizarra de sugerencias',
    `body { width: 1000px; height: 1250px; background: #5b3a1e; padding: 34px; }
     .board { width: 100%; height: 100%; background: radial-gradient(circle at 30% 20%, #3b4240 0%, #2a2f2e 55%, #232726 100%); border-radius: 6px; box-shadow: inset 0 0 60px rgba(0,0,0,.7); padding: 50px 70px; color: #f4f1e8; font-family: 'Caveat', cursive; position: relative; overflow: hidden; }
     .board::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(115deg, rgba(255,255,255,.025) 0 3px, transparent 3px 11px); pointer-events: none; }
     h1 { font-size: 78px; margin: 0 0 10px; text-align: center; font-weight: 700; color: #fff; }
     h2 { font-size: 46px; margin: 26px 0 8px; font-weight: 700; color: #ffd966; text-decoration: underline; text-decoration-thickness: 2px; }
     .r { display: flex; justify-content: space-between; font-size: 44px; margin: 4px 0; }
     .p { color: #ffe599; font-weight: 700; }
     .note { position: absolute; bottom: 40px; left: 0; right: 0; text-align: center; font-size: 32px; color: #cfd8d6; }`,
    `<div class="board"><h1>Sugerencias del día</h1>${sections
      .map((s) => `<h2>${s.title}</h2>${s.dishes.map((d) => `<div class="r"><span>${esc(d.name)}</span><span class="p">${d.p}</span></div>`).join('')}`)
      .join('')}<div class="note">¡Pregunta por el pescado del día!</div></div>`,
    font('Caveat', 'caveat-latin-400.woff2', 400) + font('Caveat', 'caveat-latin-700.woff2', 700),
  );
  return { id: 'm04-pizarra-manuscrita', size: { width: 1000, height: 1250 }, html, expected: expected('m04', ['pizarra: fondo oscuro', 'letra manuscrita (Caveat)', 'precios enteros con €'], sections) };
}

// ───────────────────────────── m05 · Tabla de media ración / ración ─────────────────────────────

function m05() {
  const sections = [
    {
      title: 'Raciones',
      dishes: [
        { name: 'Calamares a la andaluza', half: 8, price: 14 },
        { name: 'Pulpo a la gallega', half: 11.5, price: 19.5 },
        { name: 'Croquetas caseras', half: 6, price: 10.5 },
        { name: 'Patatas bravas', half: 4, price: 6.5 },
        { name: 'Jamón ibérico de bellota', half: null, price: 22 },
        { name: 'Queso manchego curado', half: 7, price: 12 },
        { name: 'Chopitos fritos', half: 7.5, price: 13 },
        { name: 'Gambas al ajillo', half: null, price: 14.5 },
      ],
    },
    {
      title: 'Del carbón',
      dishes: [
        { name: 'Pimientos del piquillo rellenos', half: 6.5, price: 11 },
        { name: 'Secreto ibérico', half: 9, price: 16 },
        { name: 'Chorizo criollo', half: 5, price: 8.5 },
      ],
    },
  ];
  const html = page(
    'Casa Paco raciones',
    `body { width: 1000px; height: 1300px; background: #ffffff; font-family: 'Liberation Sans', sans-serif; color: #1b1b1b; padding: 56px 80px; }
     h1 { font-size: 54px; margin: 0 0 30px; text-align: center; color: #0b3d62; }
     table { width: 100%; border-collapse: collapse; margin-bottom: 26px; }
     th { font-size: 26px; text-align: right; color: #0b3d62; padding: 8px 10px; border-bottom: 3px solid #0b3d62; }
     th:first-child { text-align: left; font-size: 32px; }
     td { font-size: 26px; padding: 10px; border-bottom: 1px solid #d5dde5; }
     td.p { text-align: right; width: 150px; font-weight: 700; }`,
    `<h1>Casa Paco</h1>${sections
      .map(
        (s) =>
          `<table><tr><th>${s.title.toUpperCase()}</th><th>½ Ración</th><th>Ración</th></tr>${s.dishes
            .map((d) => `<tr><td>${esc(d.name)}</td><td class="p">${d.half === null ? '—' : fmt(d.half, 2)}</td><td class="p">${fmt(d.price, 2)}</td></tr>`)
            .join('')}</table>`,
      )
      .join('')}<div style="text-align:center;font-size:19px;color:#666">Precios en euros con IVA incluido</div>`,
  );
  return { id: 'm05-media-racion-tabla', size: { width: 1000, height: 1300 }, html, expected: expected('m05', ['tabla con columnas ½ Ración | Ración', 'platos sólo con ración (—)', 'precio sin €'], sections) };
}

// ───────────────────────────── m06 · Carta de vinos: copa / botella, añadas ─────────────────────────────

function m06() {
  const groups = [
    {
      title: 'Tintos',
      subs: [
        {
          title: 'D.O.Ca. Rioja',
          dishes: [
            { name: 'Viña Ardanza Reserva 2017', glass: null, price: 38 },
            { name: 'Marqués de Riscal Reserva 2019', glass: null, price: 29.5 },
            { name: 'Luis Cañas Crianza 2021', glass: 4.5, price: 22 },
          ],
        },
        {
          title: 'D.O. Ribera del Duero',
          dishes: [
            { name: 'Protos Roble 2022', glass: 3.8, price: 19.5 },
            { name: 'Pago de Carraovejas 2021', glass: null, price: 58 },
            { name: 'Emilio Moro 2021', glass: null, price: 32 },
          ],
        },
      ],
    },
    {
      title: 'Blancos',
      subs: [
        {
          title: 'D.O. Rías Baixas',
          dishes: [
            { name: 'Pazo de Señoráns 2023', glass: null, price: 27 },
            { name: 'Martín Códax 2024', glass: 3.9, price: 18.5 },
          ],
        },
        { title: 'D.O. Rueda', dishes: [{ name: 'José Pariente Verdejo 2024', glass: 3.5, price: 17 }] },
      ],
    },
    {
      title: 'Espumosos',
      subs: [
        {
          title: 'D.O. Cava',
          dishes: [
            { name: 'Juvé & Camps Reserva de la Familia', glass: null, price: 26 },
            { name: 'Gramona Imperial Gran Reserva', glass: null, price: 34 },
          ],
        },
      ],
    },
  ];
  const sections = groups.flatMap((g) => g.subs.map((s) => ({ label: `${g.title} · ${s.title}`, dishes: s.dishes })));
  const html = page(
    'Carta de vinos',
    `body { width: 1000px; height: 1500px; background: #fdfbf7; font-family: 'Playfair Display', 'Liberation Serif', serif; color: #2a1a1f; padding: 60px 90px; }
     h1 { text-align: center; font-size: 60px; margin: 0 0 6px; font-weight: 700; color: #6d1b2c; }
     .sub { text-align: center; font-family: 'Lora', serif; font-style: italic; font-size: 22px; margin-bottom: 20px; color: #7a6a60; }
     .hdr { display: flex; justify-content: flex-end; gap: 0; font-family: 'Liberation Sans', sans-serif; font-size: 18px; color: #7a6a60; letter-spacing: 2px; }
     .hdr span { width: 130px; text-align: right; }
     h2 { font-size: 40px; color: #6d1b2c; margin: 24px 0 4px; border-bottom: 1px solid #c9a9a6; }
     h3 { font-family: 'Lora', serif; font-style: italic; font-weight: 400; font-size: 24px; margin: 12px 0 6px; color: #7a6a60; }
     .r { display: flex; font-size: 24px; margin: 6px 0; font-family: 'Liberation Serif', serif; }
     .r .n { flex: 1; } .r .p { width: 130px; text-align: right; }`,
    `<h1>Carta de vinos</h1><div class="sub">Selección de nuestra bodega</div><div class="hdr"><span>COPA</span><span>BOTELLA</span></div>${groups
      .map(
        (g) =>
          `<h2>${g.title}</h2>${g.subs
            .map((s) => `<h3>${esc(s.title)}</h3>${s.dishes.map((d) => `<div class="r"><span class="n">${esc(d.name)}</span><span class="p">${d.glass === null ? '' : fmt(d.glass, 2)}</span><span class="p">${fmt(d.price, 2)}</span></div>`).join('')}`)
            .join('')}`,
      )
      .join('')}`,
    font('Playfair Display', 'playfair-display-latin-700.woff2', 700) + font('Lora', 'lora-latin-400-italic.woff2', 400, 'italic'),
  );
  return { id: 'm06-carta-vinos', size: { width: 1000, height: 1500 }, html, expected: expected('m06', ['carta de vinos', 'columnas Copa | Botella (copa vacía en muchos vinos)', 'añadas (2017…2024) en el nombre', 'subsecciones D.O.'], sections) };
}

// ───────────────────────────── m07 · Iconos de alérgenos y descripciones largas ─────────────────────────────

function m07() {
  const A = { g: '🌾', l: '🥛', h: '🥚', p: '🐟', c: '🦐', f: '🥜' };
  const sections = [
    {
      title: 'Para comenzar',
      dishes: [
        { name: 'Ceviche de corvina', price: 14.5, al: 'p', desc: 'Leche de tigre de ají amarillo, boniato glaseado, maíz cancha y cilantro fresco' },
        { name: 'Ensalada de burrata y tomates heirloom', price: 13, al: 'lf', desc: 'Tomates de temporada, pesto de albahaca, piñones tostados y aceite de oliva arbequina' },
        { name: 'Croquetas melosas de cocido', price: 9.5, al: 'glh', desc: 'Receta de la abuela con rebozado crujiente de panko. Seis unidades' },
      ],
    },
    {
      title: 'Principales',
      dishes: [
        { name: 'Arroz meloso de carabinero', price: 23.5, al: 'cph', desc: 'Fumet tostado de cabezas, alioli suave de azafrán y lima' },
        { name: 'Lomo de bacalao confitado', price: 21, al: 'p', desc: 'Pil pil de sus pieles, pimientos asados al carbón y patata ratte' },
        { name: 'Presa ibérica a la brasa', price: 22.5, al: 'l', desc: 'Parmentier de patata ahumada, chimichurri de hierbas y sal en escamas' },
      ],
    },
    {
      title: 'Postres',
      dishes: [
        { name: 'Torrija de brioche', price: 7.5, al: 'glh', desc: 'Caramelizada al momento con helado de leche merengada y canela' },
        { name: 'Chocolate en texturas', price: 8, al: 'lhf', desc: 'Cremoso al 70 %, bizcocho aireado, tierra de cacao y sorbete de frambuesa' },
      ],
    },
  ];
  const html = page(
    'Restaurante Alma',
    `body { width: 1000px; height: 1550px; background: #fffdf9; font-family: 'Liberation Sans', sans-serif; color: #262626; padding: 56px 80px; }
     h1 { font-family: 'Playfair Display', serif; font-size: 62px; text-align: center; margin: 0; }
     .sub { text-align: center; font-size: 20px; color: #7f7f7f; letter-spacing: 4px; margin-bottom: 26px; }
     h2 { font-family: 'Playfair Display', serif; font-size: 34px; margin: 26px 0 10px; color: #274e13; }
     .d { margin: 0 0 18px; }
     .l { display: flex; align-items: baseline; font-size: 26px; font-weight: 700; }
     .l .n { flex: 1; } .al { font-size: 19px; margin-left: 10px; font-weight: 400; letter-spacing: 3px; }
     .l .p { font-weight: 700; }
     .desc { font-family: 'Lora', serif; font-style: italic; font-size: 19px; color: #666; margin-top: 3px; width: 700px; line-height: 1.35; }
     .legend { margin-top: 30px; border-top: 1px solid #ccc; padding-top: 12px; font-size: 17px; color: #555; text-align: center; }`,
    `<h1>Alma</h1><div class="sub">MENÚ DE TEMPORADA</div>${sections
      .map(
        (s) =>
          `<h2>${s.title}</h2>${s.dishes
            .map((d) => `<div class="d"><div class="l"><span class="n">${esc(d.name)}<span class="al">${[...d.al].map((k) => A[k]).join(' ')}</span></span><span class="p">${eur(d.price)}</span></div><div class="desc">${esc(d.desc)}</div></div>`)
            .join('')}`,
      )
      .join('')}<div class="legend">${A.g} Gluten · ${A.l} Lácteos · ${A.h} Huevo · ${A.p} Pescado · ${A.c} Crustáceos · ${A.f} Frutos de cáscara<br>Consulta a nuestro personal cualquier alergia o intolerancia</div>`,
    font('Playfair Display', 'playfair-display-latin-700.woff2', 700) + font('Lora', 'lora-latin-400-italic.woff2', 400, 'italic'),
  );
  return { id: 'm07-alergenos-descripciones', size: { width: 1000, height: 1550 }, html, expected: expected('m07', ['iconos de alérgenos (emoji) tras el nombre', 'descripciones largas en dos filas', 'leyenda de alérgenos en el pie', '«70 %» dentro de una descripción'], sections) };
}

export const MENUS = [m01, m02, m03, m04, m05, m06, m07].map((f) => f());

/** Cartas con variantes degradadas en el banco de pruebas. */
export const DEGRADED_MENUS = ['m01-bistro-dos-columnas', 'm03-sin-euro', 'm07-alergenos-descripciones'];
