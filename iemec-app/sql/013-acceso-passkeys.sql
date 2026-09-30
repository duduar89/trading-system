-- 013 · Acceso del personal con passkeys (WebAuthn), en lugar de la clave compartida PANEL_CLAVE.
-- Cada persona del equipo es un usuario con su rol y entra con una o varias passkeys (su móvil, el
-- ordenador de recepción…). Se da de alta con un enlace de un solo uso que caduca a las 24 horas: en
-- la base solo está la huella SHA-256 del token. Los retos de WebAuthn se guardan aquí, caducan a los
-- pocos minutos y se gastan al usarlos. Los intentos de entrar se cuentan por la huella de la IP (la IP
-- no se guarda). Una sesión deja de valer al momento si el usuario se desactiva, si se cierran sus
-- sesiones (sesion_version) o si se borra la passkey con la que entró.
-- Los identificadores de WebAuthn van en base64url, que distingue mayúsculas: por eso ascii_bin.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS id_webauthn VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER profesional_id,
  ADD COLUMN IF NOT EXISTS sesion_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER activo,
  ADD COLUMN IF NOT EXISTS desactivado_en DATETIME NULL AFTER sesion_version,
  ADD COLUMN IF NOT EXISTS ultimo_acceso_en DATETIME NULL AFTER desactivado_en,
  ADD COLUMN IF NOT EXISTS creado_por VARCHAR(160) NULL AFTER creado_en,
  ADD UNIQUE KEY IF NOT EXISTS usuario_webauthn (id_webauthn);

-- Las passkeys de cada persona. La clave privada nunca sale de su dispositivo: aquí solo está la
-- pública (COSE) y el contador de firmas, que tiene que avanzar (si no, puede ser una copia).
CREATE TABLE IF NOT EXISTS passkeys (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id SMALLINT UNSIGNED NOT NULL,
  credencial_id VARCHAR(1400) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  clave_publica BLOB NOT NULL,
  contador INT UNSIGNED NOT NULL DEFAULT 0,
  transportes JSON NULL,
  dispositivo VARCHAR(80) NOT NULL,
  sincronizada BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_uso_en DATETIME NULL,
  UNIQUE KEY passkey_credencial (credencial_id),
  KEY passkey_usuario (usuario_id),
  CONSTRAINT passkey_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Enlaces de alta (y de passkey nueva, si alguien pierde las suyas). Un enlace nuevo anula el anterior.
CREATE TABLE IF NOT EXISTS invitaciones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id SMALLINT UNSIGNED NOT NULL,
  token_huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  caduca_en DATETIME NOT NULL,
  usada_en DATETIME NULL,
  anulada_en DATETIME NULL,
  creada_por VARCHAR(160) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY invitacion_token (token_huella),
  KEY invitacion_usuario (usuario_id, caduca_en),
  CONSTRAINT invitacion_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Retos de un solo uso: «alta» (con su enlace), «entrar» y «nueva_passkey» (con sesión).
CREATE TABLE IF NOT EXISTS retos_webauthn (
  reto VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  proposito ENUM('alta','entrar','nueva_passkey') NOT NULL,
  usuario_id SMALLINT UNSIGNED NULL,
  invitacion_id INT UNSIGNED NULL,
  caduca_en DATETIME NOT NULL,
  KEY reto_caducidad (caduca_en),
  CONSTRAINT reto_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT reto_invitacion_fk FOREIGN KEY (invitacion_id) REFERENCES invitaciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Límite de intentos por ventana (p. ej. «fallos:» + huella de la IP). El cron borra las ventanas
-- pasadas.
CREATE TABLE IF NOT EXISTS limites_acceso (
  clave VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  intentos SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  hasta DATETIME NOT NULL,
  KEY limite_hasta (hasta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
