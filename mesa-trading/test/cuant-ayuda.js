'use strict';
// Ayudas de las pruebas del constructor A (cuant): series sintéticas propias y
// deterministas, para no depender del módulo sintético de B. Este fichero no
// tiene pruebas (node --test lo carga y no encuentra ninguna).

const DIA = 86_400_000;
const T0 = Date.UTC(2020, 0, 6); // lunes

// mulberry32: generador pequeño con semilla (misma semilla → misma serie).
function prng(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// Paseo aleatorio con tendencias que cambian (seno lento) y volatilidad
// diaria ~3 %. Cada vela sale de 4 subpasos: el alto y el bajo son reales.
function serieSintetica(n, semilla, { marcoMs = DIA, p0 = 100, t0 = T0, vol = 0.03, deriva = 0.002, comun = null } = {}) {
  const r = prng(semilla);
  const out = [];
  let p = p0;
  for (let i = 0; i < n; i++) {
    const o = p;
    let h = o; let l = o; let c = o;
    const d = Math.sin(i / 150 + semilla) * deriva;
    for (let k = 0; k < 4; k++) {
      const z = comun ? 0.7 * comun[i * 4 + k] + 0.71 * gauss(r) : gauss(r);
      c = c * Math.exp(d / 4 + (vol / 2) * z);
      if (c > h) h = c;
      if (c < l) l = c;
    }
    out.push({ t: t0 + i * marcoMs, o, h, l, c, v: 0 });
    p = c;
  }
  return out;
}

// Varias series correlacionadas (factor común), como las cripto.
function cestaSintetica(simbolos, n, semilla = 1, opciones = {}) {
  const r = prng(semilla * 7919);
  const comun = Array.from({ length: n * 4 }, () => gauss(r));
  const out = {};
  simbolos.forEach((s, k) => { out[s] = serieSintetica(n, semilla * 100 + k + 1, { ...opciones, comun }); });
  return out;
}

// Vela a mano: [o, h, l, c] en el día i.
function velasAMano(filas, { t0 = T0, marcoMs = DIA } = {}) {
  return filas.map(([o, h, l, c], i) => ({ t: t0 + i * marcoMs, o, h, l, c, v: 0 }));
}

// Límites que no recortan nada, para aislar la mecánica del motor.
const LIMITES_ABIERTOS = Object.freeze({ riesgoPorOperacion: 1, maxPesoPorActivo: 1, minNocionalOrden: 0 });

// Estrategia de guion para probar el motor: abre en `abrirEn` con `stop`,
// cierra en `cerrarEn`, y el trailing devuelve lo que diga `trailingEn[i]`.
function estrategiaGuion(guion) {
  return {
    familia: 'guion',
    marco: guion.marco || '1Day',
    parametrosPorDefecto: {},
    rejilla: {},
    calentamiento: () => 0,
    preparar: (velas, params) => ({ velas, params }),
    decidir: (prep, { simbolo, i, posicion }) => {
      const g = guion.porSimbolo ? guion.porSimbolo[simbolo] || {} : guion;
      if (!posicion && i === g.abrirEn) return { accion: 'abrir', peso: g.peso ?? 1, stop: g.stop ?? null, objetivoPrecio: null, motivo: '', estado: '' };
      if (posicion && i === g.cerrarEn) return { accion: 'cerrar', peso: 0, stop: null, objetivoPrecio: null, motivo: '', estado: '' };
      return { accion: posicion ? 'mantener' : 'nada', peso: 0, stop: null, objetivoPrecio: null, motivo: '', estado: '' };
    },
    trailing: (prep, { simbolo, i }) => {
      const g = guion.porSimbolo ? guion.porSimbolo[simbolo] || {} : guion;
      return g.trailingEn && g.trailingEn[i] !== undefined ? g.trailingEn[i] : null;
    },
  };
}

// Costes fijos de las pruebas: comisión 0,25 %, deslizamiento 5 pb, penalización 10 pb.
const COSTES_PRUEBA = Object.freeze({ comision: () => 0.0025, deslizamiento: () => 0.0005, penalizacion: 0.001 });

module.exports = { DIA, T0, prng, gauss, serieSintetica, cestaSintetica, velasAMano, LIMITES_ABIERTOS, estrategiaGuion, COSTES_PRUEBA };
