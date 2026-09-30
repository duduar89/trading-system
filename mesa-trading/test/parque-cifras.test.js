'use strict';
// Parqué · cifras: el formato del navegador (web/js/cifras.js) debe dar lo mismo
// que el del servidor (src/util/formato.js), y las cifras animadas no rebotan.
const test = require('node:test');
const assert = require('node:assert/strict');
const cifras = require('../web/js/cifras.js');
const formato = require('../src/util/formato.js');

test('casos conocidos de formato (calculados a mano)', () => {
  // ≥ 1.000 $ sin decimales y con punto de miles aunque tenga 4 cifras.
  assert.equal(cifras.usd(99999), '99.999 $');
  assert.equal(cifras.usd(1234.5), '1.235 $');          // 1.234,5 redondea a 1.235
  // < 1.000 $ con dos decimales; el signo solo si se pide y es positivo.
  assert.equal(cifras.usd(-1), '-1,00 $');
  assert.equal(cifras.usd(187.85, { signo: true }), '+187,85 $');
  // Fracción → %: 0,0125 = 1,25 %.
  assert.equal(cifras.pct(-0.0125), '-1,25 %');
  assert.equal(cifras.pct(0.0019, { signo: true }), '+0,19 %');
  assert.equal(cifras.pct(0.15, { decimales: 0 }), '15 %');
  // Precio: decimales según lo caro que es el activo.
  assert.equal(cifras.precio(83547), '83.547');
  assert.equal(cifras.precio(142.37), '142,37');
  assert.equal(cifras.precio(2.5), '2,500');
  assert.equal(cifras.precio(0.1234), '0,1234');
  assert.equal(cifras.usd(NaN), '—');
  assert.equal(cifras.pct(null), '—');
});


test('mismo resultado que src/util/formato.js en una batería de valores', () => {
  const valores = [0, -0, -0.004, 0.004, -0.3, 1, -1, 0.5, 9.999, 10, 999.994, 999.995, 1000, 1234, 1234.5, -1234.5, 99999, 100503.27, -45678.9, 0.1234, 0.00012, -0.00012, 1e6];
  for (const v of valores) {
    assert.equal(cifras.usd(v), formato.usd(v), `usd(${v})`);
    assert.equal(cifras.usd(v, { signo: true }), formato.usd(v, { signo: true }), `usd(${v}, signo)`);
    assert.equal(cifras.precio(v), formato.precio(v), `precio(${v})`);
    assert.equal(cifras.cantidad(v), formato.cantidad(v), `cantidad(${v})`);
    assert.equal(cifras.numero(v, 2), formato.numero(v, 2), `numero(${v}, 2)`);
  }
  for (const f of [0, 0.0019, -0.0074, 0.15, -0.035, 1.5, 12.3456, -0.0000283]) {
    assert.equal(cifras.pct(f), formato.pct(f), `pct(${f})`);
    assert.equal(cifras.pct(f, { decimales: 0, signo: true }), formato.pct(f, { decimales: 0, signo: true }), `pct(${f}, 0, signo)`);
  }
  // La hora en la misma zona sale igual.
  const t = Date.UTC(2026, 8, 29, 19, 44);
  assert.equal(cifras.hora(t, 'Europe/Madrid'), formato.hora(t, 'Europe/Madrid'));
  assert.equal(cifras.hora(t, 'Europe/Madrid'), '21:44');   // 19:44 UTC = 21:44 en Madrid (horario de verano)
});

test('un cero redondeado no lleva signo: «Caída 0,00 %», no «-0,00 %»', () => {
  assert.equal(cifras.pct(-0), '0,00 %');                                  // caída con el fondo en su máximo
  assert.equal(cifras.pct(-0.0000283, { signo: true }), '0,00 %');         // −2,83 $ sobre 100.000 $
  assert.equal(cifras.pct(0.0000025, { signo: true }), '0,00 %');          // ni «+0,00 %»
  assert.equal(cifras.usd(-0), '0,00 $');
  assert.equal(cifras.usd(0.001, { signo: true }), '0,00 $');
  assert.equal(cifras.numero(-0.3), '0');
  // Lo que no es cero conserva su signo.
  assert.equal(cifras.usd(-1234.5), '-1.235 $');
  assert.equal(cifras.pct(-0.00005), '-0,01 %');                           // −0,005 % redondea a −0,01 %
  assert.equal(cifras.usd(0.006, { signo: true }), '+0,01 $');
  assert.equal(cifras.usd(-2.83, { signo: true }), '-2,83 $');
});

test('las horas del panel van en hora de Madrid, como los textos del servidor', () => {
  // Sin zona, igual que formato.hora (Madrid): antes salía la zona del navegador y
  // un portátil en UTC ponía «12:00 · Abro el comité de las 14:00».
  const t = Date.UTC(2026, 8, 29, 19, 44);
  assert.equal(cifras.hora(t), formato.hora(t));
  assert.equal(cifras.hora(t), '21:44');
  assert.equal(cifras.ZONA, 'Europe/Madrid');
});

test('momento: la hora sola si es del mismo día de la mesa; con fecha si no', () => {
  const ahora = Date.UTC(2026, 9, 8, 2, 10);                              // 8-oct 04:10 en Madrid
  assert.equal(cifras.momento(Date.UTC(2026, 9, 8, 0, 30), ahora), '02:30');
  assert.equal(cifras.momento(Date.UTC(2026, 9, 5, 8, 0), ahora), '5 oct 10:00');   // 66 h antes: no es «de esta mañana»
  // Medianoche de Madrid, no la de UTC: 4-oct 22:30 UTC ya es 5-oct 00:30 en Madrid.
  const manana5 = Date.UTC(2026, 9, 5, 8, 0);
  assert.equal(cifras.momento(Date.UTC(2026, 9, 4, 22, 30), manana5), '00:30');
  assert.equal(cifras.momento(Date.UTC(2026, 9, 4, 21, 30), manana5), '4 oct 23:30');
  assert.equal(cifras.momento(null, ahora), '—');
  assert.equal(cifras.dia(Date.UTC(2026, 9, 4, 22, 30)), '2026-10-05');
});

test('hace: antigüedad legible', () => {
  assert.equal(cifras.hace(30 * 1000), 'hace 30 s');
  assert.equal(cifras.hace(12 * 60000), 'hace 12 min');
  assert.equal(cifras.hace(120 * 60000), 'hace 2 h');
  assert.equal(cifras.hace(66.2 * 3600000), 'hace 3 d');
});

test('rótulos con tilde y sin guion bajo', () => {
  assert.equal(cifras.estadoMesa('incubacion'), 'Incubación');
  assert.equal(cifras.estadoMesa('titular'), 'Titular');
  assert.equal(cifras.estadoMesa('banquillo'), 'Banquillo');
  assert.equal(cifras.modoComite('SOLO_CERRAR'), 'SOLO CERRAR');
  assert.equal(cifras.modoComite('DEFENSIVO'), 'DEFENSIVO');
  const r = { mesaId: 'tendencia', nombre: 'Tendencia SMA', marco: '4Hour', estado: 'incubacion' };
  assert.equal(cifras.rotuloMesa(r, { nombre: 'Tendencia SMA', marco: '4Hour', estado: 'incubacion' }, {}), 'TENDENCIA SMA · 4H · INCUBACIÓN');
  assert.equal(cifras.rotuloMesa({ ...r, estado: 'titular' }, { nombre: 'Tendencia SMA', marco: '4Hour', estado: 'titular' }, {}), 'TENDENCIA SMA · 4H');
});

const T = Date.UTC(2026, 8, 30, 10, 0);
const base = (extra) => Object.assign({
  ahora: T, fondo: { nivel: 'normal', motivo: null },
  cabecera: { modoComite: 'NORMAL', patrimonio: 100000 },
  directivas: { modo: 'NORMAL', multiplicadores: {}, activosVetados: [], mesasPausadas: [], soloCerrarHasta: null, reduccion: null },
}, extra);

test('nivel efectivo: el «solo cerrar» del Megáfono y del comité también cuentan', () => {
  assert.equal(cifras.nivelEfectivo(base(), T).nivel, 'normal');
  // Megáfono «solo cerrar 6 horas»: fondo.nivel sigue en 'normal' y no se puede abrir nada.
  const meg = cifras.nivelEfectivo(base({ directivas: { ...base().directivas, soloCerrarHasta: T + 6 * 3600000 } }), T);
  assert.deepEqual([meg.nivel, meg.origen, meg.hasta], ['solo_cerrar', 'Megáfono', T + 6 * 3600000]);
  // Caducado: vuelve a normal.
  assert.equal(cifras.nivelEfectivo(base({ directivas: { ...base().directivas, soloCerrarHasta: T - 1 } }), T).nivel, 'normal');
  const com = cifras.nivelEfectivo(base({ directivas: { ...base().directivas, modo: 'SOLO_CERRAR' } }), T);
  assert.deepEqual([com.nivel, com.origen], ['solo_cerrar', 'comité']);
  const def = cifras.nivelEfectivo(base({ directivas: { ...base().directivas, modo: 'DEFENSIVO' } }), T);
  assert.deepEqual([def.nivel, def.defensivo], ['normal', true]);
  // El nivel del fondo manda (pausa, kill), aunque haya directivas.
  const pau = cifras.nivelEfectivo(base({ fondo: { nivel: 'pausado', motivo: 'Pausa manual' }, directivas: { ...base().directivas, modo: 'SOLO_CERRAR' } }), T);
  assert.deepEqual([pau.nivel, pau.origen, pau.motivo], ['pausado', 'fondo', 'Pausa manual']);
  assert.equal(cifras.nivelEfectivo(base({ fondo: { nivel: 'bloqueado' } }), T).nivel, 'bloqueado');
});

test('bloqueos de un puesto: activo vetado, mesa en pausa y ×0 del comité', () => {
  const d = { ...base().directivas,
    activosVetados: [{ simbolo: 'SOL/USD', hasta: T + 6 * 3600000, motivo: 'Megáfono' }, { simbolo: 'ETH/USD', hasta: T - 1, motivo: 'comité' }],
    mesasPausadas: [{ mesaId: 'reversion', hasta: T + 3600000 }], multiplicadores: { ruptura: 0, momentum: 1 } };
  const inst = base({ directivas: d });
  const sol = cifras.bloqueosPuesto(inst, { simbolo: 'SOL/USD', etiqueta: 'SOL', mesaId: 'momentum' }, T);
  assert.equal(sol.length, 1);
  assert.equal(sol[0].tipo, 'activo');
  assert.equal(sol[0].texto, 'No abre SOL: vetado hasta 18:00 (Megáfono).');   // 16:00 UTC = 18:00 en Madrid
  assert.deepEqual(cifras.bloqueosPuesto(inst, { simbolo: 'ETH/USD', etiqueta: 'ETH', mesaId: 'momentum' }, T), [], 'el veto caducado no cuenta');
  assert.deepEqual(cifras.bloqueosPuesto(inst, { simbolo: 'BTC/USD', mesaId: 'reversion' }, T).map(b => b.corto), ['PAUSADA']);
  assert.deepEqual(cifras.bloqueosPuesto(inst, { simbolo: 'BTC/USD', mesaId: 'ruptura' }, T).map(b => b.corto), ['×0']);
  assert.equal(cifras.rotuloMesa({ mesaId: 'reversion', nombre: 'Reversión RSI', marco: '1Day' }, { nombre: 'Reversión RSI', marco: '1Day', estado: 'titular' }, inst),
    'REVERSIÓN RSI · 1D · PAUSADA');
});

test('capital sin asignar: 1 − Σ pesos de las mesas fuera del banquillo', () => {
  // Arranque real: 2 % + 40 % + 2 % + 40 % = 84 % → 16 % en efectivo.
  const mesas = [{ estado: 'incubacion', peso: 0.02 }, { estado: 'titular', peso: 0.4 }, { estado: 'incubacion', peso: 0.02 }, { estado: 'titular', peso: 0.4 }];
  const sa = cifras.sinAsignar({ mesas, cabecera: { patrimonio: 100000 } });
  assert.ok(Math.abs(sa.fraccion - 0.16) < 1e-12);
  assert.ok(Math.abs(sa.usd - 16000) < 1e-6);
  // Las dos incubadas al banquillo (peso 0): queda el 20 %.
  const sb = cifras.sinAsignar({ mesas: [{ estado: 'banquillo', peso: 0 }, { estado: 'titular', peso: 0.4 }, { estado: 'banquillo', peso: 0.02 }, { estado: 'titular', peso: 0.4 }], cabecera: {} });
  assert.ok(Math.abs(sb.fraccion - 0.2) < 1e-12);
  assert.equal(sb.usd, null);
  assert.equal(cifras.sinAsignar({ mesas: [] }), null);
  // Si la instantánea trae cabecera.sinAsignar (§7), manda la del servidor.
  const sc = cifras.sinAsignar({ mesas, cabecera: { patrimonio: 100000, sinAsignar: { fraccion: 0.2, usd: 20000 } } });
  assert.equal(sc.fraccion, 0.2);
  assert.equal(sc.usd, 20000);
});

test('límites: lo que mide el vigilante (cabecera.vigilancia); sin ella, la cabecera', () => {
  assert.deepEqual(cifras.medidaLimites({ cabecera: { pnlDiaPct: -0.03, caida: -0.16, vigilancia: { perdidaDiaPct: -0.005, caidaPct: -0.01, desdeReapertura: true } } }),
    { perdida: 0.005, caida: 0.01, desdeReapertura: true });
  assert.deepEqual(cifras.medidaLimites({ cabecera: { pnlDiaPct: 0.004, caida: 0 } }), { perdida: 0, caida: 0, desdeReapertura: false });
  assert.deepEqual(cifras.medidaLimites({ cabecera: { vigilancia: { perdidaDiaPct: null, caidaPct: 0, desdeReapertura: false } } }),
    { perdida: null, caida: 0, desdeReapertura: false });
  assert.deepEqual(cifras.medidaLimites(null), { perdida: null, caida: null, desdeReapertura: false });
});

test('503: «arrancando» (la API aún no tiene instantánea) o «lleno» (20 paneles), por el mensaje', () => {
  assert.equal(cifras.motivo503({ ok: false, mensaje: 'La mesa está arrancando: reintenta en unos segundos.' }), 'arrancando');
  assert.equal(cifras.motivo503({ ok: false, mensaje: 'Ya hay 20 paneles conectados: cierra alguna pestaña y vuelve a intentarlo.' }), 'lleno');
  assert.equal(cifras.motivo503(null), 'lleno');
});

test('precio parado: más viejo que el límite de §5.3 (cripto o acciones)', () => {
  const lim = { maxAntiguedadPrecioSegCripto: 900, maxAntiguedadPrecioSegAcciones: 120 };
  assert.equal(cifras.precioViejo({ simbolo: 'BTC/USD', t: T - 60000 }, T, lim).viejo, false);
  const btc = cifras.precioViejo({ simbolo: 'BTC/USD', t: T - 120 * 60000 }, T, lim);
  assert.deepEqual([btc.viejo, btc.edadMs], [true, 120 * 60000]);
  assert.equal(cifras.precioViejo({ simbolo: 'SPY', t: T - 300000 }, T, lim).viejo, true);
  assert.equal(cifras.precioViejo({ simbolo: 'SPY', t: null }, T, lim).viejo, true);
});

test('datos parados: 2,5 veces el ritmo al que llegan, nunca menos de 20 s', () => {
  // Latido de 60 s: parado a partir de 150 s sin instantánea.
  const llegadas = [0, 60000, 120000, 180000];
  assert.equal(cifras.datosParados(llegadas, 180000 + 149000).parado, false);
  const p = cifras.datosParados(llegadas, 180000 + 151000);
  assert.deepEqual([p.parado, p.limiteMs, p.pasadoMs], [true, 150000, 151000]);
  // Sintético (una cada 2 s): el suelo de 20 s. La instantánea doble al conectar (< 1 s) no cuenta.
  assert.equal(cifras.datosParados([0, 300, 2300, 4300, 6300], 6300 + 21000).parado, true);
  assert.equal(cifras.datosParados([0, 300, 2300, 4300, 6300], 6300 + 19000).parado, false);
  // Sin historia: se supone un latido de 60 s.
  assert.equal(cifras.datosParados([1000], 1000 + 140000).parado, false);
  assert.equal(cifras.datosParados([], 5).parado, false);
});

test('cuenta atrás del comité en HH:MM, redondeando hacia arriba', () => {
  assert.equal(cifras.cuentaAtras(83 * 60000), '01:23');
  assert.equal(cifras.cuentaAtras(4 * 3600000), '04:00');
  assert.equal(cifras.cuentaAtras(30000), '00:01');         // medio minuto no es «00:00»
  assert.equal(cifras.cuentaAtras(0), '00:00');
  assert.equal(cifras.cuentaAtras(-5000), '00:00');
});

test('la curva de las cifras animadas no se pasa del valor final (sin rebote)', () => {
  assert.equal(cifras.suavizar(0), 0);
  assert.equal(cifras.suavizar(1), 1);
  assert.equal(cifras.suavizar(0.5), 0.875);                 // 1 − (1 − 0,5)³ = 0,875
  let previo = -1;
  for (let p = 0; p <= 1.5; p += 0.01) {
    const v = cifras.suavizar(p);
    assert.ok(v >= previo - 1e-12, 'monótona');
    assert.ok(v <= 1, 'nunca por encima del final');
    previo = v;
  }
});

test('clase de color por signo', () => {
  assert.equal(cifras.claseSigno(3), 'pos');
  assert.equal(cifras.claseSigno(-3), 'neg');
  assert.equal(cifras.claseSigno(0.001, 0.005), 'cero');
  assert.equal(cifras.claseSigno(undefined), 'cero');
});
