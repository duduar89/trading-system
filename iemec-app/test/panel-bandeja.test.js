'use strict';
// Escribir desde la bandeja del panel. Con la ventana de 24 h abierta, texto libre: la ruta de enviar
// no la tapa la de «tomar» y «devolver» (antes contestaba 404 «Acción desconocida» y desde el panel no
// se podía escribir). Con la ventana cerrada, plantilla con todas sus variables (si no, al paciente le
// llegaría «{{2}}» y Meta la rechaza), el nombre con que se le saluda propuesto por el panel, y nunca
// las que llevan el enlace de una cita o de una reseña, que las manda la app sola.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { rutasPanel } = require('../servidor/rutas/panel');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}/api/panel`); } finally { s.close(); }
}

test('la bandeja escribe: texto con la ventana abierta y plantilla completa con ella cerrada', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const ahora = new Date('2026-10-06T10:05:00Z'); // martes, 12:05 en Madrid
  try {
    for (const p of BIBLIOTECA) {
      await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
        [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones || []), JSON.stringify(p.ejemplos || [])]);
    }
    const [lead] = await pool.query("INSERT INTO leads (telefono, nombre, origen) VALUES ('+34611000301', 'rocío pérez 🌸', 'meta_formulario')");
    const [abierta] = await pool.query("INSERT INTO conversaciones (telefono, lead_id, estado, ventana_hasta) VALUES ('+34611000301', ?, 'espera_persona', ?)",
      [lead.insertId, new Date(ahora.getTime() + 3 * 3600000)]);
    const [paciente] = await pool.query("INSERT INTO pacientes (nombre, apellidos, telefono) VALUES ('Sara', 'Ejemplo', '+34611000302')");
    const [cerrada] = await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado, ventana_hasta) VALUES ('+34611000302', ?, 'esperando_paciente', ?)",
      [paciente.insertId, new Date(ahora.getTime() - 3600000)]);
    const [plantillas] = await pool.query('SELECT id, uso FROM plantillas');
    const plantilla = Object.fromEntries(plantillas.map((p) => [p.uso, p.id]));

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ahora = ahora; req.usuario = { email: 'recepcion@ejemplo.com' }; next(); });
    app.use('/api/panel', rutasPanel({ pool, deps: { pool, ia: crearIa('simulado'), whatsapp } }));
    await conServidor(app, async (api) => {
      const post = async (ruta, cuerpo) => {
        const r = await fetch(`${api}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
        return { status: r.status, cuerpo: await r.json() };
      };
      const estado = async (id) => (await pool.query('SELECT estado FROM conversaciones WHERE id = ?', [id]))[0][0].estado;

      await t.test('con la ventana abierta, texto libre: sale y la conversación pasa a la persona', async () => {
        const r = await post(`/conversaciones/${abierta.insertId}/enviar`, { texto: 'Hola, soy de recepción: te llamo en un rato.' });
        assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
        assert.equal(r.cuerpo.estado, 'enviado');
        assert.deepEqual({ ...whatsapp.enviados.at(-1), waId: null }, { waId: null, telefono: '+34611000301', tipo: 'texto', texto: 'Hola, soy de recepción: te llamo en un rato.' });
        assert.equal(await estado(abierta.insertId), 'persona');
        // «Tomar», «devolver» y «cerrar» siguen en su ruta, y lo demás sigue sin existir.
        assert.equal((await post(`/conversaciones/${abierta.insertId}/devolver`, {})).status, 200);
        assert.equal(await estado(abierta.insertId), 'ia_activa');
        assert.equal((await post(`/conversaciones/${abierta.insertId}/volar`, {})).status, 404);
      });

      await t.test('con la ventana cerrada, texto no; y el panel sabe qué plantillas puede mandar y con qué nombre saludar', async () => {
        const r = await post(`/conversaciones/${cerrada.insertId}/enviar`, { texto: 'Hola' });
        assert.deepEqual([r.status, r.cuerpo.codigo], [409, 'VENTANA_CERRADA']);
        const lista = await (await fetch(`${api}/plantillas`)).json();
        const deUso = (uso) => lista.find((p) => p.uso === uso);
        assert.equal(deUso('cita_confirmacion').aMano, false, 'lleva el enlace de «Tu cita»');
        assert.equal(deUso('resena').aMano, false, 'lleva el enlace de la reseña');
        assert.equal(deUso('como_quedamos').aMano, true);
        assert.deepEqual(deUso('como_quedamos').ejemplos, ['Laura', 'tu tratamiento facial']);
        assert.equal((await (await fetch(`${api}/conversaciones/${abierta.insertId}`)).json()).saludo, 'Rocío', 'el de pila del lead, limpio');
        assert.equal((await (await fetch(`${api}/conversaciones/${cerrada.insertId}`)).json()).saludo, 'Sara', 'el de su ficha');
      });

      await t.test('una plantilla sale solo con todas sus variables, y nunca una de las que manda la app', async () => {
        const antes = whatsapp.enviados.length;
        const falta = await post(`/conversaciones/${cerrada.insertId}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Sara'] });
        assert.deepEqual([falta.status, falta.cuerpo.codigo, falta.cuerpo.error], [400, 'FALTAN_VARIABLES', 'Falta rellenar {{2}} de la plantilla']);
        const vacia = await post(`/conversaciones/${cerrada.insertId}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Sara', '   '] });
        assert.equal(vacia.cuerpo.codigo, 'FALTAN_VARIABLES');
        const sola = await post(`/conversaciones/${cerrada.insertId}/enviar`, { plantillaId: plantilla.resena, variables: ['Sara'] });
        assert.deepEqual([sola.status, sola.cuerpo.codigo], [400, 'PLANTILLA_AUTOMATICA']);
        assert.equal(whatsapp.enviados.length, antes, 'no ha salido nada');

        const ok = await post(`/conversaciones/${cerrada.insertId}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Sara', ' tu limpieza\n  facial '] });
        assert.equal(ok.status, 200, JSON.stringify(ok.cuerpo));
        const enviado = whatsapp.enviados.at(-1);
        assert.deepEqual([enviado.tipo, enviado.nombre, enviado.variables], ['plantilla', 'iemec_como_quedamos', ['Sara', 'tu limpieza facial']]);
        const { mensajes } = await (await fetch(`${api}/conversaciones/${cerrada.insertId}`)).json();
        assert.equal(mensajes.at(-1).texto, 'Hola Sara, como quedamos, te escribo para buscarte hueco para tu limpieza facial. ¿Te viene bien esta semana o la que viene? Si no quieres recibir más mensajes como este, responde BAJA.');
        assert.deepEqual([mensajes.at(-1).autor, mensajes.at(-1).tipo], ['persona', 'plantilla']);
      });
    });
  } finally {
    await pool.end();
  }
});
