'use strict';
// La cita que le llega al paciente: página, .ics para su calendario, confirmar y cancelar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { crearApp } = require('../servidor/index');
const agenda = require('../servidor/agenda');

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

test('la cita del paciente, de WhatsApp a su calendario', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, cp, municipio, lat, lng, whatsapp, google_place_id) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', '28660', 'Boadilla del Monte', 40.4054, -3.8732, '+34722833285', 'ChIJiemec')");
    for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
    await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'consulta-1', 'Consulta 1', 'consulta_medica')");
    await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (10, 'medico-1', 'Dra. Ejemplo', 'medico')");
    for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (10, ?, '11:00', '20:00')", [d]);
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
    await pool.query("INSERT INTO tratamientos (id, nombre, familia, duracion_min, rol_profesional, sala_tipo, regimen_legal) VALUES ('valoracion-facial', 'Valoración facial', 'facial', 45, 'medico', 'consulta_medica', 'servicio')");
    const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Laura', '+34611000200')");
    const cita = await agenda.reservar(pool, { pacienteId: p.insertId, tratamientoId: 'valoracion-facial', fecha: '2026-10-06', hora: '17:00', retener: false, ahora: new Date('2026-09-29T08:00:00Z') });

    await conServidor(crearApp({ pool }), async (base) => {
      const pag = await fetch(`${base}/c/${cita.token}`);
      assert.equal(pag.status, 200);
      const html = await pag.text();
      assert.match(html, /martes 6 de octubre, a las 17:00/);
      assert.match(html, /Añadir a mi calendario/);
      assert.match(html, /calendar\.google\.com/);
      assert.match(html, />Google<\/a>/);
      assert.match(html, /noindex/);

      const ics = await fetch(`${base}/c/${cita.token}.ics`);
      assert.equal(ics.headers.get('content-type'), 'text/calendar; charset=utf-8');
      const cuerpo = await ics.text();
      assert.match(cuerpo, /DTSTART:20261006T150000Z/);
      assert.match(cuerpo, /DTEND:20261006T154500Z/);
      assert.match(cuerpo, /LOCATION:IEMEC\\, Av\. Siglo XXI 13\\, local 35\\, 28660 Boadilla del Monte/);

      assert.equal((await fetch(`${base}/c/noexiste`)).status, 404);
      assert.equal((await fetch(`${base}/c/${'x'.repeat(43)}`)).status, 404);

      const conf = await (await fetch(`${base}/c/${cita.token}/confirmar`, { method: 'POST' })).text();
      assert.match(conf, /Cita confirmada/);
      const canc = await (await fetch(`${base}/c/${cita.token}/cancelar`, { method: 'POST' })).text();
      assert.match(canc, /Cita cancelada/);
      const ics2 = await (await fetch(`${base}/c/${cita.token}.ics`)).text();
      assert.match(ics2, /STATUS:CANCELLED/);
      assert.match(ics2, /SEQUENCE:1/);

      const r = await fetch(`${base}/r/abcdefghijklmnopqrstuv`, { redirect: 'manual' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), 'https://search.google.com/local/writereview?placeid=ChIJiemec');
    });
  } finally {
    await pool.end();
  }
});
