'use strict';
// Avisos de cita al paciente por WhatsApp:
//
//   confirmación   al reservar desde recepción, teléfono o la web (la que reserva la IA ya la
//                  confirma en la propia conversación). Con el mapa de la sede y dos botones:
//                  «Añadir al calendario» (/cal/…, un toque) y «Ver mi cita» (/c/…). Si la cita
//                  sustituye a otra (recepción le aceptó un hueco de la lista de espera), «tu cita
//                  ha cambiado: borra la anterior de tu calendario» (en el calendario es otro evento)
//   víspera        el día antes, desde las 10:00, «¿Nos confirmas que vienes?» con dos respuestas
//                  rápidas («Sí, allí estaré» / «Necesito cambiarla»), que entiende la repesca
//   2 horas antes  un recordatorio corto con el mapa de la sede y «Ver mi cita» (desde las 9:00)
//
// Ninguno nombra el tratamiento (sale en la pantalla bloqueada y es un dato de salud): dicen el día,
// la hora y la sede; la página «Tu cita» enseña el resto. Con la ventana de 24 h abierta va como
// texto (con los enlaces); si no, con la plantilla aprobada de su uso. Son mensajes de servicio sobre
// su propia cita: se mandan aunque haya pedido la baja comercial. Lo llama el cron cada minuto; cada
// aviso se marca antes de mandarlo, así nunca sale dos veces (y si algo falla antes de que salga, se
// desmarca y se vuelve a intentar al minuto siguiente).
const T = require('../motor/tiempo');
const { elegirPlantilla, variablesDe, botonesDe, cabeceraDe } = require('../motor/repesca/plantillas');
const { direccionPostal } = require('../motor/calendario/ics');
const { registrar } = require('./eventos');
const R = require('./repesca/motor');

const MIN = 60000;
const HORA = 60 * MIN;
// Treatwell manda sus propios avisos. Lo que se trajo de Flowww (flowww_id) ya se dio y se confirmó
// allí: entra con la confirmación dada (aviso_confirmacion_en) y recibe los recordatorios (salvo que se
// importara sin ellos: columna recordatorios). Se mira flowww_id y no el origen: una cita que sale de
// mover una importada (reprogramar, lista de espera) hereda el origen, pero la acaba de dar la app y
// lleva su confirmación como cualquier otra.
const ORIGENES_SIN_AVISO = ['treatwell'];
// A lo que se trajo de Flowww no se le aplica «la reservó hace nada»: la pidió hace tiempo, en Flowww.
const reciente = (f, ahora, horas) => !f.flowww_id && ahora - new Date(f.creado_en) <= horas * HORA;

const USOS = {
  confirmacion: { columna: 'aviso_confirmacion_en', uso: 'cita_confirmacion' },
  vispera: { columna: 'aviso_24h_en', uso: 'cita_recordatorio_24h' },
  dos_horas: { columna: 'aviso_2h_en', uso: 'cita_recordatorio_2h' },
};
// La confirmación de una cita que sustituye a otra. Sin esa plantilla aprobada, sale la confirmación.
const USO_CAMBIADA = 'cita_cambiada';

// reenvio: recepción le ha cambiado el enlace (lo había perdido, lo compartía…) y se lo vuelve a mandar.
function textoLibre(tipo, c, nombre, { cambiada = false, reenvio = false } = {}) {
  const hola = `Hola${nombre ? ` ${nombre}` : ''}`;
  const donde = c.donde ? ` en ${c.donde}` : '';
  if (tipo === 'confirmacion' && reenvio) {
    return `${hola}, te mandamos el enlace nuevo de tu cita ${R.textoDia(c.fecha)} a las ${c.hora}${donde}: el anterior ya no funciona.${R.enlacesCita(c)}`;
  }
  if (tipo === 'confirmacion') {
    return cambiada
      ? `${hola}, tu cita ha cambiado: ahora te esperamos ${R.textoDia(c.fecha)} a las ${c.hora}${donde}. Si tenías la anterior en tu calendario, bórrala y añade esta.${R.enlacesCita(c)}`
      : `${hola}, tu cita está confirmada: te esperamos ${R.textoDia(c.fecha)} a las ${c.hora}${donde}.${R.enlacesCita(c)}`;
  }
  const tuCita = c.url ? `\n\nTu cita: ${c.url}` : '';
  if (tipo === 'vispera') return `${hola}, te esperamos mañana, ${R.textoDia(c.fecha).slice(3)}, a las ${c.hora}${donde}. ¿Nos confirmas que vienes?${tuCita}`;
  return `${hola}, hoy a las ${c.hora} te esperamos${donde}. Si te surge algo, responde a este mensaje.${tuCita}`;
}

// Las variables de cada plantilla (motor/repesca/plantillas.js): sin tratamiento. Meta no admite una
// variable vacía: sin sede, el nombre de la clínica.
function variablesPlantilla(tipo, c, saludo) {
  const donde = c.donde || c.marca;
  if (tipo === 'dos_horas') return [saludo, c.hora, donde];
  return [saludo, R.textoDia(c.fecha).slice(3), c.hora, donde];
}

// El final de la URL de sus botones de enlace: el token de la cita («Añadir al calendario» y «Ver
// mi cita» en la confirmación; «Ver mi cita» dos horas antes). La víspera solo lleva respuestas rápidas.
function botonesPlantilla(tipo, c) {
  if (!c.token) return [];
  if (tipo === 'confirmacion') return [c.token, c.token];
  if (tipo === 'dos_horas') return [c.token];
  return [];
}

// El mapa de la sede (solo sale si la plantilla lo lleva).
function mapaDe(sede) {
  if (!sede || sede.lat == null || sede.lng == null) return null;
  return { tipo: 'ubicacion', lat: sede.lat, lng: sede.lng, nombre: sede.nombre, direccion: direccionPostal(sede) };
}

// Lo que la plantilla aprobada pide y no se le puede dar: Meta la rechazaría, o se leería mal (una
// aprobada con otra versión del texto, un mapa sin coordenadas, un enlace que no se recupera). null si
// está todo.
function faltaEnPlantilla(plantilla, { variables, botones, cabecera }) {
  const espera = new Set(variablesDe(plantilla.cuerpo)).size;
  if (espera !== variables.length) return `la plantilla aprobada lleva ${espera} datos y el aviso manda ${variables.length}: es de otra versión`;
  if (cabeceraDe(plantilla)?.tipo === 'ubicacion' && !cabecera) return 'la sede no tiene coordenadas para el mapa';
  const conEnlace = botonesDe(plantilla).filter((b) => b.tipo === 'url' && /\{\{1\}\}/.test(b.url || '')).length;
  if (conEnlace > botones.length) return 'no se ha podido recuperar el enlace de la cita';
  return null;
}

// Las plantillas dicen «Hola {{1}}, …». Sin nombre, «Hola buenos días, …» (o «buenas tardes»).
const saludoSinNombre = (ahora) => (T.minutosMadrid(ahora) < 14 * 60 ? 'buenos días' : 'buenas tardes');

// ¿Sustituye a otra cita (que se cambió a esta)?
async function sustituyeAOtra(q, citaId) {
  const [[vieja]] = await q.query("SELECT id FROM citas WHERE reprograma_a_id = ? AND estado = 'reprogramada' LIMIT 1", [citaId]);
  return Boolean(vieja);
}

async function avisar(deps, citaId, tipo, { ahora = new Date(), reenvio = false } = {}) {
  const { pool } = deps;
  const { columna } = USOS[tipo];
  // Se marca primero: si dos procesos llegan a la vez, solo uno lo manda.
  const [marca] = await pool.query(`UPDATE citas SET ${columna} = ? WHERE id = ? AND ${columna} IS NULL`, [ahora, citaId]);
  if (marca.affectedRows !== 1) return { citaId, tipo, omitido: 'ya avisado' };
  const paso = { enviando: false };
  try {
    return await mandarAviso(deps, citaId, tipo, { ahora, paso, reenvio });
  } catch (err) {
    // Si falla antes de mandarlo (en un despliegue, el código nuevo con la base aún sin migrar; la base
    // caída un momento), se desmarca y el cron lo vuelve a intentar al minuto siguiente: si no, ese aviso
    // no saldría nunca. Si ya se ha intentado mandar, no: le podría llegar dos veces. (La marca se busca
    // sin los milisegundos, que el DATETIME no guarda.)
    if (!paso.enviando) {
      await pool.query(`UPDATE citas SET ${columna} = NULL WHERE id = ? AND ${columna} = ?`, [citaId, new Date(Math.floor(ahora.getTime() / 1000) * 1000)])
        .catch(() => {});
    }
    throw err;
  }
}

// El aviso, ya marcado. paso.enviando: si ya se ha intentado mandar (a partir de ahí, no se desmarca).
async function mandarAviso(deps, citaId, tipo, { ahora, paso, reenvio }) {
  const { pool } = deps;
  const { uso } = USOS[tipo];
  const [[fila]] = await pool.query(
    'SELECT c.paciente_id, p.nombre, p.telefono FROM citas c JOIN pacientes p ON p.id = c.paciente_id WHERE c.id = ?', [citaId]);
  if (!fila?.telefono) return { citaId, tipo, omitido: 'sin teléfono' };
  const c = await R.datosCita(pool, citaId);
  // «Paciente» es el nombre que se pone a quien reserva sin decirlo: no se le saluda así.
  const nombre = fila.nombre && fila.nombre !== 'Paciente' ? fila.nombre : null;
  // Si se le vuelve a mandar con el enlace nuevo, no es «tu cita ha cambiado»: la cita es la misma.
  const cambiada = !reenvio && tipo === 'confirmacion' && await sustituyeAOtra(pool, citaId);

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
  let plantilla = null;
  if (ventanaAbierta) {
    paso.enviando = true;
    envio = await R.enviar(deps, conv, { texto: textoLibre(tipo, c, nombre, { cambiada, reenvio }), autor: 'sistema', ahora });
  } else {
    const plantillas = await R.plantillasBd(pool);
    plantilla = (cambiada && elegirPlantilla(USO_CAMBIADA, plantillas)) || elegirPlantilla(uso, plantillas);
    const envioPlantilla = { variables: variablesPlantilla(tipo, c, nombre || saludoSinNombre(ahora)), botones: botonesPlantilla(tipo, c), cabecera: mapaDe(c.sede) };
    const falta = plantilla ? faltaEnPlantilla(plantilla, envioPlantilla) : `falta la plantilla aprobada «${uso}»`;
    if (falta) {
      await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES ('otro', ?, ?, ?, ?)",
        [`${reenvio ? 'No sale su enlace nuevo de la cita' : 'No sale el aviso de la cita'} (${falta}): ${reenvio ? 'dárselo' : 'avisar'} a mano`.slice(0, 200),
          fila.paciente_id, conv.id, new Date(ahora.getTime() + HORA)]);
      await registrar(pool, { tipo: 'aviso_cita_sin_plantilla', entidad: 'cita', entidadId: citaId, datos: { tipo, uso: plantilla?.uso || uso, motivo: falta } });
      return { citaId, tipo, fallido: plantilla ? falta : 'sin plantilla' };
    }
    paso.enviando = true;
    envio = await R.enviar(deps, conv, { plantilla, ...envioPlantilla, autor: 'sistema', ahora });
  }
  // Un aviso no deja trabajo en la bandeja: si la conversación no tiene nada más en marcha, se
  // cierra «con cita». Si contesta, se reabre (ver conversacionPara).
  await R.cerrarConCita(pool, conv.id, c.inicio);
  // Lo último que ha leído es su cita (la víspera, además, le pregunta si viene): su «sí» a secas (o su
  // «no») contesta a eso. Si no, lo leería la repesca como «acepta» y le ofrecería huecos para otra cita.
  if (envio.estado === 'enviado') {
    await R.ponerPregunta(pool, conv.id, { tipo: 'confirmar_cita', citaId, mensajeId: envio.mensajeId }, ahora);
  }
  await registrar(pool, {
    tipo: `aviso_cita_${tipo}`, entidad: 'cita', entidadId: citaId,
    datos: {
      ventanaAbierta: Boolean(ventanaAbierta), estado: envio.estado, ...(plantilla ? { plantilla: plantilla.nombre } : {}), ...(cambiada ? { cambiada } : {}),
      ...(reenvio ? { reenvio } : {}),
    },
  });
  return { citaId, tipo, envio };
}

// Le vuelve a mandar su cita con el enlace nuevo, después de que recepción se lo cambie
// (agenda.cambiarEnlace): la confirmación de siempre (por texto, o con su plantilla si la ventana está
// cerrada), aunque ya la tuviera. Solo de una cita confirmada que aún no ha llegado.
async function reenviarEnlace(deps, citaId, { ahora = new Date() } = {}) {
  const [[c]] = await deps.pool.query('SELECT estado, inicio FROM citas WHERE id = ?', [citaId]);
  if (c?.estado !== 'confirmada' || new Date(c.inicio) <= ahora) return { citaId, tipo: 'confirmacion', omitido: 'la cita no está confirmada o ya ha llegado su hora' };
  await deps.pool.query('UPDATE citas SET aviso_confirmacion_en = NULL WHERE id = ?', [citaId]);
  return avisar(deps, citaId, 'confirmacion', { ahora, reenvio: true });
}

// Qué avisos tocan ahora.
async function pendientes(pool, ahora = new Date()) {
  const p = T.partesMadrid(ahora);
  const manana = T.sumarDias(p.fecha, 1);
  const salida = [];

  const [conf] = await pool.query(
    `SELECT id FROM citas WHERE estado = 'confirmada' AND aviso_confirmacion_en IS NULL AND inicio > ?
        AND creado_en <= ? AND origen NOT IN (?) ORDER BY inicio LIMIT 50`,
    [ahora, new Date(ahora.getTime() - 2 * MIN), ORIGENES_SIN_AVISO]);
  // De noche no: la confirmación de una cita dada a las 22:00 sale a las 9:00.
  if (p.minutos >= 9 * 60 && p.minutos < 21 * 60) for (const f of conf) salida.push({ id: f.id, tipo: 'confirmacion' });

  if (p.minutos >= 10 * 60 && p.minutos < 21 * 60) {
    const [vispera] = await pool.query(
      `SELECT id, inicio, creado_en, flowww_id FROM citas WHERE estado = 'confirmada' AND aviso_24h_en IS NULL AND inicio > ? AND inicio < ?
          AND origen NOT IN (?) AND recordatorios ORDER BY inicio LIMIT 100`,
      [ahora, new Date(ahora.getTime() + 40 * HORA), ORIGENES_SIN_AVISO]);
    for (const f of vispera) {
      // Si la reservó hace menos de 12 horas, la confirmación está reciente: no hace falta.
      if (T.fechaMadrid(new Date(f.inicio)) === manana && !reciente(f, ahora, 12)) salida.push({ id: f.id, tipo: 'vispera' });
    }
  }

  if (p.minutos >= 9 * 60) {
    const [pronto] = await pool.query(
      `SELECT id, creado_en, flowww_id FROM citas WHERE estado = 'confirmada' AND aviso_2h_en IS NULL AND inicio > ? AND inicio <= ?
          AND origen NOT IN (?) AND recordatorios ORDER BY inicio LIMIT 50`,
      [new Date(ahora.getTime() + 30 * MIN), new Date(ahora.getTime() + 2 * HORA), ORIGENES_SIN_AVISO]);
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

module.exports = { avisar, reenviarEnlace, pendientes, enviarPendientes, cerrarConversacionesDeCitasPasadas, textoLibre, variablesPlantilla };
