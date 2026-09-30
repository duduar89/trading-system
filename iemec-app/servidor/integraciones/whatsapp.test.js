'use strict';
// El adaptador de WhatsApp (simulado): lo que se manda en cada plantilla, con su mapa y sus botones,
// tal cual lo pide la Cloud API de Meta. Sin red.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearWhatsApp, componentesPlantilla, parametrosBotones } = require('./whatsapp');

const TOKEN = 'EJEMPLO-token-no-valido-EJEMPLO-token-nova1';
const DIRECCION = 'Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid';

test('la plantilla con su mapa y dos botones de enlace, como la pide la Cloud API', () => {
  assert.deepEqual(componentesPlantilla({
    variables: ['Laura', 'martes 6 de octubre', '17:00'],
    botones: [{ tipo: 'url', indice: 0, valor: TOKEN }, { tipo: 'url', indice: 1, valor: TOKEN }],
    cabecera: { tipo: 'ubicacion', lat: 40.4066059, lng: -3.9001441, nombre: 'IEMEC', direccion: DIRECCION },
  }), [
    { type: 'header', parameters: [{ type: 'location', location: { latitude: '40.4066059', longitude: '-3.9001441', name: 'IEMEC', address: DIRECCION } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Laura' }, { type: 'text', text: 'martes 6 de octubre' }, { type: 'text', text: '17:00' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: TOKEN }] },
    { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: TOKEN }] },
  ]);
  assert.deepEqual(componentesPlantilla({ variables: ['Laura'] }), [{ type: 'body', parameters: [{ type: 'text', text: 'Laura' }] }], 'sin mapa ni botones, solo el cuerpo');
});

test('simulado: guarda lo que se mandaría; botonUrl sigue valiendo (el primer botón de enlace)', async () => {
  const w = crearWhatsApp('simulado');
  await w.enviarPlantilla({ telefono: '+34611000799', nombre: 'iemec_cita_confirmada', variables: ['Laura'], botonUrl: TOKEN });
  assert.deepEqual(w.enviados[0].botones, [{ tipo: 'url', indice: 0, valor: TOKEN }]);
  assert.equal(w.enviados[0].botonUrl, TOKEN);
  assert.equal(w.enviados[0].cabecera, null);
  await w.enviarPlantilla({ telefono: '+34611000799', nombre: 'iemec_recordatorio_2h', variables: ['Laura', '17:00'], botones: [{ tipo: 'url', indice: 0, valor: TOKEN }],
    cabecera: { tipo: 'ubicacion', lat: 40.4066059, lng: -3.9001441, nombre: 'IEMEC', direccion: DIRECCION } });
  assert.equal(w.enviados[1].componentes[0].type, 'header');
  assert.match(w.enviados[1].waId, /^wamid\.SIM[0-9a-f]{16}$/);
  assert.deepEqual(parametrosBotones({}), []);
  assert.throws(() => crearWhatsApp('real'), /puerta/);
});
