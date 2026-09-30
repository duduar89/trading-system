'use strict';
// Iconos PNG de la PWA a partir del cubo isométrico del panel (el mismo del
// logotipo de web/index.html: viewBox 24, cara de arriba #60a5fa, izquierda
// #1d4ed8, derecha #1e3a8a) sobre el azul noche del panel (#0f1424).
// Sin dependencias: se rasteriza a mano con 4×4 muestras por píxel (bordes
// suaves) y se comprime con zlib. El resultado es determinista: los mismos
// bytes cada vez, y así una prueba comprueba que los versionados están al día.
//
//   node scripts/generar-iconos.js            (escribe web/iconos/*.png)
//   node scripts/generar-iconos.js --comprobar (sale con 1 si difieren)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FONDO = [0x0f, 0x14, 0x24];
// Caras en el orden en que se pintan (coordenadas del viewBox 24×24).
const CARAS = [
  { color: [0x1d, 0x4e, 0xd8], puntos: [[3, 7], [12, 12], [12, 22], [3, 17]] },     // izquierda
  { color: [0x1e, 0x3a, 0x8a], puntos: [[12, 12], [21, 7], [21, 17], [12, 22]] },   // derecha
  { color: [0x60, 0xa5, 0xfa], puntos: [[12, 2], [21, 7], [12, 12], [3, 7]] },      // arriba
];
const CENTRO = [12, 12];
const ALTO_CUBO = 20;   // de y=2 a y=22

// Iconos: nombre, lado en píxeles y qué parte del lado ocupa el cubo. El
// maskable deja el cubo dentro de la zona segura (círculo del 80 %): Android
// recorta el icono con la forma que quiera.
const ICONOS = [
  { nombre: 'icono-32.png', lado: 32, cubo: 0.84 },
  { nombre: 'apple-touch-icon.png', lado: 180, cubo: 0.66 },
  { nombre: 'icono-192.png', lado: 192, cubo: 0.72 },
  { nombre: 'icono-512.png', lado: 512, cubo: 0.72 },
  { nombre: 'icono-512-maskable.png', lado: 512, cubo: 0.56 },
];

function dentro(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function rasterizar(lado, fraccionCubo) {
  const escala = (lado * fraccionCubo) / ALTO_CUBO;
  const caras = CARAS.map(c => ({ color: c.color, puntos: c.puntos.map(([x, y]) => [lado / 2 + (x - CENTRO[0]) * escala, lado / 2 + (y - CENTRO[1]) * escala]) }));
  const M = 4;
  const px = Buffer.alloc(lado * lado * 3);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let r = 0; let g = 0; let b = 0;
      for (let sy = 0; sy < M; sy++) {
        for (let sx = 0; sx < M; sx++) {
          const u = x + (sx + 0.5) / M;
          const v = y + (sy + 0.5) / M;
          let col = FONDO;
          for (const c of caras) if (dentro(u, v, c.puntos)) col = c.color;
          r += col[0]; g += col[1]; b += col[2];
        }
      }
      const i = (y * lado + x) * 3;
      px[i] = Math.round(r / (M * M));
      px[i + 1] = Math.round(g / (M * M));
      px[i + 2] = Math.round(b / (M * M));
    }
  }
  return px;
}

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

// PNG RGB de 8 bits sin entrelazar.
function png(lado, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const filas = Buffer.alloc(lado * (lado * 3 + 1));
  for (let y = 0; y < lado; y++) {
    filas[y * (lado * 3 + 1)] = 0;   // sin filtro
    rgb.copy(filas, y * (lado * 3 + 1) + 1, y * lado * 3, (y + 1) * lado * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(filas, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

function generar() {
  return ICONOS.map(i => ({ ...i, bytes: png(i.lado, rasterizar(i.lado, i.cubo)) }));
}

const CARPETA = path.join(__dirname, '..', 'web', 'iconos');

function main() {
  const comprobar = process.argv.includes('--comprobar');
  let distintos = 0;
  if (!comprobar) fs.mkdirSync(CARPETA, { recursive: true });
  for (const i of generar()) {
    const ruta = path.join(CARPETA, i.nombre);
    if (comprobar) {
      let actual = null;
      try { actual = fs.readFileSync(ruta); } catch (_) { /* no existe */ }
      const igual = actual && actual.equals(i.bytes);
      if (!igual) distintos++;
      console.log(`${igual ? 'OK   ' : 'FALLO'} ${i.nombre} (${i.lado}×${i.lado})${igual ? '' : ': distinto del generado, ejecuta node scripts/generar-iconos.js'}`);
    } else {
      fs.writeFileSync(ruta, i.bytes);
      console.log(`${i.nombre}: ${i.lado}×${i.lado}, ${i.bytes.length} bytes`);
    }
  }
  if (distintos) process.exit(1);
}

if (require.main === module) main();

module.exports = { generar, png, crc32, rasterizar, ICONOS };
