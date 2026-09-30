'use strict';
// Importación de Flowww (servidor/importacion-flowww.js y scripts/importar-flowww.js) con CSV
// INVENTADOS (test/fixtures/flowww): pacientes en UTF-8 con BOM y «;», citas en Windows-1252 con «,»,
// comillas, teléfonos raros, duplicados, un móvil compartido, servicios y profesionales que no casan,
// citas que chocan o caen fuera de horario o de su cabina. El ensayo no escribe nada; aplicar mete
// todo en una transacción; la segunda vez no duplica; las citas importadas no llevan confirmación
// pero sí recordatorios (salvo que se pida lo contrario); y deshacer quita lo que nadie ha tocado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { prepararBdDePrueba, BD_PRUEBAS } = require('./ayuda-bd');
const I = require('../servidor/importacion-flowww');
const agenda = require('../servidor/agenda');
const avisos = require('../servidor/avisos-cita');
const R = require('../servidor/repesca/motor');
const { descifrar } = require('../servidor/cripto');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const T = require('../motor/tiempo');

const FIXTURES = path.join(__dirname, 'fixtures', 'flowww');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'importar-flowww.js');
const fichero = (nombre) => ({ nombre, contenido: fs.readFileSync(path.join(FIXTURES, nombre)) });
const csv = (nombre, texto) => ({ nombre, contenido: Buffer.from(texto) });
const MAPA = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mapa.json'), 'utf8'));
const AHORA = new Date('2026-10-13T08:00:00Z'); // martes 13 de octubre, 10:00 en Madrid
const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
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
    ('presoterapia', 'Presoterapia', 'corporal', 45, 10, 'esteticista', 'cabina_estetica', NULL)`);
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
  const secuencia = async (nombre, pacienteId) => (await pool.query("INSERT INTO inscripciones (secuencia, paciente_id, inicio, siguiente_en) VALUES (?, ?, '2026-10-01 08:00:00', '2026-10-20 08:00:00')", [nombre, pacienteId]))[0].insertId;
  return { laura: laura.insertId, marta: marta.insertId, citaOtra: cita.id, inscripcion: await secuencia('dormido', laura.insertId), inscripcionMarta: await secuencia('toca_repetir', marta.insertId) };
}

async function contar(pool) {
  const n = async (sql) => Number((await pool.query(sql))[0][0].n);
  return {
    pacientes: await n('SELECT COUNT(*) AS n FROM pacientes'),
    conFlowww: await n('SELECT COUNT(*) AS n FROM pacientes WHERE flowww_id IS NOT NULL'),
    citas: await n('SELECT COUNT(*) AS n FROM citas'),
    consentimientos: await n('SELECT COUNT(*) AS n FROM consentimientos'),
    tareas: await n('SELECT COUNT(*) AS n FROM tareas'),
    mapeos: await n('SELECT COUNT(*) AS n FROM mapeo_tratamientos'),
    eventos: await n('SELECT COUNT(*) AS n FROM eventos'),
    bajas: await n('SELECT COUNT(*) AS n FROM pacientes WHERE baja_comercial_en IS NOT NULL'),
    secuencias: await n("SELECT COUNT(*) AS n FROM inscripciones WHERE estado = 'activa'"),
  };
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
      assert.match(inf, /PACIENTES · pacientes\.csv \(UTF-8 con BOM, separador «;», 11 filas\)/);
      assert.match(inf, /CITAS · citas\.csv \(Windows-1252, separador «,», 18 filas\)/);
      assert.match(inf, /No se traen: «DNI»/);
      assert.match(inf, new RegExp(`fila 4 \\(Flowww 1003\\) → paciente ${app.laura} de la app, por teléfono\n`));
      assert.match(inf, new RegExp(`fila 5 \\(Flowww 1004\\) → paciente ${app.marta} de la app, por email; no tenía teléfono: se le pone el de Flowww`));
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
      assert.match(r.informe, /HECHO: 9 pacientes nuevos y 2 vinculados · 8 consentimientos registrados · 12 citas \(4 para revisar, con su tarea en el panel\) · 1 servicio del mapa guardado/);
      assert.doesNotMatch(r.informe, PERSONALES);

      // Pacientes: sin duplicar, con su código de Flowww; a los que ya estaban no se les toca nada más.
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
      assert.deepEqual([laura.flowww_id, laura.nombre, laura.apellidos], ['1003', 'Laura', null], 'solo se le apunta el código');
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
      assert.equal(cons[1].prueba, 'Flowww, pacientes.csv fila 2: «Acepta publicidad» = «Sí»');
      const permiso = async (pacienteId) => R.permisoComercial(pool, { paciente_id: pacienteId }, AHORA);
      assert.equal((await permiso(carmen.id)).ok, true, 'con su «sí», puede recibir mensajes comerciales');
      assert.match((await permiso((await p('1010')).id)).motivo, /sin consentimiento/, '«Pendiente» no es un sí');
      assert.match((await permiso((await p('1002')).id)).motivo, /sin consentimiento/, 'importar no da consentimiento');
      assert.match((await permiso(app.laura)).motivo, /baja/);
      assert.match((await permiso((await p('1011')).id)).motivo, /baja/);

      // Citas: las futuras, por el motor de agenda; las que no caben, igual, para revisar y con tarea.
      const [citas] = await pool.query("SELECT * FROM citas WHERE origen = 'importacion' ORDER BY flowww_id");
      const cita = Object.fromEntries(citas.map((c) => [c.flowww_id, c]));
      assert.deepEqual(Object.keys(cita).sort(), ['C-1', 'C-12', 'C-14', 'C-15', 'C-17', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8']);
      assert.ok(citas.every((c) => c.estado === 'confirmada' && c.recordatorios === 1 && c.token.length === 43 && c.creada_por === 'importacion-flowww'));
      assert.deepEqual([cita['C-1'].inicio.toISOString(), cita['C-1'].sala_id, cita['C-1'].profesional_id, cita['C-1'].paciente_id, cita['C-1'].revisar_motivo],
        ['2026-10-15T08:00:00.000Z', 1, 20, carmen.id, null]);
      assert.equal(cita['C-1'].notas, 'Flowww: Trae su crema, 30 €');
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
      assert.equal(tareas[0].titulo, `Cita importada de Flowww que no cabe en la agenda (15/10 13:00, Limpieza facial profunda): ${cita['C-3'].revisar_motivo}. Revisarla`);
      assert.deepEqual([tareas[0].paciente_id, tareas[0].tipo, tareas[0].estado], [cita['C-3'].paciente_id, 'otro', 'abierta']);
      assert.equal(tareas[0].vence_en.toISOString(), '2026-10-14T08:00:00.000Z', 'para mañana: antes de la cita');
      // Ocupan la agenda como cualquier otra cita.
      const libres = (await agenda.huecos(pool, { fecha: '2026-10-15', tratamientoId: 'limpieza-facial', ahora: AHORA })).map((h) => h.hora);
      for (const hora of ['10:00', '13:00', '16:00', '16:30']) assert.ok(!libres.includes(hora), hora);
      assert.ok(libres.includes('11:10'));

      const [[mapeo]] = await pool.query("SELECT tratamiento_id FROM mapeo_tratamientos WHERE clave = 'flowww:botox 3 zonas'");
      assert.equal(mapeo.tratamiento_id, 'toxina-3-zonas', 'lo del mapa queda guardado para la próxima vez');
      const [secuencias] = await pool.query('SELECT estado, motivo_fin FROM inscripciones WHERE id IN (?) ORDER BY id', [[app.inscripcion, app.inscripcionMarta]]);
      assert.deepEqual(secuencias.map((s) => ({ ...s })), Array(2).fill({ estado: 'terminada', motivo_fin: 'cita' }), 'con cita, se acaban sus secuencias');
      const [[ev]] = await pool.query("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'importacion_flowww' AND entidad_id = ?", [lote]);
      assert.equal(ev.n, 1);
    });

    await t.test('la segunda ejecución no duplica nada; lo guardado del mapa vale sin mapa y lo que cambió en Flowww se avisa', async () => {
      const antes = await contar(pool);
      const r = await I.importar(pool, { ...ficheros, mapa: MAPA, aplicar: true, ahora: AHORA });
      assert.deepEqual([r.aplicado, r.lote], [true, null]);
      assert.match(r.informe, /APLICADA: no había nada nuevo que traer/);
      assert.match(r.informe, /9 ya importados antes \(mismo código de Flowww\): no se tocan/);
      assert.match(r.informe, /12 ya importadas antes: no se tocan/);
      assert.deepEqual(await contar(pool), antes);

      const nuevo = csv('citas-nuevas.csv', [
        'Nº cita;Cód. cliente;Cliente;Fecha;Hora;Servicio;Empleado;Cabina;Estado',
        'C-20;1006;Mora, Irene;27/10/2026;12:00;Botox 3 zonas;Dra. Médica;Consulta;Confirmada',
        'C-1;1001;Ruiz Soler, Carmen;15/10/2026;11:00;Limpieza facial profunda;Estética Uno;Cabina facial;Confirmada',
        'C-4;1005;Marín, Sergio;15/10/2026;16:00;Limpieza facial profunda;Estética Uno;Cabina facial;Anulada',
      ].join('\n'));
      const e = await I.importar(pool, { citas: nuevo, ahora: AHORA });
      assert.deepEqual(e.plan.bloqueos, []);
      assert.match(e.informe, /«Botox 3 zonas» → Toxina botulínica 3 zonas \(guardado en otra importación\)/);
      assert.match(e.informe, /fila 3 \(Flowww C-1\): en Flowww ha cambiado de hora \(ahora, jue 15\/10\/2026 11:00\); revisar la cita \d+ de la app/);
      assert.match(e.informe, /fila 4 \(Flowww C-4\): en Flowww está anulada; revisar la cita \d+ de la app/);
      const a = await I.importar(pool, { citas: nuevo, aplicar: true, sinRecordatorios: true, ahora: AHORA });
      assert.equal(a.aplicado, true);
      assert.match(a.informe, /ni los recordatorios \(--sin-recordatorios\)/);
      const [[c20]] = await pool.query("SELECT recordatorios, tratamiento_id FROM citas WHERE flowww_id = 'C-20'");
      assert.deepEqual([c20.recordatorios, c20.tratamiento_id], [0, 'toxina-3-zonas']);
      const [[c1]] = await pool.query("SELECT inicio FROM citas WHERE flowww_id = 'C-1'");
      assert.equal(madrid(c1.inicio), '2026-10-15 10:00', 'lo ya importado no se pisa');
    });

    await t.test('avisos: sin confirmación, pero con víspera y 2 horas; sin recordatorios si se pidió, y se ponen después', async () => {
      const whatsapp = crearWhatsApp('simulado');
      const deps = { pool, ia: crearIa('simulado'), whatsapp };
      const [importadas] = await pool.query("SELECT id, flowww_id FROM citas WHERE origen = 'importacion'");
      const id = Object.fromEntries(importadas.map((c) => [c.flowww_id, c.id]));
      const suyos = (lista) => lista.filter((a) => importadas.some((c) => c.id === a.id));
      assert.deepEqual(suyos(await avisos.pendientes(pool, new Date('2026-10-13T08:05:00Z'))), [], 'ninguna confirmación: ya la tuvieron en Flowww');

      // La víspera sale aunque se importara hace nada (la cita la pidió en Flowww, hace tiempo).
      await pool.query('UPDATE citas SET creado_en = ? WHERE id = ?', [new Date('2026-10-14T07:30:00Z'), id['C-1']]);
      const vispera = suyos(await avisos.pendientes(pool, new Date('2026-10-14T08:05:00Z')));
      assert.ok(vispera.some((a) => a.id === id['C-1'] && a.tipo === 'vispera'));
      assert.ok(vispera.every((a) => a.tipo === 'vispera'));
      await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-14T08:05:00Z') });
      const aCarmen = whatsapp.enviados.find((m) => m.telefono === '+34611000401');
      assert.deepEqual([aCarmen.nombre, aCarmen.variables], ['iemec_recordatorio_24h', ['Carmen', '10:00']]);

      const dos = suyos(await avisos.pendientes(pool, new Date('2026-10-15T07:05:00Z')));
      assert.ok(dos.some((a) => a.id === id['C-1'] && a.tipo === 'dos_horas'));

      // C-20 se importó con --sin-recordatorios: el lunes 26 (ya en horario de invierno), nada.
      const lunes = new Date('2026-10-26T09:05:00Z');
      assert.ok(!(await avisos.pendientes(pool, lunes)).some((a) => a.id === id['C-20']));
      const ensayo = await I.cambiarRecordatorios(pool, { activar: true, ahora: AHORA });
      assert.deepEqual([ensayo.citas, ensayo.aplicado], [1, false]);
      assert.match(ensayo.informe, /^Ensayo: 1 cita futura importada de Flowww pasaría/);
      const hecho = await I.cambiarRecordatorios(pool, { activar: true, aplicar: true, ahora: AHORA });
      assert.deepEqual([hecho.citas, hecho.aplicado], [1, true]);
      assert.ok((await avisos.pendientes(pool, lunes)).some((a) => a.id === id['C-20'] && a.tipo === 'vispera'));
    });

    await t.test('deshacer quita lo importado que nadie ha tocado; lo tocado se queda', async () => {
      const antes = await contar(pool);
      const ensayo = await I.deshacer(pool, { ahora: AHORA });
      assert.match(ensayo.informe, /ENSAYO: no se ha cambiado nada/);
      assert.equal(ensayo.citasQuitadas, 1, 'la última importación: la de C-20');
      assert.deepEqual(await contar(pool), antes);
      await I.deshacer(pool, { aplicar: true, ahora: AHORA });
      assert.equal((await pool.query("SELECT id FROM citas WHERE flowww_id = 'C-20'"))[0].length, 0);

      // Recepción ya ha anulado dos de las del primer lote: esas se quedan, y sus pacientes también. Y
      // quien ya ha recibido la víspera tiene su conversación en la app: tampoco se borra.
      await pool.query("UPDATE citas SET estado = 'cancelada' WHERE flowww_id IN ('C-4', 'C-6')");
      const [conConversacion] = await pool.query("SELECT DISTINCT p.flowww_id FROM conversaciones c JOIN pacientes p ON p.id = c.paciente_id WHERE p.origen = 'flowww' ORDER BY p.flowww_id");
      assert.deepEqual(conConversacion.map((x) => x.flowww_id), ['1001', '1005', '1010']);
      const d = await I.deshacer(pool, { lote, aplicar: true, ahora: AHORA });
      assert.equal(d.citasQuitadas, 10);
      assert.deepEqual(d.citasQuedan.map((c) => c.estado), ['cancelada', 'cancelada']);
      assert.equal(d.pacientesQuitados, 6);
      assert.deepEqual([d.vinculados, d.telefonos, d.consentimientos, d.bajas, d.tareas, d.mapeos, d.secuencias], [2, 1, 8, 2, 4, 1, 1]);
      const [[marta]] = await pool.query('SELECT flowww_id, telefono FROM pacientes WHERE id = ?', [app.marta]);
      assert.deepEqual({ ...marta }, { flowww_id: null, telefono: null }, 'como estaba');
      const [[insMarta]] = await pool.query('SELECT estado FROM inscripciones WHERE id = ?', [app.inscripcionMarta]);
      assert.equal(insMarta.estado, 'terminada', 'le queda una cita importada: su secuencia no vuelve');
      assert.match(d.informe, /Citas: 10 se quitan; 2 se quedan porque ya han cambiado \(cita \d+: cancelada, cita \d+: cancelada\)/);
      assert.match(d.informe, /Pacientes nuevos: 6 se quitan; 3 se quedan porque ya tienen otras cosas en la app/);
      const [quedan] = await pool.query("SELECT flowww_id FROM pacientes WHERE origen = 'flowww' ORDER BY flowww_id");
      assert.deepEqual(quedan.map((x) => x.flowww_id), ['1001', '1005', '1010']);
      assert.deepEqual(d.pacientesQuedan.length, 3);
      const [[laura]] = await pool.query('SELECT flowww_id, baja_comercial_en FROM pacientes WHERE id = ?', [app.laura]);
      assert.deepEqual({ ...laura }, { flowww_id: null, baja_comercial_en: null });
      const [[ins]] = await pool.query('SELECT estado FROM inscripciones WHERE id = ?', [app.inscripcion]);
      assert.equal(ins.estado, 'activa', 'su secuencia vuelve a como estaba');
      const despues = await contar(pool);
      assert.deepEqual([despues.consentimientos, despues.mapeos, despues.tareas], [0, 0, 0]);
      const [[otra]] = await pool.query('SELECT estado FROM citas WHERE id = ?', [app.citaOtra]);
      assert.equal(otra.estado, 'confirmada');
      await assert.rejects(I.deshacer(pool, { lote, aplicar: true, ahora: AHORA }), /ya se deshizo/);
      await assert.rejects(I.deshacer(pool, { ahora: AHORA }), /No hay ninguna importación de Flowww que deshacer/);
    });
  } finally {
    await pool.end();
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

test('el script: ensayo por defecto, --aplicar, errores de uso y del mapa', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const lanzar = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8', env: { ...process.env, DB_NAME: BD_PRUEBAS.database, NODE_ENV: 'test' },
    });
    const pacientes = path.join(FIXTURES, 'pacientes.csv');
    const n = async () => Number((await pool.query("SELECT COUNT(*) AS n FROM pacientes WHERE origen = 'flowww'"))[0][0].n);

    const uso = lanzar('--citas');
    assert.equal(uso.status, 2);
    assert.match(uso.stderr, /Falta el valor de --citas/);
    assert.equal(lanzar('--aplicar').status, 2, 'hay que decir qué importar');
    assert.equal(lanzar('--pacientes', pacientes, '--recordatorios', 'si').status, 2, 'una cosa cada vez');

    const ensayo = lanzar('--pacientes', pacientes);
    assert.equal(ensayo.status, 0, ensayo.stderr);
    assert.match(ensayo.stdout, /ENSAYO: no se ha escrito nada/);
    assert.match(ensayo.stdout, /→ 7 nuevos/);
    assert.equal(await n(), 0);

    const malMapa = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'iemec-flowww-')), 'mapa.json');
    fs.writeFileSync(malMapa, '{ "tratamientos": { "Botox": ');
    const r = lanzar('--pacientes', pacientes, '--mapa', malMapa, '--aplicar');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /El mapa mapa\.json no es un JSON válido/);
    fs.writeFileSync(malMapa, JSON.stringify({ pacientes: { telefono: 'Movil 2' } }));
    const sinColumna = lanzar('--pacientes', pacientes, '--mapa', malMapa, '--aplicar');
    assert.equal(sinColumna.status, 1, 'no se aplica');
    assert.match(sinColumna.stdout, /✗ pacientes\.csv: El mapa dice que «telefono» está en la columna «Movil 2», y el fichero no la tiene/);
    assert.equal(await n(), 0);

    const aplicado = lanzar('--pacientes', pacientes, '--aplicar');
    assert.equal(aplicado.status, 0, aplicado.stderr);
    assert.match(aplicado.stdout, /APLICADA \(lote flowww-/);
    assert.equal(await n(), 7);
    assert.match(lanzar('--deshacer').stdout, /ENSAYO: no se ha cambiado nada/);
    assert.equal(await n(), 7);
    assert.match(lanzar('--recordatorios', 'no').stdout, /No hay citas futuras importadas de Flowww con recordatorios/);
  } finally {
    await pool.end();
  }
});
