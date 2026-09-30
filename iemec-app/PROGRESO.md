# PROGRESO — app de IEMEC

**Estado:** todas las fases con su núcleo hecho y probado en demostración; entran de verdad
WhatsApp y los leads; el personal entra con passkeys y el importador de Flowww espera su primera
exportación. En marcha, la web nueva. Falta conectar las cuentas reales (envío de WhatsApp, Google, IA)
y los datos de la clínica, que esperan las puertas ⛔.
**Última actualización:** 30-sep-2026 · **591 pruebas en verde** · ESLint limpio

El encargo completo está en [`docs/ENCARGO.md`](docs/ENCARGO.md). Este fichero dice dónde estamos:
se lee al empezar cada vuelta del loop y se actualiza al terminarla.

## Fases

| Fase | Estado | Hecho | Falta |
|---|---|---|---|
| F0 · Investigación y propuesta | hecha | Catálogo consolidado (172 entradas con fuentes), directorios, Google, posiciones en Maps desde 7 puntos, SEO de la web, calendario. **Entregados a Eduardo, fuera del repo:** propuesta para la clínica (HTML + PDF con la estética de la marca) e informe de búsqueda local y APIs (HTML + PDF, verificado) | — |
| F1 · Esqueleto y base de datos | hecha | Migraciones 001-009, 013 y 014, semillas con el **catálogo consolidado** (`scripts/importar-catalogo.js`, repetible): 172 tratamientos (157 se reservan, 67 los reserva la IA, 71 con publicidad restringida), 26 aparatos, 351 preguntas sin aprobar, cada tratamiento con su sala | Salas, aparatos y profesionales reales (⛔ 2) |
| F2 · Agenda y cita | hecha | Huecos por sala, profesional y aparato; «Tu cita» y `.ics`; el paciente elige hueco por WhatsApp; avisos de confirmación, víspera y 2 horas; **estados** (ha llegado, completada, no vino, deshacer); **cambiar y cancelar la cita por WhatsApp**; **lista de espera** que ofrece los huecos liberados con retención; **importador de Flowww** (pacientes y citas futuras, ensayo sin datos personales y deshacer) | Privacidad de la cita (vuelta 8c); primer ensayo con la exportación real de Flowww (⛔ 8) |
| F3 · Repesca | hecha | Excusas (130 frases), seguimientos con fecha, ofertas con límites legales, plantillas con reserva, IA real con respaldo; **webhook de WhatsApp** (firma, estados de entrega, audios y fotos a una persona, anuncios que abren WhatsApp → lead), **leads de Meta Lead Ads, de la web y de GHL** (`POST /api/leads`), bajas por teléfono, pantalla de tareas | Envío real de WhatsApp (⛔ 5); medios (audio, foto); intenciones «más información» y «reservar una valoración» (vuelta 8c) |
| F4 · Reseñas + Google | en marcha | Petición a todos tras **completar** la cita, enlace corto, temas, respuestas con aprobación, ideas de publicación | Normas de Google (sin exclusión por queja, 30 días de texto, alerta clínica, recordatorio) y adaptadores reales (vuelta 8c) |
| F5 · Panel | hecha | Hoy, agenda con detalle de cita y estados, bandeja con estado de entrega, seguimientos, repesca, plantillas, reseñas, tareas, lista de espera, salas × tratamientos; PWA; fuentes propias; **entrada con passkeys**, roles y permisos por ruta, pantalla «Equipo»; **pruebas de flujo con Playwright** (15 flujos; contraste AA, foco y 390 px en cada pantalla) | Enlazar cada persona con su profesional («mis citas»); marcar en la agenda las citas importadas para revisar |
| F6 · Despliegue | hecha | Workflows comprobar y desplegar, copia previa, recuperación de `node_modules`, comprobación del commit, copias cifradas | Workflow en la rama por defecto; secretos reales; primera alta de dirección con `npm run invitar` y quitar PANEL_CLAVE cuando todos tengan passkey |
| F7 · Web nueva | en marcha | Vuelta 9: inventario de iemec-clinic.com, normas de publicidad sanitaria, textos de los 157 tratamientos, diseño terciopelo y generador estático | Integrar, revisar (legal y móvil) y el formulario conectado a la app |

## Pruebas

`npm test` con MariaDB local (10.11): **591 pruebas en verde**. Lo más importante:

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
   (`iemec_no_vino_nuevo_hueco`, `iemec_toca_repetir`, `iemec_opinion_visita`, `hueco_liberado`).
6. **Acceso de gestor** a la ficha de Google; Search Console y Analytics a través de Uebea.
7. **Ofertas permitidas**, **20-30 conversaciones reales**, **respuestas del equipo médico**
   (25 preguntas del catálogo esperan validación) y **plantillas de hoy**.
8. **Exportación de Flowww** para el primer ensayo (con código de cita y de cliente), fecha de
   renovación y contrato de eternis.
9. **Revisión del abogado sanitario y del delegado de protección de datos** antes de activar nada:
   excepción LSSI 21.2 para clientes (¿cuentan como clientes los pacientes que vienen de Flowww?),
   consentimiento comercial (hoy no se recoge en ningún sitio: un
   «no vino» sin consentimiento acaba en una tarea de llamar), textos de plantillas.
10. **Facturación:** fuera de la app; decidir cómo pasa la cita a la facturación.
11. **Lista de espera:** los valores son recomendaciones (retención 30 min, antelación 2 h, envíos de
    9:00 a 21:00, dos ofertas sin contestar y sale de la lista).

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
