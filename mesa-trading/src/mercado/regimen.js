'use strict';
// Régimen macro (§4.2). Regla FIJA, sin optimizar y sin LLM:
//
//   BTC cierre > SMA200 diaria ............ +1, si no −1
//   BTC SMA50 > SMA200 .................... +1, si no −1
//   Volatilidad 30 d de BTC anualizada > 100 % ... −1 (si no, 0)
//   SPY cierre > SMA200 (si hay datos) .... +1, si no −1
//
//   puntos ≥ 2 → RISK-ON · puntos ≤ −2 → RISK-OFF · si no, NEUTRAL
//
// Un componente sin datos suficientes (menos de 200 velas) suma 0 y se dice
// en el detalle: con poca historia el régimen tiende a NEUTRAL, que es lo
// prudente. La volatilidad de BTC se anualiza con 365 (cripto cotiza a diario).

const { sma, volatilidad } = require('./indicadores');
const { DIA } = require('../util/reloj');
const formato = require('../util/formato');

const UMBRAL_VOL = 1.0;     // 100 % anual
const PERIODOS_CRIPTO = 365;

// Series precalculadas por array de velas: regimenEnFecha se llama en cada vela
// del laboratorio y recalcular la SMA200 cada vez sería O(N²).
const cache = new WeakMap();

function series(velas, conMedias50yVol) {
  if (!Array.isArray(velas) || velas.length === 0) return null;
  const guardado = cache.get(velas);
  const ultimaT = velas[velas.length - 1].t;
  if (guardado && guardado.largo === velas.length && guardado.ultimaT === ultimaT
      && (!conMedias50yVol || guardado.sma50)) return guardado;
  const c = velas.map(v => v.c);
  const s = {
    largo: velas.length,
    ultimaT,
    sma200: sma(c, 200),
    sma50: conMedias50yVol ? sma(c, 50) : null,
    vol30: conMedias50yVol ? volatilidad(c, 30, PERIODOS_CRIPTO) : null,
  };
  cache.set(velas, s);
  return s;
}

// Último índice cuya vela diaria ya había CERRADO en t (v.t + DIA ≤ t).
function ultimoCerrado(velas, t) {
  let lo = 0;
  let hi = velas.length - 1;
  let res = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (velas[m].t + DIA <= t) { res = m; lo = m + 1; } else hi = m - 1;
  }
  return res;
}

function evaluar(btcDiario, iBtc, spyDiario, iSpy) {
  const componentes = [];
  const partes = [];
  let puntos = 0;

  const sb = iBtc >= 0 ? series(btcDiario, true) : null;
  const cBtc = iBtc >= 0 ? btcDiario[iBtc].c : null;
  const s200 = sb ? sb.sma200[iBtc] : null;
  const s50 = sb ? sb.sma50[iBtc] : null;
  const vol = sb ? sb.vol30[iBtc] : null;

  if (s200 !== null && cBtc !== null) {
    const ok = cBtc > s200;
    const p = ok ? 1 : -1;
    puntos += p;
    componentes.push({ nombre: 'btc_sobre_sma200', valor: cBtc, referencia: s200, puntos: p });
    partes.push(`BTC ${formato.precio(cBtc)} ${ok ? '>' : '≤'} SMA200 ${formato.precio(s200)} (${p > 0 ? '+1' : '−1'})`);
  } else {
    componentes.push({ nombre: 'btc_sobre_sma200', valor: cBtc, referencia: null, puntos: 0 });
    partes.push('BTC sin 200 velas diarias (0)');
  }

  if (s200 !== null && s50 !== null) {
    const ok = s50 > s200;
    const p = ok ? 1 : -1;
    puntos += p;
    componentes.push({ nombre: 'btc_sma50_sobre_sma200', valor: s50, referencia: s200, puntos: p });
    partes.push(`SMA50 ${formato.precio(s50)} ${ok ? '>' : '≤'} SMA200 (${p > 0 ? '+1' : '−1'})`);
  } else {
    componentes.push({ nombre: 'btc_sma50_sobre_sma200', valor: s50, referencia: null, puntos: 0 });
  }

  if (vol !== null) {
    const alta = vol > UMBRAL_VOL;
    const p = alta ? -1 : 0;
    puntos += p;
    componentes.push({ nombre: 'btc_vol30', valor: vol, referencia: UMBRAL_VOL, puntos: p });
    partes.push(`vol. 30 d ${formato.pct(vol, { decimales: 0 })} ${alta ? '> 100 % (−1)' : '≤ 100 % (0)'}`);
  } else {
    componentes.push({ nombre: 'btc_vol30', valor: null, referencia: UMBRAL_VOL, puntos: 0 });
  }

  const ss = iSpy >= 0 ? series(spyDiario, false) : null;
  const spy200 = ss ? ss.sma200[iSpy] : null;
  if (spy200 !== null && iSpy >= 0) {
    const cSpy = spyDiario[iSpy].c;
    const ok = cSpy > spy200;
    const p = ok ? 1 : -1;
    puntos += p;
    componentes.push({ nombre: 'spy_sobre_sma200', valor: cSpy, referencia: spy200, puntos: p });
    partes.push(`SPY ${formato.precio(cSpy)} ${ok ? '>' : '≤'} SMA200 ${formato.precio(spy200)} (${p > 0 ? '+1' : '−1'})`);
  } else {
    componentes.push({ nombre: 'spy_sobre_sma200', valor: null, referencia: null, puntos: 0 });
    partes.push('SPY sin datos (0)');
  }

  const valor = puntos >= 2 ? 'RISK-ON' : puntos <= -2 ? 'RISK-OFF' : 'NEUTRAL';
  const signo = puntos > 0 ? `+${puntos}` : String(puntos).replace('-', '−');
  return {
    valor,
    puntos,
    detalle: `${valor} (${signo}): ${partes.join('; ')}`,
    componentes,
    t: iBtc >= 0 ? btcDiario[iBtc].t : null,
  };
}

// Régimen con la ÚLTIMA vela de cada serie (se asume que ya están cerradas,
// como las entrega la fuente de datos).
function calcularRegimen({ btcDiario, spyDiario } = {}) {
  const btc = Array.isArray(btcDiario) ? btcDiario : [];
  const spy = Array.isArray(spyDiario) ? spyDiario : [];
  return evaluar(btc, btc.length - 1, spy, spy.length - 1);
}

// Régimen tal y como se habría visto en el instante t: solo velas diarias
// cerradas en t. Para SPY (vela con marca de medianoche de Nueva York) esto es
// conservador: la da por cerrada un día después de su inicio.
// Se memoriza por par de índices: el laboratorio lo pide en cada vela de cada
// combinación y el texto con cifras (Intl) es lo caro.
const SIN_SPY = [];
function regimenEnFecha(btcDiario, spyDiario, t) {
  const btc = Array.isArray(btcDiario) ? btcDiario : [];
  const spy = Array.isArray(spyDiario) && spyDiario.length ? spyDiario : SIN_SPY;
  const iBtc = ultimoCerrado(btc, t);
  const iSpy = ultimoCerrado(spy, t);
  const sb = btc.length ? series(btc, true) : null;
  if (!sb) return evaluar(btc, iBtc, spy, iSpy);
  if (!sb.memo) sb.memo = new WeakMap();
  let porSpy = sb.memo.get(spy);
  if (!porSpy || porSpy.largo !== spy.length) {
    porSpy = { largo: spy.length, mapa: new Map() };
    sb.memo.set(spy, porSpy);
  }
  const clave = iBtc * 1e6 + (iSpy + 1);
  let r = porSpy.mapa.get(clave);
  if (!r) { r = evaluar(btc, iBtc, spy, iSpy); porSpy.mapa.set(clave, r); }
  return r;
}

module.exports = { calcularRegimen, regimenEnFecha, UMBRAL_VOL };
