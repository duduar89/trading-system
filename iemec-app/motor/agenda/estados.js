'use strict';
// Estados de la cita que marca recepción («Ha llegado», «Completada», «No vino») y el «Deshacer»:
// la tabla de transiciones válidas con sus condiciones de hora, qué botones tocan en cada momento y
// cuándo se avisa al paciente de que le toca repetir el tratamiento. Lógica pura: la base de datos
// la pone servidor/agenda.js y lo que mueve cada cambio en el resto de la app, servidor/estados-cita.js.
const T = require('../tiempo');
const { DIAS, MESES } = require('../repesca/plazos');

const ETIQUETA = {
  retenida: 'Hueco retenido', confirmada: 'Confirmada', llegada: 'Ha llegado', en_curso: 'En cabina',
  completada: 'Completada', no_presentada: 'No vino', cancelada: 'Cancelada', reprogramada: 'Reprogramada',
};

// Cómo está la cita, para explicar por qué no vale un cambio.
const ESTA = {
  retenida: 'solo tiene el hueco retenido (aún no está confirmada)',
  confirmada: 'está confirmada',
  llegada: 'ya tiene marcada la llegada',
  en_curso: 'está en curso',
  completada: 'ya está completada',
  no_presentada: 'está marcada como «No vino»',
  cancelada: 'está cancelada',
  reprogramada: 'se reprogramó a otro día',
};

// Para cada estado de destino: desde qué estados se llega, cuándo se puede (en hora de Madrid), qué
// columna guarda el momento y si recepción lo puede deshacer.
//   dia_de_la_cita   solo el día de la cita
//   desde_inicio     desde la hora de inicio
//   pasado_inicio    pasada la hora de inicio
const TRANSICIONES = {
  confirmada: { desde: ['retenida', 'confirmada'], columna: 'confirmada_en' },
  cancelada: { desde: ['retenida', 'confirmada'], columna: 'cancelada_en' },
  reprogramada: { desde: ['retenida', 'confirmada'] }, // la cita vieja, al pasarla a otro día
  llegada: { desde: ['confirmada'], cuando: 'dia_de_la_cita', columna: 'llegada_en', deshacible: true },
  completada: { desde: ['llegada', 'en_curso', 'confirmada'], cuando: 'desde_inicio', columna: 'completada_en', deshacible: true },
  no_presentada: { desde: ['confirmada'], cuando: 'pasado_inicio', columna: 'no_presentada_en', deshacible: true },
};

// Lo que recepción marca desde el panel, en el orden de los botones.
const ACCIONES = ['llegada', 'completada', 'no_presentada'];

// El último cambio se puede deshacer durante este rato (y la petición de reseña nunca sale antes).
const VENTANA_DESHACER_MIN = 30;

// Hora del aviso de «toca repetir» (la secuencia lo lleva al horario de envío si cae fuera).
const HORA_AVISO_REPETIR = '11:30';

const no = (codigo, mensaje) => ({ ok: false, codigo, mensaje });
const horaDe = (d) => T.partesMadrid(new Date(d)).hora;
function diaDe(d) {
  const p = T.partesMadrid(new Date(d));
  return `${DIAS[p.diaSemana]} ${Number(p.fecha.slice(8))} de ${MESES[Number(p.fecha.slice(5, 7))]}`;
}

/**
 * ¿Puede la cita pasar ahora al estado `a`?
 * @param {object} cita { estado, inicio, retenida_hasta }
 * @param {string} a estado de destino
 * @param {Date} ahora
 * @param {object} o { de: estados de partida admitidos (restringe los de la tabla) }
 * @returns {{ ok: true } | { ok: false, codigo: string, mensaje: string }}
 */
function comprobarCambio(cita, a, ahora = new Date(), { de = null } = {}) {
  const regla = TRANSICIONES[a];
  if (!regla) return no('ESTADO_DESCONOCIDO', `Una cita no se puede pasar a «${a}»`);
  const desde = de ? regla.desde.filter((e) => de.includes(e)) : regla.desde;
  if (!desde.includes(cita.estado)) {
    return no('ESTADO_NO_VALIDO', cita.estado === a
      ? `La cita ya está marcada como «${ETIQUETA[a]}»`
      : `La cita ${ESTA[cita.estado] || `está ${cita.estado}`}: no se puede marcar como «${ETIQUETA[a]}»`);
  }
  if (cita.estado === 'retenida' && a === 'confirmada' && cita.retenida_hasta && new Date(cita.retenida_hasta) <= ahora) {
    return no('RETENCION_CADUCADA', 'El hueco se ha liberado: hay que elegir otro');
  }
  const inicio = new Date(cita.inicio);
  if (regla.cuando === 'dia_de_la_cita' && T.fechaMadrid(ahora) !== T.fechaMadrid(inicio)) {
    return no('FUERA_DE_HORA', ahora < inicio
      ? `Aún no es el día de la cita (el ${diaDe(inicio)}): la llegada se marca ese día`
      : 'La llegada se marca el mismo día de la cita; ahora se puede marcar como completada o «No vino»');
  }
  if (regla.cuando === 'desde_inicio' && ahora < inicio) {
    return no('FUERA_DE_HORA', `Aún no ha empezado: se puede marcar como completada desde las ${horaDe(inicio)}`);
  }
  if (regla.cuando === 'pasado_inicio' && ahora <= inicio) {
    return no('FUERA_DE_HORA', `Aún no es la hora de la cita: «No vino» se marca pasadas las ${horaDe(inicio)}`);
  }
  return { ok: true };
}

/**
 * ¿Se puede deshacer el último cambio de la cita? Solo lo que marca recepción, y durante un rato.
 * Una cancelación no se deshace desde aquí: el hueco ya puede ser de otra persona.
 * @param {object} cita { estado, estado_anterior, estado_cambiado_en }
 * @returns {{ ok: true, a: string, hasta: Date } | { ok: false, codigo: string, mensaje: string }}
 */
function comprobarDeshacer(cita, ahora = new Date(), ventanaMin = VENTANA_DESHACER_MIN) {
  if (!TRANSICIONES[cita.estado]?.deshacible || !cita.estado_anterior || !cita.estado_cambiado_en) {
    return no('NADA_QUE_DESHACER', 'Esta cita no tiene ningún cambio que se pueda deshacer');
  }
  const hasta = new Date(new Date(cita.estado_cambiado_en).getTime() + ventanaMin * 60000);
  if (ahora >= hasta) {
    return no('DESHACER_CADUCADO', `Ya no se puede deshacer «${ETIQUETA[cita.estado]}»: han pasado más de ${ventanaMin} minutos`);
  }
  return { ok: true, a: cita.estado_anterior, hasta };
}

// Los botones que tocan ahora para esta cita, según su estado y la hora.
function accionesPosibles(cita, ahora = new Date()) {
  return ACCIONES.filter((a) => comprobarCambio(cita, a, ahora).ok);
}

/**
 * Cuándo toca repetir un tratamiento y cuándo se le avisa: el día de la cita más repetir_cada_dias,
 * menos un margen para que encuentre hueco a tiempo (el 10 % del intervalo, entre 3 y 14 días).
 * @returns {{ toca: string, aviso: string, margen: number } | null} fechas 'AAAA-MM-DD'
 */
function avisoRepetir(fechaCita, cadaDias) {
  const dias = Number(cadaDias);
  if (!Number.isInteger(dias) || dias <= 0) return null;
  const margen = Math.min(14, Math.max(3, Math.round(dias / 10)), dias - 1);
  const toca = T.sumarDias(fechaCita, dias);
  return { toca, aviso: T.sumarDias(toca, -margen), margen };
}

module.exports = {
  ETIQUETA, TRANSICIONES, ACCIONES, VENTANA_DESHACER_MIN, HORA_AVISO_REPETIR,
  comprobarCambio, comprobarDeshacer, accionesPosibles, avisoRepetir,
};
