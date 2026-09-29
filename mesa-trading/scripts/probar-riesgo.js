'use strict';
// Casos conocidos de riesgo (constructor C): límites antes de cada orden y
// vigilante del fondo, con los límites de src/config.js. Cada cifra esperada
// está calculada a mano. Imprime OK/FALLO por caso y sale con código 1 si
// alguno falla.
//
//   node scripts/probar-riesgo.js

const { LIMITES_DUROS } = require('../src/config');
const { evaluarPropuesta } = require('../src/riesgo/limites');
const { vigilar } = require('../src/riesgo/vigilante');
const { casiIgual } = require('../src/util/numeros');

let fallos = 0;
function caso(nombre, obtenido, esperado, tol = 1e-9) {
  const ok = typeof esperado === 'number' && typeof obtenido === 'number'
    ? casiIgual(obtenido, esperado, tol, tol)
    : JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (!ok) fallos++;
  const ver = x => (typeof x === 'string' ? x : JSON.stringify(x));
  console.log(`${ok ? 'OK   ' : 'FALLO'}  ${nombre}: ${ver(obtenido)}${ok ? '' : ` (esperado ${ver(esperado)})`}`);
}

const AHORA = Date.UTC(2026, 8, 29, 15);
const HORA = 3_600_000;
const L = LIMITES_DUROS;
const vacio = { exposicionBruta: 0, exposicionCripto: 0, exposicionPorActivo: {}, posicionesAbiertas: 0 };
const ctx = (extra = {}) => ({
  ahora: AHORA, patrimonio: 100000, valoracion: vacio, nivel: 'normal', multiplicadorCaida: 1, directivas: null,
  ordenes: { ultimoMinuto: 0, ultimaHoraPorMesa: {} }, mercadoAbierto: { accion: true }, limites: L, ...extra,
});
// Apertura de 5.000 $ de BTC a 100.000 con stop 95.000: riesgo 250 $ (0,25 %), peso 5 %.
const prop = (extra = {}) => ({
  puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', clase: 'cripto', lado: 'compra', tipo: 'apertura',
  nocional: 5000, precio: 100000, precioT: AHORA - 10_000, stop: 95000, precioDecision: 100000, ...extra,
});
const decision = r => `${r.decision} ${Math.round(r.nocional * 100) / 100}`;
const limitesDe = r => r.motivos.map(m => m.limite);

console.log(`— Límites (patrimonio 100.000 $; activo ${L.maxPesoPorActivo * 100} %, bruta ${L.maxExposicionBruta * 100} %, cripto ${L.maxExposicionCripto * 100} %, riesgo ${L.riesgoPorOperacion * 100} %)`);
caso('apertura que cabe', decision(evaluarPropuesta(prop(), ctx())), 'aprobar 5000');

// Recortes
caso('activo: hay 7.000 en BTC, tope 10.000 → caben 3.000',
  decision(evaluarPropuesta(prop({ tipo: 'aumento' }), ctx({ valoracion: { ...vacio, exposicionBruta: 7000, exposicionCripto: 7000, exposicionPorActivo: { 'BTC/USD': 7000 }, posicionesAbiertas: 1 } }))), 'reducir 3000');
caso('bruta: hay 77.000, tope 80.000 → caben 3.000',
  decision(evaluarPropuesta(prop(), ctx({ valoracion: { ...vacio, exposicionBruta: 77000, exposicionCripto: 20000 } }))), 'reducir 3000');
caso('cripto: hay 48.000, tope 50.000 → caben 2.000',
  decision(evaluarPropuesta(prop(), ctx({ valoracion: { ...vacio, exposicionBruta: 48000, exposicionCripto: 48000 } }))), 'reducir 2000');
caso('caída: 5.000 × 0,5', decision(evaluarPropuesta(prop(), ctx({ multiplicadorCaida: 0.5 }))), 'reducir 2500');
caso('Megáfono reducir ×0,25', decision(evaluarPropuesta(prop(), ctx({ directivas: [{ tipo: 'reducir_riesgo', factor: 0.25, hasta: AHORA + HORA }] }))), 'reducir 1250');
// Stop al 10 %: 8.000 arriesgarían 800 > 500 → 500 / 0,10 = 5.000.
caso('riesgo por operación: 8.000 con stop al 10 % → 5.000', decision(evaluarPropuesta(prop({ nocional: 8000, stop: 90000 }), ctx())), 'reducir 5000');
const encadenado = evaluarPropuesta(prop({ tipo: 'aumento', nocional: 6000 }), ctx({ multiplicadorCaida: 0.5, valoracion: { ...vacio, exposicionBruta: 8000, exposicionCripto: 8000, exposicionPorActivo: { 'BTC/USD': 8000 }, posicionesAbiertas: 1 } }));
caso('encadenado: 6.000 × 0,5 = 3.000 → tope del activo deja 2.000', decision(encadenado), 'reducir 2000');
const texto = evaluarPropuesta(prop({ tipo: 'aumento' }), ctx({ valoracion: { ...vacio, exposicionBruta: 7000, exposicionCripto: 7000, exposicionPorActivo: { 'BTC/USD': 7000 }, posicionesAbiertas: 1 } })).motivos[0].texto;
caso('el texto lleva las cifras', texto, 'BTC pasaría a 12.000 $ (12,00 % del patrimonio); máximo 10,00 % (10.000 $). Se recorta de 5.000 $ a 3.000 $.');

// Vetos
const veto = (nombre, r, limite) => caso(`veto ${nombre}`, `${r.decision} ${limitesDe(r).includes(limite) ? limite : limitesDe(r).join(',')}`, `vetar ${limite}`);
veto('bloqueado', evaluarPropuesta(prop(), ctx({ nivel: 'bloqueado' })), 'bloqueado');
veto('bloqueado también a un cierre', evaluarPropuesta(prop({ tipo: 'cierre', lado: 'venta' }), ctx({ nivel: 'bloqueado' })), 'bloqueado');
caso('bloqueado deja pasar el kill', evaluarPropuesta(prop({ tipo: 'kill', lado: 'venta', cantidad: 0.05 }), ctx({ nivel: 'bloqueado' })).decision, 'aprobar');
caso('cierre con precio de hace 1 h y en solo cerrar → aprobar', evaluarPropuesta(prop({ tipo: 'cierre', lado: 'venta', precioT: AHORA - HORA }), ctx({ nivel: 'solo_cerrar' })).decision, 'aprobar');
veto('nivel solo cerrar', evaluarPropuesta(prop(), ctx({ nivel: 'solo_cerrar' })), 'nivel');
veto('directiva solo cerrar', evaluarPropuesta(prop(), ctx({ directivas: { soloCerrarHasta: AHORA + HORA } })), 'soloCerrar');
veto('activo vetado', evaluarPropuesta(prop(), ctx({ directivas: { activosVetados: [{ simbolo: 'BTC/USD', hasta: AHORA + HORA }] } })), 'activoVetado');
veto('mesa pausada', evaluarPropuesta(prop(), ctx({ directivas: { mesasPausadas: [{ mesaId: 'tendencia', hasta: AHORA + HORA }] } })), 'mesaPausada');
veto('bolsa cerrada', evaluarPropuesta(prop({ simbolo: 'SPY', clase: 'accion', precio: 500, precioDecision: 500, stop: 480 }), ctx({ mercadoAbierto: { accion: false } })), 'mercadoCerrado');
veto('precio de hace 901 s (máx. 900)', evaluarPropuesta(prop({ precioT: AHORA - 901_000 }), ctx()), 'maxAntiguedadPrecioSegCripto');
veto('desvío 2,1 % (máx. 2 %)', evaluarPropuesta(prop({ precio: 102100, stop: 97000 }), ctx()), 'desvioMaxPrecio');
veto('apertura sin stop', evaluarPropuesta(prop({ stop: null }), ctx()), 'sinStop');
veto('12 posiciones abiertas', evaluarPropuesta(prop(), ctx({ valoracion: { ...vacio, posicionesAbiertas: 12 } })), 'maxPosiciones');
veto('10 órdenes en el minuto', evaluarPropuesta(prop(), ctx({ ordenes: { ultimoMinuto: 10, ultimaHoraPorMesa: {} } })), 'maxOrdenesMinuto');
veto('4 órdenes de la mesa en la hora', evaluarPropuesta(prop(), ctx({ ordenes: { ultimoMinuto: 0, ultimaHoraPorMesa: { tendencia: 4 } } })), 'maxOrdenesMesaHora');
veto('8 $ < mínimo 10 $', evaluarPropuesta(prop({ nocional: 8 }), ctx()), 'minNocionalOrden');
veto('recortado a 5 $ < mínimo', evaluarPropuesta(prop({ tipo: 'aumento' }), ctx({ valoracion: { ...vacio, exposicionBruta: 9995, exposicionCripto: 9995, exposicionPorActivo: { 'BTC/USD': 9995 }, posicionesAbiertas: 1 } })), 'minNocionalOrden');

console.log('— Vigilante (inicio del día 100.000 $, pico 100.000 $, martes 15:00 UTC)');
const v = (extra = {}) => vigilar({ ahora: AHORA, patrimonio: 100000, patrimonioInicioDia: 100000, pico: 100000, puestos: [], precios: {}, limites: L, nivelActual: 'normal', soloCerrarHasta: null, ...extra });
const r2 = v({ patrimonio: 98000 });
caso('−2 % en el día → solo cerrar', r2.nivel, 'solo_cerrar');
caso('… hasta las 00:00 UTC del miércoles', new Date(r2.soloCerrarHasta).toISOString(), '2026-09-30T00:00:00.000Z');
caso('−1,99 % → normal', v({ patrimonio: 98010 }).nivel, 'normal');
const r35 = v({ patrimonio: 96500 });
caso('−3,5 % en el día → kill', `${r35.nivel} ${r35.acciones.map(a => a.tipo).join(',')}`, 'bloqueado kill');
const r10 = v({ patrimonio: 90000, patrimonioInicioDia: 90500 });
caso('−10 % desde el máximo → multiplicador 0,5', `${r10.nivel} ${r10.multiplicadorCaida}`, 'normal 0.5');
caso('−9,9 % → multiplicador 1', v({ patrimonio: 90100, patrimonioInicioDia: 90500 }).multiplicadorCaida, 1);
const r15 = v({ patrimonio: 85000, patrimonioInicioDia: 86000 });
caso('−15 % desde el máximo → kill', `${r15.nivel} ${r15.acciones.map(a => a.tipo).join(',')}`, 'bloqueado kill');
caso('bloqueado es pegajoso aunque se recupere', v({ patrimonio: 120000, nivelActual: 'bloqueado' }).nivel, 'bloqueado');
const stop = v({ puestos: [{ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', cantidad: 0.05, stop: 95000 }], precios: { 'BTC/USD': 94800 } });
caso('stop saltado: 94.800 ≤ 95.000', stop.acciones, [{ tipo: 'stop', puestoId: 'tendencia-BTC', simbolo: 'BTC/USD', precio: 94800, stop: 95000 }]);
caso('stop no saltado: 95.100', v({ puestos: [{ puestoId: 'p', simbolo: 'BTC/USD', cantidad: 0.05, stop: 95000 }], precios: { 'BTC/USD': 95100 } }).acciones, []);

console.log(fallos ? `\n${fallos} caso(s) FALLAN` : '\nTodos los casos cuadran.');
process.exit(fallos ? 1 : 0);
