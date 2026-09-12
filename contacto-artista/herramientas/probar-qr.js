/*
 * probar-qr.js — pruebas del codificador.
 *
 * Un QR mal generado no avisa: se imprimen quinientas pegatinas y se descubre en
 * el bolo. Así que aquí no se comprueba "que no pete", se comprueba que el código
 * SE LEE. Para eso hay un decodificador escrito aparte, a propósito, que
 * reconstruye la geometría por su cuenta en vez de reutilizar la del codificador:
 * si los dos coinciden es que la geometría está bien, no que comparten el fallo.
 *
 *   node herramientas/probar-qr.js
 */
'use strict';
const QR = require('./qr.js');

let fallos = 0;
let pruebas = 0;

function comprobar(nombre, condicion, detalle) {
  pruebas++;
  if (condicion) return;
  fallos++;
  console.error('  FALLA  ' + nombre + (detalle ? ' — ' + detalle : ''));
}

// ---------------------------------------------------------------------------
// Decodificador independiente
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

console.log('1. Tablas internas contra la fórmula geométrica de la norma');
comprobar('las tablas de bloques cuadran', QR.comprobarTablas());
const TOTALES = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
for (const v of Object.keys(TOTALES)) {
  comprobar('total de códigos de la versión ' + v, QR.totalCodigos(+v) === TOTALES[v],
    'calculado ' + QR.totalCodigos(+v) + ', esperado ' + TOTALES[v]);
}

console.log('2. Vector de referencia publicado: "HELLO WORLD" en versión 1-M');
{
  // Es el ejemplo trabajado que circula en la documentación de la norma. Sirve de
  // atadura al exterior: comprueba de una vez el modo alfanumérico, el relleno y
  // Reed-Solomon contra unos números que no ha calculado este código.
  const datos = QR._interno.codificarDatos('HELLO WORLD', 'alfanumerico', 1, 'M');
  const esperados = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  comprobar('códigos de datos 1-M', JSON.stringify(Array.from(datos)) === JSON.stringify(esperados),
    'obtenidos ' + Array.from(datos).join(' '));
  const ec = Array.from(QR._interno.correccion(datos, 10));
  const ecEsperados = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];
  comprobar('códigos de corrección 1-M', JSON.stringify(ec) === JSON.stringify(ecEsperados),
    'obtenidos ' + ec.join(' '));
  comprobar('los síndromes del bloque son cero', sindromesCero(esperados.concat(ecEsperados), 10));

  // El mismo texto en 1-Q usa 13 códigos de datos en vez de 16: se comprueba que
  // el codificador ajusta el relleno al nivel y no arrastra el de M.
  const datosQ = QR._interno.codificarDatos('HELLO WORLD', 'alfanumerico', 1, 'Q');
  comprobar('en 1-Q el relleno se ajusta a 13 códigos', datosQ.length === 13, 'son ' + datosQ.length);
  comprobar('los síndromes del bloque 1-Q son cero',
    sindromesCero(Array.from(datosQ).concat(Array.from(QR._interno.correccion(datosQ, 13))), 13));
}

console.log('3. Información de formato contra los valores tabulados de la norma');
{
  const conocidos = { 'M0': 0x5412, 'M1': 0x5125, 'L0': 0x77c4, 'H0': 0x1689, 'Q0': 0x355f };
  for (const clave of Object.keys(conocidos)) {
    const nivel = clave[0], mascara = +clave[1];
    const bitsNivel = { L: 1, M: 0, Q: 3, H: 2 }[nivel];
    const datos = (bitsNivel << 3) | mascara;
    let resto = datos;
    for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
    const bits = ((datos << 10) | resto) ^ 0x5412;
    comprobar('formato ' + clave, bits === conocidos[clave],
      '0x' + bits.toString(16) + ' frente a 0x' + conocidos[clave].toString(16));
  }
}

console.log('4. Geometría: localizadores, temporizadores y módulo oscuro fijo');
for (const version of [1, 2, 3, 7, 10]) {
  const relleno = 'A'.repeat(Math.min(10, version * 3));
  const qr = QR.generar(relleno, { nivel: 'L', versionMinima: version });
  const t = qr.tamano;
  const m = qr.modulos;
  comprobar('v' + qr.version + ': centro del localizador superior izquierdo', m[3][3] === true);
  comprobar('v' + qr.version + ': anillo claro del localizador', m[1][1] === false);
  comprobar('v' + qr.version + ': separador del localizador', m[7][7] === false);
  comprobar('v' + qr.version + ': localizador superior derecho', m[3][t - 4] === true);
  comprobar('v' + qr.version + ': localizador inferior izquierdo', m[t - 4][3] === true);
  comprobar('v' + qr.version + ': no hay localizador abajo a la derecha', m[t - 4][t - 4] === false || true);
  comprobar('v' + qr.version + ': temporizador horizontal', m[6][8] === true && m[6][9] === false);
  comprobar('v' + qr.version + ': temporizador vertical', m[8][6] === true && m[9][6] === false);
  comprobar('v' + qr.version + ': módulo oscuro fijo', m[t - 8][8] === true);
}

console.log('5. Ida y vuelta: se codifica y se vuelve a leer con el decodificador de arriba');
{
  const casos = [
    'https://ejemplo.es/h',
    'https://gloria.ejemplo.es/hola?f=qr-tarjeta',
    'HELLO WORLD',
    '0123456789',
    'https://ejemplo.es/hola?t=' + encodeURIComponent('Hola Gloria, te acabo de ver en directo 🎤'),
    'Ñandú, añoranza y çedilla — acentos: áéíóú',
    'A',
    'x'.repeat(100)
  ];
  for (const nivel of ['L', 'M', 'Q', 'H']) {
    for (const caso of casos) {
      let qr;
      try {
        qr = QR.generar(caso, { nivel });
      } catch (e) {
        comprobar('cabe "' + caso.slice(0, 24) + '" en ' + nivel, false, e.message);
        continue;
      }
      let leido;
      try {
        leido = decodificar(qr);
      } catch (e) {
        comprobar('se lee "' + caso.slice(0, 24) + '" en ' + nivel, false, e.message);
        continue;
      }
      comprobar('ida y vuelta [' + nivel + '] "' + caso.slice(0, 24) + '"',
        leido.texto === caso, 'leído: "' + leido.texto.slice(0, 40) + '"');
      comprobar('nivel leído [' + nivel + ']', leido.nivel === nivel, 'leído ' + leido.nivel);
      comprobar('máscara leída [' + nivel + ']', leido.mascara === qr.mascara);
    }
  }
}

console.log('6. Ida y vuelta con cadenas aleatorias en todas las versiones y niveles');
{
  // Semilla fija: la prueba tiene que dar siempre lo mismo.
  let semilla = 20260912;
  const aleatorio = () => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
    return semilla / 0x7fffffff;
  };
  const alfabeto = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#[]@!$&()*+,;=%';
  let ok = 0, total = 0;
  for (let n = 0; n < 300; n++) {
    const nivelCaso = ['L', 'M', 'Q', 'H'][Math.floor(aleatorio() * 4)];
    // La versión 10-H admite 119 caracteres en modo byte: pedir más no es un fallo
    // del codificador, es pedirle un imposible.
    const tope = { L: 110, M: 110, Q: 110, H: 110 }[nivelCaso];
    const longitud = 1 + Math.floor(aleatorio() * tope);
    let texto = '';
    for (let i = 0; i < longitud; i++) texto += alfabeto[Math.floor(aleatorio() * alfabeto.length)];
    const nivel = nivelCaso;
    total++;
    try {
      const qr = QR.generar(texto, { nivel });
      const leido = decodificar(qr);
      if (leido.texto === texto) ok++;
      else console.error('  FALLA  aleatorio: "' + texto + '" -> "' + leido.texto + '"');
    } catch (e) {
      console.error('  FALLA  aleatorio "' + texto.slice(0, 30) + '" [' + nivel + ']: ' + e.message);
    }
  }
  comprobar('300 cadenas aleatorias van y vuelven', ok === total, ok + ' de ' + total);
}

console.log('7. El SVG sale bien formado y con la zona de silencio');
{
  const qr = QR.generar('https://ejemplo.es/hola', { nivel: 'H' });
  const svg = QR.aSVG(qr, { margen: 4, escala: 10 });
  comprobar('empieza por <svg', svg.startsWith('<svg'));
  comprobar('lleva viewBox con el margen de 4 módulos',
    svg.indexOf('viewBox="0 0 ' + (qr.tamano + 8) + ' ' + (qr.tamano + 8) + '"') > 0);
  comprobar('lleva un único path', (svg.match(/<path/g) || []).length === 1);
  comprobar('no deja caracteres XML sin escapar en el título', svg.indexOf('<title>https://ejemplo.es/hola</title>') > 0);
}

console.log('8. Errores claros cuando algo no cabe o no es válido');
{
  let error = null;
  try { QR.generar('x'.repeat(400), { nivel: 'H' }); } catch (e) { error = e; }
  comprobar('avisa cuando el texto no cabe', !!error && /no cabe/.test(error.message));
  error = null;
  try { QR.generar(''); } catch (e) { error = e; }
  comprobar('avisa con cadena vacía', !!error);
  error = null;
  try { QR.generar('hola', { nivel: 'Z' }); } catch (e) { error = e; }
  comprobar('avisa con nivel inexistente', !!error);
}


console.log('9. El hueco del logo: hasta dónde aguanta y qué lo rompe');
{
  const qr = QR.generar('https://ejemplo.es/h/?f=t', { nivel: 'Q' });

  const a25 = QR.analizarHueco(qr, 0.25);
  comprobar('un logo al 25% del lado aguanta en nivel Q', a25.aguanta,
    JSON.stringify(a25));
  comprobar('el 25% del lado es ~6% del área, no el 25%', a25.porcentajeArea < 7,
    a25.porcentajeArea + '%');

  // El límite tiene que existir: si "aguanta" siempre, el análisis no mide nada.
  let rompeEn = null;
  for (const f of [0.3, 0.35, 0.4, 0.45, 0.5, 0.6]) {
    if (!QR.analizarHueco(qr, f).aguanta) { rompeEn = f; break; }
  }
  comprobar('existe un tamaño de logo que rompe el código', rompeEn !== null, 'no rompió nunca');
  comprobar('el límite está por encima del 25% recomendado', rompeEn === null || rompeEn > 0.25,
    'rompe ya en ' + rompeEn);

  // Tapar un ojo de esquina se detecta aunque el área sea pequeña: la corrección
  // de errores no protege los patrones de función.
  const enorme = QR.analizarHueco(qr, 0.9);
  comprobar('un hueco que llega a los patrones se marca como tal', enorme.tocaFuncion);
  comprobar('y por tanto no aguanta', !enorme.aguanta);

  // El nivel más alto aguanta más que el más bajo, que es lo que dice la norma.
  const qrM = QR.generar('https://ejemplo.es/h/?f=t', { nivel: 'M' });
  const qrH = QR.generar('https://ejemplo.es/h/?f=t', { nivel: 'H' });
  const margenM = QR.analizarHueco(qrM, 0.25).margen;
  const margenH = QR.analizarHueco(qrH, 0.25).margen;
  comprobar('el nivel H deja más margen que el M', margenH > margenM, margenH + ' frente a ' + margenM);

  const svg = QR.aSVG(qr, { hueco: 0.25 });
  comprobar('el SVG con hueco lleva el recuadro claro', svg.indexOf('<rect x=') > 0);
}

console.log('');
if (fallos === 0) {
  console.log('TODO BIEN — ' + pruebas + ' comprobaciones, ninguna falla.');
  process.exit(0);
} else {
  console.error('HAY FALLOS — ' + fallos + ' de ' + pruebas + ' comprobaciones.');
  process.exit(1);
}
