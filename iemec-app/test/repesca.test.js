'use strict';
// La repesca de punta a punta contra MariaDB: el caso de la clínica («el mes que viene») con fecha,
// «como quedamos», recordatorio y cierre; precio con oferta; baja; salud urgente; y dos cron a la
// vez sin mensajes dobles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const R = require('../servidor/repesca/motor');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const T = require('../motor/tiempo');

const FESTIVOS = [['2026-10-05', 'Virgen del Rosario', 'local'], ['2026-10-12', 'Fiesta Nacional', 'nacional'], ['2026-11-02', 'Todos los Santos (traslado)', 'autonomico']];
const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto) VALUES (1, 'IEMEC', 'IEMEC')");
  for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (6, '10:00', '20:00')");
  for (const f of FESTIVOS) await pool.query('INSERT INTO festivos (fecha, nombre, ambito) VALUES (?, ?, ?)', f);
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-1', 'Cabina 1', 'cabina_estetica'), (2, 'consulta-1', 'Consulta 1', 'consulta_medica')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Esteticista 1', 'esteticista'), (10, 'medico-1', 'Médico 1', 'medico')");
  for (const d of [1, 2, 3, 4, 5, 6]) {
    await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '20:00'), (10, ?, '11:00', '20:00')", [d, d]);
  }
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial'), ('medicina_capilar', 'Medicina capilar')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal) VALUES
    ('limpieza-facial', 'Limpieza facial', 'facial', 60, 10, 60, 'esteticista', 'cabina_estetica', 'cosmetico'),
    ('toxina-facial', 'Toxina facial', 'facial', 30, 10, 300, 'medico', 'consulta_medica', 'medicamento_receta'),
    ('prp-capilar', 'PRP capilar', 'medicina_capilar', 45, 10, NULL, 'medico', 'consulta_medica', 'medicamento_receta')`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
  await pool.query(`INSERT INTO ofertas (codigo, nombre, tipo, texto_paciente, familias) VALUES
    ('bono-facial-3', 'Bono de 3 limpiezas', 'bono', 'Si te encaja, con el bono de 3 limpiezas cada sesión te sale más económica.', '["facial"]'),
    ('plazos-3', 'Pago en 3 plazos', 'plazos', 'Puedes pagarlo en 3 plazos sin intereses.', NULL),
    ('valoracion', 'Valoración gratuita', 'valoracion', 'Te hacemos una valoración gratuita con el médico para ver qué necesitas de verdad.', NULL)`);
}

async function nuevoLead(pool, { telefono, nombre, tratamiento }) {
  const [r] = await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES (?, ?, 'meta_formulario', ?)", [telefono, nombre, tratamiento]);
  return r.insertId;
}

test('repesca de punta a punta', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);

    await t.test('el caso de la clínica: «el mes que viene» → se le escribe el martes 6-oct (el lunes 5 es fiesta), no al día siguiente', async () => {
      const leadId = await nuevoLead(pool, { telefono: '+34611000001', nombre: 'Laura Pérez', tratamiento: 'limpieza-facial' });
      const entra = new Date('2026-09-29T10:00:00Z'); // martes 12:00 en Madrid
      await R.inscribir(pool, { secuencia: 'lead', leadId, inicio: entra });
      const s1 = await R.avanzarSecuencias(deps, { ahora: entra });
      assert.equal(s1[0].plantilla, 'iemec_lead_bienvenida');
      assert.equal(whatsapp.enviados.at(-1).variables[0], 'Laura');

      const r = await R.procesarEntrante(deps, { telefono: '+34611000001', texto: 'Bueno, pero el mes que viene me viene mejor', ahora: new Date('2026-09-29T10:30:00Z') });
      const seg = r.decision.acciones.find((a) => a.tipo === 'programar_seguimiento');
      assert.equal(seg.fecha, '2026-10-06');
      assert.match(r.respuesta, /martes 6 de octubre/);
      assert.match(r.respuesta, /asistente virtual/);
      assert.ok(r.huecos.length >= 1, 'ofrece dejar ya un hueco de octubre');
      assert.ok(r.huecos.every((h) => h.fecha >= '2026-10-06'));

      const [[ins]] = await pool.query('SELECT estado FROM inscripciones WHERE lead_id = ?', [leadId]);
      assert.equal(ins.estado, 'pausada', 'la secuencia se para en cuanto contesta');
      // Al día siguiente no sale nada.
      assert.deepEqual(await R.avanzarSecuencias(deps, { ahora: new Date('2026-09-30T10:00:00Z') }), []);
      assert.deepEqual(await R.procesarSeguimientos(deps, { ahora: new Date('2026-09-30T10:00:00Z') }), []);
      // La frase exacta queda guardada (cifrada) y el próximo paso, a la vista.
      const [[s]] = await pool.query("SELECT * FROM seguimientos WHERE estado = 'pendiente' AND conversacion_id = ?", [r.conversacionId]);
      assert.equal(madrid(s.programado_para), '2026-10-06 11:30');
      assert.ok(!String(s.frase_cifrada).includes('mes que viene'));
      assert.deepEqual(await R.sinProximoPaso(pool, new Date('2026-09-30T10:00:00Z')), []);

      // 6-oct: «como quedamos» con plantilla (la ventana de 24 h ya se cerró).
      const enviadosAntes = whatsapp.enviados.length;
      const d6 = await R.procesarSeguimientos(deps, { ahora: new Date('2026-10-06T09:31:00Z') });
      assert.equal(d6.length, 1);
      assert.equal(whatsapp.enviados.length, enviadosAntes + 1);
      assert.equal(whatsapp.enviados.at(-1).nombre, 'iemec_como_quedamos');
      assert.equal(d6[0].siguiente.motivo, 'recordatorio');
      assert.equal(d6[0].siguiente.fecha, '2026-10-10');
      // Recordatorio y, si sigue sin contestar, cierre.
      const d10 = await R.procesarSeguimientos(deps, { ahora: new Date('2026-10-10T09:31:00Z') });
      assert.equal(d10[0].siguiente.motivo, 'cierre_sin_respuesta');
      const d14 = await R.procesarSeguimientos(deps, { ahora: new Date('2026-10-14T10:00:00Z') });
      assert.equal(d14[0].cierre, true);
      const [[c]] = await pool.query('SELECT estado, motivo_cierre FROM conversaciones WHERE id = ?', [r.conversacionId]);
      assert.deepEqual({ ...c }, { estado: 'cerrada', motivo_cierre: 'sin_respuesta' });
    });

    await t.test('«me parece muy caro» recibe una oferta del catálogo, registrada', async () => {
      const leadId = await nuevoLead(pool, { telefono: '+34611000002', nombre: 'Marta', tratamiento: 'limpieza-facial' });
      await R.inscribir(pool, { secuencia: 'lead', leadId, inicio: new Date('2026-09-29T10:00:00Z') });
      await R.avanzarSecuencias(deps, { ahora: new Date('2026-09-29T10:00:00Z') });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000002', texto: 'Me parece muy caro', ahora: new Date('2026-09-29T11:00:00Z') });
      const o = r.decision.acciones.find((a) => a.tipo === 'ofrecer');
      assert.ok(o);
      assert.match(r.respuesta, /bono de 3 limpiezas/);
      const [[h]] = await pool.query('SELECT COUNT(*) AS n FROM ofertas_hechas WHERE conversacion_id = ?', [r.conversacionId]);
      assert.equal(h.n, 1);
      // Si vuelve a decir que es caro, no se repite la oferta ni se le persigue: se cierra por precio.
      await pool.query("UPDATE ofertas_hechas SET estado = 'rechazada' WHERE conversacion_id = ?", [r.conversacionId]);
      const r2 = await R.procesarEntrante(deps, { telefono: '+34611000002', texto: 'Sigue siendo caro para mí', ahora: new Date('2026-09-29T12:00:00Z') });
      assert.deepEqual(r2.decision.acciones, [{ tipo: 'cerrar', motivo: 'precio' }]);
    });

    await t.test('«no me escribáis más»: baja en todo, de inmediato', async () => {
      const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono, es_cliente) VALUES ('Ana', '+34611000003', TRUE)");
      await pool.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente) VALUES (?, 'whatsapp_marketing', 'otorgado', 'recepcion')", [p.insertId]);
      await R.inscribir(pool, { secuencia: 'toca_repetir', pacienteId: p.insertId, inicio: new Date('2026-09-29T10:00:00Z') });
      await R.avanzarSecuencias(deps, { ahora: new Date('2026-09-29T10:00:00Z') });
      const r = await R.procesarEntrante(deps, { telefono: '+34611000003', texto: 'No me escribáis más', ahora: new Date('2026-09-29T10:05:00Z') });
      assert.deepEqual(r.decision.acciones, [{ tipo: 'baja' }]);
      const [[pa]] = await pool.query('SELECT baja_comercial_en FROM pacientes WHERE id = ?', [p.insertId]);
      assert.ok(pa.baja_comercial_en);
      const [[ins]] = await pool.query('SELECT estado FROM inscripciones WHERE paciente_id = ?', [p.insertId]);
      assert.equal(ins.estado, 'cancelada');
      // Una nueva secuencia comercial ya no puede escribirle.
      await R.inscribir(pool, { secuencia: 'dormido', pacienteId: p.insertId, inicio: new Date('2026-10-20T10:00:00Z') });
      const res = await R.avanzarSecuencias(deps, { ahora: new Date('2026-10-20T10:00:00Z') });
      assert.match(res[0].bloqueado, /baja/);
    });

    await t.test('salud urgente: a una persona del equipo médico ya, y la IA se calla', async () => {
      const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Eva', '+34611000004')");
      const r = await R.procesarEntrante(deps, { telefono: '+34611000004', texto: 'Me ha salido un bulto en el labio después del relleno y me duele mucho', ahora: new Date('2026-09-29T15:00:00Z') });
      assert.match(r.respuesta, /112/);
      const [[tarea]] = await pool.query('SELECT urgente, tipo, vence_en FROM tareas WHERE paciente_id = ?', [p.insertId]);
      assert.equal(tarea.urgente, 1);
      assert.ok(new Date(tarea.vence_en) - new Date('2026-09-29T15:00:00Z') <= 15 * 60000);
      const otro = await R.procesarEntrante(deps, { telefono: '+34611000004', texto: '¿Me decís algo?', ahora: new Date('2026-09-29T15:03:00Z') });
      assert.equal(otro.atiende, 'persona');
    });

    await t.test('toxina: ante «caro», plazos (nunca promoción)', async () => {
      const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Sara', '+34611000005')");
      await pool.query("INSERT INTO citas (paciente_id, tratamiento_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token_hash) VALUES (?, 'toxina-facial', '2026-03-01 10:00', '2026-03-01 10:30', '2026-03-01 10:00', '2026-03-01 10:40', '2026-03-01 10:00', '2026-03-01 10:30', 'completada', UNHEX(SHA2(UUID(), 256)))", [p.insertId]);
      const r = await R.procesarEntrante(deps, { telefono: '+34611000005', texto: 'Es carísimo', ahora: new Date('2026-09-29T15:00:00Z') });
      assert.equal(r.decision.acciones.find((a) => a.tipo === 'ofrecer').ofertaTipo, 'plazos');
    });

    await t.test('dos cron a la vez: un seguimiento vencido se envía una sola vez (SKIP LOCKED)', async () => {
      const leadId = await nuevoLead(pool, { telefono: '+34611000006', nombre: 'Lucía', tratamiento: 'limpieza-facial' });
      await R.inscribir(pool, { secuencia: 'lead', leadId, inicio: new Date('2026-09-29T10:00:00Z') });
      await R.avanzarSecuencias(deps, { ahora: new Date('2026-09-29T10:00:00Z') });
      await R.procesarEntrante(deps, { telefono: '+34611000006', texto: 'Dentro de 10 días hablamos', ahora: new Date('2026-09-29T10:10:00Z') });
      // Primero se vacía lo que vence antes (el recordatorio de oferta de Sara, el 2-oct).
      await R.procesarSeguimientos(deps, { ahora: new Date('2026-10-08T12:00:00Z') });
      const antes = whatsapp.enviados.length;
      const cuando = new Date('2026-10-09T12:00:00Z');
      const [a, b] = await Promise.all([R.procesarSeguimientos(deps, { ahora: cuando }), R.procesarSeguimientos(deps, { ahora: cuando })]);
      assert.equal(a.length + b.length, 1);
      assert.equal(whatsapp.enviados.length, antes + 1);
    });

    await t.test('la baja de un contacto sin ficha no toca los seguimientos de los demás', async () => {
      const a = await nuevoLead(pool, { telefono: '+34611000008', nombre: 'Uno', tratamiento: 'limpieza-facial' });
      const b = await nuevoLead(pool, { telefono: '+34611000009', nombre: 'Dos', tratamiento: 'limpieza-facial' });
      for (const id of [a, b]) {
        await R.inscribir(pool, { secuencia: 'lead', leadId: id, inicio: new Date('2026-09-29T10:00:00Z') });
      }
      await R.avanzarSecuencias(deps, { ahora: new Date('2026-09-29T10:00:00Z') });
      const ra = await R.procesarEntrante(deps, { telefono: '+34611000008', texto: 'El mes que viene', ahora: new Date('2026-09-29T10:20:00Z') });
      await R.procesarEntrante(deps, { telefono: '+34611000009', texto: 'No me escribáis más', ahora: new Date('2026-09-29T10:25:00Z') });
      const [[s]] = await pool.query('SELECT estado FROM seguimientos WHERE conversacion_id = ?', [ra.conversacionId]);
      assert.equal(s.estado, 'pendiente');
      const [[ia]] = await pool.query('SELECT estado FROM inscripciones WHERE lead_id = ?', [a]);
      assert.equal(ia.estado, 'pausada');
    });

    await t.test('el mismo mensaje de WhatsApp dos veces (reintento del proveedor) se procesa una sola vez', async () => {
      const x = await R.procesarEntrante(deps, { telefono: '+34611000007', texto: 'Hola, quiero información', waId: 'wamid.X1', ahora: new Date('2026-09-29T16:00:00Z') });
      const y = await R.procesarEntrante(deps, { telefono: '+34611000007', texto: 'Hola, quiero información', waId: 'wamid.X1', ahora: new Date('2026-09-29T16:00:01Z') });
      assert.ok(x.conversacionId);
      assert.equal(y.duplicado, true);
    });
  } finally {
    await pool.end();
  }
});

test('«muy caro» de algo con publicidad restringida (régimen sin confirmar, oferta sin confirmar): ni bono ni promoción', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  try {
    await sembrar(pool);
    // Como los deja el catálogo consolidado: la mesoterapia puede llevar un fármaco y la
    // criolipólisis la clínica no ha confirmado que la ofrezca; los dos van restringidos.
    await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, publicidad_restringida, reservable_ia) VALUES
      ('mesoterapia-facial', 'Mesoterapia facial', 'facial', 30, 10, 90, 'medico', 'consulta_medica', 'desconocido', TRUE, FALSE),
      ('criolipolisis', 'Criolipólisis', 'facial', 60, 15, 90, 'esteticista', 'cabina_estetica', 'aparatologia', TRUE, FALSE)`);
    for (const [i, tratamiento] of ['mesoterapia-facial', 'criolipolisis'].entries()) {
      const telefono = `+3461100002${i}`;
      const leadId = await nuevoLead(pool, { telefono, nombre: 'Lidia', tratamiento });
      await R.inscribir(pool, { secuencia: 'lead', leadId, inicio: new Date('2026-09-29T10:00:00Z') });
      await R.avanzarSecuencias(deps, { ahora: new Date('2026-09-29T10:00:00Z') });
      const r = await R.procesarEntrante(deps, { telefono, texto: 'Me parece muy caro', ahora: new Date('2026-09-29T11:00:00Z') });
      assert.notEqual(r.decision.acciones.find((a) => a.tipo === 'ofrecer')?.ofertaTipo, 'bono', tratamiento);
      assert.doesNotMatch(r.respuesta, /bono/, tratamiento);
    }
    const [hechas] = await pool.query("SELECT o.tipo FROM ofertas_hechas h JOIN ofertas o ON o.id = h.oferta_id WHERE o.tipo IN ('bono','promocion','descuento','regalo')");
    assert.deepEqual(hechas, []);
  } finally {
    await pool.end();
  }
});

test('los huecos se proponen agrupados por día', () => {
  assert.equal(R.textoHuecos([{ fecha: '2026-10-06', hora: '11:00' }, { fecha: '2026-10-06', hora: '17:30' }, { fecha: '2026-10-07', hora: '12:00' }]),
    'el martes 6 de octubre a las 11:00 o a las 17:30, o el miércoles 7 de octubre a las 12:00');
  assert.equal(R.textoHuecos([{ fecha: '2026-10-06', hora: '11:00' }]), 'el martes 6 de octubre a las 11:00');
});
