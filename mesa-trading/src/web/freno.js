'use strict';
// Freno del login (ARQUITECTURA-WEB W3): 5 fallos por IP en 15 min o 20 por
// usuario en 1 h → 429 con el tiempo de espera.
//
// La cuenta de verdad la lleva la base de datos (src/bd/sesiones.js), porque
// puede haber varios procesos de la web a la vez y cada uno vería solo sus
// intentos. El login usa reservarIntento/resolverIntento: el intento se apunta
// como fallo ANTES de comprobar la clave (y se corrige si entra), así una
// ráfaga de peticiones a la vez no pasa entera mientras dura el primer scrypt. Aquí están la IP del cliente y la regla en sí,
// que usa el almacén en memoria (pruebas y el caso conocido) con los mismos
// números que la base.

const MIN = 60_000;
const FRENO = Object.freeze({
  ip: { fallos: 5, ventanaMs: 15 * MIN },
  usuario: { fallos: 20, ventanaMs: 60 * MIN },
  // Una IP desde la que el usuario entró bien en este tiempo no cuenta para
  // su freno por usuario (ver evaluarFreno). La base guarda los intentos 7 días.
  confianzaMs: 7 * 24 * 60 * MIN,
});

// IP del cliente. LiteSpeed hace de proxy y AÑADE al final de
// X-Forwarded-For la IP desde la que le llega la conexión: ese ÚLTIMO valor es
// el único que no elige el cliente. Los de delante los puede escribir
// cualquiera (curl -H 'X-Forwarded-For: 1.2.3.4'), y fiarse del primero dejaba
// al atacante escoger la IP con la que se le cuenta en el freno. Si LiteSpeed
// sustituyera la cabecera en vez de añadir, el último sigue siendo el bueno.
// Sin esa cabecera (modo local, pruebas), la del socket. Recortada a 64
// caracteres (columna de la base).
function ipDe(req) {
  const xff = req.headers['x-forwarded-for'];
  const valores = (Array.isArray(xff) ? xff.join(',') : String(xff || '')).split(',').map(v => v.trim()).filter(Boolean);
  const ultima = valores.length ? valores[valores.length - 1] : '';
  let ip = ultima || (req.socket && req.socket.remoteAddress) || '';
  ip = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  return ip.slice(0, 64) || 'desconocida';
}

// ¿Frenado? intentos: [{ ip, usuario, t, ok }] (t en ms). Devuelve
// { frenado, esperaSeg }: la espera es lo que falta para que el fallo más
// viejo de la ventana salga de ella y la cuenta baje del tope.
//
// El freno por usuario (20 en 1 h) no se aplica a una IP desde la que ese
// usuario ya entró bien en los últimos 7 días (un acierto en `intentos`): si
// no, cualquiera que sepa el nombre dejaría a Eduardo fuera de su propio panel
// con 20 fallos desde IPs cualesquiera, cada hora. A esa IP le sigue valiendo
// el freno por IP (5 en 15 min).
function evaluarFreno(intentos, { ip, usuario, ahora }) {
  let espera = 0;
  const mirar = (filtro, { fallos, ventanaMs }) => {
    const dentro = intentos.filter(i => !i.ok && filtro(i) && i.t > ahora - ventanaMs).map(i => i.t).sort((a, b) => a - b);
    if (dentro.length < fallos) return;
    // Hay que esperar a que salgan los que sobran: el (n − tope + 1)-ésimo más viejo.
    const clave = dentro[dentro.length - fallos];
    espera = Math.max(espera, clave + ventanaMs - ahora);
  };
  mirar(i => i.ip === ip, FRENO.ip);
  if (usuario && !ipDeConfianza(intentos, { ip, usuario, ahora })) mirar(i => i.usuario === usuario, FRENO.usuario);
  return { frenado: espera > 0, esperaSeg: Math.max(0, Math.ceil(espera / 1000)) };
}

// ¿Entró bien este usuario desde esta IP en la ventana de confianza?
function ipDeConfianza(intentos, { ip, usuario, ahora }) {
  return intentos.some(i => i.ok && i.ip === ip && i.usuario === usuario && i.t > ahora - FRENO.confianzaMs);
}

function textoEspera(seg) {
  const s = Math.max(1, Math.ceil(seg));
  if (s < 90) return `${s} s`;
  return `${Math.ceil(s / 60)} min`;
}

module.exports = { ipDe, evaluarFreno, ipDeConfianza, textoEspera, FRENO };
