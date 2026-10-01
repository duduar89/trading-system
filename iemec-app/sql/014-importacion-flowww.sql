-- 014 · Importación de Flowww (scripts/importar-flowww.js). De cada cita, de qué cita de Flowww viene
-- (repetir la importación no la duplica), por qué hay que revisarla (no cabía en la agenda, o en
-- Flowww se ha anulado o movido desde que se trajo) y si se le mandan los recordatorios de víspera y
-- 2 horas (se importan con ellos salvo --sin-recordatorios; a cualquier otra cita también se le
-- pueden quitar). Sus observaciones, cifradas (AES-256-GCM, como las del paciente): en Flowww suelen
-- llevar datos de salud. El código de Flowww del paciente pasa a ser único. Y las notas del paciente se
-- guardan cifradas como los mensajes: notas_cifradas no tenía dónde guardar su iv y su etiqueta.

ALTER TABLE citas
  ADD COLUMN IF NOT EXISTS flowww_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS revisar_motivo VARCHAR(255),
  ADD COLUMN IF NOT EXISTS recordatorios BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notas_cifradas BYTEA,
  ADD COLUMN IF NOT EXISTS notas_iv BYTEA CONSTRAINT citas_notas_iv_len CHECK (octet_length(notas_iv) <= 16),
  ADD COLUMN IF NOT EXISTS notas_tag BYTEA CONSTRAINT citas_notas_tag_len CHECK (octet_length(notas_tag) <= 16);
CREATE UNIQUE INDEX IF NOT EXISTS cita_flowww ON citas (flowww_id);

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS notas_iv BYTEA CONSTRAINT pacientes_notas_iv_len CHECK (octet_length(notas_iv) <= 16),
  ADD COLUMN IF NOT EXISTS notas_tag BYTEA CONSTRAINT pacientes_notas_tag_len CHECK (octet_length(notas_tag) <= 16);
CREATE UNIQUE INDEX IF NOT EXISTS paciente_flowww ON pacientes (flowww_id);
