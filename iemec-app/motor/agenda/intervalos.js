'use strict';
// Aritmética de intervalos en minutos del día: [desde, hasta), con hasta excluido.

function solapan(a, b) {
  return a.desde < b.hasta && b.desde < a.hasta;
}

function contiene(fuera, dentro) {
  return fuera.desde <= dentro.desde && dentro.hasta <= fuera.hasta;
}

// Une intervalos que se tocan o se solapan y los devuelve ordenados.
function unir(lista) {
  const orden = lista.filter((i) => i.hasta > i.desde).map((i) => ({ desde: i.desde, hasta: i.hasta }))
    .sort((a, b) => a.desde - b.desde);
  const salida = [];
  for (const i of orden) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && i.desde <= ultimo.hasta) ultimo.hasta = Math.max(ultimo.hasta, i.hasta);
    else salida.push(i);
  }
  return salida;
}

// Lo que queda de «base» al quitarle «quitar».
function restar(base, quitar) {
  let resto = unir(base);
  for (const q of unir(quitar)) {
    const nuevo = [];
    for (const r of resto) {
      if (!solapan(r, q)) { nuevo.push(r); continue; }
      if (r.desde < q.desde) nuevo.push({ desde: r.desde, hasta: q.desde });
      if (q.hasta < r.hasta) nuevo.push({ desde: q.hasta, hasta: r.hasta });
    }
    resto = nuevo;
  }
  return resto;
}

function interseccion(a, b) {
  const salida = [];
  for (const x of unir(a)) {
    for (const y of unir(b)) {
      const desde = Math.max(x.desde, y.desde);
      const hasta = Math.min(x.hasta, y.hasta);
      if (desde < hasta) salida.push({ desde, hasta });
    }
  }
  return unir(salida);
}

function mayorHueco(lista) {
  return lista.reduce((max, i) => Math.max(max, i.hasta - i.desde), 0);
}

module.exports = { solapan, contiene, unir, restar, interseccion, mayorHueco };
