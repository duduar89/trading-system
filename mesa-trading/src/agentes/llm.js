'use strict';
// Cliente de LLM de la mesa (§6.3). El LLM solo redacta, elige de una lista o
// clasifica: siempre devuelve JSON, que se valida aquí contra un esquema. Si
// algo falla (sin clave, sin presupuesto, rechazo, error, esquema), devuelve
// { ok: false, motivo } y quien llama aplica su plan por defecto: el trading
// nunca se para por el LLM.

const Anthropic = require('@anthropic-ai/sdk');
const { anadirJSONL, leerJSONL } = require('../util/almacen');
const { RelojReal, diaUTC } = require('../util/reloj');
const log = require('../util/log').crear('llm');

// Modelos con salvavidas del servidor: si su clasificador rechaza, la API
// reintenta sola en el modelo que recomienda para esa categoría.
const MODELOS_BETA = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';
const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max'];
const ESFUERZO_POR_DEFECTO = { comite: 'medium', agentes: 'low' };
const MOTIVOS = ['sin_clave', 'presupuesto', 'rechazo', 'error', 'esquema'];

// $ por millón de tokens: entrada, salida, lectura de caché, escritura de caché (§6.3).
const TARIFAS = Object.freeze({
  'claude-opus-5-5': Object.freeze({ entrada: 4, salida: 20, cacheLectura: 0.20, cacheEscritura: 5 }),
  'claude-sonnet-5-5': Object.freeze({ entrada: 2, salida: 10, cacheLectura: 0.20, cacheEscritura: 2.5 }),
  'claude-haiku-4-5': Object.freeze({ entrada: 1, salida: 5, cacheLectura: 0.10, cacheEscritura: 1.25 }),
  'claude-opus-5': Object.freeze({ entrada: 5, salida: 25, cacheLectura: 0.50, cacheEscritura: 6.25 }),
  'claude-fable-5-1': Object.freeze({ entrada: 10, salida: 50, cacheLectura: 0.25, cacheEscritura: 12.5 }),
  // Destino habitual del salvavidas del servidor (rechazos de categoría cyber):
  // su intento se cobra a su tarifa y llega en usage.iterations.
  'claude-opus-4-8': Object.freeze({ entrada: 5, salida: 25, cacheLectura: 0.50, cacheEscritura: 6.25 }),
});
// Modelo que no está en la tabla: se cobra a la tarifa más cara, para que el
// tope diario nunca se quede corto por un modelo nuevo puesto en el .env.
const TARIFA_DESCONOCIDA = TARIFAS['claude-fable-5-1'];

const CARACTERES_POR_TOKEN = 3;   // estimación prudente (§6.3): sobreestima tokens en español

function tarifaDe(modelo) {
  const m = String(modelo || '');
  if (TARIFAS[m]) return { tarifa: TARIFAS[m], conocida: true };
  // Prefijo más largo: 'claude-opus-5-5-xxx' es opus-5-5, no opus-5.
  const clave = Object.keys(TARIFAS).filter(k => m.startsWith(k + '-')).sort((a, b) => b.length - a.length)[0];
  return clave ? { tarifa: TARIFAS[clave], conocida: true } : { tarifa: TARIFA_DESCONOCIDA, conocida: false };
}

const n0 = x => (Number.isFinite(x) ? x : 0);

function costeTokens(t, modelo) {
  const { tarifa } = tarifaDe(modelo);
  return (n0(t.entrada) * tarifa.entrada + n0(t.salida) * tarifa.salida
    + n0(t.cacheLectura) * tarifa.cacheLectura + n0(t.cacheEscritura) * tarifa.cacheEscritura) / 1e6;
}

// Coste de una respuesta. Con salvavidas, usage.iterations trae un tramo por
// intento (cada uno a la tarifa de su modelo) y el usage de arriba solo cubre
// el último: se suman los tramos.
function costeDeUso(usage, modelo) {
  const tokens = { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 };
  if (!usage) return { costeUsd: 0, tokens };
  const tramos = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : [usage];
  let costeUsd = 0;
  for (const u of tramos) {
    const t = {
      entrada: n0(u.input_tokens),
      salida: n0(u.output_tokens),
      cacheLectura: n0(u.cache_read_input_tokens),
      cacheEscritura: n0(u.cache_creation_input_tokens),
    };
    costeUsd += costeTokens(t, u.model || modelo);
    for (const k of Object.keys(tokens)) tokens[k] += t[k];
  }
  return { costeUsd, tokens };
}

// ---------- Esquemas ----------

const TIPO_DE = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
};

function tipoCuadra(v, tipo) {
  if (tipo === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (tipo === 'integer') return Number.isInteger(v);
  if (tipo === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  if (tipo === 'array') return Array.isArray(v);
  if (tipo === 'null') return v === null;
  return typeof v === tipo;
}

// Validador mínimo propio (tipos, required, enum, additionalProperties, items,
// anyOf, const y rangos). Devuelve la lista de errores; vacía = válido.
function validarEsquema(valor, esquema, ruta = '$', errores = []) {
  if (!esquema || typeof esquema !== 'object') return errores;
  if (Array.isArray(esquema.anyOf)) {
    const ok = esquema.anyOf.some(s => validarEsquema(valor, s, ruta, []).length === 0);
    if (!ok) errores.push(`${ruta}: no cumple ninguna de las opciones`);
    return errores;
  }
  if (esquema.type !== undefined) {
    const tipos = Array.isArray(esquema.type) ? esquema.type : [esquema.type];
    if (!tipos.some(t => tipoCuadra(valor, t))) {
      errores.push(`${ruta}: se esperaba ${tipos.join('|')} y llegó ${TIPO_DE(valor)}`);
      return errores;
    }
  }
  if ('const' in esquema && valor !== esquema.const) errores.push(`${ruta}: debe ser ${JSON.stringify(esquema.const)}`);
  if (Array.isArray(esquema.enum) && !esquema.enum.some(e => e === valor)) {
    errores.push(`${ruta}: ${JSON.stringify(valor)} no está en la lista cerrada`);
  }
  if (typeof valor === 'number') {
    if (Number.isFinite(esquema.minimum) && valor < esquema.minimum) errores.push(`${ruta}: menor que ${esquema.minimum}`);
    if (Number.isFinite(esquema.maximum) && valor > esquema.maximum) errores.push(`${ruta}: mayor que ${esquema.maximum}`);
  }
  if (typeof valor === 'string') {
    if (Number.isFinite(esquema.minLength) && valor.length < esquema.minLength) errores.push(`${ruta}: texto demasiado corto`);
    if (Number.isFinite(esquema.maxLength) && valor.length > esquema.maxLength) errores.push(`${ruta}: texto de más de ${esquema.maxLength} caracteres`);
  }
  if (Array.isArray(valor)) {
    if (Number.isFinite(esquema.minItems) && valor.length < esquema.minItems) errores.push(`${ruta}: menos de ${esquema.minItems} elementos`);
    if (Number.isFinite(esquema.maxItems) && valor.length > esquema.maxItems) errores.push(`${ruta}: más de ${esquema.maxItems} elementos`);
    if (esquema.items) valor.forEach((v, i) => validarEsquema(v, esquema.items, `${ruta}[${i}]`, errores));
  }
  if (tipoCuadra(valor, 'object')) {
    const props = esquema.properties || {};
    for (const r of esquema.required || []) {
      if (!(r in valor)) errores.push(`${ruta}: falta «${r}»`);
    }
    for (const [k, v] of Object.entries(valor)) {
      if (props[k]) validarEsquema(v, props[k], `${ruta}.${k}`, errores);
      else if (esquema.additionalProperties === false) errores.push(`${ruta}: sobra «${k}»`);
      else if (esquema.additionalProperties && typeof esquema.additionalProperties === 'object') {
        validarEsquema(v, esquema.additionalProperties, `${ruta}.${k}`, errores);
      }
    }
  }
  return errores;
}

// La API de salidas estructuradas no admite rangos ni longitudes y exige
// additionalProperties: false en cada objeto. Se quitan en lo que se envía y
// se siguen comprobando aquí, en local.
const NO_SOPORTADAS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'maxItems', 'uniqueItems', 'pattern'];

function esquemaParaApi(esquema) {
  if (Array.isArray(esquema)) return esquema.map(esquemaParaApi);
  if (!esquema || typeof esquema !== 'object') return esquema;
  const out = {};
  for (const [k, v] of Object.entries(esquema)) {
    if (NO_SOPORTADAS.includes(k)) continue;
    if (k === 'minItems' && v > 1) continue;
    if (k === 'properties') {
      out.properties = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, esquemaParaApi(s)]));
    } else if (k === 'additionalProperties') {
      out.additionalProperties = false;
    } else if (k === 'enum' || k === 'const' || k === 'required') {
      out[k] = v;
    } else {
      out[k] = esquemaParaApi(v);
    }
  }
  const esObjeto = out.type === 'object' || (Array.isArray(out.type) && out.type.includes('object')) || out.properties;
  if (esObjeto) out.additionalProperties = false;
  return out;
}

// ---------- Petición ----------

function usaBeta(modelo) { return MODELOS_BETA.has(modelo); }

// Forma exacta de la petición por modelo (§6.3). Sin thinking ni temperature:
// en Opus 5.5 el razonamiento no se puede apagar y se gobierna con effort.
function construirPeticion({ modelo, maxTokens, esfuerzo, sistema, contenido, esquema }) {
  const format = { type: 'json_schema', schema: esquemaParaApi(esquema) };
  const system = [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }];
  const messages = [{ role: 'user', content: contenido }];
  if (usaBeta(modelo)) {
    return {
      via: 'beta',
      cuerpo: {
        model: modelo,
        max_tokens: maxTokens,
        betas: [BETA_FALLBACK],
        fallbacks: 'default',
        output_config: { effort: esfuerzo, format },
        system,
        messages,
      },
    };
  }
  // Haiku 4.5 y el resto: sin effort (Haiku lo rechaza) ni salvavidas.
  return { via: 'estable', cuerpo: { model: modelo, max_tokens: maxTokens, output_config: { format }, system, messages } };
}

function componerContenido(instrucciones, entrada) {
  const datos = JSON.stringify(entrada ?? null);
  const inst = String(instrucciones || '').trim();
  return inst ? `${inst}\n\nDatos (JSON):\n${datos}` : `Datos (JSON):\n${datos}`;
}

// Máximo que puede costar una llamada antes de hacerla: ≈ caracteres/3 de
// entrada a precio de entrada + maxTokens a precio de salida (§6.3).
function estimarCosteMaximo({ modelo, sistema, contenido, esquema, maxTokens }) {
  const caracteres = String(sistema || '').length + String(contenido || '').length + JSON.stringify(esquema || {}).length;
  const { tarifa } = tarifaDe(modelo);
  return (Math.ceil(caracteres / CARACTERES_POR_TOKEN) * tarifa.entrada + maxTokens * tarifa.salida) / 1e6;
}

const SISTEMA_POR_DEFECTO = 'Eres un agente de una mesa de trading en papel. Respondes solo con el JSON pedido, en español.';

function crearLLM({
  apiKey = '', modeloComite = 'claude-opus-5-5', modeloAgentes = 'claude-opus-5-5', presupuestoDiaUsd = 2,
  reloj = new RelojReal(), rutaCostes = null, cliente = null, fetch = undefined,
} = {}) {
  const hayClave = Boolean(apiKey) || Boolean(cliente);
  let desactivadoPor401 = false;
  let api = cliente;
  if (!api && apiKey) {
    const opciones = { apiKey, timeout: 60000, maxRetries: 2 };
    if (fetch) opciones.fetch = fetch;
    api = new Anthropic(opciones);
  }

  const modelos = { comite: modeloComite, agentes: modeloAgentes };
  let presupuesto = Number.isFinite(presupuestoDiaUsd) && presupuestoDiaUsd >= 0 ? presupuestoDiaUsd : 0;
  let ultimoError = null;
  let reservado = 0;   // llamadas en vuelo: cuentan contra el tope para que dos a la vez no lo rebasen

  // El dinero es real aunque el reloj sea el acelerado de la demo: con reloj
  // simulado, el día del presupuesto es el día real (si no, se reiniciaría
  // cada pocos minutos).
  const ahoraGasto = () => (reloj && reloj.tipo !== 'simulado' && typeof reloj.ahora === 'function' ? reloj.ahora() : Date.now());

  const cuenta = { dia: diaUTC(ahoraGasto()), gastoUsd: 0, llamadas: 0 };
  // Tras un reinicio, el gasto del día sale del registro: si no, cada arranque
  // regalaría otro presupuesto entero.
  if (rutaCostes) {
    try {
      for (const r of leerJSONL(rutaCostes, 5000)) {
        if (r && Number.isFinite(r.t) && diaUTC(r.t) === cuenta.dia) {
          cuenta.gastoUsd += n0(r.costeUsd);
          cuenta.llamadas += 1;
        }
      }
    } catch (e) {
      log.aviso(`no se pudo leer ${rutaCostes}: ${e.message}`);
    }
  }

  function alDia() {
    const hoy = diaUTC(ahoraGasto());
    if (hoy !== cuenta.dia) { cuenta.dia = hoy; cuenta.gastoUsd = 0; cuenta.llamadas = 0; }
  }

  function apuntar(registro) {
    if (!rutaCostes) return;
    try { anadirJSONL(rutaCostes, registro); } catch (e) { log.aviso(`no se pudo apuntar el coste: ${e.message}`); }
  }

  const activo = () => hayClave && !desactivadoPor401;

  async function pedirJSON({
    uso = 'agentes', proposito = 'sin_proposito', sistema, entrada, instrucciones, esquema, maxTokens = 2000, esfuerzo,
  } = {}) {
    if (!activo()) {
      return {
        ok: false,
        motivo: 'sin_clave',
        detalle: desactivadoPor401 ? 'La API rechazó la clave (401): LLM desactivado hasta reiniciar con otra clave.' : 'Sin ANTHROPIC_API_KEY: se usan plantillas.',
      };
    }
    const clave = uso === 'comite' ? 'comite' : 'agentes';
    const modelo = modelos[clave];
    const nivel = ESFUERZOS.includes(esfuerzo) ? esfuerzo : ESFUERZO_POR_DEFECTO[clave];
    const tope = Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 2000;
    const textoSistema = String(sistema || '').trim() || SISTEMA_POR_DEFECTO;
    let contenido;
    try {
      contenido = componerContenido(instrucciones, entrada);
    } catch (e) {
      // Una entrada con ciclos o BigInt es un fallo de quien llama: se dice, no se lanza.
      return { ok: false, motivo: 'error', detalle: `Entrada no serializable: ${e.message}` };
    }
    const esq = esquema || { type: 'object' };

    alDia();
    const estimado = estimarCosteMaximo({ modelo, sistema: textoSistema, contenido, esquema: esq, maxTokens: tope });
    if (cuenta.gastoUsd + reservado + estimado > presupuesto) {
      return {
        ok: false,
        motivo: 'presupuesto',
        detalle: `Tope diario: gastado ${cuenta.gastoUsd.toFixed(4)} $ + esta llamada hasta ${estimado.toFixed(4)} $ > ${presupuesto} $.`,
      };
    }

    const { via, cuerpo } = construirPeticion({ modelo, maxTokens: tope, esfuerzo: nivel, sistema: textoSistema, contenido, esquema: esq });
    reservado += estimado;
    const t = ahoraGasto();
    const inicio = Date.now();
    let respuesta;
    try {
      respuesta = via === 'beta' ? await api.beta.messages.create(cuerpo) : await api.messages.create(cuerpo);
    } catch (e) {
      reservado -= estimado;
      const detalle = describirError(e);
      if (e instanceof Anthropic.AuthenticationError) {
        desactivadoPor401 = true;
        log.error('La API de Anthropic rechaza la clave (401). El LLM queda desactivado; todo sigue con plantillas.');
      } else {
        log.aviso(`${proposito}: ${detalle}`);
      }
      ultimoError = detalle;
      alDia();
      cuenta.llamadas += 1;
      apuntar({ t, proposito, modelo, entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0, costeUsd: 0, ok: false, motivo: 'error', ms: Date.now() - inicio });
      return { ok: false, motivo: 'error', detalle, costeUsd: 0 };
    }
    reservado -= estimado;
    const ms = Date.now() - inicio;
    const modeloServido = (respuesta && respuesta.model) || modelo;
    const { costeUsd, tokens } = costeDeUso(respuesta && respuesta.usage, modelo);
    alDia();
    cuenta.gastoUsd += costeUsd;
    cuenta.llamadas += 1;

    const resultado = interpretarRespuesta(respuesta, esq);
    apuntar({
      t, proposito, modelo: modeloServido, entrada: tokens.entrada, salida: tokens.salida,
      cacheLectura: tokens.cacheLectura, cacheEscritura: tokens.cacheEscritura, costeUsd,
      ok: resultado.ok, motivo: resultado.ok ? null : resultado.motivo, ms,
    });
    if (!resultado.ok) {
      ultimoError = resultado.detalle;
      return { ...resultado, costeUsd };
    }
    return { ok: true, datos: resultado.datos, costeUsd, modelo: modeloServido, tokens };
  }

  return {
    get activo() { return activo(); },
    pedirJSON,
    gastoHoy() { alDia(); return cuenta.gastoUsd; },
    estado() {
      alDia();
      return {
        activo: activo(),
        modeloComite: modelos.comite,
        modeloAgentes: modelos.agentes,
        gastoHoyUsd: cuenta.gastoUsd,
        presupuestoDiaUsd: presupuesto,
        llamadasHoy: cuenta.llamadas,
        ultimoError,
      };
    },
    fijarModelos({ modeloComite: mc, modeloAgentes: ma } = {}) {
      if (typeof mc === 'string' && mc.trim()) modelos.comite = mc.trim();
      if (typeof ma === 'string' && ma.trim()) modelos.agentes = ma.trim();
      return { modeloComite: modelos.comite, modeloAgentes: modelos.agentes };
    },
    fijarPresupuesto(usd) {
      const v = Number(usd);
      if (!Number.isFinite(v) || v < 0) throw new RangeError(`presupuesto no válido: ${usd}`);
      presupuesto = v;
      return presupuesto;
    },
  };
}

// Mirar stop_reason ANTES de leer el contenido (§6.3).
function interpretarRespuesta(respuesta, esquema) {
  const sr = respuesta && respuesta.stop_reason;
  if (sr === 'refusal') {
    const cat = respuesta.stop_details && respuesta.stop_details.category;
    return { ok: false, motivo: 'rechazo', detalle: `El modelo rechazó la petición${cat ? ` (categoría ${cat})` : ''}.` };
  }
  if (sr === 'max_tokens') return { ok: false, motivo: 'error', detalle: 'Respuesta cortada por max_tokens.' };
  if (sr !== 'end_turn' && sr !== 'stop_sequence') return { ok: false, motivo: 'error', detalle: `stop_reason inesperado: ${sr}` };
  // Con razonamiento o salvavidas, el primer bloque puede ser 'thinking' o
  // 'fallback': se busca el primer bloque de texto.
  const bloque = (respuesta.content || []).find(b => b && b.type === 'text');
  if (!bloque) return { ok: false, motivo: 'error', detalle: 'La respuesta no trae bloque de texto.' };
  let datos;
  try { datos = JSON.parse(bloque.text); } catch (e) {
    return { ok: false, motivo: 'esquema', detalle: `JSON ilegible: ${e.message}` };
  }
  const errores = validarEsquema(datos, esquema);
  if (errores.length) return { ok: false, motivo: 'esquema', detalle: errores.slice(0, 5).join('; ') };
  return { ok: true, datos };
}

// Cadena tipada del SDK, de lo más concreto a lo más general.
function describirError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Clave de Anthropic rechazada (401).';
  if (e instanceof Anthropic.RateLimitError) return 'Límite de peticiones de la API (429).';
  if (e instanceof Anthropic.APIConnectionError) return `Sin conexión con la API: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Error de la API${e.status ? ` ${e.status}` : ''}: ${String(e.message).slice(0, 200)}`;
  return `Error inesperado: ${e && e.message ? e.message : String(e)}`;
}

module.exports = {
  crearLLM,
  construirPeticion,
  costeDeUso,
  costeTokens,
  estimarCosteMaximo,
  validarEsquema,
  esquemaParaApi,
  interpretarRespuesta,
  tarifaDe,
  TARIFAS,
  MODELOS_BETA,
  BETA_FALLBACK,
  ESFUERZOS,
  ESFUERZO_POR_DEFECTO,
  MOTIVOS,
};
