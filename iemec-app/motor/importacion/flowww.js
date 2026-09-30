'use strict';
// Lo que llega de Flowww, puesto en limpio para importarlo (sin base de datos ni red):
//   · qué columna es qué: los nombres típicos en español o lo que diga el mapa (--mapa)
//   · teléfonos en cualquier formato → E.164 (España si no dice otro país), emails y nombres
//   · fechas dd/mm/aaaa o aaaa-mm-dd, horas hh:mm y duraciones
//   · «sí» y «no» explícitos: el consentimiento solo cuenta si una columna lo dice
//   · estados de la cita de Flowww: cuáles se traen y cuáles no
//   · con qué tratamiento, profesional o cabina de la app casa cada nombre de Flowww y, si no casa,
//     los más parecidos
const crypto = require('crypto');
const { normalizarTelefono, normalizarEmail, limpiarNombre } = require('../entrada/leads');

const IGNORAR = 'ignorar';
const CUALQUIERA = 'cualquiera';
const IMPORTAR = 'importar';

// «Tel. Móvil:» → «tel movil». Para comparar nombres de columnas, servicios, personas y cabinas.
const clave = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ── Columnas ────────────────────────────────────────────────────────────────────────────────
// Los campos de cada fichero y los nombres con los que suelen venir, por orden de preferencia (los
// concretos antes que los genéricos: «Nº cita» antes que «Código»). Cada campo sale de una sola
// columna, salvo los de VARIAS: los apellidos y las observaciones se juntan (primer y segundo
// apellido), y del teléfono, el email y el consentimiento vale la primera que traiga algo útil (el
// móvil antes que el fijo).
const TELEFONO = ['Móvil', 'Teléfono móvil', 'Tel. móvil', 'Celular', 'WhatsApp', 'Teléfono', 'Tel', 'Tlf', 'Tfno', 'Teléfono 1', 'Teléfono 2', 'Teléfono fijo'];
const EMAIL = ['Email', 'E-mail', 'Correo', 'Correo electrónico', 'Mail'];
const OBSERVACIONES = ['Observaciones', 'Notas', 'Comentarios', 'Nota'];
const CAMPOS = {
  pacientes: {
    id: ['Código cliente', 'Cód. cliente', 'Id cliente', 'Nº cliente', 'Número de cliente', 'Nº historia', 'Historia', 'Código', 'Id', 'Referencia'],
    nombre: ['Nombre', 'Nombre cliente', 'Nombre y apellidos', 'Nombre completo', 'Cliente', 'Paciente'],
    apellidos: ['Apellidos', 'Primer apellido', 'Apellido 1', 'Apellido', 'Segundo apellido', 'Apellido 2'],
    telefono: TELEFONO,
    email: EMAIL,
    fecha_nacimiento: ['Fecha nacimiento', 'Fecha de nacimiento', 'F. nacimiento', 'F. nac.', 'Nacimiento'],
    observaciones: OBSERVACIONES,
    // Consentimiento de marketing: por los dos canales, solo WhatsApp o solo email.
    marketing: ['Consentimiento marketing', 'Acepta publicidad', 'Publicidad', 'Acepta comunicaciones comerciales', 'Comunicaciones comerciales',
      'Marketing', 'LOPD publicidad', 'Consentimiento publicidad', 'Consentimiento comercial'],
    marketing_whatsapp: ['Publicidad WhatsApp', 'WhatsApp publicidad', 'Marketing WhatsApp'],
    marketing_email: ['Publicidad email', 'Email publicidad', 'Marketing email', 'Newsletter'],
  },
  citas: {
    id: ['Id cita', 'Nº cita', 'Número de cita', 'Código cita', 'Localizador', 'Id', 'Código', 'Referencia'],
    paciente_id: ['Código cliente', 'Cód. cliente', 'Id cliente', 'Nº cliente', 'Número de cliente', 'Código paciente', 'Id paciente', 'Nº historia'],
    paciente: ['Cliente', 'Paciente', 'Nombre cliente', 'Nombre paciente', 'Nombre y apellidos', 'Nombre'],
    apellidos: ['Apellidos'],
    telefono: TELEFONO,
    email: EMAIL,
    fecha: ['Fecha', 'Fecha cita', 'Día', 'Fecha inicio', 'Inicio'],
    hora: ['Hora', 'Hora inicio', 'Hora de inicio', 'Inicio', 'Desde'],
    hora_fin: ['Hora fin', 'Hora de fin', 'Fin', 'Hasta'],
    duracion: ['Duración', 'Duración (min)', 'Minutos', 'Tiempo'],
    servicio: ['Servicio', 'Tratamiento', 'Servicios', 'Tratamientos', 'Concepto', 'Prestación'],
    profesional: ['Profesional', 'Empleado', 'Empleada', 'Especialista', 'Médico', 'Doctor', 'Doctora'],
    sala: ['Cabina', 'Sala', 'Box', 'Gabinete', 'Recurso'],
    estado: ['Estado', 'Estado cita', 'Situación'],
    observaciones: OBSERVACIONES,
  },
};
const VARIAS = new Set(['apellidos', 'telefono', 'email', 'observaciones', 'marketing', 'marketing_whatsapp', 'marketing_email']);
// La hora puede venir en la misma columna que la fecha («15/10/2026 11:00»).
const PUEDE_REPETIR = new Set(['hora']);
// Sin estas columnas no se puede importar el fichero.
const OBLIGATORIAS = { pacientes: [['nombre']], citas: [['fecha'], ['servicio'], ['paciente_id', 'paciente', 'telefono', 'email']] };
const CONSENTIMIENTOS = { marketing: ['whatsapp_marketing', 'email_marketing'], marketing_whatsapp: ['whatsapp_marketing'], marketing_email: ['email_marketing'] };

/**
 * Qué columnas del fichero van a cada campo: las que diga el mapa o, si no dice nada de ese campo,
 * las de nombre típico. Un campo puesto a null en el mapa no se trae (p. ej. las observaciones).
 * @returns {{ campos: { campo: string[] }, sinUsar: string[], errores: string[] }}
 */
function resolverColumnas(cabeceras, tipo, mapa = {}) {
  const porClave = new Map(cabeceras.map((c) => [clave(c), c]));
  const usadas = new Set();
  const campos = {};
  const errores = [];
  for (const [campo, nombres] of Object.entries(CAMPOS[tipo])) {
    if (Object.hasOwn(mapa, campo)) {
      campos[campo] = [];
      for (const n of [mapa[campo]].flat().filter((x) => x != null && x !== '')) {
        const c = porClave.get(clave(n));
        if (c) { campos[campo].push(c); usadas.add(c); } else errores.push(`El mapa dice que «${campo}» está en la columna «${n}», y el fichero no la tiene`);
      }
      continue;
    }
    const halladas = [...new Set(nombres.map((n) => porClave.get(clave(n))).filter((c) => c && (!usadas.has(c) || PUEDE_REPETIR.has(campo))))];
    campos[campo] = VARIAS.has(campo) ? halladas : halladas.slice(0, 1);
    for (const c of campos[campo]) usadas.add(c);
  }
  for (const grupo of OBLIGATORIAS[tipo]) {
    if (!grupo.some((campo) => campos[campo].length)) {
      errores.push(`Falta la columna de ${grupo.map((g) => `«${g}»`).join(' o ')}: dila en el mapa («${tipo}»: { "${grupo[0]}": "nombre de la columna" })`);
    }
  }
  return { campos, sinUsar: cabeceras.filter((c) => !usadas.has(c)), errores };
}

// Los valores con algo de un campo, en el orden de sus columnas.
function valoresDe(valores, campos, campo) {
  return (campos[campo] || []).map((c) => String(valores[c] ?? '').trim()).filter(Boolean);
}

// ── Valores ─────────────────────────────────────────────────────────────────────────────────
const esMovil = (e164) => /^\+34[67]\d{8}$/.test(e164 || '');
// Un número español dentro de un texto: «612 345 678», «+34 612-34-56-78», «(+34) 612345678»…
const RX_TELEFONO = /(?<![\d+])(?:(?:\+|00)\s*34[\s.-]*|\(\s*\+?34\s*\)[\s.-]*)?[6789](?:[\s.-]*\d){8}(?!\d)/g;

// Lo que deja Excel en una columna de teléfonos: «6,12345678E+08» o «612345678.0». Si Excel se comió
// cifras («6,12346E+08»), el número ya no se puede saber.
function sinFormatoExcel(t) {
  const m = /^(\d)[.,](\d+)e\+?(\d{1,2})$/i.exec(t.replace(/\s/g, ''));
  if (m) return m[2].length === Number(m[3]) ? m[1] + m[2] : '';
  return t.replace(/^(\d+)[.,]0+$/, '$1');
}

// Un teléfono en cualquier formato → E.164, o null. Si en el campo hay varios, el primer móvil.
function telefonoEspanol(valor) {
  const t = sinFormatoExcel(String(valor ?? '').trim());
  if (!t) return null;
  const directo = normalizarTelefono(t.replace(/[^\d+]/g, ''));
  if (directo) return directo;
  const hallados = [...t.matchAll(RX_TELEFONO)].map((m) => normalizarTelefono(m[0].replace(/[^\d+]/g, ''))).filter(Boolean);
  return hallados.find(esMovil) || hallados[0] || null;
}

// De todas las columnas de teléfono, el primer móvil (para WhatsApp) y si no, el primero que valga.
function elegirTelefono(valores) {
  const validos = valores.map(telefonoEspanol).filter(Boolean);
  return { telefono: validos.find(esMovil) || validos[0] || null, ilegible: !validos.length && valores.length > 0 };
}

function elegirEmail(valores) {
  for (const v of valores) {
    for (const trozo of v.split(/[;,\s]+/)) {
      const e = normalizarEmail(trozo);
      if (e) return { email: e, ilegible: false };
    }
  }
  return { email: null, ilegible: valores.length > 0 };
}

const dos = (n) => String(n).padStart(2, '0');

// «11:00», «9.30», «11h30», «11 h» → «HH:MM».
function leerHora(valor) {
  const t = String(valor ?? '').trim().toLowerCase();
  const r = /^(\d{1,2})(?:[:.h](\d{2}))?(?::\d{2})?\s*(?:h|hrs?|horas)?$/.exec(t);
  if (!r || (r[2] == null && !/h/.test(t))) return null;
  const h = Number(r[1]);
  const m = Number(r[2] || 0);
  return h <= 23 && m <= 59 ? `${dos(h)}:${dos(m)}` : null;
}

// «15/10/2026», «5-3-2026», «2026-10-15», con la hora detrás o no → { fecha: 'AAAA-MM-DD', hora }.
// Año con dos cifras: para las citas, 20xx; para nacimientos, del siglo pasado si no puede ser de este.
function leerFecha(valor, { nacimiento = false, hoy = new Date() } = {}) {
  const t = String(valor ?? '').trim();
  let a; let m; let d; let hora;
  let r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[\sT,]+(\d{1,2}[:.h]\d{2})(?::\d{2})?)?$/i.exec(t);
  if (r) [, d, m, a, hora] = r;
  else if ((r = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[\sT]+(\d{1,2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(t))) [, a, m, d, hora] = r;
  else return null;
  let anio = Number(a);
  if (a.length === 2) anio += nacimiento && anio > hoy.getUTCFullYear() % 100 ? 1900 : 2000;
  const mes = Number(m);
  const dia = Number(d);
  if (mes < 1 || mes > 12 || dia < 1 || dia > new Date(Date.UTC(anio, mes, 0)).getUTCDate()) return null;
  return { fecha: `${anio}-${dos(mes)}-${dos(dia)}`, hora: hora ? leerHora(hora) : null };
}

// Las horas de un texto: «11:00» → [11:00]; «11:00 - 12:15» → [11:00, 12:15]; con la fecha delante,
// la suya.
function horasDe(texto) {
  const conFecha = leerFecha(texto);
  if (conFecha) return conFecha.hora ? [conFecha.hora] : [];
  return [...texto.matchAll(/\d{1,2}(?:[:.h]\d{2})?\s*h?/gi)].map((x) => leerHora(x[0].trim())).filter(Boolean);
}

// «60», «60 min», «1:30», «1h 30min», «90'» → minutos.
function leerDuracion(valor) {
  const t = String(valor ?? '').trim().toLowerCase();
  let r;
  if ((r = /^(\d{1,4})(?:[.,]0+)?\s*(?:m|min|mins|minutos|')?$/.exec(t))) return Number(r[1]) || null;
  if ((r = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(t))) return Number(r[1]) * 60 + Number(r[2]) || null;
  if ((r = /^(\d{1,2})\s*h(?:oras?)?\s*(?:y\s*)?(?:(\d{1,2})\s*(?:m|min|minutos|')?)?$/.exec(t))) return Number(r[1]) * 60 + Number(r[2] || 0) || null;
  return null;
}

// Solo lo explícito: «Sí», «X», «1», «acepta» → true; «No», «0», «rechaza» → false; lo demás
// (vacío, «?», «pendiente») → null, y entonces no se registra nada.
const SI = new Set(['si', 's', 'yes', 'y', 'true', 'verdadero', '1', 'x', 'acepta', 'aceptado', 'aceptada', 'acepto', 'otorgado', 'otorga', 'autoriza', 'autorizado', 'ok', '✓', '✔']);
const NO = new Set(['no', 'n', 'false', 'falso', '0', 'rechaza', 'rechazado', 'no acepta', 'revocado', 'revoca', 'deniega', 'denegado', 'no autoriza', '✗', '✘']);
function leerSiNo(valor) {
  const t = String(valor ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  if (SI.has(t)) return true;
  if (NO.has(t)) return false;
  return null;
}

// Estados de la cita en Flowww: lo que no se trae, lo que sí y lo que no se sabe (lo decide el mapa).
const ESTADO_NO = /anulad|cancelad|desconvocad|no (asisti|present|vino|acudi)|\bfalt[oa]\b|ausente|eliminad|borrad|rechazad|bloque|inactiv/;
const ESTADO_SI = /pendiente|confirmad|reservad|citad|programad|agendad|activ|nueva|asignad|solicitad/;
function claseDeEstado(valor, mapa = new Map()) {
  const k = clave(valor);
  if (mapa.has(k)) return mapa.get(k);
  if (!k) return IMPORTAR;
  if (ESTADO_NO.test(k)) return IGNORAR;
  if (ESTADO_SI.test(k)) return IMPORTAR;
  return null;
}

// «García López, María» o «María García López» → { nombre, apellidos }.
function partirNombre(completo) {
  const t = String(completo || '').trim();
  if (t.includes(',')) {
    const [apellidos, ...resto] = t.split(',');
    return { nombre: resto.join(' ').trim(), apellidos: apellidos.trim() };
  }
  const [nombre, ...resto] = t.split(/\s+/);
  return { nombre, apellidos: resto.join(' ') };
}

// Nombre y apellidos limpios. Si el fichero no tiene columna de apellidos, el nombre es el completo.
function nombreYApellidos(nombre, apellidos, { hayColumnaApellidos }) {
  let n = nombre;
  let a = apellidos;
  if (n && !hayColumnaApellidos) ({ nombre: n, apellidos: a } = partirNombre(n));
  return { nombre: limpiarNombre(n, 80), apellidos: limpiarNombre(a, 120) };
}

// Identificador estable de una fila que no trae código: mismo contenido, misma huella.
const huella = (prefijo, partes) => `${prefijo}:${crypto.createHash('sha256').update(partes.map((p) => clave(p)).join('|')).digest('hex').slice(0, 32)}`;

/**
 * Una fila del fichero de pacientes, en limpio.
 * @returns { flowwwId, nombre, apellidos, telefono, email, fechaNacimiento, notas, consentimientos:
 *   [{ tipo, otorgado, columna, valor }], avisos: [], errores: [] }
 */
function leerPaciente(valores, campos, { hoy = new Date() } = {}) {
  const v = (campo) => valoresDe(valores, campos, campo);
  const errores = [];
  const avisos = [];
  const persona = nombreYApellidos(v('nombre')[0], v('apellidos').join(' '), { hayColumnaApellidos: campos.apellidos.length > 0 });
  if (!persona.nombre) errores.push('sin nombre');
  const tel = elegirTelefono(v('telefono'));
  if (tel.ilegible) avisos.push('el teléfono no se entiende: se importa sin él');
  const correo = elegirEmail(v('email'));
  if (correo.ilegible) avisos.push('el email no se entiende: se importa sin él');
  let fechaNacimiento = null;
  const nac = v('fecha_nacimiento')[0];
  if (nac) {
    const f = leerFecha(nac, { nacimiento: true, hoy });
    if (f && f.fecha >= '1900-01-01' && f.fecha <= hoy.toISOString().slice(0, 10)) fechaNacimiento = f.fecha;
    else avisos.push('la fecha de nacimiento no se entiende: se importa sin ella');
  }
  const consentimientos = [];
  for (const [campo, tipos] of Object.entries(CONSENTIMIENTOS)) {
    for (const columna of campos[campo] || []) {
      const valor = String(valores[columna] ?? '').trim();
      const otorgado = leerSiNo(valor);
      if (otorgado == null) continue;
      for (const tipo of tipos) if (!consentimientos.some((c) => c.tipo === tipo)) consentimientos.push({ tipo, otorgado, columna, valor });
      break;
    }
  }
  const notas = v('observaciones').join('\n').slice(0, 4000) || null;
  return {
    flowwwId: v('id')[0]?.slice(0, 60) || null, ...persona, telefono: tel.telefono, email: correo.email, fechaNacimiento, notas,
    consentimientos, avisos, errores,
  };
}

/**
 * Una fila del fichero de citas, en limpio. La fecha y la hora, en hora de Madrid.
 * @returns { flowwwId, pacienteRef, nombre, apellidos, telefono, email, fecha, hora, duracion, servicio,
 *   profesional, sala, estado, notas, errores: [] }
 */
function leerCita(valores, campos) {
  const v = (campo) => valoresDe(valores, campos, campo);
  const errores = [];
  const persona = nombreYApellidos(v('paciente')[0], v('apellidos').join(' '), { hayColumnaApellidos: campos.apellidos.length > 0 });
  const textoFecha = v('fecha')[0];
  const f = textoFecha ? leerFecha(textoFecha) : null;
  if (!textoFecha) errores.push('sin fecha');
  else if (!f) errores.push(`fecha «${textoFecha.slice(0, 30)}» no válida`);
  // La hora: su columna («11:00», «11:00 - 12:00» o «15/10/2026 11:00») o, si no tiene, la que venga
  // con la fecha.
  const textoHora = campos.hora.filter((c) => !campos.fecha.includes(c)).map((c) => String(valores[c] ?? '').trim()).find(Boolean) || null;
  const horas = textoHora ? horasDe(textoHora) : [];
  const hora = horas[0] || f?.hora || null;
  if (f && !hora) errores.push(textoHora ? `hora «${textoHora.slice(0, 20)}» no válida` : 'sin hora');
  const fin = horas[1] || leerHora(v('hora_fin')[0]);
  let duracion = leerDuracion(v('duracion')[0]);
  if (!duracion && hora && fin) {
    const [h1, m1] = hora.split(':').map(Number);
    const [h2, m2] = fin.split(':').map(Number);
    if (h2 * 60 + m2 > h1 * 60 + m1) duracion = h2 * 60 + m2 - (h1 * 60 + m1);
  }
  const servicio = v('servicio')[0] || null;
  if (!servicio) errores.push('sin servicio');
  return {
    flowwwId: v('id')[0]?.slice(0, 60) || null, pacienteRef: v('paciente_id')[0]?.slice(0, 60) || null, ...persona,
    telefono: elegirTelefono(v('telefono')).telefono, email: elegirEmail(v('email')).email,
    fecha: f?.fecha || null, hora: hora || null, duracion, servicio, profesional: v('profesional')[0] || null, sala: v('sala')[0] || null,
    estado: v('estado')[0] || '', notas: v('observaciones').join(' · ').slice(0, 500) || null, errores,
  };
}

// ── ¿La misma persona? ──────────────────────────────────────────────────────────────────────
// Mismo teléfono o email no basta: en Flowww, una madre y su hija comparten a veces el móvil. Son
// otra persona si el nombre de pila no se parece (Laura ≈ Lau ≈ Laura María) o si, teniendo los dos
// apellidos, no comparten ninguno. Sin nombre que comparar («Paciente»), cuenta como la misma.
const SIN_NOMBRE = new Set(['paciente', 'cliente', 'sin nombre', 'desconocido', 'desconocida']);
function mismaPersona(a, b) {
  const pila = (x) => (SIN_NOMBRE.has(clave(x?.nombre)) ? '' : clave(x?.nombre).split(' ')[0]);
  const pa = pila(a);
  const pb = pila(b);
  if (!pa || !pb) return true;
  const parecidos = (x, y) => x === y || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))) || dice(x, y) >= 0.75;
  if (!parecidos(pa, pb)) return false;
  const ap = (x) => clave(x?.apellidos).split(' ').filter((p) => p.length >= 3);
  const aa = ap(a);
  const ab = ap(b);
  return !aa.length || !ab.length || aa.some((x) => ab.some((y) => parecidos(x, y)));
}

// ── Casar nombres de Flowww con los de la app ───────────────────────────────────────────────
function bigramas(t) {
  const s = ` ${t} `;
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1);
  return m;
}

// Sørensen-Dice sobre pares de letras: 1 si son iguales, 0 si no comparten nada.
function dice(a, b) {
  const x = bigramas(a);
  const y = bigramas(b);
  let comunes = 0;
  let total = 0;
  for (const [g, n] of x) { comunes += Math.min(n, y.get(g) || 0); total += n; }
  for (const n of y.values()) total += n;
  return total ? (2 * comunes) / total : 0;
}

// Cuánto se parecen dos nombres (0-1): por letras o por palabras, lo que dé más.
function similitud(a, b) {
  const x = clave(a);
  const y = clave(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const px = x.split(' ');
  const py = y.split(' ');
  const casan = px.filter((p) => py.some((q) => p === q || (p.length > 3 && q.length > 3 && dice(p, q) >= 0.8))).length;
  return Math.round(Math.max(dice(x, y), (2 * casan) / (px.length + py.length)) * 100) / 100;
}

// Formas de nombrar un tratamiento: su nombre, sin lo que va entre paréntesis, cada alternativa
// separada por «/» y sus alias.
function formasTratamiento(t) {
  let alias = t.alias;
  if (typeof alias === 'string') { try { alias = JSON.parse(alias); } catch { alias = []; } }
  const salida = new Set();
  for (const n of [t.nombre, ...(Array.isArray(alias) ? alias : [])].filter(Boolean).map(String)) {
    const sinParentesis = n.replace(/\([^)]*\)/g, ' ');
    for (const f of [n, sinParentesis, ...sinParentesis.split('/')]) salida.add(clave(f));
  }
  return [...salida].filter(Boolean);
}

const TITULOS = new Set(['dr', 'dra', 'doctor', 'doctora', 'sr', 'sra', 'srta', 'don', 'dona', 'lic', 'lcda', 'prof']);
const sinTitulos = (k) => k.split(' ').filter((p) => !TITULOS.has(p)).join(' ') || k;

// Los tres más parecidos (o los empatados, si casaba con varios), con su parecido.
function sugerir(k, lista, formas) {
  return lista.map((x) => ({ id: x.id, codigo: x.codigo, nombre: x.nombre, parecido: Math.max(0, ...formas(x).map((f) => similitud(k, f))) }))
    .filter((s) => s.parecido >= 0.3)
    .sort((a, b) => b.parecido - a.parecido || String(a.nombre).localeCompare(String(b.nombre), 'es'))
    .slice(0, 3);
}

/**
 * El tratamiento de la app de un servicio de Flowww. Por orden: el mapa, lo guardado de otras
 * importaciones, y el nombre o un alias exactos (sin mayúsculas ni tildes). Lo que se parece solo se
 * sugiere: un «Limpieza facial» no es por fuerza la «Limpieza facial profunda».
 * @param {object} c { tratamientos: [{ id, nombre, alias }], guardado: Map(clave → id), mapa: Map(clave → id | 'ignorar') }
 * @returns {{ id, via } | { ignorar: true, via } | { sugerencias: [{ id, nombre, parecido }] }}
 */
function casarTratamiento(texto, { tratamientos = [], guardado = new Map(), mapa = new Map() } = {}) {
  const k = clave(texto);
  if (mapa.has(k)) return mapa.get(k) === IGNORAR ? { ignorar: true, via: 'mapa' } : { id: mapa.get(k), via: 'mapa' };
  if (guardado.has(k)) return { id: guardado.get(k), via: 'guardado' };
  const exactos = tratamientos.filter((t) => formasTratamiento(t).includes(k));
  if (exactos.length === 1) return { id: exactos[0].id, via: clave(exactos[0].nombre) === k ? 'nombre' : 'alias' };
  if (exactos.length > 1) return { sugerencias: exactos.map((t) => ({ id: t.id, nombre: t.nombre, parecido: 1 })), empate: true };
  return { sugerencias: sugerir(k, tratamientos, formasTratamiento) };
}

// Una persona o una cabina de Flowww: el mapa, el nombre exacto (sin «Dra.»), el código o, si solo
// uno de la app tiene todas sus palabras («Dra. Pérez» → «Dra. Ana Pérez Gil»), ese.
function casarPorNombre(texto, lista, mapa) {
  const k = clave(texto);
  if (mapa.has(k)) return mapa.get(k) === CUALQUIERA ? { cualquiera: true, via: 'mapa' } : { id: mapa.get(k), via: 'mapa' };
  const kk = sinTitulos(k);
  const nombreDe = (x) => sinTitulos(clave(x.nombre));
  const exactos = lista.filter((x) => nombreDe(x) === kk || clave(x.codigo) === k);
  if (exactos.length === 1) return { id: exactos[0].id, via: 'nombre' };
  const palabras = kk.split(' ').filter((p) => p.length >= 3 || /\d/.test(p));
  if (!exactos.length && palabras.length) {
    const contienen = lista.filter((x) => palabras.every((p) => nombreDe(x).split(' ').includes(p)));
    if (contienen.length === 1) return { id: contienen[0].id, via: 'nombre parcial' };
  }
  return { sugerencias: sugerir(kk, lista, (x) => [nombreDe(x)]), empate: exactos.length > 1 };
}

const casarProfesional = (texto, { profesionales = [], mapa = new Map() } = {}) => casarPorNombre(texto, profesionales, mapa);
const casarSala = (texto, { salas = [], mapa = new Map() } = {}) => casarPorNombre(texto, salas, mapa);

// ── El mapa (--mapa) ────────────────────────────────────────────────────────────────────────
/**
 * El mapa en limpio: columnas de cada fichero y lo que corresponde en la app a cada servicio,
 * profesional, cabina y estado de Flowww (las claves, sin mayúsculas ni tildes). Los destinos se
 * comprueban contra la base al importar. Lo que empieza por «_» son comentarios.
 */
function leerMapa(mapa) {
  const salida = { columnas: { pacientes: {}, citas: {} }, tratamientos: new Map(), profesionales: new Map(), salas: new Map(), estados: new Map(), textos: new Map(), errores: [] };
  if (mapa == null) return salida;
  const esObjeto = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!esObjeto(mapa)) { salida.errores.push('El mapa tiene que ser un objeto JSON: { "citas": { … }, "tratamientos": { … } }'); return salida; }
  for (const [seccion, v] of Object.entries(mapa)) {
    if (seccion.startsWith('_')) continue;
    if (!['pacientes', 'citas', 'tratamientos', 'profesionales', 'salas', 'estados'].includes(seccion)) {
      salida.errores.push(`El mapa tiene una sección que no conozco: «${seccion}» (valen pacientes, citas, tratamientos, profesionales, salas y estados)`);
      continue;
    }
    if (!esObjeto(v)) { salida.errores.push(`En el mapa, «${seccion}» tiene que ser un objeto { … }`); continue; }
    for (const [nombre, destino] of Object.entries(v)) {
      if (nombre.startsWith('_')) continue;
      if (seccion === 'pacientes' || seccion === 'citas') {
        if (!Object.hasOwn(CAMPOS[seccion], nombre)) {
          salida.errores.push(`El mapa nombra un campo de ${seccion} que no existe: «${nombre}» (valen ${Object.keys(CAMPOS[seccion]).join(', ')})`);
        } else if (destino != null && ![destino].flat().every((c) => typeof c === 'string')) {
          salida.errores.push(`En el mapa, ${seccion}.${nombre} tiene que ser el nombre de una columna, una lista de nombres o null`);
        } else salida.columnas[seccion][nombre] = destino;
        continue;
      }
      // Vacío: sin decidir todavía (así lo deja el mapa que propone el informe).
      if (destino == null || String(destino).trim() === '') continue;
      if (typeof destino !== 'string' && typeof destino !== 'number') { salida.errores.push(`En el mapa, ${seccion}.«${nombre}» tiene que ser un texto`); continue; }
      let d = String(destino).trim();
      if (seccion === 'estados') {
        d = clave(d);
        if (![IMPORTAR, IGNORAR].includes(d)) { salida.errores.push(`En el mapa, el estado «${nombre}» va a «importar» o a «ignorar»`); continue; }
      }
      if (seccion === 'tratamientos' && clave(d) === IGNORAR) d = IGNORAR;
      if ((seccion === 'profesionales' || seccion === 'salas') && clave(d) === CUALQUIERA) d = CUALQUIERA;
      salida[seccion].set(clave(nombre), d);
      salida.textos.set(`${seccion}:${clave(nombre)}`, nombre);
    }
  }
  return salida;
}

module.exports = {
  IGNORAR, CUALQUIERA, IMPORTAR, CAMPOS, clave, resolverColumnas, telefonoEspanol, elegirTelefono, esMovil, leerHora, leerFecha,
  leerDuracion, leerSiNo, claseDeEstado, partirNombre, huella, leerPaciente, leerCita, mismaPersona, similitud, formasTratamiento,
  casarTratamiento, casarProfesional, casarSala, leerMapa,
};
