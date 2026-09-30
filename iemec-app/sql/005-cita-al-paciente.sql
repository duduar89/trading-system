-- 005 · La cita llega al paciente: huecos ofrecidos en la conversación (para reservar el que
-- elija), de qué conversación sale cada cita y qué avisos se le han mandado.

ALTER TABLE conversaciones
  ADD COLUMN IF NOT EXISTS huecos_ofrecidos JSON NULL AFTER ya_pregunto_cuando,
  ADD COLUMN IF NOT EXISTS huecos_tratamiento_id VARCHAR(80) NULL AFTER huecos_ofrecidos,
  ADD COLUMN IF NOT EXISTS huecos_ofrecidos_en DATETIME NULL AFTER huecos_tratamiento_id;

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS conversacion_id INT UNSIGNED NULL AFTER origen,
  ADD COLUMN IF NOT EXISTS aviso_confirmacion_en DATETIME NULL AFTER confirmada_en,
  ADD COLUMN IF NOT EXISTS aviso_24h_en DATETIME NULL AFTER aviso_confirmacion_en,
  ADD COLUMN IF NOT EXISTS aviso_2h_en DATETIME NULL AFTER aviso_24h_en,
  ADD KEY IF NOT EXISTS cita_avisos (estado, inicio);
