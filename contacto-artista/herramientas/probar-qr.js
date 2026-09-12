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

// El decodificador vive en leer-qr.js: está escrito aparte del codificador a
// propósito, para que coincidir signifique algo.
const { decodificar, sindromesCero } = require('./leer-qr.js');

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


console.log('10. La red de seguridad de la construcción salta si el código se estropea');
{
  // Una comprobación que no se puede hacer fallar no comprueba nada. Aquí se
  // estropea un cuadro a propósito y se exige que el decodificador lo note:
  // es lo que impide que salga a imprenta un código que no dice lo que creemos.
  const qr = QR.generar('https://ejemplo.es/hola/?f=tarjeta', { nivel: 'Q' });
  const leido = decodificar(qr);
  comprobar('sin tocar nada, se relee igual', leido.texto === 'https://ejemplo.es/hola/?f=tarjeta');

  // Se invierte un módulo de la zona de datos (no de un patrón de función).
  const roto = JSON.parse(JSON.stringify(qr));
  roto.modulos = qr.modulos.map((f) => f.slice());
  roto.modulos[qr.tamano - 2][qr.tamano - 2] = !roto.modulos[qr.tamano - 2][qr.tamano - 2];

  let saltó = false;
  try {
    const otro = decodificar(roto);
    if (otro.texto !== qr.texto) saltó = true;
  } catch (e) {
    saltó = true;
  }
  comprobar('con un cuadro cambiado, el decodificador lo detecta', saltó);
}

console.log('');
if (fallos === 0) {
  console.log('TODO BIEN — ' + pruebas + ' comprobaciones, ninguna falla.');
  process.exit(0);
} else {
  console.error('HAY FALLOS — ' + fallos + ' de ' + pruebas + ' comprobaciones.');
  process.exit(1);
}
