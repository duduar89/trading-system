'use strict';
// Lo que la web pública le deja a la app en semillas/iemec/ (lo genera web/construir.js en cada
// «npm run web»; va en git y se despliega con la app):
//   · referencias-web.json: las referencias («web-lipolaser» → su tratamiento del catálogo, su página y
//     su especialidad) y los grupos del «¿Qué te interesa?» del formulario. Las usan el formulario «Te
//     llamamos» (servidor/rutas/web.js) y el primer WhatsApp que llega desde un botón de la web
//     (servidor/entrada.js).
//   · textos-formulario.json: cada versión de los textos del formulario (la capa básica de protección de
//     datos y las dos casillas) con sus textos exactos, las de antes también. La prueba del
//     consentimiento guarda la versión que dice el formulario, y aquí se sabe qué texto aceptó.
const fs = require('fs');
const path = require('path');

const CARPETA = path.join(__dirname, '..', 'semillas', 'iemec');
const RUTA_REFERENCIAS = path.join(CARPETA, 'referencias-web.json');
const RUTA_TEXTOS = path.join(CARPETA, 'textos-formulario.json');

const leerJson = (ruta) => {
  try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { return null; }
};

function cargarReferencias(ruta = RUTA_REFERENCIAS) {
  const j = leerJson(ruta) || {};
  return { referencias: j.referencias || {}, grupos: j.grupos || {} };
}

function cargarTextosFormulario(ruta = RUTA_TEXTOS) {
  const j = leerJson(ruta) || {};
  return { actual: j.actual || null, versiones: j.versiones || {} };
}

// La entrada de una referencia, sin tropezar con claves heredadas («constructor»…).
const entradaDe = (referencias, ref) => (ref && Object.prototype.hasOwnProperty.call(referencias, ref) ? referencias[ref] : null);

module.exports = { cargarReferencias, cargarTextosFormulario, entradaDe, RUTA_REFERENCIAS, RUTA_TEXTOS };
