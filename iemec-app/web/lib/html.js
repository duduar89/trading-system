'use strict';
// Plantillas como funciones: `html` escapa todo lo que se interpola salvo lo que ya es HTML (`crudo`
// o el resultado de otra plantilla). Así ningún texto de contenido puede meter etiquetas.

class Crudo {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}

const crudo = (s) => new Crudo(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapar = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function valor(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Crudo) return v.s;
  if (Array.isArray(v)) return v.map(valor).join('');
  return escapar(v);
}

function html(partes, ...vals) {
  let s = partes[0];
  for (let i = 0; i < vals.length; i++) s += valor(vals[i]) + partes[i + 1];
  return new Crudo(s);
}

// Texto de contenido: se escapa y los huecos «[PENDIENTE: …]» salen resaltados para la clínica.
const PENDIENTE = /\[PENDIENTE[^\]]*\]/g;
function texto(s) {
  return crudo(escapar(s).replace(PENDIENTE, (m) => `<mark class="pendiente">${m}</mark>`));
}
const pendiente = (s) => texto(`[PENDIENTE: ${s}]`);

// Atributos opcionales: attr('href', x) → ` href="x"` o nada.
const attr = (nombre, v) => (v === null || v === undefined || v === false ? '' : crudo(v === true ? ` ${nombre}` : ` ${nombre}="${escapar(v)}"`));

module.exports = { html, crudo, escapar, texto, pendiente, attr, Crudo, PENDIENTE };
