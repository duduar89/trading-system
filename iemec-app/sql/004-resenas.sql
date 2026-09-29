-- 004 · Reseñas y Google Business Profile: reseñas con su análisis y respuesta (aprobada por una
-- persona), peticiones tras cada cita con su enlace corto, publicaciones de la ficha y métricas.

CREATE TABLE IF NOT EXISTS resenas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  google_id VARCHAR(160) NOT NULL,
  autor VARCHAR(160) NULL,
  nota TINYINT UNSIGNED NOT NULL,
  texto TEXT NULL,
  publicada_en DATETIME NOT NULL,
  temas JSON NULL,
  sentimiento ENUM('positivo','mixto','negativo') NULL,
  prioridad ENUM('alta','media','normal') NOT NULL DEFAULT 'normal',
  borrador_respuesta TEXT NULL,
  respuesta TEXT NULL,
  estado ENUM('nueva','borrador','aprobada','publicada','ignorada') NOT NULL DEFAULT 'nueva',
  aprobada_por VARCHAR(120) NULL,
  respondida_en DATETIME NULL,
  paciente_id INT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY resena_google (google_id),
  KEY resena_estado (estado, publicada_en),
  CONSTRAINT resena_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS peticiones_resena (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cita_id INT UNSIGNED NOT NULL,
  paciente_id INT UNSIGNED NOT NULL,
  token CHAR(22) NOT NULL,
  programada_para DATETIME NOT NULL,
  enviada_en DATETIME NULL,
  pulsada_en DATETIME NULL,
  resena_id INT UNSIGNED NULL,
  estado ENUM('programada','enviada','omitida','fallida') NOT NULL DEFAULT 'programada',
  motivo VARCHAR(160) NULL,
  UNIQUE KEY peticion_cita (cita_id),
  UNIQUE KEY peticion_token (token),
  KEY peticion_pendiente (estado, programada_para),
  CONSTRAINT peticion_cita_fk FOREIGN KEY (cita_id) REFERENCES citas (id) ON DELETE CASCADE,
  CONSTRAINT peticion_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publicaciones_gbp (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  tipo ENUM('novedad','oferta','evento') NOT NULL DEFAULT 'novedad',
  titulo VARCHAR(160) NOT NULL,
  texto VARCHAR(1500) NOT NULL,
  boton_url VARCHAR(600) NULL,
  estado ENUM('idea','borrador','aprobada','publicada','descartada') NOT NULL DEFAULT 'idea',
  programada_para DATE NULL,
  google_id VARCHAR(160) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Métricas diarias de la ficha (Performance API) y búsquedas del mes (palabras con impresiones).
CREATE TABLE IF NOT EXISTS metricas_gbp (
  fecha DATE NOT NULL,
  metrica VARCHAR(60) NOT NULL,
  valor INT UNSIGNED NOT NULL,
  PRIMARY KEY (fecha, metrica)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS busquedas_gbp (
  mes CHAR(7) NOT NULL,
  palabra VARCHAR(160) NOT NULL,
  impresiones INT UNSIGNED NULL,
  umbral VARCHAR(20) NULL,
  PRIMARY KEY (mes, palabra)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
