'use strict';
// Importación de Flowww (el programa de hoy de la clínica): pacientes y citas futuras desde sus CSV,
// para poder apagarlo sin perder nada. La facturación no se trae. Lo usa scripts/importar-flowww.js;
// cómo se hace, paso a paso: docs/MIGRAR-FLOWWW.md.
//
//   ensayo    lee, casa y coloca todo sin escribir nada, y lo cuenta en un informe sin nombres ni
//             teléfonos (filas del CSV y códigos). Aun así es confidencial: con la app o el CSV se sabe
//             de quién es cada fila, y lleva sus tratamientos
//   aplicar   lo mismo en una transacción: entra todo o nada. Para escribir se bloquean cabinas,
//             profesionales y aparatos como en una reserva (y si mientras se planificaba alguien dio
//             una cita, se vuelve a planificar). Si algo no casa (un servicio, un profesional, un
//             estado) o no está claro (qué columna es el código de la cita, si hay columna de estado),
//             no se aplica hasta que lo diga el mapa. Hace falta la CLAVE_CIFRADO de la app
//   deshacer  quita lo que metió una importación y nadie ha tocado; las oposiciones («no» a la
//             publicidad, bajas comerciales) se quedan
//
// Pacientes: sin duplicar (por su código de Flowww, su teléfono o su email, y con un nombre que
// cuadre), con su código guardado; a quien ya estaba en la app se le apunta el código y se le completa
// lo que su ficha no tenga (teléfono, apellidos, email, nacimiento, observaciones): lo que tiene no se
// toca. Importar no da consentimiento de marketing (ni le marca como cliente, que por la LSSI también
// lo daría): solo cuenta lo que diga una columna. Un «no» se registra siempre (revocado y, en WhatsApp,
// baja comercial); un «sí», solo si en la app no hay nada de ese tipo y no tiene la baja comercial.
// Citas: las futuras, con origen «importacion», colocadas por el motor de agenda a su hora. Si no
// caben (o, sin código, pueden ser una ya importada que se movió), entran igual (lo que dio Flowww
// manda y nada se pisa), con el motivo en revisar_motivo y una tarea en el panel. Las ya importadas
// que en Flowww se han anulado, han cambiado o ya no salen no se tocan solas: se quedan sin
// recordatorios y con su tarea. No se les manda la confirmación (ya la dio Flowww), pero sí los
// recordatorios de víspera y 2 horas, salvo --sin-recordatorios (servidor/avisos-cita.js). Datos de
// salud: las observaciones (del paciente y de la cita) van cifradas y el informe no lleva nombres,
// teléfonos, emails ni notas.
const crypto = require('crypto');
const T = require('../motor/tiempo');
const { leerCsv, ErrorCsv } = require('../motor/importacion/csv');
const F = require('../motor/importacion/flowww');
const C = require('../motor/importacion/colocar');
const { redactarInforme, redactarDeshacer } = require('../motor/importacion/informe');
const { tratamientoParaMotor, huecoAInstantes, aMinutosDelDia, ESTADOS_QUE_OCUPAN } = require('../motor/agenda/dia');
const agenda = require('./agenda');
const { apuntarBaja } = require('./bajas');
const { cifrar, descifrar, tieneClave } = require('./cripto');
const { registrar } = require('./eventos');

const ACTOR = 'importacion-flowww';
// Las secuencias que termina una cita (como en agenda.reservar).
const SECUENCIAS_CAPTACION = ['lead', 'cancelacion', 'toca_repetir', 'dormido', 'vale_regalo'];
// Lo que puede tener un paciente en la app: si tiene algo, deshacer no lo borra.
const TABLAS_DEL_PACIENTE = ['citas', 'conversaciones', 'leads', 'presupuestos', 'inscripciones', 'seguimientos', 'tareas', 'resenas',
  'peticiones_resena', 'lista_espera', 'ofertas_hechas', 'consentimientos'];
// Una fila de citas sin paciente: la comida, una formación, una nota.
const BLOQUEO = 'es un bloqueo o una nota de agenda';
const SIN_CLAVE = 'Para aplicar hace falta la CLAVE_CIFRADO de la app en el .env (64 caracteres hexadecimales, la misma que usa la app): '
  + 'con la de desarrollo, que es pública, lo que se cifra (observaciones, lo que se guarda para deshacer) no estaría protegido y la app no lo podría leer. '
  + 'No se ha cambiado nada.';

class ErrorImportacion extends Error {}

const aSegundos = (d) => new Date(Math.floor(d.getTime() / 1000) * 1000);
const parsear = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});
const lista = (mapa, k) => mapa.get(k) || mapa.set(k, []).get(k);
const b64 = (x) => (x == null ? null : Buffer.from(x).toString('base64'));
const deB64 = (x) => (x == null ? null : Buffer.from(x, 'base64'));
// En las pruebas vale la clave de desarrollo; fuera de ellas, no.
const enPruebas = () => process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
// «22/10/2026» y «22/10/2026 a las 11:00», en hora de Madrid.
const fechaEs = (instante) => T.partesMadrid(new Date(instante)).fecha.split('-').reverse().join('/');
const fechaHoraEs = (instante) => `${fechaEs(instante)} a las ${T.partesMadrid(new Date(instante)).hora}`;

// El enlace de «Tu cita» de una cita que no da agenda.reservar, como lo guarde la agenda: desde la
// migración 010 (privacidad de la cita), su huella y el token cifrado (agenda.nuevoToken) con su
// caducidad, y el UID del .ics se lo pone la agenda la primera vez que hace falta; antes, el token en
// claro. Se mira qué hay para que esto no se rompa al juntarse con esa vuelta, que cambia la tabla sin
// tocar este fichero (cuando ya estén juntas, sobra la segunda rama).
function columnasEnlace(fin) {
  if (typeof agenda.nuevoToken === 'function') return { ...agenda.nuevoToken().columnas, token_caduca_en: agenda.caducidadEnlace(fin) };
  return { token: crypto.randomBytes(32).toString('base64url') };
}

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
    // El consentimiento que vale de cada paciente y tipo: el último que se registró.
    consentimientos: new Map(),
    bajas: new Set((await q('SELECT telefono FROM bajas_comerciales')).map((b) => b.telefono)),
    citasImportadas: new Map(),
    // Las importadas con código de Flowww, por su código (sin el «#servicio» de las visitas con varios).
    importadasPorCodigo: new Map(),
    // Las que ya están a revisar porque en Flowww habían dejado de ser así (según los lotes).
    retiradas: new Set(await retiradasVigentes(con)),
  };
  for (const c of await q('SELECT paciente_id, tipo, estado FROM consentimientos ORDER BY registrado_en, id')) ref.consentimientos.set(`${c.paciente_id}:${c.tipo}`, c.estado);
  for (const c of await q('SELECT id, flowww_id, paciente_id, tratamiento_id, inicio, estado, recordatorios, revisar_motivo FROM citas WHERE flowww_id IS NOT NULL')) {
    ref.citasImportadas.set(c.flowww_id, c);
    if (!c.flowww_id.startsWith('c:')) lista(ref.importadasPorCodigo, c.flowww_id.split('#')[0]).push(c);
  }
  // Los anonimizados (derecho de supresión) también: su código y su teléfono no se pueden repetir, y
  // a ellos no se les vuelve a traer.
  for (const p of await q(`SELECT id, nombre, apellidos, telefono, email, fecha_nacimiento, notas_cifradas IS NOT NULL AS con_notas, baja_comercial_en,
                                  flowww_id, anonimizado_en FROM pacientes`)) {
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

// Lo que su ficha no tiene y Flowww sí: se completa (lo que ya tiene no se cambia). Un email que ya es
// de otro paciente no se le pone (como el teléfono). Las observaciones se añaden a las suyas al
// escribir, que es donde se descifran, si no las tiene ya.
function completarFicha(ctx, e, bd) {
  const c = {};
  if (!bd.apellidos && e.apellidos) c.apellidos = e.apellidos;
  if (!bd.email && e.email && !ctx.ref.pacientes.porEmail.has(e.email)) c.email = e.email;
  if (!bd.fecha_nacimiento && e.fechaNacimiento) c.fechaNacimiento = e.fechaNacimiento;
  if (e.notas) c.notas = e.notas;
  if (Object.keys(c).length) e.completar = c;
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
    Object.assign(e, { accion: 'existente', pacienteId: bd.id, bd, via, vincular: !bd.flowww_id && !ctx.vinculados.has(bd.id) });
    if (e.vincular) ctx.vinculados.add(bd.id);
    // Si en la app no tenía teléfono, se le pone el de Flowww (sin él no le llegan los recordatorios de
    // sus citas), salvo que ese teléfono ya sea de otra persona.
    if (!bd.telefono && e.telefono && !conTelefono && !ref.pacientes.porTelefono.has(e.telefono)) e.completarTelefono = e.telefono;
    completarFicha(ctx, e, bd);
  } else e.accion = 'nuevo';
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
  // Por el nombre, en el fichero y en la app, sin contar dos veces a quien está en los dos (el que se
  // importó la vez anterior): si hay más de uno, no se sabe de quién es. Si la cita trae un código de
  // cliente que no está en ningún sitio, no es nadie que tenga otro código de Flowww: con el mismo
  // nombre, es otra persona (se da de alta con su código).
  const otroCodigo = (codigo) => Boolean(c.pacienteRef && codigo && !String(codigo).startsWith('p:'));
  const k = F.clave(`${c.nombre} ${c.apellidos || ''}`);
  const quienes = new Map();
  for (const e of (i.nombre.get(k) || []).filter(vale).map(raiz)) if (!otroCodigo(e.flowwwId)) quienes.set(e.pacienteId ? `bd:${e.pacienteId}` : e, { entrada: e });
  for (const p of ref.pacientes.porNombre.get(k) || []) if (!otroCodigo(p.flowww_id) && !quienes.has(`bd:${p.id}`)) quienes.set(`bd:${p.id}`, { bd: p });
  if (quienes.size > 1) return { falta: 'hay varios pacientes con ese nombre' };
  if (quienes.size === 1) return { ...[...quienes.values()][0], via: 'nombre' };
  const e = {
    origen: 'citas', fila: c.fila, flowwwId: c.pacienteRef || F.huella('p', [c.nombre, c.apellidos, null, c.telefono, c.email]), sinCodigo: !c.pacienteRef,
    nombre: c.nombre, apellidos: c.apellidos, telefono: c.telefono, email: c.email, fechaNacimiento: null, notas: null,
    consentimientos: [], avisos: [], errores: [], accion: 'error',
  };
  ctx.plan.pacientes.push(e);
  situarPaciente(ctx, e);
  return vale(e) ? { entrada: raiz(e), via: 'cita' } : { falta: e.errores[0] };
}

// El marketing de cada paciente que se trae, con lo que digan todas sus filas (la misma persona puede
// salir dos veces: si una dice «no» y otra «sí», gana el «no»), frente a lo que ya hay en la app:
//   «no»  se registra siempre (revocado; a WhatsApp, también la baja comercial), salvo que ya conste:
//         sin fecha para saber qué es más reciente, gana la oposición
//   «sí»  solo si en la app no hay nada de ese tipo y no tiene la baja comercial (en su ficha o su
//         teléfono en la lista de bajas): no pisa lo que haya dicho en la app ni una oposición
// A quien su teléfono esté en la lista de bajas se le apunta también en la ficha, que es lo que mira
// el permiso comercial de un paciente (servidor/repesca/motor.js).
function decidirConsentimientos(ctx) {
  const { plan, ref } = ctx;
  const filasDe = new Map();
  for (const e of plan.pacientes) {
    const r = raiz(e);
    if (['nuevo', 'existente'].includes(r.accion)) lista(filasDe, r).push(e);
  }
  for (const [r, filas] of filasDe) {
    const porTipo = new Map();
    for (const x of filas) {
      for (const c of x.consentimientos) {
        const antes = porTipo.get(c.tipo);
        if (antes && antes.otorgado !== c.otorgado) r.contradice = true;
        if (!antes || (antes.otorgado && !c.otorgado)) porTipo.set(c.tipo, { ...c, fila: x.fila, codigo: x.sinCodigo ? null : x.flowwwId });
      }
    }
    const telefono = r.accion === 'nuevo' ? r.telefono : r.bd.telefono || r.completarTelefono || null;
    const enLista = Boolean(telefono && ref.bajas.has(telefono));
    const conBaja = enLista || Boolean(r.bd?.baja_comercial_en);
    r.bajaDeLista = enLista && !r.bd?.baja_comercial_en;
    r.marketing = [...porTipo.values()].map((c) => {
      const vigente = r.bd ? ref.consentimientos.get(`${r.bd.id}:${c.tipo}`) : null;
      let accion = 'otorgar';
      if (!c.otorgado) accion = vigente === 'revocado' ? 'ya_constaba' : 'revocar';
      else if (vigente) accion = 'ya_tenia';
      else if (conBaja) accion = 'baja';
      return { ...c, accion, pisaSi: !c.otorgado && vigente === 'otorgado' };
    });
  }
}

// ── Citas ───────────────────────────────────────────────────────────────────────────────────
// Pendiente en la app: confirmada y por venir (lo que se puede comparar con Flowww).
const pendiente = (c, ahora) => c.estado === 'confirmada' && new Date(c.inicio) > ahora;
// De quién es una fila de citas, para saber si dos filas con el mismo código son de la misma visita.
const personaDe = (e) => e.pacienteRef || F.clave(`${e.nombre || ''} ${e.apellidos || ''}`) || e.telefono || e.email || '';
// Dos filas con la misma cita: mismo paciente, día, hora y servicio.
const mismaCita = (a, b) => personaDe(a) === personaDe(b) && a.fecha === b.fecha && a.hora === b.hora && F.clave(a.servicio) === F.clave(b.servicio);
// «código#servicio» (y «#hora» si hace falta), sin pasar de lo que cabe en citas.flowww_id.
function compuesto(codigo, parte) {
  const id = `${codigo}#${parte}`;
  return id.length <= 80 ? id : `${codigo.slice(0, 60)}#${crypto.createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
}

function leerFilaCita(ctx, f, fichero) {
  const { plan, mapa } = ctx;
  const c = F.leerCita(f.valores, fichero.campos);
  const e = { fila: f.fila, ...c, codigo: c.flowwwId, sinCodigo: !c.flowwwId, clase: 'error' };
  plan.citas.push(e);
  // Sin nadie: un bloqueo de agenda, la comida o una nota. No es una cita de un paciente.
  e.sinNadie = !c.pacienteRef && !c.nombre && !c.telefono && !c.email;
  if (c.fecha && c.hora) {
    e.inicio = T.desdeMadrid(c.fecha, c.hora);
    e.estadoClase = F.claseDeEstado(c.estado, mapa.estados);
    // Viva: la que se traería (por venir, de alguien y no anulada).
    e.viva = !e.sinNadie && e.inicio > plan.ahora && e.estadoClase !== F.IGNORAR;
  }
  return e;
}

// El identificador de cada cita en la app (citas.flowww_id). Con código de Flowww, el código. Si sale
// en varias filas: la misma cita repetida (se trae una vez), una visita con varios servicios (una cita
// por servicio, «código#servicio»; si el mismo servicio va a dos horas, también con la hora) o un
// código que no es de una cita: sus citas vivas son de otros días o de otra persona (¿el del
// cliente?), y así no se aplica. Sin código (o con uno que no vale), una huella de lo que trae la fila.
function asignarCodigos(ctx, filas) {
  const { plan } = ctx;
  const porCodigo = new Map();
  for (const e of filas) if (e.codigo && e.inicio) lista(porCodigo, e.codigo).push(e);
  for (const [codigo, grupo] of porCodigo) {
    if (grupo.length < 2) continue;
    const vivas = grupo.filter((e) => e.viva);
    if (new Set(vivas.map((e) => `${e.fecha}|${personaDe(e)}`)).size > 1) {
      plan.codigosNoUnicos.push({ codigo, filas: grupo.map((e) => e.fila) });
      for (const e of grupo) Object.assign(e, { flowwwId: null, sinCodigo: true, codigoNoUnico: true });
      continue;
    }
    const servicios = new Set(grupo.map((e) => F.clave(e.servicio)));
    if (servicios.size > 1) {
      for (const e of grupo) e.flowwwId = compuesto(codigo, F.clave(e.servicio));
      plan.variosServicios.push({ codigo, filas: grupo.map((e) => e.fila) });
    }
    // El mismo servicio dos veces ese día, a distinta hora: dos sesiones, dos citas.
    const porId = new Map();
    for (const e of vivas) lista(porId, e.flowwwId).push(e);
    for (const mismas of porId.values()) {
      if (new Set(mismas.map((e) => e.hora)).size > 1) for (const e of mismas) e.flowwwId = compuesto(e.flowwwId, e.hora);
    }
  }
  for (const e of filas) {
    if (e.inicio && !e.flowwwId) e.flowwwId = F.huella('c', [e.pacienteRef, e.nombre, e.apellidos, e.telefono, e.fecha, e.hora, e.servicio]);
  }
}

// La cita de la app que se trajo de esta fila en otra importación: por su identificador o, si su código
// venía antes de otra forma (una visita que ahora tiene un servicio más, o uno menos), por su código y
// su tratamiento. Cada una, con una sola fila.
function emparejar(ctx, e) {
  const { ref } = ctx;
  let antes = ref.citasImportadas.get(e.flowwwId);
  if (!antes && e.codigo && !e.codigoNoUnico && e.tratamientoCasado) {
    const mismas = (ref.importadasPorCodigo.get(e.codigo.split('#')[0]) || []).filter((c) => (c.flowww_id === e.codigo || c.flowww_id.startsWith(`${e.codigo}#`))
      && c.tratamiento_id === e.tratamientoCasado && !ctx.emparejadas.has(c.id) && !ctx.idsFichero.has(c.flowww_id));
    antes = mismas.find((c) => new Date(c.inicio).getTime() === e.inicio.getTime()) || mismas[0];
  }
  if (!antes || ctx.emparejadas.has(antes.id)) return null;
  ctx.emparejadas.add(antes.id);
  return antes;
}

// Lo que se le dice a recepción de una ya importada que en Flowww ya no es así (va en revisar_motivo y
// en su tarea). Mientras, sin recordatorios: que no le llegue un «te esperamos» de una cita que ya no es.
// La que ya está a revisar por una importación anterior (y no se ha deshecho) no se vuelve a avisar: su
// tarea ya está en el panel.
function retirar(ctx, cita, tipo, datos = {}) {
  const { plan, ref } = ctx;
  const cuando = datos.inicio ? fechaHoraEs(datos.inicio) : null;
  const otro = datos.tratamiento ? `«${plan.nombres.tratamiento(datos.tratamiento)}» ` : '';
  const motivo = {
    anulada: 'en Flowww está anulada: anularla aquí o hablar con el paciente (sin recordatorios)',
    cambiada: `en Flowww es ahora ${otro}el ${cuando}: moverla aquí o hablar con el paciente (sin recordatorios)`,
    movida: `puede haberse movido en Flowww al ${cuando}: anular la que sobre (sin recordatorios)`,
    desaparecida: 'ya no está en la exportación de Flowww (¿anulada o borrada?): comprobarlo con el paciente (sin recordatorios)',
  }[tipo].slice(0, 255);
  plan.retiradas.push({ cita, tipo, motivo, ...datos, yaAvisada: ref.retiradas.has(cita.id) || cita.revisar_motivo === motivo });
}

// Una cita que ya se trajo y sigue pendiente en la app: si en Flowww se ha anulado o ha cambiado de
// hora o de tratamiento, no se toca sola (en la app también puede haber cambiado): a revisar. Si estaba
// a revisar y vuelve a salir tal cual (p. ej., faltaba en una exportación incompleta), tampoco: se dice.
function comprobarImportada(ctx, e, antes) {
  if (e.estadoClase === F.IGNORAR) return retirar(ctx, antes, 'anulada', { fila: e.fila });
  const otroTratamiento = e.tratamientoCasado && e.tratamientoCasado !== antes.tratamiento_id ? e.tratamientoCasado : null;
  if (new Date(antes.inicio).getTime() !== e.inicio.getTime() || otroTratamiento) {
    return retirar(ctx, antes, 'cambiada', { fila: e.fila, inicio: e.inicio, tratamiento: otroTratamiento });
  }
  if (ctx.ref.retiradas.has(antes.id) && !antes.recordatorios) ctx.plan.reaparecidas.push({ cita: antes, fila: e.fila });
}

// Lo importado antes que sigue pendiente en la app y no sale en este fichero: o se ha movido en Flowww
// (sin código parece otra cita: si el paciente tiene una nueva del mismo tratamiento, esa se trae para
// revisar) o ya no está (anulada y no exportada, o borrada). La exportación trae las citas desde hoy
// (docs/MIGRAR-FLOWWW.md): lo que va después de su última fecha no se puede saber, y si su fila no se ha
// podido leer, tampoco.
function revisarImportadas(ctx, filas, futuras) {
  const { plan, ref } = ctx;
  const fechas = filas.map((e) => e.fecha).filter(Boolean).sort();
  if (!fechas.length) return;
  plan.rangoCitas = { hasta: fechas.at(-1) };
  const ilegibles = new Set(filas.filter((e) => !e.inicio && e.codigo).map((e) => e.codigo.split('#')[0]));
  const candidatas = [];
  for (const c of ref.citasImportadas.values()) {
    if (ctx.emparejadas.has(c.id) || !pendiente(c, plan.ahora) || ilegibles.has(c.flowww_id.split('#')[0])) continue;
    if (T.fechaMadrid(new Date(c.inicio)) > plan.rangoCitas.hasta) plan.importadasFuera++;
    else candidatas.push(c);
  }
  candidatas.sort((a, b) => new Date(a.inicio) - new Date(b.inicio) || a.id - b.id);
  const movidas = new Set();
  for (const e of futuras.filter((x) => x.sinCodigo)) {
    const pacienteId = e.paciente.entrada?.pacienteId || e.paciente.bd?.id;
    const antes = pacienteId && candidatas.find((c) => !movidas.has(c.id) && c.paciente_id === pacienteId && c.tratamiento_id === e.tratamientoId);
    if (!antes) continue;
    movidas.add(antes.id);
    e.revisar = `puede ser la cita ${antes.id}, importada antes para el ${fechaHoraEs(antes.inicio)} y movida en Flowww: anular la que sobre`;
    // Su tarea es la de la nueva, que dice cuál es la otra.
    retirar(ctx, antes, 'movida', { fila: e.fila, inicio: e.inicio, sinTarea: true });
  }
  for (const c of candidatas) if (!movidas.has(c.id)) retirar(ctx, c, 'desaparecida');
}

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
  // Si en la app ese tratamiento no pide a nadie en concreto pero Flowww lo tenía con alguien, se
  // respeta: se queda con esa persona, que tiene que estar libre.
  const tm = e.profesionalId && !t.motor.rol && !t.motor.profesionalesPermitidos.length ? { ...t.motor, profesionalesPermitidos: [e.profesionalId] } : t.motor;
  const { dia, ocupacion } = await diaDe(ctx, e.fecha);
  const minuto = T.minutosDe(e.hora);
  const permitidas = C.salasDelTratamiento(dia, tm).map((s) => s.id);
  e.salaAjena = Boolean(e.salaId && !permitidas.includes(e.salaId));
  let hueco = e.salaId && !e.salaAjena ? C.huecoExacto(dia, tm, minuto, { profesionalId: e.profesionalId, salaId: e.salaId }) : null;
  hueco ||= C.huecoExacto(dia, tm, minuto, { profesionalId: e.profesionalId });
  if (hueco) {
    e.colocacion = { cabe: true, salaId: hueco.salaId, profesionalId: hueco.profesionalId, equipoId: hueco.equipoId, otraSala: Boolean(e.salaId && hueco.salaId !== e.salaId) };
  } else {
    // Donde la tenía Flowww; si no se sabe (o esa cabina no abre), en la primera del tratamiento: la
    // cita tiene que verse en la agenda por cabina para que recepción la vea y la mueva.
    const abierta = (id) => id && dia.salas.some((s) => s.id === id);
    e.colocacion = {
      cabe: false,
      motivo: C.porQueNoCabe(dia, tm, minuto, { profesionalId: e.profesionalId }, ocupacion, ctx.nombres),
      salaId: [e.salaId, ...permitidas, ctx.ref.salasActivas[0]?.id].find(abierta) || e.salaId || ctx.ref.salasActivas[0]?.id || null,
      profesionalId: e.profesionalId || null,
      equipoId: null,
    };
  }
  C.ocupar(dia, ocupacion, tm, minuto, e.colocacion, `otra cita de las ${e.hora} (la fila ${e.fila} de las citas)`);
}

// Cuenta las citas de cada servicio, profesional, cabina o estado de Flowww; lo de casarlo, una vez.
function contar(mapa, k, texto, calcular = () => ({})) {
  const x = mapa.get(k) || mapa.set(k, { texto, citas: 0, ...calcular() }).get(k);
  x.citas++;
  return x;
}

async function planificarCitas(ctx, fichero) {
  const { plan, ref, mapa } = ctx;
  const catalogo = { tratamientos: ref.listaTratamientos, guardado: ref.guardado, mapa: mapa.tratamientos };
  // Casar un servicio con el catálogo (y buscar los parecidos) se hace una vez por servicio.
  const casados = new Map();
  const casar = (servicio) => {
    const k = F.clave(servicio);
    if (!casados.has(k)) casados.set(k, F.casarTratamiento(servicio, catalogo));
    return casados.get(k);
  };
  const filas = fichero.filas.map((f) => leerFilaCita(ctx, f, fichero));
  asignarCodigos(ctx, filas);
  ctx.idsFichero = new Set(filas.map((e) => e.flowwwId).filter(Boolean));
  // La fila que cuenta de cada cita: la viva (la que se traería) o, si no hay, la primera.
  const principal = new Map();
  for (const e of filas.filter((x) => x.inicio)) {
    const p = principal.get(e.flowwwId);
    if (!p || (e.viva && !p.viva)) principal.set(e.flowwwId, e);
  }
  for (const e of filas) {
    if (!e.inicio) { if (e.sinNadie) Object.assign(e, { clase: 'sin_paciente', falta: BLOQUEO }); continue; }
    const p = principal.get(e.flowwwId);
    if (p !== e) {
      // La misma cita dos veces, o su historia en Flowww (la anulada de antes de moverla, con el mismo
      // código): ni se trae ni se compara con lo importado.
      if (e.viva || mismaCita(e, p)) Object.assign(e, { clase: 'repetida', igualA: p.fila });
      else Object.assign(e, { clase: e.inicio <= plan.ahora ? 'pasada' : 'anulada', historia: true });
      continue;
    }
    const casa = e.servicio ? casar(e.servicio) : {};
    e.tratamientoCasado = casa.id || null;
    const antes = emparejar(ctx, e);
    if (antes) {
      // Ya se trajo: no se toca. Si en Flowww ya no es así, a revisar.
      Object.assign(e, { clase: 'ya_importada', citaId: antes.id });
      if (pendiente(antes, plan.ahora)) comprobarImportada(ctx, e, antes);
      continue;
    }
    if (e.inicio <= plan.ahora) { e.clase = 'pasada'; continue; }
    if (e.sinNadie) { Object.assign(e, { clase: 'sin_paciente', falta: BLOQUEO }); continue; }
    if (e.estadoClase === F.IGNORAR) { e.clase = 'anulada'; continue; }
    if (e.errores.length) continue;

    // Servicio, profesional, cabina y estado se miran todos, para que el informe diga de una vez todo
    // lo que falta decidir.
    const s = contar(plan.servicios, F.clave(e.servicio), e.servicio, () => ({ casa, duraciones: new Map() }));
    if (s.casa.ignorar) { e.clase = 'ignorada'; continue; }
    e.tratamientoId = s.casa.id || null;
    if (e.tratamientoId && e.duracion) s.duraciones.set(e.duracion, (s.duraciones.get(e.duracion) || 0) + 1);
    const pr = e.profesional ? contar(plan.profesionales, F.clave(e.profesional), e.profesional,
      () => ({ casa: F.casarProfesional(e.profesional, { profesionales: ref.profesionalesActivos, mapa: mapa.profesionales }) })) : null;
    e.profesionalId = pr?.casa.id || null;
    e.salaId = e.sala ? contar(plan.salas, F.clave(e.sala), e.sala, () => ({ casa: F.casarSala(e.sala, { salas: ref.salasActivas, mapa: mapa.salas }) })).casa.id || null : null;
    if (e.estadoClase !== F.IMPORTAR) contar(plan.estados, F.clave(e.estado), e.estado);
    if (!e.tratamientoId) { e.clase = 'sin_tratamiento'; continue; }
    if (pr && !pr.casa.id && !pr.casa.cualquiera) { e.clase = 'sin_profesional'; continue; }
    if (e.estadoClase !== F.IMPORTAR) { e.clase = 'estado_desconocido'; continue; }

    e.paciente = pacienteDeCita(ctx, e);
    if (e.paciente.falta) { Object.assign(e, { clase: 'sin_paciente', falta: e.paciente.falta }); continue; }
    e.clase = 'futura';
  }
  // Se colocan por orden de hora: si dos chocan, la primera se queda el sitio.
  const futuras = plan.citas.filter((e) => e.clase === 'futura').sort((a, b) => a.inicio - b.inicio || a.fila - b.fila);
  for (const e of futuras) await colocar(ctx, e);
  revisarImportadas(ctx, filas, futuras);
}

// Lo que impide aplicar: columnas que faltan o no están claras, un mapa mal hecho y, en las citas que
// se traen, un servicio, un profesional o un estado de Flowww que no se sabe qué es en la app.
function bloqueos(plan) {
  const salida = [...plan.errores];
  for (const d of plan.dudosas) {
    salida.push(`La columna «${d.columna}» de las citas puede ser el código de la cita o el del cliente: dilo en el mapa `
      + `("citas": { "id": "${d.columna}" } si es el de la cita; "citas": { "paciente_id": "${d.columna}", "id": null } si es el del cliente)`);
  }
  if (plan.codigosNoUnicos.length) {
    const n = plan.codigosNoUnicos.length;
    const col = plan.ficheros.citas.campos.id[0];
    salida.push(`${n === 1 ? 'Un código de cita sale' : `${n} códigos de cita salen`} en citas vivas de días o pacientes distintos: la columna «${col}» no es el código de la cita `
      + `(¿es el del cliente?). Di en el mapa cuál es ("citas": { "id": "…" }, o null si no hay)${col ? ` y, si es el del cliente, "paciente_id": "${col}"` : ''}`);
  }
  if (plan.ficheros.citas?.sinEstado) {
    salida.push('Las citas no traen columna de estado, así que no se sabe cuáles están anuladas. Si la exportación solo trae citas vivas, dilo en el mapa '
      + '("citas": { "estado": null }); si el estado va en otra columna, di cuál ("citas": { "estado": "…" }) y, en «estados», qué valores se traen');
  }
  const sinCasar = (mapa, casado) => [...mapa.values()].filter((x) => !casado(x.casa || {}));
  const servicios = sinCasar(plan.servicios, (c) => c.id || c.ignorar).length;
  const profesionales = sinCasar(plan.profesionales, (c) => c.id || c.cualquiera).length;
  if (servicios) salida.push(`${servicios} ${servicios === 1 ? 'servicio de Flowww no casa' : 'servicios de Flowww no casan'} con ningún tratamiento de la app`);
  if (profesionales) salida.push(`${profesionales} ${profesionales === 1 ? 'profesional de Flowww no casa' : 'profesionales de Flowww no casan'} con nadie de la app`);
  if (plan.estados.size) salida.push(`${plan.estados.size} ${plan.estados.size === 1 ? 'estado de Flowww' : 'estados de Flowww'} sin decidir si se ${plan.estados.size === 1 ? 'trae' : 'traen'}`);
  return salida;
}

function leerFichero(fichero, tipo, mapa, plan) {
  if (!fichero) return null;
  let csv;
  try {
    csv = leerCsv(fichero.contenido);
  } catch (err) {
    if (err instanceof ErrorCsv) throw new ErrorImportacion(`${fichero.nombre}: ${err.message}`);
    throw err;
  }
  const { campos, sinUsar, errores, dudosas } = F.resolverColumnas(csv.cabeceras, tipo, mapa.columnas[tipo]);
  for (const x of errores) plan.errores.push(`${fichero.nombre}: ${x}`);
  plan.dudosas.push(...dudosas);
  return {
    nombre: fichero.nombre, codificacion: csv.codificacion, separador: csv.separador, filas: csv.filas, campos, sinUsar,
    sobran: csv.filas.filter((f) => f.sobran).map((f) => f.fila),
    // Sin columna de estado y sin que el mapa diga que no la hay: no se sabe qué citas están anuladas.
    sinEstado: tipo === 'citas' && !campos.estado.length && !Object.hasOwn(mapa.columnas.citas, 'estado'),
  };
}

// Lee, casa y coloca todo (sin escribir nada). Devuelve el plan (lo que cuenta el informe) y lo que
// hace falta para escribirlo.
async function planificar(con, { pacientes, citas, mapa, ahora, aplicar, sinRecordatorios }) {
  const plan = {
    aplicar, aplicado: false, ahora, lote: null, sinRecordatorios, errores: [], pacientes: [], citas: [],
    servicios: new Map(), profesionales: new Map(), salas: new Map(), estados: new Map(),
    dudosas: [], codigosNoUnicos: [], variosServicios: [], retiradas: [], reaparecidas: [], importadasFuera: 0, rangoCitas: null,
  };
  const m = F.leerMapa(mapa);
  plan.errores.push(...m.errores);
  plan.ficheros = { pacientes: leerFichero(pacientes, 'pacientes', m, plan), citas: leerFichero(citas, 'citas', m, plan) };
  const ref = await cargarReferencias(con);
  comprobarMapa(m, ref, plan.errores);
  const nombreDe = (filas) => (id) => filas.find((x) => x.id === id)?.nombre || null;
  plan.nombres = { tratamiento: (id) => ref.tratamientos.get(id)?.nombre || id, sala: nombreDe(ref.salas), profesional: nombreDe(ref.profesionales) };
  plan.duracionApp = (id) => ref.tratamientos.get(id)?.motor.duracion;
  const ctx = {
    con, plan, ref, mapa: m, dias: new Map(), vinculados: new Set(), emparejadas: new Set(), idsFichero: new Set(),
    indices: { flowww: new Map(), telefono: new Map(), email: new Map(), nombre: new Map() },
    nombres: { ...plan.nombres, rol: (id) => ref.profesionales.find((p) => p.id === id)?.rol },
  };
  if (!plan.errores.length) {
    if (plan.ficheros.pacientes) planificarPacientes(ctx, plan.ficheros.pacientes);
    if (plan.ficheros.citas) await planificarCitas(ctx, plan.ficheros.citas);
    decidirConsentimientos(ctx);
  }
  // Lo que el mapa dice de cada servicio se guarda para la próxima vez (sin mapa).
  plan.mapeos = [...m.tratamientos].filter(([, v]) => v !== F.IGNORAR).map(([k, id]) => ({ clave: `flowww:${k}`.slice(0, 160), id, texto: m.textos.get(`tratamientos:${k}`) }));
  plan.bloqueos = bloqueos(plan);
  return ctx;
}

// ── Escribir ────────────────────────────────────────────────────────────────────────────────
function tituloTarea(inicio, tratamientoId, plan, motivo) {
  const d = T.partesMadrid(inicio);
  return `Cita importada de Flowww para revisar (${d.fecha.slice(8)}/${d.fecha.slice(5, 7)} ${d.hora}, ${plan.nombres.tratamiento(tratamientoId)}): ${motivo}`.slice(0, 200);
}

// La prueba de un consentimiento: de dónde sale (su código de Flowww, el fichero, la fila, la columna y
// lo que decía) y desde cuándo, si Flowww lo sabe. registrado_en es el día de la importación, no el del
// consentimiento: por eso se dice aquí.
function pruebaDe(c, plan, ahora) {
  const quien = c.codigo ? ` (cliente ${c.codigo})` : '';
  const desde = c.desde ? `en Flowww desde el ${c.desde.split('-').reverse().join('/')}` : 'sin fecha en Flowww';
  return `Flowww${quien}, ${plan.ficheros.pacientes.nombre} fila ${c.fila}: «${c.columna}» = «${c.valor}»; ${desde}; importado el ${fechaEs(ahora)}`.slice(0, 500);
}

// Lo que se completa en la ficha de quien ya estaba, si sigue vacío. Para poder deshacerlo (solo si
// sigue siendo lo que se puso), va al lote cifrado: los eventos se guardan en claro.
async function completar(con, e, hecho) {
  const x = e.completar || {};
  if (!e.completarTelefono && !e.completar) return;
  const [[p]] = await con.query('SELECT telefono, apellidos, email, fecha_nacimiento, notas_cifradas, notas_iv, notas_tag FROM pacientes WHERE id = ? FOR UPDATE', [e.pacienteId]);
  const cambios = {};
  const puesto = {};
  if (e.completarTelefono && !p.telefono) cambios.telefono = puesto.telefono = e.completarTelefono;
  if (x.apellidos && !p.apellidos) cambios.apellidos = puesto.apellidos = x.apellidos;
  if (x.email && !p.email) cambios.email = puesto.email = x.email;
  if (x.fechaNacimiento && !p.fecha_nacimiento) cambios.fecha_nacimiento = puesto.fechaNacimiento = x.fechaNacimiento;
  if (x.notas) {
    // Las de Flowww se añaden a las suyas (si no las tiene ya: la segunda importación no las repite).
    let suyas = null;
    let legibles = true;
    try {
      suyas = p.notas_cifradas ? descifrar(p.notas_cifradas, p.notas_iv, p.notas_tag) : null;
    } catch {
      legibles = false;
      e.notasIlegibles = true;
    }
    if (legibles && !(suyas || '').includes(x.notas)) {
      const n = cifrar(suyas ? `${suyas}\n\nObservaciones de Flowww: ${x.notas}` : x.notas);
      Object.assign(cambios, { notas_cifradas: n.cifrado, notas_iv: n.iv, notas_tag: n.tag });
      puesto.notas = { tag: b64(n.tag), antes: p.notas_cifradas ? { cifrado: b64(p.notas_cifradas), iv: b64(p.notas_iv), tag: b64(p.notas_tag) } : null };
    }
  }
  if (!Object.keys(cambios).length) return;
  await con.query('UPDATE pacientes SET ? WHERE id = ?', [cambios, e.pacienteId]);
  const c = cifrar(JSON.stringify(puesto));
  hecho.completados.push({ id: e.pacienteId, campos: Object.keys(puesto), cifrado: b64(c.cifrado), iv: b64(c.iv), tag: b64(c.tag) });
}

// El marketing de un paciente (decidirConsentimientos) y su baja comercial. Un «no» a WhatsApp es una
// baja comercial, como la que se pide por WhatsApp (ni secuencias ni la excepción de «cliente con
// servicio similar»): en su ficha y, como todas, en la lista por teléfono (servidor/bajas.js). Lo que
// tuviera en marcha lo paran las comprobaciones de siempre (el permiso comercial) cuando vaya a salir.
async function registrarMarketing(con, e, { plan, hecho, ahora, segundo, actor }) {
  for (const c of e.marketing || []) {
    if (c.accion !== 'otorgar' && c.accion !== 'revocar') continue;
    const estado = c.otorgado ? 'otorgado' : 'revocado';
    const [r] = await con.query(
      "INSERT INTO consentimientos (paciente_id, tipo, estado, fuente, prueba, registrado_en, registrado_por) VALUES (?, ?, ?, 'importacion', ?, ?, ?)",
      [e.pacienteId, c.tipo, estado, pruebaDe(c, plan, ahora), ahora, actor]);
    hecho.consentimientos.push({ id: r.insertId, estado });
  }
  const noWhatsApp = (e.marketing || []).some((c) => c.tipo === 'whatsapp_marketing' && !c.otorgado);
  if (!noWhatsApp && !e.bajaDeLista) return;
  const [b] = await con.query('UPDATE pacientes SET baja_comercial_en = ? WHERE id = ? AND baja_comercial_en IS NULL', [segundo, e.pacienteId]);
  if (b.affectedRows) hecho.bajas.push(e.pacienteId);
  if (!noWhatsApp) return;
  const [[p]] = await con.query('SELECT telefono, EXISTS (SELECT 1 FROM bajas_comerciales b WHERE b.telefono = pacientes.telefono) AS enLista FROM pacientes WHERE id = ?', [e.pacienteId]);
  if (p.telefono && !Number(p.enLista)) {
    await apuntarBaja(con, { telefono: p.telefono, fuente: 'flowww', pacienteId: e.pacienteId, ahora: segundo });
    hecho.listaBajas.push(e.pacienteId);
  }
}

async function escribir(con, ctx, { ahora, actor, sinRecordatorios }) {
  const { plan, ref } = ctx;
  const hecho = {
    pacientesNuevos: [], vinculados: [], completados: [], consentimientos: [], bajas: [], listaBajas: [], citas: [], revisar: [], retiradas: [], tareas: [],
    inscripciones: [], mapeos: [],
  };
  const segundo = aSegundos(ahora);
  const tarea = async (titulo, pacienteId, inicio) => (await con.query("INSERT INTO tareas (tipo, titulo, paciente_id, urgente, vence_en) VALUES ('otro', ?, ?, ?, ?)",
    [titulo, pacienteId, inicio - ahora < 48 * 3600000, new Date(Math.min(ahora.getTime() + 86400000, inicio.getTime()))]))[0].insertId;
  for (const e of plan.pacientes) {
    if (e.accion === 'nuevo') {
      const n = cifrar(e.notas);
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
      await completar(con, e, hecho);
    }
  }
  for (const e of plan.pacientes.filter((x) => ['nuevo', 'existente'].includes(x.accion))) await registrarMarketing(con, e, { plan, hecho, ahora, segundo, actor });

  const conCita = new Set();
  for (const e of plan.citas.filter((x) => x.clase === 'futura')) {
    const t = ref.tratamientos.get(e.tratamientoId);
    const col = e.colocacion;
    const revisar = col.cabe ? e.revisar || null : col.motivo;
    const pacienteId = e.paciente.entrada ? e.paciente.entrada.pacienteId : e.paciente.bd.id;
    const inst = huecoAInstantes(e.fecha, { inicio: T.minutosDe(e.hora) }, t.motor);
    const notas = cifrar(e.notas);
    // La confirmación ya se la dio Flowww (aviso_confirmacion_en): no se le repite. Los recordatorios,
    // salvo --sin-recordatorios.
    const [r] = await con.query('INSERT INTO citas SET ?', [{
      paciente_id: pacienteId, tratamiento_id: e.tratamientoId, profesional_id: col.profesionalId, sala_id: col.salaId, equipo_id: col.equipoId,
      inicio: inst.inicio, fin: inst.fin, sala_desde: inst.sala_desde, sala_hasta: inst.sala_hasta, prof_desde: inst.prof_desde, prof_hasta: inst.prof_hasta,
      estado: 'confirmada', origen: 'importacion', flowww_id: e.flowwwId, revisar_motivo: revisar?.slice(0, 255) || null, recordatorios: !sinRecordatorios,
      notas_cifradas: notas.cifrado, notas_iv: notas.iv, notas_tag: notas.tag,
      creada_por: actor, confirmada_en: ahora, aviso_confirmacion_en: ahora, creado_en: ahora, ...columnasEnlace(inst.fin),
    }]);
    e.citaId = r.insertId;
    hecho.citas.push(r.insertId);
    conCita.add(pacienteId);
    await registrar(con, {
      tipo: 'cita_importada', entidad: 'cita', entidadId: r.insertId, actor,
      datos: { lote: plan.lote, fecha: e.fecha, hora: e.hora, tratamiento: e.tratamientoId, profesional: col.profesionalId, sala: col.salaId, ...(revisar ? { revisar } : {}) },
    });
    if (revisar) {
      hecho.revisar.push(r.insertId);
      hecho.tareas.push({ id: await tarea(tituloTarea(e.inicio, e.tratamientoId, plan, revisar), pacienteId, e.inicio), cita: r.insertId });
    }
  }
  // Lo importado antes que en Flowww ya no es así: sin recordatorios hasta que recepción lo revise.
  for (const x of plan.retiradas.filter((y) => !y.yaAvisada)) {
    const c = x.cita;
    const [u] = await con.query("UPDATE citas SET recordatorios = FALSE, revisar_motivo = ? WHERE id = ? AND estado = 'confirmada'", [x.motivo, c.id]);
    if (!u.affectedRows) continue;
    hecho.retiradas.push({ id: c.id, recordatorios: Boolean(c.recordatorios), motivo: c.revisar_motivo || null, puesto: x.motivo });
    await registrar(con, { tipo: 'cita_importada_revisar', entidad: 'cita', entidadId: c.id, actor, datos: { lote: plan.lote, tipo: x.tipo } });
    const inicio = new Date(c.inicio);
    if (!x.sinTarea) hecho.tareas.push({ id: await tarea(tituloTarea(inicio, c.tratamiento_id, plan, x.motivo), c.paciente_id, inicio), cita: c.id });
  }
  // Con cita, se acaban sus secuencias de captación, como al reservar: las suyas y las de los leads
  // con su teléfono (una persona con cita no es un lead al que perseguir).
  for (const pacienteId of conCita) {
    const [ins] = await con.query(
      `SELECT id, estado FROM inscripciones WHERE estado IN ('activa','pausada') AND secuencia IN (?)
          AND (paciente_id = ? OR lead_id IN (SELECT l.id FROM leads l JOIN pacientes p ON p.id = ?
                                               WHERE l.paciente_id = p.id OR (p.telefono IS NOT NULL AND l.telefono = p.telefono))) FOR UPDATE`,
      [SECUENCIAS_CAPTACION, pacienteId, pacienteId]);
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

// Cómo están las citas, los pacientes y sus oposiciones: si alguien da una cita (o un paciente), cambia
// una o registra una baja o un consentimiento, cambia.
async function huellaAgenda(con) {
  const [[r]] = await con.query(
    `SELECT (SELECT CONCAT(COUNT(*), '|', COALESCE(MAX(id), 0), '|', COALESCE(MAX(actualizado_en), '')) FROM citas) AS citas,
            (SELECT CONCAT(COUNT(*), '|', COALESCE(MAX(id), 0), '|', COALESCE(MAX(actualizado_en), '')) FROM pacientes) AS pacientes,
            (SELECT CONCAT(COUNT(*), '|', COALESCE(MAX(id), 0)) FROM consentimientos) AS consentimientos,
            (SELECT CONCAT(COUNT(*), '|', COALESCE(MAX(creado_en), '')) FROM bajas_comerciales) AS bajas`);
  return `${r.citas}/${r.pacientes}/${r.consentimientos}/${r.bajas}`;
}

/**
 * Importa (o ensaya) los ficheros de Flowww.
 * @param {object} o pacientes, citas: { nombre, contenido: Buffer } (al menos uno); mapa (el JSON ya
 *   leído, o null); aplicar; sinRecordatorios; ahora; actor; claveDeDesarrollo (aplicar con la clave de
 *   desarrollo: solo en las pruebas); trasPlanificar (para las pruebas: lo que pasa en la app mientras
 *   se planifica)
 * @returns {{ plan, aplicado, lote, informe }}
 */
async function importar(pool, {
  pacientes = null, citas = null, mapa = null, aplicar = false, sinRecordatorios = false, ahora = new Date(), actor = ACTOR,
  claveDeDesarrollo = enPruebas(), trasPlanificar = null,
} = {}) {
  if (!pacientes && !citas) throw new ErrorImportacion('Hace falta el fichero de pacientes, el de citas o los dos');
  if (aplicar && !tieneClave() && !claveDeDesarrollo) throw new ErrorImportacion(SIN_CLAVE);
  const datos = { pacientes, citas, mapa, ahora, aplicar, sinRecordatorios };
  const con = await pool.getConnection();
  try {
    await con.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await con.beginTransaction();
    const antes = await huellaAgenda(con);
    let ctx = await planificar(con, datos);
    if (trasPlanificar) await trasPlanificar();
    if (aplicar && !ctx.plan.bloqueos.length) {
      // Planificar lleva su rato y se hace sin bloquear la agenda. Para escribir, sí: como una reserva (y
      // en el mismo orden que agenda.reservar, para no interbloquearse), nadie puede dar otra cita en
      // esas cabinas, con esos profesionales o aparatos. Si mientras se planificaba alguien ha dado o
      // cambiado una cita (o un paciente), se vuelve a planificar, ya con todo bloqueado.
      await con.query('SELECT id FROM salas ORDER BY id FOR UPDATE');
      await con.query('SELECT id FROM profesionales ORDER BY id FOR UPDATE');
      await con.query('SELECT id FROM equipos ORDER BY id FOR UPDATE');
      if (await huellaAgenda(con) !== antes) ctx = await planificar(con, datos);
    }
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
// ¿Tiene algo en la app, aparte de lo que le puso la importación (sus consentimientos)?
async function tieneActividad(con, pacienteId, consentimientosDelLote) {
  const suyos = consentimientosDelLote.length ? consentimientosDelLote : [0];
  const [[r]] = await con.query(`SELECT ${TABLAS_DEL_PACIENTE.map((t) => `EXISTS (SELECT 1 FROM ${t} WHERE paciente_id = ?${t === 'consentimientos' ? ' AND id NOT IN (?)' : ''})`).join(' OR ')} AS hay`,
    TABLAS_DEL_PACIENTE.flatMap((t) => (t === 'consentimientos' ? [pacienteId, suyos] : [pacienteId])));
  return Boolean(Number(r.hay));
}

// Lo que se completó en su ficha vuelve a estar vacío, si sigue siendo lo que se puso.
async function vaciarCompletado(con, v) {
  const puesto = JSON.parse(descifrar(deB64(v.cifrado), deB64(v.iv), deB64(v.tag)));
  const [[p]] = await con.query('SELECT telefono, apellidos, email, fecha_nacimiento, notas_tag FROM pacientes WHERE id = ? FOR UPDATE', [v.id]);
  if (!p) return false;
  const cambios = {};
  if (puesto.telefono && p.telefono === puesto.telefono) cambios.telefono = null;
  if (puesto.apellidos && p.apellidos === puesto.apellidos) cambios.apellidos = null;
  if (puesto.email && p.email === puesto.email) cambios.email = null;
  if (puesto.fechaNacimiento && p.fecha_nacimiento && new Date(p.fecha_nacimiento).toISOString().slice(0, 10) === puesto.fechaNacimiento) cambios.fecha_nacimiento = null;
  if (puesto.notas && b64(p.notas_tag) === puesto.notas.tag) {
    const a = puesto.notas.antes;
    Object.assign(cambios, { notas_cifradas: deB64(a?.cifrado), notas_iv: deB64(a?.iv), notas_tag: deB64(a?.tag) });
  }
  if (!Object.keys(cambios).length) return false;
  await con.query('UPDATE pacientes SET ? WHERE id = ?', [cambios, v.id]);
  return true;
}

/**
 * Quita lo que metió una importación (la última sin deshacer, o la del lote que se diga) y nadie ha
 * tocado: sus citas que siguen «confirmadas» sin que se le haya avisado al paciente (las que ya
 * cambiaron de estado o tienen recordatorio se quedan) y sus tareas abiertas, los «sí» a la publicidad
 * que registró, el código de Flowww y lo que completó en la ficha de quien ya estaba, los pacientes
 * nuevos que no tengan nada más en la app, lo que guardó del mapa y las secuencias que paró (salvo a
 * quien tenga una cita por delante); y a las ya importadas que dejó sin recordatorios, se los devuelve.
 * Las oposiciones se quedan: los «no» y las bajas comerciales (la lista de bajas, por teléfono, aunque
 * se quite al paciente). Sin aplicar, lo hace en una transacción que deshace al final: cuenta lo que
 * haría sin cambiar nada.
 */
async function deshacer(pool, { lote = null, aplicar = false, ahora = new Date(), actor = ACTOR, claveDeDesarrollo = enPruebas() } = {}) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [evs] = await con.query("SELECT entidad_id, datos FROM eventos WHERE tipo = 'importacion_flowww' ORDER BY id DESC");
    const [hechos] = await con.query("SELECT entidad_id FROM eventos WHERE tipo = 'importacion_flowww_deshecha'");
    const deshechos = new Set(hechos.map((h) => h.entidad_id));
    const ev = lote ? evs.find((x) => x.entidad_id === lote) : evs.find((x) => !deshechos.has(x.entidad_id));
    if (!ev) throw new ErrorImportacion(lote ? `No hay ninguna importación de Flowww «${lote}»` : 'No hay ninguna importación de Flowww que deshacer');
    if (deshechos.has(ev.entidad_id)) throw new ErrorImportacion(`La importación ${ev.entidad_id} ya se deshizo`);
    const d = {
      pacientesNuevos: [], vinculados: [], completados: [], consentimientos: [], bajas: [], listaBajas: [], citas: [], retiradas: [], tareas: [], inscripciones: [], mapeos: [],
      ...parsear(ev.datos),
    };
    // Lo que se completó en las fichas va cifrado: sin la clave de la app no se puede comprobar.
    if (d.completados.length && !tieneClave() && !claveDeDesarrollo) {
      throw new ErrorImportacion('Para deshacer esta importación hace falta la CLAVE_CIFRADO de la app en el .env: lo que completó en las fichas se guardó cifrado con ella. No se ha cambiado nada.');
    }
    const r = {
      lote: ev.entidad_id, aplicado: aplicar, citasQuitadas: 0, citasQuedan: [], pacientesQuitados: 0, pacientesQuedan: [], vinculados: 0, completados: 0,
      consentimientos: 0, oposiciones: d.consentimientos.filter((c) => c.estado === 'revocado').length, bajas: d.bajas.length, tareas: 0, retiradas: 0, mapeos: 0, secuencias: 0,
    };
    // Se quedan las citas que ya han cambiado de estado y las que ya se le han avisado al paciente (va
    // a venir): con su tarea, si tenían.
    const [citas] = d.citas.length ? await con.query('SELECT id, estado, paciente_id, aviso_24h_en, aviso_2h_en FROM citas WHERE id IN (?) FOR UPDATE', [d.citas]) : [[]];
    const avisada = (c) => Boolean(c.aviso_24h_en || c.aviso_2h_en);
    const quitar = citas.filter((c) => c.estado === 'confirmada' && !avisada(c)).map((c) => c.id);
    const quedan = citas.filter((c) => !quitar.includes(c.id));
    r.citasQuedan = quedan.map((c) => ({ id: c.id, estado: c.estado === 'confirmada' ? 'avisada' : c.estado }));
    const hechas = async (sql, p) => (await con.query(sql, p))[0].affectedRows;
    if (quitar.length) r.citasQuitadas = await hechas('DELETE FROM citas WHERE id IN (?)', [quitar]);
    // Las ya importadas que dejó sin recordatorios los recuperan, si nadie las ha tocado desde entonces.
    const devueltas = [];
    for (const x of d.retiradas) {
      const n = await hechas("UPDATE citas SET recordatorios = ?, revisar_motivo = ? WHERE id = ? AND estado = 'confirmada' AND recordatorios = FALSE AND revisar_motivo = ?",
        [x.recordatorios, x.motivo, x.id, x.puesto]);
      if (n) devueltas.push(x.id);
      r.retiradas += n;
    }
    // Sus tareas abiertas: las de las citas que se quitan (también las que puso otra importación, que
    // hablan de una cita que ya no existe) y las de las que recuperan sus recordatorios.
    const deOtros = evs.filter((x) => x.entidad_id !== ev.entidad_id).flatMap((x) => parsear(x.datos).tareas || []);
    const tareas = [...d.tareas.filter((t) => devueltas.includes(t.cita)), ...[...d.tareas, ...deOtros].filter((t) => quitar.includes(t.cita))].map((t) => t.id);
    if (tareas.length) r.tareas = await hechas("DELETE FROM tareas WHERE id IN (?) AND estado = 'abierta'", [tareas]);
    // La secuencia que paró su cita vuelve, salvo que el paciente tenga otra cita por delante o le quede
    // una de las importadas.
    const conCita = new Set(quedan.map((c) => c.paciente_id));
    for (const i of d.inscripciones.filter((x) => !conCita.has(x.paciente))) {
      const [[otra]] = await con.query("SELECT id FROM citas WHERE paciente_id = ? AND inicio > ? AND estado IN ('retenida','confirmada') LIMIT 1", [i.paciente, ahora]);
      if (otra) continue;
      r.secuencias += await hechas("UPDATE inscripciones SET estado = ?, motivo_fin = NULL WHERE id = ? AND estado = 'terminada' AND motivo_fin = 'cita'", [i.estado, i.id]);
    }
    // Los «sí» se quitan; los «no» y las bajas, no: una oposición no se olvida al deshacer.
    const otorgados = d.consentimientos.filter((c) => c.estado === 'otorgado').map((c) => c.id);
    if (otorgados.length) r.consentimientos = await hechas('DELETE FROM consentimientos WHERE id IN (?)', [otorgados]);
    for (const v of d.vinculados) r.vinculados += await hechas('UPDATE pacientes SET flowww_id = NULL WHERE id = ? AND flowww_id = ?', [v.id, v.flowwwId]);
    for (const v of d.completados) if (await vaciarCompletado(con, v)) r.completados++;
    // Un paciente nuevo se quita si no tiene nada más que lo que le puso la importación. Si tenía la
    // baja, su teléfono se queda en la lista de bajas (sin el número de paciente, que ya no existe).
    const delLote = d.consentimientos.map((c) => c.id);
    for (const id of d.pacientesNuevos) {
      let borrado = false;
      if (!(await tieneActividad(con, id, delLote))) {
        try {
          borrado = (await hechas('DELETE FROM pacientes WHERE id = ?', [id])) > 0;
        } catch (err) {
          if (err.errno !== 1451) throw err; // lo usa otra tabla: se queda
        }
      }
      if (borrado) {
        r.pacientesQuitados++;
        await con.query('UPDATE bajas_comerciales SET paciente_id = NULL WHERE paciente_id = ?', [id]);
      } else r.pacientesQuedan.push(id);
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
// Las ya importadas que una importación posterior dejó sin recordatorios porque en Flowww ya no son así
// (y no se ha deshecho): se revisan una a una.
async function retiradasVigentes(q) {
  const [evs] = await q.query("SELECT entidad_id, datos FROM eventos WHERE tipo = 'importacion_flowww'");
  const [hechos] = await q.query("SELECT entidad_id FROM eventos WHERE tipo = 'importacion_flowww_deshecha'");
  const deshechos = new Set(hechos.map((h) => h.entidad_id));
  return evs.filter((e) => !deshechos.has(e.entidad_id)).flatMap((e) => (parsear(e.datos).retiradas || []).map((x) => x.id));
}

/**
 * Pone (o quita) los recordatorios de víspera y 2 horas a las citas futuras que se trajeron de
 * Flowww: p. ej., se importaron con --sin-recordatorios mientras Flowww seguía mandando los suyos, y ya
 * se ha apagado. A todas salvo a las que están a revisar porque en Flowww ya no son así (esas, de una en
 * una: `cita`, cuando recepción vea que siguen en pie). Sin aplicar, solo cuenta.
 */
async function cambiarRecordatorios(pool, { activar, cita = null, aplicar = false, ahora = new Date(), actor = ACTOR }) {
  let donde = "origen = 'importacion' AND flowww_id IS NOT NULL AND estado IN ('retenida','confirmada') AND inicio > ? AND recordatorios = ?";
  const p = [ahora, !activar];
  let aRevisar = 0;
  if (cita) {
    donde += ' AND id = ?';
    p.push(cita);
  } else if (activar) {
    const retiradas = await retiradasVigentes(pool);
    if (retiradas.length) {
      const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM citas WHERE ${donde} AND id IN (?)`, [...p, retiradas]);
      aRevisar = Number(n.n);
      donde += ' AND id NOT IN (?)';
      p.push(retiradas);
    }
  }
  const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM citas WHERE ${donde}`, p);
  const citas = Number(n.n);
  const una = citas === 1;
  const cuantas = cita ? `la cita ${cita}` : `${citas} ${una ? 'cita futura importada' : 'citas futuras importadas'} de Flowww`;
  const revisar = aRevisar ? ` Otras ${aRevisar} siguen sin ellos porque están a revisar (en Flowww ya no son así): cuando recepción vea que alguna sigue en pie, --recordatorios si --cita <número>.` : '';
  if (!citas) {
    const nada = cita ? `La cita ${cita} no es una cita futura importada de Flowww ${activar ? 'sin' : 'con'} recordatorios` : `No hay citas futuras importadas de Flowww ${activar ? 'sin' : 'con'} recordatorios`;
    return { citas, aplicado: false, informe: `${nada}: no hay nada que cambiar.${revisar}` };
  }
  if (!aplicar) {
    const que = activar ? `${una ? 'pasaría' : 'pasarían'} a tener` : `se ${una ? 'quedaría' : 'quedarían'} sin`;
    return { citas, aplicado: false, informe: `Ensayo: ${cuantas} ${que} recordatorios de víspera y 2 horas.${revisar} Para hacerlo, lo mismo con --aplicar.` };
  }
  await pool.query(`UPDATE citas SET recordatorios = ? WHERE ${donde}`, [activar, ...p]);
  await registrar(pool, { tipo: activar ? 'importacion_flowww_con_recordatorios' : 'importacion_flowww_sin_recordatorios', entidad: 'importacion', actor, datos: { citas, ...(cita ? { cita } : {}) } });
  const ahoraTiene = activar ? `ya ${una ? 'tiene' : 'tienen'}` : `ya no ${una ? 'tiene' : 'tienen'}`;
  return { citas, aplicado: true, informe: `Hecho: ${cuantas} ${ahoraTiene} recordatorios de víspera y 2 horas.${revisar}` };
}

module.exports = { importar, deshacer, cambiarRecordatorios, ErrorImportacion, ACTOR, columnasEnlace };
