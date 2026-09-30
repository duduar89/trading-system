# Google y DataForSEO de verdad: accesos, pasos y variables

La app trabaja con la ficha de Google de la clínica (Google Business Profile) y mide en qué puesto sale
en Google Maps alrededor de la clínica (DataForSEO). Todo está hecho y probado con respuestas de
mentira; para encenderlo faltan los accesos (puerta ⛔ 6 de `PROGRESO.md`). Mientras tanto,
`MODO_GOOGLE=simulado` y `MODO_DATAFORSEO=simulado`: nunca sale nada a internet.

```
Google (Pub/Sub push) ──POST + token OIDC──▶ /webhooks/google → «webhooks» (cifrado) + cola → 204
                                                         │
cron de cada minuto (con su propio candado «cron-google»)┘
   ├─ aviso de reseña nueva o cambiada → se pide la reseña → importación de reseñas (análisis y
   │  borrador de respuesta; nada se publica sin que lo apruebe una persona)
   ├─ otros avisos (Google cambia la ficha, control de la ficha, foto de un usuario, duplicada) → tarea
   ├─ cada día desde las 7:00: reseñas de la última semana, métricas de 30 días, revisión de la ficha
   ├─ cada semana: todas las reseñas y las búsquedas del mes pasado
   └─ cada semana (DataForSEO): 7 × 7 puntos + 4 municipios × 12 búsquedas → puesto en cada punto
```

Piezas: `servidor/integraciones/google.js` y `dataforseo.js` (los adaptadores), `servidor/ficha-google.js`
y `servidor/posiciones.js` (lo que hace el cron), `motor/posiciones/malla.js` (la malla y sus cifras),
la ruta en `servidor/rutas/webhooks.js` y `scripts/google.js` (para darlo de alta).

## Plazos y costes

| Qué | Plazo | Coste |
|---|---|---|
| Acceso a las APIs de Business Profile | Google contesta «within 14 days» al formulario. Con el resto de pasos, **2-3 semanas** hasta la primera llamada | 0 € |
| Avisos al momento (Pub/Sub) | 1 hora, cuando ya hay acceso | 0 €: los primeros 10 GiB al mes son gratis (y son unos pocos KB) |
| Places API (New), solo la ficha propia | El mismo día (clave de API y cuenta de facturación) | 0 €: unas 30-60 llamadas al mes; gratis hasta 1.000 (Enterprise) y 5.000 (Pro) al mes |
| DataForSEO | El mismo día (pago mínimo de 50 $; 1 $ de prueba) | 0,0006 $ por búsqueda: **0,38 $ por pasada** (53 puntos × 12 búsquedas), **unos 1,7 $ al mes**; tope en `POSICIONES_TOPE_MES_USD` (3 $ por defecto) |

Mientras Google aprueba el acceso, la cuota es de 0 consultas por minuto: todas las llamadas dan 429.
Aprobado, 300 por minuto y API (la app se queda en 250) y 10 ediciones por minuto y ficha.

## 1. Acceso a Business Profile (reseñas, ficha, métricas y publicaciones)

Requisitos de Google: gestionar una ficha **verificada y activa desde hace más de 60 días** (la de la
clínica lo está), tener web y pedirlo con un email que sea **propietario o gestor** de la ficha.

1. **Proyecto de Google Cloud** de la app ([console.cloud.google.com](https://console.cloud.google.com)).
   Apunta su **número de proyecto**. Mejor con una cuenta del dominio de la clínica.
2. **Formulario de acceso:** [support.google.com/business/contact/api_default](https://support.google.com/business/contact/api_default),
   opción «Application for Basic API Access», con el número de proyecto y el email gestor de la ficha.
   Se sabe que está aprobado cuando en la consola la cuota pasa de 0 a 300 consultas por minuto.
3. **APIs:** en «APIs y servicios → Biblioteca», habilitar Google My Business API (v4; no aparece hasta
   la aprobación), My Business Account Management API, My Business Business Information API, My
   Business Notifications API, My Business Place Actions API, My Business Verifications API, My Business
   Lodging API y **Business Profile Performance API** (la guía no la nombra, pero la app la usa). Para
   los avisos, también Cloud Pub/Sub API; para Places, Places API (New).
4. **Pantalla de consentimiento OAuth:** tipo «External» (o «Internal» si la cuenta de la clínica es de
   Google Workspace), con el scope `https://www.googleapis.com/auth/business.manage`, y **publicarla
   («In production»)**: en «Testing» el token de refresco caduca a los 7 días y la integración se cae
   sola. Google no publica si este scope exige verificar la app; si la pide, el plazo se alarga.
5. **Cliente OAuth** («Credenciales → Crear ID de cliente de OAuth», tipo «Aplicación web») con la URI de
   redirección `https://developers.google.com/oauthplayground`. De aquí salen `GOOGLE_CLIENTE_ID` y
   `GOOGLE_CLIENTE_SECRETO`.
6. **La cuenta de la app, gestora de la ficha.** Que la clínica, como propietaria principal, añada la
   cuenta de Google de la app como **gestor** (no propietario) en Business Profile → Configuración →
   Personas y acceso.
7. **Token de refresco**, con esa cuenta: en [OAuth Playground](https://developers.google.com/oauthplayground)
   → engranaje → «Use your own OAuth credentials» (el cliente y el secreto del paso 5) → en el paso 1
   escribir el scope `https://www.googleapis.com/auth/business.manage` → «Authorize APIs» (entrar con la
   cuenta gestora) → paso 2, «Exchange authorization code for tokens» → el **Refresh token** es
   `GOOGLE_REFRESH_TOKEN`. No se sube nunca a git ni se pega en ningún chat.
8. **Cuenta y ficha:** con las tres variables en el `.env` del servidor,
   `node scripts/google.js cuentas` dice a qué cuentas y fichas llega el token. De ahí salen
   `GOOGLE_CUENTA` y `GOOGLE_UBICACION`.
9. **Comprobar:** `node scripts/google.js ficha` enseña el place ID, el enlace oficial para reseñar
   (`newReviewUri`), la categoría, si la clínica tiene el control de la ficha y el número de reseñas.
10. **Encender:** `MODO_GOOGLE=real`. En la primera vuelta del cron a partir de las 7:00 trae las
    reseñas, las métricas y revisa la ficha; la primera semana, todas las reseñas (533 son 11 llamadas).

`obtenerFicha()` da el enlace oficial para reseñar (`newReviewUri`): es el que debe usar el enlace corto
`/r/…` de la petición de reseña, en lugar de `writereview?placeid=`, que Google no documenta.

**Normas de la API que la app cumple** ([policies](https://developers.google.com/my-business/content/policies)):
nada se publica solo (respuestas y publicaciones las aprueba una persona: *«you must not automate or
trigger review replies… without the user's prior specific and express consent»*); lo que se guarda de
la API, 30 días como mucho; los cambios que hace Google en la ficha no se deshacen solos (van a una
tarea); y hay que avisar a la clínica de cualquier cambio que haga la herramienta en su ficha en 48 h.

## 2. Avisos al momento (Pub/Sub)

Sin avisos, las reseñas llegan igual con la revisión diaria; con ellos, en segundos.

1. **Tema:** `gcloud pubsub topics create avisos-ficha --project=<proyecto>` (o en la consola).
2. **Que Google pueda publicar en él:** permiso `pubsub.topics.publish` (rol Pub/Sub Publisher) para
   `mybusiness-api-pubsub@system.gserviceaccount.com`:
   `gcloud pubsub topics add-iam-policy-binding avisos-ficha --member=serviceAccount:mybusiness-api-pubsub@system.gserviceaccount.com --role=roles/pubsub.publisher --project=<proyecto>`
3. **Cuenta de servicio para firmar los avisos:** `gcloud iam service-accounts create avisos-ficha-push --project=<proyecto>`.
   Su email (`avisos-ficha-push@<proyecto>.iam.gserviceaccount.com`) es `GOOGLE_PUBSUB_EMAIL`. En
   proyectos antiguos (anteriores a abril de 2021), el agente de servicio de Pub/Sub necesita además el
   rol «Service Account Token Creator» sobre esa cuenta.
4. **Suscripción push con autenticación** hacia la app:
   `gcloud pubsub subscriptions create avisos-ficha-push --topic=avisos-ficha --push-endpoint=https://agenda.iemec-clinic.com/webhooks/google --push-auth-service-account=avisos-ficha-push@<proyecto>.iam.gserviceaccount.com --push-auth-token-audience=https://agenda.iemec-clinic.com/webhooks/google --project=<proyecto>`.
   La audiencia es `GOOGLE_PUBSUB_AUDIENCIA` (si no se pone, la app espera `URL_PUBLICA` +
   `/webhooks/google`, que es lo mismo).
5. **Dar de alta los avisos de la cuenta:** `node scripts/google.js avisos projects/<proyecto>/topics/avisos-ficha`.
   Pide `NEW_REVIEW`, `UPDATED_REVIEW`, `GOOGLE_UPDATE`, `NEW_CUSTOMER_MEDIA`, `DUPLICATE_LOCATION` y
   `VOICE_OF_MERCHANT_UPDATED` (los de preguntas y respuestas están cerrados desde 2025). Hay un solo
   ajuste de avisos por cuenta.

**Cómo entra un aviso.** Pub/Sub hace un POST con `Authorization: Bearer <JWT>`. La app comprueba la
firma (RS256, con las claves públicas de Google, que guarda lo que diga su Cache-Control), el emisor
(`accounts.google.com`), la caducidad, la audiencia y que el email sea el de la cuenta de servicio y
esté verificado; todo antes de leer el cuerpo. Después guarda el aviso cifrado en `webhooks`, lo encola
(`webhook_google`) y contesta 204. Si Pub/Sub lo repite (mismo `messageId`), no se guarda dos veces.
Sin token, 401; con uno que no vale, 403; si no se pueden leer las claves de Google, 503 (Pub/Sub lo
repite: guarda los avisos 7 días). Sin `GOOGLE_PUBSUB_EMAIL`, en producción se rechaza todo (503); en el
portátil entra sin comprobar (`firma_ok = NULL`).

Google no publica un ejemplo del JSON de dentro del aviso: la referencia habla de `review_name` y
`location_name` (v1) o `reviewName` y `locationName` (v4). La app acepta esas variantes y, si no, busca
el nombre de la reseña en cualquier campo. Un aviso de otra ficha se guarda marcado (`evento = 'ajeno'`)
y no se toca.

## 3. Places API (New): solo la ficha de la clínica

Sirve para tener el enlace oficial para reseñar (`writeAReviewUri`) y el aviso de reseñas sospechosas
(`consumerAlert`) **antes** de que Google apruebe Business Profile, y después para ese aviso. En el EEE,
con facturación en España y proyecto creado después del 08-07-2025, el contenido de Places solo puede
usarse para 9 usos permitidos, **ninguno para vigilar a la competencia**, y no puede mostrarse junto a
un mapa. Por eso el adaptador no deja pedir otro lugar: siempre usa `GOOGLE_PLACE_ID`. La competencia
se mira con DataForSEO. No se guarda nada de Places en la base.

1. En el proyecto, habilitar Places API (New) y enlazar una cuenta de facturación (hace falta aunque
   salga gratis).
2. «Credenciales → Crear clave de API», restringida a **Places API (New)** y a la IP del servidor.
   Es `GOOGLE_PLACES_CLAVE`.
3. `GOOGLE_PLACE_ID`: el de la ficha (la semilla trae `ChIJB6Pn5d2FQQ0ReZ4Qoqe8gtg`; con Business
   Profile, `node scripts/google.js ficha` lo confirma).

Con solo Places (sin OAuth), `MODO_GOOGLE=real` ya funciona: `obtenerFicha()` da el place ID y el
enlace para reseñar, y la revisión diaria mira el aviso de reseñas sospechosas. Lo demás dice que falta
el acceso a Business Profile.

## 4. DataForSEO: el puesto en Google Maps alrededor de la clínica

1. Cuenta en [dataforseo.com](https://dataforseo.com) y un primer pago (50 $ como mínimo).
2. En su panel, «API Access»: el **login** y la **contraseña de la API** (no la de entrar al panel) son
   `DATAFORSEO_LOGIN` y `DATAFORSEO_CLAVE`.
3. `node scripts/google.js posiciones` dice lo que cuesta una pasada con los ajustes y el saldo.
4. `MODO_DATAFORSEO=real`.

**La pasada.** El día de `POSICIONES_DIA` (lunes) desde las 7:00 (si ese día no pasa el cron, el
primero después), una búsqueda por palabra y punto: 7 × 7 puntos a 1,5 km (unos 9 × 9 km) centrados en
la clínica y el centro de Majadahonda, Pozuelo, Las Rozas y Villaviciosa. Móvil, español, 20
resultados, zoom 15 fijo (cambia los resultados: no se toca). Por defecto, las 12 búsquedas del informe
de búsqueda local; se revisan cada mes con las que da la Performance API (`busquedas_gbp`). Van en la
cola estándar (0,0006 $) en bloques de 100, y cada bloque se apunta en `posiciones_tareas` con su coste
en cuanto DataForSEO lo acepta: si algo falla a medias, el reintento no paga dos veces. Cada 5 minutos se
recoge lo que está listo (`tasks_ready` y `task_get/advanced`) en `posiciones_maps`: el puesto de la
clínica (por su place ID o `GOOGLE_CID`), o NULL si no sale entre los 20 primeros, y quién sale 1.º (su
nombre, categoría, nota y número de reseñas; nada de reseñas ni de personas). Lo que no llega en 24 h
queda caducado.

**El tope.** Antes de enviar se suma lo gastado en el mes y solo salen las búsquedas que caben
**enteras** (todos sus puntos); lo que no cabe queda en un evento `posiciones_tope`. Entre bloque y
bloque manda lo que DataForSEO dice que ha costado de verdad, por si sube el precio.

**Las cifras** (`posiciones.resumen(pool)` y `motor/posiciones/malla.js`): por búsqueda, en cuántos
puntos sale, el puesto medio donde sale, el puesto medio contando 21 donde no sale, el % de puntos en el
top 3 y quién gana donde no gana la clínica; y la cuadrícula para pintar un mapa de calor **sin fondo de
Google Maps** (los datos no son de Google Maps Platform).

DataForSEO no es Google: saca los resultados por su cuenta y puede cambiar o fallar. Sus condiciones
de uso no se han revisado (puerta).

## 5. Lo que hace el cron

Todo va por la cola (`cola.encolar` con clave única y `cola.unaVez` para no repetir el día o la
semana; si algo falla al programar, la marca se quita y la vuelta siguiente lo vuelve a intentar),
dentro del candado `cron-google` (5 minutos como mucho; se suelta al terminar) y con 20 s por vuelta
para cada parte, aparte de lo de cada minuto. **Solo en modo real y con credenciales**; con
`node --test`, nunca se crea un adaptador real a partir del `.env` (una prueba no puede llamar a Google
aunque el portátil tenga claves).

| Cuándo | Trabajo | Qué hace |
|---|---|---|
| Al llegar un aviso | `webhook_google` | Reseña nueva o cambiada → se pide (`reviews.get`) → `importarResenas` (análisis y borrador). Cambios de Google, control de la ficha, foto de un usuario o ficha duplicada → tarea (una por asunto; la del control, urgente) |
| Cada día desde las 7:00 | `google_resenas` | Las reseñas tocadas en los últimos 8 días (por si se perdió un aviso) |
| | `google_metricas` | Métricas diarias de los últimos 30 días (hasta ayer): impresiones en Maps y en la Búsqueda (móvil y ordenador), llamadas, clics a la web, rutas, conversaciones y reservas de Google → `metricas_gbp` |
| | `google_ficha` | La ficha: el place ID al día en `clinica.google_place_id` (evento `google_place_id` si cambia); si la clínica pierde el control o Google ha cambiado datos, tarea; con Places, el aviso de reseñas sospechosas |
| Cada semana (el primer día desde el lunes a las 7:00) | `google_resenas` | Todas las reseñas |
| | `google_palabras` | Las búsquedas con las que salió la ficha el mes pasado → `busquedas_gbp` (la lista del mes se sustituye; dos iguales para la base, con y sin tilde, se suman) |
| Cada semana (`POSICIONES_DIA`) | `posiciones_enviar` y `posiciones_recoger` | La malla de DataForSEO (sección 4) |
| Cada día, en cualquier modo | — | Lo guardado de la Performance API que pasa de plazo se borra |

Si un trabajo falla, la cola lo reintenta (1, 2, 4, 8… minutos). Si el error no tiene arreglo sin una
persona (token revocado, permisos, falta de place ID, sin saldo) o es el último intento, queda al
momento una tarea «Google: no se ha podido…» o «DataForSEO: …» con el error (una por asunto), y la cola
sigue probando por si se arregla. Una variable de la malla que no vale (`POSICIONES_MALLA` par, un
centro que no es una coordenada) también deja su tarea. El informe del cron (`~/logs/iemec-cron.log`)
lleva `google` y `posiciones` cuando están en real; si falta una credencial, lo dice ahí.

## 6. Lo que se guarda y cuánto

| Dónde | Qué | Cuánto |
|---|---|---|
| `webhooks` | El aviso de Pub/Sub, cifrado (solo trae nombres de recursos) | El cuerpo se vacía a los 30 días (tarea diaria de siempre) |
| `resenas` | Lo decide la importación de reseñas (la otra pieza): el texto y el autor, 30 días | — |
| `metricas_gbp` | Métricas diarias | Solo los últimos 30 días; lo anterior se vuelve a pedir a Google si hace falta |
| `busquedas_gbp` | Búsquedas del mes | Solo el mes pasado |
| `posiciones_tareas`, `posiciones_maps` | Lo de DataForSEO (no es contenido de las APIs de Google) | Sin plazo |
| Memoria del proceso | El token de acceso de Google (1 hora) y la ficha (12 horas) | Nunca en la base ni en un log |

Del autor de una reseña solo llega su nombre (o nada si es anónima): ni su foto ni las fotos o vídeos
de la reseña. Los errores dicen el estado y el mensaje de Google, nunca un token ni el texto de una
reseña.

## 7. Variables

En el `.env` del servidor (el cron es otro proceso y solo lee el `.env`; ver
[`DESPLIEGUE.md`](DESPLIEGUE.md)). Nunca en git.

| Variable | Para qué | Por defecto |
|---|---|---|
| `MODO_GOOGLE` | `simulado` o `real` | `simulado` |
| `GOOGLE_CLIENTE_ID`, `GOOGLE_CLIENTE_SECRETO` | El cliente OAuth (paso 1.5) | — |
| `GOOGLE_REFRESH_TOKEN` | El token de refresco de la cuenta gestora (paso 1.7). Van las tres o ninguna | — |
| `GOOGLE_CUENTA`, `GOOGLE_UBICACION` | La cuenta y la ficha (`accounts/…` y `locations/…`, o solo el número): `node scripts/google.js cuentas` | — |
| `GOOGLE_PLACES_CLAVE` | La clave de Places API (New), restringida | — |
| `GOOGLE_PLACE_ID` | El place ID de la ficha, para Places (y para reconocer a la clínica en DataForSEO) | El de la base |
| `GOOGLE_CID` | El CID de la ficha (el número de `maps?cid=`), opcional, para reconocerla en DataForSEO | — |
| `GOOGLE_PUBSUB_EMAIL` | La cuenta de servicio que firma los avisos (paso 2.3). Sin ella, en producción no entra ningún aviso | — |
| `GOOGLE_PUBSUB_AUDIENCIA` | La audiencia de la suscripción push | `URL_PUBLICA` + `/webhooks/google` |
| `MODO_DATAFORSEO` | `simulado` o `real` | `simulado` |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_CLAVE` | El login y la contraseña de la API | — |
| `POSICIONES_PALABRAS` | Las búsquedas, separadas por comas | Las 12 del informe |
| `POSICIONES_TOPE_MES_USD` | Lo máximo que se gasta al mes | `3` |
| `POSICIONES_MALLA`, `POSICIONES_PASO_KM` | Puntos por lado (impar) y separación | `7` y `1.5` |
| `POSICIONES_MUNICIPIOS` | `0` para no mirar los 4 municipios de alrededor | `1` |
| `POSICIONES_CENTRO` | `latitud,longitud` del centro | La de la clínica en la base o en Google Maps |
| `POSICIONES_ZOOM`, `POSICIONES_PROFUNDIDAD`, `POSICIONES_DIA` | Zoom (3-21), resultados por búsqueda y día de la semana (1 = lunes) | `15`, `20` y `1` |

## 8. Si algo falla

| Síntoma | Qué pasa | Qué hacer |
|---|---|---|
| `Google 429 … (cuota agotada; si no se pasa nunca…)` todo el rato | La API aún no está aprobada (0 consultas por minuto) | Esperar la respuesta al formulario; mirar la cuota en la consola |
| `el token de refresco ha caducado o se ha revocado` | La pantalla de consentimiento sigue en «Testing» (7 días), se cambió la contraseña o se quitó el acceso | Publicar la pantalla de consentimiento y repetir el paso 1.7 |
| `Google 403 … sin permiso` | La cuenta de la app no es gestora de la ficha o falta habilitar una API | Pasos 1.3 y 1.6 |
| `Google 404 … revisar GOOGLE_CUENTA y GOOGLE_UBICACION` | Cuenta o ficha equivocadas | `node scripts/google.js cuentas` |
| Los avisos no llegan | Suscripción, audiencia o cuenta de servicio | En la consola de Pub/Sub, los errores de entrega de la suscripción: 401 (sin token: falta la autenticación en la suscripción), 403 (audiencia o `GOOGLE_PUBSUB_EMAIL` distintos), 503 (falta `GOOGLE_PUBSUB_EMAIL` o no llegan las claves de Google) |
| `DataForSEO … usuario o clave no válidos` / `sin saldo` | Credenciales de la API / cuenta sin saldo | Panel de DataForSEO |
| Evento `posiciones_tope` | La pasada no cabía entera en el tope del mes | Subir `POSICIONES_TOPE_MES_USD` o quitar búsquedas |

## 9. Lo que queda (puertas)

- Los accesos: formulario de Google, cuenta gestora, proyecto, Pub/Sub, Places y DataForSEO (⛔ 6).
- El texto y el autor de las reseñas, 30 días: lo hace la importación de reseñas (la otra pieza). La
  sincronización semanal trae todas las reseñas, también las antiguas.
- Pantallas del panel: aprobar publicaciones de la ficha (`fichaGoogle.publicarNovedad`, ya hecho en el
  servidor), métricas de la ficha y el mapa de calor de posiciones (`posiciones.resumen`).
- Revisar las condiciones de uso de DataForSEO y preguntar a Google (formulario de la página de
  políticas) si la cláusula de 30 días alcanza a las métricas.
