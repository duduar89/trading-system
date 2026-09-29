'use strict';
// Cola de peticiones a Alpaca compartida entre datos y trading (ARQUITECTURA
// §3.1). Alpaca corta a 200/min (ficha §3, «Límites»); se va a 180 para dejar
// margen a lo que se haga a mano desde la web de Alpaca mientras corre la mesa.
//
// Usa tiempo real por defecto, no el reloj del sistema: el límite de Alpaca es
// de minutos de verdad aunque la simulación vaya acelerada. Las pruebas
// inyectan `ahora` y `dormir`.

const { errorDesdeRespuesta, errorDeRed } = require('../broker/errores');

const esperarReal = ms => new Promise(r => setTimeout(r, ms));

class Limitador {
  constructor({ maxPorMinuto = 180, ventanaMs = 60_000, ahora = () => Date.now(), dormir = esperarReal } = {}) {
    if (!(maxPorMinuto > 0)) throw new Error('Limitador: maxPorMinuto debe ser > 0');
    this.max = maxPorMinuto;
    this.ventanaMs = ventanaMs;
    this.ahora = ahora;
    this.dormir = dormir;
    this.marcas = [];            // instantes de las peticiones dentro de la ventana
    this.frenadoHasta = 0;       // tras un 429 nadie pide hasta aquí
    this.cola = Promise.resolve();
    this.total = 0;
  }

  // Espera turno y lo apunta. En serie: dos llamadas a la vez no se cuelan juntas.
  turno() {
    const p = this.cola.then(() => this._esperarHueco());
    this.cola = p.catch(() => {});
    return p;
  }

  async ejecutar(fn) {
    await this.turno();
    return fn();
  }

  // Tras un 429 se frena a TODOS (datos y trading comparten la cuota).
  frenar(ms) {
    this.frenadoHasta = Math.max(this.frenadoHasta, this.ahora() + Math.max(0, ms));
  }

  async _esperarHueco() {
    for (;;) {
      const t = this.ahora();
      if (t < this.frenadoHasta) { await this.dormir(this.frenadoHasta - t); continue; }
      while (this.marcas.length && this.marcas[0] <= t - this.ventanaMs) this.marcas.shift();
      if (this.marcas.length < this.max) {
        this.marcas.push(t);
        this.total++;
        return;
      }
      await this.dormir(this.marcas[0] + this.ventanaMs - t + 1);
    }
  }

  estado() {
    const t = this.ahora();
    return {
      enVentana: this.marcas.filter(m => m > t - this.ventanaMs).length,
      max: this.max,
      frenadoHasta: this.frenadoHasta > t ? this.frenadoHasta : null,
      total: this.total,
    };
  }
}

// Espera antes del reintento `intento` (0, 1, 2…): lo que diga Retry-After, o
// X-Ratelimit-Reset si quedan 0; si no, 1-2-4-8…60 s. En los 429 de Alpaca las
// cabeceras pueden faltar (ficha §3), por eso el backoff no depende de ellas.
function esperaReintento(intento, { retryAfter = null, reset = null, restantes = null, ahora = Date.now() } = {}) {
  if (retryAfter !== null && retryAfter !== undefined && retryAfter !== '') {
    const s = Number(retryAfter);
    if (Number.isFinite(s) && s >= 0) return Math.min(120_000, s * 1000);
    const fecha = Date.parse(retryAfter);
    if (Number.isFinite(fecha)) return Math.min(120_000, Math.max(0, fecha - ahora));
  }
  if (restantes !== null && Number(restantes) === 0 && reset !== null && Number.isFinite(Number(reset))) {
    const ms = Number(reset) * 1000 - ahora;
    if (ms > 0) return Math.min(120_000, ms + 250);
  }
  return Math.min(60_000, 1000 * 2 ** Math.max(0, intento));
}

function cabecera(resp, nombre) {
  const h = resp && resp.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(nombre);
  const k = Object.keys(h).find(x => x.toLowerCase() === nombre.toLowerCase());
  return k ? h[k] : null;
}

// Alpaca responde a veces con HTML (401 de nginx sin claves): nunca JSON.parse a ciegas.
function parsear(texto) {
  if (!texto) return null;
  try { return JSON.parse(texto); } catch (_) { return null; }
}

// Una petición HTTP con timeout, turno en el limitador y, si `reintentar`,
// reintentos en 429/5xx/red con backoff. Los POST de órdenes NUNCA pasan
// reintentar: quien envía decide tras consultar por idCliente.
// Devuelve { status, json, texto, resp }; lanza ErrorBroker si no es 2xx
// (salvo los estados de `aceptar`, p. ej. [404] para «no existe»).
async function pedir({
  fetch, url, metodo = 'GET', cabeceras = {}, cuerpo, timeoutMs = 15_000, limitador = null,
  reintentar = false, maxReintentos = 5, dormir = esperarReal, contexto = '', aceptar = [],
}) {
  const init = { method: metodo, headers: { ...cabeceras } };
  if (cuerpo !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  }
  for (let intento = 0; ; intento++) {
    if (limitador) await limitador.turno();
    const ctrl = new AbortController();
    let temporizador;
    const limite = new Promise((_, rechazar) => {
      temporizador = setTimeout(() => {
        ctrl.abort();
        const e = new Error(`timeout de ${timeoutMs} ms`);
        e.name = 'TimeoutError';
        rechazar(e);
      }, timeoutMs);
    });
    let resp, texto;
    try {
      // La carrera con `limite` cubre también un fetch que ignore la señal.
      resp = await Promise.race([fetch(url, { ...init, signal: ctrl.signal }), limite]);
      texto = await Promise.race([typeof resp.text === 'function' ? resp.text() : Promise.resolve(''), limite]);
    } catch (causa) {
      clearTimeout(temporizador);
      const err = errorDeRed(causa, contexto);
      if (reintentar && intento < maxReintentos) { await dormir(esperaReintento(intento)); continue; }
      throw err;
    }
    clearTimeout(temporizador);
    const json = parsear(texto);
    const status = resp.status;
    if ((status >= 200 && status < 300) || aceptar.includes(status)) return { status, json, texto, resp };

    const err = errorDesdeRespuesta(status, json !== null ? json : texto, contexto);
    const espera = esperaReintento(intento, {
      retryAfter: cabecera(resp, 'retry-after'),
      reset: cabecera(resp, 'x-ratelimit-reset'),
      restantes: cabecera(resp, 'x-ratelimit-remaining'),
      ahora: limitador ? limitador.ahora() : Date.now(),
    });
    // Un 429 frena la cola entera, se reintente o no esta petición.
    if (status === 429 && limitador) limitador.frenar(espera);
    if (err.reintentable && reintentar && intento < maxReintentos) {
      if (!(status === 429 && limitador)) await dormir(espera); // con limitador ya espera turno()
      continue;
    }
    throw err;
  }
}

module.exports = { Limitador, esperaReintento, pedir, parsear, cabecera };
