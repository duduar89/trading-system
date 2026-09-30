'use strict';
// Quiere cambiar su cita: ¿cuál de sus citas y adónde la quiere mover? Solo entiende, sin base de
// datos (la repesca propone los huecos y la agenda los comprueba).
//
//   «tengo cita el jueves a las 17:00 y no voy a poder ir», «necesito cambiar la del jueves 8»
//        → { evitar: { fecha } }        lo que nombra es SU cita: ese día no le va (se le proponen
//                                        otros desde mañana, sin ese)
//   «¿me la pasas al jueves?», «la del jueves, al viernes», «¿me la retrasas a las 18:30?»
//        → { pide: { fecha, hora, franja } }   adónde la quiere (si solo dice la hora, ese mismo día)
//   «el martes no puedo», «a otro día»  → { evitar }   otros, sin ese día
//   «solo puedo por la tarde»           → { franja }
// Con varias citas pendientes, la que nombra (por su día o su hora); si no nombra ninguna, la primera.
const T = require('../tiempo');
const { normalizar, detectarFranja } = require('./interpretar');
const { elegirHueco } = require('./eleccion');

// «El jueves no puedo» y su cita es un jueves: es ese jueves, no todos.
function esSuDia(evitar, fecha) {
  if (!evitar || (!evitar.diaSemana && !evitar.diaMes)) return false;
  return (!evitar.diaSemana || T.diaSemana(fecha) === evitar.diaSemana) && (!evitar.diaMes || Number(fecha.slice(8, 10)) === evitar.diaMes);
}

const DIAS = '(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)';
// Lo que va detrás de «al», «para» o «para el» es adónde la quiere: «al viernes», «para el 15», «al
// día 20». «Tengo cita para el jueves» habla de la suya.
const DESTINO = new RegExp(`(?<!\\bcita )\\b(?:al|para el|para)\\s+(?=(?:(?:el|este|el proximo) )?(?:${DIAS}|dia \\d|\\d{1,2}\\b))`);

/**
 * @param {string} texto  lo que ha escrito
 * @param {Array} citas   sus citas pendientes, por orden: [{ fecha, hora }]
 * @param {object} o      { hoy: 'AAAA-MM-DD' }
 * @returns {{ indice: number, pide?: object, evitar?: object, franja?: string }}
 */
function entenderCambio(texto, citas, { hoy }) {
  const t = normalizar(texto);
  const m = DESTINO.exec(t);
  const deSuCita = m ? t.slice(0, m.index) : t;
  const destino = m ? t.slice(m.index + m[0].length) : null;
  const cual = citas.length > 1 ? elegirHueco(deSuCita, citas, { hoy }) : null;
  const indice = cual?.tipo === 'elegido' && !cual.porAcepta ? Math.max(0, citas.indexOf(cual.hueco)) : 0;
  const suya = citas[indice];
  const pide = (e) => (e?.tipo === 'pide' && (e.fecha || e.hora) ? { fecha: e.fecha || suya.fecha, hora: e.hora, franja: e.franja } : null);

  if (destino) {
    const p = pide(elegirHueco(destino, [], { hoy }));
    if (p) return { indice, pide: p };
  }
  // Se mira contra su propia cita: si nombra su día o su hora, habla de ella; si nombra otros, los pide.
  const e = elegirHueco(deSuCita, [suya], { hoy });
  const p = pide(e);
  if (p) return { indice, pide: p };
  if (e?.tipo === 'elegido' && !e.porAcepta) return { indice, evitar: { fecha: suya.fecha }, franja: detectarFranja(t) };
  if (e?.tipo === 'otros') return { indice, evitar: esSuDia(e.evitar, suya.fecha) ? { fecha: suya.fecha } : e.evitar, franja: e.franja };
  return { indice, franja: e?.franja || detectarFranja(t) };
}

module.exports = { entenderCambio };
