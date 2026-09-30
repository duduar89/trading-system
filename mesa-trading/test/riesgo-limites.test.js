'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITES_DUROS } = require('../src/config');
const { evaluarPropuesta, normalizarDirectivas } = require('../src/riesgo/limites');

const AHORA = Date.UTC(2026, 8, 29, 12);
const HORA = 3_600_000;
const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

// Patrimonio 100.000 $, nada abierto. Límites: los de config, recibidos por parámetro.
function ctx(extra = {}) {
  return {
    ahora: AHORA,
    patrimonio: 100000,
    valoracion: { exposicionBruta: 0, exposicionCripto: 0, exposicionPorActivo: {}, posicionesAbiertas: 0 },
    nivel: 'normal',
    multiplicadorCaida: 1,
    directivas: null,
    ordenes: { ultimoMinuto: 0, ultimaHoraPorMesa: {} },
    mercadoAbierto: { accion: true },
    limites: LIMITES_DUROS,
    ...extra,
  };
}

// Apertura de 5.000 $ en BTC a 100.000 con stop a 95.000: riesgo 250 $ (0,25 %), peso 5 %. Cabe entera.
function prop(extra = {}) {
  return {
    puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', clase: 'cripto', lado: 'compra', tipo: 'apertura',
    nocional: 5000, cantidad: 0.05, precio: 100000, precioT: AHORA - 10_000, stop: 95000, precioDecision: 100000,
    ...extra,
  };
}

function vetada(r, limite) {
  assert.equal(r.decision, 'vetar');
  assert.equal(r.nocional, 0);
  assert.equal(r.cantidad, 0);
  const m = r.motivos.find(x => x.limite === limite);
  assert.ok(m, `falta el motivo ${limite}: ${JSON.stringify(r.motivos)}`);
  assert.equal(typeof m.texto, 'string');
  return m;
}

test('apertura que cabe entera → aprobar sin motivos', () => {
  const r = evaluarPropuesta(prop(), ctx());
  assert.equal(r.decision, 'aprobar');
  cerca(r.nocional, 5000);
  cerca(r.cantidad, 0.05);
  assert.deepEqual(r.motivos, []);
});

// ---------------------------------------------------------------- bloqueado

test('bloqueado veta todo salvo kill (también cierres)', () => {
  const c = ctx({ nivel: 'bloqueado' });
  const m = vetada(evaluarPropuesta(prop(), c), 'bloqueado');
  assert.match(m.texto, /Reabrir/);
  vetada(evaluarPropuesta(prop({ tipo: 'cierre', lado: 'venta' }), c), 'bloqueado');
  vetada(evaluarPropuesta(prop({ tipo: 'stop', lado: 'venta' }), c), 'bloqueado');
  vetada(evaluarPropuesta(prop({ tipo: 'prueba' }), c), 'bloqueado');
  const k = evaluarPropuesta(prop({ tipo: 'kill', lado: 'venta', cantidad: 0.05 }), c);
  assert.equal(k.decision, 'aprobar');
  cerca(k.cantidad, 0.05);
});

// ---------------------------------------------------------------- reducir riesgo pasa siempre

test('reducciones, cierres y stops se aprueban siempre, aunque el precio sea viejo y el fondo esté en solo cerrar', () => {
  const c = ctx({ nivel: 'solo_cerrar', directivas: { activosVetados: [{ simbolo: 'BTC/USD', hasta: AHORA + HORA }] }, ordenes: { ultimoMinuto: 99, ultimaHoraPorMesa: { tendencia: 99 } } });
  for (const tipo of ['reduccion', 'cierre', 'stop']) {
    const r = evaluarPropuesta(prop({ tipo, lado: 'venta', nocional: null, cantidad: 0.02, precioT: AHORA - 3_600_000 }), c);
    assert.equal(r.decision, 'aprobar', tipo);
    cerca(r.cantidad, 0.02);
    cerca(r.nocional, 2000);
  }
});

test('una «reducción» que compra no se cuela', () => {
  const m = vetada(evaluarPropuesta(prop({ tipo: 'cierre', lado: 'compra' }), ctx()), 'tipoIncoherente');
  assert.match(m.texto, /venta/);
});

// ---------------------------------------------------------------- vetos de aperturas y aumentos

test('veto: nivel distinto de normal (solo cerrar y pausado)', () => {
  const m = vetada(evaluarPropuesta(prop(), ctx({ nivel: 'solo_cerrar' })), 'nivel');
  assert.match(m.texto, /solo cerrar/);
  vetada(evaluarPropuesta(prop({ tipo: 'aumento' }), ctx({ nivel: 'pausado' })), 'nivel');
});

test('veto: directiva de solo cerrar vigente (resumen, Megáfono y modo del comité); caducada no', () => {
  vetada(evaluarPropuesta(prop(), ctx({ directivas: { soloCerrarHasta: AHORA + HORA } })), 'soloCerrar');
  vetada(evaluarPropuesta(prop(), ctx({ directivas: [{ tipo: 'solo_cerrar', horas: 2, hasta: AHORA + 2 * HORA }] })), 'soloCerrar');
  vetada(evaluarPropuesta(prop(), ctx({ directivas: { modo: 'SOLO_CERRAR' } })), 'soloCerrar');
  assert.equal(evaluarPropuesta(prop(), ctx({ directivas: { soloCerrarHasta: AHORA - 1 } })).decision, 'aprobar');
});

test('veto: activo vetado (comité o Megáfono) con su motivo', () => {
  const m = vetada(evaluarPropuesta(prop(), ctx({ directivas: { activosVetados: [{ simbolo: 'BTC/USD', hasta: AHORA + HORA, motivo: 'noticia grave' }] } })), 'activoVetado');
  assert.match(m.texto, /BTC vetado/);
  assert.match(m.texto, /noticia grave/);
  vetada(evaluarPropuesta(prop(), ctx({ directivas: [{ tipo: 'pausar_activo', simbolo: 'BTC/USD', hasta: AHORA + HORA }] })), 'activoVetado');
  // Otro activo vetado no afecta.
  assert.equal(evaluarPropuesta(prop(), ctx({ directivas: { activosVetados: [{ simbolo: 'ETH/USD', hasta: AHORA + HORA }] } })).decision, 'aprobar');
});

test('veto: mesa pausada y mesa a ×0 por el comité', () => {
  const m = vetada(evaluarPropuesta(prop(), ctx({ directivas: { mesasPausadas: [{ mesaId: 'tendencia', hasta: AHORA + HORA }] } })), 'mesaPausada');
  assert.match(m.texto, /tendencia/);
  vetada(evaluarPropuesta(prop(), ctx({ directivas: [{ tipo: 'pausar_mesa', mesaId: 'tendencia', hasta: AHORA + HORA }] })), 'mesaPausada');
  vetada(evaluarPropuesta(prop(), ctx({ directivas: { multiplicadores: { tendencia: 0 } } })), 'multiplicadorComite');
});

test('veto: acción con la bolsa cerrada (y sin dato de la bolsa)', () => {
  const spy = prop({ simbolo: 'SPY', clase: 'accion', precio: 500, precioDecision: 500, stop: 480, nocional: 2000, cantidad: 4 });
  const m = vetada(evaluarPropuesta(spy, ctx({ mercadoAbierto: { accion: false } })), 'mercadoCerrado');
  assert.match(m.texto, /SPY/);
  vetada(evaluarPropuesta(spy, ctx({ mercadoAbierto: undefined })), 'mercadoCerrado');
  assert.equal(evaluarPropuesta(spy, ctx()).decision, 'aprobar');
  // La cripto no mira la bolsa.
  assert.equal(evaluarPropuesta(prop(), ctx({ mercadoAbierto: { accion: false } })).decision, 'aprobar');
});

test('veto: precio viejo (cripto 900 s, acciones 120 s) con los segundos en el texto', () => {
  const m = vetada(evaluarPropuesta(prop({ precioT: AHORA - 901_000 }), ctx()), 'maxAntiguedadPrecioSegCripto');
  cerca(m.valor, 901);
  assert.equal(m.maximo, 900);
  assert.match(m.texto, /901 s/);
  assert.match(m.texto, /900 s/);
  assert.equal(evaluarPropuesta(prop({ precioT: AHORA - 900_000 }), ctx()).decision, 'aprobar');
  const spy = prop({ simbolo: 'SPY', clase: 'accion', precio: 500, precioDecision: 500, stop: 480, nocional: 2000, precioT: AHORA - 121_000 });
  vetada(evaluarPropuesta(spy, ctx()), 'maxAntiguedadPrecioSegAcciones');
  vetada(evaluarPropuesta(prop({ precioT: undefined }), ctx()), 'maxAntiguedadPrecioSegCripto');
});

test('veto: desvío > 2 % entre la decisión y el precio actual', () => {
  // Decidido a 100.000, ahora 102.100: 2,10 % > 2,00 %.
  const m = vetada(evaluarPropuesta(prop({ precio: 102100, stop: 97000 }), ctx()), 'desvioMaxPrecio');
  cerca(m.valor, 0.021);
  assert.match(m.texto, /2,10 %/);
  assert.match(m.texto, /100\.000 → 102\.100/);
  // Justo el 2 % pasa.
  assert.equal(evaluarPropuesta(prop({ precio: 102000, stop: 97000 }), ctx()).decision, 'aprobar');
});

test('veto: apertura sin stop válido', () => {
  vetada(evaluarPropuesta(prop({ stop: null }), ctx()), 'sinStop');
  vetada(evaluarPropuesta(prop({ stop: 100500 }), ctx()), 'sinStop');
});

test('veto: posiciones al máximo, salvo que el símbolo ya esté abierto', () => {
  const lleno = { exposicionBruta: 30000, exposicionCripto: 30000, exposicionPorActivo: { 'ETH/USD': 2500 }, posicionesAbiertas: 12 };
  const m = vetada(evaluarPropuesta(prop(), ctx({ valoracion: lleno })), 'maxPosiciones');
  assert.match(m.texto, /12 posiciones/);
  const conBTC = { ...lleno, exposicionPorActivo: { 'BTC/USD': 2500 } };
  assert.equal(evaluarPropuesta(prop(), ctx({ valoracion: conBTC })).decision, 'aprobar');
});

test('veto: órdenes por minuto y por mesa y hora agotadas', () => {
  const m1 = vetada(evaluarPropuesta(prop(), ctx({ ordenes: { ultimoMinuto: 10, ultimaHoraPorMesa: {} } })), 'maxOrdenesMinuto');
  assert.match(m1.texto, /10 órdenes/);
  const m2 = vetada(evaluarPropuesta(prop(), ctx({ ordenes: { ultimoMinuto: 0, ultimaHoraPorMesa: { tendencia: 4 } } })), 'maxOrdenesMesaHora');
  assert.match(m2.texto, /4 órdenes/);
  assert.equal(evaluarPropuesta(prop(), ctx({ ordenes: { ultimoMinuto: 9, ultimaHoraPorMesa: { tendencia: 3 } } })).decision, 'aprobar');
});

test('veto: nocional por debajo del mínimo de 10 $', () => {
  const m = vetada(evaluarPropuesta(prop({ nocional: 8, cantidad: 0.00008 }), ctx()), 'minNocionalOrden');
  assert.match(m.texto, /8,00 \$/);
  assert.match(m.texto, /10,00 \$/);
});

test('se reúnen todos los vetos, no solo el primero', () => {
  const r = evaluarPropuesta(prop({ precioT: AHORA - 999_000 }), ctx({ nivel: 'solo_cerrar', ordenes: { ultimoMinuto: 10, ultimaHoraPorMesa: {} } }));
  assert.deepEqual(r.motivos.map(m => m.limite), ['nivel', 'maxAntiguedadPrecioSegCripto', 'maxOrdenesMinuto']);
});

// ---------------------------------------------------------------- recortes

test('recorte: máximo por activo (10 %) — ya hay 7.000 $ en BTC, caben 3.000', () => {
  const val = { exposicionBruta: 7000, exposicionCripto: 7000, exposicionPorActivo: { 'BTC/USD': 7000 }, posicionesAbiertas: 1 };
  const r = evaluarPropuesta(prop({ tipo: 'aumento' }), ctx({ valoracion: val }));
  assert.equal(r.decision, 'reducir');
  cerca(r.nocional, 3000);
  cerca(r.cantidad, 0.03);
  const m = r.motivos.find(x => x.limite === 'maxPesoPorActivo');
  cerca(m.valor, 0.12);
  assert.equal(m.maximo, 0.10);
  assert.match(m.texto, /12\.000 \$ \(12,00 % del patrimonio\)/);
  assert.match(m.texto, /10,00 % \(10\.000 \$\)/);
  assert.match(m.texto, /5\.000 \$ a 3\.000 \$/);
});

test('recorte: exposición bruta (80 %) — hay 77.000 $, caben 3.000', () => {
  const val = { exposicionBruta: 77000, exposicionCripto: 20000, exposicionPorActivo: {}, posicionesAbiertas: 5 };
  const r = evaluarPropuesta(prop(), ctx({ valoracion: val }));
  assert.equal(r.decision, 'reducir');
  cerca(r.nocional, 3000);
  const m = r.motivos.find(x => x.limite === 'maxExposicionBruta');
  assert.match(m.texto, /82\.000 \$ \(82,00 %\)/);
  assert.match(m.texto, /80,00 %/);
});

test('recorte: exposición cripto (50 %) — hay 48.000 $ en cripto, caben 2.000; a una acción no le afecta', () => {
  const val = { exposicionBruta: 48000, exposicionCripto: 48000, exposicionPorActivo: {}, posicionesAbiertas: 5 };
  const r = evaluarPropuesta(prop(), ctx({ valoracion: val }));
  assert.equal(r.decision, 'reducir');
  cerca(r.nocional, 2000);
  assert.match(r.motivos.find(x => x.limite === 'maxExposicionCripto').texto, /53\.000 \$ \(53,00 %\)/);
  const spy = prop({ simbolo: 'SPY', clase: 'accion', precio: 500, precioDecision: 500, stop: 480, nocional: 5000 });
  assert.equal(evaluarPropuesta(spy, ctx({ valoracion: val })).decision, 'aprobar');
});

test('recorte: multiplicador de caída ×0,5', () => {
  const r = evaluarPropuesta(prop(), ctx({ multiplicadorCaida: 0.5 }));
  assert.equal(r.decision, 'reducir');
  cerca(r.nocional, 2500);
  const m = r.motivos.find(x => x.limite === 'multiplicadorCaida');
  assert.match(m.texto, /×0,50/);
  assert.match(m.texto, /5\.000 \$ → 2\.500 \$/);
});

test('recorte: directiva del Megáfono reducir_riesgo ×0,25 (manda la más dura si hay varias)', () => {
  const dirs = [{ tipo: 'reducir_riesgo', factor: 0.5, hasta: AHORA + HORA }, { tipo: 'reducir_riesgo', factor: 0.25, hasta: AHORA + HORA }];
  const r = evaluarPropuesta(prop(), ctx({ directivas: dirs }));
  cerca(r.nocional, 1250);
  assert.match(r.motivos.find(x => x.limite === 'reduccionMegafono').texto, /×0,25/);
  // En forma de resumen del estado, igual.
  cerca(evaluarPropuesta(prop(), ctx({ directivas: { reduccion: { factor: 0.5, hasta: AHORA + HORA } } })).nocional, 2500);
  // Caducada no reduce.
  cerca(evaluarPropuesta(prop(), ctx({ directivas: { reduccion: { factor: 0.5, hasta: AHORA - 1 } } })).nocional, 5000);
});

test('recorte: riesgo por operación (0,5 %) — stop al 10 % con 8.000 $ arriesgaría 800 $, caben 5.000', () => {
  const r = evaluarPropuesta(prop({ nocional: 8000, stop: 90000 }), ctx());
  assert.equal(r.decision, 'reducir');
  cerca(r.nocional, 5000);
  const m = r.motivos.find(x => x.limite === 'riesgoPorOperacion');
  cerca(m.valor, 0.008);
  assert.match(m.texto, /800,00 \$ \(0,80 % del patrimonio\)/);
  assert.match(m.texto, /0,50 % \(500,00 \$\)/);
});

test('recortes encadenados: primero ×0,5 de caída y luego el tope del activo', () => {
  // 6.000 × 0,5 = 3.000; ya hay 8.000 en BTC → caben 2.000.
  const val = { exposicionBruta: 8000, exposicionCripto: 8000, exposicionPorActivo: { 'BTC/USD': 8000 }, posicionesAbiertas: 1 };
  const r = evaluarPropuesta(prop({ tipo: 'aumento', nocional: 6000 }), ctx({ valoracion: val, multiplicadorCaida: 0.5 }));
  cerca(r.nocional, 2000);
  assert.deepEqual(r.motivos.map(m => m.limite), ['multiplicadorCaida', 'maxPesoPorActivo']);
});

test('si tras recortar queda menos de 10 $ → vetar, con los recortes explicados', () => {
  const val = { exposicionBruta: 9995, exposicionCripto: 9995, exposicionPorActivo: { 'BTC/USD': 9995 }, posicionesAbiertas: 1 };
  const r = evaluarPropuesta(prop({ tipo: 'aumento' }), ctx({ valoracion: val }));
  assert.equal(r.decision, 'vetar');
  assert.deepEqual(r.motivos.map(m => m.limite), ['maxPesoPorActivo', 'minNocionalOrden']);
  assert.match(r.motivos[1].texto, /5,00 \$/);
});

test('prueba de 15 $: pasa en solo cerrar, no con el fondo bloqueado', () => {
  const p = prop({ tipo: 'prueba', nocional: 15, stop: null });
  assert.equal(evaluarPropuesta(p, ctx({ nivel: 'solo_cerrar' })).decision, 'aprobar');
  assert.equal(evaluarPropuesta(p, ctx({ nivel: 'bloqueado' })).decision, 'vetar');
});

test('normalizarDirectivas descarta lo caducado', () => {
  const d = normalizarDirectivas({ activosVetados: [{ simbolo: 'BTC/USD', hasta: AHORA - 1 }, { simbolo: 'ETH/USD', hasta: AHORA + 1 }], mesasPausadas: [], soloCerrarHasta: null, reduccion: null }, AHORA);
  assert.deepEqual([...d.activosVetados.keys()], ['ETH/USD']);
  assert.equal(d.soloCerrar, null);
});

test('sin límites en el contexto es un error de programación', () => {
  assert.throws(() => evaluarPropuesta(prop(), { ...ctx(), limites: undefined }), /limites/);
});

// ---------- Factor de tamaño (§5.3, §6.7): lo aplica mesas.js sobre el nocional
// final de dimensionar(); Riesgos lo comprueba sin volver a multiplicar. ----------

const { factorTamano } = require('../src/riesgo/limites');

test('factorTamano: DEFENSIVO × multiplicador de la mesa × Megáfono (el más duro) × caída', () => {
  const directivas = { modo: 'DEFENSIVO', multiplicadores: { tendencia: 0.5 }, reduccion: { factor: 0.5, hasta: AHORA + HORA } };
  assert.deepEqual(factorTamano({ directivas, multiplicadorCaida: 0.5, mesaId: 'tendencia', ahora: AHORA }),
    { total: 0.0625, comite: 0.5, mesa: 0.5, megafono: 0.5, caida: 0.5 });
  // Sin mesa (el del fondo entero, §7): el multiplicador por mesa no entra.
  assert.deepEqual(factorTamano({ directivas, multiplicadorCaida: 1, ahora: AHORA }), { total: 0.25, comite: 0.5, mesa: 1, megafono: 0.5, caida: 1 });
  // Lo caducado no cuenta; un multiplicador de más de 1 no afloja nada.
  assert.equal(factorTamano({ directivas: { reduccion: { factor: 0.5, hasta: AHORA - 1 }, multiplicadores: { tendencia: 2 } }, multiplicadorCaida: 1, mesaId: 'tendencia', ahora: AHORA }).total, 1);
  assert.equal(factorTamano({ directivas: null, multiplicadorCaida: undefined, ahora: AHORA }).total, 1);
});

test('factor declarado: si la propuesta ya lo trae aplicado, Riesgos no vuelve a multiplicar', () => {
  const directivas = { modo: 'DEFENSIVO', reduccion: { factor: 0.5, hasta: AHORA + HORA } };
  // 5.000 de base × 0,5 × 0,5 × 0,5 (caída) = 625, ya aplicado por las mesas.
  const r = evaluarPropuesta(prop({ nocional: 625, factorTamano: 0.125 }), ctx({ directivas, multiplicadorCaida: 0.5 }));
  assert.equal(r.decision, 'aprobar', JSON.stringify(r.motivos));
  cerca(r.nocional, 625);
});

test('factor declarado de menos: se recorta lo que falta (el Megáfono llegó después), con su motivo', () => {
  const directivas = { modo: 'DEFENSIVO', reduccion: { factor: 0.5, hasta: AHORA + HORA } };
  const r = evaluarPropuesta(prop({ nocional: 2500, factorTamano: 0.5 }), ctx({ directivas }));
  assert.equal(r.decision, 'reducir');
  cerca(r.nocional, 1250);
  const m = r.motivos.find(x => x.limite === 'factorTamano');
  assert.ok(m, JSON.stringify(r.motivos));
  assert.match(m.texto, /×0,5.*×0,25/);
  assert.match(m.texto, /2\.500 \$ → 1\.250 \$/);
});

test('sin factor declarado (el tamaño no vino de las mesas), Riesgos aplica el factor entero: también el DEFENSIVO y el ×0,5 de la mesa', () => {
  const directivas = { modo: 'DEFENSIVO', multiplicadores: { tendencia: 0.5 } };
  const r = evaluarPropuesta(prop(), ctx({ directivas }));
  cerca(r.nocional, 1250);
  assert.deepEqual(r.motivos.map(m => m.limite), ['modoDefensivo', 'multiplicadorMesa']);
});
