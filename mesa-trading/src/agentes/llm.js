'use strict';
// Cliente de LLM de la mesa (§6.3). El LLM solo redacta, elige de una lista o
// clasifica: siempre devuelve JSON, que se valida aquí contra un esquema. Si
// algo falla (sin clave, sin presupuesto, rechazo, error, esquema), devuelve
// { ok: false, motivo } y quien llama aplica su plan por defecto: el trading
// nunca se para por el LLM.

const Anthropic = require('@anthropic-ai/sdk');
const { anadirJSONL, leerJSONL } = require('../util/almacen');
const { crearReservas } = require('./reservas-llm');
const { RelojReal, diaUTC, DIA } = require('../util/reloj');
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
// Modelos a los que el salvavidas del servidor puede mandar un rechazo. Su
// intento se cobra además del intento rechazado (usage.iterations).
const DESTINOS_SALVAVIDAS = Object.freeze(['claude-opus-5', 'claude-opus-4-8']);

// Timeout y reintentos por petición. Un no-streaming con muchos tokens de
// salida tarda más de 60 s (el SDK calcula hasta ~112 s con 4000 y ~197 s con
// 7000): el timeout crece con maxTokens, y un solo reintento, porque cada
// intento cortado puede haberse cobrado igual.
const REINTENTOS = 1;
const timeoutPara = maxTokens => Math.min(600_000, Math.max(60_000, maxTokens * 40));
// Con un plazo (el modo latido: el proceso tiene un vigía que lo mata), una
// llamada que no tendría al menos esto para responder no se hace.
const MIN_LLAMADA_MS = 15_000;
// Margen tras el timeout total de una llamada para dar su reserva por
// huérfana (los reintentos del SDK esperan unos segundos entre intento e intento).
const MARGEN_VENCE_MS = 60_000;
// Días de gasto que se guardan en memoria para gastoDelDia/gastoEntre.
const DIAS_HISTORIAL = 8;

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

// Lo que puede añadir el salvavidas: un segundo intento en el destino más caro,
// con la entrada más la salida parcial del intento rechazado como contexto y
// maxTokens de salida. Solo en los modelos que lo llevan (via beta).
function reservaSalvavidas({ modelo, sistema, contenido, esquema, maxTokens }) {
  if (!usaBeta(modelo)) return 0;
  const caracteres = String(sistema || '').length + String(contenido || '').length + JSON.stringify(esquema || {}).length;
  const entradaTok = Math.ceil(caracteres / CARACTERES_POR_TOKEN) + maxTokens;
  return Math.max(...DESTINOS_SALVAVIDAS.map((m) => {
    const t = tarifaDe(m).tarifa;
    return (entradaTok * t.entrada + maxTokens * t.salida) / 1e6;
  }));
}

// Máximo que se reserva contra el tope diario antes de llamar: un intento más,
// si el modelo lleva salvavidas, el del modelo de reserva.
function reservaMaxima(p) {
  return estimarCosteMaximo(p) + reservaSalvavidas(p);
}

const SISTEMA_POR_DEFECTO = 'Eres un agente de una mesa de trading en papel. Respondes solo con el JSON pedido, en español.';

// Opciones de tiempo (el modo latido, ARQUITECTURA-WEB W2):
// - limiteLlamadaMs: tope del timeout de cada intento (el del comité es 45 s).
// - reintentos: reintentos del SDK (0 en el latido: cada intento cortado se
//   cobra y el tiempo no da para dos).
// - plazo(): instante (ms, Date.now()) en que todo el LLM de este proceso
//   tiene que haber acabado; el timeout de cada llamada se recorta para caber
//   y, si no queda MIN_LLAMADA_MS, la llamada no se hace.
// Con rutaCostes, las reservas contra el tope diario se comparten entre
// procesos por disco (src/agentes/reservas-llm.js).
function crearLLM({
  apiKey = '', modeloComite = 'claude-opus-5-5', modeloAgentes = 'claude-opus-5-5', presupuestoDiaUsd = 2,
  reloj = new RelojReal(), rutaCostes = null, cliente = null, fetch = undefined,
  limiteLlamadaMs = null, reintentos = REINTENTOS, plazo = null,
} = {}) {
  const numReintentos = Number.isInteger(reintentos) && reintentos >= 0 ? reintentos : REINTENTOS;
  const reservas = rutaCostes ? crearReservas({ rutaCostes }) : null;
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
  // Gasto de los últimos días ({ t, costeUsd }, t en tiempo real): el cierre
  // diario de las 00:05 pregunta por el día que cierra, cuando gastoHoy() ya
  // se ha puesto a cero.
  let historial = [];
  // Todo lo gastado desde que existe la carpeta de datos (el criterio g del
  // semáforo «¿Listo para dinero real?» lo compara con el beneficio del fondo).
  let gastoTotalUsd = 0;
  // Llamadas de un proceso que murió a mitad: al registro antes de leerlo.
  if (reservas) {
    for (const x of reservas.saldarSiSePuede()) log.aviso(`llamada huérfana (${x.proposito}) apuntada como gastada: ${x.costeUsd.toFixed(4)} $ estimados`);
  }
  // Tras un reinicio, el gasto del día sale del registro: si no, cada arranque
  // regalaría otro presupuesto entero. Se lee entero por el acumulado.
  if (rutaCostes) {
    try {
      const desde = ahoraGasto() - DIAS_HISTORIAL * DIA;
      for (const r of leerJSONL(rutaCostes)) {
        if (!r || !Number.isFinite(r.t)) continue;
        gastoTotalUsd += n0(r.costeUsd);
        if (diaUTC(r.t) === cuenta.dia) {
          cuenta.gastoUsd += n0(r.costeUsd);
          cuenta.llamadas += 1;
        }
        if (r.t >= desde && n0(r.costeUsd) > 0) historial.push({ t: r.t, costeUsd: n0(r.costeUsd) });
      }
    } catch (e) {
      log.aviso(`no se pudo leer ${rutaCostes}: ${e.message}`);
    }
  }

  function alDia() {
    const hoy = diaUTC(ahoraGasto());
    if (hoy !== cuenta.dia) { cuenta.dia = hoy; cuenta.gastoUsd = 0; cuenta.llamadas = 0; }
  }

  function anotarGasto(t, costeUsd) {
    if (!(costeUsd > 0)) return;
    gastoTotalUsd += costeUsd;
    historial.push({ t, costeUsd });
    const limite = ahoraGasto() - DIAS_HISTORIAL * DIA;
    if (historial.length && historial[0].t < limite) historial = historial.filter(x => x.t >= limite);
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
    // Tiempo: el timeout por intento, recortado al tope y al plazo del proceso.
    let timeout = timeoutPara(tope);
    if (Number.isFinite(limiteLlamadaMs) && limiteLlamadaMs > 0) timeout = Math.min(timeout, limiteLlamadaMs);
    const hasta = typeof plazo === 'function' ? plazo() : null;
    if (Number.isFinite(hasta)) {
      const queda = hasta - Date.now();
      if (queda < MIN_LLAMADA_MS) {
        return { ok: false, motivo: 'error', detalle: `Sin tiempo para llamar al LLM en este latido (quedan ${Math.max(0, Math.round(queda / 1000))} s): se usa la plantilla.` };
      }
      timeout = Math.min(timeout, Math.floor(queda / (1 + numReintentos)));
    }
    // Con salvavidas se reserva también el intento del modelo de reserva: si
    // no, una llamada que cabe podría acabar costando más que el tope.
    const estimado = reservaMaxima({ modelo, sistema: textoSistema, contenido, esquema: esq, maxTokens: tope });
    const t = ahoraGasto();
    const textoTope = (gastado, enVuelo) => `Tope diario: gastado ${gastado.toFixed(4)} $${enVuelo > 0 ? ` + en vuelo ${enVuelo.toFixed(4)} $` : ''} + esta llamada hasta ${estimado.toFixed(4)} $ > ${presupuesto} $.`;
    let idReserva = null;
    if (reservas) {
      // Mirar el tope y reservar, a la vez para todos los procesos.
      let r;
      try {
        r = await reservas.reservar({
          t, costeUsd: estimado, intentos: 1 + numReintentos, vence: Date.now() + timeout * (1 + numReintentos) + MARGEN_VENCE_MS,
          proposito, modelo, presupuesto, gastoMemoria: cuenta.gastoUsd,
        });
      } catch (e) {
        return { ok: false, motivo: 'error', detalle: `No se pudo reservar el gasto del LLM: ${e.message}` };
      }
      for (const x of r.saldados) {
        log.aviso(`llamada huérfana (${x.proposito}) apuntada como gastada: ${x.costeUsd.toFixed(4)} $ estimados`);
        if (diaUTC(x.t) === cuenta.dia) { cuenta.gastoUsd += x.costeUsd; cuenta.llamadas += 1; }
        anotarGasto(x.t, x.costeUsd);
      }
      if (!r.ok) return { ok: false, motivo: 'presupuesto', detalle: textoTope(r.gastado, r.reservado) };
      idReserva = r.id;
    } else if (cuenta.gastoUsd + reservado + estimado > presupuesto) {
      return { ok: false, motivo: 'presupuesto', detalle: textoTope(cuenta.gastoUsd, reservado) };
    }

    const { via, cuerpo } = construirPeticion({ modelo, maxTokens: tope, esfuerzo: nivel, sistema: textoSistema, contenido, esquema: esq });
    const opcionesPeticion = { timeout, maxRetries: numReintentos };
    reservado += estimado;
    const inicio = Date.now();
    // Apunta el coste (y, con reservas en disco, cierra la reserva a la vez).
    const apuntarYCerrar = async (registro) => {
      if (!idReserva) { apuntar(registro); return; }
      try {
        await reservas.cerrar(idReserva, registro);
      } catch (e) {
        // Sin el cerrojo: se apunta igual; la reserva la saldará otro como
        // huérfana (cuenta de más, nunca de menos).
        log.aviso(`reserva del LLM sin cerrar: ${e.message}`);
        apuntar(registro);
      }
    };
    let respuesta;
    try {
      respuesta = via === 'beta' ? await api.beta.messages.create(cuerpo, opcionesPeticion) : await api.messages.create(cuerpo, opcionesPeticion);
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
      // Cortada por timeout, la petición llegó al servidor (cada intento) y
      // puede estar cobrada: se apunta como gastado lo reservado, marcado
      // como estimado. El resto de errores (401, 429, 5xx, sin conexión) no
      // llegan a generar y cuentan 0.
      const cortada = e instanceof Anthropic.APIConnectionTimeoutError;
      const coste = cortada ? estimado * (1 + numReintentos) : 0;
      alDia();
      cuenta.gastoUsd += coste;
      cuenta.llamadas += 1;
      anotarGasto(t, coste);
      await apuntarYCerrar({
        t, proposito, modelo, entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0, costeUsd: coste, ok: false, motivo: 'error', ms: Date.now() - inicio,
        ...(cortada ? { estimado: true } : {}),
      });
      return { ok: false, motivo: 'error', detalle, costeUsd: coste };
    }
    reservado -= estimado;
    const ms = Date.now() - inicio;
    const modeloServido = (respuesta && respuesta.model) || modelo;
    const { costeUsd, tokens } = costeDeUso(respuesta && respuesta.usage, modelo);
    alDia();
    cuenta.gastoUsd += costeUsd;
    cuenta.llamadas += 1;
    anotarGasto(t, costeUsd);

    const resultado = interpretarRespuesta(respuesta, esq);
    await apuntarYCerrar({
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
    // Gasto de un día UTC ('AAAA-MM-DD') de los últimos ocho, con la misma
    // clave que /api/costes-llm. El día es el del dinero (tiempo real): con el
    // reloj acelerado de la demo no corresponde al día simulado.
    gastoDelDia(dia) {
      let s = 0;
      for (const x of historial) if (diaUTC(x.t) === dia) s += x.costeUsd;
      return s;
    },
    // Gasto con desde < t ≤ hasta (ms, tiempo real), para un cierre que cubre
    // más de un día.
    gastoEntre(desde, hasta) {
      let s = 0;
      for (const x of historial) if (x.t > desde && x.t <= hasta) s += x.costeUsd;
      return s;
    },
    // Todo lo apuntado en llm-costes.jsonl más lo de esta sesión.
    gastoTotal() { return gastoTotalUsd; },
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
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'La API no respondió a tiempo (timeout): puede haberse cobrado.';
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
  reservaSalvavidas,
  reservaMaxima,
  timeoutPara,
  MIN_LLAMADA_MS,
  validarEsquema,
  esquemaParaApi,
  interpretarRespuesta,
  tarifaDe,
  TARIFAS,
  MODELOS_BETA,
  BETA_FALLBACK,
  DESTINOS_SALVAVIDAS,
  REINTENTOS,
  ESFUERZOS,
  ESFUERZO_POR_DEFECTO,
  MOTIVOS,
};
