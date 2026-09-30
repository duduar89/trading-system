# Migrar de Flowww: pacientes y citas futuras

Para apagar Flowww sin perder nada, la app trae de sus exportaciones los **pacientes** y las **citas
futuras**. La **facturación no se trae**: se queda en Flowww (y en la gestoría), como el resto de lo
que la app no hace (historia clínica, bonos, cobros).

```
Flowww ──exporta──▶ pacientes.csv + citas.csv
                         │
node scripts/importar-flowww.js --pacientes … --citas … [--mapa mapa.json]
                         │
     ensayo (sin --aplicar): no cambia nada; informe con lo que haría y lo que falta decidir
     aplicar (--aplicar):    todo en una transacción; entra todo o nada
     deshacer (--deshacer):  quita lo que metió y nadie ha tocado
```

Resumen de lo que hace:

- **Pacientes** sin duplicar: por su código de Flowww, por su teléfono o por su email, siempre que el
  nombre cuadre. A quien ya estaba en la app (le escribió por WhatsApp, lo dio de alta recepción) no se
  le cambia nada: solo se le apunta su código de Flowww y, si no tenía teléfono, el de Flowww.
- **Citas futuras** colocadas por el motor de agenda a su hora exacta, con su profesional y en una
  cabina de su tratamiento. Las que no caben (chocan con otra, fuera de horario, festivo…) entran igual,
  donde las tenía Flowww, **marcadas para revisar** y con una **tarea en el panel**. Nada se pisa.
- **Avisos:** las importadas no reciben la confirmación (ya la tuvieron en Flowww), pero sí los
  **recordatorios de la víspera y de 2 horas antes**, salvo `--sin-recordatorios`.
- **Consentimientos:** importar no da consentimiento de marketing. Solo se registra lo que diga una
  columna, y solo si lo dice claro («Sí» / «No»).

## 1. Qué pedir a Flowww

Dos exportaciones en CSV (si salen en Excel, «Guardar como» → «CSV»). Vale cualquier separador
(`;` o `,`), UTF-8 (con o sin BOM) o el CSV de Excel en español (Windows-1252), fechas `dd/mm/aaaa` o
`aaaa-mm-dd` y horas `hh:mm`. Los teléfonos pueden venir como sea (`611 00 03 01`, `+34 611-000-301`,
`0034…`, dos números en la misma casilla, el `6,11E+08` que deja Excel si lo ha convertido en número…).

**Clientes** (todos, con o sin citas):

| Columna | Para qué | Nombres que se reconocen solos |
|---|---|---|
| Código de cliente | no duplicar al repetir la importación; enlazar sus citas | Código, Código cliente, Id cliente, Nº cliente, Nº historia… |
| Nombre y apellidos | la ficha | Nombre + Apellidos (o Apellido 1 + Apellido 2), o Nombre completo / Cliente |
| Móvil y teléfono | WhatsApp y recordatorios | Móvil, Teléfono móvil, WhatsApp, Teléfono, Tel, Tlf… (el móvil primero) |
| Email | la ficha | Email, E-mail, Correo, Correo electrónico |
| Fecha de nacimiento | la ficha | Fecha nacimiento, Fecha de nacimiento, F. nacimiento |
| Observaciones | se guardan **cifradas** | Observaciones, Notas, Comentarios |
| Consentimiento de publicidad | solo si lo firmó | Acepta publicidad, Consentimiento marketing, Publicidad, Comunicaciones comerciales… (y Publicidad WhatsApp / Publicidad email por separado) |

**Citas** desde hoy hasta la última que haya dada (las pasadas no hacen falta: si vienen, no se traen):

| Columna | Nombres que se reconocen solos |
|---|---|
| Código de la cita (**importante**: sin él, una cita que cambia en Flowww entre dos importaciones no se reconoce) | Id, Id cita, Código, Nº cita, Localizador |
| Código del cliente, y su nombre y teléfono | Código cliente, Cód. cliente, Id cliente · Cliente, Paciente · Móvil, Teléfono |
| Fecha y hora (juntas o por separado) | Fecha, Día · Hora, Hora inicio (o «15/10/2026 11:00» en una sola) |
| Duración u hora de fin | Duración, Minutos · Hora fin |
| Servicio | Servicio, Tratamiento, Concepto |
| Profesional | Profesional, Empleado, Especialista |
| Cabina | Cabina, Sala, Box, Gabinete |
| Estado | Estado |
| Observaciones | Observaciones, Notas |

Lo que no se pide no se trae: DNI, dirección, historia clínica, fotos, facturas, bonos. Si la
exportación trae esas columnas, el informe las lista en «No se traen» y se quedan fuera.

Preguntad también a Flowww (o a quien lo usa): **qué estados puede tener una cita** (el importador
reconoce Pendiente, Confirmada, Reservada, Citado… y no trae Anulada, Cancelada, No asistió,
Faltó…; lo que no reconozca lo pregunta) y **qué decía el formulario de consentimiento** de la
columna de publicidad (a qué canales se refería).

**Son datos de salud** (RGPD, art. 9): los ficheros se piden por un canal seguro, se guardan solo en
el servidor o en el portátil cifrado, se borran al terminar la migración y **nunca** van al
repositorio (las pruebas usan ficheros inventados, en `test/fixtures/flowww`).

## 2. Antes de importar

1. **La agenda de la app, de verdad** (puerta ⛔ 2 de `PROGRESO.md`): salas, profesionales con sus
   horarios, festivos, el catálogo y qué tratamiento va en qué sala. Si están a medias, muchas citas
   saldrán como «no caben» (fuera del horario de alguien que aún no tiene horario).
2. **Una copia de la base:** `bash scripts/copia-bd.sh antes-de-flowww`.
3. Se lanza donde está la app (la terminal de cPanel o el portátil), con la base de su `.env`.

## 3. El ensayo

```bash
node scripts/importar-flowww.js --pacientes clientes.csv --citas citas.csv
```

Sin `--aplicar` no cambia nada. Saca un informe que **no lleva nombres, teléfonos ni emails**: cada
paciente y cada cita van por su fila del CSV (la de la hoja de cálculo) y su código de Flowww. Se puede
pegar en un correo para consultar una duda.

Cómo leerlo:

- **Cabecera de cada fichero:** codificación, separador y filas, **qué columna ha entendido que es
  cada cosa** (compruébalo) y las que no se traen.
- **PACIENTES:** nuevos; los que ya estaban en la app (con el número de paciente y si se les reconoce
  por teléfono o por email); repetidos dentro del fichero (se traen una vez); los que tienen **el
  teléfono de otra persona** con otro nombre (típico: la madre y la hija con el mismo móvil; se traen
  sin teléfono, porque en la app un teléfono es de un solo paciente); los que no se traen (sin nombre,
  o anonimizados en la app porque ejercieron su derecho de supresión); avisos (un teléfono o un email
  que no se entiende); y el recuento de marketing.
- **CITAS:** pasadas y anuladas (no se traen); bloqueos de agenda sin paciente (la comida, una
  formación: no se traen); ya importadas antes (y si en Flowww **han cambiado de hora o se han
  anulado** desde entonces: esas hay que revisarlas a mano en la app); y las futuras:
  - **caben** a su hora, con su profesional;
  - **caben en otra cabina** (la de Flowww no es de ese tratamiento o estaba ocupada);
  - **no caben**, con el motivo: «Cabina facial ocupada por otra cita de las 12:30 (la cita 45 de la
    app)», «… (la fila 7 de las citas)» si choca con otra del mismo fichero, «es festivo», «cae fuera
    del horario de la clínica», «Estética Uno ya tiene otra cita…», «cae fuera del horario de…». Se
    traen igual, para revisar.
- **TRATAMIENTOS, PROFESIONALES, CABINAS:** con qué casa cada nombre de Flowww y cómo (mismo nombre,
  un alias del catálogo, parte del nombre, el mapa). Lo marcado con ✗ no casa y trae los más parecidos
  con su porcentaje. **Lo parecido nunca se casa solo**: una «Limpieza facial» no es por fuerza la
  «Limpieza facial profunda». Una cabina que no casa no bloquea: la agenda pone una del tratamiento.
- **ESTADOS SIN DECIDIR:** estados de Flowww que no se sabe si son citas vivas.
- **DURACIONES QUE NO CUADRAN:** manda la de la app (con su limpieza); si la buena es la de Flowww,
  hay que corregir el catálogo.
- **PARA PODER APLICAR:** lo que falta decidir y un trozo de mapa listo para copiar.

Se repite el ensayo, completando el mapa, hasta que diga **«Todo listo»**.

## 4. El mapa

Un JSON que dice lo que el importador no puede saber solo. Todo es opcional; las claves se comparan
sin mayúsculas ni tildes; lo que empieza por `_` es un comentario. Ejemplo (inventado):

```json
{
  "_nota": "Mapa de la migración de octubre",
  "citas": { "profesional": "Especialista asignado", "observaciones": null },
  "tratamientos": { "Botox 3 zonas": "toxina-3-zonas", "Pack novia": "ignorar" },
  "profesionales": { "Rocío": "estetica-dos", "Suplente": "cualquiera" },
  "salas": { "Box 3": "cabina-facial" },
  "estados": { "En espera": "importar", "Reserva web sin pagar": "ignorar" }
}
```

- `pacientes` / `citas`: en qué columna está cada campo (un nombre o una lista). Con `null`, ese
  campo no se trae (p. ej. las observaciones, si no hacen falta). Campos: `id`, `nombre`, `apellidos`,
  `telefono`, `email`, `fecha_nacimiento`, `observaciones`, `marketing`, `marketing_whatsapp`,
  `marketing_email` (pacientes) e `id`, `paciente_id`, `paciente`, `apellidos`, `telefono`, `email`,
  `fecha`, `hora`, `hora_fin`, `duracion`, `servicio`, `profesional`, `sala`, `estado`,
  `observaciones` (citas).
- `tratamientos`: servicio de Flowww → **id** del tratamiento de la app, o `"ignorar"` (sus citas no
  se traen: packs, bonos, cosas que no son cita).
- `profesionales`: nombre en Flowww → **código** del profesional en la app, o `"cualquiera"` (lo
  elige la agenda entre los que hacen ese tratamiento).
- `salas`: cabina de Flowww → **código** de la sala, o `"cualquiera"`.
- `estados`: `"importar"` o `"ignorar"`.

El informe pone el id o el código al lado de cada sugerencia («Toxina botulínica 3 zonas»
(toxina-3-zonas)). Todos están en la base (`SELECT id, nombre FROM tratamientos WHERE activo`;
`SELECT codigo, nombre FROM profesionales`; `SELECT codigo, nombre FROM salas`) y en las semillas
(`semillas/iemec/tratamientos.json` y `equipo.json`).

Lo que el mapa dice de los servicios **se guarda en la app** (`mapeo_tratamientos`, con la clave
`flowww:…`): la siguiente importación ya los conoce. Aun así, guardad el fichero del mapa para la
importación final (lo de `ignorar`, los profesionales y los estados no se guardan).

## 5. Aplicar

```bash
node scripts/importar-flowww.js --pacientes clientes.csv --citas citas.csv --mapa mapa.json --aplicar
```

Todo va en **una transacción**: o entra todo o nada. Primero lo planifica sin bloquear nada; para
escribir, bloquea las cabinas, profesionales y aparatos como en una reserva (unos segundos: nadie puede
dar una cita a la vez, ni la IA por WhatsApp, que espera) y, si mientras planificaba alguien ha dado o
cambiado una cita, lo vuelve a planificar ya bloqueado: nunca deja dos citas en el mismo sitio sin
avisar. Aun así, mejor lanzarlo con la clínica cerrada. Si queda algo por decidir, no aplica nada y lo
dice (y termina con código 1).

Qué queda en la app:

- Pacientes con `origen = 'flowww'` y su código en `flowww_id`; las observaciones, cifradas
  (AES-256-GCM, como las conversaciones). A nadie se le marca como «cliente»: eso, por la excepción de
  la LSSI, también daría permiso para mensajes comerciales. Pasa a cliente cuando complete una cita en
  la app.
- Consentimientos de marketing solo de quien tenga un «sí» explícito (fuente `importacion`, con la
  fila y la columna como prueba). Un «no» explícito se registra como «revocado» y, si es a WhatsApp,
  como **baja comercial** (en su ficha y en la lista de bajas por teléfono, como las demás). Vacío,
  «pendiente» o «?» no registran nada. A quien ya estaba en la app y ya tenía un consentimiento de ese
  tipo no se le toca.
- Citas con origen `importacion`, estado «confirmada» y su código en `flowww_id`. Las observaciones de
  la cita, en sus notas. Si el paciente (o un lead con su teléfono) estaba en una secuencia de
  captación, se para, como al reservar.
- Las que no cabían: en la agenda donde las tenía Flowww, con el motivo en `revisar_motivo` y una tarea
  en **Tareas**: «Cita importada de Flowww para revisar (15/10 13:00, …): Cabina facial ocupada por…».
  Hay que moverla o hablar con el paciente.
- Si Flowww la tenía con alguien concreto, se queda con esa persona aunque en la app ese tratamiento
  no pida a nadie en concreto (y esa persona tiene que estar libre).
- Al final, el **lote** (`flowww-2026-10-13-1000-ab12`): con él se deshace.

**Recordatorios.** Si Flowww sigue encendido unos días y manda sus propios recordatorios, se importa
con `--sin-recordatorios` para que el paciente no reciba dos. Al apagar Flowww:

```bash
node scripts/importar-flowww.js --recordatorios si            # cuántas citas cambiarían
node scripts/importar-flowww.js --recordatorios si --aplicar  # y se les ponen
```

## 6. Repetir: la importación final

Se puede lanzar las veces que haga falta: **lo ya importado no se duplica** (pacientes por su código,
citas por el suyo). Lo normal es una importación de prueba unos días antes y, el día del apagado, una
exportación nueva con el mismo mapa: solo entra lo nuevo. El informe avisa de las citas que en Flowww
se han movido o anulado desde la importación anterior; esas **no se tocan solas** (en la app puede que
ya se hayan cambiado): se revisan a mano. Sin código de cita, una cita movida parece nueva: si el
paciente ya tiene una importada de ese tratamiento que ya no viene en el fichero, la nueva se trae
**para revisar**, con su tarea («puede ser la cita 45… anular la que sobre»).

## 7. Volver atrás

```bash
node scripts/importar-flowww.js --deshacer                       # qué quitaría la última importación
node scripts/importar-flowww.js --deshacer flowww-… --aplicar    # y la quita
```

Quita lo que metió ese lote **y nadie ha tocado**: sus citas que siguen «confirmadas» y de las que
no se ha avisado al paciente (con sus tareas), los consentimientos y bajas que registró, el código y
el teléfono que apuntó a quien ya estaba, lo que guardó del mapa, las secuencias de captación que
paró (salvo a quien tenga una cita por delante) y los pacientes nuevos **que no tengan nada más** en
la app. Lo demás se queda y el informe lo dice: una cita que ya se ha marcado (llegó, no vino,
anulada, reprogramada) o de la que ya le salió un recordatorio (el paciente va a venir: hay que
resolverla con él), y un paciente que ya ha escrito por WhatsApp o ha recibido un aviso (su
conversación se conserva).

Si hay que volver a como estaba todo, está la copia del paso 2 (se pierde lo que se haya hecho en la
app desde entonces): se restaura como en `scripts/probar-restauracion.sh` (que también sabe
descifrarla), pero sobre la base de verdad:
`gunzip -c ~/respaldo-iemec/bd-antes-de-flowww-….sql.gz | mysql -u "$DB_USER" -p "$DB_NAME"`.

## 8. Datos de salud: lo mínimo

- Solo se traen los campos de la tabla del paso 1; el resto de columnas se ignora, y con el mapa se
  puede dejar fuera cualquier campo (`null`).
- Las observaciones del paciente van cifradas en la base (las de la cita, en sus notas, como las que
  escribe recepción). El informe no lleva nombres, teléfonos, emails ni notas, y si choca un teléfono
  repetido, el error no lo enseña.
- A un paciente anonimizado en la app (derecho de supresión) no se le vuelve a traer, ni a sus citas:
  se le reconoce por su código de Flowww o por su teléfono (si la anonimización los conserva). El
  informe dice qué filas se han quedado fuera por eso.
- Los CSV y el mapa (si nombra personas) se borran del servidor al terminar.
