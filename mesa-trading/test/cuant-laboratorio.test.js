'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const lab = require('../src/cuant/laboratorio');
const { mesasIniciales } = require('../src/estrategias');
const { regimenEnFecha } = require('../src/mercado/regimen');
const { prng, gauss, T0, DIA, cestaSintetica } = require('./cuant-ayuda');

const UNIVERSO = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD', 'SPY', 'QQQ']
  .map(simbolo => ({ simbolo, etiqueta: simbolo.split('/')[0] }));
const H = Object.freeze({ id: 'h-1', familia: 'reversion-rsi', marco: '1Day', universo: ['BTC/USD', 'ETH/USD'], filtros: [], origen: 'exploracion', motivo: 'prueba' });

test('validarHipotesis: acepta una hipótesis de la gramática', () => {
  assert.deepEqual(lab.validarHipotesis(H, { universo: UNIVERSO }), { ok: true, error: null });
  const conTodo = { ...H, filtros: [{ id: 'regimen-no-riskoff', parametro: null }, { id: 'fg-max', parametro: 80 }], params: { umbral: 5, atrStop: 3.5 } };
  assert.equal(lab.validarHipotesis(conTodo, { universo: UNIVERSO }).ok, true);
});

test('validarHipotesis: rechaza todo lo que se sale de la gramática', () => {
  const casos = [
    [{ ...H, familia: 'martingala' }, /familia desconocida/],
    [{ ...H, marco: '4Hour' }, /marco/],
    [{ ...H, universo: ['BTC/USD', 'XRP/USD'] }, /fuera del universo/],
    [{ ...H, universo: ['BTC/USD', 'SPY'] }, /no se mezclan/],
    [{ ...H, universo: [] }, /universo vacío/],
    [{ ...H, universo: ['BTC/USD', 'BTC/USD'] }, /repetidos/],
    [{ ...H, filtros: [{ id: 'fg-max', parametro: 70 }] }, /no permitido/],
    [{ ...H, filtros: [{ id: 'rsi-magico', parametro: 1 }] }, /desconocido/],
    [{ ...H, filtros: [{ id: 'fg-max', parametro: 80 }, { id: 'fg-max', parametro: 90 }] }, /repetido/],
    [{ ...H, params: { umbral: 12 } }, /fuera del dominio/],
    [{ ...H, params: { atrStop: 7 } }, /fuera del dominio/],
    [{ ...H, params: { inventado: 1 } }, /no existe/],
    [{ ...H, origen: 'llm' }, /origen/],
    [{ ...H, motivo: '' }, /motivo/],
    [{ ...H, id: '' }, /id/],
    [{ ...H, params: [5] }, /params debe ser un objeto/],
  ];
  for (const [h, re] of casos) {
    const r = lab.validarHipotesis(h, { universo: UNIVERSO });
    assert.equal(r.ok, false, JSON.stringify(h));
    assert.match(r.error, re);
  }
});

test('generarHipotesis: mapa cerrado pista → hipótesis', () => {
  const mesas = mesasIniciales({ hayAlpaca: false });
  const hs = lab.generarHipotesis({
    mesas,
    semana: '2026-W40',
    pistas: [
      { mesaId: 'tendencia', categoria: 'contra_regimen', n: 9 },
      { mesaId: 'ruptura', categoria: 'stop_estrecho', n: 7 },
      { mesaId: 'reversion', categoria: 'noticia', n: 20 },      // no genera
      { mesaId: 'momentum', categoria: 'ejecucion', n: 15 },     // no genera
      { mesaId: 'tendencia', categoria: 'señal_falsa', n: 6 },
    ],
  });
  assert.equal(hs.length, 3);
  const [a, b, c] = hs;
  assert.equal(a.mesaId, 'tendencia');
  assert.deepEqual(a.filtros, [{ id: 'regimen-no-riskoff', parametro: null }]);
  assert.equal(a.origen, 'leccion');
  assert.equal(b.mesaId, 'ruptura');
  assert.deepEqual(b.params, { atrStop: 2.5 }); // 2 + 0,5
  assert.equal(c.mesaId, 'tendencia');
  assert.deepEqual(c.params, { rapida: 10, lenta: 40 }); // vecino más lento de 7/25
  for (const h of hs) assert.equal(lab.validarHipotesis(h, { universo: UNIVERSO }).ok, true, h.id);
  assert.equal(new Set(hs.map(h => h.id)).size, 3);
});

test('generarHipotesis: máximo 3, sin repetir, y una exploración si queda hueco', () => {
  const mesas = mesasIniciales({ hayAlpaca: false });
  const muchas = ['tendencia', 'momentum', 'reversion', 'ruptura'].flatMap(m => [
    { mesaId: m, categoria: 'contra_regimen', n: 10 }, { mesaId: m, categoria: 'stop_estrecho', n: 8 },
  ]);
  assert.equal(lab.generarHipotesis({ mesas, pistas: muchas, semana: 'w' }).length, 3);
  // Sin pistas: una sola hipótesis de exploración, determinista por semana.
  const e1 = lab.generarHipotesis({ mesas, pistas: [], semana: '2026-W41' });
  const e2 = lab.generarHipotesis({ mesas, pistas: [], semana: '2026-W41' });
  assert.equal(e1.length, 1);
  assert.equal(e1[0].origen, 'exploracion');
  assert.deepEqual(e1, e2);
  assert.equal(lab.validarHipotesis(e1[0], { universo: UNIVERSO }).ok, true);
  // Si la mesa ya tiene el filtro, contra_regimen no genera nada.
  const conFiltro = mesas.map(m => (m.id === 'tendencia' ? { ...m, filtros: [{ id: 'regimen-no-riskoff', parametro: null }] } : m));
  const r = lab.generarHipotesis({ mesas: conFiltro, pistas: [{ mesaId: 'tendencia', categoria: 'contra_regimen', n: 9 }], semana: 'x' });
  assert.ok(r.every(h => h.origen === 'exploracion'));
});

// Serie con ventaja real fabricada: tendencia alcista con una caída del 4 % cada
// 8 días seguida de dos rebotes del 2,2 %. La reversión RSI(2) la explota.
function conCaidas(n, semilla, desfase) {
  const r = prng(semilla);
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    let c = p * Math.exp(0.0015 + 0.005 * gauss(r));
    const fase = (i + desfase) % 8;
    if (fase === 0) c = p * 0.96; else if (fase === 1 || fase === 2) c = p * 1.022;
    out.push({ t: T0 + i * DIA, o, h: Math.max(o, c) * 1.003, l: Math.min(o, c) * 0.997, c, v: 0 });
    p = c;
  }
  return out;
}

test('evaluarHipotesis: una ventaja real pasa los seis criterios', async () => {
  const velas = { 'BTC/USD': conCaidas(1500, 1, 0), 'ETH/USD': conCaidas(1500, 2, 4) };
  const r = await lab.evaluarHipotesis(H, {
    cargarVelas: async s => velas[s],
    contextoHistorico: t => ({ regimen: regimenEnFecha(velas['BTC/USD'], null, t), fg: null }),
    ensayosPrevios: 20,
    universo: UNIVERSO,
  });
  assert.equal(r.criterios.length, 6);
  for (const c of r.criterios) assert.deepEqual(['nombre', 'valor', 'umbral', 'ok'].filter(k => !(k in c)), []);
  assert.equal(r.aprobada, true, r.informe);
  assert.equal(r.ensayos, 20 + 18);
  assert.ok(r.dsr >= 0.9);
  assert.equal(r.correlacionMax, null);
  assert.ok(r.walkforward.oos.metricas.operaciones >= 30);
  assert.match(r.informe, /APROBADA\.$/);
  assert.match(r.informe, new RegExp(`${r.walkforward.oos.metricas.operaciones} operaciones OOS`));
  assert.ok(r.paramsFinales && typeof r.paramsFinales.umbral === 'number');

  // La misma hipótesis contra una mesa activa idéntica: correlación 1 → rechazada solo por eso.
  const r2 = await lab.evaluarHipotesis(H, {
    cargarVelas: async s => velas[s],
    ensayosPrevios: 20,
    retornosMesasActivas: { reversion: r.walkforward.oos.retornosDiarios },
  });
  const corr = r2.criterios.find(c => c.nombre === 'Correlación con mesas activas');
  assert.ok(corr.valor > 0.99);
  assert.equal(corr.ok, false);
  assert.equal(r2.aprobada, false);
  assert.match(r2.informe, /Correlación máx\. 1,00 con reversion/);
});

test('evaluarHipotesis: sobre ruido no aprueba y el informe dice por qué', async () => {
  const ruido = cestaSintetica(['BTC/USD', 'ETH/USD'], 1500, 3);
  const r = await lab.evaluarHipotesis(H, { cargarVelas: async s => ruido[s], ensayosPrevios: 100, maxDDReferencia: 0.2 });
  assert.equal(r.aprobada, false);
  assert.ok(r.criterios.some(c => !c.ok));
  const dd = r.criterios.find(c => c.nombre === 'maxDD OOS');
  assert.ok(Math.abs(dd.umbral - 0.3) < 1e-12); // 1,5 × 0,2
  assert.equal(dd.fuenteReferencia, 'mesa vigente de la familia');
  assert.match(r.informe, /1,5 × mesa vigente de la familia/);
  assert.match(r.informe, /RECHAZADA\.$/);
  assert.match(r.informe, /NO cumple/);
});

test('evaluarHipotesis: hipótesis inválida → rechazada sin backtest', async () => {
  const r = await lab.evaluarHipotesis({ ...H, familia: 'nada' }, { cargarVelas: async () => { throw new Error('no debería cargar'); } });
  assert.equal(r.aprobada, false);
  assert.equal(r.walkforward, null);
  assert.match(r.informe, /no válida/);
});

test('evaluarHipotesis: sin histórico suficiente → rechazada', async () => {
  const poco = cestaSintetica(['BTC/USD', 'ETH/USD'], 300, 4);
  const r = await lab.evaluarHipotesis(H, { cargarVelas: async s => poco[s] });
  assert.equal(r.aprobada, false);
  assert.match(r.informe, /Sin datos suficientes/);
});

// ---- Sin repetir hipótesis (firma de contenido) y DSR con todos los ensayos ----

test('firmaHipotesis: el contenido, no el id, la semana ni el orden', () => {
  const a = { ...H, id: 'h-2026-06-01-x', filtros: [{ id: 'fg-max', parametro: 80 }, { id: 'regimen-no-riskoff', parametro: null }], params: { umbral: 5, atrStop: 3.5 } };
  const b = { ...a, id: 'h-2026-06-08-x', motivo: 'otro', universo: ['ETH/USD', 'BTC/USD'], filtros: [...a.filtros].reverse(), params: { atrStop: 3.5, umbral: 5 } };
  assert.equal(lab.firmaHipotesis(a), lab.firmaHipotesis(b));
  assert.notEqual(lab.firmaHipotesis(a), lab.firmaHipotesis({ ...a, params: { umbral: 10, atrStop: 3.5 } }));
  assert.notEqual(lab.firmaHipotesis(a), lab.firmaHipotesis({ ...a, filtros: [] }));
  assert.notEqual(lab.firmaHipotesis(a), lab.firmaHipotesis({ ...a, universo: ['BTC/USD'] }));
});

test('generarHipotesis: no repite una hipótesis ya evaluada en los últimos 90 días aunque cambie la semana', () => {
  const mesas = mesasIniciales({ hayAlpaca: false });
  const pistas = [
    { mesaId: 'tendencia', categoria: 'señal_falsa', n: 9 },
    { mesaId: 'ruptura', categoria: 'stop_estrecho', n: 3 },
  ];
  const lunes1 = Date.UTC(2026, 5, 1);
  const s1 = lab.generarHipotesis({ mesas, pistas, semana: '2026-06-01', ahora: lunes1 });
  const tend = s1.find(h => h.mesaId === 'tendencia');
  assert.ok(tend);
  // Entrada del laboratorio tal como la guarda revisionSemanal ({ id, h, t, estado }).
  const previas = s1.map(h => ({ id: h.id, h, t: lunes1, estado: 'rechazada' }));
  const lunes2 = lunes1 + 7 * DIA;
  const s2 = lab.generarHipotesis({ mesas, pistas, semana: '2026-06-08', previas, ahora: lunes2 });
  const firmas1 = new Set(s1.map(lab.firmaHipotesis));
  assert.ok(s2.every(h => !firmas1.has(lab.firmaHipotesis(h))), 'se repitió una hipótesis de la semana anterior');
  assert.ok(s2.length >= 1, 'el hueco lo aprovecha otra (exploración)');
  // Pasados 90 días se puede volver a probar.
  const s3 = lab.generarHipotesis({ mesas, pistas, semana: '2026-09-07', previas, ahora: lunes1 + 91 * DIA });
  assert.ok(s3.some(h => lab.firmaHipotesis(h) === lab.firmaHipotesis(tend)));
  // Una aprobada pendiente de contratar (con su firma) o una mesa contratada de ella también bloquean.
  const aprobada = { ...tend, params: { ...tend.params, atrStop: 3.5 }, firma: lab.firmaHipotesis(tend), t: lunes1 };
  assert.ok(!lab.generarHipotesis({ mesas, pistas, semana: 'x', previas: [aprobada], ahora: lunes2 }).some(h => h.mesaId === 'tendencia' && h.origen === 'leccion'));
  const conLab = [...mesas, { id: 'lab1', familia: tend.familia, marco: tend.marco, universo: tend.universo, estado: 'incubacion', filtros: [], firmaHipotesis: lab.firmaHipotesis(tend) }];
  assert.ok(!lab.generarHipotesis({ mesas: conLab, pistas, semana: 'x', ahora: lunes1 + 200 * DIA }).some(h => lab.firmaHipotesis(h) === lab.firmaHipotesis(tend)));
});

test('generarHipotesis: la lección y la exploración de la misma semana nunca son la misma hipótesis', () => {
  const mesas = mesasIniciales({ hayAlpaca: false });
  const pistas = [{ mesaId: 'tendencia', categoria: 'contra_regimen', n: 5 }];
  let exploracionesDistintas = 0;
  for (let w = 0; w < 120; w++) {
    const hs = lab.generarHipotesis({ mesas, pistas, semana: `2026-S${w}` });
    const firmas = hs.map(lab.firmaHipotesis);
    assert.equal(new Set(firmas).size, firmas.length, `semana ${w}: ${hs.map(h => h.id).join(', ')}`);
    assert.equal(hs.length, 2); // la lección y una exploración que no la repite
    if (hs[1].origen === 'exploracion') exploracionesDistintas++;
  }
  assert.equal(exploracionesDistintas, 120);
});

test('evaluarHipotesis: el DSR usa la varianza de TODOS los ensayos guardados', async () => {
  // Sobre ruido con Sharpe OOS alto por azar (1,24): con solo sus 18 combinaciones el DSR es 0,45.
  const ruido = cestaSintetica(['BTC/USD', 'ETH/USD'], 1500, 3);
  const comunes = { cargarVelas: async s => ruido[s], ensayosPrevios: 200, universo: UNIVERSO };
  const solo = await lab.evaluarHipotesis(H, comunes);
  // Ensayos anteriores muy dispersos: el Sharpe máximo esperado por azar sube y el DSR baja.
  const dispersos = Array.from({ length: 200 }, (_, k) => (k % 2 ? 3 : -3));
  const todos = await lab.evaluarHipotesis(H, { ...comunes, sharpesPrevios: dispersos });
  assert.ok(Number.isFinite(solo.dsr) && Number.isFinite(todos.dsr));
  assert.ok(todos.dsr < solo.dsr - 0.05, `${todos.dsr} no baja frente a ${solo.dsr}`);
  assert.ok(todos.sharpeUmbral > solo.sharpeUmbral);
});

test('evaluarHipotesis: maxDDReferencia puede ser una función del tramo fuera de muestra', async () => {
  const ruido = cestaSintetica(['BTC/USD', 'ETH/USD'], 1500, 3);
  let tramoPedido = null;
  const r = await lab.evaluarHipotesis(H, {
    cargarVelas: async s => ruido[s], ensayosPrevios: 10,
    maxDDReferencia: async tramo => { tramoPedido = tramo; return { valor: 0.2, mesaId: 'reversion' }; },
  });
  const v = r.walkforward.ventanas;
  assert.deepEqual(tramoPedido, { desde: v[0].desde, hasta: v[v.length - 1].hasta });
  const dd = r.criterios.find(c => c.nombre === 'maxDD OOS');
  assert.ok(Math.abs(dd.umbral - 0.3) < 1e-12);
  assert.equal(dd.fuenteReferencia, 'mesa reversion');
  // Si la función no da referencia, comprar y mantener.
  const r2 = await lab.evaluarHipotesis(H, { cargarVelas: async s => ruido[s], ensayosPrevios: 10, maxDDReferencia: () => undefined });
  assert.equal(r2.criterios.find(c => c.nombre === 'maxDD OOS').fuenteReferencia, 'comprar y mantener');
});
