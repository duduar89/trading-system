'use strict';
// «¿Listo para dinero real?» — ARQUITECTURA §5.8 y docs/05-paso-a-real.md.
//
// Criterios de Eduardo (30-sep-2026, delegados en el director). Se tienen que
// cumplir TODOS; cada uno lleva su valor, su umbral y si pasa:
//   a) ≥ 180 días en papel desde el arranque del fondo;
//   b) ≥ 100 operaciones cerradas del fondo real (sin las de 'prueba');
//   c) Sharpe anualizado del fondo desde el arranque (retornos diarios) ≥ 0,7;
//   d) ese Sharpe ≥ el mejor de comprar y mantener BTC y la cesta cripto en
//      el mismo periodo (con claves de Alpaca, también SPY);
//   e) caída máxima histórica del fondo ≤ 20 %;
//   f) cero incidentes en los últimos 90 días, con el registro cubriendo
//      esos 90 días (si el registro es más nuevo, aún no se puede afirmar);
//   g) coste acumulado del LLM < 10 % del beneficio neto del fondo (con
//      beneficio ≤ 0 no se cumple, salvo que el coste sea 0).
// Informativo, no bloquea: si el fondo no bate a «mismas mesas sin comité»,
// la recomendación es pasar a real SIN comité (LLM apagado).
//
// Honestidad (AGENTS.md): el Sharpe y la caída del fondo y de la sombra «sin
// comité» se miden con la penalización de papel (0,1 % por lado, evaluador);
// las carteras de comprar y mantener ya la pagaron al comprar. La caída es la
// peor de la curva diaria penalizada y de la vista latido a latido.
//
// El semáforo NO activa nada: el código sigue siendo solo papel.

const { metricasMesa } = require('./evaluador');
const { NOMBRE_TIPO } = require('../riesgo/incidentes');
const { DIA } = require('../util/reloj');
const f = require('../util/formato');

const CRITERIOS = Object.freeze({
  diasPapel: 180,
  operaciones: 100,
  sharpe: 0.7,
  caidaMax: 0.20,
  diasSinIncidentes: 90,
  costeLLMMax: 0.10,
  // Menos retornos diarios que esto y el Sharpe no se da como cifra (ruido).
  minRetornosSharpe: 30,
});

const NOTA = 'El semáforo no activa nada: el código sigue siendo solo papel. Pasar a real exige una decisión escrita de Eduardo '
  + 'y un cambio deliberado de código. Primer tramo recomendado: una cantidad que se pueda perder entera (como mucho 2.000 €) '
  + 'y 3 meses comparando las ejecuciones reales con las de papel.';

const esNumero = x => typeof x === 'number' && Number.isFinite(x);
const n2 = x => (esNumero(x) ? f.numero(x, 2) : '—');
const puntosValidos = curva => (curva || []).filter(p => p && esNumero(p.valor) && p.valor > 0);

// Sharpe anualizado (√365) y caída máxima de una curva diaria, con la
// penalización de papel de sus operaciones. Con menos de minRetornosSharpe
// retornos, sharpe null.
function medirCurva(curva, operaciones = [], penalizacion = 0) {
  const puntos = puntosValidos(curva);
  const m = metricasMesa({ operaciones, curvaDiaria: puntos, penalizacionPapel: penalizacion });
  const retornos = Math.max(0, puntos.length - 1);
  return { sharpe: retornos >= CRITERIOS.minRetornosSharpe ? m.sharpe : null, maxDD: m.maxDD || 0, retornos };
}

function criterio(id, nombre, { valor, umbral, ok, valorTexto, umbralTexto, detalle = null }) {
  return { id, nombre, valor: esNumero(valor) ? valor : null, umbral, ok: Boolean(ok), valorTexto, umbralTexto, detalle };
}

function evaluarPasoAReal({
  ahora, creado, capitalInicial, patrimonio,
  operaciones = [], operacionesSombra = [], curvaDiaria = [], curvasSombra = {}, hayAlpaca = false,
  penalizacionPapel = 0, caidaMaximaVista = 0,
  incidentes = [], incidentesDesde = null,
  costeLLMUsd = 0,
} = {}) {
  const C = CRITERIOS;
  const lista = [];

  // a) Días en papel.
  const dias = esNumero(creado) && esNumero(ahora) ? Math.max(0, Math.floor((ahora - creado) / DIA)) : 0;
  lista.push(criterio('a', 'Días en papel', {
    valor: dias, umbral: C.diasPapel, ok: dias >= C.diasPapel,
    valorTexto: `${f.numero(dias)} ${dias === 1 ? 'día' : 'días'}`, umbralTexto: `≥ ${C.diasPapel} días`,
    detalle: esNumero(creado) ? `Desde el arranque del fondo (${f.fechaLarga(creado)}).` : null,
  }));

  // b) Operaciones cerradas del fondo real.
  const opsFondo = (operaciones || []).filter(o => o && !o.sombra && o.motivoSalida !== 'prueba');
  lista.push(criterio('b', 'Operaciones cerradas', {
    valor: opsFondo.length, umbral: C.operaciones, ok: opsFondo.length >= C.operaciones,
    valorTexto: f.numero(opsFondo.length), umbralTexto: `≥ ${C.operaciones}`,
    detalle: 'Del fondo real, sin la orden de prueba.',
  }));

  // c) Sharpe del fondo desde el arranque.
  const fondo = medirCurva(curvaDiaria, opsFondo, penalizacionPapel);
  const faltanDias = Math.max(0, C.minRetornosSharpe - fondo.retornos);
  lista.push(criterio('c', 'Sharpe del fondo', {
    valor: fondo.sharpe, umbral: C.sharpe, ok: esNumero(fondo.sharpe) && fondo.sharpe >= C.sharpe,
    valorTexto: n2(fondo.sharpe), umbralTexto: `≥ ${n2(C.sharpe)}`,
    detalle: fondo.sharpe === null
      ? `Hacen falta ${C.minRetornosSharpe} días de curva; faltan ${faltanDias}.`
      : `Anualizado, retornos diarios desde el arranque, con la penalización de papel.`,
  }));

  // d) Frente a comprar y mantener en el mismo periodo.
  const referencias = [['btc', 'BTC'], ['cesta-cripto', 'cesta cripto']].concat(hayAlpaca ? [['spy', 'SPY']] : []);
  const sharpes = referencias.map(([id, nombre]) => ({ id, nombre, sharpe: medirCurva(curvasSombra[id] || []).sharpe }));
  const sinDato = sharpes.filter(s => !esNumero(s.sharpe));
  const mejor = sinDato.length ? null : sharpes.reduce((a, s) => (s.sharpe > a.sharpe ? s : a));
  lista.push(criterio('d', 'Bate a comprar y mantener', {
    valor: fondo.sharpe, umbral: mejor ? mejor.sharpe : null,
    ok: Boolean(mejor) && esNumero(fondo.sharpe) && fondo.sharpe >= mejor.sharpe,
    valorTexto: n2(fondo.sharpe),
    umbralTexto: mejor ? `≥ ${n2(mejor.sharpe)} (${mejor.nombre})` : '≥ el mejor',
    detalle: `Sharpe en el mismo periodo: ${sharpes.map(s => `${s.nombre} ${n2(s.sharpe)}`).join(', ')}.`,
  }));

  // e) Caída máxima histórica.
  const caida = Math.max(esNumero(caidaMaximaVista) ? Math.abs(caidaMaximaVista) : 0, fondo.maxDD || 0);
  lista.push(criterio('e', 'Caída máxima', {
    valor: caida, umbral: C.caidaMax, ok: caida <= C.caidaMax + 1e-12,
    valorTexto: f.pct(caida, { decimales: 1 }), umbralTexto: `≤ ${f.pct(C.caidaMax, { decimales: 0 })}`,
    detalle: 'Desde el máximo histórico del fondo, la peor vista.',
  }));

  // f) Incidentes en los últimos 90 días.
  const desde = esNumero(ahora) ? ahora - C.diasSinIncidentes * DIA : 0;
  // Uno con fecha posterior a «ahora» (reloj que volvió atrás) también cuenta: ante la duda, en rojo.
  const recientes = (incidentes || []).filter(r => r && esNumero(r.t) && r.t > desde);
  const cobertura = esNumero(incidentesDesde) && esNumero(ahora) ? Math.max(0, Math.floor((ahora - incidentesDesde) / DIA)) : 0;
  const cubre = cobertura >= C.diasSinIncidentes;
  const porTipo = {};
  for (const r of recientes) porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1;
  let detalleF;
  if (recientes.length) {
    const ultimo = recientes[recientes.length - 1];
    detalleF = `${Object.entries(porTipo).map(([t, n]) => `${n} ${NOMBRE_TIPO[t] || t}`).join(', ')}. El último, el ${f.fechaLarga(ultimo.t)}: ${ultimo.detalle || NOMBRE_TIPO[ultimo.tipo] || ultimo.tipo}`;
  } else if (!cubre) {
    detalleF = `El registro de incidentes empezó ${esNumero(incidentesDesde) ? `el ${f.fechaLarga(incidentesDesde)}` : 'hoy'}: cubre ${f.numero(cobertura)} de ${C.diasSinIncidentes} días.`;
  } else {
    detalleF = 'Ni kill switch, ni conciliación grave, ni órdenes duplicadas o huérfanas, ni errores en los departamentos.';
  }
  lista.push(criterio('f', 'Sin incidentes en 90 días', {
    valor: recientes.length, umbral: 0, ok: cubre && recientes.length === 0,
    valorTexto: recientes.length ? f.numero(recientes.length) : (cubre ? '0' : `0 en ${f.numero(cobertura)} días`),
    umbralTexto: `0 en ${C.diasSinIncidentes} días`,
    detalle: detalleF,
  }));

  // g) Coste del LLM frente al beneficio neto.
  const coste = esNumero(costeLLMUsd) && costeLLMUsd > 0 ? costeLLMUsd : 0;
  const beneficio = esNumero(patrimonio) && esNumero(capitalInicial) ? patrimonio - capitalInicial : null;
  const fraccion = beneficio !== null && beneficio > 0 ? coste / beneficio : null;
  const okG = coste === 0 || (fraccion !== null && fraccion < C.costeLLMMax);
  lista.push(criterio('g', 'Coste del LLM', {
    valor: fraccion, umbral: C.costeLLMMax, ok: okG,
    valorTexto: fraccion !== null && coste > 0 ? `${f.pct(fraccion, { decimales: 1 })} (${f.usd(coste)})` : f.usd(coste),
    umbralTexto: `< ${f.pct(C.costeLLMMax, { decimales: 0 })} del beneficio`,
    detalle: beneficio === null
      ? null
      : beneficio > 0
        ? `Acumulado ${f.usd(coste)} sobre un beneficio neto de ${f.usd(beneficio)}.`
        : `El fondo no gana (${f.usd(beneficio, { signo: true })}): ${coste === 0 ? 'sin gasto en IA, no bloquea' : `cualquier gasto en IA (${f.usd(coste)}) es demasiado`}.`,
  }));

  // Informativo: ¿aporta el comité?
  const sinComite = medirCurva(curvasSombra['sin-comite'] || [], operacionesSombra || [], penalizacionPapel);
  const bate = esNumero(fondo.sharpe) && esNumero(sinComite.sharpe) ? fondo.sharpe > sinComite.sharpe : null;
  const texto = bate === null
    ? 'Aún sin datos para saber si el comité aporta: hacen falta 30 días de curva del fondo y de «mismas mesas sin comité».'
    : bate
      ? `El comité aporta: Sharpe del fondo ${n2(fondo.sharpe)} frente a ${n2(sinComite.sharpe)} de «mismas mesas sin comité».`
      : `El fondo no bate a «mismas mesas sin comité» (Sharpe ${n2(fondo.sharpe)} frente a ${n2(sinComite.sharpe)}): si se pasa a real, que sea sin comité (LLM apagado).`;

  const cumplidos = lista.filter(c => c.ok).length;
  return {
    listo: cumplidos === lista.length,
    cumplidos,
    total: lista.length,
    criterios: lista,
    comite: { sharpeFondo: fondo.sharpe, sharpeSinComite: sinComite.sharpe, bate, texto },
    nota: NOTA,
  };
}

module.exports = { evaluarPasoAReal, medirCurva, CRITERIOS, NOTA };
