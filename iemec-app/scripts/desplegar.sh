#!/usr/bin/env bash
# Despliegue de iemec-app a cPanel por SSH. Lo usan el portátil y GitHub Actions.
#
#   bash scripts/desplegar.sh probar   pruebas + compilar + qué cambiaría (no toca el servidor)
#   bash scripts/desplegar.sh subir    copia de la base, código, migraciones, reinicio y comprobación
#
# Variables (en el portátil, en ~/.iemec-despliegue o exportadas):
#   SSH_HOST, SSH_USER, DOMINIO             obligatorias
#   SSH_CLAVE=~/.ssh/iemec_deploy           clave SSH solo para desplegar
#   APP_DIR=iemec-app                        carpeta de la app en el home del servidor
#   NODE_VENV=~/nodevenv/iemec-app/22/bin/activate
#   SALTAR_PRUEBAS=1                         si ya se pasaron (GitHub Actions)
#   SSH_PUERTO=22                            puerto SSH
#   PROTOCOLO=https                          para comprobar /api/version
#   REINICIAR='…'                            orden de reinicio si no es cPanel (plan B: VPS con pm2/systemd)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "$HOME/.iemec-despliegue" ] && source "$HOME/.iemec-despliegue"

MODO="${1:-probar}"
: "${SSH_HOST:?Falta SSH_HOST}" "${SSH_USER:?Falta SSH_USER}" "${DOMINIO:?Falta DOMINIO}"
SSH_CLAVE="${SSH_CLAVE:-$HOME/.ssh/iemec_deploy}"
APP_DIR="${APP_DIR:-iemec-app}"
NODE_VENV="${NODE_VENV:-\$HOME/nodevenv/$APP_DIR/22/bin/activate}"
SSH_PUERTO="${SSH_PUERTO:-22}"
PROTOCOLO="${PROTOCOLO:-https}"
SSH=(ssh -p "$SSH_PUERTO" -i "${SSH_CLAVE/#\~/$HOME}" -o ConnectTimeout=20 -o BatchMode=yes "$SSH_USER@$SSH_HOST")
RSYNC_SSH="ssh -p $SSH_PUERTO -i ${SSH_CLAVE/#\~/$HOME} -o BatchMode=yes"
INCLUIR=(package.json package-lock.json servidor motor sql scripts semillas)

if [ -z "${GITHUB_ACTIONS:-}" ] && [ -n "$(git status --porcelain -- . )" ]; then
  echo "✗ Hay cambios sin commitear en iemec-app. Solo se publica lo commiteado." >&2
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"

if [ "${SALTAR_PRUEBAS:-}" != "1" ]; then
  echo "▸ Pruebas ($COMMIT)"
  NODE_ENV=test npm test --silent >/dev/null
fi
echo "▸ Compilando el panel"
npm run build --silent >/dev/null
printf '%s\n' "$COMMIT" > servidor/commit.txt

EXCLUIR=(--exclude='*.test.js' --exclude='.env' --exclude='node_modules' --exclude='tmp/' --exclude='logs/')
if [ "$MODO" != "subir" ]; then
  echo "▸ Se subiría el commit $COMMIT. Cambios en el servidor:"
  rsync -azn --delete --itemize-changes -e "$RSYNC_SSH" "${EXCLUIR[@]}" --exclude='servidor/public/' "${INCLUIR[@]}" "$SSH_USER@$SSH_HOST:$APP_DIR/" | head -60 || true
  "${SSH[@]}" "cat $APP_DIR/servidor/commit.txt 2>/dev/null || echo 'sin commit anotado'" | sed 's/^/   ahora arriba: /'
  exit 0
fi

N="$(date +%Y%m%d-%H%M%S)"
echo "▸ Copia de la base antes de tocar nada"
"${SSH[@]}" "cd $APP_DIR && bash scripts/copia-bd.sh antes-de-$N"

echo "▸ Subiendo el código"
"${SSH[@]}" "mkdir -p ~/respaldo-iemec && if [ -d $APP_DIR/servidor ]; then tar czf ~/respaldo-iemec/build-$N.tgz -C $APP_DIR package.json servidor motor sql scripts semillas 2>/dev/null || true; fi; ls -1t ~/respaldo-iemec/build-*.tgz 2>/dev/null | tail -n +11 | xargs -r rm -f"
cp package.json /tmp/iemec-package-local.json
rsync -az --delete -e "$RSYNC_SSH" "${EXCLUIR[@]}" "${INCLUIR[@]}" "$SSH_USER@$SSH_HOST:$APP_DIR/"

echo "▸ Dependencias, migraciones y reinicio"
"${SSH[@]}" "
  set -e
  source $NODE_VENV
  cd $APP_DIR
  if ! cmp -s package.json .package-instalado.json 2>/dev/null; then npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 && cp package.json .package-instalado.json && echo '   dependencias actualizadas'; fi
  node scripts/migrar.js
  if [ -n '${REINICIAR:-}' ]; then ${REINICIAR:-true}; else
    mkdir -p tmp && touch tmp/restart.txt
    (cloudlinux-selector restart --json --interpreter nodejs --domain $DOMINIO --app-root $APP_DIR 2>/dev/null | grep -oE '\"result\": \"[^\"]*\"') || true
  fi
"

echo "▸ Comprobando desde dentro del servidor"
for i in 1 2 3 4 5 6 7 8; do
  RESPUESTA="$("${SSH[@]}" "curl -s --max-time 10 $PROTOCOLO://$DOMINIO/api/version" || true)"
  if printf '%s' "$RESPUESTA" | grep -q "\"commit\":\"$COMMIT\""; then
    echo "✓ Arriba está el commit $COMMIT: $RESPUESTA"
    git tag -f "iemec-despliegue-$N" >/dev/null 2>&1 || true
    [ -n "${GITHUB_ACTIONS:-}" ] && git push -f origin "iemec-despliegue-$N" >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 4
done
echo "✗ El servidor no responde con el commit $COMMIT. Última respuesta: ${RESPUESTA:-ninguna}" >&2
echo "  Vuelta atrás: código en ~/respaldo-iemec/build-$N.tgz y base en ~/respaldo-iemec/bd-antes-de-$N.sql.gz" >&2
exit 1
