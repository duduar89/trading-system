'use strict';
// Errores del bróker con un `tipo` cerrado (ARQUITECTURA §3.4) para que el
// Ejecutor decida sin leer textos: 'fondos' → reducir, 'cantidad' → releer
// posiciones o cancelar órdenes que bloquean, 'lavado' → esperar a que acabe la
// orden opuesta, 'limite' y 'red' → reintentar más tarde, el resto → no reintentar.
//
// Alpaca usa el mismo código 40310000 para varios 403, así que se decide por
// código HTTP + texto del mensaje (ficha §5).

const TIPOS = Object.freeze(['fondos', 'cantidad', 'invalida', 'lavado', 'limite', 'auth', 'red', 'mercado_cerrado', 'desconocido']);
const REINTENTABLES = new Set(['limite', 'red']);

class ErrorBroker extends Error {
  constructor(mensaje, { status = null, tipo = 'desconocido', reintentable, cuerpo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorBroker';
    this.status = status;
    this.tipo = TIPOS.includes(tipo) ? tipo : 'desconocido';
    this.reintentable = reintentable === undefined ? REINTENTABLES.has(this.tipo) : Boolean(reintentable);
    this.cuerpo = cuerpo;
  }
}

function textoDe(cuerpo) {
  if (cuerpo == null) return '';
  if (typeof cuerpo === 'string') return cuerpo;
  return String(cuerpo.message || cuerpo.mensaje || JSON.stringify(cuerpo));
}

// Clasifica una respuesta HTTP de error de Alpaca en un tipo del contrato.
function clasificarAlpaca(status, cuerpo) {
  const m = textoDe(cuerpo).toLowerCase();
  if (status === 401) return 'auth';
  if (status === 429) return 'limite';
  if (status >= 500) return 'red';
  if (/market (is )?closed|market hours|outside.*(trading|market) hours/.test(m)) return 'mercado_cerrado';
  if (status === 403) {
    if (/wash/.test(m)) return 'lavado';
    if (/buying power/.test(m)) return 'fondos';
    // Cripto: «insufficient balance for USD» es falta de dólares; para la
    // moneda (BTC…) es falta de cantidad, igual que «insufficient qty».
    if (/insufficient balance for (usd|usdt|usdc)\b/.test(m)) return 'fondos';
    if (/insufficient (qty|quantity|balance)|not allowed to short|cannot be sold short/.test(m)) return 'cantidad';
    if (/not fractionable|subscription does not permit/.test(m)) return 'invalida';
    return 'desconocido';
  }
  if (status === 422 || status === 400) return 'invalida';
  return 'desconocido';
}

function errorDesdeRespuesta(status, cuerpo, contexto = '') {
  const tipo = clasificarAlpaca(status, cuerpo);
  const texto = textoDe(cuerpo).slice(0, 300) || `HTTP ${status}`;
  return new ErrorBroker(`${contexto ? contexto + ': ' : ''}${texto} (HTTP ${status})`, { status, tipo, cuerpo });
}

// Fallo de red o timeout (no hubo respuesta HTTP): siempre reintentable, pero
// en un POST de orden solo tras consultar por idCliente.
function errorDeRed(causa, contexto = '') {
  const texto = causa && causa.message ? causa.message : String(causa);
  return new ErrorBroker(`${contexto ? contexto + ': ' : ''}sin respuesta (${texto})`, { tipo: 'red', cuerpo: null });
}

module.exports = { ErrorBroker, TIPOS, clasificarAlpaca, errorDesdeRespuesta, errorDeRed };
