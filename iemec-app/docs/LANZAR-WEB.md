# Lanzar la web nueva de IEMEC

La web nueva (`web/`) está hecha y revisada. Este documento dice qué falta para ponerla en
https://iemec-clinic.com en lugar de la de SITE123, quién tiene que darlo y los pasos exactos. El
detalle de cada dato pendiente, con su clase, está en [`web/datos/lanzamiento.json`](../web/datos/lanzamiento.json);
lo que se ve de cada uno en la vista previa, en `web/dist/informe.json` → `lanzamiento`.

**Hoy (30-09-2026) no se puede publicar:** `node web/construir.js --publicar` falla con la lista de
los cinco imprescindibles de abajo, todos de la clínica. Todo lo demás está resuelto o sale con una
redacción neutra y cierta hasta que llegue. En cuanto estén los cinco y los accesos, se sube en un
paso.

Cómo se ha clasificado cada `[PENDIENTE]`:

- **a · imprescindible:** sin él la web no cumple la ley o dice algo que puede engañar. `--publicar`
  falla y lo lista.
- **b · se oculta hasta tenerlo:** se publica sin ese dato, con una redacción neutra y cierta (el
  sábado, por ejemplo: solo el horario confirmado y «Otros horarios, consúltanos»). Se completa
  después sin prisa.
- **c · completado ya** con fuentes oficiales y públicas, sin preguntar a la clínica: los datos del
  Registro Mercantil y el domicilio social (BORME), la dirección del Registro de centros sanitarios
  y el emblema oficial «Cofinanciado por la Unión Europea» (Comisión Europea y UAFSE).

## 1. Imprescindible para lanzar

| # | Qué | Por qué | Quién | Dónde se pone |
|---|---|---|---|---|
| 1 | **Correo propio** con el dominio de la clínica (p. ej. `hola@iemec-clinic.com`), que alguien lea a diario. Un Gmail no vale | LSSI, art. 10.1.a; el formulario y la privacidad dicen dónde ejercer los derechos (RGPD, arts. 12 y 13) | Clínica (la dirección y quién la lee) y Uebea o quien lleve el dominio (crear el buzón: hoy el dominio **no tiene correo**, no hay registros MX) | `web/datos/sitio.json` → `correo` |
| 2 | **Delegado de protección de datos**: persona o empresa y su correo. Si no lo hay, nombrarlo (puede ser un servicio externo) | Obligatorio para un centro sanitario (LOPDGDD, art. 34.1.l) y su contacto se publica (RGPD, arts. 13.1.b y 37.7) | Clínica | `web/datos/sitio.json` → `dpd` |
| 3 | **Quién opera y dónde**: nombre, número de colegiado y, si la tiene, especialidad oficial reconocida en España de quien hace cada cirugía; y dónde se operan el injerto capilar y la labioplastia | normas.md, apartado j (Código de Deontología Médica, art. 90; Ley 44/2003, art. 16.3; Ley 3/1991, art. 5.1.a). El título de especialista del Dr. Vricella está pendiente de reconocimiento | Clínica | `web/datos/equipo.json` (`colegiado`, `especialidad`, `colegio`, `opera`); `web/datos/especialidades.json` → cirugia-capilar → `donde_cirugia`; la labioplastia en `web/contenido/intima-y-cirugia.json` |
| 4 | **Visto bueno médico** de las 63 páginas de tratamientos médicos (`informe.json` → `revision_medica`) | normas.md (lista para quien revisa, punto 12): un dato médico equivocado engaña | Clínica (médico responsable) | `web/datos/lanzamiento.json` → `vistos_buenos.medico.fecha` |
| 5 | **Visto bueno legal** del aviso legal, la privacidad, las cookies, la accesibilidad y las casillas del formulario | normas.md: «antes de publicar, lo revisan» el abogado sanitario y el DPD (puerta ⛔ 9) | Clínica (abogado sanitario y DPD) | `web/datos/lanzamiento.json` → `vistos_buenos.legal.fecha` (es la «Última actualización» de los textos) |

Y para poder subirla (no son datos de la web, pero sin ellos no se lanza):

| Qué | Quién |
|---|---|
| **Alojamiento** con cPanel (o FTP/SFTP) y acceso a `public_html` del dominio principal, con Apache y `.htaccess` (`mod_rewrite`, `mod_headers`, `mod_deflate`). Puede ser el mismo cPanel de la app (LucusHost, `docs/DESPLIEGUE.md`) | Eduardo (con la clínica, si hay que contratarlo) |
| **La app publicada** en `https://agenda.iemec-clinic.com` con la migración `015-formulario-web.sql` y `WEB_DOMINIO=https://iemec-clinic.com`: recibe el formulario «Te llamamos» y los WhatsApp de la web. Hoy `agenda.iemec-clinic.com` **no existe** en el DNS | Eduardo (y Uebea, el registro del subdominio) |
| **Acceso al DNS** de iemec-clinic.com para cambiar los registros de la web y crear los de `agenda` y del correo | Uebea (o quien tenga la cuenta del dominio) |

Si la clínica tarda en mandar el punto 3 y prefiere lanzar antes, se puede lanzar sin las
cirugías: se pasan sus páginas (las 10 de cirugía estética, con la consulta con el cirujano; las 5
cirugías capilares y la labioplastia) de `web/contenido/*.json` a `web/contenido/pendientes/`, sus
ids del catálogo a `sin_pagina` del mismo grupo con el motivo, y se quita la pregunta «¿Dónde se
hace la intervención?» de cirugía capilar en `web/datos/especialidades.json`. Probado: así
`--publicar` pasa con 78 páginas. Lo que se queda sin páginas desaparece de menús y portada, y sus
URL viejas van a `/tratamientos/` hasta que vuelvan. Es una decisión de la clínica: se pierde,
mientras tanto, lo que más se busca.

## 2. Se completa después (no bloquea)

Todo esto se publica ya con una redacción neutra y cierta (qué dice exactamente: `lanzamiento.json`
→ `publicado` de cada dato). Cuando llegue, se pone donde dice `como_completar`.

| Qué | Cómo sale mientras | Quién |
|---|---|---|
| Horario del sábado (Google dice 11-20; Treatwell, 10-20) | «Lunes a viernes, de 11:00 a 20:00. Otros horarios, consúltanos.» | Clínica |
| Titulación y colegiado de cada profesional, si Paola Ranilla es «Dra.», la profesión de Paula Vicent, el responsable asistencial, el equipo de estética y de enfermería, retratos | Nombre, función y biografía; en el aviso legal, que esos datos se dan a quien los pida | Clínica |
| Quién hace el diagnóstico, el microneedling y las cicatrices capilares; quién aplica la luz pulsada; quién valora los tratamientos de estética con producto | «El equipo del área capilar de IEMEC», «personal sanitario, con valoración médica previa», sin decir quién valora | Clínica |
| El hospital donde se operan las cirugías mayores (Multiestetica cita el Hospital Universitario Moncloa), su anestesia e ingreso | «Quirófano de un centro hospitalario autorizado» | Clínica |
| Política con menores (la web actual anuncia la otoplastia «a partir de los 10 años») | No se dice nada de la edad | Clínica |
| Qué cubre la unidad U.900 (medicina capilar) y la autorización en la estética íntima | «U.900 Otras unidades asistenciales», como el Registro, y sin notas | Clínica (y abogado) |
| Estatutos del colegio de cada médico, códigos de conducta, arbitraje de consumo | Sin enlace; sin mención (solo es obligatorio si los hay) | Clínica |
| Convocatoria y fecha de fin del aviso del FSE+ | El aviso de la web actual con el emblema oficial | Clínica |
| Tarjetas regalo: pago online, condiciones de compra, cómo se comprueban las ya vendidas | Se piden por WhatsApp (la web no las vende); sin el apartado de compra online | Clínica |
| Privacidad: plazos de conservación, nombres de los proveedores, bases que valida el DPD, medidas de seguridad | Criterios en vez de plazos, categorías de proveedores, sin notas | Clínica (DPD) y Eduardo (contratos de encargo) |
| Asistente virtual (si se activa la IA en WhatsApp) | El párrafo no sale | Eduardo y clínica |
| Logotipo vectorial (SVG, AI, EPS o PDF), fotos actuales de la entrada y del head spa, originales de los vídeos de Vimeo | La web usa el logotipo en PNG y las fotos que hay | Clínica |
| Borradores que esperan autorización (control de peso, varices, sudoración, ginecología funcional, injerto para Francia) | No se publican; sus URL viejas van a `/tratamientos/` | Clínica (autorización) |
| Anuncios activos hacia las páginas de campaña de SITE123 (`/aprende`, `/lipolaser-agenda-tu-cita`) y la página en francés | Redirigen al lipoláser y a `/cirugia-capilar/` | Clínica y Uebea |
| Search Console y cualquier analítica que hoy lleve Uebea | La web nueva no tiene analítica ni cookies | Uebea |

## 3. Los accesos

Comprobado el 30-09-2026 en fuentes públicas (RDAP de Verisign y DNS público):

- **El dominio** `iemec-clinic.com` está registrado en NameCheap, Inc. hasta el **13-04-2027**
  (renovarlo antes) y usa sus DNS (`dns1.registrar-servers.com` y `dns2.registrar-servers.com`).
  Quien tenga esa cuenta (según la clínica, Uebea) cambia los registros o da acceso para hacerlo.
- **Hoy:** `iemec-clinic.com` → registro `A` `34.202.63.170` (SITE123); `www` → `CNAME`
  `iemec-clinic.com`. **No hay registros `MX` ni `TXT`**: el dominio no tiene correo ni
  verificaciones. `agenda.iemec-clinic.com` no existe.
- **Lo que hay que cambiar el día del lanzamiento:** el `A` de `iemec-clinic.com` a la IP del
  alojamiento; `www` puede seguir como `CNAME` de `iemec-clinic.com` (o un `A` a la misma IP). Los
  `MX` y `TXT` que haya ese día (los del correo nuevo, verificaciones de Google…) **no se tocan**.
- **Antes, sin prisa:** el `A` de `agenda` a la IP de la app; los `MX`, el SPF y el DKIM del correo
  nuevo (el cPanel los da en «Email Deliverability» si el correo va en el alojamiento); y, si se
  quiere, el `TXT` de Search Console.
- **AutoSSL** (o Let's Encrypt) en el cPanel para `iemec-clinic.com`, `www` y `agenda`: emite el
  certificado cuando el dominio ya apunta al alojamiento. Hasta entonces puede haber un rato sin
  `https`.
- **Search Console:** la propiedad del dominio (se verifica con un `TXT` en el DNS) y, si Uebea ya la
  tiene, acceso de propietario para Eduardo o la clínica.

## 4. Pasos, en orden

1. **Completar lo imprescindible** (apartado 1) en sus archivos y comprobar:

   ```sh
   node web/construir.js --publicar     # sin errores: «Web publicable construida en web/dist…»
   ```

   Si falla, dice qué falta y deja `web/dist` vacío (solo `informe.json`): nada que se pueda subir
   por error. `npm run web` vuelve a hacer la vista previa con los huecos en amarillo.
2. **Publicar primero la app** con la migración `015-formulario-web.sql` y en su `.env`
   `WEB_DOMINIO=https://iemec-clinic.com` (y `WEB_ORIGENES=https://prueba.iemec-clinic.com` si se
   prueba en un subdominio): ver `docs/DESPLIEGUE.md`. Crear el subdominio `agenda` con AutoSSL y
   comprobar `https://agenda.iemec-clinic.com/api/salud`.
3. **Construir la versión para subir**, con las fotos (sus WebP no están en git):

   ```sh
   npm run web:fotos -- --origen <carpeta con las fotos originales>
   node web/construir.js --publicar --zip iemec-web-publicable.zip
   npm run web:revisar                  # 95 páginas × 8 anchos, sin problemas
   ```

   El zip es el contenido de `web/dist` con el `.htaccess` y sin `informe.json`.
4. **Subirla a `public_html`** del dominio principal: cPanel → Administrador de archivos →
   `public_html` → (descargar antes una copia de lo que haya) → «Cargar» el zip → «Extraer» →
   «Configuración» → «Mostrar archivos ocultos» para ver que está el `.htaccess` → borrar el zip del
   servidor. Por FTP, el contenido de `web/dist` tal cual, con el `.htaccess` y sin `informe.json`.
5. **Probarla antes de cambiar el dominio**, de una de dos formas:
   - con el archivo `hosts` del ordenador (Windows: `C:\Windows\System32\drivers\etc\hosts`; Mac y
     Linux: `/etc/hosts`) con la línea `<IP del alojamiento> iemec-clinic.com www.iemec-clinic.com`:
     el navegador avisará del certificado hasta que AutoSSL lo emita; o
   - en un subdominio de prueba con `https` (p. ej. `prueba.iemec-clinic.com`, con su propio
     `public_html`): por `http` o `www` el `.htaccess` manda a https://iemec-clinic.com, que aún es
     SITE123.

   Qué mirar: la portada, un tratamiento, una cirugía, `/aviso-legal/` y `/privacidad/` (sin nada
   en amarillo), el pie con el emblema de la UE, el formulario «Te llamamos» (tiene que llegar a la
   app como lead), un botón de WhatsApp, `/facial` (tiene que ir a `/medicina-estetica-facial/`),
   una URL inventada (la 404) y `/informe.json` (prohibido).
6. **Cambiar el DNS** (Uebea): la víspera, bajar el TTL del `A` a 300 s; el día, cambiar el `A` de
   `iemec-clinic.com` a la IP del alojamiento sin tocar `MX` ni `TXT`; esperar a que AutoSSL emita
   el certificado y comprobar https://iemec-clinic.com y https://www.iemec-clinic.com (tiene que ir
   a la de sin `www`).
7. **Después:**
   - Search Console: enviar `https://iemec-clinic.com/sitemap.xml` e inspeccionar la portada y dos o
     tres tratamientos.
   - **Vigilar los 404** las primeras semanas (Search Console → Páginas → «No encontrada (404)»). Las
     176 URL de SITE123 tienen su 301 en el `.htaccess`; si aparece otra, se añade a
     `web/datos/redirecciones.json`, se construye y se sube la carpeta.
   - La ficha de Google Business Profile no cambia de URL. Cambiar el destino de los anuncios que
     apunten a páginas de campaña de SITE123.
   - **No dar de baja SITE123 hasta comprobar la web nueva** (dos semanas, como poco) y, antes,
     exportar de su tienda las tarjetas regalo vendidas: la tienda se va con SITE123.

## 5. Cuando llega un dato que podía esperar

Nada se toca a mano en el HTML ni en el servidor salvo la carpeta:

1. Se pone el dato donde dice su `como_completar` en `web/datos/lanzamiento.json` (casi siempre
   `web/datos/sitio.json`, `web/datos/equipo.json` o el texto legal) y, si su marca `[PENDIENTE]`
   estaba en un texto, se quita.
2. `node web/construir.js --publicar --zip iemec-web-publicable.zip` y `npm run web:revisar`.
3. Se sube el zip a `public_html` y se extrae encima (o se sube `web/dist` por FTP). Los recursos
   llevan huella en el nombre: los viejos que queden no molestan.

Una redacción neutra cuyo texto ya no aparece (porque el dato se ha completado) sale en
`informe.json` → `lanzamiento.redacciones` con `veces: 0`; el generador solo avisa si queda a la
vista una marca que no es imprescindible (`sin_redaccion_neutra`) o una que no está clasificada
(`sin_clasificar`): entonces hay que añadirla a `lanzamiento.json`.

## 6. Qué comprueba `--publicar`

- Aplica las redacciones neutras de la clase «b» y no publica notas para la revisión, el recuadro
  «revisión del abogado» de los textos legales, franjas de borrador, páginas provisionales ni datos
  de plantilla sin rellenar.
- Falla si queda algún imprescindible (marcas de clase «a», la obligatoria del correo del aviso
  legal o un visto bueno sin fecha), una marca sin clasificar, un borrador (`--borradores`) o un
  enlace interno roto, además de las normas de publicidad sanitaria y los tamaños de siempre.
- Si falla, vacía la carpeta de salida (solo queda `informe.json`) y no hace el zip.
