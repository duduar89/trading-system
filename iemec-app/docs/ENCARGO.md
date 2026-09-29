# Encargo: la app de IEMEC

IEMEC (Instituto Europeo de Medicina Estética y Capilar, Boadilla del Monte). Encargo de Eduardo
del 29-sep-2026. Este fichero es el encargo completo; `PROGRESO.md` dice por dónde vamos.

## Lo que se pidió (para que no se olvide nada)

1. **Una versión de la propuesta para enseñársela a la clínica**, que se vea como la clínica: su
   web y, sobre todo, su marca. Por dentro la clínica es **terciopelo, glamour y elegancia**.
2. **Trabajar en loop, por fases, con pruebas en cada fase**, y crear la base de datos de la
   clínica sobre la marcha.
3. **Investigar los tratamientos** de la clínica y cargarlos en la base de datos.
4. **Pruebas de calendario** (agenda, cabinas, comidas…).
5. **Al paciente le llega su cita y la puede añadir a su calendario** con un toque.
6. Que se pueda **llevar al portátil** y **subir con GitHub Actions a cPanel**.
7. **Que la interfaz y la app desmonten lo que tiene hoy** (Flowww, eternis, GHL y el WhatsApp
   del móvil).
8. **El motor de repesca** (leads, cancelaciones y, sobre todo, presupuestos) tiene que ser **lo
   más potente de la app**.
9. **Motor de reseñas + Google Business Profile**, igual de potente.
10. **Informe del estado actual**: qué busca la gente, dónde aparece la clínica y qué APIs harían
    falta para tener datos reales (Eduardo las proporciona).
11. **Sin facturación**: queda fuera. El objetivo es que la clínica esté mejor gestionada y
    organizada que hoy, con creces.
12. Todo lo ya acordado en las propuestas anteriores (tabla de dolores, IA de excusas, plantillas,
    panel de conversaciones, legal, stack v3).

## Reglas del loop

- **Cada vuelta:** leer `PROGRESO.md` → hacer la siguiente fase o subfase → pasar sus pruebas →
  actualizar `PROGRESO.md` → commit y push a la rama `claude/aesthetic-clinic-integration-review-s8ipmf`.
- **Una fase no se cierra sin sus pruebas en verde** (`npm test` y las propias de la fase).
- **El repositorio es público.** Nunca entran credenciales, datos de pacientes, conversaciones
  reales ni los informes comerciales para la clínica (esos se entregan a Eduardo como ficheros).
  Solo código y datos públicos de la web de la clínica.
- **Toda integración externa va detrás de un adaptador con modo simulado** (WhatsApp, Claude,
  Google, Meta, GHL, correo). Así todo se prueba sin claves y el modo real se enciende con `.env`.
- **Puertas ⛔:** si algo necesita una decisión de Eduardo o de la clínica, se deja preparado con
  el valor recomendado, se apunta en `PROGRESO.md` y se sigue con lo que no dependa de ello.
- **Todo en español:** código, tablas, columnas, textos y documentación.
- **Nada de temporizadores dentro de la app:** tareas por cron cada minuto + cola en MariaDB con
  `SKIP LOCKED` y candados, como CIFRA.

## Stack (decidido en la versión 3)

| Pieza | Elección |
|---|---|
| Hosting | LucusHost cPanel, cuenta propia de la clínica (Madrid). Plan B: VPS gestionado de LucusHost |
| Servidor | Node 22 + Express 5 + mysql2, CommonJS (como CIFRA y El Método) |
| Base de datos | MariaDB ≥ 10.6, una base por clínica. Migraciones SQL numeradas |
| Delante | React + Vite + Tailwind, PWA (tablet de recepción y móviles) |
| Tareas | Cron de cPanel cada minuto + cola en MariaDB (`SKIP LOCKED`) + candados |
| IA | SDK de Claude por un endpoint de la UE (Bedrock UE o Vertex «eu»), con modo simulado |
| WhatsApp | Proveedor con coexistencia (360dialog) o Cloud API directa, detrás de un adaptador |
| Pruebas | `node --test` + casos conocidos (`scripts/probar-*.js`) + Playwright para el panel |
| Publicar | GitHub Actions: comprobar en cada push y desplegar a mano (probar / subir), como CIFRA |

## Fases y criterios de salida

| Fase | Qué | Sale cuando |
|---|---|---|
| **F0** | Investigación (marca, tratamientos, búsqueda local, SEO, calendario, Google) y propuesta para la clínica con su estética | Catálogo consolidado con fuentes; informe de búsqueda local; propuesta HTML entregada a Eduardo |
| **F1** | Esqueleto, base de datos y semillas | Migraciones aplican en una MariaDB limpia y son idempotentes; semillas cargan el catálogo; `/api/version`; `npm test` y CI en verde |
| **F2** | Motor de agenda y cita al paciente | Huecos correctos con salas, equipos, profesionales, comidas fijas y flotantes, holguras, festivos y cambio de hora; reserva sin dobles bajo concurrencia; `.ics` (alta, cambio, cancelación) y enlaces Google/Outlook/Apple; página «Tu cita»; batería de casos de calendario en verde |
| **F3** | Motor de repesca | Secuencias que se paran al responder; seguimientos con fecha calculada por el código; catálogo de ofertas con límites legales; IA de excusas con herramientas de esquema cerrado; módulo de plantillas con estados, reserva y filtro legal; cola con `SKIP LOCKED`; batería de ≥ 100 frases: fechas y bajas sin fallo |
| **F4** | Motor de reseñas + Google Business Profile | Petición tras cada cita, a todos; detección de reseña nueva; borradores de respuesta con aprobación; temas y sentimiento; métricas de la ficha; adaptadores GBP / Places / DataForSEO simulados; informe de búsqueda local |
| **F5** | Panel | Agenda por cabina, bandeja IA/persona, seguimientos, plantillas, repesca con embudos y euros, reseñas; estética terciopelo; PWA; pruebas de flujo con Playwright |
| **F6** | Despliegue | Workflows de comprobar y desplegar (probar/subir) a cPanel; arranque en el portátil; guía de secretos; copia y restauración probadas |

## Lo que tiene que desmontar

| Hoy | Lo que hace la app |
|---|---|
| Flowww: franjas de 15 min, sin tiempos de limpieza, comidas con bloqueos que caducan, API antigua sin avisos | Franjas de 5 min, holguras por tratamiento, comida fija o flotante garantizada, equipos compartidos, una sola agenda para IA y recepción |
| eternis: secuencias fijas, IA que olvida lo que dice el paciente, flujos dentales | Lo que dice el paciente manda; seguimientos con fecha; ofertas del catálogo; próximo paso siempre |
| GHL: el lead se pierde entre herramientas | Recorrido del lead de punta a punta, del anuncio a la cita y al euro |
| WhatsApp en el móvil | Bandeja única con IA y personas, ventana de 24 h, plantillas y estados |
| Reseñas sin cruzar con citas | Petición tras cada cita, respuestas aprobadas y métricas de la ficha |
