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
-- Va entera en una transacción: o se aplica toda o no se aplica nada.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS sin_verificar BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verificado_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS lead_verificar ON leads (telefono, sin_verificar);

ALTER TABLE solicitudes_web
  ALTER COLUMN pagina DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS datos_cifrados BYTEA,
  ADD COLUMN IF NOT EXISTS datos_iv BYTEA CONSTRAINT solicitudes_web_datos_iv_len CHECK (octet_length(datos_iv) <= 16),
  ADD COLUMN IF NOT EXISTS datos_tag BYTEA CONSTRAINT solicitudes_web_datos_tag_len CHECK (octet_length(datos_tag) <= 16),
  ADD COLUMN IF NOT EXISTS version_conocida BOOLEAN,
  ADD COLUMN IF NOT EXISTS verificada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rechazada_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS solicitud_verificada ON solicitudes_web (telefono, verificada_en);
