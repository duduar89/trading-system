'use strict';
// Registro de incidentes y semáforo «¿Listo para dinero real?» con el fondo
// entero (§5.8, §6.10, §7): cada incidente del criterio f entra una vez en
// data/incidentes.jsonl desde donde pasa, y la instantánea lo cuenta.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { crearOrquestador, carpetaTemporal, PASO } = require('./integracion-ayuda');
const operaciones = require('../src/agentes/departamentos/operaciones');
const { leerJSONL } = require('../src/util/almacen');

const HORA = 3_600_000;
const incidentes = carpeta => leerJSONL(path.join(carpeta, 'incidentes.jsonl'));
const criterio = (o, id) => o.instantanea().listoParaReal.criterios.find(c => c.id === id);

function comprar(o, puestoId, mesaId, simbolo, nocional) {
  return o.ejecutor.ejecutar({ puestoId, mesaId, simbolo, lado: 'compra', nocional, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: o.reloj.ahora(), stop: 1 });
}

test('fondo nuevo: el registro empieza con el fondo, sin incidentes, y el semáforo lo dice (0 en 0 días de 90)', async () => {
  const { orquestador: o, carpeta } = await crearOrquestador({ pasos: 2 });
  assert.equal(o.estado.incidentesDesde, o.estado.creado);
  assert.equal(o.estado.caidaMaxima >= 0, true);
  assert.deepEqual(incidentes(carpeta), []);
  const f = criterio(o, 'f');
  assert.equal(f.ok, false, 'el registro aún no cubre 90 días');
  assert.equal(f.valor, 0);
  assert.match(f.detalle, /cubre 0 de 90 días/);
  const lr = o.instantanea().listoParaReal;
  assert.equal(lr.listo, false);
  assert.match(lr.nota, /no activa nada/);
  await o.detener();
});

test('kill switch (manual o del vigilante): un incidente «kill» en disco y el criterio f en rojo', async () => {
  const { orquestador: o, carpeta } = await crearOrquestador({ pasos: 2 });
  await comprar(o, 'momentum-BTC', 'momentum', 'BTC/USD', 4000);
  const r = await o.comando('kill', { confirmacion: 'KILL' });
  assert.equal(r.ok, true, r.mensaje);
  assert.deepEqual(incidentes(carpeta).map(x => [x.tipo, x.detalle]), [['kill', 'kill switch manual desde el panel']]);
  const f = criterio(o, 'f');
  assert.equal(f.ok, false);
  assert.equal(f.valor, 1);
  assert.match(f.detalle, /^1 kill switch\. El último, el \d{1,2} \S+ \d{4}: kill switch manual desde el panel$/);
  await o.detener();
});

test('error dentro de un departamento: un incidente por error y hora, como la alerta del canal sistema', async () => {
  const { orquestador: o, reloj, datos, carpeta } = await crearOrquestador({ pasos: 1 });
  const ultimos = datos.ultimos.bind(datos);
  datos.ultimos = async () => { throw new Error('datos caídos'); };
  for (let i = 0; i < 3; i++) { reloj.avanzar(PASO); await o.paso(); }
  const dePrecios = () => incidentes(carpeta).filter(x => x.tipo === 'error_departamento' && x.datos && x.datos.departamento === 'precios');
  assert.equal(dePrecios().length, 1, 'tres latidos con el mismo error: uno');
  assert.equal(dePrecios()[0].detalle, 'Error en precios: datos caídos');
  reloj.avanzar(HORA);
  await o.paso();
  assert.equal(dePrecios().length, 2, 'pasada la hora, se vuelve a apuntar');
  datos.ultimos = ultimos;
  await o.detener();
});

test('conciliación: una posición del bróker sin puesto es orden huérfana; un descuadre grave, conciliación grave; una vez cada situación', async () => {
  // Media hora: las mesas diarias ya han decidido el día (hasta 10 min de espera por vela).
  const { orquestador: o, broker, reloj, carpeta } = await crearOrquestador({ pasos: 6 });
  const enLibros = o.libros.totalesPorSimbolo({ sombra: false });
  const s = ['LINK/USD', 'AVAX/USD', 'DOGE/USD', 'SOL/USD', 'ETH/USD', 'BTC/USD'].find(x => !(enLibros[x] > 0));
  assert.ok(s, 'hay una cripto sin posición del fondo');
  const e = s.split('/')[0];
  const px = o.vivo.precios[s].precio;
  broker.estado.posiciones[s] = { cantidad: 2000 / px, precioMedio: px };
  broker.estado.efectivo -= 2000;
  for (let i = 0; i < 3; i++) { reloj.avanzar(PASO); await o.paso(); }
  const huerfanas = incidentes(carpeta).filter(x => x.tipo === 'orden_huerfana');
  assert.equal(huerfanas.length, 1, 'la misma huérfana en tres latidos: un incidente');
  assert.equal(huerfanas[0].detalle, `Posición en el bróker sin puesto: ${e}.`);
  assert.deepEqual(huerfanas[0].datos, { simbolos: [s] });
  delete broker.estado.posiciones[s];
  broker.estado.efectivo += 2000;
  reloj.avanzar(PASO); await o.paso();

  // Descuadre grave: el bróker tiene la mitad de lo que dicen los libros.
  await comprar(o, 'momentum-BTC', 'momentum', 'BTC/USD', 4000);
  await o.refrescarCartera();
  broker.estado.posiciones['BTC/USD'].cantidad *= 0.5;
  await o.refrescarCartera();
  operaciones.conciliarCadaLatido(o);
  operaciones.conciliarCadaLatido(o);
  const graves = incidentes(carpeta).filter(x => x.tipo === 'conciliacion_grave');
  assert.equal(graves.length, 1);
  assert.match(graves[0].detalle, /Descuadre grave en BTC/);
  assert.equal(graves[0].datos.grave, true);
  assert.equal(criterio(o, 'f').valor, 2);
  await o.detener();
});

test('orden duplicada: el bróker ya tenía otra orden con ese idCliente; un rechazo normal no es incidente', async () => {
  const { orquestador: o, broker, carpeta } = await crearOrquestador({ pasos: 1 });
  const enviar = broker.enviarOrden.bind(broker);
  broker.enviarOrden = async () => { throw broker._rechazo('idCliente mt-x-momentum-BTCUSD ya usado por otra orden (lado venta ≠ compra)', 'invalida', 422); };
  const r = await comprar(o, 'momentum-BTC', 'momentum', 'BTC/USD', 1000);
  assert.equal(r.ok, false);
  broker.enviarOrden = async () => { throw broker._rechazo('insufficient buying power', 'fondos', 403); };
  await comprar(o, 'momentum-ETH', 'momentum', 'ETH/USD', 1000);
  broker.enviarOrden = enviar;
  const lista = incidentes(carpeta);
  assert.deepEqual(lista.map(x => x.tipo), ['orden_duplicada']);
  assert.match(lista[0].detalle, /^Orden de BTC rechazada: .*ya usado por otra orden/);
  await o.detener();
});

test('al reiniciar: el registro y su inicio se conservan; un estado de antes del registro lo empieza al arrancar', async () => {
  const carpeta = carpetaTemporal();
  const a = await crearOrquestador({ carpeta, pasos: 2 });
  const desde = a.orquestador.estado.incidentesDesde;
  await a.orquestador.comando('kill', { confirmacion: 'KILL' });
  await a.orquestador.detener();
  const b = await crearOrquestador({ carpeta });
  assert.equal(b.orquestador.estado.incidentesDesde, desde);
  assert.deepEqual(b.orquestador.incidentes.lista.map(x => x.tipo), ['kill']);
  assert.equal(criterio(b.orquestador, 'f').valor, 1);
  await b.orquestador.detener();

  // estado.json de antes del registro (sin incidentesDesde ni caidaMaxima).
  const ruta = path.join(carpeta, 'estado.json');
  const viejo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  delete viejo.incidentesDesde;
  delete viejo.caidaMaxima;
  viejo.curva = [{ t: 1, patrimonio: 100000 }, { t: 2, patrimonio: 88000 }, { t: 3, patrimonio: 101000 }];
  fs.writeFileSync(ruta, JSON.stringify(viejo));
  const c = await crearOrquestador({ carpeta });
  assert.equal(c.orquestador.estado.incidentesDesde, c.reloj.ahora(), 'el registro empieza ahora');
  assert.ok(Math.abs(c.orquestador.estado.caidaMaxima - 0.12) < 1e-9, `la peor caída sale de las curvas guardadas: ${c.orquestador.estado.caidaMaxima}`);
  await c.orquestador.detener();
});

test('caída máxima vista latido a latido: la guarda el estado y la usa el criterio e', async () => {
  const { orquestador: o } = await crearOrquestador({ pasos: 1 });
  o.estado.pico = o.vivo.patrimonio / 0.78;                // un −22 % desde el máximo
  await o.refrescarCartera();
  assert.ok(Math.abs(o.estado.caidaMaxima - 0.22) < 1e-9);
  o.estado.pico = o.vivo.patrimonio;                       // recuperado: la peor vista no se borra
  await o.refrescarCartera();
  assert.ok(Math.abs(o.estado.caidaMaxima - 0.22) < 1e-9);
  const e = criterio(o, 'e');
  assert.equal(e.ok, false);
  assert.equal(e.valorTexto, '22,0 %');
  await o.detener();
});

test('coste del LLM: el semáforo usa el gasto acumulado de llm-costes.jsonl', async () => {
  const carpeta = carpetaTemporal();
  fs.writeFileSync(path.join(carpeta, 'llm-costes.jsonl'), [0.4, 0.35, 0.25].map((c, k) => JSON.stringify({ t: k + 1, costeUsd: c })).join('\n') + '\n');
  const { crearLLM } = require('../src/agentes/llm');
  const llm = crearLLM({ apiKey: '', reloj: { tipo: 'simulado', ahora: () => 0 }, rutaCostes: path.join(carpeta, 'llm-costes.jsonl') });
  assert.ok(Math.abs(llm.gastoTotal() - 1) < 1e-12);
  const { orquestador: o } = await crearOrquestador({ carpeta, llm, pasos: 1 });
  const g = criterio(o, 'g');
  // Sin beneficio (fondo recién arrancado) y con gasto, no se cumple.
  const beneficio = o.vivo.patrimonio - o.estado.capitalInicial;
  if (beneficio <= 0) assert.equal(g.ok, false);
  else assert.equal(g.ok, 1 / beneficio < 0.1);
  assert.match(g.valorTexto, /1,00 \$/);
  await o.detener();
});
