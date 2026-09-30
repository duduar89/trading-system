'use strict';
// Secuencias de repesca: qué se manda y cuándo si el paciente NO contesta. En cuanto contesta,
// la secuencia se pausa y manda lo que dice (motor/repesca/decidir.js).
//
// Reglas generales:
//   · Solo se envía en horario de envío (por defecto, el de la clínica) y nunca en festivo.
//   · Límite de mensajes comerciales por paciente (semana y mes), sumando todas las secuencias.
//   · Si el paciente tiene un seguimiento que pidió él, no le llega ninguna otra secuencia
//     comercial hasta esa fecha («silencio pactado»).
//   · Si reserva cita (por la vía que sea), se terminan las secuencias de captación.
const T = require('../tiempo');

// esperaMin: minutos desde que empieza la secuencia. accion: plantilla (uso) o tarea para una persona.
// usoSegunCita: la plantilla cambia según cómo acabó la cita de la inscripción (a quien no vino no se
// le dice que canceló).
const SECUENCIAS = {
  lead: {
    nombre: 'Lead nuevo sin cita',
    prioridad: 80,
    pasos: [
      { esperaMin: 0, accion: 'plantilla', uso: 'lead_primer_contacto', ventanaAbierta: 'respuesta_ia' },
      { esperaMin: 4 * 60, accion: 'plantilla', uso: 'lead_sin_cita' },
      { esperaMin: 24 * 60, accion: 'tarea', tarea: 'llamar', motivo: 'lead sin respuesta a las 24 h' },
      { esperaMin: 3 * 1440, accion: 'plantilla', uso: 'lead_sin_cita' },
      { esperaMin: 7 * 1440, accion: 'plantilla', uso: 'lead_ultimo_intento' },
    ],
    terminaCon: ['cita'],
  },
  cancelacion: {
    nombre: 'Cita cancelada o «No vino» sin nueva cita',
    prioridad: 90,
    pasos: [
      { esperaMin: 48 * 60, accion: 'plantilla', uso: 'cancelacion_recuperar', usoSegunCita: { no_presentada: 'no_vino_recuperar' } },
      { esperaMin: 7 * 1440, accion: 'plantilla', uso: 'cancelacion_recuperar', usoSegunCita: { no_presentada: 'no_vino_recuperar' } },
    ],
    terminaCon: ['cita'],
  },
  presupuesto: {
    nombre: 'Presupuesto sin aceptar',
    prioridad: 95,
    pasos: [
      { esperaMin: 2 * 1440, accion: 'plantilla', uso: 'presupuesto_2d' },
      { esperaMin: 7 * 1440, accion: 'plantilla', uso: 'presupuesto_7d' },
      { esperaMin: 8 * 1440, accion: 'tarea', tarea: 'llamar', motivo: 'presupuesto sin respuesta', soloSiImporteDesde: 800 },
      { esperaMin: 21 * 1440, accion: 'plantilla', uso: 'presupuesto_21d' },
    ],
    terminaCon: ['presupuesto_aceptado', 'presupuesto_rechazado', 'cita'],
  },
  toca_repetir: {
    nombre: 'Toca repetir el tratamiento',
    prioridad: 70,
    pasos: [
      { esperaMin: 0, accion: 'plantilla', uso: 'toca_repetir' },
      { esperaMin: 10 * 1440, accion: 'plantilla', uso: 'toca_repetir' },
    ],
    terminaCon: ['cita'],
  },
  dormido: {
    nombre: 'Paciente dormido',
    prioridad: 40,
    pasos: [{ esperaMin: 0, accion: 'plantilla', uso: 'paciente_dormido' }],
    terminaCon: ['cita'],
  },
  vale_regalo: {
    nombre: 'Tarjeta regalo sin canjear',
    prioridad: 60,
    pasos: [
      { esperaMin: 0, accion: 'plantilla', uso: 'vale_regalo' },
      { esperaMin: 30 * 1440, accion: 'plantilla', uso: 'vale_regalo' },
    ],
    terminaCon: ['cita'],
  },
};

const LIMITES = { comercialesSemana: 2, comercialesMes: 4, horaDesde: '10:00', horaHasta: '20:30' };

// Siguiente momento de envío permitido a partir de un instante (Date): día que abre y dentro del
// horario de envío; si no, el siguiente día que abre a la hora de apertura del envío.
function ajustarAHorario(instante, calendario, limites = LIMITES) {
  let p = T.partesMadrid(instante);
  const desde = T.minutosDe(limites.horaDesde);
  const hasta = T.minutosDe(limites.horaHasta);
  let fecha = p.fecha;
  let min = p.minutos;
  if (!calendario.abre(fecha) || min >= hasta) {
    fecha = calendario.siguienteLaborable(fecha, { incluida: calendario.abre(fecha) && min < hasta });
    min = desde;
  }
  if (min < desde) min = desde;
  // No antes de que abra la clínica ese día (un sábado abre a las 10:00, un martes a las 11:00).
  const fr = calendario.franjas(fecha);
  if (fr.length && min < fr[0].desde) min = fr[0].desde;
  return T.desdeMadrid(fecha, T.hhmm(min));
}

// La plantilla de un paso para una cita que acabó en `estadoCita` (si el paso no distingue, la de siempre).
function usoDelPaso(paso, estadoCita = null) {
  return paso.usoSegunCita?.[estadoCita] || paso.uso;
}

// Cuándo toca el paso n de una inscripción (o null si no quedan pasos).
function momentoDelPaso(inscripcion, n, calendario, limites = LIMITES) {
  const sec = SECUENCIAS[inscripcion.secuencia];
  const paso = sec?.pasos[n];
  if (!paso) return null;
  const base = new Date(new Date(inscripcion.inicio).getTime() + paso.esperaMin * 60000);
  return { paso, cuando: paso.accion === 'tarea' ? base : ajustarAHorario(base, calendario, limites) };
}

/**
 * ¿Se puede mandar ahora este mensaje comercial a este paciente?
 * @param {object} p { ahora, enviados: [Date] comerciales enviados, seguimientoPendienteHasta: Date|null,
 *                     baja: bool, consentimientoMarketing: bool, esClienteConServicioSimilar: bool }
 */
function puedeEnviarComercial(p, limites = LIMITES) {
  if (p.baja) return { ok: false, motivo: 'se dio de baja' };
  if (!p.consentimientoMarketing && !p.esClienteConServicioSimilar) {
    return { ok: false, motivo: 'sin consentimiento para mensajes comerciales (LSSI art. 21)' };
  }
  if (p.seguimientoPendienteHasta && new Date(p.seguimientoPendienteHasta) > p.ahora) {
    return { ok: false, motivo: 'tiene un seguimiento que pidió él: silencio pactado hasta esa fecha' };
  }
  const semana = p.enviados.filter((d) => p.ahora - new Date(d) < 7 * 86400000).length;
  const mes = p.enviados.filter((d) => p.ahora - new Date(d) < 30 * 86400000).length;
  if (semana >= limites.comercialesSemana) return { ok: false, motivo: `ya lleva ${semana} mensajes comerciales esta semana` };
  if (mes >= limites.comercialesMes) return { ok: false, motivo: `ya lleva ${mes} mensajes comerciales este mes` };
  return { ok: true };
}

// Si un paciente está en varias secuencias, solo avanza la de más prioridad.
function laQueManda(inscripciones) {
  return [...inscripciones]
    .filter((i) => i.estado === 'activa')
    .sort((a, b) => (SECUENCIAS[b.secuencia]?.prioridad || 0) - (SECUENCIAS[a.secuencia]?.prioridad || 0))[0] || null;
}

// Qué pasa con las inscripciones activas cuando ocurre algo.
function alOcurrir(evento, inscripciones) {
  return inscripciones.map((i) => {
    if (i.estado !== 'activa') return i;
    if (evento === 'respuesta') return { ...i, estado: 'pausada', motivoFin: 'el paciente contestó: manda lo que dice' };
    if ((SECUENCIAS[i.secuencia]?.terminaCon || []).includes(evento)) return { ...i, estado: 'terminada', motivoFin: evento };
    if (evento === 'baja') return { ...i, estado: 'cancelada', motivoFin: 'baja' };
    return i;
  });
}

module.exports = { SECUENCIAS, LIMITES, ajustarAHorario, momentoDelPaso, usoDelPaso, puedeEnviarComercial, laQueManda, alOcurrir };
