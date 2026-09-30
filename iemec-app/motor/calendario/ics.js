'use strict';
// La cita, para el calendario del paciente: fichero .ics (RFC 5545, METHOD:PUBLISH) y enlaces de
// «añadir a Google / Outlook». Horas en UTC (sufijo Z): todos los calendarios las pasan a la hora
// local del teléfono, así no hace falta incrustar la zona horaria ni dependemos del cambio de hora.
//
// Discreto: el título y los avisos dicen «Cita en IEMEC» (se leen en la pantalla bloqueada y el
// calendario se sincroniza con iCloud, Google o Exchange); ni el tratamiento ni la cabina salen de
// aquí. Sin ORGANIZER ni ATTENDEE: es una cita que el paciente guarda, no una invitación.
//
// Cambios y anulaciones: el UID es un UUID aleatorio guardado en la cita (RFC 7986: sin datos del
// servidor ni del número de cita). Anular sube SEQUENCE con el mismo UID. Si cambia la hora o la
// sede, es otra cita con otro UID y la vieja sale anulada: Apple no actualiza un evento importado
// aunque llegue con el mismo UID y una SEQUENCE mayor, así que se le pide borrar la anterior.

const PRODID = '-//IEMEC//Agenda IEMEC//ES';
const AVISOS_MIN = [1440, 120]; // el día antes y 2 horas antes

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

// 20261006T150000Z
function fechaUtc(instante) {
  return new Date(instante).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// 2026-10-06T15:00:00Z (Outlook: el formato que funciona no lleva milisegundos)
function isoSinMs(instante) {
  return new Date(instante).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Minutos antes de la cita → duración de RFC 5545: 1440 → -P1D, 120 → -PT2H, 45 → -PT45M.
function disparo(min) {
  if (min % 1440 === 0) return `-P${min / 1440}D`;
  if (min % 60 === 0) return `-PT${min / 60}H`;
  return `-PT${min}M`;
}

// La dirección de la sede: «Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid» (la del
// mapa de WhatsApp); con su nombre delante, la de LOCATION y los enlaces. Para los mensajes, la
// corta: «Av. Siglo XXI, 13, local 35, Boadilla del Monte».
function direccionPostal(sede) {
  if (!sede) return '';
  const cpMunicipio = [sede.cp, sede.municipio].filter(Boolean).join(' ');
  return [sede.direccion, cpMunicipio, sede.provincia].filter(Boolean).join(', ');
}

function lugarDe(sede) {
  if (!sede) return '';
  return [sede.nombre, direccionPostal(sede)].filter(Boolean).join(', ');
}

function direccionCorta(sede) {
  if (!sede) return '';
  return [sede.direccion, sede.municipio].filter(Boolean).join(', ');
}

// «IEMEC (Av. Siglo XXI, 13, local 35, Boadilla del Monte)»: dónde, en una frase.
function textoSede(sede) {
  if (!sede) return '';
  const d = direccionCorta(sede);
  return d ? `${sede.nombre} (${d})` : sede.nombre;
}

/**
 * @param {object} cita
 *   uid, inicio, fin (Date), titulo, descripcion, lugar, lat, lng, url, secuencia (número),
 *   cancelada (bool), avisos (minutos antes, por defecto el día antes y 2 horas antes)
 */
function generarIcs(cita, { ahora = new Date() } = {}) {
  if (!cita.uid) throw new Error('La cita necesita un UID estable');
  if (!(new Date(cita.fin) > new Date(cita.inicio))) throw new Error('La cita acaba antes de empezar');
  const titulo = cita.titulo || 'Cita en IEMEC';
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${cita.uid}`,
    `DTSTAMP:${fechaUtc(ahora)}`,
    `SEQUENCE:${cita.secuencia || 0}`,
    `STATUS:${cita.cancelada ? 'CANCELLED' : 'CONFIRMED'}`,
    `DTSTART:${fechaUtc(cita.inicio)}`,
    `DTEND:${fechaUtc(cita.fin)}`,
    `SUMMARY:${escapar(cita.cancelada ? `Cancelada: ${titulo}` : titulo)}`,
  ];
  if (cita.descripcion) lineas.push(`DESCRIPTION:${escapar(cita.descripcion)}`);
  if (cita.lugar) lineas.push(`LOCATION:${escapar(cita.lugar)}`);
  if (cita.lat != null && cita.lng != null) lineas.push(`GEO:${Number(cita.lat).toFixed(6)};${Number(cita.lng).toFixed(6)}`);
  if (cita.url) lineas.push(`URL:${cita.url}`);
  lineas.push('CLASS:PRIVATE', 'TRANSP:OPAQUE');
  if (!cita.cancelada) {
    for (const min of cita.avisos || AVISOS_MIN) {
      lineas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapar(titulo)}`, `TRIGGER:${disparo(min)}`, 'END:VALARM');
    }
  }
  lineas.push('END:VEVENT', 'END:VCALENDAR');
  return lineas.map(plegar).join('\r\n') + '\r\n';
}

// Google Calendar (sin documentación oficial vigente; parámetros comprobados por la comunidad):
// «render» es la variante que en Android llega al editor; las dos fechas con Z se leen como UTC;
// icc=PRIVATE la deja privada. No lleva UID: cada toque crea un evento nuevo.
function enlaceGoogle(cita) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: cita.titulo || 'Cita en IEMEC',
    dates: `${fechaUtc(cita.inicio)}/${fechaUtc(cita.fin)}`,
    ctz: 'Europe/Madrid',
    details: cita.descripcion || cita.url || '',
    location: cita.lugar || '',
    icc: 'PRIVATE',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

function enlaceOutlook(cita, { cuenta = 'personal' } = {}) {
  const host = cuenta === 'trabajo' ? 'https://outlook.office.com' : 'https://outlook.live.com';
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: cita.titulo || 'Cita en IEMEC',
    startdt: isoSinMs(cita.inicio),
    enddt: isoSinMs(cita.fin),
    body: cita.descripcion || cita.url || '',
    location: cita.lugar || '',
  });
  return `${host}/calendar/0/deeplink/compose?${p.toString()}`;
}

// «Cómo llegar»: Apple Maps en iPhone, iPad y Mac; Google Maps en lo demás. Solo es un enlace: la
// página no carga nada de ninguno de los dos.
function enlaceMapa(sede, dispositivo = 'otro') {
  if (!sede) return null;
  const destino = sede.lat != null && sede.lng != null ? `${Number(sede.lat)},${Number(sede.lng)}` : lugarDe(sede);
  if (dispositivo === 'apple') return `https://maps.apple.com/?${new URLSearchParams({ daddr: destino, q: sede.nombre || '' })}`;
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: destino })}`;
}

// ¿A qué calendario va el botón «Añadir al calendario»? iPhone, iPad y Mac → el .ics (Safari se lo
// pasa a Calendario, que enseña «Añadir»); Android → Google Calendar (la app de Google no importa
// .ics). En un iPhone o un iPad con otro navegador (Chrome, Firefox, la app de Google…, también en
// modo escritorio, cuando el iPad dice ser un Mac) el .ics no llega a Calendario: a la página, con todas
// las opciones. En lo demás (ordenador, WhatsApp de escritorio, Windows Phone) no se sabe cuál usa:
// también a la página.
const IOS = /\b(iPhone|iPad|iPod)\b/;
const IOS_OTRO_NAVEGADOR = /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|GSA|YaBrowser|DuckDuckGo|Brave|FBAN|FBAV|Instagram|Line)\//;
function dispositivo(userAgent = '') {
  const ua = String(userAgent || '');
  if (/Windows Phone|IEMobile/.test(ua)) return 'otro';
  if (/\bAndroid\b/.test(ua)) return 'android';
  if (IOS.test(ua) || /\bMacintosh\b|\bMac OS X\b/.test(ua)) return IOS_OTRO_NAVEGADOR.test(ua) ? 'otro' : 'apple';
  return 'otro';
}

module.exports = {
  generarIcs, enlaceGoogle, enlaceOutlook, enlaceMapa, dispositivo, lugarDe, direccionPostal, direccionCorta, textoSede,
  escapar, plegar, fechaUtc, isoSinMs, disparo, AVISOS_MIN,
};
