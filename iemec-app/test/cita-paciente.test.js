'use strict';
// La cita llega al paciente: elige uno de los huecos que le propone la IA, se reserva, le llega su
// cita con el enlace para el calendario y después los avisos (confirmación, víspera, 2 horas).
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const R = require('../servidor/repesca/motor');
const agenda = require('../servidor/agenda');
const avisos = require('../servidor/avisos-cita');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const T = require('../motor/tiempo');

const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
const mas = (d, min) => new Date(new Date(d).getTime() + min * 60000);

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, municipio) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', 'Boadilla del Monte')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO festivos (fecha, nombre, ambito) VALUES ('2026-10-05', 'Virgen del Rosario', 'local'), ('2026-10-12', 'Fiesta Nacional', 'nacional')");
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica'), (2, 'consulta-1', 'Consulta 1', 'consulta_medica')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista'), (10, 'medico-1', 'Médico 1', 'medico')");
  for (const d of [1, 2, 3, 4, 5, 6]) {
    await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '20:00'), (10, ?, '11:00', '20:00')", [d, d]);
  }
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, reservable_ia) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 60, 10, 54, 'esteticista', 'cabina_estetica', 'cosmetico', TRUE),
    ('hilos-tensores', 'Hilos tensores', 'facial', 60, 10, 450, 'medico', 'consulta_medica', 'producto_sanitario', FALSE)`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

async function leadQueContesta(deps, { telefono, nombre, tratamiento = 'limpieza-facial', texto = 'Vale, dame cita', ahora }) {
  const [l] = await deps.pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES (?, ?, 'meta_formulario', ?)", [telefono, nombre, tratamiento]);
  await R.inscribir(deps.pool, { secuencia: 'lead', leadId: l.insertId, inicio: ahora });
  await R.avanzarSecuencias(deps, { ahora });
  const r = await R.procesarEntrante(deps, { telefono, texto, ahora: mas(ahora, 20) });
  return { leadId: l.insertId, r };
}

test('la cita llega al paciente', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const martes = new Date('2026-09-29T10:00:00Z'); // martes 12:00 en Madrid

    await t.test('«la segunda» → reservada, confirmada por WhatsApp con su enlace y el lead pasa a cita', async () => {
      const { leadId, r } = await leadQueContesta(deps, { telefono: '+34611000101', nombre: 'Alba Ruiz', ahora: martes });
      assert.equal(r.huecos.length, 3, 'le propone tres huecos');
      assert.ok(r.huecos.every((h) => /:(00|30)$/.test(h.hora)), 'a horas redondas');
      const [plantillas] = await pool.query("SELECT id FROM mensajes WHERE conversacion_id = ? AND tipo = 'plantilla'", [r.conversacionId]);
      assert.equal(plantillas.length, 1);
      const hist = await R.historial(pool, r.conversacionId, 10);
      assert.match(hist[0].texto, /^Hola Alba, soy el asistente virtual de IEMEC\. Gracias por tu interés en limpieza facial profunda\./, 'la plantilla se guarda con el texto que lee el paciente');
      const [[conv0]] = await pool.query('SELECT huecos_ofrecidos, huecos_tratamiento_id FROM conversaciones WHERE id = ?', [r.conversacionId]);
      const guardados = typeof conv0.huecos_ofrecidos === 'string' ? JSON.parse(conv0.huecos_ofrecidos) : conv0.huecos_ofrecidos;
      assert.equal(guardados.length, 3, 'quedan guardados en la conversación');
      assert.equal(conv0.huecos_tratamiento_id, 'limpieza-facial');

      const segunda = r.huecos[1];
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000101', texto: 'La segunda, porfa', ahora: mas(martes, 30) });
      assert.equal(r2.eleccion, 'reservada');
      const [[cita]] = await pool.query('SELECT * FROM citas WHERE id = ?', [r2.cita.id]);
      assert.equal(madrid(cita.inicio), `${segunda.fecha} ${segunda.hora}`);
      assert.equal(cita.estado, 'confirmada');
      assert.equal(cita.origen, 'ia_whatsapp');
      assert.equal(cita.conversacion_id, r.conversacionId);
      assert.ok(cita.aviso_confirmacion_en, 'la confirmación ya salió en la conversación');

      const texto = whatsapp.enviados.at(-1).texto;
      assert.match(texto, /^¡Hecho, Alba! Te esperamos el \S+ \d+ de \S+ a las \d\d:\d\d en IEMEC \(Av\. Siglo XXI 13, local 35, Boadilla del Monte\) para: Limpieza facial profunda\./);
      assert.ok(texto.includes(`/c/${cita.token}`), 'lleva el enlace para añadirla al calendario');

      const [[pac]] = await pool.query('SELECT * FROM pacientes WHERE id = ?', [cita.paciente_id]);
      assert.deepEqual([pac.nombre, pac.apellidos, pac.telefono], ['Alba', 'Ruiz', '+34611000101']);
      const [[lead]] = await pool.query('SELECT etapa, cita_id, paciente_id FROM leads WHERE id = ?', [leadId]);
      assert.deepEqual({ ...lead }, { etapa: 'cita', cita_id: cita.id, paciente_id: pac.id });
      const [[conv]] = await pool.query('SELECT estado, motivo_cierre, proximo_paso, huecos_ofrecidos FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.deepEqual({ ...conv }, { estado: 'cerrada', motivo_cierre: 'cita', proximo_paso: 'cita', huecos_ofrecidos: null });
      const [[seg]] = await pool.query("SELECT COUNT(*) AS n FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [r.conversacionId]);
      assert.equal(seg.n, 0, 'con cita no queda ningún «como quedamos»');
      const [[ins]] = await pool.query('SELECT estado FROM inscripciones WHERE lead_id = ?', [leadId]);
      assert.equal(ins.estado, 'terminada');
      // No se le manda otra confirmación por plantilla.
      assert.ok(!(await avisos.pendientes(pool, mas(martes, 40))).some((a) => a.id === cita.id && a.tipo === 'confirmacion'));
    });

    await t.test('después: «gracias» se contesta una vez, en la misma conversación; «necesito cambiarla» le propone otros huecos', async () => {
      const [[antes]] = await pool.query("SELECT id FROM conversaciones WHERE telefono = '+34611000101'");
      const g = await R.procesarEntrante(deps, { telefono: '+34611000101', texto: '¡Muchas gracias!', ahora: mas(martes, 35) });
      assert.equal(g.conversacionId, antes.id);
      assert.equal(g.sobreCita, 'agradece');
      assert.match(g.respuesta, /^¡A ti, Alba! Nos vemos el \S+ \d+ de \S+ a las \d\d:\d\d\.$/);
      const enviados = whatsapp.enviados.length;
      const g2 = await R.procesarEntrante(deps, { telefono: '+34611000101', texto: 'gracias 😊', ahora: mas(martes, 37) });
      assert.equal(g2.respuesta, null, 'al «gracias» del «gracias» no se contesta');
      assert.equal(whatsapp.enviados.length, enviados);

      // Ya no espera a nadie: se le proponen huecos (el cambio de punta a punta, en reprogramar.test.js).
      const c = await R.procesarEntrante(deps, { telefono: '+34611000101', texto: 'Uy, me ha surgido algo, necesito cambiarla', ahora: mas(martes, 120) });
      assert.equal(c.conversacionId, antes.id);
      assert.equal(c.sobreCita, 'cambiar');
      assert.match(c.respuesta, /^Sin problema, Alba\. Te cambio la cita del .+: te puedo ofrecer .+¿Cuál te viene mejor\?/);
      assert.equal(c.huecos.length, 3);
      const [[conv]] = await pool.query('SELECT estado, reprograma_cita_id FROM conversaciones WHERE id = ?', [antes.id]);
      assert.equal(conv.estado, 'esperando_paciente');
      assert.ok(conv.reprograma_cita_id);
    });

    await t.test('«vale» con tres huecos: pregunta cuál; «el último» lo reserva', async () => {
      const { r } = await leadQueContesta(deps, { telefono: '+34611000102', nombre: 'Clara', ahora: martes });
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000102', texto: 'Vale', ahora: mas(martes, 25) });
      assert.equal(r2.eleccion, 'propuesta');
      assert.match(r2.respuesta, /¿Cuál prefieres: el /);
      const r3 = await R.procesarEntrante(deps, { telefono: '+34611000102', texto: 'el último', ahora: mas(martes, 28) });
      assert.equal(r3.eleccion, 'reservada');
      assert.equal(madrid(r3.cita.inicio), `${r.huecos[2].fecha} ${r.huecos[2].hora}`);
    });

    await t.test('si el hueco se ocupa mientras contesta, se le ofrecen otros', async () => {
      const { r } = await leadQueContesta(deps, { telefono: '+34611000103', nombre: 'Elena', ahora: martes });
      const primero = r.huecos[0];
      // Recepción da ese hueco a otra paciente (una sola cabina y una sola esteticista).
      const [otra] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Otra', '+34611000199')");
      await agenda.reservar(pool, { pacienteId: otra.insertId, tratamientoId: 'limpieza-facial', fecha: primero.fecha, hora: primero.hora, ahora: mas(martes, 21) });
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000103', texto: 'La primera', ahora: mas(martes, 25) });
      assert.equal(r2.eleccion, 'propuesta');
      assert.match(r2.respuesta, /ese hueco ya no está libre/);
      assert.ok(r2.huecos.length >= 1);
      assert.ok(!r2.huecos.some((h) => h.fecha === primero.fecha && h.hora === primero.hora));
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE p.telefono = '+34611000103'");
      assert.equal(n.n, 0);
    });

    await t.test('«ninguno me viene bien» → otros más adelante, y sigue habiendo próximo paso', async () => {
      const { r } = await leadQueContesta(deps, { telefono: '+34611000104', nombre: 'Noelia', ahora: martes });
      const ultimo = r.huecos.map((h) => h.fecha).sort().at(-1);
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000104', texto: 'Ninguno me viene bien, mejor por la tarde', ahora: mas(martes, 25) });
      assert.equal(r2.eleccion, 'propuesta');
      assert.match(r2.respuesta, /Te propongo otros/);
      assert.ok(r2.huecos.every((h) => h.fecha > ultimo && h.hora >= '15:00'), JSON.stringify(r2.huecos));
      const [[seg]] = await pool.query("SELECT motivo FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [r.conversacionId]);
      assert.equal(seg.motivo, 'sin_respuesta_a_propuesta');
      assert.deepEqual(await R.sinProximoPaso(pool, mas(martes, 30)), []);
    });

    await t.test('«¿y el jueves a las 12?» → se mira ese hueco, se le ofrece y con «sí» se reserva', async () => {
      const martes6 = new Date('2026-10-06T09:00:00Z');
      await leadQueContesta(deps, { telefono: '+34611000105', nombre: 'Sara', ahora: martes6 });
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000105', texto: '¿Y el jueves a las 12?', ahora: mas(martes6, 25) });
      assert.equal(r2.respuesta, 'El jueves 8 de octubre a las 12:00 lo tengo libre, Sara. ¿Te lo reservo?');
      const r3 = await R.procesarEntrante(deps, { telefono: '+34611000105', texto: 'Sí', ahora: mas(martes6, 27) });
      assert.equal(r3.eleccion, 'reservada');
      assert.equal(madrid(r3.cita.inicio), '2026-10-08 12:00');
    });

    await t.test('un tratamiento que necesita valoración no lo reserva la IA: queda tarea para recepción', async () => {
      const { r } = await leadQueContesta(deps, { telefono: '+34611000106', nombre: 'Marta', tratamiento: 'hilos-tensores', ahora: martes });
      assert.deepEqual(r.huecos, []);
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r.conversacionId]);
      assert.match(tarea.titulo, /proponerle huecos a mano/);
    });
  } finally {
    await pool.end();
  }
});

test('avisos de cita: confirmación, víspera y 2 horas antes, una sola vez y a su hora', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Laura', '+34611000201')");
    const dada = new Date('2026-10-13T08:00:00Z'); // martes 10:00: recepción le da cita para el jueves
    const cita = await agenda.reservar(pool, { pacienteId: p.insertId, tratamientoId: 'limpieza-facial', fecha: '2026-10-15', hora: '17:00', origen: 'recepcion', ahora: dada });

    assert.deepEqual(await avisos.enviarPendientes(deps, { ahora: mas(dada, 1) }), [], 'dos minutos de margen');
    const conf = await avisos.enviarPendientes(deps, { ahora: mas(dada, 3) });
    assert.equal(conf.length, 1);
    assert.equal(conf[0].tipo, 'confirmacion');
    const m1 = whatsapp.enviados.at(-1);
    assert.equal(m1.nombre, 'iemec_cita_confirmada');
    assert.deepEqual(m1.variables, ['Laura', 'jueves 15 de octubre', '17:00', 'limpieza facial profunda']);
    assert.equal(m1.botonUrl, cita.token, 'el botón «Ver mi cita» lleva a su página con el calendario');
    assert.deepEqual(await avisos.enviarPendientes(deps, { ahora: mas(dada, 4) }), [], 'no sale dos veces');

    // Víspera: miércoles desde las 10:00 (antes, nada).
    assert.deepEqual(await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-14T07:30:00Z') }), []);
    const v = await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-14T08:05:00Z') });
    assert.deepEqual(v.map((a) => a.tipo), ['vispera']);
    assert.equal(whatsapp.enviados.at(-1).nombre, 'iemec_recordatorio_24h');
    assert.deepEqual(whatsapp.enviados.at(-1).variables, ['Laura', '17:00']);

    // Contesta «Confirmo»: se registra y se le responde.
    const r = await R.procesarEntrante(deps, { telefono: '+34611000201', texto: 'Confirmo', ahora: new Date('2026-10-14T08:20:00Z') });
    assert.equal(r.sobreCita, 'confirma');
    assert.equal(r.respuesta, '¡Perfecto, Laura! Queda confirmada: te esperamos el jueves 15 de octubre a las 17:00.');
    const [[ev]] = await pool.query("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'cita_confirmada_paciente' AND entidad_id = ?", [String(cita.id)]);
    assert.equal(ev.n, 1);

    // Dos horas antes (17:00 en Madrid son las 15:00 UTC).
    assert.deepEqual(await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-15T12:50:00Z') }), []);
    const d = await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-15T13:05:00Z') });
    assert.deepEqual(d.map((a) => a.tipo), ['dos_horas']);
    assert.equal(whatsapp.enviados.at(-1).nombre, 'iemec_recordatorio_2h');
    assert.deepEqual(await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-15T13:10:00Z') }), []);

    // Una cita que viene de Treatwell no recibe nuestros avisos.
    await agenda.reservar(pool, { pacienteId: p.insertId, tratamientoId: 'limpieza-facial', fecha: '2026-10-16', hora: '12:00', origen: 'treatwell', ahora: new Date('2026-10-15T16:00:00Z') });
    assert.deepEqual(await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-15T16:10:00Z') }), []);

    // De noche no se manda: la confirmación de una cita dada a las 22:30 sale a las 9:00.
    const [p2] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Marta', '+34611000202')");
    const noche = new Date('2026-10-19T20:30:00Z');
    await agenda.reservar(pool, { pacienteId: p2.insertId, tratamientoId: 'limpieza-facial', fecha: '2026-10-22', hora: '12:00', origen: 'telefono', ahora: noche });
    assert.deepEqual(await avisos.enviarPendientes(deps, { ahora: mas(noche, 10) }), []);
    const manana = await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-20T07:01:00Z') });
    assert.deepEqual(manana.map((a) => a.tipo), ['confirmacion']);

    // Las conversaciones de los avisos no se quedan abiertas «sin próximo paso».
    await avisos.cerrarConversacionesDeCitasPasadas(pool, new Date('2026-10-20T08:00:00Z'));
    assert.deepEqual(await R.sinProximoPaso(pool, new Date('2026-10-20T08:00:00Z')), []);
    const [[abiertas]] = await pool.query("SELECT COUNT(*) AS n FROM conversaciones WHERE estado <> 'cerrada'");
    assert.equal(abiertas.n, 0, 'un aviso no deja conversaciones abiertas en la bandeja');
  } finally {
    await pool.end();
  }
});

test('en mitad de una frase, los tratamientos van en minúscula sin romper las siglas', () => {
  assert.equal(R.enMinuscula('Valoración personalizada gratuita HIFU'), 'valoración personalizada gratuita HIFU');
  assert.equal(R.enMinuscula('HIFU facial'), 'HIFU facial');
  assert.equal(R.enMinuscula('Limpieza facial profunda'), 'limpieza facial profunda');
});
