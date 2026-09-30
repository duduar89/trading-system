# La mesa como app web en el cPanel

Cómo se monta, se actualiza y se para la versión web de la mesa de trading: la
que vive en **mesa.brainstormersagency.es**, se entra con usuario y contraseña
y se instala en el móvil. El contrato técnico está en `ARQUITECTURA-WEB.md`;
esto es el paso a paso.

Hay dos lectores:

- **Eduardo**: los pasos marcados **(Eduardo, cPanel)** son clics en cPanel o
  en el móvil. No hace falta programar nada.
- **La sesión de Claude con acceso SSH**: los pasos marcados **(Claude, SSH)**
  traen las órdenes exactas. Donde pone `USUARIO` va el usuario de cPanel
  (`whoami` en el servidor). Antes de escribir en la base de producción o en el
  crontab, se enseña a Eduardo lo que se va a hacer y se espera su sí.

Sigue siendo **solo papel**: cuenta paper de Alpaca o bróker simulado. Nada de
esta guía acerca la mesa al dinero real.

---

## Cómo funciona, en una mirada

| Pieza | Qué es | Dónde vive |
|---|---|---|
| El **motor** | `scripts/latido.js`: cada minuto el cron lo lanza, da **un** paso de la mesa, guarda y se cierra | crontab de cPanel |
| El **laboratorio** | `scripts/laboratorio.js`: la evaluación larga de hipótesis, los lunes | crontab de cPanel |
| La **web** | `src/web.js`: enseña el panel y recibe los botones. No opera sola | Setup Node.js App |
| La **memoria del fondo** | `data/` (estado, bróker simulado, registros) | disco del servidor, en `~/mesa-trading/data` |
| La **base de datos** | usuarios, sesiones, intentos de login y una copia consultable de los registros | MariaDB de cPanel |

El hosting (LiteSpeed) apaga la web cuando nadie la mira y la vuelve a
encender con la siguiente visita. Por eso el motor va por cron y no dentro de
la web: aunque nadie abra el panel, la mesa sigue latiendo. Si la base de datos
falla, la mesa opera igual; lo que no se puede es entrar al panel.

---

## Montaje, una sola vez

Orden: 1 → 2 → 3 → despliegue → 4 → 5 → 6 → 7 → 8. Cada paso se comprueba
antes del siguiente.

### 1. Subdominio y SSL — (Eduardo, cPanel)

1. cPanel → **Dominios** → **Crear un dominio nuevo**.
2. Dominio: `mesa.brainstormersagency.es`. Desmarca «Compartir la raíz del
   documento» si aparece. La raíz del documento que propone
   (`mesa.brainstormersagency.es`) vale: la app **no** va ahí, va en
   `~/mesa-trading`.
3. cPanel → **SSL/TLS Status** → marca `mesa.brainstormersagency.es` →
   **Run AutoSSL**. Espera a que salga el candado verde (unos minutos).

Sin HTTPS no se puede entrar: la cookie de sesión solo viaja cifrada.

### 2. Base de datos y su usuario — (Eduardo, cPanel) o (Claude, SSH)

Una base **propia** de la mesa, separada de la del portal.

**En cPanel:** **Bases de datos MySQL®**:

1. «Crear nueva base de datos»: `mesa` (cPanel le pone delante el prefijo, y
   queda `USUARIO_mesa`).
2. «Agregar nuevo usuario»: `mesa` (queda `USUARIO_mesa`), contraseña con el
   **generador** de cPanel. Cópiala solo al `.env` del paso 4; no la escribas en
   ningún otro sitio ni la pegues en una conversación.
3. «Agregar usuario a la base de datos»: ese usuario a esa base, **TODOS LOS
   PRIVILEGIOS**. Solo en esa base.

**Por SSH (Claude)**, generando la contraseña en el propio servidor, sin que
aparezca en pantalla, y dejándola directamente en el `.env` (paso 4):

```bash
U=$(whoami)
CLAVE_BD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)
uapi Mysql create_database name="${U}_mesa" >/dev/null
uapi Mysql create_user name="${U}_mesa" password="$CLAVE_BD" >/dev/null
uapi Mysql set_privileges_on_database user="${U}_mesa" database="${U}_mesa" privileges='ALL PRIVILEGES' >/dev/null
umask 077; mkdir -p ~/mesa-trading
printf 'DB_HOST=localhost\nDB_PUERTO=3306\nDB_USUARIO=%s_mesa\nDB_CLAVE=%s\nDB_NOMBRE=%s_mesa\n' "$U" "$CLAVE_BD" "$U" >> ~/mesa-trading/.env
unset CLAVE_BD
uapi --output=json Mysql list_databases | grep -o "\"${U}_mesa\"" && echo "base creada"
```

### 3. La app de Node — (Eduardo, cPanel)

cPanel → **Setup Node.js App** → **Create Application**:

| Campo | Valor |
|---|---|
| Node.js version | **22** (la 22.x más alta que ofrezca) |
| Application mode | Production |
| Application root | `mesa-trading` |
| Application URL | `mesa.brainstormersagency.es` |
| Application startup file | `src/web.js` |

**Create**. Esto crea `~/mesa-trading` y el Node de la app en
`~/nodevenv/mesa-trading/22/`. Todavía no hay código: lo sube el despliegue.

### Primer despliegue — (Eduardo o Claude, GitHub)

Una vez, antes del primero, los secretos: desde el Git Bash del portátil, en la
carpeta `trading-system`:

```bash
bash .github/scripts/secretos-mesa.sh
```

Crea una clave SSH solo para esto, la autoriza en el servidor y guarda en
GitHub `MESA_SSH_KEY`, `MESA_SSH_HOST`, `MESA_SSH_USER`, `MESA_KNOWN_HOSTS`,
`MESA_RUTA` (`mesa-trading`) y `MESA_URL` (`https://mesa.brainstormersagency.es`).
Nadie ve ninguna clave.

Luego GitHub → **Actions** → **Mesa de trading · desplegar** → **Run workflow**:

1. modo **probar**: pruebas completas (con un MariaDB de prueba) y la lista de
   lo que se subiría. No toca el servidor. Se lee la lista.
2. modo **subir**: sube el código, ejecuta `npm install --omit=dev` con el Node
   de la app, reinicia y comprueba `/api/salud`. La primera vez avisa de que no
   hay latidos: es normal hasta el paso 7.

Si prefieres hacerlo a mano: Setup Node.js App → la app → **Run NPM Install**
tras subir los ficheros.

### 4. El `.env` del servidor — (Claude, SSH; Eduardo pone sus claves)

`~/mesa-trading/.env`. **Nunca** va a git y el despliegue nunca lo toca.

```ini
# Modo: con claves de Alpaca → cuenta PAPER de Alpaca; sin ellas → bróker
# simulado con precios reales. Qué modo arranca en el servidor lo decide Eduardo.
# MODO=alpaca
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=

# Claude (opcional) y su tope diario en dólares
ANTHROPIC_API_KEY=
LLM_PRESUPUESTO_DIA_USD=1

# Dirección pública (la usa la web para aceptar solo peticiones de sí misma)
MESA_URL=https://mesa.brainstormersagency.es

# Base de datos (paso 2)
DB_HOST=localhost
DB_PUERTO=3306
DB_USUARIO=USUARIO_mesa
DB_CLAVE=
DB_NOMBRE=USUARIO_mesa
```

**(Claude, SSH)** — dejar el esqueleto sin pisar lo que ya haya (las líneas
`DB_*` del paso 2), con permisos solo del dueño, y crear la carpeta de datos
(el cron escribe su registro ahí y, si no existe, el cron no arranca):

```bash
cd ~/mesa-trading
touch .env && chmod 600 .env
for linea in 'MODO=' 'ALPACA_API_KEY_ID=' 'ALPACA_API_SECRET_KEY=' 'ANTHROPIC_API_KEY=' 'LLM_PRESUPUESTO_DIA_USD=1' 'MESA_URL=https://mesa.brainstormersagency.es'; do
  grep -q "^${linea%%=*}=" .env || printf '%s\n' "$linea" >> .env
done
mkdir -p data
sed -E 's/^([A-Z_]*(KEY|SECRET|CLAVE)[A-Z_]*)=.+/\1=***/' .env   # comprobar sin enseñar secretos
```

**(Eduardo, cPanel)** — las claves de Alpaca (paper) y de Claude las pega él:
**Administrador de archivos** → `mesa-trading` → activar «Mostrar archivos
ocultos» en Configuración → `.env` → **Editar**. Nunca por una conversación.

Después de cambiar el `.env`: Setup Node.js App → la app → **Restart** (el
latido lo lee solo en cada vuelta).

### 5. Las tablas — (Claude, SSH, con el sí de Eduardo)

```bash
cd ~/mesa-trading && source ~/nodevenv/mesa-trading/22/bin/activate
node scripts/crear-tablas.js
```

Enseña el SQL (cinco `CREATE TABLE IF NOT EXISTS mesa_…`) y pide que se escriba
«si». Es idempotente: repetirlo no toca las tablas que ya existen ni sus datos,
y no borra ni altera nada. Sin terminal interactiva: `--si`, después de haber
enseñado el SQL a Eduardo.

### 6. El usuario del panel — (Eduardo, con un enlace de un solo uso)

**Lo normal: el enlace de alta.** Claude lanza en el servidor
`node scripts/crear-alta.js` y le pasa a Eduardo el enlace que sale
(`https://mesa.brainstormersagency.es/alta#…`). Eduardo lo abre, elige usuario
y contraseña (12 caracteres o más, dos veces) y queda dentro. El enlace vale
**una vez** y caduca en **24 h**; crear otro anula el anterior. Si el usuario ya
existe, le cambia la contraseña y cierra sus sesiones: sirve también para
«olvidé la contraseña».

- En el servidor solo queda la huella del enlace (`data/alta.json`, permisos
  600), nunca el enlace.
- La parte de detrás de `#` no viaja al servidor al abrir la página: no queda
  en el registro de accesos. Por el camino de GitHub Actions, el enlace sale
  cifrado con una clave que solo tiene la sesión de Claude.

**A mano, sin enlace:** cPanel → **Terminal**:

```bash
cd ~/mesa-trading && source ~/nodevenv/mesa-trading/22/bin/activate
node scripts/crear-usuario.js
```

Pide el usuario (por ejemplo `eduardo`) y la contraseña **dos veces**; al
escribirla no se ve nada, es normal. Al menos 12 caracteres. En la base solo
queda el hash (scrypt): ni Claude ni nadie puede leerla.

- **Olvidé la contraseña**: lo mismo con el mismo usuario; pregunta si se
  cambia. Cambiarla cierra todas las sesiones abiertas.
- **Sin teclado** (desde un script): la contraseña se lee de una variable de
  entorno, que el script nunca imprime:

  ```bash
  read -rs MESA_CLAVE_NUEVA && export MESA_CLAVE_NUEVA
  node scripts/crear-usuario.js --usuario=eduardo --clave-desde-entorno=MESA_CLAVE_NUEVA   # --cambiar si ya existe
  unset MESA_CLAVE_NUEVA
  ```

  No hay `--clave=…` a propósito: quedaría en el historial de la terminal.

### 7. El crontab — (Eduardo, cPanel → Cron Jobs) o (Claude, SSH, con su sí)

Dos líneas. Cambia `USUARIO` por el tuyo. Van con el Node **de la app** (el de
`nodevenv`), no con el `node` del sistema, que puede ser otra versión:

```cron
* * * * * cd /home/USUARIO/mesa-trading && UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--v8-pool-size=1 /home/USUARIO/nodevenv/mesa-trading/22/bin/node scripts/latido.js >> /home/USUARIO/mesa-trading/data/cron-latido.log 2>&1
17 6 * * 1 cd /home/USUARIO/mesa-trading && UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--v8-pool-size=1 /home/USUARIO/nodevenv/mesa-trading/22/bin/node scripts/laboratorio.js >> /home/USUARIO/mesa-trading/data/cron-laboratorio.log 2>&1
```

- La primera: **el latido, cada minuto**. Si el anterior aún no ha terminado,
  el nuevo ve el cerrojo y sale sin hacer nada.
- La segunda: **el laboratorio, los lunes a las 6:17** (hora del servidor). El
  latido siguiente incorpora lo que haya encontrado.
- `UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--v8-pool-size=1`: el hosting (CloudLinux)
  limita cuántos hilos puede tener tu cuenta a la vez, y Node abre varios por
  defecto. Sin esto, un latido que coincide con la web y con el portal puede
  fallar al arrancar.

En cPanel → **Cron Jobs**: «Configuración común» → *Once Per Minute* para la
primera; para la segunda, minuto `17`, hora `6`, día `*`, mes `*`, día de la
semana `1`. Pega cada orden en «Comando».

**(Claude, SSH)** — añadirlas sin tocar las del portal:

```bash
U=$(whoami); N=/home/$U/nodevenv/mesa-trading/22/bin/node; A=/home/$U/mesa-trading
test -x "$N" && mkdir -p "$A/data"
( crontab -l 2>/dev/null | grep -v 'mesa-trading/scripts/\|mesa-trading && ' ;
  echo "* * * * * cd $A && UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--v8-pool-size=1 $N scripts/latido.js >> $A/data/cron-latido.log 2>&1" ;
  echo "17 6 * * 1 cd $A && UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--v8-pool-size=1 $N scripts/laboratorio.js >> $A/data/cron-laboratorio.log 2>&1" ) | crontab -
crontab -l | grep mesa-trading
```

Antes, `crontab -l > ~/crontab-antes-de-la-mesa.txt` por si hay que volver.

### 8. Comprobar que está viva — (cualquiera)

Al cabo de dos o tres minutos:

```bash
curl -s https://mesa.brainstormersagency.es/api/salud
```

Bien: `{"ok":true,"version":"<commit>","ultimoLatidoHaceSeg":37,"modo":"alpaca"}`.
Con `"ok":false` (y código 503) el último latido tiene más de 3 minutos: mira
`data/cron-latido.log` (ver «Si algo va mal»). `/api/salud` no enseña nada del
fondo y no pide sesión: sirve para vigilar y para comprobar un despliegue.

Después, abre `https://mesa.brainstormersagency.es` en el navegador: tiene que
salir la pantalla de entrada. Entra con el usuario del paso 6.

---

## Instalarla en el móvil — (Eduardo)

Primero entra una vez desde el navegador del móvil con tu usuario.

- **iPhone (Safari)**: botón **Compartir** (el cuadrado con la flecha) →
  **Añadir a pantalla de inicio** → Añadir. La primera vez el propio panel te
  lo recuerda.
- **Android (Chrome)**: menú **⋮** → **Instalar aplicación** (o «Añadir a
  pantalla de inicio»).

Queda un icono «Mesa» que abre el panel a pantalla completa. Sin cobertura
enseña un aviso de «sin conexión»; los números siempre vienen del servidor.

---

## Actualizar — (Eduardo o Claude, GitHub)

Siempre por **Actions → Mesa de trading · desplegar**: primero **probar**,
leer la lista, luego **subir**. Lo que se publica es exactamente lo commiteado
en la rama elegida al pulsar «Run workflow».

- Nunca sube ni borra `data/`, `.env`, `node_modules/` ni `data-demo/`.
- Nunca borra ficheros del servidor: uno que se quite del repositorio se queda
  arriba hasta que alguien lo borre a mano.
- Lo que sustituye queda en `~/respaldo-mesa/<fecha>-<commit>/`.
- **Vuelta atrás**: volver a lanzar **subir** desde el commit anterior, o
  copiar de `~/respaldo-mesa/…` a `~/mesa-trading` y tocar
  `~/mesa-trading/tmp/restart.txt`.
- No toca la base de datos, el `.env` ni el crontab. Si una versión nueva trae
  tablas nuevas, se crean **antes** de subir (paso 5).
- La mesa no se interrumpe: el latido del minuto siguiente ya corre con el
  código nuevo, y el estado sigue en `data/`.

---

## Parar todo

De menos a más. Cada nivel incluye el anterior.

1. **Parar de operar, sin apagar nada**: en el panel, **Pausar** (no abre
   posiciones nuevas) o **Kill** (cierra todo y bloquea; los latidos siguientes
   siguen bloqueados hasta reabrir). Es lo primero ante cualquier duda.
2. **Parar el motor**: cPanel → **Cron Jobs** → borra (o edita y pon `#`
   delante de) las dos líneas de `mesa-trading`. Sin latido, la mesa no hace
   nada; las posiciones que haya en la cuenta paper de Alpaca siguen abiertas
   tal cual. El panel sigue enseñando lo último, con el aviso de cifras sin
   actualizar. (Claude, SSH: `crontab -l | grep -v mesa-trading | crontab -`,
   guardando antes `crontab -l > ~/crontab-antes.txt`.)
3. **Apagar la web**: cPanel → **Setup Node.js App** → la app → **Stop App**.
   Nadie puede entrar al panel.
4. **Desmontarlo del todo** (solo si Eduardo lo decide): antes, copia de
   `~/mesa-trading/data/` (es la historia del fondo). Luego se borra la app en
   Setup Node.js App, la base `USUARIO_mesa` y su usuario, y el subdominio.

Para volver a arrancar: el inverso (Start App, las dos líneas del cron, y
Reabrir en el panel si se hizo Kill).

---

## Si algo va mal

| Síntoma | Qué mirar |
|---|---|
| `/api/salud` con `"ok":false` | `tail -20 ~/mesa-trading/data/cron-latido.log`. Vacío o sin cambios: el cron no corre (ruta del Node, `data/` sin crear). «Latido omitido»: otro latido o un botón tenía el cerrojo; si se repite siempre, mira `data/.proceso`. «CERROJO VIEJO» (el latido sale con código 2): lleva cogido más de 5 min; si no hay otra mesa en marcha, es huérfano y se puede borrar. `latidosMalosSeguidos` en `/api/salud` dice cuántos latidos seguidos no han sido buenos. |
| No se puede entrar (el login da error 503) | `DB_*` del `.env` (paso 4) y que existan las tablas (paso 5). Tras cambiar el `.env`, Restart de la app. |
| El login pide esperar unos minutos | Cinco fallos seguidos desde la misma conexión en 15 minutos (o 20 del mismo usuario en una hora). Se pasa solo. |
| «La mesa está en pleno latido» al pulsar un botón | Normal si coincide con un latido largo (el comité). Vuelve a pulsar. |
| Los registros no llegan a la base | `data/espejo-fallos.jsonl`. La mesa opera igual; la copia se pone al día sola en el latido siguiente (`data/espejo.json` guarda por dónde va). |
| El despliegue falla en «Comprobación» | Los ficheros ya están arriba. Mira `/api/salud` y reinicia desde Setup Node.js App. |

Los registros de cron (`data/cron-*.log`) crecen una línea por minuto (unos
20 MB al año). Se pueden vaciar cuando se quiera: `: > data/cron-latido.log`.
