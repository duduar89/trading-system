#!/bin/bash
# Publica io-sistemas-web/ en la carpeta pública del dominio (lo ejecuta .cpanel.yml).
#
# Variables:
#   SITE_URL    Dirección donde se publica la web. Se usa en Open Graph, canonical,
#               sitemap y JSON-LD. Por defecto, el dominio definitivo.
#   DEPLOYPATH  (opcional) Carpeta pública de destino. Si no se indica, se busca
#               ~/<dominio> y ~/public_html/<dominio> y se usa la que ya tenga la web.
set -euo pipefail

PROD_URL="https://www.iosistemasaudiovisuales.com"
SITE_URL="${SITE_URL:-$PROD_URL}"
SITE_URL="${SITE_URL%/}"
HOME="${HOME:-$(getent passwd "$(id -un)" | cut -d: -f6)}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/io-sistemas-web"
HOST="${SITE_URL#*://}"
HOST="${HOST%%/*}"

if [ -z "${DEPLOYPATH:-}" ]; then
  for candidate in "$HOME/$HOST" "$HOME/public_html/$HOST" "$HOME/${HOST#www.}" "$HOME/public_html/${HOST#www.}"; do
    if [ -f "$candidate/index.html" ]; then
      DEPLOYPATH="$candidate"
      break
    fi
  done
fi

# Seguridad: la carpeta debe existir y no puede ser la raíz ni la carpeta personal
if [ -z "${DEPLOYPATH:-}" ] || [ ! -d "$DEPLOYPATH" ]; then
  echo "No encuentro la carpeta pública de $HOST. Indica DEPLOYPATH en .cpanel.yml." >&2
  exit 1
fi
DEPLOYPATH="$(cd "$DEPLOYPATH" && pwd)"
case "$DEPLOYPATH" in
  / | "$HOME" | "$HOME/public_html")
    if [ "$SITE_URL" != "$PROD_URL" ] || [ "$DEPLOYPATH" != "$HOME/public_html" ]; then
      echo "Destino no permitido: $DEPLOYPATH" >&2
      exit 1
    fi
    ;;
esac

/bin/cp -R "$SRC"/. "$DEPLOYPATH"/
rm -f "$DEPLOYPATH/README.md"

if [ "$SITE_URL" != "$PROD_URL" ]; then
  # Las direcciones absolutas (tarjeta para compartir, canonical…) apuntan a esta copia
  sed -i "s#$PROD_URL#$SITE_URL#g" \
    "$DEPLOYPATH/index.html" "$DEPLOYPATH/aviso-legal.html" "$DEPLOYPATH/robots.txt" "$DEPLOYPATH/sitemap.xml"
  # Copia de pruebas: que los buscadores no la indexen (las tarjetas siguen funcionando)
  if ! grep -q 'name="robots"' "$DEPLOYPATH/index.html"; then
    sed -i 's#<meta name="theme-color"#<meta name="robots" content="noindex, follow">\n  <meta name="theme-color"#' "$DEPLOYPATH/index.html"
  fi
fi

echo "Web publicada en $DEPLOYPATH para $SITE_URL"
