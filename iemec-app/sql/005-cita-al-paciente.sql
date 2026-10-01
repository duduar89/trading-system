-- 005 · La cita llega al paciente: huecos ofrecidos en la conversación (para reservar el que
-- elija), de qué conversación sale cada cita y qué avisos se le han mandado.

ALTER TABLE conversaciones
  ADD COLUMN IF NOT EXISTS huecos_ofrecidos TEXT CONSTRAINT conversaciones_huecos_ofrecidos_json CHECK (huecos_ofrecidos IS NULL OR huecos_ofrecidos::jsonb IS NOT NULL),
  ADD COLUMN IF NOT EXISTS huecos_tratamiento_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS huecos_ofrecidos_en TIMESTAMPTZ;

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS conversacion_id INTEGER,
  ADD COLUMN IF NOT EXISTS aviso_confirmacion_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aviso_24h_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aviso_2h_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS cita_avisos ON citas (estado, inicio);
