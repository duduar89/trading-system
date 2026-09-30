'use strict';
// Motor de huecos. Trabaja en minutos del día de Madrid (0-1439) y no toca la base: recibe el día ya
// preparado (motor/agenda/dia.js) y devuelve los inicios posibles con su profesional, sala y equipo.
//
// Una cita ocupa cosas distintas en tiempos distintos:
//   · la sala:        [inicio − holgura_antes, inicio + crema + duración + holgura_después)
//   · el profesional: [inicio + crema, inicio + crema + duración)   (la crema no le ocupa)
//   · el aparato:     lo mismo que el profesional
//   · el paciente:    [inicio, inicio + crema + duración), que tiene que caer con la clínica abierta
// Las comidas flotantes se garantizan: un hueco solo vale si, después de ocuparlo, al profesional
// le sigue cabiendo su comida entera dentro de su ventana.
const I = require('./intervalos');

function bloquesDeCita(inicio, t) {
  const crema = t.crema || 0;
  const tratamientoDesde = inicio + crema;
  const tratamientoHasta = tratamientoDesde + t.duracion;
  return {
    paciente: { desde: inicio, hasta: tratamientoHasta },
    sala: { desde: inicio - (t.holguraAntes || 0), hasta: tratamientoHasta + (t.holguraDespues || 0) },
    profesional: { desde: tratamientoDesde, hasta: tratamientoHasta },
    equipo: { desde: tratamientoDesde, hasta: tratamientoHasta },
  };
}

function libre(ocupado = [], bloque) {
  return !ocupado.some((o) => I.solapan(o, bloque));
}

function cuentaSolapes(ocupado = [], bloque) {
  return ocupado.filter((o) => I.solapan(o, bloque)).length;
}

// ¿Le sigue cabiendo cada pausa flotante al profesional si además ocupa «bloque»?
function pausasFlotantesCaben(prof, ocupadoProf, bloque) {
  for (const p of prof.pausasFlotantes || []) {
    const ventana = I.interseccion([{ desde: p.desde, hasta: p.hasta }], prof.turnos);
    const ocupado = [...(prof.bloqueos || []), ...ocupadoProf, bloque];
    if (I.mayorHueco(I.restar(ventana, ocupado)) < p.duracion) return false;
  }
  return true;
}

// Minutos muertos que deja la cita pegada a lo anterior (menos es mejor: agenda compacta).
function huecoMuertoAntes(ocupado, bloque, limiteInferior) {
  const anteriores = ocupado.filter((o) => o.hasta <= bloque.desde).map((o) => o.hasta);
  const fin = anteriores.length ? Math.max(...anteriores) : limiteInferior;
  return Math.max(0, bloque.desde - fin);
}

function salasCandidatas(dia, t) {
  return dia.salas.filter((s) => s.activa !== false
    && (t.salasPermitidas?.length ? t.salasPermitidas.includes(s.id) : (!t.salaTipo || s.tipo === t.salaTipo)));
}

function profesionalesCandidatos(dia, t) {
  if (!t.rol && !t.profesionalesPermitidos?.length) return [null];
  return dia.profesionales.filter((p) => p.activo !== false
    && (t.profesionalesPermitidos?.length ? t.profesionalesPermitidos.includes(p.id) : p.rol === t.rol));
}

function equipoLibre(dia, t, salaId, bloque) {
  if (!t.equipoCodigo) return { ok: true, equipoId: null };
  const filas = dia.equipos.filter((e) => e.codigo === t.equipoCodigo && e.activo !== false
    && (e.movil || !e.salaId || e.salaId === salaId));
  for (const e of filas) {
    if (cuentaSolapes(dia.ocupacion.equipos?.[e.id], bloque) < (e.unidades || 1)) return { ok: true, equipoId: e.id };
  }
  return { ok: false, equipoId: null };
}

function buscarHuecos(dia, t, { desde = 0, hasta = 1440 } = {}) {
  const paso = dia.paso || 5;
  const salas = salasCandidatas(dia, t);
  const profesionales = profesionalesCandidatos(dia, t);
  if (!salas.length || !profesionales.length || !dia.abierto.length) return [];
  const minimo = Math.max(desde, dia.minimoDesde || 0);
  const huecos = [];

  for (const franja of dia.abierto) {
    const primero = Math.ceil(Math.max(franja.desde, minimo) / paso) * paso;
    for (let inicio = primero; inicio < Math.min(franja.hasta, hasta); inicio += paso) {
      const b = bloquesDeCita(inicio, t);
      if (!I.contiene(franja, b.paciente)) continue;

      const opciones = [];
      for (const prof of profesionales) {
        let ocupadoProf = [];
        if (prof) {
          if (!prof.turnos.some((tu) => I.contiene(tu, b.profesional))) continue;
          if (!libre(prof.bloqueos, b.profesional)) continue;
          ocupadoProf = dia.ocupacion.profesionales?.[prof.id] || [];
          if (!libre(ocupadoProf, b.profesional)) continue;
          if (!pausasFlotantesCaben(prof, ocupadoProf, b.profesional)) continue;
        }
        for (const sala of salas) {
          const ocupadoSala = dia.ocupacion.salas?.[sala.id] || [];
          if (!libre(ocupadoSala, b.sala)) continue;
          const eq = equipoLibre(dia, t, sala.id, b.equipo);
          if (!eq.ok) continue;
          const turno = prof ? prof.turnos.find((tu) => I.contiene(tu, b.profesional)) : franja;
          const puntos = (prof ? huecoMuertoAntes(ocupadoProf, b.profesional, turno.desde) : 0)
            + huecoMuertoAntes(ocupadoSala, b.sala, franja.desde) / 2
            + (prof && turno.salaPreferidaId && turno.salaPreferidaId !== sala.id ? 30 : 0);
          opciones.push({ profesionalId: prof ? prof.id : null, salaId: sala.id, equipoId: eq.equipoId, puntos });
        }
      }
      if (!opciones.length) continue;
      opciones.sort((a, b2) => a.puntos - b2.puntos || (a.profesionalId ?? 0) - (b2.profesionalId ?? 0) || a.salaId - b2.salaId);
      const mejor = opciones[0];
      huecos.push({
        inicio, fin: b.paciente.hasta,
        profesionalId: mejor.profesionalId, salaId: mejor.salaId, equipoId: mejor.equipoId,
        alternativas: opciones.length,
      });
    }
  }
  return huecos;
}

// Elige n huecos para proponer al paciente: repartidos en el día (no tres seguidos de 5 en 5) y,
// si tiene preferencia (mañana / tarde / hora concreta), primero los que encajan.
// Los que se proponen al paciente: repartidos, en su franja si la dice y, a igualdad, a horas
// redondas (las 12:00 o las 15:30 antes que las 12:50): se leen mejor y dejan la agenda más limpia.
// Con estricta, solo lo que encaja: «solo puedo por la tarde» no se rellena con mañanas.
function proponer(huecos, { n = 3, preferencia = null, separacionMin = 60, estricta = false } = {}) {
  const encaja = (h) => {
    if (!preferencia) return true;
    if (preferencia === 'manana') return h.inicio < 14 * 60;
    if (preferencia === 'tarde') return h.inicio >= 15 * 60;
    if (typeof preferencia === 'object' && preferencia.desde != null) return h.inicio >= preferencia.desde && h.inicio < preferencia.hasta;
    return true;
  };
  const redondez = (h) => (h.inicio % 30 === 0 ? 2 : h.inicio % 15 === 0 ? 1 : 0);
  const elegidos = [];
  const separado = (h) => elegidos.every((e) => Math.abs(e.inicio - h.inicio) >= separacionMin && e.inicio !== h.inicio);
  // Por pasadas: primero lo que encaja y es redondo; después lo que encaja; después el resto.
  const pasadas = [(h) => encaja(h) && redondez(h) === 2, (h) => encaja(h) && redondez(h) >= 1, encaja, ...(estricta ? [] : [() => true])];
  for (const vale of pasadas) {
    for (const h of [...huecos].sort((a, b) => a.inicio - b.inicio)) {
      if (elegidos.length >= n) break;
      if (vale(h) && separado(h)) elegidos.push(h);
    }
  }
  return elegidos.sort((a, b) => a.inicio - b.inicio);
}

module.exports = { buscarHuecos, proponer, bloquesDeCita };
