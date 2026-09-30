'use strict';
// El informe de la importación de Flowww, para quien la lanza: lo que se ha leído, lo que se va a
// hacer (o se ha hecho) y lo que falta decidir. Sin nombres, teléfonos ni emails de pacientes (se
// puede pegar en un correo o en una incidencia): cada cosa va por su fila del CSV, su código de Flowww
// y su número en la app.
const T = require('../tiempo');

const MAX = 200; // líneas de detalle por apartado
const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const SEPARADOR = { ';': '«;»', ',': '«,»', '\t': 'tabulador' };
const CAMPO = {
  id: 'código', nombre: 'nombre', apellidos: 'apellidos', telefono: 'teléfono', email: 'email', fecha_nacimiento: 'nacimiento',
  observaciones: 'observaciones', marketing: 'marketing', marketing_whatsapp: 'marketing por WhatsApp', marketing_email: 'marketing por email',
  paciente_id: 'código del cliente', paciente: 'cliente', fecha: 'fecha', hora: 'hora', hora_fin: 'hora de fin', duracion: 'duración',
  servicio: 'servicio', profesional: 'profesional', sala: 'cabina', estado: 'estado',
};
const VIA = { mapa: 'del mapa', guardado: 'guardado en otra importación', nombre: 'mismo nombre', alias: 'por un alias', 'nombre parcial': 'por parte del nombre' };

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const porciento = (x) => `${Math.round(x * 100)} %`;

// «jue 15/10/2026 11:00», en hora de Madrid.
function cuando(instante) {
  const p = T.partesMadrid(new Date(instante));
  return `${DIAS[p.diaSemana - 1]} ${p.fecha.slice(8)}/${p.fecha.slice(5, 7)}/${p.fecha.slice(0, 4)} ${p.hora}`;
}

function nuevoTexto() {
  const l = [];
  const t = {
    l,
    linea: (texto = '', sangria = 0) => l.push(texto ? `${'  '.repeat(sangria)}${texto}` : ''),
    detalle: (filas, sangria = 3) => {
      for (const f of filas.slice(0, MAX)) t.linea(f, sangria);
      if (filas.length > MAX) t.linea(`… y ${filas.length - MAX} más`, sangria);
    },
  };
  return t;
}

function fichero(t, titulo, f) {
  t.linea();
  t.linea(`${titulo} · ${f.nombre} (${f.codificacion}, separador ${SEPARADOR[f.separador] || `«${f.separador}»`}, ${plural(f.filas.length, 'fila', 'filas')})`);
  const usadas = Object.entries(f.campos).filter(([, cols]) => cols.length).map(([campo, cols]) => `${CAMPO[campo] || campo} ← ${cols.map((c) => `«${c}»`).join(' + ')}`);
  t.linea(`Columnas: ${usadas.join(' · ')}`, 1);
  if (f.sinUsar.length) t.linea(`No se traen: ${f.sinUsar.map((c) => `«${c}»`).join(', ')}`, 1);
  if (f.sobran.length) t.linea(`Filas con más columnas que la cabecera (lo que sobra no se lee): ${f.sobran.slice(0, 20).join(', ')}${f.sobran.length > 20 ? '…' : ''}`, 1);
}

const quien = (e) => `fila ${e.fila}${e.sinCodigo ? '' : ` (Flowww ${e.flowwwId})`}`;

function pacientes(t, plan) {
  const lista = plan.pacientes;
  const de = (accion, origen = null) => lista.filter((e) => e.accion === accion && (!origen || e.origen === origen));
  fichero(t, 'PACIENTES', plan.ficheros.pacientes);
  const desdeFichero = lista.filter((e) => e.origen === 'pacientes');
  if (!plan.ficheros.pacientes.campos.id.length) t.linea('Sin código de cliente: cada paciente se reconoce por sus datos. Mejor pedir a Flowww la columna del código.', 1);
  t.linea(`→ ${plural(de('nuevo', 'pacientes').length, 'nuevo', 'nuevos')}`, 1);
  const existentes = de('existente', 'pacientes');
  const yaImportados = existentes.filter((e) => e.via === 'código').length;
  if (yaImportados) t.linea(`→ ${plural(yaImportados, 'ya importado', 'ya importados')} antes (mismo código de Flowww): no se ${yaImportados === 1 ? 'toca' : 'tocan'}`, 1);
  const enLaApp = existentes.filter((e) => e.via !== 'código');
  if (enLaApp.length) {
    t.linea(`→ ${plural(enLaApp.length, 'ya estaba', 'ya estaban')} en la app: se ${enLaApp.length === 1 ? 'le' : 'les'} apunta su código de Flowww y lo demás no se toca`, 1);
    t.detalle(enLaApp.map((e) => `${quien(e)} → paciente ${e.pacienteId} de la app, por ${e.via}${e.vincular ? '' : ' (ya tenía otro código de Flowww: se queda el suyo)'}`
      + `${e.completarTelefono ? '; no tenía teléfono: se le pone el de Flowww' : ''}`));
  }
  const repetidos = de('repetido', 'pacientes');
  if (repetidos.length) {
    t.linea(`→ ${plural(repetidos.length, 'repetido', 'repetidos')} en el fichero: se trae una vez`, 1);
    t.detalle(repetidos.map((e) => `${quien(e)} → es la fila ${e.igualA.fila}${e.igualA.origen === 'citas' ? ' de las citas' : ''}, por ${e.via}`));
  }
  const compartidos = desdeFichero.filter((e) => e.compartido);
  if (compartidos.length) {
    t.linea(`→ ${plural(compartidos.length, 'tiene', 'tienen')} el teléfono de otra persona (otro nombre): se ${compartidos.length === 1 ? 'trae' : 'traen'} sin teléfono`, 1);
    t.detalle(compartidos.map((e) => `${quien(e)}: el teléfono ya es ${e.compartido}`));
  }
  const errores = de('error', 'pacientes');
  if (errores.length) {
    t.linea(`→ ${plural(errores.length, 'no se trae', 'no se traen')}:`, 1);
    t.detalle(errores.map((e) => `${quien(e)}: ${e.errores.join('; ')}`));
  }
  const avisos = desdeFichero.filter((e) => e.accion !== 'error' && e.avisos.length);
  if (avisos.length) {
    t.linea('Avisos:', 1);
    t.detalle(avisos.map((e) => `${quien(e)}: ${e.avisos.join('; ')}`));
  }
  // Consentimiento de marketing: solo lo que dice una columna.
  const raices = desdeFichero.filter((e) => ['nuevo', 'existente'].includes(e.accion));
  const si = raices.filter((e) => e.consentimientos.some((c) => c.otorgado && !c.yaTenia)).length;
  const no = raices.filter((e) => e.consentimientos.some((c) => !c.otorgado && !c.yaTenia)).length;
  const yaTenian = raices.filter((e) => e.consentimientos.some((c) => c.yaTenia)).length;
  const nada = raices.filter((e) => !e.consentimientos.length).length;
  t.linea(`Marketing: ${[
    si && `${si} con «sí» en una columna (se registra su consentimiento)`,
    no && `${no} con «no» (se registra que no y, si es a WhatsApp, la baja comercial)`,
    yaTenian && `${yaTenian} ya ${yaTenian === 1 ? 'tenía' : 'tenían'} uno en la app (se respeta)`,
    `${nada} sin nada: importar no da consentimiento`,
  ].filter(Boolean).join('; ')}`, 1);
}

function citas(t, plan) {
  const lista = plan.citas;
  const de = (...clases) => lista.filter((e) => clases.includes(e.clase));
  fichero(t, 'CITAS', plan.ficheros.citas);
  if (!plan.ficheros.citas.campos.id.length) {
    t.linea('Sin código de cita: si una cita cambia en Flowww entre dos importaciones, no se reconoce como la misma. Mejor pedir la columna del código.', 1);
  }
  const pasadas = de('pasada').length;
  const anuladas = de('anulada').length;
  if (pasadas || anuladas) t.linea(`→ ${[pasadas && plural(pasadas, 'pasada', 'pasadas'), anuladas && plural(anuladas, 'anulada', 'anuladas')].filter(Boolean).join(' y ')}: no se traen`, 1);
  const bloqueos = de('sin_paciente').filter((e) => e.falta === 'es un bloqueo o una nota de agenda').length;
  if (bloqueos) t.linea(`→ ${plural(bloqueos, 'bloqueo o nota de agenda', 'bloqueos o notas de agenda')} (sin paciente): no se ${bloqueos === 1 ? 'trae' : 'traen'}`, 1);
  const ignoradas = de('ignorada').length;
  if (ignoradas) t.linea(`→ ${plural(ignoradas, 'cita', 'citas')} de servicios que el mapa manda ignorar: no se ${ignoradas === 1 ? 'trae' : 'traen'}`, 1);
  const repetidas = de('repetida');
  if (repetidas.length) t.linea(`→ ${plural(repetidas.length, 'fila repetida', 'filas repetidas')} (la misma cita dos veces): ${repetidas.map((e) => e.fila).join(', ')}`, 1);
  const ya = de('ya_importada');
  if (ya.length) {
    t.linea(`→ ${plural(ya.length, 'ya importada', 'ya importadas')} antes: no se ${ya.length === 1 ? 'toca' : 'tocan'}`, 1);
    t.detalle(ya.filter((e) => e.cambiada || e.anuladaEnFlowww).map((e) => `${quien(e)}: en Flowww ${e.anuladaEnFlowww ? 'está anulada' : `ha cambiado de hora (ahora, ${cuando(e.inicio)})`}; revisar la cita ${e.citaId} de la app`));
  }
  const futuras = de('futura');
  t.linea(`→ ${plural(futuras.length, 'futura que se trae', 'futuras que se traen')}${futuras.length ? ':' : ''}`, 1);
  if (futuras.length) {
    const cita = (e) => `fila ${e.fila} · ${cuando(e.inicio)} · ${plan.nombres.tratamiento(e.tratamientoId)}`;
    const caben = futuras.filter((e) => e.colocacion.cabe);
    const otraSala = caben.filter((e) => e.colocacion.otraSala);
    const noCaben = futuras.filter((e) => !e.colocacion.cabe);
    t.linea(`${plural(caben.length - otraSala.length, 'cabe', 'caben')} en la agenda tal cual`, 2);
    if (otraSala.length) {
      t.linea(`${plural(otraSala.length, 'cabe', 'caben')} en otra cabina:`, 2);
      t.detalle(otraSala.map((e) => `${cita(e)}: en Flowww, «${e.sala}»${e.salaAjena ? ', que no es de este tratamiento' : ', ocupada'} → ${plan.nombres.sala(e.colocacion.salaId)}`));
    }
    if (noCaben.length) {
      t.linea(`${plural(noCaben.length, 'no cabe', 'no caben')}: se ${noCaben.length === 1 ? 'trae' : 'traen'} igual, para revisar, con su tarea en el panel:`, 2);
      t.detalle(noCaben.map((e) => `${cita(e)}: ${e.colocacion.motivo}`));
    }
  }
  const fuera = [...de('error'), ...de('sin_paciente').filter((e) => e.falta !== 'es un bloqueo o una nota de agenda')];
  if (fuera.length) {
    t.linea(`→ ${plural(fuera.length, 'no se trae', 'no se traen')}:`, 1);
    t.detalle(fuera.sort((a, b) => a.fila - b.fila).map((e) => `fila ${e.fila}: ${e.clase === 'error' ? e.errores.join('; ') : e.falta}`));
  }
  const pendientes = [
    [de('sin_tratamiento').length, 'de un servicio que no casa', 'de servicios que no casan'],
    [de('sin_profesional').length, 'de un profesional que no casa', 'de profesionales que no casan'],
    [de('estado_desconocido').length, 'con un estado sin decidir', 'con estados sin decidir'],
  ].filter(([n]) => n).map(([n, uno, varios]) => `${plural(n, 'cita', 'citas')} ${n === 1 ? uno : varios}`);
  if (pendientes.length) t.linea(`→ Por decidir (abajo): ${pendientes.join('; ')}`, 1);
}

function sugerencias(casa) {
  return (casa.sugerencias || []).map((s) => `«${s.nombre}» (${s.codigo || s.id}) ${porciento(s.parecido)}`).join(', ');
}

function casamientos(t, plan) {
  const apartado = (titulo, mapa, destino, { libre = null } = {}) => {
    if (!mapa.size) return;
    t.linea();
    t.linea(titulo);
    for (const x of [...mapa.values()].sort((a, b) => b.citas - a.citas || a.texto.localeCompare(b.texto, 'es'))) {
      const n = plural(x.citas, 'cita', 'citas');
      if (x.casa.id) t.linea(`«${x.texto}» → ${destino(x.casa.id)} (${VIA[x.casa.via] || x.casa.via}) · ${n}`, 1);
      else if (x.casa.ignorar) t.linea(`«${x.texto}»: no se trae (el mapa lo ignora) · ${n}`, 1);
      else if (x.casa.cualquiera) t.linea(`«${x.texto}» → lo elige la agenda (del mapa) · ${n}`, 1);
      else if (libre) t.linea(`«${x.texto}» · ${n}: no casa, ${libre}${x.casa.sugerencias?.length ? `. Parecidos: ${sugerencias(x.casa)}` : ''}`, 1);
      else t.linea(`✗ «${x.texto}» · ${n}: ${x.casa.empate ? 'casa con varios' : 'no casa'}${x.casa.sugerencias?.length ? `. Parecidos: ${sugerencias(x.casa)}` : '. Nada parecido'}`, 1);
    }
  };
  apartado('TRATAMIENTOS · servicio de Flowww → tratamiento de la app (en las citas que se traen)', plan.servicios, plan.nombres.tratamiento);
  apartado('PROFESIONALES', plan.profesionales, plan.nombres.profesional);
  apartado('CABINAS', plan.salas, plan.nombres.sala, { libre: 'la agenda pone una de las del tratamiento' });
  if (plan.estados.size) {
    t.linea();
    t.linea('ESTADOS DE FLOWWW SIN DECIDIR');
    for (const x of plan.estados.values()) t.linea(`✗ «${x.texto}» · ${plural(x.citas, 'cita', 'citas')}: ¿se traen o no?`, 1);
  }
  // La duración que manda es la de la app (con sus limpiezas); si Flowww dice otra, que se sepa.
  const distintas = [];
  for (const s of plan.servicios.values()) {
    if (!s.casa.id || !s.duraciones?.size) continue;
    const app = plan.duracionApp?.(s.casa.id);
    for (const [min, n] of s.duraciones) if (app && min !== app) distintas.push(`«${s.texto}»: ${min} min en Flowww y ${app} en la app · ${plural(n, 'cita', 'citas')}`);
  }
  if (distintas.length) {
    t.linea();
    t.linea('DURACIONES QUE NO CUADRAN · manda la de la app (con su limpieza); si la buena es la de Flowww, hay que cambiar el catálogo');
    t.detalle(distintas, 1);
  }
}

// El trozo de mapa que falta, listo para copiar: con lo más parecido si se parece bastante.
function mapaQueFalta(plan) {
  const propuesta = (mapa, casado, valor) => Object.fromEntries([...mapa.values()].filter((x) => !casado(x.casa || {}))
    .map((x) => [x.texto, valor(x)]));
  const mejor = (x) => (x.casa.sugerencias?.[0]?.parecido >= 0.6 && !x.casa.empate ? x.casa.sugerencias[0] : null);
  const falta = {
    tratamientos: propuesta(plan.servicios, (c) => c.id || c.ignorar, (x) => mejor(x)?.id || ''),
    profesionales: propuesta(plan.profesionales, (c) => c.id || c.cualquiera, (x) => mejor(x)?.codigo || ''),
    estados: Object.fromEntries([...plan.estados.values()].map((x) => [x.texto, ''])),
  };
  for (const k of Object.keys(falta)) if (!Object.keys(falta[k]).length) delete falta[k];
  return Object.keys(falta).length ? falta : null;
}

/** El informe de una importación (o de su ensayo) a partir de su plan (servidor/importacion-flowww.js). */
function redactarInforme(plan) {
  const t = nuevoTexto();
  if (plan.aplicado) t.linea(plan.lote ? `Importación de Flowww · APLICADA (lote ${plan.lote})` : 'Importación de Flowww · APLICADA: no había nada nuevo que traer.');
  else if (plan.aplicar) t.linea('Importación de Flowww · NO APLICADA: falta decidir algo (al final). No se ha escrito nada.');
  else t.linea('Importación de Flowww · ENSAYO: no se ha escrito nada.');
  t.linea(`Se traen las citas desde el ${cuando(plan.ahora)}; las de antes no. La facturación se queda en Flowww.`);
  if (plan.errores.length) {
    t.linea();
    t.linea('NO SE PUEDE SEGUIR');
    for (const e of plan.errores) t.linea(`✗ ${e}`, 1);
    return t.l.join('\n');
  }
  if (plan.ficheros.pacientes) pacientes(t, plan);
  const deCitas = plan.pacientes.filter((e) => e.origen === 'citas' && e.accion === 'nuevo');
  if (plan.ficheros.citas) {
    citas(t, plan);
    if (deCitas.length) {
      t.linea(`→ ${plural(deCitas.length, 'paciente nuevo que solo sale', 'pacientes nuevos que solo salen')} en las citas (con el nombre y el teléfono de la cita): ${deCitas.map((e) => `fila ${e.fila}`).join(', ')}`, 1);
    }
    casamientos(t, plan);
  }
  if (plan.citas.some((e) => e.clase === 'futura')) {
    t.linea();
    t.linea(plan.sinRecordatorios
      ? 'Recordatorios: las citas que se traen no reciben ni la confirmación (ya la tuvieron en Flowww) ni los recordatorios (--sin-recordatorios). Cuando se apague Flowww: node scripts/importar-flowww.js --recordatorios si --aplicar'
      : 'Recordatorios: las citas que se traen no reciben la confirmación (ya la tuvieron en Flowww), pero sí la víspera y 2 horas antes. Si Flowww los sigue mandando, --sin-recordatorios.');
  }
  t.linea();
  if (plan.aplicado && plan.lote) {
    const h = plan.hecho;
    t.linea(`HECHO: ${[
      `${plural(h.pacientesNuevos.length, 'paciente nuevo', 'pacientes nuevos')} y ${plural(h.vinculados.length, 'vinculado', 'vinculados')}`,
      plural(h.consentimientos.length, 'consentimiento registrado', 'consentimientos registrados'),
      `${plural(h.citas.length, 'cita', 'citas')} (${plural(h.revisar.length, 'para revisar', 'para revisar')}, con su tarea en el panel)`,
      h.mapeos.length && `${plural(h.mapeos.length, 'servicio del mapa guardado', 'servicios del mapa guardados')} para la próxima vez`,
    ].filter(Boolean).join(' · ')}.`);
    t.linea(`Para deshacerlo: node scripts/importar-flowww.js --deshacer ${plan.lote} (primero sin --aplicar, para ver qué quitaría).`);
  } else if (plan.aplicado) {
    t.linea('Todo lo de estos ficheros ya estaba en la app: no se ha cambiado nada.');
  } else if (plan.bloqueos.length) {
    t.linea('PARA PODER APLICAR');
    for (const b of plan.bloqueos) t.linea(`✗ ${b}`, 1);
    const falta = mapaQueFalta(plan);
    if (falta) {
      t.linea('Añádelo a tu mapa (--mapa) y completa cada línea: en tratamientos, el id del tratamiento de la app o «ignorar»; en');
      t.linea('profesionales, su código o «cualquiera» (lo elige la agenda); en estados, «importar» o «ignorar». Lo que viene puesto');
      t.linea('es solo lo más parecido: revísalo antes.');
      for (const x of JSON.stringify(falta, null, 2).split('\n')) t.linea(x);
    }
  } else if (!plan.aplicar) {
    t.linea('Todo listo. Haz una copia de la base (bash scripts/copia-bd.sh antes-de-flowww) y lánzalo igual con --aplicar.');
  }
  return t.l.join('\n');
}

/** Lo que quita (o quitaría) deshacer una importación (servidor/importacion-flowww.js → deshacer). */
function redactarDeshacer(r) {
  const t = nuevoTexto();
  t.linea(`Deshacer la importación ${r.lote} · ${r.aplicado ? 'HECHO' : 'ENSAYO: no se ha cambiado nada'}`);
  t.linea(`Citas: ${plural(r.citasQuitadas, 'se quita', 'se quitan')}${r.citasQuedan.length
    ? `; ${plural(r.citasQuedan.length, 'se queda', 'se quedan')} porque ya ${r.citasQuedan.length === 1 ? 'ha' : 'han'} cambiado (${r.citasQuedan.map((c) => `cita ${c.id}: ${c.estado}`).join(', ')})` : ''}`, 1);
  t.linea(`Pacientes nuevos: ${plural(r.pacientesQuitados, 'se quita', 'se quitan')}${r.pacientesQuedan.length
    ? `; ${plural(r.pacientesQuedan.length, 'se queda', 'se quedan')} porque ya ${r.pacientesQuedan.length === 1 ? 'tiene' : 'tienen'} otras cosas en la app (${r.pacientesQuedan.map((id) => `paciente ${id}`).join(', ')})` : ''}`, 1);
  t.linea(`Pacientes que ya estaban: a ${r.vinculados} se les quita el código de Flowww${r.telefonos ? ` y a ${r.telefonos}, el teléfono que se les puso` : ''}`, 1);
  t.linea(`Consentimientos: ${r.consentimientos} · bajas comerciales: ${r.bajas} · tareas abiertas: ${r.tareas} · servicios guardados del mapa: ${r.mapeos} · secuencias que vuelven a su estado: ${r.secuencias}`, 1);
  if (!r.aplicado) t.linea('Para hacerlo, lo mismo con --aplicar.');
  return t.l.join('\n');
}

module.exports = { redactarInforme, redactarDeshacer, cuando };
