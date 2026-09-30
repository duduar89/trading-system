'use strict';
// Llamadas a servicios de fuera (Google, DataForSEO) con reintentos y cuotas.
//   · Reintentos: ante un 429, un 5xx o un fallo de red se espera y se repite, pocas veces y poco
//     rato (segundos). La espera respeta Retry-After y, si no viene, crece (1, 2, 4… s) con algo de
//     azar, para que dos procesos no vuelvan a la vez. Lo que pide esperar más no se espera aquí: el
//     error sale marcado como «reintentable» y lo reintenta la cola del cron (1, 2, 4, 8 minutos).
//   · Cuotas: como mucho N llamadas por minuto en este proceso. La que no cabe espera su turno si es
//     cuestión de segundos; si no, error reintentable (la cola la repite; en el panel, se dice que
//     espere). Las cuotas de Google son por proyecto y aquí solo se ve este proceso: basta porque el
//     cron hace pocas llamadas por vuelta y las ediciones solo salen del panel; si aun así Google
//     contesta 429, se espera y se reintenta.
// Las esperas son de segundos y dentro de una misma llamada: no programan trabajo (eso es del cron).

const esperarDeVerdad = (ms) => new Promise((ok) => { setTimeout(ok, ms); });

function errorExterno(mensaje, { estado = null, permanente = false, reintentable = false } = {}) {
  const err = new Error(mensaje);
  err.estado = estado;
  err.permanente = permanente;
  err.reintentable = reintentable;
  return err;
}

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
 */
async function conReintentos(hacer, {
  reintentos = 3, baseMs = 1000, topeMs = 8000, maxEsperaMs = 20000,
  esperar = esperarDeVerdad, azar = Math.random, reloj = () => new Date(), nombre = 'el servicio',
} = {}) {
  for (let intento = 0; ; intento++) {
    let r = null;
    let fallo = null;
    try {
      r = await hacer();
    } catch (err) {
      fallo = err;
    }
    if (r && r.status !== 429 && r.status < 500) return r;
    const pedida = r ? msDeRetryAfter(r.headers?.get?.('retry-after'), reloj().getTime()) : null;
    const ms = pedida ?? Math.round(Math.min(topeMs, baseMs * 2 ** intento) * (0.5 + azar()));
    if (intento >= reintentos || ms > maxEsperaMs) {
      if (r) return r;
      const porque = fallo?.name === 'TimeoutError' || fallo?.name === 'AbortError' ? 'tiempo agotado' : 'fallo de red';
      throw errorExterno(`${nombre} no responde (${porque})`, { reintentable: true });
    }
    await esperar(ms);
  }
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

module.exports = { conReintentos, crearCuota, errorExterno, leerJson, msDeRetryAfter, esperarDeVerdad };
