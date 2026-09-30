import { startRegistration, startAuthentication, browserSupportsWebAuthn, sendSignal } from '@simplewebauthn/browser';
import { api } from './api.js';

// Passkeys desde el navegador (con @simplewebauthn/browser): el servidor da las opciones y el reto,
// el dispositivo pide la huella, la cara o el PIN, y la respuesta firmada vuelve al servidor.

// Por qué aquí no se pueden usar passkeys, o null si se puede. Sin https (salvo en localhost) el
// navegador ni siquiera ofrece WebAuthn: pasa si se abre el panel por la IP de la red de la clínica.
export function motivoSinPasskeys() {
  if (!window.isSecureContext) return 'Las passkeys solo funcionan en la dirección segura del panel (https).';
  if (!browserSupportsWebAuthn()) return 'Este navegador no admite passkeys. Usa Safari, Chrome o Edge actualizados.';
  return null;
}
export const hayPasskeys = () => !motivoSinPasskeys();

// Un nombre para reconocer la passkey en «Equipo» («iPhone», «Mac»…). La persona lo puede cambiar.
export function nombreDeEsteDispositivo() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Móvil Android' : 'Tablet Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Ordenador con Windows';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Ordenador con Linux';
  return 'Este dispositivo';
}

// Lo que dice el navegador cuando algo no va, en palabras de la clínica. La librería da un código y
// conserva el nombre del error del navegador (NotAllowedError al cancelar, por ejemplo).
const MENSAJES = [
  [['ERROR_CEREMONY_ABORTED', 'NotAllowedError', 'AbortError'], 'Se ha cancelado o ha pasado el tiempo. Vuelve a intentarlo.'],
  [['ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', 'InvalidStateError'], 'Este dispositivo ya tiene una passkey tuya para el panel: úsala para entrar.'],
  [['ERROR_INVALID_DOMAIN', 'ERROR_INVALID_RP_ID', 'SecurityError'], 'Las passkeys solo funcionan en la dirección segura del panel (https).'],
  [['ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT', 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG', 'NotSupportedError'],
    'Este dispositivo no puede guardar una passkey. Prueba con el móvil o con otro navegador.'],
];
function mensaje(err) {
  const [, texto] = MENSAJES.find(([claves]) => claves.includes(err?.code) || claves.includes(err?.name)) || [];
  return texto || 'No se ha podido usar la passkey. Vuelve a intentarlo.';
}

async function crear(opciones) {
  try { return await startRegistration({ optionsJSON: opciones }); } catch (err) { throw new Error(mensaje(err), { cause: err }); }
}

export async function entrarConPasskey() {
  const opciones = await api('/acceso/entrar/opciones', { metodo: 'POST', cuerpo: {} });
  let respuesta;
  try { respuesta = await startAuthentication({ optionsJSON: opciones }); } catch (err) { throw new Error(mensaje(err), { cause: err }); }
  try {
    return await api('/acceso/entrar', { metodo: 'POST', cuerpo: { respuesta } });
  } catch (err) {
    // Una passkey que ya no está dada de alta (se borró): que el navegador deje de ofrecerla.
    if (err.codigo === 'CREDENCIAL_DESCONOCIDA' && err.datos?.rpID) {
      sendSignal({ signalName: 'unknownCredential', rpID: err.datos.rpID, credentialID: respuesta.id }).catch(() => {});
    }
    throw err;
  }
}

// Con el enlace de alta: crea la passkey y deja a la persona dentro.
export async function crearPasskeyConEnlace(token, dispositivo) {
  const opciones = await api('/acceso/alta/opciones', { metodo: 'POST', cuerpo: { token } });
  const respuesta = await crear(opciones);
  return api('/acceso/alta', { metodo: 'POST', cuerpo: { token, respuesta, dispositivo } });
}

// Una passkey más, en este dispositivo, para quien ya ha entrado.
export async function anadirPasskey(dispositivo) {
  const opciones = await api('/panel/passkeys/opciones', { metodo: 'POST', cuerpo: {} });
  const respuesta = await crear(opciones);
  return api('/panel/passkeys', { metodo: 'POST', cuerpo: { respuesta, dispositivo } });
}
