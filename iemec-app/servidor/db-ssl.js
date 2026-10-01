'use strict';
// Cifrado de la conexión a la base. Regla sin excepciones: lo que no es de esta máquina va por TLS y
// con el certificado verificado (cadena y nombre del servidor). No existe `rejectUnauthorized: false`
// en ninguna combinación de variables.
//
//   DB_SSL=auto      (por defecto) TLS verificado salvo en localhost, que va sin cifrar
//   DB_SSL=require   TLS verificado siempre, también en localhost
//   DB_SSL=disable   sin TLS: solo se admite con localhost; con otro servidor, error
//   DB_SSL_CA        el certificado de la autoridad que firma el del servidor: una ruta, el propio
//                    texto PEM (con \n si va en una sola línea) o la palabra «sistema» para usar los
//                    certificados de confianza de Node. Si no se pone, para un servidor que no es
//                    local se usa el de Supabase (servidor/certs/supabase-prod-ca-2021.crt).
const fs = require('fs');
const path = require('path');

const CA_SUPABASE = path.join(__dirname, 'certs', 'supabase-prod-ca-2021.crt');
const MODOS = ['auto', 'require', 'disable'];

// localhost, 127.x.x.x, ::1 y los sockets de Unix (el host empieza por /).
function esLocal(host) {
  const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h) || h.startsWith('/');
}

function leerCa(entrada) {
  const texto = String(entrada).trim();
  if (texto.includes('BEGIN CERTIFICATE')) return texto.replace(/\\n/g, '\n');
  try {
    return fs.readFileSync(path.resolve(texto), 'utf8');
  } catch (err) {
    throw new Error(`DB_SSL_CA: no se puede leer el certificado «${texto}» (${err.code || err.message}). Pon la ruta de un .crt, el texto PEM o «sistema».`, { cause: err });
  }
}

// → false (sin TLS) o las opciones `ssl` de pg, siempre con la verificación activada.
function opcionesSsl({ host, modo = 'auto', ca = '' } = {}) {
  const m = String(modo || 'auto').trim().toLowerCase();
  if (!MODOS.includes(m)) throw new Error(`DB_SSL=${modo} no vale: usa auto, require o disable`);
  const local = esLocal(host);
  if (m === 'disable') {
    if (!local) throw new Error('DB_SSL=disable solo se admite con localhost: una base en otra máquina va siempre cifrada y con el certificado verificado');
    return false;
  }
  if (local && m === 'auto') return false;
  const opciones = { rejectUnauthorized: true, minVersion: 'TLSv1.2' };
  const entrada = String(ca || '').trim();
  if (/^(sistema|system)$/i.test(entrada)) return opciones; // los certificados de confianza de Node
  if (entrada) opciones.ca = leerCa(entrada);
  else if (!local) opciones.ca = fs.readFileSync(CA_SUPABASE, 'utf8');
  return opciones;
}

module.exports = { esLocal, opcionesSsl, CA_SUPABASE };
