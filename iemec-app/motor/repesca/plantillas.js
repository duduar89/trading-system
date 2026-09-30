'use strict';
// Módulo de plantillas de WhatsApp: biblioteca por uso, comprobaciones antes de mandarlas a Meta,
// estados y elección de la plantilla (con la de reserva si Meta pausa la principal).
const { revisar } = require('./filtro-legal');

const BAJA = 'Si no quieres recibir más mensajes como este, responde BAJA.';
const BOTONES_REPESCA = [
  { tipo: 'respuesta_rapida', texto: 'Sí, búscame hueco' },
  { tipo: 'respuesta_rapida', texto: 'Más adelante' },
  { tipo: 'respuesta_rapida', texto: 'No, gracias' },
];

// Las de la cita no nombran el tratamiento: salen en la pantalla bloqueada y el tratamiento es un dato
// de salud (art. 9 RGPD). Sí dicen el día, la hora y la sede, y la página «Tu cita» (detrás del
// enlace) enseña el resto. Los botones de enlace llevan el token de la cita al final de la URL
// (/cal/… «Añadir al calendario», /c/… «Ver mi cita»); la cabecera de ubicación, el mapa de la sede.
const SEDE_EJEMPLO = 'IEMEC (Av. Siglo XXI, 13, local 35, Boadilla del Monte)';
const TOKEN_EJEMPLO = 'EJEMPLO-token-no-valido-EJEMPLO-token-nova1';
const BOTONES_CITA = [
  { tipo: 'url', texto: 'Añadir al calendario', url: 'https://agenda.iemec-clinic.com/cal/{{1}}', ejemplo: TOKEN_EJEMPLO },
  { tipo: 'url', texto: 'Ver mi cita', url: 'https://agenda.iemec-clinic.com/c/{{1}}', ejemplo: TOKEN_EJEMPLO },
];
// Lo que el paciente contesta a la víspera con un toque (lo entiende la repesca: servidor/repesca/motor.js).
const RESPUESTAS_VISPERA = ['Sí, allí estaré', 'Necesito cambiarla'];

// Textos de partida en la voz de la clínica (tú, cercano y elegante, sin promesas ni medicamentos).
// La clínica los revisa antes de mandarlos a Meta.
const BIBLIOTECA = [
  { uso: 'cita_confirmacion', categoria: 'utilidad', nombre: 'iemec_cita_confirmada', cabecera: { tipo: 'ubicacion' },
    cuerpo: 'Hola {{1}}, tu cita está confirmada: {{2}} a las {{3}}, en {{4}}. Con los botones puedes añadirla a tu calendario y verla o cambiarla cuando quieras.',
    ejemplos: ['Laura', 'martes 6 de octubre', '17:00', SEDE_EJEMPLO],
    botones: BOTONES_CITA },
  // Una cita que sustituye a otra (otro día, otra hora u otra sede): en el calendario es otro evento.
  { uso: 'cita_cambiada', categoria: 'utilidad', nombre: 'iemec_cita_cambiada', cabecera: { tipo: 'ubicacion' },
    cuerpo: 'Hola {{1}}, tu cita ha cambiado: ahora es el {{2}} a las {{3}}, en {{4}}. Si tenías la anterior en tu calendario, bórrala y añade esta con el botón.',
    ejemplos: ['Laura', 'martes 6 de octubre', '17:00', SEDE_EJEMPLO],
    botones: BOTONES_CITA },
  // Solo respuestas rápidas: así también se ve en WhatsApp de escritorio.
  { uso: 'cita_recordatorio_24h', categoria: 'utilidad', nombre: 'iemec_recordatorio_24h',
    cuerpo: 'Hola {{1}}, te esperamos mañana, {{2}}, a las {{3}} en {{4}}. ¿Nos confirmas que vienes?',
    ejemplos: ['Laura', 'martes 6 de octubre', '17:00', SEDE_EJEMPLO],
    botones: RESPUESTAS_VISPERA.map((texto) => ({ tipo: 'respuesta_rapida', texto })) },
  { uso: 'cita_recordatorio_2h', categoria: 'utilidad', nombre: 'iemec_recordatorio_2h', cabecera: { tipo: 'ubicacion' },
    cuerpo: 'Hola {{1}}, hoy a las {{2}} te esperamos en {{3}}. Si te surge algo, responde a este mensaje.',
    ejemplos: ['Laura', '17:00', SEDE_EJEMPLO],
    botones: [BOTONES_CITA[1]] },
  // Sin botones: con uno de más, Meta la puede pasar a marketing.
  { uso: 'cita_cancelada', categoria: 'utilidad', nombre: 'iemec_cita_cancelada',
    cuerpo: 'Hola {{1}}, tu cita del {{2}} a las {{3}} en IEMEC está cancelada. Si la tenías en tu calendario, bórrala. Si quieres otra fecha, responde a este mensaje.',
    ejemplos: ['Laura', 'martes 6 de octubre', '17:00'], botones: [] },
  { uso: 'hueco_liberado', categoria: 'utilidad', nombre: 'iemec_hueco_liberado',
    cuerpo: 'Hola {{1}}, estabas en nuestra lista de espera para {{2}}: se ha liberado un hueco el {{3}} a las {{4}}. ¿Te lo guardamos?',
    ejemplos: ['Laura', 'tu valoración capilar', 'jueves 8 de octubre', '18:30'],
    botones: [{ tipo: 'respuesta_rapida', texto: 'Sí, guárdamelo' }, { tipo: 'respuesta_rapida', texto: 'No me viene bien' }] },
  { uso: 'lead_primer_contacto', categoria: 'marketing', nombre: 'iemec_lead_bienvenida',
    cuerpo: `Hola {{1}}, soy el asistente virtual de IEMEC. Gracias por tu interés en {{2}}. ¿Te buscamos un hueco para una primera valoración con nuestro equipo? ${BAJA}`,
    ejemplos: ['Laura', 'la mesoterapia capilar'], botones: BOTONES_REPESCA },
  { uso: 'lead_sin_cita', categoria: 'marketing', nombre: 'iemec_lead_seguimiento',
    cuerpo: `Hola {{1}}, te escribimos de IEMEC por tu consulta sobre {{2}}. Si te apetece, esta semana tenemos huecos para verte con calma. ${BAJA}`,
    ejemplos: ['Laura', 'el tratamiento facial'], botones: BOTONES_REPESCA },
  { uso: 'lead_ultimo_intento', categoria: 'marketing', nombre: 'iemec_lead_ultimo',
    cuerpo: `Hola {{1}}, no queremos insistir. Si más adelante quieres retomar lo de {{2}}, escríbenos por aquí y te atendemos encantados. ${BAJA}`,
    ejemplos: ['Laura', 'tu valoración'], botones: [{ tipo: 'respuesta_rapida', texto: 'Quiero retomarlo' }] },
  { uso: 'cancelacion_recuperar', categoria: 'marketing', nombre: 'iemec_cancelacion_nuevo_hueco',
    cuerpo: `Hola {{1}}, vimos que tuviste que cancelar tu cita de {{2}}. ¿Te buscamos otro momento que te venga mejor? ${BAJA}`,
    ejemplos: ['Laura', 'limpieza facial'], botones: BOTONES_REPESCA },
  // Los dos que salen solos tras una cita («No vino» y «toca repetir») le llegan también a quien solo
  // es cliente, sin consentimiento expreso: no nombran el tratamiento (es un dato de salud y se lee en
  // la pantalla bloqueada). La conversación ya sabe de qué cita va si contesta.
  { uso: 'no_vino_recuperar', categoria: 'marketing', nombre: 'iemec_no_vino_nuevo_hueco',
    cuerpo: `Hola {{1}}, te echamos de menos en tu última cita en IEMEC. ¿Te buscamos otro momento que te venga mejor? ${BAJA}`,
    ejemplos: ['Laura'], botones: BOTONES_REPESCA },
  { uso: 'presupuesto_2d', categoria: 'marketing', nombre: 'iemec_presupuesto_dudas',
    cuerpo: `Hola {{1}}, ¿pudiste revisar el plan de tratamiento de {{2}} que te preparamos? Si te surge cualquier duda, te la resolvemos por aquí. ${BAJA}`,
    ejemplos: ['Laura', 'medicina capilar'],
    botones: [{ tipo: 'respuesta_rapida', texto: 'Tengo una duda' }, { tipo: 'respuesta_rapida', texto: 'Quiero empezar' }, { tipo: 'respuesta_rapida', texto: 'Más adelante' }] },
  { uso: 'presupuesto_7d', categoria: 'marketing', nombre: 'iemec_presupuesto_opciones',
    cuerpo: `Hola {{1}}, sobre tu plan de {{2}}: podemos adaptarlo a tu ritmo y hay opciones de pago a plazos. ¿Lo vemos juntos en una llamada corta? ${BAJA}`,
    ejemplos: ['Laura', 'medicina capilar'],
    botones: [{ tipo: 'respuesta_rapida', texto: 'Sí, llamadme' }, { tipo: 'respuesta_rapida', texto: 'Más adelante' }, { tipo: 'respuesta_rapida', texto: 'No, gracias' }] },
  { uso: 'presupuesto_21d', categoria: 'marketing', nombre: 'iemec_presupuesto_cierre',
    cuerpo: `Hola {{1}}, guardamos tu plan de {{2}} por si quieres retomarlo. Cuando te venga bien, escríbenos y lo ponemos en marcha. ${BAJA}`,
    ejemplos: ['Laura', 'medicina capilar'], botones: [{ tipo: 'respuesta_rapida', texto: 'Quiero retomarlo' }] },
  { uso: 'como_quedamos', categoria: 'marketing', nombre: 'iemec_como_quedamos',
    cuerpo: `Hola {{1}}, como quedamos, te escribo para buscarte hueco para {{2}}. ¿Te viene bien esta semana o la que viene? ${BAJA}`,
    ejemplos: ['Laura', 'tu tratamiento facial'], botones: BOTONES_REPESCA },
  // Como la de «No vino», sin nombrar el tratamiento; y sin decir cuánto ha pasado: los hay que se
  // repiten cada mes y los hay que cada año.
  { uso: 'toca_repetir', categoria: 'marketing', nombre: 'iemec_toca_repetir',
    cuerpo: `Hola {{1}}, ya se acerca el momento de repetir tu tratamiento en IEMEC. ¿Te buscamos hueco? ${BAJA}`,
    ejemplos: ['Laura'], botones: BOTONES_REPESCA },
  { uso: 'paciente_dormido', categoria: 'marketing', nombre: 'iemec_te_echamos_de_menos',
    cuerpo: `Hola {{1}}, hace tiempo que no te vemos por IEMEC. Si quieres, te hacemos una valoración para ver cómo estás y qué te conviene ahora. ${BAJA}`,
    ejemplos: ['Laura'], botones: BOTONES_REPESCA },
  { uso: 'vale_regalo', categoria: 'marketing', nombre: 'iemec_vale_sin_canjear',
    cuerpo: `Hola {{1}}, tienes una tarjeta regalo de IEMEC de {{2}} esperando. ¿Te buscamos hueco para disfrutarla? ${BAJA}`,
    ejemplos: ['Laura', '70 €'], botones: BOTONES_REPESCA },
  // Sale 2 horas después de la cita o, si ya es tarde, al día siguiente: el texto no dice «hoy».
  { uso: 'resena', categoria: 'utilidad', nombre: 'iemec_opinion_visita',
    cuerpo: 'Hola {{1}}, gracias por tu visita a IEMEC. ¿Nos cuentas qué tal tu experiencia? Tu opinión en Google nos ayuda mucho.',
    ejemplos: ['Laura'],
    botones: [{ tipo: 'url', texto: 'Dejar mi opinión', url: 'https://agenda.iemec-clinic.com/r/{{1}}', ejemplo: 'Xy12abc' }] },
];

const TRANSICIONES = {
  borrador: ['en_revision'],
  en_revision: ['aprobada', 'rechazada'],
  aprobada: ['pausada', 'desactivada', 'en_revision'],
  pausada: ['aprobada', 'desactivada'],
  rechazada: ['borrador', 'en_revision'],
  desactivada: [],
};

function puedePasar(de, a) {
  return (TRANSICIONES[de] || []).includes(a);
}

function variablesDe(texto) {
  return [...String(texto).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

const CABECERAS = ['texto', 'imagen', 'video', 'documento', 'ubicacion'];

// Reglas de formato de Meta para plantillas (lo que haría que la rechacen sin mirar el texto).
function validarFormato(p) {
  const errores = [];
  if (!/^[a-z0-9_]{1,512}$/.test(p.nombre || '')) errores.push('El nombre solo puede llevar minúsculas, números y guiones bajos.');
  if (!p.cuerpo || p.cuerpo.length > 1024) errores.push('El cuerpo es obligatorio y como mucho de 1.024 caracteres.');
  const vars = variablesDe(p.cuerpo || '');
  const unicas = [...new Set(vars)];
  if (unicas.some((v, i) => v !== i + 1)) errores.push('Las variables tienen que ir seguidas: {{1}}, {{2}}, {{3}}…');
  if ((p.ejemplos || []).length < unicas.length) errores.push('Cada variable necesita un ejemplo para que Meta la revise.');
  const limpio = String(p.cuerpo || '').trim();
  if (/^\{\{\d+\}\}/.test(limpio) || /\{\{\d+\}\}[.!?]?$/.test(limpio)) errores.push('El cuerpo no puede empezar ni acabar con una variable.');
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(limpio)) errores.push('Dos variables seguidas sin texto entre medias.');
  const palabras = limpio.replace(/\{\{\d+\}\}/g, '').split(/\s+/).filter(Boolean).length;
  if (unicas.length && palabras < unicas.length * 3) errores.push('Demasiadas variables para tan poco texto.');
  const botones = p.botones || [];
  if (botones.length > 10) errores.push('Como mucho 10 botones.');
  for (const b of botones) {
    if (!b.texto || b.texto.length > 25) errores.push(`El botón «${b.texto}» pasa de 25 caracteres.`);
    if (b.tipo === 'url' && !/^https:\/\//.test(b.url || '')) errores.push('Los botones de enlace tienen que ir a una dirección https.');
    // La URL admite una variable, al final (https://…/c/{{1}}), y Meta pide un ejemplo.
    if (b.tipo === 'url' && /\{\{/.test(b.url || '')) {
      if (!/^[^{}]*\{\{1\}\}$/.test(b.url)) errores.push(`El enlace del botón «${b.texto}» solo puede llevar una variable, {{1}}, al final.`);
      if (!b.ejemplo) errores.push(`El enlace del botón «${b.texto}» necesita un ejemplo para que Meta lo revise.`);
    }
  }
  if (botones.filter((b) => b.tipo === 'url').length > 2) errores.push('Como mucho 2 botones de enlace.');
  if (p.cabecera && !CABECERAS.includes(p.cabecera.tipo)) errores.push(`Cabecera desconocida: «${p.cabecera.tipo}».`);
  if (p.cabecera?.tipo === 'ubicacion' && !['utilidad', 'marketing'].includes(p.categoria)) errores.push('La cabecera con mapa solo vale en plantillas de utilidad o de marketing.');
  return errores;
}

// Lo que Meta no rechaza, pero conviene saber: con 4 botones o más, o mezclando respuestas rápidas con
// botones de enlace, la plantilla no se ve en WhatsApp de escritorio.
function avisosFormato(p) {
  const botones = p.botones || [];
  const tipos = new Set(botones.map((b) => b.tipo));
  return botones.length >= 4 || (tipos.has('respuesta_rapida') && tipos.size > 1)
    ? ['Con 4 botones o más, o mezclando respuestas rápidas con enlaces, no se ve en WhatsApp de escritorio.'] : [];
}

// Todo lo que se comprueba antes de mandar una plantilla a Meta: formato + filtro legal.
function comprobarPlantilla(p) {
  const errores = validarFormato(p);
  const tieneBaja = /responde baja/i.test(p.cuerpo || '') || (p.botones || []).some((b) => /baja|no quiero|promociones/i.test(b.texto));
  const legal = revisar(p.cuerpo || '', { tipo: p.categoria === 'marketing' ? 'marketing' : 'utilidad', tieneBaja });
  return { ok: errores.length === 0 && legal.ok, errores: [...errores, ...legal.errores], avisos: [...avisosFormato(p), ...legal.avisos] };
}

// La plantilla que se usa para un uso: aprobada y con calidad no roja; si no, la de reserva.
function elegirPlantilla(uso, plantillas, { idioma = 'es' } = {}) {
  const orden = { verde: 0, pendiente: 1, amarilla: 2 };
  const candidatas = plantillas
    .filter((p) => p.uso === uso && (p.idioma || 'es') === idioma && p.estado === 'aprobada' && p.calidad !== 'roja')
    .sort((a, b) => (orden[a.calidad] ?? 1) - (orden[b.calidad] ?? 1) || Number(Boolean(a.reservaDeId)) - Number(Boolean(b.reservaDeId)));
  return candidatas[0] || null;
}

function rellenar(p, valores) {
  return String(p.cuerpo).replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? `{{${n}}}`);
}

// Los botones y la cabecera de una plantilla, vengan de la biblioteca o de la base (columnas JSON).
function jsonDe(v, porDefecto) {
  if (v == null) return porDefecto;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return porDefecto; }
}
const botonesDe = (p) => jsonDe(p?.botones, []) || [];
const cabeceraDe = (p) => jsonDe(p?.cabecera, null);

module.exports = {
  BIBLIOTECA, TRANSICIONES, RESPUESTAS_VISPERA, puedePasar, validarFormato, avisosFormato, comprobarPlantilla, elegirPlantilla, rellenar, variablesDe,
  botonesDe, cabeceraDe,
};
