'use strict';
// Lo que llega de Flowww, en limpio: columnas con nombres típicos o del mapa, teléfonos en cualquier
// formato, fechas, horas, «sí» y «no» explícitos, estados, personas y el casamiento de servicios,
// profesionales y cabinas con los de la app. Todo con datos INVENTADOS.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./flowww');

test('teléfonos en cualquier formato → E.164 de España (y el primer móvil si hay varios)', () => {
  const casos = [
    ['+34 611 000 401', '+34611000401'],
    ['611 00 03 01', '+34611000301'],
    ['0034-611-000-302', '+34611000302'],
    ['(+34) 611.000.111', '+34611000111'],
    ['34611000121', '+34611000121'],
    ['6,11000501E+08', '+34611000501'], // Excel lo pasó a número
    ['611000501.0', '+34611000501'],
    ['Móvil: 611-00-05-02 (tardes)', '+34611000502'],
    ['916 32 00 00 / 611 000 701', '+34611000701'], // el fijo y el móvil: el móvil, que tiene WhatsApp
    ['916320000', '+34916320000'],
    ['+44 7700 900123', '+447700900123'],
  ];
  for (const [entrada, sale] of casos) assert.equal(F.telefonoEspanol(entrada), sale, entrada);
  for (const malo of ['12345', '6,12346E+08', 'no tiene', '', null, '611 000']) assert.equal(F.telefonoEspanol(malo), null, String(malo));
  assert.deepEqual(F.elegirTelefono(['916320000', '611000999']), { telefono: '+34611000999', ilegible: false }, 'entre columnas, también el móvil');
  assert.deepEqual(F.elegirTelefono(['12345']), { telefono: null, ilegible: true });
});

test('fechas dd/mm/aaaa y aaaa-mm-dd, horas hh:mm, duraciones y sí/no explícitos', () => {
  assert.deepEqual(F.leerFecha('15/10/2026'), { fecha: '2026-10-15', hora: null });
  assert.deepEqual(F.leerFecha('5-3-2026'), { fecha: '2026-03-05', hora: null });
  assert.deepEqual(F.leerFecha('2026-10-15'), { fecha: '2026-10-15', hora: null });
  assert.deepEqual(F.leerFecha('15/10/2026 9:30'), { fecha: '2026-10-15', hora: '09:30' });
  assert.deepEqual(F.leerFecha('2026-10-15T11:00:00'), { fecha: '2026-10-15', hora: '11:00' });
  assert.deepEqual(F.leerFecha('29/02/1988'), { fecha: '1988-02-29', hora: null });
  for (const malo of ['31/02/2026', '29/02/2026', '15/13/2026', 'mañana', '2026/10', '']) assert.equal(F.leerFecha(malo), null, malo);
  const hoy = new Date('2026-10-13T08:00:00Z');
  assert.equal(F.leerFecha('03/04/71', { nacimiento: true, hoy }).fecha, '1971-04-03', 'nacido con dos cifras: del siglo pasado');
  assert.equal(F.leerFecha('03/04/12', { nacimiento: true, hoy }).fecha, '2012-04-03');
  assert.equal(F.leerFecha('15/10/26').fecha, '2026-10-15', 'una cita con dos cifras: de este siglo');

  assert.deepEqual(['10:00', '9.30', '11h30', '11 h', '7:05:00'].map(F.leerHora), ['10:00', '09:30', '11:30', '11:00', '07:05']);
  assert.deepEqual(['24:00', '11', '10:61', 'tarde'].map(F.leerHora), [null, null, null, null]);
  assert.deepEqual(['60', '45 min', "90'", '1:30', '1h 30min', '2 horas', '60,0'].map(F.leerDuracion), [60, 45, 90, 90, 90, 120, 60]);
  assert.equal(F.leerDuracion('mucho'), null);

  assert.deepEqual(['Sí', 'si', 'S', 'X', '1', 'Acepta', 'true', '✓'].map(F.leerSiNo), Array(8).fill(true));
  assert.deepEqual(['No', 'n', '0', 'NO ACEPTA', 'Rechazado', 'false'].map(F.leerSiNo), Array(6).fill(false));
  assert.deepEqual(['', 'Pendiente', '?', 'n/a', 'quizá'].map(F.leerSiNo), Array(5).fill(null), 'lo que no es explícito no cuenta');
});

test('estados de Flowww: se trae, no se trae o se pregunta (y manda el mapa)', () => {
  for (const e of ['Confirmada', 'Pendiente', 'Reservada', 'Citado', 'No confirmada', '']) assert.equal(F.claseDeEstado(e), F.IMPORTAR, e);
  for (const e of ['Anulada', 'Cancelada por el cliente', 'No asistió', 'No presentado', 'Faltó', 'Bloqueo', 'Inactiva']) assert.equal(F.claseDeEstado(e), F.IGNORAR, e);
  for (const e of ['En espera', 'Realizada', 'Cobrada']) assert.equal(F.claseDeEstado(e), null, e);
  assert.equal(F.claseDeEstado('En espera', new Map([['en espera', F.IMPORTAR]])), F.IMPORTAR);
});

test('columnas: los nombres típicos en español, sin tildes ni mayúsculas, y lo que diga el mapa', () => {
  const cab = ['CÓDIGO', 'Nombre', 'Apellido 1', 'Apellido 2', 'Tel. Móvil', 'Teléfono', 'E-mail', 'F. Nacimiento', 'DNI', 'Notas', 'Acepta publicidad'];
  const r = F.resolverColumnas(cab, 'pacientes');
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.campos.apellidos, ['Apellido 1', 'Apellido 2'], 'los dos apellidos se juntan');
  assert.deepEqual(r.campos.telefono, ['Tel. Móvil', 'Teléfono'], 'el móvil primero');
  assert.deepEqual([r.campos.id, r.campos.email, r.campos.fecha_nacimiento, r.campos.observaciones, r.campos.marketing],
    [['CÓDIGO'], ['E-mail'], ['F. Nacimiento'], ['Notas'], ['Acepta publicidad']]);
  assert.deepEqual(r.sinUsar, ['DNI'], 'lo que no hace falta no se trae');

  const m = F.resolverColumnas(cab, 'pacientes', { telefono: 'Teléfono', observaciones: null, id: 'Ficha' });
  assert.deepEqual(m.campos.telefono, ['Teléfono']);
  assert.deepEqual(m.campos.observaciones, [], 'con null, ese campo no se trae');
  assert.match(m.errores[0], /«id» está en la columna «Ficha», y el fichero no la tiene/);

  const ambiguo = F.resolverColumnas(['Código', 'Nº cita', 'Cliente', 'Fecha', 'Hora', 'Servicio'], 'citas');
  assert.deepEqual(ambiguo.campos.id, ['Nº cita'], 'un campo, una columna: la concreta antes que la genérica');
  assert.deepEqual(ambiguo.sinUsar, ['Código'], 'la otra se ve en «No se traen»');
  assert.deepEqual(F.resolverColumnas(['Código', 'Código cliente', 'Nombre'], 'pacientes').campos.id, ['Código cliente']);

  const c = F.resolverColumnas(['Inicio', 'Cliente', 'Tratamiento', 'Empleada', 'Sala'], 'citas');
  assert.deepEqual([c.campos.fecha, c.campos.hora], [['Inicio'], ['Inicio']], 'fecha y hora en la misma columna');
  assert.deepEqual(F.resolverColumnas(['Cliente', 'Fecha'], 'citas').errores, ['Falta la columna de «servicio»: dila en el mapa («citas»: { "servicio": "nombre de la columna" })']);
});

test('un «Código», «Id» o «Referencia» a secas en las citas puede ser el del cliente: sin su columna, lo decide el mapa', () => {
  const sinCliente = F.resolverColumnas(['Código', 'Cliente', 'Fecha', 'Hora', 'Servicio'], 'citas');
  assert.deepEqual([sinCliente.campos.id, sinCliente.dudosas], [[], [{ campo: 'id', columna: 'Código' }]]);
  assert.ok(sinCliente.sinUsar.includes('Código'), 'se ve en «No se traen»');
  assert.deepEqual(F.resolverColumnas(['Id', 'Cód. cliente', 'Cliente', 'Fecha', 'Servicio'], 'citas').campos.id, ['Id'], 'con la del cliente, es el de la cita');
  assert.deepEqual(F.resolverColumnas(['Nº cita', 'Cliente', 'Fecha', 'Servicio'], 'citas').dudosas, [], 'un nombre concreto no tiene duda');
  const mapa = F.resolverColumnas(['Referencia', 'Cliente', 'Fecha', 'Servicio'], 'citas', { id: 'Referencia' });
  assert.deepEqual([mapa.campos.id, mapa.dudosas], [['Referencia'], []], 'si el mapa lo dice, vale');
  assert.deepEqual(F.resolverColumnas(['Código', 'Nombre'], 'pacientes').campos.id, ['Código'], 'en el fichero de pacientes, «Código» es el del cliente');
});

test('una fila de pacientes y otra de citas, en limpio', () => {
  const cab = ['Código', 'Nombre y apellidos', 'Móvil', 'Email', 'Observaciones', 'Publicidad WhatsApp', 'Newsletter'];
  const { campos } = F.resolverColumnas(cab, 'pacientes');
  const p = F.leerPaciente({ Código: '77', 'Nombre y apellidos': 'GARCÍA LÓPEZ, MARÍA JOSÉ', Móvil: '611 000 777', Email: 'Maria@Ejemplo.INVALID', Observaciones: 'Nota', 'Publicidad WhatsApp': 'Sí', Newsletter: 'no' }, campos);
  assert.deepEqual([p.flowwwId, p.nombre, p.apellidos, p.telefono, p.email, p.notas], ['77', 'María José', 'García López', '+34611000777', 'maria@ejemplo.invalid', 'Nota']);
  assert.deepEqual(p.consentimientos.map((c) => [c.tipo, c.otorgado]), [['whatsapp_marketing', true], ['email_marketing', false]]);
  const sinNombre = F.leerPaciente({ Código: '78', 'Nombre y apellidos': '', Móvil: '12', Email: 'x@', Observaciones: '', 'Publicidad WhatsApp': '', Newsletter: '' }, campos);
  assert.deepEqual(sinNombre.errores, ['sin nombre']);
  assert.equal(sinNombre.consentimientos.length, 0, 'sin columna explícita, ningún consentimiento');

  const cc = F.resolverColumnas(['Cliente', 'Fecha', 'Hora', 'Servicio', 'Profesional', 'Cabina', 'Estado'], 'citas').campos;
  const c = F.leerCita({ Cliente: 'Ruiz, Ana', Fecha: '15/10/2026', Hora: '10:15 - 11:00', Servicio: 'Higiene facial', Profesional: 'Dra. Pérez', Cabina: 'Box 1', Estado: 'Confirmada' }, cc);
  assert.deepEqual([c.nombre, c.apellidos, c.fecha, c.hora, c.duracion, c.servicio, c.profesional, c.sala], ['Ana', 'Ruiz', '2026-10-15', '10:15', 45, 'Higiene facial', 'Dra. Pérez', 'Box 1']);
  const junta = F.leerCita({ Inicio: '15/10/2026 12:45', Cliente: 'Eva', Tratamiento: 'Presoterapia', Empleada: '', Sala: '' },
    F.resolverColumnas(['Inicio', 'Cliente', 'Tratamiento', 'Empleada', 'Sala'], 'citas').campos);
  assert.deepEqual([junta.fecha, junta.hora, junta.errores], ['2026-10-15', '12:45', []]);
  const mala = F.leerCita({ Cliente: 'Eva', Fecha: '31/02/2026', Hora: '10:00', Servicio: '', Profesional: '', Cabina: '', Estado: '' }, cc);
  assert.deepEqual(mala.errores, ['fecha «31/02/2026» no válida', 'sin servicio']);
  // Lo que no parece una fecha o una hora no se repite: con la columna equivocada, puede ser un nombre.
  const nombre = F.leerCita({ Cliente: 'Eva', Fecha: 'Ruiz Soler, Carmen', Hora: '10:00', Servicio: 'Presoterapia', Profesional: '', Cabina: '', Estado: '' }, cc);
  assert.deepEqual(nombre.errores, ['fecha no válida (no parece una fecha: ¿es la columna buena?)']);
  const hora = F.leerCita({ Cliente: 'Eva', Fecha: '15/10/2026', Hora: 'Carmen', Servicio: 'Presoterapia', Profesional: '', Cabina: '', Estado: '' }, cc);
  assert.deepEqual(hora.errores, ['hora no válida (no parece una hora: ¿es la columna buena?)']);
  assert.deepEqual(F.leerCita({ Cliente: 'Eva', Fecha: '15/10/2026', Hora: '25:00', Servicio: 'Presoterapia', Profesional: '', Cabina: '', Estado: '' }, cc).errores, ['hora «25:00» no válida']);
});

test('la fecha del consentimiento, si Flowww la trae, va con cada «sí» o «no» (para su prueba)', () => {
  const { campos } = F.resolverColumnas(['Código', 'Nombre', 'Acepta publicidad', 'Fecha LOPD'], 'pacientes');
  const hoy = new Date('2026-10-13T08:00:00Z');
  const p = F.leerPaciente({ Código: '1', Nombre: 'Ana', 'Acepta publicidad': 'Sí', 'Fecha LOPD': '03/04/2024' }, campos, { hoy });
  assert.deepEqual(p.consentimientos.map((c) => [c.tipo, c.otorgado, c.desde]), [['whatsapp_marketing', true, '2024-04-03'], ['email_marketing', true, '2024-04-03']]);
  const futura = F.leerPaciente({ Código: '2', Nombre: 'Eva', 'Acepta publicidad': 'No', 'Fecha LOPD': '03/04/2031' }, campos, { hoy });
  assert.deepEqual([futura.consentimientos[0].desde, futura.avisos], [null, ['la fecha del consentimiento no se entiende: no va en su prueba']]);
});

test('¿la misma persona? Mismo teléfono no basta: la madre y la hija comparten móvil', () => {
  assert.equal(F.mismaPersona({ nombre: 'Carmen', apellidos: 'Ruiz Soler' }, { nombre: 'Carmen', apellidos: 'Ruiz' }), true);
  assert.equal(F.mismaPersona({ nombre: 'Carmen', apellidos: 'Ruiz Soler' }, { nombre: 'Lucía', apellidos: 'Ruiz Soler' }), false);
  assert.equal(F.mismaPersona({ nombre: 'Laura' }, { nombre: 'Laura', apellidos: 'Gómez Ruiz' }), true, 'el perfil de WhatsApp no trae apellidos');
  assert.equal(F.mismaPersona({ nombre: 'Lau' }, { nombre: 'Laura' }), true);
  assert.equal(F.mismaPersona({ nombre: 'Maria' }, { nombre: 'María José' }), true);
  assert.equal(F.mismaPersona({ nombre: 'Paciente' }, { nombre: 'Julia' }), true, 'sin nombre de verdad no se puede decir que sea otra');
  assert.equal(F.mismaPersona({ nombre: 'Ana', apellidos: 'Gil' }, { nombre: 'Ana', apellidos: 'Pérez' }), false);
});

test('casar servicios de Flowww con tratamientos: nombre o alias exactos, el mapa y lo guardado; lo parecido solo se sugiere', () => {
  const tratamientos = [
    { id: 'limpieza-facial', nombre: 'Limpieza facial profunda', alias: '["Higiene facial"]' },
    { id: 'toxina-3-zonas', nombre: 'Toxina botulínica 3 zonas (frente, entrecejo y patas de gallo)', alias: null },
    { id: 'presoterapia', nombre: 'Presoterapia / Drenaje linfático', alias: [] },
  ];
  const c = { tratamientos };
  assert.deepEqual(F.casarTratamiento('LIMPIEZA FACIAL PROFUNDA', c), { id: 'limpieza-facial', via: 'nombre' });
  assert.deepEqual(F.casarTratamiento('Higiene  facial', c), { id: 'limpieza-facial', via: 'alias' });
  assert.deepEqual(F.casarTratamiento('Toxina botulínica 3 zonas', c), { id: 'toxina-3-zonas', via: 'alias' }, 'sin el paréntesis');
  assert.deepEqual(F.casarTratamiento('drenaje linfático', c), { id: 'presoterapia', via: 'alias' }, 'cada alternativa de «/»');
  const botox = F.casarTratamiento('Botox 3 zonas', c);
  assert.equal(botox.id, undefined, 'parecido no es lo mismo: no se casa solo');
  assert.equal(botox.sugerencias[0].id, 'toxina-3-zonas');
  const limpieza = F.casarTratamiento('Limpieza facial', c);
  assert.equal(limpieza.id, undefined, 'una «Limpieza facial» no es por fuerza la profunda');
  assert.equal(limpieza.sugerencias[0].id, 'limpieza-facial');
  assert.deepEqual(F.casarTratamiento('Botox 3 zonas', { ...c, mapa: new Map([['botox 3 zonas', 'toxina-3-zonas']]) }), { id: 'toxina-3-zonas', via: 'mapa' });
  assert.deepEqual(F.casarTratamiento('Pack novia', { ...c, mapa: new Map([['pack novia', F.IGNORAR]]) }), { ignorar: true, via: 'mapa' });
  assert.deepEqual(F.casarTratamiento('Botox 3 zonas', { ...c, guardado: new Map([['botox 3 zonas', 'toxina-3-zonas']]) }), { id: 'toxina-3-zonas', via: 'guardado' });
  assert.deepEqual(F.casarTratamiento('Pack novia', c).sugerencias, []);
});

test('casar profesionales y cabinas: sin «Dra.», por el código, por parte del nombre si solo hay uno', () => {
  const profesionales = [
    { id: 10, codigo: 'medico-ejemplo', nombre: 'Dra. Ana Médica Ejemplo' },
    { id: 20, codigo: 'estetica-uno', nombre: 'Estética Uno' },
    { id: 21, codigo: 'estetica-dos', nombre: 'Estética Dos' },
  ];
  assert.deepEqual(F.casarProfesional('Ana Médica Ejemplo', { profesionales }), { id: 10, via: 'nombre' });
  assert.deepEqual(F.casarProfesional('Dra. Médica', { profesionales }), { id: 10, via: 'nombre parcial' });
  assert.deepEqual(F.casarProfesional('estetica-dos', { profesionales }), { id: 21, via: 'nombre' });
  const estetica = F.casarProfesional('Estética', { profesionales });
  assert.equal(estetica.id, undefined, 'dos con esa palabra: no se elige');
  assert.deepEqual(estetica.sugerencias.map((s) => s.codigo).sort(), ['estetica-dos', 'estetica-uno']);
  assert.deepEqual(F.casarProfesional('Rocío', { profesionales, mapa: new Map([['rocio', 21]]) }), { id: 21, via: 'mapa' });
  assert.deepEqual(F.casarProfesional('Cualquiera libre', { profesionales, mapa: new Map([['cualquiera libre', F.CUALQUIERA]]) }), { cualquiera: true, via: 'mapa' });
  const salas = [{ id: 1, codigo: 'cabina-facial', nombre: 'Cabina facial' }, { id: 2, codigo: 'consulta-1', nombre: 'Consulta 1' }];
  assert.deepEqual(F.casarSala('Consulta', { salas }), { id: 2, via: 'nombre parcial' });
  assert.equal(F.casarSala('Box 3', { salas }).id, undefined);
});

test('el mapa: secciones, campos y destinos; lo que no se entiende se dice', () => {
  const m = F.leerMapa({
    _nota: 'comentario',
    citas: { profesional: 'Especialista asignado', observaciones: null },
    tratamientos: { 'Botox 3 zonas': 'toxina-3-zonas', 'Pack novia': 'Ignorar', 'Sin decidir': '' },
    profesionales: { 'Rocío': 'estetica-dos', Suplente: 'cualquiera' },
    estados: { 'En espera': 'importar' },
  });
  assert.deepEqual(m.errores, []);
  assert.deepEqual(m.columnas.citas, { profesional: 'Especialista asignado', observaciones: null });
  assert.deepEqual([...m.tratamientos], [['botox 3 zonas', 'toxina-3-zonas'], ['pack novia', F.IGNORAR]], 'lo vacío queda sin decidir');
  assert.deepEqual([...m.profesionales], [['rocio', 'estetica-dos'], ['suplente', F.CUALQUIERA]]);
  assert.equal(m.textos.get('tratamientos:botox 3 zonas'), 'Botox 3 zonas');
  const mal = F.leerMapa({ servicios: {}, citas: { cabina: 'Box' }, estados: { Rara: 'quizá' } });
  assert.equal(mal.errores.length, 3);
  assert.match(mal.errores[0], /sección que no conozco: «servicios»/);
  assert.match(mal.errores[1], /campo de citas que no existe: «cabina»/);
  assert.match(mal.errores[2], /«Rara» va a «importar» o a «ignorar»/);
  assert.match(F.leerMapa([]).errores[0], /tiene que ser un objeto/);
});
