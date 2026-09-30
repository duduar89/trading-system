'use strict';
// CSV sin dependencias, para las exportaciones de otros programas (Flowww, Excel): separador «;», «,»
// o tabulador (se adivina, o lo dice una primera línea «sep=;» de Excel), campos entre comillas con
// "" dentro y saltos de línea dentro de un campo, y la codificación que venga: UTF-8 con o sin BOM,
// UTF-16 (el «texto Unicode» de Excel) o Windows-1252 (el CSV de Excel en español). Cada fila lleva
// el número que se ve en la hoja de cálculo (la cabecera es la 1) para poder decir «fila 12».

class ErrorCsv extends Error {}

const SEPARADORES = [';', ',', '\t'];

// Bytes → texto. Sin BOM, lo que no es UTF-8 válido se lee como Windows-1252.
function decodificar(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { texto: bytes.subarray(3).toString('utf8'), codificacion: 'UTF-8 con BOM' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { texto: new TextDecoder('utf-16le').decode(bytes.subarray(2)), codificacion: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { texto: new TextDecoder('utf-16be').decode(bytes.subarray(2)), codificacion: 'UTF-16' };
  try {
    return { texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes), codificacion: 'UTF-8' };
  } catch {
    return { texto: new TextDecoder('windows-1252').decode(bytes), codificacion: 'Windows-1252' };
  }
}

// Registros del texto con ese separador: [{ linea, campos }], con la línea del fichero donde empieza
// cada uno. `abierta`: la línea de unas comillas que no se cierran nunca (fichero cortado o mal hecho).
function partir(texto, sep) {
  const registros = [];
  let campos = [];
  let campo = '';
  let comillas = false;
  let linea = 1;
  let desde = 1;
  let abierta = null;
  const cerrarCampo = () => { campos.push(campo.trim()); campo = ''; };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && texto[i + 1] === '\n') i++;
        campo += '\n';
        linea++;
      } else campo += c;
      continue;
    }
    // Las comillas solo abren al principio del campo; en medio («15" de pantalla») son texto.
    if (c === '"' && !campo.trim()) { comillas = true; campo = ''; abierta = linea; continue; }
    if (c === sep) { cerrarCampo(); continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      cerrarCampo();
      registros.push({ linea: desde, campos });
      campos = [];
      linea++;
      desde = linea;
      continue;
    }
    campo += c;
  }
  if (comillas) return { registros, abierta };
  if (campo || campos.length) { cerrarCampo(); registros.push({ linea: desde, campos }); }
  return { registros, abierta: null };
}

// El separador con el que la cabecera tiene más de una columna y las filas, las mismas que ella.
function adivinarSeparador(texto) {
  const muestra = texto.slice(0, 200000);
  let mejor = null;
  for (const sep of SEPARADORES) {
    const utiles = partir(muestra, sep).registros.filter((r) => r.campos.some(Boolean)).slice(0, 50);
    const n = utiles[0]?.campos.length || 0;
    if (n < 2) continue;
    const iguales = utiles.filter((r) => r.campos.length === n).length / utiles.length;
    if (!mejor || iguales > mejor.iguales || (iguales === mejor.iguales && n > mejor.n)) mejor = { sep, iguales, n };
  }
  return mejor ? mejor.sep : ';';
}

// Cabeceras vacías → «Columna 3»; repetidas → «Teléfono (2)».
function nombresUnicos(cabeceras) {
  const vistos = new Map();
  return cabeceras.map((c, i) => {
    const base = c || `Columna ${i + 1}`;
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/**
 * Lee un CSV (Buffer con los bytes del fichero, o texto).
 * @returns {{ cabeceras: string[], filas: { fila, linea, valores, sobran }[], separador, codificacion }}
 *   fila: el número de fila en la hoja de cálculo; valores: { cabecera: texto }; sobran: la fila trae
 *   más columnas que la cabecera (lo que sobra no se lee)
 */
function leerCsv(entrada) {
  const { texto, codificacion } = Buffer.isBuffer(entrada) ? decodificar(entrada) : { texto: String(entrada).replace(/^\uFEFF/, ''), codificacion: 'UTF-8' };
  let cuerpo = texto;
  let separador = null;
  const pista = /^sep=([;,\t|])[ \t]*(?:\r\n|\n|\r)/i.exec(cuerpo);
  if (pista) { separador = pista[1]; cuerpo = cuerpo.slice(pista[0].length); }
  separador ||= adivinarSeparador(cuerpo);
  const { registros, abierta } = partir(cuerpo, separador);
  if (abierta) throw new ErrorCsv(`Hay unas comillas sin cerrar desde la línea ${abierta + (pista ? 1 : 0)}: el fichero está cortado o mal exportado`);
  const primera = registros.findIndex((r) => r.campos.some(Boolean));
  if (primera < 0) throw new ErrorCsv('El fichero está vacío');
  const cabeceras = nombresUnicos(registros[primera].campos);
  const filas = [];
  for (let i = primera + 1; i < registros.length; i++) {
    const r = registros[i];
    if (!r.campos.some(Boolean)) continue;
    filas.push({
      fila: i + 1,
      linea: r.linea + (pista ? 1 : 0),
      valores: Object.fromEntries(cabeceras.map((c, k) => [c, r.campos[k] ?? ''])),
      sobran: r.campos.slice(cabeceras.length).some(Boolean),
    });
  }
  return { cabeceras, filas, separador, codificacion };
}

module.exports = { leerCsv, decodificar, partir, adivinarSeparador, ErrorCsv };
