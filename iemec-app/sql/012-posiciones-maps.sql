-- 012 · Posiciones de la clínica en Google Maps, medidas con DataForSEO desde una malla de puntos a
-- su alrededor (servidor/posiciones.js): cada búsqueda enviada, con lo que ha costado (para el tope de
-- gasto del mes), y el puesto de la clínica en cada punto con quién sale 1.º.
-- Las métricas y las palabras de la ficha van en metricas_gbp y busquedas_gbp (004).

-- Una búsqueda (palabra y punto) de una pasada semanal. El id es el de la tarea en DataForSEO.
-- «incierta»: DataForSEO no contestó al enviarla (tiempo agotado, conexión cortada, 5xx) y puede que
-- la haya creado y cobrado. Lleva un id provisional y lo que costaría (cuenta para el tope); no se
-- vuelve a enviar y, si DataForSEO la tenía, la recogida le pone su id por la etiqueta.
-- intentos: las veces que ha fallado ella sola al recogerla (a la tercera, fallida).
CREATE TABLE IF NOT EXISTS posiciones_tareas (
  id VARCHAR(64) PRIMARY KEY,
  pasada DATE NOT NULL,
  palabra VARCHAR(160) NOT NULL,
  punto VARCHAR(40) NOT NULL,
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  zoom SMALLINT NOT NULL,
  profundidad SMALLINT NOT NULL,
  coste_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'enviada',
  intentos SMALLINT NOT NULL DEFAULT 0,
  error VARCHAR(300),
  enviada_en TIMESTAMPTZ NOT NULL,
  recogida_en TIMESTAMPTZ,
  CONSTRAINT posiciones_tareas_zoom_pos CHECK (zoom >= 0),
  CONSTRAINT posiciones_tareas_profundidad_pos CHECK (profundidad >= 0),
  CONSTRAINT posiciones_tareas_estado_chk CHECK (estado IN ('enviada','incierta','recogida','fallida','caducada')),
  CONSTRAINT posiciones_tareas_intentos_pos CHECK (intentos >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS posicion_tarea_unica ON posiciones_tareas (pasada, palabra, punto);
CREATE INDEX IF NOT EXISTS posicion_tarea_estado ON posiciones_tareas (estado, enviada_en);

-- Dónde sale la clínica: puesto NULL si no sale entre los «profundidad» primeros (o si no sale nadie:
-- resultados 0). Del 1.º solo lo público de su ficha (nombre, categoría, nota y número de reseñas; sin
-- reseñas, nota NULL); nada de sus reseñas.
CREATE TABLE IF NOT EXISTS posiciones_maps (
  pasada DATE NOT NULL,
  palabra VARCHAR(160) NOT NULL,
  punto VARCHAR(40) NOT NULL,
  puesto SMALLINT,
  resultados SMALLINT NOT NULL DEFAULT 0,
  primero VARCHAR(200),
  primero_categoria VARCHAR(120),
  primero_nota NUMERIC(2,1),
  primero_resenas INTEGER,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT posiciones_maps_puesto_pos CHECK (puesto >= 0),
  CONSTRAINT posiciones_maps_resultados_pos CHECK (resultados >= 0),
  CONSTRAINT posiciones_maps_primero_resenas_pos CHECK (primero_resenas >= 0),
  PRIMARY KEY (pasada, palabra, punto)
);
CREATE INDEX IF NOT EXISTS posicion_palabra ON posiciones_maps (palabra, pasada);
