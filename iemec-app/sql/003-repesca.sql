-- 003 · Repesca: leads, presupuestos, conversaciones y mensajes (cifrados), secuencias,
-- seguimientos con fecha, catálogo de ofertas, plantillas de WhatsApp y tareas para personas.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS baja_comercial_en DATETIME NULL AFTER hora_habitual_respuesta,
  ADD COLUMN IF NOT EXISTS es_cliente BOOLEAN NOT NULL DEFAULT FALSE AFTER baja_comercial_en;

CREATE TABLE IF NOT EXISTS leads (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paciente_id INT UNSIGNED NULL,
  telefono VARCHAR(20) NULL,
  nombre VARCHAR(120) NULL,
  email VARCHAR(160) NULL,
  origen ENUM('meta_formulario','meta_ctwa','web_whatsapp','ghl','treatwell','telefono','recepcion','google','referido','otro') NOT NULL,
  campana VARCHAR(160) NULL,
  conjunto VARCHAR(160) NULL,
  anuncio VARCHAR(160) NULL,
  anuncio_id VARCHAR(60) NULL,
  ctwa_clid VARCHAR(120) NULL,
  codigo_web VARCHAR(40) NULL,
  utm JSON NULL,
  tratamiento_interes_id VARCHAR(80) NULL,
  texto_inicial VARCHAR(600) NULL,
  etapa ENUM('nuevo','contactado','conversando','cita','asistio','vendido','perdido') NOT NULL DEFAULT 'nuevo',
  motivo_perdida VARCHAR(40) NULL,
  ghl_contact_id VARCHAR(60) NULL,
  ghl_opportunity_id VARCHAR(60) NULL,
  id_externo VARCHAR(120) NULL,
  cita_id INT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  primer_contacto_en DATETIME NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY lead_externo (origen, id_externo),
  KEY lead_etapa (etapa, creado_en),
  KEY lead_paciente (paciente_id),
  CONSTRAINT lead_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE SET NULL,
  CONSTRAINT lead_trat_fk FOREIGN KEY (tratamiento_interes_id) REFERENCES tratamientos (id) ON DELETE SET NULL,
  CONSTRAINT lead_cita_fk FOREIGN KEY (cita_id) REFERENCES citas (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presupuestos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paciente_id INT UNSIGNED NOT NULL,
  codigo VARCHAR(30) NULL,
  titulo VARCHAR(160) NOT NULL,
  importe_eur DECIMAL(10,2) NOT NULL,
  estado ENUM('borrador','entregado','aceptado','rechazado','caducado') NOT NULL DEFAULT 'entregado',
  entregado_en DATETIME NULL,
  valido_hasta DATE NULL,
  profesional_id SMALLINT UNSIGNED NULL,
  motivo_rechazo VARCHAR(40) NULL,
  aceptado_en DATETIME NULL,
  notas VARCHAR(600) NULL,
  flowww_id VARCHAR(60) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY pres_estado (estado, entregado_en),
  CONSTRAINT pres_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE CASCADE,
  CONSTRAINT pres_prof_fk FOREIGN KEY (profesional_id) REFERENCES profesionales (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presupuesto_lineas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  presupuesto_id INT UNSIGNED NOT NULL,
  tratamiento_id VARCHAR(80) NULL,
  concepto VARCHAR(160) NOT NULL,
  sesiones SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  importe_eur DECIMAL(10,2) NOT NULL,
  CONSTRAINT pl_pres_fk FOREIGN KEY (presupuesto_id) REFERENCES presupuestos (id) ON DELETE CASCADE,
  CONSTRAINT pl_trat_fk FOREIGN KEY (tratamiento_id) REFERENCES tratamientos (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversaciones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paciente_id INT UNSIGNED NULL,
  lead_id INT UNSIGNED NULL,
  telefono VARCHAR(20) NOT NULL,
  estado ENUM('ia_activa','espera_persona','persona','esperando_paciente','pausada','cerrada') NOT NULL DEFAULT 'ia_activa',
  agente VARCHAR(40) NOT NULL DEFAULT 'repesca',
  contexto ENUM('lead','cancelacion','presupuesto','toca_repetir','dormido','vale_regalo','cita','general') NOT NULL DEFAULT 'general',
  contexto_id INT UNSIGNED NULL,
  asignada_a SMALLINT UNSIGNED NULL,
  ventana_hasta DATETIME NULL,
  ultimo_entrante_en DATETIME NULL,
  ultimo_saliente_en DATETIME NULL,
  proximo_paso ENUM('cita','seguimiento','persona','cerrada','espera_respuesta','ninguno') NOT NULL DEFAULT 'ninguno',
  proximo_paso_en DATETIME NULL,
  ya_pregunto_cuando BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_cierre VARCHAR(40) NULL,
  urgente BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY conv_telefono (telefono),
  KEY conv_estado (estado, actualizado_en),
  KEY conv_proximo (proximo_paso, proximo_paso_en),
  CONSTRAINT conv_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE SET NULL,
  CONSTRAINT conv_lead_fk FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE SET NULL,
  CONSTRAINT conv_usuario_fk FOREIGN KEY (asignada_a) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El texto va cifrado (AES-256-GCM) con la clave del servidor; en la base solo hay bytes.
CREATE TABLE IF NOT EXISTS mensajes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversacion_id INT UNSIGNED NOT NULL,
  direccion ENUM('entrante','saliente') NOT NULL,
  autor ENUM('paciente','ia','persona','sistema') NOT NULL,
  usuario_id SMALLINT UNSIGNED NULL,
  tipo ENUM('texto','plantilla','audio','imagen','documento','boton','interactivo','sistema') NOT NULL DEFAULT 'texto',
  cuerpo_cifrado BLOB NULL,
  iv VARBINARY(16) NULL,
  tag VARBINARY(16) NULL,
  plantilla_id INT UNSIGNED NULL,
  wa_id VARCHAR(120) NULL,
  estado ENUM('pendiente','enviado','entregado','leido','fallido','recibido') NOT NULL DEFAULT 'pendiente',
  error_codigo VARCHAR(20) NULL,
  error_texto VARCHAR(255) NULL,
  coste_eur DECIMAL(7,4) NULL,
  intencion VARCHAR(40) NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY msg_wa (wa_id),
  KEY msg_conv (conversacion_id, creado_en),
  CONSTRAINT msg_conv_fk FOREIGN KEY (conversacion_id) REFERENCES conversaciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inscripciones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  secuencia VARCHAR(40) NOT NULL,
  paciente_id INT UNSIGNED NULL,
  lead_id INT UNSIGNED NULL,
  cita_id INT UNSIGNED NULL,
  presupuesto_id INT UNSIGNED NULL,
  conversacion_id INT UNSIGNED NULL,
  inicio DATETIME NOT NULL,
  paso_actual TINYINT UNSIGNED NOT NULL DEFAULT 0,
  siguiente_en DATETIME NULL,
  estado ENUM('activa','pausada','terminada','cancelada') NOT NULL DEFAULT 'activa',
  motivo_fin VARCHAR(120) NULL,
  grupo_control BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ins_pendientes (estado, siguiente_en),
  KEY ins_paciente (paciente_id, estado),
  CONSTRAINT ins_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE CASCADE,
  CONSTRAINT ins_lead_fk FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE,
  CONSTRAINT ins_pres_fk FOREIGN KEY (presupuesto_id) REFERENCES presupuestos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los seguimientos con fecha: la «memoria» de la repesca vive aquí, no en la IA.
CREATE TABLE IF NOT EXISTS seguimientos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paciente_id INT UNSIGNED NULL,
  lead_id INT UNSIGNED NULL,
  conversacion_id INT UNSIGNED NULL,
  contexto ENUM('lead','cancelacion','presupuesto','toca_repetir','dormido','vale_regalo','cita','general') NOT NULL DEFAULT 'general',
  contexto_id INT UNSIGNED NULL,
  motivo VARCHAR(40) NOT NULL,
  plazo_tipo VARCHAR(30) NULL,
  frase_cifrada BLOB NULL,
  frase_iv VARBINARY(16) NULL,
  frase_tag VARBINARY(16) NULL,
  programado_para DATETIME NOT NULL,
  estado ENUM('pendiente','enviado','cancelado','cumplido','fallido') NOT NULL DEFAULT 'pendiente',
  creado_por ENUM('ia','persona','sistema') NOT NULL DEFAULT 'ia',
  usuario_id SMALLINT UNSIGNED NULL,
  intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  plantilla_uso VARCHAR(40) NOT NULL DEFAULT 'como_quedamos',
  resultado VARCHAR(160) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY seg_pendientes (estado, programado_para),
  KEY seg_paciente (paciente_id, estado),
  CONSTRAINT seg_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE CASCADE,
  CONSTRAINT seg_conv_fk FOREIGN KEY (conversacion_id) REFERENCES conversaciones (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ofertas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  tipo ENUM('plazos','bono','alternativa','promocion','descuento','valoracion','regalo') NOT NULL,
  texto_paciente VARCHAR(400) NOT NULL,
  familias JSON NULL,
  tratamientos JSON NULL,
  importe_min DECIMAL(10,2) NULL,
  importe_max DECIMAL(10,2) NULL,
  max_por_paciente TINYINT UNSIGNED NULL,
  requiere_aprobacion BOOLEAN NOT NULL DEFAULT FALSE,
  permitida_producto_sanitario BOOLEAN NOT NULL DEFAULT FALSE,
  prioridad SMALLINT NOT NULL DEFAULT 0,
  vigente_desde DATE NULL,
  vigente_hasta DATE NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  aprobada_por VARCHAR(120) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ofertas_hechas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  oferta_id INT UNSIGNED NOT NULL,
  paciente_id INT UNSIGNED NULL,
  lead_id INT UNSIGNED NULL,
  conversacion_id INT UNSIGNED NULL,
  presupuesto_id INT UNSIGNED NULL,
  estado ENUM('pendiente_aprobacion','propuesta','aceptada','rechazada','caducada','denegada') NOT NULL DEFAULT 'propuesta',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY oh_paciente (paciente_id, creado_en),
  CONSTRAINT oh_oferta_fk FOREIGN KEY (oferta_id) REFERENCES ofertas (id),
  CONSTRAINT oh_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plantillas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(512) NOT NULL,
  uso VARCHAR(40) NOT NULL,
  categoria ENUM('utilidad','marketing','autenticacion') NOT NULL,
  categoria_meta VARCHAR(20) NULL,
  idioma VARCHAR(10) NOT NULL DEFAULT 'es',
  cabecera JSON NULL,
  cuerpo TEXT NOT NULL,
  pie VARCHAR(60) NULL,
  botones JSON NULL,
  ejemplos JSON NULL,
  estado ENUM('borrador','en_revision','aprobada','rechazada','pausada','desactivada') NOT NULL DEFAULT 'borrador',
  motivo_rechazo VARCHAR(255) NULL,
  calidad ENUM('verde','amarilla','roja','pendiente') NOT NULL DEFAULT 'pendiente',
  meta_id VARCHAR(60) NULL,
  version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  reserva_de_id INT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY plantilla_nombre (nombre, idioma),
  KEY plantilla_uso (uso, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tareas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('llamar','atender_conversacion','aprobar_oferta','aprobar_respuesta','revisar_ia','otro') NOT NULL,
  titulo VARCHAR(200) NOT NULL,
  paciente_id INT UNSIGNED NULL,
  conversacion_id INT UNSIGNED NULL,
  responsable_id SMALLINT UNSIGNED NULL,
  urgente BOOLEAN NOT NULL DEFAULT FALSE,
  vence_en DATETIME NOT NULL,
  estado ENUM('abierta','hecha','cancelada') NOT NULL DEFAULT 'abierta',
  resultado VARCHAR(255) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hecha_en DATETIME NULL,
  KEY tarea_abierta (estado, vence_en),
  CONSTRAINT tarea_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id) ON DELETE CASCADE,
  CONSTRAINT tarea_conv_fk FOREIGN KEY (conversacion_id) REFERENCES conversaciones (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
