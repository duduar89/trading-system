'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICAL = require('ical.js');
const { generarIcs, enlaceGoogle, enlaceOutlook, enlaceMapa, dispositivo, lugarDe, direccionPostal, textoSede, escapar, plegar, disparo } = require('./ics');
const T = require('../tiempo');

// La sede de IEMEC con los datos públicos de su web.
const SEDE = { nombre: 'IEMEC', direccion: 'Av. Siglo XXI, 13, local 35', cp: '28660', municipio: 'Boadilla del Monte', provincia: 'Madrid', lat: 40.4066059, lng: -3.9001441 };
const URL_CITA = 'https://agenda.iemec-clinic.com/c/EJEMPLO-token-no-valido-EJEMPLO-token-nova1';
const cita = {
  uid: '05c184a3-a17e-4cfe-9271-5cdae3cd91de',
  inicio: T.desdeMadrid('2026-10-06', '17:00'),
  fin: T.desdeMadrid('2026-10-06', '17:45'),
  titulo: 'Cita en IEMEC',
  descripcion: `Tu cita en IEMEC. Para verla, cambiarla o cancelarla: ${URL_CITA}`,
  lugar: lugarDe(SEDE),
  lat: SEDE.lat, lng: SEDE.lng,
  url: URL_CITA,
  secuencia: 0,
};
const ahora = new Date('2026-09-29T10:00:00Z');
const desplegar = (ics) => ics.replace(/\r\n /g, '');

// Lo que lee un calendario de verdad (ical.js, el parser de Thunderbird).
function leer(ics) {
  const cal = new ICAL.Component(ICAL.parse(ics));
  const ev = cal.getFirstSubcomponent('vevent');
  return { cal, ev, evento: new ICAL.Event(ev) };
}

test('el .ics es válido y discreto: «Cita en IEMEC», privado, sin organizador y con la hora en UTC', () => {
  const ics = generarIcs(cita, { ahora });
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/IEMEC\/\/Agenda IEMEC\/\/ES\r\n/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'todas las líneas acaban en CRLF');
  for (const linea of ics.split('\r\n')) assert.ok(Buffer.byteLength(linea, 'utf8') <= 75, linea);

  const { cal, ev, evento } = leer(ics);
  assert.equal(cal.getFirstPropertyValue('method'), 'PUBLISH');
  assert.equal(evento.uid, cita.uid);
  assert.equal(evento.summary, 'Cita en IEMEC');
  assert.equal(evento.sequence, 0);
  assert.equal(ev.getFirstPropertyValue('status'), 'CONFIRMED');
  assert.equal(ev.getFirstPropertyValue('class'), 'PRIVATE');
  assert.equal(ev.getFirstPropertyValue('transp'), 'OPAQUE');
  assert.equal(ev.getFirstPropertyValue('url'), URL_CITA);
  assert.deepEqual(ev.getFirstPropertyValue('geo'), [40.406606, -3.900144]);
  assert.equal(evento.location, 'IEMEC, Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid');
  assert.equal(evento.description, cita.descripcion);
  assert.equal(ev.getFirstProperty('organizer'), null);
  assert.equal(ev.getFirstProperty('attendee'), null);
  // 17:00 en Madrid (horario de verano) son las 15:00 UTC; dura 45 minutos.
  assert.equal(evento.startDate.toJSDate().toISOString(), '2026-10-06T15:00:00.000Z');
  assert.equal(evento.endDate.toJSDate().toISOString(), '2026-10-06T15:45:00.000Z');
  assert.equal(evento.startDate.zone.tzid, 'UTC');
  assert.equal(ev.getFirstPropertyValue('dtstamp').toJSDate().toISOString(), '2026-09-29T10:00:00.000Z');

  // Dos avisos, el día antes y 2 horas antes, que tampoco nombran nada más que «Cita en IEMEC».
  const alarmas = ev.getAllSubcomponents('valarm');
  assert.deepEqual(alarmas.map((a) => a.getFirstPropertyValue('trigger').toString()), ['-P1D', '-PT2H']);
  assert.deepEqual(alarmas.map((a) => [a.getFirstPropertyValue('action'), a.getFirstPropertyValue('description')]), [['DISPLAY', 'Cita en IEMEC'], ['DISPLAY', 'Cita en IEMEC']]);
});

test('una anulación sube SEQUENCE con el mismo UID, va CANCELLED y sin avisos', () => {
  const { ev, evento } = leer(generarIcs({ ...cita, secuencia: 1, cancelada: true }, { ahora }));
  assert.equal(evento.uid, cita.uid);
  assert.equal(evento.sequence, 1);
  assert.equal(ev.getFirstPropertyValue('status'), 'CANCELLED');
  assert.equal(evento.summary, 'Cancelada: Cita en IEMEC');
  assert.deepEqual(ev.getAllSubcomponents('valarm'), []);
});

test('ninguna línea pasa de 75 octetos y el plegado no rompe tildes', () => {
  const ics = generarIcs({ ...cita, descripcion: 'Información útil: añade tu cita, ¿vale? '.repeat(8) }, { ahora });
  for (const linea of ics.split('\r\n')) assert.ok(Buffer.byteLength(linea, 'utf8') <= 75, linea);
  assert.match(desplegar(ics), /DESCRIPTION:Información útil: añade tu cita\\, ¿vale\?/);
  assert.equal(leer(ics).evento.description, 'Información útil: añade tu cita, ¿vale? '.repeat(8), 'ical.js lo lee entero');
  assert.equal(plegar('corta'), 'corta');
});

test('escapa comas, puntos y comas, barras y saltos de línea; avisos en días, horas o minutos', () => {
  assert.equal(escapar('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  assert.deepEqual([1440, 2880, 120, 45].map(disparo), ['-P1D', '-P2D', '-PT2H', '-PT45M']);
});

test('sin UID o con fechas al revés, no genera nada', () => {
  assert.throws(() => generarIcs({ ...cita, uid: '' }), /UID/);
  assert.throws(() => generarIcs({ ...cita, fin: cita.inicio }), /acaba antes/);
});

test('la sede: LOCATION, la dirección del mapa y la de los mensajes', () => {
  assert.equal(lugarDe(SEDE), 'IEMEC, Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid');
  assert.equal(direccionPostal(SEDE), 'Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid');
  assert.equal(textoSede(SEDE), 'IEMEC (Av. Siglo XXI, 13, local 35, Boadilla del Monte)');
  assert.equal(textoSede({ nombre: 'IEMEC' }), 'IEMEC');
  assert.equal(lugarDe(null), '');
});

test('enlace de Google Calendar: render, fechas UTC con Z, zona de Madrid y privado', () => {
  const u = new URL(enlaceGoogle(cita));
  assert.equal(`${u.origin}${u.pathname}`, 'https://calendar.google.com/calendar/render');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('text'), 'Cita en IEMEC');
  assert.equal(u.searchParams.get('dates'), '20261006T150000Z/20261006T154500Z');
  assert.equal(u.searchParams.get('ctz'), 'Europe/Madrid');
  assert.equal(u.searchParams.get('icc'), 'PRIVATE');
  assert.equal(u.searchParams.get('location'), 'IEMEC, Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid');
  assert.equal(u.searchParams.get('details'), cita.descripcion);
});

test('enlace de Outlook (personal y trabajo), sin milisegundos', () => {
  const u = new URL(enlaceOutlook(cita));
  assert.equal(u.origin, 'https://outlook.live.com');
  assert.equal(u.pathname, '/calendar/0/deeplink/compose');
  assert.equal(u.searchParams.get('path'), '/calendar/action/compose');
  assert.equal(u.searchParams.get('rru'), 'addevent');
  assert.equal(u.searchParams.get('subject'), 'Cita en IEMEC');
  assert.equal(u.searchParams.get('startdt'), '2026-10-06T15:00:00Z');
  assert.equal(u.searchParams.get('enddt'), '2026-10-06T15:45:00Z');
  assert.equal(new URL(enlaceOutlook(cita, { cuenta: 'trabajo' })).origin, 'https://outlook.office.com');
});

test('«Cómo llegar»: Apple Maps en iPhone y Mac, Google Maps en lo demás', () => {
  assert.equal(enlaceMapa(SEDE, 'apple'), 'https://maps.apple.com/?daddr=40.4066059%2C-3.9001441&q=IEMEC');
  assert.equal(enlaceMapa(SEDE, 'android'), 'https://www.google.com/maps/dir/?api=1&destination=40.4066059%2C-3.9001441');
  assert.equal(enlaceMapa(null), null);
});

test('«Añadir al calendario»: a qué calendario va según el dispositivo', () => {
  const UA = {
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    ipadComoMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1',
    iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15',
    androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    windowsPhone: 'Mozilla/5.0 (Mobile; Windows Phone 8.1; Android 4.0; ARM; Trident/7.0; Touch; rv:11.0; IEMobile/11.0; NOKIA; Lumia 635) like iPhone OS 7_0_3 Mac OS X AppleWebKit/537 (KHTML, like Gecko) Mobile Safari/537',
    vistaPreviaWhatsApp: 'WhatsApp/2.23.20.0',
  };
  const r = Object.fromEntries(Object.entries(UA).map(([k, ua]) => [k, dispositivo(ua)]));
  assert.deepEqual(r, {
    iphoneSafari: 'apple', ipad: 'apple', ipadComoMac: 'apple', macChrome: 'apple',
    iphoneChrome: 'otro', iphoneFirefox: 'otro', // el .ics no llega a Calendario: a la página
    androidChrome: 'android', samsung: 'android',
    windows: 'otro', windowsPhone: 'otro', vistaPreviaWhatsApp: 'otro',
  });
  assert.equal(dispositivo(undefined), 'otro');
});
