'use strict';
// Google Business Profile detrás de un adaptador. «simulado» trabaja con reseñas de ejemplo; «real»
// usa las APIs de la ficha (hace falta el acceso de gestor y la aprobación de Google: puerta ⛔).
function crearSimulado({ resenas = [] } = {}) {
  const publicadas = [];
  return {
    modo: 'simulado',
    publicadas,
    async listarResenas() { return resenas; },
    async responderResena(googleId, texto) { publicadas.push({ googleId, texto }); return { ok: true }; },
  };
}

function crearGoogle(modo = 'simulado', opciones = {}) {
  if (modo === 'real') throw new Error('Google real: falta el acceso de gestor a la ficha y la aprobación de la API (puerta ⛔ en PROGRESO.md)');
  return crearSimulado(opciones);
}

module.exports = { crearGoogle };
