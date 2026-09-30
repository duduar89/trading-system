-- 015 · El formulario «Te llamamos» de la web pública (POST /web/contacto): la prueba de cada
-- envío con sus consentimientos (RGPD, art. 7.1: hay que poder demostrarlos), por separado el de los
-- datos (obligatorio para contestar) y el comercial (opcional), con la fecha, la versión de los
-- textos que se aceptaron, la página y cómo prefiere que le contesten.
-- Sin clave ajena a leads: la prueba se conserva, bloqueada, aunque se borre el lead (LSSI, art. 45;
-- LOPDGDD, art. 32). La huella del envío evita duplicados si la web reintenta el mismo envío.
CREATE TABLE IF NOT EXISTS solicitudes_web (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id INT UNSIGNED NULL,
  telefono VARCHAR(20) NULL,
  pagina VARCHAR(200) NOT NULL,
  ref VARCHAR(40) NULL,
  tratamiento_id VARCHAR(80) NULL,
  interes VARCHAR(80) NULL,
  preferencia ENUM('whatsapp','llamada','correo') NOT NULL,
  consentimiento_datos BOOLEAN NOT NULL,
  consentimiento_comercial BOOLEAN NOT NULL,
  version_textos VARCHAR(20) NOT NULL,
  huella_envio CHAR(64) NOT NULL,
  enviado_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY solicitud_envio (huella_envio),
  KEY solicitud_lead (lead_id),
  KEY solicitud_telefono (telefono, enviado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
