'use strict';
// Una vuelta del cron de cada minuto contra la base: no rompe con la base vacía, respeta el
// candado (dos a la vez, solo uno trabaja), hace el trabajo diario una sola vez y va en su orden: lo
// que ha llegado por WhatsApp y las retenciones caducadas, antes que la lista de espera.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { vuelta } = require('../servidor/cron');
const { semillar } = require('../servidor/semillas');
const entrada = require('../servidor/entrada');
const agenda = require('../servidor/agenda');
const espera = require('../servidor/avisos-espera');
const LE = require('../servidor/lista-espera');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');

const mas = (d, min) => new Date(new Date(d).getTime() + min * 60000);

// Lo que manda WhatsApp cuando el paciente escribe (inventado).
const avisoWhatsApp = (de, texto, id, escrito) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA-PRUEBA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '34600000000', phone_number_id: 'NUM-PRUEBA' }, contacts: [],
    messages: [{ from: de, id, timestamp: String(Math.floor(escrito.getTime() / 1000)), type: 'text', text: { body: texto } }],
  } }] }],
});

test('cron de cada minuto', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await t.test('con la base recién creada no falla', async () => {
      const i = await vuelta({ pool, deps, ahora: new Date('2026-10-06T05:00:00Z') }); // 7:00 en Madrid: aún no toca la revisión diaria
      assert.equal(i.sinProximoPaso, undefined);
      assert.equal(i.seguimientos, 0);
      assert.equal(i.secuencias, 0);
      assert.deepEqual(i.cola, { hechos: 0, reintentos: 0, fallidos: 0, aplazados: 0 });
    });
    await t.test('con los datos de la clínica cargados tampoco', async () => {
      await semillar(pool);
      const i = await vuelta({ pool, deps, ahora: new Date('2026-10-06T09:00:00Z') });
      assert.equal(i.retencionesCaducadas, 0);
      assert.equal(i.sinProximoPaso, 0, 'a las 11:00 de Madrid se hace la revisión diaria');
      assert.equal(i.webhooksVaciados, 0, 'y se vacían los cuerpos de los webhooks de hace más de 30 días');
      assert.deepEqual(i.entrada, { hechos: 0, reintentos: 0, fallidos: 0, aplazados: 0 }, 'lo que ha llegado va lo primero');
    });
    await t.test('dos cron a la vez: uno trabaja y el otro se aparta', async () => {
      const ahora = new Date('2026-10-06T09:01:00Z');
      const [a, b] = await Promise.all([vuelta({ pool, deps, ahora }), vuelta({ pool, deps, ahora })]);
      assert.equal([a, b].filter((x) => x.saltado).length, 1);
    });
    await t.test('la revisión diaria solo se hace una vez al día', async () => {
      const i = await vuelta({ pool, deps, ahora: new Date('2026-10-06T10:00:00Z') });
      assert.equal(i.sinProximoPaso, undefined);
    });
    await t.test('la lista de espera va después de leer lo que ha llegado y de liberar las retenciones caducadas', async () => {
      const i = await vuelta({ pool, deps, ahora: new Date('2026-10-06T10:01:00Z') });
      assert.deepEqual(i.listaEspera, { caducadas: 0, fueraDePlazo: 0, conPersona: 0, ofrecidas: 0 });
      const orden = Object.keys(i);
      assert.ok(orden.indexOf('entrada') >= 0 && orden.indexOf('retencionesCaducadas') >= 0, orden.join(' → '));
      assert.ok(orden.indexOf('listaEspera') > orden.indexOf('entrada'), orden.join(' → '));
      assert.ok(orden.indexOf('listaEspera') > orden.indexOf('retencionesCaducadas'), orden.join(' → '));
    });

    await t.test('y así se ejecutan: primero la entrada de WhatsApp, luego las retenciones, luego la lista de espera', async () => {
      const llamadas = [];
      const originales = { procesarPendientes: entrada.procesarPendientes, caducarRetenciones: agenda.caducarRetenciones, vuelta: espera.vuelta };
      entrada.procesarPendientes = async (...a) => { llamadas.push('entrada'); return originales.procesarPendientes(...a); };
      agenda.caducarRetenciones = async (...a) => { llamadas.push('retenciones'); return originales.caducarRetenciones(...a); };
      espera.vuelta = async (...a) => { llamadas.push('lista de espera'); return originales.vuelta(...a); };
      try {
        await vuelta({ pool, deps, ahora: new Date('2026-10-06T10:02:00Z') });
      } finally {
        Object.assign(entrada, { procesarPendientes: originales.procesarPendientes });
        Object.assign(agenda, { caducarRetenciones: originales.caducarRetenciones });
        Object.assign(espera, { vuelta: originales.vuelta });
      }
      assert.deepEqual(llamadas, ['entrada', 'retenciones', 'lista de espera']);
    });

    // Una esteticista con horario (las semillas no traen horarios) y la plantilla del aviso aprobada.
    const ahora = new Date('2026-10-06T10:10:00Z'); // martes 12:10 en Madrid
    let oferta;
    await t.test('una retención que caduca se ofrece a la lista de espera en la misma vuelta', async () => {
      const [[est]] = await pool.query("SELECT id FROM profesionales WHERE rol = 'esteticista' ORDER BY id LIMIT 1");
      for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (?, ?, '11:00', '20:00')", [est.id, d]);
      await pool.query("UPDATE plantillas SET estado = 'aprobada', calidad = 'verde' WHERE uso = 'hueco_liberado'");
      const [a] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Alba', '+34611000971')");
      const [b] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Bea', '+34611000972')");
      // A Alba se le guardaba el hueco un minuto, y ya ha pasado; Bea lo espera.
      await agenda.reservar(pool, { pacienteId: a.insertId, tratamientoId: 'limpieza-facial-profunda', fecha: '2026-10-08', hora: '12:00', retener: true, retenerMin: 1, ahora: mas(ahora, -2) });
      await LE.apuntar(pool, { pacienteId: b.insertId, tratamientoId: 'limpieza-facial-profunda', desdeFecha: '2026-10-08', hastaFecha: '2026-10-08', origen: 'panel', creadoPor: 'recepcion', ahora: mas(ahora, -60) });
      const i = await vuelta({ pool, deps, ahora });
      assert.equal(i.retencionesCaducadas, 1);
      assert.equal(i.listaEspera.ofrecidas, 1, 'si fuera antes, el hueco aún estaría retenido y no se ofrecería hasta la vuelta siguiente');
      const aviso = whatsapp.enviados.filter((m) => m.telefono === '+34611000972').at(-1);
      assert.deepEqual([aviso.nombre, aviso.variables.slice(2)], ['iemec_hueco_liberado', ['jueves 8 de octubre', '12:00']]);
      [[oferta]] = await pool.query("SELECT * FROM lista_espera_ofertas WHERE estado = 'ofrecida'");
      assert.ok(oferta);
    });

    await t.test('un «sí» que está en la cola cuando caduca la oferta cuenta: se lee antes de caducar lo que se le guardaba', async () => {
      const caduca = new Date(oferta.caduca_en);
      const escrito = mas(caduca, -1);
      await entrada.guardarWebhook(pool, { proveedor: 'whatsapp', evento: 'mensajes', idExterno: 'wamid.CRON-SI-1',
        cuerpo: JSON.stringify(avisoWhatsApp('34611000972', 'Sí, guárdamelo', 'wamid.CRON-SI-1', escrito)), telefonos: ['+34611000972'], ahora: escrito });
      const i = await vuelta({ pool, deps, ahora: mas(caduca, 0.2) });
      assert.equal(i.entrada.hechos, 1);
      assert.equal(i.listaEspera.caducadas, 0, 'la oferta no caduca: ya la ha aceptado');
      const [[o]] = await pool.query('SELECT estado, cita_id FROM lista_espera_ofertas WHERE id = ?', [oferta.id]);
      assert.equal(o.estado, 'aceptada');
      const [[c]] = await pool.query('SELECT estado, inicio FROM citas WHERE id = ?', [o.cita_id]);
      assert.equal(c.estado, 'confirmada');
      const [[le]] = await pool.query('SELECT estado FROM lista_espera WHERE id = ?', [oferta.lista_espera_id]);
      assert.equal(le.estado, 'aceptado');
      const [sinRespuesta] = await pool.query("SELECT id FROM eventos WHERE tipo = 'lista_espera_sin_respuesta' AND entidad_id = ?", [String(oferta.lista_espera_id)]);
      assert.deepEqual(sinRespuesta, []);
    });
  } finally {
    await pool.end();
  }
});
