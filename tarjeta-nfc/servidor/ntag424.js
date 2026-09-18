// Verificacion de mensajes SUN (Secure Unique NFC) de chips NTAG 424 DNA.
//
// POR QUE EXISTE ESTE FICHERO
// Una NTAG213 normal expone un UID fijo que se puede leer y copiar a una tarjeta
// "magica" de 2 EUR. Con eso, el UID por si solo no demuestra nada: es un numero
// de socio, no una credencial. En el dia a dia da igual (ver docs/05), porque quien
// suma puntos es un empleado autenticado. Pero si algun dia quieres que el propio
// cliente pueda sumar acercando su tarjeta -- o proteger el canje de premios caros --
// necesitas un chip que firme cada lectura.
//
// La NTAG424 DNA hace justo eso: cada vez que la acercas emite una URL distinta con
//   ?picc_data=<UID+contador cifrados>&cmac=<firma>
// El contador solo sube. Una copia del mensaje anterior se detecta como repetido.
//
// ESTADO: implementado contra la especificacion (NXP AN12196). El AES-CMAC esta
// verificado con los vectores oficiales del RFC 4493; la parte SUN esta verificada
// en ida y vuelta contra el codificador de este mismo fichero, NO contra silicio real.
// Antes de usarlo en produccion, personaliza una tarjeta de verdad y comprueba que
// `verificarSun` acepta su primera lectura. Ver docs/05 seccion "Subir a NTAG424".

import { createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

const BLOQUE = 16;
const Rb = 0x87;

const aesEcb = (clave, bloque) => {
  const c = createCipheriv('aes-128-ecb', clave, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(bloque), c.final()]);
};

/** Desplaza un buffer un bit a la izquierda (big-endian). */
function desplazarIzq(buf) {
  const salida = Buffer.alloc(buf.length);
  let acarreo = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    salida[i] = ((buf[i] << 1) & 0xff) | acarreo;
    acarreo = (buf[i] & 0x80) ? 1 : 0;
  }
  return salida;
}

/** Subclaves K1/K2 del RFC 4493 §2.3. */
export function subclaves(clave) {
  const L = aesEcb(clave, Buffer.alloc(BLOQUE));
  let K1 = desplazarIzq(L);
  if (L[0] & 0x80) K1[BLOQUE - 1] ^= Rb;
  let K2 = desplazarIzq(K1);
  if (K1[0] & 0x80) K2[BLOQUE - 1] ^= Rb;
  return { K1, K2 };
}

const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ b[i]));

/** AES-CMAC (RFC 4493). Clave de 16 bytes, devuelve 16 bytes. */
export function cmac(clave, mensaje) {
  const { K1, K2 } = subclaves(clave);
  const completo = mensaje.length > 0 && mensaje.length % BLOQUE === 0;
  const nBloques = completo ? mensaje.length / BLOQUE : Math.floor(mensaje.length / BLOQUE) + 1;

  let ultimo;
  if (completo) {
    ultimo = xor(mensaje.subarray((nBloques - 1) * BLOQUE), K1);
  } else {
    const resto = mensaje.subarray((nBloques - 1) * BLOQUE);
    const rellenado = Buffer.concat([resto, Buffer.from([0x80]), Buffer.alloc(BLOQUE)])
      .subarray(0, BLOQUE);
    ultimo = xor(rellenado, K2);
  }

  let x = Buffer.alloc(BLOQUE);
  for (let i = 0; i < nBloques - 1; i++) {
    x = aesEcb(clave, xor(x, mensaje.subarray(i * BLOQUE, (i + 1) * BLOQUE)));
  }
  return aesEcb(clave, xor(x, ultimo));
}

/** La tarjeta manda solo los bytes impares del CMAC (8 de 16). AN12196 §4.6. */
export const truncarMac = (mac16) =>
  Buffer.from([mac16[1], mac16[3], mac16[5], mac16[7], mac16[9], mac16[11], mac16[13], mac16[15]]);

/** Clave de sesion de lectura: SV2 = 3C C3 00 01 00 80 || UID || contador. */
export function claveSesion(claveFicheroLectura, uid, contador) {
  const sv2 = Buffer.concat([
    Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]),
    uid,                                                        // 7 bytes
    Buffer.from([contador & 0xff, (contador >> 8) & 0xff, (contador >> 16) & 0xff]),
  ]);
  return cmac(claveFicheroLectura, sv2);
}

/**
 * Descifra y valida el mensaje de una lectura.
 * @param {object} p
 * @param {string} p.piccData  hex, 32 caracteres (16 bytes)
 * @param {string} p.cmac      hex, 16 caracteres (8 bytes)
 * @param {Buffer} p.claveMeta AES-128 que cifra el PICCData
 * @param {Buffer} p.claveMac  AES-128 del fichero SDM (suele ser otra)
 * @param {number} p.contadorVisto  ultimo contador aceptado para esta tarjeta
 * @param {Buffer} [p.datosExtra]   contenido cubierto por el MAC, si lo configuraste
 */
export function verificarSun({ piccData, cmac: macRecibido, claveMeta, claveMac,
                               contadorVisto = -1, datosExtra = Buffer.alloc(0) }) {
  let claro;
  try {
    const d = createDecipheriv('aes-128-cbc', claveMeta, Buffer.alloc(16));
    d.setAutoPadding(false);
    claro = Buffer.concat([d.update(Buffer.from(piccData, 'hex')), d.final()]);
  } catch {
    return { ok: false, motivo: 'picc_ilegible' };
  }
  if (claro[0] !== 0xc7) return { ok: false, motivo: 'etiqueta_picc_inesperada', byte: claro[0] };

  const uid = claro.subarray(1, 8);
  const contador = claro[8] | (claro[9] << 8) | (claro[10] << 16);

  const esperado = truncarMac(cmac(claveSesion(claveMac, uid, contador), datosExtra));
  const recibido = Buffer.from(macRecibido, 'hex');
  if (recibido.length !== 8 || !timingSafeEqual(esperado, recibido)) {
    return { ok: false, motivo: 'firma_invalida' };
  }
  // Anti-replay: el contador de la tarjeta solo sube. Repetir una URL antigua
  // (una foto del NDEF, un log del servidor) cae aqui.
  if (contador <= contadorVisto) {
    return { ok: false, motivo: 'contador_repetido', contador, contador_visto: contadorVisto };
  }
  return { ok: true, uid: uid.toString('hex').toUpperCase(), contador };
}

/** Solo para pruebas: genera lo que emitiria una tarjeta bien personalizada. */
export function simularLectura({ uid, contador, claveMeta, claveMac, datosExtra = Buffer.alloc(0) }) {
  const picc = Buffer.concat([
    Buffer.from([0xc7]), uid,
    Buffer.from([contador & 0xff, (contador >> 8) & 0xff, (contador >> 16) & 0xff]),
    Buffer.from([0x80]), Buffer.alloc(4),
  ]).subarray(0, 16);
  const c = createCipheriv('aes-128-cbc', claveMeta, Buffer.alloc(16));
  c.setAutoPadding(false);
  return {
    piccData: Buffer.concat([c.update(picc), c.final()]).toString('hex').toUpperCase(),
    cmac: truncarMac(cmac(claveSesion(claveMac, uid, contador), datosExtra)).toString('hex').toUpperCase(),
  };
}
