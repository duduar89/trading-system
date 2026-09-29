'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generarIcs, enlaceGoogle, enlaceOutlook, escapar, plegar } = require('./ics');
const T = require('../tiempo');

const cita = {
  uid: 'cita-1234@iemec-clinic.com',
  inicio: T.desdeMadrid('2026-10-06', '17:00'),
  fin: T.desdeMadrid('2026-10-06', '17:45'),
  titulo: 'IEMEC · Relleno de labios',
  descripcion: 'Con la Dra. García, cabina 1.\nSi necesitas cambiarla, contesta a nuestro WhatsApp.',
  lugar: 'IEMEC, Av. Siglo XXI 13, local 35, 28660 Boadilla del Monte, Madrid',
  lat: 40.40543, lng: -3.87321,
  url: 'https://agenda.iemec-clinic.com/c/abc123',
  secuencia: 0,
};
const ahora = new Date('2026-09-29T10:00:00Z');

test('el .ics tiene la estructura mínima y las horas en UTC', () => {
  const ics = generarIcs(cita, { ahora });
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /\r\nMETHOD:PUBLISH\r\n/);
  assert.match(ics, /\r\nDTSTART:20261006T150000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20261006T154500Z\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20260929T100000Z\r\n/);
  assert.match(ics, /\r\nUID:cita-1234@iemec-clinic\.com\r\n/);
  assert.match(ics, /\r\nSTATUS:CONFIRMED\r\n/);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.match(ics, /TRIGGER:-PT1440M/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'todas las líneas acaban en CRLF');
});

test('ninguna línea pasa de 75 octetos y el plegado no rompe tildes', () => {
  const ics = generarIcs({ ...cita, descripcion: 'Información útil: añade tu cita, ¿vale? '.repeat(8) }, { ahora });
  for (const linea of ics.split('\r\n')) assert.ok(Buffer.byteLength(linea, 'utf8') <= 75, linea);
  const desplegado = ics.replace(/\r\n /g, '');
  assert.match(desplegado, /DESCRIPTION:Información útil: añade tu cita\\, ¿vale\?/);
  assert.equal(plegar('corta'), 'corta');
});

test('escapa comas, puntos y comas, barras y saltos de línea', () => {
  assert.equal(escapar('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('un cambio sube SEQUENCE con el mismo UID; una anulación va CANCELLED y sin avisos', () => {
  const cambio = generarIcs({ ...cita, secuencia: 1 }, { ahora });
  assert.match(cambio, /\r\nSEQUENCE:1\r\n/);
  assert.match(cambio, /UID:cita-1234@iemec-clinic\.com/);
  const anulada = generarIcs({ ...cita, secuencia: 2, cancelada: true }, { ahora });
  assert.match(anulada, /\r\nSTATUS:CANCELLED\r\n/);
  assert.match(anulada, /SUMMARY:Cancelada: IEMEC · Relleno de labios/);
  assert.ok(!anulada.includes('VALARM'));
});

test('sin UID o con fechas al revés, no genera nada', () => {
  assert.throws(() => generarIcs({ ...cita, uid: '' }), /UID/);
  assert.throws(() => generarIcs({ ...cita, fin: cita.inicio }), /acaba antes/);
});

test('enlace de Google Calendar con fechas UTC', () => {
  const u = new URL(enlaceGoogle(cita));
  assert.equal(u.origin, 'https://calendar.google.com');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('dates'), '20261006T150000Z/20261006T154500Z');
  assert.match(u.searchParams.get('details'), /agenda\.iemec-clinic\.com/);
});

test('enlace de Outlook (personal y trabajo)', () => {
  const u = new URL(enlaceOutlook(cita));
  assert.equal(u.origin, 'https://outlook.live.com');
  assert.equal(u.searchParams.get('rru'), 'addevent');
  assert.equal(u.searchParams.get('startdt'), '2026-10-06T15:00:00.000Z');
  assert.equal(new URL(enlaceOutlook(cita, { cuenta: 'trabajo' })).origin, 'https://outlook.office.com');
});
