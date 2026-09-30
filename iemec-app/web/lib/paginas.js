'use strict';
// Las páginas de la web. Cada función devuelve lo que necesita documento(): ruta, título, descripción,
// cuerpo, migas, datos estructurados y el WhatsApp de la página.
const { html, crudo, texto, pendiente } = require('./html');
const { icono } = require('./iconos');
const B = require('./base');

const recortar = (s, n) => {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  const corte = t.slice(0, n - 1);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(' '), n - 20)).replace(/[,;:.\s]+$/, '')}…`;
};
const minusculaInicial = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Título ≤ 65 caracteres y descripción entre 70 y 160.
function tituloSeo(base, extra = ' · IEMEC Boadilla del Monte') {
  if ((base + extra).length <= 65) return base + extra;
  if ((`${base} · IEMEC`).length <= 65) return `${base} · IEMEC`;
  return recortar(base, 57) + ' · IEMEC';
}
function descripcionSeo(s, relleno = ' Primera valoración para explicarte las opciones y el presupuesto, sin compromiso.') {
  let d = String(s || '').trim();
  if (d.length < 70) d = `${d}${relleno}`;
  if (d.length > 160) d = recortar(d, 160);
  return d;
}

function cabeceraPagina({ pasos, etiqueta, titulo, entradilla, acciones = '', extra = '', adorno = null }) {
  return html`<section class="cabecera-pagina terciopelo${adorno ? ' con-adorno' : ''}">
<div class="capitone-velo" aria-hidden="true"></div>
<div class="contenedor">
${adorno ? html`<span class="adorno" aria-hidden="true">${icono(adorno)}</span>` : ''}
${pasos ? B.migas(pasos) : ''}
${etiqueta ? html`<p class="etiqueta">${etiqueta}</p>` : ''}
<h1>${titulo}</h1>
${entradilla ? html`<p class="entrada">${texto(entradilla)}</p>` : ''}
${extra}
${acciones ? html`<div class="acciones">${acciones}</div>` : ''}
</div>
</section>`;
}

function botonWhatsapp(url, etiqueta = 'Pedir cita por WhatsApp', clase = 'boton-oro') {
  return html`<a class="boton ${clase}" href="${url}">${icono('whatsapp')}${etiqueta}</a>`;
}

function llamadaFinal(ctx, { whatsapp, titulo = crudo('¿Empezamos por una <em>valoración</em>?'), entradilla = 'Te explicamos las opciones y el presupuesto, sin compromiso. Escríbenos por WhatsApp o llámanos y te damos cita en la agenda de la clínica.' } = {}) {
  return html`<section class="seccion terciopelo llamada" aria-labelledby="t-llamada" data-aparece>
<div class="capitone-velo" aria-hidden="true"></div><span class="filete" aria-hidden="true"></span>
<div class="contenedor">
<p class="etiqueta sin-raya">Tu primera cita</p>
<h2 id="t-llamada">${titulo}</h2>
<p class="entrada">${entradilla}</p>
<div class="acciones">${botonWhatsapp(whatsapp, 'Escribir por WhatsApp')}<a class="boton boton-claro" href="${B.telHref(ctx)}">${icono('telefono')}Llamar al ${ctx.sitio.telefono.visible}</a></div>
</div>
</section>`;
}

// ── Tarjetas ────────────────────────────────────────────────────────────────────────────────
// Compactas y de la misma altura: sin lista de destacados (las sensibles no la llevaban y quedaban
// huecos junto a las demás).
function tarjetaEspecialidad(e) {
  const n = e.paginas.length;
  return html`<article class="tarjeta tarjeta-especialidad">
<span class="tarjeta-icono">${icono(e.slug)}</span>
<h3><a href="${e.ruta}">${e.nombre}</a></h3>
<p>${e.resumen}</p>
<span class="mas">${n === 1 ? 'Ver el tratamiento' : `Ver los ${n} tratamientos`} ${icono('flecha')}</span>
</article>`;
}

function tarjetaTratamiento(p, nivel = 3, { agrupada = false } = {}) {
  const mini = [];
  if (p.sesion?.duracion) mini.push(html`<li>${icono('reloj')}${p.sesion.duracion}</li>`);
  if (p.medico && !agrupada) mini.push(html`<li>${icono('medico')}Con valoración médica</li>`);
  else if (p.clase === 'previa' && !agrupada) mini.push(html`<li>${icono('valoracion')}Con valoración previa</li>`);
  return html`<article class="tarjeta tarjeta-tratamiento">
${crudo(`<h${nivel}>`)}<a href="${p.ruta}">${p.nombre}</a>${crudo(`</h${nivel}>`)}
<p>${texto(recortar(p.entradilla, 150))}</p>
${mini.length ? html`<ul class="ficha-mini">${mini}</ul>` : ''}
<span class="mas">Ver tratamiento ${icono('flecha')}</span>
</article>`;
}

// ── Inicio ──────────────────────────────────────────────────────────────────────────────────
function inicio(ctx) {
  const s = ctx.sitio;
  const wa = B.urlWhatsapp(ctx, B.INTERES_GENERAL, 'web-inicio');
  const recepcion = ctx.foto('clinica-recepcion');
  const equipo = ctx.equipoVisible.filter((p) => p.foto && ctx.foto(p.foto)).slice(0, 4);
  // Sin la nota de Google: las reseñas no se usan como reclamo (normas.md, apartado d). El enlace
  // neutro a la ficha va en /pedir-cita/.
  const cuerpo = html`<section class="portada terciopelo" aria-labelledby="titulo-portada">
<div class="capitone-velo" aria-hidden="true"></div><span class="filete" aria-hidden="true"></span>
<div class="contenedor">
<div class="portada-rejilla">
<div>
<p class="etiqueta">Boadilla del Monte · Madrid</p>
<h1 id="titulo-portada">Medicina estética y capilar <em>en Boadilla del Monte</em></h1>
<p class="lema">${s.frase}</p>
<div class="acciones">${botonWhatsapp(wa)}<a class="boton boton-claro" href="/tratamientos/">Ver tratamientos</a></div>
<p class="sello">${icono('escudo')}${s.registro_sanitario.texto_corto}</p>
</div>
${recepcion ? html`<figure class="portada-foto"><div class="marco-dorado">${B.imagen(ctx, 'clinica-recepcion', { tamanos: '(min-width: 960px) 440px, (min-width: 400px) 360px, 90vw', prioridad: true })}</div><figcaption>La recepción de IEMEC, en la avenida Siglo XXI.</figcaption></figure>` : ''}
</div>
<ul class="confianza">
<li><b>Médicos</b><span>Valoración médica antes de cada tratamiento médico</span></li>
<li><b>Tu plan</b><span>Opciones, riesgos y presupuesto por escrito, sin compromiso</span><a href="/pedir-cita/">Pedir cita</a></li>
<li><b>Boadilla</b><span>${s.direccion.calle}, en Boadilla del Monte</span></li>
<li><b>Tecnología</b><span>Láser médico, HIFU, radiofrecuencia y luz pulsada</span><a href="/clinica/#tecnologia">Ver la tecnología</a></li>
</ul>
</div>
</section>
<section class="seccion" aria-labelledby="t-preocupa" data-aparece>
<div class="contenedor">
<div class="titulo-seccion">
<p class="etiqueta">Por dónde empezar</p>
<h2 id="t-preocupa">¿Qué te preocupa?</h2>
<p class="entrada">Elige lo que quieres mejorar y te enseñamos los tratamientos que encajan. Si no lo tienes claro, empieza por una valoración.</p>
</div>
<ul class="chips">${ctx.preocupaciones.map((c) => html`<li><a class="chip" href="/tratamientos/?p=${c.slug}">${icono(c.slug)}${c.nombre}</a></li>`)}</ul>
</div>
</section>
<section class="seccion seccion-blanca capitone-claro" aria-labelledby="t-especialidades" data-aparece>
<div class="contenedor">
<div class="titulo-seccion">
<p class="etiqueta">Especialidades</p>
<h2 id="t-especialidades">Todo lo que hacemos, <em>en un mismo lugar</em></h2>
<p class="entrada">Medicina estética, medicina y cirugía capilar y cirugía estética, cada una con su equipo.</p>
</div>
<div class="rejilla rejilla-4">${ctx.especialidades.map((e) => tarjetaEspecialidad(e))}
<article class="tarjeta tarjeta-especialidad tarjeta-todas">
<span class="tarjeta-icono">${icono('buscar')}</span>
<h3><a href="/tratamientos/">Todos los tratamientos</a></h3>
<p>Búscalos por nombre, por especialidad o por lo que te preocupa.</p>
<span class="mas">Ver los ${ctx.especialidades.reduce((n, e) => n + e.paginas.length, 0)} tratamientos ${icono('flecha')}</span>
</article></div>
</div>
</section>
<section class="seccion terciopelo" aria-labelledby="t-como" data-aparece>
<div class="capitone-velo" aria-hidden="true"></div>
<div class="contenedor">
<div class="titulo-seccion">
<p class="etiqueta">Cómo trabajamos</p>
<h2 id="t-como">Primero te escuchamos. <em>Después, el plan.</em></h2>
</div>
<ol class="pasos">
<li><h3>${icono('valoracion')}Valoración</h3><p>Nos cuentas qué te preocupa. Si el tratamiento es médico, te valora un médico: tu salud, tus antecedentes y lo que quieres conseguir.</p></li>
<li><h3>${icono('plan')}Plan</h3><p>Te explicamos las opciones, sus riesgos y el presupuesto por escrito. Tú decides, sin prisas y sin compromiso.</p></li>
<li><h3>${icono('tratamiento')}Tratamiento</h3><p>Cada tratamiento lo hace el profesional que le corresponde, en su sala y con el tiempo que necesita.</p></li>
<li><h3>${icono('seguimiento')}Seguimiento</h3><p>Revisamos cómo evolucionas y ajustamos lo que haga falta. Estamos a un WhatsApp de distancia.</p></li>
</ol>
</div>
</section>
${equipo.length ? html`<section class="seccion" aria-labelledby="t-equipo" data-aparece>
<div class="contenedor">
<div class="titulo-seccion centrado">
<p class="etiqueta">El equipo</p>
<h2 id="t-equipo">Las personas <em>que te atienden</em></h2>
<p class="entrada">Cada tratamiento lo hace el profesional que le corresponde, siempre con una valoración previa.</p>
</div>
<ul class="equipo-portada">${equipo.map((p) => html`<li><div class="retrato">${B.imagen(ctx, p.foto, { tamanos: '116px', alt: '' })}</div><b>${p.nombre}</b><span>${p.cargo}</span></li>`)}</ul>
<p class="titulo-seccion centrado"><a class="enlace-flecha" href="/equipo/">Conoce al equipo ${icono('flecha')}</a></p>
</div>
</section>` : ''}
${ubicacion(ctx)}
${llamadaFinal(ctx, { whatsapp: wa })}`;
  return {
    ruta: '/', tipo: 'inicio', whatsapp: wa, ref: 'web-inicio',
    titulo: 'IEMEC · Medicina estética y capilar en Boadilla del Monte',
    descripcion: 'Instituto Europeo de Medicina Estética y Capilar en Boadilla del Monte: medicina estética facial y corporal, medicina y cirugía capilar y cirugía estética.',
    cuerpo,
  };
}

function ubicacion(ctx, { titulo = true, ficha = false } = {}) {
  const s = ctx.sitio;
  return html`<section class="seccion seccion-blanca" aria-labelledby="t-donde" data-aparece>
<div class="contenedor ubicacion">
<div>
<p class="etiqueta">Dónde estamos</p>
${titulo ? html`<h2 id="t-donde">Te esperamos en <em>Boadilla del Monte</em></h2>` : html`<h2 id="t-donde">Cómo llegar</h2>`}
<ul class="datos-contacto">
<li>${icono('pin')}<span>${B.direccion(ctx)}</span></li>
<li>${icono('telefono')}<span><a href="${B.telHref(ctx)}">${s.telefono.internacional}</a> · teléfono y WhatsApp</span></li>
<li>${icono('reloj')}${B.horario(ctx)}</li>
</ul>
<div class="acciones"><a class="boton boton-oscuro" href="${s.como_llegar.google}" rel="noopener">${icono('pin')}Cómo llegar con Google Maps</a><a class="boton boton-linea" href="${s.como_llegar.apple}" rel="noopener">Abrir en Apple Maps</a></div>
${ficha ? html`<p class="ficha-google"><a class="enlace-flecha" href="${s.google.ficha}" rel="noopener">Nuestra ficha en Google ${icono('flecha')}</a></p>` : ''}
${titulo ? '' : html`<p class="nota-mapa">No cargamos ningún mapa al abrir la página: los enlaces abren Google Maps o Apple Maps solo si los pulsas.</p>`}
</div>
${ctx.foto('clinica-fachada-entrada') ? html`<figure class="foto-marco foto-entrada"><div class="marco-dorado">${B.imagen(ctx, 'clinica-fachada-entrada', { tamanos: '(min-width: 900px) 460px, 92vw' })}</div><figcaption>La entrada de IEMEC, en la avenida Siglo XXI 13.</figcaption></figure>` : ''}
</div>
</section>`;
}

// ── Especialidad ────────────────────────────────────────────────────────────────────────────
function especialidad(ctx, e) {
  const wa = B.urlWhatsapp(ctx, e.grupo_neutro, e.ref);
  const pasos = [{ nombre: 'Inicio', ruta: '/' }, { nombre: e.nombre, ruta: e.ruta }];
  // Con muchas páginas y de los dos tipos, separadas: lo médico y la estética de cabina.
  const medicas = e.paginas.filter((p) => p.medico);
  const cabina = e.paginas.filter((p) => !p.medico);
  const separar = e.paginas.length > 8 && medicas.length && cabina.length;
  const columnas = (n) => (n === 1 ? 'rejilla-1' : n === 2 || n === 4 ? 'rejilla-2' : 'rejilla-3');
  const rejilla = (lista, nivel) => html`<div class="rejilla ${columnas(lista.length)} rejilla-tratamientos">${lista.map((p) => tarjetaTratamiento(p, nivel, { agrupada: nivel === 4 }))}</div>`;
  // «Cómo lo hacemos»: con foto, la foto a la derecha y las preguntas bajo el texto (en el móvil,
  // texto, preguntas y foto); sin foto, las preguntas a la derecha.
  const fotoEsp = e.foto && ctx.foto(e.foto)
    ? html`<figure class="foto-marco foto-especialidad"><div class="marco-dorado">${B.imagen(ctx, e.foto, { tamanos: '(min-width: 1180px) 610px, (min-width: 900px) 52vw, 92vw' })}</div><figcaption>${e.foto_pie}</figcaption></figure>`
    : null;
  const preguntasEsp = html`<div class="preguntas-especialidad"><h2 class="solo-lector">Preguntas frecuentes</h2>${B.preguntas(e.preguntas)}</div>`;
  const cuerpo = html`${cabeceraPagina({
    pasos, etiqueta: 'Especialidad', titulo: e.titulo, entradilla: e.entradilla, adorno: e.slug,
    extra: e.pendiente ? html`<p class="entrada">${pendiente(e.pendiente)}</p>` : '',
    acciones: html`${botonWhatsapp(wa)}<a class="boton boton-claro" href="#tratamientos">${e.paginas.length === 1 ? 'Ver el tratamiento' : 'Ver los tratamientos'}</a>`,
  })}
<section class="seccion" id="tratamientos" aria-labelledby="t-lista">
<div class="contenedor">
<div class="titulo-seccion">
<p class="etiqueta">${e.paginas.length === 1 ? '1 tratamiento' : `${e.paginas.length} tratamientos`}</p>
<h2 id="t-lista">Tratamientos de ${minusculaInicial(e.nombre)}</h2>
</div>
${separar
    ? html`<div class="subgrupo"><h3>Con valoración médica · ${medicas.length}</h3>${rejilla(medicas, 4)}</div><div class="subgrupo"><h3>Estética de cabina y bienestar · ${cabina.length}</h3>${rejilla(cabina, 4)}</div>`
    : rejilla(e.paginas, 3)}
</div>
</section>
<section class="seccion seccion-blanca" aria-labelledby="t-como-esp" data-aparece>
<div class="contenedor ubicacion arriba">
<div>
<p class="etiqueta">Cómo lo hacemos</p>
<h2 id="t-como-esp">Antes de nada, <em>una valoración</em></h2>
${e.texto.map((t) => html`<p>${texto(t)}</p>`)}
${fotoEsp ? preguntasEsp : ''}
</div>
${fotoEsp || preguntasEsp}
</div>
</section>
${llamadaFinal(ctx, { whatsapp: wa })}`;
  return {
    ruta: e.ruta, tipo: 'especialidad', whatsapp: wa, ref: e.ref, migas: pasos,
    titulo: e.titulo_seo, descripcion: e.descripcion_seo, cuerpo,
  };
}

// ── Tratamiento ─────────────────────────────────────────────────────────────────────────────
// Quién la opera: hasta que la clínica dé nombre, especialidad oficial y número de colegiado
// (normas.md, apartado j), se ve el hueco.
const PENDIENTE_CIRUJANO = 'nombre, especialidad oficial y n.º de colegiado';
const quienOpera = (p) => (/\[PENDIENTE|colegiad/i.test(p.profesional || '') ? p.profesional : `${p.profesional || 'Cirujano'} [PENDIENTE: ${PENDIENTE_CIRUJANO}]`);
const dondeOpera = (p) => p.sesion?.donde || '[PENDIENTE: centro donde se opera]';

// El recuadro del principio según la clase de la página (web/lib/modelo.js): la cirugía, lo médico y
// lo que requiere una valoración previa sin que conste quién la hace. En la propia consulta de
// valoración no sale (sería «antes de la valoración, una valoración»).
function aviso(p) {
  // «Lo realiza: equipo médico.»: en minúscula tras los dos puntos, salvo un nombre propio («Dr. …»).
  const minuscula = (s) => (s && !/^(Dr|Dra)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  if (p.clase === 'cirugia') {
    const quien = /cirujan/i.test(p.profesional || 'cirujano') ? 'el cirujano' : 'el médico';
    return html`<div class="aviso-medico" role="note">
<p class="aviso-titulo">${icono('medico')}Cirugía: requiere una consulta previa</p>
<p>Antes de operarte tienes una consulta de valoración: ${quien} estudia tu caso y te explica la técnica, la anestesia, la recuperación, los riesgos y las alternativas. Antes de la intervención firmas el consentimiento informado por escrito. El resultado varía según cada persona.</p>
<p>${texto(`Lo realiza: ${minuscula(quienOpera(p))}. Dónde: ${minuscula(dondeOpera(p))}. Solo para mayores de edad [PENDIENTE: política con menores].`)}</p>
</div>`;
  }
  if (p.clase === 'medico') {
    return html`<div class="aviso-medico" role="note">
<p class="aviso-titulo">${icono('medico')}Tratamiento médico: requiere valoración previa</p>
<p>${texto(`Antes de hacerlo tienes una valoración médica: el médico estudia tu caso y te explica los riesgos y las contraindicaciones. El resultado varía según cada persona.${p.profesional ? ` Lo realiza: ${minuscula(p.profesional)}.` : ''}`)}</p>
</div>`;
  }
  if (p.clase === 'previa') {
    return html`<div class="aviso-medico aviso-previa" role="note">
<p class="aviso-titulo">${icono('valoracion')}Requiere valoración previa</p>
<p>${texto(`Antes de hacerlo valoramos tu caso y te explicamos la técnica, el producto que se usa, los cuidados, los riesgos y las contraindicaciones. El resultado varía según cada persona.${p.profesional ? ` Lo realiza: ${minuscula(p.profesional)}.` : ''} La valoración la hace [PENDIENTE: médico o equipo de estética, según el producto].`)}</p>
</div>`;
  }
  return '';
}

function tratamiento(ctx, p) {
  const e = ctx.especialidades.find((x) => x.slug === p.especialidad);
  const wa = B.urlWhatsapp(ctx, p.interes, p.ref);
  const pasos = [{ nombre: 'Inicio', ruta: '/' }, { nombre: e.nombre, ruta: e.ruta }, { nombre: p.nombre, ruta: p.ruta }];
  const s = p.sesion || {};
  const ficha = [
    ['reloj', 'Duración', s.duracion], ['calendario', 'Sesiones', s.sesiones], ['tratamiento', 'Anestesia', s.anestesia],
    // En la cirugía y en la consulta con el cirujano, «Lo realiza» lleva el hueco del cirujano.
    ['seguimiento', 'Recuperación', s.recuperacion], ['medico', 'Lo realiza', p.cirugia || /cirujan/i.test(p.profesional || '') ? quienOpera(p) : p.profesional],
    ['pin', 'Dónde', p.cirugia ? dondeOpera(p) : s.donde],
  ].filter(([, , v]) => v);
  const rapidos = [];
  if (s.duracion) rapidos.push(html`<li>${icono('reloj')}${s.duracion}</li>`);
  if (s.sesiones) rapidos.push(html`<li>${icono('calendario')}${s.sesiones}</li>`);
  // Primero el aviso (y, en el móvil, la ficha justo después: van antes que el texto en el HTML y,
  // en escritorio, la ficha pasa a la columna de la derecha).
  const avisos = `${p.origen === 'provisional' ? html`<div class="aviso-provisional" role="note"><p>${pendiente('página provisional hecha desde el catálogo; la sustituye el texto final de su grupo cuando llegue')}</p></div>` : ''}${aviso(p)}`;
  const cuerpo = html`${cabeceraPagina({
    pasos, etiqueta: e.nombre, titulo: p.titulo, entradilla: p.entradilla, adorno: (p.preocupaciones || [])[0] || e.slug,
    extra: rapidos.length ? html`<ul class="datos-rapidos">${rapidos}</ul>` : '',
    acciones: html`${botonWhatsapp(wa)}<a class="boton boton-claro" href="#te-llamamos">${icono('telefono')}Te llamamos</a>`,
  })}
<div class="contenedor tratamiento-rejilla">
${avisos ? html`<div class="tratamiento-aviso">${crudo(avisos)}</div>` : ''}
<aside class="tratamiento-lateral" aria-labelledby="t-ficha">
<div class="ficha">
<h2 id="t-ficha">Ficha práctica</h2>
${ficha.length ? html`<dl>${ficha.map(([ic, k, v]) => html`<div>${icono(ic)}<dt>${k}</dt><dd>${texto(v)}</dd></div>`)}</dl>` : ''}
${botonWhatsapp(wa, 'Pedir cita por WhatsApp', 'boton-oscuro')}
<a class="boton boton-linea" href="#te-llamamos">Prefiero que me llaméis</a>
<p class="nota-wa">WhatsApp es un servicio de Meta. Más información en la <a href="/privacidad/">política de privacidad</a>.</p>
</div>
</aside>
<div class="tratamiento-principal">
${p.para_quien && p.para_quien.length ? html`<section class="bloque" aria-labelledby="t-para"><h2 id="t-para">¿Para quién es?</h2><ul class="lista-rombo">${p.para_quien.map((x) => html`<li>${texto(x)}</li>`)}</ul></section>` : ''}
<section class="bloque" aria-labelledby="t-consiste"><h2 id="t-consiste">En qué consiste</h2>${p.texto.map((x) => html`<p>${texto(x)}</p>`)}</section>
${p.variantes && p.variantes.length ? html`<section class="bloque" aria-labelledby="t-opciones"><h2 id="t-opciones">Opciones</h2><div class="variantes">${p.variantes.map((v) => html`<div class="variante"><h3>${texto(v.nombre)}</h3><p>${texto(v.texto)}</p></div>`)}</div></section>` : ''}
${p.resultados ? html`<section class="bloque" aria-labelledby="t-esperar"><h2 id="t-esperar">Qué puedes esperar</h2><p class="resultado">${texto(p.resultados)}</p></section>` : ''}
${p.preguntas && p.preguntas.length ? html`<section class="bloque" aria-labelledby="t-preguntas"><h2 id="t-preguntas">Preguntas frecuentes</h2>${B.preguntas(p.preguntas)}</section>` : ''}
</div>
</div>
${p.relacionadas.length ? html`<section class="seccion seccion-blanca" aria-labelledby="t-rel" data-aparece>
<div class="contenedor">
<div class="titulo-seccion"><p class="etiqueta">También te puede interesar</p><h2 id="t-rel">Tratamientos relacionados</h2></div>
<div class="rejilla rejilla-relacionados desliza">${p.relacionadas.map((q) => tarjetaTratamiento(q))}</div>
</div>
</section>` : ''}
<section class="seccion" id="te-llamamos" aria-labelledby="t-llamamos">
<div class="contenedor estrecho">
<h2 id="t-llamamos" class="titulo-llamamos">Te llamamos</h2>
<p class="entrada">Déjanos tu teléfono y te contactamos en horario de la clínica.</p>
<details class="plegable" open data-plegable>
<summary>${icono('telefono')}<span><span class="titulo-plegable">Rellenar el formulario</span><span class="sub">Nombre, teléfono y cómo prefieres que te contactemos.</span></span>${icono('bajar', 'bajar')}</summary>
${B.formulario(ctx, { id: 'f', pagina: p.ruta, ref: p.ref, seleccion: p.sensible ? { valor: e.slug } : { valor: p.ref, texto: p.nombre } })}
</details>
</div>
</section>`;
  const url = `${ctx.sitio.dominio}${p.ruta}`;
  const descripcion = p.descripcion_seo || descripcionSeo(`${p.nombre} en IEMEC, Boadilla del Monte: ${minusculaInicial(p.entradilla)}`);
  const ld = p.medico
    ? { '@type': 'MedicalProcedure', '@id': `${url}#tratamiento`, name: p.nombre, description: descripcion, url }
    : { '@type': 'Service', '@id': `${url}#tratamiento`, name: p.nombre, serviceType: p.nombre, description: descripcion, url, provider: { '@id': `${ctx.sitio.dominio}/#clinica` }, areaServed: { '@type': 'City', name: 'Boadilla del Monte' } };
  return {
    ruta: p.ruta, tipo: 'tratamiento', whatsapp: wa, ref: p.ref, migas: pasos, ld: [ld], borrador: p.origen === 'borrador',
    titulo: p.titulo_seo || tituloSeo(p.nombre), descripcion, cuerpo, medico: p.medico,
  };
}

// ── Todos los tratamientos ──────────────────────────────────────────────────────────────────
function tratamientos(ctx) {
  const wa = B.urlWhatsapp(ctx, B.INTERES_GENERAL, 'web-tratamientos');
  const pasos = [{ nombre: 'Inicio', ruta: '/' }, { nombre: 'Tratamientos', ruta: '/tratamientos/' }];
  const total = ctx.especialidades.reduce((n, e) => n + e.paginas.length, 0);
  const cuerpo = html`${cabeceraPagina({
    pasos, etiqueta: 'Tratamientos', titulo: 'Todos los tratamientos', adorno: 'tratamiento',
    entradilla: 'Busca por nombre, por especialidad o por lo que te preocupa. Si no sabes por dónde empezar, pide una primera valoración.',
    acciones: botonWhatsapp(wa, 'Pedir una valoración'),
  })}
<div class="contenedor">
<div class="filtros" data-filtros hidden>
<div class="campo buscador"><label for="buscar">Busca un tratamiento</label><input type="search" id="buscar" name="q" autocomplete="off" placeholder="Por ejemplo: manchas, láser, labios">${icono('buscar')}</div>
<div class="campo"><label for="filtro-especialidad">Especialidad</label><select id="filtro-especialidad"><option value="">Todas</option>${ctx.especialidades.map((e) => html`<option value="${e.slug}">${e.nombre}</option>`)}</select></div>
<div role="group" aria-label="¿Qué te preocupa?"><ul class="chips">${ctx.preocupaciones.map((c) => html`<li><button type="button" class="chip" data-p="${c.slug}" aria-pressed="false">${icono(c.slug)}${c.nombre}</button></li>`)}</ul></div>
<p class="recuento" id="recuento" aria-live="polite">${total} tratamientos</p>
</div>
<div class="listado">
${ctx.especialidades.map((e) => html`<section class="grupo" data-grupo aria-labelledby="g-${e.slug}">
<h2 id="g-${e.slug}">${icono(e.slug)}<a href="${e.ruta}">${e.nombre}</a></h2>
<ul class="lista-tratamientos">${e.paginas.map((p) => html`<li data-item data-e="${e.slug}" data-p="${(p.preocupaciones || []).join(' ')}"><a href="${p.ruta}"><span class="nombre">${p.nombre}</span><span class="desc">${texto(recortar(p.entradilla, 110))}</span></a></li>`)}</ul>
</section>`)}
</div>
<p class="sin-resultados" id="sin-resultados" hidden>No hay tratamientos con ese filtro. Prueba con otra palabra o <a href="/pedir-cita/">pregúntanos</a>.</p>
</div>
${llamadaFinal(ctx, { whatsapp: wa })}`;
  return {
    ruta: '/tratamientos/', tipo: 'tratamientos', whatsapp: wa, ref: 'web-tratamientos', migas: pasos,
    titulo: 'Todos los tratamientos · IEMEC Boadilla del Monte',
    descripcion: `Los ${total} tratamientos de IEMEC en Boadilla del Monte: medicina estética facial y corporal, medicina y cirugía capilar y cirugía estética.`,
    cuerpo,
  };
}

// ── Equipo ──────────────────────────────────────────────────────────────────────────────────
function iniciales(nombre) {
  return nombre.replace(/^(Dra?\.)\s+/, '').split(/\s+/).slice(0, 2).map((x) => x[0]).join('');
}
function equipoPagina(ctx) {
  const wa = B.urlWhatsapp(ctx, B.INTERES_GENERAL, 'web-equipo');
  const pasos = [{ nombre: 'Inicio', ruta: '/' }, { nombre: 'Equipo', ruta: '/equipo/' }];
  const est = ctx.datos.equipo.estetica;
  const cuerpo = html`${cabeceraPagina({
    pasos, etiqueta: 'El equipo', titulo: html`Las personas <em>de IEMEC</em>`, adorno: 'medico',
    entradilla: 'Cada tratamiento lo hace el profesional que le corresponde, siempre con una valoración previa.',
  })}
<section class="seccion" aria-labelledby="t-personas">
<div class="contenedor">
<h2 class="solo-lector" id="t-personas">Profesionales</h2>
<ul class="equipo-lista">
${ctx.equipoVisible.map((p) => html`<li class="tarjeta persona">
<div class="retrato">${p.foto && ctx.foto(p.foto) ? B.imagen(ctx, p.foto, { tamanos: '132px' }) : html`<span class="monograma" aria-hidden="true">${iniciales(p.nombre)}</span>`}</div>
<h3>${p.nombre}</h3>
<p class="cargo">${p.cargo}</p>
<p class="bio">${texto(p.bio)}</p>
<p class="colegiado">${pendiente(p.pendiente)}</p>
</li>`)}
<li class="tarjeta persona">
<div class="retrato"><span class="monograma" aria-hidden="true">${icono('tratamiento')}</span></div>
<h3>${est.nombre}</h3>
<p class="cargo">Cabina y head spa</p>
<p class="bio">${est.texto}</p>
<p class="colegiado">${pendiente(est.pendiente)}</p>
</li>
</ul>
<p class="nota-equipo">Responsable asistencial (dirección médica): ${pendiente(ctx.datos.equipo.responsable_pendiente)}</p>
</div>
</section>
${llamadaFinal(ctx, { whatsapp: wa })}`;
  return {
    ruta: '/equipo/', tipo: 'equipo', whatsapp: wa, ref: 'web-equipo', migas: pasos,
    titulo: 'Equipo médico y de estética · IEMEC Boadilla del Monte',
    descripcion: 'Conoce al equipo de IEMEC en Boadilla del Monte: medicina estética, cirugía estética, área capilar y equipo de estética, con sus datos.',
    cuerpo,
  };
}

// ── La clínica ──────────────────────────────────────────────────────────────────────────────
function clinica(ctx) {
  const s = ctx.sitio;
  const wa = B.urlWhatsapp(ctx, B.INTERES_GENERAL, 'web-clinica');
  const pasos = [{ nombre: 'Inicio', ruta: '/' }, { nombre: 'La clínica', ruta: '/clinica/' }];
  // La foto ancha, la de más resolución (la sala, 1600 px); la recepción (810 px) va en la fila.
  const galeria = [
    ['clinica-sala-de-procedimientos', 'Sala de procedimientos.'],
    ['clinica-recepcion', 'Recepción y sala de espera.'],
    ['clinica-cabina-tratamientos', 'Una de las cabinas de tratamiento.'],
    ['clinica-consulta', 'Consulta.'],
  ].filter(([k]) => ctx.foto(k));
  const cuerpo = html`${cabeceraPagina({
    pasos, etiqueta: 'La clínica', titulo: html`Un espacio pensado <em>para cuidarte</em>`, adorno: 'pin',
    entradilla: 'IEMEC está en la avenida Siglo XXI de Boadilla del Monte: consultas médicas, cabinas de tratamiento, sala de procedimientos y un rincón para el head spa.',
    acciones: html`${botonWhatsapp(wa)}<a class="boton boton-claro" href="#como-llegar">${icono('pin')}Cómo llegar</a>`,
  })}
${galeria.length ? html`<section class="seccion" aria-labelledby="t-espacio">
<div class="contenedor">
<div class="titulo-seccion"><p class="etiqueta">El espacio</p><h2 id="t-espacio">Así es IEMEC por dentro</h2></div>
<div class="galeria">${galeria.map(([k, pie], i) => html`<figure>${B.imagen(ctx, k, { tamanos: i === 0 ? '(min-width: 1180px) 1116px, 94vw' : '(min-width: 1180px) 363px, (min-width: 720px) 30vw, 94vw' })}<figcaption>${pie}</figcaption></figure>`)}</div>
</div>
</section>` : ''}
<section class="seccion seccion-blanca" id="tecnologia" aria-labelledby="t-tecnologia" data-aparece>
<div class="contenedor">
<div class="titulo-seccion"><p class="etiqueta">Tecnología</p><h2 id="t-tecnologia">Los aparatos con los que trabajamos</h2><p class="entrada">Te decimos la tecnología, no la marca: lo que importa es qué hace y si es adecuada para ti.</p></div>
<ul class="tecnologias">${ctx.tecnologia.map((a) => html`<li>${icono('tecnologia')}<span><b>${a.nombre}</b><span>${a.para}</span></span></li>`)}</ul>
</div>
</section>
<section class="seccion" aria-labelledby="t-autorizacion" data-aparece>
<div class="contenedor estrecho">
<p class="etiqueta">Centro sanitario</p>
<h2 id="t-autorizacion">Autorizados por la <em>Comunidad de Madrid</em></h2>
<p>IEMEC es un centro sanitario autorizado por la Consejería de Sanidad de la Comunidad de Madrid, con el número de registro ${s.registro_sanitario.numero}. Los datos completos del titular y de la autorización están en el <a href="/aviso-legal/">aviso legal</a>.</p>
</div>
</section>
<div id="como-llegar">${ubicacion(ctx, { titulo: false })}</div>
${s.como_llegar.aparcamiento ? html`<section class="seccion" aria-labelledby="t-llegar-mas">
<div class="contenedor estrecho">
<h2 id="t-llegar-mas">Aparcamiento y transporte</h2>
${s.como_llegar.aparcamiento.map((t) => html`<p>${texto(t)}</p>`)}
</div>
</section>` : ''}
${llamadaFinal(ctx, { whatsapp: wa })}`;
  return {
    ruta: '/clinica/', tipo: 'clinica', whatsapp: wa, ref: 'web-clinica', migas: pasos,
    titulo: 'La clínica y cómo llegar · IEMEC Boadilla del Monte',
    descripcion: 'Así es IEMEC en la avenida Siglo XXI de Boadilla del Monte: consultas, cabinas, sala de procedimientos, tecnología, horario y cómo llegar.',
    cuerpo,
  };
}

// ── Tarjetas regalo ─────────────────────────────────────────────────────────────────────────
function tarjetasRegalo(ctx) {
  const t = ctx.datos.tarjetas;
  const general = B.urlWhatsapp(ctx, 'una tarjeta regalo', 'web-tarjeta-regalo');
  const pasos = [{ nombre: 'Inicio', ruta: '/' }, { nombre: 'Tarjetas regalo', ruta: '/tarjetas-regalo/' }];
  const cuerpo = html`${cabeceraPagina({
    pasos, etiqueta: 'Tarjetas regalo', titulo: html`Regala un momento <em>para cuidarse</em>`, adorno: 'regalo',
    entradilla: t.para_que,
    acciones: botonWhatsapp(general, 'Pedir una tarjeta por WhatsApp'),
  })}
<section class="seccion" aria-labelledby="t-importes">
<div class="contenedor">
<div class="titulo-seccion"><p class="etiqueta">Importes</p><h2 id="t-importes">Elige el importe</h2><p class="entrada">Pídela por WhatsApp con el importe ya escrito y te explicamos cómo recibirla. ${pendiente(t.pago_pendiente)}</p></div>
<ul class="importes">${t.importes.map((i) => html`<li class="tarjeta importe">
<div class="tarjeta-regalo-visual terciopelo" aria-hidden="true"><span class="marca-mini">IEMEC</span><span class="cifra-mini">${i} €</span></div>
<h3>${i} €</h3>
<a class="boton boton-oscuro" href="${B.urlWhatsapp(ctx, `tarjeta regalo de ${i} €`, `web-tarjeta-${i}`)}">${icono('whatsapp')}Pedir<span class="solo-lector"> la tarjeta regalo de ${i} €</span></a>
</li>`)}</ul>
</div>
</section>
<section class="seccion seccion-blanca" aria-labelledby="t-estuche" data-aparece>
<div class="contenedor ubicacion">
<div>
<p class="etiqueta">En mano</p>
<h2 id="t-estuche">También <em>en estuche</em></h2>
<p>${t.estuche.texto}</p>
<h3>Condiciones</h3>
<ul class="lista-rombo lista-condiciones">${t.condiciones.map((c) => html`<li>${c}</li>`)}</ul>
<p>${pendiente(t.condiciones_pendiente)}</p>
</div>
${ctx.foto(t.estuche.foto) ? html`<figure class="foto-marco"><div class="marco-dorado">${B.imagen(ctx, t.estuche.foto, { tamanos: '(min-width: 900px) 560px, 92vw' })}</div><figcaption>Los estuches de las tarjetas regalo.</figcaption></figure>` : ''}
</div>
</section>
<section class="seccion" aria-labelledby="t-antiguas" data-aparece>
<div class="contenedor estrecho">
<p class="etiqueta">Tarjetas de la web anterior</p>
<h2 id="t-antiguas">¿Ya tienes una tarjeta?</h2>
<p>${t.antiguas}</p>
<p>${pendiente(t.antiguas_pendiente)}</p>
<div class="acciones">${botonWhatsapp(B.urlWhatsapp(ctx, 'canjear una tarjeta regalo', 'web-tarjeta-canje'), 'Canjear mi tarjeta', 'boton-oscuro')}</div>
</div>
</section>`;
  return {
    ruta: '/tarjetas-regalo/', tipo: 'tarjetas', whatsapp: general, ref: 'web-tarjeta-regalo', migas: pasos, permitirPrecios: true,
    titulo: 'Tarjetas regalo · IEMEC Boadilla del Monte',
    descripcion: 'Tarjetas regalo de IEMEC para tratamientos de estética y bienestar en Boadilla del Monte: elige el importe, en tarjeta o en estuche, y pídela por WhatsApp.',
    cuerpo,
  };
}

// ── Pedir cita ──────────────────────────────────────────────────────────────────────────────
function pedirCita(ctx) {
  const s = ctx.sitio;
  const wa = B.urlWhatsapp(ctx, B.INTERES_GENERAL, 'web-pedir-cita');
  const pasos = [{ nombre: 'Inicio', ruta: '/' }, { nombre: 'Pedir cita', ruta: '/pedir-cita/' }];
  const cuerpo = html`${cabeceraPagina({
    pasos, etiqueta: 'Pedir cita', titulo: html`Pide tu cita, <em>como prefieras</em>`, adorno: 'calendario',
    entradilla: 'Por WhatsApp, por teléfono o dejándonos tus datos para que te llamemos. La primera cita es una valoración: te explicamos las opciones y el presupuesto, sin compromiso.',
  })}
<section class="seccion" aria-labelledby="t-formas">
<div class="contenedor">
<h2 class="solo-lector" id="t-formas">Formas de pedir cita</h2>
<div class="rejilla rejilla-3">
<article class="tarjeta">
<span class="tarjeta-icono">${icono('whatsapp')}</span>
<h3>Por WhatsApp</h3>
<p>Te contestamos en horario de la clínica y te damos cita en la misma agenda de la clínica.</p>
${botonWhatsapp(wa, 'Escribir por WhatsApp', 'boton-oscuro')}
</article>
<article class="tarjeta">
<span class="tarjeta-icono">${icono('telefono')}</span>
<h3>Por teléfono</h3>
<p>Llámanos al ${s.telefono.visible} en horario de la clínica.</p>
<a class="boton boton-oscuro" href="${B.telHref(ctx)}">${icono('telefono')}Llamar al ${s.telefono.visible}</a>
</article>
<article class="tarjeta">
<span class="tarjeta-icono">${icono('calendario')}</span>
<h3>Te llamamos</h3>
<p>Déjanos tu nombre y tu teléfono y te contactamos nosotros como prefieras: por WhatsApp, por teléfono o por correo.</p>
<a class="boton boton-linea" href="#formulario">Rellenar el formulario</a>
</article>
</div>
</div>
</section>
<section class="seccion seccion-blanca" id="formulario" aria-labelledby="t-form">
<div class="contenedor estrecho">
<p class="etiqueta">Te llamamos</p>
<h2 id="t-form">Déjanos tus datos</h2>
<p class="entrada">Solo lo necesario para contestarte. Los detalles de tu caso, mejor en consulta.</p>
${B.formulario(ctx, { id: 'cita', pagina: '/pedir-cita/', ref: 'web-pedir-cita' })}
</div>
</section>
<section class="seccion terciopelo" aria-labelledby="t-primera" data-aparece>
<div class="capitone-velo" aria-hidden="true"></div>
<div class="contenedor">
<div class="titulo-seccion"><p class="etiqueta">Tu primera visita</p><h2 id="t-primera">Qué pasa <em>en la primera cita</em></h2></div>
<ol class="pasos">
<li><h3>${icono('valoracion')}Te escuchamos</h3><p>Nos cuentas qué te preocupa y qué te gustaría conseguir. Si es un tratamiento médico, te atiende un médico.</p></li>
<li><h3>${icono('medico')}Te valoramos</h3><p>Revisamos tu salud y tus antecedentes y, si hace falta, exploramos la zona.</p></li>
<li><h3>${icono('plan')}Te proponemos un plan</h3><p>Las opciones que encajan contigo, con sus riesgos, el número de sesiones orientativo y el presupuesto por escrito.</p></li>
<li><h3>${icono('check')}Tú decides</h3><p>Sin prisas y sin compromiso. Si sigues adelante, reservamos la primera sesión.</p></li>
</ol>
</div>
</section>
${ubicacion(ctx, { ficha: true })}`;
  return {
    ruta: '/pedir-cita/', tipo: 'cita', whatsapp: wa, ref: 'web-pedir-cita', migas: pasos, formulario: true,
    titulo: 'Pedir cita · IEMEC Boadilla del Monte',
    descripcion: 'Pide cita en IEMEC, Boadilla del Monte, por WhatsApp, por teléfono o con el formulario: la primera cita es una valoración sin compromiso.',
    cuerpo,
  };
}

// ── Textos legales ──────────────────────────────────────────────────────────────────────────
function legal(ctx, { ruta, titulo, tituloSeo: tSeo, descripcion, contenido, etiqueta = 'Información legal' }) {
  const pasos = [{ nombre: 'Inicio', ruta: '/' }, { nombre: titulo, ruta }];
  const cuerpo = html`${cabeceraPagina({ pasos, etiqueta, titulo, adorno: 'escudo' })}
<div class="contenedor prosa">
<div class="aviso-borrador-legal" role="note"><p>${pendiente('revisión del abogado sanitario y del DPD')}</p></div>
${contenido}
</div>`;
  return { ruta, tipo: 'legal', migas: pasos, titulo: tSeo, descripcion, cuerpo, ref: `web-${ruta.replace(/\//g, '')}` };
}

// ── Gracias y 404 ───────────────────────────────────────────────────────────────────────────
function gracias(ctx) {
  const wa = B.urlWhatsapp(ctx, B.INTERES_GENERAL, 'web-gracias');
  const cuerpo = html`${cabeceraPagina({
    titulo: html`Gracias. <em>Hemos recibido tu solicitud.</em>`,
    entradilla: 'Te contactaremos por el medio que has elegido en horario de la clínica. Si nos escribes por WhatsApp, verás nuestro número: +34 722 83 32 85.',
    acciones: html`<a class="boton boton-oro" href="/">Volver al inicio</a><a class="boton boton-claro" href="/tratamientos/">Ver tratamientos</a>`,
  })}`;
  return { ruta: '/gracias/', tipo: 'gracias', whatsapp: wa, ref: 'web-gracias', indexable: false, titulo: 'Gracias · IEMEC', descripcion: 'Hemos recibido tu solicitud en IEMEC, Boadilla del Monte. Te contactaremos por el medio que has elegido en horario de la clínica.', cuerpo };
}
function error404(_ctx) {
  const cuerpo = html`${cabeceraPagina({
    etiqueta: 'Error 404',
    titulo: html`No encontramos <em>esta página</em>`,
    entradilla: 'Puede que la dirección haya cambiado con la web nueva. Busca el tratamiento o vuelve al inicio.',
    extra: html`<form class="formulario" action="/tratamientos/" method="get" role="search"><div class="campo buscador"><label for="q404">Busca un tratamiento</label><input type="search" id="q404" name="q">${icono('buscar')}</div></form>`,
    acciones: html`<a class="boton boton-oro" href="/">Ir al inicio</a><a class="boton boton-claro" href="/tratamientos/">Ver todos los tratamientos</a>`,
  })}`;
  return { ruta: '/404.html', tipo: 'error', indexable: false, titulo: 'Página no encontrada · IEMEC', descripcion: 'La página que buscas no existe o ha cambiado de dirección con la web nueva de IEMEC. Busca el tratamiento o vuelve al inicio.', cuerpo };
}

module.exports = {
  inicio, especialidad, tratamiento, tratamientos, equipoPagina, clinica, tarjetasRegalo, pedirCita, legal, gracias, error404,
  tituloSeo, descripcionSeo, recortar,
};
