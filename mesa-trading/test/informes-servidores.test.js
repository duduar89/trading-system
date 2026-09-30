'use strict';
// Endpoints de las vistas en los dos servidores: /api/estrategias,
// /api/laboratorio, /api/historial?puntos= y /api/noticias?simbolo=&graves=.
// En la web, solo con sesión (como el resto de /api); en local, como las
// demás rutas (con PANEL_TOKEN si lo hay).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { arrancarWeb, entrar, pedir, instantaneaDePrueba } = require('./web-ayuda');

const HORA = 3600e3;
const linea = (carpeta, f, x) => fs.appendFileSync(path.join(carpeta, f), `${JSON.stringify(x)}\n`);

test('web: sin sesión, 401 en todas las vistas; con sesión, sus datos', async (t) => {
  const w = await arrancarWeb();
  t.after(w.cerrar);
  const rutas = ['/api/estrategias', '/api/laboratorio', '/api/historial?puntos=100', '/api/noticias?simbolo=BTC&graves=1'];
  for (const r of rutas) {
    const x = await pedir(w.base, r);
    assert.equal(x.status, 401, r);
    assert.equal(x.json.login, '/login', r);
  }
  const inst = instantaneaDePrueba();
  const t0 = inst.ahora - 3000 * HORA;
  for (let i = 0; i < 3000; i++) linea(w.carpeta, 'historial.jsonl', { t: t0 + i * HORA, motivo: i === 1500 ? 'kill' : 'hora', patrimonio: 1e5 + i, mesas: [{ id: inst.mesas[0].id, nombre: 'M', peso: 0.4, pnlAcumulado: i, estado: 'titular' }] });
  linea(w.carpeta, 'noticias.jsonl', { t: 1, id: 'n1', titular: 'uno', simbolos: ['BTC/USD'], clasificacion: [{ simbolo: 'BTC/USD', categoria: 'hackeo', grave: true }], veto: null });
  linea(w.carpeta, 'noticias.jsonl', { t: 2, id: 'n2', titular: 'dos', simbolos: ['ETH/USD'], clasificacion: null, veto: null });
  linea(w.carpeta, 'decisiones.jsonl', { t: 3, tipo: 'laboratorio', quien: 'laboratorio', resumen: 'h', datos: { hipotesisId: 'h1', aprobada: false, criterios: [{ nombre: 'Sharpe OOS', valor: 0.1, umbral: 0.6, ok: false, comparacion: '≥' }] } });
  const cookie = await entrar(w.base);

  const e = await pedir(w.base, '/api/estrategias', { cookie });
  assert.equal(e.status, 200);
  assert.equal(e.json.mesas.length, inst.mesas.length, 'las mesas de la instantánea publicada');
  assert.ok(e.json.mesas.every(m => typeof m.lectura.texto === 'string' && typeof m.regla.texto === 'string'));
  const conHistoria = e.json.mesas.find(m => m.id === inst.mesas[0].id);
  assert.ok(conHistoria.evolucion.length > 50 && conHistoria.evolucion.length <= 130, `${conHistoria.evolucion.length}`);

  const l = await pedir(w.base, '/api/laboratorio', { cookie });
  assert.equal(l.status, 200);
  assert.ok(l.json.hipotesis.some(h => h.id === 'h1' && h.criterios[0].comparacion === '≥'));

  const h = await pedir(w.base, '/api/historial?puntos=200', { cookie });
  assert.equal(h.status, 200);
  assert.ok(h.json.length <= 200 && h.json.length > 150, `${h.json.length}`);
  assert.equal(h.json[0].t, t0);
  assert.equal(h.json[h.json.length - 1].t, t0 + 2999 * HORA, 'todo el tramo, no solo la cola');
  assert.ok(h.json.some(x => x.motivo === 'kill'));
  const sin = await pedir(w.base, '/api/historial', { cookie });
  assert.equal(sin.json.length, 2000, 'sin «puntos», las últimas 2.000 líneas de siempre');

  assert.deepEqual((await pedir(w.base, '/api/noticias?simbolo=BTC', { cookie })).json.map(n => n.id), ['n1']);
  assert.deepEqual((await pedir(w.base, '/api/noticias?graves=1', { cookie })).json.map(n => n.id), ['n1']);
  assert.deepEqual((await pedir(w.base, '/api/noticias', { cookie })).json.map(n => n.id), ['n2', 'n1']);
});

test('web: sin instantánea todavía, estrategias y laboratorio vacíos (no un error)', async (t) => {
  const w = await arrancarWeb({ instantanea: null });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const e = await pedir(w.base, '/api/estrategias', { cookie });
  assert.equal(e.status, 200);
  assert.deepEqual(e.json.mesas, []);
  const l = await pedir(w.base, '/api/laboratorio', { cookie });
  assert.equal(l.status, 200);
  assert.deepEqual(l.json.hipotesis, []);
  assert.deepEqual((await pedir(w.base, '/api/historial?puntos=100', { cookie })).json, []);
});

test('web: la CSP deja cargar las vistas (propias) y el panel las enlaza', async (t) => {
  const w = await arrancarWeb();
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const html = (await pedir(w.base, '/', { cookie })).texto;
  for (const f of ['css/vistas.css', 'js/graficas.js', 'js/vistas.js']) {
    assert.ok(html.includes(f), `index.html enlaza ${f}`);
    const r = await pedir(w.base, `/${f}`, { cookie });
    assert.equal(r.status, 200, f);
  }
  assert.ok(html.includes('id="abrir-vistas"'));
  assert.ok(html.indexOf('js/vistas.js') < html.indexOf('js/app.js'), 'vistas antes que app');
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'vistas.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'graficas.js'), 'utf8');
  assert.doesNotMatch(js, /setAttribute\(\s*['"]style['"]/, 'nada de style="" (la CSP lo prohíbe)');
  assert.doesNotMatch(js, /https?:\/\/(?!www\.w3\.org)/, 'ningún recurso de fuera');
  assert.doesNotMatch(js, /innerHTML/, 'todo texto con textContent');
});

test('local: estrategias, laboratorio, historial reducido y noticias filtradas; con token, 401 sin él', async () => {
  const { crearOrquestador, arrancarServidor, pedir: pedirLocal } = require('./integracion-ayuda');
  const ctx = await crearOrquestador({ pasos: 30 });
  linea(ctx.carpeta, 'noticias.jsonl', { t: 1, id: 'n1', titular: 'uno', simbolos: ['BTC/USD'], clasificacion: null, veto: null });
  const srv = await arrancarServidor(ctx.orquestador);
  const conToken = await arrancarServidor(ctx.orquestador, { token: 'secreto-de-prueba' });
  try {
    const e = await pedirLocal(srv.base, '/api/estrategias');
    assert.equal(e.status, 200);
    assert.deepEqual(e.json.mesas.map(m => m.id).sort(), ctx.orquestador.instantanea().mesas.map(m => m.id).sort());
    const l = await pedirLocal(srv.base, '/api/laboratorio');
    assert.equal(l.status, 200);
    assert.ok(Array.isArray(l.json.hipotesis));
    const h = await pedirLocal(srv.base, '/api/historial?puntos=20');
    assert.ok(h.json.length >= 2 && h.json.length <= 20);
    assert.deepEqual((await pedirLocal(srv.base, '/api/noticias?simbolo=ETH')).json, []);
    assert.deepEqual((await pedirLocal(srv.base, '/api/noticias?simbolo=BTC')).json.map(n => n.id), ['n1']);
    assert.equal((await pedirLocal(conToken.base, '/api/estrategias')).status, 401);
    assert.equal((await pedirLocal(conToken.base, '/api/estrategias', { cabeceras: { 'x-panel-token': 'secreto-de-prueba' } })).status, 200);
    assert.equal((await pedirLocal(srv.base, '/api/estrategias', { metodo: 'POST', cuerpo: {} })).status, 404, 'solo lectura');
  } finally {
    await new Promise(r => srv.servidor.close(r));
    await new Promise(r => conToken.servidor.close(r));
    await ctx.orquestador.detener();
  }
});
