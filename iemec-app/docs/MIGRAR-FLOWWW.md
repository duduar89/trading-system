# Migrar de Flowww: pacientes y citas futuras

Para apagar Flowww sin perder nada, la app trae de sus exportaciones los **pacientes** y las **citas
futuras**. La **facturación no se trae**: se queda en Flowww (y en la gestoría), como el resto de lo
que la app no hace (historia clínica, bonos, cobros).

```
Flowww ──exporta──▶ pacientes.csv + citas.csv   (fuera de la carpeta del repositorio)
                         │
node scripts/importar-flowww.js --pacientes … --citas … [--mapa mapa.json]
                         │
     ensayo (sin --aplicar): no cambia nada; informe con lo que haría y lo que falta decidir
     aplicar (--aplicar):    todo en una transacción; entra todo o nada
     deshacer (--deshacer):  quita lo que metió y nadie ha tocado (las oposiciones se quedan)
```

Resumen de lo que hace:

- **Pacientes** sin duplicar: por su código de Flowww, por su teléfono o por su email, siempre que el
  nombre cuadre. A quien ya estaba en la app (le escribió por WhatsApp, lo dio de alta recepción) se le
  apunta su código de Flowww y **se completa lo que su ficha no tenga** (teléfono, apellidos, email,
  fecha de nacimiento, observaciones); lo que ya tiene no se toca.
- **Citas futuras** colocadas por el motor de agenda a su hora exacta, con su profesional y en una
  cabina de su tratamiento. Las que no caben (chocan con otra, fuera de horario, festivo…) entran igual,
  donde las tenía Flowww, **marcadas para revisar** y con una **tarea en el panel**. Nada se pisa.
- **Lo que ya se trajo y en Flowww ha cambiado** (anulada, movida, o que ya no sale en la exportación)
  no se toca solo: se queda **sin recordatorios** y con su tarea, para que recepción lo resuelva.
- **Avisos:** las importadas no reciben la confirmación (ya la tuvieron en Flowww), pero sí los
  **recordatorios de la víspera y de 2 horas antes**, salvo `--sin-recordatorios`.
- **Consentimientos:** importar no da consentimiento de marketing. Solo cuenta lo que diga una columna,
  y solo si lo dice claro («Sí» / «No»). **El «no» gana siempre**; un «sí» no pasa por encima de lo que
  el paciente dijo en la app ni de una baja comercial.

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
| Fecha del consentimiento | va en la prueba del consentimiento | Fecha consentimiento, Fecha LOPD, Fecha firma LOPD, Fecha RGPD |

**Citas: todas las que haya desde hoy**, sin filtrar por profesional, cabina ni fechas (las pasadas no
hacen falta: si vienen, no se traen). Tiene que ser la exportación **completa**: al repetir la
importación, una cita que ya se trajo y no sale en la nueva se da por anulada en Flowww (sección 6).

| Columna | Nombres que se reconocen solos |
|---|---|
| Código de la cita (**importante**: sin él, una cita que cambia en Flowww entre dos importaciones no se reconoce) | Id cita, Nº cita, Código cita, Localizador (y Id, Código, Referencia: ver abajo) |
| Código del cliente, y su nombre y teléfono | Código cliente, Cód. cliente, Id cliente · Cliente, Paciente · Móvil, Teléfono |
| Fecha y hora (juntas o por separado) | Fecha, Día · Hora, Hora inicio (o «15/10/2026 11:00» en una sola) |
| Duración u hora de fin | Duración, Minutos · Hora fin |
| Servicio | Servicio, Tratamiento, Concepto |
| Profesional | Profesional, Empleado, Especialista |
| Cabina | Cabina, Sala, Box, Gabinete |
| Estado (**obligatoria**: sin ella no se sabe qué está anulado) | Estado, Estado cita, Situación |
| Observaciones | Observaciones, Notas |

- Una columna con un nombre genérico («Id», «Código», «Referencia») en las citas puede ser el código
  de la cita **o el del cliente**. Si el fichero no trae otra columna para el cliente, no se usa hasta
  que el mapa diga qué es (sección 4). Y si un código de cita sale en citas vivas de días o personas
  distintas, no es un código de cita: no se aplica hasta arreglarlo en el mapa.
- Si una cita tiene varios servicios y Flowww saca una fila por servicio con el mismo código, se trae
  una cita por servicio.
- Si la exportación no trae estado (o lo trae en otra columna, como «Anulada: Sí/No»), el mapa lo dice.

Lo que no se pide no se trae: DNI, dirección, historia clínica, fotos, facturas, bonos. Si la
exportación trae esas columnas, el informe las lista en «No se traen» y se quedan fuera.

Preguntad también a Flowww (o a quien lo usa): **qué estados puede tener una cita** (el importador
reconoce Pendiente, Confirmada, Reservada, Citado… y no trae Anulada, Cancelada, No asistió,
Faltó…; lo que no reconozca lo pregunta), **qué decía el formulario de consentimiento** de la columna de
publicidad (a qué canales se refería) y **los formularios de consentimiento firmados** (PDF o papel): son
la prueba de cada «sí» cuando Flowww se apague (sección 8).

**Son datos de salud** (RGPD, art. 9): los ficheros se piden por un canal seguro, se guardan solo en
el servidor o en el portátil cifrado, **fuera de la carpeta del repositorio** (por ejemplo en
`~/flowww/`) y **nunca** van al repositorio, que es público. Como segunda barrera, el `.gitignore` de la
app no deja subir ningún `*.csv` ni `mapa*.json` (salvo los inventados de las pruebas, en
`test/fixtures/flowww`).

## 2. Antes de importar

1. **La agenda de la app, de verdad** (puerta ⛔ 2 de `PROGRESO.md`): salas, profesionales con sus
   horarios, festivos, el catálogo y qué tratamiento va en qué sala. Si están a medias, muchas citas
   saldrán como «no caben» (fuera del horario de alguien que aún no tiene horario).
2. **Una copia de la base, fuera de la rotación.** `scripts/copia-bd.sh` solo guarda las 60 últimas
   copias y en cPanel el cron hace una cada 15 minutos: la de antes de importar desaparecería sola en
   unas 15 horas. Así que se hace y se aparta:

   ```bash
   bash scripts/copia-bd.sh antes-de-flowww
   mkdir -p ~/respaldo-flowww && cp ~/respaldo-iemec/bd-antes-de-flowww-* ~/respaldo-flowww/
   ```

   y se descarga también fuera del servidor (va cifrada si hay `COPIA_CLAVE_FICHERO`, como todas).
   Esa copia se guarda hasta que la migración esté dada por buena.
3. **La `CLAVE_CIFRADO` de la app en el `.env`** de donde se lance (la misma que usa la app: en cPanel,
   la de «Setup Node.js App»). Con `--aplicar` se cifran las observaciones y lo que hace falta para
   deshacer: con la clave de desarrollo, que es pública, no estaría protegido y la app no lo podría
   leer. Sin ella, `--aplicar` no hace nada y lo dice.
4. Se lanza donde está la app (la terminal de cPanel o el portátil), con la base de su `.env`.

## 3. El ensayo

```bash
node scripts/importar-flowww.js --pacientes ~/flowww/clientes.csv --citas ~/flowww/citas.csv
```

Sin `--aplicar` no cambia nada. Saca un informe que **no lleva nombres, teléfonos, emails ni notas**:
cada paciente y cada cita van por su fila del CSV (la de la hoja de cálculo) y su código de Flowww.
**Aun así es confidencial**, con el mismo trato que los CSV: con la app o el fichero se sabe de quién es
cada fila, y dice qué tratamiento lleva y cuándo (datos de salud seudonimizados siguen siendo datos
personales, RGPD considerando 26). No se manda por correo ni se pega en una incidencia; si hay que
consultar algo, se cuenta sin copiarlo.

Cómo leerlo:

- **Cabecera de cada fichero:** codificación, separador y filas, **qué columna ha entendido que es
  cada cosa** (compruébalo) y las que no se traen.
- **PACIENTES:** nuevos; los que ya estaban en la app (con el número de paciente, si se les reconoce
  por teléfono o por email y **qué se completa en su ficha**); repetidos dentro del fichero (se traen
  una vez); los que tienen **el teléfono de otra persona** con otro nombre (típico: la madre y la hija
  con el mismo móvil; se traen sin teléfono, porque en la app un teléfono es de un solo paciente); los
  que no se traen (sin nombre, o anonimizados en la app porque ejercieron su derecho de supresión);
  avisos (un teléfono o un email que no se entiende); el recuento de marketing (con los «no» que ganan
  a un «sí» y los «sí» que no se registran por una baja) y quién está en la **lista de bajas**.
- **CITAS:** si la columna del código es dudosa o falta la del estado (y no se aplica hasta que lo diga
  el mapa); pasadas y anuladas (no se traen); bloqueos de agenda sin paciente (la comida, una
  formación: no se traen); filas repetidas y citas con varios servicios; las ya importadas antes, y
  **las que en Flowww ya no son así** (anuladas, movidas, que ya no salen: se quedan sin recordatorios y
  con su tarea); y las futuras:
  - **caben** a su hora, con su profesional;
  - **caben en otra cabina** (la de Flowww no es de ese tratamiento o estaba ocupada);
  - **no caben**, con el motivo: «Cabina facial ocupada por otra cita de las 12:30 (la cita 45 de la
    app)», «… (la fila 7 de las citas)» si choca con otra del mismo fichero, «es festivo», «cae fuera
    del horario de la clínica», «Estética Uno ya tiene otra cita…», «cae fuera del horario de…». Se
    traen igual, para revisar;
  - las que se han casado con su paciente **solo por el nombre** (lo más flojo: compruébalas);
  - las que **no se traen** (fecha u hora ilegibles, «hay varios pacientes con ese nombre», «no se
    sabe de quién es»): si son futuras, hay que darlas a mano;
  - los **pacientes que solo salen en las citas** (con el teléfono de la cita, si no es de otra
    persona), y los que se quedan sin teléfono (sin él no les llegan los recordatorios).
- **TRATAMIENTOS, PROFESIONALES, CABINAS:** con qué casa cada nombre de Flowww y cómo (mismo nombre,
  un alias del catálogo, parte del nombre, el mapa). Lo marcado con ✗ no casa y trae los más parecidos
  con su porcentaje. **Lo parecido nunca se casa solo**: una «Limpieza facial» no es por fuerza la
  «Limpieza facial profunda». Una cabina que no casa no bloquea: la agenda pone una del tratamiento.
- **ESTADOS SIN DECIDIR:** estados de Flowww que no se sabe si son citas vivas.
- **DURACIONES QUE NO CUADRAN:** manda la de la app (con su limpieza); si la buena es la de Flowww,
  hay que corregir el catálogo.
- **PARA PODER APLICAR:** lo que falta decidir y un trozo de mapa listo para copiar.
- **El final:** «Todo listo» solo si no se queda nada fuera. Si no, «Listo para aplicar, pero ojo:» y
  lo que se perdería o cambiaría (citas que no se traen, citas ya importadas que se quedarían sin
  recordatorios). Leedlo antes de aplicar.

Se repite el ensayo, completando el mapa, hasta que no quede nada por decidir.

## 4. El mapa

Un JSON que dice lo que el importador no puede saber solo. Todo es opcional; las claves se comparan
sin mayúsculas ni tildes; lo que empieza por `_` es un comentario. Ejemplo (inventado):

```json
{
  "_nota": "Mapa de la migración de octubre",
  "citas": { "id": "Código", "profesional": "Especialista asignado", "observaciones": null },
  "tratamientos": { "Botox 3 zonas": "toxina-3-zonas", "Pack novia": "ignorar" },
  "profesionales": { "Rocío": "estetica-dos", "Suplente": "cualquiera" },
  "salas": { "Box 3": "cabina-facial" },
  "estados": { "En espera": "importar", "Reserva web sin pagar": "ignorar" }
}
```

- `pacientes` / `citas`: en qué columna está cada campo (un nombre o una lista). Con `null`, ese
  campo no se trae (p. ej. las observaciones, si no hacen falta) o no existe. Campos: `id`, `nombre`,
  `apellidos`, `telefono`, `email`, `fecha_nacimiento`, `observaciones`, `marketing`,
  `marketing_whatsapp`, `marketing_email`, `fecha_consentimiento` (pacientes) e `id`, `paciente_id`,
  `paciente`, `apellidos`, `telefono`, `email`, `fecha`, `hora`, `hora_fin`, `duracion`, `servicio`,
  `profesional`, `sala`, `estado`, `observaciones` (citas). Dos casos que el informe pide decidir:
  - el código de la cita con un nombre genérico: `"citas": { "id": "Código" }` si es el de la cita, o
    `"citas": { "paciente_id": "Código", "id": null }` si es el del cliente;
  - sin columna de estado: `"citas": { "estado": null }` si la exportación solo trae citas vivas, o
    `"citas": { "estado": "Anulada" }` y en `estados` qué valores se traen
    (`{ "Sí": "ignorar", "No": "importar" }`).
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
`flowww:…`): la siguiente importación ya los conoce. Aun así, guardad el fichero del mapa (junto a los
CSV, fuera del repositorio) para la importación final: lo de `ignorar`, las columnas, los profesionales
y los estados no se guardan.

## 5. Aplicar

```bash
node scripts/importar-flowww.js --pacientes ~/flowww/clientes.csv --citas ~/flowww/citas.csv --mapa ~/flowww/mapa.json --aplicar
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
- A quien ya estaba: su código y lo que su ficha no tenía (teléfono, apellidos, email, fecha de
  nacimiento). Sus observaciones de Flowww, cifradas, detrás de las suyas si ya tenía («Observaciones
  de Flowww: …»); si ya las tiene, no se repiten.
- Consentimientos de marketing (fuente `importacion`), con su prueba: el código de cliente de Flowww, el
  fichero, la fila, la columna y lo que decía, y desde cuándo si Flowww lo sabe («… = «Sí»; en Flowww
  desde el 03/04/2024; importado el 13/10/2026»: `registrado_en` es el día de la importación, no el del
  consentimiento).
  - Un **«no»** explícito se registra siempre como «revocado» (aunque en la app hubiera un «sí», también
    de una importación anterior: sin fecha para saber qué es más reciente, gana la oposición) y, si es
    a WhatsApp, como **baja comercial** (en su ficha y en la lista de bajas por teléfono, como las
    demás). Si la misma persona sale dos veces y una fila dice «sí» y otra «no», gana el «no».
  - Un **«sí»** solo se registra si en la app no hay nada de ese tipo (lo que dijo en la app manda) y
    no tiene la baja comercial, ni en su ficha ni en la lista de bajas (p. ej. escribió «BAJA» cuando aún
    era un lead). A quien está en la lista se le apunta también la baja en la ficha.
  - Vacío, «pendiente» o «?» no registran nada.
- Citas con origen `importacion`, estado «confirmada», su código en `flowww_id` y la confirmación dada
  (`aviso_confirmacion_en`: se la dio Flowww). Las observaciones de la cita, **cifradas** en la cita
  (en Flowww suelen llevar datos de salud). Si el paciente (o un lead con su teléfono) estaba en una
  secuencia de captación, se para, como al reservar.
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

Las que están a revisar porque en Flowww ya no son así (sección 6) siguen sin ellos: cuando recepción
compruebe que una sigue en pie, `--recordatorios si --cita <número de la cita en la app> --aplicar`.

## 6. Repetir: la importación final

Se puede lanzar las veces que haga falta: **lo ya importado no se duplica** (pacientes por su código,
citas por el suyo). Lo normal es una importación de prueba unos días antes y, el día del apagado, una
exportación nueva, **completa**, con el mismo mapa: entra lo nuevo y se compara lo que ya se trajo.

Lo que ya se trajo y en Flowww ya no es así **no se toca solo** (en la app puede que ya se haya
cambiado): se queda **sin recordatorios** (que no le llegue al paciente un «te esperamos mañana» de una
cita que anuló) y con una **tarea para revisarla**:

- **anulada** en Flowww: anularla también en la app o hablar con el paciente;
- **cambiada** de hora (o de tratamiento): moverla o hablar con el paciente;
- **ya no sale** en la exportación (anulada y no exportada, o borrada): comprobarlo con el paciente.
  Solo se mira hasta la última fecha del fichero: de lo de después no se puede saber, y el informe lo
  cuenta. Por eso la exportación tiene que ser completa: si faltan citas, esas se darían por anuladas
  (el informe avisa antes de aplicar; y si se aplicó por error, deshacer les devuelve los
  recordatorios).

Sin código de cita, una cita movida parece nueva: si el paciente ya tiene una importada de ese
tratamiento que ya no viene en el fichero, la nueva se trae **para revisar**, con su tarea («puede ser
la cita 45… anular la que sobre»), y la de antes se queda sin recordatorios. Lo que ya está a revisar no
se vuelve a avisar en la siguiente importación.

## 7. Volver atrás

```bash
node scripts/importar-flowww.js --deshacer                       # qué quitaría la última importación
node scripts/importar-flowww.js --deshacer flowww-… --aplicar    # y la quita
```

Quita lo que metió ese lote **y nadie ha tocado**: sus citas que siguen «confirmadas» y de las que
no se ha avisado al paciente (con sus tareas), los «sí» a la publicidad que registró, el código y lo que
completó en la ficha de quien ya estaba (si sigue siendo lo que puso), lo que guardó del mapa, las
secuencias de captación que paró (salvo a quien tenga una cita por delante) y los pacientes nuevos
**que no tengan nada más** en la app; y a las ya importadas que dejó sin recordatorios, se los devuelve.
Lo demás se queda y el informe lo dice: una cita que ya se ha marcado (llegó, no vino, anulada,
reprogramada) o de la que ya le salió un recordatorio (el paciente va a venir: hay que resolverla con
él), y un paciente que ya ha escrito por WhatsApp o ha recibido un aviso (su conversación se conserva).

**Las oposiciones no se deshacen:** los «no» a la publicidad y las bajas comerciales que registró se
quedan (una oposición conocida no se olvida porque la importación estuviera mal). Si se quita a un
paciente nuevo, su teléfono sigue en la lista de bajas.

Si hay que volver a como estaba todo, está la copia del paso 2 (se pierde lo que se haya hecho en la
app desde entonces). Se restaura sobre la base de verdad como en `scripts/probar-restauracion.sh`,
desde la carpeta de la app y con las variables de su `.env` cargadas:

```bash
set -a; . ./.env; set +a
COPIA=~/respaldo-flowww/bd-antes-de-flowww-….sql.gz        # o .sql.gz.enc si va cifrada
if [[ "$COPIA" == *.enc ]]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$COPIA" -pass "file:$COPIA_CLAVE_FICHERO" | gunzip | mysql -u "$DB_USER" -p "$DB_NAME"
else
  gunzip -c "$COPIA" | mysql -u "$DB_USER" -p "$DB_NAME"
fi
```

## 8. Datos de salud: lo mínimo

- Solo se traen los campos de la tabla del paso 1; el resto de columnas se ignora, y con el mapa se
  puede dejar fuera cualquier campo (`null`).
- Las observaciones van cifradas en la base: las del paciente y las de cada cita. El informe no lleva
  nombres, teléfonos, emails ni notas (un texto que no parece una fecha o una hora no se repite en los
  errores: con la columna equivocada podría ser un nombre), y si choca un teléfono repetido, el error
  no lo enseña. Aun así el informe es confidencial (sección 3).
- A un paciente anonimizado en la app (derecho de supresión) no se le vuelve a traer, ni a sus citas:
  se le reconoce por su código de Flowww o por su teléfono (si la anonimización los conserva). El
  informe dice qué filas se han quedado fuera por eso.
- **La prueba de los consentimientos** (RGPD art. 7.1): cuando Flowww se apague, cada «sí» importado
  solo se podrá demostrar con lo que se haya guardado. Antes del apagado, pedid a Flowww los
  formularios firmados, y guardad una copia cifrada del CSV de clientes junto a las copias de la base
  (desde la carpeta de la app, con su `.env` cargado como en la sección 7):

  ```bash
  openssl enc -aes-256-cbc -pbkdf2 -salt -in ~/flowww/clientes.csv -out ~/respaldo-flowww/clientes-flowww.csv.enc -pass "file:$COPIA_CLAVE_FICHERO"
  ```

  Esa prueba no se borra mientras se usen esos consentimientos.
- El resto (los CSV de citas, el informe, el mapa si nombra personas) se borra del servidor y del
  portátil al dar la migración por buena.
