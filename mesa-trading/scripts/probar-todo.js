'use strict';
// Todos los casos conocidos de una vez: cada scripts/probar-*.js (sin --real)
// y la demo acelerada corta (20 días). Imprime un resumen y sale con 1 si
// alguno falla.
//
//   node scripts/probar-todo.js            (o npm run probar)
//
// probar-llm va con --sin-clave para no gastar aunque haya clave en el .env.
// probar-alpaca pide datos públicos de Alpaca: detrás de un proxy, el fetch de
// Node necesita NODE_USE_ENV_PROXY=1, que se pone solo si hay proxy en el entorno.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ARGS = { 'probar-llm.js': ['--sin-clave'] };

function correr(fichero, args) {
  return new Promise(resolver => {
    const t0 = Date.now();
    const env = { ...process.env };
    if ((env.HTTPS_PROXY || env.https_proxy) && env.NODE_USE_ENV_PROXY === undefined) env.NODE_USE_ENV_PROXY = '1';
    const hijo = spawn(process.execPath, [path.join(RAIZ, 'scripts', fichero), ...args], { cwd: RAIZ, env });
    let salida = '';
    hijo.stdout.on('data', d => { salida += d; });
    hijo.stderr.on('data', d => { salida += d; });
    hijo.on('close', codigo => resolver({ fichero, args, codigo, salida, segundos: (Date.now() - t0) / 1000 }));
  });
}

function resumenDe(salida) {
  const lineas = salida.split('\n').map(l => l.trim()).filter(Boolean);
  const oks = lineas.filter(l => /^OK\b/.test(l)).length;
  const fallos = lineas.filter(l => /^FALLO\b/.test(l));
  return { oks, fallos, ultima: lineas[lineas.length - 1] || '' };
}

async function main() {
  const scripts = fs.readdirSync(path.join(RAIZ, 'scripts'))
    .filter(f => /^probar-.+\.js$/.test(f) && f !== 'probar-todo.js')
    .sort();
  const trabajos = [...scripts.map(f => [f, ARGS[f] || []]), ['demo-acelerada.js', ['--dias=20']]];
  const resultados = [];
  for (const [f, args] of trabajos) {
    process.stdout.write(`… ${f} ${args.join(' ')}\n`);
    const r = await correr(f, args);
    resultados.push(r);
    const s = resumenDe(r.salida);
    const estado = r.codigo === 0 ? 'OK   ' : 'FALLO';
    console.log(`${estado} ${f}${args.length ? ' ' + args.join(' ') : ''} (${r.segundos.toFixed(1)} s): ${s.oks} casos OK${s.fallos.length ? `, ${s.fallos.length} FALLO` : ''} · ${s.ultima.slice(0, 120)}`);
    if (r.codigo !== 0) {
      for (const l of s.fallos.slice(0, 10)) console.log(`        ${l}`);
      if (!s.fallos.length) console.log(r.salida.split('\n').slice(-15).map(l => `        ${l}`).join('\n'));
    }
  }
  const malos = resultados.filter(r => r.codigo !== 0);
  console.log(`\n${malos.length ? 'FALLO' : 'OK'}: ${resultados.length - malos.length} de ${resultados.length} scripts salen con 0.`);
  process.exit(malos.length ? 1 : 0);
}

main().catch(e => { console.error(`FALLO: ${e.stack || e.message}`); process.exit(1); });
