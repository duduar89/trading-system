'use strict';
// Lo que entra de verdad, con peticiones reales al puerto: webhooks de WhatsApp (mensajes y estados)
// y de Meta (leads de formularios) y POST /api/leads. Se guardan, se encolan y el cron los procesa.
// Todo inventado: teléfonos 611 000 5xx y 6xx, wamids «wamid.PRUEBA…» y leads del Meta simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { crearApp } = require('../servidor/index');
const entrada = require('../servidor/entrada');
const cron = require('../servidor/cron');
const R = require('../servidor/repesca/motor');
const { firmar } = require('../servidor/sesion');
const { descifrar } = require('../servidor/cripto');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { crearMeta } = require('../servidor/integraciones/meta');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const { interpretar } = require('../motor/repesca/interpretar');
const T = require('../motor/tiempo');

const SECRETO = 'secreto-app-whatsapp-de-pruebas';
const SECRETO_META = 'secreto-app-meta-de-pruebas';
const ENTORNO = {
  WHATSAPP_VERIFY_TOKEN: 'token-verificacion-whatsapp', WHATSAPP_APP_SECRET: SECRETO, WHATSAPP_WEBHOOK_CLAVE: undefined,
  META_VERIFY_TOKEN: 'token-verificacion-meta', META_APP_SECRET: SECRETO_META, LEADS_CLAVE: 'clave-de-leads-de-pruebas-0123456789',
};

const martes = new Date('2026-10-06T10:00:00Z'); // martes 12:00 en Madrid
const mas = (d, min) => new Date(new Date(d).getTime() + min * 60000);
let n = 0;
const wamid = () => `wamid.PRUEBA${String(++n).padStart(4, '0')}`;
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
// La marca de WhatsApp del mensaje (cuándo lo escribió).
const en = (d) => ({ timestamp: String(Math.floor(new Date(d).getTime() / 1000)) });
const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
const dormir = (ms) => new Promise((ok) => { setTimeout(ok, ms); });

function ponerEntorno(cambios) {
  const antes = {};
  for (const [k, v] of Object.entries(cambios)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => ponerEntorno(antes);
}

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

const firma = (cuerpo, secreto = SECRETO) => `sha256=${crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;
const aviso = ({ mensajes = [], estados = [], perfil = null, de = null }) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA-PRUEBA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '34600000000', phone_number_id: 'NUM-PRUEBA' },
    contacts: perfil ? [{ wa_id: de, profile: { name: perfil } }] : [], messages: mensajes, statuses: estados,
  } }] }],
});
const marca = String(Math.floor(martes.getTime() / 1000));
const texto = (de, body, extra = {}) => ({ from: de, id: wamid(), timestamp: marca, type: 'text', text: { body }, ...extra });
const estado = (id, status, errores) => ({ id, status, timestamp: marca, recipient_id: '34611000500', ...(errores ? { errors: errores } : {}) });
const avisoLead = (leadgenId, extra = {}) => ({
  object: 'page', entry: [{ id: 'PAGINA-PRUEBA', time: Number(marca), changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: 'PAGINA-PRUEBA', form_id: '800000000000001', ad_id: '700000000000001', adgroup_id: '600000000000001', created_time: Number(marca), ...extra } }] }],
});

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, municipio) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', 'Boadilla del Monte')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '10:00', '20:00')", [d]);
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista')");
  for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '10:00', '20:00')", [d]);
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Medicina estética facial'), ('medicina_capilar', 'Medicina capilar')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, publicidad_restringida, reservable_ia, alias) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 60, 10, 54, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, TRUE, '["higiene facial"]'),
    ('mesoterapia-capilar', 'Mesoterapia capilar', 'medicina_capilar', 45, 10, NULL, 'medico', 'consulta_medica', 'servicio', FALSE, FALSE, '[]'),
    ('toxina-botulinica', 'Toxina botulínica (neuromoduladores)', 'facial', 30, 10, NULL, 'medico', 'consulta_medica', 'medicamento_receta', TRUE, FALSE, '["botox"]')`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

// Lo que usan las pruebas contra la base y el puerto: consultas, una vuelta del paso de entrada del
// cron (si un trabajo falla, se ve el error) y los POST firmados.
function ayudas({ pool, deps, base }) {
  const q = async (sql, a = []) => (await pool.query(sql, a))[0];
  const uno = async (sql, a = []) => (await q(sql, a))[0];
  const procesar = async (ahora, opciones = {}) => {
    const r = await entrada.procesarPendientes(deps, { ahora, ...opciones });
    if (r.reintentos || r.fallidos) assert.fail(`la cola ha fallado: ${JSON.stringify(await q('SELECT tipo, ultimo_error FROM cola WHERE ultimo_error IS NOT NULL'))}`);
    return r;
  };
  const conversacionDe = (telefono) => uno('SELECT * FROM conversaciones WHERE telefono = ? ORDER BY id DESC LIMIT 1', [telefono]);
  const mensajesDe = async (conversacionId) => (await q('SELECT * FROM mensajes WHERE conversacion_id = ? ORDER BY id', [conversacionId]))
    .map((m) => ({ ...m, texto: descifrar(m.cuerpo_cifrado, m.iv, m.tag) }));
  const postWhatsApp = (obj, { cabeceras = {}, secreto = SECRETO, crudo = null } = {}) => {
    const cuerpo = crudo ?? JSON.stringify(obj);
    return fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma(cuerpo, secreto), ...cabeceras }, body: cuerpo });
  };
  const postMeta = (obj, secreto = SECRETO_META) => {
    const cuerpo = JSON.stringify(obj);
    return fetch(`${base}/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma(cuerpo, secreto) }, body: cuerpo });
  };
  const postLead = (cuerpo, clave = ENTORNO.LEADS_CLAVE) => fetch(`${base}/api/leads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(clave ? { 'X-Clave': clave } : {}) }, body: JSON.stringify(cuerpo),
  });
  const cookie = `iemec_sesion=${encodeURIComponent(firmar({ id: 1, email: 'recepcion@ejemplo.com', nombre: 'Recepción', rol: 'recepcion', hasta: Date.now() + 3600000 }))}`;
  const panel = async (ruta, { metodo = 'GET', cuerpo } = {}) => (await fetch(`${base}/api/panel${ruta}`, {
    method: metodo, headers: { cookie, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })).json();
  return { q, uno, procesar, conversacionDe, mensajesDe, postWhatsApp, postMeta, postLead, panel };
}

test('entrada de WhatsApp y de leads', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const restaurar = ponerEntorno(ENTORNO);
  const whatsapp = crearWhatsApp('simulado');
  const meta = crearMeta('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp, meta };
  try {
    await sembrar(pool);
    // Lo que llega por el puerto entra a las 12:00 del martes (y no a la hora del reloj de verdad).
    await conServidor(crearApp({ pool, reloj: () => martes }), async (base) => {
      const { q, uno, procesar, conversacionDe, mensajesDe, postWhatsApp, postMeta, postLead, panel } = ayudas({ pool, deps, base });

      await t.test('verificación de Meta al dar de alta los webhooks', async () => {
        const url = (ruta, token, reto = '1158201444') => `${base}${ruta}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${reto}`;
        const ok = await fetch(url('/webhooks/whatsapp', ENTORNO.WHATSAPP_VERIFY_TOKEN));
        assert.equal(ok.status, 200);
        assert.equal(await ok.text(), '1158201444');
        assert.equal((await fetch(url('/webhooks/whatsapp', 'otro-token'))).status, 403);
        assert.equal((await fetch(`${base}/webhooks/whatsapp?hub.verify_token=${ENTORNO.WHATSAPP_VERIFY_TOKEN}&hub.challenge=1`)).status, 403);
        assert.equal((await fetch(url('/webhooks/whatsapp', ENTORNO.WHATSAPP_VERIFY_TOKEN, '<script>'))).status, 403);
        assert.equal(await (await fetch(url('/webhooks/meta', ENTORNO.META_VERIFY_TOKEN, '42'))).text(), '42');
        assert.equal((await fetch(url('/webhooks/meta', ENTORNO.WHATSAPP_VERIFY_TOKEN))).status, 403, 'cada webhook, su token');
        const sinToken = ponerEntorno({ WHATSAPP_VERIFY_TOKEN: undefined });
        try { assert.equal((await fetch(url('/webhooks/whatsapp', ''))).status, 403); } finally { sinToken(); }
      });

      await t.test('firma: la buena se guarda y se encola; la mala o ninguna, 401 y nada guardado', async () => {
        const cuantos = async () => (await uno('SELECT COUNT(*) AS n FROM webhooks')).n;
        const antes = await cuantos();
        const cuerpo = aviso({ estados: [estado('wamid.NO-EXISTE-1', 'delivered')] });
        const r = await postWhatsApp(cuerpo);
        assert.equal(r.status, 200);
        const w = await uno('SELECT * FROM webhooks ORDER BY id DESC LIMIT 1');
        assert.deepEqual([w.proveedor, w.evento, w.id_externo, w.firma_ok, w.procesado_en], ['whatsapp', 'estados', 'wamid.NO-EXISTE-1:entregado', 1, null]);
        const trabajo = await uno('SELECT * FROM cola ORDER BY id DESC LIMIT 1');
        assert.deepEqual([trabajo.tipo, trabajo.estado], ['webhook_whatsapp_estados', 'pendiente'], 'solo estados: su propio trabajo, detrás de los mensajes');
        assert.equal(json(trabajo.carga).webhookId, w.id);

        const otro = aviso({ estados: [estado('wamid.NO-EXISTE-2', 'read')] });
        assert.equal((await postWhatsApp(otro, { secreto: 'secreto-equivocado' })).status, 401);
        assert.equal((await postWhatsApp(otro, { cabeceras: { 'X-Hub-Signature-256': firma(JSON.stringify(cuerpo)) } })).status, 401, 'la firma de otro cuerpo no vale');
        const sinFirma = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(otro) });
        assert.equal(sinFirma.status, 401);
        assert.equal((await postMeta(avisoLead('900000000000999'), 'secreto-equivocado')).status, 401);
        assert.equal(await cuantos(), antes + 1, 'lo no firmado no se guarda');
        assert.equal((await postWhatsApp(null, { crudo: 'esto no es json' })).status, 400);

        // Sin secreto: fuera de producción se admite con firma_ok NULL; en producción, rechazo.
        const sinSecreto = ponerEntorno({ WHATSAPP_APP_SECRET: undefined });
        try {
          const s = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aviso({ estados: [estado('wamid.NO-EXISTE-3', 'read')] })) });
          assert.equal(s.status, 200);
          assert.equal((await uno('SELECT firma_ok FROM webhooks ORDER BY id DESC LIMIT 1')).firma_ok, null);
          const produccion = ponerEntorno({ NODE_ENV: 'production' });
          try {
            const p = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aviso({ estados: [estado('wamid.NO-EXISTE-4', 'read')] })) });
            assert.equal(p.status, 503);
          } finally { produccion(); }
          // 360dialog no firma con el secreto de nuestra app: clave compartida en X-Clave.
          const clave = ponerEntorno({ WHATSAPP_WEBHOOK_CLAVE: 'clave-360dialog-de-pruebas' });
          try {
            const cuerpo360 = JSON.stringify(aviso({ estados: [estado('wamid.NO-EXISTE-5', 'read')] }));
            const bien = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clave': 'clave-360dialog-de-pruebas' }, body: cuerpo360 });
            assert.equal(bien.status, 200);
            assert.equal((await uno('SELECT firma_ok FROM webhooks ORDER BY id DESC LIMIT 1')).firma_ok, 1);
            const mal = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clave': 'otra' }, body: cuerpo360 });
            assert.equal(mal.status, 401);
          } finally { clave(); }
        } finally { sinSecreto(); }
        await procesar(martes);
        assert.equal((await uno("SELECT COUNT(*) AS n FROM webhooks WHERE proveedor = 'whatsapp' AND procesado_en IS NULL")).n, 0);
      });

      await t.test('texto: 200 al momento, el cron lo procesa y la IA contesta presentándose', async () => {
        const r = await postWhatsApp(aviso({ de: '34611000501', perfil: 'lucía prueba 🌸', mensajes: [texto('34611000501', 'Hola, quiero información')] }));
        assert.equal(r.status, 200);
        assert.equal(whatsapp.enviados.length, 0, 'la ruta no contesta nada: eso lo hace el cron');
        const res = await procesar(martes);
        assert.equal(res.hechos, 1);
        const conv = await conversacionDe('+34611000501');
        const msgs = await mensajesDe(conv.id);
        assert.deepEqual(msgs.map((m) => [m.direccion, m.autor, m.tipo, m.estado]), [['entrante', 'paciente', 'texto', 'recibido'], ['saliente', 'ia', 'texto', 'enviado']]);
        assert.equal(msgs[0].texto, 'Hola, quiero información');
        assert.match(msgs[1].texto, /^Soy el asistente virtual de IEMEC\. \S+ \S*,? ?Lucía\./, 'se presenta y saluda con el nombre de su perfil');
        assert.equal(whatsapp.enviados.at(-1).telefono, '+34611000501');
        assert.ok(conv.ventana_hasta > martes, 'se abre la ventana de 24 h');
        assert.equal(conv.nombre_whatsapp, 'Lucía Prueba', 'y la bandeja lo ve por su nombre');
        const w = await uno('SELECT cuerpo, procesado_en, error FROM webhooks WHERE id_externo = ?', [msgs[0].wa_id]);
        assert.ok(w.procesado_en);
        assert.equal(w.error, null);
        assert.doesNotMatch(w.cuerpo, /quiero información|Lucía|lucía/, 'el cuerpo guardado va cifrado');
        assert.match(entrada.descifrarCuerpo(w.cuerpo), /"body":"Hola, quiero información"/, 'y se puede leer tal cual llegó');
      });

      await t.test('el mismo wamid dos veces → un solo mensaje', async () => {
        const m = texto('34611000502', 'Me lo pienso y os digo');
        const cuerpo = aviso({ mensajes: [m] });
        assert.equal((await postWhatsApp(cuerpo)).status, 200);
        assert.equal((await postWhatsApp(cuerpo)).status, 200, 'Meta lo repite: se contesta 200 igual');
        assert.equal((await uno('SELECT COUNT(*) AS n FROM webhooks WHERE id_externo = ?', [m.id])).n, 1);
        // Y otra vez dentro de otro aviso con un mensaje nuevo: el repetido no se procesa dos veces.
        const nuevo = texto('34611000502', 'Bueno, mejor el mes que viene');
        assert.equal((await postWhatsApp(aviso({ mensajes: [m, nuevo] }))).status, 200);
        await procesar(mas(martes, 1));
        const conv = await conversacionDe('+34611000502');
        const msgs = await mensajesDe(conv.id);
        assert.equal(msgs.filter((x) => x.wa_id === m.id).length, 1);
        assert.deepEqual(msgs.filter((x) => x.direccion === 'entrante').map((x) => x.texto), ['Me lo pienso y os digo', 'Bueno, mejor el mes que viene']);
        assert.equal(msgs.filter((x) => x.autor === 'ia').length, 2, 'una respuesta por mensaje, no por aviso');
      });

      await t.test('botón de plantilla → su texto: la repesca propone huecos; interactivo «La primera» → cita', async () => {
        const [l] = await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611000503', 'Clara Botón', 'meta_formulario', 'limpieza-facial')");
        await R.inscribir(pool, { secuencia: 'lead', leadId: l.insertId, inicio: martes });
        await R.avanzarSecuencias(deps, { ahora: martes });
        const plantilla = whatsapp.enviados.at(-1);
        assert.equal(plantilla.nombre, 'iemec_lead_bienvenida');

        const boton = { from: '34611000503', id: wamid(), timestamp: marca, type: 'button', context: { id: plantilla.waId }, button: { text: 'Sí, búscame hueco', payload: 'Sí, búscame hueco' } };
        await postWhatsApp(aviso({ de: '34611000503', perfil: 'Clarita', mensajes: [boton] }));
        await procesar(mas(martes, 10));
        const conv = await conversacionDe('+34611000503');
        let msgs = await mensajesDe(conv.id);
        const entrante = msgs.find((m) => m.wa_id === boton.id);
        assert.deepEqual([entrante.tipo, entrante.texto], ['boton', 'Sí, búscame hueco']);
        assert.match(msgs.at(-1).texto, /Genial, Clara! Tengo estos huecos para ti/, 'saluda con el nombre del lead, no con el del perfil');
        assert.ok((await conversacionDe('+34611000503')).huecos_ofrecidos);
        assert.equal((await uno('SELECT estado FROM inscripciones WHERE lead_id = ?', [l.insertId])).estado, 'pausada', 'ha contestado: se para su secuencia');

        const opcion = { from: '34611000503', id: wamid(), timestamp: marca, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'h1', title: 'La primera' } } };
        await postWhatsApp(aviso({ mensajes: [opcion] }));
        await procesar(mas(martes, 15));
        msgs = await mensajesDe(conv.id);
        assert.equal(msgs.find((m) => m.wa_id === opcion.id).tipo, 'interactivo');
        assert.match(msgs.at(-1).texto, /^¡Hecho, Clara! Te esperamos/);
        const lead = await uno('SELECT etapa, paciente_id FROM leads WHERE id = ?', [l.insertId]);
        assert.equal(lead.etapa, 'cita');
        assert.equal((await uno('SELECT COUNT(*) AS n FROM citas WHERE paciente_id = ?', [lead.paciente_id])).n, 1);
      });

      await t.test('audio → se registra, pasa a una persona con tarea y se le avisa; lo que sigue no duplica la tarea', async () => {
        const audio = { from: '34611000501', id: wamid(), timestamp: marca, type: 'audio', audio: { id: 'MEDIA-PRUEBA-1', mime_type: 'audio/ogg; codecs=opus', voice: true } };
        await postWhatsApp(aviso({ mensajes: [audio] }));
        await procesar(mas(martes, 20));
        const conv = await conversacionDe('+34611000501');
        assert.equal(conv.estado, 'espera_persona');
        assert.equal(conv.proximo_paso, 'persona');
        let msgs = await mensajesDe(conv.id);
        const registrado = msgs.find((m) => m.wa_id === audio.id);
        assert.deepEqual([registrado.tipo, registrado.texto, registrado.direccion], ['audio', '[audio]', 'entrante']);
        assert.match(msgs.at(-1).texto, /^Gracias, Lucía\. Ahora mismo no puedo escuchar audios/, 'sin perfil en este aviso, el nombre sale de la conversación; y ya se presentó: no lo repite');
        const tareas = await q("SELECT * FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [conv.id]);
        assert.equal(tareas.length, 1);
        assert.deepEqual([tareas[0].tipo, tareas[0].titulo], ['atender_conversacion', 'Ha mandado un audio: escucharlo y contestar']);

        const salientes = msgs.filter((m) => m.direccion === 'saliente').length;
        const otro = { ...audio, id: wamid() };
        const sticker = { from: '34611000501', id: wamid(), timestamp: marca, type: 'sticker', sticker: { id: 'MEDIA-PRUEBA-2', mime_type: 'image/webp' } };
        await postWhatsApp(aviso({ mensajes: [otro, sticker] }));
        await procesar(mas(martes, 21));
        msgs = await mensajesDe(conv.id);
        assert.deepEqual(msgs.slice(-2).map((m) => m.texto), ['[audio]', '[sticker]']);
        assert.equal(msgs.filter((m) => m.direccion === 'saliente').length, salientes, 'ya la lleva una persona: no se le contesta otra vez');
        assert.equal((await q("SELECT id FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [conv.id])).length, 1);
      });

      await t.test('foto con una urgencia en la leyenda → por la repesca: persona con prisa y el 112', async () => {
        await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Eva', '+34611000505')");
        const foto = { from: '34611000505', id: wamid(), timestamp: marca, type: 'image', image: { id: 'MEDIA-PRUEBA-3', mime_type: 'image/jpeg', caption: 'Me ha salido un bulto en el labio y me duele mucho' } };
        await postWhatsApp(aviso({ mensajes: [foto] }));
        await procesar(mas(martes, 25));
        const conv = await conversacionDe('+34611000505');
        assert.equal(conv.urgente, 1);
        const msgs = await mensajesDe(conv.id);
        assert.deepEqual([msgs[0].tipo, msgs[0].texto], ['imagen', '[imagen] Me ha salido un bulto en el labio y me duele mucho']);
        assert.match(msgs.at(-1).texto, /112/);
        assert.equal((await uno("SELECT urgente FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [conv.id])).urgente, 1);
      });

      await t.test('anuncio que abre WhatsApp (referral) → lead con su ctwa_clid antes del mensaje, y la IA contesta', async () => {
        const m = texto('34611000506', 'Hola, quiero más información', {
          referral: { source_url: 'https://fb.me/anuncio-prueba', source_id: '120200000000506', source_type: 'ad', headline: 'Mesoterapia capilar', body: 'Texto del anuncio', media_type: 'image', ctwa_clid: 'ARAkPRUEBA-clid-506' },
        });
        await postWhatsApp(aviso({ de: '34611000506', perfil: 'marta PRUEBA', mensajes: [m] }));
        await procesar(mas(martes, 30));
        const lead = await uno("SELECT * FROM leads WHERE telefono = '+34611000506'");
        assert.deepEqual([lead.origen, lead.ctwa_clid, lead.anuncio, lead.anuncio_id, lead.nombre, lead.tratamiento_interes_id, lead.etapa],
          ['meta_ctwa', 'ARAkPRUEBA-clid-506', 'Mesoterapia capilar', '120200000000506', 'Marta Prueba', 'mesoterapia-capilar', 'conversando']);
        assert.deepEqual(json(lead.utm), { tipo_fuente: 'ad', url_fuente: 'https://fb.me/anuncio-prueba' });
        assert.equal((await uno('SELECT COUNT(*) AS n FROM inscripciones WHERE lead_id = ?', [lead.id])).n, 0, 'ya está hablando con la IA: sin secuencia');
        const conv = await conversacionDe('+34611000506');
        assert.deepEqual([conv.lead_id, conv.contexto, conv.contexto_id], [lead.id, 'lead', lead.id]);
        const msgs = await mensajesDe(conv.id);
        assert.equal(msgs[0].texto, 'Hola, quiero más información');
        assert.equal(msgs.at(-1).autor, 'ia');
        assert.match(msgs.at(-1).texto, /^Soy el asistente virtual de IEMEC\. .*Marta/);

        // Vuelve a pinchar en otro anuncio: el mismo lead, sin duplicar.
        const otra = texto('34611000506', 'Otra vez yo', { referral: { source_id: '120200000000507', source_type: 'ad', headline: 'Otro anuncio', ctwa_clid: 'ARAkPRUEBA-clid-507' } });
        await postWhatsApp(aviso({ mensajes: [otra] }));
        await procesar(mas(martes, 32));
        assert.equal((await uno("SELECT COUNT(*) AS n FROM leads WHERE telefono = '+34611000506'")).n, 1);
        assert.equal((await uno("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'lead_repetido' AND entidad_id = ?", [String(lead.id)])).n, 1);
      });

      await t.test('reacción: queda en la conversación del mensaje, sin tarea ni respuesta', async () => {
        const conv = await conversacionDe('+34611000506');
        const antes = await mensajesDe(conv.id);
        const tareas = async () => (await q('SELECT id FROM tareas WHERE conversacion_id = ?', [conv.id])).length;
        const tareasAntes = await tareas();
        const nuestro = antes.find((m) => m.autor === 'ia');
        const reaccion = { from: '34611000506', id: wamid(), timestamp: marca, type: 'reaction', reaction: { message_id: nuestro.wa_id, emoji: '❤️' } };
        await postWhatsApp(aviso({ mensajes: [reaccion] }));
        await procesar(mas(martes, 33));
        const despues = await mensajesDe(conv.id);
        assert.equal(despues.length, antes.length + 1);
        assert.deepEqual([despues.at(-1).wa_id, despues.at(-1).tipo, despues.at(-1).texto], [reaccion.id, 'reaccion', '[reacción ❤️]']);
        assert.equal(await tareas(), tareasAntes);
      });

      await t.test('estados: entregado y leído sin volver atrás; lo que no llega, con su motivo en el panel', async () => {
        const lucia = await conversacionDe('+34611000501');
        const respuesta = (await mensajesDe(lucia.id)).find((m) => m.autor === 'ia');
        await postWhatsApp(aviso({ estados: [estado(respuesta.wa_id, 'sent'), estado(respuesta.wa_id, 'delivered')] }));
        await postWhatsApp(aviso({ estados: [estado(respuesta.wa_id, 'read')] }));
        await postWhatsApp(aviso({ estados: [estado(respuesta.wa_id, 'delivered'), estado('wamid.QUE-NO-ES-NUESTRO', 'read')] }));
        await procesar(mas(martes, 40));
        assert.equal((await uno('SELECT estado FROM mensajes WHERE id = ?', [respuesta.id])).estado, 'leido', 'el «entregado» que llega tarde no lo baja');

        // La plantilla de Clara no llega por el límite de marketing de Meta: se ve, sin tarea.
        const clara = await conversacionDe('+34611000503');
        const plantilla = (await mensajesDe(clara.id)).find((m) => m.tipo === 'plantilla');
        await postWhatsApp(aviso({ estados: [estado(plantilla.wa_id, 'failed', [{ code: 131049, title: 'This message was not delivered to maintain healthy ecosystem engagement.' }])] }));
        // La respuesta de la IA a 502 tampoco llega: esa sí es trabajo para una persona.
        const conv502 = await conversacionDe('+34611000502');
        const ultima = (await mensajesDe(conv502.id)).filter((m) => m.autor === 'ia').at(-1);
        await postWhatsApp(aviso({ estados: [estado(ultima.wa_id, 'failed', [{ code: 131026, title: 'Message undeliverable' }])] }));
        await procesar(mas(martes, 41));

        const f = await uno('SELECT estado, error_codigo, error_texto FROM mensajes WHERE id = ?', [plantilla.id]);
        assert.deepEqual([f.estado, f.error_codigo], ['fallido', '131049']);
        assert.match(f.error_texto, /límite de mensajes de marketing/);
        assert.equal((await q("SELECT id FROM tareas WHERE conversacion_id = ? AND titulo LIKE 'No le ha llegado%'", [clara.id])).length, 0);
        const detalle = await panel(`/conversaciones/${clara.id}`);
        const enPanel = detalle.mensajes.find((m) => m.id === plantilla.id);
        assert.equal(enPanel.estado, 'fallido');
        assert.equal(enPanel.error.codigo, '131049');
        assert.match(enPanel.error.texto, /marketing/);

        assert.equal((await uno('SELECT estado FROM conversaciones WHERE id = ?', [conv502.id])).estado, 'espera_persona');
        assert.match((await uno("SELECT titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [conv502.id])).titulo, /^No le ha llegado nuestro mensaje \(No se puede entregar/);
        const lista = await panel('/conversaciones');
        assert.equal(lista.find((c) => c.id === conv502.id).noEntregado, true);
        assert.equal(lista.find((c) => c.id === lucia.id).noEntregado, false);
      });

      await t.test('una ráfaga de estados no hace esperar al mensaje de un paciente', async () => {
        for (let i = 0; i < 5; i++) await postWhatsApp(aviso({ estados: [estado(`wamid.RAFAGA-${i}`, 'delivered')] }));
        const m = texto('34611000502', '¿Me llamáis mañana?');
        await postWhatsApp(aviso({ mensajes: [m] }));
        // Con sitio para un solo trabajo de mensajes, el del paciente pasa por delante de los estados.
        const r = await entrada.procesarPendientes(deps, { ahora: mas(martes, 42), limite: 1 });
        assert.equal(r.hechos, 6);
        assert.ok(await uno('SELECT id FROM mensajes WHERE wa_id = ?', [m.id]));
        assert.equal((await uno("SELECT COUNT(*) AS n FROM cola WHERE tipo LIKE 'webhook_%' AND estado <> 'hecho'")).n, 0);
      });

      await t.test('131050 (ha dejado de recibir marketing en WhatsApp) → baja comercial y secuencias canceladas', async () => {
        const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono, es_cliente) VALUES ('Ana', '+34611000511', TRUE)");
        await R.inscribir(pool, { secuencia: 'toca_repetir', pacienteId: p.insertId, inicio: martes });
        await R.avanzarSecuencias(deps, { ahora: mas(martes, 45) });
        const env = whatsapp.enviados.at(-1);
        assert.equal(env.nombre, 'iemec_toca_repetir');
        await postWhatsApp(aviso({ estados: [estado(env.waId, 'failed', [{ code: 131050, title: 'User has stopped marketing messages' }])] }));
        await procesar(mas(martes, 46));
        assert.ok((await uno('SELECT baja_comercial_en FROM pacientes WHERE id = ?', [p.insertId])).baja_comercial_en);
        const c = await uno("SELECT estado, fuente, prueba FROM consentimientos WHERE paciente_id = ? AND tipo = 'whatsapp_marketing'", [p.insertId]);
        assert.deepEqual([c.estado, c.fuente], ['revocado', 'whatsapp']);
        assert.match(c.prueba, /^Meta 131050/);
        assert.equal((await uno('SELECT estado FROM inscripciones WHERE paciente_id = ?', [p.insertId])).estado, 'cancelada');
      });

      await t.test('formulario de Meta → lead con su campaña y su tratamiento, inscrito, y el primer mensaje sale con avanzarSecuencias', async () => {
        meta.leads.set('900000000000101', {
          created_time: '2026-10-06T10:00:00+0000', campaign_id: '100000000000101', campaign_name: 'Otoño facial', adset_id: '600000000000101', adset_name: 'Mujeres 30-55 Boadilla',
          ad_id: '700000000000101', ad_name: 'Vídeo limpieza', form_id: '800000000000101', platform: 'ig', is_organic: false,
          field_data: [
            { name: 'full_name', values: ['Laura Formulario'] }, { name: 'phone_number', values: ['611 000 521'] }, { name: 'email', values: ['Laura.Formulario@Ejemplo.com'] },
            { name: '¿qué_tratamiento_te_interesa?', values: ['Limpieza facial profunda'] }, { name: '¿cuándo_prefieres_que_te_llamemos?', values: ['Por la tarde'] },
          ],
        });
        const r = await postMeta(avisoLead('900000000000101', { ad_id: '700000000000101' }));
        assert.equal(r.status, 200);
        assert.equal((await postMeta(avisoLead('900000000000101', { ad_id: '700000000000101' }))).status, 200, 'repetido: 200 igual');
        const w = await q("SELECT id, evento, firma_ok FROM webhooks WHERE proveedor = 'meta' AND id_externo = 'leadgen:900000000000101'");
        assert.equal(w.length, 1, 'y se guarda una sola vez');
        assert.deepEqual([w[0].evento, w[0].firma_ok], ['leadgen', 1]);
        await procesar(martes);
        assert.deepEqual(meta.pedidos, ['900000000000101']);

        const lead = await uno("SELECT * FROM leads WHERE id_externo = '900000000000101'");
        assert.deepEqual([lead.origen, lead.telefono, lead.nombre, lead.email, lead.campana, lead.conjunto, lead.anuncio, lead.anuncio_id, lead.tratamiento_interes_id, lead.etapa],
          ['meta_formulario', '+34611000521', 'Laura Formulario', 'laura.formulario@ejemplo.com', 'Otoño facial', 'Mujeres 30-55 Boadilla', 'Vídeo limpieza', '700000000000101', 'limpieza-facial', 'nuevo']);
        assert.deepEqual(json(lead.utm), { plataforma: 'ig', formulario_id: '800000000000101', campana_id: '100000000000101', conjunto_id: '600000000000101', organico: false });
        assert.deepEqual(JSON.parse(descifrar(lead.respuestas_cifradas, lead.respuestas_iv, lead.respuestas_tag)), [
          { pregunta: '¿Qué tratamiento te interesa?', valor: 'Limpieza facial profunda' }, { pregunta: '¿Cuándo prefieres que te llamemos?', valor: 'Por la tarde' },
        ]);
        const ins = await uno('SELECT * FROM inscripciones WHERE lead_id = ?', [lead.id]);
        assert.deepEqual([ins.secuencia, ins.estado, ins.paso_actual], ['lead', 'activa', 0]);
        assert.equal(ins.siguiente_en.getTime(), martes.getTime(), 'en horario de envío: sale ya');

        const antes = whatsapp.enviados.length;
        await R.avanzarSecuencias(deps, { ahora: ins.siguiente_en });
        const primero = whatsapp.enviados.slice(antes).find((e) => e.telefono === '+34611000521');
        assert.deepEqual([primero.tipo, primero.nombre, primero.variables], ['plantilla', 'iemec_lead_bienvenida', ['Laura', 'limpieza facial profunda']]);
        assert.equal((await uno('SELECT etapa FROM leads WHERE id = ?', [lead.id])).etapa, 'contactado');

        // Llega otra vez por Meta (otro formulario, mismo teléfono): ni se duplica ni vuelve a empezar.
        meta.leads.set('900000000000102', { campaign_name: 'Otra campaña', field_data: [{ name: 'full_name', values: ['Laura F.'] }, { name: 'phone_number', values: ['+34 611 000 521'] }] });
        await postMeta(avisoLead('900000000000102'));
        await procesar(mas(martes, 2));
        assert.equal((await uno("SELECT COUNT(*) AS n FROM leads WHERE telefono = '+34611000521'")).n, 1);
        const ins2 = await q('SELECT paso_actual, estado FROM inscripciones WHERE lead_id = ?', [lead.id]);
        assert.deepEqual(ins2.map((x) => [x.paso_actual, x.estado]), [[1, 'activa']]);
      });

      await t.test('mapeo: la campaña dice el tratamiento cuando el formulario no pregunta; y el cron hace todo en una vuelta', async () => {
        await pool.query("INSERT INTO mapeo_tratamientos (clave, tratamiento_id, notas) VALUES ('Campaña capilar otoño', 'mesoterapia-capilar', 'prueba')");
        meta.leads.set('900000000000103', { campaign_name: 'CAMPAÑA CAPILAR OTOÑO', ad_name: 'Anuncio 3 - copia', field_data: [{ name: 'full_name', values: ['Rosa Mapeo'] }, { name: 'phone_number', values: ['611000523'] }] });
        await postMeta(avisoLead('900000000000103'));
        const antes = whatsapp.enviados.length;
        const informe = await cron.vuelta({ pool, deps, ahora: mas(martes, 3) });
        assert.equal(informe.entrada.hechos, 1);
        const lead = await uno("SELECT id, tratamiento_interes_id FROM leads WHERE id_externo = '900000000000103'");
        assert.equal(lead.tratamiento_interes_id, 'mesoterapia-capilar');
        const primero = whatsapp.enviados.slice(antes).find((e) => e.telefono === '+34611000523');
        assert.deepEqual(primero?.variables, ['Rosa', 'mesoterapia capilar'], 'la entrada va antes que las secuencias: sale en la misma vuelta');
      });

      await t.test('sin teléfono válido → tarea para recepción y sin secuencia', async () => {
        meta.leads.set('900000000000104', { campaign_name: 'Otoño facial', field_data: [{ name: 'full_name', values: ['Sin Teléfono'] }, { name: 'phone_number', values: ['612 34'] }, { name: 'email', values: ['sin.telefono@ejemplo.com'] }] });
        await postMeta(avisoLead('900000000000104'));
        await procesar(mas(martes, 4));
        const lead = await uno("SELECT id, telefono, email FROM leads WHERE id_externo = '900000000000104'");
        assert.deepEqual([lead.telefono, lead.email], [null, 'sin.telefono@ejemplo.com']);
        assert.equal((await uno('SELECT COUNT(*) AS n FROM inscripciones WHERE lead_id = ?', [lead.id])).n, 0);
        const tarea = await uno('SELECT tipo, titulo, estado FROM tareas WHERE lead_id = ?', [lead.id]);
        assert.equal(tarea.tipo, 'otro');
        assert.equal(tarea.titulo, 'Sin Teléfono: sin teléfono válido («612 34»). Escribirle a sin.telefono@ejemplo.com (formulario de Meta · Otoño facial)');
      });

      await t.test('paciente con baja comercial: el lead entra, pero no se le inscribe', async () => {
        const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono, baja_comercial_en) VALUES ('Berta', '+34611000531', ?)", [mas(martes, -10000)]);
        meta.leads.set('900000000000105', { campaign_name: 'Otoño facial', field_data: [{ name: 'full_name', values: ['Berta Baja'] }, { name: 'phone_number', values: ['611000531'] }] });
        await postMeta(avisoLead('900000000000105'));
        await procesar(mas(martes, 5));
        const lead = await uno("SELECT id, paciente_id FROM leads WHERE id_externo = '900000000000105'");
        assert.equal(lead.paciente_id, p.insertId);
        assert.equal((await uno('SELECT COUNT(*) AS n FROM inscripciones WHERE lead_id = ?', [lead.id])).n, 0);
        assert.match((await uno('SELECT titulo FROM tareas WHERE lead_id = ?', [lead.id])).titulo, /baja de mensajes comerciales/);
      });

      await t.test('medicamento con receta: el lead lo guarda, pero el primer mensaje no lo nombra', async () => {
        meta.leads.set('900000000000106', { campaign_name: 'Rejuvenecimiento', field_data: [{ name: 'full_name', values: ['Irene Receta'] }, { name: 'phone_number', values: ['611000536'] }, { name: 'tratamiento_de_interés', values: ['Botox'] }] });
        await postMeta(avisoLead('900000000000106'));
        await procesar(mas(martes, 6));
        const lead = await uno("SELECT id, tratamiento_interes_id FROM leads WHERE id_externo = '900000000000106'");
        assert.equal(lead.tratamiento_interes_id, 'toxina-botulinica');
        const antes = whatsapp.enviados.length;
        await R.avanzarSecuencias(deps, { ahora: mas(martes, 7) });
        const primero = whatsapp.enviados.slice(antes).find((e) => e.telefono === '+34611000536');
        assert.deepEqual(primero.variables, ['Irene', 'medicina estética facial']);
        const conv = await conversacionDe('+34611000536');
        assert.doesNotMatch((await mensajesDe(conv.id)).at(-1).texto, /toxina|botul|botox/i);
      });

      await t.test('POST /api/leads: con clave, alta y secuencia; sin clave, 401; teléfono mal formado → tarea', async () => {
        assert.equal((await postLead({ telefono: '611000541' }, null)).status, 401);
        assert.equal((await postLead({ telefono: '611000541' }, 'clave-equivocada')).status, 401);
        const sinClave = ponerEntorno({ LEADS_CLAVE: undefined });
        try { assert.equal((await postLead({ telefono: '611000541' })).status, 503, 'sin LEADS_CLAVE la entrada está cerrada'); } finally { sinClave(); }
        assert.equal((await postLead({ nombre: 'Sin contacto' })).status, 400);

        const r = await postLead({ telefono: '611 000 541', nombre: 'Web Prueba', email: 'web@ejemplo.com', tratamiento: 'higiene facial', codigo_web: 'OTO26-FAC', utm_source: 'google', utm_campaign: 'otono-facial', mensaje: '¿Tenéis cita el sábado?' });
        assert.equal(r.status, 201);
        const cuerpo = await r.json();
        assert.deepEqual([cuerpo.nuevo, cuerpo.inscrito, cuerpo.motivo, cuerpo.tratamiento], [true, true, null, 'limpieza-facial']);
        const lead = await uno('SELECT * FROM leads WHERE id = ?', [cuerpo.leadId]);
        assert.deepEqual([lead.origen, lead.telefono, lead.codigo_web, lead.campana], ['web', '+34611000541', 'OTO26-FAC', 'otono-facial']);
        assert.deepEqual(json(lead.utm), { utm_source: 'google', utm_campaign: 'otono-facial' });
        const ins = await uno('SELECT siguiente_en FROM inscripciones WHERE lead_id = ?', [lead.id]);
        const antes = whatsapp.enviados.length;
        await R.avanzarSecuencias(deps, { ahora: ins.siguiente_en });
        assert.ok(whatsapp.enviados.slice(antes).some((e) => e.telefono === '+34611000541' && e.nombre === 'iemec_lead_bienvenida'), 'le sale su primer mensaje');

        const otra = await postLead({ telefono: '+34611000541', nombre: 'Web Prueba' });
        assert.equal(otra.status, 200);
        assert.deepEqual(await otra.json(), { ok: true, leadId: lead.id, nuevo: false, inscrito: false, motivo: 'en_marcha', tratamiento: 'limpieza-facial' }, 'dice el interés que tiene el lead');

        const mal = await postLead({ telefono: '61100', nombre: 'Tel Mal', email: 'tel.mal@ejemplo.com', origen: 'ghl', id_externo: 'ghl-envio-prueba-1', id_contacto: 'ghl-contacto-prueba-1' });
        assert.equal(mal.status, 201);
        const cm = await mal.json();
        assert.deepEqual([cm.inscrito, cm.motivo], [false, 'sin_telefono']);
        const lm = await uno('SELECT telefono, origen, ghl_contact_id FROM leads WHERE id = ?', [cm.leadId]);
        assert.deepEqual([lm.telefono, lm.origen, lm.ghl_contact_id], [null, 'ghl', 'ghl-contacto-prueba-1']);
        assert.equal((await uno('SELECT titulo FROM tareas WHERE lead_id = ?', [cm.leadId])).titulo, 'Tel Mal: sin teléfono válido («61100»). Escribirle a tel.mal@ejemplo.com (GHL)');

        const fijo = await (await postLead({ telefono: '912 345 678', nombre: 'Tel Fijo' })).json();
        assert.deepEqual([fijo.inscrito, fijo.motivo], [false, 'telefono_fijo']);
        const tf = await uno('SELECT tipo, titulo FROM tareas WHERE lead_id = ?', [fijo.leadId]);
        assert.deepEqual([tf.tipo, tf.titulo], ['llamar', 'Llamar a Tel Fijo al 912 34 56 78: ha dejado un teléfono fijo, sin WhatsApp (web)'], 'con su número: sin conversación, solo está en la tarea');
      });
    });
  } finally {
    restaurar();
    await pool.end();
  }
});

// Lo que encontró la revisión, con su propia base: leads que ya estaban hablando, bajas que se
// recuerdan, adjuntos, el orden de los mensajes con dos cron a la vez, leads de Meta que no se pueden
// leer, tareas que se ven y avisos de otros números o páginas.
test('entrada de leads y WhatsApp: lo que encontró la revisión', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const restaurar = ponerEntorno({ ...ENTORNO, WHATSAPP_NUMERO_ID: undefined, META_PAGINA_ID: undefined, MODO_META: undefined });
  const whatsapp = crearWhatsApp('simulado');
  const meta = crearMeta('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp, meta };
  let llegada = martes; // la hora a la que entra lo que llega por el puerto
  const enviadosA = (telefono) => whatsapp.enviados.filter((e) => e.telefono === telefono);
  try {
    await sembrar(pool);
    await pool.query("UPDATE clinica SET telefono = '+34916000000' WHERE id = 1");
    await conServidor(crearApp({ pool, reloj: () => llegada }), async (base) => {
      const { q, uno, procesar, conversacionDe, mensajesDe, postWhatsApp, postMeta, postLead, panel } = ayudas({ pool, deps, base });

      await t.test('dos cron a la vez con la IA lenta: los mensajes de un paciente se contestan en orden', async () => {
        // La IA «de verdad» tarda: la vuelta pasa de su minuto y el cron siguiente entra a la vez.
        const lenta = {
          modo: 'real',
          async interpretar({ texto: tx }) { await dormir(120); return { ...interpretar(tx), fuente: 'ia' }; },
          async redactar() { await dormir(120); return null; },
        };
        const depsLenta = { ...deps, ia: lenta };
        for (const i of [1, 2, 3, 4]) await postWhatsApp(aviso({ mensajes: [texto(`3461100062${i}`, 'Hola, quiero información', en(martes))] }));
        await postWhatsApp(aviso({ mensajes: [texto('34611000620', 'Hola, soy Lola. Quería información de la limpieza facial', en(martes))] }));
        const primera = cron.vuelta({ pool, deps: depsLenta, ahora: martes });
        await dormir(150);
        await postWhatsApp(aviso({ mensajes: [texto('34611000620', '¿Y qué precio tiene?', en(mas(martes, 1)))] }));
        const segunda = await cron.vuelta({ pool, deps: depsLenta, ahora: mas(martes, 1.05) }); // el candado de 55 s ya caducó
        assert.equal(segunda.saltado, undefined, 'las dos vueltas van a la vez');
        assert.equal(segunda.entrada.aplazados, 1, 'el segundo mensaje de Lola espera a que acabe el primero');
        assert.equal((await primera).entrada.hechos, 5);
        await cron.vuelta({ pool, deps: depsLenta, ahora: mas(martes, 2.2) });
        const msgs = await mensajesDe((await conversacionDe('+34611000620')).id);
        assert.deepEqual(msgs.map((m) => m.autor), ['paciente', 'ia', 'paciente', 'ia']);
        assert.deepEqual([msgs[0].texto, msgs[2].texto], ['Hola, soy Lola. Quería información de la limpieza facial', '¿Y qué precio tiene?']);
      });

      await t.test('la hora es la del mensaje: procesado 15 minutos tarde, su ventana de 24 h cuenta desde que lo escribió', async () => {
        const escrito = mas(martes, 5);
        await postWhatsApp(aviso({ mensajes: [texto('34611000630', 'Hola, ¿tenéis cita el sábado?', en(escrito))] }));
        await procesar(mas(escrito, 15));
        const conv = await conversacionDe('+34611000630');
        assert.equal(conv.ultimo_entrante_en.getTime(), escrito.getTime());
        assert.equal(conv.ventana_hasta.getTime(), mas(escrito, 24 * 60).getTime());
        assert.equal((await mensajesDe(conv.id))[0].creado_en.getTime(), escrito.getTime());
      });

      await t.test('conversación que lleva una persona + formulario: el lead se queda con ella, sin plantilla y con tarea; su BAJA lo para todo', async () => {
        const tel = '+34611000601';
        await postWhatsApp(aviso({ de: '34611000601', perfil: 'Rocío', mensajes: [texto('34611000601', 'Hola, ¿qué precio tiene la limpieza facial?', en(martes))] }));
        await procesar(martes);
        let conv = await conversacionDe(tel);
        assert.deepEqual([conv.estado, conv.lead_id], ['espera_persona', null]);

        llegada = mas(martes, 30);
        const r = await (await postLead({ telefono: '611000601', nombre: 'Rocío Persona', tratamiento: 'limpieza-facial' })).json();
        assert.deepEqual([r.nuevo, r.inscrito, r.motivo], [true, false, 'conversacion']);
        conv = await conversacionDe(tel);
        assert.deepEqual([conv.lead_id, conv.contexto, conv.contexto_id], [r.leadId, 'lead', r.leadId], 'el lead se queda con su conversación');
        const tarea = await uno('SELECT tipo, titulo FROM tareas WHERE lead_id = ? AND conversacion_id = ?', [r.leadId, conv.id]);
        assert.deepEqual([tarea.tipo, tarea.titulo], ['atender_conversacion', 'Rocío Persona ha pedido información de limpieza facial profunda: contestarle en su conversación (web)']);
        assert.equal((await uno('SELECT COUNT(*) AS n FROM inscripciones WHERE lead_id = ?', [r.leadId])).n, 0, 'ni bienvenida ni secuencia en mitad de una conversación con una persona');

        await postWhatsApp(aviso({ mensajes: [texto('34611000601', 'BAJA', en(mas(martes, 40)))] }));
        await procesar(mas(martes, 40));
        const lead = await uno('SELECT etapa, motivo_perdida FROM leads WHERE id = ?', [r.leadId]);
        assert.deepEqual([lead.etapa, lead.motivo_perdida], ['perdido', 'baja'], 'la baja se aplica aunque la lleve una persona');
        assert.equal((await uno('SELECT fuente FROM bajas_comerciales WHERE telefono = ?', [tel])).fuente, 'whatsapp');
        assert.match(enviadosA(tel).at(-1).texto, /No volverás a recibir mensajes nuestros/);
      });

      await t.test('conversación con la IA y la ventana cerrada + formulario: la bienvenida sale en esa conversación; su BAJA para la secuencia y se recuerda', async () => {
        const tel = '+34611000602';
        llegada = martes;
        await postWhatsApp(aviso({ mensajes: [texto('34611000602', 'Hola, quiero información', en(martes))] }));
        await procesar(martes);
        const conv = await conversacionDe(tel);
        assert.equal(conv.lead_id, null);

        const jueves = mas(martes, 2 * 1440); // la ventana de 24 h ya se cerró
        llegada = jueves;
        const r = await (await postLead({ telefono: '611000602', nombre: 'Bea Baja', tratamiento: 'limpieza-facial' })).json();
        assert.deepEqual([r.nuevo, r.inscrito], [true, true]);
        assert.equal((await conversacionDe(tel)).lead_id, r.leadId);
        const ins = await uno('SELECT * FROM inscripciones WHERE lead_id = ?', [r.leadId]);
        await R.avanzarSecuencias(deps, { ahora: ins.siguiente_en });
        const bienvenida = enviadosA(tel).at(-1);
        assert.deepEqual([bienvenida.nombre, bienvenida.variables], ['iemec_lead_bienvenida', ['Bea', 'limpieza facial profunda']]);
        assert.equal((await mensajesDe(conv.id)).at(-1).wa_id, bienvenida.waId, 'en su misma conversación');

        await postWhatsApp(aviso({ mensajes: [texto('34611000602', 'BAJA', en(mas(jueves, 10)))] }));
        await procesar(mas(jueves, 10));
        assert.equal((await uno('SELECT estado FROM inscripciones WHERE id = ?', [ins.id])).estado, 'cancelada');
        const lead = await uno('SELECT etapa, motivo_perdida FROM leads WHERE id = ?', [r.leadId]);
        assert.deepEqual([lead.etapa, lead.motivo_perdida], ['perdido', 'baja']);
        const antes = enviadosA(tel).length;
        await R.avanzarSecuencias(deps, { ahora: mas(jueves, 4 * 60 + 5) });
        assert.equal(enviadosA(tel).length, antes, 'a las 4 h no sale el seguimiento comercial');

        // Una semana después rellena un formulario de Meta: el lead entra, pero no se le inscribe.
        meta.leads.set('900000000000602', { campaign_name: 'Otoño facial', field_data: [{ name: 'full_name', values: ['Bea Baja'] }, { name: 'phone_number', values: ['611000602'] }] });
        llegada = mas(jueves, 7 * 1440);
        await postMeta(avisoLead('900000000000602'));
        await procesar(llegada);
        const otro = await uno("SELECT id FROM leads WHERE id_externo = '900000000000602'");
        assert.equal((await uno('SELECT COUNT(*) AS n FROM inscripciones WHERE lead_id = ?', [otro.id])).n, 0);
        assert.equal((await uno('SELECT titulo FROM tareas WHERE lead_id = ?', [otro.id])).titulo,
          'Bea Baja, 611 00 06 02, pide información, pero tiene la baja de mensajes comerciales: contactar solo si procede (formulario de Meta · Otoño facial)');
        await R.avanzarSecuencias(deps, { ahora: mas(llegada, 60) });
        assert.equal(enviadosA(tel).length, antes, 'y no le vuelve a salir la bienvenida');
      });

      await t.test('hablando ahora con la IA + formulario: sin bienvenida (empieza en el paso de las 4 h) y su respuesta la para', async () => {
        const tel = '+34611000603';
        llegada = martes;
        await postWhatsApp(aviso({ mensajes: [texto('34611000603', 'Hola, quiero información', en(martes))] }));
        await procesar(martes);
        llegada = mas(martes, 20);
        const r = await (await postLead({ telefono: '611000603', nombre: 'Carmen Charla', tratamiento: 'limpieza-facial' })).json();
        assert.deepEqual([r.inscrito, r.motivo], [true, null]);
        const ins = await uno('SELECT * FROM inscripciones WHERE lead_id = ?', [r.leadId]);
        assert.deepEqual([ins.paso_actual, madrid(ins.siguiente_en)], [1, '2026-10-06 16:20']);
        const antes = enviadosA(tel).length;
        await R.avanzarSecuencias(deps, { ahora: mas(martes, 21) });
        assert.equal(enviadosA(tel).length, antes, 'la bienvenida no se mete en su conversación');

        await postWhatsApp(aviso({ mensajes: [texto('34611000603', 'Sí, me interesa', en(mas(martes, 30)))] }));
        await procesar(mas(martes, 30));
        assert.equal((await uno('SELECT estado FROM inscripciones WHERE id = ?', [ins.id])).estado, 'pausada');
        assert.equal((await uno('SELECT etapa FROM leads WHERE id = ?', [r.leadId])).etapa, 'conversando');
        await R.avanzarSecuencias(deps, { ahora: mas(martes, 20 + 245) });
        assert.ok(enviadosA(tel).every((e) => e.tipo !== 'plantilla'), 'ni a las 4 h');
      });

      await t.test('paciente con la conversación de su presupuesto abierta + formulario: tarea en esa conversación, sin secuencia', async () => {
        const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Pilar', '+34611000613')");
        const [pr] = await pool.query("INSERT INTO presupuestos (paciente_id, titulo, importe_eur) VALUES (?, 'Plan capilar', 900)", [p.insertId]);
        await pool.query("INSERT INTO conversaciones (telefono, paciente_id, contexto, contexto_id, estado) VALUES ('+34611000613', ?, 'presupuesto', ?, 'esperando_paciente')", [p.insertId, pr.insertId]);
        llegada = martes;
        const r = await (await postLead({ telefono: '611000613', nombre: 'Pilar Presupuesto', tratamiento: 'limpieza-facial' })).json();
        assert.deepEqual([r.inscrito, r.motivo], [false, 'conversacion']);
        const conv = await conversacionDe('+34611000613');
        assert.deepEqual([conv.contexto, conv.lead_id], ['presupuesto', r.leadId], 'se enlaza, pero sigue siendo la de su presupuesto');
        assert.match((await uno('SELECT titulo FROM tareas WHERE lead_id = ?', [r.leadId])).titulo, /^Pilar Presupuesto ha pedido información de limpieza facial profunda: contestarle en su conversación/);
      });

      await t.test('sin nombre, «Hola buenos días» (no «Hola hola»); el «como quedamos» a un lead lleva su nombre', async () => {
        llegada = martes;
        const r = await (await postLead({ telefono: '611000605' })).json();
        const ins = await uno('SELECT siguiente_en FROM inscripciones WHERE lead_id = ?', [r.leadId]);
        await R.avanzarSecuencias(deps, { ahora: ins.siguiente_en });
        assert.equal(enviadosA('+34611000605').at(-1).variables[0], 'buenos días');

        // Lead de un anuncio que abre WhatsApp: «escríbeme la semana que viene» → el lunes, con su nombre.
        const m = texto('34611000607', 'Hola, escríbeme la semana que viene', {
          ...en(martes), referral: { source_id: '120200000000607', source_type: 'ad', headline: 'Limpieza facial', ctwa_clid: 'ARAkPRUEBA-clid-607' },
        });
        await postWhatsApp(aviso({ de: '34611000607', perfil: 'Paula Prueba', mensajes: [m] }));
        await procesar(martes);
        const seg = await uno("SELECT s.programado_para FROM seguimientos s JOIN conversaciones c ON c.id = s.conversacion_id WHERE c.telefono = '+34611000607' AND s.estado = 'pendiente'");
        await R.procesarSeguimientos(deps, { ahora: seg.programado_para });
        const cq = enviadosA('+34611000607').at(-1);
        assert.deepEqual([cq.nombre, cq.variables], ['iemec_como_quedamos', ['Paula', 'limpieza facial profunda']]);
      });

      await t.test('GHL: el mismo envío no se duplica (y queda apuntado); la misma persona puede volver con otro envío', async () => {
        llegada = martes;
        const cuerpo = { origen: 'ghl', id_externo: 'ghl-op-606-1', id_contacto: 'ghl-contacto-606', telefono: '611000606', nombre: 'Gala Ghl' };
        const r1 = await postLead(cuerpo);
        assert.equal(r1.status, 201);
        const l1 = (await r1.json()).leadId;
        assert.equal((await uno('SELECT ghl_contact_id FROM leads WHERE id = ?', [l1])).ghl_contact_id, 'ghl-contacto-606');
        const r2 = await postLead(cuerpo);
        assert.deepEqual([r2.status, (await r2.json()).motivo], [200, 'repetido']);
        assert.equal((await uno("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'lead_repetido' AND entidad_id = ?", [String(l1)])).n, 1, 'el reintento queda apuntado');

        const ins = await uno('SELECT siguiente_en FROM inscripciones WHERE lead_id = ?', [l1]);
        await R.avanzarSecuencias(deps, { ahora: ins.siguiente_en });
        await postWhatsApp(aviso({ mensajes: [texto('34611000606', 'No, gracias', en(mas(martes, 5)))] }));
        await procesar(mas(martes, 5));
        assert.equal((await uno('SELECT etapa FROM leads WHERE id = ?', [l1])).etapa, 'perdido');
        llegada = mas(martes, 30 * 1440);
        const r3 = await postLead({ ...cuerpo, id_externo: 'ghl-op-606-2', codigo_web: 'INV26' });
        assert.equal(r3.status, 201);
        assert.deepEqual((({ nuevo, inscrito }) => [nuevo, inscrito])(await r3.json()), [true, true]);
        assert.equal((await uno('SELECT COUNT(*) AS n FROM leads WHERE ghl_contact_id = ?', ['ghl-contacto-606'])).n, 2);
      });

      await t.test('GHL: quien pulsó «No, gracias» y escribió BAJA no vuelve a la secuencia aunque GHL lo reenvíe', async () => {
        llegada = martes;
        const g = await (await postLead({ origen: 'ghl', id_externo: 'ghl-op-608-1', id_contacto: 'ghl-contacto-608', telefono: '611000608', nombre: 'Greta Ghl' })).json();
        const ins = await uno('SELECT siguiente_en FROM inscripciones WHERE lead_id = ?', [g.leadId]);
        await R.avanzarSecuencias(deps, { ahora: ins.siguiente_en });
        const boton = { from: '34611000608', id: wamid(), ...en(mas(martes, 3)), type: 'button', button: { text: 'No, gracias', payload: 'No, gracias' } };
        await postWhatsApp(aviso({ mensajes: [boton] }));
        await postWhatsApp(aviso({ mensajes: [texto('34611000608', 'BAJA', en(mas(martes, 4)))] }));
        await procesar(mas(martes, 5));
        assert.ok(await uno("SELECT telefono FROM bajas_comerciales WHERE telefono = '+34611000608'"));
        const antes = enviadosA('+34611000608').length;
        llegada = mas(martes, 14 * 1440);
        const otra = await (await postLead({ origen: 'ghl', id_externo: 'ghl-op-608-2', id_contacto: 'ghl-contacto-608', telefono: '611000608', nombre: 'Greta Ghl' })).json();
        assert.deepEqual([otra.nuevo, otra.inscrito, otra.motivo], [true, false, 'baja_comercial']);
        await R.avanzarSecuencias(deps, { ahora: mas(llegada, 5) });
        assert.equal(enviadosA('+34611000608').length, antes);
      });

      await t.test('lead de Meta que no se puede leer: a recepción (al momento si no hay forma, o en el último intento); los demás del aviso entran igual', async () => {
        // MODO_META en «simulado» con un aviso de verdad: no hay forma de leerlo.
        llegada = martes;
        await postMeta(avisoLead('900000000000699', { form_id: '800000000000699', ad_id: '700000000000699' }));
        await procesar(martes);
        const w = await uno("SELECT procesado_en, error FROM webhooks WHERE id_externo = 'leadgen:900000000000699'");
        assert.ok(w.procesado_en);
        assert.equal((await uno("SELECT titulo FROM tareas WHERE titulo LIKE '%Lead 900000000000699%'")).titulo,
          'Lead de Meta sin leer (MODO_META está en «simulado»): descargarlo en Meta Business Suite → Clientes potenciales y contactarle. Lead 900000000000699, formulario 800000000000699, anuncio 700000000000699');

        // Meta caída un rato: se reintenta, y el otro lead del mismo aviso no espera.
        const fallos = new Map([['900000000000698', 2], ['900000000000696', Infinity]]);
        const metaCaida = {
          modo: 'real',
          async obtenerLead(id) {
            if (fallos.get(id) > 0) {
              fallos.set(id, fallos.get(id) - 1);
              const err = new Error('Meta 500: An unknown error occurred');
              err.permanente = false;
              throw err;
            }
            return meta.obtenerLead(id);
          },
        };
        const depsCaida = { ...deps, meta: metaCaida };
        const campoLead = (id) => ({ field: 'leadgen', value: { leadgen_id: id, page_id: 'PAGINA-PRUEBA', form_id: '800000000000001' } });
        for (const [id, tel] of [['900000000000697', '611000697'], ['900000000000698', '611000698']]) {
          meta.leads.set(id, { campaign_name: 'Otoño facial', field_data: [{ name: 'full_name', values: [`Lead ${id.slice(-3)}`] }, { name: 'phone_number', values: [tel] }] });
        }
        await postMeta({ object: 'page', entry: [{ id: 'PAGINA-PRUEBA', changes: [campoLead('900000000000698'), campoLead('900000000000697')] }] });
        assert.equal((await entrada.procesarPendientes(depsCaida, { ahora: martes })).reintentos, 1);
        assert.ok(await uno("SELECT id FROM leads WHERE id_externo = '900000000000697'"), 'el que se puede leer entra ya');
        await entrada.procesarPendientes(depsCaida, { ahora: mas(martes, 1) });
        assert.equal((await entrada.procesarPendientes(depsCaida, { ahora: mas(martes, 3) })).hechos, 1);
        assert.ok(await uno("SELECT id FROM leads WHERE id_externo = '900000000000698'"), 'al tercer intento');

        // Y si no se arregla: en el último intento (el 8.º, unas 2 h después), a recepción.
        await postMeta(avisoLead('900000000000696'));
        const wid = (await uno("SELECT id FROM webhooks WHERE id_externo = 'leadgen:900000000000696'")).id;
        const trabajo = () => uno("SELECT * FROM cola WHERE tipo = 'webhook_meta' AND JSON_EXTRACT(carga, '$.webhookId') = ?", [wid]);
        for (let i = 0; i < 8; i++) await entrada.procesarPendientes(depsCaida, { ahora: (await trabajo()).ejecutar_en });
        const tj = await trabajo();
        assert.deepEqual([tj.estado, tj.intentos, tj.max_intentos], ['hecho', 8, 8]);
        assert.match((await uno("SELECT titulo FROM tareas WHERE titulo LIKE '%Lead 900000000000696%'")).titulo, /^Lead de Meta sin leer \(Meta 500: An unknown error occurred\)/);
      });

      await t.test('adjuntos: la baja médica no es una baja; foto o audio tras un tratamiento médico, urgentes y con el 112', async () => {
        // Un justificante con «Estoy de baja médica…»: ni baja comercial ni conversación cerrada.
        llegada = martes;
        const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono, es_cliente) VALUES ('Luisa', '+34611000609', TRUE)");
        await pool.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente) VALUES (?, 'whatsapp_marketing', 'otorgado', 'recepcion')", [p.insertId]);
        const doc = { from: '34611000609', id: wamid(), ...en(martes), type: 'document', document: { id: 'MEDIA-PRUEBA-9', filename: 'justificante.pdf', caption: 'Estoy de baja médica, no voy a poder ir a la cita del jueves' } };
        await postWhatsApp(aviso({ mensajes: [doc] }));
        await procesar(martes);
        const conv = await conversacionDe('+34611000609');
        assert.deepEqual([conv.estado, conv.motivo_cierre], ['espera_persona', null]);
        assert.deepEqual((await q('SELECT estado FROM consentimientos WHERE paciente_id = ?', [p.insertId])).map((c) => c.estado), ['otorgado']);
        assert.equal(await uno("SELECT telefono FROM bajas_comerciales WHERE telefono = '+34611000609'"), undefined);
        assert.ok(await uno("SELECT id FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [conv.id]), 'el justificante lo ve una persona');

        // Relleno (tratamiento médico) ayer: la foto del labio morado y frío es una urgencia.
        const cita = async (pacienteId, dias) => {
          const inicio = mas(martes, -dias * 1440);
          await pool.query(
            `INSERT INTO citas (paciente_id, tratamiento_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token)
             VALUES (?, 'toxina-botulinica', ?, ?, ?, ?, ?, ?, 'completada', ?)`,
            [pacienteId, inicio, mas(inicio, 30), inicio, mas(inicio, 40), inicio, mas(inicio, 30), crypto.randomBytes(32).toString('base64url')]);
        };
        const [p10] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Marina', '+34611000610')");
        await cita(p10.insertId, 1);
        const foto = { from: '34611000610', id: wamid(), ...en(martes), type: 'image', image: { id: 'MEDIA-PRUEBA-10', caption: 'Tengo el labio morado y frío desde el relleno de ayer' } };
        await postWhatsApp(aviso({ mensajes: [foto] }));
        await procesar(martes);
        const c10 = await conversacionDe('+34611000610');
        assert.equal(c10.urgente, 1);
        assert.equal((await uno("SELECT urgente FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [c10.id])).urgente, 1);
        assert.match(enviadosA('+34611000610').at(-1).texto, /112/);

        // Un audio de quien se trató hace 3 días: urgente (15 min) y se le dice a quién llamar.
        const [p11] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Luna', '+34611000611')");
        await cita(p11.insertId, 3);
        const audio = { from: '34611000611', id: wamid(), ...en(martes), type: 'audio', audio: { id: 'MEDIA-PRUEBA-11', voice: true } };
        await postWhatsApp(aviso({ mensajes: [audio] }));
        await procesar(martes);
        const c11 = await conversacionDe('+34611000611');
        const t11 = await uno("SELECT urgente, vence_en, titulo FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [c11.id]);
        assert.deepEqual([c11.urgente, t11.urgente, t11.vence_en.getTime()], [1, 1, mas(martes, 15).getTime()]);
        assert.match(t11.titulo, /^Ha mandado un audio: escucharlo y contestar \(tratamiento médico reciente/);
        assert.equal(enviadosA('+34611000611').at(-1).texto, 'Soy el asistente virtual de IEMEC. Gracias, Luna. Ahora mismo no puedo escuchar audios, así que se lo paso a una persona del equipo, '
          + 'que te contesta por aquí lo antes posible. Si es algo urgente de salud, llámanos al 916 00 00 00 o, si te encuentras mal, llama al 112.');

        // Con la IA en real: una leyenda que las reglas no entienden y la IA ve urgente va por la repesca.
        const iaReal = {
          modo: 'real',
          async interpretar({ texto: tx }) { return /buena pinta/.test(tx) ? { intencion: 'salud_personal', plazo: null, franja: null, urgente: true } : interpretar(tx); },
          async redactar() { return null; },
        };
        const foto12 = { from: '34611000612', id: wamid(), ...en(martes), type: 'image', image: { id: 'MEDIA-PRUEBA-12', caption: 'Esto no tiene buena pinta desde ayer' } };
        await postWhatsApp(aviso({ mensajes: [foto12] }));
        await entrada.procesarPendientes({ ...deps, ia: iaReal }, { ahora: martes });
        const c12 = await conversacionDe('+34611000612');
        assert.equal(c12.urgente, 1);
        assert.match(enviadosA('+34611000612').at(-1).texto, /112/);
      });

      await t.test('lo que llega para otro número u otra página de la misma app se guarda y se marca, pero no se toca', async () => {
        const deVuelta = ponerEntorno({ WHATSAPP_NUMERO_ID: 'NUM-PRUEBA', META_PAGINA_ID: 'PAGINA-PRUEBA' });
        llegada = martes;
        try {
          const ajeno = aviso({ mensajes: [texto('34611000640', 'Hola, pido cita en otra clínica', en(martes))] });
          ajeno.entry[0].changes[0].value.metadata.phone_number_id = 'NUM-OTRA-CLINICA';
          await postWhatsApp(ajeno);
          meta.leads.set('900000000000641', { campaign_name: 'Campaña de otra clínica', field_data: [{ name: 'phone_number', values: ['611000641'] }] });
          await postMeta(avisoLead('900000000000641', { page_id: 'PAGINA-OTRA-CLINICA' }));
          await postWhatsApp(aviso({ mensajes: [texto('34611000642', 'Hola, quiero información', en(martes))] }));
          await procesar(martes);
          assert.equal(await conversacionDe('+34611000640'), undefined, 'a otra clínica no se le contesta');
          assert.equal(await uno("SELECT id FROM leads WHERE id_externo = '900000000000641'"), undefined);
          assert.equal((await q("SELECT id FROM webhooks WHERE evento = 'ajeno'")).length, 2);
          assert.deepEqual((await q("SELECT datos FROM eventos WHERE tipo = 'webhook_ajeno' ORDER BY id")).map((e) => json(e.datos).ids), [['NUM-OTRA-CLINICA'], ['PAGINA-OTRA-CLINICA']]);
          assert.ok(await conversacionDe('+34611000642'), 'lo de la clínica entra igual');
        } finally { deVuelta(); }
      });

      await t.test('una clave de 360dialog de menos de 16 caracteres no vale: en producción, como si no hubiera', async () => {
        const cambio = ponerEntorno({ WHATSAPP_APP_SECRET: undefined, WHATSAPP_WEBHOOK_CLAVE: 'iemec', NODE_ENV: 'production' });
        try {
          const cuerpo = JSON.stringify(aviso({ estados: [estado('wamid.CLAVE-CORTA', 'read')] }));
          const r = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clave': 'iemec' }, body: cuerpo });
          assert.equal(r.status, 503);
        } finally { cambio(); }
      });

      await t.test('los cuerpos de los webhooks se vacían a los 30 días; el identificador se queda', async () => {
        const [[w]] = await pool.query('SELECT id, id_externo FROM webhooks ORDER BY id LIMIT 1');
        await pool.query('UPDATE webhooks SET recibido_en = ? WHERE id = ?', [new Date(Date.now() - 31 * 86400000), w.id]);
        assert.equal(await entrada.purgarWebhooks(pool, new Date()), 1);
        assert.deepEqual({ ...(await uno('SELECT cuerpo, id_externo FROM webhooks WHERE id = ?', [w.id])) }, { cuerpo: '', id_externo: w.id_externo });
        assert.ok((await uno("SELECT COUNT(*) AS n FROM webhooks WHERE cuerpo <> ''")).n > 0, 'los recientes se quedan');
      });

      await t.test('lead que no contesta: tarea de llamar con quién es, 2 comerciales por semana, perdido al final y, si vuelve, lead nuevo con su secuencia', async () => {
        const tel = '+34611000604';
        llegada = martes;
        const { leadId } = await (await postLead({ telefono: '611000604', nombre: 'Nora Nueva', tratamiento: 'limpieza-facial' })).json();
        const ins = () => uno('SELECT * FROM inscripciones WHERE lead_id = ?', [leadId]);
        const salidas = [];
        const paso = async () => {
          const x = await ins();
          const antes = enviadosA(tel).length;
          await R.avanzarSecuencias(deps, { ahora: x.siguiente_en });
          if (enviadosA(tel).length > antes) salidas.push(`${madrid(x.siguiente_en)} ${enviadosA(tel).at(-1).nombre}`);
        };
        await paso();
        // Mientras su secuencia está en marcha tiene próximo paso, y si vuelve a pedir información (otro
        // tratamiento) no se duplica: se guarda su interés nuevo.
        assert.ok(!(await R.sinProximoPaso(pool, mas(martes, 60))).some((c) => c.telefono === tel));
        llegada = mas(martes, 60);
        const otra = await (await postLead({ telefono: '611000604', tratamiento: 'mesoterapia-capilar' })).json();
        assert.deepEqual([otra.nuevo, otra.motivo, otra.tratamiento], [false, 'en_marcha', 'mesoterapia-capilar']);
        assert.equal((await uno('SELECT tratamiento_interes_id FROM leads WHERE id = ?', [leadId])).tratamiento_interes_id, 'mesoterapia-capilar');

        for (let i = 0; i < 20 && (await ins()).estado === 'activa'; i++) await paso();
        assert.deepEqual(salidas, [
          '2026-10-06 12:00 iemec_lead_bienvenida',
          '2026-10-06 16:00 iemec_lead_seguimiento',
          // El de los 3 días espera a que en la semana haya sitio (2 comerciales como mucho).
          '2026-10-14 10:00 iemec_lead_seguimiento',
          // Y el último, sus 4 días después del anterior.
          '2026-10-19 10:00 iemec_lead_ultimo',
        ]);
        const conv = await conversacionDe(tel);
        const llamar = await uno("SELECT * FROM tareas WHERE lead_id = ? AND tipo = 'llamar'", [leadId]);
        assert.deepEqual([llamar.titulo, llamar.conversacion_id], ['Llamar a Nora Nueva (611 00 06 04): lead sin respuesta a las 24 h', conv.id]);

        // Cuatro días después del último, sin respuesta: conversación cerrada y lead perdido.
        await R.procesarSeguimientos(deps, { ahora: new Date('2026-10-24T10:00:00Z') });
        assert.deepEqual({ ...(await uno('SELECT estado, motivo_cierre FROM conversaciones WHERE id = ?', [conv.id])) }, { estado: 'cerrada', motivo_cierre: 'sin_respuesta' });
        assert.deepEqual({ ...(await uno('SELECT etapa, motivo_perdida FROM leads WHERE id = ?', [leadId])) }, { etapa: 'perdido', motivo_perdida: 'sin_respuesta' });

        // Dos meses después pide información por la web: lead nuevo, con su secuencia y su bienvenida.
        llegada = new Date('2026-12-09T11:00:00Z');
        const vuelve = await (await postLead({ telefono: '611000604', nombre: 'Nora Nueva', tratamiento: 'mesoterapia-capilar' })).json();
        assert.deepEqual([vuelve.nuevo, vuelve.inscrito], [true, true]);
        assert.notEqual(vuelve.leadId, leadId);
        const nueva = await uno('SELECT siguiente_en FROM inscripciones WHERE lead_id = ?', [vuelve.leadId]);
        await R.avanzarSecuencias(deps, { ahora: nueva.siguiente_en });
        assert.deepEqual([enviadosA(tel).at(-1).nombre, enviadosA(tel).at(-1).variables], ['iemec_lead_bienvenida', ['Nora', 'mesoterapia capilar']]);
      });

      await t.test('panel: la lista de tareas abiertas dice quién es y cómo contactarle, y se pueden cerrar', async () => {
        llegada = martes;
        const f = await (await postLead({ telefono: '912 345 670', nombre: 'Fina Fijo', email: 'fina@ejemplo.com' })).json();
        const { tareas, avisosFallidos } = await panel('/tareas');
        const suya = tareas.find((x) => x.lead?.id === f.leadId);
        assert.deepEqual([suya.tipo, suya.quien, suya.telefono, suya.email, suya.conversacionId, suya.lead.origen], ['llamar', 'Fina Fijo', '+34912345670', 'fina@ejemplo.com', null, 'web']);
        const nora = tareas.find((x) => x.titulo.startsWith('Llamar a Nora Nueva'));
        assert.deepEqual([nora.quien, nora.telefono, Boolean(nora.conversacionId)], ['Nora Nueva', '+34611000604', true]);
        assert.ok(tareas.some((x) => x.titulo.startsWith('Lead de Meta sin leer')), 'los leads de Meta sin leer, también');
        assert.equal(tareas[0].urgente, true, 'lo urgente, lo primero');
        assert.equal(avisosFallidos, 0);
        assert.deepEqual(await panel(`/tareas/${suya.id}`, { metodo: 'POST', cuerpo: { estado: 'hecha', resultado: 'Le he llamado: viene el lunes' } }), { ok: true, estado: 'hecha' });
        assert.ok(!(await panel('/tareas')).tareas.some((x) => x.id === suya.id));
        assert.equal((await uno('SELECT resultado FROM tareas WHERE id = ?', [suya.id])).resultado, 'Le he llamado: viene el lunes');
        assert.match((await panel(`/tareas/${suya.id}`, { metodo: 'POST', cuerpo: { estado: 'hecha' } })).error, /ya está cerrada/);
      });
    });
  } finally {
    restaurar();
    await pool.end();
  }
});
