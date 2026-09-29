-- 001 · Base de la clínica: datos, horario, festivos, salas, equipos, profesionales, catálogo de
-- tratamientos, pacientes, consentimientos, personal de la app, registro de hechos, cola y candados.
-- Todas las fechas y horas en UTC (la conexión trabaja con time_zone = '+00:00').

CREATE TABLE IF NOT EXISTS clinica (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  nombre VARCHAR(120) NOT NULL,
  nombre_corto VARCHAR(40) NOT NULL,
  razon_social VARCHAR(160) NULL,
  nif VARCHAR(20) NULL,
  direccion VARCHAR(200) NULL,
  cp VARCHAR(10) NULL,
  municipio VARCHAR(80) NULL,
  provincia VARCHAR(80) NULL,
  telefono VARCHAR(20) NULL,
  whatsapp VARCHAR(20) NULL,
  email VARCHAR(160) NULL,
  web VARCHAR(160) NULL,
  zona_horaria VARCHAR(40) NOT NULL DEFAULT 'Europe/Madrid',
  lat DECIMAL(9,6) NULL,
  lng DECIMAL(9,6) NULL,
  google_place_id VARCHAR(120) NULL,
  paso_agenda_min TINYINT UNSIGNED NOT NULL DEFAULT 5,
  retencion_hueco_min SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT clinica_una_fila CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Horario de apertura por día de la semana (1 = lunes … 7 = domingo). Varias filas = jornada partida.
CREATE TABLE IF NOT EXISTS horario_clinica (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dia_semana TINYINT UNSIGNED NOT NULL,
  abre TIME NOT NULL,
  cierra TIME NOT NULL,
  CONSTRAINT horario_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT horario_orden CHECK (abre < cierra),
  UNIQUE KEY horario_unico (dia_semana, abre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS festivos (
  fecha DATE NOT NULL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  ambito ENUM('nacional','autonomico','local','clinica') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cierres puntuales de toda la clínica (obras, formación, vacaciones).
CREATE TABLE IF NOT EXISTS cierres (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  desde DATETIME NOT NULL,
  hasta DATETIME NOT NULL,
  motivo VARCHAR(160) NOT NULL,
  CONSTRAINT cierre_orden CHECK (desde < hasta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salas (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(80) NOT NULL,
  tipo ENUM('consulta_medica','cabina_estetica','cabina_aparatologia','quirofano','sala_capilar','head_spa','otra') NOT NULL,
  color CHAR(7) NULL,
  orden SMALLINT NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  notas VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aparatos. Si sala_id está puesto, el aparato vive en esa sala; si movil = TRUE, se puede llevar a
-- otra. unidades > 1 cuando hay varios iguales.
CREATE TABLE IF NOT EXISTS equipos (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(80) NOT NULL,
  tipo VARCHAR(60) NULL,
  sala_id SMALLINT UNSIGNED NULL,
  movil BOOLEAN NOT NULL DEFAULT FALSE,
  unidades TINYINT UNSIGNED NOT NULL DEFAULT 1,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  confirmado BOOLEAN NOT NULL DEFAULT FALSE,
  notas VARCHAR(255) NULL,
  CONSTRAINT equipo_sala FOREIGN KEY (sala_id) REFERENCES salas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profesionales (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  rol ENUM('medico','cirujano','enfermeria','esteticista','nutricionista','tricologo','recepcion','otro') NOT NULL,
  especialidad VARCHAR(160) NULL,
  color CHAR(7) NULL,
  email VARCHAR(160) NULL,
  telefono VARCHAR(20) NULL,
  orden SMALLINT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  confirmado BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profesional_horarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profesional_id SMALLINT UNSIGNED NOT NULL,
  dia_semana TINYINT UNSIGNED NOT NULL,
  inicio TIME NOT NULL,
  fin TIME NOT NULL,
  sala_preferida_id SMALLINT UNSIGNED NULL,
  vigente_desde DATE NULL,
  vigente_hasta DATE NULL,
  CONSTRAINT ph_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT ph_orden CHECK (inicio < fin),
  CONSTRAINT ph_profesional FOREIGN KEY (profesional_id) REFERENCES profesionales (id) ON DELETE CASCADE,
  CONSTRAINT ph_sala FOREIGN KEY (sala_preferida_id) REFERENCES salas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profesional_ausencias (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profesional_id SMALLINT UNSIGNED NOT NULL,
  desde DATETIME NOT NULL,
  hasta DATETIME NOT NULL,
  motivo VARCHAR(160) NULL,
  CONSTRAINT pa_orden CHECK (desde < hasta),
  CONSTRAINT pa_profesional FOREIGN KEY (profesional_id) REFERENCES profesionales (id) ON DELETE CASCADE,
  KEY pa_rango (profesional_id, desde, hasta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comidas y descansos. «fija»: de ventana_inicio a ventana_fin. «flotante»: duracion_min dentro de
-- la ventana; el motor de agenda garantiza que siempre quepa. dia_semana NULL = todos los días.
CREATE TABLE IF NOT EXISTS pausas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profesional_id SMALLINT UNSIGNED NOT NULL,
  tipo ENUM('comida','descanso') NOT NULL DEFAULT 'comida',
  modo ENUM('fija','flotante') NOT NULL,
  dia_semana TINYINT UNSIGNED NULL,
  ventana_inicio TIME NOT NULL,
  ventana_fin TIME NOT NULL,
  duracion_min SMALLINT UNSIGNED NOT NULL,
  CONSTRAINT pausa_orden CHECK (ventana_inicio < ventana_fin),
  CONSTRAINT pausa_profesional FOREIGN KEY (profesional_id) REFERENCES profesionales (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS familias (
  codigo VARCHAR(40) NOT NULL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  orden SMALLINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tratamientos (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  familia VARCHAR(40) NOT NULL,
  subfamilia VARCHAR(80) NULL,
  descripcion VARCHAR(400) NULL,
  duracion_min SMALLINT UNSIGNED NOT NULL,
  duracion_fuente ENUM('clinica','treatwell','web','sector','estimada') NOT NULL DEFAULT 'estimada',
  primera_visita_min SMALLINT UNSIGNED NULL,
  holgura_antes_min SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  holgura_despues_min SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  crema_anestesica_min SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  precio_eur DECIMAL(9,2) NULL,
  precio_texto VARCHAR(80) NULL,
  es_promocion BOOLEAN NOT NULL DEFAULT FALSE,
  rol_profesional ENUM('medico','cirujano','enfermeria','esteticista','nutricionista','tricologo','recepcion','otro') NULL,
  sala_tipo ENUM('consulta_medica','cabina_estetica','cabina_aparatologia','quirofano','sala_capilar','head_spa','otra') NULL,
  equipo_codigo VARCHAR(40) NULL,
  sesiones VARCHAR(80) NULL,
  intervalo_sesiones_dias SMALLINT UNSIGNED NULL,
  repetir_cada_dias SMALLINT UNSIGNED NULL,
  repetir_fuente VARCHAR(40) NULL,
  regimen_legal ENUM('medicamento_receta','producto_sanitario','aparatologia','cirugia','cosmetico','servicio','desconocido') NOT NULL DEFAULT 'desconocido',
  publicidad_restringida BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_restriccion VARCHAR(255) NULL,
  texto_whatsapp VARCHAR(400) NULL,
  alias JSON NULL,
  fuentes JSON NULL,
  notas VARCHAR(600) NULL,
  reservable_ia BOOLEAN NOT NULL DEFAULT TRUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  validado_clinica BOOLEAN NOT NULL DEFAULT FALSE,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT trat_familia FOREIGN KEY (familia) REFERENCES familias (codigo),
  KEY trat_familia_idx (familia, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Salas y profesionales permitidos por tratamiento. Si un tratamiento no tiene filas aquí, vale
-- cualquier sala de su sala_tipo y cualquier profesional de su rol.
CREATE TABLE IF NOT EXISTS tratamiento_salas (
  tratamiento_id VARCHAR(80) NOT NULL,
  sala_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (tratamiento_id, sala_id),
  CONSTRAINT ts_trat FOREIGN KEY (tratamiento_id) REFERENCES tratamientos (id) ON DELETE CASCADE,
  CONSTRAINT ts_sala FOREIGN KEY (sala_id) REFERENCES salas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tratamiento_profesionales (
  tratamiento_id VARCHAR(80) NOT NULL,
  profesional_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (tratamiento_id, profesional_id),
  CONSTRAINT tp_trat FOREIGN KEY (tratamiento_id) REFERENCES tratamientos (id) ON DELETE CASCADE,
  CONSTRAINT tp_prof FOREIGN KEY (profesional_id) REFERENCES profesionales (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Respuestas a dudas frecuentes. Salen del blog de la clínica y solo las usa la IA cuando el
-- equipo médico las ha aprobado.
CREATE TABLE IF NOT EXISTS respuestas_aprobadas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tratamiento_id VARCHAR(80) NULL,
  pregunta VARCHAR(255) NOT NULL,
  respuesta VARCHAR(800) NOT NULL,
  fuente_url VARCHAR(255) NULL,
  aprobada BOOLEAN NOT NULL DEFAULT FALSE,
  aprobada_por VARCHAR(120) NULL,
  aprobada_en DATETIME NULL,
  CONSTRAINT ra_trat FOREIGN KEY (tratamiento_id) REFERENCES tratamientos (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pacientes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellidos VARCHAR(120) NULL,
  telefono VARCHAR(20) NULL,
  email VARCHAR(160) NULL,
  fecha_nacimiento DATE NULL,
  idioma CHAR(2) NOT NULL DEFAULT 'es',
  origen VARCHAR(40) NULL,
  horario_preferido VARCHAR(60) NULL,
  hora_habitual_respuesta TIME NULL,
  ghl_contact_id VARCHAR(60) NULL,
  flowww_id VARCHAR(60) NULL,
  notas_cifradas BLOB NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  anonimizado_en DATETIME NULL,
  UNIQUE KEY paciente_telefono (telefono),
  KEY paciente_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada consentimiento es un hecho con su prueba (lo que marcó o escribió el paciente). El estado
-- vigente es el último registro de cada tipo.
CREATE TABLE IF NOT EXISTS consentimientos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paciente_id INT UNSIGNED NOT NULL,
  tipo ENUM('whatsapp_servicio','whatsapp_marketing','email_marketing','datos_salud','imagenes','resenas') NOT NULL,
  estado ENUM('otorgado','revocado') NOT NULL,
  fuente ENUM('formulario','whatsapp','recepcion','web','importacion','otro') NOT NULL,
  prueba VARCHAR(500) NULL,
  registrado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registrado_por VARCHAR(120) NULL,
  CONSTRAINT cons_paciente FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE CASCADE,
  KEY cons_vigente (paciente_id, tipo, registrado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuarios (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  rol ENUM('direccion','recepcion','medico','estetica','marketing','admin') NOT NULL,
  profesional_id SMALLINT UNSIGNED NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT usuario_prof FOREIGN KEY (profesional_id) REFERENCES profesionales (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registro de hechos (solo se añade). «Se guardan hechos, no resultados»: con esto se reconstruye
-- cualquier conversación, cita o decisión de la IA.
CREATE TABLE IF NOT EXISTS eventos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(60) NOT NULL,
  entidad VARCHAR(40) NULL,
  entidad_id VARCHAR(80) NULL,
  actor VARCHAR(80) NOT NULL DEFAULT 'sistema',
  datos JSON NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY eventos_entidad (entidad, entidad_id, creado_en),
  KEY eventos_tipo (tipo, creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cola de trabajos: la procesa el cron cada minuto con SELECT … FOR UPDATE SKIP LOCKED.
CREATE TABLE IF NOT EXISTS cola (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(60) NOT NULL,
  carga JSON NULL,
  clave_unica VARCHAR(120) NULL,
  ejecutar_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado ENUM('pendiente','en_curso','hecho','fallido') NOT NULL DEFAULT 'pendiente',
  intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_intentos TINYINT UNSIGNED NOT NULL DEFAULT 5,
  bloqueado_hasta DATETIME NULL,
  ultimo_error VARCHAR(1000) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  terminado_en DATETIME NULL,
  UNIQUE KEY cola_clave (clave_unica),
  KEY cola_pendientes (estado, ejecutar_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candados (
  nombre VARCHAR(80) NOT NULL PRIMARY KEY,
  dueno VARCHAR(120) NOT NULL,
  hasta DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhooks entrantes: se guardan tal cual, se responde 200 y se procesan (y si algo falla, el cron
-- los recoge).
CREATE TABLE IF NOT EXISTS webhooks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  proveedor VARCHAR(30) NOT NULL,
  evento VARCHAR(60) NULL,
  id_externo VARCHAR(160) NULL,
  cuerpo LONGTEXT NOT NULL,
  firma_ok BOOLEAN NULL,
  recibido_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  procesado_en DATETIME NULL,
  error VARCHAR(1000) NULL,
  UNIQUE KEY webhook_unico (proveedor, id_externo),
  KEY webhook_pendiente (procesado_en, recibido_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
