'use strict';
// Una orden de la mesa desde la terminal del servidor (modo web, cPanel), con
// el MISMO cerrojo que el latido y la web (src/latido.js, conLaMesa):
//
//   node scripts/comando.js rebalancear '{"mesa":"momentum"}'
//   node scripts/comando.js pausar
//
// Solo las órdenes que ya acepta el panel (src/web/servidor-web.js, COMANDOS),
// salvo el Megáfono, que necesita el LLM fuera del cerrojo (se usa el panel).
// Se lanza desde la carpeta de la mesa y con su .env, como el cron: así actúa
// sobre la misma carpeta de datos. Espera hasta 60 s a que acabe un latido en curso. Sale con 0 si la orden se
// aceptó, 1 si no.

const { crearConfig } = require('../src/config');
const { conLaMesa } = require('../src/latido');
const { COMANDOS } = require('../src/web/servidor-web');

async function main(argv = process.argv.slice(2)) {
  const [nombre, json] = argv.filter(a => !a.startsWith('--'));
  if (!nombre || !COMANDOS.has(nombre) || nombre === 'megafono') {
    console.error(`Uso: node scripts/comando.js <${[...COMANDOS].filter(c => c !== 'megafono').join('|')}> ['{"campo":"valor"}']`);
    return 1;
  }
  let datos = {};
  if (json) {
    try { datos = JSON.parse(json); } catch (e) { console.error(`Los datos no son JSON: ${e.message}`); return 1; }
  }
  const config = crearConfig();
  const r = await conLaMesa(config, orq => orq.comando(nombre, datos), { espera: 60_000, motivo: `comando ${nombre}` });
  if (!r.ok) { console.error(`La mesa no atendió la orden (${r.motivo}${r.detalle ? `: ${r.detalle}` : ''}).`); return 1; }
  const res = r.resultado || {};
  console.log(`${res.ok ? 'OK' : 'NO'}: ${res.mensaje || ''}`);
  return res.ok ? 0 : 1;
}

if (require.main === module) main().then(c => process.exit(c), e => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { main };
