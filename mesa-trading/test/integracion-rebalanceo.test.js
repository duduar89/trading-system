'use strict';
// Rebalanceo pedido desde el panel (comando 'rebalancear', 30-sep-2026): la
// mesa de rotación por momentum decide YA con la última vela diaria cerrada y
// el precio de ese momento, en vez de esperar al lunes; una sola vez; también
// en la sombra; y sin que el control de desvío la vete por llevar horas desde
// el cierre.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { crearOrquestador, PASO } = require('./integracion-ayuda');
const { leerJSONL } = require('../src/util/almacen');
const { puestoId, puestoSombraId } = require('../src/agentes/departamentos/comun');

const MARTES = Date.UTC(2026, 5, 2);   // martes 2-jun-2026 00:00 UTC
const HORA = 3_600_000;

async function hastaMiercolesTarde(o, reloj) {
  // Del martes 00:00 al miércoles 17:00 UTC: la mesa decide martes y miércoles, que no son día de rebalanceo.
  const pasos = Math.round((41 * HORA) / PASO);
  for (let k = 0; k < pasos; k++) { reloj.avanzar(PASO); await o.paso(); }
}

const abiertos = (o, mesa, sombra = false) => mesa.universo.filter(s => {
  const p = o.libros.puesto(sombra ? puestoSombraId(mesa.id, s) : puestoId(mesa.id, s));
  return p && p.cantidad > 1e-12;
});

test('sin pedirlo, Momentum no abre nada entre semana; con «rebalancear» abre en el paso siguiente y una sola vez', async () => {
  const a = await crearOrquestador({ inicio: MARTES, semilla: 42 });
  const b = await crearOrquestador({ inicio: MARTES, semilla: 42 });
  try {
    await hastaMiercolesTarde(a.orquestador, a.reloj);
    await hastaMiercolesTarde(b.orquestador, b.reloj);
    const mesaA = a.orquestador.estado.mesas.find(m => m.id === 'momentum');
    const mesaB = b.orquestador.estado.mesas.find(m => m.id === 'momentum');
    assert.deepEqual(abiertos(a.orquestador, mesaA), [], 'entre semana no abre');
    assert.deepEqual(abiertos(b.orquestador, mesaB), []);

    const r = await b.orquestador.comando('rebalancear', { mesa: 'momentum' });
    assert.equal(r.ok, true, r.mensaje);
    assert.ok(mesaB.rebalanceoYa, 'queda pedido en la mesa (en el estado: vale para el modo latido)');
    const r2 = await b.orquestador.comando('rebalancear', { mesa: 'momentum' });
    assert.match(r2.mensaje, /Ya estaba pedido/);

    a.reloj.avanzar(PASO); await a.orquestador.paso();
    b.reloj.avanzar(PASO); await b.orquestador.paso();
    assert.equal(mesaB.rebalanceoYa, undefined, 'la marca se quita al hacerlo');
    const reales = abiertos(b.orquestador, mesaB);
    const sombra = abiertos(b.orquestador, mesaB, true);
    assert.ok(reales.length >= 1 && reales.length <= 2, `abre el top 2 con rentabilidad > 0: ${reales}`);
    assert.deepEqual(sombra, reales, 'la sombra hace lo mismo: la comparación sigue siendo justa');
    assert.deepEqual(abiertos(a.orquestador, mesaA), [], 'sin pedirlo, sigue esperando al lunes');

    // El precio de la decisión es el de ahora: ninguna propuesta de Momentum vetada por desvío.
    const msgs = leerJSONL(path.join(b.carpeta, 'mensajes.jsonl'), 5000);
    const desvio = msgs.filter(m => m.tipo === 'veto' && /movido un/.test(m.texto || ''));
    assert.deepEqual(desvio, []);
    const props = msgs.filter(m => m.tipo === 'propuesta' && m.datos && m.datos.mesaId === 'momentum');
    assert.ok(props.length >= reales.length);
    for (const p of props) {
      assert.equal(p.datos.precioDecision, p.datos.precio, 'decide con el precio de ahora');
      assert.ok(p.datos.stop < p.datos.precio, 'stop por debajo del precio');
    }
    // La nota dice lo que de verdad entró (no lo decidido), con cuánto se ha movido desde el cierre.
    const nota = msgs.find(m => m.de === 'cio' && /rebalanceo pedido hecho ya/.test(m.texto || ''));
    assert.ok(nota, 'nota del rebalanceo');
    assert.deepEqual([...nota.datos.entran].sort(), [...reales].sort());
    for (const s of reales) assert.ok(nota.texto.includes(s.split('/')[0]), `la nota nombra ${s}: ${nota.texto}`);
    assert.match(nota.texto, /desde el cierre/);
    assert.ok(!nota.texto.endsWith('…'), 'la nota no sale cortada');
    assert.ok(props.every(p => p.datos.rebalanceoPedido === true), 'las propuestas llevan la marca de pedidas');

    // Una sola vez: en los pasos siguientes (hasta el lunes) no vuelve a abrir ni a cerrar por rebalanceo.
    const ordenesAntes = leerJSONL(path.join(b.carpeta, 'ordenes.jsonl'), 100000).filter(x => x.mesaId === 'momentum').length;
    for (let k = 0; k < Math.round((6 * HORA) / PASO); k++) { b.reloj.avanzar(PASO); await b.orquestador.paso(); }
    const ordenesDespues = leerJSONL(path.join(b.carpeta, 'ordenes.jsonl'), 100000).filter(x => x.mesaId === 'momentum' && x.motivo !== 'stop').length;
    assert.equal(ordenesDespues, ordenesAntes);
  } finally {
    await a.orquestador.detener();
    await b.orquestador.detener();
  }
});

test('rebalancear: solo mesas de rotación, no en el banquillo ni con el fondo parado', async () => {
  const { orquestador: o } = await crearOrquestador({ inicio: MARTES });
  try {
    assert.equal((await o.comando('rebalancear', { mesa: 'no-existe' })).ok, false);
    assert.match((await o.comando('rebalancear', { mesa: 'tendencia' })).mensaje, /no rebalancea/);
    await o.comando('pausar', {});
    assert.match((await o.comando('rebalancear', { mesa: 'momentum' })).mensaje, /Reabrir/);
    assert.equal(o.estado.mesas.find(m => m.id === 'momentum').rebalanceoYa, undefined);
  } finally {
    await o.detener();
  }
});

test('rebalancear: no se repite sobre la misma vela; con el fondo pausado antes del paso se quita con nota', async () => {
  const b = await crearOrquestador({ inicio: MARTES, semilla: 42 });
  try {
    await hastaMiercolesTarde(b.orquestador, b.reloj);
    const mesa = b.orquestador.estado.mesas.find(m => m.id === 'momentum');
    await b.orquestador.comando('rebalancear', { mesa: 'momentum' });
    b.reloj.avanzar(PASO); await b.orquestador.paso();
    const efectivoSombra = b.orquestador.estado.sombra.efectivo;
    const n = leerJSONL(path.join(b.carpeta, 'ordenes.jsonl'), 100000).length;
    assert.ok(Number.isFinite(mesa.rebalanceoVela));
    // Otra vez el mismo día: no se repite.
    assert.equal((await b.orquestador.comando('rebalancear', { mesa: 'momentum' })).ok, true);
    b.reloj.avanzar(PASO); await b.orquestador.paso();
    assert.equal(mesa.rebalanceoYa, undefined);
    assert.equal(leerJSONL(path.join(b.carpeta, 'ordenes.jsonl'), 100000).length, n, 'sin órdenes nuevas');
    assert.equal(b.orquestador.estado.sombra.efectivo, efectivoSombra, 'la sombra no pierde efectivo');
    const msgs = leerJSONL(path.join(b.carpeta, 'mensajes.jsonl'), 5000);
    assert.ok(msgs.some(m => m.de === 'cio' && /ya se rebalanceó/.test(m.texto || '')));
  } finally { await b.orquestador.detener(); }

  const c = await crearOrquestador({ inicio: MARTES, semilla: 42 });
  try {
    await hastaMiercolesTarde(c.orquestador, c.reloj);
    const mesa = c.orquestador.estado.mesas.find(m => m.id === 'momentum');
    await c.orquestador.comando('rebalancear', { mesa: 'momentum' });
    await c.orquestador.comando('pausar', {});
    c.reloj.avanzar(PASO); await c.orquestador.paso();
    assert.equal(mesa.rebalanceoYa, undefined);
    assert.deepEqual(abiertos(c.orquestador, mesa), []);
    const msgs = leerJSONL(path.join(c.carpeta, 'mensajes.jsonl'), 5000);
    assert.ok(msgs.some(m => m.de === 'cio' && /no se hace/.test(m.texto || '')));
    assert.ok(!msgs.some(m => /rebalanceo pedido hecho ya/.test(m.texto || '')));
  } finally { await c.orquestador.detener(); }
});

test('rebalancear: si falta el precio de ahora de una cripto, espera con la marca puesta y lo dice una vez', async () => {
  const b = await crearOrquestador({ inicio: MARTES, semilla: 42 });
  try {
    await hastaMiercolesTarde(b.orquestador, b.reloj);
    const o = b.orquestador;
    const mesa = o.estado.mesas.find(m => m.id === 'momentum');
    await o.comando('rebalancear', { mesa: 'momentum' });
    // Sin precio de DOGE en este paso: se quita tras actualizar precios.
    const original = o._actualizarPrecios.bind(o);
    o._actualizarPrecios = async (...a) => { const r = await original(...a); delete o.vivo.precios['DOGE/USD']; return r; };
    b.reloj.avanzar(PASO); await o.paso();
    b.reloj.avanzar(PASO); await o.paso();
    assert.ok(mesa.rebalanceoYa, 'la marca sigue');
    assert.deepEqual(abiertos(o, mesa), []);
    const avisos = leerJSONL(path.join(b.carpeta, 'mensajes.jsonl'), 5000).filter(m => /espera a tener/.test(m.texto || ''));
    assert.equal(avisos.length, 1, 'un solo aviso');
    o._actualizarPrecios = original;
    b.reloj.avanzar(PASO); await o.paso();
    assert.equal(mesa.rebalanceoYa, undefined);
    assert.ok(abiertos(o, mesa).length >= 1);
  } finally { await b.orquestador.detener(); }
});

test('estrategia: con el rebalanceo pedido entra al precio de ahora con el stop a 3×ATR de ese precio; si ya cayó bajo el stop del cierre, no entra', () => {
  const { FAMILIAS } = require('../src/estrategias');
  const est = FAMILIAS['momentum-rotacion'];
  const DIA = 86_400_000;
  const t0 = Date.UTC(2026, 0, 6);   // martes
  const velas = {};
  for (const [s, paso] of [['BTC/USD', 1.004], ['ETH/USD', 1.003], ['SOL/USD', 0.999]]) {
    let c = 100;
    velas[s] = Array.from({ length: 80 }, (_, k) => { c *= paso * (k % 2 ? 1.01 : 0.99); return { t: t0 + k * DIA, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }; });
  }
  const prep = est.preparar(velas, est.parametrosPorDefecto);
  const i = 79;
  const cierre = velas['BTC/USD'][i].c;
  const normal = est.decidir(prep, { simbolo: 'BTC/USD', i, iAnterior: i - 1, contexto: {} });
  assert.equal(normal.accion, 'nada', 'entre semana no decide');
  const arriba = est.decidir(prep, { simbolo: 'BTC/USD', i, iAnterior: i - 1, contexto: { rebalanceoYa: true, precioAhora: cierre * 1.02 } });
  assert.equal(arriba.accion, 'abrir');
  const base = est.decidir(prep, { simbolo: 'BTC/USD', i, iAnterior: i - 1, contexto: { rebalanceoYa: true } });
  assert.ok(Math.abs((cierre * 1.02 - arriba.stop) - (cierre - base.stop)) < 1e-9, 'misma distancia al precio');
  assert.ok(arriba.estado.includes(require('../src/util/formato').precio(arriba.stop)), 'el texto dice el stop que se usa');
  const hundido = est.decidir(prep, { simbolo: 'BTC/USD', i, iAnterior: i - 1, contexto: { rebalanceoYa: true, precioAhora: base.stop * 0.99 } });
  assert.equal(hundido.accion, 'nada');
  assert.match(hundido.estado, /por debajo de su stop/);
});
