# Certificados para hablar con la base de datos

`servidor/db.js` conecta con PostgreSQL por TLS y **verificando el certificado** siempre que el
servidor no sea `localhost` (ver `servidor/db-ssl.js`). Para Supabase hace falta su autoridad de
certificación, que no está entre las de confianza de Node.

## `supabase-prod-ca-2021.crt`

- **Qué es:** «Supabase Root 2021 CA», la raíz que firma los certificados de la base de Supabase y de
  su pooler (Supavisor).
- **De dónde sale:** de la documentación oficial de Supabase, que explica cómo bajarlo
  (<https://supabase.com/docs/guides/platform/ssl-enforcement>: Dashboard → Project Settings →
  Database → SSL Configuration → «Download certificate», fichero `prod-ca-2021.crt`). El enlace directo
  que enseña ese botón es
  <https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt>; así se bajó
  el 1 de octubre de 2026.
- **Huella SHA-256:** `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- **Válido:** del 28 de abril de 2021 al 26 de abril de 2031.
- Es un certificado público (la parte pública de una autoridad): no es un secreto.

Para comprobarlo tú mismo: `openssl x509 -in servidor/certs/supabase-prod-ca-2021.crt -noout -subject -dates -fingerprint -sha256`
y compara con el que baja el panel de Supabase.

## Si Supabase lo cambia

Baja el nuevo desde el panel y cambia este fichero, o, sin tocar el código, pon el nuevo en la
variable `DB_SSL_CA` (una ruta, o el texto PEM). Con `DB_SSL_CA=sistema` se usan los certificados de
confianza de Node (para una base cuyo certificado ya firma una autoridad pública).

Si la conexión falla con `self-signed certificate in certificate chain` o `unable to get local issuer
certificate`, es que el servidor presenta una cadena que este fichero no cubre: **no se arregla
quitando la verificación** (no hay forma de hacerlo y no debe haberla), sino poniendo en `DB_SSL_CA` la
autoridad correcta.
