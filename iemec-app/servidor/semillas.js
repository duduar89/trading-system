'use strict';
// Carga los datos de la clínica (semillas/iemec/*.json) de forma idempotente: se puede ejecutar
// las veces que haga falta sin duplicar nada ni pisar lo que la clínica ya ha cambiado a mano
// (estado de las plantillas, ofertas aprobadas, tratamientos validados, aparatos confirmados).
// El catálogo de tratamientos lo genera scripts/importar-catalogo.js.
const fs = require('fs');
const path = require('path');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');

const CARPETA = path.join(__dirname, '..', 'semillas', 'iemec');
const corta = (v, n) => (v == null ? null : String(v).slice(0, n));

// Todas las familias del catálogo, con el nombre que ve la clínica (una familia nueva en el
// catálogo hace fallar el importador hasta que se añade aquí).
const FAMILIAS = [
  ['facial', 'Medicina estética facial', 1], ['corporal', 'Medicina estética corporal', 2], ['perdida_peso', 'Pérdida de peso', 3],
  ['medicina_capilar', 'Medicina capilar', 4], ['cirugia_capilar', 'Cirugía capilar', 5], ['cirugia_estetica', 'Cirugía estética', 6],
  ['ginecoestetica', 'Ginecología estética y regenerativa', 7], ['sexualidad_masculina', 'Sexualidad masculina', 8], ['head_spa', 'Head Spa', 9],
  ['estetica_avanzada', 'Estética avanzada', 10], ['nutricion', 'Nutrición', 11], ['tarjeta_regalo', 'Tarjetas regalo', 12], ['otro', 'Otros tratamientos', 13],
];

// Ofertas PROPUESTAS: llegan desactivadas; la clínica decide cuáles se activan y con qué límites.
const OFERTAS = [
  { codigo: 'plazos-3', nombre: 'Pago en 3 plazos sin intereses', tipo: 'plazos', texto_paciente: 'Si te viene mejor, puedes pagarlo en 3 plazos sin intereses.', importe_min: 150 },
  { codigo: 'valoracion-medica', nombre: 'Valoración con el equipo médico', tipo: 'valoracion', texto_paciente: 'Te proponemos una valoración con el equipo médico para ver qué necesitas de verdad antes de decidir.' },
  { codigo: 'bono-3-estetica', nombre: 'Bono de 3 sesiones (estética)', tipo: 'bono', familias: ['estetica_avanzada', 'corporal', 'head_spa'], texto_paciente: 'Con el bono de 3 sesiones, cada sesión te sale más económica.' },
  { codigo: 'por-fases', nombre: 'Plan por fases', tipo: 'alternativa', texto_paciente: 'Podemos plantearlo por fases, empezando por lo que más te preocupa, y seguir a tu ritmo.', requiere_aprobacion: true },
];

// Dónde se hace cada cosa mientras la clínica no diga otra cosa (lo cambia en el panel).
// Aparatos fijos, en su cabina: los láseres, la luz pulsada y el HIFU en la de aparatología; las
// plataformas corporales en la corporal. Los que no están aquí (de mano o con ruedas: Dermapen,
// LED, Plexr, centrífuga, oxigenoterapia…) se llevan a la sala del tratamiento.
const APARATO_EN_SALA = {
  'laser-fotona': 'cabina-laser', ipl: 'cabina-laser', 'laser-diodo': 'cabina-laser', 'laser-vascular': 'cabina-laser', 'hifu-v10': 'cabina-laser',
  'evo-dfinitive': 'cabina-corporal', 'preso-ballancer': 'cabina-corporal', criolipolisis: 'cabina-corporal',
  'escaner-facial': 'cabina-facial', 'led-capilar': 'sala-capilar', 'laser-capilar': 'sala-capilar',
  'neuroline-t6': 'consulta-2', 'head-spa': 'head-spa',
};
const SALA_POR_TIPO = { head_spa: ['head-spa'], sala_capilar: ['sala-capilar'], cabina_aparatologia: ['cabina-laser'], consulta_medica: ['consulta-1', 'consulta-2'] };

// El catálogo dice si un aparato es portátil; si no lo dice, es fijo si tiene cabina asignada.
function ubicacion(eq) {
  const movil = eq.movil ?? !APARATO_EN_SALA[eq.codigo];
  return { movil: Boolean(movil), sala: eq.sala || (movil ? null : APARATO_EN_SALA[eq.codigo] || null) };
}

function salasPorDefecto(x, equipoSala = {}) {
  if (x.salas?.length) return x.salas;
  // Si necesita un aparato fijo, va donde está el aparato.
  if (x.equipo_codigo && equipoSala[x.equipo_codigo]) return [equipoSala[x.equipo_codigo]];
  if (x.sala_tipo === 'cabina_estetica') return [x.familia === 'corporal' ? 'cabina-corporal' : 'cabina-facial'];
  // Sin sala de procedimientos en la agenda todavía: el injerto, en la sala capilar; lo demás, en consulta.
  if (x.sala_tipo === 'sala_procedimientos') return x.familia === 'cirugia_capilar' ? SALA_POR_TIPO.sala_capilar : SALA_POR_TIPO.consulta_medica;
  return SALA_POR_TIPO[x.sala_tipo] || [];
}

async function semillar(pool, { demo = false, log = () => {}, carpeta = CARPETA } = {}) {
  const leer = (f) => (fs.existsSync(path.join(carpeta, f)) ? JSON.parse(fs.readFileSync(path.join(carpeta, f), 'utf8')) : null);
  const c = leer('clinica.json');
  const e = leer('equipo.json');
  const t = leer('tratamientos.json');
  const q = (sql, p) => pool.query(sql, p);

  if (c) {
    const d = c.clinica;
    const cols = Object.keys(d);
    await q(`INSERT INTO clinica (id, ${cols.join(', ')}) VALUES (1, ${cols.map(() => '?').join(', ')})
             ON DUPLICATE KEY UPDATE ${cols.map((k) => `${k} = VALUES(${k})`).join(', ')}`, cols.map((k) => d[k]));
    await q('DELETE FROM horario_clinica');
    for (const h of c.horario) await q('INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, ?, ?)', [h.dia_semana, h.abre, h.cierra]);
    for (const f of c.festivos) await q('INSERT INTO festivos (fecha, nombre, ambito) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), ambito = VALUES(ambito)', [f.fecha, f.nombre, f.ambito]);
    log(`clínica, horario y ${c.festivos.length} festivos`);
  }
  for (const [codigo, nombre, orden] of FAMILIAS) {
    await q('INSERT INTO familias (codigo, nombre, orden) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), orden = VALUES(orden)', [codigo, nombre, orden]);
  }
  if (e) {
    for (const s of e.salas) {
      await q('INSERT INTO salas (codigo, nombre, tipo, color, orden) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), tipo = VALUES(tipo), color = VALUES(color), orden = VALUES(orden)',
        [s.codigo, s.nombre, s.tipo, s.color, s.orden]);
    }
    let orden = 0;
    for (const p of e.profesionales) {
      await q('INSERT INTO profesionales (codigo, nombre, rol, especialidad, color, orden) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), especialidad = VALUES(especialidad), color = VALUES(color)',
        [p.codigo, p.nombre, p.rol, p.especialidad, p.color, orden++]);
    }
    log(`${e.salas.length} salas y ${e.profesionales.length} profesionales (sin confirmar)`);
  }
  if (t) {
    // Aparatos: lo que la clínica no ha confirmado se pone al día con el catálogo.
    for (const eq of t.aparatos || []) {
      await q(`INSERT INTO equipos (codigo, nombre, tipo, movil, unidades, notas) VALUES (?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), tipo = VALUES(tipo), movil = IF(confirmado, movil, VALUES(movil)),
                 unidades = IF(confirmado, unidades, VALUES(unidades)), notas = IF(confirmado, notas, VALUES(notas)), activo = IF(confirmado, activo, TRUE)`,
      [eq.codigo, eq.nombre, eq.tipo || null, ubicacion(eq).movil, eq.unidades || 1, corta(eq.notas, 255)]);
    }
    for (const x of t.tratamientos) {
      const fila = {
        id: x.id, nombre: corta(x.nombre, 160), familia: x.familia, subfamilia: corta(x.subfamilia, 80), descripcion: corta(x.descripcion, 400),
        duracion_min: x.duracion_min, duracion_fuente: x.duracion_fuente || 'estimada', primera_visita_min: x.primera_visita_min || null,
        holgura_antes_min: x.holgura_antes_min || 0, holgura_despues_min: x.holgura_despues_min ?? 10, crema_anestesica_min: x.crema_anestesica_min || 0,
        precio_eur: x.precio_eur ?? null, precio_texto: corta(x.precio_texto, 80), es_promocion: Boolean(x.es_promocion),
        rol_profesional: x.rol_profesional || null, sala_tipo: x.sala_tipo || null, equipo_codigo: x.equipo_codigo || null,
        sesiones: corta(x.sesiones, 80), intervalo_sesiones_dias: x.intervalo_sesiones_dias || null, repetir_cada_dias: x.repetir_cada_dias || null,
        repetir_fuente: corta(x.repetir_fuente, 40), regimen_legal: x.regimen_legal || 'desconocido', publicidad_restringida: Boolean(x.publicidad_restringida),
        motivo_restriccion: corta(x.motivo_restriccion, 255), texto_whatsapp: corta(x.texto_whatsapp, 400),
        alias: JSON.stringify(x.alias || []), fuentes: JSON.stringify(x.fuentes || []), notas: corta(x.notas, 600),
        reservable_ia: x.reservable_ia !== false, activo: x.activo !== false,
      };
      const cols = Object.keys(fila);
      // Lo que la clínica ya validó a mano no se pisa.
      await q(`INSERT INTO tratamientos (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
               ON DUPLICATE KEY UPDATE ${cols.filter((k) => k !== 'id').map((k) => `${k} = IF(validado_clinica, ${k}, VALUES(${k}))`).join(', ')}`,
      cols.map((k) => fila[k]));
    }
    // Lo que ya no está en el catálogo (el provisional de la F1, versiones anteriores) se retira: se
    // desactiva, no se borra (puede tener citas), salvo que la clínica lo haya validado. Y la IA
    // deja de ofrecerlo aunque un lead antiguo lo tenga como tratamiento de interés.
    const retirados = t.retirados || {};
    if (retirados.tratamientos?.length) await q('UPDATE tratamientos SET activo = FALSE, reservable_ia = FALSE WHERE id IN (?) AND NOT validado_clinica', [retirados.tratamientos]);
    if (retirados.aparatos?.length) await q('UPDATE equipos SET activo = FALSE WHERE codigo IN (?) AND NOT confirmado', [retirados.aparatos]);
    // Aparatos fijos: viven en su cabina (el motor solo ofrece esa cabina para lo que los usa).
    const equipoSala = Object.fromEntries((t.aparatos || []).map((eq) => [eq.codigo, ubicacion(eq).sala]));
    for (const [codigo, sala] of Object.entries(equipoSala)) {
      if (sala) await q('UPDATE equipos SET sala_id = (SELECT id FROM salas WHERE codigo = ?) WHERE codigo = ? AND sala_id IS NULL', [sala, codigo]);
    }
    // Sala concreta por tratamiento que se reserva. Solo si todavía no tiene: lo que marque la
    // clínica en el panel manda.
    const [salasBd] = await q('SELECT id, codigo FROM salas');
    const idSala = Object.fromEntries(salasBd.map((s) => [s.codigo, s.id]));
    const [yaAsignados] = await q('SELECT DISTINCT tratamiento_id FROM tratamiento_salas');
    const conSalas = new Set(yaAsignados.map((r) => r.tratamiento_id));
    let asignados = 0;
    for (const x of t.tratamientos) {
      if (conSalas.has(x.id) || x.activo === false) continue;
      const salas = salasPorDefecto(x, equipoSala).map((c) => idSala[c]).filter(Boolean);
      for (const s of salas) await q('INSERT IGNORE INTO tratamiento_salas (tratamiento_id, sala_id) VALUES (?, ?)', [x.id, s]);
      if (salas.length) asignados++;
    }
    log(`${asignados} tratamientos con su sala asignada (editable en «Cabinas y tratamientos»)`);
    // Preguntas frecuentes, sin aprobar. Mientras nadie las apruebe, se ponen al día con el catálogo.
    for (const f of t.faqs || []) {
      const [trat, pregunta, respuesta, url] = [f.tratamiento_id || null, corta(f.pregunta, 255), corta(f.respuesta, 800), f.url || null];
      await q('UPDATE respuestas_aprobadas SET respuesta = ?, fuente_url = ? WHERE pregunta = ? AND tratamiento_id <=> ? AND NOT aprobada', [respuesta, url, pregunta, trat]);
      await q('INSERT INTO respuestas_aprobadas (tratamiento_id, pregunta, respuesta, fuente_url) SELECT ?, ?, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM respuestas_aprobadas WHERE pregunta = ? AND tratamiento_id <=> ?)',
        [trat, pregunta, respuesta, url, pregunta, trat]);
    }
    const reservables = t.tratamientos.filter((x) => x.activo !== false).length;
    log(`${t.tratamientos.length} tratamientos (${reservables} se reservan), ${(t.aparatos || []).length} aparatos y ${(t.faqs || []).length} respuestas (sin aprobar)`
      + (retirados.tratamientos?.length ? `; ${retirados.tratamientos.length} tratamientos retirados del catálogo anterior` : ''));
  }
  for (const p of BIBLIOTECA) {
    await q(`INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE cuerpo = IF(estado = 'borrador', VALUES(cuerpo), cuerpo)`,
    [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones || []), JSON.stringify(p.ejemplos || []), demo ? 'aprobada' : 'borrador', demo ? 'verde' : 'pendiente']);
  }
  for (const o of OFERTAS) {
    await q(`INSERT INTO ofertas (codigo, nombre, tipo, texto_paciente, familias, importe_min, requiere_aprobacion, activa)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE nombre = IF(activa, nombre, VALUES(nombre))`,
    [o.codigo, o.nombre, o.tipo, o.texto_paciente, o.familias ? JSON.stringify(o.familias) : null, o.importe_min || null, Boolean(o.requiere_aprobacion), demo]);
  }
  log(`${BIBLIOTECA.length} plantillas${demo ? ' (aprobadas, demo)' : ' (borrador)'} y ${OFERTAS.length} ofertas propuestas`);
}

module.exports = { semillar, FAMILIAS, salasPorDefecto, ubicacion, APARATO_EN_SALA };
