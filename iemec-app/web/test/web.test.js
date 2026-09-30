'use strict';
// Pruebas de la web pública (sin base de datos): se construye en una carpeta temporal y se revisa lo
// que saldría a public_html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { construir } = require('../construir');
const { cargarNormas, prohibidasEn } = require('../lib/normas');
const { huellaCorta } = require('../lib/modelo');
const R = require('../lib/revision');
const { crearServidor } = require('../servir');

const CATALOGO = require('../../semillas/iemec/tratamientos.json');
const REDIRECCIONES = require('../datos/redirecciones.json');
const SITIO = require('../datos/sitio.json');
const normas = cargarNormas();
const temporal = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `iemec-web-${n}-`));

let SALIDA;
let INFORME;
let PAGINAS; // ruta → html
test.before(() => {
  SALIDA = temporal('dist');
  INFORME = construir({ salida: SALIDA, referencias: path.join(SALIDA, '..', `${path.basename(SALIDA)}-referencias.json`) });
  PAGINAS = new Map();
  const recorrer = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, f.name);
      if (f.isDirectory()) recorrer(ruta);
      else if (f.name.endsWith('.html')) {
        const rel = `/${path.relative(SALIDA, ruta).split(path.sep).join('/')}`;
        PAGINAS.set(rel === '/404.html' ? rel : rel.replace(/index\.html$/, ''), fs.readFileSync(ruta, 'utf8'));
      }
    }
  };
  recorrer(SALIDA);
});

test('el generador construye sin errores y el informe lo cuenta todo', () => {
  assert.deepEqual(INFORME.errores, [], JSON.stringify(INFORME.errores.slice(0, 5)));
  assert.ok(PAGINAS.size > 60, `solo ${PAGINAS.size} páginas`);
  for (const r of ['/', '/tratamientos/', '/equipo/', '/clinica/', '/tarjetas-regalo/', '/pedir-cita/', '/aviso-legal/', '/privacidad/', '/cookies/', '/accesibilidad/', '/gracias/', '/404.html']) {
    assert.ok(PAGINAS.has(r), `falta ${r}`);
  }
  const informe = JSON.parse(fs.readFileSync(path.join(SALIDA, 'informe.json'), 'utf8'));
  assert.equal(informe.paginas, PAGINAS.size);
});

function comprobarCobertura(informe) {
  const sinPagina = new Map(informe.sin_pagina.map((s) => [s.catalogo, s]));
  const idsEnPaginas = new Set(Object.values(informe.referencias).flatMap((r) => r.ids || []));
  for (const t of CATALOGO.tratamientos.filter((x) => x.activo)) {
    const motivo = sinPagina.get(t.id);
    assert.ok(idsEnPaginas.has(t.id) || (motivo && motivo.motivo && motivo.motivo.length > 10), `${t.id} no tiene página ni motivo`);
  }
  assert.deepEqual(informe.cobertura.sin_cubrir, []);
}

test('todo tratamiento activo del catálogo tiene página (propia o provisional) o un motivo para no tenerla', () => {
  comprobarCobertura(INFORME);
});

test('sin el texto de un grupo, sus tratamientos salen como provisionales: nombre neutro, informe y normas', () => {
  const c = temporal('provisionales');
  const inf = construir({ salida: c, referencias: null, ajustarDatos: (datos) => { datos.contenidos = datos.contenidos.filter((f) => f.grupo !== 'capilar' && f.grupo !== 'facial-medica'); } });
  assert.deepEqual(inf.errores, [], JSON.stringify(inf.errores.slice(0, 3)));
  comprobarCobertura(inf);
  assert.ok(inf.provisionales.length >= 10, `${inf.provisionales.length} provisionales`);
  for (const p of inf.provisionales) {
    const h = fs.readFileSync(path.join(c, p.ruta, 'index.html'), 'utf8');
    assert.match(h, /página provisional/);
    assert.deepEqual(R.revisarPagina(h, p.ruta, normas), [], p.ruta);
    if (p.restringida) assert.match(R.textoVisible(h), /requiere valoración médica previa/);
  }
  // Los ids de medicamentos van a páginas con nombre neutro (anexo B de normas.md).
  const arrugas = inf.provisionales.find((p) => p.catalogo.includes('toxina-botulinica-facial'));
  assert.equal(arrugas.ruta, '/medicina-estetica-facial/arrugas-de-expresion/');
  const caida = inf.provisionales.find((p) => p.catalogo.includes('prp-capilar'));
  assert.equal(caida.ruta, '/medicina-capilar/caida-del-cabello/');
  // Lo que el catálogo da por no confirmado no tiene provisional.
  assert.ok(!inf.provisionales.some((p) => p.catalogo.includes('micropigmentacion')));
  assert.ok(inf.sin_pagina.some((s) => s.catalogo === 'micropigmentacion'));
  fs.rmSync(c, { recursive: true, force: true });
});

test('lo que la autorización no cubre, lo que no se confirma y lo pendiente no se publica ni se enlaza', () => {
  const noPublicar = ['laser-condilomas', 'laser-incontinencia-urinaria', 'laser-atrofia-vaginal', 'laser-liquen-escleroatrofico', 'prp-intimo', 'cirugia-suelo-pelvico', 'semaglutida', 'tirzepatida-mounjaro', 'varices-ecoesclerosis', 'dietetica-nutricion', 'cirugia-bariatrica'];
  const idsPublicados = new Set(Object.values(INFORME.referencias).flatMap((r) => r.ids || []));
  for (const id of noPublicar) assert.ok(!idsPublicados.has(id), `${id} no debería tener página`);
  // Los borradores de contenido/pendientes no salen sin --borradores.
  for (const ruta of ['/perdida-de-peso/control-de-peso/', '/medicina-estetica-corporal/varices-y-aranas-vasculares/']) {
    assert.ok(!PAGINAS.has(ruta), `${ruta} no debería publicarse`);
    for (const [r, h] of PAGINAS) assert.ok(!h.includes(`href="${ruta}"`), `${r} enlaza a ${ruta}`);
  }
});

test('cada enlace interno lleva a una página, un recurso o un ancla que existe', () => {
  const existe = (url) => {
    const [ruta] = url.split(/[?#]/);
    if (ruta === '/' || ruta.endsWith('/')) return fs.existsSync(path.join(SALIDA, ruta, 'index.html'));
    return fs.existsSync(path.join(SALIDA, ruta));
  };
  for (const [ruta, h] of PAGINAS) {
    const ids = new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const e of R.enlaces(h)) {
      const v = e.valor;
      if (v.startsWith('#')) { assert.ok(ids.has(v.slice(1)), `${ruta}: ancla rota ${v}`); continue; }
      if (!v.startsWith('/')) continue;
      assert.ok(existe(v), `${ruta}: enlace roto ${v}`);
      const ancla = v.split('#')[1];
      if (ancla && v.split('#')[0] !== '') {
        const destino = PAGINAS.get(v.split('#')[0].split('?')[0]);
        assert.ok(destino && destino.includes(`id="${ancla}"`), `${ruta}: ancla rota ${v}`);
      }
    }
  }
});

test('cada página: un H1, título de 65 caracteres o menos, descripción de 70 a 160, canonical y lang="es"', () => {
  for (const [ruta, h] of PAGINAS) {
    assert.equal(R.h1s(h), 1, `${ruta}: ${R.h1s(h)} H1`);
    const t = R.titulo(h);
    assert.ok(t.length > 0 && t.length <= 65, `${ruta}: título de ${t.length} (${t})`);
    const d = R.meta(h, 'description');
    assert.ok(d.length >= 70 && d.length <= 160, `${ruta}: descripción de ${d.length}`);
    assert.match(h, /^<!doctype html>\n<html lang="es">/);
    const c = R.canonical(h);
    assert.ok(c.startsWith('https://iemec-clinic.com/'), `${ruta}: canonical ${c}`);
    if (ruta !== '/404.html') assert.equal(c, `https://iemec-clinic.com${ruta}`);
    assert.match(h, /<meta name="viewport"/);
  }
});

test('ningún patrón prohibido de normas.json en el texto visible, las URL, los atributos, el JSON-LD ni los WhatsApp', () => {
  for (const [ruta, h] of PAGINAS) {
    const permitir = ruta === '/tarjetas-regalo/' ? ['precio'] : [];
    const fallos = R.revisarPagina(h, ruta, normas, { permitir });
    assert.deepEqual(fallos, [], `${ruta}: ${JSON.stringify(fallos.slice(0, 3))}`);
  }
  // También los nombres de los archivos que se publican.
  const archivos = [];
  const recorrer = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { if (f.isDirectory()) recorrer(path.join(dir, f.name)); else archivos.push(path.relative(SALIDA, path.join(dir, f.name))); } };
  recorrer(SALIDA);
  for (const a of archivos) assert.deepEqual(prohibidasEn(a.replace(/[-_/.]+/g, ' '), normas), [], `archivo ${a}`);
});

test('el validador JS dice lo mismo que el de Python también con tildes (límites de palabra Unicode)', () => {
  // Resultados de validar-contenido.py (re.I) sobre las mismas frases.
  const casos = [
    ['La mejoría suele notarse tras las primeras sesiones', false], ['la mejor opción para ti', true], ['los mejores resultados', true],
    ['definitivamente', false], ['depilación definitiva', true], ['aparcamiento gratuito', false], ['es gratuita', true],
    ['una promoción de la salud', false], ['oferta asistencial', false], ['Botox preventivo', true], ['Nº 1 en Madrid', true],
    ['tarjeta de regalo', true], ['Tarjeta regalo de 45 €', true], ['toxina botulínica', true], ['microinjerto de cejas', false],
  ];
  for (const [frase, prohibida] of casos) assert.equal(prohibidasEn(frase, normas).length > 0, prohibida, frase);
  assert.equal(prohibidasEn('Tarjeta regalo de 45 €', normas, ['precio']).length, 0);
});

test('cada WhatsApp lleva «(ref. web-…)», un texto limpio y una referencia que la app sabe traducir', () => {
  const refs = INFORME.referencias;
  const refsFichero = JSON.parse(fs.readFileSync(path.join(SALIDA, '..', `${path.basename(SALIDA)}-referencias.json`), 'utf8')).referencias;
  assert.deepEqual(refsFichero, refs);
  let vistos = 0;
  for (const [ruta, h] of PAGINAS) {
    for (const w of R.whatsapps(h)) {
      vistos++;
      assert.ok(w.url.startsWith(`https://wa.me/${SITIO.whatsapp.numero}?text=`), w.url);
      const m = /^Hola, vengo de la web y me interesa: (.+)\. \(ref\. (web-[a-z0-9-]+)\)$/.exec(w.texto);
      assert.ok(m, `${ruta}: texto de WhatsApp raro: ${w.texto}`);
      assert.ok(refs[m[2]], `${ruta}: la referencia ${m[2]} no está en referencias.json`);
      assert.deepEqual(prohibidasEn(w.texto, normas, ruta === '/tarjetas-regalo/' ? ['precio'] : []), [], w.texto);
      // Nunca un id del catálogo en la referencia (hay ids con nombre de medicamento).
      assert.ok(!/web-(toxina|semaglutida|prp|profhilo|tirzepatida)/.test(m[2]), m[2]);
    }
  }
  assert.ok(vistos > PAGINAS.size);
  // La página de un tratamiento lleva su propia referencia; las de lo íntimo y el peso, un código
  // (y su grupo neutro en el texto), no el nombre del tratamiento.
  const lipo = R.whatsapps(PAGINAS.get('/medicina-estetica-corporal/lipolaser/'));
  assert.ok(lipo.some((w) => w.texto.endsWith('me interesa: Lipoláser. (ref. web-lipolaser)')));
  for (const [ref, r] of Object.entries(refs)) {
    if (!r.pagina || !/^\/(ginecologia-estetica|salud-sexual-masculina|perdida-de-peso)\/[^/]+\/$/.test(r.pagina)) continue;
    assert.match(ref, /^web-(intima-f|intima-m|peso)-[0-9a-z]+$/, `${r.pagina} → ${ref}`);
    for (const w of R.whatsapps(PAGINAS.get(r.pagina))) {
      assert.ok(!w.texto.includes(r.pagina.split('/')[2]), `${r.pagina}: el WhatsApp nombra el tratamiento`);
      assert.match(w.texto, /me interesa: (Salud íntima femenina|Salud íntima masculina|Control de peso|una primera valoración)\./);
    }
  }
  assert.equal(refs['web-inicio'].pagina, '/');
  assert.equal(refs['web-medicina-estetica-facial'].especialidad, 'medicina-estetica-facial');
  for (const i of [45, 70, 140, 250]) assert.equal(refs[`web-tarjeta-${i}`].importe, i);
});

test('datos estructurados: se parsean, MedicalClinic en todas, migas en las interiores y el tratamiento sin valoraciones', () => {
  for (const [ruta, h] of PAGINAS) {
    const bloques = R.jsonld(h);
    assert.equal(bloques.length, 1, ruta);
    const ld = JSON.parse(bloques[0]);
    assert.equal(ld['@context'], 'https://schema.org');
    const tipos = ld['@graph'].map((n) => n['@type']);
    assert.ok(tipos.includes('MedicalClinic'), ruta);
    const clinica = ld['@graph'].find((n) => n['@type'] === 'MedicalClinic');
    assert.equal(clinica.telephone, '+34722833285');
    assert.equal(clinica.address.postalCode, '28660');
    assert.ok(clinica.geo.latitude && clinica.openingHoursSpecification.length);
    assert.ok(!JSON.stringify(ld).includes('aggregateRating') && !JSON.stringify(ld).includes('"review'), `${ruta}: valoraciones en el marcado`);
    if (ruta !== '/' && ruta !== '/404.html' && ruta !== '/gracias/') assert.ok(tipos.includes('BreadcrumbList'), `${ruta}: sin migas`);
    if (/^\/[^/]+\/[^/]+\/$/.test(ruta)) assert.ok(tipos.includes('MedicalProcedure') || tipos.includes('Service'), `${ruta}: sin tratamiento`);
  }
});

test('.htaccess: un 301 por cada URL vieja, sin bucles, hacia páginas que existen', () => {
  const ht = fs.readFileSync(path.join(SALIDA, '.htaccess'), 'utf8');
  const reglas = [...ht.matchAll(/^\s*RewriteRule "([^"]+)" "([^"]+)" \[R=301,L,NC\]$/gm)].map((m) => ({ re: new RegExp(m[1], 'i'), hacia: m[2] }));
  const aplicar = (url) => { const r = reglas.find((x) => x.re.test(url.replace(/^\//, ''))); return r ? r.hacia : null; };
  for (const r of REDIRECCIONES.redirecciones) {
    const variantes = [r.desde, r.desde.toUpperCase()];
    if (!r.desde.endsWith('/')) variantes.push(`${r.desde}/`);
    for (const v of variantes) {
      const destino = aplicar(v);
      const esLaMisma = v.toLowerCase().replace(/\/$/, '') === (destino || '').replace(/\/$/, '');
      if (v.endsWith('/') && !destino && PAGINAS.has(v.toLowerCase())) continue; // ya es la página nueva
      assert.ok(destino, `${v} no tiene 301`);
      assert.ok(!esLaMisma || !v.endsWith('/'), `${v}: bucle`);
      assert.ok(PAGINAS.has(destino), `${v} → ${destino}, que no existe`);
      assert.equal(aplicar(destino), null, `${destino} vuelve a redirigir`);
    }
  }
  assert.match(ht, /RewriteRule \^ https:\/\/iemec-clinic\.com%\{REQUEST_URI\} \[R=301,L,NE\]/);
  assert.match(ht, /Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'/);
  assert.match(ht, /max-age=31536000, immutable/);
  assert.match(ht, /DEFLATE/);
  assert.match(ht, /<Files "informe.json">\s*Require all denied/);
  // Las promociones con precio ya no existen: van a las tarjetas regalo.
  assert.equal(aplicar('/promociones'), '/tarjetas-regalo/');
});

test('las anclas de la web anterior se resuelven en la página que las recibe', () => {
  const mapa = (ruta) => JSON.parse((/<script type="application\/json" id="anclas-antiguas">([\s\S]*?)<\/script>/.exec(PAGINAS.get(ruta)) || [])[1] || '{}');
  const paginaDe = (id) => Object.values(INFORME.referencias).find((r) => (r.ids || []).includes(id))?.pagina;
  const facial = mapa('/medicina-estetica-facial/');
  assert.equal(facial[huellaCorta('luz-pulsada-intensa-ipl')], paginaDe('ipl-facial'));
  assert.equal(facial[huellaCorta('aumento-de-labios-con-acido-hialuronico')], paginaDe('aumento-labios-ah'));
  assert.equal(mapa('/cirugia-estetica/')[huellaCorta('aumento-de-pecho')], paginaDe('aumento-pecho'));
  assert.equal(mapa('/clinica/')[huellaCorta('equipo')], '/equipo/');
  // El mapa no lleva el texto de las anclas viejas (algunas nombran medicamentos).
  for (const [ruta, h] of PAGINAS) assert.ok(!/semaglutida|plasma-rico/i.test(h), ruta);
});

test('sitemap y robots: todas las páginas públicas, ninguna de las que no se indexan', () => {
  const sitemap = fs.readFileSync(path.join(SALIDA, 'sitemap.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>https:\/\/iemec-clinic\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  for (const [ruta, h] of PAGINAS) {
    const indexable = !/<meta name="robots" content="noindex">/.test(h);
    assert.equal(urls.includes(ruta), indexable, `${ruta} ${indexable ? 'falta en' : 'sobra en'} el sitemap`);
  }
  for (const u of urls) assert.ok(PAGINAS.has(u), `sitemap: ${u} no existe`);
  assert.ok(!urls.includes('/gracias/'));
  assert.match(fs.readFileSync(path.join(SALIDA, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/iemec-clinic\.com\/sitemap\.xml/);
});

test('obligatorias de normas.json: pie, tratamiento médico, formulario y aviso legal (salvo el correo, pendiente)', () => {
  const ob = (donde) => normas.obligatorias.filter((o) => o.donde === donde);
  for (const [ruta, h] of PAGINAS) {
    const pie = R.textoVisible(`<body>${(/<footer[\s\S]*<\/footer>/.exec(h) || [''])[0]}</body>`);
    for (const o of [...ob('pie'), ...ob('todas')]) assert.match(pie, o.re, `${ruta}: falta ${o.patron} en el pie`);
    assert.match(pie, /Cofinanciado por la Unión Europea/);
    assert.match(pie, /Centro sanitario autorizado por la Consejería de Sanidad de la Comunidad de Madrid · N\.º de registro CS17886/);
  }
  const medicas = [...PAGINAS].filter(([, h]) => /class="aviso-medico"/.test(h));
  assert.ok(medicas.length > 20);
  for (const [ruta, h] of medicas) for (const o of ob('tratamiento_medico')) assert.match(R.textoVisible(h), o.re, `${ruta}: ${o.patron}`);
  for (const [ruta, h] of PAGINAS) {
    if (!/data-formulario/.test(h)) continue;
    const form = R.textoVisible(`<body>${/<form class="formulario"[\s\S]*?<\/form>/.exec(h)[0]}</body>`);
    for (const o of ob('formulario')) assert.match(form, o.re, `${ruta}: formulario sin ${o.patron}`);
  }
  const aviso = R.textoVisible(PAGINAS.get('/aviso-legal/'));
  const faltan = ob('aviso_legal').filter((o) => !o.re.test(aviso)).map((o) => o.patron);
  assert.deepEqual(faltan, ['[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}'], 'solo puede faltar el correo propio, pendiente de la clínica');
  assert.match(aviso, /\[PENDIENTE: correo propio del dominio/);
  assert.ok(!/@gmail\.com/i.test([...PAGINAS.values()].join('')));
});

test('los [PENDIENTE] se ven: sábado, correo, colegiados y emblema del FSE+', () => {
  const inicio = R.textoVisible(PAGINAS.get('/'));
  assert.match(inicio, /Sábado:? ?\[PENDIENTE: horario del sábado/);
  assert.match(inicio, /\[PENDIENTE: emblema oficial de la UE\]/);
  assert.match(R.textoVisible(PAGINAS.get('/equipo/')), /\[PENDIENTE: .*colegiad/);
  assert.match(PAGINAS.get('/privacidad/'), /<mark class="pendiente">\[PENDIENTE/);
  assert.ok(!/Notas internas/.test(PAGINAS.get('/privacidad/')), 'las notas internas no se publican');
  assert.ok(!/Variante B/.test(PAGINAS.get('/cookies/')));
  assert.match(R.textoVisible(PAGINAS.get('/cookies/')), /iemec-campana/);
});

test('formularios: campos, casillas sin marcar, trampa, versión y envío a la API de la app', () => {
  const h = PAGINAS.get('/pedir-cita/');
  const form = /<form class="formulario"[\s\S]*?<\/form>/.exec(h)[0];
  assert.match(form, /action="https:\/\/agenda\.iemec-clinic\.com\/web\/contacto" method="post"/);
  for (const n of ['nombre', 'telefono', 'email', 'tratamiento', 'mensaje', 'preferencia', 'privacidad', 'comercial', 'pagina', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'web', 't', 'version_textos']) {
    assert.match(form, new RegExp(`name="${n}"`), `falta ${n}`);
  }
  assert.match(form, /<input type="checkbox" id="cita-privacidad" name="privacidad" value="si" required/);
  assert.match(form, /<input type="checkbox" id="cita-comercial" name="comercial" value="si">/);
  assert.ok(!/checked[^>]*name="(privacidad|comercial)"|name="(privacidad|comercial)"[^>]*checked/.test(form), 'casillas marcadas');
  assert.match(form, /value="whatsapp"/);
  assert.match(form, /value="llamada"/);
  assert.match(form, /maxlength="500"/);
  assert.match(form, /class="trampa" aria-hidden="true"/);
  assert.match(form, /name="pagina" value="\/pedir-cita\/"/);
  // En cada tratamiento, plegado y con su página y su referencia; el id del catálogo solo si no nombra un medicamento.
  const t = PAGINAS.get('/medicina-estetica-facial/arrugas-de-expresion/');
  if (t) {
    assert.match(t, /<details class="plegable">/);
    assert.match(t, /name="ref" value="web-arrugas-de-expresion"/);
    assert.ok(!/value="toxina/.test(t));
  }
  const lipo = PAGINAS.get('/medicina-estetica-corporal/lipolaser/');
  assert.match(lipo, /<option value="lipolaser" selected>Lipoláser<\/option>/);
  // Cada etiqueta con su campo.
  for (const [, html] of PAGINAS) for (const m of html.matchAll(/<label for="([^"]+)"/g)) assert.match(html, new RegExp(`id="${m[1]}"`));
});

test('CSP: sin scripts en línea (salvo datos) ni estilos en línea; recursos con huella y dentro de su tamaño', () => {
  for (const [ruta, h] of PAGINAS) {
    for (const m of h.matchAll(/<script([^>]*)>/g)) {
      assert.ok(/src="\/recursos\/web\.[0-9a-f]{10}\.js"/.test(m[1]) || /type="application\/(ld\+)?json"/.test(m[1]), `${ruta}: script en línea ${m[1]}`);
    }
    assert.ok(!/\sstyle="/.test(h) && !/<style/.test(h), `${ruta}: estilo en línea`);
    assert.ok(Buffer.byteLength(h) < 70 * 1024, `${ruta}: ${Buffer.byteLength(h)} bytes`);
    assert.ok(!/https?:\/\/(fonts\.googleapis|fonts\.gstatic|cdn|www\.googletagmanager|connect\.facebook)/.test(h), `${ruta}: terceros`);
  }
  const recursos = fs.readdirSync(path.join(SALIDA, 'recursos'));
  const css = recursos.find((f) => /^estilos\.[0-9a-f]{10}\.css$/.test(f));
  const js = recursos.find((f) => /^web\.[0-9a-f]{10}\.js$/.test(f));
  assert.ok(css && js);
  assert.ok(fs.statSync(path.join(SALIDA, 'recursos', css)).size < 45 * 1024);
  assert.ok(fs.statSync(path.join(SALIDA, 'recursos', js)).size < 20 * 1024);
  const fuentes = fs.readdirSync(path.join(SALIDA, 'fuentes'));
  assert.ok(fuentes.some((f) => /^playfair-display-latin-500-italic\.[0-9a-f]{10}\.woff2$/.test(f)));
  assert.ok(fuentes.includes('LICENCIA-montserrat.txt') && fuentes.includes('LICENCIA-playfair-display.txt'));
  const inicio = PAGINAS.get('/');
  assert.equal((inicio.match(/<link rel="preload"[^>]*as="font"/g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(SALIDA, 'recursos', css), 'utf8'), /font-display:swap/);
});

test('imágenes: texto alternativo, ancho y alto, y carga diferida salvo la primera', () => {
  for (const [ruta, h] of PAGINAS) {
    const imgs = [...h.matchAll(/<img\s[^>]*>/g)].map((m) => m[0]);
    for (const img of imgs) {
      assert.match(img, /\salt="[^"]*"/, `${ruta}: imagen sin alt`);
      assert.match(img, /\swidth="\d+" height="\d+"/, `${ruta}: imagen sin tamaño`);
    }
    // El logotipo de la cabecera se ve al cargar; el del menú y el del pie, en diferido.
    const logos = imgs.filter((i) => /sizes="200px"/.test(i));
    if (logos.length) assert.equal(logos.filter((i) => !/loading="lazy"/.test(i)).length, 1, `${ruta}: logotipos`);
    // Del contenido, solo la primera imagen puede cargarse ya (con prioridad alta); el resto, diferidas.
    const contenido = imgs.filter((i) => !/sizes="200px"/.test(i));
    contenido.forEach((img, i) => {
      if (/fetchpriority="high"/.test(img)) assert.equal(i, 0, `${ruta}: prioridad alta que no es la primera`);
      else assert.match(img, /loading="lazy"/, `${ruta}: imagen sin carga diferida`);
    });
  }
});

test('determinista: dos construcciones dan exactamente los mismos bytes', () => {
  const otra = temporal('dist2');
  construir({ salida: otra, referencias: null });
  const huella = (dir) => {
    const h = crypto.createHash('sha256');
    const recorrer = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const r = path.join(d, f.name); if (f.isDirectory()) recorrer(r); else { h.update(path.relative(dir, r)); h.update(fs.readFileSync(r)); } } };
    recorrer(dir);
    return h.digest('hex');
  };
  assert.equal(huella(otra), huella(SALIDA));
  fs.rmSync(otra, { recursive: true, force: true });
});

test('--borradores: los de contenido/pendientes salen en otra carpeta, con la franja de borrador y sin indexar', () => {
  const b = temporal('borradores');
  const inf = construir({ salida: b, borradores: true, referencias: null });
  assert.deepEqual(inf.errores, []);
  assert.ok(inf.borradores_publicados.length >= 1);
  for (const r of inf.borradores_publicados) {
    const h = fs.readFileSync(path.join(b, r, 'index.html'), 'utf8');
    assert.match(h, /Borrador: pendiente de autorización/);
  }
  const inicio = fs.readFileSync(path.join(b, 'index.html'), 'utf8');
  assert.match(inicio, /<meta name="robots" content="noindex">/);
  assert.ok(!fs.existsSync(path.join(b, 'sitemap.xml')));
  assert.match(fs.readFileSync(path.join(b, 'robots.txt'), 'utf8'), /Disallow: \//);
  fs.rmSync(b, { recursive: true, force: true });
});

test('una especialidad sin páginas publicadas no sale en menús ni en la portada, y sus URL viejas van a /tratamientos/', () => {
  const c = temporal('sin-esp');
  const inf = construir({
    salida: c, referencias: null,
    ajustarDatos: (datos) => {
      for (const f of datos.contenidos) f.paginas = f.paginas.filter((p) => p.especialidad !== 'salud-sexual-masculina');
      datos.provisionales.paginas = datos.provisionales.paginas.filter((p) => p.especialidad !== 'salud-sexual-masculina');
      datos.provisionales.sin_pagina.push({ catalogo: 'engrosamiento-pene-ah', motivo: 'Prueba: sin página.' });
    },
  });
  assert.ok(inf.especialidades_sin_paginas.includes('salud-sexual-masculina'));
  const inicio = fs.readFileSync(path.join(c, 'index.html'), 'utf8');
  assert.ok(!inicio.includes('/salud-sexual-masculina/'));
  assert.ok(!fs.existsSync(path.join(c, 'salud-sexual-masculina')));
  assert.equal(inf.redirecciones.find((r) => r.desde === '/sexualidad-masculina').hacia, '/tratamientos/');
  fs.rmSync(c, { recursive: true, force: true });
});

test('la web no depende de las fotos: sin ellas se construye igual, con el logotipo tipográfico', () => {
  const c = temporal('sin-fotos');
  const inf = construir({ salida: c, referencias: null, ajustarDatos: (datos) => { datos.fotos = { fotos: {} }; } });
  assert.deepEqual(inf.errores, []);
  assert.deepEqual(inf.fotos, []);
  const inicio = fs.readFileSync(path.join(c, 'index.html'), 'utf8');
  assert.ok(!/<img\s/.test(inicio));
  assert.match(inicio, /<span class="marca-texto">IEMEC<\/span><span class="marca-linea">Instituto Europeo de Medicina Estética y Capilar<\/span>/);
  assert.ok(!/og:image/.test(inicio));
  fs.rmSync(c, { recursive: true, force: true });
});

test('servir.js: URL limpias, 301 del .htaccess, 404 y la CSP de la web', async () => {
  const servidor = crearServidor(SALIDA);
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const { port } = servidor.address();
  const pedir = (ruta) => new Promise((ok, mal) => http.get({ host: '127.0.0.1', port, path: ruta }, (res) => { res.resume(); res.on('end', () => ok(res)); }).on('error', mal));
  try {
    const inicio = await pedir('/');
    assert.equal(inicio.statusCode, 200);
    assert.match(inicio.headers['content-security-policy'], /default-src 'self'/);
    assert.ok(!/upgrade-insecure-requests/.test(inicio.headers['content-security-policy']));
    const vieja = await pedir('/facial');
    assert.equal(vieja.statusCode, 301);
    assert.equal(vieja.headers.location, '/medicina-estetica-facial/');
    const sinBarra = await pedir('/equipo');
    assert.equal(sinBarra.statusCode, 301);
    assert.equal(sinBarra.headers.location, '/equipo/');
    assert.equal((await pedir('/no-existe/')).statusCode, 404);
    assert.equal((await pedir('/informe.json')).statusCode, 403);
  } finally {
    servidor.close();
  }
});

test.after(() => {
  if (SALIDA) {
    fs.rmSync(SALIDA, { recursive: true, force: true });
    fs.rmSync(path.join(SALIDA, '..', `${path.basename(SALIDA)}-referencias.json`), { force: true });
  }
});
