'use strict';
// API del panel de la clínica. Todo detrás de sesión (servidor/sesion.js). Devuelve lo justo para
// cada pantalla: hoy, agenda por cabina, bandeja de conversaciones, seguimientos, repesca,
// plantillas, reseñas y ajustes (qué tratamiento se hace en qué sala).
const express = require('express');
const T = require('../../motor/tiempo');
const { descifrar } = require('../cripto');
const { comprobarPlantilla } = require('../../motor/repesca/plantillas');
const R = require('../../motor/resenas/resenas');
const { ideasDelMes } = require('../../motor/resenas/publicaciones');
const agenda = require('../agenda');
const repesca = require('../repesca/motor');
const resenasSrv = require('../resenas');
const { registrar } = require('../eventos');

const madrid = (d) => (d ? T.partesMadrid(new Date(d)) : null);
const envolver = (fn) => (req, res, next) => fn(req, res).catch(next);

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
    const [citas] = await q("SELECT COUNT(*) AS n, SUM(estado = 'confirmada') AS confirmadas FROM citas WHERE inicio >= ? AND inicio < ? AND estado NOT IN ('cancelada','reprogramada')", [desde, hasta]);
    const [espera] = await q("SELECT COUNT(*) AS n, SUM(urgente) AS urgentes FROM conversaciones WHERE estado = 'espera_persona'");
    const [ia] = await q("SELECT COUNT(*) AS n FROM conversaciones WHERE estado IN ('ia_activa','esperando_paciente')");
    const [seg] = await q("SELECT COUNT(*) AS n FROM seguimientos WHERE estado = 'pendiente' AND programado_para >= ? AND programado_para < ?", [desde, hasta]);
    const [tareas] = await q("SELECT COUNT(*) AS n, SUM(vence_en < ?) AS vencidas FROM tareas WHERE estado = 'abierta'", [ahora]);
    const [resenas] = await q("SELECT COUNT(*) AS n FROM resenas WHERE estado IN ('nueva','borrador')");
    const inicioMes = T.desdeMadrid(`${hoy.slice(0, 8)}01`, '00:00');
    const [recuperadas] = await q(
      `SELECT COUNT(*) AS n, COALESCE(SUM(t.precio_eur), 0) AS euros FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id
        WHERE c.creado_en >= ? AND c.origen = 'ia_whatsapp' AND c.estado NOT IN ('cancelada')`, [inicioMes]);
    const sinPaso = await repesca.sinProximoPaso(p(), ahora);
    res.json({
      fecha: hoy,
      citas: { total: Number(citas.n), confirmadas: Number(citas.confirmadas || 0) },
      conversaciones: { esperaPersona: Number(espera.n), urgentes: Number(espera.urgentes || 0), conIa: Number(ia.n) },
      seguimientosHoy: Number(seg.n),
      tareas: { abiertas: Number(tareas.n), vencidas: Number(tareas.vencidas || 0) },
      resenasPorResponder: Number(resenas.n),
      recuperadoMes: { citas: Number(recuperadas.n), euros: Number(recuperadas.euros) },
      sinProximoPaso: sinPaso.length,
    });
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

  r.post('/citas', envolver(async (req, res) => {
    const b = req.body || {};
    try {
      const c = await agenda.reservar(p(), { pacienteId: b.pacienteId, tratamientoId: b.tratamientoId, fecha: b.fecha, hora: b.hora, profesionalId: b.profesionalId, salaId: b.salaId, origen: 'recepcion', actor: req.usuario?.email || 'panel' });
      res.status(201).json(c);
    } catch (err) {
      if (err.codigo) return res.status(409).json({ error: err.message, codigo: err.codigo });
      throw err;
    }
  }));

  // ── Bandeja de conversaciones ────────────────────────────────────────────────────────────
  r.get('/conversaciones', envolver(async (req, res) => {
    const [filas] = await p().query(
      `SELECT c.*, p.nombre, p.apellidos, l.nombre AS lead_nombre, l.origen AS lead_origen, l.campana,
              (SELECT COUNT(*) FROM seguimientos s WHERE s.conversacion_id = c.id AND s.estado = 'pendiente') AS seguimientos,
              (SELECT MIN(s.programado_para) FROM seguimientos s WHERE s.conversacion_id = c.id AND s.estado = 'pendiente') AS proximo_seguimiento
         FROM conversaciones c LEFT JOIN pacientes p ON p.id = c.paciente_id LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.estado <> 'cerrada' OR c.actualizado_en > ? ORDER BY c.urgente DESC, FIELD(c.estado, 'espera_persona', 'persona', 'ia_activa', 'esperando_paciente', 'pausada', 'cerrada'), c.actualizado_en DESC LIMIT 200`,
      [new Date((req.ahora || new Date()).getTime() - 7 * 86400000)]);
    res.json(filas.map((c) => ({
      id: c.id, estado: c.estado, urgente: Boolean(c.urgente), contexto: c.contexto,
      nombre: c.nombre ? `${c.nombre}${c.apellidos ? ` ${c.apellidos}` : ''}` : c.lead_nombre || c.telefono,
      origen: c.lead_origen, campana: c.campana, telefonoFinal: String(c.telefono).slice(-3),
      ventanaAbierta: Boolean(c.ventana_hasta && new Date(c.ventana_hasta) > (req.ahora || new Date())),
      ventanaHasta: c.ventana_hasta, proximoPaso: c.proximo_paso, proximoPasoEn: c.proximo_paso_en, proximoSeguimiento: c.proximo_seguimiento,
      motivoCierre: c.motivo_cierre, actualizado: c.actualizado_en,
    })));
  }));

  r.get('/conversaciones/:id', envolver(async (req, res) => {
    const id = Number(req.params.id);
    const [[c]] = await p().query('SELECT * FROM conversaciones WHERE id = ?', [id]);
    if (!c) return res.status(404).json({ error: 'No existe' });
    const [msgs] = await p().query('SELECT id, direccion, autor, tipo, cuerpo_cifrado, iv, tag, estado, intencion, creado_en FROM mensajes WHERE conversacion_id = ? ORDER BY id', [id]);
    const [segs] = await p().query('SELECT id, motivo, plazo_tipo, frase_cifrada, frase_iv, frase_tag, programado_para, estado, creado_por FROM seguimientos WHERE conversacion_id = ? ORDER BY programado_para', [id]);
    const [eventos] = await p().query("SELECT tipo, actor, datos, creado_en FROM eventos WHERE entidad = 'conversacion' AND entidad_id = ? ORDER BY id DESC LIMIT 20", [String(id)]);
    const [[paciente]] = c.paciente_id ? await p().query('SELECT id, nombre, apellidos, email, es_cliente, baja_comercial_en FROM pacientes WHERE id = ?', [c.paciente_id]) : [[null]];
    const [[lead]] = c.lead_id ? await p().query('SELECT l.nombre, l.origen, l.campana, l.etapa, t.nombre AS tratamiento FROM leads l LEFT JOIN tratamientos t ON t.id = l.tratamiento_interes_id WHERE l.id = ?', [c.lead_id]) : [[null]];
    const [citas] = c.paciente_id ? await p().query('SELECT c.inicio, c.estado, t.nombre AS tratamiento FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id WHERE c.paciente_id = ? ORDER BY c.inicio DESC LIMIT 5', [c.paciente_id]) : [[]];
    res.json({
      conversacion: { id: c.id, estado: c.estado, urgente: Boolean(c.urgente), contexto: c.contexto, proximoPaso: c.proximo_paso, proximoPasoEn: c.proximo_paso_en, ventanaHasta: c.ventana_hasta, motivoCierre: c.motivo_cierre },
      paciente, lead, citas,
      mensajes: msgs.map((m) => ({ id: m.id, direccion: m.direccion, autor: m.autor, tipo: m.tipo, texto: descifrar(m.cuerpo_cifrado, m.iv, m.tag), estado: m.estado, intencion: m.intencion, en: m.creado_en })),
      seguimientos: segs.map((s) => ({ id: s.id, motivo: s.motivo, plazo: s.plazo_tipo, frase: descifrar(s.frase_cifrada, s.frase_iv, s.frase_tag), programado: s.programado_para, estado: s.estado, creadoPor: s.creado_por })),
      decisiones: eventos.map((e) => ({ tipo: e.tipo, actor: e.actor, datos: typeof e.datos === 'string' ? JSON.parse(e.datos) : e.datos, en: e.creado_en })),
    });
  }));

  // Tomar la conversación (la IA calla) o devolverla a la IA.
  r.post('/conversaciones/:id/:accion', envolver(async (req, res) => {
    const id = Number(req.params.id);
    const accion = req.params.accion;
    if (!['tomar', 'devolver', 'cerrar'].includes(accion)) return res.status(404).json({ error: 'Acción desconocida' });
    const estado = { tomar: 'persona', devolver: 'ia_activa', cerrar: 'cerrada' }[accion];
    await p().query('UPDATE conversaciones SET estado = ?, urgente = IF(? = \'persona\', urgente, FALSE), motivo_cierre = IF(? = \'cerrada\', ?, motivo_cierre) WHERE id = ?',
      [estado, estado, estado, req.body?.motivo || 'cerrada a mano', id]);
    if (accion !== 'tomar') await p().query("UPDATE tareas SET estado = 'hecha', hecha_en = ? WHERE conversacion_id = ? AND estado = 'abierta'", [new Date(), id]);
    await registrar(p(), { tipo: `conversacion_${accion}`, entidad: 'conversacion', entidadId: id, actor: req.usuario?.email || 'panel' });
    res.json({ ok: true, estado });
  }));

  // Escribir desde el panel: texto si la ventana está abierta; si no, hay que elegir plantilla.
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
      return res.json(await repesca.enviar({ ...deps, pool: p() }, c, { plantilla: pl, variables: req.body.variables || [], autor: 'persona', ahora }));
    }
    if (!abierta) return res.status(409).json({ error: 'Han pasado 24 horas desde el último mensaje del paciente: solo se puede escribir con una plantilla aprobada', codigo: 'VENTANA_CERRADA' });
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'El mensaje está vacío' });
    await p().query("UPDATE conversaciones SET estado = 'persona' WHERE id = ?", [id]);
    res.json(await repesca.enviar({ ...deps, pool: p() }, c, { texto, autor: 'persona', ahora }));
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
      botones: typeof x.botones === 'string' ? JSON.parse(x.botones) : x.botones, motivoRechazo: x.motivo_rechazo, reservaDeId: x.reserva_de_id,
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
