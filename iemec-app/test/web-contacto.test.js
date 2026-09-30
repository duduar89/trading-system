'use strict';
// POST /web/contacto: el formulario «Te llamamos» de la web pública (otro dominio, sin clave). Con y
// sin JavaScript, CORS solo para la web, lo que manda otra web, la prueba de los consentimientos (lo
// pedido, cifrado), el lead sin verificar y lo que se pone en marcha (el WhatsApp de confirmación o una
// tarea), la trampa para robots y los límites (por IP, por teléfono en silencio y el tope de todos).
// Teléfonos inventados (611 000 7xx).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const proxyaddr = require('proxy-addr');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { crearApp } = require('../servidor/index');
const { rutasWeb } = require('../servidor/rutas/web');
const { descifrar } = require('../servidor/cripto');
const { confiarEnProxyLocal, LIMITES } = require('../servidor/seguridad');
const { leerFormularioWeb, referenciaDeWhatsapp, sinReferencia, respuestaConfirmacion, huellaCampana, MINIMO_MS } = require('../motor/entrada/web');

const martes = new Date('2026-10-06T10:00:00Z'); // martes 12:00 en Madrid
const WEB = 'https://iemec-clinic.com';
const VERSION = '2026-09-30.prueba01';
const TEXTOS = { actual: VERSION, versiones: { [VERSION]: { capa: [], privacidad: 'He leído…', comercial: 'Quiero recibir…' } } };
const REFERENCIAS = {
  referencias: {
    'web-lipolaser': { catalogo: 'lipolaser', pagina: '/medicina-estetica-corporal/lipolaser/', especialidad: 'medicina-estetica-corporal' },
    'web-intima-f-1abc': { catalogo: 'labioplastia', pagina: '/estetica-intima-femenina/labioplastia/', especialidad: 'estetica-intima-femenina' },
    'web-pedir-cita': { catalogo: null, pagina: '/pedir-cita/', especialidad: null },
    'web-tarjeta-regalo': { catalogo: 'tarjeta-regalo-online', pagina: '/tarjetas-regalo/', especialidad: null },
  },
  grupos: {
    'medicina-estetica-corporal': 'Medicina estética corporal', 'estetica-intima-femenina': 'Salud íntima femenina',
    'tarjeta-regalo': 'Tarjeta regalo', otra: 'Otra cosa / prefiero contarlo por teléfono',
  },
};

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, municipio) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', 'Boadilla del Monte')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '10:00', '20:00')", [d]);
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('corporal', 'Medicina estética corporal'), ('ginecoestetica', 'Estética íntima femenina')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, publicidad_restringida, reservable_ia, alias) VALUES
    ('lipolaser', 'Lipoláser', 'corporal', 60, 10, NULL, 'medico', 'consulta_medica', 'aparatologia', FALSE, TRUE, '[]'),
    ('labioplastia', 'Labioplastia', 'ginecoestetica', 60, 10, NULL, 'medico', 'consulta_medica', 'cirugia', FALSE, FALSE, '[]')`);
}

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

let n = 0;
const envio = (extra = {}) => ({
  nombre: 'Web Prueba', telefono: `611 000 7${String(++n).padStart(2, '0')}`, email: '', tratamiento: 'web-lipolaser', mensaje: '',
  preferencia: 'whatsapp', privacidad: 'si', pagina: '/medicina-estetica-corporal/lipolaser/', ref: 'web-lipolaser',
  utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '', t: '9000', envio: crypto.randomUUID(), version_textos: VERSION, web: '', ...extra,
});
const e164 = (t) => `+34${t.replace(/\s/g, '')}`;

test('leerFormularioWeb: valida como la web y traduce la referencia (sin base de datos)', () => {
  const o = { referencias: REFERENCIAS.referencias, grupos: REFERENCIAS.grupos, ahora: martes, versiones: TEXTOS.versiones };
  const bien = leerFormularioWeb(envio({ telefono: '611000799' }), o);
  assert.equal(bien.ok, true);
  assert.equal(bien.datos.tratamiento.id, 'lipolaser');
  assert.equal(bien.datos.codigoWeb, 'web-lipolaser');
  assert.equal(bien.datos.sinVerificar, true, 'el formulario es anónimo: su teléfono no está verificado');
  assert.equal(bien.solicitud.comercial, false);
  assert.equal(bien.solicitud.versionConocida, true);
  // Lo íntimo: el grupo neutro y el tratamiento sale de la referencia de la página.
  const intima = leerFormularioWeb(envio({ tratamiento: 'estetica-intima-femenina', ref: 'web-intima-f-1abc' }), o);
  assert.equal(intima.datos.tratamiento.id, 'labioplastia');
  assert.equal(intima.solicitud.interes, 'Salud íntima femenina');
  // Otro grupo que el de la página: sin tratamiento (no se da por hecho).
  assert.equal(leerFormularioWeb(envio({ tratamiento: 'otra', ref: 'web-intima-f-1abc' }), o).datos.tratamiento.id, null);
  // Un id del catálogo no es un valor válido del formulario; una referencia bien formada que la app aún
  // no conoce (una página publicada antes que la app) sí: interés sin tratamiento.
  assert.deepEqual(Object.keys(leerFormularioWeb(envio({ tratamiento: 'lipolaser' }), o).errores), ['tratamiento']);
  const nueva = leerFormularioWeb(envio({ tratamiento: 'web-pagina-nueva', ref: 'web-pagina-nueva' }), o);
  assert.deepEqual([nueva.ok, nueva.datos.tratamiento.id, nueva.datos.codigoWeb], [true, null, 'web-pagina-nueva']);
  const mal = leerFormularioWeb(envio({ nombre: '', telefono: '123', preferencia: 'correo', privacidad: '', mensaje: 'x'.repeat(501) }), o);
  assert.deepEqual(Object.keys(mal.errores).sort(), ['email', 'mensaje', 'nombre', 'privacidad', 'telefono']);
  assert.match(mal.errores.email, /Has elegido que te contestemos por correo/);
  // Robots: la trampa o un envío instantáneo; sin JavaScript (t vacío) no se descarta.
  assert.equal(leerFormularioWeb(envio({ web: 'http://spam' }), o).robot, true);
  assert.equal(leerFormularioWeb(envio({ t: String(MINIMO_MS - 1) }), o).robot, true);
  assert.equal(leerFormularioWeb(envio({ t: '' }), o).robot, false);
  // La versión que dice el navegador: si no es de las publicadas, se guarda marcada.
  assert.equal(leerFormularioWeb(envio({ version_textos: 'inventada' }), o).solicitud.versionConocida, false);
  assert.equal(leerFormularioWeb(envio({ version_textos: '' }), o).solicitud.version, 'desconocida');
});

test('leerFormularioWeb: la campaña, solo como la escribe la web; la huella del envío, con la clave del servidor', () => {
  const o = { referencias: REFERENCIAS.referencias, grupos: REFERENCIAS.grupos, ahora: martes, clave: 'clave-de-prueba' };
  // Texto libre en utm_*: no se guarda (acabaría en el lead y en las tareas de recepción).
  const libre = leerFormularioWeb(envio({ utm_campaign: 'AVISO: el paciente pide que NO se le llame; llamar al 806 00 00 00', utm_source: 'Facebook' }), o);
  assert.deepEqual([libre.datos.campana, libre.datos.utm], [null, { utm_source: 'facebook' }]);
  assert.equal(leerFormularioWeb(envio({ utm_campaign: 'Otoño Lipo' }), o).datos.campana, 'otono-lipo');
  // La huella: HMAC con la clave del servidor. Sin la clave no se puede comprobar un mensaje adivinado,
  // y el mensaje no va en id_externo.
  const mensaje = '¿Puedo hacérmelo si estoy embarazada de 3 meses?';
  const sinJs = envio({ t: '', envio: '', mensaje });
  const a = leerFormularioWeb(sinJs, o);
  const b = leerFormularioWeb(sinJs, { ...o, clave: 'otra-clave' });
  assert.notEqual(a.solicitud.huella, b.solicitud.huella);
  const sinClave = crypto.createHash('sha256').update([e164(sinJs.telefono), sinJs.pagina, '', sinJs.tratamiento, mensaje, martes.toISOString().slice(0, 16)].join('|')).digest('hex');
  assert.notEqual(a.solicitud.huella, sinClave);
  assert.ok(!a.datos.idExterno.includes(sinClave.slice(0, 20)));
  // Con JavaScript, el identificador del envío: reintentar el mismo formulario da la misma huella
  // (aunque cambie el tiempo de rellenado); otro formulario, otra.
  const conJs = envio({ mensaje });
  assert.equal(leerFormularioWeb({ ...conJs, t: '9000' }, o).solicitud.huella, leerFormularioWeb({ ...conJs, t: '15000' }, o).solicitud.huella);
  assert.notEqual(leerFormularioWeb(conJs, o).solicitud.huella, leerFormularioWeb({ ...conJs, envio: crypto.randomUUID() }, o).solicitud.huella);
});

test('referenciaDeWhatsapp, sinReferencia y las respuestas a «¿Has sido tú?»', () => {
  assert.deepEqual(referenciaDeWhatsapp('Hola, vengo de la web y me interesa: Lipoláser. (ref. web-lipolaser)'), { ref: 'web-lipolaser', campana: null });
  assert.deepEqual(referenciaDeWhatsapp('Hola, vengo de la web y me interesa: Salud íntima femenina. (ref. web-intima-f-6mlx46 · c-1x2y3z)'),
    { ref: 'web-intima-f-6mlx46', campana: 'c-1x2y3z' });
  for (const t of ['Hola, ¿tenéis cita?', '(ref. lipolaser)', '(ref. web-LIPOLASER)', '(ref. web-lipolaser · otono-lipo)', null, 42]) {
    assert.equal(referenciaDeWhatsapp(t), null, String(t));
  }
  assert.equal(sinReferencia('Hola, vengo de la web y me interesa: Injerto de barba. (ref. web-injerto-de-barba · c-1x2y3z)'), 'Hola, vengo de la web y me interesa: Injerto de barba.');
  for (const t of ['Sí, fui yo', 'si', 'Sí', 'soy yo', 'Claro, fui yo', 'sí, he sido yo']) assert.equal(respuestaConfirmacion(t), 'si', t);
  for (const t of ['No fui yo', 'no', 'Yo no he pedido nada', 'No sé de qué me hablas', 'número equivocado', 'sí, pero no fui yo']) assert.equal(respuestaConfirmacion(t), 'no', t);
  for (const t of ['Hola', '¿Quién sois?', 'Quiero información del láser']) assert.equal(respuestaConfirmacion(t), null, t);
  // La huella de la campaña es la de web/js/web.js (FNV-1a en base 36 del nombre en minúsculas).
  assert.equal(huellaCampana('Otono-Lipo'), huellaCampana('otono-lipo'));
  assert.match(huellaCampana('otono-lipo'), /^c-[0-9a-z]{1,8}$/);
});

test('la IP del visitante solo la dice el proxy de la propia máquina (trust proxy)', () => {
  const ip = (remoto, xff) => proxyaddr({ connection: { remoteAddress: remoto }, socket: { remoteAddress: remoto }, headers: xff ? { 'x-forwarded-for': xff } : {} }, confiarEnProxyLocal);
  // Detrás del proxy local (127.0.0.1 o un socket Unix): la IP que añade al final.
  assert.equal(ip('127.0.0.1', '10.9.9.9, 198.51.100.7'), '198.51.100.7');
  assert.equal(ip('::ffff:127.0.0.1', '198.51.100.7'), '198.51.100.7');
  assert.equal(ip(undefined, '198.51.100.8'), '198.51.100.8');
  // Directo a Node (sin proxy): la cabecera inventada no cuenta.
  assert.equal(ip('203.0.113.9', '10.1.2.3'), '203.0.113.9');
  assert.equal(ip('203.0.113.9', '10.1.2.3, 198.51.100.7'), '203.0.113.9');
  const app = crearApp({ pool: null, deps: {} });
  assert.equal(app.get('trust proxy fn')('203.0.113.9', 0), false);
});

test('POST /web/contacto', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  let ahora = new Date(martes);
  const app = crearApp({ pool, reloj: () => martes });
  // Las referencias y los textos de la prueba (los de verdad los genera web/construir.js). Detrás de un
  // proxy local, como la app: la IP del límite sale de X-Forwarded-For.
  const conRefs = require('express')();
  conRefs.set('trust proxy', confiarEnProxyLocal);
  conRefs.use(rutasWeb({ pool, reloj: () => ahora, referencias: REFERENCIAS, textos: TEXTOS }));
  const q = async (sql, a = []) => (await pool.query(sql, a))[0];
  const uno = async (sql, a = []) => (await q(sql, a))[0];
  const cuantos = async (sql, a = []) => Number((await uno(sql, a)).n);
  const pedido = (s) => JSON.parse(descifrar(s.datos_cifrados, s.datos_iv, s.datos_tag));
  try {
    await sembrar(pool);
    await conServidor(conRefs, async (base) => {
      const post = (cuerpo, { json = true, origen = WEB, ip = null, cabeceras = {} } = {}) => fetch(`${base}/web/contacto`, {
        method: 'POST', redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded', ...(json ? { Accept: 'application/json' } : {}), ...(origen ? { Origin: origen } : {}),
          ...(ip ? { 'X-Forwarded-For': ip } : {}), ...cabeceras,
        },
        body: new URLSearchParams(cuerpo).toString(),
      });

      await t.test('CORS solo para la web; la comprobación previa contesta 204', async () => {
        const pre = await fetch(`${base}/web/contacto`, { method: 'OPTIONS', headers: { Origin: WEB, 'Access-Control-Request-Method': 'POST' } });
        assert.equal(pre.status, 204);
        assert.equal(pre.headers.get('access-control-allow-origin'), WEB);
        const otra = await fetch(`${base}/web/contacto`, { method: 'OPTIONS', headers: { Origin: 'https://otra-web.example' } });
        assert.equal(otra.headers.get('access-control-allow-origin'), null);
      });

      await t.test('con JavaScript: 200, lead sin verificar, el WhatsApp de confirmación en vez de la secuencia y la prueba (lo pedido, cifrado)', async () => {
        const e = envio({ utm_source: 'facebook', utm_campaign: 'otono-lipo', mensaje: '¿Tenéis cita el jueves?' });
        const r = await post(e, { ip: '203.0.113.1' });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('access-control-allow-origin'), WEB);
        assert.deepEqual(await r.json(), { ok: true });
        const lead = await uno('SELECT * FROM leads WHERE telefono = ?', [e164(e.telefono)]);
        assert.deepEqual([lead.origen, lead.codigo_web, lead.tratamiento_interes_id, lead.campana, Boolean(lead.sin_verificar), lead.paciente_id],
          ['web', 'web-lipolaser', 'lipolaser', 'otono-lipo', true, null]);
        assert.ok(lead.respuestas_cifradas, 'el mensaje va cifrado');
        // Nada de la secuencia «lead» (plantillas comerciales con su nombre y el tratamiento): primero, la confirmación.
        assert.equal(await cuantos("SELECT COUNT(*) AS n FROM inscripciones WHERE lead_id = ? AND secuencia = 'lead'", [lead.id]), 0);
        assert.ok(await uno("SELECT 1 FROM inscripciones WHERE lead_id = ? AND secuencia = 'confirmar_web' AND estado = 'activa'", [lead.id]));
        const s = await uno('SELECT * FROM solicitudes_web WHERE lead_id = ?', [lead.id]);
        assert.deepEqual([s.preferencia, Boolean(s.consentimiento_datos), Boolean(s.consentimiento_comercial), s.version_textos, Boolean(s.version_conocida), s.verificada_en],
          ['whatsapp', true, false, VERSION, true, null]);
        // Lo que pidió (la página y el tratamiento pueden revelar un dato de salud), cifrado; en claro, nada.
        assert.deepEqual([s.pagina, s.ref, s.tratamiento_id, s.interes], [null, null, null, null]);
        assert.deepEqual(pedido(s), {
          pagina: '/medicina-estetica-corporal/lipolaser/', ref: 'web-lipolaser', tratamiento: 'lipolaser', interes: null, preferencia: 'whatsapp',
          nombre: 'Web Prueba', email: null, mensaje: '¿Tenéis cita el jueves?',
        });
        assert.equal(new Date(s.enviado_en).toISOString(), martes.toISOString());
        // El mismo envío otra vez (la red falla y la web reintenta, con otro t): ni otro lead ni otra prueba.
        assert.equal((await post({ ...e, t: '15000' }, { ip: '203.0.113.1' })).status, 200);
        assert.equal(await cuantos('SELECT COUNT(*) AS n FROM leads WHERE telefono = ?', [lead.telefono]), 1);
        assert.equal(await cuantos('SELECT COUNT(*) AS n FROM solicitudes_web WHERE telefono = ?', [lead.telefono]), 1);
      });

      await t.test('lo íntimo: el tratamiento sale de la referencia; el consentimiento comercial se guarda aparte', async () => {
        const e = envio({ tratamiento: 'estetica-intima-femenina', ref: 'web-intima-f-1abc', pagina: '/estetica-intima-femenina/labioplastia/', comercial: 'si' });
        assert.equal((await post(e, { ip: '203.0.113.2' })).status, 200);
        const s = await uno('SELECT * FROM solicitudes_web ORDER BY id DESC LIMIT 1');
        assert.deepEqual([pedido(s).tratamiento, pedido(s).interes, Boolean(s.consentimiento_comercial), s.tratamiento_id, s.pagina],
          ['labioplastia', 'Salud íntima femenina', true, null, null]);
      });

      await t.test('llamada o correo: sin WhatsApp, tarea para una persona que dice que está sin verificar (sin la campaña ni la referencia)', async () => {
        const e = envio({ preferencia: 'llamada', utm_campaign: 'AVISO: el paciente pide que NO se le llame; llamar al 806 00 00 00' });
        assert.equal((await post(e, { ip: '203.0.113.3' })).status, 200);
        const lead = await uno('SELECT * FROM leads ORDER BY id DESC LIMIT 1');
        assert.equal(await uno('SELECT 1 FROM inscripciones WHERE lead_id = ?', [lead.id]), undefined);
        assert.equal(lead.campana, null, 'el texto libre de la campaña no se guarda');
        const tarea = await uno('SELECT * FROM tareas WHERE lead_id = ?', [lead.id]);
        assert.equal(tarea.tipo, 'llamar');
        assert.match(tarea.titulo, /^Llamar a Web Prueba al 611 00 07 \d\d: lo ha pedido en la web de lipoláser \(formulario de la web, sin verificar\)$/);
        const sinCorreo = await post(envio({ preferencia: 'correo' }), { ip: '203.0.113.3' });
        assert.equal(sinCorreo.status, 422);
        assert.deepEqual(Object.keys((await sinCorreo.json()).errores), ['email']);
        assert.equal((await post(envio({ preferencia: 'correo', email: 'web.prueba@ejemplo.com' }), { ip: '203.0.113.3' })).status, 200);
        const t2 = await uno("SELECT t.* FROM tareas t JOIN leads l ON l.id = t.lead_id WHERE l.email = 'web.prueba@ejemplo.com'");
        assert.equal(t2.tipo, 'otro');
        assert.match(t2.titulo, /^Escribir a Web Prueba a web\.prueba@ejemplo\.com: pide información de lipoláser y quiere la respuesta por correo \(formulario de la web, sin verificar\)$/);
      });

      await t.test('una página que la app aún no conoce: su formulario vale (interés sin tratamiento)', async () => {
        const e = envio({ tratamiento: 'web-pagina-nueva', ref: 'web-pagina-nueva', pagina: '/pagina-nueva/' });
        const r = await post(e, { ip: '203.0.113.7' });
        assert.equal(r.status, 200);
        const lead = await uno('SELECT * FROM leads WHERE telefono = ?', [e164(e.telefono)]);
        assert.deepEqual([lead.codigo_web, lead.tratamiento_interes_id], ['web-pagina-nueva', null]);
      });

      await t.test('una versión de los textos que no es de las publicadas se guarda marcada', async () => {
        const e = envio({ version_textos: 'inventada', comercial: 'si' });
        assert.equal((await post(e, { ip: '203.0.113.8' })).status, 200);
        const s = await uno('SELECT * FROM solicitudes_web WHERE telefono = ?', [e164(e.telefono)]);
        assert.deepEqual([s.version_textos, Boolean(s.version_conocida)], ['inventada', false]);
      });

      await t.test('sin JavaScript: 303 a /gracias/; con errores, una página con cada error y el camino de vuelta', async () => {
        const r = await post(envio({ t: '', envio: '' }), { json: false, ip: '203.0.113.4' });
        assert.equal(r.status, 303);
        assert.equal(r.headers.get('location'), `${WEB}/gracias/`);
        const mal = await post(envio({ privacidad: '', t: '' }), { json: false, ip: '203.0.113.4' });
        assert.equal(mal.status, 422);
        const h = await mal.text();
        assert.match(h, /Para contestarte necesitamos tu consentimiento en la primera casilla\./);
        assert.match(h, /href="https:\/\/iemec-clinic\.com\/medicina-estetica-corporal\/lipolaser\/#te-llamamos"/);
        assert.match(mal.headers.get('content-security-policy'), /default-src 'none'/);
      });

      await t.test('robots y otras webs: la trampa, un envío instantáneo o lo que manda otra web contestan «recibido» y no se guarda nada', async () => {
        const antes = await cuantos('SELECT COUNT(*) AS n FROM leads');
        const limites = await cuantos('SELECT COUNT(*) AS n FROM limites_acceso');
        assert.deepEqual(await (await post(envio({ web: 'http://spam.example' }), { ip: '203.0.113.5' })).json(), { ok: true });
        assert.deepEqual(await (await post(envio({ t: '400' }), { ip: '203.0.113.5' })).json(), { ok: true });
        // Otra web hace que sus visitantes lo manden: con su Origin, o sin él y con Sec-Fetch-Site: cross-site.
        assert.deepEqual(await (await post(envio(), { ip: '203.0.113.5', origen: 'https://otra-web.example', cabeceras: { 'Sec-Fetch-Site': 'cross-site' } })).json(), { ok: true });
        assert.deepEqual(await (await post(envio(), { ip: '203.0.113.5', origen: null, cabeceras: { 'Sec-Fetch-Site': 'cross-site' } })).json(), { ok: true });
        const sinJs = await post(envio({ t: '' }), { json: false, ip: '203.0.113.5', origen: 'https://otra-web.example' });
        assert.equal(sinJs.status, 303);
        assert.equal(await cuantos('SELECT COUNT(*) AS n FROM leads'), antes);
        assert.equal(await cuantos('SELECT COUNT(*) AS n FROM limites_acceso'), limites, 'ni siquiera cuentan');
        // La web de verdad sin Origin (o «null») y del mismo sitio: vale.
        assert.equal((await post(envio(), { ip: '203.0.113.5', origen: 'null', cabeceras: { 'Sec-Fetch-Site': 'same-site' } })).status, 200);
        assert.equal(await cuantos('SELECT COUNT(*) AS n FROM leads'), antes + 1);
      });

      await t.test('límites: 8 envíos por IP cada 15 minutos (429) y 20 al día', async () => {
        for (let i = 0; i < 8; i++) assert.notEqual((await post(envio(), { ip: '203.0.113.6' })).status, 429, `envío ${i + 1}`);
        const r = await post(envio(), { ip: '203.0.113.6' });
        assert.equal(r.status, 429);
        assert.deepEqual(await r.json(), { ok: false, error: 'demasiados_envios' });
        // Pasados los 15 minutos, otros 8… hasta 20 en el día.
        let bien = 0;
        for (let v = 1; v <= 3; v++) {
          ahora = new Date(martes.getTime() + v * 16 * 60000);
          for (let i = 0; i < 8; i++) if ((await post(envio(), { ip: '203.0.113.9' })).status === 200) bien++;
        }
        assert.equal(bien, LIMITES.webDia.max);
        ahora = new Date(martes);
      });

      await t.test('el límite por teléfono no se le dice a quien envía: no delata quién ha pedido información ni bloquea a nadie', async () => {
        // La víctima pide información; alguien prueba su número desde otras IP.
        const victima = '611 000 777';
        assert.equal((await post(envio({ telefono: victima }), { ip: '198.51.100.1' })).status, 200);
        const sonda = async (tel, ip) => (await post(envio({ telefono: tel, mensaje: `sonda ${ip}` }), { ip })).status;
        const suyo = [await sonda(victima, '198.51.100.2'), await sonda(victima, '198.51.100.3'), await sonda(victima, '198.51.100.4')];
        const otro = [await sonda('611 000 778', '198.51.100.2'), await sonda('611 000 778', '198.51.100.3'), await sonda('611 000 778', '198.51.100.4')];
        assert.deepEqual(suyo, [200, 200, 200]);
        assert.deepEqual(otro, [200, 200, 200]);
        // Pasado el límite no se guarda nada (ni otra solicitud ni otra tarea), y queda apuntado.
        assert.equal(await cuantos('SELECT COUNT(*) AS n FROM solicitudes_web WHERE telefono = ?', [e164(victima)]), 3);
        assert.ok(await cuantos("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'web_limite_telefono'") >= 1);
      });

      await t.test('lo que se guarda para los límites no lleva ni el teléfono ni la IP; ni los eventos ni la prueba llevan el mensaje', async () => {
        const e = envio({ mensaje: 'Mensaje secreto de la prueba 12345' });
        assert.equal((await post(e, { ip: '192.0.2.77' })).status, 200);
        const claves = (await q('SELECT clave FROM limites_acceso')).map((f) => f.clave).join(' ');
        const digitos = e.telefono.replace(/\s/g, '');
        assert.ok(!claves.includes(digitos) && !claves.includes('192.0.2.77'), claves);
        const eventos = (await q('SELECT datos FROM eventos')).map((f) => JSON.stringify(f.datos)).join(' ');
        assert.ok(!eventos.includes('Mensaje secreto') && !eventos.includes(digitos));
        const s = await uno('SELECT * FROM solicitudes_web WHERE telefono = ?', [e164(e.telefono)]);
        assert.ok(!JSON.stringify(s).includes('Mensaje secreto'));
        const lead = await uno('SELECT * FROM leads WHERE telefono = ?', [e164(e.telefono)]);
        assert.ok(!String(lead.id_externo).includes('secreto'));
      });
    });

    await t.test('tope de lo que el formulario pone en marcha: pasado, se guarda sin escribir ni crear tareas y una sola tarea avisa', async () => {
      await pool.query('DELETE FROM limites_acceso');
      ahora = new Date(martes.getTime() + 2 * 86400000);
      await conServidor(conRefs, async (base) => {
        const max = LIMITES.webAcciones.max;
        for (let i = 0; i < max + 5; i++) {
          const r = await fetch(`${base}/web/contacto`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Origin: WEB, 'X-Forwarded-For': `192.0.2.${100 + (i % 50)}` },
            body: new URLSearchParams(envio({ preferencia: i % 2 ? 'whatsapp' : 'llamada', telefono: `611 001 ${String(i).padStart(3, '0')}` })).toString(),
          });
          assert.equal(r.status, 200);
        }
      });
      const conAccion = await cuantos(
        `SELECT COUNT(*) AS n FROM leads l WHERE l.telefono LIKE '+34611001%' AND (EXISTS (SELECT 1 FROM inscripciones i WHERE i.lead_id = l.id)
            OR EXISTS (SELECT 1 FROM tareas t WHERE t.lead_id = l.id))`);
      assert.equal(conAccion, LIMITES.webAcciones.max);
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM leads WHERE telefono LIKE '+34611001%'"), LIMITES.webAcciones.max + 5, 'se guardan todos');
      const avisos = await q("SELECT titulo FROM tareas WHERE titulo LIKE 'Formulario de la web: más solicitudes%' AND estado = 'abierta'");
      assert.equal(avisos.length, 1);
      assert.match(avisos[0].titulo, new RegExp(`\\(${LIMITES.webAcciones.max + 5} en la última hora\\)`));
    });

    // La app de verdad monta la ruta (con las referencias de semillas/iemec/referencias-web.json).
    await conServidor(app, async (base) => {
      const r = await fetch(`${base}/web/contacto`, { method: 'OPTIONS', headers: { Origin: WEB } });
      assert.equal(r.status, 204);
    });
  } finally {
    await pool.end();
  }
});
