-- 008 · Lo íntimo no se nombra en los mensajes que salen sin que el paciente pregunte: un WhatsApp se
-- lee en la pantalla bloqueada y el tratamiento es un dato de salud (art. 9 RGPD). sensible a NULL:
-- lo que diga su familia (ginecoestética, sexualidad masculina y pérdida de peso, en
-- motor/repesca/filtro-legal.js); TRUE o FALSE: lo ha decidido la clínica para ese tratamiento.

ALTER TABLE tratamientos
  ADD COLUMN IF NOT EXISTS sensible BOOLEAN;
