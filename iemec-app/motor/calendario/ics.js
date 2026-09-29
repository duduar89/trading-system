'use strict';
// La cita, para el calendario del paciente: fichero .ics (RFC 5545) y enlaces de «añadir a Google /
// Outlook». Horas en UTC (sufijo Z): todos los calendarios las pasan a la hora local del teléfono,
// y así no hace falta incrustar la zona horaria ni dependemos del cambio de hora.
//
// Cambios y anulaciones: el UID es siempre el mismo para una cita y SEQUENCE sube con cada cambio;
// un .ics nuevo con el mismo UID actualiza el evento en los calendarios que lo admiten. El aviso
// que vale siempre es el de WhatsApp y la página «Tu cita».

const PRODID = '-//Brainstormers//IEMEC Agenda//ES';

function escapar(texto = '') {
  return String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Pliega a 75 octetos (no caracteres: una tilde son dos octetos en UTF-8) sin partir caracteres.
function plegar(linea) {
  const bytes = Buffer.from(linea, 'utf8');
  if (bytes.length <= 75) return linea;
  const trozos = [];
  let actual = '';
  let tam = 0;
  let limite = 75;
  for (const ch of linea) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (tam + n > limite) {
      trozos.push(actual);
      actual = '';
      tam = 0;
      limite = 74; // las líneas de continuación empiezan con un espacio
    }
    actual += ch;
    tam += n;
  }
  trozos.push(actual);
  return trozos.join('\r\n ');
}

function fechaUtc(instante) {
  return new Date(instante).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * @param {object} cita
 *   uid, inicio, fin (Date), titulo, descripcion, lugar, lat, lng, url, secuencia (número),
 *   cancelada (bool), avisos (minutos antes, por defecto [1440, 120]), creada (Date)
 */
function generarIcs(cita, { ahora = new Date() } = {}) {
  if (!cita.uid) throw new Error('La cita necesita un UID estable');
  if (!(new Date(cita.fin) > new Date(cita.inicio))) throw new Error('La cita acaba antes de empezar');
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${cita.uid}`,
    `DTSTAMP:${fechaUtc(ahora)}`,
    `DTSTART:${fechaUtc(cita.inicio)}`,
    `DTEND:${fechaUtc(cita.fin)}`,
    `SEQUENCE:${cita.secuencia || 0}`,
    `STATUS:${cita.cancelada ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${escapar(cita.cancelada ? `Cancelada: ${cita.titulo}` : cita.titulo)}`,
  ];
  if (cita.descripcion) lineas.push(`DESCRIPTION:${escapar(cita.descripcion)}`);
  if (cita.lugar) lineas.push(`LOCATION:${escapar(cita.lugar)}`);
  if (cita.lat != null && cita.lng != null) lineas.push(`GEO:${Number(cita.lat).toFixed(6)};${Number(cita.lng).toFixed(6)}`);
  if (cita.url) lineas.push(`URL:${cita.url}`);
  lineas.push('TRANSP:OPAQUE');
  if (!cita.cancelada) {
    for (const min of cita.avisos || [1440, 120]) {
      lineas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapar(cita.titulo)}`, `TRIGGER:-PT${min}M`, 'END:VALARM');
    }
  }
  lineas.push('END:VEVENT', 'END:VCALENDAR');
  return lineas.map(plegar).join('\r\n') + '\r\n';
}

function enlaceGoogle(cita) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: cita.titulo,
    dates: `${fechaUtc(cita.inicio)}/${fechaUtc(cita.fin)}`,
    details: [cita.descripcion, cita.url].filter(Boolean).join('\n\n'),
    location: cita.lugar || '',
    ctz: 'Europe/Madrid',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

function enlaceOutlook(cita, { cuenta = 'personal' } = {}) {
  const host = cuenta === 'trabajo' ? 'https://outlook.office.com' : 'https://outlook.live.com';
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: cita.titulo,
    startdt: new Date(cita.inicio).toISOString(),
    enddt: new Date(cita.fin).toISOString(),
    body: [cita.descripcion, cita.url].filter(Boolean).join('\n\n'),
    location: cita.lugar || '',
  });
  return `${host}/calendar/0/deeplink/compose?${p.toString()}`;
}

module.exports = { generarIcs, enlaceGoogle, enlaceOutlook, escapar, plegar, fechaUtc };
