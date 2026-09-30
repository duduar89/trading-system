#!/usr/bin/env node
'use strict';
// Importa el catálogo consolidado de la investigación (F0, catalogo.json) al formato de las
// semillas (semillas/iemec/tratamientos.json), que carga servidor/semillas.js:
//   node scripts/importar-catalogo.js <catalogo.json> [salida.json]
// Es determinista: el mismo catálogo da el mismo fichero, byte a byte, así que cuando llegue la
// versión revisada basta con volver a ejecutarlo. Solo pasa datos públicos útiles para la app: ni
// las dudas para la clínica ni la trazabilidad de la investigación (ni las fuentes del sector: otras
// clínicas, fabricantes y artículos). Lo que estaba en el fichero anterior y ya no está en el
// catálogo queda en «retirados» y las semillas lo desactivan. Salas y roles se comprueban contra el
// equipo de la agenda (semillas/iemec/equipo.json).
const fs = require('fs');
const path = require('path');
const { FAMILIAS } = require('../servidor/semillas');
const { MEDICAMENTOS, MARCAS_SANITARIAS, revisar } = require('../motor/repesca/filtro-legal');
const { normalizar } = require('../motor/repesca/interpretar');

const SALIDA = path.join(__dirname, '..', 'semillas', 'iemec', 'tratamientos.json');
const EQUIPO = path.join(__dirname, '..', 'semillas', 'iemec', 'equipo.json');

// Tipo de sala del catálogo → el de la base. Del quirófano externo solo se reserva en IEMEC la
// valoración, en consulta; la consulta ginecológica es una consulta con sillón y la cabina láser,
// la de aparatología. La sala de procedimientos (cirugía menor) es un tipo propio (migración 006).
const SALA_TIPO = {
  consulta_medica: 'consulta_medica', consulta_ginecologica: 'consulta_medica', quirofano_externo: 'consulta_medica',
  cabina_estetica: 'cabina_estetica', cabina_aparatologia: 'cabina_aparatologia', cabina_laser: 'cabina_aparatologia',
  sala_capilar: 'sala_capilar', sala_head_spa: 'head_spa', head_spa: 'head_spa', sala_procedimientos: 'sala_procedimientos',
  quirofano: 'quirofano', otra: 'otra', no_aplica: null,
};
const NOTA_SALA = {
  consulta_ginecologica: 'Se hace en consulta con sillón ginecológico.',
  sala_procedimientos: 'Necesita sala de procedimientos (cirugía menor), que aún no está en la agenda: la sala se ajusta en «Cabinas y tratamientos».',
};

// Profesional del catálogo → rol de la agenda, con nota cuando se pierde detalle.
const ROL = {
  medico_estetico: ['medico'], medico: ['medico'], esteticista: ['esteticista'], enfermeria: ['enfermeria'],
  cirujano_plastico: ['cirujano'], medico_capilar: ['tricologo'], no_aplica: [null],
  ginecologo: ['medico', 'Lo hace el ginecólogo: en la agenda vale cualquier médico hasta que se asigne profesional.'],
  cirujano_vascular: ['medico', 'Lo hace el cirujano vascular: en la agenda vale cualquier médico hasta que se asigne profesional.'],
  cirujano_digestivo: ['medico', 'La intervención la hace un cirujano de aparato digestivo; la valoración en IEMEC, un médico.'],
  nutricion: ['medico', 'Consulta de nutrición: en la agenda la atiende un médico.'],
};
// Un rol que no tiene nadie del equipo dejaría el tratamiento sin huecos (y la IA lo ofrecería).
// Mientras la clínica no dé de alta a esas personas, lo sanitario lo cubre un médico, con nota.
const QUIEN = { enfermeria: 'enfermería', cirujano: 'el cirujano', tricologo: 'la especialista capilar', nutricionista: 'nutrición' };

const REGIMENES = new Set(['medicamento_receta', 'producto_sanitario', 'aparatologia', 'cirugia', 'cosmetico', 'servicio', 'desconocido']);
const DURACION_FUENTE = { clinica: 'clinica', treatwell: 'treatwell', web: 'web', blog: 'web', sector: 'sector', estimada: 'estimada', no_aplica: 'estimada' };

// Qué ocupa agenda: tratamientos, protocolos y valoraciones. El resto se carga, con su nota (qué es
// y qué se reserva en su lugar), pero queda inactivo: ni agenda, ni IA, ni publicaciones.
const SE_RESERVA = { tratamiento: true, protocolo: true, valoracion: true, agrupador: false, promocion: false, complemento: false, producto: false };
const NO_SE_RESERVA = {
  agrupador: 'No se reserva: agrupa varias técnicas; se reserva la concreta o la valoración.',
  promocion: 'No se reserva: es una promoción sobre otras citas.',
  complemento: 'No se reserva: es un complemento que se añade a otra cita.',
  producto: 'No se reserva: es un producto, no una cita.',
};
const seReserva = (x) => Boolean(SE_RESERVA[x.tipo]) && x.reservable !== false && x.familia !== 'tarjeta_regalo';

// Por qué la IA no lo reserva sola (la cita la da una persona, después de la valoración).
const SIN_IA = {
  quirofano_externo: 'La intervención es fuera de IEMEC (hospital concertado): aquí solo se reserva la valoración en consulta, y la agenda una persona.',
  cirugia: 'Cirugía: la IA no la reserva; va tras una valoración y la agenda una persona.',
  sala_procedimientos: 'Procedimiento invasivo: la IA no lo reserva sin valoración previa.',
  medicamento_receta: 'Medicamento con receta: la IA no lo reserva sin valoración médica previa (la valoración, sí).',
  producto_sanitario: 'Producto sanitario: la IA no lo reserva sin valoración médica previa (la valoración, sí).',
  desconocido: 'Régimen legal sin confirmar: por precaución, la IA no lo reserva sin valoración previa.',
  restringido: 'Publicidad restringida: la IA no lo reserva sin valoración previa.',
  sin_confirmar: 'Oferta sin confirmar (solo sale en el blog o en directorios): la IA no lo reserva hasta que la clínica la confirme.',
};
// Motivo de la restricción cuando el catálogo no lo trae.
const MOTIVO = {
  medicamento_receta: 'Medicamento con receta: no se anuncia al público ni se nombra en promociones, plantillas ni textos de la IA.',
  producto_sanitario: 'Producto sanitario de uso profesional: no se anuncia al público ni se usa la marca como reclamo.',
  desconocido: 'Régimen legal sin confirmar: se trata como restringido por precaución.',
  nombre: 'Nombra un medicamento con receta o una marca de producto sanitario: no se anuncia al público.',
  sin_confirmar: 'Oferta sin confirmar por la clínica: no se anuncia hasta que la confirme.',
};
const RESTRINGE = new Set(['medicamento_receta', 'producto_sanitario', 'desconocido']);

// Frases de las notas del catálogo que son de la investigación y no de la clínica: de dónde sale
// cada dato, dudas por confirmar, reseñas, análisis comercial, erratas y promesas de la web y
// suposiciones. No pasan a la app (ni al repositorio, que es público).
const FUERA_DE_NOTAS = [
  /\bse fusiona|\bse asocia|\bse asigna|no se atribuye|variante_de|trazabilidad|\.md\b|\.json\b|\bid \d|endpoint|consultad[oa] el|entrada (genérica|agrupadora)|se crea a partir|no es una sección/i,
  /confirmar|confirmaci[oó]n|revisar|validar|unificar|a clasificar|\bduda|no se sabe|no se explica|no afirma|\bpuede ser\b|\bprobable|\?/i,
  /reseñ|opini[oó]n|pregunta respondida|infoboadilla|la bio de|la ficha de|menciona/i,
  /repesca|candidat[ao]|captaci[oó]n/i,
  /whatsapp|error de la web|errata|mal configurad|sin codificar|poco descriptiva|reutilizad|copia el de|por error/i,
  /riesgo publicitario|promesa|promete/i,
  /\bsupuest[oa]s?\b|\bse supone\b|\bse propone\b|\binferid[oa]s?\b|\bsuposici/i,
  /\bsector\b|valor por defecto|nombre del archivo/i,
];
const ABREVIATURA = /(?:\b(?:Dr|Dra|Sr|Sra|art|núm|pág|aprox|etc)|\b[A-Z])\.$/;

class ErrorCatalogo extends Error {}

function frases(texto) {
  const salida = [];
  let actual = '';
  for (const trozo of String(texto || '').split(/(?<=[.!?…])\s+/)) {
    actual = actual ? `${actual} ${trozo}` : trozo;
    if (ABREVIATURA.test(actual)) continue; // «Dr. Navarro»: la frase sigue
    if (actual.trim()) salida.push(actual.trim());
    actual = '';
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

// Sin enlaces (van en «fuentes»): «(art. 80, https://…)» → «(art. 80)». Si la frase solo
// presentaba el enlace («Ficha técnica: https://…»), se queda en nada.
function sinEnlaces(frase) {
  if (!/https?:\/\//.test(frase)) return frase;
  if (/:\s*https?:\/\/\S+$/.test(frase)) return '';
  return frase.replace(/[,:]?\s*\bhttps?:\/\/\S+?(?=[.,;:]?(?:\s|\)|$))/g, '').replace(/\s*\(\s*\)/g, '').replace(/\s+([.,;:])/g, '$1');
}

// Las notas que sí pasan, con los ids del catálogo cambiados por el nombre del tratamiento y sin
// los incisos de fuentes («(también en InfoBoadilla)», «; único promo con WhatsApp propio»).
function notasDelCatalogo(texto, nombres = new Map()) {
  const id = (m) => m.replace(/[«»]/g, '');
  return frases(texto)
    .map((f) => sinEnlaces(f)
      .replace(/\s*\([^()]*\b(?:InfoBoadilla|directorios)\b[^()]*\)/gi, '')
      .replace(/;\s*[^;()]*whatsapp[^;()]*(?=\))/gi, '')
      .replace(/;\s*por eso [^.;]*/gi, '')
      .replace(/«?\b[a-z0-9]+(?:-[a-z0-9]+)+\b»?/g, (m) => (nombres.has(id(m)) ? `«${nombres.get(id(m))}»` : m)))
    .filter((f) => f.length >= 12 && !FUERA_DE_NOTAS.some((r) => r.test(f)));
}

// Dos frases que dicen lo mismo (la del motivo legal y la de las notas): se queda la primera. Las
// muy cortas no se comparan.
const palabras = (f) => new Set(clave(f).split(' ').filter((p) => p.length > 3));
function sinRepetir(lista) {
  const salida = [];
  for (const f of lista) {
    const a = palabras(f);
    const repetida = salida.some((g) => {
      const b = palabras(g);
      let comunes = 0;
      for (const p of a) if (b.has(p)) comunes++;
      return Math.min(a.size, b.size) >= 3 && comunes / Math.min(a.size, b.size) >= 0.8;
    });
    if (!repetida) salida.push(f);
  }
  return salida;
}

// Recorta en una palabra, con «…».
function recortar(texto, max) {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max / 2 ? corte.slice(0, espacio) : corte).replace(/[\s,;:(«—-]+$/, '')}…`;
}

// Frases enteras hasta el máximo de la columna; la que no cabe se corta si queda sitio para algo.
function unirFrases(lista, max) {
  let salida = '';
  for (const f of lista) {
    const junto = salida ? `${salida} ${f}` : f;
    if (junto.length <= max) { salida = junto; continue; }
    const sitio = max - (salida ? salida.length + 1 : 0);
    if (sitio >= 40) salida = salida ? `${salida} ${recortar(f, sitio)}` : recortar(f, sitio);
    break;
  }
  return salida || null;
}

const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// «Aumento de pecho» → «aumento de pecho»; las siglas se quedan («IPL facial»).
const enMinuscula = (t) => (/^[A-ZÁÉÍÓÚÑ]{2,}\b/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
// Espacios y signos que quedan sueltos al quitar un inciso.
const repasar = (t) => t.replace(/\(\s*\)/g, '').replace(/\s+([.,;:)])/g, '$1').replace(/\s{2,}/g, ' ').trim();

// Precio publicado: los trozos (« · ») que quepan enteros, sin el descuento de último minuto de
// Treatwell (solo vale allí) ni lo que dicen las reseñas. Si el primero no cabe, sin su inciso. Si
// no queda nada (solo había último minuto o una reseña), no hay precio publicado.
function textoPrecio(texto, max) {
  if (!texto || /^no publicado$/i.test(texto)) return null;
  const trozos = String(texto).split(' · ')
    .filter((t) => !/último minuto/i.test(t))
    .map((t) => t.replace(/\s*\([^()]*(?:reseñ|opini)[^()]*\)/gi, '').trim())
    .filter(Boolean);
  if (!trozos.length) return null;
  let salida = '';
  for (const t of trozos) {
    const junto = salida ? `${salida} · ${t}` : t;
    if (junto.length > max) break;
    salida = junto;
  }
  return salida || recortar(trozos[0].replace(/\s*\([^()]*\)$/, ''), max) || null;
}

// «… (Clínica X; Fabricante (Y)).» → «…»: sin el paréntesis final, aunque lleve otros dentro.
function sinParentesisFinal(texto) {
  let t = String(texto).trim().replace(/\.$/, '').trim();
  if (!t.endsWith(')')) return t;
  let nivel = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ')') nivel++;
    else if (t[i] === '(' && --nivel === 0) return t.slice(0, i).trim();
  }
  return t;
}

// Sesiones sin la fuente de cada dato: «2-4 sesiones (blog «lipólisis»)» → «2-4 sesiones». Las
// que vienen del sector («Sector: 2 sesiones (Clínica X; Clínica Y).») se dicen con sus números:
// ni el nombre de otras clínicas ni las marcas de producto que cita el sector.
function sesionesLimpias(x) {
  const texto = x.sesiones;
  if (!texto) return null;
  const delSector = /^\s*sector\s*:/i.test(texto) || (x.valores_sector?.aplicado || []).some((a) => /^sesiones/.test(a));
  if (delSector) {
    if (x.sesiones_min == null) return recortar(mayuscula(sinParentesisFinal(String(texto).replace(/^\s*sector\s*:\s*/i, ''))), 80) || null;
    const n = x.sesiones_max != null && x.sesiones_max !== x.sesiones_min ? `${x.sesiones_min}-${x.sesiones_max}` : String(x.sesiones_min);
    const [una, varias] = /intervenci/i.test(texto) ? ['intervención', 'intervenciones'] : ['sesión', 'sesiones'];
    return `${n} ${n === '1' ? una : varias}`;
  }
  const limpio = String(texto)
    .replace(/\s*\((?:[^()«»]|«[^»]*»)*\b(?:blog|web|post|faq|landings?)\b(?:[^()«»]|«[^»]*»)*\)/gi, '')
    .replace(/\s+según (?:la|las|el|los|otro) (?:web|blog|post|faq|landings?)\b/gi, '')
    .split(';').map((s) => s.trim()).filter((s) => s && !/^[\d\s-]+$/.test(s) && !/no publicad/i.test(s)).join('; ');
  return recortar(limpio, 80) || null;
}

// La descripción es lo que sale en las ideas para la ficha de Google: sin de dónde sale cada dato
// («(Treatwell)», «según la web», «citado como…», «que el blog exige»). Si solo decía el nombre y
// que un directorio lo lista sin descripción, se queda vacía.
const FUENTE = String.raw`(?:Treatwell|Multiestetica|Doctoralia|InfoBoadilla|directorios?|(?:la |el )?(?:web|blog))`;
const INCISO_FUENTE = new RegExp(String.raw`\s*\((?:según\s+)?${FUENTE}(?:\s*(?:,|;|y)\s*${FUENTE})*\)`, 'gi');
const SEGUN_FUENTE = new RegExp(String.raw`\s+(?:en|según)\s+${FUENTE}\b`, 'gi');
function descripcionLimpia(texto, nombre) {
  if (!texto) return null;
  const limpio = repasar(String(texto)
    .replace(/\s*\([^()]*\bsin descripci[oó]n\b[^()]*\)/gi, '')
    .replace(INCISO_FUENTE, '')
    .replace(SEGUN_FUENTE, '')
    .replace(/,\s*(?:citad[oa]s?|mencionad[oa]s?)\b[^.;]*/gi, '')
    .replace(/\s+(?:que (?:la clínica|el blog|la web) cita|citad[oa]s?) como\s+/gi, ' ')
    .replace(/\s+que (?:el blog|la web|la clínica) exige\b/gi, ''));
  return limpio && clave(limpio) !== clave(nombre) ? recortar(limpio, 400) : null;
}

// Respuestas de las preguntas frecuentes sin las marcas de la investigación («(dato a validar)»,
// «(otro post dice…)», «: unificar criterio», «La web dice que…»): la duda la resuelve el equipo
// médico al aprobarla.
function respuestaLimpia(texto) {
  const limpio = repasar(String(texto)
    .replace(/\s*\([^()]*\b(?:validar|unificar|posts?|web|blog|publica)\b[^()]*\)/gi, '')
    .replace(/:\s*unificar criterio/gi, '')
    .replace(/;\s*la web no publica[^.;]*/gi, '')
    .replace(/(^|[.!?]\s+)según (?:la web|el blog),\s*(\S)/gi, (_, antes, letra) => `${antes}${letra.toUpperCase()}`)
    .replace(/^La web cita\s+/i, 'Se citan ')
    .replace(/^La web (?:dice que|indica que|indica|habla de)\s+/i, ''));
  return mayuscula(limpio);
}
const preguntaLimpia = (texto) => repasar(String(texto).replace(/\s*\((?:otra entrada|duplicad[ao])\)/gi, ''));

const clave = (s) => normalizar(s).replace(/[«»"'.,;:()]/g, '').replace(/\s+/g, ' ').trim();
const nombraRestringido = (texto) => [...MEDICAMENTOS, ...MARCAS_SANITARIAS].some((p) => new RegExp(`\\b${normalizar(p)}\\b`).test(normalizar(texto)));
const codigoAparato = (c) => (c ? String(c).toLowerCase() : null);
// «Láser Fotona (modelo no publicado)» → «Láser Fotona»: lo que falta saber va en las notas.
const nombreAparato = (n) => String(n).replace(/\s*\([^()]*\bno (?:publicad|confirmad)[^()]*\)/gi, '').trim();
// «Plan de estrías (Multiestetica)» → «Plan de estrías»: de dónde sale no es parte del nombre.
const nombreLimpio = (n) => String(n).replace(/\s*\((?:Multiestetica|Treatwell)\)$/, '');
// Del quirófano externo, en IEMEC solo se reserva la valoración, y su nombre es el que lee el
// paciente en la confirmación, en el .ics y en «Tu cita»: «Valoración de aumento de pecho». El
// nombre de la cirugía queda como alias, para encontrarla.
function nombreEnIemec(x) {
  const n = nombreLimpio(x.nombre);
  if (x.sala_tipo !== 'quirofano_externo' || /^(?:valoraci[oó]n|consulta)\b/i.test(n)) return n;
  return `Valoración de ${enMinuscula(n)}`;
}

const DE_LA_CLINICA = /^https?:\/\/(?:www\.)?iemec-clinic\.com(?:\/|$)/;

// De dónde sale el «repetir cada»: el blog o la web de la clínica, el sector (valor por defecto a
// validar) u otra fuente externa. El enlace no se guarda aquí.
function repetirFuente(x) {
  const f = x.repetir_fuente;
  if (!f || f === 'no_publicado' || x.repetir_cada_dias == null) return null;
  if ((x.valores_sector?.aplicado || []).includes('repetir_cada_dias')) return 'sector';
  if (!/^https?:\/\//.test(f)) return String(f).slice(0, 40);
  if (!DE_LA_CLINICA.test(f)) return 'externa';
  return /\/blog\//.test(f) ? 'blog' : 'web';
}

// Fuentes: las de la clínica (su web, sus carteles y sus fichas en directorios) y las normas y
// fichas oficiales que el catálogo cita para el régimen legal. Las del sector (otras clínicas,
// fabricantes y artículos de los que salen los valores por defecto) son trazabilidad de la
// investigación: no pasan.
function fuentesPublicas(x) {
  const delSector = new Set([
    ...(x.valores_sector?.fuentes || []).map((f) => f.url),
    ...[x.holgura_fuente, x.repetir_fuente].filter((u) => /^https?:\/\//.test(u || '') && !DE_LA_CLINICA.test(u)),
  ]);
  const salida = [];
  for (const u of [...(x.fuentes || []), ...(x.fuentes_externas || []), ...(DE_LA_CLINICA.test(x.repetir_fuente || '') ? [x.repetir_fuente] : [])]) {
    if (!delSector.has(u) && !salida.includes(u)) salida.push(u);
  }
  return salida;
}

// Un texto de botón de WhatsApp → un solo tratamiento, para que al llegar el mensaje se sepa de
// qué es. El texto genérico («quisiera reservar una cita») no dice nada y el de un botón
// equivocado es de otro tratamiento: no se guardan. El compartido se queda en uno que se reserve
// (el que no se reserva no está en la agenda ni lo encuentra la entrada de leads) y, entre ellos,
// en el más general.
const PREFERENCIA_WHATSAPP = { tratamiento: 0, protocolo: 1, valoracion: 2, agrupador: 3 };
function textosWhatsApp(lista) {
  const grupos = new Map();
  lista.forEach((x, i) => {
    if (!x.texto_whatsapp || ['generico', 'erroneo_web', 'no_publicado'].includes(x.texto_whatsapp_estado)) return;
    const k = clave(x.texto_whatsapp);
    (grupos.get(k) || grupos.set(k, []).get(k)).push({ x, i });
  });
  const dueno = new Map();
  for (const g of grupos.values()) {
    g.sort((a, b) => Number(seReserva(b.x)) - Number(seReserva(a.x))
      || (PREFERENCIA_WHATSAPP[a.x.tipo] ?? 9) - (PREFERENCIA_WHATSAPP[b.x.tipo] ?? 9) || a.i - b.i);
    for (const { x } of g) dueno.set(x.id, g[0].x);
  }
  return dueno;
}

function validar(c, equipo) {
  if (!Array.isArray(c?.tratamientos) || !c.tratamientos.length) throw new ErrorCatalogo('El catálogo no tiene «tratamientos»');
  const familias = new Set(FAMILIAS.map(([codigo]) => codigo));
  const salas = equipo ? (equipo.salas || []).map((s) => s.codigo) : null;
  const aparatos = new Set();
  for (const a of c.aparatos || []) {
    const codigo = codigoAparato(a.codigo);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(codigo || '') || codigo.length > 40) throw new ErrorCatalogo(`Código de aparato no válido: «${a.codigo}»`);
    if (aparatos.has(a.codigo)) throw new ErrorCatalogo(`Aparato repetido: «${a.codigo}»`);
    aparatos.add(a.codigo);
  }
  const vistos = new Set();
  for (const x of c.tratamientos) {
    const donde = `«${x.id}»`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(x.id || '') || x.id.length > 80) throw new ErrorCatalogo(`Id no válido: ${donde}`);
    if (vistos.has(x.id)) throw new ErrorCatalogo(`Id repetido: ${donde}`);
    vistos.add(x.id);
    if (!familias.has(x.familia)) throw new ErrorCatalogo(`Familia nueva «${x.familia}» en ${donde}: añádela a FAMILIAS en servidor/semillas.js con su nombre`);
    if (!(x.sala_tipo in SALA_TIPO)) throw new ErrorCatalogo(`Tipo de sala desconocido «${x.sala_tipo}» en ${donde}: añádelo a SALA_TIPO`);
    if (!(x.profesional in ROL)) throw new ErrorCatalogo(`Profesional desconocido «${x.profesional}» en ${donde}: añádelo a ROL`);
    if (!REGIMENES.has(x.regimen_legal)) throw new ErrorCatalogo(`Régimen legal desconocido «${x.regimen_legal}» en ${donde}`);
    if (!(x.duracion_fuente in DURACION_FUENTE)) throw new ErrorCatalogo(`Fuente de duración desconocida «${x.duracion_fuente}» en ${donde}`);
    if (!(x.tipo in SE_RESERVA)) throw new ErrorCatalogo(`Tipo desconocido «${x.tipo}» en ${donde}`);
    for (const e of [x.equipo_codigo, ...(x.equipos_adicionales || [])].filter(Boolean)) {
      if (!aparatos.has(e)) throw new ErrorCatalogo(`${donde} usa el aparato «${e}», que no está en «aparatos»`);
    }
    // La sala concreta que escriba la clínica (plantilla-salas.csv) tiene que ser una de la agenda:
    // con otra, el tratamiento se quedaría sin sala y sin huecos.
    for (const s of [].concat(x.sala_id || [])) {
      if (salas && !salas.includes(s)) throw new ErrorCatalogo(`${donde} va a la sala «${s}», que no está en semillas/iemec/equipo.json. Salas: ${salas.join(', ')}`);
    }
  }
  for (const f of c.faqs || []) {
    if (!f.pregunta || !(f.respuesta_resumida || f.respuesta)) throw new ErrorCatalogo(`Pregunta frecuente sin pregunta o sin respuesta: «${f.id || f.pregunta}»`);
    if (f.tratamiento_id && !vistos.has(f.tratamiento_id)) throw new ErrorCatalogo(`La pregunta «${f.pregunta}» es de «${f.tratamiento_id}», que no está en el catálogo`);
  }
}

// Rol de la agenda y su nota. Si nadie del equipo tiene el rol, lo sanitario pasa a un médico
// (con nota) y lo demás para el importador: sin nadie que lo haga no habría huecos.
function rolDe(x, { activo, roles }) {
  const [rol, nota] = ROL[x.profesional];
  if (!rol || !roles || roles.has(rol)) return [rol, nota];
  if (QUIEN[rol] && roles.has('medico')) {
    return ['medico', `Lo hace ${QUIEN[rol]}, que aún no está en el equipo de la agenda: mientras, vale cualquier médico.`];
  }
  if (activo) throw new ErrorCatalogo(`«${x.id}» lo hace el rol «${rol}» y nadie del equipo lo tiene: añádelo a semillas/iemec/equipo.json`);
  return [rol, nota];
}

function tratamiento(x, { porId, whatsapp, avisos, roles }) {
  const activo = seReserva(x);
  if (!activo && x.reservable) avisos.push(`«${x.id}» (${x.tipo}) figura como reservable en el catálogo, pero no se reserva`);
  const duracion = Number(x.duracion_min) || 0;
  if (activo && !(duracion > 0)) throw new ErrorCatalogo(`«${x.id}» se reserva y no tiene duración`);
  const [rol, notaRol] = rolDe(x, { activo, roles });
  const nombre = nombreEnIemec(x);
  const alias = [];
  for (const a of [nombreLimpio(x.nombre), ...(x.aliases || []), ...(x.nombres_treatwell || []), ...(x.nombres_multiestetica || [])]) {
    if (clave(a) !== clave(nombre) && !alias.some((b) => clave(b) === clave(a))) alias.push(a);
  }

  // Publicidad restringida: la del catálogo, y siempre la de medicamentos con receta, productos
  // sanitarios y régimen sin confirmar, o si el nombre dice un medicamento o una marca sanitaria.
  // Y lo que la clínica no ha confirmado que ofrezca tampoco se anuncia.
  const porNombre = nombraRestringido([nombre, ...alias].join(' · '));
  const legal = Boolean(x.publicidad_restringida) || RESTRINGE.has(x.regimen_legal) || porNombre;
  const sinConfirmar = x.oferta_confirmada === false;
  const motivo = [
    ...(legal ? frases(x.publicidad_motivo || MOTIVO[x.regimen_legal] || MOTIVO.nombre).map(sinEnlaces).filter(Boolean) : []),
    ...(sinConfirmar ? [MOTIVO.sin_confirmar] : []),
  ];
  const motivoCabe = [];
  for (const f of motivo) if ([...motivoCabe, f].join(' ').length <= 255) motivoCabe.push(f); else break;

  const sinIa = [];
  if (activo) {
    if (x.sala_tipo === 'quirofano_externo') sinIa.push(SIN_IA.quirofano_externo);
    else if (x.regimen_legal === 'cirugia') sinIa.push(SIN_IA.cirugia);
    else if (x.sala_tipo === 'sala_procedimientos') sinIa.push(SIN_IA.sala_procedimientos);
    if (legal && x.tipo !== 'valoracion') sinIa.push(SIN_IA[x.regimen_legal] || SIN_IA.restringido);
    if (sinConfirmar) sinIa.push(SIN_IA.sin_confirmar);
  }

  const canonico = whatsapp.get(x.id);
  const texto = canonico && canonico.id === x.id ? x.texto_whatsapp : null;
  const notaWhatsApp = x.texto_whatsapp_estado === 'erroneo_web' ? 'El botón de WhatsApp de la web manda el texto de otro tratamiento.'
    : canonico && canonico.id !== x.id ? `El botón de WhatsApp de la web manda el mismo texto que «${porId.nombres.get(canonico.id)}».` : null;
  const adicionales = (x.equipos_adicionales || []).map((e) => nombreAparato(porId.aparatos.get(e)?.nombre || e));
  const inicial = x.cita_inicial && porId.tratamientos.get(x.cita_inicial);

  const notas = unirFrases(sinRepetir([
    ...(activo ? [] : [NO_SE_RESERVA[x.tipo] || NO_SE_RESERVA.producto]),
    ...(inicial ? [`Se empieza por «${porId.nombres.get(inicial.id)}».`] : []),
    ...sinIa,
    ...(activo && NOTA_SALA[x.sala_tipo] ? [NOTA_SALA[x.sala_tipo]] : []),
    ...(activo && notaRol ? [notaRol] : []),
    ...(adicionales.length ? [`Usa además: ${adicionales.join('; ')}.`] : []),
    ...(notaWhatsApp ? [notaWhatsApp] : []),
    ...notasDelCatalogo(x.notas, porId.nombres),
    ...motivo.slice(motivoCabe.length),
  ]), 600);

  return {
    id: x.id,
    nombre,
    familia: x.familia,
    subfamilia: x.subfamilia || null,
    descripcion: descripcionLimpia(x.descripcion, nombreLimpio(x.nombre)),
    duracion_min: activo ? duracion : 0,
    duracion_fuente: DURACION_FUENTE[x.duracion_fuente],
    primera_visita_min: x.primera_visita_min ?? null,
    holgura_antes_min: x.holgura_antes_min ?? 0,
    holgura_despues_min: activo ? x.holgura_despues_min ?? x.holgura_min ?? 10 : 0,
    crema_anestesica_min: x.crema_anestesica_min ?? 0,
    precio_eur: x.precio_eur ?? null,
    precio_texto: textoPrecio(x.precio_texto, 80),
    es_promocion: Boolean(x.es_promocion),
    rol_profesional: rol,
    sala_tipo: SALA_TIPO[x.sala_tipo],
    salas: [].concat(x.sala_id || []),
    equipo_codigo: codigoAparato(x.equipo_codigo),
    sesiones: sesionesLimpias(x),
    intervalo_sesiones_dias: x.intervalo_sesiones_dias ?? null,
    repetir_cada_dias: x.repetir_cada_dias ?? null,
    repetir_fuente: repetirFuente(x),
    regimen_legal: x.regimen_legal,
    publicidad_restringida: legal || sinConfirmar,
    motivo_restriccion: motivoCabe.join(' ') || null,
    texto_whatsapp: texto ? recortar(texto, 400) : null,
    alias,
    fuentes: fuentesPublicas(x),
    notas,
    reservable_ia: activo && sinIa.length === 0,
    activo,
  };
}

function aparato(a) {
  const estado = a.estado === 'confirmado' ? 'Publicado por la clínica o en directorios.' : 'Inferido: la clínica no lo publica.';
  return {
    codigo: codigoAparato(a.codigo),
    nombre: recortar(nombreAparato(a.nombre), 80),
    tipo: null,
    // Si el catálogo no dice si es portátil, lo decide semillas.js (fijo si tiene cabina asignada).
    movil: typeof a.portatil === 'boolean' ? a.portatil : null,
    unidades: a.unidades || 1,
    notas: unirFrases([estado, ...notasDelCatalogo(a.notas)], 255),
  };
}

// Preguntas frecuentes, todas sin aprobar: el equipo médico las aprueba antes de que la IA las use.
// Las que el catálogo marca para validar también entran (esa validación es la aprobación), sin las
// marcas de la investigación. Sin repetir la misma pregunta de un tratamiento (la base compara sin
// mayúsculas ni tildes).
function preguntas(lista, avisos) {
  const vistas = new Set();
  const salida = [];
  let repetidas = 0;
  let porValidar = 0;
  for (const f of lista) {
    const pregunta = preguntaLimpia(f.pregunta);
    const respuesta = respuestaLimpia(f.respuesta_resumida || f.respuesta);
    const k = `${f.tratamiento_id || ''}|${clave(pregunta)}`;
    if (vistas.has(k) || !respuesta) { repetidas++; continue; }
    vistas.add(k);
    if (f.requiere_validacion) porValidar++;
    salida.push({ tratamiento_id: f.tratamiento_id || null, pregunta: recortar(pregunta, 255), respuesta: recortar(respuesta, 800), url: f.url || null });
  }
  if (porValidar) avisos.push(`${porValidar} preguntas frecuentes que el catálogo marca para validar se cargan igual, sin aprobar (las valida el equipo médico al aprobarlas)`);
  if (repetidas) avisos.push(`${repetidas} preguntas frecuentes repetidas en el mismo tratamiento no se cargan`);
  const noPasan = salida.filter((f) => !revisar(f.respuesta, { tipo: 'conversacion' }).ok).map((f) => `${f.tratamiento_id}: ${f.pregunta}`);
  if (noPasan.length) avisos.push(`${noPasan.length} respuestas no pasan el filtro legal y la IA no las usará tal cual aunque se aprueben: ${noPasan.join('; ')}`);
  return salida;
}

const ordenados = (lista) => [...new Set(lista)].sort();
const leerEquipo = (ruta = EQUIPO) => (fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : null);

/**
 * Catálogo consolidado → datos de semillas/iemec/tratamientos.json.
 * @param {object} catalogo el JSON del catálogo
 * @param {object} o { anterior: el fichero de semillas que había (para saber qué se retira),
 *                     equipo: semillas/iemec/equipo.json (salas y roles de la agenda) }
 * @returns {{ datos: object, avisos: string[] }}
 */
function convertir(catalogo, { anterior = null, equipo = leerEquipo() } = {}) {
  validar(catalogo, equipo);
  const avisos = [];
  const roles = equipo ? new Set((equipo.profesionales || []).map((p) => p.rol)) : null;
  const porId = {
    tratamientos: new Map(catalogo.tratamientos.map((x) => [x.id, x])),
    aparatos: new Map((catalogo.aparatos || []).map((a) => [a.codigo, a])),
    nombres: new Map(catalogo.tratamientos.map((x) => [x.id, nombreEnIemec(x)])),
  };
  const whatsapp = textosWhatsApp(catalogo.tratamientos);
  const tratamientos = catalogo.tratamientos.map((x) => tratamiento(x, { porId, whatsapp, avisos, roles }));
  const aparatos = (catalogo.aparatos || []).map(aparato);
  const faqs = preguntas(catalogo.faqs || [], avisos);

  const repetidos = new Map();
  for (const t of tratamientos) {
    for (const a of t.alias) (repetidos.get(clave(a)) || repetidos.set(clave(a), new Set()).get(clave(a))).add(t.id);
  }
  for (const [a, ids] of repetidos) if (ids.size > 1) avisos.push(`El alias «${a}» es de varios tratamientos: ${[...ids].join(', ')}`);

  const ids = new Set(tratamientos.map((t) => t.id));
  const codigos = new Set(aparatos.map((a) => a.codigo));
  const retirados = {
    tratamientos: ordenados([...(anterior?.tratamientos || []).map((t) => t.id), ...(anterior?.retirados?.tratamientos || [])].filter((id) => !ids.has(id))),
    aparatos: ordenados([...(anterior?.aparatos || []).map((a) => a.codigo), ...(anterior?.retirados?.aparatos || [])].filter((c) => !codigos.has(c))),
  };
  const revisado = (catalogo.revisiones || []).map((r) => r.fecha).filter(Boolean).sort().at(-1);
  const datos = {
    _origen: `Catálogo consolidado de la investigación (${catalogo.generado || 'sin fecha'}${revisado && revisado !== catalogo.generado ? `, revisado el ${revisado}` : ''}), importado con scripts/importar-catalogo.js: no se edita a mano, se vuelve a importar. Salas, aparatos, duraciones (estimadas o del sector) y precios, pendientes de validar por la clínica.`,
    tratamientos,
    aparatos,
    faqs,
    retirados,
  };
  return { datos, avisos };
}

function resumen(datos) {
  const t = datos.tratamientos;
  const n = (f) => t.filter(f).length;
  return [
    `${t.length} tratamientos: ${n((x) => x.activo)} se reservan, ${n((x) => x.reservable_ia)} los puede reservar la IA, ${n((x) => x.publicidad_restringida)} con publicidad restringida`,
    `${datos.aparatos.length} aparatos y ${datos.faqs.length} preguntas frecuentes (sin aprobar)`,
    `Retirados del fichero anterior: ${datos.retirados.tratamientos.length} tratamientos y ${datos.retirados.aparatos.length} aparatos`,
  ];
}

function main(argv) {
  const [origen, destino = SALIDA] = argv;
  if (!origen) {
    console.error('Uso: node scripts/importar-catalogo.js <catalogo.json> [salida.json]');
    return 2;
  }
  const catalogo = JSON.parse(fs.readFileSync(origen, 'utf8'));
  const anterior = fs.existsSync(destino) ? JSON.parse(fs.readFileSync(destino, 'utf8')) : null;
  const { datos, avisos } = convertir(catalogo, { anterior });
  fs.writeFileSync(destino, `${JSON.stringify(datos, null, 2)}\n`);
  for (const l of resumen(datos)) console.log(`▸ ${l}`);
  for (const a of avisos) console.log(`  · ${a}`);
  console.log(`✓ ${path.relative(process.cwd(), destino) || destino}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${err instanceof ErrorCatalogo ? err.message : err.stack}`);
    process.exitCode = 1;
  }
}

module.exports = { convertir, notasDelCatalogo, frases, ErrorCatalogo, SALA_TIPO, ROL };
