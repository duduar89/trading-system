'use strict';
// Configuración desde el entorno. En cPanel las variables se ponen en «Setup Node.js App» o en
// un .env junto a la app; en el portátil, en iemec-app/.env (ver .env.example).
const fs = require('fs');
const path = require('path');

const ENV = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV);

function leer(nombre, porDefecto) {
  const v = process.env[nombre];
  return v === undefined || v === '' ? porDefecto : v;
}

const config = {
  entorno: leer('NODE_ENV', 'development'),
  puerto: Number(leer('PORT', 3004)),
  urlPublica: leer('URL_PUBLICA', 'http://localhost:3004'),
  zonaHoraria: 'Europe/Madrid',
  bd: {
    host: leer('DB_HOST', '127.0.0.1'),
    port: Number(leer('DB_PORT', 3306)),
    user: leer('DB_USER', 'iemec'),
    password: leer('DB_PASSWORD', 'iemec_local'),
    database: leer('DB_NAME', 'iemec_dev'),
  },
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
