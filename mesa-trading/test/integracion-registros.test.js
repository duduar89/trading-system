'use strict';
// Datos para las pantallas (30-sep-2026): universo ampliado (VIXY solo como
// dato, migración de un fondo existente), noticias guardadas, historial por
// hora y registro de decisiones (ARQUITECTURA §2, §6.10 y §7).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { crearOrquestador, carpetaTemporal, PASO } = require('./integracion-ayuda');
const { crearConfig } = require('../src/config');
const { construir } = require('../src/index');
const { Orquestador } = require('../src/orquestador');
const universoMod = require('../src/mercado/universo');
const { calcularRegimen } = require('../src/mercado/regimen');
const { crearPlantilla } = require('../src/agentes/registro');
const analisis = require('../src/agentes/departamentos/analisis');
const laboratorio = require('../src/agentes/departamentos/laboratorio');
const registros = require('../src/registros');
const informes = require('../src/informes');
const { leerJSONL, leerJSON, escribirJSON } = require('../src/util/almacen');

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

async function pasos(ctx, n) {
  for (let i = 0; i < n; i++) {
    ctx.reloj.avanzar(PASO);
    await ctx.orquestador.paso();
  }
}

// ---------- Universo ----------

test('universo: VIXY no tiene analista, ni puesto, ni está en ninguna mesa', () => {
  const todos = universoMod.UNIVERSO;
  const plantilla = crearPlantilla({ universo: todos, mesas: [{ id: 'x', nombre: 'X', familia: 'momentum-rotacion', universo: ['SPY', 'VIXY'] }] });
  assert.ok(!plantilla.some(a => /VIXY/.test(a.id)), 'ningún agente de VIXY');
  assert.ok(plantilla.some(a => a.id === 'puesto-x-SPY'));
  const { mesasIniciales } = require('../src/estrategias');
  for (const m of mesasIniciales({ hayAlpaca: true, disponibles: todos.map(a => a.simbolo) })) assert.ok(!m.universo.includes('VIXY'), m.id);
  assert.ok(!universoMod.disponibles({ hayAlpaca: true }).some(a => a.simbolo === 'VIXY'));
});

test('universo: el Ejecutor rechaza cualquier orden de VIXY y no llega nada al bróker', async () => {
  const ctx = await crearOrquestador({ pasos: 1 });
  const o = ctx.orquestador;
  const antes = leerJSONL(path.join(ctx.carpeta, 'ordenes.jsonl')).length;
  const r = await o.ejecutor.ejecutar({ puestoId: 'momentum-VIXY', mesaId: 'momentum', simbolo: 'VIXY', lado: 'compra', nocional: 100, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: ctx.reloj.ahora() });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'solo_dato');
  assert.equal(leerJSONL(path.join(ctx.carpeta, 'ordenes.jsonl')).length, antes, 'no se apunta ninguna intención');
  assert.ok(!(await ctx.broker.posiciones()).some(p => p.simbolo === 'VIXY'));
  assert.ok(!leerJSONL(path.join(ctx.carpeta, 'decisiones.jsonl')).some(d => d.tipo === 'orden' && d.datos.simbolo === 'VIXY'));
  await o.detener();
});

test('universo: un estado con VIXY en una mesa lo pierde al arrancar (sin puesto)', async () => {
  const carpeta = carpetaTemporal();
  const ctx = await crearOrquestador({ carpeta, pasos: 1 });
  await ctx.orquestador.detener();
  const ruta = path.join(carpeta, 'estado.json');
  const e = leerJSON(ruta);
  e.mesas.find(m => m.id === 'momentum').universo.push('VIXY');
  escribirJSON(ruta, e);
  const ctx2 = await crearOrquestador({ carpeta });
  const o = ctx2.orquestador;
  assert.ok(!o.mesaPorId('momentum').universo.includes('VIXY'));
  assert.equal(o.libros.puesto('momentum-VIXY'), null);
  assert.ok(!o.instantanea().puestos.some(p => p.simbolo === 'VIXY'));
  await o.detener();
});

test('régimen: VIXY sobre su SMA50 resta un punto; sin VIXY, el régimen es exactamente el de antes', () => {
  const serie = (n, f) => Array.from({ length: n }, (_, i) => ({ t: Date.UTC(2025, 0, 1) + i * DIA, o: f(i), h: f(i), l: f(i), c: f(i), v: 0 }));
  const btc = serie(260, i => 100 + i);          // sobre sus medias: +2
  const spy = serie(260, i => 400 + i);          // +1
  const sin = calcularRegimen({ btcDiario: btc, spyDiario: spy });
  assert.equal(sin.puntos, 3);
  assert.equal(calcularRegimen({ btcDiario: btc, spyDiario: spy, vixyDiario: null }).detalle, sin.detalle);
  assert.ok(!sin.componentes.some(c => c.nombre === 'vixy_sobre_sma50'));
  const miedo = calcularRegimen({ btcDiario: btc, spyDiario: spy, vixyDiario: serie(80, i => (i < 70 ? 20 : 30)) });
  assert.equal(miedo.puntos, 2);
  assert.equal(miedo.componentes.find(c => c.nombre === 'vixy_sobre_sma50').puntos, -1);
  assert.match(miedo.detalle, /VIXY [^;]*miedo subiendo/);
  const calma = calcularRegimen({ btcDiario: btc, spyDiario: spy, vixyDiario: serie(80, i => 30 - i * 0.1) });
  assert.equal(calma.puntos, 3, 'nunca suma: solo resta con miedo');
});

// Fuente de datos que tiene las 4 criptos nuevas y DIA prestándoles la serie
// de otras (solo para probar la migración: el sintético no las tiene).
function datosAmpliados(base) {
  const alias = { 'XRP/USD': 'SOL/USD', 'LTC/USD': 'LINK/USD', 'BCH/USD': 'ETH/USD', 'ADA/USD': 'AVAX/USD', DIA: 'BTC/USD', SPY: 'BTC/USD', QQQ: 'ETH/USD' };
  const real = s => alias[s] || s;
  return {
    semilla: base.semilla, inicio: base.inicio,
    disponible: s => Boolean(alias[s]) || base.disponible(s),
    velas: (s, marco, r) => base.velas(real(s), marco, r),
    ultimos: async simbolos => {
      const r = await base.ultimos([...new Set(simbolos.map(real))]);
      const out = {};
      for (const s of simbolos) if (r[real(s)]) out[s] = r[real(s)];
      return out;
    },
    noticias: async () => [],
    precioEn: (s, t) => base.precioEn(real(s), t),
  };
}

async function arrancarAmpliado(carpeta) {
  const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: '42' });
  const p = construir(config, { opciones: { comiteEnSegundoPlano: false, pausaComiteMs: 0, intervaloEstadoMs: 0 } });
  const datos = datosAmpliados(p.datos);
  const o = new Orquestador({ config, reloj: p.reloj, datos, broker: p.broker, llm: p.llm, fg: p.fg, bus: p.bus, modo: 'sintetico', opciones: { comiteEnSegundoPlano: false, pausaComiteMs: 0, intervaloEstadoMs: 0 } });
  // Como con claves (el sintético fuerza hayAlpaca a false): DIA disponible.
  o.hayAlpaca = true;
  o.universo = universoMod.disponibles({ hayAlpaca: true }).filter(a => datos.disponible(a.simbolo));
  await o.iniciar();
  return { ...p, orquestador: o, datos, carpeta };
}

test('migración del universo en un fondo existente: mesa ampliada en incubación, DIA en Momentum ETF, sin tocar posiciones ni caras, y una sola vez', async () => {
  const carpeta = carpetaTemporal();
  const ctx = await crearOrquestador({ carpeta, pasos: 2 * 288 });
  const o0 = ctx.orquestador;
  const nombresAntes = Object.fromEntries(o0.plantilla.map(a => [a.id, a.nombre]));
  const puestosAntes = o0.libros.listaPuestos().filter(p => p.cantidad > 0).map(p => [p.puestoId, p.cantidad]);
  const brokerAntes = (await ctx.broker.posiciones()).map(p => [p.simbolo, p.cantidad]);
  assert.ok(puestosAntes.length > 0, 'hay posiciones abiertas antes de migrar');
  await o0.detener();
  // Un fondo «con claves» que ya tenía Momentum ETF (sin DIA).
  const ruta = path.join(carpeta, 'estado.json');
  const e = leerJSON(ruta);
  const mom = e.mesas.find(m => m.id === 'momentum');
  e.mesas.push({ ...JSON.parse(JSON.stringify(mom)), id: 'momentum-etf', nombre: 'Momentum ETF', universo: ['SPY', 'QQQ'], estado: 'incubacion', peso: 0.02, capitalBase: 2000, curvaDiaria: [] });
  const pesosAntes = e.mesas.reduce((s, m) => s + m.peso, 0);
  escribirJSON(ruta, e);

  const c1 = await arrancarAmpliado(carpeta);
  const o = c1.orquestador;
  const amp = o.mesaPorId('momentum-ampliada');
  assert.ok(amp, 'la mesa ampliada entra');
  assert.equal(amp.estado, 'incubacion');
  assert.equal(amp.peso, 0.02);
  assert.equal(amp.universo.length, 10);
  assert.equal(amp.nota, require('../src/estrategias').NOTAS_INICIALES.ampliada);
  assert.deepEqual(o.mesaPorId('momentum').universo, mom.universo, 'la titular no cambia');
  assert.deepEqual(o.mesaPorId('momentum-etf').universo, ['SPY', 'QQQ', 'DIA']);
  assert.ok(Math.abs(o.estado.mesas.reduce((s, m) => s + m.peso, 0) - (pesosAntes + 0.02)) < 1e-12);
  // Sin tocar posiciones (libros ni bróker).
  for (const [pid, q] of puestosAntes) assert.equal(o.libros.puesto(pid).cantidad, q, pid);
  assert.deepEqual((await c1.broker.posiciones()).map(p => [p.simbolo, p.cantidad]), brokerAntes);
  // Plantilla: agentes nuevos y nadie de antes cambia de nombre.
  for (const id of ['analista-XRP', 'analista-DIA', 'puesto-momentum-ampliada-XRP', 'puesto-momentum-ampliada-BTC', 'puesto-momentum-etf-DIA']) assert.ok(o.agentePorId(id), id);
  assert.ok(!o.plantilla.some(a => /VIXY/.test(a.id)));
  for (const [id, nombre] of Object.entries(nombresAntes)) assert.equal(o.agentePorId(id).nombre, nombre, `${id} conserva su nombre`);
  assert.equal(new Set(o.plantilla.map(a => a.nombre)).size, o.plantilla.length, 'sin nombres repetidos');
  // Mensaje en el feed y decisiones.
  const avisos = o.bus.ultimos(Infinity).filter(m => m.datos && m.datos.migracion === 'universo-2026-09-30');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].texto, /Momentum cripto ampliada/);
  assert.match(avisos[0].texto, /DIA/);
  const dec = () => leerJSONL(path.join(carpeta, 'decisiones.jsonl')).filter(d => d.datos && d.datos.migracion);
  assert.equal(dec().length, 2);
  assert.ok(dec().every(d => d.tipo === 'asignacion' && d.quien === 'humano'));
  // Con DIA cambia la referencia: el backtest de antes (de otro universo) no se
  // queda; se rehace con el universo nuevo y la decisión lo dice.
  const altaDia = dec().find(d => d.datos.mesaId === 'momentum-etf');
  assert.match(altaDia.resumen, /Su backtest de referencia se rehace con los 3 ETF\./);
  assert.equal(altaDia.datos.backtestAnterior.sharpe, mom.backtest.sharpe);
  await o.esperarTareas();
  assert.deepEqual(o.mesaPorId('momentum-etf').backtest.universo, ['SPY', 'QQQ', 'DIA'], 'el backtest se rehace con los de ahora');
  // Un paso con la mesa nueva no rompe nada.
  c1.reloj.avanzar(PASO);
  assert.equal(await o.paso(), true);
  await o.detener();

  // Segundo arranque: nada se repite.
  const c2 = await arrancarAmpliado(carpeta);
  assert.equal(c2.orquestador.estado.mesas.filter(m => m.id === 'momentum-ampliada').length, 1);
  assert.deepEqual(c2.orquestador.mesaPorId('momentum-etf').universo, ['SPY', 'QQQ', 'DIA']);
  assert.equal(c2.orquestador.bus.ultimos(Infinity).filter(m => m.datos && m.datos.migracion).length, 1, 'el aviso no se repite');
  assert.equal(dec().length, 2);
  for (const [id, nombre] of Object.entries(nombresAntes)) assert.equal(c2.orquestador.agentePorId(id).nombre, nombre);
  await c2.orquestador.detener();
});

test('migración: un fondo que ya había metido DIA con el backtest de antes lo rehace una vez, con hito en la mesa', async () => {
  const carpeta = carpetaTemporal();
  const c0 = await arrancarAmpliado(carpeta);
  await c0.orquestador.esperarTareas();
  await c0.orquestador.detener();
  // Como en producción: DIA ya migrado (30-sep) y el backtest de los ETF de antes, sin universo guardado.
  const ruta = path.join(carpeta, 'estado.json');
  const e = leerJSON(ruta);
  const etf = e.mesas.find(m => m.id === 'momentum-etf');
  assert.ok(etf && etf.universo.includes('DIA'));
  etf.backtest = { sharpe: 0.45, mu: 0.0002, sigma: 0.01, vol: 0.16, maxDD: 0.12, operaciones: 30, rentabilidad: 0.08, dias: 365, t: 1 };
  delete e.migraciones.backtestEtf;
  escribirJSON(ruta, e);

  const c1 = await arrancarAmpliado(carpeta);
  const o = c1.orquestador;
  const d = leerJSONL(path.join(carpeta, 'decisiones.jsonl')).filter(x => x.datos && x.datos.migracion === 'backtest-etf-2026-09-30');
  assert.equal(d.length, 1);
  assert.equal(d[0].datos.mesaId, 'momentum-etf');
  assert.match(d[0].resumen, new RegExp(`era de sus ${etf.universo.length - 1} ETF de antes de DIA \\(Sharpe 0,45\\): lo rehago con los ${etf.universo.length}`));
  await o.esperarTareas();
  const bt = o.mesaPorId('momentum-etf').backtest;
  assert.notEqual(bt.sharpe, 0.45, 'el de la otra cartera ya no se enseña ni lo usa el asignador');
  assert.deepEqual(bt.universo, etf.universo);
  // La ficha de la vista Estrategias lo cuenta como hito de la mesa (no como alta).
  const { hitos } = require('../src/informes/estrategias');
  assert.ok(hitos(carpeta).get('momentum-etf').some(h => h.tipo === 'backtest'));
  await o.detener();
  // Una sola vez.
  const c2 = await arrancarAmpliado(carpeta);
  await c2.orquestador.esperarTareas();
  assert.equal(leerJSONL(path.join(carpeta, 'decisiones.jsonl')).filter(x => x.datos && x.datos.migracion === 'backtest-etf-2026-09-30').length, 1);
  assert.equal(c2.orquestador.mesaPorId('momentum-etf').backtest.t, bt.t, 'no se vuelve a rehacer');
  await c2.orquestador.detener();
});

test('backtestVigente: un backtest es de un universo; si la mesa cambia de universo, se rehace', () => {
  const m = { universo: ['SPY', 'QQQ', 'DIA'], backtest: { sharpe: 1, universo: ['QQQ', 'SPY', 'DIA'] } };
  assert.equal(laboratorio.backtestVigente(m), true, 'el orden no importa');
  assert.equal(laboratorio.backtestVigente({ ...m, universo: ['SPY', 'QQQ'] }), false);
  assert.equal(laboratorio.backtestVigente({ ...m, backtest: null }), false);
  assert.equal(laboratorio.backtestVigente({ ...m, backtest: { sharpe: 1 } }), true, 'uno de antes vale hasta que una migración diga otra cosa');
});

test('migración: en sintético (sin las criptos nuevas) no hace nada', async () => {
  const carpeta = carpetaTemporal();
  const ctx = await crearOrquestador({ carpeta, pasos: 1 });
  await ctx.orquestador.detener();
  const c = await crearOrquestador({ carpeta });
  assert.equal(c.orquestador.mesaPorId('momentum-ampliada'), null);
  assert.deepEqual(c.orquestador.estado.migraciones, {});
  await c.orquestador.detener();
});

// ---------- Noticias ----------

function ctxNoticias({ llm = null, hay = true, modo = 'alpaca', lista = [] } = {}) {
  const carpeta = carpetaTemporal();
  let ahora = Date.UTC(2026, 8, 29, 12);
  const mensajes = [];
  const decisiones = [];
  const ctx = {
    modo,
    config: { alpaca: { hay } },
    reloj: { ahora: () => ahora },
    rutas: registros.rutas(carpeta),
    universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'].map(s => ({ simbolo: s, etiqueta: s.split('/')[0] })),
    estado: { noticias: { ultima: null, vistos: [], eventosGraves: [] }, directivas: { activosVetados: [] } },
    datos: { noticias: async () => lista },
    llm,
    bus: { publicar: m => mensajes.push(m) },
    anotarDecision: d => decisiones.push(d),
  };
  return { ctx, carpeta, mensajes, decisiones, avanzar: ms => { ahora += ms; }, lista, ruta: ctx.rutas.noticias };
}

const N = (id, simbolos, titular = `Titular ${id}`) => ({ id, titular, resumen: 'r'.repeat(600), fuente: 'benzinga', autor: 'Ana', t: Date.UTC(2026, 8, 29, 11), url: `https://x/${id}`, simbolos });

test('noticias sin LLM: se guardan cada hora sin clasificar y sin vetar, sin duplicar', async () => {
  const { ctx, avanzar, lista, ruta, mensajes } = ctxNoticias({ lista: [N(1, ['BTC/USD', 'MSTR']), N(2, ['SOL/USD'])] });
  const r = await analisis.noticias(ctx);
  assert.equal(r.nuevas, 2);
  let l = leerJSONL(ruta);
  assert.equal(l.length, 2);
  assert.deepEqual(Object.keys(l[0]).sort(), ['autor', 'clasificacion', 'fuente', 'id', 'publicada', 'resumen', 't', 'titular', 'simbolos', 'url', 'veto'].sort());
  assert.equal(l[0].id, '1');
  assert.equal(l[0].t, ctx.reloj.ahora());
  assert.equal(l[0].publicada, Date.UTC(2026, 8, 29, 11));
  assert.equal(l[0].resumen.length, 400);
  assert.deepEqual(l[0].simbolos, ['BTC/USD'], 'solo símbolos del universo');
  assert.equal(l[0].clasificacion, null);
  assert.equal(l[0].veto, null);
  assert.equal(ctx.estado.directivas.activosVetados.length, 0);
  assert.equal(mensajes.length, 0);
  assert.equal(await analisis.noticias(ctx), null, 'antes de 1 h no se vuelve a traer');
  avanzar(HORA);
  lista.push(N(3, ['ETH/USD']));
  assert.equal((await analisis.noticias(ctx)).nuevas, 1);
  l = leerJSONL(ruta);
  assert.deepEqual(l.map(x => x.id), ['1', '2', '3'], 'las ya guardadas no se repiten');
  const leidas = registros.leerNoticias(ruta);
  assert.deepEqual(leidas.map(x => x.id), ['3', '2', '1'], 'de la más nueva a la más vieja');
});

test('noticias con LLM falso: se clasifican, vetan y la clasificación tardía llega como actualización', async () => {
  const llamadas = [];
  const llm = {
    activo: true,
    async pedirJSON(args) {
      llamadas.push(args);
      const ids = args.entrada.noticias.map(x => x.id);
      return { ok: true, costeUsd: 0.001, datos: { noticias: ids.map(id => (id === '2'
        ? { id, simbolo: 'SOL/USD', categoria: 'hackeo', impacto: 'negativo', eventoGrave: true }
        : { id, simbolo: id === '3' ? 'ETH/USD' : 'BTC/USD', categoria: 'mercado', impacto: 'neutral', eventoGrave: false })) } };
    },
  };
  const { ctx, avanzar, lista, ruta, decisiones } = ctxNoticias({ llm, lista: [N(1, ['BTC/USD']), N(2, ['SOL/USD'])] });
  const r = await analisis.noticias(ctx);
  assert.equal(r.clasificadas, 2);
  assert.equal(r.graves, 1);
  let l = leerJSONL(ruta);
  assert.equal(l.length, 2, 'una línea por noticia, ya con su resultado');
  const t0 = ctx.reloj.ahora();
  assert.deepEqual(l[0].clasificacion, [{ simbolo: 'BTC/USD', categoria: 'mercado', grave: false }]);
  assert.equal(l[0].veto, null);
  assert.deepEqual(l[1].clasificacion, [{ simbolo: 'SOL/USD', categoria: 'hackeo', grave: true }]);
  assert.deepEqual(l[1].veto, { simbolo: 'SOL/USD', hasta: t0 + 24 * HORA, simbolos: ['SOL/USD'] });
  assert.equal(ctx.estado.directivas.activosVetados[0].simbolo, 'SOL/USD');
  assert.equal(decisiones.filter(d => d.tipo === 'noticia').length, 1);
  assert.equal(decisiones[0].datos.simbolo, 'SOL/USD');
  // Una hora después llega otra: se guarda sin clasificar (el lote es cada 4 h).
  avanzar(HORA);
  lista.push(N(3, ['ETH/USD']));
  await analisis.noticias(ctx);
  assert.equal(llamadas.length, 1);
  l = leerJSONL(ruta);
  assert.equal(l.length, 3);
  assert.equal(l[2].clasificacion, null);
  // A las 4 h del primer lote se clasifica y llega la actualización.
  avanzar(3 * HORA);
  await analisis.noticias(ctx);
  assert.equal(llamadas.length, 2);
  assert.deepEqual(llamadas[1].entrada.noticias.map(x => x.id), ['3']);
  l = leerJSONL(ruta);
  assert.equal(l.length, 4);
  assert.equal(l[3].actualiza, true);
  assert.equal(l[3].id, '3');
  const n3 = registros.leerNoticias(ruta).find(x => x.id === '3');
  assert.deepEqual(n3.clasificacion, [{ simbolo: 'ETH/USD', categoria: 'mercado', grave: false }]);
  assert.equal(n3.titular, 'Titular 3');
  assert.equal(n3.clasificadaT, ctx.reloj.ahora());
});

// Un latido que escribe en noticias.jsonl y muere antes de guardar estado.json:
// el siguiente parte del estado de antes (revisión del 30-sep-2026).
function morirSinGuardar(ctx, antes) { ctx.estado = JSON.parse(JSON.stringify(antes)); }

test('noticias: un latido cortado antes de guardar el estado no duplica la noticia y la pantalla enseña su clasificación', async () => {
  let ok = false;
  const llamadas = [];
  const llm = { activo: true, async pedirJSON(args) {
    llamadas.push(args.entrada.noticias.map(x => x.id));
    if (!ok) return { ok: false, motivo: 'error', detalle: 'timeout', costeUsd: 0 };
    return { ok: true, costeUsd: 0.001, datos: { noticias: args.entrada.noticias.map(x => ({ id: x.id, simbolo: 'SOL/USD', categoria: 'hackeo', impacto: 'negativo', eventoGrave: true })) } };
  } };
  const { ctx, avanzar, ruta, carpeta, decisiones } = ctxNoticias({ llm, lista: [N(77, ['SOL/USD'], 'Exchange X hackeado: roban 400 M en SOL')] });
  // Latido 1: se escribe sin clasificar (el LLM falla) y muere antes de guardar.
  const antes = JSON.parse(JSON.stringify(ctx.estado));
  await analisis.noticias(ctx);
  morirSinGuardar(ctx, antes);
  // Latido 2: el LLM ya contesta.
  ok = true;
  avanzar(MIN);
  const r = await analisis.noticias(ctx);
  assert.equal(r.nuevas, 0, 'ya estaba en noticias.jsonl: no se vuelve a escribir como nueva');
  assert.equal(r.graves, 1, 'y sí se clasifica: un evento grave no se escapa');
  const lineas = leerJSONL(ruta);
  assert.equal(lineas.filter(l => l.id === '77' && !l.actualiza).length, 1, 'una sola línea base');
  assert.deepEqual(ctx.estado.directivas.activosVetados.map(v => v.simbolo), ['SOL/USD']);
  // Lo que ve la pantalla de Noticias (todos los filtros): la clasificación y el veto.
  const vista = informes.consultar('noticias', { carpeta, params: new URLSearchParams('') });
  assert.equal(vista.length, 1);
  assert.equal(vista[0].clasificacion[0].grave, true);
  assert.equal(vista[0].veto.simbolo, 'SOL/USD');
  assert.equal(informes.consultar('noticias', { carpeta, params: new URLSearchParams('graves=1') }).length, 1);
  assert.equal(informes.consultar('noticias', { carpeta, params: new URLSearchParams('simbolo=SOL') })[0].clasificacion[0].categoria, 'hackeo');
  assert.equal(decisiones.filter(d => d.tipo === 'noticia').length, 1);
});

test('noticias: un latido que clasificó, vetó y apuntó la decisión y murió antes de guardar no vuelve a clasificar (ni a pagar) y el veto sigue', async () => {
  let llamadas = 0;
  const llm = { activo: true, async pedirJSON(args) {
    llamadas++;
    return { ok: true, costeUsd: 0.001, datos: { noticias: args.entrada.noticias.map(x => ({ id: x.id, simbolo: 'SOL/USD', categoria: 'hackeo', impacto: 'negativo', eventoGrave: true })) } };
  } };
  const { ctx, avanzar, ruta, decisiones } = ctxNoticias({ llm, lista: [N(78, ['SOL/USD'])] });
  const antes = JSON.parse(JSON.stringify(ctx.estado));
  const r1 = await analisis.noticias(ctx);
  assert.equal(r1.graves, 1);
  const hasta = ctx.estado.directivas.activosVetados[0].hasta;
  morirSinGuardar(ctx, antes);
  assert.equal(ctx.estado.directivas.activosVetados.length, 0, 'el estado de antes no tenía el veto');
  avanzar(MIN);
  const r2 = await analisis.noticias(ctx);
  assert.equal(r2.nuevas, 0);
  assert.equal(llamadas, 1, 'no se vuelve a clasificar ni a pagar');
  assert.deepEqual(ctx.estado.directivas.activosVetados.map(v => [v.simbolo, v.hasta, v.origen]), [['SOL/USD', hasta, 'noticias']], 'el veto que se decidió sigue');
  assert.ok(ctx.estado.noticias.eventosGraves.some(e => e.simbolo === 'SOL/USD'));
  assert.equal(decisiones.filter(d => d.tipo === 'noticia').length, 1, 'la decisión no se apunta dos veces');
  assert.equal(leerJSONL(ruta).filter(l => l.id === '78').length, 1);
  // Y un fichero con la noticia ya repetida (de antes de este arreglo) se lee bien.
  registros.anadir(ruta, { ...leerJSONL(ruta)[0], t: ctx.reloj.ahora() + 1, clasificacion: null, veto: null });
  const [x] = registros.leerNoticias(ruta);
  assert.equal(x.clasificacion[0].categoria, 'hackeo', 'un null posterior no borra la clasificación');
});

test('noticias: sin claves de Alpaca, o en sintético, no hay nada (ni fichero)', async () => {
  for (const x of [{ hay: false }, { modo: 'sintetico' }]) {
    const { ctx, ruta } = ctxNoticias({ lista: [N(1, ['BTC/USD'])], ...x });
    assert.equal(await analisis.noticias(ctx), null);
    assert.equal(fs.existsSync(ruta), false);
  }
});

// ---------- Historial ----------

test('historial: una línea por hora de reloj, con su forma; sin duplicar tras reinicio ni tras un corte', async () => {
  const carpeta = carpetaTemporal();
  const ctx = await crearOrquestador({ carpeta, pasos: 36 });   // 3 h
  const ruta = path.join(carpeta, 'historial.jsonl');
  let l = leerJSONL(ruta);
  const horas = new Set(l.filter(x => x.motivo === 'hora').map(x => Math.floor(x.t / HORA)));
  assert.equal(horas.size, l.filter(x => x.motivo === 'hora').length, 'una por hora');
  assert.ok(horas.size >= 3);
  const x = l[l.length - 1];
  for (const k of ['t', 'motivo', 'patrimonio', 'efectivo', 'exposicion', 'caida', 'sombras', 'regimen', 'modoComite', 'mesas']) assert.ok(k in x, k);
  assert.deepEqual(Object.keys(x.sombras).sort(), ['btc', 'cesta', 'sinComite']);
  assert.ok(Number.isFinite(x.sombras.btc) && Number.isFinite(x.sombras.cesta) && Number.isFinite(x.sombras.sinComite));
  assert.ok(Math.abs(x.patrimonio - ctx.orquestador.vivo.patrimonio) < 1e-6 || x.t < ctx.reloj.ahora());
  assert.deepEqual(x.mesas.map(m => m.id), ['tendencia', 'momentum', 'reversion', 'ruptura']);
  for (const m of x.mesas) for (const k of ['id', 'nombre', 'estado', 'peso', 'patrimonio', 'pnlAcumulado', 'operaciones']) assert.ok(k in m, `${m.id}.${k}`);
  // Reinicio en la misma hora: no se repite.
  const antes = l.length;
  await ctx.orquestador.detener();
  const c2 = await crearOrquestador({ carpeta });
  await pasos(c2, 1);
  assert.equal(leerJSONL(ruta).length, antes, 'misma hora: nada nuevo');
  // Corte entre escribir la línea y guardar el estado: el estado vuelve atrás
  // una hora, pero la línea ya está en el fichero y no se repite.
  while (Math.floor((c2.reloj.ahora() + PASO) / HORA) === Math.floor(c2.reloj.ahora() / HORA)) await pasos(c2, 1);
  const guardado = leerJSON(path.join(carpeta, 'estado.json'));
  await pasos(c2, 1);                  // hora nueva: escribe su línea
  const conLinea = leerJSONL(ruta).length;
  assert.equal(conLinea, antes + 1);
  await c2.orquestador.detener();
  escribirJSON(path.join(carpeta, 'estado.json'), { ...guardado, ahora: guardado.ahora });
  const c3 = await crearOrquestador({ carpeta });
  await pasos(c3, 1);
  const horas3 = leerJSONL(ruta).filter(z => z.motivo === 'hora').map(z => Math.floor(z.t / HORA));
  assert.equal(new Set(horas3).size, horas3.length, 'ninguna hora dos veces');
  await c3.orquestador.detener();
});

test('historial: el kill deja su punto (además del de la hora)', async () => {
  const ctx = await crearOrquestador({ pasos: 2 });
  const o = ctx.orquestador;
  const r = await o.comando('kill', { confirmacion: 'KILL' });
  assert.ok(r.mensaje);
  const l = leerJSONL(path.join(ctx.carpeta, 'historial.jsonl'));
  assert.equal(l.filter(x => x.motivo === 'kill').length, 1);
  const d = leerJSONL(path.join(ctx.carpeta, 'decisiones.jsonl')).filter(x => x.tipo === 'kill');
  assert.equal(d.length, 1);
  assert.equal(d[0].quien, 'humano');
  assert.equal(d[0].datos.manual, true);
  await o.detener();
});

// ---------- Decisiones ----------

test('decisiones: una orden real deja su línea con quién y sus motivos (la regla con cifras)', async () => {
  const ctx = await crearOrquestador({ pasos: 288 });   // 1 día: hay compras
  const lista = leerJSONL(path.join(ctx.carpeta, 'decisiones.jsonl'));
  for (const d of lista) {
    assert.ok(registros.TIPOS_DECISION.includes(d.tipo), d.tipo);
    assert.ok(Number.isFinite(d.t) && typeof d.quien === 'string' && typeof d.resumen === 'string' && d.datos && typeof d.datos === 'object');
  }
  const ordenes = lista.filter(d => d.tipo === 'orden');
  assert.ok(ordenes.length > 0, 'hay órdenes');
  const o = ordenes[0];
  assert.match(o.quien, /^puesto-/);
  assert.ok(Array.isArray(o.datos.motivos) && o.datos.motivos.length >= 2, JSON.stringify(o.datos));
  assert.match(o.datos.motivos[1], /\d/, 'el motivo de la estrategia lleva sus cifras');
  assert.ok(o.datos.idCliente && o.datos.simbolo && o.datos.lado);
  // Cada orden del registro de órdenes tiene su decisión.
  const intenciones = leerJSONL(path.join(ctx.carpeta, 'ordenes.jsonl')).filter(x => x.estado === 'INTENCION');
  assert.deepEqual(ordenes.map(d => d.datos.idCliente).sort(), intenciones.map(x => x.idCliente).sort());
  assert.ok(lista.some(d => d.tipo === 'comite'));
  await ctx.orquestador.detener();
});

test('decisiones: el laboratorio deja todas sus puertas con valor, umbral y si pasan', async () => {
  const ctx = await crearOrquestador({ pasos: 3 });   // lunes 00:15: ya hay revisión semanal
  const o = ctx.orquestador;
  await o.esperarTareas();
  if (!leerJSONL(path.join(ctx.carpeta, 'decisiones.jsonl')).some(d => d.tipo === 'laboratorio')) {
    laboratorio.revisionSemanal(o);
    await o.esperarTareas();
  }
  const lab = leerJSONL(path.join(ctx.carpeta, 'decisiones.jsonl')).filter(d => d.tipo === 'laboratorio');
  assert.ok(lab.length > 0, 'el laboratorio evaluó alguna hipótesis');
  const d = lab[0];
  assert.equal(d.quien, 'laboratorio');
  assert.equal(typeof d.datos.aprobada, 'boolean');
  assert.ok(d.datos.criterios.length >= 1);
  if (d.datos.criterios.length > 1) {
    assert.deepEqual(d.datos.criterios.map(c => c.nombre), ['Sharpe OOS', 'Ventanas de prueba en positivo', 'Sharpe deflactado', 'Operaciones OOS', 'maxDD OOS', 'Correlación con mesas activas']);
    assert.equal(d.datos.criterios.find(c => c.nombre === 'Sharpe deflactado').ensayos, d.datos.ensayosTotales);
  }
  for (const c of d.datos.criterios) {
    assert.ok('valor' in c && 'umbral' in c && typeof c.ok === 'boolean' && typeof c.comparacion === 'string', JSON.stringify(c));
  }
  assert.equal(d.datos.aprobada, d.datos.criterios.every(c => c.ok));
  assert.equal(d.datos.puertasOk, d.datos.criterios.filter(c => c.ok).length);
  assert.ok(Number.isFinite(d.datos.ensayosTotales) && d.datos.ensayosTotales >= d.datos.ensayosPrevios);
  assert.ok(d.datos.walkforward && Number.isFinite(d.datos.walkforward.combinaciones));
  assert.match(d.resumen, /(APROBADA|RECHAZADA): pasa \d+ de \d+ puertas/);
  await o.detener();
});

test('instantánea: cada mesa lleva su explicación con sus parámetros y cada agente su queHace', async () => {
  const ctx = await crearOrquestador({ pasos: 1 });
  const i = ctx.orquestador.instantanea();
  for (const a of i.agentes) assert.ok(typeof a.queHace === 'string' && a.queHace.length > 20, a.id);
  const tend = i.mesas.find(m => m.id === 'tendencia');
  assert.match(tend.explicacion.queMira, /últimas 7 velas/);
  assert.match(tend.explicacion.riesgo, /1 % del fondo/);
  for (const m of i.mesas) for (const k of ['queMira', 'cuandoCompra', 'cuandoVende', 'cuandoNada', 'riesgo']) assert.equal(typeof m.explicacion[k], 'string', `${m.id}.${k}`);
  assert.ok('sharpeBacktest' in tend && 'backtest' in tend);
  await ctx.orquestador.detener();
});

test('servidor local: GET /api/noticias, /api/historial y /api/decisiones', async () => {
  const { arrancarServidor, pedir } = require('./integracion-ayuda');
  const ctx = await crearOrquestador({ pasos: 30 });
  registros.anadir(path.join(ctx.carpeta, 'noticias.jsonl'), registros.lineaNoticia(N(9, ['BTC/USD']), { t: 1, universo: ['BTC/USD'] }));
  const srv = await arrancarServidor(ctx.orquestador);
  try {
    const h = await pedir(srv.base, '/api/historial');
    assert.equal(h.status, 200);
    assert.ok(Array.isArray(h.json) && h.json.length >= 2);
    const d = await pedir(srv.base, '/api/decisiones?tipo=asignacion&limite=5');
    assert.ok(d.json.length >= 1 && d.json.every(x => x.tipo === 'asignacion'), JSON.stringify(d.json).slice(0, 300));
    const n = await pedir(srv.base, '/api/noticias');
    assert.deepEqual(n.json.map(x => x.id), ['9']);
  } finally {
    await new Promise(r => srv.servidor.close(r));
    await ctx.orquestador.detener();
  }
});
