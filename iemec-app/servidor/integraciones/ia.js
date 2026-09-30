'use strict';
// La IA de la repesca, detrás de un adaptador:
//   · simulado (por defecto): intérprete de reglas + textos fijos en la voz de la clínica. Nunca
//     sale nada a internet; es lo que usan las pruebas y la demo.
//   · real: Claude por un endpoint de la UE (Google Vertex AI, región «eu», por defecto; o la API de
//     Anthropic para desarrollo). Dos llamadas: una que ENTIENDE (salida JSON con esquema cerrado)
//     y otra que REDACTA el mensaje siguiendo la guía de motor/repesca/decidir.js.
// La IA nunca decide fechas ni ofertas: eso lo hace el código. Si la IA falla o se niega, se usa el
// intérprete de reglas y la conversación pasa a una persona.
const { interpretar } = require('../../motor/repesca/interpretar');

const INTENCIONES = ['aplazar', 'ocupado_ahora', 'precio', 'competencia_precio', 'pensar', 'duda_medica', 'salud_personal',
  'queja', 'ya_hecho', 'no_interesa', 'baja', 'reservar', 'evento', 'pregunta', 'preferencia_horario', 'acepta', 'otro'];
const PLAZOS = ['ninguno', 'hoy_tarde', 'manana', 'pasado_manana', 'dias', 'semanas', 'semana_siguiente', 'dia_semana', 'mes_siguiente',
  'meses', 'mes', 'fecha', 'tras_fecha', 'inicio_mes', 'fin_mes', 'cobro', 'tras_hito', 'vago'];

// Esquema cerrado (sin nulos: 0 y 'ninguno' significan «no aplica»).
const ESQUEMA_INTERPRETACION = {
  type: 'object',
  additionalProperties: false,
  required: ['intencion', 'plazo_tipo', 'n', 'dia', 'mes', 'dia_semana', 'hito', 'franja', 'urgente', 'frase_clave'],
  properties: {
    intencion: { type: 'string', enum: INTENCIONES },
    plazo_tipo: { type: 'string', enum: PLAZOS },
    n: { type: 'integer', description: 'cantidad para dias/semanas/meses; 0 si no aplica' },
    dia: { type: 'integer', description: 'día del mes 1-31 para fecha/tras_fecha/cobro; 0 si no aplica' },
    mes: { type: 'integer', description: 'mes 1-12 para mes/fecha/tras_fecha; 0 si no aplica' },
    dia_semana: { type: 'integer', description: '1=lunes … 7=domingo para dia_semana; 0 si no aplica' },
    hito: { type: 'string', enum: ['ninguno', 'verano', 'navidad', 'reyes', 'semana_santa', 'vacaciones', 'puente'] },
    franja: { type: 'string', enum: ['ninguna', 'manana', 'tarde'] },
    urgente: { type: 'boolean', description: 'true solo si parece una complicación de salud tras un tratamiento' },
    frase_clave: { type: 'string', description: 'las palabras exactas del paciente que justifican la decisión' },
  },
};

const SISTEMA_INTERPRETAR = `Eres el clasificador de respuestas de pacientes de IEMEC, una clínica de medicina estética y capilar en Boadilla del Monte (Madrid). Recibes lo último de una conversación de WhatsApp de repesca (leads, cancelaciones, presupuestos) y devuelves SOLO la clasificación con el esquema.

Intenciones:
- aplazar: pide que se le escriba o dar la cita más adelante (y el plazo dice cuándo).
- ocupado_ahora: ahora no puede hablar (trabajando, conduciendo…).
- precio: le parece caro o no se lo puede permitir. competencia_precio: lo compara con otro sitio más barato.
- pensar: lo tiene que pensar o consultar. duda_medica: duda general (dolor, miedo, riesgos, recuperación).
- salud_personal: cuenta algo de SU salud (embarazo, lactancia, medicación, alergias, enfermedades, operación) o una posible complicación (bulto, mucha hinchazón, dolor fuerte, fiebre): en ese caso urgente=true.
- queja, ya_hecho (ya se lo hizo en otro sitio), no_interesa, baja (no quiere más mensajes), reservar (quiere cita), evento (quiere estar bien para una fecha), pregunta, preferencia_horario, acepta, otro.

Plazos: la fecha NO la calculas tú; solo dices el tipo y los números que dijo el paciente.
- «el mes que viene» → mes_siguiente; «la semana que viene» → semana_siguiente; «en dos semanas» → semanas n=2; «en 10 días» → dias n=10.
- «en enero» → mes mes=1; «el 15» → fecha dia=15; «el 3 de noviembre» → fecha dia=3 mes=11; «vuelvo el 20» o «hasta el 20 estoy fuera» → tras_fecha dia=20.
- «después del verano / de Navidad / de Semana Santa» → tras_hito con su hito; «cuando cobre» → cobro (dia si lo dice).
- «esta tarde / luego» → hoy_tarde; «mañana» → manana; «el jueves» → dia_semana=4; «más adelante / ya te diré» → vago. Sin plazo → ninguno.
Si hay duda entre dos intenciones, elige la más prudente: salud y baja por encima de todo.`;

const SISTEMA_REDACTAR = `Escribes los mensajes de WhatsApp de IEMEC (Instituto Europeo de Medicina Estética y Capilar, Boadilla del Monte) en nombre de su asistente virtual.
Voz de la clínica: tú, cercana, elegante y breve (1 a 3 frases). Español de España. Como mucho un emoji y solo si encaja.
Reglas que no se rompen:
- Sigue la GUÍA que te da el sistema: ya está decidido qué hacer; tú solo lo dices bien.
- Usa solo los DATOS que te dan (fechas, horas, huecos, ofertas, respuestas aprobadas). No inventes precios, descuentos, huecos ni fechas.
- Nunca des consejo médico ni hables de dosis, productos o marcas. Nunca prometas resultados.
- No nombres medicamentos ni hagas promociones de ellos.
- Si es el primer mensaje de la IA en la conversación, di que eres el asistente virtual de IEMEC.
Devuelve solo el texto del mensaje.`;

// ── Modo simulado ────────────────────────────────────────────────────────────────────────────
function textoSimulado(decision, d = {}) {
  const nombre = d.nombre ? `, ${d.nombre}` : '';
  const presentacion = d.primerMensajeIa ? 'Soy el asistente virtual de IEMEC. ' : '';
  const huecos = d.huecosTexto || (d.huecos || []).map((h) => h.texto).join(', ');
  const tipos = new Set(decision.acciones.map((a) => a.tipo));
  const seg = decision.acciones.find((a) => a.tipo === 'programar_seguimiento');
  const oferta = decision.acciones.find((a) => a.tipo === 'ofrecer');
  let t;
  if (tipos.has('baja')) t = `Hecho${nombre}. No volverás a recibir mensajes nuestros. Si algún día nos necesitas, aquí estamos.`;
  else if (tipos.has('pasar_a_persona') && decision.acciones.find((a) => a.tipo === 'pasar_a_persona').urgente) {
    t = `Gracias por avisarnos${nombre}. Se lo paso ahora mismo al equipo médico y te contactan enseguida. Si empeora o te encuentras mal, acude a urgencias o llama al 112.`;
  } else if (tipos.has('pasar_a_persona')) t = `Gracias${nombre}. Lo revisa una persona del equipo y te contesta por aquí hoy mismo.`;
  else if (tipos.has('tarea_llamar')) t = `Te entiendo${nombre}. Para verlo con calma, alguien del equipo te llama y te cuenta las opciones, como hacerlo por fases o a plazos, sin compromiso.`;
  else if (tipos.has('cerrar') && decision.intencion === 'ya_hecho') t = `¡Qué bien${nombre}! Gracias por contárnoslo. Si no es indiscreción, ¿qué te hizo decidirte? Nos ayuda a mejorar.`;
  else if (tipos.has('cerrar')) t = `Gracias por decírnoslo${nombre}. Si en otro momento te apetece, aquí estaremos.`;
  else if (oferta) t = `Te entiendo${nombre}. ${d.ofertaTexto || 'Tenemos una opción que puede encajarte.'} ¿Te encaja así?`;
  else if (tipos.has('preguntar_cuando')) t = `Sin problema${nombre}. ¿Cuándo te vendría mejor que te escribamos?`;
  else if (decision.intencion === 'ocupado_ahora' && seg) t = `Sin problema${nombre}, te escribo ${seg.texto}.`;
  else if (decision.intencion === 'aplazar' && tipos.has('proponer_huecos') && seg && huecos) t = `¡Claro${nombre}! Si quieres, te dejo ya guardado un hueco: ${huecos}. Si prefieres esperar, te escribo ${seg.texto}.`;
  else if (seg && decision.intencion === 'aplazar') t = `Perfecto${nombre}. Te escribo ${seg.texto} y lo vemos con calma.`;
  else if (tipos.has('proponer_huecos') && huecos) t = `¡Genial${nombre}! Tengo estos huecos para ti: ${huecos}. ¿Cuál te viene mejor?`;
  else if (tipos.has('proponer_huecos')) t = `Ahora mismo no veo huecos en esas fechas${nombre}; una persona del equipo te propone alternativas.`;
  else if (decision.intencion === 'pensar') t = `Claro${nombre}, tómate tu tiempo. ¿Hay algo que te frene o que quieras que te aclare?${seg ? ` Si te parece, te escribo ${seg.texto}.` : ''}`;
  else if (d.respuestaAprobada) t = `${d.respuestaAprobada} Si quieres, lo vemos en una valoración con el equipo médico.`;
  else t = `Gracias${nombre}. ¿Cuándo te vendría mejor que te escribamos?`;
  return presentacion + t;
}

function crearSimulada() {
  return {
    modo: 'simulado',
    async interpretar({ texto }) { return { ...interpretar(texto), fuente: 'reglas' }; },
    async redactar({ decision, datos }) { return textoSimulado(decision, datos); },
  };
}

// ── Modo real: Claude ────────────────────────────────────────────────────────────────────────
function crearCliente(env) {
  const { betaRefusalFallbackMiddleware } = require('@anthropic-ai/sdk');
  // Si el modelo principal se niega, se reintenta con el de respaldo (en Vertex no hay respaldo en
  // el servidor: lo hace el SDK en el cliente). Los modelos se eligen en la configuración, no aquí.
  const middleware = env.IA_MODELO_RESPALDO ? [betaRefusalFallbackMiddleware([{ model: env.IA_MODELO_RESPALDO }])] : [];
  const proveedor = env.IA_PROVEEDOR || 'vertex';
  if (proveedor === 'vertex') {
    const { AnthropicVertex } = require('@anthropic-ai/vertex-sdk');
    return new AnthropicVertex({ projectId: env.IA_PROYECTO_GCP, region: env.IA_REGION || 'eu', middleware });
  }
  if (proveedor === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk');
    return new Anthropic({ middleware });
  }
  throw new Error(`Proveedor de IA no soportado: ${proveedor} (vertex | anthropic)`);
}

function aInterpretacion(j) {
  const plazo = j.plazo_tipo === 'ninguno' ? null : { tipo: j.plazo_tipo };
  if (plazo) {
    if (j.n) plazo.n = j.n;
    if (j.dia) plazo.dia = j.dia;
    if (j.mes) plazo.mes = j.mes;
    if (j.dia_semana) plazo.dia = plazo.tipo === 'dia_semana' ? j.dia_semana : plazo.dia;
    if (j.hito && j.hito !== 'ninguno') plazo.hito = j.hito;
  }
  return { intencion: j.intencion, plazo, franja: j.franja === 'ninguna' ? null : j.franja, urgente: Boolean(j.urgente), fraseClave: j.frase_clave };
}

function historialComoTexto(historial = []) {
  return historial.slice(-8).map((m) => `${m.autor === 'paciente' ? 'Paciente' : 'Clínica'}: ${m.texto}`).join('\n');
}

function crearReal(env = process.env) {
  // Puerta ⛔: el modelo lo fija la configuración (IA_MODELO), con su respaldo (IA_MODELO_RESPALDO).
  if (!env.IA_MODELO) throw new Error('IA real: falta IA_MODELO en la configuración');
  const cliente = crearCliente(env);
  const modelo = env.IA_MODELO;
  return {
    modo: 'real',
    async interpretar({ texto, historial, contexto = {} }) {
      const r = await cliente.beta.messages.create({
        model: modelo,
        max_tokens: 4000,
        cache_control: { type: 'ephemeral' },
        system: SISTEMA_INTERPRETAR,
        output_config: { effort: env.IA_ESFUERZO_INTERPRETAR || 'low', format: { type: 'json_schema', schema: ESQUEMA_INTERPRETACION } },
        messages: [{ role: 'user', content: `Contexto: ${contexto.tipo || 'general'}${contexto.tratamiento ? `, tratamiento ${contexto.tratamiento}` : ''}.\n\nConversación:\n${historialComoTexto(historial)}\n\nÚltimo mensaje del paciente:\n${texto}` }],
      });
      if (r.stop_reason === 'refusal') return null;
      const bloque = r.content.find((b) => b.type === 'text');
      if (!bloque) return null;
      return { ...aInterpretacion(JSON.parse(bloque.text)), fuente: 'ia' };
    },
    async redactar({ decision, datos, historial }) {
      const r = await cliente.beta.messages.create({
        model: modelo,
        max_tokens: 4000,
        cache_control: { type: 'ephemeral' },
        system: SISTEMA_REDACTAR,
        output_config: { effort: env.IA_ESFUERZO_REDACTAR || 'medium' },
        messages: [{ role: 'user', content: `GUÍA: ${decision.guia}\n\nDATOS: ${JSON.stringify(datos)}\n\nConversación:\n${historialComoTexto(historial)}` }],
      });
      if (r.stop_reason === 'refusal') return null;
      return r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim() || null;
    },
  };
}

// Junta lo que dice la IA con el intérprete de reglas. Las reglas mandan en seguridad (bajas y
// salud); si los dos ven plazos distintos, se pregunta al paciente en vez de adivinar.
function combinar(reglas, ia) {
  if (!ia) return { ...reglas, fuente: 'reglas', aviso: 'sin IA' };
  if (['baja', 'salud_personal'].includes(reglas.intencion)) return { ...reglas, fuente: 'reglas' };
  if (['baja', 'salud_personal'].includes(ia.intencion)) return { ...ia, fuente: 'ia' };
  if (reglas.plazo && ia.plazo && reglas.plazo.tipo !== ia.plazo.tipo && ia.intencion === 'aplazar') {
    return { intencion: 'aplazar', plazo: { tipo: 'vago' }, franja: ia.franja, urgente: false, fuente: 'conflicto', aviso: `reglas: ${reglas.plazo.tipo} · ia: ${ia.plazo.tipo}` };
  }
  return { ...ia, fuente: 'ia' };
}

function crearIa(modo = 'simulado', env = process.env) {
  return modo === 'real' ? crearReal(env) : crearSimulada();
}

module.exports = { crearIa, combinar, textoSimulado, ESQUEMA_INTERPRETACION, SISTEMA_INTERPRETAR, SISTEMA_REDACTAR };
