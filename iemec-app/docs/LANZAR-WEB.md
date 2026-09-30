# Lanzar la web nueva de IEMEC

La web nueva (`web/`) está hecha y revisada. Este documento dice qué falta para ponerla en
https://iemec-clinic.com en lugar de la de SITE123, quién tiene que darlo y los pasos exactos. El
detalle de cada dato pendiente, con su clase, está en [`web/datos/lanzamiento.json`](../web/datos/lanzamiento.json);
lo que se ve de cada uno en la vista previa, en `web/dist/informe.json` → `lanzamiento`.

**Hoy (30-09-2026) no se puede publicar:** `node web/construir.js --publicar` falla con la lista de
los diez imprescindibles de abajo, de la clínica y de su abogado sanitario y su DPD. Todo lo demás
está resuelto o sale con una redacción neutra y cierta hasta que llegue. En cuanto estén los diez (o
la clínica decida lanzar sin las páginas que esperan: apartado 2) y los accesos, se sube en un paso.

Cómo se clasifica lo que falta:

- **a · imprescindible:** sin él la web no cumple la ley o dice algo que puede engañar. `--publicar`
  falla y lo lista. Se detecta por las marcas `[PENDIENTE]` que siguen a la vista, por las
  obligatorias de `normas.json` que faltan (el correo y los números de colegiado del aviso legal) y
  por dos comprobaciones sobre los datos: lo que hay que confirmar de cada página y la colegiación de
  quien se nombra.
- **b · se oculta hasta tenerlo:** se publica sin ese dato, con una redacción neutra y cierta (el
  sábado, por ejemplo: solo el horario confirmado y «Otros horarios, consúltanos»). Se completa
  después sin prisa.
- **c · completado ya** con fuentes oficiales y públicas, sin preguntar a la clínica: los datos del
  Registro Mercantil, que la sociedad es unipersonal y el domicilio social (BORME), la dirección del
  Registro de centros sanitarios y el emblema oficial «Cofinanciado por la Unión Europea» (Comisión
  Europea y UAFSE).

Además de las marcas, cada página de tratamiento lleva sus **notas de redacción** (`pendiente` en
`web/contenido/*.json`: duraciones que son datos del sector, lo que se ha quitado de la web actual…).
No se publican nunca: la vista previa las enseña arriba de cada página, en el recuadro «Nota para la
revisión», para que el médico las tenga delante al dar su visto bueno. Las que no pueden esperar
(si se ofrece, con qué producto, qué dice el abogado) ya no son notas: son preguntas `confirmar`, el
imprescindible 4.

## 1. Imprescindible para lanzar

| # | Qué | Por qué | Quién | Dónde se pone |
|---|---|---|---|---|
| 1 | **Correo propio** con el dominio de la clínica (p. ej. `hola@iemec-clinic.com`), que alguien lea a diario | La LSSI (art. 10.1.a) pide un correo de contacto y el RGPD (arts. 12 y 13), dónde ejercer los derechos. La ley no prohíbe un Gmail, pero el propio deja claro quién es el titular (el Gmail actual no lo dice, y `normas.json` no lo deja publicar) | Clínica (la dirección y quién la lee) y Uebea o quien lleve el dominio (crear el buzón: hoy el dominio **no tiene correo**, no hay registros MX) | `web/datos/sitio.json` → `correo` |
| 2 | **Delegado de protección de datos**: persona o empresa y su correo. Si no lo hay, nombrarlo (puede ser un servicio externo) | Obligatorio para un centro sanitario (LOPDGDD, art. 34.1.l) y su contacto se publica (RGPD, arts. 13.1.b y 37.7) | Clínica | `web/datos/sitio.json` → `dpd` |
| 3 | **Quién opera y dónde**: nombre, número de colegiado y, si la tiene, especialidad oficial reconocida en España de quien hace cada cirugía (también las cicatrices del cuero cabelludo, que pueden acabar en un injerto); y dónde se operan las cirugías capilares y la labioplastia | normas.md, apartado j (Código de Deontología Médica, art. 90; Ley 44/2003, art. 16.3; Ley 3/1991, art. 5.1.a). El título de especialista del Dr. Vricella está pendiente de reconocimiento. 18 páginas | Clínica | `web/datos/equipo.json` (`colegiado`, `especialidad`, `colegio`, `opera`); `web/datos/especialidades.json` → cirugia-capilar → `donde_cirugia`; la labioplastia en `web/contenido/intima-y-cirugia.json` |
| 4 | **Lo que ofrece de verdad cada página**: 37 preguntas en 33 páginas. Si se ofrece (15: la blefaroplastia, los hilos tensores, la carboxiterapia, el mentón y la mandíbula…), con qué producto y con qué régimen legal (17: intralipoterapia, mesoterapias, BB Glow, BB Lips, exosomas y PDRN, redensificación, las cremas del aclarado íntimo…) y lo que tiene que decir el abogado (4: el capuchón del clítoris, la luz pulsada y el acné en U.48, los lunares y las verrugas) o la Comunidad de Madrid (1: el plasma del propio paciente) | Anunciar un servicio que no se ofrece engaña (Ley 3/1991, art. 5; RD 1907/1996, art. 7); un medicamento de receta no se anuncia al público (RDLeg 1/2015, art. 80.1) ni un producto sanitario de uso profesional (RD 1591/2009, art. 38); lo que la autorización no cubre necesita autorización previa (RD 1907/1996, art. 6.2) | Clínica (dirección médica) y abogado sanitario | Con cada respuesta se corrige la página y se quita la pregunta de `confirmar` (`web/contenido/*.json`). La lista: `informe.json` → `lanzamiento` → `imprescindibles` → `paginas-por-confirmar` → `detalle`, y el PDF para la clínica |
| 5 | **Quién hace el diagnóstico capilar**: profesión y título | La página lo presenta como la valoración médica previa de cualquier tratamiento médico; en la web actual lo firma Paula Vicent, sin titulación, y la app lo da a un «tricólogo» | Clínica | `web/contenido/capilar.json` → diagnostico-capilar → `sesion.profesional`; si no es un médico, cambiar también la frase de la valoración médica |
| 6 | **Título y colegiación de quien se nombra**: de las siete personas del equipo, el título académico oficial, el colegio y el número de colegiado y, si el título es de otro país, el Estado y su homologación. De quien no ejerza una profesión sanitaria, decirlo; a quien no se quiera nombrar, se le quita | LSSI, art. 10.1.d: acceso permanente, fácil, directo y gratuito (art. 10.1); «te los damos si nos los pides» no lo cumple (infracción leve, art. 38.4.b). CDM 2022, art. 90 | Clínica | `web/datos/equipo.json` (`titulo`, `colegio`, `colegiado`, `titulo_extranjero`; `colegiado: false` para quien no ejerce una profesión sanitaria) |
| 7 | **Qué cubre la U.900** de la autorización CS17886: basta la resolución de autorización | El Registro solo dice «U.900 Otras unidades asistenciales» y la medicina estética (U.48) es la mejora estética «corporal o facial»: la medicina capilar no encaja sin duda (RD 1907/1996, art. 6; RD 1277/2003, art. 6.2) | Clínica (la resolución) y abogado sanitario | Quitar `pendiente` de medicina-capilar en `web/datos/especialidades.json` y la marca del apartado 2 del aviso legal; si no la cubre, lo capilar que no sea de cabina pasa a `web/contenido/pendientes/` |
| 8 | **La estética íntima en la autorización**: que la labioplastia, el aclarado y la remodelación encajan como U.47, U.64 o U.48 (la ginecología, U.26, no figura) | Lo mismo: la publicidad se ajusta a lo autorizado | Abogado sanitario | Quitar `pendiente` de estetica-intima-femenina en `web/datos/especialidades.json` |
| 9 | **Visto bueno médico** de las 63 páginas de tratamientos médicos (`informe.json` → `revision_medica`), con sus notas de redacción delante | normas.md (lista para quien revisa, punto 12): un dato médico equivocado engaña | Clínica (médico responsable) | `web/datos/lanzamiento.json` → `vistos_buenos.medico.fecha` |
| 10 | **Visto bueno legal** del aviso legal, la privacidad (y sus bases legales: la petición de opinión y la medición de campañas), las cookies, la accesibilidad, las casillas del formulario, las condiciones de las tarjetas regalo y las 36 páginas de publicidad restringida, estética íntima y capilar (`informe.json` → `revision_legal`) | normas.md: «antes de publicar, lo revisan» el abogado sanitario y el DPD (puerta ⛔ 9), también la publicidad | Clínica (abogado sanitario y DPD) | Quitar las dos marcas «validar la base con el DPD» de `web/contenido/legal/privacidad.md` y poner `web/datos/lanzamiento.json` → `vistos_buenos.legal.fecha` (es la «Última actualización» de los textos) |

Y para poder subirla (no son datos de la web, pero sin ellos no se lanza):

| Qué | Quién |
|---|---|
| **Alojamiento** con cPanel (o FTP/SFTP) y acceso a `public_html` del dominio principal, con Apache y `.htaccess` (`mod_rewrite`, `mod_headers`, `mod_deflate`). Puede ser el mismo cPanel de la app (LucusHost, `docs/DESPLIEGUE.md`) | Eduardo (con la clínica, si hay que contratarlo) |
| **La app publicada** en `https://agenda.iemec-clinic.com` con las migraciones `015-formulario-web.sql` y `017-verificar-formulario-web.sql`, `WEB_DOMINIO=https://iemec-clinic.com` y los `semillas/iemec/referencias-web.json` y `textos-formulario.json` que deja `--publicar`: recibe el formulario «Te llamamos» y los WhatsApp de la web. Hoy `agenda.iemec-clinic.com` **no existe** en el DNS | Eduardo (y Uebea, el registro del subdominio) |
| **Acceso al DNS** de iemec-clinic.com para cambiar los registros de la web y crear los de `agenda` y del correo | Uebea (o quien tenga la cuenta del dominio) |
| **WhatsApp en el formulario** (no bloquea): el 722 83 32 85 conectado a la app en modo real y la plantilla `iemec_solicitud_web` («¿Has sido tú?») aprobada en Meta (puerta ⛔ 5). Mientras no esté, el formulario sale sin la opción WhatsApp (`web/datos/sitio.json` → `formulario.whatsapp: false`): ofrece llamada o correo, nada en la web promete el WhatsApp de confirmación y recepción llama a cada solicitud («sin verificar»). Con todo listo y probado, `formulario.whatsapp: true` y se vuelve a publicar | Eduardo (y la clínica: dónde está hoy el 722 y con qué proveedor) |

## 2. Si algo imprescindible tarda: lanzar sin esas páginas

Es una decisión de la clínica. Se pone el id en `web/datos/lanzamiento.json` → `alternativas` →
`aplicar` y `--publicar` deja fuera esas páginas: desaparecen de menús, portada, listados, formularios
y relacionados (y la especialidad que se quede vacía, entera; quien solo trabaja en ella tampoco sale
en «Equipo»), sus tratamientos del catálogo pasan a «sin página» con el motivo y sus URL viejas van a
`/tratamientos/`. Cuando llega lo que faltaba, se quita de `aplicar` y se vuelve a publicar. La vista
previa lo enseña todo siempre.

| Alternativa | Resuelve | Qué sale fuera | Qué más hace |
|---|---|---|---|
| `sin-cirugias` | 3 · quién opera y dónde | Cirugía estética y cirugía capilar enteras (con las cicatrices del cuero cabelludo) y la labioplastia | Quita del diagnóstico, la caída del cabello y el microneedling capilar el injerto como opción («¿Y si ya me he hecho un injerto?», «como el injerto capilar»…). La portada y el pie nombran solo lo publicado («medicina estética y medicina capilar») y la estética íntima ya no dice «cirugía íntima». Probado: ninguna página, salvo los textos legales, anuncia una cirugía |
| `solo-lo-confirmado` | 4 · lo que ofrece de verdad cada página | Las páginas que aún tengan preguntas en `confirmar` (hoy 33, y con ellas la estética íntima femenina, que se queda sin ninguna) | Cada página vuelve en cuanto se contestan las suyas |

Se pierde, mientras tanto, lo que más se busca: por eso es la clínica quien lo decide. Las demás
(el correo, el DPD, el diagnóstico capilar, la colegiación, la U.900, la estética íntima y los vistos
buenos) no tienen alternativa: son pocas cosas, y la clínica las tiene.

## 3. Se completa después (no bloquea)

Todo esto se publica ya con una redacción neutra y cierta (qué dice exactamente: `lanzamiento.json`
→ `publicado` de cada dato). Cuando llegue, se pone donde dice `como_completar`.

| Qué | Cómo sale mientras | Quién |
|---|---|---|
| Horario del sábado (Google dice 11-20; Treatwell, 10-20) | «Lunes a viernes, de 11:00 a 20:00. Otros horarios, consúltanos.» | Clínica |
| La especialidad oficial de cada profesional, si Paola Ranilla es «Dra.», el responsable asistencial, el equipo de estética y de enfermería, retratos | Sin especialidad ni «Dra.» que no consten; el responsable, sin nombrar | Clínica |
| Quién hace el microneedling capilar; quién aplica la luz pulsada; quién valora los tratamientos de estética con producto | «El equipo del área capilar de IEMEC», «personal sanitario, con valoración médica previa», sin decir quién valora | Clínica |
| El hospital donde se operan las cirugías mayores (Multiestetica cita el Hospital Universitario Moncloa), su anestesia e ingreso | «Quirófano de un centro hospitalario autorizado» | Clínica |
| Política con menores (la web actual anuncia la otoplastia «a partir de los 10 años») | No se dice nada de la edad, y la pregunta de la edad del aclarado íntimo no sale | Clínica |
| Estatutos del colegio de cada médico, códigos de conducta, arbitraje de consumo | Sin enlace; sin mención (solo es obligatorio si los hay) | Clínica |
| Convocatoria y fecha de fin del aviso del FSE+ | El aviso de la web actual con el emblema oficial | Clínica |
| Tarjetas regalo: cómo se pagan cuando cierre la tienda de SITE123, cómo se confirma el pedido y cómo se comprueban las ya vendidas | Se piden por WhatsApp. La página ya dice que cada importe es el precio final con impuestos y el desistimiento de 14 días de la compra a distancia (lo revisa el abogado con el visto bueno legal), y la privacidad tiene la finalidad de la compra | Clínica |
| Privacidad: plazo de la documentación clínica, de los registros del servidor y nombres de los proveedores y sus garantías | Las solicitudes, 12 meses (lo que borra la app); lo demás, el mínimo legal, el criterio y las categorías de proveedores | Clínica (DPD) y Eduardo (contratos de encargo) |
| Asistente virtual (si se activa la IA en WhatsApp) | El párrafo no sale | Eduardo y clínica |
| WhatsApp en el formulario | Llamada o correo (apartado 1, «Y para poder subirla») | Eduardo |
| Logotipo vectorial (SVG, AI, EPS o PDF), fotos actuales de la entrada y del head spa, originales de los vídeos de Vimeo | La web usa el logotipo en PNG y las fotos que hay | Clínica |
| Borradores que esperan autorización (control de peso, varices, sudoración, ginecología funcional, injerto para Francia) | No se publican; sus URL viejas van a `/tratamientos/` | Clínica (autorización) |
| Anuncios activos hacia las páginas de campaña de SITE123 (`/aprende`, `/lipolaser-agenda-tu-cita`) y la página en francés | Redirigen al lipoláser y a `/cirugia-capilar/` | Clínica y Uebea |
| Search Console y cualquier analítica que hoy lleve Uebea | La web nueva no tiene analítica ni cookies, y el código de campaña de un anuncio no se guarda en el navegador: solo lo usan el formulario y los WhatsApp de la página a la que se llega | Uebea |

## 4. Los accesos

Comprobado el 30-09-2026 en fuentes públicas (RDAP de Verisign y DNS público):

- **El dominio** `iemec-clinic.com` está registrado en NameCheap, Inc. hasta el **13-04-2027**
  (renovarlo antes) y usa sus DNS (`dns1.registrar-servers.com` y `dns2.registrar-servers.com`).
  Quien tenga esa cuenta (según la clínica, Uebea) cambia los registros o da acceso para hacerlo.
- **Hoy:** `iemec-clinic.com` → registro `A` `34.202.63.170` (SITE123); `www` → `CNAME`
  `iemec-clinic.com`. **No hay registros `MX` ni `TXT`**: el dominio no tiene correo ni
  verificaciones. `agenda.iemec-clinic.com` no existe.
- **Lo que hay que cambiar el día del lanzamiento:** el `A` de `iemec-clinic.com` a la IP del
  alojamiento; `www` se queda como `CNAME` de `iemec-clinic.com` (o un `A` a la misma IP). Los `MX`
  y `TXT` que haya ese día (los del correo nuevo, verificaciones de Google…) **no se tocan**.
- **Antes, sin prisa:** el `A` de `agenda` a la IP de la app; los `MX`, el SPF y el DKIM del correo
  nuevo (el cPanel los da en «Email Deliverability» si el correo va en el alojamiento); y, si se
  quiere, el `TXT` de Search Console.
- **AutoSSL** (o Let's Encrypt) en el cPanel para `iemec-clinic.com`, `www` y `agenda`: emite el
  certificado cuando el dominio ya apunta al alojamiento. Hasta entonces puede haber un rato sin
  `https`.
- **Search Console:** la propiedad del dominio (se verifica con un `TXT` en el DNS) y, si Uebea ya la
  tiene, acceso de propietario para Eduardo o la clínica.

## 5. Pasos, en orden

1. **Completar lo imprescindible** (apartado 1, o decidir una alternativa del apartado 2) en sus
   archivos y construir la versión para subir, con las fotos (sus WebP no están en git):

   ```sh
   npm run web:fotos -- --origen <carpeta con las fotos originales>
   node web/construir.js --publicar --zip iemec-web-publicable.zip   # «Web publicable construida en web/dist…»
   npm run web:revisar                  # todas las páginas × 8 anchos, sin problemas
   ```

   Si falla, dice qué falta (y, del 4 y el 6, qué pregunta o qué persona) y deja `web/dist` vacío
   (solo `informe.json`): nada que se pueda subir por error. `npm run web` vuelve a hacer la vista
   previa con los huecos en amarillo y las notas para la revisión. El zip es el contenido de
   `web/dist` con el `.htaccess` y sin `informe.json`.
2. **Publicar primero la app** con las migraciones `015-formulario-web.sql` y
   `017-verificar-formulario-web.sql` y en su `.env` `WEB_DOMINIO=https://iemec-clinic.com` (y
   `WEB_ORIGENES=https://prueba.iemec-clinic.com` si se prueba en un subdominio): ver
   `docs/DESPLIEGUE.md`. Va con los `semillas/iemec/referencias-web.json` y `textos-formulario.json`
   que acaba de escribir `--publicar` (a git y a desplegar: la app no da por buena una versión de las
   casillas que no conoce). Crear el subdominio `agenda` con AutoSSL y comprobar
   `https://agenda.iemec-clinic.com/api/salud`.
3. **Subirla a `public_html`** del dominio principal: cPanel → Administrador de archivos →
   `public_html` → (descargar antes una copia de lo que haya) → «Cargar» el zip → «Extraer» →
   «Configuración» → «Mostrar archivos ocultos» para ver que está el `.htaccess` → borrar el zip del
   servidor. Por FTP, el contenido de `web/dist` tal cual, con el `.htaccess` y sin `informe.json`.
4. **Probarla antes de cambiar el dominio**, de una de dos formas:
   - con el archivo `hosts` del ordenador (Windows: `C:\Windows\System32\drivers\etc\hosts`; Mac y
     Linux: `/etc/hosts`) con la línea `<IP del alojamiento> iemec-clinic.com www.iemec-clinic.com`:
     el navegador avisará del certificado hasta que AutoSSL lo emita; o
   - en un subdominio de prueba con `https` (p. ej. `prueba.iemec-clinic.com`, con su propio
     `public_html`): por `http` o `www` el `.htaccess` manda a https://iemec-clinic.com, que aún es
     SITE123.

   Qué mirar: la portada, un tratamiento, una cirugía (si se publican), `/aviso-legal/` y
   `/privacidad/` (sin nada en amarillo), el pie con el emblema de la UE, el formulario «Te llamamos»
   (tiene que llegar a la app como lead, con su tarea para recepción), un botón de WhatsApp, `/facial`
   (tiene que ir a `/medicina-estetica-facial/`), una URL inventada (la 404) y `/informe.json`
   (prohibido).
5. **Cambiar el DNS** (Uebea): la víspera, bajar el TTL del `A` a 300 s; el día, cambiar el `A` de
   `iemec-clinic.com` a la IP del alojamiento sin tocar `MX` ni `TXT`; esperar a que AutoSSL emita
   el certificado y comprobar https://iemec-clinic.com y https://www.iemec-clinic.com (tiene que ir
   a la de sin `www`).
6. **Después:**
   - Search Console: enviar `https://iemec-clinic.com/sitemap.xml` e inspeccionar la portada y dos o
     tres tratamientos.
   - **Vigilar los 404** las primeras semanas (Search Console → Páginas → «No encontrada (404)»). Las
     176 URL de SITE123 tienen su 301 en el `.htaccess`; si aparece otra, se añade a
     `web/datos/redirecciones.json`, se construye y se sube la carpeta.
   - La ficha de Google Business Profile no cambia de URL. Cambiar el destino de los anuncios que
     apunten a páginas de campaña de SITE123.
   - **No dar de baja SITE123 hasta comprobar la web nueva** (dos semanas, como poco) y, antes,
     exportar de su tienda las tarjetas regalo vendidas: la tienda se va con SITE123.

## 6. Cuando llega un dato que podía esperar (o una alternativa que ya no hace falta)

Nada se toca a mano en el HTML ni en el servidor salvo la carpeta:

1. Se pone el dato donde dice su `como_completar` en `web/datos/lanzamiento.json` (casi siempre
   `web/datos/sitio.json`, `web/datos/equipo.json`, `web/contenido/*.json` o el texto legal) y, si su
   marca `[PENDIENTE]` estaba en un texto, se quita. Si era una pregunta de `confirmar`, se quita la
   pregunta. Si la clínica había decidido una alternativa y ya no hace falta, se quita de `aplicar`.
2. `node web/construir.js --publicar --zip iemec-web-publicable.zip` y `npm run web:revisar`. Si han
   cambiado páginas o las casillas del formulario, antes se despliega la app con sus
   `semillas/iemec/*.json`.
3. Se sube el zip a `public_html` y se extrae encima (o se sube `web/dist` por FTP). Los recursos
   llevan huella en el nombre: los viejos que queden no molestan.

Una redacción neutra cuyo texto ya no aparece (porque el dato se ha completado) sale en
`informe.json` → `lanzamiento.redacciones` con `veces: 0`; el generador solo avisa si queda a la
vista una marca que no es imprescindible (`sin_redaccion_neutra`) o una que no está clasificada
(`sin_clasificar`): entonces hay que añadirla a `lanzamiento.json`.

## 7. Qué comprueba `--publicar`

- Aplica las alternativas que haya en `aplicar` y las redacciones neutras de la clase «b», y no
  publica notas para la revisión (ni las de cada página ni las de los textos legales), el recuadro
  «revisión del abogado» de los textos legales, franjas de borrador, páginas provisionales ni datos
  de plantilla sin rellenar.
- Falla si queda algún imprescindible: una marca de clase «a» a la vista (también las de la U.900 y
  la estética íntima en su especialidad), una obligatoria del aviso legal (el correo o un número de
  colegiado de verdad, no solo la palabra), una pregunta de `confirmar` en una página que se publica,
  alguien nombrado sin su colegiación o un visto bueno sin fecha. También si hay una marca sin
  clasificar, un borrador (`--borradores`) o un enlace interno roto, además de las normas de
  publicidad sanitaria y los tamaños de siempre.
- Si falla, vacía la carpeta de salida (solo queda `informe.json`) y no hace el zip.
