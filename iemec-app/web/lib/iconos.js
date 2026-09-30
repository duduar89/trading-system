'use strict';
// Iconos de línea fina propios (32 × 32, trazo de 1,4, puntas redondeadas). Cada página lleva en un
// <svg> oculto solo los que usa y los cita con <use href="#i-…">: sin peticiones de más.
const { crudo } = require('./html');

const P = (d) => `<path d="${d}"/>`;
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const E = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;

const flor = P('M16 27c-6 0-10.5-4-10.5-9.5 4.2 0 7.8 2 10.5 5.2 2.7-3.2 6.3-5.2 10.5-5.2C26.5 23 22 27 16 27z')
  + P('M16 22.6c-2.4-3-3.6-6.6-3.6-9.8 0-3 1.3-5.9 3.6-8 2.3 2.1 3.6 5 3.6 8 0 3.2-1.2 6.8-3.6 9.8z');
const foliculo = P('M16 28v-9') + P('M16 19a5 5 0 1 1 0-10 5 5 0 0 1 0 10z') + P('M25 4v6M22 7h6');
const hoja = P('M7 25C7 14 14 7.5 26 6.5 26 18 19 25 7 25z') + P('M7 25 18.5 13.5');
const bisturi = P('M4.5 27.5 14 18') + P('M14 18l3 3 9.5-9.5c1.2-1.2 1.2-3.2 0-4.4s-3.2-1.2-4.4 0z');

const ICONOS = {
  // Especialidades
  facial: P('M16 4.5c-5.2 0-8.7 4-8.7 9.6 0 6.6 4.1 13.4 8.7 13.4s8.7-6.8 8.7-13.4c0-5.6-3.5-9.6-8.7-9.6z') + P('M12.2 13.4c1-.7 2.1-.7 3 0M16.8 13.4c1-.7 2.1-.7 3 0') + P('M13.5 21.2c1.6 1.1 3.4 1.1 5 0') + P('M26.5 4.5v4M24.5 6.5h4'),
  corporal: P('M11 4c.4 5 2 7.4 2 10.4S10.2 19.6 10.2 23c0 2.6 1.6 4.6 1.6 5') + P('M21 4c-.4 5-2 7.4-2 10.4s2.8 5.2 2.8 8.6c0 2.6-1.6 4.6-1.6 5') + P('M13 14.4c1.9.9 4.1.9 6 0'),
  peso: hoja,
  capilar: P('M9.5 4.5c-2.2 5.2 2.2 9.3 0 14.5-1.3 3.2.2 6.6 1.5 8.5') + P('M16 4c-2.2 5.2 2.2 9.3 0 14.5-1.3 3.2.2 7 1.5 9') + P('M22.5 4.5c-2.2 5.2 2.2 9.3 0 14.5-1.3 3.2.2 6.6 1.5 8.5'),
  injerto: foliculo,
  intima: flor,
  cirugia: bisturi,
  masculina: C(13, 19, 8) + P('M18.8 13.2 27 5M21 5h6v6'),
  // Preocupaciones
  arrugas: P('M5 10.5c3-2.2 5.4 1.8 8.2 0s5.4-2.2 8.2 0 4.2 1.4 5.6.6') + P('M5 16c3-2.2 5.4 1.8 8.2 0s5.4-2.2 8.2 0 4.2 1.4 5.6.6') + P('M5 21.5c3-2.2 5.4 1.8 8.2 0s5.4-2.2 8.2 0 4.2 1.4 5.6.6'),
  volumen: P('M9 5.5c-1.2 5.4-1.1 10.6 1 14.8 2 4 4 6.2 6 6.2s4-2.2 6-6.2c2.1-4.2 2.2-9.4 1-14.8') + P('M10.8 14.5c1.6 1.2 3.4 1.2 4.6 0M16.6 14.5c1.2 1.2 3 1.2 4.6 0'),
  flacidez: P('M4.5 12c4.4 0 6.3 10.5 11.5 10.5S23.1 12 27.5 12') + P('M16 17.5V5.5M12.5 9 16 5.5 19.5 9'),
  manchas: C(10, 11, 3) + C(20.5, 9, 1.8) + C(21, 20.5, 3.6) + C(10.5, 22.5, 1.6),
  acne: C(9, 10, 1.4) + C(16, 8, 1.1) + C(23, 11, 1.4) + C(12, 17, 1.1) + C(20, 17.5, 2.6) + C(10, 24, 1.4) + C(17, 24.5, 1.1),
  piel: P('M14 4.5c.8 6 3 8.7 8.8 11.5C17 18.8 14.8 21.5 14 27.5c-.8-6-3-8.7-8.8-11.5C11 13.2 13.2 10.5 14 4.5z') + P('M24.5 4.5c.3 2.2 1.1 3.1 3 4-1.9.9-2.7 1.8-3 4-.3-2.2-1.1-3.1-3-4 1.9-.9 2.7-1.8 3-4z'),
  mirada: P('M3.5 15.5C7.6 9.9 11.8 7 16 7s8.4 2.9 12.5 8.5C24.4 21.1 20.2 24 16 24S7.6 21.1 3.5 15.5z') + C(16, 15.5, 3.8) + P('M9.5 27c4.2 1.6 8.8 1.6 13 0'),
  labios: P('M4 16c3-4 6-6 8.6-5.1 1.4.5 2.4 1.1 3.4 1.1s2-.6 3.4-1.1C22 10 25 12 28 16') + P('M4 16c3.4 5 7.4 7.2 12 7.2s8.6-2.2 12-7.2') + P('M4 16h24'),
  caida: P('M10 4c-1.6 4 1.6 7.2 0 11.2M16 4c-1.6 4 1.6 7.2 0 11.2M22 4c-1.6 4 1.6 7.2 0 11.2') + P('M12.5 21c-1 2 1 3.2 0 5.2M19.5 23c-1 2 1 3.2 0 5.2'),
  grasa: P('M9 4c1 6-2 9-2 13s3 7 3 11M23 4c-1 6 2 9 2 13s-3 7-3 11') + C(16, 17, 3.2),
  celulitis: P('M4 23c3-3 5.2 0 8-2s5.2-3 8-1 5.2 2 8 0') + P('M7 15.5c1 1.1 2.1 1.1 3.1 0M14.5 13c1 1.1 2.1 1.1 3.1 0M21.9 15.5c1 1.1 2.1 1.1 3.1 0M11 9.5c.8.9 1.7.9 2.5 0M18.5 9.5c.8.9 1.7.9 2.5 0'),
  liquidos: P('M16 4c5 6.8 8.2 11 8.2 15.2a8.2 8.2 0 0 1-16.4 0C7.8 15 11 10.8 16 4z') + P('M11.8 20c.4 2.2 2 3.8 4.2 4'),
  varices: P('M16 4v8c0 3-4 4.2-4 8s4 5 4 8') + P('M16 12.4c2.4 0 5 1.2 6.2 4.2M12 20c-2.2 0-4.2 1.2-5.2 3.2'),
  vello: P('M10 25V14c0-3 2-5 2-8M16 25V12c0-3 2-5 2-7M22 25V15c0-3 2-5 2-7') + P('M6 25.5h20'),
  bienestar: E(16, 24.2, 8, 2.8) + E(16, 17.8, 5.8, 2.4) + E(16, 12.2, 3.8, 2) + P('M16 10.2c0-3 1.6-5 4.2-5.8-.2 2.8-1.8 4.8-4.2 5.8z'),
  // Interfaz
  whatsapp: P('M16 4.2A11.8 11.8 0 0 0 5.8 21.9L4.2 27.8l6.1-1.6A11.8 11.8 0 1 0 16 4.2z') + P('M12.1 10.6c-.5 0-1 .3-1.2.8-.7 1.5.2 3.6 1.9 5.4 1.8 2 4 3.3 5.6 3.4.7 0 1.2-.3 1.5-.8l.5-.9c.2-.4 0-.8-.3-1l-2-1c-.4-.2-.8-.1-1 .2l-.6.8c-1.3-.5-2.6-1.7-3.2-3l.7-.7c.3-.3.3-.7.2-1l-.9-2c-.2-.4-.5-.5-.9-.5z'),
  telefono: P('M9 4.8h3.6l2 6.1-3 2c1.5 3.6 4 6.1 7.5 7.6l2-3 6.1 2v3.6c0 1.4-1.1 2.5-2.5 2.5C14 25.6 6.4 18 6.5 7.3 6.5 5.9 7.6 4.8 9 4.8z'),
  calendario: P('M6 8.5h20v18H6z') + P('M6 13.5h20M11 5v6M21 5v6') + P('M12 20l2.6 2.6L20 17.2'),
  pin: P('M16 28.5s8.8-8.2 8.8-15.5a8.8 8.8 0 0 0-17.6 0c0 7.3 8.8 15.5 8.8 15.5z') + C(16, 13, 3.2),
  reloj: C(16, 16, 11) + P('M16 9.5V16l4.2 2.6'),
  menu: P('M6 9h20M9.5 16h13M6 23h20'),
  cerrar: P('M8.5 8.5l15 15M23.5 8.5l-15 15'),
  flecha: P('M5 16h21M19 9l7 7-7 7'),
  buscar: C(14, 14, 8.2) + P('M20 20l7 7'),
  check: P('M6 16.5l6 6L26 9'),
  bajar: P('M9 12.5l7 7 7-7'),
  escudo: P('M16 4l10 4v7.2c0 6.8-4.4 11.3-10 12.8-5.6-1.5-10-6-10-12.8V8z') + P('M11.5 16l3.2 3.2 6-6.4'),
  regalo: P('M5.5 12.5h21v5h-21zM7.5 17.5h17v10h-17zM16 12.5v15') + P('M16 12.5c-2-4.8-8.2-6.2-8.2-2.4 0 2 3.4 2.4 8.2 2.4zM16 12.5c2-4.8 8.2-6.2 8.2-2.4 0 2-3.4 2.4-8.2 2.4z'),
  correo: P('M5 8.5h22v15H5z') + P('M5.5 9l10.5 8.2L26.5 9'),
  medico: P('M9 4.5v7a5 5 0 0 0 10 0v-7') + P('M14 16.5v3.5a6 6 0 0 0 12 0v-1.8') + C(26, 16.2, 2),
  tecnologia: C(16, 16, 1.6) + P('M11.8 11.8a6 6 0 0 0 0 8.4M20.2 11.8a6 6 0 0 1 0 8.4M8.6 8.6a10.5 10.5 0 0 0 0 14.8M23.4 8.6a10.5 10.5 0 0 1 0 14.8'),
  plan: P('M9 5.5h14v21H9z') + P('M12.5 11h7M12.5 15.5h7M12.5 20h4.5'),
  seguimiento: P('M5 22.5l6-6 4.5 4.5L27 9.5') + P('M20.5 9.5H27V16'),
  valoracion: C(14, 14, 8.2) + P('M20 20l7 7') + P('M10.5 14l2.4 2.4 4.6-4.6'),
  tratamiento: P('M16 4.5c.8 6 3 8.7 8.8 11.5C19 18.8 16.8 21.5 16 27.5c-.8-6-3-8.7-8.8-11.5C13 13.2 15.2 10.5 16 4.5z'),
  instagram: P('M9.5 5h13A4.5 4.5 0 0 1 27 9.5v13a4.5 4.5 0 0 1-4.5 4.5h-13A4.5 4.5 0 0 1 5 22.5v-13A4.5 4.5 0 0 1 9.5 5z') + C(16, 16, 5) + C(22.6, 9.4, 0.6),
  facebook: P('M18.5 27V17h3.4l.5-4h-3.9v-2.5c0-1.2.4-2 2-2h2.1V5.1c-.4 0-1.6-.1-3-.1-3 0-5.1 1.8-5.1 5.2V13H11v4h3.5v10'),
  tiktok: P('M17.5 4.5v15.3a4.7 4.7 0 1 1-4.7-4.7') + P('M17.5 4.5c.5 3.4 2.7 5.6 6.4 5.9'),
  linkedin: P('M6 12.5h4.2V26H6zM8.1 5.5a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z') + P('M14 12.5h4v2c.8-1.4 2.4-2.4 4.6-2.4 3.6 0 4.4 2.4 4.4 5.6V26h-4.2v-7.4c0-1.8-.3-3.2-2.1-3.2-2 0-2.5 1.4-2.5 3.2V26H14z'),
};

// Cada especialidad y cada preocupación, con su icono.
const ALIAS = {
  'medicina-estetica-facial': 'facial', 'medicina-estetica-corporal': 'corporal', 'perdida-de-peso': 'peso',
  'medicina-capilar': 'capilar', 'cirugia-capilar': 'injerto', 'ginecologia-estetica': 'intima', 'cirugia-estetica': 'cirugia',
  'salud-sexual-masculina': 'masculina',
  arrugas: 'arrugas', 'volumen-y-contorno': 'volumen', flacidez: 'flacidez', manchas: 'manchas', 'acne-y-poros': 'acne',
  'calidad-de-piel': 'piel', 'mirada-y-ojeras': 'mirada', labios: 'labios', 'caida-del-cabello': 'caida', injerto: 'injerto',
  'grasa-localizada': 'grasa', celulitis: 'celulitis', 'retencion-de-liquidos': 'liquidos', peso: 'peso', 'zona-intima': 'intima',
  varices: 'varices', vello: 'vello', bienestar: 'bienestar', cirugia: 'cirugia',
};

// Los iconos que usa la página que se está pintando (el generador pinta una página cada vez).
let usados = new Set();
function empezarPagina() { usados = new Set(); }

function icono(nombre, clase = '') {
  const id = ALIAS[nombre] || nombre;
  if (!ICONOS[id]) throw new Error(`Icono desconocido: ${nombre}`);
  usados.add(id);
  return crudo(`<svg class="icono${clase ? ` ${clase}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${id}"/></svg>`);
}

function sprite() {
  const ids = [...usados].sort();
  if (!ids.length) return crudo('');
  const simbolos = ids.map((id) => `<symbol id="i-${id}" viewBox="0 0 32 32">${ICONOS[id]}</symbol>`).join('');
  return crudo(`<svg class="sprite" aria-hidden="true" focusable="false"><defs>${simbolos}</defs></svg>`);
}

module.exports = { ICONOS, ALIAS, icono, sprite, empezarPagina };
