'use strict';
// Motor de reseñas de Google: a quién y cuándo pedir la opinión, de qué hablan las reseñas, cómo
// se responden y qué cifras mira la clínica.
//
// Normas que se cumplen siempre:
//   · Se pide a TODOS los pacientes atendidos, sin filtrar por si están contentos («review gating»
//     está prohibido por Google) y sin dar nada a cambio.
//   · La respuesta nunca confirma que quien escribe es paciente ni nombra tratamientos: una reseña
//     es pública y eso son datos de salud. Las respuestas las aprueba una persona.
const T = require('../tiempo');
const { normalizar } = require('../repesca/interpretar');
const { revisar } = require('../repesca/filtro-legal');

const REGLAS = { horasTrasCita: 2, diasEntrePeticiones: 120, horaDesde: '10:30', horaHasta: '20:00' };

/**
 * ¿Se le pide la reseña a este paciente tras esta cita? ¿Cuándo?
 * @param {object} p { cita: { estado, fin }, paciente: { baja_comercial_en }, ultimaPeticion: Date|null,
 *                     yaResenoEnGoogle: bool, conversacionAbiertaConQueja: bool }
 */
function pedirResena(p, calendario, reglas = REGLAS) {
  if (p.cita.estado !== 'completada') return { pedir: false, motivo: 'la cita no se ha completado' };
  if (p.paciente?.baja_comercial_en) return { pedir: false, motivo: 'se dio de baja de los mensajes' };
  if (p.yaResenoEnGoogle) return { pedir: false, motivo: 'ya dejó una reseña' };
  if (p.conversacionAbiertaConQueja) return { pedir: false, motivo: 'tiene una queja abierta: primero se atiende' };
  if (p.ultimaPeticion && (new Date(p.cita.fin) - new Date(p.ultimaPeticion)) / 86400000 < reglas.diasEntrePeticiones) {
    return { pedir: false, motivo: 'ya se le pidió hace poco' };
  }
  // Dos horas después de acabar, dentro del horario de envío; si no, el siguiente día que abre.
  let cuando = new Date(new Date(p.cita.fin).getTime() + reglas.horasTrasCita * 3600000);
  const parte = T.partesMadrid(cuando);
  const desde = T.minutosDe(reglas.horaDesde);
  const hasta = T.minutosDe(reglas.horaHasta);
  if (parte.minutos >= hasta || !calendario.abre(parte.fecha)) {
    cuando = T.desdeMadrid(calendario.siguienteLaborable(parte.fecha, { incluida: false }), reglas.horaDesde);
  } else if (parte.minutos < desde) {
    cuando = T.desdeMadrid(parte.fecha, reglas.horaDesde);
  }
  return { pedir: true, cuando };
}

// Enlace directo para escribir la reseña en Google (se abre la ficha con el formulario).
function enlaceResena(placeId) {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

const TEMAS = {
  trato: /(trato|amable|cercan|carino|atent|simpatic|encantador|agradable|profesionales? (y|muy))/,
  profesionalidad: /(profesional|confianza|expert|conocimiento|explica|explicacion|asesor|honest)/,
  resultados: /(resultado|natural|contenta|contento|encantada|encantado|mejora|se nota|rejuvenec|pelo|cabello|piel)/,
  instalaciones: /(instalacion|clinica (preciosa|bonita|muy bonita|impecable)|limpi|decoracion|bonit|acogedor|elegante)/,
  precio: /(\bprecios?\b|\bcar[oa]s?\b|carisim|barat|\bcoste|relacion calidad|presupuesto)/,
  espera_puntualidad: /(espera|esperar|puntual|retraso|tarde|cita a la hora|hora de retraso)/,
  dolor_comodidad: /(dolor|duele|molest|indoloro|no note nada|comod)/,
  atencion_recepcion: /(recepcion|telefono|whatsapp|contestan|no cogen|no contestan|cita (online|facil))/,
};
const NEGATIVO = /(\bmal\b|fatal|horrible|pesim|nunca mas|no volvere|no lo recomiendo|decepcion|estafa|timo|no contestan|no cogen|caro|carisim|retraso|queja|desastre|peor)/;
const POSITIVO = /(genial|excelente|perfect|encantad|recomiendo|maravill|estupend|fenomenal|increible|contenta|contento|10|gracias)/;

function analizar(resena) {
  const t = normalizar(resena.texto || '');
  const temas = Object.entries(TEMAS).filter(([, rx]) => rx.test(t)).map(([k]) => k);
  let sentimiento = resena.nota >= 4 ? 'positivo' : resena.nota <= 2 ? 'negativo' : 'mixto';
  if (resena.nota >= 4 && NEGATIVO.test(t) && !POSITIVO.test(t)) sentimiento = 'mixto';
  if (resena.nota === 3 && POSITIVO.test(t) && !NEGATIVO.test(t)) sentimiento = 'positivo';
  const prioridad = resena.nota <= 2 ? 'alta' : resena.nota === 3 || sentimiento === 'mixto' ? 'media' : 'normal';
  return { temas, sentimiento, prioridad };
}

const APERTURAS_POSITIVAS = ['¡Muchísimas gracias, {n}!', 'Gracias de corazón, {n}.', '¡Qué alegría leerte, {n}!', 'Mil gracias por tus palabras, {n}.'];
const FRASE_TEMA = {
  trato: 'Nos encanta que te hayas sentido tan bien atendida por el equipo.',
  profesionalidad: 'Poner cada detalle en manos de profesionales es lo que más cuidamos.',
  resultados: 'Que te veas y te sientas bien es exactamente lo que buscamos.',
  instalaciones: 'Cuidamos la clínica para que cada visita sea un momento para ti.',
  dolor_comodidad: 'Tu comodidad durante la visita es una prioridad para nosotros.',
  atencion_recepcion: 'Se lo haremos saber al equipo de recepción, que lo agradecerá mucho.',
};
const CIERRES_POSITIVOS = ['Te esperamos en IEMEC cuando quieras.', 'Un abrazo de todo el equipo de IEMEC.', 'Aquí estaremos siempre que nos necesites.'];

function primerNombre(autor = '') {
  const n = String(autor).trim().split(/\s+/)[0] || '';
  return /^[A-Za-zÁÉÍÓÚÑáéíóúñü]{2,}$/.test(n) ? n : '';
}

// Borrador de respuesta: variado, sin datos de salud y sin nombrar tratamientos. Lo aprueba una
// persona antes de publicarlo.
function borradorRespuesta(resena, { indice = 0, telefono = '722 83 32 85' } = {}) {
  const a = analizar(resena);
  const n = primerNombre(resena.autor);
  const conNombre = (s) => s.replace(', {n}', n ? `, ${n}` : '').replace('{n}', n);
  let texto;
  if (a.sentimiento === 'negativo' || resena.nota <= 2) {
    texto = `${n ? `Hola ${n}, ` : 'Hola, '}sentimos mucho que tu experiencia no haya sido la que esperabas. Nos gustaría entender qué ha pasado y ayudarte: escríbenos o llámanos al ${telefono} y lo vemos con calma, en privado. Gracias por contárnoslo.`;
  } else if (a.sentimiento === 'mixto') {
    const mejora = a.temas.includes('espera_puntualidad') ? 'Tomamos nota de lo que nos cuentas sobre los tiempos de espera para mejorarlo.'
      : a.temas.includes('precio') ? 'Entendemos lo que comentas y queremos que siempre tengas claras todas las opciones.'
        : 'Tomamos nota de lo que nos cuentas para seguir mejorando.';
    texto = `${conNombre('Gracias por tu opinión, {n}.')} ${mejora} Si quieres comentarlo con nosotros, estamos en el ${telefono}.`;
  } else {
    const tema = a.temas.find((x) => FRASE_TEMA[x]);
    texto = [conNombre(APERTURAS_POSITIVAS[indice % APERTURAS_POSITIVAS.length]), tema ? FRASE_TEMA[tema] : 'Nos alegra muchísimo que te haya gustado tu experiencia.', CIERRES_POSITIVOS[indice % CIERRES_POSITIVOS.length]].join(' ');
  }
  const legal = revisar(texto, { tipo: 'conversacion' });
  return { texto, analisis: a, requiereAprobacion: true, avisos: legal.avisos, ok: legal.ok };
}

// Cifras de la ficha: nota media, ritmo, respuesta y conversión de peticiones en reseñas.
function metricas({ resenas = [], peticiones = [], desde, hasta }) {
  const enRango = (d) => (!desde || new Date(d) >= new Date(desde)) && (!hasta || new Date(d) < new Date(hasta));
  const del = resenas.filter((r) => enRango(r.publicada_en));
  const nota = (lista) => (lista.length ? Math.round((lista.reduce((s, r) => s + r.nota, 0) / lista.length) * 100) / 100 : null);
  const respondidas = del.filter((r) => r.respondida_en);
  const horas = respondidas.map((r) => (new Date(r.respondida_en) - new Date(r.publicada_en)) / 3600000).sort((a, b) => a - b);
  const pet = peticiones.filter((p) => enRango(p.enviada_en));
  const conResena = pet.filter((p) => p.resena_id).length;
  const temas = {};
  for (const r of del) for (const t of analizar(r).temas) temas[t] = (temas[t] || 0) + 1;
  return {
    resenas: del.length,
    notaMedia: nota(del),
    notaMediaTotal: nota(resenas),
    porNota: [5, 4, 3, 2, 1].map((n) => ({ nota: n, cuantas: del.filter((r) => r.nota === n).length })),
    tasaRespuesta: del.length ? Math.round((respondidas.length / del.length) * 100) : null,
    horasMedianaRespuesta: horas.length ? Math.round(horas[Math.floor(horas.length / 2)] * 10) / 10 : null,
    peticiones: pet.length,
    pulsadas: pet.filter((p) => p.pulsada_en).length,
    conversion: pet.length ? Math.round((conResena / pet.length) * 100) : null,
    temas,
    sinResponder: resenas.filter((r) => !r.respondida_en).length,
  };
}

module.exports = { pedirResena, enlaceResena, analizar, borradorRespuesta, metricas, REGLAS };
