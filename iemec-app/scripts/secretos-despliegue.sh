#!/usr/bin/env bash
# Asistente de una sola vez (desde tu terminal, nunca desde un chat): crea una clave SSH solo para
# desplegar, te dice cómo autorizarla en cPanel y guarda los secretos en GitHub con `gh`.
set -euo pipefail
read -rp "Servidor SSH de LucusHost (p. ej. servidor.lucushost.org): " HOST
read -rp "Usuario de cPanel: " USUARIO
read -rp "Dominio de la app (p. ej. agenda.iemec-clinic.com): " DOMINIO
read -rp "Repositorio de GitHub (dueño/repo): " REPO
CLAVE="$HOME/.ssh/iemec_deploy"
[ -f "$CLAVE" ] || ssh-keygen -t ed25519 -N '' -C "despliegue-iemec" -f "$CLAVE"
echo
echo "1) En cPanel → Acceso SSH → Administrar claves SSH → Importar clave, pega esto y autorízala:"
cat "$CLAVE.pub"
read -rp "   Pulsa Intro cuando esté autorizada… " _
ssh -i "$CLAVE" -o BatchMode=yes "$USUARIO@$HOST" 'echo "   ✓ conexión correcta"'
ssh-keyscan -H "$HOST" > /tmp/iemec_known_hosts 2>/dev/null
gh secret set IEMEC_SSH_KEY -R "$REPO" < "$CLAVE"
gh secret set IEMEC_KNOWN_HOSTS -R "$REPO" < /tmp/iemec_known_hosts
gh secret set IEMEC_SSH_HOST -R "$REPO" -b "$HOST"
gh secret set IEMEC_SSH_USER -R "$REPO" -b "$USUARIO"
gh secret set IEMEC_DOMINIO -R "$REPO" -b "$DOMINIO"
printf 'SSH_HOST=%s\nSSH_USER=%s\nDOMINIO=%s\nSSH_CLAVE=%s\n' "$HOST" "$USUARIO" "$DOMINIO" "$CLAVE" > "$HOME/.iemec-despliegue"
echo "✓ Secretos guardados en GitHub y en ~/.iemec-despliegue (para desplegar desde el portátil)."
