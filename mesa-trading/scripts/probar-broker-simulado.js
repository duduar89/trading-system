'use strict';
// Casos conocidos del bróker simulado, calculados a mano. Imprime OK/FALLO por
// caso y sale con código 1 si alguno falla.
//
//   node scripts/probar-broker-simulado.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrokerSimulado } = require('../src/broker/simulado');
const { RelojSimulado } = require('../src/util/reloj');
const { casiIgual } = require('../src/util/numeros');

let fallos = 0;
function caso(nombre, obtenido, esperado, tol = 1e-9) {
  const ok = typeof esperado === 'number' ? casiIgual(obtenido, esperado, tol, tol) : obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLO'}  ${nombre}: ${obtenido}${ok ? '' : ` (esperado ${esperado})`}`);
}

async function rechaza(nombre, promesa, tipo) {
  try {
    await promesa;
    caso(nombre, 'aceptada', `rechazo ${tipo}`);
  } catch (e) {
    caso(nombre, `rechazo ${e.tipo}`, `rechazo ${tipo}`);
  }
}

async function main() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'probar-sim-'));
  const ruta = path.join(carpeta, 'broker-simulado.json');
  const precios = { 'BTC/USD': 100000, SPY: 500 };
  const fuente = { ultimos: async s => Object.fromEntries(s.filter(x => precios[x]).map(x => [x, { precio: precios[x], t: 0 }])) };
  // Martes 29-sep-2026, 11:00 ET: bolsa abierta.
  const reloj = new RelojSimulado(Date.UTC(2026, 8, 29, 15));
  const broker = new BrokerSimulado({ fuente, reloj, ruta, costes: { deslizamiento: 0 } });

  console.log('— Compra de 1.000 $ de BTC a 100.000, comisión 0,25 % en el activo, deslizamiento 0');
  // 1.000 / 100.000 = 0,01 BTC; × (1 − 0,0025) = 0,009975 BTC.
  const c = await broker.enviarOrden({ idCliente: 'caso-compra', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  caso('BTC recibidos', c.cantidadEjecutada, 0.009975);
  caso('efectivo tras la compra (100.000 − 1.000)', (await broker.cuenta()).efectivo, 99000);
  caso('comisión en dólares (0,01 × 100.000 × 0,0025)', c.comision, 2.5);

  console.log('— Venta de 0,009975 BTC a 110.000');
  // 0,009975 × 110.000 = 1.097,25; × (1 − 0,0025) = 1.094,506875 $.
  precios['BTC/USD'] = 110000;
  const v = await broker.enviarOrden({ idCliente: 'caso-venta', simbolo: 'BTC/USD', lado: 'venta', cantidad: 0.009975 });
  caso('comisión de la venta (1.097,25 × 0,0025)', v.comision, 2.743125);
  const cuenta = await broker.cuenta();
  caso('efectivo final (99.000 + 1.094,506875)', cuenta.efectivo, 99000 + 0.009975 * 110000 * (1 - 0.0025));
  caso('efectivo final en cifra', cuenta.efectivo, 100094.506875);
  caso('posiciones abiertas', (await broker.posiciones()).length, 0);

  console.log('— Rechazos');
  await rechaza('compra sin efectivo (200.000 $)', broker.enviarOrden({ idCliente: 'r1', simbolo: 'BTC/USD', lado: 'compra', nocional: 200000 }), 'fondos');
  await rechaza('venta mayor que lo disponible', broker.enviarOrden({ idCliente: 'r2', simbolo: 'BTC/USD', lado: 'venta', cantidad: 1 }), 'cantidad');
  reloj.fijar(Date.UTC(2026, 8, 29, 21)); // 17:00 ET
  await rechaza('acción con la bolsa cerrada', broker.enviarOrden({ idCliente: 'r3', simbolo: 'SPY', lado: 'compra', nocional: 100 }), 'mercado_cerrado');
  caso('los rechazos no tocan el efectivo', (await broker.cuenta()).efectivo, 100094.506875);

  console.log('— Persistencia');
  const recargado = new BrokerSimulado({ fuente, reloj, ruta, costes: { deslizamiento: 0 } });
  caso('efectivo tras recargar', (await recargado.cuenta()).efectivo, 100094.506875);
  caso('la orden de compra sigue ahí', (await recargado.ordenPorIdCliente('caso-compra')).cantidadEjecutada, 0.009975);

  console.log('— idCliente repetido con otra orden');
  await rechaza('mismo id, otro importe', recargado.enviarOrden({ idCliente: 'caso-compra', simbolo: 'BTC/USD', lado: 'compra', nocional: 2000 }), 'invalida');
  caso('mismo id y misma orden: devuelve la que hay', (await recargado.enviarOrden({ idCliente: 'caso-compra', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 })).id, 'sim-1');

  console.log('— EPERM al guardar justo después de llenar (Windows: OneDrive, antivirus)');
  // La orden ya está hecha en memoria: tiene que volver ejecutada, no como
  // error (el Ejecutor no la apuntaría y quedaría una posición sin puesto).
  reloj.fijar(Date.UTC(2026, 8, 29, 15));
  precios['BTC/USD'] = 100000;
  const renombrar = fs.renameSync;
  let fallar = true;
  fs.renameSync = (...a) => {
    if (fallar) { const e = new Error('EPERM: operation not permitted, rename'); e.code = 'EPERM'; throw e; }
    return renombrar(...a);
  };
  try {
    const cE = await recargado.enviarOrden({ idCliente: 'eperm-compra', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
    caso('compra con EPERM: vuelve ejecutada', cE.estado, 'ejecutada');
    caso('compra con EPERM: BTC recibidos', cE.cantidadEjecutada, 0.009975);
    caso('aún no está en disco', JSON.parse(fs.readFileSync(ruta, 'utf8')).ordenes.some(o => o.idCliente === 'eperm-compra'), false);
    fallar = false;
    await recargado.cuenta();
    caso('el siguiente cuenta() la guarda', JSON.parse(fs.readFileSync(ruta, 'utf8')).ordenes.some(o => o.idCliente === 'eperm-compra'), true);
    fallar = true;
    const vE = await recargado.enviarOrden({ idCliente: 'eperm-venta', simbolo: 'BTC/USD', lado: 'venta', cantidad: 0.009975 });
    caso('venta con EPERM: vuelve ejecutada', vE.estado, 'ejecutada');
    fallar = false;
    await recargado.cuenta();
    const otraVez = new BrokerSimulado({ fuente, reloj, ruta, costes: { deslizamiento: 0 } });
    caso('tras recargar, la venta está y no queda BTC', (await otraVez.posiciones()).length, 0);
    // 100.094,506875 − 1.000 + 0,009975 × 100.000 × (1 − 0,0025) = 100.089,5125 $
    caso('efectivo tras compra y venta con EPERM', (await otraVez.cuenta()).efectivo, 100094.506875 - 1000 + 0.009975 * 100000 * (1 - 0.0025));
  } finally {
    fs.renameSync = renombrar;
  }

  fs.rmSync(carpeta, { recursive: true, force: true });
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodos los casos cuadran.');
  process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error('FALLO', e); process.exit(1); });
