'use strict';
// Qué días y a qué horas abre la clínica, con festivos. Lo usan los seguimientos (nunca se escribe
// a un paciente un festivo o con la clínica cerrada) y la propuesta de huecos.
const T = require('../tiempo');

function crearCalendario({ horario = [], festivos = [], horaEnvioPorDefecto = '11:30' } = {}) {
  const fest = new Set(festivos.map((f) => String(f).slice(0, 10)));
  const porDia = new Map();
  for (const h of horario) {
    const lista = porDia.get(h.dia_semana) || [];
    lista.push({ desde: T.minutosDe(h.abre), hasta: T.minutosDe(h.cierra) });
    porDia.set(h.dia_semana, lista.sort((a, b) => a.desde - b.desde));
  }

  function franjas(fecha) {
    if (fest.has(fecha)) return [];
    return porDia.get(T.diaSemana(fecha)) || [];
  }
  const abre = (fecha) => franjas(fecha).length > 0;

  function siguienteLaborable(fecha, { incluida = true } = {}) {
    let f = incluida ? fecha : T.sumarDias(fecha, 1);
    for (let i = 0; i < 60; i++) {
      if (abre(f)) return f;
      f = T.sumarDias(f, 1);
    }
    throw new Error(`La clínica no abre en los 60 días siguientes a ${fecha}`);
  }

  // Hora de envío dentro del horario de ese día: la pedida si cabe; si no, la más cercana.
  function horaDeEnvio(fecha, deseada = horaEnvioPorDefecto) {
    const fr = franjas(fecha);
    if (!fr.length) return null;
    const m = T.minutosDe(deseada);
    for (const f of fr) if (m >= f.desde && m < f.hasta - 30) return T.hhmm(m);
    // No cabe: la franja más cercana, media hora después de abrir.
    const mejor = fr.reduce((a, f) => (Math.abs(f.desde - m) < Math.abs(a.desde - m) ? f : a), fr[0]);
    return T.hhmm(Math.min(mejor.desde + 30, mejor.hasta - 30));
  }

  return { franjas, abre, siguienteLaborable, horaDeEnvio, festivos: fest };
}

module.exports = { crearCalendario };
