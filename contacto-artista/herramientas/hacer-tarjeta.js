/*
 * hacer-tarjeta.js — la tarjeta de visita, lista para la imprenta.
 *
 *     node herramientas/hacer-tarjeta.js
 *
 * Genera dos caras en SVG con medidas en milímetros de verdad (85 × 55 mm, que
 * es la tarjeta estándar en España, más 3 mm de sangrado por lado).
 *
 * Las medidas no son decorativas, salen de docs/05-qr-imprenta.md:
 *   · QR de 25 mm: se lee a distancia de brazo, que es como se coge una tarjeta.
 *   · Zona de silencio de 4 cuadros DENTRO del recuadro blanco del QR.
 *   · El QR a 8 mm del corte: la guillotina tiene 1-2 mm de tolerancia y si se
 *     come el margen blanco, el código deja de leerse.
 *   · Negro sobre blanco, nunca al revés.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const QR = require('./qr.js');
const { urlDe } = require('./urls.js');

const ANCHO = 85;
const ALTO = 55;
const SANGRADO = 3;
const SEGURIDAD = 5;          // nada de texto más cerca del corte que esto
const MARGEN_QR_MODULOS = 4;

// El QR no mide siempre lo mismo: mide lo que haga falta para que cada cuadro
// llegue a 0,6 mm impreso. Es la medida que decide si se lee, y depende de lo
// larga que sea la URL, que no se sabe hasta que se rellena config.js. Fijar
// 25 mm y olvidarse es justo cómo se imprimen quinientas tarjetas que no leen.
const MM_POR_CUADRO = 0.6;
const LADO_QR_MIN = 25;
const LADO_QR_MAX = 32;

function ladoQR(qr) {
  const necesario = MM_POR_CUADRO * (qr.tamano + MARGEN_QR_MODULOS * 2);
  return Math.min(LADO_QR_MAX, Math.max(LADO_QR_MIN, Math.ceil(necesario)));
}

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// El QR como <svg> anidado: se escala solo al tamaño en milímetros que se le pida.
function qrAnidado(qr, x, y, lado) {
  const total = qr.tamano + MARGEN_QR_MODULOS * 2;
  const trazo = [];
  for (let fila = 0; fila < qr.tamano; fila++) {
    for (let col = 0; col < qr.tamano; col++) {
      if (qr.modulos[fila][col]) {
        trazo.push('M' + (col + MARGEN_QR_MODULOS) + ',' + (fila + MARGEN_QR_MODULOS) + 'h1v1h-1z');
      }
    }
  }
  const svg =
    '  <svg x="' + x + '" y="' + y + '" width="' + lado + '" height="' + lado + '" ' +
    'viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">\n' +
    '    <rect width="100%" height="100%" fill="#ffffff"/>\n' +
    '    <path fill="#000000" d="' + trazo.join('') + '"/>\n' +
    '  </svg>\n';
  return svg;
}

function lienzo(contenido, nombre) {
  const w = ANCHO + SANGRADO * 2;
  const h = ALTO + SANGRADO * 2;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!-- ' + nombre + ' · ' + ANCHO + '×' + ALTO + ' mm con ' + SANGRADO + ' mm de sangrado.\n' +
    '     Negro 100% K, nunca negro rico CMYK: los cuatro canales desalinean y\n' +
    '     emborronan los bordes del código. Acabado MATE: el brillo y el barniz UV\n' +
    '     reflejan los focos de la sala justo encima del QR y lo borran para la cámara.\n' +
    '     TIPOGRAFIA: convertir los textos a curvas antes de mandarlo, o la imprenta\n' +
    '     sustituira la fuente y descuadrara la maqueta. El QR es un trazado, no una\n' +
    '     fuente, asi que no le afecta. -->\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + 'mm" height="' + h + 'mm" ' +
    'viewBox="0 0 ' + w + ' ' + h + '">\n' +
    '  <rect width="' + w + '" height="' + h + '" fill="#ffffff"/>\n' +
    '  <g transform="translate(' + SANGRADO + ',' + SANGRADO + ')">\n' +
    contenido +
    '  </g>\n' +
    '</svg>\n'
  );
}

function caraA(config) {
  const nombre = config.mensajes.titulo;
  const tamanoNombre = nombre.length > 16 ? 7 : nombre.length > 11 ? 9 : 11;
  return (
    '    <text x="' + (ANCHO / 2) + '" y="' + (ALTO / 2 - 2) + '" text-anchor="middle" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="' + tamanoNombre + '" font-weight="700" fill="#16151a">' +
    escapar(nombre) + '</text>\n' +
    '    <text x="' + (ANCHO / 2) + '" y="' + (ALTO / 2 + 6) + '" text-anchor="middle" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="3.4" fill="#645f6e">' +
    escapar(config.artista.actividad || '') + '</text>\n'
  );
}

function caraB(config, soporte) {
  const url = urlDe(config, soporte);
  const qr = QR.generar(url, { nivel: config.opciones.nivelQR });
  const lado = ladoQR(qr);
  const xQR = SEGURIDAD + 2;
  const yQR = (ALTO - lado) / 2;
  const svg = qrAnidado(qr, xQR, yQR, lado);
  const xTexto = xQR + lado + 5;

  // El texto se encoge si el QR ha crecido: una línea que se sale por el corte
  // es peor que una línea un punto más pequeña.
  const disponible = ANCHO - xTexto - SEGURIDAD;
  const titular = Math.min(4.6, disponible / ('del próximo bolo'.length * 0.55));
  const cuerpo = Math.min(2.9, titular * 0.63);

  // La URL impresa va SIN el parámetro: es la que alguien teclea a mano si no
  // puede escanear, y "?f=tarjeta" no se teclea. El código de soporte viaja
  // dentro del QR, que es donde hace falta.
  const urlVisible = (config.sitio + config.ruta).replace(/^https:\/\//, '').replace(/\/$/, '');

  const y0 = yQR + lado / 2 - 8;
  const texto = (x, y, tamano, peso, color, valor) =>
    '    <text x="' + x + '" y="' + y.toFixed(2) + '" font-family="Helvetica, Arial, sans-serif" ' +
    'font-size="' + tamano.toFixed(2) + '" font-weight="' + peso + '" fill="' + color + '">' +
    escapar(valor) + '</text>\n';

  const contenido =
    svg +
    texto(xTexto, y0 + titular, titular, 700, '#16151a', 'Te aviso yo') +
    texto(xTexto, y0 + titular * 2.2, titular, 700, '#16151a', 'del próximo bolo') +
    texto(xTexto, y0 + titular * 2.2 + cuerpo * 2.4, cuerpo, 400, '#645f6e', 'Apunta con la cámara.') +
    texto(xTexto, y0 + titular * 2.2 + cuerpo * 3.8, cuerpo, 400, '#645f6e', 'Se abre mi WhatsApp') +
    texto(xTexto, y0 + titular * 2.2 + cuerpo * 5.2, cuerpo, 400, '#645f6e', 'con el mensaje escrito.') +
    '    <text x="' + (ANCHO / 2) + '" y="' + (ALTO - SEGURIDAD + 1) + '" text-anchor="middle" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="2.6" fill="#8a8492">' +
    escapar(urlVisible) + '</text>\n';

  return { contenido, qr, url, lado };
}

function principal() {
  const config = require('../config.js');

  // Si se ejecuta esto suelto con la configuración a medias, saldría una tarjeta
  // con la palabra RELLENAR impresa y un QR que no lleva a ninguna parte. Y una
  // tarjeta se manda a imprimir sin volver a mirarla.
  const pendiente = JSON.stringify([config.sitio, config.mensajes.titulo, config.artista])
    .indexOf('RELLENAR') >= 0;
  if (pendiente) {
    console.error('config.js está a medias: falta rellenar el sitio, el nombre o los textos.');
    console.error('Rellénalo y ejecuta  node herramientas/construir.js,  que genera esto y todo lo demás.');
    process.exit(1);
  }
  const carpeta = path.join(__dirname, '..', 'imprenta');
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

  const a = path.join(carpeta, 'tarjeta-cara-a.svg');
  fs.writeFileSync(a, lienzo(caraA(config), 'Tarjeta, cara A'), 'utf8');

  const { contenido, qr, url, lado } = caraB(config, 'tarjeta');
  const b = path.join(carpeta, 'tarjeta-cara-b.svg');
  fs.writeFileSync(b, lienzo(contenido, 'Tarjeta, cara B'), 'utf8');

  const ladoModulo = lado / (qr.tamano + MARGEN_QR_MODULOS * 2);
  console.log('Generado:');
  console.log('  · imprenta/tarjeta-cara-a.svg');
  console.log('  · imprenta/tarjeta-cara-b.svg');
  console.log('');
  console.log('QR: ' + url);
  console.log('    versión ' + qr.version + ', ' + qr.tamano + '×' + qr.tamano + ' cuadros, nivel ' + qr.nivel);
  console.log('    impreso a ' + lado + ' mm, cada cuadro mide ' + ladoModulo.toFixed(2) + ' mm');
  if (ladoModulo < 0.5) {
    console.log('');
    console.log('  AVISO: ni al tamaño máximo que cabe en la tarjeta llega el cuadro a 0,5 mm.');
    console.log('  Hay que acortar la URL. Mira docs/05-qr-imprenta.md.');
  }
}

if (require.main === module) principal();
module.exports = { caraA, caraB, lienzo };
