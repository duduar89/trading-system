'use strict';
// Precios inventados pero deterministas para la demo, las pruebas y el
// laboratorio (ARQUITECTURA §3.1). Misma semilla + mismo inicio → mismas velas.
//
// Modelo: trayectoria base de 5 minutos para las 6 cripto a la vez, desde
// `inicio − 900 días`. Cada paso:
//   - régimen oculto (alcista / lateral / bajista) con cadena de Markov: cambia
//     la deriva y la volatilidad; duración media ~45 días;
//   - factor común N(0,1) con carga ρ por activo → correlación entre pares
//     ≈ ρᵢ·ρⱼ (0,55-0,72), más un salto común raro para dar colas gordas;
//   - ruido propio N(0,1)·√(1−ρ²).
// Las velas de 1Hour/4Hour/1Day se agregan de esa trayectoria, alineadas a UTC.
// Los precios se anclan para que en `inicio` valgan lo de REFERENCIA.

const universoMod = require('./universo');
const { MIN, DIA, inicioVela } = require('../util/reloj');

const PASO = 5 * MIN;
const ANIO = 365 * DIA;
const DT = PASO / ANIO;
const RAIZ_DT = Math.sqrt(DT);
const PASOS_DIA = DIA / PASO;

// vol = volatilidad anual; rho = carga en el factor común; ref = precio en `inicio`.
const PARAMETROS = Object.freeze({
  'BTC/USD': { vol: 0.55, rho: 0.85, ref: 100000 },
  'ETH/USD': { vol: 0.70, rho: 0.85, ref: 3500 },
  'SOL/USD': { vol: 0.85, rho: 0.80, ref: 180 },
  'LINK/USD': { vol: 0.80, rho: 0.78, ref: 18 },
  'AVAX/USD': { vol: 0.85, rho: 0.78, ref: 30 },
  'DOGE/USD': { vol: 0.90, rho: 0.72, ref: 0.2 },
});
// Orden FIJO de generación: no depende del universo pedido, así una semilla da
// siempre los mismos precios aunque se pidan menos activos.
const SIMBOLOS = Object.freeze(Object.keys(PARAMETROS));

// deriva = rentabilidad logarítmica anual del BTC en ese régimen (los demás,
// escalada por su volatilidad); volMult multiplica la volatilidad.
const REGIMENES = Object.freeze([
  { id: 'alcista', deriva: 0.9, volMult: 0.9, destinos: [0, 0.7, 0.3] },
  { id: 'lateral', deriva: 0.0, volMult: 0.75, destinos: [0.5, 0, 0.5] },
  { id: 'bajista', deriva: -0.8, volMult: 1.35, destinos: [0.3, 0.7, 0] },
]);
const DURACION_MEDIA_PASOS = 45 * PASOS_DIA;
const P_CAMBIO = 1 / DURACION_MEDIA_PASOS;
const P_SALTO = 1 / (15 * PASOS_DIA);   // un salto común cada ~15 días
const SALTO_SIGMA = 0.03;               // del BTC; los demás escalados por vol
const MECHA = 0.8;                      // tamaño máximo de la mecha, en σ del paso

// PRNG sfc32 sembrado con splitmix32: rápido, 128 bits de estado y reproducible.
function crearAleatorio(semilla) {
  let s = (Number(semilla) >>> 0) || 0x9e3779b9;
  const splitmix = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = splitmix(), b = splitmix(), c = splitmix(), d = splitmix();
  const u32 = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 16; i++) u32(); // descarta el arranque
  // Uniforme en (0, 1): nunca 0, para poder tomar logaritmos.
  const uniforme = () => (u32() + 0.5) / 4294967296;
  let reserva = null;
  const normal = () => {
    if (reserva !== null) { const r = reserva; reserva = null; return r; }
    const r = Math.sqrt(-2 * Math.log(uniforme()));
    const th = 2 * Math.PI * uniforme();
    reserva = r * Math.sin(th);
    return r * Math.cos(th);
  };
  return { uniforme, normal, u32 };
}

class DatosSinteticos {
  constructor({ semilla = 42, reloj, universo, inicio, diasHistoria = 900 } = {}) {
    if (!reloj || typeof reloj.ahora !== 'function') throw new Error('DatosSinteticos necesita un reloj');
    this.semilla = semilla;
    this.reloj = reloj;
    this.inicio = Number.isFinite(inicio) ? inicio : reloj.ahora();
    this.origen = inicioVela(this.inicio - diasHistoria * DIA, DIA);
    // Universo pedido (Activo[] o símbolos): solo cuentan las 6 cripto.
    const pedidos = (universo || SIMBOLOS).map(a => (typeof a === 'string' ? a : a.simbolo));
    this.simbolos = pedidos.filter(s => PARAMETROS[s]);
    this.azar = crearAleatorio(semilla);
    this.n = 0;                               // pasos generados
    this.capacidad = 0;
    this.L = SIMBOLOS.map(() => new Float64Array(0));    // log-precio sin anclar; L[k] = tras k pasos
    this.arriba = SIMBOLOS.map(() => new Float32Array(0)); // mecha superior del paso k (en log)
    this.abajo = SIMBOLOS.map(() => new Float32Array(0));
    this.regimen = new Uint8Array(0);
    this.estadoRegimen = 1;                   // se empieza lateral
    this.ancla = null;                        // log(ref) − L[kInicio], por símbolo
    this.kInicio = Math.floor((this.inicio - this.origen) / PASO);
  }

  disponible(simbolo) { return this.simbolos.includes(simbolo); }

  _crecer(minimo) {
    if (minimo + 1 <= this.capacidad) return;
    const nueva = Math.max(minimo + 1, Math.ceil(this.capacidad * 1.5), this.kInicio + 30 * PASOS_DIA + 1);
    const copiar = (viejo, Tipo) => { const x = new Tipo(nueva); x.set(viejo.subarray(0, Math.min(viejo.length, nueva))); return x; };
    this.L = this.L.map(v => copiar(v, Float64Array));
    this.arriba = this.arriba.map(v => copiar(v, Float32Array));
    this.abajo = this.abajo.map(v => copiar(v, Float32Array));
    this.regimen = copiar(this.regimen, Uint8Array);
    this.capacidad = nueva;
  }

  // Genera pasos hasta tener `k` pasos hechos (L[k] definido). Secuencial desde
  // el origen: un único flujo de azar, así el resultado no depende de en qué
  // trozos se pida.
  _asegurar(k) {
    const objetivo = Math.max(k, this.kInicio);
    if (objetivo <= this.n && this.ancla) return;
    this._crecer(objetivo);
    const { uniforme, normal } = this.azar;
    const nS = SIMBOLOS.length;
    const vol = SIMBOLOS.map(s => PARAMETROS[s].vol);
    const rho = SIMBOLOS.map(s => PARAMETROS[s].rho);
    const propio = rho.map(r => Math.sqrt(1 - r * r));
    const escala = vol.map(v => v / PARAMETROS['BTC/USD'].vol);
    if (this.n === 0) {
      for (let i = 0; i < nS; i++) this.L[i][0] = 0;
      this.regimen[0] = this.estadoRegimen;
    }
    for (let k = this.n; k < objetivo; k++) {
      // 1) régimen
      if (uniforme() < P_CAMBIO) {
        const u = uniforme();
        const dest = REGIMENES[this.estadoRegimen].destinos;
        let acum = 0;
        for (let j = 0; j < dest.length; j++) { acum += dest[j]; if (u < acum) { this.estadoRegimen = j; break; } }
      }
      const reg = REGIMENES[this.estadoRegimen];
      this.regimen[k + 1] = this.estadoRegimen;
      // 2) factor común y salto común
      const f = normal();
      const salto = uniforme() < P_SALTO ? normal() * SALTO_SIGMA : 0;
      // 3) cada activo
      for (let i = 0; i < nS; i++) {
        const sigma = vol[i] * reg.volMult;
        const deriva = (reg.deriva * escala[i] - 0.5 * sigma * sigma) * DT;
        const ruido = sigma * RAIZ_DT * (rho[i] * f + propio[i] * normal());
        this.L[i][k + 1] = this.L[i][k] + deriva + ruido + salto * escala[i];
        const s = sigma * RAIZ_DT * MECHA;
        this.arriba[i][k] = s * uniforme();
        this.abajo[i][k] = s * uniforme();
      }
    }
    this.n = Math.max(this.n, objetivo);
    if (!this.ancla) {
      this.ancla = SIMBOLOS.map((s, i) => Math.log(PARAMETROS[s].ref) - this.L[i][this.kInicio]);
    }
  }

  _indice(simbolo) {
    const i = SIMBOLOS.indexOf(simbolo);
    if (i < 0) throw new Error(`DatosSinteticos: ${simbolo} no es una de las 6 cripto sintéticas`);
    return i;
  }

  // Pasos completos en el instante t.
  _pasosEn(t) { return Math.max(0, Math.floor((t - this.origen) / PASO)); }

  async velas(simbolo, marco, { desde, hasta } = {}) {
    return this.velasSinc(simbolo, marco, { desde, hasta });
  }

  // Versión síncrona (el laboratorio agrega muchas series seguidas).
  velasSinc(simbolo, marco, { desde, hasta } = {}) {
    const m = universoMod.MARCOS[marco];
    if (!m) throw new Error(`marco no admitido: ${marco}`);
    if (!this.disponible(simbolo)) return [];
    const i = this._indice(simbolo);
    const ahora = this.reloj.ahora();
    const fin = Number.isFinite(hasta) ? hasta : ahora;
    const ini = Number.isFinite(desde) ? desde : fin - 1000 * m;
    // Solo velas cerradas (t + m ≤ ahora) y completas desde el origen.
    const primera = Math.max(Math.ceil(ini / m) * m, this.origen);
    const ultima = Math.min(Math.floor(fin / m) * m, Math.floor(ahora / m) * m - m);
    if (ultima < primera) return [];
    const porVela = m / PASO;
    this._asegurar((ultima - this.origen) / PASO + porVela);
    const L = this.L[i], arr = this.arriba[i], ab = this.abajo[i], ancla = this.ancla[i];
    const salida = [];
    for (let t = primera; t <= ultima; t += m) {
      const k0 = (t - this.origen) / PASO;
      let hi = -Infinity, lo = Infinity;
      for (let k = k0; k < k0 + porVela; k++) {
        const a = L[k], b = L[k + 1];
        const h = (a > b ? a : b) + arr[k];
        const l = (a < b ? a : b) - ab[k];
        if (h > hi) hi = h;
        if (l < lo) lo = l;
      }
      salida.push({
        t,
        o: Math.exp(L[k0] + ancla),
        h: Math.exp(hi + ancla),
        l: Math.exp(lo + ancla),
        c: Math.exp(L[k0 + porVela] + ancla),
        v: 0, // el volumen no se usa (§2); no se inventa
      });
    }
    return salida;
  }

  // Precio al cierre del último paso de 5 min completado en t.
  precioEn(simbolo, t) {
    const i = this._indice(simbolo);
    const k = this._pasosEn(t);
    this._asegurar(k);
    return Math.exp(this.L[i][k] + this.ancla[i]);
  }

  async ultimos(simbolos) {
    const ahora = this.reloj.ahora();
    const k = this._pasosEn(ahora);
    this._asegurar(k);
    const res = {};
    for (const s of simbolos) {
      if (!this.disponible(s)) continue;
      const i = SIMBOLOS.indexOf(s);
      res[s] = { precio: Math.exp(this.L[i][k] + this.ancla[i]), t: this.origen + k * PASO };
    }
    return res;
  }

  async noticias() { return []; }

  // Régimen oculto en t (para pruebas y para enseñar en la demo qué había debajo).
  regimenEn(t) {
    const k = this._pasosEn(t);
    this._asegurar(k);
    return REGIMENES[this.regimen[k]].id;
  }
}

module.exports = { DatosSinteticos, PARAMETROS, REGIMENES, SIMBOLOS_SINTETICOS: SIMBOLOS, PASO, crearAleatorio };
