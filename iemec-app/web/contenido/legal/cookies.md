# Política de cookies

> **Borrador para revisión** · 30-09-2026. La web nueva se diseña **sin cookies ni servicios de
> terceros que necesiten consentimiento** (fuentes alojadas en el propio servidor, sin Google
> Analytics, sin píxel de Meta, sin mapas ni vídeos incrustados, sin reCAPTCHA). Así no hace falta
> banner (LSSI, art. 22.2; [Guía sobre el uso de las cookies de la AEPD, mayo de 2024](https://www.aepd.es/guias/guia-cookies.pdf)).
> El apartado 2 lo comprueba `node web/revisar.mjs` en un Chromium de verdad: después de recorrer
> todas las páginas, también llegando con un código de campaña, no queda ninguna cookie ni nada en
> el almacenamiento local ni en el de sesión. El código de campaña ya no se guarda en el navegador
> (antes iba en `iemec-campana`, en el de sesión): medir los anuncios no es un servicio que pida quien
> visita la web y no estaría exento de consentimiento (LSSI, art. 22.2; guía de cookies de la AEPD).
> Ahora solo lo usan el formulario y los botones de WhatsApp de la página a la que se llega. Si algún
> día se añade analítica, mapas o vídeos, se usa la variante B del final.
> Hoy iemec-clinic.com carga dos propiedades de Google Analytics, dos píxeles de Meta, Google
> Fonts y reCAPTCHA, con un banner de SITE123: nada de eso pasa a la web nueva.

---

## Variante A · Para publicar (web sin cookies de terceros)

### 1. Qué son

Las cookies son pequeños archivos que una web guarda en tu navegador. Hay otras técnicas parecidas
(como el almacenamiento local del navegador) a las que se aplican las mismas reglas.

### 2. Qué usa esta web

**Esta web no usa cookies y no guarda nada en tu dispositivo**: ni cookies propias ni de terceros,
ni almacenamiento local o de sesión. Por eso no te pide consentimiento.

Si llegas desde un anuncio o un enlace con código de campaña, ese código va en la dirección de la
página (por ejemplo, `?utm_campaign=…`). Esa página lo pone en su formulario y en sus botones de
WhatsApp para saber de qué campaña llega tu solicitud, pero no lo guarda: si pasas a otra página, se
pierde. Qué hacemos con él lo explica la [Política de privacidad](./privacidad.md).

### 3. Enlaces a otros servicios

Si pulsas el botón de WhatsApp, «Cómo llegar» (Google Maps) o el enlace a nuestras redes sociales,
sales de esta web y entras en el servicio de otra empresa, que usa sus propias cookies según su
política. Hasta que no pulsas, esos servicios no reciben nada desde nuestra web.

### 4. Cómo borrarlas

Esta web no guarda nada en tu dispositivo. Si quieres borrar lo que guardan otras webs o servicios,
puedes hacerlo desde la configuración de tu navegador (apartado de privacidad o datos de sitios).

### 5. Cambios

Si algún día usamos cookies que necesiten tu consentimiento, te lo pediremos antes con un aviso
claro y podrás rechazarlas con la misma facilidad que aceptarlas.

Última actualización: {{fecha_textos}}

---

## Variante B · Solo si se añaden analítica, mapas o vídeos (no publicar sin revisarla)

Si se incorpora cualquiera de estos servicios, hace falta consentimiento previo y esta variante
sustituye al apartado 2:

| Servicio | ¿Necesita consentimiento? | Alternativa sin consentimiento |
|---|---|---|
| Google Analytics, Google Tag Manager con etiquetas de terceros | Sí | Analítica propia sin cookies, o que cumpla las condiciones de exención de la [guía de la AEPD sobre medición de audiencia (enero de 2024)](https://www.aepd.es/guias/guia-cookies-analiticas-externas.pdf): solo estadísticas anónimas para IEMEC, sin cruzar datos ni cederlos, cookie de 13 meses como máximo y datos de 25 meses como máximo |
| Píxel de Meta, TikTok, Google Ads | Sí (y en páginas de salud, desaconsejado: puede revelar el interés por un tratamiento) | Ninguna: no se usan en la web |
| Mapa de Google incrustado | Sí | Imagen estática del mapa con enlace a Google Maps |
| Vídeos de YouTube o Vimeo incrustados | Sí (también «youtube-nocookie», que guarda datos en el navegador) | Vídeo alojado en el propio servidor, o miniatura que carga el vídeo solo al pulsar, con aviso |
| reCAPTCHA | Sí, según el criterio mayoritario (Google usa los datos para sus fines) | Campo trampa y límite de envíos en el propio servidor |
| Fuentes de Google cargadas desde Google | No es una cookie, pero envía la IP del visitante a Google | Fuentes alojadas en el propio servidor |

Requisitos del aviso (Guía de la AEPD, mayo de 2024):

1. **Primera capa** visible al entrar, sin tapar la información legal, con: quién usa las cookies,
   para qué, si hay terceros, y **tres botones**: «Aceptar», «Rechazar» (igual de visible que
   aceptar) y «Configurar».
2. **Nada se carga antes de aceptar.** Ninguna casilla premarcada. Seguir navegando no es
   consentir.
3. **Sin muro de cookies**: la web funciona igual si se rechazan.
4. **Retirar el consentimiento** tan fácil como darlo: enlace permanente «Configurar cookies» en el
   pie.
5. **Renovar** el consentimiento como máximo cada 24 meses, y antes si cambian las cookies.
6. **Segunda capa** con la tabla completa: nombre, propia o de tercero, finalidad, duración y
   transferencias internacionales (p. ej., Google LLC a EE. UU. con el Marco de Privacidad de Datos
   UE-EE. UU.).
7. **Registro del consentimiento** (fecha, versión del aviso y elecciones).
8. Nunca enviar a Meta o a Google el nombre del tratamiento que mira el visitante: puede ser un dato
   de salud (RGPD, art. 9).
