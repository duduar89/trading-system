// Ejecuta todas las pruebas E2E contra un build de producción: (opcionalmente) compila, levanta `vite preview` en un
// puerto libre, lanza los scripts uno tras otro, imprime un resumen y termina con código ≠ 0 si alguno falla.
//
// Uso: node e2e/run-all.mjs [opciones]
//   --build            compila antes (vite build) en la carpeta de --dist
//   --dist=<carpeta>   build a servir (por defecto ./dist)
//   --port=<n>         puerto de vite preview (por defecto, uno libre)
//   --only=a,b         sólo estos scripts (smoke, offline, compras, carta, a11y, perf)
//   --a11y             añade la auditoría de accesibilidad (e2e/a11y.mjs)
//   --perf             añade la medición de carga inicial (e2e/perf.mjs)
//   --out=<carpeta>    carpeta para capturas y archivos (por defecto e2e/screenshots)
// Ejemplo: node e2e/run-all.mjs --build --a11y --perf
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const DIST = resolve(ROOT, opt('dist') ?? 'dist');
const OUT = resolve(ROOT, opt('out') ?? 'e2e/screenshots');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

/** Scripts en orden (de más rápido a más lento). `ok` decide el éxito a partir del código de salida y la salida. */
const SCRIPTS = [
  { name: 'smoke', file: 'e2e/smoke.mjs', args: (base) => [base, join(OUT, 'smoke')], ok: (code, out) => code === 0 && /SIN ERRORES\s*$/.test(out.trim()), timeoutMin: 10 },
  { name: 'offline', file: 'e2e/offline.mjs', args: (base) => [base], ok: (code) => code === 0, timeoutMin: 5 },
  { name: 'compras', file: 'e2e/compras.mjs', args: (base) => [base, join(OUT, 'compras')], ok: (code) => code === 0, timeoutMin: 30 },
  { name: 'carta', file: 'e2e/carta.mjs', args: (base) => [base, join(OUT, 'carta')], ok: (code) => code === 0, timeoutMin: 30 },
  { name: 'a11y', file: 'e2e/a11y.mjs', args: (base) => [base], ok: (code) => code === 0, timeoutMin: 15, optional: 'a11y' },
  { name: 'perf', file: 'e2e/perf.mjs', args: (base) => [base, DIST], ok: (code) => code === 0, timeoutMin: 5, optional: 'perf' },
];

const only = opt('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const selected = SCRIPTS.filter((s) => (only ? only.includes(s.name) : !s.optional || flag(s.optional)));
if (!selected.length) {
  console.error(`Nada que ejecutar. Scripts disponibles: ${SCRIPTS.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

/** Lanza un proceso mostrando su salida con prefijo; resuelve con el código de salida y la salida completa. */
function run(cmd, cmdArgs, { prefix, timeoutMin, env } = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (buf) => {
      const text = buf.toString();
      out += text;
      for (const line of text.split('\n')) if (line.trim()) process.stdout.write(prefix ? `[${prefix}] ${line}\n` : `${line}\n`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = timeoutMin
      ? setTimeout(() => {
          out += `\nTIEMPO AGOTADO (${timeoutMin} min)`;
          child.kill('SIGKILL');
        }, timeoutMin * 60_000)
      : undefined;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      res({ code: code ?? 1, out });
    });
  });
}

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* aún arrancando */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const results = [];
let preview;
const stopPreview = () => {
  if (preview && preview.exitCode == null) {
    try {
      process.kill(-preview.pid, 'SIGTERM');
    } catch {
      preview.kill('SIGTERM');
    }
  }
};
process.on('SIGINT', () => {
  stopPreview();
  process.exit(130);
});

try {
  if (flag('build')) {
    console.log(`▶ Compilando en ${DIST}…`);
    const b = await run('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir'], { prefix: 'build', timeoutMin: 10 });
    if (b.code !== 0) throw new Error('La compilación ha fallado');
  }
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No hay build en ${DIST}: ejecuta con --build o indica --dist=<carpeta>`);
  mkdirSync(OUT, { recursive: true });

  const port = Number(opt('port')) || (await freePort());
  const base = `http://localhost:${port}/`;
  console.log(`▶ Sirviendo ${DIST} en ${base}`);
  preview = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  if (!(await waitForServer(base))) throw new Error(`vite preview no responde en ${base}`);

  for (const s of selected) {
    console.log(`\n▶ ${s.name} (${s.file})`);
    const t0 = Date.now();
    const r = await run('node', [s.file, ...s.args(base)], { prefix: s.name, timeoutMin: s.timeoutMin });
    const ok = s.ok(r.code, r.out);
    const failures = r.out.split('\n').filter((l) => /^\s*(FAIL|✗)|TIEMPO AGOTADO|Excepción/.test(l)).slice(0, 12);
    results.push({ name: s.name, ok, seconds: (Date.now() - t0) / 1000, failures });
  }
} catch (e) {
  results.push({ name: 'preparación', ok: false, seconds: 0, failures: [e instanceof Error ? e.message : String(e)] });
} finally {
  stopPreview();
}

console.log('\n══════════ Resumen E2E ══════════');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(12)} ${r.seconds.toFixed(1).padStart(7)} s`);
  if (!r.ok) for (const f of r.failures) console.log(`        ${f.trim()}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} de ${results.length} con fallos` : `\nTodo en verde (${results.length} de ${results.length})`);
process.exit(failed ? 1 : 0);
