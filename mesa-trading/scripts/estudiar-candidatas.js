'use strict';
// Estudio de mesas candidatas de bolsa (bonos, materias primas, sectores,
// acciones grandes, índices) con el MISMO filtro que el laboratorio
// (src/cuant/laboratorio.js, evaluarHipotesis): walk-forward con rejilla,
// Sharpe fuera de muestra ≥ 0,6, ≥ 75 % de ventanas en positivo, Sharpe
// deflactado ≥ 0,90 contando TODOS los ensayos de este estudio, ≥ 30
// operaciones, caída ≤ 1,5 × la de comprar y mantener y correlación < 0,7 con
// la mesa titular (Momentum cripto, backtest con velas reales).
//
// Lo pidió Eduardo el 30-sep-2026 («adelante con el plan de bonos y acciones»).
// Solo LEE datos: no toca la mesa, ni data/, ni el bróker. Necesita las claves
// de Alpaca del .env (velas diarias de acciones desde 2016, feed SIP con más de
// 15 min de antigüedad: el plan gratuito lo permite). Se lanza desde la
// carpeta de la mesa, como el cron:
//
//   node scripts/estudiar-candidatas.js [--desde=2016-01-01] [--salida=estudios]
//
// Deja estudios/candidatas-AAAA-MM-DD.json (con la caché de velas, fuera de
// git) y una copia versionada en docs/estudios/candidatas-AAAA-MM-DD.json: de
// ahí salen las cifras de las notas y de ESTUDIOS_ETF (src/estrategias), y
// test/cuant-estrategias.test.js las compara con ella. Lo cuenta por pantalla.
//
// Las mesas de ETF que ya existen se estudian con SU universo
// (mesasIniciales), no con otro parecido: el 30-sep-2026 la nota de Reversión
// ETF (SPY y QQQ) enseñaba el estudio de SPY, QQQ, IWM y DIA (revisión H).
// Cada candidata recibe los ensayos de las anteriores (ensayosPrevios y
// sharpesPrevios): hasta la revisión del 30-sep-2026 iban dentro de un
// comentario y cada una se deflactaba como si fuera la primera.
//
// Sesgo de supervivencia: la cesta de acciones es la de las 20 mayores del
// S&P 500 a principios de 2016 (no las de hoy, que ya sabemos que ganaron).
// Las que dejaron de cotizar o cambiaron de ticker salen en «sin datos».

const fs = require('fs');
const path = require('path');
const { crearConfig, leerArgs, RAIZ, LIMITES_DUROS } = require('../src/config');
const { FAMILIAS, mesasIniciales, exposicionMaximaEstudio } = require('../src/estrategias');
const { evaluarHipotesis } = require('../src/cuant/laboratorio');
const { backtest, compraYMantener, costesPorDefecto } = require('../src/backtest/motor');
const formato = require('../src/util/formato');

const DIA = 86_400_000;
const PESO = 0.25;   // PESO_HIPOTESIS del laboratorio
// «completo» (todo el periodo, parámetros por defecto) corre con los límites
// por defecto del motor: los duros.
const LIMITES_ESTUDIO = LIMITES_DUROS;

// Las mesas de ETF tal y como están (su familia y su universo).
const MESAS_ETF = Object.fromEntries(mesasIniciales({ hayAlpaca: true }).filter(m => /-etf$/.test(m.id)).map(m => [m.id, m]));

// Candidatas: familias del catálogo (gramática cerrada), marco diario. Las que
// llevan `mesaId` son las mesas de verdad: su estudio es el de ESTUDIOS_ETF.
const CANDIDATAS = [
  { id: 'etf-actual', mesaId: 'momentum-etf', nombre: 'Momentum ETF (la de hoy + DIA)', familia: MESAS_ETF['momentum-etf'].familia, universo: [...MESAS_ETF['momentum-etf'].universo], grupo: 'Índices' },
  { id: 'reversion-etf', mesaId: 'reversion-etf', nombre: 'Reversión ETF (la de hoy)', familia: MESAS_ETF['reversion-etf'].familia, universo: [...MESAS_ETF['reversion-etf'].universo], grupo: 'Índices' },
  { id: 'reversion-indices', nombre: 'Reversión en índices', familia: 'reversion-rsi', universo: ['SPY', 'QQQ', 'IWM', 'DIA'], grupo: 'Índices' },
  { id: 'bonos', nombre: 'Bonos', familia: 'momentum-rotacion', universo: ['TLT', 'IEF', 'SHY', 'TIP', 'LQD', 'HYG'], grupo: 'Bonos' },
  { id: 'multiactivo', nombre: 'Multiactivo (bolsa, bonos, oro, materias primas)', familia: 'momentum-rotacion', universo: ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'IEF', 'GLD', 'DBC', 'VNQ'], grupo: 'Multiactivo' },
  { id: 'materias-primas', nombre: 'Materias primas', familia: 'momentum-rotacion', universo: ['GLD', 'SLV', 'USO', 'DBC', 'DBA'], grupo: 'Materias primas' },
  { id: 'sectores', nombre: 'Sectores de EE. UU.', familia: 'momentum-rotacion', universo: ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB'], grupo: 'Acciones' },
  { id: 'acciones-2016', nombre: 'Acciones grandes (las 20 mayores de 2016)', familia: 'momentum-rotacion',
    universo: ['AAPL', 'GOOGL', 'MSFT', 'XOM', 'BRK.B', 'AMZN', 'META', 'JNJ', 'JPM', 'GE', 'WFC', 'T', 'PG', 'CVX', 'VZ', 'PFE', 'KO', 'HD', 'INTC', 'MRK'], grupo: 'Acciones' },
];

function isoDia(t) { return new Date(t).toISOString().slice(0, 10); }

async function pedirJSON(url, cabeceras, pedir = fetch) {
  for (let intento = 0; intento < 6; intento++) {
    const r = await pedir(url, { headers: cabeceras });
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 1000 * 2 ** intento)); continue; }
    const texto = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${texto.slice(0, 160)}`);
    return JSON.parse(texto);
  }
  throw new Error('demasiados reintentos');
}

// Diarias ajustadas (dividendos y splits) desde `desde`, feed SIP hasta hace 20 min.
async function velasAccion(simbolo, { desde, claves, carpeta, pedir }) {
  const ruta = path.join(carpeta, `${simbolo.replace(/[^A-Z0-9]/g, '_')}_1Day.json`);
  try { const c = JSON.parse(fs.readFileSync(ruta, 'utf8')); if (Date.now() - c.descargado < 12 * 3600e3) return c.velas; } catch (_) { /* sin caché */ }
  const cab = { 'APCA-API-KEY-ID': claves.claveId, 'APCA-API-SECRET-KEY': claves.secreto };
  const velas = [];
  let token = null;
  do {
    const u = new URL('https://data.alpaca.markets/v2/stocks/bars');
    u.searchParams.set('symbols', simbolo); u.searchParams.set('timeframe', '1Day'); u.searchParams.set('start', desde);
    u.searchParams.set('end', new Date(Date.now() - 20 * 60e3).toISOString()); u.searchParams.set('limit', '10000');
    u.searchParams.set('adjustment', 'all'); u.searchParams.set('feed', 'sip'); u.searchParams.set('sort', 'asc');
    if (token) u.searchParams.set('page_token', token);
    const j = await pedirJSON(u, cab, pedir);
    for (const b of (j.bars && j.bars[simbolo]) || []) velas.push({ t: Date.parse(b.t), o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v });
    token = j.next_page_token || null;
  } while (token);
  // La vela de hoy puede estar a medias: solo cerradas (su día ya terminó en Nueva York).
  const hoy = isoDia(Date.now() - 5 * 3600e3);
  const cerradas = velas.filter(v => isoDia(v.t + 5 * 3600e3) < hoy);
  fs.writeFileSync(ruta, JSON.stringify({ descargado: Date.now(), simbolo, velas: cerradas }));
  return cerradas;
}

async function velasCripto(simbolo, { desde, carpeta, pedir }) {
  const ruta = path.join(carpeta, `${simbolo.replace('/', '')}_1Day.json`);
  try { const c = JSON.parse(fs.readFileSync(ruta, 'utf8')); if (Date.now() - c.descargado < 12 * 3600e3) return c.velas; } catch (_) { /* sin caché */ }
  const velas = [];
  let token = null;
  do {
    const u = new URL('https://data.alpaca.markets/v1beta3/crypto/us/bars');
    u.searchParams.set('symbols', simbolo); u.searchParams.set('timeframe', '1Day'); u.searchParams.set('start', desde);
    u.searchParams.set('limit', '10000'); u.searchParams.set('sort', 'asc');
    if (token) u.searchParams.set('page_token', token);
    const j = await pedirJSON(u, {}, pedir);
    for (const b of (j.bars && j.bars[simbolo]) || []) velas.push({ t: Date.parse(b.t), o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v });
    token = j.next_page_token || null;
  } while (token);
  const cerradas = velas.filter(v => v.t + DIA <= Date.now());
  fs.writeFileSync(ruta, JSON.stringify({ descargado: Date.now(), simbolo, velas: cerradas }));
  return cerradas;
}

const f2 = x => (x === null || x === undefined || !Number.isFinite(x) ? '—' : formato.numero(x, 2));
const p1 = x => (x === null || x === undefined || !Number.isFinite(x) ? '—' : formato.pct(x, { decimales: 1 }));

// El estudio entero. `pedir` (fetch) y `evaluar` (evaluarHipotesis) se
// pueden cambiar para probarlo sin red (test/cuant-candidatas.test.js).
// Devuelve { fichero, versionado, datos }.
async function estudiar({ config, desde = '2016-01-01', salida, versionado = path.join(RAIZ, 'docs', 'estudios'), pedir = fetch, evaluar = evaluarHipotesis, ahora = Date.now() } = {}) {
  const cache = path.join(salida, 'cache');
  fs.mkdirSync(cache, { recursive: true });

  // Mesa titular (para la correlación): Momentum cripto, backtest con velas reales.
  const CRIPTO = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD'];
  const vc = {};
  for (const s of CRIPTO) vc[s] = await velasCripto(s, { desde: '2021-01-01', carpeta: cache, pedir });
  const titular = backtest({ velas: vc, estrategia: FAMILIAS['momentum-rotacion'], capital: 100000, costes: costesPorDefecto(), pesoMesa: 0.4 });
  const retornosTitular = { momentum: titular.retornosDiarios };

  const velas = {};
  const sinDatos = {};
  const todos = [...new Set(CANDIDATAS.flatMap(c => c.universo))];
  for (const s of todos) {
    try {
      const v = await velasAccion(s, { desde, claves: config.alpaca, carpeta: cache, pedir });
      if (v.length < 500) sinDatos[s] = `solo ${v.length} velas`; else velas[s] = v;
    } catch (e) { sinDatos[s] = e.message; }
  }
  const universoAmpliado = Object.keys(velas).map(simbolo => ({ simbolo, clase: 'accion' }));

  let ensayos = 0;
  const sharpes = [];
  const resultados = [];
  for (const c of CANDIDATAS) {
    const universo = c.universo.filter(s => velas[s]);
    const faltan = c.universo.filter(s => !velas[s]);
    const h = { id: `estudio-${c.id}`, familia: c.familia, marco: FAMILIAS[c.familia].marco, universo, filtros: [], origen: 'exploracion', motivo: `Estudio de candidatas de bolsa (${c.grupo}), pedido por Eduardo el 30-sep-2026` };
    process.stdout.write(`\n· ${c.nombre}: ${universo.length} activos${faltan.length ? ` (sin datos: ${faltan.join(', ')})` : ''}… `);
    // Los ensayos de las candidatas anteriores cuentan para el Sharpe deflactado de esta.
    const previos = { ensayosPrevios: ensayos, sharpesPrevios: [...sharpes] };
    let r;
    try {
      r = await evaluar(h, {
        cargarVelas: async s => velas[s] || [], contextoHistorico: () => ({}),   // sin filtros: no hace falta régimen ni miedo y codicia
        ...previos,
        retornosMesasActivas: retornosTitular, costes: costesPorDefecto(), limites: config.limites,
        universo: universoAmpliado, pesoMesa: PESO,
      });
    } catch (e) { r = { aprobada: false, criterios: [], informe: `Error: ${e.message}` }; }
    if (r.walkforward) { ensayos += r.walkforward.combinaciones || 0; sharpes.push(...(r.walkforward.sharpesEnsayos || [])); }
    // Contexto: todo el periodo con los parámetros por defecto, frente a comprar y mantener la misma cesta.
    let completo = null;
    try {
      const vv = Object.fromEntries(universo.map(s => [s, velas[s]]));
      const est = FAMILIAS[c.familia];
      const bt = backtest({ velas: vv, estrategia: est, capital: 100000, costes: costesPorDefecto(), pesoMesa: 1 });
      const bh = compraYMantener({ velas: vv, capital: 100000, costes: costesPorDefecto(), periodosAnio: 252 });
      completo = { estrategia: bt.metricas, comprarYMantener: bh.metricas, desde: isoDia(bt.curva[0] ? bt.curva[0].t : Date.now()) };
    } catch (_) { /* sin contexto */ }
    process.stdout.write(r.aprobada ? 'APROBADA' : 'no pasa');
    // Lo más que puede tener invertido a la vez (mesa del 100 %, límites del
    // estudio): la rentabilidad de «completo» se compara con comprar y
    // mantener, que lo tiene todo invertido.
    const exposicionMaxima = exposicionMaximaEstudio(c.familia, universo, LIMITES_ESTUDIO);
    resultados.push({
      ...c, universoUsado: universo, sinDatos: faltan, aprobada: Boolean(r.aprobada), criterios: r.criterios, informe: r.informe, paramsFinales: r.paramsFinales || null,
      completo, exposicionMaxima, ensayosPrevios: previos.ensayosPrevios, sharpesPrevios: previos.sharpesPrevios.length, ensayosAcumulados: ensayos,
    });
  }

  const fecha = isoDia(ahora);
  const fichero = path.join(salida, `candidatas-${fecha}.json`);
  const datos = { fecha, desde, limites: LIMITES_ESTUDIO, sinDatos, titular: { metricas: titular.metricas }, resultados };
  fs.writeFileSync(fichero, JSON.stringify(datos, null, 1));
  // La copia versionada (sin la caché): de ella salen ESTUDIOS_ETF y las notas.
  let copia = null;
  if (versionado) {
    fs.mkdirSync(versionado, { recursive: true });
    copia = path.join(versionado, `candidatas-${fecha}.json`);
    fs.writeFileSync(copia, JSON.stringify(datos, null, 1));
  }
  return { fichero, versionado: copia, datos, ensayos };
}

async function main() {
  const args = leerArgs();
  const config = crearConfig(args);
  if (!config.alpaca.hay) { console.error('Faltan las claves de Alpaca en el .env: sin ellas no hay velas de acciones.'); return 1; }
  const desde = typeof args.desde === 'string' ? args.desde : '2016-01-01';
  const salida = path.resolve(RAIZ, typeof args.salida === 'string' ? args.salida : 'estudios');
  const { fichero, versionado, datos: { resultados, sinDatos }, ensayos } = await estudiar({ config, desde, salida });

  console.log(`\n\n== Resultado (${ensayos} ensayos en total; cada candidata cuenta los de las anteriores para su Sharpe deflactado) ==`);
  for (const r of resultados) {
    console.log(`\n${r.aprobada ? '✓ PASA' : '✗ NO PASA'} · ${r.nombre} [${r.grupo}] · ${r.universoUsado.join(', ')}`);
    if (!(r.criterios || []).length) console.log(`    ${r.informe}`);
    for (const k of r.criterios || []) console.log(`    ${k.ok ? '✓' : '✗'} ${k.nombre}: ${f2(k.valor)} (umbral ${f2(k.umbral)})`);
    if (r.completo) {
      const e = r.completo.estrategia; const b = r.completo.comprarYMantener;
      console.log(`    Todo el periodo desde ${r.completo.desde}: rentab. anual ${p1(e.cagr)} (como mucho ${p1(r.exposicionMaxima)} invertido), Sharpe ${f2(e.sharpe)}, caída ${p1(e.maxDD)} · comprar y mantener (todo invertido): ${p1(b.cagr)}, ${f2(b.sharpe)}, ${p1(b.maxDD)}`);
    console.log(`    Ensayos de las candidatas anteriores: ${r.ensayosPrevios}`);
    }
    if (r.paramsFinales) console.log(`    Parámetros de la última ventana: ${JSON.stringify(r.paramsFinales)}`);
  }
  if (Object.keys(sinDatos).length) console.log(`\nSin datos suficientes: ${Object.entries(sinDatos).map(([s, m]) => `${s} (${m})`).join('; ')}`);
  console.log(`\nGuardado en ${path.relative(RAIZ, fichero)}${versionado ? ` y ${path.relative(RAIZ, versionado)} (versionado)` : ''}`);
  return 0;
}

if (require.main === module) main().then(c => process.exit(c), e => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { CANDIDATAS, MESAS_ETF, estudiar, main };
