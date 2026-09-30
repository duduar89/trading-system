'use strict';
// El panel de punta a punta en un Chromium de verdad (criterio de salida de la F5): recepción recorre
// cada pantalla con la demostración (scripts/demo.js) cargada en su propia base (la de las pruebas con
// «_panel» al final) y a una hora fija, el martes 6 de octubre de 2026 a las 12:05 de Madrid: la del
// servidor (req.ahora), la del navegador (su reloj) y la de la base (SET timestamp). El servidor va con
// MODO_DEMO=1 en un puerto libre, con WhatsApp, la IA y Google simulados, y sirve el panel compilado (se
// compila si falta). Nada sale a internet: lo de fuera (Google…) se contesta en el propio navegador.
//
// Además de cada flujo, en cada pantalla (y con el detalle de una cita, una conversación o un
// formulario abiertos): a 390 px nada desborda a lo ancho, el texto se lee en oscuro y en claro, cada
// control tiene nombre accesible y el foco se ve. Y ni un error en la consola.
// Se salta sola si no hay navegador (en CI no se instala: npx playwright install chromium) o MariaDB.
/* global document -- lo que va dentro de pagina.evaluate corre en el navegador */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const express = require('express');
const { prepararBdDePrueba, BD_PRUEBAS } = require('./ayuda-bd');
const { lanzarNavegador, compilarPanelSiHaceFalta, revisarPantalla, contrastes, desbordes } = require('./ayuda-navegador');
const { cargarDemo } = require('../scripts/demo');
const { crearApp } = require('../servidor/index');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { crearGoogle } = require('../servidor/integraciones/google');
const T = require('../motor/tiempo');

const HOY = '2026-10-06';
const MANANA = '2026-10-07';
const AHORA = T.desdeMadrid(HOY, '12:05');
const TITULOS = {
  hoy: 'Buenos días, IEMEC', tareas: 'Tareas', agenda: 'martes, 6 de octubre', espera: 'Lista de espera',
  conversaciones: 'Conversaciones', seguimientos: 'Seguimientos programados', repesca: 'Repesca',
  plantillas: 'Plantillas de WhatsApp', resenas: 'Reseñas y ficha de Google', ajustes: 'Cabinas y tratamientos',
};
const ANCHO = { width: 1280, height: 900 };
const MOVIL = { width: 390, height: 844 };
const euros = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const soloCifras = (s) => String(s).replace(/\D/g, '');
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cuantas = (n, una, varias) => `${n} ${Number(n) === 1 ? una : varias}`;

// El foco de cada clase de control se mira una vez por tema en toda la prueba.
const FOCO_VISTO = { dark: new Set(), light: new Set() };

// Lo que se mira siempre, con la pantalla como esté: en claro y en oscuro a lo ancho (contraste,
// nombres, foco y desbordes) y a 390 px en oscuro (desbordes y contraste). Lo que falla se apunta.
async function revisar(pagina, donde, problemas) {
  await pagina.evaluate(() => document.fonts.ready);
  try {
    for (const [tema, nombre] of [['dark', 'oscuro'], ['light', 'claro']]) {
      await pagina.emulateMedia({ colorScheme: tema });
      const r = await revisarPantalla(pagina, { vistos: FOCO_VISTO[tema] });
      for (const [que, lista] of Object.entries(r)) for (const m of lista) problemas.push(`${donde} · ${nombre} · ${que}: ${m}`);
    }
    await pagina.setViewportSize(MOVIL);
    await pagina.emulateMedia({ colorScheme: 'dark' });
    for (const m of await pagina.evaluate(desbordes)) problemas.push(`${donde} · 390 px · desborda: ${m}`);
    for (const m of await contrastes(pagina)) problemas.push(`${donde} · 390 px oscuro · contraste: ${m}`);
  } finally {
    // Pase lo que pase, la página vuelve a como estaba: a lo ancho y en claro.
    await pagina.setViewportSize(ANCHO);
    await pagina.emulateMedia({ colorScheme: 'light' });
  }
}

// Espera a que se cumpla algo de la base (lo que cambia la pantalla ya lo ha guardado el servidor,
// pero la pantalla puede ir un poco por delante de la respuesta).
async function hasta(fn, { ms = 5000 } = {}) {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > limite) return v;
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

test('el panel de punta a punta en Chromium, con la demostración a una hora fija', { timeout: 300000 }, async (t) => {
  const navegador = await lanzarNavegador();
  if (!navegador) { t.skip('sin Chromium para Playwright'); return; }
  const pool = await prepararBdDePrueba(t, { sufijo: '_panel' });
  if (!pool) { await navegador.close(); return; }
  const modoDemo = process.env.MODO_DEMO;
  let servidor;
  try {
    // La base también vive a esa hora: lo que se guarda con CURRENT_TIMESTAMP.
    pool.on('connection', (c) => c.query('SET timestamp = ?', [AHORA.getTime() / 1000]));
    await cargarDemo({ pool, bd: { ...BD_PRUEBAS, database: `${BD_PRUEBAS.database}_panel` }, ahora: AHORA, log: () => {} });
    compilarPanelSiHaceFalta();

    const whatsapp = crearWhatsApp('simulado');
    const google = crearGoogle('simulado');
    process.env.MODO_DEMO = '1';
    const app = express();
    app.use((req, _res, next) => { req.ahora = AHORA; next(); });
    app.use(crearApp({ pool, deps: { ia: crearIa('simulado'), whatsapp, google } }));
    servidor = app.listen(0);
    await new Promise((ok) => servidor.once('listening', ok));
    const base = `http://127.0.0.1:${servidor.address().port}`;

    const contexto = await navegador.newContext({ serviceWorkers: 'block', locale: 'es-ES', timezoneId: 'Europe/Madrid', reducedMotion: 'reduce', viewport: ANCHO });
    await contexto.clock.setFixedTime(AHORA);
    const fuera = [];
    const FUERA = '<!doctype html><html lang="es"><title>Fuera</title><p>Fuera de la clínica</p></html>';
    await contexto.route('**/*', async (ruta) => {
      const url = ruta.request().url();
      if (!url.startsWith(`${base}/`)) {
        fuera.push(url);
        return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FUERA });
      }
      // Una redirección fuera (el enlace de la reseña lleva a Google) no se sigue: se apunta adónde iba.
      if (new URL(url).pathname.startsWith('/r/')) {
        const r = await ruta.fetch({ maxRedirects: 0 });
        const destino = r.headers().location;
        if (r.status() >= 300 && r.status() < 400 && destino && !destino.startsWith(base)) {
          fuera.push(destino);
          return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FUERA });
        }
        return ruta.fulfill({ response: r });
      }
      return ruta.continue();
    });
    const errores = [];
    let caida = false;
    contexto.on('page', (p) => {
      p.on('console', (m) => { if (m.type() === 'error') errores.push(`${p.url()} · ${m.text()}`); });
      p.on('pageerror', (e) => errores.push(`${p.url()} · ${e.message}`));
      p.on('crash', () => { caida = true; errores.push(`${p.url()} · la pestaña se ha caído (crash)`); });
    });
    let pagina = await contexto.newPage();
    // Cada vez, el panel recién abierto en esa sección (con otra dirección: si solo cambiara el #, la
    // pantalla que ya estaba abierta seguiría como estaba). Si la pestaña se cayó, falla la prueba en
    // la que pasó (queda en los errores) y las siguientes siguen en otra.
    let visitas = 0;
    const ir = async (seccion) => {
      if (caida) { caida = false; await pagina.close().catch(() => {}); pagina = await contexto.newPage(); }
      await pagina.goto(`${base}/?visita=${++visitas}#${seccion}`);
      await pagina.getByRole('heading', { level: 1, name: TITULOS[seccion], exact: true }).waitFor();
    };
    const q = async (sql, args = []) => (await pool.query(sql, args))[0];
    const cifra = async (etiqueta) => pagina.locator('.tarjeta', { has: pagina.getByText(etiqueta, { exact: true }) }).locator('.cifras').first().innerText();
    const sinErrores = () => assert.deepEqual(errores.splice(0), [], 'ningún error en la consola');
    const [hoy0, manana0] = [T.desdeMadrid(HOY, '00:00'), T.desdeMadrid(MANANA, '00:00')];
    const citasDelDia = async (desde, hasta) => (await q("SELECT COUNT(*) AS n FROM citas WHERE inicio >= ? AND inicio < ? AND estado NOT IN ('cancelada','reprogramada')", [desde, hasta]))[0].n;
    // La tarjeta de una cita en la agenda: «Lucía M., 11:00, Tratamiento…: confirmada. Abrir la cita».
    const tarjeta = (cita, estado = 'confirmada') => pagina.getByRole('button', {
      name: new RegExp(`^${escapar(`${cita.nombre} ${cita.apellidos[0]}., ${cita.hora}, ${cita.tratamiento}: ${estado}.`)} Abrir la cita$`),
    });
    const citaDe = async (sql, args) => {
      const [c] = await q(`SELECT c.id, c.inicio, c.token, p.nombre, p.apellidos, t.nombre AS tratamiento FROM citas c JOIN pacientes p ON p.id = c.paciente_id
        JOIN tratamientos t ON t.id = c.tratamiento_id WHERE ${sql} ORDER BY c.inicio, c.id LIMIT 1`, args);
      return c && { ...c, hora: T.partesMadrid(c.inicio).hora };
    };

    await t.test('Hoy: las cifras del día y lo que necesita a una persona', async () => {
      const problemas = [];
      await ir('hoy');
      const [ia] = await q("SELECT COUNT(*) AS n FROM conversaciones WHERE estado IN ('ia_activa','esperando_paciente')");
      const [seg] = await q("SELECT COUNT(*) AS n FROM seguimientos WHERE estado = 'pendiente' AND programado_para >= ? AND programado_para < ?", [hoy0, manana0]);
      const [rec] = await q(`SELECT COALESCE(SUM(t.precio_eur), 0) AS euros FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id
        WHERE c.creado_en >= ? AND c.origen = 'ia_whatsapp' AND c.estado NOT IN ('cancelada','reprogramada','retenida','no_presentada')`, [T.desdeMadrid('2026-10-01', '00:00')]);
      const citas = await citasDelDia(hoy0, manana0);
      assert.ok(citas >= 5, 'la demo pone citas hoy');
      assert.equal(await cifra('Citas hoy'), String(citas));
      assert.equal(await cifra('La IA atiende'), String(ia.n));
      assert.equal(await cifra('Seguimientos hoy'), String(seg.n));
      assert.equal(soloCifras(await cifra('Recuperado este mes')), soloCifras(euros(Number(rec.euros))));
      const [espera] = await q("SELECT COUNT(*) AS n FROM conversaciones WHERE estado = 'espera_persona'");
      const [tareas] = await q("SELECT COUNT(*) AS n FROM tareas WHERE estado = 'abierta' AND vence_en < ?", [AHORA]);
      await pagina.getByRole('link', { name: `${cuantas(espera.n, 'conversación espera', 'conversaciones esperan')} a una persona` }).waitFor();
      await revisar(pagina, 'Hoy', problemas);
      await pagina.getByRole('link', { name: `${cuantas(tareas.n, 'tarea vencida', 'tareas vencidas')} (llamadas, aprobaciones)` }).click();
      await pagina.getByRole('heading', { level: 1, name: 'Tareas' }).waitFor();
      assert.equal(new URL(pagina.url()).hash, '#tareas');
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Tareas: hecha, descartada y «Ver chat» lleva a la conversación', async () => {
      const problemas = [];
      await ir('tareas');
      const abiertas = await q("SELECT id, titulo, conversacion_id FROM tareas WHERE estado = 'abierta' ORDER BY id");
      assert.ok(abiertas.length >= 3, 'la demo deja tareas abiertas');
      for (const a of abiertas) await pagina.getByRole('listitem').filter({ hasText: a.titulo }).waitFor();
      await pagina.getByText(/^Vencida/).first().waitFor();
      await revisar(pagina, 'Tareas', problemas);
      // La de la conversación que espera a una persona se queda: la resuelve «Conversaciones».
      const [espera] = await q("SELECT id FROM conversaciones WHERE estado = 'espera_persona' AND ventana_hasta > ? ORDER BY id LIMIT 1", [AHORA]);
      const deEsa = abiertas.find((a) => a.conversacion_id === espera.id);
      const [hecha, descartada] = abiertas.filter((a) => a !== deEsa);
      const fila = (a) => pagina.getByRole('listitem').filter({ hasText: a.titulo });
      await fila(hecha).getByRole('button', { name: 'Hecha' }).click();
      await fila(hecha).waitFor({ state: 'detached' });
      await fila(descartada).getByRole('button', { name: 'Descartar' }).click();
      await fila(descartada).waitFor({ state: 'detached' });
      const estado = async (a) => (await q('SELECT estado FROM tareas WHERE id = ?', [a.id]))[0].estado;
      assert.deepEqual([await estado(hecha), await estado(descartada), await estado(deEsa)], ['hecha', 'cancelada', 'abierta']);
      const [evento] = await q("SELECT actor FROM eventos WHERE tipo = 'tarea_hecha' AND entidad_id = ?", [String(hecha.id)]);
      assert.equal(evento.actor, 'demo@iemec', 'queda quién la cerró');
      await fila(deEsa).getByRole('link', { name: 'Ver chat' }).click();
      await pagina.getByRole('heading', { level: 1, name: 'Conversaciones' }).waitFor();
      assert.equal(new URL(pagina.url()).hash, `#conversaciones/${espera.id}`);
      await pagina.getByRole('button', { name: 'Devolver a la IA' }).waitFor();
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Agenda por cabina y por profesional, y cambiando de día', async () => {
      const problemas = [];
      await ir('agenda');
      const salas = await q('SELECT nombre FROM salas WHERE activa ORDER BY orden, id');
      const rejilla = pagina.locator('.tarjeta.overflow-x-auto');
      for (const s of salas) await rejilla.getByText(s.nombre, { exact: true }).waitFor();
      const citas = await citasDelDia(hoy0, manana0);
      await pagina.getByText(`${citas} citas`, { exact: true }).waitFor();
      assert.equal(await pagina.getByRole('button', { name: 'Por cabina' }).getAttribute('aria-pressed'), 'true');
      await revisar(pagina, 'Agenda por cabina', problemas);

      await pagina.getByRole('button', { name: 'Por profesional' }).click();
      assert.equal(await pagina.getByRole('button', { name: 'Por profesional' }).getAttribute('aria-pressed'), 'true');
      const trabajan = await q('SELECT DISTINCT p.nombre FROM profesionales p JOIN profesional_horarios h ON h.profesional_id = p.id WHERE p.activo AND h.dia_semana = 2');
      const noTrabajan = await q('SELECT nombre FROM profesionales WHERE activo AND id NOT IN (SELECT profesional_id FROM profesional_horarios WHERE dia_semana = 2)');
      for (const p of trabajan) await rejilla.getByText(p.nombre, { exact: true }).waitFor();
      for (const p of noTrabajan) assert.equal(await rejilla.getByText(p.nombre, { exact: true }).count(), 0, `${p.nombre} no trabaja los martes`);
      await rejilla.getByText(/^Comida flotante · 45 min garantizados$/).first().waitFor();
      await revisar(pagina, 'Agenda por profesional', problemas);

      await pagina.getByRole('button', { name: 'Día siguiente' }).click();
      await pagina.getByRole('heading', { level: 1, name: 'miércoles, 7 de octubre' }).waitFor();
      await pagina.getByText(`${await citasDelDia(manana0, T.desdeMadrid('2026-10-08', '00:00'))} citas`, { exact: true }).waitFor();
      await pagina.getByRole('button', { name: 'Día anterior' }).click();
      await pagina.getByRole('button', { name: 'Día anterior' }).click();
      await pagina.getByRole('heading', { level: 1, name: 'lunes, 5 de octubre' }).waitFor();
      assert.equal((await q("SELECT COUNT(*) AS n FROM festivos WHERE fecha = '2026-10-05'"))[0].n, 1, 'el lunes 5 es fiesta en Boadilla');
      await pagina.getByText('Festivo: la clínica no abre').waitFor();
      await pagina.getByRole('button', { name: 'Hoy', exact: true }).click();
      await pagina.getByRole('heading', { level: 1, name: 'martes, 6 de octubre' }).waitFor();
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Agenda: abrir una cita, «Ha llegado», «Completada» y deshacer los dos', async () => {
      const problemas = [];
      await ir('agenda');
      // La primera cita de hoy, que ya ha empezado (a las 12:05).
      const cita = await citaDe("c.estado = 'confirmada' AND c.inicio >= ? AND c.inicio < ?", [hoy0, AHORA]);
      assert.ok(cita, 'hay una cita empezada');
      const estado = async () => (await q('SELECT estado FROM citas WHERE id = ?', [cita.id]))[0].estado;
      await tarjeta(cita).click();
      const dialogo = pagina.getByRole('dialog', { name: `${cita.nombre} ${cita.apellidos}` });
      await dialogo.waitFor();
      await dialogo.getByText(cita.tratamiento, { exact: true }).waitFor();
      const aviso = dialogo.getByRole('status');
      await dialogo.getByRole('button', { name: 'No vino' }).waitFor();

      await dialogo.getByRole('button', { name: 'Ha llegado' }).click();
      await aviso.filter({ hasText: /^Marcada como «Ha llegado»\.$/ }).waitFor();
      assert.equal(await estado(), 'llegada');
      await dialogo.getByText('Llegó a las 12:05').waitFor();

      await dialogo.getByRole('button', { name: 'Completada' }).click();
      await aviso.filter({ hasText: /^Marcada como «Completada»\. Le pediremos su opinión el martes, 6 de octubre a las \d\d:\d\d\./ }).waitFor();
      assert.equal(await estado(), 'completada');
      const [peticion] = await q('SELECT estado FROM peticiones_resena WHERE cita_id = ?', [cita.id]);
      assert.equal(peticion.estado, 'programada', 'la reseña se pide sola más tarde');
      await revisar(pagina, 'Agenda · detalle de la cita', problemas);

      await dialogo.getByRole('button', { name: 'Deshacer «Completada»' }).click();
      await aviso.filter({ hasText: 'Deshecho: la cita vuelve a «Ha llegado». La petición de reseña queda anulada.' }).waitFor();
      assert.equal(await estado(), 'llegada');
      assert.deepEqual(await q('SELECT id FROM peticiones_resena WHERE cita_id = ?', [cita.id]), []);
      await dialogo.getByRole('button', { name: 'Deshacer «Ha llegado»' }).click();
      await aviso.filter({ hasText: 'Deshecho: la cita vuelve a «Confirmada».' }).waitFor();
      assert.equal(await estado(), 'confirmada');
      const cambios = await q("SELECT tipo, actor FROM eventos WHERE entidad = 'cita' AND entidad_id = ? AND tipo <> 'cita_reservada' ORDER BY id", [String(cita.id)]);
      assert.deepEqual(cambios.map((e) => e.tipo), ['cita_llegada', 'cita_completada', 'cita_estado_deshecho', 'cita_estado_deshecho']);
      assert.ok(cambios.every((e) => e.actor === 'demo@iemec'));

      // Se cierra con Esc y el foco vuelve a la tarjeta de la cita.
      await pagina.keyboard.press('Escape');
      await dialogo.waitFor({ state: 'hidden' });
      assert.match(await pagina.evaluate(() => document.activeElement?.getAttribute('aria-label') || ''), new RegExp(`^${escapar(`${cita.nombre} ${cita.apellidos[0]}., ${cita.hora}`)}`));
      await tarjeta(cita).waitFor();
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Conversaciones: tomar, devolver a la IA, escribir con la ventana abierta y plantilla con ella cerrada', async () => {
      const problemas = [];
      await ir('conversaciones');
      const [conv] = await q(`SELECT c.id, c.telefono, l.nombre FROM conversaciones c JOIN leads l ON l.id = c.lead_id
        WHERE c.estado = 'espera_persona' AND c.ventana_hasta > ? ORDER BY c.id LIMIT 1`, [AHORA]);
      const estado = async (id = conv.id) => (await q('SELECT estado FROM conversaciones WHERE id = ?', [id]))[0].estado;
      const [tarea] = await q("SELECT id FROM tareas WHERE conversacion_id = ? AND estado = 'abierta'", [conv.id]);
      assert.ok(tarea, 'tiene su tarea de contestar');
      await pagina.getByRole('button', { name: new RegExp(`^${escapar(conv.nombre)}`) }).click();
      assert.equal(new URL(pagina.url()).hash, `#conversaciones/${conv.id}`);
      const cabecera = pagina.locator('.titulo', { hasText: conv.nombre });
      await cabecera.waitFor();
      await pagina.getByRole('button', { name: 'Tomar' }).click();
      await pagina.getByRole('button', { name: 'Tomar' }).waitFor({ state: 'detached' });
      assert.equal(await estado(), 'persona');
      await pagina.getByText('La lleva una persona').first().waitFor();
      await revisar(pagina, 'Conversaciones · la lleva una persona', problemas);

      await pagina.getByRole('button', { name: 'Devolver a la IA' }).click();
      await pagina.getByRole('button', { name: 'Tomar' }).waitFor();
      assert.equal(await estado(), 'ia_activa');
      assert.equal((await q('SELECT estado FROM tareas WHERE id = ?', [tarea.id]))[0].estado, 'hecha', 'su tarea de contestar queda hecha');

      const texto = 'Hola, soy Marta, de recepción: te llamo en un rato y lo vemos con calma.';
      const chat = pagina.locator('ol');
      await pagina.getByRole('textbox', { name: 'Mensaje' }).fill(texto);
      await pagina.getByRole('button', { name: 'Enviar', exact: true }).click();
      await chat.getByText(texto, { exact: true }).waitFor();
      assert.equal(await pagina.getByRole('textbox', { name: 'Mensaje' }).inputValue(), '', 'el cuadro se vacía');
      assert.equal(await pagina.getByRole('alert').count(), 0);
      assert.deepEqual({ ...whatsapp.enviados.at(-1), waId: null }, { waId: null, telefono: conv.telefono, tipo: 'texto', texto });
      assert.equal(await estado(), 'persona', 'si escribe una persona, la lleva ella');

      // Con la ventana de 24 h cerrada (le escribimos, pero no ha contestado): solo plantilla.
      const [cerrada] = await q(`SELECT c.id, c.telefono, p.nombre, p.apellidos FROM conversaciones c JOIN pacientes p ON p.id = c.paciente_id
        WHERE (c.ventana_hasta IS NULL OR c.ventana_hasta <= ?) AND c.estado <> 'cerrada' ORDER BY c.id LIMIT 1`, [AHORA]);
      assert.ok(cerrada, 'la demo tiene una conversación con la ventana cerrada');
      await pagina.getByRole('button', { name: new RegExp(`^${escapar(`${cerrada.nombre} ${cerrada.apellidos}`)}`) }).click();
      await pagina.getByText('Pasaron 24 h desde su último mensaje: solo con plantilla aprobada.').waitFor();
      assert.equal(await pagina.getByRole('textbox', { name: 'Mensaje' }).count(), 0);
      const plantilla = pagina.getByRole('combobox', { name: 'Plantilla' });
      const opciones = await plantilla.locator('option').allTextContents();
      assert.ok(opciones.includes('como quedamos'));
      assert.ok(!opciones.includes('cita confirmacion') && !opciones.includes('resena'), 'lo que lleva el enlace de una cita o una reseña sale solo');
      await plantilla.selectOption({ label: 'como quedamos' });
      assert.equal(await pagina.getByRole('textbox', { name: 'Dato 1' }).inputValue(), cerrada.nombre, 'el nombre con que se le saluda, ya puesto');
      const enviarPlantilla = pagina.getByRole('button', { name: 'Enviar plantilla' });
      assert.equal(await enviarPlantilla.isDisabled(), true, 'sin rellenar {{2}} no se puede mandar');
      await pagina.getByRole('textbox', { name: 'Dato 2' }).fill('tu depilación láser');
      const final = `Hola ${cerrada.nombre}, como quedamos, te escribo para buscarte hueco para tu depilación láser. ¿Te viene bien esta semana o la que viene? Si no quieres recibir más mensajes como este, responde BAJA.`;
      await pagina.getByText(final, { exact: true }).waitFor();
      await revisar(pagina, 'Conversaciones · plantilla con la ventana cerrada', problemas);
      await enviarPlantilla.click();
      await chat.getByText(final, { exact: true }).waitFor();
      await chat.getByText(/^Plantilla aprobada · Equipo/).waitFor();
      const ultimo = whatsapp.enviados.at(-1);
      assert.deepEqual({ ...ultimo, waId: null }, { waId: null, telefono: cerrada.telefono, tipo: 'plantilla', nombre: 'iemec_como_quedamos', idioma: 'es', variables: [cerrada.nombre, 'tu depilación láser'], botonUrl: null });
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Seguimientos: cambiar la fecha de uno y cancelar otro', async () => {
      const problemas = [];
      await ir('seguimientos');
      const pendientes = await q(`SELECT s.id, COALESCE(p.nombre, l.nombre) AS nombre FROM seguimientos s LEFT JOIN pacientes p ON p.id = s.paciente_id
        LEFT JOIN leads l ON l.id = s.lead_id WHERE s.estado = 'pendiente' ORDER BY s.programado_para DESC`);
      assert.ok(pendientes.length >= 2, 'la demo deja seguimientos');
      const [cambia, cancela] = pendientes;
      const fila = (s) => pagina.getByRole('listitem').filter({ hasText: s.nombre });
      await fila(cambia).getByRole('button', { name: 'Cambiar fecha' }).click();
      await fila(cambia).getByLabel('Fecha').fill('2026-10-20');
      await fila(cambia).getByLabel('Hora').fill('10:30');
      await revisar(pagina, 'Seguimientos · cambiando la fecha', problemas);
      await fila(cambia).getByRole('button', { name: 'Guardar' }).click();
      const dia = pagina.locator('section', { has: pagina.getByRole('heading', { name: /^martes, 20 de octubre$/i }) });
      await dia.getByRole('listitem').filter({ hasText: cambia.nombre }).filter({ hasText: 'cambiado a mano' }).waitFor();
      const [s1] = await q('SELECT programado_para, creado_por FROM seguimientos WHERE id = ?', [cambia.id]);
      assert.deepEqual([s1.programado_para.toISOString(), s1.creado_por], [T.desdeMadrid('2026-10-20', '10:30').toISOString(), 'persona']);

      await fila(cancela).getByRole('button', { name: 'Cancelar' }).click();
      await fila(cancela).waitFor({ state: 'detached' });
      const [s2] = await q('SELECT estado FROM seguimientos WHERE id = ?', [cancela.id]);
      assert.equal(s2.estado, 'cancelado');
      await revisar(pagina, 'Seguimientos', problemas);
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Repesca: los embudos con los datos de la demo', async () => {
      const problemas = [];
      await ir('repesca');
      const [leads] = await q('SELECT COUNT(*) AS n FROM leads');
      const pres = Object.fromEntries((await q('SELECT estado, SUM(importe_eur) AS euros FROM presupuestos GROUP BY estado')).map((p) => [p.estado, Number(p.euros)]));
      assert.equal(await cifra('Leads'), String(leads.n));
      assert.equal(soloCifras(await cifra('Presupuestos aceptados')), soloCifras(euros(pres.aceptado)));
      assert.equal(soloCifras(await cifra('Presupuestos pendientes')), soloCifras(euros(pres.entregado)));
      const embudo = pagina.getByRole('figure', { name: 'Embudo de leads' });
      const etapas = await q('SELECT etapa, COUNT(*) AS n FROM leads GROUP BY etapa');
      assert.equal(await embudo.getByRole('row').count(), etapas.length);
      const ETAPA = { nuevo: 'Nuevos', contactado: 'Contactados', conversando: 'Conversando', cita: 'Con cita', asistio: 'Vinieron', vendido: 'Compraron', perdido: 'Perdidos' };
      for (const e of etapas) {
        assert.equal(await embudo.getByRole('row', { name: new RegExp(`^${ETAPA[e.etapa]}`) }).getByRole('cell').last().innerText(), String(e.n));
      }
      for (const figura of ['Qué contestan los pacientes', 'De dónde vienen los leads', 'Por qué se cierran']) {
        assert.ok(await pagina.getByRole('figure', { name: figura }).getByRole('row').count() > 0, `«${figura}» con datos`);
      }
      await revisar(pagina, 'Repesca', problemas);
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Plantillas: un borrador que pasa y el filtro legal que rechaza «toxina botulínica»', async () => {
      const problemas = [];
      await ir('plantillas');
      const [n] = await q('SELECT COUNT(*) AS n FROM plantillas');
      assert.equal(await pagina.locator('main li.tarjeta').count(), n.n);
      await pagina.getByLabel('Nombre').fill('iemec_otono_facial');
      await pagina.getByLabel('Tipo').selectOption('marketing');
      await pagina.getByLabel(/^Texto/).fill('Hola {{1}}, en IEMEC tenemos huecos esta semana para tu valoración facial. Si no quieres recibir más mensajes como este, responde BAJA.');
      await pagina.getByRole('button', { name: 'Comprobar' }).click();
      await pagina.getByText('Lista para enviar a Meta.').waitFor();

      await pagina.getByLabel(/^Texto/).fill('Hola {{1}}, este otoño en IEMEC tienes la toxina botulínica con un 20 % de descuento. Si no quieres recibir más mensajes como este, responde BAJA.');
      await pagina.getByRole('button', { name: 'Comprobar' }).click();
      await pagina.getByText('Hay que corregirla:').waitFor();
      await pagina.getByRole('listitem').filter({ hasText: /^Nombra un medicamento con receta \(toxina botulinica.*\) en un mensaje publicitario: no se puede anunciar al público\.$/ }).waitFor();
      assert.equal(await pagina.getByText('Lista para enviar a Meta.').count(), 0);
      await revisar(pagina, 'Plantillas · rechazada por el filtro legal', problemas);
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Reseñas: aprobar y publicar una respuesta en Google (simulado), y la que nombra un tratamiento no sale', async () => {
      const problemas = [];
      await ir('resenas');
      const resenas = await q("SELECT id, google_id, autor, borrador_respuesta FROM resenas WHERE estado = 'borrador' ORDER BY publicada_en DESC");
      assert.equal(await cifra('Sin responder'), String(resenas.length));
      await revisar(pagina, 'Reseñas', problemas);
      const [una, otra] = resenas;
      const tarjetaDe = (r) => pagina.getByRole('listitem').filter({ hasText: r.autor });
      const respuesta = `${una.borrador_respuesta} ¡Hasta pronto!`;
      await tarjetaDe(una).getByRole('textbox').fill(respuesta);
      await tarjetaDe(una).getByRole('button', { name: 'Aprobar y publicar' }).click();
      await tarjetaDe(una).getByText('Respuesta publicada').waitFor();
      await tarjetaDe(una).getByText(respuesta).waitFor();
      assert.equal(await tarjetaDe(una).getByRole('button', { name: 'Aprobar y publicar' }).count(), 0);
      assert.deepEqual(google.publicadas, [{ googleId: una.google_id, texto: respuesta }]);
      const [r1] = await q('SELECT estado, aprobada_por FROM resenas WHERE id = ?', [una.id]);
      assert.deepEqual([r1.estado, r1.aprobada_por], ['publicada', 'demo@iemec']);
      assert.equal(await hasta(async () => (await cifra('Sin responder')) === String(resenas.length - 1)), true, 'una menos sin responder');

      // Una reseña es pública: si la respuesta nombra un tratamiento, no se publica.
      await tarjetaDe(otra).getByRole('textbox').fill('Gracias por confiar en nosotros para tu tratamiento de toxina, te esperamos.');
      await tarjetaDe(otra).getByRole('button', { name: 'Aprobar y publicar' }).click();
      await pagina.getByRole('alert').filter({ hasText: 'La respuesta nombra un tratamiento' }).waitFor();
      assert.equal(google.publicadas.length, 1);
      assert.equal((await q('SELECT estado FROM resenas WHERE id = ?', [otra.id]))[0].estado, 'borrador');
      assert.deepEqual(problemas, []);
      // La respuesta que no vale deja su aviso (400) en la consola del navegador: es lo esperado.
      assert.deepEqual(errores.splice(0).filter((e) => !/status of 400/.test(e)), []);
    });

    await t.test('Lista de espera: apuntar a alguien desde recepción y quitarle', async () => {
      const problemas = [];
      await ir('espera');
      await pagina.getByRole('heading', { name: 'Ofertas en curso' }).waitFor();
      await pagina.getByRole('button', { name: 'Apuntar a alguien' }).click();
      await pagina.getByRole('textbox', { name: /^Móvil/ }).fill('612 34 56 78');
      await pagina.getByRole('textbox', { name: /^Nombre/ }).fill('Inés Prueba');
      const [trat] = await q("SELECT id, nombre FROM tratamientos WHERE activo AND reservable_ia AND familia = 'facial' ORDER BY id LIMIT 1");
      await pagina.getByRole('combobox', { name: /^Tratamiento/ }).selectOption(trat.id);
      await pagina.getByRole('combobox', { name: /^Franja/ }).selectOption('manana');
      await revisar(pagina, 'Lista de espera · apuntar', problemas);
      await pagina.getByRole('button', { name: 'Apuntar en la lista' }).click();
      await pagina.getByRole('status').filter({ hasText: /^Apuntado en la lista: Inés/ }).waitFor();
      const [entrada] = await q("SELECT le.id, le.estado, le.franjas, le.tratamiento_id FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id WHERE p.telefono = '+34612345678'");
      assert.deepEqual([entrada.estado, entrada.franjas, entrada.tratamiento_id], ['esperando', 'manana', trat.id]);
      const fila = pagina.getByRole('listitem').filter({ hasText: trat.nombre }).filter({ hasText: 'Inés' });
      await fila.getByText('Por la mañana', { exact: false }).waitFor();
      pagina.once('dialog', (d) => d.accept());
      await fila.getByRole('button', { name: 'Quitar' }).click();
      await fila.waitFor({ state: 'detached' });
      assert.equal((await q('SELECT estado FROM lista_espera WHERE id = ?', [entrada.id]))[0].estado, 'cancelado');
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('Cabinas y tratamientos: se marca una sala y la agenda la respeta', async () => {
      const problemas = [];
      await ir('ajustes');
      // Un tratamiento de estética sin aparato que hoy solo se hace en la cabina corporal: se pasa a la facial.
      const [t0] = await q(`SELECT t.id, t.nombre FROM tratamientos t JOIN tratamiento_salas ts ON ts.tratamiento_id = t.id JOIN salas s ON s.id = ts.sala_id
        WHERE t.activo AND t.equipo_codigo IS NULL AND t.rol_profesional = 'esteticista' AND s.nombre = 'Cabina corporal'
          AND (SELECT COUNT(*) FROM tratamiento_salas x WHERE x.tratamiento_id = t.id) = 1 ORDER BY t.id LIMIT 1`);
      assert.ok(t0, 'hay un tratamiento de la cabina corporal que se puede pasar a la facial');
      await revisar(pagina, 'Cabinas y tratamientos', problemas);
      await pagina.getByLabel('Buscar tratamiento').fill(t0.nombre);
      const [iguales] = await q('SELECT COUNT(*) AS n FROM tratamientos WHERE activo AND LOCATE(LOWER(?), LOWER(nombre)) > 0', [t0.nombre]);
      assert.equal(await pagina.locator('tbody tr').count(), iguales.n);
      // Cada casilla se guarda al pulsarla (y se desactiva mientras): la marca la pone lo guardado.
      const casilla = (sala) => pagina.getByRole('checkbox', { name: `${t0.nombre} en ${sala}`, exact: true });
      const queda = async (sala, marcada) => hasta(async () => (await casilla(sala).isEnabled()) && (await casilla(sala).isChecked()) === marcada);
      assert.equal(await casilla('Cabina corporal').isChecked(), true);
      assert.equal(await casilla('Cabina facial').isChecked(), false);
      await casilla('Cabina facial').click();
      assert.equal(await queda('Cabina facial', true), true);
      await casilla('Cabina corporal').click();
      assert.equal(await queda('Cabina corporal', false), true);
      const salas = async () => (await q('SELECT s.nombre FROM tratamiento_salas ts JOIN salas s ON s.id = ts.sala_id WHERE ts.tratamiento_id = ?', [t0.id])).map((s) => s.nombre);
      assert.deepEqual(await hasta(async () => { const s = await salas(); return s.length === 1 && s; }), ['Cabina facial']);

      // La agenda ya solo lo ofrece en la cabina facial, y la cita que se da va a su columna.
      const [facial] = await q("SELECT id FROM salas WHERE nombre = 'Cabina facial'");
      const huecos = await pagina.evaluate(async ([f, tr]) => (await fetch(`/api/panel/huecos?fecha=${f}&tratamiento=${tr}`)).json(), [MANANA, t0.id]);
      assert.ok(huecos.length > 0, 'hay huecos mañana');
      assert.ok(huecos.every((h) => h.salaId === facial.id), 'todos en la cabina facial');
      const [paciente] = await q("SELECT id, nombre, apellidos FROM pacientes WHERE email LIKE '%@ejemplo.invalid' ORDER BY id DESC LIMIT 1");
      const reserva = await pagina.evaluate(async (cuerpo) => {
        const r = await fetch('/api/panel/citas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
        return { status: r.status, ...(await r.json()) };
      }, { pacienteId: paciente.id, tratamientoId: t0.id, fecha: MANANA, hora: huecos[0].hora });
      assert.equal(reserva.status, 201);
      assert.equal(reserva.salaId, facial.id);
      await ir('agenda');
      await pagina.getByRole('button', { name: 'Día siguiente' }).click();
      await pagina.getByRole('heading', { level: 1, name: 'miércoles, 7 de octubre' }).waitFor();
      const nueva = tarjeta({ nombre: paciente.nombre, apellidos: paciente.apellidos, hora: huecos[0].hora, tratamiento: t0.nombre });
      const [x, columna] = [await nueva.boundingBox(), await pagina.locator('.tarjeta.overflow-x-auto').getByText('Cabina facial', { exact: true }).locator('..').boundingBox()];
      assert.ok(x.x >= columna.x && x.x + x.width <= columna.x + columna.width, 'la cita está en la columna de la cabina facial');
      await nueva.click();
      const dialogo = pagina.getByRole('dialog', { name: `${paciente.nombre} ${paciente.apellidos}` });
      await dialogo.getByRole('definition').filter({ hasText: /^Cabina facial$/ }).waitFor();
      await dialogo.getByRole('button', { name: 'Cerrar' }).click();
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('«Tu cita»: la página del paciente, añadirla al calendario y cancelarla', async () => {
      const problemas = [];
      await ir('agenda');
      const cita = await citaDe("c.estado = 'confirmada' AND c.inicio > ? AND c.inicio < ?", [AHORA, manana0]);
      await tarjeta(cita).click();
      const dialogo = pagina.getByRole('dialog', { name: `${cita.nombre} ${cita.apellidos}` });
      const [tuCita] = await Promise.all([contexto.waitForEvent('page'), dialogo.getByRole('link', { name: 'Su página «Tu cita» (se abre en otra pestaña)' }).click()]);
      await tuCita.getByRole('heading', { level: 1, name: 'Tu cita' }).waitFor();
      assert.equal(new URL(tuCita.url()).pathname, `/c/${cita.token}`);
      await tuCita.getByText(`martes 6 de octubre, a las ${cita.hora}`).waitFor();

      const [descarga] = await Promise.all([tuCita.waitForEvent('download'), tuCita.getByRole('link', { name: 'Añadir a mi calendario' }).click()]);
      const ics = fs.readFileSync(await descarga.path(), 'utf8');
      const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
      assert.match(ics, new RegExp(`DTSTART:${utc(cita.inicio)}\r\n`));
      assert.match(ics, /STATUS:CONFIRMED/);
      const google = await tuCita.getByRole('link', { name: 'Google' }).getAttribute('href');
      assert.match(google, new RegExp(`^https://calendar\\.google\\.com/calendar/render\\?action=TEMPLATE&.*dates=${utc(cita.inicio)}%2F`));
      await revisar(tuCita, '«Tu cita»', problemas);

      await tuCita.getByRole('button', { name: 'Cancelar la cita' }).click();
      await tuCita.getByRole('heading', { level: 1, name: 'Cita cancelada' }).waitFor();
      await tuCita.getByText('Cita cancelada. Cuando quieras, te buscamos otro hueco por WhatsApp.').waitFor();
      assert.equal(await tuCita.getByRole('link', { name: 'Añadir a mi calendario' }).count(), 0);
      const [c] = await q('SELECT estado, cancelada_por FROM citas WHERE id = ?', [cita.id]);
      assert.deepEqual([c.estado, c.cancelada_por], ['cancelada', 'paciente']);
      await revisar(tuCita, '«Tu cita» cancelada', problemas);
      await tuCita.close();

      // En la agenda ya no está.
      await ir('agenda');
      await pagina.getByText(`${await citasDelDia(hoy0, manana0)} citas`, { exact: true }).waitFor();
      assert.equal(await tarjeta(cita).count(), 0);
      assert.deepEqual(problemas, []);
      sinErrores();
    });

    await t.test('El enlace de la reseña: se completa una cita y su enlace lleva a escribirla en Google', async () => {
      await ir('agenda');
      const cita = await citaDe("c.estado = 'confirmada' AND c.inicio >= ? AND c.inicio < ?", [hoy0, AHORA]);
      await tarjeta(cita).click();
      const dialogo = pagina.getByRole('dialog', { name: `${cita.nombre} ${cita.apellidos}` });
      await dialogo.getByRole('button', { name: 'Completada' }).click();
      await dialogo.getByRole('status').filter({ hasText: /^Marcada como «Completada»\./ }).waitFor();
      await dialogo.getByRole('button', { name: 'Cerrar' }).click();
      const [peticion] = await q('SELECT id, token, estado FROM peticiones_resena WHERE cita_id = ?', [cita.id]);
      assert.equal(peticion.estado, 'programada');
      const [clinica] = await q('SELECT google_place_id FROM clinica WHERE id = 1');
      const enlace = await contexto.newPage();
      await enlace.goto(`${base}/r/${peticion.token}`);
      await enlace.getByText('Fuera de la clínica').waitFor();
      const destino = `https://search.google.com/local/writereview?placeid=${clinica.google_place_id}`;
      assert.deepEqual(fuera, [destino], 'lleva a escribir la reseña en la ficha de Google, y es lo único que ha ido fuera');
      const [clic] = await q('SELECT pulsada_en FROM peticiones_resena WHERE id = ?', [peticion.id]);
      assert.ok(clic.pulsada_en, 'queda que abrió el enlace');
      await enlace.close();
      sinErrores();
    });

    await t.test('Cada pantalla: a 390 px no desborda (con el menú abierto tampoco), se lee en claro y en oscuro, todo tiene nombre y el foco se ve', async () => {
      const problemas = [];
      for (const seccion of Object.keys(TITULOS)) {
        await ir(seccion);
        await revisar(pagina, TITULOS[seccion], problemas);
      }
      // En «Hoy», lo que queda por hacer, en singular si es uno.
      await ir('hoy');
      const [espera] = await q("SELECT COUNT(*) AS n FROM conversaciones WHERE estado = 'espera_persona'");
      assert.equal(espera.n, 1, 'queda una conversación esperando a una persona');
      await pagina.getByRole('link', { name: '1 conversación espera a una persona' }).waitFor();
      await pagina.setViewportSize(MOVIL);
      await ir('hoy');
      const menu = pagina.getByRole('button', { name: 'Menú' });
      assert.equal(await menu.getAttribute('aria-expanded'), 'false');
      assert.equal(await pagina.getByRole('navigation', { name: 'Secciones' }).isVisible(), false);
      await menu.click();
      assert.equal(await menu.getAttribute('aria-expanded'), 'true');
      for (const m of await pagina.evaluate(desbordes)) problemas.push(`Menú abierto · 390 px · desborda: ${m}`);
      for (const m of await contrastes(pagina)) problemas.push(`Menú abierto · 390 px · contraste: ${m}`);
      await pagina.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Agenda' }).click();
      await pagina.getByRole('heading', { level: 1, name: TITULOS.agenda }).waitFor();
      assert.equal(await pagina.getByRole('navigation', { name: 'Secciones' }).isVisible(), false, 'al elegir, el menú se pliega');
      await pagina.setViewportSize(ANCHO);
      assert.deepEqual(problemas, []);
      sinErrores();
    });
  } finally {
    if (modoDemo === undefined) delete process.env.MODO_DEMO; else process.env.MODO_DEMO = modoDemo;
    await navegador.close();
    if (servidor) servidor.close();
    await pool.end();
  }
});
