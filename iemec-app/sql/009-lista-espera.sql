-- 009 · Huecos que no se pierden: cambiar la cita por WhatsApp (la antigua queda «reprogramada»
-- y apunta a la nueva), cancelarla con confirmación, y lista de espera: cuando se libera un hueco,
-- se le guarda 30 minutos al primero que encaja y se le ofrece; si no lo quiere, pasa al siguiente.

-- La cita que se está cambiando mientras se le proponen huecos, y la pregunta que se le ha hecho
-- («¿La cancelo?», «¿Te busco otro momento?», «¿Te aviso si se libera un hueco?») para entender
-- su «sí» o su «no». La pregunta solo vale mientras sea lo último que le hemos escrito.
ALTER TABLE conversaciones
  ADD COLUMN IF NOT EXISTS reprograma_cita_id INT UNSIGNED NULL AFTER huecos_ofrecidos_en,
  ADD COLUMN IF NOT EXISTS pregunta_pendiente JSON NULL AFTER reprograma_cita_id;

-- Para encontrar deprisa los huecos que se acaban de liberar (canceladas y cambiadas).
ALTER TABLE citas
  ADD KEY IF NOT EXISTS cita_liberada (estado, cancelada_en);

-- cita_actual_id (de la 002) es la cita que quiere adelantar: solo si se enlaza al apuntarle. El
-- índice de la clave foránea ya se llama le_paciente: el compuesto va con otro nombre.
ALTER TABLE lista_espera
  ADD COLUMN IF NOT EXISTS origen ENUM('panel','whatsapp') NOT NULL DEFAULT 'panel' AFTER estado,
  ADD COLUMN IF NOT EXISTS creado_por VARCHAR(120) NULL AFTER origen,
  ADD COLUMN IF NOT EXISTS notas VARCHAR(255) NULL AFTER creado_por,
  ADD COLUMN IF NOT EXISTS conversacion_id INT UNSIGNED NULL AFTER notas,
  ADD COLUMN IF NOT EXISTS cerrado_en DATETIME NULL AFTER creado_en,
  ADD KEY IF NOT EXISTS le_paciente_estado (paciente_id, estado);

-- Cada hueco ofrecido a alguien de la lista. La cita retenida es la que le guarda el hueco mientras
-- contesta: la agenda ya no lo da por libre, así que nunca se ofrece a dos a la vez. La clave única
-- impide ofrecerle dos veces el mismo hueco a la misma persona (si dijo que no, pasa al siguiente;
-- si el aviso no salió, la oferta se borra y conserva su turno).
--   cambia_cita_id  la cita que se le adelanta si lo acepta (la que enlazó al apuntarse)
--   aviso           cómo se le avisó: el texto nombra la cita que se le cambia; la plantilla, no (y
--                   antes de cambiársela se le pregunta)
--   mensaje_id      el mensaje del aviso (si Meta dice que no le llegó, el hueco pasa al siguiente)
--   tarea_id        la tarea de recepción si su conversación pasó a una persona con la oferta en curso
CREATE TABLE IF NOT EXISTS lista_espera_ofertas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lista_espera_id INT UNSIGNED NOT NULL,
  cita_id INT UNSIGNED NULL,
  liberada_por_cita_id INT UNSIGNED NULL,
  cambia_cita_id INT UNSIGNED NULL,
  tratamiento_id VARCHAR(80) NOT NULL,
  inicio DATETIME NOT NULL,
  estado ENUM('ofrecida','aceptada','rechazada','caducada','anulada') NOT NULL DEFAULT 'ofrecida',
  conversacion_id INT UNSIGNED NULL,
  aviso ENUM('texto','plantilla') NULL,
  mensaje_id BIGINT UNSIGNED NULL,
  tarea_id INT UNSIGNED NULL,
  ofrecida_en DATETIME NOT NULL,
  caduca_en DATETIME NOT NULL,
  respondida_en DATETIME NULL,
  UNIQUE KEY leo_una_vez (lista_espera_id, tratamiento_id, inicio),
  KEY leo_estado (estado, caduca_en),
  KEY leo_hueco (tratamiento_id, inicio, estado),
  KEY leo_mensaje (mensaje_id),
  CONSTRAINT leo_lista FOREIGN KEY (lista_espera_id) REFERENCES lista_espera (id) ON DELETE CASCADE,
  CONSTRAINT leo_cita FOREIGN KEY (cita_id) REFERENCES citas (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
