'use strict';
// Estudio de los límites de riesgo con velas reales: de aquí salen las cifras
// con las que se decidieron el 30-sep-2026 el riesgo por operación (1 %), los
// kills (−7 % en el día y −25 % desde el máximo), el tope por activo (10 %) y
// que Ruptura arranque en incubación (src/config.js, src/estrategias/index.js,
// docs/04-riesgo-y-mejora.md).
//
// No es un caso conocido (no está en probar-todo): no comprueba nada, repite
// el estudio para que cualquiera pueda rehacer las cifras.
//
//   node scripts/estudiar-limites.js
//   --datos=<carpeta>   lee <carpeta>/cache/probar/ en vez de data/cache/probar/
//
// Lee las velas de Alpaca que guarda `node scripts/probar-backtest.js --real`
// (BTC, ETH y SOL en 1Day y 4Hour desde 2021). Backtest con los costes de §3.4
// y la penalización de papel. Momentum va con BTC/ETH/SOL, las tres cripto con
// histórico en la caché (en vivo tiene seis).

const fs = require('fs');
const path = require('path');
const { FAMILIAS } = require('../src/estrategias');
const { backtest, costesPorDefecto } = require('../src/backtest/motor');
const { RAIZ, LIMITES_DUROS } = require('../src/config');
const { FACTOR_CAIDA } = require('../src/riesgo/vigilante');
const formato = require('../src/util/formato');

const DIA = 86_400_000;
const CAPITAL = 100000;
const U3 = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
const ARG = Object.fromEntries(process.argv.slice(2).map(a => /^--([a-z-]+)(?:=(.*))?$/.exec(a)).filter(Boolean).map(m => [m[1], m[2] === undefined ? true : m[2]]));
const CARPETA = path.join(typeof ARG.datos === 'string' && ARG.datos ? path.resolve(ARG.datos) : path.join(RAIZ, 'data'), 'cache', 'probar');

// ---------------------------------------------------------------------------
// Velas

const NECESARIAS = ['BTC/USD', 'ETH/USD', 'SOL/USD'].flatMap(s => ['1Day', '4Hour'].map(m => [s, m]));
const rutaDe = (s, m) => path.join(CARPETA, `${s.replace('/', '')}_${m}.json`);

function comprobarCache() {
  const faltan = NECESARIAS.filter(([s, m]) => {
    try { const j = JSON.parse(fs.readFileSync(rutaDe(s, m), 'utf8')); return !(j && Array.isArray(j.velas) && j.velas.length); } catch (_) { return true; }
  });
  if (!faltan.length) return;
  console.log(`Faltan velas en ${CARPETA}:`);
  for (const [s, m] of faltan) console.log(`  ${path.basename(rutaDe(s, m))} (${s} ${m})`);
  console.log('\nEste estudio usa las velas reales de Alpaca que descarga el backtest real. Primero:');
  console.log('  node scripts/probar-backtest.js --real');
  console.log('(tarda unos minutos la primera vez; detrás de un proxy, con NODE_USE_ENV_PROXY=1 delante).');
  console.log('Después, otra vez: node scripts/estudiar-limites.js');
  process.exit(1);
}

const cacheVelas = new Map();
function cargar(simbolo, marco) {
  const k = `${simbolo}|${marco}`;
  if (!cacheVelas.has(k)) cacheVelas.set(k, JSON.parse(fs.readFileSync(rutaDe(simbolo, marco), 'utf8')).velas);
  return cacheVelas.get(k);
}

// ---------------------------------------------------------------------------
// Carteras: cada mesa con su parte del capital y los límites del fondo sobre
// el patrimonio entero (pesoMesa); lo que no se asigna queda en efectivo.

function plan(familia, peso, universo = U3) {
  const est = FAMILIAS[familia];
  const velas = {};
  for (const s of universo) velas[s] = cargar(s, est.marco);
  return { familia, peso, universo, est, velas };
}

// Primer día en que todas las mesas han calentado (así las curvas se suman).
function desdeComun(planes) {
  let desde = 0;
  for (const p of planes) {
    const params = p.est.parametrosPara ? p.est.parametrosPara(p.universo) : p.est.parametrosPorDefecto;
    desde = Math.max(desde, p.velas[p.universo[0]][p.est.calentamiento(params)].t);
  }
  return Math.ceil(desde / DIA) * DIA;
}

// Último valor de cada día UTC.
function diaria(curva) {
  const m = new Map();
  for (const x of curva) m.set(Math.floor(x.t / DIA) * DIA, x.valor);
  return m;
}

function cartera(planes, { limites, desde }) {
  const efectivo = 1 - planes.reduce((a, p) => a + p.peso, 0);
  const curvas = [];
  const operaciones = [];
  for (const p of planes) {
    const r = backtest({ velas: p.velas, estrategia: p.est, capital: CAPITAL * p.peso, costes: costesPorDefecto(), limites, desde, pesoMesa: p.peso });
    curvas.push(diaria(r.curva));
    operaciones.push(...r.operaciones);
  }
  const dias = [...curvas[0].keys()].filter(t => curvas.every(c => c.has(t))).sort((a, b) => a - b);
  const valores = dias.map(t => curvas.reduce((a, c) => a + c.get(t), 0) + CAPITAL * efectivo);
  return { dias, valores, operaciones, efectivo };
}

const retornos = v => v.slice(1).map((x, i) => x / v[i] - 1);
const mediaDe = r => r.reduce((a, x) => a + x, 0) / r.length;
const sdDe = r => { const m = mediaDe(r); return Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)); };

function metricas(dias, valores) {
  const r = retornos(valores);
  let pico = valores[0];
  let dd = 0;
  let peorDia = 0;
  const dias2 = { d2: 0, d35: 0, d5: 0, d7: 0 };
  const episodios = { dd10: 0, dd15: 0 };
  let en10 = false;
  let en15 = false;
  for (let i = 0; i < valores.length; i++) {
    pico = Math.max(pico, valores[i]);
    const c = valores[i] / pico - 1;
    dd = Math.min(dd, c);
    if (c <= -0.10 && !en10) { episodios.dd10++; en10 = true; }
    if (c <= -0.15 && !en15) { episodios.dd15++; en15 = true; }
    if (c > -0.05) { en10 = false; en15 = false; }
    if (i > 0) {
      const rd = r[i - 1];
      peorDia = Math.min(peorDia, rd);
      if (rd <= -0.02) dias2.d2++;
      if (rd <= -0.035) dias2.d35++;
      if (rd <= -0.05) dias2.d5++;
      if (rd <= -0.07) dias2.d7++;
    }
  }
  const anios = (dias[dias.length - 1] - dias[0]) / (365 * DIA);
  const fin = valores[valores.length - 1] / valores[0];
  return { rent: fin - 1, cagr: fin ** (1 / anios) - 1, sharpe: (mediaDe(r) / sdDe(r)) * Math.sqrt(365), maxDD: -dd, peorDia, dias: dias2, episodios };
}

// La protección del fondo aproximada sobre la curva sin proteger: con la caída
// desde el máximo ≤ −caidaReducir, las posiciones nuevas van a ×0,5, lo que
// aquí se aproxima escalando el retorno del día siguiente.
function protegida(dias, valores, limites) {
  const r = retornos(valores);
  let val = CAPITAL;
  let pico = CAPITAL;
  let mult = 1;
  let peor = 0;
  let dd = 0;
  const serie = [val];
  const diasRojos = { d2: 0, d35: 0, d5: 0, d7: 0 };
  for (const x of r) {
    const rd = mult * x;
    val *= 1 + rd;
    serie.push(val);
    pico = Math.max(pico, val);
    const c = val / pico - 1;
    dd = Math.min(dd, c);
    peor = Math.min(peor, rd);
    mult = c <= -limites.caidaReducir ? FACTOR_CAIDA : 1;
    if (rd <= -0.02) diasRojos.d2++;
    if (rd <= -0.035) diasRojos.d35++;
    if (rd <= -0.05) diasRojos.d5++;
    if (rd <= -0.07) diasRojos.d7++;
  }
  const anios = (dias[dias.length - 1] - dias[0]) / (365 * DIA);
  // Veces que la caída cruza −u (se da por salida al volver por encima de −u/2).
  const cruces = u => {
    let n = 0;
    let dentro = false;
    let p = serie[0];
    for (const x of serie) {
      p = Math.max(p, x);
      const c = x / p - 1;
      if (c <= -u && !dentro) { n++; dentro = true; }
      if (c > -u / 2) dentro = false;
    }
    return n;
  };
  const rs = retornos(serie);
  return {
    cagr: (val / CAPITAL) ** (1 / anios) - 1, sharpe: (mediaDe(rs) / sdDe(rs)) * Math.sqrt(365), maxDD: -dd, peorDia: peor, dias: diasRojos,
    cruces: Object.fromEntries([0.15, 0.20, 0.25, 0.30].map(u => [u, cruces(u)])),
  };
}

function correlacion(a, b) {
  const n = Math.min(a.length, b.length);
  const x = a.slice(0, n);
  const y = b.slice(0, n);
  const mx = mediaDe(x);
  const my = mediaDe(y);
  const cov = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / (n - 1);
  return cov / (sdDe(x) * sdDe(y));
}

// ---------------------------------------------------------------------------
// Tablas

const P1 = x => formato.pct(x, { decimales: 1 });
const P2 = x => formato.pct(x, { decimales: 2 });
const N2 = x => formato.numero(x, 2);
const N0 = x => formato.numero(x, 0);
const fecha = t => new Date(t).toISOString().slice(0, 10);

function tabla(cabecera, filas) {
  const todas = [cabecera, ...filas].map(f => f.map(String));
  const anchos = cabecera.map((_, k) => Math.max(...todas.map(f => f[k].length)));
  const linea = f => f.map((x, k) => (k === 0 ? x.padEnd(anchos[k]) : x.padStart(anchos[k]))).join('  ');
  console.log(linea(todas[0]));
  console.log(anchos.map(a => '-'.repeat(a)).join('  '));
  for (const f of todas.slice(1)) console.log(linea(f));
}

function main() {
  comprobarCache();
  const L = LIMITES_DUROS;
  const fin = fecha(cargar('BTC/USD', '1Day').slice(-1)[0].t);
  console.log('Estudio de límites con velas reales de Alpaca (BTC/ETH/SOL), costes de §3.4 y penalización de papel del 0,1 %.');
  console.log(`Velas: ${CARPETA} (hasta el ${fin}).`);
  console.log(`Límites en vigor (src/config.js): riesgo por operación ${P1(L.riesgoPorOperacion)}, tope por activo ${P1(L.maxPesoPorActivo)}, ` +
    `solo cerrar ${P1(-L.perdidaDiariaSoloCerrar)} en el día, kill ${P1(-L.perdidaDiariaKill)} en el día, ×${N2(FACTOR_CAIDA)} a ${P1(-L.caidaReducir)} y kill a ${P1(-L.caidaKill)} desde el máximo.`);

  // 1 y 2. Riesgo por operación con la cartera de arranque ANTERIOR (la del estudio).
  const anterior = [plan('momentum-rotacion', 0.40), plan('ruptura-donchian', 0.40), plan('tendencia-sma', 0.02), plan('reversion-rsi', 0.02, ['BTC/USD', 'ETH/USD'])];
  const desde = desdeComun(anterior);
  console.log(`\n1) Riesgo por operación, cartera de arranque anterior (Momentum 40 %, Ruptura 40 %, Tendencia 2 %, Reversión 2 %, 16 % en efectivo),`);
  console.log(`   SIN la protección del fondo, ${fecha(desde)} → ${fin}:`);
  const filas1 = [];
  const filas2 = [];
  for (const riesgo of [0.005, 0.01, 0.015, 0.02]) {
    const limites = { ...L, riesgoPorOperacion: riesgo };
    const c = cartera(anterior, { limites, desde });
    const m = metricas(c.dias, c.valores);
    let peorOp = 0;
    let riesgoMedio = 0;
    let nR = 0;
    for (const o of c.operaciones) {
      peorOp = Math.min(peorOp, o.pnl / CAPITAL);          // pérdida de la operación sobre el fondo de partida
      if (o.stop && o.entradaPrecio > o.stop) { riesgoMedio += ((o.entradaPrecio - o.stop) * o.cantidad) / CAPITAL; nR++; }
    }
    filas1.push([P1(riesgo), P1(m.rent), P1(m.cagr), N2(m.sharpe), P1(m.maxDD), P2(m.peorDia), N0(c.operaciones.length), P2(peorOp),
      nR ? P2(riesgoMedio / nR) : '—', N0(m.dias.d2), N0(m.dias.d35), N0(m.dias.d7), N0(m.episodios.dd10), N0(m.episodios.dd15)]);
    if (riesgo <= 0.015) {
      const p = protegida(c.dias, c.valores, L);
      filas2.push([P1(riesgo), P1(p.cagr), N2(p.sharpe), P1(p.maxDD), P2(p.peorDia), N0(p.dias.d2), N0(p.dias.d35), N0(p.dias.d5), N0(p.dias.d7),
        N0(p.cruces[0.15]), N0(p.cruces[0.20]), N0(p.cruces[0.25]), N0(p.cruces[0.30])]);
    }
  }
  tabla(['riesgo', 'rent.', 'CAGR', 'Sharpe', 'maxDD', 'peor día', 'ops', 'peor op. (fondo)', 'riesgo medio al stop', 'días ≤−2 %', 'días ≤−3,5 %', 'días ≤−7 %', 'caídas ≥10 %', 'caídas ≥15 %'], filas1);
  console.log('   La peor operación puede pasar del riesgo por operación: un hueco de precio salta el stop.');

  console.log(`\n2) Umbrales: la misma cartera CON la protección (×${N2(FACTOR_CAIDA)} a ${P1(-L.caidaReducir)} desde el máximo, aproximada sobre la curva):`);
  tabla(['riesgo', 'CAGR', 'Sharpe', 'maxDD', 'peor día', 'días ≤−2 %', 'días ≤−3,5 %', 'días ≤−5 %', 'días ≤−7 %', 'cruces −15 %', 'cruces −20 %', 'cruces −25 %', 'cruces −30 %'], filas2);
  console.log('   «días ≤ x» = días con esa pérdida o más (el kill del día salta ahí); «cruces» = veces que la caída desde el máximo llega ahí.');

  // 3. Momentum frente a Ruptura en la cartera real, con el riesgo del fondo.
  const limitesFondo = { ...L };
  const desde3 = Date.parse('2021-08-01T00:00:00Z');
  console.log(`\n3) ¿Diversifica Ruptura? Riesgo por operación ${P1(L.riesgoPorOperacion)} y límites del fondo, ${fecha(desde3)} → ${fin}:`);
  const filas3 = [];
  const serieDe = (nombre, planes) => {
    const c = cartera(planes, { limites: limitesFondo, desde: desde3 });
    const m = metricas(c.dias, c.valores);
    filas3.push([nombre, P1(m.cagr), N2(m.sharpe), P1(m.maxDD)]);
    return retornos(c.valores);
  };
  const rMomentum = serieDe('Momentum 40 % + efectivo 60 %', [plan('momentum-rotacion', 0.40)]);
  const rRuptura = serieDe('Ruptura 40 % + efectivo 60 %', [plan('ruptura-donchian', 0.40)]);
  serieDe('Momentum 40 % + Ruptura 40 % + 20 %', [plan('momentum-rotacion', 0.40), plan('ruptura-donchian', 0.40)]);
  serieDe('Momentum 80 % + efectivo 20 %', [plan('momentum-rotacion', 0.80)]);
  tabla(['cartera', 'CAGR', 'Sharpe', 'maxDD'], filas3);
  console.log(`   Correlación diaria Momentum-Ruptura: ${N2(correlacion(rMomentum, rRuptura))}.`);

  // 4. Tope por activo con Momentum sola.
  console.log(`\n4) Tope por activo con Momentum sola (mesa del 40 %, riesgo ${P1(L.riesgoPorOperacion)}), ${fecha(desde3)} → ${fin}:`);
  const filas4 = [];
  for (const universo of [U3, ['BTC/USD', 'ETH/USD']]) {
    for (const tope of [0.10, 0.15, 0.20]) {
      const c = cartera([plan('momentum-rotacion', 0.40, universo)], { limites: { ...L, maxPesoPorActivo: tope }, desde: desde3 });
      const m = metricas(c.dias, c.valores);
      filas4.push([universo.map(s => s.split('/')[0]).join('/'), P1(tope), P1(m.cagr), N2(m.sharpe), P1(m.maxDD), P2(m.peorDia), N0(c.operaciones.length)]);
    }
  }
  tabla(['activos', 'tope', 'CAGR', 'Sharpe', 'maxDD', 'peor día', 'ops'], filas4);

  // 5. La cartera de arranque de ahora, con los límites en vigor.
  const ahora = [plan('momentum-rotacion', 0.40), plan('ruptura-donchian', 0.02), plan('tendencia-sma', 0.02), plan('reversion-rsi', 0.02, ['BTC/USD', 'ETH/USD'])];
  const c5 = cartera(ahora, { limites: L, desde });
  const m5 = metricas(c5.dias, c5.valores);
  const p5 = protegida(c5.dias, c5.valores, L);
  console.log(`\n5) Cartera de arranque de ahora (Momentum 40 %; Ruptura, Tendencia y Reversión 2 %; ${P1(c5.efectivo)} en efectivo), límites en vigor, ${fecha(desde)} → ${fin}:`);
  tabla(['', 'CAGR', 'Sharpe', 'maxDD', 'peor día', 'días ≤−2 %', 'días ≤−7 %', 'cruces −20 %', 'cruces −25 %'], [
    ['sin protección', P1(m5.cagr), N2(m5.sharpe), P1(m5.maxDD), P2(m5.peorDia), N0(m5.dias.d2), N0(m5.dias.d7), '—', '—'],
    [`con ×${N2(FACTOR_CAIDA)} a ${P1(-L.caidaReducir)}`, P1(p5.cagr), N2(p5.sharpe), P1(p5.maxDD), P2(p5.peorDia), N0(p5.dias.d2), N0(p5.dias.d7), N0(p5.cruces[0.20]), N0(p5.cruces[0.25])],
  ]);
  console.log('\nBacktest: no promete nada. Cinco años muy alcistas para la cripto y un solo bajista (2022).');
}

main();
