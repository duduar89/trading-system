'use strict';
// Piezas comunes de todas las páginas: documento, cabecera, menú, pie, barra de abajo, WhatsApp,
// formulario «Te llamamos» y datos estructurados.
const crypto = require('crypto');
const { html, crudo, texto, pendiente, attr, escapar } = require('./html');
const { icono, sprite, empezarPagina } = require('./iconos');

const INTERES_GENERAL = 'una primera valoración';

// ── WhatsApp y teléfono ─────────────────────────────────────────────────────────────────────
function textoWhatsapp(ctx, interes, ref) {
  return ctx.sitio.whatsapp.plantilla.replace('{tratamiento}', interes).replace('{ref}', ref);
}
function urlWhatsapp(ctx, interes, ref) {
  return `https://wa.me/${ctx.sitio.whatsapp.numero}?text=${encodeURIComponent(textoWhatsapp(ctx, interes, ref))}`;
}
const telHref = (ctx) => `tel:${ctx.sitio.telefono.e164}`;

// ── Fotos ───────────────────────────────────────────────────────────────────────────────────
// <img> con srcset, width/height y carga diferida (salvo la primera de la página).
function imagen(ctx, clave, { tamanos = '100vw', clase = '', prioridad = false, alt = null } = {}) {
  const f = ctx.foto(clave);
  if (!f) return '';
  const srcset = f.salidas.map((s) => `${s.url} ${s.ancho}w`).join(', ');
  const mayor = f.salidas[f.salidas.length - 1];
  const media = f.salidas.find((s) => s.ancho >= 900) || mayor;
  return html`<img src="${media.url}" srcset="${srcset}" sizes="${tamanos}" width="${mayor.ancho}" height="${mayor.alto}" alt="${alt ?? f.alt}"${attr('class', clase || null)}${prioridad ? crudo(' fetchpriority="high" decoding="async"') : crudo(' loading="lazy" decoding="async"')}>`;
}

// ── Marca: el logotipo si está convertido; si no, el tipográfico ────────────────────────────────
function marca(ctx, { enlace = true, diferida = false } = {}) {
  const logo = ctx.foto('iemec-logotipo-completo-turquesa-810');
  const dentro = logo
    ? html`<img src="${logo.salidas[logo.salidas.length - 1].url}" srcset="${logo.salidas.map((s) => `${s.url} ${s.ancho}w`).join(', ')}" sizes="200px" width="${logo.salidas[logo.salidas.length - 1].ancho}" height="${logo.salidas[logo.salidas.length - 1].alto}" alt="IEMEC · Instituto Europeo de Medicina Estética y Capilar"${diferida ? crudo(' loading="lazy"') : ''}>`
    : html`<span class="marca-texto">IEMEC</span><span class="marca-linea">Instituto Europeo de Medicina Estética y Capilar</span>`;
  if (!enlace) return html`<span class="marca">${dentro}</span>`;
  return html`<a class="marca" href="/"${logo ? '' : crudo(' aria-label="IEMEC · Instituto Europeo de Medicina Estética y Capilar, ir al inicio"')}>${dentro}</a>`;
}

// ── Cabecera, menú y barra ──────────────────────────────────────────────────────────────────
function cabecera(ctx, ruta) {
  const actual = (href) => (ruta === href ? crudo(' aria-current="page"') : '');
  const enTratamientos = ruta === '/tratamientos/' || ctx.especialidades.some((e) => ruta.startsWith(e.ruta));
  return html`<header class="cabecera">
<div class="contenedor cabecera-in">
${marca(ctx)}
<nav class="nav-principal" aria-label="Principal"><ul>
<li><details class="desplegable"><summary${enTratamientos ? crudo(' class="actual"') : ''}>Tratamientos ${icono('bajar')}</summary>
<div class="desplegable-panel"><ul>
${ctx.especialidades.map((e) => html`<li><a href="${e.ruta}"${actual(e.ruta)}>${icono(e.slug)}${e.nombre}</a></li>`)}
</ul><p class="todos"><a href="/tratamientos/"${actual('/tratamientos/')}>Todos los tratamientos ${icono('flecha')}</a></p></div></details></li>
<li><a href="/equipo/"${actual('/equipo/')}>Equipo</a></li>
<li><a href="/clinica/"${actual('/clinica/')}>La clínica</a></li>
<li><a href="/tarjetas-regalo/"${actual('/tarjetas-regalo/')}>Tarjetas regalo</a></li>
</ul></nav>
<a class="boton boton-oro cabecera-cita" href="/pedir-cita/">Pedir cita</a>
<a class="boton-menu" id="boton-menu" href="#menu-pie">${icono('menu')}<span>Menú</span></a>
</div>
</header>`;
}

function menuMovil(ctx, ruta, whatsapp) {
  const actual = (href) => (ruta === href ? crudo(' aria-current="page"') : '');
  return html`<div class="menu-movil terciopelo" id="menu-movil" role="dialog" aria-modal="true" aria-label="Menú" hidden>
<div class="contenedor menu-movil-in">
<div class="menu-movil-cabecera">${marca(ctx, { enlace: false, diferida: true })}<button class="cerrar-menu" type="button">${icono('cerrar')}<span>Cerrar</span></button></div>
<nav aria-label="Menú">
<p class="etiqueta">Especialidades</p>
<ul class="menu-lista menu-especialidades">${ctx.especialidades.map((e) => html`<li><a href="${e.ruta}"${actual(e.ruta)}>${icono(e.slug)}${e.nombre}</a></li>`)}</ul>
<p class="etiqueta">IEMEC</p>
<ul class="menu-lista menu-paginas">
<li><a href="/tratamientos/"${actual('/tratamientos/')}>Todos los tratamientos</a></li>
<li><a href="/equipo/"${actual('/equipo/')}>Equipo</a></li>
<li><a href="/clinica/"${actual('/clinica/')}>La clínica y cómo llegar</a></li>
<li><a href="/tarjetas-regalo/"${actual('/tarjetas-regalo/')}>Tarjetas regalo</a></li>
<li><a href="/pedir-cita/"${actual('/pedir-cita/')}>Pedir cita</a></li>
</ul>
</nav>
<div class="menu-contacto">
<a class="boton boton-oro" href="${whatsapp}">${icono('whatsapp')}Escribir por WhatsApp</a>
<a class="boton boton-claro" href="${telHref(ctx)}">${icono('telefono')}Llamar al ${ctx.sitio.telefono.visible}</a>
</div>
</div>
</div>`;
}

function barraMovil(ctx, whatsapp) {
  return html`<nav class="barra-movil" aria-label="Contacto rápido">
<a href="${whatsapp}">${icono('whatsapp')}WhatsApp</a>
<a href="${telHref(ctx)}">${icono('telefono')}Llamar</a>
<a href="/pedir-cita/">${icono('calendario')}Cita</a>
</nav>`;
}

// ── Horario y dirección ─────────────────────────────────────────────────────────────────────
// Un día sin horario confirmado sale como hueco en la vista previa; al publicar, solo lo confirmado y
// «Otros horarios, consúltanos» (lanzamiento.json → sabado).
const OTROS_HORARIOS = 'Otros horarios, consúltanos.';
function horario(ctx) {
  const dias = ctx.publicar ? ctx.sitio.horario.filter((h) => h.abre) : ctx.sitio.horario;
  const otros = dias.length < ctx.sitio.horario.length;
  return html`<table class="horario"><tbody>${dias.map((h) => html`<tr><th scope="row">${h.dias}</th><td>${h.abre ? `${h.abre} a ${h.cierra}` : pendiente(h.pendiente)}</td></tr>`)}${otros ? html`<tr><td colspan="2">${OTROS_HORARIOS}</td></tr>` : ''}</tbody></table>`;
}
function horarioCorto(ctx) {
  const confirmados = ctx.sitio.horario.filter((h) => h.abre).map((h) => html`${h.dias}, de ${h.abre} a ${h.cierra}.`);
  if (ctx.publicar) return confirmados.length < ctx.sitio.horario.length ? [...confirmados, ` ${OTROS_HORARIOS}`] : confirmados;
  return ctx.sitio.horario.map((h) => (h.abre ? html`${h.dias}, de ${h.abre} a ${h.cierra}.` : html` ${h.dias}: ${pendiente(h.pendiente)}`));
}
function direccion(ctx, { pendienteLocal = false } = {}) {
  const d = ctx.sitio.direccion;
  return html`${d.calle}, ${d.cp} ${d.municipio} (${d.provincia})${pendienteLocal ? html` ${pendiente(d.pendiente)}` : ''}`;
}

// ── Pie ─────────────────────────────────────────────────────────────────────────────────────
function pie(ctx) {
  const s = ctx.sitio;
  return html`<footer class="pie terciopelo">
<div class="contenedor">
<div class="pie-rejilla">
<div class="pie-marca">
${marca(ctx, { diferida: true })}
<p>${s.frase}</p>
<ul class="redes">${s.redes.map((r) => html`<li><a href="${r.url}" rel="noopener" aria-label="${r.red} de IEMEC">${icono(r.icono)}</a></li>`)}</ul>
</div>
<nav id="menu-pie" aria-label="Especialidades y páginas">
<h2>Especialidades</h2>
<ul>${ctx.especialidades.map((e) => html`<li><a href="${e.ruta}">${e.nombre}</a></li>`)}</ul>
</nav>
<div>
<h2>IEMEC</h2>
<ul>
<li><a href="/tratamientos/">Todos los tratamientos</a></li>
<li><a href="/equipo/">Equipo</a></li>
<li><a href="/clinica/">La clínica</a></li>
<li><a href="/tarjetas-regalo/">Tarjetas regalo</a></li>
<li><a href="/pedir-cita/">Pedir cita</a></li>
</ul>
</div>
<div class="contacto-pie">
<h2>Contacto</h2>
<address>${direccion(ctx)}<br><a href="${telHref(ctx)}">${s.telefono.internacional}</a> · teléfono y WhatsApp</address>
<p class="suave">${horarioCorto(ctx)}</p>
</div>
</div>
<div class="pie-legal">
<p class="registro-sanitario">${icono('escudo')}<span>${s.registro_sanitario.texto_pie}</span></p>
<ul class="enlaces-legales">
<li><a href="/aviso-legal/">Aviso legal</a></li>
<li><a href="/privacidad/">Privacidad</a></li>
<li><a href="/cookies/">Cookies</a></li>
<li><a href="/accesibilidad/">Accesibilidad</a></li>
</ul>
<div class="fse">
<div class="fse-emblema">${ctx.recursos.emblema ? html`<img src="${ctx.recursos.emblema}" width="${s.fse.emblema.ancho}" height="${s.fse.emblema.alto}" alt="${s.fse.emblema.alt}" loading="lazy" decoding="async">` : pendiente('emblema oficial de la UE')}</div>
<p><strong>${s.fse.titulo}</strong> ${s.fse.texto}</p>
</div>
<p class="copy">© 2026 ${s.titular.razon_social} · IEMEC, ${s.nombre}</p>
</div>
</div>
</footer>`;
}

// ── Formulario «Te llamamos» (textos de casillas-formulario.md) ────────────────────────────────
// Los valores son grupos (el slug de la especialidad…) o la referencia de la página («web-lipolaser»),
// nunca un id del catálogo: la app los traduce con semillas/iemec/referencias-web.json. En lo íntimo
// y el peso se preselecciona el grupo neutro (sin opción repetida) y el tratamiento va en «ref».
function gruposInteres(ctx) {
  const grupos = ctx.especialidades.map((e) => ({ valor: e.slug, texto: e.grupo_neutro }));
  grupos.push({ valor: 'estetica-y-bienestar', texto: 'Estética y bienestar (faciales, masajes, head spa)' });
  grupos.push({ valor: 'tarjeta-regalo', texto: 'Tarjeta regalo' });
  grupos.push({ valor: 'otra', texto: 'Otra cosa / prefiero contarlo por teléfono' });
  return grupos;
}
function opcionesInteres(ctx, seleccion) {
  const grupos = gruposInteres(ctx);
  const extra = seleccion && seleccion.texto && !grupos.some((g) => g.valor === seleccion.valor) ? [seleccion] : [];
  return [...extra, ...grupos].map((g) => html`<option value="${g.valor}"${seleccion && g.valor === seleccion.valor ? crudo(' selected') : ''}>${g.texto}</option>`);
}

// Lo que se acepta en el formulario (la primera capa de protección de datos y las dos casillas), tal y
// como se lee. Su versión (version_textos) es la fecha que fija el DPD (sitio.json → formulario) y una
// huella de estos textos: si cambia una coma, cambia la versión. construir.js guarda cada versión con
// sus textos para la app (semillas/iemec/textos-formulario.json): la prueba de cada consentimiento dice
// qué texto se aceptó, y la app no da por buena una versión que no conoce.
function textosFormulario(ctx) {
  const s = ctx.sitio;
  return {
    capa: [
      ['Responsable', `${s.titular.razon_social} (IEMEC).`],
      ['Finalidad', 'Contestar a tu solicitud y darte cita por el medio que elijas. Si marcas la segunda casilla, enviarte comunicaciones comerciales.'],
      ['Legitimación', 'Tu solicitud, y tu consentimiento explícito para el dato de salud que pueda revelar el tratamiento que te interesa. Para las comunicaciones comerciales, tu consentimiento.'],
      ['Destinatarios', 'El proveedor de la app de gestión de la clínica, como encargado del tratamiento, y WhatsApp (Meta) si eliges que te escribamos por WhatsApp, con posible transferencia a EE. UU. amparada en el Marco de Privacidad de Datos UE-EE. UU. No se ceden a nadie más salvo obligación legal.'],
      ['Derechos', `Acceder, rectificar y suprimir tus datos, oponerte, limitar su uso, portarlos y retirar tu consentimiento escribiendo a ${s.correo || '[PENDIENTE: correo]'}. Puedes reclamar ante la AEPD.`],
      ['Más información', 'En la Política de privacidad.'],
    ],
    privacidad: 'He leído la información básica sobre protección de datos. Consiento que IEMEC trate mis datos, incluido el tratamiento que me interesa si revela algo de mi salud, para contestar a mi solicitud por el medio que he elegido.',
    comercial: 'Quiero recibir comunicaciones comerciales de IEMEC (novedades y propuestas sobre los tratamientos que me interesan) por WhatsApp o correo electrónico. Puedo darme de baja cuando quiera respondiendo «BAJA». (Opcional)',
  };
}
const versionTextos = (ctx) => `${ctx.sitio.formulario.version_textos}.${crypto.createHash('sha256').update(JSON.stringify(textosFormulario(ctx))).digest('hex').slice(0, 8)}`;

// ¿Ofrece el formulario WhatsApp? Solo con sitio.json → formulario.whatsapp: quien lo elige recibe antes
// un WhatsApp de confirmación de la app (plantilla iemec_solicitud_web), y eso solo es verdad con el 722
// conectado a la app y la plantilla aprobada en Meta. Hasta entonces, llamada o correo, y nada en la web
// promete esa confirmación (lanzamiento.json → whatsapp-formulario).
const conWhatsapp = (ctx) => !!(ctx.sitio.formulario && ctx.sitio.formulario.whatsapp === true);
const CONFIRMACION_WHATSAPP = `Te escribiremos por WhatsApp desde el +34 722 83 32 85 para confirmar que la solicitud es tuya: contesta «Sí, fui yo» y seguimos por ahí.`;

function formulario(ctx, { id = 'f', pagina, ref, seleccion = null, titulo = null }) {
  const s = ctx.sitio;
  const accion = `${s.api.base}${s.api.contacto}`;
  const campo = (n) => `${id}-${n}`;
  const err = (n) => html`<p class="error" id="${campo(n)}-error" data-error-de="${n}" hidden></p>`;
  const t = textosFormulario(ctx);
  // La capa, de los textos de arriba (la prueba de la web comprueba que lo que se ve es eso).
  const fila = ([cabecera, valor]) => html`<tr><th scope="row">${cabecera}</th><td>${cabecera === 'Más información' ? html`En la <a href="/privacidad/">Política de privacidad</a>.` : texto(valor)}</td></tr>`;
  const [textoComercial, opcional] = t.comercial.split(' (Opcional)');
  // Sin «novalidate» en el HTML: sin JavaScript valida el navegador; con él, web.js lo desactiva y
  // pinta sus propios mensajes.
  // Con WhatsApp, el aviso de confirmación que pinta web.js al enviar va en el propio formulario: el
  // JavaScript no lleva ninguna promesa que la web no haga.
  return html`<form class="formulario" action="${accion}" method="post" data-formulario${conWhatsapp(ctx) ? html` data-confirmacion="${CONFIRMACION_WHATSAPP}"` : ''}>
${titulo ? html`<h3>${titulo}</h3>` : ''}
<div class="campos-dos">
<div class="campo"><label for="${campo('nombre')}">Nombre</label><input id="${campo('nombre')}" name="nombre" autocomplete="given-name" required maxlength="80" aria-describedby="${campo('nombre')}-error">${err('nombre')}</div>
<div class="campo"><label for="${campo('telefono')}">Teléfono</label><input id="${campo('telefono')}" name="telefono" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" aria-describedby="${campo('telefono')}-ayuda ${campo('telefono')}-error"><p class="ayuda" id="${campo('telefono')}-ayuda">${conWhatsapp(ctx) ? 'Te llamaremos o escribiremos a este número.' : 'Lo necesitamos para contactarte.'}</p>${err('telefono')}</div>
</div>
<div class="campos-dos">
<div class="campo"><label for="${campo('email')}">Correo electrónico (opcional)</label><input id="${campo('email')}" name="email" type="email" autocomplete="email" maxlength="120" aria-describedby="${campo('email')}-error">${err('email')}</div>
<div class="campo"><label for="${campo('tratamiento')}">¿Qué te interesa?</label><select id="${campo('tratamiento')}" name="tratamiento" required aria-describedby="${campo('tratamiento')}-ayuda ${campo('tratamiento')}-error"><option value="">Elige una opción</option>${opcionesInteres(ctx, seleccion)}</select><p class="ayuda" id="${campo('tratamiento')}-ayuda">Si vienes de la página de un tratamiento, ya está elegido.</p>${err('tratamiento')}</div>
</div>
<fieldset class="campo" aria-describedby="${campo('preferencia')}-error"><legend>¿Cómo prefieres que te contactemos?</legend>
<div class="opciones">
${conWhatsapp(ctx) ? html`<label class="opcion"><input type="radio" name="preferencia" value="whatsapp" required> WhatsApp</label>
` : ''}<label class="opcion"><input type="radio" name="preferencia" value="llamada" required> Llamada</label>
<label class="opcion"><input type="radio" name="preferencia" value="correo"> Correo electrónico</label>
</div>${err('preferencia')}</fieldset>
<div class="campo"><label for="${campo('mensaje')}">Mensaje (opcional)</label><textarea id="${campo('mensaje')}" name="mensaje" rows="4" maxlength="${s.formulario.mensaje_max}" aria-describedby="${campo('mensaje')}-ayuda ${campo('mensaje')}-error"></textarea><p class="ayuda" id="${campo('mensaje')}-ayuda">Cuéntanos lo básico: qué te interesa y cuándo te viene bien. <strong>No incluyas datos médicos</strong> (enfermedades, medicación, fotos): los hablaremos en consulta.</p>${err('mensaje')}</div>
<div class="capa-privacidad">
<h3>Información básica sobre protección de datos</h3>
<table><tbody>
${t.capa.map(fila)}
</tbody></table>
</div>
<div class="casilla"><input type="checkbox" id="${campo('privacidad')}" name="privacidad" value="si" required aria-describedby="${campo('privacidad')}-error"><label for="${campo('privacidad')}">${t.privacidad}</label>${err('privacidad')}</div>
<div class="casilla"><input type="checkbox" id="${campo('comercial')}" name="comercial" value="si"><label for="${campo('comercial')}">${textoComercial}${opcional === undefined ? '' : html` <em>(Opcional)</em>`}</label></div>
<input type="hidden" name="pagina" value="${pagina}">
<input type="hidden" name="ref" value="${ref}">
${['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].map((n) => html`<input type="hidden" name="${n}" value="">`)}
<input type="hidden" name="t" value="">
<input type="hidden" name="envio" value="">
<input type="hidden" name="version_textos" value="${versionTextos(ctx)}">
<div class="trampa" aria-hidden="true"><label for="${campo('web')}">No rellenes este campo</label><input id="${campo('web')}" name="web" tabindex="-1" autocomplete="off"></div>
<button class="boton boton-oscuro" type="submit">Enviar solicitud</button>
<p class="nota-form">Te contestamos en horario de la clínica. <strong>Este formulario no es para urgencias: si es urgente, llama al 112.</strong></p>
<div class="form-estado" role="status" aria-live="polite" tabindex="-1"></div>
</form>`;
}

// ── Preguntas en acordeón ───────────────────────────────────────────────────────────────────
function preguntas(lista) {
  if (!lista || !lista.length) return '';
  return html`<div class="preguntas">${lista.map((q) => html`<details><summary>${texto(q.p)}${icono('bajar')}</summary><div class="respuesta"><p>${texto(q.r)}</p></div></details>`)}</div>`;
}

// ── Migas ───────────────────────────────────────────────────────────────────────────────────
function migas(pasos) {
  return html`<nav class="migas" aria-label="Estás en"><ol>${pasos.map((p, i) => (i === pasos.length - 1
    ? html`<li aria-current="page">${p.nombre}</li>`
    : html`<li><a href="${p.ruta}">${p.nombre}</a></li>`))}</ol></nav>`;
}

// ── Datos estructurados ─────────────────────────────────────────────────────────────────────
function clinicaLd(ctx) {
  const s = ctx.sitio;
  const ld = {
    '@type': 'MedicalClinic',
    '@id': `${s.dominio}/#clinica`,
    name: `${s.nombre_corto} · ${s.nombre}`,
    alternateName: s.nombre_corto,
    url: `${s.dominio}/`,
    telephone: s.telefono.e164,
    address: { '@type': 'PostalAddress', streetAddress: s.direccion.calle, postalCode: s.direccion.cp, addressLocality: s.direccion.municipio, addressRegion: s.direccion.provincia, addressCountry: s.direccion.pais },
    geo: { '@type': 'GeoCoordinates', latitude: s.coordenadas.lat, longitude: s.coordenadas.lng },
    openingHoursSpecification: s.horario.filter((h) => h.schema).map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.schema, opens: h.abre, closes: h.cierra })),
    hasMap: s.google.ficha,
    sameAs: s.redes.map((r) => r.url),
    identifier: { '@type': 'PropertyValue', propertyID: 'Registro de centros sanitarios de la Comunidad de Madrid', value: s.registro_sanitario.numero },
  };
  if (ctx.og) ld.image = ctx.og.url;
  const logo = ctx.foto('iemec-logotipo-completo-turquesa-810');
  if (logo) ld.logo = `${s.dominio}${logo.salidas[logo.salidas.length - 1].url}`;
  return ld;
}
function migasLd(ctx, pasos) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: pasos.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.nombre, item: `${ctx.sitio.dominio}${p.ruta}` })),
  };
}
function bloqueLd(grafo) {
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': grafo }).replace(/</g, '\\u003c');
  return crudo(`<script type="application/ld+json">${json}</script>`);
}

// ── Documento ───────────────────────────────────────────────────────────────────────────────
// La página se pinta en dos pasos: construir.js llama a empezarPagina(), la plantilla pinta el cuerpo
// y documento() lo envuelve (el <svg> de iconos lleva los que han usado cuerpo, cabecera y pie).
function documento(ctx, p) {
  const s = ctx.sitio;
  const canonical = `${s.dominio}${p.ruta === '/404.html' ? '/' : p.ruta}`;
  const whatsapp = p.whatsapp || urlWhatsapp(ctx, INTERES_GENERAL, 'web-inicio');
  const grafo = [clinicaLd(ctx), ...(p.migas && p.migas.length > 1 ? [migasLd(ctx, p.migas)] : []), ...(p.ld || [])];
  // Primero el cuerpo (así se sabe qué iconos usa la página).
  const cuerpo = html`${p.borrador ? html`<div class="franja-borrador" role="note">Borrador: pendiente de autorización. Vista previa para la clínica: no se publica.</div>` : ''}
<main id="contenido" tabindex="-1">
${p.cuerpo}
</main>
${pie(ctx)}
${barraMovil(ctx, whatsapp)}`;
  const menu = menuMovil(ctx, p.ruta, whatsapp);
  const cab = cabecera(ctx, p.ruta);
  const indexable = p.indexable !== false && !ctx.borradores;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapar(p.titulo)}</title>
<meta name="description" content="${escapar(p.descripcion)}">
<link rel="canonical" href="${escapar(canonical)}">
${indexable ? '' : '<meta name="robots" content="noindex">\n'}<meta name="theme-color" content="#0b2b2a">
<meta name="format-detection" content="telephone=no">
${ctx.fuentes.precarga.map((u) => `<link rel="preload" href="${u}" as="font" type="font/woff2" crossorigin>`).join('\n')}
<link rel="stylesheet" href="${ctx.recursos.css}">
<link rel="icon" href="${ctx.recursos.favicon}" type="image/svg+xml">
${ctx.recursos.apple ? `<link rel="apple-touch-icon" href="${ctx.recursos.apple}">\n` : ''}<meta property="og:type" content="website">
<meta property="og:site_name" content="IEMEC">
<meta property="og:locale" content="es_ES">
<meta property="og:title" content="${escapar(p.titulo)}">
<meta property="og:description" content="${escapar(p.descripcion)}">
<meta property="og:url" content="${escapar(canonical)}">
${ctx.og ? `<meta property="og:image" content="${ctx.og.url}">\n<meta property="og:image:width" content="${ctx.og.ancho}">\n<meta property="og:image:height" content="${ctx.og.alto}">\n<meta property="og:image:alt" content="IEMEC, medicina estética y capilar en Boadilla del Monte">\n<meta name="twitter:card" content="summary_large_image">\n` : ''}${bloqueLd(grafo)}
${p.anclas ? `<script type="application/json" id="anclas-antiguas">${JSON.stringify(p.anclas).replace(/</g, '\\u003c')}</script>\n` : ''}<script src="${ctx.recursos.js}" defer></script>
</head>
<body class="pagina-${p.tipo}">
${sprite()}
<a class="saltar" href="#contenido">Saltar al contenido</a>
${cab}
${menu}
${cuerpo}
</body>
</html>
`;
}

module.exports = {
  documento, urlWhatsapp, textoWhatsapp, telHref, imagen, marca, formulario, preguntas, migas, horario, horarioCorto, direccion,
  clinicaLd, INTERES_GENERAL, empezarPagina, gruposInteres, textosFormulario, versionTextos, conWhatsapp, CONFIRMACION_WHATSAPP,
};
