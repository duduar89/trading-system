'use strict';
// Remates del orquestador: el Megáfono y el comité hablan con nombres de
// mesa (no ids) y el Megáfono dura hasta el comité siguiente; detener() no
// espera a las pausas de pantalla del comité; var24h no se mueve con un
// precio congelado.

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearOrquestador, PASO } = require('./integracion-ayuda');
const comite = require('../src/agentes/comite');

const HORA = 3_600_000;

function llmFalso(respuestas) {
  return {
    activo: true,
    async pedirJSON(args) {
      const r = respuestas[args.proposito];
      const datos = typeof r === 'function' ? r(args) : r;
      if (!datos) return { ok: false, motivo: 'error', detalle: 'sin respuesta en la prueba', costeUsd: 0 };
      return { ok: true, datos, costeUsd: 0, modelo: 'claude-opus-5-5', tokens: {} };
    },
    estado: () => ({ activo: true, modeloComite: 'claude-opus-5-5', modeloAgentes: 'claude-opus-5-5', gastoHoyUsd: 0, presupuestoDiaUsd: 2, llamadasHoy: 0, ultimoError: null }),
    gastoHoy: () => 0,
    gastoDelDia: () => 0,
    gastoEntre: () => 0,
    fijarModelos() {},
    fijarPresupuesto() {},
  };
}

test('Megáfono desde el panel: sin duración dura hasta el comité siguiente (COMITE_HORAS) y la directiva nombra la mesa', async () => {
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 1 });
  o.config.cadencias.comiteHoras = 6;
  const mensajes = [];
  o.on('mensaje', m => mensajes.push(m));
  const p = await o.comando('megafono', { texto: 'pausa la mesa ruptura' });
  assert.equal(p.ok, true, p.mensaje);
  assert.deepEqual(p.datos.directivas, [{ tipo: 'pausar_mesa', mesaId: 'ruptura', horas: 6 }]);
  assert.match(p.datos.explicacion, /Ruptura Donchian/);
  const a = await o.comando('megafono-aplicar', { id: p.datos.id });
  assert.equal(a.ok, true);
  const dir = mensajes.find(m => m.tipo === 'directiva');
  assert.equal(dir.texto, 'Pausar la mesa Ruptura Donchian durante 6 h.');
  const pausa = o.instantanea().directivas.mesasPausadas.find(x => x.mesaId === 'ruptura');
  assert.equal(pausa.hasta, reloj.ahora() + 6 * HORA);
  await o.detener();
});

test('comité: la decisión nombra las mesas por su nombre, no por su id', async () => {
  const llm = llmFalso({
    comite: () => ({
      modo: 'NORMAL',
      multiplicadores: { tendencia: 1, momentum: 1, reversion: 0.5, ruptura: 0 },
      vetos: [],
      razon: '',
      intervenciones: [],
    }),
  });
  const { orquestador: o } = await crearOrquestador({ llm, pasos: 1 });
  const mensajes = [];
  o.on('mensaje', m => mensajes.push(m));
  const r = await comite.celebrar(o, { motivo: 'demanda' });
  assert.equal(r.ok, true);
  const d = mensajes.find(m => m.canal === 'comite' && m.tipo === 'decision');
  assert.match(d.texto, /Paro la mesa Ruptura Donchian\./);
  assert.match(d.texto, /A la mitad: Reversión RSI\./);
  assert.doesNotMatch(d.texto, /\bruptura\b|\breversion\b/);
  await o.detener();
});

test('detener() corta las pausas de pantalla del comité: un Ctrl+C no espera al orden del día', async () => {
  // 8 pausas de 5 s: sin cortarlas, detener() esperaría unos 40 s.
  const { orquestador: o } = await crearOrquestador({ pasos: 1, opciones: { pausaComiteMs: 5000 } });
  const mensajes = [];
  o.on('mensaje', m => mensajes.push(m));
  assert.equal(o._cmdComite().ok, true);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(o.comiteEnCurso, true, 'el comité está reunido y en pausa');
  const t0 = Date.now();
  await o.detener();
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `detener() tardó ${ms} ms`);
  assert.equal(o.comiteEnCurso, false);
  assert.ok(mensajes.some(m => m.canal === 'comite' && m.tipo === 'decision'), 'el comité termina (sin pausas) y decide');
  assert.equal(await o.pausaPantalla(5000), undefined, 'tras detener() no hay más pausas');
});

test('var24h: con el precio congelado (datos caídos) no se mueve con el paso del tiempo', async () => {
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 1 });
  await o.esperarTareas();                   // historial sembrado con las velas de 1H de las últimas 26 h
  const var0 = o.instantanea().cotizaciones.find(c => c.simbolo === 'BTC/USD').var24hPct;
  assert.ok(Number.isFinite(var0), 'hay variación de 24 h');
  // Los datos se paran: ultimos() devuelve siempre la misma cotización (mismo t).
  const congelado = await o.datos.ultimos(o.universo.map(a => a.simbolo));
  o.datos.ultimos = async () => JSON.parse(JSON.stringify(congelado));
  for (let k = 0; k < 6 * 12; k++) {          // 6 h
    reloj.avanzar(PASO);
    await o.paso();
  }
  const c = o.instantanea().cotizaciones.find(x => x.simbolo === 'BTC/USD');
  assert.equal(c.t, congelado['BTC/USD'].t);
  assert.equal(c.var24hPct, var0, 'la referencia es la de 24 h antes del DATO, no del latido');
  await o.detener();
});

test('avisos: lo que bloquea aperturas sin parar el fondo (vetos y mesas sin abrir), con quién y hasta cuándo', async () => {
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 1 });
  const ahora = reloj.ahora();
  const d = o.estado.directivas;
  d.activosVetados.push({ simbolo: 'SOL/USD', hasta: ahora + 6 * HORA, motivo: 'Megáfono', origen: 'megafono' });
  d.activosVetados.push({ simbolo: 'DOGE/USD', hasta: ahora + 24 * HORA, motivo: 'noticia grave (hackeo)', origen: 'noticias' });
  d.mesasPausadas.push({ mesaId: 'ruptura', hasta: ahora + 2 * HORA, origen: 'megafono' });
  d.multiplicadores.reversion = 0;
  const av = o.instantanea().avisos;
  const vetos = av.find(a => a.startsWith('No se abre en'));
  assert.match(vetos, /SOL \(Megáfono, hasta las \d\d:\d\d\)/);
  // 24 h acaban otro día: con la fecha, como el feed (si no, parecía caducado).
  assert.match(vetos, /DOGE \(noticia grave, hasta el \d{1,2} \S+ \d\d:\d\d\)/);
  const mesas = av.find(a => a.startsWith('Mesas sin abrir nada'));
  assert.match(mesas, /Ruptura Donchian \(Megáfono, hasta las \d\d:\d\d\)/);
  assert.match(mesas, /Reversión RSI \(comité ×0/);
  assert.ok(av.indexOf(vetos) < av.findIndex(a => /ordenador apagado/.test(a)), 'van delante de los avisos fijos');
  // Con el fondo en pausa ya no se abre nada: sobran.
  o.estado.fondo.nivel = 'pausado';
  const av2 = o.instantanea().avisos;
  assert.match(av2[0], /^Fondo en pausa/);
  assert.ok(!av2.some(a => /^No se abre en|^Mesas sin abrir/.test(a)));
  await o.detener();
});

test('laboratorio: las lecciones guardadas sin motivoSalida (estado.json viejo) toman el de su operación; las de un kill no dan pistas', async () => {
  const laboratorio = require('../src/agentes/departamentos/laboratorio');
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 1 });
  o.lanzar = () => null;                                   // solo la generación, sin evaluar
  const ahora = reloj.ahora();
  const op = k => ({ id: `ruptura-SOL#${k}`, puestoId: 'ruptura-SOL', mesaId: 'ruptura', simbolo: 'SOL/USD', pnl: -50, motivoSalida: 'kill' });
  o.operaciones.push(...Array.from({ length: 5 }, (_, k) => op(k)));
  // Cinco señales falsas de ruptura, sin motivoSalida, todas de operaciones cerradas por el kill.
  o.estado.lecciones = Array.from({ length: 5 }, (_, k) => ({ t: ahora, operacionId: `ruptura-SOL#${k}`, mesaId: 'ruptura', categoria: 'señal_falsa' }));
  const nuevas = laboratorio.revisionSemanal(o);
  assert.ok(!nuevas.some(h => h.origen === 'leccion'), nuevas.map(h => h.motivo).join(' | '));
  // Las mismas lecciones de operaciones cerradas por su regla sí dan la pista.
  o.operaciones.length = 0;
  o.operaciones.push(...Array.from({ length: 5 }, (_, k) => ({ ...op(k), motivoSalida: 'señal' })));
  reloj.avanzar(7 * 24 * HORA);
  o.estado.lecciones = o.estado.lecciones.map(l => ({ ...l, t: reloj.ahora() }));
  const otra = laboratorio.revisionSemanal(o);
  assert.ok(otra.some(h => h.origen === 'leccion' && h.mesaId === 'ruptura'), otra.map(h => h.motivo).join(' | '));
  await o.detener();
});
