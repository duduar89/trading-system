# Mesa de trading como app web (PWA) en el cPanel de CIFRA

Contrato de la versión web. Complementa a `ARQUITECTURA.md`, que sigue mandando
para todo lo demás. Quien escribe un módulo cumple su contrato al pie de la
letra; si no se puede, se cambia aquí primero.

Decidido con Eduardo el 30-sep-2026: vive en **su cPanel (LucusHost, CloudLinux,
LiteSpeed, Node 22, MariaDB 11.4)**, en un **subdominio propio** (propuesta:
`mesa.brainstormersagency.es`) con **su propia base de datos**, se entra con
**usuario y contraseña**, y es una **PWA** que se instala en el móvil.

---

## W0. Lo que manda el hosting

Aprendido en el portal y escrito en `portal-cifra/docs/00-CRONES.md` y
`services/cronLider.js`:

1. **LiteSpeed mata el proceso de la app cuando no hay tráfico** y lo levanta con
   la siguiente petición. Lo que tiene que pasar sí o sí vive en el **crontab de
   cPanel**, no dentro de la app.
2. **Puede haber varios procesos de la misma app a la vez.**
3. **Cada publicación reinicia la app.**

De ahí la forma de la versión web:

- **El motor late por cron.** `scripts/latido.js` se lanza cada minuto desde el
  crontab: toma el cerrojo de la carpeta de datos, reconstruye el orquestador
  desde disco, da **un** paso, guarda, publica la instantánea y sale. La mesa ya
  está hecha por pasos y probada contra reinicios; aquí cada paso es un proceso
  nuevo.
- **La web no guarda estado ni opera por su cuenta.** `src/web.js` (el fichero de
  arranque de la app de Node en cPanel) sirve el panel y la API leyendo lo que
  publicó el último latido. Un botón (Pausar, Kill…) se ejecuta tomando **el mismo
  cerrojo** que el motor, así que nunca actúan dos a la vez, haya los procesos
  que haya. Si LiteSpeed mata la web, no se pierde nada.
- **MariaDB guarda** los usuarios, las sesiones, los intentos de login, el
  registro de latidos y una **copia consultable** de los registros (operaciones,
  órdenes, incidentes, costes del LLM, informes, mensajes). El estado interno del
  motor sigue en `data/` en disco, que en cPanel es persistente y compartido por
  todos los procesos (misma máquina).
- **Ante la duda, no se opera.** Si el cerrojo está cogido, el latido sale sin
  hacer nada; el siguiente lo intentará. Si la base de datos no contesta, el
  motor opera igual (no la necesita para operar) y la copia a la base se pone al
  día en el latido siguiente. Si no hay sesión válida, la web no enseña nada.

El modo local (portátil, `npm start`, `Arrancar mesa.bat`, la demo) **no cambia**:
proceso continuo, sin base de datos y sin login.

---

## W1. Piezas y dueños

| Ficheros | Dueño |
|---|---|
| `src/latido.js`, `scripts/latido.js`, `scripts/laboratorio.js`, cambios en `src/orquestador.js` y `src/agentes/**` para que un paso por proceso sea exacto, `test/latido-*.test.js` | **M · Motor por latido** |
| `src/web.js`, `src/web/**`, cambios en `src/servidor.js`, `web/**` (login, PWA, ritmo de un latido por minuto), `scripts/generar-iconos.js`, `test/web-*.test.js`, `test/parque-*` si cambia la interfaz | **W · Web, login y PWA** |
| `src/bd/**`, `scripts/crear-tablas.js`, `scripts/crear-usuario.js`, `.github/workflows/desplegar-mesa.yml` y `.github/scripts/*mesa*` (en la raíz del repositorio), `docs/06-app-web.md`, `test/bd-*.test.js` | **D · Base de datos y despliegue** |

`package.json` lo toca **D** (dependencia `mysql2` y scripts); M y W piden lo suyo
en "desviaciones".

---

## W2. Motor por latido (M)

```js
// src/latido.js
async function conLaMesa(config, fn, { espera = 0, motivo } = {}) → { ok: true, resultado } | { ok: false, motivo: 'ocupado'|'error', detalle }
//  Toma el cerrojo de config.carpetaDatos (src/util/proceso.js, flag 'wx'), con
//  espera máxima `espera` ms reintentando cada 250 ms; construye las piezas con
//  construir() de src/index.js y el orquestador desde disco (iniciar() sin bucle),
//  ejecuta fn(orquestador), espera sus tareas de fondo, guarda, publica la
//  instantánea (W3) y suelta el cerrojo SIEMPRE (finally). Nunca deja el
//  cerrojo cogido por una excepción.
async function latido(config) → { ok, ms, resumen }
//  conLaMesa(config, orq => orq.paso(), { espera: 0 }). Apunta el latido (inicio,
//  ms, ok, resumen) en data/latidos.jsonl, que D copia a mesa_latidos.
function publicarInstantanea(config, orquestador) → void
//  Escribe data/instantanea.json (atómico, con { publicada: ms }) con
//  orquestador.instantanea().
```

- `scripts/latido.js`: lo que lanza el cron. Carga `.env` (config), llama a
  `latido(config)`, luego a la copia a base de datos de D (`src/bd/espejo.js`,
  si hay configuración de base) y sale con 0 aunque la base falle (se apunta).
  **Vigía**: si el proceso pasa de 4 minutos, se sale solo con código 1 (lo
  guardado en el último paso manda; la recuperación tras un corte ya está
  probada). Si sale «omitido» porque el cerrojo lleva cogido más que el vigía
  y 1 min, sale con **código 2** (cerrojo viejo: el cron avisa).
- **Un latido no tarda.** En marcha normal, menos de 20 s. Lo largo va fuera:
  el laboratorio semanal corre en `scripts/laboratorio.js` (su propio cron de
  los lunes y su propio cerrojo `.laboratorio`), lee lo que necesita del estado
  sin tocarlo y deja el resultado en `data/laboratorio-resultado.json`; el
  latido siguiente lo incorpora al estado bajo el cerrojo principal. El comité
  con LLM cabe en un latido: en el modo latido cada llamada al LLM tiene un
  **tope de 45 s y 0 reintentos**, y todo el LLM del proceso un **plazo** que
  acaba 1 min antes del vigía (`scripts/latido.js` se lo pasa a
  `latido(config, { plazoLLM })`; por defecto, 150 s desde que se toma el
  cerrojo). Una llamada a la que no le quedan 15 s no se hace (plantillas).
- **Un corte a mitad del comité no se repite.** Antes de llamar al LLM el
  latido guarda el estado con `comite.pedido = null`, la próxima cita ya
  movida y `comite.enCurso = { desde, motivo }`. Si el latido siguiente
  encuentra un `enCurso`, lo quita y lo dice en el canal del comité; no lo
  reconvoca.
- **El gasto del LLM se reserva en disco** (`src/agentes/reservas-llm.js`):
  mirar el tope y reservar se hace bajo un cerrojo corto (`data/.llm-reservas`)
  y la reserva queda en `data/llm-reservas.jsonl` hasta que la llamada apunta
  su coste. Todas las instancias (latido, cada petición del Megáfono, cada
  proceso web) ven lo que las demás tienen en vuelo. Una reserva que vence sin
  cerrarse (el proceso murió a mitad) se apunta en `llm-costes.jsonl` con su
  estimado (`estimado: true, huerfana: true`) una sola vez.
- **Un paso por proceso tiene que ser exacto.** Todo lo que hoy viva solo en
  memoria entre pasos y cambie decisiones (contadores de órdenes por minuto y por
  mesa/hora, órdenes en vuelo, reservas de gasto del LLM, pendientes de la bolsa,
  cadencias, comité convocado, descansos…) se guarda en el estado o se
  reconstruye desde los registros. **Caso conocido obligatorio**: la misma demo
  sintética de 20 días corrida (a) en un proceso continuo y (b) reconstruyendo el
  orquestador desde disco en cada paso, da **el mismo** estado final, las mismas
  operaciones, los mismos comités y los mismos mensajes (salvo marcas de tiempo
  de pantalla). Si algo difiere, se arregla la causa.
- En modo sintético, el reloj simulado se guarda en el estado (ya se hace) y cada
  latido avanza 5 min: así se puede probar el cron sin esperar minutos.
- El comité en modo latido no hace pausas de pantalla. Para que se vea en el
  panel, los jefes quedan en la sala de comité 5 min tras la reunión (estado
  visual guardado con su «hasta»).
- Convocar el comité desde la web lo deja **pedido** en el estado; se celebra en
  el latido siguiente (≤ 1 min) y el panel dice «Convocado: empieza en el próximo
  latido».

---

## W3. Web (W)

`src/web.js` es el fichero de arranque de la app de Node en cPanel
(«Application startup file»). Crea el servidor de `src/servidor.js` en **modo
web**:

- **Lectura:** `/api/estado` devuelve `data/instantanea.json` (releído cuando
  cambia su fecha de modificación) con `edadSeg` añadido. El SSE (`/api/eventos`)
  vigila cada segundo la instantánea y la cola de `data/mensajes.jsonl` y emite
  `estado`, `mensaje`, `ejecucion` y `agente` (este último por diferencia de sala
  o estado entre dos instantáneas). Ping cada 15 s. Cabeceras para que LiteSpeed
  no retenga el flujo: `Cache-Control: no-cache, no-transform`,
  `X-Accel-Buffering: no`, y `flushHeaders()`.
- **Órdenes:** `POST /api/comando/:nombre` → `conLaMesa(config, orq =>
  orq.comando(nombre, datos), { espera: 20000 })`. Las que llaman al LLM
  (interpretar el Megáfono) interpretan **fuera** del cerrojo y solo lo toman para
  guardar la propuesta. Si el cerrojo no llega en 20 s, 503 «La mesa está en
  pleno latido, vuelve a intentarlo».
- **Ritmo:** la instantánea trae `latidoMs` (60 000 en tiempo real). La franja de
  «Cifras sin actualizar» salta a los `2,5 × latidoMs`, no a los 30 s.
- **Salud:** `GET /api/salud` (sin sesión, sin datos del fondo): `{ ok, version,
  ultimoLatidoHaceSeg, modo, latidosMalosSeguidos }`; 503 si el último latido
  **bueno** (`ok: true` en `latidos.jsonl`) tiene más de 3 min. Los omitidos por
  el cerrojo y los fallidos no cuentan como latido; `latidosMalosSeguidos` dice
  cuántos lleva al final. Sirve para el cron de vigilancia y para comprobar un
  despliegue.

**Lo que la web añade a la instantánea y a la API** (integrado el 30-sep-2026):

- `/api/estado` y el evento `estado` llevan, además de la instantánea publicada,
  `edadSeg` (segundos desde que se escribió `instantanea.json`), `web: true`,
  `sesion: { usuario }` y `latidoMs` solo si el motor no lo trae. El motor, en
  modo latido, añade `latidoMs` y `cabecera.comitePedido` (ARQUITECTURA.md §7).
- `GET /api/sesion` → `{ ok, usuario }` (con sesión).
- Evento SSE `sesion` `{ ok: false, mensaje }`: la sesión caducó o se cerró con
  el panel abierto (se revisa cada minuto); después se corta el flujo y el panel
  va a `/login`.
- `MESA_URL` (o `URL_PUBLICA`), separadas por comas: orígenes admitidos además
  del propio `Host`/`X-Forwarded-Host` en la defensa CSRF por `Origin`.
- El Megáfono: `src/web/megafono.js` interpreta con lo que hay en disco
  (estado, universo, Ajustes guardados) y el orquestador recibe la
  interpretación por el canal interno `comando('megafono', { texto },
  { interpretacion })`, la **revalida** (`megafono.revalidar`) contra el estado
  de ese momento y no vuelve a llamar al LLM. Una `interpretacion` que venga en
  el cuerpo de una petición se borra.
- `GET /sw.js` se sirve con la versión dentro (`VERSION` + huella de la carcasa).

**Login** (solo en modo web; el modo local sigue como está):

- `GET /login` página propia con el estilo del panel; `POST /api/login`
  `{ usuario, clave }` → cookie de sesión; `POST /api/logout`.
- Contraseñas con `crypto.scrypt` (sal de 16 bytes, N=2^15, r=8, p=1) y
  comparación con `timingSafeEqual`; la guarda D en `mesa_usuarios`.
- Sesión: 32 bytes aleatorios en base64url en la cookie `mesa_sesion`
  (`HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=30 días`). En la base se
  guarda solo su SHA-256. Se renueva el uso (`ultima`) como mucho una vez por
  minuto.
- Freno: 5 fallos por IP en 15 min o 20 por usuario en 1 h → 429 con el tiempo de
  espera. La IP sale de `X-Forwarded-For`, **último valor** (el que añade
  LiteSpeed, único proxy de confianza; los de delante los escribe el cliente).
  El freno por usuario no se aplica a una IP desde la que ese usuario entró bien
  en los últimos 7 días (si no, cualquiera que sepa el nombre deja a Eduardo
  fuera); a esa IP le sigue valiendo el de 5 por IP. El intento se apunta como
  fallo **antes** de comprobar la clave (`reservarIntento`) y se corrige a bueno
  si entra (`resolverIntento`), así una ráfaga a la vez no pasa entera; además,
  una sola comprobación de clave a la vez por IP en cada proceso (la siguiente,
  429).
- Sin sesión: `/`, `/api/*` (salvo `login`, `salud`) y el SSE → a `/login` (HTML)
  o 401 (API). Los estáticos del login, el manifest y los iconos son públicos.
- Cabeceras de seguridad en modo web: `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Content-Security-Policy` con `frame-ancestors 'none'` y solo recursos propios.
  Siguen las protecciones que ya hay (CSRF por Origin, JSON obligatorio, tamaños).
- «Cerrar sesión» en Ajustes.

**PWA:**

- `web/manifest.webmanifest`: `name` «Mesa de trading», `short_name` «Mesa»,
  `lang` es, `start_url` y `scope` «/», `display` standalone, colores `#0f1424`,
  iconos 192 y 512 (y 512 maskable).
- `web/sw.js`: caché de la «carcasa» (html, css, js, iconos) con versión;
  **nunca** cachea `/api/*` ni el SSE; sin red, la navegación cae en
  `web/sin-conexion.html`. Al publicar una versión nueva se actualiza sola.
- iOS: `apple-touch-icon` 180, `apple-mobile-web-app-capable`, barra de estado, y
  una pista «Compartir → Añadir a pantalla de inicio» la primera vez en Safari.
- Iconos PNG generados por `scripts/generar-iconos.js` (con `zlib`, sin
  dependencias) a partir del cubo isométrico del panel, y versionados.

---

## W4. Base de datos y despliegue (D)

```js
// src/bd/conexion.js
function configuracionBD(entorno = process.env) → { host, port, user, password, database } | null   // DB_HOST, DB_PUERTO, DB_USUARIO, DB_CLAVE, DB_NOMBRE
function obtenerPool(config) → Pool | null      // mysql2/promise, perezoso, uno por proceso
async function cerrarPool()
// src/bd/usuarios.js
async function crearUsuario(pool, { usuario, clave }) ; async function comprobarClave(pool, { usuario, clave }) → { ok, usuarioId }
// src/bd/sesiones.js
async function crearSesion(pool, { usuarioId, ip, agente }) → { token, expira }
async function leerSesion(pool, token) → { usuarioId, usuario, expira } | null
async function cerrarSesion(pool, token) ; async function anotarIntento(pool, { ip, usuario, ok }) ; async function frenado(pool, { ip, usuario }) → { frenado, esperaSeg }
async function reservarIntento(pool, { ip, usuario }) → { frenado, esperaSeg, id }   // INSERT como fallo y luego cuenta sin el suyo; frenado → borra su fila
async function resolverIntento(pool, { id, ok })                                     // el login bueno lo marca ok = 1
// src/bd/espejo.js
async function sincronizar(config) → { copiados, fuentes }   // registros JSONL → mesa_registros, idempotente
```

Añadido por D al construirlo (30-sep-2026), compatible con las firmas de arriba:
`src/bd/tablas.js` (`sqlTablas()`, `crearTablas(pool) → { existian, creadas }`,
el SQL que comparten el script y las pruebas); `cambiarClave` (cierra las
sesiones del usuario) y `existeUsuario` en `usuarios.js`, con contraseña mínima
de 12 caracteres y hash autodescrito `scrypt$ln=15,r=8,p=1$sal$clave`; un
`ahora` opcional (reloj de infraestructura) en sesiones y usuarios;
`sincronizar(config, { pool, entorno, tablas, maxBytes })` con su propio
cerrojo `data/.espejo` (sale con `{ ocupado: true }` si otro copia) y un tope de
4 MB por fuente y llamada; `frenado` usa `evaluarFreno` de `src/web/freno.js`
(una sola regla para la base y la memoria). Caso conocido: `scripts/probar-bd.js`.

Tablas (prefijo `mesa_`, InnoDB, utf8mb4), creadas por `scripts/crear-tablas.js`
(idempotente, `CREATE TABLE IF NOT EXISTS`; imprime el SQL antes y pide
confirmación, salvo `--si`):

```sql
mesa_usuarios  (id INT PK AI, usuario VARCHAR(64) UNIQUE, hash VARCHAR(255), creado DATETIME, ultimo_acceso DATETIME NULL)
mesa_sesiones  (id CHAR(64) PK /* sha256 */, usuario_id INT, creada DATETIME, expira DATETIME, ultima DATETIME, ip VARCHAR(64), agente VARCHAR(255), INDEX (expira))
mesa_intentos  (id BIGINT PK AI, ip VARCHAR(64), usuario VARCHAR(64), t DATETIME, ok TINYINT, INDEX (ip, t), INDEX (usuario, t))
mesa_registros (id BIGINT PK AI, fuente VARCHAR(32), linea BIGINT, t BIGINT, datos LONGTEXT, UNIQUE (fuente, linea), INDEX (fuente, t))
mesa_latidos   (id BIGINT PK AI, inicio DATETIME(3), ms INT, ok TINYINT, resumen VARCHAR(255), INDEX (inicio))
```

`fuente` ∈ `operaciones`, `operaciones-sombra`, `ordenes`, `incidentes`,
`llm-costes`, `informes`, `mensajes`, `latidos`, y desde el 30-sep-2026
`noticias`, `historial` y `decisiones` (ARQUITECTURA §6.10). `linea` = número de línea en su
JSONL: por eso la copia es idempotente. Las posiciones copiadas van en
`data/espejo.json`.

`scripts/crear-usuario.js`: pide usuario y contraseña por teclado (sin eco, y
dos veces la contraseña), guarda solo el hash y **nunca** escribe la contraseña en
ningún sitio.

**Despliegue** (`.github/workflows/desplegar-mesa.yml`, calcado del del portal):
`workflow_dispatch` con modo `probar` (por defecto: `npm test` con un servicio
MariaDB 11.4 para las pruebas de base de datos, y `rsync --dry-run` enseñando qué
cambiaría) o `subir` (rsync de `mesa-trading/` sin `data/`, `.env`,
`node_modules/`, `data-demo/`; escribe `VERSION` con el commit; `npm install
--omit=dev` con el Node de la app; `tmp/restart.txt`; comprueba
`/api/salud` y que `version` es la del commit). Secretos: `MESA_SSH_KEY`,
`MESA_SSH_HOST`, `MESA_SSH_USER`, `MESA_KNOWN_HOSTS`, `MESA_RUTA`, `MESA_URL`, y
un asistente `.github/scripts/secretos-mesa.sh` como el del portal.

`docs/06-app-web.md`: el paso a paso para Eduardo y para la sesión de Claude que
tenga acceso SSH. Incluye: subdominio y SSL; base de datos y usuario en cPanel;
«Setup Node.js App» (Node 22, carpeta, fichero de arranque `src/web.js`, «Run NPM
Install»); `.env` del servidor (modo, claves de Alpaca y de Claude, `DB_*`); tablas;
usuario del panel; las dos líneas del crontab (latido cada minuto y laboratorio
los lunes) con la ruta al Node de la app; comprobación por `/api/salud`; cómo
instalarla en el móvil; y cómo parar todo.

---

## W5. Pruebas obligatorias

- **M:** latido a latido = continuo (W2); cerrojo: dos `conLaMesa` a la vez →
  uno ejecuta y el otro sale «ocupado»; una excepción dentro de `fn` suelta el
  cerrojo; el vigía corta un latido colgado; el laboratorio fuera de banda se
  incorpora una sola vez.
- **W:** sin sesión todo cerrado salvo login, salud y estáticos públicos; login
  bueno, malo y frenado; cookie con sus banderas; CSRF; un comando desde la web
  espera al latido y se ejecuta una vez; el SSE entrega estado y mensajes nuevos
  a partir de los ficheros; la PWA es instalable (manifest válido, SW registrado,
  iconos) comprobado en Chromium real; capturas a 1440×900 y 390×844.
- **D:** con un MariaDB real (en CI un servicio `mariadb:11.4`; en local, si hay
  `TEST_DB_*`): tablas idempotentes, usuario y contraseña, sesiones y caducidad,
  freno, espejo idempotente (dos veces → mismas filas). Sin `TEST_DB_*`, las
  pruebas de base de datos se saltan diciendo por qué (no fallan en el portátil).
- **De extremo a extremo** (tras integrar; `scripts/probar-web.js`, que sin
  `TEST_DB_*` hace solo la parte sin base y lo dice): 3 procesos web en 3 puertos sobre la
  misma carpeta y la misma base, más un bucle que lanza `scripts/latido.js`
  (sintético, 5 min por latido) cada pocos segundos; dos órdenes a la vez desde dos
  procesos se ejecutan en serie y una sola vez; el kill cierra todo y el latido
  siguiente sigue bloqueado; matar la web a mitad no rompe nada; Σ puestos =
  bróker en todo momento.
