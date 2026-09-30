'use strict';
// La lista de espera por WhatsApp (lo llama el cron cada minuto, después de liberar las retenciones
// caducadas y de leer lo que ha llegado):
//
//   1. Las ofertas cuya conversación ha pasado a una persona: tarea urgente para recepción.
//   2. Las ofertas sin respuesta a la media hora caducan: su hueco queda libre otra vez.
//   3. Cada hueco liberado se le guarda al primero de la lista que encaja y se le avisa con la
//      plantilla «hueco_liberado» («Sí, guárdamelo» / «No me viene bien»), o con texto si su
//      ventana de 24 h está abierta. Lo que contesta lo entiende la repesca (repesca/motor.js).
//
// Un fallo técnico no le quita el turno a nadie: sin la plantilla aprobada no se le guarda nada y
// recepción tiene una tarea (una por hueco); si WhatsApp no responde, se suelta el hueco y se vuelve a
// probar con él a los pocos minutos. De noche no se escribe: lo que se libera a las 23:00 se ofrece a
// partir de las 9:00 (si aún da tiempo). Las reglas y la base están en servidor/lista-espera.js.
const T = require('../motor/tiempo');
const { elegirPlantilla } = require('../motor/repesca/plantillas');
const { esSensible } = require('../motor/repesca/filtro-legal');
const { registrar } = require('./eventos');
const cola = require('./cola');
const LE = require('./lista-espera');
const R = require('./repesca/motor');

const HORARIO = { desde: 9 * 60, hasta: 21 * 60 };
const PAUSA_MIN = 5;            // si WhatsApp no responde, se reintenta a los 5 minutos
const PAUSA = 'lista-espera-pausa';

function textoOferta(c, { nombre, actual, tratamiento }) {
  const hola = `Hola${nombre ? ` ${nombre}` : ''}`;
  if (actual) {
    return `${hola}, se ha liberado un hueco antes para tu ${tratamiento}: ${R.textoDia(c.fecha)} a las ${c.hora} (ahora tienes cita ${R.textoDia(actual.fecha)} a las ${actual.hora}). `
      + `Te lo guardo ${LE.RETENCION_MIN} minutos: ¿te cambio la cita?`;
  }
  return `${hola}, estabas en nuestra lista de espera para tu ${tratamiento}: se ha liberado un hueco ${R.textoDia(c.fecha)} a las ${c.hora}. `
    + `Te lo guardo ${LE.RETENCION_MIN} minutos: ¿te lo reservo?`;
}

// Cómo se nombra su tratamiento en un aviso que le llega sin haber preguntado: lo íntimo
// (ginecoestética, sexualidad masculina, pérdida de peso o lo que marque la clínica) no se nombra, ni
// por su familia (se lee en la pantalla bloqueada); los de publicidad restringida (medicamentos con
// receta, productos sanitarios), tampoco: se habla de su familia.
async function nombreEnAviso(q, tratamientoId) {
  const [[t]] = await q.query(
    `SELECT t.nombre, t.familia AS familia_codigo, t.sensible, t.regimen_legal, t.publicidad_restringida, f.nombre AS familia
       FROM tratamientos t LEFT JOIN familias f ON f.codigo = t.familia WHERE t.id = ?`,
    [tratamientoId]);
  if (!t || esSensible({ sensible: t.sensible, familia: t.familia_codigo })) return 'tratamiento';
  if (t.publicidad_restringida || t.regimen_legal === 'medicamento_receta') return t.familia ? R.enMinuscula(t.familia) : 'tratamiento';
  return R.enMinuscula(t.nombre);
}

async function enPausa(pool, ahora) {
  const [[c]] = await pool.query('SELECT hasta FROM candados WHERE nombre = ?', [PAUSA]);
  return Boolean(c && new Date(c.hasta) > ahora);
}

async function pausar(pool, ahora) {
  await pool.query('INSERT INTO candados (nombre, dueno, hasta) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE hasta = VALUES(hasta)',
    [PAUSA, 'whatsapp', new Date(ahora.getTime() + PAUSA_MIN * 60000)]);
}

// Sin la plantilla aprobada (y con su ventana cerrada) no se le puede escribir: no se le guarda nada
// y sigue siendo su turno. Recepción le avisa a mano: una tarea por hueco, no una por minuto.
async function sinPlantilla(pool, hueco, entrada, { ahora }) {
  await cola.unaVez(pool, `espera-sin-plantilla-${hueco.liberadaPor}`, new Date(hueco.inicio.getTime() + 86400000), async () => {
    await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, vence_en) VALUES ('llamar', ?, ?, ?)",
      [`Lista de espera: se ha liberado un hueco (${hueco.fecha} ${hueco.hora}) y falta la plantilla aprobada «hueco_liberado». Avisar a mano`,
        entrada.paciente_id, new Date(ahora.getTime() + 30 * 60000)]);
    await registrar(pool, { tipo: 'lista_espera_sin_plantilla', entidad: 'lista_espera', entidadId: entrada.id, datos: { hueco: `${hueco.fecha} ${hueco.hora}` } });
  });
  return { entrada: entrada.id, fallido: 'sin plantilla' };
}

async function ofrecer(deps, hueco, entrada, { ahora, plantilla }) {
  const { pool } = deps;
  const abierta = await LE.ventanaAbierta(pool, entrada.telefono, ahora);
  if (!abierta && !plantilla) return sinPlantilla(pool, hueco, entrada, { ahora });
  const guardado = await LE.guardarHueco(pool, { entrada, hueco, ahora });
  if (!guardado) return { hueco: `${hueco.fecha} ${hueco.hora}`, omitido: 'ya no está libre' };

  const con = await pool.getConnection();
  let conv;
  let antes;
  try {
    await con.beginTransaction();
    // Cómo estaban sus conversaciones: si el aviso no sale, la que se reabrió vuelve a quedar como estaba.
    [antes] = await con.query('SELECT id, estado, motivo_cierre FROM conversaciones WHERE telefono = ?', [entrada.telefono]);
    conv = await R.conversacionPara(con, { telefono: entrada.telefono, pacienteId: entrada.paciente_id, contexto: 'cita', contextoId: guardado.citaId, ahora });
    // Su respuesta se busca por el paciente: que la conversación sepa quién es.
    if (!conv.paciente_id) await con.query('UPDATE conversaciones SET paciente_id = ? WHERE id = ?', [entrada.paciente_id, conv.id]);
    await con.query('UPDATE lista_espera_ofertas SET conversacion_id = ? WHERE id = ?', [conv.id, guardado.id]);
    await con.query('UPDATE citas SET conversacion_id = ? WHERE id = ?', [conv.id, guardado.citaId]);
    await con.commit();
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }

  const c = await R.datosCita(pool, guardado.citaId);
  const actual = entrada.citaActual ? await R.datosCita(pool, entrada.citaActual.id) : null;
  const tratamiento = await nombreEnAviso(pool, hueco.tratamientoId);
  const envio = abierta
    ? await R.enviar(deps, conv, { texto: textoOferta(c, { nombre: entrada.nombre, actual, tratamiento }), autor: 'sistema', ahora })
    : await R.enviar(deps, conv, { plantilla, variables: [entrada.nombre || 'hola', `tu ${tratamiento}`, R.textoDia(c.fecha).slice(3), c.hora], autor: 'sistema', ahora });
  if (envio.estado !== 'enviado') {
    // No le ha llegado: no se le guarda un hueco que no sabe que tiene, pero conserva su turno.
    await LE.soltarOferta(pool, guardado, { ahora });
    const previa = antes.find((x) => x.id === conv.id);
    if (previa?.estado === 'cerrada') await pool.query("UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = ? WHERE id = ?", [previa.motivo_cierre, conv.id]);
    else if (!previa) await LE.cerrarConversacion(pool, conv.id, 'lista_espera');
    await registrar(pool, { tipo: 'lista_espera_envio_fallido', entidad: 'lista_espera', entidadId: entrada.id, datos: { hueco: `${hueco.fecha} ${hueco.hora}` } });
    return { entrada: entrada.id, fallido: 'envío' };
  }
  // El texto nombra la cita que se le cambiaría; la plantilla no (antes de cambiársela se le pregunta).
  await pool.query('UPDATE lista_espera_ofertas SET aviso = ?, mensaje_id = ? WHERE id = ?', [abierta ? 'texto' : 'plantilla', envio.mensajeId, guardado.id]);
  await pool.query("UPDATE conversaciones SET estado = 'esperando_paciente', proximo_paso = 'espera_respuesta', proximo_paso_en = ? WHERE id = ? AND estado IN ('ia_activa','esperando_paciente','cerrada')",
    [guardado.caducaEn, conv.id]);
  return { entrada: entrada.id, oferta: guardado.id, cita: guardado.citaId, envio };
}

async function vuelta(deps, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const conPersona = await LE.ofertasConPersona(pool, { ahora });
  const informe = { ...(await LE.caducarOfertas(pool, { ahora })), conPersona, ofrecidas: 0 };
  await pool.query("DELETE FROM candados WHERE nombre LIKE 'espera-%' AND hasta < ?", [ahora]);
  const p = T.partesMadrid(ahora);
  if (p.minutos < HORARIO.desde || p.minutos >= HORARIO.hasta) return informe;
  if (await enPausa(pool, ahora)) return { ...informe, pausa: true };
  const plantilla = elegirPlantilla('hueco_liberado', await R.plantillasBd(pool));
  for (const hueco of await LE.huecosLiberados(pool, ahora)) {
    try {
      const entrada = await LE.candidato(pool, hueco, ahora);
      if (!entrada) continue;
      const r = await ofrecer(deps, hueco, entrada, { ahora, plantilla });
      if (r.envio) informe.ofrecidas++;
      if (r.fallido === 'envío') {
        // WhatsApp no responde: por ahora no se prueba con nadie más (le fallaría igual).
        await pausar(pool, ahora);
        informe.pausa = true;
        break;
      }
    } catch (err) {
      informe.errores = [...(informe.errores || []), `${hueco.fecha} ${hueco.hora}: ${err.message}`];
    }
  }
  return informe;
}

module.exports = { vuelta, textoOferta };
