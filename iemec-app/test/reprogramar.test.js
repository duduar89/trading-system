'use strict';
// Cambiar la cita por WhatsApp sin pasar por nadie: se le proponen huecos del mismo tratamiento,
// elige, se reserva la nueva y la antigua queda «reprogramada» (su .ics sale anulado). Cancelarla,
// con una confirmación. Lo que no se entiende, lo que no tiene huecos y lo que necesita valoración
// pasa a una persona, como antes.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
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
      assert.match(r2.respuesta, /^¡Hecho, Alba! Te he cambiado la cita: te esperamos el \S+ \d+ de \S+ a las \d\d:\d\d en IEMEC \(Av\. Siglo XXI, 13, local 35, Boadilla del Monte\)\. La del jueves 8 de octubre a las 17:00 queda anulada: si la tenías en tu calendario, bórrala\.\n\n/);
      assert.doesNotMatch(r2.respuesta, /limpieza/i, 'sin el tratamiento: se lee en la pantalla bloqueada');
      const tokenNueva = agenda.tokenDe(nueva);
      const tokenAntigua = agenda.tokenDe(antigua);
      assert.ok(r2.respuesta.includes(`/cal/${tokenNueva}\n`), 'y el botón de calendario de la nueva');
      assert.ok(r2.respuesta.endsWith(`/c/${tokenNueva}`), 'le llega la nueva cita con su enlace');
      assert.equal(whatsapp.enviados.at(-1).texto, r2.respuesta);
      const [[conv2]] = await pool.query('SELECT estado, motivo_cierre, reprograma_cita_id, huecos_ofrecidos FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.deepEqual({ ...conv2 }, { estado: 'cerrada', motivo_cierre: 'cita', reprograma_cita_id: null, huecos_ofrecidos: null });
      assert.ok(!(await avisos.pendientes(pool, mas(martes, 10))).some((a) => a.id === nueva.id));

      // La app entera con el reloj parado justo después del cambio: la página y el .ics dependen de la
      // hora, y las pruebas no pueden depender del día en que se lanzan.
      const app = express();
      app.use((req, _res, next) => { req.ahora = mas(martes, 10); next(); });
      app.use(crearApp({ pool }));
      await conServidor(app, async (base) => {
        const ics = await (await fetch(`${base}/c/${tokenAntigua}.ics`)).text();
        assert.match(ics, /STATUS:CANCELLED/);
        assert.match(ics, /SEQUENCE:1/);
        assert.doesNotMatch(ics, /BEGIN:VALARM/, 'sin recordatorios en el calendario');
        const pag = await (await fetch(`${base}/c/${tokenAntigua}`)).text();
        assert.match(pag, /Cita cambiada/);
        assert.match(pag, new RegExp(`href="/c/${tokenNueva}"`));
        assert.doesNotMatch(pag, /Cancelar la cita/);
        const icsNueva = await (await fetch(`${base}/c/${tokenNueva}.ics`)).text();
        assert.match(icsNueva, /STATUS:CONFIRMED/);
        assert.notEqual(nueva.uid_ics, antigua.uid_ics, 'la nueva es otro evento, con otro UID');
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
      // Apple no actualiza un evento importado: si se la llevó al calendario, que la borre (si no, le
      // avisaría la víspera y 2 horas antes de una cita que ya no existe).
      assert.equal(r2.respuesta, 'Hecho, Elena: tu cita del lunes 19 de octubre a las 12:00 queda cancelada. Si la tenías en tu calendario, bórrala. ¿Quieres que te busque otro momento más adelante?');
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

    await t.test('frases que no se confunden: «si me la cambias…» no es un sí, «¿me la pasas al jueves?» es cambiarla, «No, cancélala» la cancela y «no quiero cancelarla» no', async () => {
      const rosa = await conCita(pool, { telefono: '+34611000311', nombre: 'Rosa', fecha: '2026-10-23', hora: '12:00' });
      await R.procesarEntrante(deps, { telefono: '+34611000311', texto: 'Quiero cancelar la cita', ahora: martes });
      const r1 = await R.procesarEntrante(deps, { telefono: '+34611000311', texto: 'Si me la cambias mejor', ahora: mas(martes, 2) });
      assert.equal(r1.sobreCita, 'cambiar');
      assert.equal(r1.eleccion, 'propuesta');
      assert.equal((await cita(pool, rosa.cita.id)).estado, 'confirmada');

      await conCita(pool, { telefono: '+34611000312', nombre: 'Tere', fecha: '2026-10-26', hora: '12:00' });
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000312', texto: '¿Me la pasas al jueves?', ahora: martes });
      assert.equal(r2.sobreCita, 'cambiar');
      assert.ok(r2.huecos.length >= 1 && r2.huecos.every((h) => h.fecha === '2026-10-08'), JSON.stringify(r2.huecos));
      const [[nuevas]] = await pool.query("SELECT COUNT(*) AS n FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE p.telefono = '+34611000312'");
      assert.equal(nuevas.n, 1, 'no se le reserva una segunda cita');

      const uxue = await conCita(pool, { telefono: '+34611000313', nombre: 'Uxue', fecha: '2026-10-27', hora: '12:00' });
      await R.procesarEntrante(deps, { telefono: '+34611000313', texto: 'Cancela mi cita, por favor', ahora: martes });
      const r3 = await R.procesarEntrante(deps, { telefono: '+34611000313', texto: 'No, cancélala', ahora: mas(martes, 2) });
      assert.equal(r3.sobreCita, 'cancelada');
      assert.equal((await cita(pool, uxue.cita.id)).estado, 'cancelada');

      const vera = await conCita(pool, { telefono: '+34611000314', nombre: 'Vera', fecha: '2026-10-28', hora: '12:00' });
      await R.procesarEntrante(deps, { telefono: '+34611000314', texto: 'Quiero anular la cita', ahora: martes });
      const r4 = await R.procesarEntrante(deps, { telefono: '+34611000314', texto: 'No, no quiero cancelarla', ahora: mas(martes, 2) });
      assert.equal(r4.sobreCita, 'mantiene');
      assert.equal((await cita(pool, vera.cita.id)).estado, 'confirmada');
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

    await t.test('lo reservado en Treatwell no se cancela ni se cambia solo en nuestra agenda: a una persona', async () => {
      const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Wendy', '+34611000309')");
      const c = await agenda.reservar(pool, { pacienteId: p.insertId, tratamientoId: 'limpieza-facial', fecha: '2026-10-29', hora: '12:00', origen: 'treatwell', ahora: new Date('2026-10-01T08:00:00Z') });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000309', texto: 'Quiero cancelar mi cita', ahora: martes });
      assert.match(r.respuesta, /Esa cita se reservó en Treatwell: una persona del equipo te ayuda ahora mismo a cambiarla o cancelarla/);
      assert.equal((await cita(pool, c.id)).estado, 'confirmada');
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r.conversacionId]);
      assert.match(tarea.titulo, /reservada en Treatwell: hacerlo también allí/);
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

test('cambiar la cita: lo que nombra de su cita es lo que no le va; lo que pide, adónde la quiere', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  try {
    await sembrar(pool);
    const martes = new Date('2026-10-06T09:00:00Z'); // martes 11:00 en Madrid

    await t.test('el día o la hora de su propia cita: otros días desde mañana, sin ese', async () => {
      const casos = [
        ['Alba', 'Tengo cita el jueves a las 12:00 y no voy a poder ir', '2026-10-08', '12:00'],
        ['Berta', 'Me ha surgido algo el jueves a las 13:30, ¿la podemos mover?', '2026-10-08', '13:30'],
        ['Carla', 'Necesito cambiar la cita del jueves 8', '2026-10-08', '15:00'],
        ['Diana', 'Hola, quiero cambiar mi cita del jueves 8 de octubre, a las 17:00', '2026-10-08', '17:00'], // el botón de «Tu cita»
        ['Elsa', 'Quiero cambiar la cita del jueves', '2026-10-15', '12:00'],
        ['Fina', 'No voy a poder ir el jueves', '2026-10-15', '17:00'],
      ];
      for (const [i, [nombre, , fecha, hora]] of casos.entries()) await conCita(pool, { telefono: `+3461100041${i}`, nombre, fecha, hora });
      for (const [i, [nombre, frase, fecha, hora]] of casos.entries()) {
        const r = await R.procesarEntrante(deps, { telefono: `+3461100041${i}`, texto: frase, ahora: martes });
        assert.equal(r.eleccion, 'propuesta', frase);
        assert.match(r.respuesta, new RegExp(`Sin problema, ${nombre}\\. Te cambio la cita del jueves ${Number(fecha.slice(8))} de octubre a las ${hora}: te puedo ofrecer `), frase);
        assert.doesNotMatch(r.respuesta, /ya no me queda hueco/, frase);
        assert.equal(r.huecos.length, 3, frase);
        assert.ok(r.huecos.every((h) => h.fecha >= '2026-10-07' && h.fecha !== fecha), `${frase} → ${JSON.stringify(r.huecos)}`);
      }
    });

    await t.test('lo que va detrás de «al» es adónde la quiere; solo la hora, ese mismo día', async () => {
      await conCita(pool, { telefono: '+34611000420', nombre: 'Gala', fecha: '2026-10-08', hora: '18:30' });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000420', texto: 'Necesito cambiar la cita del jueves al viernes', ahora: martes });
      assert.ok(r.huecos.length >= 1 && r.huecos.every((h) => h.fecha === '2026-10-09'), JSON.stringify(r.huecos));

      await conCita(pool, { telefono: '+34611000421', nombre: 'Hebe', fecha: '2026-10-13', hora: '12:00' });
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000421', texto: '¿Me la retrasas a las 19:00?', ahora: martes });
      assert.equal(r2.respuesta, 'Soy el asistente virtual de IEMEC. El martes 13 de octubre a las 19:00 lo tengo libre, Hebe. ¿Te cambio la cita a ese hueco?');
    });

    await t.test('con dos citas, la que nombra', async () => {
      const { pacienteId } = await conCita(pool, { telefono: '+34611000422', nombre: 'Inés', fecha: '2026-10-13', hora: '15:00' });
      await agenda.reservar(pool, { pacienteId, tratamientoId: 'limpieza-facial', fecha: '2026-10-16', hora: '12:00', origen: 'recepcion', ahora: new Date('2026-10-01T08:00:00Z') });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000422', texto: 'Necesito cambiar la del viernes', ahora: martes });
      assert.match(r.respuesta, /Te cambio la cita del viernes 16 de octubre a las 12:00: te puedo ofrecer /);
      assert.ok(r.huecos.every((h) => h.fecha !== '2026-10-16'), JSON.stringify(r.huecos));
    });
  } finally {
    await pool.end();
  }
});

test('cambiándola, «solo puedo por la tarde» es solo por la tarde (aunque las primeras tardes estén llenas)', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  try {
    await sembrar(pool);
    // La esteticista trabaja por la mañana, salvo el viernes.
    await pool.query('DELETE FROM profesional_horarios WHERE profesional_id = 20');
    for (const d of [1, 2, 3, 4, 6]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '14:00')", [d]);
    await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, 5, '11:00', '20:00')");
    const martes = new Date('2026-10-06T09:00:00Z');

    const { cita: c } = await conCita(pool, { telefono: '+34611000431', nombre: 'Julia', fecha: '2026-10-09', hora: '17:00' });
    const r = await R.procesarEntrante(deps, { telefono: '+34611000431', texto: 'Necesito cambiarla, solo puedo por la tarde', ahora: martes });
    assert.equal(r.eleccion, 'propuesta');
    assert.equal(r.huecos.length, 3);
    assert.ok(r.huecos.every((h) => h.hora >= '15:00'), JSON.stringify(r.huecos));

    // Cancelada, «sí, por la tarde» a «¿Te busco otro momento?»: también solo tardes.
    await R.procesarEntrante(deps, { telefono: '+34611000431', texto: 'Mejor la dejo como está', ahora: mas(martes, 2) });
    await R.procesarEntrante(deps, { telefono: '+34611000431', texto: 'Quiero cancelar la cita', ahora: mas(martes, 4) });
    const r2 = await R.procesarEntrante(deps, { telefono: '+34611000431', texto: 'Sí', ahora: mas(martes, 6) });
    assert.equal(r2.sobreCita, 'cancelada');
    assert.equal((await cita(pool, c.id)).estado, 'cancelada');
    const r3 = await R.procesarEntrante(deps, { telefono: '+34611000431', texto: 'Sí, por la tarde', ahora: mas(martes, 8) });
    assert.ok(r3.huecos.length >= 1 && r3.huecos.every((h) => h.hora >= '15:00'), JSON.stringify(r3.huecos));

    // «¿Tenéis hueco el miércoles por la tarde?»: ese día no hay tardes → otro día, por la tarde.
    const r4 = await R.procesarEntrante(deps, { telefono: '+34611000431', texto: '¿Tenéis hueco el miércoles por la tarde?', ahora: mas(martes, 10) });
    assert.match(r4.respuesta, /^Ese día por la tarde lo tengo completo, Julia\. Te puedo ofrecer /);
    assert.ok(r4.huecos.every((h) => h.hora >= '15:00'), JSON.stringify(r4.huecos));
  } finally {
    await pool.end();
  }
});

test('«¿Cancelo tu cita?» solo vale si es lo último que le hemos dicho', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const miercoles = new Date('2026-10-21T07:00:00Z'); // miércoles 9:00 en Madrid
    const dada = mas(miercoles, -5 * 1440);

    await t.test('le llega el recordatorio de la víspera y contesta «Confirmo»: no se cancela', async () => {
      const respuestas = ['Confirmo', 'Sí, allí estaré', 'Vale, gracias'];
      const citas = [];
      for (const [i, hora] of ['12:00', '15:00', '17:00'].entries()) {
        const { cita: c } = await conCita(pool, { telefono: `+3461100044${i}`, nombre: `Laura${i}`, fecha: '2026-10-22', hora, dada });
        await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [dada, c.id]);
        citas.push(c);
        const r = await R.procesarEntrante(deps, { telefono: `+3461100044${i}`, texto: 'Igual tengo que cancelar la cita de mañana', ahora: miercoles });
        assert.equal(r.sobreCita, 'cancelar');
      }
      // A las 10:00, el recordatorio de la víspera («¿Nos lo confirmas?»), en la misma conversación.
      const avisos10 = await avisos.enviarPendientes(deps, { ahora: mas(miercoles, 60) });
      assert.equal(avisos10.filter((a) => a.tipo === 'vispera').length, 3);
      for (const [i, respuesta] of respuestas.entries()) {
        const r = await R.procesarEntrante(deps, { telefono: `+3461100044${i}`, texto: respuesta, ahora: mas(miercoles, 65) });
        assert.doesNotMatch(String(r.respuesta), /cancelada/, respuesta);
        assert.equal((await cita(pool, citas[i].id)).estado, 'confirmada', respuesta);
      }
    });

    await t.test('a la pregunta, un «vale» no basta para cancelar: se le vuelve a preguntar', async () => {
      const { cita: c } = await conCita(pool, { telefono: '+34611000450', nombre: 'Marta', fecha: '2026-10-23', hora: '18:30', dada });
      await R.procesarEntrante(deps, { telefono: '+34611000450', texto: 'Quiero cancelar mi cita', ahora: miercoles });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000450', texto: 'Vale', ahora: mas(miercoles, 2) });
      assert.equal(r.respuesta, 'Para no equivocarme, Marta: ¿cancelo tu cita del viernes 23 de octubre a las 18:30? Contesta «sí» para cancelarla o «no» para mantenerla.');
      assert.equal((await cita(pool, c.id)).estado, 'confirmada');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000450', texto: 'Sí', ahora: mas(miercoles, 3) });
      assert.equal(r2.sobreCita, 'cancelada');
      assert.equal((await cita(pool, c.id)).estado, 'cancelada');
    });
  } finally {
    await pool.end();
  }
});

test('cambiar una cita desde la conversación de un presupuesto no acepta el presupuesto', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  try {
    await sembrar(pool);
    const lunes = new Date('2026-10-19T08:00:00Z');
    const { pacienteId, cita: vieja } = await conCita(pool, { telefono: '+34611000460', nombre: 'Ana', fecha: '2026-10-22', hora: '12:00' });
    const [pr] = await pool.query("INSERT INTO presupuestos (paciente_id, titulo, importe_eur, estado, entregado_en) VALUES (?, 'Hilos tensores (ejemplo)', 900, 'entregado', ?)", [pacienteId, mas(lunes, -3 * 1440)]);
    await pool.query("INSERT INTO presupuesto_lineas (presupuesto_id, tratamiento_id, concepto, importe_eur) VALUES (?, 'hilos-tensores', 'Hilos', 900)", [pr.insertId]);
    const [conv] = await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado, contexto, contexto_id) VALUES ('+34611000460', ?, 'esperando_paciente', 'presupuesto', ?)", [pacienteId, pr.insertId]);
    const [of] = await pool.query("INSERT INTO ofertas (codigo, nombre, tipo, texto_paciente) VALUES ('plazos-ej', 'Pago a plazos (ejemplo)', 'plazos', 'Puedes pagarlo en 3 plazos sin intereses.')");
    await pool.query("INSERT INTO ofertas_hechas (oferta_id, paciente_id, conversacion_id, presupuesto_id, estado) VALUES (?, ?, ?, ?, 'propuesta')", [of.insertId, pacienteId, conv.insertId, pr.insertId]);

    const r1 = await R.procesarEntrante(deps, { telefono: '+34611000460', texto: 'Necesito cambiar la cita del jueves', ahora: lunes });
    assert.equal(r1.conversacionId, conv.insertId);
    const r2 = await R.procesarEntrante(deps, { telefono: '+34611000460', texto: 'La primera', ahora: mas(lunes, 2) });
    assert.equal(r2.eleccion, 'reservada');
    assert.equal((await cita(pool, vieja.id)).estado, 'reprogramada');
    const [[p]] = await pool.query('SELECT estado FROM presupuestos WHERE id = ?', [pr.insertId]);
    assert.equal(p.estado, 'entregado', 'cambiar la limpieza no acepta el presupuesto de los hilos');
    const [[oh]] = await pool.query('SELECT estado FROM ofertas_hechas WHERE conversacion_id = ?', [conv.insertId]);
    assert.equal(oh.estado, 'propuesta');
    const [[c]] = await pool.query('SELECT estado FROM conversaciones WHERE id = ?', [conv.insertId]);
    assert.equal(c.estado, 'esperando_paciente', 'la conversación del presupuesto sigue abierta');
    const [[s]] = await pool.query("SELECT COUNT(*) AS n FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [conv.insertId]);
    assert.equal(s.n, 1, 'y con su próximo paso: se le vuelve a escribir');
  } finally {
    await pool.end();
  }
});
