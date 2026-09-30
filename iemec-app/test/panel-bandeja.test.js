'use strict';
// Escribir desde la bandeja del panel. Con la ventana de 24 h abierta, texto libre: la ruta de enviar
// no la tapa la de «tomar» y «devolver» (antes contestaba 404 «Acción desconocida» y desde el panel no
// se podía escribir). Con la ventana cerrada, plantilla con todas sus variables (si no, al paciente le
// llegaría «{{2}}» y Meta la rechaza), el nombre con que se le saluda propuesto por el panel, y nunca
// las que manda la app sola (el enlace de una cita o de una reseña, el hueco de la lista de espera).
// Lo que miran los envíos automáticos, también a mano: nada comercial a quien pidió la baja (en su ficha
// o en la lista de bajas) o no dio su consentimiento, y lo escrito en las variables pasa el filtro de
// publicidad sanitaria.
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
  const hace = (horas) => new Date(ahora.getTime() - horas * 3600000);
  try {
    for (const p of BIBLIOTECA) {
      await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
        [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones || []), JSON.stringify(p.ejemplos || [])]);
    }
    const [lead] = await pool.query("INSERT INTO leads (telefono, nombre, origen) VALUES ('+34611000301', 'rocío pérez 🌸', 'meta_formulario')");
    const [abierta] = await pool.query("INSERT INTO conversaciones (telefono, lead_id, estado, ventana_hasta) VALUES ('+34611000301', ?, 'espera_persona', ?)",
      [lead.insertId, new Date(ahora.getTime() + 3 * 3600000)]);
    // Con la ventana cerrada: un paciente con una conversación de hace más de 24 h.
    const paciente = async (nombre, telefono, { cliente = false, consiente = true, baja = null, estado = 'esperando_paciente', motivo = null } = {}) => {
      const [p] = await pool.query('INSERT INTO pacientes (nombre, apellidos, telefono, es_cliente, baja_comercial_en) VALUES (?, ?, ?, ?, ?)', [nombre, 'Ejemplo', telefono, cliente, baja]);
      if (consiente != null) {
        await pool.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente, registrado_en) VALUES (?, 'whatsapp_marketing', ?, 'recepcion', ?)",
          [p.insertId, consiente ? 'otorgado' : 'revocado', hace(24 * 30)]);
      }
      const [c] = await pool.query('INSERT INTO conversaciones (telefono, paciente_id, estado, motivo_cierre, ventana_hasta) VALUES (?, ?, ?, ?, ?)',
        [telefono, p.insertId, estado, motivo, hace(1)]);
      return c.insertId;
    };
    const cerrada = await paciente('Sara', '+34611000302');
    // Pidió la baja: su ficha la tiene, su consentimiento está revocado y su conversación se cerró por eso.
    const conBaja = await paciente('Pablo', '+34611000303', { cliente: true, consiente: false, baja: hace(48), estado: 'cerrada', motivo: 'baja' });
    // Ni es cliente ni ha dado su consentimiento para mensajes comerciales.
    const sinConsentimiento = await paciente('Eva', '+34611000304', { consiente: null });
    // Su nombre dice «milagr…» (el filtro lo lee como una promesa), pero es el de su ficha.
    const milagros = await paciente('Milagros', '+34611000305');
    // Un lead que pidió la baja por WhatsApp: está en la lista de bajas, no en ninguna ficha.
    const [leadBaja] = await pool.query("INSERT INTO leads (telefono, nombre, origen) VALUES ('+34611000306', 'Luis', 'web_whatsapp')");
    await pool.query("INSERT INTO bajas_comerciales (telefono, fuente, lead_id) VALUES ('+34611000306', 'whatsapp', ?)", [leadBaja.insertId]);
    const [enLista] = await pool.query("INSERT INTO conversaciones (telefono, lead_id, estado, motivo_cierre, ventana_hasta) VALUES ('+34611000306', ?, 'cerrada', 'baja', ?)",
      [leadBaja.insertId, hace(1)]);
    const [plantillas] = await pool.query('SELECT id, uso FROM plantillas');
    const plantilla = Object.fromEntries(plantillas.map((p) => [p.uso, p.id]));
    // Las variables de una plantilla con el nombre que se quiera y los ejemplos de la biblioteca en el
    // resto (el recordatorio de la víspera lleva el día, la hora…: las que tenga).
    const conEjemplos = (uso, nombre) => [nombre, ...BIBLIOTECA.find((p) => p.uso === uso).ejemplos.slice(1)];

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ahora = ahora; req.usuario = { email: 'recepcion@ejemplo.com', rol: 'recepcion' }; next(); });
    app.use('/api/panel', rutasPanel({ pool, deps: { pool, ia: crearIa('simulado'), whatsapp } }));
    await conServidor(app, async (api) => {
      const post = async (ruta, cuerpo) => {
        const r = await fetch(`${api}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
        return { status: r.status, cuerpo: await r.json() };
      };
      const ver = async (id) => (await fetch(`${api}/conversaciones/${id}`)).json();
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
        const r = await post(`/conversaciones/${cerrada}/enviar`, { texto: 'Hola' });
        assert.deepEqual([r.status, r.cuerpo.codigo], [409, 'VENTANA_CERRADA']);
        const lista = await (await fetch(`${api}/plantillas`)).json();
        const deUso = (uso) => lista.find((p) => p.uso === uso);
        assert.equal(deUso('cita_confirmacion').aMano, false, 'lleva el enlace de «Tu cita»');
        assert.equal(deUso('resena').aMano, false, 'lleva el enlace de la reseña');
        assert.equal(deUso('hueco_liberado').aMano, false, 'su «Sí, guárdamelo» se liga a una oferta de la lista de espera');
        assert.equal(deUso('como_quedamos').aMano, true);
        assert.equal(deUso('cita_recordatorio_24h').aMano, true, '«Confirmo» confirma su cita aunque lo mande recepción');
        assert.deepEqual(deUso('como_quedamos').ejemplos, ['Laura', 'tu tratamiento facial']);
        assert.equal((await ver(abierta.insertId)).saludo, 'Rocío', 'el de pila del lead, limpio');
        assert.equal((await ver(cerrada)).saludo, 'Sara', 'el de su ficha');
      });

      await t.test('una plantilla sale solo con todas sus variables, y nunca una de las que manda la app', async () => {
        const antes = whatsapp.enviados.length;
        const falta = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Sara'] });
        assert.deepEqual([falta.status, falta.cuerpo.codigo, falta.cuerpo.error], [400, 'FALTAN_VARIABLES', 'Falta rellenar {{2}} de la plantilla']);
        const vacia = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Sara', '   '] });
        assert.equal(vacia.cuerpo.codigo, 'FALTAN_VARIABLES');
        const sola = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.resena, variables: ['Sara'] });
        assert.deepEqual([sola.status, sola.cuerpo.codigo], [400, 'PLANTILLA_AUTOMATICA']);
        // El hueco liberado mandado a mano: no hay oferta detrás y su «sí» no reservaría nada.
        const hueco = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.hueco_liberado, variables: ['Sara', 'tu valoración capilar', 'jueves 8 de octubre', '18:30'] });
        assert.deepEqual([hueco.status, hueco.cuerpo.codigo], [400, 'PLANTILLA_AUTOMATICA']);
        assert.equal(whatsapp.enviados.length, antes, 'no ha salido nada');

        const ok = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Sara', ' tu limpieza\n  facial '] });
        assert.equal(ok.status, 200, JSON.stringify(ok.cuerpo));
        const enviado = whatsapp.enviados.at(-1);
        assert.deepEqual([enviado.tipo, enviado.nombre, enviado.variables], ['plantilla', 'iemec_como_quedamos', ['Sara', 'tu limpieza facial']]);
        const { mensajes } = await ver(cerrada);
        assert.equal(mensajes.at(-1).texto, 'Hola Sara, como quedamos, te escribo para buscarte hueco para tu limpieza facial. ¿Te viene bien esta semana o la que viene? Si no quieres recibir más mensajes como este, responde BAJA.');
        assert.deepEqual([mensajes.at(-1).autor, mensajes.at(-1).tipo], ['persona', 'plantilla']);
      });

      await t.test('nada comercial a quien pidió la baja o no lo consintió; lo de servicio, sí', async () => {
        const antes = whatsapp.enviados.length;
        // Paciente con la baja en su ficha: el panel no le ofrece las comerciales y la API no las manda.
        const pablo = await ver(conBaja);
        assert.deepEqual(pablo.comercial, { puede: false, baja: true, motivo: 'pidió la baja de los mensajes comerciales', aviso: null, seguimiento: [] });
        const dormido = await post(`/conversaciones/${conBaja}/enviar`, { plantillaId: plantilla.paciente_dormido, variables: ['Pablo'] });
        assert.deepEqual([dormido.status, dormido.cuerpo.codigo], [409, 'SIN_PERMISO_COMERCIAL']);
        assert.equal(dormido.cuerpo.error, 'No se le puede mandar una plantilla comercial: pidió la baja de los mensajes comerciales');
        // Lead en la lista de bajas (lo pidió por WhatsApp): igual, y su ficha la enseña.
        const luis = await ver(enLista.insertId);
        assert.equal(luis.comercial.baja, true);
        const seguimiento = await post(`/conversaciones/${enLista.insertId}/enviar`, { plantillaId: plantilla.lead_sin_cita, variables: ['Luis', 'tu consulta'] });
        assert.deepEqual([seguimiento.status, seguimiento.cuerpo.codigo], [409, 'SIN_PERMISO_COMERCIAL']);
        // Sin consentimiento ni ser cliente (LSSI art. 21).
        const eva = await ver(sinConsentimiento);
        assert.deepEqual([eva.comercial.puede, eva.comercial.baja], [false, false]);
        assert.match(eva.comercial.motivo, /consentimiento/);
        const quedamos = await post(`/conversaciones/${sinConsentimiento}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Eva', 'tu limpieza facial'] });
        assert.deepEqual([quedamos.status, quedamos.cuerpo.codigo], [409, 'SIN_PERMISO_COMERCIAL']);
        assert.equal(whatsapp.enviados.length, antes, 'no ha salido nada comercial');
        // Un recordatorio de su cita no es comercial: ese sí sale.
        const recordatorio = await post(`/conversaciones/${conBaja}/enviar`, { plantillaId: plantilla.cita_recordatorio_24h, variables: conEjemplos('cita_recordatorio_24h', 'Pablo') });
        assert.equal(recordatorio.status, 200, JSON.stringify(recordatorio.cuerpo));
        assert.equal(whatsapp.enviados.at(-1).nombre, 'iemec_recordatorio_24h');
      });

      await t.test('los topes de mensajes comerciales avisan, pero lo decide la persona', async () => {
        assert.deepEqual((await ver(cerrada)).comercial, { puede: true, baja: false, motivo: null, aviso: null, seguimiento: [] });
        const otro = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.presupuesto_2d, variables: ['Sara', 'medicina capilar'] });
        assert.equal(otro.status, 200, JSON.stringify(otro.cuerpo));
        const sara = await ver(cerrada);
        assert.deepEqual([sara.comercial.puede, sara.comercial.aviso], [true, 'ya lleva 2 mensajes comerciales esta semana']);
        const tercero = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.presupuesto_7d, variables: ['Sara', 'medicina capilar'] });
        assert.equal(tercero.status, 200, JSON.stringify(tercero.cuerpo));
      });

      await t.test('lo que se escribe en las variables pasa el filtro de publicidad sanitaria', async () => {
        const antes = whatsapp.enviados.length;
        const toxina = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Sara', 'tu toxina botulínica con un 20 % de descuento'] });
        assert.deepEqual([toxina.status, toxina.cuerpo.codigo], [400, 'FILTRO_LEGAL']);
        assert.match(toxina.cuerpo.error, /^No pasa el filtro de publicidad sanitaria: Nombra un medicamento con receta \(toxina botulinica/);
        assert.ok(toxina.cuerpo.errores.some((e) => /medicamento con receta/.test(e)));
        // En {{1}} va el nombre con que se le saluda: si es otra cosa, también se mira.
        const enElNombre = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Sara, tu botox al 20 %', 'tu limpieza facial'] });
        assert.deepEqual([enElNombre.status, enElNombre.cuerpo.codigo], [400, 'FILTRO_LEGAL']);
        // Una de servicio tampoco lleva una promoción de un medicamento.
        const conPromocion = conEjemplos('cita_recordatorio_24h', 'Sara');
        conPromocion[conPromocion.length - 1] += ', y tu botox con un 20 % de descuento';
        const servicio = await post(`/conversaciones/${cerrada}/enviar`, { plantillaId: plantilla.cita_recordatorio_24h, variables: conPromocion });
        assert.deepEqual([servicio.status, servicio.cuerpo.codigo], [400, 'FILTRO_LEGAL']);
        assert.equal(whatsapp.enviados.length, antes, 'no ha salido nada');
        // El nombre de su ficha no se mira: a una Milagros no se le bloquea nada.
        const hola = await post(`/conversaciones/${milagros}/enviar`, { plantillaId: plantilla.como_quedamos, variables: ['Milagros', 'tu limpieza facial'] });
        assert.equal(hola.status, 200, JSON.stringify(hola.cuerpo));
        assert.deepEqual(whatsapp.enviados.at(-1).variables, ['Milagros', 'tu limpieza facial']);
      });
    });
  } finally {
    await pool.end();
  }
});
