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

// Textos de partida en la voz de la clínica (tú, cercano y elegante, sin promesas ni medicamentos).
// La clínica los revisa antes de mandarlos a Meta.
const BIBLIOTECA = [
  { uso: 'cita_confirmacion', categoria: 'utilidad', nombre: 'iemec_cita_confirmada',
    cuerpo: 'Hola {{1}}, tu cita en IEMEC está confirmada: {{2}} a las {{3}}, {{4}}. Desde el enlace puedes añadirla a tu calendario, cambiarla o cancelarla.',
    ejemplos: ['Laura', 'martes 6 de octubre', '17:00', 'valoración facial'],
    botones: [{ tipo: 'url', texto: 'Ver mi cita', url: 'https://agenda.iemec-clinic.com/c/{{1}}', ejemplo: 'Xy12abc' }] },
  { uso: 'cita_recordatorio_24h', categoria: 'utilidad', nombre: 'iemec_recordatorio_24h',
    cuerpo: 'Hola {{1}}, te esperamos mañana a las {{2}} en IEMEC (Av. Siglo XXI 13, Boadilla del Monte). ¿Nos lo confirmas?',
    ejemplos: ['Laura', '17:00'],
    botones: [{ tipo: 'respuesta_rapida', texto: 'Confirmo' }, { tipo: 'respuesta_rapida', texto: 'Necesito cambiarla' }] },
  { uso: 'cita_recordatorio_2h', categoria: 'utilidad', nombre: 'iemec_recordatorio_2h',
    cuerpo: 'Hola {{1}}, en un par de horas, a las {{2}}, te vemos en IEMEC. Si te surge algo, avísanos por aquí.',
    ejemplos: ['Laura', '17:00'], botones: [] },
  { uso: 'cita_cancelada', categoria: 'utilidad', nombre: 'iemec_cita_cancelada',
    cuerpo: 'Hola {{1}}, tu cita del {{2}} en IEMEC ha quedado cancelada. Cuando quieras te buscamos otro hueco.',
    ejemplos: ['Laura', 'martes 6 de octubre'],
    botones: [{ tipo: 'respuesta_rapida', texto: 'Buscar otro hueco' }] },
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
  // La opinión en Google, a todos (normas de Google): sobre esa visita ({{2}}, su día), sin nombrar el
  // tratamiento, sin pedir estrellas ni sugerir qué escribir o a quién nombrar, sin nada a cambio y
  // con la baja. Sale 2 horas después, al día siguiente o a los 3 días (la prueba del momento): el
  // texto no dice «hoy». Y un solo recordatorio, a los 7-9 días, si no abrió el enlace.
  { uso: 'resena', categoria: 'utilidad', nombre: 'iemec_opinion_visita',
    cuerpo: `Hola {{1}}, gracias por tu visita a IEMEC del {{2}}. Si te apetece contar qué tal fue, tu opinión en Google nos ayuda mucho, sea cual sea. ${BAJA}`,
    ejemplos: ['Laura', 'martes 6 de octubre'],
    botones: [{ tipo: 'url', texto: 'Dejar mi opinión', url: 'https://agenda.iemec-clinic.com/r/{{1}}', ejemplo: 'Xy12abc' }] },
  { uso: 'resena_recordatorio', categoria: 'utilidad', nombre: 'iemec_opinion_recordatorio',
    cuerpo: `Hola {{1}}, hace unos días te preguntamos por tu visita a IEMEC del {{2}}. Si aún te apetece contarlo en Google, aquí tienes el enlace; es el único recordatorio que te enviamos. ${BAJA}`,
    ejemplos: ['Laura', 'martes 6 de octubre'],
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
  }
  if (botones.filter((b) => b.tipo === 'url').length > 2) errores.push('Como mucho 2 botones de enlace.');
  return errores;
}

// Todo lo que se comprueba antes de mandar una plantilla a Meta: formato + filtro legal.
function comprobarPlantilla(p) {
  const errores = validarFormato(p);
  const tieneBaja = /responde baja/i.test(p.cuerpo || '') || (p.botones || []).some((b) => /baja|no quiero|promociones/i.test(b.texto));
  const legal = revisar(p.cuerpo || '', { tipo: p.categoria === 'marketing' ? 'marketing' : 'utilidad', tieneBaja });
  return { ok: errores.length === 0 && legal.ok, errores: [...errores, ...legal.errores], avisos: legal.avisos };
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

module.exports = { BIBLIOTECA, TRANSICIONES, puedePasar, validarFormato, comprobarPlantilla, elegirPlantilla, rellenar, variablesDe };
