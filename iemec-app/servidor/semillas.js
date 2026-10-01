'use strict';
// Carga los datos de la clínica (semillas/iemec/*.json) de forma idempotente: se puede ejecutar
// las veces que haga falta sin duplicar nada ni pisar lo que la clínica ya ha cambiado a mano
// (estado de las plantillas, ofertas aprobadas, tratamientos validados, aparatos confirmados, las
// salas que puso en «Cabinas y tratamientos»). El catálogo de tratamientos lo genera
// scripts/importar-catalogo.js. Devuelve { avisos }: lo que se quedaría sin huecos, también en el log.
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
const MOTIVO_RETIRADO = 'Retirado del catálogo; por su régimen legal (medicamento, producto sanitario o sin confirmar) no se anuncia al público.';

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
             ON CONFLICT (id) DO UPDATE SET ${cols.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}`, cols.map((k) => d[k]));
    await q('DELETE FROM horario_clinica');
    for (const h of c.horario) await q('INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, ?, ?)', [h.dia_semana, h.abre, h.cierra]);
    for (const f of c.festivos) await q('INSERT INTO festivos (fecha, nombre, ambito) VALUES (?, ?, ?) ON CONFLICT (fecha) DO UPDATE SET nombre = EXCLUDED.nombre, ambito = EXCLUDED.ambito', [f.fecha, f.nombre, f.ambito]);
    log(`clínica, horario y ${c.festivos.length} festivos`);
  }
  for (const [codigo, nombre, orden] of FAMILIAS) {
    await q('INSERT INTO familias (codigo, nombre, orden) VALUES (?, ?, ?) ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden', [codigo, nombre, orden]);
  }
  if (e) {
    for (const s of e.salas) {
      await q('INSERT INTO salas (codigo, nombre, tipo, color, orden) VALUES (?, ?, ?, ?, ?) ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, color = EXCLUDED.color, orden = EXCLUDED.orden',
        [s.codigo, s.nombre, s.tipo, s.color, s.orden]);
    }
    let orden = 0;
    for (const p of e.profesionales) {
      await q('INSERT INTO profesionales (codigo, nombre, rol, especialidad, color, orden) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, especialidad = EXCLUDED.especialidad, color = EXCLUDED.color',
        [p.codigo, p.nombre, p.rol, p.especialidad, p.color, orden++]);
    }
    log(`${e.salas.length} salas y ${e.profesionales.length} profesionales (sin confirmar)`);
  }
  const avisos = [];
  if (t) {
    const [salasBd] = await q('SELECT id, codigo FROM salas');
    const idSala = Object.fromEntries(salasBd.map((s) => [s.codigo, s.id]));
    const codigoSala = Object.fromEntries(salasBd.map((s) => [s.id, s.codigo]));
    // Aparatos: lo que la clínica no ha confirmado se pone al día con el catálogo, también la cabina
    // de los fijos (el motor solo ofrece esa cabina para lo que los usa). Del confirmado, solo se
    // rellena la cabina si no la tiene.
    for (const eq of t.aparatos || []) {
      const { movil, sala } = ubicacion(eq);
      await q(`INSERT INTO equipos (codigo, nombre, tipo, movil, unidades, notas, sala_id) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo,
                 movil = CASE WHEN equipos.confirmado THEN equipos.movil ELSE EXCLUDED.movil END,
                 unidades = CASE WHEN equipos.confirmado THEN equipos.unidades ELSE EXCLUDED.unidades END,
                 notas = CASE WHEN equipos.confirmado THEN equipos.notas ELSE EXCLUDED.notas END,
                 activo = CASE WHEN equipos.confirmado THEN equipos.activo ELSE TRUE END,
                 sala_id = CASE WHEN equipos.confirmado AND equipos.sala_id IS NOT NULL THEN equipos.sala_id ELSE COALESCE(EXCLUDED.sala_id, equipos.sala_id) END`,
      [eq.codigo, eq.nombre, eq.tipo || null, movil, eq.unidades || 1, corta(eq.notas, 255), (sala && idSala[sala]) || null]);
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
               ON CONFLICT (id) DO UPDATE SET ${cols.filter((k) => k !== 'id').map((k) => `${k} = CASE WHEN tratamientos.validado_clinica THEN tratamientos.${k} ELSE EXCLUDED.${k} END`).join(', ')}`,
      cols.map((k) => fila[k]));
    }
    // Lo que ya no está en el catálogo (el provisional de la F1, versiones anteriores) se retira: se
    // desactiva, no se borra (puede tener citas), salvo que la clínica lo haya validado. Y la IA
    // deja de ofrecerlo aunque un lead antiguo lo tenga como tratamiento de interés. Si su régimen
    // es de riesgo (medicamento, producto sanitario o sin confirmar), tampoco se anuncia: ni una
    // plantilla ni una publicación lo nombran por una cita antigua.
    const retirados = t.retirados || {};
    if (retirados.tratamientos?.length) {
      await q(`UPDATE tratamientos SET publicidad_restringida = TRUE, motivo_restriccion = COALESCE(motivo_restriccion, ?)
               WHERE id IN (?) AND NOT validado_clinica AND NOT publicidad_restringida AND regimen_legal IN ('medicamento_receta','producto_sanitario','desconocido')`,
      [MOTIVO_RETIRADO, retirados.tratamientos]);
      await q('UPDATE tratamientos SET activo = FALSE, reservable_ia = FALSE WHERE id IN (?) AND NOT validado_clinica', [retirados.tratamientos]);
    }
    // Un aparato retirado sigue si aún lo usa un tratamiento activo (uno que validó la clínica): sin
    // él, ese tratamiento se quedaría sin huecos.
    if (retirados.aparatos?.length) {
      const [enUso] = await q('SELECT DISTINCT equipo_codigo AS codigo FROM tratamientos WHERE activo AND equipo_codigo IN (?) ORDER BY equipo_codigo', [retirados.aparatos]);
      for (const { codigo } of enUso) avisos.push(`el aparato «${codigo}» ya no está en el catálogo, pero lo usa un tratamiento activo: sigue activo`);
      await q(`UPDATE equipos SET activo = FALSE WHERE codigo IN (?) AND NOT confirmado
                 AND codigo NOT IN (SELECT equipo_codigo FROM tratamientos WHERE activo AND equipo_codigo IS NOT NULL)`, [retirados.aparatos]);
    }

    // Sala concreta de cada tratamiento que se reserva. Las que puso la clínica (en «Cabinas y
    // tratamientos», que deja el hecho «ajuste_salas_tratamiento», o en un tratamiento que validó)
    // no se tocan. Las demás son de las semillas y se ponen al día con el catálogo: si no, un
    // tratamiento que ahora usa un aparato fijo de otra cabina se quedaría en la vieja, sin huecos.
    // Lo que no se reserva (o se ha retirado) se queda sin sala.
    const [fijos] = await q('SELECT codigo, sala_id FROM equipos WHERE activo AND NOT movil AND sala_id IS NOT NULL');
    const equipoSala = Object.fromEntries(fijos.map((e) => [e.codigo, codigoSala[e.sala_id]]));
    const [deLaClinica] = await q(`SELECT id FROM tratamientos WHERE validado_clinica
      UNION SELECT entidad_id FROM eventos WHERE tipo = 'ajuste_salas_tratamiento' AND entidad = 'tratamiento'`);
    const respetar = new Set(deLaClinica.map((r) => r.id));
    const [pares] = await q('SELECT tratamiento_id, sala_id FROM tratamiento_salas ORDER BY tratamiento_id, sala_id');
    const actuales = new Map();
    for (const p of pares) (actuales.get(p.tratamiento_id) || actuales.set(p.tratamiento_id, []).get(p.tratamiento_id)).push(p.sala_id);
    let asignados = 0;
    let puestosAlDia = 0;
    for (const x of [...t.tratamientos, ...(retirados.tratamientos || []).map((id) => ({ id, activo: false }))]) {
      if (respetar.has(x.id)) continue;
      let codigos = [];
      if (x.activo !== false) {
        const propias = (x.salas || []).filter((c) => idSala[c]);
        if (propias.length < (x.salas || []).length) {
          avisos.push(`«${x.id}» va a una sala que no está en la agenda (${x.salas.filter((c) => !idSala[c]).join(', ')})${propias.length ? '' : ': se usa la sala por defecto'}`);
        }
        codigos = propias.length ? propias : salasPorDefecto({ ...x, salas: [] }, equipoSala);
      }
      const quiere = [...new Set(codigos.map((c) => idSala[c]).filter(Boolean))].sort((a, b) => a - b);
      const tiene = actuales.get(x.id) || [];
      if (quiere.join() === tiene.join()) continue;
      if (tiene.length) await q('DELETE FROM tratamiento_salas WHERE tratamiento_id = ?', [x.id]);
      for (const s of quiere) await q('INSERT INTO tratamiento_salas (tratamiento_id, sala_id) VALUES (?, ?)', [x.id, s]);
      if (!quiere.length) continue;
      if (tiene.length) puestosAlDia++; else asignados++;
    }
    log(`${asignados} tratamientos con su sala asignada y ${puestosAlDia} puestos al día con el catálogo (editable en «Cabinas y tratamientos»)`);

    // Lo que se quedaría sin huecos por cómo está puesto (salas de la clínica que no casan con el
    // aparato, un aparato que no está, un rol que no tiene nadie): no se corrige solo, se avisa.
    const [sinCabina] = await q(`SELECT t.id, e.codigo, s.codigo AS sala FROM tratamientos t JOIN equipos e ON e.codigo = t.equipo_codigo AND e.activo
        JOIN salas s ON s.id = e.sala_id
      WHERE t.activo AND NOT e.movil AND EXISTS (SELECT 1 FROM tratamiento_salas ts WHERE ts.tratamiento_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM tratamiento_salas ts WHERE ts.tratamiento_id = t.id AND ts.sala_id = e.sala_id) ORDER BY t.id`);
    for (const r of sinCabina) avisos.push(`«${r.id}» usa el aparato «${r.codigo}», que está en «${r.sala}», fuera de sus salas: sin huecos hasta que se corrija en «Cabinas y tratamientos»`);
    const [sinAparato] = await q(`SELECT t.id, t.equipo_codigo AS codigo FROM tratamientos t
      WHERE t.activo AND t.equipo_codigo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM equipos e WHERE e.codigo = t.equipo_codigo AND e.activo) ORDER BY t.id`);
    for (const r of sinAparato) avisos.push(`«${r.id}» usa el aparato «${r.codigo}», que no está activo: sin huecos`);
    const [sinRol] = await q(`SELECT t.id, t.rol_profesional AS rol FROM tratamientos t
      WHERE t.activo AND t.rol_profesional IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tratamiento_profesionales tp WHERE tp.tratamiento_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM profesionales p WHERE p.rol = t.rol_profesional AND p.activo) ORDER BY t.id`);
    for (const r of sinRol) avisos.push(`«${r.id}» lo hace el rol «${r.rol}» y nadie del equipo lo tiene: sin huecos`);
    // Preguntas frecuentes, sin aprobar. Mientras nadie las apruebe, se ponen al día con el catálogo.
    for (const f of t.faqs || []) {
      const [trat, pregunta, respuesta, url] = [f.tratamiento_id || null, corta(f.pregunta, 255), corta(f.respuesta, 800), f.url || null];
      await q('UPDATE respuestas_aprobadas SET respuesta = ?, fuente_url = ? WHERE pregunta = ? AND tratamiento_id IS NOT DISTINCT FROM ? AND NOT aprobada', [respuesta, url, pregunta, trat]);
      await q('INSERT INTO respuestas_aprobadas (tratamiento_id, pregunta, respuesta, fuente_url) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM respuestas_aprobadas WHERE pregunta = ? AND tratamiento_id IS NOT DISTINCT FROM ?)',
        [trat, pregunta, respuesta, url, pregunta, trat]);
    }
    const reservables = t.tratamientos.filter((x) => x.activo !== false).length;
    log(`${t.tratamientos.length} tratamientos (${reservables} se reservan), ${(t.aparatos || []).length} aparatos y ${(t.faqs || []).length} respuestas (sin aprobar)`
      + (retirados.tratamientos?.length ? `; ${retirados.tratamientos.length} tratamientos retirados del catálogo anterior` : ''));
  }
  // Mientras sea borrador (no se ha mandado a Meta), la plantilla se pone al día con la biblioteca:
  // el texto, los botones, los ejemplos y la cabecera van juntos. Una aprobada no se toca (es el texto
  // que aprobó Meta: si cambia, se vuelve a mandar), salvo en la demo, donde «aprobada» es de mentira: si
  // no, una base de demostración sembrada antes se quedaría con los textos viejos y los avisos que
  // ahora llevan otros datos no saldrían.
  const alDia = demo ? 'TRUE' : "plantillas.estado = 'borrador'";
  for (const p of BIBLIOTECA) {
    await q(`INSERT INTO plantillas (nombre, uso, categoria, cabecera, cuerpo, botones, ejemplos, estado, calidad)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (nombre, idioma) DO UPDATE SET
               cabecera = CASE WHEN ${alDia} THEN EXCLUDED.cabecera ELSE plantillas.cabecera END, botones = CASE WHEN ${alDia} THEN EXCLUDED.botones ELSE plantillas.botones END,
               ejemplos = CASE WHEN ${alDia} THEN EXCLUDED.ejemplos ELSE plantillas.ejemplos END, cuerpo = CASE WHEN ${alDia} THEN EXCLUDED.cuerpo ELSE plantillas.cuerpo END`,
    [p.nombre, p.uso, p.categoria, p.cabecera ? JSON.stringify(p.cabecera) : null, p.cuerpo, JSON.stringify(p.botones || []), JSON.stringify(p.ejemplos || []),
      demo ? 'aprobada' : 'borrador', demo ? 'verde' : 'pendiente']);
  }
  for (const o of OFERTAS) {
    await q(`INSERT INTO ofertas (codigo, nombre, tipo, texto_paciente, familias, importe_min, requiere_aprobacion, activa)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (codigo) DO UPDATE SET nombre = CASE WHEN ofertas.activa THEN ofertas.nombre ELSE EXCLUDED.nombre END`,
    [o.codigo, o.nombre, o.tipo, o.texto_paciente, o.familias ? JSON.stringify(o.familias) : null, o.importe_min || null, Boolean(o.requiere_aprobacion), demo]);
  }
  log(`${BIBLIOTECA.length} plantillas${demo ? ' (aprobadas, demo)' : ' (borrador)'} y ${OFERTAS.length} ofertas propuestas`);
  for (const a of avisos) log(`aviso: ${a}`);
  return { avisos };
}

module.exports = { semillar, FAMILIAS, salasPorDefecto, ubicacion, APARATO_EN_SALA };
