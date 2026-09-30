# WhatsApp y leads: cómo entran

Por aquí entra todo lo que viene de fuera: los mensajes de WhatsApp (y lo que le pasa a lo que
mandamos), los leads de los formularios de los anuncios de Meta y los de la web o GHL.

```
Meta / 360dialog ──POST──▶ /webhooks/whatsapp ─┐  firma bien → se guarda en «webhooks»
Meta (página)    ──POST──▶ /webhooks/meta     ─┤  + trabajo en la «cola» → 200 al momento
                                               │
cron de cada minuto ◀──────────────────────────┘  (servidor/entrada.js, lo primero de cada vuelta)
   ├─ texto, botón de plantilla, interactivo → la repesca (procesarEntrante), que contesta
   ├─ audio, foto, vídeo, documento, ubicación, sticker… → a una persona, con tarea
   ├─ clic en un anuncio que abre WhatsApp (referral) → lead «meta_ctwa» y luego la repesca
   ├─ primer mensaje de un botón de la web, con «(ref. web-…)» → lead «web_whatsapp» y la repesca
   ├─ estados (enviado, entregado, leído, fallido) → el mensaje en la bandeja, con su motivo
   └─ lead de un formulario → se pide a Meta → alta → secuencia «lead» (primer mensaje ya);
      si Meta no deja leerlo → tarea para recepción

GHL u otra herramienta ──POST con X-Clave──▶ /api/leads → alta → secuencia «lead» (en la misma petición)
La web pública (navegador) ──POST sin clave──▶ /web/contacto → lead SIN VERIFICAR con la prueba de
      los consentimientos → si pide WhatsApp, uno neutro de confirmación («¿Has sido tú?»); si pide
      llamada o correo, tarea para recepción. Con su «Sí, fui yo», la conversación sigue
```

La ruta nunca procesa nada: comprueba la firma, guarda el cuerpo tal cual (cifrado, como los
mensajes: trae lo que escribe el paciente) y contesta 200 en milisegundos (Meta reintenta lo que
tarda).

Lo procesa el cron, con la cola en MariaDB: si algo falla, se reintenta (1, 2, 4, 8 minutos) y el
error queda en `webhooks.error` y `cola.ultimo_error`. Lo que ya se hizo no se repite: los mensajes
van por su `wamid` y los leads por su identificador de Meta, así que un aviso repetido no duplica
nada. Si después de todos los intentos un aviso no se ha podido procesar, sale en **Tareas** del panel
(una tarea y el aviso «N avisos de WhatsApp o de Meta no se han podido procesar»).

**Por orden y sin pisarse.** Los mensajes de un mismo teléfono se procesan de uno en uno y en el orden
en que llegaron: cada trabajo lleva los teléfonos de sus mensajes y, si hay uno anterior del mismo
teléfono sin terminar (lo tiene otro cron o espera un reintento), espera un minuto sin gastar
intento. Así, si la IA tarda y el cron siguiente entra a la vez, el «¿Y qué precio tiene?» no se
contesta antes que el «Hola, quería información». Además, la entrada tiene 40 s por vuelta (el candado
del cron dura 55): lo que no le da tiempo a empezar queda para el cron siguiente, sin gastar intento.

**La hora es la del mensaje.** Se guarda la marca de WhatsApp (cuándo lo escribió): si se procesa
tarde, la ventana de 24 h cuenta desde entonces y la bandeja enseña su hora de verdad.

Trabajos de la cola: `webhook_whatsapp` (avisos con mensajes), `webhook_meta` (leads; 8 intentos, unas
2 h, porque leer un lead depende de la Graph API y del token) y `webhook_whatsapp_estados` (avisos que
solo traen estados). Cada minuto van primero los dos primeros (20 por vuelta) y después los estados
(200 por vuelta): cuando salen las secuencias llegan muchos estados a la vez y no pueden hacer esperar
a lo que escribe un paciente.

Los cuerpos guardados se vacían a los 30 días (tarea diaria del cron): lo que hacía falta ya está en
los mensajes y los leads. Se quedan el proveedor y el identificador, que sirven para no duplicar. Para
leer uno reciente a mano: `require('./servidor/entrada').descifrarCuerpo(cuerpo)` con la
`CLAVE_CIFRADO` del servidor.

## Las direcciones

Con el subdominio de la app (en el ejemplo, `agenda.iemec-clinic.com`, siempre con https):

| Qué | URL |
|---|---|
| Webhook de WhatsApp | `https://agenda.iemec-clinic.com/webhooks/whatsapp` |
| Webhook de leads de Meta | `https://agenda.iemec-clinic.com/webhooks/meta` |
| Alta de leads (GHL u otra herramienta, con clave) | `https://agenda.iemec-clinic.com/api/leads` |
| Formulario «Te llamamos» de la web pública (sin clave) | `https://agenda.iemec-clinic.com/web/contacto` |

## Variables nuevas

En «Setup Node.js App» de cPanel o en el `.env` del servidor (nunca en git):

| Variable | Para qué | De dónde sale |
|---|---|---|
| `WHATSAPP_VERIFY_TOKEN` | La contraseña que Meta manda al dar de alta el webhook (GET con `hub.verify_token`) | Te la inventas: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` y pones la misma en Meta |
| `WHATSAPP_APP_SECRET` | Comprobar la firma `X-Hub-Signature-256` de cada aviso | Meta for Developers → la app → Configuración de la app → Básica → Clave secreta de la app |
| `WHATSAPP_WEBHOOK_CLAVE` | Solo si el proveedor no firma con nuestra app (360dialog): clave compartida en la cabecera `X-Clave` | Te la inventas |
| `META_VERIFY_TOKEN` | Igual que el de WhatsApp, para el webhook de la página | Te la inventas |
| `META_APP_SECRET` | Firma de los avisos de leads (y `appsecret_proof` al pedir el lead) | La clave secreta de la app que recibe los leads (si es la misma app, el mismo valor) |
| `META_TOKEN_PAGINA` | Pedir a Meta los datos de cada lead (el aviso solo trae su número) | Token de un usuario del sistema del Business Manager con acceso a la página y permiso `leads_retrieval` |
| `META_GRAPH_VERSION` | Versión de la Graph API | Opcional; por defecto `v23.0` |
| `MODO_META` | `simulado` (por defecto) o `real` | En `real` sin `META_TOKEN_PAGINA` no arranca (puerta ⛔). **En `simulado` los leads de verdad no se pueden leer: cada uno acaba en una tarea para recepción** |
| `WHATSAPP_NUMERO_ID` | El número de WhatsApp de la clínica (`phone_number_id`): lo que llegue para otro número de la misma app no se toca | Meta for Developers → WhatsApp → Configuración de la API, «Identificador del número de teléfono». Hará falta también para enviar en real |
| `META_PAGINA_ID` | La página de Facebook de la clínica: los leads de otras páginas de la misma app no se tocan | Meta Business Suite → Configuración → la página → «Identificador de la página» |
| `LEADS_CLAVE` | Clave que la web o GHL mandan en la cabecera `X-Clave` | Te la inventas: 32 caracteres aleatorios (mínimo 16) |

`WHATSAPP_NUMERO_ID` y `META_PAGINA_ID` admiten varios valores separados por comas. Sin ellas se
procesa todo (en el portátil); en producción hay que ponerlas: si la app de Meta sirve a otras
páginas o números (una agencia con varias clínicas), sin ellas se procesarían leads y mensajes de
otros. Lo que llega de otro número o página se guarda, queda marcado (`webhooks.evento = 'ajeno'`) y
se apunta un evento `webhook_ajeno` con su identificador, por si la variable está mal puesta.

Sin secreto ni clave, **en producción los webhooks se rechazan** (503); fuera de producción se
admiten y quedan con `firma_ok = NULL`, para probar en el portátil. Una `WHATSAPP_WEBHOOK_CLAVE` de
menos de 16 caracteres se trata como si no estuviera.

**Todas en el `.env` del servidor.** Lo que llega lo procesa el cron, que es otro proceso y no ve las
variables de «Setup Node.js App»: solo lee el `.env` (ver [`DESPLIEGUE.md`](DESPLIEGUE.md)).

## Alta del webhook de WhatsApp

### Cloud API de Meta (app propia)

1. En [developers.facebook.com](https://developers.facebook.com) → la app de la clínica → WhatsApp →
   Configuración → Webhook → Editar.
2. **URL de devolución de llamada:** `https://agenda.iemec-clinic.com/webhooks/whatsapp`.
   **Token de verificación:** el valor de `WHATSAPP_VERIFY_TOKEN`. Al guardar, Meta hace un GET con
   `hub.challenge` y la app se lo devuelve si el token cuadra.
3. **Campos del webhook:** suscribirse a `messages` (trae los mensajes y los estados de lo que
   mandamos).
4. En el servidor, `WHATSAPP_APP_SECRET` con la clave secreta de esa app.
5. Comprobar que la cuenta de WhatsApp Business está suscrita a la app (se hace al conectar el
   número; si no llegan avisos: `POST /{WABA_ID}/subscribed_apps` con el token del sistema).

### 360dialog (con coexistencia)

360dialog manda los avisos con el mismo formato de la Cloud API, pero no los firma con el secreto
de nuestra app. Se da de alta la URL con su API (cabecera `D360-API-KEY`) y, como autenticación, una
cabecera propia `X-Clave` con el valor de `WHATSAPP_WEBHOOK_CLAVE` (360dialog deja añadir cabeceras
al configurar el webhook; confirmarlo en su documentación al darlo de alta). No hace falta el GET
de verificación. Con esta vía, `WHATSAPP_APP_SECRET` se deja vacío.

## Alta del webhook de leads de Meta (formularios de los anuncios)

1. En la app de Meta, producto **Webhooks** → objeto **Page** → URL
   `https://agenda.iemec-clinic.com/webhooks/meta`, token `META_VERIFY_TOKEN` → suscribirse al
   campo **`leadgen`**.
2. Suscribir la página a la app (con el token de la página):
   `POST https://graph.facebook.com/v23.0/{ID_DE_LA_PAGINA}/subscribed_apps?subscribed_fields=leadgen`.
3. Permisos del token: `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`,
   `pages_read_engagement` y `ads_read` (para los nombres de campaña, conjunto y anuncio). Mejor un
   **usuario del sistema** del Business Manager: su token no caduca.
4. En Meta Business Suite → Configuración → Integraciones → **Acceso a clientes potenciales**: dar
   acceso a la app (si no, Meta avisa pero no deja leer el lead).
5. Probar con la herramienta de pruebas de Lead Ads
   ([developers.facebook.com/tools/lead-ads-testing](https://developers.facebook.com/tools/lead-ads-testing)):
   el lead de prueba entra con su tarea, porque el teléfono de prueba no es válido.
6. `MODO_META=real`, `META_TOKEN_PAGINA` y `META_PAGINA_ID` en el `.env` del servidor.

**Si Meta no deja leer un lead** (token caducado, sin «Acceso a clientes potenciales», `MODO_META` en
simulado, la Graph API caída), no se pierde: cada lead del aviso va por su lado (si uno falla, los
demás entran), y el que no se puede leer va a **Tareas** («Lead de Meta sin leer (motivo): descargarlo
en Meta Business Suite → Clientes potenciales y contactarle», con su identificador, el formulario y
el anuncio). Si Meta dice que no se puede (token, permisos, lead desconocido), la tarea sale al
momento; si es algo que se arregla solo (Meta caída, límite de llamadas), se reintenta y la tarea sale
en el último intento, unas 2 h después.

## Qué pasa con cada mensaje

| Llega | Qué se hace |
|---|---|
| Texto | A la repesca: se paran sus secuencias (las de su ficha y las de cualquier lead con su teléfono), se entiende, se decide y la IA contesta (o elige hueco y se reserva) |
| Botón de una plantilla («Sí, búscame hueco») | Igual, con el texto del botón |
| Interactivo (botón o lista) | Igual, con el título de la opción |
| Audio | Se registra «[audio]», pasa a una persona con tarea y se le dice que no se pueden escuchar audios, que le contesta el equipo y que, si es urgente de salud, llame a la clínica o al 112 |
| Imagen, vídeo, documento | Se registra («[imagen] leyenda», «[documento: nombre]»), a una persona con tarea y se le dice que lo revisa el equipo (con la foto y el vídeo, también qué hacer si es urgente). La leyenda se entiende como un texto (con la IA, si está en real): si es una baja o algo de salud, además va por la repesca (la baja se aplica al momento; lo urgente pasa con prisa y el 112), y lo que mandó lo sigue viendo una persona. «Estoy de baja médica» o «la foto de la baja» no son una baja |
| Ubicación, sticker, contacto, lo que no se puede leer | Se registra y a una persona con tarea, sin contestarle |
| Reacción (👍 a un mensaje nuestro) | Se registra en esa conversación, sin más |
| Clic en un anuncio que abre WhatsApp | Antes que nada, lead `meta_ctwa` con `ctwa_clid`, anuncio y tratamiento (por el mapeo o el titular); la conversación queda enlazada al lead y la repesca lo trata como tal. Sin secuencia: ya está hablando con la IA |

**Un audio, una foto o un vídeo de quien ha tenido un tratamiento médico en los últimos 14 días**
(lo hace un médico, o es un medicamento, un producto sanitario o cirugía) pueden ser una complicación:
la tarea es urgente (15 minutos) y la conversación sale la primera en la bandeja.

El nombre del perfil de WhatsApp se guarda en la conversación (`nombre_whatsapp`): con él se saluda
a quien aún no es lead ni paciente, y la bandeja lo muestra en vez del número. Si ya hay ficha o lead
con nombre, manda ese. Las plantillas dicen «Hola {{1}}, …»: sin ningún nombre, «Hola buenos días»
(o «buenas tardes»), nunca «Hola hola».

Si una persona ya lleva la conversación, no se le contesta nada automático (salvo bajas y
urgencias, como siempre) y no se abre otra tarea si ya hay una abierta.

## Estados de lo que mandamos

`sent`, `delivered`, `read` y `failed` actualizan `mensajes.estado` (enviado, entregado, leído,
fallido) por el `wa_id`, sin volver atrás si llegan desordenados. Si falla, se guardan el código y
el motivo, dicho para recepción, y la bandeja lo enseña en el mensaje y en la lista («No le llegó el
último mensaje»). Los más habituales:

| Código | Motivo | Qué hace la app |
|---|---|---|
| 131049 | Meta no lo entrega para no saturar al paciente (límite de marketing) | Se ve en la bandeja y en las plantillas |
| 131050 | El paciente ha pulsado en WhatsApp que no quiere marketing de la clínica | **Baja comercial**: consentimiento revocado con su prueba, a la lista de bajas, secuencias canceladas (las de todos sus leads) y, si era un lead en marcha, tarea para decidir si se le llama |
| 131047 | Pasaron 24 h desde su último mensaje | Hace falta plantilla |
| 131026 | El número no tiene WhatsApp | — |

Si lo que no llega es una respuesta escrita (de la IA o del equipo, no una plantilla), además la
conversación pasa a una persona con tarea: el paciente cree que no le hemos contestado.

## Leads: un solo camino para todos

Formularios de Meta, anuncios que abren WhatsApp, la web y GHL pasan por `servidor/leads.js`:

- **Teléfono** en formato internacional (E.164). Sin prefijo se entiende España (9 cifras que
  empiezan por 6, 7, 8 o 9); con `+` o `00`, cualquier país.
- **El mismo envío no se duplica:** Meta y GHL reintentan; el identificador del envío (`id_externo`)
  se reconoce, no se hace nada más y queda apuntado (`eventos.lead_repetido`).
- **Un lead en marcha no se duplica:** si ya hay uno con ese teléfono (sin teléfono, con ese email)
  y algo se mueve (su secuencia, su conversación, un seguimiento, una tarea o su cita), se completa lo
  que le faltaba, se guarda su interés nuevo, se apunta que ha vuelto y su secuencia sigue donde
  estaba. Si no está en su secuencia (le atiende una persona o la IA, o espera un seguimiento) y nadie
  tiene una tarea suya, tarea para contestarle («ha vuelto a pedir información de…»). Uno **parado**
  (la secuencia acabó sin respuesta, se cerró su conversación…) se da por perdido (`sin_actividad`)
  y entra el nuevo, con su secuencia.
- **Si acaba la secuencia sin respuesta**, a los 4 días se cierra su conversación y el lead queda
  perdido (`sin_respuesta`): si vuelve, entra como nuevo.
- **Su conversación abierta pasa a ser la del lead** (si no tenía lead, o el suyo estaba cerrado): la
  secuencia escribe ahí, su respuesta la para y su BAJA la cancela. Además, cualquier mensaje de ese
  teléfono para las secuencias de todos sus leads, aunque la conversación no sea la suya.
- **Secuencia «lead»:** empieza cuando se puede escribir (no de noche ni en festivo: si entra el martes
  a las 23:30, la bienvenida sale el miércoles al abrir y el paso de las 4 h, 4 h después). El primer
  mensaje (plantilla `lead_primer_contacto`) sale en menos de un minuto si es horario de envío (el
  lead de Meta, en la misma vuelta del cron que lo procesa; el de la web, en la siguiente). Cuenta
  para el límite de mensajes comerciales (2 por semana y 4 por mes, sumados por su teléfono): el paso
  de los 3 días espera, si hace falta, a que haya sitio en la semana. Cada paso guarda la espera que
  marca la secuencia desde el anterior, aunque el anterior saliera tarde.
- **En vez de secuencia, tarea para recepción** (en **Tareas** del panel, con su nombre, teléfono o
  email y de dónde viene) si no hay teléfono válido, si es un fijo (sin WhatsApp: se le llama), si
  tiene la **baja comercial** (su ficha de paciente o la **lista de bajas**: quien escribió BAJA o
  bloqueó el marketing en WhatsApp, sea o no paciente) o si **su conversación la lleva una persona o
  va de otra cosa** (un presupuesto, una cita): entonces la tarea va en esa conversación. Si está
  hablando ahora con la IA (ventana de 24 h abierta), se inscribe sin bienvenida: si deja de
  contestar, le llega el paso de las 4 h. Si una persona coge su conversación con la secuencia en
  marcha, la secuencia se para.
- La tarea de las 24 h («Llamar a Nombre (611 00 00 00): lead sin respuesta a las 24 h») va con el
  lead, su conversación y su teléfono en el título.
- **Lo que escribió en el formulario** va cifrado (`leads.respuestas_cifradas`), como los mensajes,
  y la bandeja lo enseña en la ficha del lead.
- **Lo comercial, solo con su consentimiento** (LSSI, art. 21). Pedir información no es aceptar
  publicidad: a un lead se le puede mandar, sin más, el seguimiento de su propia solicitud (la
  bienvenida, «¿te buscamos hueco?», el último intento y el «como quedamos») mientras siga en curso
  (sin cita ni «no, gracias»). Todo lo demás («te echamos de menos», «toca repetir»…) solo con su
  casilla comercial de la web, verificada, o, si es paciente, con su consentimiento en la ficha o
  siendo cliente (`permisoComercial` en `servidor/repesca/motor.js`, con el uso de la plantilla; la
  bandeja ofrece solo esas). La casilla verificada pasa a su ficha (`consentimientos`, fuente «web»,
  con la prueba y la versión de los textos) cuando la tiene o al reservar
  (`servidor/consentimiento-web.js`), y el panel la enseña: «Comunicaciones comerciales: sí (web,
  fecha, versión)».
- Un tratamiento con publicidad restringida (medicamento con receta, producto sanitario) se guarda
  como interés, pero las plantillas comerciales no lo nombran: dicen su familia («medicina estética
  facial»).

### Qué tratamiento le interesa

Por este orden:

1. El identificador exacto (en `/api/leads`, `"tratamiento": "mesoterapia-capilar"`).
2. Lo que respondió a la pregunta del tratamiento del formulario: primero el mapeo y después el
   catálogo.
3. El **mapeo** (`mapeo_tratamientos`): identificador o nombre exacto del anuncio, del conjunto,
   de la campaña o del formulario, o el código de la web, sin distinguir mayúsculas ni tildes.
4. El catálogo: el nombre o un **alias** del tratamiento dentro del nombre del anuncio, del conjunto
   o de la campaña (o del titular del anuncio de WhatsApp). Si dos tratamientos empatan, ninguno.

Valen los tratamientos que se reservan y los **agrupadores** (Head Spa japonés, programa de acné…:
los que el importador deja inactivos con la nota «No se reserva: agrupa varias técnicas»); lo
retirado del catálogo, no. Si un agrupador empata con sus técnicas (las de su misma familia y
subfamilia), gana el agrupador: «Head Spa» es el Head Spa japonés. Si empata con otros, ninguno. Un
agrupador íntimo o de publicidad restringida no gana nunca por empate ni por un trozo de su nombre
(«Láser», «Radiofrecuencia» o «Fotona» no son el rejuvenecimiento vaginal): solo si se nombra
entero. Con un agrupador, la conversación le pregunta qué nivel o técnica quiere (de 2 a 5 opciones
de su familia y subfamilia, ninguna íntima ni de publicidad restringida) y le busca hueco para esa;
si no, pasa a recepción. Una pregunta concreta («¿hacéis financiación?») no: se contesta con lo
aprobado o la contesta una persona.

En la conversación, además:

- El **botón de WhatsApp de la web** («Hola vengo de la web quisiera reservar una cita para…») dice
  el tratamiento que tiene ese texto en el catálogo. Si lo mandan varias páginas y una es la de un
  agrupador (el del Head Spa japonés es el mismo que el del Detox; el del programa de acné, el de
  Perfect Skin: lo dice la nota «El botón de WhatsApp de la web manda el mismo texto que…»), el
  agrupador, y se le pregunta el nivel.
- Si ya sabemos qué le interesa y **pregunta por otro** («¿qué precio tiene el Head Spa Express?»,
  con su nombre o un alias enteros), en esa vuelta se le contesta de ese, y queda como su interés.
- **«Quiero más información»** sin decir de qué: del tratamiento del que se está hablando (su lead,
  su presupuesto, su cita), nunca del de una cita que ya pasó; si no hay ninguno, se le pregunta
  cuál. De lo íntimo o de publicidad restringida que no nombra él, ni lo aprobado ni huecos: se le
  ofrece la valoración. Si ya tiene cita de eso, lo aprobado y su cita, sin darle otra.

Para configurar una campaña:

```sql
INSERT INTO mapeo_tratamientos (clave, tratamiento_id, notas) VALUES
  ('120210000000000001', 'mesoterapia-capilar', 'anuncio vídeo capilar otoño'),
  ('Tratamientos capilares', 'diagnostico-capilar-gratuito', 'respuesta del formulario de captación'),
  ('OTO26-FAC', 'higiene-facial-triacidos', 'código de la landing de otoño');
```

## Botones de WhatsApp de la web pública

Cada botón de WhatsApp de la web (`web/`) abre el chat con el primer mensaje escrito y la referencia
de la página al final: «Hola, vengo de la web y me interesa: Lipoláser. (ref. web-lipolaser)». Si la
visita llegó por una campaña (`?utm_campaign=…`), va también la huella corta de la campaña, nunca su
nombre: «(ref. web-lipolaser · c-1x2y3z)». En lo íntimo el texto es neutro («Salud íntima femenina»)
y la referencia es **la de su especialidad** (`web-intima-f-…`), la misma en todas sus páginas: el
mensaje se lee en la pantalla del móvil y pasa por Meta, y el código de cada página se podría buscar
(la tabla de referencias está en el repositorio). Lo concreto lo pregunta la conversación.

Cuando llega un texto con esa referencia, antes de pasarlo a la repesca, `servidor/entrada.js` da de
alta un lead `web_whatsapp` («Web (botón WhatsApp)» en el panel) con `codigo_web` = la referencia, el
tratamiento que le toca según `semillas/iemec/referencias-web.json` (la genera `npm run web`) y la
campaña (si su huella es la de una que conocemos, de los formularios o del mapeo, su nombre; si no,
la huella en `utm.clave_campana`, que el panel enseña), y la conversación pasa a ser la del lead, como
con los anuncios. Sin secuencia: ya está hablando con la IA. Si ya tenía un lead en marcha, no se
duplica. Una referencia que no está en el archivo (una página que ya no existe) da el lead sin
tratamiento.

Ese primer mensaje **es una petición de información de esa página**: se le contesta como a «quiero
información» (lo aprobado, una valoración y, si la IA puede darle cita, huecos), sin la «(ref. …)»
(no la escribió él: ni las reglas, ni la IA, ni su historial la ven; en la conversación se guarda
entero) y sin volver a sacar del texto lo que le interesa, que ya dijo la referencia («Diagnóstico de
lipoláser» nombra el lipoláser, pero su página es la del diagnóstico). Los de las tarjetas regalo
(comprar una de 45 €, canjearla…) pasan a una persona con su tarea. Una baja, algo de salud o una
queja mandan igual.

## POST /web/contacto (el formulario de la web pública)

La web nueva es estática (`web/`, en otro dominio): su formulario «Te llamamos» manda un `POST`
`application/x-www-form-urlencoded` directamente desde el navegador, sin clave. Los campos y las
respuestas están en [`web/README.md`](../web/README.md).

**Es anónimo y el teléfono no se comprueba:** cualquiera puede escribir el de otra persona, con el
nombre y el tratamiento que quiera, y hacerlo con un programa. CORS no lo impide (solo que otra web
lea la respuesta), y la trampa y el tiempo de rellenado (`t`, que pone el navegador) solo paran a los
robots torpes. Por eso, lo que llega por aquí **no escribe a nadie con lo que puso quien lo envió ni
se une a los datos de otro**:

- **Lead sin verificar** (`leads.sin_verificar`): no se une a la conversación abierta de ese teléfono,
  ni a su ficha de paciente, ni a los datos de otro lead (si ya había uno en marcha con ese teléfono,
  no se le toca el nombre, el correo ni el interés: lo nuevo va en su solicitud, en el evento y en la
  tarea). Su casilla comercial no cuenta.
- **Quien pide WhatsApp** recibe primero la plantilla de utilidad `iemec_solicitud_web` (secuencia
  «confirmar_web», en horario de envío), sin nombre ni tratamiento: «Hola, hemos recibido en la web de
  IEMEC una solicitud de información con este número de teléfono. ¿Has sido tú? …», con los botones «Sí,
  fui yo» y «No fui yo». Una sola por teléfono y semana. No es publicidad: le llega también a quien
  tiene la baja comercial. Si ese teléfono ya tiene una conversación abierta, en vez de la plantilla,
  tarea para quien la lleva («comprobar que lo pidió antes de hablarle de ello»).
- **«Sí, fui yo»** (o «sí», «soy yo»…, durante una semana y mientras no le escribamos otra cosa): la
  solicitud queda verificada (`verificarSolicitudWeb`): el lead se une a su ficha (si la tiene) y a su
  conversación, su casilla comercial cuenta (y pasa a su ficha; si la marcó después de darse de baja,
  una tarea lo dice: la baja la quita dirección) y la conversación le contesta a lo que pidió, como a
  «quiero información». **«No fui yo»**: se borra lo que escribió el otro (nombre, correo, lo pedido), se
  cancelan sus tareas, se le piden disculpas y no se le manda otra confirmación en 90 días. A otra cosa
  se le explica una vez por qué le escribimos.
- **Quien pide llamada o correo:** tarea para recepción, con «(formulario de la web, sin verificar)»;
  si el teléfono es de una paciente o de otro lead, lo primero del título lo dice (y, si el correo no es
  el de su ficha, que no le mande nada suyo a ese correo). En **Tareas**, lo que escribió y el botón
  «Confirmado: lo pidió» (`POST /api/panel/leads/:id/verificar`), para cuando recepción le ha llamado.
- **Vuelve a enviarlo** con llamada o correo: su tarea sale siempre y su WhatsApp automático (la
  confirmación o la secuencia «lead») se para. Lo que escribe cada vez queda en su solicitud, cifrado,
  y el panel lo enseña.

Además:

- lo que manda otra web (cabecera `Origin` que no es la de la web, o `Sec-Fetch-Site: cross-site`) o
  un robot torpe (la trampa rellena, un envío en menos de 2,5 s) recibe «recibido» y no se guarda nada;
- límites en `limites_acceso` (con huellas, nunca la IP ni el teléfono): 8 envíos por IP cada 15
  minutos y 20 al día (`429`), y 3 por teléfono al día **en silencio** (se contesta como a un envío
  bueno y no se guarda nada: un `429` diría si otra persona ha pedido información hoy con ese número);
- un tope entre todos de lo que se pone en marcha solo (20 confirmaciones o tareas por hora): pasado,
  se guarda sin escribir a nadie ni crear tareas, y una sola tarea urgente lo avisa («Formulario de la
  web: más solicitudes de las normales…»);
- valida como la web (los mismos mensajes, en `motor/entrada/web.js`): sin JavaScript contesta `303` a
  `WEB_DOMINIO/gracias/` o una página sencilla con los errores; con él, `200 {ok: true}`,
  `422 {ok: false, errores}` o `429`;
- traduce el «¿Qué te interesa?» y la referencia de la página («web-lipolaser», o el código de lo
  íntimo) con `semillas/iemec/referencias-web.json`: nunca llega un id del catálogo. Una referencia bien
  formada que aún no está en el archivo (una página publicada antes que la app) vale como interés sin
  tratamiento;
- guarda en `solicitudes_web` la prueba de los dos consentimientos por separado (RGPD, art. 7.1), con
  la fecha, la preferencia, la versión de los textos y si es una de las que publicó la web
  (`semillas/iemec/textos-formulario.json`, que genera `npm run web` con cada versión y sus textos
  exactos: una versión desconocida se guarda marcada y su casilla comercial no cuenta). Lo que pidió
  (la página, la referencia, el tratamiento, el interés, lo que escribió) va cifrado. La huella del
  envío es un HMAC con el secreto del servidor (sin él no se puede comprobar un mensaje adivinado): con
  JavaScript, del identificador al azar del formulario (`envio`), así un reintento no duplica.

**Cuánto se guarda** (`servidor/retencion.js`, cada día en el cron): la solicitud que nadie confirma
caduca a la semana y, como la rechazada, se borra al mes; el lead de la web o de su WhatsApp sin cita ni
actividad en 12 meses (`RETENCION_LEADS_MESES`) se borra con sus tareas, seguimientos y secuencias, y sus
conversaciones si ese teléfono no es de un paciente; de sus eventos se quita el tratamiento. De sus
solicitudes solo queda la prueba de un consentimiento comercial verificado, 3 años y sin lo pedido.
Para una petición de supresión: `node scripts/suprimir-telefono.js <teléfono>` (dice qué borraría) y
con `--confirmar` lo borra y lo pone en la lista de bajas; a un paciente no lo toca.

## POST /api/leads (GHL y otras herramientas)

Desde un **servidor** (GHL u otra herramienta), nunca desde el navegador: la clave no puede ir en
una página.

```bash
curl -X POST https://agenda.iemec-clinic.com/api/leads \
  -H 'Content-Type: application/json' -H "X-Clave: $LEADS_CLAVE" \
  -d '{"telefono":"611 000 000","nombre":"Nombre Apellido","email":"correo@ejemplo.com",
       "tratamiento":"higiene-facial-triacidos","codigo_web":"OTO26-FAC",
       "utm_source":"google","utm_campaign":"otono-facial","mensaje":"¿Tenéis cita el sábado?"}'
```

| Campo | |
|---|---|
| `telefono` o `email` | Al menos uno |
| `nombre`, `mensaje` | Opcionales (el mensaje va cifrado) |
| `tratamiento` | Identificador o nombre del catálogo |
| `origen` | `web` por defecto; `ghl`, `google`, `referido`… (los de `leads.origen`) |
| `codigo_web`, `utm` (objeto) o `utm_source`… `utm_term`, `campana`, `conjunto`, `anuncio` | Atribución |
| `id_externo` | **Este envío** en la otra herramienta (el formulario enviado, la oportunidad de GHL): si se reintenta, no se duplica. No es la persona |
| `id_contacto` | La persona en la otra herramienta (el contacto de GHL, en `leads.ghl_contact_id`): puede repetirse, la misma persona puede volver a pedir información |
| `id_oportunidad` | La oportunidad de GHL (`leads.ghl_opportunity_id`) |

Respuestas: **201** lead nuevo (`inscrito` y, si no, `motivo`: `sin_telefono`, `telefono_fijo`,
`baja_comercial`, `conversacion`), **200** ya estaba en marcha (`en_marcha`) o el mismo envío otra
vez (`repetido`), **400** faltan datos, **401** clave mala, **503** sin `LEADS_CLAVE` en el servidor.
`tratamiento` es el interés que tiene el lead después del alta. También acepta
`application/x-www-form-urlencoded`.

## Pruebas

- `test/web-contacto.test.js` y `test/web-verificar.test.js`: el formulario de la web (validación,
  otras webs, límites, tope, la prueba cifrada, la huella) y, con la demo, la confirmación por
  WhatsApp, el teléfono de otra persona, la casilla comercial hasta la ficha, quien vuelve con otra
  preferencia, el primer WhatsApp de cada botón de la web, las bajas, la campaña y el borrado.
- `test/webhooks.test.js`: peticiones reales al puerto (verificación, firmas, duplicados, cada tipo
  de mensaje, referral, estados y el panel, 131050, formularios con mapeo y el cron en una vuelta,
  bajas, medicamentos con receta y `/api/leads`) y, con su propia base, lo que encontró la revisión:
  dos cron a la vez con la IA lenta, la hora del mensaje, el lead que ya tenía conversación (con una
  persona, con la IA, la de un presupuesto), la lista de bajas, los nombres, GHL, leads de Meta que no
  se pueden leer, adjuntos urgentes, avisos de otros números o páginas, la clave corta, la purga, la
  secuencia entera sin respuesta y la lista de tareas del panel.
- `motor/entrada/whatsapp.test.js` y `motor/entrada/leads.test.js`: la lectura de los avisos, el
  teléfono, el formulario y el tratamiento, sin base de datos.
- `servidor/integraciones/meta.test.js`: el adaptador de Meta; el real, con un `fetch` de mentira
  (nunca sale nada a internet).

## Pendiente

- Envío real (`servidor/integraciones/whatsapp.js` en modo `real`): hoy solo entra.
- Sacar a alguien de la lista de bajas si vuelve a dar su consentimiento (hoy, a mano en la base; si
  lo marca en la web después de su baja, una tarea lo dice).
- Aprobar en Meta la plantilla `iemec_solicitud_web` y conectar el envío real antes de ofrecer WhatsApp en
  el formulario de la web (`web/datos/sitio.json` → `formulario.whatsapp: true`). Hasta entonces la web
  sale sin esa opción (llamada o correo) y no promete el WhatsApp de confirmación.
- Estados de las plantillas (`message_template_status_update`, calidad) y, con coexistencia, los
  mensajes que manda el equipo desde el móvil (`smb_message_echoes`): se guardan, pero aún no se
  procesan.
- Descargar audios, fotos y documentos (hoy se ven en el móvil de la clínica o en el proveedor).
- Devolver a Meta las conversiones con `ctwa_clid` (API de conversiones).
