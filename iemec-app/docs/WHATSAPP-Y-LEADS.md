# WhatsApp y leads: cómo entran

Por aquí entra todo lo que viene de fuera: los mensajes de WhatsApp (y lo que le pasa a lo que
mandamos), los leads de los formularios de los anuncios de Meta y los de la web o GHL.

```
Meta / 360dialog ──POST──▶ /webhooks/whatsapp ─┐  firma bien → se guarda en «webhooks»
Meta (página)    ──POST──▶ /webhooks/meta     ─┤  + trabajo en la «cola» → 200 al momento
                                               │
cron de cada minuto ◀──────────────────────────┘  (servidor/entrada.js, antes que las secuencias)
   ├─ texto, botón de plantilla, interactivo → la repesca (procesarEntrante), que contesta
   ├─ audio, foto, vídeo, documento, ubicación, sticker… → a una persona, con tarea
   ├─ clic en un anuncio que abre WhatsApp (referral) → lead «meta_ctwa» y luego la repesca
   ├─ estados (enviado, entregado, leído, fallido) → el mensaje en la bandeja, con su motivo
   └─ lead de un formulario → se pide a Meta → alta → secuencia «lead» (primer mensaje ya)

La web / GHL ──POST con X-Clave──▶ /api/leads → alta → secuencia «lead» (en la misma petición)
```

La ruta nunca procesa nada: comprueba la firma, guarda el cuerpo tal cual (cifrado, como los
mensajes: trae lo que escribe el paciente) y contesta 200 en milisegundos (Meta reintenta lo que
tarda). Para leer uno a mano: `require('./servidor/entrada').descifrarCuerpo(cuerpo)` con la
`CLAVE_CIFRADO` del servidor. Lo procesa el cron, con la cola en MariaDB: si algo
falla, se reintenta (1, 2, 4, 8 minutos) y el error queda en `webhooks.error` y `cola.ultimo_error`.
Lo que ya se hizo no se repite: los mensajes van por su `wamid` y los leads por su identificador de
Meta, así que un aviso repetido no duplica nada.

Trabajos de la cola: `webhook_whatsapp` (avisos con mensajes), `webhook_meta` (leads) y
`webhook_whatsapp_estados` (avisos que solo traen estados). Cada minuto van primero los dos primeros
(20 por vuelta) y después los estados (200 por vuelta): cuando salen las secuencias llegan muchos
estados a la vez y no pueden hacer esperar a lo que escribe un paciente.

## Las direcciones

Con el subdominio de la app (en el ejemplo, `agenda.iemec-clinic.com`, siempre con https):

| Qué | URL |
|---|---|
| Webhook de WhatsApp | `https://agenda.iemec-clinic.com/webhooks/whatsapp` |
| Webhook de leads de Meta | `https://agenda.iemec-clinic.com/webhooks/meta` |
| Alta de leads (web, GHL) | `https://agenda.iemec-clinic.com/api/leads` |

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
| `MODO_META` | `simulado` (por defecto) o `real` | En `real` sin `META_TOKEN_PAGINA` no arranca (puerta ⛔) |
| `LEADS_CLAVE` | Clave que la web o GHL mandan en la cabecera `X-Clave` | Te la inventas: 32 caracteres aleatorios (mínimo 16) |

Sin secreto ni clave, **en producción los webhooks se rechazan** (503); fuera de producción se
admiten y quedan con `firma_ok = NULL`, para probar en el portátil.

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
6. `MODO_META=real` y `META_TOKEN_PAGINA` en el servidor.

## Qué pasa con cada mensaje

| Llega | Qué se hace |
|---|---|
| Texto | A la repesca: se para su secuencia, se entiende, se decide y la IA contesta (o elige hueco y se reserva) |
| Botón de una plantilla («Sí, búscame hueco») | Igual, con el texto del botón |
| Interactivo (botón o lista) | Igual, con el título de la opción |
| Audio | Se registra «[audio]», pasa a una persona con tarea y se le dice que no se pueden escuchar audios y que le contesta el equipo |
| Imagen, vídeo, documento | Se registra («[imagen] leyenda», «[documento: nombre]»), a una persona con tarea y se le dice que lo revisa el equipo. Si la leyenda es una baja o algo de salud, va por la repesca: la baja se aplica al momento y lo urgente pasa con prisa (y el 112) |
| Ubicación, sticker, contacto, lo que no se puede leer | Se registra y a una persona con tarea, sin contestarle |
| Reacción (👍 a un mensaje nuestro) | Se registra en esa conversación, sin más |
| Clic en un anuncio que abre WhatsApp | Antes que nada, lead `meta_ctwa` con `ctwa_clid`, anuncio y tratamiento (por el mapeo o el titular); la conversación queda enlazada al lead y la repesca lo trata como tal. Sin secuencia: ya está hablando con la IA |

El nombre del perfil de WhatsApp se guarda en la conversación (`nombre_whatsapp`): con él se saluda
a quien aún no es lead ni paciente, y la bandeja lo muestra en vez del número. Si ya hay ficha o lead
con nombre, manda ese.

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
| 131050 | El paciente ha pulsado en WhatsApp que no quiere marketing de la clínica | **Baja comercial**: consentimiento revocado con su prueba, secuencias canceladas y, si era un lead en marcha, tarea para decidir si se le llama |
| 131047 | Pasaron 24 h desde su último mensaje | Hace falta plantilla |
| 131026 | El número no tiene WhatsApp | — |

Si lo que no llega es una respuesta escrita (de la IA o del equipo, no una plantilla), además la
conversación pasa a una persona con tarea: el paciente cree que no le hemos contestado.

## Leads: un solo camino para todos

Formularios de Meta, anuncios que abren WhatsApp, la web y GHL pasan por `servidor/leads.js`:

- **Teléfono** en formato internacional (E.164). Sin prefijo se entiende España (9 cifras que
  empiezan por 6, 7, 8 o 9); con `+` o `00`, cualquier país.
- **No se duplica:** si ya hay un lead en marcha con ese teléfono (ni perdido ni vendido; sin
  teléfono, con ese email), se completa lo que le faltaba, se apunta que ha vuelto
  (`eventos.lead_repetido`) y su secuencia sigue donde estaba.
- **Secuencia «lead»:** el primer mensaje (plantilla `lead_primer_contacto`) sale en menos de un
  minuto si es horario de envío (el lead de Meta, en la misma vuelta del cron que lo procesa; el de
  la web, en la siguiente), y si no, al abrir. En vez de secuencia, **tarea para recepción** si no
  hay teléfono válido, si es un fijo (sin WhatsApp: se le llama) o si esa persona tiene la baja
  comercial.
- **Lo que escribió en el formulario** va cifrado (`leads.respuestas_cifradas`), como los mensajes,
  y la bandeja lo enseña en la ficha del lead.
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

Para configurar una campaña:

```sql
INSERT INTO mapeo_tratamientos (clave, tratamiento_id, notas) VALUES
  ('120210000000000001', 'mesoterapia-capilar', 'anuncio vídeo capilar otoño'),
  ('Tratamientos capilares', 'diagnostico-capilar-gratuito', 'respuesta del formulario de captación'),
  ('OTO26-FAC', 'higiene-facial-triacidos', 'código de la landing de otoño');
```

## POST /api/leads (la web y GHL)

Desde el **servidor** de la web o desde GHL, nunca desde el navegador: la clave no puede ir en la
página.

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
| `id_externo` | El identificador en la otra herramienta (con `origen: "ghl"`, el contacto de GHL) |

Respuestas: **201** lead nuevo (`inscrito` y, si no, `motivo`: `sin_telefono`, `telefono_fijo`,
`baja_comercial`), **200** ya estaba en marcha, **400** faltan datos, **401** clave mala, **503**
sin `LEADS_CLAVE` en el servidor. También acepta `application/x-www-form-urlencoded`.

## Pruebas

- `test/webhooks.test.js`: peticiones reales al puerto (verificación, firmas, duplicados, cada tipo
  de mensaje, referral, estados y el panel, 131050, formularios con mapeo y el cron en una vuelta,
  bajas, medicamentos con receta y `/api/leads`).
- `motor/entrada/whatsapp.test.js` y `motor/entrada/leads.test.js`: la lectura de los avisos, el
  teléfono, el formulario y el tratamiento, sin base de datos.

## Pendiente

- Envío real (`servidor/integraciones/whatsapp.js` en modo `real`): hoy solo entra.
- Estados de las plantillas (`message_template_status_update`, calidad) y, con coexistencia, los
  mensajes que manda el equipo desde el móvil (`smb_message_echoes`): se guardan, pero aún no se
  procesan.
- Descargar audios, fotos y documentos (hoy se ven en el móvil de la clínica o en el proveedor).
- Devolver a Meta las conversiones con `ctwa_clid` (API de conversiones).
