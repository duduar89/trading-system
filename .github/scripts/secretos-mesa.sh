#!/usr/bin/env bash
#
# Asistente de los secretos del despliegue de la mesa de trading (GitHub Actions + rsync por SSH).
# Como el del portal (portal-cifra/.github/wizard-secretos.sh). LO EJECUTA EDUARDO, en su
# terminal (Git Bash), desde la carpeta del repositorio trading-system:
#
#   bash .github/scripts/secretos-mesa.sh
#
# Claude no lo ejecuta y no ve nada de lo que se teclea ni de lo que se guarda.
#
# Qué hace:
#   1. comprueba que tienes ssh, ssh-keygen, ssh-keyscan y gh (con sesión);
#   2. crea una clave SSH SOLO para este despliegue (~/.ssh/mesa_deploy_github), distinta
#      de la tuya personal y de la del portal;
#   3. la autoriza en el servidor entrando con tu clave personal;
#   4. ancla la huella del servidor (para que GitHub sepa que habla con TU servidor);
#   5. guarda en GitHub los seis secretos: MESA_SSH_KEY, MESA_SSH_HOST, MESA_SSH_USER,
#      MESA_KNOWN_HOSTS, MESA_RUTA y MESA_URL.
# Se puede repetir: reutiliza la clave si ya existe.

set -euo pipefail

if [[ -t 1 ]]; then B=$'\033[1m'; V=$'\033[32m'; A=$'\033[33m'; Z=$'\033[34m'; R=$'\033[0m'; else B=""; V=""; A=""; Z=""; R=""; fi
ETAPAS=5
N=0
etapa() { N=$((N + 1)); printf '\n%s%s▸ Paso %s/%s · %s%s\n' "$B" "$Z" "$N" "$ETAPAS" "$1" "$R"; }
di()    { printf '  %s\n' "$1"; }
ojo()   { printf '  %s⚠ %s%s\n' "$A" "$1" "$R"; }
bien()  { printf '  %s✓ %s%s\n' "$V" "$1" "$R"; }
si_o_no() { local r=""; printf '  %s? %s [s/N] %s' "$A" "$1" "$R"; read -r r || true; [[ "$r" =~ ^[sSyY] ]]; }
pregunta() {   # pregunta VARIABLE "texto" "valor por defecto"
  local v=""; printf '  %s%s%s [Enter = %s] ' "$B" "$2" "$R" "$3"; read -r v || true
  printf -v "$1" '%s' "${v:-$3}"
}

CLAVE_DEPLOY="$HOME/.ssh/mesa_deploy_github"
KNOWN_HOSTS="$HOME/.ssh/known_hosts"

printf '\n%s%s  Mesa de trading · secretos del despliegue por GitHub Actions%s\n' "$B" "$Z" "$R"
di "Ninguna clave ni contraseña sale en pantalla. Ctrl+C para parar cuando quieras."

# ── 1 ─────────────────────────────────────────────────────────────────────
etapa "Comprobar que tienes lo necesario"
for c in ssh ssh-keygen ssh-keyscan gh; do
  command -v "$c" >/dev/null 2>&1 || { ojo "No encuentro '$c' en este terminal."; exit 1; }
done
gh auth status >/dev/null 2>&1 || { ojo "GitHub CLI no tiene sesión. Ejecuta 'gh auth login' y vuelve a lanzar esto."; exit 1; }
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
[[ -n "$REPO" ]] || { ojo "No sé de qué repositorio de GitHub es esta carpeta. Lánzalo desde trading-system."; exit 1; }
di "Repositorio de GitHub: $REPO"
si_o_no "¿Es el repositorio de la mesa (trading-system)?" || { ojo "Cancelado."; exit 1; }

pregunta SSH_HOST "Servidor SSH (el mismo del portal)" "${MESA_SSH_HOST:-}"
[[ -n "$SSH_HOST" ]] || { ojo "Hace falta el nombre del servidor."; exit 1; }
pregunta SSH_USER "Usuario SSH" "chnmbizx"
pregunta CLAVE_PERSONAL "Tu clave personal (con la que ya entras al servidor)" "$HOME/.ssh/cifra_local"
[[ -f "$CLAVE_PERSONAL" ]] || { ojo "No encuentro $CLAVE_PERSONAL."; exit 1; }
pregunta RUTA "Carpeta de la app en el servidor, respecto a tu home" "mesa-trading"
pregunta URL "Dirección de la mesa" "https://mesa.brainstormersagency.es"
di "Se usará $SSH_USER@$SSH_HOST, carpeta ~/$RUTA, web $URL"

# ── 2 ─────────────────────────────────────────────────────────────────────
etapa "Crear la clave del despliegue"
di "Es una clave NUEVA, sin frase de paso (GitHub tiene que poder usarla solo). Solo vive en"
di "tu portátil y en los secretos de GitHub."
if [[ -f "$CLAVE_DEPLOY" ]]; then
  if ! si_o_no "Ya existe $CLAVE_DEPLOY. ¿La reutilizo? (no = la aparto y creo otra)"; then
    SELLO=$(date +%F-%H%M%S)
    mv "$CLAVE_DEPLOY" "$CLAVE_DEPLOY.antigua-$SELLO"
    mv "$CLAVE_DEPLOY.pub" "$CLAVE_DEPLOY.pub.antigua-$SELLO" 2>/dev/null || true
  fi
fi
if [[ ! -f "$CLAVE_DEPLOY" ]]; then
  ssh-keygen -q -t ed25519 -N "" -C "github-actions-mesa-deploy $(date +%F)" -f "$CLAVE_DEPLOY"
  bien "Clave creada en $CLAVE_DEPLOY"
fi
di "Huella: $(ssh-keygen -lf "$CLAVE_DEPLOY.pub" | awk '{print $2}')"

# ── 3 ─────────────────────────────────────────────────────────────────────
etapa "Autorizar la clave en el servidor"
entra() { ssh -i "$CLAVE_DEPLOY" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 "$SSH_USER@$SSH_HOST" true 2>/dev/null; }
if entra; then
  bien "La clave ya estaba autorizada."
else
  si_o_no "¿Añado la parte PÚBLICA a ~/.ssh/authorized_keys de $SSH_USER@$SSH_HOST?" || { ojo "Cancelado."; exit 1; }
  ssh -i "$CLAVE_PERSONAL" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 "$SSH_USER@$SSH_HOST" \
    'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys' < "$CLAVE_DEPLOY.pub"
  if entra; then
    bien "La clave nueva ya entra en el servidor."
  else
    ojo "La clave nueva NO entra. En cPanel → «SSH Access» → «Manage SSH Keys» → «Import Key»:"
    di "   nombre mesa_deploy_github, y en «Public Key» el contenido de $CLAVE_DEPLOY.pub;"
    di "   luego «Manage» junto a esa clave → «Authorize»."
    printf '  Cuando lo hayas hecho, pulsa Enter. '; read -r _ || true
    entra || { ojo "Sigue sin entrar. Paro aquí; no se ha guardado nada en GitHub."; exit 1; }
    bien "La clave nueva ya entra en el servidor."
  fi
fi

# ── 4 ─────────────────────────────────────────────────────────────────────
etapa "Anclar la huella del servidor"
KH=$(ssh-keygen -F "$SSH_HOST" -f "$KNOWN_HOSTS" 2>/dev/null | grep -v '^#' || true)
if [[ -z "$KH" ]]; then
  ojo "Tu ordenador aún no conoce este servidor: se pide su huella ahora."
  KH=$(ssh-keyscan -t ed25519 "$SSH_HOST" 2>/dev/null || true)
  [[ -n "$KH" ]] || { ojo "No he podido obtener la huella del servidor."; exit 1; }
  TMP=$(mktemp); printf '%s\n' "$KH" > "$TMP"
  di "Huella recibida: $(ssh-keygen -lf "$TMP" | awk '{print $2}')"; rm -f "$TMP"
  si_o_no "¿Coincide con la que muestra cPanel para este servidor?" || { ojo "No la guardo. Cancelado."; exit 1; }
fi
bien "Huella lista."

# ── 5 ─────────────────────────────────────────────────────────────────────
etapa "Guardar los seis secretos en GitHub ($REPO)"
guardar() { printf '%s' "$2" | gh secret set "$1" -R "$REPO" >/dev/null && bien "$1"; }
guardar MESA_SSH_KEY "$(cat "$CLAVE_DEPLOY")"
guardar MESA_SSH_HOST "$SSH_HOST"
guardar MESA_SSH_USER "$SSH_USER"
guardar MESA_KNOWN_HOSTS "$KH"
guardar MESA_RUTA "$RUTA"
guardar MESA_URL "$URL"
di "Secretos que hay ahora (solo los nombres):"
gh secret list -R "$REPO" 2>/dev/null | awk '{print "   " $1}' || true
printf '\n'
di "Siguiente: GitHub → Actions → «Mesa de trading · desplegar» → Run workflow, modo «probar»."
