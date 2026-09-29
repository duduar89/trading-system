'use strict';
// Filtro de publicidad sanitaria para plantillas, campañas y mensajes de la IA. No sustituye al
// abogado sanitario: bloquea lo que seguro no puede salir y avisa de lo dudoso.
const { normalizar } = require('./interpretar');

const MEDICAMENTOS = [
  'toxina botulinica', 'botox', 'botulinica', 'vistabel', 'azzalure', 'bocouture', 'xeomin', 'dysport', 'letybo', 'alluzience', 'relfydess', 'nuceiva',
  'semaglutida', 'ozempic', 'wegovy', 'rybelsus', 'tirzepatida', 'mounjaro', 'liraglutida', 'saxenda', 'orlistat', 'minoxidil oral', 'finasterida', 'dutasterida',
];
const MARCAS_SANITARIAS = [
  'juvederm', 'teoxane', 'teosyal', 'restylane', 'radiesse', 'profhilo', 'sculptra', 'belotero', 'stylage', 'ellanse', 'harmonyca', 'aliaxin', 'neauvia', 'saypha', 'princess filler', 'revolax', 'allurion',
];
const PROMO = /(\d+ ?%|descuento|oferta|promo|promocion|rebaja|gratis|regalo|2x1|3x2|precio especial|solo por hoy|ultim[ao]s? (plazas|dias|unidades)|a mitad de precio|\b\d+ ?(€|eur|euros)\b)/;
const PROMESAS = /(garantizad|sin riesgo|sin ningun riesgo|sin efectos secundarios|resultados? (permanentes|definitiv|inmediatos garantizados)|100 ?% (seguro|eficaz|natural)|milagr|infalible|para siempre|el mejor (tratamiento|medico|resultado))/;
const URGENCIA_FALSA = /(solo (por )?hoy|ultimas? (horas|plazas)|corre|no te lo pierdas|antes de que se acabe)/;

function contiene(t, lista) {
  return lista.filter((p) => new RegExp(`\\b${normalizar(p)}\\b`).test(t));
}

/**
 * @param {string} texto
 * @param {object} o { tipo: 'marketing'|'utilidad'|'conversacion', tieneBaja: bool (botón de baja) }
 * @returns {{ ok: boolean, errores: string[], avisos: string[] }}
 */
function revisar(texto, { tipo = 'marketing', tieneBaja = false } = {}) {
  const t = normalizar(texto);
  const errores = [];
  const avisos = [];
  const meds = contiene(t, MEDICAMENTOS);
  const marcas = contiene(t, MARCAS_SANITARIAS);
  const promo = PROMO.test(t);

  if (meds.length && (tipo === 'marketing' || promo)) {
    errores.push(`Nombra un medicamento con receta (${meds.join(', ')}) en un mensaje ${tipo === 'marketing' ? 'publicitario' : 'con promoción'}: no se puede anunciar al público.`);
  } else if (meds.length) {
    avisos.push(`Nombra un medicamento (${meds.join(', ')}): solo si el paciente preguntó por él y sin promoción.`);
  }
  if (marcas.length && tipo === 'marketing') {
    errores.push(`Nombra marcas de productos sanitarios (${marcas.join(', ')}): la publicidad al público necesita autorización previa de la Comunidad de Madrid.`);
  }
  if (PROMESAS.test(t)) errores.push('Promete resultados o ausencia de riesgos: no se puede en publicidad sanitaria.');
  if (URGENCIA_FALSA.test(t) && tipo !== 'utilidad') avisos.push('Urgencia comercial: solo si es verdad (si no, es práctica engañosa).');
  if (tipo === 'marketing' && !tieneBaja && !/(baja|no quiero (recibir|mas)|dejar de recibir)/.test(t)) {
    errores.push('Los mensajes comerciales tienen que llevar una forma sencilla de darse de baja (botón o texto).');
  }
  if (tipo === 'marketing' && !/iemec/.test(t)) avisos.push('Conviene que el mensaje diga que es de IEMEC.');
  if (tipo === 'utilidad' && promo) avisos.push('Tiene tono comercial: Meta la puede pasar a marketing (y cobra como tal).');
  return { ok: errores.length === 0, errores, avisos };
}

module.exports = { revisar, MEDICAMENTOS, MARCAS_SANITARIAS };
