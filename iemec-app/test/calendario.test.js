'use strict';
// Privacidad de la cita y «Añadir al calendario» con un toque, contra la base:
//   · el token de «Tu cita», solo como huella y cifrado (y los de antes, migrados sin perder el enlace)
//   · WhatsApp sin tratamiento: la confirmación de la IA, los avisos y las variables de las plantillas
//   · la confirmación con el mapa de la sede y dos botones de enlace (/cal/… y /c/…); si sustituye a
//     otra cita, «ha cambiado: borra la anterior»
//   · la víspera con sus dos respuestas rápidas, que llegan por el webhook (y un «sí» o un «no» a secas)
//   · cambiar de cabina en la misma sede no toca el calendario del paciente
// Todo inventado: teléfonos 611 000 7xx y tratamientos «(ejemplo)».
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
const ICAL = require('ical.js');
const { prepararBdDePrueba, BD_PRUEBAS } = require('./ayuda-bd');
const { crearPool } = require('../servidor/db');
const { migrar } = require('../servidor/migraciones');
const { crearApp } = require('../servidor/index');
const agenda = require('../servidor/agenda');
const avisos = require('../servidor/avisos-cita');
const espera = require('../servidor/avisos-espera');
const LE = require('../servidor/lista-espera');
const entrada = require('../servidor/entrada');
const R = require('../servidor/repesca/motor');
const { descifrar } = require('../servidor/cripto');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');

const mas = (d, min) => new Date(new Date(d).getTime() + min * 60000);
const SEDE = 'IEMEC (Av. Siglo XXI, 13, local 35, Boadilla del Monte)';
const DIRECCION = 'Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid';
// Un tratamiento íntimo (ginecoestética): nunca se nombra en un mensaje.
const INTIMO = /l[áa]ser|[íi]ntimo|gineco|ejemplo/i;

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

// La app entera con el reloj parado en «ahora» (req.ahora solo lo pone el servidor, como en
// publicas.test.js): «Tu cita» y el .ics dependen de la hora, y las pruebas no pueden depender del día
// en que se lanzan (desplegar.sh las pasa antes de subir).
function appConReloj(pool, ahora, deps = null) {
  const app = express();
  app.use((req, _res, next) => { req.ahora = ahora; next(); });
  app.use(crearApp({ pool, deps }));
  return app;
}

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, municipio, whatsapp) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', 'Boadilla del Monte', '+34722833285')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-1', 'Cabina 1', 'cabina_estetica'), (2, 'cabina-2', 'Cabina 2', 'cabina_estetica')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista'), (21, 'estetica-2', 'Estética 2', 'esteticista')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '20:00'), (21, ?, '11:00', '20:00')", [d, d]);
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('ginecoestetica', 'Ginecología estética y regenerativa')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, rol_profesional, sala_tipo, regimen_legal, reservable_ia) VALUES
    ('laser-intimo', 'Láser íntimo (ejemplo)', 'ginecoestetica', 60, 10, 'esteticista', 'cabina_estetica', 'aparatologia', TRUE)`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cabecera, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cabecera ? JSON.stringify(p.cabecera) : null, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

let telefonos = 0;
async function paciente(pool, nombre) {
  const telefono = `+34611000${700 + ++telefonos}`;
  const [p] = await pool.query('INSERT INTO pacientes (nombre, telefono) VALUES (?, ?)', [nombre, telefono]);
  return { id: p.insertId, telefono };
}

// Lo que le ha llegado, tal y como lo lee (en la base va cifrado).
async function textos(pool, telefono) {
  const [m] = await pool.query(
    `SELECT m.cuerpo_cifrado, m.iv, m.tag FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
      WHERE c.telefono = ? AND m.direccion = 'saliente' ORDER BY m.id`, [telefono]);
  return m.map((x) => descifrar(x.cuerpo_cifrado, x.iv, x.tag));
}

test('el token de «Tu cita» solo se guarda como huella y cifrado', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const p = await paciente(pool, 'Laura');
    const ahora = new Date('2026-10-13T08:00:00Z');
    const c = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-15', hora: '17:00', ahora });
    const otra = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-16', hora: '17:00', ahora });
    assert.match(c.token, /^[A-Za-z0-9_-]{43}$/, '32 bytes aleatorios en base64url');

    const [[fila]] = await pool.query('SELECT * FROM citas WHERE id = ?', [c.id]);
    for (const [columna, valor] of Object.entries(fila)) {
      const texto = Buffer.isBuffer(valor) ? valor.toString('latin1') : String(valor);
      assert.ok(!texto.includes(c.token), `el token no está en claro en «${columna}»`);
    }
    assert.deepEqual(fila.token_hash, crypto.createHash('sha256').update(c.token).digest(), 'su huella SHA-256, para encontrarla');
    assert.equal(agenda.tokenDe(fila), c.token, 'y cifrado con CLAVE_CIFRADO, para volver a mandar el enlace');
    assert.equal(fila.token_antiguo, null);
    assert.equal(new Date(fila.token_caduca_en).getTime(), new Date(fila.fin).getTime() + 30 * 86400000, 'caduca 30 días después de la cita');
    assert.match(fila.uid_ics, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(fila.uid_ics, otra.uidIcs, 'cada cita, su UID');
    assert.equal(fila.uid_ics, c.uidIcs);

    // Confirmar o cancelar con el token busca por la huella; lo que no es un token, ni se busca.
    await assert.rejects(agenda.cancelar(pool, { token: 'x'.repeat(43), ahora }), (e) => e.codigo === 'CITA_DESCONOCIDA');
    await assert.rejects(agenda.cancelar(pool, { token: "' OR 1=1 -- ", ahora }), (e) => e.codigo === 'CITA_DESCONOCIDA');
    assert.equal((await agenda.cancelar(pool, { token: otra.token, por: 'paciente', ahora })).estado, 'cancelada');

    // Una cita que no se dio por aquí (importada, a mano) no tiene su token guardado: al mandarle el
    // enlace, recibe uno nuevo. Si lo tiene y no se puede descifrar, no se toca (su enlace sigue valiendo).
    const [ins] = await pool.query(
      `INSERT INTO citas (paciente_id, tratamiento_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token_hash)
       VALUES (?, 'laser-intimo', '2026-10-20 15:00', '2026-10-20 16:00', '2026-10-20 15:00', '2026-10-20 16:10', '2026-10-20 15:00', '2026-10-20 16:00', 'confirmada', ?)`,
      [p.id, crypto.randomBytes(32)]);
    const nuevo = await agenda.tokenParaEnviar(pool, ins.insertId);
    assert.match(nuevo, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(await agenda.tokenParaEnviar(pool, ins.insertId), nuevo, 'y ya es el suyo');
    const [[importada]] = await pool.query('SELECT token_hash FROM citas WHERE id = ?', [ins.insertId]);
    assert.deepEqual(importada.token_hash, agenda.huellaToken(nuevo));
    await pool.query('UPDATE citas SET token_tag = ? WHERE id = ?', [crypto.randomBytes(16), c.id]);
    assert.equal(await agenda.tokenParaEnviar(pool, c.id), null);
    const [[igual]] = await pool.query('SELECT token_hash FROM citas WHERE id = ?', [c.id]);
    assert.deepEqual(igual.token_hash, fila.token_hash);
  } finally {
    await pool.end();
  }
});

const SQL = path.join(__dirname, '..', 'sql');
const LA_010 = '010-privacidad-cita.sql';

// Una base con las migraciones hasta la 009 (la de antes de esta vuelta) y una carpeta solo con ellas,
// a la que la prueba añade la 010: así se prueba justo la 010, vengan las que vengan después en sql/.
async function baseHastaLa009(t) {
  let con;
  try {
    con = await mysql.createConnection({ ...BD_PRUEBAS, database: undefined });
  } catch (err) {
    if (process.env.IEMEC_EXIGIR_BD === '1') throw err;
    t.skip(`sin MariaDB (${err.code || err.message})`);
    return null;
  }
  await con.query(`DROP DATABASE IF EXISTS \`${BD_PRUEBAS.database}\``);
  await con.query(`CREATE DATABASE \`${BD_PRUEBAS.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await con.end();
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'iemec-sql-'));
  for (const f of fs.readdirSync(SQL).filter((x) => /^00\d-.*\.sql$/.test(x))) fs.copyFileSync(path.join(SQL, f), path.join(carpeta, f));
  t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
  await migrar({ bd: BD_PRUEBAS, carpeta, log: () => {} });
  return { pool: crearPool({ database: BD_PRUEBAS.database }), carpeta };
}

test('los tokens de antes se migran: huella y cifrado, sin el claro, y su enlace sigue valiendo', async (t) => {
  const base009 = await baseHastaLa009(t);
  if (!base009) return;
  const { pool, carpeta } = base009;
  try {
    // Una cita de antes de esta vuelta, con su token en claro y sin sede.
    await pool.query("INSERT INTO clinica (id, nombre, nombre_corto) VALUES (1, 'IEMEC', 'IEMEC')");
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
    await pool.query("INSERT INTO tratamientos (id, nombre, familia, duracion_min) VALUES ('limpieza-facial', 'Limpieza facial', 'facial', 60)");
    await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-1', 'Cabina 1', 'cabina_estetica')");
    const [p] = await pool.query("INSERT INTO pacientes (nombre) VALUES ('Ana')");
    const antiguo = crypto.randomBytes(32).toString('base64url');
    const [c] = await pool.query(
      `INSERT INTO citas (paciente_id, tratamiento_id, sala_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token)
       VALUES (?, 'limpieza-facial', 1, '2026-10-06 15:00', '2026-10-06 16:00', '2026-10-06 15:00', '2026-10-06 16:10', '2026-10-06 15:00', '2026-10-06 16:00', 'confirmada', ?)`,
      [p.insertId, antiguo]);

    fs.copyFileSync(path.join(SQL, LA_010), path.join(carpeta, LA_010));
    assert.deepEqual(await migrar({ bd: BD_PRUEBAS, carpeta, log: () => {} }), [LA_010]);
    const [[fila]] = await pool.query('SELECT * FROM citas WHERE id = ?', [c.insertId]);
    assert.equal(fila.token_antiguo, null, 'el claro, fuera');
    assert.ok(!('token' in fila), 'y su columna ya no se llama así: nada vuelve a escribirla');
    assert.deepEqual(fila.token_hash, agenda.huellaToken(antiguo));
    assert.equal(agenda.tokenDe(fila), antiguo, 'cifrado: se le puede volver a mandar');
    assert.equal(fila.uid_ics, `cita-${c.insertId}@iemec-clinic.com`, 'conserva el UID que ya tienen los calendarios');
    assert.equal(new Date(fila.token_caduca_en).toISOString(), '2026-11-05T16:00:00.000Z');
    const [[sede]] = await pool.query('SELECT codigo, nombre, direccion, lat, lng, principal FROM sedes');
    assert.deepEqual({ ...sede, lat: Number(sede.lat), lng: Number(sede.lng) },
      { codigo: 'iemec', nombre: 'IEMEC', direccion: 'Av. Siglo XXI, 13, local 35', lat: 40.4066059, lng: -3.9001441, principal: 1 });
    assert.deepEqual(await migrar({ bd: BD_PRUEBAS, carpeta, log: () => {} }), [], 'otra pasada no hace nada');
    assert.equal(await agenda.cifrarTokensAntiguos(pool), 0);
    // Y las que vengan detrás en sql/ (las de otras vueltas): con ellas, la app entera.
    assert.ok(!(await migrar({ bd: BD_PRUEBAS, log: () => {} })).includes(LA_010));

    // El 1 de octubre, antes de su cita del 6.
    await conServidor(appConReloj(pool, new Date('2026-10-01T08:00:00Z')), async (base) => {
      const pag = await fetch(`${base}/c/${antiguo}`);
      assert.equal(pag.status, 200, 'el enlace que ya tenía sigue valiendo');
      assert.match(await pag.text(), /Av\. Siglo XXI, 13, local 35/, 'y su cita está en la sede de IEMEC');
      const ics = new ICAL.Event(new ICAL.Component(ICAL.parse(await (await fetch(`${base}/c/${antiguo}.ics`)).text())).getFirstSubcomponent('vevent'));
      assert.equal(ics.uid, `cita-${c.insertId}@iemec-clinic.com`);
      assert.equal(ics.location, `IEMEC, ${DIRECCION}`);
    });

    // Si migrar se lanza sin CLAVE_CIFRADO (fuera de las pruebas), no cifra con la de desarrollo: lo
    // avisa y deja el token como está (su enlace vale por la huella); la app lo cifra al usarlo.
    const otro = crypto.randomBytes(32).toString('base64url');
    const [c2] = await pool.query(
      `INSERT INTO citas (paciente_id, tratamiento_id, sala_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token_hash, token_antiguo)
       VALUES (?, 'limpieza-facial', 1, '2026-10-07 15:00', '2026-10-07 16:00', '2026-10-07 15:00', '2026-10-07 16:10', '2026-10-07 15:00', '2026-10-07 16:00', 'confirmada', ?, ?)`,
      [p.insertId, agenda.huellaToken(otro), otro]);
    const mensajes = [];
    assert.equal(await agenda.cifrarTokensAntiguos(pool, { log: (m) => mensajes.push(m), claveDeDesarrollo: false }), 0);
    assert.match(mensajes.join(), /1 enlaces de «Tu cita» de antes siguen sin cifrar: falta CLAVE_CIFRADO/);
    const [[sinCifrar]] = await pool.query('SELECT * FROM citas WHERE id = ?', [c2.insertId]);
    assert.equal(agenda.tokenDe(sinCifrar), otro, 'mientras, el panel sigue teniendo su enlace');
    assert.equal(await agenda.tokenParaEnviar(pool, c2.insertId), otro, 'al mandárselo, el mismo enlace…');
    const [[cifrada]] = await pool.query('SELECT * FROM citas WHERE id = ?', [c2.insertId]);
    assert.equal(cifrada.token_antiguo, null, '…ya cifrado con la clave de la app');
    assert.equal(agenda.tokenDe(cifrada), otro);
    assert.deepEqual(cifrada.token_hash, agenda.huellaToken(otro));

    // Cuando una migración de más adelante quite la columna del token en claro, el paso de migrar()
    // no se rompe: ya no hace nada.
    await pool.query('ALTER TABLE citas DROP COLUMN token_antiguo');
    assert.equal(await agenda.cifrarTokensAntiguos(pool), 0);
    assert.deepEqual(await migrar({ bd: BD_PRUEBAS, log: () => {} }), []);
  } finally {
    await pool.end();
  }
});

test('WhatsApp sin tratamiento: la confirmación de la IA, los avisos y las variables de las plantillas', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const dada = new Date('2026-10-13T08:00:00Z'); // martes 10:00: recepción le da cita para el jueves

    await t.test('con la ventana cerrada, las plantillas: mapa, día, hora y sede; dos botones de enlace; nunca el tratamiento', async () => {
      const p = await paciente(pool, 'Laura');
      const cita = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-15', hora: '17:00', origen: 'recepcion', ahora: dada });
      await avisos.enviarPendientes(deps, { ahora: mas(dada, 3) });
      const m = whatsapp.enviados.at(-1);
      assert.equal(m.nombre, 'iemec_cita_confirmada');
      assert.deepEqual(m.variables, ['Laura', 'jueves 15 de octubre', '17:00', SEDE]);
      // Tal cual lo pide la Cloud API: la ubicación de la sede arriba, el cuerpo y los dos botones.
      assert.deepEqual(m.componentes, [
        { type: 'header', parameters: [{ type: 'location', location: { latitude: '40.4066059', longitude: '-3.9001441', name: 'IEMEC', address: DIRECCION } }] },
        { type: 'body', parameters: ['Laura', 'jueves 15 de octubre', '17:00', SEDE].map((text) => ({ type: 'text', text })) },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: cita.token }] },
        { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: cita.token }] },
      ]);
      const [confirmacion] = await textos(pool, p.telefono);
      assert.equal(confirmacion, `[Mapa: IEMEC · ${DIRECCION}]\n`
        + `Hola Laura, tu cita está confirmada: jueves 15 de octubre a las 17:00, en ${SEDE}. Con los botones puedes añadirla a tu calendario y verla o cambiarla cuando quieras.\n\n`
        + `Añadir al calendario: https://agenda.iemec-clinic.com/cal/${cita.token}\nVer mi cita: https://agenda.iemec-clinic.com/c/${cita.token}`);

      await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-14T08:05:00Z') });
      assert.equal(whatsapp.enviados.at(-1).nombre, 'iemec_recordatorio_24h');
      assert.deepEqual(whatsapp.enviados.at(-1).botones, [], 'la víspera, solo respuestas rápidas (se ven también en el ordenador)');
      await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-15T13:05:00Z') });
      assert.equal(whatsapp.enviados.at(-1).nombre, 'iemec_recordatorio_2h');
      // Con un solo botón de enlace, en la conversación queda el enlace a secas (como siempre); con
      // dos, cada uno con lo que dice su botón.
      assert.equal((await textos(pool, p.telefono)).at(-1), `[Mapa: IEMEC · ${DIRECCION}]\n`
        + `Hola Laura, hoy a las 17:00 te esperamos en ${SEDE}. Si te surge algo, responde a este mensaje.\n\nhttps://agenda.iemec-clinic.com/c/${cita.token}`);

      const llegados = whatsapp.enviados.filter((x) => x.telefono === p.telefono);
      assert.equal(llegados.length, 3);
      for (const x of llegados) assert.doesNotMatch(JSON.stringify(x.variables), INTIMO, x.nombre);
      for (const x of await textos(pool, p.telefono)) assert.doesNotMatch(x, INTIMO, x);
    });

    await t.test('con la ventana abierta, los textos: tampoco lo nombran, y llevan los dos enlaces', async () => {
      const p = await paciente(pool, 'Marta');
      const cita = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-22', hora: '12:00', origen: 'telefono', ahora: dada });
      // Está escribiendo con la clínica: su ventana de 24 h está abierta.
      await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado, ventana_hasta) VALUES (?, ?, 'esperando_paciente', ?)", [p.telefono, p.id, mas(dada, 24 * 60)]);
      const ultimo = () => whatsapp.enviados.filter((m) => m.telefono === p.telefono).at(-1);
      await avisos.enviarPendientes(deps, { ahora: mas(dada, 3) });
      const token = cita.token;
      assert.equal(ultimo().texto,
        `Hola Marta, tu cita está confirmada: te esperamos el jueves 22 de octubre a las 12:00 en ${SEDE}.\n\n`
        + `Añádela a tu calendario con un toque: http://localhost:3004/cal/${token}\nPara verla, cambiarla o cancelarla: http://localhost:3004/c/${token}`);
      await pool.query("UPDATE conversaciones SET estado = 'esperando_paciente', ventana_hasta = ? WHERE telefono = ?", [new Date('2026-10-22T12:00:00Z'), p.telefono]);
      await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-21T08:05:00Z') });
      assert.equal(ultimo().texto, `Hola Marta, te esperamos mañana, jueves 22 de octubre, a las 12:00 en ${SEDE}. ¿Nos confirmas que vienes?\n\nTu cita: http://localhost:3004/c/${token}`);
      await pool.query("UPDATE conversaciones SET estado = 'esperando_paciente' WHERE telefono = ?", [p.telefono]);
      await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-22T08:05:00Z') });
      assert.equal(ultimo().texto, `Hola Marta, hoy a las 12:00 te esperamos en ${SEDE}. Si te surge algo, responde a este mensaje.\n\nTu cita: http://localhost:3004/c/${token}`);
      for (const x of await textos(pool, p.telefono)) assert.doesNotMatch(x, INTIMO, x);
    });

    await t.test('la confirmación de la IA dice el día, la hora y la sede; el tratamiento, no', async () => {
      const p = await paciente(pool, 'Nerea');
      const cita = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-23', hora: '12:00', origen: 'ia_whatsapp', ahora: dada });
      await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [dada, cita.id]); // la confirma la IA en su conversación
      const texto = R.textoCitaReservada(await R.datosCita(pool, cita.id), { nombre: 'Nerea' });
      assert.equal(texto, `¡Hecho, Nerea! Te esperamos el viernes 23 de octubre a las 12:00 en ${SEDE}.\n\n`
        + `Añádela a tu calendario con un toque: http://localhost:3004/cal/${cita.token}\nPara verla, cambiarla o cancelarla: http://localhost:3004/c/${cita.token}`);
    });

    await t.test('una cita que sustituye a otra: «ha cambiado, borra la anterior» (y si esa plantilla no está aprobada, la confirmación)', async () => {
      const p = await paciente(pool, 'Olga');
      const vieja = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-26', hora: '17:00', origen: 'recepcion', ahora: new Date('2026-10-10T08:00:00Z') });
      await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [new Date('2026-10-10T08:05:00Z'), vieja.id]);
      // Recepción le acepta un hueco antes (de la lista de espera): la nueva sustituye a la vieja.
      const nueva = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-19', hora: '17:00', origen: 'recepcion', reprograma: vieja.id, ahora: dada });
      await avisos.enviarPendientes(deps, { ahora: mas(dada, 3) });
      const a = (tel) => whatsapp.enviados.filter((x) => x.telefono === tel).at(-1);
      const m = a(p.telefono);
      assert.equal(m.nombre, 'iemec_cita_cambiada');
      assert.deepEqual(m.variables, ['Olga', 'lunes 19 de octubre', '17:00', SEDE]);
      assert.deepEqual(m.botones.map((b) => b.valor), [nueva.token, nueva.token]);
      assert.match((await textos(pool, p.telefono)).at(-1), /Si tenías la anterior en tu calendario, bórrala y añade esta con el botón\./);

      await pool.query("UPDATE plantillas SET estado = 'pausada' WHERE uso = 'cita_cambiada'");
      const q = await paciente(pool, 'Pilar');
      const v2 = await agenda.reservar(pool, { pacienteId: q.id, tratamientoId: 'laser-intimo', fecha: '2026-10-27', hora: '17:00', origen: 'recepcion', ahora: new Date('2026-10-10T08:00:00Z') });
      await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [new Date('2026-10-10T08:05:00Z'), v2.id]);
      await agenda.reservar(pool, { pacienteId: q.id, tratamientoId: 'laser-intimo', fecha: '2026-10-20', hora: '17:00', origen: 'recepcion', reprograma: v2.id, ahora: dada });
      await avisos.enviarPendientes(deps, { ahora: mas(dada, 4) });
      assert.equal(a(q.telefono).nombre, 'iemec_cita_confirmada');
    });
  } finally {
    await pool.end();
  }
});

test('la víspera: sus dos respuestas rápidas llegan por el webhook y se entienden; un «sí» o un «no» a secas, también', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const SECRETO = 'secreto-app-whatsapp-de-pruebas-calendario';
  const antes = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = SECRETO;
  t.after(() => { if (antes === undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET = antes; });
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const dada = new Date('2026-10-12T08:00:00Z');
    const vispera = new Date('2026-10-14T08:05:00Z'); // miércoles 10:05: la víspera de las citas del jueves
    const contesta = new Date('2026-10-14T09:00:00Z');
    let n = 0;
    await conServidor(crearApp({ pool, reloj: () => contesta }), async (base) => {
      // Lo que manda WhatsApp cuando toca un botón de la plantilla (o escribe), firmado como Meta.
      const llega = async (telefono, mensaje) => {
        const cuerpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA-PRUEBA', changes: [{ field: 'messages', value: {
          messaging_product: 'whatsapp', metadata: { phone_number_id: 'NUM-PRUEBA' }, contacts: [],
          messages: [{ from: telefono.slice(1), id: `wamid.CALENDARIO${++n}`, timestamp: String(Math.floor(contesta.getTime() / 1000)), ...mensaje }],
        } }] }] });
        const firma = `sha256=${crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('hex')}`;
        const r = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma }, body: cuerpo });
        assert.equal(r.status, 200);
        const hecho = await entrada.procesarPendientes(deps, { ahora: mas(contesta, 1) });
        assert.equal(hecho.fallidos + hecho.reintentos, 0);
        return whatsapp.enviados.filter((m) => m.telefono === telefono).at(-1);
      };
      const boton = (texto) => ({ type: 'button', button: { text: texto, payload: texto } });
      const escribe = (texto) => ({ type: 'text', text: { body: texto } });
      const conVispera = async (nombre, hora) => {
        const p = await paciente(pool, nombre);
        const c = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-15', hora, origen: 'recepcion', ahora: dada });
        await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [dada, c.id]);
        return { ...p, cita: c };
      };
      const confirmadas = async (citaId) => (await pool.query("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'cita_confirmada_paciente' AND entidad_id = ?", [String(citaId)]))[0][0].n;

      const laura = await conVispera('Laura', '12:00');
      const marta = await conVispera('Marta', '13:30');
      const nuria = await conVispera('Nuria', '15:00');
      const olga = await conVispera('Olga', '16:30');
      const pilar = await conVispera('Pilar', '18:00');
      const r = await avisos.enviarPendientes(deps, { ahora: vispera });
      assert.deepEqual(r.map((x) => x.tipo), ['vispera', 'vispera', 'vispera', 'vispera', 'vispera']);
      const v = whatsapp.enviados.at(-1);
      assert.equal(v.nombre, 'iemec_recordatorio_24h');
      assert.deepEqual(BIBLIOTECA.find((b) => b.nombre === v.nombre).botones.map((b) => b.texto), ['Sí, allí estaré', 'Necesito cambiarla']);

      const a = await llega(laura.telefono, boton('Sí, allí estaré'));
      assert.equal(a.texto, '¡Perfecto, Laura! Queda confirmada: te esperamos el jueves 15 de octubre a las 12:00.');
      assert.equal(await confirmadas(laura.cita.id), 1);

      const b = await llega(marta.telefono, boton('Necesito cambiarla'));
      assert.match(b.texto, /Sin problema, Marta\. Te cambio la cita del jueves 15 de octubre a las 13:30: te puedo ofrecer .+¿Cuál te viene mejor\?/);
      const [[conv]] = await pool.query('SELECT reprograma_cita_id FROM conversaciones WHERE telefono = ?', [marta.telefono]);
      assert.equal(conv.reprograma_cita_id, marta.cita.id);

      const c = await llega(nuria.telefono, escribe('Sí'));
      assert.equal(c.texto, '¡Perfecto, Nuria! Queda confirmada: te esperamos el jueves 15 de octubre a las 15:00.', 'un «sí» a secas contesta a la víspera');
      assert.equal(await confirmadas(nuria.cita.id), 1);

      const d = await llega(olga.telefono, escribe('No'));
      assert.match(d.texto, /¿Cancelo tu cita del jueves 15 de octubre a las 16:30, Olga\? Si lo prefieres, te la cambio a otro día\./);
      const [[sigue]] = await pool.query('SELECT estado FROM citas WHERE id = ?', [olga.cita.id]);
      assert.equal(sigue.estado, 'confirmada', 'sin su «sí», no se cancela');

      // «Sí, pero…»: confirmada, y lo que añade lo lee una persona (no se pierde).
      const e = await llega(pilar.telefono, escribe('Sí, pero llegaré 15 minutos tarde'));
      assert.equal(e.texto, '¡Perfecto, Pilar! Queda confirmada: te esperamos el jueves 15 de octubre a las 18:00. Una persona del equipo lee lo que nos cuentas y te contesta por aquí si hace falta.');
      assert.equal(await confirmadas(pilar.cita.id), 1);
      const [[cp]] = await pool.query('SELECT id, estado FROM conversaciones WHERE telefono = ?', [pilar.telefono]);
      assert.equal(cp.estado, 'espera_persona');
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [cp.id]);
      assert.equal(tarea.titulo, 'Confirma su cita del jueves 15 de octubre a las 18:00 y añade algo: leer su mensaje');
    });
  } finally {
    await pool.end();
  }
});

test('su «sí» a la víspera (o su «gracias») en una conversación con algo pendiente no la cierra: el seguimiento sale a su hora', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const dada = new Date('2026-10-09T08:00:00Z'); // viernes: recepción le da cita para el jueves 15
    const lunes = new Date('2026-10-19T08:00:00Z'); // «te escribimos el lunes» por su presupuesto
    // Habla con la clínica de otra cosa (un presupuesto) y quedaron en escribirle el lunes 19.
    const conAlgoPendiente = async (nombre, hora) => {
      const p = await paciente(pool, nombre);
      const [cv] = await pool.query(
        "INSERT INTO conversaciones (telefono, paciente_id, contexto, estado, proximo_paso, proximo_paso_en) VALUES (?, ?, 'general', 'esperando_paciente', 'seguimiento', ?)",
        [p.telefono, p.id, lunes]);
      const [s] = await pool.query(
        "INSERT INTO seguimientos (paciente_id, conversacion_id, contexto, motivo, plazo_tipo, programado_para, creado_por, creado_en) VALUES (?, ?, 'general', 'como_quedamos', 'fecha', ?, 'ia', ?)",
        [p.id, cv.insertId, lunes, dada]);
      const c = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-15', hora, origen: 'recepcion', ahora: dada });
      await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [dada, c.id]);
      return { ...p, conv: cv.insertId, seguimiento: s.insertId, cita: c };
    };
    const estado = async (convId) => (await pool.query('SELECT estado, proximo_paso FROM conversaciones WHERE id = ?', [convId]))[0][0];
    const laura = await conAlgoPendiente('Laura', '12:00');
    const marta = await conAlgoPendiente('Marta', '16:00');

    // Marta, el martes, escribe por su cita (sin que le hayamos preguntado nada).
    const m = await R.procesarEntrante(deps, { telefono: marta.telefono, texto: 'Confirmo la cita del jueves, gracias', ahora: new Date('2026-10-13T09:00:00Z') });
    assert.equal(m.sobreCita, 'confirma');
    assert.deepEqual({ ...(await estado(marta.conv)) }, { estado: 'esperando_paciente', proximo_paso: 'seguimiento' }, 'lo del presupuesto sigue en marcha');

    // La víspera entra en su conversación (que tiene algo pendiente: no se cierra) y Laura dice «Sí».
    const vispera = new Date('2026-10-14T08:05:00Z');
    assert.deepEqual((await avisos.enviarPendientes(deps, { ahora: vispera })).map((x) => [x.citaId, x.tipo]), [[laura.cita.id, 'vispera'], [marta.cita.id, 'vispera']]);
    assert.equal((await estado(laura.conv)).estado, 'esperando_paciente');
    const l = await R.procesarEntrante(deps, { telefono: laura.telefono, texto: 'Sí', ahora: mas(vispera, 30) });
    assert.equal(l.conversacionId, laura.conv);
    assert.equal(l.respuesta, '¡Perfecto, Laura! Queda confirmada: te esperamos el jueves 15 de octubre a las 12:00.');
    assert.deepEqual({ ...(await estado(laura.conv)) }, { estado: 'esperando_paciente', proximo_paso: 'seguimiento' }, 'confirma la cita, pero la conversación sigue abierta');

    // El lunes, el «como quedamos» de los dos sale (no se pierde con la conversación cerrada).
    const r = await R.procesarSeguimientos(deps, { ahora: lunes });
    for (const x of [laura, marta]) {
      const hecho = r.find((y) => y.id === x.seguimiento);
      assert.ok(hecho?.envio, `${x.telefono}: ${JSON.stringify(hecho)}`);
      assert.equal(hecho.envio.estado, 'enviado');
    }

    // Sin nada pendiente, su «sí» sí cierra la conversación «con cita» (como hasta ahora).
    const nuria = await paciente(pool, 'Nuria');
    const cn = await agenda.reservar(pool, { pacienteId: nuria.id, tratamientoId: 'laser-intimo', fecha: '2026-10-22', hora: '12:00', origen: 'recepcion', ahora: dada });
    await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [dada, cn.id]);
    await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-21T08:05:00Z') });
    const n = await R.procesarEntrante(deps, { telefono: nuria.telefono, texto: 'Sí', ahora: new Date('2026-10-21T09:00:00Z') });
    assert.deepEqual({ ...(await estado(n.conversacionId)) }, { estado: 'cerrada', proximo_paso: 'cita' });
  } finally {
    await pool.end();
  }
});

test('un hueco de la lista de espera, confirmado desde «Tu cita»: acepta la oferta, cambia la cita que tenía y le avisa de que ha cambiado', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const dada = new Date('2026-10-13T08:00:00Z');
    const a = await paciente(pool, 'Alicia');
    const b = await paciente(pool, 'Berta');
    const deA = await agenda.reservar(pool, { pacienteId: a.id, tratamientoId: 'laser-intimo', fecha: '2026-10-15', hora: '17:00', origen: 'recepcion', ahora: dada });
    const deB = await agenda.reservar(pool, { pacienteId: b.id, tratamientoId: 'laser-intimo', fecha: '2026-10-19', hora: '12:00', origen: 'recepcion', ahora: dada });
    await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id IN (?)', [dada, [deA.id, deB.id]]);
    await LE.apuntar(pool, { pacienteId: b.id, tratamientoId: 'laser-intimo', citaActualId: deB.id, origen: 'panel', creadoPor: 'recepcion@prueba', ahora: dada });

    const ahora = new Date('2026-10-14T08:00:00Z');
    await agenda.cancelar(pool, { id: deA.id, por: 'paciente', ahora });
    assert.equal((await espera.vuelta(deps, { ahora: mas(ahora, 1) })).ofrecidas, 1);
    const aviso = whatsapp.enviados.filter((x) => x.telefono === b.telefono).at(-1);
    assert.equal(aviso.nombre, 'iemec_hueco_liberado');
    // Cómo se nombra el tratamiento en la oferta ({{2}}) es cosa de la lista de espera y la repesca
    // (servidor/avisos-espera.js): aquí, el resto.
    assert.deepEqual([aviso.variables[0], ...aviso.variables.slice(2)], ['Berta', 'jueves 15 de octubre', '17:00']);
    const [[oferta]] = await pool.query('SELECT * FROM lista_espera_ofertas');
    const [[retenida]] = await pool.query('SELECT * FROM citas WHERE id = ?', [oferta.cita_id]);
    assert.equal(retenida.estado, 'retenida');
    const token = agenda.tokenDe(retenida);

    await conServidor(appConReloj(pool, mas(ahora, 5), deps), async (base) => {
      const pag = await (await fetch(`${base}/c/${token}`)).text();
      assert.match(pag, /<h1>Confirma tu cita<\/h1>/);
      assert.match(pag, /Al confirmarla, tu cita del lunes 19 de octubre, a las 12:00 queda anulada\./);
      const conf = await (await fetch(`${base}/c/${token}/confirmar`, { method: 'POST' })).text();
      assert.match(conf, /Cita confirmada\. ¡Te esperamos!/);
      assert.match(conf, /Añadir a tu calendario/);
    });
    const [[o]] = await pool.query('SELECT estado FROM lista_espera_ofertas WHERE id = ?', [oferta.id]);
    assert.equal(o.estado, 'aceptada', 'la oferta, aceptada como si hubiera dicho que sí por WhatsApp');
    const [[vieja]] = await pool.query('SELECT estado, reprograma_a_id FROM citas WHERE id = ?', [deB.id]);
    assert.deepEqual({ ...vieja }, { estado: 'reprogramada', reprograma_a_id: retenida.id });

    // Y el aviso: «tu cita ha cambiado, borra la anterior de tu calendario».
    await avisos.enviarPendientes(deps, { ahora: mas(ahora, 10) });
    const m = whatsapp.enviados.filter((x) => x.telefono === b.telefono).at(-1);
    assert.equal(m.nombre, 'iemec_cita_cambiada');
    assert.deepEqual(m.variables, ['Berta', 'jueves 15 de octubre', '17:00', SEDE]);
    assert.deepEqual(m.botones.map((x) => x.valor), [token, token]);
  } finally {
    await pool.end();
  }
});

test('un aviso que no saldría bien (plantilla aprobada de otra versión, sede sin coordenadas) no sale: queda una tarea', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const dada = new Date('2026-10-12T08:00:00Z');
    // La víspera que se aprobó con el texto de antes (dos datos: nombre y hora).
    await pool.query("UPDATE plantillas SET cuerpo = 'Hola {{1}}, te esperamos mañana a las {{2}} en IEMEC. ¿Nos lo confirmas?' WHERE uso = 'cita_recordatorio_24h'");
    const p = await paciente(pool, 'Sonia');
    const c = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-15', hora: '17:00', origen: 'recepcion', ahora: dada });
    await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [dada, c.id]);
    const r = await avisos.enviarPendientes(deps, { ahora: new Date('2026-10-14T08:05:00Z') });
    assert.deepEqual(r.map((x) => [x.tipo, x.fallido]), [['vispera', 'la plantilla aprobada lleva 2 datos y el aviso manda 4: es de otra versión']]);
    assert.deepEqual(whatsapp.enviados.filter((m) => m.telefono === p.telefono), [], 'no le llega «mañana a las martes 6 de octubre»');
    const [[t1]] = await pool.query("SELECT titulo FROM tareas WHERE paciente_id = ? AND estado = 'abierta'", [p.id]);
    assert.match(t1.titulo, /^No sale el aviso de la cita \(la plantilla aprobada lleva 2 datos .+\): avisar a mano$/);

    // Una sede sin coordenadas: la confirmación lleva el mapa, así que tampoco sale.
    await pool.query('UPDATE sedes SET lat = NULL, lng = NULL');
    const q = await paciente(pool, 'Tere');
    await agenda.reservar(pool, { pacienteId: q.id, tratamientoId: 'laser-intimo', fecha: '2026-10-16', hora: '17:00', origen: 'recepcion', ahora: dada });
    const r2 = await avisos.enviarPendientes(deps, { ahora: mas(dada, 3) });
    assert.deepEqual(r2.map((x) => [x.tipo, x.fallido]), [['confirmacion', 'la sede no tiene coordenadas para el mapa']]);
    assert.deepEqual(whatsapp.enviados.filter((m) => m.telefono === q.telefono), []);
  } finally {
    await pool.end();
  }
});

test('un hueco de la lista de espera, desde «Tu cita»: «No me viene bien» lo suelta para el siguiente', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const dada = new Date('2026-10-13T08:00:00Z');
    const a = await paciente(pool, 'Carla');
    const b = await paciente(pool, 'Diana');
    const deA = await agenda.reservar(pool, { pacienteId: a.id, tratamientoId: 'laser-intimo', fecha: '2026-10-15', hora: '17:00', origen: 'recepcion', ahora: dada });
    const { id: entradaB } = await LE.apuntar(pool, { pacienteId: b.id, tratamientoId: 'laser-intimo', origen: 'panel', creadoPor: 'recepcion@prueba', ahora: dada });
    const ahora = new Date('2026-10-14T08:00:00Z');
    await agenda.cancelar(pool, { id: deA.id, por: 'paciente', ahora });
    await espera.vuelta(deps, { ahora: mas(ahora, 1) });
    const [[oferta]] = await pool.query('SELECT * FROM lista_espera_ofertas');
    const [[retenida]] = await pool.query('SELECT * FROM citas WHERE id = ?', [oferta.cita_id]);
    const token = agenda.tokenDe(retenida);
    await conServidor(appConReloj(pool, mas(ahora, 5), deps), async (base) => {
      const pag = await (await fetch(`${base}/c/${token}`)).text();
      assert.match(pag, new RegExp(`action="/c/${token}/cancelar"><button class="btn" type="submit">No me viene bien</button>`));
      const no = await (await fetch(`${base}/c/${token}/cancelar`, { method: 'POST' })).text();
      assert.match(no, /De acuerdo: el hueco queda libre para otra persona\. Sigues en la lista de espera/);
      // Nunca fue su cita (no la confirmó, ni tuvo con qué añadirla a su calendario): ni «Cita
      // cancelada» ni «bórrala de tu calendario».
      for (const html of [no, await (await fetch(`${base}/c/${token}`)).text()]) {
        assert.match(html, /<h1>Hueco liberado<\/h1>/);
        assert.doesNotMatch(html, /Cita cancelada|Esta cita está cancelada|calendario/);
      }
      assert.match(await (await fetch(`${base}/c/${token}`)).text(), /No reservaste este hueco: ha quedado libre para otra persona\. Sigues en la lista de espera/);
      // Un doble toque en «No me viene bien»: lo mismo, sin error.
      const otraVez = await (await fetch(`${base}/c/${token}/cancelar`, { method: 'POST' })).text();
      assert.match(otraVez, /De acuerdo: el hueco queda libre para otra persona\./);
      assert.doesNotMatch(otraVez, /No se ha podido/);
    });
    const [[o]] = await pool.query('SELECT estado FROM lista_espera_ofertas WHERE id = ?', [oferta.id]);
    assert.equal(o.estado, 'rechazada');
    const [[le]] = await pool.query('SELECT estado FROM lista_espera WHERE id = ?', [entradaB]);
    assert.equal(le.estado, 'esperando', 'sigue en la lista');
    const [[suelta]] = await pool.query('SELECT estado FROM citas WHERE id = ?', [retenida.id]);
    assert.equal(suelta.estado, 'cancelada', 'el hueco, libre para el siguiente');
  } finally {
    await pool.end();
  }
});

test('cambiar de cabina en la misma sede no toca el calendario del paciente ni le avisa', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const p = await paciente(pool, 'Rosa');
    const dada = new Date('2026-10-13T08:00:00Z');
    const cita = await agenda.reservar(pool, { pacienteId: p.id, tratamientoId: 'laser-intimo', fecha: '2026-10-16', hora: '12:00', origen: 'recepcion', ahora: dada });
    await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [mas(dada, 3), cita.id]);
    const ahora = mas(dada, 60);
    await conServidor(appConReloj(pool, ahora), async (base) => {
      const ics = async () => (await (await fetch(`${base}/c/${cita.token}.ics`)).text()).replace(/DTSTAMP:\S+/, 'DTSTAMP');
      const antes = await ics();
      await pool.query('UPDATE citas SET sala_id = ? WHERE id = ?', [cita.salaId === 1 ? 2 : 1, cita.id]);
      assert.equal(await ics(), antes, 'mismo UID, misma SEQUENCE y la misma sede: la cabina no va en el .ics');
      assert.match(antes, /UID:[0-9a-f-]{36}\r\n/);
    });
    assert.deepEqual((await avisos.pendientes(pool, ahora)).filter((a) => a.id === cita.id), [], 'ni aviso');
  } finally {
    await pool.end();
  }
});
