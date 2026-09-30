'use strict';
// Lo que llega del formulario de la web y de sus botones de WhatsApp, de punta a punta y con la demo
// (el catálogo de semillas/iemec y las plantillas aprobadas): el WhatsApp de confirmación y lo que se
// contesta («Sí, fui yo», «No fui yo»), el teléfono de otra persona (ni su lead, ni su conversación, ni
// su ficha), la casilla comercial (el «no» y el «sí», hasta su ficha y el panel), quien vuelve a pedirlo
// con otra preferencia, el primer WhatsApp de cada botón de la web (lo que pide y lo que le interesa),
// las bajas, la campaña y el borrado en su plazo. Teléfonos inventados (611 000 9xx).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { crearApp } = require('../servidor/index');
const { semillar } = require('../servidor/semillas');
const entrada = require('../servidor/entrada');
const cron = require('../servidor/cron');
const R = require('../servidor/repesca/motor');
const bandeja = require('../servidor/bandeja');
const retencion = require('../servidor/retencion');
const { altaLead } = require('../servidor/leads');
const { firmar } = require('../servidor/sesion');
const { descifrar } = require('../servidor/cripto');
const { crearIa, textoSimulado } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { cargarReferencias, cargarTextosFormulario } = require('../servidor/referencias-web');
const { huellaCampana } = require('../motor/entrada/web');
const { interpretar } = require('../motor/repesca/interpretar');
const { construir } = require('../web/construir');
const W = require('../web/lib/revision');

const martes = new Date('2026-10-06T10:00:00Z'); // martes 12:00 en Madrid
const WEB = 'https://iemec-clinic.com';
const mas = (d, min) => new Date(new Date(d).getTime() + min * 60000);
const e164 = (t) => `+34${String(t).replace(/\D/g, '').replace(/^34(?=\d{9}$)/, '')}`;
let n = 0;
const wamid = () => `wamid.WEBV${String(++n).padStart(5, '0')}`;

test('formulario de la web y sus WhatsApp, de punta a punta', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  await semillar(pool, { demo: true });
  // Quien atiende en recepción (el panel) y las esteticistas con horario (para que la IA pueda dar cita).
  await pool.query("INSERT INTO usuarios (id, email, nombre, rol) VALUES (1, 'recepcion@ejemplo.com', 'Recepción', 'recepcion')");
  const [esteticistas] = await pool.query("SELECT id FROM profesionales WHERE rol = 'esteticista'");
  for (const p of esteticistas) for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (?, ?, '10:00', '20:00')", [p.id, d]);

  let ahora = new Date(martes);
  let ia = crearIa('simulado');
  const deps = { pool, get ia() { return ia; }, whatsapp: crearWhatsApp('simulado') };
  const app = crearApp({ pool, reloj: () => ahora, deps });
  const servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const version = cargarTextosFormulario().actual;
  const q = async (sql, a = []) => (await pool.query(sql, a))[0];
  const uno = async (sql, a = []) => (await q(sql, a))[0];
  const cuantos = async (sql, a = []) => Number((await uno(sql, a)).n);
  let ip = 0;

  // El formulario, como lo manda la web con JavaScript.
  const formulario = async (extra = {}) => {
    const cuerpo = {
      nombre: 'Web Prueba', telefono: '', email: '', tratamiento: 'web-limpieza-facial', ref: 'web-limpieza-facial', mensaje: '', preferencia: 'whatsapp',
      privacidad: 'si', pagina: '/estetica-y-bienestar/limpieza-facial/', t: '9000', envio: crypto.randomUUID(), version_textos: version, web: '', ...extra,
    };
    const r = await fetch(`${base}/web/contacto`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Origin: WEB, 'X-Forwarded-For': `198.51.100.${++ip % 250}` },
      body: new URLSearchParams(cuerpo).toString(),
    });
    assert.equal(r.status, 200);
    return uno('SELECT * FROM leads WHERE telefono = ? ORDER BY id DESC LIMIT 1', [e164(cuerpo.telefono)]);
  };
  // Un mensaje de WhatsApp que llega (texto o botón de plantilla) y la vuelta de la entrada del cron.
  const whatsapp = async (tel, texto, { boton = false, perfil = 'Perfil Prueba' } = {}) => {
    const de = e164(tel).slice(1);
    const m = boton
      ? { from: de, id: wamid(), timestamp: String(Math.floor(ahora / 1000)), type: 'button', button: { text: texto, payload: texto } }
      : { from: de, id: wamid(), timestamp: String(Math.floor(ahora / 1000)), type: 'text', text: { body: texto } };
    const aviso = { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: 'NUM' }, contacts: [{ wa_id: de, profile: { name: perfil } }], messages: [m], statuses: [],
    } }] }] };
    const r = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aviso) });
    assert.equal(r.status, 200);
    const x = await entrada.procesarPendientes(deps, { ahora });
    if (x.fallidos || x.reintentos) assert.fail(JSON.stringify(await q('SELECT ultimo_error FROM cola WHERE ultimo_error IS NOT NULL')));
  };
  const secuencias = () => R.avanzarSecuencias(deps, { ahora, limite: 200 });
  const mensajesDe = async (tel) => (await q(
    `SELECT m.*, p.nombre AS plantilla FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id LEFT JOIN plantillas p ON p.id = m.plantilla_id
      WHERE c.telefono = ? ORDER BY m.id`, [e164(tel)])).map((m) => ({ ...m, texto: descifrar(m.cuerpo_cifrado, m.iv, m.tag) }));
  const conversacionDe = (tel) => uno('SELECT * FROM conversaciones WHERE telefono = ? ORDER BY id DESC LIMIT 1', [e164(tel)]);
  const cookie = `iemec_sesion=${encodeURIComponent(firmar({ id: 1, email: 'recepcion@ejemplo.com', nombre: 'Recepción', rol: 'recepcion', hasta: Date.now() + 3600000 }))}`;
  const panel = async (ruta, { metodo = 'GET', cuerpo } = {}) => (await fetch(`${base}/api/panel${ruta}`, {
    method: metodo, headers: { cookie, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })).json();
  const plantilla = (uso) => uno("SELECT * FROM plantillas WHERE uso = ? AND estado = 'aprobada' LIMIT 1", [uso]);
  // ¿Se le puede mandar esa plantilla desde la bandeja? (lo mismo que mira el envío automático)
  const desdeBandeja = async (tel, uso) => {
    const c = await conversacionDe(tel);
    const r = await bandeja.comprobarEnvio(pool, c, await plantilla(uso), ['Nombre', 'tu tratamiento', 'x', 'y'], ahora);
    return r.variables ? 'sale' : r.codigo;
  };
  // Pide por la web que le contesten por WhatsApp y contesta «Sí, fui yo» a la confirmación.
  const verificado = async (tel, extra = {}) => {
    const lead = await formulario({ telefono: tel, ...extra });
    await secuencias();
    ahora = mas(ahora, 2);
    await whatsapp(tel, 'Sí, fui yo', { boton: true });
    return uno('SELECT * FROM leads WHERE id = ?', [lead.id]);
  };

  try {
    await t.test('pide WhatsApp: no se le escribe con lo que puso quien lo envió; primero, un WhatsApp neutro de confirmación', async () => {
      const lead = await formulario({ telefono: '611 000 901', nombre: 'Gorda Asquerosa', tratamiento: 'web-aumento-de-pecho', ref: 'web-aumento-de-pecho', pagina: '/cirugia-estetica/aumento-de-pecho/' });
      assert.deepEqual([Boolean(lead.sin_verificar), lead.paciente_id, lead.tratamiento_interes_id], [true, null, 'aumento-pecho']);
      const r = await secuencias();
      assert.deepEqual(r.map((x) => x.plantilla), ['iemec_solicitud_web']);
      const msgs = await mensajesDe('611 000 901');
      assert.equal(msgs.length, 1);
      assert.equal(msgs[0].plantilla, 'iemec_solicitud_web');
      assert.doesNotMatch(msgs[0].texto, /Gorda|Asquerosa|pecho|mamoplastia|Hola \w+,/);
      assert.match(msgs[0].texto, /^Hola, hemos recibido en la web de IEMEC una solicitud de información con este número de teléfono\. ¿Has sido tú\?/);
      // Ni la bienvenida comercial ni la secuencia «lead» (con su nombre y el tratamiento).
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM inscripciones WHERE lead_id = ? AND secuencia = 'lead'", [lead.id]), 0);
      // La conversación de la confirmación no es del lead (aún no se sabe si es suyo).
      const conv = await conversacionDe('611 000 901');
      assert.deepEqual([conv.lead_id, conv.contexto], [null, 'general']);
      // Una segunda solicitud con ese teléfono en la misma semana no manda otra confirmación.
      await formulario({ telefono: '611 000 901', nombre: 'Otro Nombre' });
      ahora = mas(ahora, 1);
      assert.deepEqual(await secuencias(), []);
      assert.equal((await mensajesDe('611 000 901')).length, 1);
    });

    await t.test('«No fui yo»: se borra lo que escribió el otro, se le piden disculpas y no se le vuelve a escribir', async () => {
      ahora = mas(ahora, 3);
      await whatsapp('611 000 901', 'No fui yo', { boton: true });
      const msgs = await mensajesDe('611 000 901');
      assert.deepEqual(msgs.slice(-2).map((m) => [m.autor, m.texto]), [
        ['paciente', 'No fui yo'],
        ['ia', 'Perdona las molestias. Alguien dejó este número en nuestra web: no volveremos a escribirte por esa solicitud.'],
      ]);
      // Un solo lead: la segunda solicitud de esa semana fue a la primera (sin tocarla).
      const leads = await q("SELECT * FROM leads WHERE telefono = '+34611000901'");
      assert.equal(leads.length, 1);
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM solicitudes_web WHERE telefono = '+34611000901'"), 2);
      for (const l of leads) {
        assert.deepEqual([l.etapa, l.motivo_perdida, l.nombre, l.email, l.tratamiento_interes_id, l.respuestas_cifradas], ['perdido', 'no_lo_pidio', null, null, null, null]);
      }
      const sols = await q("SELECT * FROM solicitudes_web WHERE telefono = '+34611000901'");
      assert.ok(sols.every((s) => s.rechazada_en && !s.datos_cifrados && !s.verificada_en));
      assert.deepEqual([(await conversacionDe('611 000 901')).estado, (await conversacionDe('611 000 901')).motivo_cierre], ['cerrada', 'no_lo_pidio']);
      // Otra solicitud con su número: se guarda, pero no se le vuelve a escribir.
      const otra = await formulario({ telefono: '611 000 901' });
      assert.equal(await cuantos('SELECT COUNT(*) AS n FROM inscripciones WHERE lead_id = ?', [otra.id]), 0);
      ahora = mas(ahora, 1);
      await secuencias();
      assert.equal((await mensajesDe('611 000 901')).length, 3);
    });

    await t.test('«Sí, fui yo»: verificada, se une a su conversación y se le contesta a lo que pidió; su «sí» comercial llega a su ficha al reservar', async () => {
      const lead = await verificado('611 000 902', { nombre: 'Laura Web', comercial: 'si' });
      assert.deepEqual([Boolean(lead.sin_verificar), Boolean(lead.verificado_en), lead.tratamiento_interes_id], [false, true, 'limpieza-facial-profunda']);
      const s = await uno('SELECT * FROM solicitudes_web WHERE lead_id = ?', [lead.id]);
      assert.ok(s.verificada_en);
      const conv = await conversacionDe('611 000 902');
      assert.deepEqual([conv.lead_id, conv.contexto], [lead.id, 'lead']);
      const msgs = await mensajesDe('611 000 902');
      assert.equal(msgs.at(-2).intencion, 'informacion', 'pidió información: el «sí» no es otra cosa');
      assert.match(msgs.at(-1).texto, /^Soy el asistente virtual de IEMEC\. Gracias, Laura\. .*te busco hueco.*¿Te reservo alguno\?$/);
      // Elige el primero: se le da cita y pasa a tener ficha, con su consentimiento de la web.
      ahora = mas(ahora, 2);
      await whatsapp('611 000 902', 'El primero');
      const paciente = await uno("SELECT * FROM pacientes WHERE telefono = '+34611000902'");
      assert.ok(paciente, 'reservó: ya tiene ficha');
      const cons = await q('SELECT tipo, estado, fuente, prueba, registrado_en FROM consentimientos WHERE paciente_id = ? ORDER BY id', [paciente.id]);
      assert.deepEqual(cons.map((c) => [c.tipo, c.estado, c.fuente]), [['whatsapp_marketing', 'otorgado', 'web'], ['email_marketing', 'otorgado', 'web']]);
      assert.match(cons[0].prueba, new RegExp(`^Formulario de la web: solicitud n\\.º ${s.id}, .*versión de los textos ${version.replace('.', '\\.')}, huella [0-9a-f]{16}$`));
      assert.equal(new Date(cons[0].registrado_en).toISOString(), new Date(s.enviado_en).toISOString());
      assert.deepEqual(await R.permisoComercial(pool, { paciente_id: paciente.id }, ahora), { ok: true, seguimiento: [] });
      // El panel lo enseña.
      const d = await panel(`/conversaciones/${(await conversacionDe('611 000 902')).id}`);
      assert.deepEqual([d.consentimientoComercial.valor, d.consentimientoComercial.fuente], [true, 'web']);
    });

    await t.test('ya era paciente: su «sí» comercial llega a su ficha al confirmar la solicitud', async () => {
      await pool.query("INSERT INTO pacientes (nombre, telefono, email, origen) VALUES ('Paula', '+34611000903', 'paula@ejemplo.com', 'recepcion')");
      const lead = await verificado('611 000 903', { nombre: 'Paula', comercial: 'si' });
      const p = await uno("SELECT id FROM pacientes WHERE telefono = '+34611000903'");
      assert.equal(lead.paciente_id, p.id, 'verificada, se une a su ficha');
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM consentimientos WHERE paciente_id = ? AND estado = 'otorgado' AND fuente = 'web'", [p.id]), 2);
      // Lo comercial ya le puede salir (el seguimiento que acaba de pedir queda como aviso de «silencio»).
      assert.doesNotMatch((await R.permisoComercial(pool, { paciente_id: p.id }, ahora)).motivo || '', /consentimiento/);
      assert.equal(await desdeBandeja('611 000 903', 'paciente_dormido'), 'sale');
    });

    await t.test('la casilla comercial: sin ella, solo lo que contesta a su solicitud y mientras siga en curso', async () => {
      await verificado('611 000 911');
      await verificado('611 000 912', { comercial: 'si' });
      // Sin la casilla: el seguimiento de su solicitud sí; «te echamos de menos» o «toca repetir», no.
      assert.equal(await desdeBandeja('611 000 911', 'lead_sin_cita'), 'sale');
      assert.equal(await desdeBandeja('611 000 911', 'paciente_dormido'), 'SIN_PERMISO_COMERCIAL');
      assert.equal(await desdeBandeja('611 000 911', 'toca_repetir'), 'SIN_PERMISO_COMERCIAL');
      // Con la casilla (verificada), lo comercial también.
      assert.equal(await desdeBandeja('611 000 912', 'paciente_dormido'), 'sale');
      // Vuelve a pedirlo sin marcarla: mientras esa solicitud no esté verificada, sigue lo que dijo; cuando
      // recepción la confirma (en Tareas), manda lo último que ha dicho.
      await formulario({ telefono: '611 000 912', preferencia: 'llamada' });
      assert.equal(await desdeBandeja('611 000 912', 'paciente_dormido'), 'sale');
      const l912 = await uno("SELECT id FROM leads WHERE telefono = '+34611000912'");
      const v = await panel(`/leads/${l912.id}/verificar`, { metodo: 'POST', cuerpo: {} });
      assert.deepEqual([v.leads, v.solicitudes, v.consentimiento], [[], 1, false]);
      assert.equal(await desdeBandeja('611 000 912', 'paciente_dormido'), 'SIN_PERMISO_COMERCIAL');
      // Tras «No, gracias», ni siquiera el seguimiento: su solicitud ya no está en curso.
      ahora = mas(ahora, 2);
      await whatsapp('611 000 911', 'No, gracias');
      assert.equal((await uno("SELECT etapa FROM leads WHERE telefono = '+34611000911' ORDER BY id DESC LIMIT 1")).etapa, 'perdido');
      assert.equal(await desdeBandeja('611 000 911', 'lead_sin_cita'), 'SIN_PERMISO_COMERCIAL');
      // El del botón de WhatsApp de la web no ha marcado nada: igual que sin la casilla.
      await whatsapp('611 000 913', 'Hola, vengo de la web y me interesa: Limpieza facial. (ref. web-limpieza-facial)');
      assert.equal(await desdeBandeja('611 000 913', 'paciente_dormido'), 'SIN_PERMISO_COMERCIAL');
      assert.equal(await desdeBandeja('611 000 913', 'lead_sin_cita'), 'sale');
      // La casilla de una solicitud sin verificar no cuenta (la pudo marcar otro con su teléfono).
      const sinVerificar = await formulario({ telefono: '611 000 914', comercial: 'si' });
      const p = await R.permisoComercial(pool, { lead_id: sinVerificar.id }, ahora, { uso: 'paciente_dormido' });
      assert.equal(p.ok, false);
      assert.equal((await R.permisoComercial(pool, { lead_id: sinVerificar.id }, ahora, { uso: 'lead_sin_cita' })).ok, false);
      // El panel de la bandeja: sin la casilla, solo las plantillas de seguimiento de su solicitud.
      const d = await panel(`/conversaciones/${(await conversacionDe('611 000 913')).id}`);
      assert.equal(d.comercial.puede, false);
      assert.deepEqual(d.comercial.seguimiento.sort(), ['como_quedamos', 'lead_primer_contacto', 'lead_sin_cita', 'lead_ultimo_intento']);
      assert.equal(d.consentimientoComercial.valor, null);
    });

    await t.test('una versión de los textos que la web no ha publicado: su casilla comercial no cuenta', async () => {
      await verificado('611 000 915', { comercial: 'si', version_textos: '2026-01-01.inventad' });
      assert.equal(await desdeBandeja('611 000 915', 'paciente_dormido'), 'SIN_PERMISO_COMERCIAL');
    });

    await t.test('con el teléfono de otra persona: ni su lead, ni su conversación, ni su ficha', async () => {
      // (a) Lucía pidió que la llamaran por el lipoláser; otro manda su teléfono con su correo y otra página.
      const lucia = await formulario({ telefono: '611 000 921', nombre: 'Lucía', preferencia: 'llamada', tratamiento: 'web-lipolaser', ref: 'web-lipolaser', pagina: '/medicina-estetica-corporal/lipolaser/' });
      await formulario({ telefono: '611 000 921', nombre: 'Atacante', email: 'atacante@ejemplo.net', preferencia: 'correo', tratamiento: 'estetica-intima-femenina', ref: 'web-intima-f-6mlx46', pagina: '/estetica-intima-femenina/labioplastia/' });
      const despues = await uno('SELECT * FROM leads WHERE id = ?', [lucia.id]);
      assert.deepEqual([despues.email, despues.tratamiento_interes_id, despues.nombre], [null, 'lipolaser', 'Lucía']);
      assert.ok((await q('SELECT verificada_en FROM solicitudes_web WHERE telefono = ?', ['+34611000921'])).every((s) => !s.verificada_en));

      // (b) Sara habla con la IA de una limpieza facial; otro manda su teléfono con el aumento de pecho.
      await whatsapp('611 000 922', 'Hola, vengo de la web y me interesa: Limpieza facial. (ref. web-limpieza-facial)', { perfil: 'Sara' });
      const sara = await uno("SELECT * FROM leads WHERE telefono = '+34611000922'");
      await formulario({ telefono: '611 000 922', nombre: 'Sara', tratamiento: 'web-aumento-de-pecho', ref: 'web-aumento-de-pecho', pagina: '/cirugia-estetica/aumento-de-pecho/' });
      assert.equal((await uno('SELECT tratamiento_interes_id FROM leads WHERE id = ?', [sara.id])).tratamiento_interes_id, 'limpieza-facial-profunda');
      const tarea = await uno('SELECT * FROM tareas WHERE lead_id = ? ORDER BY id DESC LIMIT 1', [sara.id]);
      assert.match(tarea.titulo, /^Otra solicitud de la web con el teléfono de Sara \(611 00 09 22\), sin verificar: comprobar que es la misma persona antes de contestarle en su conversación \(pide información de valoración de aumento de/);

      // (c) Marta es paciente y tiene una conversación abierta; otro manda su teléfono con su propio correo.
      await pool.query("INSERT INTO pacientes (nombre, apellidos, telefono, email, origen) VALUES ('Marta', 'Paciente Real', '+34611000923', 'marta.real@ejemplo.com', 'recepcion')");
      await whatsapp('611 000 923', '¿A qué hora abrís el sábado?', { perfil: 'Marta' });
      const antes = await conversacionDe('611 000 923');
      const falso = await formulario({
        telefono: '611 000 923', nombre: 'Marta', email: 'atacante@ejemplo.net', preferencia: 'correo',
        mensaje: 'He cambiado de correo: enviadme a este la fecha de mi próxima cita y el presupuesto que me disteis',
      });
      assert.deepEqual([falso.paciente_id, Boolean(falso.sin_verificar)], [null, true]);
      const conv = await conversacionDe('611 000 923');
      assert.deepEqual([conv.id, conv.lead_id, conv.contexto], [antes.id, antes.lead_id, antes.contexto], 'su conversación no cambia');
      const t2 = await uno('SELECT * FROM tareas WHERE lead_id = ?', [falso.id]);
      assert.deepEqual([t2.paciente_id, t2.conversacion_id], [null, null], 'la tarea no va con su ficha ni con su conversación');
      assert.match(t2.titulo, /^OJO, sin verificar: el teléfono es de una paciente con otro correo en su ficha; no le mandes nada suyo, llámala antes\. Escribir a Marta a atacante@ejemplo\.net: pide información/);
      const d = await panel(`/conversaciones/${conv.id}`);
      assert.equal(d.lead, null, 'su conversación no enseña lo que escribió otro');
      assert.equal(d.paciente.email, 'marta.real@ejemplo.com');
    });

    await t.test('vuelve a pedirlo por la web con llamada: su tarea sale siempre, con lo que escribe, y el WhatsApp automático se para', async () => {
      // Un lead de la secuencia «lead» (GHL) que después pide en la web que le llamen.
      const ghl = await altaLead(pool, { origen: 'ghl', telefono: '611000931', nombre: 'Carmen Ghl', tratamiento: { id: 'limpieza-facial-profunda' } }, { ahora });
      assert.equal(ghl.inscrito, true);
      await formulario({ telefono: '611 000 931', nombre: 'Carmen', preferencia: 'llamada', mensaje: 'Mejor llamadme por la tarde, por WhatsApp no puedo' });
      assert.equal((await uno("SELECT estado FROM inscripciones WHERE lead_id = ? AND secuencia = 'lead'", [ghl.leadId])).estado, 'pausada');
      const tarea = await uno("SELECT * FROM tareas WHERE lead_id = ? AND tipo = 'llamar' ORDER BY id DESC LIMIT 1", [ghl.leadId]);
      assert.match(tarea.titulo, /^Sin verificar: ya había otra solicitud con este teléfono, comprueba que es la misma persona\. Llamar a Carmen al 611 00 09 31: lo ha pedido en la web de limpieza facial profunda/);
      const lista = await panel('/tareas');
      const suya = lista.tareas.find((x) => x.id === tarea.id);
      assert.deepEqual([suya.lead.solicitudesWeb[0].mensaje, suya.lead.solicitudesWeb[0].preferencia, suya.lead.solicitudesWeb[0].verificada],
        ['Mejor llamadme por la tarde, por WhatsApp no puedo', 'llamada', false]);

      // Uno de la web a quien aún no le ha llegado la confirmación: igual.
      const w = await formulario({ telefono: '611 000 932' });
      await formulario({ telefono: '611 000 932', preferencia: 'llamada', mensaje: 'Llamadme mejor' });
      assert.equal((await uno("SELECT estado, motivo_fin FROM inscripciones WHERE lead_id = ? AND secuencia = 'confirmar_web'", [w.id])).estado, 'pausada');
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM tareas WHERE lead_id = ? AND tipo = 'llamar'", [w.id]), 1);
    });

    await t.test('el primer WhatsApp de cada botón de la web: pide información de esa página, que manda sobre lo que diga el texto', async () => {
      // Los textos de verdad: la web construida en una carpeta temporal.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iemec-web-'));
      const textos = new Set();
      try {
        construir({ salida: dir, referencias: null, textos: null });
        const recorrer = (d) => {
          for (const f of fs.readdirSync(d)) {
            const p = path.join(d, f);
            if (fs.statSync(p).isDirectory()) recorrer(p);
            else if (f.endsWith('.html')) for (const w of W.whatsapps(fs.readFileSync(p, 'utf8'))) textos.add(w.texto);
          }
        };
        recorrer(dir);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      assert.ok(textos.size >= 90, `${textos.size} textos`);
      const { referencias } = cargarReferencias();
      const [activos] = await pool.query("SELECT id FROM tratamientos WHERE activo = TRUE OR notas LIKE 'No se reserva: agrupa varias técnicas%'");
      const vale = new Set(activos.map((x) => x.id));
      let i = 0;
      for (const texto of textos) {
        const tel = `611 20${String(++i).padStart(4, '0')}`;
        ahora = mas(ahora, 1);
        await whatsapp(tel, texto);
        const ref = /\(ref\. (web-[a-z0-9-]+)/.exec(texto)[1];
        const lead = await uno('SELECT * FROM leads WHERE telefono = ?', [e164(tel)]);
        const esperado = referencias[ref]?.catalogo && vale.has(referencias[ref].catalogo) ? referencias[ref].catalogo : null;
        assert.equal(lead.tratamiento_interes_id, esperado, `${texto}: el interés lo dice la referencia`);
        const msgs = await mensajesDe(tel);
        assert.equal(msgs[0].intencion, 'informacion', texto);
        assert.equal(msgs.at(-1).autor, 'ia');
        assert.doesNotMatch(msgs.at(-1).texto, /¿Cuándo te vendría mejor que te escribamos\?/, texto);
        if (/web-tarjeta-/.test(ref)) {
          const tarea = await uno('SELECT titulo FROM tareas WHERE conversacion_id = ?', [(await conversacionDe(tel)).id]);
          assert.match(tarea.titulo, /tarjeta regalo/, texto);
        }
      }
      // Las páginas que antes perdían su tratamiento por lo que decía el texto.
      for (const [ref, id] of [['web-injerto-de-barba', 'microinjerto-barba'], ['web-diagnostico-de-lipolaser', referencias['web-diagnostico-de-lipolaser'].catalogo]]) {
        const lead = await uno('SELECT tratamiento_interes_id FROM leads WHERE codigo_web = ? ORDER BY id DESC LIMIT 1', [ref]);
        assert.equal(lead.tratamiento_interes_id, id, ref);
      }
      // En lo íntimo, el WhatsApp lleva la referencia de la especialidad (la misma en todas sus páginas).
      assert.ok([...textos].filter((x) => /Salud íntima femenina/.test(x)).every((x) => x.includes('(ref. web-intima-f-1l61s42')));
    });

    await t.test('con la IA real, ni la referencia ni la campaña le llegan como si las hubiera escrito el paciente', async () => {
      const visto = [];
      ia = {
        modo: 'real',
        async interpretar(a) { visto.push(JSON.stringify(a)); return { ...interpretar(a.texto), fuente: 'ia' }; },
        async redactar(a) { visto.push(JSON.stringify(a)); return textoSimulado(a.decision, a.datos); },
      };
      try {
        await whatsapp('611 000 941', 'Hola, vengo de la web y me interesa: Salud íntima femenina. (ref. web-intima-f-1l61s42 · c-1x2y3z)');
        ahora = mas(ahora, 1);
        await whatsapp('611 000 941', '¿Y cuánto cuesta?');
      } finally {
        ia = crearIa('simulado');
      }
      assert.ok(visto.length >= 2);
      assert.ok(visto.every((x) => !x.includes('(ref.') && !x.includes('c-1x2y3z')), visto.join('\n'));
    });

    await t.test('la campaña del WhatsApp de la web: su nombre, si es una que conocemos; si no, su huella en el panel', async () => {
      await formulario({ telefono: '611 000 951', utm_campaign: 'otono-lipo' });
      await whatsapp('611 000 952', `Hola, vengo de la web y me interesa: Lipoláser. (ref. web-lipolaser · ${huellaCampana('otono-lipo')})`);
      assert.equal((await uno("SELECT campana FROM leads WHERE telefono = '+34611000952'")).campana, 'otono-lipo');
      await whatsapp('611 000 953', 'Hola, vengo de la web y me interesa: Lipoláser. (ref. web-lipolaser · c-zzzz1)');
      const l = await uno("SELECT campana, utm FROM leads WHERE telefono = '+34611000953'");
      assert.equal(l.campana, null);
      const d = await panel(`/conversaciones/${(await conversacionDe('611 000 953')).id}`);
      assert.equal(d.lead.claveCampana, 'c-zzzz1');
    });

    await t.test('tenía la baja y pide por la web que le contestemos por WhatsApp: la confirmación le llega (no es publicidad) y la baja sigue', async () => {
      await pool.query("INSERT INTO bajas_comerciales (telefono, fuente, creado_en) VALUES ('+34611000961', 'whatsapp', ?)", [mas(martes, -60 * 24 * 30)]);
      await verificado('611 000 961', { comercial: 'si' });
      const msgs = await mensajesDe('611 000 961');
      assert.equal(msgs[0].plantilla, 'iemec_solicitud_web');
      assert.equal(msgs.at(-1).autor, 'ia', 'le contesta la conversación');
      const tarea = await uno("SELECT titulo FROM tareas WHERE titulo LIKE '%después de darse de baja%'");
      assert.match(tarea.titulo, /^611 00 09 61 ha marcado en la web que quiere comunicaciones comerciales después de darse de baja/);
      assert.equal(await desdeBandeja('611 000 961', 'paciente_dormido'), 'SIN_PERMISO_COMERCIAL');
    });

    await t.test('recepción confirma por teléfono una solicitud (llamada): queda verificada y cuenta su casilla', async () => {
      const lead = await formulario({ telefono: '611 000 971', preferencia: 'llamada', comercial: 'si' });
      const r = await panel(`/leads/${lead.id}/verificar`, { metodo: 'POST', cuerpo: {} });
      assert.deepEqual([r.ok, r.leads, r.consentimiento], [true, [lead.id], true]);
      assert.equal((await uno('SELECT sin_verificar FROM leads WHERE id = ?', [lead.id])).sin_verificar, 0);
      assert.equal((await R.permisoComercial(pool, { lead_id: lead.id }, ahora, { uso: 'paciente_dormido' })).ok, true);
    });

    await t.test('se borra en su plazo: el lead sin cita a los 12 meses, lo que no es de nadie al mes y la prueba comercial a los 3 años', async () => {
      // Un lead de la web verificado, con la casilla, que no llega a nada; y otro que nadie confirma.
      ahora = new Date(martes);
      await verificado('611 000 981', { comercial: 'si', mensaje: 'Solo quería saber el precio' });
      const sinConfirmar = await formulario({ telefono: '611 000 982', nombre: 'Nadie Confirma' });
      await secuencias();
      const verif = await uno("SELECT * FROM leads WHERE telefono = '+34611000981'");
      const [[conv]] = await pool.query("SELECT id FROM conversaciones WHERE telefono = '+34611000981'");
      await pool.query("UPDATE conversaciones SET estado = 'cerrada' WHERE telefono IN ('+34611000981', '+34611000982')");
      await pool.query("UPDATE seguimientos SET estado = 'cancelado' WHERE lead_id = ? OR conversacion_id = ?", [verif.id, conv.id]);
      await pool.query("UPDATE tareas SET estado = 'hecha' WHERE lead_id IN (?, ?)", [verif.id, sinConfirmar.id]);
      // A la semana, la que nadie confirma caduca; al mes, se borra.
      const semana = await retencion.purgarCadaDia(pool, mas(martes, 8 * 1440));
      assert.ok(semana.caducadas >= 1);
      assert.equal((await uno('SELECT motivo_perdida FROM leads WHERE id = ?', [sinConfirmar.id])).motivo_perdida, 'sin_confirmar');
      await retencion.purgarCadaDia(pool, mas(martes, 40 * 1440));
      assert.equal(await uno('SELECT id FROM leads WHERE id = ?', [sinConfirmar.id]), undefined);
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM conversaciones WHERE telefono = '+34611000982'"), 0);
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM solicitudes_web WHERE telefono = '+34611000982'"), 0);
      // A los 12 meses sin actividad, el verificado se borra con su conversación; de la solicitud queda la
      // prueba del consentimiento comercial, sin lo pedido.
      assert.ok(await uno('SELECT id FROM leads WHERE id = ?', [verif.id]), 'antes del plazo sigue');
      const ano = await retencion.purgarCadaDia(pool, mas(martes, 400 * 1440));
      assert.ok(ano.borrados >= 1);
      assert.equal(await uno('SELECT id FROM leads WHERE id = ?', [verif.id]), undefined);
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM conversaciones WHERE telefono = '+34611000981'"), 0);
      const prueba = await uno("SELECT * FROM solicitudes_web WHERE telefono = '+34611000981'");
      assert.deepEqual([prueba.lead_id, prueba.datos_cifrados, Boolean(prueba.consentimiento_comercial), Boolean(prueba.verificada_en), prueba.version_textos],
        [null, null, true, true, version]);
      const eventos = await q("SELECT datos FROM eventos WHERE entidad = 'lead' AND entidad_id = ?", [String(verif.id)]);
      assert.ok(eventos.length && eventos.every((e) => !JSON.stringify(e.datos).includes('limpieza')), 'sin el tratamiento');
      // A los 3 años, tampoco la prueba.
      await retencion.purgarCadaDia(pool, mas(martes, (3 * 365 + 5) * 1440));
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM solicitudes_web WHERE telefono = '+34611000981'"), 0);
    });

    await t.test('la tarea diaria del cron hace el borrado', async () => {
      const r = await cron.vuelta({ pool, ahora: mas(martes, 2 * 1440 + 60), deps });
      assert.ok(r.retencion, JSON.stringify(r));
    });

    await t.test('supresión a petición: todo lo suyo fuera (menos la prueba comercial) y a la lista de bajas; a un paciente no se le toca', async () => {
      ahora = new Date(martes);
      await verificado('611 000 991', { comercial: 'si' });
      const ensayo = await retencion.suprimirTelefono(pool, '+34611000991', { ensayo: true });
      assert.deepEqual([ensayo.leads, ensayo.conversaciones], [1, 1]);
      await retencion.suprimirTelefono(pool, '+34611000991', { ahora });
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM leads WHERE telefono = '+34611000991'"), 0);
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM conversaciones WHERE telefono = '+34611000991'"), 0);
      assert.equal(await cuantos("SELECT COUNT(*) AS n FROM bajas_comerciales WHERE telefono = '+34611000991'"), 1);
      const prueba = await uno("SELECT * FROM solicitudes_web WHERE telefono = '+34611000991'");
      assert.deepEqual([prueba.datos_cifrados, prueba.lead_id], [null, null]);
      const paciente = await retencion.suprimirTelefono(pool, '+34611000903', { ahora });
      assert.equal(paciente.paciente, true);
      assert.ok(await cuantos("SELECT COUNT(*) AS n FROM leads WHERE telefono = '+34611000903'"));
    });
  } finally {
    servidor.close();
    await pool.end();
  }
});
