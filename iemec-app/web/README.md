# Web pública de IEMEC

La web nueva de IEMEC (Instituto Europeo de Medicina Estética y Capilar, Av. Siglo XXI 13,
28660 Boadilla del Monte) para sustituir a la de SITE123 en https://iemec-clinic.com: los mismos
servicios, con la estética terciopelo del panel (verde azulado profundo, oro, champán, turquesa y
marfil), pensada primero para el móvil.

Es un sitio **estático**: `web/construir.js` lee unos JSON y unos Markdown y escribe HTML, CSS y JS
en `web/dist/`, que se sube tal cual al alojamiento. Sin dependencias nuevas, sin base de datos,
sin cookies y sin nada de terceros (ni Google Fonts, ni mapas incrustados, ni analítica).

## En dos minutos

```sh
npm run web:fotos -- --origen <carpeta con las fotos originales>   # solo si cambian las fotos
npm run web                  # construye web/dist (y dice si algo incumple las normas)
npm run web:ver              # la sirve en http://127.0.0.1:4321
npm run web:revisar          # la revisa en Chromium y hace capturas en web/capturas/
node web/construir.js --borradores   # vista previa con los borradores → web/dist-borradores
```

- `npm run web` termina con código 1 si hay errores (una frase prohibida por las normas, una
  obligatoria que falta, una página que pasa del tamaño máximo…). El detalle queda en
  `web/dist/informe.json`.
- `npm run web:ver -- 4322 web/dist-borradores` sirve otra carpeta en otro puerto. El servidor de
  pruebas imita a Apache: URL limpias, las 301 del `.htaccess`, la 404 y las cabeceras de
  seguridad.
- `npm run web:revisar` carga todas las páginas en ocho anchos, de 320 a 1440 px, y mira que nada
  desborde, que no haya errores de consola ni imágenes rotas, que las zonas de toque midan 44 px
  y que el menú del móvil funcione con el teclado; `-- --rapido` lo hace solo en 320, 390 y
  1440 px, y `-- --capturas <carpeta>` guarda las capturas en otro sitio. Si el puerto 4321 está
  libre, arranca el servidor y lo para al acabar.
- Las pruebas de la web van con las de la app (`npm test`); solas, `node --test web/test/web.test.js`.

## Qué páginas salen

| Ruta | Qué es |
| --- | --- |
| `/` | Portada: qué es IEMEC, especialidades, preocupaciones, cómo trabajamos, equipo y cómo llegar |
| `/<especialidad>/` | Las 8 especialidades con páginas (medicina estética facial y corporal, control de peso, medicina y cirugía capilar, estética íntima femenina y masculina, cirugía estética) |
| `/<especialidad>/<tratamiento>/` | Un tratamiento: para quién, en qué consiste, opciones, qué esperar, preguntas, ficha y «Te llamamos» |
| `/tratamientos/` | Todos, con buscador y filtros (`?q=labios`, `?e=medicina-capilar`, `?p=arrugas`) |
| `/equipo/`, `/clinica/`, `/tarjetas-regalo/`, `/pedir-cita/` | Equipo, la clínica y su tecnología, tarjetas regalo y todas las formas de pedir cita |
| `/aviso-legal/`, `/privacidad/`, `/cookies/`, `/accesibilidad/` | Textos legales |
| `/gracias/` | Donde acaba el formulario sin JavaScript (no se indexa) |
| `/404.html` | Página no encontrada |

Hoy son 99 páginas, 79 de ellas de tratamiento. Una especialidad sin páginas publicadas no sale
en menús ni en la portada, y sus URL antiguas van a `/tratamientos/`.

## De dónde sale cada cosa

| Qué | Dónde |
| --- | --- |
| Textos de los tratamientos | `web/contenido/*.json` (un archivo por grupo: facial médica, facial con aparatos, corporal y peso, capilar, íntima y cirugía) |
| Borradores que esperan autorización | `web/contenido/pendientes/*.json` (solo salen con `--borradores`) |
| Especialidades y preocupaciones | `web/datos/especialidades.json` |
| Equipo | `web/datos/equipo.json` |
| Datos de la clínica (dirección, horario, teléfono, WhatsApp, redes, registro sanitario, FSE+, API) | `web/datos/sitio.json` |
| Tarjetas regalo | `web/datos/tarjetas.json` |
| Tecnología (sin marcas) | `web/datos/tecnologia.json` (solo sale la que usa algún tratamiento publicado) |
| Páginas provisionales | `web/datos/provisionales.json` |
| Redirecciones de la web anterior | `web/datos/redirecciones.json` (del inventario de SITE123) |
| Normas de publicidad sanitaria | `web/datos/normas.json` (copia de las normas de la vuelta 9) |
| Textos legales | `web/contenido/legal/*.md` |
| Catálogo de tratamientos (ids, activos, familias) | `semillas/iemec/tratamientos.json`, el de la app |
| Fotos | `web/fotos/fotos.json` (en git) y las WebP de `web/fotos/` (fuera de git) |
| Tipografías (Montserrat y Playfair Display, licencia OFL) | `app/public/fuentes/`, las mismas del panel |
| Estilos y JavaScript | `web/css/estilos.css` y `web/js/web.js` |
| Plantillas | `web/lib/paginas.js` (páginas) y `web/lib/base.js` (cabecera, pie, formulario, datos estructurados) |
| Referencias de WhatsApp para la app | `web/datos/referencias.json` (lo genera `npm run web`) |

## Cambiar textos

**Un tratamiento.** Cada entrada de `paginas` en `web/contenido/<grupo>.json` es una página:

- `slug` (la URL), `especialidad`, `catalogo` (los ids del catálogo que cubre; el primero es el
  principal), `orden` y `destacado`;
- `nombre`, `titulo`, `titulo_seo`, `descripcion_seo` y `entradilla`;
- `para_quien` (lista), `texto` (párrafos), `sesion` (duración, sesiones, anestesia,
  recuperación y quién lo hace), `variantes`, `resultados` y `preguntas` (`p` y `r`);
- `preocupaciones` y `relacionados` (para los filtros y los enlaces cruzados);
- `restringida`, `revision_medica`, `fuentes` y `pendiente` (notas que no se publican: van al
  informe).

`sin_pagina` recoge los ids del catálogo que no tienen página y por qué. Todo id activo del
catálogo tiene que estar en una página o en un `sin_pagina`; si no, el generador le hace una
página provisional (más abajo).

**Las normas.** Al construir se revisa todo lo que ve el público (texto, `alt`, `title`, `aria-*`,
URL, textos de WhatsApp y datos estructurados) con las reglas de `web/datos/normas.json` y las del
validador de contenidos de la vuelta 9 (`validar-contenido.py`, copiadas en `web/lib/normas.js`),
con los mismos límites de palabra que Python. Una frase prohibida (un medicamento de receta,
«garantizado», «sin riesgos», un precio fuera de las tarjetas regalo…) es un error y no hay web.
Los avisos (palabras que conviene mirar) quedan en `informe.json` → `avisos_normas`. Las normas
nuevas van a `web/datos/normas.json`; si cambia el validador, cambia también su lista en
`web/lib/normas.js`.

**Lo que falta por confirmar** se escribe `[PENDIENTE: lo que falta]` o en el campo `pendiente`
del JSON: en la web sale resaltado en amarillo para que nadie lo pase por alto, y el informe cuenta
cuántos hay en cada página (`pendientes_visibles`).

**Los textos legales** son Markdown normal (títulos, listas, tablas y enlaces). Las citas (`> …`)
son notas para la revisión: salen en un recuadro «Nota para la revisión · no se publicará» y se
borran del `.md` cuando el abogado dé el visto bueno. Los enlaces a `./privacidad.md` y compañía
pasan a `/privacidad/`. El generador quita de `aviso-legal.md` el anexo, de `cookies.md` la
variante B y de `privacidad.md` los apartados que no se publican; la declaración de accesibilidad
sale del anexo del aviso legal.

**La nota de Google** de la portada (4,9 con 533 opiniones, dato del 29-09-2026) sale de
`sitio.json` → `google`. Las normas recomiendan no citarla: con `"mostrar_nota": false` queda solo
el enlace a la ficha. Si se deja, hay que poner al día la nota, el número y la fecha.

## Borradores y páginas provisionales

- **Borradores.** Los servicios que la autorización sanitaria no cubre todavía (ginecología
  funcional, nutrición, control de peso con dieta…) están en `web/contenido/pendientes/`. No
  salen en `web/dist`. `node web/construir.js --borradores` construye `web/dist-borradores/` con
  todo, una franja «Borrador: pendiente de autorización» en cada página, `noindex` y un
  `robots.txt` que lo cierra. **Esa carpeta no se sube nunca.** Cuando la clínica confirme la
  autorización, la página pasa de `pendientes/<grupo>.json` a `<grupo>.json` (y su id sale de
  `sin_pagina`).
- **Provisionales.** Si el catálogo tiene un tratamiento activo que ningún contenido cubre, el
  generador le hace una página con un nombre neutro (`web/datos/provisionales.json`), textos
  genéricos según sea médico, de cirugía, de estética o capilar, y el aviso «texto provisional».
  Los que el catálogo marca como oferta sin confirmar no tienen página. La lista queda en
  `informe.json` → `provisionales`. Hoy no hay ninguna: los cinco grupos tienen texto.

## WhatsApp, referencias y campañas

Cada botón de WhatsApp abre `https://wa.me/34722833285` con el mensaje escrito:

> Hola, vengo de la web y me interesa: Lipoláser. (ref. web-lipolaser)

- La referencia nunca es un id del catálogo: `web-inicio` en la portada, `web-<especialidad>`,
  `web-<tratamiento>`, `web-tarjeta-<importe>`, `web-tarjeta-regalo`, `web-tarjeta-canje`…
- Lo íntimo y el peso no se nombran en el mensaje (se ve en la pantalla del móvil y pasa por
  Meta): dicen «Salud íntima femenina», «Salud íntima masculina» o «Control de peso», y la
  referencia es un código (`web-intima-f-…`, `web-intima-m-…`, `web-peso-…`).
- `web/datos/referencias.json` traduce cada referencia a su id principal del catálogo, su página y
  su especialidad. Se genera en cada `npm run web`: súbelo a git cuando cambie. **La app tiene que
  leer la «(ref. …)» del primer mensaje y traducirla con este archivo** (origen «WhatsApp de la
  web», `codigo_web` = la referencia).
- Si la visita llega con `?utm_campaign=…` (o `gclid`, `fbclid`…), la web lo guarda en
  `sessionStorage` (clave `iemec-campana`, se borra al cerrar la pestaña) y los mensajes pasan a
  «(ref. web-lipolaser · otono-lipo)». El formulario envía esos datos en campos ocultos.

## Formulario «Te llamamos»: lo que tiene que hacer la app

El formulario de cada tratamiento y de `/pedir-cita/` envía un `POST`
`application/x-www-form-urlencoded` a `https://agenda.iemec-clinic.com/web/contacto` (se cambia en
`sitio.json` → `api`). **Esa ruta aún no existe en la app**; el `POST /api/leads` actual pide
clave y no sirve para un formulario público. Campos:

| Campo | Qué lleva |
| --- | --- |
| `nombre`, `telefono` | Obligatorios (máx. 80 y 20) |
| `email` | Opcional (máx. 120) |
| `tratamiento` | Id del catálogo en la página de un tratamiento; si no, el slug de la especialidad, `estetica-y-bienestar`, `tarjeta-regalo` u `otra` |
| `mensaje` | Opcional, máx. 500 |
| `preferencia` | `whatsapp` o `llamada` |
| `privacidad` | `si`: obligatoria, nunca marcada de antemano |
| `comercial` | `si` si acepta comunicaciones comerciales (opcional, sin marcar) |
| `pagina`, `ref` | La página y su referencia (`web-…`) |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `fbclid` | La campaña, si la hay |
| `t` | Cuándo se cargó la página (ms), para descartar envíos instantáneos |
| `version_textos` | Versión de las cláusulas aceptadas (`sitio.json` → `formulario`) |
| `web` | Trampa para robots: si viene con algo, se descarta en silencio |

Respuesta:

- Sin JavaScript (sin `Accept: application/json`): `303` a `https://iemec-clinic.com/gracias/`
  (con errores, `303` a la página de origen o una página de error sencilla).
- Con JavaScript (`Accept: application/json`, `fetch` sin credenciales): `200 {"ok": true}` o
  `422 {"ok": false, "errores": {"telefono": "…"}}`; la web pinta cada error junto a su campo.
- CORS: `Access-Control-Allow-Origin: https://iemec-clinic.com` para ese `POST`.
- Guardar el consentimiento de privacidad y el comercial por separado, con la fecha y
  `version_textos`; límite de envíos por IP; el lead entra con origen `web` y `codigo_web` = `ref`.

## Publicar

1. `npm run web:fotos -- --origen <carpeta>` si hay fotos nuevas (las WebP no están en git).
2. `npm run web` sin errores. Mira `web/dist/informe.json`: `errores` vacío, `avisos_normas`,
   `obligatorias_pendientes` (hoy, el correo del aviso legal) y `pendientes_visibles`.
3. `npm run web:revisar` sin problemas.
4. Sube **el contenido** de `web/dist/` a `public_html` del alojamiento (cPanel o FTP), con el
   `.htaccess` (es un archivo oculto: activa «mostrar archivos ocultos»). `informe.json` no hace
   falta subirlo, y si se sube, el `.htaccess` lo bloquea. No subas nunca `web/dist-borradores/`.
5. Pruébala antes de cambiar el dominio: con el archivo `hosts` del ordenador apuntando
   `iemec-clinic.com` a la IP del alojamiento, o en un subdominio de prueba con `https` (por
   `http` o `www`, el `.htaccess` manda a https://iemec-clinic.com, que aún es SITE123).
6. **Cambio de SITE123 a la web nueva:** hoy `iemec-clinic.com` apunta a SITE123 (lo gestiona
   Uebea). Hay que cambiar sus DNS (registros `A` de `iemec-clinic.com` y `www`, o los servidores
   de nombres) para que apunten al alojamiento. Antes, apunta los registros `MX` y `TXT` que haya
   para no romper el correo ni verificaciones. Con el dominio ya apuntando, AutoSSL (o Let's
   Encrypt) del cPanel emite el certificado; hasta entonces puede haber un rato sin `https`. No des
   de baja SITE123 hasta comprobar la web nueva, y recuerda que su tienda (las tarjetas regalo) se
   va con ella.
7. Después: en Search Console (dominio verificado por DNS), envía `https://iemec-clinic.com/sitemap.xml`
   y vigila los 404 las primeras semanas. Las 176 URL de SITE123 tienen su 301 en el `.htaccess`
   (sin distinguir mayúsculas y con o sin barra final) y las 86 anclas antiguas
   (`/facial#relleno-de-labios`) las resuelve `web/js/web.js` en la página de destino. La ficha
   de Google Business Profile sigue con la misma URL.

## Privacidad, rendimiento y accesibilidad

- **Sin cookies ni terceros**, así que no hace falta banner. Lo único que se guarda es el código de
  campaña en `sessionStorage` (explicado en `/cookies/`). El mapa es un enlace a Google Maps y a
  Apple Maps, no un mapa incrustado. Si algún día se añade analítica, hará falta consentimiento.
- **Cabeceras** en el `.htaccess`: CSP sin scripts en línea (salvo los bloques JSON-LD, que no
  ejecutan), HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, sin marcos; compresión y
  caché larga para `/fuentes/`, `/fotos/` y `/recursos/` (llevan huella en el nombre).
- **Tamaños máximos**, que comprueba el generador: HTML 70 KB por página, CSS 45 KB y JS 20 KB.
  Hoy: 54 KB la página más grande, 43 KB el CSS y 15 KB el JS.
- **Fotos** en WebP de 480, 960 y 1600 px con `srcset`, ancho y alto, y carga diferida salvo la
  primera. Dos tipografías precargadas.
- **SEO:** `sitemap.xml`, `robots.txt`, canónica, imagen para redes de 1200 × 630, `MedicalClinic`
  en todas las páginas (con el registro CS17886), migas (`BreadcrumbList`) y
  `MedicalProcedure`/`Service` en cada tratamiento.
- **Accesibilidad (WCAG 2.2 AA):** contrastes medidos (el oro, el champán y el turquesa nunca son
  texto sobre marfil; el oro de texto es `#7d5d22`), foco visible, enlace para saltar al contenido,
  zonas de toque de 44 px como mínimo, menú del móvil que atrapa el foco y se cierra con Escape,
  errores del formulario junto a cada campo y anunciados, sin animaciones con «reducir movimiento».
  Sin JavaScript todo funciona: el menú lleva al del pie y el formulario se envía igual.
- **Borrador de la declaración de accesibilidad** en `/accesibilidad/`, pendiente de fecha y de
  revisión.

## El logotipo

La web usa el logotipo turquesa en PNG de la web actual, recortado y pasado a WebP: sobre el
terciopelo se ve bien, pero es un mapa de bits. **Pide a la clínica el logotipo vectorial (SVG, AI,
EPS o PDF vectorial)** para la cabecera, el favicon y la imagen para redes. Si en `fotos.json` no
hay logotipo, la web usa uno tipográfico (IEMEC en Playfair con el nombre completo debajo).

## Pendiente de la clínica

Todo esto sale en la web como `[PENDIENTE: …]` o está en `informe.json`:

- **Datos de la clínica:** horario del sábado (Google dice de 11:00 a 20:00 y Treatwell, de 10:00
  a 20:00); correo propio del dominio (hoy solo hay un Gmail; el aviso legal lo necesita);
  «local 35» o «locales 35-36»; domicilio social y datos del Registro Mercantil si no coinciden;
  aparcamiento y transporte público más cercanos.
- **Autorización sanitaria CS17886:** qué cubre la unidad U.900 en medicina capilar; qué servicios
  de la zona íntima cubre (la ginecología, U.26, no figura); si cubre el área de peso
  (Endocrinología U.10 y Nutrición U.11); dónde se hacen las cirugías (centro, anestesia e
  ingreso); y los 38 tratamientos del catálogo que no tienen página (`informe.json` →
  `sin_pagina`, cada uno con su motivo).
- **Equipo:** responsable asistencial (dirección médica); titulación, especialidad, número de
  colegiado y, si el título es extranjero, homologación de cada profesional (en especial Gonzalo
  Orallo y Marco Vricella); si Paola Ranilla es «Dra.»; profesión de Paula Vicent; retrato de
  Marcela Pedraza (la foto de la web actual lleva el nombre de otra persona); nombres y titulación
  del equipo de estética y de enfermería; retratos nuevos en alta resolución.
- **Marca y fotos:** logotipo vectorial; emblema oficial «Cofinanciado por la Unión Europea» del
  FSE+ (el de la web actual está dañado), con la convocatoria, el organismo y la fecha hasta la
  que hay que mantener el aviso; fotos de las instalaciones actuales y del head spa; los originales
  de los 4 vídeos de ginecología que hoy están en Vimeo.
- **Tarjetas regalo:** pago online (hoy lo cobra la tienda de SITE123, que desaparece), condiciones
  de compra (forma de pago, desistimiento de 14 días, confirmación del pedido), cómo se comprueban
  las tarjetas ya vendidas (no llevan código único) y qué hacer con los vales de 20 € de la
  encuesta.
- **Legal:** revisión del abogado sanitario y del delegado de protección de datos de todos los
  textos legales y de las cláusulas del formulario (y la versión de la cláusula); nombre y correo
  del DPD; proveedores (alojamiento, correo, WhatsApp Business, app de gestión) y sus regiones;
  que el código de campaña está exento de consentimiento; si se mantiene la nota de Google en la
  portada; arbitraje de consumo y códigos de conducta; política con menores de 18 años; y, si
  contesta el asistente virtual de la app, decir que es una IA que se presenta como tal.
- **Contenido:** la revisión médica de las 66 páginas marcadas (`informe.json` →
  `revision_medica`) y las 299 notas de contenido (`contenido_pendiente`); los borradores de
  `web/contenido/pendientes/` cuando haya autorización.
- **Campañas y dominios:** las páginas de campaña de SITE123 (`/aprende`,
  `/lipolaser-agenda-tu-cita`) redirigen al lipoláser: si hay anuncios activos, cambiar antes su
  destino (y el diagnóstico de lipoláser, que solo se reserva los martes, lo lleva la agenda de la
  app); la landing en francés (`/recuperez-vos-cheveux-a-madrid`) va a `/cirugia-capilar/`, o a
  `cliniquecapillaire-iemec.es` si la clínica lo prefiere; Search Console y cualquier analítica
  que hoy lleve Uebea.
