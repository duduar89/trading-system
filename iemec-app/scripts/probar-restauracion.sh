#!/usr/bin/env bash
# Prueba de restauración (una vez al mes): restaura la última copia en una base temporal y comprueba
# que están las tablas y las filas. Una copia que no se ha restaurado nunca no es una copia.
#   bash scripts/probar-restauracion.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a
DIR="${COPIA_DIR:-$HOME/respaldo-iemec}"
ULTIMA="$(ls -1t "$DIR"/bd-*.sql.gz* | head -1)"
TEMP="${DB_NAME_RESTAURACION:-${DB_NAME}_restauracion}"
echo "▸ Restaurando $ULTIMA en $TEMP"
if [[ "$ULTIMA" == *.enc ]]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$ULTIMA" -pass "file:$COPIA_CLAVE_FICHERO" | gunzip > /tmp/iemec-restauracion.sql
else
  gunzip -c "$ULTIMA" > /tmp/iemec-restauracion.sql
fi
MYSQL_PWD="$DB_PASSWORD" mysql -h "${DB_HOST:-localhost}" -u "$DB_USER" -e "DROP DATABASE IF EXISTS \`$TEMP\`; CREATE DATABASE \`$TEMP\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
MYSQL_PWD="$DB_PASSWORD" mysql -h "${DB_HOST:-localhost}" -u "$DB_USER" "$TEMP" < /tmp/iemec-restauracion.sql
rm -f /tmp/iemec-restauracion.sql
for t in _migraciones clinica tratamientos pacientes citas conversaciones seguimientos; do
  N="$(MYSQL_PWD="$DB_PASSWORD" mysql -N -h "${DB_HOST:-localhost}" -u "$DB_USER" "$TEMP" -e "SELECT COUNT(*) FROM $t")"
  echo "   $t: $N filas"
done
MYSQL_PWD="$DB_PASSWORD" mysql -h "${DB_HOST:-localhost}" -u "$DB_USER" -e "DROP DATABASE \`$TEMP\`"
echo "✓ La copia se restaura bien"
