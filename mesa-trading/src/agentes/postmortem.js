'use strict';
// Post-mortem (§6.6): cada operación cerrada recibe UNA categoría de una lista
// cerrada y una lección de una frase. Las reglas fijas dan siempre una
// respuesta; el LLM, si está, elige del mismo enum una vez al día y escribe la
// lección, que solo se acepta si sus cifras están en los datos de la operación.
// La memoria útil es el recuento (hipotesisDesdeLecciones), no el texto.

const { verificarCifras } = require('./cifras');
const plantillas = require('./plantillas');
const f = require('../util/formato');

const CATEGORIAS = Object.freeze(['señal_falsa', 'stop_estrecho', 'contra_regimen', 'noticia', 'ejecucion', 'acierto_de_libro', 'suerte']);
const POR_REGLA = new Set(['señal', 'stop']);
const MAX_BARRAS_STOP_ESTRECHO = 2;
const MAX_DESLIZAMIENTO = 0.005;          // 0,5 % en contra, en fracción (como lo mide libros.js)
const MIN_REPETICIONES_PISTA = 5;
const MAX_OPERACIONES_LLM = 40;          // una llamada al día; el resto va por reglas
// Categorías que no piden cambiar nada: no generan pistas para el laboratorio.
// Son también las únicas de una ganadora (pnl > 0): el resto, de una perdedora.
const SIN_PISTA = new Set(['acierto_de_libro', 'suerte']);
// Salidas que no dicen nada de la regla de la mesa (las decide un humano, el
// kill switch o la orden de prueba): se auditan, pero no generan pistas.
const SALIDAS_SIN_PISTA = new Set(['kill', 'manual', 'prueba']);

const etiquetaDe = s => String(s || '').split('/')[0] || 'el activo';
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function textoLeccion(categoria, op) {
  const e = etiquetaDe(op.simbolo);
  const p = num(op.pnl);
  // Con signo solo en la frase neutra; detrás de «ganó»/«perdió» va el importe
  // sin signo: «perdió -45,20 $» se leería como una ganancia.
  const pnl = f.usd(p, { signo: true });
  const monto = f.usd(p === null ? null : Math.abs(p));
  switch (categoria) {
    case 'acierto_de_libro': return `${e} salió por regla con ${pnl}: la regla funcionó como estaba escrita.`;
    case 'suerte': return `${e} ganó ${monto} pero salió por ${op.motivoSalida || 'otra causa'}, no por su regla.`;
    case 'contra_regimen': return `${e} entró en RISK-OFF y perdió ${monto}.`;
    case 'stop_estrecho': return `${e} tocó el stop en ${f.numero(num(op.barras))} velas y perdió ${monto}.`;
    case 'ejecucion': return `${e} perdió ${monto} con ${f.pct(num(op.deslizamiento))} de deslizamiento en contra.`;
    case 'noticia': return `${e} perdió ${monto} por un evento de noticias.`;
    default: return `${e} perdió ${monto}: la señal no se confirmó.`;
  }
}

// ¿La categoría cuadra con el signo del resultado? Una ganadora solo puede ser
// acierto_de_libro o suerte, y una perdedora (pnl ≤ 0) solo el resto: si no,
// una perdedora «de suerte» saldría del recuento de pistas.
function categoriaCuadra(categoria, op) {
  return SIN_PISTA.has(categoria) === ((num(op.pnl) ?? 0) > 0);
}

// Verbo que contradice el resultado («ganó» en una perdedora, «perdió» en una
// ganadora): verificarCifras no lo ve si la cifra va sin signo.
const RE_GANA = /(?<!\p{L})(gan[oó]|gana|ganancias?|beneficios?)(?!\p{L})/iu;
const RE_PIERDE = /(?<!\p{L})(perdi[oó]|pierde|p[eé]rdidas?)(?!\p{L})/iu;
function verboCuadra(texto, op) {
  const gana = (num(op.pnl) ?? 0) > 0;
  return gana ? !RE_PIERDE.test(texto) : !RE_GANA.test(texto);
}

// Reglas fijas, en el orden del contrato. pnl ≤ 0 cuenta como perdedora.
function clasificarReglas(operacion = {}) {
  const op = operacion || {};
  const pnl = num(op.pnl) ?? 0;
  let categoria;
  if (pnl > 0) {
    categoria = POR_REGLA.has(op.motivoSalida) ? 'acierto_de_libro' : 'suerte';
  } else if (op.regimenEntrada === 'RISK-OFF') {
    categoria = 'contra_regimen';
  } else if (op.motivoSalida === 'stop' && num(op.barras) !== null && op.barras <= MAX_BARRAS_STOP_ESTRECHO) {
    categoria = 'stop_estrecho';
  } else if (num(op.deslizamiento) !== null && op.deslizamiento > MAX_DESLIZAMIENTO) {
    categoria = 'ejecucion';
  } else {
    categoria = 'señal_falsa';
  }
  return { categoria, leccion: plantillas.frase(textoLeccion(categoria, op)) };
}

// Lo que se le enseña al LLM de cada operación (y contra lo que se comprueban
// las cifras de su lección).
function datosOperacion(op) {
  return {
    operacionId: String(op.id),
    mesaId: op.mesaId ?? null,
    simbolo: op.simbolo ?? null,
    etiqueta: etiquetaDe(op.simbolo),
    entradaPrecio: num(op.entradaPrecio),
    salidaPrecio: num(op.salidaPrecio),
    cantidad: num(op.cantidad),
    pnl: num(op.pnl),
    pnlPct: num(op.pnlPct),
    comisiones: num(op.comisiones),
    barras: num(op.barras),
    rMultiple: num(op.rMultiple),
    motivoSalida: op.motivoSalida ?? null,
    regimenEntrada: op.regimenEntrada ?? null,
    deslizamiento: num(op.deslizamiento),
    categoriaPorReglas: clasificarReglas(op).categoria,
  };
}

const SISTEMA = 'Eres el Auditor post-mortem de una mesa de trading en papel. Clasificas operaciones cerradas en una lista cerrada '
  + 'de categorías y escribes una lección de una frase en español. Solo usas cifras que estén en los datos.';

const INSTRUCCIONES = [
  'Para cada operación de «operaciones», elige una categoría:',
  '- señal_falsa: la regla dio entrada y el mercado no la confirmó.',
  '- stop_estrecho: salió por stop muy pronto y el stop parecía demasiado cerca.',
  '- contra_regimen: entró con el régimen en contra (RISK-OFF).',
  '- noticia: la movió un evento de noticias.',
  '- ejecucion: el precio de ejecución (deslizamiento) se comió el resultado.',
  '- acierto_de_libro: ganó saliendo por su regla.',
  '- suerte: ganó, pero no por su regla.',
  '«categoriaPorReglas» es la de las reglas fijas: úsala salvo que los datos digan otra cosa.',
  'leccion: una frase de 100 caracteres como mucho, con cifras copiadas de los datos y sin adjetivos vacíos.',
].join('\n');

function esquemaLote(ids) {
  return {
    type: 'object',
    properties: {
      clasificaciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            operacionId: { type: 'string', enum: ids },
            categoria: { type: 'string', enum: [...CATEGORIAS] },
            leccion: { type: 'string' },
          },
          required: ['operacionId', 'categoria', 'leccion'],
          additionalProperties: false,
        },
      },
    },
    required: ['clasificaciones'],
    additionalProperties: false,
  };
}

// → [{ operacionId, mesaId, simbolo, categoria, leccion, fuente: 'llm'|'reglas' }]
// Una llamada al LLM para todo el lote. Lo que el LLM no devuelva, o devuelva
// con una cifra que no está en los datos, sale por reglas.
async function lote({ operaciones = [], llm = null } = {}) {
  const ops = (operaciones || []).filter(o => o && o.id !== undefined && o.id !== null);
  // motivoSalida viaja con la lección: hipotesisDesdeLecciones aparta las del
  // kill, las manuales y las de prueba.
  const cabeza = op => ({ operacionId: String(op.id), mesaId: op.mesaId ?? null, simbolo: op.simbolo ?? null, motivoSalida: op.motivoSalida ?? null });
  const porReglas = op => {
    const r = clasificarReglas(op);
    return { ...cabeza(op), categoria: r.categoria, leccion: r.leccion, fuente: 'reglas' };
  };
  if (!ops.length) return [];
  if (!llm || !llm.activo) return ops.map(porReglas);

  const paraLLM = ops.slice(0, MAX_OPERACIONES_LLM);
  const datos = paraLLM.map(datosOperacion);
  const ids = datos.map(d => d.operacionId);
  const r = await llm.pedirJSON({
    uso: 'agentes',
    proposito: 'postmortem',
    sistema: SISTEMA,
    entrada: { operaciones: datos },
    instrucciones: INSTRUCCIONES,
    esquema: esquemaLote(ids),
    maxTokens: Math.min(8000, 1000 + 150 * paraLLM.length),
  });
  const delLLM = new Map();
  if (r.ok) {
    for (const c of r.datos.clasificaciones) if (!delLLM.has(c.operacionId)) delLLM.set(c.operacionId, c);
  }
  return ops.map((op, i) => {
    const c = delLLM.get(String(op.id));
    if (!c || !CATEGORIAS.includes(c.categoria) || !categoriaCuadra(c.categoria, op)) return porReglas(op);
    const texto = String(c.leccion || '').trim();
    // La lección se comprueba contra los datos de SU operación.
    if (!texto || !verificarCifras(texto, datos[i]).ok || !verboCuadra(texto, op)) return porReglas(op);
    return { ...cabeza(op), categoria: c.categoria, leccion: plantillas.frase(texto), fuente: 'llm' };
  });
}

// Pistas para el laboratorio: (mesa × categoría) repetida ≥ 5 veces en las
// lecciones de los últimos 30 días que recibe. Cada lección necesita mesaId
// (la de lote() lo trae; también vale { operacion: { mesaId } }). Las
// operaciones cerradas por kill, a mano o de prueba no cuentan: no las cerró
// la regla de la mesa.
function hipotesisDesdeLecciones(lecciones30d = []) {
  const cuenta = new Map();
  for (const l of lecciones30d || []) {
    if (!l) continue;
    const mesaId = l.mesaId ?? (l.operacion && l.operacion.mesaId);
    const salida = l.motivoSalida ?? (l.operacion && l.operacion.motivoSalida);
    if (!mesaId || !CATEGORIAS.includes(l.categoria) || SIN_PISTA.has(l.categoria) || SALIDAS_SIN_PISTA.has(salida)) continue;
    const clave = JSON.stringify([String(mesaId), l.categoria]);
    cuenta.set(clave, (cuenta.get(clave) || 0) + 1);
  }
  const pistas = [];
  for (const [clave, n] of cuenta) {
    if (n < MIN_REPETICIONES_PISTA) continue;
    const [mesaId, categoria] = JSON.parse(clave);
    pistas.push({ mesaId, categoria, n });
  }
  return pistas.sort((a, b) => (b.n - a.n) || a.mesaId.localeCompare(b.mesaId) || a.categoria.localeCompare(b.categoria));
}

module.exports = { CATEGORIAS, clasificarReglas, lote, hipotesisDesdeLecciones, datosOperacion, MIN_REPETICIONES_PISTA, SALIDAS_SIN_PISTA };
