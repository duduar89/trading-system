'use strict';
// Llamadas a servicios de fuera (Google, DataForSEO) con reintentos y cuotas.
//   · Reintentos: ante un 429, un 5xx o un fallo de red se espera y se repite, pocas veces y poco
//     rato (segundos). La espera respeta Retry-After y, si no viene, crece (1, 2, 4… s) con algo de
//     azar, para que dos procesos no vuelvan a la vez. Lo que pide esperar más no se espera aquí: el
//     error sale marcado como «reintentable» y lo reintenta la cola del cron (1, 2, 4, 8 minutos).
//   · Lo que no se puede repetir (un POST que crea una publicación o unas tareas que se pagan) solo se
//     repite si seguro que no se hizo: un 429 o un fallo antes de conectar. Tras un tiempo agotado, una
//     conexión cortada o un 5xx puede que el servicio lo haya hecho: el error sale «incierto» y quien
//     llama lo comprueba antes de volver a pedirlo (nunca se publica ni se paga dos veces).
//   · Cuotas: como mucho N llamadas por minuto en este proceso. La que no cabe espera su turno si es
//     cuestión de segundos; si no, error reintentable (la cola la repite; en el panel, se dice que
//     espere). Las cuotas de Google son por proyecto y aquí solo se ve este proceso: basta porque el
//     cron hace pocas llamadas por vuelta y las ediciones solo salen del panel; si aun así Google
//     contesta 429, se espera y se reintenta.
// Las esperas son de segundos y dentro de una misma llamada: no programan trabajo (eso es del cron).

const esperarDeVerdad = (ms) => new Promise((ok) => { setTimeout(ok, ms); });

// incierto: la petición puede haber llegado y haberse hecho (solo en lo que no se puede repetir).
function errorExterno(mensaje, { estado = null, permanente = false, reintentable = false, incierto = false } = {}) {
  const err = new Error(mensaje);
  err.estado = estado;
  err.permanente = permanente;
  err.reintentable = reintentable;
  err.incierto = incierto;
  return err;
}

// Fallos de red en los que la petición no ha llegado a salir (no hay conexión): se pueden repetir
// siempre. Un tiempo agotado o una conexión cortada, no: la petición puede haber llegado.
const SIN_CONEXION = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
const sinSalir = (err) => SIN_CONEXION.has(err?.cause?.code || err?.code);
const porQue = (err) => (err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'tiempo agotado' : 'fallo de red');

// Retry-After: segundos o una fecha HTTP. null si no viene o no se entiende.
function msDeRetryAfter(valor, ahoraMs) {
  if (valor == null || String(valor).trim() === '') return null;
  const v = String(valor).trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - ahoraMs);
}

/**
 * Hace la llamada (hacer() → Response de fetch) con reintentos. Devuelve la respuesta, también la
 * última 429/5xx si se acaban los reintentos o si pide esperar más de maxEsperaMs (quien llama decide
 * el error). Si la red falla todas las veces, lanza un error reintentable.
 * idempotente: false para lo que no se puede repetir (un POST que crea algo o que se paga): solo se
 * repite tras un 429 o un fallo antes de conectar; un 5xx vuelve al momento (quien llama lo marca
 * «incierto») y un tiempo agotado o una conexión cortada lanzan un error «incierto».
 */
async function conReintentos(hacer, {
  reintentos = 3, baseMs = 1000, topeMs = 8000, maxEsperaMs = 20000, idempotente = true,
  esperar = esperarDeVerdad, azar = Math.random, reloj = () => new Date(), nombre = 'el servicio',
} = {}) {
  for (let intento = 0; ; intento++) {
    let r = null;
    let fallo = null;
    try {
      r = await hacer();
    } catch (err) {
      // Lo que ya viene sin arreglo (sin red en las pruebas: fetchDe) no se repite ni se espera.
      if (err?.permanente) throw err;
      fallo = err;
    }
    if (r && r.status !== 429 && r.status < 500) return r;
    if (!idempotente && (r ? r.status !== 429 : !sinSalir(fallo))) {
      if (r) return r;
      throw errorExterno(`${nombre} no ha contestado (${porQue(fallo)}) y puede que lo haya recibido: no se repite sin comprobarlo`, { reintentable: true, incierto: true });
    }
    const pedida = r ? msDeRetryAfter(r.headers?.get?.('retry-after'), reloj().getTime()) : null;
    const ms = pedida ?? Math.round(Math.min(topeMs, baseMs * 2 ** intento) * (0.5 + azar()));
    if (intento >= reintentos || ms > maxEsperaMs) {
      if (r) return r;
      throw errorExterno(`${nombre} no responde (${porQue(fallo)})`, { reintentable: true });
    }
    await esperar(ms);
  }
}

// El fetch de un adaptador real: el que le pasen (las pruebas, con respuestas grabadas) o el de verdad.
// Con `node --test` y sin el de la prueba, uno que no sale a internet: cada llamada falla al momento,
// sin reintentos. Así ninguna prueba llama a Google ni paga a DataForSEO aunque el .env del portátil
// tenga MODO_GOOGLE=real y las claves, y la app se puede montar en una prueba igual.
function fetchDe(opciones, nombre) {
  if (typeof opciones.fetch === 'function') return opciones.fetch;
  if (!process.env.NODE_TEST_CONTEXT) return globalThis.fetch;
  return async () => {
    throw errorExterno(`${nombre}: con node --test no se sale a internet (la prueba tiene que pasar su fetch, con respuestas grabadas)`, { permanente: true });
  };
}

/** Cuota de llamadas por minuto (ventana deslizante de 60 s) en este proceso. */
function crearCuota(porMinuto, { reloj = () => new Date(), esperar = esperarDeVerdad, maxEsperaMs = 20000, nombre = 'el servicio' } = {}) {
  const marcas = [];
  return async function turno() {
    for (;;) {
      const ahora = reloj().getTime();
      while (marcas.length && marcas[0] <= ahora - 60000) marcas.shift();
      if (marcas.length < porMinuto) {
        marcas.push(ahora);
        return;
      }
      const ms = marcas[0] + 60000 - ahora;
      if (ms > maxEsperaMs) {
        throw errorExterno(`Cuota de ${porMinuto} llamadas por minuto a ${nombre} agotada: vuelve a intentarlo en ${Math.ceil(ms / 1000)} segundos`, { reintentable: true });
      }
      await esperar(ms);
    }
  };
}

// El cuerpo como JSON; {} si viene vacío o no es JSON (un DELETE contesta {} o nada).
async function leerJson(r) {
  const texto = await r.text().catch(() => '');
  if (!texto) return {};
  try {
    const v = JSON.parse(texto);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

module.exports = { conReintentos, crearCuota, errorExterno, leerJson, msDeRetryAfter, esperarDeVerdad, fetchDe };
