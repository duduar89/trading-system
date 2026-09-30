'use strict';
// Un .zip mínimo (deflate, nombres en UTF-8) sin dependencias, para subir la web a public_html con
// «Cargar» y «Extraer» del cPanel. Determinista: misma carpeta, mismos bytes (fecha fija y orden
// alfabético). Incluye los archivos ocultos (el .htaccess).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function archivosDe(carpeta, excluir = []) {
  const salida = [];
  const recorrer = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const ruta = path.join(dir, f.name);
      const rel = path.relative(carpeta, ruta).split(path.sep).join('/');
      if (excluir.includes(rel)) continue;
      if (f.isDirectory()) recorrer(ruta);
      else if (f.isFile()) salida.push(rel);
    }
  };
  recorrer(carpeta);
  return salida;
}

// Fecha y hora de MS-DOS (la del día de la web, a medianoche).
function fechaDos(iso) {
  const [a, m, d] = (iso || '2026-01-01').split('-').map(Number);
  return { fecha: ((a - 1980) << 9) | (m << 5) | d, hora: 0 };
}

function crearZip(carpeta, destino, { excluir = [], fecha = null } = {}) {
  const { fecha: dia, hora } = fechaDos(fecha);
  const locales = [];
  const central = [];
  let desplazamiento = 0;
  const nombres = archivosDe(carpeta, excluir);
  for (const nombre of nombres) {
    const datos = fs.readFileSync(path.join(carpeta, nombre));
    const comprimido = zlib.deflateRawSync(datos, { level: 9 });
    const guardar = comprimido.length >= datos.length; // si no gana nada, sin comprimir
    const cuerpo = guardar ? datos : comprimido;
    const metodo = guardar ? 0 : 8;
    const crc = zlib.crc32(datos) >>> 0;
    const n = Buffer.from(nombre, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, n, cuerpo);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0x0314, 4); // hecho en Unix, versión 2.0: guarda los permisos
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(metodo, 10);
    c.writeUInt16LE(hora, 12);
    c.writeUInt16LE(dia, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(cuerpo.length, 20);
    c.writeUInt32LE(datos.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // archivo normal, rw-r--r--
    c.writeUInt32LE(desplazamiento, 42);
    central.push(c, n);
    desplazamiento += local.length + n.length + cuerpo.length;
  }
  const tamCentral = central.reduce((t, b) => t + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(nombres.length, 8);
  fin.writeUInt16LE(nombres.length, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  fs.mkdirSync(path.dirname(path.resolve(destino)), { recursive: true });
  fs.writeFileSync(destino, Buffer.concat([...locales, ...central, fin]));
  return { archivos: nombres.length, bytes: desplazamiento + tamCentral + fin.length };
}

// Lee un .zip de los que escribe crearZip (para las pruebas y para comprobar la entrega).
function leerZip(archivo) {
  const buf = fs.readFileSync(archivo);
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) throw new Error('No es un zip');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const salida = new Map();
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Directorio central roto');
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tam = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const coment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + nLen).toString('utf8');
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const cuerpo = buf.subarray(inicio, inicio + tam);
    const datos = metodo === 8 ? zlib.inflateRawSync(cuerpo) : Buffer.from(cuerpo);
    if ((zlib.crc32(datos) >>> 0) !== crc) throw new Error(`CRC distinto en ${nombre}`);
    salida.set(nombre, datos);
    p += 46 + nLen + extra + coment;
  }
  return salida;
}

module.exports = { crearZip, leerZip, archivosDe };
