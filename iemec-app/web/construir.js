#!/usr/bin/env node
'use strict';
// Generador de la web pública de IEMEC.
//
//   node web/construir.js                 → web/dist (lo que se sube a public_html)
//   node web/construir.js --borradores    → web/dist-borradores: además, los borradores de
//                                           web/contenido/pendientes con la franja «Borrador»
//   node web/construir.js --salida <dir>  → otra carpeta (las pruebas construyen en una temporal)
//
// Lee web/datos/*.json, web/contenido/*.json, los textos legales y el catálogo de la app, y escribe
// páginas con URL limpias, recursos con huella, .htaccess, sitemap.xml, robots.txt e informe.json.
// Determinista: con las mismas entradas, los mismos bytes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cargarDatos, construirModelo, resolverRedirecciones, WEB, RAIZ } = require('./lib/modelo');
const { secciones, markdownAHtml } = require('./lib/markdown');
const { crudo } = require('./lib/html');
const B = require('./lib/base');
const P = require('./lib/paginas');
const { htaccess } = require('./lib/htaccess');
const R = require('./lib/revision');
const { avisosEn } = require('./lib/normas');

const FUENTES = [
  ['montserrat-latin-300-normal.woff2', 'Montserrat', 'normal', 300],
  ['montserrat-latin-400-normal.woff2', 'Montserrat', 'normal', 400, true],
  ['montserrat-latin-500-normal.woff2', 'Montserrat', 'normal', 500],
  ['montserrat-latin-600-normal.woff2', 'Montserrat', 'normal', 600],
  ['playfair-display-latin-500-normal.woff2', 'Playfair Display', 'normal', 500],
  ['playfair-display-latin-400-italic.woff2', 'Playfair Display', 'italic', 400],
  ['playfair-display-latin-500-italic.woff2', 'Playfair Display', 'italic', 500, true],
];

// El isotipo de IEMEC (las tres barras) en champán sobre terciopelo.
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b2b2a"/><rect x="2" y="2" width="60" height="60" rx="12" fill="none" stroke="#c9a45c" stroke-opacity=".55"/><g stroke="#d9bf8f" stroke-width="5.5" stroke-linecap="round"><path d="M18 20h28M22 32h20M18 44h28"/></g></svg>\n`;

const huella = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

function minificarCss(css) {
  const guardados = [];
  let s = css.replace(/url\("[^"]*"\)/g, (m) => `__URL${guardados.push(m) - 1}__`);
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/:\s+/g, ':').replace(/;}/g, '}').trim();
  return s.replace(/__URL(\d+)__/g, (_, i) => guardados[Number(i)]);
}

function argumentos(argv) {
  const o = { borradores: argv.includes('--borradores'), silencio: argv.includes('--silencio') };
  const i = argv.indexOf('--salida');
  if (i !== -1) o.salida = path.resolve(argv[i + 1]);
  const j = argv.indexOf('--referencias');
  if (j !== -1) o.referencias = path.resolve(argv[j + 1]);
  return o;
}

// Textos legales: sin la nota de redacción del principio ni las secciones internas.
function textoLegal(md, { quitar = [], desenvolver = null } = {}) {
  let s = md.replace(/\r\n/g, '\n');
  s = s.replace(/^# .*\n+(>.*\n)*\n*(---\n)?/, '');
  let partes = secciones(s).filter((p) => !p.titulo || !quitar.some((q) => q.test(p.titulo)));
  if (desenvolver) {
    partes = partes.map((p) => (p.titulo && desenvolver.test(p.titulo)
      ? { ...p, md: p.md.replace(/^##\s+.*\n/, '').replace(/^###(?=\s)/gm, '##').replace(/^####(?=\s)/gm, '###') }
      : p));
  }
  return partes.map((p) => p.md).join('\n').replace(/\n---\s*\n\s*$/, '\n');
}

function construir(opciones = {}) {
  const borradores = !!opciones.borradores;
  const salida = opciones.salida || path.join(WEB, borradores ? 'dist-borradores' : 'dist');
  const rutaReferencias = opciones.referencias !== undefined ? opciones.referencias : (opciones.salida || borradores ? null : path.join(WEB, 'datos', 'referencias.json'));
  const datos = cargarDatos({ borradores });
  if (opciones.ajustarDatos) opciones.ajustarDatos(datos); // solo para las pruebas
  const modelo = construirModelo(datos);
  const { sitio, normas } = datos;

  fs.rmSync(salida, { recursive: true, force: true });
  fs.mkdirSync(salida, { recursive: true });
  const escritos = [];
  const escribir = (rel, contenido) => {
    const destino = path.join(salida, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    escritos.push(rel);
  };
  const conHuella = (dir, nombre, buf) => {
    const ext = path.extname(nombre);
    const final = `${nombre.slice(0, -ext.length)}.${huella(buf)}${ext}`;
    escribir(`${dir}/${final}`, buf);
    return `/${dir}/${final}`;
  };

  // Fuentes propias (OFL) y su licencia.
  const dirFuentes = path.join(RAIZ, 'app', 'public', 'fuentes');
  const fuentes = FUENTES.map(([archivo, familia, estilo, peso, precarga]) => ({ url: conHuella('fuentes', archivo, fs.readFileSync(path.join(dirFuentes, archivo))), familia, estilo, peso, precarga }));
  for (const l of fs.readdirSync(dirFuentes).filter((f) => f.startsWith('LICENCIA')).sort()) escribir(`fuentes/${l}`, fs.readFileSync(path.join(dirFuentes, l)));
  // Los woff2 ya son solo el subconjunto latino (español incluido): sin unicode-range.
  const caras = fuentes.map((f) => `@font-face{font-family:'${f.familia}';font-style:${f.estilo};font-weight:${f.peso};font-display:swap;src:url('${f.url}') format('woff2')}`).join('');
  const css = caras + minificarCss(fs.readFileSync(path.join(WEB, 'css', 'estilos.css'), 'utf8'));
  const js = fs.readFileSync(path.join(WEB, 'js', 'web.js'));

  // Fotos: solo las convertidas con web/fotos.js (si faltan, la web sale igual, sin ellas).
  const fotos = new Map();
  for (const [clave, f] of Object.entries(datos.fotos.fotos)) {
    if (!f.usar || !f.salidas || !f.salidas.length) continue;
    const archivos = f.salidas.map((s) => ({ ...s, ruta: path.join(WEB, 'fotos', s.archivo) }));
    if (!archivos.every((a) => fs.existsSync(a.ruta))) continue;
    fotos.set(clave, { alt: f.alt, salidas: archivos.map((a) => ({ ancho: a.ancho, alto: a.alto, url: conHuella('fotos', a.archivo, fs.readFileSync(a.ruta)) })) });
  }
  const og = datos.fotos.og && fs.existsSync(path.join(WEB, 'fotos', datos.fotos.og.archivo))
    ? { url: `${sitio.dominio}${conHuella('fotos', datos.fotos.og.archivo, fs.readFileSync(path.join(WEB, 'fotos', datos.fotos.og.archivo)))}`, ancho: datos.fotos.og.ancho, alto: datos.fotos.og.alto }
    : null;
  const apple = datos.fotos.icono && fs.existsSync(path.join(WEB, 'fotos', datos.fotos.icono.archivo))
    ? conHuella('fotos', datos.fotos.icono.archivo, fs.readFileSync(path.join(WEB, 'fotos', datos.fotos.icono.archivo)))
    : null;

  // Equipo visible y tecnología publicada.
  const conPagina = new Set(modelo.paginas.flatMap((p) => p.ids));
  const espPublicadas = new Set(modelo.publicadas.map((e) => e.slug));
  const equipoVisible = datos.equipo.personas.filter((p) => (!p.requiere_especialidad || espPublicadas.has(p.requiere_especialidad))
    && (!p.requiere_catalogo || p.requiere_catalogo.some((id) => conPagina.has(id))));
  const aparatosUsados = new Set(modelo.paginas.flatMap((p) => p.ids).map((id) => modelo.porId.get(id)?.equipo_codigo).filter(Boolean));
  const tecnologia = datos.tecnologia.aparatos.filter((a) => aparatosUsados.has(a.codigo));

  const ctx = {
    sitio, datos, modelo, borradores,
    especialidades: modelo.publicadas,
    preocupaciones: modelo.preocupaciones,
    equipoVisible, tecnologia, og,
    recursos: { css: conHuella('recursos', 'estilos.css', Buffer.from(css)), js: conHuella('recursos', 'web.js', js), favicon: conHuella('recursos', 'icono.svg', Buffer.from(FAVICON)), apple },
    fuentes: { precarga: fuentes.filter((f) => f.precarga).map((f) => f.url) },
    foto: (clave) => fotos.get(clave) || null,
  };

  // Rutas que existen y redirecciones (con las anclas que resuelve cada página).
  const rutasLegales = ['/aviso-legal/', '/privacidad/', '/cookies/', '/accesibilidad/'];
  const rutas = new Set(['/', ...modelo.publicadas.map((e) => e.ruta), ...modelo.paginas.map((p) => p.ruta), '/tratamientos/', '/equipo/', '/clinica/', '/tarjetas-regalo/', '/pedir-cita/', ...rutasLegales, '/gracias/']);
  const red = resolverRedirecciones(datos, modelo, rutas);

  // Textos legales.
  const leerLegal = (n) => fs.readFileSync(path.join(WEB, 'contenido', 'legal', n), 'utf8');
  const avisoMd = leerLegal('aviso-legal.md');
  const anexoAcc = secciones(avisoMd).find((s) => s.titulo && /Accesibilidad/.test(s.titulo));
  const legales = [
    { ruta: '/aviso-legal/', titulo: 'Aviso legal', tituloSeo: 'Aviso legal · IEMEC', descripcion: 'Aviso legal de IEMEC: titular, datos de contacto, autorización sanitaria CS17886, profesiones sanitarias, uso de la web y ayudas públicas.', md: textoLegal(avisoMd, { quitar: [/^Anexo/] }) },
    { ruta: '/privacidad/', titulo: 'Política de privacidad', tituloSeo: 'Política de privacidad · IEMEC', descripcion: 'Cómo trata IEMEC tus datos: responsable, finalidades, bases legales, plazos, destinatarios, transferencias y cómo ejercer tus derechos.', md: textoLegal(leerLegal('privacidad.md'), { quitar: [/no se publican/i] }) },
    { ruta: '/cookies/', titulo: 'Política de cookies', tituloSeo: 'Política de cookies · IEMEC', descripcion: 'Esta web no usa cookies de analítica, de publicidad ni de redes sociales, y no necesita tu consentimiento. Qué guarda y cómo borrarlo.', md: textoLegal(leerLegal('cookies.md'), { quitar: [/^Variante B/i], desenvolver: /^Variante A/i }) },
    { ruta: '/accesibilidad/', titulo: 'Accesibilidad', tituloSeo: 'Accesibilidad · IEMEC', descripcion: 'Cómo hemos hecho accesible la web de IEMEC (pautas WCAG 2.2, nivel AA) y cómo avisarnos si encuentras alguna barrera.', md: anexoAcc ? anexoAcc.md.replace(/^##\s+.*\n/, '') : '' },
  ];

  // Páginas.
  const paginas = [];
  const pintar = (p) => {
    p.anclas = red.mapas.get(p.ruta) || null;
    if (p.anclas && !Object.keys(p.anclas).length) p.anclas = null;
    p.html = B.documento(ctx, p);
    paginas.push(p);
  };
  const hacer = (fn, ...args) => { B.empezarPagina(); return fn(ctx, ...args); };
  pintar(hacer(P.inicio));
  for (const e of modelo.publicadas) pintar(hacer(P.especialidad, e));
  for (const e of modelo.publicadas) for (const p of e.paginas) pintar(hacer(P.tratamiento, p));
  pintar(hacer(P.tratamientos));
  pintar(hacer(P.equipoPagina));
  pintar(hacer(P.clinica));
  pintar(hacer(P.tarjetasRegalo));
  pintar(hacer(P.pedirCita));
  for (const l of legales) {
    B.empezarPagina();
    const p = P.legal(ctx, { ...l, contenido: crudo(markdownAHtml(l.md)) });
    p.whatsapp = B.urlWhatsapp(ctx, B.INTERES_GENERAL, p.ref);
    pintar(p);
  }
  pintar(hacer(P.gracias));
  pintar(hacer(P.error404));

  // Revisión: normas, obligatorias, tamaños.
  const errores = [];
  const pendientesObligatorios = [];
  const avisos = [];
  const oblig = (donde) => normas.obligatorias.filter((o) => o.donde === donde);
  for (const p of paginas) {
    for (const f of R.revisarPagina(p.html, p.ruta, normas, { permitir: p.permitirPrecios ? ['precio'] : [] })) errores.push({ tipo: 'normas', ...f });
    const visible = R.textoVisible(p.html);
    const pieHtml = (/<footer[\s\S]*<\/footer>/.exec(p.html) || [''])[0];
    const piePlano = R.textoVisible(`<body>${pieHtml}</body>`);
    for (const o of oblig('todas')) if (!o.re.test(visible)) errores.push({ tipo: 'obligatoria', ruta: p.ruta, donde: 'todas', patron: o.patron });
    for (const o of oblig('pie')) if (!o.re.test(piePlano)) errores.push({ tipo: 'obligatoria', ruta: p.ruta, donde: 'pie', patron: o.patron });
    if (p.medico) for (const o of oblig('tratamiento_medico')) if (!o.re.test(visible)) errores.push({ tipo: 'obligatoria', ruta: p.ruta, donde: 'tratamiento_medico', patron: o.patron });
    if (/data-formulario/.test(p.html)) {
      const form = R.textoVisible(`<body>${(/<form class="formulario"[\s\S]*?<\/form>/.exec(p.html) || [''])[0]}</body>`);
      for (const o of oblig('formulario')) if (!o.re.test(form)) errores.push({ tipo: 'obligatoria', ruta: p.ruta, donde: 'formulario', patron: o.patron });
    }
    if (p.ruta === '/aviso-legal/') {
      for (const o of oblig('aviso_legal')) if (!o.re.test(visible)) pendientesObligatorios.push({ ruta: p.ruta, patron: o.patron, nota: 'Falta en el aviso legal (el correo propio está pendiente de la clínica: falla a propósito hasta que lo haya).' });
    }
    const bytes = Buffer.byteLength(p.html);
    if (bytes > 70 * 1024) errores.push({ tipo: 'tamaño', ruta: p.ruta, bytes, limite: 70 * 1024 });
    const av = avisosEn(visible, normas).map((a) => a.coincidencia);
    if (av.length) avisos.push({ ruta: p.ruta, avisos: [...new Set(av)] });
  }
  if (Buffer.byteLength(css) > 45 * 1024) errores.push({ tipo: 'tamaño', ruta: ctx.recursos.css, bytes: Buffer.byteLength(css), limite: 45 * 1024 });
  if (js.length > 20 * 1024) errores.push({ tipo: 'tamaño', ruta: ctx.recursos.js, bytes: js.length, limite: 20 * 1024 });

  // Escribir páginas.
  for (const p of paginas) escribir(p.ruta === '/404.html' ? '404.html' : `${p.ruta.replace(/^\//, '')}index.html`, p.html);

  // .htaccess, sitemap y robots.
  escribir('.htaccess', htaccess(sitio, red.reglas));
  const indexables = paginas.filter((p) => p.indexable !== false);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexables.map((p) => `  <url><loc>${sitio.dominio}${p.ruta}</loc><lastmod>${sitio.actualizado}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  if (!borradores) escribir('sitemap.xml', sitemap);
  escribir('robots.txt', borradores ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n\nSitemap: ${sitio.dominio}/sitemap.xml\n`);

  // Referencias de WhatsApp para la app: ref → id del catálogo, página y especialidad.
  const referencias = {};
  referencias['web-inicio'] = { catalogo: null, pagina: '/', especialidad: null };
  for (const e of modelo.publicadas) referencias[e.ref] = { catalogo: null, pagina: e.ruta, especialidad: e.slug };
  for (const e of modelo.publicadas) for (const p of e.paginas) referencias[p.ref] = { catalogo: p.principal, pagina: p.ruta, especialidad: p.especialidad, ids: p.ids };
  for (const i of datos.tarjetas.importes) referencias[`web-tarjeta-${i}`] = { catalogo: datos.tarjetas.catalogo, pagina: '/tarjetas-regalo/', especialidad: null, importe: i };
  referencias['web-tarjeta-regalo'] = { catalogo: datos.tarjetas.catalogo, pagina: '/tarjetas-regalo/', especialidad: null };
  referencias['web-tarjeta-canje'] = { catalogo: datos.tarjetas.catalogo, pagina: '/tarjetas-regalo/', especialidad: null, canje: true };
  for (const p of paginas) if (p.ref && !referencias[p.ref]) referencias[p.ref] = { catalogo: null, pagina: p.ruta, especialidad: null };
  const refsOrdenadas = Object.fromEntries(Object.keys(referencias).sort().map((k) => [k, referencias[k]]));

  // Informe (se bloquea en .htaccess: no es para el público).
  const informe = {
    generado_con: 'web/construir.js',
    borradores,
    normas: normas.version,
    paginas: paginas.length,
    tratamientos: modelo.paginas.length,
    especialidades: modelo.publicadas.map((e) => ({ slug: e.slug, nombre: e.nombre, paginas: e.paginas.length })),
    especialidades_sin_paginas: datos.especialidades.especialidades.filter((e) => !espPublicadas.has(e.slug)).map((e) => e.slug),
    cobertura: {
      activos: modelo.activos.length,
      con_pagina: modelo.activos.filter((id) => conPagina.has(id)).length,
      sin_pagina: modelo.sinPagina.length,
      sin_cubrir: modelo.sinCubrir,
    },
    provisionales: modelo.paginas.filter((p) => p.origen === 'provisional').map((p) => ({ ruta: p.ruta, catalogo: p.ids, restringida: p.restringida })),
    borradores_publicados: modelo.paginas.filter((p) => p.origen === 'borrador').map((p) => p.ruta),
    sin_pagina: modelo.sinPagina,
    unidos: modelo.paginas.filter((p) => p.unidos).map((p) => ({ ruta: p.ruta, ids: p.unidos })),
    contenido_pendiente: modelo.paginas.filter((p) => p.origen !== 'provisional' && p.pendiente && p.pendiente.length).map((p) => ({ ruta: p.ruta, pendiente: p.pendiente })),
    revision_medica: modelo.paginas.filter((p) => p.revision_medica).map((p) => p.ruta),
    pendientes_visibles: paginas.map((p) => ({ ruta: p.ruta, n: (R.textoVisible(p.html).match(/\[PENDIENTE/g) || []).length })).filter((x) => x.n),
    redirecciones: red.reglas.map((r) => ({ desde: r.desde, hacia: r.hacia, motivo: r.motivo })),
    anclas: red.anclas,
    errores,
    obligatorias_pendientes: pendientesObligatorios,
    avisos_normas: avisos,
    avisos_generador: modelo.avisos,
    tamanos: {
      html_max: Math.max(...paginas.map((p) => Buffer.byteLength(p.html))),
      css: Buffer.byteLength(css),
      js: js.length,
    },
    fotos: [...fotos.keys()],
    recursos: ctx.recursos,
  };
  escribir('informe.json', `${JSON.stringify(informe, null, 1)}\n`);
  if (rutaReferencias) fs.writeFileSync(rutaReferencias, `${JSON.stringify({ _nota: 'Generado por web/construir.js: la app traduce la «ref. web-…» de cada WhatsApp y de cada formulario a su tratamiento (id del catálogo), su página y su especialidad. Las páginas de lo íntimo y del peso llevan un código en vez del slug.', referencias: refsOrdenadas }, null, 1)}\n`);
  return { ...informe, salida, archivos: escritos.sort(), referencias: refsOrdenadas };
}

if (require.main === module) {
  const o = argumentos(process.argv.slice(2));
  const inf = construir(o);
  if (!o.silencio) {
    console.log(`Web construida en ${path.relative(process.cwd(), inf.salida) || '.'}: ${inf.paginas} páginas (${inf.tratamientos} de tratamiento, ${inf.provisionales.length} provisionales).`);
    console.log(`Catálogo: ${inf.cobertura.con_pagina}/${inf.cobertura.activos} tratamientos activos con página; ${inf.cobertura.sin_pagina} sin página con su motivo; ${inf.cobertura.sin_cubrir.length} sin cubrir.`);
    console.log(`Tamaños: HTML máx. ${(inf.tamanos.html_max / 1024).toFixed(1)} KB · CSS ${(inf.tamanos.css / 1024).toFixed(1)} KB · JS ${(inf.tamanos.js / 1024).toFixed(1)} KB · fotos: ${inf.fotos.length}`);
    if (inf.avisos_generador.length) console.log(`Avisos del generador:\n  ${inf.avisos_generador.join('\n  ')}`);
    if (inf.errores.length) {
      console.error(`ERRORES (${inf.errores.length}):`);
      for (const e of inf.errores.slice(0, 40)) console.error(`  ${JSON.stringify(e)}`);
    }
  }
  process.exitCode = inf.errores.length ? 1 : 0;
}

module.exports = { construir, minificarCss, textoLegal };
