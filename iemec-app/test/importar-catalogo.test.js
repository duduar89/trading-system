'use strict';
// Importador del catálogo consolidado (scripts/importar-catalogo.js) con un catálogo mínimo
// INVENTADO (test/fixtures/catalogo-minimo.json): cómo pasa cada cosa al formato de las semillas,
// que es determinista, lo que no deja pasar y que lo que sale carga en la base y da huecos en la
// sala que toca.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { convertir, ErrorCatalogo } = require('../scripts/importar-catalogo');
const { semillar } = require('../servidor/semillas');
const agenda = require('../servidor/agenda');

const FIXTURE = path.join(__dirname, 'fixtures', 'catalogo-minimo.json');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'importar-catalogo.js');
const SEMILLAS = path.join(__dirname, '..', 'semillas', 'iemec');
const EQUIPO = JSON.parse(fs.readFileSync(path.join(SEMILLAS, 'equipo.json'), 'utf8'));
const leer = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const porId = (datos) => Object.fromEntries(datos.tratamientos.map((t) => [t.id, t]));
const carpetaTemporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iemec-catalogo-'));
// Lo que es de la investigación y no de la clínica: dudas, reseñas, enlaces, de dónde sale cada
// dato y los valores del sector (otras clínicas, fabricantes).
const INVESTIGACION = /confirmar si|: confirmar|revisar|https?:|\.json|reseña|WhatsApp escribe|\bsector\b|cl[ií]nica ajena|fabricante|\((?:Treatwell|Multiestetica)\)|según la web|citad[oa]s?|sin descripción|validar|otra entrada/i;

test('el importador pasa el catálogo al formato de las semillas', () => {
  const { datos, avisos } = convertir(leer());
  const t = porId(datos);
  assert.deepEqual(Object.keys(datos), ['_origen', 'tratamientos', 'aparatos', 'faqs', 'retirados'], 'ni dudas para la clínica ni trazabilidad');
  assert.doesNotMatch(JSON.stringify(datos), /catalogo-parte|duda-1|¿Dónde se hace el injerto/);
  assert.equal(datos.tratamientos.length, 14);

  // Qué se reserva y qué puede reservar la IA sola.
  const activos = datos.tratamientos.filter((x) => x.activo).map((x) => x.id);
  assert.deepEqual(activos, ['higiene-facial-ejemplo', 'valoracion-ejemplo', 'relleno-ejemplo', 'neuromodulador-ejemplo', 'cirugia-externa-ejemplo',
    'injerto-ejemplo', 'laser-intimo-ejemplo', 'microagujas-ejemplo', 'sin-confirmar-ejemplo', 'ritual-ejemplo']);
  assert.deepEqual(datos.tratamientos.filter((x) => x.reservable_ia).map((x) => x.id),
    ['higiene-facial-ejemplo', 'valoracion-ejemplo', 'laser-intimo-ejemplo', 'microagujas-ejemplo', 'ritual-ejemplo']);
  for (const x of datos.tratamientos.filter((y) => !y.activo)) {
    assert.equal(x.duracion_min, 0, `${x.id}: sin duración, no ocupa agenda`);
    assert.equal(x.reservable_ia, false);
    assert.match(x.notas, /^No se reserva/);
  }
  assert.ok(avisos.some((a) => /agrupador-ejemplo.*reservable/.test(a)), 'el agrupador que el catálogo da por reservable, avisado');
  assert.match(t['tarjeta-ejemplo'].notas, /es un producto/);
  assert.equal(t['tarjeta-ejemplo'].sala_tipo, null);
  assert.equal(t['tarjeta-ejemplo'].rol_profesional, null);

  // Quirófano externo: en IEMEC, la valoración en consulta, y la agenda una persona. Su nombre
  // (el que lee el paciente en la confirmación, el .ics y «Tu cita») es el de la valoración; el de
  // la cirugía queda como alias.
  const externa = t['cirugia-externa-ejemplo'];
  assert.deepEqual([externa.sala_tipo, externa.rol_profesional, externa.duracion_min, externa.reservable_ia], ['consulta_medica', 'cirujano', 45, false]);
  assert.equal(externa.nombre, 'Valoración de cirugía de ejemplo en hospital');
  assert.deepEqual(externa.alias, ['Cirugía de ejemplo en hospital']);
  assert.match(externa.notas, /fuera de IEMEC/);
  assert.doesNotMatch(externa.notas, /Se supone/);
  assert.equal(externa.descripcion, 'Intervención con anestesia general e ingreso.');

  // Sala de procedimientos, aparato fijo de otra sala y rol que se pierde, con su nota.
  const injerto = t['injerto-ejemplo'];
  assert.deepEqual([injerto.sala_tipo, injerto.rol_profesional, injerto.duracion_min, injerto.holgura_despues_min, injerto.reservable_ia],
    ['sala_procedimientos', 'tricologo', 480, 30, false]);
  assert.match(injerto.notas, /Cirugía: la IA no la reserva/);
  assert.equal(injerto.sesiones, '1 intervención');
  const laser = t['laser-intimo-ejemplo'];
  assert.deepEqual([laser.sala_tipo, laser.rol_profesional, laser.equipo_codigo], ['consulta_medica', 'medico', 'laser-fotona']);
  assert.match(laser.notas, /sillón ginecológico.*ginecólogo/);
  assert.doesNotMatch(laser.notas, /Probablemente/);

  // Publicidad restringida: la del catálogo y la de un nombre que dice un medicamento con receta.
  const relleno = t['relleno-ejemplo'];
  assert.equal(relleno.publicidad_restringida, true);
  assert.ok(relleno.motivo_restriccion.length <= 255);
  assert.doesNotMatch(relleno.motivo_restriccion, /https?:/);
  assert.match(relleno.notas, /^Producto sanitario: la IA no lo reserva/);
  assert.match(relleno.notas, /exclusivamente profesional/, 'lo que no cabe en el motivo va a las notas');
  assert.equal(relleno.crema_anestesica_min, 20);
  const neuro = t['neuromodulador-ejemplo'];
  assert.deepEqual([neuro.publicidad_restringida, neuro.reservable_ia], [true, false]);
  assert.match(neuro.motivo_restriccion, /medicamento con receta/);
  // Lo que la clínica no ha confirmado que ofrezca: ni la IA lo reserva ni se anuncia.
  const sinConfirmar = t['sin-confirmar-ejemplo'];
  assert.deepEqual([sinConfirmar.reservable_ia, sinConfirmar.publicidad_restringida], [false, true]);
  assert.match(sinConfirmar.notas, /Oferta sin confirmar/);
  assert.equal(sinConfirmar.motivo_restriccion, 'Oferta sin confirmar por la clínica: no se anuncia hasta que la confirme.');

  // Valores del sector (otras clínicas, fabricantes): las sesiones con sus números y ni sus
  // nombres ni sus enlaces en las fuentes; la norma oficial sí queda.
  assert.equal(relleno.sesiones, '1 sesión');
  assert.deepEqual([relleno.repetir_cada_dias, relleno.repetir_fuente], [240, 'sector']);
  assert.deepEqual(relleno.fuentes, ['https://ejemplo.invalid/relleno', 'https://normas.invalid/producto-sanitario']);

  // Un rol que nadie del equipo tiene (enfermería): lo cubre un médico, con nota.
  const microagujas = t['microagujas-ejemplo'];
  assert.equal(microagujas.rol_profesional, 'medico');
  assert.match(microagujas.notas, /^Lo hace enfermería, que aún no está en el equipo de la agenda/);

  // Datos públicos, limpios: sin último minuto de Treatwell, sin reseñas, sin fuentes en las
  // sesiones ni en la descripción (es la que sale en las publicaciones de Google), sin dudas ni
  // enlaces en las notas, alias sin repetir el nombre.
  const higiene = t['higiene-facial-ejemplo'];
  assert.equal(higiene.precio_texto, '50 € (Treatwell)');
  assert.equal(higiene.sesiones, '1 al mes');
  assert.equal(higiene.descripcion, 'Limpieza de la piel con extracción y mascarilla.');
  assert.deepEqual([higiene.repetir_cada_dias, higiene.repetir_fuente], [30, 'blog']);
  assert.ok(higiene.fuentes.includes('https://iemec-clinic.com/blog/ejemplo-cada-cuanto-una-higiene'));
  assert.deepEqual(higiene.alias, ['Limpieza facial de ejemplo', 'Higiene de ejemplo']);
  assert.equal(higiene.notas, 'Incluye extracción y mascarilla.');
  assert.equal(t['laser-intimo-ejemplo'].descripcion, 'Láser vaginal de ejemplo en consulta.');
  assert.equal(microagujas.descripcion, 'Microagujas en el cuerpo combinables con la higiene facial.');
  assert.equal(t['ritual-ejemplo'].descripcion, 'Ritual con diagnóstico, secado y bebida de bienvenida.');
  assert.equal(sinConfirmar.descripcion, null, 'solo decía que un directorio lo lista sin descripción');
  assert.equal(t['valoracion-ejemplo'].precio_texto, 'Gratuita según un directorio');
  assert.equal(t['relleno-ejemplo'].precio_texto, null);
  assert.equal(t['plan-ejemplo'].nombre, 'Plan de ejemplo');
  assert.match(t['plan-ejemplo'].notas, /Se empieza por «Valoración médica de ejemplo»/);
  assert.match(microagujas.notas, /Usa además: Lámpara LED de ejemplo\./);
  assert.match(microagujas.notas, /con «Higiene facial de ejemplo» en la cara/);
  for (const x of datos.tratamientos) {
    for (const k of ['nombre', 'descripcion', 'sesiones', 'notas', 'motivo_restriccion']) assert.doesNotMatch(x[k] || '', INVESTIGACION, `${x.id}.${k}`);
    assert.deepEqual(x.fuentes.filter((u) => /clinica-ajena|fabricante/.test(u)), [], x.id);
    assert.ok(!x.notas || x.notas.length <= 600);
  }

  // WhatsApp: un texto, un tratamiento. El genérico y el del botón equivocado no se guardan; el
  // compartido se queda en uno que se reserve (el agrupador no está en la agenda).
  const textos = datos.tratamientos.map((x) => x.texto_whatsapp).filter(Boolean);
  assert.equal(new Set(textos).size, textos.length);
  assert.equal(t['valoracion-ejemplo'].texto_whatsapp, null);
  assert.equal(t['laser-intimo-ejemplo'].texto_whatsapp, null);
  assert.match(t['laser-intimo-ejemplo'].notas, /texto de otro tratamiento/);
  assert.equal(t['ritual-ejemplo'].texto_whatsapp, 'Hola, quiero una cita para el ritual de ejemplo');
  assert.equal(t['ritual-agrupador-ejemplo'].texto_whatsapp, null);
  assert.match(t['ritual-agrupador-ejemplo'].notas, /mismo texto que «Ritual capilar de ejemplo»/);

  // Aparatos con código en minúsculas; si el catálogo no dice si es portátil, queda en null.
  assert.deepEqual(datos.aparatos.map((a) => [a.codigo, a.nombre, a.movil, a.unidades]), [
    ['laser-fotona', 'Láser de ejemplo', null, 1], ['pluma-microagujas', 'Pluma de microagujas de ejemplo', true, 2],
    ['lampara-led', 'Lámpara LED de ejemplo', null, 1], ['puesto-head-spa', 'Puesto de ritual capilar de ejemplo', false, 1]]);
  assert.doesNotMatch(datos.aparatos[2].notas, /confirmar/);

  // Preguntas, todas sin aprobar: sin la repetida (mayúsculas y «(otra entrada)» aparte). La que
  // el catálogo marca para validar entra también (la valida el equipo médico al aprobarla), sin
  // las marcas de la investigación.
  assert.deepEqual(datos.faqs.map((f) => [f.tratamiento_id, f.pregunta, f.respuesta]), [
    ['higiene-facial-ejemplo', '¿Duele?', 'No, es muy suave.'], ['relleno-ejemplo', '¿Cuánto dura el efecto?', 'Entre 9 y 12 meses.'],
    ['valoracion-ejemplo', '¿Cuánto dura la valoración?', 'Una media hora.'], ['relleno-ejemplo', '¿Duele?', 'Se nota un pinchazo; se puede aplicar crema anestésica.']]);
  assert.ok(avisos.some((a) => /1 preguntas frecuentes que el catálogo marca para validar se cargan/.test(a)));
  assert.deepEqual(datos.retirados, { tratamientos: [], aparatos: [] });
});

test('el importador: precio de solo último minuto o de una reseña, sala concreta de la clínica', () => {
  const c = leer();
  const t = (d) => porId(d.datos);
  // Si el texto de precio solo trae lo que no vale (último minuto de Treatwell, una reseña), no hay
  // precio publicado (antes: TypeError y el importador se paraba; o '' en vez de null).
  c.tratamientos[0].precio_texto = '«Último minuto» en Treatwell desde 26 €';
  c.tratamientos[1].precio_texto = '(una reseña habla de 80 €)';
  // La clínica escribe la sala concreta en la plantilla de salas: pasa tal cual a las semillas.
  c.tratamientos[0].sala_id = 'cabina-corporal';
  const d = t(convertir(c));
  assert.equal(d['higiene-facial-ejemplo'].precio_texto, null);
  assert.equal(d['valoracion-ejemplo'].precio_texto, null);
  assert.deepEqual(d['higiene-facial-ejemplo'].salas, ['cabina-corporal']);
  // Con enfermería en el equipo, el rol se queda.
  const conEnfermeria = { ...EQUIPO, profesionales: [...EQUIPO.profesionales, { codigo: 'enfermeria-1', nombre: 'Enfermería 1', rol: 'enfermeria' }] };
  assert.equal(t(convertir(leer(), { equipo: conEnfermeria }))['microagujas-ejemplo'].rol_profesional, 'enfermeria');
});

test('el importador es determinista y retira lo que ya no está en el catálogo', () => {
  const dir = carpetaTemporal();
  try {
    assert.deepEqual(convertir(leer()), convertir(leer()));
    const salida = path.join(dir, 'tratamientos.json');
    fs.writeFileSync(salida, JSON.stringify({ tratamientos: [{ id: 'viejo-ejemplo' }, { id: 'higiene-facial-ejemplo' }], aparatos: [{ codigo: 'aparato-viejo' }] }));
    const r1 = spawnSync(process.execPath, [SCRIPT, FIXTURE, salida], { encoding: 'utf8' });
    assert.equal(r1.status, 0, r1.stderr);
    assert.match(r1.stdout, /14 tratamientos: 10 se reservan, 5 los puede reservar la IA/);
    const primera = fs.readFileSync(salida, 'utf8');
    assert.deepEqual(JSON.parse(primera).retirados, { tratamientos: ['viejo-ejemplo'], aparatos: ['aparato-viejo'] });
    // Otra vez con el mismo catálogo: el mismo fichero, byte a byte, y lo retirado sigue retirado.
    const r2 = spawnSync(process.execPath, [SCRIPT, FIXTURE, salida], { encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(fs.readFileSync(salida, 'utf8'), primera);
    assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2, 'sin catálogo, dice cómo se usa');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lo que no encaja en la app no pasa: el importador se para y dice qué falta', () => {
  const con = (cambio) => { const c = leer(); cambio(c); return () => convertir(c); };
  assert.throws(con((c) => { c.tratamientos[0].familia = 'podologia'; }), (e) => e instanceof ErrorCatalogo && /Familia nueva «podologia».*FAMILIAS/.test(e.message));
  assert.throws(con((c) => { c.tratamientos[0].sala_tipo = 'solarium'; }), /Tipo de sala desconocido «solarium»/);
  assert.throws(con((c) => { c.tratamientos[0].profesional = 'fisioterapeuta'; }), /Profesional desconocido «fisioterapeuta»/);
  assert.throws(con((c) => { c.tratamientos[0].equipo_codigo = 'NO-EXISTE'; }), /aparato «NO-EXISTE»/);
  assert.throws(con((c) => { c.tratamientos[1].id = c.tratamientos[0].id; }), /Id repetido/);
  assert.throws(con((c) => { c.tratamientos[0].duracion_min = null; }), /se reserva y no tiene duración/);
  assert.throws(con((c) => { c.faqs[0].tratamiento_id = 'otro-que-no-esta'; }), /no está en el catálogo/);
  assert.throws(con((c) => { c.tratamientos[0].regimen_legal = 'suplemento'; }), /Régimen legal desconocido/);
  // Una sala que no está en la agenda (semillas/iemec/equipo.json) dejaría el tratamiento sin huecos.
  assert.throws(con((c) => { c.tratamientos[5].sala_id = 'sala-procedimientos'; }),
    (e) => e instanceof ErrorCatalogo && /«injerto-ejemplo» va a la sala «sala-procedimientos».*Salas: consulta-1, consulta-2, cabina-laser/.test(e.message));
  // Un rol que nadie tiene y que no puede cubrir un médico, igual.
  const sinEstetica = { ...EQUIPO, profesionales: EQUIPO.profesionales.filter((p) => p.rol !== 'esteticista') };
  assert.throws(() => convertir(leer(), { equipo: sinEstetica }), /«higiene-facial-ejemplo» lo hace el rol «esteticista» y nadie del equipo lo tiene/);
});

test('lo importado carga en la base: cada tratamiento, en su sala y con huecos', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const dir = carpetaTemporal();
  try {
    const anterior = { tratamientos: [{ id: 'viejo-ejemplo' }, { id: 'viejo-validado' }], aparatos: [{ codigo: 'aparato-viejo' }] };
    const { datos } = convertir(leer(), { anterior });
    fs.writeFileSync(path.join(dir, 'tratamientos.json'), JSON.stringify(datos));
    for (const f of ['clinica.json', 'equipo.json']) fs.copyFileSync(path.join(SEMILLAS, f), path.join(dir, f));
    // Lo que había de antes: un tratamiento cualquiera y otro que la clínica ya validó.
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
    await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, regimen_legal, validado_clinica) VALUES
      ('viejo-ejemplo', 'Viejo', 'facial', 30, 'servicio', FALSE), ('viejo-validado', 'Viejo validado', 'facial', 30, 'servicio', TRUE)`);
    await pool.query("INSERT INTO equipos (codigo, nombre) VALUES ('aparato-viejo', 'Aparato viejo')");

    await semillar(pool, { carpeta: dir });
    const { avisos } = await semillar(pool, { carpeta: dir });
    assert.deepEqual(avisos, [], 'nada se queda sin huecos por sala, aparato o rol');
    const [[n]] = await pool.query(`SELECT (SELECT COUNT(*) FROM tratamientos WHERE id LIKE '%-ejemplo' AND id <> 'viejo-ejemplo') AS trats,
      (SELECT COUNT(*) FROM equipos WHERE activo) AS equipos, (SELECT COUNT(*) FROM respuestas_aprobadas) AS faqs,
      (SELECT COUNT(*) FROM respuestas_aprobadas WHERE aprobada) AS aprobadas`);
    assert.deepEqual({ ...n }, { trats: 14, equipos: 4, faqs: 4, aprobadas: 0 });
    const [viejos] = await pool.query("SELECT id, activo, reservable_ia FROM tratamientos WHERE id LIKE 'viejo%' ORDER BY id");
    assert.deepEqual(viejos.map((v) => [v.id, Boolean(v.activo), Boolean(v.reservable_ia)]), [['viejo-ejemplo', false, false], ['viejo-validado', true, true]],
      'se retira (y la IA deja de ofrecerlo), salvo lo validado');
    const [[aparatoViejo]] = await pool.query("SELECT activo FROM equipos WHERE codigo = 'aparato-viejo'");
    assert.equal(Boolean(aparatoViejo.activo), false);

    // Cada tratamiento que se reserva, en su sala concreta; los demás, sin sala.
    const [pares] = await pool.query('SELECT ts.tratamiento_id AS id, s.codigo FROM tratamiento_salas ts JOIN salas s ON s.id = ts.sala_id ORDER BY s.codigo');
    const salas = {};
    for (const p of pares) (salas[p.id] ||= []).push(p.codigo);
    assert.deepEqual(salas, {
      'higiene-facial-ejemplo': ['cabina-facial'], 'valoracion-ejemplo': ['consulta-1', 'consulta-2'], 'relleno-ejemplo': ['consulta-1', 'consulta-2'],
      'neuromodulador-ejemplo': ['consulta-1', 'consulta-2'], 'cirugia-externa-ejemplo': ['consulta-1', 'consulta-2'],
      'injerto-ejemplo': ['sala-capilar'], 'laser-intimo-ejemplo': ['cabina-laser'], 'microagujas-ejemplo': ['cabina-corporal'],
      'sin-confirmar-ejemplo': ['cabina-corporal'], 'ritual-ejemplo': ['head-spa'],
    });
    const [equipos] = await pool.query('SELECT e.codigo, e.movil, s.codigo AS sala FROM equipos e LEFT JOIN salas s ON s.id = e.sala_id WHERE e.activo ORDER BY e.codigo');
    assert.deepEqual(equipos.map((e) => [e.codigo, Boolean(e.movil), e.sala]), [
      ['lampara-led', true, null], ['laser-fotona', false, 'cabina-laser'], ['pluma-microagujas', true, null], ['puesto-head-spa', false, null]]);

    // Con todo el equipo trabajando un martes, cada uno tiene huecos, y solo en su sala.
    await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) SELECT id, 2, '11:00', '20:00' FROM profesionales");
    const [idSalas] = await pool.query('SELECT id, codigo FROM salas');
    const codigo = Object.fromEntries(idSalas.map((s) => [s.id, s.codigo]));
    for (const [id, suyas] of Object.entries(salas)) {
      const h = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: id, ahora: new Date('2026-09-29T08:00:00Z') });
      assert.ok(h.length > 0, `${id} sin huecos`);
      assert.ok(h.every((x) => suyas.includes(codigo[x.salaId])), `${id} fuera de su sala`);
    }
    // El injerto de 8 horas cabe en la jornada: de 11:00 a 19:00 como pronto.
    const injerto = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: 'injerto-ejemplo', ahora: new Date('2026-09-29T08:00:00Z') });
    assert.equal(injerto[0].hora, '11:00');
    await assert.rejects(agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: 'tarjeta-ejemplo' }), /No existe el tratamiento/, 'lo que no se reserva no está en la agenda');

    // Las preguntas sin aprobar se ponen al día con el catálogo; las aprobadas no se tocan.
    await pool.query("UPDATE respuestas_aprobadas SET aprobada = TRUE, aprobada_por = 'equipo médico' WHERE tratamiento_id = 'valoracion-ejemplo'");
    datos.faqs = datos.faqs.map((f) => ({ ...f, respuesta: `${f.respuesta} (revisada)` }));
    fs.writeFileSync(path.join(dir, 'tratamientos.json'), JSON.stringify(datos));
    await semillar(pool, { carpeta: dir });
    const [faqs] = await pool.query('SELECT tratamiento_id, respuesta FROM respuestas_aprobadas ORDER BY id');
    assert.deepEqual(faqs.map((f) => [f.tratamiento_id, /revisada/.test(f.respuesta)]),
      [['higiene-facial-ejemplo', true], ['relleno-ejemplo', true], ['valoracion-ejemplo', false], ['relleno-ejemplo', true]]);

    // Una sala concreta que no está en la agenda (se cambió el equipo después de importar): la
    // semilla no deja el tratamiento sin sala, usa la de por defecto y lo avisa.
    datos.tratamientos.find((x) => x.id === 'higiene-facial-ejemplo').salas = ['cabina-2'];
    fs.writeFileSync(path.join(dir, 'tratamientos.json'), JSON.stringify(datos));
    const { avisos: conSalaRara } = await semillar(pool, { carpeta: dir });
    assert.deepEqual(conSalaRara, ['«higiene-facial-ejemplo» va a una sala que no está en la agenda (cabina-2): se usa la sala por defecto']);
    const [higiene] = await pool.query("SELECT s.codigo FROM tratamiento_salas ts JOIN salas s ON s.id = ts.sala_id WHERE ts.tratamiento_id = 'higiene-facial-ejemplo'");
    assert.deepEqual(higiene.map((s) => s.codigo), ['cabina-facial']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await pool.end();
  }
});
