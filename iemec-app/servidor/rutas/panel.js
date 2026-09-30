'use strict';
// API del panel de la clínica. Todo detrás de sesión (servidor/sesion.js). Devuelve lo justo para
// cada pantalla: hoy, agenda por cabina, bandeja de conversaciones, seguimientos, repesca,
// plantillas, reseñas y ajustes (qué tratamiento se hace en qué sala).
const express = require('express');
const T = require('../../motor/tiempo');
const { descifrar } = require('../cripto');
const { comprobarPlantilla, variablesDe } = require('../../motor/repesca/plantillas');
const { limpiarNombre, nombrePila } = require('../../motor/entrada/leads');
const R = require('../../motor/resenas/resenas');
const { ideasDelMes } = require('../../motor/resenas/publicaciones');
const agenda = require('../agenda');
const listaEspera = require('../lista-espera');
const repesca = require('../repesca/motor');
const resenasSrv = require('../resenas');
const { registrar } = require('../eventos');
const estados = require('../estados-cita');

const madrid = (d) => (d ? T.partesMadrid(new Date(d)) : null);
const envolver = (fn) => (req, res, next) => fn(req, res).catch(next);
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
// Una plantilla con un botón de enlace que lleva variable (el de «Tu cita» o el de la reseña): ese valor
// lo pone la app cuando la manda sola. Desde la bandeja no se puede mandar.
const conEnlaceDeLaApp = (pl) => (json(pl.botones) || []).some((b) => b.tipo === 'url' && /\{\{\d+\}\}/.test(b.url || ''));

function rutasPanel({ pool, deps = null }) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);

  // ── Hoy ────────────────────────────────────────────────────────────────────────────────────
  r.get('/hoy', envolver(async (req, res) => {
    const ahora = req.ahora || new Date();
    const hoy = T.fechaMadrid(ahora);
    const desde = T.desdeMadrid(hoy, '00:00');
    const hasta = T.desdeMadrid(T.sumarDias(hoy, 1), '00:00');
    const q = async (sql, a) => (await p().query(sql, a))[0];
    const [citas] = await q(
      `SELECT COUNT(*) AS n, SUM(estado = 'confirmada') AS confirmadas, SUM(estado IN ('llegada','en_curso')) AS llegadas,
              SUM(estado = 'completada') AS completadas, SUM(estado = 'no_presentada') AS no_presentadas
         FROM citas WHERE inicio >= ? AND inicio < ? AND estado NOT IN ('cancelada','reprogramada')`, [desde, hasta]);
    const [espera] = await q("SELECT COUNT(*) AS n, SUM(urgente) AS urgentes FROM conversaciones WHERE estado = 'espera_persona'");
    const [ia] = await q("SELECT COUNT(*) AS n FROM conversaciones WHERE estado IN ('ia_activa','esperando_paciente')");
    const [seg] = await q("SELECT COUNT(*) AS n FROM seguimientos WHERE estado = 'pendiente' AND programado_para >= ? AND programado_para < ?", [desde, hasta]);
    const [tareas] = await q("SELECT COUNT(*) AS n, SUM(vence_en < ?) AS vencidas FROM tareas WHERE estado = 'abierta'", [ahora]);
    const [resenas] = await q("SELECT COUNT(*) AS n FROM resenas WHERE estado IN ('nueva','borrador')");
    const inicioMes = T.desdeMadrid(`${hoy.slice(0, 8)}01`, '00:00');
    const [recuperadas] = await q(
      `SELECT COUNT(*) AS n, COALESCE(SUM(t.precio_eur), 0) AS euros FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id
        WHERE c.creado_en >= ? AND c.origen = 'ia_whatsapp' AND c.estado NOT IN ('cancelada','reprogramada','retenida','no_presentada')`, [inicioMes]);
    const sinPaso = await repesca.sinProximoPaso(p(), ahora);
    res.json({
      fecha: hoy,
      citas: {
        total: Number(citas.n), confirmadas: Number(citas.confirmadas || 0), llegadas: Number(citas.llegadas || 0),
        completadas: Number(citas.completadas || 0), noPresentadas: Number(citas.no_presentadas || 0),
      },
      conversaciones: { esperaPersona: Number(espera.n), urgentes: Number(espera.urgentes || 0), conIa: Number(ia.n) },
      seguimientosHoy: Number(seg.n),
      tareas: { abiertas: Number(tareas.n), vencidas: Number(tareas.vencidas || 0) },
      resenasPorResponder: Number(resenas.n),
      recuperadoMes: { citas: Number(recuperadas.n), euros: Number(recuperadas.euros) },
      sinProximoPaso: sinPaso.length,
    });
  }));

  // ── Tareas abiertas: qué hay que hacer, con quién y cómo contactarle ──────────────────────
  // Un lead sin conversación (sin WhatsApp, un fijo, la baja comercial) solo se ve aquí.
  r.get('/tareas', envolver(async (req, res) => {
    const ahora = req.ahora || new Date();
    const [filas] = await p().query(
      `SELECT t.id, t.tipo, t.titulo, t.urgente, t.vence_en, t.creado_en, t.conversacion_id, COALESCE(t.lead_id, c.lead_id) AS lead_id,
              l.nombre AS lead_nombre, l.telefono AS lead_telefono, l.email AS lead_email, l.origen, l.campana,
              pa.nombre AS paciente_nombre, pa.apellidos, pa.telefono AS paciente_telefono, pa.email AS paciente_email, c.telefono AS conv_telefono
         FROM tareas t
         LEFT JOIN conversaciones c ON c.id = t.conversacion_id
         LEFT JOIN leads l ON l.id = COALESCE(t.lead_id, c.lead_id)
         LEFT JOIN pacientes pa ON pa.id = COALESCE(t.paciente_id, c.paciente_id)
        WHERE t.estado = 'abierta' ORDER BY t.urgente DESC, t.vence_en, t.id LIMIT 300`);
    // Avisos de WhatsApp o de Meta que se quedaron sin procesar después de todos los intentos.
    const [[fallidos]] = await p().query("SELECT COUNT(*) AS n FROM cola WHERE tipo IN ('webhook_whatsapp','webhook_whatsapp_estados','webhook_meta') AND estado = 'fallido'");
    res.json({
      tareas: filas.map((x) => ({
        id: x.id, tipo: x.tipo, titulo: x.titulo, urgente: Boolean(x.urgente), vence: x.vence_en, vencida: new Date(x.vence_en) < ahora,
        creada: x.creado_en, conversacionId: x.conversacion_id,
        quien: x.paciente_nombre ? [x.paciente_nombre, x.apellidos].filter(Boolean).join(' ') : x.lead_nombre || null,
        telefono: x.paciente_telefono || x.lead_telefono || x.conv_telefono || null,
        email: x.paciente_email || x.lead_email || null,
        lead: x.lead_id ? { id: x.lead_id, origen: x.origen, campana: x.campana } : null,
      })),
      avisosFallidos: Number(fallidos.n),
    });
  }));

  // Cuerpo: { estado: 'hecha' | 'cancelada', resultado }.
  r.post('/tareas/:id', envolver(async (req, res) => {
    const id = /^\d{1,10}$/.test(req.params.id) ? Number(req.params.id) : null;
    const estado = req.body?.estado === 'cancelada' ? 'cancelada' : 'hecha';
    const [hecho] = id ? await p().query("UPDATE tareas SET estado = ?, resultado = ?, hecha_en = ? WHERE id = ? AND estado = 'abierta'",
      [estado, req.body?.resultado ? String(req.body.resultado).slice(0, 255) : null, req.ahora || new Date(), id]) : [{ affectedRows: 0 }];
    if (!hecho.affectedRows) return res.status(404).json({ error: 'Esa tarea no existe o ya está cerrada' });
    await registrar(p(), { tipo: `tarea_${estado}`, entidad: 'tarea', entidadId: id, actor: req.usuario?.email || 'panel' });
    res.json({ ok: true, estado });
  }));

  // ── Agenda por cabina ─────────────────────────────────────────────────────────────────────
  r.get('/agenda', envolver(async (req, res) => {
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '') ? req.query.fecha : T.fechaMadrid(req.ahora || new Date());
    const desde = T.desdeMadrid(fecha, '00:00');
    const hasta = T.desdeMadrid(T.sumarDias(fecha, 1), '00:00');
    const [salas] = await p().query('SELECT id, codigo, nombre, tipo, color FROM salas WHERE activa = TRUE ORDER BY orden, id');
    const [profesionales] = await p().query('SELECT id, nombre, rol, color FROM profesionales WHERE activo = TRUE ORDER BY orden, id');
    const [citas] = await p().query(
      `SELECT c.id, c.sala_id, c.profesional_id, c.inicio, c.fin, c.sala_desde, c.sala_hasta, c.estado, c.origen, c.primera_visita,
              t.nombre AS tratamiento, t.familia, p.nombre AS paciente, p.apellidos
         FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id JOIN pacientes p ON p.id = c.paciente_id
        WHERE c.sala_desde < ? AND c.sala_hasta > ? AND c.estado NOT IN ('cancelada','reprogramada') ORDER BY c.inicio`, [hasta, desde]);
    const dia = await agenda.cargarDia(p(), fecha, { ahora: req.ahora || new Date() });
    res.json({
      fecha,
      festivo: dia.festivo,
      abierto: dia.abierto,
      salas,
      profesionales: profesionales.map((x) => ({ ...x, turnos: dia.profesionales.find((d) => d.id === x.id)?.turnos || [], pausas: dia.profesionales.find((d) => d.id === x.id)?.bloqueos || [], comidasFlotantes: dia.profesionales.find((d) => d.id === x.id)?.pausasFlotantes || [] })),
      citas: citas.map((c) => ({
        id: c.id, salaId: c.sala_id, profesionalId: c.profesional_id, estado: c.estado, origen: c.origen, primeraVisita: Boolean(c.primera_visita),
        tratamiento: c.tratamiento, familia: c.familia, paciente: [c.paciente, c.apellidos ? `${c.apellidos[0]}.` : ''].join(' ').trim(),
        inicio: madrid(c.inicio).minutos, fin: madrid(c.fin).minutos, limpiezaHasta: madrid(c.sala_hasta).minutos,
      })),
    });
  }));

  r.get('/huecos', envolver(async (req, res) => {
    res.json(await agenda.huecos(p(), { fecha: String(req.query.fecha), tratamientoId: String(req.query.tratamiento), ahora: req.ahora || new Date() }));
  }));

  // ── La cita que abre recepción: detalle y estado (ha llegado, completada, no vino, deshacer) ─
  const idCita = (req) => (/^\d{1,10}$/.test(req.params.id) ? Number(req.params.id) : null);
  r.get('/citas/:id', envolver(async (req, res) => {
    const d = idCita(req) && await estados.detalle(p(), idCita(req), { ahora: req.ahora || new Date() });
    if (!d) return res.status(404).json({ error: 'No existe esa cita' });
    res.json(d);
  }));

  // Cuerpo: { estado: 'llegada' | 'completada' | 'no_presentada' } o { deshacer: el estado que se ve }
  // (así un «Deshacer» repetido, o desde una vista vieja, no deshace también el cambio de antes).
  r.post('/citas/:id/estado', envolver(async (req, res) => {
    const id = idCita(req);
    if (!id) return res.status(404).json({ error: 'No existe esa cita', codigo: 'CITA_DESCONOCIDA' });
    const ahora = req.ahora || new Date();
    const actor = req.usuario?.email || 'panel';
    let cita;
    try {
      cita = req.body?.deshacer !== undefined
        ? await estados.deshacer(p(), { id, de: req.body.deshacer, actor, ahora })
        : await estados.marcar(p(), { id, estado: String(req.body?.estado || ''), actor, ahora });
    } catch (err) {
      if (err.codigo === 'CITA_DESCONOCIDA') return res.status(404).json({ error: err.message, codigo: err.codigo });
      if (err.codigo === 'ESTADO_DESCONOCIDO') return res.status(400).json({ error: err.message, codigo: err.codigo });
      if (err.codigo) return res.status(409).json({ error: err.message, codigo: err.codigo });
      throw err;
    }
    res.json({ ...(await estados.detalle(p(), id, { ahora })), efectos: cita.efectos || null, anulado: cita.anulado || null });
  }));

  r.post('/citas', envolver(async (req, res) => {
    const b = req.body || {};
    try {
      const c = await agenda.reservar(p(), { pacienteId: b.pacienteId, tratamientoId: b.tratamientoId, fecha: b.fecha, hora: b.hora, profesionalId: b.profesionalId, salaId: b.salaId, origen: 'recepcion', actor: req.usuario?.email || 'panel', ahora: req.ahora || new Date() });
      res.status(201).json(c);
    } catch (err) {
      if (err.codigo) return res.status(409).json({ error: err.message, codigo: err.codigo });
      throw err;
    }
  }));

  // ── Lista de espera: quién espera, las ofertas en curso, apuntar y quitar ──────────────────
  r.get('/lista-espera', envolver(async (req, res) => {
    const datos = await listaEspera.listar(p(), { ahora: req.ahora || new Date() });
    const [tratamientos] = await p().query('SELECT id, nombre FROM tratamientos WHERE activo = TRUE ORDER BY nombre');
    res.json({ ...datos, tratamientos });
  }));

  // Apuntar a alguien por su móvil. Si el móvil es de otra persona que la tecleada, 409 con su nombre:
  // el formulario pide confirmarlo (confirmado: true) antes de apuntarla. Con adelantar, se enlaza la
  // cita que ya tiene de ese tratamiento (se le ofrecerá solo un hueco antes, y se le cambiará).
  r.post('/lista-espera', envolver(async (req, res) => {
    const b = req.body || {};
    const [[trat]] = await p().query('SELECT id FROM tratamientos WHERE id = ? AND activo = TRUE', [String(b.tratamientoId || '')]);
    if (!trat) return res.status(400).json({ error: 'Elige un tratamiento de la lista', codigo: 'TRATAMIENTO_DESCONOCIDO' });
    const con = await p().getConnection();
    try {
      await con.beginTransaction();
      const pacienteId = b.pacienteId ? Number(b.pacienteId)
        : await listaEspera.pacientePorTelefono(con, { telefono: b.telefono, nombre: b.nombre, confirmado: Boolean(b.confirmado) });
      const r2 = await listaEspera.apuntar(con, {
        pacienteId, tratamientoId: b.tratamientoId, desdeFecha: b.desde || null, hastaFecha: b.hasta || null, franja: b.franja || null,
        citaActualId: b.citaActualId || null, adelantar: Boolean(b.adelantar), notas: b.notas || null, origen: 'panel', creadoPor: req.usuario?.email || 'panel', ahora: req.ahora || new Date(),
      });
      const [[pac]] = await con.query('SELECT nombre, apellidos FROM pacientes WHERE id = ?', [pacienteId]);
      await con.commit();
      res.status(r2.nueva ? 201 : 200).json({ ...r2, paciente: pac ? listaEspera.nombreCorto(pac) : null });
    } catch (err) {
      await con.rollback().catch(() => {});
      if (err.codigo === 'OTRO_PACIENTE') return res.status(409).json({ error: err.message, codigo: err.codigo, paciente: err.paciente });
      if (err.codigo) return res.status(400).json({ error: err.message, codigo: err.codigo });
      throw err;
    } finally {
      con.release();
    }
  }));

  r.delete('/lista-espera/:id', envolver(async (req, res) => {
    const ok = await listaEspera.quitar(p(), Number(req.params.id), { motivo: req.body?.motivo || 'quitado desde el panel', actor: req.usuario?.email || 'panel', ahora: req.ahora || new Date() });
    if (!ok) return res.status(404).json({ error: 'No está en la lista de espera' });
    res.json({ ok: true });
  }));

  // Recepción resuelve una oferta en curso (su conversación la lleva una persona: la IA no lee su «sí»).
  // Al aceptarla, el aviso de cita con su enlace le llega por el cron de avisos.
  r.post('/lista-espera/ofertas/:id/:accion', envolver(async (req, res) => {
    const accion = req.params.accion;
    if (!['aceptar', 'rechazar'].includes(accion)) return res.status(404).json({ error: 'Acción desconocida' });
    const oferta = await listaEspera.ofertaPorId(p(), Number(req.params.id));
    if (!oferta) return res.status(404).json({ error: 'No existe esa oferta' });
    const ahora = req.ahora || new Date();
    const actor = req.usuario?.email || 'panel';
    const viva = oferta.estado === 'ofrecida' || (accion === 'aceptar' && oferta.estado === 'caducada' && new Date(oferta.inicio) > ahora);
    if (!viva) return res.status(409).json({ error: 'Esa oferta ya está cerrada', codigo: 'OFERTA_CERRADA' });
    if (accion === 'rechazar') {
      await listaEspera.rechazar(p(), oferta, { ahora, actor });
      return res.json({ ok: true });
    }
    const r2 = await listaEspera.aceptar(p(), oferta, { ahora, actor });
    if (r2.ocupado) return res.status(409).json({ error: 'Ese hueco ya se ha ocupado', codigo: 'HUECO_OCUPADO' });
    res.json({ ok: true, ...r2 });
  }));

  // ── Bandeja de conversaciones ────────────────────────────────────────────────────────────
  r.get('/conversaciones', envolver(async (req, res) => {
    const [filas] = await p().query(
      `SELECT c.*, p.nombre, p.apellidos, l.nombre AS lead_nombre, l.origen AS lead_origen, l.campana,
              (SELECT COUNT(*) FROM seguimientos s WHERE s.conversacion_id = c.id AND s.estado = 'pendiente') AS seguimientos,
              (SELECT MIN(s.programado_para) FROM seguimientos s WHERE s.conversacion_id = c.id AND s.estado = 'pendiente') AS proximo_seguimiento,
              (SELECT m.estado FROM mensajes m WHERE m.conversacion_id = c.id AND m.direccion = 'saliente' ORDER BY m.id DESC LIMIT 1) AS ultimo_saliente_estado
         FROM conversaciones c LEFT JOIN pacientes p ON p.id = c.paciente_id LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.estado <> 'cerrada' OR c.actualizado_en > ? ORDER BY c.urgente DESC, FIELD(c.estado, 'espera_persona', 'persona', 'ia_activa', 'esperando_paciente', 'pausada', 'cerrada'), c.actualizado_en DESC LIMIT 200`,
      [new Date((req.ahora || new Date()).getTime() - 7 * 86400000)]);
    res.json(filas.map((c) => ({
      id: c.id, estado: c.estado, urgente: Boolean(c.urgente), contexto: c.contexto,
      nombre: c.nombre ? `${c.nombre}${c.apellidos ? ` ${c.apellidos}` : ''}` : c.lead_nombre || c.nombre_whatsapp || c.telefono,
      origen: c.lead_origen, campana: c.campana, telefonoFinal: String(c.telefono).slice(-3),
      ventanaAbierta: Boolean(c.ventana_hasta && new Date(c.ventana_hasta) > (req.ahora || new Date())),
      ventanaHasta: c.ventana_hasta, proximoPaso: c.proximo_paso, proximoPasoEn: c.proximo_paso_en, proximoSeguimiento: c.proximo_seguimiento,
      motivoCierre: c.motivo_cierre, actualizado: c.actualizado_en, noEntregado: c.ultimo_saliente_estado === 'fallido',
    })));
  }));

  r.get('/conversaciones/:id', envolver(async (req, res) => {
    const id = Number(req.params.id);
    const [[c]] = await p().query('SELECT * FROM conversaciones WHERE id = ?', [id]);
    if (!c) return res.status(404).json({ error: 'No existe' });
    const [msgs] = await p().query('SELECT id, direccion, autor, tipo, cuerpo_cifrado, iv, tag, estado, error_codigo, error_texto, intencion, creado_en FROM mensajes WHERE conversacion_id = ? ORDER BY id', [id]);
    const [segs] = await p().query('SELECT id, motivo, plazo_tipo, frase_cifrada, frase_iv, frase_tag, programado_para, estado, creado_por FROM seguimientos WHERE conversacion_id = ? ORDER BY programado_para', [id]);
    const [eventos] = await p().query("SELECT tipo, actor, datos, creado_en FROM eventos WHERE entidad = 'conversacion' AND entidad_id = ? ORDER BY id DESC LIMIT 20", [String(id)]);
    const [[paciente]] = c.paciente_id ? await p().query('SELECT id, nombre, apellidos, email, es_cliente, baja_comercial_en FROM pacientes WHERE id = ?', [c.paciente_id]) : [[null]];
    const [[fila]] = c.lead_id ? await p().query('SELECT l.nombre, l.origen, l.campana, l.anuncio, l.etapa, l.respuestas_cifradas, l.respuestas_iv, l.respuestas_tag, t.nombre AS tratamiento FROM leads l LEFT JOIN tratamientos t ON t.id = l.tratamiento_interes_id WHERE l.id = ?', [c.lead_id]) : [[null]];
    // Lo que escribió en el formulario (va cifrado, como los mensajes).
    const lead = fila && {
      nombre: fila.nombre, origen: fila.origen, campana: fila.campana, anuncio: fila.anuncio, etapa: fila.etapa, tratamiento: fila.tratamiento,
      respuestas: fila.respuestas_cifradas ? JSON.parse(descifrar(fila.respuestas_cifradas, fila.respuestas_iv, fila.respuestas_tag)) : [],
    };
    const [citas] = c.paciente_id ? await p().query('SELECT c.inicio, c.estado, t.nombre AS tratamiento FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id WHERE c.paciente_id = ? ORDER BY c.inicio DESC LIMIT 5', [c.paciente_id]) : [[]];
    // Con qué nombre se le saluda en una plantilla («Hola {{1}}»), como en los mensajes automáticos:
    // el de su ficha, el de pila del lead o el de su perfil de WhatsApp.
    const saludo = (paciente?.nombre && paciente.nombre !== 'Paciente' && limpiarNombre(paciente.nombre) ? paciente.nombre : null)
      || nombrePila(fila?.nombre) || nombrePila(c.nombre_whatsapp) || null;
    res.json({
      conversacion: { id: c.id, estado: c.estado, urgente: Boolean(c.urgente), contexto: c.contexto, proximoPaso: c.proximo_paso, proximoPasoEn: c.proximo_paso_en, ventanaHasta: c.ventana_hasta, motivoCierre: c.motivo_cierre, nombreWhatsapp: c.nombre_whatsapp },
      paciente, lead, citas, saludo,
      mensajes: msgs.map((m) => ({
        id: m.id, direccion: m.direccion, autor: m.autor, tipo: m.tipo, texto: descifrar(m.cuerpo_cifrado, m.iv, m.tag), estado: m.estado,
        error: m.estado === 'fallido' && (m.error_codigo || m.error_texto) ? { codigo: m.error_codigo, texto: m.error_texto } : null, intencion: m.intencion, en: m.creado_en,
      })),
      seguimientos: segs.map((s) => ({ id: s.id, motivo: s.motivo, plazo: s.plazo_tipo, frase: descifrar(s.frase_cifrada, s.frase_iv, s.frase_tag), programado: s.programado_para, estado: s.estado, creadoPor: s.creado_por })),
      decisiones: eventos.map((e) => ({ tipo: e.tipo, actor: e.actor, datos: typeof e.datos === 'string' ? JSON.parse(e.datos) : e.datos, en: e.creado_en })),
    });
  }));

  // Escribir desde el panel: texto si la ventana está abierta; si no, hay que elegir plantilla y darle
  // un valor a cada variable (Meta rechaza la plantilla con una vacía o que falte, y al paciente le
  // llegaría «{{2}}»). Las que llevan un enlace de la app (su cita, su reseña) solo salen solas.
  r.post('/conversaciones/:id/enviar', envolver(async (req, res) => {
    const id = Number(req.params.id);
    const [[c]] = await p().query('SELECT * FROM conversaciones WHERE id = ?', [id]);
    if (!c) return res.status(404).json({ error: 'No existe' });
    const ahora = req.ahora || new Date();
    const abierta = c.ventana_hasta && new Date(c.ventana_hasta) > ahora;
    if (!deps) return res.status(503).json({ error: 'WhatsApp no configurado' });
    if (req.body?.plantillaId) {
      const [[pl]] = await p().query("SELECT * FROM plantillas WHERE id = ? AND estado = 'aprobada'", [req.body.plantillaId]);
      if (!pl) return res.status(400).json({ error: 'Esa plantilla no está aprobada' });
      if (conEnlaceDeLaApp(pl)) return res.status(400).json({ error: 'Esa plantilla lleva el enlace de una cita o de una reseña: la manda la app sola', codigo: 'PLANTILLA_AUTOMATICA' });
      // Sin saltos de línea ni espacios de más: Meta no los admite en una variable.
      const variables = (Array.isArray(req.body.variables) ? req.body.variables : []).map((v) => String(v ?? '').replace(/\s+/g, ' ').trim());
      const faltan = [...new Set(variablesDe(pl.cuerpo))].filter((n) => !variables[n - 1]);
      if (faltan.length) return res.status(400).json({ error: `Falta rellenar ${faltan.map((n) => `{{${n}}}`).join(', ')} de la plantilla`, codigo: 'FALTAN_VARIABLES' });
      return res.json(await repesca.enviar({ ...deps, pool: p() }, c, { plantilla: pl, variables, autor: 'persona', ahora }));
    }
    if (!abierta) return res.status(409).json({ error: 'Han pasado 24 horas desde el último mensaje del paciente: solo se puede escribir con una plantilla aprobada', codigo: 'VENTANA_CERRADA' });
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'El mensaje está vacío' });
    await p().query("UPDATE conversaciones SET estado = 'persona' WHERE id = ?", [id]);
    res.json(await repesca.enviar({ ...deps, pool: p() }, c, { texto, autor: 'persona', ahora }));
  }));

  // Tomar la conversación (la IA calla) o devolverla a la IA. Va detrás de «enviar»: si no, esta se
  // quedaba con /enviar como una acción desconocida (404) y desde el panel no se podía escribir.
  r.post('/conversaciones/:id/:accion', envolver(async (req, res) => {
    const id = Number(req.params.id);
    const accion = req.params.accion;
    if (!['tomar', 'devolver', 'cerrar'].includes(accion)) return res.status(404).json({ error: 'Acción desconocida' });
    const estado = { tomar: 'persona', devolver: 'ia_activa', cerrar: 'cerrada' }[accion];
    await p().query('UPDATE conversaciones SET estado = ?, urgente = IF(? = \'persona\', urgente, FALSE), motivo_cierre = IF(? = \'cerrada\', ?, motivo_cierre) WHERE id = ?',
      [estado, estado, estado, req.body?.motivo || 'cerrada a mano', id]);
    if (accion !== 'tomar') await p().query("UPDATE tareas SET estado = 'hecha', hecha_en = ? WHERE conversacion_id = ? AND estado = 'abierta'", [req.ahora || new Date(), id]);
    await registrar(p(), { tipo: `conversacion_${accion}`, entidad: 'conversacion', entidadId: id, actor: req.usuario?.email || 'panel' });
    res.json({ ok: true, estado });
  }));

  // ── Seguimientos ──────────────────────────────────────────────────────────────────────────
  r.get('/seguimientos', envolver(async (req, res) => {
    const [filas] = await p().query(
      `SELECT s.*, COALESCE(p.nombre, l.nombre) AS nombre, t.nombre AS tratamiento
         FROM seguimientos s LEFT JOIN pacientes p ON p.id = s.paciente_id LEFT JOIN leads l ON l.id = s.lead_id
         LEFT JOIN tratamientos t ON t.id = l.tratamiento_interes_id
        WHERE s.estado = 'pendiente' ORDER BY s.programado_para LIMIT 500`);
    res.json(filas.map((s) => ({
      id: s.id, nombre: s.nombre, tratamiento: s.tratamiento, motivo: s.motivo, plazo: s.plazo_tipo, conversacionId: s.conversacion_id,
      frase: descifrar(s.frase_cifrada, s.frase_iv, s.frase_tag), programado: s.programado_para, creadoPor: s.creado_por,
    })));
  }));

  r.patch('/seguimientos/:id', envolver(async (req, res) => {
    const id = Number(req.params.id);
    if (req.body?.cancelar) {
      await p().query("UPDATE seguimientos SET estado = 'cancelado', resultado = 'cancelado a mano' WHERE id = ? AND estado = 'pendiente'", [id]);
    } else if (req.body?.fecha && req.body?.hora) {
      await p().query("UPDATE seguimientos SET programado_para = ?, creado_por = 'persona' WHERE id = ? AND estado = 'pendiente'", [T.desdeMadrid(req.body.fecha, req.body.hora), id]);
    } else return res.status(400).json({ error: 'Indica fecha y hora, o cancelar' });
    await registrar(p(), { tipo: 'seguimiento_editado', entidad: 'seguimiento', entidadId: id, actor: req.usuario?.email || 'panel', datos: req.body });
    res.json({ ok: true });
  }));

  // ── Repesca: embudos, euros, excusas y ofertas ───────────────────────────────────────────
  r.get('/repesca', envolver(async (req, res) => {
    const q = async (sql, a = []) => (await p().query(sql, a))[0];
    const embudo = await q("SELECT etapa, COUNT(*) AS n FROM leads GROUP BY etapa");
    const origenes = await q("SELECT origen, COUNT(*) AS leads, SUM(etapa IN ('cita','asistio','vendido')) AS con_cita FROM leads GROUP BY origen ORDER BY leads DESC");
    const presupuestos = await q("SELECT estado, COUNT(*) AS n, COALESCE(SUM(importe_eur),0) AS euros FROM presupuestos GROUP BY estado");
    const excusas = await q("SELECT intencion, COUNT(*) AS n FROM mensajes WHERE direccion = 'entrante' AND intencion IS NOT NULL GROUP BY intencion ORDER BY n DESC");
    const ofertas = await q(`SELECT o.nombre, o.tipo, COUNT(h.id) AS hechas, SUM(h.estado = 'aceptada') AS aceptadas
                               FROM ofertas o LEFT JOIN ofertas_hechas h ON h.oferta_id = o.id GROUP BY o.id ORDER BY hechas DESC`);
    const cierres = await q("SELECT motivo_cierre AS motivo, COUNT(*) AS n FROM conversaciones WHERE estado = 'cerrada' GROUP BY motivo_cierre ORDER BY n DESC");
    const secuencias = await q("SELECT secuencia, estado, COUNT(*) AS n FROM inscripciones GROUP BY secuencia, estado");
    const num = (rows) => rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v])));
    res.json({ embudo: num(embudo), origenes: num(origenes), presupuestos: num(presupuestos), excusas: num(excusas), ofertas: num(ofertas), cierres: num(cierres), secuencias: num(secuencias) });
  }));

  // ── Plantillas ────────────────────────────────────────────────────────────────────────────
  r.get('/plantillas', envolver(async (req, res) => {
    const [filas] = await p().query(
      `SELECT pl.*, COUNT(m.id) AS enviadas, SUM(m.estado = 'leido') AS leidas, SUM(m.estado = 'fallido') AS fallidas
         FROM plantillas pl LEFT JOIN mensajes m ON m.plantilla_id = pl.id GROUP BY pl.id ORDER BY pl.uso, pl.id`);
    res.json(filas.map((x) => ({
      id: x.id, nombre: x.nombre, uso: x.uso, categoria: x.categoria, estado: x.estado, calidad: x.calidad, cuerpo: x.cuerpo,
      botones: json(x.botones), ejemplos: json(x.ejemplos) || [], aMano: !conEnlaceDeLaApp(x), motivoRechazo: x.motivo_rechazo, reservaDeId: x.reserva_de_id,
      enviadas: Number(x.enviadas), leidas: Number(x.leidas || 0), fallidas: Number(x.fallidas || 0),
    })));
  }));

  r.post('/plantillas/comprobar', envolver(async (req, res) => {
    res.json(comprobarPlantilla(req.body || {}));
  }));

  // ── Reseñas ───────────────────────────────────────────────────────────────────────────────
  r.get('/resenas', envolver(async (req, res) => {
    const [resenas] = await p().query('SELECT * FROM resenas ORDER BY publicada_en DESC LIMIT 200');
    const [peticiones] = await p().query('SELECT enviada_en, pulsada_en, resena_id FROM peticiones_resena WHERE enviada_en IS NOT NULL');
    // Ideas para la ficha de Google: solo lo que se reserva (ni agrupadores ni retirados).
    const [trats] = await p().query('SELECT id, nombre, familia, descripcion, publicidad_restringida, activo FROM tratamientos WHERE activo = TRUE ORDER BY id');
    const mes = Number(T.fechaMadrid(req.ahora || new Date()).slice(5, 7));
    res.json({
      metricas: R.metricas({ resenas, peticiones }),
      resenas: resenas.map((x) => ({ id: x.id, autor: x.autor, nota: x.nota, texto: x.texto, publicada: x.publicada_en, sentimiento: x.sentimiento, prioridad: x.prioridad, temas: typeof x.temas === 'string' ? JSON.parse(x.temas) : x.temas, borrador: x.borrador_respuesta, respuesta: x.respuesta, estado: x.estado })),
      publicaciones: ideasDelMes({ mes, tratamientos: trats.map((t) => ({ ...t, publicidad_restringida: Boolean(t.publicidad_restringida) })) }),
    });
  }));

  r.post('/resenas/:id/publicar', envolver(async (req, res) => {
    if (!deps?.google) return res.status(503).json({ error: 'Google no configurado' });
    try {
      await resenasSrv.aprobarYPublicar(p(), deps.google, { resenaId: Number(req.params.id), texto: req.body?.texto || null, aprobadaPor: req.usuario?.email || 'panel' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }));

  // ── Ajustes: qué tratamiento se hace en qué sala ──────────────────────────────────────────
  r.get('/ajustes/salas-tratamientos', envolver(async (req, res) => {
    const [salas] = await p().query('SELECT id, nombre, tipo FROM salas WHERE activa = TRUE ORDER BY orden, id');
    const [trats] = await p().query('SELECT id, nombre, familia, sala_tipo, equipo_codigo FROM tratamientos WHERE activo = TRUE ORDER BY familia, nombre');
    const [pares] = await p().query('SELECT tratamiento_id, sala_id FROM tratamiento_salas');
    const explicitos = new Map();
    for (const x of pares) (explicitos.get(x.tratamiento_id) || explicitos.set(x.tratamiento_id, new Set()).get(x.tratamiento_id)).add(x.sala_id);
    res.json({
      salas,
      tratamientos: trats.map((t) => {
        const set = explicitos.get(t.id);
        return { ...t, salas: set ? [...set] : salas.filter((s) => !t.sala_tipo || s.tipo === t.sala_tipo).map((s) => s.id), porTipo: !set };
      }),
    });
  }));

  r.put('/ajustes/salas-tratamientos/:tratamiento', envolver(async (req, res) => {
    const id = req.params.tratamiento;
    const salas = (req.body?.salas || []).map(Number).filter(Number.isInteger);
    const con = await p().getConnection();
    try {
      await con.beginTransaction();
      await con.query('DELETE FROM tratamiento_salas WHERE tratamiento_id = ?', [id]);
      for (const s of salas) await con.query('INSERT INTO tratamiento_salas (tratamiento_id, sala_id) VALUES (?, ?)', [id, s]);
      await registrar(con, { tipo: 'ajuste_salas_tratamiento', entidad: 'tratamiento', entidadId: id, actor: req.usuario?.email || 'panel', datos: { salas } });
      await con.commit();
    } catch (err) {
      await con.rollback();
      throw err;
    } finally {
      con.release();
    }
    res.json({ ok: true, salas });
  }));

  r.use((err, _req, res, _next) => {
    console.error('panel:', err.message);
    res.status(500).json({ error: 'Algo ha fallado en el servidor' });
  });
  return r;
}

module.exports = { rutasPanel };
