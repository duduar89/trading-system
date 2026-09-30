'use strict';
// Posiciones de la clínica en Google Maps desde una malla de puntos a su alrededor (DataForSEO): una
// pasada por semana y con tope de gasto al mes. Solo con MODO_DATAFORSEO=real y sus credenciales; en
// simulado no hace nada.
//
//   El día que toca (POSICIONES_DIA, lunes por defecto; si ese día no pasa el cron, el siguiente),
//   desde las 7:00 de Madrid, «posiciones_enviar»: una búsqueda por palabra y punto (la malla y los 4
//   municipios de alrededor), solo las palabras que caben enteras en el tope del mes. Van en bloques
//   de 100 y cada bloque se apunta en «posiciones_tareas», con su coste, en cuanto DataForSEO lo acepta:
//   si algo falla a medias, al reintentar no se paga dos veces. Si DataForSEO no contesta al enviar un
//   bloque (tiempo agotado, conexión cortada, 5xx), no se sabe si lo ha creado y cobrado: el bloque
//   queda «incierta», con lo que costaría (cuenta para el tope), y no se vuelve a enviar; si DataForSEO
//   lo tenía, la recogida lo encuentra por su etiqueta en tasks_ready y lo recoge.
//   Mientras quede algo por recoger, «posiciones_recoger» cada 5 minutos: lo que DataForSEO ya tiene
//   listo → «posiciones_maps» (el puesto de la clínica, o NULL si no sale o no sale nadie, y quién sale
//   1.º). Una tarea que falla ella sola no para a las demás (a la tercera vez, fallida). Lo que no llega
//   en 24 horas queda caducado.
// Places API no se usa para nada de esto: en el EEE su contenido no puede servir para mirar a la
// competencia (quién sale 1.º lo da DataForSEO).
const crypto = require('crypto');
const cola = require('./cola');
const T = require('../motor/tiempo');
const M = require('../motor/posiciones/malla');
const { crearDataForSeo } = require('./integraciones/dataforseo');
const { registrar } = require('./eventos');
const { adaptadorReal, enReal, tareaUnica, conAviso, unaVez } = require('./trabajos-externos');

const TRABAJOS = { enviar: 'posiciones_enviar', recoger: 'posiciones_recoger' };
const HORA_DESDE = 7 * 60;
const CADUCA_MS = 24 * 3600 * 1000;
const RECOGER_CADA_MIN = 5;
// Un bloque, una llamada a task_post (DataForSEO admite 100 tareas por llamada).
const POR_BLOQUE = 100;
// Una tarea que falla ella sola (un 50000 de DataForSEO en esa tarea) se vuelve a pedir en las
// recogidas siguientes; a la tercera, fallida.
const MAX_INTENTOS_TAREA = 3;
// Precio de la cola estándar de Google Maps por página de resultados (30-09-2026). Sirve para prever:
// lo que cuenta para el tope es lo que DataForSEO dice que ha costado cada tarea.
const PRECIO_PAGINA = 0.0006;

const usd = (x) => Math.round(Number(x) * 1e6) / 1e6;
const sinTildes = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function numero(nombre, valor, porDefecto, { min, max, entero = false, impar = false }) {
  if (valor == null || String(valor).trim() === '') return porDefecto;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max || (entero && !Number.isInteger(n)) || (impar && n % 2 === 0)) {
    throw new Error(`${nombre} no es válido: tiene que ${impar ? 'ser un número impar' : 'ir'} de ${min} a ${max}`);
  }
  return n;
}

// Los ajustes de la malla, de la configuración (ver docs/GOOGLE.md).
function ajustes(env = process.env) {
  const vistas = new Set();
  const palabras = (env.POSICIONES_PALABRAS ? env.POSICIONES_PALABRAS.split(',') : M.PALABRAS)
    .map((p) => p.trim().replace(/\s+/g, ' ').slice(0, 160))
    .filter((p) => p && !vistas.has(sinTildes(p)) && vistas.add(sinTildes(p)));
  let centro = null;
  if (env.POSICIONES_CENTRO) {
    const [lat, lng] = String(env.POSICIONES_CENTRO).split(',').map((x) => Number(x.trim()));
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new Error('POSICIONES_CENTRO tiene que ser «latitud,longitud»');
    centro = { lat, lng };
  }
  return {
    palabras,
    centro,
    lado: numero('POSICIONES_MALLA', env.POSICIONES_MALLA, 7, { min: 1, max: 15, entero: true, impar: true }),
    pasoKm: numero('POSICIONES_PASO_KM', env.POSICIONES_PASO_KM, 1.5, { min: 0.1, max: 10 }),
    zoom: numero('POSICIONES_ZOOM', env.POSICIONES_ZOOM, 15, { min: 3, max: 21, entero: true }),
    profundidad: numero('POSICIONES_PROFUNDIDAD', env.POSICIONES_PROFUNDIDAD, 20, { min: 1, max: 100, entero: true }),
    dia: numero('POSICIONES_DIA', env.POSICIONES_DIA, 1, { min: 1, max: 7, entero: true }),
    topeMesUsd: numero('POSICIONES_TOPE_MES_USD', env.POSICIONES_TOPE_MES_USD, 3, { min: 0, max: 500 }),
    municipios: env.POSICIONES_MUNICIPIOS !== '0',
  };
}

// El adaptador para el cron: el de deps (las pruebas) o el real de la configuración
// (MODO_DATAFORSEO=real). Nunca el real a partir del .env bajo `node --test`.
const MODO = { clave: 'dataforseo', variable: 'MODO_DATAFORSEO', crear: (env) => crearDataForSeo('real', { env }) };
const adaptador = (deps, env = process.env) => adaptadorReal(deps, MODO, env);
const activo = (deps, env = process.env) => enReal(deps, MODO, env);

// Cómo reconocer a la clínica en los resultados: su place ID y, si se sabe, su CID (GOOGLE_CID). Del
// place ID valen los dos que puede haber: el de la base, que la revisión diaria de la ficha tiene al día
// (Google lo puede cambiar), y el de GOOGLE_PLACE_ID, que puede haberse quedado en el de antes.
async function laClinica(pool, env = process.env) {
  const [[cl]] = await pool.query('SELECT google_place_id, lat, lng FROM clinica WHERE id = 1');
  return {
    placeIds: [...new Set([cl?.google_place_id, env.GOOGLE_PLACE_ID].filter(Boolean))],
    cid: env.GOOGLE_CID || null,
    centro: cl?.lat != null && cl?.lng != null ? { lat: Number(cl.lat), lng: Number(cl.lng) } : null,
  };
}

const fechaDe = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
// La etiqueta de cada búsqueda en DataForSEO (tag): con ella se cuadra lo enviado sin respuesta.
const etiquetaDe = (pasada, punto, palabra) => `iemec|${pasada}|${punto}|${palabra}`.slice(0, 255);
// Lo que aún está en camino: enviado y sin recoger, o enviado sin saber si llegó.
async function enCamino(pool) {
  const [[q]] = await pool.query("SELECT COUNT(*) AS n FROM posiciones_tareas WHERE estado IN ('enviada','incierta')");
  return Number(q.n);
}

// Lo gastado en las pasadas del mes (de la fecha dada), en dólares.
async function gastoDelMes(pool, fecha) {
  const desde = T.primerDiaDelMes(fecha);
  const [[g]] = await pool.query('SELECT COALESCE(SUM(coste_usd), 0) AS usd FROM posiciones_tareas WHERE pasada >= ? AND pasada < ?', [desde, T.sumarMeses(desde, 1)]);
  return Number(g.usd);
}

/**
 * Envía la pasada: las búsquedas que faltan de cada palabra, solo las palabras que caben enteras en el
 * tope del mes. Lo que no cabe queda apuntado (evento «posiciones_tope»).
 */
async function enviarPasada(deps, { pasada, ahora = new Date(), env = process.env }) {
  const { pool } = deps;
  const dfs = deps.dataforseo || adaptador(deps, env);
  if (!dfs) throw new Error('DataForSEO no está configurado');
  const a = ajustes(env);
  const clinica = await laClinica(pool, env);
  // Sin saber cuál es la clínica, los resultados no dicen nada: no se gasta.
  if (!clinica.placeIds.length && !clinica.cid) throw Object.assign(new Error('Falta el place ID de la clínica (clinica.google_place_id o GOOGLE_PLACE_ID)'), { permanente: true });
  const puntos = [...M.malla({ centro: a.centro || clinica.centro || M.CENTRO_CLINICA, lado: a.lado, pasoKm: a.pasoKm }), ...(a.municipios ? M.MUNICIPIOS : [])];
  const [ya] = await pool.query('SELECT palabra, punto FROM posiciones_tareas WHERE pasada = ?', [pasada]);
  const hechas = new Set(ya.map((f) => `${sinTildes(f.palabra)}|${f.punto}`));
  const coste = M.costeTarea({ profundidad: a.profundidad, precioPagina: PRECIO_PAGINA });

  let gastado = await gastoDelMes(pool, pasada);
  let previsto = gastado;
  const envio = [];
  const fuera = [];
  for (const palabra of a.palabras) {
    const faltan = puntos.filter((p) => !hechas.has(`${sinTildes(palabra)}|${p.id}`));
    if (!faltan.length) continue;
    if (previsto + faltan.length * coste > a.topeMesUsd + 1e-9) {
      fuera.push(palabra);
      continue;
    }
    previsto += faltan.length * coste;
    envio.push(...faltan.map((punto) => ({ palabra, punto })));
  }

  let enviadas = 0;
  let inciertas = 0;
  let fallo = null;
  const errores = [];
  for (let i = 0; i < envio.length && !fallo; i += POR_BLOQUE) {
    const bloque = envio.slice(i, i + POR_BLOQUE);
    // Lo pagado de verdad manda: si el precio ha subido, se para antes de pasarse.
    if (gastado + bloque.length * coste > a.topeMesUsd + 1e-9) {
      fuera.push(...new Set(envio.slice(i).map((x) => x.palabra)));
      break;
    }
    let r;
    try {
      r = await dfs.enviarTareas(bloque.map((x) => ({
        palabra: x.palabra, coordenada: M.coordenada(x.punto, a.zoom), profundidad: a.profundidad, etiqueta: etiquetaDe(pasada, x.punto.id, x.palabra),
      })));
    } catch (err) {
      fallo = err;
      r = err.hechas || [];
    }
    const filas = [];
    bloque.forEach((x, k) => {
      const t = r[k];
      const apuntar = (id, estado, costeUsd) => filas.push([id, estado, pasada, x.palabra, x.punto.id, x.punto.lat, x.punto.lng, a.zoom, a.profundidad, usd(costeUsd), ahora]);
      if (t?.id) apuntar(t.id, 'enviada', t.coste || 0);
      else if (t) errores.push(t.error || 'sin respuesta');
      // Sin respuesta de DataForSEO: puede que la haya creado y cobrado. Se apunta con lo que costaría y
      // no se vuelve a enviar (la recogida la cuadra por su etiqueta). Si seguro que no llegó, nada.
      else if (fallo?.incierto) apuntar(`incierta-${crypto.randomUUID()}`, 'incierta', coste);
    });
    if (filas.length) {
      await pool.query('INSERT INTO posiciones_tareas (id, estado, pasada, palabra, punto, lat, lng, zoom, profundidad, coste_usd, enviada_en) VALUES ?', [filas]);
      gastado += filas.reduce((s, f) => s + f[9], 0);
      enviadas += filas.filter((f) => f[1] === 'enviada').length;
      inciertas += filas.filter((f) => f[1] === 'incierta').length;
    }
  }
  if (fuera.length) {
    await registrar(pool, { tipo: 'posiciones_tope', entidad: 'pasada', entidadId: pasada, actor: 'dataforseo', datos: { topeUsd: a.topeMesUsd, gastadoUsd: usd(gastado), fuera: [...new Set(fuera)] } });
  }
  if (errores.length) {
    await registrar(pool, { tipo: 'posiciones_errores', entidad: 'pasada', entidadId: pasada, actor: 'dataforseo', datos: { errores: errores.length, ejemplo: errores[0] } });
  }
  if (inciertas) {
    await registrar(pool, { tipo: 'posiciones_inciertas', entidad: 'pasada', entidadId: pasada, actor: 'dataforseo', datos: { inciertas, error: String(fallo?.message || '').slice(0, 200) } });
  }
  // Lo que queda por enviar, en el reintento de la cola (lo apuntado no se vuelve a enviar).
  if (fallo) throw fallo;
  return { pasada, enviadas, errores: errores.length, fuera: [...new Set(fuera)], gastadoMesUsd: usd(gastado) };
}

// Lo enviado sin respuesta («incierta») que DataForSEO sí tenía: sale en tasks_ready con su etiqueta
// cuando termina. Se le pone su id y se recoge como las demás.
async function cuadrarInciertas(pool, listas) {
  const [inciertas] = await pool.query("SELECT id, pasada, palabra, punto FROM posiciones_tareas WHERE estado = 'incierta'");
  if (!inciertas.length) return 0;
  const porEtiqueta = new Map(inciertas.map((f) => [etiquetaDe(fechaDe(f.pasada), f.punto, f.palabra), f.id]));
  let n = 0;
  for (const t of listas) {
    const provisional = t.etiqueta ? porEtiqueta.get(t.etiqueta) : null;
    if (!provisional) continue;
    porEtiqueta.delete(t.etiqueta);
    const [u] = await pool.query("UPDATE posiciones_tareas SET id = ?, estado = 'enviada' WHERE id = ? AND estado = 'incierta'", [t.id, provisional]);
    n += u.affectedRows;
  }
  return n;
}

/**
 * Recoge lo que DataForSEO ya tiene listo, de cualquier pasada, con tiempo tasado. Si queda algo en
 * camino, se aplaza (vuelve dentro de 5 minutos sin gastar intento).
 * @returns {{ recogidas, caducadas, fallidas, quedan, cuadradas? }} cuadradas: las inciertas que
 *          DataForSEO sí tenía (solo si hay alguna)
 */
async function recogerPendientes(deps, { ahora = new Date(), env = process.env, cortarEn = null } = {}) {
  const { pool } = deps;
  const dfs = deps.dataforseo || adaptador(deps, env);
  if (!dfs) throw new Error('DataForSEO no está configurado');
  const hecho = { recogidas: 0, caducadas: 0, fallidas: 0 };
  const [c] = await pool.query("UPDATE posiciones_tareas SET estado = 'caducada' WHERE estado IN ('enviada','incierta') AND enviada_en < ?", [new Date(ahora.getTime() - CADUCA_MS)]);
  hecho.caducadas = c.affectedRows;
  if (await enCamino(pool)) {
    const listas = await dfs.tareasListas();
    const cuadradas = await cuadrarInciertas(pool, listas);
    if (cuadradas) hecho.cuadradas = cuadradas;
    const ids = new Set(listas.map((t) => t.id));
    // Las que ya han fallado alguna vez, al final: una que falla siempre no gasta el tiempo de las demás.
    const [pendientes] = await pool.query("SELECT id, pasada, palabra, punto, intentos FROM posiciones_tareas WHERE estado = 'enviada' ORDER BY intentos, enviada_en, id");
    const clinica = await laClinica(pool, env);
    for (const t of pendientes.filter((x) => ids.has(x.id))) {
      if (cortarEn != null && Date.now() >= cortarEn) break;
      let r;
      try {
        r = await dfs.resultado(t.id);
      } catch (err) {
        // Si falla la llamada (DataForSEO caído, el límite de llamadas, las credenciales), se para aquí
        // y la cola lo repite. Si falla solo esta tarea, se apunta y se sigue con las demás: sin
        // arreglo (ya no existe), fallida; si se puede reintentar, en la recogida siguiente, y a la
        // tercera, fallida.
        if (!err.deTarea) throw err;
        const fallida = Boolean(err.permanente) || Number(t.intentos) + 1 >= MAX_INTENTOS_TAREA;
        await pool.query('UPDATE posiciones_tareas SET estado = ?, error = ?, intentos = intentos + 1 WHERE id = ?',
          [fallida ? 'fallida' : 'enviada', String(err.message).slice(0, 300), t.id]);
        if (fallida) hecho.fallidas++;
        continue;
      }
      if (!r.listo) continue;
      const puesto = M.puestoDe(r.items, clinica);
      const primero = r.items.find((x) => x.puesto === 1) || null;
      // Un 1.º sin reseñas no tiene nota (null): se guarda NULL, no 0.
      const nota = primero?.nota == null ? null : Number(primero.nota);
      await pool.query(
        `INSERT INTO posiciones_maps (pasada, palabra, punto, puesto, resultados, primero, primero_categoria, primero_nota, primero_resenas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE puesto = VALUES(puesto), resultados = VALUES(resultados), primero = VALUES(primero),
           primero_categoria = VALUES(primero_categoria), primero_nota = VALUES(primero_nota), primero_resenas = VALUES(primero_resenas)`,
        [fechaDe(t.pasada), t.palabra, t.punto, puesto != null && puesto <= 255 ? puesto : null, Math.min(255, r.items.length),
          primero?.titulo || null, primero?.categoria || null, Number.isFinite(nota) && nota >= 0 && nota <= 5 ? nota : null,
          Number.isInteger(primero?.resenas) && primero.resenas >= 0 ? primero.resenas : null]);
      await pool.query("UPDATE posiciones_tareas SET estado = 'recogida', recogida_en = ? WHERE id = ?", [ahora, t.id]);
      hecho.recogidas++;
    }
  }
  return { ...hecho, quedan: await enCamino(pool) };
}

// Mientras quede algo en camino (también lo incierto, por si DataForSEO lo tenía), hay un trabajo de
// recoger en la cola (uno solo).
async function asegurarRecogida(pool, ahora) {
  if (!(await enCamino(pool))) return false;
  const [[ya]] = await pool.query("SELECT id FROM cola WHERE tipo = ? AND estado IN ('pendiente','en_curso') LIMIT 1", [TRABAJOS.recoger]);
  if (ya) return false;
  await cola.encolar(pool, TRABAJOS.recoger, {}, { ejecutarEn: new Date(ahora.getTime() + RECOGER_CADA_MIN * 60000), maxIntentos: 10 });
  return true;
}

// La pasada de la semana, el día que toca o el primero después en que pase el cron.
async function programar(pool, { ahora = new Date(), a }) {
  const p = T.partesMadrid(ahora);
  if (p.diaSemana < a.dia || p.minutos < HORA_DESDE) return null;
  const lunes = T.sumarDias(p.fecha, 1 - p.diaSemana);
  const r = await unaVez(pool, `posiciones-semana-${lunes}`, new Date(ahora.getTime() + 8 * 86400000), () =>
    cola.encolar(pool, TRABAJOS.enviar, { pasada: p.fecha }, { claveUnica: `posiciones-enviar-${p.fecha}`, ejecutarEn: ahora, maxIntentos: 6 }));
  return r.ejecutado ? p.fecha : null;
}

/** Una vuelta del cron (dentro de su candado). null si DataForSEO no está en real. */
async function vuelta(deps, { ahora = new Date(), env = process.env, presupuestoMs = 20000 } = {}) {
  const dfs = adaptador(deps, env); // queda en deps.dataforseo
  if (!dfs) return null;
  const { pool } = deps;
  let a;
  try {
    a = ajustes(env);
  } catch (err) {
    // Una variable mal puesta no puede dejar la semana sin medir sin que nadie lo sepa.
    await tareaUnica(pool, { titulo: `DataForSEO: la configuración de la malla no vale (${err.message}). Ver docs/GOOGLE.md`, ahora });
    throw err;
  }
  const pasada = await programar(pool, { ahora, a });
  await asegurarRecogida(pool, ahora);
  const cortarEn = Date.now() + presupuestoMs;
  const informe = pasada ? { pasadaProgramada: pasada } : {};
  informe.cola = await cola.procesar(pool, {
    [TRABAJOS.enviar]: conAviso(pool, ahora, 'DataForSEO: no se ha podido enviar la pasada de posiciones', async (c) => {
      informe.enviada = await enviarPasada(deps, { pasada: c.pasada, ahora, env });
    }),
    [TRABAJOS.recoger]: conAviso(pool, ahora, 'DataForSEO: no se han podido recoger las posiciones', async () => {
      const r = await recogerPendientes(deps, { ahora, env, cortarEn });
      informe.recogida = r;
      return r.quedan ? cola.aplazar({ minutos: RECOGER_CADA_MIN }) : r;
    }),
  }, { ahora, limite: 5, cortarEn });
  return informe;
}

// Las cifras de una pasada (la última si no se dice), para el panel.
async function resumen(pool, { pasada = null, env = process.env } = {}) {
  const [[u]] = pasada ? [[{ pasada }]] : await pool.query('SELECT MAX(pasada) AS pasada FROM posiciones_maps');
  if (!u?.pasada) return { pasada: null, palabras: [] };
  const fecha = fechaDe(u.pasada);
  const [filas] = await pool.query('SELECT palabra, punto, puesto, primero FROM posiciones_maps WHERE pasada = ? ORDER BY palabra, punto', [fecha]);
  const a = ajustes(env);
  return { pasada: fecha, palabras: M.resumirPasada(filas, { profundidad: a.profundidad }) };
}

module.exports = { TRABAJOS, PRECIO_PAGINA, ajustes, activo, adaptador, vuelta, programar, enviarPasada, recogerPendientes, asegurarRecogida, gastoDelMes, resumen };
