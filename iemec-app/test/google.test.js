'use strict';
// Google y DataForSEO de verdad, contra la base y el puerto y sin salir a internet (fetch de mentira
// que contesta como su documentación): los avisos de Pub/Sub (token, guardado, cola y la reseña que
// llega a la importación), las tareas del cron (solo en real y con credenciales), las métricas y
// búsquedas con su plazo de 30 días, la ficha, las publicaciones y la malla de posiciones con su tope
// de gasto. Cuentas, fichas, reseñas y nombres, inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { rutasWebhooks } = require('../servidor/rutas/webhooks');
const fichaGoogle = require('../servidor/ficha-google');
const posiciones = require('../servidor/posiciones');
const cron = require('../servidor/cron');
const { descifrarCuerpo } = require('../servidor/entrada');
const { crearGoogle, crearVerificadorPubSub } = require('../servidor/integraciones/google');
const { crearDataForSeo } = require('../servidor/integraciones/dataforseo');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');

const CUENTA = '104756819302548861234';
const UBICACION = '4178325690123456789';
const PLACE_ID = 'ChIJPruebaDeLaClinica000001';
const ENV_GOOGLE = {
  GOOGLE_CLIENTE_ID: '123456789012-prueba.apps.googleusercontent.com', GOOGLE_CLIENTE_SECRETO: 'secreto-oauth-de-pruebas',
  GOOGLE_REFRESH_TOKEN: '1//refresco-de-pruebas', GOOGLE_CUENTA: CUENTA, GOOGLE_UBICACION: UBICACION,
};
const RUTA = `/v4/accounts/${CUENTA}/locations/${UBICACION}`;
const AUD = 'https://agenda.clinica-de-prueba.example/webhooks/google';
const EMAIL = 'avisos-ficha@iemec-app.iam.gserviceaccount.com';
const TOKEN_BUENO = 'eyJhbGciOiJSUzI1NiJ9.eyJwcnVlYmEiOnRydWV9.firma-de-pruebas';

const min = (d, n) => new Date(new Date(d).getTime() + n * 60000);
const json = (estado, cuerpo, cabeceras = {}) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json', ...cabeceras } });

function ponerEntorno(cambios) {
  const antes = {};
  for (const [k, v] of Object.entries(cambios)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => ponerEntorno(antes);
}

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

// Google de mentira: el token de OAuth sale solo; lo demás lo contesta «responder» (o 418).
function falsoGoogle(responder) {
  const pedidas = [];
  const fetch = async (url, o = {}) => {
    const p = { metodo: o.method || 'GET', url: new URL(url), cabeceras: new Headers(o.headers || {}), cuerpo: o.body ?? null };
    pedidas.push(p);
    if (p.url.href === 'https://oauth2.googleapis.com/token') return json(200, { access_token: 'ya29.a0-token-de-pruebas', expires_in: 3599, token_type: 'Bearer' });
    return (await responder(p)) || json(418, { error: { code: 418, message: `petición inesperada: ${p.metodo} ${p.url.href}`, status: 'PRUEBA' } });
  };
  return { fetch, pedidas, api: () => pedidas.filter((p) => p.url.host !== 'oauth2.googleapis.com') };
}
const googleReal = (falso, env = ENV_GOOGLE) => crearGoogle('real', { env, fetch: falso.fetch, esperar: async () => {}, azar: () => 0.5 });

function resenaDeGoogle(id, { estrellas = 'FIVE', comentario = 'Trato encantador y resultados naturales', creada = '2026-10-05T18:00:00Z', tocada = null, respuesta = null } = {}) {
  return {
    name: `accounts/${CUENTA}/locations/${UBICACION}/reviews/${id}`, reviewId: id,
    reviewer: { profilePhotoUrl: 'https://lh3.googleusercontent.com/a-/foto-de-prueba', displayName: 'Laura Prueba' },
    starRating: estrellas, comment: comentario, createTime: creada, updateTime: tocada || creada, ...(respuesta ? { reviewReply: respuesta } : {}),
  };
}

// El aviso push de Pub/Sub (el JSON de dentro va en base64).
const avisoPubSub = (datos, id = '2070443601311540') => ({
  message: { attributes: {}, data: Buffer.from(JSON.stringify(datos)).toString('base64'), messageId: id, message_id: id, publishTime: '2026-10-06T04:29:59.123Z', publish_time: '2026-10-06T04:29:59.123Z' },
  subscription: 'projects/iemec-app/subscriptions/avisos-ficha-push',
});

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, municipio, telefono, google_place_id) VALUES (1, 'Clínica de Prueba', 'Prueba', 'Boadilla del Monte', '+34600000000', ?)", [PLACE_ID]);
}

test('avisos de Google por Pub/Sub: token, guardado cifrado, cola y la reseña que llega a la importación', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const restaurar = ponerEntorno({ GOOGLE_PUBSUB_EMAIL: EMAIL, GOOGLE_PUBSUB_AUDIENCIA: AUD, NODE_ENV: 'test' });
  const ahora = new Date('2026-10-06T04:30:00Z'); // martes, 6:30 en Madrid: aún no toca lo del día
  const llamadas = [];
  const verificarGoogle = async (token, opciones) => {
    llamadas.push({ token, ...opciones });
    if (token !== TOKEN_BUENO) throw Object.assign(new Error('Token de Google no válido: la firma no cuadra'), { motivo: 'la firma no cuadra' });
    return { email: opciones.email };
  };
  const app = express();
  app.use(rutasWebhooks({ pool, reloj: () => ahora, verificarGoogle }));
  try {
    await sembrar(pool);
    await conServidor(app, async (base) => {
      const post = (cuerpo, token = TOKEN_BUENO) => fetch(`${base}/webhooks/google`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
      });
      const cuantos = async () => (await pool.query('SELECT COUNT(*) AS n FROM webhooks'))[0][0].n;
      const nueva = avisoPubSub({ type: 'NEW_REVIEW', review_name: `accounts/${CUENTA}/locations/${UBICACION}/reviews/AbFvOq0001`, location_name: `accounts/${CUENTA}/locations/${UBICACION}` });

      await t.test('sin token, 401; con uno malo, 403; y no se guarda nada', async () => {
        assert.equal((await post(nueva, null)).status, 401);
        assert.equal((await post(nueva, 'no-es-un-jwt')).status, 401);
        assert.equal((await post(nueva, 'eyJ.eyJ.malo')).status, 403);
        assert.equal(await cuantos(), 0);
      });

      await t.test('con el token bueno: 204, guardado cifrado y encolado, y el mismo aviso repetido no se duplica', async () => {
        const r = await post(nueva);
        assert.equal(r.status, 204);
        assert.deepEqual(llamadas.at(-1), { token: TOKEN_BUENO, audiencia: AUD, email: EMAIL }, 'con la audiencia y la cuenta de servicio de la configuración');
        const [[w]] = await pool.query('SELECT * FROM webhooks');
        assert.deepEqual([w.proveedor, w.evento, w.id_externo, Boolean(w.firma_ok)], ['google', 'NEW_REVIEW', 'pubsub:2070443601311540', true]);
        assert.match(w.cuerpo, /^aes:/);
        assert.deepEqual(JSON.parse(descifrarCuerpo(w.cuerpo)), nueva);
        const [[c]] = await pool.query('SELECT * FROM cola');
        assert.equal(c.tipo, 'webhook_google');
        assert.deepEqual(typeof c.carga === 'string' ? JSON.parse(c.carga) : c.carga, { webhookId: w.id });
        assert.equal((await post(nueva)).status, 204, 'Pub/Sub lo repite si tardamos: se contesta igual');
        assert.equal(await cuantos(), 1);
        assert.equal((await post({ hola: 'no soy Pub/Sub' })).status, 400);
        assert.equal((await post('{no es json')).status, 400);
      });

      await t.test('en producción sin GOOGLE_PUBSUB_EMAIL se rechaza; en el portátil entra sin firma', async () => {
        let volver = ponerEntorno({ GOOGLE_PUBSUB_EMAIL: undefined, NODE_ENV: 'production' });
        assert.equal((await post(avisoPubSub({ type: 'GOOGLE_UPDATE' }, '11'), null)).status, 503);
        volver();
        volver = ponerEntorno({ GOOGLE_PUBSUB_EMAIL: undefined });
        assert.equal((await post(avisoPubSub({ type: 'GOOGLE_UPDATE', location_name: `locations/${UBICACION}` }, '12'), null)).status, 204);
        volver();
        const [[w]] = await pool.query("SELECT firma_ok FROM webhooks WHERE id_externo = 'pubsub:12'");
        assert.equal(w.firma_ok, null);
      });
    });

    // El cron atiende los avisos con Google de mentira: la reseña se pide y va a la importación.
    let resena = resenaDeGoogle('AbFvOq0001');
    let caido = false;
    const falso = falsoGoogle((p) => {
      if (caido) return json(503, { error: { code: 503, message: 'The service is currently unavailable.', status: 'UNAVAILABLE' } });
      if (p.metodo === 'GET' && p.url.pathname === `${RUTA}/reviews/AbFvOq0001`) return json(200, resena);
      if (p.metodo === 'GET' && p.url.pathname === `${RUTA}/reviews/AbFvOqBorrada`) return json(404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } });
      return null;
    });
    const deps = { pool, google: googleReal(falso) };
    const env = {};

    await t.test('el cron pide la reseña a Google y la importa con su borrador; nada se publica', async () => {
      const r = await fichaGoogle.vuelta(deps, { ahora: min(ahora, 1), env });
      assert.equal(r.hechos, 2, 'la reseña y el aviso de cambios de Google');
      assert.equal(falso.api().filter((p) => p.url.pathname.endsWith('/reviews/AbFvOq0001')).length, 1);
      const [[f]] = await pool.query('SELECT * FROM resenas');
      assert.deepEqual([f.google_id, f.nota, f.texto, f.estado], ['AbFvOq0001', 5, 'Trato encantador y resultados naturales', 'borrador']);
      assert.ok(f.borrador_respuesta);
      assert.equal(falso.api().filter((p) => p.metodo !== 'GET').length, 0, 'nada se publica sin aprobación');
      const [[w]] = await pool.query("SELECT procesado_en, error FROM webhooks WHERE id_externo = 'pubsub:2070443601311540'");
      assert.ok(w.procesado_en);
      assert.equal(w.error, null);
      const [tareas] = await pool.query("SELECT titulo, urgente FROM tareas WHERE estado = 'abierta'");
      assert.deepEqual(tareas.map((x) => x.titulo), [fichaGoogle.TAREAS.cambiosDeGoogle]);
    });

    await t.test('la reseña cambiada se actualiza; los avisos de otra ficha no se tocan', async () => {
      resena = resenaDeGoogle('AbFvOq0001', { estrellas: 'THREE', comentario: 'Bien, aunque esperé un rato', tocada: '2026-10-06T04:31:00Z' });
      const guardar = (datos, id) => pool.query("INSERT INTO webhooks (proveedor, evento, id_externo, cuerpo, firma_ok) VALUES ('google', ?, ?, ?, TRUE)", [datos.type, `pubsub:${id}`, JSON.stringify(avisoPubSub(datos, id))]);
      const [w1] = await guardar({ type: 'UPDATED_REVIEW', review_name: `accounts/${CUENTA}/locations/${UBICACION}/reviews/AbFvOq0001` }, '21');
      const [w2] = await guardar({ type: 'NEW_REVIEW', review_name: `accounts/${CUENTA}/locations/999999/reviews/AbFvOqAjena` }, '22');
      const [w3] = await guardar({ type: 'NEW_REVIEW', review_name: `accounts/${CUENTA}/locations/${UBICACION}/reviews/AbFvOqBorrada` }, '23');
      const [w4] = await guardar({ type: 'VOICE_OF_MERCHANT_UPDATED', location_name: `locations/${UBICACION}` }, '24');
      const [w5] = await guardar({ type: 'GOOGLE_UPDATE', location_name: `locations/${UBICACION}` }, '25');
      assert.deepEqual(await fichaGoogle.procesarAviso(deps, w1.insertId, { ahora }), { tipo: 'UPDATED_REVIEW', leidas: 1, nuevas: 0 });
      const [[f]] = await pool.query('SELECT nota, texto FROM resenas');
      assert.deepEqual([f.nota, f.texto], [3, 'Bien, aunque esperé un rato']);
      const antes = falso.api().length;
      assert.deepEqual(await fichaGoogle.procesarAviso(deps, w2.insertId, { ahora }), { ajeno: true });
      assert.equal(falso.api().length, antes, 'de otra ficha no se pide nada');
      const [[aj]] = await pool.query('SELECT evento FROM webhooks WHERE id = ?', [w2.insertId]);
      assert.equal(aj.evento, 'ajeno');
      assert.deepEqual(await fichaGoogle.procesarAviso(deps, w3.insertId, { ahora }), { borrada: true });
      await fichaGoogle.procesarAviso(deps, w4.insertId, { ahora });
      await fichaGoogle.procesarAviso(deps, w5.insertId, { ahora });
      const [tareas] = await pool.query("SELECT titulo, urgente FROM tareas WHERE estado = 'abierta' ORDER BY id");
      assert.deepEqual(tareas.map((x) => [x.titulo, Boolean(x.urgente)]), [[fichaGoogle.TAREAS.cambiosDeGoogle, false], [fichaGoogle.TAREAS.control, true]], 'una sola tarea por asunto');
      assert.deepEqual(await fichaGoogle.procesarAviso(deps, w1.insertId, { ahora }), { omitido: true }, 'lo ya atendido no se repite');
    });

    await t.test('si Google falla, se reintenta por la cola y, al último intento, una persona lo sabe', async () => {
      caido = true;
      await pool.query("INSERT INTO webhooks (proveedor, evento, id_externo, cuerpo, firma_ok) VALUES ('google', 'NEW_REVIEW', 'pubsub:31', ?, TRUE)",
        [JSON.stringify(avisoPubSub({ type: 'NEW_REVIEW', review_name: `accounts/${CUENTA}/locations/${UBICACION}/reviews/AbFvOq0001` }, '31'))]);
      const [[w]] = await pool.query("SELECT id FROM webhooks WHERE id_externo = 'pubsub:31'");
      await pool.query("INSERT INTO cola (tipo, carga, ejecutar_en, max_intentos) VALUES ('webhook_google', ?, ?, 3)", [JSON.stringify({ webhookId: w.id }), ahora]);
      for (const m of [10, 15, 25]) await fichaGoogle.vuelta(deps, { ahora: min(ahora, m), env }); // antes de las 7:00
      const [[c]] = await pool.query("SELECT estado, intentos, ultimo_error FROM cola WHERE carga LIKE ?", [`%"webhookId":${w.id}%`]);
      assert.deepEqual([c.estado, c.intentos], ['fallido', 3]);
      assert.match(c.ultimo_error, /Google 503 UNAVAILABLE/);
      const [[x]] = await pool.query('SELECT error FROM webhooks WHERE id = ?', [w.id]);
      assert.match(x.error, /503/);
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE titulo LIKE 'Google: no se ha podido atender un aviso%'");
      assert.match(tarea.titulo, /Google 503/);
      caido = false;
    });
  } finally {
    restaurar();
    await pool.end();
  }
});

test('el token de verdad en la ruta: claves de Google (de mentira), firma buena y mala, y claves que no llegan', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const restaurar = ponerEntorno({ GOOGLE_PUBSUB_EMAIL: EMAIL, GOOGLE_PUBSUB_AUDIENCIA: AUD });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  let certificadosCaidos = false;
  const fetchCertificados = async (url) => {
    assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
    if (certificadosCaidos) return json(500, {});
    return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'clave-de-pruebas', alg: 'RS256', use: 'sig' }] }, { 'Cache-Control': 'public, max-age=60' });
  };
  const firmar = (carga) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'clave-de-pruebas', typ: 'JWT' })).toString('base64url');
    const c = Buffer.from(JSON.stringify(carga)).toString('base64url');
    return `${h}.${c}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${c}`), privateKey).toString('base64url')}`;
  };
  const ahoraS = Math.floor(Date.now() / 1000);
  const bueno = firmar({ aud: AUD, email: EMAIL, email_verified: true, iat: ahoraS - 5, exp: ahoraS + 3595, iss: 'https://accounts.google.com', sub: '1' });
  const otraAudiencia = firmar({ aud: 'https://otra.example/webhooks/google', email: EMAIL, email_verified: true, iat: ahoraS - 5, exp: ahoraS + 3595, iss: 'https://accounts.google.com', sub: '1' });
  const app = express();
  app.use(rutasWebhooks({ pool, verificarGoogle: crearVerificadorPubSub({ fetch: fetchCertificados }) }));
  try {
    await sembrar(pool);
    await conServidor(app, async (base) => {
      const post = (token, id) => fetch(`${base}/webhooks/google`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(avisoPubSub({ type: 'GOOGLE_UPDATE' }, id)) });
      assert.equal((await post(bueno, '41')).status, 204);
      assert.equal((await post(otraAudiencia, '42')).status, 403);
      const [h, c] = bueno.split('.');
      assert.equal((await post(`${h}.${c}.${Buffer.from('firma inventada').toString('base64url')}`, '43')).status, 403);
      const [filas] = await pool.query('SELECT id_externo FROM webhooks');
      assert.deepEqual(filas.map((f) => f.id_externo), ['pubsub:41']);
    });
    // Si las claves de Google no llegan, no se puede comprobar: 503 (Pub/Sub lo repetirá).
    const otraApp = express();
    certificadosCaidos = true;
    otraApp.use(rutasWebhooks({ pool, verificarGoogle: crearVerificadorPubSub({ fetch: fetchCertificados }) }));
    const errores = [];
    const consola = console.error;
    console.error = (...x) => errores.push(x.join(' '));
    try {
      await conServidor(otraApp, async (base) => {
        const r = await fetch(`${base}/webhooks/google`, { method: 'POST', headers: { Authorization: `Bearer ${bueno}` }, body: JSON.stringify(avisoPubSub({ type: 'GOOGLE_UPDATE' }, '44')) });
        assert.equal(r.status, 503);
      });
    } finally {
      console.error = consola;
    }
    assert.match(errores.join('\n'), /claves públicas de Google \(500\)/);
  } finally {
    restaurar();
    await pool.end();
  }
});

test('lo del día y de la semana de Google, por la cola: solo en real y con credenciales', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-05T05:30:00Z'); // lunes, 7:30 en Madrid
    const ficha = {
      name: `locations/${UBICACION}`, title: 'Clínica de Prueba',
      categories: { primaryCategory: { name: 'categories/gcid:beauty_salon', displayName: 'Centro de estética' } },
      metadata: { placeId: 'ChIJPruebaNuevoPlaceId000002', newReviewUri: 'https://search.google.com/local/writereview?placeid=ChIJPruebaNuevoPlaceId000002', hasVoiceOfMerchant: false, hasGoogleUpdated: true },
    };
    const resenas = [
      resenaDeGoogle('AbFvOqL1', { creada: '2026-10-04T10:00:00Z' }),
      resenaDeGoogle('AbFvOqL2', { estrellas: 'FOUR', creada: '2026-09-30T10:00:00Z', respuesta: { comment: '¡Gracias!', updateTime: '2026-09-30T12:00:00Z', reviewReplyState: 'APPROVED' } }),
      resenaDeGoogle('AbFvOqL3', { estrellas: 'TWO', comentario: 'No contestan al teléfono', creada: '2026-09-10T10:00:00Z' }),
    ];
    const falso = falsoGoogle((p) => {
      if (p.url.pathname === `${RUTA}/reviews`) return json(200, { reviews: resenas, averageRating: 3.7, totalReviewCount: 3 });
      if (p.url.pathname === `/v1/locations/${UBICACION}:fetchMultiDailyMetricsTimeSeries`) {
        return json(200, { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
          { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 3 }, value: '4' }, { date: { year: 2026, month: 10, day: 4 } }] } },
          { dailyMetric: 'WEBSITE_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 3 }, value: '11' }, { date: { year: 2026, month: 10, day: 4 }, value: '9' }] } },
        ] }] });
      }
      if (p.url.pathname === `/v1/locations/${UBICACION}/searchkeywords/impressions/monthly`) {
        return json(200, { searchKeywordsCounts: [
          { searchKeyword: 'clinica estetica boadilla', insightsValue: { value: '412' } },
          { searchKeyword: 'clínica estética boadilla', insightsValue: { value: '15' } },
          { searchKeyword: 'hifu facial', insightsValue: { threshold: '15' } },
        ] });
      }
      if (p.url.pathname === `/v1/locations/${UBICACION}`) return json(200, ficha);
      return null;
    });
    const google = googleReal(falso);

    await t.test('en simulado o sin el modo real, nada; sin credenciales, el error lo dice', async () => {
      assert.equal(fichaGoogle.activo({ google: crearGoogle('simulado') }), false);
      assert.equal(await fichaGoogle.vuelta({ pool, google: crearGoogle('simulado') }, { ahora: lunes }), null);
      assert.equal(fichaGoogle.activo({}, {}), false);
      assert.equal(fichaGoogle.activo({}, { MODO_GOOGLE: 'real' }), true);
      assert.equal(fichaGoogle.activo({}), false, 'con node --test, nunca el real a partir del .env');
      assert.throws(() => fichaGoogle.adaptador({}, { MODO_GOOGLE: 'real' }), /faltan las credenciales/);
      const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM cola');
      assert.equal(c.n, 0);
    });

    await t.test('antes de las 7:00 no se programa nada', async () => {
      const r = await fichaGoogle.vuelta({ pool, google }, { ahora: new Date('2026-10-05T04:59:00Z') });
      assert.equal(r.programados, undefined);
      assert.equal(falso.pedidas.length, 0);
    });

    await t.test('el lunes a las 7:30: reseñas de la semana y todas, métricas, ficha y búsquedas del mes pasado', async () => {
      const r = await fichaGoogle.vuelta({ pool, google }, { ahora: lunes });
      assert.deepEqual(r.programados, ['google_resenas', 'google_metricas', 'google_ficha', 'google_resenas', 'google_palabras']);
      assert.deepEqual([r.hechos, r.reintentos, r.fallidos], [5, 0, 0]);
      const [hechos] = await pool.query("SELECT tipo, clave_unica FROM cola WHERE estado = 'hecho' ORDER BY id");
      assert.deepEqual(hechos.map((x) => x.clave_unica), ['google-resenas-2026-10-05', 'google-metricas-2026-10-05', 'google-ficha-2026-10-05', 'google-resenas-todas-2026-10-05', 'google-palabras-2026-10-05']);

      // Reseñas: la de la semana y, con la lista completa, también la antigua.
      const [rs] = await pool.query('SELECT google_id, nota, estado FROM resenas ORDER BY google_id');
      assert.deepEqual(rs.map((x) => [x.google_id, x.nota, x.estado]), [['AbFvOqL1', 5, 'borrador'], ['AbFvOqL2', 4, 'publicada'], ['AbFvOqL3', 2, 'borrador']]);
      // Métricas de los últimos 30 días (hasta ayer), con su nombre en la app; el día sin valor es 0.
      const m = falso.api().find((p) => p.url.pathname.endsWith(':fetchMultiDailyMetricsTimeSeries')).url.searchParams;
      assert.deepEqual(['year', 'month', 'day'].map((k) => m.get(`dailyRange.start_date.${k}`)), ['2026', '9', '5']);
      assert.deepEqual(['year', 'month', 'day'].map((k) => m.get(`dailyRange.end_date.${k}`)), ['2026', '10', '4']);
      const [metricas] = await pool.query("SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, metrica, valor FROM metricas_gbp ORDER BY fecha, metrica");
      assert.deepEqual(metricas.map((x) => [x.fecha, x.metrica, x.valor]), [
        ['2026-10-03', 'clics_web', 11], ['2026-10-03', 'llamadas', 4], ['2026-10-04', 'clics_web', 9], ['2026-10-04', 'llamadas', 0],
      ]);
      // Búsquedas de septiembre: las que la base ve iguales (con y sin tilde) se suman; el umbral se guarda como tal.
      assert.equal(falso.api().find((p) => p.url.pathname.endsWith('/monthly')).url.searchParams.get('monthlyRange.start_month.month'), '9');
      const [busquedas] = await pool.query('SELECT mes, palabra, impresiones, umbral FROM busquedas_gbp ORDER BY palabra');
      assert.deepEqual(busquedas.map((x) => [x.mes, x.palabra, x.impresiones, x.umbral]), [['2026-09', 'clinica estetica boadilla', 427, null], ['2026-09', 'hifu facial', null, '15']]);
      // La ficha: el place ID nuevo pasa a la clínica, y lo que hay que mirar, a una persona.
      const [[cl]] = await pool.query('SELECT google_place_id FROM clinica');
      assert.equal(cl.google_place_id, 'ChIJPruebaNuevoPlaceId000002');
      const [[ev]] = await pool.query("SELECT datos FROM eventos WHERE tipo = 'google_place_id'");
      assert.deepEqual(typeof ev.datos === 'string' ? JSON.parse(ev.datos) : ev.datos, { antes: PLACE_ID, ahora: 'ChIJPruebaNuevoPlaceId000002' });
      const [tareas] = await pool.query("SELECT titulo, urgente FROM tareas ORDER BY id");
      assert.deepEqual(tareas.map((x) => [x.titulo, Boolean(x.urgente)]), [[fichaGoogle.TAREAS.sinControl, true], [fichaGoogle.TAREAS.cambiosDeGoogle, false]]);
      assert.equal(falso.api().filter((p) => p.metodo !== 'GET').length, 0, 'solo se lee');
    });

    await t.test('el mismo día no se repite, y la semana siguiente vuelve lo semanal', async () => {
      const antes = falso.pedidas.length;
      const r = await fichaGoogle.vuelta({ pool, google }, { ahora: min(lunes, 30) });
      assert.equal(r.programados, undefined);
      assert.equal(falso.pedidas.length, antes);
      const martes = await fichaGoogle.vuelta({ pool, google }, { ahora: new Date('2026-10-06T06:00:00Z') });
      assert.deepEqual(martes.programados, ['google_resenas', 'google_metricas', 'google_ficha'], 'el martes, solo lo del día');
      const otroLunes = await fichaGoogle.vuelta({ pool, google }, { ahora: new Date('2026-10-12T05:30:00Z') });
      assert.deepEqual(otroLunes.programados, ['google_resenas', 'google_metricas', 'google_ficha', 'google_resenas', 'google_palabras']);
    });

    await t.test('lo guardado de la Performance API, como mucho 30 días (en cualquier modo)', async () => {
      await pool.query("DELETE FROM metricas_gbp");
      await pool.query("INSERT INTO metricas_gbp (fecha, metrica, valor) VALUES ('2026-08-31', 'llamadas', 3), ('2026-09-05', 'llamadas', 5), ('2026-10-04', 'llamadas', 2)");
      await pool.query("INSERT INTO busquedas_gbp (mes, palabra, impresiones) VALUES ('2026-07', 'iemec', 90), ('2026-08', 'iemec', 120)");
      const ahora = new Date('2026-10-05T10:00:00Z');
      assert.equal(await fichaGoogle.purgarCadaDia(pool, ahora), 3);
      const [m] = await pool.query("SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS f FROM metricas_gbp ORDER BY fecha");
      assert.deepEqual(m.map((x) => x.f), ['2026-09-05', '2026-10-04']);
      const [b] = await pool.query('SELECT DISTINCT mes FROM busquedas_gbp ORDER BY mes');
      assert.deepEqual(b.map((x) => x.mes), ['2026-09']);
      assert.equal(await fichaGoogle.purgarCadaDia(pool, min(ahora, 60)), 0, 'una vez al día');
    });

    await t.test('solo con Places (sin acceso a Business Profile): la ficha y el aviso de reseñas sospechosas', async () => {
      const places = falsoGoogle((p) => (p.url.host === 'places.googleapis.com'
        ? json(200, { id: 'ChIJPruebaNuevoPlaceId000002', rating: 4.9, userRatingCount: 533, googleMapsLinks: { writeAReviewUri: 'https://www.google.com/maps/place//data=!4m3!3m2!1s0x0:0x0!12e1' }, consumerAlert: { overview: 'Aviso', languageCode: 'es' } })
        : null));
      const g = googleReal(places, { GOOGLE_PLACES_CLAVE: 'clave-places-de-pruebas', GOOGLE_PLACE_ID: 'ChIJPruebaNuevoPlaceId000002' });
      const r = await fichaGoogle.vuelta({ pool, google: g }, { ahora: new Date('2026-10-07T06:00:00Z') });
      assert.deepEqual(r.programados, ['google_ficha']);
      assert.equal(r.hechos, 1);
      assert.ok(places.api().every((p) => p.url.pathname === '/v1/places/ChIJPruebaNuevoPlaceId000002'));
      const [[x]] = await pool.query('SELECT COUNT(*) AS n FROM tareas WHERE titulo = ?', [fichaGoogle.TAREAS.sospechosas]);
      assert.equal(x.n, 1);
    });

    await t.test('un error sin arreglo (el token revocado) llega a una persona al primer intento, y la cola sigue probando', async () => {
      const revocado = crearGoogle('real', { env: ENV_GOOGLE, esperar: async () => {}, fetch: async () => json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }) });
      const r = await fichaGoogle.vuelta({ pool, google: revocado }, { ahora: new Date('2026-10-08T06:00:00Z') });
      assert.deepEqual([r.hechos, r.reintentos], [0, 3]);
      const [tareas] = await pool.query("SELECT titulo FROM tareas WHERE titulo LIKE 'Google: no se ha podido%' ORDER BY id");
      assert.deepEqual(tareas.map((x) => x.titulo.replace(/ \(.*$/, '')), ['Google: no se ha podido traer las reseñas', 'Google: no se ha podido traer las métricas', 'Google: no se ha podido revisar la ficha']);
      assert.ok(tareas.every((x) => /token de refresco ha caducado o se ha revocado/.test(x.titulo)));
      const [[c]] = await pool.query("SELECT estado, intentos FROM cola WHERE clave_unica = 'google-resenas-2026-10-08'");
      assert.deepEqual([c.estado, c.intentos], ['pendiente', 1]);
    });

    await t.test('si falla al programar el día (la base, un momento), la marca se quita y la vuelta siguiente lo programa', async () => {
      let fallar = 1;
      const tropieza = { query: (sql, a) => (/INSERT INTO cola/.test(sql) && fallar-- > 0 ? Promise.reject(new Error('Lock wait timeout exceeded')) : pool.query(sql, a)) };
      const ahora = new Date('2026-10-09T06:00:00Z');
      await assert.rejects(fichaGoogle.programar(tropieza, google, { ahora }), /Lock wait timeout/);
      const [[marca]] = await pool.query("SELECT COUNT(*) AS n FROM candados WHERE nombre = 'google-dia-2026-10-09'");
      assert.equal(marca.n, 0);
      assert.deepEqual(await fichaGoogle.programar(pool, google, { ahora: min(ahora, 1) }), ['google_resenas', 'google_metricas', 'google_ficha']);
    });
  } finally {
    await pool.end();
  }
});

test('publicaciones de la ficha: solo lo que aprueba una persona, y solo novedades', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const google = crearGoogle('simulado');
    const alta = (tipo, texto) => pool.query("INSERT INTO publicaciones_gbp (codigo, tipo, titulo, texto, boton_url, estado) VALUES (?, ?, 'Otoño', ?, ?, 'borrador')",
      [`gbp-10-${Math.random().toString(36).slice(2, 8)}`, tipo, texto, 'https://wa.me/34600000000?text=Hola%2C%20vengo%20de%20Google']);
    const [n] = await alta('novedad', 'En otoño aumenta la caída del cabello: diagnóstico capilar en IEMEC y opciones con el equipo médico.');
    await assert.rejects(fichaGoogle.publicarNovedad(pool, google, { publicacionId: n.insertId }), /aprueba una persona/);
    const [[sigue]] = await pool.query('SELECT estado FROM publicaciones_gbp WHERE id = ?', [n.insertId]);
    assert.equal(sigue.estado, 'borrador');
    const r = await fichaGoogle.publicarNovedad(pool, google, { publicacionId: n.insertId, aprobadaPor: 'recepcion@iemec' });
    assert.equal(r.estado, 'en_revision');
    const [[p]] = await pool.query('SELECT estado, google_id FROM publicaciones_gbp WHERE id = ?', [n.insertId]);
    assert.equal(p.estado, 'publicada');
    assert.match(p.google_id, /^localPosts\//);
    const [[ev]] = await pool.query("SELECT actor FROM eventos WHERE tipo = 'publicacion_gbp_publicada'");
    assert.equal(ev.actor, 'recepcion@iemec');
    await assert.rejects(fichaGoogle.publicarNovedad(pool, google, { publicacionId: n.insertId, aprobadaPor: 'recepcion@iemec' }), /está publicada/);
    const [o] = await alta('oferta', 'Diagnóstico capilar con precio especial en octubre.');
    await assert.rejects(fichaGoogle.publicarNovedad(pool, google, { publicacionId: o.insertId, aprobadaPor: 'recepcion@iemec' }), /solo se publican novedades/);
    const [b] = await alta('novedad', 'Botox con un 20% de descuento este mes.');
    await assert.rejects(fichaGoogle.publicarNovedad(pool, google, { publicacionId: b.insertId, aprobadaPor: 'recepcion@iemec' }), /publicidad sanitaria/);
    assert.equal(google.novedades.length, 1);
  } finally {
    await pool.end();
  }
});

// ── DataForSEO ─────────────────────────────────────────────────────────────────────────────

const sobre = (tareas, { status_code = 20000, status_message = 'Ok.' } = {}) => ({ version: '0.1.20260901', status_code, status_message, time: '0.1 sec.', cost: 0, tasks_count: tareas.length, tasks_error: 0, tasks: tareas });

// DataForSEO de mentira: crea las tareas, dice cuáles están listas y entrega sus resultados. La clínica
// sale 1.ª en su punto, 2.ª en los 8 de alrededor y en ningún otro sitio.
function falsoDataForSeo() {
  const tareas = new Map();
  const pedidas = [];
  let n = 0;
  const estado = { listas: () => true };
  const ficha = (puesto, titulo, placeId) => ({
    type: 'maps_search', rank_group: puesto, rank_absolute: puesto, title: titulo, place_id: placeId, cid: String(1000 + puesto),
    rating: { rating_type: 'Max5', value: 4.9, votes_count: 197, rating_max: null }, category: 'Clínica de medicina estética', additional_categories: ['Centro de estética'],
  });
  const puestoDe = (etiqueta) => {
    const punto = etiqueta.split('|')[2];
    if (punto === 'f0c0') return 1;
    return /^f[+-]?[01]c[+-]?[01]$/.test(punto) ? 2 : null;
  };
  const fetch = async (url, o = {}) => {
    const u = new URL(url);
    const cuerpo = o.body ? JSON.parse(o.body) : null;
    pedidas.push({ metodo: o.method || 'GET', url: u, cuerpo });
    if (u.pathname === '/v3/serp/google/maps/task_post') {
      return json(200, sobre(cuerpo.map((t) => {
        const id = `10051015-1535-0139-0000-${String(++n).padStart(12, '0')}`;
        tareas.set(id, t);
        return { id, status_code: 20100, status_message: 'Task Created.', cost: 0.0006, result_count: 0, data: { api: 'serp', function: 'task_post', se: 'google', se_type: 'maps', ...t }, result: null };
      })));
    }
    if (u.pathname === '/v3/serp/google/maps/tasks_ready') {
      const listas = [...tareas].filter(([id]) => estado.listas(id));
      return json(200, sobre([{ id: 'x', status_code: 20000, status_message: 'Ok.', cost: 0, result_count: listas.length, result: listas.map(([id, t]) => ({ id, se: 'google', se_type: 'maps', date_posted: '2026-10-05 05:30:01 +00:00', tag: t.tag, endpoint_advanced: `/v3/serp/google/maps/task_get/advanced/${id}` })) }]));
    }
    const m = /^\/v3\/serp\/google\/maps\/task_get\/advanced\/(.+)$/.exec(u.pathname);
    if (m) {
      const t = tareas.get(m[1]);
      if (!t) return json(200, sobre([{ id: m[1], status_code: 40401, status_message: 'Task Not Found.', result: null }]));
      if (!estado.listas(m[1])) return json(200, sobre([{ id: m[1], status_code: 40602, status_message: 'Task In Queue.', result: null }]));
      tareas.delete(m[1]);
      const p = puestoDe(t.tag);
      const otras = ['Clínica Uno de Prueba', 'Clínica Dos de Prueba', 'Clínica Tres de Prueba', 'Clínica Cuatro de Prueba', 'Clínica Cinco de Prueba'];
      const items = [];
      for (let puesto = 1; puesto <= 5; puesto++) items.push(puesto === p ? ficha(puesto, 'Clínica de Prueba', PLACE_ID) : ficha(puesto, otras.shift(), `ChIJOtra${puesto}`));
      return json(200, sobre([{ id: m[1], status_code: 20000, status_message: 'Ok.', result: [{ keyword: t.keyword, type: 'maps', items_count: items.length, items }] }]));
    }
    return json(418, { status_code: 41800, status_message: `petición inesperada: ${url}` });
  };
  return { fetch, pedidas, tareas, estado };
}

test('posiciones en Google Maps con DataForSEO: tope de gasto, lo que se guarda y lo que caduca', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const falso = falsoDataForSeo();
    const dataforseo = crearDataForSeo('real', { env: { DATAFORSEO_LOGIN: 'cuenta@prueba.example', DATAFORSEO_CLAVE: 'clave-de-pruebas' }, fetch: falso.fetch, esperar: async () => {} });
    const deps = { pool, dataforseo };
    // Tres búsquedas de 53 puntos (49 de la malla y 4 municipios) a 0,0006 $: 0,0318 $ cada una. Con un
    // tope de 0,07 $ caben dos.
    const env = { POSICIONES_PALABRAS: 'medicina estética, botox ,clínica capilar, Medicina Estetica', POSICIONES_TOPE_MES_USD: '0.07' };
    const lunes = new Date('2026-10-05T05:30:00Z');
    const posts = () => falso.pedidas.filter((p) => p.url.pathname.endsWith('/task_post'));

    await t.test('los ajustes: las palabras sin repetir (ni con otra tilde) y lo que no vale se dice', () => {
      assert.deepEqual(posiciones.ajustes(env).palabras, ['medicina estética', 'botox', 'clínica capilar']);
      assert.equal(posiciones.ajustes({}).palabras.length, 12);
      assert.throws(() => posiciones.ajustes({ POSICIONES_MALLA: 'mucha' }), /POSICIONES_MALLA/);
      assert.throws(() => posiciones.ajustes({ POSICIONES_MALLA: '8' }), /POSICIONES_MALLA no es válido: tiene que ser un número impar/);
      assert.equal(posiciones.ajustes({ POSICIONES_MALLA: '9' }).lado, 9);
      assert.throws(() => posiciones.ajustes({ POSICIONES_CENTRO: 'Boadilla' }), /POSICIONES_CENTRO/);
      assert.equal(posiciones.activo({ dataforseo: crearDataForSeo('simulado') }), false);
      assert.equal(posiciones.activo({}), false, 'con node --test, nunca el real a partir del .env');
      assert.throws(() => posiciones.adaptador({}, { MODO_DATAFORSEO: 'real' }), /DATAFORSEO_LOGIN/);
    });

    await t.test('el lunes a las 7:30 sale la pasada: solo las búsquedas que caben enteras en el tope', async () => {
      const r = await posiciones.vuelta(deps, { ahora: lunes, env });
      assert.equal(r.pasadaProgramada, '2026-10-05');
      assert.deepEqual(r.enviada, { pasada: '2026-10-05', enviadas: 106, errores: 0, fuera: ['clínica capilar'], gastadoMesUsd: 0.0636 });
      assert.deepEqual(posts().map((p) => p.cuerpo.length), [100, 6], 'en bloques de 100');
      const primera = posts()[0].cuerpo[0];
      assert.deepEqual(primera, {
        keyword: 'medicina estética', location_coordinate: '40.4471310,-3.9531569,15z', language_code: 'es', device: 'mobile', os: 'android',
        depth: 20, search_places: false, tag: 'iemec|2026-10-05|f+3c-3|medicina estética',
      });
      const [[g]] = await pool.query("SELECT COUNT(*) AS n, SUM(coste_usd) AS usd FROM posiciones_tareas WHERE estado = 'enviada'");
      assert.deepEqual([Number(g.n), Number(g.usd)], [106, 0.0636]);
      const [[ev]] = await pool.query("SELECT datos FROM eventos WHERE tipo = 'posiciones_tope'");
      assert.deepEqual((typeof ev.datos === 'string' ? JSON.parse(ev.datos) : ev.datos).fuera, ['clínica capilar']);
      assert.equal(await posiciones.gastoDelMes(pool, '2026-10-31'), 0.0636);
    });

    await t.test('se recoge a los 5 minutos lo que está listo; lo que no, en la vuelta siguiente', async () => {
      const r1 = await posiciones.vuelta(deps, { ahora: min(lunes, 1), env });
      assert.deepEqual(r1.cola, { hechos: 0, reintentos: 0, fallidos: 0, aplazados: 0 }, 'el trabajo de recoger espera 5 minutos');
      const ids = [...falso.tareas.keys()];
      const primeras = new Set(ids.slice(0, 100));
      falso.estado.listas = (id) => primeras.has(id);
      const r2 = await posiciones.vuelta(deps, { ahora: min(lunes, 7), env });
      assert.deepEqual(r2.recogida, { recogidas: 100, caducadas: 0, fallidas: 0, quedan: 6 });
      assert.equal(r2.cola.aplazados, 1);
      falso.estado.listas = () => true;
      const r3 = await posiciones.vuelta(deps, { ahora: min(lunes, 13), env });
      assert.deepEqual(r3.recogida, { recogidas: 6, caducadas: 0, fallidas: 0, quedan: 0 });
      assert.equal(r3.cola.hechos, 1);
      const [filas] = await pool.query("SELECT palabra, punto, puesto, resultados, primero, primero_categoria, primero_nota, primero_resenas FROM posiciones_maps WHERE palabra = 'botox' ORDER BY punto");
      assert.equal(filas.length, 53);
      const punto = (id) => filas.find((f) => f.punto === id);
      assert.deepEqual({ ...punto('f0c0') }, { palabra: 'botox', punto: 'f0c0', puesto: 1, resultados: 5, primero: 'Clínica de Prueba', primero_categoria: 'Clínica de medicina estética', primero_nota: '4.9', primero_resenas: 197 });
      assert.deepEqual([punto('f+1c-1').puesto, punto('f+1c-1').primero], [2, 'Clínica Uno de Prueba']);
      assert.deepEqual([punto('f+3c+3').puesto, punto('majadahonda').puesto], [null, null]);
      const res = await posiciones.resumen(pool);
      assert.equal(res.pasada, '2026-10-05');
      assert.deepEqual(res.palabras.find((x) => x.palabra === 'botox'), {
        palabra: 'botox', puntos: 53, conPuesto: 9, puestoMedio: 1.9, puestoMedioTotal: 17.8, top3: 17, primero: 1,
        rivales: [{ nombre: 'Clínica Uno de Prueba', puntos: 52 }],
      });
    });

    await t.test('una segunda pasada en el mismo mes no pasa del tope; si se reintenta, no paga dos veces', async () => {
      const antes = posts().length;
      const r = await posiciones.enviarPasada(deps, { pasada: '2026-10-12', ahora: new Date('2026-10-12T05:30:00Z'), env });
      assert.deepEqual([r.enviadas, r.fuera], [0, ['medicina estética', 'botox', 'clínica capilar']]);
      assert.equal(posts().length, antes, 'no sale nada');
      const holgado = { ...env, POSICIONES_TOPE_MES_USD: '1' };
      assert.equal((await posiciones.enviarPasada(deps, { pasada: '2026-10-12', ahora: new Date('2026-10-12T05:30:00Z'), env: holgado })).enviadas, 159);
      assert.equal((await posiciones.enviarPasada(deps, { pasada: '2026-10-12', ahora: new Date('2026-10-12T05:31:00Z'), env: holgado })).enviadas, 0, 'lo ya enviado no se vuelve a pagar');
      assert.equal(posts().length, antes + 2);
    });

    await t.test('lo que no llega en 24 horas caduca; lo que DataForSEO ya no tiene, falla', async () => {
      falso.estado.listas = () => false;
      const r = await posiciones.recogerPendientes(deps, { ahora: new Date('2026-10-13T06:00:00Z'), env });
      assert.deepEqual(r, { recogidas: 0, caducadas: 159, fallidas: 0, quedan: 0 });
      await pool.query("INSERT INTO posiciones_tareas (id, pasada, palabra, punto, lat, lng, zoom, profundidad, coste_usd, enviada_en) VALUES ('10051015-1535-0139-0000-999999999999', '2026-10-13', 'botox', 'f0c0', 40.4, -3.9, 15, 20, 0.0006, '2026-10-13 06:00:00')");
      falso.estado.listas = () => true;
      falso.tareas.clear();
      const fetchFalso = falso.fetch;
      // DataForSEO la da por lista, pero al pedirla ya no existe (40401): fallida, no se reintenta sin fin.
      const conFantasma = crearDataForSeo('real', { env: { DATAFORSEO_LOGIN: 'x', DATAFORSEO_CLAVE: 'y' }, esperar: async () => {}, fetch: async (url, o) => {
        if (String(url).endsWith('/tasks_ready')) return json(200, sobre([{ id: 'x', status_code: 20000, result: [{ id: '10051015-1535-0139-0000-999999999999', tag: 't' }] }]));
        return fetchFalso(url, o);
      } });
      const r2 = await posiciones.recogerPendientes({ pool, dataforseo: conFantasma }, { ahora: new Date('2026-10-13T06:10:00Z'), env });
      assert.deepEqual(r2, { recogidas: 0, caducadas: 0, fallidas: 1, quedan: 0 });
      const [[f]] = await pool.query("SELECT estado, error FROM posiciones_tareas WHERE id = '10051015-1535-0139-0000-999999999999'");
      assert.equal(f.estado, 'fallida');
      assert.match(f.error, /40401/);
    });

    await t.test('sin el place ID de la clínica no se gasta nada, y una persona lo sabe al momento', async () => {
      await pool.query('UPDATE clinica SET google_place_id = NULL');
      const antes = posts().length;
      await assert.rejects(posiciones.enviarPasada(deps, { pasada: '2026-10-19', ahora: new Date('2026-10-19T05:30:00Z'), env: { ...env, POSICIONES_TOPE_MES_USD: '5' } }), /place ID/);
      const r = await posiciones.vuelta(deps, { ahora: new Date('2026-10-19T05:30:00Z'), env: { ...env, POSICIONES_TOPE_MES_USD: '5' } });
      assert.equal(r.pasadaProgramada, '2026-10-19');
      assert.equal(r.cola.reintentos, 1);
      assert.equal(posts().length, antes);
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE titulo LIKE 'DataForSEO: no se ha podido enviar la pasada%'");
      assert.match(tarea.titulo, /Falta el place ID/);
    });

    await t.test('una configuración que no vale no deja la semana sin medir sin que nadie lo sepa', async () => {
      await assert.rejects(posiciones.vuelta(deps, { ahora: new Date('2026-10-26T06:30:00Z'), env: { ...env, POSICIONES_MALLA: '8' } }), /impar/);
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE titulo LIKE 'DataForSEO: la configuración de la malla no vale%'");
      assert.match(tarea.titulo, /POSICIONES_MALLA/);
      const [[marca]] = await pool.query("SELECT COUNT(*) AS n FROM candados WHERE nombre = 'posiciones-semana-2026-10-26'");
      assert.equal(marca.n, 0, 'la semana sigue pendiente para cuando se arregle');
    });
  } finally {
    await pool.end();
  }
});

test('el cron: lo de Google y DataForSEO va aparte, con su candado, y solo en real', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const base = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
    const ahora = new Date('2026-10-06T04:30:00Z'); // martes, 6:30 en Madrid
    let i = await cron.vuelta({ pool, deps: { ...base }, ahora });
    assert.deepEqual([i.google, i.posiciones], [undefined, undefined], 'sin nada en real, nada');
    i = await cron.vuelta({ pool, deps: { ...base, google: crearGoogle('simulado'), dataforseo: crearDataForSeo('simulado') }, ahora: min(ahora, 1) });
    assert.deepEqual([i.google, i.posiciones], [undefined, undefined], 'en simulado, tampoco');

    const google = googleReal(falsoGoogle(() => null));
    const dataforseo = crearDataForSeo('real', { env: { DATAFORSEO_LOGIN: 'x', DATAFORSEO_CLAVE: 'y' }, fetch: falsoDataForSeo().fetch, esperar: async () => {} });
    i = await cron.vuelta({ pool, deps: { ...base, google, dataforseo }, ahora: min(ahora, 2) });
    assert.deepEqual(i.google, { hechos: 0, reintentos: 0, fallidos: 0, aplazados: 0 });
    assert.deepEqual(i.posiciones, { cola: { hechos: 0, reintentos: 0, fallidos: 0, aplazados: 0 } });
    assert.ok('cola' in i && 'entrada' in i, 'lo de cada minuto, como siempre');

    // Otro cron tiene el candado de Google: este se aparta (y lo de cada minuto lo hace igual).
    await pool.query("REPLACE INTO candados (nombre, dueno, hasta) VALUES ('cron-google', 'otro-cron', ?)", [min(ahora, 10)]);
    i = await cron.vuelta({ pool, deps: { ...base, google, dataforseo }, ahora: min(ahora, 3) });
    assert.deepEqual([i.google, i.posiciones, typeof i.entrada], [undefined, undefined, 'object']);
    await pool.query("DELETE FROM candados WHERE nombre = 'cron-google'");

    // Si falla, lo dice el informe y lo demás sigue.
    const roto = { modo: 'real', get capacidades() { throw new Error('Google roto de prueba'); } };
    i = await cron.vuelta({ pool, deps: { ...base, google: roto, dataforseo }, ahora: new Date('2026-10-06T05:10:00Z') });
    assert.deepEqual(i.google, { error: 'Google roto de prueba' });
    assert.ok(i.posiciones.cola, 'DataForSEO sigue');
  } finally {
    await pool.end();
  }
});
