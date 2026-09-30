'use strict';
// Servidor + orquestador sintético (§7): forma de la instantánea (campo a campo
// contra la maqueta de la interfaz), estáticos, SSE, cada comando, token y
// límite del cuerpo. Además, los casos conocidos de la revisión del servidor:
// CSRF (Origin, Sec-Fetch-Site, Content-Type), DNS rebinding (Host), tope de
// paneles SSE, panel que deja de leer, API mientras arranca, /api/mensajes
// inclusivo y más allá de la memoria, y el arranque de src/index.js (un solo
// proceso por carpeta, escucha antes de iniciar, HOST abierto sin token,
// Ctrl+C doble y avisos del banner).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { crearOrquestador, arrancarServidor, pedir, abrirSSE, carpetaTemporal, llmApagado, PASO, INICIO } = require('./integracion-ayuda');
const { crearServidor } = require('../src/servidor');
const { crearConfig } = require('../src/config');
const { construir, avisosDeArranque, lineaLLM, consejoSinRed, urlsDelPanel } = require('../src/index');
const { leerJSONL } = require('../src/util/almacen');
const { crearMaqueta } = require('../web/js/maqueta.js');

const RAIZ = path.join(__dirname, '..');

const tipoDe = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// Tipos de §7 (los '|' admiten varios).
const FORMA = {
  version: 'number', ahora: 'number', modo: 'string', broker: 'string', velocidad: 'number',
  fondo: { nivel: 'string', motivo: 'string|null', multiplicadorCaida: 'number', factorTamano: { total: 'number', comite: 'number', megafono: 'number', caida: 'number' } },
  cabecera: {
    patrimonio: 'number', pnlDia: 'number', pnlDiaPct: 'number', caida: 'number', exposicionBrutaPct: 'number', exposicionCriptoPct: 'number',
    posiciones: 'number', regimen: { valor: 'string', detalle: 'string' }, miedoCodicia: 'object|null', proximoComite: 'number', modoComite: 'string',
    sinAsignar: { fraccion: 'number', usd: 'number' }, vigilancia: { perdidaDiaPct: 'number|null', caidaPct: 'number', desdeReapertura: 'boolean' },
  },
  llm: { activo: 'boolean', modeloComite: 'string', modeloAgentes: 'string', gastoHoyUsd: 'number', presupuestoDiaUsd: 'number' },
  curva: 'array', cotizaciones: 'array', departamentos: 'array', agentes: 'array', mesas: 'array', puestos: 'array', posiciones: 'array',
  benchmarks: 'array',
  mejora: { sharpe90Fondo: 'number|null', sharpe90SinComite: 'number|null', sharpe90Btc: 'number|null', texto: 'string' },
  directivas: { modo: 'string', multiplicadores: 'object', activosVetados: 'array', mesasPausadas: 'array', soloCerrarHasta: 'number|null', reduccion: 'object|null' },
  megafonoPendiente: 'object|null', mensajes: 'array', ejecuciones: 'array',
  laboratorio: { ensayosTotales: 'number', hipotesis: 'array', proximaRevision: 'number' },
  limites: 'object', avisos: 'array',
  listoParaReal: {
    listo: 'boolean', cumplidos: 'number', total: 'number', criterios: 'array', nota: 'string',
    comite: { sharpeFondo: 'number|null', sharpeSinComite: 'number|null', bate: 'boolean|null', texto: 'string' },
  },
};
const CRITERIO_REAL = { id: 'string', nombre: 'string', valor: 'number|null', umbral: 'number|null', ok: 'boolean', valorTexto: 'string', umbralTexto: 'string', detalle: 'string|null' };
const ELEMENTOS = {
  curva: { t: 'number', patrimonio: 'number' },
  cotizaciones: { simbolo: 'string', etiqueta: 'string', precio: 'number', var24hPct: 'number|null', t: 'number' },
  departamentos: { id: 'string', nombre: 'string', color: 'string', sala: 'string' },
  agentes: {
    id: 'string', nombre: 'string', departamento: 'string', rol: 'string', queDecide: 'string', queHace: 'string', usaLLM: 'boolean', sala: 'string', estado: 'string',
    bocadillo: 'object|null', mesaId: 'string|null', simbolo: 'string|null', etiqueta: 'string|null', puestoId: 'string|null',
  },
  mesas: {
    id: 'string', nombre: 'string', familia: 'string', marco: 'string', estado: 'string', peso: 'number', capital: 'number', multiplicador: 'number',
    universo: 'array', params: 'object', metricas: 'object', pnlDia: 'number', nota: 'string|null',
    diasActiva: 'number', filtros: 'array', sharpeBacktest: 'number|null', backtest: 'object|null',
    explicacion: { queMira: 'string', cuandoCompra: 'string', cuandoVende: 'string', cuandoNada: 'string', riesgo: 'string', filtros: 'string|null' },
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
  // Arranque del 30-sep-2026: Momentum titular; Tendencia, Reversión y Ruptura en incubación.
  const incubando = i.mesas.filter(m => m.estado === 'incubacion');
  assert.deepEqual(incubando.map(m => m.id).sort(), ['reversion', 'ruptura', 'tendencia']);
  for (const m of incubando) { assert.equal(m.peso, 0.02); assert.match(m.nota, /Sharpe/); }
  assert.deepEqual(i.mesas.filter(m => m.estado === 'titular').map(m => m.id), ['momentum']);
  // Semáforo: los siete criterios con su forma. Con 3 días de papel no está listo.
  assert.deepEqual(i.listoParaReal.criterios.map(k => k.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  for (const k of i.listoParaReal.criterios) comprobarForma(k, CRITERIO_REAL, `listoParaReal.${k.id}`);
  assert.equal(i.listoParaReal.listo, false);
  assert.equal(i.listoParaReal.criterios[0].valor, 3);
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
  // fondo.factorTamano es de la última ronda (§7): mientras la maqueta no lo
  // traiga, la real puede llevarlo de más; en cuanto lo traiga, se compara igual.
  const nuevos = { fondo: maq.fondo && 'factorTamano' in maq.fondo ? [] : ['factorTamano'] };
  for (const k of ['fondo', 'cabecera', 'llm', 'mejora', 'directivas', 'laboratorio']) mismasClaves(real[k], maq[k], k, nuevos[k] || []);
  if (maq.fondo && maq.fondo.factorTamano) mismasClaves(real.fondo.factorTamano, maq.fondo.factorTamano, 'fondo.factorTamano');
  mismasClaves(real.cabecera.regimen, maq.cabecera.regimen, 'cabecera.regimen');
  mismasClaves(real.cabecera.sinAsignar, maq.cabecera.sinAsignar, 'cabecera.sinAsignar');
  mismasClaves(real.cabecera.vigilancia, maq.cabecera.vigilancia, 'cabecera.vigilancia');
  mismasClaves(real.cabecera.miedoCodicia, maq.cabecera.miedoCodicia, 'cabecera.miedoCodicia');
  mismasClaves(real.limites, maq.limites, 'limites');
  mismasClaves(real.listoParaReal, maq.listoParaReal, 'listoParaReal');
  mismasClaves(real.listoParaReal.comite, maq.listoParaReal.comite, 'listoParaReal.comite');
  mismasClaves(real.listoParaReal.criterios[0], maq.listoParaReal.criterios[0], 'listoParaReal.criterios[0]');
  // Campos de datos del 30-sep-2026 (§7: agentes[].queHace; mesas[].explicacion,
  // filtros, diasActiva, sharpeBacktest y backtest): mientras la maqueta no los
  // traiga, la real puede llevarlos de más; en cuanto los traiga, se comparan igual.
  const aun = (lista, claves) => claves.filter(k => !(maq[lista].length && k in maq[lista][0]));
  const pares = {
    agentes: aun('agentes', ['queHace']), mesas: aun('mesas', ['explicacion', 'filtros', 'diasActiva', 'sharpeBacktest', 'backtest']),
    puestos: [], posiciones: [], benchmarks: [], cotizaciones: [], departamentos: [], curva: [], ejecuciones: [],
    // Conversación del 30-sep-2026 (§6.2): lo mismo, hasta que la maqueta traiga respondeA e hilo.
    mensajes: aun('mensajes', ['respondeA', 'hilo']),
  };
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

// ---------- Revisión del servidor: casos conocidos ----------

const nivel = async () => (await pedir(srv.base, '/api/estado')).json.fondo.nivel;

test('CSRF: los POST exigen JSON y se rechazan si vienen de otra web (Origin o Sec-Fetch-Site)', async () => {
  assert.equal(await nivel(), 'normal');
  const url = '/api/comando/pausar';
  // Petición «simple» de otra web: text/plain no pide permiso previo al navegador.
  const plano = await pedir(srv.base, url, { metodo: 'POST', cuerpo: '{"confirmacion":"KILL"}', cabeceras: { 'content-type': 'text/plain' } });
  assert.equal(plano.status, 415, plano.texto);
  assert.equal(plano.json.ok, false);
  const formulario = await pedir(srv.base, url, { metodo: 'POST', cuerpo: 'a=1', cabeceras: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(formulario.status, 415);
  // JSON, pero desde otra web.
  const ajeno = await pedir(srv.base, url, { metodo: 'POST', cuerpo: {}, cabeceras: { origin: 'https://sitio-malicioso.example' } });
  assert.equal(ajeno.status, 403, ajeno.texto);
  assert.equal(ajeno.json.ok, false);
  const nulo = await pedir(srv.base, url, { metodo: 'POST', cuerpo: {}, cabeceras: { origin: 'null' } });
  assert.equal(nulo.status, 403);
  const otroPuerto = await pedir(srv.base, url, { metodo: 'POST', cuerpo: {}, cabeceras: { origin: 'http://127.0.0.1:1' } });
  assert.equal(otroPuerto.status, 403);
  const cruzado = await pedir(srv.base, url, { metodo: 'POST', cuerpo: {}, cabeceras: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cruzado.status, 403);
  for (const r of ['/api/comando/kill', '/api/comando/reabrir']) {
    const x = await pedir(srv.base, r, { metodo: 'POST', cuerpo: { confirmacion: 'KILL' }, cabeceras: { origin: 'https://sitio-malicioso.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(x.status, 403, r);
  }
  assert.equal(await nivel(), 'normal', 'ningún comando de otra web ha llegado al fondo');
  // Lecturas de otra web: tampoco.
  assert.equal((await pedir(srv.base, '/api/estado', { cabeceras: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await pedir(srv.base, '/api/operaciones', { cabeceras: { origin: 'https://sitio-malicioso.example' } })).status, 403);
  // SSE con Origin ajeno: 403 y sin oyentes nuevos.
  const antes = ctx.orquestador.listenerCount('estado');
  const sseAjeno = await pedir(srv.base, '/api/eventos', { cabeceras: { origin: 'https://sitio-malicioso.example' } });
  assert.equal(sseAjeno.status, 403);
  assert.equal(ctx.orquestador.listenerCount('estado'), antes);
  // El propio panel sí: mismo origen (el navegador manda Origin en los POST) y JSON.
  const propio = await pedir(srv.base, '/api/comando/ajustes', { metodo: 'POST', cuerpo: {}, cabeceras: { origin: srv.base, 'sec-fetch-site': 'same-origin' } });
  assert.equal(propio.status, 200, propio.texto);
  assert.equal(propio.json.ok, true);
  const localhost = await pedir(srv.base, '/api/comando/ajustes', { metodo: 'POST', cuerpo: {}, cabeceras: { host: `localhost:${srv.puerto}`, origin: `http://localhost:${srv.puerto}` } });
  assert.equal(localhost.status, 200);
  // curl sin Origin ni Sec-Fetch-Site, con JSON: vale (el token, si lo hay, sigue mandando).
  assert.equal((await pedir(srv.base, '/api/comando/ajustes', { metodo: 'POST', cuerpo: {} })).status, 200);
});

test('Host: un nombre ajeno (DNS rebinding) no llega ni a la API ni a los estáticos', async () => {
  const ajeno = { host: `atacante.example:${srv.puerto}` };
  const estado = await pedir(srv.base, '/api/estado', { cabeceras: ajeno });
  assert.equal(estado.status, 421, estado.texto);
  assert.doesNotMatch(estado.texto, /patrimonio/);
  // Con rebinding, Origin y Host son los dos del atacante: comparar uno con otro no basta.
  const pausa = await pedir(srv.base, '/api/comando/pausar', { metodo: 'POST', cuerpo: {}, cabeceras: { ...ajeno, origin: `http://atacante.example:${srv.puerto}` } });
  assert.equal(pausa.status, 421);
  assert.equal(await nivel(), 'normal');
  assert.equal((await pedir(srv.base, '/', { cabeceras: ajeno })).status, 421);
  // Otro puerto en el Host tampoco (el panel se sirve en este).
  assert.equal((await pedir(srv.base, '/api/estado', { cabeceras: { host: '127.0.0.1:1' } })).status, 421);
  // Los nombres propios sí.
  for (const host of [`127.0.0.1:${srv.puerto}`, `localhost:${srv.puerto}`, `LOCALHOST:${srv.puerto}`, `[::1]:${srv.puerto}`]) {
    assert.equal((await pedir(srv.base, '/api/estado', { cabeceras: { host } })).status, 200, host);
  }
});

test('SSE: como mucho 20 paneles a la vez; el 21 recibe 503 y al cerrar uno vuelve a haber sitio', async () => {
  const s3 = await arrancarServidor(ctx.orquestador);
  const abiertos = [];
  try {
    const antes = ctx.orquestador.listenerCount('estado');
    for (let i = 0; i < 20; i++) {
      const x = abrirSSE(s3.base);
      abiertos.push(x);
      assert.equal((await x.listo).statusCode, 200, `panel ${i + 1}`);
    }
    assert.equal(s3.servidor.clientesSSE.size, 20);
    const sobra = await pedir(s3.base, '/api/eventos');
    assert.equal(sobra.status, 503);
    assert.match(sobra.json.mensaje, /20/);
    assert.equal(ctx.orquestador.listenerCount('estado'), antes + 20);
    abiertos.shift().cerrar();
    await esperarQue(() => s3.servidor.clientesSSE.size === 19);
    const otro = abrirSSE(s3.base);
    abiertos.push(otro);
    assert.equal((await otro.listo).statusCode, 200);
    for (const x of abiertos.splice(0)) x.cerrar();
    await esperarQue(() => s3.servidor.clientesSSE.size === 0);
    assert.equal(ctx.orquestador.listenerCount('estado'), antes);
  } finally {
    for (const x of abiertos) x.cerrar();
    await new Promise(r => s3.servidor.close(r));
  }
});

// Un cliente TCP que pide el SSE y no lee nunca (móvil dormido, pestaña congelada).
function sseQueNoLee(puerto) {
  const s = net.connect(puerto, '127.0.0.1');
  s.on('error', () => {});
  s.write(`GET /api/eventos HTTP/1.1\r\nHost: 127.0.0.1:${puerto}\r\n\r\n`);
  s.pause();
  return s;
}

async function esperarQue(cond, ms = 5000, cada = 20) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return; await new Promise(r => setTimeout(r, cada)); }
  assert.ok(cond(), 'no se cumplió a tiempo');
}

test('SSE: un panel que deja de leer se corta (por lo pendiente o por atasco) y el que lee sigue recibiendo', async () => {
  // Mensajes de 256 KB: el que lee va al día (se espera a que reciba cada uno);
  // el que no lee acumula hasta pasar los búferes del núcleo y el tope.
  const relleno = 'x'.repeat(256 * 1024);
  for (const [caso, opciones] of [['pendiente', { maxPendienteSSE: 1024 * 1024, maxAtascoSSEMs: 600_000 }], ['atasco', { maxPendienteSSE: 1024 ** 3, maxAtascoSSEMs: 300 }]]) {
    const servidor = crearServidor({ orquestador: ctx.orquestador, raizWeb: path.join(RAIZ, 'web'), carpetaDatos: ctx.orquestador.carpeta, pingMs: 50, ...opciones });
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    const { port } = servidor.address();
    const antes = ctx.orquestador.listenerCount('mensaje');
    const atascado = sseQueNoLee(port);
    const lector = abrirSSE(`http://127.0.0.1:${port}`);
    try {
      await lector.listo;
      await esperarQue(() => servidor.clientesSSE.size === 2);
      const recibidos = () => lector.eventos.filter(e => e.tipo === 'mensaje' && e.datos.prueba === caso).length;
      let enviados = 0;
      while (servidor.clientesSSE.size === 2 && enviados < 400) {
        ctx.orquestador.emit('mensaje', { id: `prueba-${caso}-${enviados}`, prueba: caso, relleno });
        enviados++;
        await esperarQue(() => recibidos() === enviados, 5000, 2);
        await new Promise(r => setTimeout(r, 5));
      }
      await esperarQue(() => servidor.clientesSSE.size === 1, 5000);
      assert.ok(enviados < 400, `${caso}: el que no lee se corta (${enviados} mensajes de 256 KB)`);
      assert.equal(ctx.orquestador.listenerCount('mensaje'), antes + 1, `${caso}: solo quedan los oyentes del lector`);
      // Instantáneas seguidas a un panel que aún no ha vaciado la anterior: no se
      // amontonan, la última sustituye a las demás y es la que le llega.
      for (let i = 0; i < 3; i++) ctx.orquestador.emit('estado', { version: 1, relleno: relleno + relleno, i, caso });
      await esperarQue(() => lector.eventos.some(e => e.tipo === 'estado' && e.datos.caso === caso && e.datos.i === 2), 5000);
      assert.equal(lector.eventos.filter(e => e.tipo === 'estado' && e.datos.caso === caso && e.datos.i === 1).length, 0, 'la intermedia no se manda');
      assert.equal(recibidos(), enviados, 'el lector no ha perdido ningún mensaje');
      await lector.esperar('ping', 2000);
      assert.equal(servidor.clientesSSE.size, 1, 'el lector sigue conectado');
    } finally {
      atascado.destroy();
      lector.cerrar();
      await new Promise(r => servidor.close(r));
    }
    await esperarQue(() => ctx.orquestador.listenerCount('mensaje') === antes);
  }
});

test('mientras la mesa arranca, el servidor ya escucha: estáticos 200 y API 503 (no revienta la instantánea)', async () => {
  const carpeta = carpetaTemporal();
  const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: '42' });
  config.inicio = INICIO;
  const piezas = construir(config, { llm: llmApagado(), opciones: { comiteEnSegundoPlano: false, pausaComiteMs: 0, intervaloEstadoMs: 0 } });
  const s = await arrancarServidor(piezas.orquestador);
  try {
    const e = await pedir(s.base, '/api/estado');
    assert.equal(e.status, 503, e.texto);
    assert.equal(e.json.ok, false);
    assert.match(e.json.mensaje, /arrancando/);
    assert.equal((await pedir(s.base, '/api/eventos')).status, 503);
    assert.equal((await pedir(s.base, '/api/comando/pausar', { metodo: 'POST', cuerpo: {} })).status, 503);
    assert.equal((await pedir(s.base, '/api/mensajes?desde=0')).status, 503);
    assert.equal((await pedir(s.base, '/')).status, 200);
    await piezas.orquestador.iniciar();
    assert.equal((await pedir(s.base, '/api/estado')).status, 200);
  } finally {
    await new Promise(r => s.servidor.close(r));
    await piezas.orquestador.detener();
  }
});

test('/api/mensajes?desde= es inclusivo: entran todos los del mismo instante', async () => {
  await ctx.orquestador.esperarTareas();   // que nada publique mientras se compara
  const bus = ctx.orquestador.bus;
  const mem = bus.memoria;
  // Un instante que compartan varios mensajes (en sintético pasa a menudo),
  // dentro de lo que hay en memoria: posterior al más viejo y anterior al último.
  const cuenta = {};
  for (const m of mem) cuenta[m.t] = (cuenta[m.t] || 0) + 1;
  const t = Number(Object.keys(cuenta).reverse().find(k => cuenta[k] > 1 && Number(k) > mem[0].t && Number(k) < mem[mem.length - 1].t));
  assert.ok(Number.isFinite(t), 'hay mensajes que comparten instante');
  const r = await pedir(srv.base, `/api/mensajes?desde=${t}`);
  assert.equal(r.status, 200);
  const esperados = mem.filter(m => m.t >= t).map(m => m.id);
  assert.deepEqual(r.json.map(m => m.id), esperados);
  assert.equal(r.json.filter(m => m.t === t).length, cuenta[t], 'los del mismo instante entran todos');
});

test('/api/mensajes?desde= anterior a la memoria del bus: completa con mensajes.jsonl, en orden y sin repetidos', async () => {
  const { Bus } = require('../src/agentes/bus');
  const { RelojSimulado } = require('../src/util/reloj');
  const carpeta = carpetaTemporal();
  const reloj = new RelojSimulado(INICIO);
  const bus = new Bus({ reloj, ruta: path.join(carpeta, 'mensajes.jsonl'), maxMemoria: 20 });
  for (let i = 0; i < 60; i++) {
    if (i % 3 === 0) reloj.avanzar(PASO);   // tres mensajes por instante
    bus.publicar({ de: 'sistema', canal: 'sistema', tipo: 'nota', texto: `nota ${i}` });
  }
  assert.equal(bus.memoria.length, 20);
  // La memoria empieza a mitad de un instante: el mensaje 40 comparte t con el 39 y el 41.
  assert.equal(bus.memoria[0].texto, 'nota 40');
  const falso = Object.assign(new (require('events').EventEmitter)(), { iniciado: true, bus, carpeta, operaciones: [], instantanea: () => ({ version: 1 }) });
  const s = await arrancarServidor(falso);
  try {
    const disco = leerJSONL(bus.ruta);
    for (const desde of [bus.memoria[0].t, disco[10].t, 0, reloj.ahora()]) {
      const r = await pedir(s.base, `/api/mensajes?desde=${desde}`);
      assert.equal(r.status, 200);
      const ids = r.json.map(m => m.id);
      assert.deepEqual(ids, disco.filter(m => m.t >= desde).map(m => m.id), `desde=${desde}`);
      assert.equal(new Set(ids).size, ids.length, 'sin repetidos');
    }
    // El mismo instante del más viejo de la memoria trae también los que ya salieron de ella.
    const r = await pedir(s.base, `/api/mensajes?desde=${bus.memoria[0].t}`);
    assert.deepEqual(r.json.slice(0, 3).map(m => m.texto), ['nota 39', 'nota 40', 'nota 41']);
    assert.ok(r.json.some(m => m.texto === 'nota 39'), 'nota 39 comparte instante con la 40 y ya no está en memoria');
    // Sin desde (o vacío), todo lo que hay (hasta el tope de lectura del disco).
    assert.equal((await pedir(s.base, '/api/mensajes')).json.length, 60);
    assert.equal((await pedir(s.base, '/api/mensajes?desde=')).json.length, 60);
  } finally {
    await new Promise(r => s.servidor.close(r));
  }
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

// ---------- Arranque (src/index.js) ----------

// Entorno limpio para un proceso hijo: sin puerto, host, token ni clave del
// entorno de quien corre las pruebas, y sin salida a la API de Anthropic.
function entornoHijo(extra = {}) {
  const env = { ...process.env };
  for (const k of ['PUERTO', 'HOST', 'PANEL_TOKEN', 'ANTHROPIC_API_KEY', 'MODO', 'CARPETA_DATOS', 'VELOCIDAD', 'NODE_OPTIONS']) delete env[k];
  return { ...env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ...extra };
}

// Lanza node src/index.js en sintético. `esperar(re)` resuelve cuando la salida
// (stdout + stderr) casa con re; `fin` con { codigo, salida }; `puerto()` con el
// puerto en que escucha, leído del banner.
// Por defecto escucha en el puerto 0 y el sistema elige uno libre: un puerto
// «libre» pedido antes y cerrado para dárselo al hijo lo podía coger otro
// fichero de pruebas en paralelo mientras el hijo arrancaba (la prueba del
// segundo Ctrl+C caía 1 de cada 6 pasadas con «puerto en uso»).
// Si una prueba falla a mitad, ningún proceso hijo se queda corriendo.
const hijos = new Set();
process.on('exit', () => { for (const h of hijos) { try { h.kill('SIGKILL'); } catch (_) { /* ya salió */ } } });

function lanzarMesa({ puerto = 0, datos, env = {}, precarga = null, args = [] }) {
  const argv = [...(precarga ? ['-r', precarga] : []), path.join(RAIZ, 'src', 'index.js'), '--modo=sintetico', '--velocidad=1', `--puerto=${puerto}`, `--datos=${datos}`, ...args];
  const hijo = spawn(process.execPath, argv, { cwd: RAIZ, env: entornoHijo(env), stdio: ['ignore', 'pipe', 'pipe'] });
  hijos.add(hijo);
  hijo.on('exit', () => hijos.delete(hijo));
  let salida = '';
  const esperando = [];
  const mirar = () => { for (const w of [...esperando]) if (w.re.test(salida)) { esperando.splice(esperando.indexOf(w), 1); w.resolver(salida); } };
  hijo.stdout.on('data', d => { salida += d; mirar(); });
  hijo.stderr.on('data', d => { salida += d; mirar(); });
  const fin = new Promise(resolver => hijo.on('close', (codigo, senal) => resolver({ codigo, senal, salida })));
  const m = {
    hijo, fin,
    get salida() { return salida; },
    async puerto() {
      const banner = await m.esperar(/Panel: http:\/\/127\.0\.0\.1:(\d+)\//);
      return Number(/Panel: http:\/\/127\.0\.0\.1:(\d+)\//.exec(banner)[1]);
    },
    esperar(re, ms = 15_000) {
      if (re.test(salida)) return Promise.resolve(salida);
      return new Promise((resolver, rechazar) => {
        const w = { re, resolver };
        esperando.push(w);
        setTimeout(() => rechazar(new Error(`sin ${re} en ${ms} ms. Salida:\n${salida}`)), ms).unref();
      });
    },
  };
  return m;
}

async function conTope(promesa, ms, que) {
  let t;
  const tope = new Promise((_, rechazar) => { t = setTimeout(() => rechazar(new Error(`${que}: más de ${ms} ms`)), ms); });
  try { return await Promise.race([promesa, tope]); } finally { clearTimeout(t); }
}

test('arranque: con --puerto=0 escucha en el puerto libre que elige el sistema y el banner dice cuál', async () => {
  const datos = path.join(carpetaTemporal(), 'p0');
  const m = lanzarMesa({ puerto: 0, datos });
  try {
    await m.esperar(/Ctrl\+C para parar/);
    const p = await m.puerto();
    assert.ok(Number.isInteger(p) && p > 0, `puerto del banner: ${p}`);
    assert.notEqual(p, 8765, '0 no es «el de por defecto»: lo elige el sistema');
    const r = await pedir(`http://127.0.0.1:${p}`, '/');
    assert.equal(r.status, 200);
    assert.match(r.texto, /<!doctype html>/i);
  } finally {
    m.hijo.kill('SIGINT');
  }
  const r = await conTope(m.fin, 15_000, 'Ctrl+C');
  assert.equal(r.codigo, 0, r.salida);
});

test('arranque: un Ctrl+C que llega justo tras el banner se atiende (los manejadores van antes de decir «Ctrl+C para parar»)', async () => {
  // El hijo se queda 300 ms quieto justo después de escribir el banner, como un
  // proceso al que el sistema no da CPU en ese momento (pasa con las pruebas en
  // paralelo). Si el Ctrl+C llega antes de que tenga su manejador, Node aplica
  // el de por defecto: muere sin guardar ni soltar el bloqueo.
  const precarga = path.join(carpetaTemporal(), 'lento-tras-banner.js');
  fs.writeFileSync(precarga, `'use strict';
const log = console.log;
console.log = (...a) => { log(...a); if (/Ctrl\\+C para parar/.test(String(a[0]))) { const t = Date.now() + 300; while (Date.now() < t) {} } };
`);
  const datos = path.join(carpetaTemporal(), 'banner');
  const m = lanzarMesa({ datos, precarga });
  await m.esperar(/Ctrl\+C para parar/);
  m.hijo.kill('SIGINT');
  const r = await conTope(m.fin, 15_000, 'Ctrl+C tras el banner');
  assert.equal(r.senal, null, `murió por la señal sin atenderla. Salida:\n${r.salida}`);
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /Estado guardado/);
  assert.equal(fs.existsSync(path.join(datos, '.proceso')), false, 'suelta el bloqueo');
});

test('arranque: HOST abierto a la red sin PANEL_TOKEN no arranca ni toca la carpeta', async () => {
  const datos = path.join(carpetaTemporal(), 'datos');
  const m = lanzarMesa({ datos, env: { HOST: '0.0.0.0', PANEL_TOKEN: '' } });
  const r = await conTope(m.fin, 15_000, 'arranque');
  assert.equal(r.codigo, 1, r.salida);
  assert.match(r.salida, /HOST=0\.0\.0\.0/);
  assert.match(r.salida, /PANEL_TOKEN/);
  assert.equal(fs.existsSync(path.join(datos, 'estado.json')), false);
  assert.equal(fs.existsSync(path.join(datos, '.proceso')), false);
});

test('arranque: un solo proceso por carpeta, y escucha ANTES de iniciar (un puerto ocupado no toca los datos)', async () => {
  const x = path.join(carpetaTemporal(), 'x');
  const y = path.join(carpetaTemporal(), 'y');
  const a = lanzarMesa({ datos: x });
  try {
    await a.esperar(/Ctrl\+C para parar/);
    const p1 = await a.puerto();
    assert.ok(fs.existsSync(path.join(x, '.proceso')));
    // A ×1 el primer latido va justo tras el banner y el siguiente, 5 min después:
    // se espera a que estado.json deje de cambiar.
    const leerEstado = () => fs.readFileSync(path.join(x, 'estado.json'), 'utf8');
    let previo = leerEstado();
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 300));
      const ahora = leerEstado();
      if (ahora === previo && /"tendencia": \d/.test(ahora)) break;
      previo = ahora;
    }
    const mensajesAntes = fs.readFileSync(path.join(x, 'mensajes.jsonl'), 'utf8');
    const estadoAntes = fs.readFileSync(path.join(x, 'estado.json'), 'utf8');
    const brokerAntes = fs.readFileSync(path.join(x, 'broker-simulado.json'), 'utf8');
    // Misma carpeta, otro puerto: se niega sin escribir nada en la carpeta del otro.
    const b = lanzarMesa({ datos: x });
    const rb = await conTope(b.fin, 15_000, 'segundo proceso');
    assert.equal(rb.codigo, 1, rb.salida);
    assert.match(rb.salida, /Otra mesa ya usa la carpeta/);
    assert.equal((fs.readFileSync(path.join(x, 'mensajes.jsonl'), 'utf8').match(/Mesa en marcha/g) || []).length, (mensajesAntes.match(/Mesa en marcha/g) || []).length);
    assert.equal(fs.readFileSync(path.join(x, 'broker-simulado.json'), 'utf8'), brokerAntes, 'el segundo no reescribe el bróker del primero');
    assert.equal(fs.readFileSync(path.join(x, 'estado.json'), 'utf8'), estadoAntes);
    assert.match(fs.readFileSync(path.join(x, '.proceso'), 'utf8'), new RegExp(`"pid":${a.hijo.pid}\\b`));
    // Mismo puerto, otra carpeta: falla al escuchar, antes de iniciar nada.
    const c = lanzarMesa({ puerto: p1, datos: y });
    const rc = await conTope(c.fin, 15_000, 'puerto ocupado');
    assert.equal(rc.codigo, 1, rc.salida);
    assert.match(rc.salida, new RegExp(`puerto ${p1}.*(en uso|ocupado)`, 'i'));
    for (const f of ['estado.json', 'mensajes.jsonl', 'ordenes.jsonl', '.proceso']) assert.equal(fs.existsSync(path.join(y, f)), false, `${f} en la carpeta del que no arrancó`);
  } finally {
    a.hijo.kill('SIGINT');
  }
  const ra = await conTope(a.fin, 15_000, 'Ctrl+C');
  assert.equal(ra.codigo, 0, ra.salida);
  assert.match(ra.salida, /Estado guardado/);
  assert.equal(fs.existsSync(path.join(x, '.proceso')), false, 'suelta el bloqueo al salir');
});

test('arranque: el segundo Ctrl+C sale ya aunque el cierre esté colgado; si guardar falla no dice «Estado guardado» y sale con 1', async () => {
  const precarga = path.join(carpetaTemporal(), 'precarga.js');
  fs.writeFileSync(precarga, `'use strict';
const { Orquestador } = require(${JSON.stringify(path.join(RAIZ, 'src', 'orquestador.js'))});
const modo = process.env.PRUEBA_DETENER;
if (modo === 'colgado') Orquestador.prototype.detener = () => new Promise(() => {});
if (modo === 'falla') Orquestador.prototype.detener = async () => { throw Object.assign(new Error('EPERM: operation not permitted, rename estado.json'), { code: 'EPERM' }); };
`);
  // Colgado (la red no responde dentro del latido): el segundo Ctrl+C sale en el acto.
  const datos1 = path.join(carpetaTemporal(), 'c1');
  const a = lanzarMesa({ datos: datos1, precarga, env: { PRUEBA_DETENER: 'colgado' } });
  await a.esperar(/Ctrl\+C para parar/);
  a.hijo.kill('SIGINT');
  await a.esperar(/otro Ctrl\+C sale ya/i);
  const t0 = Date.now();
  a.hijo.kill('SIGINT');
  const ra = await conTope(a.fin, 5_000, 'segundo Ctrl+C');
  assert.ok(Date.now() - t0 < 3_000);
  assert.notEqual(ra.codigo, 0);
  assert.match(ra.salida, /Salgo ya/);
  assert.doesNotMatch(ra.salida, /Estado guardado/);
  assert.equal(fs.existsSync(path.join(datos1, '.proceso')), false, 'suelta el bloqueo también al salir deprisa');
  // Falla al guardar: lo dice y sale con 1.
  const b = lanzarMesa({ datos: path.join(carpetaTemporal(), 'c2'), precarga, env: { PRUEBA_DETENER: 'falla' } });
  await b.esperar(/Ctrl\+C para parar/);
  b.hijo.kill('SIGINT');
  const rb = await conTope(b.fin, 10_000, 'cierre fallido');
  assert.equal(rb.codigo, 1, rb.salida);
  assert.doesNotMatch(rb.salida, /Estado guardado/);
  assert.match(rb.salida, /No se pudo guardar/);
  assert.match(rb.salida, /EPERM/);
});

test('arranque: los avisos dicen lo que manda de verdad (LLM guardado en Ajustes, proxy, gasto de la demo)', () => {
  const base = {
    modo: 'simulado', alpaca: { hay: true }, llm: { modeloComite: 'claude-opus-5-5', modeloAgentes: 'claude-opus-5-5', presupuestoDiaUsd: 2 },
    proxy: { activo: false, ignoradasEnEnv: [] }, cadencias: { comiteHoras: 4 },
  };
  const llmDe = (e) => ({ activo: true, estado: () => ({ activo: true, modeloComite: 'claude-opus-5-5', modeloAgentes: 'claude-opus-5-5', presupuestoDiaUsd: 2, ...e }) });
  const orq = { velocidad: 1, estado: { fondo: { nivel: 'normal' } } };
  const avisos = (config, llm, entorno = {}, o = orq) => avisosDeArranque({ config, llm, orquestador: o, entorno });

  // LLM: el banner enseña lo guardado desde Ajustes, y avisa si el .env dice otra cosa.
  const guardado = llmDe({ presupuestoDiaUsd: 50, modeloComite: 'claude-fable-5-1' });
  assert.match(lineaLLM(base, guardado), /comité claude-fable-5-1.*tope 50 \$\/día/);
  assert.doesNotMatch(lineaLLM(base, guardado), /tope 2 \$/);
  const a1 = avisos(base, guardado).join('\n');
  assert.match(a1, /Ajustes/);
  assert.match(a1, /tope 2 \$\/día/);
  assert.match(a1, /comité claude-opus-5-5/);
  assert.doesNotMatch(avisos(base, llmDe({})).join('\n'), /Ajustes/);
  assert.match(lineaLLM(base, { activo: false, estado: () => ({}) }), /apagado/);

  // Proxy: solo se aconseja si hay proxy en el entorno y Node no lo usa; con npm run start-proxy.
  const conProxy = avisos(base, llmDe({}), { HTTPS_PROXY: 'http://proxy:3128' }).join('\n');
  assert.match(conProxy, /npm run start-proxy/);
  assert.doesNotMatch(conProxy, /NODE_USE_ENV_PROXY=1 npm start/);
  assert.doesNotMatch(avisos({ ...base, proxy: { activo: true, ignoradasEnEnv: [] } }, llmDe({}), { HTTPS_PROXY: 'http://proxy:3128' }).join('\n'), /proxy/i);
  assert.doesNotMatch(avisos(base, llmDe({}), {}).join('\n'), /proxy/i, 'sin proxy no se repite el consejo en cada arranque');
  const enEnv = avisos({ ...base, proxy: { activo: false, ignoradasEnEnv: ['NODE_USE_ENV_PROXY', 'HTTPS_PROXY'] } }, llmDe({})).join('\n');
  assert.match(enEnv, /\.env/);
  assert.match(enEnv, /NODE_USE_ENV_PROXY, HTTPS_PROXY/);
  assert.doesNotMatch(avisos({ ...base, modo: 'sintetico' }, { activo: false, estado: () => ({}) }, { HTTPS_PROXY: 'x' }).join('\n'), /proxy/i, 'la demo no usa la red');

  // Demo con clave: avisa de que gasta dinero real y de cada cuánto hay comité.
  const demo = avisos({ ...base, modo: 'sintetico' }, llmDe({}), {}, { velocidad: 600, estado: { fondo: { nivel: 'normal' } } }).join('\n');
  assert.match(demo, /dinero real/);
  assert.match(demo, /tope 2 \$\/día/);
  assert.match(demo, /cada 24 s/);
  assert.doesNotMatch(avisos({ ...base, modo: 'sintetico' }, { activo: false, estado: () => ({}) }).join('\n'), /dinero real/);

  // Sin red al arrancar: el consejo depende de si el proxy ya está activo.
  const sinRed = new Error('fetch failed');
  assert.match(consejoSinRed(sinRed, { proxyActivo: false, entorno: { HTTPS_PROXY: 'x' } }), /npm run start-proxy/);
  assert.match(consejoSinRed(sinRed, { proxyActivo: true, entorno: { HTTPS_PROXY: 'x' } }), /proxy.*no responde/i);
  assert.doesNotMatch(consejoSinRed(sinRed, { proxyActivo: true, entorno: { HTTPS_PROXY: 'x' } }), /start-proxy|NODE_USE_ENV_PROXY/);
  assert.match(consejoSinRed(sinRed, { proxyActivo: false, entorno: {} }), /red/);
  assert.equal(consejoSinRed(new Error('MODO=alpaca necesita claves'), { proxyActivo: false, entorno: {} }), null);

  // URL del panel: con un host abierto no se imprime 0.0.0.0 (no se puede abrir) sino las de verdad.
  const urls = urlsDelPanel({ host: '0.0.0.0', puerto: 8765, token: 'abc' });
  assert.ok(urls.length >= 1);
  assert.ok(urls.every(u => !u.includes('0.0.0.0')));
  assert.ok(urls.every(u => u.endsWith('/?token=abc')));
  assert.deepEqual(urlsDelPanel({ host: '127.0.0.1', puerto: 8765, token: '' }), ['http://127.0.0.1:8765/']);
});

test('package.json: npm run start-proxy arranca con el proxy del entorno en cualquier sistema', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['start-proxy'], 'node --use-env-proxy src/index.js');
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /NODE_USE_ENV_PROXY=1 /, 'nada con sintaxis de Linux, que no vale en cmd ni PowerShell');
});
