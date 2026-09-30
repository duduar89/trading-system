'use strict';
// Lista de espera contra la base: cuando se libera un hueco, el cron se lo guarda 30 minutos al
// primero que encaja y se lo ofrece por WhatsApp; «sí» → cita confirmada; «no» o sin respuesta →
// pasa al siguiente. Un hueco nunca a dos a la vez; fuera de fechas, de franja, sin antelación, de
// noche o ya ocupado, no se ofrece. Alta desde WhatsApp y desde el panel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const R = require('../servidor/repesca/motor');
const LE = require('../servidor/lista-espera');
const espera = require('../servidor/avisos-espera');
const agenda = require('../servidor/agenda');
const cron = require('../servidor/cron');
const { crearApp } = require('../servidor/index');
const { firmar } = require('../servidor/sesion');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const T = require('../motor/tiempo');

const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
const mas = (d, min) => new Date(new Date(d).getTime() + min * 60000);

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, municipio) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', 'Boadilla del Monte')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica'), (3, 'sala-capilar', 'Sala capilar', 'sala_capilar')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista'), (30, 'tricologia-1', 'Tricología 1', 'tricologo')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '20:00')", [d]);
  // La tricóloga ya no tiene días en la agenda: de lo suyo no hay huecos.
  await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin, vigente_desde, vigente_hasta) VALUES (30, 3, '11:00', '20:00', '2026-09-01', '2026-09-30')");
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial'), ('medicina_capilar', 'Medicina capilar')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, reservable_ia) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 60, 10, 54, 'esteticista', 'cabina_estetica', 'cosmetico', TRUE),
    ('valoracion-capilar', 'Valoración capilar', 'medicina_capilar', 45, 10, 0, 'tricologo', 'sala_capilar', 'servicio', TRUE)`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

const DADA = new Date('2026-10-01T08:00:00Z');

async function paciente(pool, nombre, telefono) {
  const [p] = await pool.query('INSERT INTO pacientes (nombre, telefono) VALUES (?, ?)', [nombre, telefono]);
  return p.insertId;
}

async function conCita(pool, { nombre, telefono, fecha, hora }) {
  const pacienteId = await paciente(pool, nombre, telefono);
  const cita = await agenda.reservar(pool, { pacienteId, tratamientoId: 'limpieza-facial', fecha, hora, origen: 'recepcion', ahora: DADA });
  return { pacienteId, cita };
}

async function enLista(pool, { nombre, telefono, desde = '2026-10-19', hasta = null, franja = null, citaActualId = null, ahora }) {
  const pacienteId = await paciente(pool, nombre, telefono);
  const { id } = await LE.apuntar(pool, { pacienteId, tratamientoId: 'limpieza-facial', desdeFecha: desde, hastaFecha: hasta, franja, citaActualId, origen: 'panel', creadoPor: 'recepcion@prueba', ahora });
  return { pacienteId, id };
}

const dia = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const entrada = async (pool, id) => (await pool.query('SELECT * FROM lista_espera WHERE id = ?', [id]))[0][0];
const ofertasDe = async (pool, id) => (await pool.query('SELECT * FROM lista_espera_ofertas WHERE lista_espera_id = ? ORDER BY id', [id]))[0];
const cita = async (pool, id) => (await pool.query('SELECT * FROM citas WHERE id = ?', [id]))[0][0];

test('lista de espera: el hueco que se libera, al primero que encaja', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  // Las ofertas que le han llegado (plantilla o, con la ventana abierta, texto).
  const a = (tel) => whatsapp.enviados.filter((m) => m.telefono === tel && (m.nombre === 'iemec_hueco_liberado' || /se ha liberado un hueco/.test(m.texto || '')));
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z'); // lunes 10:00 en Madrid
    const x = await conCita(pool, { nombre: 'Ximena', telefono: '+34611000401', fecha: '2026-10-21', hora: '17:00' });
    const y = await conCita(pool, { nombre: 'Yolanda', telefono: '+34611000402', fecha: '2026-10-22', hora: '12:00' });
    const ana = await enLista(pool, { nombre: 'Ana', telefono: '+34611000411', ahora: mas(lunes, -60) });
    const bea = await enLista(pool, { nombre: 'Bea', telefono: '+34611000412', ahora: mas(lunes, -50) });
    const carla = await enLista(pool, { nombre: 'Carla', telefono: '+34611000413', ahora: mas(lunes, -40) });
    const dani = await enLista(pool, { nombre: 'Dani', telefono: '+34611000414', franja: 'manana', ahora: mas(lunes, -30) });
    const eva = await enLista(pool, { nombre: 'Eva', telefono: '+34611000415', hasta: '2026-10-20', ahora: mas(lunes, -20) });

    await t.test('se cancela una cita → se le guarda 30 minutos a la primera y le llega «hueco_liberado»; a nadie más', async () => {
      await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', motivo: 'no puede', ahora: mas(lunes, 5) });
      const i = await espera.vuelta(deps, { ahora: mas(lunes, 6) });
      assert.equal(i.ofrecidas, 1);
      const [m] = a('+34611000411');
      assert.equal(m.nombre, 'iemec_hueco_liberado');
      assert.deepEqual(m.variables, ['Ana', 'tu limpieza facial profunda', 'miércoles 21 de octubre', '17:00']);
      assert.equal((await entrada(pool, ana.id)).estado, 'ofrecido');
      const [o] = await ofertasDe(pool, ana.id);
      assert.equal(o.estado, 'ofrecida');
      assert.equal(o.liberada_por_cita_id, x.cita.id);
      assert.equal(new Date(o.caduca_en).getTime(), mas(lunes, 36).getTime(), '30 minutos');
      const guardada = await cita(pool, o.cita_id);
      assert.deepEqual([guardada.estado, guardada.paciente_id, madrid(guardada.inicio)], ['retenida', ana.pacienteId, '2026-10-21 17:00']);
      const libres = (await agenda.huecos(pool, { fecha: '2026-10-21', tratamientoId: 'limpieza-facial', ahora: mas(lunes, 7) })).map((h) => h.hora);
      assert.ok(!libres.includes('17:00'), 'guardado: la agenda ya no lo da por libre');

      const otra = await espera.vuelta(deps, { ahora: mas(lunes, 7) });
      assert.equal(otra.ofrecidas, 0, 'un hueco nunca a dos a la vez');
      assert.deepEqual([...a('+34611000412'), ...a('+34611000413'), ...a('+34611000414'), ...a('+34611000415')], []);
    });

    await t.test('«Sí, guárdamelo» → cita confirmada con su enlace y sale de la lista', async () => {
      const r = await R.procesarEntrante(deps, { telefono: '+34611000411', texto: 'Sí, guárdamelo', ahora: mas(lunes, 15) });
      assert.equal(r.listaEspera, 'aceptada');
      const c = await cita(pool, r.citaId);
      assert.equal(c.estado, 'confirmada');
      assert.ok(c.aviso_confirmacion_en, 'no se le repite la confirmación por plantilla');
      assert.match(r.respuesta, /^Soy el asistente virtual de IEMEC\. ¡Hecho, Ana! Te esperamos el miércoles 21 de octubre a las 17:00 en IEMEC/);
      assert.ok(r.respuesta.endsWith(`/c/${c.token}`));
      assert.equal((await entrada(pool, ana.id)).estado, 'aceptado');
      assert.equal((await ofertasDe(pool, ana.id))[0].estado, 'aceptada');
      const [[conv]] = await pool.query('SELECT estado, motivo_cierre FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.deepEqual({ ...conv }, { estado: 'cerrada', motivo_cierre: 'cita' });
    });

    await t.test('«No me viene bien» → el hueco pasa a la siguiente, y a ella no se le vuelve a ofrecer', async () => {
      await agenda.cancelar(pool, { id: y.cita.id, por: 'paciente', motivo: 'no puede', ahora: mas(lunes, 20) });
      await espera.vuelta(deps, { ahora: mas(lunes, 21) });
      assert.equal(a('+34611000412').length, 1, 'Ana ya tiene cita: le toca a Bea');
      const r = await R.procesarEntrante(deps, { telefono: '+34611000412', texto: 'No me viene bien', ahora: mas(lunes, 25) });
      assert.equal(r.respuesta, 'Soy el asistente virtual de IEMEC. Sin problema, Bea. Sigues en la lista de espera: si se libera otro hueco, te aviso.');
      const [ob] = await ofertasDe(pool, bea.id);
      assert.equal(ob.estado, 'rechazada');
      assert.equal((await cita(pool, ob.cita_id)).estado, 'cancelada', 'el hueco queda libre');
      assert.equal((await entrada(pool, bea.id)).estado, 'esperando', 'sigue en la lista');

      const i = await espera.vuelta(deps, { ahora: mas(lunes, 26) });
      assert.equal(i.ofrecidas, 1);
      assert.equal(a('+34611000412').length, 1, 'a Bea no se le repite');
      assert.equal(a('+34611000413').length, 1, 'se le ofrece a Carla');
      assert.deepEqual(a('+34611000413')[0].variables, ['Carla', 'tu limpieza facial profunda', 'jueves 22 de octubre', '12:00']);
    });

    await t.test('sin respuesta en 30 minutos caduca y pasa al siguiente que encaja (por la mañana); fuera de fechas, nunca', async () => {
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 50) })).caducadas, 0, 'aún no han pasado los 30 minutos');
      const i = await espera.vuelta(deps, { ahora: mas(lunes, 57) });
      assert.equal(i.caducadas, 1);
      const [oc] = await ofertasDe(pool, carla.id);
      assert.equal(oc.estado, 'caducada');
      assert.equal((await cita(pool, oc.cita_id)).estado, 'cancelada');
      assert.equal((await entrada(pool, carla.id)).estado, 'esperando', 'con una sin contestar, sigue en la lista');
      assert.equal(i.ofrecidas, 1);
      assert.equal(a('+34611000414').length, 1, 'le toca a Dani (quería mañanas: las 12:00 le encajan)');
      assert.deepEqual(a('+34611000415'), [], 'Eva solo esperaba hasta el 20');
      assert.equal((await entrada(pool, eva.id)).estado, 'esperando');
      assert.equal((await entrada(pool, dani.id)).estado, 'ofrecido');
    });

    await t.test('el cron de cada minuto lo hace solo', async () => {
      const inf = await cron.vuelta({ pool, deps, ahora: mas(lunes, 90) });
      assert.equal(inf.listaEspera.caducadas, 1, 'la de Dani caduca');
      assert.equal(inf.listaEspera.ofrecidas, 0, 'y ya no queda nadie a quien ofrecérselo');
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera: lo que no se ofrece', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z'); // lunes 10:00 en Madrid
    const dani = await enLista(pool, { nombre: 'Dani', telefono: '+34611000421', franja: 'manana', ahora: mas(lunes, -30) });
    await enLista(pool, { nombre: 'Eva', telefono: '+34611000422', desde: '2026-10-19', hasta: '2026-10-20', ahora: mas(lunes, -20) });

    await t.test('fuera de su franja y fuera de sus fechas, no', async () => {
      const x = await conCita(pool, { nombre: 'Xenia', telefono: '+34611000431', fecha: '2026-10-21', hora: '17:00' });
      await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: mas(lunes, 1) });
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 2) })).ofrecidas, 0);
    });

    await t.test('un hueco que ya se ha vuelto a ocupar, no', async () => {
      const x = await conCita(pool, { nombre: 'Xana', telefono: '+34611000432', fecha: '2026-10-21', hora: '12:00' });
      await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: mas(lunes, 3) });
      // Recepción da las 12:30 a otra paciente antes de que pase el cron: las 12:00 ya no caben.
      await conCita(pool, { nombre: 'Otra', telefono: '+34611000433', fecha: '2026-10-21', hora: '12:30' });
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 4) })).ofrecidas, 0);
      assert.deepEqual(whatsapp.enviados, []);
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM citas WHERE estado = 'retenida'");
      assert.equal(n.n, 0);
    });

    await t.test('sin antelación (empieza en menos de 2 horas), no', async () => {
      const x = await conCita(pool, { nombre: 'Xusa', telefono: '+34611000434', fecha: '2026-10-19', hora: '11:30' });
      await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: mas(lunes, 5) });
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 6) })).ofrecidas, 0);
    });

    await t.test('de noche no se escribe: se ofrece a partir de las 9:00', async () => {
      const x = await conCita(pool, { nombre: 'Xeila', telefono: '+34611000435', fecha: '2026-10-22', hora: '12:00' });
      const noche = new Date('2026-10-21T19:30:00Z'); // 21:30 en Madrid
      await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: noche });
      assert.equal((await espera.vuelta(deps, { ahora: mas(noche, 1) })).ofrecidas, 0);
      const manana = new Date('2026-10-22T07:00:00Z'); // 9:00
      assert.equal((await espera.vuelta(deps, { ahora: manana })).ofrecidas, 1);
      assert.equal(whatsapp.enviados.at(-1).telefono, '+34611000421', 'a Dani: por la mañana y dentro de sus fechas');
      assert.equal(whatsapp.enviados.at(-1).variables[2], 'jueves 22 de octubre');
    });

    await t.test('quien deja dos ofertas sin contestar sale de la lista', async () => {
      const manana = new Date('2026-10-22T07:00:00Z');
      await espera.vuelta(deps, { ahora: mas(manana, 31) }); // caduca la primera
      assert.equal((await entrada(pool, dani.id)).estado, 'esperando');
      const x = await conCita(pool, { nombre: 'Xiana', telefono: '+34611000436', fecha: '2026-10-23', hora: '11:30' });
      await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: mas(manana, 32) });
      assert.equal((await espera.vuelta(deps, { ahora: mas(manana, 33) })).ofrecidas, 1);
      await espera.vuelta(deps, { ahora: mas(manana, 64) }); // caduca la segunda
      const d = await entrada(pool, dani.id);
      assert.deepEqual([d.estado, Boolean(d.cerrado_en)], ['caducado', true]);
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera: adelantar la cita, alta por WhatsApp y baja', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-26T09:00:00Z'); // lunes 10:00 en Madrid (ya en horario de invierno)

    await t.test('con cita más tarde: se le ofrece un hueco antes y, al aceptarlo, su cita se adelanta', async () => {
      const f = await conCita(pool, { nombre: 'Fabi', telefono: '+34611000501', fecha: '2026-10-30', hora: '12:00' });
      await LE.apuntar(pool, { pacienteId: f.pacienteId, tratamientoId: 'limpieza-facial', citaActualId: f.cita.id, origen: 'panel', creadoPor: 'recepcion@prueba', ahora: mas(lunes, -60) });
      // Escribió ayer: su ventana de 24 h está abierta, así que le llega un texto y no una plantilla.
      await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado, motivo_cierre, ventana_hasta) VALUES ('+34611000501', ?, 'cerrada', 'cita', ?)", [f.pacienteId, mas(lunes, 600)]);

      // Un hueco después de su cita no le sirve.
      const tarde = await conCita(pool, { nombre: 'Olga', telefono: '+34611000502', fecha: '2026-10-31', hora: '12:00' });
      await agenda.cancelar(pool, { id: tarde.cita.id, por: 'paciente', ahora: lunes });
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 1) })).ofrecidas, 0);

      const antes = await conCita(pool, { nombre: 'Paula', telefono: '+34611000503', fecha: '2026-10-27', hora: '12:00' });
      await agenda.cancelar(pool, { id: antes.cita.id, por: 'paciente', ahora: mas(lunes, 2) });
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 3) })).ofrecidas, 1);
      const m = whatsapp.enviados.at(-1);
      assert.equal(m.tipo, 'texto');
      assert.equal(m.texto, 'Hola Fabi, se ha liberado un hueco antes para tu limpieza facial profunda: el martes 27 de octubre a las 12:00 (ahora tienes cita el viernes 30 de octubre a las 12:00). Te lo guardo 30 minutos: ¿te cambio la cita?');

      const r = await R.procesarEntrante(deps, { telefono: '+34611000501', texto: 'Sí, porfa', ahora: mas(lunes, 10) });
      assert.equal(r.listaEspera, 'aceptada');
      assert.equal(r.reprograma, f.cita.id);
      assert.match(r.respuesta, /¡Hecho, Fabi! Te he cambiado la cita: te esperamos el martes 27 de octubre a las 12:00 en IEMEC .+ La del viernes 30 de octubre a las 12:00 queda anulada\./);
      const vieja = await cita(pool, f.cita.id);
      assert.deepEqual([vieja.estado, vieja.reprograma_a_id, vieja.secuencia_ics], ['reprogramada', r.citaId, 1]);
      assert.equal((await cita(pool, r.citaId)).estado, 'confirmada');
    });

    await t.test('«¿No tenéis nada antes?» → «¿Quieres que te avise…?» → «sí» → apuntada hasta el día antes', async () => {
      // La clínica cierra desde hoy hasta el lunes 2 de noviembre: lo primero libre es ese día.
      await pool.query("INSERT INTO cierres (desde, hasta, motivo) VALUES ('2026-10-25 23:00:00', '2026-11-01 23:00:00', 'Formación (ejemplo)')");
      const [l] = await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000511', 'Gema Soto', 'meta_formulario', 'limpieza-facial')");
      const r1 = await R.procesarEntrante(deps, { telefono: '+34611000511', texto: 'Hola, dame cita', ahora: mas(lunes, 60) });
      assert.ok(r1.huecos.length >= 1);
      assert.ok(r1.huecos.every((h) => h.fecha >= '2026-11-02'), JSON.stringify(r1.huecos));
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000511', texto: '¿No tenéis nada antes?', ahora: mas(lunes, 62) });
      assert.equal(r2.respuesta, 'Antes del lunes 2 de noviembre no me queda nada libre, Gema. ¿Quieres que te avise si se libera un hueco antes? Mientras, los que te propuse siguen disponibles.');
      const r3 = await R.procesarEntrante(deps, { telefono: '+34611000511', texto: 'Sí, avísame', ahora: mas(lunes, 64) });
      assert.equal(r3.listaEspera, 'apuntado');
      assert.equal(r3.respuesta, '¡Apuntado, Gema! Si se libera un hueco antes del lunes 2 de noviembre, te lo guardo y te aviso por aquí. Si mientras quieres asegurarte uno de los que te propuse, dime cuál.');
      const [[e]] = await pool.query("SELECT le.*, p.telefono FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id WHERE p.telefono = '+34611000511'");
      assert.deepEqual([e.estado, e.origen, e.creado_por, e.tratamiento_id], ['esperando', 'whatsapp', 'ia', 'limpieza-facial']);
      assert.deepEqual([dia(e.desde_fecha), dia(e.hasta_fecha)], ['2026-10-27', '2026-11-01'], 'desde mañana hasta el día antes del primer hueco');
      const [[lead]] = await pool.query('SELECT paciente_id FROM leads WHERE id = ?', [l.insertId]);
      assert.equal(lead.paciente_id, e.paciente_id, 'el lead ya tiene ficha');
      // Con huecos propuestos, sigue pudiendo elegir uno.
      const r4 = await R.procesarEntrante(deps, { telefono: '+34611000511', texto: 'Bueno, mientras la primera', ahora: mas(lunes, 66) });
      assert.equal(r4.eleccion, 'reservada');
    });

    await t.test('sin ningún hueco para lo que pide: «¿Quieres que te avise si se libera uno?» → «sí» → a la lista y la conversación se cierra', async () => {
      await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000512', 'Hugo Rey', 'meta_formulario', 'valoracion-capilar')");
      const r1 = await R.procesarEntrante(deps, { telefono: '+34611000512', texto: '¿Tenéis hueco el jueves?', ahora: mas(lunes, 70) });
      assert.equal(r1.eleccion, 'sin_huecos');
      assert.equal(r1.respuesta, 'Soy el asistente virtual de IEMEC. Ahora mismo no me queda ningún hueco libre para eso, Hugo. ¿Quieres que te avise si se libera uno?');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000512', texto: 'Sí, porfa', ahora: mas(lunes, 72) });
      assert.equal(r2.respuesta, '¡Apuntado, Hugo! En cuanto se libere un hueco para valoración capilar, te lo guardo y te aviso por aquí.');
      const [[e]] = await pool.query("SELECT le.* FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id WHERE p.telefono = '+34611000512'");
      assert.equal(e.tratamiento_id, 'valoracion-capilar');
      assert.equal(dia(e.desde_fecha), '2026-10-29', 'desde el día que pidió');
      const [[conv]] = await pool.query('SELECT estado, motivo_cierre FROM conversaciones WHERE id = ?', [r2.conversacionId]);
      assert.deepEqual({ ...conv }, { estado: 'cerrada', motivo_cierre: 'lista_espera' });
      const [[seg]] = await pool.query("SELECT COUNT(*) AS n FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [r2.conversacionId]);
      assert.equal(seg.n, 0, 'no le llega un «como quedamos»: el siguiente paso es la lista');
    });

    await t.test('«no me escribáis más» con un hueco guardado: fuera de la lista y el hueco, libre para otro', async () => {
      const pepa = await enLista(pool, { nombre: 'Pepa', telefono: '+34611000521', desde: '2026-11-02', ahora: mas(lunes, 80) });
      const quique = await enLista(pool, { nombre: 'Quique', telefono: '+34611000522', desde: '2026-11-02', ahora: mas(lunes, 81) });
      const x = await conCita(pool, { nombre: 'Xuxa', telefono: '+34611000523', fecha: '2026-11-03', hora: '17:00' });
      await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: mas(lunes, 82) });
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 83) })).ofrecidas, 1);
      const [op] = await ofertasDe(pool, pepa.id);
      await R.procesarEntrante(deps, { telefono: '+34611000521', texto: 'No me escribáis más', ahora: mas(lunes, 85) });
      assert.equal((await entrada(pool, pepa.id)).estado, 'cancelado');
      assert.equal((await ofertasDe(pool, pepa.id))[0].estado, 'anulada');
      assert.equal((await cita(pool, op.cita_id)).estado, 'cancelada');
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 86) })).ofrecidas, 1);
      assert.equal((await entrada(pool, quique.id)).estado, 'ofrecido');
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera: si no se le puede avisar, no se le guarda el hueco', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const caido = { modo: 'simulado', enviados: [], async enviarTexto() { throw new Error('WhatsApp caído'); }, async enviarPlantilla() { throw new Error('WhatsApp caído'); } };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z'); // lunes 10:00 en Madrid
    const ana = await enLista(pool, { nombre: 'Ana', telefono: '+34611000701', ahora: mas(lunes, -60) });
    const bea = await enLista(pool, { nombre: 'Bea', telefono: '+34611000702', ahora: mas(lunes, -50) });
    const x = await conCita(pool, { nombre: 'Xena', telefono: '+34611000711', fecha: '2026-10-21', hora: '17:00' });
    await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: mas(lunes, 1) });

    await t.test('con WhatsApp caído, el hueco se suelta en el acto y ella sigue en la lista', async () => {
      const i = await espera.vuelta({ pool, ia: crearIa('simulado'), whatsapp: caido }, { ahora: mas(lunes, 2) });
      assert.equal(i.ofrecidas, 0);
      const [o] = await ofertasDe(pool, ana.id);
      assert.equal(o.estado, 'anulada');
      assert.equal((await cita(pool, o.cita_id)).estado, 'cancelada');
      assert.equal((await entrada(pool, ana.id)).estado, 'esperando');
    });

    await t.test('sin plantilla aprobada ni ventana abierta: tarea para recepción y sigue en la lista', async () => {
      await pool.query("UPDATE plantillas SET estado = 'pausada' WHERE uso = 'hueco_liberado'");
      const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
      const i = await espera.vuelta(deps, { ahora: mas(lunes, 3) });
      assert.equal(i.ofrecidas, 0);
      const [o] = await ofertasDe(pool, bea.id);
      assert.equal(o.estado, 'anulada', 'le tocaba a Bea (Ana ya lo tuvo)');
      assert.equal((await entrada(pool, bea.id)).estado, 'esperando');
      const [[tarea]] = await pool.query('SELECT titulo FROM tareas WHERE paciente_id = ?', [bea.pacienteId]);
      assert.match(tarea.titulo, /falta la plantilla aprobada «hueco_liberado»/);
      assert.deepEqual(deps.whatsapp.enviados, []);
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM citas WHERE estado = 'retenida'");
      assert.equal(n.n, 0, 'ningún hueco guardado para nadie');
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera en el panel: apuntar, ver y quitar', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  try {
    await sembrar(pool);
    const cookie = `iemec_sesion=${encodeURIComponent(firmar({ id: 1, email: 'recepcion@prueba', nombre: 'Recepción', rol: 'recepcion', hasta: Date.now() + 3600000 }))}`;
    const s = crearApp({ pool, deps }).listen(0);
    await new Promise((r) => s.once('listening', r));
    const base = `http://127.0.0.1:${s.address().port}/api/panel/lista-espera`;
    const pedir = (ruta, metodo = 'GET', cuerpo) => fetch(`${base}${ruta}`, { method: metodo, headers: { cookie, 'content-type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    try {
      const alta = await pedir('', 'POST', { telefono: '611 00 06 01', nombre: 'Rocío Ejemplo', tratamientoId: 'limpieza-facial', franja: 'tarde', desde: '2099-01-01' });
      assert.equal(alta.status, 201);
      const { id } = await alta.json();
      const [[p]] = await pool.query("SELECT nombre, apellidos FROM pacientes WHERE telefono = '+34611000601'");
      assert.deepEqual({ ...p }, { nombre: 'Rocío', apellidos: 'Ejemplo' }, 'ficha nueva con su móvil normalizado');

      const otra = await pedir('', 'POST', { telefono: '+34611000601', tratamientoId: 'limpieza-facial', franja: 'manana' });
      assert.equal(otra.status, 200, 'si ya esperaba ese tratamiento, se pone al día (no se duplica)');
      assert.equal((await otra.json()).id, id);

      assert.equal((await pedir('', 'POST', { telefono: '123', tratamientoId: 'limpieza-facial' })).status, 400);
      assert.equal((await pedir('', 'POST', { telefono: '611000602', nombre: 'Sin tratamiento', tratamientoId: 'no-existe' })).status, 400);

      const lista = await (await pedir('')).json();
      assert.equal(lista.entradas.length, 1);
      assert.deepEqual([lista.entradas[0].paciente, lista.entradas[0].franja, lista.entradas[0].telefonoFinal], ['Rocío E.', 'manana', '601']);
      assert.ok(lista.tratamientos.some((x) => x.id === 'limpieza-facial'));
      assert.deepEqual(lista.cifras, { esperando: 1, enCurso: 0, recuperados30d: 0 });

      assert.equal((await pedir(`/${id}`, 'DELETE')).status, 200);
      assert.equal((await entrada(pool, id)).estado, 'cancelado');
      assert.equal((await pedir(`/${id}`, 'DELETE')).status, 404);
      assert.equal((await fetch(base)).status, 401, 'sin sesión, nada');
    } finally {
      s.close();
    }
  } finally {
    await pool.end();
  }
});
