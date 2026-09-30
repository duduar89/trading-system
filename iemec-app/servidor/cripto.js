'use strict';
// Cifrado de conversaciones, frases de los pacientes y notas: AES-256-GCM con la clave maestra
// CLAVE_CIFRADO (64 hex) del .env del servidor, como las credenciales del TPV en CIFRA. En la base
// solo hay bytes; el texto nunca sale en un log.
const crypto = require('crypto');

const CLAVE_DESARROLLO = '0'.repeat(63) + '1';
let avisado = false;

function clave() {
  const hex = (process.env.CLAVE_CIFRADO || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Falta CLAVE_CIFRADO (64 hex). Genérala con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (!avisado && process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) { console.warn('⚠ Sin CLAVE_CIFRADO: se usa una clave de desarrollo. Nunca en producción.'); avisado = true; }
  return Buffer.from(CLAVE_DESARROLLO, 'hex');
}

// ¿Hay una CLAVE_CIFRADO de verdad (y no la de desarrollo)?
const tieneClave = () => /^[0-9a-fA-F]{64}$/.test((process.env.CLAVE_CIFRADO || '').trim());

function cifrar(texto) {
  if (texto == null) return { cifrado: null, iv: null, tag: null };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const cifrado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return { cifrado, iv, tag: c.getAuthTag() };
}

function descifrar(cifrado, iv, tag) {
  if (!cifrado) return null;
  const d = crypto.createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv));
  d.setAuthTag(Buffer.from(tag));
  return Buffer.concat([d.update(Buffer.from(cifrado)), d.final()]).toString('utf8');
}

module.exports = { cifrar, descifrar, tieneClave };
