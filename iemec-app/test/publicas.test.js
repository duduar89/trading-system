'use strict';
// La cita que le llega al paciente, con la app entera y el puerto de verdad: su página según cómo
// esté la cita, el .ics con sus cabeceras, «Añadir al calendario» (/cal/) según el dispositivo,
// confirmar y cancelar (solo antes de que empiece), el enlace que caduca y nada de terceros.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ICAL = require('ical.js');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { crearApp } = require('../servidor/index');
const agenda = require('../servidor/agenda');
const config = require('../servidor/config');
const T = require('../motor/tiempo');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  ordenador: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};
const RESERVADA = new Date('2026-09-29T08:00:00Z');
const en = (fecha, hora) => T.desdeMadrid(fecha, hora);

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

async function sembrar(pool) {
  // La ficha de la clínica tiene otra dirección y otras coordenadas: el calendario usa las de la sede.
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, cp, municipio, lat, lng, whatsapp, google_place_id) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', '28660', 'Boadilla del Monte', 40.4054, -3.8732, '+34722833285', 'ChIJiemec')");
  for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  // Una sede inventada para lo que se hace fuera (el quirófano externo).
  const [sede] = await pool.query("INSERT INTO sedes (codigo, nombre, direccion, cp, municipio, provincia, lat, lng, indicaciones) VALUES ('hospital-ejemplo', 'Hospital de ejemplo', 'Calle Inventada, 1', '28000', 'Madrid', 'Madrid', 40.43, -3.72, 'Planta 2, mostrador de admisión')");
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'consulta-1', 'Consulta 1', 'consulta_medica'), (3, 'consulta-3', 'Consulta 3', 'consulta_medica')");
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo, sede_id) VALUES (2, 'quirofano-1', 'Quirófano 1', 'quirofano', ?)", [sede.insertId]);
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (10, 'medico-1', 'Dra. Ejemplo', 'medico')");
  for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (10, ?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial'), ('cirugia_estetica', 'Cirugía estética')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, rol_profesional, sala_tipo, regimen_legal) VALUES
    ('valoracion-facial', 'Valoración facial', 'facial', 45, 'medico', 'consulta_medica', 'servicio'),
    ('cirugia-ejemplo', 'Cirugía de ejemplo', 'cirugia_estetica', 60, 'medico', 'quirofano', 'cirugia')`);
  await pool.query('INSERT INTO tratamiento_salas (tratamiento_id, sala_id) VALUES (?, 1)', ['valoracion-facial']);
  const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Laura', '+34611000200')");
  return p.insertId;
}

// Lo que lee un calendario de verdad.
function leerIcs(texto) {
  const cal = new ICAL.Component(ICAL.parse(texto));
  const ev = cal.getFirstSubcomponent('vevent');
  return { cal, ev, evento: new ICAL.Event(ev) };
}

// Nada de terceros: ni scripts, ni hojas de estilo, ni imágenes, ni fuentes de otro sitio.
function sinTerceros(html) {
  assert.doesNotMatch(html, /<script/i);
  for (const [, url] of html.matchAll(/<(?:link|img|source|iframe)[^>]+(?:href|src)="([^"]+)"/gi)) assert.match(url, /^\//, `recurso de fuera: ${url}`);
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|gstatic|googletagmanager/);
}

test('«Tu cita»: la página según el estado, el .ics y «Añadir al calendario» con un toque', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const pacienteId = await sembrar(pool);
    const reservar = (fecha, hora, extra = {}) => agenda.reservar(pool, { pacienteId, tratamientoId: 'valoracion-facial', fecha, hora, ahora: RESERVADA, ...extra });
    const cita = await reservar('2026-10-06', '17:00');

    // La app entera, con un reloj que el paciente no puede tocar (req.ahora solo lo pone el servidor).
    const reloj = { ahora: new Date('2026-10-01T08:00:00Z') };
    const app = express();
    app.use((req, _res, next) => { req.ahora = reloj.ahora; next(); });
    app.use(crearApp({ pool }));
    await conServidor(app, async (base) => {
      const pedir = (ruta, { ua = UA.ordenador, ...o } = {}) => fetch(`${base}${ruta}`, { redirect: 'manual', ...o, headers: { 'User-Agent': ua, ...(o.headers || {}) } });
      const pagina = async (ruta, o) => (await pedir(ruta, o)).text();
      const cabecerasPrivadas = (r) => {
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      };

      await t.test('confirmada: fecha, tratamiento, profesional, sala y sede con «Cómo llegar»; el calendario del dispositivo, destacado', async () => {
        const r = await pedir(`/c/${cita.token}`, { ua: UA.iphone });
        assert.equal(r.status, 200);
        cabecerasPrivadas(r);
        assert.match(r.headers.get('content-security-policy'), /default-src 'none'.*form-action 'self'.*frame-ancestors 'none'/);
        assert.match(r.headers.get('vary'), /User-Agent/i);
        const html = await r.text();
        sinTerceros(html);
        assert.match(html, /<title>Tu cita · IEMEC<\/title>/, 'título genérico');
        assert.match(html, /name="robots" content="noindex, nofollow"/);
        assert.match(html, /martes 6 de octubre, a las 17:00/);
        assert.match(html, /Valoración facial/, 'la página sí dice el tratamiento');
        assert.match(html, /Dra\. Ejemplo/);
        assert.match(html, /Consulta 1<span class="nota">Te acompañamos desde recepción/, 'la sala, al día');
        assert.match(html, /Av\. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid/, 'la dirección de la sede');
        assert.match(html, /href="https:\/\/maps\.apple\.com\/\?daddr=40\.4066059%2C-3\.9001441&amp;q=IEMEC"[^>]*>Cómo llegar/);
        assert.match(html, new RegExp(`<a class="btn lleno" href="/c/${cita.token}\\.ics">Añadir a mi calendario</a>`), 'en iPhone, el .ics');
        assert.match(html, /href="https:\/\/calendar\.google\.com\/calendar\/render\?[^"]+"[^>]*>Google Calendar</);
        assert.match(html, /href="https:\/\/outlook\.live\.com\/[^"]+"[^>]*>Outlook</);
        assert.match(html, /href="https:\/\/outlook\.office\.com\/[^"]+"[^>]*>Outlook \(trabajo\)</);
        assert.match(html, /rel="noopener noreferrer">Google Calendar/, 'a Google no le llega de dónde viene');
        assert.match(html, /Cambiarla por WhatsApp/);
        assert.match(html, new RegExp(`action="/c/${cita.token}/cancelar"`));

        const android = await pagina(`/c/${cita.token}`, { ua: UA.android });
        assert.match(android, /<a class="btn lleno" href="https:\/\/calendar\.google\.com\/calendar\/render\?[^"]+" rel="noopener noreferrer">Añadir a Google Calendar<\/a>/);
        assert.match(android, new RegExp(`href="/c/${cita.token}\\.ics">Apple y otros \\(\\.ics\\)`));
        assert.match(android, /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=40\.4066059%2C-3\.9001441"/);
        const ordenador = await pagina(`/c/${cita.token}`);
        assert.doesNotMatch(ordenador, /btn lleno" href="(\/c\/|https:\/\/calendar)/, 'en el ordenador no se sabe cuál usa: todos iguales');
        for (const x of ['Apple y otros', 'Google Calendar', '>Outlook<', 'Outlook \\(trabajo\\)']) assert.match(ordenador, new RegExp(x));
      });

      await t.test('el .ics: cabeceras, «Cita en IEMEC», sede, UID de la cita y sin tratamiento ni cabina', async () => {
        const r = await pedir(`/c/${cita.token}.ics`);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('content-type'), 'text/calendar; charset=utf-8; method=PUBLISH');
        assert.equal(r.headers.get('content-disposition'), 'inline; filename="cita-iemec-2026-10-06.ics"', 'nombre con la fecha, sin el número de cita');
        cabecerasPrivadas(r);
        const texto = await r.text();
        assert.doesNotMatch(texto, /Valoración|Consulta|Dra\.|Laura/, 'ni tratamiento, ni cabina, ni profesional, ni paciente');
        const { cal, ev, evento } = leerIcs(texto);
        assert.equal(cal.getFirstPropertyValue('method'), 'PUBLISH');
        assert.equal(evento.uid, cita.uidIcs);
        assert.match(evento.uid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'un UUID aleatorio');
        assert.equal(evento.summary, 'Cita en IEMEC');
        assert.equal(ev.getFirstPropertyValue('class'), 'PRIVATE');
        assert.equal(evento.startDate.toJSDate().toISOString(), '2026-10-06T15:00:00.000Z');
        assert.equal(evento.endDate.toJSDate().toISOString(), '2026-10-06T15:45:00.000Z');
        assert.equal(evento.location, 'IEMEC, Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid');
        assert.deepEqual(ev.getFirstPropertyValue('geo'), [40.406606, -3.900144]);
        assert.equal(ev.getFirstPropertyValue('url'), `${config.urlPublica}/c/${cita.token}`);
        assert.equal(evento.description, `Tu cita en IEMEC. Para verla, cambiarla o cancelarla: ${config.urlPublica}/c/${cita.token}`);
        assert.deepEqual(ev.getAllSubcomponents('valarm').map((a) => a.getFirstPropertyValue('trigger').toString()), ['-P1D', '-PT2H']);
      });

      await t.test('/cal/: iPhone, iPad y Mac → el .ics; Android → Google; iPhone con Chrome y el ordenador → la página', async () => {
        const destino = async (ua) => {
          const r = await pedir(`/cal/${cita.token}`, { ua });
          assert.equal(r.status, 302);
          cabecerasPrivadas(r);
          assert.match(r.headers.get('vary'), /User-Agent/i);
          return r.headers.get('location');
        };
        assert.equal(await destino(UA.iphone), `/c/${cita.token}.ics`);
        assert.equal(await destino(UA.mac), `/c/${cita.token}.ics`);
        const google = new URL(await destino(UA.android));
        assert.equal(`${google.origin}${google.pathname}`, 'https://calendar.google.com/calendar/render');
        assert.equal(google.searchParams.get('dates'), '20261006T150000Z/20261006T154500Z');
        assert.equal(google.searchParams.get('text'), 'Cita en IEMEC');
        assert.equal(google.searchParams.get('icc'), 'PRIVATE');
        assert.equal(google.searchParams.get('location'), 'IEMEC, Av. Siglo XXI, 13, local 35, 28660 Boadilla del Monte, Madrid');
        assert.equal(await destino(UA.iphoneChrome), `/c/${cita.token}`);
        assert.equal(await destino(UA.ordenador), `/c/${cita.token}`);
      });

      await t.test('lo que no existe: 404 (también con un token bien formado)', async () => {
        for (const ruta of ['/c/noexiste', `/c/${'x'.repeat(43)}`, `/c/${'x'.repeat(43)}.ics`, `/cal/${'x'.repeat(43)}`]) {
          const r = await pedir(ruta);
          assert.equal(r.status, 404, ruta);
          cabecerasPrivadas(r);
        }
      });

      await t.test('en otra sede (el quirófano externo): su dirección, su mapa y sus indicaciones', async () => {
        const fuera = await agenda.reservar(pool, { pacienteId, tratamientoId: 'cirugia-ejemplo', fecha: '2026-10-09', hora: '12:00', ahora: RESERVADA });
        const html = await pagina(`/c/${fuera.token}`, { ua: UA.android });
        assert.match(html, /Hospital de ejemplo<span class="nota">Calle Inventada, 1, 28000 Madrid, Madrid<\/span><span class="nota">Planta 2, mostrador de admisión/);
        assert.match(html, /destination=40\.43%2C-3\.72/);
        const { ev, evento } = leerIcs(await pagina(`/c/${fuera.token}.ics`));
        assert.equal(evento.location, 'Hospital de ejemplo, Calle Inventada, 1, 28000 Madrid, Madrid');
        assert.deepEqual(ev.getFirstPropertyValue('geo'), [40.43, -3.72]);
      });

      await t.test('retenida: «Confirma tu cita» sin calendario ni cancelar; al confirmarla, ya con calendario', async () => {
        const ret = await reservar('2026-10-07', '12:00', { retener: true, retenerMin: 60 * 24, ahora: new Date('2026-10-01T07:30:00Z') });
        const html = await pagina(`/c/${ret.token}`, { ua: UA.iphone });
        assert.match(html, /<h1>Confirma tu cita<\/h1>/);
        assert.match(html, /Te guardamos este hueco hasta el viernes 2 de octubre, a las 09:30\. Confírmalo para que quede reservado\./, 'si no es hoy, con el día');
        const hoy = await reservar('2026-10-07', '15:00', { retener: true, retenerMin: 30, ahora: new Date('2026-10-01T07:50:00Z') });
        assert.match(await pagina(`/c/${hoy.token}`), /Te guardamos este hueco hasta las 10:20\./);
        assert.match(html, new RegExp(`action="/c/${ret.token}/confirmar"`));
        assert.doesNotMatch(html, /Añadir a|\.ics|Google Calendar|Cancelar la cita/, 'la retención puede caducar: sin calendario');
        assert.equal((await pedir(`/cal/${ret.token}`, { ua: UA.iphone })).headers.get('location'), `/c/${ret.token}`);
        const ics = await pedir(`/c/${ret.token}.ics`);
        assert.equal(ics.status, 303);
        assert.equal(ics.headers.get('location'), `/c/${ret.token}`);

        const conf = await (await pedir(`/c/${ret.token}/confirmar`, { method: 'POST', ua: UA.iphone })).text();
        assert.match(conf, /Cita confirmada\. ¡Te esperamos!/);
        assert.match(conf, /Añadir a mi calendario/);
        assert.equal((await pedir(`/cal/${ret.token}`, { ua: UA.iphone })).headers.get('location'), `/c/${ret.token}.ics`);
      });

      await t.test('un hueco retenido que caducó: «Hueco liberado», sin confirmar', async () => {
        const ret = await reservar('2026-10-08', '12:00', { retener: true, retenerMin: 15, ahora: new Date('2026-10-01T07:30:00Z') });
        const html = await pagina(`/c/${ret.token}`);
        assert.match(html, /<h1>Hueco liberado<\/h1>/);
        assert.doesNotMatch(html, /Confirmar mi cita|Añadir|Cancelar la cita/);
        const post = await (await pedir(`/c/${ret.token}/confirmar`, { method: 'POST' })).text();
        assert.match(post, /El hueco se ha liberado/);
        await agenda.caducarRetenciones(pool, reloj.ahora);
        assert.match(await pagina(`/c/${ret.token}`), /<h1>Hueco liberado<\/h1>/, 'también cuando el cron la cancela');
      });

      await t.test('cancelar: «Cita cancelada», bórrala de tu calendario; el .ics sale anulado', async () => {
        const c = await reservar('2026-10-13', '17:00');
        const canc = await pedir(`/c/${c.token}/cancelar`, { method: 'POST', ua: UA.iphone });
        assert.equal(canc.status, 200);
        cabecerasPrivadas(canc);
        const html = await canc.text();
        assert.match(html, /<h1>Cita cancelada<\/h1>/);
        assert.match(html, /Cita cancelada\. Cuando quieras, te buscamos otro hueco por WhatsApp\./);
        assert.match(html, /Si la añadiste a tu calendario, bórrala\./);
        assert.match(html, /Pedir otra cita por WhatsApp/);
        assert.doesNotMatch(html, /Añadir a|Google Calendar|Cancelar la cita/, 'sin .ics para añadir');
        const { ev, evento } = leerIcs(await pagina(`/c/${c.token}.ics`));
        assert.equal(evento.uid, c.uidIcs, 'el mismo UID');
        assert.equal(evento.sequence, 1);
        assert.equal(ev.getFirstPropertyValue('status'), 'CANCELLED');
        assert.deepEqual(ev.getAllSubcomponents('valarm'), []);
        assert.equal((await pedir(`/cal/${c.token}`, { ua: UA.iphone })).headers.get('location'), `/c/${c.token}`, 'no se añade');
      });

      await t.test('reprogramada: «Cita cambiada» con el enlace a la última; la vieja, anulada con su UID; la nueva, con otro', async () => {
        const vieja = await reservar('2026-10-14', '17:00');
        const nueva = await reservar('2026-10-15', '17:00', { reprograma: vieja.id, ahora: new Date('2026-10-01T07:00:00Z') });
        const otra = await reservar('2026-10-16', '17:00', { reprograma: nueva.id, ahora: new Date('2026-10-01T07:30:00Z') });
        const html = await pagina(`/c/${vieja.token}`);
        assert.match(html, /<h1>Cita cambiada<\/h1>/);
        assert.match(html, /Antes: miércoles 14 de octubre, a las 17:00/);
        assert.match(html, /Tu cita ha cambiado: ahora es el viernes 16 de octubre, a las 17:00\./, 'la última, aunque cambiara dos veces');
        assert.match(html, new RegExp(`<a class="btn lleno" href="/c/${otra.token}">Ver mi nueva cita</a>`));
        assert.match(html, /bórrala y añade la nueva/);
        assert.doesNotMatch(html, /Cancelar la cita|Añadir a/);
        const antes = leerIcs(await pagina(`/c/${vieja.token}.ics`));
        const despues = leerIcs(await pagina(`/c/${otra.token}.ics`));
        assert.equal(antes.evento.uid, vieja.uidIcs);
        assert.equal(antes.ev.getFirstPropertyValue('status'), 'CANCELLED');
        assert.equal(antes.evento.sequence, 1, 'la vieja, con SEQUENCE mayor');
        assert.equal(antes.evento.description, `Esta cita se ha cambiado. Tu nueva cita: ${config.urlPublica}/c/${otra.token}`);
        assert.equal(despues.ev.getFirstPropertyValue('status'), 'CONFIRMED');
        assert.equal(despues.evento.sequence, 0);
        assert.notEqual(despues.evento.uid, antes.evento.uid, 'otro evento: Apple no actualiza uno importado');
      });

      await t.test('empezada: ni cancelar ni calendario; después, recepción la marca y la página lo dice', async () => {
        const otra = await reservar('2026-10-20', '17:00');
        reloj.ahora = en('2026-10-20', '17:10');
        const empezada = await pagina(`/c/${otra.token}`);
        assert.doesNotMatch(empezada, /Cancelar la cita|Añadir a/);
        assert.match(empezada, /Esta cita ya ha empezado/);
        assert.equal((await pedir(`/c/${otra.token}.ics`)).status, 410, 'ya no hay nada que añadir');
        assert.equal((await pedir(`/cal/${otra.token}`, { ua: UA.iphone })).headers.get('location'), `/c/${otra.token}`);
        reloj.ahora = en('2026-10-20', '17:40');
        const tarde = await (await pedir(`/c/${otra.token}/cancelar`, { method: 'POST' })).text();
        assert.match(tarde, /La cita ya ha empezado: desde aquí ya no se puede cancelar/);
        const [[sigue]] = await pool.query('SELECT estado FROM citas WHERE id = ?', [otra.id]);
        assert.equal(sigue.estado, 'confirmada');

        await agenda.cambiarEstado(pool, { id: otra.id, a: 'no_presentada', actor: 'recepcion@iemec', ahora: reloj.ahora });
        const noVino = await pagina(`/c/${otra.token}`);
        assert.match(noVino, /Te echamos de menos en esta cita/);
        assert.match(noVino, /Buscar otro hueco por WhatsApp/);
        assert.doesNotMatch(noVino, /Cancelar la cita|Cambiarla por WhatsApp|Añadir a/);
        await agenda.cambiarEstado(pool, { id: otra.id, a: 'completada', actor: 'recepcion@iemec', ahora: reloj.ahora });
        const hecha = await pagina(`/c/${otra.token}`);
        assert.match(hecha, /¡Gracias por venir!/);
        assert.doesNotMatch(hecha, /Cancelar la cita|Cambiarla por WhatsApp|Te echamos de menos|Añadir a/);
      });

      await t.test('llegada: tampoco se cancela ni se cambia', async () => {
        const c = await reservar('2026-10-21', '17:00');
        reloj.ahora = en('2026-10-21', '16:50');
        await agenda.cambiarEstado(pool, { id: c.id, a: 'llegada', actor: 'recepcion@iemec', ahora: reloj.ahora });
        const html = await pagina(`/c/${c.token}`);
        assert.match(html, /¡Gracias por venir!/);
        assert.doesNotMatch(html, /Cancelar la cita|Cambiarla por WhatsApp|Añadir a/);
        const post = await (await pedir(`/c/${c.token}/cancelar`, { method: 'POST' })).text();
        assert.match(post, /No se ha podido hacer el cambio/);
      });

      await t.test('pasada y sin marcar: «Esta cita ya pasó»', async () => {
        const c = await reservar('2026-10-22', '12:00');
        reloj.ahora = en('2026-10-22', '15:00');
        const html = await pagina(`/c/${c.token}`);
        assert.match(html, /Esta cita ya pasó\./);
        assert.doesNotMatch(html, /Cancelar la cita|Añadir a/);
      });

      await t.test('30 días después de la cita, el enlace caduca: 410 y sin datos de la cita', async () => {
        reloj.ahora = new Date(new Date(cita.fin).getTime() + 30 * 86400000 - 60000);
        assert.equal((await pedir(`/c/${cita.token}`)).status, 200, 'un minuto antes, aún vale');
        reloj.ahora = new Date(new Date(cita.fin).getTime() + 30 * 86400000);
        for (const [ruta, metodo] of [[`/c/${cita.token}`, 'GET'], [`/cal/${cita.token}`, 'GET'], [`/c/${cita.token}.ics`, 'GET'], [`/c/${cita.token}/cancelar`, 'POST']]) {
          const r = await pedir(ruta, { method: metodo });
          assert.equal(r.status, 410, ruta);
          cabecerasPrivadas(r);
          const html = await r.text();
          assert.doesNotMatch(html, /octubre|Valoración|Dra\.|Siglo XXI/, 'un enlace viejo no enseña nada de la cita');
        }
        assert.match(await pagina(`/c/${cita.token}`), /<h1>Enlace caducado<\/h1>[\s\S]*Escribir por WhatsApp/);
      });

      await t.test('robots.txt: ni /c/ ni /cal/ se indexan; la reseña sigue yendo a Google', async () => {
        const robots = await pagina('/robots.txt');
        assert.match(robots, /^User-agent: \*$/m);
        assert.match(robots, /^Disallow: \/c\/$/m);
        assert.match(robots, /^Disallow: \/cal\/$/m);
        const r = await pedir('/r/abcdefghijklmnopqrstuv');
        assert.equal(r.status, 302);
        assert.equal(r.headers.get('location'), 'https://search.google.com/local/writereview?placeid=ChIJiemec');
        assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
      });
    });
  } finally {
    await pool.end();
  }
});
