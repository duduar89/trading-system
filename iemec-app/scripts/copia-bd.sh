#!/usr/bin/env bash
# Copia de la base de datos (lee las credenciales del .env de la app). Se guarda comprimida y, si
# existe la clave COPIA_CLAVE_FICHERO, cifrada con AES-256. Se conservan las 60 últimas.
#   bash scripts/copia-bd.sh [etiqueta]
# En cPanel, además, cada 15 minutos por cron (condición 6 del stack):
#   */15 * * * * cd ~/iemec-app && bash scripts/copia-bd.sh cron >> ~/logs/iemec-copias.log 2>&1
# y, si COPIA_DESTINO está puesto (p. ej. un remoto de rclone en otro proveedor de la UE), se envía fuera.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a
DESTINO_LOCAL="${COPIA_DIR:-$HOME/respaldo-iemec}"
mkdir -p "$DESTINO_LOCAL"
NOMBRE="bd-${1:-manual}-$(date +%Y%m%d-%H%M%S).sql.gz"
MYSQL_PWD="$DB_PASSWORD" mysqldump --single-transaction --routines --triggers --no-tablespaces \
  -h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" | gzip -9 > "$DESTINO_LOCAL/$NOMBRE"
if [ -n "${COPIA_CLAVE_FICHERO:-}" ] && [ -f "$COPIA_CLAVE_FICHERO" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$DESTINO_LOCAL/$NOMBRE" -out "$DESTINO_LOCAL/$NOMBRE.enc" -pass "file:$COPIA_CLAVE_FICHERO"
  rm -f "$DESTINO_LOCAL/$NOMBRE"
  NOMBRE="$NOMBRE.enc"
fi
if [ -n "${COPIA_DESTINO:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$DESTINO_LOCAL/$NOMBRE" "$COPIA_DESTINO" --quiet
fi
ls -1t "$DESTINO_LOCAL"/bd-*.sql.gz* 2>/dev/null | tail -n +61 | xargs -r rm -f
echo "✓ Copia: $DESTINO_LOCAL/$NOMBRE"
