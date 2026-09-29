'use strict';
// La demo acelerada es el caso conocido del sistema entero (§9-F): 10 días
// sintéticos con todas sus invariantes (límites duros, Σ puestos = bróker,
// patrimonio = efectivo + posiciones, operaciones, comités cada 4 h, reinicio
// que recupera el mismo estado y kill final que lo cierra todo).

const test = require('node:test');
const assert = require('node:assert/strict');
const { ejecutarDemo } = require('../scripts/demo-acelerada');

test('demo de 10 días: todas las invariantes se cumplen', { timeout: 180_000 }, async () => {
  const { resumen: r, fallos } = await ejecutarDemo({ dias: 10, semilla: 42, silencioso: true });
  assert.deepEqual(fallos, []);
  assert.ok(r.ejecuciones > 0 && r.compras > 0);
  assert.ok(Object.values(r.operacionesPorMesa).reduce((s, x) => s + x, 0) > 0);
  assert.ok(r.comites >= 59, `comités: ${r.comites}`);
  assert.ok(r.huecoMaxComiteH <= 4 + 1 / 12);
  assert.equal(r.reinicioIgual, true);
  assert.equal(r.errores, 0);
  assert.ok(r.maxExposicion.bruta <= 0.8 * 1.001 && r.maxExposicion.cripto <= 0.5 * 1.001 && r.maxExposicion.activo <= 0.1 * 1.001);
  assert.ok(r.kill.cerradas > 0);
});

test('la demo es reproducible: misma semilla → mismo resultado', { timeout: 120_000 }, async () => {
  const a = await ejecutarDemo({ dias: 4, semilla: 5, silencioso: true });
  const b = await ejecutarDemo({ dias: 4, semilla: 5, silencioso: true });
  assert.equal(a.resumen.patrimonio, b.resumen.patrimonio);
  assert.deepEqual(a.resumen.operacionesPorMesa, b.resumen.operacionesPorMesa);
  assert.equal(a.resumen.ejecuciones, b.resumen.ejecuciones);
});
