'use strict';
// Acceso del personal al panel con passkeys (WebAuthn, con @simplewebauthn/server):
//   · Alta por invitación: dirección da de alta a la persona (usuario con su rol) y le pasa un enlace
//     de un solo uso que caduca a las 24 h; en la base solo queda la huella SHA-256 del token. Al
//     abrirlo, la persona registra su passkey y ya está dentro.
//   · Entrar: el navegador ofrece las passkeys de la clínica que tiene (credenciales descubribles: no
//     hay que escribir el correo, así que tampoco se puede averiguar si un correo existe). Se comprueba
//     la firma con la clave pública guardada, que la passkey sea de esa persona y que el contador
//     avance.
//   · Varias passkeys por persona, borrar una perdida y desactivar usuarios. Administración gestiona
//     el equipo, pero a quien es de dirección (y el rol de dirección) solo lo toca dirección: un enlace
//     nuevo o una passkey borrada serían quedarse con su cuenta. Por lo mismo, una cuenta de dirección
//     solo se estrena con un enlace que dio dirección (o la consola): al pasar a dirección, los que dio
//     administración se anulan. Siempre queda alguien de dirección.
//   · PANEL_CLAVE: solo acceso de emergencia de dirección, con cada uso en eventos.
// El RP ID y el origen salen de URL_PUBLICA. Los retos se guardan en la base, caducan a los 5 minutos y
// se gastan al usarlos. userVerification «preferred» y sin atestación: no se pide ni se guarda qué
// aparato es.
const crypto = require('crypto');
const W = require('@simplewebauthn/server');
const config = require('./config');
const { transaccion } = require('./db');
const { registrar } = require('./eventos');
const { ROLES, NOMBRE_ROL } = require('./permisos');
const { origenesPermitidos, igualesSeguro, huellaIp, purgarLimites } = require('./seguridad');

const INVITACION_MS = 24 * 3600 * 1000;
const RETO_MS = 5 * 60 * 1000;
const ESPERA_NAVEGADOR_MS = 3 * 60 * 1000; // lo que el navegador espera a que la persona use su passkey
const ALGORITMOS = [-8, -7, -257]; // EdDSA, ES256 y RS256: los de todos los autenticadores de hoy
const TRANSPORTES = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'];
const LARGO_MINIMO_CLAVE = 16;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const MOTIVOS = {
  EMAIL_NO_VALIDO: [400, 'Ese correo no parece válido.'],
  NOMBRE_VACIO: [400, 'Falta el nombre (hasta 120 caracteres).'],
  ROL_DESCONOCIDO: [400, 'Ese rol no existe.'],
  EMAIL_EN_USO: [409, 'Ya hay alguien del equipo con ese correo.'],
  USUARIO_DESCONOCIDO: [404, 'No existe esa persona en el equipo.'],
  USUARIO_INACTIVO: [409, 'Esa persona está desactivada: reactívala antes de mandarle un enlace.'],
  NO_A_TI_MISMO: [409, 'No puedes desactivarte a ti mismo.'],
  ULTIMA_DIRECCION: [409, 'Tiene que quedar al menos una persona activa de dirección.'],
  SOLO_DIRECCION: [403, 'A las personas de dirección, y el rol de dirección, solo los gestiona dirección.'],
  INVITACION_NO_VALE: [410, 'Este enlace no es válido. Pide uno nuevo a dirección.'],
  INVITACION_SUSTITUIDA: [410, 'Este enlace se ha sustituido por otro más reciente: usa el último que te han mandado.'],
  INVITACION_ANULADA: [410, 'Este enlace ya no vale. Pide uno nuevo a dirección.'],
  INVITACION_USADA: [410, 'Este enlace ya se ha usado. Si necesitas otra passkey, pide un enlace nuevo a dirección.'],
  INVITACION_CADUCADA: [410, 'Este enlace ha caducado (dura 24 horas). Pide uno nuevo a dirección.'],
  RETO_NO_VALE: [400, 'Esa respuesta ya se ha usado o no es de este panel. Vuelve a intentarlo.'],
  RETO_CADUCADO: [400, 'Se ha pasado el tiempo. Vuelve a intentarlo.'],
  PASSKEY_NO_VALE: [401, 'No se ha podido comprobar la passkey. Vuelve a intentarlo.'],
  PASSKEY_DE_OTRO: [401, 'No se ha podido comprobar la passkey. Vuelve a intentarlo.'],
  CREDENCIAL_DESCONOCIDA: [401, 'Esa passkey no está dada de alta en el panel (puede que se borrara). Usa otra o pide un enlace nuevo a dirección.'],
  CREDENCIAL_EN_USO: [409, 'Esa passkey ya está dada de alta.'],
  CONTADOR: [401, 'Esa passkey no se puede usar: su contador no ha avanzado y podría ser una copia. Avisa a dirección.'],
  ACCESO_DESACTIVADO: [403, 'Tu acceso al panel está desactivado. Habla con dirección.'],
  PASSKEY_DESCONOCIDA: [404, 'No existe esa passkey.'],
  EMERGENCIA_NO_CONFIGURADA: [404, 'El acceso de emergencia no está activado en este servidor.'],
  CLAVE_INCORRECTA: [401, 'Correo o clave incorrectos.'],
};

class ErrorAcceso extends Error {
  constructor(codigo, causa) {
    const [estado, mensaje] = MOTIVOS[codigo];
    super(mensaje);
    Object.assign(this, { codigo, estado, causa });
  }
}
const fallo = (codigo, causa) => new ErrorAcceso(codigo, causa);

// actorRol: el rol de quien lo hace desde el panel; sin él, la consola del servidor (scripts/invitar.js),
// que puede con todo.
function soloDireccion(actorRol, ...roles) {
  if (actorRol && actorRol !== 'direccion' && roles.includes('direccion')) throw fallo('SOLO_DIRECCION');
}

// Las transacciones de este módulo, una vez más si MariaDB deshace una por un bloqueo cruzado con otra
// (ER_LOCK_DEADLOCK): así llega la respuesta de verdad (p. ej., «tiene que quedar alguien de dirección»)
// en vez de un 500. Aquí solo se toca la base, así que repetirla no hace nada dos veces.
async function enTransaccion(fn, pool) {
  for (let intento = 1; ; intento++) {
    try {
      return await transaccion(fn, pool);
    } catch (err) {
      if (intento < 2 && err.code === 'ER_LOCK_DEADLOCK') continue;
      throw err;
    }
  }
}

// ── Utilidades ──────────────────────────────────────────────────────────────────────────────
const huella = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const nuevoIdWebauthn = () => crypto.randomBytes(16).toString('base64url');
const normalizarEmail = (e) => String(e ?? '').trim().toLowerCase();
const url = () => new URL(process.env.URL_PUBLICA || config.urlPublica);

function rp() {
  return { nombre: 'IEMEC · Panel de la clínica', id: url().hostname, origenes: origenesPermitidos() };
}

const enlaceDeAlta = (token) => `${url().origin}/#alta/${token}`;

function nombreDispositivo(texto) {
  // eslint-disable-next-line no-control-regex
  const limpio = String(texto ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return limpio || 'Passkey';
}

const transportes = (valor) => {
  const lista = typeof valor === 'string' ? JSON.parse(valor) : valor;
  return Array.isArray(lista) ? lista.filter((t) => TRANSPORTES.includes(t)) : [];
};

// El reto que firmó el autenticador, leído de la respuesta (clientDataJSON).
function retoDe(respuesta) {
  try {
    const datos = JSON.parse(Buffer.from(String(respuesta?.response?.clientDataJSON ?? ''), 'base64url').toString('utf8'));
    return typeof datos.challenge === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(datos.challenge) ? datos.challenge : null;
  } catch {
    return null;
  }
}

// ── Retos de un solo uso ────────────────────────────────────────────────────────────────────
async function guardarReto(con, { reto, proposito, usuarioId = null, invitacionId = null, ahora }) {
  await con.query('INSERT INTO retos_webauthn (reto, proposito, usuario_id, invitacion_id, caduca_en) VALUES (?, ?, ?, ?, ?)',
    [reto, proposito, usuarioId, invitacionId, new Date(ahora.getTime() + RETO_MS)]);
}

// Se borra al leerlo (DELETE … RETURNING): ni una respuesta repetida ni dos peticiones a la vez pueden
// usar el mismo reto. Uno de otro propósito (el de entrar, en un alta) tampoco vale.
async function gastarReto(con, respuesta, { proposito, ahora }) {
  const reto = retoDe(respuesta);
  if (!reto) throw fallo('RETO_NO_VALE');
  const [[f]] = await con.query('DELETE FROM retos_webauthn WHERE reto = ? RETURNING proposito, usuario_id, invitacion_id, caduca_en', [reto]);
  if (!f || f.proposito !== proposito) throw fallo('RETO_NO_VALE');
  if (new Date(f.caduca_en) <= ahora) throw fallo('RETO_CADUCADO');
  return { reto, usuarioId: f.usuario_id, invitacionId: f.invitacion_id };
}

// ── Usuarios e invitaciones ─────────────────────────────────────────────────────────────────
// Guarda el rol de quien da el enlace (sin rol, la consola): una cuenta de dirección solo se estrena con
// uno de dirección.
async function nuevaInvitacion(con, { usuarioId, actor, actorRol = null, ahora }) {
  await con.query('UPDATE invitaciones SET anulada_en = ? WHERE usuario_id = ? AND usada_en IS NULL AND anulada_en IS NULL', [ahora, usuarioId]);
  const token = crypto.randomBytes(32).toString('base64url');
  const caduca = new Date(ahora.getTime() + INVITACION_MS);
  await con.query('INSERT INTO invitaciones (usuario_id, token_huella, caduca_en, creada_por, creada_por_rol, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
    [usuarioId, huella(token), caduca, actor, actorRol, ahora]);
  await registrar(con, { tipo: 'invitacion_creada', entidad: 'usuario', entidadId: usuarioId, actor, datos: { caduca } });
  return { enlace: enlaceDeAlta(token), caduca };
}

// Da de alta a una persona del equipo y devuelve su enlace (el token solo sale aquí, una vez).
async function crearUsuario(pool, { email, nombre, rol, actor, actorRol = null, ahora = new Date() }) {
  const e = normalizarEmail(email);
  const n = String(nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!EMAIL.test(e) || e.length > 160) throw fallo('EMAIL_NO_VALIDO');
  if (!n || n.length > 120) throw fallo('NOMBRE_VACIO');
  if (!ROLES.includes(rol)) throw fallo('ROL_DESCONOCIDO');
  soloDireccion(actorRol, rol);
  return enTransaccion(async (con) => {
    let id;
    try {
      const [r] = await con.query('INSERT INTO usuarios (email, nombre, rol, id_webauthn, creado_en, creado_por) VALUES (?, ?, ?, ?, ?, ?)',
        [e, n, rol, nuevoIdWebauthn(), ahora, actor]);
      id = r.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw fallo('EMAIL_EN_USO');
      throw err;
    }
    await registrar(con, { tipo: 'usuario_creado', entidad: 'usuario', entidadId: id, actor, datos: { rol } });
    return { usuario: { id, email: e, nombre: n, rol }, ...(await nuevaInvitacion(con, { usuarioId: id, actor, actorRol, ahora })) };
  }, pool);
}

// Un enlace nuevo para alguien que ya está (perdió sus passkeys o no llegó a usar el primero). Anula el
// anterior.
async function invitar(pool, { usuarioId, actor, actorRol = null, ahora = new Date() }) {
  return enTransaccion(async (con) => {
    const [[u]] = await con.query('SELECT id, rol, activo FROM usuarios WHERE id = ? FOR UPDATE', [usuarioId]);
    if (!u) throw fallo('USUARIO_DESCONOCIDO');
    soloDireccion(actorRol, u.rol);
    if (!u.activo) throw fallo('USUARIO_INACTIVO');
    return nuevaInvitacion(con, { usuarioId: u.id, actor, actorRol, ahora });
  }, pool);
}

// Un enlace que ya no vale dice por qué: usado, sustituido por otro más reciente, anulado (la persona se
// desactivó, o pasó a dirección y el enlace no lo dio dirección) o caducado. Solo el que no existe es
// INVITACION_NO_VALE, el único que cuenta como intento de colarse (servidor/rutas/acceso.js).
async function leerInvitacion(con, token, ahora, { bloquear = false } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw fallo('INVITACION_NO_VALE');
  const [[i]] = await con.query(
    `SELECT i.id, i.usuario_id, i.caduca_en, i.usada_en, i.anulada_en, i.creada_por_rol, u.email, u.nombre, u.rol, u.activo, u.sesion_version
       FROM invitaciones i JOIN usuarios u ON u.id = i.usuario_id WHERE i.token_huella = ?${bloquear ? ' FOR UPDATE' : ''}`, [huella(token)]);
  if (!i) throw fallo('INVITACION_NO_VALE');
  if (i.usada_en) throw fallo('INVITACION_USADA');
  if (i.anulada_en) {
    const [[otro]] = await con.query('SELECT id FROM invitaciones WHERE usuario_id = ? AND id > ? LIMIT 1', [i.usuario_id, i.id]);
    throw fallo(otro && i.activo ? 'INVITACION_SUSTITUIDA' : 'INVITACION_ANULADA');
  }
  if (!i.activo || (i.rol === 'direccion' && !deDireccion(i))) throw fallo('INVITACION_ANULADA');
  if (new Date(i.caduca_en) <= ahora) throw fallo('INVITACION_CADUCADA');
  return i;
}

// El enlace lo dio dirección o la consola del servidor (sin rol).
const deDireccion = (invitacion) => invitacion.creada_por_rol == null || invitacion.creada_por_rol === 'direccion';

// Lo que ve quien abre el enlace, si todavía vale.
async function verInvitacion(pool, { token, ahora = new Date() }) {
  const i = await leerInvitacion(pool, token, ahora);
  return { nombre: i.nombre, email: i.email, rol: i.rol, rolNombre: NOMBRE_ROL[i.rol], caduca: i.caduca_en };
}

// El usuario con su identificador de WebAuthn (los de antes de la 013 no lo tienen: se le pone uno).
async function usuarioParaRegistro(con, usuarioId) {
  await con.query('UPDATE usuarios SET id_webauthn = ? WHERE id = ? AND id_webauthn IS NULL', [nuevoIdWebauthn(), usuarioId]);
  const [[u]] = await con.query('SELECT id, email, nombre, rol, id_webauthn FROM usuarios WHERE id = ?', [usuarioId]);
  if (!u) throw fallo('USUARIO_DESCONOCIDO');
  return u;
}

async function equipo(pool, { ahora = new Date() } = {}) {
  const [usuarios] = await pool.query(
    `SELECT u.id, u.email, u.nombre, u.rol, u.activo, u.creado_en, u.ultimo_acceso_en, u.desactivado_en,
            (SELECT MAX(i.caduca_en) FROM invitaciones i
              WHERE i.usuario_id = u.id AND i.usada_en IS NULL AND i.anulada_en IS NULL AND i.caduca_en > ?) AS invitacion_hasta
       FROM usuarios u ORDER BY u.activo DESC, u.nombre, u.id`, [ahora]);
  const [pks] = await pool.query('SELECT id, usuario_id, dispositivo, sincronizada, creado_en, ultimo_uso_en FROM passkeys ORDER BY creado_en, id');
  return usuarios.map((u) => ({
    id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, activo: Boolean(u.activo), alta: u.creado_en, ultimoAcceso: u.ultimo_acceso_en,
    desactivado: u.desactivado_en, invitacionHasta: u.invitacion_hasta,
    passkeys: pks.filter((p) => p.usuario_id === u.id).map(passkeyPublica),
  }));
}

const passkeyPublica = (p) => ({ id: p.id, dispositivo: p.dispositivo, sincronizada: Boolean(p.sincronizada), alta: p.creado_en, ultimoUso: p.ultimo_uso_en });

/**
 * Cambia el rol de alguien o lo desactiva (o reactiva). Desactivar corta al momento sus sesiones y
 * anula su enlace pendiente. Nadie se desactiva a sí mismo y siempre queda alguien activo de dirección
 * (que es quien puede con todo el equipo). Al pasar a dirección se anulan los enlaces pendientes que no
 * dio dirección (quien los dio los ha visto) y el evento guarda qué passkeys tenía: alguna la pudo
 * registrar otra persona, y el panel las enseña antes de confirmar el cambio.
 */
async function cambiarUsuario(pool, { id, rol, activo, actor, actorId = null, actorRol = null, ahora = new Date() }) {
  return enTransaccion(async (con) => {
    // El equipo entero (unas pocas filas), bloqueado de una vez y siempre en el mismo orden: dos cambios a
    // la vez se esperan el uno al otro en vez de cruzarse, y «queda alguien de dirección» se cuenta sobre
    // lo que hay de verdad.
    const [todos] = await con.query('SELECT id, rol, activo FROM usuarios ORDER BY id FOR UPDATE');
    const u = todos.find((x) => x.id === id);
    if (!u) throw fallo('USUARIO_DESCONOCIDO');
    const nuevoRol = rol === undefined ? u.rol : rol;
    const nuevoActivo = activo === undefined ? Boolean(u.activo) : Boolean(activo);
    if (!ROLES.includes(nuevoRol)) throw fallo('ROL_DESCONOCIDO');
    soloDireccion(actorRol, u.rol, nuevoRol);
    if (actorId === u.id && !nuevoActivo) throw fallo('NO_A_TI_MISMO');
    const otrosDeDireccion = todos.filter((x) => x.id !== u.id && x.activo && x.rol === 'direccion').length;
    if (u.activo && u.rol === 'direccion' && !(nuevoActivo && nuevoRol === 'direccion') && !otrosDeDireccion) throw fallo('ULTIMA_DIRECCION');
    if (nuevoRol !== u.rol) {
      await con.query('UPDATE usuarios SET rol = ? WHERE id = ?', [nuevoRol, u.id]);
      const datos = { de: u.rol, a: nuevoRol };
      if (nuevoRol === 'direccion') {
        const [anulados] = await con.query(
          `UPDATE invitaciones SET anulada_en = ? WHERE usuario_id = ? AND usada_en IS NULL AND anulada_en IS NULL
              AND creada_por_rol IS NOT NULL AND creada_por_rol <> 'direccion'`, [ahora, u.id]);
        const [suyas] = await con.query('SELECT id FROM passkeys WHERE usuario_id = ? ORDER BY id', [u.id]);
        Object.assign(datos, { enlacesAnulados: anulados.affectedRows, passkeys: suyas.map((p) => p.id) });
      }
      await registrar(con, { tipo: 'usuario_rol_cambiado', entidad: 'usuario', entidadId: u.id, actor, datos });
    }
    if (nuevoActivo !== Boolean(u.activo)) {
      if (nuevoActivo) {
        await con.query('UPDATE usuarios SET activo = TRUE, desactivado_en = NULL WHERE id = ?', [u.id]);
      } else {
        await con.query('UPDATE usuarios SET activo = FALSE, desactivado_en = ?, sesion_version = sesion_version + 1 WHERE id = ?', [ahora, u.id]);
        await con.query('UPDATE invitaciones SET anulada_en = ? WHERE usuario_id = ? AND usada_en IS NULL AND anulada_en IS NULL', [ahora, u.id]);
        await con.query('DELETE FROM retos_webauthn WHERE usuario_id = ?', [u.id]);
      }
      await registrar(con, { tipo: nuevoActivo ? 'usuario_reactivado' : 'usuario_desactivado', entidad: 'usuario', entidadId: u.id, actor });
    }
    return { id: u.id, rol: nuevoRol, activo: nuevoActivo };
  }, pool);
}

// Todas sus sesiones dejan de valer (la versión de la cookie ya no cuadra). Devuelve el usuario con la
// versión nueva, por si hay que dar una cookie nueva a quien lo ha pedido.
async function cerrarSesiones(pool, { id, actor, actorRol = null }) {
  const [[antes]] = await pool.query('SELECT rol FROM usuarios WHERE id = ?', [id]);
  if (!antes) throw fallo('USUARIO_DESCONOCIDO');
  soloDireccion(actorRol, antes.rol);
  await pool.query('UPDATE usuarios SET sesion_version = sesion_version + 1 WHERE id = ?', [id]);
  await registrar(pool, { tipo: 'sesiones_cerradas', entidad: 'usuario', entidadId: id, actor });
  const [[u]] = await pool.query('SELECT id, email, nombre, rol, sesion_version FROM usuarios WHERE id = ?', [id]);
  return u;
}

// ── Passkeys: registrar ─────────────────────────────────────────────────────────────────────
async function opcionesRegistro(con, u, { proposito, invitacionId = null, ahora }) {
  const [suyas] = await con.query('SELECT credencial_id, transportes FROM passkeys WHERE usuario_id = ?', [u.id]);
  const { nombre, id: rpID } = rp();
  const opciones = await W.generateRegistrationOptions({
    rpName: nombre, rpID, userName: u.email, userDisplayName: u.nombre, userID: new Uint8Array(Buffer.from(u.id_webauthn, 'base64url')),
    timeout: ESPERA_NAVEGADOR_MS, attestationType: 'none', supportedAlgorithmIDs: ALGORITMOS,
    // Las que ya tiene no se vuelven a registrar en el mismo aparato.
    excludeCredentials: suyas.map((p) => ({ id: p.credencial_id, transports: transportes(p.transportes) })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  await guardarReto(con, { reto: opciones.challenge, proposito, usuarioId: u.id, invitacionId, ahora });
  return opciones;
}

async function verificarRegistro(respuesta, reto) {
  const { id: rpID, origenes } = rp();
  let v;
  try {
    v = await W.verifyRegistrationResponse({
      response: respuesta, expectedChallenge: reto, expectedOrigin: origenes, expectedRPID: rpID,
      requireUserVerification: false, supportedAlgorithmIDs: ALGORITMOS,
    });
  } catch (err) {
    throw fallo('PASSKEY_NO_VALE', err.message);
  }
  if (!v.verified) throw fallo('PASSKEY_NO_VALE', 'registro sin verificar');
  return v.registrationInfo;
}

async function guardarPasskey(con, { usuarioId, info, dispositivo, actor, ahora }) {
  const c = info.credential;
  let r;
  try {
    [r] = await con.query(
      `INSERT INTO passkeys (usuario_id, credencial_id, clave_publica, contador, transportes, dispositivo, sincronizada, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [usuarioId, c.id, Buffer.from(c.publicKey), c.counter, JSON.stringify(transportes(c.transports)), nombreDispositivo(dispositivo),
        info.credentialDeviceType === 'multiDevice', ahora]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw fallo('CREDENCIAL_EN_USO');
    throw err;
  }
  await registrar(con, { tipo: 'passkey_registrada', entidad: 'usuario', entidadId: usuarioId, actor, datos: { passkey: r.insertId, dispositivo: nombreDispositivo(dispositivo) } });
  return r.insertId;
}

// Alta con el enlace: opciones para navigator.credentials.create…
async function opcionesAlta(pool, { token, ahora = new Date() }) {
  const i = await leerInvitacion(pool, token, ahora);
  return opcionesRegistro(pool, await usuarioParaRegistro(pool, i.usuario_id), { proposito: 'alta', invitacionId: i.id, ahora });
}

// …y la respuesta del navegador: se guarda la passkey, se gasta el enlace y la persona queda dentro.
async function completarAlta(pool, { token, respuesta, dispositivo, ahora = new Date() }) {
  const antes = await leerInvitacion(pool, token, ahora);
  const { reto, invitacionId } = await gastarReto(pool, respuesta, { proposito: 'alta', ahora });
  if (invitacionId !== antes.id) throw fallo('RETO_NO_VALE');
  const info = await verificarRegistro(respuesta, reto);
  return enTransaccion(async (con) => {
    // Otra vez y bloqueada: si dos pestañas completan el alta a la vez, solo vale una, y si mientras tanto
    // le han mandado otro enlace, la han desactivado o ha pasado a dirección, este ya no vale. Primero la
    // persona y después su enlace, en el mismo orden que un enlace nuevo o un cambio de rol: así esas
    // transacciones se esperan en lugar de cruzarse.
    await con.query('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [antes.usuario_id]);
    const i = await leerInvitacion(con, token, ahora, { bloquear: true });
    await con.query('UPDATE invitaciones SET usada_en = ? WHERE id = ?', [ahora, i.id]);
    const passkeyId = await guardarPasskey(con, { usuarioId: i.usuario_id, info, dispositivo, actor: i.email, ahora });
    // Con ella entra ya: cuenta como su primer uso.
    await con.query('UPDATE passkeys SET ultimo_uso_en = ? WHERE id = ?', [ahora, passkeyId]);
    await con.query('UPDATE usuarios SET ultimo_acceso_en = ? WHERE id = ?', [ahora, i.usuario_id]);
    await registrar(con, { tipo: 'sesion_iniciada', entidad: 'usuario', entidadId: i.usuario_id, actor: i.email, datos: { passkey: passkeyId, alta: true } });
    return { usuario: { id: i.usuario_id, email: i.email, nombre: i.nombre, rol: i.rol, sesion_version: i.sesion_version }, passkeyId };
  }, pool);
}

// Una passkey más para quien ya ha entrado (otro aparato).
async function opcionesNuevaPasskey(pool, { usuarioId, ahora = new Date() }) {
  return opcionesRegistro(pool, await usuarioParaRegistro(pool, usuarioId), { proposito: 'nueva_passkey', ahora });
}

async function registrarNuevaPasskey(pool, { usuarioId, respuesta, dispositivo, actor, ahora = new Date() }) {
  const { reto, usuarioId: delReto } = await gastarReto(pool, respuesta, { proposito: 'nueva_passkey', ahora });
  if (delReto !== usuarioId) throw fallo('RETO_NO_VALE');
  const info = await verificarRegistro(respuesta, reto);
  const id = await enTransaccion((con) => guardarPasskey(con, { usuarioId, info, dispositivo, actor, ahora }), pool);
  const [[p]] = await pool.query('SELECT id, dispositivo, sincronizada, creado_en, ultimo_uso_en FROM passkeys WHERE id = ?', [id]);
  return passkeyPublica(p);
}

async function passkeysDe(pool, usuarioId) {
  const [filas] = await pool.query('SELECT id, dispositivo, sincronizada, creado_en, ultimo_uso_en FROM passkeys WHERE usuario_id = ? ORDER BY creado_en, id', [usuarioId]);
  return filas.map(passkeyPublica);
}

// usuarioId: solo si es de esa persona (la suya, desde «Mis passkeys», o la de quien se elige en
// «Equipo»); sin él, cualquiera.
async function borrarPasskey(pool, { id, usuarioId = null, actor, actorRol = null }) {
  return enTransaccion(async (con) => {
    const [[p]] = await con.query(
      `SELECT p.id, p.usuario_id, p.dispositivo, u.rol FROM passkeys p JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.id = ?${usuarioId == null ? '' : ' AND p.usuario_id = ?'} FOR UPDATE`, usuarioId == null ? [id] : [id, usuarioId]);
    if (!p) throw fallo('PASSKEY_DESCONOCIDA');
    soloDireccion(actorRol, p.rol);
    await con.query('DELETE FROM passkeys WHERE id = ?', [p.id]);
    await registrar(con, { tipo: 'passkey_borrada', entidad: 'usuario', entidadId: p.usuario_id, actor, datos: { passkey: p.id, dispositivo: p.dispositivo } });
    return { id: p.id, usuarioId: p.usuario_id };
  }, pool);
}

// ── Passkeys: entrar ────────────────────────────────────────────────────────────────────────
async function opcionesEntrar(pool, { ahora = new Date() } = {}) {
  const opciones = await W.generateAuthenticationOptions({ rpID: rp().id, userVerification: 'preferred', timeout: ESPERA_NAVEGADOR_MS });
  await guardarReto(pool, { reto: opciones.challenge, proposito: 'entrar', ahora });
  return opciones;
}

async function verificarEntrada(pool, { respuesta, ahora = new Date() }) {
  const { reto } = await gastarReto(pool, respuesta, { proposito: 'entrar', ahora });
  // El id de la credencial va en base64url (y se busca en una columna ascii): lo demás no es de un
  // autenticador y no llega a la base.
  const credencial = respuesta?.id;
  if (typeof credencial !== 'string' || !/^[A-Za-z0-9_-]{1,1400}$/.test(credencial)) throw fallo('PASSKEY_NO_VALE', 'id de credencial que no es base64url');
  const [[pk]] = await pool.query(
    `SELECT p.id, p.usuario_id, p.credencial_id, p.clave_publica, p.contador, p.transportes,
            u.email, u.nombre, u.rol, u.activo, u.id_webauthn, u.sesion_version
       FROM passkeys p JOIN usuarios u ON u.id = p.usuario_id WHERE p.credencial_id = ?`, [credencial]);
  if (!pk) throw fallo('CREDENCIAL_DESCONOCIDA');
  // La passkey dice de quién es (userHandle): tiene que ser de la persona que la dio de alta.
  const handle = respuesta.response?.userHandle;
  if (typeof handle !== 'string' || !handle) throw fallo('PASSKEY_NO_VALE', 'sin userHandle');
  if (handle !== pk.id_webauthn) throw fallo('PASSKEY_DE_OTRO');
  const { id: rpID, origenes } = rp();
  let v;
  try {
    // Contador 0 aquí: el contador se mira después, con la firma ya comprobada (si no, cualquiera sin la
    // clave podría hacer saltar la alarma de passkey copiada).
    v = await W.verifyAuthenticationResponse({
      response: respuesta, expectedChallenge: reto, expectedOrigin: origenes, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: pk.credencial_id, publicKey: new Uint8Array(pk.clave_publica), counter: 0, transports: transportes(pk.transportes) },
    });
  } catch (err) {
    throw fallo('PASSKEY_NO_VALE', err.message);
  }
  if (!v.verified) throw fallo('PASSKEY_NO_VALE', 'firma que no cuadra');
  const nuevo = v.authenticationInfo.newCounter;
  if ((nuevo > 0 || pk.contador > 0) && nuevo <= pk.contador) {
    await registrar(pool, { tipo: 'passkey_contador_no_avanza', entidad: 'usuario', entidadId: pk.usuario_id, actor: pk.email, datos: { passkey: pk.id, guardado: pk.contador, recibido: nuevo } });
    throw fallo('CONTADOR');
  }
  if (!pk.activo) {
    await registrar(pool, { tipo: 'acceso_desactivado', entidad: 'usuario', entidadId: pk.usuario_id, actor: pk.email, datos: { passkey: pk.id } });
    throw fallo('ACCESO_DESACTIVADO');
  }
  // Y otra vez al guardarlo, en la misma sentencia: dos entradas a la vez con el mismo contador (la
  // passkey y su copia) no pasan las dos.
  const [avanza] = await pool.query('UPDATE passkeys SET contador = ?, ultimo_uso_en = ? WHERE id = ? AND (contador < ? OR (contador = 0 AND ? = 0))',
    [nuevo, ahora, pk.id, nuevo, nuevo]);
  if (!avanza.affectedRows) {
    await registrar(pool, { tipo: 'passkey_contador_no_avanza', entidad: 'usuario', entidadId: pk.usuario_id, actor: pk.email, datos: { passkey: pk.id, guardado: pk.contador, recibido: nuevo, aLaVez: true } });
    throw fallo('CONTADOR');
  }
  await enTransaccion(async (con) => {
    await con.query('UPDATE usuarios SET ultimo_acceso_en = ? WHERE id = ?', [ahora, pk.usuario_id]);
    await registrar(con, { tipo: 'sesion_iniciada', entidad: 'usuario', entidadId: pk.usuario_id, actor: pk.email, datos: { passkey: pk.id } });
  }, pool);
  return { usuario: { id: pk.usuario_id, email: pk.email, nombre: pk.nombre, rol: pk.rol, sesion_version: pk.sesion_version }, passkeyId: pk.id };
}

// ── Emergencia: PANEL_CLAVE ─────────────────────────────────────────────────────────────────
const claveEmergencia = () => {
  const c = process.env.PANEL_CLAVE || '';
  return c.length >= LARGO_MINIMO_CLAVE ? c : null;
};

// Solo dirección, con la clave del servidor. Cada uso (y cada intento fallido) queda en eventos, con la
// huella de la IP (no la IP) para ver qué intentos vienen del mismo sitio. La respuesta es la misma si
// el correo no existe, si no es de dirección o si la clave no cuadra.
async function entrarConClave(pool, { email, clave, ip = null, ahora = new Date() }) {
  const buena = claveEmergencia();
  if (!buena) throw fallo('EMERGENCIA_NO_CONFIGURADA');
  const e = normalizarEmail(email).slice(0, 160);
  const claveOk = typeof clave === 'string' && igualesSeguro(clave, buena);
  const [[u]] = await pool.query('SELECT id, email, nombre, rol, activo, sesion_version FROM usuarios WHERE email = ?', [e]);
  const motivo = !claveOk ? 'clave' : !u ? 'correo' : !u.activo ? 'desactivado' : u.rol !== 'direccion' ? 'rol' : null;
  if (motivo) {
    await registrar(pool, { tipo: 'acceso_emergencia_fallido', entidad: 'usuario', entidadId: u?.id ?? null, actor: 'desconocido', datos: { motivo, ip: huellaIp(ip) } });
    throw fallo('CLAVE_INCORRECTA');
  }
  await enTransaccion(async (con) => {
    await con.query('UPDATE usuarios SET ultimo_acceso_en = ? WHERE id = ?', [ahora, u.id]);
    await registrar(con, { tipo: 'acceso_emergencia', entidad: 'usuario', entidadId: u.id, actor: u.email, datos: { ip: huellaIp(ip) } });
  }, pool);
  return { usuario: u };
}

// Lo que se avisa al arrancar el servidor (lo imprime servidor/index.js).
function avisosDeArranque(entorno = process.env) {
  const avisos = [];
  const produccion = entorno.NODE_ENV === 'production';
  const clave = entorno.PANEL_CLAVE || '';
  if (clave && clave.length < LARGO_MINIMO_CLAVE) avisos.push(`⚠ PANEL_CLAVE tiene menos de ${LARGO_MINIMO_CLAVE} caracteres: el acceso de emergencia está desactivado.`);
  else if (clave && produccion) avisos.push('⚠ PANEL_CLAVE está puesta: solo vale como acceso de emergencia de dirección y cada uso queda en eventos. Quítala del .env cuando todo el equipo tenga su passkey.');
  if (produccion && !/^https:\/\//.test(entorno.URL_PUBLICA || '')) avisos.push('⚠ URL_PUBLICA no es https: las passkeys solo funcionan con https (o en localhost).');
  if (produccion && entorno.MODO_DEMO === '1') avisos.push('⚠ MODO_DEMO=1 no hace nada en producción: se entra con passkey.');
  return avisos;
}

// Lo caducado, cada minuto desde el cron.
async function purgar(pool, ahora = new Date()) {
  const [r] = await pool.query('DELETE FROM retos_webauthn WHERE caduca_en <= ?', [ahora]);
  return r.affectedRows + await purgarLimites(pool, ahora);
}

module.exports = {
  ErrorAcceso, rp, enlaceDeAlta, crearUsuario, invitar, verInvitacion, equipo, cambiarUsuario, cerrarSesiones,
  opcionesAlta, completarAlta, opcionesNuevaPasskey, registrarNuevaPasskey, passkeysDe, borrarPasskey,
  opcionesEntrar, verificarEntrada, entrarConClave, hayClaveEmergencia: () => Boolean(claveEmergencia()), avisosDeArranque, purgar,
  DURACION: { INVITACION_MS, RETO_MS },
};
