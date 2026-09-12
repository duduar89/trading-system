/*
 * leer-qr.js — decodificador de códigos QR, escrito aparte a propósito.
 *
 * No comparte una sola línea con el codificador de qr.js: reconstruye la
 * geometría por su cuenta. Eso es lo que le da valor. Si los dos coinciden es
 * que la geometría está bien; si compartieran el código, compartirían el fallo.
 *
 * Se usa en dos sitios:
 *   · herramientas/probar-qr.js — las pruebas del codificador.
 *   · herramientas/construir.js — cada QR que se genera se vuelve a leer antes
 *     de escribirlo en disco. Un fichero que va a la imprenta sale de aquí
 *     habiendo sido leído, no solo dibujado.
 *
 * No corrige errores: exige que los síndromes Reed-Solomon sean cero, es decir,
 * que el símbolo esté intacto. Para saber cuánto daño aguanta (un logo encima),
 * eso lo calcula QR.analizarHueco en qr.js.
 */
'use strict';

const ALFANUMERICO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const BLOQUES = {
  1:  { L: [7, 1, 19, 0, 0],   M: [10, 1, 16, 0, 0],  Q: [13, 1, 13, 0, 0],  H: [17, 1, 9, 0, 0] },
  2:  { L: [10, 1, 34, 0, 0],  M: [16, 1, 28, 0, 0],  Q: [22, 1, 22, 0, 0],  H: [28, 1, 16, 0, 0] },
  3:  { L: [15, 1, 55, 0, 0],  M: [26, 1, 44, 0, 0],  Q: [18, 2, 17, 0, 0],  H: [22, 2, 13, 0, 0] },
  4:  { L: [20, 1, 80, 0, 0],  M: [18, 2, 32, 0, 0],  Q: [26, 2, 24, 0, 0],  H: [16, 4, 9, 0, 0] },
  5:  { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0],  Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6:  { L: [18, 2, 68, 0, 0],  M: [16, 4, 27, 0, 0],  Q: [24, 4, 19, 0, 0],  H: [28, 4, 15, 0, 0] },
  7:  { L: [20, 2, 78, 0, 0],  M: [18, 4, 31, 0, 0],  Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8:  { L: [24, 2, 97, 0, 0],  M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9:  { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] }
};
const ALINEACION = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};
const NIVEL_POR_BITS = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };

// Mapa de módulos de función, reconstruido desde cero.
function mapaFuncion(version) {
  const t = 17 + 4 * version;
  const f = Array.from({ length: t }, () => new Array(t).fill(false));
  const marcar = (x, y) => { if (x >= 0 && y >= 0 && x < t && y < t) f[y][x] = true; };

  // Localizadores con su separador: cuadrados de 8x8 en tres esquinas.
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      marcar(i, j);
      marcar(t - 1 - i, j);
      marcar(i, t - 1 - j);
    }
  }
  // Temporizadores.
  for (let i = 0; i < t; i++) { marcar(i, 6); marcar(6, i); }
  // Alineación.
  const centros = ALINEACION[version];
  for (const cy of centros) {
    for (const cx of centros) {
      const enEsquina =
        (cx <= 8 && cy <= 8) || (cx <= 8 && cy >= t - 9) || (cx >= t - 9 && cy <= 8);
      if (enEsquina) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) marcar(cx + dx, cy + dy);
    }
  }
  // Formato.
  for (let i = 0; i < 9; i++) { marcar(8, i); marcar(i, 8); }
  for (let i = 0; i < 8; i++) { marcar(8, t - 1 - i); marcar(t - 1 - i, 8); }
  // Versión.
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { marcar(t - 11 + j, i); marcar(i, t - 11 + j); }
  }
  return f;
}

function mascaraAplica(n, x, y) {
  switch (n) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function leerFormato(m, t) {
  // Primera copia, bits 0..14.
  const leidos = [];
  for (let i = 0; i <= 5; i++) leidos.push(m[i][8]);
  leidos.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) leidos.push(m[8][14 - i]);
  let valor = 0;
  for (let i = 0; i < 15; i++) if (leidos[i]) valor |= 1 << i;

  // Se busca cuál de las 32 combinaciones válidas es. Si ninguna encaja
  // exactamente, el código está corrupto.
  for (let datos = 0; datos < 32; datos++) {
    let resto = datos;
    for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
    const bits = ((datos << 10) | resto) ^ 0x5412;
    if (bits === valor) {
      return { nivel: NIVEL_POR_BITS[datos >> 3], mascara: datos & 7, bits: bits };
    }
  }
  return null;
}

function leerCodigos(m, t, funcion, mascara) {
  const bits = [];
  for (let derecha = t - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let vertical = 0; vertical < t; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = derecha - j;
        const subiendo = ((derecha + 1) & 2) === 0;
        const y = subiendo ? t - 1 - vertical : vertical;
        if (funcion[y][x]) continue;
        let bit = m[y][x];
        if (mascaraAplica(mascara, x, y)) bit = !bit;
        bits.push(bit ? 1 : 0);
      }
    }
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    bytes.push(b);
  }
  return bytes;
}

// Aritmética propia del decodificador, para no depender de las tablas del codificador.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// Síndromes: si el bloque está bien formado, todos valen cero.
function sindromesCero(bloque, longitudEC) {
  for (let i = 0; i < longitudEC; i++) {
    let s = 0;
    for (let j = 0; j < bloque.length; j++) s = mul(s, EXP[i]) ^ bloque[j];
    if (s !== 0) return false;
  }
  return true;
}

function desintercalar(codigos, version, nivel) {
  const [ec, b1, d1, b2, d2] = BLOQUES[version][nivel];
  const totalBloques = b1 + b2;
  const tamanos = [];
  for (let i = 0; i < b1; i++) tamanos.push(d1);
  for (let i = 0; i < b2; i++) tamanos.push(d2);

  const bloques = tamanos.map(() => []);
  let p = 0;
  const maxDatos = Math.max(d1, d2 || 0);
  for (let i = 0; i < maxDatos; i++) {
    for (let j = 0; j < totalBloques; j++) {
      if (i < tamanos[j]) bloques[j].push(codigos[p++]);
    }
  }
  const ecs = tamanos.map(() => []);
  for (let i = 0; i < ec; i++) {
    for (let j = 0; j < totalBloques; j++) ecs[j].push(codigos[p++]);
  }
  return { bloques, ecs, ec };
}

function decodificarDatos(bytes, version) {
  let pos = 0;
  const leerBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = bytes[pos >> 3];
      const bit = (byte >> (7 - (pos & 7))) & 1;
      v = (v << 1) | bit;
      pos++;
    }
    return v;
  };
  const modo = leerBits(4);
  const pequena = version <= 9;
  let salida = '';
  if (modo === 4) {
    const n = leerBits(pequena ? 8 : 16);
    const crudos = [];
    for (let i = 0; i < n; i++) crudos.push(leerBits(8));
    salida = Buffer.from(crudos).toString('utf8');
  } else if (modo === 2) {
    const n = leerBits(pequena ? 9 : 11);
    for (let i = 0; i < n; i += 2) {
      if (i + 1 < n) {
        const v = leerBits(11);
        salida += ALFANUMERICO[Math.floor(v / 45)] + ALFANUMERICO[v % 45];
      } else {
        salida += ALFANUMERICO[leerBits(6)];
      }
    }
  } else if (modo === 1) {
    const n = leerBits(pequena ? 10 : 12);
    let quedan = n;
    while (quedan >= 3) { salida += String(leerBits(10)).padStart(3, '0'); quedan -= 3; }
    if (quedan === 2) salida += String(leerBits(7)).padStart(2, '0');
    else if (quedan === 1) salida += String(leerBits(4));
  } else {
    throw new Error('Modo no soportado por el decodificador de prueba: ' + modo);
  }
  return salida;
}

function decodificar(qr) {
  const t = qr.tamano;
  const version = (t - 17) / 4;
  const formato = leerFormato(qr.modulos, t);
  if (!formato) throw new Error('información de formato ilegible');
  const funcion = mapaFuncion(version);
  const codigos = leerCodigos(qr.modulos, t, funcion, formato.mascara);
  const { bloques, ecs, ec } = desintercalar(codigos, version, formato.nivel);
  for (let i = 0; i < bloques.length; i++) {
    if (!sindromesCero(bloques[i].concat(ecs[i]), ec)) {
      throw new Error('los síndromes Reed-Solomon del bloque ' + i + ' no son cero');
    }
  }
  const datos = [].concat(...bloques);
  return { texto: decodificarDatos(datos, version), nivel: formato.nivel, mascara: formato.mascara, version };
}

module.exports = {
  decodificar: decodificar,
  sindromesCero: sindromesCero,
  mapaFuncion: mapaFuncion,
  leerFormato: leerFormato
};
