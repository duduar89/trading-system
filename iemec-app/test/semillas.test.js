'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { semillar, FAMILIAS } = require('../servidor/semillas');
const { MEDICAMENTOS } = require('../motor/repesca/filtro-legal');
const { normalizar } = require('../motor/repesca/interpretar');
const agenda = require('../servidor/agenda');

// El catálogo consolidado de la F0, tal como lo deja scripts/importar-catalogo.js. Si llega una
// versión revisada y se vuelve a importar, los recuentos se ponen al día aquí.
const CATALOGO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'semillas', 'iemec', 'tratamientos.json'), 'utf8'));
const RECUENTO = { tratamientos: 169, seReservan: 155, reservaLaIa: 67, restringidos: 54, quirofanoExterno: 17, aparatos: 26, preguntas: 327 };

test('el fichero del catálogo: ids únicos, familias conocidas y un texto de WhatsApp para un solo tratamiento', () => {
  const ids = CATALOGO.tratamientos.map((t) => t.id);
  assert.equal(ids.length, RECUENTO.tratamientos);
  assert.equal(new Set(ids).size, ids.length, 'sin ids repetidos');
  assert.ok(ids.every((id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) && id.length <= 80));
  const familias = new Set(FAMILIAS.map(([codigo]) => codigo));
  assert.deepEqual(CATALOGO.tratamientos.filter((t) => !familias.has(t.familia)).map((t) => t.id), []);
  const textos = CATALOGO.tratamientos.map((t) => t.texto_whatsapp).filter(Boolean);
  assert.equal(new Set(textos.map(normalizar)).size, textos.length);
  const codigos = CATALOGO.aparatos.map((a) => a.codigo);
  assert.equal(new Set(codigos).size, RECUENTO.aparatos);
  assert.ok(codigos.every((c) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c)), 'códigos de aparato en minúsculas con guiones');
  const preguntas = CATALOGO.faqs.map((f) => `${f.tratamiento_id}|${normalizar(f.pregunta)}`);
  assert.equal(new Set(preguntas).size, preguntas.length, 'sin preguntas repetidas en un mismo tratamiento');
  // Lo retirado del catálogo provisional no vuelve a entrar.
  assert.deepEqual(CATALOGO.retirados.tratamientos.filter((id) => ids.includes(id)), []);
  // Solo datos públicos útiles: ni dudas para la clínica, ni reseñas, ni rastro de la investigación.
  assert.deepEqual(Object.keys(CATALOGO), ['_origen', 'tratamientos', 'aparatos', 'faqs', 'retirados']);
  const investigacion = /confirmar si|: confirmar|revisar|https?:|\.md\b|\.json\b|reseñ|opini[oó]n|repesca|trazabilidad/i;
  assert.deepEqual(CATALOGO.tratamientos.filter((x) => investigacion.test(`${x.notas} ${x.motivo_restriccion} ${x.precio_texto}`)).map((x) => x.id), []);
  assert.deepEqual(CATALOGO.aparatos.filter((a) => investigacion.test(a.notas || '')).map((a) => a.codigo), []);
});

test('las semillas de la clínica cargan y se pueden repetir sin duplicar', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await semillar(pool);
    await semillar(pool);
    const [[cl]] = await pool.query('SELECT nombre_corto, google_place_id, municipio FROM clinica');
    assert.deepEqual({ ...cl }, { nombre_corto: 'IEMEC', google_place_id: 'ChIJB6Pn5d2FQQ0ReZ4Qoqe8gtg', municipio: 'Boadilla del Monte' });
    const [[f]] = await pool.query("SELECT nombre FROM festivos WHERE fecha = '2026-10-05'");
    assert.equal(f.nombre, 'Virgen del Rosario');
    const [[n]] = await pool.query(`SELECT (SELECT COUNT(*) FROM salas) AS salas, (SELECT COUNT(*) FROM profesionales) AS profs,
      (SELECT COUNT(*) FROM plantillas) AS plantillas, (SELECT COUNT(*) FROM ofertas WHERE activa) AS ofertas_activas,
      (SELECT COUNT(*) FROM familias) AS familias, (SELECT COUNT(*) FROM tratamientos) AS tratamientos,
      (SELECT COUNT(*) FROM tratamientos WHERE activo) AS se_reservan, (SELECT COUNT(*) FROM tratamientos WHERE reservable_ia) AS reserva_la_ia,
      (SELECT COUNT(*) FROM tratamientos WHERE publicidad_restringida) AS restringidos, (SELECT COUNT(*) FROM equipos) AS aparatos,
      (SELECT COUNT(*) FROM respuestas_aprobadas) AS preguntas, (SELECT COUNT(*) FROM respuestas_aprobadas WHERE aprobada) AS aprobadas`);
    assert.deepEqual({ ...n }, {
      salas: 7, profs: 10, plantillas: 17, ofertas_activas: 0, familias: FAMILIAS.length, tratamientos: RECUENTO.tratamientos, se_reservan: RECUENTO.seReservan,
      reserva_la_ia: RECUENTO.reservaLaIa, restringidos: RECUENTO.restringidos, aparatos: RECUENTO.aparatos, preguntas: RECUENTO.preguntas, aprobadas: 0,
    }, 'las ofertas llegan desactivadas y ninguna plantilla ni respuesta se da por aprobada');
    const [[pl]] = await pool.query("SELECT COUNT(*) AS n FROM plantillas WHERE estado <> 'borrador'");
    assert.equal(Number(pl.n), 0, 'ninguna plantilla se da por aprobada sin Meta');

    // Lo que se reserva tiene duración y sala; lo que no (agrupadores, productos, tarjetas
    // regalo, promociones), ni sala ni IA.
    const [trats] = await pool.query(`SELECT t.id, t.activo, t.reservable_ia, t.duracion_min, COUNT(ts.sala_id) AS salas
      FROM tratamientos t LEFT JOIN tratamiento_salas ts ON ts.tratamiento_id = t.id GROUP BY t.id`);
    assert.deepEqual(trats.filter((x) => x.activo && !(x.duracion_min > 0)).map((x) => x.id), [], 'ninguna duración 0 en lo que se reserva');
    assert.deepEqual(trats.filter((x) => x.activo && !Number(x.salas)).map((x) => x.id), [], 'todo lo que se reserva tiene sala');
    assert.deepEqual(trats.filter((x) => !x.activo && (x.reservable_ia || Number(x.salas))).map((x) => x.id), []);

    // Con el catálogo cargado, un día normal tiene huecos para la limpieza facial.
    for (const d of [1, 2, 3, 4, 5]) {
      await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) SELECT id, ?, '11:00', '20:00' FROM profesionales WHERE rol = 'esteticista'", [d]);
    }
    const h = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: 'limpieza-facial-profunda', ahora: new Date('2026-09-29T08:00:00Z') });
    assert.ok(h.length > 0);
  } finally {
    await pool.end();
  }
});

test('lo legal: restringidos marcados y fuera de la IA; el quirófano externo, valoración en consulta', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await semillar(pool);
    const [trats] = await pool.query('SELECT id, nombre, alias, regimen_legal, publicidad_restringida, motivo_restriccion, reservable_ia, activo, sala_tipo, notas, subfamilia FROM tratamientos');
    // Medicamentos con receta, productos sanitarios y régimen sin confirmar: publicidad restringida,
    // con su motivo, y la IA no los reserva (sí las valoraciones).
    const restringibles = trats.filter((x) => ['medicamento_receta', 'producto_sanitario', 'desconocido'].includes(x.regimen_legal));
    assert.ok(restringibles.length >= 50);
    assert.deepEqual(restringibles.filter((x) => !x.publicidad_restringida || !x.motivo_restriccion).map((x) => x.id), []);
    assert.deepEqual(trats.filter((x) => x.publicidad_restringida && x.reservable_ia).map((x) => x.id), [], 'lo restringido lo reserva una persona');
    // Si el nombre dice un medicamento con receta, está restringido.
    const nombraMedicamento = (x) => MEDICAMENTOS.some((m) => new RegExp(`\\b${normalizar(m)}\\b`).test(normalizar(`${x.nombre} ${JSON.stringify(x.alias)}`)));
    const conMedicamento = trats.filter(nombraMedicamento);
    assert.ok(conMedicamento.some((x) => x.id === 'toxina-botulinica-facial') && conMedicamento.some((x) => x.id === 'semaglutida'));
    assert.deepEqual(conMedicamento.filter((x) => !x.publicidad_restringida).map((x) => x.id), []);
    // Ninguna cirugía la reserva la IA.
    assert.deepEqual(trats.filter((x) => x.regimen_legal === 'cirugia' && x.reservable_ia).map((x) => x.id), []);
    // Las valoraciones sí.
    const valoraciones = trats.filter((x) => x.subfamilia === 'valoracion');
    assert.ok(valoraciones.length >= 5 && valoraciones.every((x) => x.activo && x.reservable_ia), 'las valoraciones las reserva la IA');

    // Quirófano externo (se opera en el hospital): en IEMEC, la valoración en consulta, sin IA.
    const externos = trats.filter((x) => /fuera de IEMEC/.test(x.notas || ''));
    assert.equal(externos.length, RECUENTO.quirofanoExterno);
    assert.ok(externos.some((x) => x.id === 'aumento-pecho') && externos.some((x) => x.id === 'balon-gastrico'));
    for (const x of externos) assert.deepEqual([x.id, x.sala_tipo, Boolean(x.reservable_ia), Boolean(x.activo)], [x.id, 'consulta_medica', false, true]);
    const [salasExternos] = await pool.query(`SELECT DISTINCT s.codigo FROM tratamiento_salas ts JOIN salas s ON s.id = ts.sala_id WHERE ts.tratamiento_id IN (?) ORDER BY s.codigo`,
      [externos.map((x) => x.id)]);
    assert.deepEqual(salasExternos.map((s) => s.codigo), ['consulta-1', 'consulta-2']);

    // Sala de procedimientos (cirugía menor): el tipo existe (migración 006) y el injerto va, de
    // momento, a la sala capilar.
    const [[injerto]] = await pool.query(`SELECT t.sala_tipo, t.duracion_min, GROUP_CONCAT(s.codigo) AS salas FROM tratamientos t
      JOIN tratamiento_salas ts ON ts.tratamiento_id = t.id JOIN salas s ON s.id = ts.sala_id WHERE t.id = 'injerto-capilar-fue' GROUP BY t.id`);
    assert.deepEqual({ ...injerto }, { sala_tipo: 'sala_procedimientos', duracion_min: 480, salas: 'sala-capilar' });
  } finally {
    await pool.end();
  }
});

test('cada tratamiento tiene su sala concreta y el motor solo ofrece esa', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await semillar(pool);
    const [trats] = await pool.query('SELECT t.id, t.nombre, t.familia, t.equipo_codigo, t.rol_profesional FROM tratamientos t WHERE t.activo');
    const [pares] = await pool.query('SELECT ts.tratamiento_id, s.codigo FROM tratamiento_salas ts JOIN salas s ON s.id = ts.sala_id');
    const salasDe = new Map();
    for (const p of pares) (salasDe.get(p.tratamiento_id) || salasDe.set(p.tratamiento_id, []).get(p.tratamiento_id)).push(p.codigo);
    const sinSala = trats.filter((x) => !salasDe.has(x.id));
    assert.deepEqual(sinSala.map((x) => x.nombre), [], 'todos los tratamientos reservables tienen sala asignada');

    // Cada aparato que se usa existe; el fijo vive en una cabina y lo que lo usa va a esa cabina.
    const [equipos] = await pool.query('SELECT e.codigo, e.movil, e.activo, s.codigo AS sala FROM equipos e LEFT JOIN salas s ON s.id = e.sala_id');
    const equipo = new Map(equipos.map((e) => [e.codigo, e]));
    for (const x of trats.filter((y) => y.equipo_codigo)) {
      const e = equipo.get(x.equipo_codigo);
      assert.ok(e?.activo, `${x.id} usa ${x.equipo_codigo}, que no está`);
      if (!e.movil) assert.deepEqual(salasDe.get(x.id), [e.sala], `${x.id} tiene que ir a ${e.sala}, donde está ${e.codigo}`);
    }
    const fijos = equipos.filter((e) => !e.movil);
    assert.ok(fijos.length >= 10 && fijos.every((e) => e.sala), 'los aparatos fijos tienen su cabina');
    assert.equal(equipo.get('laser-fotona').sala, 'cabina-laser');
    assert.equal(Boolean(equipo.get('dermapen').movil), true, 'el Dermapen va de cabina en cabina');

    // Con todos los profesionales trabajando un martes normal, cada tratamiento tiene huecos… y solo en su sala.
    for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) SELECT id, ?, '11:00', '20:00' FROM profesionales", [d]);
    const [salas] = await pool.query('SELECT id, codigo FROM salas');
    const codigo = Object.fromEntries(salas.map((s) => [s.id, s.codigo]));
    const sinHueco = [];
    for (const x of trats) {
      const h = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: x.id, ahora: new Date('2026-09-29T08:00:00Z') });
      if (!h.length) { sinHueco.push(x.nombre); continue; }
      for (const hu of h) assert.ok(salasDe.get(x.id).includes(codigo[hu.salaId]), `${x.nombre} se ha ofrecido en ${codigo[hu.salaId]}`);
    }
    assert.deepEqual(sinHueco, [], 'ningún tratamiento reservable se queda sin huecos por falta de sala, aparato o profesional');

    // Fijar un tratamiento a UNA sala concreta: aunque la otra consulta esté libre, solo se ofrece esa.
    const medico = trats.find((x) => salasDe.get(x.id).length === 2);
    assert.ok(medico);
    const c2 = salas.find((s) => s.codigo === 'consulta-2').id;
    await pool.query('DELETE FROM tratamiento_salas WHERE tratamiento_id = ?', [medico.id]);
    await pool.query('INSERT INTO tratamiento_salas (tratamiento_id, sala_id) VALUES (?, ?)', [medico.id, c2]);
    const h = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: medico.id, ahora: new Date('2026-09-29T08:00:00Z') });
    assert.ok(h.length > 0);
    assert.ok(h.every((x) => x.salaId === c2), 'solo en la consulta 2');
    // Y volver a sembrar no pisa lo que la clínica cambió.
    await semillar(pool);
    const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM tratamiento_salas WHERE tratamiento_id = ?', [medico.id]);
    assert.equal(Number(n.n), 1);
  } finally {
    await pool.end();
  }
});

test('el catálogo provisional se retira al sembrar el consolidado, salvo lo que validó la clínica', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    // Una base con el catálogo provisional: dos tratamientos y un aparato de entonces.
    const [viejo, validado] = CATALOGO.retirados.tratamientos;
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
    await pool.query("INSERT INTO tratamientos (id, nombre, familia, duracion_min, regimen_legal, validado_clinica) VALUES (?, 'Provisional', 'facial', 30, 'servicio', FALSE), (?, 'Validado', 'facial', 30, 'servicio', TRUE)", [viejo, validado]);
    await pool.query("INSERT INTO equipos (codigo, nombre, movil) VALUES ('plexr', 'Plexr', FALSE), (?, 'Aparato provisional', FALSE)", [CATALOGO.retirados.aparatos[0]]);
    await semillar(pool);
    const [filas] = await pool.query('SELECT id, activo, reservable_ia FROM tratamientos WHERE id IN (?, ?) ORDER BY validado_clinica', [viejo, validado]);
    assert.deepEqual(filas.map((f) => [Boolean(f.activo), Boolean(f.reservable_ia)]), [[false, false], [true, true]]);
    const [[ia]] = await pool.query('SELECT COUNT(*) AS n FROM tratamientos WHERE reservable_ia AND NOT activo');
    assert.equal(Number(ia.n), 0, 'la IA no ofrece nada que no esté en la agenda');
    const [aparatos] = await pool.query('SELECT codigo, movil, activo FROM equipos WHERE codigo IN (?, ?) ORDER BY codigo', ['plexr', CATALOGO.retirados.aparatos[0]]);
    const porCodigo = Object.fromEntries(aparatos.map((a) => [a.codigo, a]));
    assert.equal(Boolean(porCodigo[CATALOGO.retirados.aparatos[0]].activo), false, 'el aparato que ya no está, retirado');
    assert.equal(Boolean(porCodigo.plexr.movil), true, 'el Plexr sin confirmar se pone al día: es de mano');
  } finally {
    await pool.end();
  }
});
