'use strict';
// Filtros de mesa (§4.3). Catálogo CERRADO: es la gramática del laboratorio,
// que solo puede combinar estos filtros con estos parámetros. Un filtro solo
// bloquea ABRIR; nunca impide cerrar ni obliga a nada.
//
// contexto que leen: { regimen: 'RISK-OFF' | { valor }, fg: número | { valor } | null,
//                      volPercentil: 0-100 | null }
// Sin dato (fg o percentil null) el filtro deja pasar: no se puede juzgar, y
// bloquear por falta de datos mataría la mesa en silencio.

const CATALOGO = Object.freeze({
  'regimen-no-riskoff': Object.freeze({ parametros: [null], descripcion: 'No abrir en RISK-OFF' }),
  'fg-max': Object.freeze({ parametros: [75, 80, 85, 90], descripcion: 'No abrir con Miedo y codicia por encima del umbral' }),
  'fg-min': Object.freeze({ parametros: [10, 15, 20, 25], descripcion: 'No abrir con Miedo y codicia por debajo del umbral' }),
  'vol-max': Object.freeze({ parametros: [80, 90], descripcion: 'No abrir con la volatilidad 30 d por encima de su percentil histórico' }),
});

function valorRegimen(r) {
  if (!r) return null;
  return typeof r === 'string' ? r : r.valor || null;
}

function valorNumero(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'object' && typeof x.valor === 'number') return x.valor;
  return null;
}

function validarFiltro(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'filtro vacío' };
  const def = CATALOGO[spec.id];
  if (!def) return { ok: false, error: `filtro desconocido: ${spec.id}` };
  const p = spec.parametro === undefined ? null : spec.parametro;
  if (!def.parametros.includes(p)) {
    return { ok: false, error: `parámetro ${p} no permitido en ${spec.id} (${def.parametros.join(', ')})` };
  }
  return { ok: true, error: null };
}

function crearFiltro(spec) {
  const v = validarFiltro(spec);
  if (!v.ok) throw new Error(v.error);
  const p = spec.parametro === undefined ? null : spec.parametro;
  switch (spec.id) {
    case 'regimen-no-riskoff':
      return {
        id: spec.id, parametro: null, parametros: {},
        descripcion: 'No abrir en RISK-OFF',
        permite: ctx => valorRegimen(ctx && ctx.regimen) !== 'RISK-OFF',
      };
    case 'fg-max':
      return {
        id: spec.id, parametro: p, parametros: { umbral: p },
        descripcion: `No abrir con Miedo y codicia > ${p}`,
        permite: ctx => { const fg = valorNumero(ctx && ctx.fg); return fg === null || fg <= p; },
      };
    case 'fg-min':
      return {
        id: spec.id, parametro: p, parametros: { umbral: p },
        descripcion: `No abrir con Miedo y codicia < ${p}`,
        permite: ctx => { const fg = valorNumero(ctx && ctx.fg); return fg === null || fg >= p; },
      };
    case 'vol-max':
      return {
        id: spec.id, parametro: p, parametros: { percentil: p },
        descripcion: `No abrir con la volatilidad 30 d sobre su percentil ${p}`,
        permite: ctx => { const q = valorNumero(ctx && ctx.volPercentil); return q === null || q <= p; },
      };
    default:
      throw new Error(`filtro desconocido: ${spec.id}`);
  }
}

// Acepta filtros ya creados (con permite) o especificaciones {id, parametro}.
function asegurarFiltros(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return [];
  return lista.map(f => (f && typeof f.permite === 'function' ? f : crearFiltro(f)));
}

function crearFiltros(lista) { return asegurarFiltros(lista); }

// Primer filtro que bloquea, o null si todos dejan abrir.
function bloqueo(filtros, contexto) {
  for (const f of filtros) if (!f.permite(contexto)) return f;
  return null;
}

module.exports = { CATALOGO, validarFiltro, crearFiltro, crearFiltros, asegurarFiltros, bloqueo, valorRegimen, valorNumero };
