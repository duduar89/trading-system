# Formulario de contacto y cita · textos exactos

> **Borrador para revisión** (DPD) · 30-09-2026. Textos listos para copiar en el formulario de la
> web nueva. El formulario manda los datos al servidor de la web y este a la app de la clínica
> (`POST /api/leads`, con la clave en el servidor, nunca en la página). Encargado del tratamiento:
> el proveedor de la app. Si el paciente elige WhatsApp, le escribimos por WhatsApp Business (Meta).
> Normas: RGPD, arts. 5.1.c, 6, 7, 9 y 13; LOPDGDD, arts. 6, 7 y 11; LSSI, arts. 20 y 21;
> [modelo de información por capas de la AEPD](https://www.aepd.es/guias/guia-modelo-clausula-informativa.pdf).

---

## 1. Campos

| Campo | Etiqueta visible | Obligatorio | Ayuda bajo el campo | `autocomplete` |
|---|---|---|---|---|
| Nombre | **Nombre** | Sí | — | `given-name` (o `name`) |
| Teléfono | **Teléfono** | Sí | «Te llamaremos o escribiremos a este número.» | `tel` |
| Correo | **Correo electrónico (opcional)** | Solo si eliges «Correo» como forma de contacto | — | `email` |
| Tratamiento | **¿Qué te interesa?** | Sí | «Si viene de la página de un tratamiento, ya está elegido.» | — |
| Mensaje | **Mensaje (opcional)** | No | «Cuéntanos lo básico: qué te interesa y cuándo te viene bien. **No incluyas datos médicos** (enfermedades, medicación, fotos): los hablaremos en consulta.» | — |
| Contacto | **¿Cómo prefieres que te contactemos?** | Sí | Opciones: «WhatsApp» · «Llamada» · «Correo electrónico» | — |

Límite del mensaje: 500 caracteres. No se piden DNI, fecha de nacimiento, dirección, historia
clínica, medicación, embarazo ni fotos: no hacen falta para contestar (RGPD, art. 5.1.c). **La web
no admite subir fotos.**

### Opciones de «¿Qué te interesa?»

Nombres neutros: el tratamiento concreto va en un campo oculto con la página de origen (el
identificador del catálogo para la app), no en el texto que se ve ni en el WhatsApp.

- Medicina estética facial
- Medicina estética corporal
- Control de peso `[PENDIENTE: solo si se confirma que la autorización del centro lo cubre]`
- Medicina capilar
- Injerto capilar
- Salud íntima femenina
- Salud íntima masculina
- Cirugía estética
- Estética y bienestar (faciales, masajes, head spa)
- Tarjeta regalo `[PENDIENTE: si se mantiene]`
- Otra cosa / prefiero contarlo por teléfono

## 2. Información básica sobre protección de datos (primera capa)

Encima del botón de enviar, siempre visible (no desplegable), con este título y esta tabla:

**Información básica sobre protección de datos**

| | |
|---|---|
| **Responsable** | Aneco AP Consulting, S.L. (IEMEC). |
| **Finalidad** | Contestar a tu solicitud y darte cita por el medio que elijas. Si marcas la segunda casilla, enviarte comunicaciones comerciales. |
| **Legitimación** | Tu solicitud, y tu consentimiento explícito para el dato de salud que pueda revelar el tratamiento que te interesa. Para las comunicaciones comerciales, tu consentimiento. |
| **Destinatarios** | El proveedor de la app de gestión de la clínica, como encargado del tratamiento, y WhatsApp (Meta) si eliges que te escribamos por WhatsApp, con posible transferencia a EE. UU. amparada en el Marco de Privacidad de Datos UE-EE. UU. No se ceden a nadie más salvo obligación legal. |
| **Derechos** | Acceder, rectificar y suprimir tus datos, oponerte, limitar su uso, portarlos y retirar tu consentimiento en `[PENDIENTE: correo]`. Puedes reclamar ante la AEPD. |
| **Más información** | En la [Política de privacidad](./privacidad.md). |

## 3. Casillas

Las dos **sin marcar** al cargar la página (RGPD, art. 7; LOPDGDD, art. 6). Separadas, cada una con
su texto; la segunda no condiciona el envío (LOPDGDD, art. 6.3).

**Casilla 1 · obligatoria**

> ☐ He leído la información básica sobre protección de datos. Consiento que IEMEC trate mis datos,
> incluido el tratamiento que me interesa si revela algo de mi salud, para contestar a mi solicitud
> por el medio que he elegido.

**Casilla 2 · opcional**

> ☐ Quiero recibir comunicaciones comerciales de IEMEC (novedades y propuestas sobre los
> tratamientos que me interesan) por WhatsApp o correo electrónico. Puedo darme de baja cuando
> quiera respondiendo «BAJA». *(Opcional)*

## 4. Botón y avisos

- Botón: **Enviar solicitud**
- Debajo, en texto normal (no en letra pequeña):
  «Te contestamos en horario de la clínica, de lunes a sábado. **Este formulario no es para
  urgencias: si es urgente, llama al 112.**» `[PENDIENTE: horario del sábado]`

## 5. Errores (anunciados a lectores de pantalla y junto a cada campo)

- Nombre vacío: «Escribe tu nombre.»
- Teléfono no válido: «Revisa el teléfono: 9 cifras, o con prefijo si es de fuera de España.»
- Correo obligatorio: «Has elegido que te contestemos por correo: escribe tu correo electrónico.»
- Correo no válido: «Revisa el correo electrónico (falta la @ o el dominio).»
- Sin tratamiento: «Elige qué te interesa (o «Otra cosa»).»
- Sin forma de contacto: «Elige cómo prefieres que te contactemos.»
- Casilla 1 sin marcar: «Para contestarte necesitamos tu consentimiento en la primera casilla.»
- Fallo de envío: «No hemos podido enviar tu solicitud. Vuelve a intentarlo o escríbenos por
  WhatsApp al 722 83 32 85.» (lo escrito no se borra).

## 6. Confirmación

«**Gracias, [nombre]. Hemos recibido tu solicitud.** Te contactaremos por [WhatsApp / teléfono /
correo] en horario de la clínica. Si nos escribes por WhatsApp, verás nuestro número: +34 722 83 32
85.»

La página de confirmación no repite el tratamiento elegido si es de salud íntima o de peso, por si
otra persona ve la pantalla.

## 7. Qué se manda a la app y qué se guarda como prueba

Además de los campos, el servidor de la web añade y la app guarda (RGPD, art. 7.1: hay que poder
demostrar el consentimiento):

| Dato | Ejemplo |
|---|---|
| `origen` | `web` |
| `tratamiento` | identificador del catálogo de la página de origen, o el grupo elegido |
| `pagina_origen` | `/facial/arrugas-de-expresion` |
| `canal_preferido` | `whatsapp` · `llamada` · `correo` |
| `consentimiento_datos` | `true` (sin él no se envía) |
| `consentimiento_comercial` | `true` / `false` |
| `version_clausula` | `2026-10-01` `[PENDIENTE]` |
| `fecha_consentimiento` | fecha y hora del envío |
| `id_externo` | identificador único del envío (para no duplicar si se reintenta) |

`[PENDIENTE para Eduardo]` Hoy `POST /api/leads` no recibe los consentimientos. Hace falta
añadirlos y que la secuencia «lead» sea solo de **seguimiento de la solicitud** (hasta dar cita o
recibir un «no») cuando `consentimiento_comercial` es `false`; las plantillas comerciales, solo con
`true` (LSSI, art. 21.1).

## 8. WhatsApp prellenado (botones de la web)

- Texto: «Hola, vengo de la web de IEMEC y quiero información sobre [grupo neutro]. (Ref. [código
  de la página])». El código lleva el identificador del catálogo para que la app sepa la sala.
- **Nunca** el nombre de un medicamento, de una marca ni de un tratamiento íntimo o de peso en el
  texto: lo escribe la clínica y cuenta como publicidad; además queda en el móvil del paciente.
  Para lo íntimo o el peso, el grupo («Salud íntima femenina», «Control de peso») o solo «una
  consulta».
- Cada botón con el texto de **su** tratamiento (la web actual manda textos de otros
  tratamientos). La prueba automática compara el código del botón con la página.
- Enlace `https://wa.me/34722833285?text=…` (número sin «+» ni espacios).
- Junto al botón: «WhatsApp es un servicio de Meta.» (enlace a la [Política de privacidad](./privacidad.md)).

## 9. Accesibilidad y antispam

- Etiqueta visible y asociada a cada campo; obligatorios marcados con texto, no solo con color o
  asterisco; errores con `aria-live` y foco en el primer error (WCAG 2.2, criterios 1.3.1, 3.3.1,
  3.3.2 y 4.1.3).
- Casillas y botones de 24 × 24 px como mínimo (criterio 2.5.8).
- Sin CAPTCHA de terceros: campo trampa oculto, tiempo mínimo de rellenado y límite de envíos por
  IP y teléfono en el propio servidor (sin cookies ni datos a terceros).
- No borrar lo escrito si falla el envío (criterio 3.3.7, entrada redundante).
