'use strict';
// Las referencias de la web pública («web-lipolaser» → su tratamiento del catálogo, su página y su
// especialidad) y los grupos del «¿Qué te interesa?» del formulario. Las genera web/construir.js en
// cada «npm run web» (semillas/iemec/referencias-web.json, en git). Las usan el formulario «Te
// llamamos» (servidor/rutas/web.js) y el primer WhatsApp que llega desde un botón de la web
// (servidor/entrada.js).
const fs = require('fs');
const path = require('path');

const RUTA_REFERENCIAS = path.join(__dirname, '..', 'semillas', 'iemec', 'referencias-web.json');

function cargarReferencias(ruta = RUTA_REFERENCIAS) {
  try {
    const j = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return { referencias: j.referencias || {}, grupos: j.grupos || {} };
  } catch {
    return { referencias: {}, grupos: {} };
  }
}

// La entrada de una referencia, sin tropezar con claves heredadas («constructor»…).
const entradaDe = (referencias, ref) => (ref && Object.prototype.hasOwnProperty.call(referencias, ref) ? referencias[ref] : null);

module.exports = { cargarReferencias, entradaDe, RUTA_REFERENCIAS };
