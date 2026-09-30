'use strict';
// Cambiar la cita por WhatsApp sin pasar por nadie: se le proponen huecos del mismo tratamiento,
// elige, se reserva la nueva y la antigua queda «reprogramada» (su .ics sale anulado). Cancelarla,
// con una confirmación. Lo que no se entiende, lo que no tiene huecos y lo que necesita valoración
// pasa a una persona, como antes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const R = require('../servidor/repesca/motor');
const agenda = require('../servidor/agenda');
const avisos = require('../servidor/avisos-cita');
const { crearApp } = require('../servidor/index');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const T = require('../motor/tiempo');

const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
const mas = (d, min) => new Date(new Date(d).getTime() + min * 60000);

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, municipio) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', 'Boadilla del Monte')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO festivos (fecha, nombre, ambito) VALUES ('2026-10-12', 'Fiesta Nacional', 'nacional')");
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica'), (2, 'consulta-1', 'Consulta 1', 'consulta_medica'), (3, 'sala-capilar', 'Sala capilar', 'sala_capilar')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista'), (10, 'medico-1', 'Médico 1', 'medico'), (30, 'tricologia-1', 'Tricología 1', 'tricologo')");
  for (const d of [1, 2, 3, 4, 5, 6]) {
    await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '20:00'), (10, ?, '11:00', '20:00')", [d, d]);
  }
  // La tricóloga solo viene el miércoles 14 de octubre: después no hay huecos de lo suyo.
  await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin, vigente_desde, vigente_hasta) VALUES (30, 3, '11:00', '20:00', '2026-10-14', '2026-10-14')");
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial'), ('medicina_capilar', 'Medicina capilar')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, reservable_ia) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 60, 10, 54, 'esteticista', 'cabina_estetica', 'cosmetico', TRUE),
    ('hilos-tensores', 'Hilos tensores', 'facial', 60, 10, 450, 'medico', 'consulta_medica', 'producto_sanitario', FALSE),
    ('valoracion-capilar', 'Valoración capilar', 'medicina_capilar', 45, 10, 0, 'tricologo', 'sala_capilar', 'servicio', TRUE)`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

// Una paciente con su cita dada por recepción unos días antes.
async function conCita(pool, { telefono, nombre, fecha, hora, tratamiento = 'limpieza-facial', dada = new Date('2026-10-01T08:00:00Z') }) {
  const [p] = await pool.query('INSERT INTO pacientes (nombre, telefono) VALUES (?, ?)', [nombre, telefono]);
  const cita = await agenda.reservar(pool, { pacienteId: p.insertId, tratamientoId: tratamiento, fecha, hora, origen: 'recepcion', ahora: dada });
  return { pacienteId: p.insertId, cita };
}

const cita = async (pool, id) => (await pool.query('SELECT * FROM citas WHERE id = ?', [id]))[0][0];

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

test('cambiar y cancelar la cita por WhatsApp', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const martes = new Date('2026-10-06T09:00:00Z'); // martes 11:00 en Madrid

    await t.test('«necesito cambiarla» → huecos desde mañana; elige → nueva cita, la antigua reprogramada con su .ics anulado', async () => {
      const { cita: vieja } = await conCita(pool, { telefono: '+34611000301', nombre: 'Alba', fecha: '2026-10-08', hora: '17:00' });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000301', texto: 'Uy, me ha surgido algo, necesito cambiarla', ahora: martes });
      assert.equal(r.sobreCita, 'cambiar');
      assert.equal(r.eleccion, 'propuesta');
      assert.match(r.respuesta, /^Soy el asistente virtual de IEMEC\. Sin problema, Alba\. Te cambio la cita del jueves 8 de octubre a las 17:00: te puedo ofrecer el .+\. ¿Cuál te viene mejor\? Si prefieres cancelarla, dímelo\.$/);
      assert.equal(r.huecos.length, 3);
      assert.ok(r.huecos.every((h) => h.fecha >= '2026-10-07'), 'desde mañana');
      assert.ok(!r.huecos.some((h) => h.fecha === '2026-10-08' && h.hora === '17:00'), 'no le ofrece la hora que ya tiene');
      const [[conv]] = await pool.query('SELECT reprograma_cita_id, huecos_tratamiento_id FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.deepEqual({ ...conv }, { reprograma_cita_id: vieja.id, huecos_tratamiento_id: 'limpieza-facial' });
      assert.equal((await cita(pool, vieja.id)).estado, 'confirmada', 'mientras elige, su cita sigue en pie');

      const segunda = r.huecos[1];
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000301', texto: 'La segunda', ahora: mas(martes, 5) });
      assert.equal(r2.eleccion, 'reservada');
      const nueva = await cita(pool, r2.cita.id);
      const antigua = await cita(pool, vieja.id);
      assert.equal(madrid(nueva.inicio), `${segunda.fecha} ${segunda.hora}`);
      assert.equal(nueva.estado, 'confirmada');
      assert.equal(nueva.origen, 'recepcion', 'la cita cambiada conserva de dónde vino');
      assert.ok(nueva.aviso_confirmacion_en, 'no le llega otra confirmación por plantilla');
      assert.equal(antigua.estado, 'reprogramada');
      assert.equal(antigua.reprograma_a_id, nueva.id);
      assert.equal(antigua.secuencia_ics, 1, 'el .ics sube de versión');
      assert.ok(antigua.cancelada_en);
      assert.match(r2.respuesta, /^¡Hecho, Alba! Te he cambiado la cita: te esperamos el \S+ \d+ de \S+ a las \d\d:\d\d en IEMEC \(Av\. Siglo XXI 13, local 35, Boadilla del Monte\) para: Limpieza facial profunda\. La del jueves 8 de octubre a las 17:00 queda anulada\.\n\n/);
      assert.ok(r2.respuesta.endsWith(`/c/${nueva.token}`), 'le llega la nueva cita con su enlace');
      assert.equal(whatsapp.enviados.at(-1).texto, r2.respuesta);
      const [[conv2]] = await pool.query('SELECT estado, motivo_cierre, reprograma_cita_id, huecos_ofrecidos FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.deepEqual({ ...conv2 }, { estado: 'cerrada', motivo_cierre: 'cita', reprograma_cita_id: null, huecos_ofrecidos: null });
      assert.ok(!(await avisos.pendientes(pool, mas(martes, 10))).some((a) => a.id === nueva.id));

      await conServidor(crearApp({ pool }), async (base) => {
        const ics = await (await fetch(`${base}/c/${antigua.token}.ics`)).text();
        assert.match(ics, /STATUS:CANCELLED/);
        assert.match(ics, /SEQUENCE:1/);
        assert.doesNotMatch(ics, /BEGIN:VALARM/, 'sin recordatorios en el calendario');
        const pag = await (await fetch(`${base}/c/${antigua.token}`)).text();
        assert.match(pag, /Cita cambiada/);
        assert.match(pag, new RegExp(`href="/c/${nueva.token}"`));
        assert.doesNotMatch(pag, /Cancelar la cita/);
        const icsNueva = await (await fetch(`${base}/c/${nueva.token}.ics`)).text();
        assert.match(icsNueva, /STATUS:CONFIRMED/);
      });
    });

    await t.test('«¿me la retrasas al viernes a las 17:30?» pisa su propia cita y se puede: se le ofrece y con «sí» se cambia', async () => {
      const { cita: vieja } = await conCita(pool, { telefono: '+34611000302', nombre: 'Clara', fecha: '2026-10-09', hora: '17:00' });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000302', texto: '¿Me la puedes retrasar al viernes a las 17:30?', ahora: martes });
      assert.equal(r.respuesta, 'Soy el asistente virtual de IEMEC. El viernes 9 de octubre a las 17:30 lo tengo libre, Clara. ¿Te cambio la cita a ese hueco?');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000302', texto: 'Sí', ahora: mas(martes, 3) });
      assert.equal(r2.eleccion, 'reservada');
      assert.equal(madrid(r2.cita.inicio), '2026-10-09 17:30');
      assert.equal((await cita(pool, vieja.id)).estado, 'reprogramada');
    });

    await t.test('«no puedo ir el jueves, mejor por la tarde»: otros días, por la tarde', async () => {
      await conCita(pool, { telefono: '+34611000303', nombre: 'Irene', fecha: '2026-10-15', hora: '12:00' });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000303', texto: 'No puedo ir el jueves, mejor por la tarde', ahora: martes });
      assert.equal(r.sobreCita, 'cambiar');
      assert.equal(r.huecos.length, 3);
      assert.ok(r.huecos.every((h) => h.fecha >= '2026-10-07' && h.hora >= '15:00'), JSON.stringify(r.huecos));
    });

    await t.test('«cancelar la cita»: pregunta una vez; con «sí» la cancela y le ofrece otro momento; «sí, por la tarde» → huecos', async () => {
      const { cita: c } = await conCita(pool, { telefono: '+34611000304', nombre: 'Elena', fecha: '2026-10-19', hora: '12:00' });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000304', texto: 'Hola, quiero cancelar la cita', ahora: martes });
      assert.equal(r.sobreCita, 'cancelar');
      assert.equal(r.respuesta, 'Soy el asistente virtual de IEMEC. ¿Cancelo tu cita del lunes 19 de octubre a las 12:00, Elena? Si lo prefieres, te la cambio a otro día.');
      assert.equal((await cita(pool, c.id)).estado, 'confirmada', 'sin su «sí» no se cancela');

      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000304', texto: 'Sí, cancélala', ahora: mas(martes, 4) });
      assert.equal(r2.sobreCita, 'cancelada');
      assert.equal(r2.respuesta, 'Hecho, Elena: tu cita del lunes 19 de octubre a las 12:00 queda cancelada. ¿Quieres que te busque otro momento más adelante?');
      const cancelada = await cita(pool, c.id);
      assert.deepEqual([cancelada.estado, cancelada.cancelada_por, cancelada.secuencia_ics], ['cancelada', 'paciente', 1]);
      const [[conv]] = await pool.query('SELECT estado, motivo_cierre FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.deepEqual({ ...conv }, { estado: 'cerrada', motivo_cierre: 'cancelada' });
      assert.deepEqual(await R.sinProximoPaso(pool, mas(martes, 5)), [], 'cerrada: no queda en la bandeja sin próximo paso');

      // Contesta al rato: la misma conversación se reabre y le propone huecos por la tarde.
      const r3 = await R.procesarEntrante(deps, { telefono: '+34611000304', texto: 'Sí, mejor por la tarde', ahora: mas(martes, 30) });
      assert.equal(r3.conversacionId, r.conversacionId);
      assert.equal(r3.eleccion, 'propuesta');
      assert.match(r3.respuesta, /^¡Genial, Elena! Te puedo ofrecer /);
      assert.ok(r3.huecos.every((h) => h.fecha >= '2026-10-07' && h.hora >= '15:00'), JSON.stringify(r3.huecos));
    });

    await t.test('«cancelar la cita» y luego «no, mejor la mantengo»: sigue en pie', async () => {
      const { cita: c } = await conCita(pool, { telefono: '+34611000305', nombre: 'Noelia', fecha: '2026-10-20', hora: '12:00' });
      await R.procesarEntrante(deps, { telefono: '+34611000305', texto: 'Quiero anular mi cita', ahora: martes });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000305', texto: 'No, mejor la mantengo', ahora: mas(martes, 2) });
      assert.equal(r.respuesta, 'Perfecto, Noelia, la dejamos como está: te esperamos el martes 20 de octubre a las 12:00.');
      assert.equal((await cita(pool, c.id)).estado, 'confirmada');
    });

    await t.test('cambiándola, lo que no se entiende pasa a una persona y su cita sigue en pie', async () => {
      const { cita: c } = await conCita(pool, { telefono: '+34611000306', nombre: 'Marta', fecha: '2026-10-21', hora: '12:00' });
      await R.procesarEntrante(deps, { telefono: '+34611000306', texto: 'Necesito cambiarla', ahora: martes });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000306', texto: 'Bueno, ya veré qué hago con mi vida', ahora: mas(martes, 3) });
      assert.equal(r.eleccion, 'persona');
      assert.equal(r.respuesta, 'Perdona, Marta, no te he entendido bien. Una persona del equipo te ayuda ahora mismo a buscar otro momento; mientras, tu cita el miércoles 21 de octubre a las 12:00 sigue en pie.');
      const [[conv]] = await pool.query('SELECT estado, reprograma_cita_id FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.deepEqual({ ...conv }, { estado: 'espera_persona', reprograma_cita_id: null });
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r.conversacionId]);
      assert.match(tarea.titulo, /^Quiere cambiar su cita del miércoles 21 de octubre a las 12:00: no se entiende/);
      assert.equal((await cita(pool, c.id)).estado, 'confirmada');
    });

    await t.test('sin huecos para cambiarla, a una persona', async () => {
      const { cita: c } = await conCita(pool, { telefono: '+34611000307', nombre: 'Nuria', tratamiento: 'valoracion-capilar', fecha: '2026-10-14', hora: '17:00' });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000307', texto: 'Necesito cambiarla', ahora: new Date('2026-10-14T08:00:00Z') });
      assert.equal(r.eleccion, 'persona');
      assert.match(r.respuesta, /Ahora mismo no veo huecos para eso, Nuria\. Una persona del equipo te ayuda por aquí a buscar otro momento; mientras, tu cita el miércoles 14 de octubre a las 17:00 sigue en pie\.$/);
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r.conversacionId]);
      assert.match(tarea.titulo, /no hay huecos/);
      assert.equal((await cita(pool, c.id)).estado, 'confirmada');
    });

    await t.test('un tratamiento que necesita valoración lo cambia una persona, como antes', async () => {
      await conCita(pool, { telefono: '+34611000308', nombre: 'Sara', tratamiento: 'hilos-tensores', fecha: '2026-10-22', hora: '12:00' });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000308', texto: '¿Puedo cambiarla a otro día?', ahora: martes });
      assert.equal(r.sobreCita, 'cambiar');
      assert.match(r.respuesta, /Una persona del equipo te ayuda ahora mismo a buscar otro momento\. Si prefieres cancelarla, puedes hacerlo desde aquí: \S+\/c\/[\w-]{43}$/);
      const [[conv]] = await pool.query('SELECT estado FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.equal(conv.estado, 'espera_persona');
    });
  } finally {
    await pool.end();
  }
});

test('la agenda reserva «cambiando» una cita en la misma transacción', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const { pacienteId, cita: vieja } = await conCita(pool, { telefono: '+34611000320', nombre: 'Laura', fecha: '2026-10-08', hora: '17:00' });
    const ahora = new Date('2026-10-06T09:00:00Z');
    // Sin cambiarla, las 17:30 están ocupadas por su propia cita; cambiándola, no.
    const sin = (await agenda.huecos(pool, { fecha: '2026-10-08', tratamientoId: 'limpieza-facial', ahora })).map((h) => h.hora);
    const con = (await agenda.huecos(pool, { fecha: '2026-10-08', tratamientoId: 'limpieza-facial', ahora, ignorarCitaId: vieja.id })).map((h) => h.hora);
    assert.ok(!sin.includes('17:30'));
    assert.ok(con.includes('17:30'));
    const nueva = await agenda.reservar(pool, { pacienteId, tratamientoId: 'limpieza-facial', fecha: '2026-10-08', hora: '17:30', reprograma: vieja.id, ahora });
    assert.equal(nueva.reprograma, vieja.id);
    // Ya reprogramada, otra reserva «cambiándola» no la toca: se reserva sin más.
    const otra = await agenda.reservar(pool, { pacienteId, tratamientoId: 'limpieza-facial', fecha: '2026-10-09', hora: '12:00', reprograma: vieja.id, ahora });
    assert.equal(otra.reprograma, null);
    const [eventos] = await pool.query("SELECT tipo FROM eventos WHERE entidad = 'cita' AND entidad_id = ? ORDER BY id", [String(vieja.id)]);
    assert.deepEqual(eventos.map((e) => e.tipo), ['cita_reservada', 'cita_reprogramada']);
  } finally {
    await pool.end();
  }
});
