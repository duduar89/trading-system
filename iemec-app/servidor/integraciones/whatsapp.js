'use strict';
// WhatsApp detrás de un adaptador. «simulado» guarda lo que se enviaría (para pruebas y demo);
// «real» se conecta al proveedor elegido (360dialog con coexistencia o la Cloud API de Meta), que se
// completa cuando la clínica tenga el número dado de alta.
const crypto = require('crypto');

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
    async enviarPlantilla({ telefono, nombre, idioma = 'es', variables = [], botonUrl = null }) {
      const r = { waId: id(), telefono, tipo: 'plantilla', nombre, idioma, variables, botonUrl };
      enviados.push(r);
      return r;
    },
  };
}

function crearWhatsApp(modo = 'simulado') {
  if (modo === 'real') throw new Error('WhatsApp real: falta dar de alta el número con el proveedor (puerta ⛔ en PROGRESO.md)');
  return crearSimulado();
}

module.exports = { crearWhatsApp };
