# PROGRESO — app de IEMEC

**Estado:** todas las fases con su núcleo hecho y probado en demostración; entran de verdad
WhatsApp y los leads; el personal entra con passkeys; la cita llega al paciente sin decir el
tratamiento; reseñas con las normas de Google y adaptadores reales de Google y DataForSEO; el importador
de Flowww espera su primera exportación. **La web nueva está hecha y revisada** (95 páginas, con el
formulario conectado a la app): se publica cuando la clínica complete lo pendiente (⛔ 12). Falta conectar las cuentas reales (envío de WhatsApp, Google, IA)
y los datos de la clínica, que esperan las puertas ⛔.
**Última actualización:** 30-sep-2026 · **968 pruebas en verde** · ESLint limpio

El encargo completo está en [`docs/ENCARGO.md`](docs/ENCARGO.md). Este fichero dice dónde estamos:
se lee al empezar cada vuelta del loop y se actualiza al terminarla.

## Fases

| Fase | Estado | Hecho | Falta |
|---|---|---|---|
| F0 · Investigación y propuesta | hecha | Catálogo consolidado (172 entradas con fuentes), directorios, Google, posiciones en Maps desde 7 puntos, SEO de la web, calendario. **Entregados a Eduardo, fuera del repo:** propuesta para la clínica (HTML + PDF con la estética de la marca) e informe de búsqueda local y APIs (HTML + PDF, verificado) | — |
| F1 · Esqueleto y base de datos | hecha | Migraciones 001-009, 013 y 014, semillas con el **catálogo consolidado** (`scripts/importar-catalogo.js`, repetible): 172 tratamientos (157 se reservan, 67 los reserva la IA, 71 con publicidad restringida), 26 aparatos, 351 preguntas sin aprobar, cada tratamiento con su sala | Salas, aparatos y profesionales reales (⛔ 2) |
| F2 · Agenda y cita | hecha | Huecos por sala, profesional y aparato; «Tu cita» y `.ics` **privados** («Cita en IEMEC», token solo como huella y cifrado, sedes, **/cal/ abre el calendario de cada móvil de un toque**, WhatsApp sin nombrar el tratamiento); el paciente elige hueco por WhatsApp; avisos de confirmación, víspera y 2 horas; **estados** (ha llegado, completada, no vino, deshacer); **cambiar y cancelar la cita por WhatsApp**; **lista de espera** que ofrece los huecos liberados con retención; **importador de Flowww** (pacientes y citas futuras, ensayo sin datos personales y deshacer) | Primer ensayo con la exportación real de Flowww (⛔ 8); las plantillas de cita nuevas, aprobadas en Meta (⛔ 5) |
| F3 · Repesca | hecha | Excusas (130 frases), seguimientos con fecha, ofertas con límites legales, plantillas con reserva, IA real con respaldo; **webhook de WhatsApp** (firma, estados de entrega, audios y fotos a una persona, anuncios que abren WhatsApp → lead), **leads de Meta Lead Ads, de la web y de GHL** (`POST /api/leads`), bajas por teléfono, pantalla de tareas; **intenciones «más información», «reservar una valoración» y urgencias de salud**, tratamiento de interés recordado, recuperar la cita cancelada por WhatsApp | Envío real de WhatsApp (⛔ 5); medios (audio, foto); el primer WhatsApp desde la web nueva como lead (vuelta 9) |
| F4 · Reseñas + Google | hecha | Petición a todos tras **completar** la cita (sin filtrar por queja), enlace corto, un recordatorio, temas, respuestas con aprobación, **texto y autor borrados a los 29 días**, **alerta clínica para dirección médica**, historial poco a poco, ideas de publicación; **adaptadores reales** de Business Profile (reseñas, respuestas, métricas, avisos por Pub/Sub), Places y **posiciones en Maps con DataForSEO** (malla y tope de gasto) | Accesos de Google y cuenta de DataForSEO (⛔ 6, pasos en docs/GOOGLE.md) |
| F5 · Panel | hecha | Hoy, agenda con detalle de cita y estados, bandeja con estado de entrega, seguimientos, repesca, plantillas, reseñas, tareas, lista de espera, salas × tratamientos; PWA; fuentes propias; **entrada con passkeys**, roles y permisos por ruta, pantalla «Equipo»; **pruebas de flujo con Playwright** (15 flujos; contraste AA, foco y 390 px en cada pantalla) | Enlazar cada persona con su profesional («mis citas»); marcar en la agenda las citas importadas para revisar |
| F6 · Despliegue | hecha | Workflows comprobar y desplegar, copia previa, recuperación de `node_modules`, comprobación del commit, copias cifradas | Workflow en la rama por defecto; secretos reales; primera alta de dirección con `npm run invitar` y quitar PANEL_CLAVE cuando todos tengan passkey |
| F7 · Web nueva | hecha | `web/`: generador estático con la estética terciopelo, 95 páginas (7 especialidades, 76 tratamientos que cubren 116 del catálogo; 41 sin página con su motivo, 10 borradores pendientes de autorización), buscador por preocupación, WhatsApp con referencia opaca en lo íntimo, formulario «Te llamamos» → `POST /web/contacto` de la app (migración 015), el primer WhatsApp de la web da de alta el lead, 177 URLs viejas con 301, sin cookies ni terceros, normas de publicidad sanitaria comprobadas en todo lo visible; entrega a Eduardo (zip, capturas y PDF de recorrido) | Lo que confirme la clínica (⛔ 12) y los accesos para subirla |

## Pruebas

`npm test` con MariaDB local (10.11): **968 pruebas en verde**. Lo más importante:

- **Agenda:** hora de Madrid, limpiezas, crema anestésica, comidas, aparatos, festivos, diez reservas
  a la vez → una; horas redondas.
- **Cita al paciente:** elige hueco y le llega su cita; hueco ocupado; «ninguno me viene bien»;
  «¿y el jueves a las 12?»; «gracias», «confirmo»; **«necesito cambiarla» → huecos nuevos y la
  antigua reprogramada con su `.ics` anulado**; **cancelar con confirmación**; avisos a su hora.
- **Estados de la cita:** transiciones por hora, deshacer (30 min), reseña a fin + 2 h, cliente,
  lead «asistió», «toca repetir», no presentado → recuperación.
- **Lista de espera:** oferta al primero que encaja, sí → confirmada, no o caducada → siguiente, un
  hueco nunca a dos.
- **WhatsApp y leads:** firma, duplicados, texto/botón/interactivo/audio, anuncio → lead, estados de
  entrega, Lead Ads → lead + secuencia, `/api/leads` con clave, bajas por teléfono, orden por
  teléfono con dos cron.
- **Repesca:** 130 frases (fechas y bajas sin fallo) y 55 de elección de hueco.
- **Catálogo:** importador determinista, recuentos, todo lo reservable con sala, restringidos.
- **Acceso:** passkeys con un autenticador simulado (contador, credencial ajena, retos caducados o
  repetidos, enlaces usados), permisos por rol en todas las rutas, CSRF, límites por IP y de punta a
  punta con el autenticador virtual de Chromium.
- **Flowww:** CSV de verdad (separador, codificación, BOM), ensayo sin datos personales, aplicar y
  deshacer, citas que desaparecen o se mueven, el «no» a la publicidad que siempre gana.
- **Calendario:** el `.ics` leído con ical.js como lo lee un calendario (hora de Madrid, privado,
  avisos, anulación), enlaces de Google y Outlook, /cal/ con 12 navegadores y cada estado de «Tu cita».
- **Reseñas:** a todos sin filtrar, el borrado a los 29 días, la alerta clínica y quién la contesta,
  el historial por turnos y lo que hace Google al rechazar una respuesta.
- **Google y DataForSEO:** los adaptadores con respuestas grabadas (sin red): OAuth, reseñas, avisos
  firmados de Pub/Sub, Places, malla de posiciones y el tope de gasto.
- **Web:** el generador (determinista), las normas de publicidad sanitaria en todo lo que se ve (texto,
  alt, URL, WhatsApp, datos estructurados), enlaces, redirecciones y anclas viejas, y 95 páginas × 8
  anchos sin desbordes (`node web/revisar.mjs`). El formulario: 303 y JSON, validación, trampa, límites,
  origen y CORS; nada sale sin verificar el teléfono, la casilla comercial manda y los datos se borran
  en plazo (19 ataques y fallos de la revisión reproducidos antes de arreglarlos).
- **Panel en un navegador:** 15 flujos con la demo a una hora fija; en cada pantalla, contraste AA en
  claro y oscuro, nombres accesibles, foco visible y nada que desborde a 390 px.

## Puertas ⛔ (no bloquean: se sigue con el valor recomendado)

1. **Repositorio privado.** `trading-system` es público: mover `iemec-app/` a un repo privado
   antes de meter secretos (y el workflow de desplegar tiene que estar en la rama por defecto).
2. **Salas, aparatos, equipo y horarios reales**, qué tratamiento va en cada sala
   (`plantilla-salas.csv`) y quién hace cada tratamiento; si hay sala de procedimientos; alta de
   enfermería (el IPL pasaría a ese rol).
3. **Horario del sábado:** Google 11-20, Treatwell 10-20.
4. **Calendario laboral 2027** de Madrid y Boadilla: cuando salga en el BOCM.
5. **WhatsApp:** dónde está hoy el 722 83 32 85, proveedor (coexistencia) y si 360dialog admite la
   cabecera `X-Clave`; plantillas nuevas o cambiadas que hay que aprobar en Meta
   (`iemec_no_vino_nuevo_hueco`, `iemec_toca_repetir`, `hueco_liberado`; las de la cita con mapa y
   botones: `iemec_cita_confirmada`, `iemec_cita_cambiada`, `iemec_recordatorio_24h`,
   `iemec_recordatorio_2h`, `iemec_cita_cancelada`; `iemec_opinion_visita` e
   `iemec_opinion_recordatorio`; y `iemec_solicitud_web`, la de «¿fuiste tú?» del formulario de la web).
6. **Google:** acceso de gestor a la ficha, formulario de acceso a la API (Google contesta en unos
   14 días), OAuth en producción, Pub/Sub y clave de Places (pasos en `docs/GOOGLE.md`); cuenta de
   DataForSEO (50 $ de saldo, tope de 3 $ al mes); Search Console y Analytics a través de Uebea.
7. **Ofertas permitidas**, **20-30 conversaciones reales**, **respuestas del equipo médico**
   (25 preguntas del catálogo esperan validación) y **plantillas de hoy**.
8. **Exportación de Flowww** para el primer ensayo (con código de cita y de cliente), fecha de
   renovación y contrato de eternis.
9. **Revisión del abogado sanitario y del delegado de protección de datos** antes de activar nada:
   excepción LSSI 21.2 para clientes (¿cuentan como clientes los pacientes que vienen de Flowww?),
   consentimiento comercial (el formulario de la web ya lo recoge con su prueba; un «no vino» sin
   consentimiento acaba en una tarea de llamar), si la regla «sin la casilla, solo el seguimiento de su
   solicitud» se extiende a los leads de Meta, GHL y recepción (hoy solo a los de la web), textos de
   plantillas.
10. **Facturación:** fuera de la app; decidir cómo pasa la cita a la facturación.
11. **Lista de espera:** los valores son recomendaciones (retención 30 min, antelación 2 h, envíos de
    9:00 a 21:00, dos ofertas sin contestar y sale de la lista).
12. **Web nueva (antes de publicarla):** todo en [`docs/LANZAR-WEB.md`](docs/LANZAR-WEB.md), y para la
    clínica un PDF «Lo que necesitamos». Diez imprescindibles: correo con el dominio (hoy no tiene
    correo), delegado de protección de datos, quién opera cada cirugía y dónde, 37 preguntas en 33
    páginas (si se ofrece y con qué producto), quién hace el diagnóstico capilar, título y n.º de
    colegiado de quien se nombra, qué cubre la U.900, lo íntimo dentro de la autorización, y los
    vistos buenos del médico responsable y del abogado sanitario y el DPD. De Uebea: el registro A
    del dominio (Namecheap), el correo del dominio y el subdominio agenda. Ya resuelto con fuentes
    oficiales: Registro Mercantil y domicilio social (BORME), la puerta 35-36 del registro de centros
    y el emblema oficial del FSE+. `node web/construir.js --publicar` no deja publicar sin los diez;
    se puede lanzar sin las páginas que tarden (p. ej., sin cirugía).

## Registro de vueltas

- **29-sep · vuelta 1.** Encargo, reglas y fases. Esqueleto, migraciones 001-002, motores de hora,
  huecos y día; reserva con bloqueo; `.ics`. Investigación de la F0 lanzada.
- **29-sep · vueltas 2-6.** Repesca, reseñas, semillas, panel con la estética de la clínica, rutas
  públicas, cron con cola y candados, demo, despliegue probado, copias cifradas. Cada tratamiento
  con su sala.
- **30-sep · vuelta 7.** El paciente elige hueco por WhatsApp y le llega su cita; avisos de cita;
  horas redondas; fuentes propias. Propuesta para la clínica entregada.
- **30-sep · vuelta 8a (en paralelo, con revisión adversaria).** Cuatro piezas construidas cada una
  en su worktree, revisadas por dos agentes (corrección; seguridad, legal e integración) y
  arregladas: 73 hallazgos, 74 arreglados.
  - **Catálogo consolidado** en lugar del provisional, con importador repetible (migración 006).
  - **WhatsApp y leads entrantes** (migración 007): webhooks firmados, leads de Meta, web y GHL.
  - **Estados de la cita** (migración 008): reseña, cliente, «toca repetir» y recuperación; lo
    íntimo nunca se nombra en los mensajes.
  - **Cambiar la cita por WhatsApp y lista de espera** (migración 009).
  - Informe de búsqueda local y APIs entregado a Eduardo. El modelo de IA pasa a configuración.
- **30-sep · vuelta 8b (en paralelo, con revisión adversaria).** Tres piezas, cada una revisada por
  dos agentes y arreglada.
  - **Acceso con passkeys** (migración 013): alta por invitación de un solo uso, varias passkeys por
    persona, sesión comprobada en la base (desactivar a alguien le corta al momento), permisos por rol
    en cada ruta, CSRF, cabeceras y límite de intentos. PANEL_CLAVE queda como acceso de emergencia de
    dirección.
  - **Importador de Flowww** (migración 014): pacientes y citas futuras desde sus CSV, ensayo sin
    datos personales, aplicar en una transacción y deshacer. Lo importado no pide confirmación pero sí
    lleva recordatorios; lo que en Flowww se anula o se mueve no se toca solo: queda con su tarea.
  - **Pruebas de flujo del panel** con Playwright. Encontraron que desde la bandeja no se podía
    escribir, plantillas con variables sin rellenar y contrastes por debajo de AA. Ahora la bandeja no
    manda nada comercial a quien pidió la baja o no dio su consentimiento.
  - Cuadro «Qué tenéis, qué necesitáis y dónde falla hoy» entregado a Eduardo (PDF). Empieza la web
    nueva (vuelta 9).
- **30-sep · vuelta 8c (en paralelo, con revisión adversaria).** Cuatro piezas, cada una revisada
  por dos agentes y arreglada (las cortó el límite de uso a mitad del arreglo y siguieron desde sus
  commits).
  - **Privacidad de la cita** (migración 010): `.ics` «Cita en IEMEC» privado y con UID estable,
    token solo como huella y cifrado, sedes, /cal/ que abre el calendario de cada dispositivo y
    «Tu cita» según su estado. El WhatsApp dice día, hora y sede, nunca el tratamiento.
  - **Reseñas con las normas de Google** (migración 011): a todos, texto y autor fuera a los 29 días,
    alerta clínica para dirección médica (de la tabla de permisos: dirección o médico), un
    recordatorio y el historial poco a poco.
  - **Google y DataForSEO reales** (migración 012), detrás del modo simulado; guía en docs/GOOGLE.md.
  - **Repesca**: intenciones nuevas, tratamiento de interés, recuperar la cita cancelada por WhatsApp
    y privacidad en todo lo que se manda.
  - La prueba del foco de la e2e ya no se equivoca con la máquina cargada.
- **30-sep · vuelta 9 · la web nueva.** Inventario de iemec-clinic.com (154 servicios, 177 URLs, fotos
  propias), normas de publicidad sanitaria con fuentes oficiales (la autorización CS17886 no cubre
  ginecología, varices, endocrinología y nutrición ni dermatología: eso queda en borrador), textos de
  los 157 tratamientos por cinco redactores, diseño y generador estático, revisión legal y de móvil (48
  hallazgos, todos arreglados) y la app que recibe el formulario y el primer WhatsApp de la web. Entregado
  a Eduardo: zip listo para subir, capturas y un PDF de recorrido para la clínica. Los agentes se
  cortaron por el límite de uso y un reinicio del contenedor a mitad y siguieron desde donde estaban.
- **30-sep · vuelta 9b · el formulario de la web, revisado.** Dos revisores (seguridad; privacidad,
  LSSI e integración) encontraron 19 fallos, entre ellos que un formulario anónimo podía hacer que la
  clínica escribiera a cualquier número con el nombre y el tratamiento que pusiera otro, o mezclar sus
  datos con la ficha de una paciente. Ahora el lead de la web nace sin verificar (migración 017): quien
  pide WhatsApp recibe un «¿fuiste tú?» neutro y solo con su «sí» sigue; la casilla comercial manda y
  pasa a la ficha con su prueba; lo pedido va cifrado; topes por IP, por teléfono y global; borrado en
  plazo. Se deja escrito qué hace falta para lanzar la web (docs/LANZAR-WEB.md, en marcha).
- **30-sep · vuelta 9c · lista para lanzar.** La web no se puede subir desde aquí (no hay acceso al
  hosting ni al DNS, que lleva Uebea) ni se publica en otro sitio: queda lista para subirla en un paso.
  Lo pendiente se clasifica (imprescindible, se oculta con una frase cierta o se completa con fuentes
  oficiales) y `--publicar` hace la versión para subir. Una revisión legal encontró 13 fallos (entre
  ellos, que las dudas de los redactores no las controlaba nada), todos arreglados. Entregado: docs/
  LANZAR-WEB.md y el PDF para la clínica.
- **30-sep · passkeys: una carrera arreglada.** Si dirección desactivaba a alguien justo mientras
  completaba su alta, el alta decía «esa respuesta ya se ha usado» en vez de «enlace anulado» (la
  prueba de concurrencia lo pillaba a veces con la máquina cargada). Ahora dice lo que ha pasado;
  test/acceso-carrera.test.js fuerza ese orden cada vez.
