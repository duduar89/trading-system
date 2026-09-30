# Despliegue: portátil, GitHub Actions y cPanel

La app se prueba en el portátil, se sube a cPanel con GitHub Actions (o desde el portátil con el
mismo script) y cada subida guarda antes una copia de la base.

## 1. En el portátil

Hace falta Node 22 o superior y una MariaDB 10.6 o superior.

1. **Base de datos.** Con Docker, una línea:

   ```bash
   docker run -d --name iemec-mariadb -p 3306:3306 \
     -e MARIADB_ROOT_PASSWORD=raiz -e MARIADB_DATABASE=iemec_dev \
     -e MARIADB_USER=iemec -e MARIADB_PASSWORD=iemec_local mariadb:10.11
   ```

   Para las pruebas, dale también acceso a `iemec_test`:
   `docker exec -it iemec-mariadb mariadb -uroot -praiz -e "CREATE DATABASE iemec_test; GRANT ALL ON iemec_test.* TO 'iemec'@'%'"`.
   Sin Docker vale una MariaDB instalada (XAMPP, Homebrew…) con esa base y ese usuario.
2. **Configuración.** Copia `.env.example` a `.env`. Con los valores del ejemplo ya funciona en local.
3. **Dependencias y base:**

   ```bash
   npm install
   npm run preparar-bd        # migraciones + datos públicos de la clínica
   npm test                   # 591 pruebas; las de base de datos usan iemec_test
   ```
4. **Verla funcionando con datos de ejemplo:**

   ```bash
   node scripts/demo.js       # pacientes, citas y conversaciones INVENTADOS
   npm run build              # compila el panel
   MODO_DEMO=1 npm start      # http://localhost:3004 (en Windows: set MODO_DEMO=1 && npm start)
   ```

   Para tocar el panel con recarga al vuelo: `npm run dev:servidor` en una terminal y `npm run dev`
   en otra (http://localhost:5174).

   Sin `MODO_DEMO`, se entra con passkey. La primera persona se da de alta desde la terminal:
   `npm run invitar -- --email tu@correo --nombre "Tu nombre" --rol direccion` imprime un enlace de un
   solo uso (24 h); ábrelo y crea la passkey (en `localhost` funcionan sin https). El resto del
   equipo, desde «Equipo» en el panel.

## 2. En cPanel (LucusHost), una vez

1. **Subdominio**, por ejemplo `agenda.iemec-clinic.com`, con SSL (AutoSSL).
2. **MariaDB:** crea la base `USUARIO_iemec` y un usuario con todos los permisos sobre ella.
3. **Setup Node.js App:** Node 22, *Application root* `iemec-app`, *Application URL* el
   subdominio, *Application startup file* `servidor/index.js`. Variables de entorno (o un `.env` en
   `~/iemec-app`, que no se sube nunca):

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `URL_PUBLICA` | `https://agenda.iemec-clinic.com` (https: de aquí salen el dominio y el origen de las passkeys; si cambia, las passkeys hay que crearlas otra vez) |
   | `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | los de la base del paso 2 |
   | `CLAVE_CIFRADO` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `SESION_SECRETO` | otra cadena aleatoria de 32 caracteres o más |
   | `PANEL_CLAVE` | opcional: acceso de emergencia de dirección (16+ caracteres; sesión de una hora). Cada uso queda en eventos y el servidor avisa al arrancar mientras esté puesta: quítala cuando todo el equipo tenga su passkey |
   | `MODO_WHATSAPP`, `MODO_IA`, `MODO_GOOGLE`, `MODO_META` | `simulado` hasta tener cuentas; luego `real` |
   | `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` (o `WHATSAPP_WEBHOOK_CLAVE`), `WHATSAPP_NUMERO_ID` | webhook de WhatsApp: ver [`WHATSAPP-Y-LEADS.md`](WHATSAPP-Y-LEADS.md) |
   | `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_TOKEN_PAGINA`, `META_PAGINA_ID` | leads de los formularios de Meta: ídem |
   | `LEADS_CLAVE` | alta de leads de la web y GHL (`POST /api/leads`), 16 caracteres o más |
   | `IA_PROVEEDOR`, `IA_PROYECTO_GCP`, `IA_REGION`, `IA_MODELO`, `IA_MODELO_RESPALDO` | IA real: Claude por Google Vertex en la UE (`vertex`, el proyecto, `eu`, el modelo elegido y el de respaldo si el principal se niega) |

   **Mejor todo en el `.env`:** el cron (paso 4) y el primer enlace (paso 7) son otros procesos,
   lanzados desde la terminal, y no ven las variables de «Setup Node.js App»; solo leen el `.env`
   (`servidor/config.js`). Es el cron el que procesa lo que llega de WhatsApp y de Meta: con
   `MODO_META` sin poner en su `.env`, cada lead de Meta acaba en una tarea para recepción en vez de
   entrar solo.

   **Guarda `CLAVE_CIFRADO` también fuera del servidor** (gestor de contraseñas): sin ella, las
   conversaciones guardadas no se pueden leer.
4. **Cron Jobs** (cada minuto las tareas; cada 15 minutos la copia):

   ```
   * * * * *    . ~/nodevenv/iemec-app/22/bin/activate && cd ~/iemec-app && node servidor/cron.js >> ~/logs/iemec-cron.log 2>&1
   */15 * * * * cd ~/iemec-app && bash scripts/copia-bd.sh cron >> ~/logs/iemec-copias.log 2>&1
   ```

   Para cifrar las copias y mandarlas fuera: `COPIA_CLAVE_FICHERO` (un fichero con una clave, fuera
   de la app) y `COPIA_DESTINO` (un remoto de rclone en otro proveedor de la UE).
5. **Monitor externo** (UptimeRobot o similar) contra `https://agenda.iemec-clinic.com/api/salud`
   cada 5 minutos: mantiene la app despierta y avisa si cae.
6. **Secretos para desplegar:** desde tu terminal, `bash scripts/secretos-despliegue.sh`. Crea una
   clave SSH solo para esto, te dice cómo autorizarla en cPanel y guarda los secretos en GitHub
   (`IEMEC_SSH_KEY`, `IEMEC_SSH_HOST`, `IEMEC_SSH_USER`, `IEMEC_KNOWN_HOSTS`, `IEMEC_DOMINIO`).
7. **Primer acceso al panel:** por SSH, con el Node de la app (como el cron del paso 4; sin activarlo,
   la terminal puede no tener `node` o tener uno antiguo que no lee el `.env`):

   ```bash
   . ~/nodevenv/iemec-app/22/bin/activate && cd ~/iemec-app && node scripts/invitar.js --email direccion@… --nombre "…" --rol direccion
   ```

   Imprime un enlace de un solo uso que caduca a las 24 h. El enlace sale con `URL_PUBLICA` del `.env`
   (la terminal no ve las variables de «Setup Node.js App»): si falta, avisa de que sale con
   `http://localhost:3004`, y con `NODE_ENV=production` y sin https se para sin crear nada. Se abre en
   el móvil de dirección y se crea la passkey. A partir de ahí, el resto del equipo se da de alta desde
   «Equipo» (cada uno con su rol) y, si alguien pierde todas sus passkeys, dirección le manda un enlace
   nuevo desde ahí (o se repite este paso).

## 3. Cada vez que se sube

- **GitHub Actions** → «IEMEC · desplegar» → *Run workflow* → modo `probar` (enseña qué cambiaría)
  y después `subir`. GitHub solo muestra el botón si el workflow está en la rama por defecto.
- **Desde el portátil:** `bash scripts/desplegar.sh probar` y `bash scripts/desplegar.sh subir`
  (lee `~/.iemec-despliegue`, que deja el asistente de secretos).

`subir` hace, en este orden, y se para en el primer fallo:

1. pruebas y compilación del panel;
2. copia de la base en el servidor (`~/respaldo-iemec/bd-antes-de-…`);
3. copia del código actual (`~/respaldo-iemec/build-…tgz`) y subida del nuevo;
4. dependencias (si cambió `package.json`; si una instalación se quedó a medias, lo limpia y
   reintenta);
5. migraciones pendientes;
6. reinicio y comprobación desde dentro del servidor de que `/api/version` da el commit nuevo.

**Volver atrás:** restaurar `build-….tgz` sobre `~/iemec-app` y, si hubo migraciones, la copia
`bd-antes-de-….sql.gz`.

## 4. Copias y restauración

- `bash scripts/copia-bd.sh` hace una copia (cifrada si hay clave).
- `bash scripts/probar-restauracion.sh` restaura la última en una base temporal y cuenta filas.
  **Una vez al mes.** Una copia que nunca se ha restaurado no es una copia.

## 5. Plan B: VPS

Si cPanel se queda corto (F3 con historia clínica, más de 3 clínicas, pruebas del día 1 que fallan),
el mismo script despliega en un VPS: `REINICIAR='pm2 restart iemec'` (o `systemctl restart iemec`)
y `SSH_PUERTO` si no es el 22. El código no depende de nada propio de cPanel.

## Probado

El 30-sep-2026 se desplegó de punta a punta contra un servidor simulado por SSH (usuario aparte,
`.env` de producción, MariaDB): copia previa, subida, `npm install` con recuperación de un
`node_modules` roto, 4 migraciones, reinicio y comprobación del commit (`d8f75f5`). La copia cifrada
y su restauración también están probadas (211 tratamientos, 56 citas, 9 conversaciones).
