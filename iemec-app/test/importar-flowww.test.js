'use strict';
// Importación de Flowww (servidor/importacion-flowww.js y scripts/importar-flowww.js) con CSV
// INVENTADOS (test/fixtures/flowww): pacientes en UTF-8 con BOM y «;», citas en Windows-1252 con «,»,
// comillas, teléfonos raros, duplicados, un móvil compartido, servicios y profesionales que no casan,
// citas que chocan o caen fuera de horario o de su cabina. El ensayo no escribe nada; aplicar mete
// todo en una transacción; la segunda vez no duplica, y lo que en Flowww ya no es así se queda sin
// recordatorios y a revisar; las citas importadas no llevan confirmación pero sí recordatorios (salvo
// que se pida lo contrario); y deshacer quita lo que nadie ha tocado sin olvidar ninguna oposición.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { prepararBdDePrueba, BD_PRUEBAS } = require('./ayuda-bd');
const I = require('../servidor/importacion-flowww');
const agenda = require('../servidor/agenda');
const avisos = require('../servidor/avisos-cita');
const R = require('../servidor/repesca/motor');
const { cifrar, descifrar } = require('../servidor/cripto');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const F = require('../motor/importacion/flowww');
const T = require('../motor/tiempo');

const FIXTURES = path.join(__dirname, 'fixtures', 'flowww');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'importar-flowww.js');
const fichero = (nombre) => ({ nombre, contenido: fs.readFileSync(path.join(FIXTURES, nombre)) });
const csv = (nombre, texto) => ({ nombre, contenido: Buffer.from(texto) });
const MAPA = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mapa.json'), 'utf8'));
const AHORA = new Date('2026-10-13T08:00:00Z'); // martes 13 de octubre, 10:00 en Madrid
const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
const parsear = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
// El enlace de «Tu cita»: el token (hasta la migración 010 de la vuelta 8c) o su huella (después).
const tieneEnlace = (c) => Boolean(c.token || c.token_hash);
// Lo que no puede salir nunca en el informe: nombres, teléfonos, emails ni notas de los pacientes.
const PERSONALES = /Carmen|Lucía|Laura|Marta|Sergio|Irene|Julia|Pablo|Nuria|Sara|Elena|Ruiz|Gómez|Vidal|611 ?0\d\d|\+34|ejemplo\.invalid|látex|crema|00000000T/;

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto) VALUES (1, 'Clínica de prueba', 'IEMEC')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '10:00', '20:00')", [d]);
  await pool.query("INSERT INTO festivos (fecha, nombre, ambito) VALUES ('2026-11-09', 'Festivo de ejemplo', 'local')");
  await pool.query(`INSERT INTO salas (id, codigo, nombre, tipo, orden) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica', 1),
    (2, 'consulta-1', 'Consulta 1', 'consulta_medica', 2), (3, 'cabina-corporal', 'Cabina corporal', 'cabina_estetica', 3)`);
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (10, 'medico-ejemplo', 'Dra. Ana Médica Ejemplo', 'medico'), (20, 'estetica-uno', 'Estética Uno', 'esteticista'), (21, 'estetica-dos', 'Estética Dos', 'esteticista')");
  for (const d of [1, 2, 3, 4, 5, 6]) {
    for (const p of [10, 20, 21]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (?, ?, '10:00', '20:00')", [p, d]);
  }
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial'), ('corporal', 'Corporal')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, rol_profesional, sala_tipo, alias) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 60, 10, 'esteticista', 'cabina_estetica', '["Higiene facial"]'),
    ('toxina-tercio', 'Toxina botulínica tercio superior', 'facial', 30, 10, 'medico', 'consulta_medica', '["Bótox tercio superior"]'),
    ('toxina-3-zonas', 'Toxina botulínica 3 zonas', 'facial', 45, 10, 'medico', 'consulta_medica', NULL),
    ('presoterapia', 'Presoterapia', 'corporal', 45, 10, 'esteticista', 'cabina_estetica', NULL),
    ('ritual', 'Ritual relajante', 'corporal', 60, 10, NULL, 'cabina_estetica', NULL)`);
  // La limpieza facial solo en la cabina facial; la presoterapia, solo en la corporal.
  await pool.query("INSERT INTO tratamiento_salas (tratamiento_id, sala_id) VALUES ('limpieza-facial', 1), ('presoterapia', 3)");
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
  // Ya en la app: Laura escribió por WhatsApp (sin apellidos) y está en una secuencia; Marta se dio de
  // alta en recepción solo con su email; y otra paciente tiene cita el jueves a las 12:30 en la cabina facial.
  const [laura] = await pool.query("INSERT INTO pacientes (nombre, telefono, origen) VALUES ('Laura', '+34611000301', 'whatsapp')");
  const [marta] = await pool.query("INSERT INTO pacientes (nombre, apellidos, email, origen) VALUES ('Marta', 'Vidal', 'marta.vidal@ejemplo.invalid', 'recepcion')");
  const [otra] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Otra', '+34611000199')");
  const cita = await agenda.reservar(pool, { pacienteId: otra.insertId, tratamientoId: 'limpieza-facial', fecha: '2026-10-15', hora: '12:30', profesionalId: 20, ahora: new Date('2026-10-12T08:00:00Z') });
  const secuencia = async (nombre, pacienteId, leadId = null) => (await pool.query(
    "INSERT INTO inscripciones (secuencia, paciente_id, lead_id, inicio, siguiente_en) VALUES (?, ?, ?, '2026-10-01 08:00:00', '2026-10-20 08:00:00')", [nombre, pacienteId, leadId]))[0].insertId;
  // Y Julia pidió información por un anuncio (es lead, aún sin ficha): su secuencia la persigue.
  const [lead] = await pool.query("INSERT INTO leads (telefono, nombre, origen) VALUES ('+34611000701', 'Julia', 'meta_formulario')");
  return {
    laura: laura.insertId, marta: marta.insertId, citaOtra: cita.id, inscripcion: await secuencia('dormido', laura.insertId),
    inscripcionMarta: await secuencia('toca_repetir', marta.insertId), inscripcionLead: await secuencia('lead', null, lead.insertId),
  };
}

async function contar(pool) {
  const n = async (sql) => Number((await pool.query(sql))[0][0].n);
  return {
    pacientes: await n('SELECT COUNT(*) AS n FROM pacientes'),
    conFlowww: await n('SELECT COUNT(*) AS n FROM pacientes WHERE flowww_id IS NOT NULL'),
    citas: await n('SELECT COUNT(*) AS n FROM citas'),
    sinRecordatorios: await n('SELECT COUNT(*) AS n FROM citas WHERE NOT recordatorios'),
    consentimientos: await n('SELECT COUNT(*) AS n FROM consentimientos'),
    tareas: await n('SELECT COUNT(*) AS n FROM tareas'),
    mapeos: await n('SELECT COUNT(*) AS n FROM mapeo_tratamientos'),
    eventos: await n('SELECT COUNT(*) AS n FROM eventos'),
    bajas: await n('SELECT COUNT(*) AS n FROM pacientes WHERE baja_comercial_en IS NOT NULL'),
    secuencias: await n("SELECT COUNT(*) AS n FROM inscripciones WHERE estado = 'activa'"),
  };
}

// La exportación del día del apagado: la de las citas completa (desde hoy), con lo que ha cambiado en
// Flowww desde la de prueba: C-1 ha pasado a las 11:00, C-4 se ha anulado y hay dos nuevas, C-21 solo
// con el nombre de un paciente que ya se importó.
function exportacionFinal() {
  const original = new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(FIXTURES, 'citas.csv')));
  const cambiada = original
    .replace('C-1,1001,"Ruiz Soler, Carmen",,15/10/2026,10:00,', 'C-1,1001,"Ruiz Soler, Carmen",,15/10/2026,11:00,')
    .replace(/^(C-4,.*,)Confirmada,$/m, '$1Anulada,');
  assert.equal(cambiada.split('\n').filter((l, i) => l !== original.split('\n')[i]).length, 2);
  return csv('citas-final.csv', `${cambiada}C-20,1006,"Mora, Irene",,27/10/2026,12:00,45,Botox 3 zonas,Dra. Médica,Consulta,Confirmada,\n`
    + 'C-21,,"Marín, Sergio",,28/10/2026,16:00,60,Limpieza facial profunda,Estética Uno,Cabina facial,Confirmada,\n');
}

test('importación de Flowww: ensayo, aplicar, repetir, avisos y deshacer', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const app = await sembrar(pool);
    const ficheros = { pacientes: fichero('pacientes.csv'), citas: fichero('citas.csv') };
    let lote;

    await t.test('el ensayo no escribe nada y lo cuenta todo, sin datos de los pacientes en el informe', async () => {
      const antes = await contar(pool);
      const r = await I.importar(pool, { ...ficheros, ahora: AHORA });
      assert.equal(r.aplicado, false);
      assert.deepEqual(await contar(pool), antes, 'la base queda igual');
      const fila = (n) => r.plan.pacientes.find((e) => e.origen === 'pacientes' && e.fila === n);
      assert.equal(fila(2).accion, 'nuevo');
      assert.deepEqual([fila(3).accion, fila(3).telefono, fila(3).compartido], ['nuevo', null, 'de la fila 2'], 'la hija con el móvil de la madre: sin teléfono');
      assert.deepEqual([fila(4).accion, fila(4).pacienteId, fila(4).via], ['existente', app.laura, 'teléfono']);
      assert.deepEqual([fila(5).accion, fila(5).pacienteId, fila(5).via, fila(5).completarTelefono], ['existente', app.marta, 'email', '+34611000302']);
      assert.deepEqual([fila(9).accion, fila(9).igualA.fila], ['repetido', 2]);
      assert.deepEqual(fila(10).errores, ['sin nombre']);
      assert.equal(r.plan.bloqueos.length, 3);

      const inf = r.informe;
      assert.match(inf, /^Importación de Flowww · ENSAYO: no se ha escrito nada\./);
      assert.match(inf, /Confidencial: sin nombres ni teléfonos, pero con la app o el CSV se sabe de quién es cada fila\. Trátalo como los CSV\./);
      assert.match(inf, /PACIENTES · pacientes\.csv \(UTF-8 con BOM, separador «;», 11 filas\)/);
      assert.match(inf, /CITAS · citas\.csv \(Windows-1252, separador «,», 18 filas\)/);
      assert.match(inf, /No se traen: «DNI»/);
      assert.match(inf, new RegExp(`fila 4 \\(Flowww 1003\\) → paciente ${app.laura} de la app, por teléfono; se completa: apellidos, nacimiento\n`));
      assert.match(inf, new RegExp(`fila 5 \\(Flowww 1004\\) → paciente ${app.marta} de la app, por email; se completa: teléfono \\(para sus recordatorios\\)`));
      assert.match(inf, /fila 3 \(Flowww 1002\): el teléfono ya es de la fila 2/);
      assert.match(inf, /Marketing: 2 con «sí» en una columna \(se registra su consentimiento\); 2 con «no» .*; 5 sin nada: importar no da consentimiento/);
      assert.match(inf, /1 pasada y 1 anulada: no se traen/);
      assert.match(inf, /1 bloqueo o nota de agenda \(sin paciente\)/);
      assert.match(inf, /1 fila repetida \(la misma cita dos veces\): 17/);
      assert.match(inf, new RegExp(`fila 4 · jue 15/10/2026 13:00 · Limpieza facial profunda: Cabina facial ocupada por otra cita de las 12:30 \\(la cita ${app.citaOtra} de la app\\)`));
      assert.match(inf, /fila 6 · jue 15\/10\/2026 16:30 · Limpieza facial profunda: Cabina facial ocupada por otra cita de las 16:00 \(la fila 5 de las citas\)/);
      assert.match(inf, /fila 7 · vie 16\/10\/2026 12:00 · Presoterapia: en Flowww, «Cabina facial», que no es de este tratamiento → Cabina corporal/);
      assert.match(inf, /fila 8 · lun 09\/11\/2026 11:00 · Limpieza facial profunda: es festivo/);
      assert.match(inf, /fila 9 · mar 20\/10\/2026 19:30 · Limpieza facial profunda: cae fuera del horario de la clínica/);
      assert.match(inf, /fila 18: fecha «31\/02\/2026» no válida/);
      assert.match(inf, /2 pacientes nuevos que solo salen en las citas \(con el nombre de la cita, y su teléfono si lo trae y no es de otra persona\): fila 16, fila 19\n\s+1 se queda sin teléfono y no le llegarán los recordatorios: fila 19 de las citas/);
      assert.match(inf, /«Higiene facial» → Limpieza facial profunda \(por un alias\)/);
      assert.match(inf, /«Dra\. Médica» → Dra\. Ana Médica Ejemplo \(por parte del nombre\)/);
      assert.match(inf, /✗ «Botox 3 zonas» · 1 cita: no casa\. Parecidos: «Toxina botulínica 3 zonas» \(toxina-3-zonas\) \d+ %/);
      assert.match(inf, /✗ «Rocío» · 1 cita: no casa/);
      assert.match(inf, /✗ «En espera» · 1 cita/);
      assert.match(inf, /«Box 3» · 1 cita: no casa, la agenda pone una de las del tratamiento/);
      assert.match(inf, /«Limpieza facial profunda»: 45 min en Flowww y 60 en la app · 1 cita/);
      assert.match(inf, /"Botox 3 zonas": "toxina-3-zonas",\n\s+"Pack novia": ""/, 'el mapa que falta, con lo más parecido');
      assert.doesNotMatch(inf, PERSONALES);
    });

    await t.test('--aplicar sin mapa no aplica: lo que no casa bloquea y no se escribe nada', async () => {
      const antes = await contar(pool);
      const r = await I.importar(pool, { ...ficheros, aplicar: true, ahora: AHORA });
      assert.equal(r.aplicado, false);
      assert.match(r.informe, /NO APLICADA: falta decidir algo/);
      assert.match(r.informe, /✗ 2 servicios de Flowww no casan con ningún tratamiento de la app\n\s+✗ 1 profesional de Flowww no casa con nadie de la app\n\s+✗ 1 estado de Flowww sin decidir si se trae/);
      assert.deepEqual(await contar(pool), antes);
    });

    await t.test('con el mapa se aplica todo en una transacción: pacientes, consentimientos explícitos y citas por el motor de agenda', async () => {
      const r = await I.importar(pool, { ...ficheros, mapa: MAPA, aplicar: true, ahora: AHORA });
      assert.equal(r.aplicado, true);
      assert.match(r.lote, /^flowww-2026-10-13-1000-[0-9a-f]{4}$/);
      lote = r.lote;
      assert.match(r.informe, /HECHO: 9 pacientes nuevos y 2 vinculados · 2 fichas completadas de quien ya estaba · 8 consentimientos registrados · 2 bajas comerciales apuntadas · 12 citas \(4 para revisar, con su tarea en el panel\) · 1 servicio del mapa guardado/);
      assert.match(r.informe, /Ojo: 1 fila de citas no se trae \(fila 18\): si es futura, hay que darla a mano en la app antes de apagar Flowww\./);
      assert.doesNotMatch(r.informe, PERSONALES);

      // Pacientes: sin duplicar, con su código de Flowww; a los que ya estaban se les completa lo que no tenían.
      const p = async (flowwwId) => (await pool.query('SELECT * FROM pacientes WHERE flowww_id = ?', [flowwwId]))[0][0];
      const carmen = await p('1001');
      assert.deepEqual([carmen.nombre, carmen.apellidos, carmen.telefono, carmen.email, carmen.origen], ['Carmen', 'Ruiz Soler', '+34611000401', 'carmen.ruiz@ejemplo.invalid', 'flowww']);
      assert.equal(carmen.fecha_nacimiento.toISOString().slice(0, 10), '1971-04-03');
      assert.equal(descifrar(carmen.notas_cifradas, carmen.notas_iv, carmen.notas_tag), 'Alérgica al látex; prefiere tardes', 'las observaciones, cifradas');
      assert.ok(!carmen.notas_cifradas.includes(Buffer.from('Alérgica al látex')), 'en la base no se leen');
      assert.deepEqual([(await p('1002')).telefono, (await p('1002')).notas_cifradas], [null, null]);
      const sergio = await p('1005');
      assert.equal(sergio.telefono, '+34611000501');
      assert.equal(descifrar(sergio.notas_cifradas, sergio.notas_iv, sergio.notas_tag), 'Paciente con\ndos líneas de nota y "comillas"');
      assert.deepEqual([(await p('1006')).telefono, (await p('1006')).email], [null, null]);
      assert.equal((await p('1007')).telefono, '+34611000701', 'del fijo y el móvil, el móvil');
      assert.equal(await p('1008'), undefined, 'el repetido no se crea');
      assert.equal(await p('1009'), undefined);
      const [[laura]] = await pool.query('SELECT * FROM pacientes WHERE id = ?', [app.laura]);
      assert.deepEqual([laura.flowww_id, laura.nombre, laura.apellidos, laura.fecha_nacimiento.toISOString().slice(0, 10)], ['1003', 'Laura', 'Gómez Ruiz', '1988-02-29'],
        'su código y lo que su ficha no tenía; su nombre, el suyo');
      const [[marta]] = await pool.query('SELECT * FROM pacientes WHERE id = ?', [app.marta]);
      assert.deepEqual([marta.flowww_id, marta.telefono, marta.apellidos], ['1004', '+34611000302', 'Vidal'], 'no tenía teléfono: el de Flowww, para sus recordatorios');
      const [[n]] = await pool.query("SELECT COUNT(*) AS n, SUM(es_cliente) AS clientes FROM pacientes WHERE origen = 'flowww'");
      assert.deepEqual([Number(n.n), Number(n.clientes)], [9, 0], 'nadie pasa a «cliente» (daría permiso comercial por la LSSI)');
      const sara = (await pool.query("SELECT * FROM pacientes WHERE telefono = '+34611000161'"))[0][0];
      assert.match(sara.flowww_id, /^p:[0-9a-f]{32}$/, 'la que solo sale en las citas: nueva, con una huella de sus datos');
      assert.equal((await p('1012')).nombre, 'Elena');

      // Consentimientos: solo lo que dice la columna; «no» es también una baja comercial.
      const [cons] = await pool.query(`SELECT p.flowww_id, c.tipo, c.estado, c.fuente, c.prueba FROM consentimientos c JOIN pacientes p ON p.id = c.paciente_id
                                        ORDER BY p.flowww_id, CAST(c.tipo AS CHAR)`);
      assert.deepEqual(cons.map((c) => [c.flowww_id, c.tipo, c.estado]), [
        ['1001', 'email_marketing', 'otorgado'], ['1001', 'whatsapp_marketing', 'otorgado'],
        ['1003', 'email_marketing', 'revocado'], ['1003', 'whatsapp_marketing', 'revocado'],
        ['1005', 'email_marketing', 'otorgado'], ['1005', 'whatsapp_marketing', 'otorgado'],
        ['1011', 'email_marketing', 'revocado'], ['1011', 'whatsapp_marketing', 'revocado'],
      ]);
      assert.ok(cons.every((c) => c.fuente === 'importacion'));
      assert.equal(cons[1].prueba, 'Flowww (cliente 1001), pacientes.csv fila 2: «Acepta publicidad» = «Sí»; sin fecha en Flowww; importado el 13/10/2026',
        'de dónde sale y que la fecha es la de la importación, no la del consentimiento');
      const permiso = async (pacienteId) => R.permisoComercial(pool, { paciente_id: pacienteId }, AHORA);
      assert.equal((await permiso(carmen.id)).ok, true, 'con su «sí», puede recibir mensajes comerciales');
      assert.match((await permiso((await p('1010')).id)).motivo, /sin consentimiento/, '«Pendiente» no es un sí');
      assert.match((await permiso((await p('1002')).id)).motivo, /sin consentimiento/, 'importar no da consentimiento');
      assert.match((await permiso(app.laura)).motivo, /baja/);
      assert.match((await permiso((await p('1011')).id)).motivo, /baja/);
      const [lista] = await pool.query('SELECT telefono, fuente FROM bajas_comerciales ORDER BY telefono');
      assert.deepEqual(lista.map((b) => ({ ...b })), [{ telefono: '+34611000121', fuente: 'flowww' }, { telefono: '+34611000301', fuente: 'flowww' }], 'y en la lista de bajas, como todas');

      // Citas: las futuras, por el motor de agenda; las que no caben, igual, para revisar y con tarea.
      const [citas] = await pool.query("SELECT * FROM citas WHERE origen = 'importacion' ORDER BY flowww_id");
      const cita = Object.fromEntries(citas.map((c) => [c.flowww_id, c]));
      assert.deepEqual(Object.keys(cita).sort(), ['C-1', 'C-12', 'C-14', 'C-15', 'C-17', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8']);
      assert.ok(citas.every((c) => c.estado === 'confirmada' && c.recordatorios === 1 && tieneEnlace(c) && c.creada_por === 'importacion-flowww'));
      assert.ok(citas.every((c) => c.aviso_confirmacion_en?.getTime() === AHORA.getTime()), 'la confirmación ya se la dio Flowww');
      assert.deepEqual([cita['C-1'].inicio.toISOString(), cita['C-1'].sala_id, cita['C-1'].profesional_id, cita['C-1'].paciente_id, cita['C-1'].revisar_motivo],
        ['2026-10-15T08:00:00.000Z', 1, 20, carmen.id, null]);
      assert.equal(cita['C-1'].notas, null, 'las observaciones de la cita, nunca en claro');
      assert.equal(descifrar(cita['C-1'].notas_cifradas, cita['C-1'].notas_iv, cita['C-1'].notas_tag), 'Trae su crema, 30 €');
      assert.ok(!cita['C-1'].notas_cifradas.includes(Buffer.from('crema')));
      assert.deepEqual([cita['C-2'].tratamiento_id, cita['C-2'].sala_id, cita['C-2'].profesional_id, cita['C-2'].paciente_id], ['toxina-tercio', 2, 10, app.laura]);
      assert.deepEqual([cita['C-6'].tratamiento_id, cita['C-6'].sala_id, cita['C-6'].revisar_motivo], ['presoterapia', 3, null], 'en la cabina de su tratamiento');
      assert.deepEqual([cita['C-12'].tratamiento_id, cita['C-12'].sala_id], ['toxina-3-zonas', 2], 'lo que dice el mapa');
      assert.deepEqual([cita['C-14'].profesional_id, cita['C-14'].paciente_id], [21, app.laura]);
      assert.equal(madrid(cita['C-15'].inicio), '2026-10-26 11:00');
      assert.equal(cita['C-15'].inicio.toISOString(), '2026-10-26T10:00:00.000Z', 'después del cambio de hora, UTC+1');
      assert.equal(cita['C-8'].paciente_id, carmen.id, 'el código repetido lleva a la misma paciente');
      assert.match(cita['C-3'].revisar_motivo, /^Cabina facial ocupada por otra cita de las 12:30/);
      assert.deepEqual([cita['C-3'].sala_id, cita['C-3'].profesional_id], [1, 21], 'no cabe: se queda donde la tenía Flowww');
      assert.match(cita['C-5'].revisar_motivo, /la fila 5 de las citas/);
      assert.equal(cita['C-7'].revisar_motivo, 'es festivo');
      assert.equal(cita['C-8'].revisar_motivo, 'cae fuera del horario de la clínica');
      const [[otra]] = await pool.query('SELECT estado, inicio FROM citas WHERE id = ?', [app.citaOtra]);
      assert.deepEqual([otra.estado, madrid(otra.inicio)], ['confirmada', '2026-10-15 12:30'], 'nada se pisa');
      const [tareas] = await pool.query("SELECT titulo, paciente_id, tipo, estado, vence_en FROM tareas WHERE titulo LIKE 'Cita importada de Flowww%' ORDER BY id");
      assert.equal(tareas.length, 4);
      assert.equal(tareas[0].titulo, `Cita importada de Flowww para revisar (15/10 13:00, Limpieza facial profunda): ${cita['C-3'].revisar_motivo}`);
      assert.deepEqual([tareas[0].paciente_id, tareas[0].tipo, tareas[0].estado], [cita['C-3'].paciente_id, 'otro', 'abierta']);
      assert.equal(tareas[0].vence_en.toISOString(), '2026-10-14T08:00:00.000Z', 'para mañana: antes de la cita');
      // Ocupan la agenda como cualquier otra cita.
      const libres = (await agenda.huecos(pool, { fecha: '2026-10-15', tratamientoId: 'limpieza-facial', ahora: AHORA })).map((h) => h.hora);
      for (const hora of ['10:00', '13:00', '16:00', '16:30']) assert.ok(!libres.includes(hora), hora);
      assert.ok(libres.includes('11:10'));

      const [[mapeo]] = await pool.query("SELECT tratamiento_id FROM mapeo_tratamientos WHERE clave = 'flowww:botox 3 zonas'");
      assert.equal(mapeo.tratamiento_id, 'toxina-3-zonas', 'lo del mapa queda guardado para la próxima vez');
      const [secuencias] = await pool.query('SELECT estado, motivo_fin FROM inscripciones WHERE id IN (?) ORDER BY id', [[app.inscripcion, app.inscripcionMarta, app.inscripcionLead]]);
      assert.deepEqual(secuencias.map((s) => ({ ...s })), Array(3).fill({ estado: 'terminada', motivo_fin: 'cita' }), 'con cita, se acaban sus secuencias (también la del lead con su teléfono)');
      const [eventos] = await pool.query("SELECT datos FROM eventos WHERE tipo = 'importacion_flowww' AND entidad_id = ?", [lote]);
      assert.equal(eventos.length, 1);
      // El lote guarda números de la app; lo que se completó en una ficha (datos de alguien), cifrado.
      const datosLote = parsear(eventos[0].datos);
      assert.deepEqual(datosLote.completados.map((c) => [c.id, c.campos]), [[app.laura, ['apellidos', 'fechaNacimiento']], [app.marta, ['telefono']]]);
      assert.ok(datosLote.completados.every((c) => c.cifrado && c.iv && c.tag));
      const enClaro = JSON.stringify({ ...datosLote, completados: datosLote.completados.map((c) => c.campos) });
      assert.doesNotMatch(enClaro, /\+34|611000|@|Ruiz|Gómez|Marta|1988/, 'el lote guarda números de la app, no datos de nadie');
    });

    await t.test('la segunda vez no duplica; en la exportación final, lo que en Flowww ya no es así se queda sin recordatorios y a revisar', async () => {
      const antes = await contar(pool);
      const r = await I.importar(pool, { ...ficheros, mapa: MAPA, aplicar: true, ahora: AHORA });
      assert.deepEqual([r.aplicado, r.lote], [true, null]);
      assert.match(r.informe, /APLICADA: no había nada nuevo que traer/);
      assert.match(r.informe, /9 ya importados antes \(mismo código de Flowww\): solo se completa lo que les falte/);
      assert.match(r.informe, /12 ya importadas antes: no se tocan/);
      assert.match(r.informe, /Marketing: 2 con un «no» que ya constaba en la app; 2 con «sí» que ya tenían uno en la app \(se respeta lo suyo\); 5 sin nada/);
      assert.deepEqual(await contar(pool), antes);

      // El mapa de la importación final: lo de los servicios del otro ya está guardado; lo que se
      // ignora, no (docs/MIGRAR-FLOWWW.md).
      const final = { pacientes: ficheros.pacientes, citas: exportacionFinal() };
      const mapaFinal = { tratamientos: { 'Pack novia': 'ignorar' } };
      const e = await I.importar(pool, { ...final, mapa: mapaFinal, ahora: AHORA });
      assert.deepEqual(e.plan.bloqueos, []);
      const id = async (codigo) => (await pool.query('SELECT id FROM citas WHERE flowww_id = ?', [codigo]))[0][0].id;
      assert.match(e.informe, /«Botox 3 zonas» → Toxina botulínica 3 zonas \(guardado en otra importación\)/);
      assert.match(e.informe, /2 importadas antes que en Flowww ya no son así: no se tocan solas; se quedan sin recordatorios y con una tarea para revisarlas:/);
      assert.match(e.informe, new RegExp(`cita ${await id('C-1')} de la app \\(Flowww C-1\\) · jue 15/10/2026 10:00 · Limpieza facial profunda: en Flowww es ahora el jue 15/10/2026 11:00 \\(fila 2\\)`));
      assert.match(e.informe, new RegExp(`cita ${await id('C-4')} de la app \\(Flowww C-4\\) · jue 15/10/2026 16:00 · Limpieza facial profunda: en Flowww está anulada \\(fila 5\\)`));
      assert.equal(e.plan.citas.find((x) => x.flowwwId === 'C-21').paciente.via, 'nombre');
      assert.match(e.informe, /1 es de un paciente que se ha reconocido solo por el nombre: compruébalo:\n\s+fila 21 · mié 28\/10\/2026 16:00 · Limpieza facial profunda → el paciente \d+ de la app/);
      assert.match(e.informe, /Listo para aplicar, pero ojo:\n\s+✗ 1 fila de citas no se trae \(fila 18\)[^\n]*\n\s+✗ 2 citas importadas antes se quedan sin recordatorios y con una tarea[^\n]*no lo apliques/);
      assert.doesNotMatch(e.informe, /Todo listo/);
      assert.doesNotMatch(e.informe, PERSONALES);

      const a = await I.importar(pool, { ...final, mapa: mapaFinal, aplicar: true, sinRecordatorios: true, ahora: AHORA });
      assert.equal(a.aplicado, true);
      assert.match(a.informe, /ni los recordatorios \(--sin-recordatorios\)/);
      assert.match(a.informe, /HECHO: 0 pacientes nuevos y 0 vinculados · 0 consentimientos registrados · 2 citas \(0 para revisar, con su tarea en el panel\) · 2 importadas antes se quedan sin recordatorios y a revisar\./);
      const [[c20]] = await pool.query("SELECT recordatorios, tratamiento_id FROM citas WHERE flowww_id = 'C-20'");
      assert.deepEqual([c20.recordatorios, c20.tratamiento_id], [0, 'toxina-3-zonas']);
      const [[c21]] = await pool.query("SELECT p.flowww_id FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE c.flowww_id = 'C-21'");
      assert.equal(c21.flowww_id, '1005', 'por el nombre, el Sergio que ya estaba');
      // Lo ya importado no se toca solo (en la app puede haber cambiado): C-1 sigue a las 10:00 y C-4
      // sigue en pie, pero sin recordatorios y con su tarea.
      const [retiradas] = await pool.query("SELECT flowww_id, inicio, estado, recordatorios, revisar_motivo FROM citas WHERE flowww_id IN ('C-1', 'C-4') ORDER BY flowww_id");
      assert.deepEqual(retiradas.map((c) => [c.flowww_id, madrid(c.inicio), c.estado, c.recordatorios]), [['C-1', '2026-10-15 10:00', 'confirmada', 0], ['C-4', '2026-10-15 16:00', 'confirmada', 0]]);
      assert.equal(retiradas[0].revisar_motivo, 'en Flowww es ahora el 15/10/2026 a las 11:00: moverla aquí o hablar con el paciente (sin recordatorios)');
      const [tareas] = await pool.query("SELECT titulo FROM tareas WHERE titulo LIKE 'Cita importada de Flowww%' ORDER BY id DESC LIMIT 2");
      assert.deepEqual(tareas.map((x) => x.titulo).sort(), [
        'Cita importada de Flowww para revisar (15/10 10:00, Limpieza facial profunda): en Flowww es ahora el 15/10/2026 a las 11:00: moverla aquí o hablar con el paciente (sin recordatorios)',
        'Cita importada de Flowww para revisar (15/10 16:00, Limpieza facial profunda): en Flowww está anulada: anularla aquí o hablar con el paciente (sin recordatorios)',
      ]);

      // Otra vez lo mismo: nada nuevo, y lo que ya estaba a revisar no se vuelve a avisar.
      const n = await contar(pool);
      const otra = await I.importar(pool, { ...final, mapa: mapaFinal, aplicar: true, ahora: AHORA });
      assert.equal(otra.lote, null);
      assert.match(otra.informe, /2 importadas antes ya estaban a revisar desde otra importación: no se vuelve a avisar/);
      assert.deepEqual(await contar(pool), n);
    });

    await t.test('avisos: sin confirmación, pero con víspera y 2 horas; sin recordatorios si se pidió o si está a revisar', async () => {
      const whatsapp = crearWhatsApp('simulado');
      const deps = { pool, ia: crearIa('simulado'), whatsapp };
      const [importadas] = await pool.query("SELECT id, flowww_id FROM citas WHERE origen = 'importacion'");
      const id = Object.fromEntries(importadas.map((c) => [c.flowww_id, c.id]));
      const suyos = (lista) => lista.filter((a) => importadas.some((c) => c.id === a.id));
      assert.deepEqual(suyos(await avisos.pendientes(pool, new Date('2026-10-13T08:05:00Z'))), [], 'ninguna confirmación: ya la tuvieron en Flowww');

      // La víspera sale aunque se importara hace nada (la cita la pidió en Flowww, hace tiempo); a las
      // que están a revisar (C-1 movida y C-4 anulada en Flowww), no.
      await pool.query('UPDATE citas SET creado_en = ? WHERE id = ?', [new Date('2026-10-14T07:30:00Z'), id['C-2']]);
      const vispera = suyos(await avisos.pendientes(pool, new Date('2026-10-14T08:05:00Z')));
      assert.ok(vispera.some((a) => a.id === id['C-2'] && a.tipo === 'vispera'));
      assert.ok(vispera.every((a) => a.tipo === 'vispera'));
      assert.ok(!vispera.some((a) => [id['C-1'], id['C-4']].includes(a.id)), 'ni un «te esperamos mañana» de una cita que en Flowww ya no es así');
      await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-14T08:05:00Z') });
      const aLaura = whatsapp.enviados.find((m) => m.telefono === '+34611000301');
      assert.deepEqual([aLaura.nombre, aLaura.variables[0]], ['iemec_recordatorio_24h', 'Laura']);
      assert.ok(aLaura.variables.includes('10:00'), 'con la hora de su cita');
      assert.ok(!whatsapp.enviados.some((m) => m.telefono === '+34611000401'), 'Carmen (C-1, a revisar): nada');

      const dos = suyos(await avisos.pendientes(pool, new Date('2026-10-15T07:05:00Z')));
      assert.ok(dos.some((a) => a.id === id['C-2'] && a.tipo === 'dos_horas'));
      assert.ok(!dos.some((a) => a.id === id['C-1']));

      // C-20 se importó con --sin-recordatorios: el lunes 26 (ya en horario de invierno), nada. Al
      // ponérselos a todas, las que están a revisar siguen sin ellos hasta que recepción las mire.
      const lunes = new Date('2026-10-26T09:05:00Z');
      assert.ok(!(await avisos.pendientes(pool, lunes)).some((a) => a.id === id['C-20']));
      const ensayo = await I.cambiarRecordatorios(pool, { activar: true, ahora: AHORA });
      assert.deepEqual([ensayo.citas, ensayo.aplicado], [2, false]);
      assert.match(ensayo.informe, /^Ensayo: 2 citas futuras importadas de Flowww pasarían a tener recordatorios de víspera y 2 horas\. Otras 2 siguen sin ellos porque están a revisar/);
      const hecho = await I.cambiarRecordatorios(pool, { activar: true, aplicar: true, ahora: AHORA });
      assert.deepEqual([hecho.citas, hecho.aplicado], [2, true]);
      assert.ok((await avisos.pendientes(pool, lunes)).some((a) => a.id === id['C-20'] && a.tipo === 'vispera'));
      const recordatorios = async (codigo) => (await pool.query('SELECT recordatorios FROM citas WHERE flowww_id = ?', [codigo]))[0][0].recordatorios;
      assert.deepEqual([await recordatorios('C-1'), await recordatorios('C-4')], [0, 0]);
      // Recepción habla con Carmen: C-1 sigue en pie a su hora. Sus recordatorios, de uno en uno.
      const suya = await I.cambiarRecordatorios(pool, { activar: true, cita: id['C-1'], aplicar: true, ahora: AHORA });
      assert.equal(suya.informe, `Hecho: la cita ${id['C-1']} ya tiene recordatorios de víspera y 2 horas.`);
      assert.deepEqual([await recordatorios('C-1'), await recordatorios('C-4')], [1, 0]);
    });

    await t.test('deshacer quita lo importado que nadie ha tocado; lo tocado, lo ya avisado y las oposiciones se quedan', async () => {
      const antes = await contar(pool);
      const ensayo = await I.deshacer(pool, { ahora: AHORA });
      assert.match(ensayo.informe, /ENSAYO: no se ha cambiado nada/);
      assert.deepEqual([ensayo.citasQuitadas, ensayo.retiradas, ensayo.tareas], [2, 1, 1],
        'la última importación: se quitan C-20 y C-21, y C-4 recupera sus recordatorios (C-1 ya los tiene: lo decidió recepción)');
      assert.deepEqual(await contar(pool), antes);
      await I.deshacer(pool, { aplicar: true, ahora: AHORA });
      assert.equal((await pool.query("SELECT id FROM citas WHERE flowww_id IN ('C-20', 'C-21')"))[0].length, 0);
      const [[c4]] = await pool.query("SELECT recordatorios, revisar_motivo FROM citas WHERE flowww_id = 'C-4'");
      assert.deepEqual({ ...c4 }, { recordatorios: 1, revisar_motivo: null });
      const [[c1]] = await pool.query("SELECT recordatorios, revisar_motivo FROM citas WHERE flowww_id = 'C-1'");
      assert.deepEqual([c1.recordatorios, Boolean(c1.revisar_motivo)], [1, true], 'la que ya revisó recepción, como la dejó');

      // Del primer lote, recepción ya ha anulado dos, y a las del jueves que tenían recordatorios ya les
      // salió la víspera: esas se quedan (con su tarea, si tenían), y sus pacientes también. Quien ya ha
      // recibido un aviso tiene su conversación en la app: tampoco se borra.
      await pool.query("UPDATE citas SET estado = 'cancelada' WHERE flowww_id IN ('C-4', 'C-6')");
      const [conConversacion] = await pool.query("SELECT DISTINCT p.flowww_id FROM conversaciones c JOIN pacientes p ON p.id = c.paciente_id WHERE p.origen = 'flowww' ORDER BY p.flowww_id");
      assert.deepEqual(conConversacion.map((x) => x.flowww_id), ['1010'], 'la víspera de Pablo (la de Carmen y la de Sergio no salieron: están a revisar)');
      const d = await I.deshacer(pool, { lote, aplicar: true, ahora: AHORA });
      assert.equal(d.citasQuitadas, 7);
      assert.deepEqual(d.citasQuedan.map((c) => c.estado).sort(), ['avisada', 'avisada', 'avisada', 'cancelada', 'cancelada']);
      assert.equal(d.pacientesQuitados, 6);
      assert.deepEqual([d.vinculados, d.completados, d.consentimientos, d.oposiciones, d.bajas, d.tareas, d.mapeos, d.secuencias], [2, 2, 4, 4, 2, 3, 1, 1]);
      assert.match(d.informe, /Citas: 7 se quitan; 5 se quedan porque ya han cambiado o ya se avisó al paciente \(cita \d+: avisada, /);
      assert.match(d.informe, /Pacientes nuevos: 6 se quitan; 3 se quedan porque ya tienen otras cosas en la app/);
      assert.match(d.informe, /Consentimientos: 4 «sí» se quitan; los «no» \(4\) y las bajas comerciales \(2\) se quedan: una oposición no se olvida al deshacer/);
      const [quedan] = await pool.query("SELECT flowww_id FROM pacientes WHERE origen = 'flowww' ORDER BY flowww_id");
      assert.deepEqual(quedan.map((x) => x.flowww_id), ['1002', '1005', '1010']);
      const [[revisar]] = await pool.query("SELECT COUNT(*) AS n FROM tareas WHERE titulo LIKE 'Cita importada de Flowww%' AND estado = 'abierta'");
      assert.equal(revisar.n, 2, 'las tareas de las que se quedan (C-3 y C-5), también; la de C-1, que puso la otra importación, se va con su cita');
      const [[marta]] = await pool.query('SELECT flowww_id, telefono FROM pacientes WHERE id = ?', [app.marta]);
      assert.deepEqual({ ...marta }, { flowww_id: null, telefono: null }, 'como estaba');
      const [[laura]] = await pool.query('SELECT flowww_id, apellidos, fecha_nacimiento, baja_comercial_en FROM pacientes WHERE id = ?', [app.laura]);
      assert.deepEqual([laura.flowww_id, laura.apellidos, laura.fecha_nacimiento], [null, null, null], 'lo que se completó en su ficha, fuera');
      assert.ok(laura.baja_comercial_en, 'pero su «no» a la publicidad se queda');
      const [[permisoLaura]] = [[await R.permisoComercial(pool, { paciente_id: app.laura }, AHORA)]];
      assert.match(permisoLaura.motivo, /baja/);
      const [lista] = await pool.query('SELECT telefono, paciente_id FROM bajas_comerciales ORDER BY telefono');
      assert.deepEqual(lista.map((b) => [b.telefono, b.paciente_id]), [['+34611000121', null], ['+34611000301', app.laura]],
        'la lista de bajas se queda entera; la de Nuria, que se ha quitado, sin su número de paciente');
      const [cons] = await pool.query('SELECT paciente_id, estado FROM consentimientos ORDER BY id');
      assert.deepEqual(cons.map((c) => [c.paciente_id, c.estado]), [[app.laura, 'revocado'], [app.laura, 'revocado']]);
      // Las secuencias: vuelve la del lead de Julia (ya no tiene cita); la de Laura no (le queda la del
      // jueves, ya avisada) y la de Marta tampoco (le queda una importada, aunque anulada).
      const [secuencias] = await pool.query('SELECT id, estado FROM inscripciones WHERE id IN (?)', [[app.inscripcion, app.inscripcionMarta, app.inscripcionLead]]);
      const estado = Object.fromEntries(secuencias.map((s) => [s.id, s.estado]));
      assert.deepEqual([estado[app.inscripcionLead], estado[app.inscripcion], estado[app.inscripcionMarta]], ['activa', 'terminada', 'terminada']);
      assert.equal((await contar(pool)).mapeos, 0);
      const [[otra]] = await pool.query('SELECT estado FROM citas WHERE id = ?', [app.citaOtra]);
      assert.equal(otra.estado, 'confirmada');
      await assert.rejects(I.deshacer(pool, { lote, aplicar: true, ahora: AHORA }), /ya se deshizo/);
      await assert.rejects(I.deshacer(pool, { ahora: AHORA }), /No hay ninguna importación de Flowww que deshacer/);
    });
  } finally {
    await pool.end();
  }
});

// Lo ya importado que no sale en la exportación final (anulada y no exportada, o borrada en Flowww): no
// se toca solo, pero se queda sin recordatorios y con su tarea. Lo que va después de la última fecha del
// fichero no se puede saber. Repetir no duplica la tarea, y deshacer le devuelve los recordatorios.
test('una cita importada que ya no sale en la exportación final se queda sin recordatorios y a revisar', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const cab = 'Nº cita;Cód. cliente;Cliente;Móvil;Fecha;Hora;Servicio;Empleado;Cabina;Estado';
    const k1 = 'K-1;7001;Sanz, Olga;611000801;15/10/2026;10:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada';
    const k2 = 'K-2;7001;Sanz, Olga;611000801;15/10/2026;17:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada';
    const k3 = 'K-3;7001;Sanz, Olga;611000801;19/11/2026;12:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada';
    assert.equal((await I.importar(pool, { citas: csv('citas.csv', [cab, k1, k2, k3].join('\n')), aplicar: true, ahora: AHORA })).aplicado, true);
    const id = async (codigo) => (await pool.query('SELECT id FROM citas WHERE flowww_id = ?', [codigo]))[0][0].id;

    // Olga anula K-2 en Flowww y la exportación final ya no la trae. Su última cita es del 15/10: de K-3
    // (19/11) no se puede decir nada.
    const final = csv('citas.csv', [cab, k1].join('\n'));
    const e = await I.importar(pool, { citas: final, ahora: AHORA });
    assert.match(e.informe, new RegExp(`cita ${await id('K-2')} de la app \\(Flowww K-2\\) · jue 15/10/2026 17:00 · Limpieza facial profunda: ya no sale en la exportación de Flowww`));
    assert.match(e.informe, /1 importada antes es de después de la última fecha de este fichero \(15\/10\/2026\): no se puede comprobar/);
    assert.match(e.informe, /Listo para aplicar, pero ojo:\n\s+✗ 1 cita importada antes se queda sin recordatorios/);
    const a = await I.importar(pool, { citas: final, aplicar: true, ahora: AHORA });
    assert.match(a.informe, /HECHO: .* · 1 importada antes se queda sin recordatorios y a revisar\./);
    const [[k]] = await pool.query("SELECT estado, recordatorios, revisar_motivo FROM citas WHERE flowww_id = 'K-2'");
    assert.deepEqual({ ...k }, { estado: 'confirmada', recordatorios: 0, revisar_motivo: 'ya no está en la exportación de Flowww (¿anulada o borrada?): comprobarlo con el paciente (sin recordatorios)' });
    const [[tarea]] = await pool.query('SELECT titulo, estado FROM tareas');
    assert.deepEqual({ ...tarea }, {
      titulo: 'Cita importada de Flowww para revisar (15/10 17:00, Limpieza facial profunda): ya no está en la exportación de Flowww (¿anulada o borrada?): comprobarlo con el paciente (sin recordatorios)'.slice(0, 200),
      estado: 'abierta',
    });
    const suyas = [await id('K-1'), await id('K-2')];
    const vispera = (await avisos.pendientes(pool, new Date('2026-10-14T08:05:00Z'))).filter((x) => suyas.includes(x.id));
    assert.deepEqual(vispera, [{ id: await id('K-1'), tipo: 'vispera' }], 'a Olga no le llega «te esperamos mañana» de la que anuló');
    assert.equal((await pool.query("SELECT recordatorios FROM citas WHERE flowww_id = 'K-3'"))[0][0].recordatorios, 1);

    // Otra vez lo mismo: ni otra tarea ni otro lote.
    assert.equal((await I.importar(pool, { citas: final, aplicar: true, ahora: AHORA })).lote, null);
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM tareas'))[0][0].n, 1);
    // Si luego vuelve a salir tal cual (a aquella exportación le faltaba), no se toca sola: se dice.
    const completa = await I.importar(pool, { citas: csv('citas.csv', [cab, k1, k2, k3].join('\n')), ahora: AHORA });
    assert.match(completa.informe, new RegExp(`1 importada antes que estaba a revisar vuelve a salir igual en Flowww: sigue sin recordatorios; si sigue en pie, --recordatorios si --cita <número> \\(o deshacer la importación que la retiró\\):\n\\s+cita ${await id('K-2')} de la app · jue 15/10/2026 17:00 · Limpieza facial profunda \\(fila 3\\)`));

    // Si el fichero no era el bueno (le faltaban citas), deshacer le devuelve los recordatorios.
    const d = await I.deshacer(pool, { aplicar: true, ahora: AHORA });
    assert.deepEqual([d.retiradas, d.tareas], [1, 1]);
    assert.match(d.informe, /Importadas antes que dejó sin recordatorios: 1 los recupera/);
    const [[devuelta]] = await pool.query("SELECT recordatorios, revisar_motivo FROM citas WHERE flowww_id = 'K-2'");
    assert.deepEqual({ ...devuelta }, { recordatorios: 1, revisar_motivo: null });
  } finally {
    await pool.end();
  }
});

// Una cita que Flowww mueve sin cambiarle el código, y que exporta también en su versión anulada (la
// de antes de moverla): es la misma, cambiada de día, no una nueva ni una repetida.
test('una cita movida en Flowww con el mismo código (y la anulada de antes en el fichero) es la misma, cambiada', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const cab = 'Nº cita;Cód. cliente;Cliente;Fecha;Hora;Servicio;Empleado;Cabina;Estado';
    const antes = 'P-1;7101;Pinto, Rosa;22/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada';
    await I.importar(pool, { citas: csv('citas.csv', [cab, antes].join('\n')), aplicar: true, ahora: AHORA });
    const movida = csv('citas.csv', [cab,
      'P-1;7101;Pinto, Rosa;22/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Anulada',
      'P-1;7101;Pinto, Rosa;29/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada'].join('\n'));
    const r = await I.importar(pool, { citas: movida, aplicar: true, ahora: AHORA });
    assert.match(r.informe, /1 anulada: no se trae/);
    assert.match(r.informe, /en Flowww es ahora el jue 29\/10\/2026 11:00 \(fila 3\)/);
    assert.doesNotMatch(r.informe, /repetida/);
    const [citas] = await pool.query("SELECT flowww_id, recordatorios, revisar_motivo FROM citas WHERE origen = 'importacion'");
    assert.deepEqual(citas.map((c) => [c.flowww_id, c.recordatorios]), [['P-1', 0]], 'ni otra cita ni la de antes callada');
    assert.match(citas[0].revisar_motivo, /^en Flowww es ahora el 29\/10\/2026 a las 11:00/);
  } finally {
    await pool.end();
  }
});

// Un «no» a la publicidad gana siempre: aunque una importación anterior registrara un «sí», aunque la
// misma persona salga dos veces y el «no» esté en la fila repetida. Un «sí» no pasa por encima de la
// baja comercial (la de la ficha o la de la lista por teléfono). Y deshacer no olvida una oposición.
test('marketing: el «no» gana siempre, el «sí» no pasa por encima de una baja y deshacer no olvida una oposición', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const cab = 'Código;Nombre;Apellidos;Móvil;Acepta publicidad;Fecha consentimiento';
    const idDe = async (flowwwId) => (await pool.query('SELECT id FROM pacientes WHERE flowww_id = ?', [flowwwId]))[0][0].id;
    const permiso = async (flowwwId) => R.permisoComercial(pool, { paciente_id: await idDe(flowwwId) }, AHORA);
    const estados = async (flowwwId) => (await pool.query(
      'SELECT c.tipo, c.estado FROM consentimientos c JOIN pacientes p ON p.id = c.paciente_id WHERE p.flowww_id = ? ORDER BY c.id', [flowwwId]))[0].map((c) => `${c.tipo}=${c.estado}`);

    // Importación de prueba: Carmen dice «Sí» (desde 2024, dice Flowww).
    await I.importar(pool, { pacientes: csv('clientes.csv', `${cab}\n8001;Carmen;Soler;611000811;Sí;03/04/2024\n`), aplicar: true, ahora: AHORA });
    assert.equal((await permiso('8001')).ok, true);
    const [[prueba]] = await pool.query('SELECT prueba FROM consentimientos ORDER BY id LIMIT 1');
    assert.equal(prueba.prueba, 'Flowww (cliente 8001), clientes.csv fila 2: «Acepta publicidad» = «Sí»; en Flowww desde el 03/04/2024; importado el 13/10/2026');
    // Días después pide en recepción (aún con Flowww) que no le manden publicidad: la final trae «No».
    const r = await I.importar(pool, { pacientes: csv('clientes.csv', `${cab}\n8001;Carmen;Soler;611000811;No;\n`), aplicar: true, ahora: AHORA });
    assert.match(r.informe, /Marketing: 1 con «no» \(se registra que no y, si es a WhatsApp, la baja comercial; 1 tenía un «sí» en la app: gana el «no»\)/);
    assert.deepEqual(await estados('8001'), ['whatsapp_marketing=otorgado', 'email_marketing=otorgado', 'whatsapp_marketing=revocado', 'email_marketing=revocado']);
    assert.match((await permiso('8001')).motivo, /baja/);
    const [[carmen]] = await pool.query("SELECT baja_comercial_en FROM pacientes WHERE flowww_id = '8001'");
    assert.ok(carmen.baja_comercial_en);
    // Una vez más: ya consta, no se repite.
    const otra = await I.importar(pool, { pacientes: csv('clientes.csv', `${cab}\n8001;Carmen;Soler;611000811;No;\n`), aplicar: true, ahora: AHORA });
    assert.equal(otra.lote, null);
    assert.match(otra.informe, /1 con un «no» que ya constaba en la app/);

    // La misma persona dos veces en el fichero (mismo móvil): «Sí» en una fila y «No» en la otra.
    const r2 = await I.importar(pool, { pacientes: csv('clientes.csv', `${cab}\n3001;Rosa;Pinto;611000821;Sí;\n3002;Rosa;Pinto;611000821;No;\n`), aplicar: true, ahora: AHORA });
    assert.match(r2.informe, /1 con «no» \(se registra que no y, si es a WhatsApp, la baja comercial\); 1 con «sí» y «no» en filas distintas \(gana el «no»\)/);
    assert.deepEqual(await estados('3001'), ['whatsapp_marketing=revocado', 'email_marketing=revocado']);
    const [[deRosa]] = await pool.query("SELECT c.prueba FROM consentimientos c JOIN pacientes p ON p.id = c.paciente_id WHERE p.flowww_id = '3001' LIMIT 1");
    assert.match(deRosa.prueba, /^Flowww \(cliente 3002\), clientes\.csv fila 3: «Acepta publicidad» = «No»/, 'la prueba, la de la fila que dice que no');
    assert.match((await permiso('3001')).motivo, /baja/);

    // Su teléfono ya estaba en la lista de bajas (escribió BAJA siendo lead, antes de tener ficha): el
    // «sí» de Flowww no se registra y la baja pasa a su ficha. A quien no trae columna, también.
    await pool.query("INSERT INTO bajas_comerciales (telefono, fuente) VALUES ('+34611000831', 'whatsapp'), ('+34611000832', 'meta_131050')");
    const r3 = await I.importar(pool, { pacientes: csv('clientes.csv', `${cab}\n4001;Lola;Mena;611000831;Sí;\n4002;Eva;Mena;611000832;;\n`), aplicar: true, ahora: AHORA });
    assert.match(r3.informe, /1 con «sí» y la baja comercial en la app \(no se registra: gana la baja\)/);
    assert.match(r3.informe, /2 tienen el teléfono en la lista de bajas comerciales: se les apunta también en la ficha/);
    assert.deepEqual(await estados('4001'), []);
    for (const f of ['4001', '4002']) assert.match((await permiso(f)).motivo, /baja/, f);

    // Deshacer no olvida una oposición: los «no» y las bajas se quedan; los «sí», no.
    await I.deshacer(pool, { aplicar: true, ahora: AHORA }); // la de Lola y Eva
    await I.deshacer(pool, { aplicar: true, ahora: AHORA }); // la de Rosa
    const dNo = await I.deshacer(pool, { aplicar: true, ahora: AHORA }); // la del «no» de Carmen
    assert.match(dNo.informe, /Consentimientos: 0 «sí» se quitan; los «no» \(2\) y las bajas comerciales \(1\) se quedan/);
    const dSi = await I.deshacer(pool, { aplicar: true, ahora: AHORA }); // la del «sí»
    assert.deepEqual([dSi.consentimientos, dSi.pacientesQuedan.length], [2, 1], 'su «sí» se quita; ella se queda (tiene su «no»)');
    assert.deepEqual(await estados('8001'), ['whatsapp_marketing=revocado', 'email_marketing=revocado']);
    assert.match((await permiso('8001')).motivo, /baja/);
    const [lista] = await pool.query('SELECT telefono, paciente_id IS NULL AS sinFicha FROM bajas_comerciales ORDER BY telefono');
    assert.deepEqual(lista.map((b) => [b.telefono, Boolean(b.sinFicha)]), [['+34611000811', false], ['+34611000821', true], ['+34611000831', true], ['+34611000832', true]],
      'Rosa se ha quitado, pero su teléfono sigue en la lista de bajas');
  } finally {
    await pool.end();
  }
});

// El código de la cita en varias filas: una visita con dos servicios (dos citas), la misma cita dos
// veces (una) o una visita que se trajo con un servicio y ahora trae dos (la de antes es la misma).
test('una visita con dos servicios bajo el mismo código: una cita por servicio, también si antes traía uno', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const cab = 'Nº cita;Cód. cliente;Cliente;Fecha;Hora;Servicio;Empleado;Cabina;Estado';
    const n1 = 'N-1;9002;Sanz, Olga;23/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada';
    await I.importar(pool, { citas: csv('citas.csv', [cab, n1].join('\n')), aplicar: true, ahora: AHORA });
    const filas = [cab,
      'M-1;9001;Pinto, Rosa;22/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
      'M-1;9001;Pinto, Rosa;22/10/2026;12:10;Presoterapia;Estética Uno;Cabina corporal;Confirmada',
      'M-1;9001;Pinto, Rosa;22/10/2026;12:10;Presoterapia;Estética Uno;Cabina corporal;Confirmada',
      n1, 'N-1;9002;Sanz, Olga;23/10/2026;12:10;Presoterapia;Estética Uno;Cabina corporal;Confirmada'];
    const r = await I.importar(pool, { citas: csv('citas.csv', filas.join('\n')), aplicar: true, ahora: AHORA });
    assert.match(r.informe, /1 fila repetida \(la misma cita dos veces\): 4/);
    assert.match(r.informe, /2 citas de Flowww con varios servicios \(el mismo código en varias filas\): se trae una por servicio: «M-1» \(filas 2, 3, 4\); «N-1» \(filas 5, 6\)/);
    assert.match(r.informe, /1 ya importada antes: no se toca/, 'la limpieza de N-1, que se trajo cuando era de un servicio');
    assert.doesNotMatch(r.informe, /ya no son? así/);
    const [citas] = await pool.query("SELECT flowww_id, tratamiento_id FROM citas WHERE origen = 'importacion' ORDER BY flowww_id");
    assert.deepEqual(citas.map((c) => [c.flowww_id, c.tratamiento_id]), [
      ['M-1#limpieza facial profunda', 'limpieza-facial'], ['M-1#presoterapia', 'presoterapia'], ['N-1', 'limpieza-facial'], ['N-1#presoterapia', 'presoterapia'],
    ]);
    assert.equal((await I.importar(pool, { citas: csv('citas.csv', filas.join('\n')), aplicar: true, ahora: AHORA })).lote, null, 'otra vez: ya están todas');
  } finally {
    await pool.end();
  }
});

// Un «Código» a secas, sin columna del cliente, puede ser el del cliente: si se tomara por el de la
// cita, de sus tres citas se traería una y las otras parecerían la misma movida. No se usa hasta que
// lo diga el mapa, y un código de cita que sale en citas vivas de otros días no deja aplicar.
test('un código genérico que puede ser el del cliente no se toma por el de la cita', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const porCliente = csv('citas.csv', ['Código;Cliente;Fecha;Hora;Servicio;Empleado;Cabina;Estado',
      '1001;Ruiz, Carmen;22/10/2026;16:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
      '1001;Ruiz, Carmen;05/11/2026;16:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
      '1001;Ruiz, Carmen;19/11/2026;16:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada'].join('\n'));
    const r = await I.importar(pool, { citas: porCliente, aplicar: true, ahora: AHORA });
    assert.equal(r.aplicado, false);
    assert.match(r.informe, /La columna «Código» puede ser el código de la cita o el del cliente: no se usa hasta que lo diga el mapa/);
    assert.match(r.informe, /✗ La columna «Código» de las citas puede ser el código de la cita o el del cliente: dilo en el mapa \("citas": \{ "id": "Código" \} si es el de la cita; "citas": \{ "paciente_id": "Código", "id": null \} si es el del cliente\)/);
    assert.match(r.informe, /3 futuras que se traen/, 'el ensayo lo cuenta como sin código');

    // Si el mapa la da por el código de la cita, sale en citas vivas de tres días: no es de una cita.
    const mal = await I.importar(pool, { citas: porCliente, mapa: { citas: { id: 'Código' } }, aplicar: true, ahora: AHORA });
    assert.equal(mal.aplicado, false);
    assert.match(mal.informe, /1 código de cita sale en citas vivas de días o pacientes distintos: no es de una cita \(al final\):\n\s+«1001»: filas 2, 3, 4/);
    assert.match(mal.informe, /✗ Un código de cita sale en citas vivas de días o pacientes distintos: la columna «Código» no es el código de la cita \(¿es el del cliente\?\)/);
    assert.equal((await pool.query("SELECT COUNT(*) AS n FROM citas WHERE origen = 'importacion'"))[0][0].n, 0);

    // Con el mapa bien: las tres citas, de la misma paciente.
    const bien = await I.importar(pool, { citas: porCliente, mapa: { citas: { paciente_id: 'Código', id: null } }, aplicar: true, ahora: AHORA });
    assert.equal(bien.aplicado, true);
    const [citas] = await pool.query("SELECT c.inicio, p.flowww_id FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE c.origen = 'importacion' ORDER BY c.inicio");
    assert.deepEqual(citas.map((c) => [madrid(c.inicio), c.flowww_id]), [['2026-10-22 16:00', '1001'], ['2026-11-05 16:00', '1001'], ['2026-11-19 16:00', '1001']]);

    // Con una columna para el cliente, un «Código» genérico es el de la cita.
    const conCliente = F.resolverColumnas(['Código', 'Cód. cliente', 'Cliente', 'Fecha', 'Servicio'], 'citas');
    assert.deepEqual([conCliente.campos.id, conCliente.dudosas], [['Código'], []]);
  } finally {
    await pool.end();
  }
});

// Si una cita trae un código de cliente que no está ni en el fichero de pacientes ni en la app, no es
// nadie que tenga otro código de Flowww, aunque se llame igual: se da de alta con su código (la
// víspera y «Tu cita» no le llegan a otra persona). Lo que se reconoce solo por el nombre, el informe
// lo dice para que alguien lo mire; y si con ese nombre ya hay dos, no se sabe de quién es.
test('una cita con un código de cliente desconocido no se casa por el nombre con otra persona', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const ficheros = {
      pacientes: csv('clientes.csv', 'Código;Nombre;Apellidos;Móvil\n1003;Laura;Gómez Ruiz;611000351\n1004;Rosa;Pinto;611000352\n'),
      citas: csv('citas.csv', ['Nº cita;Cód. cliente;Cliente;Fecha;Hora;Servicio;Empleado;Cabina;Estado',
        'N-1;2002;Gómez Ruiz, Laura;22/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
        'N-2;;Pinto, Rosa;23/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
        'N-3;;Gómez Ruiz, Laura;23/10/2026;13:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada'].join('\n')),
    };
    const e = await I.importar(pool, { ...ficheros, ahora: AHORA });
    assert.match(e.informe, /1 es de un paciente que se ha reconocido solo por el nombre: compruébalo:\n\s+fila 3 · vie 23\/10\/2026 11:00 · Limpieza facial profunda → el de la fila 3 de pacientes/);
    const r = await I.importar(pool, { ...ficheros, aplicar: true, ahora: AHORA });
    assert.equal(r.aplicado, true);
    const [citas] = await pool.query("SELECT c.flowww_id AS cita, p.flowww_id AS paciente, p.telefono FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE c.origen = 'importacion' ORDER BY c.flowww_id");
    assert.deepEqual(citas.map((c) => ({ ...c })), [
      { cita: 'N-1', paciente: '2002', telefono: null },
      { cita: 'N-2', paciente: '1004', telefono: '+34611000352' },
    ], 'la otra Laura, con su código; la cita sin código de cliente, por el nombre');
    assert.match(r.informe, /1 paciente nuevo que solo sale en las citas[^\n]*: fila 2/);
    const [[rosa]] = await pool.query("SELECT id FROM pacientes WHERE flowww_id = '1004'");
    assert.match(r.informe, new RegExp(`fila 3 · vie 23/10/2026 11:00 · Limpieza facial profunda → el paciente ${rosa.id} de la app`), 'aplicada, con su número en la app');
    assert.match(r.informe, /fila 4: hay varios pacientes con ese nombre/, 'ahora hay dos Lauras: esa no se sabe de cuál es');
  } finally {
    await pool.end();
  }
});

// Lo que el informe no puede callar: citas que se quedan fuera (el final no dice «Todo listo»), una
// exportación sin columna de estado (no se sabe qué está anulado) y el paciente que solo sale en una
// cita con el teléfono de otra persona (entra sin él). Y lo que no parece una fecha no se repite: puede
// ser un nombre.
test('el informe dice lo que se queda fuera: citas sin traer, sin columna de estado, sin teléfono', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const app = await sembrar(pool);
    await pool.query("INSERT INTO pacientes (nombre, apellidos, telefono, flowww_id) VALUES ('María', 'García López', '+34611000901', '5001'), ('María', 'García López', '+34611000902', '5002')");
    const fuera = await I.importar(pool, {
      citas: csv('citas.csv', ['Cliente;Fecha;Hora;Servicio;Estado', 'García López, María;22/10/2026;11:00;Limpieza facial profunda;Confirmada',
        'Pinto, Rosa;22/10/2026;25:00;Limpieza facial profunda;Confirmada'].join('\n')),
      ahora: AHORA,
    });
    assert.match(fuera.informe, /→ 2 no se traen:\n\s+fila 2: hay varios pacientes con ese nombre\n\s+fila 3: hora «25:00» no válida/);
    assert.match(fuera.informe, /Listo para aplicar, pero ojo:\n\s+✗ 2 filas de citas no se traen \(filas 2, 3\): si son futuras, hay que darlas a mano en la app antes de apagar Flowww\./);
    assert.doesNotMatch(fuera.informe, /Todo listo/);

    // «Anulada: Sí/No» en vez de «Estado»: sin decir qué es, no se aplica (S-2 entraría como viva).
    const anulada = csv('citas.csv', ['Nº cita;Cliente;Fecha;Hora;Servicio;Anulada', 'S-1;Pinto, Rosa;22/10/2026;11:00;Limpieza facial profunda;No',
      'S-2;Sanz, Olga;22/10/2026;13:00;Limpieza facial profunda;Sí'].join('\n'));
    const sin = await I.importar(pool, { citas: anulada, aplicar: true, ahora: AHORA });
    assert.equal(sin.aplicado, false);
    assert.match(sin.informe, /Sin columna de estado: no se sabe qué citas están anuladas en Flowww/);
    assert.match(sin.informe, /✗ Las citas no traen columna de estado, así que no se sabe cuáles están anuladas\. Si la exportación solo trae citas vivas, dilo en el mapa \("citas": \{ "estado": null \}\)/);
    const conEstado = await I.importar(pool, { citas: anulada, mapa: { citas: { estado: 'Anulada' }, estados: { Sí: 'ignorar', No: 'importar' } }, aplicar: true, ahora: AHORA });
    assert.equal(conEstado.aplicado, true);
    assert.deepEqual((await pool.query('SELECT flowww_id FROM citas WHERE origen = ?', ['importacion']))[0].map((c) => c.flowww_id), ['S-1']);
    assert.equal((await I.importar(pool, { citas: anulada, mapa: { citas: { estado: null } }, ahora: AHORA })).plan.bloqueos.length, 0, 'si solo trae vivas, basta con decirlo');

    // Sara solo sale en una cita, con el móvil de Laura (paciente de WhatsApp): entra sin teléfono, y
    // el informe lo dice (sin él no le llegan los recordatorios).
    const h1 = await I.importar(pool, {
      citas: csv('citas.csv', ['Nº cita;Cliente;Móvil;Fecha;Hora;Servicio;Estado', 'H-1;Nieto, Sara;611000301;22/10/2026;11:00;Limpieza facial profunda;Confirmada',
        'S-1;Pinto, Rosa;;22/10/2026;11:00;Limpieza facial profunda;Confirmada'].join('\n')),
      ahora: AHORA,
    });
    assert.match(h1.informe, new RegExp(`1 trae el teléfono de otra persona \\(otro nombre\\): entra sin él:\n\\s+fila 2 de las citas: el teléfono ya es del paciente ${app.laura} de la app`));
    assert.match(h1.informe, /1 se queda sin teléfono y no le llegarán los recordatorios: fila 2 de las citas/);

    // La columna de la fecha era la del nombre: el error no repite lo que pone.
    const malMapa = await I.importar(pool, {
      citas: csv('citas.csv', 'Nº cita;Cliente;Día;Hora;Servicio;Estado\nX-1;Nieto, Sara;22/10/2026;11:00;Limpieza facial profunda;Confirmada\n'),
      mapa: { citas: { fecha: 'Cliente' } }, ahora: AHORA,
    });
    assert.match(malMapa.informe, /fila 2: fecha no válida \(no parece una fecha: ¿es la columna buena\?\)/);
    assert.doesNotMatch(malMapa.informe, /Nieto|Sara/);
  } finally {
    await pool.end();
  }
});

// A quien ya estaba en la app (le escribió por WhatsApp, lo dio de alta recepción) se le completa la
// ficha con lo que Flowww sabe y ella no: nada de lo que tiene se pisa, sus observaciones se añaden a
// las suyas, la segunda vez no se repite y deshacer lo deja como estaba.
test('a quien ya estaba en la app se le completa la ficha con lo de Flowww, sin pisar nada', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const app = await sembrar(pool);
    const n = cifrar('Prefiere mañanas');
    const [ana] = await pool.query("INSERT INTO pacientes (nombre, apellidos, email, notas_cifradas, notas_iv, notas_tag, origen) VALUES ('Ana', 'Vidal', 'ana@ejemplo.invalid', ?, ?, ?, 'recepcion')",
      [n.cifrado, n.iv, n.tag]);
    const pacientes = csv('clientes.csv', ['Código;Nombre;Apellidos;Móvil;Email;Fecha nacimiento;Observaciones',
      '1003;Laura;Gómez Ruiz;611000301;laura@ejemplo.invalid;29/02/1988;Alérgica a la lidocaína',
      '1004;Ana;Vidal;;ana@ejemplo.invalid;01/02/1980;Toma Sintrom'].join('\n'));
    const r = await I.importar(pool, { pacientes, aplicar: true, ahora: AHORA });
    assert.match(r.informe, new RegExp(`paciente ${app.laura} de la app, por teléfono; se completa: apellidos, email, nacimiento, observaciones \\(cifradas\\)`));
    assert.match(r.informe, new RegExp(`paciente ${ana.insertId} de la app, por email; se completa: nacimiento, observaciones \\(se añaden a las suyas, si no las tiene ya\\)`));
    assert.match(r.informe, /2 fichas completadas de quien ya estaba/);
    const ficha = async (id) => (await pool.query('SELECT * FROM pacientes WHERE id = ?', [id]))[0][0];
    const notas = (p) => (p.notas_cifradas ? descifrar(p.notas_cifradas, p.notas_iv, p.notas_tag) : null);
    const laura = await ficha(app.laura);
    assert.deepEqual([laura.nombre, laura.apellidos, laura.email, laura.fecha_nacimiento.toISOString().slice(0, 10), notas(laura)],
      ['Laura', 'Gómez Ruiz', 'laura@ejemplo.invalid', '1988-02-29', 'Alérgica a la lidocaína']);
    const conNotas = await ficha(ana.insertId);
    assert.equal(notas(conNotas), 'Prefiere mañanas\n\nObservaciones de Flowww: Toma Sintrom', 'las suyas, y detrás las de Flowww');
    assert.equal(conNotas.email, 'ana@ejemplo.invalid');

    // Otra vez: ya lo tienen todo; no se repite nada.
    assert.equal((await I.importar(pool, { pacientes, aplicar: true, ahora: AHORA })).lote, null);
    assert.equal(notas(await ficha(ana.insertId)), 'Prefiere mañanas\n\nObservaciones de Flowww: Toma Sintrom');

    const d = await I.deshacer(pool, { aplicar: true, ahora: AHORA });
    assert.equal(d.completados, 2);
    const antes = await ficha(app.laura);
    assert.deepEqual([antes.flowww_id, antes.apellidos, antes.email, antes.fecha_nacimiento, antes.notas_cifradas], [null, null, null, null, null]);
    assert.equal(notas(await ficha(ana.insertId)), 'Prefiere mañanas', 'sus notas, como estaban');

    // Unas notas de la app que no se pueden leer con esta clave (se cifraron con otra) no se tocan, y
    // las de Flowww no se pierden calladas: el informe dice a quién hay que pasárselas a mano.
    const clave = process.env.CLAVE_CIFRADO;
    process.env.CLAVE_CIFRADO = crypto.randomBytes(32).toString('hex');
    const otra = cifrar('Cifradas con otra clave');
    if (clave === undefined) delete process.env.CLAVE_CIFRADO; else process.env.CLAVE_CIFRADO = clave;
    const [eva] = await pool.query("INSERT INTO pacientes (nombre, apellidos, email, notas_cifradas, notas_iv, notas_tag) VALUES ('Eva', 'Mena', 'eva@ejemplo.invalid', ?, ?, ?)",
      [otra.cifrado, otra.iv, otra.tag]);
    const r2 = await I.importar(pool, { pacientes: csv('clientes.csv', 'Código;Nombre;Apellidos;Email;Observaciones\n1005;Eva;Mena;eva@ejemplo.invalid;Toma Sintrom\n'), aplicar: true, ahora: AHORA });
    assert.match(r2.informe, new RegExp(`Ojo: a 1 paciente que ya estaba no se le han podido añadir sus observaciones de Flowww: sus notas de la app no se pueden leer con esta CLAVE_CIFRADO \\(paciente ${eva.insertId}\\); pasadlas a mano\\.`));
    assert.deepEqual((await ficha(eva.insertId)).notas_cifradas, otra.cifrado, 'las suyas, sin tocar');
  } finally {
    await pool.end();
  }
});

// Aplicar cifra (observaciones, lo que se guarda para deshacer): con la clave de desarrollo, que es
// pública, ni estaría protegido ni lo podría leer la app. Sin la CLAVE_CIFRADO de la app, no se aplica.
test('aplicar y deshacer exigen la CLAVE_CIFRADO de la app', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const antes = process.env.CLAVE_CIFRADO;
  try {
    const app = await sembrar(pool);
    const pacientes = csv('clientes.csv', 'Código;Nombre;Apellidos;Móvil;Observaciones\n1003;Laura;Gómez Ruiz;611000301;Nota\n1020;Rosa;Pinto;611000820;Otra nota\n');
    delete process.env.CLAVE_CIFRADO;
    await assert.rejects(I.importar(pool, { pacientes, aplicar: true, ahora: AHORA, claveDeDesarrollo: false }), /hace falta la CLAVE_CIFRADO de la app/);
    assert.equal((await pool.query("SELECT COUNT(*) AS n FROM pacientes WHERE flowww_id IS NOT NULL"))[0][0].n, 0);
    assert.equal((await I.importar(pool, { pacientes, ahora: AHORA, claveDeDesarrollo: false })).aplicado, false, 'el ensayo, sí');

    process.env.CLAVE_CIFRADO = crypto.randomBytes(32).toString('hex');
    assert.equal((await I.importar(pool, { pacientes, aplicar: true, ahora: AHORA, claveDeDesarrollo: false })).aplicado, true);
    const [[rosa]] = await pool.query("SELECT notas_cifradas, notas_iv, notas_tag FROM pacientes WHERE flowww_id = '1020'");
    assert.equal(descifrar(rosa.notas_cifradas, rosa.notas_iv, rosa.notas_tag), 'Otra nota', 'con la clave de la app');
    delete process.env.CLAVE_CIFRADO;
    await assert.rejects(I.deshacer(pool, { aplicar: true, ahora: AHORA, claveDeDesarrollo: false }), /hace falta la CLAVE_CIFRADO de la app/);
    assert.equal((await pool.query('SELECT flowww_id FROM pacientes WHERE id = ?', [app.laura]))[0][0].flowww_id, '1003', 'no se ha deshecho nada');
  } finally {
    if (antes === undefined) delete process.env.CLAVE_CIFRADO; else process.env.CLAVE_CIFRADO = antes;
    await pool.end();
  }
});

// El enlace de «Tu cita» de lo que se trae se guarda como lo guarde la agenda: hoy, el token; con la
// migración 010 (vuelta 8c: huella y token cifrado), lo que dé agenda.nuevoToken, con su caducidad.
test('el enlace de «Tu cita» de lo importado se guarda como lo guarde la agenda, antes y después de la 010', () => {
  const fin = new Date('2026-10-15T09:00:00Z');
  const propias = { nuevoToken: agenda.nuevoToken, caducidadEnlace: agenda.caducidadEnlace };
  const huella = Buffer.alloc(32, 7);
  try {
    if (!propias.nuevoToken) assert.match(I.columnasEnlace(fin).token, /^[A-Za-z0-9_-]{43}$/);
    agenda.nuevoToken = () => ({ token: 't'.repeat(43), columnas: { token_hash: huella, token_cifrado: Buffer.from('c'), token_iv: Buffer.alloc(12), token_tag: Buffer.alloc(16) } });
    agenda.caducidadEnlace = (f) => new Date(new Date(f).getTime() + 30 * 86400000);
    const c = I.columnasEnlace(fin);
    assert.equal(c.token, undefined, 'la columna token ya no existe');
    assert.deepEqual([c.token_hash, c.token_caduca_en.toISOString()], [huella, '2026-11-14T09:00:00.000Z']);
  } finally {
    for (const [k, v] of Object.entries(propias)) if (v) agenda[k] = v; else delete agenda[k];
  }
});

test('un paciente anonimizado en la app (derecho de supresión) no vuelve a entrar desde Flowww', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    await pool.query("INSERT INTO pacientes (nombre, flowww_id, telefono, anonimizado_en) VALUES ('Anonimizado', '2001', '+34611000555', '2026-09-01 00:00:00')");
    const pacientes = csv('pacientes.csv', 'Código;Nombre;Apellidos;Móvil\n2001;Rosa;Pinto;611000555\n2002;Rosa;Pinto;611 000 555\n2003;Olga;Sanz;611000556\n');
    const citas = csv('citas.csv', [
      'Cód. cliente;Cliente;Móvil;Fecha;Hora;Servicio;Empleado;Cabina;Estado',
      '2001;Pinto, Rosa;;22/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
      ';Pinto, Rosa;611000555;23/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
      '2003;Sanz, Olga;;23/10/2026;12:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
    ].join('\n'));
    const r = await I.importar(pool, { pacientes, citas, aplicar: true, ahora: AHORA });
    assert.equal(r.aplicado, true);
    assert.match(r.informe, /fila 2 \(Flowww 2001\): está anonimizado en la app \(derecho de supresión\): no se vuelve a traer/);
    assert.match(r.informe, /fila 3 \(Flowww 2002\): su teléfono es el de un paciente anonimizado en la app/, 'con otro código, pero su teléfono');
    assert.match(r.informe, /fila 2: el paciente está anonimizado en la app\n\s+fila 3: su teléfono es el de un paciente anonimizado en la app/, 'ni sus citas');
    const [nuevos] = await pool.query("SELECT flowww_id FROM pacientes WHERE origen = 'flowww'");
    assert.deepEqual(nuevos.map((x) => x.flowww_id), ['2003']);
    const [importadas] = await pool.query("SELECT COUNT(*) AS n FROM citas WHERE origen = 'importacion'");
    assert.equal(importadas[0].n, 1);
  } finally {
    await pool.end();
  }
});

test('sin código de cita, una que se mueve en Flowww se trae para revisar (no se duplica callada) y la siguiente vez no se repite', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const cabecera = 'Cód. cliente;Cliente;Fecha;Hora;Servicio;Empleado;Cabina;Estado';
    const antes = csv('citas.csv', `${cabecera}\n5001;Pinto, Rosa;22/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada\n`);
    assert.equal((await I.importar(pool, { citas: antes, aplicar: true, ahora: AHORA })).aplicado, true);
    const [[primera]] = await pool.query("SELECT id, flowww_id FROM citas WHERE origen = 'importacion'");
    assert.match(primera.flowww_id, /^c:[0-9a-f]{32}$/, 'sin código: una huella de la cita');

    const movida = csv('citas.csv', `${cabecera}\n5001;Pinto, Rosa;23/10/2026;12:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada\n`);
    const r = await I.importar(pool, { citas: movida, aplicar: true, ahora: AHORA });
    assert.match(r.informe, /1 puede ser una ya importada y movida en Flowww \(sin código de cita\): se trae para revisar, con su tarea:/);
    const [[nueva]] = await pool.query("SELECT id, revisar_motivo FROM citas WHERE origen = 'importacion' AND id <> ?", [primera.id]);
    assert.equal(nueva.revisar_motivo, `puede ser la cita ${primera.id}, importada antes para el 22/10/2026 a las 11:00 y movida en Flowww: anular la que sobre`);
    const [tareas] = await pool.query('SELECT titulo FROM tareas');
    assert.equal(tareas.length, 1, 'una tarea para las dos: la de la nueva');
    assert.match(tareas[0].titulo, /^Cita importada de Flowww para revisar \(23\/10 12:00, Limpieza facial profunda\): puede ser la cita/);
    const [[vieja]] = await pool.query('SELECT recordatorios, revisar_motivo FROM citas WHERE id = ?', [primera.id]);
    assert.deepEqual({ ...vieja }, { recordatorios: 0, revisar_motivo: 'puede haberse movido en Flowww al 23/10/2026 a las 12:00: anular la que sobre (sin recordatorios)' },
      'la de antes, que ya no está en Flowww, sin recordatorios: que no le lleguen de las dos');

    const otraVez = await I.importar(pool, { citas: movida, aplicar: true, ahora: AHORA });
    assert.equal(otraVez.lote, null, 'la tercera vez, nada nuevo');
    const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM citas WHERE origen = 'importacion'");
    assert.equal(n.n, 2);
  } finally {
    await pool.end();
  }
});

test('un tratamiento que en la app no pide a nadie respeta el profesional de Flowww, que tiene que estar libre', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const citas = csv('citas.csv', [
      'Nº cita;Cód. cliente;Cliente;Fecha;Hora;Servicio;Empleado;Cabina;Estado',
      'R-1;4001;Pinto, Rosa;22/10/2026;11:00;Ritual relajante;Estética Dos;Cabina facial;Confirmada',
      'R-2;4002;Sanz, Olga;22/10/2026;11:30;Ritual relajante;Estética Dos;Cabina corporal;Confirmada',
    ].join('\n'));
    const r = await I.importar(pool, { citas, aplicar: true, ahora: AHORA });
    assert.equal(r.aplicado, true);
    const [filas] = await pool.query("SELECT flowww_id, profesional_id, sala_id, revisar_motivo FROM citas WHERE origen = 'importacion' ORDER BY flowww_id");
    assert.deepEqual(filas.map((x) => ({ ...x })), [
      { flowww_id: 'R-1', profesional_id: 21, sala_id: 1, revisar_motivo: null },
      { flowww_id: 'R-2', profesional_id: 21, sala_id: 3, revisar_motivo: 'Estética Dos ya tiene otra cita de las 11:00 (la fila 2 de las citas)' },
    ]);
  } finally {
    await pool.end();
  }
});

test('si mientras se planifica alguien da una cita, al bloquear la agenda se vuelve a planificar: no hay dobles', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const citas = csv('citas.csv', 'Nº cita;Cód. cliente;Cliente;Fecha;Hora;Servicio;Empleado;Cabina;Estado\nP-1;6001;Pinto, Rosa;22/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada\n');
    // Mientras, recepción da la cabina facial de las 11:00 del jueves 22 a otra paciente.
    const recepcion = async () => {
      const [[otra]] = await pool.query("SELECT id FROM pacientes WHERE nombre = 'Otra'");
      await agenda.reservar(pool, { pacienteId: otra.id, tratamientoId: 'limpieza-facial', fecha: '2026-10-22', hora: '11:00', profesionalId: 21, ahora: AHORA });
    };
    const r = await I.importar(pool, { citas, aplicar: true, ahora: AHORA, trasPlanificar: recepcion });
    assert.equal(r.aplicado, true);
    const [[p1]] = await pool.query("SELECT sala_id, revisar_motivo FROM citas WHERE flowww_id = 'P-1'");
    assert.equal(p1.sala_id, 1);
    assert.match(p1.revisar_motivo, /^Cabina facial ocupada por otra cita de las 11:00 \(la cita \d+ de la app\)$/, 'se ve la de recepción y se marca para revisar');
  } finally {
    await pool.end();
  }
});

test('el script: ensayo por defecto, --aplicar, errores de uso y del mapa', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const lanzar = (args, entorno = {}) => {
      const env = { ...process.env, DB_NAME: BD_PRUEBAS.database, NODE_ENV: 'test', ...entorno };
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
      return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
    };
    const pacientes = path.join(FIXTURES, 'pacientes.csv');
    const n = async () => Number((await pool.query("SELECT COUNT(*) AS n FROM pacientes WHERE origen = 'flowww'"))[0][0].n);

    const uso = lanzar(['--citas']);
    assert.equal(uso.status, 2);
    assert.match(uso.stderr, /Falta el valor de --citas/);
    assert.equal(lanzar(['--aplicar']).status, 2, 'hay que decir qué importar');
    assert.equal(lanzar(['--pacientes', pacientes, '--recordatorios', 'si']).status, 2, 'una cosa cada vez');
    assert.match(lanzar(['--pacientes', pacientes, '--cita', '5']).stderr, /--cita va con --recordatorios/);
    assert.match(lanzar(['--recordatorios', 'si', '--cita', 'la de Carmen']).stderr, /--cita va con el número de la cita en la app/);

    const ensayo = lanzar(['--pacientes', pacientes]);
    assert.equal(ensayo.status, 0, ensayo.stderr);
    assert.match(ensayo.stdout, /ENSAYO: no se ha escrito nada/);
    assert.match(ensayo.stdout, /→ 7 nuevos/);
    assert.equal(await n(), 0);

    const malMapa = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'iemec-flowww-')), 'mapa.json');
    fs.writeFileSync(malMapa, '{ "tratamientos": { "Botox": ');
    const r = lanzar(['--pacientes', pacientes, '--mapa', malMapa, '--aplicar']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /El mapa mapa\.json no es un JSON válido/);
    fs.writeFileSync(malMapa, JSON.stringify({ pacientes: { telefono: 'Movil 2' } }));
    const sinColumna = lanzar(['--pacientes', pacientes, '--mapa', malMapa, '--aplicar']);
    assert.equal(sinColumna.status, 1, 'no se aplica');
    assert.match(sinColumna.stdout, /✗ pacientes\.csv: El mapa dice que «telefono» está en la columna «Movil 2», y el fichero no la tiene/);
    assert.equal(await n(), 0);

    // En el portátil, con el .env de ejemplo (sin CLAVE_CIFRADO), no se aplica.
    const sinClave = lanzar(['--pacientes', pacientes, '--aplicar'], { NODE_ENV: 'development', CLAVE_CIFRADO: undefined, NODE_TEST_CONTEXT: undefined });
    assert.equal(sinClave.status, 1);
    assert.match(sinClave.stderr, /✗ Para aplicar hace falta la CLAVE_CIFRADO de la app/);
    assert.equal(await n(), 0);

    const aplicado = lanzar(['--pacientes', pacientes, '--aplicar']);
    assert.equal(aplicado.status, 0, aplicado.stderr);
    assert.match(aplicado.stdout, /APLICADA \(lote flowww-/);
    assert.equal(await n(), 7);
    assert.match(lanzar(['--deshacer']).stdout, /ENSAYO: no se ha cambiado nada/);
    assert.equal(await n(), 7);
    assert.match(lanzar(['--recordatorios', 'no']).stdout, /No hay citas futuras importadas de Flowww con recordatorios/);
  } finally {
    await pool.end();
  }
});
