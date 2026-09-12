/*
 * urls.js — cómo se construye la dirección de cada soporte.
 *
 * Vive suelto, en su propio fichero, por dos motivos:
 *
 *  · config.js exporta un método que hace esto mismo, pero en cuanto alguien
 *    copia la configuración para probar algo, el método se queda por el camino
 *    y la construcción revienta lejos de donde está la causa. Una función suelta
 *    no se pierde al copiar.
 *  · La construcción y el generador de la tarjeta la necesitan los dos. Si la
 *    tuviera una y la pidiera la otra, se cierra un círculo entre ficheros que
 *    Node resuelve a medias y en silencio.
 *
 * Es la definición única de qué hay dentro de un QR y de un tag NFC.
 */
'use strict';

function urlDe(config, clave) {
  return config.sitio + config.ruta + '?f=' + encodeURIComponent(clave);
}

module.exports = { urlDe };
