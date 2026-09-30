'use strict';
// POST /web/contacto: el formulario «Te llamamos» de la web pública (otro dominio, sin clave). Con y
// sin JavaScript, CORS solo para la web, la prueba de los consentimientos, el lead y su tarea o su
// secuencia, la trampa para robots y el límite de envíos. Teléfonos inventados (611 000 7xx).
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { crearApp } = require('../servidor/index');
const { rutasWeb } = require('../servidor/rutas/web');
const { leerFormularioWeb, referenciaDeWhatsapp, MINIMO_MS } = require('../motor/entrada/web');

const martes = new Date('2026-10-06T10:00:00Z'); // martes 12:00 en Madrid
const WEB = 'https://iemec-clinic.com';
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
  utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '', t: '9000', version_textos: '2026-09-30', web: '', ...extra,
});

test('leerFormularioWeb: valida como la web y traduce la referencia (sin base de datos)', () => {
  const o = { referencias: REFERENCIAS.referencias, grupos: REFERENCIAS.grupos, ahora: martes };
  const bien = leerFormularioWeb(envio({ telefono: '611000799' }), o);
  assert.equal(bien.ok, true);
  assert.equal(bien.datos.tratamiento.id, 'lipolaser');
  assert.equal(bien.datos.codigoWeb, 'web-lipolaser');
  assert.equal(bien.solicitud.comercial, false);
  // Lo íntimo: el grupo neutro y el tratamiento sale de la referencia de la página.
  const intima = leerFormularioWeb(envio({ tratamiento: 'estetica-intima-femenina', ref: 'web-intima-f-1abc' }), o);
  assert.equal(intima.datos.tratamiento.id, 'labioplastia');
  assert.equal(intima.solicitud.interes, 'Salud íntima femenina');
  // Otro grupo que el de la página: sin tratamiento (no se da por hecho).
  assert.equal(leerFormularioWeb(envio({ tratamiento: 'otra', ref: 'web-intima-f-1abc' }), o).datos.tratamiento.id, null);
  // Un id del catálogo no es un valor válido del formulario.
  assert.deepEqual(Object.keys(leerFormularioWeb(envio({ tratamiento: 'lipolaser' }), o).errores), ['tratamiento']);
  const mal = leerFormularioWeb(envio({ nombre: '', telefono: '123', preferencia: 'correo', privacidad: '', mensaje: 'x'.repeat(501) }), o);
  assert.deepEqual(Object.keys(mal.errores).sort(), ['email', 'mensaje', 'nombre', 'privacidad', 'telefono']);
  assert.match(mal.errores.email, /Has elegido que te contestemos por correo/);
  // Robots: la trampa o un envío instantáneo; sin JavaScript (t vacío) no se descarta.
  assert.equal(leerFormularioWeb(envio({ web: 'http://spam' }), o).robot, true);
  assert.equal(leerFormularioWeb(envio({ t: String(MINIMO_MS - 1) }), o).robot, true);
  assert.equal(leerFormularioWeb(envio({ t: '' }), o).robot, false);
});

test('referenciaDeWhatsapp: la «(ref. …)» del primer mensaje de los botones de la web', () => {
  assert.deepEqual(referenciaDeWhatsapp('Hola, vengo de la web y me interesa: Lipoláser. (ref. web-lipolaser)'), { ref: 'web-lipolaser', campana: null });
  assert.deepEqual(referenciaDeWhatsapp('Hola, vengo de la web y me interesa: Salud íntima femenina. (ref. web-intima-f-6mlx46 · c-1x2y3z)'),
    { ref: 'web-intima-f-6mlx46', campana: 'c-1x2y3z' });
  for (const t of ['Hola, ¿tenéis cita?', '(ref. lipolaser)', '(ref. web-LIPOLASER)', '(ref. web-lipolaser · otono-lipo)', null, 42]) {
    assert.equal(referenciaDeWhatsapp(t), null, String(t));
  }
});

test('POST /web/contacto', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const app = crearApp({ pool, reloj: () => martes });
  // Las referencias de la prueba (las de verdad las genera web/construir.js). Detrás de un proxy, como
  // la app: la IP del límite sale de X-Forwarded-For.
  const conRefs = require('express')();
  conRefs.set('trust proxy', 1);
  conRefs.use(rutasWeb({ pool, reloj: () => martes, referencias: REFERENCIAS }));
  const q = async (sql, a = []) => (await pool.query(sql, a))[0];
  const uno = async (sql, a = []) => (await q(sql, a))[0];
  try {
    await sembrar(pool);
    await conServidor(conRefs, async (base) => {
      const post = (cuerpo, { json = true, origen = WEB, ip = null } = {}) => fetch(`${base}/web/contacto`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(json ? { Accept: 'application/json' } : {}), ...(origen ? { Origin: origen } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}) },
        body: new URLSearchParams(cuerpo).toString(),
      });

      await t.test('CORS solo para la web; la comprobación previa contesta 204', async () => {
        const pre = await fetch(`${base}/web/contacto`, { method: 'OPTIONS', headers: { Origin: WEB, 'Access-Control-Request-Method': 'POST' } });
        assert.equal(pre.status, 204);
        assert.equal(pre.headers.get('access-control-allow-origin'), WEB);
        const otra = await fetch(`${base}/web/contacto`, { method: 'OPTIONS', headers: { Origin: 'https://otra-web.example' } });
        assert.equal(otra.headers.get('access-control-allow-origin'), null);
      });

      await t.test('con JavaScript: 200, lead de la web con su referencia, su secuencia y la prueba de los consentimientos', async () => {
        const e = envio({ utm_source: 'facebook', utm_campaign: 'otono-lipo', mensaje: '¿Tenéis cita el jueves?' });
        const r = await post(e, { ip: '203.0.113.1' });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('access-control-allow-origin'), WEB);
        assert.deepEqual(await r.json(), { ok: true });
        const lead = await uno('SELECT * FROM leads WHERE telefono = ?', [`+34${e.telefono.replace(/\s/g, '')}`]);
        assert.deepEqual([lead.origen, lead.codigo_web, lead.tratamiento_interes_id, lead.campana], ['web', 'web-lipolaser', 'lipolaser', 'otono-lipo']);
        assert.ok(lead.respuestas_cifradas, 'el mensaje va cifrado');
        assert.ok(await uno("SELECT 1 FROM inscripciones WHERE lead_id = ? AND estado = 'activa'", [lead.id]), 'pide WhatsApp: secuencia de seguimiento');
        const s = await uno('SELECT * FROM solicitudes_web WHERE lead_id = ?', [lead.id]);
        assert.deepEqual([s.pagina, s.preferencia, Boolean(s.consentimiento_datos), Boolean(s.consentimiento_comercial), s.version_textos, s.tratamiento_id],
          ['/medicina-estetica-corporal/lipolaser/', 'whatsapp', true, false, '2026-09-30', 'lipolaser']);
        assert.equal(new Date(s.enviado_en).toISOString(), martes.toISOString());
        // El mismo envío otra vez (la red falla y la web reintenta): ni otro lead ni otra prueba.
        assert.equal((await post(e, { ip: '203.0.113.1' })).status, 200);
        assert.equal((await uno('SELECT COUNT(*) AS n FROM leads WHERE telefono = ?', [lead.telefono])).n, 1);
        assert.equal((await uno('SELECT COUNT(*) AS n FROM solicitudes_web WHERE telefono = ?', [lead.telefono])).n, 1);
      });

      await t.test('lo íntimo: el tratamiento sale de la referencia; el consentimiento comercial se guarda aparte', async () => {
        const e = envio({ tratamiento: 'estetica-intima-femenina', ref: 'web-intima-f-1abc', pagina: '/estetica-intima-femenina/labioplastia/', comercial: 'si' });
        assert.equal((await post(e, { ip: '203.0.113.2' })).status, 200);
        const s = await uno('SELECT * FROM solicitudes_web ORDER BY id DESC LIMIT 1');
        assert.deepEqual([s.tratamiento_id, s.interes, Boolean(s.consentimiento_comercial)], ['labioplastia', 'Salud íntima femenina', true]);
      });

      await t.test('llamada o correo: sin secuencia, tarea para una persona', async () => {
        const e = envio({ preferencia: 'llamada' });
        assert.equal((await post(e, { ip: '203.0.113.3' })).status, 200);
        const lead = await uno('SELECT * FROM leads ORDER BY id DESC LIMIT 1');
        assert.equal(await uno('SELECT 1 FROM inscripciones WHERE lead_id = ?', [lead.id]), undefined);
        const tarea = await uno('SELECT * FROM tareas WHERE lead_id = ?', [lead.id]);
        assert.equal(tarea.tipo, 'llamar');
        assert.match(tarea.titulo, /^Llamar a Web Prueba al 611 00 07 \d\d: lo ha pedido en la web de lipoláser \(web · web-lipolaser\)$/);
        const sinCorreo = await post(envio({ preferencia: 'correo' }), { ip: '203.0.113.3' });
        assert.equal(sinCorreo.status, 422);
        assert.deepEqual(Object.keys((await sinCorreo.json()).errores), ['email']);
        assert.equal((await post(envio({ preferencia: 'correo', email: 'web.prueba@ejemplo.com' }), { ip: '203.0.113.3' })).status, 200);
        const t2 = await uno("SELECT t.* FROM tareas t JOIN leads l ON l.id = t.lead_id WHERE l.email = 'web.prueba@ejemplo.com'");
        assert.equal(t2.tipo, 'otro');
        assert.match(t2.titulo, /^Escribir a Web Prueba a web\.prueba@ejemplo\.com: pide información de lipoláser y quiere la respuesta por correo/);
      });

      await t.test('sin JavaScript: 303 a /gracias/; con errores, una página con cada error y el camino de vuelta', async () => {
        const r = await post(envio({ t: '' }), { json: false, ip: '203.0.113.4' });
        assert.equal(r.status, 303);
        assert.equal(r.headers.get('location'), `${WEB}/gracias/`);
        const mal = await post(envio({ privacidad: '', t: '' }), { json: false, ip: '203.0.113.4' });
        assert.equal(mal.status, 422);
        const h = await mal.text();
        assert.match(h, /Para contestarte necesitamos tu consentimiento en la primera casilla\./);
        assert.match(h, /href="https:\/\/iemec-clinic\.com\/medicina-estetica-corporal\/lipolaser\/#te-llamamos"/);
        assert.match(mal.headers.get('content-security-policy'), /default-src 'none'/);
      });

      await t.test('robots: la trampa o un envío instantáneo contestan «recibido» y no se guarda nada', async () => {
        const antes = (await uno('SELECT COUNT(*) AS n FROM leads')).n;
        assert.deepEqual(await (await post(envio({ web: 'http://spam.example' }), { ip: '203.0.113.5' })).json(), { ok: true });
        assert.deepEqual(await (await post(envio({ t: '400' }), { ip: '203.0.113.5' })).json(), { ok: true });
        assert.equal((await uno('SELECT COUNT(*) AS n FROM leads')).n, antes);
      });

      await t.test('límite: 8 envíos por IP cada 15 minutos y 3 por teléfono al día', async () => {
        for (let i = 0; i < 8; i++) assert.notEqual((await post(envio(), { ip: '203.0.113.6' })).status, 429, `envío ${i + 1}`);
        const r = await post(envio(), { ip: '203.0.113.6' });
        assert.equal(r.status, 429);
        assert.deepEqual(await r.json(), { ok: false, error: 'demasiados_envios' });
        const tel = '611 000 777';
        for (let i = 0; i < 3; i++) assert.equal((await post(envio({ telefono: tel, mensaje: `envío ${i}` }), { ip: `203.0.113.${10 + i}` })).status, 200);
        assert.equal((await post(envio({ telefono: tel, mensaje: 'otro más' }), { ip: '203.0.113.20' })).status, 429);
      });
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
