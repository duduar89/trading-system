'use strict';
// Autenticador simulado para las pruebas de passkeys: hace lo que hace el del móvil con las opciones
// que da el servidor. Crea credenciales ES256 (P-256) con su clave privada, que nunca sale de aquí, y
// firma los retos con su contador. Las respuestas tienen el formato de @simplewebauthn/browser. Se
// pueden torcer (otro origen, otro reto, el contador que no avanza, el userHandle de otro…) para ver
// que el servidor las rechaza.
const crypto = require('crypto');
const { isoCBOR } = require('@simplewebauthn/server/helpers');

const b64 = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
// Banderas de los datos del autenticador: presencia (UP), verificación (UV), datos de credencial (AT).
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

class Autenticador {
  constructor({ origen = 'http://localhost:3004' } = {}) {
    this.origen = origen;
    this.credenciales = [];
  }

  // Respuesta a navigator.credentials.create(opciones). Guarda la credencial (con el userHandle que
  // da el servidor) para firmar después.
  registrar(opciones, { origen = this.origen, id = crypto.randomBytes(16), uv = true, contador = 0, tipo = 'webauthn.create', reto = opciones.challenge } = {}) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const authData = Buffer.concat([
      sha256(opciones.rp.id), Buffer.from([UP | (uv ? UV : 0) | AT]), u32(contador), Buffer.alloc(16), u16(id.length), id, Buffer.from(cose),
    ]);
    const cliente = Buffer.from(JSON.stringify({ type: tipo, challenge: reto, origin: origen, crossOrigin: false }));
    const atestacion = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    const credencial = { id: b64(id), rpId: opciones.rp.id, clave: privateKey, contador, userHandle: opciones.user.id };
    this.credenciales.push(credencial);
    return {
      id: credencial.id, rawId: credencial.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: b64(cliente), attestationObject: b64(atestacion), transports: ['internal', 'hybrid'] },
    };
  }

  // Respuesta a navigator.credentials.get(opciones) con una credencial (por defecto, la última). El
  // contador sube uno cada vez, salvo que se diga otro (o 0, como las passkeys sincronizadas).
  firmar(opciones, { credencial = this.credenciales.at(-1), origen = this.origen, contador, uv = true, userHandle = credencial.userHandle, clave = credencial.clave, rpId = opciones.rpId || credencial.rpId, reto = opciones.challenge } = {}) {
    credencial.contador = contador ?? credencial.contador + 1;
    const authData = Buffer.concat([sha256(rpId), Buffer.from([UP | (uv ? UV : 0)]), u32(credencial.contador)]);
    const cliente = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: reto, origin: origen, crossOrigin: false }));
    const firma = crypto.sign('sha256', Buffer.concat([authData, sha256(cliente)]), clave);
    return {
      id: credencial.id, rawId: credencial.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: b64(cliente), authenticatorData: b64(authData), signature: b64(firma), userHandle },
    };
  }
}

module.exports = { Autenticador };
