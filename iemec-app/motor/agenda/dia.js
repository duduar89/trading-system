'use strict';
// Prepara un día para el motor de huecos a partir de filas de la base (fechas en UTC): horario,
// festivos, cierres, turnos, ausencias, pausas y citas vivas, todo pasado a minutos de Madrid.
const T = require('../tiempo');
const I = require('./intervalos');

const ESTADOS_QUE_OCUPAN = new Set(['retenida', 'confirmada', 'llegada', 'en_curso', 'completada', 'no_presentada']);

function vigente(fila, fecha) {
  const desde = fila.vigente_desde ? String(fila.vigente_desde).slice(0, 10) : null;
  const hasta = fila.vigente_hasta ? String(fila.vigente_hasta).slice(0, 10) : null;
  return (!desde || desde <= fecha) && (!hasta || fecha <= hasta);
}

// Un intervalo UTC recortado al día de Madrid, en minutos de reloj. null si no toca el día.
function aMinutosDelDia(desde, hasta, fecha) {
  const inicioDia = T.desdeMadrid(fecha, '00:00');
  const finDia = T.desdeMadrid(T.sumarDias(fecha, 1), '00:00');
  const a = new Date(Math.max(new Date(desde).getTime(), inicioDia.getTime()));
  const b = new Date(Math.min(new Date(hasta).getTime(), finDia.getTime()));
  if (a >= b) return null;
  const minA = T.partesMadrid(a).minutos;
  const minB = b.getTime() === finDia.getTime() ? 1440 : T.partesMadrid(b).minutos;
  return minB > minA ? { desde: minA, hasta: minB } : null;
}

function agrupar(filas, clave, valor) {
  const salida = {};
  for (const f of filas) {
    const v = valor(f);
    if (!v || f[clave] == null) continue;
    (salida[f[clave]] ||= []).push(v);
  }
  return salida;
}

function prepararDia({
  fecha, ahora = new Date(), antelacionMin = 60, clinica = {}, horario = [], festivos = [], cierres = [],
  salas = [], equipos = [], profesionales = [], horariosProf = [], ausencias = [], pausas = [], citas = [],
}) {
  const dia = T.diaSemana(fecha);
  const esFestivo = (festivos instanceof Set ? festivos : new Set(festivos.map((f) => String(f).slice(0, 10)))).has(fecha);

  let abierto = esFestivo ? [] : I.unir(horario.filter((h) => h.dia_semana === dia)
    .map((h) => ({ desde: T.minutosDe(h.abre), hasta: T.minutosDe(h.cierra) })));
  abierto = I.restar(abierto, cierres.map((c) => aMinutosDelDia(c.desde, c.hasta, fecha)).filter(Boolean));

  const hoy = T.fechaMadrid(ahora);
  let minimoDesde = 0;
  if (fecha < hoy) abierto = [];
  else if (fecha === hoy) minimoDesde = T.minutosMadrid(ahora) + antelacionMin;

  const vivas = citas.filter((c) => ESTADOS_QUE_OCUPAN.has(c.estado)
    && !(c.estado === 'retenida' && c.retenida_hasta && new Date(c.retenida_hasta) <= ahora));

  const profs = profesionales.filter((p) => p.activo !== false && p.activo !== 0).map((p) => {
    const turnos = horariosProf
      .filter((hp) => hp.profesional_id === p.id && hp.dia_semana === dia && vigente(hp, fecha))
      .map((hp) => ({ desde: T.minutosDe(hp.inicio), hasta: T.minutosDe(hp.fin), salaPreferidaId: hp.sala_preferida_id || null }));
    const bloqueos = ausencias.filter((a) => a.profesional_id === p.id)
      .map((a) => aMinutosDelDia(a.desde, a.hasta, fecha)).filter(Boolean);
    const pausasFlotantes = [];
    for (const pa of pausas.filter((x) => x.profesional_id === p.id && (x.dia_semana == null || x.dia_semana === dia))) {
      const ventana = { desde: T.minutosDe(pa.ventana_inicio), hasta: T.minutosDe(pa.ventana_fin) };
      if (pa.modo === 'fija') bloqueos.push(ventana);
      else pausasFlotantes.push({ ...ventana, duracion: pa.duracion_min });
    }
    return { id: p.id, rol: p.rol, turnos, bloqueos, pausasFlotantes };
  }).filter((p) => p.turnos.length);

  return {
    fecha,
    diaSemana: dia,
    festivo: esFestivo,
    paso: clinica.paso_agenda_min || 5,
    abierto,
    minimoDesde,
    salas: salas.filter((s) => s.activa !== false && s.activa !== 0).map((s) => ({ id: s.id, tipo: s.tipo })),
    equipos: equipos.filter((e) => e.activo !== false && e.activo !== 0)
      .map((e) => ({ id: e.id, codigo: e.codigo, salaId: e.sala_id, movil: Boolean(e.movil), unidades: e.unidades || 1 })),
    profesionales: profs,
    ocupacion: {
      salas: agrupar(vivas, 'sala_id', (c) => aMinutosDelDia(c.sala_desde, c.sala_hasta, fecha)),
      profesionales: agrupar(vivas, 'profesional_id', (c) => aMinutosDelDia(c.prof_desde, c.prof_hasta, fecha)),
      equipos: agrupar(vivas, 'equipo_id', (c) => aMinutosDelDia(c.prof_desde, c.prof_hasta, fecha)),
    },
  };
}

// Pasa un hueco (minutos de Madrid) a instantes UTC con los bloques que ocupará en la base.
function huecoAInstantes(fecha, hueco, t) {
  const crema = t.crema || 0;
  const aUtc = (min) => T.desdeMadrid(fecha, T.hhmm(min));
  const tratamientoDesde = hueco.inicio + crema;
  const tratamientoHasta = tratamientoDesde + t.duracion;
  return {
    inicio: aUtc(hueco.inicio),
    fin: aUtc(tratamientoHasta),
    sala_desde: aUtc(hueco.inicio - (t.holguraAntes || 0)),
    sala_hasta: aUtc(tratamientoHasta + (t.holguraDespues || 0)),
    prof_desde: aUtc(tratamientoDesde),
    prof_hasta: aUtc(tratamientoHasta),
  };
}

// Tratamiento de la base → forma que entiende el motor.
function tratamientoParaMotor(fila, { salasPermitidas = [], profesionalesPermitidos = [] } = {}) {
  return {
    id: fila.id,
    duracion: fila.duracion_min,
    crema: fila.crema_anestesica_min || 0,
    holguraAntes: fila.holgura_antes_min || 0,
    holguraDespues: fila.holgura_despues_min || 0,
    rol: fila.rol_profesional || null,
    salaTipo: fila.sala_tipo || null,
    equipoCodigo: fila.equipo_codigo || null,
    salasPermitidas,
    profesionalesPermitidos,
  };
}

module.exports = { prepararDia, huecoAInstantes, tratamientoParaMotor, aMinutosDelDia, ESTADOS_QUE_OCUPAN };
