/*
 * construir.js — genera todo lo que se sube y todo lo que se imprime.
 *
 *     node herramientas/construir.js
 *
 * Sale de aquí:
 *   web/ajustes.js     los textos y el número, para la página puente
 *   web/contacto.vcf   la tarjeta de contacto que descarga el fan
 *   imprenta/*.svg     un QR por soporte, listo para la imprenta
 *   imprenta/urls.txt  las direcciones que hay que grabar en los NFC
 *
 * Antes de generar nada comprueba que la configuración esté completa: más vale
 * un error aquí que quinientas pegatinas con "RELLENAR" dentro del código.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const QR = require('./qr.js');
const { decodificar } = require('./leer-qr.js');
const { construir: construirVcf } = require('./hacer-vcf.js');

const RAIZ = path.join(__dirname, '..');
let problemas = [];
let avisos = [];

// --------------------------------------------------------------- revisiones
function revisar(config) {
  const pendiente = (v) => typeof v === 'string' && v.indexOf('RELLENAR') >= 0;

  if (pendiente(config.sitio)) {
    problemas.push('config.sitio sigue sin rellenar: hace falta el subdominio real donde vive la landing.');
  } else if (!/^https:\/\//.test(config.sitio)) {
    problemas.push('config.sitio tiene que empezar por https:// — un QR que va por http avisa de sitio no seguro.');
  } else if (config.sitio.endsWith('/')) {
    problemas.push('config.sitio no debe acabar en barra.');
  }

  if (!/^\/.*\/$/.test(config.ruta)) {
    problemas.push('config.ruta tiene que empezar y acabar con barra, por ejemplo "/hola/".');
  }

  if (!/^[0-9]{6,15}$/.test(config.telefono.enlace)) {
    problemas.push(
      'config.telefono.enlace debe ser solo dígitos con el prefijo del país, sin +, ' +
      'sin espacios y sin guiones. Cualquier símbolo hace que WhatsApp responda ' +
      '"Phone number shared via url is invalid".'
    );
  }

  ['prerellenado', 'prerellenadoSinSala', 'titulo', 'subtitulo', 'botonWhatsapp', 'avisoEnviar', 'botonGuardar', 'privacidad'].forEach((clave) => {
    if (pendiente(config.mensajes[clave])) problemas.push('config.mensajes.' + clave + ' sigue sin rellenar.');
  });

  ['nombre', 'apellidos', 'nombreArtistico'].forEach((clave) => {
    if (pendiente(config.artista[clave])) problemas.push('config.artista.' + clave + ' sigue sin rellenar.');
  });

  // La longitud del mensaje no rompe nada, pero un mensaje largo lo borra el fan.
  if (config.mensajes.prerellenado.indexOf('{sala}') < 0) {
    problemas.push('config.mensajes.prerellenado tiene que llevar {sala} dentro: si no, todos los mensajes llegan iguales y no se sabe de qué noche sale cada uno.');
  }
  if (config.mensajes.prerellenadoSinSala.indexOf('{sala}') >= 0) {
    problemas.push('config.mensajes.prerellenadoSinSala no puede llevar {sala}: es justo el texto que se usa cuando no hay sala.');
  }
  const mensaje = config.mensajes.prerellenado.replace('{sala}', 'Sala Clamores');
  if (mensaje.length > 120) {
    avisos.push('El mensaje prerellenado tiene ' + mensaje.length + ' caracteres. Por encima de 120 la gente lo borra antes de enviarlo.');
  }

  // La URL larga engorda el QR. Con nivel Q, a partir de la versión 6 los
  // cuadros empiezan a ser demasiado pequeños para una tarjeta de visita.
  const url = config.urlDeSoporte('tarjeta');
  const prueba = QR.generar(url, { nivel: config.opciones.nivelQR });
  if (prueba.version > 5) {
    avisos.push(
      'La URL del soporte mide ' + url.length + ' caracteres y sale un QR de versión ' +
      prueba.version + ' (' + prueba.tamano + '×' + prueba.tamano + ' cuadros). Acorta el dominio o la ruta ' +
      'si el QR va en algo pequeño: cuantos más cuadros, más grande hay que imprimirlo.'
    );
  }
}

// --------------------------------------------------------------- generación
function escribirAjustes(config, salida) {
  const canal = (config.redes || []).find((r) => r.clave === 'canal' && r.url);
  const enlaces = (config.redes || []).filter((r) => r.clave !== 'canal' && r.url)
    .map((r) => ({ nombre: r.nombre, url: r.url }));

  const ajustes = {
    nombre: config.mensajes.titulo,
    saludo: config.mensajes.subtitulo,
    telefono: config.telefono.enlace,
    telefonoLegible: config.telefono.internacional,
    mensaje: config.mensajes.prerellenado,
    mensajeSinSala: config.mensajes.prerellenadoSinSala,
    botonWhatsapp: config.mensajes.botonWhatsapp,
    avisoEnviar: config.mensajes.avisoEnviar,
    botonGuardar: config.mensajes.botonGuardar,
    privacidad: config.mensajes.privacidad,
    enlacePrivacidad: 'privacidad.html',
    canal: canal ? canal.url : '',
    textoCanal: config.mensajes.botonCanal,
    enlaces: enlaces,
    medir: !!config.opciones.medir,
    rutaMedicion: config.opciones.rutaMedicion,
    abrirAutomatico: !!config.opciones.abrirAutomatico
  };

  const destino = path.join(salida, config.ficheros.ajustesWeb);
  const contenido =
    '/* Generado por herramientas/construir.js — no editar a mano.\n' +
    '   Lo que haya que cambiar se cambia en config.js y se vuelve a ejecutar. */\n' +
    'window.AJUSTES = ' + JSON.stringify(ajustes, null, 2) + ';\n';
  fs.writeFileSync(destino, contenido, 'utf8');
  return destino;
}

// El generador de QR se copia a web/ porque la página que enseña el QR en el
// móvil lo necesita allí. Se copia en vez de duplicarse a mano: una sola
// versión del fichero, la de herramientas/.
function copiarGenerador(salida) {
  const destino = path.join(salida, 'qr.js');
  fs.copyFileSync(path.join(__dirname, 'qr.js'), destino);
  return destino;
}

/*
 * El contador se genera, no se copia: la lista de orígenes admitidos tiene que
 * ser exactamente la de los soportes de config.js. Si no coinciden, los escaneos
 * de la pulsera acaban contados como "otro" y se pierde justo el dato por el que
 * se montó el contador.
 */
function escribirContador(config, salida) {
  const plantilla = fs.readFileSync(path.join(__dirname, '..', 'servidor', 'contar.php'), 'utf8');
  const claves = config.soportes.map((s) => s.clave).concat(['directo', 'otro']);
  const lista = claves.map((c) => "'" + c + "'").join(', ');

  const contenido = plantilla
    .replace(/\$DESTINO_POR_DEFECTO = .*;\s*\/\*__DESTINO__\*\//,
      "$DESTINO_POR_DEFECTO = 'https://wa.me/" + config.telefono.enlace + "';   /*__DESTINO__*/")
    .replace(/\$ORIGENES = array\(.*?\);\s*\/\*__ORIGENES__\*\//s,
      '$ORIGENES = array(' + lista + ');   /*__ORIGENES__*/');

  const destino = path.join(salida, 'contar.php');
  fs.writeFileSync(destino, contenido, 'utf8');
  return destino;
}

function escribirVcf(config, salida) {
  const destino = path.join(salida, config.ficheros.vcard);
  fs.writeFileSync(destino, construirVcf(config), 'utf8');
  return destino;
}

function escribirQR(config, salida) {
  const carpeta = salida;
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

  const generados = [];
  const urls = [];
  let releidos = 0;

  for (const soporte of config.soportes) {
    const url = config.urlDeSoporte(soporte.clave);
    urls.push({ soporte, url });

    // Los soportes de tipo "enlace" (el botón de su web, la biografía de
    // Instagram) no se imprimen: son una URL que se pega en otro sitio.
    if (soporte.tipo === 'enlace') continue;

    // Los soportes NFC no llevan QR propio: el tag guarda la URL directamente.
    // Pero se genera igual, porque en la práctica cada pieza NFC acaba llevando
    // un QR impreso al lado para quien no tenga NFC o no sepa usarlo.
    const qr = QR.generar(url, { nivel: config.opciones.nivelQR });

    // Se vuelve a leer lo que se acaba de dibujar. Es barato y evita el único
    // fallo de este proyecto que no tiene arreglo: quinientas piezas impresas
    // con un código que no dice lo que creíamos.
    const leido = decodificar(qr);
    if (leido.texto !== url) {
      throw new Error(
        'El QR de "' + soporte.clave + '" no se relee bien: dice "' + leido.texto +
        '" y debería decir "' + url + '". No se ha escrito nada.'
      );
    }

    const svg = QR.aSVG(qr, {
      margen: 4,
      escala: 16,
      oscuro: config.opciones.qrOscuro,
      claro: config.opciones.qrClaro,
      titulo: soporte.titulo
    });
    const destino = path.join(carpeta, 'qr-' + soporte.clave + '.svg');
    fs.writeFileSync(destino, svg, 'utf8');
    releidos++;
    generados.push({ soporte, qr, destino, url });
  }

  // Las URL para grabar en los tags, en un fichero de texto que se puede abrir
  // desde el móvil al lado de la aplicación de escritura NFC.
  const texto = [
    'URLs para grabar en los tags NFC y para los QR',
    'Generado desde config.js',
    '',
    ...urls.map(({ soporte, url }) =>
      soporte.titulo + ' (' + soporte.tipo.toUpperCase() + ')\n  ' + url + '\n'
    ),
    'Los de tipo ENLACE no se imprimen: se pegan donde toque (el botón de la web,',
    'la biografía de Instagram). Los de tipo NFC se graban en el tag.',
    'Cómo se graban los NFC: docs/04-nfc.md'
  ].join('\n');
  fs.writeFileSync(path.join(carpeta, 'urls.txt'), texto, 'utf8');

  generados.releidos = releidos;
  return generados;
}

// ------------------------------------------------------------------ arranque
function generar(config, salidaWeb, salidaImprenta) {
  problemas = [];
  avisos = [];
  revisar(config);
  if (problemas.length) return { problemas, avisos };
  if (!fs.existsSync(salidaWeb)) fs.mkdirSync(salidaWeb, { recursive: true });
  return {
    problemas,
    avisos,
    ajustes: escribirAjustes(config, salidaWeb),
    generador: copiarGenerador(salidaWeb),
    contador: escribirContador(config, salidaWeb),
    vcf: escribirVcf(config, salidaWeb),
    qrs: escribirQR(config, salidaImprenta)
  };
}

function principal() {
  const config = require('../config.js');
  revisar(config);

  if (problemas.length) {
    console.error('No se ha generado nada. Falta esto en config.js:\n');
    problemas.forEach((p) => console.error('  · ' + p));
    console.error('');
    process.exit(1);
  }

  const salidaWeb = path.join(RAIZ, 'web');
  const ajustes = escribirAjustes(config, salidaWeb);
  const generador = copiarGenerador(salidaWeb);
  const contador = escribirContador(config, salidaWeb);
  const vcf = escribirVcf(config, salidaWeb);
  const qrs = escribirQR(config, path.join(RAIZ, 'imprenta'));

  console.log('Generado:');
  console.log('  · ' + path.relative(RAIZ, ajustes));
  console.log('  · ' + path.relative(RAIZ, generador));
  console.log('  · ' + path.relative(RAIZ, contador));
  console.log('  · ' + path.relative(RAIZ, vcf));
  qrs.forEach(({ soporte, qr, destino }) => {
    console.log(
      '  · ' + path.relative(RAIZ, destino) +
      '  (' + soporte.titulo + ', versión ' + qr.version + ', ' + qr.tamano + '×' + qr.tamano + ' cuadros)'
    );
  });
  console.log('  · imprenta/urls.txt');
  console.log('');
  console.log('Los ' + qrs.releidos + ' códigos se han vuelto a leer y dicen lo que deben.');

  try {
    require('./hacer-tarjeta.js');
    const tarjeta = require('child_process').execFileSync(process.execPath,
      [path.join(__dirname, 'hacer-tarjeta.js')], { encoding: 'utf8' });
    console.log('  · imprenta/tarjeta-cara-a.svg');
    console.log('  · imprenta/tarjeta-cara-b.svg');
    const medida = tarjeta.split('\n').filter((l) => l.indexOf('cada cuadro') >= 0)[0];
    if (medida) console.log('    ' + medida.trim());
    if (tarjeta.indexOf('AVISO') >= 0) {
      avisos.push('El QR de la tarjeta queda por debajo de 0,5 mm por cuadro: mira docs/05-qr-imprenta.md antes de imprimir.');
    }
  } catch (err) {
    console.log('  (no se ha podido generar la tarjeta: ' + err.message + ')');
  }

  if (avisos.length) {
    console.log('\nMerece la pena mirar esto:');
    avisos.forEach((a) => console.log('  · ' + a));
  }

  console.log('\nSiguiente paso: subir el contenido de web/ al subdominio y probar el QR con dos móviles.');
}

if (require.main === module) principal();
module.exports = { generar, revisar };
