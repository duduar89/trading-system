'use strict';
// Conversaciones en el chat (§6.2) y reuniones informativas (§6.9):
//   - una operación completa es UN hilo: señal → propuesta → Riesgos (por el
//     nombre del operador) → Ejecutor (a los dos) → ejecución → … → cierre →
//     lección del Auditor, cada mensaje contestando al anterior;
//   - el comité: cada jefe contesta al anterior y la Presidenta cita a quien vetó;
//   - el Megáfono: la Presidenta y el agente afectado contestan al humano;
//   - la reunión de la mañana (9:00) y el cierre del día (22:15), hora de
//     Madrid con su cambio de hora, sin tocar modo, multiplicadores ni vetos.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { crearOrquestador, PASO } = require('./integracion-ayuda');
const mesasDep = require('../src/agentes/departamentos/mesas');
const laboratorio = require('../src/agentes/departamentos/laboratorio');
const comite = require('../src/agentes/comite');
const conversacion = require('../src/agentes/conversacion');
const reuniones = require('../src/agentes/reuniones');
const registros = require('../src/registros');
const f = require('../src/util/formato');
const { leerJSONL } = require('../src/util/almacen');

const MIN = 60_000;
const HORA = 60 * MIN;

function oir(o) {
  const mensajes = [];
  o.bus.on('mensaje', m => mensajes.push(m));
  return mensajes;
}

const pila = (o, id) => conversacion.pilaDe(o, id);

test('una operación completa es un solo hilo: propuesta → aprobación → orden → ejecución → cierre → lección, cada uno contestando al anterior', async () => {
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 3 });
  const mensajes = oir(o);
  const mesa = o.estado.mesas.find(m => m.id === 'tendencia');
  const simbolo = 'ETH/USD';
  const pid = 'tendencia-ETH';
  const operador = 'puesto-tendencia-ETH';
  o.estado.puestos[pid] = o.estado.puestos[pid] || { estadoTexto: '', ultimaSenal: null, chispa: [] };
  const precio = o.vivo.precios[simbolo].precio;
  // La señal de la estrategia abre la conversación (como mesas.procesarMesa).
  const senal = conversacion.abrir(o, pid, { de: operador, canal: 'parque', tipo: 'senal', texto: 'Abro ETH.', datos: { puestoId: pid, accion: 'abrir' }, importancia: 2 });
  await mesasDep.proponerApertura(o, { mesa, simbolo, senal: { peso: 1, stop: precio * 0.9, motivo: 'prueba' }, cierre: precio, tVela: reloj.ahora(), vol: 0.6 });
  reloj.avanzar(PASO);
  await o.refrescarCartera();
  await mesasDep.proponerCierre(o, { mesaId: 'tendencia', simbolo, tipo: 'cierre', motivo: 'señal', accion: 'cerrar', velaT: reloj.ahora() });
  const op = o.operaciones[o.operaciones.length - 1];
  assert.ok(op && op.puestoId === pid, 'la operación se cerró');
  await laboratorio.auditoria(o, [op]);

  const hilo = mensajes.filter(m => m.hilo === senal.id);
  assert.deepEqual(hilo.map(m => m.tipo), ['senal', 'propuesta', 'aprobacion', 'orden', 'ejecucion', 'propuesta', 'aprobacion', 'orden', 'ejecucion', 'cierre', 'leccion']);
  // Cada mensaje contesta al anterior del hilo.
  for (let i = 1; i < hilo.length; i++) assert.equal(hilo[i].respondeA, hilo[i - 1].id, `${hilo[i].tipo} contesta a ${hilo[i - 1].tipo}`);
  assert.equal(senal.hilo, senal.id);
  assert.equal(senal.respondeA, null);
  const lucia = pila(o, operador);
  const marta = pila(o, 'riesgos');
  const [, propuesta, aprobacion, orden, ejecucion] = hilo;
  // El operador le pide a Riesgos por su nombre; Riesgos le contesta por el suyo.
  assert.equal(propuesta.para, 'riesgos');
  assert.match(propuesta.texto, new RegExp(`^${marta}, quiero comprar`));
  assert.equal(aprobacion.de, 'riesgos');
  assert.equal(aprobacion.para, operador);
  assert.match(aprobacion.texto, new RegExp(`^${lucia}, `));
  // El Ejecutor confirma a los dos y luego al operador.
  assert.match(orden.texto, new RegExp(`^Recibido, ${lucia} y ${marta}: mando al bróker la compra`));
  assert.equal(ejecucion.para, operador);
  assert.match(ejecucion.texto, new RegExp(`^${lucia}, hecho: he comprado`));
  // Las cifras son las de sus datos (nada nuevo): la ejecución dice su precio y su importe.
  assert.ok(ejecucion.texto.includes(f.precio(ejecucion.datos.precio)), ejecucion.texto);
  const cierre = hilo[9];
  assert.equal(cierre.de, operador);
  assert.match(cierre.texto, /^He cerrado ETH con la señal de venta de mi estrategia: (gano|pierdo|ni gano)/);
  const leccion = hilo[10];
  assert.equal(leccion.de, 'auditor');
  assert.equal(leccion.para, operador);
  assert.equal(leccion.respondeA, cierre.id);
  assert.match(leccion.texto, new RegExp(`^${lucia}, sobre tu operación en ETH \\(Tendencia`));
  // La conversación del puesto se cerró y el hilo del cierre ya se usó.
  assert.equal(o.estado.puestos[pid].conversacion, undefined);
  assert.equal(conversacion.cierreDe(o, op.id), null);
  await o.detener();
});

test('una compra vetada termina ahí su conversación: la siguiente señal abre otra', async () => {
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 3 });
  const mensajes = oir(o);
  const mesa = o.estado.mesas.find(m => m.id === 'tendencia');
  const pid = 'tendencia-SOL';
  o.estado.puestos[pid] = { estadoTexto: '', ultimaSenal: null, chispa: [] };
  o.estado.fondo.nivel = 'pausado';               // Riesgos veta toda apertura
  const precio = o.vivo.precios['SOL/USD'].precio;
  const senal = conversacion.abrir(o, pid, { de: 'puesto-tendencia-SOL', canal: 'parque', tipo: 'senal', texto: 'Abro SOL.', datos: { puestoId: pid } });
  await mesasDep.proponerApertura(o, { mesa, simbolo: 'SOL/USD', senal: { peso: 1, stop: precio * 0.9 }, cierre: precio, tVela: reloj.ahora(), vol: 0.6 });
  const hilo = mensajes.filter(m => m.hilo === senal.id);
  assert.deepEqual(hilo.map(m => m.tipo), ['senal', 'propuesta', 'veto']);
  assert.match(hilo[2].texto, new RegExp(`^${pila(o, 'puesto-tendencia-SOL')}, no puedo aprobar la compra de SOL: `));
  assert.equal(o.estado.puestos[pid].conversacion, undefined);
  await o.detener();
});

test('comité: cada jefe contesta al anterior dándole las gracias y la Presidenta cita a quien vetó', async () => {
  const { orquestador: o } = await crearOrquestador({ pasos: 2 });
  const mensajes = oir(o);
  o.estado.fondo.nivel = 'solo_cerrar';          // Riesgos vota DEFENSIVO (y es veto)
  await comite.celebrar(o, { motivo: 'demanda' });
  const c = mensajes.filter(m => m.canal === 'comite');
  const apertura = c[0];
  assert.equal(apertura.hilo, apertura.id);
  assert.match(apertura.texto, new RegExp(`${pila(o, 'controller')}, empiezas tú\\.$`));
  for (let i = 1; i < c.length; i++) {
    assert.equal(c[i].hilo, apertura.id);
    assert.equal(c[i].respondeA, c[i - 1].id);
  }
  // Controller → Presidenta, Macro → Controller, Riesgos → Macro…
  assert.match(c[1].texto, new RegExp(`^Gracias, ${pila(o, 'cio')}\\. El fondo vale`));
  assert.equal(c[1].para, 'cio');
  assert.match(c[2].texto, new RegExp(`^Gracias, ${pila(o, 'controller')}\\. Por mi parte`));
  assert.match(c[3].texto, new RegExp(`^Gracias, ${pila(o, 'macro')}\\. El fondo está en nivel solo cerrar`));
  assert.match(c[3].texto, /Mi voto: DEFENSIVO \(compras nuevas a la mitad\) y es veto\./);
  const d = c[c.length - 1];
  assert.equal(d.tipo, 'decision');
  assert.match(d.texto, new RegExp(`${pila(o, 'riesgos')} ha votado DEFENSIVO y su voto es veto`));
  assert.match(d.texto, new RegExp(`${pila(o, 'macro')}|Decido: modo DEFENSIVO`));
  await o.detener();
});

test('Megáfono: la Presidenta contesta al humano y el agente afectado le confirma en el mismo hilo', async () => {
  const { orquestador: o } = await crearOrquestador({ pasos: 2 });
  const mensajes = oir(o);
  const p = await o.comando('megafono', { texto: 'pausa BTC durante 2 horas' });
  assert.equal(p.ok, true);
  assert.deepEqual(p.datos.directivas.map(d => d.tipo), ['pausar_activo']);
  assert.equal((await o.comando('megafono-aplicar', { id: p.datos.id })).ok, true);
  const orden = mensajes.find(m => m.de === 'humano');
  const hilo = mensajes.filter(m => m.hilo === orden.id);
  assert.deepEqual(hilo.map(m => [m.de, m.tipo]).slice(0, 2), [['humano', 'megafono'], ['cio', 'propuesta']]);
  const directiva = hilo.find(m => m.tipo === 'directiva');
  assert.ok(directiva, 'la directiva aplicada va en el hilo');
  const respuesta = hilo[hilo.length - 1];
  assert.equal(respuesta.respondeA, directiva.id);
  assert.equal(respuesta.para, 'humano');
  assert.notEqual(respuesta.de, 'cio', 'contesta quien tiene que cumplirla');
  assert.match(respuesta.de, /^puesto-.+-BTC$/);
  assert.match(respuesta.texto, /^Entendido: no abro nada en BTC durante 2 h\./);
  // «Solo cerrar» le toca a Riesgos.
  const q = await o.comando('megafono', { texto: 'no abras nada durante 3 horas' });
  assert.equal((await o.comando('megafono-aplicar', { id: q.datos.id })).ok, true);
  const ultima = mensajes[mensajes.length - 1];
  assert.equal(ultima.de, 'riesgos');
  assert.equal(ultima.para, 'humano');
  assert.match(ultima.texto, /^Entendido: no se abre nada durante 3 h/);
  await o.detener();
});

// ---------- Reuniones ----------

// Da pasos hasta el instante t (incluido) y devuelve los mensajes de ese último paso.
async function hasta(o, reloj, t) {
  while (reloj.ahora() + PASO <= t) { reloj.avanzar(PASO); await o.paso(); }
}

test('reunión de la mañana a las 9:00 y cierre del día a las 22:15 de Madrid (verano: 07:00 y 20:15 UTC), sin tocar modo, multiplicadores ni vetos', async () => {
  const { orquestador: o, reloj, carpeta } = await crearOrquestador({ pasos: 1 });
  const mensajes = oir(o);
  const c = o.estado.cadencias;
  assert.equal(c.proximaReunionManana, Date.UTC(2026, 5, 1, 7, 0), '1-jun-2026 09:00 en Madrid (CEST)');
  assert.equal(c.proximaReunionCierre, Date.UTC(2026, 5, 1, 20, 15));
  await hasta(o, reloj, Date.UTC(2026, 5, 1, 6, 55));
  // El modo, los multiplicadores y los vetos de antes de la reunión.
  o.estado.directivas.modo = 'DEFENSIVO';
  const antes = JSON.stringify(o.estado.directivas);
  const n0 = mensajes.length;
  reloj.avanzar(PASO);
  await o.paso();
  assert.equal(reloj.ahora(), Date.UTC(2026, 5, 1, 7, 0));
  const reunion = mensajes.slice(n0).filter(m => m.datos && m.datos.reunion === 'manana');
  assert.ok(reunion.length >= 5, `apertura, Controller, Macro, Riesgos y Presidenta (${reunion.length})`);
  assert.equal(reunion[0].tipo, 'reunion');
  assert.equal(reunion[0].hilo, reunion[0].id);
  assert.match(reunion[0].texto, /^Buenos días\. Empezamos la reunión de las 09:00/);
  for (let i = 1; i < reunion.length; i++) assert.equal(reunion[i].respondeA, reunion[i - 1].id);
  assert.deepEqual(reunion.slice(1, 4).map(m => m.de), ['controller', 'macro', 'riesgos']);
  assert.equal(reunion[reunion.length - 1].de, 'cio');
  assert.match(reunion[reunion.length - 1].texto, /Resumen: el fondo vale .* en modo DEFENSIVO/);
  assert.equal(JSON.stringify(o.estado.directivas), antes, 'la reunión no cambia modo, multiplicadores ni vetos');
  assert.equal(c.proximaReunionManana, Date.UTC(2026, 5, 2, 7, 0));
  // Cierre del día a las 20:15 UTC.
  o.estado.directivas.modo = 'NORMAL';
  await hasta(o, reloj, Date.UTC(2026, 5, 1, 20, 10));
  const n1 = mensajes.length;
  const antes2 = JSON.stringify(o.estado.directivas);
  reloj.avanzar(PASO);
  await o.paso();
  const cierre = mensajes.slice(n1).filter(m => m.datos && m.datos.reunion === 'cierre');
  assert.deepEqual(cierre.map(m => m.de), ['cio', 'controller', 'controller', 'riesgos', 'cio']);
  assert.match(cierre[0].texto, /^Empezamos el cierre del día de las 22:15/);
  assert.match(cierre[1].texto, /^Gracias, .*\. Hoy \(desde las 02:00\) el fondo (gana|pierde)/);
  assert.match(cierre[2].texto, /operación|operaciones/);
  assert.match(cierre[3].texto, /posici|nada abierto/);
  assert.equal(JSON.stringify(o.estado.directivas), antes2);
  assert.equal(o.estado.reuniones.ultimoCierre.t, Date.UTC(2026, 5, 1, 20, 15));
  // decisiones.jsonl: una línea 'reunion' por reunión, de la Presidenta, con
  // las cifras de sus turnos y diciendo que no cambia nada.
  const lineas = leerJSONL(path.join(carpeta, registros.FICHEROS.decisiones)).filter(l => l.tipo === 'reunion');
  assert.equal(lineas.length, 2);
  assert.deepEqual(lineas.map(l => [l.quien, l.datos.reunion]), [['cio', 'manana'], ['cio', 'cierre']]);
  for (const l of lineas) {
    assert.match(l.resumen, /Informativa: no cambia nada\.$/);
    assert.ok(l.datos.turnos && l.datos.turnos.resumen, 'lleva los datos de sus turnos');
    assert.equal(l.datos.fuente, 'plantilla');
  }
  await o.detener();
});

test('reuniones con el cambio de hora: el 25-oct-2026 la de las 9:00 es a las 08:00 UTC y el 28-mar-2027, a las 07:00 UTC', () => {
  const { siguienteCita, anteriorCita, CITAS } = reuniones;
  assert.equal(siguienteCita(Date.UTC(2026, 9, 24, 12), CITAS.manana), Date.UTC(2026, 9, 25, 8, 0));
  assert.equal(siguienteCita(Date.UTC(2026, 9, 24, 12), CITAS.cierre), Date.UTC(2026, 9, 24, 20, 15), 'el sábado aún en horario de verano');
  assert.equal(siguienteCita(Date.UTC(2026, 9, 25, 12), CITAS.cierre), Date.UTC(2026, 9, 25, 21, 15), 'el domingo ya en invierno');
  assert.equal(siguienteCita(Date.UTC(2027, 2, 27, 12), CITAS.manana), Date.UTC(2027, 2, 28, 7, 0));
  assert.equal(siguienteCita(Date.UTC(2027, 2, 27, 12), CITAS.cierre), Date.UTC(2027, 2, 27, 21, 15));
  assert.equal(siguienteCita(Date.UTC(2027, 2, 28, 12), CITAS.cierre), Date.UTC(2027, 2, 28, 20, 15));
  // Justo a la hora: la siguiente es la del día después; la anterior, esa misma.
  const t = Date.UTC(2026, 9, 25, 8, 0);
  assert.equal(siguienteCita(t, CITAS.manana), Date.UTC(2026, 9, 26, 8, 0));
  assert.equal(anteriorCita(t, CITAS.manana), t);
  for (const x of [Date.UTC(2026, 9, 25, 8, 0), Date.UTC(2027, 2, 28, 7, 0)]) assert.equal(f.hora(x), '09:00');
});

test('reunión en la noche del cambio de hora (orquestador): 08:00 UTC del 25-oct-2026, a la vez que el comité, y no cambia lo que decidió el comité', async () => {
  const { orquestador: o, reloj } = await crearOrquestador({ inicio: Date.UTC(2026, 9, 24, 0), pasos: 1 });
  const mensajes = oir(o);
  await hasta(o, reloj, Date.UTC(2026, 9, 25, 7, 55));
  const n0 = mensajes.length;
  reloj.avanzar(PASO);
  await o.paso();
  const nuevos = mensajes.slice(n0);
  const decision = nuevos.find(m => m.canal === 'comite' && m.tipo === 'decision');
  assert.ok(decision, 'a las 08:00 UTC toca comité');
  const reunion = nuevos.filter(m => m.datos && m.datos.reunion === 'manana');
  assert.ok(reunion.length >= 5, 'y la reunión de la mañana (09:00 en Madrid, ya en invierno)');
  assert.ok(nuevos.indexOf(reunion[0]) > nuevos.indexOf(decision), 'la reunión va después del comité');
  assert.match(reunion[reunion.length - 1].texto, new RegExp(`en modo ${decision.datos.modo}`), 'cuenta el modo que acaba de decidir el comité, sin cambiarlo');
  assert.equal(o.estado.directivas.modo, decision.datos.modo);
  await o.detener();
});

test('una reunión que llega más de una hora tarde (portátil apagado) no se celebra a destiempo', async () => {
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 1 });
  const mensajes = oir(o);
  reloj.fijar(Date.UTC(2026, 5, 1, 9, 30));      // 11:30 en Madrid: la de las 9:00 ya pasó
  await o.paso();
  assert.equal(mensajes.filter(m => m.datos && m.datos.reunion).length, 0);
  assert.equal(o.estado.cadencias.proximaReunionManana, Date.UTC(2026, 5, 2, 7, 0));
  await o.detener();
});

test('reunión con LLM: sus turnos salen si las cifras cuadran con SU turno; uno con una cifra inventada sale con plantilla', async () => {
  const llamadas = [];
  const llm = {
    activo: true,
    async pedirJSON(args) {
      llamadas.push(args);
      const t = args.entrada.turnos;
      const noche = t.find(x => x.turno === 'noche');
      return {
        ok: true, costeUsd: 0.002, modelo: 'claude-haiku-4-5', tokens: {},
        datos: {
          intervenciones: [
            { turno: 'noche', texto: `Gracias, Carmen. El fondo vale ${f.usd(noche.datos.patrimonio)}; esta noche, tranquila.` },
            { turno: 'macro', texto: 'Gracias, Inés. El mercado está así así: vale 123.456 $ el bitcoin.' },
          ],
        },
      };
    },
    estado: () => ({ activo: true, modeloComite: 'x', modeloAgentes: 'claude-haiku-4-5', gastoHoyUsd: 0, presupuestoDiaUsd: 1 }),
    gastoHoy: () => 0, gastoDelDia: () => 0, gastoEntre: () => 0, fijarModelos() {}, fijarPresupuesto() {},
  };
  const { orquestador: o } = await crearOrquestador({ pasos: 2, llm });
  const mensajes = oir(o);
  await reuniones.celebrar(o, 'manana');
  const r = llamadas.find(x => x.proposito === 'reunion');
  assert.ok(r, 'una llamada para la reunión');
  assert.equal(r.uso, 'agentes');
  assert.deepEqual(r.esquema.properties.intervenciones.items.properties.turno.enum, r.entrada.turnos.map(x => x.turno));
  const reunion = mensajes.filter(m => m.datos && m.datos.reunion === 'manana');
  const noche = reunion.find(m => m.datos.turno === 'noche');
  assert.equal(noche.datos.fuente, 'llm');
  assert.match(noche.texto, /esta noche, tranquila/);
  const macro = reunion.find(m => m.datos.turno === 'macro');
  assert.equal(macro.datos.fuente, 'plantilla', 'el 123.456 $ no está en sus datos');
  assert.doesNotMatch(macro.texto, /123\.456/);
  await o.detener();
});

test('conversacion: el hilo de un cierre se guarda para el Auditor, se usa una vez y caduca a los 10 días', () => {
  const ahora = { t: Date.UTC(2026, 5, 1) };
  const ctx = { estado: { puestos: { p: { conversacion: { hilo: 'h1', ultimo: 'm3' } } } }, reloj: { ahora: () => ahora.t } };
  conversacion.terminar(ctx, 'p', { operacionId: 'op1', mensaje: { id: 'm4', hilo: 'h1', de: 'puesto-x', t: ahora.t } });
  assert.equal(ctx.estado.puestos.p.conversacion, undefined);
  assert.deepEqual(conversacion.cierreDe(ctx, 'op1', { quitar: false }), { hilo: 'h1', id: 'm4', de: 'puesto-x', t: ahora.t });
  ahora.t += 11 * 24 * HORA;
  conversacion.terminar(ctx, 'p', { operacionId: 'op2', mensaje: { id: 'm9', hilo: 'h2', de: 'puesto-x', t: ahora.t } });
  assert.equal(conversacion.cierreDe(ctx, 'op1'), null, 'caducado');
  assert.equal(conversacion.cierreDe(ctx, 'op2').id, 'm9');
  assert.equal(conversacion.cierreDe(ctx, 'op2'), null, 'se usa una sola vez');
});

// ---------- Modo, voto, régimen y conteos del LLM, también en llano (revisión H) ----------

// LLM falso para reuniones y comité: `reunion(entrada)` y `comite(args)` devuelven lo que diría.
function llmFalsoTono({ reunion = () => [], comite = null } = {}) {
  const llamadas = [];
  return {
    llamadas,
    activo: true,
    async pedirJSON(args) {
      llamadas.push(args);
      if (args.proposito === 'reunion') return { ok: true, costeUsd: 0.001, modelo: 'x', tokens: {}, datos: { intervenciones: reunion(args.entrada) } };
      if (args.proposito === 'comite' && comite) {
        const mult = Object.fromEntries(Object.keys(args.esquema.properties.multiplicadores.properties).map(k => [k, 1]));
        return { ok: true, costeUsd: 0.01, modelo: 'x', tokens: {}, datos: { modo: 'NORMAL', multiplicadores: mult, vetos: [], razon: '', intervenciones: [], ...comite(args) } };
      }
      return { ok: false, motivo: 'sin respuesta' };
    },
    estado: () => ({ activo: true, modeloComite: 'x', modeloAgentes: 'y', gastoHoyUsd: 0, presupuestoDiaUsd: 1 }),
    gastoHoy: () => 0, gastoDelDia: () => 0, gastoEntre: () => 0, gastoTotal: () => 0, fijarModelos() {}, fijarPresupuesto() {},
  };
}

// Un entero de 2 a 30 que no está (ni redondeado) en los datos: un conteo inventado.
function conteoInventado(datos) {
  const { numerosDeEntrada } = require('../src/agentes/cifras');
  const valores = numerosDeEntrada(datos).valores.map(Math.abs);
  for (let n = 30; n >= 2; n--) if (!valores.some(v => Math.abs(v - n) <= 0.5)) return n;
  throw new Error('sin conteo libre');
}

test('reunión con LLM: un modo o un régimen dicho en llano al revés que los datos, o un conteo inventado, sale con plantilla', async () => {
  let entradaNoche = null;
  const llm = llmFalsoTono({
    reunion: e => {
      entradaNoche = e.turnos.find(t => t.turno === 'noche').datos;
      return [
        { turno: 'noche', texto: `Gracias, Carmen. Esta noche hemos cerrado ${conteoInventado(entradaNoche)} operaciones, todas ganadoras.` },
        { turno: 'macro', texto: 'Gracias, Inés. El mercado tiene miedo esta mañana.' },
        { turno: 'riesgos', texto: 'Gracias. Todo tranquilo por mi lado.' },
        { turno: 'resumen', texto: 'Seguimos con las compras nuevas a la mitad hasta el próximo comité. Buen día.' },
      ];
    },
  });
  const { orquestador: o } = await crearOrquestador({ pasos: 2, llm });
  o.estado.directivas.modo = 'NORMAL';
  o.estado.macro.regimen = { valor: 'RISK-ON', puntos: 2, detalle: 'prueba' };
  const mensajes = oir(o);
  await reuniones.celebrar(o, 'manana');
  const turno = id => mensajes.find(m => m.datos && m.datos.reunion === 'manana' && m.datos.turno === id);
  assert.equal(turno('noche').datos.fuente, 'plantilla', `operaciones reales: ${entradaNoche.operaciones}`);
  assert.doesNotMatch(turno('noche').texto, /todas ganadoras/);
  assert.equal(turno('macro').datos.fuente, 'plantilla', '«tiene miedo» es RISK-OFF y el régimen es RISK-ON');
  assert.match(turno('macro').texto, /RISK-ON/);
  assert.equal(turno('resumen').datos.fuente, 'plantilla', '«a la mitad» es DEFENSIVO y el modo es NORMAL');
  assert.match(turno('resumen').texto, /en modo NORMAL \(compras a tamaño normal\)/);
  // Lo que no dice nada de modo, régimen ni cifras sí sale del LLM: el control no lo tapa todo.
  assert.equal(turno('riesgos').datos.fuente, 'llm');
  // Y el prompt ya no empuja al llano sin control: dice qué se comprueba.
  const instr = llm.llamadas.find(x => x.proposito === 'reunion').instrucciones;
  assert.match(instr, /aunque sea en llano/);
  await o.detener();
});

test('comité con LLM: Macro no puede decir en llano otro régimen ni otro voto, ni el Controller inventar un conteo', async () => {
  const llm = llmFalsoTono({
    comite: args => ({
      modo: 'NORMAL',
      intervenciones: [
        { agente: 'controller', texto: `Gracias. Esta semana hemos cerrado ${conteoInventado(args.entrada.controller)} operaciones.` },
        { agente: 'macro', texto: 'Gracias. El mercado tiene miedo: yo pondría las compras nuevas a la mitad. Mi voto: NORMAL.' },
        { agente: 'laboratorio', texto: 'Sin novedades en el laboratorio.' },
      ],
    }),
  });
  const { orquestador: o } = await crearOrquestador({ pasos: 2, llm });
  o.estado.macro.regimen = { valor: 'RISK-ON', puntos: 2, detalle: 'prueba' };
  o.estado.fondo.nivel = 'normal';
  const mensajes = oir(o);
  await comite.celebrar(o, { motivo: 'demanda' });
  const punto = p => mensajes.find(m => m.canal === 'comite' && m.datos && m.datos.punto === p);
  assert.equal(punto('macro').datos.voto, 'NORMAL');
  assert.equal(punto('macro').datos.fuente, 'plantilla');
  assert.doesNotMatch(punto('macro').texto, /miedo|a la mitad/);
  assert.equal(punto('controller').datos.fuente, 'plantilla', 'el conteo no está en sus datos');
  assert.equal(punto('laboratorio').datos.fuente, 'llm');
  const instr = llm.llamadas.find(x => x.proposito === 'comite').instrucciones;
  assert.doesNotMatch(instr, /mejor que «DEFENSIVO»/, 'ya no pide el llano sin control');
  await o.detener();
});

test('tras un kill, la reunión, el cierre y el comité dicen que el fondo no compra nada (ni la razón del LLM puede decir que sí)', async () => {
  const llm = llmFalsoTono({
    reunion: () => [{ turno: 'resumen', texto: 'Seguimos en modo NORMAL, con las compras a tamaño normal.' }],
    comite: () => ({ modo: 'DEFENSIVO', razon: 'Pasamos a DEFENSIVO: las compras nuevas, a la mitad.' }),
  });
  const { orquestador: o, reloj } = await crearOrquestador({ pasos: 1, llm });
  const mensajes = oir(o);
  await hasta(o, reloj, Date.UTC(2026, 5, 1, 6, 30));
  const k = await o.comando('kill', { confirmacion: 'KILL' });
  assert.equal(k.ok, true);
  assert.equal(o.estado.fondo.nivel, 'bloqueado');
  await hasta(o, reloj, Date.UTC(2026, 5, 1, 8, 0));     // reunión de las 9:00 de Madrid y comité de las 08:00 UTC
  const resumen = mensajes.find(m => m.datos && m.datos.reunion === 'manana' && m.datos.turno === 'resumen');
  assert.equal(resumen.datos.fuente, 'plantilla', 'con el fondo bloqueado no se compra a tamaño normal');
  assert.doesNotMatch(resumen.texto, /compras/);
  assert.match(resumen.texto, /no compra nada: está bloqueado por el kill switch hasta Reabrir/);
  const decision = mensajes.filter(m => m.canal === 'comite' && m.tipo === 'decision').pop();
  assert.ok(decision && decision.t >= Date.UTC(2026, 5, 1, 8, 0), 'comité de las 08:00 UTC');
  assert.doesNotMatch(decision.texto, /compras|a la mitad/);
  assert.match(decision.texto, /^Decido: modo DEFENSIVO.*\. Ahora el fondo no compra nada/);
  await reuniones.celebrar(o, 'cierre');
  const cierre = mensajes.filter(m => m.datos && m.datos.reunion === 'cierre' && m.datos.turno === 'resumen').pop();
  assert.doesNotMatch(cierre.texto, /compras/);
  assert.match(cierre.texto, /no compra nada/);
  await o.detener();
});
