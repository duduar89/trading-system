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
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica'), (2, 'consulta-1', 'Consulta 1', 'consulta_medica'), (3, 'sala-capilar', 'Sala capilar', 'sala_capilar')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista'), (30, 'tricologia-1', 'Tricología 1', 'tricologo'), (10, 'medico-1', 'Médico 1', 'medico')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '20:00'), (10, ?, '11:00', '20:00')", [d, d]);
  // La tricóloga ya no tiene días en la agenda: de lo suyo no hay huecos.
  await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin, vigente_desde, vigente_hasta) VALUES (30, 3, '11:00', '20:00', '2026-09-01', '2026-09-30')");
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial'), ('medicina_capilar', 'Medicina capilar'), ('medicina_estetica', 'Medicina estética facial')");
  // La toxina (medicamento con receta) la agenda siempre una persona: reservable_ia = 0.
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, publicidad_restringida, reservable_ia) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 60, 10, 54, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, TRUE),
    ('valoracion-capilar', 'Valoración capilar', 'medicina_capilar', 45, 10, 0, 'tricologo', 'sala_capilar', 'servicio', FALSE, TRUE),
    ('toxina', 'Toxina botulínica', 'medicina_estetica', 30, 10, 300, 'medico', 'consulta_medica', 'medicamento_receta', TRUE, FALSE)`);
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

async function conCita(pool, { nombre, telefono, fecha, hora, tratamiento = 'limpieza-facial', pacienteId = null }) {
  const id = pacienteId || await paciente(pool, nombre, telefono);
  const cita = await agenda.reservar(pool, { pacienteId: id, tratamientoId: tratamiento, fecha, hora, origen: 'recepcion', ahora: DADA });
  return { pacienteId: id, cita };
}

async function enLista(pool, { nombre, telefono, desde = '2026-10-19', hasta = null, franja = null, citaActualId = null, tratamiento = 'limpieza-facial', pacienteId = null, ahora }) {
  const pid = pacienteId || await paciente(pool, nombre, telefono);
  const { id } = await LE.apuntar(pool, { pacienteId: pid, tratamientoId: tratamiento, desdeFecha: desde, hastaFecha: hasta, franja, citaActualId, origen: 'panel', creadoPor: 'recepcion@prueba', ahora });
  return { pacienteId: pid, id };
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
      assert.ok(r.respuesta.endsWith(`/c/${agenda.tokenDe(c)}`), 'el último enlace es el de su página');
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
      const c = await espera.vuelta(deps, { ahora: mas(lunes, 57) });
      assert.equal(c.caducadas, 1);
      assert.equal(c.ofrecidas, 0, 'un par de minutos de margen, por si su «sí» llegó al límite');
      const [oc] = await ofertasDe(pool, carla.id);
      assert.equal(oc.estado, 'caducada');
      assert.equal((await cita(pool, oc.cita_id)).estado, 'cancelada');
      assert.equal((await entrada(pool, carla.id)).estado, 'esperando', 'con una sin contestar, sigue en la lista');
      const i = await espera.vuelta(deps, { ahora: mas(lunes, 59) });
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
      assert.match(r.respuesta, /¡Hecho, Fabi! Te he cambiado la cita: te esperamos el martes 27 de octubre a las 12:00 en IEMEC .+ La del viernes 30 de octubre a las 12:00 queda anulada: si la tenías en tu calendario, bórrala\./);
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

test('lista de espera: con WhatsApp caído no se guarda nada, nadie pierde su turno y se reintenta a los pocos minutos', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const caido = {
    modo: 'simulado', enviados: [], intentos: 0,
    async enviarTexto() { this.intentos++; throw new Error('WhatsApp caído'); },
    async enviarPlantilla() { this.intentos++; throw new Error('WhatsApp caído'); },
  };
  const bien = crearWhatsApp('simulado');
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z'); // lunes 10:00 en Madrid
    const ana = await enLista(pool, { nombre: 'Ana', telefono: '+34611000701', ahora: mas(lunes, -60) });
    const bea = await enLista(pool, { nombre: 'Bea', telefono: '+34611000702', ahora: mas(lunes, -50) });
    const carla = await enLista(pool, { nombre: 'Carla', telefono: '+34611000703', ahora: mas(lunes, -40) });
    const x = await conCita(pool, { nombre: 'Xena', telefono: '+34611000711', fecha: '2026-10-21', hora: '17:00' });
    await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: mas(lunes, 1) });

    const i = await espera.vuelta({ pool, ia: crearIa('simulado'), whatsapp: caido }, { ahora: mas(lunes, 2) });
    assert.equal(i.ofrecidas, 0);
    assert.equal(caido.intentos, 1);
    assert.deepEqual(await ofertasDe(pool, ana.id), [], 'no le ha llegado nada: como si no se le hubiera ofrecido');
    for (const e of [ana, bea, carla]) assert.equal((await entrada(pool, e.id)).estado, 'esperando');
    const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM citas WHERE estado = 'retenida'");
    assert.equal(n.n, 0, 'el hueco no se queda guardado para nadie');
    const [[conv]] = await pool.query("SELECT estado FROM conversaciones WHERE telefono = '+34611000701'");
    assert.equal(conv.estado, 'cerrada', 'la conversación del aviso fallido no se queda abierta sin próximo paso');

    // Los minutos siguientes no se prueba con las demás: se espera un poco y se reintenta con la primera.
    for (const m of [3, 4, 5]) assert.equal((await espera.vuelta({ pool, ia: crearIa('simulado'), whatsapp: caido }, { ahora: mas(lunes, m) })).ofrecidas, 0);
    assert.equal(caido.intentos, 1);
    const vuelve = await espera.vuelta({ pool, ia: crearIa('simulado'), whatsapp: bien }, { ahora: mas(lunes, 8) });
    assert.equal(vuelve.ofrecidas, 1);
    assert.equal(bien.enviados.at(-1).telefono, '+34611000701', 'WhatsApp ha vuelto: el hueco es para Ana');
  } finally {
    await pool.end();
  }
});

test('lista de espera: sin la plantilla aprobada, una tarea por hueco y nadie pierde su turno', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z');
    const personas = [];
    for (const [i, nombre] of ['Ana', 'Bea', 'Carla', 'Dani'].entries()) personas.push(await enLista(pool, { nombre, telefono: `+3461100072${i}`, ahora: mas(lunes, -60 + i) }));
    const x = await conCita(pool, { nombre: 'Xena', telefono: '+34611000731', fecha: '2026-10-21', hora: '17:00' });
    await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora: mas(lunes, 1) });
    await pool.query("UPDATE plantillas SET estado = 'pausada' WHERE uso = 'hueco_liberado'");

    for (let m = 2; m <= 5; m++) assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, m) })).ofrecidas, 0);
    const [tareas] = await pool.query('SELECT titulo, paciente_id FROM tareas');
    assert.equal(tareas.length, 1, 'una tarea por hueco, no una por persona y minuto');
    assert.match(tareas[0].titulo, /falta la plantilla aprobada «hueco_liberado»/);
    assert.equal(tareas[0].paciente_id, personas[0].pacienteId, 'para avisar a la primera');
    const [[o]] = await pool.query('SELECT COUNT(*) AS n FROM lista_espera_ofertas');
    assert.equal(o.n, 0);
    for (const p of personas) assert.equal((await entrada(pool, p.id)).estado, 'esperando');
    const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM citas WHERE estado = 'retenida'");
    assert.equal(n.n, 0, 'ningún hueco guardado para nadie');
    assert.deepEqual(whatsapp.enviados, []);

    // Meta aprueba la plantilla: el hueco sigue siendo de la primera.
    await pool.query("UPDATE plantillas SET estado = 'aprobada' WHERE uso = 'hueco_liberado'");
    assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 6) })).ofrecidas, 1);
    assert.equal(whatsapp.enviados.at(-1).telefono, '+34611000720');
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
    // Con las passkeys la sesión se comprueba en la base: la persona de la cookie tiene que existir.
    await pool.query("INSERT INTO usuarios (id, email, nombre, rol) VALUES (1, 'recepcion@prueba', 'Recepción', 'recepcion')");
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

      // Un fijo no tiene WhatsApp: los avisos no le llegarían.
      const fijo = await pedir('', 'POST', { telefono: '916 33 44 55', nombre: 'Carmen Fija', tratamientoId: 'limpieza-facial' });
      assert.equal(fijo.status, 400);
      assert.deepEqual(await fijo.json(), { error: 'Ese teléfono es un fijo y los avisos de la lista de espera van por WhatsApp: indica su móvil', codigo: 'FIJO' });

      // Un móvil mal tecleado que es de otra paciente: se avisa antes de apuntarla (le llegaría a ella).
      await pool.query("INSERT INTO pacientes (nombre, apellidos, telefono) VALUES ('Marta', 'Gil', '+34611000603')");
      const otra2 = await pedir('', 'POST', { telefono: '611 00 06 03', nombre: 'Laura Pérez', tratamientoId: 'limpieza-facial' });
      assert.equal(otra2.status, 409);
      assert.deepEqual(await otra2.json(), { error: 'Ese móvil es de Marta G.: si es a quien quieres apuntar, confírmalo; si no, revisa el número', codigo: 'OTRO_PACIENTE', paciente: 'Marta G.' });
      const [[nadie]] = await pool.query("SELECT COUNT(*) AS n FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id WHERE p.telefono = '+34611000603'");
      assert.equal(nadie.n, 0);
      const confirmada = await pedir('', 'POST', { telefono: '611 00 06 03', nombre: 'Laura Pérez', tratamientoId: 'limpieza-facial', confirmado: true });
      assert.equal(confirmada.status, 201);
      assert.equal((await confirmada.json()).paciente, 'Marta G.', 'la respuesta dice a quién se ha apuntado');
      assert.equal((await pedir('', 'POST', { telefono: '611000603', nombre: 'marta', tratamientoId: 'valoracion-capilar' })).status, 201, 'su nombre, sin tildes ni mayúsculas, vale');

      // Para adelantar su cita hay que decirlo: se enlaza la que tiene de ese tratamiento.
      const { pacienteId: pid } = await conCita(pool, { nombre: 'Nora', telefono: '+34611000604', fecha: '2026-10-30', hora: '12:00' });
      assert.equal((await pedir('', 'POST', { telefono: '611000605', nombre: 'Olga Nueva', tratamientoId: 'limpieza-facial', adelantar: true })).status, 400, 'sin cita que adelantar');
      const adelantar = await pedir('', 'POST', { telefono: '611000604', tratamientoId: 'limpieza-facial', adelantar: true });
      assert.equal(adelantar.status, 201);
      const [[en]] = await pool.query('SELECT le.cita_actual_id, c.paciente_id FROM lista_espera le JOIN citas c ON c.id = le.cita_actual_id WHERE le.id = ?', [(await adelantar.json()).id]);
      assert.equal(en.paciente_id, pid);

      const lista = await (await pedir('')).json();
      assert.equal(lista.entradas.length, 4);
      assert.deepEqual([lista.entradas[0].paciente, lista.entradas[0].franja, lista.entradas[0].telefonoFinal], ['Rocío E.', 'manana', '601']);
      assert.ok(lista.entradas.find((e) => e.paciente === 'Nora').citaActual, 'la de Nora quiere adelantar su cita');
      assert.ok(lista.tratamientos.some((x) => x.id === 'limpieza-facial'));
      assert.deepEqual(lista.cifras, { esperando: 4, enCurso: 0, recuperados30d: 0 });

      assert.equal((await pedir(`/${id}`, 'DELETE')).status, 200);
      assert.equal((await entrada(pool, id)).estado, 'cancelado');
      assert.equal((await pedir(`/${id}`, 'DELETE')).status, 404);
      assert.equal((await fetch(base)).status, 401, 'sin sesión, nada');

      // El índice de «sus apuntes» es el compuesto (paciente y estado), no el de la clave foránea.
      const [indices] = await pool.query("SHOW INDEX FROM lista_espera WHERE Key_name = 'le_paciente_estado'");
      assert.deepEqual(indices.map((x) => x.Column_name), ['paciente_id', 'estado']);
    } finally {
      s.close();
    }
  } finally {
    await pool.end();
  }
});

// Se libera la cita de otra paciente (la de relleno) y el cron se lo ofrece a quien toque.
async function liberar(pool, deps, { fecha, hora, tratamiento = 'limpieza-facial', telefono, ahora }) {
  const x = await conCita(pool, { nombre: 'Relleno', telefono, fecha, hora, tratamiento });
  await agenda.cancelar(pool, { id: x.cita.id, por: 'paciente', ahora });
  return espera.vuelta(deps, { ahora: mas(ahora, 1) });
}

const ofertaViva = async (pool, entradaId) => (await pool.query("SELECT * FROM lista_espera_ofertas WHERE lista_espera_id = ? AND estado = 'ofrecida'", [entradaId]))[0][0];

test('lista de espera: apuntarse por WhatsApp', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z'); // lunes 10:00 en Madrid
    // Cerrado hasta el miércoles: lo primero libre es el jueves.
    await pool.query("INSERT INTO cierres (desde, hasta, motivo) VALUES ('2026-10-18 22:00:00', '2026-10-21 22:00:00', 'Formación (ejemplo)')");

    await t.test('con un solo hueco propuesto, «Sí, avísame» apunta y no reserva ese hueco', async () => {
      await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000801', 'Mara Sol', 'meta_formulario', 'limpieza-facial')");
      const r1 = await R.procesarEntrante(deps, { telefono: '+34611000801', texto: '¿Tenéis hueco el jueves a las 17:00?', ahora: lunes });
      assert.equal(r1.respuesta, 'Soy el asistente virtual de IEMEC. El jueves 22 de octubre a las 17:00 lo tengo libre, Mara. ¿Te lo reservo?');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000801', texto: '¿No hay nada antes?', ahora: mas(lunes, 2) });
      assert.equal(r2.respuesta, 'Antes del jueves 22 de octubre no me queda nada libre, Mara. ¿Quieres que te avise si se libera un hueco antes? Mientras, los que te propuse siguen disponibles.');
      const r3 = await R.procesarEntrante(deps, { telefono: '+34611000801', texto: 'Sí, avísame', ahora: mas(lunes, 4) });
      assert.equal(r3.listaEspera, 'apuntado');
      assert.equal(r3.respuesta, '¡Apuntado, Mara! Si se libera un hueco antes del jueves 22 de octubre, te lo guardo y te aviso por aquí. Si mientras quieres asegurarte uno de los que te propuse, dime cuál.');
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE p.telefono = '+34611000801'");
      assert.equal(n.n, 0, 'no se le reserva un hueco que no ha pedido');
      const [[e]] = await pool.query("SELECT le.* FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id WHERE p.telefono = '+34611000801'");
      assert.equal(dia(e.hasta_fecha), '2026-10-21');
      // Y si después dice cuál, se le reserva: ya tiene cita, así que su apunte pasa a ser «adelantarla».
      const r4 = await R.procesarEntrante(deps, { telefono: '+34611000801', texto: 'Bueno, mientras resérvame el del jueves', ahora: mas(lunes, 6) });
      assert.equal(r4.eleccion, 'reservada');
      assert.equal((await entrada(pool, e.id)).cita_actual_id, r4.cita.id);
    });

    await t.test('«Sí, pero solo por las tardes y hasta el viernes 30»: se apunta con su franja y sus fechas', async () => {
      await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000802', 'Hugo Rey', 'meta_formulario', 'valoracion-capilar')");
      const r1 = await R.procesarEntrante(deps, { telefono: '+34611000802', texto: '¿Tenéis hueco el jueves?', ahora: mas(lunes, 10) });
      assert.equal(r1.eleccion, 'sin_huecos');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000802', texto: 'Sí, pero solo por las tardes y hasta el viernes 30', ahora: mas(lunes, 12) });
      assert.equal(r2.listaEspera, 'apuntado');
      const [[e]] = await pool.query("SELECT le.* FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id WHERE p.telefono = '+34611000802'");
      assert.deepEqual([e.franjas, dia(e.desde_fecha), dia(e.hasta_fecha)], ['tarde', '2026-10-22', '2026-10-30']);
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera: su cita solo se adelanta si se apuntó para eso, y diciéndoselo', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z');
    const tina = await conCita(pool, { nombre: 'Tina', telefono: '+34611000811', fecha: '2026-10-30', hora: '12:00' });
    await enLista(pool, { pacienteId: tina.pacienteId, desde: '2026-10-19', ahora: mas(lunes, -60) });
    const sole = await conCita(pool, { nombre: 'Sole', telefono: '+34611000812', fecha: '2026-10-20', hora: '12:00' });
    await enLista(pool, { pacienteId: sole.pacienteId, desde: '2026-10-26', ahora: mas(lunes, -50) });

    await t.test('con otra cita del mismo tratamiento sin enlazar, el hueco es una cita más: la suya no se toca', async () => {
      assert.equal((await liberar(pool, deps, { fecha: '2026-10-22', hora: '12:00', telefono: '+34611000821', ahora: lunes })).ofrecidas, 1);
      assert.equal(whatsapp.enviados.at(-1).telefono, '+34611000811');
      const r = await R.procesarEntrante(deps, { telefono: '+34611000811', texto: 'Sí, guárdamelo', ahora: mas(lunes, 5) });
      assert.equal(r.listaEspera, 'aceptada');
      assert.equal(r.reprograma, null);
      assert.doesNotMatch(r.respuesta, /anulada/);
      assert.equal((await cita(pool, tina.cita.id)).estado, 'confirmada', 'la del 30 era otra sesión');
      assert.equal((await cita(pool, r.citaId)).estado, 'confirmada');
    });

    await t.test('y un hueco después de la cita que ya tiene también le vale', async () => {
      assert.equal((await liberar(pool, deps, { fecha: '2026-10-27', hora: '17:00', telefono: '+34611000822', ahora: mas(lunes, 10) })).ofrecidas, 1);
      assert.equal(whatsapp.enviados.at(-1).telefono, '+34611000812', 'Sole tiene cita el 20, pero espera otra desde el 26');
    });

    await t.test('se apuntó para adelantarla y el aviso fue la plantilla: antes de cambiársela, se le pregunta', async () => {
      const fabi = await conCita(pool, { nombre: 'Fabi', telefono: '+34611000813', fecha: '2026-10-30', hora: '17:00' });
      await enLista(pool, { pacienteId: fabi.pacienteId, citaActualId: fabi.cita.id, ahora: mas(lunes, 15) });
      assert.equal((await liberar(pool, deps, { fecha: '2026-10-28', hora: '12:00', telefono: '+34611000823', ahora: mas(lunes, 20) })).ofrecidas, 1);
      const m = whatsapp.enviados.at(-1);
      assert.deepEqual([m.telefono, m.nombre], ['+34611000813', 'iemec_hueco_liberado']);
      const r1 = await R.procesarEntrante(deps, { telefono: '+34611000813', texto: 'Sí, guárdamelo', ahora: mas(lunes, 25) });
      assert.match(r1.respuesta, /Antes de guardártelo, Fabi: ahora tienes cita el viernes 30 de octubre a las 17:00\. ¿Te la cambio al miércoles 28 de octubre a las 12:00\? La que tienes ahora quedaría anulada\.$/);
      assert.equal((await cita(pool, fabi.cita.id)).estado, 'confirmada', 'sin su «sí» a cambiarla, no se toca');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000813', texto: 'Sí', ahora: mas(lunes, 27) });
      assert.equal(r2.listaEspera, 'aceptada');
      assert.equal(r2.reprograma, fabi.cita.id);
      assert.match(r2.respuesta, /Te he cambiado la cita: te esperamos el miércoles 28 de octubre a las 12:00 .+ La del viernes 30 de octubre a las 17:00 queda anulada: si la tenías en tu calendario, bórrala\./);
      assert.equal((await cita(pool, fabi.cita.id)).estado, 'reprogramada');
    });

    await t.test('si a «¿Te la cambio?» dice que no, su cita sigue como está y el hueco pasa al siguiente', async () => {
      const gil = await conCita(pool, { nombre: 'Gil', telefono: '+34611000814', fecha: '2026-10-30', hora: '18:30' });
      const eg = await enLista(pool, { pacienteId: gil.pacienteId, citaActualId: gil.cita.id, ahora: mas(lunes, 30) });
      assert.equal((await liberar(pool, deps, { fecha: '2026-10-29', hora: '12:00', telefono: '+34611000824', ahora: mas(lunes, 31) })).ofrecidas, 1);
      const [o] = await ofertasDe(pool, eg.id);
      await R.procesarEntrante(deps, { telefono: '+34611000814', texto: 'Sí, guárdamelo', ahora: mas(lunes, 34) });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000814', texto: 'No, prefiero la mía', ahora: mas(lunes, 35) });
      assert.equal(r.respuesta, 'Sin problema, Gil: tu cita del viernes 30 de octubre a las 18:30 sigue como está. Si se libera otro hueco antes, te aviso.');
      assert.equal((await cita(pool, gil.cita.id)).estado, 'confirmada');
      assert.equal((await cita(pool, o.cita_id)).estado, 'cancelada');
      assert.equal((await ofertasDe(pool, eg.id))[0].estado, 'rechazada');
      assert.equal((await entrada(pool, eg.id)).estado, 'esperando');
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera: con dos cabinas, la que se libera se ofrece aunque la otra siga ocupada a esa hora', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  try {
    await sembrar(pool);
    await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (4, 'cabina-facial-2', 'Cabina facial 2', 'cabina_estetica')");
    await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (21, 'estetica-2', 'Estética 2', 'esteticista')");
    for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (21, ?, '11:00', '20:00')", [d]);
    const lunes = new Date('2026-10-19T08:00:00Z');
    const a = await conCita(pool, { nombre: 'Xana', telefono: '+34611000831', fecha: '2026-10-21', hora: '17:00' });
    const b = await conCita(pool, { nombre: 'Xiana', telefono: '+34611000832', fecha: '2026-10-21', hora: '17:00' });
    assert.notEqual(a.cita.salaId, b.cita.salaId);
    const ana = await enLista(pool, { nombre: 'Ana', telefono: '+34611000833', ahora: mas(lunes, -60) });
    await agenda.cancelar(pool, { id: a.cita.id, por: 'paciente', ahora: lunes });
    assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 1) })).ofrecidas, 1);
    const o = await ofertaViva(pool, ana.id);
    assert.equal(madrid(o.inicio), '2026-10-21 17:00');
  } finally {
    await pool.end();
  }
});

test('lista de espera: lo que contesta a la oferta', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z');
    // Cada una espera un solo día: así cada hueco que se libera es para quien toca.
    const solo = (nombre, telefono, fecha, extra = {}) => enLista(pool, { nombre, telefono, desde: fecha, hasta: fecha, ahora: mas(lunes, -60), ...extra });

    await t.test('«No, ¿tenéis algo el viernes?»: suelta este hueco y le propone el viernes', async () => {
      const ana = await solo('Ana', '+34611000841', '2026-10-21');
      await liberar(pool, deps, { fecha: '2026-10-21', hora: '17:00', telefono: '+34611000851', ahora: lunes });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000841', texto: 'No, ¿tenéis algo el viernes?', ahora: mas(lunes, 5) });
      assert.equal(r.eleccion, 'propuesta');
      assert.ok(r.huecos.length >= 1 && r.huecos.every((h) => h.fecha === '2026-10-23'), JSON.stringify(r.huecos));
      assert.equal((await ofertasDe(pool, ana.id))[0].estado, 'rechazada');
      assert.equal((await entrada(pool, ana.id)).estado, 'esperando');
    });

    await t.test('«No puedo ese día, ¿y el jueves por la tarde?»: el jueves por la tarde', async () => {
      await solo('Berta', '+34611000842', '2026-10-20');
      await liberar(pool, deps, { fecha: '2026-10-20', hora: '12:00', telefono: '+34611000852', ahora: mas(lunes, 10) });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000842', texto: 'No puedo ese día, ¿y el jueves por la tarde?', ahora: mas(lunes, 15) });
      assert.ok(r.huecos.length >= 1 && r.huecos.every((h) => h.fecha === '2026-10-22' && h.hora >= '15:00'), JSON.stringify(r.huecos));
    });

    await t.test('«Quítame de la lista de espera» le saca de la lista, no es una baja de todo', async () => {
      const carla = await solo('Carla', '+34611000843', '2026-10-23');
      await liberar(pool, deps, { fecha: '2026-10-23', hora: '12:00', telefono: '+34611000853', ahora: mas(lunes, 20) });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000843', texto: 'Quítame de la lista de espera, ya no lo necesito', ahora: mas(lunes, 22) });
      assert.equal(r.listaEspera, 'fuera');
      assert.match(r.respuesta, /te saco de la lista de espera/);
      assert.equal((await entrada(pool, carla.id)).estado, 'cancelado');
      assert.equal((await ofertasDe(pool, carla.id))[0].estado, 'anulada');
      const [[p]] = await pool.query('SELECT baja_comercial_en FROM pacientes WHERE id = ?', [carla.pacienteId]);
      assert.equal(p.baja_comercial_en, null);

      // Si además pide que no le escribamos, es una baja.
      const dani = await solo('Dani', '+34611000844', '2026-10-24');
      await liberar(pool, deps, { fecha: '2026-10-24', hora: '12:00', telefono: '+34611000854', ahora: mas(lunes, 25) });
      await R.procesarEntrante(deps, { telefono: '+34611000844', texto: 'Quítame de la lista de espera y no me escribáis más', ahora: mas(lunes, 27) });
      assert.equal((await entrada(pool, dani.id)).estado, 'cancelado');
      const [[pd]] = await pool.query('SELECT baja_comercial_en FROM pacientes WHERE id = ?', [dani.pacienteId]);
      assert.ok(pd.baja_comercial_en);
    });

    await t.test('lo que agenda una persona (toxina): si pide otro día, pasa a una persona; el aviso no nombra el medicamento', async () => {
      const eva = await solo('Eva', '+34611000845', '2026-10-26', { tratamiento: 'toxina' });
      assert.equal((await liberar(pool, deps, { fecha: '2026-10-26', hora: '12:00', tratamiento: 'toxina', telefono: '+34611000855', ahora: mas(lunes, 30) })).ofrecidas, 1);
      const m = whatsapp.enviados.at(-1);
      assert.deepEqual(m.variables.slice(0, 2), ['Eva', 'tu medicina estética facial']);
      const r = await R.procesarEntrante(deps, { telefono: '+34611000845', texto: '¿Y el martes a las 12:00?', ahora: mas(lunes, 33) });
      assert.match(r.respuesta, /Una persona del equipo te propone otro día por aquí enseguida\.$/);
      const [[conv]] = await pool.query('SELECT estado FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.equal(conv.estado, 'espera_persona');
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r.conversacionId]);
      assert.match(tarea.titulo, /toxina botulínica/i);
      const [citasIa] = await pool.query("SELECT id FROM citas WHERE paciente_id = ? AND estado = 'confirmada'", [eva.pacienteId]);
      assert.deepEqual(citasIa, [], 'la IA no le reserva nada');
      assert.equal((await ofertasDe(pool, eva.id))[0].estado, 'rechazada');
    });

    await t.test('aceptar un hueco desde la conversación de un presupuesto no acepta el presupuesto', async () => {
      const fe = await solo('Fe', '+34611000846', '2026-10-27');
      const [pr] = await pool.query("INSERT INTO presupuestos (paciente_id, titulo, importe_eur, estado, entregado_en) VALUES (?, 'Toxina (ejemplo)', 300, 'entregado', ?)", [fe.pacienteId, mas(lunes, -3 * 1440)]);
      await pool.query("INSERT INTO presupuesto_lineas (presupuesto_id, tratamiento_id, concepto, importe_eur) VALUES (?, 'toxina', 'Toxina', 300)", [pr.insertId]);
      const [conv] = await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado, contexto, contexto_id) VALUES ('+34611000846', ?, 'esperando_paciente', 'presupuesto', ?)", [fe.pacienteId, pr.insertId]);
      await liberar(pool, deps, { fecha: '2026-10-27', hora: '12:00', telefono: '+34611000856', ahora: mas(lunes, 40) });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000846', texto: 'Sí, guárdamelo', ahora: mas(lunes, 42) });
      assert.equal(r.conversacionId, conv.insertId);
      assert.equal(r.listaEspera, 'aceptada');
      const [[p]] = await pool.query('SELECT estado FROM presupuestos WHERE id = ?', [pr.insertId]);
      assert.equal(p.estado, 'entregado');
      const [[c]] = await pool.query('SELECT estado FROM conversaciones WHERE id = ?', [conv.insertId]);
      assert.equal(c.estado, 'esperando_paciente');
      const [[s]] = await pool.query("SELECT COUNT(*) AS n FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [conv.insertId]);
      assert.equal(s.n, 1);
    });

    await t.test('guardarle el hueco no acaba sus secuencias; confirmarlo, sí', async () => {
      const gloria = await solo('Gloria', '+34611000847', '2026-10-28');
      const [ins] = await pool.query("INSERT INTO inscripciones (secuencia, paciente_id, inicio, siguiente_en) VALUES ('toca_repetir', ?, ?, ?)", [gloria.pacienteId, mas(lunes, -1440), mas(lunes, 5 * 1440)]);
      await liberar(pool, deps, { fecha: '2026-10-28', hora: '12:00', telefono: '+34611000857', ahora: mas(lunes, 50) });
      const estadoIns = async () => (await pool.query('SELECT estado, motivo_fin FROM inscripciones WHERE id = ?', [ins.insertId]))[0][0];
      assert.equal((await estadoIns()).estado, 'activa', 'guardado no es cita');
      await R.procesarEntrante(deps, { telefono: '+34611000847', texto: 'Sí, guárdamelo', ahora: mas(lunes, 52) });
      assert.deepEqual({ ...(await estadoIns()) }, { estado: 'terminada', motivo_fin: 'cita' });
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera: sin contestar', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z');

    await t.test('un «sí» que llega justo al caducar se lee antes de pasar el hueco a la siguiente', async () => {
      const hana = await enLista(pool, { nombre: 'Hana', telefono: '+34611000861', desde: '2026-10-31', hasta: '2026-10-31', ahora: mas(lunes, -60) });
      await enLista(pool, { nombre: 'Iris', telefono: '+34611000862', desde: '2026-10-31', hasta: '2026-10-31', ahora: mas(lunes, -50) });
      assert.equal((await liberar(pool, deps, { fecha: '2026-10-31', hora: '12:00', telefono: '+34611000871', ahora: lunes })).ofrecidas, 1);
      const caduca = mas(lunes, 31);
      const v = await espera.vuelta(deps, { ahora: caduca });
      assert.equal(v.caducadas, 1);
      assert.equal(v.ofrecidas, 0, 'aún no pasa a Iris');
      const r = await R.procesarEntrante(deps, { telefono: '+34611000861', texto: 'Sí, guárdamelo', ahora: mas(caduca, 1) });
      assert.equal(r.listaEspera, 'aceptada');
      assert.equal((await entrada(pool, hana.id)).estado, 'aceptado');
    });

    await t.test('si no contesta, al rato pasa a la siguiente', async () => {
      const jara = await enLista(pool, { nombre: 'Jara', telefono: '+34611000863', desde: '2026-11-02', hasta: '2026-11-02', ahora: mas(lunes, -40) });
      const kira = await enLista(pool, { nombre: 'Kira', telefono: '+34611000864', desde: '2026-11-02', hasta: '2026-11-02', ahora: mas(lunes, -30) });
      const t0 = mas(lunes, 60);
      await liberar(pool, deps, { fecha: '2026-11-02', hora: '12:00', telefono: '+34611000872', ahora: t0 });
      assert.equal((await espera.vuelta(deps, { ahora: mas(t0, 31) })).ofrecidas, 0);
      assert.equal((await espera.vuelta(deps, { ahora: mas(t0, 34) })).ofrecidas, 1);
      assert.ok(await ofertaViva(pool, kira.id));
      assert.equal((await entrada(pool, jara.id)).estado, 'esperando');
      // Contesta tarde que no: ya no hay nada que soltar, pero contestó.
      const r = await R.procesarEntrante(deps, { telefono: '+34611000863', texto: 'No me viene bien', ahora: mas(t0, 40) });
      assert.equal(r.listaEspera, 'rechazada');
      const [[oj]] = await pool.query('SELECT estado, respondida_en FROM lista_espera_ofertas WHERE lista_espera_id = ?', [jara.id]);
      assert.equal(oj.estado, 'caducada');
      assert.ok(oj.respondida_en, 'no cuenta como «sin contestar»');
    });

    await t.test('quien ya salió por no contestar y contesta «no»: se le dice, y puede volver a apuntarse', async () => {
      const dora = await enLista(pool, { nombre: 'Dora', telefono: '+34611000865', desde: '2026-11-03', hasta: '2026-11-04', ahora: mas(lunes, -20) });
      const t0 = mas(lunes, 120);
      await liberar(pool, deps, { fecha: '2026-11-03', hora: '12:00', telefono: '+34611000873', ahora: t0 });
      await espera.vuelta(deps, { ahora: mas(t0, 32) });
      await liberar(pool, deps, { fecha: '2026-11-04', hora: '12:00', telefono: '+34611000874', ahora: mas(t0, 33) });
      await espera.vuelta(deps, { ahora: mas(t0, 66) });
      assert.equal((await entrada(pool, dora.id)).estado, 'caducado');
      const r = await R.procesarEntrante(deps, { telefono: '+34611000865', texto: 'No, gracias', ahora: mas(t0, 70) });
      assert.equal(r.respuesta, 'Soy el asistente virtual de IEMEC. Sin problema, Dora. Ya no estabas en la lista de espera (no nos llegó respuesta a los últimos avisos). Si quieres que te vuelva a apuntar, dímelo.');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000865', texto: 'Sí, apúntame otra vez', ahora: mas(t0, 72) });
      assert.equal(r2.listaEspera, 'apuntado');
      const [[nueva]] = await pool.query("SELECT estado FROM lista_espera WHERE paciente_id = ? AND id <> ?", [dora.pacienteId, dora.id]);
      assert.equal(nueva.estado, 'esperando');
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera: si la conversación pasa a una persona, recepción acepta o rechaza desde el panel', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z');
    await pool.query("INSERT INTO usuarios (id, email, nombre, rol) VALUES (1, 'recepcion@prueba', 'Recepción', 'recepcion')");
    const cookie = `iemec_sesion=${encodeURIComponent(firmar({ id: 1, email: 'recepcion@prueba', nombre: 'Recepción', rol: 'recepcion', hasta: Date.now() + 3600000 }))}`;
    const s = crearApp({ pool, deps }).listen(0);
    await new Promise((r) => s.once('listening', r));
    const base = `http://127.0.0.1:${s.address().port}/api/panel/lista-espera`;
    const pedir = (ruta, metodo = 'GET', cuerpo) => fetch(`${base}${ruta}`, { method: metodo, headers: { cookie, 'content-type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    try {
      await t.test('contesta algo que lleva una persona: tarea urgente, media hora más y se acepta desde el panel', async () => {
        const kira = await enLista(pool, { nombre: 'Kira', telefono: '+34611000881', desde: '2026-10-21', hasta: '2026-10-21', ahora: mas(lunes, -60) });
        await liberar(pool, deps, { fecha: '2026-10-21', hora: '12:00', telefono: '+34611000891', ahora: lunes });
        const o = await ofertaViva(pool, kira.id);
        const r = await R.procesarEntrante(deps, { telefono: '+34611000881', texto: 'Sí, pero estoy embarazada, ¿me lo puedo hacer?', ahora: mas(lunes, 20) });
        const [[conv]] = await pool.query('SELECT estado FROM conversaciones WHERE id = ?', [r.conversacionId]);
        assert.equal(conv.estado, 'espera_persona');
        await espera.vuelta(deps, { ahora: mas(lunes, 21) });
        await espera.vuelta(deps, { ahora: mas(lunes, 22) });
        const [tareas] = await pool.query("SELECT titulo, urgente FROM tareas WHERE titulo LIKE 'Lista de espera:%' AND paciente_id = ?", [kira.pacienteId]);
        assert.equal(tareas.length, 1, 'una sola');
        assert.match(tareas[0].titulo, /^Lista de espera: tiene guardado el hueco del miércoles 21 de octubre a las 12:00 hasta las 10:51/);
        assert.equal(tareas[0].urgente, 1);
        const viva = await ofertaViva(pool, kira.id);
        assert.equal(new Date(viva.caduca_en).getTime(), mas(lunes, 51).getTime(), 'ha escrito: se le guarda media hora más');
        assert.equal(new Date((await cita(pool, o.cita_id)).retenida_hasta).getTime(), mas(lunes, 51).getTime());

        const lista = await (await pedir('')).json();
        assert.equal(lista.ofertas.find((x) => x.id === o.id).conPersona, true);
        const acepta = await pedir(`/ofertas/${o.id}/aceptar`, 'POST');
        assert.equal(acepta.status, 200);
        assert.equal((await cita(pool, o.cita_id)).estado, 'confirmada');
        assert.equal((await entrada(pool, kira.id)).estado, 'aceptado');
        const [[tarea]] = await pool.query("SELECT estado FROM tareas WHERE titulo LIKE 'Lista de espera:%' AND paciente_id = ?", [kira.pacienteId]);
        assert.equal(tarea.estado, 'hecha');
        assert.equal((await pedir(`/ofertas/${o.id}/aceptar`, 'POST')).status, 409, 'ya está aceptada');
      });

      await t.test('recepción toma la conversación y la rechaza desde el panel: el hueco pasa al siguiente', async () => {
        const lola = await enLista(pool, { nombre: 'Lola', telefono: '+34611000882', desde: '2026-10-22', hasta: '2026-10-22', ahora: mas(lunes, -50) });
        const mia = await enLista(pool, { nombre: 'Mia', telefono: '+34611000883', desde: '2026-10-22', hasta: '2026-10-22', ahora: mas(lunes, -40) });
        await liberar(pool, deps, { fecha: '2026-10-22', hora: '12:00', telefono: '+34611000892', ahora: mas(lunes, 60) });
        const o = await ofertaViva(pool, lola.id);
        await pool.query("UPDATE conversaciones SET estado = 'persona' WHERE id = ?", [o.conversacion_id]);
        await espera.vuelta(deps, { ahora: mas(lunes, 63) });
        assert.equal(new Date((await ofertaViva(pool, lola.id)).caduca_en).getTime(), new Date(o.caduca_en).getTime(), 'no ha escrito: su media hora de siempre');
        assert.equal((await pedir(`/ofertas/${o.id}/rechazar`, 'POST')).status, 200);
        assert.equal((await ofertasDe(pool, lola.id))[0].estado, 'rechazada');
        assert.equal((await cita(pool, o.cita_id)).estado, 'cancelada');
        assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 65) })).ofrecidas, 1, 'a Mia');

        // Mia contesta con algo que lleva una persona y nadie lo resuelve: caduca, pero no cuenta como «sin contestar».
        const om = await ofertaViva(pool, mia.id);
        await R.procesarEntrante(deps, { telefono: '+34611000883', texto: 'Tengo una queja con la última vez', ahora: mas(lunes, 70) });
        await espera.vuelta(deps, { ahora: mas(lunes, 71) });
        const v = await espera.vuelta(deps, { ahora: mas(lunes, 102) });
        assert.equal(v.caducadas, 1);
        const [[oc]] = await pool.query('SELECT estado, respondida_en FROM lista_espera_ofertas WHERE id = ?', [om.id]);
        assert.equal(oc.estado, 'caducada');
        assert.ok(oc.respondida_en, 'escribió: no cuenta como sin contestar');
        assert.equal((await entrada(pool, mia.id)).estado, 'esperando');
      });

      await t.test('si Meta avisa de que el aviso no le llegó, el hueco pasa al siguiente y recepción le llama', async () => {
        const nuria = await enLista(pool, { nombre: 'Nuria', telefono: '+34611000884', desde: '2026-10-23', hasta: '2026-10-23', ahora: mas(lunes, -30) });
        await enLista(pool, { nombre: 'Olivia', telefono: '+34611000885', desde: '2026-10-23', hasta: '2026-10-23', ahora: mas(lunes, -20) });
        await liberar(pool, deps, { fecha: '2026-10-23', hora: '12:00', telefono: '+34611000893', ahora: mas(lunes, 110) });
        const o = await ofertaViva(pool, nuria.id);
        assert.ok(o.mensaje_id);
        assert.equal(await LE.ofertaNoEntregada(pool, { mensajeId: o.mensaje_id, ahora: mas(lunes, 112) }), o.id);
        assert.equal((await ofertasDe(pool, nuria.id))[0].estado, 'anulada');
        assert.equal((await cita(pool, o.cita_id)).estado, 'cancelada');
        assert.equal((await entrada(pool, nuria.id)).estado, 'esperando');
        const [[tarea]] = await pool.query("SELECT tipo, titulo FROM tareas WHERE paciente_id = ?", [nuria.pacienteId]);
        assert.equal(tarea.tipo, 'llamar');
        assert.match(tarea.titulo, /no le ha llegado por WhatsApp el aviso del hueco del viernes 23 de octubre a las 12:00/);
        assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 113) })).ofrecidas, 1, 'a Olivia');
      });
    } finally {
      s.close();
    }
  } finally {
    await pool.end();
  }
});
