'use strict';
// Reglas de la lista de espera, sin base de datos: a quién le sirve un hueco que se libera.
//   · mismo tratamiento y dentro de sus fechas (lo filtra la consulta)
//   · en su franja: «manana» (antes de las 14:00), «tarde» (desde las 14:00) o a cualquier hora
//   · si se apuntó para adelantar una cita (enlazada al apuntarle), solo un hueco antes (al
//     aceptarlo, se le cambia); lo reservado en Treatwell se cambia en Treatwell, así que a esos no
//     se les ofrece
// Y lo que dice al apuntarse por WhatsApp («sí, pero hasta el viernes»), y qué teléfonos valen: los
// avisos van por WhatsApp, así que un fijo no.
const T = require('../tiempo');
const { normalizar } = require('../repesca/interpretar');
const { elegirHueco } = require('../repesca/eleccion');

const FRANJAS = ['manana', 'tarde'];
const TARDE_DESDE = 14 * 60;

function encajaFranja(franjas, minutos) {
  const lista = String(franjas || '').split(',').map((f) => f.trim()).filter((f) => FRANJAS.includes(f));
  if (!lista.length || lista.length === FRANJAS.length) return true;
  return lista.includes(minutos < TARDE_DESDE ? 'manana' : 'tarde');
}

/**
 * @param {object} hueco   { inicio: Date, minutos } (minutos del día en Madrid)
 * @param {object} entrada { franjas }
 * @param {object} actual  la cita que quiere adelantar ({ inicio, origen }) o null
 */
function leSirve(hueco, entrada, actual = null) {
  if (!encajaFranja(entrada.franjas, hueco.minutos)) return false;
  if (actual && (new Date(actual.inicio) <= new Date(hueco.inicio) || actual.origen === 'treatwell')) return false;
  return true;
}

// «611 22 33 44», «0034611223344» o «+34 611…» → «+34611223344». null si no parece un teléfono.
function normalizarTelefono(t) {
  const limpio = String(t || '').replace(/[^\d+]/g, '').replace(/^00/, '+');
  if (/^[6789]\d{8}$/.test(limpio)) return `+34${limpio}`;
  if (/^34[6789]\d{8}$/.test(limpio)) return `+${limpio}`;
  return /^\+\d{8,15}$/.test(limpio) ? limpio : null;
}

// Un fijo español (91…, 8…): no tiene WhatsApp, así que no se le puede avisar de un hueco.
const esFijoEspanol = (tel) => /^\+34[89]\d{8}$/.test(String(tel || ''));

// Las fechas que pone al apuntarse: «a partir del lunes», «desde el 3 de noviembre», «hasta el
// viernes», «antes del jueves» (hasta el día antes). Lo que no dice, no se toca.
function fechasDichas(texto, { hoy }) {
  const t = normalizar(texto);
  const dia = (trozo) => {
    const e = trozo ? elegirHueco(trozo, [], { hoy }) : null;
    return e?.tipo === 'pide' ? e.fecha : null;
  };
  const salida = {};
  const desde = /\b(?:a partir del?|desde el|desde)\s+(.+?)(?=,?\s+(?:y )?(?:hasta|antes)\b|$)/.exec(t);
  if (desde && dia(desde[1])) salida.desde = dia(desde[1]);
  const hasta = /\bhasta el\s+(.+)$/.exec(t);
  const antes = /\bantes del?\s+(.+)$/.exec(t);
  if (hasta && dia(hasta[1])) salida.hasta = dia(hasta[1]);
  else if (antes && dia(antes[1])) salida.hasta = T.sumarDias(dia(antes[1]), -1);
  return salida;
}

module.exports = { FRANJAS, encajaFranja, leSirve, normalizarTelefono, esFijoEspanol, fechasDichas };
