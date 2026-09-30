'use strict';
// Caso conocido de las vistas (Evolución, Estrategias, Noticias, Decisiones y
// Laboratorio): una mesa sintética de unos días (semilla 42) y cada cifra que
// enseñan los informes se contrasta con el dato guardado del que sale. Si una
// cifra de la vista no cuadra con su registro, la vista se la estaría
// inventando.
//
//   node scripts/probar-vistas.js [--dias=10] [--navegador] [--capturas=carpeta]
//
// Casos:
//   historial reducido  ≤ puntos pedidos, con el primero, el último, el máximo
//                       y el mínimo del patrimonio y todos los sucesos (un kill al final)
//   variación           la del periodo = (último − primero) / primero del fichero
//   reparto             Σ pesos + sin asignar = 100 % en cada punto
//   estrategias         peso, métricas y backtest = los de la instantánea; el
//                       último P&L de su evolución = el del historial
//   laboratorio         hipótesis evaluadas = decisiones «laboratorio»; ensayos
//                       = los del estado
//   decisiones          el filtro por tipo solo devuelve ese tipo
// Con --navegador: las cinco vistas en Chromium real (390×844 y 1440×900),
// sin errores de consola ni de la CSP, y capturas en --capturas.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { crearConfig, leerArgs } = require('../src/config');
const { construir } = require('../src/index');
const { crearLLM } = require('../src/agentes/llm');
const { leerJSONL } = require('../src/util/almacen');
const { MIN, DIA } = require('../src/util/reloj');
const informes = require('../src/informes');
const V = require('../web/js/vistas.js');
const logMod = require('../src/util/log');

const PASO = 5 * MIN;
const INICIO = Date.UTC(2026, 5, 1);
const P = o => new URLSearchParams(o);

async function main() {
  const args = leerArgs();
  const dias = Number(args.dias) || 10;
  logMod.fijarNivel('silencio');
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-vistas-'));
  const casos = [];
  const caso = (ok, texto) => { casos.push(ok); console.log(`${ok ? 'OK   ' : 'FALLO'} ${texto}`); };
  let o;
  try {
    const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: '42' });
    config.inicio = INICIO;
    const llm = crearLLM({ apiKey: '', reloj: { tipo: 'simulado', ahora: () => 0 } });
    const piezas = construir(config, { llm, opciones: { comiteEnSegundoPlano: false, pausaComiteMs: 0, intervaloEstadoMs: 0 } });
    o = piezas.orquestador;
    await o.iniciar();
    const pasos = Math.round(dias * DIA / PASO);
    for (let k = 0; k < pasos; k++) {
      piezas.reloj.avanzar(PASO);
      await o.paso();
      if (k % 50 === 0) await new Promise(r => setImmediate(r));
    }
    // Un kill al final: un suceso en el historial y una decisión que marcar.
    const kill = await o.comando('kill', { confirmacion: 'KILL' });
    caso(Boolean(kill && kill.ok), 'kill final para tener un suceso en la línea de tiempo');
    piezas.reloj.avanzar(PASO);
    await o.paso();
    await o.esperarTareas();
    const inst = o.instantanea();
    const todo = leerJSONL(path.join(carpeta, 'historial.jsonl'));

    // Historial reducido.
    const red = informes.consultar('historial', { carpeta, params: P({ puntos: '100' }) });
    const patr = todo.map(l => l.patrimonio);
    const max = Math.max(...patr);
    const min = Math.min(...patr);
    const sucesos = todo.filter(l => l.motivo !== 'hora').length;
    caso(red.length <= 100 && todo.length > 100, `historial: ${todo.length} líneas reducidas a ${red.length} (≤ 100)`);
    caso(red[0].t === todo[0].t && red[red.length - 1].t === todo[todo.length - 1].t, 'historial: el primer y el último punto se quedan');
    caso(red.some(l => l.patrimonio === max) && red.some(l => l.patrimonio === min), `historial: el máximo (${Math.round(max)} $) y el mínimo (${Math.round(min)} $) del patrimonio se quedan`);
    caso(sucesos >= 1 && red.filter(l => l.motivo !== 'hora').length === sucesos, `historial: los ${sucesos} sucesos se quedan`);
    const marcas = V.marcasDe(todo, leerJSONL(path.join(carpeta, 'decisiones.jsonl')));
    caso(marcas.some(m => m.tipo === 'kill' && m.vertical), 'evolución: el kill sale como marca en la línea de tiempo');

    // Variación del periodo y reparto.
    const s = V.seriesEvolucion(todo);
    const va = V.variacion(s.fondo);
    const esperada = todo[todo.length - 1].patrimonio / todo[0].patrimonio - 1;
    caso(Math.abs(va.pct - esperada) < 1e-12, `variación del periodo ${(va.pct * 100).toFixed(4)} % = la del fichero`);
    const rep = V.reparto(s);
    const suma = i => rep.capas.reduce((x, c) => x + c.valores[i], 0) + rep.libre[i];
    caso(s.ts.every((_, i) => Math.abs(suma(i) - 1) < 1e-9), 'reparto: Σ pesos + sin asignar = 100 % en cada punto');

    // Estrategias frente a la instantánea y al historial.
    const est = informes.consultar('estrategias', { carpeta, instantanea: () => inst });
    let bien = est.mesas.length === inst.mesas.length;
    const ultima = todo[todo.length - 1];
    for (const m of inst.mesas) {
      const x = est.mesas.find(y => y.id === m.id);
      const h = ultima.mesas.find(y => y.id === m.id);
      if (!x || x.peso !== m.peso || x.papel.operaciones !== m.metricas.operaciones || x.papel.pnlTotal !== m.metricas.pnlTotal) bien = false;
      if (!x || JSON.stringify(x.backtest) !== JSON.stringify(m.backtest)) bien = false;
      const ev = x && x.evolucion[x.evolucion.length - 1];
      if (!ev || !h || ev.pnl !== h.pnlAcumulado) bien = false;
    }
    caso(bien, `estrategias: ${est.mesas.length} mesas con peso, métricas y backtest de la instantánea y su último P&L del historial`);

    // Laboratorio frente a las decisiones y el estado.
    const lab = informes.consultar('laboratorio', { carpeta, instantanea: () => inst });
    const evaluadas = new Set(leerJSONL(path.join(carpeta, 'decisiones.jsonl')).filter(d => d.tipo === 'laboratorio').map(d => d.datos.hipotesisId)).size;
    caso(lab.resumen.evaluadas === evaluadas, `laboratorio: ${lab.resumen.evaluadas} hipótesis evaluadas = ${evaluadas} decisiones «laboratorio»`);
    caso(lab.ensayosTotales === o.estado.laboratorio.ensayosTotales, `laboratorio: ${lab.ensayosTotales} ensayos = los del estado`);

    // Decisiones por tipo.
    const ordenes = informes.consultar('decisiones', { carpeta, params: P({ tipo: 'orden', limite: '50' }) });
    caso(ordenes.length > 0 && ordenes.every(d => d.tipo === 'orden'), `decisiones: ${ordenes.length} órdenes y ninguna de otro tipo`);

    if (args.navegador) await navegador({ carpeta, config, caso, capturas: args.capturas, orquestador: o });
  } finally {
    if (o) await o.detener().catch(() => {});
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
  const ok = casos.every(Boolean);
  console.log(`\n${ok ? 'OK' : 'FALLO'}: ${casos.filter(Boolean).length} de ${casos.length} casos de las vistas.`);
  process.exit(ok ? 0 : 1);
}

// Las cinco vistas en Chromium real, en modo web (con login) y la CSP de verdad.
async function navegador({ carpeta, config, caso, capturas, orquestador }) {
  let pw = null;
  try { pw = require('playwright'); } catch (_) { try { pw = require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (__) { pw = null; } }
  if (!pw) { console.log('AVISO sin playwright: no se comprueba en Chromium'); return; }
  const { publicarInstantanea } = require('../src/latido');
  publicarInstantanea({ ...config, carpetaDatos: carpeta }, orquestador);
  const { crearServidor } = require('../src/servidor');
  const { almacenMemoria } = require('../src/web/almacen');
  const almacen = almacenMemoria();
  await almacen.crearUsuario({ usuario: 'eduardo', clave: 'una-clave-de-prueba-larga' });
  const servidor = crearServidor({ modo: 'web', config, raizWeb: path.join(__dirname, '..', 'web'), carpetaDatos: carpeta, almacen, conLaMesa: async () => ({ ok: false, motivo: 'error' }) });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${servidor.address().port}`;
  const salida = path.resolve(String(capturas || path.join(os.tmpdir(), 'mesa-capturas')));
  fs.mkdirSync(salida, { recursive: true });
  const opciones = { headless: true };
  const exe = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
  if (exe) opciones.executablePath = exe;
  const nav = await pw.chromium.launch(opciones);
  try {
    for (const [ancho, alto, movil] of [[390, 844, true], [1440, 900, false]]) {
      const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: movil ? 2 : 1, isMobile: movil, hasTouch: movil });
      const p = await ctx.newPage();
      const errores = [];
      p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
      p.on('pageerror', e => errores.push(e.message));
      await p.addInitScript(() => { document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); }); });
      await p.goto(`${base}/login`);
      await p.fill('#usuario', 'eduardo');
      await p.fill('#clave', 'una-clave-de-prueba-larga');
      await Promise.all([p.waitForURL(`${base}/`), p.click('#entrar')]);
      await p.waitForFunction(() => /\d/.test((document.getElementById('v-patrimonio') || {}).textContent || ''), null, { timeout: 15000 });
      await p.click('#abrir-vistas');
      for (const v of V.VISTAS.map(x => x.id)) {
        await p.click(`#vt-${v}`);
        await p.waitForSelector(`#vt-${v}[aria-selected="true"]`);
        await p.waitForSelector('#vistas-panel .vistas-contenido', { timeout: 15000 });
        await p.waitForTimeout(1300);
        const texto = await p.textContent('#vistas-panel');
        caso(texto.length > 40 && !/No se pudo|respondió \d/.test(texto), `${ancho}×${alto}: la vista ${v} se pinta`);
        await p.screenshot({ path: path.join(salida, `vistas-${v}-${ancho}x${alto}.png`) });
      }
      // Evolución: tocar la gráfica abre la ficha con las cifras.
      await p.click('#vt-evolucion');
      await p.waitForSelector('.v-grafica .g-capa');
      const caja = await p.locator('.v-grafica .g-capa').first().boundingBox();
      await p.mouse.click(caja.x + caja.width * 0.6, caja.y + caja.height / 2);
      const ficha = await p.locator('.v-grafica .g-ficha').first().textContent();
      caso(/El fondo/.test(ficha) && /%/.test(ficha), `${ancho}×${alto}: tocar la gráfica enseña la ficha (${ficha.slice(0, 50).replace(/\s+/g, ' ')}…)`);
      await p.click('.vistas-cerrar');
      const cerrada = await p.waitForFunction(() => document.getElementById('vistas').hidden && !location.hash, null, { timeout: 5000 }).then(() => true, () => false);
      caso(cerrada, `${ancho}×${alto}: cerrar vuelve al parqué (y «atrás» no deja una vista en el historial)`);
      const csp = await p.evaluate(() => window.__csp || []);
      caso(!csp.length, `${ancho}×${alto}: sin violaciones de la CSP${csp.length ? `: ${csp.join(' | ')}` : ''}`);
      caso(!errores.length, `${ancho}×${alto}: sin errores en la consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`);
      await ctx.close();
    }
    console.log(`Capturas en ${salida}`);
  } finally {
    await nav.close();
    await new Promise(r => servidor.close(r));
  }
}

main().catch(e => { console.error(`FALLO: ${e.stack || e.message}`); process.exit(1); });
