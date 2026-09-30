'use strict';
// Fuente de datos de Alpaca (ARQUITECTURA §3.1, ficha-alpaca §3).
//
// - Cripto: endpoint público v1beta3 SIN cabeceras aunque haya claves, porque
//   una clave mala da 401 incluso ahí (ficha §0.2) y dejaría la mesa ciega.
// - Acciones y noticias: con cabeceras; sin claves no hay (disponible() = false).
// - Un símbolo por petición: el `limit` cuenta sobre todos los símbolos juntos.
// - Solo velas CERRADAS respecto a reloj.ahora(): la vela en curso cambia y
//   usarla sería mirar un precio que la estrategia no tendría en el backtest.
// - Caché en disco por símbolo y marco con el tramo ya cubierto: solo se piden
//   los tramos que faltan.

const path = require('path');
const universo = require('./universo');
const calendarioPorDefecto = require('./calendario');
const { Limitador, pedir } = require('./limitador');
const { leerJSON, escribirJSON } = require('../util/almacen');
const { RelojReal, MIN, HORA, DIA } = require('../util/reloj');

const URL_DATOS = 'https://data.alpaca.markets';
const { MARCOS } = universo;

const iso = ms => new Date(ms).toISOString();

function aVela(b) {
  return { t: Date.parse(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v || 0) };
}

// Une dos listas ascendentes sin duplicados por t (gana la más nueva).
function unir(a, b) {
  if (!a.length) return b.slice();
  if (!b.length) return a.slice();
  const mapa = new Map();
  for (const v of a) mapa.set(v.t, v);
  for (const v of b) mapa.set(v.t, v);
  return [...mapa.values()].sort((x, y) => x.t - y.t);
}

class AlpacaDatos {
  constructor({
    claveId = '', secreto = '', fetch = globalThis.fetch, reloj = new RelojReal(), carpetaCache = null,
    limitador = new Limitador(), calendario = calendarioPorDefecto, timeoutMs = 20_000, maxReintentos = 5,
    dormir, urlDatos = URL_DATOS, limitePagina = 10_000,
    // ultimos() se pide en cada latido y el latido siguiente ya reintenta: con
    // 20 s × 6 intentos + esperas, una red colgada retendría el latido (y con él
    // el kill, el Ctrl+C y los stops) unos 151 s por petición. Así, ~21 s.
    timeoutUltimosMs = 10_000, reintentosUltimos = 1,
  } = {}) {
    if (typeof fetch !== 'function') throw new Error('AlpacaDatos necesita fetch');
    this.claveId = claveId;
    this.secreto = secreto;
    this.hayClaves = Boolean(claveId && secreto);
    this.fetch = fetch;
    this.reloj = reloj;
    this.carpetaCache = carpetaCache;
    this.limitador = limitador;
    this.calendario = calendario;
    this.timeoutMs = timeoutMs;
    this.maxReintentos = maxReintentos;
    this.timeoutUltimosMs = timeoutUltimosMs;
    this.reintentosUltimos = reintentosUltimos;
    this.dormir = dormir || (ms => new Promise(r => setTimeout(r, ms)));
    this.urlDatos = urlDatos.replace(/\/+$/, '');
    this.limitePagina = Math.min(10_000, Math.max(1, limitePagina)); // Alpaca: máx. 10.000 (ficha §3)
    this.cache = new Map();         // clave_marco → { desde, hasta, velas }
    this.peticiones = 0;            // para las pruebas y el panel
  }

  disponible(simbolo) {
    if (universo.esCripto(simbolo)) return true;
    return this.hayClaves;
  }

  _cabeceras() {
    return { 'APCA-API-KEY-ID': this.claveId, 'APCA-API-SECRET-KEY': this.secreto, Accept: 'application/json' };
  }

  async _get(ruta, params, { conClaves, timeoutMs = this.timeoutMs, maxReintentos = this.maxReintentos }) {
    const q = new URLSearchParams(params).toString();
    this.peticiones++;
    const { json } = await pedir({
      fetch: this.fetch, url: `${this.urlDatos}${ruta}?${q}`, metodo: 'GET',
      cabeceras: conClaves ? this._cabeceras() : { Accept: 'application/json' },
      timeoutMs, limitador: this.limitador, reintentar: true,
      maxReintentos, dormir: this.dormir, contexto: `GET ${ruta}`,
    });
    return json || {};
  }

  // ¿La vela que empieza en t está cerrada en `ahora`? Acciones 1Day: cuando
  // termina la sesión de ese día en Nueva York (13:00 en cierre temprano).
  _cerrada(simbolo, marco, t, ahora) {
    const m = MARCOS[marco];
    if (!universo.esCripto(simbolo) && marco === '1Day') {
      const cierre = this.calendario.cierreSesion(this.calendario.diaET(t));
      if (cierre !== null) return cierre <= ahora;
    }
    return t + m <= ahora;
  }

  // Inicio de la última vela cerrada en `ahora`: hasta ahí se pide.
  _horizonte(simbolo, marco, ahora) {
    if (!universo.esCripto(simbolo) && marco === '1Day') {
      const cal = this.calendario;
      let dia = cal.diaET(ahora);
      for (let i = 0; i < 12; i++, dia = cal.sumarDias(dia, -1)) {
        const cierre = cal.cierreSesion(dia);
        // +12 h de holgura por si Alpaca marca la diaria un poco después de las 0:00 ET.
        if (cierre !== null && cierre <= ahora) return cal.msDesdeET(dia, 0, 0) + 12 * HORA;
      }
      return ahora - 12 * DIA;
    }
    return ahora - MARCOS[marco];
  }

  // Una vela recién cerrada tarda en publicarse (la de 19:31 llegó a las 19:32,
  // ficha §3) y puede llegar primero a medias. El tramo cubierto se queda este
  // margen por detrás del cierre para volver a mirar la cola; si no, una vela
  // pedida antes de publicarse faltaría siempre, y una provisional se quedaría así.
  _retraso(simbolo, marco) {
    if (universo.esCripto(simbolo)) return 5 * MIN;
    return marco === '1Day' ? 2 * HORA : 15 * MIN;
  }

  // ¿Falta alguna vela esperada con inicio en (desde, hasta]? Cripto: rejilla
  // UTC de múltiplos del marco. Diarias de acciones: días con sesión. Resto de
  // acciones: no se sabe la rejilla, se da por que falta.
  _faltaCola(entrada, simbolo, marco, desde, hasta) {
    const presentes = new Set();
    for (let i = entrada.velas.length - 1; i >= 0 && entrada.velas[i].t > desde; i--) presentes.add(entrada.velas[i].t);
    const m = MARCOS[marco];
    if (universo.esCripto(simbolo)) {
      for (let t = Math.floor(desde / m) * m + m; t <= hasta; t += m) if (!presentes.has(t)) return true;
      return false;
    }
    if (marco === '1Day') {
      const cal = this.calendario;
      const tiempos = [...presentes].map(t => cal.diaET(t));
      for (let dia = cal.diaET(desde + 1); cal.msDesdeET(dia, 0, 0) <= hasta; dia = cal.sumarDias(dia, 1)) {
        const t0 = cal.msDesdeET(dia, 0, 0);
        if (t0 > desde && cal.esDiaHabil(dia) && !tiempos.includes(dia)) return true;
      }
      return false;
    }
    return true;
  }

  // Hasta dónde se da por cubierta la cola tras pedirla. Cripto: nunca más
  // allá de una vela reciente que falte. Alpaca publica a veces una diaria
  // minutos tarde (29-sep-2026: la revisión vio que una diaria publicada más
  // de 5 min tras las 00:00 UTC no se volvía a pedir nunca, porque `hasta`
  // saltaba por encima de ella). Una vela que falta y tiene menos de
  // GRACIA_COLA de antigüedad frena `hasta` justo antes de ella, así que se
  // vuelve a pedir (como mucho cada 30 s). Un hueco más viejo es un hueco de
  // verdad (SOL estuvo 13 meses sin datos) y no frena nada: si no, cada
  // lectura volvería a pedir todo desde el hueco.
  _hastaFirme(entrada, simbolo, marco, desde, firme) {
    if (!universo.esCripto(simbolo)) return Math.max(desde, firme);
    const m = MARCOS[marco];
    const presentes = new Set();
    for (let i = entrada.velas.length - 1; i >= 0 && entrada.velas[i].t > desde; i--) presentes.add(entrada.velas[i].t);
    const gracia = Math.max(3 * m, DIA);
    for (let t = Math.floor(desde / m) * m + m; t <= firme; t += m) {
      if (!presentes.has(t) && firme - t <= gracia) return Math.max(desde, t - 1);
    }
    return Math.max(desde, firme);
  }

  _rutaCache(simbolo, marco) {
    if (!this.carpetaCache) return null;
    return path.join(this.carpetaCache, 'velas', `${universo.clave(simbolo)}_${marco}.json`);
  }

  _leerCache(simbolo, marco) {
    const k = `${universo.clave(simbolo)}_${marco}`;
    if (this.cache.has(k)) return this.cache.get(k);
    const ruta = this._rutaCache(simbolo, marco);
    let entrada = null;
    if (ruta) {
      const j = leerJSON(ruta, null);
      if (j && Number.isFinite(j.desde) && Number.isFinite(j.hasta) && Array.isArray(j.velas)) {
        entrada = { desde: j.desde, hasta: j.hasta, velas: j.velas.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })) };
      }
    }
    if (entrada) this.cache.set(k, entrada);
    return entrada;
  }

  _guardarCache(simbolo, marco, entrada) {
    this.cache.set(`${universo.clave(simbolo)}_${marco}`, entrada);
    const ruta = this._rutaCache(simbolo, marco);
    if (!ruta) return;
    // Compacto: [t,o,h,l,c,v]; 900 días de 1Hour son ~21.600 velas.
    escribirJSON(ruta, {
      simbolo, marco, desde: entrada.desde, hasta: entrada.hasta,
      velas: entrada.velas.map(v => [v.t, v.o, v.h, v.l, v.c, v.v]),
    });
  }

  // Todas las velas con inicio en [a, b], siguiendo next_page_token.
  async _pedirVelas(simbolo, marco, a, b) {
    const cripto = universo.esCripto(simbolo);
    if (!cripto && !this.hayClaves) return [];
    const ruta = cripto ? '/v1beta3/crypto/us/bars' : '/v2/stocks/bars';
    const base = { symbols: simbolo, timeframe: marco, start: iso(a), end: iso(b), limit: String(this.limitePagina), sort: 'asc' };
    if (!cripto) Object.assign(base, { adjustment: 'all', feed: 'iex' });
    const velas = [];
    let token = null;
    for (let pagina = 0; pagina < 10_000; pagina++) {
      const params = token ? { ...base, page_token: token } : base;
      const json = await this._get(ruta, params, { conClaves: !cripto });
      const lista = (json.bars && json.bars[simbolo]) || [];
      for (const barra of lista) velas.push(aVela(barra));
      token = json.next_page_token || null;
      if (!token) break;
    }
    return velas.filter(v => Number.isFinite(v.t) && v.t >= a && v.t <= b);
  }

  async velas(simbolo, marco, { desde, hasta } = {}) {
    const m = MARCOS[marco];
    if (!m) throw new Error(`marco no admitido: ${marco} (${Object.keys(MARCOS).join(', ')})`);
    if (!this.disponible(simbolo)) return [];
    const ahora = this.reloj.ahora();
    const fin = Number.isFinite(hasta) ? hasta : ahora;
    const ini = Number.isFinite(desde) ? desde : fin - 1000 * m;
    if (ini > fin) return [];
    const horizonte = this._horizonte(simbolo, marco, ahora);
    const tope = Math.min(fin, horizonte);                                   // se pide hasta aquí
    // Se da por cubierto hasta la última vela cerrada hace más del margen de
    // publicación. Se calcula como el horizonte de (ahora − margen), no como
    // horizonte − margen: en la diaria de acciones el horizonte es la
    // medianoche ET + 12 h y restarle 2 h daba por firme la vela del día en
    // cuanto se pedía tras el cierre, publicada o no (y a medias o no).
    const firme = Math.min(fin, this._horizonte(simbolo, marco, ahora - this._retraso(simbolo, marco)));

    let entrada = this._leerCache(simbolo, marco);
    let cambiada = false;
    if (!entrada) {
      if (ini <= tope) {
        // ultimaCola: la cola se acaba de pedir; no se repite antes de 30 s.
        entrada = { desde: ini, hasta: ini - 1, velas: await this._pedirVelas(simbolo, marco, ini, tope), ultimaCola: ahora };
        entrada.hasta = this._hastaFirme(entrada, simbolo, marco, ini - 1, firme);
        cambiada = true;
      }
    } else {
      // Tramos que faltan a cada lado. Si la petición cae lejos del tramo
      // cubierto se rellena el hueco entero, para que la caché siga siendo un
      // único tramo continuo.
      if (ini < entrada.desde) {
        const nuevas = await this._pedirVelas(simbolo, marco, ini, entrada.desde - 1);
        entrada = { ...entrada, desde: ini, velas: unir(nuevas, entrada.velas) };
        cambiada = true;
      }
      // La cola se vuelve a pedir si falta alguna vela o, en acciones, si la
      // última guardada aún no es firme: la diaria puede llegar a medias y se
      // lee durante las 2 h siguientes (Macro, mesas de ETF, caché en disco).
      // En cripto no: la mesa decide con la primera lectura y una revisión
      // entra igual al pedir la vela siguiente; mirarla en cada latido del
      // margen multiplicaría por 6 las peticiones sin cambiar ninguna decisión.
      const ultima = entrada.velas[entrada.velas.length - 1];
      const sinFirmar = !universo.esCripto(simbolo) && Boolean(ultima && ultima.t > entrada.hasta);
      if (tope > entrada.hasta && (sinFirmar || this._faltaCola(entrada, simbolo, marco, entrada.hasta, tope))) {
        // Sin martillear: una vela que de verdad no existe se vuelve a pedir como mucho cada 30 s.
        const reciente = entrada.ultimaCola !== undefined && ahora - entrada.ultimaCola < 30_000 && ahora >= entrada.ultimaCola;
        if (!reciente) {
          const nuevas = await this._pedirVelas(simbolo, marco, entrada.hasta + 1, tope);
          const velasUnidas = unir(entrada.velas, nuevas);
          entrada = { ...entrada, velas: velasUnidas, ultimaCola: ahora };
          entrada.hasta = this._hastaFirme(entrada, simbolo, marco, entrada.hasta, firme);
          cambiada = true;
        }
      }
    }
    if (cambiada && entrada) this._guardarCache(simbolo, marco, entrada);

    const lista = entrada ? entrada.velas : [];
    return lista.filter(v => v.t >= ini && v.t <= fin && this._cerrada(simbolo, marco, v.t, ahora));
  }

  // Último precio. Cripto: punto medio de la última cotización, con su instante
  // exacto. Medido el 29-sep-2026: la cotización va por delante de la vela de
  // 1 minuto (SOL: cotización de hace 36 s, última vela de hace 417 s), y el
  // cierre de esas velas sin operaciones es ese mismo punto medio. Si falta la
  // cotización de algún símbolo, la vela de 1 minuto (t = su inicio, lectura
  // prudente para el límite de antigüedad).
  async ultimos(simbolos) {
    const res = {};
    const cripto = simbolos.filter(s => universo.esCripto(s));
    const acciones = simbolos.filter(s => !universo.esCripto(s));
    const rapido = { timeoutMs: this.timeoutUltimosMs, maxReintentos: this.reintentosUltimos };
    if (cripto.length) {
      const jq = await this._get('/v1beta3/crypto/us/latest/quotes', { symbols: cripto.join(',') }, { conClaves: false, ...rapido });
      for (const s of cripto) {
        const q = jq.quotes && jq.quotes[s];
        const bp = q ? Number(q.bp) : NaN, ap = q ? Number(q.ap) : NaN;
        // demanda = bid (lo que pagan los compradores), oferta = ask.
        if (bp > 0 && ap > 0 && ap >= bp) res[s] = { precio: (bp + ap) / 2, t: Date.parse(q.t), demanda: bp, oferta: ap };
      }
      const faltan = cripto.filter(s => !res[s]);
      if (faltan.length) {
        const jb = await this._get('/v1beta3/crypto/us/latest/bars', { symbols: faltan.join(',') }, { conClaves: false, ...rapido });
        for (const s of faltan) {
          const b = jb.bars && jb.bars[s];
          if (b && Number(b.c) > 0) res[s] = { precio: Number(b.c), t: Date.parse(b.t) };
        }
      }
    }
    if (acciones.length && this.hayClaves) {
      const json = await this._get('/v2/stocks/snapshots', { symbols: acciones.join(','), feed: 'iex' }, { conClaves: true, ...rapido });
      // La doc no deja claro si viene envuelto en `snapshots` (ficha §3): se aceptan las dos formas.
      const mapa = json.snapshots || json;
      for (const s of acciones) {
        const sn = mapa[s];
        if (!sn) continue;
        const tr = sn.latestTrade;
        const barra = sn.minuteBar;
        if (tr && Number.isFinite(Number(tr.p))) res[s] = { precio: Number(tr.p), t: Date.parse(tr.t) };
        else if (barra && Number.isFinite(Number(barra.c))) res[s] = { precio: Number(barra.c), t: Date.parse(barra.t) };
        if (res[s] && sn.prevDailyBar) res[s].cierreAnterior = Number(sn.prevDailyBar.c);
      }
    }
    return res;
  }

  // Noticias de Alpaca (Benzinga). Cripto sin barra en la consulta (ficha §2).
  async noticias(simbolos, { desde, limite = 20 } = {}) {
    if (!this.hayClaves || !simbolos || !simbolos.length) return [];
    const salida = [];
    let token = null;
    while (salida.length < limite) {
      const params = {
        symbols: simbolos.map(universo.clave).join(','),
        limit: String(Math.min(50, limite - salida.length)), // la API admite 1-50
        sort: 'desc',
      };
      if (Number.isFinite(desde)) params.start = iso(desde);
      if (token) params.page_token = token;
      const json = await this._get('/v1beta1/news', params, { conClaves: true });
      for (const n of json.news || []) {
        salida.push({
          id: n.id,
          titular: n.headline || '',
          resumen: n.summary || '',
          fuente: n.source || '',
          autor: n.author || '',
          t: Date.parse(n.created_at),
          url: n.url || null,
          simbolos: (n.symbols || []).map(s => universo.desdeClave(s)),
        });
      }
      token = json.next_page_token || null;
      if (!token || !(json.news || []).length) break;
    }
    return salida.slice(0, limite);
  }
}

module.exports = { AlpacaDatos, URL_DATOS };
