'use strict';
// Tamaño de una apertura (§4.4). Lo usan el backtest y el vivo, para que el
// papel y el laboratorio midan lo mismo.
//
//   nocional = min( capitalMesa·peso,                                  → 'peso'
//                   capitalMesa·peso·min(1, volObjetivo/volAnual),     → 'volatilidad'
//                   riesgoPorOperacion·patrimonio / ((precio−stop)/precio), → 'riesgo'
//                   maxPesoPorActivo·patrimonio )                      → 'maxActivo'
//
// El término de riesgo hace que, si salta el stop, se pierda como mucho
// riesgoPorOperacion del patrimonio (sin contar el hueco).
// Un término sin dato (sin stop, sin volatilidad, sin límite) no limita.
// En empate gana el primero de la lista: si nada recorta, el límite es el peso.

function positivo(x) { return typeof x === 'number' && Number.isFinite(x) && x > 0; }

function dimensionar({ capitalMesa, peso, precio, stop, volAnual, patrimonio, limites = {}, volObjetivo = 0.40 } = {}) {
  if (!positivo(precio)) throw new Error(`precio inválido para dimensionar: ${precio}`);
  const base = Math.max(0, (Number(capitalMesa) || 0) * (Number(peso) || 0));
  const candidatos = [{ nocional: base, limitadoPor: 'peso' }];

  if (positivo(volAnual) && positivo(volObjetivo)) {
    candidatos.push({ nocional: base * Math.min(1, volObjetivo / volAnual), limitadoPor: 'volatilidad' });
  }

  if (stop !== null && stop !== undefined && Number.isFinite(stop) && positivo(limites.riesgoPorOperacion) && positivo(patrimonio)) {
    const distancia = (precio - stop) / precio;
    // Un stop en o por encima del precio no es un stop de largo: no se abre.
    const tope = distancia > 0 ? (limites.riesgoPorOperacion * patrimonio) / distancia : 0;
    candidatos.push({ nocional: tope, limitadoPor: 'riesgo' });
  }

  if (positivo(limites.maxPesoPorActivo) && positivo(patrimonio)) {
    candidatos.push({ nocional: limites.maxPesoPorActivo * patrimonio, limitadoPor: 'maxActivo' });
  }

  let elegido = candidatos[0];
  for (const cand of candidatos) if (cand.nocional < elegido.nocional) elegido = cand;
  const nocional = Math.max(0, elegido.nocional);
  return { nocional, cantidad: nocional / precio, limitadoPor: elegido.limitadoPor };
}

module.exports = { dimensionar };
