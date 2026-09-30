'use strict';
// Motor de reseñas de Google: a quién y cuándo pedir la opinión, de qué hablan las reseñas, cómo
// se responden y qué cifras mira la clínica. Sin base de datos (eso está en servidor/resenas.js).
//
// Normas que se cumplen siempre (política de reseñas de Google, normas de la API de Business
// Profile, LSSI y RGPD):
//   · Se pide a TODOS los pacientes atendidos, sin mirar si están contentos: tampoco se deja de pedir
//     a quien tiene una queja abierta (sería pedir solo a los contentos, el «review gating» que Google
//     castiga). La queja la atiende una persona en paralelo y la petición sale igual. Solo se deja de
//     pedir por la baja (de su ficha o de la lista de bajas por teléfono), porque ya dejó su reseña o
//     porque se le pidió hace menos de 120 días.
//   · El mensaje habla de esa visita sin nombrar el tratamiento, no pide estrellas ni sugiere qué
//     escribir o a quién nombrar, no da nada a cambio y lleva la baja («BAJA»). Un solo recordatorio,
//     a los 7-9 días y solo si no abrió el enlace, igual para todos.
//   · Las respuestas son breves, personales y variadas, en lenguaje neutro, sin datos que no haya
//     escrito la persona (ni tratamiento, ni fechas, ni profesional), sin confirmar que es paciente si
//     no lo dice y sin promociones ni enlaces; en las negativas se le invita a hablarlo en privado con
//     el teléfono de la clínica. Siempre las aprueba una persona.
//   · Si una reseña habla de una infección, una quemadura, una complicación, urgencias, una denuncia o
//     un abogado, es una alerta clínica: la ve dirección médica, no marketing.
const crypto = require('crypto');
const T = require('../tiempo');
const { normalizar } = require('../repesca/interpretar');
const { revisar, MEDICAMENTOS, MARCAS_SANITARIAS } = require('../repesca/filtro-legal');
const { telefonoLegible } = require('../entrada/leads');

const HORA = 3600000;
const DIA = 24 * HORA;

const REGLAS = {
  horasTrasCita: 2, diasEntrePeticiones: 120, horaDesde: '10:30', horaHasta: '20:00', diasMaxTrasCita: 2,
  // La prueba del momento de pedir: al día siguiente a esta hora, o a los N días de la cita.
  horaDiaSiguiente: '11:00', diasDespues: 3,
  // Un solo recordatorio si no abrió el enlace: del día 7 al 9 después de la petición.
  recordatorioDesdeDias: 7, recordatorioHastaDias: 9,
};

// La prueba del momento de pedir, por cita (se guarda con la petición para medirla). En dos
// experimentos con más de 300.000 clientes (Jung et al., Journal of Marketing, 2023), pedirla enseguida
// trajo menos reseñas que pedirla unos días después; aquí se comprueba con los pacientes de la clínica.
const VARIANTES = ['2h', 'dia_siguiente', 'tres_dias'];
const NOMBRE_VARIANTE = { '2h': '2 horas después', dia_siguiente: 'Al día siguiente, 11:00', tres_dias: 'A los 3 días' };

// Dos citas completadas el mismo día: sale una sola petición (la que ya estaba en camino).
const OTRA_EN_CAMINO = 'ya tiene otra petición de reseña programada';
const DE_BAJA = 'se dio de baja de los mensajes';
// El teléfono de la ficha (la clínica lo confirma: puerta ⛔ de Google).
const TELEFONO = '722 83 32 85';

// ── A quién y cuándo se le pide ─────────────────────────────────────────────────────────────

/**
 * ¿Hay algo que impida pedirle la reseña? Se mira al programarla y otra vez justo antes de enviarla:
 * entre medias puede darse de baja, dejar la reseña o recibir otra petición. Una queja NO la impide.
 * @param {object} p { cita: { estado, fin }, paciente: { baja_comercial_en }, bajaComercial: bool (su
 *                     teléfono está en la lista de bajas), ultimaPeticion: Date|null (la última que se
 *                     le envió), otraEnCamino: bool (otra suya ya programada), yaResenoEnGoogle: bool }
 * @param {object} o { referencia: desde dónde se cuentan los días desde la última petición (el fin de
 *                     la cita al programarla; al enviarla, ahora) }
 * @returns {string|null} el motivo para no pedirla, o null si se puede
 */
function motivoParaNoPedir(p, { referencia = p.cita.fin, reglas = REGLAS } = {}) {
  if (p.cita.estado !== 'completada') return 'la cita no se ha completado';
  if (p.paciente?.baja_comercial_en || p.bajaComercial) return DE_BAJA;
  if (p.yaResenoEnGoogle) return 'ya dejó una reseña';
  if (p.otraEnCamino) return OTRA_EN_CAMINO;
  if (p.ultimaPeticion && (new Date(referencia) - new Date(p.ultimaPeticion)) / DIA < reglas.diasEntrePeticiones) {
    return 'ya se le pidió hace poco';
  }
  return null;
}

// Dentro del horario de envío (de 10:30 a 20:00, un día que abre la clínica); si no, el siguiente día
// que abre, a horaSiguiente.
function enHorarioDeEnvio(cuando, calendario, { horaDesde = REGLAS.horaDesde, horaHasta = REGLAS.horaHasta, horaSiguiente = horaDesde } = {}) {
  const p = T.partesMadrid(cuando);
  if (p.minutos >= T.minutosDe(horaHasta) || !calendario.abre(p.fecha)) {
    return T.desdeMadrid(calendario.siguienteLaborable(p.fecha, { incluida: false }), horaSiguiente);
  }
  if (p.minutos < T.minutosDe(horaDesde)) return T.desdeMadrid(p.fecha, horaDesde);
  return new Date(cuando);
}

// La variante de la prueba para una cita: siempre la misma para la misma cita (si se deshace y se
// vuelve a completar, no cambia) y repartida a partes iguales entre las que están en marcha.
function elegirVariante(citaId, activas = VARIANTES) {
  const lista = VARIANTES.filter((v) => activas.includes(v));
  if (!lista.length) return '2h';
  const h = crypto.createHash('sha256').update(`momento-resena:${citaId}`).digest().readUInt32BE(0);
  return lista[h % lista.length];
}

/**
 * ¿Se le pide la reseña a este paciente tras esta cita? ¿Cuándo?
 * @param {object} p lo de motivoParaNoPedir, noAntesDe: Date|null (no sale antes: mientras recepción
 *                   aún puede deshacer) y variante: '2h' (por defecto), 'dia_siguiente' o 'tres_dias'
 * @returns {{ pedir: false, motivo }|{ pedir: true, cuando: Date, variante }}
 */
function pedirResena(p, calendario, reglas = REGLAS) {
  const motivo = motivoParaNoPedir(p, { reglas });
  if (motivo) return { pedir: false, motivo };
  // Si la cita se marca completada días después, ya no se pide: la opinión de una visita de hace días
  // que nadie cerró a tiempo llega tarde. El texto no dice «hoy»: puede salir al día siguiente.
  if (p.noAntesDe && (new Date(p.noAntesDe) - new Date(p.cita.fin)) / DIA > reglas.diasMaxTrasCita) {
    return { pedir: false, motivo: 'la cita se marcó como completada días después' };
  }
  const variante = VARIANTES.includes(p.variante) ? p.variante : '2h';
  const fin = new Date(p.cita.fin);
  const f = T.partesMadrid(fin);
  let base = new Date(fin.getTime() + reglas.horasTrasCita * HORA);
  let horaSiguiente = reglas.horaDesde;
  if (variante === 'dia_siguiente') {
    base = T.desdeMadrid(T.sumarDias(f.fecha, 1), reglas.horaDiaSiguiente);
    horaSiguiente = reglas.horaDiaSiguiente;
  } else if (variante === 'tres_dias') {
    base = T.desdeMadrid(T.sumarDias(f.fecha, reglas.diasDespues), f.hora);
  }
  const noAntes = p.noAntesDe ? new Date(p.noAntesDe).getTime() : 0;
  const cuando = enHorarioDeEnvio(new Date(Math.max(base.getTime(), noAntes)), calendario, { ...reglas, horaSiguiente });
  return { pedir: true, cuando, variante };
}

// Hasta cuándo vale el recordatorio: el día 9 después de la petición, al cerrar el horario de envío.
function limiteRecordatorio(enviadaEn, reglas = REGLAS) {
  return T.desdeMadrid(T.sumarDias(T.fechaMadrid(new Date(enviadaEn)), reglas.recordatorioHastaDias), reglas.horaHasta);
}

// El recordatorio: a los 7 días, a la misma hora (en horario de envío y un día que abre la clínica).
// Si la clínica cierra del día 7 al 9, no hay recordatorio (null).
function momentoRecordatorio(enviadaEn, calendario, reglas = REGLAS) {
  const e = T.partesMadrid(new Date(enviadaEn));
  const cuando = enHorarioDeEnvio(T.desdeMadrid(T.sumarDias(e.fecha, reglas.recordatorioDesdeDias), e.hora), calendario, reglas);
  return cuando <= limiteRecordatorio(enviadaEn, reglas) ? cuando : null;
}

/**
 * ¿Se le manda el recordatorio? Solo uno, solo si no abrió el enlace y con lo mismo que la petición
 * (la baja o la reseña ya hecha lo paran). La regla de los 120 días no cuenta: es la misma petición.
 * @param {object} p { peticion: { estado, enviada_en, pulsada_en }, cita, paciente, bajaComercial,
 *                     yaResenoEnGoogle }
 */
function motivoParaNoRecordar(p, { ahora = new Date(), reglas = REGLAS } = {}) {
  const pet = p.peticion;
  if (pet.estado !== 'enviada') return 'la petición no salió';
  if (pet.pulsada_en) return 'ya abrió el enlace';
  if (p.cita && p.cita.estado !== 'completada') return 'la cita ya no está completada';
  if (p.paciente?.baja_comercial_en || p.bajaComercial) return DE_BAJA;
  if (p.yaResenoEnGoogle) return 'ya dejó una reseña';
  if (new Date(ahora) > new Date(limiteRecordatorio(pet.enviada_en, reglas).getTime() + HORA)) return 'se pasó el plazo del recordatorio (7-9 días)';
  return null;
}

// ── El enlace para reseñar ──────────────────────────────────────────────────────────────────

// Formato «writereview» con el place_id: Google no lo documenta, así que solo es la reserva.
function enlaceResena(placeId) {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

// Solo se redirige a una dirección de Google (https): así el enlace corto nunca lleva a otro sitio.
function esEnlaceDeGoogle(uri) {
  try {
    const u = new URL(String(uri));
    return u.protocol === 'https:' && (u.hostname === 'g.page' || /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(u.hostname));
  } catch {
    return false;
  }
}

// El enlace oficial de la ficha (newReviewUri de Business Profile) si lo hay; si no, el de reserva.
function enlaceParaResenar({ enlaceFicha = null, placeId = null } = {}) {
  if (enlaceFicha && esEnlaceDeGoogle(enlaceFicha)) return String(enlaceFicha);
  return placeId ? enlaceResena(placeId) : null;
}

// ── El mensaje de la petición ───────────────────────────────────────────────────────────────

const PIDE_ESTRELLAS = /(estrella|\bcinco\b|\b5 ?\/ ?5\b|nota maxima|puntuacion maxima|valoracion maxima)/;
const SOLO_A_LOS_CONTENTOS = /(si (te ha gustado|te gusto|te ha encantado|estas content|has quedado content|quedaste content|estas satisfech|todo (ha ido|fue) bien)|solo si|si no (te ha gustado|estas content|quedaste content)|antes de (publicar|escribir|dejar)|escribenos (a nosotros )?(primero|antes)|cuentanoslo (a nosotros )?(primero|antes))/;
const INCENTIVO = /(descuento|regalo|sorteo|premio|gratis|a cambio|cupon|codigo (promocional|de descuento)|\d+ ?%|\bbono\b|\bpuntos\b|recompensa|obsequio)/;
const SUGIERE_CONTENIDO = /(menciona|nombra|destaca|hablanos de|habla de|cuenta que|di que|el nombre de|recomienda(nos)? a|comenta (el|la|lo|que))/;
const TITULOS_EQUIPO = /\b(dr|dra|doctor|doctora|doctores|cirujan[oa]s?|enfermer[oa]s?|esteticistas?)\b/;
const NOMBRA_TRATAMIENTO = /\b(tratamientos?|sesion(es)?|intervencion|operacion|cirugia|toxina|botox|relleno|hialuronico|injerto|laser|hifu|peeling|mesoterapia|depilacion|liposuccion|micropigmentacion)\b/;

// Palabras de 4 letras o más de los nombres del equipo («Dra. Maribel Perea» → maribel, perea).
const NO_SON_NOMBRES_DEL_EQUIPO = new Set(['estetica', 'confirmar', 'medico', 'medica', 'doctor', 'doctora', 'equipo', 'enfermeria', 'recepcion']);
function nombresDelEquipo(profesionales = []) {
  const nombres = new Set();
  for (const p of profesionales) {
    for (const w of String((typeof p === 'string' ? p : p?.nombre) || '').split(/[\s().,]+/)) {
      const k = normalizar(w).replace(/[^a-z]/g, '');
      if (k.length >= 4 && !NO_SON_NOMBRES_DEL_EQUIPO.has(k)) nombres.add(k);
    }
  }
  return nombres;
}

/**
 * Lo que tiene que cumplir el mensaje que pide la reseña (el cuerpo de la plantilla): se mira con la
 * biblioteca y otra vez antes de enviar con la plantilla aprobada, por si alguien la ha cambiado.
 * @returns {{ ok, errores: string[], avisos: string[] }}
 */
function revisarPeticion(texto, { profesionales = [] } = {}) {
  const t = normalizar(texto);
  const errores = [];
  if (!/visita/.test(t)) errores.push('Tiene que hablar de esa visita.');
  if (/\bhoy\b/.test(t)) errores.push('No puede decir «hoy»: a veces sale al día siguiente o a los 3 días.');
  if (PIDE_ESTRELLAS.test(t)) errores.push('No se piden estrellas ni una nota concreta.');
  if (SOLO_A_LOS_CONTENTOS.test(t)) errores.push('No se pide solo a quien está contento ni se desanima a quien no lo está (Google lo castiga).');
  if (INCENTIVO.test(t)) errores.push('Nada a cambio de la reseña: ni descuentos, ni regalos, ni sorteos.');
  if (SUGIERE_CONTENIDO.test(t) || TITULOS_EQUIPO.test(t)) errores.push('No se sugiere qué escribir ni a quién del equipo nombrar.');
  const equipo = nombresDelEquipo(profesionales);
  if (t.split(/[^a-z]+/).some((w) => equipo.has(w))) errores.push('No se nombra a nadie del equipo.');
  if (NOMBRA_TRATAMIENTO.test(t)) errores.push('No se nombra el tratamiento (es un dato de salud y se lee en la pantalla bloqueada).');
  if (!/responde baja/.test(t)) errores.push('Falta la baja: «Si no quieres recibir más mensajes como este, responde BAJA.»');
  const legal = revisar(texto, { tipo: 'utilidad', tieneBaja: true });
  errores.push(...legal.errores);
  return { ok: errores.length === 0, errores, avisos: legal.avisos };
}

// ── De qué hablan las reseñas ───────────────────────────────────────────────────────────────

const TEMAS = {
  trato: /(trato|amable|cercan|carino|atent|simpatic|encantador|agradable|profesionales? (y|muy))/,
  profesionalidad: /(profesional|confianza|expert|conocimiento|explica|explicacion|asesor|honest)/,
  resultados: /(resultado|natural|contenta|contento|encantada|encantado|mejora|se nota|rejuvenec|pelo|cabello|piel)/,
  instalaciones: /(instalacion|clinica (preciosa|bonita|muy bonita|impecable)|limpi|decoracion|bonit|acogedor|elegante)/,
  precio: /(\bprecios?\b|\bcar[oa]s?\b|carisim|barat|\bcoste|relacion calidad|presupuesto)/,
  espera_puntualidad: /(espera|esperar|puntual|retraso|tarde|cita a la hora|hora de retraso)/,
  dolor_comodidad: /(dolor|duele|molest|indoloro|no note nada|comod)/,
  atencion_recepcion: /(recepcion|telefono|whatsapp|contestan|no cogen|no contestan|cita (online|facil))/,
  seguimiento: /(seguimiento|revisiones|me (llamaron|escribieron|llamasteis|escribisteis) (despues|luego|al dia siguiente|para (ver|saber|preguntar))|se (preocuparon|preocupan|interesaron) por|(estuvieron|estan|siempre) pendientes|pendientes de mi|post ?operatorio|despues del tratamiento|me acompanaron)/,
};
const NEGATIVO = /(\bmal\b|fatal|horrible|pesim|nunca mas|no volvere|no lo recomiendo|decepcion|estafa|timo|no contestan|no cogen|caro|carisim|retraso|queja|desastre|peor)/;
const POSITIVO = /(genial|excelente|perfect|encantad|recomiendo|maravill|estupend|fenomenal|increible|contenta|contento|10|gracias)/;

// Lo que dice una reseña de una posible complicación o de una reclamación: dirección médica.
const ALERTAS_CLINICAS = [
  ['infección', /\b(infeccion(es)?|infectad[oa]s?|infecto)\b/],
  ['quemadura', /\b(quemaduras?|quemad[oa]s?|me quem(o|aron)|quemazon)\b/],
  ['complicación', /\bcomplicacion(es)?\b/],
  ['necrosis', /\b(necrosis|necrosad[oa]s?)\b/],
  ['urgencias', /\b(urgencias|hospital(izad[oa]s?|izacion)?|ingresad[oa]s?|ambulancia)\b/],
  ['reacción grave', /\b(reaccion alergica|anafila\w*|paralisis|hemorragia|embolia|trombosis|ceguera|perdida de (vision|vista))\b/],
  ['denuncia', /\b(denuncia(s|do|da|r|re|remos)?|juzgados?|demandar(e|emos)?|negligencia|mala praxis|hoja de reclamaciones)\b/],
  ['abogado', /\b(abogad[oa]s?|bufete|via judicial|tribunales)\b/],
];

function sentimientoPorNota(nota) {
  return nota >= 4 ? 'positivo' : nota <= 2 ? 'negativo' : 'mixto';
}

function analizar(resena) {
  const t = normalizar(resena.texto || '');
  const temas = Object.entries(TEMAS).filter(([, rx]) => rx.test(t)).map(([k]) => k);
  let sentimiento = sentimientoPorNota(resena.nota);
  if (resena.nota >= 4 && NEGATIVO.test(t) && !POSITIVO.test(t)) sentimiento = 'mixto';
  if (resena.nota === 3 && POSITIVO.test(t) && !NEGATIVO.test(t)) sentimiento = 'positivo';
  const alertas = ALERTAS_CLINICAS.filter(([, rx]) => rx.test(t)).map(([k]) => k);
  const alertaClinica = alertas.length > 0;
  const prioridad = alertaClinica || resena.nota <= 2 ? 'alta' : resena.nota === 3 || sentimiento === 'mixto' ? 'media' : 'normal';
  return { temas, sentimiento, prioridad, alertaClinica, alertas };
}

// ── Las respuestas ──────────────────────────────────────────────────────────────────────────
// Frases en lenguaje neutro («que el trato haya estado a la altura», nunca «atendida»), sin nada que
// no haya escrito la persona y sin confirmar que es paciente: sirven para quien ha venido y para
// quien no. Cada parte rota con el índice: dos respuestas seguidas no se parecen.

const APERTURAS = [
  '¡Muchas gracias, {n}!', 'Gracias de corazón, {n}.', '¡Qué alegría leerte, {n}!', 'Mil gracias por tus palabras, {n}.',
  'Gracias por dedicarnos este rato, {n}.', '¡Gracias por tu reseña, {n}!', 'Muchísimas gracias por escribirnos, {n}.', '¡Qué bonito leer esto, {n}!',
];
const FRASES_TEMA = {
  trato: ['Nos alegra mucho que el trato haya estado a la altura.', 'Que el trato haya estado a la altura es lo que más nos importa.', 'Cuidar el trato con cada persona es algo que nos tomamos muy en serio.'],
  profesionalidad: ['Cuidar cada detalle con profesionalidad es nuestra prioridad.', 'Trabajamos cada día para merecer esa confianza.', 'Nos esforzamos por explicar cada paso con claridad y rigor.'],
  resultados: ['Nos alegra muchísimo que la experiencia haya merecido la pena.', 'Leer algo así nos anima a seguir trabajando igual.', 'Es la mejor noticia que nos podías dar.'],
  instalaciones: ['Cuidamos cada rincón para que el tiempo aquí resulte agradable.', 'Nos encanta que te haya gustado el espacio: lo cuidamos con mucho cariño.', 'Ponemos mucho mimo en que el lugar resulte acogedor.'],
  dolor_comodidad: ['Que todo resulte lo más cómodo posible es una prioridad para nosotros.', 'Nos alegra que te hayas sentido a gusto en todo momento.', 'La comodidad de cada persona es algo que cuidamos al detalle.'],
  atencion_recepcion: ['Se lo diremos a todo el equipo, que lo agradecerá mucho.', 'Estar disponibles cuando se nos necesita es clave para nosotros.', 'Nos alegra que la comunicación haya sido fácil.'],
  seguimiento: ['Estar cerca de cada persona también después es parte de nuestra manera de trabajar.', 'Nos alegra que hayas notado ese acompañamiento.', 'Seguir pendientes de cada persona es parte de cómo trabajamos.'],
};
const FRASES_GENERALES = ['Nos alegra muchísimo leer tu opinión.', 'Comentarios como el tuyo nos animan a seguir.', 'Nos hace mucha ilusión leer algo así.', 'Gracias por tomarte el tiempo de contarlo.'];
const CIERRES = [
  'Un saludo de todo el equipo de IEMEC.', 'Aquí nos tienes para lo que necesites.', 'Un abrazo de todo el equipo.',
  'Hasta pronto.', 'Un fuerte abrazo de parte de IEMEC.', 'Gracias de nuevo por escribirnos.',
];
// Las partes de cada respuesta tienen largos distintos (4, 2 o 3, 3…): al rotar con el mismo índice
// salen todas las combinaciones antes de repetir una.
const MIXTAS_APERTURA = ['Gracias por tu opinión, {n}.', 'Gracias por contarnos tu experiencia, {n}.', 'Te agradecemos mucho el comentario, {n}.', 'Muchas gracias por escribirnos, {n}.'];
const MIXTAS_MEJORA = {
  espera_puntualidad: ['Tomamos nota de lo que comentas sobre los tiempos de espera para mejorarlo.', 'Lo que cuentas de la espera nos ayuda a organizarnos mejor.'],
  precio: ['Entendemos lo que comentas y queremos que siempre tengas claras todas las opciones.', 'Tomamos nota de tu comentario sobre el precio.'],
  atencion_recepcion: ['Tomamos nota de lo que comentas sobre la atención por teléfono y mensajes para mejorarla.', 'Nos ayuda mucho saberlo para responder más rápido.'],
  general: ['Tomamos nota de lo que nos cuentas para seguir mejorando.', 'Tu comentario nos ayuda a hacerlo cada día mejor.', 'Lo tendremos muy en cuenta.'],
};
const MIXTAS_CIERRE = [
  'Si quieres comentarlo con nosotros, estamos en el {tel}.', 'Si te apetece contárnoslo con más calma, llámanos o escríbenos al {tel}.',
  'Nos encantará saber más: estamos en el {tel}.',
];
// Las negativas: disculpa, invitación a hablarlo en privado con el teléfono de la ficha y, a veces,
// un cierre. Tres partes que rotan: un día de historial con diez negativas no repite ninguna.
const NEGATIVAS = {
  disculpa: [
    'sentimos mucho que tu experiencia no haya sido la que esperabas.', 'lamentamos de verdad lo que nos cuentas.',
    'gracias por decírnoslo, y sentimos que no haya estado a la altura.', 'sentimos mucho que te hayas llevado esta impresión.',
    'nos apena leer esto y te agradecemos que nos lo cuentes.',
  ],
  invitacion: [
    'Nos gustaría entender qué ha pasado y ayudarte: escríbenos o llámanos al {tel} y lo hablamos con calma, en privado.',
    'Queremos escucharte y ver cómo ayudarte: si te parece, llámanos o escríbenos al {tel} y lo vemos en privado.',
    'Nos encantaría hablarlo directamente: estamos en el {tel} para verlo en privado.',
    'Tu opinión nos importa y queremos entenderla bien: escríbenos o llámanos al {tel} y lo hablamos en privado.',
  ],
  cierre: ['', 'Gracias por contárnoslo.', 'Un saludo del equipo de IEMEC.'],
};
// Alerta clínica: ni un detalle en público; que llame, y lo lleva dirección médica.
const ALERTA = {
  disculpa: ['gracias por escribirnos.', 'sentimos mucho lo que nos cuentas.', 'gracias por contárnoslo.', 'te agradecemos que nos lo hayas contado.'],
  invitacion: [
    'Queremos hablarlo directamente y cuanto antes: llámanos o escríbenos al {tel} y lo vemos en privado.',
    'Queremos ocuparnos personalmente: por favor, llámanos o escríbenos al {tel} para hablarlo en privado.',
    'Nos gustaría hablarlo contigo cuanto antes, en privado: estamos en el {tel}.',
  ],
  cierre: [''],
};

// Lo que no es un nombre de pila para saludar («Usuario de Google», «Anónimo», iniciales…).
const NO_SON_NOMBRES = new Set(['usuario', 'usuaria', 'anonimo', 'anonima', 'google', 'cliente', 'paciente', 'un', 'una', 'el', 'la', 'dr', 'dra', 'doctor', 'doctora', 'sr', 'sra']);

function primerNombre(autor = '') {
  const n = String(autor ?? '').trim().split(/\s+/)[0] || '';
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñÜü]{2,}$/.test(n) || NO_SON_NOMBRES.has(normalizar(n))) return '';
  return n === n.toUpperCase() || n === n.toLowerCase() ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : n;
}

const rota = (lista, i) => lista[((i % lista.length) + lista.length) % lista.length];
const conNombre = (frase, n) => frase.replace(', {n}', n ? `, ${n}` : '').replace('{n}', n);
const hola = (n) => (n ? `Hola ${n}, ` : 'Hola, ');

// «Hola Laura, sentimos… Llámanos al 722 83 32 85… Gracias por contárnoslo.»
const enPrivado = (partes, { n, i, tel }) => [hola(n) + rota(partes.disculpa, i), tel(rota(partes.invitacion, i)), rota(partes.cierre, i)].filter(Boolean).join(' ');

function componer(resena, a, { n, i, telefono }) {
  const tel = (s) => s.replace('{tel}', telefono);
  if (a.alertaClinica && resena.nota <= 3) return enPrivado(ALERTA, { n, i, tel });
  if (resena.nota <= 2 || a.sentimiento === 'negativo') return enPrivado(NEGATIVAS, { n, i, tel });
  if (a.sentimiento === 'mixto' || resena.nota === 3) {
    const tema = ['espera_puntualidad', 'precio', 'atencion_recepcion'].find((x) => a.temas.includes(x)) || 'general';
    return [conNombre(rota(MIXTAS_APERTURA, i), n), rota(MIXTAS_MEJORA[tema], i), tel(rota(MIXTAS_CIERRE, i))].join(' ');
  }
  const tema = a.temas.find((x) => FRASES_TEMA[x]);
  const conTexto = Boolean(String(resena.texto || '').trim());
  const medio = tema ? rota(FRASES_TEMA[tema], i) : conTexto ? rota(FRASES_GENERALES, i) : null;
  return [conNombre(rota(APERTURAS, i), n), medio, rota(CIERRES, i)].filter(Boolean).join(' ');
}

// Huella de una respuesta sin el nombre de quien la escribió: dos con la misma huella son iguales
// para Google (motivo de rechazo REPETITIVE).
function huella(texto) {
  return normalizar(String(texto || '').replace(/^Hola [^\s,]+,/, 'Hola,').replace(/, \p{L}+(?=[.!])/gu, ''))
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Borrador de respuesta: breve, variado, en neutro, sin datos de salud ni del equipo. Lo aprueba una
 * persona antes de publicarlo.
 * @param {object} o { indice (para variar), telefono (el de la ficha), recientes (textos de otras
 *                   respuestas: nunca sale una igual) }
 */
function borradorRespuesta(resena, { indice = 0, telefono = TELEFONO, recientes = [] } = {}) {
  const a = analizar(resena);
  const n = primerNombre(resena.autor);
  const usadas = new Set(recientes.filter(Boolean).map(huella));
  let texto = '';
  for (let k = 0; k < 48; k++) {
    texto = componer(resena, a, { n, i: indice + k, telefono });
    if (!usadas.has(huella(texto))) break;
  }
  const legal = revisar(texto, { tipo: 'conversacion' });
  return { texto, analisis: a, requiereAprobacion: true, avisos: legal.avisos, ok: legal.ok };
}

const FECHAS = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ayer|anteayer|semana pasada|mes pasado)\b|\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/;
const CONFIRMA_PACIENTE = /\b(pacientes?|tus? (proxim[ao]s? |ultim[ao]s? |primer[ao]? )?(cita|citas|sesion|sesiones|consulta|visita|visitas|intervencion|operacion|diagnostico|historial|historia clinica|revision)|te (atendimos|atendio|atendieron|tratamos|operamos|pinchamos|hicimos)|cuando (viniste|estuviste))\b/;
const LO_DICE_QUIEN_ESCRIBE = /\b(mi (cita|tratamiento|sesion|consulta|visita|operacion|intervencion|revision|primera)|fui|vine|he ido|he venido|acudi|me (atendio|atendieron|hicieron|hice|trataron|pusieron|opere|operaron|realice|realizaron)|estuve (en|alli|ahi))\b/;
const TRATAMIENTOS_GENERICOS = [
  'tratamiento', 'tratamientos', 'sesion', 'sesiones', 'intervencion', 'operacion', 'cirugia', 'toxina', 'botox', 'relleno', 'rellenos',
  'acido hialuronico', 'hialuronico', 'injerto', 'laser', 'hifu', 'peeling', 'mesoterapia', 'depilacion', 'liposuccion', 'lipo',
  'micropigmentacion', 'labios', 'ojeras', 'arrugas', 'papada', 'calvicie', 'alopecia', 'caida del pelo', 'caida del cabello',
  'celulitis', 'flacidez', 'manchas', 'acne',
];
const SALUD = /\b(infeccion|quemadura|complicacion|necrosis|cicatriz|inflamacion|hematoma|efectos? secundarios?|reaccion|alergia|diagnostico|medicacion|embarazo|dolor)\b/;
const ENLACES = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|es|net|org|info)\b|@)/;
const PROMOCION = /(\d+ ?%|descuento|oferta|promo|promocion|rebaja|gratis|regalo|2x1|3x2|precio especial|sorteo|cupon|\bbono\b|\b\d+ ?(€|eur|euros)\b)/;
const CON_GENERO = /\b(atendid[oa]s?|content[oa]s?|encantad[oa]s?|satisfech[oa]s?|bienvenid[oa]s?|acompanad[oa]s?|tranquil[oa]s?)\b/;

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const digitos = (s) => String(s || '').replace(/\D/g, '');
// Lo encontrado (normalizado: «sesion») tal y como está escrito en el texto («sesión»).
function comoEnElTexto(bruto, buscado) {
  const palabras = String(bruto).match(/[\p{L}\p{N}]+/gu) || [];
  const n = buscado.split(' ').length;
  for (let i = 0; i + n <= palabras.length; i++) {
    const trozo = palabras.slice(i, i + n).join(' ');
    if (normalizar(trozo) === buscado) return trozo;
  }
  return buscado;
}

/**
 * Antes de publicar una respuesta (la del borrador o la que ha escrito una persona). Los errores
 * impiden publicarla; los avisos, no.
 * @param {object} c { resena: { nota, autor, texto }, tratamientos: nombres y alias del catálogo,
 *                     profesionales: nombres del equipo, telefono: el de la ficha, recientes: textos
 *                     de otras respuestas }
 * @returns {{ ok, errores: string[], avisos: string[] }}
 */
function revisarRespuesta(texto, { resena = {}, tratamientos = [], profesionales = [], telefono = TELEFONO, recientes = [] } = {}) {
  const errores = [];
  const avisos = [];
  const bruto = String(texto || '').trim();
  const t = normalizar(bruto);
  if (!bruto) return { ok: false, errores: ['No hay texto para responder.'], avisos };
  if (Buffer.byteLength(bruto, 'utf8') > 4096) errores.push('Es demasiado larga para Google (4.096 bytes como mucho).');
  else if (bruto.length > 700) avisos.push('Mejor más breve: unas pocas frases.');

  const nombres = [...new Set([...TRATAMIENTOS_GENERICOS, ...MEDICAMENTOS, ...MARCAS_SANITARIAS, ...tratamientos].map((x) => normalizar(x)).filter((x) => x.length >= 3))];
  const tratamiento = nombres.find((x) => new RegExp(`\\b${escapar(x)}\\b`).test(t));
  if (tratamiento) errores.push(`La respuesta nombra un tratamiento («${comoEnElTexto(bruto, tratamiento)}»): una reseña es pública y no puede llevar datos de salud.`);
  const salud = SALUD.exec(t);
  if (salud) errores.push(`Habla de salud («${comoEnElTexto(bruto, salud[1])}»): en público, ni un detalle; se habla en privado.`);

  const quien = normalizar(primerNombre(resena.autor));
  const equipo = nombresDelEquipo(profesionales);
  const nombrado = t.split(/[^a-z]+/).find((w) => w && w !== quien && equipo.has(w));
  if (TITULOS_EQUIPO.test(t) || nombrado) errores.push(`Nombra a alguien del equipo${nombrado ? ` («${comoEnElTexto(bruto, nombrado)}»)` : ''}: en una respuesta pública no se nombra a nadie.`);
  if (FECHAS.test(t)) errores.push('Lleva una fecha: en la respuesta no se dice cuándo vino nadie.');
  if (CONFIRMA_PACIENTE.test(t) && !LO_DICE_QUIEN_ESCRIBE.test(normalizar(resena.texto || ''))) {
    errores.push('Da a entender que es paciente y la reseña no lo dice: mejor en general («tu experiencia», «tu opinión»).');
  }
  if (ENLACES.test(t)) errores.push('Sin enlaces ni correos en la respuesta.');
  if (PROMOCION.test(t)) errores.push('Sin promociones, precios ni regalos en la respuesta.');

  const propio = digitos(telefono).slice(-9);
  const telefonos = (bruto.match(/\+?\d[\d\s.-]{7,}\d/g) || []).map(digitos).filter((d) => d.length >= 9);
  if (telefonos.some((d) => d.slice(-9) !== propio)) errores.push('Solo puede llevar el teléfono de la clínica.');
  if (Number(resena.nota) <= 2 && !telefonos.some((d) => d.slice(-9) === propio)) {
    errores.push(`En una reseña de 1 o 2 estrellas, invita a hablarlo en privado con el teléfono de la clínica (${telefonoLegible(telefono) || telefono}).`);
  }
  if (recientes.some((r) => r && huella(r) === huella(bruto))) {
    errores.push('Es igual que otra respuesta reciente: Google rechaza las repetidas. Cámbiala un poco.');
  }
  const genero = CON_GENERO.exec(t);
  if (genero) avisos.push(`«${comoEnElTexto(bruto, genero[1])}»: mejor en neutro («que el trato haya estado a la altura»).`);
  const legal = revisar(bruto, { tipo: 'conversacion' });
  errores.push(...legal.errores);
  return { ok: errores.length === 0, errores, avisos: [...avisos, ...legal.avisos] };
}

// ── Lo que llega de Google ──────────────────────────────────────────────────────────────────

const ESTRELLAS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const MODERACION = { PENDING: 'pendiente', PENDIENTE: 'pendiente', APPROVED: 'aprobada', APROBADA: 'aprobada', REJECTED: 'rechazada', RECHAZADA: 'rechazada' };

// reviewReplyState de Google (o ya en castellano) → 'pendiente' | 'aprobada' | 'rechazada' | null.
function estadoModeracion(v) {
  return MODERACION[String(v ?? '').trim().toUpperCase()] || null;
}

// policyViolation: el código del motivo (PERSONAL_INFO, REPETITIVE…), venga como texto o como objeto.
function motivoRechazo(v) {
  if (v == null || v === '') return null;
  const x = typeof v === 'object' ? (v.type ?? v.policyViolationType ?? v.tipo ?? v.reason ?? v.motivo ?? null) : v;
  return x == null ? 'desconocido' : String(x).slice(0, 60);
}

function fecha(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Una reseña tal como la da el adaptador de Google (o como la da la API: reviewId, starRating,
 * reviewer, comment, createTime, updateTime y reviewReply) → lo que guarda la app. Lo que no se
 * entiende (sin id, sin nota de 1 a 5 o sin fecha) se descarta (null).
 */
function normalizarResena(r) {
  if (!r || typeof r !== 'object') return null;
  const googleId = String(r.googleId ?? r.reviewId ?? r.name ?? '').trim();
  const nota = typeof r.nota === 'number' ? r.nota : ESTRELLAS[String(r.starRating ?? r.nota ?? '').toUpperCase()] ?? Number(r.nota);
  const publicadaEn = fecha(r.publicadaEn ?? r.createTime);
  if (!googleId || googleId.length > 160 || !Number.isInteger(nota) || nota < 1 || nota > 5 || !publicadaEn) return null;
  const rep = r.reviewReply && typeof r.reviewReply === 'object' ? r.reviewReply : {};
  const autor = r.autor !== undefined ? r.autor : r.reviewer?.isAnonymous ? null : r.reviewer?.displayName ?? null;
  const texto = r.texto !== undefined ? r.texto : r.comment ?? null;
  const respuesta = r.respuesta ?? rep.comment ?? null;
  return {
    googleId,
    nota,
    publicadaEn,
    actualizadaEn: fecha(r.actualizadaEn ?? r.updateTime),
    autor: autor && String(autor).trim() ? String(autor).trim().slice(0, 160) : null,
    texto: texto && String(texto).trim() ? String(texto).trim().slice(0, 10000) : null,
    respuesta: respuesta && String(respuesta).trim() ? String(respuesta).trim() : null,
    respondidaEn: fecha(r.respondidaEn ?? rep.updateTime),
    estadoRespuesta: estadoModeracion(r.estadoRespuesta ?? r.reviewReplyState ?? rep.reviewReplyState),
    motivoRechazo: motivoRechazo(r.motivoRechazo ?? r.policyViolation ?? rep.policyViolation),
  };
}

// ── Las cifras de la ficha (sección 16 del informe de Google) ───────────────────────────────

const si = (v) => v === true || v === 1 || v === '1';
const temasDe = (r) => {
  if (Array.isArray(r.temas)) return r.temas;
  if (typeof r.temas === 'string') { try { return JSON.parse(r.temas) || []; } catch { return []; } }
  return [];
};

function unirTramos(tramos) {
  const orden = tramos.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const salida = [];
  for (const [a, b] of orden) {
    const ultimo = salida.at(-1);
    if (ultimo && a <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], b);
    else salida.push([a, b]);
  }
  return salida;
}

const inicioSemana = (f) => T.sumarDias(f, 1 - T.diaSemana(f));

/**
 * Los KPI de la ficha: respuesta (tasa y tiempo), respuestas rechazadas por Google, conversión de las
 * peticiones, ritmo (14 y 90 días, por semana), nota de 90 días frente al total, temas del mes y la
 * prueba del momento de pedir.
 * @param {object} p { resenas: filas de resenas (nota, estado, con_texto, temas, publicada_en,
 *                     primera_respuesta_en, respuesta_estado, respuestas_rechazadas), peticiones:
 *                     filas de peticiones_resena (enviada_en, pulsada_en, variante,
 *                     recordatorio_enviado_en), ahora }
 */
function metricas({ resenas = [], peticiones = [], ahora = new Date() } = {}) {
  const ms = (d) => (d ? new Date(d).getTime() : NaN);
  const ya = new Date(ahora).getTime();
  const enLosUltimos = (d, dias) => ms(d) > ya - dias * DIA && ms(d) <= ya;
  const media = (lista) => (lista.length ? Math.round((lista.reduce((s, r) => s + Number(r.nota), 0) / lista.length) * 100) / 100 : null);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const mediana = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
  };
  // Contestada es con la respuesta publicada (la que Google rechaza no se ve: vuelve a la bandeja).
  const respondida = (r) => r.estado === 'publicada';
  // De la reseña a nuestra primera publicación (nuestra hora: el updateTime de Google cambia al editar).
  const horas = (lista) => mediana(lista.filter((r) => r.primera_respuesta_en)
    .map((r) => (ms(r.primera_respuesta_en) - ms(r.publicada_en)) / HORA).filter((h) => h >= 0));

  const r90 = resenas.filter((r) => enLosUltimos(r.publicada_en, 90));
  const conTexto90 = r90.filter((r) => si(r.con_texto));
  const nuestras = resenas.filter((r) => enLosUltimos(r.primera_respuesta_en, 90));
  const rechazadas = nuestras.filter((r) => Number(r.respuestas_rechazadas) > 0 || r.respuesta_estado === 'rechazada');

  // Peticiones → clics → reseñas nuevas en los 14 días siguientes a alguna petición. En total: no se
  // atribuye cada reseña a un paciente.
  const p90 = peticiones.filter((p) => enLosUltimos(p.enviada_en, 90));
  const trasRecordatorio = (p) => p.pulsada_en && p.recordatorio_enviado_en && ms(p.pulsada_en) >= ms(p.recordatorio_enviado_en);
  const tramos = unirTramos(p90.map((p) => [ms(p.enviada_en), Math.min(ms(p.enviada_en) + 14 * DIA, ya)]));
  const nuevas = resenas.filter((r) => tramos.some(([a, b]) => ms(r.publicada_en) >= a && ms(r.publicada_en) <= b)).length;

  // Ritmo: las últimas 12 semanas (de lunes a domingo, en Madrid); la última es la que va en curso.
  const semanas = Array.from({ length: 12 }, (_, k) => T.sumarDias(inicioSemana(T.fechaMadrid(new Date(ya))), -7 * (11 - k)));
  const porSemana = new Map(semanas.map((s) => [s, 0]));
  for (const r of resenas) {
    const s = Number.isNaN(ms(r.publicada_en)) ? null : inicioSemana(T.fechaMadrid(new Date(r.publicada_en)));
    if (porSemana.has(s) && ms(r.publicada_en) <= ya) porSemana.set(s, porSemana.get(s) + 1);
  }

  // Temas del mes: los últimos 30 días (el texto solo se guarda 30 días).
  const mes = resenas.filter((r) => enLosUltimos(r.publicada_en, 30));
  const conTextoMes = mes.filter((r) => si(r.con_texto) || temasDe(r).length);
  const temas = {};
  for (const r of mes) for (const t of temasDe(r)) temas[t] = (temas[t] || 0) + 1;

  return {
    total: resenas.length,
    notaTotal: media(resenas),
    nota90: media(r90),
    resenas90: r90.length,
    resenas14: resenas.filter((r) => enLosUltimos(r.publicada_en, 14)).length,
    porSemana: semanas.map((s) => ({ semana: s, resenas: porSemana.get(s) })),
    tasaRespuesta: pct(r90.filter(respondida).length, r90.length),
    tasaRespuestaConTexto: pct(conTexto90.filter(respondida).length, conTexto90.length),
    horasRespuesta: horas(r90),
    horasRespuestaNegativas: horas(r90.filter((r) => Number(r.nota) <= 2)),
    respuestas90: nuestras.length,
    rechazadas: rechazadas.length,
    tasaRechazo: pct(rechazadas.length, nuestras.length),
    peticiones: {
      enviadas: p90.length,
      abiertas: p90.filter((p) => p.pulsada_en).length,
      tasaApertura: pct(p90.filter((p) => p.pulsada_en).length, p90.length),
      recordatorios: p90.filter((p) => p.recordatorio_enviado_en).length,
      abiertasTrasRecordatorio: p90.filter(trasRecordatorio).length,
      resenasNuevas: nuevas,
      porCada100: p90.length ? Math.round((nuevas / p90.length) * 100) : null,
    },
    // La prueba del momento: lo que cuenta es el clic antes del recordatorio (el recordatorio es igual
    // para todos).
    variantes: VARIANTES.map((v) => {
      const de = p90.filter((p) => (p.variante || '2h') === v);
      const antes = de.filter((p) => p.pulsada_en && !trasRecordatorio(p)).length;
      return { variante: v, nombre: NOMBRE_VARIANTE[v], enviadas: de.length, abiertas: de.filter((p) => p.pulsada_en).length, abiertasAntes: antes, tasa: pct(antes, de.length) };
    }),
    resenasMes: mes.length,
    conTextoMes: conTextoMes.length,
    temasMes: Object.entries(temas).map(([tema, n]) => ({ tema, resenas: n, pct: pct(n, conTextoMes.length) }))
      .sort((a, b) => b.resenas - a.resenas || a.tema.localeCompare(b.tema)),
    // Por contestar: las recientes con borrador (el historial va aparte, poco a poco).
    porResponder: resenas.filter((r) => ['nueva', 'borrador'].includes(r.estado) && !si(r.historial)).length,
    enHistorial: resenas.filter((r) => r.estado === 'historial').length,
  };
}

module.exports = {
  REGLAS, VARIANTES, NOMBRE_VARIANTE, OTRA_EN_CAMINO, DE_BAJA, TELEFONO, TEMAS, ALERTAS_CLINICAS,
  motivoParaNoPedir, enHorarioDeEnvio, elegirVariante, pedirResena, momentoRecordatorio, limiteRecordatorio, motivoParaNoRecordar,
  enlaceResena, esEnlaceDeGoogle, enlaceParaResenar, revisarPeticion, nombresDelEquipo,
  analizar, sentimientoPorNota, primerNombre, huella, borradorRespuesta, revisarRespuesta,
  normalizarResena, estadoModeracion, metricas,
};
