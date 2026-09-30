'use strict';
// Cola de trabajos en MariaDB. La vacía el cron cada minuto: cada trabajador coge los suyos con
// SELECT … FOR UPDATE SKIP LOCKED, así dos cron a la vez nunca hacen el mismo trabajo dos veces.
// Si un trabajo falla, se reintenta con espera creciente (1, 2, 4, 8… minutos) hasta max_intentos.
async function encolar(con, tipo, carga = {}, { ejecutarEn = new Date(), claveUnica = null, maxIntentos = 5 } = {}) {
  const [r] = await con.query(
    `INSERT INTO cola (tipo, carga, ejecutar_en, clave_unica, max_intentos) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [tipo, JSON.stringify(carga), ejecutarEn, claveUnica, maxIntentos]);
  return r.insertId;
}

async function tomar(pool, { limite = 10, ahora = new Date(), tipos = null } = {}) {
  if (Array.isArray(tipos) && tipos.length === 0) return [];
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [filas] = await con.query(
      `SELECT * FROM cola WHERE estado = 'pendiente' AND ejecutar_en <= ? ${tipos ? 'AND tipo IN (?)' : ''}
       ORDER BY ejecutar_en, id LIMIT ? FOR UPDATE SKIP LOCKED`,
      tipos ? [ahora, tipos, limite] : [ahora, limite]);
    if (filas.length) {
      await con.query("UPDATE cola SET estado = 'en_curso', intentos = intentos + 1, bloqueado_hasta = ? WHERE id IN (?)",
        [new Date(ahora.getTime() + 5 * 60000), filas.map((f) => f.id)]);
    }
    await con.commit();
    return filas.map((f) => ({ ...f, intentos: f.intentos + 1, carga: typeof f.carga === 'string' ? JSON.parse(f.carga) : f.carga }));
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

async function procesar(pool, manejadores, { limite = 10, ahora = new Date() } = {}) {
  const trabajos = await tomar(pool, { limite, ahora, tipos: Object.keys(manejadores) });
  const resumen = { hechos: 0, reintentos: 0, fallidos: 0 };
  for (const t of trabajos) {
    try {
      await manejadores[t.tipo](t.carga, { trabajo: t, ahora });
      await pool.query("UPDATE cola SET estado = 'hecho', terminado_en = ?, ultimo_error = NULL WHERE id = ?", [ahora, t.id]);
      resumen.hechos++;
    } catch (err) {
      const final = t.intentos >= t.max_intentos;
      await pool.query('UPDATE cola SET estado = ?, ejecutar_en = ?, ultimo_error = ? WHERE id = ?',
        [final ? 'fallido' : 'pendiente', new Date(ahora.getTime() + 2 ** (t.intentos - 1) * 60000), String(err.message).slice(0, 1000), t.id]);
      if (final) resumen.fallidos++; else resumen.reintentos++;
    }
  }
  return resumen;
}

// Trabajos que se quedaron «en curso» porque el proceso murió: vuelven a la cola.
async function rescatarAtascados(pool, ahora = new Date()) {
  const [r] = await pool.query("UPDATE cola SET estado = 'pendiente' WHERE estado = 'en_curso' AND bloqueado_hasta < ?", [ahora]);
  return r.affectedRows;
}

// Candado con caducidad: solo un cron hace a la vez las tareas que no se pueden repetir.
async function conCandado(pool, nombre, ms, fn, { ahora = new Date(), dueno = `${process.pid}-${Math.random().toString(36).slice(2, 8)}` } = {}) {
  const hasta = new Date(ahora.getTime() + ms);
  await pool.query(
    `INSERT INTO candados (nombre, dueno, hasta) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE dueno = IF(hasta < ?, VALUES(dueno), dueno), hasta = IF(hasta < ?, VALUES(hasta), hasta)`,
    [nombre, dueno, hasta, ahora, ahora]);
  const [[fila]] = await pool.query('SELECT dueno FROM candados WHERE nombre = ?', [nombre]);
  if (fila.dueno !== dueno) return { ejecutado: false };
  try {
    return { ejecutado: true, resultado: await fn() };
  } finally {
    await pool.query('UPDATE candados SET hasta = ? WHERE nombre = ? AND dueno = ?', [new Date(0), nombre, dueno]);
  }
}

// Trabajo que se hace una sola vez por clave (p. ej. la revisión diaria): la marca no se libera.
async function unaVez(pool, clave, hasta, fn) {
  const [r] = await pool.query('INSERT IGNORE INTO candados (nombre, dueno, hasta) VALUES (?, ?, ?)', [clave, 'hecho', hasta]);
  if (r.affectedRows !== 1) return { ejecutado: false };
  return { ejecutado: true, resultado: await fn() };
}

module.exports = { encolar, tomar, procesar, rescatarAtascados, conCandado, unaVez };
