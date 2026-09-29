'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEPARTAMENTOS, SALAS, crearPlantilla, puestosDeMesa } = require('../src/agentes/registro');

// Universo y mesas completos de §2 y §4.3 (con claves de Alpaca), escritos
// aquí para no depender de módulos de otros constructores.
const ETIQUETAS = ['BTC', 'ETH', 'SOL', 'LINK', 'AVAX', 'DOGE', 'SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'XLE', 'XLK', 'XLF'];
const UNIVERSO_COMPLETO = ETIQUETAS.map((e, i) => ({ simbolo: i < 6 ? `${e}/USD` : e, etiqueta: e, clase: i < 6 ? 'cripto' : 'accion', nombre: e }));
const CRIPTO = UNIVERSO_COMPLETO.slice(0, 6).map(a => a.simbolo);
const MESAS_COMPLETAS = [
  { id: 'tendencia', nombre: 'Tendencia SMA', familia: 'tendencia-sma', universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'] },
  { id: 'momentum', nombre: 'Momentum cripto', familia: 'momentum-rotacion', universo: CRIPTO },
  { id: 'reversion', nombre: 'Reversión RSI', familia: 'reversion-rsi', universo: ['BTC/USD', 'ETH/USD'] },
  { id: 'ruptura', nombre: 'Ruptura Donchian', familia: 'ruptura-donchian', universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'] },
  { id: 'momentum-etf', nombre: 'Momentum ETF', familia: 'momentum-rotacion', universo: ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD'] },
  { id: 'reversion-etf', nombre: 'Reversión ETF', familia: 'reversion-rsi', universo: ['SPY', 'QQQ'] },
];

// Mesas escritas a mano (no dependen de otro módulo): 2 mesas, 5 puestos.
const MESAS = [
  { id: 'tendencia', nombre: 'Tendencia SMA', familia: 'tendencia-sma', universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'] },
  { id: 'reversion', nombre: 'Reversión RSI', familia: 'reversion-rsi', universo: ['BTC/USD', 'ETH/USD'] },
];
const UNIVERSO = [
  { simbolo: 'BTC/USD', etiqueta: 'BTC', clase: 'cripto', nombre: 'Bitcoin' },
  { simbolo: 'ETH/USD', etiqueta: 'ETH', clase: 'cripto', nombre: 'Ethereum' },
  { simbolo: 'SOL/USD', etiqueta: 'SOL', clase: 'cripto', nombre: 'Solana' },
];

test('DEPARTAMENTOS y SALAS exactamente como §6.1', () => {
  assert.deepEqual(DEPARTAMENTOS.map(d => ({ ...d })), [
    { id: 'direccion', nombre: 'Dirección', color: '#f5b942', sala: 'direccion' },
    { id: 'macro', nombre: 'Macro', color: '#8b5cf6', sala: 'macro' },
    { id: 'analisis', nombre: 'Análisis', color: '#22c55e', sala: 'analisis' },
    { id: 'mesas', nombre: 'Mesas', color: '#3b82f6', sala: 'parque' },
    { id: 'riesgos', nombre: 'Riesgos', color: '#ef4444', sala: 'riesgos' },
    { id: 'operaciones', nombre: 'Operaciones', color: '#f97316', sala: 'riesgos' },
    { id: 'laboratorio', nombre: 'Laboratorio', color: '#06b6d4', sala: 'laboratorio' },
  ]);
  assert.deepEqual([...SALAS], ['parque', 'direccion', 'macro', 'analisis', 'laboratorio', 'riesgos', 'comite', 'descanso']);
});

test('plantilla: ids fijos, un analista por activo y un operador por puesto', () => {
  const p = crearPlantilla({ universo: UNIVERSO, mesas: MESAS });
  // 7 fijos + 3 analistas + (3 + 2) puestos = 15
  assert.equal(p.length, 15);
  const ids = p.map(a => a.id);
  for (const id of ['cio', 'macro', 'riesgos', 'ejecutor', 'controller', 'laboratorio', 'auditor',
    'analista-BTC', 'analista-ETH', 'analista-SOL',
    'puesto-tendencia-BTC', 'puesto-tendencia-ETH', 'puesto-tendencia-SOL', 'puesto-reversion-BTC', 'puesto-reversion-ETH']) {
    assert.ok(ids.includes(id), id);
  }
  const porId = Object.fromEntries(p.map(a => [a.id, a]));
  assert.equal(porId.cio.rol, 'Presidenta del comité');
  assert.equal(porId.riesgos.rol, 'Jefa de riesgos');
  assert.equal(porId.laboratorio.rol, 'Director de laboratorio');
  assert.equal(porId.auditor.rol, 'Auditor post-mortem');
  const puesto = porId['puesto-tendencia-SOL'];
  assert.equal(puesto.mesaId, 'tendencia');
  assert.equal(puesto.simbolo, 'SOL/USD');
  assert.equal(puesto.etiqueta, 'SOL');
  assert.equal(puesto.puestoId, 'tendencia-SOL');
  assert.equal(puesto.sala, 'parque');
  assert.equal(porId['analista-ETH'].simbolo, 'ETH/USD');
});

test('cada agente tiene la forma del contrato y salas/departamentos válidos', () => {
  const p = crearPlantilla({ universo: UNIVERSO_COMPLETO, mesas: MESAS_COMPLETAS });
  // 7 fijos + 14 analistas + (3 + 6 + 2 + 3 + 5 + 2) puestos = 42
  assert.equal(p.length, 42);
  const deps = new Set(DEPARTAMENTOS.map(d => d.id));
  for (const a of p) {
    for (const campo of ['id', 'nombre', 'departamento', 'rol', 'queDecide', 'sala']) assert.equal(typeof a[campo], 'string', `${a.id}.${campo}`);
    assert.equal(typeof a.usaLLM, 'boolean');
    assert.ok(deps.has(a.departamento), a.departamento);
    assert.ok(SALAS.includes(a.sala), a.sala);
    assert.doesNotMatch(JSON.stringify(a), /undefined|NaN/);
  }
});

test('nombres deterministas y sin repetir dentro de la plantilla', () => {
  const entrada = { universo: UNIVERSO_COMPLETO, mesas: MESAS_COMPLETAS };
  const a = crearPlantilla(entrada);
  const b = crearPlantilla(entrada);
  assert.deepEqual(a, b);
  const nombres = a.map(x => x.nombre);
  assert.equal(new Set(nombres).size, nombres.length);
  const dePila = nombres.map(n => n.split(' ')[0]);
  assert.equal(new Set(dePila).size, dePila.length);
  // Fijos con nombre fijo (no dependen del universo).
  assert.equal(crearPlantilla({}).find(x => x.id === 'cio').nombre, a.find(x => x.id === 'cio').nombre);
});

test('contratar: puestos de una mesa nueva sin repetir nombres ni puestos existentes', () => {
  const plantilla = crearPlantilla({ universo: UNIVERSO, mesas: MESAS });
  const nueva = { id: 'ruptura', nombre: 'Ruptura Donchian', familia: 'ruptura-donchian', universo: ['BTC/USD', 'SOL/USD'] };
  const nuevos = puestosDeMesa(nueva, { plantilla });
  assert.deepEqual(nuevos.map(a => a.id), ['puesto-ruptura-BTC', 'puesto-ruptura-SOL']);
  const todos = [...plantilla, ...nuevos].map(a => a.nombre.split(' ')[0]);
  assert.equal(new Set(todos).size, todos.length);
  // Una mesa ya contratada no se duplica.
  assert.deepEqual(puestosDeMesa(MESAS[0], { plantilla }), []);
});
