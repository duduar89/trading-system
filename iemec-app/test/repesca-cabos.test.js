'use strict';
// Los cabos que dejó la vuelta 8a en la repesca, la lista de espera y los leads, contra la base:
//   · los agrupadores del catálogo se reconocen y se le pregunta el nivel o la técnica (o recepción);
//   · «quiero más información» / «¿qué precio tiene?» y las formas de pedir cita;
//   · el aviso de la lista de espera que no llega pasa al siguiente; lo íntimo no se nombra;
//   · reservar solo acaba el «toca repetir» de ese tratamiento y cierra las tareas de recuperación;
//   · cancelar por WhatsApp entra en la secuencia «cancelación», sin duplicarla;
//   · los textos sin nombre o sin tratamiento se leen bien;
//   · «por la tarde» es por la tarde (y si no hay, se dice y se ofrece la mañana).
// Todo inventado: teléfonos 611 000 7xx, 8xx y 9xx.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prepararBdDePrueba } = require('./ayuda-bd');
const R = require('../servidor/repesca/motor');
const LE = require('../servidor/lista-espera');
const agenda = require('../servidor/agenda');
const estados = require('../servidor/estados-cita');
const espera = require('../servidor/avisos-espera');
const entrada = require('../servidor/entrada');
const { altaLead } = require('../servidor/leads');
const { convertir } = require('../scripts/importar-catalogo');
const { descifrar } = require('../servidor/cripto');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const { esAgrupador, NOTA_AGRUPADOR } = require('../motor/entrada/leads');
const T = require('../motor/tiempo');

const en = (fecha, hora) => T.desdeMadrid(fecha, hora);
const mas = (d, min) => new Date(new Date(d).getTime() + min * 60000);
const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const NOTA = `${NOTA_AGRUPADOR}; se reserva la concreta o la valoración.`;
const DADA = en('2026-10-01', '10:00'); // cuando recepción dio las citas

async function sembrar(pool, { soloMananas = false } = {}) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, municipio) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', 'Boadilla del Monte')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO festivos (fecha, nombre, ambito) VALUES ('2026-10-12', 'Fiesta Nacional', 'nacional')");
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica'), (2, 'consulta-1', 'Consulta 1', 'consulta_medica'), (3, 'head-spa', 'Head Spa', 'head_spa')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista'), (10, 'medico-1', 'Médico 1', 'medico')");
  const fin = soloMananas ? '14:00' : '20:00';
  for (const d of [1, 2, 3, 4, 5, 6]) {
    await pool.query('INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, \'11:00\', ?), (10, ?, \'11:00\', \'20:00\')', [d, fin, d]);
  }
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Medicina estética facial'), ('head_spa', 'Head Spa'), ('ginecoestetica', 'Ginecología estética y regenerativa'), ('otro', 'Otros tratamientos')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, subfamilia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal,
                      publicidad_restringida, reservable_ia, activo, repetir_cada_dias, notas, texto_whatsapp) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 'higiene', 60, 10, 54, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, TRUE, TRUE, NULL, NULL,
      'Hola vengo de la web quisiera reservar una cita para limpieza facial profunda'),
    ('hidratacion-facial', 'Hidratación facial', 'facial', 'higiene', 60, 10, 70, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, TRUE, TRUE, 120, NULL, NULL),
    ('peeling-facial', 'Peeling facial', 'facial', 'peeling', 30, 10, 80, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, TRUE, TRUE, 60, NULL, NULL),
    ('head-spa-japones', 'Head Spa japonés (Head Spa Sakura)', 'head_spa', 'ritual', 0, 0, NULL, 'esteticista', 'head_spa', 'cosmetico', FALSE, FALSE, FALSE, NULL, ?, NULL),
    ('head-spa-express', 'Head Spa Express', 'head_spa', 'ritual', 45, 10, 60, 'esteticista', 'head_spa', 'cosmetico', FALSE, TRUE, TRUE, NULL, NULL, NULL),
    ('head-spa-detox', 'Head Spa Detox Purificante', 'head_spa', 'ritual', 90, 10, 95, 'esteticista', 'head_spa', 'cosmetico', FALSE, TRUE, TRUE, NULL, NULL, NULL),
    ('rejuvenecimiento-vaginal', 'Rejuvenecimiento vaginal (láser, radiofrecuencia o PRP)', 'ginecoestetica', 'plan_personalizado', 0, 0, NULL, 'medico', 'consulta_medica', 'desconocido',
      TRUE, FALSE, FALSE, NULL, ?, NULL),
    ('laser-intimo', 'Láser para la atrofia vaginal', 'ginecoestetica', 'laser', 30, 10, 200, 'medico', 'consulta_medica', 'aparatologia', FALSE, TRUE, TRUE, NULL, NULL, NULL),
    ('toxina', 'Toxina botulínica', 'facial', 'inyectable', 30, 10, 300, 'medico', 'consulta_medica', 'medicamento_receta', TRUE, FALSE, TRUE, NULL, NULL, NULL)`, [NOTA, NOTA]);
  await pool.query(`INSERT INTO respuestas_aprobadas (tratamiento_id, pregunta, respuesta, aprobada) VALUES
    ('limpieza-facial', '¿En qué consiste la limpieza facial profunda?', 'Es una limpieza en profundidad del rostro: extracción, exfoliación y mascarilla, en unos 60 minutos.', TRUE),
    ('limpieza-facial', '¿Cuánto cuesta la limpieza facial profunda?', 'La sesión cuesta 54 euros.', TRUE),
    ('limpieza-facial', '¿Se puede hacer con acné activo?', 'Esta todavía no la ha aprobado el equipo médico.', FALSE)`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

async function paciente(pool, { nombre, telefono, consentimiento = false, cliente = false }) {
  const [p] = await pool.query('INSERT INTO pacientes (nombre, apellidos, telefono, es_cliente) VALUES (?, ?, ?, ?)', [nombre, 'Ejemplo', telefono, cliente]);
  if (consentimiento) await pool.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente) VALUES (?, 'whatsapp_marketing', 'otorgado', 'recepcion')", [p.insertId]);
  return p.insertId;
}

const cita = (pool, pacienteId, tratamientoId, fecha, hora, extra = {}) => agenda.reservar(pool, { pacienteId, tratamientoId, fecha, hora, origen: 'recepcion', ahora: DADA, ...extra });
const uno = async (pool, sql, p = []) => (await pool.query(sql, p))[0][0];
const todos = async (pool, sql, p = []) => (await pool.query(sql, p))[0];
// Lo que le ha llegado, tal y como lo lee (en la base va cifrado).
async function textos(pool, telefono) {
  const m = await todos(pool, `SELECT m.cuerpo_cifrado, m.iv, m.tag FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
                                 WHERE c.telefono = ? AND m.direccion = 'saliente' ORDER BY m.id`, [telefono]);
  return m.map((x) => descifrar(x.cuerpo_cifrado, x.iv, x.tag));
}
const alTelefono = (whatsapp, telefono) => whatsapp.enviados.filter((m) => m.telefono === telefono);

test('el importador deja los agrupadores con la nota que reconoce la entrada de leads', () => {
  const { datos } = convertir(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'catalogo-minimo.json'), 'utf8')));
  const catalogo = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'catalogo-minimo.json'), 'utf8')).tratamientos;
  const tipo = Object.fromEntries(catalogo.map((x) => [x.id, x.tipo]));
  const agrupadores = datos.tratamientos.filter((x) => esAgrupador(x)).map((x) => x.id);
  assert.deepEqual(agrupadores, catalogo.filter((x) => x.tipo === 'agrupador').map((x) => x.id));
  assert.ok(agrupadores.length >= 2);
  assert.ok(datos.tratamientos.filter((x) => !x.activo && tipo[x.id] !== 'agrupador').every((x) => !esAgrupador(x)), 'ni productos, ni promociones, ni complementos');
});

test('leads y agrupadores: se reconocen y la conversación le pregunta el nivel, o lo pasa a recepción', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const martes = en('2026-10-06', '11:00');

    await t.test('un anuncio del Head Spa japonés → lead del agrupador; «quiero más información» → ¿cuál te interesa?', async () => {
      const lead = await altaLead(pool, { origen: 'meta_ctwa', telefono: '611000701', nombre: 'aitana PRUEBA', tratamiento: { textos: ['Head Spa japonés en Boadilla'] } }, { inscribir: false, ahora: martes });
      assert.equal(lead.tratamientoId, 'head-spa-japones');
      const r = await R.procesarEntrante(deps, { telefono: '+34611000701', texto: 'Hola, quiero más información', ahora: mas(martes, 1) });
      assert.equal(r.respuesta, 'Soy el asistente virtual de IEMEC. Tenemos varias opciones, Aitana: Head Spa Express o Head Spa Detox Purificante. ¿Cuál te interesa? Así te busco hueco.');
      const conv = await uno(pool, 'SELECT * FROM conversaciones WHERE id = ?', [r.conversacionId]);
      const pregunta = json(conv.pregunta_pendiente);
      assert.deepEqual([pregunta.tipo, pregunta.agrupadorId, pregunta.opciones], ['elegir_opcion', 'head-spa-japones', ['head-spa-express', 'head-spa-detox']]);
      assert.equal(conv.estado, 'esperando_paciente');
      const s = await uno(pool, "SELECT motivo FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [r.conversacionId]);
      assert.equal(s.motivo, 'sin_respuesta_a_opcion', 'si no contesta, se le vuelve a escribir');
    });

    await t.test('«el detox, por la tarde» → su lead pasa al Detox y le propone huecos de tarde; «la primera» → cita', async () => {
      const r = await R.procesarEntrante(deps, { telefono: '+34611000701', texto: 'El detox, por la tarde', ahora: mas(martes, 3) });
      assert.equal(r.opcion, 'head-spa-detox');
      assert.equal(r.eleccion, 'propuesta');
      assert.match(r.respuesta, /^¡Perfecto, Aitana! Para Head Spa Detox Purificante te puedo ofrecer el .+\. ¿Cuál te viene mejor\?$/);
      assert.equal(r.huecos.length, 3);
      assert.ok(r.huecos.every((h) => h.hora >= '15:00'), JSON.stringify(r.huecos));
      assert.equal((await uno(pool, "SELECT tratamiento_interes_id AS t FROM leads WHERE telefono = '+34611000701'")).t, 'head-spa-detox');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000701', texto: 'La primera', ahora: mas(martes, 5) });
      assert.equal(r2.eleccion, 'reservada');
      assert.equal((await uno(pool, 'SELECT tratamiento_id FROM citas WHERE id = ?', [r2.cita.id])).tratamiento_id, 'head-spa-detox');
      assert.equal(madrid(r2.cita.inicio), `${r.huecos[0].fecha} ${r.huecos[0].hora}`);
    });

    await t.test('vuelve por otro anuncio del Head Spa japonés: se queda con el que eligió', async () => {
      const r = await altaLead(pool, { origen: 'meta_ctwa', telefono: '611000701', tratamiento: { textos: ['Head Spa japonés'] } }, { inscribir: false, ahora: mas(martes, 60) });
      assert.deepEqual([r.nuevo, r.motivo, r.tratamientoId], [false, 'en_marcha', 'head-spa-detox']);
      assert.equal((await uno(pool, "SELECT tratamiento_interes_id AS t FROM leads WHERE telefono = '+34611000701'")).t, 'head-spa-detox');
    });

    await t.test('si no sabe cuál, no se le repite la pregunta: le ayuda una persona', async () => {
      await altaLead(pool, { origen: 'meta_formulario', telefono: '611000702', nombre: 'Berta', tratamiento: { respuesta: 'Head Spa' } }, { inscribir: false, ahora: martes });
      await R.procesarEntrante(deps, { telefono: '+34611000702', texto: '¿Me das info?', ahora: mas(martes, 1) });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000702', texto: 'No sé, ¿cuál me recomiendas?', ahora: mas(martes, 3) });
      assert.equal(r.respuesta, 'Sin problema, Berta. Una persona del equipo te ayuda a elegir y te propone cita por aquí enseguida.');
      const conv = await uno(pool, 'SELECT estado FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.equal(conv.estado, 'espera_persona');
      const tarea = await uno(pool, "SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r.conversacionId]);
      assert.match(tarea.titulo, /^No sabe qué opción de «Head Spa japonés \(Head Spa Sakura\)» elegir/);
    });

    await t.test('si en el primer mensaje ya dice el nivel, no se le pregunta', async () => {
      await altaLead(pool, { origen: 'meta_ctwa', telefono: '611000704', nombre: 'Celia', tratamiento: { textos: ['Head Spa japonés'] } }, { inscribir: false, ahora: martes });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000704', texto: 'Hola, quiero pedir cita para el Head Spa Express', ahora: mas(martes, 1) });
      assert.equal(r.huecos.length, 3);
      assert.equal((await uno(pool, 'SELECT huecos_tratamiento_id AS t FROM conversaciones WHERE id = ?', [r.conversacionId])).t, 'head-spa-express');
      assert.equal((await uno(pool, "SELECT tratamiento_interes_id AS t FROM leads WHERE telefono = '+34611000704'")).t, 'head-spa-express');
    });

    await t.test('lo íntimo (rejuvenecimiento vaginal) no se pregunta ni se nombra: lo lleva recepción', async () => {
      const lead = await altaLead(pool, { origen: 'meta_formulario', telefono: '611000703', nombre: 'Dora', tratamiento: { respuesta: 'Rejuvenecimiento vaginal' } }, { inscribir: false, ahora: martes });
      assert.equal(lead.tratamientoId, 'rejuvenecimiento-vaginal');
      const r = await R.procesarEntrante(deps, { telefono: '+34611000703', texto: 'Quiero información', ahora: mas(martes, 1) });
      assert.equal(r.respuesta, 'Soy el asistente virtual de IEMEC. Gracias, Dora. Lo revisa una persona del equipo y te contesta por aquí hoy mismo.');
      assert.equal((await uno(pool, 'SELECT estado FROM conversaciones WHERE id = ?', [r.conversacionId])).estado, 'espera_persona');
      const tarea = await uno(pool, "SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r.conversacionId]);
      assert.match(tarea.titulo, /agrupa varias técnicas: contarle las opciones y proponerle cita/);
    });
  } finally {
    await pool.end();
  }
});

test('«quiero más información», «¿qué precio tiene?» y las formas de pedir cita', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const martes = en('2026-10-06', '11:00');

    await t.test('un lead de la limpieza: lo aprobado, una primera visita con huecos y seguimiento a los 2 días', async () => {
      await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000711', 'Laura Prueba', 'meta_ctwa', 'limpieza-facial')");
      const r = await R.procesarEntrante(deps, { telefono: '+34611000711', texto: 'Hola, quiero más información', ahora: martes });
      assert.equal(r.decision.intencion, 'informacion');
      assert.equal(r.huecos.length, 3);
      assert.match(r.respuesta, /^Soy el asistente virtual de IEMEC\. Gracias, Laura\. Es una limpieza en profundidad del rostro: extracción, exfoliación y mascarilla, en unos 60 minutos\. Si quieres, te busco hueco para una primera visita con nuestro equipo, que te lo explica todo en persona y sin compromiso: el .+\. ¿Te reservo alguno\?$/);
      assert.doesNotMatch(r.respuesta, /acné activo/, 'lo que no está aprobado no sale');
      const conv = await uno(pool, 'SELECT * FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.equal(conv.estado, 'esperando_paciente');
      assert.equal(conv.huecos_tratamiento_id, 'limpieza-facial');
      const s = await uno(pool, "SELECT motivo, programado_para FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [r.conversacionId]);
      assert.equal(s.motivo, 'informacion');
      assert.equal(madrid(s.programado_para).slice(0, 10), '2026-10-08');
      assert.equal((await uno(pool, 'SELECT COUNT(*) AS n FROM tareas WHERE conversacion_id = ?', [r.conversacionId])).n, 0, 'nadie tiene que intervenir');
      // Y elige uno de los huecos: cita.
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000711', texto: 'La segunda', ahora: mas(martes, 5) });
      assert.equal(r2.eleccion, 'reservada');
    });

    await t.test('sin ser lead: «¿qué precio tiene la limpieza facial?» → la respuesta del precio; luego «¿y en qué consiste?», sin volver a preguntar cuál', async () => {
      const r = await R.procesarEntrante(deps, { telefono: '+34611000712', texto: 'Hola, ¿qué precio tiene la limpieza facial?', ahora: martes });
      assert.match(r.respuesta, /Gracias\. La sesión cuesta 54 euros\. Si quieres, te busco hueco/);
      assert.equal(r.huecos.length, 3);
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000712', texto: '¿Y en qué consiste?', ahora: mas(martes, 2) });
      assert.equal(r2.conversacionId, r.conversacionId);
      assert.match(r2.respuesta, /^Gracias\. Es una limpieza en profundidad del rostro/);
      assert.doesNotMatch(r2.respuesta, /Qué tratamiento te interesa/);
    });

    await t.test('sin saber qué le interesa: se le pregunta, con una valoración y seguimiento', async () => {
      const r = await R.procesarEntrante(deps, { telefono: '+34611000713', texto: '¿Me das info?', ahora: martes });
      assert.equal(r.respuesta, 'Soy el asistente virtual de IEMEC. Gracias. ¿Qué tratamiento te interesa? Te cuento lo que necesites y, si quieres, te busco hueco para una primera valoración con nuestro equipo, sin compromiso.');
      assert.deepEqual(r.huecos, []);
      assert.ok(await uno(pool, "SELECT id FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [r.conversacionId]));
      assert.equal((await uno(pool, 'SELECT COUNT(*) AS n FROM tareas WHERE conversacion_id = ?', [r.conversacionId])).n, 0);
    });

    await t.test('lo que agenda una persona: se le ofrece la valoración, sin huecos y sin tarea hasta que diga que sí', async () => {
      await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000714', 'Marta', 'meta_ctwa', 'toxina')");
      const r = await R.procesarEntrante(deps, { telefono: '+34611000714', texto: '¿Qué precio tiene?', ahora: martes });
      assert.equal(r.respuesta, 'Soy el asistente virtual de IEMEC. Gracias, Marta. Lo mejor es verlo en una valoración con nuestro equipo, sin compromiso. ¿Quieres que te busquemos hueco?');
      assert.doesNotMatch(r.respuesta, /toxina|b[oó]tox/i);
      assert.equal((await uno(pool, 'SELECT COUNT(*) AS n FROM tareas WHERE conversacion_id = ?', [r.conversacionId])).n, 0);
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000714', texto: 'Sí, por favor', ahora: mas(martes, 2) });
      assert.match((await uno(pool, "SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r2.conversacionId])).titulo, /proponerle huecos a mano/);
    });

    await t.test('el botón de WhatsApp de la web, «quisiera pedir cita» y «¿podría agendar…?»: huecos', async () => {
      const web = await R.procesarEntrante(deps, { telefono: '+34611000715', texto: 'Hola vengo de la web quisiera reservar una cita para limpieza facial profunda', ahora: martes });
      assert.equal(web.decision.intencion, 'reservar');
      assert.equal(web.huecos.length, 3);
      await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000716', 'Nerea', 'meta_formulario', 'limpieza-facial'), ('+34611000717', 'Olga', 'meta_formulario', 'limpieza-facial')");
      const quisiera = await R.procesarEntrante(deps, { telefono: '+34611000716', texto: 'Quisiera pedir cita', ahora: martes });
      assert.equal(quisiera.huecos.length, 3);
      assert.match(quisiera.respuesta, /Tengo estos huecos para ti/);
      const jueves = await R.procesarEntrante(deps, { telefono: '+34611000717', texto: '¿Podría agendar una cita para el jueves?', ahora: martes });
      assert.equal(jueves.eleccion, 'propuesta');
      assert.ok(jueves.huecos.length >= 1 && jueves.huecos.every((h) => h.fecha === '2026-10-08'), JSON.stringify(jueves.huecos));
    });
  } finally {
    await pool.end();
  }
});

test('lista de espera: el aviso que no llega pasa al siguiente; lo íntimo no se nombra; sin nombre, sin «Hola hola»', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  const lunes = en('2026-10-19', '10:00');
  let n = 0;
  // Se cancela una cita y la vuelta de la lista de espera se lo ofrece al primero.
  const liberar = async ({ fecha, hora, tratamiento = 'limpieza-facial', ahora }) => {
    const p = await paciente(pool, { nombre: 'Quien cancela', telefono: `+3461100089${n++}` });
    const c = await cita(pool, p, tratamiento, fecha, hora);
    await agenda.cancelar(pool, { id: c.id, por: 'paciente', motivo: 'no puede', ahora });
    return espera.vuelta(deps, { ahora: mas(ahora, 1) });
  };
  const apuntar = async (pacienteId, fecha, tratamiento = 'limpieza-facial', ahora = mas(lunes, -60)) =>
    (await LE.apuntar(pool, { pacienteId, tratamientoId: tratamiento, desdeFecha: fecha, hastaFecha: fecha, origen: 'panel', creadoPor: 'recepcion', ahora })).id;
  const ofertaDe = (id) => uno(pool, 'SELECT * FROM lista_espera_ofertas WHERE lista_espera_id = ? ORDER BY id DESC LIMIT 1', [id]);
  try {
    await sembrar(pool);

    await t.test('Meta avisa de que la plantilla del aviso no le llegó: el hueco pasa al siguiente y recepción le llama', async () => {
      const nora = await paciente(pool, { nombre: 'Nora', telefono: '+34611000801' });
      const olga = await paciente(pool, { nombre: 'Olga', telefono: '+34611000802' });
      const enNora = await apuntar(nora, '2026-10-21');
      const enOlga = await apuntar(olga, '2026-10-21', 'limpieza-facial', mas(lunes, -30));
      assert.equal((await liberar({ fecha: '2026-10-21', hora: '12:00', ahora: lunes })).ofrecidas, 1);
      const aviso = alTelefono(whatsapp, '+34611000801').at(-1);
      assert.equal(aviso.nombre, 'iemec_hueco_liberado');
      const o = await ofertaDe(enNora);
      const cambiados = await entrada.aplicarEstado(deps, { waId: aviso.waId, estado: 'fallido', error: { codigo: '131026', texto: 'No se puede entregar el mensaje' } }, { ahora: mas(lunes, 5) });
      assert.equal(cambiados, 1);
      assert.equal((await ofertaDe(enNora)).estado, 'anulada');
      assert.equal((await uno(pool, 'SELECT estado FROM citas WHERE id = ?', [o.cita_id])).estado, 'cancelada', 'el hueco que se le guardaba, libre');
      assert.equal((await uno(pool, 'SELECT estado FROM lista_espera WHERE id = ?', [enNora])).estado, 'esperando', 'sigue en la lista');
      const tareas = await todos(pool, "SELECT tipo, titulo FROM tareas WHERE paciente_id = ? AND estado = 'abierta'", [nora]);
      assert.equal(tareas.length, 1, 'una sola tarea: la de llamarle');
      assert.equal(tareas[0].tipo, 'llamar');
      assert.match(tareas[0].titulo, /no le ha llegado por WhatsApp el aviso del hueco del miércoles 21 de octubre a las 12:00/);
      assert.equal((await espera.vuelta(deps, { ahora: mas(lunes, 6) })).ofrecidas, 1);
      assert.equal(alTelefono(whatsapp, '+34611000802').length, 1, 'se le ofrece a Olga');
      assert.equal((await ofertaDe(enOlga)).estado, 'ofrecida');
    });

    await t.test('si era un texto (ventana abierta), igual; y la conversación no se queda esperando a una persona', async () => {
      const pia = await paciente(pool, { nombre: 'Pía', telefono: '+34611000803' });
      await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado, ventana_hasta) VALUES ('+34611000803', ?, 'cerrada', ?)", [pia, mas(lunes, 600)]);
      const enPia = await apuntar(pia, '2026-10-22');
      await liberar({ fecha: '2026-10-22', hora: '12:00', ahora: mas(lunes, 10) });
      const aviso = alTelefono(whatsapp, '+34611000803').at(-1);
      assert.equal(aviso.tipo, 'texto');
      await entrada.aplicarEstado(deps, { waId: aviso.waId, estado: 'fallido', error: { codigo: '131026', texto: 'No se puede entregar el mensaje' } }, { ahora: mas(lunes, 12) });
      assert.equal((await ofertaDe(enPia)).estado, 'anulada');
      const o = await ofertaDe(enPia);
      assert.notEqual((await uno(pool, 'SELECT estado FROM conversaciones WHERE id = ?', [o.conversacion_id])).estado, 'espera_persona');
      assert.equal((await todos(pool, "SELECT id FROM tareas WHERE paciente_id = ? AND estado = 'abierta'", [pia])).length, 1);
    });

    await t.test('un aviso que no es de la lista de espera sigue como antes: a una persona', async () => {
      const r = await R.procesarEntrante(deps, { telefono: '+34611000804', texto: 'Me lo pienso y os digo', ahora: mas(lunes, 20) });
      await entrada.aplicarEstado(deps, { waId: r.envio.waId, estado: 'fallido', error: { codigo: '131026', texto: 'No se puede entregar el mensaje' } }, { ahora: mas(lunes, 21) });
      assert.match((await uno(pool, "SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [r.conversacionId])).titulo, /^No le ha llegado nuestro mensaje/);
    });

    await t.test('lo íntimo no se nombra en el aviso, ni por su familia; y sin nombre, «Hola buenos días» (no «Hola hola» ni «Hola Paciente»)', async () => {
      const sin = await paciente(pool, { nombre: 'Paciente', telefono: '+34611000805' });
      await apuntar(sin, '2026-10-23', 'laser-intimo');
      assert.equal((await liberar({ fecha: '2026-10-23', hora: '12:00', tratamiento: 'laser-intimo', ahora: mas(lunes, 30) })).ofrecidas, 1);
      const aviso = alTelefono(whatsapp, '+34611000805').at(-1);
      assert.deepEqual(aviso.variables, ['buenos días', 'tu tratamiento', 'viernes 23 de octubre', '12:00']);
      const [texto] = await textos(pool, '+34611000805');
      assert.equal(texto, 'Hola buenos días, estabas en nuestra lista de espera para tu tratamiento: se ha liberado un hueco el viernes 23 de octubre a las 12:00. ¿Te lo guardamos?');
      assert.doesNotMatch(texto, /l[aá]ser|vaginal|atrofia|ginecol|Paciente/i);

      // Con la ventana abierta va como texto: «Hola, …».
      const eli = await paciente(pool, { nombre: 'Paciente', telefono: '+34611000806' });
      await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado, ventana_hasta) VALUES ('+34611000806', ?, 'cerrada', ?)", [eli, mas(lunes, 600)]);
      await apuntar(eli, '2026-10-24', 'laser-intimo');
      await liberar({ fecha: '2026-10-24', hora: '12:00', tratamiento: 'laser-intimo', ahora: mas(lunes, 40) });
      const libre = alTelefono(whatsapp, '+34611000806').at(-1);
      assert.match(libre.texto, /^Hola, estabas en nuestra lista de espera para tu tratamiento: se ha liberado un hueco el sábado 24 de octubre a las 12:00\./);
    });
  } finally {
    await pool.end();
  }
});

test('reservar: solo acaba el «toca repetir» de ese tratamiento y cierra las tareas de recuperación', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);

    await t.test('le toca repetir dos tratamientos: al reservar uno, el otro sigue', async () => {
      const carla = await paciente(pool, { nombre: 'Carla', telefono: '+34611000821', consentimiento: true });
      const h = await cita(pool, carla, 'hidratacion-facial', '2026-10-07', '12:00');
      const p = await cita(pool, carla, 'peeling-facial', '2026-10-07', '13:30');
      await estados.marcar(pool, { id: h.id, estado: 'completada', ahora: en('2026-10-07', '13:05') });
      await estados.marcar(pool, { id: p.id, estado: 'completada', ahora: en('2026-10-07', '14:05') });
      const antes = await todos(pool, "SELECT cita_id, estado FROM inscripciones WHERE paciente_id = ? AND secuencia = 'toca_repetir' ORDER BY id", [carla]);
      assert.deepEqual(antes.map((i) => [i.cita_id, i.estado]), [[h.id, 'activa'], [p.id, 'activa']]);
      await agenda.reservar(pool, { pacienteId: carla, tratamientoId: 'hidratacion-facial', fecha: '2026-11-10', hora: '12:00', ahora: en('2026-10-08', '10:00') });
      const despues = await todos(pool, "SELECT cita_id, estado, motivo_fin FROM inscripciones WHERE paciente_id = ? AND secuencia = 'toca_repetir' ORDER BY id", [carla]);
      assert.deepEqual(despues.map((i) => [i.cita_id, i.estado]), [[h.id, 'terminada'], [p.id, 'activa']]);
      assert.equal(despues[0].motivo_fin, 'cita');
    });

    await t.test('«no vino» sin consentimiento → tarea de llamarle; al reservar otra cita, esa tarea queda hecha', async () => {
      const rosa = await paciente(pool, { nombre: 'Rosa', telefono: '+34611000822' });
      const c = await cita(pool, rosa, 'limpieza-facial', '2026-10-08', '12:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-08', '12:20') });
      const tarea = r.efectos.recuperar.tarea;
      assert.ok(tarea);
      const nueva = await agenda.reservar(pool, { pacienteId: rosa, tratamientoId: 'limpieza-facial', fecha: '2026-10-15', hora: '12:00', ahora: en('2026-10-09', '10:00') });
      const t2 = await uno(pool, 'SELECT estado, resultado, hecha_en FROM tareas WHERE id = ?', [tarea]);
      assert.deepEqual([t2.estado, t2.resultado], ['hecha', 'Ya tiene cita nueva']);
      assert.ok(t2.hecha_en);
      const ev = await uno(pool, "SELECT datos FROM eventos WHERE tipo = 'cita_reservada' AND entidad_id = ?", [String(nueva.id)]);
      assert.deepEqual(json(ev.datos).tareasCerradas, [tarea], 'queda dicho en el hecho de la reserva');
      // Las tareas de otras cosas no se tocan.
      const [otra] = await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, vence_en) VALUES ('llamar', 'Llamarle por su presupuesto', ?, ?)", [rosa, en('2026-10-10', '10:00')]);
      await agenda.reservar(pool, { pacienteId: rosa, tratamientoId: 'limpieza-facial', fecha: '2026-10-22', hora: '12:00', ahora: en('2026-10-09', '11:00') });
      assert.equal((await uno(pool, 'SELECT estado FROM tareas WHERE id = ?', [otra.insertId])).estado, 'abierta');
    });

    await t.test('con un hueco que solo se le guarda, la tarea sigue; al confirmarlo, hecha', async () => {
      const tere = await paciente(pool, { nombre: 'Tere', telefono: '+34611000823' });
      const c = await cita(pool, tere, 'limpieza-facial', '2026-10-08', '15:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-08', '15:20') });
      const ahora = en('2026-10-09', '10:00');
      const retenida = await agenda.reservar(pool, { pacienteId: tere, tratamientoId: 'limpieza-facial', fecha: '2026-10-16', hora: '12:00', retener: true, retenerMin: 30, ahora });
      assert.equal((await uno(pool, 'SELECT estado FROM tareas WHERE id = ?', [r.efectos.recuperar.tarea])).estado, 'abierta');
      await agenda.confirmarRetenida(pool, { id: retenida.id, ahora: mas(ahora, 5) });
      assert.equal((await uno(pool, 'SELECT estado FROM tareas WHERE id = ?', [r.efectos.recuperar.tarea])).estado, 'hecha');
    });
  } finally {
    await pool.end();
  }
});

test('cancelar por WhatsApp: si no reserva otra, entra en la secuencia «cancelación», sin duplicarla', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  const martes = en('2026-10-06', '11:00');
  const cancelar = async (telefono, ahora = martes, si = 'Sí, cancélala') => {
    await R.procesarEntrante(deps, { telefono, texto: 'Quiero cancelar la cita', ahora });
    return R.procesarEntrante(deps, { telefono, texto: si, ahora: mas(ahora, 2) });
  };
  const inscripciones = (pacienteId) => todos(pool, "SELECT * FROM inscripciones WHERE paciente_id = ? AND secuencia = 'cancelacion' ORDER BY id", [pacienteId]);
  try {
    await sembrar(pool);

    await t.test('cancela → secuencia «cancelación» con su cita; a las 48 h, la plantilla con el tratamiento', async () => {
      const elena = await paciente(pool, { nombre: 'Elena', telefono: '+34611000901', consentimiento: true });
      const c = await cita(pool, elena, 'limpieza-facial', '2026-10-20', '12:00');
      const r = await cancelar('+34611000901');
      assert.equal(r.sobreCita, 'cancelada');
      const [ins] = await inscripciones(elena);
      assert.deepEqual([ins.cita_id, ins.estado], [c.id, 'activa']);
      assert.equal(r.recuperar.inscripcion, ins.id);
      const ev = await uno(pool, "SELECT datos FROM eventos WHERE tipo = 'cita_cancelada' AND entidad_id = ?", [String(c.id)]);
      assert.equal(json(ev.datos).efectos.recuperar.inscripcion, ins.id, 'queda en el hecho de la cancelación');
      assert.equal(madrid(ins.siguiente_en), '2026-10-08 11:02');
      await R.avanzarSecuencias(deps, { ahora: en('2026-10-08', '11:05') });
      const m = alTelefono(whatsapp, '+34611000901').at(-1);
      assert.deepEqual([m.nombre, m.variables], ['iemec_cancelacion_nuevo_hueco', ['Elena', 'limpieza facial profunda']]);
      assert.match((await textos(pool, '+34611000901')).at(-1), /^Hola Elena, vimos que tuviste que cancelar tu cita de limpieza facial profunda\./);
    });

    await t.test('«No» a «¿Te busco otro momento?»: no se le persigue', async () => {
      const fina = await paciente(pool, { nombre: 'Fina', telefono: '+34611000902', consentimiento: true });
      await cita(pool, fina, 'limpieza-facial', '2026-10-21', '12:00');
      await cancelar('+34611000902');
      const r = await R.procesarEntrante(deps, { telefono: '+34611000902', texto: 'No, gracias', ahora: mas(martes, 5) });
      assert.equal(r.sobreCita, 'sin_otra');
      const [ins] = await inscripciones(fina);
      assert.deepEqual([ins.estado, ins.motivo_fin], ['cancelada', 'no quiere otra cita por ahora']);
    });

    await t.test('si reserva otra, la secuencia se acaba', async () => {
      const gala = await paciente(pool, { nombre: 'Gala', telefono: '+34611000903', consentimiento: true });
      await cita(pool, gala, 'limpieza-facial', '2026-10-22', '12:00');
      await cancelar('+34611000903');
      const r = await R.procesarEntrante(deps, { telefono: '+34611000903', texto: 'Sí, por la tarde', ahora: mas(martes, 5) });
      assert.equal(r.eleccion, 'propuesta');
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000903', texto: 'La primera', ahora: mas(martes, 7) });
      assert.equal(r2.eleccion, 'reservada');
      const [ins] = await inscripciones(gala);
      assert.deepEqual([ins.estado, ins.motivo_fin], ['terminada', 'cita']);
    });

    await t.test('sin duplicar: si ya está en la secuencia (un «no vino» u otra cancelación) o tiene otra cita, no entra otra vez', async () => {
      const hebe = await paciente(pool, { nombre: 'Hebe', telefono: '+34611000904', consentimiento: true });
      const vieja = await cita(pool, hebe, 'limpieza-facial', '2026-10-02', '12:00', { ahora: en('2026-09-25', '10:00') });
      await cita(pool, hebe, 'limpieza-facial', '2026-10-23', '12:00');
      await pool.query("UPDATE citas SET estado = 'no_presentada' WHERE id = ?", [vieja.id]);
      await R.inscribir(pool, { secuencia: 'cancelacion', pacienteId: hebe, citaId: vieja.id, inicio: en('2026-10-02', '12:30') });
      const r = await cancelar('+34611000904');
      assert.equal(r.sobreCita, 'cancelada');
      assert.match(r.recuperar.omitido, /ya está en la secuencia/);
      assert.equal((await inscripciones(hebe)).length, 1);

      const iris = await paciente(pool, { nombre: 'Iris', telefono: '+34611000905', consentimiento: true });
      await cita(pool, iris, 'limpieza-facial', '2026-10-20', '17:00');
      await cita(pool, iris, 'hidratacion-facial', '2026-10-27', '17:00');
      await R.procesarEntrante(deps, { telefono: '+34611000905', texto: 'Quiero cancelar la cita del martes 20', ahora: martes });
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000905', texto: 'Sí', ahora: mas(martes, 2) });
      assert.equal(r2.sobreCita, 'cancelada');
      assert.deepEqual(r2.recuperar, { omitido: 'ya tiene otra cita' });
      assert.equal((await inscripciones(iris)).length, 0);
    });

    await t.test('sin permiso para mensajes comerciales: tarea de llamarle, que se cierra si reserva otra', async () => {
      const hugo = await paciente(pool, { nombre: 'Hugo', telefono: '+34611000906' });
      await cita(pool, hugo, 'limpieza-facial', '2026-10-20', '13:30');
      const r = await cancelar('+34611000906');
      assert.equal(r.recuperar.omitido, 'no tiene consentimiento para mensajes comerciales');
      const tarea = await uno(pool, 'SELECT tipo, titulo, estado FROM tareas WHERE id = ?', [r.recuperar.tarea]);
      assert.deepEqual([tarea.tipo, tarea.estado], ['llamar', 'abierta']);
      assert.equal(tarea.titulo, 'Canceló por WhatsApp su cita el martes 20 de octubre a las 13:30: llamarle para buscarle otro hueco (no tiene consentimiento para mensajes comerciales)');
      assert.equal((await inscripciones(hugo)).length, 0);
      await agenda.reservar(pool, { pacienteId: hugo, tratamientoId: 'limpieza-facial', fecha: '2026-10-29', hora: '12:00', ahora: mas(martes, 60) });
      assert.equal((await uno(pool, 'SELECT estado FROM tareas WHERE id = ?', [r.recuperar.tarea])).estado, 'hecha');
    });

    await t.test('lo íntimo no se nombra en la plantilla: «tu cita de hace unos días»', async () => {
      const julia = await paciente(pool, { nombre: 'Julia', telefono: '+34611000907', consentimiento: true });
      await cita(pool, julia, 'laser-intimo', '2026-10-20', '12:00');
      await cancelar('+34611000907');
      await R.avanzarSecuencias(deps, { ahora: en('2026-10-08', '11:30') });
      const m = alTelefono(whatsapp, '+34611000907').at(-1);
      assert.deepEqual([m.nombre, m.variables], ['iemec_cancelacion_nuevo_hueco', ['Julia', 'hace unos días']]);
      assert.doesNotMatch((await textos(pool, '+34611000907')).at(-1), /l[aá]ser|vaginal|atrofia/i);
    });
  } finally {
    await pool.end();
  }
});

test('textos sin datos: sin nombre, «Hola» a secas; sin tratamiento, «tu interés en IEMEC»', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  const martes = en('2026-10-06', '11:00');
  try {
    await sembrar(pool);

    await t.test('un lead sin nombre ni tratamiento: bienvenida «Gracias por tu interés en IEMEC» y seguimiento «sobre nuestros tratamientos»', async () => {
      const r = await altaLead(pool, { origen: 'web', telefono: '611000931' }, { ahora: martes });
      assert.equal(r.inscrito, true);
      await R.avanzarSecuencias(deps, { ahora: martes });
      const b = alTelefono(whatsapp, '+34611000931').at(-1);
      assert.deepEqual([b.nombre, b.variables], ['iemec_lead_bienvenida', ['buenos días', 'IEMEC']]);
      const [texto] = await textos(pool, '+34611000931');
      assert.match(texto, /^Hola buenos días, soy el asistente virtual de IEMEC\. Gracias por tu interés en IEMEC\. /);
      assert.doesNotMatch(texto, /Hola hola|tu interés en tu tratamiento/);
      await R.avanzarSecuencias(deps, { ahora: mas(martes, 4 * 60 + 1) });
      const s = alTelefono(whatsapp, '+34611000931').at(-1);
      assert.deepEqual([s.nombre, s.variables], ['iemec_lead_seguimiento', ['buenas tardes', 'nuestros tratamientos']]);
    });

    await t.test('«como quedamos» sin tratamiento: «buscarte hueco para una primera valoración»', async () => {
      const r = await R.procesarEntrante(deps, { telefono: '+34611000932', texto: 'Escríbeme la semana que viene', ahora: martes });
      const s = await uno(pool, "SELECT programado_para FROM seguimientos WHERE conversacion_id = ? AND estado = 'pendiente'", [r.conversacionId]);
      await R.procesarSeguimientos(deps, { ahora: s.programado_para });
      const m = alTelefono(whatsapp, '+34611000932').at(-1);
      assert.deepEqual([m.nombre, m.variables], ['iemec_como_quedamos', ['buenos días', 'una primera valoración']]);
      assert.match((await textos(pool, '+34611000932')).at(-1), /^Hola buenos días, como quedamos, te escribo para buscarte hueco para una primera valoración\./);
    });

    await t.test('una plantilla que pide un dato que no tenemos (el importe de la tarjeta regalo) no sale: lo escribe una persona', async () => {
      const vera = await paciente(pool, { nombre: 'Vera', telefono: '+34611000933', consentimiento: true });
      await R.inscribir(pool, { secuencia: 'vale_regalo', pacienteId: vera, inicio: martes });
      const hechos = await R.avanzarSecuencias(deps, { ahora: mas(martes, 1) });
      assert.ok(hechos.some((h) => h.fallido === 'faltan datos'), JSON.stringify(hechos));
      assert.deepEqual(alTelefono(whatsapp, '+34611000933'), []);
      assert.match((await uno(pool, 'SELECT titulo FROM tareas WHERE paciente_id = ?', [vera])).titulo, /pide un dato que no tenemos/);
    });
  } finally {
    await pool.end();
  }
});

test('«por la tarde» es por la tarde; si no hay, se dice y se ofrece la mañana', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  const martes = en('2026-10-06', '11:00');
  try {
    await sembrar(pool);
    await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000941', 'Lola', 'meta_ctwa', 'limpieza-facial'), ('+34611000942', 'Mia', 'meta_ctwa', 'limpieza-facial')");

    await t.test('los huecos que se le proponen son todos de su franja (aunque algún día no la tenga)', async () => {
      // El miércoles por la tarde la esteticista no está: ese día solo quedan mañanas.
      await pool.query('INSERT INTO profesional_ausencias (profesional_id, desde, hasta) VALUES (20, ?, ?)', [en('2026-10-07', '14:00'), en('2026-10-07', '20:00')]);
      const r = await R.procesarEntrante(deps, { telefono: '+34611000941', texto: 'Quiero información, mejor por las tardes', ahora: martes });
      assert.equal(r.huecos.length, 3);
      assert.ok(r.huecos.every((h) => h.hora >= '15:00'), JSON.stringify(r.huecos));
      assert.ok(!r.huecos.some((h) => h.fecha === '2026-10-07'), 'el miércoles no se rellena con mañanas');
      const m = await R.procesarEntrante(deps, { telefono: '+34611000942', texto: 'Escríbeme la semana que viene por la mañana', ahora: martes });
      assert.ok(m.huecos.length >= 1 && m.huecos.every((h) => h.hora < '14:00'), JSON.stringify(m.huecos));
    });

    await t.test('con fecha límite (llegar bien a un evento), ninguno después', async () => {
      const r = await R.huecosParaProponer(pool, { desdeFecha: '2026-10-07', hastaFecha: '2026-10-07', franja: null }, { id: 'limpieza-facial', reservable_ia: 1 }, martes);
      assert.ok(r.huecos.length >= 1 && r.huecos.every((h) => h.fecha === '2026-10-07'), JSON.stringify(r.huecos));
    });
  } finally {
    await pool.end();
  }

  // La esteticista solo trabaja por la mañana: por la tarde no hay nada.
  const pool2 = await prepararBdDePrueba(t);
  const deps2 = { pool: pool2, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool2, { soloMananas: true });
    await pool2.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000943', 'Nuria', 'meta_ctwa', 'limpieza-facial')");
    await t.test('sin tardes libres: se le dice y se le ofrecen mañanas', async () => {
      const r = await R.procesarEntrante(deps2, { telefono: '+34611000943', texto: 'Quiero información, mejor por las tardes', ahora: martes });
      assert.ok(r.huecos.length >= 1 && r.huecos.every((h) => h.hora < '14:00'), JSON.stringify(r.huecos));
      assert.match(r.respuesta, /: por la tarde no me queda nada estos días, pero por la mañana tengo el .+\. ¿Te reservo alguno\?$/);
      const p = await R.huecosParaProponer(pool2, { desdeFecha: '2026-10-07', franja: 'tarde' }, { id: 'limpieza-facial', reservable_ia: 1 }, martes);
      assert.deepEqual([p.franjaSinHuecos, p.franjaOfrecida], ['tarde', 'manana']);
    });
  } finally {
    await pool2.end();
  }
});
