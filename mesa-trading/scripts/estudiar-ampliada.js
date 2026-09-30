'use strict';
// Estudio de «Momentum cripto ampliada» (30-sep-2026): ¿qué le pasa a Momentum
// cripto (la titular, 6 criptos) si se le añaden las 4 nuevas del universo
// (LTC y BCH, XRP, ADA, o las 4 a la vez, que es la mesa ampliada)?
//
// Existe porque la nota de la mesa enseñaba cifras (Sharpe 0,82 → 0,58 con LTC
// y BCH; 0,74 → 0,56 con XRP) que no salían de ningún estudio guardado ni de
// ningún script (revisión del 30-sep-2026), y no cuadraban entre sí: la misma
// titular con 0,82 y con 0,74 en «el mismo» periodo. La razón es que cada
// cripto nueva empieza a cotizar en Alpaca un día distinto: cada comparación
// tiene su periodo, y la titular se mide en ESE periodo. Aquí cada par (sin y
// con) va con su periodo escrito, y la nota se escribe desde la salida.
//
// Mismo motor y misma configuración que la titular en probar-backtest --real:
// parámetros por defecto, costes de §3.4 con la penalización de papel, límites
// duros y la mesa como el 25 % del fondo. Velas diarias de cripto de Alpaca
// (sin claves) desde 2021-01-01, caché en estudios/cache (fuera de git).
//
//   NODE_USE_ENV_PROXY=1 node scripts/estudiar-ampliada.js [--usar-cache]
//
// Deja docs/estudios/ampliada-AAAA-MM-DD.json (versionado): de ahí sale
// NOTAS.ampliada (src/estrategias/index.js) y test/cuant-estrategias.test.js
// lo comprueba. Solo LEE datos: no toca la mesa, ni data/, ni el bróker.

const fs = require('fs');
const path = require('path');
const { backtest, costesPorDefecto } = require('../src/backtest/motor');
const { FAMILIAS, CRIPTO_TITULAR, MESA_AMPLIADA } = require('../src/estrategias');
const { RAIZ, LIMITES_DUROS } = require('../src/config');
const comun = require('../src/estrategias/comun');
const formato = require('../src/util/formato');

const DIA = 86_400_000;
const PESO_MESA = 0.25;
const DESDE = '2021-01-01';
const BASE = 'https://data.alpaca.markets/v1beta3/crypto/us/bars';
const ARG = Object.fromEntries(process.argv.slice(2).map(a => /^--([a-z-]+)(?:=(.*))?$/.exec(a)).filter(Boolean).map(m => [m[1], m[2] === undefined ? true : m[2]]));

// Cada comparación: la titular con y sin estas criptos, en el periodo en que
// todas cotizan.
const COMPARACIONES = Object.freeze([
  { id: 'ltc-bch', anade: ['LTC/USD', 'BCH/USD'] },
  { id: 'xrp', anade: ['XRP/USD'] },
  { id: 'ada', anade: ['ADA/USD'] },
  { id: 'las-4', anade: MESA_AMPLIADA.universo.filter(s => !CRIPTO_TITULAR.includes(s)) },
]);

const dormir = ms => new Promise(res => setTimeout(res, ms));

async function pedirJSON(url, pedir) {
  for (let intento = 0; intento < 6; intento++) {
    const r = await pedir(url);
    if (r.status === 429 || r.status >= 500) { await dormir(1000 * 2 ** intento); continue; }
    const texto = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${texto.slice(0, 200)}`);
    return JSON.parse(texto);
  }
  throw new Error(`demasiados reintentos: ${url}`);
}

// Diarias cerradas de una cripto (un símbolo por petición, paginando).
async function velasCripto(simbolo, { carpeta, pedir, usarCache }) {
  const ruta = path.join(carpeta, `${simbolo.replace('/', '')}_1Day.json`);
  try {
    const c = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    if (usarCache || Date.now() - c.descargado < 12 * 3600e3) return c.velas;
  } catch (_) { /* sin caché */ }
  const porT = new Map();
  let token = null;
  do {
    const u = new URL(BASE);
    u.searchParams.set('symbols', simbolo); u.searchParams.set('timeframe', '1Day'); u.searchParams.set('start', DESDE);
    u.searchParams.set('limit', '10000'); u.searchParams.set('sort', 'asc');
    if (token) u.searchParams.set('page_token', token);
    const j = await pedirJSON(u.toString(), pedir);
    for (const b of (j.bars && j.bars[simbolo]) || []) {
      const t = Date.parse(b.t);
      porT.set(t, { t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v });
    }
    token = j.next_page_token || null;
  } while (token);
  const ahora = Date.now();
  const velas = [...porT.values()].filter(v => v.t + DIA <= ahora).sort((a, b) => a.t - b.t);
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify({ descargado: ahora, simbolo, velas }));
  return velas;
}

const iso = t => new Date(t).toISOString().slice(0, 10);
const resumen = r => ({ sharpe: r.metricas.sharpe, cagr: r.metricas.cagr, maxDD: r.metricas.maxDD, operaciones: r.metricas.operaciones });

// El estudio. `velasDe(simbolo)` → Vela[] (en las pruebas, sin red).
async function estudiar({ velasDe, ahora = Date.now() } = {}) {
  const est = FAMILIAS['momentum-rotacion'];
  const costes = costesPorDefecto();
  const todas = [...new Set([...CRIPTO_TITULAR, ...MESA_AMPLIADA.universo])];
  const velas = {};
  for (const s of todas) velas[s] = await velasDe(s);
  const primeras = Object.fromEntries(todas.map(s => [s, velas[s].length ? iso(velas[s][0].t) : null]));
  const params = est.parametrosPara(CRIPTO_TITULAR);
  const calentar = est.calentamiento(params);
  const correr = (universo, desde) => backtest({
    velas: Object.fromEntries(universo.map(s => [s, velas[s]])), estrategia: est, capital: 10000, costes, limites: LIMITES_DUROS, desde, pesoMesa: PESO_MESA,
  });
  const comparaciones = [];
  for (const c of COMPARACIONES) {
    const universo = [...CRIPTO_TITULAR, ...c.anade];
    // Desde que TODAS cotizan y han calentado: la titular se mide en ese mismo tramo.
    const desde = Math.max(...universo.map(s => (velas[s][calentar] ? velas[s][calentar].t : Infinity)));
    if (!Number.isFinite(desde)) {
      comparaciones.push({ id: c.id, anade: c.anade, universo, suficiente: false, motivo: 'sin velas suficientes para calentar' });
      continue;
    }
    const sin = correr(CRIPTO_TITULAR, desde);
    const con = correr(universo, desde);
    const hasta = sin.curva[sin.curva.length - 1].t;
    const meses = Math.round((hasta - desde) / (30.44 * DIA));
    comparaciones.push({ id: c.id, anade: c.anade, universo, suficiente: true, desde: iso(desde), hasta: iso(hasta), meses, titular: resumen(sin), conNuevas: resumen(con) });
  }
  return {
    fecha: iso(ahora), fuente: 'scripts/estudiar-ampliada.js', datos: 'Alpaca, velas diarias de cripto (v1beta3)', desdeDescarga: DESDE,
    configuracion: { familia: 'momentum-rotacion', params, pesoMesa: PESO_MESA, capital: 10000, limites: 'LIMITES_DUROS', costes: 'costesPorDefecto' },
    primerasVelas: primeras, comparaciones,
  };
}

async function main() {
  const carpeta = path.join(RAIZ, 'estudios', 'cache');
  const pedir = (u) => fetch(u);
  const datos = await estudiar({ velasDe: s => velasCripto(s, { carpeta, pedir, usarCache: Boolean(ARG['usar-cache']) }) });
  const dir = path.join(RAIZ, 'docs', 'estudios');
  fs.mkdirSync(dir, { recursive: true });
  const fichero = path.join(dir, `ampliada-${datos.fecha}.json`);
  fs.writeFileSync(fichero, JSON.stringify(datos, null, 1) + '\n');
  const n2 = x => (Number.isFinite(x) ? formato.numero(x, 2) : '—');
  console.log('Primera vela de cada cripto en Alpaca:');
  for (const [s, d] of Object.entries(datos.primerasVelas)) console.log(`  ${comun.etiqueta(s)}: ${d}`);
  console.log(`\nMomentum cripto (sus 6) frente a la misma con las nuevas, cada par en su periodo (mesa del ${formato.pct(PESO_MESA, { decimales: 0 })}, costes y límites duros):`);
  for (const c of datos.comparaciones) {
    if (!c.suficiente) { console.log(`  + ${c.anade.map(comun.etiqueta).join(', ')}: ${c.motivo}`); continue; }
    console.log(`  + ${c.anade.map(comun.etiqueta).join(', ')} (${c.desde} → ${c.hasta}, ${c.meses} meses): Sharpe ${n2(c.titular.sharpe)} → ${n2(c.conNuevas.sharpe)}; CAGR ${formato.pct(c.titular.cagr, { decimales: 1 })} → ${formato.pct(c.conNuevas.cagr, { decimales: 1 })}; caída ${formato.pct(c.titular.maxDD, { decimales: 1 })} → ${formato.pct(c.conNuevas.maxDD, { decimales: 1 })}`);
  }
  console.log(`\nGuardado en ${path.relative(RAIZ, fichero)}`);
  return 0;
}

if (require.main === module) main().then(c => process.exit(c), e => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { COMPARACIONES, estudiar, PESO_MESA };
