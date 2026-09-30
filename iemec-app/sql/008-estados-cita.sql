-- 008 · Estados de la cita que marca recepción: cuándo llegó el paciente, cuándo se completó la cita
-- y cuándo se marcó que no vino, y de qué estado venía (y cuándo cambió) para poder deshacer el
-- último cambio durante un rato. estado_anterior guarda un valor de citas.estado (VARCHAR para no
-- tener que repetir aquí su lista cada vez que cambie).

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS estado_anterior VARCHAR(20) NULL AFTER estado,
  ADD COLUMN IF NOT EXISTS estado_cambiado_en DATETIME NULL AFTER estado_anterior,
  ADD COLUMN IF NOT EXISTS llegada_en DATETIME NULL AFTER confirmada_en,
  ADD COLUMN IF NOT EXISTS completada_en DATETIME NULL AFTER llegada_en,
  ADD COLUMN IF NOT EXISTS no_presentada_en DATETIME NULL AFTER completada_en;
