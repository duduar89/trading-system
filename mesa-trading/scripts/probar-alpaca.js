'use strict';
// Prueba REAL contra Alpaca. Imprime OK/FALLO por comprobación y sale con
// código 1 si alguna falla.
//
//   node scripts/probar-alpaca.js                 sin claves: datos cripto públicos
//   node scripts/probar-alpaca.js                 con claves en .env: además, cuenta paper (solo lectura)
//   node scripts/probar-alpaca.js --orden-prueba  con claves: compra 15 $ de BTC y los vende
//
// Detrás de un proxy, Node ≥ 22.21 necesita NODE_USE_ENV_PROXY=1 para que fetch lo use.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cargarEnv, leerArgs } = require('../src/config');
const { AlpacaDatos } = require('../src/mercado/alpaca-datos');
const { AlpacaBroker } = require('../src/broker/alpaca-broker');
const { Limitador } = require('../src/mercado/limitador');
const { RelojReal, HORA, DIA } = require('../src/util/reloj');
const { redondearAbajo } = require('../src/util/numeros');
const formato = require('../src/util/formato');

let fallos = 0;
function comprobar(nombre, ok, detalle = '') {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLO'}  ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}
const iso = t => new Date(t).toISOString().replace('.000Z', 'Z');

async function paso(nombre, fn) {
  try { return await fn(); } catch (e) { comprobar(nombre, false, `${e.name}: ${e.message}`); return null; }
}

function comprobarVelas(nombre, velas, marcoMs, ahora) {
  let ascendentes = true, cerradas = true, coherentes = true, alineadas = true;
  for (let i = 0; i < velas.length; i++) {
    const v = velas[i];
    if (i && v.t <= velas[i - 1].t) ascendentes = false;
    if (v.t + marcoMs > ahora) cerradas = false;
    if (!(v.h >= Math.max(v.o, v.c) && v.l <= Math.min(v.o, v.c) && v.l > 0)) coherentes = false;
    if (v.t % marcoMs !== 0) alineadas = false;
  }
  comprobar(`${nombre}: ascendentes y sin duplicados`, ascendentes);
  comprobar(`${nombre}: todas cerradas (t + marco ≤ ahora)`, cerradas);
  comprobar(`${nombre}: OHLC coherente (h ≥ max(o,c), l ≤ min(o,c))`, coherentes);
  comprobar(`${nombre}: alineadas a UTC`, alineadas);
}

async function probarDatosCripto(reloj, limitador) {
  console.log('\n— Datos cripto públicos (sin cabeceras)');
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'probar-alpaca-'));
  // En velas intradía Alpaca corta una página por semana aunque el limit sea
  // mayor (medido el 29-sep-2026): 30 días de 1Hour salen en ~5 páginas.
  const datos = new AlpacaDatos({ reloj, carpetaCache: carpeta, limitador });
  const ahora = reloj.ahora();

  const ultimos = await paso('último precio', () => datos.ultimos(['BTC/USD', 'ETH/USD', 'SOL/USD']));
  if (ultimos) {
    for (const s of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
      const u = ultimos[s];
      const edad = u ? (ahora - u.t) / 1000 : null;
      comprobar(`último ${s}`, Boolean(u && u.precio > 0 && edad < 15 * 60),
        u ? `${formato.precio(u.precio)} $ a las ${iso(u.t)} (hace ${Math.round(edad)} s)` : 'sin dato');
    }
  }

  const antes = datos.peticiones;
  const velas = await paso('velas 1Hour', () => datos.velas('BTC/USD', '1Hour', { desde: ahora - 30 * DIA, hasta: ahora }));
  if (velas) {
    const paginas = datos.peticiones - antes;
    comprobar('30 días de velas 1Hour de BTC/USD', velas.length >= 700 && velas.length <= 721,
      `${velas.length} velas, de ${iso(velas[0].t)} a ${iso(velas[velas.length - 1].t)}`);
    comprobar('paginación con page_token', paginas >= 2, `${paginas} páginas encadenadas`);
    comprobarVelas('1Hour', velas, HORA, reloj.ahora());
    const u = velas[velas.length - 1];
    console.log(`       última vela cerrada: ${iso(u.t)} o=${u.o} h=${u.h} l=${u.l} c=${u.c}`);
    const previas = datos.peticiones;
    await datos.velas('BTC/USD', '1Hour', { desde: ahora - 30 * DIA, hasta: ahora });
    comprobar('la segunda llamada sale de la caché', datos.peticiones === previas, `${datos.peticiones - previas} peticiones nuevas`);
    comprobar('caché en disco', fs.existsSync(path.join(carpeta, 'velas', 'BTCUSD_1Hour.json')));
  }
  for (const [marco, ms, dias] of [['4Hour', 4 * HORA, 30], ['1Day', DIA, 60]]) {
    const v = await paso(`velas ${marco}`, () => datos.velas('ETH/USD', marco, { desde: ahora - dias * DIA, hasta: ahora }));
    if (v) {
      comprobar(`${dias} días de velas ${marco} de ETH/USD`, v.length >= (dias * DIA) / ms - 2, `${v.length} velas`);
      comprobarVelas(marco, v, ms, reloj.ahora());
    }
  }
  fs.rmSync(carpeta, { recursive: true, force: true });
}

async function probarCuenta(reloj, limitador, claves, ordenPrueba) {
  console.log('\n— Cuenta paper (solo lectura)');
  const broker = new AlpacaBroker({ ...claves, reloj, limitador });
  const c = await paso('cuenta', () => broker.cuenta());
  if (c) {
    comprobar('cuenta', Number.isFinite(c.patrimonio) && c.estado === 'ACTIVE',
      `patrimonio ${formato.usd(c.patrimonio)}, efectivo ${formato.usd(c.efectivo)}, poder de compra ${formato.usd(c.poderCompra)}, estado ${c.estado}${c.bloqueada ? ', BLOQUEADA' : ''}`);
  }
  const r = await paso('reloj', () => broker.relojMercado());
  if (r) comprobar('reloj de mercado', Number.isFinite(r.proximaApertura), `${r.abierto ? 'abierto' : 'cerrado'}; próxima apertura ${iso(r.proximaApertura)}, próximo cierre ${iso(r.proximoCierre)}`);
  const pos = await paso('posiciones', () => broker.posiciones());
  if (pos) comprobar('posiciones', Array.isArray(pos), pos.length ? pos.map(p => `${p.simbolo} ${p.cantidad} (disp. ${p.disponible})`).join(', ') : 'ninguna');
  const a = await paso('activo', () => broker.activo('BTC/USD'));
  if (a) comprobar('activo BTC/USD', a.negociable, `fraccionable ${a.fraccionable}, mínimo ${a.minCantidad}, incremento ${a.incremento}`);
  const abiertas = await paso('órdenes abiertas', () => broker.ordenesAbiertas());
  if (abiertas) comprobar('órdenes abiertas', Array.isArray(abiertas), `${abiertas.length}`);

  console.log('\n— Datos con claves (acciones IEX y noticias)');
  const datos = new AlpacaDatos({ ...claves, reloj, limitador });
  const spy = await paso('velas SPY', () => datos.velas('SPY', '1Day', { desde: reloj.ahora() - 20 * DIA, hasta: reloj.ahora() }));
  if (spy) comprobar('velas diarias de SPY (feed IEX)', spy.length >= 10, `${spy.length} velas, última ${spy.length ? iso(spy[spy.length - 1].t) : '—'}`);
  const u = await paso('último SPY', () => datos.ultimos(['SPY']));
  if (u) comprobar('último SPY', Boolean(u.SPY && u.SPY.precio > 0), u.SPY ? `${u.SPY.precio} $ a las ${iso(u.SPY.t)}` : 'sin dato');
  const n = await paso('noticias', () => datos.noticias(['BTC/USD'], { limite: 3 }));
  if (n) comprobar('noticias de BTC', Array.isArray(n), n.map(x => x.titular.slice(0, 60)).join(' | ') || 'ninguna');

  if (!ordenPrueba) return;
  console.log('\n— Orden de prueba: compra 15 $ de BTC y los vende');
  const antes = ((await broker.posiciones()).find(p => p.simbolo === 'BTC/USD') || { cantidad: 0 }).cantidad;
  const sello = new Date(reloj.ahora()).toISOString().replace(/[-:.]/g, '').slice(0, 15);
  const idCompra = `mt-prueba-BTCUSD-${sello}-compra`;
  const compra = await paso('compra', async () => {
    await broker.enviarOrden({ idCliente: idCompra, simbolo: 'BTC/USD', lado: 'compra', nocional: 15 });
    return broker.esperarEjecucion(idCompra, { timeoutMs: 30_000 });
  });
  if (!compra) return;
  comprobar('compra ejecutada', compra.estado === 'ejecutada', `${compra.cantidadEjecutada} BTC a ${compra.precioMedio} $ (estado ${compra.estado})`);
  // La comisión se cobra en BTC: lo que entra en la posición es menos que filled_qty.
  let despues = antes;
  for (let i = 0; i < 10 && despues <= antes; i++) {
    await reloj.dormir(1000);
    despues = ((await broker.posiciones()).find(p => p.simbolo === 'BTC/USD') || { cantidad: 0 }).cantidad;
  }
  const recibido = despues - antes;
  comprobar('la posición crece', recibido > 0, `+${recibido.toFixed(9)} BTC (filled_qty ${compra.cantidadEjecutada}; diferencia ${(compra.cantidadEjecutada - recibido).toFixed(9)} = comisión en el activo)`);
  const posBtc = (await broker.posiciones()).find(p => p.simbolo === 'BTC/USD');
  const vender = redondearAbajo(Math.min(recibido, posBtc ? posBtc.disponible : 0), a && a.incremento ? a.incremento : 1e-9);
  const idVenta = `mt-prueba-BTCUSD-${sello}-venta`;
  const venta = await paso('venta', async () => {
    await broker.enviarOrden({ idCliente: idVenta, simbolo: 'BTC/USD', lado: 'venta', cantidad: vender });
    return broker.esperarEjecucion(idVenta, { timeoutMs: 30_000 });
  });
  if (venta) comprobar('venta ejecutada', venta.estado === 'ejecutada', `${venta.cantidadEjecutada} BTC a ${venta.precioMedio} $`);
}

async function main() {
  cargarEnv();
  const args = leerArgs();
  const claveId = process.env.ALPACA_API_KEY_ID || '';
  const secreto = process.env.ALPACA_API_SECRET_KEY || '';
  const reloj = new RelojReal();
  const limitador = new Limitador();
  console.log(`Prueba de Alpaca · ${iso(reloj.ahora())} · ${claveId && secreto ? 'con claves (paper)' : 'sin claves'}`);

  await probarDatosCripto(reloj, limitador);
  if (claveId && secreto) {
    await probarCuenta(reloj, limitador, { claveId, secreto }, Boolean(args['orden-prueba']));
  } else {
    console.log('\nSin ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY en .env: se omite la cuenta paper.');
    if (args['orden-prueba']) comprobar('--orden-prueba necesita claves de Alpaca', false);
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en orden.');
  process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error('FALLO', e); process.exit(1); });
