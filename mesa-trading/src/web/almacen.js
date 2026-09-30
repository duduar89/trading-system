'use strict';
// Dónde viven usuarios, sesiones e intentos de login para la web.
//
// - almacenBD(entorno): el de verdad, sobre MariaDB con los módulos de
//   src/bd/ (contrato W4). Se cargan al pedirlo, no al requerir este fichero:
//   el modo local y las pruebas de la web no los necesitan.
// - almacenMemoria(): las mismas funciones en memoria, con las mismas reglas
//   (scrypt N=2^15 r=8 p=1 con sal de 16 bytes, token de 32 bytes guardado por
//   su SHA-256, 30 días, freno 5/15 min por IP y 20/1 h por usuario). Lo usan
//   las pruebas y scripts/probar-web.js. Nunca en producción: con varios
//   procesos, cada uno tendría sus propias sesiones.
//
// Las dos devuelven { comprobarClave, crearSesion, leerSesion, cerrarSesion,
// anotarIntento, frenado, reservarIntento, resolverIntento } sin el `pool`
// delante. El login usa las dos últimas (ver src/bd/sesiones.js).

const crypto = require('crypto');
const { evaluarFreno } = require('./freno');

const DURACION_SESION_MS = 30 * 24 * 3600 * 1000;
const SCRYPT = Object.freeze({ N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function almacenBD(entorno = process.env) {
  const { configuracionBD, obtenerPool } = require('../bd/conexion');
  const cfg = configuracionBD(entorno);
  if (!cfg) return null;
  const usuarios = require('../bd/usuarios');
  const sesiones = require('../bd/sesiones');
  const pool = () => {
    const p = obtenerPool(cfg);
    if (!p) throw new Error('sin conexión con la base de datos');
    return p;
  };
  return {
    tipo: 'bd',
    comprobarClave: d => usuarios.comprobarClave(pool(), d),
    crearSesion: d => sesiones.crearSesion(pool(), d),
    leerSesion: token => sesiones.leerSesion(pool(), token),
    cerrarSesion: token => sesiones.cerrarSesion(pool(), token),
    anotarIntento: d => sesiones.anotarIntento(pool(), d),
    frenado: d => sesiones.frenado(pool(), d),
    reservarIntento: d => sesiones.reservarIntento(pool(), d),
    resolverIntento: d => sesiones.resolverIntento(pool(), d),
    // Alta por enlace de un solo uso: crea el usuario o, si ya existe, le
    // cambia la contraseña (y cierra sus sesiones).
    async darDeAlta({ usuario, clave }) {
      try { return { ...(await usuarios.crearUsuario(pool(), { usuario, clave })), nuevo: true }; } catch (e) {
        if (e.code !== 'EXISTE') throw e;
        return { ...(await usuarios.cambiarClave(pool(), { usuario, clave })), nuevo: false };
      }
    },
  };
}

function scrypt(clave, sal) {
  return new Promise((resolver, rechazar) => {
    crypto.scrypt(String(clave), sal, 64, SCRYPT, (e, k) => (e ? rechazar(e) : resolver(k)));
  });
}

const sha256 = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// `ahora`: reloj de infraestructura (caducidad de sesiones y freno), no de la mesa.
function almacenMemoria({ ahora = () => Date.now() } = {}) {
  const usuarios = new Map();     // usuario → { id, hash: 'scrypt$sal$clave' }
  const sesiones = new Map();     // sha256(token) → { usuarioId, usuario, expira, ultima }
  const intentos = [];            // { ip, usuario, t, ok }
  let siguienteId = 1;
  let siguienteIntento = 1;
  let hashFalso = null;           // para gastar lo mismo con un usuario que no existe

  async function hashDe(clave) {
    const sal = crypto.randomBytes(16);
    const k = await scrypt(clave, sal);
    return `scrypt$${sal.toString('base64')}$${k.toString('base64')}`;
  }

  async function coincide(hash, clave) {
    const [, salB64, kB64] = String(hash).split('$');
    const esperado = Buffer.from(kB64 || '', 'base64');
    const k = await scrypt(clave, Buffer.from(salB64 || '', 'base64'));
    return esperado.length === k.length && crypto.timingSafeEqual(esperado, k);
  }

  return {
    tipo: 'memoria',
    async crearUsuario({ usuario, clave }) {
      if (!usuario || !clave) throw new Error('usuario y clave obligatorios');
      if (usuarios.has(usuario)) throw new Error(`el usuario ${usuario} ya existe`);
      const id = siguienteId++;
      usuarios.set(usuario, { id, hash: await hashDe(clave) });
      return { usuarioId: id };
    },
    async darDeAlta({ usuario, clave }) {
      const { validarUsuario, validarClave } = require('../bd/usuarios');
      const u = validarUsuario(usuario);
      const c = validarClave(clave);
      const existente = usuarios.get(u);
      if (existente) {
        existente.hash = await hashDe(c);
        for (const [k, v] of sesiones) if (v.usuarioId === existente.id) sesiones.delete(k);
        return { usuarioId: existente.id, nuevo: false };
      }
      const id = siguienteId++;
      usuarios.set(u, { id, hash: await hashDe(c) });
      return { usuarioId: id, nuevo: true };
    },
    async comprobarClave({ usuario, clave }) {
      const u = usuarios.get(String(usuario || ''));
      if (!u) {
        if (!hashFalso) hashFalso = await hashDe('nadie');
        await coincide(hashFalso, String(clave || ''));
        return { ok: false, usuarioId: null };
      }
      const ok = await coincide(u.hash, String(clave || ''));
      return { ok, usuarioId: ok ? u.id : null };
    },
    async crearSesion({ usuarioId }) {
      const token = crypto.randomBytes(32).toString('base64url');
      const t = ahora();
      const usuario = [...usuarios.entries()].find(([, u]) => u.id === usuarioId);
      const expira = t + DURACION_SESION_MS;
      sesiones.set(sha256(token), { usuarioId, usuario: usuario ? usuario[0] : null, expira, ultima: t });
      return { token, expira };
    },
    async leerSesion(token) {
      const s = sesiones.get(sha256(token));
      if (!s) return null;
      const t = ahora();
      if (s.expira <= t) { sesiones.delete(sha256(token)); return null; }
      if (t - s.ultima >= 60_000) s.ultima = t;   // como mucho una vez por minuto
      return { usuarioId: s.usuarioId, usuario: s.usuario, expira: s.expira };
    },
    async cerrarSesion(token) { sesiones.delete(sha256(token)); },
    async anotarIntento({ ip, usuario, ok }) { intentos.push({ ip, usuario, ok: Boolean(ok), t: ahora() }); },
    async frenado({ ip, usuario }) { return evaluarFreno(intentos, { ip, usuario, ahora: ahora() }); },
    // Mirar el freno y apuntar el intento como fallo van en el mismo turno
    // (sin await entre medias): dos peticiones a la vez no ven la misma cuenta.
    async reservarIntento({ ip, usuario }) {
      const t = ahora();
      const f = evaluarFreno(intentos, { ip, usuario, ahora: t });
      if (f.frenado) return { ...f, id: null };
      const id = siguienteIntento++;
      intentos.push({ id, ip, usuario, ok: false, t });
      return { ...f, id };
    },
    async resolverIntento({ id, ok }) {
      const i = intentos.find(x => x.id === id);
      if (i) i.ok = Boolean(ok);
    },
    _sesiones: sesiones,
    _intentos: intentos,
  };
}

module.exports = { almacenBD, almacenMemoria, DURACION_SESION_MS, SCRYPT };
