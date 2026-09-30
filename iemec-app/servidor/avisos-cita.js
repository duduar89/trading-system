'use strict';
// Avisos de cita al paciente por WhatsApp, con el enlace «Tu cita» para añadirla al calendario:
//
//   confirmación   al reservar desde recepción, teléfono o la web (la que reserva la IA ya la
//                  confirma en la propia conversación)
//   víspera        el día antes, desde las 10:00, con «¿Nos lo confirmas?»
//   2 horas antes  un recordatorio corto (desde las 9:00)
//
// Con la ventana de 24 h abierta va como texto; si no, con la plantilla aprobada de su uso. Son
// mensajes de servicio sobre su propia cita: se mandan aunque haya pedido la baja comercial. Lo
// llama el cron cada minuto; cada aviso se marca antes de mandarlo, así nunca sale dos veces.
const T = require('../motor/tiempo');
const { elegirPlantilla } = require('../motor/repesca/plantillas');
const { registrar } = require('./eventos');
const R = require('./repesca/motor');

const MIN = 60000;
const HORA = 60 * MIN;
// Treatwell manda sus propios avisos. Lo importado de Flowww ya se dio y se confirmó allí: no lleva
// confirmación, pero sí los recordatorios (salvo que se importara sin ellos: columna recordatorios).
const ORIGENES_SIN_CONFIRMACION = ['treatwell', 'importacion'];
const ORIGENES_SIN_RECORDATORIO = ['treatwell'];
// A lo importado no se le aplica «la reservó hace nada»: el paciente la pidió hace tiempo, en Flowww.
const reciente = (f, ahora, horas) => f.origen !== 'importacion' && ahora - new Date(f.creado_en) <= horas * HORA;

const USOS = {
  confirmacion: { columna: 'aviso_confirmacion_en', uso: 'cita_confirmacion' },
  vispera: { columna: 'aviso_24h_en', uso: 'cita_recordatorio_24h' },
  dos_horas: { columna: 'aviso_2h_en', uso: 'cita_recordatorio_2h' },
};

function textoLibre(tipo, c, nombre) {
  const hola = `Hola${nombre ? ` ${nombre}` : ''}`;
  if (tipo === 'confirmacion') {
    return `${hola}, tu cita en ${c.marca} está confirmada: ${R.textoDia(c.fecha)} a las ${c.hora}, ${c.tratamiento}.\n\n`
      + `Aquí la tienes para añadirla a tu calendario, y cambiarla o cancelarla si lo necesitas: ${c.url}`;
  }
  if (tipo === 'vispera') {
    return `${hola}, te esperamos mañana a las ${c.hora} en ${c.marca}${c.donde ? ` (${c.donde})` : ''}. ¿Nos lo confirmas?\n\nTu cita: ${c.url}`;
  }
  return `${hola}, en un par de horas, a las ${c.hora}, te vemos en ${c.marca}. Si te surge algo, avísanos por aquí.`;
}

function variablesPlantilla(tipo, c, nombre) {
  if (tipo === 'confirmacion') return [nombre || 'hola', R.textoDia(c.fecha).slice(3), c.hora, R.enMinuscula(c.tratamiento)];
  return [nombre || 'hola', c.hora];
}

async function avisar(deps, citaId, tipo, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const { columna, uso } = USOS[tipo];
  // Se marca primero: si dos procesos llegan a la vez, solo uno lo manda.
  const [marca] = await pool.query(`UPDATE citas SET ${columna} = ? WHERE id = ? AND ${columna} IS NULL`, [ahora, citaId]);
  if (marca.affectedRows !== 1) return { citaId, tipo, omitido: 'ya avisado' };
  const [[fila]] = await pool.query(
    'SELECT c.paciente_id, p.nombre, p.telefono FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE c.id = ?', [citaId]);
  if (!fila?.telefono) return { citaId, tipo, omitido: 'sin teléfono' };
  const c = await R.datosCita(pool, citaId);

  const con = await pool.getConnection();
  let conv;
  try {
    await con.beginTransaction();
    conv = await R.conversacionPara(con, { telefono: fila.telefono, pacienteId: fila.paciente_id, contexto: 'cita', contextoId: citaId, ahora });
    await con.commit();
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }

  const ventanaAbierta = conv.ventana_hasta && new Date(conv.ventana_hasta) > ahora;
  let envio;
  if (ventanaAbierta) {
    envio = await R.enviar(deps, conv, { texto: textoLibre(tipo, c, fila.nombre), autor: 'sistema', ahora });
  } else {
    const plantilla = elegirPlantilla(uso, await R.plantillasBd(pool));
    if (!plantilla) {
      await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES ('otro', ?, ?, ?, ?)",
        [`Falta la plantilla aprobada «${uso}»: avisar a mano de la cita`, fila.paciente_id, conv.id, new Date(ahora.getTime() + HORA)]);
      await registrar(pool, { tipo: 'aviso_cita_sin_plantilla', entidad: 'cita', entidadId: citaId, datos: { tipo, uso } });
      return { citaId, tipo, fallido: 'sin plantilla' };
    }
    envio = await R.enviar(deps, conv, {
      plantilla, variables: variablesPlantilla(tipo, c, fila.nombre), autor: 'sistema', ahora,
      botonUrl: tipo === 'confirmacion' ? c.token : null,
    });
  }
  // Un aviso no deja trabajo en la bandeja: si la conversación no tiene nada más en marcha, se
  // cierra «con cita». Si contesta, se reabre (ver conversacionPara).
  await pool.query(
    `UPDATE conversaciones c SET c.estado = 'cerrada', c.motivo_cierre = 'cita', c.proximo_paso = 'cita', c.proximo_paso_en = ?
      WHERE c.id = ? AND c.estado IN ('ia_activa','esperando_paciente')
        AND NOT EXISTS (SELECT 1 FROM seguimientos s WHERE s.conversacion_id = c.id AND s.estado = 'pendiente')
        AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.conversacion_id = c.id AND t.estado = 'abierta')`, [c.inicio, conv.id]);
  await registrar(pool, { tipo: `aviso_cita_${tipo}`, entidad: 'cita', entidadId: citaId, datos: { ventanaAbierta: Boolean(ventanaAbierta), estado: envio.estado } });
  return { citaId, tipo, envio };
}

// Qué avisos tocan ahora.
async function pendientes(pool, ahora = new Date()) {
  const p = T.partesMadrid(ahora);
  const manana = T.sumarDias(p.fecha, 1);
  const salida = [];

  const [conf] = await pool.query(
    `SELECT id FROM citas WHERE estado = 'confirmada' AND aviso_confirmacion_en IS NULL AND inicio > ?
        AND creado_en <= ? AND origen NOT IN (?) ORDER BY inicio LIMIT 50`,
    [ahora, new Date(ahora.getTime() - 2 * MIN), ORIGENES_SIN_CONFIRMACION]);
  // De noche no: la confirmación de una cita dada a las 22:00 sale a las 9:00.
  if (p.minutos >= 9 * 60 && p.minutos < 21 * 60) for (const f of conf) salida.push({ id: f.id, tipo: 'confirmacion' });

  if (p.minutos >= 10 * 60 && p.minutos < 21 * 60) {
    const [vispera] = await pool.query(
      `SELECT id, inicio, creado_en, origen FROM citas WHERE estado = 'confirmada' AND aviso_24h_en IS NULL AND inicio > ? AND inicio < ?
          AND origen NOT IN (?) AND recordatorios ORDER BY inicio LIMIT 100`,
      [ahora, new Date(ahora.getTime() + 40 * HORA), ORIGENES_SIN_RECORDATORIO]);
    for (const f of vispera) {
      // Si la reservó hace menos de 12 horas, la confirmación está reciente: no hace falta.
      if (T.fechaMadrid(new Date(f.inicio)) === manana && !reciente(f, ahora, 12)) salida.push({ id: f.id, tipo: 'vispera' });
    }
  }

  if (p.minutos >= 9 * 60) {
    const [pronto] = await pool.query(
      `SELECT id, creado_en, origen FROM citas WHERE estado = 'confirmada' AND aviso_2h_en IS NULL AND inicio > ? AND inicio <= ?
          AND origen NOT IN (?) AND recordatorios ORDER BY inicio LIMIT 50`,
      [new Date(ahora.getTime() + 30 * MIN), new Date(ahora.getTime() + 2 * HORA), ORIGENES_SIN_RECORDATORIO]);
    for (const f of pronto) if (!reciente(f, ahora, 3)) salida.push({ id: f.id, tipo: 'dos_horas' });
  }
  return salida;
}

async function enviarPendientes(deps, { ahora = new Date() } = {}) {
  const resultados = [];
  for (const a of await pendientes(deps.pool, ahora)) {
    try {
      resultados.push(await avisar(deps, a.id, a.tipo, { ahora }));
    } catch (err) {
      resultados.push({ citaId: a.id, tipo: a.tipo, error: err.message });
    }
  }
  return resultados;
}

// Cada mañana: las conversaciones que solo esperaban a una cita que ya pasó se cierran.
async function cerrarConversacionesDeCitasPasadas(pool, ahora = new Date()) {
  const [r] = await pool.query(
    "UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'cita' WHERE estado IN ('esperando_paciente','ia_activa') AND proximo_paso = 'cita' AND proximo_paso_en < ?",
    [ahora]);
  return r.affectedRows;
}

module.exports = { avisar, pendientes, enviarPendientes, cerrarConversacionesDeCitasPasadas, textoLibre };
