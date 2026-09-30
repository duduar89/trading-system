'use strict';
// El modelo de la web: catálogo + contenidos + datos → páginas. El catálogo manda: todo tratamiento
// activo acaba en una página (propia o provisional) o en un «sin_pagina» con su motivo.
const fs = require('fs');
const path = require('path');
const { cargarNormas, prohibidasEn, avisosEn, comoTexto } = require('./normas');

const WEB = path.join(__dirname, '..');
const RAIZ = path.join(WEB, '..');
const leer = (ruta) => JSON.parse(fs.readFileSync(ruta, 'utf8'));

// Huella corta y estable (FNV-1a de 32 bits en base 36): la misma función está en web/js/web.js.
function huellaCorta(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const ROL_PROFESIONAL = { cirujano: 'Cirujano plástico', medico: 'Médico', tricologo: 'Equipo de medicina capilar', esteticista: 'Equipo de estética' };
const REGIMEN_MEDICO = new Set(['medicamento_receta', 'producto_sanitario', 'cirugia']);

function cargarDatos({ borradores = false } = {}) {
  const datos = {
    sitio: leer(path.join(WEB, 'datos', 'sitio.json')),
    especialidades: leer(path.join(WEB, 'datos', 'especialidades.json')),
    equipo: leer(path.join(WEB, 'datos', 'equipo.json')),
    tarjetas: leer(path.join(WEB, 'datos', 'tarjetas.json')),
    tecnologia: leer(path.join(WEB, 'datos', 'tecnologia.json')),
    provisionales: leer(path.join(WEB, 'datos', 'provisionales.json')),
    redirecciones: leer(path.join(WEB, 'datos', 'redirecciones.json')),
    catalogo: leer(path.join(RAIZ, 'semillas', 'iemec', 'tratamientos.json')),
    fotos: leer(path.join(WEB, 'fotos', 'fotos.json')),
    normas: cargarNormas(),
    contenidos: [],
    borradores: [],
  };
  const carpeta = path.join(WEB, 'contenido');
  for (const f of fs.readdirSync(carpeta).filter((x) => x.endsWith('.json')).sort()) {
    datos.contenidos.push({ fichero: f, ...leer(path.join(carpeta, f)) });
  }
  if (borradores) {
    const pend = path.join(carpeta, 'pendientes');
    if (fs.existsSync(pend)) {
      for (const f of fs.readdirSync(pend).filter((x) => x.endsWith('.json')).sort()) {
        datos.borradores.push({ fichero: `pendientes/${f}`, ...leer(path.join(pend, f)) });
      }
    }
  }
  return datos;
}

// Textos del catálogo que se pueden usar en una página provisional: sin prohibidas ni avisos.
function utilizable(txt, normas) {
  return !!txt && prohibidasEn(txt, normas).length === 0 && avisosEn(txt, normas).length === 0;
}

function construirModelo(datos) {
  const { catalogo, normas } = datos;
  const porId = new Map(catalogo.tratamientos.map((t) => [t.id, t]));
  const activos = catalogo.tratamientos.filter((t) => t.activo).map((t) => t.id);
  const faqs = new Map();
  for (const f of catalogo.faqs) {
    if (!faqs.has(f.tratamiento_id)) faqs.set(f.tratamiento_id, []);
    faqs.get(f.tratamiento_id).push(f);
  }
  const especialidades = datos.especialidades.especialidades.slice().sort((a, b) => a.orden - b.orden);
  const espPorSlug = new Map(especialidades.map((e) => [e.slug, e]));
  const avisos = [];

  const paginas = [];
  const sinPagina = [];
  const cubiertos = new Map(); // id → dónde
  const cubrir = (id, donde) => { if (!cubiertos.has(id)) cubiertos.set(id, donde); };

  // 1. Contenido de los redactores (y, con --borradores, los de contenido/pendientes).
  const fuentes = [...datos.contenidos.map((c) => ({ ...c, origen: 'contenido' })), ...datos.borradores.map((c) => ({ ...c, origen: 'borrador' }))];
  const slugs = new Set();
  for (const f of fuentes) {
    for (const p of f.paginas || []) {
      if (slugs.has(p.slug)) { avisos.push(`slug repetido «${p.slug}» en ${f.fichero}: se ignora la segunda`); continue; }
      if (!espPorSlug.has(p.especialidad)) { avisos.push(`especialidad desconocida ${p.especialidad} en ${f.fichero}`); continue; }
      slugs.add(p.slug);
      const ids = [...new Set([...(p.catalogo || []), ...(p.variantes || []).map((v) => v.catalogo).filter(Boolean)])];
      paginas.push({ ...p, catalogo: p.catalogo || [], ids, origen: f.origen, fichero: f.fichero, grupo: f.grupo });
      for (const id of ids) cubrir(id, `${f.fichero}:${p.slug}`);
    }
  }
  for (const f of fuentes) {
    for (const s of f.sin_pagina || []) {
      if (cubiertos.has(s.catalogo)) continue;
      if (f.origen === 'contenido') {
        sinPagina.push({ catalogo: s.catalogo, motivo: s.motivo, va_en: s.va_en || null, origen: f.fichero });
        cubrir(s.catalogo, `${f.fichero}:sin_pagina`);
      }
    }
  }

  // 2. Provisionales para lo que ningún contenido cubre. Lo que el catálogo marca como «oferta sin
  // confirmar» no se anuncia hasta que la clínica lo confirme (igual que hacen los redactores).
  const sinConfirmar = (id) => /oferta sin confirmar/i.test(porId.get(id)?.motivo_restriccion || '');
  const apartarSinConfirmar = (ids) => ids.filter((id) => {
    if (!sinConfirmar(id)) return true;
    sinPagina.push({ catalogo: id, motivo: `Oferta sin confirmar por la clínica: no se anuncia hasta que la confirme (catálogo). Sin página provisional.`, va_en: null, origen: 'generador' });
    cubrir(id, 'generador:sin_confirmar');
    return false;
  });
  const provisionales = [];
  const pendientesDeUnir = [];
  for (const e of datos.provisionales.paginas) {
    const libres = apartarSinConfirmar(e.catalogo.filter((id) => porId.get(id)?.activo && !cubiertos.has(id)));
    if (!libres.length) continue;
    if (e.unir_a) { pendientesDeUnir.push({ ...e, catalogo: libres }); continue; }
    let slug = e.slug;
    while (slugs.has(slug)) slug = `${slug}-2`;
    slugs.add(slug);
    const pag = paginaProvisional({ ...e, slug, catalogo: libres }, porId, faqs, normas);
    provisionales.push(pag);
    for (const id of libres) cubrir(id, `provisional:${slug}`);
  }
  paginas.push(...provisionales);
  for (const e of pendientesDeUnir) {
    const destino = paginas.find((p) => p.slug === e.unir_a);
    if (destino) {
      destino.ids.push(...e.catalogo);
      destino.unidos = [...(destino.unidos || []), ...e.catalogo];
      for (const id of e.catalogo) cubrir(id, `unido:${destino.slug}`);
    }
  }
  for (const s of datos.provisionales.sin_pagina) {
    if (porId.get(s.catalogo)?.activo && !cubiertos.has(s.catalogo)) {
      sinPagina.push({ catalogo: s.catalogo, motivo: s.motivo, va_en: null, origen: 'provisionales.json' });
      cubrir(s.catalogo, 'provisionales.json:sin_pagina');
    }
  }
  // 3. Lo que aún quede: una provisional genérica por tratamiento.
  for (const id of activos) {
    if (cubiertos.has(id) || !apartarSinConfirmar([id]).length) continue;
    const t = porId.get(id);
    const esp = especialidadDeFamilia(t);
    if (!esp) { sinPagina.push({ catalogo: id, motivo: 'Sin especialidad en la web nueva (tarjetas y vales van en /tarjetas-regalo/).', origen: 'generador' }); cubrir(id, 'generador'); continue; }
    let nombre = t.nombre.replace(/\s*\([^)]*\)/g, '').trim();
    if (prohibidasEn(nombre, normas).length || nombre.length > 40) nombre = `Valoración: ${espPorSlug.get(esp).nombre.toLowerCase()}`;
    let slug = slugificar(nombre);
    while (slugs.has(slug)) slug = `${slug}-2`;
    slugs.add(slug);
    const pag = paginaProvisional({ slug, especialidad: esp, catalogo: [id], tipo: t.publicidad_restringida || REGIMEN_MEDICO.has(t.regimen_legal) ? 'medico' : 'estetica', nombre, titulo: nombre, entradilla: null, orden: 900 }, porId, faqs, normas);
    paginas.push(pag);
    cubrir(id, `provisional:${slug}`);
    avisos.push(`provisional genérica para ${id}: añadirla a provisionales.json o a su grupo de contenido`);
  }

  // Derivados de cada página.
  for (const p of paginas) {
    const esp = espPorSlug.get(p.especialidad);
    p.ruta = `/${p.especialidad}/${p.slug}/`;
    p.principal = p.catalogo[0] || p.ids[0];
    const cats = p.ids.map((id) => porId.get(id)).filter(Boolean);
    p.medico = !!(p.restringida || p.tipo === 'medico' || p.tipo === 'cirugia'
      || cats.some((t) => t.rol_profesional === 'medico' || t.rol_profesional === 'cirujano' || REGIMEN_MEDICO.has(t.regimen_legal)));
    p.profesional = p.sesion?.profesional || p.profesional || profesionalDe(cats, p);
    p.sensible = !!esp.sensible;
    p.ref = esp.sensible ? `web-${esp.codigo_ref}-${huellaCorta(p.slug)}` : `web-${p.slug}`;
    p.interes = esp.sensible ? esp.grupo_neutro : p.nombre;
    // El id que va en el formulario: si nombra un medicamento o una marca, la especialidad (la app
    // traduce la referencia con web/datos/referencias.json).
    p.idFormulario = prohibidasEn(comoTexto(p.principal), normas).length ? p.especialidad : p.principal;
    p.orden = p.orden ?? 500;
  }
  // Referencias únicas.
  const refs = new Set();
  for (const p of paginas) {
    if (refs.has(p.ref)) p.ref = `${p.ref}-${huellaCorta(p.ruta).slice(0, 3)}`;
    refs.add(p.ref);
  }

  // Especialidades publicadas (con al menos una página) y sus páginas ordenadas.
  const publicadas = especialidades.map((e) => {
    const suyas = paginas.filter((p) => p.especialidad === e.slug)
      .sort((a, b) => (Number(!!b.destacado) - Number(!!a.destacado)) || (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'));
    return { ...e, ruta: `/${e.slug}/`, paginas: suyas, ref: `web-${e.slug}` };
  }).filter((e) => e.paginas.length);

  // Relacionados: los que pide el contenido (si existen) o, en las provisionales, los de su especialidad
  // que comparten preocupación.
  const porSlug = new Map(paginas.map((p) => [p.slug, p]));
  for (const p of paginas) {
    let rel = (p.relacionados || []).map((s) => porSlug.get(s)).filter(Boolean);
    const perdidos = (p.relacionados || []).filter((s) => !porSlug.has(s));
    if (perdidos.length) avisos.push(`${p.slug}: relacionados sin página (${perdidos.join(', ')})`);
    if (!rel.length) {
      rel = paginas.filter((q) => q !== p && q.especialidad === p.especialidad && (q.preocupaciones || []).some((x) => (p.preocupaciones || []).includes(x))).slice(0, 3);
    }
    p.relacionadas = rel.filter((q) => q !== p).slice(0, 4);
  }

  // Preocupaciones con páginas publicadas.
  const preocupaciones = datos.especialidades.preocupaciones.map((c) => ({
    ...c,
    paginas: paginas.filter((p) => (p.preocupaciones || []).includes(c.slug)),
  })).filter((c) => c.paginas.length);

  // Cobertura del catálogo.
  const sinCubrir = activos.filter((id) => !cubiertos.has(id));
  const paginaDeId = new Map();
  for (const p of paginas) for (const id of p.ids) if (!paginaDeId.has(id)) paginaDeId.set(id, p);

  return {
    paginas, publicadas, preocupaciones, sinPagina, avisos, porId, activos, cubiertos, sinCubrir, paginaDeId,
    espPorSlug,
  };
}

function profesionalDe(cats, p) {
  const roles = new Set(cats.map((t) => t.rol_profesional));
  const cirugia = cats.some((t) => t.regimen_legal === 'cirugia');
  if (p.especialidad === 'cirugia-capilar' && cirugia) return 'Equipo médico de cirugía capilar';
  if (roles.has('cirujano')) return ROL_PROFESIONAL.cirujano;
  if (roles.has('medico') || p.medico) return ROL_PROFESIONAL.medico;
  if (roles.has('tricologo')) return ROL_PROFESIONAL.tricologo;
  if (roles.has('esteticista')) return ROL_PROFESIONAL.esteticista;
  return null;
}

const FAMILIA_A_ESPECIALIDAD = {
  facial: 'medicina-estetica-facial', corporal: 'medicina-estetica-corporal', estetica_avanzada: 'medicina-estetica-corporal',
  perdida_peso: 'perdida-de-peso', nutricion: 'perdida-de-peso', medicina_capilar: 'medicina-capilar', head_spa: 'medicina-capilar',
  cirugia_capilar: 'cirugia-capilar', ginecoestetica: 'ginecologia-estetica', sexualidad_masculina: 'salud-sexual-masculina',
  cirugia_estetica: 'cirugia-estetica', otro: 'medicina-estetica-facial',
};
const especialidadDeFamilia = (t) => FAMILIA_A_ESPECIALIDAD[t.familia] || null;

function slugificar(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Texto genérico de una provisional. Con publicidad restringida no se usa nada del catálogo salvo el
// nombre neutro: problema, valoración médica y que el resultado varía.
const TXT = {
  medico: 'Es un tratamiento médico: requiere valoración médica previa. En la consulta, el médico revisa tu salud, explora la zona y te explica si el tratamiento es adecuado para ti, sus riesgos y contraindicaciones, las alternativas y el presupuesto.',
  medico2: 'Todo se decide en consulta, contigo y sin compromiso. El resultado varía según cada persona.',
  cirugia: 'Empieza con una consulta: el cirujano valora tu caso y te explica la técnica, el tipo de anestesia, si hace falta ingreso, la recuperación, los riesgos y las alternativas. Antes de operarte firmas el consentimiento informado por escrito.',
  cirugia2: 'Dónde se hace: [PENDIENTE: centro hospitalario autorizado o sala de procedimientos de IEMEC, según la intervención]. El seguimiento posterior se hace en IEMEC y el resultado varía según cada persona.',
  estetica: 'Lo hace el equipo de estética de IEMEC. En la primera cita vemos qué necesitas y te proponemos un número de sesiones orientativo.',
  estetica2: 'Cómo responde cada piel y cada persona es distinto, así que el plan se ajusta sobre la marcha.',
  capilar: 'Lo hace el equipo de medicina capilar [PENDIENTE: profesión y titulación]. Si el diagnóstico lo indica, el tratamiento médico lo pauta un médico.',
  capilar2: 'Cada caso es distinto: el plan depende de lo que muestre el diagnóstico y de cada persona.',
};
const PREGUNTAS = {
  medico: [
    { p: '¿Cómo es la primera consulta?', r: 'El médico te pregunta por tu salud y por lo que te preocupa, explora la zona y te explica las opciones, sus riesgos y el presupuesto. Tú decides después, sin compromiso.' },
    { p: '¿Tiene riesgos?', r: 'Como todo acto médico, sí. En la valoración te explicamos los riesgos y las contraindicaciones que aplican a tu caso y cómo reducirlos.' },
    { p: '¿Cómo pido cita?', r: 'Por WhatsApp, por teléfono o con el formulario «Te llamamos». Te damos cita para la valoración en la agenda de la clínica.' },
  ],
  cirugia: [
    { p: '¿Dónde se hace la intervención?', r: '[PENDIENTE: centro donde se hace esta intervención] Te lo explicamos con detalle en la consulta.' },
    { p: '¿Qué anestesia se usa?', r: 'Depende de la intervención y de tu caso. El cirujano te lo explica en la consulta, junto con los riesgos y los cuidados.' },
    { p: '¿Cómo es la recuperación?', r: 'Depende de la técnica y de cada persona. En la consulta te damos una estimación y te explicamos los cuidados que vas a necesitar.' },
  ],
  estetica: [
    { p: '¿Cuántas sesiones necesito?', r: 'Depende de tu piel y de lo que quieras mejorar. En la primera cita te proponemos un plan orientativo.' },
    { p: '¿Cómo pido cita?', r: 'Por WhatsApp, por teléfono o con el formulario «Te llamamos».' },
  ],
  capilar: [
    { p: '¿Cuánto dura el diagnóstico?', r: 'Te lo confirmamos al darte cita. Trae, si los tienes, análisis recientes o informes de tratamientos anteriores.' },
    { p: '¿Cómo pido cita?', r: 'Por WhatsApp, por teléfono o con el formulario «Te llamamos».' },
  ],
};

function paginaProvisional(e, porId, faqs, normas) {
  const cats = e.catalogo.map((id) => porId.get(id));
  const restringida = cats.some((t) => t.publicidad_restringida);
  const tipo = e.tipo || 'medico';
  const texto = [];
  if (e.problema) texto.push(e.problema);
  if (e.descripcion) texto.push(e.descripcion);
  else if (!restringida && !e.problema) {
    const d = cats.map((t) => t.descripcion).find((x) => utilizable(x, normas));
    if (d) texto.push(d);
  }
  texto.push(TXT[tipo], TXT[`${tipo}2`]);
  let preguntas = [];
  if (!restringida) {
    for (const t of cats) {
      for (const f of faqs.get(t.id) || []) {
        const p = f.pregunta.replace(/\s*\(original en francés\)/i, '').trim();
        if (utilizable(p, normas) && utilizable(f.respuesta, normas) && !/\d/.test(f.respuesta) && !preguntas.some((q) => q.p === p)) preguntas.push({ p, r: f.respuesta });
      }
    }
    preguntas = preguntas.slice(0, 3);
  }
  for (const q of PREGUNTAS[tipo]) if (preguntas.length < 4 && !preguntas.some((x) => x.p === q.p)) preguntas.push(q);
  const duraciones = cats.filter((t) => ['web', 'treatwell'].includes(t.duracion_fuente) && t.duracion_min).map((t) => t.duracion_min);
  const nombre = e.nombre;
  const titulo = e.titulo || nombre;
  return {
    slug: e.slug,
    especialidad: e.especialidad,
    catalogo: e.catalogo,
    ids: [...e.catalogo],
    orden: e.orden ?? 500,
    destacado: !!e.destacado,
    nombre,
    titulo,
    titulo_seo: null,
    descripcion_seo: null,
    entradilla: e.entradilla || (restringida ? null : cats.map((t) => t.descripcion).find((x) => utilizable(x, normas))) || `${nombre}: te explicamos en qué consiste y si encaja contigo en una primera valoración.`,
    para_quien: e.para_quien || [],
    texto,
    sesion: {
      duracion: !restringida && duraciones.length === 1 && e.catalogo.length === 1 ? `Unos ${duraciones[0]} minutos` : null,
      sesiones: null, anestesia: null, recuperacion: null,
      profesional: e.profesional || null,
    },
    variantes: e.variantes || [],
    resultados: null,
    preguntas,
    preocupaciones: e.preocupaciones || [],
    relacionados: [],
    restringida,
    revision_medica: true,
    tipo,
    origen: 'provisional',
    fichero: 'provisionales.json',
    pendiente: ['Página provisional generada desde el catálogo: la sustituye el texto de su grupo cuando llegue.'],
  };
}

// Redirecciones de la web anterior, afinadas con las páginas que existen.
function resolverRedirecciones(datos, modelo, rutas) {
  const { redirecciones, anclas } = datos.redirecciones;
  const norm = (u) => u.toLowerCase().replace(/\/+$/, '') || '/';
  const destinoValido = (d) => {
    if (rutas.has(d)) return d;
    return '/tratamientos/';
  };
  const reglas = [];
  for (const r of redirecciones) {
    let hacia = null;
    let motivo = 'inventario';
    for (const id of r.catalogo_ids || []) {
      const p = modelo.paginaDeId.get(id);
      if (p) { hacia = p.ruta; motivo = `catalogo:${id}`; break; }
    }
    if (!hacia) hacia = destinoValido(r.hacia);
    if (hacia !== r.hacia && motivo === 'inventario') motivo = 'sin página publicada';
    reglas.push({ desde: r.desde, hacia, original: r.hacia, motivo, igual: norm(r.desde) === norm(hacia) });
  }
  // Anclas: la página que recibe la URL vieja las resuelve con web.js.
  const receptora = new Map(reglas.map((r) => [norm(r.desde), r.hacia]));
  const mapas = new Map(); // ruta → { huella: destino }
  const detalle = [];
  for (const a of anclas) {
    const [base, frag] = a.desde.split('#');
    const recibe = receptora.get(norm(base));
    if (!recibe || !frag) continue;
    let destino = null;
    for (const id of a.catalogo_ids || []) {
      const p = modelo.paginaDeId.get(id);
      if (p) { destino = p.ruta; break; }
    }
    if (!destino && a.hacia && rutas.has(a.hacia)) destino = a.hacia;
    if (!destino || destino === recibe) continue;
    if (!mapas.has(recibe)) mapas.set(recibe, {});
    mapas.get(recibe)[huellaCorta(frag)] = destino;
    detalle.push({ desde: a.desde, recibe, destino });
  }
  return { reglas, mapas, anclas: detalle };
}

module.exports = { cargarDatos, construirModelo, resolverRedirecciones, huellaCorta, slugificar, WEB, RAIZ };
