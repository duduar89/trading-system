-- 011 · Reseñas con las normas de Google y la ley:
--   · el enlace oficial para reseñar de la ficha (newReviewUri), que se lee cada día y vale 30 días;
--   · la prueba del momento de pedir la reseña (2 horas después, al día siguiente a las 11:00 o a los
--     3 días), elegida por cita y guardada para medirla, y un solo recordatorio a los 7-9 días si no
--     abrió el enlace;
--   · el texto y el autor que vienen de Google se borran a los 29 días de leerlos, un día antes de los
--     30 de las normas de la API (se quedan el id, las estrellas, las fechas, los estados y nuestras
--     respuestas);
--   · la alerta clínica (con su tarea para dirección médica), el historial que se contesta poco a
--     poco y la moderación de nuestras respuestas (reviewReplyState y policyViolation);
--   · las reseñas que Google ya no da (las borró quien las escribió o las retiró Google): fuera de la
--     bandeja y de las cifras, y vuelven si reaparecen.
-- Los valores nuevos de los ENUM van al final. Todo con IF NOT EXISTS: se puede repetir.

-- La ficha: su enlace para reseñar, cuándo se leyó y qué momentos de la prueba están en marcha
-- (si la clínica se queda con uno, deja solo ese).
ALTER TABLE clinica
  ADD COLUMN IF NOT EXISTS google_enlace_resena VARCHAR(500) NULL AFTER google_place_id,
  ADD COLUMN IF NOT EXISTS google_ficha_leida_en DATETIME NULL AFTER google_enlace_resena,
  ADD COLUMN IF NOT EXISTS resenas_momentos SET('2h','dia_siguiente','tres_dias') NOT NULL DEFAULT '2h,dia_siguiente,tres_dias' AFTER google_ficha_leida_en;

-- Cada petición, con su variante del momento y su recordatorio.
ALTER TABLE peticiones_resena
  ADD COLUMN IF NOT EXISTS variante ENUM('2h','dia_siguiente','tres_dias') NULL AFTER programada_para,
  ADD COLUMN IF NOT EXISTS recordatorio_para DATETIME NULL AFTER pulsada_en,
  ADD COLUMN IF NOT EXISTS recordatorio_estado ENUM('programado','enviado','omitido','fallido') NULL AFTER recordatorio_para,
  ADD COLUMN IF NOT EXISTS recordatorio_enviado_en DATETIME NULL AFTER recordatorio_estado,
  ADD COLUMN IF NOT EXISTS recordatorio_motivo VARCHAR(160) NULL AFTER recordatorio_enviado_en,
  ADD KEY IF NOT EXISTS peticion_recordatorio (recordatorio_estado, recordatorio_para),
  ADD KEY IF NOT EXISTS peticion_enviada (enviada_en);

-- Las reseñas:
--   con_texto               si la reseña traía texto (se sabe aunque el texto ya se haya borrado)
--   actualizada_en          el updateTime de Google (si cambia, la persona la ha editado)
--   contenido_leido_en      cuándo se leyeron de Google el texto y el autor; a los 29 días se borran
--   historial               llegó con días y sin respuesta: se contesta poco a poco
--   liberada_en             cuándo pasó del historial a la bandeja, con su borrador
--   alerta_clinica          habla de una posible complicación o de una reclamación: dirección médica
--   publicar_en             respuesta del historial aprobada: cuándo le toca salir (por la cola)
--   primera_respuesta_en    nuestra primera publicación (el updateTime de Google cambia si se edita)
--   respuesta_estado        la moderación de Google de nuestra respuesta (reviewReplyState)
--   respuesta_motivo_rechazo  el policyViolation si la rechaza
--   respuestas_rechazadas   cuántas veces nos ha rechazado Google una respuesta a esta reseña
--   retirada_en             Google ya no la da (una lectura completa sin ella, o un 404 al contestarla)
ALTER TABLE resenas
  MODIFY COLUMN estado ENUM('nueva','borrador','aprobada','publicada','ignorada','historial') NOT NULL DEFAULT 'nueva',
  ADD COLUMN IF NOT EXISTS con_texto BOOLEAN NOT NULL DEFAULT FALSE AFTER texto,
  ADD COLUMN IF NOT EXISTS actualizada_en DATETIME NULL AFTER publicada_en,
  ADD COLUMN IF NOT EXISTS contenido_leido_en DATETIME NULL AFTER actualizada_en,
  ADD COLUMN IF NOT EXISTS contenido_borrado_en DATETIME NULL AFTER contenido_leido_en,
  ADD COLUMN IF NOT EXISTS historial BOOLEAN NOT NULL DEFAULT FALSE AFTER prioridad,
  ADD COLUMN IF NOT EXISTS liberada_en DATETIME NULL AFTER historial,
  ADD COLUMN IF NOT EXISTS alerta_clinica BOOLEAN NOT NULL DEFAULT FALSE AFTER liberada_en,
  ADD COLUMN IF NOT EXISTS alerta_tarea_id INT UNSIGNED NULL AFTER alerta_clinica,
  ADD COLUMN IF NOT EXISTS publicar_en DATETIME NULL AFTER aprobada_por,
  ADD COLUMN IF NOT EXISTS primera_respuesta_en DATETIME NULL AFTER respondida_en,
  ADD COLUMN IF NOT EXISTS respuesta_estado ENUM('pendiente','aprobada','rechazada') NULL AFTER primera_respuesta_en,
  ADD COLUMN IF NOT EXISTS respuesta_motivo_rechazo VARCHAR(60) NULL AFTER respuesta_estado,
  ADD COLUMN IF NOT EXISTS respuesta_revisada_en DATETIME NULL AFTER respuesta_motivo_rechazo,
  ADD COLUMN IF NOT EXISTS respuestas_rechazadas TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER respuesta_revisada_en,
  ADD COLUMN IF NOT EXISTS error_publicar VARCHAR(255) NULL AFTER respuestas_rechazadas,
  ADD COLUMN IF NOT EXISTS retirada_en DATETIME NULL AFTER error_publicar,
  ADD KEY IF NOT EXISTS resena_contenido (contenido_borrado_en, contenido_leido_en),
  ADD KEY IF NOT EXISTS resena_publicada (publicada_en),
  ADD KEY IF NOT EXISTS resena_historial (historial, estado, publicar_en);

-- Lo que ya estaba guardado cuenta desde que se guardó, y nuestras respuestas ya publicadas cuentan
-- como primera respuesta. Solo se rellena lo que falta: repetirlo no cambia nada.
UPDATE resenas SET contenido_leido_en = creado_en
 WHERE contenido_leido_en IS NULL AND contenido_borrado_en IS NULL AND (texto IS NOT NULL OR autor IS NOT NULL);
UPDATE resenas SET con_texto = TRUE WHERE texto IS NOT NULL AND TRIM(texto) <> '';
UPDATE resenas SET primera_respuesta_en = respondida_en WHERE primera_respuesta_en IS NULL AND respondida_en IS NOT NULL;
-- Las peticiones de antes de la prueba salían todas a las 2 horas.
UPDATE peticiones_resena SET variante = '2h' WHERE variante IS NULL AND estado IN ('programada','enviada','fallida');
