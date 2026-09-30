'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/agentes/plantillas');

const T = Date.UTC(2026, 8, 29, 22, 0, 0);   // 00:00 en Madrid (CEST)

// Datos típicos de cada plantilla (y alguno largo a propósito).
const CASOS = {
  estadoPuesto: [
    { etiqueta: 'SOL', marco: '4Hour', posicion: null, estadoEstrategia: 'Sin posición en SOL. Esperando a que SMA 7-25 dé LONG con filtro 200 (4H).' },
    { etiqueta: 'BTC', marco: '4Hour', posicion: { cantidad: 0.012345, entrada: 84120.5, stop: 81200, pnlAbiertoPct: 0.0234 } },
    { etiqueta: 'DOGE', marco: '1Day', posicion: null },
  ],
  notaAnalista: [
    { etiqueta: 'BTC', precio: 84120, sesgo: 'alcista', sma50: 81300, rsi: 62.4, volAnual: 0.48, marco: '4Hour' },
    { etiqueta: 'DOGE', precio: 0.12345, sesgo: 'bajista', sma50: 0.1301, rsi: 28, volAnual: 0.91 },
  ],
  regimen: [
    { valor: 'RISK-ON', puntos: 3, anterior: 'NEUTRAL', detalle: 'RISK-ON (+3): BTC 84.120 > SMA200 79.100 (+1); SMA50 81.300 > SMA200 79.100 (+1); vol 30 d 48 % (0); SPY 571 > SMA200 540 (+1)' },
    { valor: 'RISK-OFF', puntos: -2 },
  ],
  propuesta: [
    { etiqueta: 'SOL', lado: 'compra', nocional: 1234.56, precio: 145.2, stop: 139.1 },
    { etiqueta: 'ETH', lado: 'venta', cantidad: 0.5, precio: 3120.45 },
    { etiqueta: 'DOGE', lado: 'compra', nocional: 312.5, precio: 0.12345, stop: 0.1111, factor: { total: 0.0625, comite: 0.5, mesa: 0.5, megafono: 0.5, caida: 0.5 } },
  ],
  aprobacion: [
    { etiqueta: 'SOL', decision: 'aprobar', nocional: 1234.56 },
    { etiqueta: 'BTC', decision: 'reducir', nocional: 800, nocionalPedido: 1234.56, motivos: [{ texto: 'Tope por activo del 10 %: BTC pesaría 11,2 % del patrimonio.' }] },
    { etiqueta: 'ETH', lado: 'venta', cantidad: 0.5 },
  ],
  veto: [
    { etiqueta: 'SOL', motivos: [{ texto: 'Precio de hace 250 s (máximo 180 s).' }, { texto: 'Órdenes por minuto agotadas (10/10).' }] },
    { etiqueta: 'DOGE', motivos: [{ texto: 'Directiva de solo cerrar vigente hasta las 00:00: DOGE no abre y además un texto larguísimo que se sale de la frase por mucho margen.' }] },
  ],
  ejecucion: [
    { etiqueta: 'BTC', lado: 'compra', cantidad: 0.009975, precio: 100000, nocional: 1000, comision: 2.5 },
    { etiqueta: 'ETH', lado: 'venta', cantidad: 0.5, precio: 3120.45, comision: 3.9 },
  ],
  cierre: [
    { etiqueta: 'SOL', pnl: 123.45, pnlPct: 0.0234, motivoSalida: 'señal', barras: 12, rMultiple: 1.6 },
    { etiqueta: 'BTC', pnl: -45.2, pnlPct: -0.012, motivoSalida: 'stop', barras: 1 },
  ],
  stopSaltado: [{ etiqueta: 'SOL', precio: 139.05, stop: 139.1 }],
  decisionComite: [
    { modo: 'DEFENSIVO', multiplicadores: { tendencia: 0.5, momentum: 1, ruptura: 0.5, reversion: 0 }, vetos: ['SOL/USD', 'DOGE/USD'], fuente: 'defecto' },
    { modo: 'NORMAL', multiplicadores: { tendencia: 1 }, vetos: [], fuente: 'llm' },
  ],
  directiva: [
    { tipo: 'reducir_riesgo', factor: 0.5, horas: 12 }, { tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 },
    { tipo: 'pausar_mesa', mesaId: 'momentum-etf', horas: 4 }, { tipo: 'solo_cerrar', horas: 72 },
    { tipo: 'reanudar_activo', simbolo: 'SOL/USD' }, { tipo: 'reanudar_mesa', mesaId: 'tendencia' },
    { tipo: 'sin_efecto', motivo: 'No he entendido ninguna orden.' }, { tipo: 'otra' },
  ],
  leccion: [
    { mesaId: 'tendencia', etiqueta: 'SOL', categoria: 'stop_estrecho', pnl: -45.2, barras: 2 },
    { mesaId: 'momentum', etiqueta: 'ETH', categoria: 'señal_falsa', leccion: 'ETH perdió 80,00 $: la señal no se confirmó.' },
  ],
  hipotesis: [
    { id: 'h-2026-40-1', familia: 'tendencia-sma', marco: '4Hour', universo: ['BTC/USD', 'ETH/USD', 'SOL/USD'], filtros: [{ id: 'regimen-no-riskoff' }], origen: 'leccion' },
  ],
  resultadoHipotesis: [
    { id: 'h-1', aprobada: true, criterios: [{ nombre: 'sharpe', valor: 0.8, umbral: 0.6, ok: true }, { nombre: 'dsr', valor: 0.95, umbral: 0.9, ok: true }] },
    { id: 'h-2', aprobada: false, criterios: [{ nombre: 'Sharpe OOS', valor: 0.42, umbral: 0.6, ok: false }, { nombre: 'dsr', valor: 0.95, umbral: 0.9, ok: true }] },
  ],
  contratacion: [{ nombre: 'Tendencia SMA lenta', familia: 'tendencia-sma', peso: 0.02, universo: ['BTC/USD', 'ETH/USD'] }],
  despido: [{ nombre: 'Ruptura Donchian', motivo: 'maxDD 27 % > 25 %' }],
  informeDiario: [{ dia: '2026-09-29', patrimonio: 100234.5, pnlDia: 234.5, pnlDiaPct: 0.00234, operaciones: 4, acierto: 0.5, gastoLLMUsd: 0.84 }],
  informeSemanal: [{ rentabilidad: 0.012, sharpe90Fondo: 0.85, sharpe90SinComite: 0.8, sharpe90Btc: 0.6 }],
  descanso: [{ minutos: 15 }],
  killSwitch: [{ motivo: 'caída del 15,2 % desde el máximo (límite 15 %)' }],
  soloCerrar: [{ motivo: 'pérdida del día −2,10 % (límite −2 %)', hasta: T }],
  reabrir: [{ quien: 'Eduardo' }],
  conciliacion: [
    { acciones: [], grave: false },
    { acciones: [{ tipo: 'escalar', simbolo: 'BTC/USD' }, { tipo: 'huerfana', simbolo: 'DOGE/USD' }, { tipo: 'fantasma', simbolo: 'SOL/USD' }], grave: true },
  ],
};

const INFORMES = {
  controller: { patrimonio: 100234.5, pnlDia: -534.2, pnlDiaPct: -0.0053, caida: -0.031, exposicionBrutaPct: 0.45, posiciones: 5 },
  macro: { regimen: 'NEUTRAL', puntos: 1, voto: 'NORMAL' },
  riesgos: { nivel: 'normal', vetos: 3, cercanos: ['exposición cripto 47 % (máx. 50 %)', 'BTC 9,5 % (máx. 10 %)'], voto: 'DEFENSIVO' },
  mesas: { mejor: { nombre: 'Tendencia SMA', pnl: 120.4 }, peor: { nombre: 'Ruptura Donchian', pnl: -80.1 } },
  laboratorio: { enCurso: 2, aprobadas: 0, ensayos: 14 },
  megafono: { vigentes: 1, pendientes: 0 },
};

const NOMBRES_CONTRATO = ['estadoPuesto', 'notaAnalista', 'regimen', 'propuesta', 'aprobacion', 'veto', 'ejecucion', 'cierre',
  'stopSaltado', 'informeComite', 'decisionComite', 'directiva', 'leccion', 'hipotesis', 'resultadoHipotesis', 'contratacion',
  'despido', 'informeDiario', 'informeSemanal', 'descanso', 'killSwitch', 'soloCerrar', 'reabrir', 'conciliacion'];

function comprobar(texto, donde) {
  assert.equal(typeof texto, 'string', donde);
  assert.ok(texto.length > 0, `${donde}: vacío`);
  assert.ok(texto.length <= 140, `${donde}: ${texto.length} caracteres → ${texto}`);
  assert.doesNotMatch(texto, /undefined|NaN|null|\[object/, `${donde}: ${texto}`);
}

test('están todas las plantillas del contrato (§6.4)', () => {
  for (const n of NOMBRES_CONTRATO) assert.equal(typeof p[n], 'function', n);
  for (const jefe of Object.keys(INFORMES)) assert.equal(typeof p.informeComite[jefe], 'function', jefe);
});

test('con datos típicos: ≤ 140 caracteres y sin undefined/NaN', () => {
  for (const [nombre, casos] of Object.entries(CASOS)) {
    casos.forEach((c, i) => comprobar(p[nombre](c), `${nombre}[${i}]`));
  }
  for (const [jefe, datos] of Object.entries(INFORMES)) {
    comprobar(p.informeComite(jefe, datos), `informeComite(${jefe})`);
    comprobar(p.informeComite[jefe](datos), `informeComite.${jefe}`);
  }
});

test('con datos que faltan: no rompe ni escribe undefined/NaN', () => {
  for (const n of NOMBRES_CONTRATO) {
    if (n === 'informeComite') continue;
    comprobar(p[n](), `${n}()`);
    comprobar(p[n]({}), `${n}({})`);
    comprobar(p[n]({ precio: NaN, pnl: Infinity, cantidad: undefined, etiqueta: null }), `${n}(raros)`);
  }
  for (const jefe of Object.keys(INFORMES)) comprobar(p.informeComite(jefe), `informeComite(${jefe})`);
  comprobar(p.informeComite('otro', {}), 'informeComite(otro)');
});

test('casos conocidos: frases exactas', () => {
  // formato: 0,009975 BTC; 100.000; 1.000 $; 2,50 $
  assert.equal(p.ejecucion(CASOS.ejecucion[0]), 'Comprados 0,009975 BTC a 100.000 (1.000 $). Comisión 2,50 $.');
  assert.equal(p.estadoPuesto(CASOS.estadoPuesto[0]), 'Sin posición en SOL. Esperando a que SMA 7-25 dé LONG con filtro 200 (4H).');
  assert.equal(p.estadoPuesto(CASOS.estadoPuesto[2]), 'Sin posición en DOGE. Esperando señal (1D).');
  assert.equal(p.estadoPuesto(CASOS.estadoPuesto[1]), 'Largo en BTC: 0,012345 a 84.121, stop 81.200, +2,34 %.');
  assert.equal(p.cierre(CASOS.cierre[1]), 'Cerrada BTC por stop: -45,20 $ (-1,20 %) en 1 vela.');
  assert.equal(p.directiva({ tipo: 'reducir_riesgo', factor: 0.5, horas: 12 }), 'Reducir el tamaño de las entradas al 50 % durante 12 h.');
  assert.equal(p.decisionComite(CASOS.decisionComite[0]),
    'Decisión: modo DEFENSIVO (plan por defecto). Mesas paradas: reversion. Vetos 24 h: SOL, DOGE. Mesas a la mitad: tendencia, ruptura.');
  assert.equal(p.soloCerrar(CASOS.soloCerrar[0]), 'Solo cerrar hasta las 00:00: pérdida del día −2,10 % (límite −2 %).');
  assert.equal(p.regimen(CASOS.regimen[1]), 'Régimen RISK-OFF (−2).');
  assert.equal(p.informeComite.controller(INFORMES.controller),
    'Patrimonio 100.235 $, hoy -534,20 $ (-0,53 %). Caída 3,10 %. Exposición 45 %, 5 posiciones.');
});

test('frase(): recorta a 140 con puntos suspensivos y sin partir números', () => {
  const larga = 'x'.repeat(200);
  const r = p.frase(larga);
  assert.equal(r.length, 140);
  assert.ok(r.endsWith('…'));
  assert.equal(p.frase('  dos   espacios  '), 'dos espacios');
  // El régimen con detalle largo se corta en un «;», no en «SMA200 54…».
  const reg = p.regimen(CASOS.regimen[0]);
  assert.ok(reg.length <= 140);
  assert.match(reg, /\(0\)…$/);
  assert.equal(p.veto({ motivos: [{ texto: 'x' }] }), 'Veto al activo: x');
});

const MESAS = [
  { id: 'tendencia', nombre: 'Tendencia SMA' }, { id: 'reversion', nombre: 'Reversión RSI' },
  { id: 'ruptura', nombre: 'Ruptura Donchian' }, { id: 'lab3', nombre: 'Tendencia SMA lenta' },
];

test('directiva y decisión del comité: con la lista de mesas, el nombre y no el id', () => {
  assert.equal(p.directiva({ tipo: 'pausar_mesa', mesaId: 'reversion', horas: 6 }, MESAS), 'Pausar la mesa Reversión RSI durante 6 h.');
  assert.equal(p.directiva({ tipo: 'reanudar_mesa', mesaId: 'lab3' }, MESAS), 'Quitar la pausa del Megáfono a la mesa Tendencia SMA lenta.');
  // Sin lista (o mesa que no está) se queda el id, como antes.
  assert.equal(p.directiva({ tipo: 'pausar_mesa', mesaId: 'reversion', horas: 6 }), 'Pausar la mesa reversion durante 6 h.');
  assert.equal(p.directiva({ tipo: 'pausar_mesa', mesaId: 'otra', horas: 6 }, MESAS), 'Pausar la mesa otra durante 6 h.');
  assert.equal(p.decisionComite({ modo: 'NORMAL', multiplicadores: { reversion: 0, lab3: 0.5 }, vetos: [] }, MESAS),
    'Decisión: modo NORMAL. Mesas paradas: Reversión RSI. Mesas a la mitad: Tendencia SMA lenta.');
  comprobar(p.decisionComite(CASOS.decisionComite[0], MESAS), 'decisionComite(con nombres)');
});

test('despido: dice lo que pasa de verdad (sin «sigue en sombra») y lo dice antes que el motivo', () => {
  const x = p.despido({ nombre: 'Ruptura Donchian', motivo: 'maxDD 27 % > 25 %' });
  assert.equal(x, 'Mesa Ruptura Donchian al banquillo (cierra sus puestos y no abre nada nuevo, ni en sombra): maxDD 27 % > 25 %.');
  assert.doesNotMatch(x, /[Ss]igue en sombra/);
  // Con un motivo largo se recorta el motivo, no lo que pasa.
  const largo = p.despido({ nombre: 'Tendencia SMA lenta', motivo: 'descartada tras la incubación. ' + 'x '.repeat(80) });
  assert.match(largo, /ni en sombra\):/);
  assert.ok(largo.length <= 140);
});

test('informe diario: un cierre tardío dice el tramo real, no la fecha de un solo día', () => {
  const base = { dia: '2026-06-04', patrimonio: 100415, pnlDia: 443.67, pnlDiaPct: 0.00442, operaciones: 5, acierto: 0.4, gastoLLMUsd: 0.22 };
  // Caso de la revisión: apagado el 2-jun, encendido el 4-jun a las 08:00 UTC.
  assert.equal(p.informeDiario({ ...base, desde: Date.UTC(2026, 5, 2, 0, 5), hasta: Date.UTC(2026, 5, 4, 8, 0) }),
    'Cierre (02-jun 00:05 → 04-jun 08:00 UTC, 56 h): 100.415 $ (+443,67 $, +0,44 %). 5 operaciones, acierto 40 %. LLM 0,22 $.');
  // Un día normal (24 h ± 30 min) sigue con la fecha.
  const dia = p.informeDiario({ ...base, desde: Date.UTC(2026, 5, 3, 0, 5), hasta: Date.UTC(2026, 5, 4, 0, 20) });
  assert.equal(dia, 'Cierre 2026-06-04: 100.415 $ (+443,67 $, +0,44 %). 5 operaciones, acierto 40 %. LLM 0,22 $.');
  // Sin gasto de LLM conocido (null, p. ej. en sintético) no se dice nada de él.
  assert.doesNotMatch(p.informeDiario({ ...base, gastoLLMUsd: null }), /LLM/);
});

test('reabrir: con patrimonio y máximo histórico, dice cuánto le falta al fondo para volver a él', () => {
  assert.equal(p.reabrir({ quien: 'un humano desde el panel', patrimonio: 95544, pico: 109000 }),
    'Reabierto por un humano desde el panel. El fondo sigue un 12,34 % (13.456 $) por debajo de su máximo histórico (109.000 $).');
  assert.equal(p.reabrir({ quien: 'Eduardo', patrimonio: 109000, pico: 109000 }), 'Reabierto por Eduardo. El fondo está en su máximo histórico (109.000 $).');
  assert.equal(p.reabrir({ quien: 'Eduardo', patrimonio: 110000, pico: 109000 }), 'Reabierto por Eduardo. El fondo está en su máximo histórico (110.000 $).');
  assert.equal(p.reabrir({ quien: 'Eduardo' }), 'Reabierto por Eduardo. Conciliación limpia; vuelta a nivel normal.');
});

test('propuesta: si el tamaño va recortado, dice cuánto y por qué (DEFENSIVO, mesa, Megáfono, caída)', () => {
  assert.equal(p.propuesta({ etiqueta: 'BTC', nocional: 2500, precio: 100000, stop: 90000, factor: { total: 0.25, comite: 0.5, mesa: 1, megafono: 0.5, caida: 1 } }),
    'Propongo comprar 2.500 $ de BTC a 100.000, stop 90.000 (tamaño ×0,25: DEFENSIVO, Megáfono).');
  assert.equal(p.propuesta({ etiqueta: 'BTC', nocional: 5000, precio: 100000, stop: 90000, factor: { total: 1, comite: 1, mesa: 1, megafono: 1, caida: 1 } }),
    'Propongo comprar 5.000 $ de BTC a 100.000, stop 90.000.');
});
