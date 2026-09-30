'use strict';
// Lo que llega de un lead (formulario de Meta, anuncio que abre WhatsApp, la web o GHL), puesto en
// limpio: teléfono en formato internacional (E.164, España por defecto), nombre, email, respuestas
// del formulario y el tratamiento que le interesa. Sin base de datos ni red.
const { normalizar } = require('../repesca/interpretar');
const { esSensible } = require('../repesca/filtro-legal');

const ORIGENES = ['meta_formulario', 'meta_ctwa', 'web_whatsapp', 'ghl', 'treatwell', 'telefono', 'recepcion', 'google', 'referido', 'otro', 'web'];
const texto = (v, max = 160) => (v == null || typeof v === 'object' ? null : String(v).trim().slice(0, max) || null);

// Teléfono → «+34612345678» o null. Sin prefijo se entiende España: 9 cifras que empiezan por 6, 7, 8
// o 9. Con «+» o «00» delante vale cualquier país.
function normalizarTelefono(valor) {
  if (valor == null) return null;
  let t = String(valor).trim().replace(/[\s().\-/]/g, '');
  if (/^00\d/.test(t)) t = `+${t.slice(2)}`;
  const espanol = (n) => (/^[6789]\d{8}$/.test(n) ? `+34${n}` : null);
  if (t.startsWith('+')) {
    if (!/^\+\d{8,15}$/.test(t)) return null;
    return t.startsWith('+34') ? espanol(t.slice(3)) : t;
  }
  if (!/^\d+$/.test(t)) return null;
  if (t.length === 11 && t.startsWith('34')) return espanol(t.slice(2));
  return espanol(t);
}

// «+34916320000» → «916 32 00 00», para decirlo en un mensaje o en una tarea; los de fuera, tal cual.
function telefonoLegible(e164) {
  const t = String(e164 || '').replace(/[^\d+]/g, '');
  const m = /^(?:\+34)?([6789]\d{2})(\d{2})(\d{2})(\d{2})$/.exec(t);
  return m ? m.slice(1).join(' ') : t || null;
}

// Un fijo español no tiene WhatsApp: a ese lead se le llama.
const esFijoEspanol = (e164) => /^\+34[89]\d{8}$/.test(e164 || '');

function normalizarEmail(valor) {
  const t = texto(valor, 160)?.toLowerCase();
  return t && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

// «laura GARCÍA 🌸» → «Laura García». Sin al menos dos letras seguidas, null.
function limpiarNombre(valor, max = 120) {
  const t = String(valor ?? '').normalize('NFC').replace(/[^\p{L}\p{M}\s'’.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!/\p{L}{2}/u.test(t)) return null;
  const palabras = t.split(' ').map((p) => (p === p.toLowerCase() || p === p.toUpperCase() ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p));
  return palabras.join(' ').slice(0, max);
}

// El nombre de pila para saludar («Laura»), del nombre completo o del perfil de WhatsApp.
function nombrePila(valor) {
  const n = limpiarNombre(valor);
  return n ? n.split(' ').find((p) => /\p{L}{2}/u.test(p)).slice(0, 40) : null;
}

const claveCampo = (nombre) => normalizar(nombre).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Los campos estándar de Meta que no son de contacto, en castellano; las preguntas propias llegan
// como «¿qué_tratamiento_te_interesa?» y se dejan legibles.
const CAMPOS_META = { city: 'Ciudad', zip_code: 'Código postal', post_code: 'Código postal', date_of_birth: 'Fecha de nacimiento', gender: 'Sexo', job_title: 'Profesión', company_name: 'Empresa' };
const legible = (nombre, clave) => CAMPOS_META[clave]
  || String(nombre).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(¿?)(\p{L})/u, (_, a, b) => a + b.toUpperCase());

/**
 * Los campos de un formulario de Meta (field_data: [{ name, values: [] }]) → { nombre, telefono,
 * email, tratamiento (lo que respondió a «¿qué tratamiento te interesa?»), respuestas (el resto,
 * con la pregunta legible) }.
 */
function datosFormulario(campos = []) {
  const valores = new Map();
  for (const c of Array.isArray(campos) ? campos : []) {
    const clave = claveCampo(c?.name);
    const lista = Array.isArray(c?.values) ? c.values : [c?.values];
    const valor = lista.filter((v) => v != null && String(v).trim()).map((v) => String(v).trim()).join(', ');
    if (clave && valor && !valores.has(clave)) valores.set(clave, { pregunta: legible(c.name, clave).slice(0, 160), valor: valor.slice(0, 500) });
  }
  const usados = new Set();
  const tomar = (...claves) => {
    for (const k of claves) if (valores.has(k)) { usados.add(k); return valores.get(k).valor; }
    return null;
  };
  const pila = tomar('first_name', 'nombre_de_pila');
  const apellidos = tomar('last_name', 'apellidos');
  const nombre = tomar('full_name', 'nombre_completo', 'nombre_y_apellidos', 'nombre') || [pila, apellidos].filter(Boolean).join(' ') || null;
  const telefono = tomar('phone_number', 'telefono', 'telefono_movil', 'movil', 'phone', 'whatsapp');
  const email = tomar('email', 'correo', 'correo_electronico', 'e_mail');
  // La respuesta del tratamiento se queda también entre las respuestas: si no se encuentra en el
  // catálogo, recepción ve lo que puso.
  const claveTratamiento = [...valores.keys()].find((k) => !usados.has(k) && /tratamiento|servicio|interes/.test(k));
  const tratamiento = claveTratamiento ? valores.get(claveTratamiento).valor : null;
  const respuestas = [...valores.entries()].filter(([k]) => !usados.has(k)).map(([, v]) => v);
  return { nombre, telefono, email, tratamiento, respuestas };
}

/**
 * El cuerpo de POST /api/leads (la web, GHL…) → { ok, datos } o { ok: false, error }.
 * Campos: telefono, nombre, email, tratamiento (id o nombre), origen, codigo_web, utm (objeto) o
 * utm_source…utm_term, campana, conjunto, anuncio, mensaje y, de la otra herramienta:
 *   id_externo      ESTE envío (el formulario enviado, la oportunidad de GHL): si lo reintenta, no se
 *                   duplica. No es la persona: la misma persona puede volver a pedir información.
 *   id_contacto     la persona en la otra herramienta (el contacto de GHL); se guarda, puede repetirse
 *   id_oportunidad  la oportunidad de GHL
 */
function leerLeadApi(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { ok: false, error: 'El cuerpo tiene que ser un objeto JSON' };
  const telefono = texto(cuerpo.telefono, 40);
  const nombre = texto(cuerpo.nombre, 160);
  const email = texto(cuerpo.email, 160);
  if (!telefono && !email) return { ok: false, error: 'Hace falta el teléfono o el email' };
  const origen = ORIGENES.includes(cuerpo.origen) ? cuerpo.origen : 'web';
  const utm = {};
  const deUtm = cuerpo.utm && typeof cuerpo.utm === 'object' && !Array.isArray(cuerpo.utm) ? cuerpo.utm : {};
  for (const k of ['source', 'medium', 'campaign', 'content', 'term']) {
    const v = texto(deUtm[k] ?? deUtm[`utm_${k}`] ?? cuerpo[`utm_${k}`], 160);
    if (v) utm[`utm_${k}`] = v;
  }
  const codigoWeb = texto(cuerpo.codigo_web, 40);
  const tratamiento = texto(cuerpo.tratamiento, 160);
  const campana = texto(cuerpo.campana) || utm.utm_campaign || null;
  const mensaje = texto(cuerpo.mensaje, 1000);
  return {
    ok: true,
    datos: {
      origen, telefono, nombre, email, codigoWeb, campana, conjunto: texto(cuerpo.conjunto), anuncio: texto(cuerpo.anuncio),
      idExterno: texto(cuerpo.id_externo, 120), idContacto: texto(cuerpo.id_contacto, 60), idOportunidad: texto(cuerpo.id_oportunidad, 60),
      utm: Object.keys(utm).length ? utm : null,
      respuestas: mensaje ? [{ pregunta: 'Mensaje', valor: mensaje }] : [],
      tratamiento: {
        id: tratamiento, respuesta: tratamiento,
        claves: [codigoWeb, utm.utm_campaign, utm.utm_content, campana, texto(cuerpo.anuncio)],
        textos: [texto(cuerpo.anuncio), campana, utm.utm_campaign],
      },
    },
  };
}

/**
 * El webhook de leads de Meta (object «page», field «leadgen») → [{ leadgenId, formularioId,
 * anuncioId, conjuntoId, paginaId }]. Los datos del lead se piden después a Meta.
 */
function leerWebhookLeads(cuerpo) {
  const lista = [];
  if (cuerpo?.object !== 'page') return lista;
  for (const entrada of Array.isArray(cuerpo.entry) ? cuerpo.entry : []) {
    for (const cambio of Array.isArray(entrada?.changes) ? entrada.changes : []) {
      const v = cambio?.value || {};
      if (cambio?.field !== 'leadgen' || !texto(v.leadgen_id)) continue;
      lista.push({ leadgenId: texto(v.leadgen_id, 60), formularioId: texto(v.form_id, 60), anuncioId: texto(v.ad_id, 60), conjuntoId: texto(v.adgroup_id, 60), paginaId: texto(v.page_id, 60) });
    }
  }
  return lista;
}

// ── Tratamiento de interés ─────────────────────────────────────────────────────────────────
const limpio = (t) => normalizar(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Un agrupador del catálogo (Head Spa japonés, programa de acné, rejuvenecimiento vaginal…): no se
// reserva (se reserva el nivel o la técnica concretos, o la valoración), pero es lo que nombran los
// anuncios y lo que pregunta la gente. El importador del catálogo lo deja inactivo con esta nota
// (scripts/importar-catalogo.js); lo retirado del catálogo también queda inactivo, pero sin ella.
const NOTA_AGRUPADOR = 'No se reserva: agrupa varias técnicas';
// Un botón de WhatsApp de la web que mandan varias páginas: el importador guarda su texto en una sola
// y a las demás les pone esta nota, con el nombre de esa: «… manda el mismo texto que «Head Spa Detox
// Purificante».»
const NOTA_BOTON_COMPARTIDO = 'El botón de WhatsApp de la web manda el mismo texto que «';

function esAgrupador(t) {
  if (!t) return false;
  if (t.agrupador != null) return Boolean(Number(t.agrupador));
  const activo = t.activo == null || Boolean(Number(t.activo));
  return !activo && String(t.notas || '').startsWith(NOTA_AGRUPADOR);
}

// ¿Es o uno de los niveles o técnicas que agrupa a? Los de su misma familia y subfamilia (los del Head
// Spa japonés: Express, Detox, Synergie y Zen Premium).
function esOpcion(o, a) {
  return Boolean(o && a && o.id !== a.id && a.subfamilia && o.familia === a.familia && o.subfamilia === a.subfamilia);
}

// Lo que no se nombra si el paciente no lo ha nombrado: lo íntimo y lo de publicidad restringida
// (medicamentos con receta, productos sanitarios).
const restringido = (t) => Boolean(Number(t.publicidad_restringida)) || t.regimen_legal === 'medicamento_receta';
const discreto = (t) => esSensible(t) || restringido(t);

// Formas de nombrar un tratamiento: su nombre, el nombre sin lo que va entre paréntesis, cada
// alternativa separada por «/» y sus alias.
function formas(t) {
  let alias = t.alias;
  if (typeof alias === 'string') { try { alias = JSON.parse(alias); } catch { alias = []; } }
  const nombres = [t.nombre, ...(Array.isArray(alias) ? alias : [])].filter(Boolean).map(String);
  const salida = new Set();
  for (const n of nombres) {
    const sinParentesis = n.replace(/\([^)]*\)/g, ' ');
    for (const f of [n, sinParentesis, ...sinParentesis.split('/')]) salida.add(limpio(f));
  }
  return [...salida].filter((f) => f.length >= 4);
}

const contiene = (texto_, frase) => ` ${texto_} `.includes(` ${frase} `);

// El tratamiento del catálogo que nombra un texto. Gana el nombre exacto; si no, la forma más
// larga que aparece entera en el texto; si el texto es corto («HIFU»), el único tratamiento que lo
// contiene. Si hay empate entre dos tratamientos, ninguno: mejor sin tratamiento que con otro (ver
// elegirMejor: el agrupador con sus técnicas).
function buscarEnCatalogo(valor, tratamientos) {
  return completos(limpio(valor || ''), tratamientos).id;
}

// parcial: el texto es solo un trozo de su nombre («láser», «fotona»), no lo nombra entero.
function completos(t, tratamientos) {
  if (t.length < 3) return { hay: false, id: null };
  return elegirMejor(tratamientos.map((tr) => {
    let puntos = 0;
    let parcial = false;
    const sube = (p, esParcial) => { if (p > puntos) { puntos = p; parcial = esParcial; } };
    for (const f of formas(tr)) {
      if (f === t) sube(1000 + f.length, false);
      else if (contiene(t, f)) sube(f.length, false);
      else if (t.length >= 4 && contiene(f, t)) sube(t.length - 0.5, true);
    }
    return { tr, puntos, parcial };
  }));
}

// El que más puntos tiene. hay: si alguno tenía puntos (aunque empataran). Si empatan varios, ninguno…
// salvo que uno sea un agrupador y los demás, sus niveles o técnicas (esOpcion): «Head Spa» es el Head
// Spa japonés, y la conversación le preguntará cuál. Un agrupador de lo íntimo o de publicidad
// restringida no gana así, ni con un trozo de su nombre («láser», «radiofrecuencia», «fotona» no son
// el rejuvenecimiento vaginal): solo si lo nombra entero.
function elegirMejor(puntuados) {
  const max = Math.max(0, ...puntuados.map((x) => x.puntos));
  if (!max) return { hay: false, id: null };
  const mejores = [...new Map(puntuados.filter((x) => x.puntos === max).map((x) => [x.tr.id, x])).values()];
  const reservado = (x) => esAgrupador(x.tr) && discreto(x.tr);
  if (mejores.length === 1) return { hay: true, id: mejores[0].parcial && reservado(mejores[0]) ? null : mejores[0].tr.id };
  const agrupadores = mejores.filter((x) => esAgrupador(x.tr));
  const a = agrupadores.length === 1 ? agrupadores[0] : null;
  const gana = a && !reservado(a) && mejores.every((x) => x === a || esOpcion(x.tr, a.tr));
  return { hay: true, id: gana ? a.tr.id : null };
}

const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'con', 'para', 'por', 'en', 'y', 'o', 'a', 'al', 'sin', 'un', 'una']);

// El tratamiento que nombra un mensaje del paciente («¿qué precio tiene la limpieza facial?»). Como
// buscarEnCatalogo; y si ninguno aparece entero, el principio de su nombre (no de los alias, que los
// hay muy generales: «valoración médica capilar»), de al menos dos palabras y sin acabar en «de»: «la
// limpieza facial» es la «Limpieza facial profunda»; «head spa», el Head Spa japonés. Si empatan
// dos, ninguno: mejor preguntar que adivinar.
function buscarEnMensaje(valor, tratamientos) {
  const t = limpio(valor || '');
  const entero = completos(t, tratamientos);
  if (entero.hay) return entero.id;
  const texto = ` ${t} `;
  return elegirMejor(tratamientos.map((tr) => {
    let puntos = 0;
    for (const f of formas({ nombre: tr.nombre })) {
      const p = f.split(' ');
      for (let k = p.length - 1; k >= 2; k--) {
        const trozo = p.slice(0, k);
        if (VACIAS.has(trozo.at(-1)) || !trozo.some((x) => x.length >= 4 && !VACIAS.has(x))) continue;
        if (texto.includes(` ${trozo.join(' ')} `)) { puntos = Math.max(puntos, trozo.join(' ').length); break; }
      }
    }
    return { tr, puntos, parcial: true };
  })).id;
}

/**
 * Qué tratamiento le interesa. Por orden: el identificador exacto; lo que respondió en el
 * formulario (primero el mapeo, luego el catálogo); el mapeo de campaña, conjunto, anuncio,
 * formulario o código de la web (claves, en orden de prioridad); y el catálogo en los nombres del
 * anuncio o la campaña (textos). Valen los que se reservan y los agrupadores (esAgrupador): de esos,
 * la conversación le pregunta el nivel o la técnica, o lo pasa a recepción. Lo retirado, no.
 * @param {object} p { tratamientos: [{ id, nombre, alias, activo, notas, familia, subfamilia, sensible,
 *                     publicidad_restringida, regimen_legal }], mapeo: [{ clave, tratamiento_id }],
 *                     id, respuesta, claves: [], textos: [] }
 * @returns {{ id: string, via: 'id'|'formulario'|'mapeo'|'catalogo', agrupador?: true } | null}
 */
function resolverTratamiento({ tratamientos = [], mapeo = [], id = null, respuesta = null, claves = [], textos = [] }) {
  const validos = tratamientos.filter((t) => t.activo == null || Boolean(Number(t.activo)) || esAgrupador(t));
  const existe = new Set(validos.map((t) => t.id));
  const agrupadores = new Set(validos.filter(esAgrupador).map((t) => t.id));
  const salida = (tid, via) => (agrupadores.has(tid) ? { id: tid, via, agrupador: true } : { id: tid, via });
  if (id && existe.has(String(id).trim())) return salida(String(id).trim(), 'id');
  const reglas = new Map(mapeo.filter((m) => existe.has(m.tratamiento_id)).map((m) => [limpio(m.clave), m.tratamiento_id]));
  const regla = (v) => (v ? reglas.get(limpio(v)) || null : null);
  if (respuesta) {
    const r = regla(respuesta) || buscarEnCatalogo(respuesta, validos);
    if (r) return salida(r, 'formulario');
  }
  for (const c of claves) {
    const r = regla(c);
    if (r) return salida(r, 'mapeo');
  }
  for (const t of textos) {
    const r = buscarEnCatalogo(t, validos);
    if (r) return salida(r, 'catalogo');
  }
  return null;
}

module.exports = {
  ORIGENES, normalizarTelefono, telefonoLegible, esFijoEspanol, normalizarEmail, limpiarNombre, nombrePila, datosFormulario,
  leerLeadApi, leerWebhookLeads, buscarEnCatalogo, buscarEnMensaje, resolverTratamiento, esAgrupador, esOpcion, restringido,
  NOTA_AGRUPADOR, NOTA_BOTON_COMPARTIDO,
};
