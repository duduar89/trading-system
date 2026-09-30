# PROGRESO — app de IEMEC

**Estado:** todas las fases con su núcleo hecho y probado en demostración. Falta conectar las
cuentas reales (WhatsApp, Google, IA) y los datos de la clínica, que esperan las puertas ⛔.
**Última actualización:** 30-sep-2026 · **280 pruebas en verde** · ESLint limpio

El encargo completo está en [`docs/ENCARGO.md`](docs/ENCARGO.md). Este fichero dice dónde estamos:
se lee al empezar cada vuelta del loop y se actualiza al terminarla.

## Fases

| Fase | Estado | Hecho | Falta |
|---|---|---|---|
| F0 · Investigación y propuesta | casi | Directorios, Google, Treatwell, Multiestetica y Doctoralia; posiciones en Maps desde 7 puntos; competencia. **Propuesta para la clínica entregada a Eduardo** (HTML con la estética de la marca + PDF A4), fuera del repo | Catálogo consolidado e informes de SEO, búsqueda local, calendario y Google (en curso); informe de APIs para Eduardo |
| F1 · Esqueleto y base de datos | hecha | Servidor, migraciones 001-005 con huella, semillas (clínica, festivos 2026 de Madrid y Boadilla, 7 salas, 10 profesionales, 211 tratamientos provisionales con su sala, 11 aparatos, plantillas, ofertas), CI en GitHub Actions | Sustituir el catálogo provisional por el consolidado de la F0 |
| F2 · Agenda y cita | hecha | Huecos por sala, profesional y aparato; limpiezas, crema anestésica, comidas fijas y flotantes, festivos, cambio de hora; reserva sin dobles; `.ics` y página «Tu cita» (Google, Outlook, Apple, confirmar, cancelar); **el paciente elige hueco por WhatsApp y le llega su cita**; avisos de confirmación, víspera y 2 horas | Reprogramar la cita por WhatsApp sin pasar por una persona; lista de espera |
| F3 · Repesca | hecha | Intérprete de excusas (130 frases), política con próximo paso siempre, plazos calculados, catálogo de ofertas con límites legales, filtro de publicidad sanitaria, secuencias que se paran al contestar, seguimientos «como quedamos», plantillas con reserva, IA real (Claude por Vertex UE) con respaldo | Webhook de WhatsApp real; entrada de leads de Meta y GHL; batería contra la IA real |
| F4 · Reseñas + Google | hecha (simulada) | Petición a todos tras la cita, enlace corto, importación, temas y sentimiento, respuestas sin datos de salud con aprobación, ideas de publicación con código de origen | Programar la petición al completar la cita; API real de Business Profile (acceso de gestor) |
| F5 · Panel | hecha | Hoy, agenda por cabina y por profesional, bandeja con «Cita reservada», seguimientos, repesca, plantillas, reseñas, salas × tratamientos; PWA; modo oscuro; fuentes servidas desde la app | Passkeys (F5.2); pruebas de flujo con Playwright |
| F6 · Despliegue | hecha | Workflows comprobar y desplegar (probar/subir), script de despliegue con copia previa, recuperación de `node_modules` y comprobación del commit; copias cifradas y prueba de restauración; guía del portátil | Que el workflow esté en la rama por defecto; secretos reales |

## Pruebas

`npm test` con MariaDB local (10.11): **280 pruebas en verde**. Lo más importante:

- **Agenda:** hora de Madrid (cambios de hora de 2026), huecos con limpieza, crema anestésica,
  comidas fijas y flotantes, aparatos fijos y móviles, festivos de Boadilla, diez reservas
  simultáneas del mismo hueco → entra una, horas redondas al proponer.
- **Cita al paciente:** elige «la segunda» → reservada, confirmada con su enlace, lead a «cita» y
  ficha creada; «vale» con tres huecos → pregunta cuál; hueco ocupado mientras contesta → otros;
  «ninguno me viene bien» → otros más adelante; «¿y el jueves a las 12?» → se comprueba y se
  ofrece; tratamiento con valoración → tarea para recepción; «gracias», «confirmo» y «necesito
  cambiarla»; avisos de confirmación, víspera y 2 horas, una sola vez, de día y sin Treatwell.
- **Repesca:** batería de 130 frases (fechas y bajas sin fallo), «el mes que viene» con el lunes
  festivo, precio con oferta del catálogo, baja, salud urgente, dos cron a la vez sin dobles, la
  regresión de las bajas sin ficha.
- **Elección de hueco:** 55 frases («el martes a las 11», «la 1ª», «mejor el miércoles»,
  «ninguno, mejor el jueves»…).
- **Resto:** `.ics`, página «Tu cita», reseñas, cola, cron, semillas, migraciones.

## Puertas ⛔ (no bloquean: se sigue con el valor recomendado)

1. **Repositorio privado.** `trading-system` es público: mover `iemec-app/` a un repo privado
   antes de meter secretos (y el workflow de desplegar tiene que estar en la rama por defecto).
2. **Salas, aparatos, equipo, horarios** y qué tratamiento va en cada sala: hoy, borrador sacado
   de la web («sin confirmar»).
3. **Horario del sábado:** Google 11-20, Treatwell 10-20.
4. **Calendario laboral 2027** de Madrid y Boadilla: cuando salga en el BOCM.
5. **WhatsApp:** dónde está hoy el 722 83 32 85 y con qué proveedor (coexistencia).
6. **Acceso de gestor** a la ficha de Google; Search Console y Analytics a través de Uebea.
7. **Ofertas permitidas**, **20-30 conversaciones reales**, **respuestas del equipo médico** y
   **plantillas de hoy**.
8. **Copia de Flowww**, fecha de renovación y contrato de eternis.
9. **Revisión del abogado sanitario** antes de activar nada.
10. **Facturación:** fuera de la app; decidir cómo pasa la cita a la facturación (exportación o a
    mano).

## Registro de vueltas

- **29-sep · vuelta 1.** Encargo, reglas y fases. MariaDB local. Esqueleto, migraciones 001-002,
  motor de hora, de huecos y del día; reserva con bloqueo; `.ics`. Investigación de la F0 lanzada.
- **29-sep · vueltas 2-6.** Repesca (003), reseñas (004), semillas, panel con la estética de la
  clínica, rutas públicas, cron con cola y candados, demo, despliegue probado contra un servidor
  simulado por SSH, copias cifradas. Cada tratamiento con su sala concreta.
- **30-sep · vuelta 7.** El paciente elige hueco por WhatsApp y le llega su cita (005); avisos de
  cita; «último» ya no es una queja; horas redondas; fuentes servidas desde la app; saludo según la
  hora. **Propuesta para la clínica** (HTML + PDF) entregada a Eduardo.
