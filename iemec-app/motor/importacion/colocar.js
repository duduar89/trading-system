'use strict';
// Colocar en la agenda una cita que ya tiene hora (la que dio Flowww): ¿cabe justo a esa hora, con
// ese profesional y en esa cabina? Y si no cabe, por qué, en palabras de recepción. Sin base de
// datos: trabaja con el día que prepara motor/agenda/dia.js, y el mismo motor de huecos que usa
// agenda.reservar decide si cabe.
const I = require('../agenda/intervalos');
const { buscarHuecos, bloquesDeCita } = require('../agenda/huecos');

// El hueco que empieza justo en ese minuto (aunque no sea múltiplo del paso de la agenda: Flowww da
// citas a menos cuarto), con ese profesional o esa cabina si se piden. null si no cabe.
function huecoExacto(dia, t, minuto, { profesionalId = null, salaId = null } = {}) {
  const filtrado = {
    ...dia,
    paso: 1,
    profesionales: profesionalId ? dia.profesionales.filter((p) => p.id === profesionalId) : dia.profesionales,
    salas: salaId ? dia.salas.filter((s) => s.id === salaId) : dia.salas,
  };
  return buscarHuecos(filtrado, t, { desde: minuto, hasta: minuto + 1 }).find((h) => h.inicio === minuto) || null;
}

// Las cabinas donde se hace el tratamiento (las suyas o las de su tipo), abiertas ese día.
function salasDelTratamiento(dia, t) {
  return dia.salas.filter((s) => (t.salasPermitidas?.length ? t.salasPermitidas.includes(s.id) : !t.salaTipo || s.tipo === t.salaTipo));
}

const haceElTratamiento = (t, id, rol) => (t.profesionalesPermitidos?.length ? t.profesionalesPermitidos.includes(id) : !t.rol || rol === t.rol);

/**
 * Apunta lo que ocupa una cita colocada: en el día, para que la siguiente ya lo vea el motor, y en la
 * lista con nombre (`ocupacion`), para poder decir con qué choca.
 */
function ocupar(dia, ocupacion, t, minuto, { salaId = null, profesionalId = null, equipoId = null }, quien) {
  const b = bloquesDeCita(minuto, t);
  const apuntar = (tipo, grupo, id, bloque) => {
    if (!id) return;
    dia.ocupacion[grupo] ||= {};
    (dia.ocupacion[grupo][id] ||= []).push({ desde: bloque.desde, hasta: bloque.hasta });
    ocupacion.push({ tipo, recurso: id, desde: bloque.desde, hasta: bloque.hasta, quien });
  };
  apuntar('sala', 'salas', salaId, b.sala);
  apuntar('profesional', 'profesionales', profesionalId, b.profesional);
  apuntar('equipo', 'equipos', equipoId, b.equipo);
}

/**
 * Por qué una cita no cabe a esa hora: lo primero que falla, como lo diría recepción.
 * @param ocupacion [{ tipo: 'sala'|'profesional'|'equipo', recurso, desde, hasta, quien }]
 * @param nombres { sala(id), profesional(id), rol(id) }
 */
function porQueNoCabe(dia, t, minuto, { profesionalId = null } = {}, ocupacion = [], nombres = {}) {
  const b = bloquesDeCita(minuto, t);
  const sala = (id) => nombres.sala?.(id) || `la cabina ${id}`;
  const persona = (id) => nombres.profesional?.(id) || `el profesional ${id}`;
  const choque = (tipo, ids, bloque) => ocupacion.find((o) => o.tipo === tipo && ids.includes(o.recurso) && I.solapan(o, bloque));
  if (dia.festivo) return 'es festivo';
  if (!dia.abierto.length) return 'la clínica no abre ese día';
  if (!dia.abierto.some((f) => I.contiene(f, b.paciente))) return 'cae fuera del horario de la clínica';
  const salas = salasDelTratamiento(dia, t);
  if (!salas.length) return 'no hay ninguna cabina para este tratamiento';

  if (profesionalId && (t.rol || t.profesionalesPermitidos?.length)) {
    const p = dia.profesionales.find((x) => x.id === profesionalId);
    if (!haceElTratamiento(t, profesionalId, nombres.rol?.(profesionalId) ?? p?.rol)) return `${persona(profesionalId)} no hace este tratamiento en la app`;
    if (!p || !p.turnos.some((tu) => I.contiene(tu, b.profesional))) return `cae fuera del horario de ${persona(profesionalId)}`;
    if (p.bloqueos.some((x) => I.solapan(x, b.profesional))) return `${persona(profesionalId)} tiene la comida o una ausencia a esa hora`;
    const c = choque('profesional', [profesionalId], b.profesional);
    if (c) return `${persona(profesionalId)} ya tiene ${c.quien}`;
  }

  const libres = salas.filter((s) => !choque('sala', [s.id], b.sala));
  if (!libres.length) {
    const c = choque('sala', salas.map((s) => s.id), b.sala);
    return salas.length === 1 ? `${sala(salas[0].id)} ocupada por ${c.quien}` : `todas sus cabinas ocupadas (una, por ${c.quien})`;
  }

  if (!profesionalId && (t.rol || t.profesionalesPermitidos?.length)) {
    const quienes = dia.profesionales.filter((p) => haceElTratamiento(t, p.id, p.rol));
    if (!quienes.length) return 'ese día no trabaja nadie que haga este tratamiento';
    const enTurno = quienes.filter((p) => p.turnos.some((tu) => I.contiene(tu, b.profesional)));
    if (!enTurno.length) return 'cae fuera del horario de quien hace este tratamiento';
    const sinComida = enTurno.filter((p) => !p.bloqueos.some((x) => I.solapan(x, b.profesional)));
    if (!sinComida.length) return 'quien hace este tratamiento tiene la comida o una ausencia a esa hora';
    const c = choque('profesional', sinComida.map((p) => p.id), b.profesional);
    if (c && sinComida.every((p) => choque('profesional', [p.id], b.profesional))) return `quien hace este tratamiento ya tiene ${c.quien}`;
  }
  if (t.equipoCodigo) return 'el aparato que necesita está ocupado o no está en esa cabina';
  return profesionalId ? `no le deja sitio a la comida de ${persona(profesionalId)}` : 'no deja sitio a la comida del profesional';
}

module.exports = { huecoExacto, salasDelTratamiento, ocupar, porQueNoCabe };
