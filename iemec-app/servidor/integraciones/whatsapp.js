'use strict';
// WhatsApp detrás de un adaptador. «simulado» guarda lo que se enviaría (para pruebas y demo);
// «real» se conecta al proveedor elegido (360dialog con coexistencia o la Cloud API de Meta), que se
// completa cuando la clínica tenga el número dado de alta.
//
// Plantillas: además de las variables del cuerpo, lo que cambia en cada envío de sus botones y su
// cabecera:
//   botones   [{ tipo: 'url', indice, valor }]: el final de la URL de cada botón de enlace (Meta
//             admite una variable, al final: https://…/c/{{1}}); hasta 2 por plantilla
//   cabecera  { tipo: 'ubicacion', lat, lng, nombre, direccion }: el mapa de arriba, que abre la app
//             de mapas del móvil
// `botonUrl` (el valor del primer botón de enlace) se sigue admitiendo.
const crypto = require('crypto');

function botonesDe({ botones = [], botonUrl = null }) {
  if (botones?.length) return botones.map((b, i) => ({ tipo: b.tipo || 'url', indice: b.indice ?? i, valor: String(b.valor) }));
  return botonUrl == null ? [] : [{ tipo: 'url', indice: 0, valor: String(botonUrl) }];
}

// Los componentes del envío de una plantilla, como los pide la Cloud API de Meta.
function componentesPlantilla({ variables = [], botones = [], cabecera = null }) {
  const componentes = [];
  if (cabecera?.tipo === 'ubicacion') {
    componentes.push({ type: 'header', parameters: [{ type: 'location', location: {
      latitude: String(cabecera.lat), longitude: String(cabecera.lng), name: cabecera.nombre, address: cabecera.direccion,
    } }] });
  }
  if (variables.length) componentes.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) });
  for (const b of botones) {
    if (b.tipo === 'url') componentes.push({ type: 'button', sub_type: 'url', index: String(b.indice), parameters: [{ type: 'text', text: b.valor }] });
  }
  return componentes;
}

function crearSimulado() {
  const enviados = [];
  const id = () => `wamid.SIM${crypto.randomBytes(8).toString('hex')}`;
  return {
    modo: 'simulado',
    enviados,
    async enviarTexto({ telefono, texto }) {
      const r = { waId: id(), telefono, tipo: 'texto', texto };
      enviados.push(r);
      return r;
    },
    async enviarPlantilla({ telefono, nombre, idioma = 'es', variables = [], botones = [], cabecera = null, botonUrl = null }) {
      const lista = botonesDe({ botones, botonUrl });
      const r = {
        waId: id(), telefono, tipo: 'plantilla', nombre, idioma, variables, botones: lista, cabecera,
        botonUrl: lista.find((b) => b.tipo === 'url')?.valor ?? null,
        componentes: componentesPlantilla({ variables, botones: lista, cabecera }),
      };
      enviados.push(r);
      return r;
    },
  };
}

function crearWhatsApp(modo = 'simulado') {
  if (modo === 'real') throw new Error('WhatsApp real: falta dar de alta el número con el proveedor (puerta ⛔ en PROGRESO.md)');
  return crearSimulado();
}

module.exports = { crearWhatsApp, componentesPlantilla, botonesDe };
