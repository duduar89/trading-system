# Web pública de IEMEC

La web nueva de IEMEC (Instituto Europeo de Medicina Estética y Capilar, Av. Siglo XXI 13,
28660 Boadilla del Monte) para sustituir a la de SITE123 en https://iemec-clinic.com: los mismos
servicios, con la estética terciopelo del panel (verde azulado profundo, oro, champán, turquesa y
marfil), pensada primero para el móvil.

Es un sitio **estático**: `web/construir.js` lee unos JSON y unos Markdown y escribe HTML, CSS y JS
en `web/dist/`, que se sube tal cual al alojamiento. Sin dependencias nuevas, sin base de datos,
sin cookies y sin nada de terceros (ni Google Fonts, ni mapas incrustados, ni analítica). Lo único
dinámico es el formulario «Te llamamos», que envía a la app (`POST /web/contacto`).

## En dos minutos

```sh
npm run web:fotos -- --origen <carpeta con las fotos originales>   # solo si cambian las fotos
npm run web                  # construye web/dist (y dice si algo incumple las normas)
npm run web:ver              # la sirve en http://127.0.0.1:4321
npm run web:revisar          # la revisa en Chromium y hace capturas en web/capturas/
node web/construir.js --publicar     # la comprobación antes de subirla: sin ningún [PENDIENTE] a la vista
node web/construir.js --borradores   # vista previa con los borradores → web/dist-borradores
```

- `npm run web` termina con código 1 si hay errores (una frase prohibida por las normas, una
  página que pasa del tamaño máximo…). El detalle queda en `web/dist/informe.json`.
- `--publicar` es más estricto: además da error por cada `[PENDIENTE…]` que se vea, por cada frase
  obligatoria que falte (hoy, el correo del aviso legal) y si hay borradores. **Hoy falla a
  propósito**: la web tiene huecos que solo puede llenar la clínica (más abajo).
- `npm run web:ver -- 4322 web/dist-borradores` sirve otra carpeta en otro puerto. El servidor de
  pruebas imita a Apache: URL limpias, las 301 del `.htaccess`, la 404 y las cabeceras de
  seguridad.
- `npm run web:revisar` carga todas las páginas en ocho anchos, de 320 a 1440 px, y mira que ninguna
  caja se salga por los lados (midiendo el rectángulo de cada elemento: con `overflow-x: clip` la
  página nunca tiene barra horizontal que avise), que no haya errores de consola ni imágenes rotas,
  que las zonas de toque midan 44 px y que el menú del móvil funcione con el teclado;
  `-- --rapido` lo hace solo en 320, 390 y 1440 px, `-- --puerto 4341` usa otro puerto y
  `-- --capturas <carpeta>` guarda las capturas en otro sitio. Si el puerto está libre, arranca el
  servidor y lo para al acabar.
- Las pruebas de la web van con las de la app (`npm test`); solas, `node --test web/test/web.test.js`.

## Qué páginas salen

| Ruta | Qué es |
| --- | --- |
| `/` | Portada: qué es IEMEC, preocupaciones, especialidades (y «Todos los tratamientos»), cómo trabajamos, equipo y cómo llegar |
| `/<especialidad>/` | Las 7 especialidades: medicina estética facial y corporal, medicina capilar, cirugía capilar, estética íntima femenina y masculina y cirugía estética |
| `/<especialidad>/<tratamiento>/` | Un tratamiento: aviso, ficha práctica, para quién, en qué consiste, opciones, qué esperar, preguntas y «Te llamamos» |
| `/tratamientos/` | Todos, con buscador y filtros (`?q=labios`, `?e=medicina-capilar`, `?p=arrugas`) |
| `/equipo/`, `/clinica/`, `/tarjetas-regalo/`, `/pedir-cita/` | Equipo, la clínica y su tecnología, tarjetas regalo y todas las formas de pedir cita |
| `/aviso-legal/`, `/privacidad/`, `/cookies/`, `/accesibilidad/` | Textos legales |
| `/gracias/` | Donde acaba el formulario sin JavaScript (no se indexa) |
| `/404.html` | Página no encontrada |

Hoy son 95 páginas, 76 de ellas de tratamiento. El área de control de peso está entera en
borradores (su autorización está pendiente): una especialidad sin páginas publicadas no sale en
menús, portada, filtros ni formularios, y sus URL antiguas van a `/tratamientos/`.

## De dónde sale cada cosa

| Qué | Dónde |
| --- | --- |
| Textos de los tratamientos | `web/contenido/*.json` (un archivo por grupo: facial médica, facial con aparatos, corporal y peso, capilar, íntima y cirugía) |
| Borradores que esperan autorización | `web/contenido/pendientes/*.json` (solo salen con `--borradores`) |
| Especialidades, su foto y las preocupaciones | `web/datos/especialidades.json` |
| Equipo | `web/datos/equipo.json` |
| Datos de la clínica (dirección, horario, teléfono, WhatsApp, redes, ficha de Google, registro sanitario, FSE+, dirección del formulario) | `web/datos/sitio.json` |
| Tarjetas regalo | `web/datos/tarjetas.json` |
| Tecnología (sin marcas) | `web/datos/tecnologia.json` (solo sale la que usa algún tratamiento publicado) |
| Páginas provisionales | `web/datos/provisionales.json` |
| Redirecciones y anclas de la web anterior | `web/datos/redirecciones.json` (del inventario de SITE123) |
| Normas de publicidad sanitaria | `web/datos/normas.json` (normas de la vuelta 9, ampliadas en la revisión final) |
| Textos legales | `web/contenido/legal/*.md` |
| Catálogo de tratamientos (ids, activos, familias, régimen legal, quién lo hace) | `semillas/iemec/tratamientos.json`, el de la app |
| Fotos | `web/fotos/fotos.json` (en git: origen, derechos, `alt`, recorte) y las WebP de `web/fotos/` (fuera de git) |
| Tipografías (Montserrat y Playfair Display, licencia OFL) | `app/public/fuentes/`, las mismas del panel |
| Estilos y JavaScript | `web/css/estilos.css` y `web/js/web.js` (el generador los minifica) |
| Plantillas | `web/lib/paginas.js` (páginas), `web/lib/base.js` (cabecera, pie, formulario, datos estructurados) y `web/lib/modelo.js` (catálogo, referencias, avisos y redirecciones) |
| Referencias de WhatsApp y del formulario para la app | `semillas/iemec/referencias-web.json` (lo genera `npm run web`: súbelo a git cuando cambie) |

## Cambiar textos

**Un tratamiento.** Cada entrada de `paginas` en `web/contenido/<grupo>.json` es una página:

- `slug` (la URL), `especialidad`, `catalogo` (los ids del catálogo que cubre; el primero es el
  principal), `orden` y `destacado`; `tipo: "cirugia"` si es una cirugía aunque el catálogo no lo
  diga (la labioplastia);
- `nombre`, `titulo`, `titulo_seo`, `descripcion_seo` y `entradilla`;
- `para_quien` (lista), `texto` (párrafos), `sesion` (duración, sesiones, anestesia,
  recuperación, `profesional` y `donde`), `variantes`, `resultados` y `preguntas` (`p` y `r`);
- `preocupaciones` y `relacionados` (para los filtros y los enlaces cruzados);
- `restringida`, `revision_medica`, `fuentes` y `pendiente` (notas que no se publican: van al
  informe).

`sin_pagina` recoge los ids del catálogo que no tienen página y por qué. Todo id activo del
catálogo tiene que estar en una página o en un `sin_pagina`; si no, el generador le hace una
página provisional (más abajo).

**El aviso de cada tratamiento** sale solo, según su clase (`claseDe` en `web/lib/modelo.js`), que
se decide por el régimen legal y el profesional del catálogo, nunca por las palabras del texto:

- **Cirugía** (`tipo: "cirugia"` o régimen `cirugia`): consulta previa con el cirujano, el
  consentimiento informado por escrito, quién opera, dónde y «solo para mayores de edad». Mientras
  la clínica no dé nombre, especialidad oficial y número de colegiado, se ve
  `[PENDIENTE: nombre, especialidad oficial y n.º de colegiado]` (también en la ficha).
- **Médico** (lo hace un médico, o es un medicamento o un producto sanitario): valoración médica
  previa, riesgos y contraindicaciones.
- **Valoración previa** (publicidad restringida, pero en el catálogo lo hace estética): valoración
  previa, con el hueco de quién la hace.
- **La propia valoración** (una consulta o un diagnóstico): sin aviso.

Donde no consta quién lo hace, `sesion.profesional` lleva el hueco (`[PENDIENTE: …]`) en vez de un
«equipo» sin confirmar.

**Las normas.** Al construir se revisa todo lo que ve el público (texto, `alt`, `title`, `aria-*`,
URL, textos de WhatsApp y datos estructurados) con las reglas de `web/datos/normas.json` y las del
validador de contenidos de la vuelta 9 (`validar-contenido.py`, copiadas en `web/lib/normas.js`),
con los mismos límites de palabra que Python. Una frase prohibida (un medicamento de receta,
«garantizado», «sin riesgos», la nota de Google, un precio fuera de las tarjetas regalo…) es un
error y no hay web. Los avisos (palabras que conviene mirar, como «EvoSculpt» o «4D») quedan en
`informe.json` → `avisos_normas`. Las normas nuevas van a `web/datos/normas.json`; si cambia el
validador, cambia también su lista en `web/lib/normas.js`.

**Lo que falta por confirmar** se escribe `[PENDIENTE: lo que falta]`, **corto** («horario del
sábado», «correo»): en la web sale resaltado en amarillo para que nadie lo pase por alto. El
detalle (de dónde sale la duda, qué dice cada fuente) va en el campo `pendiente` del JSON o en un
`_detalle`, que solo llegan a `informe.json`. El informe cuenta las marcas de cada página
(`pendientes_visibles`) y agrupa sus textos (`pendientes_textos`, con cuántas páginas y un
ejemplo). Una sección cuyo único contenido sería un hueco no se pinta (el aparcamiento de
`/clinica/`, por ejemplo).

**Los textos legales** son Markdown normal (títulos, listas, tablas y enlaces). Las citas (`> …`)
son notas para la revisión: salen en un recuadro «Nota para la revisión · no se publicará» y se
borran del `.md` cuando el abogado dé el visto bueno. Los enlaces a `./privacidad.md` y compañía
pasan a `/privacidad/`. El generador quita de `aviso-legal.md` el anexo, de `cookies.md` la
variante B y de `privacidad.md` los apartados que no se publican, y de la tabla de profesionales
del aviso legal a quien no sale en la web (su tratamiento está en borradores); la declaración de
accesibilidad sale del anexo del aviso legal.

**La ficha de Google.** Solo un enlace neutro, «Nuestra ficha en Google», en `/pedir-cita/`
(`sitio.json` → `google.ficha`). Ni la nota ni el número de opiniones: las normas no permiten
reseñas como reclamo en la web de un centro sanitario, y `normas.json` lo prueba.

## Fotos

`npm run web:fotos -- --origen <carpeta>` pasa a WebP (480, 960 y 1600 px como mucho, sin
agrandar) las fotos de `web/fotos/fotos.json` que tienen `"usar": true`; al construir solo se copian
a `dist` las que usa alguna página. Cada foto lleva su origen, sus derechos (`propia`), su `alt` y,
si hace falta, un `recorte` `[x, y, ancho, alto]` del original: la fachada, por ejemplo, se publica
recortada a la entrada y al logotipo (`clinica-fachada-entrada`), sin el escaparate, que anuncia
servicios pendientes de autorización y es texto dentro de la imagen. Cada especialidad puede tener
su foto (`foto` y `foto_pie` en `especialidades.json`). **Nunca fotos de pacientes**, ni antes y
después.

## Borradores y páginas provisionales

- **Borradores.** Los servicios que la autorización sanitaria no cubre todavía están en
  `web/contenido/pendientes/`: el área de control de peso (supervisión médica, dietética y
  nutrición, balón gástrico y neuroestimulación para el control del apetito), la sudoración
  excesiva, las varices y arañas vasculares, la ginecología funcional (incontinencia urinaria de
  esfuerzo, sequedad y atrofia vaginal, laxitud vaginal, liquen escleroso vulvar, perineoplastia y
  cirugía del suelo pélvico) y el injerto capilar para quien viene de Francia. No salen en `web/dist`.
  `node web/construir.js --borradores` construye `web/dist-borradores/` con todo, una franja
  «Borrador: pendiente de autorización» en cada página, `noindex` y un `robots.txt` que lo cierra.
  **Esa carpeta no se sube nunca.** Cuando la clínica confirme la autorización, la página pasa de
  `pendientes/<grupo>.json` a `<grupo>.json` (y su id sale de `sin_pagina`). El peso volvería en
  `/control-de-peso/`, sin «nutricional», sin grelina y sin el sobrepeso como reclamo.
- **Provisionales.** Si el catálogo tiene un tratamiento activo que ningún contenido cubre, el
  generador le hace una página con un nombre neutro (`web/datos/provisionales.json`), textos
  genéricos según sea médico, de cirugía, de estética o capilar, y el aviso «texto provisional».
  Los que el catálogo marca como oferta sin confirmar no tienen página. La lista queda en
  `informe.json` → `provisionales`. Hoy no hay ninguna: los cinco grupos tienen texto.

## WhatsApp, referencias y campañas

Cada botón de WhatsApp abre `https://wa.me/34722833285` con el mensaje escrito (codificado con
`%20`, como pide wa.me):

> Hola, vengo de la web y me interesa: Lipoláser. (ref. web-lipolaser)

- La referencia nunca es un id del catálogo: `web-inicio` en la portada, `web-<especialidad>`,
  `web-<tratamiento>`, `web-tarjeta-<importe>`, `web-tarjeta-regalo`, `web-tarjeta-canje`…
- Lo íntimo no se nombra en el mensaje (se ve en la pantalla del móvil y pasa por Meta), ni en las
  páginas de tratamiento ni en las de especialidad: dicen «Salud íntima femenina» o «Salud íntima
  masculina», y la referencia es un código (`web-intima-f-…`, `web-intima-m-…`).
- `semillas/iemec/referencias-web.json` traduce cada referencia a su id principal del catálogo, su
  página y su especialidad, y guarda los grupos del «¿Qué te interesa?». Se genera en cada
  `npm run web`. **La app ya lo usa:** cuando llega un primer WhatsApp con «(ref. web-…)», da de
  alta un lead «WhatsApp de la web» con su referencia y su tratamiento (ver
  `docs/WHATSAPP-Y-LEADS.md`).
- Si la visita llega con `?utm_campaign=…` (y el resto de `utm_*`), la web lo guarda en
  `sessionStorage` (clave `iemec-campana`, se borra al cerrar la pestaña). El formulario lo envía en
  campos ocultos, y los WhatsApp pasan a «(ref. web-lipolaser · c-1x2y3z)»: una huella corta de la
  campaña (FNV-1a en base 36, la de `web/lib/modelo.js`), **nunca su nombre**, porque el mensaje
  pasa por Meta y una campaña puede nombrar un tratamiento íntimo. La app guarda esa huella con el
  lead (`utm.clave_campana`). No se guardan `gclid` ni `fbclid`.

## Formulario «Te llamamos»

El formulario de cada tratamiento y de `/pedir-cita/` envía un `POST`
`application/x-www-form-urlencoded` a `https://agenda.iemec-clinic.com/web/contacto`
(`sitio.json` → `api`), la ruta de la app (`servidor/rutas/web.js`). En las fichas va plegado,
pero «Te llamamos» lo abre y pone el foco en el nombre (sin JavaScript sale abierto). Campos:

| Campo | Qué lleva |
| --- | --- |
| `nombre`, `telefono` | Obligatorios (máx. 80 y 20) |
| `email` | Opcional (máx. 120); obligatorio si elige que le contestemos por correo |
| `tratamiento` | En un tratamiento, su referencia (`web-lipolaser`); si no, un grupo: el slug de la especialidad, `estetica-y-bienestar`, `tarjeta-regalo` u `otra`. En lo íntimo va el grupo neutro y el tratamiento sale de `ref`. Nunca un id del catálogo |
| `mensaje` | Opcional, máx. 500 |
| `preferencia` | `whatsapp`, `llamada` o `correo`; ninguna marcada de antemano |
| `privacidad` | `si`: obligatoria, nunca marcada de antemano |
| `comercial` | `si` si acepta comunicaciones comerciales (opcional, sin marcar) |
| `pagina`, `ref` | La página y su referencia (`web-…`) |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | La campaña, si la hay |
| `t` | Milisegundos desde que se abrió la página: un envío en menos de 2,5 s es de un robot. **Vacío = sin JavaScript: no se descarta** |
| `version_textos` | Versión de las cláusulas aceptadas: la fecha de los textos más una huella de su contenido exacto. `npm run web` guarda cada versión con sus textos en `semillas/iemec/textos-formulario.json` (sin borrar las anteriores) y la app marca las que no conoce |
| `envio` | Identificador al azar de cada envío (lo pone `web.js`): la app no guarda dos veces el mismo |
| `web` | Trampa para robots: si viene con algo, se contesta «recibido» y no se guarda nada |

Respuesta de la app:

- Sin JavaScript: `303` a `https://iemec-clinic.com/gracias/`, o una página sencilla con los
  errores. El navegador ya valida antes lo obligatorio (el formulario no lleva `novalidate`; lo
  pone `web.js` al cargar, para pintar los errores a su manera).
- Con JavaScript (`Accept: application/json`, `fetch` sin credenciales y con
  `redirect: 'manual'`): `200 {"ok": true}`, `422 {"ok": false, "errores": {"telefono": "…"}}` (la
  web pinta cada error junto a su campo; los que no tienen hueco, en el aviso) o `429` (demasiados
  envíos: la web propone WhatsApp). Un `303` también cuenta como recibido.
- CORS y origen: solo `WEB_DOMINIO` (por defecto `https://iemec-clinic.com`) y `WEB_ORIGENES`. Lo que
  llega de otra web (Origin ajeno o `Sec-Fetch-Site: cross-site`) se contesta «recibido» y no se
  guarda nada.
- Límites: 8 envíos por IP cada 15 minutos y 20 al día; 3 por teléfono al día (en silencio: se
  contesta «recibido» y no se guarda); y un tope de 20 altas por hora en total, por encima del cual
  solo sale una tarea «N solicitudes de la web en la última hora».
- **El teléfono no está comprobado:** el lead nace «sin verificar», no se une a los datos de nadie y
  no se le escribe con lo que puso quien lo envió. Quien pide WhatsApp recibe primero la plantilla
  de utilidad `iemec_solicitud_web` (neutra, sin nombre ni tratamiento, botones «Sí, fui yo» y «No
  fui yo»; hay que aprobarla en Meta: puerta ⛔ 5) y solo con su «sí» sigue la conversación. Quien
  pide llamada o correo genera una tarea «sin verificar» que recepción confirma en Tareas
  («Confirmado: lo pidió»).
- La casilla comercial manda: sin ella, solo el seguimiento de su solicitud mientras esté en curso;
  con ella y verificado, pasa a los consentimientos de su ficha con su prueba y su versión.
- Lo pedido (página, referencia, tratamiento, mensaje) va cifrado en `solicitudes_web` (migraciones
  015 y 017). Una solicitud sin confirmar caduca a los 7 días y se borra a los 30; un lead de la web
  sin cita ni actividad, a los 12 meses (`RETENCION_LEADS_MESES`).

## Publicar

0. **Primero la app** con las migraciones `015-formulario-web.sql` y `017-verificar-formulario-web.sql`
   y, si la web va en otro dominio, `WEB_DOMINIO` (y `WEB_ORIGENES` para un dominio de prueba): sin
   ella, el formulario no tiene a dónde enviar (ver `docs/DESPLIEGUE.md`). **Cada vez que la web
   estrene páginas o cambie los textos del formulario**, despliega antes la app con los
   `semillas/iemec/referencias-web.json` y `semillas/iemec/textos-formulario.json` que genera
   `npm run web`: si no, la app no reconoce esas referencias ni esa versión de las casillas.
1. `npm run web:fotos -- --origen <carpeta>` si hay fotos nuevas (las WebP no están en git).
2. `npm run web` sin errores y `node web/construir.js --publicar` sin errores: ningún
   `[PENDIENTE]` a la vista, el correo del aviso legal puesto y ningún borrador.
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
   (sin distinguir mayúsculas y con o sin barra final; cuando el tratamiento principal de un
   artículo no tiene página, van al destino del inventario y no a otro tratamiento que solo se
   mencionaba) y las 101 anclas antiguas (`/facial#relleno-de-labios`, `/corporal#sudor`…) las
   resuelve `web/js/web.js` en la página de destino, con huellas y sin dejar los textos viejos en
   el HTML. La ficha de Google Business Profile sigue con la misma URL.

## Privacidad, rendimiento y accesibilidad

- **Sin cookies ni terceros**, así que no hace falta banner. Lo único que se guarda son los `utm_*`
  de la campaña en `sessionStorage` (explicado en `/cookies/` y `/privacidad/`). El mapa es un
  enlace a Google Maps y a Apple Maps, no un mapa incrustado. Si algún día se añade analítica, hará
  falta consentimiento.
- **Cabeceras** en el `.htaccess`: CSP sin scripts en línea (salvo los bloques JSON-LD, que no
  ejecutan), HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, sin marcos; compresión y
  caché larga para `/fuentes/`, `/fotos/` y `/recursos/` (llevan huella en el nombre).
- **Tamaños máximos**, que comprueba el generador: HTML 70 KB por página, CSS 45 KB y JS 20 KB.
  Hoy: 53 KB la página más grande, 44 KB el CSS y 15 KB el JS (los dos, minificados).
- **Fotos** en WebP con `srcset` y `sizes` ajustados al hueco, ancho y alto, y carga diferida salvo
  la primera. Seis tipografías (Montserrat 300, 400, 500 y 600; Playfair Display 500 normal y
  cursiva), dos precargadas.
- **SEO:** `sitemap.xml`, `robots.txt`, canónica, imagen para redes de 1200 × 630, `MedicalClinic`
  en todas las páginas (con el registro CS17886), migas (`BreadcrumbList`) y
  `MedicalProcedure`/`Service` en cada tratamiento.
- **Accesibilidad (WCAG 2.2 AA):** contrastes medidos (el oro, el champán y el turquesa nunca son
  texto sobre marfil; el oro de texto es `#7d5d22`), foco visible y nunca tapado por la barra de
  abajo (`scroll-padding-bottom`), enlace para saltar al contenido, zonas de toque de 44 px como
  mínimo, menú del móvil que atrapa el foco y se cierra con Escape, desplegable de escritorio que
  se cierra al salir con Tab, errores del formulario junto a cada campo y anunciados, y el foco
  nunca cae al principio de la página tras un error. En pantallas bajas (móvil apaisado o zoom al
  400 %) la cabecera deja de ser fija y la barra de abajo es solo de iconos; se respetan las zonas
  seguras del iPhone. El brillo del filete dorado pasa dos veces, solo al verse, y nada se mueve con
  «reducir movimiento». Al imprimir sale todo. Sin JavaScript todo funciona: el menú lleva al del
  pie y el formulario se envía igual.
- **Borrador de la declaración de accesibilidad** en `/accesibilidad/`, pendiente de fecha y de
  revisión.

## El logotipo

La web usa el logotipo turquesa en PNG de la web actual, recortado y pasado a WebP: sobre el
terciopelo se ve bien, pero es un mapa de bits. **Pide a la clínica el logotipo vectorial (SVG, AI,
EPS o PDF vectorial)** para la cabecera, el favicon y la imagen para redes. Si en `fotos.json` no
hay logotipo, la web usa uno tipográfico (IEMEC en Playfair con el nombre completo debajo).

## Pendiente de la clínica

Todo esto sale en la web como `[PENDIENTE: …]` o está en `informe.json` (`pendientes_textos`,
`contenido_pendiente`, `revision_medica` y `sin_pagina`):

- **Datos de la clínica:** horario del sábado (Google dice de 11:00 a 20:00 y Treatwell, de 10:00
  a 20:00); correo propio del dominio (hoy solo hay un Gmail; el aviso legal y la privacidad lo
  necesitan); «local 35» o «locales 35-36»; domicilio social y datos del Registro Mercantil (tomo,
  folio, hoja); aparcamiento y transporte público más cercanos.
- **Autorización sanitaria CS17886:** qué cubre la unidad U.900 (en medicina capilar); qué
  servicios de la zona íntima cubre (la ginecología, U.26, no figura); si cubre el área de peso
  (Endocrinología U.10 y Nutrición U.11), la sudoración excesiva y las varices; y los 41
  tratamientos del catálogo que no tienen página (`informe.json` → `sin_pagina`, cada uno con su
  motivo).
- **Cirugías:** nombre, especialidad oficial y número de colegiado del cirujano de cada cirugía (y
  el reconocimiento en España del título de especialista de Marco Vricella, que hasta entonces se
  presenta como médico con formación en cirugía plástica); dónde se opera cada una (el hospital de
  la cirugía estética; si el injerto capilar se hace en la sala de IEMEC) y con qué anestesia; y la
  política con menores de 18 años.
- **Equipo y quién hace cada cosa:** responsable asistencial (dirección médica); titulación,
  especialidad y número de colegiado de cada profesional; si Paola Ranilla es «Dra.»; profesión de
  Paula Vicent; quién hace el diagnóstico capilar, el microneedling capilar, la luz pulsada y la
  valoración de los tratamientos de estética con producto; retrato de Marcela Pedraza; nombres y
  titulación del equipo de estética y de enfermería; retratos nuevos en alta resolución, coherentes
  entre sí.
- **Marca y fotos:** logotipo vectorial; emblema oficial «Cofinanciado por la Unión Europea» del
  FSE+ (el de la web actual está dañado), con la convocatoria, el organismo y la fecha hasta la
  que hay que mantener el aviso; fotos de las instalaciones actuales, de la entrada y del head spa;
  los originales de los 4 vídeos de ginecología que hoy están en Vimeo.
- **Tarjetas regalo:** pago online (hoy lo cobra la tienda de SITE123, que desaparece), condiciones
  de compra (forma de pago, desistimiento de 14 días, confirmación del pedido), cómo se comprueban
  las tarjetas ya vendidas (no llevan código único) y qué hacer con los vales de 20 € de la
  encuesta.
- **Legal:** revisión del abogado sanitario y del delegado de protección de datos de todos los
  textos legales y de las cláusulas del formulario (y la versión de la cláusula); nombre y correo
  del DPD; proveedores (alojamiento, correo, WhatsApp Business, app de gestión) y sus regiones;
  que el código de campaña está exento de consentimiento y la base de su medición; plazos de
  conservación; arbitraje de consumo y códigos de conducta; fecha de publicación de los textos; y,
  si contesta el asistente virtual de la app, decir que es una IA que se presenta como tal.
- **Contenido:** la revisión médica de las 63 páginas marcadas (`informe.json` →
  `revision_medica`) y las 301 notas de contenido (`contenido_pendiente`); los borradores de
  `web/contenido/pendientes/` cuando haya autorización.
- **Campañas y dominios:** las páginas de campaña de SITE123 (`/aprende`,
  `/lipolaser-agenda-tu-cita`) redirigen al lipoláser: si hay anuncios activos, cambiar antes su
  destino (y el diagnóstico de lipoláser, que solo se reserva los martes, lo lleva la agenda de la
  app); la landing en francés (`/recuperez-vos-cheveux-a-madrid`) va a `/cirugia-capilar/`, o a
  `cliniquecapillaire-iemec.es` si la clínica lo prefiere; Search Console y cualquier analítica
  que hoy lleve Uebea.
