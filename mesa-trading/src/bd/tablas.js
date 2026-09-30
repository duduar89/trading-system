'use strict';
// Las tablas de la mesa en MariaDB (ARQUITECTURA-WEB W4). Prefijo mesa_,
// InnoDB y utf8mb4. Todas con CREATE TABLE IF NOT EXISTS: crearlas dos veces
// no cambia nada. Las usa scripts/crear-tablas.js y las pruebas.
//
// Las columnas DATETIME van en UTC (la conexión usa timezone 'Z').
// mesa_registros guarda cada línea de los JSONL de data/ tal cual (datos) con
// su instante (t, ms de la mesa) y su número de línea: (fuente, linea) es
// único, y por eso copiar dos veces no duplica.

const TABLAS = Object.freeze([
  ['mesa_usuarios', `CREATE TABLE IF NOT EXISTS mesa_usuarios (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(64) NOT NULL,
  hash VARCHAR(255) NOT NULL,
  creado DATETIME NOT NULL,
  ultimo_acceso DATETIME NULL,
  UNIQUE KEY uq_usuario (usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  ['mesa_sesiones', `CREATE TABLE IF NOT EXISTS mesa_sesiones (
  id CHAR(64) NOT NULL PRIMARY KEY COMMENT 'SHA-256 del token; el token nunca se guarda',
  usuario_id INT NOT NULL,
  creada DATETIME NOT NULL,
  expira DATETIME NOT NULL,
  ultima DATETIME NOT NULL,
  ip VARCHAR(64) NULL,
  agente VARCHAR(255) NULL,
  INDEX ix_expira (expira),
  INDEX ix_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  ['mesa_intentos', `CREATE TABLE IF NOT EXISTS mesa_intentos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64) NULL,
  usuario VARCHAR(64) NULL,
  t DATETIME NOT NULL,
  ok TINYINT NOT NULL,
  INDEX ix_ip_t (ip, t),
  INDEX ix_usuario_t (usuario, t)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  ['mesa_registros', `CREATE TABLE IF NOT EXISTS mesa_registros (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fuente VARCHAR(32) NOT NULL,
  linea BIGINT NOT NULL,
  t BIGINT NULL,
  datos LONGTEXT NOT NULL,
  UNIQUE KEY uq_fuente_linea (fuente, linea),
  INDEX ix_fuente_t (fuente, t)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  ['mesa_latidos', `CREATE TABLE IF NOT EXISTS mesa_latidos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'número de línea en data/latidos.jsonl',
  inicio DATETIME(3) NULL,
  ms INT NULL,
  ok TINYINT NOT NULL,
  resumen VARCHAR(255) NULL,
  INDEX ix_inicio (inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
]);

const NOMBRES = Object.freeze(TABLAS.map(([n]) => n));

function sqlTablas() {
  return TABLAS.map(([, sql]) => `${sql};`).join('\n\n');
}

// Crea las que falten. Devuelve { existian: [...], creadas: [...] }.
async function crearTablas(pool) {
  const antes = await tablasExistentes(pool);
  for (const [, sql] of TABLAS) await pool.query(sql);
  const despues = await tablasExistentes(pool);
  return {
    existian: NOMBRES.filter(n => antes.includes(n)),
    creadas: NOMBRES.filter(n => !antes.includes(n) && despues.includes(n)),
  };
}

async function tablasExistentes(pool) {
  const [filas] = await pool.query("SHOW TABLES LIKE 'mesa\\_%'");
  return filas.map(f => Object.values(f)[0]);
}

module.exports = { TABLAS, NOMBRES, sqlTablas, crearTablas, tablasExistentes };
