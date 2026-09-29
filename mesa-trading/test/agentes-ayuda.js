'use strict';
// Ayudas para las pruebas de agentes: un fetch falso que apunta lo que se
// envía y devuelve respuestas preparadas, y carpetas temporales.

const fs = require('fs');
const os = require('os');
const path = require('path');

function mensaje({ texto = '{}', stop_reason = 'end_turn', usage, model = 'claude-opus-5-5', content, stop_details = null } = {}) {
  return {
    id: 'msg_prueba',
    type: 'message',
    role: 'assistant',
    model,
    content: content || [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: texto }],
    stop_reason,
    stop_details,
    usage: usage || { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1000 },
  };
}

// respuestas: lista de { status, cuerpo, cabeceras } o de mensajes; se van
// consumiendo en orden (la última se repite).
function fetchFalso(respuestas) {
  const llamadas = [];
  const lista = Array.isArray(respuestas) ? respuestas : [respuestas];
  const fn = async (url, init = {}) => {
    const cabeceras = Object.fromEntries(new Headers(init.headers || {}));
    llamadas.push({ url: String(url), cabeceras, cuerpo: init.body ? JSON.parse(init.body) : null });
    const r = lista[Math.min(llamadas.length - 1, lista.length - 1)];
    const status = r.status || 200;
    const cuerpo = r.status ? r.cuerpo : r;
    return new Response(JSON.stringify(cuerpo), {
      status,
      headers: { 'content-type': 'application/json', 'x-should-retry': 'false', ...(r.cabeceras || {}) },
    });
  };
  fn.llamadas = llamadas;
  return fn;
}

function carpetaTemporal(prefijo = 'agentes-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
}

// Reloj fijo que se puede mover (sin tipo 'simulado': cuenta como el real).
function relojFijo(t) {
  return { t, ahora() { return this.t; }, avanzar(ms) { this.t += ms; return this.t; } };
}

module.exports = { mensaje, fetchFalso, carpetaTemporal, relojFijo };
