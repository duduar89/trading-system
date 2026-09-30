'use strict';
// DataForSEO detrás de un adaptador: en qué puesto sale cada ficha en Google Maps buscando desde un
// punto concreto (latitud, longitud y zoom). Con él se mide la malla de posiciones alrededor de la
// clínica (servidor/posiciones.js). Ojo: DataForSEO no es Google; saca los resultados por su cuenta.
//   · simulado (por defecto): acepta las tareas, les da un identificador y devuelve los resultados que
//     se le den (una función por tarea). Nunca sale a internet.
//   · real: API v3 con el usuario y la clave de la cuenta (HTTP Basic). Cola estándar: se envían las
//     tareas (hasta 100 por llamada; 0,0006 $ por página de resultados, que en móvil son 20) y se
//     recogen cuando están listas (unos minutos; el objetivo de DataForSEO es menos de 45). Recoger no
//     cuesta. Sin usuario o clave no arranca (puerta ⛔ en PROGRESO.md).
//
//   enviarTareas([{ palabra, coordenada: 'lat,lng,15z', profundidad, etiqueta }])
//     → [{ etiqueta, id, coste } | { etiqueta, error }]  (una por tarea, en el mismo orden)
//     task_post se paga: no se repite si no se sabe si ha llegado. Entonces lanza un error «incierto»
//     (con err.hechas, lo de los bloques anteriores) y quien envía lo cuadra luego por la etiqueta.
//   tareasListas() → [{ id, etiqueta }]   las terminadas y aún sin recoger (últimos 3 días)
//   resultado(id)  → { listo: false } | { listo: true, items: [{ puesto, titulo, placeId, cid,
//                    categoria, categorias, nota, resenas, latitud, longitud }] }
//                    (sin resultados, items vacío). Un error de la tarea (no de la llamada) lleva
//                    deTarea: quien recoge sigue con las demás.
//   saldo()        → { saldo } en dólares
const { conReintentos, errorExterno, leerJson, esperarDeVerdad, fetchDe } = require('./llamadas');

const BASE = 'https://api.dataforseo.com/v3';
const MAPS = `${BASE}/serp/google/maps`;
const POR_LLAMADA = 100;
// Estados de DataForSEO (appendix/errors): la tarea aún no está, se puede reintentar, o no tiene arreglo.
const EN_CURSO = new Set([40601, 40602]);
const REINTENTABLES = new Set([40202, 50000, 50301, 50401]);
const SIN_SALDO = new Set([40200, 40210]);
// «No Search Results.»: la búsqueda se ha hecho (y se cobra) y no ha salido nadie. No es un fallo.
const SIN_RESULTADOS = 40102;

function aItem(x = {}) {
  return {
    puesto: Number.isInteger(x.rank_group) ? x.rank_group : null,
    titulo: x.title ? String(x.title).slice(0, 200) : null,
    placeId: x.place_id || null,
    cid: x.cid != null ? String(x.cid) : null,
    categoria: x.category ? String(x.category).slice(0, 120) : null,
    categorias: Array.isArray(x.additional_categories) ? x.additional_categories.map(String) : [],
    nota: x.rating?.value ?? null,
    resenas: x.rating?.votes_count ?? null,
    latitud: x.latitude ?? null,
    longitud: x.longitude ?? null,
  };
}

// Solo los resultados de fichas (los de tipo «maps_search»), en su orden.
const itemsDe = (resultado) => (resultado?.items || []).filter((x) => !x.type || x.type === 'maps_search').map(aItem);

// ── Modo simulado ──────────────────────────────────────────────────────────────────────────

function crearSimulado({ resultados = () => [], coste = 0.0006, listas = () => true } = {}) {
  const tareas = new Map();
  const enviadas = [];
  let n = 0;
  return {
    modo: 'simulado',
    enviadas,
    async enviarTareas(lista) {
      return lista.map((t) => {
        const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
        tareas.set(id, t);
        enviadas.push({ id, ...t });
        return { etiqueta: t.etiqueta, id, coste };
      });
    },
    async tareasListas() {
      return [...tareas].filter(([id, t]) => listas(t, id)).map(([id, t]) => ({ id, etiqueta: t.etiqueta }));
    },
    async resultado(id) {
      const t = tareas.get(id);
      if (!t) throw errorExterno(`DataForSEO simulado: no hay ninguna tarea ${id}`, { permanente: true });
      if (!listas(t, id)) return { listo: false };
      tareas.delete(id);
      return { listo: true, items: (resultados(t) || []).map((x) => ({ ...x })) };
    },
    async saldo() { return { saldo: null }; },
  };
}

// ── Modo real ──────────────────────────────────────────────────────────────────────────────

function crearReal(env = process.env, opciones = {}) {
  const usuario = env.DATAFORSEO_LOGIN;
  const clave = env.DATAFORSEO_CLAVE;
  if (!usuario || !clave) throw new Error('DataForSEO real: faltan DATAFORSEO_LOGIN y DATAFORSEO_CLAVE (los de «API Access» en su panel; ver docs/GOOGLE.md)');
  const { esperar = esperarDeVerdad, reloj = () => new Date(), azar = Math.random, reintentos = 3 } = opciones;
  // Con node --test y sin el fetch de la prueba, no sale a internet (llamadas.js): una prueba nunca
  // llama a DataForSEO ni paga una búsqueda.
  const fetch = fetchDe(opciones, 'DataForSEO real');
  const autorizacion = `Basic ${Buffer.from(`${usuario}:${clave}`).toString('base64')}`;
  const reintentar = { reintentos, esperar, azar, reloj, nombre: 'DataForSEO' };

  // Una llamada: reintentos ante 429 o 5xx; luego, el estado de DataForSEO (que casi siempre contesta
  // 200 y pone el error en status_code). Un POST (task_post) se paga: solo se repite tras un 429 o sin
  // conexión; si no se sabe si ha llegado (tiempo agotado, conexión cortada, 5xx), error «incierto».
  async function llamar(metodo, url, cuerpo = null) {
    const idempotente = metodo !== 'POST';
    const r = await conReintentos(() => fetch(url, {
      method: metodo,
      headers: { Authorization: autorizacion, Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(30000),
    }), { ...reintentar, idempotente });
    const d = await leerJson(r);
    const codigo = Number(d.status_code) || null;
    if (r.ok && codigo === 20000) return d;
    const texto = `${codigo || r.status} ${String(d.status_message || '').slice(0, 120)}`.trim();
    if (r.status === 401 || (codigo >= 40100 && codigo < 40200)) throw errorExterno(`DataForSEO ${texto}: usuario o clave no válidos (DATAFORSEO_LOGIN, DATAFORSEO_CLAVE)`, { estado: r.status, permanente: true });
    if (r.status === 402 || SIN_SALDO.has(codigo)) throw errorExterno(`DataForSEO ${texto}: sin saldo en la cuenta; hay que recargarla`, { estado: r.status, permanente: true });
    const reintentable = r.status === 429 || r.status >= 500 || REINTENTABLES.has(codigo);
    const incierto = !idempotente && (r.status >= 500 || codigo >= 50000);
    throw errorExterno(`DataForSEO ${texto}${incierto ? ' (puede que haya creado las tareas: no se repite sin comprobarlo)' : ''}`, { estado: r.status, permanente: !reintentable, reintentable, incierto });
  }

  return {
    modo: 'real',
    async enviarTareas(lista) {
      const hechas = [];
      for (let i = 0; i < lista.length; i += POR_LLAMADA) {
        const bloque = lista.slice(i, i + POR_LLAMADA);
        let d;
        try {
          d = await llamar('POST', `${MAPS}/task_post`, bloque.map((t) => ({
            keyword: t.palabra,
            location_coordinate: t.coordenada,
            language_code: 'es',
            device: 'mobile',
            os: 'android',
            depth: t.profundidad || 20,
            // Resultados de la búsqueda (la lista), no la ficha de un sitio concreto.
            search_places: false,
            tag: t.etiqueta,
          })));
        } catch (err) {
          err.hechas = hechas; // lo de los bloques anteriores sí está hecho (y pagado)
          throw err;
        }
        const respuestas = d.tasks || [];
        bloque.forEach((t, k) => {
          const x = respuestas.find((y) => y?.data?.tag === t.etiqueta) || respuestas[k];
          if (x && Number(x.status_code) === 20100 && x.id) hechas.push({ etiqueta: t.etiqueta, id: x.id, coste: Number(x.cost) || 0 });
          else hechas.push({ etiqueta: t.etiqueta, error: x ? `${x.status_code} ${String(x.status_message || '').slice(0, 120)}` : 'sin respuesta' });
        });
      }
      return hechas;
    },
    async tareasListas() {
      const d = await llamar('GET', `${MAPS}/tasks_ready`);
      return (d.tasks || []).flatMap((t) => (Number(t.status_code) === 20000 ? t.result || [] : []))
        .filter((x) => x?.id).map((x) => ({ id: x.id, etiqueta: x.tag || null }));
    },
    async resultado(id) {
      const deTarea = (err) => Object.assign(err, { deTarea: true });
      if (!/^[0-9a-f-]{20,64}$/i.test(String(id))) throw deTarea(errorExterno(`Identificador de tarea no válido: ${String(id).slice(0, 40)}`, { permanente: true }));
      const d = await llamar('GET', `${MAPS}/task_get/advanced/${id}`);
      const t = (d.tasks || [])[0];
      const codigo = Number(t?.status_code);
      if (codigo === 20000) return { listo: true, items: (t.result || []).flatMap(itemsDe) };
      if (codigo === SIN_RESULTADOS) return { listo: true, items: [] };
      if (EN_CURSO.has(codigo)) return { listo: false };
      // La llamada ha ido bien y lo que falla es esta tarea.
      const reintentable = REINTENTABLES.has(codigo);
      throw deTarea(errorExterno(`DataForSEO, tarea ${id}: ${codigo || 'sin estado'} ${String(t?.status_message || '').slice(0, 120)}`.trim(), { permanente: !reintentable, reintentable }));
    },
    async saldo() {
      const d = await llamar('GET', `${BASE}/appendix/user_data`);
      const r = (d.tasks || [])[0]?.result?.[0];
      return { saldo: r?.money?.balance ?? null };
    },
  };
}

function crearDataForSeo(modo = 'simulado', opciones = {}) {
  return modo === 'real' ? crearReal(opciones.env || process.env, opciones) : crearSimulado(opciones);
}

module.exports = { crearDataForSeo, aItem };
