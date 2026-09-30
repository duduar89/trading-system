'use strict';
// El adaptador de DataForSEO. El real se prueba con un fetch de mentira que contesta como su
// documentación (v3: task_post, tasks_ready, task_get/advanced y los códigos de estado): nunca sale nada
// a internet. Las fichas de la competencia son inventadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDataForSeo } = require('./dataforseo');

const ENV = { DATAFORSEO_LOGIN: 'cuenta@clinica-de-prueba.example', DATAFORSEO_CLAVE: 'clave-api-de-pruebas' };
const MAPS = 'https://api.dataforseo.com/v3/serp/google/maps';
const json = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
// Así contesta DataForSEO: casi siempre 200, con el estado de verdad en status_code.
const sobre = (tareas, { status_code = 20000, status_message = 'Ok.' } = {}) => ({
  version: '0.1.20260901', status_code, status_message, time: '0.1021 sec.', cost: tareas.reduce((s, t) => s + (t.cost || 0), 0),
  tasks_count: tareas.length, tasks_error: tareas.filter((t) => t.status_code >= 40000).length, tasks: tareas,
});
const idTarea = (n) => `10061015-1535-0139-0000-${String(n).padStart(12, '0')}`;

function falso() {
  const pedidas = [];
  const respuestas = [];
  const fetch = async (url, o = {}) => {
    const p = { metodo: o.method || 'GET', url: new URL(url), cabeceras: new Headers(o.headers || {}), cuerpo: o.body ? JSON.parse(o.body) : null };
    pedidas.push(p);
    const r = respuestas.shift();
    if (!r) return json(418, { status_code: 41800, status_message: `petición inesperada: ${p.metodo} ${url}` });
    return typeof r === 'function' ? r(p) : r;
  };
  return { fetch, pedidas, luego(r) { respuestas.push(r); return this; } };
}

const real = (f, esperas = [], mas = {}) => crearDataForSeo('real', { env: ENV, fetch: f.fetch, esperar: async (ms) => { esperas.push(ms); }, azar: () => 0.5, ...mas });

// Lo que contesta task_post a cada tarea: creada (20100) o con su error.
const creadas = (p, { fallan = {} } = {}) => json(200, sobre(p.cuerpo.map((t, i) => (fallan[i]
  ? { id: idTarea(9000 + i), status_code: 40501, status_message: fallan[i], time: '0 sec.', cost: 0, result_count: 0, path: ['v3', 'serp', 'google', 'maps', 'task_post'], data: { api: 'serp', function: 'task_post', se: 'google', se_type: 'maps', ...t }, result: null }
  : { id: idTarea(i + 1), status_code: 20100, status_message: 'Task Created.', time: '0.0035 sec.', cost: 0.0006, result_count: 0, path: ['v3', 'serp', 'google', 'maps', 'task_post'], data: { api: 'serp', function: 'task_post', se: 'google', se_type: 'maps', ...t }, result: null }))));

const tarea = (i) => ({ palabra: 'medicina estética', coordenada: '40.4336226,-3.9354860,15z', profundidad: 20, etiqueta: `iemec|2026-10-05|p${i}|medicina estética` });

test('simulado: da identificadores, dice lo que está listo y entrega lo que se le dé; nunca sale a internet', async () => {
  const d = crearDataForSeo('simulado', { resultados: (t) => [{ puesto: 1, titulo: `Primera para ${t.palabra}`, placeId: 'ChIJuno' }] });
  const [a, b] = await d.enviarTareas([tarea(1), tarea(2)]);
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.id, b.id);
  assert.equal(a.coste, 0.0006);
  assert.equal((await d.tareasListas()).length, 2);
  assert.deepEqual(await d.resultado(a.id), { listo: true, items: [{ puesto: 1, titulo: 'Primera para medicina estética', placeId: 'ChIJuno' }] });
  await assert.rejects(d.resultado(a.id), /no hay ninguna tarea/, 'una vez recogida, ya no está');
  assert.equal(d.enviadas.length, 2);
});

test('real: sin usuario y clave no arranca (puerta)', () => {
  assert.throws(() => crearDataForSeo('real', { env: {} }), /DATAFORSEO_LOGIN y DATAFORSEO_CLAVE/);
});

test('real: envía las tareas en bloques de 100 con HTTP Basic y el cuerpo de la documentación', async () => {
  const f = falso();
  f.luego((p) => creadas(p)).luego((p) => creadas(p, { fallan: { 3: 'Invalid Field: \'location_coordinate\'.' } }));
  const lista = Array.from({ length: 150 }, (_, i) => tarea(i));
  const r = await real(f).enviarTareas(lista);
  assert.equal(f.pedidas.length, 2);
  for (const p of f.pedidas) {
    assert.equal(p.metodo, 'POST');
    assert.equal(p.url.href, `${MAPS}/task_post`);
    assert.equal(p.cabeceras.get('authorization'), `Basic ${Buffer.from(`${ENV.DATAFORSEO_LOGIN}:${ENV.DATAFORSEO_CLAVE}`).toString('base64')}`);
    assert.equal(p.cabeceras.get('content-type'), 'application/json');
  }
  assert.deepEqual(f.pedidas.map((p) => p.cuerpo.length), [100, 50]);
  assert.deepEqual(f.pedidas[0].cuerpo[0], {
    keyword: 'medicina estética', location_coordinate: '40.4336226,-3.9354860,15z', language_code: 'es', device: 'mobile', os: 'android',
    depth: 20, search_places: false, tag: 'iemec|2026-10-05|p0|medicina estética',
  });
  assert.equal(r.length, 150);
  assert.deepEqual(r[0], { etiqueta: 'iemec|2026-10-05|p0|medicina estética', id: idTarea(1), coste: 0.0006 });
  assert.deepEqual(r[103], { etiqueta: 'iemec|2026-10-05|p103|medicina estética', error: '40501 Invalid Field: \'location_coordinate\'.' });
  assert.equal(r.filter((x) => x.id).length, 149);
});

test('real: errores de DataForSEO: usuario o clave, sin saldo, límite de llamadas y caídas', async () => {
  let f = falso().luego(json(200, sobre([], { status_code: 40100, status_message: 'You are not authorized to access this resource.' })));
  await assert.rejects(real(f).enviarTareas([tarea(1)]), (err) => err.permanente === true && /usuario o clave no válidos/.test(err.message));
  f = falso().luego(json(401, { status_code: 40100, status_message: 'Unauthorized.' }));
  await assert.rejects(real(f).saldo(), /usuario o clave no válidos/);
  f = falso().luego(json(200, sobre([], { status_code: 40210, status_message: 'Insufficient funds. Your account\'s balance is too low.' })));
  await assert.rejects(real(f).enviarTareas([tarea(1)]), (err) => err.permanente === true && /sin saldo/.test(err.message));
  f = falso().luego(json(402, { status_code: 40200, status_message: 'Payment Required.' }));
  await assert.rejects(real(f).enviarTareas([tarea(1)]), /sin saldo/);
  f = falso().luego(json(200, sobre([], { status_code: 40202, status_message: 'Rate limit per minute exceeded.' })));
  await assert.rejects(real(f).tareasListas(), (err) => err.reintentable === true && err.permanente === false);
  const esperas = [];
  f = falso().luego(json(500, { status_code: 50000, status_message: 'Internal Error.' })).luego(json(200, sobre([{ id: 'x', status_code: 20000, result: [] }])));
  assert.deepEqual(await real(f, esperas).tareasListas(), []);
  assert.deepEqual(esperas, [1000], 'un 500 se reintenta con espera');
});

test('real: lo que está listo y su resultado (solo las fichas), en cola o perdido', async () => {
  const f = falso();
  f.luego(json(200, sobre([{
    id: '10061020-1535-0139-0000-000000000001', status_code: 20000, status_message: 'Ok.', cost: 0, result_count: 2, path: ['v3', 'serp', 'google', 'maps', 'tasks_ready'],
    data: { api: 'serp', function: 'tasks_ready', se: 'google', se_type: 'maps' },
    result: [idTarea(1), idTarea(2)].map((id, i) => ({ id, se: 'google', se_type: 'maps', date_posted: '2026-10-05 05:00:01 +00:00', tag: `iemec|2026-10-05|p${i}|botox`, endpoint_regular: null, endpoint_advanced: `/v3/serp/google/maps/task_get/advanced/${id}`, endpoint_html: `/v3/serp/google/maps/task_get/html/${id}` })),
  }])));
  const d = real(f);
  assert.deepEqual(await d.tareasListas(), [{ id: idTarea(1), etiqueta: 'iemec|2026-10-05|p0|botox' }, { id: idTarea(2), etiqueta: 'iemec|2026-10-05|p1|botox' }]);
  assert.equal(f.pedidas[0].url.href, `${MAPS}/tasks_ready`);

  const ficha = (puesto, titulo, extra = {}) => ({
    type: 'maps_search', rank_group: puesto, rank_absolute: puesto, domain: 'clinica.example', title: titulo, url: 'https://clinica.example/', contact_url: null,
    rating: { rating_type: 'Max5', value: 4.9, votes_count: 120, rating_max: null }, rating_distribution: { 1: 1, 2: 0, 3: 2, 4: 7, 5: 110 },
    snippet: 'Calle de Prueba 1, Boadilla del Monte', address: 'Calle de Prueba 1, 28660 Boadilla del Monte, Madrid', place_id: `ChIJ${titulo.replace(/\W/g, '')}`,
    phone: '+34600000000', main_image: 'https://lh5.googleusercontent.com/p/foto', total_photos: 40, category: 'Clínica de medicina estética',
    additional_categories: ['Centro de estética'], work_hours: null, feature_id: '0x0:0x1', cid: '1234567890', latitude: 40.41, longitude: -3.89, is_claimed: true, ...extra,
  });
  f.luego(json(200, sobre([{
    id: idTarea(1), status_code: 20000, status_message: 'Ok.', cost: 0, result_count: 1, path: ['v3', 'serp', 'google', 'maps', 'task_get', 'advanced', idTarea(1)], data: {},
    result: [{
      keyword: 'botox', type: 'maps', se_domain: 'google.com', location_code: null, language_code: 'es', check_url: 'https://google.com/maps/search/botox/@40.4336226,-3.9354860,15z?hl=es',
      datetime: '2026-10-05 05:03:12 +00:00', item_types: ['maps_search'], se_results_count: 0, items_count: 3,
      items: [ficha(1, 'Clínica Uno de Prueba'), { type: 'maps_paid_item', rank_group: 1, title: 'Anuncio' }, ficha(2, 'Clínica Dos de Prueba', { rating: null, additional_categories: null })],
    }],
  }])));
  const r = await d.resultado(idTarea(1));
  assert.equal(f.pedidas[1].url.href, `${MAPS}/task_get/advanced/${idTarea(1)}`);
  assert.equal(r.listo, true);
  assert.deepEqual(r.items.map((x) => [x.puesto, x.titulo]), [[1, 'Clínica Uno de Prueba'], [2, 'Clínica Dos de Prueba']], 'los anuncios no cuentan');
  assert.deepEqual(r.items[0], {
    puesto: 1, titulo: 'Clínica Uno de Prueba', placeId: 'ChIJClínicaUnodePrueba'.replace(/\W/g, ''), cid: '1234567890', categoria: 'Clínica de medicina estética',
    categorias: ['Centro de estética'], nota: 4.9, resenas: 120, latitud: 40.41, longitud: -3.89,
  });
  assert.deepEqual([r.items[1].nota, r.items[1].resenas, r.items[1].categorias], [null, null, []]);

  f.luego(json(200, sobre([{ id: idTarea(2), status_code: 40602, status_message: 'Task In Queue.', cost: 0, result_count: 0, result: null }])));
  assert.deepEqual(await d.resultado(idTarea(2)), { listo: false });
  f.luego(json(200, sobre([{ id: idTarea(3), status_code: 40401, status_message: 'Task Not Found.', cost: 0, result_count: 0, result: null }])));
  await assert.rejects(d.resultado(idTarea(3)), (err) => err.permanente === true && /40401/.test(err.message));
  const antes = f.pedidas.length;
  await assert.rejects(d.resultado('../../appendix/user_data'), /no válido/);
  assert.equal(f.pedidas.length, antes);
});

test('real: saldo de la cuenta', async () => {
  const f = falso().luego(json(200, sobre([{ id: 'x', status_code: 20000, result: [{ login: ENV.DATAFORSEO_LOGIN, money: { total: 50, balance: 48.61 } }] }])));
  assert.deepEqual(await real(f).saldo(), { saldo: 48.61 });
  assert.equal(f.pedidas[0].url.href, 'https://api.dataforseo.com/v3/appendix/user_data');
});
