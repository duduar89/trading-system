'use strict';
// Registro por consola con nivel. LOG_NIVEL=depurar|info|aviso|error (por defecto info).

const NIVELES = { depurar: 10, info: 20, aviso: 30, error: 40, silencio: 99 };
let umbral = NIVELES[process.env.LOG_NIVEL] || NIVELES.info;

function fijarNivel(nombre) { umbral = NIVELES[nombre] ?? umbral; }

function crear(modulo) {
  const salida = (nivel, fn) => (...args) => {
    if (NIVELES[nivel] < umbral) return;
    const hora = new Date().toISOString().slice(11, 19);
    fn(`${hora} [${modulo}]`, ...args);
  };
  return {
    depurar: salida('depurar', console.log),
    info: salida('info', console.log),
    aviso: salida('aviso', console.warn),
    error: salida('error', console.error),
  };
}

module.exports = { crear, fijarNivel };
