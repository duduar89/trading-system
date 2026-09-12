/*
 * probar-web.js — prueba la página puente en un navegador de verdad.
 *
 *     node herramientas/probar-web.js
 *
 * Genera el sitio con una configuración de mentira en una carpeta temporal, lo
 * abre con Chromium y comprueba lo que de verdad importa:
 *
 *   · que el botón lleva al número correcto y con el mensaje escrito
 *   · que la sala del QR entra en el mensaje
 *   · que sin sala NO sale un «{sala}» a medio sustituir (el fallo más visible)
 *   · que dentro de Instagram aparece el aviso y el enlace cambia a intent://
 *   · que la página no pide NADA a servidores de fuera
 *
 * Si no encuentra Chromium, avisa y no falla: es una prueba de apoyo.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { generar } = require('./construir.js');

const NAVEGADORES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome'
];

const UA_NORMAL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_INSTAGRAM = UA_NORMAL + ' Instagram 300.0.0.0 Android';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let fallos = 0, pruebas = 0;
function comprobar(nombre, condicion, detalle) {
  pruebas++;
  if (condicion) return;
  fallos++;
  console.error('  FALLA  ' + nombre + (detalle ? ' — ' + detalle : ''));
}

function buscarNavegador() {
  for (const ruta of NAVEGADORES) if (fs.existsSync(ruta)) return ruta;
  return null;
}

function volcar(navegador, url, userAgent) {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-'));
  try {
    return execFileSync(navegador, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--virtual-time-budget=3000',
      '--user-data-dir=' + perfil,
      '--user-agent=' + userAgent,
      '--dump-dom',
      url
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
  } finally {
    fs.rmSync(perfil, { recursive: true, force: true });
  }
}

function principal() {
  const navegador = buscarNavegador();
  if (!navegador) {
    console.log('No hay Chromium en esta máquina: no se puede probar la página. Sin fallo.');
    return 0;
  }

  // ---------------------------------------------------- sitio de prueba
  const config = JSON.parse(JSON.stringify(require('../config.js')));
  config.artista.nombre = 'Prueba';
  config.artista.apellidos = 'De Prueba';
  config.artista.nombreArtistico = 'Prueba';
  config.mensajes.titulo = 'Prueba';
  config.sitio = 'https://prueba.ejemplo.es';
  config.redes = [{ nombre: 'Canal de WhatsApp', url: 'https://whatsapp.com/channel/PRUEBA', clave: 'canal' }];
  config.urlDeSoporte = require('../config.js').urlDeSoporte;

  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'puente-'));
  for (const fichero of fs.readdirSync(path.join(__dirname, '..', 'web'))) {
    fs.copyFileSync(path.join(__dirname, '..', 'web', fichero), path.join(temporal, fichero));
  }
  const resultado = generar(config, temporal, temporal);
  if (resultado.problemas.length) {
    console.error('La configuración de prueba no pasa la revisión:', resultado.problemas);
    return 1;
  }

  const base = 'file://' + temporal + '/index.html';

  console.log('1. Con sala: el mensaje la lleva dentro');
  {
    const dom = volcar(navegador, base + '?f=tarjeta&sala=Sala%20Clamores', UA_NORMAL);
    comprobar('el botón apunta a wa.me con el número correcto',
      /href="https:\/\/wa\.me\/34620591728\?text=/.test(dom), dom.match(/href="https:\/\/wa\.me[^"]*"/) || 'sin enlace');
    comprobar('el mensaje lleva la sala', /Sala%20Clamores/.test(dom));
    comprobar('sale el aviso de que hay que darle a enviar', /solo dale a enviar/.test(dom));
    comprobar('no queda ningún {sala} sin sustituir', dom.indexOf('%7Bsala%7D') < 0 && dom.indexOf('{sala}') < 0);
    comprobar('el aviso de navegador embebido está oculto', !/aviso visible/.test(dom));
    comprobar('el canal se pinta cuando hay enlace', /whatsapp\.com\/channel\/PRUEBA/.test(dom));
    comprobar('el enlace de guardar contacto apunta al .vcf', /href="contacto\.vcf"/.test(dom));
  }

  console.log('2. Sin sala: texto alternativo, nunca un hueco a medias');
  {
    const dom = volcar(navegador, base + '?f=cartel', UA_NORMAL);
    comprobar('usa el mensaje sin sala', /Vengo%20de%20verte%20esta%20noche/.test(dom));
    comprobar('no aparece {sala} ni undefined',
      dom.indexOf('%7Bsala%7D') < 0 && dom.indexOf('undefined') < 0 && dom.indexOf('null') < 0);
  }

  console.log('3. Dentro de Instagram: aviso y salida por intent://');
  {
    const dom = volcar(navegador, base + '?f=instagram', UA_INSTAGRAM);
    comprobar('aparece el aviso de aplicación embebida', /aviso visible/.test(dom));
    comprobar('en Android el botón pasa a intent://', /href="intent:\/\/send\?phone=34620591728/.test(dom));
    comprobar('el intent lleva respaldo a wa.me', /browser_fallback_url/.test(dom));
  }

  console.log('4. En iPhone dentro de Instagram: aviso, pero sin intent (allí no existe)');
  {
    const dom = volcar(navegador, base + '?f=instagram', UA_IPHONE.replace('Safari/604.1', 'Safari/604.1 Instagram 300.0.0.0'));
    comprobar('aparece el aviso', /aviso visible/.test(dom));
    comprobar('el enlace sigue siendo wa.me', /href="https:\/\/wa\.me\/34620591728/.test(dom));
  }

  console.log('5. La página no pide nada a servidores de fuera');
  {
    const html = fs.readFileSync(path.join(temporal, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(temporal, 'estilo.css'), 'utf8');
    const externos = (html + css).match(/(?:src|href)="https?:\/\/[^"]+"/g) || [];
    comprobar('no hay recursos externos en la página', externos.length === 0, externos.join(', '));
    comprobar('no hay @import de fuera', !/@import\s+url\(["']?https?:/.test(css));
  }

  console.log('6. A 320 px de ancho (el móvil más estrecho que hay) no se sale nada');
  {
    // Este Chromium no deja fijar el viewport por línea de órdenes, así que se
    // estrecha la propia página y se mide qué se sale. Sirve igual para lo que
    // importa: anchos fijos, palabras sin cortar y cajas que no encogen.
    const estrecho = path.join(temporal, 'estrecho.html');
    const html = fs.readFileSync(path.join(temporal, 'index.html'), 'utf8');
    const sonda = `
<style>html,body{width:320px!important;max-width:320px!important;overflow-x:visible!important}</style>
<script>
window.addEventListener('load',function(){
  var malas=[];
  document.querySelectorAll('body *').forEach(function(el){
    if (!el.offsetParent && el.tagName !== 'BODY') return;
    var r = el.getBoundingClientRect();
    if (r.width > 320.5 || r.right > 320.5) malas.push(el.tagName + '.' + (el.className || el.id || '?') + ':' + Math.round(r.width) + '/' + Math.round(r.right));
  });
  var p = document.createElement('pre'); p.id = 'ESTRECHO';
  p.textContent = malas.length ? malas.join(' ') : 'nada se sale';
  document.body.appendChild(p);
});
</script>`;
    fs.writeFileSync(estrecho, html.replace('</body>', sonda + '</body>'), 'utf8');
    const dom = volcar(navegador, 'file://' + estrecho + '?sala=Sala%20Clamores', UA_NORMAL);
    const encontrado = (dom.match(/<pre id="ESTRECHO">([^<]*)<\/pre>/) || [])[1];
    comprobar('nada se sale a 320 px de ancho', encontrado === 'nada se sale', encontrado || 'no se pudo medir');
  }

  console.log('7. La tarjeta de contacto está bien formada');
  {
    const vcf = fs.readFileSync(path.join(temporal, 'contacto.vcf'), 'utf8');
    comprobar('empieza y acaba como debe', vcf.startsWith('BEGIN:VCARD') && vcf.trim().endsWith('END:VCARD'));
    comprobar('es vCard 3.0', /VERSION:3\.0/.test(vcf));
    comprobar('lleva el teléfono en formato internacional', /TEL;TYPE=CELL,VOICE:\+34 620 591 728/.test(vcf));
    comprobar('los saltos de línea son CRLF', vcf.indexOf('\r\n') > 0 && !/[^\r]\n/.test(vcf));
    const largas = vcf.split('\r\n').filter((l) => Buffer.byteLength(l, 'utf8') > 75);
    comprobar('ninguna línea pasa de 75 octetos', largas.length === 0, largas.join(' | '));
  }

  fs.rmSync(temporal, { recursive: true, force: true });

  console.log('');
  if (fallos === 0) {
    console.log('TODO BIEN — ' + pruebas + ' comprobaciones en navegador, ninguna falla.');
    return 0;
  }
  console.error('HAY FALLOS — ' + fallos + ' de ' + pruebas + '.');
  return 1;
}

process.exit(principal());
