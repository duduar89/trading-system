'use strict';
// Importación de Flowww (el programa de hoy de la clínica): pacientes y citas futuras desde sus CSV,
// para poder apagarlo sin perder nada. La facturación no se trae. Lo usa scripts/importar-flowww.js;
// cómo se hace, paso a paso: docs/MIGRAR-FLOWWW.md.
//
//   ensayo    lee, casa y coloca todo sin escribir nada, y lo cuenta en un informe sin nombres ni
//             teléfonos (filas del CSV y códigos)
//   aplicar   lo mismo en una transacción, con cabinas, profesionales y aparatos bloqueados como en
//             una reserva: entra todo o nada. Si algo no casa (un servicio, un profesional, un estado),
//             no se aplica hasta que lo diga el mapa
//   deshacer  quita lo que metió una importación y nadie ha tocado desde entonces
//
// Pacientes: sin duplicar (por su código de Flowww, su teléfono o su email, y con un nombre que
// cuadre), con su código guardado; a quien ya estaba en la app solo se le apunta el código (y el
// teléfono si no tenía, para que le lleguen los recordatorios). Importar
// no da consentimiento de marketing (ni le marca como cliente, que por la LSSI también lo daría): solo
// se registra si una columna lo dice («sí» → otorgado; «no» → revocado y, en WhatsApp, baja comercial).
// Citas: las futuras, con origen «importacion», colocadas por el motor de agenda a su hora. Si no
// caben, entran igual (lo que dio Flowww manda y nada se pisa), con el motivo en revisar_motivo y
// una tarea en el panel. No se les manda la confirmación, pero sí los recordatorios de víspera y 2
// horas, salvo --sin-recordatorios (servidor/avisos-cita.js). Datos de salud: las observaciones del
// paciente van cifradas y el informe no lleva nombres, teléfonos ni emails.
const crypto = require('crypto');
const T = require('../motor/tiempo');
const { leerCsv, ErrorCsv } = require('../motor/importacion/csv');
const F = require('../motor/importacion/flowww');
const C = require('../motor/importacion/colocar');
const { redactarInforme, redactarDeshacer } = require('../motor/importacion/informe');
const { tratamientoParaMotor, huecoAInstantes, aMinutosDelDia, ESTADOS_QUE_OCUPAN } = require('../motor/agenda/dia');
const agenda = require('./agenda');
const { cifrar } = require('./cripto');
const { registrar } = require('./eventos');

const ACTOR = 'importacion-flowww';
// Las secuencias que termina una cita (como en agenda.reservar).
const SECUENCIAS_CAPTACION = ['lead', 'cancelacion', 'toca_repetir', 'dormido', 'vale_regalo'];
// Lo que puede tener un paciente en la app: si tiene algo, deshacer no lo borra.
const TABLAS_DEL_PACIENTE = ['citas', 'conversaciones', 'leads', 'presupuestos', 'inscripciones', 'seguimientos', 'tareas', 'resenas',
  'peticiones_resena', 'lista_espera', 'ofertas_hechas', 'consentimientos'];

class ErrorImportacion extends Error {}

const aSegundos = (d) => new Date(Math.floor(d.getTime() / 1000) * 1000);
const parsear = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});
const lista = (mapa, k) => mapa.get(k) || mapa.set(k, []).get(k);

// ── Lo que ya hay en la app ─────────────────────────────────────────────────────────────────
async function cargarReferencias(con) {
  const q = async (sql, p = []) => (await con.query(sql, p))[0];
  const tratamientos = await q('SELECT * FROM tratamientos WHERE activo = TRUE');
  const salasDe = new Map();
  for (const x of await q('SELECT tratamiento_id, sala_id FROM tratamiento_salas')) lista(salasDe, x.tratamiento_id).push(x.sala_id);
  const profsDe = new Map();
  for (const x of await q('SELECT tratamiento_id, profesional_id FROM tratamiento_profesionales')) lista(profsDe, x.tratamiento_id).push(x.profesional_id);
  const salas = await q('SELECT id, codigo, nombre, tipo, activa FROM salas ORDER BY orden, id');
  const profesionales = await q('SELECT id, codigo, nombre, rol, activo FROM profesionales ORDER BY orden, id');
  const ref = {
    tratamientos: new Map(tratamientos.map((t) => [t.id, {
      nombre: t.nombre,
      motor: tratamientoParaMotor(t, { salasPermitidas: salasDe.get(t.id) || [], profesionalesPermitidos: profsDe.get(t.id) || [] }),
    }])),
    listaTratamientos: tratamientos,
    salas,
    profesionales,
    salasActivas: salas.filter((s) => s.activa),
    profesionalesActivos: profesionales.filter((p) => p.activo),
    guardado: new Map((await q("SELECT clave, tratamiento_id FROM mapeo_tratamientos WHERE clave LIKE 'flowww:%'"))
      .filter((m) => tratamientos.some((t) => t.id === m.tratamiento_id)).map((m) => [m.clave.slice('flowww:'.length), m.tratamiento_id])),
    pacientes: { porFlowww: new Map(), porTelefono: new Map(), porEmail: new Map(), porNombre: new Map() },
    consentimientos: new Set((await q('SELECT DISTINCT paciente_id, tipo FROM consentimientos')).map((c) => `${c.paciente_id}:${c.tipo}`)),
    citasImportadas: new Map((await q('SELECT id, flowww_id, inicio, estado FROM citas WHERE flowww_id IS NOT NULL')).map((c) => [c.flowww_id, c])),
  };
  // Los anonimizados (derecho de supresión) también: su código y su teléfono no se pueden repetir, y
  // a ellos no se les vuelve a traer.
  for (const p of await q('SELECT id, nombre, apellidos, telefono, email, flowww_id, anonimizado_en FROM pacientes')) {
    if (p.flowww_id) ref.pacientes.porFlowww.set(p.flowww_id, p);
    if (p.telefono) ref.pacientes.porTelefono.set(p.telefono, p);
    if (p.anonimizado_en) continue;
    if (p.email) lista(ref.pacientes.porEmail, p.email).push(p);
    // Por nombre, solo los que vinieron de Flowww: los de WhatsApp llevan el nombre de su perfil.
    if (p.flowww_id) lista(ref.pacientes.porNombre, F.clave(`${p.nombre} ${p.apellidos || ''}`)).push(p);
  }
  return ref;
}

// Los destinos del mapa, contra la base: id de tratamiento; código (o id) de profesional y cabina.
function comprobarMapa(mapa, ref, errores) {
  for (const [k, v] of mapa.tratamientos) {
    if (v !== F.IGNORAR && !ref.tratamientos.has(v)) errores.push(`El mapa manda «${mapa.textos.get(`tratamientos:${k}`)}» a «${v}», y en la app no hay ningún tratamiento activo con ese id`);
  }
  for (const [seccion, activos, nombre] of [['profesionales', ref.profesionalesActivos, 'profesional'], ['salas', ref.salasActivas, 'cabina']]) {
    for (const [k, v] of mapa[seccion]) {
      if (v === F.CUALQUIERA) continue;
      const x = activos.find((y) => y.codigo === v || String(y.id) === v);
      if (x) mapa[seccion].set(k, x.id);
      else errores.push(`El mapa manda «${mapa.textos.get(`${seccion}:${k}`)}» a «${v}», y en la app no hay ningún ${nombre} activo con ese código`);
    }
  }
}

// ── Pacientes ───────────────────────────────────────────────────────────────────────────────
const raiz = (e) => (e.accion === 'repetido' ? raiz(e.igualA) : e);

function indexar(ctx, e) {
  const i = ctx.indices;
  if (!i.flowww.has(e.flowwwId)) i.flowww.set(e.flowwwId, e);
  if (e.telefono && !i.telefono.has(e.telefono)) i.telefono.set(e.telefono, e);
  if (e.email) lista(i.email, e.email).push(e);
  lista(i.nombre, F.clave(`${e.nombre} ${e.apellidos || ''}`)).push(e);
}

// Nuevo, ya en la app o repetido en el fichero. Un teléfono que ya es de otra persona (otro nombre)
// no se le pone: en la app, un teléfono es de un solo paciente, y mezclar a dos sería peor.
function situarPaciente(ctx, e) {
  const { indices: i, ref } = ctx;
  let previa = i.flowww.get(e.flowwwId);
  let via = previa ? 'código' : null;
  const conTelefono = e.telefono ? i.telefono.get(e.telefono) : null;
  if (!previa && conTelefono && F.mismaPersona(conTelefono, e)) { previa = conTelefono; via = 'teléfono'; }
  if (!previa && e.email) { previa = (i.email.get(e.email) || []).find((x) => F.mismaPersona(x, e)); via = previa ? 'email' : null; }
  // Repetido: también por su código (una cita puede traer el de cualquiera de las dos filas).
  if (previa) { Object.assign(e, { accion: 'repetido', igualA: raiz(previa), via }); indexar(ctx, e); return; }

  let bd = ref.pacientes.porFlowww.get(e.flowwwId);
  via = bd ? 'código' : null;
  const bdTelefono = e.telefono ? ref.pacientes.porTelefono.get(e.telefono) : null;
  // Quien pidió la supresión de sus datos en la app no vuelve a entrar: ni por su código ni por su
  // teléfono (si fuera otra persona con ese número, se ve en el informe y se da de alta a mano).
  if (bd?.anonimizado_en || (!bd && bdTelefono?.anonimizado_en)) {
    e.accion = 'error';
    e.errores.push(`${bd ? 'está anonimizado' : 'su teléfono es el de un paciente anonimizado'} en la app (derecho de supresión): no se vuelve a traer`);
    return;
  }
  if (!bd && bdTelefono) {
    if (F.mismaPersona(bdTelefono, e)) { bd = bdTelefono; via = 'teléfono'; } else { e.compartido = `del paciente ${bdTelefono.id} de la app`; e.telefono = null; }
  }
  if (!bd && e.email) { bd = (ref.pacientes.porEmail.get(e.email) || []).find((x) => F.mismaPersona(x, e)); via = bd ? 'email' : null; }
  if (!bd && e.telefono && conTelefono) { e.compartido = `de la fila ${conTelefono.fila}${conTelefono.origen === 'citas' ? ' de las citas' : ''}`; e.telefono = null; }
  if (bd) {
    Object.assign(e, { accion: 'existente', pacienteId: bd.id, via, vincular: !bd.flowww_id && !ctx.vinculados.has(bd.id) });
    if (e.vincular) ctx.vinculados.add(bd.id);
    // Si en la app no tenía teléfono, se le pone el de Flowww (sin él no le llegan los recordatorios de
    // sus citas), salvo que ese teléfono ya sea de otra persona.
    if (!bd.telefono && e.telefono && !conTelefono && !ref.pacientes.porTelefono.has(e.telefono)) e.completarTelefono = e.telefono;
  } else e.accion = 'nuevo';
  // A quien ya estaba, solo los consentimientos de un tipo del que no tenga ninguno: no se pisa lo
  // que haya dicho en la app.
  for (const c of e.consentimientos) c.yaTenia = Boolean(bd) && ref.consentimientos.has(`${bd.id}:${c.tipo}`);
  indexar(ctx, e);
}

function planificarPacientes(ctx, fichero) {
  for (const f of fichero.filas) {
    const p = F.leerPaciente(f.valores, fichero.campos, { hoy: ctx.plan.ahora });
    const e = { origen: 'pacientes', fila: f.fila, ...p, sinCodigo: !p.flowwwId, accion: 'error' };
    ctx.plan.pacientes.push(e);
    if (p.errores.length) continue;
    e.flowwwId ||= F.huella('p', [p.nombre, p.apellidos, p.fechaNacimiento, p.telefono, p.email]);
    situarPaciente(ctx, e);
  }
}

// El paciente de una cita: su código de cliente, su teléfono, su email o su nombre, en las filas de
// pacientes o en la app. Si no está en ningún sitio y la cita trae nombre, es un paciente nuevo con
// lo que trae la cita.
function pacienteDeCita(ctx, c) {
  const { indices: i, ref } = ctx;
  const persona = { nombre: c.nombre, apellidos: c.apellidos };
  const vale = (e) => e && e.accion !== 'error';
  const deBd = (p) => (p.anonimizado_en ? { falta: 'el paciente está anonimizado en la app' } : { bd: p });
  if (c.pacienteRef) {
    if (vale(i.flowww.get(c.pacienteRef))) return { entrada: raiz(i.flowww.get(c.pacienteRef)), via: 'código' };
    if (ref.pacientes.porFlowww.has(c.pacienteRef)) return { ...deBd(ref.pacientes.porFlowww.get(c.pacienteRef)), via: 'código' };
  }
  if (c.telefono) {
    const e = i.telefono.get(c.telefono);
    if (vale(e) && F.mismaPersona(e, persona)) return { entrada: raiz(e), via: 'teléfono' };
    const bd = ref.pacientes.porTelefono.get(c.telefono);
    if (bd?.anonimizado_en) return { falta: 'su teléfono es el de un paciente anonimizado en la app' };
    if (bd && F.mismaPersona(bd, persona)) return { bd, via: 'teléfono' };
  }
  if (c.email) {
    const e = (i.email.get(c.email) || []).find((x) => vale(x) && F.mismaPersona(x, persona));
    if (e) return { entrada: raiz(e), via: 'email' };
    const bd = (ref.pacientes.porEmail.get(c.email) || []).find((x) => F.mismaPersona(x, persona));
    if (bd) return { bd, via: 'email' };
  }
  if (!c.nombre) return { falta: 'no se sabe de quién es' };
  const k = F.clave(`${c.nombre} ${c.apellidos || ''}`);
  const homonimos = [...new Set((i.nombre.get(k) || []).filter(vale).map(raiz))];
  const enBd = ref.pacientes.porNombre.get(k) || [];
  if (homonimos.length + enBd.length > 1) return { falta: 'hay varios pacientes con ese nombre' };
  if (homonimos.length) return { entrada: homonimos[0], via: 'nombre' };
  if (enBd.length) return { bd: enBd[0], via: 'nombre' };
  const e = {
    origen: 'citas', fila: c.fila, flowwwId: c.pacienteRef || F.huella('p', [c.nombre, c.apellidos, null, c.telefono, c.email]), sinCodigo: !c.pacienteRef,
    nombre: c.nombre, apellidos: c.apellidos, telefono: c.telefono, email: c.email, fechaNacimiento: null, notas: null,
    consentimientos: [], avisos: [], errores: [], accion: 'error',
  };
  ctx.plan.pacientes.push(e);
  situarPaciente(ctx, e);
  return vale(e) ? { entrada: raiz(e), via: 'cita' } : { falta: e.errores[0] };
}

// ── Citas ───────────────────────────────────────────────────────────────────────────────────
// El día de la agenda (una vez por fecha) y lo que ya lo ocupa, con nombre, para decir con qué choca.
async function diaDe(ctx, fecha) {
  if (!ctx.dias.has(fecha)) {
    const { ahora } = ctx.plan;
    const dia = await agenda.cargarDia(ctx.con, fecha, { ahora, antelacionMin: 0 });
    const [filas] = await ctx.con.query(
      `SELECT id, inicio, sala_id, profesional_id, equipo_id, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, retenida_hasta
         FROM citas WHERE sala_desde < ? AND sala_hasta > ?`, [T.desdeMadrid(T.sumarDias(fecha, 1), '00:00'), T.desdeMadrid(fecha, '00:00')]);
    const ocupacion = [];
    for (const c of filas) {
      if (!ESTADOS_QUE_OCUPAN.has(c.estado) || (c.estado === 'retenida' && c.retenida_hasta && new Date(c.retenida_hasta) <= ahora)) continue;
      const quien = `otra cita de las ${T.partesMadrid(new Date(c.inicio)).hora} (la cita ${c.id} de la app)`;
      const sala = aMinutosDelDia(c.sala_desde, c.sala_hasta, fecha);
      const prof = aMinutosDelDia(c.prof_desde, c.prof_hasta, fecha);
      if (sala && c.sala_id) ocupacion.push({ tipo: 'sala', recurso: c.sala_id, ...sala, quien });
      if (prof && c.profesional_id) ocupacion.push({ tipo: 'profesional', recurso: c.profesional_id, ...prof, quien });
      if (prof && c.equipo_id) ocupacion.push({ tipo: 'equipo', recurso: c.equipo_id, ...prof, quien });
    }
    ctx.dias.set(fecha, { dia, ocupacion });
  }
  return ctx.dias.get(fecha);
}

// A su hora, con su profesional y, si se puede, en su cabina; si en su cabina no cabe (o no es de
// ese tratamiento), en otra de las del tratamiento. Si no cabe, entra igual donde la tenía Flowww.
async function colocar(ctx, e) {
  const t = ctx.ref.tratamientos.get(e.tratamientoId);
  const { dia, ocupacion } = await diaDe(ctx, e.fecha);
  const minuto = T.minutosDe(e.hora);
  const permitidas = C.salasDelTratamiento(dia, t.motor).map((s) => s.id);
  e.salaAjena = Boolean(e.salaId && !permitidas.includes(e.salaId));
  let hueco = e.salaId && !e.salaAjena ? C.huecoExacto(dia, t.motor, minuto, { profesionalId: e.profesionalId, salaId: e.salaId }) : null;
  hueco ||= C.huecoExacto(dia, t.motor, minuto, { profesionalId: e.profesionalId });
  if (hueco) {
    e.colocacion = { cabe: true, salaId: hueco.salaId, profesionalId: hueco.profesionalId, equipoId: hueco.equipoId, otraSala: Boolean(e.salaId && hueco.salaId !== e.salaId) };
  } else {
    // Donde la tenía Flowww; si no se sabe (o esa cabina no abre), en la primera del tratamiento: la
    // cita tiene que verse en la agenda por cabina para que recepción la vea y la mueva.
    const abierta = (id) => id && dia.salas.some((s) => s.id === id);
    e.colocacion = {
      cabe: false,
      motivo: C.porQueNoCabe(dia, t.motor, minuto, { profesionalId: e.profesionalId }, ocupacion, ctx.nombres),
      salaId: [e.salaId, ...permitidas, ctx.ref.salasActivas[0]?.id].find(abierta) || e.salaId || ctx.ref.salasActivas[0]?.id || null,
      profesionalId: e.profesionalId || null,
      equipoId: null,
    };
  }
  C.ocupar(dia, ocupacion, t.motor, minuto, e.colocacion, `otra cita de las ${e.hora} (la fila ${e.fila} de las citas)`);
}

// Cuenta las citas de cada servicio, profesional, cabina o estado de Flowww; lo de casarlo, una vez.
function contar(mapa, k, texto, calcular = () => ({})) {
  const x = mapa.get(k) || mapa.set(k, { texto, citas: 0, ...calcular() }).get(k);
  x.citas++;
  return x;
}

async function planificarCitas(ctx, fichero) {
  const { plan, ref, mapa } = ctx;
  const vistas = new Set();
  const catalogo = { tratamientos: ref.listaTratamientos, guardado: ref.guardado, mapa: mapa.tratamientos };
  for (const f of fichero.filas) {
    const c = F.leerCita(f.valores, fichero.campos);
    const e = { fila: f.fila, ...c, sinCodigo: !c.flowwwId, clase: 'error' };
    plan.citas.push(e);
    // Sin nadie: un bloqueo de agenda, la comida o una nota. No es una cita de un paciente.
    const sinNadie = !c.pacienteRef && !c.nombre && !c.telefono && !c.email;
    if (!c.fecha || !c.hora) { if (sinNadie) Object.assign(e, { clase: 'sin_paciente', falta: 'es un bloqueo o una nota de agenda' }); continue; }
    e.inicio = T.desdeMadrid(c.fecha, c.hora);
    e.flowwwId ||= F.huella('c', [c.pacienteRef, c.nombre, c.apellidos, c.telefono, c.fecha, c.hora, c.servicio]);
    if (vistas.has(e.flowwwId)) { e.clase = 'repetida'; continue; }
    vistas.add(e.flowwwId);
    if (e.inicio <= plan.ahora) { e.clase = 'pasada'; continue; }
    if (sinNadie) { Object.assign(e, { clase: 'sin_paciente', falta: 'es un bloqueo o una nota de agenda' }); continue; }
    const clase = F.claseDeEstado(c.estado, mapa.estados);
    const antes = ref.citasImportadas.get(e.flowwwId);
    if (antes) {
      // Ya se trajo: no se toca. Si en Flowww ha cambiado de hora o se ha anulado, se avisa.
      Object.assign(e, {
        clase: 'ya_importada', citaId: antes.id, cambiada: new Date(antes.inicio).getTime() !== e.inicio.getTime(),
        anuladaEnFlowww: clase === F.IGNORAR && !['cancelada', 'reprogramada'].includes(antes.estado),
      });
      continue;
    }
    if (clase === F.IGNORAR) { e.clase = 'anulada'; continue; }
    if (c.errores.length) continue;

    // Servicio, profesional, cabina y estado se miran todos, para que el informe diga de una vez todo
    // lo que falta decidir.
    const s = contar(plan.servicios, F.clave(c.servicio), c.servicio, () => ({ casa: F.casarTratamiento(c.servicio, catalogo), duraciones: new Map() }));
    if (s.casa.ignorar) { e.clase = 'ignorada'; continue; }
    e.tratamientoId = s.casa.id || null;
    if (e.tratamientoId && c.duracion) s.duraciones.set(c.duracion, (s.duraciones.get(c.duracion) || 0) + 1);
    const p = c.profesional ? contar(plan.profesionales, F.clave(c.profesional), c.profesional,
      () => ({ casa: F.casarProfesional(c.profesional, { profesionales: ref.profesionalesActivos, mapa: mapa.profesionales }) })) : null;
    e.profesionalId = p?.casa.id || null;
    e.salaId = c.sala ? contar(plan.salas, F.clave(c.sala), c.sala, () => ({ casa: F.casarSala(c.sala, { salas: ref.salasActivas, mapa: mapa.salas }) })).casa.id || null : null;
    if (clase !== F.IMPORTAR) contar(plan.estados, F.clave(c.estado), c.estado);
    if (!e.tratamientoId) { e.clase = 'sin_tratamiento'; continue; }
    if (p && !p.casa.id && !p.casa.cualquiera) { e.clase = 'sin_profesional'; continue; }
    if (clase !== F.IMPORTAR) { e.clase = 'estado_desconocido'; continue; }

    e.paciente = pacienteDeCita(ctx, e);
    if (e.paciente.falta) { Object.assign(e, { clase: 'sin_paciente', falta: e.paciente.falta }); continue; }
    e.clase = 'futura';
  }
  // Se colocan por orden de hora: si dos chocan, la primera se queda el sitio.
  const futuras = plan.citas.filter((e) => e.clase === 'futura').sort((a, b) => a.inicio - b.inicio || a.fila - b.fila);
  for (const e of futuras) await colocar(ctx, e);
}

// Lo que impide aplicar: columnas que faltan, un mapa mal hecho y, en las citas que se traen, un
// servicio, un profesional o un estado de Flowww que no se sabe qué es en la app.
function bloqueos(plan) {
  const salida = [...plan.errores];
  const sinCasar = (mapa, casado) => [...mapa.values()].filter((x) => !casado(x.casa || {}));
  const servicios = sinCasar(plan.servicios, (c) => c.id || c.ignorar).length;
  const profesionales = sinCasar(plan.profesionales, (c) => c.id || c.cualquiera).length;
  if (servicios) salida.push(`${servicios} ${servicios === 1 ? 'servicio de Flowww no casa' : 'servicios de Flowww no casan'} con ningún tratamiento de la app`);
  if (profesionales) salida.push(`${profesionales} ${profesionales === 1 ? 'profesional de Flowww no casa' : 'profesionales de Flowww no casan'} con nadie de la app`);
  if (plan.estados.size) salida.push(`${plan.estados.size} ${plan.estados.size === 1 ? 'estado de Flowww' : 'estados de Flowww'} sin decidir si se ${plan.estados.size === 1 ? 'trae' : 'traen'}`);
  return salida;
}

function leerFichero(fichero, tipo, mapa, errores) {
  if (!fichero) return null;
  let csv;
  try {
    csv = leerCsv(fichero.contenido);
  } catch (err) {
    if (err instanceof ErrorCsv) throw new ErrorImportacion(`${fichero.nombre}: ${err.message}`);
    throw err;
  }
  const { campos, sinUsar, errores: e } = F.resolverColumnas(csv.cabeceras, tipo, mapa.columnas[tipo]);
  for (const x of e) errores.push(`${fichero.nombre}: ${x}`);
  return { nombre: fichero.nombre, codificacion: csv.codificacion, separador: csv.separador, filas: csv.filas, campos, sinUsar, sobran: csv.filas.filter((f) => f.sobran).map((f) => f.fila) };
}

// Lee, casa y coloca todo (sin escribir nada). Devuelve el plan (lo que cuenta el informe) y lo que
// hace falta para escribirlo.
async function planificar(con, { pacientes, citas, mapa, ahora, aplicar, sinRecordatorios }) {
  const plan = {
    aplicar, aplicado: false, ahora, lote: null, sinRecordatorios, errores: [], pacientes: [], citas: [],
    servicios: new Map(), profesionales: new Map(), salas: new Map(), estados: new Map(),
  };
  const m = F.leerMapa(mapa);
  plan.errores.push(...m.errores);
  plan.ficheros = { pacientes: leerFichero(pacientes, 'pacientes', m, plan.errores), citas: leerFichero(citas, 'citas', m, plan.errores) };
  const ref = await cargarReferencias(con);
  comprobarMapa(m, ref, plan.errores);
  const nombreDe = (filas) => (id) => filas.find((x) => x.id === id)?.nombre || null;
  plan.nombres = { tratamiento: (id) => ref.tratamientos.get(id)?.nombre || id, sala: nombreDe(ref.salas), profesional: nombreDe(ref.profesionales) };
  plan.duracionApp = (id) => ref.tratamientos.get(id)?.motor.duracion;
  const ctx = {
    con, plan, ref, mapa: m, dias: new Map(), vinculados: new Set(),
    indices: { flowww: new Map(), telefono: new Map(), email: new Map(), nombre: new Map() },
    nombres: { ...plan.nombres, rol: (id) => ref.profesionales.find((p) => p.id === id)?.rol },
  };
  if (!plan.errores.length) {
    if (plan.ficheros.pacientes) planificarPacientes(ctx, plan.ficheros.pacientes);
    if (plan.ficheros.citas) await planificarCitas(ctx, plan.ficheros.citas);
  }
  // Lo que el mapa dice de cada servicio se guarda para la próxima vez (sin mapa).
  plan.mapeos = [...m.tratamientos].filter(([, v]) => v !== F.IGNORAR).map(([k, id]) => ({ clave: `flowww:${k}`.slice(0, 160), id, texto: m.textos.get(`tratamientos:${k}`) }));
  plan.bloqueos = bloqueos(plan);
  return ctx;
}

// ── Escribir ────────────────────────────────────────────────────────────────────────────────
function tituloTarea(e, plan) {
  const d = T.partesMadrid(e.inicio);
  return `Cita importada de Flowww que no cabe en la agenda (${d.fecha.slice(8)}/${d.fecha.slice(5, 7)} ${d.hora}, ${plan.nombres.tratamiento(e.tratamientoId)}): ${e.colocacion.motivo}. Revisarla`.slice(0, 200);
}

async function escribir(con, ctx, { ahora, actor, sinRecordatorios }) {
  const { plan, ref } = ctx;
  const hecho = { pacientesNuevos: [], vinculados: [], telefonos: [], consentimientos: [], bajas: [], citas: [], revisar: [], tareas: [], inscripciones: [], mapeos: [] };
  const segundo = aSegundos(ahora);
  for (const e of plan.pacientes) {
    if (e.accion === 'nuevo') {
      const n = e.notas ? cifrar(e.notas) : { cifrado: null, iv: null, tag: null };
      const [r] = await con.query(
        `INSERT INTO pacientes (nombre, apellidos, telefono, email, fecha_nacimiento, origen, flowww_id, notas_cifradas, notas_iv, notas_tag, creado_en)
         VALUES (?, ?, ?, ?, ?, 'flowww', ?, ?, ?, ?, ?)`,
        [e.nombre, e.apellidos, e.telefono, e.email, e.fechaNacimiento, e.flowwwId, n.cifrado, n.iv, n.tag, ahora]);
      e.pacienteId = r.insertId;
      hecho.pacientesNuevos.push(r.insertId);
    } else if (e.accion === 'existente') {
      if (e.vincular) {
        const [r] = await con.query('UPDATE pacientes SET flowww_id = ? WHERE id = ? AND flowww_id IS NULL', [e.flowwwId, e.pacienteId]);
        if (r.affectedRows) hecho.vinculados.push({ id: e.pacienteId, flowwwId: e.flowwwId });
      }
      if (e.completarTelefono) {
        const [r] = await con.query('UPDATE pacientes SET telefono = ? WHERE id = ? AND telefono IS NULL', [e.completarTelefono, e.pacienteId]);
        if (r.affectedRows) hecho.telefonos.push({ id: e.pacienteId, telefono: e.completarTelefono });
      }
    }
  }
  for (const e of plan.pacientes.filter((x) => ['nuevo', 'existente'].includes(x.accion))) {
    for (const c of e.consentimientos.filter((x) => !x.yaTenia)) {
      const [r] = await con.query(
        "INSERT INTO consentimientos (paciente_id, tipo, estado, fuente, prueba, registrado_en, registrado_por) VALUES (?, ?, ?, 'importacion', ?, ?, ?)",
        [e.pacienteId, c.tipo, c.otorgado ? 'otorgado' : 'revocado', `Flowww, ${plan.ficheros.pacientes.nombre} fila ${e.fila}: «${c.columna}» = «${c.valor}»`.slice(0, 500), ahora, actor]);
      hecho.consentimientos.push(r.insertId);
      // Un «no» a los mensajes comerciales por WhatsApp es una baja comercial, como la que se pide
      // por WhatsApp: ni secuencias ni la excepción de «cliente con servicio similar».
      if (!c.otorgado && c.tipo === 'whatsapp_marketing') {
        const [b] = await con.query('UPDATE pacientes SET baja_comercial_en = ? WHERE id = ? AND baja_comercial_en IS NULL', [segundo, e.pacienteId]);
        if (b.affectedRows) hecho.bajas.push(e.pacienteId);
      }
    }
  }
  const conCita = new Set();
  for (const e of plan.citas.filter((x) => x.clase === 'futura')) {
    const t = ref.tratamientos.get(e.tratamientoId);
    const col = e.colocacion;
    const pacienteId = e.paciente.entrada ? e.paciente.entrada.pacienteId : e.paciente.bd.id;
    const inst = huecoAInstantes(e.fecha, { inicio: T.minutosDe(e.hora) }, t.motor);
    const [r] = await con.query(
      `INSERT INTO citas (paciente_id, tratamiento_id, profesional_id, sala_id, equipo_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta,
         estado, origen, flowww_id, revisar_motivo, recordatorios, token, notas, creada_por, confirmada_en, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', 'importacion', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pacienteId, e.tratamientoId, col.profesionalId, col.salaId, col.equipoId, inst.inicio, inst.fin, inst.sala_desde, inst.sala_hasta,
        inst.prof_desde, inst.prof_hasta, e.flowwwId, col.cabe ? null : col.motivo.slice(0, 255), !sinRecordatorios,
        crypto.randomBytes(32).toString('base64url'), e.notas ? `Flowww: ${e.notas}`.slice(0, 600) : null, actor, ahora, ahora]);
    e.citaId = r.insertId;
    hecho.citas.push(r.insertId);
    conCita.add(pacienteId);
    await registrar(con, {
      tipo: 'cita_importada', entidad: 'cita', entidadId: r.insertId, actor,
      datos: { lote: plan.lote, fecha: e.fecha, hora: e.hora, tratamiento: e.tratamientoId, profesional: col.profesionalId, sala: col.salaId, ...(col.cabe ? {} : { revisar: col.motivo }) },
    });
    if (!col.cabe) {
      hecho.revisar.push(r.insertId);
      const [tr] = await con.query("INSERT INTO tareas (tipo, titulo, paciente_id, urgente, vence_en) VALUES ('otro', ?, ?, ?, ?)",
        [tituloTarea(e, plan), pacienteId, e.inicio - ahora < 48 * 3600000, new Date(Math.min(ahora.getTime() + 86400000, e.inicio.getTime()))]);
      hecho.tareas.push(tr.insertId);
    }
  }
  // Con cita, se acaban sus secuencias de captación (como al reservar).
  for (const pacienteId of conCita) {
    const [ins] = await con.query("SELECT id, estado FROM inscripciones WHERE paciente_id = ? AND estado IN ('activa','pausada') AND secuencia IN (?) FOR UPDATE", [pacienteId, SECUENCIAS_CAPTACION]);
    if (!ins.length) continue;
    await con.query("UPDATE inscripciones SET estado = 'terminada', motivo_fin = 'cita' WHERE id IN (?)", [ins.map((i) => i.id)]);
    hecho.inscripciones.push(...ins.map((i) => ({ id: i.id, estado: i.estado, paciente: pacienteId })));
  }
  for (const m of plan.mapeos) {
    const [[antes]] = await con.query('SELECT tratamiento_id FROM mapeo_tratamientos WHERE clave = ?', [m.clave]);
    if (antes?.tratamiento_id === m.id) continue;
    await con.query('INSERT INTO mapeo_tratamientos (clave, tratamiento_id, notas) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tratamiento_id = VALUES(tratamiento_id), notas = VALUES(notas)',
      [m.clave, m.id, `Servicio de Flowww «${m.texto}»`.slice(0, 255)]);
    hecho.mapeos.push({ clave: m.clave, antes: antes?.tratamiento_id || null });
  }
  // El lote (lo que se ha hecho, para poder deshacerlo). Si no había nada nuevo, no hay lote.
  if (Object.values(hecho).some((x) => x.length)) {
    await registrar(con, { tipo: 'importacion_flowww', entidad: 'importacion', entidadId: plan.lote, actor, datos: { ...hecho, ahora: segundo, recordatorios: !sinRecordatorios } });
  } else plan.lote = null;
  return hecho;
}

function nuevoLote(ahora) {
  const p = T.partesMadrid(ahora);
  return `flowww-${p.fecha}-${p.hora.replace(':', '')}-${crypto.randomBytes(2).toString('hex')}`;
}

/**
 * Importa (o ensaya) los ficheros de Flowww.
 * @param {object} o pacientes, citas: { nombre, contenido: Buffer } (al menos uno); mapa (el JSON ya
 *   leído, o null); aplicar; sinRecordatorios; ahora; actor
 * @returns {{ plan, aplicado, lote, informe }}
 */
async function importar(pool, { pacientes = null, citas = null, mapa = null, aplicar = false, sinRecordatorios = false, ahora = new Date(), actor = ACTOR } = {}) {
  if (!pacientes && !citas) throw new ErrorImportacion('Hace falta el fichero de pacientes, el de citas o los dos');
  const con = await pool.getConnection();
  try {
    await con.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await con.beginTransaction();
    // Como una reserva (y en el mismo orden que agenda.reservar, para no interbloquearse): mientras se
    // colocan estas citas, nadie puede dar otra en esas cabinas, con esos profesionales o aparatos.
    if (aplicar) {
      await con.query('SELECT id FROM salas ORDER BY id FOR UPDATE');
      await con.query('SELECT id FROM profesionales ORDER BY id FOR UPDATE');
      await con.query('SELECT id FROM equipos ORDER BY id FOR UPDATE');
    }
    const ctx = await planificar(con, { pacientes, citas, mapa, ahora, aplicar, sinRecordatorios });
    const { plan } = ctx;
    if (!aplicar || plan.bloqueos.length) {
      await con.rollback();
      return { plan, aplicado: false, lote: null, informe: redactarInforme(plan) };
    }
    plan.lote = nuevoLote(ahora);
    plan.hecho = await escribir(con, ctx, { ahora, actor, sinRecordatorios });
    await con.commit();
    plan.aplicado = true;
    return { plan, aplicado: true, lote: plan.lote, informe: redactarInforme(plan) };
  } catch (err) {
    await con.rollback().catch(() => {});
    // El mensaje de MariaDB lleva el valor repetido (un teléfono): no sale por la terminal.
    if (err.code === 'ER_DUP_ENTRY') throw new ErrorImportacion('Mientras se importaba, alguien ha dado de alta un paciente o una cita con los mismos datos. No se ha escrito nada: vuelve a lanzarlo.');
    throw err;
  } finally {
    con.release();
  }
}

// ── Deshacer ────────────────────────────────────────────────────────────────────────────────
async function tieneActividad(con, pacienteId) {
  const [[r]] = await con.query(`SELECT ${TABLAS_DEL_PACIENTE.map((t) => `EXISTS (SELECT 1 FROM ${t} WHERE paciente_id = ?)`).join(' OR ')} AS hay`,
    TABLAS_DEL_PACIENTE.map(() => pacienteId));
  return Boolean(Number(r.hay));
}

/**
 * Quita lo que metió una importación (la última sin deshacer, o la del lote que se diga) y nadie ha
 * tocado: sus citas que siguen «confirmadas» (las que ya cambiaron de estado se quedan), sus tareas
 * abiertas, los consentimientos y bajas que registró, el código de Flowww y el teléfono que apuntó a
 * quien ya estaba, los pacientes nuevos que no tengan nada más en la app, lo que guardó del mapa y
 * las secuencias que paró (salvo a quien le quede una cita). Sin aplicar, lo hace en una transacción
 * que deshace al final: cuenta lo que haría sin cambiar nada.
 */
async function deshacer(pool, { lote = null, aplicar = false, ahora = new Date(), actor = ACTOR } = {}) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [evs] = await con.query("SELECT entidad_id, datos FROM eventos WHERE tipo = 'importacion_flowww' ORDER BY id DESC");
    const [hechos] = await con.query("SELECT entidad_id FROM eventos WHERE tipo = 'importacion_flowww_deshecha'");
    const deshechos = new Set(hechos.map((h) => h.entidad_id));
    const ev = lote ? evs.find((x) => x.entidad_id === lote) : evs.find((x) => !deshechos.has(x.entidad_id));
    if (!ev) throw new ErrorImportacion(lote ? `No hay ninguna importación de Flowww «${lote}»` : 'No hay ninguna importación de Flowww que deshacer');
    if (deshechos.has(ev.entidad_id)) throw new ErrorImportacion(`La importación ${ev.entidad_id} ya se deshizo`);
    const d = { pacientesNuevos: [], vinculados: [], telefonos: [], consentimientos: [], bajas: [], citas: [], tareas: [], inscripciones: [], mapeos: [], ...parsear(ev.datos) };
    const r = {
      lote: ev.entidad_id, aplicado: aplicar, citasQuitadas: 0, citasQuedan: [], pacientesQuitados: 0, pacientesQuedan: [], vinculados: 0, telefonos: 0,
      consentimientos: 0, bajas: 0, tareas: 0, mapeos: 0, secuencias: 0,
    };
    const [citas] = d.citas.length ? await con.query('SELECT id, estado, paciente_id FROM citas WHERE id IN (?) FOR UPDATE', [d.citas]) : [[]];
    const quitar = citas.filter((c) => c.estado === 'confirmada').map((c) => c.id);
    const quedan = citas.filter((c) => c.estado !== 'confirmada');
    r.citasQuedan = quedan.map((c) => ({ id: c.id, estado: c.estado }));
    const hechas = async (sql, p) => (await con.query(sql, p))[0].affectedRows;
    if (quitar.length) r.citasQuitadas = await hechas('DELETE FROM citas WHERE id IN (?)', [quitar]);
    if (d.tareas.length) r.tareas = await hechas("DELETE FROM tareas WHERE id IN (?) AND estado = 'abierta'", [d.tareas]);
    // La secuencia que paró su cita vuelve, salvo que le quede una cita importada (ya tocada).
    const conCita = new Set(quedan.map((c) => c.paciente_id));
    for (const i of d.inscripciones.filter((x) => !conCita.has(x.paciente))) {
      r.secuencias += await hechas("UPDATE inscripciones SET estado = ?, motivo_fin = NULL WHERE id = ? AND estado = 'terminada' AND motivo_fin = 'cita'", [i.estado, i.id]);
    }
    if (d.consentimientos.length) r.consentimientos = await hechas('DELETE FROM consentimientos WHERE id IN (?)', [d.consentimientos]);
    if (d.bajas.length) r.bajas = await hechas('UPDATE pacientes SET baja_comercial_en = NULL WHERE id IN (?) AND baja_comercial_en = ?', [d.bajas, new Date(d.ahora)]);
    for (const v of d.vinculados) r.vinculados += await hechas('UPDATE pacientes SET flowww_id = NULL WHERE id = ? AND flowww_id = ?', [v.id, v.flowwwId]);
    for (const v of d.telefonos) r.telefonos += await hechas('UPDATE pacientes SET telefono = NULL WHERE id = ? AND telefono = ?', [v.id, v.telefono]);
    for (const id of d.pacientesNuevos) {
      let borrado = false;
      if (!(await tieneActividad(con, id))) {
        try {
          borrado = (await hechas('DELETE FROM pacientes WHERE id = ?', [id])) > 0;
        } catch (err) {
          if (err.errno !== 1451) throw err; // lo usa otra tabla: se queda
        }
      }
      if (borrado) r.pacientesQuitados++; else r.pacientesQuedan.push(id);
    }
    for (const m of d.mapeos) {
      if (m.antes) r.mapeos += await hechas('UPDATE mapeo_tratamientos SET tratamiento_id = ? WHERE clave = ?', [m.antes, m.clave]);
      else r.mapeos += await hechas('DELETE FROM mapeo_tratamientos WHERE clave = ?', [m.clave]);
    }
    if (aplicar) {
      await registrar(con, { tipo: 'importacion_flowww_deshecha', entidad: 'importacion', entidadId: r.lote, actor, datos: { ...r, ahora } });
      await con.commit();
    } else await con.rollback();
    return { ...r, informe: redactarDeshacer(r) };
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

// ── Recordatorios de lo importado ───────────────────────────────────────────────────────────
/**
 * Pone (o quita) los recordatorios de víspera y 2 horas a todas las citas futuras que se trajeron de
 * Flowww: p. ej., se importaron con --sin-recordatorios mientras Flowww seguía mandando los suyos, y
 * ya se ha apagado. Sin aplicar, solo cuenta.
 */
async function cambiarRecordatorios(pool, { activar, aplicar = false, ahora = new Date(), actor = ACTOR }) {
  const donde = "origen = 'importacion' AND flowww_id IS NOT NULL AND estado IN ('retenida','confirmada') AND inicio > ? AND recordatorios = ?";
  const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM citas WHERE ${donde}`, [ahora, !activar]);
  const citas = Number(n.n);
  const una = citas === 1;
  const cuantas = `${citas} ${una ? 'cita futura importada' : 'citas futuras importadas'} de Flowww`;
  if (!citas) return { citas, aplicado: false, informe: `No hay citas futuras importadas de Flowww ${activar ? 'sin' : 'con'} recordatorios: no hay nada que cambiar.` };
  if (!aplicar) {
    const que = activar ? `${una ? 'pasaría' : 'pasarían'} a tener` : `se ${una ? 'quedaría' : 'quedarían'} sin`;
    return { citas, aplicado: false, informe: `Ensayo: ${cuantas} ${que} recordatorios de víspera y 2 horas. Para hacerlo, lo mismo con --aplicar.` };
  }
  await pool.query(`UPDATE citas SET recordatorios = ? WHERE ${donde}`, [activar, ahora, !activar]);
  await registrar(pool, { tipo: activar ? 'importacion_flowww_con_recordatorios' : 'importacion_flowww_sin_recordatorios', entidad: 'importacion', actor, datos: { citas } });
  const ahoraTiene = activar ? `ya ${una ? 'tiene' : 'tienen'}` : `ya no ${una ? 'tiene' : 'tienen'}`;
  return { citas, aplicado: true, informe: `Hecho: ${cuantas} ${ahoraTiene} recordatorios de víspera y 2 horas.` };
}

module.exports = { importar, deshacer, cambiarRecordatorios, ErrorImportacion, ACTOR };
