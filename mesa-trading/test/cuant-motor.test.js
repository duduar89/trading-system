'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { backtest, compraYMantener, costesPorDefecto } = require('../src/backtest/motor');
const { FAMILIAS } = require('../src/estrategias');
const tendencia = require('../src/estrategias/tendencia-sma');
const { DIA, T0, cestaSintetica, velasAMano, LIMITES_ABIERTOS, estrategiaGuion, COSTES_PRUEBA } = require('./cuant-ayuda');

const H4 = 4 * 3600e3;
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

// Serie a mano con el cruce SMA2/SMA3 (y cierre > SMA4) en la vela 6.
const VELAS_CRUCE = velasAMano([
  [10, 10.2, 9.8, 10], [10, 10.2, 8.8, 9], [9, 9.2, 7.8, 8], [8, 8.2, 6.8, 7], [7, 7.2, 5.8, 6],
  [6, 7.2, 5.8, 7], [7, 9.2, 6.8, 9], [9.5, 11.2, 9.3, 11], [11, 12.2, 10.8, 12], [12, 12.2, 10.8, 11],
  [11, 11.2, 8.8, 9], [10.5, 10.6, 7.9, 8],
], { marcoMs: H4 });

test('CASO CONOCIDO: cruce en la vela 6 → entrada en la APERTURA de la 7 y P&L exacto con comisiones', () => {
  // Decisión al cierre de i=6 (SMA2 8 > SMA3 7,333 y cierre 9 > SMA4 7,25).
  // Tamaño: un símbolo → peso 1 → nocional = 10.000 (límites abiertos, sin término de volatilidad).
  // Entrada en la apertura de i=7 = 9,5 con deslizamiento 5 pb + penalización 10 pb:
  //   precio = 9,5 · 1,0015 = 9,51425
  //   cantidad = 10.000 · (1 − 0,0025) / 9,51425 = 9.975 / 9,51425 = 1.048,42735896
  //   comisión de entrada = 10.000 · 0,0025 = 25 $ (se cobra en el activo recibido)
  // Salida: SMA2 10 < SMA3 10,667 al cierre de i=10 → venta en la apertura de i=11 = 10,5:
  //   precio = 10,5 · 0,9985 = 10,48425
  //   bruto = 1.048,42735896 · 10,48425 = 10.991,97453819
  //   comisión de salida = 0,25 % = 27,47993635 → neto = 10.964,49460185
  //   P&L = 10.964,49460185 − 10.000 = 964,49460185; comisiones = 52,47993635
  // El trailing sube el stop a 4,8734 (i=7), 6,8367 (i=8) y 7,3184 (i=9); el mínimo de i=10 (8,8) no lo toca.
  const r = backtest({
    velas: { 'SOL/USD': VELAS_CRUCE }, estrategia: tendencia, params: { rapida: 2, lenta: 3, filtro: 4, atr: 2, atrStop: 3 },
    capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity,
  });
  assert.equal(r.operaciones.length, 1);
  const op = r.operaciones[0];
  assert.equal(op.simbolo, 'SOL/USD');
  assert.equal(op.entradaT, VELAS_CRUCE[7].t);
  assert.equal(op.salidaT, VELAS_CRUCE[11].t);
  cerca(op.entradaPrecio, 9.51425, 1e-12);
  cerca(op.salidaPrecio, 10.48425, 1e-12);
  cerca(op.cantidad, 1048.4273589615575, 1e-9);
  cerca(op.pnl, 964.4946018472274, 1e-8);
  cerca(op.pnlPct, 0.09644946018472274, 1e-12);
  cerca(op.comisiones, 52.479936345481775, 1e-9);
  assert.equal(op.motivoSalida, 'señal');
  assert.equal(op.barras, 4); // cierres de i=7, 8, 9 y 10
  cerca(op.stop, 12 - 3 * 1.560546875, 1e-12); // trailing de i=9
  // Curva: 10.000 hasta la entrada; el último punto es el efectivo tras vender.
  assert.equal(r.curva.length, 12);
  assert.ok(r.curva.slice(0, 7).every(p => p.valor === 10000));
  cerca(r.curva[11].valor, 10964.494601847227, 1e-8);
  cerca(r.metricas.rentabilidad, 0.09644946018472274, 1e-12);
});

test('stop con HUECO: abre por debajo del stop → sale en la apertura, no en el stop', () => {
  // Entrada en la apertura de i=1 a 100·1,0015 = 100,15 → cantidad 9.975/100,15.
  // En i=2 abre en 90 (< stop 95): sale a min(90, 95) = 90 · 0,9985 = 89,865.
  const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 101, 99, 100], [90, 92, 88, 91], [91, 92, 90, 91]]) };
  const r = backtest({ velas, estrategia: estrategiaGuion({ abrirEn: 0, stop: 95 }), capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity });
  assert.equal(r.operaciones.length, 1);
  const op = r.operaciones[0];
  assert.equal(op.motivoSalida, 'stop');
  assert.equal(op.salidaT, velas['BTC/USD'][2].t);
  cerca(op.salidaPrecio, 89.865, 1e-12);
  const cantidad = 9975 / 100.15;
  cerca(op.pnl, cantidad * 89.865 * 0.9975 - 10000, 1e-8);
});

test('stop dentro de la vela sin hueco → sale al precio del stop', () => {
  const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 101, 99, 100], [98, 99, 94, 97], [97, 98, 96, 97]]) };
  const r = backtest({ velas, estrategia: estrategiaGuion({ abrirEn: 0, stop: 95 }), capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity });
  const op = r.operaciones[0];
  assert.equal(op.motivoSalida, 'stop');
  cerca(op.salidaPrecio, 95 * 0.9985, 1e-12);
  assert.equal(op.barras, 2); // cierre de i=1 + la vela del stop
});

test('stop en la misma vela de entrada (la apertura es el primer precio)', () => {
  const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 101, 94, 96], [96, 97, 95, 96]]) };
  const r = backtest({ velas, estrategia: estrategiaGuion({ abrirEn: 0, stop: 95 }), capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity });
  assert.equal(r.operaciones.length, 1);
  assert.equal(r.operaciones[0].entradaT, velas['BTC/USD'][1].t);
  assert.equal(r.operaciones[0].salidaT, velas['BTC/USD'][1].t);
  assert.equal(r.operaciones[0].motivoSalida, 'stop');
});

test('el trailing se calcula al cierre y vale DESDE LA VELA SIGUIENTE', () => {
  // Trailing a 99,5 al cierre de i=1. El mínimo de i=1 (99) ya está por debajo,
  // pero aún no vale; en i=2 el mínimo 99,2 lo toca → sale a 99,5.
  const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 101, 99, 100], [100, 100.5, 99.2, 100], [100, 101, 99, 100]]) };
  const r = backtest({ velas, estrategia: estrategiaGuion({ abrirEn: 0, stop: 90, trailingEn: { 1: 99.5 } }), capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity });
  const op = r.operaciones[0];
  assert.equal(op.salidaT, velas['BTC/USD'][2].t);
  cerca(op.salidaPrecio, 99.5 * 0.9985, 1e-12);
});

test('un trailing que bajaría el stop se ignora', () => {
  const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 101, 99, 100], [100, 100.5, 94, 100], [100, 101, 99, 100]]) };
  const r = backtest({ velas, estrategia: estrategiaGuion({ abrirEn: 0, stop: 95, trailingEn: { 1: 90 } }), capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity });
  cerca(r.operaciones[0].salidaPrecio, 95 * 0.9985, 1e-12);
});

test("'abrir' con la posición ya abierta se trata como 'mantener' (no piramida)", () => {
  const siempre = { ...estrategiaGuion({}), decidir: () => ({ accion: 'abrir', peso: 0.3, stop: 1, objetivoPrecio: null, motivo: '', estado: '' }) };
  const velas = { 'BTC/USD': velasAMano(Array.from({ length: 10 }, () => [100, 101, 99, 100])) };
  const r = backtest({ velas, estrategia: siempre, capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity });
  assert.equal(r.operaciones.length, 1);
  assert.equal(r.operaciones[0].motivoSalida, 'fin');
  cerca(r.operaciones[0].cantidad, (3000 * 0.9975) / 100.15, 1e-9); // solo una compra de 0,3·10.000
});

test('varias series alineadas por t: un hueco en una no mueve a la otra', () => {
  // A tiene vela los días 0-5; B no tiene el día 2. Ambas deciden abrir en su índice 1.
  const A = velasAMano(Array.from({ length: 6 }, () => [100, 101, 99, 100]));
  const B = velasAMano(Array.from({ length: 6 }, () => [50, 51, 49, 50])).filter((_, i) => i !== 2);
  const r = backtest({
    velas: { 'BTC/USD': A, 'ETH/USD': B },
    estrategia: estrategiaGuion({ porSimbolo: { 'BTC/USD': { abrirEn: 1, peso: 0.5 }, 'ETH/USD': { abrirEn: 1, peso: 0.5 } } }),
    capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity,
  });
  const porSim = Object.fromEntries(r.operaciones.map(o => [o.simbolo, o]));
  assert.equal(porSim['BTC/USD'].entradaT, A[2].t);        // día 2
  assert.equal(porSim['ETH/USD'].entradaT, A[3].t);        // B no tiene día 2: entra en su siguiente vela, el día 3
  assert.equal(r.curva.length, 6);                          // una muestra por instante de la unión
});

test('costes por defecto = los del bróker simulado (§3.4)', () => {
  const c = costesPorDefecto();
  assert.equal(c.comision('BTC/USD'), 0.0025);
  assert.equal(c.comision('SPY'), 0);
  assert.equal(c.deslizamiento('BTC/USD'), 0.0005);
  assert.equal(c.deslizamiento('ETH/USD'), 0.0005);
  assert.equal(c.deslizamiento('SOL/USD'), 0.0015);
  assert.equal(c.deslizamiento('SPY'), 0.0002);
  assert.equal(c.penalizacion, 0.001);
});

test('cuadre: Σ pnl de las operaciones = patrimonio final − capital, en las cuatro familias', () => {
  const tres = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD'], 900, 7);
  const seis = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD'], 900, 8);
  for (const e of Object.values(FAMILIAS)) {
    const velas = e.familia === 'momentum-rotacion' ? seis : tres;
    const r = backtest({ velas, estrategia: e, capital: 10000 });
    const suma = r.operaciones.reduce((s, o) => s + o.pnl, 0);
    cerca(r.curva[r.curva.length - 1].valor - 10000, suma, 1e-6);
    assert.ok(r.operaciones.length > 0, `${e.familia} sin operaciones`);
    for (const o of r.operaciones) {
      assert.ok(o.salidaT >= o.entradaT);
      assert.ok(['señal', 'stop', 'fin'].includes(o.motivoSalida));
    }
    assert.ok(r.metricas.exposicionMedia <= 0.8 + 1e-9, 'la exposición no pasa del 80 % bruto');
  }
});

test('ninguna operación se ejecuta en la vela en que se decidió', () => {
  const velas = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD'], 600, 12);
  const tSet = new Set(velas['BTC/USD'].map(v => v.t));
  const r = backtest({ velas, estrategia: FAMILIAS['ruptura-donchian'], capital: 10000 });
  for (const o of r.operaciones) assert.ok(tSet.has(o.entradaT), 'la entrada es la apertura de una vela');
  // Con la ruptura, la vela de entrada nunca es la de la señal: su cierre no puede ser a la vez > máximo previo y entrada.
  assert.ok(r.operaciones.length > 5);
});

test('CAUSALIDAD del backtest: 50 velas más no cambian las operaciones ni la curva ya vistas', () => {
  const largas = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD'], 850, 13);
  const N = 800;
  const cortas = Object.fromEntries(Object.entries(largas).map(([s, v]) => [s, v.slice(0, N)]));
  for (const e of Object.values(FAMILIAS)) {
    const velasL = e.familia === 'momentum-rotacion' ? largas : largas;
    const a = backtest({ velas: cortas, estrategia: e, capital: 10000 });
    const b = backtest({ velas: velasL, estrategia: e, capital: 10000 });
    const tCorte = cortas['BTC/USD'][N - 1].t;
    // Curva idéntica salvo el último punto (allí la corta liquida por fin de datos).
    assert.deepEqual(b.curva.slice(0, N - 1), a.curva.slice(0, N - 1), e.familia);
    // Operaciones cerradas antes del corte, idénticas.
    const cerradas = r => r.operaciones.filter(o => o.salidaT < tCorte && o.motivoSalida !== 'fin');
    assert.deepEqual(cerradas(b), cerradas(a), e.familia);
  }
});

test('desde/hasta: opera solo en el tramo y usa el histórico anterior para calentar', () => {
  const velas = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD'], 900, 14);
  const t = velas['BTC/USD'];
  const r = backtest({ velas, estrategia: FAMILIAS['ruptura-donchian'], capital: 5000, desde: t[500].t, hasta: t[700].t });
  assert.equal(r.curva[0].t, t[500].t);
  assert.equal(r.curva[r.curva.length - 1].t, t[699].t);
  assert.equal(r.curva[0].valor, 5000);
  for (const o of r.operaciones) assert.ok(o.entradaT >= t[500].t && o.entradaT < t[700].t);
});

test('comprar y mantener: compra en la primera apertura y liquida al último cierre, con costes', () => {
  // 10.000 → cantidad 9.975/(100·1,0015) → vende a 110·0,9985 y paga 0,25 %.
  const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 106, 99, 105], [105, 111, 104, 110]]) };
  const r = compraYMantener({ velas, capital: 10000, costes: COSTES_PRUEBA });
  const cantidad = 9975 / 100.15;
  cerca(r.curva[r.curva.length - 1].valor, cantidad * 110 * 0.9985 * 0.9975, 1e-8);
  cerca(r.curva[1].valor, cantidad * 105, 1e-8);
});

// ---- Hueco en los datos de un símbolo (SOL en Alpaca: jul-2023 → ago-2024) ----

// 10 velas diarias, 30 días sin ninguna y 10 más. La primera de después abre
// con el precio rancio de antes (18) y cierra al de verdad (157), como SOL.
function conHueco() {
  const antes = Array.from({ length: 10 }, (_, d) => ({ t: T0 + d * DIA, o: 20, h: 20.5, l: 19.5, c: 20, v: 0 }));
  const despues = Array.from({ length: 10 }, (_, k) => {
    const d = 40 + k;
    return k === 0 ? { t: T0 + d * DIA, o: 18, h: 159, l: 18, c: 157, v: 0 } : { t: T0 + d * DIA, o: 157, h: 158, l: 156, c: 157, v: 0 };
  });
  return [...antes, ...despues];
}

test('HUECO: una orden decidida antes del hueco caduca y no se llena a la apertura rancia de después', () => {
  const serie = conHueco();
  const r = backtest({ velas: { 'SOL/USD': serie }, estrategia: estrategiaGuion({ abrirEn: 9 }), capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity });
  assert.equal(r.operaciones.length, 0, 'antes se compraba a 18 con el precio en 157');
  assert.ok(r.curva.every(p => p.valor === 10000));
});

test('HUECO: lo abierto se vende al último cierre anterior al hueco (motivo hueco) y el cuadre se mantiene', () => {
  const serie = conHueco();
  const r = backtest({ velas: { 'SOL/USD': serie }, estrategia: estrategiaGuion({ abrirEn: 2 }), capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity });
  assert.equal(r.operaciones.length, 1);
  const op = r.operaciones[0];
  assert.equal(op.motivoSalida, 'hueco');
  assert.equal(op.entradaT, serie[3].t);
  assert.equal(op.salidaT, serie[9].t + DIA);                // al cerrar la última vela de antes
  cerca(op.salidaPrecio, 20 * 0.9985, 1e-12);                 // su cierre, con deslizamiento y penalización
  const cantidad = 9975 / (20 * 1.0015);
  cerca(op.pnl, cantidad * 20 * 0.9985 * 0.9975 - 10000, 1e-8);
  const suma = r.operaciones.reduce((s, o) => s + o.pnl, 0);
  cerca(r.curva[r.curva.length - 1].valor - 10000, suma, 1e-9);
  // Ningún salto de la curva por el precio de después del hueco.
  for (let k = 1; k < r.curva.length; k++) assert.ok(Math.abs(r.curva[k].valor / r.curva[k - 1].valor - 1) < 0.01);
});

test('HUECO: tras volver, el símbolo no decide hasta que sus indicadores ya no miran nada de antes', () => {
  const serie = conHueco();
  const guion = abrirEn => ({ ...estrategiaGuion({ abrirEn }), calentamiento: () => 3 });
  const opciones = { velas: { 'SOL/USD': serie }, capital: 10000, costes: COSTES_PRUEBA, limites: LIMITES_ABIERTOS, volObjetivo: Infinity };
  // La vela 10 es la primera tras el hueco: 10, 11 y 12 recalientan; en la 13 ya decide.
  assert.equal(backtest({ ...opciones, estrategia: guion(11) }).operaciones.length, 0);
  assert.equal(backtest({ ...opciones, estrategia: guion(12) }).operaciones.length, 0);
  const r = backtest({ ...opciones, estrategia: guion(13) });
  assert.equal(r.operaciones.length, 1);
  assert.equal(r.operaciones[0].entradaT, serie[14].t);
  // Lo mismo si el tramo empieza ya dentro del recalentamiento (walk-forward).
  assert.equal(backtest({ ...opciones, estrategia: guion(11), desde: serie[11].t }).operaciones.length, 0);
});

test('HUECO: la ruptura sobre la serie de SOL ya no compra a la apertura rancia (causalidad intacta)', () => {
  // Serie larga con el hueco en medio: ninguna entrada puede ser la apertura de la vela de vuelta.
  const base = cestaSintetica(['SOL/USD'], 700, 21)['SOL/USD'];
  const serie = [...base.slice(0, 300), ...base.slice(420).map(v => ({ ...v }))];
  // La última vela de antes rompe el canal (decide abrir, o ya está dentro) y la de vuelta abre rancia.
  const techo = Math.max(...serie.slice(270, 299).map(v => v.h));
  serie[299] = { ...serie[299], c: techo * 1.05, h: techo * 1.06 };
  serie[300] = { ...serie[300], o: serie[299].c * 0.12 };
  const r = backtest({ velas: { 'SOL/USD': serie }, estrategia: FAMILIAS['ruptura-donchian'], capital: 10000 });
  assert.ok(r.operaciones.every(o => o.entradaT !== serie[300].t), 'compra a la apertura rancia');
  assert.ok(r.operaciones.every(o => !(o.entradaT < serie[300].t && o.salidaT > serie[300].t)), 'posición atravesando el hueco');
  const suma = r.operaciones.reduce((s, o) => s + o.pnl, 0);
  cerca(r.curva[r.curva.length - 1].valor - 10000, suma, 1e-6);
  // Con 50 velas menos al final, lo ya visto no cambia.
  const corto = backtest({ velas: { 'SOL/USD': serie.slice(0, serie.length - 50) }, estrategia: FAMILIAS['ruptura-donchian'], capital: 10000 });
  const tCorte = serie[serie.length - 51].t;
  const cerradas = x => x.operaciones.filter(o => o.salidaT < tCorte && o.motivoSalida !== 'fin');
  assert.deepEqual(cerradas(r), cerradas(corto));
});

test('HUECO en comprar y mantener: vende al cierre anterior y vuelve a entrar en la SEGUNDA vela de después', () => {
  const serie = conHueco();
  const r = compraYMantener({ velas: { 'SOL/USD': serie }, capital: 10000, costes: COSTES_PRUEBA });
  assert.deepEqual(r.operaciones.map(o => o.motivoSalida), ['hueco', 'fin']);
  const [a, b] = r.operaciones;
  cerca(a.salidaPrecio, 20 * 0.9985, 1e-12);
  assert.equal(b.entradaT, serie[11].t);                    // nunca a la apertura rancia de la vela 10
  cerca(b.entradaPrecio, 157 * 1.0015, 1e-12);
  const suma = r.operaciones.reduce((s, o) => s + o.pnl, 0);
  cerca(r.curva[r.curva.length - 1].valor - 10000, suma, 1e-9);
  for (let k = 1; k < r.curva.length; k++) assert.ok(Math.abs(r.curva[k].valor / r.curva[k - 1].valor - 1) < 0.01, `salto en ${k}`);
  // Si el tramo empieza justo en la vela de vuelta, tampoco compra a su apertura.
  const r2 = compraYMantener({ velas: { 'SOL/USD': serie }, capital: 10000, costes: COSTES_PRUEBA, desde: serie[10].t });
  assert.equal(r2.operaciones[0].entradaT, serie[11].t);
});

// ---- Hora de la decisión en acciones diarias ----

test('ETF 1D: el contexto se pide al cierre de la sesión de Nueva York, no a las 04:00Z del día siguiente', () => {
  const cal = require('../src/mercado/calendario');
  const spy = [];
  for (let d = Date.UTC(2026, 7, 3); spy.length < 30; d += DIA) {
    const dia = new Date(d).toISOString().slice(0, 10);
    if (cal.esDiaHabil(dia)) spy.push({ t: cal.msDesdeET(dia, 0, 0), o: 500, h: 501, l: 499, c: 500, v: 0 });
  }
  const pedidas = [];
  backtest({ velas: { SPY: spy }, estrategia: estrategiaGuion({}), contexto: t => { pedidas.push(t); return {}; }, capital: 10000, limites: LIMITES_ABIERTOS });
  assert.equal(pedidas.length, spy.length - 1);
  pedidas.forEach((t, k) => {
    assert.equal(t, cal.cierreSesion(cal.diaET(spy[k].t)));  // 16:00 ET de esa sesión
    assert.ok(t < spy[k].t + DIA);
  });
  // Cripto 1D (medianoche UTC): sigue siendo el cierre de la vela, t + 1 día.
  const btc = spy.map((v, k) => ({ ...v, t: Date.UTC(2026, 7, 3) + k * DIA }));
  const pedidasBtc = [];
  backtest({ velas: { 'BTC/USD': btc }, estrategia: estrategiaGuion({}), contexto: t => { pedidasBtc.push(t); return {}; }, capital: 10000, limites: LIMITES_ABIERTOS });
  pedidasBtc.forEach((t, k) => assert.equal(t, btc[k].t + DIA));
});
