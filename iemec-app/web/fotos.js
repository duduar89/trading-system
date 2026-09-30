#!/usr/bin/env node
'use strict';
// Fotos de la web: node web/fotos.js [--origen <carpeta>] [--inventario <inventario.json>]
//
// Convierte a WebP (480, 960 y 1600 px de ancho, nunca más que el original) las fotos de
// web/fotos/fotos.json con «usar»: true que el inventario marca como «propia», con el Chromium de
// Playwright y un <canvas> (sin dependencias nuevas). Recorta el margen transparente del logotipo y
// genera la imagen para redes (1200 × 630) y el icono de 180 px. Las imágenes van a web/fotos/ (en
// .gitignore); en git solo queda fotos.json con lo que se ha generado.
/* global document, Image -- lo de pagina.evaluate corre en el navegador */
const fs = require('fs');
const path = require('path');

const WEB = __dirname;
const RAIZ = path.join(WEB, '..');
// Carpeta compartida del inventario de la vuelta 9 (fuera del repositorio).
const COMPARTIDA = '/tmp/claude-0/-home-user-trading-system/05494b19-1a8b-5106-9784-ff8c08cbd031/scratchpad/web';
const CHROMIUM = [process.env.CHROMIUM_RUTA, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
const ANCHOS = [480, 960, 1600];

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(nombre);
  return i !== -1 ? path.resolve(process.argv[i + 1]) : porDefecto;
}

async function lanzar() {
  const { chromium } = require('@playwright/test');
  for (const executablePath of [...CHROMIUM.filter((r) => r && fs.existsSync(r)), undefined]) {
    try { return await chromium.launch({ executablePath, headless: true }); } catch { /* el siguiente */ }
  }
  throw new Error('No hay Chromium: instala el de Playwright o pon CHROMIUM_RUTA.');
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// Dentro de la página: carga la imagen, recorta el margen transparente si se pide (o la caja
// «recorte»: [x, y, ancho, alto] del original) y la reescala.
async function convertir(pagina, dataUrl, anchos, { recortar, calidad, caja = null }) {
  return pagina.evaluate(async ({ dataUrl, anchos, recortar, calidad, caja }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    let sx = 0; let sy = 0; let sw = img.naturalWidth; let sh = img.naturalHeight;
    if (caja) { [sx, sy, sw, sh] = caja; }
    if (recortar) {
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const { data } = x.getImageData(0, 0, sw, sh);
      let minX = sw; let minY = sh; let maxX = -1; let maxY = -1;
      for (let y = 0; y < sh; y++) {
        for (let xx = 0; xx < sw; xx++) {
          if (data[(y * sw + xx) * 4 + 3] > 8) { if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
      }
      if (maxX >= minX) { const m = 4; sx = Math.max(0, minX - m); sy = Math.max(0, minY - m); sw = Math.min(img.naturalWidth, maxX + m + 1) - sx; sh = Math.min(img.naturalHeight, maxY + m + 1) - sy; }
    }
    const salidas = [];
    const usados = new Set();
    for (const pedido of anchos) {
      const ancho = Math.min(pedido, sw);
      if (usados.has(ancho)) continue;
      usados.add(ancho);
      const alto = Math.round((sh * ancho) / sw);
      // Reducir a la mitad en pasos da un resultado más fino que un solo salto grande.
      let fuente = img; let fx = sx; let fy = sy; let fw = sw; let fh = sh;
      while (fw / 2 > ancho) {
        const paso = document.createElement('canvas');
        paso.width = Math.round(fw / 2); paso.height = Math.round(fh / 2);
        const px = paso.getContext('2d');
        px.imageSmoothingQuality = 'high';
        px.drawImage(fuente, fx, fy, fw, fh, 0, 0, paso.width, paso.height);
        fuente = paso; fx = 0; fy = 0; fw = paso.width; fh = paso.height;
      }
      const c = document.createElement('canvas');
      c.width = ancho; c.height = alto;
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(fuente, fx, fy, fw, fh, 0, 0, ancho, alto);
      salidas.push({ ancho, alto, datos: c.toDataURL('image/webp', calidad) });
    }
    return salidas;
  }, { dataUrl, anchos, recortar, calidad, caja });
}

function fuenteBase64(nombre) {
  return fs.readFileSync(path.join(RAIZ, 'app', 'public', 'fuentes', nombre)).toString('base64');
}

// Imagen para redes: terciopelo, filete dorado, logotipo y una frase (1200 × 630).
function htmlOg(logoDataUrl) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:P;font-style:italic;font-weight:500;src:url(data:font/woff2;base64,${fuenteBase64('playfair-display-latin-500-italic.woff2')}) format('woff2')}
@font-face{font-family:M;font-weight:400;src:url(data:font/woff2;base64,${fuenteBase64('montserrat-latin-400-normal.woff2')}) format('woff2')}
@font-face{font-family:M;font-weight:300;src:url(data:font/woff2;base64,${fuenteBase64('montserrat-latin-300-normal.woff2')}) format('woff2')}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{position:relative;color:#eef3f1;font-family:M,sans-serif;background:radial-gradient(120% 80% at 8% 0%,rgba(42,113,109,.45) 0%,transparent 58%),radial-gradient(90% 70% at 100% 100%,#071e1d 0%,transparent 62%),linear-gradient(160deg,#134442 0%,#0f3634 46%,#0b2b2a 100%)}
.cap{position:absolute;inset:0;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'><path d='M0 28 28 0 56 28 28 56Z' fill='none' stroke='%23d9bf8f' stroke-opacity='.12'/><circle cx='28' cy='0' r='1.7' fill='%23d9bf8f' fill-opacity='.28'/><circle cx='0' cy='28' r='1.7' fill='%23d9bf8f' fill-opacity='.28'/><circle cx='56' cy='28' r='1.7' fill='%23d9bf8f' fill-opacity='.28'/><circle cx='28' cy='56' r='1.7' fill='%23d9bf8f' fill-opacity='.28'/></svg>");-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 70%)}
.filete{position:absolute;inset:22px;border:1.5px solid rgba(201,164,92,.6)}
.in{position:absolute;left:92px;top:96px;right:92px}
.logo{height:92px}
.logo-texto{font-weight:300;letter-spacing:.42em;font-size:64px;color:#76c3c7}
h1{font-family:P,serif;font-style:italic;font-weight:500;font-size:74px;line-height:1.08;margin:64px 0 0;color:#fff}
h1 em{color:#d9bf8f;font-style:italic}
p{margin:30px 0 0;font-size:24px;letter-spacing:.2em;text-transform:uppercase;color:#d9bf8f}
</style></head><body><div class="cap"></div><div class="filete"></div><div class="in">
${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="">` : '<div class="logo-texto">IEMEC</div>'}
<h1>Medicina estética y capilar<br><em>en Boadilla del Monte</em></h1>
<p>Centro sanitario autorizado · CS17886</p></div></body></html>`;
}

const ICONO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180"><rect width="64" height="64" fill="#0b2b2a"/><g stroke="#d9bf8f" stroke-width="5.5" stroke-linecap="round"><path d="M18 20h28M22 32h20M18 44h28"/></g></svg>';

async function main() {
  const origen = argumento('--origen', process.env.IEMEC_FOTOS_ORIGEN || path.join(COMPARTIDA, 'fotos-origen'));
  const rutaInventario = argumento('--inventario', path.join(path.dirname(origen), 'inventario.json'));
  const rutaFotos = path.join(WEB, 'fotos', 'fotos.json');
  const catalogo = JSON.parse(fs.readFileSync(rutaFotos, 'utf8'));
  let propias = null;
  if (fs.existsSync(rutaInventario)) {
    const inv = JSON.parse(fs.readFileSync(rutaInventario, 'utf8'));
    propias = new Set(inv.fotos.filter((f) => f.derechos === 'propia').map((f) => path.basename(f.archivo)));
  } else {
    console.warn(`Sin inventario en ${rutaInventario}: se confía en «derechos» de fotos.json.`);
  }
  const navegador = await lanzar();
  const pagina = await navegador.newPage();
  await pagina.setContent('<!doctype html><title>fotos</title>');
  let hechas = 0;
  for (const [clave, f] of Object.entries(catalogo.fotos)) {
    delete f.salidas;
    const archivo = path.join(origen, path.basename(f.origen));
    const esPropia = f.derechos === 'propia' && (!propias || propias.has(path.basename(f.origen)));
    if (!f.usar || !esPropia) continue;
    if (!fs.existsSync(archivo)) { console.warn(`Falta ${archivo}: se salta ${clave}.`); continue; }
    const dataUrl = `data:${MIME[path.extname(archivo).toLowerCase()] || 'image/png'};base64,${fs.readFileSync(archivo).toString('base64')}`;
    const salidas = await convertir(pagina, dataUrl, f.anchos || ANCHOS, { recortar: !!f.logotipo, calidad: f.logotipo ? 0.92 : 0.82, caja: f.recorte || null });
    f.salidas = salidas.map((s) => {
      const nombre = `${clave}-${s.ancho}.webp`;
      fs.writeFileSync(path.join(WEB, 'fotos', nombre), Buffer.from(s.datos.split(',')[1], 'base64'));
      return { archivo: nombre, ancho: s.ancho, alto: s.alto };
    });
    hechas++;
    console.log(`${clave}: ${f.salidas.map((s) => `${s.ancho}×${s.alto}`).join(', ')}`);
  }
  // Imagen para redes e icono.
  const logo = catalogo.fotos['iemec-logotipo-completo-turquesa-810'];
  const logoUrl = logo && logo.salidas ? `data:image/webp;base64,${fs.readFileSync(path.join(WEB, 'fotos', logo.salidas[logo.salidas.length - 1].archivo)).toString('base64')}` : null;
  await pagina.setViewportSize({ width: 1200, height: 630 });
  await pagina.setContent(htmlOg(logoUrl), { waitUntil: 'load' });
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.screenshot({ path: path.join(WEB, 'fotos', 'og-iemec.jpg'), type: 'jpeg', quality: 88 });
  catalogo.og = { archivo: 'og-iemec.jpg', ancho: 1200, alto: 630, alt: 'IEMEC, medicina estética y capilar en Boadilla del Monte' };
  await pagina.setViewportSize({ width: 180, height: 180 });
  await pagina.setContent(`<!doctype html><html><body style="margin:0">${ICONO}</body></html>`);
  await pagina.screenshot({ path: path.join(WEB, 'fotos', 'icono-180.png'), type: 'png', clip: { x: 0, y: 0, width: 180, height: 180 } });
  catalogo.icono = { archivo: 'icono-180.png', ancho: 180, alto: 180 };
  await navegador.close();
  fs.writeFileSync(rutaFotos, `${JSON.stringify(catalogo, null, 2)}\n`);
  console.log(`Hechas ${hechas} fotos, la imagen para redes y el icono. Ahora: npm run web`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
