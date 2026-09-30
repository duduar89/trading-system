-- 017 · El formulario «Te llamamos» de la web después de su revisión de seguridad y privacidad.
--
-- · leads.sin_verificar: el lead que llega del formulario de la web (anónimo: cualquiera puede escribir
--   el teléfono de otro) tiene el teléfono sin comprobar hasta que su dueño contesta «Sí, fui yo» al
--   WhatsApp de confirmación, o recepción lo confirma por teléfono. Mientras, no se une a nada de nadie
--   (ni a una conversación, ni a una ficha, ni a otro lead) y su casilla comercial no cuenta.
-- · solicitudes_web: lo que pidió (página, referencia, tratamiento, interés, nombre, correo, mensaje y
--   preferencia) va cifrado en datos_cifrados, como las respuestas del lead: la página y el tratamiento
--   pueden revelar un dato de salud. Las columnas en claro de la 015 se quedan vacías (un paso de
--   servidor/migraciones.js cifra las que hubiera). version_conocida: si la versión de los textos que
--   mandó el navegador es una de las que publicó la web (semillas/iemec/textos-formulario.json). Cuándo
--   se verificó o se rechazó («No fui yo»): la casilla comercial solo cuenta verificada.
-- Idempotente: se puede pasar dos veces.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS sin_verificar BOOLEAN NOT NULL DEFAULT FALSE AFTER etapa,
  ADD COLUMN IF NOT EXISTS verificado_en DATETIME NULL AFTER sin_verificar,
  ADD KEY IF NOT EXISTS lead_verificar (telefono, sin_verificar);

ALTER TABLE solicitudes_web
  MODIFY COLUMN pagina VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS datos_cifrados BLOB NULL AFTER interes,
  ADD COLUMN IF NOT EXISTS datos_iv VARBINARY(16) NULL AFTER datos_cifrados,
  ADD COLUMN IF NOT EXISTS datos_tag VARBINARY(16) NULL AFTER datos_iv,
  ADD COLUMN IF NOT EXISTS version_conocida BOOLEAN NULL AFTER version_textos,
  ADD COLUMN IF NOT EXISTS verificada_en DATETIME NULL AFTER enviado_en,
  ADD COLUMN IF NOT EXISTS rechazada_en DATETIME NULL AFTER verificada_en,
  ADD KEY IF NOT EXISTS solicitud_verificada (telefono, verificada_en);
