'use strict';
// Gráficas propias (web/js/graficas.js) y partes puras de las vistas
// (web/js/vistas.js), en Node: escalas, marcas de los ejes, reducción de
// puntos, apilado, rutas SVG, series del historial, sucesos y textos.

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../web/js/graficas.js');
const V = require('../web/js/vistas.js');
const cifras = require('../web/js/cifras.js');

const HORA = 3600e3;
const DIA = 24 * HORA;

test('escalaLineal: ida y vuelta, y dominio de ancho cero sin dividir por cero', () => {
  const f = G.escalaLineal([0, 10], [100, 200]);
  assert.equal(f(0), 100);
  assert.equal(f(5), 150);
  assert.equal(f.invertir(175), 7.5);
  const g = G.escalaLineal([3, 3], [0, 50]);
  assert.equal(g(3), 25);
});

test('ticksBonitos: números redondos que cubren el rango, y decimales según el paso', () => {
  const t = G.ticksBonitos(97674, 105381, 5);
  assert.deepEqual(t.ticks, [96000, 98000, 100000, 102000, 104000, 106000]);
  assert.ok(t.min <= 97674 && t.max >= 105381);
  const p = G.ticksBonitos(-0.036, 0, 5);
  assert.ok(p.ticks.includes(0) && p.min <= -0.036);
  assert.ok([0.01, 0.005].includes(p.paso), `${p.paso}`);
  assert.equal(G.ticksBonitos(-0.25, 0, 5).paso, 0.05);
  const q = G.ticksBonitos(-0.1, 0.02, 5);
  assert.equal(q.paso, 0.025);
  assert.equal(G.decimalesPaso(q.paso, 100), 1, '2,5 % lleva un decimal: «-7,5 %», no «-8 %»');
  assert.equal(G.decimalesPaso(0.2, 100), 0);
  assert.equal(G.decimalesPaso(2000, 1), 0);
  const plano = G.ticksBonitos(5, 5, 4);
  assert.ok(plano.min < 5 && plano.max > 5, 'un valor constante tiene rango');
});

test('ticksTiempo: horas en punto, medianoches, lunes y días 1 de Madrid', () => {
  const t0 = Date.UTC(2026, 5, 1);            // 02:00 en Madrid (verano)
  const horas = G.ticksTiempo(t0, t0 + DIA, 6);
  for (const k of horas) {
    const p = G.partes(k.t, 'Europe/Madrid');
    assert.equal(p.min, 0);
    assert.equal(p.h % 6, 0, `${k.texto}`);
  }
  assert.ok(horas.some(k => k.texto === '2 jun'), 'la medianoche lleva la fecha');
  const dias = G.ticksTiempo(t0, t0 + 7 * DIA, 8);
  for (const k of dias) { const p = G.partes(k.t, 'Europe/Madrid'); assert.equal(p.h, 0); assert.equal(p.min, 0); }
  const semanas = G.ticksTiempo(t0, t0 + 90 * DIA, 7);
  for (const k of semanas) assert.equal(new Date(k.t + 2 * HORA).getUTCDay(), 1, `${k.texto} es lunes`);
  const meses = G.ticksTiempo(t0, t0 + 400 * DIA, 6);
  for (const k of meses) assert.equal(G.partes(k.t, 'Europe/Madrid').d, 1);
  assert.match(meses[0].texto, /2026/);
  assert.ok(meses.some(k => k.texto === 'ene 2027'), 'enero lleva el año');
  // Invierno: la medianoche de Madrid es a las 23:00 UTC del día anterior.
  const inv = G.ticksTiempo(Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 8), 8);
  assert.equal(new Date(inv[0].t).getUTCHours(), 23);
  assert.deepEqual(G.ticksTiempo(5, 5, 5).length, 1);
});

test('indiceCercano y LTTB: el instante más cercano; picos y valles se quedan', () => {
  const ts = [0, 10, 20, 30];
  assert.equal(G.indiceCercano(ts, 14), 1);
  assert.equal(G.indiceCercano(ts, 16), 2);
  assert.equal(G.indiceCercano(ts, -5), 0);
  assert.equal(G.indiceCercano(ts, 99), 3);
  const xs = Array.from({ length: 3000 }, (_, i) => i);
  const ys = xs.map(i => Math.cos(i / 90) + (i === 1500 ? 50 : 0) - (i === 2100 ? 40 : 0));
  const idx = G.indicesLTTB(xs, ys, 200);
  assert.ok(idx.length <= 200);
  assert.ok(idx.includes(0) && idx.includes(2999) && idx.includes(1500) && idx.includes(2100));
  const r = G.reducirAlineadas(xs, [ys, ys.map(y => -y)], 100, ys, [777]);
  assert.ok(r.ts.includes(777), 'los índices a conservar (sucesos) entran');
  assert.equal(r.series[1][r.ts.indexOf(1500)], -ys[1500], 'las series van alineadas');
});

test('rebasar, desdeInicio y apilar', () => {
  assert.deepEqual(G.rebasar([null, 100, 110, 90]), [null, 0, 0.10000000000000009, -0.09999999999999998]);
  assert.deepEqual(G.desdeInicio([null, 5, 7, 2]), [null, 0, 2, -3]);
  const p = G.apilar([[0.4, 0.4], [0.02, null], [0.58, 0.6]]);
  assert.deepEqual(p[0], [[0, 0.4], [0, 0.4]]);
  assert.deepEqual(p[1], [[0.4, 0.42000000000000004], [0.4, 0.4]]);
  assert.ok(Math.abs(p[2][0][1] - 1) < 1e-12 && Math.abs(p[2][1][1] - 1) < 1e-12, 'suma 100 %');
});

test('rutas SVG: una línea se corta donde no hay dato; áreas cerradas; escalones', () => {
  assert.equal(G.rutaLinea([[0, 0], [1, 1], null, [3, 3], [4, 4]]), 'M0 0L1 1M3 3L4 4');
  assert.equal(G.rutaEscalon([[0, 5], [10, 7], [20, 7]]), 'M0 5H10V7H20V7');
  const a = G.rutaArea([0, 10], [1, 2], [5, 5], false);
  assert.equal(a, 'M0 1L10 2L10 5L0 5Z');
  const e = G.rutaArea([0, 10, 20], [1, 2, 3], [9, 8, 7], true);
  assert.equal(e, 'M0 1H10V2H20V3L20 7V8H10V9H0Z');
});

test('vistas: series del historial alineadas, reparto que suma 1 y variación del periodo', () => {
  const filas = [
    { t: 3 * HORA, patrimonio: 102, sombras: { btc: 110, cesta: 90, sinComite: 101 }, caida: 0, mesas: [{ id: 'momentum', nombre: 'M', peso: 0.4, pnlAcumulado: 2, estado: 'titular' }, { id: 'nueva', nombre: 'N', peso: 0.02, pnlAcumulado: 0, estado: 'incubacion' }] },
    { t: 1 * HORA, patrimonio: 100, sombras: { btc: 100, cesta: 100, sinComite: 100 }, caida: 0, mesas: [{ id: 'momentum', nombre: 'M', peso: 0.4, pnlAcumulado: 0, estado: 'titular' }] },
    { t: 2 * HORA, patrimonio: 99, sombras: null, caida: -0.01, mesas: [{ id: 'momentum', nombre: 'Momentum', peso: 0.4, pnlAcumulado: -1, estado: 'titular' }] },
    null,
  ];
  const s = V.seriesEvolucion(filas);
  assert.deepEqual(s.ts, [HORA, 2 * HORA, 3 * HORA]);
  assert.deepEqual(s.fondo, [100, 99, 102]);
  assert.deepEqual(s.btc, [100, null, 110]);
  assert.deepEqual(s.mesas.map(m => m.id), ['momentum', 'nueva'], 'orden fijo de mesas conocidas, luego las demás');
  assert.deepEqual(s.mesas[1].pnl, [null, null, 0]);
  const rep = V.reparto(s);
  rep.libre.forEach((l, i) => assert.ok(Math.abs(l + rep.capas.reduce((x, c) => x + c.valores[i], 0) - 1) < 1e-12));
  assert.ok(Math.abs(rep.libre[2] - 0.58) < 1e-12);
  assert.deepEqual(V.variacion(s.fondo), { inicio: 100, fin: 102, usd: 2, pct: 0.020000000000000018 });
  assert.equal(V.variacion([null]), null);
  const texto = V.lecturaPeriodo(s, 'la última semana');
  assert.match(texto, /^En la última semana el fondo gana 2,00 \$ \(\+2,00 %\)\./);
  assert.match(texto, /comprar y mantener BTC \+10,00 %; la cesta cripto -10,00 %; las mismas mesas sin comité \+1,00 %/);
  assert.match(texto, /El comité suma 1,00 punto frente a las mismas mesas sin él\./);
  assert.match(V.lecturaPeriodo(V.seriesEvolucion([]), 'todo'), /Todavía no hay historial/);
});

test('vistas: sucesos y tramos sombreados salen del historial y de las decisiones', () => {
  const filas = [
    { t: 0, motivo: 'hora', modoComite: 'NORMAL' },
    { t: 10, motivo: 'comite', modoComite: 'DEFENSIVO' },
    { t: 20, motivo: 'hora', modoComite: 'DEFENSIVO' },
    { t: 30, motivo: 'comite', modoComite: 'NORMAL' },
    { t: 40, motivo: 'hora', modoComite: 'NORMAL' },
    { t: 50, motivo: 'hora', modoComite: 'SOLO_CERRAR' },
    { t: 60, motivo: 'hora', modoComite: 'SOLO_CERRAR' },
  ];
  const dec = [
    { t: 35, tipo: 'kill', resumen: 'Kill.', datos: { manual: true } },
    { t: 45, tipo: 'pausa', resumen: 'Reabre.', datos: { accion: 'reabrir' } },
    { t: 47, tipo: 'ascenso', resumen: 'Asciende X.', datos: {} },
    { t: 48, tipo: 'descarte', resumen: 'Descarta Y.', datos: {} },
    { t: 49, tipo: 'asignacion', resumen: 'Revisión sin cambios.', datos: { contratadas: [] } },
    { t: 55, tipo: 'asignacion', resumen: 'Contrata Z.', datos: { contratadas: [{ mesaId: 'z' }] } },
  ];
  const m = V.marcasDe(filas, dec);
  assert.deepEqual(m.map(x => x.tipo), ['comite', 'comite', 'kill', 'pausa', 'ascenso', 'descarte', 'alta']);
  assert.equal(m.find(x => x.tipo === 'kill').vertical, true);
  assert.match(m[0].texto, /DEFENSIVO/);
  const b = V.bandasDe(filas, dec, 60);
  assert.deepEqual(b.map(x => [x.modo, x.desde, x.hasta]), [['DEFENSIVO', 10, 30], ['SOLO_CERRAR', 50, 60], ['bloqueado', 35, 45]]);
  // Un kill sin reapertura llega hasta el final.
  assert.deepEqual(V.bandasDe([{ t: 0 }, { t: 9 }], [{ t: 5, tipo: 'kill', datos: {} }], 9).map(x => [x.desde, x.hasta]), [[5, 9]]);
});

test('vistas: comités de rutina agrupados, criterios con sus unidades y datos legibles', () => {
  const com = (t, modo, ant) => ({ t, tipo: 'comite', datos: { modo, modoAnterior: ant, vetos: [] } });
  const g = V.agruparRutina([com(4e7, 'NORMAL', 'NORMAL'), com(3e7, 'NORMAL', 'NORMAL'), { t: 2e7, tipo: 'orden', datos: {} }, com(1e7, 'DEFENSIVO', 'NORMAL')]);
  assert.equal(g.length, 3);
  assert.equal(g[0].grupo, true);
  assert.equal(g[0].items.length, 2);
  assert.equal(g[2].datos.modo, 'DEFENSIVO', 'un cambio de modo nunca se agrupa');
  assert.equal(V.valorCriterio({ nombre: 'maxDD OOS' }, 0.2161), '21,6 %');
  assert.equal(V.valorCriterio({ nombre: 'Sharpe deflactado' }, 0.4248), '42 %');
  assert.equal(V.valorCriterio({ nombre: 'Ventanas de prueba en positivo' }, 0.6), '60 %');
  assert.equal(V.valorCriterio({ nombre: 'Sharpe OOS' }, 0.5269), '0,53');
  assert.equal(V.valorCriterio({ nombre: 'Operaciones OOS' }, 83), '83');
  assert.equal(V.valorCriterio({ nombre: 'Correlación con mesas activas' }, null), '—');
  assert.equal(V.detalleCriterio({ nombre: 'Ventanas de prueba en positivo', positivas: 3, total: 5 }), '3 de 5 tramos ganan');
  assert.equal(V.detalleCriterio({ nombre: 'maxDD OOS', referencia: 0.2124, fuenteReferencia: 'mesa tendencia' }), 'referencia 21,2 % (mesa tendencia)');
  assert.equal(V.detalleCriterio({ nombre: 'Correlación con mesas activas', valor: null, mesa: null }), 'sin mesa activa con la que compararla');
  assert.equal(V.textoValor(6058.1), '6.058');
  assert.equal(V.textoValor(18.0263), '18,03');
  assert.equal(V.textoValor(0.0125), '0,0125');
  assert.equal(V.textoValor(['señal', 'puesto 2 de 6']), 'señal, puesto 2 de 6');
  assert.equal(V.textoValor([{ limite: 'x', valor: 1 }]), 'limite: x · valor: 1');
  assert.equal(V.textoValor(null), '—');
  assert.equal(V.textoValor(true), 'sí');
  for (const k of Object.keys(V.PUERTAS)) assert.doesNotMatch(V.PUERTAS[k], /\d/, `${k}: el texto fijo no lleva cifras`);
});

test('vistas: quién decidió, colores fijos por mesa y textos sin noticias', () => {
  const inst = { agentes: [{ id: 'cio', nombre: 'Carmen Aguirre', rol: 'Presidenta del comité', departamento: 'direccion' }] };
  assert.equal(V.quienEs('cio', inst).nombre, 'Carmen Aguirre');
  assert.equal(V.quienEs('humano', inst).nombre, 'Tú, desde el panel');
  assert.equal(V.quienEs('fantasma', inst).nombre, 'fantasma');
  assert.equal(V.colorMesa('momentum'), G.PALETA[0]);
  assert.equal(V.colorMesa('tendencia'), G.PALETA[1]);
  assert.equal(V.colorMesa('lab-1'), V.colorMesa('lab-1'), 'la misma mesa, el mismo color');
  assert.match(V.textoSinNoticias({ modo: 'sintetico' }, {}), /sintético/);
  assert.match(V.textoSinNoticias({ modo: 'alpaca' }, {}), /cada hora/);
  assert.match(V.textoSinNoticias({ modo: 'simulado' }, {}), /ALPACA_API_KEY_ID/);
  assert.match(V.textoSinNoticias({ modo: 'alpaca' }, { simbolo: 'BTC' }), /filtro/);
  assert.equal(typeof cifras.modoComite, 'function');
});

test('estrategias (30-sep-2026): agrupar por plazo o por tipo de activo, filtrar un grupo, y la mezcla de tipos sin repetir mesa', () => {
  const m = (id, plazo, tipos) => ({ id, plazo: { id: plazo, nombre: { horas: 'Cada 4 horas', dia: 'Cada día o semana', mes: 'Cada mes' }[plazo] },
    tipos: tipos.map(t => ({ id: t, nombre: { cripto: 'Cripto', indices: 'Índices', bonos: 'Bonos', materias: 'Materias primas' }[t] })) });
  const mesas = [m('momentum', 'dia', ['cripto']), m('momentum-etf', 'mes', ['indices', 'bonos', 'materias']), m('reversion-etf', 'dia', ['indices']), m('tendencia', 'horas', ['cripto'])];
  const grupos = { plazos: [{ id: 'horas' }, { id: 'dia' }, { id: 'mes' }], tipos: [{ id: 'cripto' }, { id: 'indices' }, { id: 'bonos' }, { id: 'materias' }] };
  const ver = (por, f) => V.agruparMesas(mesas, grupos, por, f).map(g => [g.nombre, g.mesas.map(x => x.id)]);
  assert.deepEqual(ver('estado'), [[null, ['momentum', 'momentum-etf', 'reversion-etf', 'tendencia']]], 'por estado: el orden del servidor, sin rótulos');
  assert.deepEqual(ver('plazo'), [['Cada 4 horas', ['tendencia']], ['Cada día o semana', ['momentum', 'reversion-etf']], ['Cada mes', ['momentum-etf']]]);
  assert.deepEqual(ver('tipo'), [['Cripto', ['momentum', 'tendencia']], ['Índices', ['reversion-etf']], ['Índices, bonos y materias primas', ['momentum-etf']]]);
  assert.deepEqual(ver('tipo', 'bonos'), [['Índices, bonos y materias primas', ['momentum-etf']]], 'filtrar por un tipo trae las que lo operan');
  assert.deepEqual(ver('tipo', 'indices'), [['Índices', ['reversion-etf']], ['Índices, bonos y materias primas', ['momentum-etf']]]);
  assert.deepEqual(ver('plazo', 'dia'), [['Cada día o semana', ['momentum', 'reversion-etf']]]);
  const todas = V.agruparMesas(mesas, grupos, 'tipo', null).flatMap(g => g.mesas.map(x => x.id));
  assert.equal(new Set(todas).size, todas.length, 'ninguna mesa sale dos veces');
});

test('estrategias: el aviso del estudio dice «Suspendió el filtro; sigue en prueba por decisión de Eduardo» con sus cifras y umbrales', () => {
  const e = JSON.parse(JSON.stringify(require('../src/estrategias').ESTUDIOS_ETF['momentum-etf']));
  const x = V.textoEstudio(e);
  assert.equal(x.titular, 'Suspendió el filtro; sigue en prueba por decisión de Eduardo.');
  assert.equal(x.suspendida, true);
  assert.deepEqual(x.filas.map(f => [f.valor, f.umbral, f.ok]), [['0,19', 'mín. 0,6', false], ['69 %', 'mín. 75 %', false], ['0,48', 'mín. 0,90', false]]);
  assert.equal(x.comparacion, 'En 10 años: 2,1 % al año con como mucho el 20 % invertido; comprar y mantener, con todo invertido, 13,3 %. No se comparan tal cual.');
  assert.match(x.contexto, /con 10 años de datos reales de SPY, QQQ, IWM, TLT, GLD y DIA\. Eduardo la mantiene para verla en vivo\.$/);
  assert.equal(x.otraCartera, false);
  assert.equal(V.textoEstudio(e, ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'DIA']).otraCartera, false, 'con el mismo universo, su estudio');
  assert.equal(V.textoEstudio(null), null, 'sin estudio, sin aviso');
  // Con los Sharpe de las dos (la salida siguiente del estudio), se comparan los Sharpe.
  const conSharpe = V.textoEstudio({ ...e, cifras: { ...e.cifras, sharpeCompleto: 0.21, comprarYMantenerSharpe: 0.84 } });
  assert.equal(conSharpe.comparacion, 'En 10 años, rentabilidad por unidad de riesgo (Sharpe): 0,21; comprar y mantener, 0,84. Al año: 2,1 % con como mucho el 20 % invertido, frente a 13,3 % con todo invertido.');
});

test('estrategias: un estudio de otra cartera no se enseña como el de la mesa (Reversión ETF: SPY y QQQ; estudio de SPY, QQQ, IWM y DIA)', () => {
  const e = JSON.parse(JSON.stringify(require('../src/estrategias').ESTUDIOS_ETF['reversion-etf']));
  const x = V.textoEstudio(e, ['SPY', 'QQQ']);
  assert.equal(x.otraCartera, true);
  assert.equal(x.suspendida, true);
  assert.equal(x.titular, 'Su cartera (SPY y QQQ) aún no se ha estudiado; sigue en prueba por decisión de Eduardo.');
  assert.match(x.contexto, /fue de otra cartera, Reversión en índices, de SPY, QQQ, IWM y DIA, y suspendió el filtro\. Estas son sus cifras, no las de esta mesa\./);
  assert.equal(x.filas[2].nota, 'sin contar las pruebas del estudio anterior: puede ser más bajo', 'el deflactado lleva su aviso');
  assert.match(x.comparacion, /0,3 % al año con como mucho el 40 % invertido; comprar y mantener, con todo invertido, 15,3 %/);
});
