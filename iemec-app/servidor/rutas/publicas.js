'use strict';
// Rutas que abre el paciente desde WhatsApp (sin cuenta): la página «Tu cita» con los botones de
// calendario, el .ics, confirmar o cancelar, y el enlace corto de la reseña. El token de la cita
// son 32 bytes aleatorios: no se puede adivinar ni recorrer.
const express = require('express');
const T = require('../../motor/tiempo');
const { generarIcs, enlaceGoogle, enlaceOutlook } = require('../../motor/calendario/ics');
const { DIAS, MESES } = require('../../motor/repesca/plazos');
const agenda = require('../agenda');
const resenas = require('../resenas');
const config = require('../config');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function citaPorToken(pool, token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [[c]] = await pool.query(
    `SELECT c.*, t.nombre AS tratamiento, p.nombre AS paciente, pr.nombre AS profesional, s.nombre AS sala
       FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id JOIN pacientes p ON p.id = c.paciente_id
       LEFT JOIN profesionales pr ON pr.id = c.profesional_id LEFT JOIN salas s ON s.id = c.sala_id
      WHERE c.token = ?`, [token]);
  return c || null;
}

async function datosClinica(pool) {
  const [[cl]] = await pool.query('SELECT * FROM clinica WHERE id = 1');
  return cl || { nombre: 'IEMEC', direccion: '', municipio: '' };
}

function eventoDe(cita, clinica) {
  const lugar = [clinica.nombre_corto || clinica.nombre, clinica.direccion, clinica.cp && clinica.municipio ? `${clinica.cp} ${clinica.municipio}` : clinica.municipio].filter(Boolean).join(', ');
  return {
    uid: `cita-${cita.id}@iemec-clinic.com`,
    inicio: cita.inicio, fin: cita.fin,
    titulo: `${clinica.nombre_corto || 'IEMEC'} · ${cita.tratamiento}`,
    descripcion: `Tu cita en ${clinica.nombre_corto || 'IEMEC'}. Para cambiarla o cancelarla: ${config.urlPublica}/c/${cita.token}`,
    lugar, lat: clinica.lat, lng: clinica.lng,
    url: `${config.urlPublica}/c/${cita.token}`,
    secuencia: cita.secuencia_ics,
    cancelada: cita.estado === 'cancelada',
  };
}

function textoFechaHora(inicio) {
  const p = T.partesMadrid(new Date(inicio));
  return `${DIAS[p.diaSemana]} ${Number(p.fecha.slice(8))} de ${MESES[Number(p.fecha.slice(5, 7))]}, a las ${p.hora}`;
}

function paginaCita(cita, clinica, mensaje = '') {
  const ev = eventoDe(cita, clinica);
  const cancelada = cita.estado === 'cancelada';
  const whatsapp = String(clinica.whatsapp || '34722833285').replace(/\D/g, '');
  const cambiar = `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, quiero cambiar mi cita del ${textoFechaHora(cita.inicio)}`)}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>Tu cita · IEMEC</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500&family=Playfair+Display:ital,wght@1,500&display=swap" rel="stylesheet">
<style>
:root{--terciopelo:#123f3e;--terciopelo-2:#0b2b2a;--turquesa:#76c3c7;--oro:#c9a45c;--marfil:#f5f7f6;--tinta:#1f232b;--suave:#5c6b6a}
*{box-sizing:border-box}body{margin:0;font-family:Montserrat,system-ui,sans-serif;background:var(--marfil);color:var(--tinta);padding:16px}
.tarjeta{max-width:440px;margin:24px auto;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 18px 40px -24px rgba(11,43,42,.55)}
.cab{background:radial-gradient(120% 140% at 20% 0%,#1d5b58 0%,var(--terciopelo) 45%,var(--terciopelo-2) 100%);color:#fff;padding:28px 24px 22px;border-bottom:1px solid var(--oro)}
.marca{letter-spacing:.42em;font-weight:300;color:var(--turquesa);font-size:22px}
h1{font-family:"Playfair Display",Georgia,serif;font-style:italic;font-weight:500;font-size:28px;margin:14px 0 4px}
.cuando{font-size:15px;opacity:.92}.cuerpo{padding:22px 24px 26px;display:grid;gap:14px}
.dato{display:flex;justify-content:space-between;gap:12px;font-size:14px;border-bottom:1px solid #e7ecea;padding-bottom:10px}.dato span:first-child{color:var(--suave)}
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;text-align:center;text-decoration:none;border-radius:999px;padding:12px 16px;font-weight:500;font-size:15px;line-height:1.25;border:1px solid var(--terciopelo);color:var(--terciopelo);background:#fff}
.btn.lleno{background:var(--terciopelo);color:#fff;border-color:var(--terciopelo)}.fila{display:grid;grid-template-columns:1fr 1fr;gap:10px}
form{margin:0}button.btn{width:100%;cursor:pointer;font-family:inherit}.aviso{background:#f3ead8;border:1px solid var(--oro);border-radius:12px;padding:12px;font-size:14px}
.pie{font-size:12px;color:var(--suave);text-align:center}
</style></head><body><main class="tarjeta">
<header class="cab"><div class="marca">IEMEC</div><h1>${cancelada ? 'Cita cancelada' : 'Tu cita'}</h1><div class="cuando">${esc(textoFechaHora(cita.inicio))}</div></header>
<section class="cuerpo">
${mensaje ? `<div class="aviso">${esc(mensaje)}</div>` : ''}
<div class="dato"><span>Tratamiento</span><span>${esc(cita.tratamiento)}</span></div>
${cita.profesional ? `<div class="dato"><span>Con</span><span>${esc(cita.profesional)}</span></div>` : ''}
<div class="dato"><span>Dónde</span><span>${esc(ev.lugar)}</span></div>
${cancelada ? '' : `
${cita.estado === 'retenida' ? `<form method="post" action="/c/${esc(cita.token)}/confirmar"><button class="btn lleno" type="submit">Confirmar mi cita</button></form>` : ''}
<a class="btn lleno" href="/c/${esc(cita.token)}.ics">Añadir a mi calendario</a>
<div class="fila"><a class="btn" href="${esc(enlaceGoogle(ev))}" rel="noopener">Google</a><a class="btn" href="${esc(enlaceOutlook(ev))}" rel="noopener">Outlook</a></div>
<a class="btn" href="${esc(cambiar)}">Cambiarla por WhatsApp</a>
<form method="post" action="/c/${esc(cita.token)}/cancelar"><button class="btn" type="submit">Cancelar la cita</button></form>`}
<p class="pie">En iPhone, «Añadir a mi calendario» abre el calendario del teléfono. Si algo cambia, te avisamos por WhatsApp.</p>
</section></main></body></html>`;
}

function rutasPublicas({ pool }) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);

  r.get('/c/:token.ics', async (req, res) => {
    const cita = await citaPorToken(p(), req.params.token);
    if (!cita) return res.status(404).send('No encontramos esa cita');
    const ics = generarIcs(eventoDe(cita, await datosClinica(p())));
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `inline; filename="cita-iemec-${cita.id}.ics"`);
    res.set('Cache-Control', 'no-store');
    res.send(ics);
  });

  r.get('/c/:token', async (req, res) => {
    const cita = await citaPorToken(p(), req.params.token);
    if (!cita) return res.status(404).send('No encontramos esa cita');
    res.set('Cache-Control', 'no-store');
    res.send(paginaCita(cita, await datosClinica(p())));
  });

  const accion = (nombre) => async (req, res) => {
    const token = req.params.token;
    let mensaje;
    try {
      if (nombre === 'confirmar') { await agenda.confirmar(p(), { token, actor: 'paciente' }); mensaje = 'Cita confirmada. ¡Te esperamos!'; }
      else { await agenda.cancelar(p(), { token, por: 'paciente', motivo: 'cancelada desde la página de la cita', actor: 'paciente' }); mensaje = 'Cita cancelada. Cuando quieras, te buscamos otro hueco por WhatsApp.'; }
    } catch (err) {
      mensaje = err.codigo === 'RETENCION_CADUCADA' ? 'El hueco se ha liberado. Escríbenos por WhatsApp y te buscamos otro.' : 'No se ha podido hacer el cambio. Escríbenos por WhatsApp.';
    }
    const cita = await citaPorToken(p(), token);
    if (!cita) return res.status(404).send('No encontramos esa cita');
    res.send(paginaCita(cita, await datosClinica(p()), mensaje));
  };
  r.post('/c/:token/confirmar', accion('confirmar'));
  r.post('/c/:token/cancelar', accion('cancelar'));

  r.get('/r/:token', async (req, res) => {
    const cl = await datosClinica(p());
    if (!cl.google_place_id) return res.status(503).send('Falta configurar la ficha de Google');
    res.redirect(302, await resenas.abrirEnlace(p(), String(req.params.token).slice(0, 22), cl.google_place_id));
  });

  return r;
}

module.exports = { rutasPublicas, paginaCita, eventoDe };
