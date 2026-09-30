'use strict';
// /api/estrategias y /api/laboratorio (src/informes): las fichas salen de la
// instantánea y de los registros sin inventar nada, las frases llevan las
// cifras de los datos y las reglas del asignador (sus REGLAS, no copias).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { estrategias, lectura, regla } = require('../src/informes/estrategias');
const { laboratorio } = require('../src/informes/laboratorio');
const informes = require('../src/informes');
const { REGLAS } = require('../src/aprendizaje/asignador');
const f = require('../src/util/formato');

const HORA = 3600e3;
const carpetas = [];
process.on('exit', () => { for (const c of carpetas) { try { fs.rmSync(c, { recursive: true, force: true }); } catch (_) { /* ya no está */ } } });
function carpeta() {
  const c = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-informes-'));
  carpetas.push(c);
  return c;
}
const escribir = (ruta, filas) => fs.writeFileSync(ruta, filas.map(x => JSON.stringify(x)).join('\n') + '\n');

const mesa = (extra = {}) => ({
  id: 'x', nombre: 'Mesa X', familia: 'momentum-rotacion', marco: '1Day', estado: 'incubacion', peso: 0.02, capital: 2000, multiplicador: 1,
  universo: ['BTC'], params: {}, filtros: [], diasActiva: 30, nota: null, explicacion: { queMira: 'mira', cuandoCompra: 'c', cuandoVende: 'v', cuandoNada: 'n', riesgo: 'r', filtros: null },
  metricas: { operaciones: 12, sharpe: 1.2, sharpeAjustado: 0.35, maxDD: 0.08, pnlTotal: 55.5 },
  sharpeBacktest: 0.8, backtest: { sharpe: 0.8, maxDD: 0.2, operaciones: 40, rentabilidad: 0.3, vol: 0.2, dias: 365, t: 1 }, pnlDia: 1,
  ...extra,
});

test('lectura: papel frente al histórico, con las cifras de los datos', () => {
  const sin = lectura(mesa({ sharpeBacktest: null, backtest: null }));
  assert.equal(sin.tipo, 'sin_backtest');
  const pocas = lectura(mesa({ metricas: { operaciones: 3, sharpe: 2.5 }, diasActiva: 90 }));
  assert.equal(pocas.tipo, 'pocas');
  assert.match(pocas.texto, new RegExp(`menos de ${REGLAS.ascensoMinOperaciones} operaciones y ${REGLAS.incubacionDias} días`));
  assert.match(pocas.texto, /3 operaciones cerradas en 90 días/);
  const mejor = lectura(mesa({ diasActiva: 90 }));
  assert.equal(mejor.tipo, 'mejor');
  assert.equal(mejor.texto, 'En papel va mejor que en el histórico: Sharpe 1,20 frente a 0,80, con 12 operaciones en 90 días.');
  const peor = lectura(mesa({ metricas: { operaciones: 30, sharpe: -0.4 }, diasActiva: 90 }));
  assert.equal(peor.tipo, 'peor');
  assert.match(peor.texto, /Sharpe -0,40 frente a 0,80, con 30 operaciones en 90 días/);
});

test('lectura: con las operaciones pero pocos días no hay veredicto (caso de la revisión: 10 operaciones en 4 días)', () => {
  // El Sharpe de papel se anualiza desde retornos diarios: con 4 días es ruido.
  const m = mesa({ estado: 'incubacion', metricas: { sharpe: 5.2, operaciones: 10 }, backtest: { sharpe: 0.4 }, sharpeBacktest: 0.4, diasActiva: 4 });
  const l = lectura(m);
  assert.equal(l.tipo, 'pocas', 'tono neutro: ni verde ni rojo');
  assert.doesNotMatch(l.texto, /va mejor|va peor/);
  assert.match(l.texto, /10 operaciones cerradas en 4 días de papel aún no se puede comparar/);
  assert.match(l.texto, /de momento, 5,20/);
  assert.match(regla(m).texto, /no se juzga hasta los 60/, 'lo mismo que dice la regla de la misma ficha');
  // Una titular: el asignador no mueve su capital con menos de 20 operaciones o 60 días.
  const t = lectura(mesa({ estado: 'titular', metricas: { sharpe: 1.2, operaciones: 15 }, diasActiva: 200 }));
  assert.equal(t.tipo, 'pocas');
  assert.match(t.texto, new RegExp(`menos de ${REGLAS.minOperaciones} operaciones y ${REGLAS.minDias} días`));
  assert.equal(lectura(mesa({ estado: 'titular', metricas: { sharpe: 1.2, operaciones: 25 }, diasActiva: 61 })).tipo, 'mejor');
});

test('regla: incubación, titular y banquillo frente a las REGLAS del asignador', () => {
  const inc = regla(mesa({ diasActiva: 30 }));
  assert.equal(inc.tipo, 'incubacion');
  assert.equal(inc.sharpeNecesario, Math.max(0, 0.8 - REGLAS.ascensoMargenSharpe));
  assert.equal(inc.cumpleDias, false);
  assert.equal(inc.cumpleOperaciones, true);
  assert.equal(inc.cumpleSharpe, true);
  assert.match(inc.texto, new RegExp(`no se juzga hasta los ${REGLAS.incubacionDias}`));
  assert.match(inc.texto, /por encima de 0,00 \(hoy 1,20\)/);
  const tarde = regla(mesa({ diasActiva: 90, sharpeBacktest: 1.5, backtest: { sharpe: 1.5 } }));
  assert.equal(tarde.sharpeNecesario, 0.5);
  assert.match(tarde.texto, /ya la puede juzgar/);
  assert.match(tarde.texto, /Sharpe del histórico \(1,50\) menos 1/);
  const tit = regla(mesa({ estado: 'titular' }));
  assert.equal(tit.tipo, 'titular');
  assert.equal(tit.despidoMaxDD, REGLAS.despidoMaxDD);
  assert.match(tit.texto, new RegExp(`supera el ${f.pct(REGLAS.despidoMaxDD, { decimales: 1 }).replace(/\s/g, '\\s')} \\(hoy 8,0 %\\)`));
  assert.match(tit.texto, /baja de -0,50 \(hoy 0,35 con 12\)/);
  assert.equal(regla(mesa({ estado: 'banquillo' })).tipo, 'banquillo');
});

test('estrategias: fichas de la instantánea, evolución del historial e hitos de las decisiones', () => {
  const c = carpeta();
  const t0 = 1_780_000_000_000;
  const historial = Array.from({ length: 500 }, (_, i) => ({
    t: t0 + i * HORA, motivo: 'hora', patrimonio: 1e5,
    mesas: [
      { id: 'a', nombre: 'A', estado: i < 300 ? 'incubacion' : 'titular', peso: i < 300 ? 0.02 : 0.4, patrimonio: 1, pnlAcumulado: Math.sin(i / 20) * 50 + (i === 222 ? 400 : 0), operaciones: 1 },
      { id: 'b', nombre: 'B', estado: 'incubacion', peso: 0.02, patrimonio: 1, pnlAcumulado: -i, operaciones: 1 },
    ],
  }));
  escribir(path.join(c, 'historial.jsonl'), historial);
  escribir(path.join(c, 'decisiones.jsonl'), [
    { t: t0 + 300 * HORA, tipo: 'ascenso', quien: 'cio', resumen: 'Asciendo A.', datos: { mesaId: 'a' } },
    { t: t0 + 300 * HORA, tipo: 'asignacion', quien: 'cio', resumen: 'Revisión.', datos: { contratadas: [{ mesaId: 'b', mesa: 'B', hipotesisId: 'h1', peso: 0.02 }], cambios: [{ mesaId: 'a', mesa: 'A', de: 0.02, a: 0.4, motivo: 'Asciende.' }] } },
    { t: t0 + 5, tipo: 'orden', quien: 'x', resumen: 'no cuenta', datos: { mesaId: 'a' } },
  ]);
  const inst = {
    ahora: t0 + 500 * HORA, modo: 'sintetico', cabecera: { sinAsignar: { fraccion: 0.58, usd: 58000 } },
    mesas: [mesa({ id: 'b', nombre: 'B' }), mesa({ id: 'a', nombre: 'A', estado: 'titular', peso: 0.4 }), mesa({ id: 'z', nombre: 'Z', estado: 'banquillo', peso: 0 })],
  };
  const r = estrategias({ instantanea: inst, carpeta: c });
  assert.deepEqual(r.mesas.map(m => m.id), ['a', 'b', 'z'], 'titulares, en prueba y banquillo');
  assert.deepEqual(r.resumen, { total: 3, titulares: 1, incubacion: 1, banquillo: 1, sinAsignar: { fraccion: 0.58, usd: 58000 } });
  const a = r.mesas[0];
  assert.equal(a.papel.pnlTotal, 55.5, 'las métricas de papel, las de la instantánea');
  assert.equal(a.backtest.sharpe, 0.8);
  assert.ok(a.evolucion.length <= 130 && a.evolucion.length > 50, `${a.evolucion.length} puntos`);
  assert.ok(a.evolucion.some(p => p.t === t0 + 222 * HORA), 'el pico se queda');
  assert.ok(a.evolucion.some(p => p.t === t0 + 299 * HORA) && a.evolucion.some(p => p.t === t0 + 300 * HORA), 'el cambio de estado y peso se queda');
  assert.deepEqual(a.hitos.map(h => h.tipo), ['ascenso', 'peso']);
  assert.match(a.hitos[1].texto, /^Peso del 2,0 % al 40,0 %\. Asciende\./);
  assert.deepEqual(r.mesas[1].hitos.map(h => h.tipo), ['alta']);
  assert.match(r.mesas[1].hitos[0].texto, /hipótesis h1/);
  assert.deepEqual(r.mesas[2].evolucion, [], 'sin historial, sin evolución');
  // Sin instantánea ni ficheros: vacío, no un error.
  assert.deepEqual(estrategias({ instantanea: null, carpeta: carpeta() }).mesas, []);
});

test('laboratorio: puertas de cada hipótesis, pendientes de la instantánea y contratadas', () => {
  const c = carpeta();
  const crit = (ok) => [
    { nombre: 'Sharpe OOS', valor: 0.7, umbral: 0.6, ok: true, comparacion: '≥' },
    { nombre: 'Sharpe deflactado', valor: ok ? 0.95 : 0.4, umbral: 0.9, ok, ensayos: 48, comparacion: '≥' },
  ];
  const lab = (t, id, aprobada) => ({
    t, tipo: 'laboratorio', quien: 'laboratorio', resumen: `Hipótesis ${id}`,
    datos: { hipotesisId: id, aprobada, descripcion: `desc ${id}`, hipotesis: { familia: 'tendencia-sma', marco: '4Hour', universo: ['BTC/USD'], filtros: [], origen: 'exploracion', motivo: 'm' }, criterios: crit(aprobada), puertasOk: aprobada ? 2 : 1, puertasTotal: 2, walkforward: { ventanas: 5, entrenoMeses: 12, pruebaMeses: 3, combinaciones: 24, suficiente: true }, dsr: aprobada ? 0.95 : 0.4, ensayosPrevios: 24, ensayosTotales: 48, informe: 'inf' },
  });
  escribir(path.join(c, 'decisiones.jsonl'), [
    lab(10, 'h1', false),
    lab(20, 'h2', true),
    { t: 25, tipo: 'orden', quien: 'x', resumen: '', datos: {} },
    { t: 30, tipo: 'asignacion', quien: 'cio', resumen: 'Revisión', datos: { contratadas: [{ mesaId: 'lab-h2', mesa: 'Tendencia lab', hipotesisId: 'h2', peso: 0.02 }], cambios: [] } },
  ]);
  const inst = {
    ahora: 100,
    laboratorio: { ensayosTotales: 48, proximaRevision: 200, hipotesis: [{ id: 'h3', descripcion: 'otra', estado: 'pendiente', criterios: [], t: 90 }, { id: 'h1', estado: 'rechazada', criterios: [], t: 10 }] },
    mesas: [{ id: 'lab-h2', nombre: 'Tendencia lab', estado: 'incubacion', diasActiva: 12, sharpeBacktest: 0.7, metricas: { sharpe: 0.3, operaciones: 4 } }],
  };
  const r = laboratorio({ instantanea: inst, carpeta: c });
  assert.deepEqual(r.hipotesis.map(h => [h.id, h.estado]), [['h3', 'pendiente'], ['h2', 'aprobada'], ['h1', 'rechazada']]);
  assert.deepEqual(r.resumen, { evaluadas: 2, aprobadas: 1, rechazadas: 1, pendientes: 1, contratadas: 1, tasaAprobacion: 0.5 });
  assert.equal(r.ensayosTotales, 48);
  assert.equal(r.proximaRevision, 200);
  assert.deepEqual(r.puertas, [
    { nombre: 'Sharpe OOS', comparacion: '≥', miradas: 2, pasan: 2, fallan: 0 },
    { nombre: 'Sharpe deflactado', comparacion: '≥', miradas: 2, pasan: 1, fallan: 1 },
  ]);
  const h2 = r.hipotesis.find(h => h.id === 'h2');
  assert.equal(h2.criterios[1].ensayos, 48, 'los extras del criterio se conservan');
  assert.deepEqual(h2.contratada, { mesaId: 'lab-h2', mesa: 'Tendencia lab', t: 30 });
  assert.deepEqual(r.contratadas[0], { hipotesisId: 'h2', mesaId: 'lab-h2', mesa: 'Tendencia lab', t: 30, estadoActual: 'incubacion', sharpePapel: 0.3, operaciones: 4, sharpeBacktest: 0.7, diasActiva: 12 });
  const vacio = laboratorio({ instantanea: null, carpeta: carpeta() });
  assert.deepEqual(vacio.hipotesis, []);
  assert.equal(vacio.resumen.tasaAprobacion, null);
});

test('informes.consultar: una fuente desconocida da null y un fallo interno no tumba el servidor', () => {
  assert.equal(informes.consultar('otra', { carpeta: carpeta() }), null);
  const roto = informes.consultar('estrategias', { carpeta: carpeta(), instantanea: () => { throw new Error('mal'); } });
  assert.deepEqual(roto.mesas, []);
  assert.match(roto.error, /mal/);
});

test('caso conocido: una mesa sintética de verdad (30 pasos) cuadra con su instantánea', async () => {
  const { crearOrquestador } = require('./integracion-ayuda');
  const ctx = await crearOrquestador({ pasos: 30 });
  try {
    const inst = ctx.orquestador.instantanea();
    const r = informes.consultar('estrategias', { carpeta: ctx.carpeta, instantanea: () => inst });
    assert.equal(r.mesas.length, inst.mesas.length);
    for (const m of inst.mesas) {
      const x = r.mesas.find(y => y.id === m.id);
      assert.equal(x.peso, m.peso, m.id);
      assert.equal(x.papel.operaciones, m.metricas.operaciones);
      assert.deepEqual(x.explicacion, m.explicacion);
      assert.ok(x.evolucion.length >= 1, `${m.id}: su evolución sale del historial`);
      assert.equal(typeof x.lectura.texto, 'string');
      assert.equal(typeof x.regla.texto, 'string');
    }
    const h = informes.consultar('historial', { carpeta: ctx.carpeta, params: new URLSearchParams({ puntos: '50' }) });
    assert.ok(h.length >= 2 && h.length <= 50);
    const l = informes.consultar('laboratorio', { carpeta: ctx.carpeta, instantanea: () => inst });
    assert.equal(l.ensayosTotales, inst.laboratorio.ensayosTotales);
  } finally {
    await ctx.orquestador.detener();
  }
});
