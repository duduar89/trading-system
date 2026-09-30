-- 012 · Posiciones de la clínica en Google Maps, medidas con DataForSEO desde una malla de puntos a
-- su alrededor (servidor/posiciones.js): cada búsqueda enviada, con lo que ha costado (para el tope de
-- gasto del mes), y el puesto de la clínica en cada punto con quién sale 1.º.
-- Las métricas y las palabras de la ficha van en metricas_gbp y busquedas_gbp (004).

-- Una búsqueda (palabra y punto) de una pasada semanal. El id es el de la tarea en DataForSEO.
CREATE TABLE IF NOT EXISTS posiciones_tareas (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  pasada DATE NOT NULL,
  palabra VARCHAR(160) NOT NULL,
  punto VARCHAR(40) NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  zoom TINYINT UNSIGNED NOT NULL,
  profundidad TINYINT UNSIGNED NOT NULL,
  coste_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
  estado ENUM('enviada','recogida','fallida','caducada') NOT NULL DEFAULT 'enviada',
  error VARCHAR(300) NULL,
  enviada_en DATETIME NOT NULL,
  recogida_en DATETIME NULL,
  UNIQUE KEY posicion_tarea_unica (pasada, palabra, punto),
  KEY posicion_tarea_estado (estado, enviada_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dónde sale la clínica: puesto NULL si no sale entre los «profundidad» primeros. Del 1.º solo lo
-- público de su ficha (nombre, categoría, nota y número de reseñas); nada de sus reseñas.
CREATE TABLE IF NOT EXISTS posiciones_maps (
  pasada DATE NOT NULL,
  palabra VARCHAR(160) NOT NULL,
  punto VARCHAR(40) NOT NULL,
  puesto TINYINT UNSIGNED NULL,
  resultados TINYINT UNSIGNED NOT NULL DEFAULT 0,
  primero VARCHAR(200) NULL,
  primero_categoria VARCHAR(120) NULL,
  primero_nota DECIMAL(2,1) NULL,
  primero_resenas INT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pasada, palabra, punto),
  KEY posicion_palabra (palabra, pasada)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
