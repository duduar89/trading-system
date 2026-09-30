-- 010 · Privacidad de la cita y «Añadir al calendario» con un toque.
--
-- El token de «Tu cita» deja de guardarse en claro. En la base quedan su huella (SHA-256), para
-- encontrar la cita, y el token cifrado con CLAVE_CIFRADO (AES-256-GCM), para volver a mandar el
-- enlace. El enlace caduca 30 días después de la cita (token_caduca_en). Los tokens de antes pasan a
-- token_antiguo con su huella ya calculada: los cifra migrar() nada más aplicar esta migración (en
-- SQL no se puede: la clave solo la tiene la app) y deja token_antiguo vacío. Una migración
-- posterior podrá quitar la columna.
--
-- El .ics lleva un UID aleatorio guardado en la cita (uid_ics, RFC 7986: sin datos del servidor ni
-- del número de cita). Las citas de antes conservan el que ya tenían los calendarios
-- (cita-<id>@iemec-clinic.com): así su anulación sigue casando con el evento que importaron.
--
-- Sedes: dónde está cada sala. LOCATION, GEO y el mapa de WhatsApp salen de la sede de la sala de la
-- cita; una sala sin sede (sede_id NULL) está en la principal. Se da de alta la de IEMEC con los datos
-- públicos de su web (dirección y coordenadas de sus datos estructurados).

CREATE TABLE IF NOT EXISTS sedes (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  direccion VARCHAR(200) NOT NULL,
  cp VARCHAR(10) NULL,
  municipio VARCHAR(80) NULL,
  provincia VARCHAR(80) NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  indicaciones VARCHAR(400) NULL,
  principal BOOLEAN NOT NULL DEFAULT FALSE,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sedes (codigo, nombre, direccion, cp, municipio, provincia, lat, lng, principal)
VALUES ('iemec', 'IEMEC', 'Av. Siglo XXI, 13, local 35', '28660', 'Boadilla del Monte', 'Madrid', 40.4066059, -3.9001441, TRUE)
ON DUPLICATE KEY UPDATE codigo = codigo;

ALTER TABLE salas
  ADD COLUMN IF NOT EXISTS sede_id SMALLINT UNSIGNED NULL AFTER tipo,
  ADD CONSTRAINT sala_sede_fk FOREIGN KEY IF NOT EXISTS (sede_id) REFERENCES sedes (id);

-- El token en claro, fuera de su sitio (y sin su índice): nada vuelve a escribirlo.
ALTER TABLE citas
  CHANGE COLUMN IF EXISTS token token_antiguo CHAR(43) NULL;
ALTER TABLE citas
  DROP INDEX IF EXISTS cita_token;

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS token_hash BINARY(32) NULL AFTER primera_visita,
  ADD COLUMN IF NOT EXISTS token_cifrado VARBINARY(64) NULL AFTER token_hash,
  ADD COLUMN IF NOT EXISTS token_iv VARBINARY(16) NULL AFTER token_cifrado,
  ADD COLUMN IF NOT EXISTS token_tag VARBINARY(16) NULL AFTER token_iv,
  ADD COLUMN IF NOT EXISTS token_caduca_en DATETIME NULL AFTER token_tag,
  ADD COLUMN IF NOT EXISTS uid_ics VARCHAR(80) NULL AFTER secuencia_ics;

UPDATE citas SET token_hash = UNHEX(SHA2(token_antiguo, 256)) WHERE token_hash IS NULL AND token_antiguo IS NOT NULL;
UPDATE citas SET token_caduca_en = fin + INTERVAL 30 DAY WHERE token_caduca_en IS NULL;
UPDATE citas SET uid_ics = CONCAT('cita-', id, '@iemec-clinic.com') WHERE uid_ics IS NULL;

ALTER TABLE citas
  MODIFY COLUMN token_hash BINARY(32) NOT NULL,
  ADD UNIQUE KEY IF NOT EXISTS cita_token_hash (token_hash),
  ADD UNIQUE KEY IF NOT EXISTS cita_uid_ics (uid_ics);
