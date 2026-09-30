'use strict';
// Registro de incidentes (data/incidentes.jsonl, §6.10): solo añade, se relee
// al arrancar y cuenta la ventana de 90 días del criterio f.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RegistroIncidentes, TIPOS, NOMBRE_TIPO } = require('../src/riesgo/incidentes');

const DIA = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

function carpeta() {
  const c = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-incidentes-'));
  process.on('exit', () => fs.rmSync(c, { recursive: true, force: true }));
  return c;
}

test('los cinco tipos del criterio f, cada uno con su nombre para la pantalla', () => {
  assert.deepEqual([...TIPOS], ['kill', 'conciliacion_grave', 'orden_duplicada', 'orden_huerfana', 'error_departamento']);
  for (const t of TIPOS) assert.equal(typeof NOMBRE_TIPO[t], 'string');
});

test('registrar: apunta en disco (una línea por incidente, solo se añade) y en memoria', () => {
  const ruta = path.join(carpeta(), 'incidentes.jsonl');
  const r = new RegistroIncidentes({ ruta });
  assert.deepEqual(r.lista, []);
  r.registrar({ t: T0, tipo: 'kill', detalle: 'kill switch manual desde el panel' });
  r.registrar({ t: T0 + DIA, tipo: 'error_departamento', detalle: 'Error en mesas: x', datos: { departamento: 'mesas' } });
  const lineas = fs.readFileSync(ruta, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lineas, [
    { t: T0, tipo: 'kill', detalle: 'kill switch manual desde el panel' },
    { t: T0 + DIA, tipo: 'error_departamento', detalle: 'Error en mesas: x', datos: { departamento: 'mesas' } },
  ]);
  assert.equal(r.lista.length, 2);
  // Al arrancar otra vez se relee entero; una línea rota o de un tipo desconocido no cuenta.
  fs.appendFileSync(ruta, '{"t": 1, "tipo": "otro"}\n{roto\n');
  const otra = new RegistroIncidentes({ ruta });
  assert.deepEqual(otra.lista.map(x => x.tipo), ['kill', 'error_departamento']);
});

test('un tipo que no está en la lista o sin instante es un error de programación', () => {
  const r = new RegistroIncidentes();
  assert.throws(() => r.registrar({ t: T0, tipo: 'susto' }), /tipo de incidente desconocido/);
  assert.throws(() => r.registrar({ tipo: 'kill' }), /instante/);
  assert.equal(r.lista.length, 0);
});

test('enVentana: los de los últimos 90 días (el de hace 90 días justos ya no)', () => {
  const r = new RegistroIncidentes();
  const ahora = T0 + 200 * DIA;
  r.registrar({ t: ahora - 90 * DIA, tipo: 'kill' });
  r.registrar({ t: ahora - 90 * DIA + 1, tipo: 'orden_huerfana' });
  r.registrar({ t: ahora, tipo: 'orden_duplicada' });
  assert.deepEqual(r.enVentana(ahora).map(x => x.tipo), ['orden_huerfana', 'orden_duplicada']);
  assert.deepEqual(r.enVentana(ahora, 1).map(x => x.tipo), ['orden_duplicada']);
});

test('el detalle se acota a 300 caracteres', () => {
  const r = new RegistroIncidentes();
  assert.equal(r.registrar({ t: T0, tipo: 'conciliacion_grave', detalle: 'x'.repeat(1000) }).detalle.length, 300);
});
