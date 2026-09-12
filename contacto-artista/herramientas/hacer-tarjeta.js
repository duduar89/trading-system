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

const ANCHO = 85;
const ALTO = 55;
const SANGRADO = 3;
const SEGURIDAD = 5;          // nada de texto más cerca del corte que esto
const LADO_QR = 25;
const MARGEN_QR_MODULOS = 4;

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// El QR como <svg> anidado: se escala solo al tamaño en milímetros que se le pida.
function qrAnidado(texto, x, y, lado, nivel) {
  const qr = QR.generar(texto, { nivel: nivel });
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
  return { svg: svg, qr: qr };
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
  const url = config.urlDeSoporte(soporte);
  const xQR = SEGURIDAD + 3;
  const yQR = (ALTO - LADO_QR) / 2;
  const { svg, qr } = qrAnidado(url, xQR, yQR, LADO_QR, config.opciones.nivelQR);
  const xTexto = xQR + LADO_QR + 6;
  // La URL impresa va SIN el parámetro: es la que alguien teclea a mano si no
  // puede escanear, y "?f=tarjeta" no se teclea. El código de soporte viaja
  // dentro del QR, que es donde hace falta.
  const urlVisible = (config.sitio + config.ruta).replace(/^https:\/\//, '').replace(/\/$/, '');

  const contenido =
    svg +
    '    <text x="' + xTexto + '" y="' + (yQR + 7) + '" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="4.6" font-weight="700" fill="#16151a">Te aviso yo</text>\n' +
    '    <text x="' + xTexto + '" y="' + (yQR + 12.5) + '" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="4.6" font-weight="700" fill="#16151a">del próximo bolo</text>\n' +
    '    <text x="' + xTexto + '" y="' + (yQR + 19) + '" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="2.9" fill="#645f6e">Apunta con la cámara.</text>\n' +
    '    <text x="' + xTexto + '" y="' + (yQR + 23) + '" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="2.9" fill="#645f6e">Se abre mi WhatsApp con</text>\n' +
    '    <text x="' + xTexto + '" y="' + (yQR + 27) + '" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="2.9" fill="#645f6e">el mensaje ya escrito.</text>\n' +
    '    <text x="' + (ANCHO / 2) + '" y="' + (ALTO - SEGURIDAD + 1) + '" text-anchor="middle" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="2.6" fill="#8a8492">' +
    escapar(urlVisible) + '</text>\n';

  return { contenido, qr, url };
}

function principal() {
  const config = require('../config.js');
  const carpeta = path.join(__dirname, '..', 'imprenta');
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

  const a = path.join(carpeta, 'tarjeta-cara-a.svg');
  fs.writeFileSync(a, lienzo(caraA(config), 'Tarjeta, cara A'), 'utf8');

  const { contenido, qr, url } = caraB(config, 'tarjeta');
  const b = path.join(carpeta, 'tarjeta-cara-b.svg');
  fs.writeFileSync(b, lienzo(contenido, 'Tarjeta, cara B'), 'utf8');

  const ladoModulo = LADO_QR / (qr.tamano + MARGEN_QR_MODULOS * 2);
  console.log('Generado:');
  console.log('  · imprenta/tarjeta-cara-a.svg');
  console.log('  · imprenta/tarjeta-cara-b.svg');
  console.log('');
  console.log('QR: ' + url);
  console.log('    versión ' + qr.version + ', ' + qr.tamano + '×' + qr.tamano + ' cuadros, nivel ' + qr.nivel);
  console.log('    cada cuadro mide ' + ladoModulo.toFixed(2) + ' mm impreso a ' + LADO_QR + ' mm');
  if (ladoModulo < 0.5) {
    console.log('');
    console.log('  AVISO: por debajo de 0,5 mm por cuadro la impresión comercial empieza a fallar.');
    console.log('  Acorta la URL (docs/05-qr-imprenta.md) o sube el QR a ' +
      Math.ceil((qr.tamano + 8) * 0.5) + ' mm.');
  }
}

if (require.main === module) principal();
module.exports = { caraA, caraB, lienzo };
