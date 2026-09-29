'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITES_DUROS } = require('../src/config');
const { vigilar } = require('../src/riesgo/vigilante');

// Martes 29-sep-2026, 15:00 UTC. La medianoche siguiente es el 30 a las 00:00 UTC.
const AHORA = Date.UTC(2026, 8, 29, 15);
const MEDIANOCHE = Date.UTC(2026, 8, 30, 0);

function entrada(extra = {}) {
  return {
    ahora: AHORA, patrimonio: 100000, patrimonioInicioDia: 100000, pico: 100000,
    puestos: [], precios: {}, limites: LIMITES_DUROS, nivelActual: 'normal', soloCerrarHasta: null,
    ...extra,
  };
}

test('día tranquilo: normal, multiplicador 1, sin acciones', () => {
  const r = vigilar(entrada({ patrimonio: 99000 }));
  assert.equal(r.nivel, 'normal');
  assert.equal(r.multiplicadorCaida, 1);
  assert.deepEqual(r.acciones, []);
  assert.deepEqual(r.alertas, []);
});

test('−2 % en el día → solo cerrar hasta las 00:00 UTC siguientes', () => {
  // 98.000 / 100.000 − 1 = −2 % (en coma flotante −0,0200000000000000018: la holgura lo cubre).
  const r = vigilar(entrada({ patrimonio: 98000 }));
  assert.equal(r.nivel, 'solo_cerrar');
  assert.equal(r.soloCerrarHasta, MEDIANOCHE);
  assert.equal(r.acciones.length, 1);
  assert.equal(r.acciones[0].tipo, 'solo_cerrar');
  assert.equal(r.acciones[0].hasta, MEDIANOCHE);
  assert.match(r.acciones[0].motivo, /-2,00 %/);
  assert.match(r.acciones[0].motivo, /00:00 UTC/);
  // −1,99 % no llega.
  assert.equal(vigilar(entrada({ patrimonio: 98010 })).nivel, 'normal');
});

test('solo cerrar ya activo: no se repite la acción; caduca a medianoche', () => {
  const sigue = vigilar(entrada({ patrimonio: 97500, nivelActual: 'solo_cerrar', soloCerrarHasta: MEDIANOCHE }));
  assert.equal(sigue.nivel, 'solo_cerrar');
  assert.equal(sigue.soloCerrarHasta, MEDIANOCHE);
  assert.deepEqual(sigue.acciones, []);
  // Aunque el patrimonio se recupere, dura hasta medianoche.
  assert.equal(vigilar(entrada({ patrimonio: 100500, nivelActual: 'solo_cerrar', soloCerrarHasta: MEDIANOCHE })).nivel, 'solo_cerrar');
  // Pasada la medianoche, con la referencia del día nuevo, vuelve a normal.
  const despues = vigilar(entrada({ ahora: MEDIANOCHE + 60_000, patrimonio: 97500, patrimonioInicioDia: 97500, nivelActual: 'solo_cerrar', soloCerrarHasta: MEDIANOCHE }));
  assert.equal(despues.nivel, 'normal');
  assert.equal(despues.soloCerrarHasta, null);
  assert.match(despues.alertas[0], /Termina el solo cerrar/);
});

test('entre las 00:00 y el cierre diario, la referencia de ayer no vuelve a disparar el solo cerrar', () => {
  // diaInicio dice que patrimonioInicioDia es del 29 y ya es el 30: esa pérdida es de ayer.
  const r = vigilar(entrada({ ahora: MEDIANOCHE + 60_000, patrimonio: 97500, nivelActual: 'solo_cerrar', soloCerrarHasta: MEDIANOCHE, diaInicio: '2026-09-29' }));
  assert.equal(r.nivel, 'normal');
  assert.deepEqual(r.acciones, []);
});

test('−3,5 % en el día → kill switch y bloqueado', () => {
  // 96.500 / 100.000 − 1 = −3,5 %.
  const r = vigilar(entrada({ patrimonio: 96500, puestos: [{ puestoId: 'p', simbolo: 'BTC/USD', cantidad: 1, stop: 99000 }], precios: { 'BTC/USD': 90000 } }));
  assert.equal(r.nivel, 'bloqueado');
  assert.equal(r.acciones.length, 1, 'solo el kill: vender también por stop duplicaría la venta');
  assert.equal(r.acciones[0].tipo, 'kill');
  assert.match(r.acciones[0].motivo, /-3,50 %/);
  assert.match(r.acciones[0].motivo, /Reabre un humano/);
});

test('−10 % desde el máximo → multiplicadorCaida 0,5; sigue normal', () => {
  // Pico 100.000, patrimonio 90.000 (el día empezó en 90.500: −0,55 % hoy).
  const r = vigilar(entrada({ patrimonio: 90000, patrimonioInicioDia: 90500 }));
  assert.equal(r.nivel, 'normal');
  assert.equal(r.multiplicadorCaida, 0.5);
  assert.deepEqual(r.acciones, []);
  assert.match(r.alertas[0], /-10,00 %/);
  // −9,9 % no llega.
  assert.equal(vigilar(entrada({ patrimonio: 90100, patrimonioInicioDia: 90500 })).multiplicadorCaida, 1);
});

test('aviso de caída solo al cambiar si se pasa el multiplicador anterior', () => {
  const igual = vigilar(entrada({ patrimonio: 90000, patrimonioInicioDia: 90500, multiplicadorCaidaActual: 0.5 }));
  assert.deepEqual(igual.alertas, []);
  const sale = vigilar(entrada({ patrimonio: 95000, patrimonioInicioDia: 95000, multiplicadorCaidaActual: 0.5 }));
  assert.equal(sale.multiplicadorCaida, 1);
  assert.match(sale.alertas[0], /tamaño normal/);
});

test('−15 % desde el máximo → kill switch', () => {
  const r = vigilar(entrada({ patrimonio: 85000, patrimonioInicioDia: 86000 }));
  assert.equal(r.nivel, 'bloqueado');
  assert.equal(r.acciones[0].tipo, 'kill');
  assert.match(r.acciones[0].motivo, /-15,00 %/);
});

test('bloqueado es pegajoso: aunque todo se recupere, sigue bloqueado y no relanza el kill', () => {
  const r = vigilar(entrada({ patrimonio: 120000, pico: 100000, nivelActual: 'bloqueado' }));
  assert.equal(r.nivel, 'bloqueado');
  assert.deepEqual(r.acciones, []);
  // Si queda algo abierto, se avisa.
  const conResto = vigilar(entrada({ nivelActual: 'bloqueado', puestos: [{ puestoId: 'p', simbolo: 'SPY', cantidad: 3, stop: null }] }));
  assert.match(conResto.alertas[0], /SPY/);
});

test('pausado (botón Pausar) se mantiene; un kill lo supera', () => {
  assert.equal(vigilar(entrada({ patrimonio: 97000, nivelActual: 'pausado' })).nivel, 'pausado');
  assert.equal(vigilar(entrada({ patrimonio: 96000, nivelActual: 'pausado' })).nivel, 'bloqueado');
});

test('stop saltado → acción de venta con precio y stop; el que no ha saltado, nada', () => {
  const puestos = [
    { puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', cantidad: 0.05, stop: 95000 },
    { puestoId: 'ruptura-ETH', mesaId: 'ruptura', simbolo: 'ETH/USD', cantidad: 1, stop: 3500 },
    { puestoId: 'reversion-BTC', mesaId: 'reversion', simbolo: 'BTC/USD', cantidad: 0, stop: 99000 },      // cerrado: nada
    { puestoId: 'sombra:tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', cantidad: 0.05, stop: 95000, sombra: true },
  ];
  const r = vigilar(entrada({ puestos, precios: { 'BTC/USD': { precio: 94800, t: AHORA }, 'ETH/USD': 3600 } }));
  assert.equal(r.nivel, 'normal');
  assert.deepEqual(r.acciones, [
    { tipo: 'stop', puestoId: 'tendencia-BTC', simbolo: 'BTC/USD', precio: 94800, stop: 95000 },
    { tipo: 'stop', puestoId: 'sombra:tendencia-BTC', simbolo: 'BTC/USD', precio: 94800, stop: 95000, sombra: true },
  ]);
  assert.equal(r.alertas.length, 1);
  assert.match(r.alertas[0], /94\.800 ≤ stop 95\.000/);
  // El precio que trae el propio puesto manda sobre el mapa.
  const propio = vigilar(entrada({ puestos: [{ ...puestos[1], precio: 3490 }], precios: { 'ETH/USD': 3600 } }));
  assert.equal(propio.acciones[0].precio, 3490);
});

test('en solo cerrar los stops siguen saltando', () => {
  const r = vigilar(entrada({ patrimonio: 97900, puestos: [{ puestoId: 'p', simbolo: 'BTC/USD', cantidad: 1, stop: 95000 }], precios: { 'BTC/USD': 94000 } }));
  assert.equal(r.nivel, 'solo_cerrar');
  assert.deepEqual(r.acciones.map(a => a.tipo), ['solo_cerrar', 'stop']);
});
