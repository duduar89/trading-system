#!/usr/bin/env node
'use strict';
// Generador de la web pública de IEMEC.
//
//   node web/construir.js                 → web/dist (lo que se sube a public_html)
//   node web/construir.js --borradores    → web/dist-borradores: además, los borradores de
//                                           web/contenido/pendientes con la franja «Borrador»
//   node web/construir.js --salida <dir>  → otra carpeta (las pruebas construyen en una temporal)
//   node web/construir.js --publicar      → la versión para subir: aplica las redacciones neutras de lo
//                                           que puede esperar (web/datos/lanzamiento.json, clase «b»),
//                                           sin marcas amarillas, notas ni borradores; si falta algo
//                                           imprescindible (clase «a»), falla con la lista y no deja
//                                           nada que subir (solo informe.json)
//   node web/construir.js --publicar --zip <archivo.zip>
//                                         → además, el .zip para «Cargar» y «Extraer» en public_html
//                                           (con el .htaccess y sin informe.json)
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
const { rellenarLegal } = require('./lib/legal');
const LZ = require('./lib/lanzamiento');
const { crearZip } = require('./lib/zip');

const FUENTES = [
  ['montserrat-latin-300-normal.woff2', 'Montserrat', 'normal', 300],
  ['montserrat-latin-400-normal.woff2', 'Montserrat', 'normal', 400, true],
  ['montserrat-latin-500-normal.woff2', 'Montserrat', 'normal', 500],
  ['montserrat-latin-600-normal.woff2', 'Montserrat', 'normal', 600],
  ['playfair-display-latin-500-normal.woff2', 'Playfair Display', 'normal', 500],
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

// web.js se escribe con comentarios de sobra (es ES5, sin plantillas de texto): fuera las líneas que
// son solo un comentario, el bloque del principio y la sangría. Nada que cambie lo que hace.
function minificarJs(js) {
  return js.replace(/^\/\*[\s\S]*?\*\/\n/, '')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n') + '\n';
}

function argumentos(argv) {
  const o = { borradores: argv.includes('--borradores'), silencio: argv.includes('--silencio'), publicar: argv.includes('--publicar') };
  const i = argv.indexOf('--salida');
  if (i !== -1) o.salida = path.resolve(argv[i + 1]);
  const j = argv.indexOf('--referencias');
  if (j !== -1) o.referencias = path.resolve(argv[j + 1]);
  const k = argv.indexOf('--zip');
  if (k !== -1) o.zip = path.resolve(argv[k + 1]);
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
  const publicar = !!opciones.publicar;
  const salida = opciones.salida || path.join(WEB, borradores ? 'dist-borradores' : 'dist');
  // Las referencias van con la app (semillas/, que se despliega; web/ no): las usa POST /web/contacto.
  const rutaReferencias = opciones.referencias !== undefined ? opciones.referencias : (opciones.salida || borradores ? null : path.join(RAIZ, 'semillas', 'iemec', 'referencias-web.json'));
  const datos = cargarDatos({ borradores });
  if (opciones.ajustarDatos) opciones.ajustarDatos(datos); // solo para las pruebas
  // Al publicar, lo que puede esperar (clase «b») sale con su redacción neutra.
  const redacciones = publicar ? LZ.aplicarRedacciones(datos, datos.lanzamiento) : [];
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
  const conHuellaSinEscribir = (dir, nombre, buf) => {
    const ext = path.extname(nombre);
    return `/${dir}/${nombre.slice(0, -ext.length)}.${huella(buf)}${ext}`;
  };
  const conHuella = (dir, nombre, buf) => {
    const url = conHuellaSinEscribir(dir, nombre, buf);
    escribir(url.slice(1), buf);
    return url;
  };

  // Fuentes propias (OFL) y su licencia.
  const dirFuentes = path.join(RAIZ, 'app', 'public', 'fuentes');
  const fuentes = FUENTES.map(([archivo, familia, estilo, peso, precarga]) => ({ url: conHuella('fuentes', archivo, fs.readFileSync(path.join(dirFuentes, archivo))), familia, estilo, peso, precarga }));
  for (const l of fs.readdirSync(dirFuentes).filter((f) => f.startsWith('LICENCIA')).sort()) escribir(`fuentes/${l}`, fs.readFileSync(path.join(dirFuentes, l)));
  // Los woff2 ya son solo el subconjunto latino (español incluido): sin unicode-range.
  const caras = fuentes.map((f) => `@font-face{font-family:'${f.familia}';font-style:${f.estilo};font-weight:${f.peso};font-display:swap;src:url('${f.url}') format('woff2')}`).join('');
  const css = caras + minificarCss(fs.readFileSync(path.join(WEB, 'css', 'estilos.css'), 'utf8'));
  const js = Buffer.from(minificarJs(fs.readFileSync(path.join(WEB, 'js', 'web.js'), 'utf8')));

  // Fotos: solo las convertidas con web/fotos.js (si faltan, la web sale igual, sin ellas). Se copian
  // a la salida solo las que usa alguna página (un retrato de quien no sale en la web, no).
  const fotos = new Map();
  const fotosUsadas = new Set();
  for (const [clave, f] of Object.entries(datos.fotos.fotos)) {
    if (!f.usar || !f.salidas || !f.salidas.length) continue;
    const archivos = f.salidas.map((s) => ({ ...s, ruta: path.join(WEB, 'fotos', s.archivo) }));
    if (!archivos.every((a) => fs.existsSync(a.ruta))) continue;
    fotos.set(clave, {
      alt: f.alt,
      salidas: archivos.map((a) => {
        const buf = fs.readFileSync(a.ruta);
        return { ancho: a.ancho, alto: a.alto, url: conHuellaSinEscribir('fotos', a.archivo, buf), buf };
      }),
    });
  }
  const og = datos.fotos.og && fs.existsSync(path.join(WEB, 'fotos', datos.fotos.og.archivo))
    ? { url: `${sitio.dominio}${conHuella('fotos', datos.fotos.og.archivo, fs.readFileSync(path.join(WEB, 'fotos', datos.fotos.og.archivo)))}`, ancho: datos.fotos.og.ancho, alto: datos.fotos.og.alto }
    : null;
  const apple = datos.fotos.icono && fs.existsSync(path.join(WEB, 'fotos', datos.fotos.icono.archivo))
    ? conHuella('fotos', datos.fotos.icono.archivo, fs.readFileSync(path.join(WEB, 'fotos', datos.fotos.icono.archivo)))
    : null;
  // El emblema oficial «Cofinanciado por la Unión Europea» del aviso del FSE+ (web/emblemas/, en git).
  const rutaEmblema = sitio.fse && sitio.fse.emblema ? path.join(WEB, sitio.fse.emblema.archivo) : null;
  const emblema = rutaEmblema && fs.existsSync(rutaEmblema) ? conHuella('recursos', path.basename(rutaEmblema), fs.readFileSync(rutaEmblema)) : null;

  // Equipo visible y tecnología publicada.
  const conPagina = new Set(modelo.paginas.flatMap((p) => p.ids));
  const espPublicadas = new Set(modelo.publicadas.map((e) => e.slug));
  const equipoVisible = datos.equipo.personas.filter((p) => (!p.requiere_especialidad || espPublicadas.has(p.requiere_especialidad))
    && (!p.requiere_catalogo || p.requiere_catalogo.some((id) => conPagina.has(id))));
  const aparatosUsados = new Set(modelo.paginas.flatMap((p) => p.ids).map((id) => modelo.porId.get(id)?.equipo_codigo).filter(Boolean));
  const tecnologia = datos.tecnologia.aparatos.filter((a) => aparatosUsados.has(a.codigo));

  const ctx = {
    sitio, datos, modelo, borradores, publicar,
    especialidades: modelo.publicadas,
    preocupaciones: modelo.preocupaciones,
    equipoVisible, tecnologia, og,
    recursos: { css: conHuella('recursos', 'estilos.css', Buffer.from(css)), js: conHuella('recursos', 'web.js', js), favicon: conHuella('recursos', 'icono.svg', Buffer.from(FAVICON)), apple, emblema },
    fuentes: { precarga: fuentes.filter((f) => f.precarga).map((f) => f.url) },
    foto: (clave) => {
      const f = fotos.get(clave);
      if (f) fotosUsadas.add(clave);
      return f || null;
    },
  };

  // Rutas que existen y redirecciones (con las anclas que resuelve cada página).
  const rutasLegales = ['/aviso-legal/', '/privacidad/', '/cookies/', '/accesibilidad/'];
  const rutas = new Set(['/', ...modelo.publicadas.map((e) => e.ruta), ...modelo.paginas.map((p) => p.ruta), '/tratamientos/', '/equipo/', '/clinica/', '/tarjetas-regalo/', '/pedir-cita/', ...rutasLegales, '/gracias/']);
  const red = resolverRedirecciones(datos, modelo, rutas);

  // Textos legales, con sus datos: correo, DPD, profesionales (solo quien sale en la web, como en
  // «Equipo»), responsable asistencial y fechas (web/lib/legal.js).
  const leerLegal = (n) => rellenarLegal(datos.legales[n], datos, { personas: equipoVisible, publicar });
  const avisoMd = leerLegal('aviso-legal.md');
  const anexoAcc = secciones(avisoMd).find((s) => s.titulo && /Accesibilidad/.test(s.titulo));
  const legales = [
    { ruta: '/aviso-legal/', titulo: 'Aviso legal', tituloSeo: 'Aviso legal · IEMEC', descripcion: 'Aviso legal de IEMEC: titular, datos de contacto, autorización sanitaria CS17886, profesiones sanitarias, uso de la web y ayudas públicas.', md: textoLegal(avisoMd, { quitar: [/^Anexo/] }) },
    { ruta: '/privacidad/', titulo: 'Política de privacidad', tituloSeo: 'Política de privacidad · IEMEC', descripcion: 'Cómo trata IEMEC tus datos: responsable, finalidades, bases legales, plazos, destinatarios, transferencias y cómo ejercer tus derechos.', md: textoLegal(leerLegal('privacidad.md'), { quitar: [/no se publican/i] }) },
    { ruta: '/cookies/', titulo: 'Política de cookies', tituloSeo: 'Política de cookies · IEMEC', descripcion: 'Esta web no usa cookies de analítica, de publicidad ni de redes sociales, y no necesita tu consentimiento. Qué guarda y cómo borrarlo.', md: textoLegal(leerLegal('cookies.md'), { quitar: [/^Variante B/i], desenvolver: /^Variante A/i }) },
    { ruta: '/accesibilidad/', titulo: 'Accesibilidad', tituloSeo: 'Accesibilidad · IEMEC', descripcion: 'Cómo hemos hecho accesible la web de IEMEC (pautas WCAG 2.2, nivel AA) y cómo avisarnos si encuentras alguna barrera.', md: anexoAcc ? anexoAcc.md.replace(/^##\s+.*\n/, '').replace(/^\s*\*\*Accesibilidad\.\*\*\s*/, '') : '' },
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
    const p = P.legal(ctx, { ...l, contenido: crudo(markdownAHtml(l.md, { publicar })) });
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
  // Lo que falta por confirmar y se ve en la web, clasificado con web/datos/lanzamiento.json.
  const marcas = paginas.map((p) => ({ ruta: p.ruta, lista: R.textoVisible(p.html).match(/\[PENDIENTE[^\]]*\]/g) || [] })).filter((x) => x.lista.length);
  const porTexto = new Map();
  for (const x of marcas) for (const m of x.lista) { if (!porTexto.has(m)) porTexto.set(m, new Set()); porTexto.get(m).add(x.ruta); }
  const lanzamiento = LZ.estado(datos.lanzamiento, { marcas, obligatoriasPendientes: pendientesObligatorios, publicar });
  const datoDe = LZ.clasificador(datos.lanzamiento);
  if (publicar) {
    // Lo imprescindible que falta, una vez por dato (con cuántas páginas y dónde se pone).
    for (const i of lanzamiento.imprescindibles) errores.push({ tipo: 'imprescindible', ...i });
    for (const x of lanzamiento.sin_neutralizar) errores.push({ tipo: 'sin_redaccion_neutra', ...x, nota: 'Una marca de un dato que no es imprescindible sigue a la vista: falta su redacción neutra en lanzamiento.json o en el generador.' });
    for (const x of lanzamiento.sin_clasificar) errores.push({ tipo: 'sin_clasificar', ...x, nota: 'Marca [PENDIENTE] que no está en web/datos/lanzamiento.json: clasifícala (a, b o c).' });
    if (borradores) errores.push({ tipo: 'borradores', nota: 'La vista previa con borradores no se publica nunca.' });
    // Nada de trabajo a la vista: notas, franjas, provisionales, plantillas sin rellenar (y marcas en
    // atributos o en el <head>, que no son texto visible).
    for (const p of paginas) {
      const visibles = marcas.some((x) => x.ruta === p.ruta);
      const trabajo = LZ.textosDeTrabajo(p.html).filter((t) => !(visibles && /marca/.test(t)));
      if (trabajo.length) errores.push({ tipo: 'texto_de_trabajo', ruta: p.ruta, textos: trabajo });
    }
  }
  if (Buffer.byteLength(css) > 45 * 1024) errores.push({ tipo: 'tamaño', ruta: ctx.recursos.css, bytes: Buffer.byteLength(css), limite: 45 * 1024 });
  if (Buffer.byteLength(js) > 20 * 1024) errores.push({ tipo: 'tamaño', ruta: ctx.recursos.js, bytes: Buffer.byteLength(js), limite: 20 * 1024 });

  // Escribir páginas y las fotos que usan.
  for (const p of paginas) escribir(p.ruta === '/404.html' ? '404.html' : `${p.ruta.replace(/^\//, '')}index.html`, p.html);
  for (const clave of [...fotosUsadas].sort()) for (const s of fotos.get(clave).salidas) escribir(s.url.slice(1), s.buf);
  // Al publicar, cada enlace interno lleva a una página o un recurso que se sube (ni borradores ni
  // páginas que no existen).
  if (publicar) {
    const existe = (u) => {
      const [ruta] = u.split(/[?#]/);
      if (!ruta || ruta === '/') return true;
      return ruta.endsWith('/') ? fs.existsSync(path.join(salida, ruta, 'index.html')) : fs.existsSync(path.join(salida, ruta));
    };
    for (const p of paginas) {
      const rotos = [...new Set(R.enlaces(p.html).map((e) => e.valor).filter((v) => v.startsWith('/') && !v.startsWith('//') && !existe(v)))];
      if (rotos.length) errores.push({ tipo: 'enlace_roto', ruta: p.ruta, enlaces: rotos.slice(0, 5) });
    }
  }

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
    pendientes_visibles: marcas.map((x) => ({ ruta: x.ruta, n: x.lista.length })),
    pendientes_textos: [...porTexto].map(([texto, rutas]) => {
      const d = datoDe(texto);
      return { texto, paginas: rutas.size, ejemplo: [...rutas][0], dato: d ? d.id : null, clase: d ? d.clase : null };
    }).sort((a, b) => b.paginas - a.paginas || a.texto.localeCompare(b.texto, 'es')),
    // Qué falta para publicar (web/datos/lanzamiento.json): cada dato con su clase y cuántas marcas
    // quedan, los imprescindibles sin resolver y, al publicar, las redacciones neutras aplicadas.
    lanzamiento: {
      publicar,
      publicable: null,
      clases: LZ.CLASES,
      imprescindibles: lanzamiento.imprescindibles,
      datos: lanzamiento.resumen,
      sin_clasificar: lanzamiento.sin_clasificar,
      vistos_buenos: datos.lanzamiento.vistos_buenos,
      redacciones: redacciones.map((r) => ({ dato: r.dato, ...(r.archivo ? { archivo: r.archivo } : { quitar: r.quitar }), veces: r.veces })),
    },
    redirecciones: red.reglas.map((r) => ({ desde: r.desde, hacia: r.hacia, motivo: r.motivo })),
    anclas: red.anclas,
    errores,
    obligatorias_pendientes: pendientesObligatorios,
    avisos_normas: avisos,
    avisos_generador: modelo.avisos,
    tamanos: {
      html_max: Math.max(...paginas.map((p) => Buffer.byteLength(p.html))),
      css: Buffer.byteLength(css),
      js: Buffer.byteLength(js),
    },
    fotos: [...fotosUsadas].sort(),
    recursos: ctx.recursos,
  };
  informe.lanzamiento.publicable = publicar ? errores.length === 0 : null;
  // Si no se puede publicar, no se deja nada que se pueda subir por error: solo el informe.
  if (publicar && errores.length) {
    fs.rmSync(salida, { recursive: true, force: true });
    fs.mkdirSync(salida, { recursive: true });
    escritos.length = 0;
  }
  escribir('informe.json', `${JSON.stringify(informe, null, 1)}\n`);
  let zip = null;
  if (opciones.zip) {
    if (!publicar) throw new Error('--zip solo con --publicar: el .zip es la versión para subir.');
    if (!errores.length) zip = { archivo: opciones.zip, ...crearZip(salida, opciones.zip, { excluir: ['informe.json'], fecha: sitio.actualizado }) };
  }
  const grupos = Object.fromEntries(B.gruposInteres(ctx).map((g) => [g.valor, g.texto]));
  if (rutaReferencias) fs.writeFileSync(rutaReferencias, `${JSON.stringify({ _nota: 'Generado por web/construir.js (no se edita a mano): la app traduce la «ref. web-…» de cada WhatsApp y de cada formulario a su tratamiento (id del catálogo), su página y su especialidad. Las páginas de lo íntimo y del peso llevan un código en vez del slug. «grupos»: los valores del «¿Qué te interesa?» del formulario y su texto neutro.', referencias: refsOrdenadas, grupos }, null, 1)}\n`);
  return { ...informe, salida, archivos: escritos.sort(), referencias: refsOrdenadas, grupos, zip };
}

// La lista de lo imprescindible, para leerla en la terminal.
function explicarImprescindibles(inf) {
  const lineas = [];
  const imp = inf.errores.filter((e) => e.tipo === 'imprescindible');
  if (imp.length) {
    lineas.push(`No se puede publicar todavía: falta lo imprescindible (${imp.length}).`);
    imp.forEach((e, i) => {
      lineas.push(`  ${i + 1}. ${e.titulo} · ${e.responsable}${e.paginas ? ` · ${e.paginas} ${e.paginas === 1 ? 'página' : 'páginas'} (p. ej. ${e.ejemplo})` : ''}`);
      lineas.push(`     Falta: ${e.falta}`);
      lineas.push(`     Se pone en: ${e.como_completar}`);
    });
    lineas.push('  Qué pedir y a quién: docs/LANZAR-WEB.md · detalle: informe.json → lanzamiento.');
  }
  return lineas;
}

if (require.main === module) {
  const o = argumentos(process.argv.slice(2));
  const inf = construir(o);
  if (!o.silencio) {
    // Relativa si cae dentro de la carpeta actual; si no, entera (--salida en otra parte).
    const ruta = (p) => { const r = path.relative(process.cwd(), p); return r.startsWith('..') ? p : r || '.'; };
    const donde = ruta(inf.salida);
    if (o.publicar && inf.errores.length) {
      console.error(explicarImprescindibles(inf).join('\n'));
      const otros = inf.errores.filter((e) => e.tipo !== 'imprescindible');
      if (otros.length) {
        console.error(`Otros errores (${otros.length}):`);
        for (const e of otros.slice(0, 40)) console.error(`  ${JSON.stringify(e)}`);
      }
      console.error(`${donde} se ha vaciado (solo queda informe.json) para que no se suba nada a medias; «npm run web» vuelve a hacer la vista previa.`);
    } else {
      console.log(`Web ${o.publicar ? 'publicable ' : ''}construida en ${donde}: ${inf.paginas} páginas (${inf.tratamientos} de tratamiento, ${inf.provisionales.length} provisionales).`);
      console.log(`Catálogo: ${inf.cobertura.con_pagina}/${inf.cobertura.activos} tratamientos activos con página; ${inf.cobertura.sin_pagina} sin página con su motivo; ${inf.cobertura.sin_cubrir.length} sin cubrir.`);
      console.log(`Tamaños: HTML máx. ${(inf.tamanos.html_max / 1024).toFixed(1)} KB · CSS ${(inf.tamanos.css / 1024).toFixed(1)} KB · JS ${(inf.tamanos.js / 1024).toFixed(1)} KB · fotos: ${inf.fotos.length}`);
      if (inf.avisos_generador.length) console.log(`Avisos del generador:\n  ${inf.avisos_generador.join('\n  ')}`);
      if (!o.publicar) {
        const a = inf.lanzamiento.imprescindibles.length;
        const lista = inf.lanzamiento.imprescindibles.map((i) => i.dato).join(', ');
        const falta = a === 1 ? `falta 1 imprescindible (${lista})` : `faltan ${a} imprescindibles (${lista})`;
        console.log(`Lanzamiento: ${a ? falta : 'no falta nada imprescindible'}; «node web/construir.js --publicar» hace la versión para subir.`);
      }
      if (inf.zip) console.log(`Zip para subir: ${ruta(inf.zip.archivo)} (${inf.zip.archivos} archivos, ${(inf.zip.bytes / 1024 / 1024).toFixed(1)} MB, con el .htaccess y sin informe.json).`);
      if (inf.errores.length) {
        console.error(`ERRORES (${inf.errores.length}):`);
        for (const e of inf.errores.slice(0, 40)) console.error(`  ${JSON.stringify(e)}`);
      }
    }
  }
  process.exitCode = inf.errores.length ? 1 : 0;
}

module.exports = { construir, minificarCss, minificarJs, textoLegal, explicarImprescindibles };
