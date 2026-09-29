# PROGRESO — app de IEMEC

**Estado:** F0 en marcha (investigación) · F1 y F2 adelantadas mientras tanto
**Última actualización:** 29-sep-2026

El encargo completo está en [`docs/ENCARGO.md`](docs/ENCARGO.md). Este fichero dice dónde estamos:
se lee al empezar cada vuelta del loop y se actualiza al terminarla.

## Fases

| Fase | Estado | Notas |
|---|---|---|
| F0 · Investigación y propuesta | en marcha | Catálogo, directorios, marca, SEO, búsqueda local, calendario y Google, con verificación. Los informes comerciales se entregan a Eduardo como ficheros, no se suben (repo público) |
| F1 · Esqueleto y base de datos | en marcha | Servidor, configuración, migraciones idempotentes, `/api/version` y `/api/salud` hechos. Faltan las semillas del catálogo (esperan a F0) y el CI |
| F2 · Agenda y cita | adelantada | Motor de huecos, día desde la base, reserva sin dobles, retención, cancelación y `.ics` + enlaces hechos. Falta la página «Tu cita» y las rutas |
| F3 · Repesca | pendiente | |
| F4 · Reseñas + Google | pendiente | |
| F5 · Panel | pendiente | |
| F6 · Despliegue | pendiente | |

## Pruebas

`npm test` con MariaDB local (10.11): 49 pruebas en verde.

- Hora de Madrid: verano, invierno, el retraso del 25-oct-2026 y el adelanto del 29-mar-2026.
- Huecos: limpieza de sala, crema anestésica que ocupa sala y no médico, comida fija, comida
  flotante garantizada, ausencias, aparato fijo en una cabina, aparato móvil con dos unidades,
  jornada partida, antelación mínima, agenda compacta y propuesta de tres huecos repartidos.
- Días reales: el 5-oct-2026 es fiesta local en Boadilla (Virgen del Rosario) y la clínica no
  abre; el domingo no abre; el sábado abre a las 10:00; citas del lunes después del cambio de hora.
- Base de datos: diez reservas simultáneas del mismo hueco → entra una; retención que caduca y
  libera el hueco; cancelación que sube la versión del `.ics`; registro de hechos.
- `.ics`: CRLF, plegado a 75 octetos sin romper tildes, escapes, UID estable, SEQUENCE, anulación.

## Puertas ⛔ (no bloquean: se sigue con el valor recomendado)

1. **Repositorio privado.** `trading-system` es público. Recomendado mover `iemec-app/` a un repo
   privado antes de meter secretos de despliegue (se hace en un minuto con `git subtree split`).
2. **Salas, aparatos y equipo reales de la clínica.** Se cargan los inferidos de la web marcados
   como «sin confirmar» hasta tener la lista de la clínica.
3. **Calendario laboral 2027** de la Comunidad de Madrid y de Boadilla: se carga cuando salga en
   el BOCM.

## Registro de vueltas

- **29-sep · vuelta 1.** Encargo, reglas y fases escritas. MariaDB local. Esqueleto (config,
  conexión en UTC, migraciones con huella, servidor con versión y salud). Migraciones 001 (base) y
  002 (agenda). Motor de hora de Madrid, de huecos y del día; reserva con bloqueo de recursos;
  `.ics` y enlaces de calendario. Investigación de la F0 lanzada en segundo plano.
