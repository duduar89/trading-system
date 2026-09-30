# Política de cookies

> **Borrador para revisión** · 30-09-2026. La web nueva se diseña **sin cookies ni servicios de
> terceros que necesiten consentimiento** (fuentes alojadas en el propio servidor, sin Google
> Analytics, sin píxel de Meta, sin mapas ni vídeos incrustados, sin reCAPTCHA). Así no hace falta
> banner (LSSI, art. 22.2; [Guía sobre el uso de las cookies de la AEPD, mayo de 2024](https://www.aepd.es/guias/guia-cookies.pdf)).
> La tabla del apartado 2 la comprueba `node web/revisar.mjs` en un Chromium de verdad: después de
> recorrer todas las páginas no queda ninguna cookie ni nada en el almacenamiento local, y en el de
> sesión solo `iemec-campana`, y solo si se llega con un código de campaña. Si algún día se añade
> analítica, mapas o vídeos, se usa la variante B del final.
> Hoy iemec-clinic.com carga dos propiedades de Google Analytics, dos píxeles de Meta, Google
> Fonts y reCAPTCHA, con un banner de SITE123: nada de eso pasa a la web nueva.

---

## Variante A · Para publicar (web sin cookies de terceros)

### 1. Qué son

Las cookies son pequeños archivos que una web guarda en tu navegador. Hay otras técnicas parecidas
(como el almacenamiento local del navegador) a las que se aplican las mismas reglas.

### 2. Qué usa esta web

**Esta web no usa cookies de analítica, de publicidad ni de redes sociales, y no necesita tu
consentimiento.** Solo guarda lo imprescindible para funcionar o lo que tú eliges:

| Nombre | Tipo | Para qué | Duración |
|---|---|---|---|
| `iemec-campana` | Almacenamiento de sesión, propio | Si llegas desde un enlace con código de campaña (por ejemplo, un anuncio), recuerda ese código mientras navegas: el formulario nos lo envía y, si nos escribes por WhatsApp, tu mensaje lleva una clave corta de la campaña (no su nombre). No guarda identificadores de clic de Google ni de Meta, esta web no lo envía a nadie más y no sirve para seguirte en otras webs. | Hasta cerrar la pestaña |

No hay nada más: ni cookies propias ni de terceros. Esta técnica es propia, dura solo la visita y
sirve para atender la solicitud que nos haces (LSSI, art. 22.2). `[PENDIENTE: que el DPD confirme
que el código de campaña está exento de consentimiento]`

### 3. Enlaces a otros servicios

Si pulsas el botón de WhatsApp, «Cómo llegar» (Google Maps) o el enlace a nuestras redes sociales,
sales de esta web y entras en el servicio de otra empresa, que usa sus propias cookies según su
política. Hasta que no pulsas, esos servicios no reciben nada desde nuestra web.

### 4. Cómo borrarlas

Puedes borrar lo que guarda esta web desde la configuración de tu navegador (apartado de
privacidad o datos de sitios). La web seguirá funcionando igual.

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
