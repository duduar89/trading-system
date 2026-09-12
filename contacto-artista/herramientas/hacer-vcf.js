/*
 * hacer-vcf.js — genera la tarjeta de contacto (.vcf) a partir de config.js.
 *
 *   node herramientas/hacer-vcf.js
 *
 * Por qué vCard 3.0 y no la 4.0, que es más moderna: la 3.0 la abren bien tanto
 * los iPhone como los Android viejos, y aquí el público es "quien sea que estuvo
 * en el bolo". La 4.0 se atasca en teléfonos que siguen circulando.
 *
 * Dos detalles que rompen el archivo si se hacen a mano y por eso los hace el
 * programa: los saltos de línea tienen que ser CRLF, y ninguna línea puede pasar
 * de 75 octetos sin plegarse. Un .vcf con líneas largas lo rechazan algunos
 * gestores de contactos sin decir por qué.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config.js');

function escapar(valor) {
  return String(valor == null ? '' : valor)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\;');
}

// Plegado según RFC 6350: se cuenta en octetos, no en caracteres, porque una
// tilde ocupa dos y el corte a mitad de carácter deja el archivo ilegible.
function plegar(linea) {
  const bytes = Buffer.from(linea, 'utf8');
  if (bytes.length <= 75) return linea;
  const trozos = [];
  let inicio = 0;
  let limite = 75;
  while (inicio < bytes.length) {
    let fin = Math.min(inicio + limite, bytes.length);
    // No cortar a mitad de un carácter multibyte.
    while (fin > inicio && fin < bytes.length && (bytes[fin] & 0xc0) === 0x80) fin--;
    trozos.push(bytes.slice(inicio, fin).toString('utf8'));
    inicio = fin;
    limite = 74; // las continuaciones llevan un espacio delante
  }
  return trozos.join('\r\n ');
}

function construir(c) {
  const a = c.artista;
  const lineas = [];
  const añadir = (l) => lineas.push(l);

  añadir('BEGIN:VCARD');
  añadir('VERSION:3.0');
  añadir('N:' + escapar(a.apellidos) + ';' + escapar(a.nombre) + ';;;');
  añadir('FN:' + escapar(a.nombreArtistico || (a.nombre + ' ' + a.apellidos).trim()));
  if (a.actividad) añadir('ORG:' + escapar(a.actividad));
  if (a.titulo) añadir('TITLE:' + escapar(a.titulo));
  añadir('TEL;TYPE=CELL,VOICE:' + c.telefono.internacional);
  if (a.email) añadir('EMAIL;TYPE=INTERNET,PREF:' + escapar(a.email));
  if (c.sitio) añadir('URL:' + c.sitio);

  // Los perfiles sociales con etiqueta propia: así en el iPhone aparecen con su
  // nombre ("Instagram") en vez de como una URL suelta.
  let n = 1;
  for (const red of c.redes || []) {
    if (!red.url) continue;
    añadir('item' + n + '.URL:' + red.url);
    añadir('item' + n + '.X-ABLabel:' + escapar(red.nombre));
    n++;
  }
  if (a.nota) añadir('NOTE:' + escapar(a.nota));
  añadir('END:VCARD');

  return lineas.map(plegar).join('\r\n') + '\r\n';
}

if (require.main === module) {
  const destino = path.join(__dirname, '..', 'web', config.ficheros.vcard);
  const contenido = construir(config);
  fs.writeFileSync(destino, contenido, 'utf8');
  const bytes = Buffer.byteLength(contenido, 'utf8');
  console.log('Escrito ' + path.relative(process.cwd(), destino) + ' (' + bytes + ' bytes)');
  console.log('');
  console.log(contenido.replace(/\r\n/g, '\n'));
}

module.exports = { construir, plegar, escapar };
