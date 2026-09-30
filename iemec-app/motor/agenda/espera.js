'use strict';
// Reglas de la lista de espera, sin base de datos: a quién le sirve un hueco que se libera.
//   · mismo tratamiento y dentro de sus fechas (lo filtra la consulta)
//   · en su franja: «manana» (antes de las 14:00), «tarde» (desde las 14:00) o a cualquier hora
//   · si ya tiene cita para eso, solo un hueco antes (al aceptarlo, se le cambia); lo reservado en
//     Treatwell se cambia en Treatwell, así que a esos no se les ofrece
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
 * @param {object} actual  la cita que ya tiene para ese tratamiento ({ inicio, origen }) o null
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

module.exports = { FRANJAS, encajaFranja, leSirve, normalizarTelefono };
