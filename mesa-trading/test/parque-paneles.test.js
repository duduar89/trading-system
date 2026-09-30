'use strict';
// Parqué · textos de los paneles que no necesitan navegador: directivas del
// Megáfono, franja de conexión, criterios del laboratorio y rentabilidad del fondo.
const test = require('node:test');
const assert = require('node:assert/strict');
const paneles = require('../web/js/paneles.js');

const MESAS = [{ id: 'reversion', nombre: 'Reversión RSI' }, { id: 'lab3', nombre: 'Tendencia SMA 14/60' }];

test('Megáfono: la propuesta nombra la mesa como la ve Eduardo, no por su id', () => {
  assert.equal(paneles.textoDirectiva({ tipo: 'pausar_mesa', mesaId: 'reversion', horas: 6 }, MESAS), 'Pausar la mesa Reversión RSI durante 6 h.');
  assert.equal(paneles.textoDirectiva({ tipo: 'reanudar_mesa', mesaId: 'lab3' }, MESAS), 'Quitar la pausa del Megáfono a la mesa Tendencia SMA 14/60.');
  // Sin la lista (o con una mesa que ya no existe) se queda el id: nunca «undefined».
  assert.equal(paneles.textoDirectiva({ tipo: 'pausar_mesa', mesaId: 'reversion', horas: 6 }), 'Pausar la mesa reversion durante 6 h.');
  assert.equal(paneles.textoDirectiva({ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 6 }, MESAS), 'No abrir en SOL durante 6 h.');
});

test('Megáfono: el motivo de «sin efecto» (escrito por el LLM) se acota', () => {
  const largo = 'La exposición bruta ya está en el 87 % '.repeat(20);
  const t = paneles.textoDirectiva({ tipo: 'sin_efecto', motivo: largo });
  assert.ok(t.length <= 'Sin efecto: '.length + 160 + 1, `largo ${t.length}`);
  assert.ok(t.endsWith('….'));
  assert.equal(paneles.textoDirectiva({ tipo: 'sin_efecto', motivo: 'pide más riesgo.' }), 'Sin efecto: pide más riesgo.');
  assert.equal(paneles.textoDirectiva({ tipo: 'sin_efecto' }), 'Sin efecto: no hay nada que aplicar.');
});

test('franja de conexión: dice por qué no hay conexión cuando se sabe', () => {
  assert.equal(paneles.textoConexion(4000, 'token'), 'Falta el token del panel: abre la URL con ?token=… (el valor de PANEL_TOKEN).');
  assert.match(paneles.textoConexion(4000, 'token-malo'), /^El token del panel no vale/);
  assert.match(paneles.textoConexion(8000, 'lleno'), /^Hay demasiados paneles abiertos contra la mesa: cierra alguna pestaña\. Reintentando en 8 s…$/);
  assert.equal(paneles.textoConexion(4000, null), 'Sin conexión con la mesa, reintentando en 4 s…');
  assert.match(paneles.textoConexion(2000, 'arrancando'), /^La mesa está arrancando .* Reintentando en 2 s…$/);
});

test('criterios del laboratorio con su unidad', () => {
  assert.equal(paneles.valorCriterio({ nombre: 'Sharpe OOS' }, 0.4123), '0,41');
  assert.equal(paneles.valorCriterio({ nombre: 'Operaciones OOS' }, 44), '44');
  assert.equal(paneles.valorCriterio({ nombre: 'maxDD OOS' }, 0.183), '18 %');
  assert.equal(paneles.valorCriterio({ nombre: 'Ventanas de prueba en positivo' }, 0.6667), '67 %');
  assert.equal(paneles.valorCriterio({ nombre: 'Sharpe deflactado' }, null), '—');
});

test('capital de partida sacado de las sombras (todas empiezan con él)', () => {
  const inst = { benchmarks: [{ id: 'btc', valor: 101000, rentabilidad: 0.01 }, { id: 'sin-comite', valor: 99000, rentabilidad: -0.01 }] };
  assert.ok(Math.abs(paneles.capitalDe(inst) - 100000) < 1e-6);
  assert.equal(paneles.capitalDe({ benchmarks: [{ valor: null, rentabilidad: null }] }), null);
});
