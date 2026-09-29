'use strict';
// Hora de Madrid sin librerías. La base guarda UTC; aquí se pasa de UTC a «día y hora de Madrid» y
// al revés, con el cambio de hora bien hecho (último domingo de marzo y de octubre).
//
// Convenciones: una fecha local es 'AAAA-MM-DD'; una hora local es 'HH:MM'; los minutos del día
// van de 0 a 1439; el día de la semana va de 1 (lunes) a 7 (domingo), como en la base.

const ZONA = 'Europe/Madrid';
const formato = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function partesMadrid(instante) {
  const p = {};
  for (const { type, value } of formato.formatToParts(instante)) p[type] = value;
  const fecha = `${p.year}-${p.month}-${p.day}`;
  return {
    fecha,
    hora: `${p.hour}:${p.minute}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
    segundos: Number(p.second),
    diaSemana: diaSemana(fecha),
  };
}

// Diferencia en minutos entre la hora de Madrid y UTC en ese instante (+60 o +120).
function desfaseMin(instante) {
  const p = partesMadrid(instante);
  const comoUtc = Date.UTC(...fechaANumeros(p.fecha), 0, 0) + p.minutos * 60000 + p.segundos * 1000;
  return Math.round((comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60000);
}

function fechaANumeros(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) throw new Error(`Fecha no válida: ${fecha}`);
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}

function minutosDe(hora) {
  if (typeof hora === 'number') return hora;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(hora));
  if (!m) throw new Error(`Hora no válida: ${hora}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function hhmm(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Instante UTC de una hora local de Madrid. Si la hora no existe (el adelanto de marzo, de 2:00 a
// 3:00), devuelve la primera hora válida después; si existe dos veces (el retraso de octubre, de
// 2:00 a 3:00), devuelve la primera, en horario de verano.
function desdeMadrid(fecha, hora) {
  const [a, mes, d] = fechaANumeros(fecha);
  const min = minutosDe(hora);
  const base = Date.UTC(a, mes, d, 0, 0) + min * 60000;
  // Probamos con los dos desfases posibles y nos quedamos con el que cuadra.
  for (const desfase of [120, 60]) {
    const candidato = new Date(base - desfase * 60000);
    const p = partesMadrid(candidato);
    if (p.fecha === fecha && p.minutos === min) return candidato;
  }
  // Hora inexistente: avanzamos hasta la primera que exista.
  for (let extra = 0; extra <= 240; extra++) {
    const candidato = new Date(base - 120 * 60000 + extra * 60000);
    const p = partesMadrid(candidato);
    if (p.fecha === fecha && p.minutos >= min) return candidato;
  }
  throw new Error(`No se pudo situar ${fecha} ${hora} en Madrid`);
}

function fechaMadrid(instante) {
  return partesMadrid(instante).fecha;
}

function diaSemana(fecha) {
  const d = new Date(Date.UTC(...fechaANumeros(fecha))).getUTCDay();
  return d === 0 ? 7 : d;
}

function sumarDias(fecha, n) {
  const t = Date.UTC(...fechaANumeros(fecha)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function diasEntre(desde, hasta) {
  return Math.round((Date.UTC(...fechaANumeros(hasta)) - Date.UTC(...fechaANumeros(desde))) / 86400000);
}

function sumarMeses(fecha, n) {
  const [a, m, d] = fechaANumeros(fecha);
  const total = a * 12 + m + n;
  const anio = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

function primerDiaDelMes(fecha) {
  return fecha.slice(0, 8) + '01';
}

// Minutos desde medianoche de Madrid a partir de un instante (para comparar con horarios).
function minutosMadrid(instante) {
  return partesMadrid(instante).minutos;
}

module.exports = {
  ZONA, partesMadrid, desfaseMin, desdeMadrid, fechaMadrid, diaSemana, sumarDias, diasEntre,
  sumarMeses, primerDiaDelMes, minutosDe, hhmm, minutosMadrid,
};
