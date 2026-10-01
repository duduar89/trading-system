'use strict';
// Configuración desde el entorno. En el portátil, en iemec-app/.env (ver .env.example); en Vercel, en
// las variables del proyecto. Una variable que ya está en el entorno manda sobre la del .env.
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV);

function leer(nombre, porDefecto) {
  const v = process.env[nombre];
  return v === undefined || v === '' ? porDefecto : v;
}

// Un entero de una variable de entorno; si no es un entero válido, el valor por defecto.
function leerEntero(nombre, porDefecto, { min = 0 } = {}) {
  const n = Number(leer(nombre, porDefecto));
  return Number.isInteger(n) && n >= min ? n : porDefecto;
}

// La base de datos (PostgreSQL: el del portátil o el de Supabase). DATABASE_URL, la cadena que da
// Supabase (postgresql://usuario:clave@host:puerto/base), manda sobre DB_HOST, DB_PORT, DB_USER,
// DB_PASSWORD y DB_NAME. Las migraciones necesitan una conexión de sesión (no el pooler en modo
// transacción): si hace falta otra distinta de la de la app, DATABASE_URL_MIGRACIONES. Si la clave lleva caracteres especiales (@ : / # ? %), en la URL van
// codificados (%40 para @…). De la URL solo se leen el servidor, el puerto, el usuario, la clave, la
// base y `sslmode=disable`: lo demás del cifrado, de las conexiones y de los tiempos se fija con DB_*
// (ver .env.example), y el certificado siempre se verifica (servidor/db-ssl.js).
function leerBd(variableUrl = 'DATABASE_URL') {
  const bd = {
    host: leer('DB_HOST', '127.0.0.1'),
    port: leerEntero('DB_PORT', 5432, { min: 1 }),
    user: leer('DB_USER', 'iemec'),
    password: leer('DB_PASSWORD', 'iemec_local'),
    database: leer('DB_NAME', 'iemec_dev'),
    ssl: leer('DB_SSL', 'auto'), // auto | require | disable
    sslCa: leer('DB_SSL_CA', ''),
    // Las conexiones abiertas a la vez: 5 en un servidor; en Vercel (sin servidor), 1 a 3.
    conexiones: leerEntero('DB_CONEXIONES', 5, { min: 1 }),
    inactivaMs: leerEntero('DB_IDLE_TIMEOUT_MS', 10000),
    conexionMs: leerEntero('DB_CONNECT_TIMEOUT_MS', 10000),
    sentenciaMs: leerEntero('DB_STATEMENT_TIMEOUT_MS', 30000), // 0 = sin límite
    // auto | transaccion | sesion: con el pooler de Supabase en modo transacción (puerto 6543) no valen
    // los SET de sesión; en «auto» se reconoce por el puerto.
    pooler: leer('DB_MODO_POOLER', 'auto'),
  };
  const url = leer(variableUrl, '');
  if (url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error(`${variableUrl} no es una URL válida (postgresql://usuario:clave@host:puerto/base). Si la clave lleva caracteres especiales, tienen que ir codificados (%40 para @…).`);
    }
    if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error(`${variableUrl} tiene que empezar por postgresql:// (o postgres://)`);
    const trozo = (s) => decodeURIComponent(s);
    try {
      bd.host = u.hostname.replace(/^\[|\]$/g, '') || bd.host;
      bd.port = u.port ? Number(u.port) : 5432;
      bd.user = trozo(u.username) || bd.user;
      bd.password = u.password ? trozo(u.password) : '';
      bd.database = trozo(u.pathname.replace(/^\//, '')) || bd.database;
    } catch {
      throw new Error(`${variableUrl} lleva un % mal codificado en el usuario, la clave o la base`);
    }
    // sslmode=disable (solo vale con localhost; db-ssl.js lo comprueba). Cualquier otro sslmode se
    // ignora: el certificado se verifica siempre.
    if (u.searchParams.get('sslmode') === 'disable' && bd.ssl === 'auto') bd.ssl = 'disable';
    if (u.searchParams.get('pgbouncer') === 'true' && bd.pooler === 'auto') bd.pooler = 'transaccion';
  }
  return bd;
}

const config = {
  entorno: leer('NODE_ENV', 'development'),
  puerto: Number(leer('PORT', 3004)),
  urlPublica: leer('URL_PUBLICA', 'http://localhost:3004'),
  zonaHoraria: 'Europe/Madrid',
  bd: leerBd(),
  // La conexión de las migraciones (npm run migrar): DATABASE_URL_MIGRACIONES si está; si no, la de siempre.
  bdMigraciones: leer('DATABASE_URL_MIGRACIONES', '') ? leerBd('DATABASE_URL_MIGRACIONES') : null,
  // La web pública (web/): su dominio y otros orígenes que pueden mandar el formulario «Te llamamos».
  web: {
    dominio: leer('WEB_DOMINIO', 'https://iemec-clinic.com'),
    origenes: leer('WEB_ORIGENES', ''),
  },
  // Cuánto se guarda lo que llega pidiendo información y no acaba en cita (servidor/retencion.js): la
  // política de privacidad de la web dice 12 meses desde el último contacto.
  retencion: {
    leadsMeses: Math.max(1, Number(leer('RETENCION_LEADS_MESES', 12)) || 12),
  },
  // Modo de cada integración: «simulado» (por defecto, nunca sale nada a internet) o «real».
  modos: {
    whatsapp: leer('MODO_WHATSAPP', 'simulado'),
    ia: leer('MODO_IA', 'simulado'),
    google: leer('MODO_GOOGLE', 'simulado'),
    correo: leer('MODO_CORREO', 'simulado'),
    meta: leer('MODO_META', 'simulado'),
  },
};

module.exports = config;
