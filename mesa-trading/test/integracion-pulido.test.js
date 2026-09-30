'use strict';
// Casos conocidos de la verificación final (informe-revision, «FINAL
// problemas»): la tarjeta de cada puesto al cambiar el nivel del fondo (3), el
// comité con los datos del momento (9), la sombra «mismas mesas sin comité»
// que sufre todo lo que no es el comité (11) y el recorte real del tamaño en
// la instantánea (8, parte de datos).

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearOrquestador, PASO } = require('./integracion-ayuda');
const mesasDep = require('../src/agentes/departamentos/mesas');
const riesgos = require('../src/agentes/departamentos/riesgos');
const megafono = require('../src/agentes/megafono');
const comite = require('../src/agentes/comite');
const { COSTES_POR_DEFECTO } = require('../src/broker/comun');

const HORA = 3600_000;
const EPS = 1e-12;

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

function aperturaBTC(o, nocional = 1000) {
  const q = o.vivo.precios['BTC/USD'];
  return {
    puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD', clase: 'cripto', lado: 'compra', tipo: 'apertura',
    nocional, precio: q.precio, precioT: q.t, stop: q.precio * 0.9, precioDecision: q.precio,
  };
}

// ---------- 8: el recorte real del tamaño ----------

test('factorTamano: la instantánea da el recorte que se aplica de verdad (DEFENSIVO × Megáfono × caída), el mismo que usan las mesas y Riesgos', async () => {
  const { orquestador: o } = await crearOrquestador();
  assert.deepEqual(o.instantanea().fondo.factorTamano, { total: 1, comite: 1, megafono: 1, caida: 1 });
  // Momentum, la titular (40 %): Ruptura arranca en incubación desde el 30-sep-2026.
  const mesa = o.mesaPorId('momentum');
  const q = o.vivo.precios['BTC/USD'];
  // Stop al 20 %: manda el riesgo por operación, 1 % · 100.000 / 0,20 = 5.000 $
  // (el caso en que el recorte al capital no llegaba al nocional). Con el 1 %,
  // un stop al 10 % empataría con el tope por activo (10.000 $).
  const tamano = () => mesasDep.tamanoApertura(o, mesa, { peso: 1, precio: q.precio, stop: q.precio * 0.8, volAnual: 0.3 });
  const nocionalNormal = tamano().nocional;
  assert.equal(tamano().limitadoPor, 'riesgo');
  cerca(nocionalNormal, 5000);

  // El caso del informe: DEFENSIVO del comité y «reduce el riesgo a la mitad 3 horas».
  o.estado.directivas.modo = 'DEFENSIVO';
  o.estado.directivas = megafono.aplicarDirectiva(o.estado.directivas, { tipo: 'reducir_riesgo', factor: 0.5, horas: 3 }, o.reloj.ahora());
  const ft = o.instantanea().fondo.factorTamano;
  assert.deepEqual(ft, { total: 0.25, comite: 0.5, megafono: 0.5, caida: 1 }, 'no «DEFENSIVO ×0,5»: es ×0,25');
  cerca(tamano().nocional / nocionalNormal, ft.total);
  // Riesgos lo comprueba sin volver a multiplicar.
  const t = tamano();
  cerca(riesgos.evaluar(o, { ...aperturaBTC(o, t.nocional), puestoId: 'momentum-BTC', mesaId: 'momentum', stop: q.precio * 0.8, factorTamano: t.factor.total }).nocional, t.nocional);
  // La capital de la mesa en la instantánea también lleva el DEFENSIVO.
  const m = o.instantanea().mesas.find(x => x.id === 'momentum');
  cerca(m.capital, mesasDep.capitalMesa(o, mesa) * 0.5);

  // Con la caída desde el máximo (×0,5 del vigilante).
  o.estado.fondo.multiplicadorCaida = 0.5;
  const ft2 = o.instantanea().fondo.factorTamano;
  assert.deepEqual(ft2, { total: 0.125, comite: 0.5, megafono: 0.5, caida: 0.5 });
  cerca(tamano().nocional / nocionalNormal, ft2.total);

  // La reducción del Megáfono caduca: deja de contar a su hora.
  o.reloj.avanzar(3 * 3600_000 + PASO);
  assert.deepEqual(o.instantanea().fondo.factorTamano, { total: 0.25, comite: 0.5, megafono: 1, caida: 0.5 });
  await o.detener();
});

// ---------- 3: la tarjeta del puesto al cambiar el nivel del fondo ----------

const BLOQUEADO = 'Fondo bloqueado por el kill switch: no se opera hasta Reabrir.';
const EN_PAUSA = 'Fondo en pausa: no se abre nada hasta Reabrir.';

test('tarjeta de los puestos: tras el kill, Reabrir y Pausar se rehace en el acto con el nivel nuevo, no en la vela siguiente', async () => {
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 2 * 288 });
  const puestos = () => o.instantanea().puestos;
  assert.ok(puestos().some(p => !p.posicion && /Sin posición|Esperando|Rebalanceo/.test(p.estadoTexto)), 'antes del kill hablan de su estrategia');

  // Kill: todos (los que tenían posición, ya cerrada, y los que no) dicen el bloqueo al momento.
  const k = await o.comando('kill', { confirmacion: 'KILL' });
  assert.equal(k.ok, true, k.mensaje);
  for (const p of puestos()) assert.equal(p.estadoTexto, BLOQUEADO, p.id);

  // El caso del informe: una demo que acabó con el kill y pasa velas bloqueada…
  for (let i = 0; i < 60; i++) { reloj.avanzar(PASO); await o.paso(); }
  for (const p of puestos()) assert.equal(p.estadoTexto, BLOQUEADO, p.id);
  // …y un humano reabre: ningún puesto sigue diciendo «bloqueado» hasta su vela.
  const r = await o.comando('reabrir', { confirmacion: 'REABRIR' });
  assert.equal(r.ok, true, r.mensaje);
  const tras = puestos();
  for (const p of tras) {
    assert.doesNotMatch(p.estadoTexto, /bloquead|kill/i, p.id);
    assert.ok(p.estadoTexto.length > 0, p.id);
  }
  // Sin posición y con una vela ya decidida, vuelve a la espera de su estrategia.
  const ruptura = tras.find(p => p.id === 'ruptura-BTC');
  assert.match(ruptura.estadoTexto, /BTC/);

  // Pausar: los que no tienen posición lo dicen al momento.
  const pz = await o.comando('pausar');
  assert.equal(pz.ok, true);
  const enPausa = puestos().filter(p => !p.posicion);
  assert.ok(enPausa.length > 0);
  for (const p of enPausa) assert.equal(p.estadoTexto, EN_PAUSA, p.id);
  // Y al reabrir desde la pausa, vuelven a su estrategia.
  await o.comando('reabrir', { confirmacion: 'REABRIR' });
  for (const p of puestos()) assert.doesNotMatch(p.estadoTexto, /pausa|bloquead/i, p.id);
  // Lo mismo en disco: estado.json guarda la tarjeta ya rehecha.
  for (const [pid, aux] of Object.entries(o.estado.puestos)) assert.doesNotMatch(aux.estadoTexto || '', /pausa|bloquead/i, pid);
  await o.detener();
});

// ---------- 11: la sombra «mismas mesas sin comité» ----------

test('sombra «sin comité»: sufre el nivel del fondo real, el Megáfono y las noticias; no le llegan el modo, los multiplicadores ni los vetos del comité', async () => {
  const { orquestador: o } = await crearOrquestador();
  const ahora = o.reloj.ahora();
  const sombra = (nocional = 1000) => riesgos.evaluar(o, { ...aperturaBTC(o, nocional), puestoId: 'ruptura-BTC@sombra' }, { sombra: true });
  const vetaPor = (r, limite) => assert.ok(r.decision === 'vetar' && r.motivos.some(m => m.limite === limite), `${limite}: ${JSON.stringify(r)}`);
  assert.equal(sombra().decision, 'aprobar');

  // Nivel del fondo real: la pausa humana y el solo cerrar del vigilante no son del comité.
  assert.equal((await o.comando('pausar')).ok, true);
  vetaPor(sombra(), 'nivel');
  assert.equal((await o.comando('reabrir', { confirmacion: 'REABRIR' })).ok, true);
  assert.equal(sombra().decision, 'aprobar');
  o.estado.fondo.nivel = 'solo_cerrar';
  vetaPor(sombra(), 'nivel');
  o.estado.fondo.nivel = 'normal';

  // Directivas del Megáfono: solo cerrar, pausa de activo o de mesa, reducción.
  const conDirectiva = (d, fn) => {
    const antes = o.estado.directivas;
    o.estado.directivas = megafono.aplicarDirectiva(antes, d, ahora);
    try { fn(); } finally { o.estado.directivas = antes; }
  };
  conDirectiva({ tipo: 'solo_cerrar', horas: 2 }, () => vetaPor(sombra(), 'soloCerrar'));
  conDirectiva({ tipo: 'pausar_activo', simbolo: 'BTC/USD', horas: 2 }, () => vetaPor(sombra(), 'activoVetado'));
  conDirectiva({ tipo: 'pausar_mesa', mesaId: 'ruptura', horas: 2 }, () => vetaPor(sombra(), 'mesaPausada'));
  conDirectiva({ tipo: 'reducir_riesgo', factor: 0.5, horas: 2 }, () => cerca(sombra().nocional, 500));

  // Un evento grave de noticias veta 24 h: tampoco es una decisión del comité.
  const d0 = o.estado.directivas;
  o.estado.directivas = { ...d0, activosVetados: [...d0.activosVetados, { simbolo: 'BTC/USD', hasta: ahora + 24 * HORA, motivo: 'noticia grave (hackeo)', origen: 'noticias' }] };
  vetaPor(sombra(), 'activoVetado');
  o.estado.directivas = d0;

  // El comité: SOLO_CERRAR, la mesa a ×0 y BTC vetado. El fondo lo sufre; la sombra no.
  comite.aplicarDecision(o, { modo: 'SOLO_CERRAR', multiplicadores: { ruptura: 0 }, vetos: ['BTC/USD'] }, ahora);
  assert.equal(riesgos.evaluar(o, aperturaBTC(o)).decision, 'vetar', 'el fondo sí');
  const r = sombra();
  assert.equal(r.decision, 'aprobar', JSON.stringify(r.motivos));
  cerca(r.nocional, 1000);
  // Y el DEFENSIVO no toca el capital de la mesa en la sombra.
  o.estado.directivas.modo = 'DEFENSIVO';
  const mesa = o.mesaPorId('ruptura');
  cerca(mesasDep.capitalMesa(o, mesa, { sombra: true }), o.vivo.patrimonioSombra * mesa.peso);
  await o.detener();
});

test('kill: cierra también la sombra «sin comité» al precio al que vendió el fondo, descarta sus compras en cola y la deja sin abrir hasta Reabrir', async () => {
  const { orquestador: o, reloj } = await crearOrquestador();
  const mesa = o.mesaPorId('ruptura');
  const r1 = await o.ejecutor.ejecutar({ puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD', lado: 'compra', nocional: 5000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: reloj.ahora(), stop: 1 });
  assert.equal(r1.ok, true);
  await o.refrescarCartera();
  for (const simbolo of ['BTC/USD', 'ETH/USD']) {
    const px = o.vivo.precios[simbolo].precio;
    mesasDep.abrirSombra(o, { mesa, simbolo, senal: { peso: 1, stop: px * 0.9, objetivoPrecio: null }, cierre: px, tVela: reloj.ahora() - 24 * HORA, vol: 0.6 });
  }
  const abiertas = o.libros.listaPuestos({ sombra: true }).filter(p => p.cantidad > EPS);
  assert.deepEqual(abiertas.map(p => p.simbolo).sort(), ['BTC/USD', 'ETH/USD'], 'la sombra tiene BTC (como el fondo) y ETH (solo ella)');
  o.estado.sombra.pendientes.push({ puestoId: 'ruptura-SOL@sombra', mesaId: 'ruptura', simbolo: 'SOL/USD', lado: 'compra', nocional: 1000, enviarDesde: reloj.ahora() + HORA });
  const pxEth = o.vivo.precios['ETH/USD'].precio;

  const k = await o.comando('kill', { confirmacion: 'KILL' });
  assert.equal(k.ok, true, k.mensaje);
  for (const p of o.libros.listaPuestos({ sombra: true })) assert.ok(!(p.cantidad > EPS), `${p.puestoId} sigue abierto en la sombra`);
  const real = o.operaciones.find(op => op.simbolo === 'BTC/USD' && op.motivoSalida === 'kill');
  const sBtc = o.operacionesSombra.find(op => op.simbolo === 'BTC/USD' && op.motivoSalida === 'kill');
  const sEth = o.operacionesSombra.find(op => op.simbolo === 'ETH/USD' && op.motivoSalida === 'kill');
  assert.ok(real && sBtc && sEth, 'el kill cierra lo real y lo de la sombra');
  assert.equal(sBtc.salidaPrecio, real.salidaPrecio, 'BTC, al mismo precio al que vendió el fondo');
  cerca(sEth.salidaPrecio, pxEth * (1 - COSTES_POR_DEFECTO.deslizamiento('ETH/USD')), 1e-12);
  assert.equal(o.estado.sombra.pendientes.filter(x => x.lado === 'compra').length, 0, 'las compras en cola de la sombra se descartan, como las del fondo');
  cerca(o.vivo.patrimonioSombra, o.estado.sombra.efectivo);
  // Bloqueado: la sombra tampoco abre.
  const q = o.vivo.precios['BTC/USD'];
  const r = riesgos.evaluar(o, { ...aperturaBTC(o), puestoId: 'ruptura-BTC@sombra', precio: q.precio, precioT: q.t }, { sombra: true });
  assert.equal(r.decision, 'vetar');
  await o.detener();
});

// ---------- 9: el comité con los datos del momento ----------

// Pausas del comité: antes de cada punto (1 controller … 6 megafono) y antes
// de la decisión (7). `acciones[n]` corre en la pausa n, como un humano que
// pulsa algo mientras el comité está reunido (un comité ocupa 15 min
// simulados a ×600).
function conPausas(o, acciones) {
  let n = 0;
  o.pausaPantalla = async () => { n++; if (acciones[n]) await acciones[n](); };
}

function llmFalsoComite(respuesta) {
  const llamadas = [];
  return {
    llamadas, activo: true,
    async pedirJSON(args) { llamadas.push(args); return { ok: true, datos: respuesta(args), costeUsd: 0.01, modelo: 'claude-opus-5-5', tokens: {} }; },
    estado: () => ({ activo: true, modeloComite: 'claude-opus-5-5', modeloAgentes: 'claude-opus-5-5', gastoHoyUsd: 0, presupuestoDiaUsd: 2 }),
    gastoHoy: () => 0, gastoDelDia: () => 0, gastoEntre: () => 0, fijarModelos() {}, fijarPresupuesto() {},
  };
}

const delComite = (mensajes, desde) => mensajes.slice(desde).filter(m => m.canal === 'comite');

test('comité: si un humano reabre y aplica el Megáfono durante la reunión, cada punto lo dice con el estado del momento y la decisión usa el del final', async () => {
  const { orquestador: o } = await crearOrquestador({ pasos: 2 });
  const mensajes = [];
  o.on('mensaje', m => mensajes.push(m));
  assert.equal((await o.comando('kill', { confirmacion: 'KILL' })).ok, true);
  o.estado.macro.regimen = { valor: 'NEUTRAL', puntos: 0, detalle: 'NEUTRAL (0): prueba' };
  const desde = mensajes.length;
  conPausas(o, {
    // Antes de Macro (la reunión ya empezó con el fondo bloqueado): Reabrir.
    2: async () => assert.equal((await o.comando('reabrir', { confirmacion: 'REABRIR' })).ok, true),
    // Antes del Laboratorio: una orden del Megáfono, aplicada.
    5: async () => {
      const p = await o.comando('megafono', { texto: 'no abras en BTC durante 2 horas' });
      assert.equal(p.ok, true, p.mensaje);
      assert.equal((await o.comando('megafono-aplicar', { id: p.datos.id })).ok, true);
    },
  });
  const r = await comite.celebrar(o, { motivo: 'demanda' });
  assert.equal(r.ok, true);
  const c = delComite(mensajes, desde);
  const riesgosPunto = c.find(m => m.datos && m.datos.punto === 'riesgos');
  assert.match(riesgosPunto.texto, /El fondo está en nivel normal/, 'el nivel de cuando se publica, no el del principio');
  assert.equal(riesgosPunto.datos.voto, 'NORMAL');
  assert.match(riesgosPunto.texto, /de bloqueado a normal/);
  assert.match(riesgosPunto.texto, /un humano ha reabierto el fondo/);
  const mf = c.find(m => m.datos && m.datos.punto === 'megafono');
  assert.doesNotMatch(mf.texto, /no hay órdenes vigentes/);
  assert.match(mf.texto, /1 orden vigente/);
  assert.match(mf.texto, /un humano ha aplicado el Megáfono/);
  const d = c.find(m => m.tipo === 'decision');
  assert.equal(d.datos.modo, 'NORMAL', 'nada de DEFENSIVO por un «Nivel bloqueado» que ya no es');
  assert.deepEqual(d.datos.votos, { macro: 'NORMAL', riesgos: 'NORMAL' });
  assert.equal(o.estado.directivas.modo, 'NORMAL');
  await o.detener();
});

test('comité: si el cambio llega después de que Riesgos haya votado, los votos se recalculan al decidir y la decisión lo dice', async () => {
  const { orquestador: o } = await crearOrquestador({ pasos: 2 });
  const mensajes = [];
  o.on('mensaje', m => mensajes.push(m));
  o.estado.macro.regimen = { valor: 'NEUTRAL', puntos: 0, detalle: 'NEUTRAL (0): prueba' };
  const desde = mensajes.length;
  conPausas(o, { 4: async () => assert.equal((await o.comando('pausar')).ok, true) });
  await comite.celebrar(o, { motivo: 'demanda' });
  const c = delComite(mensajes, desde);
  assert.equal(c.find(m => m.datos && m.datos.punto === 'riesgos').datos.voto, 'NORMAL', 'votó antes de la pausa');
  const d = c.find(m => m.tipo === 'decision');
  assert.equal(d.datos.modo, 'DEFENSIVO', 'con el fondo en pausa al decidir, Riesgos vota DEFENSIVO y es veto');
  assert.deepEqual(d.datos.votos, { macro: 'NORMAL', riesgos: 'DEFENSIVO' });
  assert.match(d.texto, /Al cerrar he vuelto a contar los votos: Marta vota ahora DEFENSIVO \(antes dijo NORMAL; el fondo está ahora en pausa\)/);
  await o.detener();
});

test('comité con LLM: si los votos cambian durante la reunión, su decisión (tomada con los de antes) no se aplica y su texto viejo no sale', async () => {
  const llm = llmFalsoComite(args => ({
    modo: 'SOLO_CERRAR',
    multiplicadores: Object.fromEntries(Object.keys(args.esquema.properties.multiplicadores.properties).map(id => [id, 0.5])),
    vetos: ['SOL/USD'],
    razon: 'El fondo está bloqueado.',
    intervenciones: [{ agente: 'riesgos', texto: `Nivel ${args.entrada.riesgos.nivel}: voto ${args.entrada.votos.riesgos}.` }],
  }));
  const { orquestador: o } = await crearOrquestador({ pasos: 2, llm });
  const mensajes = [];
  o.on('mensaje', m => mensajes.push(m));
  await o.comando('kill', { confirmacion: 'KILL' });
  o.estado.macro.regimen = { valor: 'NEUTRAL', puntos: 0, detalle: 'NEUTRAL (0): prueba' };
  const desde = mensajes.length;
  conPausas(o, { 1: async () => assert.equal((await o.comando('reabrir', { confirmacion: 'REABRIR' })).ok, true) });
  await comite.celebrar(o, { motivo: 'demanda' });
  assert.equal(llm.llamadas.length, 1);
  assert.equal(llm.llamadas[0].entrada.riesgos.nivel, 'bloqueado', 'el LLM decidió con el fondo bloqueado');
  const c = delComite(mensajes, desde);
  const rp = c.find(m => m.datos && m.datos.punto === 'riesgos');
  assert.equal(rp.datos.fuente, 'plantilla', 'su «Nivel bloqueado: voto DEFENSIVO» ya no es verdad');
  assert.match(rp.texto, /El fondo está en nivel normal/);
  const d = c.find(m => m.tipo === 'decision');
  assert.equal(d.datos.fuente, 'defecto');
  assert.equal(d.datos.modo, 'NORMAL');
  assert.match(d.datos.motivoPlanPorDefecto, /votos cambiaron/);
  assert.doesNotMatch(d.texto, /bloqueado/);
  assert.equal(o.estado.directivas.activosVetados.filter(v => v.origen === 'comite' && v.simbolo === 'SOL/USD').length, 0);
  await o.detener();
});

test('Megáfono con la interpretación hecha fuera (web): no vuelve a llamar al LLM y revalida contra el estado', async () => {
  const { orquestador: o } = await crearOrquestador();
  let llamadas = 0;
  const original = megafono.interpretar;
  megafono.interpretar = async (...a) => { llamadas++; return original(...a); };
  try {
    const fuera = { directivas: [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }, { tipo: 'reducir_riesgo', factor: 0, horas: 4 }], explicacion: 'Pauso SOL y bajo todo a cero.', fuente: 'llm' };
    const r = await o.comando('megafono', { texto: 'pausa SOL 24 h' }, { interpretacion: fuera });
    assert.equal(r.ok, true);
    assert.equal(llamadas, 0, 'con la interpretación de fuera no se interpreta otra vez');
    assert.deepEqual(o.estado.megafonoPendiente.directivas, [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }]);
    assert.notEqual(o.estado.megafonoPendiente.explicacion, fuera.explicacion);
    // Sin canal interno, una «interpretacion» entre los datos (lo que manda un navegador) no cuenta.
    const r2 = await o.comando('megafono', { texto: 'pausa DOGE 2 h', interpretacion: { directivas: [{ tipo: 'solo_cerrar', horas: 72 }] } });
    assert.equal(r2.ok, true);
    assert.equal(llamadas, 1);
    assert.deepEqual(o.estado.megafonoPendiente.directivas.map(d => d.tipo), ['pausar_activo']);
  } finally {
    megafono.interpretar = original;
  }
});
