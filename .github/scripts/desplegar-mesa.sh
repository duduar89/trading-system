#!/usr/bin/env bash
#
# Despliegue de la mesa de trading (mesa-trading/) al cPanel, con rsync por SSH.
# Lo lanza .github/workflows/desplegar-mesa.yml cuando las pruebas ya han pasado.
# Contrato: mesa-trading/docs/ARQUITECTURA-WEB.md, W4. Paso a paso: mesa-trading/docs/06-app-web.md.
#
#   1. comprueba la conexión, que existe la carpeta de la app y su Node (Setup Node.js App);
#   2. escribe VERSION con el commit y sube mesa-trading/ SIN data/, .env, node_modules/ ni
#      data-demo/ (lo que sustituye queda en ~/respaldo-mesa/<fecha>-<commit>);
#   3. npm install --omit=dev con el Node de la app;
#   4. pide el reinicio (tmp/restart.txt) y mata los procesos huérfanos de la mesa;
#   5. comprueba, desde DENTRO del servidor, que /api/salud contesta con la versión nueva.
#
# MODO=probar (el de por defecto) hace el paso 1 y ENSEÑA lo que cambiaría el 2 con
# `rsync --dry-run`. No toca nada del servidor. MODO=subir lo hace de verdad.
#
# LO QUE NO HACE NUNCA: `--delete`. En la carpeta de la app viven cosas que git no tiene y
# que son la memoria del fondo (data/: estado, bróker simulado, registros, incidentes) y sus
# claves (.env). Un fichero que se quite del repositorio se queda arriba hasta que alguien lo
# borre a mano; eso es mejor que el riesgo contrario.
#
# Tampoco toca la base de datos, el .env del servidor ni el crontab: eso va aparte
# (docs/06-app-web.md). Si una versión nueva necesita tablas nuevas, se crean ANTES de subir.
#
# Variables (las pone el workflow): SSH_HOST, SSH_USER, RUTA (carpeta de la app respecto al
# home, p. ej. mesa-trading), URL (https://mesa.brainstormersagency.es), MODO, MOTIVO.
# Se ejecuta desde la carpeta mesa-trading/ del repositorio.
set -euo pipefail

MODO="${MODO:-probar}"
MOTIVO="${MOTIVO:-}"
: "${SSH_HOST:?Falta SSH_HOST}"
: "${SSH_USER:?Falta SSH_USER}"
: "${RUTA:?Falta RUTA (carpeta de la app respecto al home, p. ej. mesa-trading)}"
: "${URL:?Falta URL (p. ej. https://mesa.brainstormersagency.es)}"
URL="${URL%/}"
NODE_VERSION_APP="${NODE_VERSION_APP:-22}"
case "$MODO" in
  probar | subir) ;;
  *) echo "MODO tiene que ser «probar» o «subir», no «$MODO»" >&2; exit 2 ;;
esac
case "$RUTA" in
  /* | *..* | '' ) echo "RUTA tiene que ser relativa al home y sin «..» (p. ej. mesa-trading), no «$RUTA»" >&2; exit 2 ;;
esac
[ -f package.json ] && [ -f src/web.js ] || { echo "Esto se ejecuta desde mesa-trading/ (no encuentro package.json y src/web.js)" >&2; exit 2; }

CLAVE="${SSH_KEY_FILE:-$HOME/.ssh/mesa_deploy_key}"
SSH_OPTS=(-i "$CLAVE" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 -o ServerAliveInterval=15)
ssh_srv() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }
DESTINO="$SSH_USER@$SSH_HOST:$RUTA/"
T0=$(date +%s)

paso() { printf '\n== %s ==\n' "$1"; }

# ---------------------------------------------------------------- 1. conexión
paso "1. Conexión con el servidor (modo: $MODO)"
ssh_srv "echo \"conectado a \$(hostname) como \$(whoami)\"; rsync --version | head -1"
HOME_REMOTO=$(ssh_srv 'printf %s "$HOME"')
VENV="$HOME_REMOTO/nodevenv/$RUTA/$NODE_VERSION_APP"
if ! ssh_srv "test -d \"\$HOME/$RUTA\""; then
  echo "NO EXISTE ~/$RUTA en el servidor. Primero hay que crear la app en cPanel → Setup Node.js App" >&2
  echo "(carpeta $RUTA, Node $NODE_VERSION_APP, fichero de arranque src/web.js). Ver docs/06-app-web.md." >&2
  exit 3
fi
echo "carpeta de la app: ~/$RUTA"
if ssh_srv "test -x \"$VENV/bin/node\""; then
  echo "Node de la app: $(ssh_srv "\"$VENV/bin/node\" --version") en $VENV"
else
  echo "AVISO: no encuentro $VENV/bin/node. ¿Está creada la app en Setup Node.js App con Node $NODE_VERSION_APP?" >&2
  [ "$MODO" = probar ] || exit 3
fi
ARRIBA=$(ssh_srv "cat \"\$HOME/$RUTA/VERSION\" 2>/dev/null" || true)
echo "versión que hay arriba: ${ARRIBA:-ninguna}"

# ---------------------------------------------------------------- 2. subir (o enseñar)
COMMIT=$(git rev-parse --short=12 HEAD)
printf '%s\n' "$COMMIT" > VERSION
echo "versión nueva: $COMMIT (${GITHUB_REF_NAME:-rama local})${MOTIVO:+ · $MOTIVO}"

RSYNC=(rsync -rlptz --checksum --omit-dir-times --itemize-changes --stats -e "ssh ${SSH_OPTS[*]}")
# Anclados a la raíz de mesa-trading/ (la barra inicial): una carpeta «data» dentro de
# src/ sí se sube; la de la raíz nunca.
EXCLUIR=(--exclude='/data/' --exclude='/data-demo/' --exclude='/.env' --exclude='/node_modules/'
         --exclude='/tmp/' --exclude='.git/' --exclude='*.log' --exclude='/.htaccess')
if [ "$MODO" = probar ]; then
  RSYNC+=(--dry-run)
else
  RESPALDO="$HOME_REMOTO/respaldo-mesa/$(date -u +%Y%m%d-%H%M%S)-$COMMIT"
  ssh_srv "mkdir -p \"$RESPALDO\""
  RSYNC+=(--backup "--backup-dir=$RESPALDO")
fi

paso "2. Ficheros"
if ! SALIDA=$("${RSYNC[@]}" "${EXCLUIR[@]}" ./ "$DESTINO" 2>&1); then
  printf '%s\n' "$SALIDA" >&2
  echo "rsync falló" >&2
  exit 5
fi
N=$(printf '%s\n' "$SALIDA" | grep -c '^<f' || true)
{ printf '%s\n' "$SALIDA" | grep -E '^<f' || true; } | head -80 | sed 's/^/     /'
echo "     ($N fichero(s) distintos de lo que hay arriba)"

if [ "$MODO" = probar ]; then
  paso "Resumen (MODO probar: NO se ha tocado nada del servidor)"
  echo "  Habría subido $N fichero(s) y la versión sería $COMMIT."
  echo "  Se compara por CONTENIDO (--checksum), no por fecha. VERSION siempre sale: es el commit."
  echo "  Nunca se suben ni se borran data/, .env, node_modules/ ni data-demo/."
  exit 0
fi
echo "     lo sustituido está en $RESPALDO"

# ---------------------------------------------------------------- 3. dependencias
paso "3. Dependencias (npm install --omit=dev con el Node de la app)"
ssh_srv "set -e; source \"$VENV/bin/activate\"; cd \"\$HOME/$RUTA\"; npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5"

# ---------------------------------------------------------------- 4. reiniciar
paso "4. Reinicio"
ssh_srv "mkdir -p \"\$HOME/$RUTA/tmp\" && printf '%s\n%s\n' '$COMMIT' \"\$(date -u +%FT%TZ)\" > \"\$HOME/$RUTA/tmp/restart.txt\""
echo "tmp/restart.txt escrito"
# Un proceso viejo que sobrevive al reinicio sigue sirviendo el código de antes. Solo los
# huérfanos (PPID = 1) de ESTA app; los que cuelgan de LiteSpeed los recicla él. El filtro por
# `lsnode:` hace que la propia conexión SSH no pueda matarse a sí misma, y el de la ruta, que
# nunca se toque el portal ni otra app.
HUERFANOS=$(ssh_srv bash -s -- "$HOME_REMOTO/$RUTA" <<'REMOTO'
P=$(ps -eo pid,ppid,args | awk -v r="$1" '$2==1 && /lsnode:/ && index($0, r) {print $1}')
if [ -n "$P" ]; then echo "$P" | xargs -r kill 2>/dev/null || true; echo "$P" | tr "\n" " "; fi
REMOTO
) || true
if [ -n "${HUERFANOS// /}" ]; then echo "procesos huérfanos parados: $HUERFANOS"; else echo "huérfanos: ninguno"; fi

# ---------------------------------------------------------------- 5. comprobar
paso "5. Comprobación de /api/salud (desde el propio servidor)"
OK=0
for i in $(seq 1 20); do
  sleep 3
  JSON=$(ssh_srv "curl -s -m 10 '$URL/api/salud?t=$(date +%s)'" 2>/dev/null || true)
  LECTURA=$(printf '%s' "$JSON" | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try { const j = JSON.parse(s); console.log([j.version, j.ok, j.ultimoLatidoHaceSeg, j.modo].map(v => v === null || v === undefined ? "" : String(v)).join("|")); } catch { console.log(""); }
    });' || true)
  if [ -z "$LECTURA" ]; then echo "  esperando a la app… ($((i * 3)) s)"; continue; fi
  IFS="|" read -r V SALUD HACE MODO_APP <<<"$LECTURA"
  if [ "$V" = "$COMMIT" ]; then
    echo "  ✓ la app sirve la versión $V (modo $MODO_APP)"
    if [ "$SALUD" = true ]; then
      echo "  ✓ último latido hace ${HACE} s"
    else
      echo "  ⚠ /api/salud dice que el último latido tiene ${HACE:-?} s (o no hay ninguno)."
      echo "    Si es la primera vez, falta el crontab (docs/06-app-web.md); si no, mira data/cron-latido.log."
    fi
    OK=1
    break
  fi
  echo "  aún no: versión «$V» (esperada $COMMIT)"
done

paso "Resumen"
echo "  Versión:  $COMMIT"
echo "  Ficheros: $N"
echo "  Respaldo: $RESPALDO"
echo "  Tardó:    $(( $(date +%s) - T0 )) s"
if [ "$OK" = 1 ]; then
  echo "  Web:      ✓ $URL sirve la versión nueva."
else
  echo "  Web:      ✗ NO se ha podido confirmar la versión $COMMIT en 60 s." >&2
  echo "            Los ficheros están subidos y el reinicio pedido. Mira $URL/api/salud" >&2
  echo "            o reinicia desde cPanel → Setup Node.js App." >&2
  exit 6
fi
