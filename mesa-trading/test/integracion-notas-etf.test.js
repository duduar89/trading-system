'use strict';
// Notas de las mesas de ETF (30-sep-2026): con 10 años de datos reales
// suspendieron el filtro y Eduardo decidió que sigan en prueba al 2 %. Un
// fondo que ya existía cambia la nota vieja por la nueva al arrancar, con su
// estudio, una línea de decisión de Eduardo por mesa y un mensaje en el feed.
// Idempotente: otro arranque no repite nada; una nota distinta no se pisa;
// peso y estado no se tocan. Y /api/estrategias lo enseña (estudio, plazo,
// tipos, el hito «estudio»).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { crearOrquestador, carpetaTemporal } = require('./integracion-ayuda');
const { NOTA_ETF_ANTERIOR, NOTAS_INICIALES } = require('../src/estrategias');
const { leerJSONL } = require('../src/util/almacen');
const { estrategias } = require('../src/informes/estrategias');

const mesaEtf = (id, nombre, familia, universo, t, nota) => ({
  id, nombre, familia, marco: '1Day', universo, params: {}, filtros: [], estado: 'incubacion', origen: 'inicial', nota, peso: 0.02,
  fechaAlta: t, capitalBase: 2000, flujoPendiente: 0, curvaDiaria: [], metricas: null, backtest: null,
});

test('un fondo con las notas de antes del estudio las cambia una sola vez, sin tocar peso ni estado', async () => {
  const carpeta = carpetaTemporal();
  const a = await crearOrquestador({ carpeta });
  const t = a.reloj.ahora();
  a.orquestador.estado.mesas.push(
    mesaEtf('momentum-etf', 'Momentum ETF', 'momentum-rotacion', ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'DIA'], t, NOTA_ETF_ANTERIOR),
    mesaEtf('reversion-etf', 'Reversión ETF', 'reversion-rsi', ['SPY', 'QQQ'], t, NOTA_ETF_ANTERIOR),
  );
  a.orquestador.guardar();
  await a.orquestador.detener();

  const b = await crearOrquestador({ carpeta });
  const o = b.orquestador;
  for (const id of ['momentum-etf', 'reversion-etf']) {
    const m = o.mesaPorId(id);
    assert.equal(m.nota, NOTAS_INICIALES[id], `${id}: nota nueva`);
    assert.equal(m.estudio.aprobada, false);
    assert.equal(m.estudio.decision.quien, 'Eduardo');
    assert.equal(m.estado, 'incubacion', 'sigue en prueba');
    assert.equal(m.peso, 0.02, 'con el 2 %');
  }
  assert.ok(Number.isFinite(o.estado.migraciones.notasEtf));
  const decisiones = leerJSONL(path.join(carpeta, 'decisiones.jsonl')).filter(d => d.datos && d.datos.migracion === 'notas-etf-2026-09-30');
  assert.deepEqual(decisiones.map(d => [d.tipo, d.quien, d.datos.mesaId]), [['asignacion', 'humano', 'momentum-etf'], ['asignacion', 'humano', 'reversion-etf']]);
  assert.match(decisiones[0].resumen, /^Momentum ETF sigue en prueba con el 2 % por decisión de Eduardo, aunque suspendió el filtro\./);
  const avisos = o.bus.ultimos(500).filter(m => m.datos && m.datos.migracion === 'notas-etf-2026-09-30');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].texto, /^Momentum ETF y Reversión ETF: con 10 años de datos reales suspenden el filtro del laboratorio\. Por decisión de Eduardo siguen en prueba con el 2 %, para verlas en vivo\.$/);

  // La instantánea y /api/estrategias llevan el estudio; la vista agrupa por plazo y tipo.
  const inst = o.instantanea();
  assert.equal(inst.mesas.find(m => m.id === 'momentum-etf').estudio.cifras.sharpeFueraDeMuestra, 0.19);
  assert.equal(inst.mesas.find(m => m.id === 'momentum').estudio, null);
  const r = estrategias({ instantanea: inst, carpeta });
  const etf = r.mesas.find(m => m.id === 'momentum-etf');
  assert.deepEqual(etf.plazo, { id: 'mes', nombre: 'Cada mes' });
  assert.deepEqual(etf.tipos.map(x => x.id), ['indices', 'bonos', 'materias']);
  assert.equal(etf.estudio.aprobada, false);
  assert.deepEqual(etf.hitos.map(h => h.tipo), ['estudio'], 'la decisión de Eduardo es un hito «estudio», no un alta');
  assert.deepEqual(r.grupos.plazos.map(p => [p.id, p.mesas]), [['horas', 1], ['dia', 4], ['mes', 1]]);
  assert.deepEqual(r.grupos.tipos.map(p => [p.id, p.mesas]), [['cripto', 4], ['indices', 2], ['bonos', 1], ['materias', 1]]);
  await o.detener();

  // Otro arranque: nada se repite.
  const c = await crearOrquestador({ carpeta });
  assert.equal(leerJSONL(path.join(carpeta, 'decisiones.jsonl')).filter(d => d.datos && d.datos.migracion === 'notas-etf-2026-09-30').length, 2);
  assert.equal(c.orquestador.bus.ultimos(500).filter(m => m.datos && m.datos.migracion === 'notas-etf-2026-09-30').length, 1);
  await c.orquestador.detener();
});

test('una nota distinta (puesta a mano o de otra decisión) no se pisa, y sin mesas de ETF no pasa nada', async () => {
  const carpeta = carpetaTemporal();
  const a = await crearOrquestador({ carpeta });
  const t = a.reloj.ahora();
  a.orquestador.estado.mesas.push(mesaEtf('momentum-etf', 'Momentum ETF', 'momentum-rotacion', ['SPY', 'QQQ'], t, 'Nota escrita por Eduardo.'));
  a.orquestador.guardar();
  await a.orquestador.detener();
  const b = await crearOrquestador({ carpeta });
  assert.equal(b.orquestador.mesaPorId('momentum-etf').nota, 'Nota escrita por Eduardo.');
  assert.equal(b.orquestador.mesaPorId('momentum-etf').estudio, undefined);
  assert.equal(b.orquestador.estado.migraciones.notasEtf, undefined);
  assert.ok(!fs.existsSync(path.join(carpeta, 'decisiones.jsonl'))
    || leerJSONL(path.join(carpeta, 'decisiones.jsonl')).every(d => !d.datos || d.datos.migracion !== 'notas-etf-2026-09-30'));
  await b.orquestador.detener();
});

test('revisión del 30-sep-2026: un fondo con las notas de ETF de ese día las cambia por las corregidas, una vez y como hito «estudio»', async () => {
  const { NOTAS_ETF_SUPERADAS, NOTAS_SUPERADAS, ESTUDIOS_ETF, CRIPTO_TITULAR } = require('../src/estrategias');
  const carpeta = carpetaTemporal();
  const a = await crearOrquestador({ carpeta });
  const t = a.reloj.ahora();
  // Como en producción: las notas y los estudios que dejó la migración del 30-sep.
  const viejo = id => { const x = JSON.parse(JSON.stringify(ESTUDIOS_ETF[id])); delete x.exposicionMaxima; delete x.avisos; delete x.nombre; return x; };
  a.orquestador.estado.mesas.push(
    { ...mesaEtf('momentum-etf', 'Momentum ETF', 'momentum-rotacion', ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'DIA'], t, NOTAS_ETF_SUPERADAS['momentum-etf'][0]), estudio: viejo('momentum-etf') },
    { ...mesaEtf('reversion-etf', 'Reversión ETF', 'reversion-rsi', ['SPY', 'QQQ'], t, NOTAS_ETF_SUPERADAS['reversion-etf'][0]), estudio: viejo('reversion-etf') },
    // La ampliada con la nota sin estudio guardado (en sintético, con las 6 que hay).
    mesaEtf('momentum-ampliada', 'Momentum cripto ampliada', 'momentum-rotacion', [...CRIPTO_TITULAR], t, NOTAS_SUPERADAS['momentum-ampliada'][0]),
  );
  a.orquestador.estado.migraciones.notasEtf = t;
  a.orquestador.guardar();
  await a.orquestador.detener();

  const b = await crearOrquestador({ carpeta });
  const o = b.orquestador;
  for (const id of ['momentum-etf', 'reversion-etf']) {
    const m = o.mesaPorId(id);
    assert.equal(m.nota, NOTAS_INICIALES[id], `${id}: nota corregida`);
    assert.equal(m.estudio.exposicionMaxima, ESTUDIOS_ETF[id].exposicionMaxima, `${id}: el estudio lleva con cuánto invertido`);
    assert.equal(m.estado, 'incubacion');
    assert.equal(m.peso, 0.02);
  }
  assert.match(o.mesaPorId('reversion-etf').nota, /^Su cartera \(SPY y QQQ\) aún no se ha estudiado/);
  const dec = () => leerJSONL(path.join(carpeta, 'decisiones.jsonl')).filter(d => d.datos && d.datos.migracion === 'notas-revision-2026-09-30');
  assert.equal(o.mesaPorId('momentum-ampliada').nota, NOTAS_INICIALES.ampliada, 'la ampliada, con las cifras del estudio guardado');
  assert.equal(o.mesaPorId('momentum-ampliada').estudio, undefined, 'la ampliada no lleva estudio de ETF');
  assert.deepEqual(dec().map(d => [d.tipo, d.quien, d.datos.mesaId]), [['asignacion', 'laboratorio', 'momentum-etf'], ['asignacion', 'laboratorio', 'reversion-etf'], ['asignacion', 'laboratorio', 'momentum-ampliada']]);
  const aviso = o.bus.ultimos(500).filter(m => m.datos && m.datos.migracion === 'notas-revision-2026-09-30');
  assert.equal(aviso.length, 1);
  assert.match(aviso[0].texto, /^He corregido la nota de Momentum ETF, Reversión ETF y Momentum cripto ampliada: /);
  assert.match(aviso[0].texto, /el de Reversión ETF era de otra cartera \(SPY, QQQ, IWM, DIA\)/);
  assert.match(aviso[0].texto, /las cifras de la ampliada salen ahora de un estudio guardado/);
  const r = estrategias({ instantanea: o.instantanea(), carpeta });
  assert.deepEqual(r.mesas.find(m => m.id === 'reversion-etf').hitos.map(h => h.tipo), ['estudio']);
  assert.equal(r.mesas.find(m => m.id === 'reversion-etf').estudio.nombre, 'Reversión en índices');
  await o.detener();
  // Otro arranque: nada se repite.
  const c = await crearOrquestador({ carpeta });
  assert.equal(dec().length, 3);
  await c.orquestador.detener();
});
