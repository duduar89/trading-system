#!/usr/bin/env node
'use strict';
// Base de demostración: carga las semillas de la clínica y añade pacientes, citas, conversaciones,
// presupuestos y reseñas INVENTADOS para enseñar la app. Todo pasa por los motores de verdad
// (agenda, repesca con la IA simulada, reseñas). Nunca en producción.
//   node scripts/demo.js            → base iemec_dev (o la del .env)
const db = require('../servidor/db');
const { migrar } = require('../servidor/migraciones');
const { semillar } = require('../servidor/semillas');
const agenda = require('../servidor/agenda');
const repesca = require('../servidor/repesca/motor');
const resenas = require('../servidor/resenas');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { crearGoogle } = require('../servidor/integraciones/google');
const T = require('../motor/tiempo');

if (process.env.NODE_ENV === 'production') { console.error('✗ La demo no se carga en producción'); process.exit(1); }

const NOMBRES = [['Lucía', 'Martín'], ['Carmen', 'Ruiz'], ['Elena', 'Soto'], ['Marta', 'Vidal'], ['Sara', 'Nieto'], ['Paula', 'Gil'], ['Irene', 'Mora'],
  ['Laura', 'Pardo'], ['Nuria', 'Cano'], ['Julia', 'Ramos'], ['Andrea', 'Lozano'], ['Beatriz', 'Pastor'], ['Clara', 'Serrano'], ['Rocío', 'Molina'],
  ['Javier', 'Ortega'], ['Pablo', 'Castro'], ['Diego', 'Rubio'], ['Sergio', 'Marín'], ['Alba', 'Iglesias'], ['Noelia', 'Garrido']];

async function main() {
  const pool = db.pool();
  const log = (m) => console.log(`▸ ${m}`);
  await migrar({ log });
  await semillar(pool, { demo: true, log });
  const ahora = new Date();
  const hoy = T.fechaMadrid(ahora);

  // Horarios de ejemplo: todos de lunes a sábado, comida flotante de 45 min entre 14:00 y 16:00.
  const [profs] = await pool.query('SELECT id, codigo, rol FROM profesionales');
  await pool.query('DELETE FROM profesional_horarios');
  await pool.query('DELETE FROM pausas');
  for (const p of profs) {
    const dias = p.rol === 'cirujano' ? [4] : p.codigo === 'gonzalo-orallo' ? [2] : p.codigo === 'alfonso-navarro' ? [3] : [1, 2, 3, 4, 5, 6];
    for (const d of dias) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (?, ?, '11:00', '20:00')", [p.id, d]);
    await pool.query("INSERT INTO pausas (profesional_id, tipo, modo, ventana_inicio, ventana_fin, duracion_min) VALUES (?, 'comida', 'flotante', '14:00', '16:00', 45)", [p.id]);
  }
  log('horarios de ejemplo');

  // Pacientes inventados.
  await pool.query("DELETE FROM pacientes WHERE email LIKE '%@ejemplo.invalid'");
  const pacientes = [];
  for (const [i, [n, a]] of NOMBRES.entries()) {
    const [r] = await pool.query('INSERT INTO pacientes (nombre, apellidos, telefono, email, es_cliente) VALUES (?, ?, ?, ?, ?)',
      [n, a, `+3460000${String(1000 + i)}`, `${n.toLowerCase()}@ejemplo.invalid`, i % 3 !== 0]);
    pacientes.push(r.insertId);
    await pool.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente, prueba) VALUES (?, 'whatsapp_marketing', 'otorgado', 'recepcion', 'demo')", [r.insertId]);
  }
  log(`${pacientes.length} pacientes inventados`);

  // Citas de hoy y los próximos días, colocadas por el motor de agenda (respeta cabinas y comidas).
  const [trats] = await pool.query("SELECT id, familia FROM tratamientos WHERE activo AND reservable_ia AND rol_profesional IS NOT NULL AND sala_tipo IS NOT NULL AND duracion_min <= 120");
  let citas = 0;
  for (let dia = 0; dia < 4; dia++) {
    const fecha = T.sumarDias(hoy, dia);
    for (let k = 0; k < 14; k++) {
      const t = trats[(k * 7 + dia * 3) % trats.length];
      if (!t) break;
      const h = await agenda.huecos(pool, { fecha, tratamientoId: t.id, ahora: dia === 0 ? new Date(ahora.getTime() - 12 * 3600000) : ahora });
      if (!h.length) continue;
      const elegido = h[Math.min(h.length - 1, (k * 11) % h.length)];
      try {
        await agenda.reservar(pool, { pacienteId: pacientes[(k + dia * 5) % pacientes.length], tratamientoId: t.id, fecha, hora: elegido.hora, origen: k % 4 === 0 ? 'ia_whatsapp' : 'recepcion', ahora: new Date(ahora.getTime() - 12 * 3600000), antelacionMin: 0 });
        citas++;
      } catch { /* hueco ya cogido en esta vuelta */ }
    }
  }
  log(`${citas} citas colocadas por el motor de agenda`);

  // Conversaciones de repesca con la IA simulada.
  const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  const [[facial]] = await pool.query("SELECT id FROM tratamientos WHERE familia = 'facial' AND regimen_legal IN ('cosmetico','aparatologia','servicio') ORDER BY precio_eur IS NULL, precio_eur LIMIT 1");
  const [[capilar]] = await pool.query("SELECT id FROM tratamientos WHERE familia IN ('medicina_capilar','cirugia_capilar') ORDER BY id LIMIT 1");
  const guiones = [
    ['Rocío', 'Bueno, pero el mes que viene me viene mejor', facial?.id],
    ['Andrea', 'Me parece muy caro', facial?.id],
    ['Beatriz', '¿Duele?', facial?.id],
    ['Clara', 'Estoy embarazada, ¿puedo hacérmelo igual?', facial?.id],
    ['Alba', 'Vale, dame cita', facial?.id],
    ['Noelia', 'Ahora no puedo, estoy trabajando', capilar?.id],
    ['Sergio', 'Cuando cobre, que cobro el 5', capilar?.id],
    ['Diego', 'Ya me lo hice en otra clínica', capilar?.id],
    ['Pablo', 'No me escribáis más', capilar?.id],
  ];
  for (const [i, [nombre, frase, trat]] of guiones.entries()) {
    const tel = `+3461100${String(2000 + i)}`;
    const [l] = await pool.query("INSERT INTO leads (telefono, nombre, origen, campana, tratamiento_interes_id, etapa) VALUES (?, ?, ?, 'Otoño facial (ejemplo)', ?, 'contactado')",
      [tel, `${nombre} (ejemplo)`, i % 2 ? 'meta_formulario' : 'web_whatsapp', trat || null]);
    const inicio = new Date(ahora.getTime() - (3 + i) * 3600000);
    await repesca.inscribir(pool, { secuencia: 'lead', leadId: l.insertId, inicio });
    await repesca.avanzarSecuencias(deps, { ahora: inicio });
    await repesca.procesarEntrante(deps, { telefono: tel, texto: frase, nombre, ahora: new Date(inicio.getTime() + 25 * 60000) });
  }
  log(`${guiones.length} conversaciones de repesca`);

  // Presupuestos en seguimiento.
  for (const [i, [titulo, importe]] of [['Plan de medicina capilar (ejemplo)', 3200], ['Rejuvenecimiento facial (ejemplo)', 450], ['Remodelación corporal (ejemplo)', 890]].entries()) {
    const [p] = await pool.query("INSERT INTO presupuestos (paciente_id, titulo, importe_eur, estado, entregado_en) VALUES (?, ?, ?, 'entregado', ?)", [pacientes[i + 2], titulo, importe, new Date(ahora.getTime() - (i + 1) * 3 * 86400000)]);
    await repesca.inscribir(pool, { secuencia: 'presupuesto', pacienteId: pacientes[i + 2], presupuestoId: p.insertId, inicio: new Date(ahora.getTime() - (i + 1) * 3 * 86400000) });
  }
  await pool.query("INSERT INTO presupuestos (paciente_id, titulo, importe_eur, estado, entregado_en, aceptado_en) VALUES (?, 'Pure Glow Up, 3 sesiones (ejemplo)', 261, 'aceptado', ?, ?)", [pacientes[6], new Date(ahora.getTime() - 9 * 86400000), new Date(ahora.getTime() - 2 * 86400000)]);
  log('presupuestos');

  // Reseñas de ejemplo.
  const google = crearGoogle('simulado', { resenas: [
    { googleId: 'demo-1', autor: 'Ejemplo · Marta', nota: 5, texto: 'Trato exquisito, muy profesionales y la clínica preciosa.', publicadaEn: new Date(ahora.getTime() - 2 * 86400000).toISOString() },
    { googleId: 'demo-2', autor: 'Ejemplo · Carlos', nota: 4, texto: 'Muy contento con el resultado, aunque esperé un rato.', publicadaEn: new Date(ahora.getTime() - 4 * 86400000).toISOString() },
    { googleId: 'demo-3', autor: 'Ejemplo · Ana', nota: 2, texto: 'Me costó mucho que me contestaran por teléfono.', publicadaEn: new Date(ahora.getTime() - 6 * 86400000).toISOString() },
  ] });
  await resenas.importarResenas(pool, google);
  log('reseñas de ejemplo');
  await db.cerrar();
  console.log('✓ Demo lista. Arranca con: MODO_DEMO=1 npm start');
}

main().catch(async (err) => { console.error(`✗ ${err.stack || err.message}`); await db.cerrar(); process.exitCode = 1; });
