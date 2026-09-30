'use strict';
// Arranque de la mesa como app web del cPanel («Application startup file» en
// Setup Node.js App). ARQUITECTURA-WEB W0 y W3.
//
// Este proceso NO opera: sirve el panel y la API leyendo lo que publica el
// latido del cron (scripts/latido.js) y ejecuta los botones tomando el mismo
// cerrojo que el motor. LiteSpeed puede matarlo cuando no hay tráfico, tener
// varios a la vez y reiniciarlo en cada publicación: no guarda nada suyo.
//
// Puerto: PORT (lo pone Passenger/LiteSpeed; puede ser un número o la ruta de
// un socket), o PUERTO del .env, o 3000. Con PORT se escucha donde diga el
// servidor web; sin él, en HOST (127.0.0.1 por defecto).
//
// Usuarios y sesiones van en MariaDB (DB_* del .env, src/bd/). Sin DB_* la web
// arranca igual (sirve /api/salud y el login), pero nadie puede entrar.

const path = require('path');
const { crearConfig } = require('./config');
const { crearServidor } = require('./servidor');
const log = require('./util/log').crear('web');

function destinoEscucha(entorno = process.env) {
  const port = entorno.PORT;
  if (port !== undefined && String(port).trim() !== '') {
    const n = Number(port);
    return Number.isInteger(n) && n >= 0 ? { puerto: n, host: undefined } : { socket: String(port) };
  }
  const n = Number(entorno.PUERTO);
  return { puerto: Number.isInteger(n) && n >= 0 && String(entorno.PUERTO).trim() !== '' ? n : 3000, host: entorno.HOST || '127.0.0.1' };
}

function crearWeb({ config = null, entorno = process.env, almacen, conLaMesa, interpretarMegafono } = {}) {
  const cfg = config || crearConfig({});
  let alm = almacen;
  if (alm === undefined) {
    try {
      alm = require('./web/almacen').almacenBD(entorno);
      if (!alm) log.aviso('Sin DB_* en el .env: la web arranca, pero el login responde 503.');
    } catch (e) {
      log.error(`sin base de datos (${e.message.split('\n')[0]}): nadie podrá entrar hasta arreglarlo.`);
      alm = null;
    }
  }
  const origenes = String(entorno.MESA_URL || entorno.URL_PUBLICA || '').split(',').map(s => s.trim()).filter(Boolean);
  return crearServidor({
    modo: 'web', config: cfg, raizWeb: path.join(cfg.raiz, 'web'), carpetaDatos: cfg.carpetaDatos,
    almacen: alm, conLaMesa, interpretarMegafono, origenes,
  });
}

function main() {
  const servidor = crearWeb();
  const d = destinoEscucha();
  servidor.on('error', e => {
    log.error(`no se pudo escuchar: ${e.message}`);
    process.exit(1);
  });
  const alEscuchar = () => {
    const dir = servidor.address();
    const donde = typeof dir === 'string' ? dir : `${dir.address}:${dir.port}`;
    log.info(`Mesa de trading (web) ${servidor.version} escuchando en ${donde}`);
  };
  if (d.socket) servidor.listen(d.socket, alEscuchar);
  else if (d.host) servidor.listen(d.puerto, d.host, alEscuchar);
  else servidor.listen(d.puerto, alEscuchar);
  const cerrar = () => { servidor.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

// Se arranca al ejecutarlo (node src/web.js) y cuando lo carga un cargador de
// fuera del repositorio: Passenger y lsnode (LiteSpeed) hacen require() del
// fichero de arranque desde su propio programa. Desde las pruebas y los
// scripts del repositorio solo se usan sus funciones.
const RAIZ_REPO = path.resolve(__dirname, '..');
const principal = require.main && require.main.filename ? path.resolve(require.main.filename) : '';
const cargadoPorFuera = !principal || !principal.startsWith(RAIZ_REPO + path.sep);
if (require.main === module || (cargadoPorFuera && !process.env.NODE_TEST_CONTEXT)) setImmediate(main);

module.exports = { crearWeb, destinoEscucha, main };
