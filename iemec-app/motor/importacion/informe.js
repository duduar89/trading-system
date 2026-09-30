'use strict';
// El informe de la importación de Flowww, para quien la lanza: lo que se ha leído, lo que se va a
// hacer (o se ha hecho) y lo que falta decidir. Sin nombres, teléfonos, emails ni notas de pacientes:
// cada cosa va por su fila del CSV, su código de Flowww y su número en la app. Aun así es
// CONFIDENCIAL, con el mismo trato que los CSV: con la app o el fichero se sabe de quién es cada fila,
// y dice qué tratamiento lleva y cuándo (datos de salud seudonimizados siguen siendo datos personales).
const T = require('../tiempo');

const MAX = 200; // líneas de detalle por apartado
const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const SEPARADOR = { ';': '«;»', ',': '«,»', '\t': 'tabulador' };
const CAMPO = {
  id: 'código', nombre: 'nombre', apellidos: 'apellidos', telefono: 'teléfono', email: 'email', fecha_nacimiento: 'nacimiento',
  observaciones: 'observaciones', marketing: 'marketing', marketing_whatsapp: 'marketing por WhatsApp', marketing_email: 'marketing por email',
  fecha_consentimiento: 'fecha del consentimiento', paciente_id: 'código del cliente', paciente: 'cliente', fecha: 'fecha', hora: 'hora',
  hora_fin: 'hora de fin', duracion: 'duración', servicio: 'servicio', profesional: 'profesional', sala: 'cabina', estado: 'estado',
};
const VIA = { mapa: 'del mapa', guardado: 'guardado en otra importación', nombre: 'mismo nombre', alias: 'por un alias', 'nombre parcial': 'por parte del nombre' };
const FICHA = { apellidos: 'apellidos', email: 'email', fechaNacimiento: 'nacimiento' };
const BLOQUEO = 'es un bloqueo o una nota de agenda';

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const porciento = (x) => `${Math.round(x * 100)} %`;
const filas = (lista) => `${lista.length === 1 ? 'fila' : 'filas'} ${lista.slice(0, 30).map((e) => e.fila).join(', ')}${lista.length > 30 ? '…' : ''}`;

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
    detalle: (lineas, sangria = 3) => {
      for (const f of lineas.slice(0, MAX)) t.linea(f, sangria);
      if (lineas.length > MAX) t.linea(`… y ${lineas.length - MAX} más`, sangria);
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

// Lo que se completa en la ficha de quien ya estaba en la app.
function completa(e) {
  const campos = [
    e.completarTelefono && 'teléfono (para sus recordatorios)',
    ...Object.keys(e.completar || {}).filter((k) => FICHA[k]).map((k) => FICHA[k]),
    e.completar?.notas && (e.bd?.con_notas ? 'observaciones (se añaden a las suyas, si no las tiene ya)' : 'observaciones (cifradas)'),
  ].filter(Boolean);
  return campos.length ? `; se completa: ${campos.join(', ')}` : '';
}

function pacientes(t, plan) {
  const lista = plan.pacientes;
  const de = (accion, origen = null) => lista.filter((e) => e.accion === accion && (!origen || e.origen === origen));
  fichero(t, 'PACIENTES', plan.ficheros.pacientes);
  const desdeFichero = lista.filter((e) => e.origen === 'pacientes');
  if (!plan.ficheros.pacientes.campos.id.length) t.linea('Sin código de cliente: cada paciente se reconoce por sus datos. Mejor pedir a Flowww la columna del código.', 1);
  t.linea(`→ ${plural(de('nuevo', 'pacientes').length, 'nuevo', 'nuevos')}`, 1);
  const existentes = de('existente', 'pacientes');
  const yaImportados = existentes.filter((e) => e.via === 'código').length;
  if (yaImportados) t.linea(`→ ${plural(yaImportados, 'ya importado', 'ya importados')} antes (mismo código de Flowww): solo se completa lo que ${yaImportados === 1 ? 'le' : 'les'} falte`, 1);
  const enLaApp = existentes.filter((e) => e.via !== 'código');
  if (enLaApp.length) {
    const uno = enLaApp.length === 1;
    t.linea(`→ ${plural(enLaApp.length, 'ya estaba', 'ya estaban')} en la app: se ${uno ? 'le' : 'les'} apunta su código de Flowww y se completa lo que ${uno ? 'su ficha no tenga' : 'sus fichas no tengan'}; lo que ya ${uno ? 'tiene' : 'tienen'} no se toca`, 1);
    t.detalle(enLaApp.map((e) => `${quien(e)} → paciente ${e.pacienteId} de la app, por ${e.via}${e.vincular ? '' : ' (ya tenía otro código de Flowww: se queda el suyo)'}${completa(e)}`));
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
  // Consentimiento de marketing: solo lo que dice una columna, y la oposición gana.
  const raices = desdeFichero.filter((e) => ['nuevo', 'existente'].includes(e.accion));
  const con = (hay) => raices.filter((e) => (e.marketing || []).some(hay)).length;
  const si = con((c) => c.accion === 'otorgar');
  const no = con((c) => c.accion === 'revocar');
  const pisan = con((c) => c.pisaSi);
  const constaba = con((c) => c.accion === 'ya_constaba');
  const yaTenian = con((c) => c.accion === 'ya_tenia');
  const conBaja = con((c) => c.accion === 'baja');
  const contradicen = raices.filter((e) => e.contradice).length;
  const nada = raices.filter((e) => !(e.marketing || []).length).length;
  t.linea(`Marketing: ${[
    si && `${si} con «sí» en una columna (se registra su consentimiento)`,
    no && `${no} con «no» (se registra que no y, si es a WhatsApp, la baja comercial${pisan ? `; ${pisan} ${pisan === 1 ? 'tenía' : 'tenían'} un «sí» en la app: gana el «no»` : ''})`,
    contradicen && `${contradicen} con «sí» y «no» en filas distintas (gana el «no»)`,
    constaba && `${constaba} con un «no» que ya constaba en la app`,
    yaTenian && `${yaTenian} con «sí» que ya ${yaTenian === 1 ? 'tenía' : 'tenían'} uno en la app (se respeta lo suyo)`,
    conBaja && `${conBaja} con «sí» y la baja comercial en la app (no se registra: gana la baja)`,
    `${nada} sin nada: importar no da consentimiento`,
  ].filter(Boolean).join('; ')}`, 1);
  const enLista = raices.filter((e) => e.bajaDeLista).length;
  if (enLista) t.linea(`→ ${plural(enLista, 'tiene', 'tienen')} el teléfono en la lista de bajas comerciales: se ${enLista === 1 ? 'le' : 'les'} apunta también en la ficha`, 1);
}

// Qué le pasa en Flowww a una cita ya importada, en corto.
function queLePasa(x, plan) {
  const fila = x.fila ? ` (fila ${x.fila})` : '';
  if (x.tipo === 'anulada') return `en Flowww está anulada${fila}`;
  if (x.tipo === 'cambiada') return `en Flowww es ahora ${x.tratamiento ? `«${plan.nombres.tratamiento(x.tratamiento)}» el ` : 'el '}${cuando(x.inicio)}${fila}`;
  if (x.tipo === 'movida') return `puede ser la de la fila ${x.fila} (${cuando(x.inicio)}), sin código de cita: la tarea va en la nueva`;
  return 'ya no sale en la exportación de Flowww';
}

function retiradas(t, plan) {
  const nuevas = plan.retiradas.filter((x) => !x.yaAvisada);
  const avisadas = plan.retiradas.length - nuevas.length;
  if (nuevas.length) {
    const una = nuevas.length === 1;
    t.linea(`→ ${plural(nuevas.length, 'importada antes que en Flowww ya no es así', 'importadas antes que en Flowww ya no son así')}: no se ${una ? 'toca' : 'tocan'} sola${una ? '' : 's'}; `
      + `se ${una ? 'queda' : 'quedan'} sin recordatorios y con una tarea para revisar${una ? 'la' : 'las'}:`, 1);
    // Su código de Flowww, si lo tenía (sin él, su identificador es una huella que no dice nada).
    const codigo = (x) => (x.cita.flowww_id.startsWith('c:') ? '' : ` (Flowww ${x.cita.flowww_id})`);
    t.detalle(nuevas.map((x) => `cita ${x.cita.id} de la app${codigo(x)} · ${cuando(x.cita.inicio)} · ${plan.nombres.tratamiento(x.cita.tratamiento_id)}: ${queLePasa(x, plan)}`));
  }
  if (avisadas) t.linea(`→ ${plural(avisadas, 'importada antes ya estaba', 'importadas antes ya estaban')} a revisar desde otra importación: no se vuelve a avisar`, 1);
  const vuelven = plan.reaparecidas || [];
  if (vuelven.length) {
    t.linea(`→ ${plural(vuelven.length, 'importada antes que estaba', 'importadas antes que estaban')} a revisar vuelve${vuelven.length === 1 ? '' : 'n'} a salir igual en Flowww: `
      + `sigue${vuelven.length === 1 ? '' : 'n'} sin recordatorios; si sigue${vuelven.length === 1 ? '' : 'n'} en pie, --recordatorios si --cita <número> (o deshacer la importación que ${vuelven.length === 1 ? 'la' : 'las'} retiró):`, 1);
    t.detalle(vuelven.map((x) => `cita ${x.cita.id} de la app · ${cuando(x.cita.inicio)} · ${plan.nombres.tratamiento(x.cita.tratamiento_id)} (fila ${x.fila})`));
  }
  if (plan.importadasFuera) {
    const n = plan.importadasFuera;
    t.linea(`→ ${plural(n, 'importada antes es', 'importadas antes son')} de después de la última fecha de este fichero (${plan.rangoCitas.hasta.split('-').reverse().join('/')}): `
      + `no se ${n === 1 ? 'puede' : 'pueden'} comprobar`, 1);
  }
}

function citas(t, plan) {
  const lista = plan.citas;
  const de = (...clases) => lista.filter((e) => clases.includes(e.clase));
  const f = plan.ficheros.citas;
  fichero(t, 'CITAS', f);
  for (const d of plan.dudosas) t.linea(`La columna «${d.columna}» puede ser el código de la cita o el del cliente: no se usa hasta que lo diga el mapa (al final)`, 1);
  if (!f.campos.id.length && !plan.dudosas.length) {
    t.linea('Sin código de cita: si una cita cambia en Flowww entre dos importaciones, no se reconoce como la misma. Mejor pedir la columna del código.', 1);
  }
  if (f.sinEstado) t.linea('Sin columna de estado: no se sabe qué citas están anuladas en Flowww (al final)', 1);
  if (plan.codigosNoUnicos.length) {
    const n = plan.codigosNoUnicos.length;
    t.linea(`→ ${plural(n, 'código de cita sale', 'códigos de cita salen')} en citas vivas de días o pacientes distintos: no ${n === 1 ? 'es' : 'son'} de una cita (al final):`, 1);
    t.detalle(plan.codigosNoUnicos.map((x) => `«${x.codigo}»: filas ${x.filas.join(', ')}`));
  }
  const pasadas = de('pasada').length;
  const anuladas = de('anulada').length;
  if (pasadas || anuladas) t.linea(`→ ${[pasadas && plural(pasadas, 'pasada', 'pasadas'), anuladas && plural(anuladas, 'anulada', 'anuladas')].filter(Boolean).join(' y ')}: no se traen`, 1);
  const bloqueos = de('sin_paciente').filter((e) => e.falta === BLOQUEO).length;
  if (bloqueos) t.linea(`→ ${plural(bloqueos, 'bloqueo o nota de agenda', 'bloqueos o notas de agenda')} (sin paciente): no se ${bloqueos === 1 ? 'trae' : 'traen'}`, 1);
  const ignoradas = de('ignorada').length;
  if (ignoradas) t.linea(`→ ${plural(ignoradas, 'cita', 'citas')} de servicios que el mapa manda ignorar: no se ${ignoradas === 1 ? 'trae' : 'traen'}`, 1);
  const repetidas = de('repetida');
  if (repetidas.length) t.linea(`→ ${plural(repetidas.length, 'fila repetida', 'filas repetidas')} (la misma cita dos veces): ${repetidas.map((e) => e.fila).join(', ')}`, 1);
  if (plan.variosServicios.length) {
    t.linea(`→ ${plural(plan.variosServicios.length, 'cita de Flowww con varios servicios', 'citas de Flowww con varios servicios')} (el mismo código en varias filas): se trae una por servicio: `
      + `${plan.variosServicios.map((x) => `«${x.codigo}» (filas ${x.filas.join(', ')})`).join('; ')}`, 1);
  }
  const ya = de('ya_importada');
  if (ya.length) t.linea(`→ ${plural(ya.length, 'ya importada', 'ya importadas')} antes: no se ${ya.length === 1 ? 'toca' : 'tocan'}`, 1);
  retiradas(t, plan);
  const futuras = de('futura');
  t.linea(`→ ${plural(futuras.length, 'futura que se trae', 'futuras que se traen')}${futuras.length ? ':' : ''}`, 1);
  if (futuras.length) {
    const cita = (e) => `fila ${e.fila} · ${cuando(e.inicio)} · ${plan.nombres.tratamiento(e.tratamientoId)}`;
    const caben = futuras.filter((e) => e.colocacion.cabe);
    const otraSala = caben.filter((e) => e.colocacion.otraSala);
    const noCaben = futuras.filter((e) => !e.colocacion.cabe);
    t.linea(`${plural(caben.filter((e) => !e.colocacion.otraSala && !e.revisar).length, 'cabe', 'caben')} en la agenda tal cual`, 2);
    if (otraSala.length) {
      t.linea(`${plural(otraSala.length, 'cabe', 'caben')} en otra cabina:`, 2);
      t.detalle(otraSala.map((e) => `${cita(e)}: en Flowww, «${e.sala}»${e.salaAjena ? ', que no es de este tratamiento' : ', ocupada'} → ${plan.nombres.sala(e.colocacion.salaId)}`));
    }
    if (noCaben.length) {
      t.linea(`${plural(noCaben.length, 'no cabe', 'no caben')}: se ${noCaben.length === 1 ? 'trae' : 'traen'} igual, para revisar, con su tarea en el panel:`, 2);
      t.detalle(noCaben.map((e) => `${cita(e)}: ${e.colocacion.motivo}`));
    }
    const movidas = caben.filter((e) => e.revisar);
    if (movidas.length) {
      t.linea(`${plural(movidas.length, 'puede ser una ya importada', 'pueden ser ya importadas')} y movida${movidas.length === 1 ? '' : 's'} en Flowww (sin código de cita): se ${movidas.length === 1 ? 'trae' : 'traen'} para revisar, con su tarea:`, 2);
      t.detalle(movidas.map((e) => `${cita(e)}: ${e.revisar}`));
    }
    // Casar una cita con su paciente solo por el nombre es lo más flojo: que alguien lo mire.
    const porNombre = futuras.filter((e) => e.paciente.via === 'nombre');
    if (porNombre.length) {
      t.linea(`${plural(porNombre.length, 'es', 'son')} de un paciente que se ha reconocido solo por el nombre: compruébalo:`, 2);
      t.detalle(porNombre.map((e) => {
        const p = e.paciente.bd || e.paciente.entrada;
        const cual = p.id || p.pacienteId ? `el paciente ${p.id || p.pacienteId} de la app` : `el de la fila ${p.fila}${p.origen === 'citas' ? ' de las citas' : ' de pacientes'}`;
        return `${cita(e)} → ${cual}`;
      }));
    }
  }
  const fuera = citasFuera(plan);
  if (fuera.length) {
    t.linea(`→ ${plural(fuera.length, 'no se trae', 'no se traen')}:`, 1);
    t.detalle(fuera.map((e) => `fila ${e.fila}: ${e.clase === 'error' ? e.errores.join('; ') : e.falta}`));
  }
  const pendientes = [
    [de('sin_tratamiento').length, 'de un servicio que no casa', 'de servicios que no casan'],
    [de('sin_profesional').length, 'de un profesional que no casa', 'de profesionales que no casan'],
    [de('estado_desconocido').length, 'con un estado sin decidir', 'con estados sin decidir'],
  ].filter(([n]) => n).map(([n, uno, varios]) => `${plural(n, 'cita', 'citas')} ${n === 1 ? uno : varios}`);
  if (pendientes.length) t.linea(`→ Por decidir (abajo): ${pendientes.join('; ')}`, 1);
}

// Las filas de citas que no se traen por algo de la fila (fecha, hora, servicio o de quién es): si son
// futuras, se pierden al apagar Flowww.
function citasFuera(plan) {
  return plan.citas.filter((e) => e.clase === 'error' || (e.clase === 'sin_paciente' && e.falta !== BLOQUEO)).sort((a, b) => a.fila - b.fila);
}

// Los pacientes que solo salen en las citas: con lo que trae la cita.
function pacientesDeCitas(t, plan) {
  const deCitas = plan.pacientes.filter((e) => e.origen === 'citas' && e.accion === 'nuevo');
  if (!deCitas.length) return;
  t.linea(`→ ${plural(deCitas.length, 'paciente nuevo que solo sale', 'pacientes nuevos que solo salen')} en las citas (con el nombre de la cita, y su teléfono si lo trae y no es de otra persona): `
    + `${deCitas.map((e) => `fila ${e.fila}`).join(', ')}`, 1);
  const compartidos = deCitas.filter((e) => e.compartido);
  if (compartidos.length) {
    t.linea(`${plural(compartidos.length, 'trae', 'traen')} el teléfono de otra persona (otro nombre): ${compartidos.length === 1 ? 'entra' : 'entran'} sin él:`, 2);
    t.detalle(compartidos.map((e) => `fila ${e.fila} de las citas: el teléfono ya es ${e.compartido}`));
  }
  const sinTelefono = deCitas.filter((e) => !e.telefono);
  if (sinTelefono.length) {
    t.linea(`${plural(sinTelefono.length, 'se queda', 'se quedan')} sin teléfono y no le${sinTelefono.length === 1 ? '' : 's'} llegarán los recordatorios: `
      + `${filas(sinTelefono)} de las citas (pedid el teléfono o avisad a mano)`, 2);
  }
  const enLista = deCitas.filter((e) => e.bajaDeLista).length;
  if (enLista) t.linea(`${plural(enLista, 'tiene', 'tienen')} el teléfono en la lista de bajas comerciales: se ${enLista === 1 ? 'le' : 'les'} apunta también en la ficha`, 2);
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

// Lo que conviene saber antes de aplicar (o después): citas futuras que se pierden si no se dan a mano,
// y citas ya importadas que se van a quedar sin recordatorios.
function ojo(plan) {
  const salida = [];
  const fuera = citasFuera(plan);
  if (fuera.length) {
    salida.push(`${plural(fuera.length, 'fila de citas no se trae', 'filas de citas no se traen')} (${filas(fuera)}): si ${fuera.length === 1 ? 'es futura, hay que darla' : 'son futuras, hay que darlas'} a mano en la app antes de apagar Flowww`);
  }
  const retiradas = plan.retiradas.filter((x) => !x.yaAvisada).length;
  if (retiradas && !plan.aplicado) {
    salida.push(`${plural(retiradas, 'cita importada antes se queda', 'citas importadas antes se quedan')} sin recordatorios y con una tarea porque en este fichero ya no ${retiradas === 1 ? 'es' : 'son'} así: `
      + 'si no es la exportación completa de las citas (todas, desde hoy), no lo apliques');
  }
  return salida;
}

/** El informe de una importación (o de su ensayo) a partir de su plan (servidor/importacion-flowww.js). */
function redactarInforme(plan) {
  const t = nuevoTexto();
  if (plan.aplicado) t.linea(plan.lote ? `Importación de Flowww · APLICADA (lote ${plan.lote})` : 'Importación de Flowww · APLICADA: no había nada nuevo que traer.');
  else if (plan.aplicar) t.linea('Importación de Flowww · NO APLICADA: falta decidir algo (al final). No se ha escrito nada.');
  else t.linea('Importación de Flowww · ENSAYO: no se ha escrito nada.');
  t.linea(`Se traen las citas desde el ${cuando(plan.ahora)}; las de antes no. La facturación se queda en Flowww.`);
  t.linea('Confidencial: sin nombres ni teléfonos, pero con la app o el CSV se sabe de quién es cada fila. Trátalo como los CSV.');
  if (plan.errores.length) {
    t.linea();
    t.linea('NO SE PUEDE SEGUIR');
    for (const e of plan.errores) t.linea(`✗ ${e}`, 1);
    return t.l.join('\n');
  }
  if (plan.ficheros.pacientes) pacientes(t, plan);
  if (plan.ficheros.citas) {
    citas(t, plan);
    pacientesDeCitas(t, plan);
    casamientos(t, plan);
  }
  if (plan.citas.some((e) => e.clase === 'futura')) {
    t.linea();
    t.linea(plan.sinRecordatorios
      ? 'Recordatorios: las citas que se traen no reciben ni la confirmación (ya la tuvieron en Flowww) ni los recordatorios (--sin-recordatorios). Cuando se apague Flowww: node scripts/importar-flowww.js --recordatorios si --aplicar'
      : 'Recordatorios: las citas que se traen no reciben la confirmación (ya la tuvieron en Flowww), pero sí la víspera y 2 horas antes. Si Flowww los sigue mandando, --sin-recordatorios.');
  }
  t.linea();
  const avisos = ojo(plan);
  if (plan.aplicado && plan.lote) {
    const h = plan.hecho;
    t.linea(`HECHO: ${[
      `${plural(h.pacientesNuevos.length, 'paciente nuevo', 'pacientes nuevos')} y ${plural(h.vinculados.length, 'vinculado', 'vinculados')}`,
      h.completados.length && `${plural(h.completados.length, 'ficha completada', 'fichas completadas')} de quien ya estaba`,
      plural(h.consentimientos.length, 'consentimiento registrado', 'consentimientos registrados'),
      h.bajas.length && plural(h.bajas.length, 'baja comercial apuntada', 'bajas comerciales apuntadas'),
      `${plural(h.citas.length, 'cita', 'citas')} (${plural(h.revisar.length, 'para revisar', 'para revisar')}, con su tarea en el panel)`,
      h.retiradas.length && `${plural(h.retiradas.length, 'importada antes se queda', 'importadas antes se quedan')} sin recordatorios y a revisar`,
      h.mapeos.length && `${plural(h.mapeos.length, 'servicio del mapa guardado', 'servicios del mapa guardados')} para la próxima vez`,
    ].filter(Boolean).join(' · ')}.`);
    for (const a of avisos) t.linea(`Ojo: ${a}.`);
    t.linea(`Para deshacerlo: node scripts/importar-flowww.js --deshacer ${plan.lote} (primero sin --aplicar, para ver qué quitaría).`);
  } else if (plan.aplicado) {
    t.linea('Todo lo de estos ficheros ya estaba en la app: no se ha cambiado nada.');
    for (const a of avisos) t.linea(`Ojo: ${a}.`);
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
    if (avisos.length) {
      t.linea('Listo para aplicar, pero ojo:');
      for (const a of avisos) t.linea(`✗ ${a}.`, 1);
    } else t.linea('Todo listo.');
    t.linea('Antes de aplicar, una copia de la base guardada fuera de la rotación (docs/MIGRAR-FLOWWW.md, paso 2); luego, lo mismo con --aplicar.');
  }
  return t.l.join('\n');
}

/** Lo que quita (o quitaría) deshacer una importación (servidor/importacion-flowww.js → deshacer). */
function redactarDeshacer(r) {
  const t = nuevoTexto();
  t.linea(`Deshacer la importación ${r.lote} · ${r.aplicado ? 'HECHO' : 'ENSAYO: no se ha cambiado nada'}`);
  t.linea(`Citas: ${plural(r.citasQuitadas, 'se quita', 'se quitan')}${r.citasQuedan.length
    ? `; ${plural(r.citasQuedan.length, 'se queda', 'se quedan')} porque ya ${r.citasQuedan.length === 1 ? 'ha' : 'han'} cambiado o ya se avisó al paciente (${r.citasQuedan.map((c) => `cita ${c.id}: ${c.estado}`).join(', ')})` : ''}`, 1);
  if (r.retiradas) t.linea(`Importadas antes que dejó sin recordatorios: ${plural(r.retiradas, 'los recupera', 'los recuperan')}`, 1);
  t.linea(`Pacientes nuevos: ${plural(r.pacientesQuitados, 'se quita', 'se quitan')}${r.pacientesQuedan.length
    ? `; ${plural(r.pacientesQuedan.length, 'se queda', 'se quedan')} porque ya ${r.pacientesQuedan.length === 1 ? 'tiene' : 'tienen'} otras cosas en la app (${r.pacientesQuedan.map((id) => `paciente ${id}`).join(', ')})` : ''}`, 1);
  t.linea(`Pacientes que ya estaban: a ${r.vinculados} se les quita el código de Flowww${r.completados ? ` y a ${r.completados}, lo que se completó en su ficha` : ''}`, 1);
  t.linea(`Consentimientos: ${plural(r.consentimientos, '«sí» se quita', '«sí» se quitan')}; los «no» (${r.oposiciones}) y las bajas comerciales (${r.bajas}) se quedan: una oposición no se olvida al deshacer`, 1);
  t.linea(`Tareas abiertas: ${r.tareas} · servicios guardados del mapa: ${r.mapeos} · secuencias que vuelven a su estado: ${r.secuencias}`, 1);
  if (!r.aplicado) t.linea('Para hacerlo, lo mismo con --aplicar.');
  return t.l.join('\n');
}

module.exports = { redactarInforme, redactarDeshacer, cuando };
