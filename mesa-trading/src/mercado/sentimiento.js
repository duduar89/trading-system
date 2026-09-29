'use strict';
// Índice de miedo y codicia de alternative.me (ARQUITECTURA §3.2, ficha §3).
// Es diario (timestamp a las 00:00 UTC) y los valores llegan como string.
//
// La etiqueta se TRADUCE de la que da la API (value_classification); no se
// calcula con umbrales propios. Solo el modo sintético, que no tiene API,
// necesita bandas: son las que la propia API aplicó en 3.159 días (feb-2018 a
// sep-2026, medido el 29-sep-2026), no unas inventadas.

const path = require('path');
const { pedir } = require('./limitador');
const { leerJSON, escribirJSON } = require('../util/almacen');
const { RelojReal, HORA, DIA, diaUTC, inicioVela } = require('../util/reloj');

const URL_FNG = 'https://api.alternative.me/fng/';

const ETIQUETAS = Object.freeze({
  'Extreme Fear': 'Miedo extremo',
  Fear: 'Miedo',
  Neutral: 'Neutral',
  Greed: 'Codicia',
  'Extreme Greed': 'Codicia extrema',
});

// [valor máximo, clasificación de la API] observados en su histórico.
const BANDAS_MEDIDAS = Object.freeze([[25, 'Extreme Fear'], [46, 'Fear'], [54, 'Neutral'], [75, 'Greed'], [100, 'Extreme Greed']]);

// Si llega una clasificación nueva, se enseña tal cual antes que inventar una traducción.
function traducir(clasificacion) {
  return ETIQUETAS[clasificacion] || String(clasificacion || '');
}

function clasificarMedido(valor) {
  for (const [max, c] of BANDAS_MEDIDAS) if (valor <= max) return c;
  return 'Extreme Greed';
}

// Modo sintético: rentabilidad de 30 días del BTC sintético → 0-100 con una
// logística (±12 % ≈ 27/73). Es un indicador de juguete para la demo, marcado
// `sintetico: true` en todo lo que devuelve.
function valorSintetico(r30) {
  return Math.round(100 / (1 + Math.exp(-r30 / 0.12)));
}

class MiedoCodicia {
  constructor({ fetch = globalThis.fetch, reloj = new RelojReal(), carpetaCache = null, sintetico = null, timeoutMs = 15_000, dormir } = {}) {
    this.fetch = fetch;
    this.reloj = reloj;
    this.carpetaCache = carpetaCache;
    this.sintetico = sintetico || null;
    this.timeoutMs = timeoutMs;
    this.dormir = dormir;
    this._actual = null;       // { dato, pedido }
    this._historico = null;    // { datos, descargado }
  }

  async _pedir(limite) {
    const opciones = {
      fetch: this.fetch, url: `${URL_FNG}?limit=${limite}&format=json`, timeoutMs: this.timeoutMs,
      reintentar: true, maxReintentos: 2, contexto: 'miedo y codicia',
    };
    if (this.dormir) opciones.dormir = this.dormir;
    const { json } = await pedir(opciones);
    if (!json || !Array.isArray(json.data)) throw new Error('miedo y codicia: respuesta sin data');
    return json.data;
  }

  // { valor, etiqueta, t } o null si no hay forma de saberlo. Caché de 1 h.
  async actual() {
    const ahora = this.reloj.ahora();
    if (this.sintetico) return this._actualSintetico(ahora);
    if (this._actual && ahora - this._actual.pedido < HORA) return this._actual.dato;
    try {
      const [d] = await this._pedir(1);
      if (!d) return this._actual ? this._actual.dato : null;
      const dato = { valor: Number(d.value), etiqueta: traducir(d.value_classification), t: Number(d.timestamp) * 1000 };
      this._actual = { dato, pedido: ahora };
      return dato;
    } catch (_) {
      // Sin red se sigue con el último conocido: es un dato diario.
      return this._actual ? this._actual.dato : null;
    }
  }

  // [{ dia, valor, etiqueta }] ascendente, todo el histórico (?limit=0).
  // Caché en disco 24 h.
  async historico() {
    const ahora = this.reloj.ahora();
    if (this.sintetico) return this._historicoSintetico(ahora);
    if (this._historico && ahora - this._historico.descargado < DIA) return this._historico.datos;
    const ruta = this.carpetaCache ? path.join(this.carpetaCache, 'miedo-codicia.json') : null;
    if (!this._historico && ruta) {
      const j = leerJSON(ruta, null);
      if (j && Array.isArray(j.datos) && Number.isFinite(j.descargado)) this._historico = j;
      if (this._historico && ahora - this._historico.descargado < DIA) return this._historico.datos;
    }
    try {
      const data = await this._pedir(0);
      const porDia = new Map();
      for (const d of data) {
        const dia = diaUTC(Number(d.timestamp) * 1000);
        porDia.set(dia, { dia, valor: Number(d.value), etiqueta: traducir(d.value_classification) });
      }
      const datos = [...porDia.values()].sort((a, b) => (a.dia < b.dia ? -1 : 1));
      this._historico = { datos, descargado: ahora };
      if (ruta) escribirJSON(ruta, this._historico);
      return datos;
    } catch (e) {
      if (this._historico) return this._historico.datos;   // caducado, pero mejor que nada
      throw e;
    }
  }

  // Valor del día D: rentabilidad de las 30 velas diarias cerradas antes de
  // las 00:00 UTC de D (causal: no usa nada del propio día D).
  _valorDia(cierres, idx) {
    const r30 = cierres[idx] / cierres[idx - 30] - 1;
    const valor = valorSintetico(r30);
    return { valor, etiqueta: traducir(clasificarMedido(valor)) };
  }

  _cierresBTC(hasta, desde = this.sintetico.origen) {
    return this.sintetico.velasSinc('BTC/USD', '1Day', { desde, hasta });
  }

  _actualSintetico(ahora) {
    const hoy = inicioVela(ahora, DIA);
    const velas = this._cierresBTC(hoy, hoy - 40 * DIA);   // bastan las 31 últimas
    if (velas.length < 31) return null;
    const cierres = velas.map(v => v.c);
    const { valor, etiqueta } = this._valorDia(cierres, cierres.length - 1);
    return { valor, etiqueta, t: hoy, sintetico: true };
  }

  _historicoSintetico(ahora) {
    const velas = this._cierresBTC(ahora);
    const cierres = velas.map(v => v.c);
    const salida = [];
    // La vela i cierra al empezar el día de la vela i+1.
    for (let i = 30; i < velas.length; i++) {
      const { valor, etiqueta } = this._valorDia(cierres, i);
      salida.push({ dia: diaUTC(velas[i].t + DIA), valor, etiqueta, sintetico: true });
    }
    return salida;
  }
}

// Valor vigente en t según un histórico ascendente (el del día UTC de t o el anterior).
function valorEn(historico, t) {
  const dia = diaUTC(t);
  let lo = 0, hi = historico.length - 1, res = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (historico[mid].dia <= dia) { res = historico[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

module.exports = { MiedoCodicia, ETIQUETAS, BANDAS_MEDIDAS, traducir, valorSintetico, valorEn, URL_FNG };
