// Servidor HTTP sin dependencias: API JSON + los tres HTML del mostrador.
//
//   node servidor/servidor.js --puerto 8080 --db tarjetas.db
//   node servidor/servidor.js --cert cert.pem --clave key.pem     (HTTPS, hace falta
//                                                                  para Web NFC fuera
//                                                                  de localhost)

import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as DB from './db.js';
import { calcularAcumulacion, calcularCanje, calcularCaducidad, normalizarConfig } from './motor-puntos.js';
import { verificarSun } from './ntag424.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(RAIZ, 'web');

const arg = (nombre, defecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defecto;
};

const PUERTO = Number(arg('puerto', 8080));
const RUTA_DB = arg('db', join(RAIZ, 'tarjetas.db'));
const BASE_PUBLICA = arg('base', `http://localhost:${PUERTO}`);
const RUTA_CONFIG = arg('config', join(RAIZ, 'config.json'));

const db = DB.abrir(RUTA_DB);

function cargarConfig() {
  return normalizarConfig(existsSync(RUTA_CONFIG) ? JSON.parse(readFileSync(RUTA_CONFIG, 'utf8')) : {});
}
let config = cargarConfig();

// --- utilidades HTTP ---------------------------------------------------------

const json = (res, codigo, cuerpo) => {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8',
                          'cache-control': 'no-store',
                          'content-length': Buffer.byteLength(texto) });
  res.end(texto);
};

async function leerJson(req) {
  const trozos = [];
  let bytes = 0;
  for await (const t of req) {
    bytes += t.length;
    if (bytes > 64 * 1024) throw new Error('cuerpo demasiado grande');
    trozos.push(t);
  }
  if (!trozos.length) return {};
  return JSON.parse(Buffer.concat(trozos).toString('utf8'));
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.json': 'application/json',
                '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function estatico(res, ruta) {
  const limpia = normalize(ruta).replace(/^(\.\.[/\\])+/, '');
  const fichero = join(WEB, limpia === '/' ? 'staff.html' : limpia);
  if (!fichero.startsWith(WEB)) return json(res, 403, { error: 'ruta no permitida' });
  try {
    const datos = await readFile(fichero);
    res.writeHead(200, { 'content-type': TIPOS[extname(fichero)] ?? 'application/octet-stream' });
    res.end(datos);
  } catch {
    json(res, 404, { error: 'no encontrado' });
  }
}

// --- sesiones de empleado ----------------------------------------------------

function autenticar(req) {
  const cabecera = req.headers.authorization ?? '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return null;
  const sesion = db.prepare('SELECT * FROM sesiones WHERE token = ?').get(token);
  if (!sesion || Date.parse(sesion.expira_ts) < Date.now()) return null;
  return db.prepare('SELECT * FROM staff WHERE id = ? AND activo = 1').get(sesion.staff_id) ?? null;
}

// Un PIN de 4 digitos se adivina en 10.000 intentos. Limitamos por IP.
const intentos = new Map();
function demasiadosIntentos(ip) {
  const ahora = Date.now();
  const previos = (intentos.get(ip) ?? []).filter((t) => ahora - t < 15 * 60_000);
  previos.push(ahora);
  intentos.set(ip, previos);
  return previos.length > 10;
}

// --- rutas de la API ---------------------------------------------------------

const rutas = {
  'POST /api/sesion': async (req, res) => {
    const ip = req.socket.remoteAddress ?? '?';
    if (demasiadosIntentos(ip)) return json(res, 429, { error: 'demasiados intentos, espera 15 min' });
    const { pin } = await leerJson(req);
    const empleados = db.prepare('SELECT * FROM staff WHERE activo = 1').all();
    const quien = empleados.find((e) => DB.pinCorrecto(String(pin ?? ''), e.salt, e.pin_hash));
    if (!quien) return json(res, 401, { error: 'PIN incorrecto' });
    const token = randomBytes(24).toString('base64url');
    const expira = new Date(Date.now() + 12 * 3600_000).toISOString();
    db.prepare('INSERT INTO sesiones (token, staff_id, expira_ts) VALUES (?, ?, ?)')
      .run(token, quien.id, expira);
    json(res, 200, { token, expira, staff: { id: quien.id, nombre: quien.nombre, rol: quien.rol } });
  },

  'GET /api/config': (req, res) => json(res, 200, {
    modo: config.modo,
    objetivo_sellos: config.sellos.objetivo,
    importe_minimo_cents: config.sellos.importe_minimo_cents,
    puntos_por_euro: config.puntos_por_euro,
    caducidad_meses: config.caducidad_meses,
    recompensas: db.prepare('SELECT id, nombre, coste_puntos FROM recompensas WHERE activa = 1 ORDER BY coste_puntos').all(),
  }),

  // Alta: crea cliente y le asocia la tarjeta fisica que se acaba de leer.
  'POST /api/tarjetas': async (req, res, empleado) => {
    if (!empleado) return json(res, 401, { error: 'sesión requerida' });
    const d = await leerJson(req);
    if (!d.uid) return json(res, 400, { error: 'falta el UID de la tarjeta' });
    if (!d.nombre) return json(res, 400, { error: 'falta el nombre' });
    if (DB.tarjetaPorUid(db, d.uid)) return json(res, 409, { error: 'esa tarjeta ya está dada de alta' });

    const ahora = new Date().toISOString();
    const infoCliente = db.prepare(
      'INSERT INTO clientes (nombre, telefono, email, fecha_nacimiento, consentimiento_marketing, alta_ts) ' +
      'VALUES (?, ?, ?, ?, ?, ?)'
    ).run(d.nombre.trim(), d.telefono ?? null, d.email ?? null, d.fecha_nacimiento ?? null,
          d.consentimiento_marketing ? 1 : 0, ahora);
    const clienteId = Number(infoCliente.lastInsertRowid);

    const token = DB.nuevoToken();
    const infoTarjeta = db.prepare(
      'INSERT INTO tarjetas (uid_hash, token, cliente_id, clave_424, alta_ts) VALUES (?, ?, ?, ?, ?)'
    ).run(DB.hashUid(db, d.uid), token, clienteId, d.clave_424 ?? null, ahora);

    const tarjetaId = Number(infoTarjeta.lastInsertRowid);
    const bienvenida = Number(config.puntos_bienvenida ?? 0);
    if (bienvenida > 0) {
      DB.anotar(db, { cliente_id: clienteId, tarjeta_id: tarjetaId, tipo: 'alta',
                      puntos: bienvenida, concepto: 'Puntos de bienvenida',
                      staff_id: empleado.id, ts: ahora });
    }
    json(res, 201, {
      cliente_id: clienteId, tarjeta_id: tarjetaId, token,
      url_ndef: `${BASE_PUBLICA}/t/${token}`,
      ...DB.progresoSellos(db, clienteId, config.sellos.objetivo),
    });
  },

  // Consulta publica: el cliente acerca la tarjeta a SU movil y cae aqui.
  // El token es el secreto; no lleva datos personales mas alla del nombre de pila.
  'GET /api/tarjeta': (req, res, empleado, params) => {
    const tarjeta = DB.tarjetaPorToken(db, params[0]);
    if (!tarjeta) return json(res, 404, { error: 'tarjeta no encontrada' });
    const c = DB.cliente(db, tarjeta.cliente_id);
    json(res, 200, {
      nombre: (c?.nombre ?? '').split(' ')[0],
      estado: tarjeta.estado,
      ...DB.progresoSellos(db, tarjeta.cliente_id, config.sellos.objetivo),
      modo: config.modo,
      movimientos: DB.movimientos(db, tarjeta.cliente_id, 10),
      recompensas: db.prepare('SELECT id, nombre, coste_puntos FROM recompensas WHERE activa = 1 ORDER BY coste_puntos').all(),
    });
  },

  // El tap. Acepta tres formas de identificar la tarjeta:
  //   uid   -> lectura normal Web NFC (NTAG213/215)
  //   token -> por si se lee el NDEF en vez del UID, o QR de respaldo
  //   sun   -> NTAG424 DNA firmado ({picc_data, cmac})
  'POST /api/tap': async (req, res, empleado) => {
    if (!empleado) return json(res, 401, { error: 'sesión requerida' });
    const d = await leerJson(req);
    const ahora = new Date().toISOString();

    // Idempotencia primero: si esta operacion ya se escribio, devolvemos lo mismo
    // sin volver a pasar por las reglas. Un reintento por corte de red no puede
    // acabar en "antipassback" sobre una operacion que ya conto.
    const yaHecho = DB.movimientoPorIdem(db, d.idem);
    if (yaHecho) {
      const c = DB.cliente(db, yaHecho.cliente_id);
      return json(res, 200, {
        repetido: true, sumados: yaHecho.puntos, nombre: (c?.nombre ?? '').split(' ')[0],
        cliente_id: yaHecho.cliente_id, detalle: { repetido: true },
        ...DB.progresoSellos(db, yaHecho.cliente_id, config.sellos.objetivo),
      });
    }

    let tarjeta = null;
    if (d.sun) {
      const candidatas = db.prepare('SELECT * FROM tarjetas WHERE clave_424 IS NOT NULL').all();
      // Simplificacion: se usa la misma clave AES para descifrar el PICCData y
      // para el MAC. Una personalizacion NTAG424 tipica usa dos claves distintas;
      // si separas las tuyas, guarda ambas y pasalas por separado aqui.
      for (const t of candidatas) {
        const clave = Buffer.from(t.clave_424, 'hex');
        const r = verificarSun({ piccData: d.sun.picc_data, cmac: d.sun.cmac,
                                 claveMeta: clave, claveMac: clave,
                                 contadorVisto: t.contador_424 });
        if (r.ok) {
          db.prepare('UPDATE tarjetas SET contador_424 = ? WHERE id = ?').run(r.contador, t.id);
          tarjeta = t;
          break;
        }
        if (r.motivo === 'contador_repetido') {
          return json(res, 409, { error: 'lectura repetida: acerca la tarjeta otra vez' });
        }
      }
      if (!tarjeta) return json(res, 401, { error: 'firma de tarjeta inválida' });
    } else if (d.uid) {
      tarjeta = DB.tarjetaPorUid(db, d.uid);
    } else if (d.token) {
      tarjeta = DB.tarjetaPorToken(db, d.token);
    } else {
      return json(res, 400, { error: 'falta identificar la tarjeta' });
    }

    if (!tarjeta) return json(res, 404, { error: 'tarjeta sin dar de alta', alta_necesaria: true });
    if (tarjeta.estado !== 'activa') return json(res, 403, { error: `tarjeta ${tarjeta.estado}` });

    const forzado = Boolean(d.forzado) && empleado.rol === 'encargado';
    const recientes = db.prepare(
      "SELECT tipo, ts FROM movimientos WHERE cliente_id = ? AND tipo = 'acumular' " +
      'ORDER BY id DESC LIMIT 20').all(tarjeta.cliente_id);

    const calculo = calcularAcumulacion({
      config, importe_cents: d.importe_cents ?? null, ahora,
      movimientosRecientes: recientes, cliente: DB.cliente(db, tarjeta.cliente_id), forzado,
    });
    if (!calculo.ok) return json(res, 409, { error: calculo.mensaje, ...calculo });

    const { movimiento, repetido } = DB.anotar(db, {
      cliente_id: tarjeta.cliente_id, tarjeta_id: tarjeta.id, tipo: 'acumular',
      puntos: calculo.puntos, importe_cents: d.importe_cents ?? null,
      concepto: calculo.detalle.multiplicadores.join(', ') || null,
      staff_id: empleado.id, local: d.local ?? null, idem: d.idem ?? null, ts: ahora,
    });

    const c = DB.cliente(db, tarjeta.cliente_id);
    json(res, 200, {
      repetido, sumados: movimiento.puntos, nombre: (c?.nombre ?? '').split(' ')[0],
      cliente_id: tarjeta.cliente_id, detalle: calculo.detalle,
      ...DB.progresoSellos(db, tarjeta.cliente_id, config.sellos.objetivo),
    });
  },

  'POST /api/canjear': async (req, res, empleado) => {
    if (!empleado) return json(res, 401, { error: 'sesión requerida' });
    const d = await leerJson(req);
    const yaHecho = DB.movimientoPorIdem(db, d.idem);
    if (yaHecho) {
      return json(res, 200, { repetido: true, gastados: -yaHecho.puntos,
                              recompensa: yaHecho.concepto,
                              ...DB.progresoSellos(db, yaHecho.cliente_id, config.sellos.objetivo) });
    }
    const recompensa = db.prepare('SELECT * FROM recompensas WHERE id = ?').get(d.recompensa_id);
    const saldoActual = DB.saldo(db, d.cliente_id);
    const calculo = calcularCanje({ recompensa, saldoActual });
    if (!calculo.ok) return json(res, 409, { error: calculo.mensaje, ...calculo });

    const { movimiento, repetido } = DB.anotar(db, {
      cliente_id: d.cliente_id, tarjeta_id: d.tarjeta_id ?? null, tipo: 'canjear',
      puntos: calculo.puntos, concepto: recompensa.nombre,
      staff_id: empleado.id, idem: d.idem ?? null,
    });
    json(res, 200, { repetido, gastados: -movimiento.puntos, recompensa: recompensa.nombre,
                     ...DB.progresoSellos(db, d.cliente_id, config.sellos.objetivo) });
  },

  'GET /api/clientes': (req, res, empleado, params) => {
    if (!empleado) return json(res, 401, { error: 'sesión requerida' });
    const c = DB.cliente(db, Number(params[0]));
    if (!c) return json(res, 404, { error: 'cliente no encontrado' });
    json(res, 200, { cliente: { id: c.id, nombre: c.nombre, telefono: c.telefono, alta_ts: c.alta_ts },
                     ...DB.progresoSellos(db, c.id, config.sellos.objetivo),
                     movimientos: DB.movimientos(db, c.id, 50) });
  },

  // Tarjeta perdida: se bloquea la vieja y el saldo sigue con el cliente.
  'POST /api/tarjetas/sustituir': async (req, res, empleado) => {
    if (!empleado) return json(res, 401, { error: 'sesión requerida' });
    const d = await leerJson(req);
    const vieja = db.prepare('SELECT * FROM tarjetas WHERE id = ?').get(d.tarjeta_id);
    if (!vieja) return json(res, 404, { error: 'tarjeta no encontrada' });
    if (DB.tarjetaPorUid(db, d.uid_nuevo)) return json(res, 409, { error: 'la tarjeta nueva ya está en uso' });
    db.prepare("UPDATE tarjetas SET estado = 'sustituida' WHERE id = ?").run(vieja.id);
    const token = DB.nuevoToken();
    db.prepare('INSERT INTO tarjetas (uid_hash, token, cliente_id, alta_ts) VALUES (?, ?, ?, ?)')
      .run(DB.hashUid(db, d.uid_nuevo), token, vieja.cliente_id, new Date().toISOString());
    json(res, 200, { token, url_ndef: `${BASE_PUBLICA}/t/${token}`, cliente_id: vieja.cliente_id });
  },

  'POST /api/tarjetas/bloquear': async (req, res, empleado) => {
    if (empleado?.rol !== 'encargado') return json(res, 403, { error: 'solo encargado' });
    const d = await leerJson(req);
    db.prepare("UPDATE tarjetas SET estado = 'bloqueada' WHERE id = ?").run(d.tarjeta_id);
    json(res, 200, { ok: true });
  },

  // Caducidad por inactividad. Pensado para lanzarlo desde cron una vez al mes.
  'POST /api/caducar': async (req, res, empleado) => {
    if (empleado?.rol !== 'encargado') return json(res, 403, { error: 'solo encargado' });
    const ahora = new Date().toISOString();
    const filas = db.prepare(
      'SELECT cliente_id, SUM(puntos) AS saldo, MAX(ts) AS ultimo FROM movimientos ' +
      'GROUP BY cliente_id HAVING saldo > 0').all();
    let caducados = 0;
    for (const f of filas) {
      const r = calcularCaducidad({ config, saldoActual: Number(f.saldo),
                                    ultimoMovimientoTs: f.ultimo, ahora });
      if (r.ok) {
        DB.anotar(db, { cliente_id: f.cliente_id, tipo: 'caducidad', puntos: r.puntos,
                        concepto: r.concepto, staff_id: empleado.id, ts: ahora });
        caducados++;
      }
    }
    json(res, 200, { clientes_afectados: caducados });
  },

  'GET /api/metricas': (req, res, empleado) => {
    if (empleado?.rol !== 'encargado') return json(res, 403, { error: 'solo encargado' });
    const q = (sql, ...p) => db.prepare(sql).get(...p);
    const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    json(res, 200, {
      tarjetas_activas: q("SELECT COUNT(*) n FROM tarjetas WHERE estado = 'activa'").n,
      altas_30d: q('SELECT COUNT(*) n FROM clientes WHERE alta_ts >= ?', hace30).n,
      taps_30d: q("SELECT COUNT(*) n FROM movimientos WHERE tipo = 'acumular' AND ts >= ?", hace30).n,
      canjes_30d: q("SELECT COUNT(*) n FROM movimientos WHERE tipo = 'canjear' AND ts >= ?", hace30).n,
      clientes_recurrentes_30d: q(
        "SELECT COUNT(*) n FROM (SELECT cliente_id FROM movimientos WHERE tipo = 'acumular' " +
        'AND ts >= ? GROUP BY cliente_id HAVING COUNT(*) >= 2)', hace30).n,
      puntos_en_circulacion: q('SELECT COALESCE(SUM(puntos), 0) n FROM movimientos').n,
    });
  },
};

// --- despacho ----------------------------------------------------------------

export function crearManejador() {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ruta = url.pathname;

    // /t/<token> es la URL corta que lleva grabada la tarjeta.
    if (ruta.startsWith('/t/')) return estatico(res, '/tarjeta.html');
    if (!ruta.startsWith('/api/')) return estatico(res, ruta);

    let empleado = null;
    try {
      empleado = autenticar(req);
      const clave = `${req.method} ${ruta}`;
      if (rutas[clave]) return await rutas[clave](req, res, empleado, []);

      // rutas con parametro final: /api/tarjeta/:token, /api/clientes/:id
      const partes = ruta.split('/');
      const prefijo = `${req.method} ${partes.slice(0, 3).join('/')}`;
      if (partes.length === 4 && rutas[prefijo]) {
        return await rutas[prefijo](req, res, empleado, [decodeURIComponent(partes[3])]);
      }
      json(res, 404, { error: 'ruta desconocida' });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  };
}

export function arrancar() {
  const manejador = crearManejador();
  const cert = arg('cert'), clave = arg('clave');
  const servidor = cert && clave
    ? httpsServer({ cert: readFileSync(cert), key: readFileSync(clave) }, manejador)
    : httpServer(manejador);
  servidor.listen(PUERTO, () => {
    const esquema = cert ? 'https' : 'http';
    console.log(`Mostrador:  ${esquema}://localhost:${PUERTO}/staff.html`);
    console.log(`Alta:       ${esquema}://localhost:${PUERTO}/alta.html`);
    console.log(`Base datos: ${RUTA_DB}`);
    console.log(`Reglas:     ${RUTA_CONFIG} (modo "${config.modo}")`);
    if (!cert) console.log('AVISO: sin HTTPS, Web NFC solo funcionará en localhost.');
  });
  return servidor;
}

export { db, config };

if (process.argv[1] === fileURLToPath(import.meta.url)) arrancar();
