'use strict';
// Los datos que llevan los textos legales (web/contenido/legal/*.md) y las páginas del equipo y de
// cirugía: el correo, el delegado de protección de datos, los profesionales (web/datos/equipo.json),
// el responsable asistencial y las fechas. En los .md van entre llaves dobles ({{correo}}…).
//
// En la vista previa, lo que falta sale como [PENDIENTE: …]. Con --publicar, lo que es de clase «b»
// (web/datos/lanzamiento.json) no se publica y lo de clase «a» se queda a la vista: el generador lo
// encuentra y no deja publicar.
const B = require('./base');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
function fechaLarga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}
// Un hueco en Markdown (entre comillas invertidas, como en los .md).
const hueco = (s) => `\`[PENDIENTE: ${s}]\``;

// ── Profesionales ──────────────────────────────────────────────────────────────────────────
// «null» es que falta el dato; «false», que no aplica (sin especialidad oficial, título español).
const tiene = (v) => typeof v === 'string' && v.trim() !== '';

// Para «Lo realiza» en las cirugías: nombre, especialidad oficial si la tiene y colegiación.
function quienEs(p) {
  const colegio = tiene(p.colegio) ? `, ${p.colegio}` : '';
  return `${p.nombre}${tiene(p.especialidad) ? `, especialista en ${p.especialidad}` : ''} (n.º de colegiado ${p.colegiado}${colegio})`;
}

// Los datos que constan, en una línea (equipo y aviso legal).
function datosProfesionales(p) {
  return [
    tiene(p.titulo) ? p.titulo : null,
    tiene(p.especialidad) ? `Especialista en ${p.especialidad}` : null,
    tiene(p.colegiado) ? `${tiene(p.colegio) ? `${p.colegio}, ` : ''}n.º de colegiado ${p.colegiado}` : null,
    tiene(p.titulo_extranjero) ? p.titulo_extranjero : null,
  ].filter(Boolean).join(' · ');
}

const celda = (s) => String(s).replace(/\|/g, '/');

// La tabla del aviso legal (apartado 3), solo con quien sale en la web.
function tablaProfesionales(personas, { publicar = false } = {}) {
  if (!publicar) {
    const valor = (v, falta) => (v === false ? '—' : tiene(v) ? celda(v) : hueco(falta));
    const filas = personas.map((p) => `| ${celda(p.nombre)} | ${valor(p.titulo, 'título académico oficial')} | ${valor(p.especialidad, 'especialidad oficial, si la tiene')} | ${tiene(p.colegiado) ? celda(`${tiene(p.colegio) ? `${p.colegio}, ` : ''}n.º ${p.colegiado}`) : hueco('colegio y n.º de colegiado')} | ${valor(p.titulo_extranjero, 'si el título es de otro país, Estado y homologación')} |`);
    filas.push(`| ${hueco('enfermería y resto del equipo sanitario')} | | | | |`);
    return ['| Profesional | Título académico oficial | Especialidad oficial | Colegio y n.º de colegiado | Estado que expidió el título y, en su caso, homologación |', '|---|---|---|---|---|', ...filas].join('\n');
  }
  // Publicada: nombre y área de cada persona y, si constan, sus datos; si falta alguno, se dan a
  // quien los pida (lanzamiento.json → equipo).
  const conDatos = personas.filter((p) => datosProfesionales(p));
  const faltan = personas.some((p) => p.colegiado === null || p.colegiado === undefined);
  const otros = (p) => (p.colegiado === false ? '—' : 'Te los damos si nos los pides');
  const filas = conDatos.length
    ? ['| Profesional | Área | Título, especialidad y colegiación |', '|---|---|---|', ...personas.map((p) => `| ${celda(p.nombre)} | ${celda(p.cargo)} | ${celda(datosProfesionales(p) || otros(p))} |`)]
    : ['| Profesional | Área |', '|---|---|', ...personas.map((p) => `| ${celda(p.nombre)} | ${celda(p.cargo)} |`)];
  const nota = faltan
    ? '\n\nEl título académico oficial, la especialidad, el colegio y el número de colegiado de cada profesional (y, si su título es de otro país, el Estado que lo expidió y su homologación o reconocimiento en España) te los damos si nos los pides, en la clínica o por correo.'
    : '';
  return filas.join('\n') + nota;
}

// «Responsable asistencial (dirección médica): …» (equipo.json → responsable).
function responsable(datos) {
  const codigo = datos.equipo.responsable;
  const p = codigo ? datos.equipo.personas.find((x) => x.codigo === codigo) : null;
  return p && tiene(p.colegiado) ? p : null;
}
function lineaResponsable(datos, { publicar = false } = {}) {
  const p = responsable(datos);
  if (p) return `Responsable asistencial (dirección médica): ${quienEs(p)}.`;
  return publicar ? '' : `Responsable asistencial (dirección médica): ${hueco('nombre y apellidos, titulación, colegio y número de colegiado')}.`;
}

// ── Plantilla ───────────────────────────────────────────────────────────────────────────────
function valores(datos, { personas = [], publicar = false } = {}) {
  const s = datos.sitio;
  const vb = (datos.lanzamiento && datos.lanzamiento.vistos_buenos) || {};
  const correo = (c) => `[${c}](mailto:${c})`;
  // Lo que dice el formulario según ofrezca WhatsApp o no (sitio.json → formulario.whatsapp).
  const whatsapp = B.conWhatsapp({ sitio: s });
  return {
    correo: tiene(s.correo) ? correo(s.correo) : hueco('correo'),
    dpd: s.dpd && tiene(s.dpd.correo) ? `${tiene(s.dpd.nombre) ? `${s.dpd.nombre} · ` : ''}${correo(s.dpd.correo)}` : hueco('nombre o empresa y correo del DPD'),
    profesionales: tablaProfesionales(personas, { publicar }),
    responsable_asistencial: lineaResponsable(datos, { publicar }),
    fecha_textos: vb.legal && esFecha(vb.legal.fecha) ? fechaLarga(vb.legal.fecha) : hueco('fecha de publicación'),
    // La versión entera, la que envía el formulario y guarda la app con cada consentimiento: la fecha
    // del DPD y la huella de los textos (web/lib/base.js · versionTextos).
    version_textos: B.versionTextos({ sitio: s }),
    fecha_accesibilidad: esFecha(s.accesibilidad_revisada) ? fechaLarga(s.accesibilidad_revisada) : hueco('fecha de la revisión'),
    medios_formulario: whatsapp ? 'WhatsApp, llamada o correo' : 'llamada o correo',
    confirmacion_whatsapp: whatsapp
      ? ' Si eliges WhatsApp, antes te escribimos una vez para confirmar que la solicitud es tuya (el formulario lo puede rellenar cualquiera con un número ajeno): si nos dices que no, borramos lo que se escribió con tu número.'
      : '',
  };
}

// Rellena los {{…}} de un texto legal. Una línea que se queda vacía desaparece.
function rellenarLegal(md, datos, opciones = {}) {
  const v = valores(datos, opciones);
  return md.replace(/^[ \t]*\{\{([a-z_]+)\}\}[ \t]*\n/gm, (m, k) => (k in v ? (v[k] ? `${v[k]}\n` : '') : m))
    .replace(/\{\{([a-z_]+)\}\}/g, (m, k) => (k in v ? v[k] : m));
}

module.exports = { rellenarLegal, tablaProfesionales, lineaResponsable, responsable, quienEs, datosProfesionales, fechaLarga, esFecha, tiene };
