/*
 * config.js — el único fichero que hay que tocar.
 *
 * De aquí salen: la página puente, la tarjeta de contacto (.vcf), los QR de
 * imprenta y las URL que se graban en los NFC. Si algo cambia —el número, el
 * mensaje, la sala, el dominio— se cambia aquí y se vuelve a ejecutar:
 *
 *     node herramientas/construir.js
 *
 * Lo que está marcado con RELLENAR es lo único que no puedo saber yo.
 */
'use strict';

const config = {

  // ---------------------------------------------------------------- quién es
  artista: {
    nombre: 'Gloria',
    apellidos: 'Díez Monzones',
    // Cómo aparece en la agenda de quien la guarde. Puesto así porque es lo que
    // el fan acaba de leer en el aviso del móvil al escanear (el dominio lleva
    // "enlagloria"), y que coincidan es lo que hace que la gente toque. Si en los
    // carteles aparece de otra forma, se cambia aquí: es una línea.
    nombreArtistico: 'En la Gloria',
    actividad: 'Cantante',           // va en el campo "empresa" de la ficha: ayuda a encontrarla luego
    titulo: '',                      // opcional: "Voz y piano", "Copla y flamenco"…
    email: '',                       // RELLENAR: hace falta para el aviso legal, ver docs/08-legal.md
    nota: ''                         // opcional: una línea que verá en su agenda quien la guarde
  },

  // ------------------------------------------------------------ aviso legal
  // Lo exige el artículo 10 de la Ley 34/2002 y no es opcional. Se pinta en
  // web/privacidad.html. Ver docs/08-legal.md.
  avisoLegal: {
    titular: 'Gloria Díez Monzones',
    domicilio: 'Boadilla del Monte, Madrid',
    nif: '',      // RELLENAR: la ley pide el NIF
    email: ''     // RELLENAR: un correo de contacto, puede ser el del management
  },

  // ------------------------------------------------------------- el teléfono
  telefono: {
    // Para wa.me: solo dígitos, con prefijo de país, sin +, sin espacios, sin
    // guiones y sin el 0 inicial. Cualquier símbolo aquí rompe el enlace con el
    // error "Phone number shared via url is invalid".
    enlace: '34620591728',
    // Para la tarjeta de contacto y para enseñarlo en pantalla, sí con formato.
    internacional: '+34 620 591 728'
  },

  // ------------------------------------------------------------- dónde vive
  // El subdominio donde ya está publicada su landing. Sin barra final.
  // Ojo: cada carácter de más engorda el QR. Con este dominio el código de la
  // tarjeta sale de versión 6 (41×41 cuadros) y hay que imprimirlo a 30 mm para
  // que cada cuadro llegue a 0,6 mm. La tarjeta ya lo calcula sola.
  // Si el subdominio responde también SIN el www, quitarlo aquí ahorra cuatro
  // caracteres. Compruébalo antes de cambiarlo.
  sitio: 'https://www.enlagloriaevents.brainstormersagency.es',

  // Carpeta de la página puente dentro de ese sitio. Con barra al final a
  // propósito: sin ella el servidor contesta una redirección extra antes de
  // enseñar nada, y eso son décimas de segundo con la cámara apuntando.
  // "/hola/" es corta y se puede decir en voz alta sin deletrear.
  ruta: '/hola/',

  // ------------------------------------------------------- qué más hay de ella
  // Se pintan como botones secundarios en la página puente y se meten en la
  // tarjeta de contacto. Deja vacío lo que no exista todavía.
  redes: [
    { nombre: 'Canal de WhatsApp', url: '', clave: 'canal' },
    { nombre: 'Instagram', url: '', clave: 'instagram' },
    { nombre: 'Spotify', url: '', clave: 'spotify' },
    { nombre: 'YouTube', url: '', clave: 'youtube' },
    { nombre: 'Próximos conciertos', url: '', clave: 'fechas' }
  ],

  // ---------------------------------------------------------- los soportes
  // Un código por cada sitio físico donde vive un QR o un NFC. Sirve para saber
  // qué funciona: la tarjeta, la pulsera, el cartel o la pantalla del móvil.
  // El código viaja en la URL como ?f=…
  soportes: [
    { clave: 'tarjeta',  titulo: 'Tarjeta de visita',            tipo: 'qr' },
    { clave: 'pantalla', titulo: 'QR en la pantalla del móvil',  tipo: 'qr' },
    { clave: 'cartel',   titulo: 'Cartel o roll-up',             tipo: 'qr' },
    { clave: 'merch',    titulo: 'Mesa de merchandising',        tipo: 'qr' },
    { clave: 'pulsera',  titulo: 'Pulsera NFC',                  tipo: 'nfc' },
    { clave: 'chapa',    titulo: 'Chapa o pegatina NFC',         tipo: 'nfc' },
    { clave: 'funda',    titulo: 'NFC en la funda del móvil',    tipo: 'nfc' },

    // Estos no llevan QR: son enlaces. Se listan igual para que el contador los
    // admita y se pueda comparar de dónde llega la gente.
    { clave: 'web',       titulo: 'Botón en su landing',          tipo: 'enlace' },
    { clave: 'instagram', titulo: 'Biografía de Instagram',       tipo: 'enlace' }
  ],

  // ---------------------------------------------------------------- mensajes
  // Redactados y razonados en docs/02-mensajes.md. Si se cambian, leer antes ese
  // documento: cada trozo está ahí por un motivo, y uno de ellos es legal.
  mensajes: {
    // El que aparece ESCRITO en el chat cuando el fan abre WhatsApp. Lo redacta
    // ella, pero lo envía él: por eso va en primera persona del fan.
    // Las dos últimas palabras no son adorno. «Avísame de los próximos bolos»
    // es una petición expresa del destinatario, que es justo lo que exige el
    // artículo 21 de la LSSI para poder escribirle más adelante sin que sea spam.
    prerellenado: '¡Hola! Vengo de verte en {sala} 🙌 Avísame de los próximos bolos.',

    // Cuando el soporte no sabe en qué sala está (una tarjeta genérica), se usa
    // este. Nunca debe salir publicado un «{sala}» a medio sustituir.
    prerellenadoSinSala: '¡Hola! Vengo de verte esta noche 🙌 Avísame de los próximos bolos.',

    // Textos de la página puente.
    titulo: 'En la Gloria',    // el nombre artístico, tal cual lo dice la gente
    subtitulo: 'Nos acabamos de conocer. Ábreme el WhatsApp y te aviso yo del próximo bolo.',
    botonWhatsapp: 'Abrir mi WhatsApp',
    // Debajo del botón, en pequeño. Es la línea más importante de la página:
    // el mensaje NO se envía solo, y si el fan no le da a enviar ella no se
    // entera siquiera de que ha pasado.
    avisoEnviar: 'El mensaje ya va escrito, solo dale a enviar.',
    botonCanal: 'Sígueme en mi canal',
    botonGuardar: 'Guardar mi número en tu móvil',
    privacidad: 'Tu número lo veo solo yo. Lo uso para avisarte de bolos y música nueva, nada más. Escribe BAJA cuando quieras y desapareces.'
  },

  // ---------------------------------------------------------------- ajustes
  opciones: {
    // Abrir WhatsApp solo, sin que el fan pulse nada. Va en false a propósito:
    // ver docs/01-analisis-metodos.md, "por qué la página puente no salta sola".
    abrirAutomatico: false,

    // Llamar a contar.php para el recuento agregado de escaneos.
    medir: true,
    rutaMedicion: 'contar.php',   // relativo a la página: funciona la suba donde la suba

    // Nivel de corrección de errores de los QR impresos.
    nivelQR: 'Q',

    // Colores del QR. Oscuro sobre claro, siempre.
    qrOscuro: '#16151a',
    qrClaro: '#ffffff'
  },

  ficheros: {
    vcard: 'contacto.vcf',
    ajustesWeb: 'ajustes.js'
  }
};

// Atajo cómodo para la consola. La construcción NO usa esto: tiene su propia
// función (herramientas/construir.js, urlDe) para que copiar esta configuración
// no se lleve por delante el método.
config.urlDeSoporte = function (clave, extra) {
  let url = config.sitio + config.ruta + '?f=' + encodeURIComponent(clave);
  if (extra && extra.sala) url += '&sala=' + encodeURIComponent(extra.sala);
  return url;
};

// Construye el enlace final de WhatsApp con el mensaje ya escrito.
config.enlaceWhatsapp = function (sala) {
  const texto = sala
    ? config.mensajes.prerellenado.replace('{sala}', sala)
    : config.mensajes.prerellenadoSinSala;
  return 'https://wa.me/' + config.telefono.enlace + '?text=' + encodeURIComponent(texto);
};

module.exports = config;
