'use strict';
// Publicaciones para la ficha de Google (Google Business Profile): un calendario de ideas por
// temporada y por familia de tratamientos, con el filtro de publicidad sanitaria y el botón de
// reserva por WhatsApp con código de origen (así se sabe qué cita vino de Google).
const { revisar } = require('../repesca/filtro-legal');

// Temas por mes (lo que la gente busca en cada época), en lenguaje de la clínica.
const TEMPORADA = {
  1: { tema: 'Propósitos de año nuevo', familias: ['perdida_peso', 'corporal', 'facial'], idea: 'Empieza el año cuidándote: valoración personalizada para decidir qué te conviene.' },
  2: { tema: 'Piel después del invierno', familias: ['facial'], idea: 'El frío castiga la piel: tratamientos de hidratación y luminosidad.' },
  3: { tema: 'Caída del cabello de primavera', familias: ['medicina_capilar'], idea: 'En primavera se nota más la caída: diagnóstico capilar para saber por qué.' },
  4: { tema: 'Preparar el verano', familias: ['corporal', 'perdida_peso'], idea: 'Llega el buen tiempo: tratamientos corporales con tiempo para ver resultados.' },
  5: { tema: 'Eventos y bodas', familias: ['facial', 'head_spa'], idea: '¿Boda o comunión a la vista? Planifica con tiempo tu tratamiento.' },
  6: { tema: 'Piel y sol', familias: ['facial'], idea: 'Cuidados de la piel en verano y qué tratamientos dejar para después.' },
  7: { tema: 'Bienestar y head spa', familias: ['head_spa'], idea: 'Un respiro en pleno verano: ritual de head spa japonés.' },
  8: { tema: 'Vuelta a la rutina', familias: ['facial', 'medicina_capilar'], idea: 'Reserva ya tu cita de septiembre y empieza el curso con buena cara.' },
  9: { tema: 'Reparar la piel tras el verano', familias: ['facial'], idea: 'Manchas y piel apagada tras el verano: valoración para recuperarla.' },
  10: { tema: 'Otoño, caída del cabello', familias: ['medicina_capilar', 'cirugia_capilar'], idea: 'En otoño aumenta la caída: diagnóstico capilar y opciones con el equipo médico.' },
  11: { tema: 'Antes de las fiestas', familias: ['facial', 'corporal'], idea: 'Llega diciembre: planifica ahora para estar a punto en las fiestas.' },
  12: { tema: 'Regala bienestar', familias: ['tarjeta_regalo', 'head_spa'], idea: 'Tarjetas regalo IEMEC de 45, 70, 140 y 250 €, también online.' },
};

function enlaceWhatsApp(telefono, texto) {
  return `https://wa.me/${String(telefono).replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}

/**
 * Ideas de publicación para un mes. Nunca propone tratamientos con publicidad restringida
 * (medicamentos con receta o productos sanitarios).
 * @param {object} p { mes 1-12, tratamientos (filas del catálogo), telefono, n }
 */
function ideasDelMes({ mes, tratamientos = [], telefono = '34722833285', n = 4 }) {
  const t = TEMPORADA[mes];
  const aptos = tratamientos.filter((x) => t.familias.includes(x.familia) && !x.publicidad_restringida && x.activo !== false);
  const ideas = [{
    tipo: 'novedad',
    titulo: t.tema,
    texto: `${t.idea} En IEMEC, en Boadilla del Monte, te atiende nuestro equipo con una valoración personalizada. Reserva por WhatsApp.`,
  }];
  for (const x of aptos.slice(0, n - 1)) {
    ideas.push({
      tipo: 'novedad',
      titulo: x.nombre,
      tratamientoId: x.id,
      texto: `${x.nombre} en IEMEC (Boadilla del Monte). ${x.descripcion ? `${x.descripcion.replace(/\.$/, '')}. ` : ''}Te explicamos en una valoración si es para ti. Reserva por WhatsApp.`,
    });
  }
  return ideas.map((i, k) => {
    const codigo = `gbp-${mes}-${k + 1}`;
    const legal = revisar(i.texto, { tipo: 'conversacion' });
    return {
      ...i,
      codigo,
      boton: { tipo: 'RESERVAR', url: enlaceWhatsApp(telefono, `Hola, vengo de Google (${codigo}) y quisiera reservar una cita`) },
      texto: i.texto.slice(0, 1500),
      ok: legal.ok && !/medicamento/.test(legal.avisos.join(' ')),
      avisos: legal.avisos,
    };
  }).filter((i) => i.ok);
}

module.exports = { ideasDelMes, TEMPORADA, enlaceWhatsApp };
