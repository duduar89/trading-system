-- 007 · Entrada de WhatsApp y de leads: los tipos de mensaje que llegan (vídeo, sticker, ubicación,
-- reacción…), el lead que llega de la web, las respuestas del formulario (cifradas, como los
-- mensajes), las tareas de un lead que aún no tiene conversación, el mapeo de campañas, anuncios,
-- respuestas y códigos de la web a tratamientos y la lista de bajas comerciales por teléfono.
-- Los valores nuevos de los ENUM van al final: así el cambio no reescribe los que ya hay.

ALTER TABLE mensajes
  MODIFY COLUMN tipo ENUM('texto','plantilla','audio','imagen','documento','boton','interactivo','sistema',
    'video','sticker','ubicacion','contacto','reaccion','otro') NOT NULL DEFAULT 'texto';

ALTER TABLE leads
  MODIFY COLUMN origen ENUM('meta_formulario','meta_ctwa','web_whatsapp','ghl','treatwell','telefono','recepcion','google',
    'referido','otro','web') NOT NULL,
  MODIFY COLUMN ctwa_clid VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS respuestas_cifradas BLOB NULL AFTER texto_inicial,
  ADD COLUMN IF NOT EXISTS respuestas_iv VARBINARY(16) NULL AFTER respuestas_cifradas,
  ADD COLUMN IF NOT EXISTS respuestas_tag VARBINARY(16) NULL AFTER respuestas_iv,
  ADD KEY IF NOT EXISTS lead_telefono (telefono),
  ADD KEY IF NOT EXISTS lead_email (email);

-- El nombre de su perfil de WhatsApp: para saludar y para verlo en la bandeja mientras no es lead
-- ni paciente.
ALTER TABLE conversaciones
  ADD COLUMN IF NOT EXISTS nombre_whatsapp VARCHAR(120) NULL AFTER telefono;

-- Un lead sin teléfono válido no tiene conversación: su tarea para recepción apunta al lead.
ALTER TABLE tareas
  ADD COLUMN IF NOT EXISTS lead_id INT UNSIGNED NULL AFTER paciente_id,
  ADD KEY IF NOT EXISTS tarea_lead (lead_id),
  ADD CONSTRAINT tarea_lead_fk FOREIGN KEY IF NOT EXISTS (lead_id) REFERENCES leads (id) ON DELETE CASCADE;

-- Qué tratamiento corresponde a cada campaña, conjunto, anuncio o formulario de Meta (por su
-- identificador o su nombre exacto), a cada respuesta de un formulario («Tratamientos capilares») o
-- a cada código de campaña de la web. Sin regla, el tratamiento se busca por su nombre y sus alias
-- en el catálogo.
CREATE TABLE IF NOT EXISTS mapeo_tratamientos (
  clave VARCHAR(160) NOT NULL PRIMARY KEY,
  tratamiento_id VARCHAR(80) NOT NULL,
  notas VARCHAR(255) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mapeo_trat_fk FOREIGN KEY (tratamiento_id) REFERENCES tratamientos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La lista de bajas comerciales: quien ha pedido no recibir mensajes comerciales, sea o no paciente
-- (lo escribió por WhatsApp o Meta avisa con el 131050 de que ha bloqueado el marketing de la
-- clínica). Por teléfono: si vuelve a entrar como lead, no se le inscribe en ninguna secuencia (tarea
-- para recepción). Sin claves ajenas: la baja se respeta aunque se borre el lead o la conversación.
CREATE TABLE IF NOT EXISTS bajas_comerciales (
  telefono VARCHAR(20) NOT NULL PRIMARY KEY,
  fuente VARCHAR(40) NOT NULL,
  conversacion_id INT UNSIGNED NULL,
  lead_id INT UNSIGNED NULL,
  paciente_id INT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
