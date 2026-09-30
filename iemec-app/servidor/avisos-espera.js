'use strict';
// La lista de espera por WhatsApp (lo llama el cron cada minuto, después de liberar las retenciones
// caducadas):
//
//   1. Las ofertas sin respuesta a la media hora caducan: su hueco queda libre otra vez.
//   2. Cada hueco liberado se le guarda al primero de la lista que encaja y se le avisa con la
//      plantilla «hueco_liberado» («Sí, guárdamelo» / «No me viene bien»), o con texto si su
//      ventana de 24 h está abierta. Lo que contesta lo entiende la repesca (repesca/motor.js).
//
// De noche no se escribe: lo que se libera a las 23:00 se ofrece a partir de las 9:00 (si aún da
// tiempo). Las reglas y la base están en servidor/lista-espera.js.
const T = require('../motor/tiempo');
const { elegirPlantilla } = require('../motor/repesca/plantillas');
const { registrar } = require('./eventos');
const LE = require('./lista-espera');
const R = require('./repesca/motor');

const HORARIO = { desde: 9 * 60, hasta: 21 * 60 };

function textoOferta(c, { nombre, actual }) {
  const trat = R.enMinuscula(c.tratamiento);
  const hola = `Hola${nombre ? ` ${nombre}` : ''}`;
  if (actual) {
    return `${hola}, se ha liberado un hueco antes para tu ${trat}: ${R.textoDia(c.fecha)} a las ${c.hora} (ahora tienes cita ${R.textoDia(actual.fecha)} a las ${actual.hora}). `
      + `Te lo guardo ${LE.RETENCION_MIN} minutos: ¿te cambio la cita?`;
  }
  return `${hola}, estabas en nuestra lista de espera para tu ${trat}: se ha liberado un hueco ${R.textoDia(c.fecha)} a las ${c.hora}. `
    + `Te lo guardo ${LE.RETENCION_MIN} minutos: ¿te lo reservo?`;
}

async function ofrecer(deps, hueco, entrada, { ahora }) {
  const { pool } = deps;
  const guardado = await LE.guardarHueco(pool, { entrada, hueco, ahora });
  if (!guardado) return { hueco: `${hueco.fecha} ${hueco.hora}`, omitido: 'ya no está libre' };

  const con = await pool.getConnection();
  let conv;
  try {
    await con.beginTransaction();
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
  const ventanaAbierta = conv.ventana_hasta && new Date(conv.ventana_hasta) > ahora;
  let envio;
  if (ventanaAbierta) {
    envio = await R.enviar(deps, conv, { texto: textoOferta(c, { nombre: entrada.nombre, actual }), autor: 'sistema', ahora });
  } else {
    const plantilla = elegirPlantilla('hueco_liberado', await R.plantillasBd(pool));
    if (!plantilla) {
      // Sin plantilla aprobada no se le puede escribir: el hueco se suelta (pasa al siguiente) y
      // recepción le avisa a mano.
      await LE.anularOferta(pool, guardado.id, { ahora, motivo: 'sin plantilla' });
      await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES ('llamar', ?, ?, ?, ?)",
        [`Lista de espera: se ha liberado un hueco (${hueco.fecha} ${hueco.hora}) y falta la plantilla aprobada «hueco_liberado». Avisar a mano`,
          entrada.paciente_id, conv.id, new Date(ahora.getTime() + 30 * 60000)]);
      await registrar(pool, { tipo: 'lista_espera_sin_plantilla', entidad: 'lista_espera', entidadId: entrada.id, datos: { hueco: `${hueco.fecha} ${hueco.hora}` } });
      return { entrada: entrada.id, fallido: 'sin plantilla' };
    }
    envio = await R.enviar(deps, conv, {
      plantilla, variables: [entrada.nombre || 'hola', `tu ${R.enMinuscula(c.tratamiento)}`, R.textoDia(c.fecha).slice(3), c.hora], autor: 'sistema', ahora,
    });
  }
  await pool.query("UPDATE conversaciones SET estado = 'esperando_paciente', proximo_paso = 'espera_respuesta', proximo_paso_en = ? WHERE id = ? AND estado IN ('ia_activa','esperando_paciente','cerrada')",
    [guardado.caducaEn, conv.id]);
  return { entrada: entrada.id, oferta: guardado.id, cita: guardado.citaId, envio };
}

async function vuelta(deps, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const informe = { ...(await LE.caducarOfertas(pool, { ahora })), ofrecidas: 0 };
  const p = T.partesMadrid(ahora);
  if (p.minutos < HORARIO.desde || p.minutos >= HORARIO.hasta) return informe;
  for (const hueco of await LE.huecosLiberados(pool, ahora)) {
    try {
      const entrada = await LE.candidato(pool, hueco, ahora);
      if (!entrada) continue;
      const r = await ofrecer(deps, hueco, entrada, { ahora });
      if (r.envio) informe.ofrecidas++;
    } catch (err) {
      informe.errores = [...(informe.errores || []), `${hueco.fecha} ${hueco.hora}: ${err.message}`];
    }
  }
  return informe;
}

module.exports = { vuelta, textoOferta };
