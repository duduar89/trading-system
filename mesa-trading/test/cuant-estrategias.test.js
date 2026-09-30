'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FAMILIAS, mesasIniciales } = require('../src/estrategias');
const filtros = require('../src/estrategias/filtros');
const comun = require('../src/estrategias/comun');
const tendencia = require('../src/estrategias/tendencia-sma');
const ruptura = require('../src/estrategias/ruptura-donchian');
const reversion = require('../src/estrategias/reversion-rsi');
const momentum = require('../src/estrategias/momentum-rotacion');
const { DIA, T0, serieSintetica, cestaSintetica, velasAMano } = require('./cuant-ayuda');

const CRIPTO6 = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD'];

test('las cuatro familias cumplen la interfaz de §4.3', () => {
  assert.deepEqual(Object.keys(FAMILIAS).sort(), ['momentum-rotacion', 'reversion-rsi', 'ruptura-donchian', 'tendencia-sma']);
  for (const [clave, e] of Object.entries(FAMILIAS)) {
    assert.equal(e.familia, clave);
    for (const campo of ['nombre', 'descripcion', 'marco']) assert.equal(typeof e[campo], 'string', `${clave}.${campo}`);
    assert.equal(typeof e.parametrosPorDefecto, 'object');
    assert.equal(typeof e.rejilla, 'object');
    for (const fn of ['calentamiento', 'preparar', 'decidir', 'trailing', 'vecinoMasLento']) assert.equal(typeof e[fn], 'function', `${clave}.${fn}`);
    assert.ok(Number.isInteger(e.calentamiento(e.parametrosPorDefecto)));
  }
  assert.equal(tendencia.marco, '4Hour');
  assert.equal(momentum.marco, '1Day');
  assert.equal(reversion.marco, '1Day');
  assert.equal(ruptura.marco, '1Day');
});

test('valores por defecto de la tabla de §4.3', () => {
  assert.deepEqual({ ...tendencia.parametrosPorDefecto }, { rapida: 7, lenta: 25, filtro: 200, atr: 14, atrStop: 2.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(momentum.parametrosPorDefecto)),
    { perfil: 'cripto', lookbacks: [28], ajustarVol: true, top: 2, rebalanceo: 'semanal', soloPositivos: true, atr: 14, atrStop: 3 });
  assert.deepEqual([...momentum.parametrosEtf.lookbacks], [63, 126, 252]);
  assert.equal(momentum.parametrosEtf.rebalanceo, 'mensual');
  assert.equal(reversion.parametrosPorDefecto.rsi, 2);
  assert.equal(reversion.parametrosPorDefecto.umbral, 10);
  assert.equal(reversion.parametrosPorDefecto.atrStop, 3);
  assert.deepEqual({ ...ruptura.parametrosPorDefecto }, { entrada: 20, salida: 10, atr: 20, atrStop: 2 });
});

test('cada rejilla tiene ≤ 30 combinaciones y sus valores están en el dominio', () => {
  const rejillas = [
    ['tendencia-sma', tendencia.rejilla, tendencia], ['ruptura-donchian', ruptura.rejilla, ruptura],
    ['reversion-rsi', reversion.rejilla, reversion], ['momentum cripto', momentum.rejilla, momentum],
    ['momentum etf', momentum.rejillaEtf, momentum],
  ];
  for (const [nombre, rej, e] of rejillas) {
    const n = comun.numeroCombinaciones(rej);
    assert.ok(n <= 30, `${nombre}: ${n} combinaciones`);
    assert.equal(comun.combinaciones(rej).length, n);
    for (const [k, vals] of Object.entries(rej)) {
      for (const v of vals) assert.ok(e.dominio[k].some(x => comun.igual(x, v)), `${nombre}.${k}=${v}`);
    }
  }
  // Los valores por defecto también están en el dominio (el laboratorio los puede fijar).
  for (const e of Object.values(FAMILIAS)) {
    for (const [k, v] of Object.entries(e.parametrosPorDefecto)) assert.ok(e.dominio[k].some(x => comun.igual(x, v)), `${e.familia}.${k}`);
  }
});

test('combinaciones con valores fijos: se quitan de la rejilla y pisan la base', () => {
  const combos = comun.combinaciones(tendencia.rejilla, tendencia.parametrosPorDefecto, { atrStop: 3 });
  assert.equal(combos.length, 12); // 4 rápidas × 3 lentas
  assert.ok(combos.every(c => c.atrStop === 3 && c.filtro === 200));
});

// ---------------------------------------------------------------------------
// Causalidad de las decisiones

function comprobarCausalidad(estrategia, velasLargas, N, params) {
  const cortas = {};
  for (const [s, v] of Object.entries(velasLargas)) cortas[s] = v.slice(0, N);
  const pLargo = estrategia.preparar(velasLargas, params);
  const pCorto = estrategia.preparar(cortas, params);
  const ctx = { regimen: 'NEUTRAL', fg: 50, filtros: [{ id: 'vol-max', parametro: 90 }] };
  for (const s of Object.keys(velasLargas)) {
    for (let i = 0; i < N; i++) {
      const c = velasLargas[s][i].c;
      const posicion = { cantidad: 1, entrada: c * 0.97, stop: c * 0.9, maxPrecio: c * 1.02, barrasAbierta: i % 7, entradaT: 0 };
      for (const pos of [null, posicion]) {
        const a = estrategia.decidir(pCorto, { simbolo: s, i, posicion: pos, t: velasLargas[s][i].t + DIA, contexto: ctx });
        const b = estrategia.decidir(pLargo, { simbolo: s, i, posicion: pos, t: velasLargas[s][i].t + DIA, contexto: ctx });
        assert.deepEqual(b, a, `${estrategia.familia} ${s} i=${i} ${pos ? 'con' : 'sin'} posición`);
      }
      const ta = estrategia.trailing(pCorto, { simbolo: s, i, posicion, params });
      const tb = estrategia.trailing(pLargo, { simbolo: s, i, posicion, params });
      assert.equal(tb, ta, `${estrategia.familia} trailing ${s} i=${i}`);
    }
  }
}

test('CAUSALIDAD: ninguna familia cambia una decisión pasada al añadir 50 velas', () => {
  const tres = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD'], 650, 3);
  comprobarCausalidad(tendencia, tres, 600, tendencia.parametrosPorDefecto);
  comprobarCausalidad(ruptura, tres, 600, ruptura.parametrosPorDefecto);
  comprobarCausalidad(reversion, tres, 600, { ...reversion.parametrosPorDefecto, umbral: 15 });
  comprobarCausalidad(momentum, cestaSintetica(CRIPTO6, 450, 4), 400, momentum.parametrosPorDefecto);
});

test('en vivo: preparar con las últimas 400 velas da la misma señal SMA que con todo el histórico', () => {
  // La SMA solo mira su ventana, así que la decisión del último índice coincide.
  const todas = { 'BTC/USD': serieSintetica(1500, 21, { marcoMs: 4 * 3600e3 }) };
  const ultimas = { 'BTC/USD': todas['BTC/USD'].slice(-400) };
  const a = tendencia.decidir(tendencia.preparar(todas, {}), { simbolo: 'BTC/USD', i: 1499, posicion: null, contexto: {} });
  const b = tendencia.decidir(tendencia.preparar(ultimas, {}), { simbolo: 'BTC/USD', i: 399, posicion: null, contexto: {} });
  assert.equal(a.accion, b.accion);
  assert.equal(a.motivo, b.motivo);
});

// ---------------------------------------------------------------------------
// Tendencia SMA — serie a mano (la misma del caso conocido del motor)

const VELAS_CRUCE = velasAMano([
  [10, 10.2, 9.8, 10], [10, 10.2, 8.8, 9], [9, 9.2, 7.8, 8], [8, 8.2, 6.8, 7], [7, 7.2, 5.8, 6],
  [6, 7.2, 5.8, 7], [7, 9.2, 6.8, 9], [9.5, 11.2, 9.3, 11], [11, 12.2, 10.8, 12], [12, 12.2, 10.8, 11],
  [11, 11.2, 8.8, 9], [10.5, 10.6, 7.9, 8],
], { marcoMs: 4 * 3600e3 });
const P_CRUCE = { rapida: 2, lenta: 3, filtro: 4, atr: 2, atrStop: 3 };

test('tendencia-sma: abre SOLO en la vela en que la señal pasa a LONG (i=6)', () => {
  // i=5: SMA2 6,5 < SMA3 6,667 → no. i=6: SMA2 (7+9)/2 = 8 > SMA3 (6+7+9)/3 = 7,333
  // y cierre 9 > SMA4 (7+6+7+9)/4 = 7,25 → LONG. i=7: sigue LONG pero ya no es nueva.
  const prep = tendencia.preparar({ 'SOL/USD': VELAS_CRUCE }, P_CRUCE);
  const acciones = VELAS_CRUCE.map((_, i) => tendencia.decidir(prep, { simbolo: 'SOL/USD', i, posicion: null, contexto: {} }).accion);
  assert.deepEqual(acciones.map((a, i) => (a === 'abrir' ? i : null)).filter(x => x !== null), [6]);
  const s = tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 6, posicion: null, contexto: {} });
  // ATR(2) en i=6 = 1,884375 → stop = 9 − 3·1,884375 = 3,346875
  assert.ok(Math.abs(s.stop - 3.346875) < 1e-12);
  assert.equal(s.peso, 1);
  assert.equal(s.motivo, 'SMA2 8,000 > SMA3 7,333; cierre 9,000 > SMA4 7,250');
  assert.match(s.estado, /^Abro SOL/);
});

test('tendencia-sma: cierra cuando la rápida cae bajo la lenta (i=10) y espera sin posición', () => {
  const prep = tendencia.preparar({ 'SOL/USD': VELAS_CRUCE }, P_CRUCE);
  const pos = { cantidad: 1, entrada: 9.5, stop: 3, maxPrecio: 12, barrasAbierta: 3 };
  assert.equal(tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 9, posicion: pos }).accion, 'mantener');
  const c = tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 10, posicion: pos });
  assert.equal(c.accion, 'cerrar'); // SMA2 10 < SMA3 10,667
  const espera = tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 11, posicion: null, contexto: {} });
  assert.equal(espera.estado, 'Sin posición en SOL. Esperando a que SMA 2-3 dé LONG con filtro 4 (4H)');
});

test('tendencia-sma: trailing = máximo − atrStop·ATR, solo sube', () => {
  const prep = tendencia.preparar({ 'SOL/USD': VELAS_CRUCE }, P_CRUCE);
  // i=7: ATR 2,0421875 → 11 − 6,1265625 = 4,8734375
  const t7 = tendencia.trailing(prep, { simbolo: 'SOL/USD', i: 7, posicion: { stop: 3.346875, maxPrecio: 11 } });
  assert.ok(Math.abs(t7 - 4.8734375) < 1e-12);
  // Si no mejora el stop actual → null
  assert.equal(tendencia.trailing(prep, { simbolo: 'SOL/USD', i: 7, posicion: { stop: 6, maxPrecio: 11 } }), null);
});

test('decidir con textos:false da la misma acción y sin textos (lo usa el backtest)', () => {
  const prep = tendencia.preparar({ 'SOL/USD': VELAS_CRUCE }, P_CRUCE);
  const a = tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 6, posicion: null, contexto: {} });
  const b = tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 6, posicion: null, contexto: {}, textos: false });
  assert.equal(b.accion, a.accion);
  assert.equal(b.stop, a.stop);
  assert.equal(b.motivo, '');
  assert.equal(b.estado, '');
});

// ---------------------------------------------------------------------------
// Filtros

test('filtros: solo bloquean ABRIR; cerrar sigue pasando', () => {
  const prep = tendencia.preparar({ 'SOL/USD': VELAS_CRUCE }, P_CRUCE);
  const riskOff = { regimen: { valor: 'RISK-OFF' }, filtros: [{ id: 'regimen-no-riskoff', parametro: null }] };
  const bloqueada = tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 6, posicion: null, contexto: riskOff });
  assert.equal(bloqueada.accion, 'nada');
  assert.match(bloqueada.estado, /bloqueado por filtro: régimen RISK-OFF/);
  const pos = { cantidad: 1, entrada: 9.5, stop: 3, maxPrecio: 12, barrasAbierta: 3 };
  assert.equal(tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 10, posicion: pos, contexto: riskOff }).accion, 'cerrar');
  // Filtros ya creados también valen
  const creados = { regimen: 'RISK-ON', filtros: filtros.crearFiltros([{ id: 'regimen-no-riskoff' }]) };
  assert.equal(tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 6, posicion: null, contexto: creados }).accion, 'abrir');
});

test('filtros: catálogo cerrado y umbrales de Miedo y codicia', () => {
  assert.equal(filtros.validarFiltro({ id: 'fg-max', parametro: 77 }).ok, false);
  assert.equal(filtros.validarFiltro({ id: 'inventado' }).ok, false);
  assert.equal(filtros.validarFiltro({ id: 'vol-max', parametro: 90 }).ok, true);
  const fgMax = filtros.crearFiltro({ id: 'fg-max', parametro: 80 });
  assert.equal(fgMax.permite({ fg: 85 }), false);
  assert.equal(fgMax.permite({ fg: 80 }), true);
  assert.equal(fgMax.permite({ fg: null }), true); // sin dato no se bloquea
  const fgMin = filtros.crearFiltro({ id: 'fg-min', parametro: 20 });
  assert.equal(fgMin.permite({ fg: { valor: 15 } }), false);
  assert.equal(fgMin.permite({ fg: 25 }), true);
  const vol = filtros.crearFiltro({ id: 'vol-max', parametro: 80 });
  assert.equal(vol.permite({ volPercentil: 95 }), false);
  assert.equal(vol.permite({ volPercentil: 50 }), true);
});

test('filtro vol-max usa el percentil de la volatilidad 30 d del propio símbolo en el último año', () => {
  // Serie tranquila y luego muy volátil: al final la volatilidad está en máximos del año.
  const tranquila = serieSintetica(400, 8, { vol: 0.01, deriva: 0.004 });
  const loca = serieSintetica(60, 9, { vol: 0.12, deriva: 0.0, p0: tranquila[399].c, t0: tranquila[399].t + DIA });
  const velas = { 'BTC/USD': [...tranquila, ...loca] };
  const prep = ruptura.preparar(velas, { entrada: 20, salida: 10, atr: 20, atrStop: 2 });
  const q = comun.volPercentil(prep, 'BTC/USD', velas['BTC/USD'].length - 1);
  assert.ok(q > 90, `percentil ${q}`);
  assert.equal(comun.volPercentil(prep, 'BTC/USD', 390), null); // hacen falta 30 + 365 velas diarias
  assert.ok(comun.volPercentil(prep, 'BTC/USD', 395) !== null);
  // En vivo con solo las últimas 400 velas sale exactamente lo mismo en la última.
  const ultimas = { 'BTC/USD': velas['BTC/USD'].slice(-400) };
  const prepVivo = ruptura.preparar(ultimas, { entrada: 20, salida: 10, atr: 20, atrStop: 2 });
  assert.equal(comun.volPercentil(prepVivo, 'BTC/USD', 399), q);
  // Y el contexto del filtro lo bloquea
  const i = velas['BTC/USD'].length - 1;
  const bloqueo = comun.filtroQueBloquea(prep, 'BTC/USD', i, { filtros: [{ id: 'vol-max', parametro: 90 }] });
  assert.equal(bloqueo && bloqueo.id, 'vol-max');
});

test('velasNecesarias: calentamiento + 15 periodos de ATR, y el año del filtro vol-max', () => {
  const { velasNecesarias } = require('../src/estrategias');
  const [tend, mom, rev, rup] = mesasIniciales({ hayAlpaca: false });
  assert.equal(velasNecesarias(tend), 201 + 15 * 14);   // SMA200 + 1, ATR(14)
  assert.equal(velasNecesarias(mom), 29 + 15 * 14);     // lookback 28 + 1
  assert.equal(velasNecesarias(rev), 200 + 15 * 14);
  assert.equal(velasNecesarias(rup), 21 + 15 * 20);     // ATR(20)
  assert.equal(velasNecesarias({ ...rup, filtros: [{ id: 'vol-max', parametro: 90 }] }), 30 + 365 + 1);
  assert.equal(velasNecesarias({ ...tend, filtros: [{ id: 'vol-max', parametro: 90 }] }), 180 + 2190 + 1);
});

test('con velasNecesarias en vivo, la decisión y el stop del último índice son los del backtest', () => {
  const { velasNecesarias } = require('../src/estrategias');
  const largas = cestaSintetica(CRIPTO6, 1500, 31);
  for (const m of mesasIniciales({ hayAlpaca: false })) {
    const e = FAMILIAS[m.familia];
    const n = velasNecesarias(m);
    const todas = Object.fromEntries(m.universo.map(s => [s, largas[s]]));
    const cortas = Object.fromEntries(m.universo.map(s => [s, largas[s].slice(-n)]));
    const pT = e.preparar(todas, m.params);
    const pC = e.preparar(cortas, m.params);
    for (const s of m.universo) {
      const a = e.decidir(pT, { simbolo: s, i: 1499, posicion: null, contexto: {} });
      const b = e.decidir(pC, { simbolo: s, i: n - 1, posicion: null, contexto: {} });
      assert.equal(b.accion, a.accion, `${m.id} ${s}`);
      if (a.stop !== null) assert.ok(Math.abs(b.stop - a.stop) <= 1e-6 * a.stop, `${m.id} ${s} stop ${b.stop} vs ${a.stop}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Ruptura Donchian con canales cortos

test('ruptura-donchian: abre al superar el máximo previo y cierra bajo el mínimo previo', () => {
  const velas = velasAMano([
    [10, 11, 9, 10], [10, 11.5, 9.5, 11], [11, 12, 10, 11], [11, 11.8, 10.5, 12.5], // i=3: 12,5 > máx(11, 11,5, 12) = 12
    [12.5, 13, 12, 12.8], [12.8, 12.9, 11, 11.2], [11.2, 11.3, 10.2, 10.4],           // i=6: 10,4 < mín(12, 11) = 11
  ]);
  const prep = ruptura.preparar({ 'ETH/USD': velas }, { entrada: 3, salida: 2, atr: 2, atrStop: 2 });
  const sin = velas.map((_, i) => ruptura.decidir(prep, { simbolo: 'ETH/USD', i, posicion: null, contexto: {} }).accion);
  assert.equal(sin[3], 'abrir');
  assert.equal(sin[2], 'nada');
  const pos = { cantidad: 1, entrada: 12.5, stop: 9, maxPrecio: 12.8, barrasAbierta: 2 };
  assert.equal(ruptura.decidir(prep, { simbolo: 'ETH/USD', i: 5, posicion: pos }).accion, 'mantener'); // 11,2 ≥ mín(12, 11) = 11
  assert.equal(ruptura.decidir(prep, { simbolo: 'ETH/USD', i: 6, posicion: pos }).accion, 'cerrar');
  assert.equal(ruptura.trailing(prep, { simbolo: 'ETH/USD', i: 6, posicion: pos }), null);
});

// ---------------------------------------------------------------------------
// Reversión RSI con filtro corto

test('reversion-rsi: abre con RSI(2) < umbral sobre la SMA filtro; sale sobre SMA salida o tras maxBarras', () => {
  // Subida de 0,1 por vela de 10 a 14 (i=0..40) y caída de 1 en i=41.
  // RSI(2) de Wilder: subida media 0,1 y bajada 0 antes de la caída; en i=41
  // subida (0,1+0)/2 = 0,05, bajada (0+1)/2 = 0,5 → RSI = 100·0,05/0,55 = 9,09 < 10.
  // SMA30 en i=41 = (29 cierres de 11,2 a 14,0, media 12,6, + 13,0)/30 = 12,613 < 13,0.
  const cierres = [...Array.from({ length: 41 }, (_, i) => Math.round((10 + 0.1 * i) * 10) / 10), 13.0, 12.9, 13.6];
  const velas = velasAMano(cierres.map((c, i) => { const o = i ? cierres[i - 1] : c; return [o, Math.max(o, c) + 0.05, Math.min(o, c) - 0.05, c]; }));
  const p = { rsi: 2, umbral: 10, filtro: 30, salidaSma: 3, maxBarras: 3, atr: 2, atrStop: 3 };
  const prep = reversion.preparar({ 'BTC/USD': velas }, p);
  const s = prep.porSimbolo['BTC/USD'];
  assert.ok(Math.abs(s.rsi[41] - 100 / 11) < 1e-9, `RSI ${s.rsi[41]}`);
  assert.ok(Math.abs(s.filtro[41] - (29 * 12.6 + 13) / 30) < 1e-9);
  const s41 = reversion.decidir(prep, { simbolo: 'BTC/USD', i: 41, posicion: null, contexto: {} });
  assert.equal(s41.accion, 'abrir');
  assert.equal(s41.motivo, 'RSI(2) 9,1 < 10; cierre 13,00 > SMA30 12,61');
  // Ninguna otra vela abre (antes el RSI es 100)
  const aperturas = cierres.map((_, i) => reversion.decidir(prep, { simbolo: 'BTC/USD', i, posicion: null, contexto: {} }).accion);
  assert.deepEqual(aperturas.map((a, i) => (a === 'abrir' ? i : null)).filter(x => x !== null), [41, 42]);
  // i=42: 12,9 ≤ SMA3 (14+13+12,9)/3 = 13,3 → con 2 velas abiertas mantener; con 3 cerrar por tiempo
  assert.equal(reversion.decidir(prep, { simbolo: 'BTC/USD', i: 42, posicion: { entrada: 13, stop: 10, barrasAbierta: 2 } }).accion, 'mantener');
  const t = reversion.decidir(prep, { simbolo: 'BTC/USD', i: 42, posicion: { entrada: 13, stop: 10, barrasAbierta: 3 } });
  assert.equal(t.accion, 'cerrar');
  assert.equal(t.motivo, '3 velas abiertas (máx. 3)');
  // i=43: 13,6 > SMA3 (13+12,9+13,6)/3 = 13,167 → cerrar por la media
  const m = reversion.decidir(prep, { simbolo: 'BTC/USD', i: 43, posicion: { entrada: 13, stop: 10, barrasAbierta: 1 } });
  assert.equal(m.accion, 'cerrar');
  assert.equal(m.motivo, 'cierre 13,60 > SMA3 13,17');
});

// ---------------------------------------------------------------------------
// Momentum

function diasSeguidos(cierresPorSimbolo, t0 = T0) {
  const out = {};
  for (const [s, cc] of Object.entries(cierresPorSimbolo)) out[s] = cc.map((c, i) => ({ t: t0 + i * DIA, o: c, h: c * 1.01, l: c * 0.99, c, v: 0 }));
  return out;
}

test('momentum cripto: rebalancea solo con la vela del domingo (se ejecuta el lunes) y elige el top 2 positivo', () => {
  // T0 es lunes → i=6 es domingo. Lookback 2 sin ajuste para hacer la cuenta a mano:
  // en i=6: A 16/14 − 1 = +14 %, B 11/10,5 − 1 = +4,8 %, C 7/8 − 1 = −12,5 %.
  const velas = diasSeguidos({
    'BTC/USD': [10, 11, 12, 13, 14, 15, 16, 17],
    'ETH/USD': [10, 10.1, 10.2, 10.3, 10.5, 10.8, 11, 11.1],
    'SOL/USD': [10, 9.8, 9.5, 9, 8, 7.5, 7, 6.5],
  });
  const prep = momentum.preparar(velas, { lookbacks: [2], ajustarVol: false, top: 2, rebalanceo: 'semanal', soloPositivos: true, atr: 2, atrStop: 3 });
  const d = (s, i, posicion = null) => momentum.decidir(prep, { simbolo: s, i, posicion, contexto: {} });
  assert.equal(new Date(velas['BTC/USD'][6].t).getUTCDay(), 0); // domingo
  assert.equal(d('BTC/USD', 6).accion, 'abrir');
  assert.equal(d('BTC/USD', 6).peso, 0.5); // 1/top
  assert.equal(d('ETH/USD', 6).accion, 'abrir');
  assert.equal(d('SOL/USD', 6).accion, 'nada');
  const pos = { cantidad: 1, entrada: 9, stop: 5, barrasAbierta: 3 };
  assert.equal(d('SOL/USD', 6, pos).accion, 'cerrar');
  assert.match(d('SOL/USD', 6, pos).motivo, /rentabilidad -12,50 % ≤ 0/);
  // Fuera del rebalanceo: mantener con posición, nada sin ella (aunque sea el mejor)
  assert.equal(d('BTC/USD', 5).accion, 'nada');
  assert.equal(d('SOL/USD', 5, pos).accion, 'mantener');
});

test('momentum cripto: solo con rentabilidad > 0 (si solo uno sube, solo uno entra)', () => {
  const velas = diasSeguidos({
    'BTC/USD': [10, 11, 12, 13, 14, 15, 16, 17],
    'ETH/USD': [10, 10, 10, 10, 10, 10.2, 10, 10],     // rent. 2 d en i=6: 10/10 − 1 = 0 → no entra
    'SOL/USD': [10, 9.8, 9.5, 9, 8, 7.5, 7, 6.5],
  });
  const prep = momentum.preparar(velas, { lookbacks: [2], ajustarVol: false, top: 2, rebalanceo: 'semanal', soloPositivos: true, atr: 2, atrStop: 3 });
  assert.equal(momentum.decidir(prep, { simbolo: 'BTC/USD', i: 6, posicion: null, contexto: {} }).accion, 'abrir');
  assert.equal(momentum.decidir(prep, { simbolo: 'ETH/USD', i: 6, posicion: null, contexto: {} }).accion, 'nada');
});

test('momentum etf: rebalanceo mensual con la primera sesión del mes', () => {
  // Sesiones de lunes a viernes desde el 27-ene-2020; la primera de febrero es el lunes 3.
  const t0 = Date.UTC(2020, 0, 27);
  const dias = [];
  for (let d = 0; dias.length < 12; d++) { const t = t0 + d * DIA; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) dias.push(t); }
  const mk = cc => cc.map((c, i) => ({ t: dias[i], o: c, h: c, l: c, c, v: 0 }));
  const velas = { SPY: mk([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), TLT: mk([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) };
  const prep = momentum.preparar(velas, { ...momentum.parametrosEtf, lookbacks: [2], atr: 2 });
  const iFeb = dias.findIndex(t => new Date(t).getUTCMonth() === 1);
  assert.equal(iFeb, 5);
  const acciones = dias.map((_, i) => momentum.decidir(prep, { simbolo: 'SPY', i, posicion: null, contexto: {} }).accion);
  assert.deepEqual(acciones.map((a, i) => (a === 'abrir' ? i : null)).filter(x => x !== null), [5]);
  assert.equal(momentum.parametrosPara(['SPY', 'QQQ']).perfil, 'etf');
  assert.equal(momentum.rejillaPara(['BTC/USD']), momentum.rejilla);
});

test('vecino más lento de cada familia', () => {
  assert.deepEqual(tendencia.vecinoMasLento({ rapida: 7, lenta: 25 }), { rapida: 10, lenta: 40 });
  assert.equal(tendencia.vecinoMasLento({ rapida: 14, lenta: 60 }), null);
  assert.deepEqual(ruptura.vecinoMasLento({ entrada: 20 }), { entrada: 30 });
  assert.deepEqual(reversion.vecinoMasLento({ umbral: 10 }), { umbral: 5 });
  assert.deepEqual(momentum.vecinoMasLento(momentum.parametrosPorDefecto), { lookbacks: [42] });
  assert.deepEqual(momentum.vecinoMasLento(momentum.parametrosEtf), { lookbacks: [126, 252] });
});

test('mesasIniciales: 4 sin claves y 6 con claves, con la forma de Mesa', () => {
  const sin = mesasIniciales({ hayAlpaca: false });
  assert.deepEqual(sin.map(m => m.id), ['tendencia', 'momentum', 'reversion', 'ruptura']);
  const con = mesasIniciales({ hayAlpaca: true });
  assert.deepEqual(con.map(m => m.id), ['tendencia', 'momentum', 'reversion', 'ruptura', 'momentum-etf', 'reversion-etf']);
  const porId = Object.fromEntries(con.map(m => [m.id, m]));
  assert.deepEqual(porId.tendencia.universo, ['BTC/USD', 'ETH/USD', 'SOL/USD']);
  assert.equal(porId.tendencia.marco, '4Hour');
  assert.deepEqual(porId.momentum.universo, CRIPTO6);
  assert.deepEqual(porId.reversion.universo, ['BTC/USD', 'ETH/USD']);
  assert.deepEqual(porId['momentum-etf'].universo, ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD']);
  assert.deepEqual(porId['momentum-etf'].params.lookbacks, [63, 126, 252]);
  assert.deepEqual(porId['reversion-etf'].universo, ['SPY', 'QQQ']);
  for (const m of con) {
    assert.deepEqual(Object.keys(m).sort(), ['estado', 'familia', 'filtros', 'id', 'marco', 'nombre', 'nota', 'origen', 'params', 'universo']);
    // Tendencia y Reversión cripto pierden en el backtest real con costes:
    // arrancan en incubación (2 %) y tienen que ganarse el puesto.
    assert.equal(m.estado, ['tendencia', 'reversion'].includes(m.id) ? 'incubacion' : 'titular');
    assert.equal(m.origen, 'inicial');
    assert.deepEqual(m.filtros, []);
    assert.equal(m.marco, FAMILIAS[m.familia].marco);
  }
  // Los params de una mesa no comparten arrays con los valores por defecto
  porId.momentum.params.lookbacks.push(99);
  assert.deepEqual([...momentum.parametrosPorDefecto.lookbacks], [28]);
});

test('Señal: forma de §4.3 y peso 1/universo en familias por activo', () => {
  const velas = cestaSintetica(['BTC/USD', 'ETH/USD', 'SOL/USD'], 300, 2);
  for (const e of [tendencia, ruptura, reversion]) {
    const prep = e.preparar(velas, e.parametrosPorDefecto);
    for (let i = 250; i < 300; i++) {
      const s = e.decidir(prep, { simbolo: 'ETH/USD', i, posicion: null, contexto: {} });
      assert.deepEqual(Object.keys(s).sort(), ['accion', 'estado', 'motivo', 'objetivoPrecio', 'peso', 'stop']);
      assert.ok(['abrir', 'mantener', 'cerrar', 'nada'].includes(s.accion));
      if (s.accion === 'abrir') { assert.ok(s.stop < velas['ETH/USD'][i].c); assert.ok(Math.abs(s.peso - 1 / 3) < 1e-12); }
    }
  }
});

// ---- Velas sin decidir (ordenador apagado o dormido) e huecos en los datos ----

test('tendencia-sma: un cruce que cae en una vela sin decidir se recupera con iAnterior', () => {
  // VELAS_CRUCE: la condición falla en i=5 y se cumple en i=6, 7 y 8. Si la última
  // vela decidida fue la 5 y la 6 no se decidió (apagado), en la 7 se entra tarde.
  const prep = tendencia.preparar({ 'SOL/USD': VELAS_CRUCE }, P_CRUCE);
  const d = extra => tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 7, posicion: null, contexto: {}, ...extra });
  assert.equal(d({}).accion, 'nada');                       // sin iAnterior: como el backtest (flanco en 6, no en 7)
  assert.equal(d({ iAnterior: 6 }).accion, 'nada');         // la 6 se decidió: el cruce ya se vio
  const tarde = d({ iAnterior: 5 });
  assert.equal(tarde.accion, 'abrir');                      // la 6 no se decidió: el cruce ocurrió mientras tanto
  assert.equal(tarde.stop, tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 7, iAnterior: 5, contexto: {}, textos: false }).stop);
  // Si la condición se cumplía ya en la última decidida y no falló en medio, no hay cruce nuevo.
  assert.equal(tendencia.decidir(prep, { simbolo: 'SOL/USD', i: 8, iAnterior: 6, contexto: {} }).accion, 'nada');
});

test('momentum cripto: el rebalanceo del lunes no se pierde si el domingo no se decidió', () => {
  const velas = diasSeguidos({
    'BTC/USD': [10, 11, 12, 13, 14, 15, 16, 17],
    'ETH/USD': [10, 10.1, 10.2, 10.3, 10.5, 10.8, 11, 11.1],
    'SOL/USD': [10, 9.8, 9.5, 9, 8, 7.5, 7, 6.5],
  });
  const prep = momentum.preparar(velas, { lookbacks: [2], ajustarVol: false, top: 2, rebalanceo: 'semanal', soloPositivos: true, atr: 2, atrStop: 3 });
  // i=6 (domingo) es la vela del rebalanceo. Última decidida: 5; siguiente: 7.
  assert.equal(momentum.decidir(prep, { simbolo: 'BTC/USD', i: 7, contexto: {} }).accion, 'nada');
  assert.equal(momentum.decidir(prep, { simbolo: 'BTC/USD', i: 7, iAnterior: 6, contexto: {} }).accion, 'nada');
  assert.equal(momentum.decidir(prep, { simbolo: 'BTC/USD', i: 7, iAnterior: 5, contexto: {} }).accion, 'abrir');
  assert.equal(momentum.esRebalanceo(prep, prep.porSimbolo['BTC/USD'], 7, 5), true);
  assert.equal(momentum.esRebalanceo(prep, prep.porSimbolo['BTC/USD'], 7), false);
});

test('momentum etf: la primera sesión del mes sin decidir se rebalancea en la siguiente', () => {
  const t0 = Date.UTC(2020, 0, 27);
  const dias = [];
  for (let d = 0; dias.length < 12; d++) { const t = t0 + d * DIA; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) dias.push(t); }
  const mk = cc => cc.map((c, i) => ({ t: dias[i], o: c, h: c, l: c, c, v: 0 }));
  const velas = { SPY: mk([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), TLT: mk([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) };
  const prep = momentum.preparar(velas, { ...momentum.parametrosEtf, lookbacks: [2], atr: 2 });
  // i=5 es la primera sesión de febrero. Última decidida: 4 (enero); siguiente: 6.
  assert.equal(momentum.decidir(prep, { simbolo: 'SPY', i: 6, contexto: {} }).accion, 'nada');
  assert.equal(momentum.decidir(prep, { simbolo: 'SPY', i: 6, iAnterior: 5, contexto: {} }).accion, 'nada');
  assert.equal(momentum.decidir(prep, { simbolo: 'SPY', i: 6, iAnterior: 4, contexto: {} }).accion, 'abrir');
});

test('momentum: tras un HUECO en los datos la puntuación no mezcla precios de antes y no desplaza a los demás', () => {
  // SOL deja de tener velas del día 10 al 39 y vuelve 10 veces más cara (como SOL en
  // Alpaca). El domingo 41 su rentabilidad de 2 velas cruzaría el hueco: +900 %.
  const n = 100;
  const btc = Array.from({ length: n }, (_, d) => 100 * 1.01 ** d);
  const eth = Array.from({ length: n }, (_, d) => 50 * 1.005 ** d);
  const velas = diasSeguidos({ 'BTC/USD': btc, 'ETH/USD': eth });
  velas['SOL/USD'] = Array.from({ length: n }, (_, d) => d)
    .filter(d => d < 10 || d >= 40)
    .map(d => { const c = d < 10 ? 10 : 100; return { t: T0 + d * DIA, o: c, h: c, l: c, c, v: 0 }; });
  const params = { lookbacks: [2], ajustarVol: false, top: 2, rebalanceo: 'semanal', soloPositivos: true, atr: 2, atrStop: 3 };
  const prep = momentum.preparar(velas, params);
  const sol = prep.porSimbolo['SOL/USD'];
  const iSol = velas['SOL/USD'].findIndex(v => v.t === T0 + 41 * DIA);
  assert.equal(new Date(T0 + 41 * DIA).getUTCDay(), 0); // domingo: rebalanceo
  assert.equal(sol.puntuacion[iSol], null);
  assert.equal(momentum.decidir(prep, { simbolo: 'SOL/USD', i: iSol, contexto: {} }).accion, 'nada');
  assert.equal(momentum.decidir(prep, { simbolo: 'BTC/USD', i: 41, contexto: {} }).accion, 'abrir');
  assert.equal(momentum.decidir(prep, { simbolo: 'ETH/USD', i: 41, contexto: {} }).accion, 'abrir');
  // Vacía mientras el motor no lo deja decidir (velasMemoria: calentamiento + 15·ATR);
  // después vuelve a puntuar, ya solo con precios de después.
  const ventana = comun.velasMemoria(momentum, params);
  assert.equal(ventana, 3 + 15 * 2);
  const vuelta = 10;                                  // índice de SOL de la primera vela tras el hueco
  assert.equal(sol.puntuacion[vuelta + ventana - 1], null);
  assert.equal(sol.rentMedia[vuelta + ventana], 0);
  // Sin hueco (series continuas) nada cambia: la puntuación existe desde el lookback.
  assert.notEqual(prep.porSimbolo['BTC/USD'].puntuacion[2], null);
});

test('comun.umbralHueco: noches, fines de semana y puentes no son hueco; semanas sin velas, sí', () => {
  const H4 = 4 * 3600e3;
  assert.equal(comun.umbralHueco(DIA), 5 * DIA);
  assert.equal(comun.umbralHueco(H4), 5 * DIA);
  const puente = [{ t: Date.UTC(2026, 3, 2, 4) }, { t: Date.UTC(2026, 3, 6, 4) }]; // jueves → lunes (Viernes Santo)
  assert.deepEqual(comun.reanudaciones(puente, comun.umbralHueco(DIA)), []);
  const hueco = [{ t: T0 }, { t: T0 + DIA }, { t: T0 + 30 * DIA }, { t: T0 + 31 * DIA }];
  assert.deepEqual(comun.reanudaciones(hueco, comun.umbralHueco(DIA)), [2]);
  assert.equal(comun.ultimaReanudacion([2, 9], 1), -Infinity);
  assert.equal(comun.ultimaReanudacion([2, 9], 5), 2);
  assert.equal(comun.ultimaReanudacion([2, 9], 9), 9);
});
