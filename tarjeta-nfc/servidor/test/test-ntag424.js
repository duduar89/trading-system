import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmac, subclaves, truncarMac, verificarSun, simularLectura } from '../ntag424.js';

const hex = (s) => Buffer.from(s.replace(/\s/g, ''), 'hex');

// Vectores oficiales del RFC 4493 (AES-CMAC). Si estos pasan, el CMAC es correcto.
const CLAVE = hex('2b7e151628aed2a6abf7158809cf4f3c');
const M = hex(
  '6bc1bee22e409f96e93d7e117393172a' +
  'ae2d8a571e03ac9c9eb76fac45af8e51' +
  '30c81c46a35ce411e5fbc1191a0a52ef' +
  'f69f2445df4f9b17ad2b417be66c3710');

test('RFC 4493: subclaves K1 y K2', () => {
  const { K1, K2 } = subclaves(CLAVE);
  assert.equal(K1.toString('hex'), 'fbeed618357133667c85e08f7236a8de');
  assert.equal(K2.toString('hex'), 'f7ddac306ae266ccf90bc11ee46d513b');
});

test('RFC 4493 ejemplo 1: mensaje vacio', () => {
  assert.equal(cmac(CLAVE, Buffer.alloc(0)).toString('hex'),
               'bb1d6929e95937287fa37d129b756746');
});

test('RFC 4493 ejemplo 2: 16 bytes (bloque exacto)', () => {
  assert.equal(cmac(CLAVE, M.subarray(0, 16)).toString('hex'),
               '070a16b46b4d4144f79bdd9dd04a287c');
});

test('RFC 4493 ejemplo 3: 40 bytes (bloque incompleto, usa K2)', () => {
  assert.equal(cmac(CLAVE, M.subarray(0, 40)).toString('hex'),
               'dfa66747de9ae63030ca32611497c827');
});

test('RFC 4493 ejemplo 4: 64 bytes', () => {
  assert.equal(cmac(CLAVE, M).toString('hex'),
               '51f0bebf7e3b9d92fc49741779363cfe');
});

test('el MAC truncado son los 8 bytes impares', () => {
  const m = hex('000102030405060708090a0b0c0d0e0f');
  assert.equal(truncarMac(m).toString('hex'), '01030507090b0d0f');
});

// --- SUN: ida y vuelta contra el simulador de este repo ----------------------
// OJO: esto demuestra coherencia interna, no compatibilidad con una tarjeta real.

const K_META = hex('00112233445566778899aabbccddeeff');
const K_MAC = hex('ffeeddccbbaa99887766554433221100');
const UID = hex('04a2b3c4d5e6f7'.slice(0, 14));

test('una lectura valida se acepta y devuelve UID y contador', () => {
  const lectura = simularLectura({ uid: UID, contador: 7, claveMeta: K_META, claveMac: K_MAC });
  const r = verificarSun({ ...lectura, claveMeta: K_META, claveMac: K_MAC, contadorVisto: 6 });
  assert.equal(r.ok, true);
  assert.equal(r.uid, UID.toString('hex').toUpperCase());
  assert.equal(r.contador, 7);
});

test('reenviar una URL ya usada se rechaza por contador repetido', () => {
  const lectura = simularLectura({ uid: UID, contador: 7, claveMeta: K_META, claveMac: K_MAC });
  const r = verificarSun({ ...lectura, claveMeta: K_META, claveMac: K_MAC, contadorVisto: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'contador_repetido');
});

test('un CMAC manipulado se rechaza', () => {
  const lectura = simularLectura({ uid: UID, contador: 9, claveMeta: K_META, claveMac: K_MAC });
  const roto = lectura.cmac.slice(0, -2) + (lectura.cmac.endsWith('00') ? '11' : '00');
  const r = verificarSun({ piccData: lectura.piccData, cmac: roto,
                           claveMeta: K_META, claveMac: K_MAC, contadorVisto: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'firma_invalida');
});

test('una tarjeta con otra clave no pasa', () => {
  const lectura = simularLectura({ uid: UID, contador: 3, claveMeta: K_META, claveMac: K_MAC });
  const r = verificarSun({ ...lectura, claveMeta: hex('0'.repeat(32)), claveMac: K_MAC, contadorVisto: 0 });
  assert.equal(r.ok, false);
});
