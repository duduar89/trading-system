/*
 * qr.js — codificador de códigos QR sin dependencias.
 *
 * Por qué existe: el sistema tiene que poder regenerar sus QR en cualquier
 * momento (cambia el dominio, cambia la campaña, se reimprime) sin depender de
 * una web de terceros que mañana puede caerse, meter publicidad en el código o
 * cobrar por él. Un QR generado en una web ajena es un enlace que controla otro.
 *
 * Funciona igual en Node y en el navegador:
 *   Node:       const QR = require('./qr.js')
 *   Navegador:  <script src="qr.js"></script>  -> window.QR
 *
 * Soporta versiones 1 a 10 (hasta 274 bytes), niveles L/M/Q/H y los modos
 * numérico, alfanumérico y byte (UTF-8). De sobra para una URL corta, que es
 * justo lo que hay que meter en un QR impreso.
 *
 * Referencia: ISO/IEC 18004. La tabla de bloques se comprueba sola contra la
 * fórmula geométrica de módulos de datos (ver comprobarTablas), así que un error
 * de transcripción salta al cargar el fichero, no en la imprenta.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.QR = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- GF(256)
  // Aritmética del campo de Galois que usa Reed-Solomon, polinomio 0x11D.
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // Polinomio generador de grado n: producto de (x - alfa^i), i = 0..n-1.
  function polinomioGenerador(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1);
      for (var k = 0; k < ng.length; k++) ng[k] = 0;
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  }

  // Resto de la división: los códigos de corrección de errores del bloque.
  function correccion(datos, longitudEC) {
    var g = polinomioGenerador(longitudEC);
    var resto = new Uint8Array(longitudEC);
    for (var d = 0; d < datos.length; d++) {
      var factor = datos[d] ^ resto[0];
      resto.copyWithin(0, 1);
      resto[longitudEC - 1] = 0;
      if (factor !== 0) {
        for (var i = 0; i < longitudEC; i++) resto[i] ^= mul(g[i + 1], factor);
      }
    }
    return resto;
  }

  // ------------------------------------------------------------ tablas v1-10
  // [códigos EC por bloque, bloques grupo 1, datos grupo 1, bloques grupo 2, datos grupo 2]
  var NIVELES = { L: 0, M: 1, Q: 2, H: 3 };
  var BLOQUES = {
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
  var VERSION_MAX = 10;

  // Centros de los patrones de alineación por versión.
  var ALINEACION = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  // Módulos de datos en bruto de una versión, por geometría (ISO/IEC 18004).
  // Sirve de comprobación independiente de la tabla BLOQUES.
  function modulosDeDatos(version) {
    var r = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var n = Math.floor(version / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (version >= 7) r -= 36;
    }
    return r;
  }

  function totalCodigos(version) {
    return Math.floor(modulosDeDatos(version) / 8);
  }

  function comprobarTablas() {
    for (var v = 1; v <= VERSION_MAX; v++) {
      for (var nivel in NIVELES) {
        var b = BLOQUES[v][nivel];
        var suma = b[1] * (b[2] + b[0]) + b[3] * (b[4] + b[0]);
        if (suma !== totalCodigos(v)) {
          throw new Error(
            'Tabla de bloques incorrecta en versión ' + v + ' nivel ' + nivel +
            ': suma ' + suma + ', deberían ser ' + totalCodigos(v)
          );
        }
      }
    }
    return true;
  }
  comprobarTablas();

  function datosDisponibles(version, nivel) {
    var b = BLOQUES[version][nivel];
    return b[1] * b[2] + b[3] * b[4];
  }

  // ------------------------------------------------------------------ modos
  var ALFANUMERICO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function esNumerico(texto) {
    return /^[0-9]*$/.test(texto);
  }

  function esAlfanumerico(texto) {
    for (var i = 0; i < texto.length; i++) {
      if (ALFANUMERICO.indexOf(texto.charAt(i)) < 0) return false;
    }
    return true;
  }

  function aBytesUTF8(texto) {
    var salida = [];
    for (var i = 0; i < texto.length; i++) {
      var c = texto.charCodeAt(i);
      if (c < 0x80) salida.push(c);
      else if (c < 0x800) {
        salida.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < texto.length) {
        var c2 = texto.charCodeAt(++i);
        var p = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        salida.push(0xf0 | (p >> 18), 0x80 | ((p >> 12) & 63), 0x80 | ((p >> 6) & 63), 0x80 | (p & 63));
      } else {
        salida.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return salida;
  }

  // Bits del indicador de número de caracteres: cambia a partir de la versión 10.
  function bitsCuenta(modo, version) {
    var pequena = version <= 9;
    if (modo === 'numerico') return pequena ? 10 : 12;
    if (modo === 'alfanumerico') return pequena ? 9 : 11;
    return pequena ? 8 : 16;
  }

  function indicadorModo(modo) {
    if (modo === 'numerico') return 1;
    if (modo === 'alfanumerico') return 2;
    return 4;
  }

  function elegirModo(texto) {
    if (esNumerico(texto)) return 'numerico';
    if (esAlfanumerico(texto)) return 'alfanumerico';
    return 'byte';
  }

  function bitsNecesarios(texto, modo, version) {
    var cabecera = 4 + bitsCuenta(modo, version);
    if (modo === 'numerico') {
      var n = texto.length;
      return cabecera + 10 * Math.floor(n / 3) + (n % 3 === 1 ? 4 : n % 3 === 2 ? 7 : 0);
    }
    if (modo === 'alfanumerico') {
      var m = texto.length;
      return cabecera + 11 * Math.floor(m / 2) + (m % 2 ? 6 : 0);
    }
    return cabecera + 8 * aBytesUTF8(texto).length;
  }

  // ------------------------------------------------------------ flujo de bits
  function Bits() {
    this.bits = [];
  }
  Bits.prototype.push = function (valor, longitud) {
    for (var i = longitud - 1; i >= 0; i--) this.bits.push((valor >>> i) & 1);
  };
  Bits.prototype.aBytes = function () {
    var bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    for (var i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) bytes[i >>> 3] |= 0x80 >>> (i & 7);
    }
    return bytes;
  };

  function codificarDatos(texto, modo, version, nivel) {
    var bits = new Bits();
    bits.push(indicadorModo(modo), 4);

    if (modo === 'numerico') {
      bits.push(texto.length, bitsCuenta(modo, version));
      for (var i = 0; i < texto.length; i += 3) {
        var trozo = texto.substr(i, 3);
        bits.push(parseInt(trozo, 10), trozo.length * 3 + 1);
      }
    } else if (modo === 'alfanumerico') {
      bits.push(texto.length, bitsCuenta(modo, version));
      for (var j = 0; j < texto.length; j += 2) {
        if (j + 1 < texto.length) {
          bits.push(ALFANUMERICO.indexOf(texto.charAt(j)) * 45 + ALFANUMERICO.indexOf(texto.charAt(j + 1)), 11);
        } else {
          bits.push(ALFANUMERICO.indexOf(texto.charAt(j)), 6);
        }
      }
    } else {
      var bytes = aBytesUTF8(texto);
      bits.push(bytes.length, bitsCuenta(modo, version));
      for (var k = 0; k < bytes.length; k++) bits.push(bytes[k], 8);
    }

    var capacidad = datosDisponibles(version, nivel) * 8;
    // Terminador: hasta cuatro ceros.
    var terminador = Math.min(4, capacidad - bits.bits.length);
    bits.push(0, terminador);
    // Relleno hasta byte completo.
    while (bits.bits.length % 8 !== 0) bits.bits.push(0);
    // Bytes de relleno alternos hasta llenar.
    var relleno = [0xec, 0x11];
    var indice = 0;
    while (bits.bits.length < capacidad) {
      bits.push(relleno[indice++ % 2], 8);
    }
    return bits.aBytes();
  }

  // Intercalado de bloques de datos y de corrección.
  function intercalar(datos, version, nivel) {
    var b = BLOQUES[version][nivel];
    var ecPorBloque = b[0];
    var bloques = [];
    var posicion = 0;
    var i, j;

    for (i = 0; i < b[1]; i++) {
      bloques.push(datos.slice(posicion, posicion + b[2]));
      posicion += b[2];
    }
    for (i = 0; i < b[3]; i++) {
      bloques.push(datos.slice(posicion, posicion + b[4]));
      posicion += b[4];
    }

    var ec = bloques.map(function (bloque) {
      return correccion(bloque, ecPorBloque);
    });

    var maxDatos = Math.max(b[2], b[4]);
    var salida = [];
    for (i = 0; i < maxDatos; i++) {
      for (j = 0; j < bloques.length; j++) {
        if (i < bloques[j].length) salida.push(bloques[j][i]);
      }
    }
    for (i = 0; i < ecPorBloque; i++) {
      for (j = 0; j < ec.length; j++) salida.push(ec[j][i]);
    }
    return Uint8Array.from(salida);
  }

  // ----------------------------------------------------------------- matriz
  function nuevaMatriz(tamano, valor) {
    var m = [];
    for (var i = 0; i < tamano; i++) {
      var fila = new Array(tamano);
      for (var j = 0; j < tamano; j++) fila[j] = valor;
      m.push(fila);
    }
    return m;
  }

  function Lienzo(version) {
    this.version = version;
    this.tamano = 17 + 4 * version;
    this.modulos = nuevaMatriz(this.tamano, false);
    this.funcion = nuevaMatriz(this.tamano, false);
  }

  Lienzo.prototype.ponerFuncion = function (x, y, oscuro) {
    this.modulos[y][x] = oscuro;
    this.funcion[y][x] = true;
  };

  Lienzo.prototype.dibujarPatrones = function () {
    var t = this.tamano, i, j;

    // Temporizadores.
    for (i = 0; i < t; i++) {
      this.ponerFuncion(6, i, i % 2 === 0);
      this.ponerFuncion(i, 6, i % 2 === 0);
    }

    // Localizadores y separadores.
    var esquinas = [[0, 0], [t - 7, 0], [0, t - 7]];
    for (var e = 0; e < esquinas.length; e++) {
      var cx = esquinas[e][0], cy = esquinas[e][1];
      for (i = -1; i <= 7; i++) {
        for (j = -1; j <= 7; j++) {
          var x = cx + j, y = cy + i;
          if (x < 0 || x >= t || y < 0 || y >= t) continue;
          var dentro = i >= 0 && i <= 6 && j >= 0 && j <= 6;
          var borde = i === 0 || i === 6 || j === 0 || j === 6;
          var centro = i >= 2 && i <= 4 && j >= 2 && j <= 4;
          this.ponerFuncion(x, y, dentro && (borde || centro));
        }
      }
    }

    // Alineación.
    var centros = ALINEACION[this.version];
    for (i = 0; i < centros.length; i++) {
      for (j = 0; j < centros.length; j++) {
        var ax = centros[j], ay = centros[i];
        var enLocalizador =
          (ax <= 8 && ay <= 8) ||
          (ax <= 8 && ay >= t - 9) ||
          (ax >= t - 9 && ay <= 8);
        if (enLocalizador) continue;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            var esOscuro = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
            this.ponerFuncion(ax + dx, ay + dy, esOscuro);
          }
        }
      }
    }

    // Reserva de los dos bloques de formato y el módulo fijo oscuro.
    for (i = 0; i < 9; i++) {
      if (i !== 6) this.ponerFuncion(i, 8, false);
      if (i !== 6) this.ponerFuncion(8, i, false);
    }
    for (i = 0; i < 8; i++) {
      this.ponerFuncion(t - 1 - i, 8, false);
      this.ponerFuncion(8, t - 1 - i, false);
    }
    this.ponerFuncion(8, t - 8, true);

    // Información de versión (7 en adelante).
    if (this.version >= 7) {
      var resto = this.version;
      for (i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
      var bits = (this.version << 12) | resto;
      for (i = 0; i < 18; i++) {
        var bit = ((bits >>> i) & 1) === 1;
        var a = t - 11 + (i % 3);
        var b = Math.floor(i / 3);
        this.ponerFuncion(a, b, bit);
        this.ponerFuncion(b, a, bit);
      }
    }
  };

  Lienzo.prototype.dibujarFormato = function (nivel, mascara) {
    var datos = (NIVELES_FORMATO[nivel] << 3) | mascara;
    var resto = datos;
    for (var i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
    var bits = ((datos << 10) | resto) ^ 0x5412;
    var t = this.tamano;

    function bit(n) {
      return ((bits >>> n) & 1) === 1;
    }

    for (i = 0; i <= 5; i++) this.ponerFuncion(8, i, bit(i));
    this.ponerFuncion(8, 7, bit(6));
    this.ponerFuncion(8, 8, bit(7));
    this.ponerFuncion(7, 8, bit(8));
    for (i = 9; i < 15; i++) this.ponerFuncion(14 - i, 8, bit(i));

    for (i = 0; i < 8; i++) this.ponerFuncion(t - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) this.ponerFuncion(8, t - 15 + i, bit(i));
    this.ponerFuncion(8, t - 8, true);
  };

  // Nivel de corrección tal y como se codifica en la información de formato.
  var NIVELES_FORMATO = { L: 1, M: 0, Q: 3, H: 2 };

  Lienzo.prototype.colocarDatos = function (codigos) {
    var t = this.tamano;
    var i = 0;
    for (var derecha = t - 1; derecha >= 1; derecha -= 2) {
      if (derecha === 6) derecha = 5;
      for (var vertical = 0; vertical < t; vertical++) {
        for (var j = 0; j < 2; j++) {
          var x = derecha - j;
          var subiendo = ((derecha + 1) & 2) === 0;
          var y = subiendo ? t - 1 - vertical : vertical;
          if (!this.funcion[y][x] && i < codigos.length * 8) {
            this.modulos[y][x] = ((codigos[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  };

  function aplicaMascara(n, x, y) {
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
    throw new Error('Máscara desconocida: ' + n);
  }

  Lienzo.prototype.aplicarMascara = function (n) {
    for (var y = 0; y < this.tamano; y++) {
      for (var x = 0; x < this.tamano; x++) {
        if (!this.funcion[y][x] && aplicaMascara(n, x, y)) {
          this.modulos[y][x] = !this.modulos[y][x];
        }
      }
    }
  };

  // Penalización: cuanto más baja, más fácil de leer para el escáner.
  Lienzo.prototype.penalizacion = function () {
    var t = this.tamano, total = 0, x, y, i;
    var PATRON_A = [true, false, true, true, true, false, true, false, false, false, false];
    var PATRON_B = [false, false, false, false, true, false, true, true, true, false, true];

    // Regla 1: rachas de cinco o más del mismo color.
    for (y = 0; y < t; y++) {
      var racha = 1;
      for (x = 1; x < t; x++) {
        if (this.modulos[y][x] === this.modulos[y][x - 1]) {
          racha++;
          if (racha === 5) total += 3;
          else if (racha > 5) total += 1;
        } else racha = 1;
      }
    }
    for (x = 0; x < t; x++) {
      var rachaV = 1;
      for (y = 1; y < t; y++) {
        if (this.modulos[y][x] === this.modulos[y - 1][x]) {
          rachaV++;
          if (rachaV === 5) total += 3;
          else if (rachaV > 5) total += 1;
        } else rachaV = 1;
      }
    }

    // Regla 2: bloques de 2x2 del mismo color.
    for (y = 0; y < t - 1; y++) {
      for (x = 0; x < t - 1; x++) {
        var c = this.modulos[y][x];
        if (c === this.modulos[y][x + 1] && c === this.modulos[y + 1][x] && c === this.modulos[y + 1][x + 1]) {
          total += 3;
        }
      }
    }

    // Regla 3: el patrón 1:1:3:1:1 rodeado de claro, que confunde con un localizador.
    var self = this;
    function coincide(lector, patron, inicio, longitud) {
      for (var k = 0; k < patron.length; k++) {
        if (inicio + k >= longitud) return false;
        if (lector(inicio + k) !== patron[k]) return false;
      }
      return true;
    }
    for (y = 0; y < t; y++) {
      (function (fila) {
        var lector = function (k) { return self.modulos[fila][k]; };
        for (var x2 = 0; x2 < t; x2++) {
          if (coincide(lector, PATRON_A, x2, t) || coincide(lector, PATRON_B, x2, t)) total += 40;
        }
      })(y);
    }
    for (x = 0; x < t; x++) {
      (function (col) {
        var lector = function (k) { return self.modulos[k][col]; };
        for (var y2 = 0; y2 < t; y2++) {
          if (coincide(lector, PATRON_A, y2, t) || coincide(lector, PATRON_B, y2, t)) total += 40;
        }
      })(x);
    }

    // Regla 4: desequilibrio entre módulos oscuros y claros.
    var oscuros = 0;
    for (y = 0; y < t; y++) for (x = 0; x < t; x++) if (this.modulos[y][x]) oscuros++;
    var porcentaje = (oscuros * 100) / (t * t);
    total += Math.floor(Math.abs(porcentaje - 50) / 5) * 10;

    return total;
  };


  // --------------------------------------------------- hueco para el logo
  /*
   * Poner el logo encima de un QR es normal, pero hay dos cosas que casi nadie
   * comprueba y que rompen el código en la imprenta:
   *
   *  1. La corrección de errores NO protege los tres ojos de las esquinas ni la
   *     línea punteada que los une. Tapar un trocito de un ojo mata el código
   *     aunque el nivel sea el más alto.
   *  2. Un lector real no sabe dónde está el logo, así que solo puede arreglar
   *     la mitad de los códigos dañados de cada bloque, no todos.
   *
   * analizarHueco mide las dos cosas sobre este QR concreto y dice si aguanta.
   */
  function mapaBits(version) {
    var lienzo = new Lienzo(version);
    lienzo.dibujarPatrones();
    var mapa = nuevaMatriz(lienzo.tamano, -1);
    var i = 0;
    var t = lienzo.tamano;
    for (var derecha = t - 1; derecha >= 1; derecha -= 2) {
      if (derecha === 6) derecha = 5;
      for (var vertical = 0; vertical < t; vertical++) {
        for (var j = 0; j < 2; j++) {
          var x = derecha - j;
          var subiendo = ((derecha + 1) & 2) === 0;
          var y = subiendo ? t - 1 - vertical : vertical;
          if (!lienzo.funcion[y][x]) mapa[y][x] = i++;
        }
      }
    }
    return { mapa: mapa, funcion: lienzo.funcion, tamano: t, bits: i };
  }

  // Índice de cada código en el flujo intercalado -> a qué bloque pertenece.
  function mapaCodigos(version, nivel) {
    var b = BLOQUES[version][nivel];
    var tamanos = [];
    var i, j;
    for (i = 0; i < b[1]; i++) tamanos.push(b[2]);
    for (i = 0; i < b[3]; i++) tamanos.push(b[4]);
    var total = tamanos.length;
    var mapa = [];
    var maxDatos = Math.max(b[2], b[4]);
    for (i = 0; i < maxDatos; i++) {
      for (j = 0; j < total; j++) if (i < tamanos[j]) mapa.push(j);
    }
    for (i = 0; i < b[0]; i++) {
      for (j = 0; j < total; j++) mapa.push(j);
    }
    return { mapa: mapa, bloques: total, ecPorBloque: b[0] };
  }

  function analizarHueco(qr, fraccionLado) {
    var info = mapaBits(qr.version);
    var t = qr.tamano;
    // El hueco se redondea a módulos enteros: un logo a medio cuadro deja
    // píxeles sucios que el lector interpreta mal.
    var lado = Math.round(t * fraccionLado);
    var inicio = Math.floor((t - lado) / 2);
    var fin = inicio + lado;

    var tocaFuncion = false;
    var tocados = {};
    for (var y = inicio; y < fin; y++) {
      for (var x = inicio; x < fin; x++) {
        if (y < 0 || x < 0 || y >= t || x >= t) continue;
        if (info.funcion[y][x]) { tocaFuncion = true; continue; }
        var bit = info.mapa[y][x];
        if (bit >= 0) tocados[bit >>> 3] = true;
      }
    }

    var mc = mapaCodigos(qr.version, qr.nivel);
    var porBloque = new Array(mc.bloques);
    for (var b = 0; b < mc.bloques; b++) porBloque[b] = 0;
    for (var clave in tocados) {
      var indice = +clave;
      if (indice < mc.mapa.length) porBloque[mc.mapa[indice]]++;
    }

    // Un lector no sabe dónde está el daño, así que arregla como mucho la mitad
    // de los códigos de corrección de cada bloque.
    var capacidad = Math.floor(mc.ecPorBloque / 2);
    var peor = 0;
    for (var k = 0; k < porBloque.length; k++) peor = Math.max(peor, porBloque[k]);

    return {
      fraccionLado: fraccionLado,
      ladoEnModulos: lado,
      porcentajeArea: Math.round(fraccionLado * fraccionLado * 1000) / 10,
      tocaFuncion: tocaFuncion,
      codigosDanadosPorBloque: porBloque,
      peorBloque: peor,
      capacidadPorBloque: capacidad,
      aguanta: !tocaFuncion && peor <= capacidad,
      margen: capacidad - peor
    };
  }

  // ------------------------------------------------------------------- API
  function generar(texto, opciones) {
    opciones = opciones || {};
    var nivel = (opciones.nivel || 'H').toUpperCase();
    if (!(nivel in NIVELES)) throw new Error('Nivel de corrección desconocido: ' + nivel);
    texto = String(texto);
    if (texto.length === 0) throw new Error('No se puede generar un QR de una cadena vacía');

    var modo = opciones.modo || elegirModo(texto);
    var versionMinima = Math.max(1, opciones.versionMinima || 1);

    var version = 0;
    for (var v = versionMinima; v <= VERSION_MAX; v++) {
      if (bitsNecesarios(texto, modo, v) <= datosDisponibles(v, nivel) * 8) {
        version = v;
        break;
      }
    }
    if (!version) {
      throw new Error(
        'El texto no cabe en un QR de versión ' + VERSION_MAX + ' con nivel ' + nivel +
        '. Acorta la URL o baja el nivel de corrección: un QR que necesita una versión ' +
        'alta tiene módulos diminutos y deja de leerse a distancia.'
      );
    }

    var datos = codificarDatos(texto, modo, version, nivel);
    var codigos = intercalar(datos, version, nivel);

    var mejor = null;
    for (var m = 0; m < 8; m++) {
      var lienzo = new Lienzo(version);
      lienzo.dibujarPatrones();
      lienzo.colocarDatos(codigos);
      lienzo.dibujarFormato(nivel, m);
      lienzo.aplicarMascara(m);
      var p = lienzo.penalizacion();
      if (!mejor || p < mejor.penalizacion) {
        mejor = { lienzo: lienzo, mascara: m, penalizacion: p };
      }
    }

    return {
      texto: texto,
      version: version,
      nivel: nivel,
      modo: modo,
      mascara: mejor.mascara,
      tamano: mejor.lienzo.tamano,
      modulos: mejor.lienzo.modulos
    };
  }

  /*
   * SVG en un solo trazo (un único <path>): pesa poco, escala sin perder nitidez
   * y cualquier imprenta lo abre. El margen va en módulos: cuatro es el mínimo
   * que exige la norma (la "zona de silencio"), y por debajo de eso hay lectores
   * que sencillamente no ven el código.
   */
  function aSVG(qr, opciones) {
    opciones = opciones || {};
    var margen = opciones.margen == null ? 4 : opciones.margen;
    var escala = opciones.escala == null ? 10 : opciones.escala;
    var oscuro = opciones.oscuro || '#000000';
    var claro = opciones.claro || '#ffffff';
    var lado = (qr.tamano + margen * 2) * escala;

    // Hueco central para el logo, en módulos enteros.
    var hueco = null;
    if (opciones.hueco) {
      var fraccion = typeof opciones.hueco === 'number' ? opciones.hueco : opciones.hueco.lado;
      var ladoHueco = Math.round(qr.tamano * fraccion);
      var inicioHueco = Math.floor((qr.tamano - ladoHueco) / 2);
      hueco = { inicio: inicioHueco, fin: inicioHueco + ladoHueco };
    }

    var trazo = [];
    for (var y = 0; y < qr.tamano; y++) {
      for (var x = 0; x < qr.tamano; x++) {
        if (hueco && x >= hueco.inicio && x < hueco.fin && y >= hueco.inicio && y < hueco.fin) continue;
        if (qr.modulos[y][x]) {
          trazo.push('M' + (x + margen) + ',' + (y + margen) + 'h1v1h-1z');
        }
      }
    }

    var titulo = opciones.titulo || qr.texto;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + lado + '" height="' + lado + '" ' +
      'viewBox="0 0 ' + (qr.tamano + margen * 2) + ' ' + (qr.tamano + margen * 2) + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="' + escaparXML(titulo) + '">\n' +
      '<title>' + escaparXML(titulo) + '</title>\n' +
      (claro === 'none' ? '' : '<rect width="100%" height="100%" fill="' + claro + '"/>\n') +
      '<path fill="' + oscuro + '" d="' + trazo.join('') + '"/>\n' +
      (hueco
        ? '<rect x="' + (hueco.inicio + margen) + '" y="' + (hueco.inicio + margen) +
          '" width="' + (hueco.fin - hueco.inicio) + '" height="' + (hueco.fin - hueco.inicio) +
          '" fill="' + (claro === 'none' ? '#ffffff' : claro) + '"/>\n'
        : '') +
      '</svg>\n'
    );
  }

  function escaparXML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Dibujo en <canvas>, para la página del generador.
  function aCanvas(qr, canvas, opciones) {
    opciones = opciones || {};
    var margen = opciones.margen == null ? 4 : opciones.margen;
    var escala = opciones.escala == null ? 8 : opciones.escala;
    var lado = (qr.tamano + margen * 2) * escala;
    canvas.width = lado;
    canvas.height = lado;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opciones.claro || '#ffffff';
    ctx.fillRect(0, 0, lado, lado);
    ctx.fillStyle = opciones.oscuro || '#000000';
    for (var y = 0; y < qr.tamano; y++) {
      for (var x = 0; x < qr.tamano; x++) {
        if (qr.modulos[y][x]) {
          ctx.fillRect((x + margen) * escala, (y + margen) * escala, escala, escala);
        }
      }
    }
    return canvas;
  }

  return {
    generar: generar,
    aSVG: aSVG,
    aCanvas: aCanvas,
    comprobarTablas: comprobarTablas,
    analizarHueco: analizarHueco,
    mapaBits: mapaBits,
    mapaCodigos: mapaCodigos,
    totalCodigos: totalCodigos,
    datosDisponibles: datosDisponibles,
    VERSION_MAX: VERSION_MAX,
    _interno: { correccion: correccion, codificarDatos: codificarDatos, intercalar: intercalar, mul: mul }
  };
});
