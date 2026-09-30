'use strict';
// El adaptador de Google. El real se prueba con un fetch de mentira que contesta como la documentación
// pública de Google (direcciones, cabeceras, páginas, errores y cuotas): nunca sale nada a internet.
// Las cuentas, fichas, reseñas y nombres son inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { crearGoogle, crearVerificadorPubSub, leerAvisoPubSub, TIPOS_AVISO } = require('./google');

const CUENTA = '104756819302548861234';
const UBICACION = '4178325690123456789';
const PLACE_ID = 'ChIJPruebaDeLaClinica000001';
const ENV = {
  GOOGLE_CLIENTE_ID: '123456789012-prueba.apps.googleusercontent.com',
  GOOGLE_CLIENTE_SECRETO: 'secreto-oauth-de-pruebas',
  GOOGLE_REFRESH_TOKEN: '1//refresco-de-pruebas',
  GOOGLE_CUENTA: `accounts/${CUENTA}`,
  GOOGLE_UBICACION: `locations/${UBICACION}`,
};
const RUTA = `/v4/accounts/${CUENTA}/locations/${UBICACION}`;

const json = (estado, cuerpo, cabeceras = {}) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json; charset=UTF-8', ...cabeceras } });
const errorGoogle = (estado, status, message, cabeceras = {}) => json(estado, { error: { code: estado, message, status } }, cabeceras);

// Un Google de mentira: el token de OAuth sale solo; lo demás contesta lo que se le diga (una vez, o
// siempre). Lo que no se espera contesta 418, que no se reintenta: la prueba falla y dice qué fue.
function falsoGoogle({ caducaEn = 3599 } = {}) {
  const pedidas = [];
  const respuestas = [];
  let tokens = 0;
  async function fetch(url, o = {}) {
    const u = new URL(url);
    const p = { metodo: o.method || 'GET', url: u, cabeceras: new Headers(o.headers || {}), cuerpo: o.body ?? null };
    pedidas.push(p);
    if (u.href === 'https://oauth2.googleapis.com/token') {
      tokens++;
      return json(200, { access_token: `ya29.a0-token-${tokens}`, expires_in: caducaEn, scope: 'https://www.googleapis.com/auth/business.manage', token_type: 'Bearer' });
    }
    const i = respuestas.findIndex((x) => x.si(p));
    if (i < 0) return errorGoogle(418, 'PRUEBA', `petición inesperada: ${p.metodo} ${u.href}`);
    const x = respuestas[i];
    if (!x.siempre) respuestas.splice(i, 1);
    if (x.r instanceof Error) throw x.r;
    return typeof x.r === 'function' ? x.r(p) : x.r;
  }
  return {
    fetch,
    pedidas,
    get tokens() { return tokens; },
    cuando(si, r, { siempre = false } = {}) { respuestas.push({ si, r, siempre }); return this; },
    api: () => pedidas.filter((p) => p.url.host !== 'oauth2.googleapis.com'),
  };
}
const es = (ruta, metodo = 'GET') => (p) => p.metodo === metodo && p.url.pathname === ruta;

function relojFalso(inicio = '2026-10-06T10:00:00Z') {
  let t = new Date(inicio).getTime();
  const esperas = [];
  return {
    reloj: () => new Date(t),
    esperar: async (ms) => { esperas.push(ms); t += ms; },
    avanzar: (ms) => { t += ms; },
    esperas,
  };
}

function real(falso, { env = ENV, tiempo = relojFalso(), ...mas } = {}) {
  return crearGoogle('real', { env, fetch: falso.fetch, reloj: tiempo.reloj, esperar: tiempo.esperar, azar: () => 0.5, ...mas });
}

// Una reseña como la devuelve la API v4 (accounts.locations.reviews).
function resenaDeGoogle(id, { estrellas = 'FIVE', comentario = null, respuesta = null, anonima = false, creada = '2026-10-01T10:00:00.123456Z', tocada = null, nombre = 'Laura Prueba' } = {}) {
  return {
    name: `accounts/${CUENTA}/locations/${UBICACION}/reviews/${id}`,
    reviewId: id,
    reviewer: anonima ? { displayName: 'Un usuario de Google', isAnonymous: true } : { profilePhotoUrl: 'https://lh3.googleusercontent.com/a-/foto-de-prueba', displayName: nombre },
    starRating: estrellas,
    ...(comentario ? { comment: comentario } : {}),
    createTime: creada,
    updateTime: tocada || creada,
    ...(respuesta ? { reviewReply: respuesta } : {}),
    reviewMediaItems: [{ thumbnailUrl: 'https://lh3.googleusercontent.com/p/miniatura-de-prueba', videoUrl: '' }],
    reviewReplyUrl: `https://business.google.com/reviews/reply/${id}`,
  };
}

test('simulado: la interfaz de siempre (listarResenas, responderResena) y lo nuevo, sin salir a internet', async () => {
  const g = crearGoogle('simulado', {
    resenas: [
      { googleId: 'g1', autor: 'Laura G.', nota: 5, texto: 'Trato encantador', publicadaEn: '2026-10-06T15:00:00Z' },
      { googleId: 'g2', autor: 'Pedro', nota: 2, texto: 'No contestan', publicadaEn: '2026-09-01T09:00:00Z' },
    ],
    ficha: { placeId: PLACE_ID, newReviewUri: `https://search.google.com/local/writereview?placeid=${PLACE_ID}` },
  });
  assert.equal(g.modo, 'simulado');
  assert.equal((await g.listarResenas()).length, 2);
  assert.deepEqual((await g.listarResenas({ desde: '2026-10-01T00:00:00Z' })).map((r) => r.googleId), ['g1']);
  assert.equal((await g.obtenerResena('g2')).nota, 2);
  assert.equal(await g.obtenerResena('no-existe'), null);
  const r = await g.responderResena('g1', '  ¡Muchas gracias, Laura!  ');
  assert.equal(r.ok, true);
  assert.deepEqual(g.publicadas, [{ googleId: 'g1', texto: '¡Muchas gracias, Laura!' }]);
  await assert.rejects(g.responderResena('g1', 'ñ'.repeat(2049)), /4096/);
  assert.deepEqual(await g.borrarRespuesta('g1'), { ok: true });
  const f = await g.obtenerFicha();
  assert.equal(f.placeId, PLACE_ID);
  assert.match(f.newReviewUri, /writereview/);
  assert.deepEqual(await crearGoogle('simulado').obtenerFicha().then((x) => [x.placeId, x.newReviewUri]), [null, null]);
  await assert.rejects(g.publicarNovedad({ texto: 'Otoño y caída del cabello: valoración en IEMEC.' }), /aprueba una persona/);
  assert.equal((await g.publicarNovedad({ texto: 'Otoño y caída del cabello: valoración en IEMEC.', aprobadaPor: 'recepcion@iemec' })).estado, 'en_revision');
  assert.equal(g.novedades.length, 1);
});

test('real: sin credenciales no arranca, y con OAuth a medias dice qué falta', () => {
  assert.throws(() => crearGoogle('real', { env: {} }), /faltan las credenciales/);
  assert.throws(() => crearGoogle('real', { env: { GOOGLE_CLIENTE_ID: 'x', GOOGLE_REFRESH_TOKEN: 'y' } }), /faltan GOOGLE_CLIENTE_SECRETO/);
  assert.throws(() => crearGoogle('real', { env: { ...ENV, GOOGLE_CUENTA: 'cuenta-rara' } }), /GOOGLE_CUENTA/);
  const g = crearGoogle('real', { env: { ...ENV, GOOGLE_CUENTA: '', GOOGLE_UBICACION: '' } });
  assert.deepEqual(g.capacidades, { perfil: true, ficha: false, places: false }, 'con OAuth y sin ficha, solo sirve para buscar la cuenta y la ubicación');
  assert.deepEqual(crearGoogle('real', { env: ENV }).capacidades, { perfil: true, ficha: true, places: false });
});

test('real: el token se pide con el de refresco, se reutiliza y se renueva un minuto antes de caducar', async () => {
  const falso = falsoGoogle();
  const tiempo = relojFalso();
  falso.cuando(es(`${RUTA}/reviews`), () => json(200, { reviews: [], totalReviewCount: 0 }), { siempre: true });
  const g = real(falso, { tiempo });
  await g.paginaResenas();
  await g.paginaResenas();
  assert.equal(falso.tokens, 1, 'el mismo token para las dos');
  const pedido = falso.pedidas[0];
  assert.equal(pedido.metodo, 'POST');
  assert.equal(pedido.cabeceras.get('content-type'), 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(pedido.cuerpo)), {
    client_id: ENV.GOOGLE_CLIENTE_ID, client_secret: ENV.GOOGLE_CLIENTE_SECRETO, refresh_token: ENV.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token',
  });
  assert.equal(falso.api()[0].cabeceras.get('authorization'), 'Bearer ya29.a0-token-1');
  tiempo.avanzar(3599 * 1000 - 59 * 1000); // a menos de un minuto de caducar
  await g.paginaResenas();
  assert.equal(falso.tokens, 2);
  assert.equal(falso.api().at(-1).cabeceras.get('authorization'), 'Bearer ya29.a0-token-2');
});

test('real: si Google dice 401 (token revocado antes de tiempo), se pide otro y se repite una vez', async () => {
  const falso = falsoGoogle();
  falso.cuando(es(`${RUTA}/reviews`), errorGoogle(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'))
    .cuando(es(`${RUTA}/reviews`), json(200, { reviews: [], totalReviewCount: 0 }));
  await real(falso).paginaResenas();
  assert.equal(falso.tokens, 2);
  assert.deepEqual(falso.api().map((p) => p.cabeceras.get('authorization')), ['Bearer ya29.a0-token-1', 'Bearer ya29.a0-token-2']);
  // Y si vuelve a decir 401, error claro (no un bucle).
  const otro = falsoGoogle();
  otro.cuando(es(`${RUTA}/reviews`), () => errorGoogle(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'), { siempre: true });
  await assert.rejects(real(otro).paginaResenas(), (err) => /Google 401/.test(err.message) && /GOOGLE_REFRESH_TOKEN/.test(err.message) && err.permanente === true);
  assert.equal(otro.api().length, 2);
});

test('real: token de refresco caducado o revocado → error claro y permanente (sin el token en el mensaje)', async () => {
  const fetch = async () => json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
  const g = crearGoogle('real', { env: ENV, fetch, esperar: async () => {} });
  await assert.rejects(g.paginaResenas(), (err) => err.permanente === true && /volver a autorizar/.test(err.message) && /Testing/.test(err.message) && !err.message.includes(ENV.GOOGLE_REFRESH_TOKEN));
  const cliente = crearGoogle('real', { env: ENV, fetch: async () => json(401, { error: 'invalid_client', error_description: 'Unauthorized' }), esperar: async () => {} });
  await assert.rejects(cliente.paginaResenas(), /cliente OAuth no vale/);
});

test('real: reseñas en páginas de 50, de la última tocada hacia atrás, con lo que se lleva la app (y nada más)', async () => {
  const falso = falsoGoogle();
  const lote = (desde, n) => Array.from({ length: n }, (_, i) => resenaDeGoogle(`AbFvOq${String(desde + i).padStart(4, '0')}`, {
    comentario: 'Muy buena experiencia', creada: new Date(Date.UTC(2026, 8, 30) - (desde + i) * 3600000).toISOString(),
  }));
  const pagina1 = lote(0, 50);
  pagina1[0] = resenaDeGoogle('AbFvOq0000', {
    estrellas: 'FOUR', comentario: 'Trato encantador, algo de espera', creada: '2026-09-29T08:00:00.123456Z', tocada: '2026-09-30T18:30:00Z',
    respuesta: { comment: '¡Gracias por tu opinión, Laura!', updateTime: '2026-09-30T19:00:00Z', reviewReplyState: 'APPROVED' },
  });
  pagina1[1] = resenaDeGoogle('AbFvOq0001', {
    estrellas: 'ONE', comentario: 'No me cogen el teléfono', anonima: true, creada: '2026-09-29T07:00:00Z',
    respuesta: { comment: 'Sentimos lo de tu tratamiento', updateTime: '2026-09-29T09:00:00Z', reviewReplyState: 'REJECTED', policyViolation: 'PERSONAL_INFO' },
  });
  pagina1[2] = resenaDeGoogle('AbFvOq0002', { estrellas: 'STAR_RATING_UNSPECIFIED', creada: '2026-09-29T06:00:00Z' });
  falso.cuando((p) => es(`${RUTA}/reviews`)(p) && !p.url.searchParams.has('pageToken'), () => json(200, { reviews: pagina1, averageRating: 4.9, totalReviewCount: 102, nextPageToken: 'pagina-2' }), { siempre: true })
    .cuando((p) => p.url.searchParams.get('pageToken') === 'pagina-2', json(200, { reviews: lote(50, 50), averageRating: 4.9, totalReviewCount: 102, nextPageToken: 'pagina-3' }))
    .cuando((p) => p.url.searchParams.get('pageToken') === 'pagina-3', json(200, { reviews: lote(100, 2), averageRating: 4.9, totalReviewCount: 102 }));
  const g = real(falso);
  const lista = await g.listarResenas();
  assert.equal(lista.length, 101, 'la que no tiene estrellas no se puede guardar');
  const pedidas = falso.api();
  assert.equal(pedidas.length, 3);
  for (const p of pedidas) {
    assert.equal(`${p.url.origin}${p.url.pathname}`, `https://mybusiness.googleapis.com${RUTA}/reviews`);
    assert.equal(p.url.searchParams.get('pageSize'), '50');
    assert.equal(p.url.searchParams.get('orderBy'), 'updateTime desc');
    assert.ok(p.url.search.includes('orderBy=updateTime%20desc'));
  }
  assert.deepEqual(pedidas.map((p) => p.url.searchParams.get('pageToken')), [null, 'pagina-2', 'pagina-3']);
  assert.equal(falso.tokens, 1);
  assert.deepEqual(lista[0], {
    googleId: 'AbFvOq0000', autor: 'Laura Prueba', nota: 4, texto: 'Trato encantador, algo de espera',
    publicadaEn: '2026-09-29T08:00:00.123Z', actualizadaEn: '2026-09-30T18:30:00.000Z',
    respuesta: '¡Gracias por tu opinión, Laura!', respondidaEn: '2026-09-30T19:00:00.000Z',
    estadoRespuesta: 'aprobada', motivoRechazo: null, motivoRechazoTexto: null,
  });
  assert.equal(lista[1].autor, null, 'anónima');
  assert.equal(lista[1].nota, 1);
  assert.equal(lista[1].estadoRespuesta, 'rechazada');
  assert.equal(lista[1].motivoRechazo, 'PERSONAL_INFO');
  assert.match(lista[1].motivoRechazoTexto, /datos de salud/);
  assert.ok(!JSON.stringify(lista).includes('lh3.googleusercontent.com'), 'ni la foto de quien escribe ni sus fotos');
  const p1 = await g.paginaResenas();
  assert.deepEqual([p1.notaMedia, p1.total, p1.siguiente], [4.9, 102, 'pagina-2']);
});

test('real: con «desde» deja de pedir páginas al llegar a lo ya visto', async () => {
  const falso = falsoGoogle();
  const pagina = ['2026-10-05T10:00:00Z', '2026-10-01T10:00:00Z', '2026-09-27T10:00:00Z', '2026-09-20T10:00:00Z']
    .map((t, i) => resenaDeGoogle(`AbFvOqD${i}`, { comentario: 'Genial', creada: t }));
  falso.cuando(es(`${RUTA}/reviews`), json(200, { reviews: pagina, totalReviewCount: 90, nextPageToken: 'no-hace-falta' }));
  const lista = await real(falso).listarResenas({ desde: '2026-09-28T00:00:00Z' });
  assert.deepEqual(lista.map((r) => r.googleId), ['AbFvOqD0', 'AbFvOqD1']);
  assert.equal(falso.api().length, 1, 'no pide la página 2');
});

test('real: responder y quitar la respuesta (PUT y DELETE …/reply), con el límite de 4096 bytes', async () => {
  const falso = falsoGoogle();
  falso.cuando(es(`${RUTA}/reviews/AbFvOq0001/reply`, 'PUT'), (p) => json(200, { comment: JSON.parse(p.cuerpo).comment, updateTime: '2026-10-06T10:00:05Z', reviewReplyState: 'PENDING' }))
    .cuando(es(`${RUTA}/reviews/AbFvOq0001/reply`, 'DELETE'), json(200, {}));
  const g = real(falso);
  const texto = 'Hola, sentimos mucho que tu experiencia no haya sido la que esperabas. Llámanos al 722 83 32 85 y lo vemos con calma.';
  assert.deepEqual(await g.responderResena('AbFvOq0001', texto), { ok: true, estado: 'pendiente', actualizadaEn: '2026-10-06T10:00:05.000Z' });
  const put = falso.api()[0];
  assert.equal(put.url.href, `https://mybusiness.googleapis.com${RUTA}/reviews/AbFvOq0001/reply`);
  assert.equal(put.cabeceras.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(put.cuerpo), { comment: texto });
  assert.deepEqual(await g.borrarRespuesta('AbFvOq0001'), { ok: true });
  assert.equal(falso.api()[1].metodo, 'DELETE');

  const antes = falso.pedidas.length;
  await assert.rejects(g.responderResena('AbFvOq0001', 'ñ'.repeat(2049)), /4098 bytes.*4096/);
  await assert.rejects(g.responderResena('AbFvOq0001', '   '), /vacía/);
  await assert.rejects(g.responderResena('../../locations/otra', 'Gracias'), /no válido/);
  assert.equal(falso.pedidas.length, antes, 'nada de eso sale a Google');
  falso.cuando(es(`${RUTA}/reviews/AbFvOq0001/reply`, 'PUT'), json(200, { comment: 'x', updateTime: '2026-10-06T10:01:00Z', reviewReplyState: 'PENDING' }));
  assert.equal((await g.responderResena('AbFvOq0001', 'ñ'.repeat(2048))).ok, true, '4096 bytes justos, sí');
});

test('real: ante 429 y 5xx espera y reintenta (Retry-After o 1, 2, 4 s); lo que no se arregla, error claro', async () => {
  const pagina = () => json(200, { reviews: [], totalReviewCount: 0 });
  const ruta = es(`${RUTA}/reviews`);

  let falso = falsoGoogle();
  let tiempo = relojFalso();
  falso.cuando(ruta, errorGoogle(429, 'RESOURCE_EXHAUSTED', "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute'", { 'Retry-After': '7' })).cuando(ruta, pagina());
  await real(falso, { tiempo }).paginaResenas();
  assert.deepEqual(tiempo.esperas, [7000], 'lo que dice Retry-After');

  falso = falsoGoogle();
  tiempo = relojFalso();
  falso.cuando(ruta, errorGoogle(503, 'UNAVAILABLE', 'The service is currently unavailable.')).cuando(ruta, errorGoogle(500, 'INTERNAL', 'Internal error encountered.')).cuando(ruta, pagina());
  await real(falso, { tiempo }).paginaResenas();
  assert.deepEqual(tiempo.esperas, [1000, 2000]);

  falso = falsoGoogle();
  tiempo = relojFalso();
  falso.cuando(ruta, () => errorGoogle(500, 'INTERNAL', 'Internal error encountered.'), { siempre: true });
  await assert.rejects(real(falso, { tiempo }).paginaResenas(), (err) => /Google 500 INTERNAL/.test(err.message) && err.reintentable === true);
  assert.deepEqual(tiempo.esperas, [1000, 2000, 4000]);
  assert.equal(falso.api().length, 4, 'la primera y tres reintentos');

  falso = falsoGoogle();
  tiempo = relojFalso();
  falso.cuando(ruta, new TypeError('fetch failed')).cuando(ruta, pagina());
  await real(falso, { tiempo }).paginaResenas();
  assert.deepEqual(tiempo.esperas, [1000], 'un fallo de red también se reintenta');

  // El azar reparte las esperas entre la mitad y vez y media.
  falso = falsoGoogle();
  tiempo = relojFalso();
  falso.cuando(ruta, errorGoogle(503, 'UNAVAILABLE', 'x')).cuando(ruta, pagina());
  await real(falso, { tiempo, azar: () => 0 }).paginaResenas();
  assert.deepEqual(tiempo.esperas, [500]);

  // Si pide esperar más de lo razonable, no se espera aquí: lo reintenta la cola.
  falso = falsoGoogle();
  tiempo = relojFalso();
  falso.cuando(ruta, errorGoogle(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', { 'Retry-After': '120' }));
  await assert.rejects(real(falso, { tiempo }).paginaResenas(), (err) => err.reintentable === true && /aún no ha aprobado el acceso/.test(err.message));
  assert.deepEqual(tiempo.esperas, []);

  // Un 400 no se arregla reintentando.
  falso = falsoGoogle();
  tiempo = relojFalso();
  falso.cuando(ruta, errorGoogle(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.'));
  await assert.rejects(real(falso, { tiempo }).paginaResenas(), (err) => err.permanente === true && err.estado === 400 && /INVALID_ARGUMENT/.test(err.message));
  assert.deepEqual(tiempo.esperas, []);

  falso = falsoGoogle();
  falso.cuando(ruta, errorGoogle(403, 'PERMISSION_DENIED', 'The caller does not have permission'));
  await assert.rejects(real(falso).paginaResenas(), /gestora de la ficha/);
});

test('real: cuotas por minuto: lecturas por API y ediciones de la ficha', async () => {
  const falso = falsoGoogle();
  const tiempo = relojFalso();
  falso.cuando(es(`${RUTA}/reviews`), () => json(200, { reviews: [] }), { siempre: true })
    .cuando((p) => p.metodo === 'PUT', () => json(200, { comment: 'x', reviewReplyState: 'PENDING' }), { siempre: true });
  const g = real(falso, { tiempo, cuotas: { porMinuto: 3 } });
  for (let i = 0; i < 3; i++) await g.paginaResenas();
  await assert.rejects(g.paginaResenas(), (err) => err.reintentable === true && /Cuota de 3 llamadas por minuto/.test(err.message));
  assert.equal(falso.api().length, 3, 'la cuarta no sale');
  tiempo.avanzar(45000);
  await g.paginaResenas();
  assert.deepEqual(tiempo.esperas, [15000], 'a 15 s de liberarse un hueco, espera su turno');
  assert.equal(falso.api().length, 4);

  const e = real(falso, { tiempo, cuotas: { porMinuto: 100, escriturasPorMinuto: 2 } });
  await e.responderResena('AbFvOq0001', 'Gracias');
  await e.responderResena('AbFvOq0002', 'Gracias de corazón');
  await assert.rejects(e.responderResena('AbFvOq0003', 'Mil gracias'), /Cuota de 2 llamadas por minuto a la ficha \(ediciones\)/);
});

test('real: la ficha (place ID y enlace para reseñar) con su readMask, guardada unas horas', async () => {
  const falso = falsoGoogle();
  const tiempo = relojFalso();
  const ficha = {
    name: `locations/${UBICACION}`,
    title: 'Clínica de Prueba',
    phoneNumbers: { primaryPhone: '600 00 00 00' },
    categories: {
      primaryCategory: { name: 'categories/gcid:beauty_salon', displayName: 'Centro de estética' },
      additionalCategories: [{ name: 'categories/gcid:hair_transplantation_clinic', displayName: 'Clínica de trasplante capilar' }],
    },
    websiteUri: 'https://clinica-de-prueba.example',
    regularHours: { periods: [1, 2, 3, 4, 5, 6].map((d) => ({ openDay: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][d - 1], openTime: { hours: 11 }, closeDay: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][d - 1], closeTime: { hours: 20, minutes: 30 } })) },
    latlng: { latitude: 40.4066059, longitude: -3.9001441 },
    metadata: {
      hasGoogleUpdated: false, hasVoiceOfMerchant: true, canOperateLocalPost: true, canModifyServiceList: true, placeId: PLACE_ID,
      mapsUri: 'https://maps.google.com/maps?cid=1234567890123456789', newReviewUri: `https://search.google.com/local/writereview?placeid=${PLACE_ID}`,
    },
  };
  const ruta = es(`/v1/locations/${UBICACION}`);
  falso.cuando(ruta, () => json(200, ficha), { siempre: true });
  const g = real(falso, { tiempo });
  const f = await g.obtenerFicha();
  const p = falso.api()[0];
  assert.equal(p.url.origin, 'https://mybusinessbusinessinformation.googleapis.com');
  assert.equal(p.url.searchParams.get('readMask'), 'name,title,categories,regularHours,latlng,metadata,phoneNumbers,websiteUri');
  assert.equal(f.placeId, PLACE_ID);
  assert.equal(f.newReviewUri, `https://search.google.com/local/writereview?placeid=${PLACE_ID}`);
  assert.equal(f.categoriaPrincipal, 'Centro de estética');
  assert.deepEqual(f.categoriasAdicionales, ['Clínica de trasplante capilar']);
  assert.deepEqual(f.horario[0], { dia: 1, abre: '11:00', cierra: '20:30' });
  assert.equal(f.horario.length, 6);
  assert.deepEqual([f.conVoz, f.googleHaCambiado, f.latitud], [true, false, 40.4066059]);
  await g.obtenerFicha();
  assert.equal(falso.api().length, 1, 'la segunda vez, de memoria');
  tiempo.avanzar(13 * 3600000);
  await g.obtenerFicha();
  assert.equal(falso.api().length, 2, 'a las 12 horas se vuelve a pedir');
  await g.obtenerFicha({ refrescar: true });
  assert.equal(falso.api().length, 3);
  // Si Google falla, mejor la de hace unas horas que nada (salvo si se pide expresamente al día).
  const caido = falsoGoogle();
  caido.cuando(ruta, json(200, ficha)).cuando(ruta, () => errorGoogle(503, 'UNAVAILABLE', 'x'), { siempre: true });
  const h = real(caido, { tiempo });
  await h.obtenerFicha();
  tiempo.avanzar(13 * 3600000);
  assert.equal((await h.obtenerFicha()).placeId, PLACE_ID);
  await assert.rejects(h.obtenerFicha({ refrescar: true }), /Google 503/);
});

test('real: Places (New) solo para nuestra ficha: no se le puede pedir otro lugar', async () => {
  const falso = falsoGoogle();
  const env = { GOOGLE_PLACES_CLAVE: 'clave-places-de-pruebas', GOOGLE_PLACE_ID: PLACE_ID };
  const lugar = {
    id: PLACE_ID, rating: 4.9, userRatingCount: 533,
    googleMapsLinks: {
      placeUri: 'https://maps.google.com/?cid=1234567890123456789', writeAReviewUri: 'https://www.google.com/maps/place//data=!4m3!3m2!1s0x0:0x0!12e1?source=g.page.m.kd._&laa=lu-desktop-review-solicitation',
      reviewsUri: 'https://www.google.com/maps/place//data=!4m4!3m3!1s0x0:0x0!9m1!1b1', directionsUri: 'https://www.google.com/maps/dir//',
    },
    consumerAlert: { overview: 'Se han eliminado reseñas sospechosas', details: { title: 'Aviso' }, languageCode: 'es' },
  };
  falso.cuando((p) => p.url.host === 'places.googleapis.com', (p) => {
    const campos = p.cabeceras.get('x-goog-fieldmask').split(',');
    return json(200, Object.fromEntries(Object.entries(lugar).filter(([k]) => campos.includes(k))));
  }, { siempre: true });
  const g = real(falso, { env });
  assert.deepEqual(g.capacidades, { perfil: false, ficha: false, places: true });
  const f = await g.obtenerFicha();
  assert.equal(f.origen, 'places');
  assert.equal(f.placeId, PLACE_ID);
  assert.equal(f.newReviewUri, lugar.googleMapsLinks.writeAReviewUri);
  const p = await g.fichaPlaces('ChIJOtraClinicaDeLaCompetencia');
  assert.deepEqual([p.nota, p.total, p.avisoConsumidor], [4.9, 533, true]);
  const pedidas = falso.api();
  assert.equal(pedidas.length, 2);
  for (const x of pedidas) {
    assert.equal(x.url.pathname, `/v1/places/${PLACE_ID}`, 'siempre nuestra ficha');
    assert.equal(x.cabeceras.get('x-goog-api-key'), 'clave-places-de-pruebas');
    assert.equal(x.url.searchParams.get('languageCode'), 'es');
    assert.equal(x.url.searchParams.get('regionCode'), 'ES');
  }
  assert.equal(pedidas[0].cabeceras.get('x-goog-fieldmask'), 'id,googleMapsLinks');
  assert.equal(pedidas[1].cabeceras.get('x-goog-fieldmask'), 'id,rating,userRatingCount,googleMapsLinks,consumerAlert');
  assert.equal(falso.tokens, 0, 'Places va con su clave, sin OAuth');
  await assert.rejects(g.listarResenas(), /falta el acceso a la API de Business Profile/);
  assert.equal(falso.pedidas.length, 2);
});

test('real: métricas diarias (Performance API) y búsquedas del mes, en páginas', async () => {
  const falso = falsoGoogle();
  falso.cuando(es(`/v1/locations/${UBICACION}:fetchMultiDailyMetricsTimeSeries`), json(200, {
    multiDailyMetricTimeSeries: [{
      dailyMetricTimeSeries: [
        { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 4 }, value: '6' }, { date: { year: 2026, month: 10, day: 5 } }] } },
        { dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 5 }, value: '187' }] } },
      ],
    }],
  }));
  const g = real(falso);
  const m = await g.metricasDiarias({ desde: '2026-09-06', hasta: '2026-10-05' });
  assert.deepEqual(m, [
    { fecha: '2026-10-04', metrica: 'llamadas', valor: 6 },
    { fecha: '2026-10-05', metrica: 'llamadas', valor: 0 },
    { fecha: '2026-10-05', metrica: 'impresiones_maps_movil', valor: 187 },
  ]);
  const p = falso.api()[0];
  assert.equal(p.url.origin, 'https://businessprofileperformance.googleapis.com');
  assert.deepEqual(p.url.searchParams.getAll('dailyMetrics'), [
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_CONVERSATIONS', 'BUSINESS_BOOKINGS',
  ]);
  assert.deepEqual(['year', 'month', 'day'].map((k) => p.url.searchParams.get(`dailyRange.start_date.${k}`)), ['2026', '9', '6']);
  assert.deepEqual(['year', 'month', 'day'].map((k) => p.url.searchParams.get(`dailyRange.end_date.${k}`)), ['2026', '10', '5']);
  await assert.rejects(g.metricasDiarias({ desde: 'ayer', hasta: '2026-10-05' }), /Fecha no válida/);

  const palabras = `/v1/locations/${UBICACION}/searchkeywords/impressions/monthly`;
  falso.cuando((x) => es(palabras)(x) && !x.url.searchParams.has('pageToken'), json(200, {
    searchKeywordsCounts: [{ searchKeyword: 'clinica estetica boadilla', insightsValue: { value: '412' } }, { searchKeyword: 'iemec', insightsValue: { value: '233' } }],
    nextPageToken: 'mas-palabras',
  })).cuando((x) => x.url.searchParams.get('pageToken') === 'mas-palabras', json(200, {
    searchKeywordsCounts: [{ searchKeyword: 'hifu facial boadilla', insightsValue: { threshold: '15' } }],
  }));
  const b = await g.palabrasDelMes('2026-09');
  assert.deepEqual(b, [
    { palabra: 'clinica estetica boadilla', impresiones: 412, umbral: null },
    { palabra: 'iemec', impresiones: 233, umbral: null },
    { palabra: 'hifu facial boadilla', impresiones: null, umbral: '15' },
  ]);
  const q = falso.api()[1].url.searchParams;
  assert.deepEqual(['monthlyRange.start_month.year', 'monthlyRange.start_month.month', 'monthlyRange.end_month.year', 'monthlyRange.end_month.month', 'pageSize'].map((k) => q.get(k)), ['2026', '9', '2026', '9', '100']);
  assert.equal(falso.api().length, 3);
});

test('real: publicaciones solo aprobadas por una persona y sin publicidad de medicamentos', async () => {
  const falso = falsoGoogle();
  falso.cuando(es(`${RUTA}/localPosts`, 'POST'), (p) => json(200, {
    name: `accounts/${CUENTA}/locations/${UBICACION}/localPosts/9876543210`, languageCode: 'es', summary: JSON.parse(p.cuerpo).summary,
    state: 'PROCESSING', createTime: '2026-10-06T10:00:00Z', topicType: 'STANDARD', searchUrl: 'https://local.google.com/place?id=1&use=posts&lpsid=9876543210',
  }));
  const g = real(falso);
  const texto = 'En otoño aumenta la caída del cabello: diagnóstico capilar en IEMEC y opciones con el equipo médico.';
  const boton = 'https://wa.me/34600000000?text=Hola%2C%20vengo%20de%20Google%20(gbp-10-1)';
  await assert.rejects(g.publicarNovedad({ texto, botonUrl: boton }), /aprueba una persona/);
  await assert.rejects(g.publicarNovedad({ texto: 'Botox con un 20% de descuento', aprobadaPor: 'recepcion@iemec' }), /filtro de publicidad sanitaria/);
  await assert.rejects(g.publicarNovedad({ texto, botonUrl: 'http://sin-cifrar.example', aprobadaPor: 'recepcion@iemec' }), /https/);
  assert.equal(falso.pedidas.length, 0, 'nada de eso sale a Google');
  const r = await g.publicarNovedad({ texto, botonUrl: boton, aprobadaPor: 'recepcion@iemec' });
  assert.deepEqual(r, { googleId: `accounts/${CUENTA}/locations/${UBICACION}/localPosts/9876543210`, estado: 'en_revision', url: 'https://local.google.com/place?id=1&use=posts&lpsid=9876543210' });
  assert.deepEqual(JSON.parse(falso.api()[0].cuerpo), { languageCode: 'es', topicType: 'STANDARD', summary: texto, callToAction: { actionType: 'BOOK', url: boton } });
});

test('real: para dar de alta la app, cuentas, fichas y el ajuste de avisos de Pub/Sub', async () => {
  const falso = falsoGoogle();
  falso.cuando(es('/v1/accounts'), json(200, { accounts: [{ name: `accounts/${CUENTA}`, accountName: 'Clínica de Prueba', type: 'LOCATION_GROUP', role: 'MANAGER', verificationState: 'VERIFIED' }] }))
    .cuando(es(`/v1/accounts/${CUENTA}/locations`), json(200, { locations: [{ name: `locations/${UBICACION}`, title: 'Clínica de Prueba', storefrontAddress: { addressLines: ['Calle de Prueba 1'] }, metadata: { placeId: PLACE_ID } }] }))
    .cuando(es(`/v1/accounts/${CUENTA}/notificationSetting`, 'PATCH'), (p) => json(200, JSON.parse(p.cuerpo)));
  const g = real(falso, { env: { ...ENV, GOOGLE_CUENTA: '', GOOGLE_UBICACION: '' } });
  assert.deepEqual(await g.listarCuentas(), [{ id: CUENTA, nombre: 'Clínica de Prueba', tipo: 'LOCATION_GROUP', rol: 'MANAGER' }]);
  assert.equal(falso.api()[0].url.host, 'mybusinessaccountmanagement.googleapis.com');
  assert.deepEqual(await g.listarUbicaciones(CUENTA), [{ id: UBICACION, nombre: 'Clínica de Prueba', direccion: 'Calle de Prueba 1', placeId: PLACE_ID }]);
  await assert.rejects(g.paginaResenas(), /faltan GOOGLE_CUENTA y GOOGLE_UBICACION/);
  const h = real(falso);
  await assert.rejects(h.configurarAvisos('mi-tema'), /projects\/<proyecto>\/topics\/<tema>/);
  const r = await h.configurarAvisos('projects/iemec-app/topics/avisos-ficha');
  assert.deepEqual(r, { tema: 'projects/iemec-app/topics/avisos-ficha', tipos: TIPOS_AVISO });
  const patch = falso.api().at(-1);
  assert.equal(patch.url.host, 'mybusinessnotifications.googleapis.com');
  assert.equal(patch.url.searchParams.get('updateMask'), 'pubsubTopic,notificationTypes');
  assert.deepEqual(JSON.parse(patch.cuerpo), { name: `accounts/${CUENTA}/notificationSetting`, pubsubTopic: 'projects/iemec-app/topics/avisos-ficha', notificationTypes: TIPOS_AVISO });
  assert.ok(!TIPOS_AVISO.some((t) => /QUESTION|ANSWER/.test(t)), 'los de preguntas y respuestas están cerrados');
});

// ── Pub/Sub ────────────────────────────────────────────────────────────────────────────────

const empaquetar = (datos, { id = '2070443601311540', atributos = {} } = {}) => ({
  message: { attributes: atributos, data: Buffer.from(JSON.stringify(datos)).toString('base64'), messageId: id, message_id: id, publishTime: '2026-10-06T10:00:00.123Z', publish_time: '2026-10-06T10:00:00.123Z' },
  subscription: 'projects/iemec-app/subscriptions/avisos-ficha-push',
});

test('aviso de Pub/Sub: las variantes de la documentación (review_name, reviewName…) y lo que no se entiende', () => {
  const nombre = `accounts/${CUENTA}/locations/${UBICACION}/reviews/AbFvOq0001`;
  for (const datos of [
    { type: 'NEW_REVIEW', review_name: nombre, location_name: `accounts/${CUENTA}/locations/${UBICACION}` },
    { type: 'NEW_REVIEW', reviewName: nombre, locationName: `accounts/${CUENTA}/locations/${UBICACION}` },
    { type: 'NEW_REVIEW', review: nombre },
    { notificationType: 'new_review', algo: nombre },
  ]) {
    const a = leerAvisoPubSub(empaquetar(datos));
    assert.equal(a.tipo, 'NEW_REVIEW', JSON.stringify(datos));
    assert.deepEqual(a.resena, { cuenta: CUENTA, ubicacion: UBICACION, id: 'AbFvOq0001' });
    assert.deepEqual(a.ficha, { cuenta: CUENTA, ubicacion: UBICACION });
    assert.equal(a.idMensaje, '2070443601311540');
    assert.equal(a.publicadoEn, '2026-10-06T10:00:00.123Z');
  }
  const g = leerAvisoPubSub(empaquetar({ type: 'GOOGLE_UPDATE', location_name: `locations/${UBICACION}` }));
  assert.deepEqual([g.tipo, g.resena, g.ficha], ['GOOGLE_UPDATE', null, { cuenta: null, ubicacion: UBICACION }]);
  const raro = leerAvisoPubSub({ message: { data: '%%%no-es-base64-ni-json', messageId: '1' } });
  assert.deepEqual([raro.tipo, raro.resena, raro.ficha, raro.idMensaje], [null, null, null, '1']);
  assert.equal(leerAvisoPubSub(null).idMensaje, null);
  const inyeccion = leerAvisoPubSub(empaquetar({ type: 'NEW_REVIEW', review_name: `accounts/${CUENTA}/locations/${UBICACION}/reviews/../../otra` }));
  assert.equal(inyeccion.resena, null, 'un nombre de reseña raro no vale');
});

test('verificador de Pub/Sub: el token bueno pasa; firma, emisor, audiencia, cuenta, caducidad y clave, no', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = (clave, kid) => ({ ...clave.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
  let claves = [jwk(publicKey, 'clave-1')];
  let cargas = 0;
  const fetch = async (url) => {
    assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
    cargas++;
    return json(200, { keys: claves }, { 'Cache-Control': 'public, max-age=21600, must-revalidate, no-transform' });
  };
  const tiempo = relojFalso('2026-10-06T10:00:00Z');
  const verificar = crearVerificadorPubSub({ fetch, reloj: tiempo.reloj });
  const ahora = () => Math.floor(tiempo.reloj().getTime() / 1000);
  const AUD = 'https://agenda.clinica-de-prueba.example/webhooks/google';
  const EMAIL = 'avisos-ficha@iemec-app.iam.gserviceaccount.com';
  const carga = (cambios = {}) => ({ aud: AUD, azp: '113774264463038321964', email: EMAIL, email_verified: true, iat: ahora() - 10, exp: ahora() + 3590, iss: 'https://accounts.google.com', sub: '113774264463038321964', ...cambios });
  const firmar = (c, { clave = privateKey, kid = 'clave-1', alg = 'RS256' } = {}) => {
    const h = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url');
    const d = Buffer.from(JSON.stringify(c)).toString('base64url');
    return `${h}.${d}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${d}`), clave).toString('base64url')}`;
  };
  const opciones = { audiencia: AUD, email: EMAIL };

  assert.equal((await verificar(firmar(carga()), opciones)).email, EMAIL);
  assert.equal((await verificar(firmar(carga({ iss: 'accounts.google.com' })), opciones)).sub, '113774264463038321964');
  assert.equal(cargas, 1, 'las claves se guardan lo que dice Cache-Control');
  const malos = [
    [firmar(carga(), { clave: otra.privateKey }), /la firma no cuadra/],
    [firmar(carga({ aud: 'https://otra-app.example/webhooks/google' })), /otra audiencia/],
    [firmar(carga({ email: 'alguien@otro-proyecto.iam.gserviceaccount.com' })), /otra cuenta de servicio/],
    [firmar(carga({ email_verified: false })), /otra cuenta de servicio/],
    [firmar(carga({ exp: ahora() - 3600, iat: ahora() - 7200 })), /caducado/],
    [firmar(carga({ iat: ahora() + 3600, exp: ahora() + 7200 })), /futuro/],
    [firmar(carga({ iss: 'https://impostor.example' })), /no lo emite Google/],
    [firmar(carga(), { alg: 'HS256' }), /algoritmo/],
    ['no.es-un.jwt-valido', /no se puede leer/],
    ['dos.partes', /no es un JWT/],
  ];
  for (const [token, rx] of malos) await assert.rejects(verificar(token, opciones), (err) => rx.test(err.message) && Boolean(err.motivo), String(rx));
  const [h, c] = firmar(carga()).split('.');
  await assert.rejects(verificar(`${h}.${c}.`, opciones), /la firma no cuadra/);
  const sinFirma = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'clave-1' })).toString('base64url')}.${c}.`;
  await assert.rejects(verificar(sinFirma, opciones), /algoritmo/);

  // Google rota las claves: una desconocida hace que se vuelvan a pedir (como mucho una vez por minuto).
  claves = [jwk(publicKey, 'clave-1'), jwk(otra.publicKey, 'clave-2')];
  const conLaNueva = firmar(carga(), { clave: otra.privateKey, kid: 'clave-2' });
  await assert.rejects(verificar(conLaNueva, opciones), /clave desconocida/, 'recién cargadas: no se vuelven a pedir aún');
  assert.equal(cargas, 1);
  tiempo.avanzar(61000);
  assert.equal((await verificar(firmar(carga(), { clave: otra.privateKey, kid: 'clave-2' }), opciones)).email, EMAIL);
  assert.equal(cargas, 2);
  await assert.rejects(verificar(firmar(carga(), { kid: 'clave-3' }), opciones), /clave desconocida/);
  assert.equal(cargas, 2);
});

test('verificador de Pub/Sub: una sola descarga de claves a la vez; si Google no las da, las de antes siguen valiendo', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const tiempo = relojFalso('2026-10-06T10:00:00Z');
  let cargas = 0;
  let caido = false;
  let soltar = null;
  const fetch = async () => {
    cargas++;
    if (caido) return json(503, {});
    await new Promise((ok) => { soltar = ok; });
    return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }, { 'Cache-Control': 'public, max-age=600' });
  };
  const verificar = crearVerificadorPubSub({ fetch, reloj: tiempo.reloj });
  const AUD = 'https://agenda.clinica-de-prueba.example/webhooks/google';
  const EMAIL = 'avisos@iemec-app.iam.gserviceaccount.com';
  const token = () => {
    const ahora = Math.floor(tiempo.reloj().getTime() / 1000);
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
    const c = Buffer.from(JSON.stringify({ aud: AUD, email: EMAIL, email_verified: true, iat: ahora, exp: ahora + 3600, iss: 'https://accounts.google.com' })).toString('base64url');
    return `${h}.${c}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${c}`), privateKey).toString('base64url')}`;
  };
  const opciones = { audiencia: AUD, email: EMAIL };
  // Tres avisos a la vez, recién arrancado: una sola descarga para los tres.
  const tres = [verificar(token(), opciones), verificar(token(), opciones), verificar(token(), opciones)];
  await new Promise((ok) => { setImmediate(ok); });
  soltar();
  assert.equal((await Promise.all(tres)).length, 3);
  assert.equal(cargas, 1);
  // Caducan y Google no contesta: valen las de antes, y no se vuelven a pedir hasta 30 s después.
  tiempo.avanzar(601000);
  caido = true;
  assert.equal((await verificar(token(), opciones)).email, EMAIL);
  assert.equal((await verificar(token(), opciones)).email, EMAIL);
  assert.equal(cargas, 2);
  tiempo.avanzar(31000);
  await verificar(token(), opciones);
  assert.equal(cargas, 3);
  // Sin ninguna clave (recién arrancado y Google caído): no es culpa del token (sin «motivo»: 503).
  let otras = 0;
  const sinClaves = crearVerificadorPubSub({ fetch: async () => { otras++; return json(500, {}); }, reloj: tiempo.reloj });
  await assert.rejects(sinClaves(token(), opciones), (err) => /claves públicas de Google \(500\)/.test(err.message) && !err.motivo);
  await assert.rejects(sinClaves(token(), opciones), (err) => !err.motivo);
  assert.equal(otras, 1, 'no se vuelven a pedir en cada aviso');
  tiempo.avanzar(31000);
  await assert.rejects(sinClaves(token(), opciones), (err) => !err.motivo);
  assert.equal(otras, 2);
});
