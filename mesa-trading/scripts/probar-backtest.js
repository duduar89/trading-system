'use strict';
// Casos conocidos del motor de backtest, las métricas y el Sharpe deflactado.
// Imprime OK/FALLO por caso y sale con código 1 si alguno falla.
//
//   node scripts/probar-backtest.js          casos offline
//   node scripts/probar-backtest.js --real   además, velas reales de BTC/ETH/SOL desde
//                                            2021 y cada familia por defecto frente a
//                                            comprar y mantener (caché en data/cache/probar/)
//   --datos=<carpeta>   la caché va en <carpeta>/cache/probar/ en vez de data/
//   --usar-cache        con --real, usa la caché aunque tenga más de 12 h (sin red):
//                       repite las cifras de una descarga anterior
//
// Detrás de un proxy corporativo, el fetch de Node necesita NODE_USE_ENV_PROXY=1.

const assert = require('node:assert/strict');
const path = require('path');
const { backtest, compraYMantener, costesPorDefecto } = require('../src/backtest/motor');
const { calcularMetricas, normalInv, sharpeDeflactado, momentos } = require('../src/backtest/metricas');
const { walkForward, calcularVentanas } = require('../src/backtest/walkforward');
const { FAMILIAS } = require('../src/estrategias');
const comun = require('../src/estrategias/comun');
const { leerJSON, escribirJSON } = require('../src/util/almacen');
const { RAIZ, LIMITES_DUROS } = require('../src/config');
const formato = require('../src/util/formato');
const { HORA } = require('../src/util/reloj');

const DIA = 86_400_000;
const T0 = Date.UTC(2020, 0, 6);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => /^--([a-z-]+)(?:=(.*))?$/.exec(a)).filter(Boolean).map(m => [m[1], m[2] === undefined ? true : m[2]]));
const CARPETA_DATOS = typeof ARG.datos === 'string' && ARG.datos ? path.resolve(ARG.datos) : path.join(RAIZ, 'data');
let fallos = 0;
function caso(nombre, fn) {
  try {
    fn();
    console.log(`OK     ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`FALLO  ${nombre}\n       ${String(e.message).split('\n').join('\n       ')}`);
  }
}
const cerca = (a, b, tol = 1e-9) => assert.ok(a !== null && Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const velasAMano = (filas, marcoMs = DIA) => filas.map(([o, h, l, c], i) => ({ t: T0 + i * marcoMs, o, h, l, c, v: 0 }));
const COSTES = { comision: () => 0.0025, deslizamiento: () => 0.0005, penalizacion: 0.001 };
const ABIERTOS = { riesgoPorOperacion: 1, maxPesoPorActivo: 1, minNocionalOrden: 0 };

function guion({ abrirEn, stop, trailingEn = {} }) {
  const s = (accion, extra = {}) => ({ accion, peso: 1, stop: null, objetivoPrecio: null, motivo: '', estado: '', ...extra });
  return {
    familia: 'guion', marco: '1Day', parametrosPorDefecto: {}, rejilla: {}, calentamiento: () => 0,
    preparar: () => ({}),
    decidir: (p, { i, posicion }) => (!posicion && i === abrirEn ? s('abrir', { stop }) : s(posicion ? 'mantener' : 'nada')),
    trailing: (p, { i }) => (trailingEn[i] === undefined ? null : trailingEn[i]),
  };
}

// ---------------------------------------------------------------------------
// Casos offline

function casosOffline() {
  caso('cruce SMA2/SMA3 en la vela 6 → entrada en la apertura de la 7 (9,51425) y P&L 964,4946 $ con comisiones', () => {
    // Entrada 9,5·1,0015 = 9,51425; cantidad 9.975/9,51425 = 1.048,42736; salida en la apertura de
    // la vela 11 a 10,5·0,9985 = 10,48425; bruto 10.991,97454 − 0,25 % = 10.964,49460 → P&L 964,49460.
    const velas = velasAMano([
      [10, 10.2, 9.8, 10], [10, 10.2, 8.8, 9], [9, 9.2, 7.8, 8], [8, 8.2, 6.8, 7], [7, 7.2, 5.8, 6],
      [6, 7.2, 5.8, 7], [7, 9.2, 6.8, 9], [9.5, 11.2, 9.3, 11], [11, 12.2, 10.8, 12], [12, 12.2, 10.8, 11],
      [11, 11.2, 8.8, 9], [10.5, 10.6, 7.9, 8],
    ], 4 * HORA);
    const r = backtest({ velas: { 'SOL/USD': velas }, estrategia: FAMILIAS['tendencia-sma'], params: { rapida: 2, lenta: 3, filtro: 4, atr: 2, atrStop: 3 },
      capital: 10000, costes: COSTES, limites: ABIERTOS, volObjetivo: Infinity });
    assert.equal(r.operaciones.length, 1);
    const op = r.operaciones[0];
    assert.equal(op.entradaT, velas[7].t);
    assert.equal(op.salidaT, velas[11].t);
    cerca(op.entradaPrecio, 9.51425, 1e-12);
    cerca(op.cantidad, 1048.4273589615575, 1e-9);
    cerca(op.salidaPrecio, 10.48425, 1e-12);
    cerca(op.pnl, 964.4946018472274, 1e-8);
    cerca(op.comisiones, 52.479936345481775, 1e-9);
    cerca(r.curva[r.curva.length - 1].valor, 10964.494601847227, 1e-8);
  });

  caso('stop con hueco: abre en 90 bajo el stop 95 → sale a 90·0,9985 = 89,865', () => {
    const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 101, 99, 100], [90, 92, 88, 91], [91, 92, 90, 91]]) };
    const r = backtest({ velas, estrategia: guion({ abrirEn: 0, stop: 95 }), capital: 10000, costes: COSTES, limites: ABIERTOS, volObjetivo: Infinity });
    cerca(r.operaciones[0].salidaPrecio, 89.865, 1e-12);
    cerca(r.operaciones[0].pnl, (9975 / 100.15) * 89.865 * 0.9975 - 10000, 1e-8);
  });

  caso('stop dentro de la vela sin hueco → sale al stop 95·0,9985', () => {
    const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 101, 99, 100], [98, 99, 94, 97], [97, 98, 96, 97]]) };
    const r = backtest({ velas, estrategia: guion({ abrirEn: 0, stop: 95 }), capital: 10000, costes: COSTES, limites: ABIERTOS, volObjetivo: Infinity });
    cerca(r.operaciones[0].salidaPrecio, 95 * 0.9985, 1e-12);
    assert.equal(r.operaciones[0].motivoSalida, 'stop');
  });

  caso('trailing calculado al cierre de i=1 vale desde i=2 (no salta en i=1 aunque el mínimo lo toque)', () => {
    const velas = { 'BTC/USD': velasAMano([[100, 101, 99, 100], [100, 101, 99, 100], [100, 100.5, 99.2, 100], [100, 101, 99, 100]]) };
    const r = backtest({ velas, estrategia: guion({ abrirEn: 0, stop: 90, trailingEn: { 1: 99.5 } }), capital: 10000, costes: COSTES, limites: ABIERTOS, volObjetivo: Infinity });
    assert.equal(r.operaciones[0].salidaT, velas['BTC/USD'][2].t);
    cerca(r.operaciones[0].salidaPrecio, 99.5 * 0.9985, 1e-12);
  });

  caso('cuadre: Σ pnl = patrimonio final − capital en las cuatro familias (serie sintética)', () => {
    let s = 3;
    const azar = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
    const serie = () => {
      let p = 100;
      return Array.from({ length: 900 }, (_, i) => {
        const o = p; p = p * Math.exp(Math.sin(i / 90) * 0.004 + 0.06 * azar());
        return { t: T0 + i * DIA, o, h: Math.max(o, p) * 1.01, l: Math.min(o, p) * 0.99, c: p, v: 0 };
      });
    };
    const velas = { 'BTC/USD': serie(), 'ETH/USD': serie(), 'SOL/USD': serie() };
    for (const e of Object.values(FAMILIAS)) {
      const r = backtest({ velas, estrategia: e, capital: 10000 });
      const suma = r.operaciones.reduce((a, o) => a + o.pnl, 0);
      cerca(r.curva[r.curva.length - 1].valor - 10000, suma, 1e-6);
    }
  });

  caso('normalInv(0,975) = 1,959964 (tolerancia 1e-6)', () => {
    cerca(normalInv(0.975), 1.959964, 1e-6);
  });

  caso('DSR a mano: SR 0,1, T 250, N 10, V 0,0025, asim −0,5, curt 4 → SR0 0,078730, DSR 0,627933', () => {
    const r = sharpeDeflactado({ sharpe: 0.1, n: 250, ensayos: 10, varianzaSharpes: 0.0025, asimetria: -0.5, curtosis: 4 });
    cerca(r.sharpeUmbral, 0.0787299150672875, 1e-9);
    cerca(r.dsr, 0.6279330363338281, 1e-8);
  });

  caso('DSR del artículo (Bailey y López de Prado 2014): SR anual 2,5, T 1.250, N 100, V 0,5, asim −3, curt 10 → 0,9004', () => {
    const r = sharpeDeflactado({ sharpe: 2.5 / Math.sqrt(250), n: 1250, ensayos: 100, varianzaSharpes: 0.5 / 250, asimetria: -3, curtosis: 10 });
    cerca(r.dsr, 0.9004, 1e-4);
  });

  caso('métricas a mano: 100 → 110 → 99 → 108,9 da Sharpe 4,98862, Sortino 9,55249, maxDD 10 %', () => {
    const curva = [100, 110, 99, 108.9].map((valor, i) => ({ t: T0 + i * DIA, valor }));
    const m = calcularMetricas({ curva, operaciones: [], periodosAnio: 365 });
    cerca(m.sharpe, 4.988623420981346, 1e-9);
    cerca(m.sortino, 9.5524865872714, 1e-9);
    cerca(m.maxDD, 0.1);
    cerca(m.rentabilidad, 0.089);
  });

  // Hueco de datos como el de SOL en Alpaca (jul-2023 → ago-2024): 10 velas a
  // 20, 30 días sin ninguna y 10 más; la primera de después abre con el precio
  // rancio de antes (18) y cierra al de verdad (157).
  const conHueco = () => [
    ...Array.from({ length: 10 }, (_, d) => ({ t: T0 + d * DIA, o: 20, h: 20.5, l: 19.5, c: 20, v: 0 })),
    ...Array.from({ length: 10 }, (_, k) => (k === 0
      ? { t: T0 + 40 * DIA, o: 18, h: 159, l: 18, c: 157, v: 0 }
      : { t: T0 + (40 + k) * DIA, o: 157, h: 158, l: 156, c: 157, v: 0 })),
  ];

  caso('hueco: la orden decidida justo antes caduca (no se compra a 18 con el precio en 157)', () => {
    const r = backtest({ velas: { 'SOL/USD': conHueco() }, estrategia: guion({ abrirEn: 9 }), capital: 10000, costes: COSTES, limites: ABIERTOS, volObjetivo: Infinity });
    assert.equal(r.operaciones.length, 0);
    assert.ok(r.curva.every(p => p.valor === 10000));
  });

  caso('hueco: lo abierto se vende al último cierre de antes (20·0,9985), motivo «hueco», P&L −79,74 $ y cuadre', () => {
    const serie = conHueco();
    const r = backtest({ velas: { 'SOL/USD': serie }, estrategia: guion({ abrirEn: 2 }), capital: 10000, costes: COSTES, limites: ABIERTOS, volObjetivo: Infinity });
    assert.equal(r.operaciones.length, 1);
    const op = r.operaciones[0];
    assert.equal(op.motivoSalida, 'hueco');
    assert.equal(op.entradaT, serie[3].t);
    assert.equal(op.salidaT, serie[9].t + DIA);
    cerca(op.entradaPrecio, 20 * 1.0015, 1e-12);
    cerca(op.salidaPrecio, 20 * 0.9985, 1e-12);
    // A mano: 9.975 $ (10.000 menos la comisión de compra) / 20,03 = 498,002996 SOL;
    // 498,002996 · 19,97 = 9.945,11982 − 0,25 % = 9.920,25702 → P&L −79,74298 $.
    const cantidad = 9975 / (20 * 1.0015);
    cerca(op.pnl, cantidad * 20 * 0.9985 * 0.9975 - 10000, 1e-8);
    cerca(op.pnl, -79.74298, 1e-5);
    cerca(r.curva[r.curva.length - 1].valor - 10000, op.pnl, 1e-9);
    for (let k = 1; k < r.curva.length; k++) assert.ok(Math.abs(r.curva[k].valor / r.curva[k - 1].valor - 1) < 0.01, 'salto en la curva');
  });

  caso('walk-forward: 48 meses calientes dan 5 ventanas 18/6 contiguas', () => {
    const v = calcularVentanas({ tCalentado: Date.UTC(2020, 0, 1), tFin: Date.UTC(2024, 0, 1), entrenoMeses: 18, pruebaMeses: 6 });
    assert.equal(v.length, 5);
    assert.equal(v[0].pruebaDesde, Date.UTC(2021, 6, 1));
    assert.equal(v[4].pruebaHasta, Date.UTC(2024, 0, 1));
  });
}

// ---------------------------------------------------------------------------
// Comprobación con velas reales

const BASE = 'https://data.alpaca.markets/v1beta3/crypto/us/bars';

const dormir = ms => new Promise(res => setTimeout(res, ms));

// Respeta el límite de 200 peticiones/min: si quedan pocas, espera al reinicio
// que anuncia la cabecera; ante 429 o 5xx, Retry-After o espera creciente.
async function pedir(url) {
  for (let intento = 0; intento < 6; intento++) {
    const r = await fetch(url);
    if (r.status === 429 || r.status >= 500) {
      await dormir(Number(r.headers.get('retry-after')) * 1000 || 1000 * 2 ** intento);
      continue;
    }
    const texto = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${texto.slice(0, 200)}`);
    const quedan = Number(r.headers.get('x-ratelimit-remaining'));
    const reinicio = Number(r.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(quedan) && quedan <= 5 && Number.isFinite(reinicio)) {
      await dormir(Math.max(0, reinicio * 1000 - Date.now()) + 500);
    }
    return JSON.parse(texto);
  }
  throw new Error(`demasiados reintentos: ${url}`);
}

// Un símbolo por petición y sin cabeceras (ficha de Alpaca §0.2 y §3); pagina
// con page_token hasta que next_page_token sea null. Solo velas cerradas.
// Ojo: en 4Hour cada página trae ~43 velas (unas 10.000 barras de 1 minuto)
// aunque se pida limit=10000, así que 5 años son ~300 páginas por símbolo.
// La caché solo vale si la paginación terminó sola (completa: true).
async function descargar(simbolo, marco) {
  const ruta = path.join(CARPETA_DATOS, 'cache', 'probar', `${simbolo.replace('/', '')}_${marco}.json`);
  const cache = leerJSON(ruta);
  if (cache && cache.completa === true && Array.isArray(cache.velas) && (ARG['usar-cache'] || Date.now() - cache.descargado < 12 * HORA)) return cache.velas;
  if (ARG['usar-cache']) throw new Error(`--usar-cache sin caché completa en ${ruta}`);
  const marcoMs = comun.MARCOS[marco];
  const porT = new Map();
  let token = null;
  let paginas = 0;
  do {
    const u = new URL(BASE);
    u.searchParams.set('symbols', simbolo);
    u.searchParams.set('timeframe', marco);
    u.searchParams.set('start', '2021-01-01');
    u.searchParams.set('limit', '10000');
    u.searchParams.set('sort', 'asc');
    if (token) u.searchParams.set('page_token', token);
    const j = await pedir(u.toString());
    for (const b of (j.bars && j.bars[simbolo]) || []) {
      const t = Date.parse(b.t);
      porT.set(t, { t, o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v) });
    }
    token = j.next_page_token || null;
    paginas++;
    if (paginas % 50 === 0) process.stdout.write(`  … ${simbolo} ${marco}: ${paginas} páginas, ${porT.size} velas\n`);
  } while (token && paginas < 5000);
  if (token) throw new Error(`${simbolo} ${marco}: más de 5.000 páginas, descarga incompleta`);
  const ahora = Date.now();
  const velas = [...porT.values()].filter(v => v.t + marcoMs <= ahora).sort((a, b) => a.t - b.t);
  escribirJSON(ruta, { descargado: ahora, completa: true, paginas, simbolo, marco, velas });
  return velas;
}

// Huecos de más de 3 velas (p. ej. un activo que dejó de cotizar en Alpaca).
function huecos(velas, marcoMs) {
  const out = [];
  for (let i = 1; i < velas.length; i++) {
    const n = Math.round((velas[i].t - velas[i - 1].t) / marcoMs) - 1;
    if (n > 3) out.push({ desde: velas[i - 1].t, hasta: velas[i].t, velas: n });
  }
  return out;
}

const F = {
  pct: x => (x === null || x === undefined || !Number.isFinite(x) ? '—' : formato.pct(x, { decimales: 1 })),
  num: (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : formato.numero(x, d)),
  fecha: t => new Date(t).toISOString().slice(0, 10),
};

function tabla(filas, cabecera) {
  const todas = [cabecera, ...filas];
  const anchos = cabecera.map((_, k) => Math.max(...todas.map(f => String(f[k]).length)));
  const linea = f => f.map((x, k) => (k === 0 ? String(x).padEnd(anchos[k]) : String(x).padStart(anchos[k]))).join('  ');
  console.log(linea(cabecera));
  console.log(anchos.map(a => '-'.repeat(a)).join('  '));
  for (const f of filas) console.log(linea(f));
}

async function comprobacionReal() {
  console.log('\n== Velas reales de Alpaca (BTC/ETH/SOL desde 2021-01-01) ==');
  const planes = [
    { familia: 'tendencia-sma', universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'] },
    { familia: 'momentum-rotacion', universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'] },
    { familia: 'reversion-rsi', universo: ['BTC/USD', 'ETH/USD'] },
    { familia: 'ruptura-donchian', universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'] },
  ];
  const cache = {};
  const velasDe = async (s, marco) => (cache[`${s}|${marco}`] ||= await descargar(s, marco));
  for (const s of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
    for (const marco of ['1Day', '4Hour']) {
      const v = await velasDe(s, marco);
      console.log(`  ${s} ${marco}: ${v.length} velas, ${F.fecha(v[0].t)} → ${F.fecha(v[v.length - 1].t)}`);
      for (const h of huecos(v, comun.MARCOS[marco])) {
        console.log(`    AVISO: hueco de ${h.velas} velas entre ${F.fecha(h.desde)} y ${F.fecha(h.hasta)} (sin cotización en Alpaca)`);
      }
    }
  }

  // Como correría una mesa con 1/4 del fondo: límites del fondo sobre patrimonio = capital / 0,25.
  const PESO_MESA = 0.25;
  const costes = costesPorDefecto();
  const filasMesa = [];
  const filasSenal = [];
  const filasWf = [];
  for (const plan of planes) {
    const est = FAMILIAS[plan.familia];
    const velas = {};
    for (const s of plan.universo) velas[s] = await velasDe(s, est.marco);
    const params = est.parametrosPara ? est.parametrosPara(plan.universo) : est.parametrosPorDefecto;
    const desde = velas[plan.universo[0]][est.calentamiento(params)].t; // tras calentar, igual para la sombra
    const marcoMs = comun.MARCOS[est.marco];
    const mesa = backtest({ velas, estrategia: est, capital: 10000, costes, limites: LIMITES_DUROS, desde, pesoMesa: PESO_MESA });
    // La misma mesa sin ningún coste (ni comisión, ni deslizamiento, ni penalización):
    // cuánto se lleva el coste de operar. Y lo pagado en comisiones.
    const sinCostes = backtest({ velas, estrategia: est, capital: 10000, costes: { comision: () => 0, deslizamiento: () => 0, penalizacion: 0 }, limites: LIMITES_DUROS, desde, pesoMesa: PESO_MESA });
    const comisiones = mesa.operaciones.reduce((a, o) => a + (o.comisiones || 0), 0);
    const senal = backtest({ velas, estrategia: est, capital: 10000, costes, limites: { minNocionalOrden: 10 }, desde, volObjetivo: Infinity });
    const bh = compraYMantener({ velas, capital: 10000, costes, desde, marcoMs });
    const nombre = `${plan.familia} ${comun.textoMarco(est.marco)} (${plan.universo.map(comun.etiqueta).join('/')})`;
    const m = mesa.metricas; const s = senal.metricas; const b = bh.metricas;
    filasMesa.push([nombre, F.pct(m.rentabilidad), F.pct(m.cagr), F.num(m.sharpe), F.pct(m.maxDD), m.operaciones, F.pct(m.acierto), F.pct(m.exposicionMedia),
      `${F.num(comisiones, 0)} $`, F.pct(sinCostes.metricas.rentabilidad), F.pct(b.rentabilidad), F.num(b.sharpe), F.pct(b.maxDD)]);
    filasSenal.push([nombre, F.pct(s.rentabilidad), F.num(s.sharpe), F.pct(s.maxDD), s.operaciones, F.pct(s.exposicionMedia), F.num(s.factorBeneficio)]);

    const t0 = Date.now();
    const wf = walkForward({ velas, estrategia: est, costes, limites: LIMITES_DUROS, pesoMesa: PESO_MESA });
    let dsr = null;
    if (wf.suficiente) {
      const rets = wf.oos.retornosDiarios.map(x => x.r);
      const mo = momentos(rets);
      const vr = wf.sharpesEnsayos.length > 1
        ? wf.sharpesEnsayos.reduce((a, x) => a + (x - wf.sharpesEnsayos.reduce((p, y) => p + y, 0) / wf.sharpesEnsayos.length) ** 2, 0) / (wf.sharpesEnsayos.length - 1)
        : 0;
      dsr = sharpeDeflactado({ sharpe: mo.media / mo.desviacion, n: rets.length, ensayos: wf.combinaciones, varianzaSharpes: vr / 365, asimetria: mo.asimetria, curtosis: mo.curtosis }).dsr;
    }
    const w = wf.oos.metricas;
    filasWf.push([nombre, wf.suficiente ? `${wf.ventanas.length}×${wf.entrenoMeses}/${wf.pruebaMeses}` : 'insuficiente', wf.combinaciones,
      F.num(w.sharpe), F.pct(w.rentabilidad), F.pct(w.maxDD), w.operaciones,
      `${wf.ventanas.filter(v => v.metricasPrueba.rentabilidad > 0).length}/${wf.ventanas.length}`, F.num(dsr), `${((Date.now() - t0) / 1000).toFixed(1)} s`]);
    console.log(`  ${nombre}: tramo ${F.fecha(desde)} → ${F.fecha(mesa.curva[mesa.curva.length - 1].t)}`);
  }

  console.log(`\n1) Parámetros por defecto, como una mesa con el 25 % del fondo (límites del fondo con riesgo por operación del ${F.pct(LIMITES_DUROS.riesgoPorOperacion)}, costes de §3.4 + penalización 0,1 %):`);
  tabla(filasMesa, ['familia', 'rent.', 'CAGR', 'Sharpe', 'maxDD', 'ops', 'acierto', 'expos.', 'comisiones', 'sin costes', 'C&M rent.', 'C&M Sharpe', 'C&M maxDD']);
  console.log('\n2) Calidad de la señal: la misma estrategia sin límites del fondo (peso completo por activo), mismos costes:');
  tabla(filasSenal, ['familia', 'rent.', 'Sharpe', 'maxDD', 'ops', 'expos.', 'factor']);
  console.log('\n3) Walk-forward fuera de muestra (rejilla completa, mesa al 25 %):');
  tabla(filasWf, ['familia', 'ventanas', 'combos', 'Sharpe OOS', 'rent. OOS', 'maxDD OOS', 'ops', 'ventanas +', 'DSR', 'tiempo']);
  console.log('\nC&M = comprar y mantener a partes iguales el mismo universo desde la misma fecha, con los mismos costes.');
  console.log('sin costes = la misma mesa sin comisión, deslizamiento ni penalización; comisiones = lo pagado sobre 10.000 $.');
}

(async () => {
  casosOffline();
  if (process.argv.includes('--real')) {
    try {
      await comprobacionReal();
    } catch (e) {
      fallos++;
      console.log(`FALLO  comprobación con velas reales: ${e.message}${e.cause ? ` (${e.cause.message})` : ''}`);
    }
  }
  console.log(fallos ? `\n${fallos} caso(s) FALLAN` : '\nTodos los casos cuadran');
  process.exit(fallos ? 1 : 0);
})();
