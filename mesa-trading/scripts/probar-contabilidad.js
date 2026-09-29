'use strict';
// Casos conocidos de la contabilidad del fondo (constructor C): libros por
// puesto, conciliación con el bróker, carteras sombra, métricas de mesa y
// reparto mensual de capital. Cada cifra esperada está calculada a mano y el
// razonamiento va al lado. Imprime OK/FALLO por caso y sale con código 1 si
// alguno falla.
//
//   node scripts/probar-contabilidad.js

const { Libros } = require('../src/cartera/libros');
const { conciliar } = require('../src/cartera/conciliacion');
const { crearBenchmarks, valorarBenchmarks } = require('../src/cartera/benchmarks');
const { metricasMesa } = require('../src/aprendizaje/evaluador');
const { reasignar } = require('../src/aprendizaje/asignador');
const { casiIgual } = require('../src/util/numeros');

let fallos = 0;
function caso(nombre, obtenido, esperado, tol = 1e-9) {
  const ok = typeof esperado === 'number' && typeof obtenido === 'number'
    ? casiIgual(obtenido, esperado, tol, tol)
    : JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (!ok) fallos++;
  const ver = x => (typeof x === 'string' ? x : JSON.stringify(x));
  console.log(`${ok ? 'OK   ' : 'FALLO'}  ${nombre}: ${ver(obtenido)}${ok ? '' : ` (esperado ${ver(esperado)})`}`);
}

// ---------------------------------------------------------------------------
console.log('— Libros: compra, compra, venta parcial, venta total (0,01 BTC dos veces)');
{
  const l = new Libros();
  l.asegurarPuesto({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD' });
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 100000, comision: 2.5, t: 1, stop: 95000 });
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 110000, comision: 2.75, t: 2 });
  // (0,01·100.000 + 0,01·110.000) / 0,02 = 105.000
  caso('coste medio ponderado', l.puesto('tendencia-BTC').costeMedio, 105000);
  const v1 = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.01, precio: 120000, comision: 3, t: 3, motivo: 'señal' }).operacionCerrada;
  // (120.000 − 105.000)·0,01 = 150; − 3 de salida − (2,5 + 2,75)/2 = 2,625 de entrada → 144,375
  caso('realizado venta 0,01 a 120.000 (150 − 3 − 2,625)', v1.pnl, 144.375);
  // riesgo inicial (100.000−95.000)·0,01 + (110.000−95.000)·0,01 = 200; la mitad = 100 → 1,44375 R
  caso('rMultiple de esa venta (144,375 / 100)', v1.rMultiple, 1.44375);
  const v2 = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.01, precio: 90000, comision: 2.25, t: 4, motivo: 'stop' }).operacionCerrada;
  // (90.000 − 105.000)·0,01 = −150; − 2,25 − 2,625 → −154,875
  caso('realizado venta del resto a 90.000 (−150 − 2,25 − 2,625)', v2.pnl, -154.875);
  // Total = caja: pagado 2.105,25, cobrado 2.094,75 → −10,5
  caso('realizado total del puesto = caja neta', l.puesto('tendencia-BTC').realizado, -10.5);
  caso('puesto cerrado', l.puesto('tendencia-BTC').cantidad, 0);

  const copia = new Libros(JSON.parse(JSON.stringify(l.serializar())));
  caso('serializar → reconstruir → mismo estado', JSON.stringify(copia.serializar()) === JSON.stringify(l.serializar()), true);
}

console.log('— Libros: comisión cobrada en el activo (Alpaca) y escalado de conciliación');
{
  const l = new Libros();
  l.asegurarPuesto({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD' });
  // Alpaca: se piden 1.000 $ a 100.000 → filled_qty 0,01, comisión null; en la cuenta aparecen 0,009975.
  l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 0.01, precio: 100000, comision: null, t: 1 });
  const r = conciliar({ posicionesBroker: [{ simbolo: 'BTC/USD', cantidad: 0.009975 }], libros: l });
  caso('conciliación: una acción de escalar BTC', r.acciones.map(a => `${a.tipo} ${a.simbolo}`), ['escalar BTC/USD']);
  caso('conciliación: factor 0,009975/0,01 = 0,9975 (−0,25 % ≤ 1 %)', r.acciones[0].factor, 0.9975, 1e-12);
  caso('conciliación: no es grave', r.grave, false);
  l.escalarSimbolo('BTC/USD', r.acciones[0].factor, 'comisión en el activo');
  caso('cantidad en libros tras escalar', l.puesto('tendencia-BTC').cantidad, 0.009975, 1e-15);
  // Venta de 0,009975 a 110.000: 1.097,25 $ brutos, comisión 0,25 % = 2,743125 → cobra 1.094,506875.
  // Pagó 1.000 → realizado 94,506875 (la comisión de compra, 2,5 $, va dentro).
  const op = l.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'venta', cantidad: 0.009975, precio: 110000, comision: 2.743125, t: 2, motivo: 'señal' }).operacionCerrada;
  caso('realizado = 1.094,506875 − 1.000', op.pnl, 94.506875, 1e-9);
  const g = conciliar({ posicionesBroker: [{ simbolo: 'ETH/USD', cantidad: 0.9 }], libros: (() => {
    const x = new Libros();
    x.asegurarPuesto({ puestoId: 'm-ETH', mesaId: 'm', simbolo: 'ETH/USD' });
    x.aplicarEjecucion({ puestoId: 'm-ETH', lado: 'compra', cantidad: 1, precio: 4000, comision: 0, t: 0 });
    return x;
  })() });
  caso('conciliación: 0,9 frente a 1 ETH (−10 %) es grave', g.grave, true);
}

console.log('— Carteras sombra');
{
  const e = crearBenchmarks({ capital: 100000, preciosIniciales: { 'BTC/USD': 100000, 'ETH/USD': 4000, 'SOL/USD': 200, 'LINK/USD': 20, 'AVAX/USD': 40, 'DOGE/USD': 0.2 } });
  // 100.000 / 100.000 · (1 − 0,0025) = 0,9975 BTC; a 110.000 → 109.725 $ (+9,725 %).
  const btc = valorarBenchmarks(e, { 'BTC/USD': 110000 }).find(b => b.id === 'btc');
  caso('100 % BTC a 110.000', btc.valor, 109725, 1e-6);
  caso('rentabilidad 100 % BTC', btc.rentabilidad, 0.09725, 1e-12);
}

console.log('— Métricas de mesa con penalización de papel 0,1 % por lado');
{
  const ops = [
    { cantidad: 10, entradaPrecio: 100, salidaPrecio: 110, pnl: 100, motivoSalida: 'señal' },  // −2,10 → 97,90
    { cantidad: 10, entradaPrecio: 100, salidaPrecio: 95, pnl: -50, motivoSalida: 'stop' },    // −1,95 → −51,95
    { cantidad: 5, entradaPrecio: 200, salidaPrecio: 204, pnl: 20, motivoSalida: 'kill' },     // −2,02 → 17,98
  ];
  const curva = [100, 101, 99.99, 101.9898].map((valor, i) => ({ dia: `2026-01-0${i + 1}`, valor }));
  const m = metricasMesa({ operaciones: ops, curvaDiaria: curva, penalizacionPapel: 0.001 });
  caso('pnl total neto (97,90 − 51,95 + 17,98)', m.pnlTotal, 63.93);
  caso('factor de beneficio (115,88 / 51,95)', m.factorBeneficio, 115.88 / 51.95);
  caso('adherencia (señal + stop de 3)', m.adherencia, 2 / 3);
  // Sin operaciones fechadas, la curva no se toca: retornos +1 %, −1 %, +2 % → Sharpe 8,338 (√365).
  caso('Sharpe diario anualizado', m.sharpe, 8.338, 1e-3);
  caso('Sharpe ajustado = 8,338·3/33', m.sharpeAjustado, (m.sharpe * 3) / 33);
  const dd = metricasMesa({ curvaDiaria: [100, 120, 90, 130].map((valor, i) => ({ dia: `2026-01-0${i + 1}`, valor })) });
  caso('caída máxima 120 → 90', dd.maxDD, 0.25);
}

console.log('— Reparto mensual de capital');
{
  const tit = (id, vol, sa, peso, extra = {}) => ({ id, estado: 'titular', pesoActual: peso, volHistorica: vol, diasActiva: extra.dias ?? 90, metricas: { operaciones: extra.ops ?? 30, sharpe: sa, sharpeAjustado: sa, maxDD: extra.maxDD ?? 0.1 } });
  const incu = (id, dias, sharpe, ops) => ({ id, estado: 'incubacion', pesoActual: 0.02, volHistorica: 0.4, diasActiva: dias, sharpeBacktest: 1.5, metricas: { operaciones: ops, sharpe, sharpeAjustado: sharpe, maxDD: 0.05 } });

  // base 40/20/20/20; a ×1,5 → objetivo 50 %; 0,7·25 % + 0,3·50 % = 32,5 %; resto 22,5 %.
  let r = reasignar({ mesas: [tit('a', 0.2, 0.5, 0.25), tit('b', 0.4, 0, 0.25), tit('c', 0.4, 0, 0.25), tit('d', 0.4, 0, 0.25)] });
  caso('suavizado: a', r.pesos.a, 0.325);
  caso('suavizado: b', r.pesos.b, 0.225);
  // a ×2 → objetivo 57,14 %; 0,7·40 % + 0,3·57,14 % = 45,1 % → techo 40 %; resto 20 %.
  r = reasignar({ mesas: [tit('a', 0.2, 1, 0.4), tit('b', 0.4, 0, 0.2), tit('c', 0.4, 0, 0.2), tit('d', 0.4, 0, 0.2)] });
  caso('techo 40 %', r.pesos.a, 0.4);
  caso('lo que sobra del techo, al resto', r.pesos.b, 0.2);
  // d vol 1,6 y Sharpe −0,8 → objetivo 4 %; 0,7·5 % + 0,3·4 % = 4,7 % → suelo 5 %.
  r = reasignar({ mesas: [tit('a', 0.4, 0, 0.95 / 3), tit('b', 0.4, 0, 0.95 / 3), tit('c', 0.4, 0, 0.95 / 3), tit('d', 1.6, -0.8, 0.05)] });
  caso('suelo 5 %', r.pesos.d, 0.05);
  // a con 15 operaciones no se mueve.
  r = reasignar({ mesas: [tit('a', 0.4, 0, 0.3, { ops: 15 }), tit('b', 0.2, 0.5, 0.35), tit('c', 0.4, 0, 0.35)] });
  caso('muestra mínima (15 operaciones): sin cambio', r.pesos.a, 0.3);
  // d: −0,6 con 45 operaciones → banquillo; a, b, c a 1/3.
  r = reasignar({ mesas: [tit('a', 0.4, 0, 0.25), tit('b', 0.4, 0, 0.25), tit('c', 0.4, 0, 0.25), tit('d', 0.4, -0.6, 0.25, { ops: 45 })] });
  caso('despido por Sharpe', r.despidos, ['d']);
  caso('lo del despedido se reparte', r.pesos.a, 1 / 3);
  r = reasignar({ mesas: [tit('a', 0.4, 0, 0.5), tit('b', 0.4, 0, 0.5, { ops: 5, dias: 20, maxDD: 0.26 })] });
  caso('despido por caída 26 % > 25 %', r.despidos, ['b']);
  // Una en incubación → 2 %; los tres titulares se reparten el 98 %.
  r = reasignar({ mesas: [tit('a', 0.4, 0, 1 / 3), tit('b', 0.4, 0, 1 / 3), tit('c', 0.4, 0, 1 / 3), incu('n', 30, 0, 3)] });
  caso('incubación 2 %', r.pesos.n, 0.02);
  caso('titulares a 98 %/3', r.pesos.a, 0.98 / 3);
  // 65 días, Sharpe 0,8 > 1,5 − 1, 12 operaciones → asciende y entra al suelo del 5 %.
  r = reasignar({ mesas: [tit('a', 0.4, 0, 0.98 / 3), tit('b', 0.4, 0, 0.98 / 3), tit('c', 0.4, 0, 0.98 / 3), incu('n', 65, 0.8, 12), incu('x', 65, 0.3, 30)] });
  caso('ascenso', r.ascensos, ['n']);
  caso('el ascendido entra al 5 %', r.pesos.n, 0.05);
  caso('descarte (0,3 ≤ 0,5)', r.descartes, ['x']);
}

console.log(fallos ? `\n${fallos} caso(s) FALLAN` : '\nTodos los casos cuadran.');
process.exit(fallos ? 1 : 0);
