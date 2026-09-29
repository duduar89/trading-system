'use strict';
// Catálogo de ofertas que aprueba la clínica. La IA nunca inventa una: solo puede elegir una de
// las que devuelve esta función, y el código vuelve a comprobarla antes de enviarla.
//
// Límites legales que NO se pueden configurar:
//   · A un medicamento con receta (toxina botulínica, semaglutida, tirzepatida…) no se le asocia
//     ninguna promoción, descuento, bono ni regalo. Sí se puede ofrecer pago a plazos o una
//     valoración, que no rebajan el medicamento.
//   · A un producto sanitario (rellenos, hilos, balón…) tampoco, salvo que el abogado sanitario lo
//     haya revisado y la oferta lo diga (permitidaProductoSanitario).
const TIPOS_CON_REBAJA = new Set(['promocion', 'descuento', 'bono', 'regalo']);

function vigente(o, hoy) {
  return o.activa !== false
    && (!o.vigenteDesde || o.vigenteDesde <= hoy)
    && (!o.vigenteHasta || hoy <= o.vigenteHasta);
}

function aplicaAlTratamiento(o, t) {
  if (o.tratamientos?.length && !o.tratamientos.includes(t.id)) return false;
  if (o.familias?.length && !o.familias.includes(t.familia)) return false;
  return true;
}

function permitidaPorLey(o, t) {
  if (!TIPOS_CON_REBAJA.has(o.tipo)) return { ok: true };
  if (t.regimen_legal === 'medicamento_receta') {
    return { ok: false, motivo: 'medicamento con receta: sin promociones ni descuentos (solo plazos o valoración)' };
  }
  if (t.regimen_legal === 'producto_sanitario' && !o.permitidaProductoSanitario) {
    return { ok: false, motivo: 'producto sanitario: la rebaja necesita el visto bueno del abogado sanitario' };
  }
  return { ok: true };
}

function diasEntre(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * Ofertas que se pueden hacer a este paciente para este tratamiento, ya filtradas y ordenadas.
 * @param {object} p { tratamiento, ofertas, hechas: [{ ofertaId, fecha }], importe, hoy, intencion }
 */
function ofertasPosibles({ tratamiento, ofertas = [], hechas = [], importe = null, hoy, intencion = 'precio' }) {
  const descartes = [];
  const validas = [];
  for (const o of ofertas) {
    const motivo = !vigente(o, hoy) ? 'no vigente'
      : !aplicaAlTratamiento(o, tratamiento) ? 'no es de este tratamiento'
        : (importe != null && o.importeMin != null && importe < o.importeMin) ? 'importe por debajo del mínimo'
          : (importe != null && o.importeMax != null && importe > o.importeMax) ? 'importe por encima del máximo'
            : hechas.some((h) => h.ofertaId === o.id && diasEntre(h.fecha, hoy) < 180) ? 'ya se le ofreció en los últimos 6 meses'
              : (o.maxPorPaciente != null && hechas.filter((h) => diasEntre(h.fecha, hoy) < 365).length >= o.maxPorPaciente) ? 'límite de ofertas por paciente'
                : null;
    const ley = permitidaPorLey(o, tratamiento);
    if (motivo || !ley.ok) { descartes.push({ id: o.id, motivo: motivo || ley.motivo }); continue; }
    validas.push(o);
  }
  const orden = intencion === 'competencia_precio'
    ? ['valoracion', 'plazos', 'alternativa', 'bono', 'promocion', 'descuento', 'regalo']
    : importe != null && importe >= 300
      ? ['plazos', 'bono', 'alternativa', 'valoracion', 'promocion', 'descuento', 'regalo']
      : ['bono', 'alternativa', 'plazos', 'promocion', 'valoracion', 'descuento', 'regalo'];
  validas.sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo) || (b.prioridad || 0) - (a.prioridad || 0));
  return { validas, descartes };
}

function elegirOferta(p) {
  const { validas, descartes } = ofertasPosibles(p);
  return { oferta: validas[0] || null, descartes };
}

// Comprobación final de una oferta que propone la IA (por si «se la inventa» o elige una prohibida).
function comprobarOfertaPropuesta(ofertaId, p) {
  const { validas } = ofertasPosibles(p);
  const o = validas.find((x) => x.id === ofertaId);
  return o ? { ok: true, oferta: o } : { ok: false, motivo: 'la oferta no está en el catálogo permitido para este paciente y tratamiento' };
}

module.exports = { ofertasPosibles, elegirOferta, comprobarOfertaPropuesta, permitidaPorLey };
