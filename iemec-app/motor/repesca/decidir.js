'use strict';
// Qué hace la repesca con cada respuesta del paciente. Es la tabla «Cada excusa, bien contestada»
// convertida en código. La IA redacta el mensaje; lo que se HACE (fecha, oferta, persona, cierre)
// lo decide esto, y siempre deja un próximo paso.
//
// Próximo paso posible: 'cita' | 'seguimiento' | 'persona' | 'cerrada' | 'espera_respuesta'.
const T = require('../tiempo');
const { calcularSeguimiento } = require('./plazos');
const { elegirOferta } = require('./ofertas');

const PLAZOS_SOLO_SEGUIMIENTO = new Set(['hoy_tarde', 'manana', 'pasado_manana']);
// Con un tratamiento que agrupa varios (Head Spa japonés, programa de acné…), lo que necesita saber
// el nivel o la técnica: contarle, darle cita o proponerle huecos.
const NECESITA_OPCION = new Set(['informacion', 'reservar', 'acepta', 'preferencia_horario', 'pregunta']);

function seguimiento(ctx, plazo, motivo, frase, franja) {
  const s = calcularSeguimiento(plazo, {
    hoy: ctx.hoy, ahoraMin: ctx.ahoraMin, calendario: ctx.calendario,
    franja: franja || ctx.franjaPreferida, horaHabitual: ctx.horaHabitual, reglas: ctx.reglas,
  });
  return { tipo: 'programar_seguimiento', fecha: s.fecha, hora: s.hora, texto: s.texto, motivo, plazo: plazo.tipo, frase, avisos: s.avisos };
}

function persona(motivo, urgente = false) {
  return { tipo: 'pasar_a_persona', motivo, urgente };
}

/**
 * @param {object} interp  salida de interpretar() o de la IA: { intencion, plazo, franja, urgente }
 * @param {object} ctx     { hoy, ahoraMin, calendario, frase, tratamiento, importe, ofertas, hechas,
 *                           yaPreguntoCuando, ofertasRechazadas, umbralImporteAlto, margenEventoDias,
 *                           tieneRespuestaAprobada, reservable, horaHabitual, franjaPreferida, reglas,
 *                           agrupador: { nombre, opciones: [{ id, nombre }] } si su tratamiento agrupa
 *                           varios (sin opciones: no se le pueden preguntar) }
 */
function decidir(interp, ctx) {
  const frase = ctx.frase || '';
  const umbral = ctx.umbralImporteAlto ?? 1500;
  const acciones = [];
  let proximo;
  let guia;

  // Le interesa algo que agrupa varias técnicas o niveles: antes de contarle o darle cita, cuál. Si
  // no se le pueden preguntar (son muchas, lo íntimo, lo de publicidad restringida), recepción.
  if (ctx.agrupador && NECESITA_OPCION.has(interp.intencion)) {
    if (ctx.agrupador.opciones?.length) {
      acciones.push({ tipo: 'preguntar_opcion', opciones: ctx.agrupador.opciones.map((o) => o.id) });
      acciones.push(seguimiento(ctx, { tipo: 'dias', n: 2 }, 'sin_respuesta_a_opcion', frase));
      return { intencion: interp.intencion, acciones, proximoPaso: 'espera_respuesta',
        guia: 'Pregúntale qué nivel o técnica le interesa, nombrando solo las opciones de los DATOS; después le propones huecos.' };
    }
    acciones.push(persona(`Le interesa «${ctx.agrupador.nombre}», que agrupa varias técnicas: contarle las opciones y proponerle cita`));
    return { intencion: interp.intencion, acciones, proximoPaso: 'persona',
      guia: 'Dile que una persona del equipo le cuenta las opciones y le propone cita por aquí.' };
  }

  switch (interp.intencion) {
    case 'baja':
      acciones.push({ tipo: 'baja' });
      proximo = 'cerrada';
      guia = 'Confirma la baja en una sola frase, sin insistir ni preguntar el motivo.';
      break;

    case 'salud_personal':
      acciones.push(persona(interp.urgente ? 'posible complicación tras un tratamiento' : 'dato de salud: lo valora el equipo médico', Boolean(interp.urgente)));
      proximo = 'persona';
      guia = interp.urgente
        ? 'Dile que el equipo médico le escribe o le llama enseguida y que, si empeora o es grave, acuda a urgencias o llame al 112. Sin consejo médico.'
        : 'Agradece que lo cuente y dile que lo revisa el equipo médico, que le contesta. Sin consejo médico.';
      break;

    case 'queja':
      acciones.push(persona('queja o enfado'));
      proximo = 'persona';
      guia = 'Pide disculpas por la experiencia y dile que una persona del equipo le escribe hoy.';
      break;

    case 'evento': {
      const margen = ctx.margenEventoDias ?? 15;
      if (interp.plazo && interp.plazo.tipo === 'fecha') {
        const evento = seguimiento(ctx, interp.plazo, 'evento', frase).fecha;
        const limite = T.sumarDias(evento, -margen);
        if (limite > ctx.hoy) {
          acciones.push({ tipo: 'proponer_huecos', desdeFecha: T.sumarDias(ctx.hoy, 1), hastaFecha: limite, franja: interp.franja });
          proximo = 'espera_respuesta';
          guia = `Propón huecos antes del ${limite} para llegar bien al evento (margen fijado por el equipo médico).`;
          break;
        }
      }
      acciones.push(persona('evento cercano: el equipo médico decide si da tiempo'));
      proximo = 'persona';
      guia = 'Dile que una persona del equipo le confirma si llega bien a su evento y le propone cita.';
      break;
    }

    case 'reservar':
      acciones.push({ tipo: 'proponer_huecos', desdeFecha: interp.plazo ? seguimiento(ctx, interp.plazo, 'reserva', frase).fecha : T.sumarDias(ctx.hoy, 0), franja: interp.franja || ctx.franjaPreferida });
      proximo = 'espera_respuesta';
      guia = 'Ofrece 2 o 3 huecos reales con día y hora, y reserva el que elija.';
      break;

    case 'informacion':
      // «Quiero más información», «¿qué precio tiene?»: lo aprobado por el equipo médico (si lo hay),
      // una valoración y, si la IA puede darle cita, huecos. Y un seguimiento por si no contesta.
      if (ctx.tieneRespuestaAprobada) acciones.push({ tipo: 'responder', tema: 'informacion' });
      acciones.push({ tipo: 'ofrecer_valoracion' });
      if (ctx.reservable) {
        acciones.push({ tipo: 'proponer_huecos', desdeFecha: interp.plazo ? seguimiento(ctx, interp.plazo, 'informacion', frase).fecha : ctx.hoy, franja: interp.franja || ctx.franjaPreferida, opcional: true });
      }
      acciones.push(seguimiento(ctx, { tipo: 'dias', n: 2 }, 'informacion', frase));
      proximo = 'seguimiento';
      guia = ctx.tratamiento?.id
        ? 'Cuéntale solo lo aprobado por el equipo médico (si viene en los DATOS), sin precios ni promesas que no estén ahí. Ofrécele una valoración con el equipo, sin compromiso, y los huecos de los DATOS si los hay.'
        : 'Pregúntale qué tratamiento le interesa y ofrécele una primera valoración con el equipo, sin compromiso.';
      break;

    case 'ocupado_ahora':
      acciones.push(seguimiento(ctx, interp.plazo || { tipo: 'hoy_tarde' }, 'ocupado', frase, interp.franja));
      proximo = 'seguimiento';
      guia = 'Sin problema; dile cuándo le vuelves a escribir (el texto de la fecha).';
      break;

    case 'aplazar': {
      const p = interp.plazo || { tipo: 'vago' };
      if (p.tipo === 'vago' && !ctx.yaPreguntoCuando) {
        acciones.push({ tipo: 'preguntar_cuando' });
        proximo = 'espera_respuesta';
        guia = 'Pregunta una sola vez, con suavidad, cuándo le viene mejor que le escribas.';
        // Si no contesta, que no se quede en el aire.
        acciones.push(seguimiento(ctx, { tipo: 'dias', n: 3 }, 'sin_respuesta_a_cuando', frase));
        break;
      }
      const s = seguimiento(ctx, p, 'aplazamiento', frase, interp.franja);
      if (!PLAZOS_SOLO_SEGUIMIENTO.has(p.tipo) && ctx.reservable !== false && T.diasEntre(ctx.hoy, s.fecha) <= 60) {
        // Primero: dejar ya guardado un hueco de ese periodo. Si prefiere esperar, vale el seguimiento.
        acciones.push({ tipo: 'proponer_huecos', desdeFecha: s.fecha, franja: interp.franja || ctx.franjaPreferida, opcional: true });
      }
      acciones.push(s);
      proximo = 'seguimiento';
      guia = `Acéptalo sin insistir. Ofrece dejar ya reservado un hueco de ese periodo; si prefiere esperar, confírmale que le escribes ${s.texto}.`;
      break;
    }

    case 'precio':
    case 'competencia_precio': {
      if (ctx.importe != null && ctx.importe >= umbral) {
        acciones.push({ tipo: 'tarea_llamar', motivo: `presupuesto de ${ctx.importe} € con objeción de precio` });
        acciones.push(seguimiento(ctx, { tipo: 'dias', n: 3 }, 'precio_importe_alto', frase));
        proximo = 'persona';
        guia = 'Dile que alguien del equipo le llama para ver opciones (plazos, fases del tratamiento) sin compromiso.';
        break;
      }
      if (ctx.ofertasRechazadas >= 1) {
        acciones.push({ tipo: 'cerrar', motivo: 'precio' });
        proximo = 'cerrada';
        guia = 'Agradece, sin insistir, y deja la puerta abierta.';
        break;
      }
      const { oferta } = elegirOferta({ tratamiento: ctx.tratamiento, ofertas: ctx.ofertas, hechas: ctx.hechas, importe: ctx.importe, hoy: ctx.hoy, intencion: interp.intencion });
      if (oferta) {
        acciones.push({ tipo: 'ofrecer', ofertaId: oferta.id, ofertaTipo: oferta.tipo, requiereAprobacion: Boolean(oferta.requiereAprobacion) });
        acciones.push(seguimiento(ctx, { tipo: 'dias', n: 3 }, 'recordatorio_oferta', frase));
        proximo = 'seguimiento';
        guia = interp.intencion === 'competencia_precio'
          ? 'No entres en guerra de precios ni hables mal de nadie; explica lo que incluye y ofrece la opción del catálogo.'
          : 'Pregunta qué le frena, explica lo que incluye y ofrece UNA opción: la del catálogo.';
      } else {
        acciones.push({ tipo: 'responder', tema: 'valor_incluido' });
        acciones.push(seguimiento(ctx, { tipo: 'dias', n: 4 }, 'precio_sin_oferta', frase));
        proximo = 'seguimiento';
        guia = 'Explica lo que incluye el tratamiento; no hay oferta disponible: no inventes ninguna.';
      }
      break;
    }

    case 'pensar':
      acciones.push({ tipo: 'responder', tema: 'que_le_falta' });
      acciones.push(seguimiento(ctx, interp.plazo || { tipo: 'dias', n: 3 }, 'pensar', frase));
      proximo = 'seguimiento';
      guia = 'Pregunta qué le falta para decidir y resuélvelo con información aprobada.';
      break;

    case 'duda_medica':
      if (ctx.tieneRespuestaAprobada) {
        acciones.push({ tipo: 'responder', tema: 'respuesta_aprobada' });
        acciones.push({ tipo: 'ofrecer_valoracion' });
        acciones.push(seguimiento(ctx, { tipo: 'dias', n: 3 }, 'duda', frase));
        proximo = 'seguimiento';
        guia = 'Contesta solo con la respuesta aprobada por el equipo médico y ofrece una valoración.';
      } else {
        acciones.push(persona('duda médica sin respuesta aprobada'));
        proximo = 'persona';
        guia = 'Dile que se lo explica mejor el equipo médico, que le escribe.';
      }
      break;

    case 'ya_hecho':
      acciones.push({ tipo: 'cerrar', motivo: 'competencia' });
      proximo = 'cerrada';
      guia = 'Da las gracias y pregunta una sola vez qué le hizo decidirse.';
      break;

    case 'no_interesa':
      acciones.push({ tipo: 'cerrar', motivo: 'no_interesa' });
      proximo = 'cerrada';
      guia = 'Agradece y no insistas.';
      break;

    case 'pregunta':
      if (ctx.tieneRespuestaAprobada) {
        acciones.push({ tipo: 'responder', tema: 'pregunta' });
        acciones.push(seguimiento(ctx, { tipo: 'dias', n: 3 }, 'pregunta', frase));
        proximo = 'seguimiento';
        guia = 'Contesta con la información aprobada y ofrece cita.';
      } else {
        acciones.push(persona('pregunta sin respuesta aprobada'));
        proximo = 'persona';
        guia = 'Dile que se lo confirma una persona del equipo enseguida.';
      }
      break;

    case 'preferencia_horario':
    case 'acepta':
      acciones.push({ tipo: 'proponer_huecos', desdeFecha: ctx.hoy, franja: interp.franja || ctx.franjaPreferida });
      proximo = 'espera_respuesta';
      guia = 'Propón huecos en la franja que prefiere.';
      break;

    default:
      if (!ctx.yaPreguntoCuando) {
        acciones.push({ tipo: 'preguntar_cuando' });
        acciones.push(seguimiento(ctx, { tipo: 'dias', n: 3 }, 'sin_respuesta_a_cuando', frase));
        proximo = 'espera_respuesta';
        guia = 'No está claro: pregunta una vez cuándo le viene mejor que le escribas.';
      } else {
        acciones.push(persona('no se entiende la respuesta'));
        proximo = 'persona';
        guia = 'Dile que una persona del equipo le escribe.';
      }
  }
  // Invariante: si se queda esperando al paciente, también queda una fecha para volver a escribirle.
  if (proximo === 'espera_respuesta' && !acciones.some((a) => a.tipo === 'programar_seguimiento')) {
    acciones.push(seguimiento(ctx, { tipo: 'dias', n: 2 }, 'sin_respuesta_a_propuesta', frase));
  }
  return { intencion: interp.intencion, acciones, proximoPaso: proximo, guia };
}

module.exports = { decidir };
