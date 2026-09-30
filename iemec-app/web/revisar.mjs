#!/usr/bin/env node
// Revisión de la web en un Chromium de verdad, sobre el sitio servido en local (puerto 4321):
//   node web/revisar.mjs [--capturas <carpeta>] [--rapido] [--puerto 4321]
// Mira todas las páginas del sitemap (y la 404) de 320 a 1440 px: que ninguna caja se salga por los
// lados (por su rectángulo: con overflow-x: clip no hay barra horizontal que avise), que no
// haya errores de consola ni imágenes rotas y que las zonas de toque midan al menos 44 px. Prueba el
// menú del móvil (abre, atrapa el foco, se cierra con Escape) y guarda capturas a página completa de
// las cinco páginas clave en móvil (390 × 844) y escritorio (1440 × 900).
// Si no hay nada escuchando en el puerto, arranca web/servir.js y lo para al acabar (por su PID).
/* global document, getComputedStyle -- lo de pagina.evaluate corre en el navegador */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import playwright from '@playwright/test';

const { chromium } = playwright;
const WEB = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opcion = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const PUERTO = Number(opcion('--puerto', 4321));
const BASE = `http://127.0.0.1:${PUERTO}`;
const CAPTURAS = path.resolve(opcion('--capturas', path.join(WEB, 'capturas')));
const RAPIDO = args.includes('--rapido');
const ANCHOS = RAPIDO ? [320, 390, 1440] : [320, 360, 390, 414, 768, 1024, 1280, 1440];
const CLAVE = ['/', '/medicina-estetica-facial/', '/medicina-estetica-corporal/lipolaser/', '/tratamientos/', '/pedir-cita/'];
const CHROMIUM = [process.env.CHROMIUM_RUTA, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];

async function responde() {
  try { const r = await fetch(`${BASE}/`); return r.ok; } catch { return false; }
}

async function asegurarServidor() {
  if (await responde()) return null;
  const hijo = spawn(process.execPath, [path.join(WEB, 'servir.js'), String(PUERTO)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await responde()); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await responde())) throw new Error('No arranca web/servir.js');
  return hijo;
}

async function lanzar() {
  for (const executablePath of [...CHROMIUM.filter((r) => r && fs.existsSync(r)), undefined]) {
    try { return await chromium.launch({ executablePath, headless: true }); } catch { /* el siguiente */ }
  }
  throw new Error('No hay Chromium');
}

// ── Dentro de la página ─────────────────────────────────────────────────────────────────────
function medir() {
  const ancho = document.documentElement.clientWidth;
  const desbordes = [];
  // Con body { overflow-x: clip } nunca sale barra horizontal: scrollWidth no avisa de nada. Se mira
  // cada caja (su rectángulo), salvo lo que está dentro de algo que se desplaza a propósito (los
  // chips, las tarjetas que se deslizan), lo decorativo y lo oculto. Lo que una sección recorta con
  // overflow: hidden sí cuenta: un título partido por el borde es un desborde.
  const seDesplazaDentro = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || (r.right <= ancho + 1 && r.left >= -1)) continue;
    if (getComputedStyle(el).position === 'fixed' || el.closest('.sprite, .trampa, .solo-lector, [hidden], [aria-hidden="true"]') || seDesplazaDentro(el)) continue;
    desbordes.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ').join('.')}` : ''} (${Math.round(r.left)}–${Math.round(r.right)} px)`);
    if (desbordes.length > 5) break;
  }
  if (!desbordes.length && document.documentElement.scrollWidth > ancho + 1) desbordes.push(`scrollWidth ${document.documentElement.scrollWidth} > ${ancho}`);
  const rotas = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
  const pequenas = [];
  const visibles = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0; };
  for (const el of document.querySelectorAll('a[href], button, summary, select, textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), label.opcion, .casilla label')) {
    if (!visibles(el) || el.closest('.trampa, [hidden], .sprite')) continue;
    // Enlaces dentro de un texto corrido: excepción de las WCAG (2.5.8, «en línea»).
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') {
      const padre = el.parentElement;
      const propio = el.textContent.trim().length;
      const total = padre ? padre.textContent.trim().length : propio;
      if (total > propio + 3) continue;
    }
    // El título de una tarjeta es un enlace «estirado» (::after sobre toda la tarjeta): su zona es la tarjeta.
    const r = el.matches('.tarjeta h3 a, .tarjeta h4 a') ? el.closest('.tarjeta').getBoundingClientRect() : el.getBoundingClientRect();
    if (r.height < 44 || r.width < 44) pequenas.push(`${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40)}» ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  return { desbordes, rotas, pequenas: pequenas.slice(0, 8), h1: document.querySelectorAll('h1').length };
}

async function prepararCaptura(pagina) {
  await pagina.evaluate(async () => {
    // En una captura a página completa, la barra fija de abajo saldría a media página: se pinta al final,
    // donde se ve al llegar abajo del todo.
    const barra = document.querySelector('.barra-movil');
    if (barra && getComputedStyle(barra).display !== 'none') {
      document.body.style.position = 'relative';
      barra.style.position = 'absolute';
    }
    for (const i of document.images) i.loading = 'eager';
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? (i.decode ? i.decode().catch(() => {}) : null) : new Promise((ok) => { i.onload = ok; i.onerror = ok; }))));
  });
  await pagina.waitForTimeout(150);
}

async function probarMenu(navegador, problemas) {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  const boton = p.locator('#boton-menu');
  await boton.click();
  const abierto = await p.evaluate(() => ({
    visible: !document.getElementById('menu-movil').hidden,
    expandido: document.getElementById('boton-menu').getAttribute('aria-expanded'),
    focoDentro: document.getElementById('menu-movil').contains(document.activeElement),
  }));
  if (!abierto.visible || abierto.expandido !== 'true' || !abierto.focoDentro) problemas.push({ pagina: '/', ancho: 390, problema: `menú: no abre bien ${JSON.stringify(abierto)}` });
  for (let i = 0; i < 40; i++) await p.keyboard.press('Tab');
  if (!(await p.evaluate(() => document.getElementById('menu-movil').contains(document.activeElement)))) problemas.push({ pagina: '/', ancho: 390, problema: 'menú: el foco se escapa con Tab' });
  await p.keyboard.press('Escape');
  const cerrado = await p.evaluate(() => ({ oculto: document.getElementById('menu-movil').hidden, expandido: document.getElementById('boton-menu').getAttribute('aria-expanded'), foco: document.activeElement && document.activeElement.id }));
  if (!cerrado.oculto || cerrado.expandido !== 'false' || cerrado.foco !== 'boton-menu') problemas.push({ pagina: '/', ancho: 390, problema: `menú: Escape no cierra bien ${JSON.stringify(cerrado)}` });
  await ctx.close();
  const esc = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const q = await esc.newPage();
  await q.goto(`${BASE}/`, { waitUntil: 'load' });
  if (await q.locator('#boton-menu').isVisible()) problemas.push({ pagina: '/', ancho: 1440, problema: 'el botón del menú móvil se ve en escritorio' });
  await esc.close();
  return { abierto, cerrado };
}

async function main() {
  const servidor = await asegurarServidor();
  const navegador = await lanzar();
  const problemas = [];
  try {
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    const rutas = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
    rutas.push('/gracias/', '/esta-pagina-no-existe/');
    let cargas = 0;
    for (const ancho of ANCHOS) {
      const ctx = await navegador.newContext({ viewport: { width: ancho, height: 900 }, reducedMotion: 'reduce' });
      const pagina = await ctx.newPage();
      const errores = [];
      // La 404 de prueba se pide a propósito: su «Failed to load resource» no es un error de la web.
      pagina.on('console', (m) => { if (m.type() === 'error' && !(m.text().includes('404') && pagina.url().includes('esta-pagina-no-existe'))) errores.push(m.text()); });
      pagina.on('pageerror', (e) => errores.push(e.message));
      pagina.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400 && !r.url().includes('esta-pagina-no-existe')) errores.push(`${r.status()} ${r.url()}`); });
      for (const ruta of rutas) {
        errores.length = 0;
        await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'load' });
        cargas++;
        const m = await pagina.evaluate(medir);
        if (m.desbordes.length) problemas.push({ pagina: ruta, ancho, problema: `desborda: ${m.desbordes.join(', ')}` });
        if (m.rotas.length) problemas.push({ pagina: ruta, ancho, problema: `imágenes rotas: ${m.rotas.join(', ')}` });
        if (m.h1 !== 1) problemas.push({ pagina: ruta, ancho, problema: `${m.h1} H1` });
        if ((ancho === 390 || ancho === 1440) && m.pequenas.length) problemas.push({ pagina: ruta, ancho, problema: `zonas de toque < 44 px: ${m.pequenas.join(' | ')}` });
        if (errores.length) problemas.push({ pagina: ruta, ancho, problema: `consola: ${[...new Set(errores)].join(' | ')}` });
      }
      await ctx.close();
    }
    const menu = await probarMenu(navegador, problemas);
    // Capturas a página completa.
    fs.mkdirSync(CAPTURAS, { recursive: true });
    const hechas = [];
    for (const [nombre, viewport, movil] of [['movil', { width: 390, height: 844 }, true], ['escritorio', { width: 1440, height: 900 }, false]]) {
      const ctx = await navegador.newContext({ viewport, deviceScaleFactor: movil ? 2 : 1, isMobile: movil, hasTouch: movil, reducedMotion: 'reduce' });
      const pagina = await ctx.newPage();
      for (const ruta of CLAVE) {
        await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'load' });
        await prepararCaptura(pagina);
        const archivo = path.join(CAPTURAS, `${nombre}-${ruta === '/' ? 'inicio' : ruta.replace(/^\/|\/$/g, '').replace(/\//g, '--')}.png`);
        await pagina.screenshot({ path: archivo, fullPage: true });
        hechas.push(archivo);
      }
      await ctx.close();
    }
    const resumen = { fecha_revision: 'local', paginas: rutas.length, anchos: ANCHOS, cargas, menu, problemas, capturas: hechas.map((h) => path.basename(h)) };
    fs.writeFileSync(path.join(CAPTURAS, 'revisar.json'), `${JSON.stringify(resumen, null, 1)}\n`);
    console.log(`${rutas.length} páginas × ${ANCHOS.length} anchos (${cargas} cargas) · problemas: ${problemas.length} · capturas en ${CAPTURAS}`);
    for (const p of problemas.slice(0, 60)) console.log(`  ${p.pagina} @${p.ancho}: ${p.problema}`);
    process.exitCode = problemas.length ? 1 : 0;
  } finally {
    await navegador.close();
    if (servidor) servidor.kill();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
