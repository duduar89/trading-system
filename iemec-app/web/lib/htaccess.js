'use strict';
// .htaccess de public_html (Apache de cPanel): https sin www, las 301 de la web anterior, caché larga
// para lo que lleva huella, cabeceras de seguridad y compresión. web/servir.js entiende sus
// RewriteRule y su Content-Security-Policy para probarlo en local.

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function csp(sitio) {
  const api = sitio.api.base;
  return [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
    `connect-src 'self' ${api}`, `form-action 'self' ${api}`, "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function reglaRedireccion(r) {
  const desde = r.desde.replace(/^\//, '');
  // Si la URL vieja es la nueva sin la barra final, solo se redirige la variante sin barra (si no, bucle).
  const patron = r.igual ? `^${escaparRegex(desde.replace(/\/+$/, ''))}$` : `^${escaparRegex(desde.replace(/\/+$/, ''))}/?$`;
  return `RewriteRule "${patron}" "${r.hacia}" [R=301,L,NC]`;
}

function htaccess(sitio, reglas) {
  const host = new URL(sitio.dominio).host;
  const redirecciones = reglas.filter((r) => !(r.igual && r.desde.replace(/\/+$/, '') === r.hacia.replace(/\/+$/, '') && r.desde.endsWith('/')));
  return `# Generado por web/construir.js (${redirecciones.length} redirecciones de la web anterior). No se edita a mano:
# se cambia web/datos/redirecciones.json o el generador y se vuelve a construir.
Options -Indexes
DirectoryIndex index.html
AddDefaultCharset utf-8
ErrorDocument 404 /404.html

<IfModule mod_mime.c>
  AddType image/webp .webp
  AddType font/woff2 .woff2
  AddType image/svg+xml .svg
  AddType application/xml .xml
</IfModule>

# El informe del generador es para el equipo, no para el público.
<Files "informe.json">
  Require all denied
</Files>

<IfModule mod_rewrite.c>
  RewriteEngine On

  # Siempre https://${host} (sin www), como la web actual.
  RewriteCond %{HTTP_HOST} ^www\\. [NC]
  RewriteRule ^ https://${host}%{REQUEST_URI} [R=301,L,NE]
  RewriteCond %{HTTPS} off
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteRule ^ https://${host}%{REQUEST_URI} [R=301,L,NE]

  # Web anterior (SITE123) → web nueva. Sin distinguir mayúsculas y con o sin barra final.
${redirecciones.map((r) => `  ${reglaRedireccion(r)}`).join('\n')}
</IfModule>

<IfModule mod_headers.c>
  Header always set Content-Security-Policy "${csp(sitio)}"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"
  Header always set X-Frame-Options "DENY"
  Header always set Cross-Origin-Opener-Policy "same-origin"
  Header always set Strict-Transport-Security "max-age=31536000" "expr=%{HTTPS} == 'on'"
  # Fuentes, fotos y recursos llevan la huella en el nombre: caché de un año.
  <If "%{REQUEST_URI} =~ m#^/(fuentes|fotos|recursos)/#">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </If>
  <Else>
    Header set Cache-Control "no-cache"
  </Else>
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json application/ld+json image/svg+xml application/xml text/xml text/plain
</IfModule>
`;
}

module.exports = { htaccess, csp, reglaRedireccion, escaparRegex };
