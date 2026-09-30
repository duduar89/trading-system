'use strict';
// Rutas que abre el paciente desde WhatsApp (sin cuenta):
//
//   GET  /c/:token            su página «Tu cita», según cómo esté la cita. Sin efectos: las vistas
//                             previas de enlaces y los escáneres de correo la abren solos
//   GET  /c/:token.ics        la cita para su calendario (discreta: «Cita en IEMEC»)
//   GET  /cal/:token          «Añadir al calendario» con un toque (el botón de WhatsApp): iPhone, iPad
//                             y Mac → el .ics; Android → Google Calendar; lo demás, o si la cita no
//                             está confirmada o ya pasó → la página
//   POST /c/:token/confirmar  y /c/:token/cancelar
//   GET  /r/:token            el enlace corto de la reseña
//
// El token (32 bytes aleatorios) se busca por su huella y caduca 30 días después de la cita
// (servidor/agenda.js). Nada de terceros en la página (ni fuentes, ni scripts, ni imágenes: lo
// impide su Content-Security-Policy) y nada que se guarde en cachés, se indexe o viaje en el Referer.
const express = require('express');
const T = require('../../motor/tiempo');
const { generarIcs, enlaceGoogle, enlaceOutlook, enlaceMapa, dispositivo, lugarDe, direccionPostal } = require('../../motor/calendario/ics');
const { DIAS, MESES } = require('../../motor/repesca/plazos');
const agenda = require('../agenda');
const listaEspera = require('../lista-espera');
const resenas = require('../resenas');
const config = require('../config');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

// Lo que va en todas las respuestas con el token en la URL.
function privado(res) {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  });
}

// ── Datos ─────────────────────────────────────────────────────────────────────────────────────

async function datosClinica(q) {
  const [[cl]] = await q.query('SELECT nombre_corto, whatsapp FROM clinica WHERE id = 1');
  return { marca: cl?.nombre_corto || 'IEMEC', whatsapp: String(cl?.whatsapp || '34722833285').replace(/\D/g, '') };
}

// La cita del enlace (sin datos del paciente: la página no los necesita), con su sede.
async function citaPorToken(q, token) {
  if (!agenda.tokenValido(token)) return null;
  const [[c]] = await q.query(
    `SELECT c.id, c.estado, c.inicio, c.fin, c.retenida_hasta, c.confirmada_en, c.cancelada_por, c.secuencia_ics, c.uid_ics,
            c.token_caduca_en, c.reprograma_a_id, c.sala_id, t.nombre AS tratamiento, pr.nombre AS profesional, s.nombre AS sala
       FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id
       LEFT JOIN profesionales pr ON pr.id = c.profesional_id LEFT JOIN salas s ON s.id = c.sala_id
      WHERE c.token_hash = ?`, [agenda.huellaToken(token)]);
  if (!c) return null;
  return { ...c, token, sede: await agenda.sedeDe(q, c.sala_id) };
}

// La cita a la que se cambió (siguiendo los cambios, si la movió más de una vez), con su enlace.
async function citaNueva(q, cita) {
  let id = cita.reprograma_a_id;
  let nueva = null;
  for (let i = 0; id && i < 5; i++) {
    const [[n]] = await q.query('SELECT id, estado, inicio, reprograma_a_id, token_cifrado, token_iv, token_tag FROM citas WHERE id = ?', [id]);
    if (!n) break;
    nueva = n;
    if (n.estado !== 'reprogramada') break;
    id = n.reprograma_a_id;
  }
  return nueva && { id: nueva.id, estado: nueva.estado, inicio: nueva.inicio, token: agenda.tokenDe(nueva) };
}

// El hueco que se le guarda de la lista de espera (si esta cita retenida es eso).
async function ofertaDe(q, citaId) {
  const [[o]] = await q.query("SELECT id FROM lista_espera_ofertas WHERE cita_id = ? AND estado = 'ofrecida' ORDER BY id DESC LIMIT 1", [citaId]);
  return o ? listaEspera.ofertaPorId(q, o.id) : null;
}

// Cómo se ve la cita ahora.
function vistaDe(cita, ahora) {
  if (cita.estado === 'reprogramada') return 'reprogramada';
  if (cita.estado === 'cancelada') return !cita.confirmada_en && cita.cancelada_por === 'sistema' ? 'hueco_liberado' : 'cancelada';
  if (['llegada', 'en_curso', 'completada'].includes(cita.estado)) return 'vino';
  if (cita.estado === 'no_presentada') return 'no_vino';
  if (cita.estado === 'retenida') {
    const caducada = (cita.retenida_hasta && new Date(cita.retenida_hasta) <= ahora) || new Date(cita.inicio) <= ahora;
    return caducada ? 'hueco_liberado' : 'retenida';
  }
  if (new Date(cita.inicio) <= ahora) return new Date(cita.fin) <= ahora ? 'pasada' : 'empezada';
  return 'confirmada';
}

const urlCita = (token) => `${config.urlPublica}/c/${token}`;

// El evento para el calendario: «Cita en IEMEC», en la sede de la sala, con el enlace a «Tu cita».
// Ni el tratamiento ni la cabina.
function eventoDe(cita, { marca, uid, nueva = null }) {
  const url = urlCita(cita.token);
  let descripcion = `Tu cita en ${marca}. Para verla, cambiarla o cancelarla: ${url}`;
  if (cita.estado === 'reprogramada') {
    descripcion = nueva?.token ? `Esta cita se ha cambiado. Tu nueva cita: ${urlCita(nueva.token)}` : `Esta cita se ha cambiado. Más información: ${url}`;
  } else if (cita.estado === 'cancelada') {
    descripcion = `Esta cita está cancelada. Más información: ${url}`;
  }
  return {
    uid, inicio: cita.inicio, fin: cita.fin, titulo: `Cita en ${marca}`, descripcion,
    lugar: lugarDe(cita.sede), lat: cita.sede?.lat, lng: cita.sede?.lng, url,
    secuencia: cita.secuencia_ics, cancelada: ['cancelada', 'reprogramada'].includes(cita.estado),
  };
}

// ── La página ─────────────────────────────────────────────────────────────────────────────────

function textoFechaHora(inicio) {
  const p = T.partesMadrid(new Date(inicio));
  return `${DIAS[p.diaSemana]} ${Number(p.fecha.slice(8))} de ${MESES[Number(p.fecha.slice(5, 7))]}, a las ${p.hora}`;
}

const escribir = (whatsapp, texto) => `https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`;
const boton = (href, texto, { lleno = false, externo = false } = {}) =>
  `<a class="btn${lleno ? ' lleno' : ''}" href="${esc(href)}"${externo ? ' rel="noopener noreferrer"' : ''}>${esc(texto)}</a>`;
const formulario = (accion, texto, { lleno = false } = {}) =>
  `<form method="post" action="${esc(accion)}"><button class="btn${lleno ? ' lleno' : ''}" type="submit">${esc(texto)}</button></form>`;
const dato = (etiqueta, valor) => (valor ? `<div class="dato"><span>${esc(etiqueta)}</span><span>${valor}</span></div>` : '');
const aviso = (texto) => (texto ? `<div class="aviso">${esc(texto)}</div>` : '');

function documento({ titulo, cuando = '', cuerpo }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>Tu cita · IEMEC</title>
<link rel="stylesheet" href="/fuentes/fuentes.css">
<style>
:root{--terciopelo:#123f3e;--terciopelo-2:#0b2b2a;--turquesa:#76c3c7;--oro:#c9a45c;--marfil:#f5f7f6;--tinta:#1f232b;--suave:#5c6b6a}
*{box-sizing:border-box}body{margin:0;font-family:Montserrat,system-ui,sans-serif;background:var(--marfil);color:var(--tinta);padding:16px}
.tarjeta{max-width:440px;margin:24px auto;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 18px 40px -24px rgba(11,43,42,.55)}
.cab{background:radial-gradient(120% 140% at 20% 0%,#1d5b58 0%,var(--terciopelo) 45%,var(--terciopelo-2) 100%);color:#fff;padding:28px 24px 22px;border-bottom:1px solid var(--oro)}
.marca{letter-spacing:.42em;font-weight:300;color:var(--turquesa);font-size:22px}
h1{font-family:"Playfair Display",Georgia,serif;font-style:italic;font-weight:500;font-size:28px;margin:14px 0 4px}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--suave);font-weight:500;margin:6px 0 0}
.cuando{font-size:15px;opacity:.92}.cuerpo{padding:22px 24px 26px;display:grid;gap:14px}
.dato{display:flex;justify-content:space-between;gap:12px;font-size:14px;border-bottom:1px solid #e7ecea;padding-bottom:10px}.dato span:first-child{color:var(--suave)}.dato span:last-child{text-align:right}
.nota{display:block;font-size:12px;color:var(--suave)}
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;text-align:center;text-decoration:none;border-radius:999px;padding:12px 16px;font-weight:500;font-size:15px;line-height:1.25;border:1px solid var(--terciopelo);color:var(--terciopelo);background:#fff}
.btn.lleno{background:var(--terciopelo);color:#fff;border-color:var(--terciopelo)}.fila{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.enlace{color:var(--terciopelo);font-size:14px}
form{margin:0}button.btn{width:100%;cursor:pointer;font-family:inherit}.aviso{background:#f3ead8;border:1px solid var(--oro);border-radius:12px;padding:12px;font-size:14px}
.pie{font-size:12px;color:var(--suave);text-align:center}
</style></head><body><main class="tarjeta">
<header class="cab"><div class="marca">IEMEC</div><h1>${esc(titulo)}</h1>${cuando ? `<div class="cuando">${esc(cuando)}</div>` : ''}</header>
<section class="cuerpo">
${cuerpo}
</section></main></body></html>`;
}

// Dónde: la sede de la sala (nombre, dirección, indicaciones) y «Cómo llegar».
function donde(sede, disp) {
  if (!sede) return '';
  const mapa = enlaceMapa(sede, disp);
  return dato('Dónde', `${esc(sede.nombre)}<span class="nota">${esc(direccionPostal(sede))}</span>${sede.indicaciones ? `<span class="nota">${esc(sede.indicaciones)}</span>` : ''}`
    + (mapa ? `<a class="enlace nota" href="${esc(mapa)}" rel="noopener noreferrer">Cómo llegar</a>` : ''));
}

// Los botones de calendario: el del dispositivo, destacado (iPhone y Mac: el .ics; Android: Google),
// y los demás debajo. En el ordenador no se sabe cuál usa: todos iguales.
function botonesCalendario(cita, ev, disp) {
  const opciones = {
    ics: { texto: 'Apple y otros (.ics)', href: `/c/${cita.token}.ics` },
    google: { texto: 'Google Calendar', href: enlaceGoogle(ev), externo: true },
    outlook: { texto: 'Outlook', href: enlaceOutlook(ev), externo: true },
    trabajo: { texto: 'Outlook (trabajo)', href: enlaceOutlook(ev, { cuenta: 'trabajo' }), externo: true },
  };
  const principal = { apple: ['ics', 'Añadir a mi calendario'], android: ['google', 'Añadir a Google Calendar'] }[disp];
  const resto = Object.keys(opciones).filter((k) => k !== principal?.[0]);
  return `<h2>Añadir a tu calendario</h2>
${principal ? boton(opciones[principal[0]].href, principal[1], { lleno: true, externo: opciones[principal[0]].externo }) : ''}
<div class="fila">${resto.map((k) => boton(opciones[k].href, opciones[k].texto, { externo: opciones[k].externo })).join('')}</div>`;
}

/**
 * La página según el estado de la cita.
 * @param {object} d { cita, marca, whatsapp, nueva?, oferta?, disp, ahora, mensaje? }
 */
function paginaCita({ cita, marca, whatsapp, nueva = null, oferta = null, disp = 'otro', ahora = new Date(), mensaje = '' }) {
  const cuando = textoFechaHora(cita.inicio);
  const wa = (texto) => escribir(whatsapp, texto);
  const pedirOtra = boton(wa('Hola, me gustaría pedir una cita'), 'Pedir otra cita por WhatsApp');
  const vista = vistaDe(cita, ahora);

  if (vista === 'confirmada') {
    const ev = eventoDe(cita, { marca, uid: cita.uid_ics });
    return documento({ titulo: 'Tu cita', cuando, cuerpo: `${aviso(mensaje)}
${dato('Tratamiento', esc(cita.tratamiento))}
${dato('Con', esc(cita.profesional))}
${dato('Sala', cita.sala ? `${esc(cita.sala)}<span class="nota">Te acompañamos desde recepción</span>` : '')}
${donde(cita.sede, disp)}
${botonesCalendario(cita, ev, disp)}
${boton(wa(`Hola, quiero cambiar mi cita del ${cuando}`), 'Cambiarla por WhatsApp')}
${formulario(`/c/${cita.token}/cancelar`, 'Cancelar la cita')}
<p class="pie">Si algo cambia, te avisamos por WhatsApp.</p>` });
  }
  if (vista === 'retenida') {
    const fin = cita.retenida_hasta ? new Date(cita.retenida_hasta) : null;
    const hasta = !fin ? '' : T.fechaMadrid(fin) === T.fechaMadrid(ahora) ? ` hasta las ${T.hhmm(T.minutosMadrid(fin))}` : ` hasta el ${textoFechaHora(fin)}`;
    const cambia = oferta?.cambia_cita_id && oferta.cambiaInicio ? `Al confirmarla, tu cita del ${textoFechaHora(oferta.cambiaInicio)} queda anulada.` : '';
    return documento({ titulo: 'Confirma tu cita', cuando, cuerpo: `${aviso(mensaje || `Te guardamos este hueco${hasta}. Confírmalo para que quede reservado.`)}
${dato('Tratamiento', esc(cita.tratamiento))}
${donde(cita.sede, disp)}
${cambia ? `<p class="pie">${esc(cambia)}</p>` : ''}
${formulario(`/c/${cita.token}/confirmar`, 'Confirmar mi cita', { lleno: true })}
${formulario(`/c/${cita.token}/cancelar`, 'No me viene bien')}
${boton(wa(`Hola, os escribo por el hueco del ${cuando}`), 'Escribir por WhatsApp')}
<p class="pie">Cuando la confirmes, podrás añadirla a tu calendario.</p>` });
  }
  if (vista === 'reprogramada') {
    const cuerpo = nueva
      ? `${aviso(mensaje || `Tu cita ha cambiado: ahora es el ${textoFechaHora(nueva.inicio)}.`)}
${nueva.token ? boton(`/c/${nueva.token}`, 'Ver mi nueva cita', { lleno: true }) : ''}
<p class="pie">Si tenías esta en tu calendario, bórrala y añade la nueva desde su página.</p>`
      : `${aviso(mensaje || 'Esta cita se ha cambiado a otro día.')}${pedirOtra}`;
    return documento({ titulo: 'Cita cambiada', cuando: `Antes: ${cuando}`, cuerpo });
  }
  if (vista === 'cancelada') {
    return documento({ titulo: 'Cita cancelada', cuando, cuerpo: `${aviso(mensaje || 'Esta cita está cancelada.')}
<p class="pie">Si la añadiste a tu calendario, bórrala.</p>
${pedirOtra}` });
  }
  if (vista === 'hueco_liberado') {
    return documento({ titulo: 'Hueco liberado', cuando, cuerpo: `${aviso(mensaje || 'Este hueco ya no está guardado. Escríbenos y te buscamos otro.')}
${boton(wa(`Hola, se me pasó confirmar el hueco del ${cuando}. ¿Me buscáis otro?`), 'Buscar otro hueco por WhatsApp', { lleno: true })}` });
  }
  if (vista === 'vino') {
    return documento({ titulo: 'Tu cita', cuando, cuerpo: `${aviso(mensaje || '¡Gracias por venir! Te esperamos en tu próxima visita.')}${pedirOtra}` });
  }
  if (vista === 'no_vino') {
    return documento({ titulo: 'Tu cita', cuando, cuerpo: `${aviso(mensaje || 'Te echamos de menos en esta cita. Si quieres, te buscamos otro momento.')}
${boton(wa(`Hola, no pude ir a mi cita del ${cuando}. ¿Me buscáis otro hueco?`), 'Buscar otro hueco por WhatsApp', { lleno: true })}` });
  }
  if (vista === 'pasada') {
    return documento({ titulo: 'Tu cita', cuando, cuerpo: `${aviso(mensaje || 'Esta cita ya pasó.')}${pedirOtra}` });
  }
  // Empezada y sin marcar: ni cancelar ni calendario (si no vino, recepción lo marca y se le ofrece otro hueco).
  return documento({ titulo: 'Tu cita', cuando, cuerpo: `${aviso(mensaje || 'Esta cita ya ha empezado. Si no has podido venir o necesitas algo, escríbenos.')}
${boton(wa(`Hola, os escribo por mi cita del ${cuando}`), 'Escribir por WhatsApp')}` });
}

function paginaCaducada(whatsapp) {
  return documento({ titulo: 'Enlace caducado', cuerpo: `${aviso('Este enlace ya no está activo. Si necesitas algo de tu cita, escríbenos por WhatsApp.')}
${boton(escribir(whatsapp, 'Hola, os escribo por una cita'), 'Escribir por WhatsApp', { lleno: true })}` });
}

function paginaNoEncontrada(whatsapp) {
  return documento({ titulo: 'Tu cita', cuerpo: `${aviso('No encontramos esa cita. Revisa el enlace o escríbenos por WhatsApp.')}
${boton(escribir(whatsapp, 'Hola, os escribo por una cita'), 'Escribir por WhatsApp')}` });
}

function enviarPagina(res, status, html) {
  privado(res);
  res.set({ 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', Vary: 'User-Agent' });
  res.status(status).type('html').send(html);
}

// ── Rutas ─────────────────────────────────────────────────────────────────────────────────────

function rutasPublicas({ pool }) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);
  const reloj = (req) => req.ahora || new Date();

  // Nada de esto se indexa (y lo que lleva token, tampoco se sigue).
  r.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /c/\nDisallow: /cal/\nDisallow: /r/\nDisallow: /api/\n');
  });

  // La cita del enlace, o la página que toca si no la hay o ha caducado (entonces devuelve null).
  async function laCita(req, res) {
    const q = p();
    const cl = await datosClinica(q);
    const cita = await citaPorToken(q, req.params.token);
    if (!cita) { enviarPagina(res, 404, paginaNoEncontrada(cl.whatsapp)); return null; }
    if (agenda.enlaceCaducado(cita, reloj(req))) { enviarPagina(res, 410, paginaCaducada(cl.whatsapp)); return null; }
    return { cita, ...cl };
  }

  async function mostrar(req, res, d, { mensaje = '', status = 200 } = {}) {
    const q = p();
    const { cita } = d;
    enviarPagina(res, status, paginaCita({
      ...d, ahora: reloj(req), mensaje, disp: dispositivo(req.get('user-agent')),
      nueva: cita.estado === 'reprogramada' ? await citaNueva(q, cita) : null,
      oferta: cita.estado === 'retenida' ? await ofertaConCita(q, cita.id) : null,
    }));
  }

  // El hueco de la lista de espera y la cita que sustituiría (para decírselo antes de confirmar).
  async function ofertaConCita(q, citaId) {
    const o = await ofertaDe(q, citaId);
    if (!o?.cambia_cita_id) return o;
    const [[c]] = await q.query('SELECT inicio FROM citas WHERE id = ?', [o.cambia_cita_id]);
    return { ...o, cambiaInicio: c?.inicio || null };
  }

  r.get('/c/:token.ics', async (req, res) => {
    privado(res);
    const q = p();
    const cita = await citaPorToken(q, req.params.token);
    if (!cita) return res.status(404).type('text/plain').send('No encontramos esa cita');
    const ahora = reloj(req);
    if (agenda.enlaceCaducado(cita, ahora) || new Date(cita.inicio) <= ahora) {
      return res.status(410).type('text/plain').send('Esta cita ya ha pasado: no hay nada que añadir al calendario');
    }
    // Un hueco que solo se le guarda aún no es una cita: primero, confirmarla.
    if (cita.estado === 'retenida') return res.redirect(303, `/c/${cita.token}`);
    const { marca } = await datosClinica(q);
    const ev = eventoDe(cita, { marca, uid: await agenda.uidIcs(q, cita), nueva: cita.estado === 'reprogramada' ? await citaNueva(q, cita) : null });
    res.set('Content-Type', 'text/calendar; charset=utf-8; method=PUBLISH');
    res.set('Content-Disposition', `inline; filename="cita-iemec-${T.fechaMadrid(new Date(cita.inicio))}.ics"`);
    res.send(generarIcs(ev, { ahora }));
  });

  // El botón «Añadir al calendario» de WhatsApp: solo redirige (y según el dispositivo).
  r.get('/cal/:token', async (req, res) => {
    const d = await laCita(req, res);
    if (!d) return;
    privado(res);
    res.set('Vary', 'User-Agent');
    const { cita } = d;
    const disp = dispositivo(req.get('user-agent'));
    if (vistaDe(cita, reloj(req)) !== 'confirmada' || disp === 'otro') return res.redirect(302, `/c/${cita.token}`);
    if (disp === 'apple') return res.redirect(302, `/c/${cita.token}.ics`);
    return res.redirect(302, enlaceGoogle(eventoDe(cita, { marca: d.marca, uid: cita.uid_ics })));
  });

  r.get('/c/:token', async (req, res) => {
    const d = await laCita(req, res);
    if (d) await mostrar(req, res, d);
  });

  const accion = (nombre) => async (req, res) => {
    const d = await laCita(req, res);
    if (!d) return;
    const q = p();
    const ahora = reloj(req);
    let { cita } = d;
    let mensaje;
    // Si es un hueco de la lista de espera, se acepta o se rechaza como tal: si sustituye a otra cita,
    // esa queda cambiada a esta; si no lo quiere, pasa al siguiente de la lista.
    const oferta = cita.estado === 'retenida' ? await ofertaDe(q, cita.id) : null;
    try {
      if (nombre === 'confirmar') {
        if (oferta) {
          const hecho = await listaEspera.aceptar(q, oferta, { ahora, actor: 'paciente' });
          if (hecho.ocupado) throw Object.assign(new Error('ocupado'), { codigo: 'RETENCION_CADUCADA' });
          if (hecho.citaId !== cita.id) {
            const token = await agenda.tokenParaEnviar(q, hecho.citaId);
            cita = (token && await citaPorToken(q, token)) || cita;
          }
        } else {
          await agenda.confirmar(q, { id: cita.id, actor: 'paciente', ahora });
        }
        mensaje = 'Cita confirmada. ¡Te esperamos!';
      } else if (oferta) {
        await listaEspera.rechazar(q, oferta, { ahora, actor: 'paciente' });
        mensaje = 'De acuerdo: el hueco queda libre para otra persona. Sigues en la lista de espera: si se libera otro, te avisamos.';
      } else {
        await agenda.cancelar(q, { id: cita.id, por: 'paciente', motivo: 'cancelada desde la página de la cita', actor: 'paciente', ahora });
        mensaje = 'Cita cancelada. Cuando quieras, te buscamos otro hueco por WhatsApp.';
      }
    } catch (err) {
      if (!err.codigo) throw err;
      mensaje = err.codigo === 'RETENCION_CADUCADA' ? 'El hueco se ha liberado. Escríbenos por WhatsApp y te buscamos otro.'
        : err.codigo === 'FUERA_DE_HORA' ? 'La cita ya ha empezado: desde aquí ya no se puede cancelar. Si necesitas algo, escríbenos por WhatsApp.'
          : 'No se ha podido hacer el cambio. Escríbenos por WhatsApp.';
    }
    const fresca = await citaPorToken(q, cita.token);
    await mostrar(req, res, { ...d, cita: fresca }, { mensaje });
  };
  r.post('/c/:token/confirmar', accion('confirmar'));
  r.post('/c/:token/cancelar', accion('cancelar'));

  r.get('/r/:token', async (req, res) => {
    privado(res);
    const cl = await datosClinicaResena(p());
    if (!cl.google_place_id) return res.status(503).send('Falta configurar la ficha de Google');
    res.redirect(302, await resenas.abrirEnlace(p(), String(req.params.token).slice(0, 22), cl.google_place_id));
  });

  return r;
}

async function datosClinicaResena(q) {
  const [[cl]] = await q.query('SELECT google_place_id FROM clinica WHERE id = 1');
  return cl || {};
}

module.exports = { rutasPublicas, paginaCita, eventoDe, vistaDe, citaPorToken };
