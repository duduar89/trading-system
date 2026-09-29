'use strict';
// Servidor + orquestador sintético (§7): forma de la instantánea (campo a campo
// contra la maqueta de la interfaz), estáticos, SSE, cada comando, token y
// límite del cuerpo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearOrquestador, arrancarServidor, pedir, abrirSSE, PASO } = require('./integracion-ayuda');
const { crearMaqueta } = require('../web/js/maqueta.js');

const tipoDe = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// Tipos de §7 (los '|' admiten varios).
const FORMA = {
  version: 'number', ahora: 'number', modo: 'string', broker: 'string', velocidad: 'number',
  fondo: { nivel: 'string', motivo: 'string|null', multiplicadorCaida: 'number' },
  cabecera: {
    patrimonio: 'number', pnlDia: 'number', pnlDiaPct: 'number', caida: 'number', exposicionBrutaPct: 'number', exposicionCriptoPct: 'number',
    posiciones: 'number', regimen: { valor: 'string', detalle: 'string' }, miedoCodicia: 'object|null', proximoComite: 'number', modoComite: 'string',
  },
  llm: { activo: 'boolean', modeloComite: 'string', modeloAgentes: 'string', gastoHoyUsd: 'number', presupuestoDiaUsd: 'number' },
  curva: 'array', cotizaciones: 'array', departamentos: 'array', agentes: 'array', mesas: 'array', puestos: 'array', posiciones: 'array',
  benchmarks: 'array',
  mejora: { sharpe90Fondo: 'number|null', sharpe90SinComite: 'number|null', sharpe90Btc: 'number|null', texto: 'string' },
  directivas: { modo: 'string', multiplicadores: 'object', activosVetados: 'array', mesasPausadas: 'array', soloCerrarHasta: 'number|null', reduccion: 'object|null' },
  megafonoPendiente: 'object|null', mensajes: 'array', ejecuciones: 'array',
  laboratorio: { ensayosTotales: 'number', hipotesis: 'array', proximaRevision: 'number' },
  limites: 'object', avisos: 'array',
};
const ELEMENTOS = {
  curva: { t: 'number', patrimonio: 'number' },
  cotizaciones: { simbolo: 'string', etiqueta: 'string', precio: 'number', var24hPct: 'number|null', t: 'number' },
  departamentos: { id: 'string', nombre: 'string', color: 'string', sala: 'string' },
  agentes: {
    id: 'string', nombre: 'string', departamento: 'string', rol: 'string', queDecide: 'string', usaLLM: 'boolean', sala: 'string', estado: 'string',
    bocadillo: 'object|null', mesaId: 'string|null', simbolo: 'string|null', etiqueta: 'string|null', puestoId: 'string|null',
  },
  mesas: {
    id: 'string', nombre: 'string', familia: 'string', marco: 'string', estado: 'string', peso: 'number', capital: 'number', multiplicador: 'number',
    universo: 'array', params: 'object', metricas: 'object', pnlDia: 'number', nota: 'string|null',
  },
  puestos: {
    id: 'string', mesaId: 'string', simbolo: 'string', etiqueta: 'string', agenteId: 'string', posicion: 'object|null', pnlDia: 'number',
    operaciones: 'number', acierto: 'number|null', factorBeneficio: 'number|null', adherencia: 'number|null', estadoTexto: 'string',
    ultimaSenal: 'object|null', chispa: 'array',
  },
  posiciones: { simbolo: 'string', etiqueta: 'string', cantidad: 'number', precioMedio: 'number', precio: 'number', valor: 'number', pnl: 'number' },
  benchmarks: { id: 'string', nombre: 'string', valor: 'number|null', rentabilidad: 'number|null', sharpe90: 'number|null' },
  ejecuciones: { t: 'number', puestoId: 'string|null', simbolo: 'string', etiqueta: 'string', lado: 'string', cantidad: 'number', precio: 'number', nocional: 'number', comision: 'number|null', motivo: 'string' },
};

function comprobarForma(obj, forma, ruta = '$') {
  for (const [k, t] of Object.entries(forma)) {
    assert.ok(k in obj, `${ruta}.${k} falta`);
    const v = obj[k];
    if (typeof t === 'object') {
      assert.equal(tipoDe(v), 'object', `${ruta}.${k} debería ser objeto`);
      comprobarForma(v, t, `${ruta}.${k}`);
    } else {
      assert.ok(t.split('|').includes(tipoDe(v)), `${ruta}.${k} es ${tipoDe(v)} y se esperaba ${t}`);
    }
  }
}

// Todo lo que la maqueta enseña a la interfaz tiene que estar en la instantánea real.
function mismasClaves(real, maqueta, ruta, extras = []) {
  const faltan = Object.keys(maqueta).filter(k => !(k in real));
  assert.deepEqual(faltan, [], `${ruta}: la instantánea real no trae ${faltan.join(', ')}`);
  const sobran = Object.keys(real).filter(k => !(k in maqueta) && !extras.includes(k));
  assert.deepEqual(sobran, [], `${ruta}: la instantánea real trae de más ${sobran.join(', ')}`);
}

let ctx;
let srv;

test.before(async () => {
  // 3 días: hay velas, análisis, comités, operaciones y posiciones abiertas.
  ctx = await crearOrquestador({ pasos: 3 * 288 });
  srv = await arrancarServidor(ctx.orquestador);
});

test.after(async () => {
  await new Promise(r => srv.servidor.close(r));
  await ctx.orquestador.detener();
});

test('GET /api/estado trae todas las claves de §7 con sus tipos', async () => {
  const r = await pedir(srv.base, '/api/estado');
  assert.equal(r.status, 200);
  assert.match(r.cabeceras['content-type'], /application\/json/);
  const i = r.json;
  comprobarForma(i, FORMA);
  for (const [lista, forma] of Object.entries(ELEMENTOS)) {
    assert.ok(i[lista].length > 0, `${lista} vacío tras 3 días`);
    for (const x of i[lista]) comprobarForma(x, forma, lista);
  }
  assert.ok(i.curva.length <= 500);
  assert.ok(i.mensajes.length <= 150);
  assert.ok(i.ejecuciones.length <= 30);
  assert.equal(i.modo, 'sintetico');
  assert.equal(i.broker, 'simulado');
  assert.ok(i.benchmarks.some(b => b.id === 'sin-comite'));
  assert.ok(i.benchmarks.some(b => b.id === 'btc') && i.benchmarks.some(b => b.id === 'cesta-cripto'));
  const incubando = i.mesas.filter(m => m.estado === 'incubacion');
  assert.deepEqual(incubando.map(m => m.id).sort(), ['reversion', 'tendencia']);
  for (const m of incubando) { assert.equal(m.peso, 0.02); assert.match(m.nota, /Sharpe/); }
  for (const p of i.puestos) assert.ok(i.agentes.some(a => a.id === p.agenteId), `sin agente para ${p.id}`);
  for (const k of ['operaciones', 'acierto', 'factorBeneficio', 'sharpe', 'sharpeAjustado', 'maxDD', 'adherencia', 'pnlTotal']) assert.ok(k in i.mesas[0].metricas);
  // Patrimonio = efectivo + posiciones, y cuadra con el bróker.
  const c = await ctx.broker.cuenta();
  assert.ok(Math.abs(i.cabecera.patrimonio - c.patrimonio) < 1e-6);
});

test('la instantánea tiene la misma forma que la maqueta de la interfaz', async () => {
  const real = (await pedir(srv.base, '/api/estado')).json;
  const maq = crearMaqueta({ semilla: 7, ahora: real.ahora }).instantanea();
  mismasClaves(real, maq, '$');
  for (const k of ['fondo', 'cabecera', 'llm', 'mejora', 'directivas', 'laboratorio']) mismasClaves(real[k], maq[k], k);
  mismasClaves(real.cabecera.regimen, maq.cabecera.regimen, 'cabecera.regimen');
  mismasClaves(real.cabecera.miedoCodicia, maq.cabecera.miedoCodicia, 'cabecera.miedoCodicia');
  mismasClaves(real.limites, maq.limites, 'limites');
  const pares = { agentes: [], mesas: ['nota'], puestos: [], posiciones: [], benchmarks: [], cotizaciones: [], departamentos: [], curva: [], ejecuciones: [], mensajes: [] };
  for (const [lista, extras] of Object.entries(pares)) {
    if (!real[lista].length || !maq[lista].length) continue;
    mismasClaves(real[lista][0], maq[lista][0], `${lista}[0]`, extras);
  }
  mismasClaves(real.mesas[0].metricas, maq.mesas[0].metricas, 'mesas[0].metricas');
  const conPos = real.puestos.find(p => p.posicion);
  const maqPos = maq.puestos.find(p => p.posicion);
  assert.ok(conPos, 'tras 3 días hay algún puesto con posición');
  mismasClaves(conPos.posicion, maqPos.posicion, 'puestos[].posicion');
  const h = real.laboratorio.hipotesis[0];
  if (h) mismasClaves(h, maq.laboratorio.hipotesis[0], 'laboratorio.hipotesis[0]');
});

test('estáticos: / y /web/*, con tipo MIME y sin salir de web/', async () => {
  const raiz = await pedir(srv.base, '/');
  assert.equal(raiz.status, 200);
  assert.match(raiz.cabeceras['content-type'], /text\/html/);
  assert.match(raiz.texto, /<!doctype html>/i);
  const js = await pedir(srv.base, '/web/js/app.js');
  assert.equal(js.status, 200);
  assert.match(js.cabeceras['content-type'], /javascript/);
  const css = await pedir(srv.base, '/web/css/estilo.css');
  assert.match(css.cabeceras['content-type'], /text\/css/);
  // El escáner de precarga pide css/ y js/ relativos a «/» antes del <base>: también se sirven.
  const precarga = await pedir(srv.base, '/css/estilo.css');
  assert.equal(precarga.status, 200);
  for (const ruta of ['/web/../src/config.js', '/web/%2e%2e/src/config.js', '/web/..%2f..%2fpackage.json', '/web/js/../../package.json', '/../package.json', '/%2e%2e/src/config.js', '/web/no-existe.js']) {
    const r = await pedir(srv.base, ruta);
    assert.equal(r.status, 404, `${ruta} debería dar 404`);
    assert.doesNotMatch(r.texto, /LIMITES_DUROS|"dependencies"/);
  }
});

test('SSE: entrega un estado al conectar, luego mensajes, y limpia sus oyentes al cerrar', async () => {
  const antes = ctx.orquestador.listenerCount('mensaje');
  const sse = abrirSSE(srv.base);
  const res = await sse.listo;
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  const e = await sse.esperar('estado');
  assert.equal(e.datos.version, 1);
  assert.equal(ctx.orquestador.listenerCount('mensaje'), antes + 1);
  ctx.reloj.avanzar(PASO);
  await ctx.orquestador.paso();
  await ctx.orquestador.comando('comite', {});
  await ctx.orquestador.esperarTareas();
  const m = await sse.esperar('mensaje');
  assert.ok(m.datos.id && m.datos.texto && m.datos.canal);
  await sse.esperar('agente');           // los jefes van al comité y vuelven
  await sse.esperar('ping', 3000);
  sse.cerrar();
  await new Promise(r => setTimeout(r, 100));
  assert.equal(ctx.orquestador.listenerCount('mensaje'), antes);
});

test('comandos: comité, prueba, ajustes, pausar y reabrir responden con { ok, mensaje, datos? }', async () => {
  const c = await pedir(srv.base, '/api/comando/comite', { metodo: 'POST', cuerpo: {} });
  assert.equal(c.status, 200);
  assert.equal(typeof c.json.ok, 'boolean');
  assert.equal(typeof c.json.mensaje, 'string');
  await ctx.orquestador.esperarTareas();

  const p = await pedir(srv.base, '/api/comando/prueba', { metodo: 'POST', cuerpo: {} });
  assert.equal(p.status, 200);
  assert.equal(p.json.ok, true);
  assert.ok(Array.isArray(p.json.datos.comprobaciones) && p.json.datos.comprobaciones.length >= 4);
  for (const x of p.json.datos.comprobaciones) { assert.equal(typeof x.nombre, 'string'); assert.equal(typeof x.ok, 'boolean'); assert.equal(typeof x.detalle, 'string'); }
  const sinPrueba = await pedir(srv.base, '/api/comando/prueba', { metodo: 'POST', cuerpo: { ordenMinima: true } });
  assert.equal(sinPrueba.status, 400);
  const conPrueba = await pedir(srv.base, '/api/comando/prueba', { metodo: 'POST', cuerpo: { ordenMinima: true, confirmacion: 'PRUEBA' } });
  assert.equal(conPrueba.status, 200);
  assert.equal(conPrueba.json.ok, true, JSON.stringify(conPrueba.json));
  // Tras comprar y vender 15 $ de BTC, los libros siguen cuadrando con el bróker.
  const pos = await ctx.broker.posiciones();
  const libros = ctx.orquestador.libros.totalesPorSimbolo({ sombra: false });
  for (const x of pos) assert.ok(Math.abs((libros[x.simbolo] || 0) - x.cantidad) <= 1e-9 * Math.max(1, x.cantidad), x.simbolo);
  assert.equal(ctx.orquestador.libros.puesto('prueba-BTC').cantidad, 0);

  const aj = await pedir(srv.base, '/api/comando/ajustes');
  assert.equal(aj.status, 200);
  for (const k of ['modo', 'presupuestoDiaUsd', 'modeloComite', 'modeloAgentes', 'velocidad', 'limites', 'modelosDisponibles']) assert.ok(k in aj.json.datos, k);
  const cambio = await pedir(srv.base, '/api/comando/ajustes', { metodo: 'POST', cuerpo: { velocidad: 1200, presupuestoDiaUsd: 3 } });
  assert.equal(cambio.json.ok, true);
  assert.equal(cambio.json.datos.velocidad, 1200);
  assert.equal(cambio.json.datos.presupuestoDiaUsd, 3);
  const limites = await pedir(srv.base, '/api/comando/ajustes', { metodo: 'POST', cuerpo: { limites: { maxExposicionBruta: 1 } } });
  assert.equal(limites.json.ok, false);
  assert.equal(ctx.orquestador.limites.maxExposicionBruta, 0.8);

  const pa = await pedir(srv.base, '/api/comando/pausar', { metodo: 'POST', cuerpo: {} });
  assert.equal(pa.json.ok, true);
  assert.equal((await pedir(srv.base, '/api/estado')).json.fondo.nivel, 'pausado');
  const re0 = await pedir(srv.base, '/api/comando/reabrir', { metodo: 'POST', cuerpo: {} });
  assert.equal(re0.status, 400);
  const re = await pedir(srv.base, '/api/comando/reabrir', { metodo: 'POST', cuerpo: { confirmacion: 'REABRIR' } });
  assert.equal(re.json.ok, true, re.json.mensaje);
  assert.equal((await pedir(srv.base, '/api/estado')).json.fondo.nivel, 'normal');

  const desconocido = await pedir(srv.base, '/api/comando/no-existe', { metodo: 'POST', cuerpo: {} });
  assert.equal(desconocido.status, 404);
  const malJSON = await pedir(srv.base, '/api/comando/comite', { metodo: 'POST', cuerpo: '{no es json' });
  assert.equal(malJSON.status, 400);
  const grande = await pedir(srv.base, '/api/comando/megafono', { metodo: 'POST', cuerpo: { texto: 'x'.repeat(70 * 1024) } });
  assert.equal(grande.status, 413);
});

test('Megáfono por palabras clave → propuesta → aplicar → directiva vigente', async () => {
  const vacio = await pedir(srv.base, '/api/comando/megafono', { metodo: 'POST', cuerpo: { texto: '' } });
  assert.equal(vacio.json.ok, false);
  const r = await pedir(srv.base, '/api/comando/megafono', { metodo: 'POST', cuerpo: { texto: 'pausa SOL 6 h y reduce el riesgo a la mitad' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const prop = r.json.datos;
  for (const k of ['id', 'texto', 'directivas', 'explicacion']) assert.ok(k in prop, k);
  assert.ok(prop.directivas.some(d => d.tipo === 'pausar_activo' && d.simbolo === 'SOL/USD' && d.horas === 6));
  assert.ok(prop.directivas.some(d => d.tipo === 'reducir_riesgo' && d.factor === 0.5));
  // Sin aplicar no cambia nada; la propuesta queda pendiente en la instantánea.
  let i = (await pedir(srv.base, '/api/estado')).json;
  assert.equal(i.megafonoPendiente.id, prop.id);
  assert.ok(!i.directivas.activosVetados.some(v => v.simbolo === 'SOL/USD'));
  const mal = await pedir(srv.base, '/api/comando/megafono-aplicar', { metodo: 'POST', cuerpo: { id: 'otro' } });
  assert.equal(mal.json.ok, false);
  const ap = await pedir(srv.base, '/api/comando/megafono-aplicar', { metodo: 'POST', cuerpo: { id: prop.id } });
  assert.equal(ap.json.ok, true);
  i = (await pedir(srv.base, '/api/estado')).json;
  assert.equal(i.megafonoPendiente, null);
  const veto = i.directivas.activosVetados.find(v => v.simbolo === 'SOL/USD');
  assert.ok(veto, 'SOL vetado');
  assert.equal(veto.hasta, i.ahora + 6 * 3_600_000);
  assert.equal(i.directivas.reduccion.factor, 0.5);
  assert.ok(i.mensajes.some(m => m.tipo === 'directiva'));
  // Riesgos lo aplica: una apertura en SOL se veta.
  const { evaluar } = require('../src/agentes/departamentos/riesgos');
  const q = ctx.orquestador.vivo.precios['SOL/USD'];
  const res = evaluar(ctx.orquestador, { puestoId: 'ruptura-SOL', mesaId: 'ruptura', simbolo: 'SOL/USD', clase: 'cripto', lado: 'compra', tipo: 'apertura', nocional: 500, precio: q.precio, precioT: q.t, stop: q.precio * 0.9, precioDecision: q.precio });
  assert.equal(res.decision, 'vetar');
  assert.ok(res.motivos.some(m => m.limite === 'activoVetado'));
});

test('otras rutas GET: mensajes, operaciones y costes del LLM', async () => {
  const m = await pedir(srv.base, '/api/mensajes?desde=0');
  assert.equal(m.status, 200);
  assert.ok(Array.isArray(m.json) && m.json.length > 0);
  const o = await pedir(srv.base, '/api/operaciones');
  assert.ok(Array.isArray(o.json));
  const c = await pedir(srv.base, '/api/costes-llm');
  assert.equal(c.status, 200);
  assert.equal(c.json.totalUsd, 0);
});

test('kill: sin confirmación → 400; con confirmación → todo cerrado y bloqueado', async () => {
  const sin = await pedir(srv.base, '/api/comando/kill', { metodo: 'POST', cuerpo: {} });
  assert.equal(sin.status, 400);
  assert.equal(sin.json.ok, false);
  const mal = await pedir(srv.base, '/api/comando/kill', { metodo: 'POST', cuerpo: { confirmacion: 'kill' } });
  assert.equal(mal.status, 400);
  const con = await pedir(srv.base, '/api/comando/kill', { metodo: 'POST', cuerpo: { confirmacion: 'KILL' } });
  assert.equal(con.status, 200);
  assert.equal(con.json.ok, true);
  const i = (await pedir(srv.base, '/api/estado')).json;
  assert.equal(i.fondo.nivel, 'bloqueado');
  assert.deepEqual(i.posiciones, []);
  assert.ok(i.agentes.filter(a => a.estado !== 'banquillo').every(a => a.estado === 'de_pie'));
  assert.deepEqual(await ctx.broker.posiciones(), []);
  // Sigue bloqueado en el latido siguiente y el comité no lo desbloquea.
  ctx.reloj.avanzar(PASO);
  await ctx.orquestador.paso();
  assert.equal(ctx.orquestador.estado.fondo.nivel, 'bloqueado');
});

test('PANEL_TOKEN: /api/* pide el token por cabecera o ?token=; los estáticos no', async () => {
  const s2 = await arrancarServidor(ctx.orquestador, { token: 'secreto-de-prueba' });
  try {
    assert.equal((await pedir(s2.base, '/api/estado')).status, 401);
    assert.equal((await pedir(s2.base, '/api/estado', { cabeceras: { 'x-panel-token': 'otro' } })).status, 401);
    assert.equal((await pedir(s2.base, '/api/estado', { cabeceras: { 'x-panel-token': 'secreto-de-prueba' } })).status, 200);
    assert.equal((await pedir(s2.base, '/api/comando/comite', { metodo: 'POST', cuerpo: {} })).status, 401);
    assert.equal((await pedir(s2.base, '/')).status, 200);
    const sse = abrirSSE(s2.base, '/api/eventos?token=secreto-de-prueba');
    const res = await sse.listo;
    assert.equal(res.statusCode, 200);
    await sse.esperar('estado');
    sse.cerrar();
    const sinToken = abrirSSE(s2.base, '/api/eventos');
    assert.equal((await sinToken.listo).statusCode, 401);
    sinToken.cerrar();
  } finally {
    await new Promise(r => s2.servidor.close(r));
  }
});
